import { Body, Controller, HttpCode, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { SapService } from '../sap/sap.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedRequestUser, InsigRes } from '../common/types.js';
import { SellerkitDto } from './dto/crm.dto.js';
import { parseSellerkitQuery } from './sellerkit.js';

// Legacy POST {localURL}Sellerkit, same body/response shape. `constr` is ignored: the
// connection is always the logged-in user's shop SAP DB (see sellerkit.ts).
// Each shop's Queryurl (TENANT_<CODE>_QUERY_URL) also points here, replacing the old
// standalone SellerKit query service - so responses carry its `msg` next to `message`.
@Controller()
export class SellerkitController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sap: SapService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('Sellerkit')
  @HttpCode(200)
  async run(@CurrentUser() user: AuthenticatedRequestUser, @Body() body: SellerkitDto): Promise<InsigRes<string | null> & { msg: string }> {
    const reply = (status: boolean, message: string, data: string | null = null) => ({ status, message, msg: message, data });
    const { sql, proc, sap, withLines, params } = parseSellerkitQuery(body.query);
    if (sap) {
      // A change: done as the logged-in user in SAP itself. Legacy procs ended with "Select 1".
      await this.sap.request(user.sap, sap.method, sap.path, sap.body);
      return reply(true, 'Success', JSON.stringify([{ Column1: 1 }]));
    }
    let rows: Record<string, unknown>[];
    try {
      if (withLines) {
        // header + lines as two result sets: the items go on the header row as DocumentLines
        const [head = [], lines = []] = await this.db.querySets<Record<string, unknown>>(user.tenantCode, 'sapDb', sql!, params);
        rows = head.map((h) => ({ ...h, DocumentLines: lines }));
      } else {
        rows = proc ? await this.db.execProc(user.tenantCode, 'sapDb', proc, params) : await this.db.query(user.tenantCode, 'sapDb', sql!, params);
      }
    } catch (err) {
      // SQL Server 2812: the shop's database doesn't have this procedure (e.g. Zambia has no approval check)
      if ((err as { number?: number }).number === 2812) {
        throw new NotFoundException('This query is not available for this country');
      }
      throw err;
    }
    // Legacy returned the rows as a JSON string in `data`, dates as Newtonsoft wrote them: "2026-04-01T00:00:00".
    const data = JSON.stringify(rows, function (this: Record<string, unknown>, key, value) {
      const raw = this[key];
      return raw instanceof Date ? raw.toISOString().slice(0, 19) : value;
    });
    return rows.length > 0 ? reply(true, 'Success', data) : reply(false, 'No data found');
  }
}
