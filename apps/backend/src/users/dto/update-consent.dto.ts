import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Both fields are optional so a screen can send only the switch that
 * moved. Sending the whole object every time would let a stale page
 * silently undo a choice made somewhere else.
 */
export class UpdateConsentDto {
  @ApiPropertyOptional({
    description:
      'Marketing email: news, and alerts about your items selling. ' +
      'Nothing is sent while the address is unverified, whatever this ' +
      'says.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  marketingEmail?: boolean;

  @ApiPropertyOptional({
    description:
      'Analytics and marketing cookies. Recorded before any exist, so ' +
      'the preference is already there on the day they ship rather than ' +
      'everyone being opted in and asked afterwards.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  analytics?: boolean;
}
