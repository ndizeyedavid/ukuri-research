import { searchByTitle, getWork } from "./openalex.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "for",
  "and",
  "to",
  "with",
  "by",
  "from",
  "is",
  "are",
  "at",
  "as",
  "into",
  "over",
  "review",
]);

const normalize = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) =>
  normalize(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));

function tokenJaccard(a, b) {
  const A = new Set(tokens(a)),
    B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function levenshteinRatio(a, b) {
  a = normalize(a).slice(0, 400);
  b = normalize(b).slice(0, 400);
  if (!a || !b) return 0;
  const m = a.length,
    n = b.length;
  if (Math.abs(m - n) > 0.6 * Math.max(m, n)) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const cur = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = cur;
    }
  }
  return 1 - dp[m] / Math.max(m, n);
}

const titleSim = (a, b) =>
  0.65 * tokenJaccard(a, b) + 0.35 * levenshteinRatio(a, b);

const tokenOverlap = (a, b) => {
  const A = new Set(tokens(a)),
    B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
};
const informedTokens = (s) => tokens(s).length;

function titleScore(a, b) {
  const base = titleSim(a, b);
  const A = new Set(tokens(a)),
    B = new Set(tokens(b));
  const small = Math.min(A.size, B.size),
    big = Math.max(A.size, B.size);
  if (small < 3 || small / big < 0.35) return base;
  const beforeColon = (t) => String(t || "").split(/:\s/)[0];
  const head = titleSim(beforeColon(a), beforeColon(b));
  return Math.max(base, 0.92 * tokenOverlap(a, b), head >= 0.9 ? 0.9 : 0);
}

// ---------- reference parsing ----------
const PARTICLE =
  "(?:[vV]an|[vV]on|[dD]e|[dD]er|[dD]en|[dD]el|[dD]ella|[dD]i|[dD]a|[dD]os|[dD]u|[lL]a|[lL]e|[sS]t|[bB]in|[aA]l|[eE]l)";
const ABBREV = new Set([
  "al",
  "eds",
  "ed",
  "vol",
  "no",
  "pp",
  "p",
  "vs",
  "etc",
  "inc",
  "ltd",
  "co",
  "corp",
  "jr",
  "sr",
  "dr",
  "st",
  "mr",
  "mrs",
  "ms",
  "fig",
  "approx",
  "dept",
  "univ",
  "cf",
  "ca",
  "trans",
  "rev",
  "ser",
  "suppl",
]);
const MAX_YEAR = new Date().getFullYear() + 1;
const YEAR_RE = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/g;

function isSentenceEnd(text, i) {
  const ch = text[i];
  if (ch === "?" || ch === "!") return true;
  const before = text.slice(0, i);
  const word = (before.match(/([\p{L}\p{N}]+)$/u) || [])[1] || "";
  if (!word) return true;
  if (word.length === 1 && /\p{Lu}/u.test(word)) return false;
  if (/\.\p{L}$/u.test(before)) return false;
  if (ABBREV.has(word.toLowerCase())) return false;
  return true;
}

export function sentences(text) {
  const out = [];
  let start = 0;
  const re = /[.?!]["”’']?(?=\s+|$)/g;
  let m;
  while ((m = re.exec(text))) {
    if (!isSentenceEnd(text, m.index)) continue;
    const end = m.index + m[0].length;
    const s = text.slice(start, end).trim();
    if (s) out.push({ text: s, start, end });
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push({ text: rest, start, end: text.length });
  return out;
}

function looksLikeAuthors(s) {
  const t = s.trim();
  if (!t) return false;
  if (/\bet al\b/i.test(t)) return true;
  const initials = (t.match(/(?:^|[\s,(])\p{Lu}\.(?:\s?-?\p{Lu}\.)*/gu) || [])
    .length;
  const vancouver = (
    t.match(/\b\p{Lu}[\p{L}'’-]+\s\p{Lu}{1,3}(?=,|\.|$)/gu) || []
  ).length;
  const commas = (t.match(/,/g) || []).length;
  const words = t.split(/\s+/).length;
  if (initials >= 1 && (commas >= 1 || /&|\band\b/.test(t))) return true;
  if (vancouver >= 1 && words <= 4 * (vancouver + 1)) return true;
  if (initials >= 2) return true;
  return false;
}

const NAME = `(?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+)?`;
const INITIALS = "\\p{Lu}\\.(?:\\s?-?\\p{Lu}\\.)*";
const SEP = "(?:\\s*,\\s*(?:&\\s*|and\\s+)?|\\s*&\\s*|\\s+and\\s+)";
const APA_BLOCK = new RegExp(
  `^(?:${NAME},\\s*${INITIALS}${SEP})*${NAME},\\s*${INITIALS}(?:,?\\s*et al\\.)?\\s+`,
  "u",
);
const VANC_BLOCK = new RegExp(
  `^(?:${NAME}\\s+\\p{Lu}{1,3}\\s*,\\s*)*${NAME}\\s+\\p{Lu}{1,3}(?:,\\s*et al)?\\.\\s+`,
  "u",
);

const INIT_NP = "\\p{Lu}{1,3}(?:-\\p{Lu}{1,3})?";
const ONE_WORD = `(?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+`;
const NAME_NP = `${ONE_WORD}(?:\\s+(?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+)?`;
const AUTH_NP = `${NAME_NP}\\s+${INIT_NP}`;
const NOPERIOD_BLOCK = new RegExp(
  `^(?:(?:${AUTH_NP}\\s*,\\s*)*${AUTH_NP}\\s*,?\\s+and\\s+${INIT_NP}\\s+${ONE_WORD}(?:\\s\\p{Ll}{1,4}(?=\\s\\p{Lu}))?|(?:${AUTH_NP}\\s*,\\s*)+${AUTH_NP}|${AUTH_NP})\\s+(?=\\p{Lu}[\\p{Ll}\\d\\s])`,
  "u",
);

function authorBlock(work) {
  const m =
    work.match(APA_BLOCK) ||
    work.match(VANC_BLOCK) ||
    work.match(NOPERIOD_BLOCK);
  return m && m[0].length < work.length - 4 ? m[0] : null;
}

export function repairPdfText(s) {
  let t = String(s || "").replace(/\s+/g, " ");
  t = t.replace(/(\S)\s+-\s+(?=\S)/g, "$1-");
  t = t.replace(/(10\.\d{4,9}\/\S*-)\s+(?=\S)/g, "$1");
  for (let i = 0; i < 3; i++)
    t = t.replace(
      /(\p{L})\s([^\x00-\x7F\p{P}\p{S}\s\d])(?=[\s\p{L},.])/gu,
      "$1$2",
    );
  t = t.replace(
    /([^\x00-\x7F\p{P}\p{S}\s\d])\s(\p{Ll}{1,2}[^\x00-\x7F\s]?)(?=[\s,.])/gu,
    "$1$2",
  );
  t = t.replace(
    /(^|[\s(])([B-HJ-Z]) (?!(?:and|et|van|von|de|der|den|del|da|di|du|la|le)\b)(\p{Ll}{3,})/gu,
    "$1$2$3",
  );
  t = t.replace(/(^|\s)([b-df-hj-np-tv-z]) (\p{Ll}{2,})/gu, "$1$2$3");
  return t.trim();
}

const cleanTitle = (s) =>
  String(s || "")
    .replace(/^[\s"“”'‘’.,:;)\]-]+/, "")
    .replace(/[\s"“”'‘’,.;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

function pickYear(text) {
  const years = [...text.matchAll(YEAR_RE)]
    .map((m) => ({
      y: parseInt(m[1], 10),
      i: m.index,
      after: text.slice(m.index + m[0].length, m.index + m[0].length + 6),
    }))
    .filter(({ y }) => y <= MAX_YEAR);
  if (!years.length) return null;
  const printed = years.find(({ after }) =>
    /^\s*(?:;|\(|\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/.test(
      after,
    ),
  );
  return (printed || years[0]).y;
}

function surnameFrom(authors) {
  const a = String(authors || "")
    .replace(/^\s*[\[(]?\d{1,3}[\])]?[.)]?\s+/, "")
    .trim();
  if (!a) return null;
  let m = a.match(
    new RegExp(
      `^((?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+)?)\\s*,`,
      "u",
    ),
  );
  if (
    m &&
    !/\s/.test(m[1].replace(new RegExp(`^(?:${PARTICLE}\\s+)+`, "i"), ""))
  )
    return m[1].trim();
  m = a.match(/^(\p{Lu}[\p{L}'’-]+)\s+\p{Lu}{1,3}(?=[,.\s]|$)/u);
  if (m) return m[1];
  m = a.match(
    new RegExp(
      `^(?:\\p{Lu}\\.\\s*(?:-?\\p{Lu}\\.\\s*)*)((?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+)`,
      "u",
    ),
  );
  if (m) return m[1];
  if (m === null && /^\p{Lu}[\p{L}'’-]+,/u.test(a)) return a.split(",")[0];
  return null;
}

export function parseRef(raw) {
  const text = repairPdfText(raw);

  const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
  const doi = doiMatch ? doiMatch[0].replace(/[.,;:)]+$/, "") : null;

  const work = text
    .replace(/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+/, "")
    .replace(/\b(?:https?:\/\/)?(?:dx\.)?doi\.org\/\S+/gi, " ")
    .replace(/\bdoi:\s*\S+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/10\.\d{4,9}\/\S+/g, " ")
    .replace(/\S+\.(?:pdf|html?|php|aspx?)\b\S*/gi, " ")
    .replace(
      /\b(?:last\s+)?accessed(?:\s+on)?\s+(?:\d{1,2}\s+)?\p{L}+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\.?/giu,
      " ",
    )
    .replace(
      /\b(?:last\s+)?accessed(?:\s+on)?\s+\d{1,2}\s+\p{L}+\.?,?\s+\d{4}\.?/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  let title = null,
    authors = "",
    year = null,
    rest = work;

  const q = work.match(/["“]([^"”]{4,}?)[,.]?["”]/);
  if (q) {
    title = cleanTitle(q[1]);
    authors = work.slice(0, q.index);
    rest = work.slice(q.index + q[0].length);
    year = pickYear(rest) ?? pickYear(authors);
  }

  if (!title) {
    const p = work.match(
      /\(\s*((?:1[5-9]|20)\d{2})[a-z]?(?:\s*[,;][^)]*)?\)|\(\s*n\.\s?d\.\s*\)/i,
    );
    if (p) {
      authors = work.slice(0, p.index);
      year = p[1] ? parseInt(p[1], 10) : null;
      const after = work.slice(p.index + p[0].length).replace(/^[\s.,:]+/, "");
      const first = sentences(after)[0];
      if (first) title = cleanTitle(first.text);
    }
  }

  if (!title) {
    const block = authorBlock(work);
    if (block) {
      const parts = sentences(work.slice(block.length));
      const first = parts.find((x) => !/^\(?\d{4}[a-z]?\)?\.?$/.test(x.text));
      if (first && first.text.replace(/[^\p{L}]/gu, "").length >= 4) {
        title = cleanTitle(first.text);
        authors = block;
      }
    }
  }

  if (!title) {
    const h = work.match(
      /^(.{2,300}?)\.\s+((?:1[5-9]|20)\d{2})[a-z]?\.\s+(.+)$/,
    );
    if (h) {
      const first = sentences(h[3])[0];
      if (first && first.text.replace(/[^\p{L}]/gu, "").length >= 4) {
        authors = h[1];
        year = parseInt(h[2], 10);
        title = cleanTitle(first.text);
      }
    }
  }

  if (!title) {
    const h = work.match(
      /^(.{2,300}?)[\s.,]+((?:1[5-9]|20)\d{2})[a-z]?[.,]\s+(.+)$/,
    );
    if (h && looksLikeAuthors(h[1])) {
      authors = h[1];
      year = parseInt(h[2], 10);
      const first = sentences(h[3])[0];
      if (first) title = cleanTitle(first.text);
    }
  }

  if (!title) {
    const parts = sentences(work);
    let k = 0;
    if (parts.length > 1 && looksLikeAuthors(parts[0].text)) k = 1;
    while (
      k < parts.length - 1 &&
      looksLikeAuthors(parts[k].text) &&
      parts[k].text.split(/\s+/).length <= 6
    )
      k++;
    const cand = parts[k];
    if (cand && cand.text.replace(/[^\p{L}]/gu, "").length >= 4) {
      title = cleanTitle(cand.text);
      authors = work.slice(0, cand.start);
    }
  }

  if (year === null) year = pickYear(title ? work.replace(title, " ") : work);
  if (title && title.length < 4) title = null;

  return {
    raw: text,
    doi,
    year,
    surname: surnameFrom(authors),
    title: title || null,
  };
}

const UNVERIFIABLE =
  /(retrieved from|\bisbn\b|\bwebpage\b|\[web page\]|\bblog post\b)/i;
export const isUnverifiable = (raw) => UNVERIFIABLE.test(String(raw || ""));
const hasWebLink = (raw) =>
  /https?:\/\/(?!(?:dx\.)?doi\.org)|\baccessed\b/i.test(String(raw || ""));

function surnameHit(parsedSurname, work) {
  if (!parsedSurname) return 0.5;
  const want = normalize(parsedSurname);
  const wantTail = want.split(" ").pop();
  return (work.authors || []).some((a) => {
    const toks = normalize(a).split(" ");
    return toks.includes(wantTail) || normalize(a).includes(want);
  })
    ? 1
    : 0;
}

function yearSim(a, b) {
  if (!a || !b) return 0.5;
  const d = Math.abs(a - b);
  return d === 0 ? 1 : d === 1 ? 0.8 : d <= 3 ? 0.3 : 0;
}

function scoreAgainst(parsed, work) {
  const t = titleScore(parsed.title || "", work.title);
  const y = yearSim(parsed.year, work.year);
  const a = surnameHit(parsed.surname, work);
  let score = Math.round(100 * (0.7 * t + 0.15 * y + 0.15 * a));
  if (informedTokens(parsed.title) < 4 && (a < 1 || y < 0.8))
    score = Math.min(score, 70);
  return score;
}

function differences(parsed, work) {
  const out = [];
  if (parsed.title && titleScore(parsed.title, work.title) < 0.9)
    out.push("title");
  if (parsed.year && work.year && parsed.year !== work.year)
    out.push(`year (${parsed.year} vs ${work.year})`);
  if (parsed.surname && surnameHit(parsed.surname, work) < 1)
    out.push("authors");
  if (!out.length) return "minor details";
  return out.length === 1
    ? out[0]
    : `${out.slice(0, -1).join(", ")} and ${out[out.length - 1]}`;
}

const slim = (w) => ({
  shortId: w.shortId,
  title: w.title,
  year: w.year,
  doi: w.doi,
  journal: w.journal,
  authors: (w.authors || []).slice(0, 5),
  citedByCount: w.citedByCount,
  isOA: w.isOA,
  isRetracted: w.isRetracted,
});

export async function matchReference(raw) {
  const parsed = parseRef(raw);
  const base = {
    ref: parsed.raw,
    parsedYear: parsed.year,
    parsedTitle: parsed.title,
    parsedDoi: parsed.doi,
  };

  if (isUnverifiable(raw)) {
    return {
      ...base,
      verdict: "unverifiable",
      score: null,
      matched: null,
      note: "Looks like a book, website or report. OpenAlex can’t verify these reliably.",
    };
  }

  if (parsed.doi) {
    try {
      const w = await getWork(`doi:${parsed.doi}`);
      const score = scoreAgainst(parsed, w);
      const yDelta =
        parsed.year && w.year ? Math.abs(parsed.year - w.year) : null;
      if (w.isRetracted)
        return {
          ...base,
          verdict: "retracted",
          score,
          matched: slim(w),
          note: "DOI resolves, but this work is retracted.",
        };
      if (parsed.title && titleScore(parsed.title, w.title) < 0.5) {
        return {
          ...base,
          verdict: "mismatch",
          score,
          matched: slim(w),
          note: "DOI resolves, but the title looks different from the reference. Possible mutation.",
        };
      }
      const strongTitle =
        !parsed.title || titleScore(parsed.title, w.title) >= 0.85;
      if (yDelta !== null && (yDelta > 3 || (yDelta > 1 && !strongTitle))) {
        return {
          ...base,
          verdict: "mismatch",
          score,
          matched: slim(w),
          note: `DOI resolves, but the year differs (ref says ${parsed.year}, OpenAlex says ${w.year}). Possible mutation.`,
        };
      }
      if (yDelta) {
        return {
          ...base,
          verdict: "valid",
          score: Math.max(score, 85),
          matched: slim(w),
          note: `Exact DOI match. OpenAlex lists ${w.year}, the reference says ${parsed.year}: usually online-first versus print year.`,
        };
      }
      return {
        ...base,
        verdict: "valid",
        score,
        matched: slim(w),
        note: "Exact DOI match.",
      };
    } catch {
      parsed.doiFailed = true;
    }
  }

  if (
    !parsed.title ||
    parsed.title.length < 6 ||
    informedTokens(parsed.title) < 2
  ) {
    return {
      ...base,
      verdict: "unverifiable",
      score: null,
      matched: null,
      note: "Couldn’t parse a usable title from this reference (too little signal).",
    };
  }
  if (informedTokens(parsed.title) < 4 && !parsed.surname && !parsed.year) {
    return {
      ...base,
      verdict: "unverifiable",
      score: null,
      matched: null,
      note: "Title is too short to match without an author or year. Check it by hand.",
    };
  }
  let candidates = [];
  try {
    candidates = await searchByTitle(parsed.title, { perPage: 5 });
  } catch (err) {
    return {
      ...base,
      verdict: "unverifiable",
      score: null,
      matched: null,
      note: `Lookup failed (${err.message}). Try again.`,
    };
  }
  let best = null,
    bestScore = -1;
  const consider = (list) => {
    for (const w of list) {
      const sc = scoreAgainst(parsed, w);
      if (sc > bestScore) {
        bestScore = sc;
        best = w;
      }
    }
  };
  consider(candidates);
  if (bestScore < 75 && parsed.surname) {
    try {
      consider(
        await searchByTitle(`${parsed.title} ${parsed.surname}`, {
          perPage: 5,
        }),
      );
    } catch {}
  }
  if (bestScore < 75) {
    try {
      consider(
        await searchByTitle(parsed.title, {
          perPage: 5,
          mode: "title",
          year: parsed.year,
        }),
      );
    } catch {}
  }
  const web = hasWebLink(raw);
  if (!best) {
    return web
      ? {
          ...base,
          verdict: "unverifiable",
          score: null,
          matched: null,
          note: "Not found in OpenAlex. Web sources often are not indexed, so check the link by hand.",
        }
      : {
          ...base,
          verdict: "ghost",
          score: 0,
          matched: null,
          note: "No candidate papers found. Possibly a ghost reference.",
        };
  }
  const doiNote = parsed.doiFailed
    ? "DOI did not resolve; matched by title. "
    : "";
  if (best.isRetracted && bestScore >= 50) {
    return {
      ...base,
      verdict: "retracted",
      score: bestScore,
      matched: slim(best),
      note: doiNote + "Best match is marked retracted in OpenAlex.",
    };
  }
  if (bestScore >= 75)
    return {
      ...base,
      verdict: "valid",
      score: bestScore,
      matched: slim(best),
      note: doiNote + "Strong match.",
    };
  if (web && bestScore < 75 && titleScore(parsed.title, best.title) < 0.7) {
    return {
      ...base,
      verdict: "unverifiable",
      score: bestScore,
      matched: null,
      note:
        doiNote +
        "No close match in OpenAlex. Web sources often are not indexed, so check the link by hand.",
    };
  }
  if (bestScore >= 50)
    return {
      ...base,
      verdict: "mismatch",
      score: bestScore,
      matched: slim(best),
      note:
        doiNote +
        `Closest match differs in ${differences(parsed, best)}. Check it is the paper you meant.`,
    };
  if (web) {
    return {
      ...base,
      verdict: "unverifiable",
      score: bestScore,
      matched: null,
      note:
        doiNote +
        "No close match in OpenAlex. Web sources often are not indexed, so check the link by hand.",
    };
  }
  return {
    ...base,
    verdict: "ghost",
    score: bestScore,
    matched: slim(best),
    note: doiNote + "Nothing close enough found. Possibly a ghost reference.",
  };
}
