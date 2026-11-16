// Inline tokenizer: text, escapes, entities, code spans, emphasis, links,
// images, raw HTML, autolinks, strikethrough and hard breaks.

import { inlineRx as R } from './patterns.js';
import {
  decodeEntities,
  normalizeLabel,
  surveyClosers,
  unbalanced,
  stripTail,
} from './util.js';

const specialLead = new Uint8Array(128);
for (const code of [32, 33, 42, 60, 91, 92, 95, 96, 126]) specialLead[code] = 1;

const unescapeBrackets = /\\([\[\]])/g;
const newlines = /\n/g;
const alnum = /[\p{L}\p{N}]/u;

function firstUnitLength(text) {
  if (text.length === 0) return 0;
  const c = text.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdbff && text.length > 1) {
    const d = text.charCodeAt(1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

function absorb(tokens, tok) {
  const last = tokens[tokens.length - 1];
  if (tok.type === 'text' && last !== undefined && last.type === 'text') {
    last.raw += tok.raw;
    last.text += tok.text;
  } else {
    tokens.push(tok);
  }
}

const tickRun = /`/g;
const delimTest = /[*_~]/;

export class InlineParser {
  constructor(ctx) {
    this.ctx = ctx;
    this.masks = [];
  }

  queue(src, tokens = []) {
    this.ctx.jobs.push({ src, tokens });
    return tokens;
  }

  replay() {
    const jobs = this.ctx.jobs;
    for (let i = 0; i < jobs.length; i++) {
      this.ctx.inRaw = false;
      this.runTokens(jobs[i].src, jobs[i].tokens);
    }
    this.ctx.jobs = [];
  }

  hasLink(text) {
    if (text.indexOf('[') < 0) return false;
    R.blockSkip.lastIndex = 0;
    let m;
    while ((m = R.blockSkip.exec(text)) !== null) {
      if (R.link.test(m[0]) && text.charAt(m.index - 1) !== '!') return true;
      if (R.blockSkip.lastIndex === m.index) R.blockSkip.lastIndex++;
    }
    R.reflinkSearch.lastIndex = 0;
    while ((m = R.reflinkSearch.exec(text)) !== null) {
      const piece = m[0];
      const at = piece.lastIndexOf('[');
      const defs = this.ctx.defs;
      if (!Object.prototype.hasOwnProperty.call(defs, normalizeLabel(piece.slice(at + 1, -1)))) {
        if (R.reflinkSearch.lastIndex === m.index) R.reflinkSearch.lastIndex++;
        continue;
      }
      if (piece.charAt(0) !== '!') {
        if (!(at > 1 && this.hasLink(piece.slice(1, at - 1)))) return true;
      }
      if (R.reflinkSearch.lastIndex === m.index) R.reflinkSearch.lastIndex++;
    }
    return false;
  }

  mask(src) {
    const hasBracket = src.indexOf('[') >= 0;
    const hasTick = src.indexOf('`') >= 0;
    const hasSlash = src.indexOf('\\') >= 0;
    const hasTag = src.indexOf('<') >= 0;
    if (!hasBracket && !hasTick && !hasSlash && !hasTag) return src;

    let out = src;
    if (hasBracket && this.ctx.defCount > 0) {
      const rewrite = text => {
        const at = text.lastIndexOf('[');
        if (!Object.prototype.hasOwnProperty.call(this.ctx.defs, normalizeLabel(text.slice(at + 1, -1)))) {
          return text;
        }
        if (at > 1 && text.charAt(0) !== '!') {
          const inner = text.slice(1, at - 1);
          if (this.hasLink(inner)) {
            return '[' + inner.replace(R.reflinkSearch, rewrite) + '][' +
              'a'.repeat(text.length - at - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(text.length - 2) + ']';
      };
      out = out.replace(R.reflinkSearch, rewrite);
    }
    if (hasTick || hasSlash) {
      out = out.replace(R.anyPunctOutsideCode, (whole, ticks, escaped) => {
        if (escaped) return '+'.repeat(whole.length);
        if (ticks) {
          return ticks + whole.slice(ticks.length, -ticks.length).replace(tickRun, '+') + ticks;
        }
        return whole;
      });
    }
    if (hasBracket || hasTag || hasTick) {
      out = out.replace(R.blockSkip, whole => {
        return '[' + 'a'.repeat(whole.length - 2) + ']';
      });
    }
    return out;
  }

  lastCloser(masked, ch) {
    const top = this.masks[this.masks.length - 1];
    if (top && top.text === masked) {
      return ch === 42 ? top.star : ch === 95 ? top.under : top.tilde;
    }
    const scan = surveyClosers(masked);
    return ch === 42 ? scan.star : ch === 95 ? scan.under : scan.tilde;
  }

  runTokens(src, tokens) {
    const savedParen = this.ctx.parenPossible;
    this.ctx.parenPossible = savedParen && src.indexOf(')') >= 0;
    try {
      const needsMask = delimTest.test(src);
      const masked = needsMask ? this.mask(src) : src;
      if (needsMask) this.masks.push(surveyClosers(masked));
      try {
        return this.scan(src, masked, tokens);
      } finally {
        if (needsMask) this.masks.pop();
      }
    } finally {
      this.ctx.parenPossible = savedParen;
    }
  }

  scan(src, masked, tokens) {
    let prev = '';
    let inText = false;
    let guard = Infinity;

    while (src.length > 0) {
      if (src.length < guard) guard = src.length;
      else {
        throw new Error('inline scanner stalled at ' + src.charCodeAt(0));
      }
      if (!inText) prev = '';
      inText = false;

      const lead = src.charCodeAt(0);
      if (lead >= 128 || specialLead[lead] === 0) {
        let tok = this.ctx.inLink ? undefined : this.tryUrl(src);
        if (tok) {
          src = src.slice(tok.raw.length);
          tokens.push(tok);
          continue;
        }
        tok = this.text(src);
        if (tok) {
          src = src.slice(tok.raw.length);
          if (tok.raw.charCodeAt(tok.raw.length - 1) !== 95) prev = tok.raw.slice(-1);
          inText = true;
          const last = tokens[tokens.length - 1];
          if (last !== undefined && last.type === 'text') {
            last.raw += tok.raw;
            last.text += tok.text;
          } else {
            tokens.push(tok);
          }
          continue;
        }
      }

      // Dispatch on the leading byte: every special start has a tiny set of
      // possible token kinds, so the full tokenizer chain is not needed.
      if (lead < 128) {
        let piece;
        if (lead === 92) {
          piece = this.escape(src);
          if (piece === undefined) piece = this.hardBreak(src);
        } else if (lead === 60) {
          piece = this.tag(src);
          if (piece === undefined) piece = this.autoLink(src);
        } else if (lead === 91 || lead === 33) {
          piece = this.link(src);
          if (piece === undefined) piece = this.refLink(src);
        } else if (lead === 96) {
          piece = this.codeSpan(src);
        } else if (lead === 42 || lead === 95) {
          piece = this.emphasis(src, masked, prev);
        } else if (lead === 126) {
          piece = this.strike(src, masked, prev);
        } else {
          piece = this.hardBreak(src);
        }
        if (piece === undefined) piece = this.text(src);
        if (piece === undefined) {
          throw new Error('inline scanner stalled at ' + src.charCodeAt(0));
        }
        src = src.slice(piece.raw.length);
        if (piece.type === 'text') {
          if (piece.raw.charCodeAt(piece.raw.length - 1) !== 95) {
            prev = piece.raw.slice(-1);
          }
          inText = true;
        }
        absorb(tokens, piece);
        continue;
      }

      let tok = this.escape(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.tag(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.link(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.refLink(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        const last = tokens[tokens.length - 1];
        if (tok.type === 'text' && last !== undefined && last.type === 'text') {
          last.raw += tok.raw;
          last.text += tok.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }
      tok = this.emphasis(src, masked, prev);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.codeSpan(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.hardBreak(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.strike(src, masked, prev);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      tok = this.autoLink(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        tokens.push(tok);
        continue;
      }
      if (!this.ctx.inLink) {
        tok = this.tryUrl(src);
        if (tok) {
          src = src.slice(tok.raw.length);
          tokens.push(tok);
          continue;
        }
      }
      tok = this.text(src);
      if (tok) {
        src = src.slice(tok.raw.length);
        if (tok.raw.charCodeAt(tok.raw.length - 1) !== 95) prev = tok.raw.slice(-1);
        inText = true;
        const last = tokens[tokens.length - 1];
        if (last !== undefined && last.type === 'text') {
          last.raw += tok.raw;
          last.text += tok.text;
        } else {
          tokens.push(tok);
        }
        continue;
      }
      throw new Error('inline scanner stalled at ' + src.charCodeAt(0));
    }
    return tokens;
  }

  escape(src) {
    const m = R.escape.exec(src);
    if (m !== null) return { type: 'escape', raw: m[0], text: m[1] };
    return undefined;
  }

  tag(src) {
    const m = R.tag.exec(src);
    if (m === null) return undefined;
    const ctx = this.ctx;
    const value = m[0];
    if (!ctx.inLink && /^<a /i.test(value)) ctx.inLink = true;
    else if (ctx.inLink && /^<\/a>/i.test(value)) ctx.inLink = false;
    if (!ctx.inRaw && /^<(pre|code|kbd|script)(\s|>)/i.test(value)) ctx.inRaw = true;
    else if (ctx.inRaw && /^<\/(pre|code|kbd|script)(\s|>)/i.test(value)) ctx.inRaw = false;
    return {
      type: 'html',
      raw: value,
      inLink: ctx.inLink,
      inRaw: ctx.inRaw,
      block: false,
      text: value,
    };
  }

  labelHasTag(src, label, offset) {
    if (label.indexOf('<') < 0) return false;
    for (let i = 0; i < label.length; i++) {
      const ch = label[i];
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '`') {
        const code = R.code.exec(label.slice(i));
        if (code) {
          i += code[0].length - 1;
          continue;
        }
      }
      if (ch !== '<') continue;
      const rest = src.slice(offset + i);
      const tag = R.tag.exec(rest) || R.autolink.exec(rest);
      if (tag) {
        if (tag[0].length > label.length - i) return true;
        i += tag[0].length - 1;
      }
    }
    return false;
  }

  link(src) {
    if (this.ctx.parenPossible === false) return undefined;
    const m = R.link.exec(src);
    if (m === null) return undefined;
    const offset = m[0].charAt(0) === '!' ? 2 : 1;
    if (this.labelHasTag(src, m[1], offset)) return undefined;

    let hrefPart = m[2].trim();
    if (hrefPart.charCodeAt(0) === 60) {
      if (hrefPart.charCodeAt(hrefPart.length - 1) !== 62) return undefined;
      const without = stripTail(hrefPart.slice(0, -1), '\\');
      if ((hrefPart.length - without.length) % 2 === 0) return undefined;
    } else {
      const bad = unbalanced(m[2], '(', ')');
      if (bad === -2) return undefined;
      if (bad > -1) {
        const cut = (m[0].charAt(0) === '!' ? 5 : 4) + m[1].length + bad;
        m[2] = m[2].slice(0, bad);
        m[0] = m[0].slice(0, cut).trim();
        m[3] = undefined;
      }
    }

    const trimmed = stripTail(m[0].slice(0, -1), '\\');
    if ((m[0].length - trimmed.length) % 2 === 0) return undefined;

    let href = m[2].trim();
    if (href.charCodeAt(0) === 60) href = href.slice(1, -1);
    let title = '';
    if (m[3]) title = m[3].slice(1, -1);

    return this.makeLink(
      m,
      {
        href: href && href.replace(R.anyPunct, '$1'),
        title: title && title.replace(R.anyPunct, '$1'),
      },
      m[0],
    );
  }

  refLink(src) {
    const m = R.reflink.exec(src) || R.nolink.exec(src);
    if (m === null) return undefined;
    const offset = m[0].charAt(0) === '!' ? 2 : 1;
    if (this.labelHasTag(src, m[1], offset)) return undefined;
    const target = this.ctx.defs[normalizeLabel(m[2] || m[1])];
    if (target === undefined) {
      const ch = m[0].charAt(0);
      return { type: 'text', raw: ch, text: ch };
    }
    return this.makeLink(m, target, m[0]);
  }

  makeLink(m, target, raw) {
    const label = m[1].replace(unescapeBrackets, '$1');
    const isImage = m[0].charAt(0) === '!';
    const ctx = this.ctx;
    const wasInLink = ctx.inLink;
    const hadEmitted = ctx.linkDone;
    const wasRaw = ctx.inRaw;

    ctx.inLink = true;
    ctx.linkDone = false;
    const children = this.runTokens(label, []);
    const emitted = ctx.linkDone;

    ctx.linkDone = hadEmitted;
    ctx.inLink = wasInLink;

    if (!isImage) {
      if (emitted) {
        ctx.inRaw = wasRaw;
        return undefined;
      }
      ctx.linkDone = true;
    }

    return {
      type: isImage ? 'image' : 'link',
      raw,
      href: target.href,
      title: target.title || null,
      text: label,
      children,
    };
  }

  emphasis(src, masked, prev) {
    const open = R.emLeft.exec(src);
    if (open === null || (!open[1] && !open[2] && !open[3] && !open[4])) {
      return undefined;
    }

    const ch = open[0].charAt(0);
    const same = prev === ch;
    const offset = masked.length - src.length;
    let start = offset;
    while (start > 0 && masked.charCodeAt(start - 1) === ch.charCodeAt(0)) start--;

    let before = '';
    if (start > 0) {
      const unit = masked.charCodeAt(start - 1);
      if (unit >= 0xdc00 && unit <= 0xdfff && start > 1) {
        const high = masked.charCodeAt(start - 2);
        before = high >= 0xd800 && high <= 0xdbff
          ? masked.slice(start - 2, start)
          : masked.slice(start - 1, start);
      } else {
        before = masked.slice(start - 1, start);
      }
    }
    const beforePunct =
      before === '*' || before === '_' || R.punctuation.test(before);
    let prevPunct;
    if (start < offset) {
      prev = before;
      prevPunct = beforePunct;
    } else {
      prevPunct = R.punctuation.test(prev);
    }

    if (open[4] && alnum.test(prev)) return undefined;

    const marker = open[1] || open[3] || '';
    if (marker && prev && !prevPunct) return undefined;

    let leftLen = 0;
    while (open[0].charCodeAt(leftLen) === ch.charCodeAt(0)) leftLen++;
    const leftTotal = offset - start + leftLen;
    let remaining = leftLen;
    let carry = 0;
    const rightish =
      before.trim().length > 0 && (marker !== '' || (ch === '*' && !beforePunct));

    if (ch !== '*' && ch !== '_') return undefined;

    const closer = ch === '*' ? R.emRightStar : R.emRightUnderscore;
    const last = this.lastCloser(masked, ch.charCodeAt(0));
    const closeStart = offset + leftLen;
    if (last < closeStart) return undefined;

    const hay = masked.slice(closeStart);
    const limit = last - closeStart;
    closer.lastIndex = 0;
    let m;
    while ((m = closer.exec(hay)) !== null && !(m.index > limit)) {
      const run = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!run) continue;
      let size = run.length;

      if (m[3] || m[4]) {
        remaining += size;
        continue;
      }
      if (m[5] || m[6] || rightish) {
        if (same && (m[5] || m[6])) break;
        if (leftTotal % 3 && !((leftTotal + size) % 3)) {
          carry += size;
          continue;
        }
      }

      remaining -= size;
      if (remaining > 0) continue;

      size = Math.min(size, size + remaining + carry);
      const rawEnd = leftLen + m.index + firstUnitLength(m[0]) + size;
      const raw = src.slice(0, rawEnd);

      if (Math.min(leftLen, size) % 2) {
        const inner = raw.slice(1, -1);
        return { type: 'em', raw, text: inner, children: this.runTokens(inner, []) };
      }
      const inner = raw.slice(2, -2);
      return { type: 'strong', raw, text: inner, children: this.runTokens(inner, []) };
    }
    return undefined;
  }

  strike(src, masked, prev) {
    const open = R.delLeft.exec(src);
    if (open === null) return undefined;
    if ((open[1] || '') && prev && !R.punctuation.test(prev)) return undefined;

    let openLen = 0;
    while (open[0].charCodeAt(openLen) === 126) openLen++;
    let remaining = openLen;
    const last = this.lastCloser(masked, 126);
    const closeStart = masked.length - src.length + openLen;
    if (last < closeStart) return undefined;

    const hay = masked.slice(closeStart);
    const limit = last - closeStart;
    R.delRight.lastIndex = 0;
    let m;
    while ((m = R.delRight.exec(hay)) !== null && !(m.index > limit)) {
      const run = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!run) continue;
      const size = run.length;
      if (size !== openLen) continue;
      if (m[3] || m[4]) {
        remaining += size;
        continue;
      }
      remaining -= size;
      if (remaining > 0) continue;

      const rawEnd = openLen + m.index + firstUnitLength(m[0]) + size;
      const raw = src.slice(0, rawEnd);
      const inner = raw.slice(openLen, -openLen);
      return { type: 'del', raw, text: inner, children: this.runTokens(inner, []) };
    }
    return undefined;
  }

  codeSpan(src) {
    const m = R.code.exec(src);
    if (m === null) return undefined;
    let text = m[2].replace(newlines, ' ');
    const content = /[^ ]/.test(text);
    if (content && text.charCodeAt(0) === 32 && text.charCodeAt(text.length - 1) === 32) {
      text = text.slice(1, -1);
    }
    return { type: 'code', raw: m[0], text };
  }

  hardBreak(src) {
    const m = R.br.exec(src);
    if (m !== null) return { type: 'br', raw: m[0] };
    return undefined;
  }

  autoLink(src) {
    const m = R.autolink.exec(src);
    if (m === null) return undefined;
    let text;
    let href;
    if (m[2] === '@') {
      text = m[1];
      href = 'mailto:' + text;
    } else {
      text = m[1];
      href = text;
    }
    return {
      type: 'link',
      raw: m[0],
      text,
      href,
      autolink: true,
      children: [{ type: 'text', raw: text, text }],
    };
  }

  tryUrl(src) {
    const m = R.url.exec(src);
    if (m === null) return undefined;
    let text;
    let href;
    if (m[2] === '@') {
      text = m[0];
      href = 'mailto:' + text;
    } else {
      let before;
      do {
        before = m[0];
        const pedaled = R.backpedal.exec(m[0]);
        m[0] = pedaled === null ? '' : pedaled[0];
      } while (before !== m[0]);
      text = m[0];
      href = m[1] === 'www.' ? 'http://' + text : text;
    }
    return {
      type: 'link',
      raw: m[0],
      text,
      href,
      autolink: true,
      children: [{ type: 'text', raw: text, text }],
    };
  }

  text(src) {
    const m = R.textGfm.exec(src);
    if (m === null) return undefined;
    const raw = m[0];
    const inRaw = this.ctx.inRaw;
    return {
      type: 'text',
      raw,
      text: inRaw ? raw : decodeEntities(raw),
      escaped: inRaw,
    };
  }
}
