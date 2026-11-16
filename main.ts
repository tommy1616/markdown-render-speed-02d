// make.fun speed-round driver.
// Reads {id, markdown}[] from cases.json, renders each case on its own through
// parse(), then stores the HTML array in html.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const payload = readFileSync(inDir + '/cases.json', 'utf8');
const cases = JSON.parse(payload) as Case[];

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}

writeFileSync(outDir + '/html.json', JSON.stringify(html));
