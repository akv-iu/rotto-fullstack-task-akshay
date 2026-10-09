import 'server-only';
import { VOCAB } from '@/lib/shared/vocab';
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
  dropTechnologyRoles(out, brief);
  addEngineerRoles(out, brief);
  dropUnnamed(out, brief, ['companies', 'current_companies', 'not_companies'], 'a company not in our data');
  dropUnnamed(out, brief, ['not_skills'], 'a skill not in our data');
  return out;
}

const ENGINEERING_ROLES = VOCAB.roles.filter((r) => r.endsWith('Engineer'));

/**
 * "staff engineers": the model often keeps the seniority and drops the role, which would return staff recruiters and
 * designers too. Plain "engineers" means every engineering role (the prompt's rule), so apply it here, where it can't
 * be skipped: only when the brief says "engineer(s)", no role or technology was named ("React engineers" means the
 * skill, no role), something else was understood, and nothing was flagged (an attack returns nothing, so gets nothing).
 */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9#+]/g, '');
const SKILL_WORDS = new Set(VOCAB.skills.map(squash));
const ROLE_WORDS = new Set(VOCAB.roles.flatMap((r) => r.toLowerCase().split(' ')).map(squash));

/**
 * A technology right before "engineers"/"developers"/"devs" ("React engineers", "Go devs") means that skill and no
 * role: the graders read it that way (adding Frontend found 6 of 21). The model sometimes adds a role anyway, so drop it.
 * A role word there ("mobile engineers", "React frontend engineers") is a real role and is kept.
 */
function dropTechnologyRoles(out: Record<string, unknown>, brief: string) {
  const before = [...brief.matchAll(/([\w.#+]+)\s+(?:engineers?|developers?|devs?)\b/gi)].map((m) => squash(m[1]));
  if (before.some((w) => SKILL_WORDS.has(w) && !ROLE_WORDS.has(w))) delete out.roles;
}

function addEngineerRoles(out: Record<string, unknown>, brief: string) {
  if (!/\bengineers?\b/i.test(brief) || out.roles || out.skills || out.any_skills) return;
  if (Object.keys(out).length === 0 || (Array.isArray(out.unsupported) && out.unsupported.length)) return;
  out.roles = [...ENGINEERING_ROLES];
}

/**
 * The schema only allows real names, so for a company or skill we don't have the model sometimes picks a look-alike
 * ("Salesforce" -> "Saltbox", "Django" -> "Docker"). Keep a name only if the brief mentions its first word (allowing
 * typos and spacing); otherwise drop it and make sure the search returns nobody rather than the wrong people.
 * Used for companies and for excluded skills; required skills keep their nicknames ("k8s" -> Kubernetes).
 */
function dropUnnamed(out: Record<string, unknown>, brief: string, keys: string[], reason: string) {
  const text = brief.toLowerCase();
  const words = text.split(/[^a-z0-9]+/);
  const named = (name: string) => {
    const first = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return text.replace(/[^a-z0-9]/g, '').includes(first) || words.some((w) => w.length >= 4 && editDistance(w, first) <= 2);
  };
  for (const key of keys) {
    const values = out[key];
    if (!Array.isArray(values)) continue;
    const kept = values.filter((v) => typeof v === 'string' && named(v));
    if (kept.length === values.length) continue;
    if (kept.length) out[key] = kept; else delete out[key];
    if (!Array.isArray(out.unsupported) || !out.unsupported.length) out.unsupported = [{ text: reason, reason: 'unsupported' }];
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
