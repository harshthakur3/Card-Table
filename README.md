# Card Table

Multiplayer card games in the browser. No accounts and no downloads: host a table, share the code or link, and play.

- **Client:** React 18 + Vite, React Router, socket.io-client
- **Server:** Node.js + Express 5 + Socket.io. Rooms live in memory, or in Redis if `REDIS_URL` is set.
- **Games:** Bluff, Oh Hell, Oh Yeah, Go Fish, War, Hearts, Spades, Rummy, Crazy Eights, Teen Patti

Every rule is enforced on the server. The server keeps the deck and every hand and sends each player only their own cards plus public information. Hidden cards never reach other browsers.

---

## Project structure

The project is two independent apps. Each has its own `package.json` and `node_modules`, and each can be deployed on its own.

```
client/       the website (React + Vite)
server/       the game server (Express + Socket.io), including every game's rules engine
render.yaml   deploy settings for the game server on Render
README.md
```

## Run it locally

Requires **Node.js 22 or newer**. No database is needed.

**1. Install (first time only)**, once in each folder:

```bash
cd server
npm install
```
```bash
cd client
npm install
```

**2. Start both** in two terminals:

Terminal 1, the game server (http://localhost:3001). It restarts by itself when you edit server code:
```bash
cd server
npm run dev
```

Terminal 2, the website (http://localhost:5173):
```bash
cd client
npm run dev
```

Then open **http://localhost:5173**. In development, the website forwards `/api` and `/socket.io` to the game server on :3001.

### Playing against yourself locally

Each browser profile gets its own guest token (it's stored in `localStorage`, which is separate per origin). To be several players on one machine, open the room in:

- a normal window: `http://localhost:5173/...`
- a private/incognito window, or another browser
- `http://127.0.0.1:5173/...` (a different origin, so a different player)

Other devices on your network can join at `http://<your-computer's-IP>:5173`, because Vite listens on all interfaces.

---

## Deploying

The project deploys as two pieces: the game server and the website.

### Option A: game server on Render, website on Vercel

Both are set up in the repository already: `render.yaml` describes the game server, and `client/vercel.json` describes the website. Push the project to GitHub first, then:

**1. Game server on Render**

1. In Render, choose **New > Blueprint** and pick the repository.
2. Render reads `render.yaml`. It asks for `CORS_ORIGIN`: leave it empty for now and press **Apply**.
3. When the deploy finishes, copy the service address, e.g. `https://card-table-server.onrender.com`. Opening `/api/health` on it should show `"ok": true`.

**2. Website on Vercel**

1. In Vercel, choose **Add New > Project** and import the same repository.
2. Set **Root Directory** to `client`. Vercel picks up the build settings from `client/vercel.json`.
3. Add one environment variable: `VITE_SERVER_URL` = your Render address from step 1.
4. Press **Deploy**.

**3. Lock the server to your site (optional)**

In Render, set `CORS_ORIGIN` to your Vercel address, e.g. `https://card-table.vercel.app`. While it's empty, any site may connect.

After that, every push to GitHub redeploys both.

Things to know:

- `VITE_SERVER_URL` is read when the site is **built**. If you change it, redeploy the site.
- Render's free plan puts the server to sleep after about 15 minutes without visitors. The first visit after that takes up to a minute to wake it, and rooms held in memory are lost. A paid plan, or Redis via `REDIS_URL`, avoids that.
- Other hosts work the same way. The server needs a host that keeps **WebSocket** connections open (Railway, Fly.io, a VPS), with root directory `server`, build `npm install` and start `npm start`. Serverless functions can't run it. The website is static files: build `npm run build` in `client` and publish `dist`. `client/public/_redirects` covers Netlify's page routing.

### Option B: one service

The game server also serves the built website if it finds `client/dist` next to it. Deploy the whole repository as one service:
- Build command: `cd client && npm install && npm run build && cd ../server && npm install`
- Start command: `cd server && npm start`

This gives you one address, so leave `VITE_SERVER_URL` and `CORS_ORIGIN` unset.

To try this locally: run `npm run build` in `client`, then `npm start` in `server`, and open http://localhost:3001.

---

## Settings (environment variables)

All are optional.

**Game server (`server/`):**

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Website address(es) allowed to use the API and sockets when the site is on another domain. Comma-separated for several. |
| `REDIS_URL` | *(empty)* | e.g. `redis://localhost:6379`. Rooms and game state are written through to Redis (6-hour TTL) and reloaded after a restart. Empty means in-memory. If Redis can't be reached, the server logs a warning and uses memory. |
| `RECONNECT_GRACE_MS` | `60000` | How long a dropped player keeps their seat mid-game before a bot plays for them |
| `LOBBY_GRACE_MS` | `30000` | How long a dropped player stays in the lobby before being removed |
| `ROOM_IDLE_MS` | `1800000` | Rooms with nobody connected are deleted after this (30 min) |
| `BOT_DELAY_MS` | `1200` | Pause before a bot makes a move for an absent player |
| `GAMES_DIR` | `server/games` | Where game modules are loaded from |
| `CLIENT_DIST` | `client/dist` | Built website to serve (one-service deploy). Ignored if it doesn't exist. |

`ioredis` is an optional dependency and is only loaded when `REDIS_URL` is set.

**Website (`client/`):**

| Variable | Default | What it does |
|---|---|---|
| `VITE_SERVER_URL` | *(empty = same address)* | Game server address when it's on another domain. Used at build time. |
| `VITE_API_TARGET` | `http://localhost:3001` | Dev only: where `npm run dev` forwards `/api` and `/socket.io` |

---

## Features

- **Rooms:** 5-character codes without look-alike characters, plus a share link. Invalid or unknown codes show a clear error. Full rooms and games already in progress are refused politely.
- **Players:** a nickname of 2–16 characters, unique within the room (case-insensitive); you're asked for another if yours is taken. A random guest token is kept in `localStorage`, so a reload or reconnect gets your seat and hand back.
- **Lobby:** player list, host badge, ready toggles, kick (kicked players can't rejoin), and game, seat-count, turn-timer and per-game options. Only the host can change settings, and the host can start once everyone is ready.
- **Disconnects:**
  - A dropped player keeps their seat for the grace period. After that a simple bot plays for them until they come back.
  - If the host leaves, host passes to the next player.
  - If too few players remain, the table returns to the lobby.
- **In game:**
  - Turn indicator, an optional turn timer (a move is made automatically when it runs out), toasts ("Harsh called bluff!"), a game log, chat with an unread badge, a rules side panel and a scoreboard.
  - A results screen with **Play again**, which keeps the same room and players.
- **Cards:** real SVG card art. Dealing, playing to the table, and picking up or collecting cards are animated. The hand fans along the bottom, opponents sit around the felt, and the pile is in the middle.
- **Phones:** fully responsive. Tap cards to select them, then tap the action button. Card corners are enlarged so rank and suit stay readable.

---

## Tests

In `server/` (deck utilities, every game engine, and room/socket integration):
```bash
npm test
```

In `client/` (checks that all 52 card images exist):
```bash
npm test
```

Tests use Node's built-in test runner, so there are no extra test frameworks. Every game has:

- rule tests: legal and illegal moves with their error messages, scoring and winning
- a **no-leak test**: no player's view or action list contains another player's hidden cards or the stock
- **bot simulations**: full games played to the end with invariants checked along the way, such as cards and chips being conserved

The server tests run the real app against socket.io clients. They cover create/join, invalid codes, duplicate nicknames, full rooms, ready gating, hidden-hand privacy, illegal moves, reconnecting to the same seat, grace expiry and bots, kick, host transfer, leaving mid-game, chat, settings, the turn timer and play again.

---

## Project layout

```
client/                The website (React + Vite)
  public/cards/        The card SVGs (copied from the pack, served locally)
  src/cards/           cardImages.js (generated mapping), Card, CardBack, FallbackCard, suits, preload
  src/components/      Table, Hand, ActionBar, Chat, GameLog, RulesPanel, Toasts, ConfirmDialog, FlyingCards…
  src/pages/           Home, Rules, Room (Lobby / GameTable)
  src/lib/             socket + API connection (serverUrl.js reads VITE_SERVER_URL), session
  scripts/             download-cards, generate-card-map, check-cards (+ test)
server/                The game server (Express + Socket.io)
  src/app.js           REST routes, CORS, Socket.io setup, optional static site
  src/rooms/           RoomManager (rooms, seats, turns, timers, bots), validation
  src/store.js         MemoryStore / RedisStore
  src/registry.js      Discovers games in server/games
  test/                Integration tests
  shared/              Code the game engines share
    cards.js           Deck, jokers, multiple decks, seeded Fisher-Yates shuffle, deal, sort, labels
    engine.js          Helpers for engines (ok/fail, nextSeat, rankPlayers, SYSTEM player)
    options.js         Option schema normalisation
    tricks.js          Follow-suit / trick-winner helpers
    predictionGame.js  Shared engine behind Oh Hell and Oh Yeah
  games/<id>/          One folder per game: index.js, rules.md, <id>.test.js
  games/_test/         Test harness (folders starting with _ are not games)
```

---

## Adding a new game

You only add files inside `server/games/`; nothing in the website or the server core changes.

1. Create `server/games/<id>/index.js`. The folder name must equal `meta.id`.
2. Create `server/games/<id>/rules.md`. It is shown on `/rules/<id>` and in the in-game Rules panel.
3. Optionally add `server/games/<id>/<id>.test.js`, using the helpers in `server/games/_test/harness.js`.
4. Restart the server (the dev server restarts by itself). The game appears on the home page and in the lobby.

### The engine interface

```js
export const meta = {
  id: 'my-game', name: 'My Game', minPlayers: 2, maxPlayers: 4,
  description: 'Shown on the home page.', tagline: 'Optional one-liner.', order: 20,
  options: [ // rendered in the lobby automatically; values are validated server-side
    { key: 'target', label: 'Play to', type: 'select', default: 100, choices: [{ value: 100, label: '100' }] },
    { key: 'fast', label: 'Fast mode', type: 'boolean', default: false },
    { key: 'rounds', label: 'Rounds', type: 'number', default: 3, min: 1, max: 9 },
  ],
};

export function createGame(players /* [{id, name}] */, options /* normalized + { seed } */) { return state; }
export function getPublicState(state) { return { /* what anyone may know */ }; }
export function getPlayerView(state, playerId) { return view; }          // see "View format"
export function getLegalActions(state, playerId) { return [descriptor]; } // see "Action descriptors"
export function applyAction(state, playerId, action) { return { state, events } /* or */ ({ error }); }
export function isGameOver(state) { return boolean; }
export function getResults(state) { return { rankings: [{ playerId, place, score, label }], winners: [id], summary }; }
export function getAutoAction(state, playerId) { return action; } // optional: what a bot plays
```

Rules for engines:

- **Pure and serialisable.** `applyAction` must not change its input (`clone()` it first), and state must be plain JSON so it can go to Redis.
- **Use the seed.** Shuffle with `shuffle(cards, \`${seed}:round${n}\`)` from `server/shared/cards.js` so games can be replayed in tests.
- **Validate everything.** Return `fail('Readable reason')`; the message is shown to the player as-is.
- **Only the owner sees hidden cards.** Put a player's own hand only in their own `getPlayerView`.
- **Automatic steps** (collecting a trick, dealing the next round) go in `state.autoAdvance = { delayMs, action }`. The server applies `action` as the `SYSTEM` player after the delay.
- **Whose turn it is** is worked out for you: anyone with at least one non-`optional` legal action is waiting to act. Turn timers and bots use this too.

### Action descriptors

The client draws the action bar from these, so a new game needs no UI code:

```js
{
  type: 'play', label: 'Play', style: 'primary' | 'secondary' | 'danger',
  optional: true,                                     // doesn't count as "your turn" (e.g. Call bluff, See cards)
  cards: { min: 1, max: 4, allowed: ['AS', '10H'] },  // select cards from your hand
  params: [                                           // extra inputs
    { name: 'rank', label: 'Claim', type: 'choice', options: [{ value: 'K', label: 'K' }], default: 'K' },
    { name: 'bid',  label: 'Bid',   type: 'number', min: 0, max: 7, disallowed: [3], labels: { 0: 'Nil' } },
    { name: 'target', label: 'Ask', type: 'player', options: ['p2', 'p3'] },
  ],
}
```

The action sent back is `{ type, cards: [ids], ...params }`.

### View format

```js
{
  prompt: 'Your turn: …', hand: [card], handNote: '',
  players: [{ id, cardCount, stats: [{ label, value }], badge, status: 'folded' | 'winner', faceUp: [card] }],
  table: [  // zones in the middle of the felt
    { id, type: 'pile',  label, count, top },
    { id, type: 'cards', label, cards },
    { id, type: 'trick', plays: [{ playerId, card }], winnerId },
    { id, type: 'melds', groups: [{ id, label, cards }] },
    { id, type: 'text',  label, text },
  ],
  info: [{ label, value }],                 // chips in the top bar
  scoreboard: { columns, rows },            // optional "Scores" dialog
  dealId,                                   // bump to replay the deal animation
}
```

Events returned from `applyAction` look like `{ type, text, toast, tone, to, anim }`. `text` goes to the game log, `toast: true` also pops a toast, and `to: playerId` makes the event private. `anim` is one of `{ kind: 'toCenter' | 'toSeat' | 'seatToSeat' | 'deal', playerId, count, cards }`.

---

## Card images

The card art is the **[Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards)** pack (`cards-svg` folder). The files are **downloaded once and served from `client/public/cards/`**; nothing is hotlinked from GitHub at runtime.

- **Files:** 52 cards named `<RANK><SUIT>.svg`, e.g. `AS.svg`, `10H.svg`, `QD.svg`, plus `Joker1.svg` (black) and `Joker2.svg` (red).
- **Mapping:** `client/src/cards/cardImages.js` is generated from the real filenames. It's the only place filenames appear.
- **Card back:** the pack has none, so `CardBack.jsx` draws one as an inline SVG.
- **Aspect ratio:** the art is 1 : 1.452, close to 5 : 7.
- **Fallback:** if an image ever fails to load, `<Card>` falls back to a CSS/SVG card that shows rank and suit.

To download or refresh the cards, run these in `client/`:

```bash
npm run cards:download   # git clone --depth 1 (falls back to the GitHub zip), copies cards-svg/* → public/cards, regenerates the mapping
npm run cards:map        # just regenerate src/cards/cardImages.js from the files present
npm run cards:check      # verify all 52 cards are mapped and present (also run by npm test in client/)
```

### Credits and license

- Playing card images: *Vector-Playing-Cards*, originally by [Byron Knoll](http://www.byronknoll.com/), maintained at [github.com/notpeter/Vector-Playing-Cards](https://github.com/notpeter/Vector-Playing-Cards).
- The pack is **released into the public domain**, or optionally licensed under the **WTFPL** where public domain isn't recognised. That allows any use, including commercial use.
- The card back, favicon and all other code and art in this repository were written for this project.

---

## Notes and limitations

- **Oh Yeah** rules vary between families. The exact rules used here, and how to change them through the lobby options, are in [`server/games/oh-yeah/rules.md`](server/games/oh-yeah/rules.md).
- **Teen Patti** uses play chips only: they have no value and nothing can be bought or cashed out. All-ins are simplified: there are no side pots, and a player who can't call goes all-in and stays in until the show.
- **Kalyan** is not included. I couldn't identify a card game by that name (it's best known as the name of a Matka market). If you have its rules, it can be added as `server/games/kalyan/`.
- The in-memory store is per process. To run several server instances behind a load balancer you'd need Redis *and* the Socket.io Redis adapter, which isn't included.
