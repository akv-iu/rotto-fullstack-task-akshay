// Scans what browsers can download for secret values or secret-shaped strings. A single hit fails:
// the brief scores the whole 10-point block as zero for one exposed key.
//   node scripts/check-secrets.mjs                         → the production build (.next/static + pre-rendered pages)
//   node scripts/check-secrets.mjs http://localhost:3000   → what the running `make dev` server actually sends (what graders see)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

async function fromServer(base) {
  const out = [];
  for (const path of ['/', '/sign-in', '/shortlists', '/saved']) {
    const html = await (await fetch(base + path)).text();
    out.push([path, html]);
    for (const [, src] of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
      out.push([src, await (await fetch(new URL(src, base))).text()]);
    }
  }
  return out;
}
const fromBuild = () => [
  ...walk('.next/static'),
  ...walk('.next/server/app').filter((p) => /\.(html|rsc|body)$/.test(p)),
].map((p) => [p, readFileSync(p, 'utf8')]);

const files = process.argv[2] ? await fromServer(process.argv[2]) : fromBuild();
const values = ['OPENAI_API_KEY', 'SUPABASE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']
  .map((k) => [k, process.env[k]])
  .filter(([, v]) => v && v.length >= 8);
// The service-role key is a JWT, so it is caught by value above (with-env.mjs sets SUPABASE_SECRET_KEY).
const shapes = [/sb_secret_[A-Za-z0-9_-]{8,}/, /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/, /whsec_[A-Za-z0-9_]{8,}/];

let hits = 0;
for (const [name, text] of files) {
  for (const [key, value] of values) if (text.includes(value)) { console.error(`LEAK: value of ${key} in ${name}`); hits++; }
  for (const re of shapes) if (re.test(text)) { console.error(`LEAK: ${re} in ${name}`); hits++; }
}
console.log(`Scanned ${files.length} files: ${hits} leaks.`);
process.exit(hits ? 1 : 0);
