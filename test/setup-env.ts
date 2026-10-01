// Runs before any e2e test file loads. AppModule's ConfigModule/TenantService
// read these eagerly at compile time, so they must exist in process.env
// before Test.createTestingModule() ever touches AppModule. Values are assigned
// unconditionally (not from the real .env) so the tests are hermetic and CI-friendly.
const env: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '1h',
  JWT_CLAIMS_KEY: '0123456789abcdef0123456789abcdef',
  EMAIL_HOST: 'localhost',
  EMAIL_PORT: '465',
  EMAIL_USER: 'test@example.com',
  EMAIL_PASSWORD: 'test',
  TENANT_CODES: 'TZ,KE,UG',
};

for (const [code, name] of [
  ['TZ', 'Tanzania'],
  ['KE', 'Kenya'],
  ['UG', 'Uganda'],
]) {
  const p = `TENANT_${code}`;
  Object.assign(env, {
    [`${p}_NAME`]: name,
    [`${p}_QUERY_URL`]: `http://test/${code}/query`,
    [`${p}_LOCAL_URL`]: `http://test:3000/api/${name}/`,
    [`${p}_REPORT_URL`]: `http://test/${code}/report`,
    [`${p}_SCHEME_REQ`]: 'false',
    [`${p}_DB_SERVER`]: 'localhost',
    [`${p}_DB_NAME`]: `CRM_${code}_TEST`,
    [`${p}_DB_USER`]: 'sa',
    [`${p}_DB_PASSWORD`]: 'test',
    [`${p}_SAPDB_SERVER`]: 'localhost',
    [`${p}_SAPDB_NAME`]: `SAP_${code}_TEST`,
    [`${p}_SAPDB_USER`]: 'sa',
    [`${p}_SAPDB_PASSWORD`]: 'test',
    [`${p}_SAP_URL`]: 'http://test-sl/b1s/v1/',
    [`${p}_SAP_COMPANYDB`]: `SAP_${code}_TEST`,
    [`${p}_SAP_USER`]: 'manager',
    [`${p}_SAP_PASSWORD`]: 'test',
    // optional per-shop settings: blank so a real .env can't leak in
    [`${p}_SAP_URL_FROM`]: '',
    [`${p}_SAP_URL_TO`]: '',
    [`${p}_SAP_COMPANYDB_FOR_USERS`]: '',
    [`${p}_DB_DOMAIN`]: '',
    [`${p}_SAPDB_DOMAIN`]: '',
  });
}

Object.assign(process.env, env);
