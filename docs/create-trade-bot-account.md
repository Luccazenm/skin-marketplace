# Creating a Trade Bot account

The script for every new account. Two steps are irreversible and one
starts a 7-day clock — the order matters.

> **Always "Trade Bot", never just "Bot"**, in everything the user
> reads: profile name, group, site and support. "Bot" on its own is what
> they find on roulette sites, giveaways and spam accounts; the full term
> says what the account does — trade — and it is the same vocabulary as
> the Steam group. In the code, the model is still `Bot` (see CLAUDE.md).

## The sequence

### 1. Create the account

Its own email, one per account: `tradebot<N>@nextskins.gg`. No catch-all
— if one is compromised, the others stay isolated.

**A Steam username is not a profile name.** The sign-up field is the
**login** name: it accepts only `a-z A-Z 0-9 _`, is not public, and
**cannot be changed later**. `NextSkins.gg | Trade Bot <N>` is the
profile name, set in step 4, where dots and pipes work.

For the login, do not derive it from the brand. A Trade Bot's profile is
public by design — anyone can reach its steamID64 from our own page. A
predictable login hands over half the credential for free. Use a short
prefix, the account number, and a random suffix generated in the password
manager and **different on every account** (a repeated suffix means
discovering one reveals them all):

```
nstb1_q7fk2m
nstb2_v4dzp9
```

The number in the middle keeps the correspondence with the profile's
`Trade Bot 1` and with the database — which is what you need when
investigating a problem.

**Country: Brazil, on every account.** The reason is step 2: the payment
method has to match the account's country, and a Brazilian card on an
account set to the US is refused at exactly the step that unlocks the
account for work. Changing the country later requires a purchase with a
payment method from the new country, and carries a cooldown.

On top of that, the login will always come from Brazil. An account
declared in another country and accessed from here is gratuitous
inconsistency, and a Trade Bot is the kind of account you do not want
locked by a security check.

There is nothing to gain from picking another country: **that field is
not public.** It sets the store and the currency, nothing more. The
location shown on the profile is a different field, optional, edited
later (see step 4).

Keeping them all identical matters: once there are five accounts and one
was created differently, the difference resurfaces months later, at the
unlock payment, when nobody remembers why.

Confirm the email and check that **email Steam Guard is active**. New
accounts come with it on, but if it is off, adding the authenticator
later triggers 15 days of restriction instead of 7.

### 2. Spend US$ 5

A limited account cannot trade. Make the purchase before anything else —
better to find a problem now than after waiting a week.

**How to check whether it is still limited**, since nothing on the
profile makes it obvious and the custom URL works regardless:

```
https://steamcommunity.com/profiles/<steamID64>/?xml=1
```

`<isLimitedAccount>1</isLimitedAccount>` means limited; `0` means
unlocked. It is Steam's own endpoint — no need to hand a Trade Bot's
profile to a third-party site.

### 3. Activate the authenticator through Steam Desktop Authenticator

**Do not use the normal phone app.** The Trade Bot needs the
`shared_secret` and the `identity_secret` to confirm trades on its own,
and those values are only shown at activation. Through the regular app,
extracting them afterwards is laborious and usually means redoing the
whole process.

⚠️ **Copy both secrets before closing the window.** Redoing the
authenticator restarts the 7-day clock.

This is the step where the clock starts running.

**Download only from the official repository**
(`Jessecar96/SteamDesktopAuthenticator`, Releases tab). Forks and fake
sites circulate with modified builds that send the `maFile` to third
parties, and whoever has the `maFile` confirms the account's trades —
that is not partial access, it is emptying the inventory without needing
the password. The scam targets exactly the person setting up bots for the
first time and searching for the download on Google.

**Set the encryption passkey** when it asks ("Please enter an encryption
passkey"). Leaving it blank means a plain-text `maFile` on disk. The
passkey covers every account in that installation, so store it in its own
vault entry (`Steam Desktop Authenticator` → `encryption_passkey`), not
inside a Trade Bot's entry. There is no recovery: losing that passkey
makes the `maFiles` unreadable.

#### What the screen does not tell you

**It does not ask for a phone number.** Good for us — it means there is
no per-number account limit and the five Trade Bots do not each need a
SIM.

**The window asks for an "SMS code", but the code arrives by email.**
The SDA's text is old; Steam changed the flow and sends it by email when
the account has no phone linked. Check the `tradebot<N>@nextskins.gg`
inbox, and the spam folder. Do not keep guessing codes: repeated errors
make Steam block the attempt for a while.

This has a consequence worth understanding: **email is the Trade Bot's
recovery path.** Whoever controls the inbox can redo the account's
authenticator. Hence a strong, unique password on every inbox, and 2FA
wherever the provider offers it.

**Save the revocation code** (it starts with `R`) as soon as it appears.
It is what gives the account back if the authenticator is lost or
compromised.

### 4. Set up the profile

- Name: `NextSkins.gg | Trade Bot <N>` — identifiable on purpose. See
  [open-items.md](./open-items.md#public-page-with-the-official-bots): an
  anonymous account is indistinguishable from a fake one. That is 24
  characters on Trade Bot 1, within Steam's limit of 32, with room to
  spare up to number 10.
- Avatar: the same as the site's.
- **Public inventory.** If it is private, neither we nor the users can
  verify what is in custody.
- **Custom URL**: `nextskins-tradebot<N>`. It works even while the
  account is still limited — verified on account 1, which set it before
  spending the US$ 5. **Do not treat this as a sign that the account
  left the limited state.**
- **Location (Country/State/City): leave it blank.** This is the public
  field, unrelated to the sign-up country. Blank on all five is
  consistent; filled in on some and empty on others is the kind of
  difference an attentive user notices at exactly the moment they are
  checking whether the account is real.

None of this is verification, and it is worth being clear why: name,
avatar and custom URL can all be copied in minutes. The custom URL does
not replace the SteamID64, which is immutable and always exists at
`/profiles/<id>` — it is only a nickname pointing at the same profile, a
similar-looking name can be registered by someone else, and an abandoned
URL becomes free again. They serve as a signal of a well-kept account,
because a rushed scammer does not bother. The proof is still the
SteamID64 published on the official list.

### 5. Join the official group

Invite the account to **NextSkins.gg — Official Trade Bots**, the closed
group holding all of them. It is the second layer of verification: the
user checks on the Trade Bots page and sees the same profile listed in
the group.

An account outside the group is indistinguishable from a fake one — if it
is left out, the defence mechanism itself incriminates the legitimate
account. Check again after the invitation is accepted.

The group's text and the security reasoning are in
[steam-group.md](./steam-group.md).

### 6. Record the steamID64

It goes to the database (`Bot.steamId`) and to the public Trade Bots
page.

**`?xml=1` through the custom URL does not work right after creating
it** — it returns "The specified profile could not be found" even with
the profile live, because that endpoint takes a while to see the new URL.
Paths that work immediately:

- The `SteamID` field inside the `.maFile` itself
- The browser's address bar, before setting the custom URL:
  `steamcommunity.com/profiles/<steamID64>`
- Resolving it through the Web API:
  `ISteamUser/ResolveVanityURL/v1/?key=<key>&vanityurl=nextskins-tradebot<N>`

With the number in hand, `?xml=1` through `/profiles/<steamID64>` answers
normally — that is how you check `isLimitedAccount`.

## The vault

**Bitwarden**, with app-based 2FA enabled.

The choice was not a preference: `bot-service` will need to read the
`shared_secret` to confirm trades on its own, and Bitwarden has a CLI. A
vault without programmatic access would lead to copying a secret by hand
into an environment variable — exactly what `credentialRef` exists to
avoid. Switching vaults after five accounts are inside is laborious.

Bitwarden's own 2FA code does **not** live inside Bitwarden: if you need
the vault to open the vault, a lost phone locks everything, Trade Bots
included. The master password and the recovery code go on paper, in a
physically secure place. There is no recovery through support, by design.

## What to store in the vault

One entry per Trade Bot. `Bot.credentialRef` in the database stores only
that entry's identifier — the password and the secrets never reach
Postgres.

Use **custom fields**, not the notes block: a field has a name, copies on
its own, and accepts the **Hidden** type, which keeps the secrets masked.
That way, opening the entry to grab the steamID64 does not leave the rest
exposed on screen.

| Field | Type |
|---|---|
| Steam login and password | the item's standard fields (the login cannot be changed later) |
| `steamID64` | Text |
| `credentialRef` | Text — the key that goes to the database |
| `authenticator_enabled_at` | Text — a date, so you know when it unlocks |
| `account_country` | Text — Brazil, sets which payment methods are accepted |
| `shared_secret` | **Hidden** — only shown at activation |
| `identity_secret` | **Hidden** — only shown at activation |
| `revocation_code` | **Hidden** — gives the account back if the authenticator is lost |
| `maFile` | **Hidden** — see below |

The email and its password go in their own separate entry.

**Store the contents of the `.maFile`.** It sits on your machine and
holds the secrets; losing it without a copy forces redoing the
authenticator — and redoing it restarts the 7 days.

File attachments in Bitwarden are a paid feature. Since the `.maFile` is
JSON text, open it in a text editor and paste the whole contents into the
hidden field. What matters is the content being in the vault, not the
format.

## Permanent rules

**Never open CS2 on these accounts.** A VAC ban comes from cheat
detection in a match and locks the inventory **forever**, with no appeal.
An account that never opens the game has practically zero risk.

**One account per day.** Several new accounts from the same IP on the
same day is the pattern Valve associates with account farming.

**Do not play and do not add friends.** The less the account looks like
an improvised personal account, the better.

**No group other than the official one.** The group from step 5 is the
only one, and it is mandatory. A third-party group on a Trade Bot's
profile is noise at exactly the point where the user is trying to decide
whether the account is trustworthy.

## When the account is ready

7 days after the authenticator is activated. Before that, trades go out
with a hold of up to 15 days — which in practice means the account is no
use for operating.

The accounts' clocks run in parallel: creating three in the same period
costs one week in total, not three.
