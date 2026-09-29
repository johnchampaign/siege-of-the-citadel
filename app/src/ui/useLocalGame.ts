import { useCallback, useEffect, useRef, useState } from 'react';
import { recordPlay, recordFinish, type PlayMode } from 'digital-boardgame-framework';
import { adapter, createInitialState } from '../game/adapter';
import { chooseAction } from '../game/ai';
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
 *  Optionally auto-plays the Dark Legion seat with the tactical AI (game/ai.ts). */
export function useLocalGame(initialMission: string): LocalGame {
  const [state, setState] = useState<GameState>(() =>
    createInitialState({ missionId: initialMission, seed: Date.now() % 100000 }),
  );
  const [legionAI, setLegionAI] = useState(true);

  // Best-effort play counter: record one local game start when the mission
  // transitions setup -> play (covers New Game and each campaign mission), and
  // one finish when it transitions play -> over. The finish reuses the start's
  // mode (the AI toggle can change mid-game) so the hub's finished ÷ started
  // lines up. The ref guard keeps each to exactly once (and dodges StrictMode).
  const prevPhase = useRef(state.phase);
  const startMode = useRef<PlayMode | null>(null);
  useEffect(() => {
    if (prevPhase.current === 'setup' && state.phase === 'play') {
      startMode.current = legionAI ? 'ai' : 'hotseat';
      recordPlay(HUB_SLUG, startMode.current); // never throws / blocks
    }
    if (prevPhase.current === 'play' && state.phase === 'over' && startMode.current) {
      const mode = startMode.current;
      // vs the AI the human plays the Doomtroopers.
      const outcome = mode === 'ai' ? (state.winners?.some((w) => w !== 'legion') ? 'win' : 'loss') : undefined;
      recordFinish(HUB_SLUG, mode, outcome ? { outcome } : {}); // never throws / blocks
      startMode.current = null;
    }
    prevPhase.current = state.phase;
  }, [state.phase, state.winners, legionAI]);

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
    const t = setTimeout(() => {
      if (adapter.currentActor(state) !== 'legion') return;
      submit(chooseAction(state, 'legion'));
    }, 350);
    return () => clearTimeout(t);
  }, [state, legionAI, submit]);

  const legal =
    state.phase === 'play' && state.activeSeat
      ? adapter.legalActions(state, state.activeSeat)
      : [];

  return { state, legal, submit, reset, legionAI, setLegionAI };
}
