# Oh Yeah

A prediction trick-taking game in the Oh Hell family. **These are the exact rules this app implements.** Everything marked *(option)* can be changed by the host in the lobby, so you can match your house rules without touching code. If your group plays differently, tell the developer which rule to change: they all live in `games/oh-yeah/index.js`.

## Objective

Predict exactly how many tricks you will win each round. Hit your number, shout **"Oh Yeah!"**, and collect the points.

## Players

3–7 players, one 52-card deck, no jokers.

## Card ranking

Within each suit: **A (high) K Q J 10 9 8 7 6 5 4 3 2 (low)**. Any trump beats any non-trump card.

## Setup / dealing

1. **Hand sizes** *(option)*: by default the game starts **big and goes down, then back up**: 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7 cards (13 rounds). The host can choose the largest hand (3, 5, 7, 8, 10 or 13 cards; it's lowered automatically if there aren't enough cards for everyone) and the direction (down-up, up-down, down only, up only).
2. **Dealer**: seat 1 deals the first round; the deal passes one seat to the left every round.
3. **Trumps** *(option)*: by default trumps **rotate** in a fixed order, one suit per round:
   **♠ Spades → ♥ Hearts → ♦ Diamonds → ♣ Clubs → No trump**, then repeat.
   Other choices: *turn up a card* after dealing (its suit is trumps, as in Oh Hell), or *never any trumps*.

## How a round works

### 1. Predictions

- **Secret predictions** *(default)*: every player picks a number from 0 to the hand size **at the same time and in secret**. Nobody sees anyone else's number (you only see a ✓ when a player is done) until **everyone** has predicted; then all predictions are revealed together.
- *(option)* **Out loud, in turn**: starting left of the dealer, each player announces their prediction in order. There is **no hook rule** in Oh Yeah: the total of the predictions may equal the number of tricks.

### 2. Playing tricks

- The player **left of the dealer** leads the first trick with any card.
- Going clockwise, everyone plays one card. You **must follow suit** if you can; if you can't, play any card (a trump or a discard).
- The trick is won by the **highest trump**, or if no trump was played, the **highest card of the suit led**.
- The trick winner leads the next trick.
- In a **No trump** round, only the suit led can win.

### 3. Scoring (after every round)

- **Exact prediction — "Oh Yeah!"**: **10 points + 2 points per trick you predicted**. Predicting 0 and taking 0 tricks scores 10; predicting 3 and taking exactly 3 scores 16.
- **Wrong prediction**: you **lose 1 point for every trick you were off by** *(option: 0, 1 or 2 points per trick)*. Predicting 2 and taking 4 costs 2 points (default).
- Scores can go negative.

## Winning

After the final round, the highest total score wins. Ties share the win.

## Example turns

> **Round 2 — 6 cards each, trumps are ♥ Hearts.** Everyone predicts in secret: Asha picks 2, Ben 1, Chen 3, Dev 0. Once Dev locks in, all four numbers appear at once. Total predicted: 6 of 6 tricks.
> Ben (left of the dealer) leads **Q♣**. Chen follows **K♣**, Dev has no clubs and throws away **4♦** (he wants zero tricks), and Asha plays **A♣**. Asha wins the trick and leads next.

> **End of round 2:** Asha took 2 (predicted 2) → **+14**. Ben took 1 (predicted 1) → **+12**. Chen took 2 (predicted 3) → **−1**. Dev took 1 (predicted 0) → **−1**.

## Differences from Oh Hell (at a glance)

| | Oh Hell | Oh Yeah |
| --- | --- | --- |
| Predictions | One at a time, public | Secret, revealed together |
| Hook rule | Yes (dealer restricted) | No |
| Trumps | Turned-up card | Rotate ♠ ♥ ♦ ♣ No-trump |
| Hand sizes | Up then down | Down then up |
| Exact | 10 + bid | 10 + 2 × bid |
| Miss | 0 | −1 per trick off |
