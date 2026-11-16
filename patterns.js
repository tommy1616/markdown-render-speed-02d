// GFM grammar fragments shared by the block and inline scanners.  Every
// regular expression is assembled once at module load.

const TICK = '`';

const TAGNAMES = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h[1-6]', 'head', 'header', 'hr', 'html', 'iframe',
  'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'meta', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr',
  'track', 'ul',
].join('|');

const COMMENT_BLOCK = '<!--(?:-?>|[\\s\\S]*?(?:-->|$))';
const COMMENT_INLINE = '<!--(?:-?>|[\\s\\S]*?-->)';

const ATTR_BLOCK =
  ' +[a-zA-Z:_][\\w.:-]*(?: *= *"[^"\\n]*"| *= *\'[^\'\\n]*\'| *= *[^\\s"\'=<>' +
  TICK + ']+)?';

const ATTR_INLINE =
  '\\s+[a-zA-Z:_][\\w.:-]*(?:\\s*=\\s*"[^"]*"|\\s*=\\s*\'[^\']*\'|\\s*=\\s*[^\\s"\'=<>' +
  TICK + ']+)?';

const HR_FRAG = '(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,}';
const HR_GROUP = ' {0,3}(' + HR_FRAG + ')(?:\\n+|$)';
const HR_PLAIN = ' {0,3}(?:' + HR_FRAG + ')(?:\\n+|$)';
const BULLET = ' {0,3}(?:[*+-]|\\d{1,9}[.)])';

const HEAD_START = ' {0,3}#{1,6}(?:\\s|$)';
const QUOTE_START = ' {0,3}>';
const FENCE_START =
  ' {0,3}(?:' + TICK + '{3,}(?=[^' + TICK + '\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)';
const HTML_START =
  ' {0,3}(?:</?(?:' + TAGNAMES + ')(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';

const LIST_PARA_QUOTE = BULLET + '(?:[ \\t]|\\n|$)';
const LIST_PARA_TABLE = ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]';

const LHEAD_HTML = ' {0,3}<[^\\n>]+>\\n';
const LHEAD_TABLE = ' {0,3}\\|?(?:[:\\- ]*\\|)+[:\\- ]*\\n';

function paragraphCore(listAlt) {
  return (
    '^([^\\n]+(?:\\n(?!' +
    HR_GROUP +
    '|' + HEAD_START +
    '|' + QUOTE_START +
    '|' + FENCE_START +
    '|' + listAlt +
    '|' + HTML_START +
    '|[ \\t]+\\n)[^\\n]+)*)'
  );
}

const TABLE_CORE =
  '^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|' +
  HR_GROUP +
  '|' + HEAD_START +
  '|' + QUOTE_START +
  '|(?: {4}| {0,3}\\t)[^\\n]' +
  '|' + FENCE_START +
  '| {0,3}(?:[*+-]|1[.)])[ \\t]' +
  '|' + HTML_START +
  ').*(?:\\n|$))*)\\n*|$)';

const TABLE_FRAG = TABLE_CORE.slice(1);

const PARA_TABLE = new RegExp(
  paragraphCore(LIST_PARA_TABLE).replace(
    '|[ \\t]+\\n',
    '|' + TABLE_FRAG + '|[ \\t]+\\n',
  ),
);

const PARA_QUOTE = new RegExp(paragraphCore(LIST_PARA_QUOTE));

const LHEAD_HEAD =
  '^(?!' + BULLET + ' |(?: {4}| {0,3}\\t)| {0,3}(?:' + TICK + '{3,}|~{3,})| {0,3}>|' +
  ' {0,3}#{1,6}(?:\\s|$)|' + LHEAD_HTML;

const LHEAD_BODY =
  '((?:.|\\n(?!\\s*?\\n|' + BULLET + ' | {0,3}(?:' + TICK + '{3,}|~{3,})| {0,3}>|' +
  ' {0,3}#{1,6}(?:\\s|$)|' + HR_PLAIN + '|' + LHEAD_HTML;

const LHEAD_TAIL = '))+?)\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)';

const LHEAD_TABLE_RX = new RegExp(
  LHEAD_HEAD + '|' + LHEAD_TABLE + ')' + LHEAD_BODY + '|' + LHEAD_TABLE + LHEAD_TAIL,
);

const LHEAD_PLAIN_RX = new RegExp(LHEAD_HEAD + ')' + LHEAD_BODY + LHEAD_TAIL);

const DEF_LABEL =
  '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\\\n]|\\n(?![ \\t]*\\n))+';
const DEF_TITLE =
  '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\\\n]|\\n(?!\\n))*\'|\\((?:\\\\[\\s\\S]|[^()\\\\])*\\)';

export const blockRx = {
  blank: /^(?:[ \t]*(?:\n|$))+/,
  textLine: /^[^\n]+/,
  code: /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,
  fence: new RegExp(
    '^ {0,3}(' + TICK + '{3,}(?=[^' + TICK + '\\n]*(?:\\n|$))|~{3,})([^\\n]*)(?:\\n|$)(?:|([\\s\\S]*?)(?:\\n|$))(?: {0,3}(?:(?=' + TICK + ')\\1' + TICK + '*|(?=~)\\1~*) *(?=\\n|$)|$)',
  ),
  hr: new RegExp('^' + HR_GROUP),
  heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,
  list: new RegExp('^(' + BULLET + ')([ \\t][^\\n]*?)?(?:\\n|$)'),
  html: new RegExp(
    '^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|' +
    COMMENT_BLOCK + '[^\\n]*(\\n+|$)' +
    '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)' +
    '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)' +
    '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)' +
    '|</?(?:' + TAGNAMES + ')(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)' +
    '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:' + ATTR_BLOCK +
    ')*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$)' +
    '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \\t]*)+\\n|$))',
    'i',
  ),
  def: new RegExp(
    '^ {0,3}\\[' + '(' + DEF_LABEL + ')' + '\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(' +
    DEF_TITLE + '))? *(?:\\n+|$)',
  ),
  table: new RegExp(TABLE_CORE),
  lheading: LHEAD_TABLE_RX,
  lheadingPlain: LHEAD_PLAIN_RX,
  paragraph: PARA_TABLE,
  paragraphQuote: PARA_QUOTE,
  blockquote: new RegExp(
    '^( {0,3}> ?(?:(?![ \\t]*(?:\\n|$))(' + PARA_QUOTE.source.slice(1) +
    ')|[^\\n]*)(?:\\n|$))+',
  ),
};

// -------------------------------------------------------------- inline rules

const PUNCT = '[\\p{P}\\p{S}]';
const PUNCT_NO_TILDE = '(?!~)[\\p{P}\\p{S}]';
const PUNCT_SPACE = '[\\s\\p{P}\\p{S}]';
const PUNCT_SPACE_NO_TILDE = '(?!~)[\\s\\p{P}\\p{S}]';
const NON_PUNCT_SPACE = '[^\\s\\p{P}\\p{S}]';
const NON_PUNCT_SPACE_OR_TILDE = '(?:[^\\s\\p{P}\\p{S}]|~)';

const HTTP = '[hH][tT][tT][pP][sS]?|[fF][tT][pP]';
const EMAIL =
  "[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])";
const URL_EMAIL =
  "[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])";
const EMAIL_PROTO =
  '(?:mailto:' + EMAIL + '|xmpp:' + EMAIL + '(?:\\/[A-Za-z0-9@.]+)?)';
const AUTOLINK_EMAIL =
  "[A-Za-z0-9.!#$%&'*+\\/=?_" + TICK + "{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])";

const LABEL =
  '(?:\\[(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|' +
  TICK + '+(?!' + TICK + ')[^' + TICK + ']*?' + TICK + '+(?!' + TICK + ')|' +
  TICK + TICK + '+(?=\\])|[^\\[\\]\\\\' + TICK + '])*?';

const LINK_TITLE =
  '"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\'|\\((?:\\\\[\\s\\S]|[^)\\\\])*\\)';

const LINK_HREF =
  '<(?:[\\\\].|[^\\n<>\\\\])+>|[^ \\t\\n\\x00-\\x1f]+|(?=\\))';

const REF_LABEL =
  '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\\\n]|\\n(?![ \\t]*\\n))+';
const REF_TEXT = '(?!\\s*\\])(?:\\\\[\\s\\S]|[^\\[\\]\\\\]){1,999}';

const REF_SEARCH_LABEL =
  '(?:[^\\[\\]\\\\' + TICK + ']*(?:\\[(?:\\[(?:\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|' +
  TICK + '+(?!' + TICK + ')[^' + TICK + ']*?' + TICK + '+(?!' + TICK + ')|' +
  TICK + TICK + '+(?=\\]))){0,999}?[^\\[\\]\\\\' + TICK + ']*?';

const SKIP_LINK =
  '\\[(?:[^\\[\\]' + TICK + ']|(?<a>' + TICK + '+)[^' + TICK + ']+\\k<a>(?!' + TICK +
  '))*?\\]\\((?:\\\\[\\s\\S]|[^\\\\()]|\\((?:\\\\[\\s\\S]|[^\\\\()])*\\))*\\)';
const SKIP_CODE =
  '(?<b>' + TICK + '+)[^' + TICK + ']+\\k<b>(?!' + TICK + ')';

const TEXT_GFM =
  '^(?:[^a-zA-Z0-9](?=(?:mailto|xmpp):)|(' + TICK + '+|~+|[^' + TICK + '~])(?:(?=[' +
  TICK + '~])|(?= {2,}\\n)|(?=[a-zA-Z0-9.!#$%&\'*+\\/=?_' + TICK + '{\\|}~-]+@)|[\\s\\S]*?(?:(?=[\\\\<!\\[' +
  TICK + '*~_]|\\b_|[hH][tT][tT][pP][sS]?|[fF][tT][pP]:\\/\\/|(?<![^\\s*_~(])www\\.|$)|[^ ](?= {2,}\\n)|[^a-zA-Z0-9](?=(?:mailto|xmpp):)|[^a-zA-Z0-9.!#$%&\'*+\\/=?_' +
  TICK + '{\\|}~-](?=[a-zA-Z0-9.!#$%&\'*+\\/=?_' + TICK + '{\\|}~-]+@))))';

const EM_LEFT =
  '^(?:\\*+(?:((?!\\*)' + PUNCT_NO_TILDE + ')|([^\\s*]))?)|^_+(?:((?!_)' + PUNCT_NO_TILDE + ')|([^\\s_]))?';

const EM_RIGHT_STAR =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)' + PUNCT_NO_TILDE +
  '(\\*+)(?=[\\s]|$)|' + NON_PUNCT_SPACE_OR_TILDE + '(\\*+)(?!\\*)(?=' +
  PUNCT_SPACE_NO_TILDE + '|$)|(?!\\*)' + PUNCT_SPACE_NO_TILDE + '(\\*+)(?=' +
  NON_PUNCT_SPACE_OR_TILDE + ')|[\\s](\\*+)(?!\\*)(?=' + PUNCT_NO_TILDE +
  ')|(?!\\*)' + PUNCT_NO_TILDE + '(\\*+)(?!\\*)(?=' + PUNCT_NO_TILDE +
  ')|' + NON_PUNCT_SPACE_OR_TILDE + '(\\*+)(?=' + NON_PUNCT_SPACE_OR_TILDE + ')';

const EM_RIGHT_UNDER =
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)' + PUNCT +
  '(_+)(?=[\\s]|$)|' + NON_PUNCT_SPACE + '(_+)(?!_)(?=' + PUNCT_SPACE +
  '|$)|(?!_)' + PUNCT_SPACE + '(_+)(?=' + NON_PUNCT_SPACE +
  ')|[\\s](_+)(?!_)(?=' + PUNCT + ')|(?!_)' + PUNCT +
  '(_+)(?!_)(?=' + PUNCT + ')';

const DEL_RIGHT =
  '^[^~]+(?=[^~])|(?!~)' + PUNCT + '(~~?)(?=[\\s]|$)|' + NON_PUNCT_SPACE +
  '(~~?)(?!~)(?=' + PUNCT_SPACE + '|$)|(?!~)' + PUNCT_SPACE +
  '(~~?)(?=' + NON_PUNCT_SPACE + ')|[\\s](~~?)(?!~)(?=' + PUNCT +
  ')|(?!~)' + PUNCT + '(~~?)(?!~)(?=' + PUNCT +
  ')|' + NON_PUNCT_SPACE + '(~~?)(?=' + NON_PUNCT_SPACE + ')';

export const inlineRx = {
  escape: /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,
  code: new RegExp(
    '^(' + TICK + '+)([^' + TICK + ']|[^' + TICK + '][\\s\\S]*?[^' + TICK + '])\\1(?!' + TICK + ')',
  ),
  br: /^( {2,}|\\)\n(?!\s*$)[ \t]*/,
  autolink: new RegExp(
    '^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\\s\\x00-\\x1f<>]*|' + AUTOLINK_EMAIL + ')>',
  ),
  tag: new RegExp(
    '^' + COMMENT_INLINE + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:' +
    ATTR_INLINE + ')*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
  ),
  link: new RegExp(
    '^!?\\[(' + LABEL + ')\\]\\([ \\t\\n]*(' + LINK_HREF +
    ')(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(' + LINK_TITLE + '))?[ \\t\\n]*\\)',
  ),
  reflink: new RegExp('^!?\\[(' + LABEL + ')\\]\\[(' + REF_LABEL + ')\\]'),
  nolink: new RegExp('^!?\\[(' + REF_LABEL + ')\\](?:\\[\\])?'),
  punctuation: new RegExp('^((?![*_])' + PUNCT_SPACE + ')', 'u'),
  emLeft: new RegExp(EM_LEFT, 'u'),
  emRightStar: new RegExp(EM_RIGHT_STAR, 'gu'),
  emRightUnderscore: new RegExp(EM_RIGHT_UNDER, 'gu'),
  delLeft: new RegExp('^~~?(?:((?!~)' + PUNCT + ')|[^\\s~])', 'u'),
  delRight: new RegExp(DEL_RIGHT, 'gu'),
  del: new RegExp(
    '^(~~?)(?=[^\\s~])((?:\\\\[\\s\\S]|[^\\\\])*?(?:\\\\[\\s\\S]|[^\\s~\\\\]))\\1(?=[^~]|$)',
  ),
  anyPunct: new RegExp('\\\\(' + PUNCT + ')', 'gu'),
  anyPunctOutsideCode: new RegExp(
    '(' + TICK + '+)(?:[^' + TICK + ']|[^' + TICK + '][\\s\\S]*?[^' + TICK + '])\\1(?!' +
    TICK + ')|' + TICK + '+|\\\\(' + PUNCT + ')',
    'gu',
  ),
  url: new RegExp(
    '^' + EMAIL_PROTO + '|^((?:' + HTTP + '):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^' + URL_EMAIL,
  ),
  backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
  textGfm: new RegExp(TEXT_GFM),
  blockSkip: new RegExp(
    SKIP_LINK + '|(?<!' + TICK + ')()' + SKIP_CODE + '|<(?! )[^<>]*?>',
    'g',
  ),
  reflinkSearch: new RegExp(
    '!?\\[(' + REF_SEARCH_LABEL + ')\\]\\[(' + REF_TEXT + ')\\]|!?\\[(' + REF_TEXT +
    ')\\](?:\\[\\])?(?!\\()',
    'g',
  ),
};

const probes = [];

function buildProbe(width) {
  return {
    bullet: new RegExp(
      '^ {0,' + width + '}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))',
    ),
    rule: new RegExp(
      '^ {0,' + width + '}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)',
    ),
    fence: new RegExp('^ {0,' + width + '}(?:' + TICK + '{3,}|~~~)'),
    heading: new RegExp('^ {0,' + width + '}#{1,6}(?:\\s|$)'),
    html: new RegExp(
      '^ {0,' + width + '}(?:</?(?:' + TAGNAMES + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)',
      'i',
    ),
    quote: new RegExp('^ {0,' + width + '}>'),
  };
}

export function lineProbe(width) {
  const slot = width < 1 ? 0 : width > 3 ? 3 : width - 1;
  return probes[slot] || (probes[slot] = buildProbe(slot));
}

export function listItemRx(marker) {
  return new RegExp('^( {0,3}' + marker + ')((?:[ \\t][^\\n]*)?(?:\\n|$))');
}

// __HELPERS__
