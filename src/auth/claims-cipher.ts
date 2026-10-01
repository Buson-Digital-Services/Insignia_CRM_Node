import { createCipheriv, createDecipheriv } from 'node:crypto';

// Legacy .NET AesService.encrptypturl: AES-256-ECB/PKCS7, UTF-8 key, base64 text.
// The login JWT carries only { encryptedClaims }; the web dashboard and JwtStrategy both decrypt it.
export const NAME_ID_CLAIM = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier';

export function encryptClaims(key: string, claims: Record<string, string>): string {
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null);
  return Buffer.concat([cipher.update(JSON.stringify(claims), 'utf8'), cipher.final()]).toString('base64');
}

export function decryptClaims(key: string, encrypted: string): Record<string, string> {
  const decipher = createDecipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8'));
}
