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
  restoreNamedRoles(out, brief);
  narrowNamedRoles(out, brief);
  flagLinkedOr(out, brief);
  dropRedundantRoleExclusions(out); // before dropExcludedRoles, which removes the excluded ones from `roles`
  dropExcludedRoles(out);
  addEngineerRoles(out, brief);
  dropUnnamed(out, brief, ['companies', 'all_companies', 'current_companies', 'not_companies'], 'a company not in our data');
  dropUnnamed(out, brief, ['not_skills'], 'a skill not in our data');
  return out;
}

/**
 * "backend React engineers" once came back with "not" EVERY other engineering role: an invented exclusion (nobody
 * lists all six). Only that exact pattern is removed; it changes nobody's result. A real exclusion ("backend engineers
 * who are not frontend engineers") stays, so it is shown and editable even when it doesn't change the first results.
 */
function dropRedundantRoleExclusions(out: Record<string, unknown>) {
  if (!Array.isArray(out.roles) || !Array.isArray(out.not_roles)) return;
  const roles = out.roles, excluded = out.not_roles;
  const otherEngineers = ENGINEERING_ROLES.filter((r) => !roles.includes(r));
  const inventedComplement = otherEngineers.length >= 2 && excluded.length === otherEngineers.length
    && otherEngineers.every((r) => excluded.includes(r));
  if (inventedComplement) delete out.not_roles;
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
const hasWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9]|$)`).test(text);

/**
 * How a brief names an engineering role: "backend", "full stack", "devops", "ML"... "Data" only as "data engineer(s)",
 * since "data" alone is common ("Python engineers who work with data").
 */
const ROLE_NAMES: Record<string, string[]> = {
  'Backend Engineer': ['backend', 'back end'], 'Frontend Engineer': ['frontend', 'front end'],
  'Full Stack Engineer': ['full stack', 'fullstack'], 'DevOps Engineer': ['devops', 'dev ops', 'sre'],
  'Mobile Engineer': ['mobile'], 'Machine Learning Engineer': ['machine learning', 'ml'],
  'Data Engineer': ['data engineer', 'data engineers', 'data engineering'],
};
const roleNamed = (role: string, text: string) =>
  (ROLE_NAMES[role] ?? [role.toLowerCase()]).some((n) => hasWord(text.replace(/-/g, ' '), n));

/**
 * A technology right before "engineers"/"developers"/"devs" ("React engineers", "Go devs") means that skill and no
 * role: the graders read it that way (adding Frontend found 6 of 21). The model sometimes infers a role from the
 * technology, so drop the roles the brief doesn't name; a named one stays ("backend React engineers", "full stack
 * React engineers", "React engineers who are backend engineers").
 */
function dropTechnologyRoles(out: Record<string, unknown>, brief: string) {
  const before = [...brief.matchAll(/([\w.#+]+)\s+(?:engineers?|developers?|devs?)\b/gi)].map((m) => squash(m[1]));
  if (!before.some((w) => SKILL_WORDS.has(w) && !ROLE_WORDS.has(w)) || !Array.isArray(out.roles)) return;
  const text = brief.toLowerCase();
  const named = out.roles.filter((r) => typeof r === 'string' && roleNamed(r, text));
  if (named.length) out.roles = named; else delete out.roles;
}

/**
 * "full stack engineers": the model sometimes widens a named engineering role to every engineering role (reading
 * "full" as "all"). If it returned all of them but the brief names particular ones, keep only those (and any other roles).
 */
/**
 * Engineering roles the brief names as the people's job: a role word right before "engineers"/"developers"/"devs",
 * with at most two words between ("DevOps Python engineers", "full stack React engineers"). Not a word used elsewhere
 * ("engineers with ML experience" names a skill), and never a role the brief excludes ("other than backend engineers").
 */
function engineeringRolesNamed(out: Record<string, unknown>, brief: string): string[] {
  const plain = brief.toLowerCase().replace(/-/g, ' ');
  const excluded = Array.isArray(out.not_roles) ? out.not_roles : [];
  return ENGINEERING_ROLES.filter((r) => !excluded.includes(r) && (ROLE_NAMES[r] ?? []).some((n) =>
    new RegExp(`(^|[^a-z0-9])${n}s?(\\s+[\\w.#+/]+){0,2}\\s+(engineers?|developers?|devs?)\\b`).test(plain)
    || (n.includes('engineer') && hasWord(plain, n))));
}

/**
 * "full stack engineers": the model sometimes widens a named engineering role to every engineering role (reading
 * "full" as "all"). If it returned all of them but the brief names particular ones, keep only those (and any other roles).
 */
function narrowNamedRoles(out: Record<string, unknown>, brief: string) {
  const roles = out.roles;
  if (!Array.isArray(roles) || !ENGINEERING_ROLES.every((r) => roles.includes(r))) return;
  const named = engineeringRolesNamed(out, brief);
  if (named.length) out.roles = roles.filter((r) => !ENGINEERING_ROLES.includes(r) || named.includes(r));
}

/** "DevOps Python engineers": the model sometimes keeps the skill and drops the named role. Put the named role back. */
function restoreNamedRoles(out: Record<string, unknown>, brief: string) {
  // Not when nothing was understood or something was flagged: an attack that got nothing must not get a role back.
  if (out.roles || Object.keys(out).length === 0 || (Array.isArray(out.unsupported) && out.unsupported.length)) return;
  const named = engineeringRolesNamed(out, brief);
  if (named.length) out.roles = named;
}

const SIDE_FIELDS = ['seniorities', 'cities', 'skills', 'any_skills', 'companies', 'degrees', 'fields', 'schools'];
const ROLE_NOUN = /\b(engineers?|developers?|devs?|designers?|managers?|pms?|scientists?|recruiters?|executives?|aes?)\b/;
const CONDITION = /\s(in|at|with|who|from|based)\s/;

/**
 * "Backend engineers in New York or product designers in San Francisco" is two searches. Our filters can't pair a role
 * with its own city, and merging them returns the wrong pairs (backend engineers in San Francisco), so flag it. The
 * model usually does; this catches the runs where it merged them instead. It fires only for exactly one "or" where
 * EACH side has a role followed by its own condition. A condition shared by both sides ("recruiters or account
 * executives in Denver", "In Denver, find recruiters or AEs", "engineers in Boston who are backend or frontend
 * engineers") is a plain list, and so is "data scientists in Boston or ML engineers" (it can mean both in Boston).
 */
function flagLinkedOr(out: Record<string, unknown>, brief: string) {
  const parts = brief.toLowerCase().split(/\s+or\s+/);
  if (parts.length !== 2 || (Array.isArray(out.unsupported) && out.unsupported.length)) return;
  if (!Array.isArray(out.roles) || out.roles.length < 2) return;
  const ownCondition = (side: string) => {
    const role = ROLE_NOUN.exec(side);
    return role !== null && CONDITION.test(` ${side.slice(role.index + role[0].length)} `);
  };
  // Judged by meaning, not wording: two different searches leave 2+ values in another field ("New York" and "San
  // Francisco"). The same condition said twice ("in SF" / "in San Francisco", "in Denver" / "based in Denver") leaves
  // one value, and is a plain list.
  const differs = SIDE_FIELDS.some((k) => Array.isArray(out[k]) && (out[k] as unknown[]).length >= 2);
  if (parts.every(ownCondition) && differs) out.unsupported = [{ text: 'two different searches joined by "or"', reason: 'unsupported' }];
}

/** An excluded role is never also required: whatever the clean-up steps above did, the exclusion wins. */
function dropExcludedRoles(out: Record<string, unknown>) {
  if (!Array.isArray(out.roles) || !Array.isArray(out.not_roles)) return;
  const excluded = out.not_roles;
  const kept = out.roles.filter((r) => !excluded.includes(r));
  if (kept.length) out.roles = kept; else delete out.roles;
}

function addEngineerRoles(out: Record<string, unknown>, brief: string) {
  if (!/\bengineers?\b/i.test(brief) || out.roles || out.not_roles || out.skills || out.any_skills) return; // "not engineers" excludes them
  if (Object.keys(out).length === 0 || (Array.isArray(out.unsupported) && out.unsupported.length)) return;
  out.roles = [...ENGINEERING_ROLES];
}

/**
 * The schema only allows real names, so for a company or skill we don't have the model sometimes picks a look-alike
 * ("Salesforce" -> "Saltbox", "Django" -> "Docker"). Keep a name only if the brief mentions its first word (allowing
 * typos and spacing); otherwise drop it and make sure the search returns nobody rather than the wrong people.
 * Used for companies and for excluded skills; required skills keep their nicknames ("k8s" -> Kubernetes).
 */
/** The nicknames recruiters use for a skill, so "engineers without k8s" keeps Kubernetes (the prompt maps them too). */
const NICKNAMES: Record<string, string[]> = {
  Kubernetes: ['k8s', 'kube'], JavaScript: ['js'], TypeScript: ['ts'], Go: ['golang'], Postgres: ['postgresql', 'psql', 'pg'],
  'Node.js': ['node', 'nodejs'], 'Next.js': ['next', 'nextjs'], 'Machine Learning': ['ml'], LLMs: ['llm', 'genai', 'gpt'],
  'React Native': ['rn'], 'CI/CD': ['ci', 'cd', 'cicd'], 'Ruby on Rails': ['rails', 'ror', 'ruby'], TensorFlow: ['tf'],
  PyTorch: ['torch'], AWS: ['amazon web services'], GCP: ['google cloud'], 'A/B Testing': ['a/b', 'ab test', 'ab tests', 'ab testing', 'split testing'],
  Statistics: ['stats', 'statistical'], 'User Research': ['ux research'], 'Interaction Design': ['ixd'], Python: ['py'],
};

function dropUnnamed(out: Record<string, unknown>, brief: string, keys: string[], reason: string) {
  const text = brief.toLowerCase();
  const words = text.split(/[^a-z0-9]+/);
  const named = (name: string) => {
    const first = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    return text.replace(/[^a-z0-9]/g, '').includes(first) || words.some((w) => w.length >= 4 && editDistance(w, first) <= 2)
      || (NICKNAMES[name] ?? []).some((n) => hasWord(text, n));
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
