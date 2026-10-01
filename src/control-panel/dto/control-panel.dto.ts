import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UserDetailsDto } from '../../crm/dto/crm.dto.js';

export class EditUserDto extends UserDetailsDto {
  @IsString()
  declare Id: string;
}

export class RecipientDto {
  @IsString()
  Id!: string;

  @IsOptional()
  @IsBoolean()
  IsSeen?: boolean;
}

export class AttachmentDto {
  @IsString()
  FileName!: string;

  @IsString()
  FileType!: string;

  @IsString()
  FileUrl!: string;
}

export class NotificationDto {
  @IsInt()
  FromUserId!: number;

  @IsString()
  MsgHeading!: string;

  @IsString()
  Description!: string;

  @IsOptional()
  @IsString()
  ImageUrl?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  ListUser!: RecipientDto[];
}

// One Excel row from the Control Panel "Activities Excel Sync" page - same
// shape the legacy /api/createActivity took (SAPServiceLayer.Models.ActivityDM).
export class BulkActivityDto {
  @IsString()
  CardCode!: string;

  @IsOptional()
  @IsString()
  Activity?: string;

  @IsOptional()
  @IsString()
  Details?: string;

  @IsInt()
  SalesEmployee!: number;

  @IsInt()
  Subject!: number;

  @IsString()
  U_PlanDate!: string;

  @IsString()
  U_PlanTime!: string;

  @IsOptional()
  @IsString()
  U_Status?: string;

  @IsOptional()
  @IsString()
  U_IsPlanned?: string;
}

export class CatalogueDto {
  @IsInt()
  FromUserId!: number;

  @IsString()
  MsgHeader!: string;

  @IsString()
  MsgDescription!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  ListUser!: RecipientDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AttachmentDto)
  AttachmentLists?: AttachmentDto;
}
