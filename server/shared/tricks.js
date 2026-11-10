// Trick-taking helpers shared by Oh Hell, Oh Yeah, Hearts and Spades.
// A trick is an array of plays: [{ playerId, card }], in play order.
import { rankValue } from './cards.js';

export function ledSuit(trick) {
  return trick.length ? trick[0].card.suit : null;
}

/** Cards a player may play: must follow the led suit if able. */
export function followSuitCards(hand, trick) {
  const led = ledSuit(trick);
  if (!led) return hand.slice();
  const follow = hand.filter((c) => c.suit === led);
  return follow.length ? follow : hand.slice();
}

/** Does card `c` beat the currently winning card `best`? */
export function beats(c, best, led, trump) {
  const cTrump = trump != null && c.suit === trump;
  const bTrump = trump != null && best.suit === trump;
  if (cTrump !== bTrump) return cTrump;
  if (c.suit !== best.suit) return false;
  return rankValue(c.rank) > rankValue(best.rank);
}

/** playerId of the trick winner: highest trump, else highest card of the led suit. */
export function trickWinner(trick, trump = null) {
  if (!trick.length) return null;
  const led = ledSuit(trick);
  let best = trick[0];
  for (const play of trick.slice(1)) {
    if (beats(play.card, best.card, led, trump)) best = play;
  }
  return best.playerId;
}
