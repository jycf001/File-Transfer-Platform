const { $, api, bootstrap, toast, formatSize, escapeHtml } = window.JiahaoDrop;

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
    js: '💻', ts: '💻', py: '💻', java: '💻', html: '💻', css: '💻', json: '💻'
  };
  return icons[ext] || '📄';
}

function downloadLimitText(file) {
  const max = Number(file.maxDownloads || 0);
  const count = Number(file.downloadCount || 0);
  if (max <= 0) return count > 0 ? `已下载 ${count} 次 · 不限` : '不限次数';
  const remaining = Math.max(max - count, 0);
  return `下载 ${count}/${max} 次 · 剩余 ${remaining} 次`;
}

function showFile(file, downloadToken) {
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
  ].map((text) => `<span>${text}</span>`).join('');
  elements.downloadBtn.href = `/api/public/download/${encodeURIComponent(downloadToken)}`;
}

function showError(title, msg = '') {
  elements.loadingState.hidden = true;
  elements.fileInfo.hidden = true;
  elements.errorState.hidden = false;
  elements.errorTitle.textContent = title;
  elements.errorMsg.textContent = msg;
}

function setLoading() {
  elements.loadingState.hidden = false;
  elements.fileInfo.hidden = true;
  elements.errorState.hidden = true;
}

async function loadByCode(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) {
    showError('请输入接收码');
    return;
  }
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    showError('接收码格式不正确', '请输入 6 位字母或数字。');
    return;
  }
  document.title = '接收文件 - JiahaoDrop';
  setLoading();
  try {
    const result = await api('/api/public/files/lookup', {
      method: 'POST',
      body: JSON.stringify({ code: normalized })
    });
    showFile(result.file, result.downloadToken);
  } catch (error) {
    showError('文件不可用', error.message);
  }
}

async function loadByShareToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    showError('分享链接无效');
    return;
  }
  setLoading();
  try {
    const result = await api(`/api/public/share/${encodeURIComponent(normalized)}`);
    showFile(result.file, result.downloadToken);
  } catch (error) {
    showError('文件不可用', error.message);
  }
}

function shareTokenFromPath() {
  const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function pendingCode() {
  try {
    const code = sessionStorage.getItem('jiahaodrop_receive_code') || '';
    sessionStorage.removeItem('jiahaodrop_receive_code');
    return code;
  } catch {
    return '';
  }
}

elements.otherCodeInput.addEventListener('input', () => {
  elements.otherCodeInput.value = elements.otherCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

elements.otherCodeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = elements.otherCodeInput.value.trim().toUpperCase();
  if (code && /^[A-Z0-9]{6}$/.test(code)) {
    history.replaceState({}, '', '/receive');
    loadByCode(code);
    elements.otherCodeInput.value = '';
  } else {
    toast('接收码格式不正确');
  }
});

bootstrap().then(() => {
  const token = shareTokenFromPath();
  if (token) {
    loadByShareToken(token);
    return;
  }
  const code = pendingCode();
  if (code) {
    loadByCode(code);
    return;
  }
  if (window.location.pathname.startsWith('/r/')) {
    showError('请在页面中输入接收码', '为了保护取件码，分享链接不再包含接收码。');
    return;
  }
  showError('请输入接收码');
}).catch(() => {
  showError('加载失败', '无法连接服务器');
});
