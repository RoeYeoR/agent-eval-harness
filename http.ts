// #4 — how you SHOULD call a third-party API from inside an agent tool: a timeout so you
// never hang, exponential backoff + jitter on transient failures (429/5xx/network), and a
// clear transient-vs-permanent split so you don't retry a 400 forever. Idempotency lives at
// the call site (a key that makes "do it twice" == "do it once"; see book_meeting in tools.ts).
// The harness's fault injection drives every branch here, so these aren't just words.

export class TransientError extends Error {} // 429 / 5xx / timeout — safe to retry
export class PermanentError extends Error {} // 4xx (except 429) — do NOT retry

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransientError(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function withResilience<T>(
  fn: () => Promise<T>,
  opts: { label?: string; timeoutMs?: number; retries?: number; baseMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 2000, retries = 2, baseMs = 50 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs);
    } catch (err) {
      lastErr = err;
      const retriable = err instanceof TransientError; // permanent errors fall straight through
      if (!retriable || attempt === retries) throw err;
      const delay = baseMs * 2 ** attempt + Math.random() * baseMs; // exponential backoff + jitter
      await sleep(delay);
    }
  }
  throw lastErr;
}
