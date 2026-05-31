const { state, $, $$, api, bootstrap, login, setup, toast, sanitizeSvg } = window.JiahaoDrop;

const elements = {
  form: $('#loginForm'),
  title: $('#authTitle'),
  hint: $('#authHint'),
  submit: $('#authSubmit'),
  methods: $('#loginMethods'),
  usernameLabel: $('#usernameLabel'),
  username: $('#usernameInput'),
  passwordLabel: $('#passwordLabel'),
  password: $('#passwordInput'),
  emailLabel: $('#emailLabel'),
  email: $('#emailInput'),
  setupEmailLabel: $('#setupEmailLabel'),
  setupEmail: $('#setupEmailInput'),
  initTokenLabel: $('#initTokenLabel'),
  initTokenInput: $('#initTokenInput'),
  initTokenHint: $('#initTokenHint'),
  captchaLabel: $('#captchaLabel'),
  captchaQuestion: $('#captchaQuestion'),
  captchaInput: $('#captchaInput'),
  refreshCaptchaBtn: $('#refreshCaptchaBtn'),
  emailCodeLabel: $('#emailCodeLabel'),
  emailCodeInput: $('#emailCodeInput'),
  emailCodeHint: $('#emailCodeHint'),
  loginToggle: $('#loginToggle'),
  toggleText: $('#toggleText'),
  toggleBtn: $('#toggleBtn')
};

let captchaId = '';
let emailChallengeId = '';
let mode = 'login';
let loginMethod = 'password';

function safeHidden(el, val) { if (el) el.hidden = val; }
function safeText(el, val) { if (el) el.textContent = val; }
function safeHtml(el, val) { if (el) el.innerHTML = val; }
function setRequired(el, val) { if (el) el.required = val; }

function isCaptchaNeeded() {
  return !emailChallengeId && (mode === 'setup' || mode === 'register' || mode === 'login');
}

function isEmailCodeStep() {
  return Boolean(emailChallengeId);
}

function submitLabel() {
  if (mode === 'setup') return '创建管理员';
  if (mode === 'register') return isEmailCodeStep() ? '验证并注册' : '注册';
  if (loginMethod === 'email') return isEmailCodeStep() ? '验证并登录' : '发送验证码';
  return '登录';
}

function busyLabel() {
  if (mode === 'setup') return '正在创建...';
  if (mode === 'register') return isEmailCodeStep() ? '正在验证...' : '正在发送验证码...';
  if (loginMethod === 'email') return isEmailCodeStep() ? '正在验证...' : '正在发送验证码...';
  return '正在登录...';
}

function setBusy(isBusy, label) {
  if (!elements.submit) return;
  elements.submit.disabled = isBusy;
  safeText(elements.submit, label || submitLabel());
}

function renderLoginMethods() {
  safeHidden(elements.methods, mode !== 'login');
  $$('.method-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.loginMethod === loginMethod);
  });
}

function render() {
  if (!state.initialized) {
    mode = 'setup';
    safeText(elements.title, '初始化管理员');
    if (state.webInitAvailable) {
      safeText(elements.hint, '首次运行需要创建第一个管理员账号。请输入服务器环境变量 INIT_TOKEN 中设置的初始化令牌。');
    } else {
      safeText(elements.hint, 'Web 初始化未启用。请通过命令行 (node server.js --init) 或环境变量 (ADMIN_USERNAME / ADMIN_PASSWORD) 初始化。');
    }
    safeHidden(elements.usernameLabel, !state.webInitAvailable);
    safeHidden(elements.passwordLabel, !state.webInitAvailable);
    safeHidden(elements.emailLabel, true);
    safeHidden(elements.setupEmailLabel, !state.webInitAvailable);
    safeHidden(elements.initTokenLabel, !state.webInitAvailable);
    safeHidden(elements.initTokenHint, state.webInitAvailable);
    if (!state.webInitAvailable && elements.initTokenHint) {
      safeText(elements.initTokenHint, '在服务器终端执行: node server.js --init');
    }
    safeHidden(elements.loginToggle, true);
    if (elements.password) elements.password.autocomplete = 'new-password';
    if (elements.submit) elements.submit.disabled = !state.webInitAvailable;
  } else if (mode === 'register') {
    safeText(elements.title, '注册');
    safeText(elements.hint, '创建账号后即可上传和接收文件。');
    safeHidden(elements.usernameLabel, false);
    safeHidden(elements.passwordLabel, false);
    safeHidden(elements.emailLabel, false);
    safeHidden(elements.setupEmailLabel, true);
    safeHidden(elements.loginToggle, false);
    safeText(elements.toggleText, '已有账号？');
    safeText(elements.toggleBtn, '去登录');
    if (elements.password) elements.password.autocomplete = 'new-password';
  } else {
    safeText(elements.title, '登录');
    safeText(elements.hint, loginMethod === 'email'
      ? '输入已绑定邮箱，通过图形验证码后发送邮箱验证码登录。'
      : '使用用户名、密码和图形验证码登录。');
    safeHidden(elements.usernameLabel, loginMethod === 'email');
    safeHidden(elements.passwordLabel, loginMethod === 'email');
    safeHidden(elements.emailLabel, loginMethod !== 'email');
    safeHidden(elements.setupEmailLabel, true);
    safeHidden(elements.loginToggle, !state.registrationEnabled);
    safeText(elements.toggleText, '没有账号？');
    safeText(elements.toggleBtn, '注册新账号');
    if (elements.password) elements.password.autocomplete = 'current-password';
  }

  safeHidden(elements.captchaLabel, !isCaptchaNeeded());
  safeHidden(elements.emailCodeLabel, !isEmailCodeStep());
  safeHidden(elements.emailCodeHint, !isEmailCodeStep());
  renderLoginMethods();

  setRequired(elements.username, mode !== 'login' || loginMethod === 'password');
  setRequired(elements.password, mode === 'setup' || mode === 'register' || loginMethod === 'password');
  setRequired(elements.email, mode === 'register' || (mode === 'login' && loginMethod === 'email'));
  setRequired(elements.captchaInput, isCaptchaNeeded());
  setRequired(elements.emailCodeInput, isEmailCodeStep());
  setRequired(elements.initTokenInput, mode === 'setup' && state.webInitAvailable);
  safeText(elements.submit, submitLabel());
}

async function loadCaptcha() {
  if (!isCaptchaNeeded()) return;
  try {
    const result = await api('/api/captcha');
    captchaId = result.captcha.id;
    safeHtml(elements.captchaQuestion, sanitizeSvg(result.captcha.svg));
    if (elements.captchaInput) elements.captchaInput.value = '';
  } catch (error) {
    console.error('[loadCaptcha]', error);
    toast(error.message);
  }
}

function resetFlow({ clearPassword = true } = {}) {
  emailChallengeId = '';
  safeHidden(elements.emailCodeLabel, true);
  safeHidden(elements.emailCodeHint, true);
  if (elements.emailCodeInput) elements.emailCodeInput.value = '';
  if (clearPassword && elements.password) elements.password.value = '';
  render();
  loadCaptcha();
}

if (elements.methods) {
  elements.methods.addEventListener('click', (event) => {
    const button = event.target.closest('[data-login-method]');
    if (!button) return;
    loginMethod = button.dataset.loginMethod === 'email' ? 'email' : 'password';
    resetFlow({ clearPassword: false });
  });
}

if (elements.toggleBtn) {
  elements.toggleBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    resetFlow();
  });
}

if (elements.refreshCaptchaBtn) elements.refreshCaptchaBtn.addEventListener('click', loadCaptcha);
if (elements.captchaQuestion) elements.captchaQuestion.addEventListener('click', loadCaptcha);

if (elements.form) {
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = elements.username ? elements.username.value.trim() : '';
    const password = elements.password ? elements.password.value : '';
    const email = elements.email ? elements.email.value.trim() : '';
    let keepLabel = false;

    try {
      setBusy(true, busyLabel());

      if (mode === 'setup') {
        await setup(username, password, elements.setupEmail ? elements.setupEmail.value.trim() : '', {
          captchaId,
          captchaAnswer: elements.captchaInput ? elements.captchaInput.value.trim() : '',
          initToken: elements.initTokenInput ? elements.initTokenInput.value.trim() : ''
        });
        toast('管理员已创建，请登录');
        mode = 'login';
        resetFlow();
        return;
      }

      if (mode === 'register') {
        if (!email) { toast('请输入邮箱'); return; }
        if (!emailChallengeId) {
          const result = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({
              username,
              password,
              email,
              captchaId,
              captchaAnswer: elements.captchaInput ? elements.captchaInput.value.trim() : ''
            })
          });
          if (result.requiresEmailCode) {
            emailChallengeId = result.emailChallengeId;
            safeText(elements.emailCodeHint, `验证码已发送至 ${result.maskedEmail}，30 分钟内有效。`);
            keepLabel = true;
            render();
            if (elements.emailCodeInput) elements.emailCodeInput.focus();
          }
          return;
        }
        const result = await api('/api/register/verify', {
          method: 'POST',
          body: JSON.stringify({
            emailChallengeId,
            emailCode: elements.emailCodeInput ? elements.emailCodeInput.value.trim() : ''
          })
        });
        if (result.csrfToken) window.location.href = '/app/send';
        return;
      }
      if (loginMethod === 'email') {
        if (!emailChallengeId) {
          const result = await api('/api/login/email', {
            method: 'POST',
            body: JSON.stringify({
              email,
              captchaId,
              captchaAnswer: elements.captchaInput ? elements.captchaInput.value.trim() : ''
            })
          });
          emailChallengeId = result.emailChallengeId;
          safeText(elements.emailCodeHint, `验证码已发送至 ${result.maskedEmail}，30 分钟内有效。`);
          keepLabel = true;
          render();
          if (elements.emailCodeInput) elements.emailCodeInput.focus();
          return;
        }
        const result = await api('/api/login/email/verify', {
          method: 'POST',
          body: JSON.stringify({
            emailChallengeId,
            emailCode: elements.emailCodeInput ? elements.emailCodeInput.value.trim() : ''
          })
        });
        state.user = result.user;
        state.csrfToken = result.csrfToken;
        afterLoginRedirect(result.user);
        return;
      }

      const user = await login(username, password, {
        captchaId,
        captchaAnswer: elements.captchaInput ? elements.captchaInput.value.trim() : ''
      });
      afterLoginRedirect(user);
    } catch (error) {
      console.error('[form-submit]', error);
      toast(error.message || '请求失败');
      if (isCaptchaNeeded() && !emailChallengeId) loadCaptcha();
    } finally {
      setBusy(false, keepLabel ? elements.submit.textContent : submitLabel());
    }
  });
}

function afterLoginRedirect(user) {
  if (user && (user.role === 'admin' || user.role === 'super_admin')) {
    window.location.replace('/admin');
  } else {
    window.location.replace('/app/send');
  }
}

bootstrap().then((user) => {
  if (user) { afterLoginRedirect(user); return; }
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'register' && state.registrationEnabled) mode = 'register';
  if (params.get('method') === 'email') loginMethod = 'email';
  render();
  loadCaptcha();
}).catch((error) => {
  console.error('[bootstrap]', error);
  toast(error && error.message ? error.message : '加载失败');
});
