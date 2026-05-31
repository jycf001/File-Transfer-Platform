const { state, $, api, bootstrap, toast, formatSize, escapeHtml } = window.JiahaoDrop;

const elements = {
  loadingState: $('#loadingState'),
  fileInfo: $('#fileInfo'),
  errorState: $('#errorState'),
  fileIcon: $('#fileIcon'),
  fileName: $('#fileName'),
  fileMeta: $('#fileMeta'),
  downloadBtn: $('#downloadBtn'),
  errorTitle: $('#errorTitle'),
  errorMsg: $('#errorMsg'),
  otherCodeForm: $('#otherCodeForm'),
  otherCodeInput: $('#otherCodeInput')
};

function fileIconFor(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const icons = {
    pdf: '📕', doc: '📘', docx: '📘', txt: '📝', md: '📝',
    xls: '📊', xlsx: '📊', csv: '📊',
    ppt: '📙', pptx: '📙',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    js: '💻', ts: '💻', py: '💻', java: '💻', html: '💻', css: '💻', json: '💻',
  };
  return icons[ext] || '📄';
}

function showFile(file) {
  elements.loadingState.hidden = true;
  elements.errorState.hidden = true;
  elements.fileInfo.hidden = false;

  elements.fileIcon.textContent = fileIconFor(file.name);
  elements.fileName.textContent = file.name;
  const h = file.retentionHours ?? 48;
  const retention = h === 0 ? '永久保留' : `${h}小时后过期`;
  elements.fileMeta.innerHTML = [
    `发送者 ${escapeHtml(file.owner)}`,
    escapeHtml(formatSize(file.size)),
    escapeHtml(retention),
    escapeHtml(downloadLimitText(file))
  ].map(t => `<span>${t}</span>`).join('');
  elements.downloadBtn.href = `/api/public/files/code/${encodeURIComponent(file.code)}/download`;
}

function downloadLimitText(file) {
  const max = Number(file.maxDownloads || 0);
  const count = Number(file.downloadCount || 0);
  if (max <= 0) return `下载 ${count} 次 · 不限次数`;
  const remaining = Math.max(max - count, 0);
  return `下载 ${count}/${max} 次 · 剩余 ${remaining} 次`;
}

function showError(title, msg) {
  elements.loadingState.hidden = true;
  elements.fileInfo.hidden = true;
  elements.errorState.hidden = false;
  elements.errorTitle.textContent = title;
  elements.errorMsg.textContent = msg || '';
}

async function loadFile(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    showError('请输入接收码');
    return;
  }
  document.title = `${normalized} - JiahaoDrop 接收`;
  elements.loadingState.hidden = false;
  elements.fileInfo.hidden = true;
  elements.errorState.hidden = true;
  try {
    const result = await api(`/api/public/files/code/${encodeURIComponent(normalized)}`);
    showFile(result.file);
  } catch (error) {
    showError('文件不存在或已过期', error.message);
  }
}

function codeFromPath() {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]).trim().toUpperCase() : '';
}

elements.otherCodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = elements.otherCodeInput.value.trim().toUpperCase();
  if (code && /^[A-Z0-9]{6}$/.test(code)) {
    history.pushState({}, '', `/r/${encodeURIComponent(code)}`);
    loadFile(code);
    elements.otherCodeInput.value = '';
  } else {
    toast('接收码格式不正确');
  }
});

window.addEventListener('popstate', () => loadFile(codeFromPath()));

bootstrap().then(() => {
  const code = codeFromPath();
  if (code) loadFile(code);
  else showError('未指定接收码');
}).catch(() => {
  const code = codeFromPath();
  if (code) loadFile(code);
});
