// Structured game-log choke point (framework log-format v2).
//
// Every log line the engine emits goes through logEvent(). Each entry carries:
//   kind    — event id from the registry in docs/log-events.md
//   msg     — the human-readable prose (the flavor text lives here)
//   payload — structured data; payload.depth=1 marks a sub-event so the UI
//             can indent from structure instead of leading spaces (the old
//             prose log faked hierarchy with two leading spaces).
import { appendGameLog } from 'digital-boardgame-framework';
import type { GameState } from './types';

/** In-state log cap: appendGameLog trims to the newest LOG_CAP entries
 *  (seq stays monotonic so trimming is detectable). */
export const LOG_CAP = 500;

export type LogPayload = Record<string, unknown> & { depth?: number };

export function logEvent(
  s: GameState,
  kind: string,
  msg: string,
  payload?: LogPayload,
  side?: string | null,
): void {
  appendGameLog(s.log, { turn: s.round, phase: s.phase, side: side ?? null, kind, msg, payload }, LOG_CAP);
}
