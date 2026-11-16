// Block-level tokenizer.  Walks a normalized document once, building the
// block tree and queueing every inline range for a later pass.

import { blockRx as B, lineProbe, listItemRx } from './patterns.js';
import {
  dedentFence,
  expandTabs,
  firstLine,
  normalizeLabel,
  stripTail,
  trimTrailingBlanks,
  unbalanced,
} from './util.js';

const nonSpace = /[^ ]/;
const blankOnly = /^[ \t]*$/;
const tabAll = /\t/g;
const codeIndent = /^(?: {0,3}\t| {1,4})/gm;
const hrefAngle = /^<(.*)>$/;
const trailingHash = /#$/;
const trailingSpaceTab = /[ \t]$/;
const doubleBlankTail = /\n[ \t]*\n[ \t]*$/;
const anyTwoLines = /\n.*\n/;
const tableDivider = /[:|]/;
const tableEdgePipes = /^\||\| *$/g;
const tableTail = /\n[ \t]*$/;
const rightAlign = /^ *-+: *$/;
const centerAlign = /^ *:-+: *$/;
const leftAlign = /^ *:-+ *$/;
const setextLine = /^ {0,3}(?:=+|-+) *$/;

const quoteStart = /^ {0,3}>/;
const quoteMarkerSpace = /^( {0,3}>)([ \t]+)/gm;
const quoteStrip = /^ {0,3}>[ \t]?/gm;
const quoteSetext = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;

const isTask = /^\[[ xX]\][ \t]+\S/;
const stripTask = /^\[[ xX]\][ \t]+/;
const taskBox = /\[[ xX]\]/;
// Backslash escapes of punctuation are unwrapped in link destinations and
// code fence info strings.
const unescapePunct = /\\([\p{P}\p{S}])/gu;

export class BlockParser {
  constructor(ctx, inline) {
    this.ctx = ctx;
    this.inline = inline;
  }

  walk(src, tokens = [], merge = false) {
    let guard = Infinity;
    while (src.length > 0) {
      if (src.length < guard) guard = src.length;
      else throw new Error('block scanner stalled at ' + src.charCodeAt(0));

      const c0 = src.charCodeAt(0);
      const spaced = c0 === 32 || c0 === 9;

      let tok = (spaced || c0 === 10) ? this.space(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        const last = tokens[tokens.length - 1];
        if (tok.raw.length === 1 && last !== undefined) last.raw += '\n';
        else tokens.push(tok);
        continue;
      }

      tok = spaced ? this.indentedCode(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        const last = tokens[tokens.length - 1];
        if (last !== undefined && (last.type === 'paragraph' || last.type === 'text')) {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
          last.text += '\n' + tok.text;
          this.ctx.jobs[this.ctx.jobs.length - 1].src = last.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }

      tok = (spaced || c0 === 96 || c0 === 126) ? this.fence(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 35) ? this.heading(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 45 || c0 === 95 || c0 === 42) ? this.rule(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 62) ? this.quote(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 42 || c0 === 43 || c0 === 45 || (c0 >= 48 && c0 <= 57))
        ? this.list(src)
        : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 60) ? this.html(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = (spaced || c0 === 91) ? this.definition(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        const last = tokens[tokens.length - 1];
        if (last !== undefined && (last.type === 'paragraph' || last.type === 'text')) {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
          last.text += '\n' + tok.raw;
          this.ctx.jobs[this.ctx.jobs.length - 1].src = last.text;
        } else {
          if (this.ctx.defs[tok.tag] === undefined) {
            this.ctx.defs[tok.tag] = { href: tok.href, title: tok.title };
            this.ctx.defCount++;
          }
          tokens.push(tok);
        }
        continue;
      }

      tok = maybeTable(src) ? this.table(src) : undefined;
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      tok = this.setext(src);
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }

      if (this.ctx.top) {
        tok = this.paragraph(src);
        if (tok !== undefined) {
          const last = tokens[tokens.length - 1];
          if (merge && last !== undefined && last.type === 'paragraph') {
            last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
            last.text += '\n' + tok.text;
            this.ctx.jobs.pop();
            this.ctx.jobs[this.ctx.jobs.length - 1].src = last.text;
          } else {
            tokens.push(tok);
          }
          merge = false;
          src = src.slice(tok.raw.length);
          continue;
        }
      }

      tok = this.plainText(src);
      if (tok !== undefined) {
        src = src.slice(tok.raw.length);
        const last = tokens[tokens.length - 1];
        if (last !== undefined && last.type === 'text') {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tok.raw;
          last.text += '\n' + tok.text;
          this.ctx.jobs.pop();
          this.ctx.jobs[this.ctx.jobs.length - 1].src = last.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }

      throw new Error('block scanner stalled at ' + src.charCodeAt(0));
    }
    this.ctx.top = true;
    return tokens;
  }

  space(src) {
    const m = B.blank.exec(src);
    if (m !== null && m[0].length > 0) return { type: 'space', raw: m[0] };
    return undefined;
  }

  indentedCode(src) {
    const m = B.code.exec(src);
    if (m === null) return undefined;
    const raw = trimTrailingBlanks(m[0]);
    return { type: 'code', raw, indented: true, text: raw.replace(codeIndent, '') };
  }

  fence(src) {
    const m = B.fence.exec(src);
    if (m === null) return undefined;
    return {
      type: 'code',
      raw: m[0],
      lang: m[2] ? m[2].trim().replace(unescapePunct, '$1') : m[2],
      text: dedentFence(m[0], m[3] || ''),
    };
  }

  heading(src) {
    const m = B.heading.exec(src);
    if (m === null) return undefined;
    let text = m[2].trim();
    if (trailingHash.test(text)) {
      const cut = stripTail(text, '#');
      if (cut === '' || trailingSpaceTab.test(cut)) text = cut.trim();
    }
    return {
      type: 'heading',
      raw: stripTail(m[0], '\n'),
      depth: m[1].length,
      text,
      children: this.inline.queue(text),
    };
  }

  rule(src) {
    const m = B.hr.exec(src);
    if (m !== null) return { type: 'hr', raw: stripTail(m[0], '\n') };
    return undefined;
  }

  quote(src) {
    const m = B.blockquote.exec(src);
    if (m === null) return undefined;

    let lines = stripTail(m[0], '\n').split('\n');
    let raw = '';
    let text = '';
    const children = [];

    while (lines.length > 0) {
      let marked = false;
      const chunk = [];
      let taken = 0;
      for (taken = 0; taken < lines.length; taken++) {
        if (quoteStart.test(lines[taken])) {
          chunk.push(lines[taken]);
          marked = true;
        } else if (!marked) {
          chunk.push(lines[taken]);
        } else {
          break;
        }
      }
      lines = lines.slice(taken);

      const chunkRaw = chunk.join('\n');
      const spaced = chunkRaw.indexOf('\t') < 0
        ? chunkRaw
        : chunkRaw.replace(quoteMarkerSpace, (whole, marker, spaces) =>
            marker + expandTabs(spaces, marker.length));
      const chunkText = spaced
        .replace(quoteSetext, '\n    $1')
        .replace(quoteStrip, '');

      raw = raw === '' ? chunkRaw : raw + '\n' + chunkRaw;
      text = text === '' ? chunkText : text + '\n' + chunkText;

      const wasTop = this.ctx.top;
      this.ctx.top = true;
      this.walk(chunkText, children, true);
      this.ctx.top = wasTop;

      if (lines.length === 0) break;

      const last = children[children.length - 1];
      if (last !== undefined && (
        last.type === 'code' || last.type === 'heading' || last.type === 'hr' ||
        last.type === 'html' || last.type === 'table'
      )) break;

      if (last !== undefined && last.type === 'blockquote') {
        const inner = last;
        const rest = lines.join('\n');
        const combined = inner.raw + '\n' + rest.replace(quoteStrip, '');
        const rebuilt = this.quote(combined);
        children[children.length - 1] = rebuilt;

        const leftover = combined.slice(rebuilt.raw.length).replace(/^\n/, '');
        const usedLines = leftover === '' ? 0 : leftover.split('\n').length;
        const consumed = usedLines > 0 ? lines.slice(0, -usedLines) : lines;
        if (consumed.length > 0) raw += '\n' + consumed.join('\n');

        text = text.slice(0, text.length - inner.text.length) + rebuilt.text;
        lines = lines.slice(consumed.length);
        if (lines.length > 0 && quoteStart.test(lines[0])) continue;
        break;
      }

      if (last !== undefined && last.type === 'list') {
        const inner = last;
        const combined = inner.raw + '\n' + lines.join('\n');
        const rebuilt = this.list(combined);
        children[children.length - 1] = rebuilt;
        const extra = rebuilt.raw.length > inner.raw.length
          ? combined.slice(inner.raw.length + 1, rebuilt.raw.length).split('\n').length
          : 0;
        if (extra > 0) {
          const chunkLines = lines.slice(0, extra).join('\n');
          raw += '\n' + chunkLines;
          text += '\n' + chunkLines;
        }
        lines = lines.slice(extra);
        continue;
      }
    }

    return { type: 'blockquote', raw, text, children };
  }

  list(src) {
    const first = B.list.exec(src);
    if (first === null) return undefined;

    const original = src;
    const used = () => original.length - src.length;
    let marker = first[1].trim();
    const ordered = marker.length > 1;
    const token = {
      type: 'list',
      raw: '',
      ordered,
      start: ordered ? +marker.slice(0, -1) : '',
      loose: false,
      items: [],
    };

    marker = ordered ? '\\d{1,9}\\' + marker.slice(-1) : '\\' + marker;
    const itemRe = listItemRx(marker);
    let doubleBlankSeen = false;

    while (src.length > 0) {
      let blank = false;
      let body = '';
      const m = itemRe.exec(src);
      if (m === null || B.hr.test(src)) break;

      const itemStart = used();
      src = src.slice(m[0].length);

      const headLine = firstLine(m[2]);
      const markerWidth = m[1].length;
      let indentExpanded = headLine.indexOf('\t') < 0
        ? headLine
        : headLine.replace(/^[ \t]+/, ws => expandTabs(ws, markerWidth));
      let following = firstLine(src);
      let empty = indentExpanded.trim() === '';
      let indent = 0;

      if (empty) {
        indent = markerWidth + 1;
      } else {
        indent = indentExpanded.search(nonSpace);
        if (indent > 4) indent = 1;
        body = indentExpanded.slice(indent);
        indent += markerWidth;
      }

      if (empty && blankOnly.test(following)) {
        src = src.slice(following.length + 1);
        blank = true;
      }

      if (!blank) {
        const p = lineProbe(indent);
        while (src.length > 0) {
          const line = firstLine(src);
          following = line;
          const expanded = line.indexOf('\t') < 0
            ? line
            : line.replace(/^[ \t]+/, ws => expandTabs(ws));

          const start = expanded.search(nonSpace);
          const first = start < 0 ? 10 : expanded.charCodeAt(start);

          if (
            ((first === 96 || first === 126) && p.fence.test(line)) ||
            (first === 35 && p.heading.test(line)) ||
            (first === 60 && p.html.test(line)) ||
            (first === 62 && p.quote.test(line)) ||
            ((first === 42 || first === 43 || first === 45 ||
              (first >= 48 && first <= 57)) && p.bullet.test(line)) ||
            ((first === 45 || first === 95 || first === 42) && p.rule.test(line))
          ) break;

          if (start >= indent || start < 0) {
            body += '\n' + expanded.slice(indent);
          } else {
            if (
              empty ||
              indentExpanded.replace(tabAll, '    ').search(nonSpace) >= 4 ||
              p.fence.test(indentExpanded) ||
              p.heading.test(indentExpanded) ||
              p.html.test(indentExpanded) ||
              p.rule.test(indentExpanded)
            ) break;

            const isSetext =
              setextLine.test(line) &&
              B.lheading.test(indentExpanded + '\n' + line);
            const cont = isSetext
              ? '    ' + expanded.replace(/^ {0,3}/, '')
              : line;
            body += '\n' + cont;
          }

          empty = start < 0;
          src = src.slice(line.length + 1);
          indentExpanded = expanded.slice(indent);
        }
      }

      const rawSlice = original.slice(itemStart, used());
      if (!token.loose) {
        if (doubleBlankSeen) token.loose = true;
        else if (blankPairAtEnd(rawSlice)) doubleBlankSeen = true;
      }

      token.items.push({
        type: 'list_item',
        raw: rawSlice,
        task: isTask.test(body),
        loose: false,
        text: body,
        children: [],
      });
    }

    const lastItem = token.items[token.items.length - 1];
    if (lastItem === undefined) return undefined;
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
    token.raw = original.slice(0, used()).trimEnd();

    for (const item of token.items) {
      this.ctx.top = false;
      item.children = this.walk(item.text, []);
      if (!token.loose) {
        let hasSpace = false;
        let spans = false;
        for (const t of item.children) {
          if (t.type === 'space') {
            hasSpace = true;
            const raw = t.raw;
            if (raw.indexOf('\n') !== raw.lastIndexOf('\n')) {
              spans = true;
              break;
            }
          }
        }
        token.loose = hasSpace && spans;
      }
    }

    for (const item of token.items) {
      const head = item.children[0];
      if (item.task && head !== undefined && (head.type === 'text' || head.type === 'paragraph')) {
        item.text = item.text.replace(stripTask, '');
        head.raw = head.raw.replace(stripTask, '');
        head.text = head.text.replace(stripTask, '');
        for (let i = this.ctx.jobs.length - 1; i >= 0; i--) {
          if (isTask.test(this.ctx.jobs[i].src)) {
            this.ctx.jobs[i].src = this.ctx.jobs[i].src.replace(stripTask, '');
            break;
          }
        }
        const box = taskBox.exec(item.raw);
        if (box !== null) {
          const checkbox = {
            type: 'checkbox',
            raw: box[0] + ' ',
            checked: box[0] !== '[ ]',
          };
          item.checked = checkbox.checked;
          if (token.loose) {
            const first = item.children[0];
            if (
              first !== undefined &&
              (first.type === 'paragraph' || first.type === 'text') &&
              first.children !== undefined
            ) {
              first.raw = checkbox.raw + first.raw;
              first.text = checkbox.raw + first.text;
              first.children.unshift(checkbox);
            } else {
              item.children.unshift({
                type: 'paragraph',
                raw: checkbox.raw,
                text: checkbox.raw,
                children: [checkbox],
              });
            }
          } else {
            item.children.unshift(checkbox);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }

    if (token.loose) {
      for (const item of token.items) {
        item.loose = true;
        for (const t of item.children) {
          if (t.type === 'text') t.type = 'paragraph';
        }
      }
    }

    return token;
  }

  html(src) {
    const m = B.html.exec(src);
    if (m === null) return undefined;
    const text = trimTrailingBlanks(m[0]);
    return {
      type: 'html',
      block: true,
      raw: text,
      pre: m[1] === 'pre' || m[1] === 'script' || m[1] === 'style',
      text,
    };
  }

  definition(src) {
    const m = B.def.exec(src);
    if (m === null) return undefined;
    if (m[2].charCodeAt(0) !== 60 && unbalanced(m[2], '(', ')') !== -1) return undefined;
    const href = m[2]
      ? m[2].replace(hrefAngle, '$1').replace(unescapePunct, '$1')
      : '';
    const title = m[3]
      ? m[3].slice(1, -1).replace(unescapePunct, '$1')
      : m[3];
    return {
      type: 'def',
      tag: normalizeLabel(m[1]),
      raw: stripTail(m[0], '\n'),
      href,
      title,
    };
  }

  table(src) {
    const m = B.table.exec(src);
    if (m === null || !tableDivider.test(m[2])) return undefined;

    const header = splitHeader(m[1]);
    const aligns = m[2].replace(tableEdgePipes, '').split('|');
    const rows = m[3] !== undefined && m[3].trim() !== ''
      ? m[3].replace(tableTail, '').split('\n')
      : [];
    const token = {
      type: 'table',
      raw: stripTail(m[0], '\n'),
      header: [],
      align: [],
      rows: [],
    };

    if (header.length !== aligns.length) return undefined;

    for (const cell of aligns) {
      if (rightAlign.test(cell)) token.align.push('right');
      else if (centerAlign.test(cell)) token.align.push('center');
      else if (leftAlign.test(cell)) token.align.push('left');
      else token.align.push(null);
    }

    for (let i = 0; i < header.length; i++) {
      token.header.push({
        text: header[i],
        children: this.inline.queue(header[i]),
        header: true,
        align: token.align[i],
      });
    }

    for (const row of rows) {
      token.rows.push(splitRow(row, token.header.length).map((text, i) => ({
        text,
        children: this.inline.queue(text),
        header: false,
        align: token.align[i],
      })));
    }

    return token;
  }

  setext(src) {
    const m = B.lheading.exec(src);
    if (m === null) return undefined;
    const text = m[1].trim();
    return {
      type: 'heading',
      raw: stripTail(m[0], '\n'),
      depth: m[2].charAt(0) === '=' ? 1 : 2,
      text,
      children: this.inline.queue(text),
    };
  }

  paragraph(src) {
    const m = B.paragraph.exec(src);
    if (m === null) return undefined;
    const text = m[1].charCodeAt(m[1].length - 1) === 10 ? m[1].slice(0, -1) : m[1];
    return {
      type: 'paragraph',
      raw: m[0],
      text,
      children: this.inline.queue(text),
    };
  }

  plainText(src) {
    const m = B.textLine.exec(src);
    if (m === null) return undefined;
    return {
      type: 'text',
      raw: m[0],
      text: m[0],
      children: this.inline.queue(m[0]),
    };
  }
}

import { splitCells } from './util.js';

function splitHeader(line) {
  return splitCells(line, 0);
}

function splitRow(line, width) {
  return splitCells(line, width);
}

// True when the slice ends in a newline, optional blanks, another newline and
// optional trailing blanks: the blank-line pair that makes a list loose.
function blankPairAtEnd(text) {
  let i = text.length - 1;
  while (i >= 0) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) break;
    i--;
  }
  if (i < 0 || text.charCodeAt(i) !== 10) return false;
  i--;
  while (i >= 0) {
    const c = text.charCodeAt(i);
    if (c !== 32 && c !== 9) break;
    i--;
  }
  return i >= 0 && text.charCodeAt(i) === 10;
}

// A table is only possible when the second physical line carries the divider
// syntax; otherwise the expensive table rule can be skipped entirely.
function maybeTable(text) {
  const first = text.indexOf('\n');
  if (first < 0) return false;
  const second = text.indexOf('\n', first + 1);
  const end = second < 0 ? text.length : second;
  for (let i = first + 1; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === 124 || c === 58) return true;
  }
  return false;
}

