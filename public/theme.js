(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.dataset.theme = saved;
      document.documentElement.style.colorScheme = saved;
    }
  } catch {}
  try {
    var observer = new MutationObserver(function (mutations) {
      try {
        var saved = localStorage.getItem('theme');
        if (saved !== 'dark' && saved !== 'light') return;
        var el = document.documentElement;
        if (el.dataset.theme !== saved) {
          el.dataset.theme = saved;
          el.style.colorScheme = saved;
        }
      } catch {}
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch {}
})();
