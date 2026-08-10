import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, FetchTimeoutError, DEFAULT_TIMEOUT_MS } from './fetchTimeout';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

// A fetch that never settles until its signal aborts — i.e. the hung external
// source this module exists for.
const hangingFetch = () =>
  vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));

describe('fetchWithTimeout', () => {
  it('passes a normal response straight through', async () => {
    const res = new Response('ok');
    globalThis.fetch = vi.fn(async () => res) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.test/a')).resolves.toBe(res);
  });

  it('gives up on a request that hangs', async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.test/hang', {}, 20))
      .rejects.toBeInstanceOf(FetchTimeoutError);
  });

  // The timeout must not swallow the caller's own cancellation: a component
  // that unmounts aborts its request, and that is not a timeout.
  it('still honours a signal the caller supplied', async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    const outer = new AbortController();
    const p = fetchWithTimeout('https://example.test/hang', { signal: outer.signal }, 5000);
    outer.abort();
    await expect(p).rejects.not.toBeInstanceOf(FetchTimeoutError);
  });

  it('rejects immediately when the caller\'s signal is already aborted', async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.test/hang', { signal: AbortSignal.abort() }, 5000))
      .rejects.toThrow();
  });

  // A network failure is not a timeout, and callers log the two differently.
  it('passes a genuine network error through unchanged', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(fetchWithTimeout('https://example.test/down')).rejects.toBeInstanceOf(TypeError);
  });

  it('defaults to 8 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(8000);
  });
});
