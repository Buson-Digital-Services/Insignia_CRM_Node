import { Controller, Get, Param } from '@nestjs/common';
import { TenantService } from './tenant.service.js';

@Controller()
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  // First call from the Flutter app, before login: the country picked in its dropdown
  // returns that shop's URLs. Same route/shape as the legacy .NET GetUrls/{Country}.
  @Get('GetUrls/:country')
  getUrls(@Param('country') country: string) {
    return { countryClass: this.tenants.get(country).urls, status: true, message: 'Success' };
  }
}
