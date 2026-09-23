import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../common/types.js';

// Pulls the authenticated user's claims (incl. their per-user SAP identity) off
// the request. Use in any controller behind JwtAuthGuard: @CurrentUser() user.
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedRequestUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
