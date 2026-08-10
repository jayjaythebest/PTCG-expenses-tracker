// Every price/image source this app reads is someone else's server — Huca,
// kapaipai, SNKRDUNK, TCGdex, the Pokémon site, the AI providers. A bare
// `fetch` to any of them waits forever if the connection hangs, and inside a
// Vercel function "forever" means the whole 60s budget is spent on one dead
// socket: the daily cron gets killed mid-batch and that day's price history is
// simply missing. In the browser it means a spinner that never stops.
//
// So nothing in this project should call `fetch` on an external host directly.
// Use this wrapper, which aborts and rejects once the deadline passes.
//
// Lives in src/lib rather than api/_lib because both sides need it, and the api
// side already imports from src (see api/snapshot-collection.ts). Server code
// imports it as `../src/lib/fetchTimeout.js`.

// 8 seconds. These are scraping/catalog reads where a slow answer is worth
// little — better to fall through to the next source than to wait.
export const DEFAULT_TIMEOUT_MS = 8000;

export class FetchTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Request to ${url} timed out after ${ms}ms`);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * `fetch` that gives up after `ms`.
 *
 * A caller-supplied `init.signal` still works: aborting it aborts the request
 * just as it would without this wrapper, which matters because callers use
 * their own signals to cancel work a user has navigated away from.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // Already cancelled before we started: don't open a socket at all.
  const outer = init.signal;
  if (outer?.aborted) throw outer.reason ?? new DOMException('Aborted', 'AbortError');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  // Honour the caller's signal too — whichever fires first wins.
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Distinguish "we ran out of patience" from "the caller cancelled" and from
    // a genuine network error, so logs say which one happened.
    if (controller.signal.aborted && !outer?.aborted) {
      throw new FetchTimeoutError(url, ms);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
