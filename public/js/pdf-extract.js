// Browser-side PDF text extraction for reference lists.
// The PDF never leaves the user's machine: pdf.js runs fully client-side.
import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';
import { splitReferences, splitPastedReferences } from './ref-split.js';

export { splitReferences, splitPastedReferences };

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

const SECTION_HEADING = /^\s*(references|bibliography|works\s+cited|reference\s+list|literature\s+cited)\b[\s:.]*$/i;
const APPENDIX_HEADING = /^\s*(appendix|appendices)\b/i;

// Returns { doc, pageCount }: doc must be passed to extractSection.
export async function loadPdf(file) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  return doc;
}

// Extract lines with their left x-position (used for hanging-indent detection).
export async function extractLines(doc) {
  const lines = [];
  let items = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    items += content.items.length;

    // Group items into lines by y (transform[5]) with a small tolerance.
    const byY = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      const key = Math.round(y / 3) * 3; // 3pt tolerance buckets
      const bucket = byY.get(key) || [];
      bucket.push({ x, y, str: item.str, width: item.width ?? 0 });
      byY.set(key, bucket);
    }
    const pageLines = [...byY.values()]
      .map((itemsInLine) => {
        const sorted = itemsInLine.sort((a, b) => a.x - b.x);
        const text = sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
        const x = Math.min(...sorted.map((i) => i.x));
        return { text, x, page: p, y: sorted[0].y };
      })
      .filter((l) => l.text.length > 0)
      .sort((a, b) => b.y - a.y); // PDF y is bottom-up
    lines.push(...pageLines);
  }
  return { lines, items };
}

function findSectionBounds(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING.test(lines[i].text)) start = i; // keep LAST occurrence
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (APPENDIX_HEADING.test(lines[i].text)) { end = i; break; }
  }
  return { start, end };
}

export async function extractReferencesSection(doc) {
  const { lines, items } = await extractLines(doc);
  if (items === 0) {
    const err = new Error('This PDF has no selectable text (it is probably scanned). Paste the reference list manually instead.');
    err.code = 'SCANNED_PDF';
    throw err;
  }
  const bounds = findSectionBounds(lines);
  if (!bounds) {
    return {
      sectionFound: false,
      fullText: lines.map((l) => l.text).join('\n'),
      sectionText: '',
      lines: [],
      pageCount: doc.numPages,
    };
  }
  const sectionLines = lines.slice(bounds.start, bounds.end);
  return {
    sectionFound: true,
    stoppedAtAppendix: bounds.end < lines.length,
    fullText: lines.map((l) => l.text).join('\n'),
    sectionText: sectionLines.map((l) => l.text).join('\n'),
    lines: sectionLines,
    pageCount: doc.numPages,
  };
}
