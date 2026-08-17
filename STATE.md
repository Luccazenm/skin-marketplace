# Estado atual

Atualizado em 13/08/2026. Branch `feat/modelagem-dominio-e-infra-backend`,
nada em `main` e nada enviado ao GitHub.

**236 testes passando · cobertura 77,9% · typecheck, lint e build limpos.**

Toda a integração com a Steam está em 100% de statements:
`steam-inventory`, `steam-profile`, `steam-ban`, e `steam-openid` em 97%.

---

## Implementado

### Infraestrutura

- Monorepo pnpm + turbo. `pnpm dev` sobe backend e frontend juntos;
  `build`, `lint`, `test`, `typecheck` e atalhos `db:*` funcionam da raiz.
- Postgres 16 e Redis 7 no docker-compose, com healthcheck. Redis com
  `appendonly` ligado — a fila vai guardar jobs agendados para dias no
  futuro.
- `@nestjs/config` com validação por zod: env inválida derruba o boot com
  mensagem apontando a variável.
- Prisma 7 conectado por driver adapter, com shutdown hooks.
- Swagger em `/docs`, desligado em produção.
- Seed idempotente criando a conta da plataforma; repara identidade
  divergente sem tocar no saldo.

### Modelo de dados

Dez tabelas, sete migrations aplicadas: `User`, `SkinTemplate`, `Item`,
`ItemApplication`, `Listing`, `Order`, `Transaction`, `TradeOffer`,
`TradeOfferItem`, `Bot`, `AuditLog`.

CHECK constraints escritos à mão:

- `Transaction`: valor não pode ser zero; sinal coerente com o tipo, só
  para tipos de uma perna só (FEE, BUYOUT, REFUND e ADJUSTMENT geram duas
  linhas de sinais opostos e ficam de fora).
- `Item`: arma, faca e luva exigem os quatro campos de padrão; float
  dentro de [0,1].
- `ItemApplication`: raspagem só em sticker e dentro de [0,1]; slot dentro
  do limite de cada tipo (5 / 3 / 1).
- `AuditLog`: trigger recusando UPDATE e DELETE.

### Login via Steam (completo)

```
GET  /api/auth/steam         redireciona para a Steam
GET  /api/auth/steam/return  valida, cria usuário, seta cookie, redireciona
GET  /api/auth/me            perfil, saldo, capabilities, trade URL
POST /api/auth/logout        invalida este token
POST /api/auth/logout-all    invalida todos
```

OpenID 2.0 implementado direto, sem `passport-steam` — a biblioteca tem
falha conhecida que permite autenticar como qualquer conta.

Verificado com a conta real: login funciona ponta a ponta.

### Inventário

`GET /api/inventory` — leitura ao vivo com cache, `?depositable=true`
filtra mantendo `total` e `blocked` no resumo.

Classifica em 20 categorias pela tag `Type`; extrai stickers, patches e
chaveiros aplicados (nome, imagem, ordem). Verificado contra inventário
real: 192 itens, nenhum caiu em `OTHER`.

### Dados de item: resolvido sem infraestrutura (17/08)

O endpoint público de inventário já devolve, por item, em
`asset_properties`: paint seed (`propertyid 1`), float (`propertyid 2`) e
o inspect link auto-codificado (`propertyid 6`). Os adesivos aplicados
vêm em `asset_accessories`, cada um com `classid` e um float próprio.

Verificado contra inventário real: `StatTrak™ AK-47 | Inheritance
(Battle-Scarred)`, seed 401, float 0,6661146879196167, 5 adesivos.

**Consequência:** cai do plano toda a infraestrutura de inspect — conta
dedicada, Game Coordinator, fila, limite de 1 req/s. E float e padrão
passam a estar disponíveis **antes** do depósito, o que muda o que a tela
de depósito e a vitrine conseguem mostrar.

**Raspagem confirmada** contra dois itens conhecidos: AK-47 Blue Laminate
com 4 adesivos intactos devolve `0 | 0 | 0 | 0`; a AK-47 Inheritance
devolve `0,63 | 0,84 | 0,80 | 0,75 | 0,97`. `propertyid 4` é a raspagem,
0 = intacto.

**Implementado** no `steam-inventory` (17/08): `float`, `paintSeed` e a
raspagem de cada aplicação. Verificado contra o inventário real — 191
itens, 24 com float, 11 com aplicação, 10 com raspagem. O décimo primeiro
é um chaveiro, que não raspa e não aparece em `asset_accessories`.

Nome e imagem da aplicação vêm do HTML; a raspagem vem de
`asset_accessories`, que identifica cada peça só por `classid` — e esse
`classid` não está em `descriptions`. **A única ligação entre as duas
listas é a ordem**, então o casamento só acontece quando as quantidades
batem. Divergiu, `wear` fica `null`: errar a raspagem mexe direto no
preço, e mostrar nada é melhor que mostrar errado.

### Trade URL

`PUT /api/users/me/trade-url` — confere que o `partner` corresponde ao
usuário autenticado. Guarda versão normalizada.

### Depósito (parcial)

`POST /api/deposits` registra a intenção e enfileira a `TradeOffer` em
`CREATED`. Valida trade URL, restrição da Steam, posse dos itens, se são
depositáveis, se já estão em outra troca, e escolhe o bot mais vazio.

**Hoje responde 503 em qualquer depósito**, porque não há bot cadastrado.
Isso é o comportamento correto, não um bug.

### Trade Bots

`pnpm bot:check`, `pnpm bot:add` e `pnpm bot:list`.

`bot:check` é só leitura: responde "posso cadastrar esta conta?" sem
gravar nada. Mostra todas as pendências de uma vez, para o operador não
corrigir uma, rodar de novo e descobrir a seguinte.

`bot:add` confirma com a Steam que a conta existe, que não tem restrição
de economia nem VAC, e **que não está limitada** — conta limitada não é
ban, a Web API não reporta esse estado, e conta recém-criada passaria por
todas as outras barreiras sem conseguir negociar. A checagem vem do XML
do perfil (`isLimitedAccount`).

Os dois consomem a mesma regra (`scripts/bot-eligibility.ts`, pura e
testada): o `check` informa, o `add` barra. Critérios separados
discordariam, e a discordância só apareceria com item em custódia.

Recusa registra na auditoria como `bot.registration_denied` com o motivo
— inclusive duplicidade e perfil ilegível.

**Dois Trade Bots cadastrados**, ambos `OFFLINE`:

| | steamID64 | ref | libera |
|---|---|---|---|
| Trade Bot 1 | 76561198659520305 | `bot/01` | 20/08/2026 |
| Trade Bot 2 | 76561198654117612 | `bot/02` | 24/08/2026 |

Nenhum recebe depósito ainda: `escolherBot` só considera `ONLINE`, e nada
põe em rotação até o `bot-service` existir. Os R$ 50 na carteira contaram
para tirar a limitação mesmo sem serem gastos — confirmado nos dois.

Falta em ambos: avatar (ainda o padrão da Steam), que espera a identidade
visual e deve ser aplicado nos dois de uma vez.

### Auditoria

Integrada em login (sucesso e três recusas), logout, logout-all, trade URL
(sucesso e cada recusa), depósito (sucesso e sete recusas) e cadastro de
bot.

Consulta por comando: `pnpm audit:user` monta a linha do tempo de uma
pessoa (aceita steamId ou id interno, mostra antes/depois e IP);
`pnpm audit:suspeitos` lista quem acumulou recusas no período. Há também
busca por assetId no `AuditQueryService`.

### Logs estruturados

Toda requisição recebe um `requestId` e o carrega até o fim, inclusive
atravessando `await` — é `AsyncLocalStorage`, ninguém precisa passar isso
como parâmetro. O id vai no cabeçalho `x-request-id` da resposta, então o
usuário que reclama pode informar o número da requisição que falhou.

Em produção sai uma linha JSON por evento, com `requestId`, `userId`,
`ip`, `method` e `path` — dá para filtrar tudo de uma pessoa ou de uma
falha. Em desenvolvimento sai texto legível com os 8 primeiros caracteres
do id como prefixo.

Se o cliente mandar `x-request-id`, ele é reaproveitado (permite seguir a
requisição desde o proxy) — mas só se casar com `/^[A-Za-z0-9._-]{8,128}$/`.
Sem essa validação, bastaria mandar uma quebra de linha para **forjar
entradas no log**, arruinando justamente a investigação que ele apoia.

Campos cujo nome lembra credencial (`senha`, `password`, `secret`,
`token`, `authorization`, `cookie`, `apiKey`, `credential`) saem como
`[oculto]`, em qualquer profundidade. É rede de proteção: o certo é não
passar credencial adiante, mas despejar um objeto inteiro num log de erro
é acidente comum.

`userId` só entra depois do guard autenticar. Os logs anteriores saem sem
dono — o que é correto: ali ainda não se sabia quem era.

---

## Em andamento

Nada em código.

**Fora do código:** as contas de bot estão sendo criadas. O autenticador
leva 7 dias para maturar; os prazos correm em paralelo. Roteiro em
`docs/criar-conta-de-bot.md`.

---

## Próximos passos

### Bloqueado até haver bot operante

- `bot-service` inteiro: enviar oferta, detectar aceite, criar `Item` com
  float lido do inspect link, preencher `ItemApplication.wear`
- Fila agendada pelo trade lock (`SCHEDULED` + `scheduledFor`)
- Retry com limite — `TradeOffer.attempts` existe e ninguém respeita
- Rechecar ban antes de entregar, senão o retry roda infinito
- Detectar ban do próprio bot — conta banida continua **recebendo** itens,
  então a perda cresce depois do incidente
- Reconciliar `Bot.itemCount`

Detalhes em `apps/bot-service/README.md`.

### Livre para fazer agora

- Catálogo para itens que não são armas (`SkinTemplate` tem `weapon` e
  `skinName`; sticker não tem arma) — bloqueia guardar preço de sticker
- Campo de URL personalizada em `Bot`, só exibição
- Página pública de bots, listando steamID64 (defesa contra bot falso).
  **A descrição do grupo da Steam já aponta para `nextskins.gg/bots`** —
  enquanto a página não existir, o link quebra exatamente na hora em que
  o usuário desconfiado vai conferir.
- **Trocar a descrição do grupo da Steam quando o site subir.** Hoje ela
  abre com "o site não está no ar, não negociamos, qualquer oferta em
  nosso nome é golpe". Isso é proteção enquanto não há nada no ar, e vira
  mentira perigosa no dia do lançamento: o usuário lê que não negociamos
  bem quando começar a negociar de verdade. Os dois textos (inglês e
  português) estão em `docs/grupo-steam.md`. **Fazer no mesmo dia do
  lançamento, não depois.**
- Vitrine e anúncios (`Listing` já existe no modelo)
- Frontend — preso à decisão de fronteira com o Figma
- CI, banco de teste separado, `.gitattributes`

### Assim que a hospedagem for definida

- **`docker-compose` de produção**, garantindo que os comandos de terminal
  (`audit:user`, `audit:suspeitos`, `bot:add`, `bot:list`) tenham as
  mesmas variáveis de ambiente da API. Rodando em container isso vem de
  graça; direto na VM, o `.env` precisa estar acessível ao usuário que
  executa.
- **Testar os comandos no ambiente real**, não só aqui. Eles executam a
  partir do `dist`, então o deploy precisa rodar `pnpm build`.
- **Destino dos logs**, porque hoje eles morrem com o container. Se houver
  proxy na frente (nginx, Caddy, Cloudflare), configurar para gerar o
  `x-request-id` — assim a correlação começa antes do backend.
- Documentar o acesso: `docker compose exec backend pnpm audit:user -- --id=...`
  via SSH, ou túnel SSH (`ssh -L 5433:localhost:5432`) para consultar do
  próprio computador. **Nunca expor a porta do Postgres na internet.**

### Catálogo (17/08)

**33.950 itens importados**, com `pnpm catalog:sync` — idempotente,
levando ~220s. Verificado rodando duas vezes: a segunda atualiza tudo e
não cria nada.

| | | | |
|---|---|---|---|
| STICKER | 10.433 | GRAFFITI | 1.812 |
| PISTOL | 5.050 | MACHINEGUN | 597 |
| RIFLE | 3.922 | GLOVES | 470 |
| SMG | 3.534 | CONTAINER | 469 |
| KNIFE | 3.428 | MUSIC_KIT | 183 |
| SHOTGUN | 1.885 | PATCH | 112 |
| SNIPER_RIFLE | 1.809 | CHARM / AGENT / KEY | 78 / 63 / 25 |

Fonte: dataset público `ByMykel/CSGO-API`, espelhado no nosso banco.
Descartados 1.032: medalha e passe (nunca negociáveis) e 701 adesivos com
`market_hash_name` nulo, que não existem no mercado.

`SkinTemplate` agora aceita item sem arma. `weapon`, `skinName`,
`minFloat` e `maxFloat` viraram opcionais, com duas CHECK constraints no
lugar: **arma exige `weapon`**, e **item com skin exige faixa de float**.
A primeira versão exigia skin de toda arma e recusou 40 facas *vanilla*
na importação real — item legítimo e caro que não tem skin nem desgaste.

**Classificação:** o nome resolve o caso específico (prefixo `Sticker |`,
`★`, nome da arma); o arquivo de origem resolve o tipo quando o nome não
diz nada. Foi o que classificou cápsulas de torneio como `CONTAINER` —
"Katowice 2019 Legends (Holo-Foil)" não anuncia isso em lugar nenhum,
mas veio de `crates.json`.

**`EQUIPMENT`** é categoria nova, criada para o **Zeus x27** (80 itens).
Tem skin, exterior e float como qualquer arma, mas a Valve o classifica à
parte (`CSGO_Type_Equipment`). Está mapeado nos dois lados — catálogo e
inventário — e conta como categoria com padrão único, então o float dele
aparece. **Nenhum item ficou em `OTHER`.**

**Origem: `collections` é lista, não campo único** — 31.115 de 33.950
preenchidos (91,6%), e **17.325 saem de mais de uma origem**, com máximo
de 19.

```
★ Karambit | Doppler        {Chroma Case, Chroma 2 Case, Chroma 3 Case}
★ Sport Gloves | Pandora's  {Glove Case, Operation Hydra Case}
AK-47 | Redline (FT)        {Operation Phoenix Weapon Case,
                             The Phoenix Collection}
```

A primeira versão guardava só uma, e a última processada apagava as
outras — por acidente de ordem de iteração, não por escolha. **Não existe
"origem principal"**: o Karambit não vem mais da Chroma 3 do que da
Chroma 1. E a quantidade de origens importa além da exibição: skin que
cai de três caixas tem oferta muito maior que uma exclusiva, e oferta é
entrada do `buyoutEligible`.

Cruzamento por `skin_id` com `collections.json` e `crates.json`. Faca e
luva estão em `contains_rare`, não em `contains` — sem ler esse campo, as
3.898 ficariam sem origem. Índice **GIN**, porque índice comum não serve
para "contém este valor" em coluna de lista; a consulta da vitrine
(`'Chroma 2 Case' = ANY(collections)`) devolve 373 itens.

Os vazios restantes são, em maioria, corretos: caixa não pertence a
coleção, e grafite não sai de coleção nenhuma.

**Descrição: 33.742 itens** (99,4%), com `flavorText` separado em 17.951 —
a frase em itálico que a Valve põe no fim ("Never be afraid to push it to
the limit"). Guardados **sem HTML**: devolver marcação de terceiro para a
tela obrigaria o frontend a sanitizar, e página de item é onde alguém
decide vender algo caro.

**`hasStickerSlots` foi removido.** Era derivável da categoria e nunca
foi preenchido — lia `false` nos 33.950, inclusive em toda arma. Virou
`aceitaAdesivo(categoria)` em `item-category.ts`, junto de
`temPadraoUnico`: função pura não diverge, coluna duplicada sim.

Não confundir com faca e luva, que **têm padrão mas não têm slot** — é o
que impede derivar uma função da outra. Zeus x27 aceita adesivo, apesar
de ser família própria da Valve.

### Preço: o lado neutro está pronto (17/08)

`PriceSnapshot` (append-only) + `PricingModule`, sem nenhum fornecedor
acoplado. Migration `20260817171329_price_snapshot`.

- **`price-provider.ts`** — o contrato que qualquer fornecedor preenche.
  Nenhuma tela ou regra conhece cs2.sh ou SteamWebAPI: conhecem
  `CotacaoBruta`. Item sem cotação é omitido, nunca devolvido com preço
  zero.
- **`price-reconciliation.ts`** — regra pura, 19 testes. Não faz média
  entre mercados; prefere BUFF163 e deixa Steam por último; descarta
  cotação velha; **recusa quando as fontes divergem além de 40%.** Em
  todos os casos duvidosos, não exibir preço em vez de exibir errado.
- **`price-history.service.ts`** — grava o lote e lê o preço atual do
  **nosso banco**, nunca do fornecedor. Repetição é ignorada, então o job
  pode ser rodado de novo depois de uma queda.

`quotedAt` (quando a fonte apurou) é separado de `capturedAt` (quando
gravamos): fornecedor que serve dado de dez minutos atrás precisa ser
distinguível de um que serve ao vivo.

**Falta:** o adaptador do fornecedor escolhido, e o job que roda a
captura. Nenhum dos dois depende de decisão nova — só de saber qual
fornecedor.

### Fonte de preço — levantamento de 17/08/2026

| | cs2.sh | SteamWebAPI | CSGOSKINS.GG | SteamApis |
|---|---|---|---|---|
| Mercados | 6, com BUFF | 13, com BUFF | 37 | 6, com BUFF |
| Atualização | ~5 min, declarado | não declara | 5 min + carimbo | não declara |
| Preço | bid/ask | atual, mediana, menor venda, maior compra | só anúncio | atual |
| Histórico | OHLC 4 intervalos; Steam 13 anos | 365 dias | 90–365 dias | 15–30 dias |
| Liquidez | endpoint próprio | não | não | não |
| Custo | US$ 75 (só atual) / US$ 200 (tudo) | € 25–50 | € 179–279 | ~€ 110 |
| Uso comercial | **não publicado** | **permitido, explícito** | não publicado | não publicado |

**Recomendado:** cs2.sh Developer (US$ 75) como referência de preço —
BUFF163 é a âncora do mercado, bid/ask separados revelam o spread, e o
endpoint de liquidez serve direto ao `buyoutEligible`. Opcionalmente
SteamWebAPI Starter (€ 25) ao lado, para preço nos mercados ocidentais.

**CSGOSKINS.GG está fora**: rastreia preço de anúncio, não de venda — o
mesmo defeito do Steam Market, e o mais caro da lista.

**cs2.sh respondeu em 17/08/2026** (Alex, `hello@cs2.sh`):

1. **Exibir os dados num marketplace comercial é permitido.** A única
   restrição é revender ou redistribuir a API e os dados — cachear e
   exibir é explicitamente aceito ("often necessary for our users'
   applications or websites"). Termos em
   `cs2.sh/terms#fair-use-and-rate-limits`.
2. **`/v1/liquidity/items` é exclusivo do plano Scale** (US$ 200).
3. **Atribuição não é exigida**, só apreciada.

**Decisão: começar no Developer (US$ 75).** O sinal de liquidez que o
`buyoutEligible` precisa não tem que vir pronto: o **spread entre bid e
ask** já indica liquidez e vem no Developer, e a série própria dá
estabilidade de preço em ~3 meses. São US$ 1.500/ano de diferença antes
de haver faturamento, e subir de plano depois é trivial.

**Ainda em aberto:** se o Developer traz volume junto do preço. É o que
decide se o Scale se paga. Resolver com a **chave gratuita de 2 dias**
(pedida no Discord) antes de assinar.

Falta a resposta do SteamWebAPI. Ver
[docs/emails-e-fornecedores.md](docs/emails-e-fornecedores.md).

**Regra ao juntar fontes:** BUFF manda no preço de referência; mercados
ocidentais aparecem ao lado, nunca numa média. Média entre mercados de
liquidez diferente produz número que não existe em lugar nenhum. Se duas
fontes divergirem além de um limite, **não exibir preço recomendado** em
vez de exibir um errado — mesmo critério da raspagem de adesivo.

### Decisões suas, sem código

| Decisão | Quando |
|---|---|
| Fonte de preço — ver abaixo, esperando resposta dos fornecedores | perto da vitrine |
| Hospedagem | em avaliação — requisitos em `docs/` |
| Fronteira com o Figma Make | quando a primeira tela usar a API |
| Reserva financeira proporcional ao custodiado | antes de volume real |

---

## Pendências conhecidas

- **Testes usam o banco de desenvolvimento**, e isso já custou caro duas
  vezes. Resolve com banco de teste isolado — subiu de prioridade.
  - **Os testes desligam o trigger de imutabilidade do `AuditLog`** para
    limpar o que criaram (`ALTER TABLE ... DISABLE TRIGGER`, em cinco
    specs). Enquanto a janela está aberta, o trigger está desligado **para
    a tabela inteira**, não só para aquela transação. Se um teste morrer
    entre o DISABLE e o ENABLE, a proteção fica desligada em silêncio — e
    a garantia de que "auditoria não pode ser apagada" deixa de existir
    sem ninguém perceber. Pior: apontar os testes para o banco errado
    desligaria a proteção lá.
  - **`suspiciousActivity` varre a tabela inteira**, então recusas de
    rodadas anteriores contam. O teste de ordenação afirmava quem era o
    primeiro da lista global, passava por um tempo e quebrava sozinho
    depois de algumas rodadas. Corrigido para comparar posições relativas
    dos seus próprios atores (13/08). **O mesmo acúmulo afeta o
    `pnpm audit:suspeitos` em produção**: sem `--dias` curto, tentativas
    antigas inflam a contagem.
- **Log estruturado ainda não vai para lugar nenhum.** Sai em stdout e
  fica na máquina. Sem coleta, um `docker compose restart` apaga a
  investigação. Decidir o destino (arquivo rotacionado, Loki, serviço
  gerenciado) junto com a hospedagem.
- **`Bot.itemCount` é denormalizado** e vai divergir.
- **Sem CI.**
- **`.gitattributes` ausente** — o git avisa sobre LF/CRLF a cada commit.
- **`STEAM_API_KEY` é da conta pessoal.** Em produção, gerar numa conta da
  operação.
- **Frontend:** React declarado como peer opcional, MUI instalado sem uso,
  `App.tsx` com 1730 linhas sem rotas, `Guidelines.md` vazio.

Sem bug aberto conhecido.

---

## Decisões técnicas não descritas no CLAUDE.md

- **Itens fungíveis: cada unidade é um anúncio próprio.** Decisão de
  adiar, não de ignorar. Motivo: agentes precisam ser diferenciados por
  causa dos patches. Revisitar ao construir a vitrine, quando cinquenta
  linhas idênticas impedirem descobrir o preço de mercado de uma caixa.
  Migrar depois não desfaz nada — `Item` continua uma linha por unidade
  física; muda só a camada de anúncio.
- **Cancelamento de anúncio é sempre permitido**, com a devolução agendada
  para quando o trade lock expirar. Reusa a fila da entrega, mudando só o
  `reason`.
- **Item encalhado não expira.** A resposta a slot cheio é adicionar bot,
  não devolver item de quem está esperando o preço subir.
- **Falha de entrega é coberta pela plataforma** com reembolso integral em
  saldo interno, nunca no método original.
- **Whitelist do fluxo rápido = liquidez + teto de preço**, calculada por
  job, não curada à mão. Campos já existem em `SkinTemplate`.
- **Item travado aparece na vitrine com contador**, não oculto.
- **Jest roda em série** (`maxWorkers: 1`): há estado compartilhado real
  (banco e limitador global de Steam no Redis), e paralelismo produz falha
  dependente de ordem.
- **`app-setup.ts` centraliza a configuração do app**, usada pelo
  bootstrap e pelos testes. Sem isso os testes rodariam sem prefixo de
  rota, sem ValidationPipe e sem cookie-parser — verde num app que não
  existe em produção.
- **Depois de `pnpm add` no backend, rodar `npx prisma generate`.** O
  preinstall do Prisma apaga o client gerado.
