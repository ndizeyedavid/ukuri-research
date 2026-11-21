const PARTICLES = new Set(['van', 'de', 'der', 'den', 'von', 'da', 'di', 'del', 'la', 'le']);
const ORG_WORDS = new Set(['association','organization','organisation','society','institute','university','college','council','committee','panel','federation','foundation','center','centre','authority','agency','bank','group','consortium','commission','department','ministry','academy','laboratory','labs','press','trust','board','corporation','inc','ltd']);

export function parseAuthorName(full) {
  const tokens = String(full).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { surname: '', initials: '' };
  if (tokens.length === 1) return { surname: tokens[0], initials: '' };
  
  if (tokens.length >= 4 || ORG_WORDS.has(tokens[tokens.length - 1].toLowerCase().replace(/[^\p{L}]/gu, ''))) {
    return { surname: tokens.join(' '), initials: '' };
  }

  let split = tokens.length - 1;
  while (split > 1 && PARTICLES.has(tokens[split - 1].toLowerCase())) split -= 1;
  const surname = tokens.slice(split).join(' ');
  const given = tokens.slice(0, split);
  const initials = given
    .map((t) => (/^\p{L}/u.test(t[0]) ? `${t[0].toUpperCase()}.` : t))
    .join(' ');
  return { surname, initials };
}

function formatAuthor(full) {
  const { surname, initials } = parseAuthorName(full);
  return initials ? `${surname}, ${initials}` : surname;
}


export function formatAuthorsAPA(authorNames) {
  const names = (authorNames || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) return '';
  const shown =
    names.length <= 20
      ? names.map(formatAuthor)
      : [...names.slice(0, 19).map(formatAuthor), '…', formatAuthor(names[names.length - 1])];
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')}, & ${shown[shown.length - 1]}`;
}

export function sentenceCase(title) {
  const words = String(title).trim().split(/\s+/);
  let capitalizeNext = true;
  return words
    .map((word) => {
      const bare = word.replace(/[^\p{L}\p{N}]/gu, '');
      const isAcronym = bare.length >= 2 && /^[\p{Lu}\p{N}]+$/u.test(bare);
      const hasInternalCaps = /\p{Lu}/u.test(word.slice(1));
      let out;
      if (isAcronym || hasInternalCaps) out = word;
      else if (capitalizeNext) out = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      else out = word.toLowerCase();
      capitalizeNext = /[:.?!]["'”’)]?$/u.test(word);
      return out;
    })
    .join(' ');
}

export function firstSurname(authorNames) {
  const first = (authorNames || []).map((n) => String(n).trim()).filter(Boolean)[0];
  return first ? parseAuthorName(first).surname : '';
}


export function buildInText(authorNames, year) {
  const names = (authorNames || []).map((n) => String(n).trim()).filter(Boolean);
  const y = year || 'n.d.';
  if (names.length === 0) {
    return { parenthetical: `(“Work,” ${y})`, narrative: `“Work” (${y})` };
  }
  const s = (n) => parseAuthorName(n).surname;
  let who;
  if (names.length === 1) who = s(names[0]);
  else if (names.length === 2) who = `${s(names[0])} & ${s(names[1])}`;
  else who = `${s(names[0])} et al.`;
  return { parenthetical: `(${who}, ${y})`, narrative: `${who} (${y})` };
}


export function buildReference({ authors, year, title, journal, volume, issue, pages, doi }) {
  const a = formatAuthorsAPA(authors) || 'Unknown author';
  const y = year || 'n.d.';
  const t = sentenceCase(title || 'Untitled').replace(/\.\s*$/, '');
  const doiUrl = doi ? `https://doi.org/${String(doi).replace(/^https?:\/\/doi\.org\//i, '')}` : '';

  const plainParts = [`${a} (${y}). ${t}.`];
  const htmlParts = [`<span>${escapeHtml(`${a} (${y}). ${t}.`)}</span>`];

  if (journal) {
    const vol = volume ? `, ${volume}` : '';
    const issuePart = issue ? `(${issue})` : '';
    const pagesPart = pages ? `, ${pages}` : '';
    plainParts.push(` ${journal}${vol}${issuePart}${pagesPart}.`);
    htmlParts.push(
      ` <i>${escapeHtml(journal)}${vol ? `, <i>${escapeHtml(volume)}</i>` : ''}</i>` +
        `${escapeHtml(issuePart)}${escapeHtml(pagesPart)}.`
    );
  }
  if (doiUrl) { plainParts.push(` ${doiUrl}`); htmlParts.push(` ${escapeHtml(doiUrl)}`); }

  return { plain: plainParts.join('').replace(/\s+/g, ' ').trim(), html: htmlParts.join('') };
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
