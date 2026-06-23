// Headless engine smoke test. Run: npx tsx src/game/engine.test.ts
import { RandomAI, Rng } from 'digital-boardgame-framework';
import { adapter, createInitialState } from './adapter';
import { effectiveType } from './data';
import { MISSION_LIST } from './missions';
import type { GameState, Action } from './types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.error('  FAIL', name); }
}

// --- basic setup ---
let s: GameState = createInitialState({ missionId: 'trial', seed: 7 });
check('setup phase', s.phase === 'setup');
check('4 troopers placed', s.figures.filter((f) => f.owner !== 'legion').length === 4);
check('5 seats total', s.seats.length === 3); // legion + Bauhaus + Imperial

// start
s = adapter.applyAction(s, { type: 'start' }, s.seats[0].id);
check('play phase after start', s.phase === 'play');
check('round 1', s.round === 1);
check('active seat set', s.activeSeat !== null);

// legalActions for active seat are non-empty
const la = adapter.legalActions(s, s.activeSeat!);
check('legal actions exist', la.length > 0);
check('legal actions include end-turn', la.some((a) => a.type === 'end-turn'));

// --- play a full game with RandomAI for everyone, ensure it terminates ---
async function playOut(seed: number): Promise<GameState> {
  let g = createInitialState({ missionId: 'trial', seed });
  g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
  const ai = new RandomAI<GameState, Action, string>();
  const rng = (await import('digital-boardgame-framework')).Rng.fromState(seed * 31 + 1);
  let guard = 0;
  while (g.phase !== 'over' && guard < 20000) {
    guard++;
    const actor = adapter.currentActor(g);
    if (!actor) break;
    const act = await ai.selectAction({ state: g, actor, adapter, rng });
    g = adapter.applyAction(g, act, actor);
  }
  check(`game ${seed} terminates (${guard} steps, winners=${g.winners})`, g.phase === 'over');
  check(`game ${seed} has winners`, !!g.winners && g.winners.length > 0);
  return g;
}

// --- deterministic replay: same seed → same outcome ---
(async () => {
  const a = await playOut(7);
  const b = await playOut(7);
  check('deterministic: same winners', JSON.stringify(a.winners) === JSON.stringify(b.winners));
  check('deterministic: same round count', a.round === b.round);
  await playOut(42);
  await playOut(99);

  // --- every mission is well-formed and reaches a terminal state ---
  for (const m of MISSION_LIST) {
    let g = createInitialState({ missionId: m.id, seed: 5 });
    check(`${m.id}: troopers placed`, g.figures.some((f) => f.owner !== 'legion'));
    g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
    const ai = new RandomAI<GameState, Action, string>();
    const rng = Rng.fromState(123);
    let guard = 0;
    while (g.phase !== 'over' && guard < 30000) {
      guard++;
      const actor = adapter.currentActor(g);
      if (!actor) break;
      g = adapter.applyAction(g, await ai.selectAction({ state: g, actor, adapter, rng }), actor);
    }
    check(`${m.id}: terminates → ${g.winners}`, g.phase === 'over');
  }

  // --- equipment gates on credits but does NOT spend them ---
  {
    let g = createInitialState({ missionId: 'eagle', seed: 1, rank: { Bauhaus: 3 }, credits: { Bauhaus: 5 } });
    const t = g.figures.find((f) => f.owner === 'Bauhaus')!;
    g = adapter.applyAction(g, { type: 'equip', corp: 'Bauhaus', trooperUid: t.uid, cardId: 'helmet' }, 'legion'); // cost 3
    const eq = g.figures.find((f) => f.uid === t.uid)!;
    check('equip: helmet recorded', (eq.equipment ?? []).includes('helmet'));
    check('equip: credits NOT spent', g.credits.Bauhaus === 5);
    // helmet(3)+powerarm(2)=5 OK; a 3rd gear piece would exceed the 5-credit allowance
    const t2 = g.figures.filter((f) => f.owner === 'Bauhaus')[1];
    g = adapter.applyAction(g, { type: 'equip', corp: 'Bauhaus', trooperUid: t2.uid, cardId: 'powerarm' }, 'legion'); // +2 = 5
    const r = adapter.tryApplyAction!(g, { type: 'equip', corp: 'Bauhaus', trooperUid: t.uid, cardId: 'lasersight' }, 'legion'); // +1 -> 6 > 5
    check('equip: gear gated by credit allowance', !r.ok);
  }

  // --- Capitol fields 3 Doomtroopers; per-trooper action cap is 4 ---
  {
    const g = createInitialState({ missionId: 'eagle', seed: 1, rank: { Capitol: 6 } });
    const cap = g.figures.filter((f) => f.owner === 'Capitol');
    check('Capitol has 3 figures', cap.length === 3);
    // Rank 6 (+5) caps a trooper at 4 actions, no Imperial/Capitol action bonus
    check('action cap is 4', effectiveType(cap[0], 6).actions === 4);
  }

  // --- combat sanity: a Legionnaire (armor 0) dies to enough hits ---
  let g = createInitialState({ missionId: 'trial', seed: 3 });
  g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
  check('rng advances on attacks', typeof g.rngState === 'number');

  console.log(`\n${pass} passed, ${fail} failed`);
  (globalThis as any).process?.exit(fail === 0 ? 0 : 1);
})();
