import { Injectable } from '@nestjs/common';
import type { SapIdentity } from '../common/types.js';

// Holds each logged-in user's SAP credentials server-side, keyed by user id,
// so the JWT itself never has to carry them. Populated at login, read on
// every authenticated request via JwtStrategy.
//
// ponytail: in-memory only, so it's lost on process restart (the user just
// has to log in again - the JWT's signature is still valid, but there'll be
// no cached SAP identity to attach). If this needs to survive restarts or
// run across multiple instances, back it with a shared store (Redis / DB
// session table) instead of this Map.
@Injectable()
export class SapIdentityCache {
  private readonly cache = new Map<number, SapIdentity>();

  set(userId: number, identity: SapIdentity): void {
    this.cache.set(userId, identity);
  }

  get(userId: number): SapIdentity | undefined {
    return this.cache.get(userId);
  }
}
