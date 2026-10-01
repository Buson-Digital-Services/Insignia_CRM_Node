import { UnauthorizedException } from '@nestjs/common';

/** A 401 that says why (passport gives `err` for a rejected token, `info` for a missing/expired/bad one). */
export function unauthorized(err: unknown, info: unknown): UnauthorizedException {
  const fromStrategy = err instanceof UnauthorizedException ? err.message : undefined;
  if (fromStrategy && fromStrategy !== 'Unauthorized') {
    return new UnauthorizedException(fromStrategy);
  }
  const i = info as { name?: string; message?: string } | undefined;
  if (i?.message === 'No auth token') {
    return new UnauthorizedException('Login required: send the login token as "Authorization: Bearer <token>"');
  }
  if (i?.name === 'TokenExpiredError') {
    return new UnauthorizedException('Token expired, please log in again');
  }
  return new UnauthorizedException(i ? 'Invalid token' : 'Not allowed with this kind of login');
}
