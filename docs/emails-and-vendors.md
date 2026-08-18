# Operations email and dealing with vendors

## Addresses

All in English: the project's public communication is in English (the
Steam group, the Trade Bot names) and the vendors are international. A
Portuguese address in the middle of that would stand out.

| Address | What for |
|---|---|
| `contact@nextskins.gg` | vendors, licensing, account matters, press |
| `support@nextskins.gg` | users |
| `tradebot<N>@nextskins.gg` | one per Trade Bot |
| `noreply@nextskins.gg` | transactional email, once it exists |

`contato@` exists as an **alias** of `contact@`, for the Brazilian user
who writes in Portuguese by instinct.

### Why they are separate

**A vendor does not write to `support@`.** That inbox is going to be the
user-complaint queue. A licensing reply in the middle of "I did not
receive my item" is how you lose the only proof that we may display a
particular dataset.

**`noreply@` is reserved from now, even unused.** When the site sends a
sale confirmation, those messages must not go out from the same address
that receives replies from people.

**One email per Trade Bot, no catch-all.** If one is compromised, the
others stay isolated. See
[create-trade-bot-account.md](./create-trade-bot-account.md).

## Talking to a data vendor

**Always from `contact@`, never from a personal address.** Permission for
commercial use is tied to whoever asked: asking from a personal address
and then operating as NextSkins leaves the authorisation pointing at a
different entity. If there is ever a dispute, that is what makes the
answer count.

**Keep the reply outside of email.** Save it as a PDF alongside the
operations documentation. It is the proof that we may display that data —
for the same reason auditing exists: on the day you need it, it cannot
depend on an inbox still existing.

### What to ask before signing up

Two things no price vendor publishes, and each one is blocking:

1. **May we display the data to end users on a marketplace?** From their
   point of view we are both a customer and a competitor to other
   customers. If the answer is no, the integration dies after being
   built.
2. **How often is each market updated, and is there a timestamp per
   price?** A stale recommended price on screen is the kind of mistake
   that turns into a justified complaint.

### Replies received

**cs2.sh — 2026-08-17, Alex (`hello@cs2.sh`).** Displaying the data on a
commercial marketplace is allowed; the only restriction is **reselling or
redistributing** the API and the data. Caching and displaying are
explicitly accepted. Attribution is not required, only appreciated.
`/v1/liquidity/items` is exclusive to the Scale plan.

> "Commercial usage and displaying the APIs data is fine, and often
> necessary for our users' applications or websites. We just don't want
> you to resell or redistribute it."

**Save this reply as a PDF.** It is the authorisation that supports
showing a third party's prices in our storefront.

**SteamWebAPI** — awaiting a reply.
