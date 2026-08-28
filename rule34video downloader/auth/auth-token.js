function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) throw new Error('Invalid JWT');
  return {
    payload: JSON.parse(decodeBase64Url(parts[1])),
  };
}

export function hasEntitlement(tokenOrEntitlements, name) {
  if (!name) return true;
  if (Array.isArray(tokenOrEntitlements)) return tokenOrEntitlements.includes(name);
  try {
    const payload = parseToken(tokenOrEntitlements).payload || {};
    return Array.isArray(payload.entitlements) && payload.entitlements.includes(name);
  } catch {
    return false;
  }
}

export function resolveEntitlementNames(names, aliases = []) {
  const list = Array.isArray(names) ? names : [names];
  return [...new Set([...list, ...(aliases || [])].filter(Boolean))];
}

export function hasAnyEntitlement(tokenOrEntitlements, names, aliases = []) {
  const list = resolveEntitlementNames(names, aliases);
  if (!list.length) return true;
  return list.some((name) => hasEntitlement(tokenOrEntitlements, name));
}

export function isTokenFresh(expiresAt) {
  if (!expiresAt) return false;
  const expMs = Date.parse(expiresAt);
  if (Number.isNaN(expMs)) return false;
  return expMs > Date.now();
}
