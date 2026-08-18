import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class InventoryQueryDto {
  @ApiPropertyOptional({
    description:
      'When true, returns only what can be deposited. The summary still ' +
      'counts the total, so the screen can report how many items were ' +
      'left out.',
    example: true,
  })
  @IsOptional()
  // A query string arrives as text: "true" has to become a boolean
  // before IsBoolean runs.
  //
  // An unknown value is passed through untouched on purpose, so that
  // IsBoolean refuses it. Turning everything that is not "true" into
  // false would let ?depositable=maybe through as if it were false — a
  // typo would become silent behaviour instead of a clear message.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value as unknown;
  })
  @IsBoolean()
  depositable?: boolean;
}
