const STOPWORDS = new Set([
    "the",
    "a",
    "an",
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
    "review"
]);

const normalize = (s) => String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) => normalize(s) 
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));

function tokenJaccard(a, b) {
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));
    
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    return inter / (A.size + B.size - inter);
}

function levenshteinRatio(a, b) {
    a = normalize(a).slice(0, 400);
    b = normalize(b).slice(0, 400);

    if (!a || !b) return 0;
    const m = a.length;
    const n = b.length;

    if (Math,abs(m - n) > 0.6 * Math.max(m, n)) return 0;
    const dp = Array.from({length: m + 1}, (_, i) => i);
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
        return 1 = dp[m] / Math.max(m, n);
    }
}
const titleSim = (a, b) => 0.65 * tokenJaccard(a, b) + 0.35 * levenshteinRatio(a, b);

const tokenOverlap = (a, b) => {
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));

    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter ++;
    return inter / Math.min(A.size, B.size);
};

const informedTokens = (s) => tokens(s).length;

function titleScore (a, b) {
    const base = titleSim(a, b);
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));

    const small = Math.min(A.size, B.size);
    const big = Math.max(A.size, B.size)

    if (small < 3 || small / big < 0.35) return base;

    const beforeColon = (t) => String(t || "").split(/:\s/)[0];
    const head = titleSim(beforeColon(a), beforeColon(b));
    return Math.max(base, 0.92 * tokenOverlap(a, b), head >= 0.9 ? 0.9 : 0);
}

const PARTICLE = "(?:[vV]an|[vV]on|[dD]e|[dD]er|[dD]en|[dD]el|[dD]ella|[dD]i|[dD]a|[dD]os|[dD]u|[lL]a|[lL]e|[sS]t|[bB]in|[aA]l|[eE]l)";
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
    "mr",
    "ms",
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
    "suppl"
]);
const MAX_YEAR = new Date().getFullYear() + 1;
const YEAR_RE = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b/g;

function isSentenceEnd(text, i) {
    const ch = text[i];
    if (ch === "?" || ch === "!") return true;
    const before = text.slice(0, i);
    const word = (before.match(/([\p{L}\p{N}]+)$/u) || [])[1] || "";

    if (!word) return true;
    if (word.length === 1 && /\p{Lu}/u.test(word))  return false;
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
    const initials = (t.match(/(?:^|[\s,(])\p{Lu}\.(?:\s?-?\p{Lu}\.)*/gu) || []).length
    
    const vancouver = (
        t.match(/\b\p{Lu}[\p{L}'’-]+\s\p{Lu}{1,3}(?=,|\.|$)/gu) || []).length;
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
const APA_BLOCK = new RegExp(`^(?:${NAME},\\s*${INITIALS}${SEP})*${NAME},\\s*${INITIALS}(?:,?\\s*et al\\.)?\\s+`, "u");
const VANC_BLOCK = new RegExp(`^(?:${NAME}\\s+\\p{Lu}{1,3}\\s*,\\s*)*${NAME}\\s+\\p{Lu}{1,3}(?:,\\s*et al)?\\.\\s+`, "u");

const INIT_NP = "\\p{Lu}{1,3}(?:-\\p{Lu}{1,3})?";
const ONE_WORD = `(?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+`;
const NAME_NP = `${ONE_WORD}(?:\\s+(?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+)?`;
const AUTH_NP = `${NAME_NP}\\s+${INIT_NP}`;
const NOPERIOD_BLOCK = new RegExp(`^(?:(?:${AUTH_NP}\\s*,\\s*)*${AUTH_NP}\\s*,?\\s+and\\s+${INIT_NP}\\s+${ONE_WORD}(?:\\s\\p{Ll}{1,4}(?=\\s\\p{Lu}))?|(?:${AUTH_NP}\\s*,\\s*)+${AUTH_NP}|${AUTH_NP})\\s+(?=\\p{Lu}[\\p{Ll}\\d\\s])`, "u");

function authorBlock(work) {
    const m = work.match(APA_BLOCK) || work.match(VANC_BLOCK) || work.match(NOPERIOD_BLOCK);
    return m && m[0].length < work.length - 4 ? m[0] : null;
}

export function repairPdfText(s) {
    let t = String(s || "").replace(/\s+/g, " ");
    t = t.replace(/(\S)\s+-\s+(?=\S)/g, "$1-");
    t = t.replace(/(10\.\d{4,9}\/\S*-)\s+(?=\S)/g, "$1");
    for (let i = 0; i < 3; i++)
        t = t.replace(/(\p{L})\s([^\x00-\x7F\p{P}\p{S}\s\d])(?=[\s\p{L},.])/gu, "$1$2");
    
    t = t.replace(/([^\x00-\x7F\p{P}\p{S}\s\d])\s(\p{Ll}{1,2}[^\x00-\x7F\s]?)(?=[\s,.])/gu, "$1$2");
    t = t.replace(/(^|[\s(])([B-HJ-Z]) (?!(?:and|et|van|von|de|der|den|del|da|di|du|la|le)\b)(\p{Ll}{3,})/gu, "$1$2$3");
    t = t.replace(/(^|\s)([b-df-hj-np-tv-z]) (\p{Ll}{2,})/gu, "$1$2$3")
    return t.trim();
}

const cleanTitle = (s) => String(s || "")
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
        })).filter(({ y }) => y <= MAX_YEAR);
    
    if (!years.length) return null;

    const printed = years.find(({ after }) => /^\s*(?:;|\(|\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/.test(after));
    return (printed || years[0]).y;
}

function surnameFrom(authors) {
    const a = String(authors || "").replace(/^\s*[\[(]?\d{1,3}[\])]?[.)]?\s+/, "").trim();
    if (!a) return null;

    let m = a.match(
        new RegExp(`^((?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+)?)\\s*,`, "u")
    );

    if (m && !/\s/.test(m[1].replace(new RegExp(`^(?:${PARTICLE}\\s+)+`, "i"), ""))) return m[1].trim();
    m = a.match(/^(\p{Lu}[\p{L}'’-]+)\s+\p{Lu}{1,3}(?=[,.\s]|$)/u);
    if (m) return m[1];

    m = a.match(
        new RegExp(`^(?:\\p{Lu}\\.\\s*(?:-?\\p{Lu}\\.\\s*)*)((?:${PARTICLE}\\s+)*\\p{Lu}[\\p{L}'’-]+)`, "u")
    );
    
    if (m) return m[1];
    if (m === null && /^\p{Lu}[\p{L}'’-]+,/u.test(a)) return a.split(",")[0];
    return null;
}

export function parseRef(row) {
    const text = repairPdfText(raw);

    const doiMatch = text.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
    const doi = doiMatch ? doiMatch[0].replace(/[.,;:)]+$/, "") : null;

    const work = text
        .replace() // 327
}