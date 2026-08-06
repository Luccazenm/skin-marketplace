import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateTradeUrlDto {
  @ApiProperty({
    description:
      'Trade URL da própria conta Steam. Precisa ser da mesma conta com ' +
      'que o usuário entrou — o partner é conferido no servidor.',
    example:
      'https://steamcommunity.com/tradeoffer/new/?partner=872481203&token=Ab3xY9zQ',
  })
  @IsString()
  // Limites frouxos de propósito: a validação de verdade é a do formato,
  // que devolve mensagem explicando o que está errado. Aqui só evitamos
  // processar entrada absurda.
  @MinLength(40)
  @MaxLength(300)
  tradeUrl!: string;
}
