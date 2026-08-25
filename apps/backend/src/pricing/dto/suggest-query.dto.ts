import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Which item to suggest a price for.
 *
 * Only the asset id, and only one. The stickers, their scrape and the
 * skin itself are read from the inventory we already hold for this
 * session rather than sent up: a suggestion assembled from a body the
 * browser wrote would be a suggestion about whatever the browser said,
 * which is not the same as a suggestion about an item somebody owns.
 */
export class SuggestQueryDto {
  @ApiProperty({
    description: "Asset id from the caller's own Steam inventory.",
    example: '44362600965',
  })
  @IsString()
  @MaxLength(32)
  assetId!: string;
}
