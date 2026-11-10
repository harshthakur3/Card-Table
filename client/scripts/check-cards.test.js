import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCards } from './check-cards.mjs';
import { cardFile, CARD_FILES } from '../src/cards/cardImages.js';

test('all 52 cards are mapped to files that exist', () => {
  const { problems, mapped } = checkCards();
  assert.equal(mapped, 52);
  assert.deepEqual(problems, []);
});

test('mapping spot checks', () => {
  assert.equal(cardFile('A', 'S'), 'AS.svg');
  assert.equal(cardFile('10', 'H'), '10H.svg');
  assert.equal(cardFile('Q', 'D'), 'QD.svg');
  assert.equal(new Set(Object.values(CARD_FILES)).size, 52);
});
