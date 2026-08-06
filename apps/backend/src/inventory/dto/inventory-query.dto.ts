import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class InventoryQueryDto {
  @ApiPropertyOptional({
    description:
      'Quando true, devolve apenas o que pode ser depositado. O resumo ' +
      'continua contando o total, para a tela poder informar quantos ' +
      'itens ficaram de fora.',
    example: true,
  })
  @IsOptional()
  // Query string chega como texto: "true" precisa virar booleano antes de
  // o IsBoolean rodar.
  //
  // O valor desconhecido é devolvido intacto de propósito, para o
  // IsBoolean recusá-lo. Converter tudo que não for "true" em false faria
  // ?depositable=talvez passar como se fosse false — um erro de digitação
  // viraria comportamento silencioso em vez de mensagem clara.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value as unknown;
  })
  @IsBoolean()
  depositable?: boolean;
}
