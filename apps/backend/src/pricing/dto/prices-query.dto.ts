import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * The names to price.
 *
 * Capped at 500. A Steam inventory runs to a few hundred items, which is
 * the real case this serves; anything beyond that is not a screen asking
 * a question, and each request costs upstream calls against a shared
 * quota.
 */
export class PricesQueryDto {
  @ApiProperty({
    description: 'Steam market hash names, at most 500 per request.',
    example: ['AK-47 | Redline (Field-Tested)'],
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  items!: string[];
}
