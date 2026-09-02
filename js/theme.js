// ==================================================================
// Dark mode toggle
// ------------------------------------------------------------------
// The theme itself is already applied before first paint by a tiny
// inline script in <head> (see index.html / admin.html) — that's
// what stops a flash of the wrong colours. This file just wires up
// the toggle button(s) and keeps localStorage + the browser's
// theme-color meta tag in sync with whatever the person picks.
// ==================================================================

(function () {
  const KEY = 'ef_theme';
  const LIGHT_COLOR = '#e6e9ef';
  const DARK_COLOR = '#171b23';

  function applyMetaColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? DARK_COLOR : LIGHT_COLOR);
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    applyMetaColor(theme);
    try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode etc. — ignore */ }
  }

  window.toggleTheme = function () {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  };

  // sync the meta tag immediately in case the inline pre-paint script
  // picked a theme different from the meta tag's hardcoded default
  applyMetaColor(currentTheme());

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', window.toggleTheme);
    });
  });
})();
