# Pendências

Decisões e trabalhos em aberto, levantados durante a construção. Cada item
é algo que já sabemos que vai precisar de resposta — não são ideias soltas.

Pendências específicas do worker de trocas estão em
[apps/bot-service/README.md](../apps/bot-service/README.md).

---

## Domínio

### Tipos de item além de skins

O modelo `Item` foi desenhado para skins: exige `float`, `paintSeed`,
`paintIndex` e `defIndex`. A leitura do inventário mostrou que isso não
cobre tudo o que existe numa conta:

| Tipo | Negociável | Tem float | Observação |
|---|---|---|---|
| Skin | sim | sim | é o que o modelo cobre hoje |
| Caixa | sim | **não** | fungível: uma caixa é idêntica à outra |
| Adesivo, grafite, chaveiro | sim | não | fungíveis, mas com valor de mercado |
| Medalha, insígnia | **não** | — | nunca poderá ser depositada |
| Faca/luva | sim | sim | skin normal para efeito de modelo |

O modelo já acomoda: `Item.category` existe e os campos de float são
opcionais, com CHECK exigindo-os apenas para arma, faca e luva.

### Agentes NÃO são fungíveis

Cada agente aceita até 3 patches, e patch aplicado **não volta** para o
inventário — só pode ser destruído. Um agente com patches é
permanentemente distinto de um limpo, mesmo sem ter float.

O mesmo raciocínio vale para chaveiro preso a uma arma: solto no
inventário é fungível, aplicado deixa de ser.

Ou seja, "pode ser diferenciado" tem duas fontes, e só cobrimos uma:

| Fonte | Onde se aplica | Modelado? |
|---|---|---|
| float + paint seed | arma, faca, luva | sim |
| aplicações | sticker e chaveiro em arma, **patch em agente** | parcial |

`ItemSticker` só cobre sticker de arma: tem `stickerName`, `position`
(0 a 4) e `wear`. Para cobrir o resto precisa virar genérico, com um tipo
(`STICKER`, `PATCH`, `CHARM`), porque patch usa 3 posições e nem patch nem
chaveiro têm desgaste.

Fazer junto com o depósito, que é quando esses dados começam a ser lidos.

### Fungíveis: decisão tomada em 06/08/2026

**Cada unidade é um anúncio próprio.** Nada muda no schema — é o
comportamento que já existe.

Motivo da escolha: agentes precisam ser diferenciados por causa dos
patches, e agrupar por template os trataria como intercambiáveis.

As alternativas avaliadas e descartadas por ora:

- *Listagem agrupada* ("Dreams & Nightmares — 50 disponíveis a partir de
  $1,20"): exige quantidade em `Listing` e `Order`, mais lógica de
  alocação e reserva quando alguém compra 3 de 50. É a experiência correta
  a longo prazo e o que os sites grandes fazem.
- *Só pelo fluxo rápido*: usuário vende a caixa para a plataforma, que
  revende do estoque próprio. Evita alocação de item de terceiro, mas
  consome caixa.
- *Não aceitar fungíveis*: escopo mínimo, abre mão de um mercado líquido.

**Quando revisitar:** ao construir a vitrine. Com poucos itens ninguém
nota; com volume, cinquenta linhas idênticas tornam impossível saber o
preço de mercado da caixa, e o vendedor precisa criar cinquenta anúncios à
mão. O sinal de alerta é a primeira reclamação sobre isso — ou o primeiro
usuário com estoque grande de caixas.

Migrar para listagem agrupada depois não desfaz nada: `Item` continua uma
linha por unidade física, porque o bot guarda cinquenta caixas de verdade.
O que muda é a camada de anúncio.

### Ainda em aberto

Medalhas e itens não negociáveis devem ser **escondidos** da tela de
depósito, não mostrados e recusados depois. O endpoint já suporta
(`?depositable=true`); falta a tela usar.

### Fonte de preço de mercado

`SkinTemplate.referencePrice` existe e está vazio. Decisão pendente: de
onde vem o número.

**A Steam não serve**, por dois motivos independentes:

- *Preço inflado*: o saldo do Steam Market não pode ser sacado, então as
  pessoas aceitam pagar mais lá. Mercados onde o dinheiro sai ficam
  consistentemente abaixo. Usar Steam como referência faria o site parecer
  caro.
- *Rate limit*: ~20 consultas por minuto. Com ~20 mil itens, uma
  atualização completa passaria de 16 horas.

Alternativas são serviços pagos que agregam vários mercados (Buff163,
CSFloat, Skinport, Steam) e ponderam por vendas concluídas, não por
anúncios: Pricempire, cs2.sh, SteamAnalyst, SteamWebAPI, CSGOSKINS.GG.

Vira **custo recorrente** — decidir junto com o resto da conta de
viabilidade. Escolher perto de construir a vitrine, quando dá para
comparar assinatura com uso real.

### Preço de skin com sticker: não automatizar

O mercado chama de **SP%** — quanto do valor do sticker transfere para a
arma depois de aplicado:

| Tipo | Transfere |
|---|---|
| Comum de torneio | 2–5% |
| Holo/foil popular | 5–15% |
| Katowice 2014 holo | 15–50%+ |

E varia com posição, alinhamento, combinação com a skin e demanda. O mesmo
sticker vale o dobro ou a metade dependendo de onde foi colado. **Nenhuma
API entrega isso com confiança.**

Um exemplo concreto está no inventário de teste: uma AK-47 Blue Laminate
com três Katowice 2014. A skin limpa custa poucos dólares; com esses
stickers, ordens de grandeza mais.

O que fazer: mostrar o **preço base da skin** e a **lista de stickers com o
valor de cada** separadamente, deixando o vendedor definir o total. O
comprador vê os mesmos dados e julga. Calcular um número único e
apresentá-lo como "preço de mercado" seria errar com aparência de
precisão.

### Catálogo precisa acomodar itens que não são skins de arma

`SkinTemplate` tem `weapon` e `skinName` — foi modelado para armas. Um
sticker não tem arma. Para guardar preço de sticker (necessário para o
item acima), o catálogo precisa acomodar esses casos.

### Página pública com os bots oficiais

Golpistas copiam bots de sites de trade: mesmo avatar, mesmo nome, mesma
descrição, e mandam uma oferta que parece a real mas vai para a conta
deles. O usuário aceita achando que é do site e perde as skins.

A defesa é uma página pública listando os bots oficiais, e o dado que
importa é o **steamID64** — nome, avatar e descrição são copiáveis; o
steamID não.

Duas consequências:

- Os bots devem se identificar abertamente (nome com a marca, avatar do
  site). Bot anônimo é indistinguível de bot falso.
- A lista deve sair do banco (`Bot.steamId` + `Bot.status`), não de HTML
  escrito à mão, senão desatualiza quando um bot entra ou sai de rotação.

Também vale instruir na tela de depósito: confira o steamID de quem
enviou a oferta antes de aceitar.

### Concentração de risco nos e-mails dos bots

Os e-mails das contas de bot ficam num domínio próprio
(`tradebot<N>@nextskins.gg`). Isso organiza, mas concentra: quem
comprometer o painel de e-mail alcança todas as contas de bot, e com elas
todo o inventário custodiado.

Mitigações: renovação automática do domínio, 2FA no provedor de e-mail e
senhas distintas por conta.

### Reserva e limite de exposição por bot

`Bot.maxItems` limita quantidade, não valor. 900 skins de $2 e 40 facas de
$800 representam riscos muito diferentes se aquele bot for banido.

Falta um teto de valor custodiado por bot e uma política de reserva
financeira proporcional ao total sob custódia — se a frota cair, o valor
devido aos usuários pode exceder o caixa.

---

## Autenticação

### Revogação de sessão

`POST /api/auth/logout` apaga o cookie, mas o JWT continua válido até
expirar. Quem tiver copiado o token continua entrando.

O guard já consulta o banco a cada requisição e bloqueia conta banida, o
que cobre o caso grave. Falta invalidar tokens individualmente — uma
blacklist no Redis resolve. Vale fazer antes de existir saque de dinheiro.

---

## Frontend

Todos estes dependem da decisão de fronteira com o Figma Make, que só
precisa ser tomada quando a primeira tela for ligada na API.

- **Fronteira Figma**: hoje a importação substitui a pasta inteira, então
  nada escrito à mão sobrevive em `apps/frontend`. Duas saídas propostas:
  substituir apenas `src/app/` e `src/styles/`, ou isolar o bundle e criar
  um app separado que o consome.
- **`guidelines/Guidelines.md` vazio**: é onde se instrui o agente do
  Figma. Preencher é mais barato que corrigir cada importação na mão.
- **MUI vs shadcn**: ambos instalados, MUI sem nenhum uso no código. Não
  remover antes de saber se o Make pode gerar telas com ele.
- **React como peer opcional**: `react` e `react-dom` estão em
  `peerDependencies` com `optional: true`. Funciona por acidente do
  auto-install do pnpm.
- **`App.tsx` com 1730 linhas**: o app inteiro num arquivo, sem rotas.
  Vai precisar ser quebrado quando entrar roteamento.

---

## Infraestrutura

- **Sem CI**: nada roda typecheck, lint ou testes antes de entrar no
  repositório. Vale quando houver deploy automático ou mais alguém no
  projeto.
- **Testes usam o banco de desenvolvimento**: limpam o que criam e usam
  steamIds fictícios reservados, mas o certo é um banco separado. Resolve
  junto com o CI, onde o banco é efêmero por natureza.
- **`.gitattributes` ausente**: o git avisa sobre conversão LF/CRLF a cada
  commit. Inofensivo hoje; vira diff fantasma se entrar CI em Linux ou
  outra pessoa no projeto.
- **Chave da Steam é pessoal**: a `STEAM_API_KEY` em uso está vinculada à
  conta pessoal. Em produção, gerar numa conta da operação.
