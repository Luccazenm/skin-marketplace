# bot-service

Worker responsável pelas trocas com a Steam. **Ainda não implementado.**

Roda como processo separado da API, não como thread dela: a API escala com
usuários e os bots escalam com trades — são pressões diferentes.

Consome a fila (BullMQ + Redis, já de pé no docker-compose) e executa as
`TradeOffer` pendentes.

---

## Regra que vem antes de tudo: o bot só envia, nunca aceita

**O Trade Bot cria todas as ofertas em que participa, nos dois sentidos.**
No depósito, ele envia uma oferta *pedindo* os itens do usuário. Na
entrega, envia uma oferta *oferecendo* os itens. Em nenhum momento ele
aceita uma oferta que alguém mandou para ele.

O motivo é simples e não tem exceção: **quem cria a oferta define o
conteúdo dela.** Se o bot só envia, cada troca foi montada por nós a
partir de `TradeOffer.requestedAssetIds`, que já está no banco antes de
qualquer contato com a Steam. Se o bot aceitasse ofertas de fora, ele
estaria confiando num objeto construído por outra pessoa — e aí o
conteúdo, o destinatário e o momento passam a ser escolha dela.

O que essa regra fecha:

- **Depósito falso.** Alguém manda skins baratas junto com o esperado, ou
  no lugar dele, e reivindica crédito pelo que prometeu.
- **Troca de conteúdo na última hora.** Numa oferta que nós criamos, o
  conteúdo é o que gravamos; numa que recebemos, é o que a outra parte
  decidiu no último segundo.
- **Depósito não solicitado.** Item que chega sem `TradeOffer`
  correspondente não tem dono no nosso banco — vira disputa sem resposta.
- **Confusão com golpe de terceiro.** Se o bot nunca aceita, "o bot
  aceitou minha oferta" é sempre falso, e isso é verificável.

### Como implementar

**Recusar explicitamente, não ignorar.** Toda oferta recebida é negada
(`declineOffer`), não deixada pendente. Oferta pendente na tela do usuário
parece que estamos analisando, e vira reclamação. Recusar também deixa
claro para quem tentou que não é assim que funciona.

**Registrar toda oferta recebida na auditoria**, com quem enviou e o que
continha. Não é ruído: usuário confuso manda uma e para; quem manda várias
está testando o sistema, e esse padrão só existe se ficar gravado.

**Sem exceção para conta nossa.** Mover itens entre Trade Bots também é o
bot de origem enviando. Abrir exceção "só para o admin" cria um caminho
de aceitação que passa a existir — e caminho que existe é caminho que
pode ser explorado.

**Casar a oferta que voltou com a que criamos.** Guardar o id devolvido
pela Steam na `TradeOffer` e, ao processar o resultado, conferir que o
conteúdo aceito é o que pedimos. A Steam permite ao usuário aceitar ou
recusar, não editar — mas a conferência é barata e o custo de estar
errado é um item.

**Reler o inventário imediatamente antes de criar a oferta.** `assetId`
muda a cada troca: se o usuário mexeu no inventário entre pedir o
depósito e o bot agir, os ids gravados apontam para o nada.

---

## Pendências conhecidas

Levantadas durante a modelagem. Não são ideias soltas: cada uma é um caso
que já sabemos que vai acontecer.

### 1. Rechecar ban da Steam antes de entregar

`User.steamEconomyBan` só é atualizado no login. Se alguém for banido
depois de logar, nossos dados ficam desatualizados até a próxima entrada.

O que acontece sem isso: o worker tenta criar o trade offer, a Steam
recusa, a oferta vai para `FAILED` e o retry tenta de novo — para sempre,
porque a condição nunca muda sozinha. A fila entope e o usuário só vê
"falhou" sem explicação.

Antes de criar a oferta, olhar `User.steamBanCheckedAt`. Se estiver velho,
reconsultar via `SteamBanService`. Se estiver bloqueado, não tentar:
marcar como impedida e informar o motivo.

Ver `src/auth/steam-restrictions.ts` na API para as regras de quem pode o
quê. Resumo: economy ban impede depositar e receber; VAC impede só
enviar; vender pelo site nunca é bloqueado.

### 2. Fila agendada pelo trade lock

`TradeOffer` com status `SCHEDULED` e `scheduledFor` preenchido espera o
trade lock de 7 dias da Valve expirar. O índice `[status, scheduledFor]`
existe para essa varredura.

Vale tanto para entrega ao comprador quanto para devolução de anúncio
cancelado — muda só o `reason`.

### 3. Retry com limite

`TradeOffer.attempts` existe mas ninguém o respeita ainda. Falha
permanente (conta banida, item que não está mais no bot) não pode entrar
em retry infinito. Depois de N tentativas, parar e escalar para
atendimento.

### 4. Roteamento por capacidade do bot

`Bot.maxItems` tem default 900 porque o inventário Steam trava em 1000.
Ao escolher um bot para receber depósito, respeitar isso.

Falta ainda um **teto por valor**, não só por quantidade: 900 skins de $2
e 40 facas de $800 são riscos muito diferentes se aquele bot cair.

### 5. Detectar ban do próprio bot

Se um bot for banido, o inventário dele fica travado permanentemente — VAC
ban não expira e não tem apelação. Todas as skins ali estão perdidas.

O detalhe cruel: a conta banida **continua recebendo** itens. Sem detecção,
o roteamento segue mandando depósitos para um bot que nunca vai devolver,
e a perda cresce depois do incidente.

Job periódico checando o status de cada bot. Ao detectar qualquer
restrição, tirar de rotação **antes** de qualquer outra coisa.

### 6. Reconciliar `Bot.itemCount`

É denormalizado e vai divergir do inventário real. Job periódico
comparando com o que a Steam reporta.
