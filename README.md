# Siege of the Citadel

A free, browser-based digital adaptation of the **1993** board game
*Mutant Chronicles: Siege of the Citadel*. Play solo against a Dark Legion AI,
hotseat, or online with friends — no install, no account.

**▶ Play: https://siege-of-the-citadel.pages.dev**

> This is an unofficial fan project, not affiliated with or endorsed by the
> publisher or rights holders. See [Game content & IP](#game-content--ip) below.

## No artwork is distributed

Out of the box the board, tiles, the Citadel and figures render as original,
**art-free tokens**, and the game is fully playable that way. Optionally, if you
own the community VASSAL module, you can load your own `.vmod` file and the app
extracts the images it needs **entirely in your browser** (cached locally on
your device). Nothing is uploaded, hosted, or redistributed — this repository
ships no game artwork.

## Features

- All **11 missions** — the *Trial by Fire* training mission plus Primary
  Missions 1–10.
- **Solo vs. a Dark Legion AI**, hotseat, or **online multiplayer** with
  per-player private links and server-authoritative hidden information.
- Faithful to the **1993 rulebook**: square-grid movement, line of sight with
  the tiles' real walls (no shooting across off-board gaps), close/firearm
  combat, Kevlarite armour saves, Force / Event / Doomtrooper / Secondary
  Mission cards.
- The **Citadel** modelled as the real 16×16 crosshair piece (thin wing-walls
  with doorway gaps and the central base).
- Full **equipment & economy**: rank-gated weapons, credit-cost gear,
  Promotion Points → Rank, and the 1993 Credit system (credits gate your
  loadout rather than being spent, carry over between missions, lost when a
  Doomtrooper falls).
- **Campaign** as a faithful points race: play missions in any order, replay
  earlier ones, carry Rank/PP/Credits forward; first corporation to the points
  target wins. Standing saves locally and can be resumed on any device via a
  short campaign code or shareable `?campaign=` link.

## Tech

- `app/` — Vite + React + TypeScript client. The game engine is pure TypeScript
  in `app/src/game/`.
- `server/` — a Cloudflare Worker (KV-backed) for online games and cross-device
  campaign saves.
- Hosted on Cloudflare Pages + Workers.

### Develop

```sh
cd app
npm install
npm run dev      # local dev server
npm test         # engine tests
npm run build    # production build
```

## Game content & IP

The MIT license in [`LICENSE`](LICENSE) covers **only the original source code**
in this repository. It does **not** cover any *Mutant Chronicles* /
*Siege of the Citadel* intellectual property — names, rules, artwork, board
tiles, or figure counters — which remain the property of their respective rights
holders. This project ships no game artwork; players who own the game may load
the community VASSAL module locally, with image extraction happening in the
browser on the player's own device.

## License

[MIT](LICENSE) © 2026 John Champaign (source code only).


## Feedback & contributions

The most useful thing you can send is an **in-game problem report** — the report
button inside the game. Filed while you're playing, it captures the game state and
context that make an issue reproducible, which helps far more than a code change.

**Pull requests generally won't be merged.** This is a solo-maintained project, and
reviewing and integrating outside code costs more than it saves. If you open a PR,
it'll be read as a well-specified bug report or feature request and implemented here
rather than merged — so it's a fine way to *describe* a change you'd like, just
please don't expect it to land as-is.

**The whole codebase is MIT-licensed** — fork it and do whatever you want: change
the rules, reskin it, build and ship your own version. No permission needed; that's
the point of the license.
