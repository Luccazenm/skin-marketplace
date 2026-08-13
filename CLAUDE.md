# NextSkins — contexto do projeto

Marketplace de skins de Counter-Strike 2. Usuários entram com a conta
Steam, depositam skins em bots de custódia, anunciam por um preço, e o
comprador recebe o item por troca na Steam. Alcance internacional.

Existe também um **fluxo rápido**: a plataforma compra a skin do usuário
com desconto grande e revende pelo preço cheio — operação de estoque
próprio, com risco de preço, não intermediação.

Sem loot box, sem roleta. Só marketplace.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | TypeScript + NestJS |
| Banco | PostgreSQL 16 via Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Cache e fila | Redis 7 (ioredis; BullMQ quando o worker existir) |
| Frontend | TypeScript + React 18 + Vite + Tailwind v4 (gerado no Figma Make) |
| Worker de bots | `apps/bot-service` — ainda vazio |
| Monorepo | pnpm workspaces + turbo |

Tudo em TypeScript de propósito: as bibliotecas maduras para operar bot da
Steam (`steam-user`, `steam-tradeoffer-manager`) são Node, e os tipos
gerados pelo Prisma valem para a API e para o worker sem duplicação.

---

## Decisões de arquitetura, e por quê

### Dinheiro

**`Transaction` é um ledger append-only, em USD.** Nunca editar valor
depois de criado; estorno é uma linha nova. Taxa vira linha `FEE`
separada, não campo embutido — assim receita é soma direta em vez de
reconstrução a partir de campos espalhados.

**A conta da plataforma é um `User` com `isPlatform = true`.** Alternativa
seria uma flag no `Item`, mas aí `Listing.sellerId` e `Order.sellerId`
virariam nullable e todo código de venda teria um ramo "se for da
plataforma". Com conta de sistema, o fluxo rápido usa o mesmo caminho da
venda normal, e o caixa é o saldo dessa conta. **Custo: toda query de
"usuários reais" precisa filtrar `isPlatform = false`.**

**Saldo é sempre USD internamente.** `displayCurrency` é apresentação.
Moeda de origem e `fxRate` ficam no ledger porque o spread cambial é
~24% da receita projetada.

**Vendedor só é creditado na entrega confirmada.** A `Transaction` de
`SALE` nasce `PENDING` e vira `COMPLETED` quando o `Order` chega em
`DELIVERED`.

### Itens e Steam

**`Item.assetId` NÃO é único e é mutável.** O asset id muda a cada troca
de inventário. A identidade estável são as quatro propriedades imutáveis:
`float + paintSeed + paintIndex + defIndex`. A Valve fechou em 2017 o
endpoint que dava o id original, então não há atalho.

**`ItemLocation` é só posição física.** "Listado" é `Listing.active`,
"vendido" é `Order`. No nosso fluxo o item fica em `BOT_CUSTODY` do
depósito à entrega, inclusive depois de vendido.

**O `Item` só nasce quando entra em custódia.** Ele exige float e paint
seed, que só saem do inspect link. Por isso o depósito guarda apenas
`TradeOffer.requestedAssetIds` — os endereços na Steam do que esperamos
receber.

**Trade lock de 7 dias da Valve prende os dois lados.** Quem recebe fica
travado, então o bot não entrega antes de 7 dias do depósito. É por isso
que existe inventário virtual: a venda é troca de dono no banco, o item
não se move.

**Ban da Steam ≠ banimento nosso.** `isBanned` é moderação nossa e
bloqueia login. `steamEconomyBan` e `steamVacBanned` são da Valve e **não**
bloqueiam login: a pessoa continua cliente e dona do que está em custódia.
**Vender pelo site nunca é bloqueado por ban da Steam** — seria
transformar a punição da Valve em confisco nosso.

**Uma linha por unidade em `ItemApplication`, nunca agrupada.** Duas
cópias do mesmo sticker podem ter raspagens diferentes, e uma valer
múltiplos da outra.

### Autenticação

**Sessão em JWT, entregue por cookie httpOnly.** Token em query string
ficaria no histórico do navegador, em log de proxy e no cabeçalho
`Referer`. `httpOnly` impede que um XSS leve a sessão junto.

**O guard consulta o banco a cada requisição.** JWT não é revogável;
confiar só nele deixaria um banido entrar por dias. Lookup por chave
primária é barato e vale a troca.

**Revogação em duas camadas no Redis:** `jti` derruba um token (logout
comum), corte por usuário derruba todos (conta comprometida). Se o Redis
cair, a checagem deixa passar — o guard ainda bloqueia banido pelo banco,
e recusar toda sessão por indisponibilidade de cache derrubaria o site.

### Steam

**Inventário é leitura ao vivo com cache, nunca persistida.** O endpoint é
limitado **por IP**, e o IP é o do nosso servidor: sem cache, um usuário
recarregando derruba o inventário de todos por horas. Há limite global de
1 chamada a cada 4s e castigo de 5 minutos após um 429.

**Dado velho é melhor que erro.** Inventário de dez minutos atrás é
praticamente igual ao atual; tela de erro leva o usuário a recarregar, que
agrava exatamente o problema.

**Classificação de item vem da tag `Type`, por `internal_name`.** O nome
localizado muda com o idioma e quebraria a classificação em silêncio.

**Credenciais de bot nunca vão para o banco.** `Bot.credentialRef` aponta
para o cofre.

---

## Convenções

### Código

- Comentários e mensagens ao usuário em **português**.
- Comentário explica **por que**, não o que o código faz.
- Mensagem de erro diz **o que fazer**, não só o que falhou.
- Nomes de domínio em português quando forem conceito de negócio
  (`registrarRecusa`, `motivoBloqueio`); nomes de framework em inglês.

### "Trade Bot", nunca só "Bot"

Em **tudo que o usuário lê** — nome de perfil na Steam, grupo, site,
mensagens de erro, suporte, documentação: **Trade Bot**. "Bot" sozinho é
o vocabulário de roleta, sorteio e conta de spam; o termo completo diz o
que a conta faz e é o mesmo usado no grupo oficial (`NextSkins.gg —
Official Trade Bots`) e nos e-mails (`tradebot<N>@nextskins.gg`).

No **código** o modelo continua `Bot` — `Bot.steamId`, `bot:add`,
`bot-service`. Não há segundo tipo de bot no sistema, então o nome curto
não é ambíguo, e renomear custaria migration e refatoração sem ganho
para ninguém. **Ao escrever texto voltado ao usuário a partir desses
campos, escrever "Trade Bot".**

### Estrutura

```
apps/backend/src/<dominio>/
  <dominio>.controller.ts     HTTP, tradução de exceção em status
  <dominio>.service.ts        regra de negócio
  <dominio>.module.ts
  dto/                        validação de entrada
  *.spec.ts                   ao lado do que testam
```

Regra pura e testável fica em arquivo próprio, sem framework
(`steam-restrictions.ts`, `item-category.ts`, `trade-url.ts`,
`applied-items.ts`).

### Banco

- CHECK constraints e triggers são **escritos à mão** nas migrations — o
  Prisma não os gera. Cada bloco tem um comentário dizendo isso. **Se um
  desses blocos sumir numa migration futura, foi apagado por engano.**
- UUID v7 nas chaves primárias: o v4 é aleatório e fragmenta o índice.
- `Decimal(12,2)` para USD; precisão alta em moeda de origem, porque
  cripto não sobrevive a duas casas.

### Antes de dar algo por pronto

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Build passando **não prova** que a integração externa funciona. Quando
tocar Steam, Postgres ou Redis, verificar de verdade.

---

## Testes e auditoria: requisito, não recomendação

Nada é entregue sem teste automatizado e sem registro de auditoria.

**Testes** porque bug aqui custa dinheiro real — o sistema guarda saldo de
usuários e itens de terceiros em custódia.

**Auditoria** porque, quando alguém disser "sumiu dinheiro" ou "não
recebi meu item", é preciso saber com certeza se foi falha nossa ou
tentativa de golpe.

### O que auditar

Toda operação sobre **dinheiro, item ou conta** — o que deu certo **e o
que foi recusado**. Uma sequência de tentativas de cadastrar trade URL de
terceiros é padrão de golpe que só aparece se as recusas ficarem gravadas.

Em alterações, guardar **antes e depois**. Guardar também o nome do item,
não só o assetId: o assetId muda a cada troca, e em seis meses "AK-47 |
Redline" é o que permite reconhecer do que se fala.

```ts
await this.audit.record({
  actorType: AuditActorType.USER,
  actorId: user.id,
  action: AUDIT_ACTIONS.ALGUMA_COISA,
  outcome: AuditOutcome.SUCCESS, // ou DENIED, ou FAILED
  targetType: 'User',
  targetId: user.id,
  metadata: { de: anterior, para: novo },
  context, // auditContext(req)
});
```

`record` engole erro — auditoria falhando não pode impedir alguém de
entrar no site. Para saldo e propriedade de item, use
`recordInTransaction` dentro da mesma transação: ali o registro precisa
cair junto, porque operação de dinheiro sem rastro é pior que operação não
realizada.

`AuditLog` é **imutável por trigger no Postgres** — UPDATE e DELETE são
recusados pelo banco. Corrigir registro errado é impossível por desenho:
insere-se um novo.

### Log é diferente de auditoria

`AuditLog` é a prova, guardada no banco e imutável: responde "isso
aconteceu?". O log de aplicação é o rastro técnico, volátil: responde
"por que quebrou?". Um não substitui o outro.

Todo log carrega o `requestId` da requisição automaticamente — não passar
isso como parâmetro nem inventar outro identificador. **Nunca logar
credencial, token ou cookie**; o mascaramento em
`observability/structured-logger.ts` é rede de proteção, não permissão.

### Consultar

```bash
pnpm audit:user -- --id=<steamID64 ou id interno> [--dias=N]
pnpm audit:suspeitos [-- --dias=7 --minimo=3]
```

O primeiro monta a linha do tempo de uma pessoa — é o que se abre quando
chega uma reclamação. O segundo lista quem acumulou recusas: uma recusa
isolada é engano comum, repetição é alguém testando o sistema.

São comandos de terminal, não rotas: painel administrativo é a superfície
mais perigosa do sistema e não há ganho enquanto a operação for de uma
pessoa.

---

## Restrições — o que NÃO fazer

- **Não usar PowerShell para editar arquivos com acentos.** Isso já
  corrompeu o encoding duas vezes nesta base. Usar as ferramentas de
  edição de arquivo.
- **Não confiar em dado vindo do cliente para identidade.** steamId sempre
  do token ou do OpenID validado, nunca do corpo da requisição.
- **Não guardar credencial de Steam no banco.** Só `credentialRef`.
- **Não calcular automaticamente o preço de skin com sticker.** O SP% vai
  de 2% a mais de 50% conforme posição, alinhamento e demanda; nenhuma API
  entrega isso com confiança. Mostrar preço base e valor de cada sticker
  separados, deixando o vendedor decidir.
- **Não usar preço do Steam Market como referência.** É inflado, porque o
  saldo de lá não é sacável.
- **Não chamar a Steam sem passar pelo cache e pelo limitador.**
- **Não bloquear venda por ban da Steam.**
- **Não agrupar `ItemApplication` por nome com contagem.**
- **Não criar painel administrativo** enquanto a operação for de uma
  pessoa: é a superfície mais perigosa do sistema e não há ganho hoje.
- **Não automatizar criação de contas Steam** nem comprar contas prontas.
- **Não commitar em `main`** — o trabalho vive em branch.
- **Não fazer push nem abrir PR** sem pedido explícito.

---

## Compact Instructions

Em toda compactação (manual ou automática), preserve sempre:
decisões de arquitetura, convenções do projeto, restrições explícitas,
e o conteúdo do arquivo STATE.md. Nunca resuma ou genericize essas
informações.
