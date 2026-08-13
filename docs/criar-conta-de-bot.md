# Criar uma conta de bot

Roteiro para cada conta nova. Dois passos são irreversíveis e um dispara um
prazo de 7 dias — a ordem importa.

## Sequência

### 1. Criar a conta

E-mail próprio, um por conta: `tradebot<N>@nextskins.gg`. Sem catch-all —
se um for comprometido, os outros seguem isolados.

**País: Brasil, em todas as contas.** O motivo é o passo 2: o meio de
pagamento precisa bater com o país da conta, e cartão brasileiro numa
conta configurada como EUA é recusado justamente no passo que libera o
bot para trabalhar. Trocar o país depois exige uma compra com meio de
pagamento do país novo e tem carência.

Some a isso que o login sempre virá do Brasil. Conta declarada em outro
país e acessada daqui é inconsistência gratuita, e conta de bot é o tipo
de conta que não convém ver travada por verificação de segurança.

Não há ganho em escolher outro país: **esse campo não é público.** Ele
define loja e moeda, nada mais. A localização que aparece no perfil é
outro campo, opcional, editado depois (ver passo 4).

Manter igual em todos importa: quando houver cinco contas e uma tiver
sido criada diferente, a diferença reaparece meses depois, no pagamento
do desbloqueio, quando ninguém lembra o porquê.

Confirme o e-mail e verifique que o **Steam Guard por e-mail está ativo**.
Contas novas já vêm com ele, mas se estiver desativado, adicionar o
autenticador depois dispara 15 dias de restrição em vez de 7.

### 2. Gastar US$ 5

Conta limitada não consegue trocar. Faça a compra antes de tudo — melhor
descobrir um problema agora do que depois de esperar uma semana.

### 3. Ativar o autenticador pelo Steam Desktop Authenticator

**Não use o aplicativo normal do celular.** O bot precisa do
`shared_secret` e do `identity_secret` para confirmar as trocas sozinho, e
esses valores só são exibidos na ativação. Pelo app comum, extraí-los
depois é trabalhoso e normalmente exige refazer o processo.

⚠️ **Copie os dois secrets antes de fechar a janela.** Refazer o
autenticador reinicia o prazo de 7 dias.

É neste passo que o relógio começa a correr.

### 4. Configurar o perfil

- Nome: `NextSkins.gg | Bot <N>` — identificável de propósito. Ver
  [pendencias.md](./pendencias.md#página-pública-com-os-bots-oficiais):
  bot anônimo é indistinguível de bot falso.
- Avatar: o mesmo do site.
- **Inventário público.** Se for privado, nem nós nem os usuários
  conseguimos verificar o que está em custódia.
- **URL personalizada**: `nextskins-bot<N>`. Exige conta não limitada, por
  isso o passo 2 vem antes.
- **Localização (País/Estado/Cidade): deixar em branco.** É o campo
  público, sem relação com o país do cadastro. Em branco nos cinco é
  consistente; preenchido em uns e vazio em outros é o tipo de diferença
  que um usuário atento estranha justamente quando está conferindo se o
  bot é de verdade.

Sobre a URL personalizada: ela não substitui o SteamID64, que é imutável e
sempre existe em `/profiles/<id>`. É só um apelido apontando para o mesmo
perfil. Serve como sinal de conta cuidada — golpista apressado não
configura — mas **não é verificação**: um nome parecido pode ser
registrado por outra pessoa, e uma URL personalizada abandonada volta a
ficar livre. A lista oficial de bots continua publicando o SteamID64.

### 5. Entrar no grupo oficial

Convidar a conta para **NextSkins.gg — Official Trade Bots**, o grupo
fechado que reúne todos os bots. Ele é a segunda camada de conferência: o
usuário confirma na página de bots e vê o mesmo perfil listado no grupo.

Bot fora do grupo é indistinguível de bot falso — se ficar de fora, o
próprio mecanismo de defesa acusa a conta legítima. Conferir depois de
aceitar o convite.

Texto do grupo e o raciocínio de segurança em [grupo-steam.md](./grupo-steam.md).

### 6. Anotar o steamID64

Vai para o banco (`Bot.steamId`) e para a página pública de bots.

## O que guardar no gerenciador de senhas

Uma entrada por bot. O `Bot.credentialRef` no banco guarda só o
identificador dessa entrada — senha e secrets nunca chegam ao Postgres.

```
Login e senha da Steam
shared_secret                     (só aparece na ativação)
identity_secret                   (só aparece na ativação)
steamID64
E-mail e senha do e-mail
Data da ativação do autenticador  (para saber quando libera)
País da conta                     (Brasil — define o meio de pagamento aceito)
```

## Regras permanentes

**Nunca abrir o CS2 nessas contas.** VAC ban vem de detecção de cheat em
partida e trava o inventário **para sempre**, sem apelação. Bot que nunca
abre o jogo tem risco praticamente nulo.

**Uma conta por dia.** Várias contas novas do mesmo IP no mesmo dia é o
padrão que a Valve associa a fazenda de contas.

**Não jogue e não adicione amigos.** Quanto menos a conta parecer uma
conta de uso pessoal improvisada, melhor.

**Nenhum grupo além do oficial.** O grupo do passo 5 é o único, e é
obrigatório. Grupo de terceiro no perfil de um bot é ruído exatamente
onde o usuário está tentando decidir se a conta é confiável.

## Quando a conta fica pronta

7 dias após a ativação do autenticador. Antes disso, as trocas saem com
hold de até 15 dias — o que na prática significa que o bot não serve para
operar.

Os prazos das contas correm em paralelo: criar três no mesmo período custa
uma semana no total, não três.
