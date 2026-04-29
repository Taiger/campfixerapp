(function () {
  var stored = localStorage.getItem('campfixer:theme');
  var sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (stored === 'dark' || (!stored && sysDark)) {
    document.documentElement.classList.add('dark');
  }
})();
