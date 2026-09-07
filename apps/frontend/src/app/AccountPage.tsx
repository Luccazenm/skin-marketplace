import { useState } from 'react';
import { Check, ExternalLink, User as UserIcon } from 'lucide-react';
import {
  ApiError,
  setConsent,
  setEmail,
  setTradeUrl,
  type CurrentUser,
} from '@/lib/api';

/**
 * The account screen: who you are, and what we hold about you.
 *
 * Two halves on purpose. **Profile** is what Steam tells us and we only
 * display. **General information** is what you can change — and every
 * field there is either something the Trade Bot needs to work, or
 * something you have to be able to withdraw.
 *
 * The fields carry no explanatory line. A label and a value read faster
 * than a label, a paragraph and a value, and the two that genuinely need
 * explaining — the consent switches — keep theirs.
 */
export function AccountPage({
  user,
  onChanged,
}: {
  user: CurrentUser;
  /** Re-reads the session, so the header and the rest follow. */
  onChanged: () => void;
}) {
  return (
    <div className="max-w-3xl mx-auto py-10 flex flex-col gap-8">
      <Profile user={user} />
      <GeneralInformation user={user} onChanged={onChanged} />
    </div>
  );
}

/* ─── Profile ──────────────────────────────────────────────────────── */

function Profile({ user }: { user: CurrentUser }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHead title="Profile" />

      <div
        className="rounded-lg border p-5 flex items-center gap-5"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.07)',
        }}
      >
        <div
          className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <UserIcon className="w-8 h-8" style={{ color: '#8b92b0' }} />
          )}
        </div>

        <div className="flex flex-col gap-1.5 min-w-0">
          <div
            className="font-display text-2xl font-bold truncate"
            style={{ color: '#e8eaf0' }}
          >
            {user.username}
          </div>

          <div className="font-mono text-xs" style={{ color: '#8b92b0' }}>
            Member since {formatDate(user.createdAt)}
          </div>

          {user.profileUrl && (
            <a
              href={user.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs inline-flex items-center gap-1 mt-0.5 hover:underline w-fit"
              style={{ color: '#f0c040' }}
            >
              Open Steam profile <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── General information ──────────────────────────────────────────── */

function GeneralInformation({
  user,
  onChanged,
}: {
  user: CurrentUser;
  onChanged: () => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHead title="General information" />

      <div
        className="rounded-lg border overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.07)',
        }}
      >
        <ReadOnlyRow label="SteamID64" value={user.steamId} mono />

        <EditableRow
          label="Trade URL"
          initial={user.tradeUrl ?? ''}
          placeholder="https://steamcommunity.com/tradeoffer/new/?partner=…&token=…"
          empty="Not set — the Trade Bot cannot send you anything without it"
          save={async (value) => {
            await setTradeUrl(value.trim());
          }}
          onSaved={onChanged}
          help={{
            href: 'https://steamcommunity.com/id/me/tradeoffers/privacy',
            label: 'Find it on Steam',
          }}
        />

        <EditableRow
          label="Email"
          initial={user.email ?? ''}
          placeholder="you@example.com"
          empty="Not set"
          // Blank is a real input, not an error: it is how an address
          // already given gets withdrawn.
          allowEmpty
          save={async (value) => {
            await setEmail(value.trim());
          }}
          onSaved={onChanged}
          badge={
            user.email
              ? user.emailVerified
                ? { text: 'Verified', tone: 'good' as const }
                : {
                    text: 'Not verified — nothing is sent yet',
                    tone: 'muted' as const,
                  }
              : undefined
          }
        />

        <ConsentRow user={user} onChanged={onChanged} />

        <CookieRow />
      </div>
    </section>
  );
}

function ConsentRow({
  user,
  onChanged,
}: {
  user: CurrentUser;
  onChanged: () => void;
}) {
  return (
    <div
      className="px-5 py-4 border-t flex flex-col gap-3.5"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div
        className="font-mono text-[11px] uppercase tracking-wider"
        style={{ color: '#8b92b0' }}
      >
        Permissions
      </div>

      <Toggle
        label="Marketing email"
        hint="News, offers, and alerts when your items sell."
        checked={user.consent.marketingEmail}
        since={user.consent.marketingEmailAt}
        onChange={async (next) => {
          await setConsent({ marketingEmail: next });
        }}
        onSaved={onChanged}
        // Saying so beats letting someone switch this on and wonder for
        // a week why nothing arrives.
        note={
          !user.email
            ? 'Add an address above and nothing will be sent until it is verified.'
            : !user.emailVerified
              ? 'Nothing is sent until the address is verified.'
              : undefined
        }
      />

      <Toggle
        label="Analytics and marketing cookies"
        hint="We do not use any yet. Your answer is recorded now and honoured the day we do."
        checked={user.consent.analytics}
        since={user.consent.analyticsAt}
        onChange={async (next) => {
          await setConsent({ analytics: next });
        }}
        onSaved={onChanged}
      />
    </div>
  );
}

/**
 * A statement, not a switch.
 *
 * The session cookie is strictly necessary — without it there is no way
 * to stay signed in — so there is nothing to agree to, and a control
 * that cannot be turned off would be theatre. It is listed anyway,
 * because "which cookies does this site set" deserves an answer.
 */
function CookieRow() {
  return (
    <div
      className="px-5 py-4 border-t flex flex-col gap-2"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div
        className="font-mono text-[11px] uppercase tracking-wider"
        style={{ color: '#8b92b0' }}
      >
        Cookies we set
      </div>

      <div
        className="font-mono text-xs leading-relaxed"
        style={{ color: '#9da3c0' }}
      >
        One: the session cookie that keeps you signed in. It is readable
        only by the server, never by scripts in the page, and it holds no
        personal data — just proof that this browser signed in. Signing out
        removes it.
      </div>

      <div
        className="font-mono text-xs leading-relaxed"
        style={{ color: '#8b92b0' }}
      >
        We set no advertising or tracking cookies. If that ever changes, the
        switch above governs it — and it is already off unless you turned it
        on.
      </div>

      <div
        className="font-mono text-xs leading-relaxed"
        style={{ color: '#8b92b0' }}
      >
        We never hold your Steam session. Signing in happens on Steam's own
        page and gives us your Steam ID, nothing that could act as you.
      </div>
    </div>
  );
}

/* ─── Pieces ───────────────────────────────────────────────────────── */

function SectionHead({ title }: { title: string }) {
  return (
    <div
      className="border-b pb-2"
      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <h2 className="font-display text-xl font-bold" style={{ color: '#e8eaf0' }}>
        {title}
      </h2>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="px-5 py-4 flex items-baseline justify-between gap-4">
      <span
        className="font-mono text-[11px] uppercase tracking-wider flex-shrink-0"
        style={{ color: '#8b92b0' }}
      >
        {label}
      </span>
      <span
        className={`text-sm truncate ${mono ? 'font-mono' : ''}`}
        style={{ color: '#e8eaf0' }}
      >
        {value}
      </span>
    </div>
  );
}

function EditableRow({
  label,
  initial,
  placeholder,
  empty,
  allowEmpty = false,
  save,
  onSaved,
  help,
  badge,
}: {
  label: string;
  initial: string;
  placeholder: string;
  empty: string;
  allowEmpty?: boolean;
  save: (value: string) => Promise<void>;
  onSaved: () => void;
  help?: { href: string; label: string };
  badge?: { text: string; tone: 'good' | 'muted' };
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = value.trim() !== initial.trim();
  const canSave = changed && !saving && (allowEmpty || value.trim().length > 0);

  async function submit() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      await save(value);
      setSaved(true);
      onSaved();
    } catch (cause) {
      // The API writes its messages to say what to do, so it is worth
      // showing rather than replacing with a generic line.
      setError(
        cause instanceof ApiError ? cause.message : 'Could not save. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="px-5 py-4 border-t flex flex-col gap-2"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span
          className="font-mono text-[11px] uppercase tracking-wider"
          style={{ color: '#8b92b0' }}
        >
          {label}
        </span>
        {help && (
          <a
            href={help.href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs hover:underline"
            style={{ color: '#f0c040' }}
          >
            {help.label}
          </a>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder={placeholder}
          className="flex-1 min-w-[16rem] px-3 py-2 rounded font-mono text-sm focus:outline-none"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${error ? '#e84060' : 'rgba(255,255,255,0.08)'}`,
            color: '#e8eaf0',
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={!canSave}
          className="px-4 py-2 rounded font-display text-sm font-bold tracking-wide transition-opacity disabled:opacity-40"
          style={{ background: '#f0c040', color: '#08090d' }}
        >
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>

      {!initial && !error && (
        <div className="font-mono text-xs" style={{ color: '#8b92b0' }}>
          {empty}
        </div>
      )}

      {badge && !error && (
        <div
          className="font-mono text-xs"
          style={{ color: badge.tone === 'good' ? '#4ade80' : '#8b92b0' }}
        >
          {badge.text}
        </div>
      )}

      {error && (
        <div className="font-mono text-xs" style={{ color: '#e84060' }}>
          {error}
        </div>
      )}

      {saved && !error && (
        <div
          className="font-mono text-xs flex items-center gap-1"
          style={{ color: '#4ade80' }}
        >
          <Check className="w-3.5 h-3.5" /> Saved
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  since,
  onChange,
  onSaved,
  note,
}: {
  label: string;
  hint: string;
  checked: boolean;
  since: string | null;
  onChange: (next: boolean) => Promise<void>;
  onSaved: () => void;
  note?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);

    try {
      await onChange(!checked);
      onSaved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <button
        onClick={() => void toggle()}
        disabled={saving}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="flex-shrink-0 mt-1 rounded-full transition-colors disabled:opacity-50"
        style={{
          width: 38,
          height: 22,
          padding: 2,
          background: checked
            ? 'rgba(74,222,128,0.25)'
            : 'rgba(255,255,255,0.07)',
          border: `1px solid ${checked ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <span
          className="block rounded-full transition-transform"
          style={{
            width: 16,
            height: 16,
            background: checked ? '#4ade80' : '#8b92b0',
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
          }}
        />
      </button>

      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className="font-display text-sm font-semibold"
          style={{ color: '#e8eaf0' }}
        >
          {label}
        </span>
        <span
          className="font-mono text-xs leading-relaxed"
          style={{ color: '#9da3c0' }}
        >
          {hint}
        </span>

        {note && (
          <span className="font-mono text-xs" style={{ color: '#f0c040' }}>
            {note}
          </span>
        )}

        {/* When, not just whether. An undated "they agreed" answers
            nothing the day someone asks. */}
        {since && (
          <span className="font-mono text-xs" style={{ color: '#7d84a3' }}>
            {checked ? 'Agreed' : 'Withdrawn'} {formatDate(since)}
          </span>
        )}

        {error && (
          <span className="font-mono text-xs" style={{ color: '#e84060' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
