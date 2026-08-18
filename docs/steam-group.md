# The Trade Bots' Steam group

A closed group gathering every Trade Bot account. It exists so the user
can confirm an account really is ours before sending an item.

Always **Trade Bot** in user-facing text, never just "bot" — see
CLAUDE.md. The URL `nextskins.gg/bots` is short on purpose: it is an
address to type, not an account name.

> The description block below is the group's published copy. **English
> only**, decided on 2026-08-18: the project's convention is English
> everywhere, and Steam shows a single description to everyone rather
> than one per viewer's language.
>
> The consequence to keep in mind: the anti-fraud warning is what a
> suspicious user reads at the exact moment they are deciding whether to
> trust an account, and the Brazilian reader now reads it in a second
> language. If that turns out to matter, the Portuguese version is in the
> git history (`docs/steam-group.md`, before 2026-08-18) and can go back
> as a second block.

## Why a closed group is not enough on its own

Closed keeps the scammer out of **our** group. They do not need that:
they create a group with the same name and the same avatar, put the fake
accounts in it, and the victim opens the fake profile, sees "NextSkins
Official" listed and trusts it. Group membership is real Steam data and
cannot be forged — but the **group** can.

The defence is the direction of the check: **the user goes from the site
to the group, never from the group to the site.** That is why what has to
be published at `nextskins.gg/bots` is the group's exact URL, and why the
description has to say so right at the top. A cloned group will have a
different URL, and that is the part that cannot be faked.

## Name

```
NextSkins.gg — Official Trade Bots
```

---

# The version in use: site under construction

Swap it for the launch version **on the same day the site goes live**.
See the next section.

**Update the steamID64 list every time a Trade Bot is created.** While
`nextskins.gg/bots` does not exist, that list in the description is the
only verification anchor — the link to the page is there for after
launch, and today it does not answer. An account that was created and
not listed is indistinguishable from a fake one.

## Short summary

```
⚠ Site under construction — we are NOT trading yet. Any NextSkins trade offer or login page right now is a scam. This group is the public record of our official Trade Bot accounts ahead of launch.
```

## Description

```
Official Trade Bot group of NextSkins.gg

[h1]⚠ THE SITE IS NOT LIVE YET[/h1]
NextSkins.gg is still being built. We are [b]not[/b] trading, not running giveaways, and not accepting deposits.

[b]Until launch, any of the following is a scam — no exceptions:[/b]
[list]
[*] A trade offer claiming to come from NextSkins
[*] A website claiming to be NextSkins and asking you to log in
[*] Anyone offering early access, beta slots, or bonuses
[*] Anyone saying they work here
[/list]
Do not send items to anyone. There is nothing to deposit into yet.

This group exists now so the Trade Bot accounts are on public record before launch. Anything that shows up in the meantime came from someone else.

[b]Our Trade Bot accounts, by steamID64 — the only identifier that cannot be faked:[/b]
[list]
[*] 76561198659520305 — NextSkins.gg | Trade Bot 1
[*] 76561198654117612 — NextSkins.gg | Trade Bot 2
[/list]
Open a profile at steamcommunity.com/profiles/<steamID64>. A display name, an avatar and a custom URL can all be copied in minutes; the steamID64 cannot.

[hr][/hr]

[b]After launch: how to verify a Trade Bot[/b]
Always start at [url=https://nextskins.gg/bots]nextskins.gg/bots[/url] and follow the link to this group. Never the other way around.
Anyone can create a group with our name and avatar. They cannot create one with our URL. If you arrived here from a link someone sent you in chat, close it and type nextskins.gg yourself.

A Trade Bot is legitimate only if [b]all[/b] of these are true:
[list]
[*] Its steamID64 appears on nextskins.gg/bots
[*] It is a member of this exact group
[*] The trade offer arrived after [b]you[/b] started a trade on the site
[/list]

[b]What our Trade Bots never do[/b]
[list]
[*] They never send friend requests
[*] They never message you first — not on Steam, not anywhere
[*] They never ask for your password, Steam Guard code, or API key
[*] They never ask you to "hold", "verify", or "test" an item
[*] They never contact you about a trade you did not start
[*] [b]They never accept a trade offer you send them.[/b] We always send the offer; you accept it. An offer you send to one of our Trade Bots will be declined — always, with no exceptions. So "the bot accepted my offer" is never true.
[/list]

[b]Before you confirm any trade[/b]
Check the item names and the sender's profile against what the site is showing you. If anything differs, cancel and open a ticket. A real trade will still be there afterwards.

[b]Staff will never DM you.[/b] Support happens only through the site. Someone claiming to be support in your Steam chat is a scammer, no exceptions.

Trades are held for 7 days by Valve's trade lock. That wait is normal and applies to everyone. Nobody can bypass it, and anyone offering to is stealing from you.
```

---

# The launch version

**Apply it the day the site goes live.** Leaving the under-construction
version up after launch is worse than having no warning at all: the user
reads "we are not trading" at the exact moment we start trading, and
either abandons a legitimate trade or learns to ignore the group's
warnings.

The swap is just removing the `⚠ THE SITE IS NOT LIVE YET` block (up to
the `[hr]`) and dropping "After launch:" from the heading that follows.
The rest of the text is already written for after launch.

## Short summary

```
Official Trade Bot group of NextSkins.gg. Verify every Trade Bot at nextskins.gg/bots before trading. Our Trade Bots never add you, never message you first, and never ask for your password or Steam Guard code.
```

## Prerequisite

The `nextskins.gg/bots` page **has to be live first**, because the
description tells people to check there. A broken link there is the worst
possible case: it breaks at exactly the moment the suspicious user went
to verify.

---

## Related open items

- Store the group's URL in the database, alongside the custom-URL field
  already planned on `Bot`. Without that, the group link is written by
  hand on the page and in this document, and the two will drift apart.
- Publish the group's steamID64 as well, not only the URL: a group URL
  can be changed by its owner, the id cannot.
