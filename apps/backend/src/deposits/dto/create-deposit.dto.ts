import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class CreateDepositDto {
  @ApiProperty({
    description:
      'assetIds of the chosen items, as returned by GET /api/inventory. ' +
      "They are only valid while the items are in the user's inventory — " +
      'the assetId changes with every trade on Steam.',
    example: ['12345678901', '12345678902'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  // A ceiling so we never build an offer Steam would refuse for size, and
  // to bound the cost of a malicious request.
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true, message: 'assetId must contain digits only' })
  assetIds!: string[];
}
