// Ensure global SiteConfig is initialized even when this module is imported from
// a service worker (background) that doesn't explicitly load site-config.js.
import './site-config.js';

import { authSiteName, AUTH_CONFIG } from './auth/auth-config.js';
import { authTelemetryLog, authTelemetryDump, authTelemetryClear } from './auth/auth-telemetry.js';
import { hasAnyEntitlement, resolveEntitlementNames } from './auth/auth-token.js';
import { getOrCreateDeviceId, readStoredAuth } from './auth/auth-storage.js';
import {
  requestSignInOtp,
  login,
  checkEntitlement,
  trialStatus,
  trialConsume,
  registerAuthMessageListener,
  storageKeys,
} from './auth/auth-api.js';

async function getTrialStatus() {
  const stored = await readStoredAuth(storageKeys);
  const sessionToken = stored.sessionToken;
  if (!sessionToken) return { ok: false, remaining: 0 };
  const deviceId = stored.deviceId || (await getOrCreateDeviceId(storageKeys));
  return trialStatus({
    baseUrl: AUTH_CONFIG.baseUrl,
    sessionToken,
    deviceId,
    entitlement: AUTH_CONFIG.entitlementName,
  });
}

async function consumeTrial() {
  const stored = await readStoredAuth(storageKeys);
  const sessionToken = stored.sessionToken;
  if (!sessionToken) throw new Error('Please sign in to start your free trial.');
  const deviceId = stored.deviceId || (await getOrCreateDeviceId(storageKeys));
  return trialConsume({
    baseUrl: AUTH_CONFIG.baseUrl,
    sessionToken,
    deviceId,
    entitlement: AUTH_CONFIG.entitlementName,
  });
}

const Auth = {
  requestCode: async (email) => {
    if (!email) throw new Error('Email is required');
    authTelemetryLog('auth.otp.request', { email, ctx: AUTH_CONFIG.storagePrefix });
    try {
      await requestSignInOtp({ baseUrl: AUTH_CONFIG.baseUrl, email });
      authTelemetryLog('auth.otp.sent', { email, ctx: AUTH_CONFIG.storagePrefix });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      authTelemetryLog('auth.otp.error', { email, error: message, ctx: AUTH_CONFIG.storagePrefix });
      throw err;
    }
  },
  activate: async ({ email, code }) => {
    if (!email || !code) throw new Error('Email and code are required');
    return login(email, code, storageKeys);
  },
  activateLicense: async (licenseKey, email) => {
    if (!email) return { success: false, error: 'Email is required' };
    if (!licenseKey) {
      await requestSignInOtp({ baseUrl: AUTH_CONFIG.baseUrl, email });
      return { success: false, error: 'Code sent. Please enter the verification code.' };
    }
    try {
      const res = await login(email, licenseKey, storageKeys);
      const entitled = hasAnyEntitlement(
        res.entitlements || res.token,
        AUTH_CONFIG.entitlementName,
        AUTH_CONFIG.entitlementAliases
      );
      if (!entitled) {
        await chrome.storage.local.set({ [storageKeys.activatedFlag]: false });
        return { success: false, error: `This email does not have access to ${authSiteName}.` };
      }
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || 'Activation failed' };
    }
  },
  hasEntitlement: async (scope) => {
    const res = await checkEntitlement(
      scope || resolveEntitlementNames(AUTH_CONFIG.entitlementName, AUTH_CONFIG.entitlementAliases),
      storageKeys
    );
    return Boolean(res.ok);
  },
  checkActivation: async () => {
    const res = await checkEntitlement(
      resolveEntitlementNames(AUTH_CONFIG.entitlementName, AUTH_CONFIG.entitlementAliases),
      storageKeys
    );
    if (res.ok) return { isActivated: true, mode: 'paid' };

    try {
      const trial = await getTrialStatus();
      const remaining = Number(trial?.remaining) || 0;
      const ok = Boolean(trial?.ok) && remaining > 0;
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: ok });
      return { isActivated: ok, mode: ok ? 'trial' : 'none', remaining };
    } catch {
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: false });
      return { isActivated: false, mode: 'none' };
    }
  },
  checkActivationStatus: async () => {
    const res = await checkEntitlement(
      resolveEntitlementNames(AUTH_CONFIG.entitlementName, AUTH_CONFIG.entitlementAliases),
      storageKeys
    );
    const stored = await readStoredAuth(storageKeys);
    if (res.ok) {
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: true });
      return {
        isActivated: true,
        mode: 'paid',
        remaining: null,
        licenseKey: null,
        email: stored.email || null,
      };
    }

    try {
      const trial = await getTrialStatus();
      const remaining = Number(trial?.remaining) || 0;
      const ok = Boolean(trial?.ok) && remaining > 0;
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: ok });
      return {
        isActivated: ok,
        mode: ok ? 'trial' : 'none',
        remaining,
        licenseKey: null,
        email: stored.email || null,
      };
    } catch {
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: false });
      return {
        isActivated: false,
        mode: 'none',
        remaining: null,
        licenseKey: null,
        email: stored.email || null,
      };
    }
  },
  ensureDownloadAccess: async () => {
    // Prefer entitlement check first (paid users should never consume trial).
    const res = await checkEntitlement(
      resolveEntitlementNames(AUTH_CONFIG.entitlementName, AUTH_CONFIG.entitlementAliases),
      storageKeys
    );
    if (res.ok) {
      await chrome.storage.local.set({ [storageKeys.activatedFlag]: true });
      return { ok: true, mode: 'paid', remaining: null };
    }

    const consumed = await consumeTrial();
    const allowed = Boolean(consumed?.allowed);
    const remaining = Number(consumed?.remaining) || 0;
    // If this was the last free download, remaining will be 0 *after* consume.
    // We still allow this request, but future actions should be gated.
    await chrome.storage.local.set({ [storageKeys.activatedFlag]: allowed });
    if (!allowed) {
      throw new Error('Free trial used up. Please purchase access to continue.');
    }
    return { ok: true, mode: 'trial', remaining };
  },
  deactivate: async () => {
    try {
      await chrome.storage.local.remove(Object.values(storageKeys));
    } catch {}
  },
  registerAuthMessageListener: () => registerAuthMessageListener(storageKeys),
  telemetryDump: () => authTelemetryDump(),
  telemetryClear: () => authTelemetryClear(),
  storageKeys,
  config: AUTH_CONFIG,
};

globalThis.Auth = Auth;
