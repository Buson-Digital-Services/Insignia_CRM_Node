import { describe, expect, it } from 'vitest';
import { routeTenantRequest } from './country-prefix.js';
import type { TenantConfig } from '../common/types.js';

const shops = [
  { code: 'UG', name: 'Uganda', urls: { localURL: 'http://insigniadxb.fortiddns.com:1011/Api/' } },
  { code: 'TZ', name: 'Tanzania', urls: { localURL: 'http://102.69.167.106:80/Api/' } },
  { code: 'ZM', name: 'Zambia', urls: { localURL: 'change-me' } },
] as TenantConfig[];
const svc = {
  list: () => shops,
  find: (c: string) => shops.find((t) => t.code === c.toUpperCase() || t.name.toUpperCase() === c.toUpperCase()),
};
const route = (url: string, host = 'localhost:3000') => routeTenantRequest(host, url, svc);

describe('routeTenantRequest', () => {
  it("routes the shop's own address (localURL host + /Api/) by Host header", () => {
    const host = 'insigniadxb.fortiddns.com:1011';
    expect(route('/Api/GetLoginDetails/admin/pw/dev/fcm', host)).toMatchObject({ url: '/api/GetLoginDetails/admin/pw/dev/fcm', tenant: { code: 'UG' } });
    expect(route('/Api/ItemMaster?whsCode=HOFG', host)).toMatchObject({ url: '/api/ItemMaster?whsCode=HOFG', tenant: { code: 'UG' } });
    expect(route('/api/GetPlanDetails', 'INSIGNIADXB.fortiddns.com:1011')).toMatchObject({ url: '/api/GetPlanDetails', tenant: { code: 'UG' } });
  });

  it('treats a Host without a port as port 80 (Tanzania: http://102.69.167.106:80/Api/)', () => {
    expect(route('/Api/ItemMaster', '102.69.167.106')).toMatchObject({ url: '/api/ItemMaster', tenant: { code: 'TZ' } });
    expect(route('/Api/ItemMaster', '102.69.167.106:80')).toMatchObject({ tenant: { code: 'TZ' } });
    expect(route('/Api/ItemMaster', '102.69.167.106:3000')).toEqual({ url: '/Api/ItemMaster' }); // another port = not that shop
  });

  it('still supports the country in the path, on any host', () => {
    expect(route('/api/Uganda/GetLoginDetails/a/b/c/d')).toMatchObject({ url: '/api/GetLoginDetails/a/b/c/d', tenant: { code: 'UG' } });
    expect(route('/api/uganda/ItemMaster?x=1')).toMatchObject({ url: '/api/ItemMaster?x=1', tenant: { code: 'UG' } });
  });

  it('leaves everything else alone', () => {
    for (const url of ['/api/ItemMaster', '/api/GetUrls/Uganda', '/api/GetLoginDetails/a/b/c/d/Uganda', '/api/docs', '/api/Narnia/ItemMaster']) {
      expect(route(url)).toEqual({ url });
    }
    expect(route('/Api/ItemMaster', undefined as unknown as string)).toEqual({ url: '/Api/ItemMaster' });
  });
});
