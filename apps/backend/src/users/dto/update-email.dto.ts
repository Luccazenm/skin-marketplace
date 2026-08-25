import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateEmailDto {
  @ApiProperty({
    description:
      'The address to save, or an empty string to remove the one on ' +
      'file. Saving always resets verification, so nothing is sent to ' +
      'it until the address is confirmed.',
    example: 'lucca@example.com',
  })
  // Shape is checked in `email.ts`, which returns a message saying what
  // is wrong. Only the outer bound is here, so an absurd payload is
  // refused before any of that runs.
  @IsString()
  @MaxLength(500)
  email!: string;
}
