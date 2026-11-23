// Audit a real PDF-extracted reference list end to end against live OpenAlex.
// Run: node test/sample-live.mjs [file]   (default test/sample.txt, needs .env)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { splitPastedReferences } from '../public/js/ref-split.js';
import { matchReference } from '../server/match.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || new URL('./sample.txt', import.meta.url);
const refs = splitPastedReferences(readFileSync(file, 'utf8'));
const counts = {};
console.log(`${refs.length} references\n`);

for (let i = 0; i < refs.length; i++) {
  const r = await matchReference(refs[i]);
  counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  console.log(`#${String(i + 1).padStart(2, '0')} ${r.verdict.padEnd(12)} ${String(r.score ?? '-').padStart(3)}  ${String(r.parsedTitle).slice(0, 70)}`);
  if (r.verdict !== 'valid') console.log(`      ${r.note}${r.matched ? ` | match: ${String(r.matched.title).slice(0, 70)}` : ''}`);
  await new Promise((res) => setTimeout(res, 120));
}
console.log('\n' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('  '));
