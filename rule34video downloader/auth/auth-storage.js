export function createStorageKeys(prefix = 'auth') {
  return {
    token: `${prefix}:token`,
    entitlements: `${prefix}:entitlements`,
    expiresAt: `${prefix}:expiresAt`,
    sessionToken: `${prefix}:sessionToken`,
    deviceId: `${prefix}:deviceId`,
    lastCheck: `${prefix}:lastCheck`,
    email: `${prefix}:email`,
    activatedFlag: 'isActivated',
  };
}

export async function getOrCreateDeviceId(keys) {
  const existing = await chrome.storage.local.get(keys.deviceId);
  if (existing && existing[keys.deviceId]) return String(existing[keys.deviceId]);
  const id =
    (crypto && typeof crypto.randomUUID === 'function' && crypto.randomUUID()) ||
    `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await chrome.storage.local.set({ [keys.deviceId]: id });
  return id;
}

export async function readStoredAuth(keys) {
  const data = await chrome.storage.local.get([
    keys.token,
    keys.entitlements,
    keys.expiresAt,
    keys.sessionToken,
    keys.deviceId,
    keys.lastCheck,
    keys.email,
  ]);
  return {
    entitlements: data[keys.entitlements] || [],
    token: data[keys.token] || null,
    expiresAt: data[keys.expiresAt] || null,
    sessionToken: data[keys.sessionToken] || null,
    deviceId: data[keys.deviceId] || null,
    lastCheck: data[keys.lastCheck] || null,
    email: data[keys.email] || null,
  };
}
