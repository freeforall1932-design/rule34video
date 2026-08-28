import { AUTH_CONFIG } from './auth-config.js';

const AUTH_TELEMETRY_STORAGE_KEY = `telemetry:auth:${AUTH_CONFIG.storagePrefix}`;
const AUTH_TELEMETRY_LIMIT = 300;
const AUTH_TELEMETRY_PATH = '/telemetry/auth';

function redactAuthTelemetryData(data) {
  if (!data || typeof data !== 'object') return data;
  const clone = { ...data };
  Object.keys(clone).forEach((key) => {
    if (/token|authorization|cookie/i.test(key)) clone[key] = '[redacted]';
  });
  return clone;
}

async function authTelemetryRead() {
  try {
    const res = await chrome.storage.local.get(AUTH_TELEMETRY_STORAGE_KEY);
    const entries = res && res[AUTH_TELEMETRY_STORAGE_KEY];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

async function authTelemetryWrite(entries) {
  try {
    await chrome.storage.local.set({ [AUTH_TELEMETRY_STORAGE_KEY]: entries });
  } catch {}
}

function authTelemetrySend(evt, data) {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'TELEMETRY_LOG', evt, source: 'auth', data });
    }
  } catch {}
}

function authTelemetryEndpoint() {
  try {
    if (globalThis.SiteConfig && globalThis.SiteConfig.AUTH_TELEMETRY_URL) {
      return String(globalThis.SiteConfig.AUTH_TELEMETRY_URL);
    }
    const base = String(AUTH_CONFIG.baseUrl || '').replace(/\/$/, '');
    return base ? `${base}${AUTH_TELEMETRY_PATH}` : null;
  } catch {
    return null;
  }
}

function authShouldSendRemote(evt) {
  return String(evt || '').includes('.error') || String(evt || '').endsWith('.failed');
}

function authTelemetrySendRemote(evt, data) {
  const endpoint = authTelemetryEndpoint();
  if (!endpoint) return;
  try {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ts: Date.now(), evt, ctx: AUTH_CONFIG.storagePrefix, data }),
      keepalive: true,
      mode: 'no-cors',
    }).catch(() => {});
  } catch {}
}

export function authTelemetryLog(evt, data) {
  const payload = redactAuthTelemetryData({ ...data, ctx: AUTH_CONFIG.storagePrefix });
  const entry = {
    ts: Date.now(),
    evt,
    source: 'auth',
    ctx: AUTH_CONFIG.storagePrefix,
    data: payload,
  };
  authTelemetrySend(evt, payload);
  if (authShouldSendRemote(evt)) authTelemetrySendRemote(evt, payload);
  (async () => {
    const entries = await authTelemetryRead();
    entries.push(entry);
    if (entries.length > AUTH_TELEMETRY_LIMIT) {
      entries.splice(0, entries.length - AUTH_TELEMETRY_LIMIT);
    }
    await authTelemetryWrite(entries);
  })();
}

export async function authTelemetryDump() {
  return await authTelemetryRead();
}

export async function authTelemetryClear() {
  await authTelemetryWrite([]);
}
