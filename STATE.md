# Current state

Updated 2026-08-18. Branch `feat/modelagem-dominio-e-infra-backend`,
nothing on `main`.

**398 tests passing across 30 suites · typecheck, lint and build clean ·
CI green on GitHub.**

The whole Steam integration is at 100% of statements:
`steam-inventory`, `steam-profile`, `steam-ban`, with `steam-openid` at
97%.

---

## Implemented

### Infrastructure

- pnpm + turbo monorepo. `pnpm dev` brings up backend and frontend
  together; `build`, `lint`, `test`, `typecheck` and the `db:*`
  shortcuts all work from the root.
- Postgres 16 and Redis 7 in docker-compose, with healthchecks. Redis has
  `appendonly` on — the queue will hold jobs scheduled days into the
  future.
- `@nestjs/config` with zod validation: an invalid env kills the boot
  with a message naming the variable.
- Prisma 7 connected through a driver adapter, with shutdown hooks.
- Swagger at `/docs`, disabled in production.
- An idempotent seed creating the platform account; it repairs a
  diverging identity without touching the balance.
- **CI on GitHub Actions** (17/08): typecheck, lint, tests and build on
  every branch, with Postgres and Redis service containers.

### Data model

Ten tables, eight migrations applied: `User`, `SkinTemplate`, `Item`,
`ItemApplication`, `Listing`, `Order`, `Transaction`, `TradeOffer`,
`TradeOfferItem`, `Bot`, `AuditLog`.

Hand-written CHECK constraints:

- `Transaction`: the amount cannot be zero; the sign is consistent with
  the type, but only for single-legged types (FEE, BUYOUT, REFUND and
  ADJUSTMENT produce two rows of opposite signs and are left out).
- `Item`: weapons, knives and gloves require all four pattern fields;
  the float sits within [0,1].
- `ItemApplication`: a scrape only on stickers and within [0,1]; the slot
  within each kind's limit (5 / 3 / 1).
- `AuditLog`: a trigger refusing UPDATE and DELETE.

### Steam login (complete)

```
GET  /api/auth/steam         redirects to Steam
GET  /api/auth/steam/return  validates, creates the user, sets the cookie, redirects
GET  /api/auth/me            profile, balance, capabilities, trade URL
POST /api/auth/logout        invalidates this token
POST /api/auth/logout-all    invalidates all of them
```

OpenID 2.0 implemented directly, without `passport-steam` — that library
has a known flaw allowing authentication as any account.

Verified with a real account: login works end to end.

### Inventory

`GET /api/inventory` — a live read with a cache; `?depositable=true`
filters while keeping `total` and `blocked` in the summary.

It classifies into 20 categories from the `Type` tag, and extracts
applied stickers, patches and charms (name, image, order). Verified
against a real inventory: 192 items, none fell into `OTHER`.

### Item data: solved without infrastructure (17/08)

The public inventory endpoint already returns, per item, in
`asset_properties`: the paint seed (`propertyid 1`), the float
(`propertyid 2`) and the self-encoded inspect link (`propertyid 6`). The
applied stickers come in `asset_accessories`, each with a `classid` and a
float of its own.

Verified against a real inventory: `StatTrak™ AK-47 | Inheritance
(Battle-Scarred)`, seed 401, float 0.6661146879196167, 5 stickers.

**Consequence:** the entire inspect infrastructure drops off the plan —
dedicated account, Game Coordinator, queue, 1 req/s limit. And float and
pattern are now available **before** the deposit, which changes what the
deposit screen and the storefront can show.

**The scrape was confirmed** against two known items: an AK-47 Blue
Laminate with 4 untouched stickers returns `0 | 0 | 0 | 0`; the AK-47
Inheritance returns `0.63 | 0.84 | 0.80 | 0.75 | 0.97`. `propertyid 4` is
the scrape, 0 = untouched.

**Implemented** in `steam-inventory` (17/08): `float`, `paintSeed` and
each application's scrape. Verified against the real inventory — 191
items, 24 with a float, 11 with an application, 10 with a scrape. The
eleventh is a charm, which does not scrape and does not appear in
`asset_accessories`.

The application's name and image come from the HTML; the scrape comes
from `asset_accessories`, which identifies each piece only by `classid` —
and that `classid` is not in `descriptions`. **Order is the only link
between the two lists**, so the pairing only happens when the counts
match. If they diverge, `wear` stays `null`: getting the scrape wrong
moves the price directly, and showing nothing beats showing something
wrong.

### Trade URL

`PUT /api/users/me/trade-url` — checks that the `partner` corresponds to
the authenticated user. Stores a normalised version.

### Deposit (partial)

`POST /api/deposits` records the intent and queues the `TradeOffer` in
`CREATED`. It validates the trade URL, Steam restrictions, ownership of
the items, whether they are depositable, whether they are already in
another trade, and picks the emptiest bot.

**Today it answers 503 on any deposit**, because no bot is registered.
That is the correct behaviour, not a bug.

### Trade Bots

`pnpm bot:check`, `pnpm bot:add` and `pnpm bot:list`.

`bot:check` is read-only: it answers "can I register this account?"
without writing anything. It shows every blocker at once, so the operator
does not fix one, run again and discover the next.

`bot:add` confirms with Steam that the account exists, that it has
neither an economy restriction nor a VAC ban, and **that it is not
limited** — a limited account is not a ban, the Web API does not report
that state, and a freshly created account would clear every other barrier
without being able to trade. The check comes from the profile XML
(`isLimitedAccount`).

Both consume the same rule (`scripts/bot-eligibility.ts`, pure and
tested): `check` informs, `add` blocks. Separate criteria would disagree,
and the disagreement would only surface with an item in custody.

A refusal is recorded in the audit log as `bot.registration_denied` with
the reason — including duplicates and an unreadable profile.

**Two Trade Bots registered**, both `OFFLINE`:

| | steamID64 | ref | unlocks |
|---|---|---|---|
| Trade Bot 1 | 76561198659520305 | `bot/01` | 2026-08-20 |
| Trade Bot 2 | 76561198654117612 | `bot/02` | 2026-08-24 |

Neither receives deposits yet: `pickBot` only considers `ONLINE`, and
nothing puts a bot into rotation until `bot-service` exists. The R$ 50 in
the wallet counted towards lifting the limitation even without being
spent — confirmed on both.

Missing on both: the avatar (still Steam's default), which is waiting on
the visual identity and should be applied to both at once.

### Auditing

Wired into login (success and three refusals), logout, logout-all, the
trade URL (success and each refusal), deposits (success and seven
refusals) and bot registration.

Querying by command: `pnpm audit:user` assembles one person's timeline
(it accepts a steamId or an internal id, and shows before/after and the
IP); `pnpm audit:suspicious` lists whoever accumulated refusals in the
period. There is also a search by assetId in `AuditQueryService`.

### Structured logging

Every request receives a `requestId` and carries it to the end, including
across `await` — it is `AsyncLocalStorage`, nobody has to pass it as a
parameter. The id goes in the response's `x-request-id` header, so a user
who complains can quote the number of the request that failed.

In production it emits one JSON line per event, with `requestId`,
`userId`, `ip`, `method` and `path` — everything from one person or one
failure can be filtered out. In development it emits readable text with
the id's first 8 characters as a prefix.

If the client sends `x-request-id`, it is reused (which allows following
the request from the proxy onwards) — but only if it matches
`/^[A-Za-z0-9._-]{8,128}$/`. Without that validation, sending a line
break would be enough to **forge log entries**, ruining the very
investigation the id supports.

Fields whose names suggest a credential (`senha`, `password`, `secret`,
`token`, `authorization`, `cookie`, `apikey`, `api_key`, `credential`)
come out as `[hidden]`, at any depth. It is a safety net: the right thing is not to
pass credentials around, but dumping a whole object into an error log is
a common accident.

`userId` only enters after the guard authenticates. Earlier logs come out
without an owner — which is correct: at that point we did not know who it
was.

---

## In progress

### Translating the codebase to English (17–18/08) — COMPLETE

A new convention, recorded in CLAUDE.md: **everything in English** —
identifiers, comments, test descriptions, user-facing messages and
documentation. Until 17/08 the convention said the opposite, so this was
a migration, not a tidy-up.

Every pass was verified with typecheck, lint and the full suite before
being committed:

| Pass | Commit | Scope |
|---|---|---|
| 1 | `83bb1fb` | `inventory` |
| 2 | `9eb9a9f` | `catalog` |
| 3 | `ac8d777` | `pricing` |
| 4 | `b50c18f` | `test-utils` + jest setup |
| 5 | `2ef37de` | `observability` |
| 6 | `ddc1ed0` | `scripts` + `audit-query` |
| 7 | `ea3fc23` | `audit` + `users` |
| 8 | `838fad1` | `deposits` |
| 9 | `9a8bc5b` | `auth` (14 files) |
| 10 | `1387811` | inventory remainder, users, deposits specs, infra, schema |
| 11 | `3406759` | documentation, CI, turbo, docs/ renamed |

#### What crossed a boundary, and how

**Audit metadata keys change on both sides at once.**
`motivo`/`erro`/`de`/`para`/`itens`/`nome` became
`reason`/`error`/`from`/`to`/`items`/`name`. The writers are in `auth`,
`deposits` and `users`; the readers are the scripts and `findByAssetId`.
Splitting them would have made `audit:user` stop rendering the "from X to
Y". The 354 old rows in the development database keep the old keys —
harmless, and there is no production.

**A refusal reason is a code, not a message.** `sem_trade_url` →
`no_trade_url` and its kin are stable strings for querying the trail.

**A renamed command:** `pnpm audit:suspeitos` → `pnpm audit:suspicious`,
with `--days` and `--minimum`.

**A renamed Redis key:** `steam:inventory:bloqueado` →
`steam:inventory:blocked`. On deploy an existing block key is orphaned;
it expires on its own within 5 minutes.

**One enum value needed a migration:** `PriceSource.INTERNO` → `INTERNAL`
(`20260818094500_rename_price_source_internal`), using `RENAME VALUE`
rather than dropping the type, so rows referencing it would survive.
There are none today; the destructive version would only be found out the
day there are.

**The seed's platform username** went from `Plataforma` to `Platform`.
The seed repairs the existing row on the next run — already done in
development.

#### What deliberately stayed in Portuguese

- **The migration files.** Their directory names are recorded in
  `_prisma_migrations` and their contents are checksummed; renaming or
  editing them would make Prisma report modified migrations.
- **The "Description — Portuguese" block in `docs/steam-group.md`.** That
  is the published copy Brazilian users read on Steam, not project
  documentation. Translating it would delete the localisation.
- **The masking list in `structured-logger.ts` keeps `senha`** alongside
  `password`: it matches field names that might arrive from anywhere,
  and dropping the Portuguese one would only narrow the net.
- **The language picker's endonyms in the frontend** (`Português`,
  `Español`, `Русский`, `中文`): a language picker has to show each
  language in its own script.

#### How the sweep was done, and what it nearly missed

Searching for accented characters is not enough — most Portuguese in
comments has none. The reliable pass is a word list (`nao`, `porque`,
`usuario`, `motivo`, `guardar`, …) run over `git ls-files`, not over a
glob by extension: **`.gitattributes`, `.gitignore` and `.env.example`
have no extension a glob catches**, and all three were fully in
Portuguese after the first eleven passes reported "done". `jest.config.js`
was missed the same way, by a glob that covered `.ts` and not `.js`.

**Outside the code:** the bot accounts are being created. The
authenticator takes 7 days to mature; the clocks run in parallel. The
script is in `docs/create-trade-bot-account.md`.

---

## Next steps

### Blocked until there is a working bot

- The whole of `bot-service`: sending an offer, detecting acceptance,
  creating an `Item` with the float read from the inspect link, filling
  in `ItemApplication.wear`
- The queue scheduled by the trade lock (`SCHEDULED` + `scheduledFor`)
- Retry with a limit — `TradeOffer.attempts` exists and nothing respects
  it
- Re-checking the ban before delivering, otherwise the retry runs forever
- Detecting a ban on the bot itself — a banned account keeps **receiving**
  items, so the loss grows after the incident
- Reconciling `Bot.itemCount`

Details in `apps/bot-service/README.md`.

### Free to do now

- **The public Trade Bots page** — only once **every** bot is registered
  (decided 17/08). Doing it sooner would mean publishing an incomplete
  list, and an account of ours that is missing from the list is
  indistinguishable from a fake one: the page would be accusing of
  forgery exactly what it exists to authenticate.
  In the meantime the anchor is the steamID64 list in the group
  description, which has to be updated with every bot created.
  Decisions already taken: HTML served by the backend, without depending
  on the frontend, using the `theme.css` palette. Needed alongside it:
  `retiredAt` and a custom URL on `Bot`.
- **Parallelise the tests** (one database per worker). 398 tests run in
  series; this is now about speed, not integrity.
- **Swap the Steam group description when the site goes live.** Today it
  opens with "the site is not live, we are not trading, any offer in our
  name is a scam". That is protection while nothing is live, and it turns
  into a dangerous lie on launch day: the user reads that we are not
  trading exactly when we start trading for real. Both texts (English and
  Portuguese) are in `docs/steam-group.md`. **Do it on launch day, not
  after.**
- Frontend — held up by the Figma boundary decision, which is **yours**,
  not a third party's.

**The storefront and listings left this list:** `Listing` exists in the
model, but there is nothing to list while no item enters custody — and
that depends on `bot-service`, which unblocks on 20/08.

### As soon as hosting is decided

- **A production `docker-compose`**, making sure the terminal commands
  (`audit:user`, `audit:suspicious`, `bot:add`, `bot:list`) have the same
  environment variables as the API. Running in a container gives that for
  free; straight on a VM, the `.env` has to be reachable by the user
  running them.
- **Test the commands in the real environment**, not only here. They run
  from `dist`, so the deploy has to run `pnpm build`.
- **A destination for the logs**, because today they die with the
  container. If there is a proxy in front (nginx, Caddy, Cloudflare),
  configure it to generate the `x-request-id` — that way correlation
  starts before the backend.
- Document the access: `docker compose exec backend pnpm audit:user --
  --id=...` over SSH, or an SSH tunnel (`ssh -L 5433:localhost:5432`) to
  query from your own computer. **Never expose the Postgres port to the
  internet.**

### An isolated test database (17/08)

The tests run against **`skin_marketplace_test`**, created and migrated
automatically by jest's `globalSetup`. The seed runs with it, because the
platform account comes from there and not from the migrations.

The address is **derived** from the development `DATABASE_URL`, swapping
the database name for `<name>_test` — there is no `.env.test`, which
would be one more file to fall out of sync. Redis is separate too
(database 1), because the global Steam rate limiter lives there and is
shared state.

**The barrier in `test-utils/test-database.ts`:** the suite refuses to
run against a database whose name does not end in `_test`. The check is
by name, not by host — production can be on localhost through an SSH
tunnel, and "it is local, so it is fine" is the reasoning that destroys
data.

**`ALTER TABLE ... DISABLE TRIGGER` is gone from all five specs.** The
cleanup became `TRUNCATE`, which does not fire a row trigger — so the
audit log's immutability stays **on the whole time**, cleanup included.
Before, a test dying inside that window left the protection off in
silence.

Verified: a full suite leaves the development `AuditLog` at 354 rows,
exactly where it was. Before, every run added about 50.

To recreate it from scratch: `DROP DATABASE skin_marketplace_test` — the
next run rebuilds it.

### The catalog (17/08)

**33,950 items imported**, with `pnpm catalog:sync` — idempotent, taking
about 220s. Verified by running it twice: the second run updates
everything and creates nothing.

| | | | |
|---|---|---|---|
| STICKER | 10,433 | GRAFFITI | 1,812 |
| PISTOL | 5,050 | MACHINEGUN | 597 |
| RIFLE | 3,922 | GLOVES | 470 |
| SMG | 3,534 | CONTAINER | 469 |
| KNIFE | 3,428 | MUSIC_KIT | 183 |
| SHOTGUN | 1,885 | PATCH | 112 |
| SNIPER_RIFLE | 1,809 | CHARM / AGENT / KEY | 78 / 63 / 25 |

Source: the public `ByMykel/CSGO-API` dataset, mirrored into our
database. 1,032 were discarded: medals and passes (never tradable) and
701 stickers with a null `market_hash_name`, which do not exist on the
market.

`SkinTemplate` now accepts an item with no weapon. `weapon`, `skinName`,
`minFloat` and `maxFloat` became optional, with two CHECK constraints in
their place: **a weapon requires `weapon`**, and **an item with a skin
requires a float range**. The first version required a skin on every
weapon and refused 40 *vanilla* knives during the real import —
legitimate, expensive items with neither a skin nor wear.

**Classification:** the name settles the specific case (the `Sticker |`
prefix, `★`, the weapon's name); the source file settles the type when
the name says nothing. That is what classified tournament capsules as
`CONTAINER` — "Katowice 2019 Legends (Holo-Foil)" announces that
nowhere, but it came from `crates.json`.

**`EQUIPMENT`** is a new category, created for the **Zeus x27** (80
items). It has a skin, an exterior and a float like any weapon, but Valve
classifies it separately (`CSGO_Type_Equipment`). It is mapped on both
sides — catalog and inventory — and counts as a category with a unique
pattern, so its float shows up. **No item was left in `OTHER`.**

**Origin: `collections` is a list, not a single field** — 31,115 of
33,950 filled in (91.6%), and **17,325 come from more than one origin**,
up to a maximum of 19.

```
★ Karambit | Doppler        {Chroma Case, Chroma 2 Case, Chroma 3 Case}
★ Sport Gloves | Pandora's  {Glove Case, Operation Hydra Case}
AK-47 | Redline (FT)        {Operation Phoenix Weapon Case,
                             The Phoenix Collection}
```

The first version stored only one, and the last processed erased the
others — by accident of iteration order, not by choice. **There is no
"primary origin"**: the Karambit is no more from Chroma 3 than from
Chroma 1. And the number of origins matters beyond display: a skin that
drops from three cases has far more supply than an exclusive one, and
supply is an input to `buyoutEligible`.

Cross-referenced by `skin_id` against `collections.json` and
`crates.json`. Knives and gloves are in `contains_rare`, not in
`contains` — without reading that field, 3,898 of them would be left with
no origin. A **GIN** index, because a plain index is no use for "contains
this value" on a list column; the storefront query (`'Chroma 2 Case' =
ANY(collections)`) returns 373 items.

The remaining blanks are mostly correct: a case does not belong to a
collection, and graffiti drops from no collection at all.

**Descriptions: 33,742 items** (99.4%), with `flavorText` separated out
on 17,951 — the italic line Valve puts at the end ("Never be afraid to
push it to the limit"). Stored **without HTML**: handing a third party's
markup to the screen would force the frontend to sanitise it, and an item
page is where someone decides to sell something expensive.

**`hasStickerSlots` was removed.** It was derivable from the category and
was never filled in — it read `false` on all 33,950, weapons included. It
became `acceptsSticker(category)` in `item-category.ts`, alongside
`hasUniquePattern`: a pure function does not drift, a duplicated column
does.

Not to be confused with knives and gloves, which **have a pattern but no
slots** — that is what stops one function being derived from the other.
The Zeus x27 accepts stickers, despite being its own Valve family.

**`src/catalog` at 98.7% coverage.** `CatalogSyncService` was at zero: it
is the part that talks to the network and the database, and the one that
can damage data already stored — the `upsert` runs over 33,950 rows on
every pass.

The test that matters most is the one guaranteeing the sync **does not
touch** `referencePrice`, `buyoutEligible`, `buyoutDiscountPct` or
`salesVolume30d`: those are our decisions, and overwriting them would
take a skin out of the fast flow — or let one in — with nobody noticing.

The fixtures use the `TESTE-SYNC` prefix, **including the case names**:
the `crates` file feeds the origin cross-reference and also becomes
`CONTAINER` templates, so a test case without the prefix escapes the
cleanup and stays in the real catalog. That happened in the test's first
version.

### Pricing: the vendor-neutral layer is ready (17/08)

`PriceSnapshot` (append-only) + `PricingModule`, with no vendor coupled
in. Migration `20260817171329_price_snapshot`.

- **`price-provider.ts`** — the contract any vendor fills in. No screen
  or rule knows about cs2.sh or SteamWebAPI: they know `RawQuote`. An
  item with no quote is omitted, never returned with a zero price.
- **`price-reconciliation.ts`** — a pure rule, 19 tests. It does not
  average across markets; it prefers BUFF163 and leaves Steam last; it
  discards stale quotes; **it refuses when the sources diverge by more
  than 40%.** In every doubtful case, show no price rather than a wrong
  one.
- **`price-history.service.ts`** — stores the batch and reads the current
  price from **our own database**, never from the vendor. Repetition is
  ignored, so the job can be re-run after an outage.

`quotedAt` (when the source determined it) is separate from `capturedAt`
(when we stored it): a vendor serving data from ten minutes ago has to be
distinguishable from one serving it live.

**Missing:** the adapter for the chosen vendor, and the job that runs the
capture. Neither depends on a new decision — only on knowing which
vendor.

### The price source — survey of 2026-08-17

| | cs2.sh | SteamWebAPI | CSGOSKINS.GG | SteamApis |
|---|---|---|---|---|
| Markets | 6, incl. BUFF | 13, incl. BUFF | 37 | 6, incl. BUFF |
| Refresh | ~5 min, stated | not stated | 5 min + timestamp | not stated |
| Price | bid/ask | current, median, lowest sale, highest buy | listings only | current |
| History | OHLC across 4 intervals; Steam 13 years | 365 days | 90–365 days | 15–30 days |
| Liquidity | its own endpoint | no | no | no |
| Cost | US$ 75 (current only) / US$ 200 (everything) | € 25–50 | € 179–279 | ~€ 110 |
| Commercial use | **not published** | **allowed, explicit** | not published | not published |

**Recommended:** cs2.sh Developer (US$ 75) as the price reference —
BUFF163 is the market's anchor, separate bid/ask reveal the spread, and
the liquidity endpoint feeds `buyoutEligible` directly. Optionally
SteamWebAPI Starter (€ 25) alongside it, for prices in Western markets.

**CSGOSKINS.GG is out**: it tracks listing prices, not sale prices — the
same defect as the Steam Market, and the most expensive on the list.

**cs2.sh replied on 2026-08-17** (Alex, `hello@cs2.sh`):

1. **Displaying the data on a commercial marketplace is allowed.** The
   only restriction is reselling or redistributing the API and the data —
   caching and displaying are explicitly accepted ("often necessary for
   our users' applications or websites"). Terms at
   `cs2.sh/terms#fair-use-and-rate-limits`.
2. **`/v1/liquidity/items` is exclusive to the Scale plan** (US$ 200).
3. **Attribution is not required**, only appreciated.

**Decision: start on Developer (US$ 75).** The liquidity signal
`buyoutEligible` needs does not have to arrive ready-made: the **spread
between bid and ask** already indicates liquidity and comes with
Developer, and our own series gives price stability in about 3 months.
That is US$ 1,500/year of difference before there is any revenue, and
moving up a plan later is trivial.

**Still open:** whether Developer includes volume alongside the price.
That is what decides whether Scale pays for itself. Settle it with the
**free 2-day key** (requested on Discord) before subscribing.

SteamWebAPI's reply is still pending. See
[docs/emails-and-vendors.md](docs/emails-and-vendors.md).

**The rule when combining sources:** BUFF governs the reference price;
Western markets appear alongside it, never in an average. An average
across markets of different liquidity produces a number that exists
nowhere. If two sources diverge beyond a threshold, **show no recommended
price** rather than a wrong one — the same criterion as the sticker
scrape.

### Your decisions, no code involved

| Decision | When |
|---|---|
| The price source — see above, awaiting vendor replies | close to the storefront |
| Hosting | under evaluation — requirements in `docs/` |
| The boundary with Figma Make | when the first screen uses the API |
| A financial reserve proportional to what is in custody | before there is real volume |

---

## Known open items

- **`suspiciousActivity` scans the whole table**, so old refusals count.
  That affects `pnpm audit:suspicious` **in production**: without a short
  `--days`, old attempts inflate the count.
- **The tests still run in series** (`maxWorkers: 1`). The isolated
  database removed the risk of damaging real data, but the workers share
  the same test database among themselves — parallelising requires one
  database per worker.
- **Structured logs still go nowhere.** They come out on stdout and stay
  on the machine. With no collection, a `docker compose restart` erases
  the investigation. Decide the destination (a rotated file, Loki, a
  managed service) together with hosting.
- **`Bot.itemCount` is denormalised** and will drift.
- **`STEAM_API_KEY` belongs to a personal account.** In production,
  generate one on an operations account.
- **Frontend:** React declared as an optional peer, MUI installed and
  unused, `App.tsx` at 1730 lines with no routes, an empty
  `Guidelines.md`.

No known open bug.

---

## Technical decisions not described in CLAUDE.md

- **Fungible items: each unit is its own listing.** A decision to defer,
  not to ignore. The reason: agents have to be told apart because of
  patches. Revisit while building the storefront, when fifty identical
  rows make it impossible to discover a case's market price. Migrating
  later undoes nothing — `Item` stays one row per physical unit; only the
  listing layer changes.
- **Cancelling a listing is always allowed**, with the return scheduled
  for when the trade lock expires. It reuses the delivery queue, changing
  only the `reason`.
- **A stuck item does not expire.** The answer to a full slot is adding a
  bot, not returning the item of someone waiting for the price to rise.
- **A failed delivery is covered by the platform** with a full refund in
  internal balance, never to the original method.
- **The fast-flow whitelist = liquidity + a price ceiling**, computed by
  a job, not curated by hand. The fields already exist on
  `SkinTemplate`.
- **A locked item appears in the storefront with a countdown**, not
  hidden.
- **Jest runs in series** (`maxWorkers: 1`): there is real shared state
  (the database and the global Steam limiter in Redis), and parallelism
  produces order-dependent failures.
- **`app-setup.ts` centralises the app's configuration**, used by the
  bootstrap and by the tests. Without it the tests would run with no
  route prefix, no ValidationPipe and no cookie-parser — green on an app
  that does not exist in production.
- **After `pnpm add` in the backend, run `npx prisma generate`.**
  Prisma's preinstall deletes the generated client.
