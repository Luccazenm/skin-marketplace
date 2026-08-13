# Criar uma conta de Trade Bot

Roteiro para cada conta nova. Dois passos são irreversíveis e um dispara um
prazo de 7 dias — a ordem importa.

> **Sempre "Trade Bot", nunca só "Bot"**, em tudo que o usuário lê: nome
> de perfil, grupo, site e suporte. "Bot" sozinho é o que ele encontra em
> roleta, sorteio e conta de spam; o termo completo diz o que a conta faz
> — negociar — e é o mesmo vocabulário do grupo da Steam. No código, o
> modelo continua `Bot` (ver CLAUDE.md).

## Sequência

### 1. Criar a conta

E-mail próprio, um por conta: `tradebot<N>@nextskins.gg`. Sem catch-all —
se um for comprometido, os outros seguem isolados.

**Nome de usuário da Steam ≠ nome de perfil.** O campo do cadastro é o
nome de **login**: aceita só `a-z A-Z 0-9 _`, não é público, e **não pode
ser alterado depois**. O `NextSkins.gg | Trade Bot <N>` é o nome de
perfil, configurado no passo 4, onde ponto e barra funcionam.

Para o login, não derive da marca. O perfil do Trade Bot é público por
desenho — qualquer pessoa chega ao steamID64 dele pela nossa própria
página. Login previsível entrega metade da credencial de graça. Use
prefixo curto, número da conta e sufixo aleatório, gerado no gerenciador
de senhas e **diferente em cada conta** (sufixo repetido significa que
descobrir um revela todos):

```
nstb1_q7fk2m
nstb2_v4dzp9
```

O número no meio mantém a correspondência com o `Trade Bot 1` do perfil e
com o banco — que é do que você precisa ao investigar um problema.

**País: Brasil, em todas as contas.** O motivo é o passo 2: o meio de
pagamento precisa bater com o país da conta, e cartão brasileiro numa
conta configurada como EUA é recusado justamente no passo que libera a
conta para trabalhar. Trocar o país depois exige uma compra com meio de
pagamento do país novo e tem carência.

Some a isso que o login sempre virá do Brasil. Conta declarada em outro
país e acessada daqui é inconsistência gratuita, e Trade Bot é o tipo de
conta que não convém ver travada por verificação de segurança.

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

**Não use o aplicativo normal do celular.** O Trade Bot precisa do
`shared_secret` e do `identity_secret` para confirmar as trocas sozinho, e
esses valores só são exibidos na ativação. Pelo app comum, extraí-los
depois é trabalhoso e normalmente exige refazer o processo.

⚠️ **Copie os dois secrets antes de fechar a janela.** Refazer o
autenticador reinicia o prazo de 7 dias.

É neste passo que o relógio começa a correr.

### 4. Configurar o perfil

- Nome: `NextSkins.gg | Trade Bot <N>` — identificável de propósito. Ver
  [pendencias.md](./pendencias.md#página-pública-com-os-bots-oficiais):
  conta anônima é indistinguível de conta falsa. São 24 caracteres no
  Trade Bot 1, dentro do limite de 32 da Steam, com folga até o 10.
- Avatar: o mesmo do site.
- **Inventário público.** Se for privado, nem nós nem os usuários
  conseguimos verificar o que está em custódia.
- **URL personalizada**: `nextskins-tradebot<N>`. Exige conta não
  limitada, por isso o passo 2 vem antes.
- **Localização (País/Estado/Cidade): deixar em branco.** É o campo
  público, sem relação com o país do cadastro. Em branco nos cinco é
  consistente; preenchido em uns e vazio em outros é o tipo de diferença
  que um usuário atento estranha justamente quando está conferindo se a
  conta é de verdade.

Nada disso é verificação, e vale ter claro o porquê: nome, avatar e URL
personalizada são copiáveis em minutos. A URL personalizada não substitui
o SteamID64, que é imutável e sempre existe em `/profiles/<id>` — ela é só
um apelido apontando para o mesmo perfil, um nome parecido pode ser
registrado por outra pessoa, e uma URL abandonada volta a ficar livre.
Servem como sinal de conta cuidada, porque golpista apressado não
configura. A prova continua sendo o SteamID64 publicado na lista oficial.

### 5. Entrar no grupo oficial

Convidar a conta para **NextSkins.gg — Official Trade Bots**, o grupo
fechado que reúne todas elas. Ele é a segunda camada de conferência: o
usuário confirma na página de Trade Bots e vê o mesmo perfil listado no
grupo.

Conta fora do grupo é indistinguível de conta falsa — se ficar de fora, o
próprio mecanismo de defesa acusa a conta legítima. Conferir depois de
aceitar o convite.

Texto do grupo e o raciocínio de segurança em [grupo-steam.md](./grupo-steam.md).

### 6. Anotar o steamID64

Vai para o banco (`Bot.steamId`) e para a página pública de Trade Bots.

## O cofre

**Bitwarden**, com 2FA por aplicativo autenticador ativo.

A escolha não foi por preferência: o `bot-service` vai precisar ler o
`shared_secret` para confirmar as trocas sozinho, e o Bitwarden tem CLI.
Cofre sem acesso programático levaria a copiar segredo à mão para
variável de ambiente — exatamente o que o `credentialRef` existe para
evitar. Trocar de cofre depois de cinco contas dentro é trabalhoso.

O código 2FA do próprio Bitwarden **não** fica dentro do Bitwarden: se
for preciso o cofre para abrir o cofre, um celular perdido tranca tudo,
inclusive os Trade Bots. Senha mestra e código de recuperação ficam em
papel, num lugar físico seguro. Não há recuperação pelo suporte, por
desenho.

## O que guardar no cofre

Uma entrada por Trade Bot. O `Bot.credentialRef` no banco guarda só o
identificador dessa entrada — senha e secrets nunca chegam ao Postgres.

```
Login e senha da Steam            (o login não pode ser alterado depois)
shared_secret                     (só aparece na ativação)
identity_secret                   (só aparece na ativação)
steamID64
E-mail e senha do e-mail
Data da ativação do autenticador  (para saber quando libera)
País da conta                     (Brasil — define o meio de pagamento aceito)
Arquivo .maFile                   (anexo, ver abaixo)
```

**Anexe o `.maFile` do Steam Desktop Authenticator.** Ele fica na sua
máquina e contém os secrets. Perdê-lo sem ter copiado obriga a refazer o
autenticador — e refazer reinicia os 7 dias de espera.

## Regras permanentes

**Nunca abrir o CS2 nessas contas.** VAC ban vem de detecção de cheat em
partida e trava o inventário **para sempre**, sem apelação. Conta que
nunca abre o jogo tem risco praticamente nulo.

**Uma conta por dia.** Várias contas novas do mesmo IP no mesmo dia é o
padrão que a Valve associa a fazenda de contas.

**Não jogue e não adicione amigos.** Quanto menos a conta parecer uma
conta de uso pessoal improvisada, melhor.

**Nenhum grupo além do oficial.** O grupo do passo 5 é o único, e é
obrigatório. Grupo de terceiro no perfil de um Trade Bot é ruído
exatamente onde o usuário está tentando decidir se a conta é confiável.

## Quando a conta fica pronta

7 dias após a ativação do autenticador. Antes disso, as trocas saem com
hold de até 15 dias — o que na prática significa que a conta não serve
para operar.

Os prazos das contas correm em paralelo: criar três no mesmo período custa
uma semana no total, não três.
