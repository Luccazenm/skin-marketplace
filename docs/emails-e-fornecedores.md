# E-mails da operação e trato com fornecedores

## Endereços

Tudo em inglês: a comunicação pública do projeto é em inglês (grupo da
Steam, nomes dos Trade Bots) e os fornecedores são internacionais. Um
endereço em português no meio disso destoa.

| Endereço | Para quê |
|---|---|
| `contact@nextskins.gg` | fornecedores, licenciamento, conta, imprensa |
| `support@nextskins.gg` | usuários |
| `tradebot<N>@nextskins.gg` | um por Trade Bot |
| `noreply@nextskins.gg` | e-mail transacional, quando existir |

`contato@` existe como **alias** de `contact@`, para o usuário brasileiro
que escrever em português por instinto.

### Por que separado

**Fornecedor não escreve para o `support@`.** Essa caixa vai ser a fila de
reclamação de usuário. Resposta sobre licenciamento no meio de "não
recebi meu item" é como se perde a única prova de que podemos exibir
determinado dado.

**`noreply@` fica reservado desde já, mesmo sem uso.** Quando o site
enviar confirmação de venda, essas mensagens não podem sair do mesmo
endereço que recebe resposta de gente.

**Um e-mail por Trade Bot, sem catch-all.** Se um for comprometido, os
outros seguem isolados. Ver [criar-conta-de-bot.md](./criar-conta-de-bot.md).

## Falar com fornecedor de dados

**Sempre do `contact@`, nunca de e-mail pessoal.** A permissão de uso
comercial fica vinculada a quem pediu: perguntar de um endereço pessoal e
depois operar como NextSkins deixa a autorização apontando para outra
entidade. Se um dia houver discussão, é isso que faz a resposta valer.

**Guardar a resposta fora do e-mail.** Salvar em PDF junto com a
documentação da operação. Ela é a prova de que podemos exibir aqueles
dados — pelo mesmo motivo de existir auditoria: no dia em que precisar,
não pode depender de uma caixa de e-mail ainda existir.

### O que perguntar antes de assinar

Duas coisas que nenhum fornecedor de preço publica, e cada uma é
bloqueante:

1. **Podemos exibir os dados a usuário final num marketplace?** Somos, do
   ponto de vista deles, cliente e concorrente de outros clientes. Se a
   resposta for não, a integração morre depois de construída.
2. **Com que frequência cada mercado é atualizado, e há carimbo de hora
   por preço?** Preço recomendado desatualizado na tela é o tipo de erro
   que vira reclamação com razão.

### Respostas recebidas

**cs2.sh — 17/08/2026, Alex (`hello@cs2.sh`).** Exibir os dados num
marketplace comercial é permitido; a única restrição é **revender ou
redistribuir** a API e os dados. Cachear e exibir é explicitamente aceito.
Atribuição não é exigida, só apreciada. `/v1/liquidity/items` é exclusivo
do plano Scale.

> "Commercial usage and displaying the APIs data is fine, and often
> necessary for our users' applications or websites. We just don't want
> you to resell or redistribute it."

**Guardar esta resposta em PDF.** É a autorização que sustenta exibir
preço de terceiro na nossa vitrine.

**SteamWebAPI** — aguardando.
