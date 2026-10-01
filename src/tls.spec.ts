import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTlsOptions } from './tls.js';

const dir = mkdtempSync(join(tmpdir(), 'tls-'));
const file = (name: string, text: string) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
};

describe('loadTlsOptions', () => {
  it('is off (HTTP only) when no certificate is configured', () => {
    expect(loadTlsOptions({})).toBeUndefined();
    expect(loadTlsOptions({ TLS_CERT_FILE: file('c.pem', 'x') })).toBeUndefined(); // a cert without its key is not a configuration
  });

  it('reads PEM files, or a PFX with its password', () => {
    const pem = loadTlsOptions({ TLS_CERT_FILE: file('c.pem', 'CERT'), TLS_KEY_FILE: file('k.pem', 'KEY') });
    expect([pem?.cert?.toString(), pem?.key?.toString()]).toEqual(['CERT', 'KEY']);
    const pfx = loadTlsOptions({ TLS_PFX_FILE: file('c.pfx', 'PFX'), TLS_PFX_PASSWORD: 'pw' });
    expect([pfx?.pfx?.toString(), pfx?.passphrase]).toEqual(['PFX', 'pw']);
  });

  it('throws on an unreadable file instead of quietly serving plain HTTP', () => {
    expect(() => loadTlsOptions({ TLS_PFX_FILE: join(dir, 'missing.pfx') })).toThrow();
  });
});
