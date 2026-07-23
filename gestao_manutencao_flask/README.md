# Gestão de Manutenção

Aplicativo Flask para cadastro e acompanhamento de máquinas, com interface responsiva em Bootstrap, persistência no MongoDB e fotos hospedadas no Imgur.

## Recursos

- Painel responsivo para computador e celular.
- Cadastro, edição e exclusão de máquinas.
- Três estados operacionais:
  - Operando.
  - Operando — requer manutenção.
  - Em manutenção.
- Informações de horímetro, operador, reparos, peças e manutenção no campo ou na cidade.
- Histórico automático de alterações de status e lançamentos manuais.
- Foto opcional enviada ao Imgur; somente o endereço da imagem e o identificador técnico de exclusão ficam no MongoDB.
- Busca, filtros, indicadores, impressão e exportação em JSON.
- Login protegido por variáveis de ambiente.
- Configuração pronta para publicação na Vercel.

## Estrutura do projeto

```text
gestao_manutencao/
├── app.py
├── requirements.txt
├── vercel.json
├── .env.example
├── static/
│   ├── css/style.css
│   └── js/app.js
└── templates/index.html
```

## Configuração local

1. Crie e ative um ambiente virtual:

   **Windows (PowerShell):**

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

   **Linux/macOS:**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Instale as dependências:

   ```bash
   python -m pip install -r requirements.txt
   ```

3. Copie `.env.example` para `.env` e preencha as variáveis:

   ```env
   APP_USERNAME=admin
   APP_PASSWORD=sua-senha-forte
   SECRET_KEY=uma-chave-grande-e-aleatoria
   MONGODB_URI=mongodb+srv://USUARIO:SENHA@CLUSTER.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB=gestao_manutencao
   IMGUR_CLIENT_ID=seu-client-id
   ```

4. Inicie o aplicativo:

   ```bash
   python app.py
   ```

5. Abra `http://127.0.0.1:5000`.

## MongoDB Atlas

Crie um cluster, um usuário de banco e libere o acesso de rede necessário para o ambiente de execução. Use a string de conexão fornecida pelo Atlas em `MONGODB_URI`. Se a senha tiver caracteres especiais, utilize a versão codificada indicada pelo próprio Atlas.

Cada documento da coleção `maquinas` segue esta estrutura:

```json
{
  "nome": "Colheitadeira 01",
  "operador": "João",
  "horimetro": 1540.8,
  "status": "operando_requer_manutencao",
  "foto_url": "https://i.imgur.com/exemplo.jpg",
  "foto_delete_hash": "identificador_privado",
  "manutencao": {
    "data_inicio_campo": "2026-07-22T08:30",
    "horas_parada_campo": 2.5,
    "cidade": "Castanhal",
    "data_inicio_cidade": "",
    "reparo_campo": "",
    "detalhes": "Revisar sistema hidráulico",
    "pedido_pecas": "Kit de vedação"
  },
  "historico": [],
  "created_at": "data ISO",
  "updated_at": "data ISO"
}
```

## Imgur

Crie uma aplicação no Imgur e informe o Client ID em `IMGUR_CLIENT_ID`. O envio é feito pelo servidor Flask, evitando deixar essa credencial no JavaScript público. Quando uma foto é substituída ou uma máquina é excluída, o aplicativo tenta remover a imagem anterior do Imgur usando o `delete_hash` recebido no upload.

## Publicação na Vercel

1. Envie a pasta do projeto para um repositório Git ou importe-a pelo painel da Vercel.
2. Cadastre em **Settings > Environment Variables**:
   - `APP_USERNAME`
   - `APP_PASSWORD`
   - `SECRET_KEY`
   - `MONGODB_URI`
   - `MONGODB_DB`
   - `IMGUR_CLIENT_ID`
3. Faça o deploy. A Vercel reconhece `app.py` como ponto de entrada do Flask; o arquivo `vercel.json` usa a configuração atual de funções e define o limite de execução em 30 segundos.

Não envie o arquivo `.env` ao repositório. Ele está protegido pelo `.gitignore`.
