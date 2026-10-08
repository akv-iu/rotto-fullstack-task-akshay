import 'server-only';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt';

export const MODEL = 'gpt-4.1-mini-2025-04-14';
const TIMEOUT_MS = 6_000; // p95 measured 1.86 s; a rare slow-but-correct answer beats a failed search (NOTES.md).

export class LlmError extends Error {}

export const llmConfigured = () => Boolean(process.env.OPENAI_API_KEY);

/** One call: brief in, filter JSON out. Nothing else is ever sent to the model. */
export async function briefToFilters(brief: string): Promise<Record<string, unknown>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new LlmError('OPENAI_API_KEY is not set');
  const safeBrief = brief.replace(/<\/?brief>/gi, '');

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `<brief>${safeBrief}</brief>` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'filters', strict: true, schema: RESPONSE_SCHEMA } },
      }),
    });
  } catch (e) {
    throw new LlmError(`OpenAI request failed (${(e as Error).name})`);
  }
  if (!res.ok) throw new LlmError(`OpenAI returned ${res.status}`);

  const body = await res.json().catch(() => null);
  // Token counts for the README's cost-per-search figure (Task 19). Counts only, never the brief.
  if (process.env.LOG_LLM_USAGE) console.info('llm usage', JSON.stringify(body?.usage));
  const message = body?.choices?.[0]?.message;
  if (!message || message.refusal || typeof message.content !== 'string') throw new LlmError('No filters returned');
  let parsed: unknown;
  try { parsed = JSON.parse(message.content); } catch { throw new LlmError('Model returned invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LlmError('Model returned the wrong shape');

  const out = Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)),
  );
  // The model answers "open" / "not_open"; the filters use a boolean (false = only people not open to work).
  if (out.open_to_work === 'open' || out.open_to_work === 'not_open') out.open_to_work = out.open_to_work === 'open';
  return out;
}
