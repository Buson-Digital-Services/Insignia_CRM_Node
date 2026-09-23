// Runs before any e2e test file loads. AppModule's ConfigModule/TenantService
// read these eagerly at compile time, so they must exist in process.env
// before Test.createTestingModule() ever touches AppModule - a real .env file
// is not used for tests, this keeps them hermetic and CI-friendly.
const env: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1h',
  EMAIL_HOST: 'localhost',
  EMAIL_PORT: '465',
  EMAIL_USER: 'test@example.com',
  EMAIL_PASSWORD: 'test',
  TENANT_CODES: 'TZ',
  TENANT_TZ_NAME: 'Tanzania',
  TENANT_TZ_DB_SERVER: 'localhost',
  TENANT_TZ_DB_NAME: 'CRM_TZ_TEST',
  TENANT_TZ_DB_USER: 'sa',
  TENANT_TZ_DB_PASSWORD: 'test',
  TENANT_TZ_SAPDB_SERVER: 'localhost',
  TENANT_TZ_SAPDB_NAME: 'SAP_TZ_TEST',
  TENANT_TZ_SAPDB_USER: 'sa',
  TENANT_TZ_SAPDB_PASSWORD: 'test',
};

for (const [key, value] of Object.entries(env)) {
  process.env[key] ??= value;
}
