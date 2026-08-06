# bot-service

Worker responsável pelas trocas com a Steam. **Ainda não implementado.**

Roda como processo separado da API, não como thread dela: a API escala com
usuários e os bots escalam com trades — são pressões diferentes.

Consome a fila (BullMQ + Redis, já de pé no docker-compose) e executa as
`TradeOffer` pendentes.

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
