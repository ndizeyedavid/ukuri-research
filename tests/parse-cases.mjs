// Parser regression cases for server/match.js parseRef (no network).
// Run: node test/parse-cases.mjs
import { parseRef } from '../server/match.js';

export const CASES = [
  {
    style: 'APA 7',
    ref: 'Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998-6008.',
    title: 'Attention is all you need', year: 2017, surname: 'Vaswani',
  },
  {
    style: 'APA, title ends with ?',
    ref: 'Bender, E. M., Gebru, T., McMillan-Major, A., & Shmitchell, S. (2021). On the dangers of stochastic parrots: Can language models be too big? Proceedings of the 2021 ACM Conference on Fairness, Accountability, and Transparency, 610-623. https://doi.org/10.1145/3442188.3445922',
    title: 'On the dangers of stochastic parrots: Can language models be too big?', year: 2021, surname: 'Bender',
  },
  {
    style: 'APA, full date in parentheses',
    ref: 'Smith, J. (2020, March 5). Machine learning approaches to climate model downscaling. Nature Climate Change, 10(3), 200-210.',
    title: 'Machine learning approaches to climate model downscaling', year: 2020, surname: 'Smith',
  },
  {
    style: 'APA, abbreviation inside title',
    ref: 'Chetty, R., Hendren, N., & Katz, L. F. (2016). The effects of exposure to better neighborhoods on children: New evidence from the moving to opportunity experiment. American Economic Review, 106(4), 855-902.',
    title: 'The effects of exposure to better neighborhoods on children: New evidence from the moving to opportunity experiment', year: 2016, surname: 'Chetty',
  },
  {
    style: 'APA, U.S. in title',
    ref: 'Case, A., & Deaton, A. (2015). Rising morbidity and mortality in midlife among white non-Hispanic Americans in the U.S. in the 21st century. Proceedings of the National Academy of Sciences, 112(49), 15078-15083.',
    title: 'Rising morbidity and mortality in midlife among white non-Hispanic Americans in the U.S. in the 21st century', year: 2015, surname: 'Case',
  },
  {
    style: 'IEEE (quoted title, year at end)',
    ref: '[3] A. Vaswani, N. Shazeer, N. Parmar et al., "Attention is all you need," in Advances in Neural Information Processing Systems, vol. 30, 2017, pp. 5998-6008.',
    title: 'Attention is all you need', year: 2017, surname: 'Vaswani',
  },
  {
    style: 'Vancouver (no parentheses)',
    ref: 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-44.',
    title: 'Deep learning', year: 2015, surname: 'LeCun',
  },
  {
    style: 'Harvard (bare year)',
    ref: 'He, K., Zhang, X., Ren, S. and Sun, J. 2016. Deep residual learning for image recognition. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, pp. 770-778.',
    title: 'Deep residual learning for image recognition', year: 2016, surname: 'He',
  },
  {
    style: 'MLA (quoted title)',
    ref: 'Hochreiter, Sepp, and Jürgen Schmidhuber. "Long Short-Term Memory." Neural Computation, vol. 9, no. 8, 1997, pp. 1735-1780.',
    title: 'Long Short-Term Memory', year: 1997, surname: 'Hochreiter',
  },
  {
    style: 'Chicago (quoted title, curly quotes)',
    ref: 'Goodfellow, Ian, Jean Pouget-Abadie, Mehdi Mirza, et al. 2014. “Generative Adversarial Nets.” Advances in Neural Information Processing Systems 27: 2672-2680.',
    title: 'Generative Adversarial Nets', year: 2014, surname: 'Goodfellow',
  },
  {
    style: 'Numbered APA',
    ref: '12. Silver, D., Huang, A., Maddison, C. J., et al. (2016). Mastering the game of Go with deep neural networks and tree search. Nature, 529(7587), 484-489.',
    title: 'Mastering the game of Go with deep neural networks and tree search', year: 2016, surname: 'Silver',
  },
  {
    style: 'APA, organisation author',
    ref: 'World Health Organization. (2021). Global tuberculosis report 2021. World Health Organization.',
    title: 'Global tuberculosis report 2021', year: 2021, surname: null,
  },
  {
    style: 'No year (authors must not become the title)',
    ref: 'Mwangi, J. K., & Otieno, P. Neural networks for crop yield prediction in East Africa. Computers and Electronics in Agriculture, 45, 12-30.',
    title: 'Neural networks for crop yield prediction in East Africa', year: null, surname: 'Mwangi',
  },
  {
    style: 'APA with DOI URL',
    ref: 'Karniadakis, G. E., Kevrekidis, I. G., Lu, L., Perdikaris, P., Wang, S., & Yang, L. (2021). Physics-informed machine learning. Nature Reviews Physics, 3(6), 422-440. https://doi.org/10.1038/s42254-021-00314-5',
    title: 'Physics-informed machine learning', year: 2021, surname: 'Karniadakis',
  },
  {
    style: 'APA, particle surname',
    ref: 'van der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. Journal of Machine Learning Research, 9, 2579-2605.',
    title: 'Visualizing data using t-SNE', year: 2008, surname: 'van der Maaten',
  },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('parse-cases.mjs')) {
  let pass = 0;
  for (const c of CASES) {
    const p = parseRef(c.ref);
    const okTitle = norm(p.title) === norm(c.title);
    const okYear = p.year === c.year;
    const okSurname = c.surname === null || norm(p.surname) === norm(c.surname);
    const ok = okTitle && okYear && okSurname;
    if (ok) pass++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.style}`);
    if (!ok) {
      if (!okTitle) console.log(`        title   got: ${JSON.stringify(p.title)}\n                want: ${JSON.stringify(c.title)}`);
      if (!okYear) console.log(`        year    got: ${p.year}  want: ${c.year}`);
      if (!okSurname) console.log(`        surname got: ${JSON.stringify(p.surname)}  want: ${JSON.stringify(c.surname)}`);
    }
  }
  console.log(`\n${pass}/${CASES.length} parsed correctly`);
  process.exitCode = pass === CASES.length ? 0 : 1;
}
