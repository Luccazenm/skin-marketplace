# Pendências

Decisões e trabalhos em aberto, levantados durante a construção. Cada item
é algo que já sabemos que vai precisar de resposta — não são ideias soltas.

Pendências específicas do worker de trocas estão em
[apps/bot-service/README.md](../apps/bot-service/README.md).

---

## O que depende das contas de bot

Situação em 12/08/2026: as contas estão sendo criadas e o autenticador leva
7 dias para maturar. Esta seção separa o que está bloqueado por isso do que
não está.

### Bloqueado até haver bot operante

Nada aqui pode ser testado de verdade sem uma conta funcionando.

- **`bot-service` inteiro** — enviar oferta, detectar aceite, criar `Item`
  com o float lido do inspect link.
- **Fila agendada pelo trade lock** — `SCHEDULED` e `scheduledFor` só
  fazem sentido com alguém para executá-los.
- **Retry com limite** — `TradeOffer.attempts` existe e ninguém respeita.
- **Rechecar ban antes de entregar** — sem isso o retry roda infinito
  contra conta bloqueada.
- **Detectar ban do próprio bot** — o mais crítico da lista: conta banida
  continua recebendo itens, então a perda cresce depois do incidente.
- **Reconciliar `Bot.itemCount`** — comparar com inventário real exige
  inventário real.
- **Teto de valor por bot** — depende de preço e de bot.
- **Preencher stickers e patches no `Item`** — só é lido quando a skin
  entra em custódia.

### Livre para fazer agora

- **Catálogo para itens que não são armas** — bloqueia guardar preço de
  sticker.
- **Campo de URL personalizada em `Bot`** — só exibição.
- **Página pública de bots** — o endpoint dá para escrever; fica vazio até
  haver bot cadastrado.
- **Vitrine e anúncios** — `Listing` já existe no modelo; dá para
  construir e testar com dados semeados.
- **Todo o frontend** — preso à decisão de fronteira com o Figma, não aos
  bots.
- **Infraestrutura** — CI, banco de teste separado, `.gitattributes`,
  chave da Steam de produção.

### Decisões sem código envolvido

| Decisão | Quando |
|---|---|
| Fonte de preço (serviço pago, custo recorrente) | perto de construir a vitrine |
| Hospedagem | em avaliação |
| Fronteira com o Figma Make | quando a primeira tela for ligada na API |
| Reserva financeira proporcional ao custodiado | antes de haver volume real |

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

**Resolvido em 12/08/2026:** `ItemSticker` virou `ItemApplication`, com
tipo (`STICKER`, `PATCH`, `CHARM`), imagem e limites de slot por tipo.

Uma linha por unidade, **nunca agrupada por nome com uma contagem**: duas
cópias do mesmo sticker podem ter raspagens diferentes, e uma pode valer
múltiplos da outra. Agrupar destruiria isso de forma irreversível, já que
depois da entrega o item sai do nosso alcance e o inspect link antigo
deixa de funcionar.

O `slot` guarda a ordem em que a Steam devolve, não o lugar físico na arma
— a própria Valve inverte posições entre o inventário web e o do jogo.
Serve para reconstruir a lista e distinguir unidades de mesmo nome.

Falta apenas o preenchimento, que é do worker: `wear` não vem no
inventário, sai do inspect link junto com float e paint seed.

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

Falta um campo em `Bot` para a URL personalizada do perfil, apenas para
exibição. Ela não serve como identificador: pode ser imitada com um nome
parecido e volta a ficar livre se o bot deixar de usá-la. A chave continua
sendo `steamId`, que é imutável — se a URL personalizada fosse a
referência, trocá-la no perfil quebraria os vínculos.

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

### Revogação de sessão — resolvido em 12/08/2026

`POST /api/auth/logout` invalida o token atual e `POST /api/auth/logout-all`
derruba todos os do usuário. As entradas ficam no Redis com TTL igual ao
que resta de vida do token.

Se o Redis cair, a checagem deixa passar: o guard ainda consulta o banco e
bloqueia conta banida, que é o caso grave.

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
