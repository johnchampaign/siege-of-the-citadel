# Mutant Chronicles: Siege of the Citadel — digital port

A playable digital implementation of the 1993 tactical board game *Mutant
Chronicles: Siege of the Citadel* (Richard Borg / Target Games), built on the
[`digital-boardgame-framework`](https://www.npmjs.com/package/digital-boardgame-framework).

Doomtroopers from rival corporations strike into the Citadel of the Nepharite
Alakhai while one side commands the Dark Legion. Move square-by-square, reveal
Force Cards that spew creatures, and resolve combat with the white/red/black
dice.

## Run it

```bash
cd app
npm install
npm run dev      # opens the game in your browser
npm test         # headless engine smoke + determinism tests
npm run build    # production build
```

## How it maps to the framework

The framework asks you to implement one `GameAdapter` (four required methods);
everything else — persistence, turn validation, per-player views, async
multiplayer, bug reports — is provided.

| Framework concept              | Here                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| `GameAdapter`                  | [`src/game/adapter.ts`](src/game/adapter.ts)                |
| Deterministic `Rng`            | dice rolls, turn-order draws, creature placement            |
| `legalActions` / `applyAction` | move / attack / pass / end-turn / start                     |
| `currentActor` / `result`      | active seat each turn; winners when the mission resolves     |
| `RandomAI`                     | drives the Dark Legion when "Dark Legion AI" is checked     |

The UI uses a thin local hotseat controller
([`src/ui/useLocalGame.ts`](src/ui/useLocalGame.ts)) that calls the pure
adapter directly — no server required. Because the adapter is pure and the RNG
is seeded, the same seed always replays to the same outcome (asserted in the
tests), which is exactly what the framework's `GameServer` needs for async
multiplayer. Wiring `GameServer` + the `useGame` hook for shareable-URL
multiplayer is a drop-in next step.

## Rules modeled

- **Board** — sectors are the real game tiles (8×8 grids) from the board, laid
  out per mission, with the Citadel and entrance/exit markers.
- **Turn structure** — each round, seats are drawn into a random order and
  revealed one at a time; the active seat plays all its figures.
- **Action economy** — 2 actions/figure; a Move action grants 3 squares
  (Mishima 4); Attack costs 1 action. Creatures act per their reference card
  (Nepharite/Ezoghoul get 3).
- **Movement** — 8-directional, one square per step, blocked by walls and
  figures (no squeezing through wall corners diagonally).
- **Combat** — close (adjacent) and firearm (range 24 + line of sight). Dice:
  white hits on 1–2, red on 1–3, black on 1–4 (per the VASSAL module). Hits
  beyond Armor Factor wound; Doomtroopers roll Kevlarite saves.
- **Force Cards** — face-down on each sector; revealed when a Doomtrooper first
  enters, deploying the listed Dark Legion creatures.
- **Promotion Points** — awarded for kills; used in objectives.
- **Missions** — Trial by Fire (training) and Mission 1: Eagle Strike, with the
  shared mission scaffold ([`src/game/missions.ts`](src/game/missions.ts))
  ready for the rest.

## Artwork — bring your own

**This repository ships no game artwork**, and the deployed site distributes
none. The original *Mutant Chronicles* board tiles, figure counters, rules, and
names are copyrighted and remain © their rights holders.

The game is fully playable out of the box with generated placeholder tokens
(faction-coloured initials) and numbered sector tiles. If you own the game and
want the original art, the in-app **Artwork** panel links to the community
VASSAL module (`Mutantchronicles_2.0.vmod`). Download it, click **Load .vmod
file**, and the app unzips it and extracts the images **entirely in your
browser** ([`src/ui/assets.tsx`](src/ui/assets.tsx)) — nothing is uploaded. The
extracted images are cached in IndexedDB so it's a one-time step per device.

## Project layout

```
src/game/        pure engine (no React, runs headless / under the framework)
  types.ts         state, actions, figure/mission shapes
  data.ts          Doomtrooper roster + Dark Legion creature stats
  rules.ts         geometry, movement, line of sight, dice & combat
  missions.ts      mission definitions + Force Card decks
  adapter.ts       the GameAdapter (turn flow, win conditions)
  engine.test.ts   headless smoke + determinism tests
src/ui/          React UI (board, panel, local hotseat controller)
public/maps/     sector board tiles
public/tokens/   figure counters
```
