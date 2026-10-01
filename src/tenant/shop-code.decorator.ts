import { BadRequestException, createParamDecorator, type ExecutionContext } from '@nestjs/common';

// Shop for calls made before login (no token yet): the country of the localURL the request
// came in on (http://<host>/api/<Country>/... or the shop's own address), else ?tenantCode=.
export const ShopCode = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ tenantFromUrl?: string; query?: Record<string, unknown> }>();
  const code = req.tenantFromUrl ?? req.query?.tenantcode;
  if (typeof code !== 'string' || !code) {
    throw new BadRequestException('Country missing: call this under the localURL returned by GetUrls (e.g. /api/Tanzania/...)');
  }
  return code;
});

/** Whole-number query/path value, e.g. ?docentry=12 - 400 instead of passing NaN to SQL/SAP. */
export function int(name: string, value: unknown): number {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new BadRequestException(`${name} must be a whole number`);
  }
  return Number(value);
}
