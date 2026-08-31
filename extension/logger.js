// logger.js - centralized logging utility with global log level from SiteConfig
(function () {
  const ranks = { debug: 10, log: 20, warn: 30, error: 40, none: 100 };

  const getLevel = () => {
    try {
      return (globalThis.SiteConfig && globalThis.SiteConfig.LOG_LEVEL) || "none";
    } catch {
      return "none";
    }
  };

  const shouldMirror = () => {
    try {
      return !!(globalThis.SiteConfig && globalThis.SiteConfig.LOG_MIRROR_TO_BG);
    } catch {
      return false;
    }
  };

  const isWorker = typeof window === "undefined" || !globalThis.document;

  function allowed(level) {
    return (ranks[level] || 100) >= (ranks[getLevel()] || 100);
  }

  function safeArg(value) {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (_key, innerValue) => {
        if (typeof innerValue === "function") return `[Function ${innerValue.name || "anonymous"}]`;
        if (typeof innerValue === "symbol") return innerValue.toString();
        if (innerValue && typeof innerValue === "object") {
          if (seen.has(innerValue)) return "[Circular]";
          seen.add(innerValue);
        }
        return innerValue;
      });
      return JSON.parse(json);
    } catch {
      try {
        return String(value);
      } catch {
        return "[unserializable]";
      }
    }
  }

  function ignoredRuntimeSendError(error) {
    const message = String((error && error.message) || error || "");
    return /Receiving end does not exist|Could not establish connection|message port closed/i.test(message);
  }

  function mirror(level, prefix, args) {
    if (!shouldMirror() || isWorker) return;
    try {
      if (!(globalThis.chrome && chrome.runtime && chrome.runtime.sendMessage)) return;
      const serial = (args || []).map(safeArg);
      const pageUrl = typeof location !== "undefined" && location && location.href ? location.href : "";
      const maybePromise = chrome.runtime.sendMessage({
        type: "LOG_MIRROR",
        level,
        prefix: prefix || "",
        args: serial,
        pageUrl,
        ts: Date.now(),
      });
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch((error) => {
          if (!ignoredRuntimeSendError(error)) {
            try {
              console.debug("[RULE34 Logger] LOG_MIRROR failed:", error);
            } catch {}
          }
        });
      }
    } catch {}
  }

  function createLogger(prefix = "") {
    const normalizedPrefix = prefix ? String(prefix) : "";
    return {
      debug: (...args) => {
        if (allowed("debug")) {
          try {
            console.debug(normalizedPrefix, ...args);
          } catch {}
          mirror("debug", normalizedPrefix, args);
        }
      },
      log: (...args) => {
        if (allowed("log")) {
          try {
            console.log(normalizedPrefix, ...args);
          } catch {}
          mirror("log", normalizedPrefix, args);
        }
      },
      warn: (...args) => {
        if (allowed("warn")) {
          try {
            console.warn(normalizedPrefix, ...args);
          } catch {}
          mirror("warn", normalizedPrefix, args);
        }
      },
      error: (...args) => {
        if (allowed("error")) {
          try {
            console.error(normalizedPrefix, ...args);
          } catch {}
          mirror("error", normalizedPrefix, args);
        }
      },
      level: () => getLevel(),
    };
  }

  globalThis.Logger = { createLogger };
})();
