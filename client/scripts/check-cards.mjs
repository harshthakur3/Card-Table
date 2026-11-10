#!/usr/bin/env node
// Dev check: every one of the 52 mapped card files (and the jokers) exists in client/public/cards.
//   npm run cards:check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_FILES, JOKER_FILES } from '../src/cards/cardImages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cardsDir = path.resolve(here, '../public/cards');

export function checkCards() {
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['S', 'H', 'D', 'C'];
  const problems = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      const file = CARD_FILES[`${r}${s}`];
      if (!file) problems.push(`no mapping for ${r}${s}`);
      else if (!fs.existsSync(path.join(cardsDir, file))) problems.push(`missing file ${file} (for ${r}${s})`);
    }
  }
  for (const [color, file] of Object.entries(JOKER_FILES)) {
    if (file && !fs.existsSync(path.join(cardsDir, file))) problems.push(`missing ${color} joker file ${file}`);
  }
  return { problems, mapped: Object.keys(CARD_FILES).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, mapped } = checkCards();
  if (problems.length) {
    console.error(`Card check FAILED:\n  ${problems.join('\n  ')}`);
    console.error('Run "npm run cards:download" (or copy the pack into client/public/cards and run "npm run cards:map").');
    process.exit(1);
  }
  console.log(`Card check OK: ${mapped}/52 cards mapped and present in client/public/cards.`);
}
