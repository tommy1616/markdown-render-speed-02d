// Small text utilities shared by the scanners and the renderer.

const escapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const needsAny = /[&<>"']/;
const looseTest = /[<>"']|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const looseAll = /[<>"']|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const entityScan = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;

export function escapeHtml(value, encode) {
  if (encode) {
    if (!needsAny.test(value)) return value;
    return value.replace(/[&<>"']/g, ch => escapes[ch]);
  }
  if (!looseTest.test(value)) return value;
  return value.replace(looseAll, ch => escapes[ch]);
}

function makeChar(dec, hex) {
  const cp = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  if (cp === 38) return '&amp;';
  return String.fromCodePoint(cp);
}

export function decodeEntities(text) {
  if (text.indexOf('&') < 0) return text;
  entityScan.lastIndex = 0;
  if (!entityScan.test(text)) return text;
  return text.replace(entityScan, (whole, dec, hex) =>
    dec === undefined && hex === undefined ? '&amp;' : makeChar(dec, hex),
  );
}

export function normalizeLabel(label) {
  const squashed = label.trim().replace(/\s+/g, ' ');
  const lower = squashed.toLowerCase();
  const upper = lower.toUpperCase();
  return upper.toLowerCase();
}

export function firstLine(text) {
  const at = text.indexOf('\n');
  return at < 0 ? text : text.slice(0, at);
}

export function stripTail(text, ch) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === ch.charCodeAt(0)) end--;
  return end === text.length ? text : text.slice(0, end);
}

const blankLineRe = /^[ \t]*$/;

export function trimTrailingBlanks(text) {
  const lines = text.split('\n');
  let k = lines.length - 1;
  while (k >= 0 && blankLineRe.test(lines[k])) k--;
  if (lines.length - k <= 2) return text;
  return lines.slice(0, k + 1).join('\n');
}

export function expandTabs(text, startColumn) {
  let col = startColumn | 0;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9) {
      const width = 4 - (col & 3);
      out += width === 1 ? ' ' : width === 2 ? '  ' : width === 3 ? '   ' : '    ';
      col += width;
    } else {
      out += text[i];
      col++;
    }
  }
  return out;
}

export function unbalanced(text, open, close) {
  if (text.indexOf(open) < 0 && text.indexOf(close) < 0) return -1;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

export function splitCells(line, width) {
  const cells = [];
  let from = 0;
  let slashes = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 92) {
      slashes++;
      continue;
    }
    if (c === 124 && (slashes & 1) === 0) {
      cells.push(line.slice(from, i));
      from = i + 1;
    }
    slashes = 0;
  }
  cells.push(line.slice(from));
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  const limit = width || cells.length;
  if (cells.length > limit) cells.length = limit;
  while (cells.length < limit) cells.push('');
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  }
  return cells;
}

const fenceIndent = /^(\s+)(?:```)/;

export function dedentFence(raw, body) {
  const m = fenceIndent.exec(raw);
  if (m === null) return body;
  const limit = m[1].length;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let n = 0;
    while (n < line.length && (line.charCodeAt(n) === 32 || line.charCodeAt(n) === 9)) n++;
    if (n > 0) lines[i] = line.slice(Math.min(n, limit));
  }
  return lines.join('\n');
}

// Collect the last position of each possibly-closing emphasis / strike run in
// a masked string, so the inline scanner can bail out before looping.
export function surveyClosers(text) {
  let star = -1;
  let under = -1;
  let tilde = -1;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c !== 42 && c !== 95 && c !== 126) continue;
    let j = i + 1;
    while (j < n && text.charCodeAt(j) === c) j++;
    if (i > 0) {
      const p = text.charCodeAt(i - 1);
      if (p !== 32 && p !== 9 && p !== 10 && p !== 13 && p !== 12) {
        if (c === 42) star = i;
        else if (c === 95) under = i;
        else tilde = i;
      }
    }
    i = j - 1;
  }
  return { text, star, under, tilde };
}
