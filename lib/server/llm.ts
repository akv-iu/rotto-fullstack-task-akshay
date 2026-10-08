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
  dropUnnamedCompanies(out, brief);
  return out;
}

/**
 * The schema only allows real company names, so for a company we don't have the model sometimes picks a look-alike
 * ("Salesforce" -> "Saltbox"). Company names are distinctive, so keep one only if the brief mentions it (allowing
 * typos and spacing); otherwise drop it and make sure the search returns nobody rather than the wrong company.
 */
function dropUnnamedCompanies(out: Record<string, unknown>, brief: string) {
  const text = brief.toLowerCase();
  const words = text.split(/[^a-z0-9]+/);
  const named = (company: string) => {
    const first = company.split(' ')[0].toLowerCase();
    return text.replace(/[^a-z0-9]/g, '').includes(first) || words.some((w) => w.length >= 4 && editDistance(w, first) <= 2);
  };
  for (const key of ['companies', 'current_companies']) {
    const values = out[key];
    if (!Array.isArray(values)) continue;
    const kept = values.filter((v) => typeof v === 'string' && named(v));
    if (kept.length === values.length) continue;
    if (kept.length) out[key] = kept; else delete out[key];
    if (!Array.isArray(out.unsupported) || !out.unsupported.length) out.unsupported = [{ text: 'a company not in our data', reason: 'unsupported' }];
  }
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
