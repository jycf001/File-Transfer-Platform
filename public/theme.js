(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.dataset.theme = saved;
      document.documentElement.style.colorScheme = saved;
    }
  } catch {}
  // 防止 data-theme 被意外移除（如浏览器扩展、DOM 操作等）
  try {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'data-theme' && !document.documentElement.dataset.theme) {
          var s = localStorage.getItem('theme');
          if (s === 'dark' || s === 'light') {
            document.documentElement.dataset.theme = s;
            document.documentElement.style.colorScheme = s;
          }
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch {}
})();
