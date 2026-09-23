import { Injectable, OnModuleDestroy } from '@nestjs/common';
import sql from 'mssql';
import { TenantService } from '../tenant/tenant.service.js';
import type { DbKind, SqlConnectionConfig } from '../common/types.js';

// One pooled connection per (tenant, db kind), created lazily on first use and
// reused for the life of the process. Each tenant has two SQL Server DBs:
// "app" (Users/MenuAuth/notifications/versions) and "sapDb" (a read mirror of
// SAP's own data - items, customers, quotations, discount schemes). Only a
// handful of tenants expected, so a plain Map is enough - no eviction needed.
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pools = new Map<string, sql.ConnectionPool>();

  constructor(private readonly tenants: TenantService) {}

  private poolKey(tenantCode: string, kind: DbKind): string {
    return `${tenantCode}:${kind}`;
  }

  private async getPool(tenantCode: string, kind: DbKind): Promise<sql.ConnectionPool> {
    const key = this.poolKey(tenantCode, kind);
    const existing = this.pools.get(key);
    if (existing?.connected) {
      return existing;
    }

    const tenant = this.tenants.get(tenantCode);
    const conn: SqlConnectionConfig = kind === 'app' ? tenant.db : tenant.sapDb;
    const pool = new sql.ConnectionPool({
      server: conn.server,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      options: { encrypt: false, trustServerCertificate: true },
    });
    await pool.connect();
    this.pools.set(key, pool);
    return pool;
  }

  private bindParams(request: sql.Request, params: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  /** Parameterized SELECT/DML text query. Returns the first recordset. */
  async query<T = Record<string, unknown>>(
    tenantCode: string,
    kind: DbKind,
    text: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const pool = await this.getPool(tenantCode, kind);
    const request = pool.request();
    this.bindParams(request, params);
    const result = await request.query<T>(text);
    return result.recordset;
  }

  /** Stored procedure call. Returns the first recordset (the common case). */
  async execProc<T = Record<string, unknown>>(
    tenantCode: string,
    kind: DbKind,
    procName: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const recordsets = await this.execProcSets<T>(tenantCode, kind, procName, params);
    return recordsets[0] ?? [];
  }

  /** Stored procedure call for procs that SELECT more than once (e.g. header + lines). */
  async execProcSets<T = Record<string, unknown>>(
    tenantCode: string,
    kind: DbKind,
    procName: string,
    params: Record<string, unknown> = {},
  ): Promise<T[][]> {
    const pool = await this.getPool(tenantCode, kind);
    const request = pool.request();
    this.bindParams(request, params);
    const result = await request.execute<T>(procName);
    return (result.recordsets as unknown as T[][]) ?? [];
  }

  /**
   * Runs a series of stored-proc calls inside one SQL transaction, rolling
   * back all of them if any step throws. Use for the legacy "insert header,
   * then loop inserting rows" flows that previously ran under a single
   * SqlTransaction (e.g. notifications, catalogue sends).
   */
  async withTransaction<T>(
    tenantCode: string,
    kind: DbKind,
    work: (execProc: <R = Record<string, unknown>>(procName: string, params?: Record<string, unknown>) => Promise<R[]>) => Promise<T>,
  ): Promise<T> {
    const pool = await this.getPool(tenantCode, kind);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const execProc = async <R = Record<string, unknown>>(procName: string, params: Record<string, unknown> = {}): Promise<R[]> => {
        const request = new sql.Request(transaction);
        this.bindParams(request, params);
        const result = await request.execute<R>(procName);
        return result.recordset ?? [];
      };
      const result = await work(execProc);
      await transaction.commit();
      return result;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.pools.values()].map((pool) => pool.close()));
  }
}
