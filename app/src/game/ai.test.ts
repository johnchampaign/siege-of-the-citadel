// Tactical AI checks. Run: npx tsx src/game/ai.test.ts
import { Rng } from 'digital-boardgame-framework';
import { adapter, createInitialState } from './adapter';
import { chooseAction, aiLineOfSight } from './ai';
import { hasLineOfSight, onBoard } from './rules';
import { MISSION_LIST } from './missions';
import type { GameState, Figure, Wall } from './types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.error('  FAIL', name); }
}

/** A started game stripped down to hand-placed figures on an (optionally) wall-free board. */
function scenario(missionId: string, figs: Partial<Figure>[], walls: Wall[] = []): GameState {
  let g = createInitialState({ missionId, seed: 1 });
  g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
  g.walls = walls;
  g.forceCards.forEach((f) => { f.revealed = true; });
  g.roundFx = {};
  g.figures = figs.map((f, i) => ({
    uid: `f${i}`, x: 0, y: 0, woundsTaken: 0, actionsLeft: 2, actionsTaken: 0, alive: true, ...f,
  } as Figure));
  for (const c of Object.keys(g.extraPool)) g.extraPool[c] = 0;
  for (const c of Object.keys(g.doomHands)) g.doomHands[c] = [];
  (g as any)._steps = {};
  return g;
}

/** Let the AI play `seat`'s turn to its end; returns the state right after. */
function playTurn(g: GameState, seat: string): GameState {
  g.activeSeat = seat;
  g.drawOrder = [];
  for (let i = 0; i < 200 && g.phase === 'play' && g.activeSeat === seat; i++) {
    g = adapter.applyAction(g, chooseAction(adapter.viewFor(g, seat), seat), seat);
  }
  return g;
}

(async () => {
  // --- the AI's sight lines agree with the engine's, on every board ---
  {
    const rng = Rng.fromState(77);
    let agree = 0, total = 0;
    for (const m of MISSION_LIST) {
      const g = createInitialState({ missionId: m.id, seed: 3 });
      const xs = g.sectors.flatMap((s) => [s.ox, s.ox + s.size - 1]);
      const ys = g.sectors.flatMap((s) => [s.oy, s.oy + s.size - 1]);
      const W = Math.max(...xs) + 1, H = Math.max(...ys) + 1;
      for (let i = 0; i < 400; i++) {
        const ax = rng.int(W), ay = rng.int(H), bx = rng.int(W), by = rng.int(H);
        if (!onBoard(g, ax, ay) || !onBoard(g, bx, by)) continue;
        total++;
        if (aiLineOfSight(g, ax, ay, bx, by) === hasLineOfSight(g, ax, ay, bx, by)) agree++;
      }
    }
    check(`AI line of sight matches the engine (${agree}/${total})`, agree === total && total > 1000);
  }

  // --- takes a good shot: an adjacent Legionnaire gets attacked ---
  {
    const g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 5, y: 5 },
      { typeId: 'legionnaire', owner: 'legion', x: 6, y: 5 },
    ]);
    g.activeSeat = 'Bauhaus';
    const a = chooseAction(g, 'Bauhaus');
    check('attacks an adjacent Legionnaire', a.type === 'attack' && a.targetUid === 'f1');
  }

  // --- uses cover: can't shoot back, so it steps out of the Razide's sight ---
  {
    // A wall along the south edge of row 5 (x 0..3) shades the squares above it
    // from a Razide 8 squares south. Mental Block: the trooper can't fire back.
    const walls: Wall[] = [0, 1, 2, 3].map((x) => ({ x, y: 5, dir: 'S' as const }));
    let g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 4, y: 4, actionsLeft: 1 },
      { typeId: 'razide', owner: 'legion', x: 4, y: 12 },
    ], walls);
    g.win = { kind: 'survive' };
    g.roundFx = { noFirearm: true };
    check('cover scenario: starts exposed', hasLineOfSight(g, 4, 4, 4, 12));
    g = playTurn(g, 'Bauhaus');
    const t = g.figures.find((f) => f.uid === 'f0')!;
    check(`moves out of the Razide's line of sight (ends at ${t.x},${t.y})`, !hasLineOfSight(g, t.x, t.y, 4, 12));
  }

  // --- the Legion closes in, and a mission boss keeps out of the firing line ---
  {
    // Trooper at (4,4) sees straight down column 4; the wall along row 5
    // (x 0..3) shades the squares west of it.
    const walls: Wall[] = [0, 1, 2, 3].map((x) => ({ x, y: 5, dir: 'S' as const }));
    let g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 4, y: 4, actionsLeft: 0 },
      { typeId: 'legionnaire', owner: 'legion', x: 1, y: 13 },
    ], walls);
    g = playTurn(g, 'legion');
    const l = g.figures.find((f) => f.uid === 'f1')!;
    check(`a Legionnaire advances on the trooper (to ${l.x},${l.y})`, l.y <= 8);

    // Ghash (the objective) stands in that line of fire, out of reach of the
    // trooper: losing him loses the mission, so he steps into cover.
    g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 4, y: 4, actionsLeft: 0 },
      { typeId: 'centurion', owner: 'legion', x: 4, y: 12, tag: 'boss' },
    ], walls);
    g.win = { kind: 'eliminate-tagged', tag: 'boss', label: 'Ghash' };
    check('boss scenario: starts exposed', hasLineOfSight(g, 4, 4, 4, 12));
    g = playTurn(g, 'legion');
    const b = g.figures.find((f) => f.uid === 'f1')!;
    check(`the boss takes cover (ends at ${b.x},${b.y})`, !hasLineOfSight(g, b.x, b.y, 4, 4));
  }

  // --- Control Defense System goes where 3 black dice can kill ---
  {
    const g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 5, y: 5 },
      { typeId: 'ezoghoul', owner: 'legion', x: 12, y: 12 },   // armor 3: 3 dice can never kill it
      { typeId: 'razide', owner: 'legion', x: 14, y: 12 },     // armor 2: 3 black dice kill ~30%
    ]);
    g.activeSeat = 'Bauhaus';
    g.doomHands.Bauhaus = ['cds_rcd'];
    const a = chooseAction(g, 'Bauhaus') as any;
    check(`AI aims Control Defense System at the killable Razide (${a.type} ${a.targetUid ?? ''})`,
      a.type === 'play-doom-card' && a.cardId === 'cds_rcd' && a.targetUid === 'f2');
  }

  // --- Commanding Voice: the AI turns a Legion figure on its own side ---
  {
    let g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 5, y: 5 },
      { typeId: 'razide', owner: 'legion', x: 8, y: 8 },        // dangerous, near our trooper
      { typeId: 'centurion', owner: 'legion', x: 9, y: 9 },     // next to it: a kill worth taking
    ]);
    g.doomHands.Bauhaus = ['cv_si'];
    g = playTurn(g, 'Bauhaus');
    const cmdLog = g.log.filter((e) => e.kind === 'card.effect').map((e) => e.msg).join(' | ');
    const turned = g.log.some((e) => e.kind === 'combat.roll' && (e.payload as any)?.attackerUid === 'f1');
    check(`AI commands a Legion figure (${cmdLog})`, /takes command/.test(cmdLog));
    check('…and turns it on another Legion figure', turned);
    check('…and control reverts by the end of the turn', g.commandeer === undefined);
  }

  // --- a Razide walled off from its prey shoots the door out of the way ---
  {
    const walls: Wall[] = Array.from({ length: 16 }, (_, y) => y).filter((y) => y !== 7).map((y) => ({ x: 5, y, dir: 'E' as const }));
    walls.push({ x: 5, y: 7, dir: 'E', door: true });
    const g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 9, y: 7, actionsLeft: 0 },
      { typeId: 'razide', owner: 'legion', x: 5, y: 7 },   // beside the door, trooper beyond it
    ], walls);
    g.activeSeat = 'legion';
    const a = chooseAction(g, 'legion') as any;
    check(`AI Razide attacks the door blocking it (${a.type}${a.weaponIdx !== undefined ? ' w' + a.weaponIdx : ''})`, a.type === 'attack-door' && a.weaponIdx === 1);
  }

  // --- Remote Controlled Door: seal the gap a monster would come through… ---
  {
    // A wall down x=5|6 (rows 0..15) with one gap at row 7.
    const wallLine = (): Wall[] => Array.from({ length: 16 }, (_, y) => y).filter((y) => y !== 7).map((y) => ({ x: 5, y, dir: 'E' as const }));
    let g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 7, y: 7 },
      { typeId: 'ezoghoul', owner: 'legion', x: 2, y: 7 },   // can walk through the gap and strike this turn
    ], wallLine());
    g.win = { kind: 'survive' };
    g.activeSeat = 'Bauhaus';
    g.doomHands.Bauhaus = ['cds_rcd'];
    const a = chooseAction(g, 'Bauhaus') as any;
    check(`AI seals the gap between the Ezoghoul and its trooper (${a.type} ${a.x ?? ''},${a.y ?? ''} ${a.dir ?? ''})`,
      a.type === 'play-doom-card' && a.power === 1 && a.x === 5 && a.y === 7 && a.dir === 'E');

    // …and mid-turn: a trooper that has already acted (so this isn't turn start)
    // and has nothing left to do seals the gap rather than just ending the turn.
    g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 7, y: 7, actionsLeft: 0, actionsTaken: 2 },
      { typeId: 'ezoghoul', owner: 'legion', x: 2, y: 7 },
    ], wallLine());
    g.win = { kind: 'survive' };
    g.activeSeat = 'Bauhaus';
    g.doomHands.Bauhaus = ['cds_rcd'];
    const m = chooseAction(g, 'Bauhaus') as any;
    check(`AI seals the gap mid-turn instead of ending its turn (${m.type} ${m.x ?? ''},${m.y ?? ''} ${m.dir ?? ''})`,
      m.type === 'play-doom-card' && m.power === 1 && m.x === 5 && m.y === 7 && m.dir === 'E');

    // …but not the gap it needs to reach its own exit, when the threat is on its side.
    g = scenario('trial', [
      { typeId: 'steiner', owner: 'Bauhaus', x: 7, y: 7 },
      { typeId: 'ezoghoul', owner: 'legion', x: 12, y: 7 },
    ], wallLine());
    g.win = { kind: 'escape', count: 1 };
    g.exits = [{ x: 0, y: 7 }];
    g.activeSeat = 'Bauhaus';
    g.doomHands.Bauhaus = ['cds_rcd'];
    const b = chooseAction(g, 'Bauhaus') as any;
    check(`AI does not wall off its own route (${b.type}${b.dir ? ` door ${b.x},${b.y} ${b.dir}` : ''})`, !(b.type === 'play-doom-card' && b.power === 1));
  }

  // --- pursues the objective: a trooper near the exit escapes (and wins Trapped!) ---
  {
    let g = createInitialState({ missionId: 'trapped', seed: 1 });
    g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
    const t = g.figures.find((f) => f.owner === 'Bauhaus')!;
    t.x = 21; t.y = 4; t.actionsLeft = 2; t.actionsTaken = 0;
    // Round 1's event may have spawned creatures on the exits (they double as
    // Legion entrances) — keep only the far-off hunting Ezoghoul.
    g.figures = g.figures.filter((f) => f.owner !== 'legion' || f.tag === 'hunter');
    g = playTurn(g, 'Bauhaus');
    check('a trooper within reach of the exit escapes', g.escaped >= 1);
    check('…which wins the escape mission', g.phase === 'over' && !!g.winners?.includes('Bauhaus'));
  }

  // --- every mission plays to an end with the AI on both sides (legal moves only) ---
  for (const m of MISSION_LIST) {
    let g = createInitialState({ missionId: m.id, seed: 11 });
    g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
    let steps = 0, illegal = 0;
    while (g.phase !== 'over' && steps++ < 20000) {
      const actor = adapter.currentActor(g)!;
      const r = adapter.tryApplyAction!(g, chooseAction(adapter.viewFor(g, actor), actor), actor);
      if (!r.ok) { illegal++; break; }
      g = r.state;
    }
    check(`${m.id}: AI vs AI ends by round ${g.round} → ${g.winners}`, g.phase === 'over' && illegal === 0);
  }

  // --- Training is a 10-round mission that competent troopers can finish ---
  {
    let wins = 0;
    for (let seed = 0; seed < 5; seed++) {
      let g = createInitialState({ missionId: 'trial', seed: 5000 + seed });
      g = adapter.applyAction(g, { type: 'start' }, g.seats[0].id);
      while (g.phase !== 'over') { const a = adapter.currentActor(g)!; g = adapter.applyAction(g, chooseAction(adapter.viewFor(g, a), a), a); }
      check(`training game ${seed} ends within 10 rounds (${g.round})`, g.round <= 10);
      if (g.winners!.some((w) => w !== 'legion')) wins++;
    }
    check(`AI troopers usually win Training (${wins}/5)`, wins >= 3);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  (globalThis as any).process?.exit(fail === 0 ? 0 : 1);
})();
