# NextSkins — project context

A Counter-Strike 2 skin marketplace. Users sign in with their Steam
account, deposit skins into custody bots, list them at a price, and the
buyer receives the item through a Steam trade. International reach.

There is also a **fast flow**: the platform buys the skin from the user
at a steep discount and resells it at full price — an own-stock
operation, carrying price risk, not intermediation.

No loot boxes, no roulette. A marketplace and nothing else.

## Stack

| Layer | Technology |
|---|---|
| Backend | TypeScript + NestJS |
| Database | PostgreSQL 16 via Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Cache and queue | Redis 7 (ioredis; BullMQ once the worker exists) |
| Frontend | TypeScript + React 18 + Vite + Tailwind v4 (bootstrapped in Figma Make; the code lives here now) |
| Bot worker | `apps/bot-service` — still empty |
| Monorepo | pnpm workspaces + turbo |

All TypeScript on purpose: the mature libraries for operating a Steam bot
(`steam-user`, `steam-tradeoffer-manager`) are Node, and the types Prisma
generates serve both the API and the worker with no duplication.

---

## Architecture decisions, and why

### Money

**`Transaction` is an append-only ledger, in USD.** Never edit an amount
after creation; a refund is a new row. A fee becomes a separate `FEE`
row, not an embedded field — that way revenue is a straight sum instead
of a reconstruction from scattered fields.

**The platform's account is a `User` with `isPlatform = true`.** The
alternative would be a flag on `Item`, but then `Listing.sellerId` and
`Order.sellerId` would have to be nullable and every piece of selling
code would carry an "if it belongs to the platform" branch. With a system
account, the fast flow uses the same path as a normal sale, and the cash
is that account's balance. **Cost: every "real users" query has to filter
`isPlatform = false`.**

**The balance is always USD internally.** `displayCurrency` is
presentation. The source currency and `fxRate` live in the ledger because
the FX spread is ~24% of projected revenue.

**The seller is only credited on confirmed delivery.** The `SALE`
`Transaction` is born `PENDING` and becomes `COMPLETED` when the `Order`
reaches `DELIVERED`.

### Items and Steam

**`Item.assetId` is NOT unique and is mutable.** The asset id changes
with every inventory trade. The stable identity is the four immutable
properties: `float + paintSeed + paintIndex + defIndex`. Valve closed the
endpoint that gave the original id in 2017, so there is no shortcut.

**`ItemLocation` is physical position only.** "Listed" is
`Listing.active`, "sold" is `Order`. In our flow the item stays in
`BOT_CUSTODY` from deposit to delivery, sold or not.

**Float, paint seed and stickers come from the inventory endpoint
itself.** Verified on 2026-08-17 against a real inventory: the response
carries `asset_properties` per item — `propertyid 1` is the paint seed,
`propertyid 2` is the float, `propertyid 6` is the self-encoded inspect
link — and `asset_accessories` carries the applied stickers.

**There is no inspect infrastructure in this project, and there must not
be.** No dedicated account, no Game Coordinator, no inspection queue:
Valve now delivers this data in the public inventory read, which we
already do and which already has a cache and a rate limiter. That is also
what keeps the rule of never opening CS2 on those accounts standing.

**An `Item` is only born when it enters custody.** The reason is
ownership, not missing data: while the skin is with the user, it is not
ours to record. That is why a deposit only stores
`TradeOffer.requestedAssetIds` — the Steam addresses of what we expect to
receive. Float and pattern, however, can already be displayed before
that.

### Selling

**Selling is one step for the user and two for us.** They pick items,
set a price, and confirm. The Trade Bot then sends an offer asking for
those items, and the moment it receives them the listing is already
live at the price they set. There is no second "now list it" screen.

**The price is therefore chosen before the `Item` exists.** It has to
travel with the deposit and survive until the bot receives — that is
what `IntendedListing` is for, one row per item, carrying the price from
the request to the moment the listing is created. Decided 2026-08-18.

**A locked item is listed like any other, with the lock shown.** Valve's
7-day lock does not hold the listing back: it is published with a
padlock and the days remaining, and the buyer decides whether that suits
them. Buying it changes the owner in our database; delivery happens when
the lock expires. Hiding locked items would shrink the storefront to
almost nothing in the first week of any deposit.

**The price is never final.** The seller can raise or lower it at any
time, before or after the item is in custody, for as long as the listing
is open. `IntendedListing.price` is only the opening price; once the
item arrives, `Listing.price` is the live one and it is meant to be
edited. A price change touches money, so it is audited with the before
and the after, like the trade URL.

**But an `Order` freezes it.** The price, the fee and the payout are
copied onto the order when it closes and are never recalculated — the
listing can move afterwards, the order cannot. That is also why a
purchase has to confirm the price the buyer was shown: if it changed
between the storefront and the checkout, refuse the purchase and show
the new one. Charging more than was on screen is indefensible, and
letting the buyer pay a stale lower price would let a seller be robbed
by a slow page.

**The trade URL belongs to the account, not to selling.** A buyer needs
one just as much as a seller: the bot delivers what they bought to that
URL, and plenty of people will only ever buy. So it is asked for once,
at account level, and every flow that ends in the bot sending an offer —
deposit, delivery, return, withdrawal — requires it. Asking for it
inside the sell flow would leave a buyer stuck at checkout with no idea
why.

### Suggesting a price

**The suggestion is `base + stickers + charm`.** No float premium: no
source reviewed on 19/08 gives a method for it, and a factor invented
here would be the screen asserting something nobody can check.

```
suggested = base
          + min( Σ (sticker × SP% × scrapeRetention × diminishing), 2 × base )
          + charm value in full
```

**A charm is added whole, with no SP%.** Charms detach and return to the
inventory intact and tradable — the only cost is a US$ 0.99 detachment
pack — so none of their value is lost to the weapon. Stickers are
destroyed on removal, which is the whole reason they transfer only a
fraction.

**SP% is far smaller than the market's reputation for it.** Measured
bands: an ordinary tournament sticker transfers 0.5–1.5%, a modern Major
holo 0.5–2%, a Crown Foil 3–8%, a Katowice 2014 holo 5–15%. The
"50%" figure only ever applied to a Katowice holo on a skin people
actually want.

**Scrape is applied per unit, from the wear we already read.** Retention
runs roughly 100% intact, 50–75% lightly scraped, 25–50% at half,
10–25% heavily, near nothing below a fifth remaining.

**Four stickers are worth 50–70% of their SP% each, not four times
one.** Diminishing returns are real and the market prices them.

**Position is deliberately not used.** It multiplies real SP% by 0.5 to
2.5, and we cannot know it: `ItemApplication.slot` is the order Steam
returns, and Valve itself swaps positions between the web inventory and
the game. This is a known error we cannot remove, and a reason the
figure is a suggestion.

**The 2× cap is the load-bearing part, not a safety rail.** Checked
against a real item — an AK-47 Blue Laminate carrying R$ 20,098 of
Katowice 2014 stickers on a R$ 152 skin — the honest SP% range of 3–8%
produces suggestions from R$ 453 to R$ 1,276 uncapped. That 3.7× spread
is useless to a seller. Capped at twice the base it becomes R$ 453 to
R$ 456, and the effective transfer lands at 1.50% — against the 1.57%
CS.MONEY was observed to pay for the same item, reached independently.

The cap also carries the economics: nobody pays a R$ 600 premium on a
R$ 152 rifle, however good the stickers are. Sell the stickers, not the
gun.

### The fast flow: buying from the user

**Instant sell is the platform taking inventory, not brokering a sale.**
We pay now, hold the item, and carry the risk of reselling it. The
discount is the price of that risk, and the 7-day trade lock makes a
week of it unavoidable on every purchase.

**The offer is anchored on the bid, never on a listing price.** A
listing is what someone is asking; the bid is what someone will actually
hand over. Discounting from the ask is how you end up paying more than
you could liquidate at. Decided 2026-08-19.

**The offer prices the base skin only — stickers, charms and pattern are
not valued.** Decided 2026-08-19, deliberately: pricing applied items
automatically is already forbidden here, because SP% runs from 2% to
over 50% and no API delivers it with confidence.

The consequence has to be stated on screen, in plain words, wherever the
offer appears. An AK worth thousands for its Katowice stickers gets an
offer for a clean AK, and someone who accepts without noticing has a
grievance worth repeating in public — in a market where trust is the
product. Said out loud, it is an informed choice and there is no
argument to have later.

**Discount by liquidity, measured by the bid-ask spread**, which is what
the vendor's cheaper plan provides:

| Spread | Discount on bid |
|---|---|
| ≤ 5% | 10% |
| ≤ 12% | 15% |
| ≤ 25% | 25% |
| > 25% | no offer |

Numbers to calibrate against real trading, not to be right first time.
Refusing is a valid answer and the expected one for illiquid items —
`buyoutEligible` exists for that.

**An item in custody does not have to be listed.** Deposit and listing
are separable in both directions: a listing can be cancelled at any
time, with or without a lock, and the owner can ask for the item back.
The return is scheduled for when the lock expires, reusing the delivery
queue with `TradeOfferReason.RETURN`. So "in a bot" never implies "for
sale".

### Steam trade lock

**Valve's 7-day trade lock binds both sides.** Whoever receives is
locked, so the bot does not deliver until 7 days after the deposit. That
is why the virtual inventory exists: a sale is a change of owner in the
database, the item does not move.

**A Steam ban is not a ban by us.** `isBanned` is our own moderation and
blocks login. `steamEconomyBan` and `steamVacBanned` are Valve's and do
**not** block login: the person is still a customer and still owns what
is in custody. **Selling through the site is never blocked by a Steam
ban** — that would turn Valve's punishment into confiscation by us.

**One row per unit in `ItemApplication`, never grouped.** Two copies of
the same sticker can have different scrapes, and one can be worth several
times the other.

### Authentication

**The session is a JWT, delivered in an httpOnly cookie.** A token in a
query string would end up in the browser history, in proxy logs and in
the `Referer` header. `httpOnly` stops an XSS from taking the session
with it.

**The guard queries the database on every request.** A JWT is not
revocable; trusting it alone would let a banned user in for days. A
primary-key lookup is cheap and worth the trade.

**Revocation in two layers in Redis:** `jti` drops one token (ordinary
logout), a per-user cutoff drops all of them (a compromised account). If
Redis goes down, the check lets requests through — the guard still blocks
banned accounts via the database, and refusing every session over a cache
outage would take the site down.

### Frontend

**Figma Make was the starting point, not a continuous source.** Decided
on 2026-08-18. `apps/frontend` was generated there once; from that point
on the code lives in this repository and changes are made here.

The reason is that a Figma Make import **replaces the whole folder**.
While it stayed the source of truth, anything written by hand would
vanish on the next import — silently, with nothing in the diff to catch
the eye. The alternative was to confine the import to `src/app/` and
`src/styles/` and keep hand-written code outside that reach, which only
pays off if screens really keep being generated over there.

**So do not re-import from Figma Make.** If a new screen ever comes from
it, treat it as a one-off paste into a branch and re-apply what the
import overwrites — the list is in STATE.md.

### Steam

**The inventory is a live read with a cache, never persisted.** The
endpoint is limited **per IP**, and the IP is our server's: without a
cache, one user hitting refresh takes everyone's inventory down for
hours. There is a global limit of 1 call every 4s and a 5-minute penalty
after a 429.

**Stale data beats an error.** An inventory from ten minutes ago is
practically identical to the current one; an error screen makes the user
refresh, which makes exactly that problem worse.

**Item classification comes from the `Type` tag, by `internal_name`.**
The localised name changes with the language and would break the
classification silently.

**Bot credentials never go into the database.** `Bot.credentialRef`
points at the vault.

**The Trade Bot only sends offers, never accepts them.** In both
directions: on a deposit it sends an offer asking for the items, on a
delivery it sends an offer offering the items. Whoever creates the offer
defines its contents — if the bot only sends, every trade was assembled
by us from what was already in the database, rather than from an object
built by someone else. A received offer is **explicitly declined** and
recorded in the audit log. No exception, not even for our own accounts:
transferring between Trade Bots is the source bot sending. Details in
`apps/bot-service/README.md`.

---

## Conventions

### Code

- **Everything in English: identifiers, comments, test descriptions,
  user-facing messages and documentation.** No exceptions and no mixing.
  The domain vocabulary is already English (`marketHashName`, `trade
  lock`, `float`, `paint seed`), and half-and-half forced a mental
  translation on every line. Decided on 2026-08-17; until then the
  convention was the opposite, and the code was migrated.
- A comment explains **why**, not what the code does.
- An error message says **what to do**, not only what failed.

### "Trade Bot", never just "Bot"

In **everything the user reads** — the Steam profile name, the group, the
site, error messages, support, documentation: **Trade Bot**. "Bot" on its
own is the vocabulary of roulette, giveaways and spam accounts; the full
term says what the account does and is the same one used in the official
group (`NextSkins.gg — Official Trade Bots`) and in the email addresses
(`tradebot<N>@nextskins.gg`).

In the **code** the model stays `Bot` — `Bot.steamId`, `bot:add`,
`bot-service`. There is no second kind of bot in the system, so the short
name is not ambiguous, and renaming would cost a migration and a refactor
with no gain for anyone. **When writing user-facing text out of those
fields, write "Trade Bot".**

### Structure

```
apps/backend/src/<domain>/
  <domain>.controller.ts     HTTP, translating exceptions into statuses
  <domain>.service.ts        business rules
  <domain>.module.ts
  dto/                       input validation
  *.spec.ts                  next to what they test
```

A pure, testable rule lives in its own file, free of the framework
(`steam-restrictions.ts`, `item-category.ts`, `trade-url.ts`,
`applied-items.ts`).

### Database

- CHECK constraints and triggers are **hand-written** in the migrations —
  Prisma does not generate them. Each block carries a comment saying so.
  **If one of those blocks disappears from a future migration, it was
  deleted by mistake.**
- UUID v7 on the primary keys: v4 is random and fragments the index.
- `Decimal(12,2)` for USD; high precision in the source currency, because
  crypto does not survive two decimal places.

### Tests and the database

The tests run against **`skin_marketplace_test`**, derived from the
development `DATABASE_URL` and created on its own on the first run. The
suite **refuses to run** against a database whose name does not end in
`_test`.

**Never disable a trigger to clean up.** Audit cleanup is
`clearAuditLog(prisma)`, which uses TRUNCATE — a row trigger does not
fire, and immutability stays on. `DISABLE TRIGGER` turns off protection
for the whole table, and a test that dies halfway leaves it off in
silence.

### Before calling anything done

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

A passing build **does not prove** the external integration works. When
touching Steam, Postgres or Redis, verify it for real.

---

## Tests and auditing: a requirement, not a recommendation

Nothing ships without an automated test and without an audit record.

**Tests** because a bug here costs real money — the system holds users'
balances and other people's items in custody.

**Auditing** because, when someone says "money went missing" or "I never
got my item", we need to know for certain whether it was our failure or
an attempted scam.

### What to audit

Every operation on **money, an item or an account** — what succeeded
**and what was refused**. A run of attempts to register someone else's
trade URL is a scam pattern that only shows up if the refusals are
recorded.

On changes, store **before and after**. Store the item's name too, not
only the assetId: the assetId changes with every trade, and six months
from now "AK-47 | Redline" is what lets someone recognise what is being
discussed.

```ts
await this.audit.record({
  actorType: AuditActorType.USER,
  actorId: user.id,
  action: AUDIT_ACTIONS.SOMETHING,
  outcome: AuditOutcome.SUCCESS, // or DENIED, or FAILED
  targetType: 'User',
  targetId: user.id,
  metadata: { from: previous, to: current },
  context, // auditContext(req)
});
```

`record` swallows errors — a failing audit must not stop someone from
signing in. For balances and item ownership, use `recordInTransaction`
inside the same transaction: there the record has to land with it,
because a money operation with no trail is worse than one that never
happened.

`AuditLog` is **immutable by a Postgres trigger** — UPDATE and DELETE are
refused by the database. Correcting a wrong record is impossible by
design: you insert a new one.

### Logging is not auditing

`AuditLog` is the proof, stored in the database and immutable: it answers
"did this happen?". The application log is the technical trail, volatile:
it answers "why did it break?". Neither replaces the other.

Every log carries the request's `requestId` automatically — do not pass
it as a parameter and do not invent another identifier. **Never log a
credential, a token or a cookie**; the masking in
`observability/structured-logger.ts` is a safety net, not permission.

### Querying

```bash
pnpm audit:user -- --id=<steamID64 or internal id> [--days=N]
pnpm audit:suspicious [-- --days=7 --minimum=3]
```

The first assembles one person's timeline — it is what you open when a
complaint arrives. The second lists whoever has accumulated refusals: an
isolated refusal is a common mistake, repetition is someone probing the
system.

They are terminal commands, not routes: an admin panel is the most
dangerous surface in the system and there is no gain while the operation
is one person.

---

## Constraints — what NOT to do

- **Do not use PowerShell to edit files containing accents.** That has
  corrupted the encoding twice in this codebase. Use the file editing
  tools.
- **Do not trust client-supplied data for identity.** The steamId always
  comes from the token or from the validated OpenID, never from the
  request body.
- **Do not store Steam credentials in the database.** Only
  `credentialRef`.
- **Do not present a stickered skin's price as anything but a
  suggestion.** It is computed — see "Suggesting a price" — but the
  seller sets the number, each sticker's own value stays on screen, and
  the figure is never called a market price.
- **Do not use Steam Market prices as a reference.** They are inflated,
  because balance there cannot be withdrawn.
- **Do not call Steam without going through the cache and the rate
  limiter.**
- **Do not make the Trade Bot accept a trade offer.** It only sends. Not
  for our own accounts, and not "just this once".
- **Do not block selling because of a Steam ban.**
- **Do not group `ItemApplication` by name with a count.**
- **Do not build an admin panel** while the operation is one person: it
  is the most dangerous surface in the system and there is no gain
  today.
- **Do not automate the creation of Steam accounts** and do not buy
  ready-made ones.
- **Do not commit to `main`** — work lives on a branch.
- **Do not push and do not open a PR** without an explicit request.

---

## Compact Instructions

On every compaction (manual or automatic), always preserve: architecture
decisions, project conventions, explicit constraints, and the contents of
STATE.md. Never summarise or genericise that information.
