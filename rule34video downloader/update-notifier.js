// update-notifier.js
(function () {
  const STORAGE_LAST_RESULT_KEY = "update:lastResult";
  const STORAGE_LAST_CHECKED_AT_KEY = "update:lastCheckedAt";
  const STORAGE_DISMISSED_VERSION_KEY = "update:dismissedVersion";
  const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const DEFAULT_TIMEOUT_MS = 8000;
  const STYLE_ID = "rule34-update-notifier-style";

  function normalizeVersion(value) {
    return String(value || "").trim().replace(/^v/i, "").split("+")[0].trim();
  }

  function parseSemverLike(value) {
    const normalized = normalizeVersion(value);
    if (!normalized) return null;
    const parts = normalized.split("-", 2);
    const corePart = parts[0];
    const prePart = parts[1] || "";
    const core = corePart.split(".").map((segment) => {
      const parsed = Number.parseInt(segment, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    if (!core.length || core.every((part) => part === 0 && !/\d/.test(corePart))) {
      return null;
    }
    const pre = prePart
      ? prePart.split(".").map((token) => {
          const parsed = Number.parseInt(token, 10);
          return Number.isFinite(parsed) && String(parsed) === token
            ? parsed
            : String(token || "").toLowerCase();
        })
      : [];
    return { core, pre };
  }

  function comparePreRelease(aPre, bPre) {
    const aHas = Array.isArray(aPre) && aPre.length > 0;
    const bHas = Array.isArray(bPre) && bPre.length > 0;
    if (!aHas && !bHas) return 0;
    if (!aHas) return 1;
    if (!bHas) return -1;
    const max = Math.max(aPre.length, bPre.length);
    for (let i = 0; i < max; i += 1) {
      const aToken = aPre[i];
      const bToken = bPre[i];
      if (aToken === undefined) return -1;
      if (bToken === undefined) return 1;
      if (aToken === bToken) continue;
      const aNumeric = typeof aToken === "number";
      const bNumeric = typeof bToken === "number";
      if (aNumeric && bNumeric) return aToken > bToken ? 1 : -1;
      if (aNumeric && !bNumeric) return -1;
      if (!aNumeric && bNumeric) return 1;
      const compare = String(aToken).localeCompare(String(bToken));
      if (compare !== 0) return compare > 0 ? 1 : -1;
    }
    return 0;
  }

  function compareVersions(aValue, bValue) {
    const a = parseSemverLike(aValue);
    const b = parseSemverLike(bValue);
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    const max = Math.max(a.core.length, b.core.length);
    for (let i = 0; i < max; i += 1) {
      const aPart = Number.isFinite(a.core[i]) ? a.core[i] : 0;
      const bPart = Number.isFinite(b.core[i]) ? b.core[i] : 0;
      if (aPart !== bPart) return aPart > bPart ? 1 : -1;
    }
    return comparePreRelease(a.pre, b.pre);
  }

  function parseProductRepoSlug(siteConfig) {
    try {
      const productUrl = String(siteConfig && siteConfig.PRODUCT_URL ? siteConfig.PRODUCT_URL : "").trim();
      if (!productUrl) return null;
      const parsed = new URL(productUrl);
      const slug = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
      return slug || null;
    } catch (_) {
      return null;
    }
  }

  function readConfig() {
    const siteConfig = globalThis.SiteConfig || {};
    const cfg = siteConfig.UPDATE_CHECK || {};
    const fallbackRepo = parseProductRepoSlug(siteConfig) || "";
    const owner = String(cfg.repoOwner || "freeforall1932-design").trim();
    const repo = String(cfg.repoName || fallbackRepo).trim();
    const repoSlug = owner && repo ? owner + "/" + repo : "";
    return {
      enabled: cfg.enabled !== false,
      owner,
      repo,
      apiUrl:
        String(cfg.releaseApiUrl || "").trim() ||
        (repoSlug ? "https://api.github.com/repos/" + repoSlug + "/releases/latest" : ""),
      releaseUrl:
        String(cfg.releasePageUrl || "").trim() ||
        (repoSlug ? "https://github.com/" + repoSlug + "/releases/latest" : ""),
      checkIntervalMs:
        Number.isFinite(Number(cfg.checkIntervalMs)) && Number(cfg.checkIntervalMs) > 0
          ? Number(cfg.checkIntervalMs)
          : DEFAULT_CHECK_INTERVAL_MS,
      requestTimeoutMs:
        Number.isFinite(Number(cfg.requestTimeoutMs)) && Number(cfg.requestTimeoutMs) > 0
          ? Number(cfg.requestTimeoutMs)
          : DEFAULT_TIMEOUT_MS
    };
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(data || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  function setStorage(value) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(value, () => resolve());
      } catch (_) {
        resolve();
      }
    });
  }

  async function tryBackgroundUpdateCheck() {
    return await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: "update/check" }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (response && response.success) {
            resolve(response);
            return;
          }
          resolve(null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function ensureStyle() {
    if (!document || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".update-notice{margin-top:14px;padding:10px;border:1px solid var(--brand-accent,#15d5ff);border-radius:6px;background:rgba(21,213,255,0.1);}",
      ".update-notice-text{color:var(--text-primary,#fff);font-size:12px;line-height:1.4;}",
      ".update-notice-actions{margin-top:8px;display:flex;align-items:center;gap:8px;}",
      ".update-notice-link{color:var(--brand-accent,#15d5ff);text-decoration:none;font-size:12px;font-weight:700;}",
      ".update-notice-link:hover{text-decoration:underline;}",
      ".update-notice-dismiss{margin-left:auto;border:1px solid var(--border-dark,#333);background:var(--bg-darker,#2a2a2a);color:var(--text-subtle,#ccc);border-radius:4px;font-size:11px;padding:4px 8px;cursor:pointer;}",
      ".update-notice-dismiss:hover{border-color:var(--brand-accent,#15d5ff);color:var(--text-primary,#fff);}"
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureBannerElement() {
    const existing = document.getElementById("updateNotice");
    if (existing) return existing;
    const container = document.querySelector(".container") || document.body;
    if (!container) return null;
    const root = document.createElement("div");
    root.id = "updateNotice";
    root.className = "update-notice hidden";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.innerHTML = [
      '<div id="updateNoticeText" class="update-notice-text"></div>',
      '<div class="update-notice-actions">',
      '<a id="updateNoticeLink" class="update-notice-link" href="#" target="_blank" rel="noopener noreferrer">View update</a>',
      '<button id="updateNoticeDismiss" class="update-notice-dismiss" type="button">Dismiss</button>',
      "</div>"
    ].join("");
    container.appendChild(root);
    return root;
  }

  function extractReleaseVersion(payload) {
    const candidates = [
      payload && payload.tag_name ? payload.tag_name : "",
      payload && payload.name ? payload.name : ""
    ]
      .map((value) => normalizeVersion(value))
      .filter(Boolean);
    for (const candidate of candidates) {
      if (/\d/.test(candidate)) return candidate;
    }
    return null;
  }

  async function fetchReleaseFromApi(config) {
    if (!config.apiUrl) {
      return { latestVersion: null, releaseUrl: config.releaseUrl || null, error: "No release API configured." };
    }
    let controller = null;
    let timeoutId = null;
    try {
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      }
      const response = await fetch(config.apiUrl, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        signal: controller ? controller.signal : undefined,
        cache: "no-store"
      });
      if (response.status === 404) {
        return {
          latestVersion: null,
          releaseUrl: config.releaseUrl || null,
          error: "No release found."
        };
      }
      if (!response.ok) {
        return {
          latestVersion: null,
          releaseUrl: config.releaseUrl || null,
          error: "GitHub release lookup failed (" + response.status + ")."
        };
      }
      const payload = await response.json();
      return {
        latestVersion: extractReleaseVersion(payload),
        releaseUrl: String(payload && payload.html_url ? payload.html_url : "").trim() || config.releaseUrl || null,
        error: null
      };
    } catch (error) {
      return {
        latestVersion: null,
        releaseUrl: config.releaseUrl || null,
        error: error && error.message ? error.message : "Update check failed."
      };
    } finally {
      try {
        if (timeoutId) clearTimeout(timeoutId);
      } catch (_) {}
    }
  }

  async function checkForUpdates() {
    const config = readConfig();
    const currentVersion = normalizeVersion(chrome.runtime.getManifest().version);
    if (!config.enabled) {
      return {
        hasUpdate: false,
        currentVersion: currentVersion,
        latestVersion: currentVersion,
        releaseUrl: config.releaseUrl || null,
        source: "disabled"
      };
    }

    const bgResult = await tryBackgroundUpdateCheck();
    if (bgResult && typeof bgResult.hasUpdate === "boolean") {
      return {
        hasUpdate: !!bgResult.hasUpdate,
        currentVersion: normalizeVersion(bgResult.currentVersion || currentVersion),
        latestVersion: normalizeVersion(bgResult.latestVersion || ""),
        releaseUrl: bgResult.releaseUrl || config.releaseUrl || null,
        source: "background",
        error: bgResult.error || null
      };
    }

    const cached = await getStorage([STORAGE_LAST_RESULT_KEY, STORAGE_LAST_CHECKED_AT_KEY]);
    const cachedResult =
      cached &&
      typeof cached[STORAGE_LAST_RESULT_KEY] === "object" &&
      cached[STORAGE_LAST_RESULT_KEY]
        ? cached[STORAGE_LAST_RESULT_KEY]
        : null;
    const cachedCheckedAt = Number(cached && cached[STORAGE_LAST_CHECKED_AT_KEY]) || 0;
    const cacheFresh = cachedResult && cachedCheckedAt > 0 && Date.now() - cachedCheckedAt < config.checkIntervalMs;

    let releaseResult = null;
    let source = "network";

    if (cacheFresh) {
      releaseResult = cachedResult;
      source = "cache";
    } else {
      releaseResult = await fetchReleaseFromApi(config);
      const checkedAt = Date.now();
      await setStorage({
        [STORAGE_LAST_RESULT_KEY]: releaseResult,
        [STORAGE_LAST_CHECKED_AT_KEY]: checkedAt
      });
    }

    const latestVersion = normalizeVersion(releaseResult && releaseResult.latestVersion ? releaseResult.latestVersion : "");
    const hasUpdate = latestVersion && currentVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

    return {
      hasUpdate: !!hasUpdate,
      currentVersion: currentVersion,
      latestVersion: latestVersion || null,
      releaseUrl: (releaseResult && releaseResult.releaseUrl) || config.releaseUrl || null,
      source: source,
      error: releaseResult && releaseResult.error ? releaseResult.error : null
    };
  }

  async function showUpdateBannerIfNeeded() {
    ensureStyle();
    const root = ensureBannerElement();
    if (!root) return;

    const textEl = root.querySelector("#updateNoticeText");
    const linkEl = root.querySelector("#updateNoticeLink");
    const dismissEl = root.querySelector("#updateNoticeDismiss");
    if (!textEl || !linkEl || !dismissEl) return;

    const result = await checkForUpdates();
    if (!result || !result.hasUpdate || !result.latestVersion) {
      root.classList.add("hidden");
      return;
    }

    const dismissed = await getStorage([STORAGE_DISMISSED_VERSION_KEY]);
    const dismissedVersion = normalizeVersion(dismissed && dismissed[STORAGE_DISMISSED_VERSION_KEY]);
    if (dismissedVersion && dismissedVersion === normalizeVersion(result.latestVersion)) {
      root.classList.add("hidden");
      return;
    }

    const current = normalizeVersion(result.currentVersion) || "current";
    const latest = normalizeVersion(result.latestVersion) || "latest";
    textEl.textContent = "Update available: v" + latest + " (installed v" + current + ")";
    linkEl.setAttribute("href", result.releaseUrl || "#");

    dismissEl.addEventListener("click", async () => {
      await setStorage({ [STORAGE_DISMISSED_VERSION_KEY]: latest });
      root.classList.add("hidden");
    });

    root.classList.remove("hidden");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showUpdateBannerIfNeeded);
  } else {
    showUpdateBannerIfNeeded();
  }
})();
