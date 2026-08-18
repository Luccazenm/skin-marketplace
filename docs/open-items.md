# Open items

Decisions and work still outstanding, gathered while building. Each item
is something we already know will need an answer — they are not loose
ideas.

Items specific to the trade worker live in
[apps/bot-service/README.md](../apps/bot-service/README.md).

---

## What depends on the bot accounts

Situation on 2026-08-12: the accounts are being created and the
authenticator takes 7 days to mature. This section separates what is
blocked by that from what is not.

### Blocked until there is a working bot

Nothing here can really be tested without a functioning account.

- **The whole of `bot-service`** — sending an offer, detecting
  acceptance, creating an `Item` with the float read from the inspect
  link.
- **The queue scheduled by the trade lock** — `SCHEDULED` and
  `scheduledFor` only make sense with something to execute them.
- **Retry with a limit** — `TradeOffer.attempts` exists and nothing
  respects it.
- **Re-checking the ban before delivering** — without it the retry runs
  forever against a blocked account.
- **Detecting a ban on the bot itself** — the most critical on the list:
  a banned account keeps receiving items, so the loss grows after the
  incident.
- **Reconciling `Bot.itemCount`** — comparing against the real inventory
  requires a real inventory.
- **A value ceiling per bot** — depends on prices and on bots.
- **Filling in stickers and patches on `Item`** — only read once the skin
  enters custody.

### Free to do now

- **A catalog for items that are not weapons** — blocks storing sticker
  prices.
- **A custom-URL field on `Bot`** — display only.
- **The public bots page** — the endpoint can be written; it stays empty
  until a bot is registered.
- **The storefront and listings** — `Listing` already exists in the
  model; it can be built and tested with seeded data.
- **The whole frontend** — unblocked on 2026-08-18, when the Figma
  boundary was decided. Never depended on the bots.
- **Infrastructure** — CI, a separate test database, `.gitattributes`, a
  production Steam key.

### Decisions with no code involved

| Decision | When |
|---|---|
| Price source (a paid service, a recurring cost) | close to building the storefront |
| Hosting | under evaluation |
| A financial reserve proportional to what is in custody | before there is real volume |

---

## Domain

### Item types beyond skins

The `Item` model was designed for skins: it requires `float`,
`paintSeed`, `paintIndex` and `defIndex`. Reading a real inventory showed
that this does not cover everything an account holds:

| Type | Tradable | Has a float | Note |
|---|---|---|---|
| Skin | yes | yes | what the model covers today |
| Case | yes | **no** | fungible: one case is identical to another |
| Sticker, graffiti, charm | yes | no | fungible, but with a market value |
| Medal, badge | **no** | — | can never be deposited |
| Knife/gloves | yes | yes | an ordinary skin as far as the model goes |

The model already accommodates this: `Item.category` exists and the float
fields are optional, with a CHECK requiring them only for weapons, knives
and gloves.

### Agents are NOT fungible

Each agent takes up to 3 patches, and an applied patch **does not go
back** to the inventory — it can only be destroyed. An agent with patches
is permanently distinct from a clean one, even without a float.

The same reasoning applies to a charm attached to a weapon: loose in the
inventory it is fungible, applied it stops being so.

That is, "can be told apart" has two sources, and we covered only one:

| Source | Where it applies | Modelled? |
|---|---|---|
| float + paint seed | weapon, knife, gloves | yes |
| applications | sticker and charm on a weapon, **patch on an agent** | partly |

**Resolved on 2026-08-12:** `ItemSticker` became `ItemApplication`, with
a kind (`STICKER`, `PATCH`, `CHARM`), an image and per-kind slot limits.

One row per unit, **never grouped by name with a count**: two copies of
the same sticker can have different scrapes, and one can be worth several
times the other. Grouping would destroy that irreversibly, since after
delivery the item leaves our reach and the old inspect link stops
working.

`slot` stores the order Steam returns them in, not the physical spot on
the weapon — Valve itself swaps positions between the web inventory and
the in-game one. It is there to rebuild the list and to tell apart units
with the same name.

All that is missing is the filling-in, which belongs to the worker:
`wear` does not come in the inventory, it comes from the inspect link
together with float and paint seed.

### Fungibles: decision taken on 2026-08-06

**Each unit is its own listing.** Nothing changes in the schema — it is
the behaviour that already exists.

The reason for the choice: agents have to be told apart because of
patches, and grouping by template would treat them as interchangeable.

The alternatives considered and set aside for now:

- *A grouped listing* ("Dreams & Nightmares — 50 available from $1.20"):
  requires a quantity on `Listing` and `Order`, plus allocation and
  reservation logic when someone buys 3 of 50. It is the right experience
  in the long run and what the large sites do.
- *Fast flow only*: the user sells the case to the platform, which
  resells it from its own stock. It avoids allocating a third party's
  item, but consumes cash.
- *Not accepting fungibles*: minimum scope, gives up a liquid market.

**When to revisit:** while building the storefront. With few items nobody
notices; with volume, fifty identical rows make it impossible to know the
case's market price, and the seller has to create fifty listings by hand.
The warning sign is the first complaint about it — or the first user with
a large stock of cases.

Migrating to grouped listings later undoes nothing: `Item` stays one row
per physical unit, because the bot really is holding fifty cases. What
changes is the listing layer.

### Still open

Medals and non-tradable items should be **hidden** from the deposit
screen, not shown and then refused. The endpoint already supports it
(`?depositable=true`); the screen has yet to use it.

### The market price source

`SkinTemplate.referencePrice` exists and is empty. Pending decision:
where the number comes from.

**Steam will not do**, for two independent reasons:

- *Inflated prices*: Steam Market balance cannot be withdrawn, so people
  accept paying more there. Markets where the money comes out sit
  consistently below. Using Steam as the reference would make the site
  look expensive.
- *Rate limit*: ~20 queries per minute. With ~20 thousand items, a full
  refresh would take over 16 hours.

The alternatives are paid services that aggregate several markets
(Buff163, CSFloat, Skinport, Steam) and weight by completed sales rather
than by listings: Pricempire, cs2.sh, SteamAnalyst, SteamWebAPI,
CSGOSKINS.GG.

It becomes a **recurring cost** — decide it together with the rest of the
viability numbers. Choose close to building the storefront, when the
subscription can be compared against real usage.

### Pricing a skin with stickers: do not automate it

The market calls it **SP%** — how much of a sticker's value transfers to
the weapon once applied:

| Type | Transfers |
|---|---|
| An ordinary tournament sticker | 2–5% |
| A popular holo/foil | 5–15% |
| Katowice 2014 holo | 15–50%+ |

And it varies with position, alignment, the combination with the skin,
and demand. The same sticker is worth twice or half as much depending on
where it was placed. **No API delivers this with confidence.**

There is a concrete example in the test inventory: an AK-47 Blue Laminate
with three Katowice 2014. The clean skin costs a few dollars; with those
stickers, orders of magnitude more.

What to do: show the **skin's base price** and the **list of stickers
with each one's value** separately, and let the seller set the total. The
buyer sees the same data and judges for themselves. Computing a single
number and presenting it as "the market price" would be wrong with the
appearance of precision.

### The catalog has to accommodate items that are not weapon skins

`SkinTemplate` has `weapon` and `skinName` — it was modelled for weapons.
A sticker has no weapon. To store sticker prices (needed for the item
above), the catalog has to accommodate those cases.

### A public page with the official bots

Scammers copy the bots of trading sites: same avatar, same name, same
description, and they send an offer that looks like the real one but goes
to their account. The user accepts thinking it came from the site and
loses the skins.

The defence is a public page listing the official bots, and the datum
that matters is the **steamID64** — name, avatar and description can all
be copied; the steamID cannot.

Two consequences:

- The bots must identify themselves openly (a branded name, the site's
  avatar). An anonymous bot is indistinguishable from a fake one.
- The list must come out of the database (`Bot.steamId` + `Bot.status`),
  not out of hand-written HTML, otherwise it goes stale whenever a bot
  enters or leaves rotation.

A field on `Bot` for the profile's custom URL is still missing, for
display only. It does not work as an identifier: it can be imitated with
a similar-looking name and becomes free again if the bot stops using it.
The key is still `steamId`, which is immutable — if the custom URL were
the reference, changing it on the profile would break the links.

It is also worth instructing users on the deposit screen: check the
steamID of whoever sent the offer before accepting.

### Risk concentrated in the bots' email addresses

The bot accounts' emails live on a domain of our own
(`tradebot<N>@nextskins.gg`). That keeps things organised, but it
concentrates risk: whoever compromises the email panel reaches every bot
account, and with them the whole inventory in custody.

Mitigations: automatic domain renewal, 2FA at the email provider, and
distinct passwords per account.

### Reserve and exposure limit per bot

`Bot.maxItems` limits quantity, not value. 900 skins worth $2 and 40
knives worth $800 represent very different risks if that bot is banned.

Missing: a ceiling on the value held per bot, and a policy for a
financial reserve proportional to the total under custody — if the fleet
goes down, the amount owed to users can exceed the cash on hand.

---

## Authentication

### Session revocation — resolved on 2026-08-12

`POST /api/auth/logout` invalidates the current token and `POST
/api/auth/logout-all` drops all of the user's. The entries live in Redis
with a TTL equal to the token's remaining lifetime.

If Redis goes down, the check lets requests through: the guard still
queries the database and blocks a banned account, which is the serious
case.

---

## Frontend

- **~~The Figma boundary~~ — resolved on 2026-08-18.** Make was the
  starting point, not a continuous source: the code lives in this
  repository and changes are made here. The alternative, confining the
  import to `src/app/` and `src/styles/`, was set aside because it only
  pays off if screens keep being generated over there. What an import
  would overwrite, should one ever happen, is listed in STATE.md.
- **~~An empty `guidelines/Guidelines.md`~~ — moot.** That file
  instructed the Make agent; with Make out of the loop there is nothing
  to instruct. Delete it whenever the frontend is next touched.
- **MUI vs shadcn**: both installed, MUI unused anywhere in the code.
  The reason to keep it — "Make might generate screens with it" — is
  gone, so it can now be removed once nothing imports it.
- **React as an optional peer**: `react` and `react-dom` sit in
  `peerDependencies` with `optional: true`. It works by accident of
  pnpm's auto-install.
- **`App.tsx` at 1730 lines**: the whole app in one file, with no routes.
  It will have to be broken up once routing arrives.

---

## Infrastructure

- **~~No CI~~ — resolved on 2026-08-17**: GitHub Actions runs typecheck,
  lint, tests and build on every branch, with Postgres and Redis service
  containers.
- **~~Tests use the development database~~ — resolved on 2026-08-17**:
  they run against `skin_marketplace_test`, and the suite refuses to run
  against a database whose name does not end in `_test`.
- **~~`.gitattributes` missing~~ — resolved on 2026-08-17.**
- **The Steam key is personal**: the `STEAM_API_KEY` in use is tied to a
  personal account. In production, generate one on an operations account.
