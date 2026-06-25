import { useCallback, useEffect, useRef, useState } from 'react';
import { RandomAI, Rng, recordPlay } from 'digital-boardgame-framework';
import { adapter, createInitialState } from '../game/adapter';
import { onBoard, inCitadel, wallBlocksStep } from '../game/rules';
import { HUB_SLUG } from './api';
import type { GameState, Action } from '../game/types';

export interface ResetOpts {
  rank?: Record<string, number>;
  credits?: Record<string, number>;
  corporations?: string[];
}

export interface LocalGame {
  state: GameState;
  legal: Action[];
  submit: (a: Action) => void;
  reset: (missionId: string, seed: number, opts?: ResetOpts) => void;
  legionAI: boolean;
  setLegionAI: (v: boolean) => void;
}

/** Hotseat controller: drives the pure adapter directly (no server needed).
 *  Optionally auto-plays the Dark Legion seat with the framework's RandomAI. */
export function useLocalGame(initialMission: string): LocalGame {
  const [state, setState] = useState<GameState>(() =>
    createInitialState({ missionId: initialMission, seed: Date.now() % 100000 }),
  );
  const [legionAI, setLegionAI] = useState(true);
  const aiRng = useRef(Rng.fromState(98765));
  const ai = useRef(new RandomAI<GameState, Action, string>());

  // Best-effort play counter: record one local game start when the mission
  // transitions setup -> play (covers New Game and each campaign mission).
  // The ref guard keeps it to exactly once per start (and dodges StrictMode).
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current === 'setup' && state.phase === 'play') {
      recordPlay(HUB_SLUG, legionAI ? 'ai' : 'hotseat'); // never throws / blocks
    }
    prevPhase.current = state.phase;
  }, [state.phase, legionAI]);

  const submit = useCallback((a: Action) => {
    setState((prev) => {
      const r = adapter.tryApplyAction!(prev, a, adapter.currentActor(prev) ?? '');
      return r.ok ? r.state : prev;
    });
  }, []);

  const reset = useCallback((missionId: string, seed: number, opts?: ResetOpts) => {
    setState(createInitialState({ missionId, seed, ...opts }));
  }, []);

  // Drive the Dark Legion automatically when it's their turn.
  useEffect(() => {
    if (!legionAI) return;
    if (state.phase !== 'play') return;
    if (state.activeSeat !== 'legion') return;
    const t = setTimeout(async () => {
      const actor = adapter.currentActor(state);
      if (actor !== 'legion') return;
      // bias the AI toward attacking/advancing: prefer attacks, else moves toward nearest trooper
      const legal = adapter.legalActions(state, 'legion');
      const attacks = legal.filter((a) => a.type === 'attack');
      let act: Action;
      if (attacks.length) {
        act = attacks[aiRng.current.int(attacks.length)];
      } else {
        const moves = legal.filter((a) => a.type === 'move');
        if (moves.length) act = pickAdvanceMove(state, moves);
        else act = await ai.current.selectAction({ state, actor, adapter, rng: aiRng.current });
      }
      submit(act);
    }, 350);
    return () => clearTimeout(t);
  }, [state, legionAI, submit]);

  const legal =
    state.phase === 'play' && state.activeSeat
      ? adapter.legalActions(state, state.activeSeat)
      : [];

  return { state, legal, submit, reset, legionAI, setLegionAI };
}

// Move a legion figure toward the nearest trooper. Uses a wall-aware shortest
// path (BFS through open steps) rather than straight-line distance, so figures
// route around walls instead of marching into them and wasting their movement.
function pickAdvanceMove(s: GameState, moves: Extract<Action, { type: 'move' }>[]): Action {
  const troopers = s.figures.filter((f) => f.alive && f.owner !== 'legion');
  if (!troopers.length) return moves[0];
  const distMap = trooperDistanceField(s, troopers.map((t) => ({ x: t.x, y: t.y })));
  let best = moves[0];
  let bestD = Infinity;
  for (const m of moves) {
    // path distance from the square this move lands on to the nearest trooper;
    // fall back to straight-line if that square wasn't reached (fully walled off).
    const d = distMap.get(`${m.x},${m.y}`)
      ?? Math.min(...troopers.map((t) => Math.max(Math.abs(m.x - t.x), Math.abs(m.y - t.y))));
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** BFS outward from every trooper through wall-passable steps (ignoring figure
 *  occupancy, since troopers/creatures stand on those squares). Returns a map of
 *  "x,y" → number of steps to the nearest trooper. */
function trooperDistanceField(s: GameState, sources: { x: number; y: number }[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: { x: number; y: number }[] = [];
  for (const src of sources) {
    const key = `${src.x},${src.y}`;
    if (!dist.has(key)) { dist.set(key, 0); queue.push(src); }
  }
  for (let head = 0; head < queue.length; head++) {
    const { x, y } = queue[head];
    const d = dist.get(`${x},${y}`)!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (!onBoard(s, nx, ny) || inCitadel(s, nx, ny)) continue;
        if (wallBlocksStep(s.walls, x, y, nx, ny)) continue;
        const k = `${nx},${ny}`;
        if (dist.has(k)) continue;
        dist.set(k, d + 1);
        queue.push({ x: nx, y: ny });
      }
  }
  return dist;
}
