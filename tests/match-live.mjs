// End-to-end matcher check against live OpenAlex (needs .env with OPENALEX_API_KEY).
// Run: node test/match-live.mjs
// Every parse case is a real paper, so each should come back "valid" in any citation style.
import 'dotenv/config';
import { matchReference } from '../server/match.js';
import { CASES } from './parse-cases.mjs';

const EXTRA = [
  { style: 'year mutation (2015 vs 2021)', expect: ['mismatch'], ref: 'Karniadakis, G. E., Kevrekidis, I. G., Lu, L., Perdikaris, P., Wang, S., & Yang, L. (2015). Physics-informed machine learning. Nature Reviews Physics, 3(6), 422-440. https://doi.org/10.1038/s42254-021-00314-5' },
  { style: 'title mutation on a real DOI', expect: ['mismatch'], ref: 'Vaswani, A., Shazeer, N., et al. (2017). The essence of attention mechanisms explained. NeurIPS. https://doi.org/10.48550/arxiv.1706.03762' },
  { style: 'fabricated paper', expect: ['ghost'], ref: 'Doe, J. (2021). Completely fabricated study on quantum pineapples in marine environments. Journal of Nothing, 99(3), 1-10.' },
  { style: 'plausible fake', expect: ['ghost'], ref: 'Smith, R., & Doe, P. (2018). Applications of artificial intelligence in medieval Latvian poetry. Journal of Vespertine Studies, 12(2), 44-58.' },
  { style: 'retracted (Lancet HCQ)', expect: ['retracted'], ref: 'Gautret, P., Lagier, J.-C., Parola, P., et al. (2020). Hydroxychloroquine and azithromycin as a treatment of COVID-19. International Journal of Antimicrobial Agents, 56(1), 105949. https://doi.org/10.1016/j.ijantimicag.2020.105949' },
  { style: 'wrong DOI suffix, title rescues it', expect: ['valid'], ref: 'Vaswani, A., Shazeer, N., et al. (2017). Attention is all you need. NeurIPS. https://doi.org/10.48550/arxiv.1706.99999' },
  { style: 'website', expect: ['unverifiable'], ref: 'Smith, J. (2019). The history of tea in East Africa. Retrieved from https://example.com/tea-book' },
  { style: 'arXiv link instead of DOI', expect: ['valid'], ref: 'Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. arXiv. https://arxiv.org/abs/1810.04805' },
];

// Invented for the parser tests, or missing from OpenAlex under this title (the 2014 NIPS GAN paper)
const notInIndex = new Set(['No year (authors must not become the title)', 'APA, organisation author', 'APA, full date in parentheses', 'Chicago (quoted title, curly quotes)']);
const all = [
  ...CASES.map((c) => ({ style: c.style, ref: c.ref, expect: notInIndex.has(c.style) ? ['valid', 'ghost', 'mismatch', 'unverifiable'] : ['valid'] })),
  ...EXTRA,
];

let pass = 0;
for (const c of all) {
  const r = await matchReference(c.ref);
  const ok = c.expect.includes(r.verdict);
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.verdict.padEnd(12)} ${String(r.score ?? '-').padStart(3)}  ${c.style}`);
  if (!ok) console.log(`        parsed title: ${JSON.stringify(r.parsedTitle)} | matched: ${JSON.stringify(r.matched?.title)} | ${r.note}`);
  await new Promise((res) => setTimeout(res, 150));
}
console.log(`\n${pass}/${all.length} as expected`);
process.exitCode = pass === all.length ? 0 : 1;
