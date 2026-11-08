const API = {
  health: "/api/health",
  files: "/api/files",
  nodes: "/api/nodes",
};

const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "txt", "md", "csv", "json", "pdf", "png", "jpg", "jpeg", "zip", "docx", "xlsx", "bin",
]);

const state = {
  files: [],
  nodes: [],
  selectedFileId: null,
  pendingFile: null,
  uploadXhr: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 10)}…` : "—";
}

function pluralFiles(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} файл`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} файла`;
  return `${count} файлов`;
}

async function readError(response) {
  try {
    const data = await response.json();
    if (data && data.detail) return data.detail;
  } catch (_) {
    // ignore
  }
  return `HTTP ${response.status}`;
}

async function request(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return null;
  return response.json();
}

function showToast(message, type = "ok") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
}

function setApiStatus(ok, text) {
  const pill = $("api-status");
  pill.dataset.state = ok ? "ok" : "error";
  $("api-status-text").textContent = text;
}

async function loadHealth() {
  try {
    const data = await request(API.health);
    setApiStatus(true, `API ${data.status}`);
  } catch (error) {
    setApiStatus(false, "API недоступен");
  }
}

async function loadFiles() {
  try {
    state.files = await request(API.files);
    renderFiles();
    $("files-error").classList.add("hidden");
  } catch (error) {
    $("files-error").textContent = `Не удалось загрузить список: ${error.message}`;
    $("files-error").classList.remove("hidden");
  }
}

async function loadNodes() {
  try {
    state.nodes = await request(API.nodes);
    renderNodes();
  } catch (error) {
    $("nodes-list").innerHTML = `<div class="error">Не удалось загрузить узлы: ${escapeHtml(error.message)}</div>`;
  }
}

function renderNodes() {
  const container = $("nodes-list");
  if (!state.nodes.length) {
    container.innerHTML = `<p class="hint">Узлы не найдены.</p>`;
    return;
  }
  container.innerHTML = state.nodes.map((node) => {
    const offline = node.status !== "online";
    return `
      <div class="node ${offline ? "offline" : ""}">
        <span class="node-dot"></span>
        <div>
          <div class="node-name">${escapeHtml(node.id)}</div>
          <div class="node-sub">${offline ? "offline" : "online"} · свободно ${formatBytes(node.free_bytes)}</div>
        </div>
        <button class="node-toggle" data-node-id="${escapeHtml(node.id)}" data-status="${offline ? "online" : "offline"}">
          ${offline ? "Включить" : "Отключить"}
        </button>
      </div>
    `;
  }).join("");
}

function filteredFiles() {
  const query = $("search").value.trim().toLowerCase();
  const status = $("filter-status").value;
  return state.files.filter((file) => {
    const matchesQuery = !query || file.name.toLowerCase().includes(query);
    const matchesStatus = status === "all" || file.status === status;
    return matchesQuery && matchesStatus;
  });
}

function fileCard(file) {
  return `
    <article class="file-card">
      <div>
        <p class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</p>
        <div class="file-meta-line">
          <span>${formatBytes(file.size_bytes)}</span>
          <span>${formatDate(file.created_at)}</span>
          <span>${file.chunk_count} фрагментов</span>
          <span class="badge">${escapeHtml(file.status)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button type="button" data-action="download" data-id="${file.id}">Скачать</button>
        <button type="button" data-action="details" data-id="${file.id}">Карта</button>
        <button type="button" class="danger" data-action="delete" data-id="${file.id}">Удалить</button>
      </div>
    </article>
  `;
}

function renderFiles() {
  const files = filteredFiles();
  const list = $("files-list");
  const empty = $("empty-state");
  $("files-count").textContent = pluralFiles(state.files.length);

  if (state.files.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  if (files.length === 0) {
    list.innerHTML = `<p class="hint">Ничего не найдено. Измените запрос или сбросьте фильтр.</p>`;
    return;
  }
  list.innerHTML = files.map(fileCard).join("");
}

function validateFile(file) {
  if (!file) return "Выберите файл.";
  if (file.size <= 0) return "Файл пустой.";
  if (file.size > MAX_SIZE) return "Файл больше 20 МБ.";
  const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  if (!ALLOWED.has(extension)) return `Неподдерживаемый тип файла: .${extension || "без расширения"}`;
  return null;
}

function setUploadError(message) {
  const box = $("upload-error");
  if (!message) {
    box.textContent = "";
    box.classList.add("hidden");
    return;
  }
  box.textContent = message;
  box.classList.remove("hidden");
}

function showFileMeta(file) {
  const meta = $("file-meta");
  if (!file) {
    meta.classList.add("hidden");
    return;
  }
  $("file-name").textContent = file.name;
  $("file-size").textContent = formatBytes(file.size);
  meta.classList.remove("hidden");
}

function resetUpload(keepFile = false) {
  state.uploadXhr = null;
  if (!keepFile) {
    state.pendingFile = null;
    $("file-input").value = "";
    showFileMeta(null);
  }
  $("progress-wrap").classList.add("hidden");
  $("progress-bar").style.width = "0%";
  $("progress-label").textContent = "0%";
  $("upload-btn").disabled = keepFile ? false : true;
  $("cancel-btn").classList.add("hidden");
}

function handleSelectedFile(file) {
  state.pendingFile = file;
  showFileMeta(file);
  const error = validateFile(file);
  setUploadError(error);
  $("upload-btn").disabled = Boolean(error);
}

function uploadWithProgress(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    state.uploadXhr = xhr;
    xhr.open("POST", API.files);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      $("progress-bar").style.width = `${percent}%`;
      $("progress-label").textContent = `${percent}%`;
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (error) {
          resolve({});
        }
        return;
      }
      let detail = `HTTP ${xhr.status}`;
      try {
        detail = JSON.parse(xhr.responseText).detail || detail;
      } catch (_) {
        // ignore
      }
      reject(new Error(detail));
    });

    xhr.addEventListener("error", () => reject(new Error("Сеть недоступна.")));
    xhr.addEventListener("abort", () => reject(new Error("aborted")));

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

async function submitUpload(event) {
  event.preventDefault();
  const file = state.pendingFile || $("file-input").files[0];
  const error = validateFile(file);
  if (error) {
    setUploadError(error);
    return;
  }

  setUploadError(null);
  $("upload-btn").disabled = true;
  $("cancel-btn").classList.remove("hidden");
  $("progress-wrap").classList.remove("hidden");
  $("progress-bar").style.width = "0%";
  $("progress-label").textContent = "0%";

  try {
    await uploadWithProgress(file);
    showToast("Файл загружен, зашифрован и разложен на реплики.", "ok");
    resetUpload();
    await Promise.all([loadFiles(), loadNodes()]);
  } catch (uploadError) {
    if (uploadError.message === "aborted") {
      showToast("Загрузка отменена.", "ok");
      resetUpload();
      return;
    }
    setUploadError(`Ошибка загрузки: ${uploadError.message}`);
    $("upload-btn").disabled = false;
    $("cancel-btn").classList.add("hidden");
    $("progress-wrap").classList.add("hidden");
  }
}

async function downloadFile(id) {
  try {
    const response = await fetch(`${API.files}/${id}/download`);
    if (!response.ok) throw new Error(await readError(response));
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
    const filename = match ? decodeURIComponent(match[1]) : "file";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Файл скачан. SHA-256 проверен.", "ok");
  } catch (error) {
    showToast(`Не удалось скачать: ${error.message}`, "error");
  }
}

async function deleteFile(id) {
  const file = state.files.find((item) => item.id === id);
  if (!file) return;
  if (!window.confirm(`Удалить «${file.name}» и все его фрагменты?`)) return;
  try {
    await request(`${API.files}/${id}`, { method: "DELETE" });
    showToast("Файл и его фрагменты удалены.", "ok");
    await Promise.all([loadFiles(), loadNodes()]);
  } catch (error) {
    showToast(`Не удалось удалить: ${error.message}`, "error");
  }
}

function replicaBadge(replica) {
  if (replica.available) {
    return `<span class="replica" title="Реплика доступна">${escapeHtml(replica.node_id)}</span>`;
  }
  const reason = replica.status === "online" ? "нет файла" : "offline";
  return `<span class="replica offline" title="Реплика недоступна">${escapeHtml(replica.node_id)} · ${reason}</span>`;
}

async function openDetails(id) {
  const file = state.files.find((item) => item.id === id);
  if (!file) return;
  try {
    const data = await request(`${API.files}/${id}/chunks`);
    state.selectedFileId = id;
    $("details-title").textContent = file.name;
    $("details-summary").innerHTML = `
      <span>Размер: <strong>${formatBytes(file.size_bytes)}</strong></span>
      <span>Фрагментов: <strong>${file.chunk_count}</strong></span>
      <span>Статус: <strong>${escapeHtml(file.status)}</strong></span>
      <span>SHA-256: <code>${escapeHtml(file.sha256)}</code></span>
    `;
    $("chunks-body").innerHTML = data.chunks.map((chunk) => `
      <tr>
        <td>${chunk.idx}</td>
        <td>${formatBytes(chunk.size_bytes)}</td>
        <td><code>${shortHash(chunk.sha256)}</code></td>
        <td><div class="replica-list">${chunk.replicas.map(replicaBadge).join("")}</div></td>
      </tr>
    `).join("");
    $("details-modal").classList.remove("hidden");
  } catch (error) {
    showToast(`Не удалось открыть карту: ${error.message}`, "error");
  }
}

function closeDetails() {
  state.selectedFileId = null;
  $("details-modal").classList.add("hidden");
}

async function toggleNode(nodeId, status) {
  try {
    await request(`${API.nodes}/${nodeId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadNodes();
    if (state.selectedFileId) await openDetails(state.selectedFileId);
    showToast(`Узел ${nodeId}: ${status}.`, "ok");
  } catch (error) {
    showToast(`Не удалось изменить узел: ${error.message}`, "error");
  }
}

function bindEvents() {
  const input = $("file-input");
  const dropZone = $("drop-zone");

  input.addEventListener("change", () => handleSelectedFile(input.files[0]));

  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });
  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file) handleSelectedFile(file);
  });

  $("upload-form").addEventListener("submit", submitUpload);
  $("cancel-btn").addEventListener("click", () => {
    if (state.uploadXhr) state.uploadXhr.abort();
  });
  $("refresh-nodes").addEventListener("click", loadNodes);
  $("empty-upload").addEventListener("click", () => input.click());

  $("files-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "download") downloadFile(id);
    if (action === "details") openDetails(id);
    if (action === "delete") deleteFile(id);
  });

  $("nodes-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-node-id]");
    if (!button) return;
    toggleNode(button.dataset.nodeId, button.dataset.status);
  });

  $("search").addEventListener("input", renderFiles);
  $("filter-status").addEventListener("change", renderFiles);
  $("details-close").addEventListener("click", closeDetails);
  $("details-modal").addEventListener("click", (event) => {
    if (event.target === $("details-modal")) closeDetails();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("details-modal").classList.contains("hidden")) closeDetails();
  });
}

bindEvents();
loadHealth();
loadFiles();
loadNodes();
window.setInterval(loadNodes, 15000);
