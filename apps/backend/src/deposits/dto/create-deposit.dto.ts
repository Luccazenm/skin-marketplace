import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Money arrives as a string, never as a JSON number.
 *
 * `0.1 + 0.2` is the reason: a JSON number is a float, and the value
 * would already have been through one before we ever see it. As a string
 * it travels from the browser to Postgres' Decimal untouched.
 *
 * Two decimal places at most, at least one digit, and no sign — the
 * shape of a price and nothing else. "1e3", "-5" and "1.005" are all
 * refused here rather than being silently rounded later.
 */
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

export class DepositItemDto {
  @ApiProperty({
    description:
      'assetId of the item, as returned by GET /api/inventory. Only ' +
      "valid while the item is in the user's inventory — the assetId " +
      'changes with every trade on Steam.',
    example: '12345678901',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'assetId must contain digits only' })
  assetId!: string;

  @ApiProperty({
    description:
      'The opening price, in USD, as a string with up to two decimals. ' +
      'It is what the item is listed for the moment the Trade Bot ' +
      'receives it, and the seller can change it at any time afterwards.',
    example: '42.50',
  })
  @IsString()
  @Matches(PRICE_PATTERN, {
    message: 'price must be a number with up to two decimals, e.g. "42.50"',
  })
  // Zero is refused here and by a CHECK on the table: a listing at zero
  // is a giveaway, and every ledger entry assumes a sale moves money.
  @Matches(/[1-9]/, { message: 'price must be greater than zero' })
  price!: string;
}

export class CreateDepositDto {
  @ApiProperty({
    description:
      'The items to sell, each with the price to open at. The Trade Bot ' +
      'sends one offer asking for all of them, and they are listed as ' +
      'soon as it receives them.',
    type: [DepositItemDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  // A ceiling so we never build an offer Steam would refuse for size, and
  // to bound the cost of a malicious request.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DepositItemDto)
  items!: DepositItemDto[];
}
