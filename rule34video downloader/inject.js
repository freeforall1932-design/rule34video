// inject.js
// Generated generic page-data relay stub for Rule 34.
(function () {
  const observedMediaUrls = new Set();

  function toAbsoluteUrl(url) {
    try {
      if (!url) return "";
      return /^https?:\/\//i.test(url) ? url : new URL(url, location.href).toString();
    } catch {
      return url || "";
    }
  }

  function looksPlayable(url) {
    return /\.(?:mp4|m4v|webm|m3u8)(?:$|[?#])/i.test(String(url || "")) || /\/player\/xs1\.php\?data=/i.test(String(url || ""));
  }

  function rememberMediaUrl(url) {
    const absolute = toAbsoluteUrl(url);
    if (absolute && looksPlayable(absolute)) observedMediaUrls.add(absolute);
  }

  try {
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === "function" && !window.__rule34GeneratedFetchRelayInstalled) {
      window.__rule34GeneratedFetchRelayInstalled = true;
      window.fetch = function (...args) {
        try {
          const input = args[0];
          rememberMediaUrl(typeof input === "string" ? input : (input && input.url));
        } catch {}
        return nativeFetch.apply(this, args).then((response) => {
          try { rememberMediaUrl(response && response.url); } catch {}
          try { postPageData(); } catch {}
          return response;
        });
      };
    }
  } catch {}

  try {
    const NativeXHR = window.XMLHttpRequest;
    if (typeof NativeXHR === "function" && !window.__rule34GeneratedXhrRelayInstalled) {
      window.__rule34GeneratedXhrRelayInstalled = true;
      const nativeOpen = NativeXHR.prototype.open;
      NativeXHR.prototype.open = function (method, url, ...rest) {
        try {
          this.__rule34GeneratedUrl = url;
          rememberMediaUrl(url);
        } catch {}
        return nativeOpen.call(this, method, url, ...rest);
      };
      const nativeSend = NativeXHR.prototype.send;
      NativeXHR.prototype.send = function (...args) {
        try {
          this.addEventListener("loadend", () => {
            try {
              rememberMediaUrl(this.responseURL || this.__rule34GeneratedUrl);
              postPageData();
            } catch {}
          });
        } catch {}
        return nativeSend.apply(this, args);
      };
    }
  } catch {}

  function collectPageData() {
    const videos = [];
    try {
      document.querySelectorAll("video, video source[src], source[src]").forEach((node) => {
        const url = node.currentSrc || node.src || node.getAttribute("src") || node.getAttribute("data-src");
        if (url) videos.push(toAbsoluteUrl(url));
      });
    } catch {}
    try {
      performance.getEntriesByType("resource").forEach((entry) => {
        if (entry && entry.name) rememberMediaUrl(entry.name);
      });
    } catch {}
    observedMediaUrls.forEach((url) => videos.push(url));
    let flashvars = null;
    try {
      if (window.flashvars && typeof window.flashvars === "object") {
        flashvars = {};
        ["video_id", "video_title", "rnd", "video_url", "video_url_text", "video_alt_url", "video_alt_url_text", "video_alt_url2", "video_alt_url2_text", "video_alt_url3", "video_alt_url3_text", "preview_url"].forEach((key) => {
          const value = window.flashvars[key];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") flashvars[key] = String(value);
        });
      }
    } catch {}
    return {
      title: document.title || "",
      url: location.href,
      videos: Array.from(new Set(videos)),
      flashvars,
    };
  }

  function postPageData() {
    try {
      window.postMessage({ type: "SERP_GENERATED_PAGE_DATA", data: collectPageData() }, "*");
    } catch {}
  }

  window.addEventListener("message", (event) => {
    if (event?.data?.type === "REQUEST_SERP_GENERATED_PAGE_DATA") postPageData();
  });

  postPageData();
  const pollMs = 0;
  let remainingPolls = 0;
  if (pollMs > 0 && remainingPolls > 0) {
    const timer = setInterval(() => {
      remainingPolls -= 1;
      postPageData();
      if (remainingPolls <= 0) clearInterval(timer);
    }, pollMs);
  }
})();
