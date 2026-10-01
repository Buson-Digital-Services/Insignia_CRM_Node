import { readFileSync } from 'node:fs';
import type { ServerOptions } from 'node:https';

/**
 * HTTPS certificate from the environment, or undefined when none is configured (HTTP only).
 *   TLS_PFX_FILE (+ TLS_PFX_PASSWORD)   - a .pfx exported from Windows / a CA
 *   TLS_CERT_FILE + TLS_KEY_FILE        - PEM files (full chain + private key), e.g. from win-acme
 * A configured-but-unreadable file throws, so a typo stops the start instead of silently serving HTTP.
 */
export function loadTlsOptions(env: NodeJS.ProcessEnv = process.env): ServerOptions | undefined {
  if (env.TLS_PFX_FILE) {
    return { pfx: readFileSync(env.TLS_PFX_FILE), passphrase: env.TLS_PFX_PASSWORD || undefined };
  }
  if (env.TLS_CERT_FILE && env.TLS_KEY_FILE) {
    return { cert: readFileSync(env.TLS_CERT_FILE), key: readFileSync(env.TLS_KEY_FILE) };
  }
  return undefined;
}
