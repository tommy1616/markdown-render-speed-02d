// Token tree to HTML.  Mirrors marked's default GFM renderer byte for byte.

import { escapeHtml } from './util.js';

function encodeHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

function renderInline(tokens, plain) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'escape':
        out += plain ? token.text : escapeHtml(token.text, false);
        break;
      case 'html':
        out += token.text;
        break;
      case 'link':
        out += plain
          ? token.children ? renderInline(token.children, true) : token.text
          : renderLink(token);
        break;
      case 'image':
        out += plain
          ? token.children ? renderInline(token.children, true) : token.text
          : renderImage(token);
        break;
      case 'checkbox':
        out += plain ? token.raw : renderCheckbox(token);
        break;
      case 'strong':
        out += plain
          ? renderInline(token.children, true)
          : '<strong>' + renderInline(token.children, false) + '</strong>';
        break;
      case 'em':
        out += plain
          ? renderInline(token.children, true)
          : '<em>' + renderInline(token.children, false) + '</em>';
        break;
      case 'del':
        out += plain
          ? renderInline(token.children, true)
          : '<del>' + renderInline(token.children, false) + '</del>';
        break;
      case 'code':
        out += plain ? token.text : '<code>' + escapeHtml(token.text, true) + '</code>';
        break;
      case 'br':
        out += plain ? '' : '<br>';
        break;
      case 'text':
      default:
        out += renderText(token, plain);
        break;
    }
  }
  return out;
}

function renderText(token, plain) {
  if (token.children !== undefined) return renderInline(token.children, plain);
  if (token.escaped === true) return token.text;
  return plain ? token.text : escapeHtml(token.text, false);
}

function renderLink(token) {
  const label = token.autolink
    ? escapeHtml(token.text, true)
    : renderInline(token.children, false);
  const encoded = encodeHref(token.href);
  if (encoded === null) return label;
  const href = escapeHtml(encoded, token.autolink);
  let out = '<a href="' + href + '"';
  if (token.title) out += ' title="' + escapeHtml(token.title, false) + '"';
  return out + '>' + label + '</a>';
}

function renderImage(token) {
  let alt = token.text;
  if (token.children !== undefined) alt = renderInline(token.children, true);
  const encoded = encodeHref(token.href);
  if (encoded === null) return escapeHtml(alt, false);
  let out = '<img src="' + escapeHtml(encoded, false) + '" alt="' + escapeHtml(alt, false) + '"';
  if (token.title) out += ' title="' + escapeHtml(token.title, false) + '"';
  return out + '>';
}

function renderCheckbox(token) {
  return '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderCode(token) {
  const info = token.lang || '';
  const lang = /^\S*/.exec(info)[0];
  const body = token.text ? token.text.replace(/\n$/, '') + '\n' : '';
  const escaped = escapeHtml(body, true);
  if (lang) {
    return '<pre><code class="language-' + escapeHtml(lang, false) + '">' + escaped + '</code></pre>\n';
  }
  return '<pre><code>' + escaped + '</code></pre>\n';
}

function renderCell(cell) {
  const tag = cell.header ? 'th' : 'td';
  const align = cell.align ? ' align="' + cell.align + '"' : '';
  return '<' + tag + align + '>' + renderInline(cell.children, false) + '</' + tag + '>\n';
}

function renderTable(token) {
  let head = '';
  for (let i = 0; i < token.header.length; i++) head += renderCell(token.header[i]);
  head = '<tr>\n' + head + '</tr>\n';

  let body = '';
  for (let r = 0; r < token.rows.length; r++) {
    const row = token.rows[r];
    let cells = '';
    for (let c = 0; c < row.length; c++) cells += renderCell(row[c]);
    body += '<tr>\n' + cells + '</tr>\n';
  }
  if (body) body = '<tbody>' + body + '</tbody>';

  return '<table>\n<thead>\n' + head + '</thead>\n' + body + '</table>\n';
}

function renderList(token) {
  let items = '';
  for (let i = 0; i < token.items.length; i++) {
    items += '<li>' + renderBlocks(token.items[i].children) + '</li>\n';
  }
  const tag = token.ordered ? 'ol' : 'ul';
  const start = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
  return '<' + tag + start + '>\n' + items + '</' + tag + '>\n';
}

export function renderBlocks(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'space':
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'heading':
        out += '<h' + token.depth + '>' + renderInline(token.children, false) + '</h' + token.depth + '>\n';
        break;
      case 'code':
        out += renderCode(token);
        break;
      case 'table':
        out += renderTable(token);
        break;
      case 'blockquote':
        out += '<blockquote>\n' + renderBlocks(token.children) + '</blockquote>\n';
        break;
      case 'list':
        out += renderList(token);
        break;
      case 'checkbox':
        out += renderCheckbox(token);
        break;
      case 'html':
        out += token.text;
        break;
      case 'def':
        break;
      case 'paragraph':
        out += '<p>' + renderInline(token.children, false) + '</p>\n';
        break;
      case 'text':
      default:
        out += renderText(token, false);
        break;
    }
  }
  return out;
}
