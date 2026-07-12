# Game-log event registry — Siege of the Citadel

The game log is `GameState.log: GameLogEntry<string>[]` (framework
`digital-boardgame-framework` log-format v2, schema v3+). Every entry goes
through `logEvent()` in `app/src/game/log.ts` (cap: 500 entries; `seq` is
monotonic so trimming is detectable).

Common fields: `seq`, `turn` (round number), `phase`, `side` (acting seat or
`null` for neutral events), `kind`, `msg` (the human prose — flavor text lives
here), `payload` (structured data).

**Hierarchy:** sub-events carry `payload.depth: 1`. The UI indents from that
field (`app/src/ui/LogLines.tsx`) — never from leading whitespace. Entries
with `kind: 'legacy'` were wrapped from old prose logs by `adapter.migrate()`
(via `upgradeProseLog`); those may still start with two spaces, and the UI
derives depth 1 from that for them only.

## Kinds

| kind | depth | payload |
|---|---|---|
| `setup` | 0 | `{ missionId, corps }` — initial entry at game creation |
| `round.start` | 0 | `{ round }` |
| `turn.start` | 0 | `{ seat }` (side = seat) |
| `turn.pass` | 0 | `{ seat }` — no actions remaining, turn auto-passes |
| `event.draw` | 0 | `{ eventId, name, spawn: string[] }` — Dark Legion event card (side = legion) |
| `event.effect` | 1 | `{ effect, ... }` — sub-effect of the event: `pair-cap {corp,total}`, `legion-teleport {uid,x,y}`, `direct-damage {dice,color,hits,targetUid}` |
| `force.reveal` | 0 | `{ sector, cardId, spawn: string[] }` — Force Card flips, creatures deploy |
| `combat.roll` | 0 (second target: 1) | `{ attackerUid, attackerOwner, targetUid, weapon, weaponKind, area?, dice: number[], color, hits, armor?, saves?, damage?, killed? }` |
| `combat.damage` | 1 | `{ targetUid, typeId, wounds, left, strength, saves, armor }` |
| `combat.kill` | 1 | `{ targetUid, typeId, by, pp?, ppTotal? }` |
| `combat.dud` | 1 | `{ attackerUid, targetCorp }` — Dud Round card fizzles a Legion hit |
| `combat.friendly-fire` | 0 | `{ attackerUid, targetUid, corp, ppLoss: 3 }` |
| `credits.loss` | 1 | `{ corp, amount, remaining }` — Doomtrooper eliminated |
| `promotion.loss` | 1 | `{ corp, amount, total, reason }` — no Credits, −5 PP instead |
| `card.play` | 0 | `{ corp, cardId, power, name, effect }` — Doomtrooper Card played (side = corp) |
| `card.effect` | 1 | `{ effect, ... }` — per-effect fields mirroring the power: `armor-down`, `attack-legion`, `mind-control`, `teleport {uid,x,y}`, `move-force-card {sector}`, `door {uid,dir}`, `pp-steal {corp,from,gained,lost}`, `card-steal`, `card-discard`, `debuff-move`/`debuff-firearm {targetUid}`, `no-melee-vs {corp,vs}`, `cap-1`, `lose-extra`, `false-orders` |
| `figure.escape` | 0 | `{ uid, typeId, corp }` — trooper exits the board |
| `mission.secondary` | 0 | `{ corp, mission, name, pp, credits }` — secret Secondary Mission completed |
| `mission.end` | 0 | `{ winners: string[], reason }` — game over (`msg` starts "GAME OVER — ") |
| `legacy` | from leading spaces | none — prose line wrapped from a schema-v2 (string[]) snapshot |

## Migration

`adapter.migrate()` (schema 2 → 3) runs `upgradeProseLog` on any snapshot
whose `log` is still `string[]`, wrapping each line as a `legacy` entry. The
server (KV round-trip) calls migrate on read, so in-flight games upgrade
transparently.
