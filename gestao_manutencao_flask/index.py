import hmac
import os
import re
import secrets
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse

import requests
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from flask import (
    Flask,
    Response,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument
from pymongo.errors import PyMongoError


load_dotenv()

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.getenv("SECRET_KEY", "chave-local-altere-na-producao"),
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(os.getenv("VERCEL")),
)

STATUS_LABELS = {
    "operando": "Operando",
    "operando_requer_manutencao": "Operando — requer manutenção",
    "manutencao": "Em manutenção",
}

_mongo_client = None
_indexes_ready = False


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_collection():
    global _mongo_client, _indexes_ready
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("A variável MONGODB_URI não foi configurada.")

    if _mongo_client is None:
        _mongo_client = MongoClient(
            uri,
            serverSelectionTimeoutMS=6000,
            connectTimeoutMS=6000,
            retryWrites=True,
        )

    database_name = os.getenv("MONGODB_DB", "gestao_manutencao").strip()
    collection = _mongo_client[database_name]["maquinas"]

    if not _indexes_ready:
        collection.create_index([("nome", ASCENDING)])
        collection.create_index([("status", ASCENDING), ("updated_at", DESCENDING)])
        _indexes_ready = True

    return collection


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("authenticated"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Sessão expirada. Entre novamente."}), 401
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


@app.before_request
def prepare_session_and_validate_csrf():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)

    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None

    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if supplied and expected and hmac.compare_digest(supplied, expected):
        return None

    if request.path.startswith("/api/"):
        return jsonify({"error": "Não foi possível validar a solicitação."}), 403

    flash("Não foi possível validar a solicitação. Atualize a página e tente novamente.", "danger")
    return redirect(url_for("index"))


def clean_text(value, limit=2000):
    if value is None:
        return ""
    return str(value).strip()[:limit]


def parse_nonnegative_number(value, field_name):
    if value in (None, ""):
        return None
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} deve ser um número válido.") from exc
    if number < 0:
        raise ValueError(f"{field_name} não pode ser negativo.")
    return number


def valid_imgur_url(value):
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname not in {"i.imgur.com", "imgur.com"}:
        raise ValueError("A foto informada não possui um endereço válido do Imgur.")
    return value[:1000]


def history_entry(entry_type, description):
    return {
        "id": secrets.token_hex(8),
        "data": utc_now_iso(),
        "tipo": clean_text(entry_type, 80),
        "descricao": clean_text(description, 1000),
    }


def format_hours_pt(value):
    formatted = f"{value:.3f}".rstrip("0").rstrip(".")
    return formatted.replace(".", ",")


def normalized_payload(payload, existing=None):
    nome = clean_text(payload.get("nome"), 120)
    if not nome:
        raise ValueError("Informe o nome da máquina.")

    status = clean_text(payload.get("status"), 60)
    if status not in STATUS_LABELS:
        raise ValueError("Selecione um status válido.")

    maintenance = payload.get("manutencao") or {}
    if not isinstance(maintenance, dict):
        raise ValueError("Os dados de manutenção são inválidos.")

    old_photo_url = (existing or {}).get("foto_url", "")
    old_delete_hash = (existing or {}).get("foto_delete_hash", "")
    remove_image = bool(payload.get("remover_foto"))

    if remove_image:
        photo_url = ""
        delete_hash = ""
    elif "foto_url" in payload:
        photo_url = valid_imgur_url(clean_text(payload.get("foto_url"), 1000))
        delete_hash = clean_text(payload.get("foto_delete_hash"), 200)
        if photo_url == old_photo_url and not delete_hash:
            delete_hash = old_delete_hash
    else:
        photo_url = old_photo_url
        delete_hash = old_delete_hash

    return {
        "nome": nome,
        "operador": clean_text(payload.get("operador"), 120),
        "horimetro": parse_nonnegative_number(payload.get("horimetro"), "Horímetro"),
        "status": status,
        "foto_url": photo_url,
        "foto_delete_hash": delete_hash,
        "manutencao": {
            "data_inicio_campo": clean_text(maintenance.get("data_inicio_campo"), 40),
            "horas_parada_campo": parse_nonnegative_number(
                maintenance.get("horas_parada_campo"), "Tempo parado no campo"
            ),
            "cidade": clean_text(maintenance.get("cidade"), 120),
            "data_inicio_cidade": clean_text(maintenance.get("data_inicio_cidade"), 40),
            "reparo_campo": clean_text(maintenance.get("reparo_campo"), 3000),
            "detalhes": clean_text(maintenance.get("detalhes"), 5000),
            "pedido_pecas": clean_text(maintenance.get("pedido_pecas"), 3000),
        },
    }


def serialize_machine(machine):
    return {
        "id": str(machine["_id"]),
        "nome": machine.get("nome", ""),
        "operador": machine.get("operador", ""),
        "horimetro": machine.get("horimetro"),
        "status": machine.get("status", "operando"),
        "status_label": STATUS_LABELS.get(machine.get("status"), "Não informado"),
        "foto_url": machine.get("foto_url", ""),
        "manutencao": machine.get("manutencao", {}),
        "historico": machine.get("historico", []),
        "created_at": machine.get("created_at", ""),
        "updated_at": machine.get("updated_at", ""),
    }


def parse_object_id(machine_id):
    try:
        return ObjectId(machine_id)
    except (InvalidId, TypeError) as exc:
        raise ValueError("Identificador de máquina inválido.") from exc


def delete_imgur_image(delete_hash):
    client_id = os.getenv("IMGUR_CLIENT_ID", "").strip()
    if not client_id or not delete_hash:
        return
    try:
        requests.delete(
            f"https://api.imgur.com/3/image/{delete_hash}",
            headers={"Authorization": f"Client-ID {client_id}"},
            timeout=12,
        )
    except requests.RequestException:
        pass


@app.route("/")
def index():
    return render_template(
        "index.html",
        authenticated=bool(session.get("authenticated")),
        username=session.get("username", ""),
        csrf_token=session["csrf_token"],
    )


@app.post("/login")
def login():
    configured_user = os.getenv("APP_USERNAME", "admin").strip()
    configured_password = os.getenv("APP_PASSWORD", "")
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    if not configured_password:
        flash("Defina APP_PASSWORD nas variáveis de ambiente antes de entrar.", "danger")
        return redirect(url_for("index"))

    user_ok = hmac.compare_digest(username, configured_user)
    password_ok = hmac.compare_digest(password, configured_password)
    if not (user_ok and password_ok):
        flash("Usuário ou senha incorretos.", "danger")
        return redirect(url_for("index"))

    session.clear()
    session["authenticated"] = True
    session["username"] = configured_user
    session["csrf_token"] = secrets.token_urlsafe(32)
    return redirect(url_for("index"))


@app.post("/logout")
@login_required
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.get("/api/maquinas")
@login_required
def list_machines():
    query = {}
    status = request.args.get("status", "").strip()
    search = request.args.get("q", "").strip()
    if status in STATUS_LABELS:
        query["status"] = status
    if search:
        safe_search = re.escape(search[:120])
        query["$or"] = [
            {"nome": {"$regex": safe_search, "$options": "i"}},
            {"operador": {"$regex": safe_search, "$options": "i"}},
        ]

    machines = get_collection().find(query).sort("updated_at", DESCENDING)
    return jsonify([serialize_machine(machine) for machine in machines])


@app.post("/api/maquinas")
@login_required
def create_machine():
    payload = request.get_json(silent=True) or {}
    machine = normalized_payload(payload)
    now = utc_now_iso()
    machine.update(
        {
            "historico": [
                history_entry(
                    "cadastro",
                    f"Máquina cadastrada com o status: {STATUS_LABELS[machine['status']] }.",
                )
            ],
            "created_at": now,
            "updated_at": now,
        }
    )
    result = get_collection().insert_one(machine)
    machine["_id"] = result.inserted_id
    return jsonify(serialize_machine(machine)), 201


@app.put("/api/maquinas/<machine_id>")
@login_required
def update_machine(machine_id):
    object_id = parse_object_id(machine_id)
    collection = get_collection()
    existing = collection.find_one({"_id": object_id})
    if not existing:
        return jsonify({"error": "Máquina não encontrada."}), 404

    payload = request.get_json(silent=True) or {}
    updated = normalized_payload(payload, existing)
    updated["updated_at"] = utc_now_iso()

    history = list(existing.get("historico", []))
    if existing.get("status") != updated["status"]:
        history.insert(
            0,
            history_entry(
                "alteração de status",
                f"Status alterado para: {STATUS_LABELS[updated['status']] }.",
            ),
        )

    history_note = clean_text(payload.get("historico_descricao"), 1000)
    if history_note:
        history.insert(0, history_entry("atualização de manutenção", history_note))
    updated["historico"] = history[:500]

    collection.update_one({"_id": object_id}, {"$set": updated})

    old_photo = existing.get("foto_url", "")
    if old_photo and old_photo != updated.get("foto_url"):
        delete_imgur_image(existing.get("foto_delete_hash", ""))

    saved = collection.find_one({"_id": object_id})
    return jsonify(serialize_machine(saved))


@app.delete("/api/maquinas/<machine_id>")
@login_required
def delete_machine(machine_id):
    object_id = parse_object_id(machine_id)
    collection = get_collection()
    machine = collection.find_one({"_id": object_id})
    if not machine:
        return jsonify({"error": "Máquina não encontrada."}), 404

    collection.delete_one({"_id": object_id})
    delete_imgur_image(machine.get("foto_delete_hash", ""))
    return jsonify({"message": "Máquina excluída."})


@app.post("/api/maquinas/<machine_id>/historico")
@login_required
def add_history(machine_id):
    object_id = parse_object_id(machine_id)
    payload = request.get_json(silent=True) or {}
    entry_type = clean_text(payload.get("tipo"), 80) or "observação"
    description = clean_text(payload.get("descricao"), 1000)
    if not description:
        raise ValueError("Informe a descrição do lançamento.")

    entry = history_entry(entry_type, description)
    result = get_collection().update_one(
        {"_id": object_id},
        {
            "$push": {"historico": {"$each": [entry], "$position": 0, "$slice": 500}},
            "$set": {"updated_at": utc_now_iso()},
        },
    )
    if not result.matched_count:
        return jsonify({"error": "Máquina não encontrada."}), 404
    return jsonify(entry), 201


@app.post("/api/maquinas/<machine_id>/horimetro")
@login_required
def add_hourmeter_hours(machine_id):
    object_id = parse_object_id(machine_id)
    payload = request.get_json(silent=True) or {}
    hours = parse_nonnegative_number(payload.get("horas"), "Horas lançadas")
    if hours is None or hours <= 0:
        raise ValueError("Informe uma quantidade de horas maior que zero.")
    if hours > 100000:
        raise ValueError("A quantidade de horas informada é muito alta.")

    hours = round(hours, 3)
    collection = get_collection()

    # Cadastros antigos podem não possuir horímetro. Nesse caso, a soma começa em zero.
    collection.update_one(
        {"_id": object_id, "horimetro": None},
        {"$set": {"horimetro": 0}},
    )

    entry = history_entry(
        "lançamento de horas",
        f"{format_hours_pt(hours)} h adicionadas ao horímetro.",
    )
    entry["horas_lancadas"] = hours

    machine = collection.find_one_and_update(
        {"_id": object_id},
        {
            "$inc": {"horimetro": hours},
            "$push": {"historico": {"$each": [entry], "$position": 0, "$slice": 500}},
            "$set": {"updated_at": utc_now_iso()},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not machine:
        return jsonify({"error": "Máquina não encontrada."}), 404

    return jsonify({"maquina": serialize_machine(machine), "lancamento": entry})


@app.post("/api/upload-image")
@login_required
def upload_image():
    client_id = os.getenv("IMGUR_CLIENT_ID", "").strip()
    if not client_id:
        return jsonify({"error": "IMGUR_CLIENT_ID não foi configurado."}), 503

    image = request.files.get("image")
    if not image or not image.filename:
        return jsonify({"error": "Selecione uma imagem."}), 400
    if not (image.mimetype or "").startswith("image/"):
        return jsonify({"error": "O arquivo selecionado não é uma imagem válida."}), 400

    try:
        response = requests.post(
            "https://api.imgur.com/3/image",
            headers={"Authorization": f"Client-ID {client_id}"},
            files={"image": (image.filename, image.stream, image.mimetype)},
            data={"type": "file", "title": clean_text(request.form.get("title"), 120)},
            timeout=30,
        )
        result = response.json()
    except (requests.RequestException, ValueError):
        return jsonify({"error": "Não foi possível enviar a imagem ao Imgur."}), 502

    if not response.ok or not result.get("success") or not result.get("data", {}).get("link"):
        message = result.get("data", {}).get("error", "Falha no envio da imagem.")
        if isinstance(message, dict):
            message = message.get("message", "Falha no envio da imagem.")
        return jsonify({"error": clean_text(message, 300)}), 502

    data = result["data"]
    return jsonify({"url": data["link"], "delete_hash": data.get("deletehash", "")})


@app.get("/api/exportar")
@login_required
def export_data():
    machines = [serialize_machine(item) for item in get_collection().find().sort("nome", ASCENDING)]
    body = {
        "exportado_em": utc_now_iso(),
        "maquinas": machines,
    }
    import json

    content = json.dumps(body, ensure_ascii=False, indent=2)
    return Response(
        content,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=maquinas-backup.json"},
    )


@app.errorhandler(ValueError)
def handle_validation_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"error": str(error)}), 400
    return str(error), 400


@app.errorhandler(PyMongoError)
def handle_mongo_error(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Não foi possível acessar o banco de dados."}), 503
    return "Não foi possível acessar o banco de dados.", 503


@app.errorhandler(413)
def file_too_large(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "A imagem deve ter no máximo 10 MB."}), 413
    return "Arquivo muito grande.", 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")
