import type { TenantConfig } from '../common/types.js';

type Shops = { find(codeOrName: string): TenantConfig | undefined; list(): TenantConfig[] };

// After GetUrls, the app sends every call to the shop's localURL. Two forms are supported:
//  1. http://<any host>/api/<Country>/...            - country in the path
//  2. the shop's own address, e.g. http://insigniadxb.fortiddns.com:1011/Api/...
//     (one public port per shop, forwarded here) - country from the Host header
// Both are mapped onto the normal routes (<base><route> -> /api/<route>) and the shop is
// returned so pre-login routes and the guards know it. Anything else is left alone.
export function routeTenantRequest(host: string | undefined, url: string, shops: Shops): { url: string; tenant?: TenantConfig } {
  const m = /^\/api\/([^/?]+)(\/.*)?$/i.exec(url);
  const byPath = m ? shops.find(decodeURIComponent(m[1])) : undefined;
  if (m && byPath) {
    return { url: `/api${m[2] ?? '/'}`, tenant: byPath };
  }

  const reqHost = hostOf(host);
  if (reqHost) {
    const lowerUrl = url.toLowerCase();
    for (const t of shops.list()) {
      const base = parse(t.urls.localURL);
      const prefix = base?.pathname.toLowerCase().replace(/\/?$/, '/');
      if (base && prefix && prefix !== '/' && base.host === reqHost && lowerUrl.startsWith(prefix)) {
        return { url: `/api${url.slice(prefix.length - 1)}`, tenant: t };
      }
    }
  }
  return { url };
}


const parse = (u: string) => {
  try {
    return new URL(u);
  } catch {
    return undefined; // e.g. a placeholder localURL in .env
  }
};

// Normalised host[:port] the way URL.host writes it (default port 80 dropped).
const hostOf = (h?: string) => (h ? parse(`http://${h}`)?.host.toLowerCase() : undefined);
