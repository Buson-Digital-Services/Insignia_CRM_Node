import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import type { SapIdentity } from '../common/types.js';

interface SapSession {
  client: AxiosInstance;
  cookie: string;
  loginAt: number;
  timeoutMs: number;
}

// SAP B1 Service Layer needs a login per (url, companyDb, username) before any
// call, and that session expires after ~30 min idle. Rather than log in on
// every request, keep one session per unique combo and reuse it, relogging in
// only when it's missing/expired or SAP itself rejects it with 401.
@Injectable()
export class SapService {
  private readonly logger = new Logger(SapService.name);
  private readonly sessions = new Map<string, SapSession>();

  private key(identity: SapIdentity): string {
    return `${identity.sapUrl}|${identity.sapCompanyDb}|${identity.sapUsername}`;
  }

  private async login(identity: SapIdentity): Promise<SapSession> {
    const client = axios.create({
      baseURL: identity.sapUrl,
      httpsAgent: undefined,
      validateStatus: () => true,
    });

    const response = await client.post('Login', {
      CompanyDB: identity.sapCompanyDb,
      UserName: identity.sapUsername,
      Password: identity.sapPassword,
    });

    if (response.status !== 200) {
      throw new Error(
        `SAP login failed for ${identity.sapCompanyDb}/${identity.sapUsername}: ${response.status} ${JSON.stringify(response.data)}`,
      );
    }

    const setCookie = response.headers['set-cookie'] ?? [];
    const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const timeoutMinutes = Number(response.data?.SessionTimeout ?? 30);

    const session: SapSession = {
      client,
      cookie,
      loginAt: Date.now(),
      timeoutMs: timeoutMinutes * 60 * 1000,
    };

    this.sessions.set(this.key(identity), session);
    this.logger.log(`SAP session established for ${identity.sapCompanyDb}/${identity.sapUsername}`);
    return session;
  }

  private isExpired(session: SapSession): boolean {
    // Refresh a little early to avoid racing the real expiry.
    return Date.now() - session.loginAt > session.timeoutMs - 60_000;
  }

  private async ensureSession(identity: SapIdentity): Promise<SapSession> {
    const existing = this.sessions.get(this.key(identity));
    if (existing && !this.isExpired(existing)) {
      return existing;
    }
    return this.login(identity);
  }

  /** Verifies the given SAP credentials work, throwing if not. Used at login time. */
  async verifyCredentials(identity: SapIdentity): Promise<void> {
    await this.ensureSession(identity);
  }

  /** Call any SAP Service Layer resource, e.g. request(identity, 'get', "Items('A001')"). */
  async request<T = unknown>(
    identity: SapIdentity,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    data?: unknown,
  ): Promise<T> {
    let session = await this.ensureSession(identity);

    const send = () =>
      session.client.request<T>({
        method,
        url: path,
        data,
        headers: { Cookie: session.cookie },
        validateStatus: () => true,
      });

    let response = await send();

    if (response.status === 401) {
      // Session expired server-side before our local timer caught it - relogin once.
      session = await this.login(identity);
      response = await send();
    }

    if (response.status >= 400) {
      throw new Error(`SAP Service Layer error on ${method.toUpperCase()} ${path}: ${response.status} ${JSON.stringify(response.data)}`);
    }

    return response.data;
  }
}
