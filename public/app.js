const {
  state,
  $,
  $$,
  api,
  bootstrap,
  logout,
  toast,
  formatSize,
  formatDate,
  escapeHtml,
  sanitizeSvg,
  clipboardWrite,
  startSessionHeartbeat
} = window.JiahaoDrop;

const elements = {
  appView: $('#appView'),
  welcomeText: $('#welcomeText'),
  avatar: $('#avatar'),
  accountBadge: $('#accountBadge'),
  logoutBtn: $('#logoutBtn'),
  dropZone: $('#dropZone'),
  fileInput: $('#fileInput'),
  pickBtn: $('#pickBtn'),
  uploadBtn: $('#uploadBtn'),
  selectedList: $('#selectedList'),
  retentionRow: $('#retentionRow'),
  retentionSelect: $('#retentionSelect'),
  maxDownloadsInput: $('#maxDownloadsInput'),
  uploadResults: $('#uploadResults'),
  toggleUploadResultsBtn: $('#toggleUploadResultsBtn'),
  uploadLimit: $('#uploadLimit'),
  codeForm: $('#codeForm'),
  codeInput: $('#codeInput'),
  codeError: $('#codeError'),
  codeResult: $('#codeResult'),
  refreshFilesBtn: $('#refreshFilesBtn'),
  fileList: $('#fileList'),
  accountAvatar: $('#accountAvatar'),
  accountUsername: $('#accountUsername'),
  accountRole: $('#accountRole'),
  currentEmail: $('#currentEmail'),
  changeEmailBtn: $('#changeEmailBtn'),
  emailChangeForm: $('#emailChangeForm'),
  newEmailInput: $('#newEmailInput'),
  accountCaptchaQuestion: $('#accountCaptchaQuestion'),
  accountCaptchaInput: $('#accountCaptchaInput'),
  accountRefreshCaptchaBtn: $('#accountRefreshCaptchaBtn'),
  emailChangeCodeLabel: $('#emailChangeCodeLabel'),
  emailChangeCodeInput: $('#emailChangeCodeInput'),
  emailChangeHint: $('#emailChangeHint'),
  submitEmailChangeBtn: $('#submitEmailChangeBtn'),
  cancelEmailChangeBtn: $('#cancelEmailChangeBtn')
};

state.selectedFiles = [];
state.recentUploads = [];
state.uploadResultsExpanded = false;

function initials(username) {
  const text = String(username || 'J').trim();
  return text.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  if (role === 'super_admin') return '超级管理员';
  if (role === 'admin') return '管理员';
  return '用户';
}

function paintAvatar(username) {
  const text = String(username || 'jiahao');
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) % 360;
  elements.avatar.style.setProperty('--avatar-a', `hsl(${seed} 82% 48%)`);
  elements.avatar.style.setProperty('--avatar-b', `hsl(${(seed + 42) % 360} 78% 55%)`);
  elements.avatar.style.setProperty('--avatar-c', `hsl(${(seed + 108) % 360} 70% 42%)`);
}

function modeFromPath() {
  if (window.location.pathname.endsWith('/receive')) return 'receive';
  if (window.location.pathname.endsWith('/files')) return 'files';
  return 'send';
}

function setMode(mode, push = true) {
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${mode}View`));
  const route = $(`.nav-btn[data-view="${mode}"]`)?.dataset.route || '/app/send';
  if (push && window.location.pathname !== route) history.pushState({ mode }, '', route);
  if (mode === 'send') loadRecentUploads();
  if (mode === 'files') loadFiles();
  if (mode === 'account') renderAccount();
}

function syncRetentionOptions() {
  if (!elements.retentionSelect) return;
  const defaultHours = Number(state.limits.retentionHours || 48);
  const existing = Array.from(elements.retentionSelect.options).some((option) => Number(option.value) === defaultHours);
  if (!existing) {
    const option = document.createElement('option');
    option.value = String(defaultHours);
    option.textContent = `${defaultHours} 小时（默认）`;
    elements.retentionSelect.prepend(option);
  }
  Array.from(elements.retentionSelect.options).forEach((option) => {
    const hours = Number(option.value);
    option.textContent = hours === defaultHours ? `${hours} 小时（默认）` : `${hours} 小时`;
  });
  elements.retentionSelect.value = String(defaultHours);
}

function renderApp() {
  elements.appView.hidden = false;
  elements.avatar.textContent = initials(state.user.username);
  paintAvatar(state.user.username);
  elements.accountBadge.textContent = `${state.user.username} · ${roleLabel(state.user.role)}`;
  elements.welcomeText.textContent = `${state.user.username}，文件将在 ${state.limits.retentionHours} 小时后自动删除`;
  elements.uploadLimit.textContent = `单文件最大 ${state.limits.maxFileSizeMb} MB，一次最多 ${state.limits.maxFilesPerUpload} 个文件`;
  syncRetentionOptions();
  $$('.admin-only').forEach((node) => {
    node.hidden = state.user.role !== 'admin' && state.user.role !== 'super_admin';
  });
  setMode(modeFromPath(), false);
}

elements.logoutBtn.addEventListener('click', async () => {
  await logout();
  window.location.replace('/');
});

$$('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.view));
});

window.addEventListener('popstate', () => setMode(modeFromPath(), false));

elements.pickBtn.addEventListener('click', () => elements.fileInput.click());
elements.dropZone.addEventListener('click', (event) => {
  if (event.target === elements.dropZone) elements.fileInput.click();
});

elements.fileInput.addEventListener('change', () => {
  state.selectedFiles = Array.from(elements.fileInput.files || []);
  renderSelectedFiles();
});

['dragenter', 'dragover'].forEach((name) => {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((name) => {
  elements.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
});

elements.dropZone.addEventListener('drop', (event) => {
  state.selectedFiles = Array.from(event.dataTransfer.files || []);
  elements.fileInput.value = '';
  renderSelectedFiles();
});

function renderSelectedFiles() {
  const files = state.selectedFiles;
  const maxFiles = Math.max(1, Number(state.limits.maxFilesPerUpload || 10));
  const tooMany = files.length > maxFiles;
  elements.uploadBtn.disabled = files.length === 0 || tooMany;
  elements.uploadBtn.hidden = files.length === 0;
  elements.selectedList.hidden = files.length === 0;
  elements.retentionRow.hidden = files.length === 0;
  if (files.length === 0) {
    elements.selectedList.innerHTML = '';
    return;
  }
  const warningHtml = tooMany
    ? `<div class="item warning"><div><h3>文件数量超过限制</h3><div class="meta">当前选择 ${escapeHtml(files.length)} 个，单次最多 ${escapeHtml(maxFiles)} 个，请移除多余文件。</div></div></div>`
    : '';
  elements.selectedList.innerHTML = warningHtml + files.map((file, index) => `
    <div class="item">
      <div>
        <h3>${escapeHtml(file.name)}</h3>
        <div class="meta">${formatSize(file.size)}</div>
      </div>
      <div class="actions">
        <button class="small-btn danger" data-remove-selected="${index}" type="button">移除</button>
      </div>
    </div>
  `).join('');
}

function maxDownloadsValue() {
  const value = Number(elements.maxDownloadsInput?.value || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function downloadLimitText(file) {
  const max = Number(file.maxDownloads || 0);
  const count = Number(file.downloadCount || 0);
  if (max <= 0) return `下载 ${count} 次 · 不限次数`;
  const remaining = Math.max(max - count, 0);
  return `下载 ${count}/${max} 次 · 剩余 ${remaining} 次`;
}

elements.uploadBtn.addEventListener('click', async () => {
  if (state.selectedFiles.length === 0) return;
  const maxFiles = Math.max(1, Number(state.limits.maxFilesPerUpload || 10));
  if (state.selectedFiles.length > maxFiles) {
    toast(`单次最多上传 ${maxFiles} 个文件`);
    renderSelectedFiles();
    return;
  }
  if (state.storageQuotaMb > 0) {
    const incomingBytes = state.selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const quotaBytes = state.storageQuotaMb * 1024 * 1024;
    if (state.storageUsedBytes + incomingBytes > quotaBytes) {
      toast(`存储空间不足，已用 ${formatSize(state.storageUsedBytes)} / ${formatSize(quotaBytes)}`);
      return;
    }
  }
  const formData = new FormData();
  state.selectedFiles.forEach((file) => formData.append('files', file));
  formData.append('retentionHours', elements.retentionSelect.value);
  formData.append('maxDownloads', String(maxDownloadsValue()));
  elements.uploadBtn.disabled = true;
  elements.uploadBtn.textContent = '上传中...';
  try {
    await api('/api/files', { method: 'POST', body: formData });
    state.storageUsedBytes += state.selectedFiles.reduce((sum, file) => sum + file.size, 0);
    state.selectedFiles = [];
    elements.fileInput.value = '';
    renderSelectedFiles();
    await loadRecentUploads();
    toast('上传完成');
  } catch (error) {
    toast(error.message);
  } finally {
    elements.uploadBtn.disabled = state.selectedFiles.length === 0;
    elements.uploadBtn.textContent = '开始上传';
  }
});

function renderUploadResults(files = state.recentUploads) {
  state.recentUploads = Array.isArray(files) ? files : [];
  const total = state.recentUploads.length;
  const hasMore = total > 2;
  if (elements.toggleUploadResultsBtn) {
    elements.toggleUploadResultsBtn.hidden = !hasMore;
    elements.toggleUploadResultsBtn.textContent = state.uploadResultsExpanded ? '收起列表' : `展开全部（${total}）`;
    elements.toggleUploadResultsBtn.setAttribute('aria-expanded', String(state.uploadResultsExpanded));
  }
  const visible = state.uploadResultsExpanded || !hasMore ? state.recentUploads : state.recentUploads.slice(0, 2);
  if (visible.length === 0) {
    elements.uploadResults.innerHTML = '<div class="item"><div><h3>暂无已上传文件</h3><div class="meta">上传后会在这里显示最近文件。</div></div></div>';
    return;
  }
  elements.uploadResults.innerHTML = visible.map((file) => {
    const shareUrl = file.shareUrl || `${state.publicBaseUrl}/r/${encodeURIComponent(file.code)}`;
    const retention = file.retentionHours || 48;
    return `
      <div class="item">
        <div>
          <h3>${escapeHtml(file.name)}</h3>
          <div class="meta">接收码 <span class="badge">${escapeHtml(file.code)}</span> · ${escapeHtml(formatSize(file.size))} · ${escapeHtml(retention)}小时后过期 · ${escapeHtml(downloadLimitText(file))}</div>
          <div class="meta share-line">${escapeHtml(shareUrl)}</div>
        </div>
        <div class="actions">
          <button class="small-btn" data-copy="${escapeHtml(file.code)}" type="button">复制接收码</button>
          <button class="small-btn" data-copy="${escapeHtml(shareUrl)}" type="button">复制链接</button>
          <a class="small-btn" href="/api/public/files/code/${encodeURIComponent(file.code)}/download">下载</a>
          <button class="small-btn danger" data-delete-upload="${escapeHtml(file.id)}" type="button">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

async function loadRecentUploads() {
  try {
    const result = await api('/api/files');
    if (state.uploadResultsExpanded && result.files.length <= 2) {
      state.uploadResultsExpanded = false;
    }
    renderUploadResults(result.files);
  } catch (error) {
    elements.uploadResults.innerHTML = '<div class="item"><div><h3>最近文件加载失败</h3><div class="meta">请稍后重试。</div></div></div>';
  }
}

if (elements.toggleUploadResultsBtn) {
  elements.toggleUploadResultsBtn.addEventListener('click', () => {
    state.uploadResultsExpanded = !state.uploadResultsExpanded;
    renderUploadResults();
  });
}

elements.codeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = elements.codeInput.value.trim().toUpperCase();
  elements.codeError.hidden = true;
  elements.codeInput.setCustomValidity('');
  if (!code) {
    elements.codeError.textContent = '请输入接收码';
    elements.codeError.hidden = false;
    elements.codeInput.setCustomValidity('请输入接收码');
    elements.codeInput.reportValidity();
    return;
  }
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    elements.codeError.textContent = '接收码格式不正确';
    elements.codeError.hidden = false;
    elements.codeInput.setCustomValidity('接收码格式不正确');
    elements.codeInput.reportValidity();
    return;
  }
  try {
    const result = await api(`/api/public/files/code/${encodeURIComponent(code)}`);
    const file = result.file;
    elements.codeResult.innerHTML = `
      <div class="item">
        <div>
          <h3>${escapeHtml(file.name)}</h3>
          <div class="meta">发送者 ${escapeHtml(file.owner)} · ${escapeHtml(formatSize(file.size))} · ${escapeHtml(file.retentionHours || 48)}小时后过期 · ${escapeHtml(downloadLimitText(file))}</div>
        </div>
        <div class="actions">
          <a class="small-btn" href="/api/public/files/code/${encodeURIComponent(file.code)}/download">下载</a>
        </div>
      </div>
    `;
  } catch (error) {
    elements.codeResult.innerHTML = '';
    toast(error.message);
  }
});

async function loadFiles() {
  try {
    const result = await api('/api/files');
    if (result.files.length === 0) {
      elements.fileList.innerHTML = '<div class="item"><div><h3>还没有文件</h3><div class="meta">上传后会显示接收码和过期时间。</div></div></div>';
      return;
    }
    elements.fileList.innerHTML = result.files.map((file) => {
      const shareUrl = file.shareUrl || `${state.publicBaseUrl}/r/${encodeURIComponent(file.code)}`;
      const retention = file.retentionHours || 48;
      return `
        <div class="item">
          <div>
            <h3>${escapeHtml(file.name)}</h3>
            <div class="meta">接收码 <span class="badge">${escapeHtml(file.code)}</span> · ${escapeHtml(formatSize(file.size))} · ${escapeHtml(retention)}小时后过期 · <span class="dl-count">${escapeHtml(downloadLimitText(file))}</span></div>
            <div class="meta share-line">${escapeHtml(shareUrl)}</div>
          </div>
          <div class="actions">
            <button class="small-btn" data-copy="${escapeHtml(file.code)}" type="button">复制接收码</button>
            <button class="small-btn" data-copy="${escapeHtml(shareUrl)}" type="button">复制链接</button>
            <a class="small-btn" href="/api/public/files/code/${encodeURIComponent(file.code)}/download">下载</a>
            <button class="small-btn" data-file-manage="${escapeHtml(file.id)}" type="button">设置</button>
            <button class="small-btn" data-file-detail="${escapeHtml(file.id)}" type="button">详情</button>
            <button class="small-btn danger" data-delete-file="${escapeHtml(file.id)}" type="button">删除</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    toast(error.message);
  }
}

function showFileDetail(file) {
  const log = file.downloadLog || [];
  const logHtml = log.length === 0
    ? '<p class="meta">暂无下载记录</p>'
    : `<div class="download-log">
        <div class="log-header"><span>时间</span><span>IP 地址</span></div>
        ${log.map((entry) => `
          <div class="log-entry">
            <span>${escapeHtml(formatDate(entry.at))}</span>
            <code>${escapeHtml(entry.ip || '-')}</code>
          </div>
        `).join('')}</div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h3>${escapeHtml(file.name)}</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-meta">
        <span>接收码 <strong>${escapeHtml(file.code)}</strong></span>
        <span>${escapeHtml(formatSize(file.size))}</span>
        <span>${escapeHtml(file.retentionHours || 48)}小时后过期</span>
        <span>${escapeHtml(downloadLimitText(file))}</span>
      </div>
      <h4>下载记录</h4>
      ${logHtml}
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close')) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function showFileManage(file) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h3>管理 ${escapeHtml(file.name)}</h3>
        <button class="modal-close" type="button">&times;</button>
      </div>
      <div class="modal-meta">
        <span>接收码 <strong>${escapeHtml(file.code)}</strong></span>
        <span>${escapeHtml(downloadLimitText(file))}</span>
      </div>
      <form class="file-manage-form">
        <label>
          有效期
          <select name="retentionHours">
            <option value="48">从现在起 48 小时</option>
            <option value="24">从现在起 24 小时</option>
            <option value="16">从现在起 16 小时</option>
            <option value="8">从现在起 8 小时</option>
            <option value="4">从现在起 4 小时</option>
            <option value="2">从现在起 2 小时</option>
            <option value="1">从现在起 1 小时</option>
          </select>
        </label>
        <label>
          下载次数
          <input name="maxDownloads" type="number" min="0" max="100000" step="1" value="${Number(file.maxDownloads || 0)}" placeholder="0 表示不限">
        </label>
        <p class="form-hint">保存后有效期会从当前时间重新计算，下载次数填 0 表示不限。</p>
        <div class="actions left">
          <button class="primary" type="submit">保存</button>
          <button class="small-btn modal-close" type="button">取消</button>
        </div>
      </form>
    </div>
  `;
  const select = overlay.querySelector('select[name="retentionHours"]');
  if (select) select.value = String(file.retentionHours || 48);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close')) overlay.remove();
  });
  overlay.querySelector('.file-manage-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          retentionHours: form.get('retentionHours'),
          maxDownloads: Number(form.get('maxDownloads') || 0)
        })
      });
      toast('文件设置已更新');
      overlay.remove();
      loadFiles();
    } catch (error) {
      toast(error.message);
    }
  });
  document.body.appendChild(overlay);
}

elements.refreshFilesBtn.addEventListener('click', loadFiles);

document.addEventListener('click', async (event) => {
  const removeSelected = event.target.closest('[data-remove-selected]');
  if (removeSelected) {
    const index = Number(removeSelected.dataset.removeSelected);
    if (Number.isInteger(index) && index >= 0 && index < state.selectedFiles.length) state.selectedFiles.splice(index, 1);
    renderSelectedFiles();
    return;
  }

  const copy = event.target.closest('[data-copy]');
  if (copy) {
    try {
      await clipboardWrite(copy.dataset.copy);
      toast('已复制');
    } catch {
      toast('复制失败，请手动复制');
    }
  }

  const fileDetail = event.target.closest('[data-file-detail]');
  if (fileDetail) {
    try {
      const result = await api(`/api/files/${fileDetail.dataset.fileDetail}`);
      showFileDetail(result.file);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const fileManage = event.target.closest('[data-file-manage]');
  if (fileManage) {
    try {
      const result = await api(`/api/files/${fileManage.dataset.fileManage}`);
      showFileManage(result.file);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const deleteFile = event.target.closest('[data-delete-file]');
  if (deleteFile && confirm('确定删除这个文件吗？')) {
    try {
      await api(`/api/files/${deleteFile.dataset.deleteFile}`, { method: 'DELETE' });
      toast('文件已删除');
      loadFiles();
      loadRecentUploads();
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  const deleteUpload = event.target.closest('[data-delete-upload]');
  if (deleteUpload && confirm('确定删除这个文件吗？')) {
    try {
      await api(`/api/files/${deleteUpload.dataset.deleteUpload}`, { method: 'DELETE' });
      toast('文件已删除');
      loadRecentUploads();
      if (document.querySelector('#filesView.view.active')) loadFiles();
    } catch (error) {
      toast(error.message);
    }
  }
});

bootstrap().then((user) => {
  if (!user) {
    window.location.replace('/');
    return;
  }
  startSessionHeartbeat();
  renderApp();
}).catch((error) => toast(error.message));

// --- Account settings ---
let emailChangeChallengeId = '';
let accountCaptchaId = '';

function renderAccount() {
  const user = state.user;
  elements.accountAvatar.textContent = initials(user.username);
  elements.accountUsername.textContent = user.username;
  elements.accountRole.textContent = roleLabel(user.role);
  elements.currentEmail.textContent = user.email || '未绑定邮箱';
}

async function loadAccountCaptcha() {
  try {
    const result = await api('/api/captcha');
    accountCaptchaId = result.captcha.id;
    elements.accountCaptchaQuestion.innerHTML = sanitizeSvg(result.captcha.svg);
    elements.accountCaptchaInput.value = '';
  } catch (error) {
    toast(error.message);
  }
}

elements.changeEmailBtn.addEventListener('click', () => {
  elements.emailChangeForm.hidden = false;
  elements.changeEmailBtn.hidden = true;
  emailChangeChallengeId = '';
  elements.emailChangeCodeLabel.hidden = true;
  elements.emailChangeHint.hidden = true;
  elements.submitEmailChangeBtn.textContent = '发送验证码';
  loadAccountCaptcha();
});

elements.cancelEmailChangeBtn.addEventListener('click', () => {
  elements.emailChangeForm.hidden = true;
  elements.changeEmailBtn.hidden = false;
  emailChangeChallengeId = '';
});

elements.accountRefreshCaptchaBtn.addEventListener('click', loadAccountCaptcha);
elements.accountCaptchaQuestion.addEventListener('click', loadAccountCaptcha);

elements.submitEmailChangeBtn.addEventListener('click', async () => {
  const newEmail = elements.newEmailInput.value.trim();
  try {
    if (!emailChangeChallengeId) {
      const result = await api('/api/account/email', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail,
          captchaId: accountCaptchaId,
          captchaAnswer: elements.accountCaptchaInput.value.trim()
        })
      });
      if (result.requiresEmailCode) {
        emailChangeChallengeId = result.emailChallengeId;
        elements.emailChangeCodeLabel.hidden = false;
        elements.emailChangeHint.hidden = false;
        elements.emailChangeHint.textContent = `验证码已发送至 ${result.maskedEmail}，30 分钟内有效。`;
        elements.submitEmailChangeBtn.textContent = '验证并修改';
        elements.emailChangeCodeInput.focus();
      }
      return;
    }
    await api('/api/account/email', {
      method: 'PUT',
      body: JSON.stringify({
        emailChallengeId: emailChangeChallengeId,
        emailCode: elements.emailChangeCodeInput.value.trim()
      })
    });
    toast('邮箱已更新');
    state.user.email = newEmail;
    renderAccount();
    elements.emailChangeForm.hidden = true;
    elements.changeEmailBtn.hidden = false;
    emailChangeChallengeId = '';
  } catch (error) {
    toast(error.message);
    if (!emailChangeChallengeId) loadAccountCaptcha();
  }
});
