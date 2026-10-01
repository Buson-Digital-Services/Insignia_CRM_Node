import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  tenantCode!: string; // code or country name from GET /api/tenants, e.g. "TZ" or "Tanzania"

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
