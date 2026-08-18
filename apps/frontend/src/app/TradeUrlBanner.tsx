import { useState } from 'react';
import { ApiError, setTradeUrl } from '@/lib/api';

/**
 * Asks for the trade URL, at account level rather than inside a flow.
 *
 * A buyer needs one as much as a seller — the bot delivers what they
 * bought to that URL, and plenty of people will only ever buy. Asking
 * for it inside the sell page would leave a buyer stuck at checkout with
 * no idea why.
 *
 * It sits under the navigation on every page, for as long as the account
 * has no URL, because the moment it is actually needed is the worst
 * moment to discover it is missing.
 */
export function TradeUrlBanner({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      await setTradeUrl(value.trim());
      // Re-read rather than assume: the server normalises the URL, and
      // what it stored is what the rest of the screen should see.
      onSaved();
    } catch (cause) {
      // The API writes these to say what is wrong — "this belongs to a
      // different Steam account" is far more useful than "invalid".
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'We could not save it right now. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="w-full px-4 py-3 border-b"
      style={{
        background: 'rgba(240,192,64,0.06)',
        borderColor: 'rgba(240,192,64,0.25)',
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="font-display text-xs font-bold tracking-wide"
            style={{ color: '#f0c040' }}
          >
            ADD YOUR STEAM TRADE URL
          </span>
          <span className="font-mono text-[11px]" style={{ color: '#9da3c0' }}>
            It is where our Trade Bot sends items — needed both to sell and
            to receive what you buy.
          </span>
          <a
            href="https://steamcommunity.com/id/me/tradeoffers/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] underline"
            style={{ color: '#f0c040' }}
          >
            Find it on Steam
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            placeholder="https://steamcommunity.com/tradeoffer/new/?partner=…&token=…"
            spellCheck={false}
            className="flex-1 min-w-[280px] px-3 py-1.5 rounded font-mono text-xs focus:outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#e8eaf0',
            }}
          />
          <button
            onClick={() => void save()}
            disabled={saving || value.trim().length === 0}
            className="px-4 py-1.5 rounded font-display text-xs font-semibold tracking-wide transition-opacity disabled:opacity-40"
            style={{ background: '#f0c040', color: '#08090d' }}
          >
            {saving ? 'SAVING…' : 'SAVE'}
          </button>
        </div>

        {error && (
          <div className="font-mono text-[11px]" style={{ color: '#e84060' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
