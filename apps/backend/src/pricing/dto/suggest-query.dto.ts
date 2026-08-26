import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Which items to suggest a price for.
 *
 * Only asset ids. The stickers, their scrape and the skin itself are
 * read from the inventory we already hold for this session rather than
 * sent up: a suggestion assembled from a body the browser wrote would
 * be a suggestion about whatever the browser said, which is not the
 * same as a suggestion about an item somebody owns.
 *
 * A list rather than one, because the Trade screen values a whole
 * inventory at once — and one request per card would be two hundred
 * round trips for a screen that opens in a second.
 */
export class SuggestQueryDto {
  @ApiProperty({
    description:
      "Asset ids from the caller's own Steam inventory, at most 500.",
    example: ['44362600965'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  // The same ceiling the price endpoint uses: a Steam inventory runs to
  // a few hundred items, and past that it is not a screen asking.
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  assetIds!: string[];
}
