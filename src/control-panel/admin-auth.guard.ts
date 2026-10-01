import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { unauthorized } from '../auth/auth-failure.js';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

// Reuses the same JWT strategy/secret as the mobile app's guard, but rejects
// any token that isn't actually an admin-panel token (role: 'admin') - so a
// mobile user's own JWT can't be replayed against the backoffice, and vice versa.
@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AdminJwtPayload>(err: unknown, user: AdminJwtPayload | false, info: unknown, context: ExecutionContext): TUser {
    if (err || !user || user.role !== 'admin') {
      throw unauthorized(err, user ? undefined : info);
    }
    // A token only works under its own shop's localURL (http://<host>/api/<Country>/...).
    const req = context.switchToHttp().getRequest<{ tenantFromUrl?: string }>();
    if (req.tenantFromUrl && req.tenantFromUrl !== user.tenantCode) {
      throw new ForbiddenException('This login belongs to a different country');
    }
    return user as TUser;
  }
}
