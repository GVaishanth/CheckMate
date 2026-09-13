# CHECKMATE

A complete chess platform that runs entirely in the browser: six configurable engine opponents, engine-verified puzzles, a performance-rating test, and peer-to-peer multiplayer — with no backend, no accounts, and no network dependency.

```
THINK. CALCULATE. CHECKMATE.
```

## Overview

CHECKMATE is a static single-page application. After `npm install && npm run build`, everything the game needs — rules engine, search engine, puzzle dataset, sounds, fonts — is inside `dist/`. Deploy that folder to GitHub Pages (or any static host) and it works, online or offline.

The project is also a portfolio piece about engineering discipline: a from-scratch chess engine, a Web Worker architecture, a host-authoritative WebRTC protocol, and a generated-and-verified puzzle dataset, all in strongly-typed TypeScript with zero runtime dependencies beyond React.

## Features

- **Six bot opponents** — genuinely different engine configurations (search depth, time budget, evaluation noise, blunder rate, opening theory), from ROOKIE (≈600) to GRANDMASTER (2100+). Ratings are approximate strength labels, not measurements.
- **Full chess rules** — castling, en passant, promotion with a picker, threefold repetition, fifty-move rule, insufficient material, stalemate. Move generation is perft-validated.
- **Drag & drop + click-to-move + keyboard play**, legal-move hints, last-move/check/selection highlights, move animations, board flip, four themes, two piece sets (custom SVG **VANGUARD** set or classic glyphs).
- **Post-game analysis** — the engine re-scores every move of the game and reports accuracy plus an estimated performance rating.
- **Automatic review** — THE ANNOTATOR, the post-game reviewer, replays any finished game move by move: every ply is scored in the engine worker, then the replay walks through with commentary (best / good / inaccuracy / mistake / blunder and the stronger move where one exists), auto-advancing like a lesson recap. Pause, step, skip, and read the per-side verdict at the end.
- **Multiplayer** — direct browser-to-browser WebRTC with manual code exchange, or same-device pass & play.
- **310 bundled puzzles** in nine tactical categories across four difficulties, with multi-move solutions, retry, solution reveal, and local statistics.
- **Elo test** — eight engine-verified rounds with a performance estimate, confidence range, and per-category breakdown.
- **Game history** — every finished game stored locally; reopen and step through ply by ply; import and export PGN.
- **Command palette** (`Ctrl+K` or `/`), sound design synthesized in the Web Audio API, service-worker offline support, and a keyboard-playable, screen-reader-labelled interface.

## Game Modes

### Bots

Six opponents on a difficulty ladder. Each is a different configuration of the same engine:

| Bot | Search | Evaluation | Nerve |
| --- | --- | --- | --- |
| ROOKIE | depth 1, no quiescence | material only | ±130cp noise, 30% blunder rate |
| APPRENTICE | depth 2 + quiescence | material only | ±70cp noise, 12% blunders |
| CLUB PLAYER | depth 3 | full | ±35cp noise |
| COMPETITOR | depth 4 | full | ±15cp noise, rare blunders |
| MASTER | depth 6 | full | clean search |
| GRANDMASTER | depth 10, 1.9s budget | full | clean search |

Weaker bots also consult less opening theory. The engine runs in a Web Worker; the UI shows search depth and node counts while the opponent thinks and never freezes. Undo, draw offers, resignation and restart are supported.

### Multiplayer

Two modes, honestly labelled:

- **Direct connection (P2P):** one player creates a room and gets a connection code (a compressed WebRTC offer). The other pastes it and answers with a reply code. Once the host accepts the reply, the game runs over a direct data channel. The host owns the authoritative game state, validates every guest move against the rules engine, and broadcasts the full state after each accepted move. Draw offers, resignations and rematch offers run over the same protocol, and a lost connection ends the game with a clear result rather than a frozen board.
- **Pass & play:** same device; the board can flip to face whoever is thinking.

Because there is no signaling relay, STUN or TURN, direct connections work between browsers that can reach each other — the same machine or a local network is reliable; cross-internet connections depend on the network path. There is no matchmaking and no claim of one.

### Puzzles

The dataset is generated offline by this repository's own engine (`scripts/generate-puzzles.ts`): it self-plays fast games, harvests positions where the engine can prove a decisive shot or a forced mate, and classifies the motif — checkmate, fork, pin, skewer, discovered attack, sacrifice, back-rank, endgame conversion, or mixed. Mate lines are extended move by move until checkmate and verified by the test suite; no scraped databases are involved. Solutions accept any move the engine judges equally strong, not just the stored line.

### Elo Test

Eight rounds: tactical shots, forced mates, endgame conversions, and a consistency grind. Every move you play is compared against the engine's best; the estimate is derived from average centipawn loss, and the result screen shows a confidence range plus per-category scores (tactics / calculation / endgame / consistency).

This is an **experimental browser estimate** — it is not an official rating of any kind and is not comparable to federation ratings.

## Chess Engine

Written from scratch in TypeScript, isolated from the UI, and running in a Web Worker (with a main-thread fallback):

```
0x88 board + Zobrist hashing
        ↓
legal move generation (perft-validated)
        ↓
iterative-deepening negamax with principal-variation search
        ↓
alpha-beta pruning + transposition table (mate-distance corrected)
        ↓
evaluation: material + piece-square tables (midgame/endgame phased),
bishop pair, rook on open files, passed pawns, king safety, mobility
        ↓
best move
```

Additional techniques: null-move pruning, late-move reductions, quiescence search, move ordering (TT move, MVV-LVA captures, killer moves, history heuristic), and an incremental material+PST score maintained by `makeMove`/`undoMove`. Search is time-budgeted (iterative deepening stops cleanly), which makes bot strength configurable by both depth and thinking time. Roughly 600k nodes/second in a worker thread on a desktop machine.

Bot personality is applied at the root: evaluation noise, deliberate blunders sampled from the weaker half of legal moves, and opening-book depth — never by distorting the rules.

## Multiplayer Architecture

```
Guest plays a move
        │  { t: 'try', uci }
        ▼
Host: rules engine validates the move ──invalid──▶ { t: 'rejected' }
        │  valid
        ▼
Host applies the move, checks game end
        │  { t: 'state', moves, names, turn, result }
        ▼
Guest replays the validated plies onto its own board
```

The host is authoritative: guests never mutate shared state, they apply what the host broadcasts (each ply re-validated locally). Incoming messages are typed and validated; malformed frames are dropped. Codes are exchanged out of band (any chat app), so no server ever sees a move.

## Audio System

All sound is procedurally synthesized with the Web Audio API — there are no audio files, nothing is downloaded, and every cue works offline. One coherent "wood + tone" family:

- **Move / capture / castle** — wooden thocks at different pitches; capture adds filtered noise.
- **Check** — a sharper two-tone cue; **checkmate** — the landing thock, a pause, then a descending resolution.
- **Promotion** — a rising pair; **victory / defeat / draw** — distinct, restrained resolutions.
- **Puzzles** — quiet confirmation per correct move, a fuller chord on completion.

A single `sound` module owns the `AudioContext` (created silently on first user gesture, per browser autoplay policy). Per-sound volume tiers keep UI ticks under chess events, per-sound cooldowns prevent spam, and every audible cue has a visual twin — the app is fully usable muted. Sound effects, interface sounds, and master volume are separately configurable and persisted.

## Animation System

One motion language: fast (110ms) for state changes, medium (200ms) for piece movement, with a single easing curve. Piece slides, capture ghosts, a promotion pop, a one-shot check ring on the king, a 240ms refusal shake for illegal actions (the piece stays selected for an immediate retry), staggered game-over stat reveal, and a deliberate half-second beat between the final move and the result panel. `prefers-reduced-motion` (and the in-app toggle) collapses all of it while keeping the state feedback — highlights, panels, results — fully legible.

## Data & Persistence

- **IndexedDB** (`checkmate` v1): finished games, puzzle progress, Elo results.
- **localStorage**: settings, puzzle streak. Both are versioned and validated on load; corrupt data falls back to defaults instead of crashing.
- **Export / import**: one JSON bundle with everything, plus PGN import/export for games. Reset (with confirmation) wipes only this app's data.
- Nothing is ever uploaded. There is no analytics, no telemetry, no network call at runtime.

## Offline Architecture

```
UI (React SPA)
 ↓ local game state
Rules engine (src/chess)
 ↓ Web Worker
Search engine (src/engine)
 ↓ bundled
Puzzle dataset + Elo rounds (src/data)
 ↓ local
IndexedDB / localStorage persistence
```

Everything above works with the network cable pulled — the service worker caches the app shell and all hashed assets after the first visit, and stamped caches are purged on each deploy. Multiplayer is the single exception: peers need a connection *to each other* (not to any server).

## Technology Stack

- React 18 + TypeScript 5 (strict, no `any`) — UI layer only
- Vite 5 — build, worker bundling, code splitting
- Web APIs: Web Workers, WebRTC (data channels), Web Audio, IndexedDB, Cache Storage
- React Router 6 (hash routing) — the only runtime dependency beyond React
- Vitest — perft, engine behavior, and dataset-integrity tests (32 tests)
- Three self-hosted variable fonts (Space Grotesk, Inter, JetBrains Mono) — no CDN

## Project Structure

```
src/
  chess/        rules: 0x88 position, Zobrist, PST, SAN, PGN
  engine/       search, evaluation, opening book, bot personalities
  workers/      engine Web Worker (protocol documented in file header)
  game/         GameController, engine client, analysis math, hooks
  multiplayer/  WebRTC peer connection
  pages/        Home, Bots, Multiplayer, Puzzles, EloTest, History, Review
  components/   Board, pieces, move list, modals, palette, shell…
  storage/      IndexedDB repositories, settings, export/import
  audio/        synthesized sound module
  data/         puzzles.json + elo.json (generated offline by scripts/)
  styles/       tokens → base → components → board → pages
scripts/        dataset generators, benchmarks, postbuild checks, OG-card render
tests/          perft, engine, dataset integrity
```

## Running Locally

```bash
npm install
npm run dev          # vite dev server
```

```bash
npm test             # 32 tests: perft, engine behavior, puzzle dataset
npm run typecheck    # strict TS for app + tools
npm run bench        # engine nodes/second benchmark
npm run gen:puzzles  # regenerate the puzzle dataset (offline, ~20 min)
npm run gen:elo      # regenerate the Elo test rounds (offline)
```

## Production Build

```bash
npm run build        # typecheck → vite build → postbuild verification
npm run preview      # serve dist/ locally
```

## GitHub Pages Deployment

The build uses relative asset paths and **hash routing** (`/#/bots`), so it works identically at a repository subpath (`user.github.io/repo/`), a user site, or any static host — no 404.html fallback or base-path injection needed.

A ready-made workflow lives in `.github/workflows/deploy.yml`: on every push to `main` it runs the test suite, builds, and publishes `dist/` to GitHub Pages. Enable Pages with the "GitHub Actions" source in the repository settings once.

## Browser Support

Expected to work in current Chrome, Edge, Firefox, and Safari (desktop and mobile), which provide the required Web Workers, Web Audio, IndexedDB, and Cache Storage. Multiplayer additionally requires WebRTC data channels. The engine falls back to the main thread if workers are unavailable; audio and persistence degrade silently if blocked.

## Accessibility

- The board is keyboard-playable: arrows move a cursor, `Enter` picks and drops, `Esc` clears.
- Semantic roles and labels throughout; move and status changes announced to screen readers.
- Visible focus states, high-contrast mode, reduced-motion mode (plus OS-level detection).
- No state is communicated by sound or color alone — every cue has a visual equivalent.

## Performance

- The engine never blocks the UI: all search and analysis run in a Web Worker; a depth indicator streams from progress messages.
- The main-thread engine fallback loads lazily as a separate chunk; the puzzle dataset is a single typed JSON import.
- Animations use transforms/opacity only; the decorative hero canvas is static under reduced motion and pauses when the tab is hidden.
- Total shipped JS is ~130 KB gzipped (plus ~9 KB gzipped CSS); three woff2 fonts ~104 KB; no other assets.

## Design Philosophy

Dark, quiet, and precise: a near-black surface, ivory text, one gold accent reserved for interaction. Sharp 2/4/8px geometry, hairline borders, monospaced system labels, registration-mark board corners. The aesthetic follows the engineering — an engine room, not a dashboard.

## Limitations

- No global matchmaking or signaling relay: P2P works best on the same machine or LAN; cross-network connections depend on the path between browsers.
- The Elo number is an experimental local estimate, not a federation rating.
- No chess clocks, no engine analysis graph, no opening explorer (yet).
- Bots are honest club-level opponents, not grandmaster-strength by any absolute measure.

## Future Improvements

- A signaling relay option for internet-wide P2P.
- Evaluation graph in game review.
- Puzzle rating (Glicko-style) per player.

## License

[MIT](LICENSE) © 2026
