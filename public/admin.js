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
  startSessionHeartbeat
} = window.JiahaoDrop;

const elements = {
  adminApp: $('#adminApp'),
  adminNav: $('#adminNav'),
  avatar: $('#avatar'),
  accountBadge: $('#accountBadge'),
  logoutBtn: $('#logoutBtn'),
  refreshOverviewBtn: $('#refreshOverviewBtn'),
  metricGrid: $('#metricGrid'),
  createUserForm: $('#createUserForm'),
  userList: $('#userList'),
  settingsForm: $('#settingsForm'),
  reloadSettingsBtn: $('#reloadSettingsBtn'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  resetSystemBtn: $('#resetSystemBtn'),
  testEmailBtn: $('#testEmailBtn'),
  refreshLogsBtn: $('#refreshLogsBtn'),
  emailLogsBtn: $('#emailLogsBtn'),
  logList: $('#logList'),
  logTabs: $('#logTabs'),
  logSearch: $('#logSearch'),
  logLevelFilter: $('#logLevelFilter'),
  logTimeFilter: $('#logTimeFilter'),
  countAll: $('#countAll'),
  countSystem: $('#countSystem'),
  countSecurity: $('#countSecurity'),
  countUser: $('#countUser')
};

function setMode(mode) {
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === mode));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${mode}View`));
  if (mode === 'overview') loadOverview();
  if (mode === 'users') loadUsers();
  if (mode === 'settings') loadSettings();
  if (mode === 'logs') loadLogs();
}

function renderApp() {
  elements.adminApp.hidden = false;
  elements.adminNav.hidden = false;
  // 超级管理员专属元素显示/隐藏
  document.querySelectorAll('.super-admin-only').forEach((el) => {
    el.hidden = state.user.role !== 'super_admin';
    el.style.display = state.user.role !== 'super_admin' ? 'none' : '';
  });
  elements.avatar.textContent = String(state.user.username || 'J').slice(0, 2).toUpperCase();
  let seed = 0;
  for (const char of String(state.user.username || 'jiahao')) seed = (seed * 31 + char.charCodeAt(0)) % 360;
  elements.avatar.style.setProperty('--avatar-a', `hsl(${seed} 82% 48%)`);
  elements.avatar.style.setProperty('--avatar-b', `hsl(${(seed + 42) % 360} 78% 55%)`);
  elements.avatar.style.setProperty('--avatar-c', `hsl(${(seed + 108) % 360} 70% 42%)`);
  elements.accountBadge.textContent = `${state.user.username} · ${roleLabel(state.user.role)}`;
  setMode('overview');
}

elements.logoutBtn.addEventListener('click', async () => {
  await logout();
  window.location.replace('/');
});

$$('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.view));
});

async function loadOverview() {
  try {
    const result = await api('/api/admin/overview');
    const s = result.stats;
    const quotaBytes = Math.max(s.storageQuotaMb, 0) * 1024 * 1024;
    const pct = quotaBytes > 0 ? Math.min(100, Math.round((s.storageUsedBytes / quotaBytes) * 100)) : 0;
    const quotaLabel = s.storageQuotaMb > 0 ? `${formatSize(s.storageUsedBytes)} / ${formatSize(quotaBytes)}` : formatSize(s.storageUsedBytes);
    const pctLabel = s.storageQuotaMb > 0 ? `${pct}%` : '无限制';

    elements.metricGrid.innerHTML = `
      <article class="metric">
        <span class="metric-kicker">用户</span>
        <strong class="metric-value">${escapeHtml(s.users)}</strong>
        <span class="metric-note">${escapeHtml(s.activeUsers)} 个启用</span>
      </article>
      <article class="metric">
        <span class="metric-kicker">文件</span>
        <strong class="metric-value">${escapeHtml(s.files)}</strong>
        <span class="metric-note">当前有效</span>
      </article>
      <article class="metric">
        <span class="metric-kicker">会话</span>
        <strong class="metric-value">${escapeHtml(s.sessions)}</strong>
        <span class="metric-note">活跃登录</span>
      </article>
      <article class="metric">
        <span class="metric-kicker">保留</span>
        <strong class="metric-value">${escapeHtml(s.retentionHours)}<small>h</small></strong>
        <span class="metric-note">文件过期时间</span>
      </article>

      <article class="dash-storage">
        <div class="dash-storage-head">
          <div>
            <span class="metric-kicker">存储用量</span>
            <strong class="dash-storage-value">${escapeHtml(quotaLabel)}</strong>
          </div>
          <span class="dash-storage-pct">${escapeHtml(pctLabel)}</span>
        </div>
        <div class="dash-storage-bar"><div class="dash-storage-fill"></div></div>
        <code class="dash-storage-path">存储路径已隐藏，详见设置页</code>
      </article>

      <article class="dash-config">
        <div class="dash-config-item">
          <span class="dash-config-label">单文件上限</span>
          <span class="dash-config-value">${escapeHtml(s.maxFileSizeMb)} MB</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">单次上传</span>
          <span class="dash-config-value">${escapeHtml(s.maxFilesPerUpload)} 个</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">存储配额</span>
          <span class="dash-config-value">${escapeHtml(s.storageQuotaMb > 0 ? s.storageQuotaMb + ' MB' : '未限制')}</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">登录有效期</span>
          <span class="dash-config-value">${escapeHtml(s.sessionHours ?? 12)} 小时</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">空闲超时</span>
          <span class="dash-config-value">${escapeHtml(s.sessionIdleMinutes ?? 30)} 分钟</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">用户注册</span>
          <span class="dash-config-value">${s.registrationEnabled ? '已开启' : '已关闭'}</span>
        </div>
        <div class="dash-config-item">
          <span class="dash-config-label">SMTP 邮件</span>
          <span class="dash-config-value">${s.smtpEnabled ? '已启用' : '未启用'}</span>
        </div>
      </article>
    `;
    elements.metricGrid.querySelector('.dash-storage-fill')?.style.setProperty('width', `${pct}%`);
  } catch (error) {
    toast(error.message);
  }
}

elements.refreshOverviewBtn.addEventListener('click', loadOverview);

function roleLabel(role) {
  if (role === 'super_admin') return '超级管理员';
  if (role === 'admin') return '管理员';
  return '用户';
}

async function loadUsers() {
  try {
    const result = await api('/api/admin/users');
    const isSuper = state.user.role === 'super_admin';
    elements.userList.innerHTML = result.users.map((user) => {
      const roleOptions = isSuper ? `
            <select class="small-btn" data-change-role="${escapeHtml(user.id)}">
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>用户</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>管理员</option>
              <option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>超级管理员</option>
            </select>` : '';
      return `
      <div class="item">
        <div>
          <h3>${escapeHtml(user.username)} <span class="badge">${roleLabel(user.role)}</span></h3>
          <div class="meta">${user.disabled ? '已禁用' : '正常'} · ${escapeHtml(user.email || '未绑定邮箱')} · ${escapeHtml(formatDate(user.createdAt))} 创建</div>
        </div>
        <div class="actions">
          ${roleOptions}
          <button class="small-btn" data-toggle-user="${escapeHtml(user.id)}" data-disabled="${escapeHtml(user.disabled)}" type="button">${user.disabled ? '启用' : '禁用'}</button>
          <button class="small-btn" data-email-user="${escapeHtml(user.id)}" data-email="${escapeHtml(user.email || '')}" type="button">设置邮箱</button>
          <button class="small-btn" data-reset-user="${escapeHtml(user.id)}" type="button">重置密码</button>
          <button class="small-btn danger" data-delete-user="${escapeHtml(user.id)}" type="button">删除</button>
        </div>
      </div>`;
    }).join('');
  } catch (error) {
    toast(error.message);
  }
}

elements.createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(elements.createUserForm);
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: form.get('username'),
        email: form.get('email'),
        password: form.get('password'),
        role: form.get('role')
      })
    });
    elements.createUserForm.reset();
    toast('用户已创建');
    loadUsers();
  } catch (error) {
    toast(error.message);
  }
});

async function loadSettings() {
  try {
    const [result, overview] = await Promise.all([
      api('/api/admin/settings'),
      api('/api/admin/overview')
    ]);
    const settings = result.settings;
    const stats = overview.stats || {};
    const form = elements.settingsForm;
    const setValue = (name, value) => {
      const field = form.elements.namedItem(name);
      if (field) field.value = value ?? '';
    };
    const setChecked = (name, value) => {
      const field = form.elements.namedItem(name);
      if (field) field.checked = Boolean(value);
    };
    setValue('publicBaseUrl', settings.publicBaseUrl || '');
    setValue('siteName', settings.siteName || '');
    setValue('icpNumber', settings.icpNumber || '');
    setValue('legalNotice', settings.legalNotice || '');
    setValue('storageDir', settings.storageDir || '');
    setValue('maxFileSizeMb', settings.maxFileSizeMb ?? stats.maxFileSizeMb ?? 512);
    setValue('storageQuotaMb', settings.storageQuotaMb || '');
    setValue('maxFilesPerUpload', settings.maxFilesPerUpload ?? stats.maxFilesPerUpload ?? 10);
    setValue('retentionHours', settings.retentionHours ?? stats.retentionHours ?? 48);
    setValue('sessionHours', settings.sessionHours ?? 12);
    setValue('sessionIdleMinutes', settings.sessionIdleMinutes ?? 30);
    setChecked('registrationEnabled', settings.registrationEnabled);
    setChecked('smtpEnabled', settings.smtp.enabled);
    setValue('smtpHost', settings.smtp.host);
    setValue('smtpPort', settings.smtp.port);
    setValue('smtpSecure', String(settings.smtp.secure));
    setValue('smtpUsername', settings.smtp.username);
    form.elements.namedItem('smtpPassword').placeholder = settings.smtp.passwordSet ? '已保存，留空则不修改' : '留空则不设置';
    setValue('smtpFrom', settings.smtp.from);
    setValue('logRecipients', settings.smtp.logRecipients);
    setValue('logRetentionHours', settings.logRetentionHours ?? 168);
    setValue('logMaxSystem', settings.logMaxSystem ?? 400);
    setValue('logMaxSecurity', settings.logMaxSecurity ?? 400);
    setValue('logMaxUser', settings.logMaxUser ?? 400);
  } catch (error) {
    toast(error.message);
  }
}

elements.reloadSettingsBtn.addEventListener('click', loadSettings);

async function saveSettings() {
  const form = new FormData(elements.settingsForm);
  try {
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        publicBaseUrl: form.get('publicBaseUrl'),
        siteName: form.get('siteName'),
        icpNumber: form.get('icpNumber'),
        legalNotice: form.get('legalNotice'),
        storageDir: form.get('storageDir'),
        maxFileSizeMb: Number(form.get('maxFileSizeMb')),
        storageQuotaMb: Number(form.get('storageQuotaMb') || 0),
        maxFilesPerUpload: Number(form.get('maxFilesPerUpload')),
        retentionHours: Number(form.get('retentionHours')),
        sessionHours: Number(form.get('sessionHours')),
        sessionIdleMinutes: Number(form.get('sessionIdleMinutes')),
        registrationEnabled: form.get('registrationEnabled') === 'on',
        smtp: {
          enabled: form.get('smtpEnabled') === 'on',
          host: form.get('smtpHost'),
          port: Number(form.get('smtpPort')),
          secure: form.get('smtpSecure') === 'true',
          username: form.get('smtpUsername'),
          password: form.get('smtpPassword'),
          from: form.get('smtpFrom'),
          logRecipients: form.get('logRecipients')
        },
        logRetentionHours: Number(form.get('logRetentionHours')),
        logMaxSystem: Number(form.get('logMaxSystem')),
        logMaxSecurity: Number(form.get('logMaxSecurity')),
        logMaxUser: Number(form.get('logMaxUser'))
      })
    });
    if (elements.settingsForm.smtpPassword) elements.settingsForm.smtpPassword.value = '';
    toast('设置已保存');
    loadSettings();
    loadOverview();
  } catch (error) {
    toast(error.message);
  }
}

elements.saveSettingsBtn.type = 'button';
elements.saveSettingsBtn.addEventListener('click', saveSettings);

elements.resetSystemBtn.addEventListener('click', async () => {
  if (!confirm('确定要恢复出厂设置吗？\n\n此操作将清除：\n- 所有用户账号\n- 所有文件\n- 所有会话\n- 所有日志\n- 所有设置\n\n此操作不可撤销！')) return;
  const input = prompt('请输入"确认重置"以执行恢复出厂设置');
  if (input !== '确认重置') {
    if (input !== null) toast('输入内容不匹配，操作已取消');
    return;
  }
  try {
    await api('/api/admin/reset', { method: 'POST' });
    toast('系统已恢复出厂设置，即将跳转到首页');
    setTimeout(() => { window.location.href = '/'; }, 2000);
  } catch (error) {
    toast(error.message);
  }
});

elements.testEmailBtn.addEventListener('click', async (event) => {
  event.preventDefault();
  const to = elements.settingsForm.logRecipients ? elements.settingsForm.logRecipients.value.trim() : '';
  try {
    await api('/api/admin/email/test', {
      method: 'POST',
      body: JSON.stringify({ to })
    });
    toast('测试邮件已发送');
  } catch (error) {
    toast(error.message);
  }
});

const LOG_ACTION_MAP = {
  'auth.login': { text: '登录成功', icon: '✅', category: 'user' },
  'auth.login_failed': { text: '登录失败：用户名或密码错误', icon: '🔒', level: 'warn', category: 'security' },
  'auth.logout': { text: '退出登录', icon: '👋', category: 'user' },
  'auth.registered': { text: '注册新账号', icon: '🆕', category: 'user' },
  'auth.register_code_sent': { text: '注册验证码已发送', icon: '📧', category: 'user' },
  'auth.register_code_failed_to_send': { text: '注册验证码发送失败（邮件服务异常）', icon: '⚠️', level: 'warn', category: 'security' },
  'auth.email_login_code_sent': { text: '邮箱登录验证码已发送', icon: '📧', category: 'user' },
  'auth.email_login_code_failed': { text: '邮箱登录验证码输入错误', icon: '🔒', level: 'warn', category: 'security' },
  'auth.email_login_code_failed_to_send': { text: '邮箱验证码发送失败（邮件服务异常）', icon: '⚠️', level: 'warn', category: 'security' },
  'auth.email_login_unknown': { text: '登录尝试：该邮箱未注册', icon: '🔒', level: 'warn', category: 'security' },
  'files.uploaded': { text: '上传文件', icon: '📤', category: 'user' },
  'files.updated': { text: '修改文件设置', icon: '✏️', category: 'user' },
  'files.deleted': { text: '删除文件', icon: '🗑️', category: 'user' },
  'files.downloaded': { text: '下载文件', icon: '📥', category: 'user' },
  'files.public_downloaded': { text: '公开下载文件', icon: '📥', category: 'user' },
  'files.cleanup_expired': { text: '自动清理过期文件', icon: '🧹', category: 'system' },
  'admin.settings_updated': { text: '修改系统设置', icon: '⚙️', category: 'system' },
  'admin.user_created': { text: '创建用户', icon: '👤', category: 'system' },
  'admin.user_updated': { text: '修改用户信息', icon: '✏️', category: 'system' },
  'admin.user_deleted': { text: '删除用户', icon: '🗑️', category: 'system' },
  'admin.email_test_sent': { text: '发送测试邮件', icon: '📧', category: 'system' },
  'admin.logs_emailed': { text: '发送日志邮件', icon: '📧', category: 'system' },
  'admin.logs_cleared': { text: '清理日志', icon: '🧹', category: 'system' },
  'account.email_change_sent': { text: '邮箱修改验证码已发送', icon: '📧', category: 'user' },
  'account.email_changed': { text: '修改绑定邮箱', icon: '📧', category: 'user' },
  'system.initialized': { text: '系统初始化完成', icon: '🚀', category: 'system' },
  'system.smtp_ready': { text: 'SMTP 连接成功', icon: '✅', category: 'system' },
  'system.smtp_warm_failed': { text: 'SMTP 连接失败', icon: '❌', level: 'warn', category: 'system' }
};

const SECURITY_ACTIONS = new Set(
  Object.entries(LOG_ACTION_MAP).filter(([, v]) => v.category === 'security').map(([k]) => k)
);

function categorizeLog(log) {
  const info = LOG_ACTION_MAP[log.action];
  if (info?.category) return info.category;
  if (log.level === 'warn') return 'security';
  const prefix = (log.action || '').split('.')[0];
  if (prefix === 'system' || prefix === 'admin') return 'system';
  return 'user';
}

function formatLogMeta(log) {
  const m = log.meta || {};
  switch (log.action) {
    case 'auth.login':
      return m.username ? `账号：${escapeHtml(m.username)}` + (m.method === 'email' ? '（邮箱验证码）' : '（密码）') : '';
    case 'auth.login_failed':
      return m.username ? `尝试账号：${escapeHtml(m.username)}` : '';
    case 'auth.registered':
      return m.username ? `${escapeHtml(m.username)}（${escapeHtml(m.email || '')}）` : '';
    case 'auth.email_login_code_sent':
      return m.email ? `邮箱：${escapeHtml(m.email)}` : '';
    case 'auth.email_login_unknown':
      return m.email ? `尝试邮箱：${escapeHtml(m.email)}（该邮箱未注册）` : '';
    case 'auth.email_login_code_failed':
      return m.username ? `账号：${escapeHtml(m.username)}，验证码输入错误` : '';
    case 'auth.register_code_failed_to_send':
    case 'auth.email_login_code_failed_to_send':
      return m.email ? `邮箱：${escapeHtml(m.email)}` + (m.elapsedMs ? `，耗时 ${m.elapsedMs}ms` : '') : '';
    case 'files.uploaded': {
      const parts = [];
      if (m.count) parts.push(`${m.count} 个文件`);
      if (m.bytes) parts.push(formatSize(m.bytes));
      if (m.batchCode) parts.push(`接收码：${escapeHtml(m.batchCode)}`);
      return parts.join('，');
    }
    case 'files.updated':
    case 'files.deleted':
      return m.name ? `文件：${escapeHtml(m.name)}` : '';
    case 'admin.user_created':
    case 'admin.user_updated':
      return m.username ? `${escapeHtml(m.username)}（${roleLabel(m.role)}）` : '';
    case 'admin.user_deleted':
      return m.username ? `账号：${escapeHtml(m.username)}` + (m.removedFiles ? `，同时删除 ${m.removedFiles} 个文件` : '') : '';
    case 'admin.settings_updated': {
      const items = [];
      if (m.smtpEnabled !== undefined) items.push(`邮件：${m.smtpEnabled ? '已开启' : '已关闭'}`);
      if (m.registrationEnabled !== undefined) items.push(`注册：${m.registrationEnabled ? '已开启' : '已关闭'}`);
      if (m.maxFileSizeMb) items.push(`单文件上限：${m.maxFileSizeMb}MB`);
      return items.join('，') || '';
    }
    case 'admin.email_test_sent':
      return m.to ? `收件人：${escapeHtml(m.to)}` : '';
    case 'admin.logs_emailed':
      return m.count ? `${m.count} 条日志，最近 ${m.sinceHours} 小时` : '';
    case 'admin.logs_cleared':
      return m.keptEntries ? `保留 ${m.keptEntries} 条` : '';
    case 'account.email_change_sent':
    case 'account.email_changed':
      return m.newEmail ? `新邮箱：${escapeHtml(m.newEmail)}` : '';
    case 'system.smtp_warm_failed':
      return m.message ? `原因：${escapeHtml(m.message)}` : '';
    default:
      return '';
  }
}

function renderLogRow(log) {
  const info = LOG_ACTION_MAP[log.action] || { text: log.action, icon: '📝' };
  const levelClass = log.level === 'warn' ? ' log-row--warn' : '';
  const meta = formatLogMeta(log);
  return `
    <div class="log-row${levelClass}">
      <div class="log-row-main">
        <span class="log-icon">${info.icon}</span>
        <div>
          <strong>${escapeHtml(info.text)}</strong>
          <span class="log-actor">${escapeHtml(log.actor || '系统')}${log.ip ? ' · ' + escapeHtml(log.ip) : ''}</span>
        </div>
      </div>
      <div class="log-detail">${meta || ''}</div>
      <time>${escapeHtml(formatDate(log.at))}</time>
    </div>`;
}

let allLogs = [];
let activeCategory = 'all';

function filterLogs() {
  const query = (elements.logSearch.value || '').trim().toLowerCase();
  const level = elements.logLevelFilter.value;
  const hours = Number(elements.logTimeFilter.value) || 0;
  const cutoff = hours > 0 ? Date.now() - hours * 3600 * 1000 : 0;

  const filtered = allLogs.filter((log) => {
    if (activeCategory !== 'all' && categorizeLog(log) !== activeCategory) return false;
    if (level && log.level !== level) return false;
    if (cutoff && new Date(log.at).getTime() < cutoff) return false;
    if (query) {
      const info = LOG_ACTION_MAP[log.action] || {};
      const haystack = [
        info.text || '',
        log.action || '',
        log.actor || '',
        log.ip || '',
        formatLogMeta(log).replace(/<[^>]*>/g, '')
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    elements.logList.innerHTML = '<div class="item"><div><h3>无匹配日志</h3><div class="meta">尝试调整筛选条件。</div></div></div>';
  } else {
    elements.logList.innerHTML = filtered.map(renderLogRow).join('');
  }
}

function updateCounts() {
  const counts = { all: allLogs.length, system: 0, security: 0, user: 0 };
  for (const log of allLogs) counts[categorizeLog(log)]++;
  elements.countAll.textContent = counts.all;
  elements.countSystem.textContent = counts.system;
  elements.countSecurity.textContent = counts.security;
  elements.countUser.textContent = counts.user;
}

async function loadLogs() {
  try {
    const result = await api('/api/admin/logs?limit=500');
    allLogs = result.logs || [];
    updateCounts();
    filterLogs();
  } catch (error) {
    toast(error.message);
  }
}

elements.logTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('.log-tab');
  if (!tab) return;
  elements.logTabs.querySelectorAll('.log-tab').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  activeCategory = tab.dataset.category;
  filterLogs();
});

let searchTimer = null;
elements.logSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterLogs, 200);
});
elements.logLevelFilter.addEventListener('change', filterLogs);
elements.logTimeFilter.addEventListener('change', filterLogs);

elements.refreshLogsBtn.addEventListener('click', loadLogs);

elements.emailLogsBtn.addEventListener('click', async () => {
  const sinceHours = Number(prompt('发送最近多少小时的日志？', '24') || 24);
  if (!sinceHours) return;
  try {
    const result = await api('/api/admin/logs/email', {
      method: 'POST',
      body: JSON.stringify({ sinceHours })
    });
    toast(`已发送 ${result.count} 条日志`);
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener('change', async (event) => {
  const roleSelect = event.target.closest('[data-change-role]');
  if (roleSelect) {
    const userId = roleSelect.dataset.changeRole;
    const newRole = roleSelect.value;
    if (!confirm(`确定要将该用户角色更改为「${roleLabel(newRole)}」吗？`)) {
      loadUsers();
      return;
    }
    try {
      await api(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole })
      });
      toast('角色已更新');
      loadUsers();
    } catch (error) {
      toast(error.message);
      loadUsers();
    }
    return;
  }
});

document.addEventListener('click', async (event) => {
  const toggleUser = event.target.closest('[data-toggle-user]');
  if (toggleUser) {
    try {
      await api(`/api/admin/users/${toggleUser.dataset.toggleUser}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: toggleUser.dataset.disabled !== 'true' })
      });
      loadUsers();
    } catch (error) {
      toast(error.message);
    }
  }

  const emailUser = event.target.closest('[data-email-user]');
  if (emailUser) {
    const email = prompt('请输入邮箱，留空则清除邮箱验证', emailUser.dataset.email || '');
    if (email === null) return;
    try {
      await api(`/api/admin/users/${emailUser.dataset.emailUser}`, {
        method: 'PATCH',
        body: JSON.stringify({ email })
      });
      toast('邮箱已更新');
      loadUsers();
    } catch (error) {
      toast(error.message);
    }
  }

  const resetUser = event.target.closest('[data-reset-user]');
  if (resetUser) {
    const password = prompt('请输入新密码，至少 8 位');
    if (!password) return;
    try {
      await api(`/api/admin/users/${resetUser.dataset.resetUser}`, {
        method: 'PATCH',
        body: JSON.stringify({ password })
      });
      toast('密码已重置');
    } catch (error) {
      toast(error.message);
    }
  }

  const deleteUser = event.target.closest('[data-delete-user]');
  if (deleteUser && confirm('确定删除这个用户吗？该用户的文件也会删除。')) {
    try {
      await api(`/api/admin/users/${deleteUser.dataset.deleteUser}`, { method: 'DELETE' });
      toast('用户已删除');
      loadUsers();
    } catch (error) {
      toast(error.message);
    }
  }
});

bootstrap().then((user) => {
  if (user && (user.role === 'admin' || user.role === 'super_admin')) {
    startSessionHeartbeat();
    renderApp();
  } else {
    window.location.replace('/login');
  }
}).catch(() => window.location.replace('/login'));
