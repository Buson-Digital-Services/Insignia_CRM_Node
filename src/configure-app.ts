import { type INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { TenantService } from './tenant/tenant.service.js';
import { routeTenantRequest } from './tenant/country-prefix.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

/** Everything that shapes request handling - shared by main.ts and the e2e test app. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // Served over plain HTTP on the LAN IP, so drop helmet's upgrade-insecure-requests:
  // it makes browsers fetch Swagger's CSS/JS over https:// (blank page). Remove the
  // override once the API sits behind HTTPS.
  // HSTS without includeSubDomains: over HTTPS on a company domain, browsers would otherwise force HTTPS
  // on every other subdomain of it, including sites that are still plain HTTP.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
      strictTransportSecurity: { maxAge: 15_552_000, includeSubDomains: false },
    }),
  );
  app.enableCors();

  // Every call after GetUrls goes to the shop's localURL - its own address (e.g.
  // http://insigniadxb.fortiddns.com:1011/Api/) or http://<host>/api/<Country>/. Route it to the
  // normal endpoint and remember the shop so the guards can match it to the token.
  const tenants = app.get(TenantService);
  app.use((req: Request & { tenantFromUrl?: string }, _res: Response, next: NextFunction) => {
    const routed = routeTenantRequest(req.headers.host, req.url, tenants);
    if (routed.tenant) {
      req.url = routed.url;
      req.tenantFromUrl = routed.tenant.code;
    }
    // ASP.NET matched query names case-insensitively (?Docentry= / ?docentry=); handlers read lower-case names.
    const q = req.url.indexOf('?');
    if (q >= 0) {
      req.url = req.url.slice(0, q + 1) + req.url.slice(q + 1).replace(/(^|&)([^=&]+)/g, (_m, sep: string, key: string) => sep + key.toLowerCase());
    }
    next();
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
