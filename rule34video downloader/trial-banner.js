// trial-banner.js - show free trial remaining in the popup UI.
//
// This is intentionally self-contained so each app can just include:
//   <script defer src="trial-banner.js"></script>
//
// It:
// - Injects a banner element if missing.
// - Calls Auth.checkActivationStatus() and shows "Free trial: N downloads left".
// - Hooks chrome.runtime.sendMessage({ action: 'downloadVideo' }) to refresh after a download is queued.
(function () {
  const BANNER_ID = 'trialBanner';
  const STYLE_ID = 'serpTrialBannerStyle';
  const HIDDEN_CLASS = 'hidden';

  function ensureStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        '.trial-banner{margin:10px 0 0 0;padding:10px 12px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:inherit;border-radius:6px;font-size:12px;line-height:1.35}' +
        '.trial-banner strong{font-weight:700}' +
        '.trial-banner.hidden{display:none !important}';
      document.head.appendChild(style);
    } catch (_) {}
  }

  function ensureBanner() {
    const existing = document.getElementById(BANNER_ID);
    if (existing) return existing;

    try {
      const banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.className = 'trial-banner ' + HIDDEN_CLASS;

      // Prefer placing under a boot splash if present, otherwise under header, otherwise top of container.
      const boot = document.getElementById('bootSplash');
      const header = document.querySelector('.header');
      const container = document.querySelector('.container') || document.body;

      if (boot && boot.parentNode) {
        boot.insertAdjacentElement('afterend', banner);
      } else if (header && header.parentNode) {
        header.insertAdjacentElement('afterend', banner);
      } else if (container && container.firstChild) {
        container.insertBefore(banner, container.firstChild);
      } else {
        container.appendChild(banner);
      }

      return banner;
    } catch (_) {
      return null;
    }
  }

  function hideBanner(banner) {
    if (!banner) return;
    banner.textContent = '';
    banner.classList.add(HIDDEN_CLASS);
  }

  function showTrialBanner(banner, remaining) {
    if (!banner) return;
    const left = String(remaining);
    const productUrl =
      (globalThis.SiteConfig && globalThis.SiteConfig.PRODUCT_URL) || '#';
    banner.innerHTML =
      '<span class="trial-banner-label">' +
      '<span class="trial-banner-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
      '</svg>' +
      '</span>' +
      left +
      ' download' +
      (left === '1' ? '' : 's') +
      ' left' +
      '</span>' +
      '<a class="trial-banner-upgrade" href="' +
      productUrl +
      '" target="_blank" rel="noopener noreferrer">Upgrade &#8594;</a>';
    banner.classList.remove(HIDDEN_CLASS);
  }

  async function waitForAuth(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (globalThis.Auth && typeof globalThis.Auth.checkActivationStatus === 'function') return globalThis.Auth;
      await new Promise((r) => setTimeout(r, 50));
    }
    return globalThis.Auth || null;
  }

  async function refreshBanner() {
    const banner = ensureBanner();
    if (!banner) return;

    const Auth = await waitForAuth(5000);
    if (!Auth || typeof Auth.checkActivationStatus !== 'function') {
      hideBanner(banner);
      return;
    }

    try {
      const s = await Auth.checkActivationStatus();
      if (s && s.mode === 'trial' && typeof s.remaining === 'number') {
        showTrialBanner(banner, s.remaining);
      } else {
        hideBanner(banner);
      }
    } catch (_) {
      // If the network is offline or backend unreachable, don't spam the UI.
      hideBanner(banner);
    }
  }

  function patchSendMessage() {
    try {
      if (!globalThis.chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
      if (globalThis.__serpTrialBannerPatched) return;
      globalThis.__serpTrialBannerPatched = true;

      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);

      function getMessageFromArgs(args) {
        if (!args || !args.length) return null;
        if (typeof args[0] === 'string') return (args.length >= 2 && typeof args[1] === 'object') ? args[1] : null;
        if (typeof args[0] === 'object') return args[0];
        return null;
      }

      function shouldRefreshFor(message, response) {
        try {
          const action = message && (message.action || message.type);
          if (action !== 'downloadVideo') return false;
          return !!(response && response.success);
        } catch (_) {
          return false;
        }
      }

      chrome.runtime.sendMessage = function (...args) {
        const message = getMessageFromArgs(args);

        // Callback-style
        const cbIndex = args.findIndex((a) => typeof a === 'function');
        if (cbIndex >= 0) {
          const userCb = args[cbIndex];
          args[cbIndex] = function (response) {
            try {
              if (shouldRefreshFor(message, response)) void refreshBanner();
            } catch (_) {}
            return userCb(response);
          };
          return orig(...args);
        }

        // Promise-style (if supported)
        const maybe = orig(...args);
        try {
          if (maybe && typeof maybe.then === 'function') {
            return maybe.then((response) => {
              if (shouldRefreshFor(message, response)) void refreshBanner();
              return response;
            });
          }
        } catch (_) {}

        return maybe;
      };
    } catch (_) {}
  }

  function init() {
    ensureStyle();
    ensureBanner();
    patchSendMessage();
    void refreshBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
