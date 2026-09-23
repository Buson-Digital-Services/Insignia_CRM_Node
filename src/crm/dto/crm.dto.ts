// Validated request bodies mirroring the legacy CRM.Shared DTOs. Legacy had no
// validation at all; this closes that gap now that the surface is this large.
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class SchemeLineDto {
  @IsInt()
  LineNum!: number;

  @IsString()
  ItemCode!: string;

  @IsNumber()
  Quantity!: number;

  @IsNumber()
  PriceBefDi!: number;

  @IsNumber()
  U_Cartons!: number;

  @IsNumber()
  Balance!: number;

  @IsString()
  Customer!: string;

  @IsString()
  Warehouse!: string;
}

export class DiscountCalcRequest {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SchemeLineDto)
  SCHEMES!: SchemeLineDto[];
}

export class AddressModel {
  @IsString()
  AddressName!: string;

  @IsString()
  Street!: string;

  @IsString()
  ZipCode!: string;

  @IsString()
  City!: string;

  @IsString()
  Country!: string;

  @IsString()
  State!: string;

  @IsIn(['bo_BillTo', 'bo_ShipTo'])
  AddressType!: string;

  @IsOptional()
  @IsString()
  AddressName2?: string;

  @IsOptional()
  @IsString()
  AddressName3?: string;
}

export class ContactModel {
  @IsString()
  Name!: string;
}

export class BusinessPartnerRequest {
  @IsString()
  CardName!: string;

  @IsOptional()
  @IsString()
  CardType?: string;

  @IsInt()
  GroupCode!: number;

  @IsOptional()
  @IsString()
  FederalTaxID?: string;

  @IsOptional()
  @IsString()
  AdditionalID?: string;

  @IsOptional()
  @IsInt()
  Territory?: number;

  @IsOptional()
  @IsString()
  Cellular?: string;

  @IsOptional()
  @IsInt()
  SalesPersonCode?: number;

  @IsOptional()
  @IsString()
  ContactPerson?: string;

  @IsOptional()
  @IsNumber()
  CreditLimit?: number;

  @IsOptional()
  @IsString()
  Notes?: string;

  @IsOptional()
  @IsInt()
  PayTermsGrpCode?: number;

  @IsOptional()
  @IsIn(['tYES', 'tNO'])
  Valid?: 'tYES' | 'tNO';

  @IsOptional()
  @IsIn(['tYES', 'tNO'])
  Frozen?: 'tYES' | 'tNO';

  @IsOptional()
  @IsInt()
  Series?: number;

  @IsOptional()
  @IsString()
  U_TinCer?: string;

  @IsOptional()
  @IsString()
  U_VatCer?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddressModel)
  BPAddresses?: AddressModel[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactModel)
  ContactEmployees?: ContactModel[];
}

export class AddressExtension {
  @IsOptional()
  @IsString()
  BillToStreet?: string;

  @IsOptional()
  @IsString()
  BillToCity?: string;

  @IsOptional()
  @IsString()
  BillToCountry?: string;

  @IsOptional()
  @IsString()
  ShipToStreet?: string;

  @IsOptional()
  @IsString()
  ShipToCity?: string;

  @IsOptional()
  @IsString()
  ShipToCountry?: string;
}

export class QuotationLine {
  @IsString()
  ItemCode!: string;

  @IsOptional()
  @IsString()
  ItemDescription?: string;

  @IsOptional()
  @IsNumber()
  DiscountPercent?: number;

  @IsNumber()
  Quantity!: number;

  @IsOptional()
  @IsNumber()
  UnitPrice?: number;

  @IsOptional()
  @IsString()
  WarehouseCode?: string;

  @IsOptional()
  @IsString()
  TaxCode?: string;

  @IsOptional()
  @IsString()
  Currency?: string;
}

export class QuotationRequest {
  @IsString()
  CardCode!: string;

  @IsString()
  DocDate!: string;

  @IsString()
  DocDueDate!: string;

  @IsString()
  TaxDate!: string;

  @IsOptional()
  @IsString()
  Comments?: string;

  @IsOptional()
  @IsString()
  U_DeviceTransID?: string;

  @IsOptional()
  @IsInt()
  SalesPersonCode?: number;

  @IsOptional()
  @IsString()
  NumAtCard?: string;

  @IsOptional()
  @IsNumber()
  DiscountPercent?: number;

  @IsOptional()
  @IsInt()
  series?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => QuotationLine)
  DocumentLines!: QuotationLine[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressExtension)
  AddressExtension?: AddressExtension;
}

export class SalesOrderLine {
  @IsOptional()
  @IsString()
  ItemCode?: string;

  @IsOptional()
  @IsString()
  ItemDescription?: string;

  @IsOptional()
  @IsNumber()
  DiscountPercent?: number;

  @IsOptional()
  @IsString()
  TaxCode?: string;

  @IsNumber()
  Quantity!: number;

  @IsOptional()
  @IsNumber()
  UnitPrice?: number;

  @IsOptional()
  @IsString()
  ShipDate?: string;

  @IsOptional()
  @IsString()
  Currency?: string;

  @IsOptional()
  @IsString()
  WarehouseCode?: string;

  @IsOptional()
  @IsInt()
  BaseEntry?: number;

  @IsOptional()
  @IsInt()
  BaseLine?: number;
}

export class SalesOrderModel {
  @IsString()
  CardCode!: string;

  @IsOptional()
  @IsString()
  CardName?: string;

  @IsString()
  DocDate!: string;

  @IsString()
  DocDueDate!: string;

  @IsOptional()
  @IsString()
  Comments?: string;

  @IsOptional()
  @IsString()
  U_OrderDate?: string;

  @IsOptional()
  @IsString()
  U_Order_Type?: string;

  @IsOptional()
  @IsString()
  U_GP_Approval?: string;

  @IsOptional()
  @IsString()
  U_Received_Time?: string;

  @IsOptional()
  @IsString()
  NumAtCard?: string;

  @IsOptional()
  @IsString()
  U_DeviceCode?: string;

  @IsOptional()
  @IsString()
  U_DeviceTransID?: string;

  @IsOptional()
  @IsInt()
  SalesPersonCode?: number;

  @IsOptional()
  @IsInt()
  Series?: number;

  @IsOptional()
  @IsString()
  U_latitude?: string;

  @IsOptional()
  @IsString()
  U_longitude?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderLine)
  DocumentLines!: SalesOrderLine[];
}

export class ActivitesDTO {
  @IsString()
  CardCode!: string;

  @IsOptional()
  @IsString()
  Details?: string;

  @IsOptional()
  @IsInt()
  SalesEmployee?: number;

  @IsString()
  U_PlanDate!: string;

  @IsString()
  U_PlanTime!: string;

  @IsOptional()
  @IsString()
  Subject?: string;

  @IsOptional()
  @IsString()
  U_Status?: string;
}

export class CheckedInDTO {
  @IsString()
  StartDate!: string;

  @IsString()
  StartTime!: string;

  @IsOptional()
  @IsString()
  U_Latitude?: string;

  @IsOptional()
  @IsString()
  U_Longitude?: string;

  @IsOptional()
  @IsString()
  U_CheckedIn?: string;

  @IsOptional()
  @IsString()
  U_CheckinAdd?: string;
}

export class CheckedoutDTO {
  @IsOptional()
  @IsString()
  Notes?: string;

  @IsString()
  CloseDate!: string;

  @IsString()
  EndTime!: string;

  @IsOptional()
  @IsInt()
  Duration?: number;

  @IsOptional()
  @IsNumber()
  U_OrdProsValue?: number;

  @IsOptional()
  @IsNumber()
  U_PymntVal?: number;

  @IsOptional()
  @IsString()
  U_Complaints?: string;

  @IsOptional()
  @IsString()
  U_Remarks1?: string;

  @IsOptional()
  @IsString()
  U_Remarks2?: string;

  @IsOptional()
  @IsString()
  U_COLatitude?: string;

  @IsOptional()
  @IsString()
  U_COLongitude?: string;

  @IsOptional()
  @IsString()
  U_CheckOutAdd?: string;

  @IsOptional()
  @IsString()
  U_Link1?: string;

  @IsOptional()
  @IsString()
  U_Link2?: string;

  @IsOptional()
  @IsString()
  U_Link3?: string;

  @IsOptional()
  @IsString()
  U_Link4?: string;

  @IsOptional()
  @IsString()
  U_Products?: string;

  @IsOptional()
  @IsString()
  U_BrandContr?: string;

  @IsOptional()
  @IsString()
  U_PPComp?: string;

  @IsOptional()
  @IsString()
  U_BrandinPromo?: string;

  @IsOptional()
  @IsString()
  U_Advertise?: string;

  @IsOptional()
  @IsString()
  U_AdvFormt?: string;

  @IsOptional()
  @IsString()
  U_NxtFollowup?: string;

  @IsOptional()
  @IsString()
  U_Status?: string;

  @IsOptional()
  @IsString()
  U_Project?: string;

  @IsOptional()
  @IsString()
  U_Customer?: string;

  @IsOptional()
  @IsString()
  U_Consultant?: string;

  @IsOptional()
  @IsString()
  U_Subgroup?: string;

  @IsOptional()
  @IsString()
  U_CheckedIn?: string;
}

export class UserDetailsDto {
  @IsOptional()
  @IsString()
  Id?: string;

  @IsString()
  Branch!: string;

  @IsString()
  UserCode!: string;

  @IsString()
  UserName!: string;

  @IsString()
  Password!: string;

  @IsOptional()
  @IsString()
  DeviceCode?: string;

  @IsString()
  Email!: string;

  @IsString()
  SapuserName!: string;

  @IsString()
  Sappassword!: string;

  @IsString()
  Sapurl!: string;

  @IsString()
  Active!: string;

  @IsOptional()
  @IsInt()
  UserRoll?: number;

  @IsOptional()
  @IsString()
  ReportTo?: string;

  @IsString()
  SapDB!: string;

  @IsOptional()
  @IsString()
  QueryUrl?: string;

  @IsOptional()
  @IsString()
  SlpCode?: string;
}

// ---- request bodies that pair a tenantCode with the above (used pre-login,
// so tenantCode can't come from a JWT) ----

export class UpdatePasswordDto {
  @IsString()
  tenantCode!: string;

  @IsString()
  deviceCode!: string;

  @IsString()
  password!: string;
}

export class CreateUserBody extends UserDetailsDto {
  @IsString()
  tenantCode!: string;
}

export class ResetDeviceCodeDto {
  @IsString()
  tenantCode!: string;

  @IsString()
  deviceCode!: string;

  @IsString()
  userCode!: string;
}

export class PostVersionDto {
  @IsString()
  tenantCode!: string;

  @IsString()
  version!: string;

  @IsString()
  url!: string;

  @IsString()
  content!: string;
}

export class MenuAuthDto {
  @IsString()
  tenantCode!: string;

  @IsInt()
  userKey!: number;

  @IsString()
  companyCode!: string;

  @IsInt()
  menuKey!: number;

  @IsInt()
  authStatus!: number;
}
