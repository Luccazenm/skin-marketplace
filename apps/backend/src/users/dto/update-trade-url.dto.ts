import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTradeUrlDto {
  @ApiProperty({
    description:
      "The user's own Steam trade URL. It has to belong to the account " +
      'they signed in with — the partner is checked on the server.',
    example:
      'https://steamcommunity.com/tradeoffer/new/?partner=872481203&token=Ab3xY9zQ',
  })
  @IsString()
  // Loose bounds on purpose: the real validation is the format check,
  // which returns a message explaining what is wrong. Here we only avoid
  // processing absurd input.
  @MinLength(40)
  @MaxLength(300)
  tradeUrl!: string;
}
