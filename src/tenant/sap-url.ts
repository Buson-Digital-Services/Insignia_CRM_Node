import type { TenantConfig } from '../common/types.js';

/**
 * The Service Layer address a user of this shop connects to. With TENANT_<CODE>_SAP_URL_FROM_ENV=true that is always
 * the shop's TENANT_<CODE>_SAP_URL and the stored address is ignored. Otherwise it is the user's stored SAPUrl as this
 * shop reaches it. TENANT_<CODE>_SAP_URL_FROM lists the address forms the Users
 * rows may hold (comma-separated, e.g. both https://host:50000/ and http://host:50001/); the first one the stored
 * URL starts with is replaced by TENANT_<CODE>_SAP_URL_TO.
 */
export function effectiveSapUrl(tenant: TenantConfig, stored: string): string {
  if (tenant.sapUrlFromEnv) return tenant.sap.sapUrl;
  const r = tenant.sapUrlRedirect;
  const from = r?.from.find((f) => stored?.toLowerCase().startsWith(f.toLowerCase()));
  return r && from ? r.to + stored.slice(from.length) : stored;
}
