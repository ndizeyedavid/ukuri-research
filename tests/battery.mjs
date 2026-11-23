// Ukuri audit test battery + concurrency stress check.
// Run with the server up (npm start): node test/battery.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

const refs = [
  { name: 'valid · arXiv DOI', expect: 'valid', ref: 'Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. NeurIPS, 30, 5998-6008. https://doi.org/10.48550/arxiv.1706.03762' },
  { name: 'valid · Nat Rev Phys DOI', expect: 'valid', ref: 'Karniadakis, G. E., Kevrekidis, I. G., Lu, L., Perdikaris, P., Wang, S., & Yang, L. (2021). Physics-informed machine learning. Nature Reviews Physics, 3(6), 422-440. https://doi.org/10.1038/s42254-021-00314-5' },
  { name: 'valid · IPCC book DOI', expect: 'valid', ref: 'Intergovernmental Panel on Climate Change. (2023). Climate change 2022 - impacts adaptation and vulnerability. Cambridge University Press. https://doi.org/10.1017/9781009325844' },
  { name: 'mismatch · year mutation (2015 vs 2021)', expect: 'mismatch', ref: 'Karniadakis, G. E., Kevrekidis, I. G., Lu, L., Perdikaris, P., Wang, S., & Yang, L. (2015). Physics-informed machine learning. Nature Reviews Physics, 3(6), 422-440. https://doi.org/10.1038/s42254-021-00314-5' },
  { name: 'mismatch · AI title mutation', expect: 'mismatch', ref: 'Vaswani, A., Shazeer, N., et al. (2017). The essence of attention mechanisms explained. NeurIPS. https://doi.org/10.48550/arxiv.1706.03762' },
  { name: 'ghost · pure fiction', expect: 'ghost', ref: 'Doe, J. (2021). Completely fabricated study on quantum pineapples in marine environments. Journal of Nothing, 99(3), 1-10.' },
  { name: 'ghost · plausible but fake', expect: 'ghost', ref: 'Smith, R., & Doe, P. (2018). Applications of artificial intelligence in medieval Latvian poetry. Journal of Vespertine Studies, 12(2), 44-58.' },
  { name: 'retracted · PREDIMED (NEJM 2013)', expect: 'retracted', ref: 'Estruch, R., Ros, E., Salas-Salvadó, J., Covas, M.-I., Corella, D., Arós, F., ... Martínez-González, M. A. (2013). Primary prevention of cardiovascular disease with a mediterranean diet. New England Journal of Medicine, 368(14), 1279-1290. https://doi.org/10.1056/NEJMoa1200303' },
  { name: 'retracted · Lancet HCQ (2020)', expect: 'retracted', ref: 'Gautret, P., Lagier, J.-C., Parola, P., Hoang, V. T., Meddeb, L., Mailhe, M., ... Raoult, D. (2020). Hydroxychloroquine and azithromycin as a treatment of COVID-19. International Journal of Antimicrobial Agents, 56(1), 105949. https://doi.org/10.1016/j.ijantimicag.2020.105949' },
  { name: 'ghost-adjacent · wrong DOI suffix (title rescues it)', expect: 'valid', ref: 'Vaswani, A., Shazeer, N., et al. (2017). Attention is all you need. NeurIPS. https://doi.org/10.48550/arxiv.1706.99999' },
  { name: 'unverifiable · website', expect: 'unverifiable', ref: 'Smith, J. (2019). The history of tea in East Africa. Retrieved from https://example.com/tea-book' },
  { name: 'unverifiable · book with ISBN', expect: 'unverifiable', ref: 'Johnson, P. (2010). The history of tea in East Africa. London: Tea House Press. ISBN 978-0-13-235088-4' },
  { name: 'edge · malformed ref (labeled ghost, safely)', expect: 'ghost-or-unverifiable', ref: '%%% not any kind of reference %%%' },
  { name: 'edge · HTML/XSS payload (labeled ghost, safely)', expect: 'ghost-or-unverifiable', ref: '<script>alert("x")</script> (2020). Some paper about malicious inputs injected via markup.' },
  { name: 'edge · XSS as author (labeled ghost, safely)', expect: 'ghost-or-unverifiable', ref: '"><img src=x onerror=alert(1)>, A. (2020). Injected markup paper with a year to creep through the parser.' },
  { name: 'edge · real book, no DOI', expect: 'valid-or-ghost-or-unverifiable', ref: 'Cattell, R. B. (1957). Personality and motivation structure and measurement. World Book Company.' },
];

const results = [];
const t0 = Date.now();
const res = await fetch(`${BASE}/api/audit-match`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refs: refs.map((r) => r.ref) }),
});
const data = await res.json();
if (!res.ok) { console.error('HTTP', res.status, data); process.exitCode = 1; }
console.log(`Audit of ${refs.length} refs in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
refs.forEach((r, i) => {
  const got = data.results[i];
  const ok = r.expect.split('-or-').includes(got.verdict);
  results.push({ ...r, got: got.verdict, score: got.score, ok });
  console.log(`${ok ? 'PASS' : 'REVIEW'} | ${got.verdict.padEnd(12)} | score ${String(got.score ?? '-').padStart(3)} | ${r.name}`);
  if (got.note) console.log(`       note: ${got.note}`);
});

// --- Concurrency stress: 20 parallel searches ---
console.log('\n=== Stress: 20 parallel searches ===');
const t1 = Date.now();
const searches = await Promise.all(
  Array.from({ length: 20 }, (_, i) =>
    fetch(`${BASE}/api/search?q=machine%20learning%20${i % 5}&per_page=3`).then(async (r) => ({ status: r.status, ms: 0 })).catch(() => ({ status: 'ERR' }))
  ));
const okCount = searches.filter((s) => s.status === 200).length;
console.log(`${okCount}/20 succeeded in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

// --- Over-cap rejection ---
const over = await fetch(`${BASE}/api/audit-match`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refs: Array.from({ length: 101 }, (_, i) => `Author, B. (2020). Fake title ${i} about testing limits. Fake Journal.`) }),
});
console.log(`\n101-ref audit rejected with: HTTP ${over.status}`);

// --- Empty body rejection ---
const empty = await fetch(`${BASE}/api/audit-match`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
});
console.log(`Empty body rejected with: HTTP ${empty.status}`);
