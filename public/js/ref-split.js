const HEADING = /^\s*(references|bibliography|works\s+cited|reference\s+list|literature\s+cited)\s*:?\s*$/i;
const NUMBERED = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+\S/;

const URL_ONLY = /^\s*(?:https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)(?:\s+\d{1,6})?\s*$/i;

export function dropPageFurniture(lines) {
  const key = (t) => t.replace(/\s+\d{1,6}\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const counts = new Map();
  for (const l of lines) {
    const k = key(l.text);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return lines.filter((l) => {
    const t = l.text.trim();
    if (!t || HEADING.test(t)) return false;
    if (/^\d{1,6}$/.test(t)) return false;                                    
    const repeated = (counts.get(key(t)) || 0) >= 2;
    if (repeated && t.length < 140) return false;                             
    if (URL_ONLY.test(t) && /\s\d{1,6}\s*$/.test(t)) return false;            
    return true;
  });
}

function splitNumbered(lines) {
  const nums = lines.map((l) => {
    const m = l.text.match(NUMBERED);
    return m ? parseInt(m[1] || m[2], 10) : null;
  });
  if (nums.filter((n) => n !== null).length < 3) return null;
  const firstIdx = nums.findIndex((n) => n !== null);
  let expect = nums[firstIdx];
  const out = [];
  let buf = [];
  lines.forEach((l, i) => {
    if (i < firstIdx) return;
    if (nums[i] === expect) {
      if (buf.length) out.push(buf);
      buf = [l.text];
      expect += 1;
    } else {
      buf.push(l.text);
    }
  });
  if (buf.length) out.push(buf);
  if (out.length < 3) return null;
  return out.map((b) => b.join(' ').replace(/\s+/g, ' ').trim()).filter((r) => r.length > 15);
}

export function splitReferences(rawLines) {
  if (!rawLines?.length) return [];
  const sectionLines = dropPageFurniture(rawLines);
  if (!sectionLines.length) return [];
  const numbered = splitNumbered(sectionLines);
  if (numbered) return numbered;
  const xs = sectionLines.map((l) => l.x);
  const minX = Math.min(...xs);
  const tolerance = Math.max(4, (Math.max(...xs) - minX) * 0.05);
  const chunks = [];
  let current = [];
  for (const line of sectionLines) {
    const isHeading = /^\s*(references|bibliography|works\s+cited|reference\s+list|literature\s+cited)\b/i.test(line.text);
    const startsNew = !isHeading && line.x <= minX + tolerance && current.length > 0;
    if (startsNew) { chunks.push(current); current = [line]; }
    else if (!isHeading) current.push(line);
  }
  if (current.length) chunks.push(current);

  let refs = chunks
    .map((chunk) => chunk.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter((r) => r.length > 15);


  if (refs.length <= 1) {
    const text = sectionLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ');
    const re = /(?=[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+,\s*(?:[A-Z]\.?\s*){0,4}\(?\d{4})/g;
    const parts = text.split(re).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) refs = parts;
  }
  return refs;
}

export function splitPastedReferences(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const kept = dropPageFurniture(raw.split('\n').map((t) => ({ text: t })));
  const numbered = splitNumbered(kept);
  if (numbered) return numbered;
  
  const keptSet = new Set(kept.map((l) => l.text));
  const cleaned = raw.split('\n').filter((t) => !t.trim() || keptSet.has(t)).join('\n').trim();
  const blocks = cleaned.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, ' ').trim()).filter((b) => b.length > 15);
  if (blocks.length > 1) return blocks;

  const surnameStart = /^[A-Za-zÀ-ÖØ-öø-ÿ'’\-]+(?:\s+(?:van|de|der|den|von|da|di|del|la|le)\s+[A-Za-zÀ-ÖØ-öø-ÿ'’\-]+)*\s*,\s*[A-ZÀ-ÖØ-Þ]/;
  const orgStart = /^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’&.\- ]{3,}\.?\s*\(?(19|20)\d{2}/;

  const out = [];
  let buf = '';
  for (const line of cleaned.split('\n')) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const looksNew = surnameStart.test(t) || orgStart.test(t);
    if (!buf || !looksNew) {
      buf = buf ? `${buf} ${t}` : t;
    } else {
      out.push(buf);
      buf = t;
    }
  }
  if (buf) out.push(buf);
  return out.map((s) => s.trim()).filter((r) => r.length > 15);
}
