(function () {
  var STORAGE_KEY = 'gf-theme';

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* localStorage kullanılamıyor, sorun değil */
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('[data-theme-set]');
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-theme-set') === theme ? 'true' : 'false');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current);

    document.querySelectorAll('[data-theme-set]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var theme = btn.getAttribute('data-theme-set');
        applyTheme(theme);
        setStoredTheme(theme);
      });
    });
  });
})();
