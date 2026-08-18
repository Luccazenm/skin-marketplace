# bot-service

The worker responsible for trades with Steam. **Not implemented yet.**

It runs as a process separate from the API, not as a thread of it: the
API scales with users and the bots scale with trades — different
pressures.

It consumes the queue (BullMQ + Redis, already up in docker-compose) and
executes the pending `TradeOffer` rows.

---

## The rule that comes before everything: the bot only sends, never accepts

**The Trade Bot creates every offer it takes part in, in both
directions.** On a deposit, it sends an offer *asking for* the user's
items. On a delivery, it sends an offer *offering* the items. At no point
does it accept an offer somebody sent to it.

The reason is simple and has no exception: **whoever creates the offer
defines its contents.** If the bot only sends, every trade was assembled
by us from `TradeOffer.requestedAssetIds`, which is already in the
database before any contact with Steam. If the bot accepted offers from
outside, it would be trusting an object built by someone else — and then
the contents, the recipient and the timing become their choice.

What this rule closes off:

- **A fake deposit.** Someone sends cheap skins alongside what was
  expected, or in its place, and claims credit for what they promised.
- **A last-second content swap.** In an offer we created, the contents
  are what we recorded; in one we receive, they are whatever the other
  party decided at the last second.
- **An unsolicited deposit.** An item arriving with no matching
  `TradeOffer` has no owner in our database — it becomes a dispute with
  no answer.
- **Confusion with a third-party scam.** If the bot never accepts, "the
  bot accepted my offer" is always false, and that is verifiable.

### How to implement it

**Refuse explicitly, do not ignore.** Every offer received is declined
(`declineOffer`), not left pending. A pending offer on the user's screen
looks as though we are reviewing it, and turns into a complaint. Refusing
also makes it clear to whoever tried that this is not how it works.

**Record every received offer in the audit log**, with who sent it and
what it contained. This is not noise: a confused user sends one and
stops; someone who sends several is testing the system, and that pattern
only exists if it is written down.

**No exception for our own accounts.** Moving items between Trade Bots is
also the source bot sending. Opening an "admin only" exception creates an
acceptance path that then exists — and a path that exists is a path that
can be exploited.

**Match the offer that came back with the one we created.** Store the id
Steam returns on the `TradeOffer` and, when processing the result, check
that the accepted contents are what we asked for. Steam lets the user
accept or refuse, not edit — but the check is cheap and the cost of being
wrong is an item.

**Re-read the inventory immediately before creating the offer.**
`assetId` changes with every trade: if the user touched their inventory
between requesting the deposit and the bot acting, the recorded ids point
at nothing.

---

## Known open items

Raised during modelling. These are not loose ideas: each one is a case we
already know will happen.

### 1. Re-check the Steam ban before delivering

`User.steamEconomyBan` is only updated at login. If someone is banned
after signing in, our data is stale until their next sign-in.

What happens without this: the worker tries to create the trade offer,
Steam refuses, the offer goes to `FAILED` and the retry tries again —
forever, because the condition never changes on its own. The queue clogs
and the user only sees "failed", with no explanation.

Before creating the offer, look at `User.steamBanCheckedAt`. If it is
old, query again through `SteamBanService`. If the account is blocked, do
not try: mark the offer as barred and report the reason.

See `src/auth/steam-restrictions.ts` in the API for the rules on who can
do what. In short: an economy ban prevents depositing and receiving; VAC
prevents sending only; selling through the site is never blocked.

### 2. A queue scheduled by the trade lock

A `TradeOffer` with status `SCHEDULED` and `scheduledFor` filled in is
waiting for Valve's 7-day trade lock to expire. The `[status,
scheduledFor]` index exists for that scan.

It applies both to delivery to the buyer and to returning a cancelled
listing — only the `reason` differs.

### 3. Retry with a limit

`TradeOffer.attempts` exists but nothing respects it yet. A permanent
failure (a banned account, an item no longer in the bot) must not go into
an infinite retry. After N attempts, stop and escalate to support.

### 4. Routing by bot capacity

`Bot.maxItems` defaults to 900 because a Steam inventory caps out at
1000. When picking a bot to receive a deposit, respect that.

Still missing is a **ceiling by value**, not only by quantity: 900 skins
worth $2 and 40 knives worth $800 are very different risks if that bot
goes down.

### 5. Detect a ban on the bot itself

If a bot gets banned, its inventory is locked permanently — a VAC ban
does not expire and cannot be appealed. Every skin in there is lost.

The cruel detail: a banned account **keeps receiving** items. Without
detection, routing goes on sending deposits to a bot that will never give
them back, and the loss grows after the incident.

A periodic job checking each bot's status. On detecting any restriction,
take it out of rotation **before** anything else.

### 6. Reconcile `Bot.itemCount`

It is denormalised and will drift from the real inventory. A periodic job
comparing it with what Steam reports.
