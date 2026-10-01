import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ShopCode } from '../tenant/shop-code.decorator.js';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedRequestUser } from '../common/types.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // JSON-body login (Swagger / tools); not part of the legacy API.
  @Post('auth/login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Legacy .NET route, country last - exactly what the Flutter app (insignia_hybrid) sends.
  // Response matches the legacy GetLoginDetails: { status, message, data: <jwt> }.
  @Get('GetLoginDetails/:UserCode/:Password/:DeviceCode/:FcMToken/:CountryName')
  getLoginDetails(
    @Param('UserCode') userCode: string,
    @Param('Password') password: string,
    @Param('DeviceCode') deviceCode: string,
    @Param('FcMToken') fcmToken: string,
    @Param('CountryName') country: string,
  ) {
    return this.legacyLogin(country, userCode, password, deviceCode, fcmToken);
  }

  // Same without the country: it is taken from the localURL the call is made under.
  @Get('GetLoginDetails/:UserCode/:Password/:DeviceCode/:FcMToken')
  getLoginDetailsForShop(
    @ShopCode() shop: string,
    @Param('UserCode') userCode: string,
    @Param('Password') password: string,
    @Param('DeviceCode') deviceCode: string,
    @Param('FcMToken') fcmToken: string,
  ) {
    return this.legacyLogin(shop, userCode, password, deviceCode, fcmToken);
  }

  // Legacy SapLogin?sapUser=&sapPassword= - same responses: 200 "SAP Connected <user>",
  // 401 "Invalid SAP Credentials", 400 otherwise. See AuthService.sapLogin.
  @UseGuards(OptionalJwtAuthGuard)
  @Post('SapLogin')
  @HttpCode(200)
  @ApiQuery({ name: 'sapuser', required: true })
  @ApiQuery({ name: 'sappassword', required: true })
  sapLogin(
    @ShopCode() shop: string,
    @Query('sapuser') sapUser: string,
    @Query('sappassword') sapPassword: string,
    @CurrentUser() user: AuthenticatedRequestUser | null,
  ) {
    return this.auth.sapLogin(shop, sapUser, sapPassword, user);
  }

  private async legacyLogin(tenantCode: string, userCode: string, password: string, deviceCode: string, fcmToken: string) {
    const { accessToken } = await this.auth.login({ tenantCode, userCode, password, deviceCode, fcmToken });
    return { status: true, message: 'Success', data: accessToken };
  }
}
