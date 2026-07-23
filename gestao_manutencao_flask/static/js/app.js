(() => {
  "use strict";

  const csrfToken = document.querySelector('meta[name="csrf-token"]').content;
  const machineModal = new bootstrap.Modal(document.getElementById("machineModal"));
  const historyModal = new bootstrap.Modal(document.getElementById("historyModal"));
  const deleteModal = new bootstrap.Modal(document.getElementById("deleteModal"));

  const elements = {
    list: document.getElementById("machineList"),
    empty: document.getElementById("emptyState"),
    resultCount: document.getElementById("resultCount"),
    historyCount: document.getElementById("historyCount"),
    generalHistory: document.getElementById("generalHistory"),
    search: document.getElementById("searchMachine"),
    filter: document.getElementById("statusFilter"),
    form: document.getElementById("machineForm"),
    status: document.getElementById("machineStatus"),
    maintenanceFields: document.getElementById("maintenanceFields"),
    photoFile: document.getElementById("photoFile"),
    photoUpload: document.getElementById("photoUpload"),
    photoPreview: document.getElementById("photoPreview"),
    photoPlaceholder: document.getElementById("photoPlaceholder"),
    uploadProgress: document.getElementById("uploadProgress"),
    removePhotoButton: document.getElementById("btnRemovePhoto"),
    saveButton: document.getElementById("btnSaveMachine"),
  };

  const statusConfig = {
    operando: { label: "Operando", icon: "bi-check-circle-fill" },
    operando_requer_manutencao: { label: "Operando — requer manutenção", icon: "bi-exclamation-triangle-fill" },
    manutencao: { label: "Em manutenção", icon: "bi-tools" },
  };

  let machines = [];
  let machinePendingDelete = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safePhotoUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && ["i.imgur.com", "imgur.com"].includes(url.hostname)) return url.href;
    } catch (_error) {
      return "";
    }
    return "";
  }

  function formatDate(value) {
    if (!value) return "Data não informada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data não informada";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") return "Não informado";
    return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)} h`;
  }

  function plural(count, singular, pluralForm) {
    return `${count} ${count === 1 ? singular : pluralForm}`;
  }

  function shortText(value, maxLength = 105) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
  }

  async function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-CSRF-Token", csrfToken);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      window.location.reload();
      throw new Error("Sessão expirada.");
    }

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a operação.");
    return data;
  }

  function showToast(message, type = "success") {
    const id = `toast-${Date.now()}`;
    const icon = type === "success" ? "bi-check-circle-fill" : "bi-exclamation-circle-fill";
    const toast = document.createElement("div");
    toast.id = id;
    toast.className = `toast align-items-center text-bg-${type} border-0`;
    toast.setAttribute("role", "alert");
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body"><i class="bi ${icon} me-2"></i>${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
      </div>`;
    document.getElementById("toastContainer").appendChild(toast);
    const instance = new bootstrap.Toast(toast, { delay: 3500 });
    toast.addEventListener("hidden.bs.toast", () => toast.remove());
    instance.show();
  }

  function showGlobalError(message) {
    document.getElementById("globalAlert").innerHTML = `
      <div class="alert alert-danger alert-dismissible fade show" role="alert">
        <i class="bi bi-exclamation-circle me-2"></i>${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Fechar"></button>
      </div>`;
  }

  function setLoading(button, isLoading, loadingLabel = "Salvando") {
    const spinner = button.querySelector(".spinner-border");
    const label = button.querySelector(".button-label");
    button.disabled = isLoading;
    if (spinner) spinner.classList.toggle("d-none", !isLoading);
    if (label) label.textContent = isLoading ? loadingLabel : "Salvar máquina";
  }

  async function loadMachines() {
    elements.list.innerHTML = `
      <div class="col-12 text-center py-5 text-secondary">
        <div class="spinner-border text-primary mb-2" role="status"></div>
        <div>Carregando máquinas</div>
      </div>`;
    try {
      machines = await apiFetch("/api/maquinas");
      renderDashboard();
    } catch (error) {
      elements.list.innerHTML = "";
      showGlobalError(error.message);
    }
  }

  function filteredMachines() {
    const term = elements.search.value.trim().toLocaleLowerCase("pt-BR");
    const selectedStatus = elements.filter.value;
    return machines.filter((machine) => {
      const matchesStatus = !selectedStatus || machine.status === selectedStatus;
      const searchable = `${machine.nome || ""} ${machine.operador || ""}`.toLocaleLowerCase("pt-BR");
      return matchesStatus && (!term || searchable.includes(term));
    });
  }

  function maintenanceSummary(machine) {
    if (machine.status === "operando") return "";
    const maintenance = machine.manutencao || {};
    const summary = maintenance.detalhes || maintenance.reparo_campo || maintenance.pedido_pecas;
    if (summary) {
      return `<div class="maintenance-summary"><i class="bi bi-wrench-adjustable me-1"></i>${escapeHtml(shortText(summary))}</div>`;
    }
    return `<div class="maintenance-summary"><i class="bi bi-info-circle me-1"></i>Aguardando detalhes da manutenção.</div>`;
  }

  function machineCard(machine) {
    const config = statusConfig[machine.status] || statusConfig.operando;
    const photo = safePhotoUrl(machine.foto_url);
    const historyLength = (machine.historico || []).length;
    return `
      <div class="col-12 col-md-6 col-xl-4">
        <article class="machine-card">
          <div class="machine-photo">
            ${photo
              ? `<img src="${escapeHtml(photo)}" alt="Foto de ${escapeHtml(machine.nome)}" loading="lazy">`
              : `<div class="machine-photo-placeholder"><i class="bi bi-truck-flatbed"></i></div>`}
            <span class="status-badge status-${escapeHtml(machine.status)}">
              <i class="bi ${config.icon}"></i>${escapeHtml(config.label)}
            </span>
          </div>
          <div class="machine-body">
            <h3>${escapeHtml(machine.nome)}</h3>
            <p class="text-secondary small mb-3">Atualizado em ${escapeHtml(formatDate(machine.updated_at))}</p>
            <div class="machine-meta">
              <div><span>Operador</span><strong title="${escapeHtml(machine.operador || "Não informado")}">${escapeHtml(machine.operador || "Não informado")}</strong></div>
              <div><span>Horímetro</span><strong>${escapeHtml(formatNumber(machine.horimetro))}</strong></div>
            </div>
            ${maintenanceSummary(machine)}
            <div class="d-flex flex-wrap gap-2 mt-3">
              <button class="btn btn-primary btn-sm flex-grow-1" type="button" data-action="edit" data-id="${machine.id}">
                <i class="bi bi-pencil-square me-1"></i>Editar
              </button>
              <button class="btn btn-outline-secondary btn-sm" type="button" data-action="history" data-id="${machine.id}" title="${plural(historyLength, "lançamento", "lançamentos")}">
                <i class="bi bi-clock-history me-1"></i>${historyLength}
              </button>
              <button class="btn btn-outline-danger btn-sm" type="button" data-action="delete" data-id="${machine.id}" aria-label="Excluir ${escapeHtml(machine.nome)}">
                <i class="bi bi-trash3"></i>
              </button>
            </div>
          </div>
        </article>
      </div>`;
  }

  function renderStats() {
    document.getElementById("statTotal").textContent = machines.length;
    document.getElementById("statOperating").textContent = machines.filter((item) => item.status === "operando").length;
    document.getElementById("statAttention").textContent = machines.filter((item) => item.status === "operando_requer_manutencao").length;
    document.getElementById("statMaintenance").textContent = machines.filter((item) => item.status === "manutencao").length;
  }

  function historyItem(entry, machineName = "") {
    return `
      <div class="timeline-item">
        <strong>${machineName ? `${escapeHtml(machineName)} · ` : ""}${escapeHtml(entry.tipo || "Registro")}</strong>
        <p>${escapeHtml(entry.descricao || "Sem descrição.")}</p>
        <time datetime="${escapeHtml(entry.data || "")}">${escapeHtml(formatDate(entry.data))}</time>
      </div>`;
  }

  function renderGeneralHistory() {
    const history = machines
      .flatMap((machine) => (machine.historico || []).map((entry) => ({ ...entry, machineName: machine.nome })))
      .sort((a, b) => new Date(b.data) - new Date(a.data));

    elements.historyCount.textContent = plural(history.length, "lançamento", "lançamentos");
    elements.generalHistory.innerHTML = history.length
      ? history.slice(0, 20).map((entry) => historyItem(entry, entry.machineName)).join("")
      : `<p class="text-secondary mb-0">Ainda não há lançamentos no histórico.</p>`;
  }

  function renderMachineList() {
    const filtered = filteredMachines();
    elements.resultCount.textContent = plural(filtered.length, "registro", "registros");
    elements.list.innerHTML = filtered.map(machineCard).join("");
    elements.empty.classList.toggle("d-none", filtered.length > 0);
  }

  function renderDashboard() {
    renderStats();
    renderMachineList();
    renderGeneralHistory();
  }

  function setPhotoPreview(url) {
    const safeUrl = safePhotoUrl(url);
    elements.photoPreview.src = safeUrl;
    elements.photoPreview.classList.toggle("d-none", !safeUrl);
    elements.photoPlaceholder.classList.toggle("d-none", Boolean(safeUrl));
    elements.removePhotoButton.classList.toggle("d-none", !safeUrl);
  }

  function toggleMaintenanceFields() {
    elements.maintenanceFields.classList.toggle("d-none", elements.status.value === "operando");
  }

  function resetMachineForm() {
    elements.form.reset();
    document.getElementById("machineId").value = "";
    document.getElementById("photoUrl").value = "";
    document.getElementById("photoDeleteHash").value = "";
    document.getElementById("removePhoto").value = "0";
    document.getElementById("machineModalTitle").textContent = "Nova máquina";
    setPhotoPreview("");
    toggleMaintenanceFields();
    setLoading(elements.saveButton, false);
  }

  function fillMachineForm(machine) {
    resetMachineForm();
    const maintenance = machine.manutencao || {};
    document.getElementById("machineId").value = machine.id;
    document.getElementById("machineName").value = machine.nome || "";
    document.getElementById("operatorName").value = machine.operador || "";
    document.getElementById("hourmeter").value = machine.horimetro ?? "";
    elements.status.value = machine.status || "operando";
    document.getElementById("fieldStart").value = maintenance.data_inicio_campo || "";
    document.getElementById("fieldStoppedHours").value = maintenance.horas_parada_campo ?? "";
    document.getElementById("city").value = maintenance.cidade || "";
    document.getElementById("cityStart").value = maintenance.data_inicio_cidade || "";
    document.getElementById("fieldRepair").value = maintenance.reparo_campo || "";
    document.getElementById("maintenanceDetails").value = maintenance.detalhes || "";
    document.getElementById("partsRequest").value = maintenance.pedido_pecas || "";
    document.getElementById("photoUrl").value = machine.foto_url || "";
    document.getElementById("machineModalTitle").textContent = "Editar máquina";
    setPhotoPreview(machine.foto_url || "");
    toggleMaintenanceFields();
  }

  function openNewMachine() {
    resetMachineForm();
    machineModal.show();
  }

  function openEditMachine(id) {
    const machine = machines.find((item) => item.id === id);
    if (!machine) return;
    fillMachineForm(machine);
    machineModal.show();
  }

  async function uploadPhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Selecione um arquivo de imagem válido.", "danger");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("A imagem deve ter no máximo 10 MB.", "danger");
      return;
    }

    elements.uploadProgress.classList.remove("d-none");
    elements.saveButton.disabled = true;
    const formData = new FormData();
    formData.append("image", file);
    formData.append("title", document.getElementById("machineName").value.trim());

    try {
      const result = await apiFetch("/api/upload-image", { method: "POST", body: formData });
      document.getElementById("photoUrl").value = result.url;
      document.getElementById("photoDeleteHash").value = result.delete_hash || "";
      document.getElementById("removePhoto").value = "0";
      setPhotoPreview(result.url);
      showToast("Foto enviada com sucesso.");
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      elements.uploadProgress.classList.add("d-none");
      elements.saveButton.disabled = false;
      elements.photoFile.value = "";
    }
  }

  function machinePayload() {
    return {
      nome: document.getElementById("machineName").value.trim(),
      operador: document.getElementById("operatorName").value.trim(),
      horimetro: document.getElementById("hourmeter").value,
      status: elements.status.value,
      foto_url: document.getElementById("photoUrl").value,
      foto_delete_hash: document.getElementById("photoDeleteHash").value,
      remover_foto: document.getElementById("removePhoto").value === "1",
      historico_descricao: document.getElementById("historyNote").value.trim(),
      manutencao: {
        data_inicio_campo: document.getElementById("fieldStart").value,
        horas_parada_campo: document.getElementById("fieldStoppedHours").value,
        cidade: document.getElementById("city").value.trim(),
        data_inicio_cidade: document.getElementById("cityStart").value,
        reparo_campo: document.getElementById("fieldRepair").value.trim(),
        detalhes: document.getElementById("maintenanceDetails").value.trim(),
        pedido_pecas: document.getElementById("partsRequest").value.trim(),
      },
    };
  }

  async function saveMachine(event) {
    event.preventDefault();
    if (!elements.form.reportValidity()) return;
    const id = document.getElementById("machineId").value;
    const method = id ? "PUT" : "POST";
    const url = id ? `/api/maquinas/${id}` : "/api/maquinas";
    setLoading(elements.saveButton, true);
    try {
      await apiFetch(url, { method, body: JSON.stringify(machinePayload()) });
      machineModal.hide();
      showToast(id ? "Máquina atualizada." : "Máquina cadastrada.");
      await loadMachines();
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      setLoading(elements.saveButton, false);
    }
  }

  function renderMachineHistory(machine) {
    document.getElementById("historyModalTitle").textContent = `Histórico · ${machine.nome}`;
    document.getElementById("historyMachineId").value = machine.id;
    document.getElementById("historyDescription").value = "";
    const history = machine.historico || [];
    document.getElementById("machineHistory").innerHTML = history.length
      ? history.map((entry) => historyItem(entry)).join("")
      : `<p class="text-secondary mb-0">Ainda não há lançamentos para esta máquina.</p>`;
  }

  function openMachineHistory(id) {
    const machine = machines.find((item) => item.id === id);
    if (!machine) return;
    renderMachineHistory(machine);
    historyModal.show();
  }

  async function saveHistory(event) {
    event.preventDefault();
    const id = document.getElementById("historyMachineId").value;
    const description = document.getElementById("historyDescription").value.trim();
    if (!description) return;
    const submitButton = event.submitter;
    submitButton.disabled = true;
    try {
      await apiFetch(`/api/maquinas/${id}/historico`, {
        method: "POST",
        body: JSON.stringify({
          tipo: document.getElementById("historyType").value,
          descricao: description,
        }),
      });
      await loadMachines();
      const machine = machines.find((item) => item.id === id);
      if (machine) renderMachineHistory(machine);
      showToast("Lançamento adicionado.");
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      submitButton.disabled = false;
    }
  }

  function requestDelete(id) {
    machinePendingDelete = machines.find((item) => item.id === id) || null;
    if (!machinePendingDelete) return;
    document.getElementById("deleteModalTitle").textContent = `Excluir ${machinePendingDelete.nome}?`;
    deleteModal.show();
  }

  async function confirmDelete() {
    if (!machinePendingDelete) return;
    const button = document.getElementById("btnConfirmDelete");
    button.disabled = true;
    try {
      await apiFetch(`/api/maquinas/${machinePendingDelete.id}`, { method: "DELETE" });
      deleteModal.hide();
      showToast("Máquina excluída.");
      machinePendingDelete = null;
      await loadMachines();
    } catch (error) {
      showToast(error.message, "danger");
    } finally {
      button.disabled = false;
    }
  }

  document.getElementById("btnNewMachine").addEventListener("click", openNewMachine);
  elements.empty.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="new-machine"]')) openNewMachine();
  });
  elements.form.addEventListener("submit", saveMachine);
  document.getElementById("historyForm").addEventListener("submit", saveHistory);
  document.getElementById("btnConfirmDelete").addEventListener("click", confirmDelete);
  elements.status.addEventListener("change", toggleMaintenanceFields);
  elements.search.addEventListener("input", renderMachineList);
  elements.filter.addEventListener("change", renderMachineList);
  elements.photoFile.addEventListener("change", (event) => uploadPhoto(event.target.files[0]));

  elements.removePhotoButton.addEventListener("click", () => {
    document.getElementById("photoUrl").value = "";
    document.getElementById("photoDeleteHash").value = "";
    document.getElementById("removePhoto").value = "1";
    setPhotoPreview("");
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.photoUpload.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.photoUpload.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    elements.photoUpload.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.photoUpload.classList.remove("dragging");
    });
  });
  elements.photoUpload.addEventListener("drop", (event) => uploadPhoto(event.dataTransfer.files[0]));

  elements.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action][data-id]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "edit") openEditMachine(id);
    if (action === "history") openMachineHistory(id);
    if (action === "delete") requestDelete(id);
  });

  loadMachines();
})();
