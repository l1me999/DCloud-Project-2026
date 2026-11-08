const MAX_SIZE = 20 * 1024 * 1024;
const ALLOWED = new Set([
  "txt", "md", "csv", "json", "pdf", "png", "jpg", "jpeg", "zip", "docx", "xlsx", "bin",
]);

const initialFiles = [
  {
    id: "demo-contract",
    name: "contract-2026.pdf",
    size_bytes: 482301,
    sha256: "a3f1c9e27b4d8a6f0c5e2d7b9a1f4c8e6d3b0a7f2c9e5d1b8a4f6c0e3d7b9a1",
    status: "encrypted",
    chunk_count: 2,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: "demo-backup",
    name: "backup-2026-11.zip",
    size_bytes: 1843200,
    sha256: "b7c2e4d9f1a8c6e3d0b5a7f9c2e4d8b1a6f3c9e0d7b4a2f8c5e1d9b3a7f0c6",
    status: "encrypted",
    chunk_count: 7,
    created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
];

const initialNodes = Array.from({ length: 5 }, (_, index) => ({
  id: `node-${index + 1}`,
  status: "online",
  capacity_bytes: 100 * 1024 * 1024,
  used_bytes: index < 3 ? 1_048_576 : 0,
}));

let files = structuredClone(initialFiles);
let nodes = structuredClone(initialNodes);
let selectedFileId = null;
let pendingFile = null;
let uploadTimer = null;

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

function fakeHash(seed) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  const hex = (value >>> 0).toString(16).padStart(8, "0");
  return (hex.repeat(8)).slice(0, 64);
}

function showToast(message, type = "ok") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 4200);
}

function freeBytes(node) {
  return node.capacity_bytes - node.used_bytes;
}

function renderNodes() {
  $("nodes-list").innerHTML = nodes.map((node) => {
    const offline = node.status !== "online";
    return `
      <div class="node ${offline ? "offline" : ""}">
        <span class="node-dot"></span>
        <div>
          <div class="node-name">${escapeHtml(node.id)}</div>
          <div class="node-sub">${offline ? "offline" : "online"} · свободно ${formatBytes(freeBytes(node))}</div>
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
  return files.filter((file) => {
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
  const visible = filteredFiles();
  $("files-count").textContent = pluralFiles(files.length);
  const list = $("files-list");
  const empty = $("empty-state");

  if (files.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  if (visible.length === 0) {
    list.innerHTML = `<p class="hint">Ничего не найдено. Измените запрос или сбросьте фильтр.</p>`;
    return;
  }
  list.innerHTML = visible.map(fileCard).join("");
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

function handleSelectedFile(file) {
  pendingFile = file;
  showFileMeta(file);
  const error = validateFile(file);
  setUploadError(error);
  $("upload-btn").disabled = Boolean(error);
}

function resetUpload() {
  window.clearInterval(uploadTimer);
  uploadTimer = null;
  pendingFile = null;
  $("file-input").value = "";
  showFileMeta(null);
  $("progress-wrap").classList.add("hidden");
  $("progress-bar").style.width = "0%";
  $("progress-label").textContent = "0%";
  $("upload-btn").disabled = true;
  $("cancel-btn").classList.add("hidden");
}

function submitUpload(event) {
  event.preventDefault();
  const file = pendingFile || $("file-input").files[0];
  const error = validateFile(file);
  if (error) {
    setUploadError(error);
    return;
  }
  setUploadError(null);
  $("upload-btn").disabled = true;
  $("cancel-btn").classList.remove("hidden");
  $("progress-wrap").classList.remove("hidden");
  let progress = 0;
  $("progress-bar").style.width = "0%";
  $("progress-label").textContent = "0%";

  uploadTimer = window.setInterval(() => {
    progress = Math.min(100, progress + 17);
    $("progress-bar").style.width = `${progress}%`;
    $("progress-label").textContent = `${progress}%`;
    if (progress < 100) return;

    window.clearInterval(uploadTimer);
    uploadTimer = null;
    const id = `demo-${Date.now()}`;
    files.unshift({
      id,
      name: file.name,
      size_bytes: file.size,
      sha256: fakeHash(`${file.name}-${Date.now()}`),
      status: "encrypted",
      chunk_count: Math.max(1, Math.ceil(file.size / (256 * 1024))),
      created_at: new Date().toISOString(),
    });
    resetUpload();
    renderFiles();
    showToast("Файл загружен. В демо-режиме данные хранятся только в браузере.", "ok");
  }, 90);
}

function chunksFor(file) {
  const count = Math.max(1, file.chunk_count);
  return Array.from({ length: count }, (_, idx) => {
    const replicas = [0, 1, 2].map((offset) => {
      const node = nodes[(idx + offset) % nodes.length];
      return {
        node_id: node.id,
        status: node.status,
        available: node.status === "online",
      };
    });
    return {
      idx,
      size_bytes: idx === count - 1 ? Math.max(1024, file.size_bytes % (256 * 1024) || 1024) : 256 * 1024,
      sha256: fakeHash(`${file.id}-${idx}`),
      replicas,
    };
  });
}

function replicaBadge(replica) {
  if (replica.available) {
    return `<span class="replica" title="Реплика доступна">${escapeHtml(replica.node_id)}</span>`;
  }
  return `<span class="replica offline" title="Реплика недоступна">${escapeHtml(replica.node_id)} · offline</span>`;
}

function openDetails(id) {
  const file = files.find((item) => item.id === id);
  if (!file) return;
  selectedFileId = id;
  $("details-title").textContent = file.name;
  $("details-summary").innerHTML = `
    <span>Размер: <strong>${formatBytes(file.size_bytes)}</strong></span>
    <span>Фрагментов: <strong>${file.chunk_count}</strong></span>
    <span>Статус: <strong>${escapeHtml(file.status)}</strong></span>
    <span>SHA-256: <code>${escapeHtml(file.sha256)}</code></span>
  `;
  $("chunks-body").innerHTML = chunksFor(file).map((chunk) => `
    <tr>
      <td>${chunk.idx}</td>
      <td>${formatBytes(chunk.size_bytes)}</td>
      <td><code>${shortHash(chunk.sha256)}</code></td>
      <td><div class="replica-list">${chunk.replicas.map(replicaBadge).join("")}</div></td>
    </tr>
  `).join("");
  $("details-modal").classList.remove("hidden");
}

function closeDetails() {
  selectedFileId = null;
  $("details-modal").classList.add("hidden");
}

function deleteFile(id) {
  const file = files.find((item) => item.id === id);
  if (!file) return;
  if (!window.confirm(`Удалить «${file.name}» и все его фрагменты?`)) return;
  files = files.filter((item) => item.id !== id);
  renderFiles();
  showToast("Файл и его фрагменты удалены (демо).", "ok");
}

function toggleNode(id) {
  const node = nodes.find((item) => item.id === id);
  if (!node) return;
  node.status = node.status === "online" ? "offline" : "online";
  renderNodes();
  if (selectedFileId) openDetails(selectedFileId);
  showToast(`Узел ${id}: ${node.status}.`, "ok");
}

function resetDemo() {
  files = structuredClone(initialFiles);
  nodes = structuredClone(initialNodes);
  pendingFile = null;
  closeDetails();
  resetUpload();
  renderFiles();
  renderNodes();
  showToast("Демо-данные восстановлены.", "ok");
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
    window.clearInterval(uploadTimer);
    uploadTimer = null;
    resetUpload();
    showToast("Загрузка отменена.", "ok");
  });
  $("refresh-nodes").addEventListener("click", () => {
    renderNodes();
    showToast("Статусы узлов обновлены.", "ok");
  });
  $("reset-demo").addEventListener("click", resetDemo);
  $("empty-upload").addEventListener("click", () => input.click());

  $("files-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "download") showToast("В статической демо-версии скачивание имитируется.", "ok");
    if (action === "details") openDetails(id);
    if (action === "delete") deleteFile(id);
  });

  $("nodes-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-node-id]");
    if (!button) return;
    toggleNode(button.dataset.nodeId);
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
renderFiles();
renderNodes();
