import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { Mock } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/http-exception.filter.js';
import { DatabaseService } from '../src/database/database.service.js';
import { SapService } from '../src/sap/sap.service.js';

export interface MockDatabaseService {
  execProc: Mock;
  execProcSets: Mock;
  query: Mock;
  withTransaction: Mock;
}

export interface MockSapService {
  verifyCredentials: Mock;
  request: Mock;
}

/**
 * Builds a fully-configured Nest app (same global prefix/pipes/filters as
 * main.ts's bootstrap) with DatabaseService and SapService replaced by test
 * doubles, so e2e tests never touch a real SQL Server or SAP instance.
 */
export async function createTestApp(mocks: { db: MockDatabaseService; sap: MockSapService }): Promise<INestApplication> {
  const builder: TestingModuleBuilder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue(mocks.db)
    .overrideProvider(SapService)
    .useValue(mocks.sap);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );

  await app.init();
  return app;
}
