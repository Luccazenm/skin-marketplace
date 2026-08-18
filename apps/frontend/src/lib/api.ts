/**
 * The single door to the backend.
 *
 * Every call goes through here so three things stay in one place: the
 * base URL, sending the session cookie, and turning a failed response
 * into something the screen can act on.
 *
 * **The backend is the source of truth.** The types below mirror what
 * the API actually returns; when the two disagree, the API is right and
 * this file is what changes. They are hand-mirrored today — the backend
 * publishes an OpenAPI document at /docs, so generating them is the
 * eventual fix, tracked in STATE.md.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/**
 * A failed request, carrying the status so the screen can tell apart
 * cases that need different words: 401 sends the user to log in, 403 is
 * a rule refusing them, 503 is worth retrying.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown when the backend cannot be reached at all. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`Could not reach the API: ${String(cause)}`);
    this.name = 'NetworkError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      ...init,
      // The session is an httpOnly cookie, so the browser has to be told
      // to send it: fetch omits credentials cross-origin by default, and
      // in development the frontend is on :5173 while the API is on
      // :3000.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch (cause) {
    // The API being down is not the same as the API refusing: one is
    // worth retrying, the other is not.
    throw new NetworkError(cause);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Nest puts the useful sentence in `message`, and that sentence is
 * written to tell the user what to do — so it is worth surfacing rather
 * than replacing with a generic line. Falls back to the status when the
 * body is not the shape we expect.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };

    if (typeof body.message === 'string') {
      return body.message;
    }

    // class-validator returns an array of messages, one per failed rule
    if (Array.isArray(body.message)) {
      return body.message.join('. ');
    }
  } catch {
    // Not JSON: fall through to the status
  }

  return `The request failed (${response.status}).`;
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

/** What the account can do, given its state on Steam. */
export interface UserCapabilities {
  canDeposit: boolean;
  canWithdraw: boolean;
  canSell: boolean;
  /** Why something is blocked, already written for the user to read. */
  blockedReason: string | null;
  /** Warnings that do not block, but the user needs to know. */
  warnings: string[];
}

/** GET /api/auth/me */
export interface CurrentUser {
  id: string;
  steamId: string;
  username: string;
  avatarUrl: string | null;
  /**
   * A string, not a number, and it stays a string all the way to the
   * screen. The backend stores Decimal(12,2); parsing it into a JS
   * number is where 0.1 + 0.2 stops being 0.3, and this is money.
   */
  balance: string;
  displayCurrency: string;
  capabilities: UserCapabilities;
  steamBanCheckedAt: string | null;
  tradeUrl: string | null;
  hasTradeUrl: boolean;
}

/**
 * The current session, or null when nobody is logged in.
 *
 * A 401 here is the ordinary "not logged in" answer, not a failure, so
 * it does not throw — otherwise every screen would have to wrap this
 * call in a try just to render a logged-out state.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await request<CurrentUser>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

/**
 * Sends the browser to Steam. A full navigation, not a fetch: the flow
 * is a 302 to steamcommunity.com and back, and XHR cannot follow that.
 */
export function startSteamLogin(): void {
  window.location.href = `${BASE_URL}/api/auth/steam`;
}

/** Ends this session. Other devices stay signed in. */
export async function logout(): Promise<void> {
  await request<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------

/** One applied sticker, patch or charm. */
export interface AppliedItem {
  kind: 'STICKER' | 'PATCH' | 'CHARM';
  name: string;
  imageUrl: string | null;
  slot: number;
  /**
   * Sticker scrape, 0 = untouched. Null when it could not be determined
   * — the backend refuses to guess, because a wrong scrape moves the
   * price directly.
   */
  wear: number | null;
}

/** One item in the user's Steam inventory. */
export interface InventoryItem {
  /** Changes on every trade. It is the item's address, not its identity. */
  assetId: string;
  classId: string;
  instanceId: string;
  marketHashName: string;
  iconUrl: string | null;
  category: string;
  tradable: boolean;
  marketable: boolean;
  /** Whether it can be deposited at all. */
  depositable: boolean;
  /** 'permanent' | 'unavailable' | null */
  blockReason: string | null;
  /** Weapons, knives and gloves have one; cases and stickers do not. */
  hasUniquePattern: boolean;
  applied: AppliedItem[];
  rarity: string | null;
  exterior: string | null;
  typeLabel: string | null;
  float: number | null;
  paintSeed: number | null;
  inspectLink: string | null;
}

/** GET /api/inventory */
export interface InventoryResponse {
  /** How many came back after the filter. */
  count: number;
  /** How many exist in total, filter or not. */
  total: number;
  /** How many cannot be deposited — the screen has to say so. */
  blocked: number;
  items: InventoryItem[];
  fetchedAt: string;
  /** Served from cache, without asking Steam now. */
  cached: boolean;
  /** Past its freshness window: Steam could not be reached. */
  stale: boolean;
}

export async function getInventory(
  options: { depositableOnly?: boolean } = {},
): Promise<InventoryResponse> {
  const query = options.depositableOnly ? '?depositable=true' : '';
  return request<InventoryResponse>(`/inventory${query}`);
}

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------

/** PUT /api/users/me/trade-url */
export async function setTradeUrl(tradeUrl: string): Promise<string | null> {
  const result = await request<{ tradeUrl: string | null }>(
    '/users/me/trade-url',
    { method: 'PUT', body: JSON.stringify({ tradeUrl }) },
  );

  return result.tradeUrl;
}

// ---------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------

/** POST /api/deposits */
export interface DepositCreated {
  id: string;
  status: string;
  itemCount: number;
  createdAt: string;
}

export async function requestDeposit(
  assetIds: string[],
): Promise<DepositCreated> {
  return request<DepositCreated>('/deposits', {
    method: 'POST',
    body: JSON.stringify({ assetIds }),
  });
}
