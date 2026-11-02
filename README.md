# CHECKMATE

A static browser chess application with a custom TypeScript rules/search engine, six configurable opponents, local and peer-to-peer games, tactical puzzles, opening and checkmate lessons, and an experimental performance-rating test.

No application backend, accounts, analytics, external chess APIs, engine downloads, hosted fonts or paid services are required. Solo play works offline after the production app has finished caching its files. Multiplayer still needs a direct connection between the players.

## Run locally

Use **Node.js 22.12 or later**; Node.js 24 LTS is recommended and used by the deployment workflow.

```sh
npm install
npm run dev
```

For a production build:

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Deploy the contents of `dist/`, not the source directory. Serve the app over HTTP for local development or HTTPS for deployment; opening `index.html` directly through `file://` is not supported.

`npm ci` can replace `npm install` for a lockfile-based installation. Font files are checked at installation, and the build verifies relative asset paths, the production policy, licences, fonts and offline-cache contents. It fails when required deployment files are missing.

## Playing

- **Bots:** tap an opponent to select it, then tap again to choose your side and rules. Search depth, time budget, evaluation, opening-book use and deliberate inaccuracies differ between opponents.
- **Pass & Play:** two people share one device. Auto-flip follows the side to move; fixed orientation and manual board flipping are also available.
- **P2P:** one player creates a room, the other pastes the room code and returns a reply code, and the host connects. Moves then travel over a WebRTC data channel. Draw offers, resignation and seat-swapping rematches are supported.
- **Puzzles:** 310 bundled positions across nine themes and four difficulties. The rules engine recognizes immediate mates; other moves are compared with a bounded local search. Alternatives need not match the stored line. Checkmate, back-rank and mating-endgame drills continue until actual mate or a drawn/lost position, rather than awarding completion solely for reaching the stored line length.
- **Education:** 120 opening lessons and 120 mating exercises, with Study, Practice and Recall stages.
- **Elo Test:** eight local assessment positions covering tactical choices, the first move of forced mates, conversion and consistency. The result is an **experimental heuristic estimate**, not a federation rating or a calibrated statistical confidence interval.
- **History:** replay saved games, import one PGN game at a time, and copy or export PGN. Completed consistency rounds retain their actual move records and outcome; an unfinished trial is not recorded as an agreed draw.

### Bot configurations

Depths are limits, not a promise that every position reaches that depth. Time limits, device speed and the search position affect the completed search.

| Opponent | Depth / time budget | Evaluation and variation |
| --- | --- | --- |
| ROOKIE | 1 ply / 250 ms | Material and piece-square tables; no quiescence or book; ±130 cp noise; 30% weaker-choice probability |
| APPRENTICE | 2 plies / 350 ms | Basic evaluation with quiescence; short book; ±70 cp noise; 12% weaker choices |
| CLUB PLAYER | 3 plies / 500 ms | Full evaluation; book; ±35 cp noise; 5% weaker choices |
| COMPETITOR | 4 plies / 700 ms | Full evaluation; book; ±15 cp noise; 1.5% weaker choices |
| MASTER | 6 plies / 1.1 s | Full evaluation and book; no added noise or deliberate blunders |
| GRANDMASTER | 10 plies / 1.9 s | Strongest local configuration; no added noise or deliberate blunders |

Names and displayed strength ranges are approximate labels. They have not been calibrated against rated players and do not establish master or grandmaster playing strength.

### Rules and review

Standard play includes castling, en passant, all promotion choices, checkmate, stalemate, threefold repetition, the fifty-move rule and supported insufficient-material cases. The controller automatically ends games on its supported draw conditions; it does not implement every federation claim procedure or competition regulation.

Three-Check and King of the Hill are available against bots and in Pass & Play. Variant wins are terminal search states, and position hashes include the variant and check counters. Static evaluation is shared with standard chess rather than being separately tuned for each variant. P2P games use standard chess.

THE ANNOTATOR scores recorded plies locally and offers an automatic replay, stronger-move suggestions and a per-side summary. Accuracy and performance values are derived from centipawn-loss estimates. They are approximate, search-dependent metrics, not official ratings; a side with no analyzed moves receives no fabricated accuracy score. Review can be paused, stepped or skipped.

## Education courses

Openings and checkmates are **independent tracks**, each with **10 levels of 12 topics**. Level 1 starts unlocked. To open the next level, complete the preceding level with:

1. Practice completions on at least **10 distinct topics**.
2. At least **6 distinct completed topics** with a historical unaided Recall.

Unaided means no hints or retries in that attempt. Study alone does not complete a topic. Repeating one topic cannot inflate the unique-topic threshold, and a later assisted review does not revoke an earned clean recall or an unlocked level. Direct lesson links respect the same sequential prerequisites as the library. These are local learning gates, not authentication or tamper-proof achievements.

- **Study:** annotated demonstrations, move-by-move navigation, plans and common traps.
- **Practice:** guided board work and progressive hints. Opening lessons can be rehearsed from either colour, with automatic replies. A different legal move is identified as a departure from the studied line, not necessarily a chess mistake.
- **Recall:** prompts and the demonstration are hidden. A bounded mate prover accepts alternatives that force mate within the exercise limit and checks legal defences. A proof limit is reported rather than treated as a successful verification.
- **Review scheduling:** clean recalls use local intervals of 1, 3, 7, 14 and 30 days; assisted recalls are scheduled for a shorter retry. Scheduling uses this device's clock and does not send notifications or contact a service.

The original 18 lesson IDs remain available. The expanded material includes castling, en passant, double check, promotion and underpromotion, sacrifices, and full-board mate-in-three exercises. The opening course contains selected lines, not exhaustive repertoires; the mating exercises are not a complete endgame curriculum.

## Controls and accessibility

The board supports touch, click-to-move, dragging and keyboard play.

| Key | Action |
| --- | --- |
| Arrow keys | Explore board squares |
| Enter / Space | Select a piece or destination |
| Escape | Cancel a selection or close the top dialog |
| Home / End | Move to the ends of the current displayed row |
| Page Up / Page Down | Move to the top or bottom of the current displayed file |
| F | Flip the current board |
| M | Toggle the move list where available |
| Ctrl+K / Cmd+K, or `/` | Open the command palette |

Unavailable buttons remain focusable. Clicking, tapping or pressing Enter/Space explains the specific restriction without executing the action. Locked lessons show the remaining Practice and unaided Recall requirements; busy operations, ended games, replay boundaries and disconnected peers give their own reasons. Feedback is announced in the active dialog and does not steal focus.

Shortcuts are scoped so typing and native controls retain their behaviour. Dialogs trap focus; covered dialogs are inert, and focus is restored on closing. Dismissed game results can be reopened with **RESULT**.

Settings include four board themes, custom SVG or classic glyph pieces, coordinates, legal-move hints, move confirmation, auto-queen, sound, volume, high contrast and reduced motion. Some mating exercises intentionally require a promotion choice even when auto-queen is enabled.

Sounds are synthesized locally with Web Audio after a user gesture. Audio failure is nonfatal, and game status is also represented visually. There are no audio downloads, recognizable game-sound recordings, continuous background music or required haptics.

## Local data and privacy

- IndexedDB (`checkmate`, version 1) stores games, puzzle progress, Elo results and Education progress in the existing `kv` store.
- localStorage stores normalized preferences and puzzle-streak information.
- **Export Data** creates a local JSON backup including games, puzzle progress, ratings, settings, streaks and Education progress.
- **Import Data** validates the backup and replays game moves before replacing records. IndexedDB replacement is transactional. Preferences use localStorage, so the two browser storage APIs cannot form one atomic transaction.
- **Reset All Data** clears records and preferences. Active tasks are revision-guarded so delayed results from an earlier session are not written back after a completed reset or restore.

When persistent storage fails, the app retains an in-memory session where possible and reports the limitation. That fallback does **not** survive closing or reloading the page. Browser storage can also be cleared or evicted; export important data. Use one active tab for play or restore operations: simultaneous edits in multiple tabs are not a conflict-free synchronization system.

PGN import accepts a single game up to 1 MB and 20,000 plies, with legal replay, FEN roots and supported variant headers. JSON restore is bounded to prevent unrestricted record/move allocation. Imports and exports are handled in the browser and are not uploaded. Imported PGN outcomes are the file's declared results, not independently certified competition results. A PGN draw has an unspecified reason; an agreement is not invented when the file supplies no reason.

P2P uses **no public signaling, STUN or TURN service**. Same-device or same-LAN connections are most reliable; a connection across unrelated networks is not guaranteed. Manual connection codes can contain temporary network addresses: share them only with the intended opponent. The host validates and distributes game state, but this is trusted-friend play, not cheat-proof rated play. Starting again after a disconnect creates a new room; it does not resume a lost session.

## Offline behaviour and deployment

Production builds precache the application shell, lazy Education module, both workers, local fonts, artwork and licence notices. A first online visit must finish installing the service worker before offline reloads are available. Development mode does not register the production worker.

Caches are scoped to the deployment path and identified by the built contents. Root and nested installations do not delete each other's caches. Unknown URLs are not answered with the cached app shell. A new worker waits while old controlled tabs remain open so an old page is not forced to use a new set of chunks; close all old tabs and reopen to activate an installed update. Browser cache eviction or disabled service workers can remove offline availability.

The production document includes a same-origin content policy for scripts, workers, fonts and connections. Inline styles remain permitted for the board and other dynamic UI styling. No secrets, environment keys or application server are needed.

### GitHub Pages

1. Push the project to a repository with a `main` branch.
2. In repository **Settings → Pages**, select **GitHub Actions** as the source.
3. Run the included workflow, or push to `main`.

`.github/workflows/deploy.yml` uses Node.js 24, runs a clean installation, both TypeScript checks, tests and the production build, then publishes `dist/`. Actions use fixed release commits; Pages write and OIDC permissions are limited to the deploy job. The workflow still needs to run in your own repository; local checks do not constitute a deployment to your account.

Vite's relative base and hash routing support project paths such as `https://user.github.io/checkmate/#/learn`. The app does not need server-side route rewrites. Other static hosts can publish the same `dist/` directory over HTTPS.

## Implementation and checks

The rules engine uses a 0x88 board, legal move generation, incremental piece-square evaluation, make/unmake, history and dual 32-bit Zobrist keys. Search uses iterative deepening negamax, alpha-beta/PVS, a transposition table with mate-distance handling, guarded null moves, late-move reductions, check extensions, killer/history ordering and quiescence search. There is no embedded external chess engine.

Search and analysis normally run in an ES-module worker. Requests support cancellation, progress and a watchdog. If workers are unavailable, a shorter local search keeps basic play usable and is explicitly labelled; its strength and analysis quality can differ. Bulk fallback analysis yields between plies, but individual searches still briefly occupy the main thread.

```text
src/chess/         Rules, position state, SAN/PGN and hashing
src/engine/        Search, evaluation, book and opponent configurations
src/game/          Controllers, worker client, job ownership and review
src/education/     Lesson catalogs, course gates, progress and mate proof
src/multiplayer/   WebRTC connection and validated game protocol
src/storage/       Persistence, snapshots, backup validation and preferences
src/components/    Board, dialogs, replay and shared interface
src/pages/         Application routes and game flows
src/workers/       Search/analysis and Education proof workers
public/licenses/   Project, runtime, font and opening-data notices
scripts/           Build checks and offline data/asset generation tools
tests/             Rules, engine, data, review, storage and lifecycle tests
```

```sh
npm run typecheck   # Application and test/tool TypeScript projects
npm test            # 817 tests across 19 files in this revision
npm run build       # TypeScript, Vite and deployment/offline validation
npm audit           # Known dependency advisories; not a complete security review
npm run bench       # Local engine benchmark
```

The test suite covers perft, position/history/hash invariants, SAN/PGN, variant endings, engine request cancellation and fallback, puzzle/lesson data, mate proofs, sequential course gates, review calculations, backup rollback, session recovery and offline scope behaviour. The release was also exercised in Chromium for course completion, all mating lessons, the eight-round Elo flow, board interactions, P2P rematches/disconnects, stacked dialogs, responsive layouts and root/nested offline updates. Automated accessibility checks cover tested screens; they are not a claim of universal accessibility or browser compatibility.

`npm run gen:puzzles` and `npm run gen:elo` are optional, potentially expensive offline authoring tools that overwrite their datasets. They are not needed to run or build the app. Re-run integrity tests after regeneration. The optional social-card generator under `scripts/og/` needs Playwright installed separately; the generated card is already bundled.

## Licences and attribution

The existing project **[MIT licence](LICENSE)** is retained. It does not replace the licences for dependencies, fonts or reference data.

- **Runtime packages:** complete MIT notices for React, React DOM, Scheduler, React Router, React Router DOM, cookie, set-cookie-parser, loose-envify and js-tokens are in [`public/licenses/third-party.txt`](public/licenses/third-party.txt). Development dependencies retain their own npm-package notices.
- **Fonts:** self-hosted Latin-subset Inter, Space Grotesk and JetBrains Mono are distributed under SIL OFL 1.1. Full notices and licence texts are in `public/licenses/inter.txt`, `space-grotesk.txt` and `jetbrains-mono.txt`; embedded font copyright notices are preserved. The combined third-party notice also includes their full OFL texts.
- **Opening references:** added opening names, ECO codes and move orders use the CC0 [lichess-org/chess-openings dataset](https://github.com/lichess-org/chess-openings/tree/712a58be746c143f4ab935b68acc50f4bac813eb), pinned at commit `712a58be746c143f4ab935b68acc50f4bac813eb`. The complete CC0 dedication is in [`public/licenses/opening-data.txt`](public/licenses/opening-data.txt). No opening database is queried at runtime.

Project and third-party notices are included in the deployed site, linked from Settings, and cached for offline access. This documentation and the repository checks are not legal clearance, a trademark search, or a guarantee that software has no defects.
