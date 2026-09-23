import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

// Reuses the same JWT strategy/secret as the mobile app's guard, but rejects
// any token that isn't actually an admin-panel token (role: 'admin') - so a
// mobile user's own JWT can't be replayed against the backoffice, and vice versa.
@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AdminJwtPayload>(err: unknown, user: AdminJwtPayload | false): TUser {
    if (err || !user || user.role !== 'admin') {
      throw new UnauthorizedException();
    }
    return user as TUser;
  }
}
