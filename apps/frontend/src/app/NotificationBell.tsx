import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import {
  getNotifications,
  markNotificationsRead,
  type Notification,
} from '@/lib/api';

/**
 * The wording for each event, kept here rather than in the database.
 *
 * The backend stores what happened and the values it happened with; the
 * sentence is built at render time so it can follow the language picker.
 * An English sentence written into a row could never be translated
 * afterwards, and this site is meant to be international.
 *
 * An unknown kind is rendered as its own name rather than dropped: a
 * message the backend thought worth sending should not vanish because
 * this file is one deploy behind.
 */
function describe(n: Notification): string {
  const params = n.params ?? {};

  switch (n.kind) {
    case 'deposit.queued': {
      const count = Number(params.itemCount ?? 0);
      return `${count} item${count === 1 ? '' : 's'} queued for sale. Accept the Trade Bot's offer on Steam to finish.`;
    }
    default:
      return n.kind;
  }
}

/** "3m ago" — enough for a dropdown; the exact time is in the title. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function NotificationBell({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const feed = await getNotifications();
      setItems(feed.items);
      setUnread(feed.unread);
    } catch {
      // A bell that cannot load is not worth interrupting anyone over.
      // It stays empty and tries again on the next reason to.
    }
  }, []);

  // reloadKey changes whenever something happened that may have produced
  // a notification, which beats polling on a timer for an event the page
  // itself just caused.
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function toggle() {
    const opening = !open;
    setOpen(opening);

    if (opening && unread > 0) {
      // Cleared here rather than after the request: the badge should go
      // the moment they look, and the server call is confirming it, not
      // deciding it.
      setUnread(0);

      try {
        await markNotificationsRead();
        await load();
      } catch {
        // The list is still on screen and still readable; the badge will
        // come back on the next load if this failed.
      }
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative text-muted-foreground hover:text-foreground transition-colors block"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-mono font-bold flex items-center justify-center"
            style={{ background: '#e84060', color: '#fff' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 w-80 rounded border z-50 overflow-hidden"
            style={{ background: '#0f1117', borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <div className="px-3 py-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="font-display text-xs font-bold tracking-wide" style={{ color: '#e8eaf0' }}>
                NOTIFICATIONS
              </div>
            </div>

            {items.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px]" style={{ color: '#6c7290' }}>
                Nothing yet.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {items.map((n) => (
                  <div
                    key={n.id}
                    className="px-3 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: 'rgba(255,255,255,0.05)' }}
                  >
                    <div className="font-mono text-[11px] leading-relaxed" style={{ color: '#e8eaf0' }}>
                      {describe(n)}
                    </div>
                    <div
                      className="font-mono text-[9px] mt-1"
                      style={{ color: '#6c7290' }}
                      title={new Date(n.createdAt).toLocaleString()}
                    >
                      {ago(n.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
