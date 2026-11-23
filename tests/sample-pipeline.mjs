// Offline diagnosis of the audit pipeline on a real PDF-extracted reference list.
// Run: node test/sample-pipeline.mjs [file]   (default test/sample.txt)
import { readFileSync } from 'node:fs';
import { splitPastedReferences, splitReferences } from '../public/js/ref-split.js';
import { parseRef } from '../server/match.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || new URL('./sample.txt', import.meta.url);
const text = readFileSync(file, 'utf8');

const pasted = splitPastedReferences(text);
// pdf.js path: this journal has no hanging indent, so every line starts at the same x
const pdf = splitReferences(text.split(/\r?\n/).filter(Boolean).map((t) => ({ text: t, x: 72 })));

console.log(`pasted split: ${pasted.length} references`);
console.log(`pdf split:    ${pdf.length} references\n`);

const show = process.argv.includes('--pdf') ? pdf : pasted;
show.forEach((ref, i) => {
  const p = parseRef(ref);
  console.log(`#${String(i + 1).padStart(2, '0')} doi=${p.doi ?? '-'} year=${p.year ?? '-'} surname=${p.surname ?? '-'}`);
  console.log(`    title: ${p.title}`);
});
