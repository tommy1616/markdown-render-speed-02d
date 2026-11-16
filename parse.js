// Public entry point.  One independent render per call; no document state is
// kept between calls.

import { BlockParser } from './blocklex.js';
import { InlineParser } from './inlinelex.js';
import { renderBlocks } from './render.js';

export function parse(markdown) {
  const state = {
    defs: Object.create(null),
    defCount: 0,
    jobs: [],
    inLink: false,
    inRaw: false,
    linkDone: false,
    parenPossible: true,
    top: true,
  };

  const inline = new InlineParser(state);
  const blocks = new BlockParser(state, inline);

  let src = markdown;
  if (src.indexOf('\r') >= 0) src = src.replace(/\r\n?/g, '\n');

  const tokens = blocks.walk(src, []);
  inline.replay();
  return renderBlocks(tokens);
}
