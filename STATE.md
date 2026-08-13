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

### Trade URL

`PUT /api/users/me/trade-url` — confere que o `partner` corresponde ao
usuário autenticado. Guarda versão normalizada.

### Depósito (parcial)

`POST /api/deposits` registra a intenção e enfileira a `TradeOffer` em
`CREATED`. Valida trade URL, restrição da Steam, posse dos itens, se são
depositáveis, se já estão em outra troca, e escolhe o bot mais vazio.

**Hoje responde 503 em qualquer depósito**, porque não há bot cadastrado.
Isso é o comportamento correto, não um bug.

### Bots

`pnpm bot:add` e `pnpm bot:list`. O cadastro confirma com a Steam que a
conta existe e não tem restrição de negociação, e registra na auditoria.

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

### Decisões suas, sem código

| Decisão | Quando |
|---|---|
| Fonte de preço (serviço pago, custo recorrente) | perto da vitrine |
| Hospedagem | em avaliação — requisitos em `docs/` |
| Fronteira com o Figma Make | quando a primeira tela usar a API |
| Reserva financeira proporcional ao custodiado | antes de volume real |

---

## Pendências conhecidas

- **Testes usam o banco de desenvolvimento.** Limpam o que criam, mas
  poluem a auditoria e obrigam o jest a rodar em série. Resolve com banco
  de teste isolado.
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
