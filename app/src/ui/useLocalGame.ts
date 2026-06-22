import { useCallback, useEffect, useRef, useState } from 'react';
import { RandomAI, Rng } from 'digital-boardgame-framework';
import { adapter, createInitialState } from '../game/adapter';
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

// Move a legion figure toward the nearest trooper.
function pickAdvanceMove(s: GameState, moves: Extract<Action, { type: 'move' }>[]): Action {
  const troopers = s.figures.filter((f) => f.alive && f.owner !== 'legion');
  if (!troopers.length) return moves[0];
  let best = moves[0];
  let bestD = Infinity;
  for (const m of moves) {
    const f = s.figures.find((x) => x.uid === m.uid);
    if (!f) continue;
    for (const t of troopers) {
      const d = Math.max(Math.abs(m.x - t.x), Math.abs(m.y - t.y));
      if (d < bestD) { bestD = d; best = m; }
    }
  }
  return best;
}
