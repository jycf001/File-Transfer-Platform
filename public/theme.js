(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.dataset.theme = saved;
      document.documentElement.style.colorScheme = saved;
    }
  } catch {}
})();
