// Card naming used by the UI. The server sends cards as { id, rank, suit } with these codes.
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };

export function isRedSuit(suit) {
  return suit === 'H' || suit === 'D';
}
