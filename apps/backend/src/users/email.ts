/**
 * Checking an address someone typed.
 *
 * Free of the framework so it can be tested without one, like the trade
 * URL rules next to it.
 *
 * Deliberately permissive about shape. The only check that proves an
 * address real is sending to it and having someone click the link, and
 * that flow does not exist yet — so a clever pattern here would buy
 * nothing and would reject valid addresses. Real ones contain apostrophes,
 * plus signs, long new TLDs and non-ASCII. What is rejected is what
 * cannot be an address at all, plus what would cause trouble downstream.
 */

export type EmailError =
  'empty' | 'too_long' | 'no_at' | 'malformed' | 'whitespace';

export type EmailResult =
  { ok: true; email: string } | { ok: false; error: EmailError };

/**
 * 254 is the maximum length of an address in transit (RFC 5321), which
 * is what a mail server will actually accept.
 */
const MAX_LENGTH = 254;

export const EMAIL_ERROR_MESSAGE: Record<EmailError, string> = {
  empty: 'Type an email address, or leave the field blank to remove it.',
  too_long:
    'That address is longer than 254 characters, which no mail server accepts.',
  no_at: 'An email address needs an @ — check for a typo.',
  malformed: 'That does not look like an email address. Check for a typo.',
  whitespace: 'An email address cannot contain spaces.',
};

export function validateEmail(input: string): EmailResult {
  // Case is not significant in the domain, and mixed case in the local
  // part is a common source of "I already registered" confusion. Stored
  // lowercase so the unique index does the work.
  const email = input.trim().toLowerCase();

  if (email.length === 0) return { ok: false, error: 'empty' };
  if (email.length > MAX_LENGTH) return { ok: false, error: 'too_long' };
  if (/\s/.test(email)) return { ok: false, error: 'whitespace' };

  const at = email.indexOf('@');
  if (at === -1) return { ok: false, error: 'no_at' };

  // Exactly one @, something before it, and a dotted domain after.
  if (email.indexOf('@', at + 1) !== -1)
    return { ok: false, error: 'malformed' };

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length === 0 || domain.length === 0) {
    return { ok: false, error: 'malformed' };
  }

  // A domain without a dot cannot receive mail from outside its own
  // network, which rules it out for a marketing address.
  if (!domain.includes('.')) return { ok: false, error: 'malformed' };

  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return { ok: false, error: 'malformed' };
  }

  return { ok: true, email };
}
