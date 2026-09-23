import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  tenantCode!: string; // shop/country code chosen on the login screen, e.g. "TZ"

  @IsString()
  userCode!: string;

  @IsString()
  password!: string;

  @IsString()
  deviceCode!: string;

  @IsOptional()
  @IsString()
  fcmToken?: string;
}
