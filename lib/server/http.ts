import 'server-only';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

type Handler<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>;

/** Every route goes through this: known errors become { error }, anything else a generic 500 (never a stack or SQL). */
export function route<P = Record<string, string>>(fn: Handler<P>): Handler<P> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'The request body must be a JSON object.');
  const problem = unstorable(body);
  if (problem) throw new HttpError(400, `The request ${problem}.`);
  return body as Record<string, unknown>;
}

/**
 * Postgres refuses a NUL character or half an emoji (a lone surrogate), so they would surface as a 500; absurd
 * nesting would overflow later code. Walks with its own stack, so deep input can't overflow this check either.
 */
export function unstorable(value: unknown, maxDepth = 20): string | null {
  const stack: [unknown, number][] = [[value, 0]];
  const badText = (s: string) => s.includes('\0') || !s.isWellFormed();
  while (stack.length) {
    const [v, depth] = stack.pop()!;
    if (depth > maxDepth) return 'is nested too deeply';
    if (typeof v === 'string' && badText(v)) return 'contains characters that cannot be stored';
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (badText(k)) return 'contains characters that cannot be stored';
        stack.push([x, depth + 1]);
      }
    }
  }
  return null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, what: string) {
  if (!UUID.test(value)) throw new HttpError(400, `That ${what} ID is not valid.`);
}

/** Unwraps a Supabase result; database errors become a generic 500 via route(). */
export function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
