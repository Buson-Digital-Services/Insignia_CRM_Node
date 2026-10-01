import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedRequestUser } from '../common/types.js';

// For routes that work with or without an app login: attaches the user when a valid
// mobile token is sent, otherwise lets the request through as anonymous (user = null).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedRequestUser | null>(_err: unknown, user: AuthenticatedRequestUser | false, _info: unknown, context: ExecutionContext): TUser {
    if (!user || !('sap' in user)) {
      return null as TUser;
    }
    const req = context.switchToHttp().getRequest<{ tenantFromUrl?: string }>();
    if (req.tenantFromUrl && req.tenantFromUrl !== user.tenantCode) {
      throw new ForbiddenException('This login belongs to a different country');
    }
    return user as TUser;
  }
}
