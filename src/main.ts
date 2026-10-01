import http from 'node:http';
import https from 'node:https';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { loadTlsOptions } from './tls.js';

const DATE_PICKER_JS = `new MutationObserver(() => {
  document.querySelectorAll('tr[data-param-name]').forEach((row) => {
    const input = row.querySelector('input[type=text]');
    if (input && row.querySelector('.parameter__type')?.textContent.includes('$date')) input.type = 'date';
  });
}).observe(document.body, { childList: true, subtree: true });`;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Swagger UI at /api/docs - off in production. Click "Authorize" and paste
  // the token from GetLoginDetails / auth/login (mobile) or GetLogin (admin).
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder().setTitle('CRM API').addBearerAuth().addSecurityRequirements('bearer').build();
    // Swagger UI renders every query param as a text box; switch those declared
    // format: 'date' to the browser's date picker. Served as a file because the CSP
    // (script-src 'self') blocks inline scripts.
    app
      .getHttpAdapter()
      .get('/api/docs-datepicker.js', (_req: unknown, res: { type: (t: string) => { send: (b: string) => void } }) =>
        res.type('application/javascript').send(DATE_PICKER_JS),
      );
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config), {
      customJs: '/api/docs-datepicker.js',
      // Highlighting freezes the browser on big master-data responses (customers is ~1.6 MB).
      swaggerOptions: { persistAuthorization: true, syntaxHighlight: false },
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  const tls = loadTlsOptions();
  if (!tls) {
    await app.listen(port);
    return;
  }

  // HTTPS next to the existing HTTP port (browsers block an https page, like the dashboard, from calling
  // plain http). The certificate is re-read every 6 hours so a renewal needs no restart.
  await app.init();
  const handler = app.getHttpAdapter().getInstance();
  http.createServer(handler).listen(port);
  const httpsPort = Number(process.env.HTTPS_PORT ?? 3443);
  const secure = https.createServer(tls, handler).listen(httpsPort);
  setInterval(() => {
    try {
      secure.setSecureContext(loadTlsOptions()!);
    } catch (err) {
      new Logger('TLS').warn(`certificate reload failed, keeping the old one: ${(err as Error).message}`);
    }
  }, 6 * 60 * 60 * 1000).unref();
  new Logger('TLS').log(`HTTPS on port ${httpsPort} (HTTP on ${port})`);
}
await bootstrap();
