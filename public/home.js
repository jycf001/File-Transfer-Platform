const { state, $, bootstrap } = window.JiahaoDrop;

const codeInput = $('#codeInput');
const receiveBtn = $('#receiveBtn');
const pillHint = $('#pillHint');
const pillError = $('#pillError');
const registerLink = $('#registerLink');
const uploadHint = $('#uploadHint');

function showError(message) {
  pillError.textContent = message;
  pillError.hidden = false;
  pillHint.hidden = true;
}

function clearError() {
  pillError.hidden = true;
  pillHint.hidden = false;
}

function goToReceive(code) {
  const normalized = String(code || '').trim().toUpperCase();
  clearError();

  if (!normalized) {
    showError('请输入接收码');
    codeInput.focus();
    return;
  }
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    showError('接收码格式不正确（需 6 位字母或数字）');
    codeInput.focus();
    return;
  }
  try {
    sessionStorage.setItem('jiahaodrop_receive_code', normalized);
  } catch {}
  window.location.href = '/receive';
}

if (codeInput) {
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (pillError.hidden === false) clearError();
  });

  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToReceive(codeInput.value);
    }
  });
}

if (receiveBtn) {
  receiveBtn.addEventListener('click', () => goToReceive(codeInput.value));
}

bootstrap()
  .then((user) => {
    if (user) {
      window.location.replace('/app/send');
      return;
    }
    if (registerLink && state.registrationEnabled) registerLink.hidden = false;
    if (uploadHint) uploadHint.hidden = false;
  })
  .catch(() => {});
