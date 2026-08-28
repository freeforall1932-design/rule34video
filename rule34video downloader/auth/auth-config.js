const authSiteName = (globalThis.SiteConfig && globalThis.SiteConfig.SITE_NAME) || 'Extension';
const authLogger =
  (globalThis.Logger && globalThis.Logger.createLogger(`🔶 [${authSiteName} Auth]`)) ||
  { log: () => {}, warn: () => {}, error: () => {} };

const AUTH_CONFIG = {
  baseUrl: (globalThis.SiteConfig && globalThis.SiteConfig.AUTH_BASE_URL) || 'https://auth.serp.co',
  entitlementName:
    (globalThis.SiteConfig && globalThis.SiteConfig.AUTH_ENTITLEMENT) || 'serp-video-downloader',
  entitlementAliases:
    (globalThis.SiteConfig && globalThis.SiteConfig.AUTH_ENTITLEMENT_ALIASES) || [],
  storagePrefix: (globalThis.SiteConfig && globalThis.SiteConfig.AUTH_STORAGE_PREFIX) || 'auth',
};

export { authSiteName, authLogger, AUTH_CONFIG };
