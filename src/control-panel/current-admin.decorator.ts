import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminJwtPayload } from './admin-jwt-payload.js';

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminJwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
