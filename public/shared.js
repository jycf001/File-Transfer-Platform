window.JiahaoDrop = (() => {
  const state = {
    initialized: false,
    webInitAvailable: false,
    user: null,
    csrfToken: '',
    limits: {
      maxFileSizeMb: 512,
      maxFilesPerUpload: 10,
      retentionHours: 48
    },
    publicBaseUrl: '',
    storageQuotaMb: 0,
    storageUsedBytes: 0,
    registrationEnabled: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function toast(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 2600);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function sanitizeSvg(svgString) {
    if (!svgString) return '';
    // 使用 DOMParser 解析后清理，比正则更可靠
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return '';
    // 移除危险元素
    const dangerousTags = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'a', 'use', 'set', 'animate', 'animatetransform', 'animatemotion', 'style'];
    for (const tag of dangerousTags) {
      for (const el of svg.querySelectorAll(tag)) el.remove();
    }
    // 移除 on* 事件属性和 style 中的危险内容
    const allElements = svg.querySelectorAll('*');
    for (const el of allElements) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'xlink:href') && /^javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
      // 移除 style 属性中的 url() 和 expression()
      if (el.hasAttribute('style')) {
        const style = el.getAttribute('style');
        if (/url\s*\(|expression\s*\(|javascript:/i.test(style)) el.removeAttribute('style');
      }
    }
    return new XMLSerializer().serializeToString(svg);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!(options.body instanceof FormData) && options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (state.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method || 'GET')) {
      headers.set('X-CSRF-Token', state.csrfToken);
    }
    const response = await fetch(path, { ...options, headers });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      if (data?.error) throw new Error(data.error);
      if (response.status === 413) throw new Error('文件超过服务器大小限制，请联系管理员检查 nginx 配置');
      throw new Error('请求失败');
    }
    return data;
  }

  async function bootstrap() {
    const [status, me] = await Promise.all([
      api('/api/status').catch(() => null),
      api('/api/me').catch(() => null)
    ]);
    if (status) {
      state.initialized = status.initialized;
      state.limits.maxFileSizeMb = status.maxFileSizeMb;
      state.limits.maxFilesPerUpload = status.maxFilesPerUpload;
      state.limits.retentionHours = status.retentionHours;
      state.publicBaseUrl = status.publicBaseUrl || window.location.origin;
      state.storageQuotaMb = status.storageQuotaMb || 0;
      state.storageUsedBytes = status.storageUsedBytes || 0;
      state.registrationEnabled = Boolean(status.registrationEnabled);
      state.webInitAvailable = Boolean(status.webInitAvailable);
    }
    if (me) {
      state.user = me.user;
      state.csrfToken = me.csrfToken;
      return me.user;
    }
    return null;
  }

  async function login(username, password, extra = {}) {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...extra })
    });
    if (result.requiresEmailCode) return result;
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    return result.user;
  }

  async function setup(username, password, email = '', extra = {}) {
    await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password, email, ...extra })
    });
    state.initialized = true;
  }

  async function logout() {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      // Session may already be expired; the UI should still return to the homepage.
    }
    state.user = null;
    state.csrfToken = '';
  }

  async function clipboardWrite(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function initTheme() {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark' || saved === 'light') {
        document.documentElement.dataset.theme = saved;
      }
    } catch {}
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = current === 'dark' || (!current && prefersDark);
    const next = isDark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {}
  }

  function bindThemeToggle() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('.theme-toggle');
      if (!button) return;
      event.preventDefault();
      toggleTheme();
    });
  }

  let heartbeatTimer = null;

  function startSessionHeartbeat(intervalMs = 5 * 60 * 1000) {
    stopSessionHeartbeat();
    heartbeatTimer = setInterval(async () => {
      try {
        const me = await api('/api/me');
        if (!me || !me.user) {
          state.user = null;
          state.csrfToken = '';
          window.location.href = '/login';
        }
      } catch {
        state.user = null;
        state.csrfToken = '';
        window.location.href = '/login';
      }
    }, intervalMs);
  }

  function stopSessionHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function applyBranding() {
    try {
      const data = await api('/api/branding');
      if (!data) return;
      const siteName = data.siteName || 'JiahaoDrop';
      document.querySelectorAll('[data-brand="siteName"]').forEach((el) => {
        el.textContent = el.dataset.suffix ? siteName + el.dataset.suffix : siteName;
      });
      if (data.siteName) {
        document.title = document.title.replace(/JiahaoDrop/g, data.siteName);
      }
      document.querySelectorAll('[data-brand="icp"]').forEach((el) => {
        if (data.icpNumber) {
          el.textContent = data.icpNumber;
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      });
      document.querySelectorAll('[data-brand="legal"]').forEach((el) => {
        if (data.legalNotice) {
          el.textContent = data.legalNotice;
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      });
    } catch {}
  }

  initTheme();
  bindThemeToggle();
  applyBranding();

  return { state, $, $$, api, bootstrap, login, setup, logout, toast, formatSize, formatDate, escapeHtml, sanitizeSvg, clipboardWrite, toggleTheme, startSessionHeartbeat, stopSessionHeartbeat, applyBranding };
})();
