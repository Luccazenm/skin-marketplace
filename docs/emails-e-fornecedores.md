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

Situação em 17/08/2026: o **cs2.sh** não publica os termos comerciais; o
**SteamWebAPI** autoriza marketplace explicitamente mas não declara
frequência. Cada um tem a resposta que falta no outro — ver STATE.md.
