export interface AdminJwtPayload {
  role: 'admin';
  tenantCode: string;
  userName: string;
}
