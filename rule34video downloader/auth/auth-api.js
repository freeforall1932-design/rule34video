import { AUTH_CONFIG, authLogger } from './auth-config.js';
import { authTelemetryLog, authTelemetryDump, authTelemetryClear } from './auth-telemetry.js';
import {
  parseToken,
  hasAnyEntitlement,
  resolveEntitlementNames,
  isTokenFresh,
} from './auth-token.js';
import { createStorageKeys, getOrCreateDeviceId, readStoredAuth } from './auth-storage.js';

function getFetch(fetchImpl) {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch !== 'undefined') return fetch;
  throw new Error('fetch is not available; provide fetchImpl');
}

export async function requestSignInOtp({ baseUrl, email, fetchImpl }) {
  const fetchFn = getFetch(fetchImpl);
  const res = await fetchFn(new URL('/api/auth/email-otp/send-verification-otp', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OTP request failed (${res.status}): ${text || res.statusText}`);
  }
}

export async function signInWithOtp({ baseUrl, email, code, fetchImpl }) {
  const fetchFn = getFetch(fetchImpl);
  const res = await fetchFn(new URL('/api/auth/sign-in/email-otp', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, otp: code }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OTP verify failed (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json().catch(() => ({}));
  const sessionToken = data.sessionToken || data.session_token || data.token;
  if (!sessionToken) throw new Error('Missing sessionToken in response');
  return { sessionToken, raw: data };
}

export async function exchangeSessionForToken({ baseUrl, sessionToken, deviceId, fetchImpl }) {
  if (!sessionToken) throw new Error('sessionToken is required');
  if (!deviceId) throw new Error('deviceId is required');
  const fetchFn = getFetch(fetchImpl);
  const res = await fetchFn(new URL('/auth/token', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken, deviceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Auth failed (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json().catch(() => ({}));
  const entitlements = Array.isArray(data.entitlements)
    ? data.entitlements
    : (() => {
        try {
          return parseToken(data.token).payload.entitlements || [];
        } catch {
          return [];
        }
      })();
  return {
    token: data.token || '',
    entitlements,
    expiresAt: data.expiresAt || data.expires_at || null,
    customerId: data.customerId || data.customer_id || null,
  };
}

export async function trialStatus({ baseUrl, sessionToken, deviceId, entitlement, fetchImpl }) {
  if (!sessionToken) throw new Error('sessionToken is required');
  if (!deviceId) throw new Error('deviceId is required');
  if (!entitlement) throw new Error('entitlement is required');
  const fetchFn = getFetch(fetchImpl);
  const res = await fetchFn(new URL('/trial/status', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken, deviceId, entitlement }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trial status failed (${res.status}): ${text || res.statusText}`);
  }
  return await res.json().catch(() => ({}));
}

export async function trialConsume({ baseUrl, sessionToken, deviceId, entitlement, fetchImpl }) {
  if (!sessionToken) throw new Error('sessionToken is required');
  if (!deviceId) throw new Error('deviceId is required');
  if (!entitlement) throw new Error('entitlement is required');
  const fetchFn = getFetch(fetchImpl);
  const res = await fetchFn(new URL('/trial/consume', baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionToken, deviceId, entitlement }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Trial consume failed (${res.status}): ${text || res.statusText}`);
  }
  return await res.json().catch(() => ({}));
}

export async function login(email, code, keys) {
  const deviceId = await getOrCreateDeviceId(keys);
  authLogger.log('authLogin', { email, deviceId });
  authTelemetryLog('auth.verify.submit', { email, deviceId, ctx: AUTH_CONFIG.storagePrefix });
  const { sessionToken, raw } = await signInWithOtp({
    baseUrl: AUTH_CONFIG.baseUrl,
    email,
    code,
  });

  // NOTE: For free trial users we still want to keep the Better Auth session token,
  // even if /auth/token fails due to missing entitlements (or missing customer record).
  let token = '';
  let entitlements = [];
  let expiresAt = null;
  try {
    const exchanged = await exchangeSessionForToken({
      baseUrl: AUTH_CONFIG.baseUrl,
      sessionToken,
      deviceId,
    });
    token = exchanged.token || '';
    entitlements = exchanged.entitlements || [];
    expiresAt = exchanged.expiresAt || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    authTelemetryLog('auth.token.exchange.error', { error: message, ctx: AUTH_CONFIG.storagePrefix });
    authLogger.warn('Token exchange failed (trial user or missing entitlements)', message);
  }

  const entitled = hasAnyEntitlement(entitlements, AUTH_CONFIG.entitlementName, AUTH_CONFIG.entitlementAliases);

  await chrome.storage.local.set({
    [keys.token]: token,
    [keys.entitlements]: entitlements,
    [keys.expiresAt]: expiresAt,
    [keys.sessionToken]: sessionToken,
    [keys.deviceId]: deviceId,
    [keys.lastCheck]: Date.now(),
    [keys.email]: email,
    [keys.activatedFlag]: Boolean(entitled),
  });

  authTelemetryLog('auth.storage.write', {
    hasToken: !!token,
    entitlementsCount: (entitlements || []).length,
    hasExpiresAt: !!expiresAt,
    hasSessionToken: !!sessionToken,
    deviceIdSet: !!deviceId,
    ctx: AUTH_CONFIG.storagePrefix,
  });

  return { token, entitlements, expiresAt, deviceId, sessionToken, raw };
}

async function refreshWithSessionToken(keys, sessionToken, deviceId, name) {
  try {
    const refreshed = await exchangeSessionForToken({
      baseUrl: AUTH_CONFIG.baseUrl,
      sessionToken,
      deviceId,
    });
    const entitled = hasAnyEntitlement(
      refreshed.entitlements || refreshed.token,
      name,
      AUTH_CONFIG.entitlementAliases
    );
    await chrome.storage.local.set({
      [keys.token]: refreshed.token,
      [keys.entitlements]: refreshed.entitlements,
      [keys.expiresAt]: refreshed.expiresAt,
      [keys.sessionToken]: sessionToken,
      [keys.deviceId]: deviceId,
      [keys.lastCheck]: Date.now(),
      [keys.activatedFlag]: Boolean(entitled),
    });
    authTelemetryLog('auth.check.refresh', {
      name,
      ok: Boolean(entitled),
      entitlementsCount: (refreshed.entitlements || []).length,
      expiresAt: refreshed.expiresAt,
      ctx: AUTH_CONFIG.storagePrefix,
    });
    return {
      ok: Boolean(entitled),
      token: refreshed.token,
      entitlements: refreshed.entitlements,
      expiresAt: refreshed.expiresAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    authTelemetryLog('auth.check.refresh.error', { name, error: message, ctx: AUTH_CONFIG.storagePrefix });
    authLogger.warn('Session refresh failed', message);
    return null;
  }
}

export async function checkEntitlement(name, keys) {
  const stored = await readStoredAuth(keys);
  authTelemetryLog('auth.storage.read', {
    name,
    hasToken: !!stored.token,
    entitlementsCount: (stored.entitlements || []).length,
    hasSessionToken: !!stored.sessionToken,
    hasExpiresAt: !!stored.expiresAt,
    lastCheck: stored.lastCheck,
    ctx: AUTH_CONFIG.storagePrefix,
  });
  const deviceId = stored.deviceId || (await getOrCreateDeviceId(keys));

  if (stored.sessionToken) {
    const refreshed = await refreshWithSessionToken(keys, stored.sessionToken, deviceId, name);
    if (refreshed) return refreshed;
  }

  const hasEnt = hasAnyEntitlement(stored.entitlements || stored.token, name, AUTH_CONFIG.entitlementAliases);
  const notExpired = !stored.expiresAt || isTokenFresh(stored.expiresAt);
  const stillValid = stored.token && hasEnt && notExpired;
  if (stillValid) {
    await chrome.storage.local.set({ [keys.activatedFlag]: true });
    authTelemetryLog('auth.check.cached', {
      name,
      ok: true,
      entitlementsCount: (stored.entitlements || []).length,
      expiresAt: stored.expiresAt,
      ctx: AUTH_CONFIG.storagePrefix,
    });
    return { ok: true, token: stored.token, entitlements: stored.entitlements, expiresAt: stored.expiresAt };
  }

  await chrome.storage.local.set({ [keys.activatedFlag]: false });
  authTelemetryLog('auth.check.failed', {
    name,
    hasToken: !!stored.token,
    hasEnt,
    notExpired,
    reason: !stored.token ? 'missing-token' : !hasEnt ? 'missing-entitlement' : !notExpired ? 'expired' : 'unknown',
    ctx: AUTH_CONFIG.storagePrefix,
  });
  return { ok: false, token: null, entitlements: [], expiresAt: null };
}

export function registerAuthMessageListener(keys) {
  const handler = (request, _sender, sendResponse) => {
    if (request?.type === 'auth/telemetry/dump') {
      authTelemetryDump()
        .then((events) => sendResponse?.({ ok: true, events }))
        .catch((err) => sendResponse?.({ ok: false, error: err?.message || String(err) }));
      return true;
    }
    if (request?.type === 'auth/telemetry/clear') {
      authTelemetryClear()
        .then(() => sendResponse?.({ ok: true }))
        .catch((err) => sendResponse?.({ ok: false, error: err?.message || String(err) }));
      return true;
    }
    if (request?.type === 'auth/login') {
      authTelemetryLog('auth.otp.request', { email: request.email, ctx: AUTH_CONFIG.storagePrefix });
      requestSignInOtp({ baseUrl: AUTH_CONFIG.baseUrl, email: request.email })
        .then(() => {
          authTelemetryLog('auth.otp.sent', { email: request.email, ctx: AUTH_CONFIG.storagePrefix });
          sendResponse?.({ ok: true, step: 'code-sent' });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          authTelemetryLog('auth.otp.error', { email: request.email, error: message, ctx: AUTH_CONFIG.storagePrefix });
          sendResponse?.({ ok: false, error: message });
        });
      return true;
    }
    if (request?.type === 'auth/verify') {
      authTelemetryLog('auth.verify.request', { email: request.email, ctx: AUTH_CONFIG.storagePrefix });
      login(request.email, request.code, keys)
        .then((res) => {
          authTelemetryLog('auth.verify.success', {
            email: request.email,
            entitlementsCount: (res?.entitlements || []).length,
            hasToken: !!res?.token,
            hasExpiresAt: !!res?.expiresAt,
            ctx: AUTH_CONFIG.storagePrefix,
          });
          sendResponse?.({ ok: true, ...res });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          authTelemetryLog('auth.verify.error', { email: request.email, error: message, ctx: AUTH_CONFIG.storagePrefix });
          sendResponse?.({ ok: false, error: message });
        });
      return true;
    }
    if (request?.type === 'auth/check') {
      (async () => {
        // Trial-aware check: prefer Auth.checkActivation/Status if present.
        const auth = globalThis.Auth;
        if (auth && typeof auth.checkActivationStatus === 'function') {
          const status = await auth.checkActivationStatus();
          return { ok: !!status?.isActivated, mode: status?.mode || null, remaining: status?.remaining ?? null };
        }
        if (auth && typeof auth.checkActivation === 'function') {
          const status = await auth.checkActivation();
          return { ok: !!status?.isActivated, mode: status?.mode || null, remaining: status?.remaining ?? null };
        }
    
        const res = await checkEntitlement(request.name || AUTH_CONFIG.entitlementName, keys);
        return { ok: res.ok, token: res.token, entitlements: res.entitlements, expiresAt: res.expiresAt };
      })()
        .then((res) => sendResponse?.(res))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          sendResponse?.({ ok: false, error: message });
        });
      return true;
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export const storageKeys = createStorageKeys(AUTH_CONFIG.storagePrefix);

export { resolveEntitlementNames };
