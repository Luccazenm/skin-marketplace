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
      'assetIds dos itens escolhidos, como vêm de GET /api/inventory. ' +
      'Valem apenas enquanto os itens estiverem no inventário do usuário — ' +
      'o assetId muda a cada troca na Steam.',
    example: ['12345678901', '12345678902'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  // Teto para não montar uma oferta que a Steam recusaria por tamanho e
  // para limitar o custo de uma requisição maliciosa.
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^\d+$/, { each: true, message: 'assetId deve conter só dígitos' })
  assetIds!: string[];
}
