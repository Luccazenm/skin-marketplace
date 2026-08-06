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

Decisões necessárias antes do depósito:

1. O site aceita **só skins** ou também caixas e adesivos? Caixas têm
   mercado ativo e liquidez alta — justamente o perfil do fluxo rápido.
2. Se aceitar itens fungíveis, `Item` precisa mudar: ou os campos de float
   viram opcionais, ou surge uma separação entre item único e item
   fungível. Itens fungíveis também mudam a listagem — faz pouco sentido
   anunciar 50 caixas idênticas separadamente.
3. Medalhas e itens não negociáveis devem ser **escondidos** da tela de
   depósito, não mostrados e recusados depois.

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
