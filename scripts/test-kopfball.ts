/**
 * Tests ohne Browser für Kopfball-Duell und Kopf-Korb (gemeinsame Engine `server/kopfball.ts`):
 * Anstoß per Los und danach immer für das Team, das kassiert hat; Gegner bleiben beim Anstoß in ihrer Hälfte;
 * Tore unter der Latte (nicht drüber), Körbe durch den Ring (2 bzw. 3 Punkte von hinter der Mitte); Schuss Richtung
 * gegnerisches Tor, Kopfball, Sprung (Knopf und Stick hoch), Loslassen; Ende bei 5 Toren, Aufwärmrunde ohne Ende;
 * Dauerlauf mit Zufallseingaben: Ball bleibt im Feld und bleibt nirgends hängen.
 * Aufruf: `npm run test:kopfball`
 */
import { KopfballGame } from '../server/kopfball';
import type { MiniCtx, MiniResult } from '../server/minigame';
import { KB, kbField, kbThrowVelocity } from '../shared/kopfball';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};

function newGame(kind: 'kopfball' | 'kopfkorb', ids = ['a', 'b'], extra: Partial<MiniCtx> = {}) {
  const results: MiniResult[] = [];
  const ctx: MiniCtx = {
    onChange() {},
    finish: (r) => results.push(r),
    isConnected: () => true,
    nameOf: (id) => id,
    mode: 'arcade',
    // Feste Teams: a, c, e … = Sonne (links), b, d, f … = Meer (rechts)
    warmTeams: { A: ids.filter((_, i) => i % 2 === 0), B: ids.filter((_, i) => i % 2 === 1), label: '' },
    ...extra,
  };
  const game = new KopfballGame(ids, ctx, kind);
  const t = game.testApi();
  return { game, t, results };
}

const G = KB.GROUND;

console.log('Anstoß / Einwurf:');
{
  // Erster Anstoß per Los: über viele Spiele beide Teams
  const seen = { A: 0, B: 0 };
  for (let i = 0; i < 200; i++) {
    const { game, t } = newGame('kopfball');
    seen[t.kick]++;
    game.dispose();
  }
  check(seen.A > 60 && seen.B > 60, `erster Anstoß per Los (Sonne ${seen.A}×, Meer ${seen.B}× von 200)`);

  // Countdown → Anstoß mit schwebendem Ball in der Hälfte des Teams mit Anstoß
  const { game, t } = newGame('kopfball');
  const st0 = t.snapshot();
  check(st0.sub === 'countdown' && st0.first, 'Spiel beginnt mit Countdown (erster Anstoß)');
  const f = t.field;
  const k0 = st0.kick;
  check((k0 === 'A' ? st0.ball.x < f.mid : st0.ball.x > f.mid), `Ball schwebt in der Hälfte von Team ${k0}`);
  t.step(Math.ceil(KB.COUNTDOWN_MS / KB.TICK_MS) + 2);
  check(t.sub === 'play' && t.hold, 'nach dem Countdown: Spiel läuft, Ball schwebt (Anstoß)');
  // Gegner läuft Richtung Ball – darf nicht über die Mittellinie
  const opp = k0 === 'A' ? 'b' : 'a';
  t.pad(opp, { x: k0 === 'A' ? -1 : 1 });
  t.step(30);
  const ox = t.player(opp).x;
  check(k0 === 'A' ? ox >= f.mid : ox <= f.mid, `Gegner bleibt beim Anstoß in seiner Hälfte (x = ${ox.toFixed(1)})`);
  const by = t.ball.y;
  check(t.hold && Math.abs(by - (G - 30)) < 0.5, 'Ball schwebt, solange ihn niemand berührt');
  t.pad(opp, { x: 0 });
  // Anstoß-Team läuft in den Ball → Ball frei
  const kicker = k0 === 'A' ? 'a' : 'b';
  t.pad(kicker, { x: k0 === 'A' ? 1 : -1 });
  t.step(20);
  check(!t.hold, 'Berührung durch das Anstoß-Team gibt den Ball frei');
  game.dispose();

  // Tor für A → Anstoß B; Tor für B → Anstoß A (mehrmals hintereinander)
  const g2 = newGame('kopfball');
  g2.t.begin();
  let okAll = true;
  const order: string[] = [];
  for (const scorer of ['A', 'A', 'B', 'A', 'B', 'B'] as const) {
    // Schwebenden Ball des Anstoßes weg, freies Spiel
    g2.t.begin();
    g2.t.pad('a', { x: 0 });
    g2.t.pad('b', { x: 0 });
    g2.t.setPlayer('a', f.mid - 60);
    g2.t.setPlayer('b', f.mid + 60);
    // Ball rollt ins Tor des anderen Teams
    if (scorer === 'A') g2.t.setBall(f.goalLine.B + 2, G - 20, 300, 0);
    else g2.t.setBall(f.goalLine.A - 2, G - 20, -300, 0);
    g2.t.step(3);
    const goalOk = g2.t.sub === 'goal';
    g2.t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 3);
    const want = scorer === 'A' ? 'B' : 'A';
    const k = g2.t.kick;
    const s = g2.t.snapshot();
    const ballSide = want === 'A' ? s.ball.x < f.mid : s.ball.x > f.mid;
    order.push(`${scorer}→${k}`);
    if (!goalOk || k !== want || !g2.t.hold || !ballSide) okAll = false;
  }
  check(okAll, `nach jedem Tor hat das Team Anstoß, das kassiert hat (${order.join(', ')})`);
  check(g2.t.score.A === 3 && g2.t.score.B === 3, `Spielstand stimmt (${g2.t.score.A}:${g2.t.score.B})`);
  g2.game.dispose();

  // Korb: Ball fällt durch den Ring von Meer → 2 Punkte Sonne, Einwurf Meer (und umgekehrt)
  const k2 = newGame('kopfkorb');
  const kf = k2.t.field;
  const res: string[] = [];
  let kOk = true;
  for (const scorer of ['A', 'B', 'B'] as const) {
    k2.t.begin();
    k2.t.setPlayer('a', kf.mid - 60);
    k2.t.setPlayer('b', kf.mid + 60);
    const h = kf.hoops[scorer === 'A' ? 'B' : 'A'];
    k2.t.setBall((h.xb + h.xf) / 2, h.y - 30, 0, 0);
    k2.t.step(15);
    const scored = k2.t.sub === 'goal';
    k2.t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 3);
    const want = scorer === 'A' ? 'B' : 'A';
    res.push(`${scorer}→${k2.t.kick}`);
    if (!scored || k2.t.kick !== want || !k2.t.hold) kOk = false;
  }
  check(kOk && k2.t.score.A === 2 && k2.t.score.B === 4, `Korb: Einwurf für das Team, das kassiert hat (${res.join(', ')}; ${k2.t.score.A}:${k2.t.score.B})`);
  // Beim Einwurf darf die Verteidigung sofort ran (kein ungestörter Dreier)
  const opp2 = k2.t.kick === 'A' ? 'b' : 'a';
  k2.t.pad(opp2, { x: k2.t.kick === 'A' ? -1 : 1 });
  k2.t.step(25);
  const ox2 = k2.t.player(opp2).x;
  check(k2.t.kick === 'A' ? ox2 < kf.mid : ox2 > kf.mid, 'Korb: Verteidigung darf beim Einwurf über die Mittellinie');
  k2.game.dispose();
}

console.log('\nTore und Körbe:');
{
  const { game, t } = newGame('kopfball');
  t.begin();
  const f = t.field;
  t.setPlayer('a', f.mid);
  t.setPlayer('b', f.mid + 40);
  // Ball fliegt über die Latte ins Aus – kein Tor
  t.setBall(f.goalLine.A + 30, G - KB.GOAL_H - 30, -260, -40);
  t.step(40);
  check(t.sub === 'play' && t.score.B === 0, 'Ball über die Latte: kein Tor');
  // Ball unter der Latte ins linke Tor → Punkt für Meer
  t.setBall(f.goalLine.A + 30, G - 30, -320, -60);
  t.step(20);
  check(t.score.B === 1 && t.sub === 'goal', 'Ball unter der Latte ins linke Tor: Tor für Team Meer');
  game.dispose();

  // Lattentreffer prallt ab
  const g3 = newGame('kopfball');
  g3.t.begin();
  g3.t.setPlayer('a', f.mid);
  g3.t.setPlayer('b', f.mid + 40);
  const bar = g3.t.field.solids[0];
  g3.t.setBall(bar.x + bar.w + 20, bar.y + bar.h / 2, -300, 0);
  g3.t.step(6);
  check(g3.t.ball.vx > 0 && g3.t.score.B === 0, `Ball gegen die Lattenkante prallt zurück (vx = ${g3.t.ball.vx.toFixed(0)})`);
  g3.game.dispose();

  // Korb: Ball fällt durch den Ring → 2 Punkte; Wurf von hinter der Mitte → 3
  const k = newGame('kopfkorb');
  k.t.begin();
  const kf = k.t.field;
  k.t.setPlayer('a', kf.mid - 100);
  k.t.setPlayer('b', kf.mid + 100);
  const hB = kf.hoops.B;
  const hx = (hB.xb + hB.xf) / 2;
  // Zuletzt berührt von a nahe am Korb (über die API: Wurf aus kurzer Distanz)
  k.t.setPlayer('a', hx - 50);
  k.t.setBall(hx - 46, G - 20);
  let made = 0;
  let pts = 0;
  for (let i = 0; i < 40; i++) {
    k.t.setPlayer('a', hx - 50);
    k.t.setPlayer('b', kf.mid - 60);
    k.t.setBall(hx - 44, G - 18);
    const before = k.t.score.A;
    k.t.pad('a', { kick: false });
    k.t.step(1);
    k.t.pad('a', { kick: true });
    k.t.step(70);
    const d = k.t.score.A - before;
    if (d > 0) {
      made++;
      pts = d;
    }
    // Zurück ins Spiel
    if (k.t.sub === 'goal') k.t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 2);
    k.t.begin();
  }
  check(made >= 30 && pts === 2, `Wurf aus kurzer Distanz trifft meist (${made}/40) und zählt 2 Punkte`);
  let made3 = 0;
  let pts3 = 0;
  for (let i = 0; i < 40; i++) {
    const x = kf.mid - 40;
    k.t.setPlayer('a', x);
    k.t.setPlayer('b', kf.x0 + 30);
    k.t.setBall(x + 8, G - 20);
    const before = k.t.score.A;
    k.t.pad('a', { kick: false });
    k.t.step(1);
    k.t.pad('a', { kick: true });
    k.t.step(90);
    const d = k.t.score.A - before;
    if (d > 0) {
      made3++;
      pts3 = d;
    }
    if (k.t.sub === 'goal') k.t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 2);
    k.t.begin();
  }
  check(made3 >= 6 && made3 <= 34 && pts3 === 3, `Dreier aus der eigenen Hälfte: manchmal (${made3}/40), zählt 3 Punkte`);
  k.game.dispose();

  // Wurfbahn ohne Streuung geht durch den Ring
  const f2 = kbField('korb', 2);
  const v = kbThrowVelocity(f2.mid, G - 50, f2.hoops.B);
  check(v.vx > 0 && v.vy < 0, `Wurf zum rechten Korb geht nach rechts oben (vx ${v.vx.toFixed(0)}, vy ${v.vy.toFixed(0)})`);
}

console.log('\nSteuerung:');
{
  const { game, t } = newGame('kopfball');
  t.begin();
  const f = t.field;
  t.setPlayer('a', f.mid - 40);
  t.setPlayer('b', f.x1 - 40);
  // Schuss: flacher Ball vor dem Fuß fliegt Richtung gegnerisches Tor (rechts) und hoch
  t.setBall(f.mid - 40 + 16, G - KB.BALL_R);
  t.pad('a', { kick: true });
  t.step(1);
  check(t.ball.vx > 250 && t.ball.vy < -100, `SCHUSS: Ball fliegt nach rechts oben (vx ${t.ball.vx.toFixed(0)}, vy ${t.ball.vy.toFixed(0)})`);
  t.pad('a', { kick: false });
  // Meer schießt nach links
  t.setBall(f.x1 - 40 - 16, G - KB.BALL_R);
  t.pad('b', { kick: true });
  t.step(1);
  check(t.ball.vx < -250, `SCHUSS von Team Meer geht nach links (vx ${t.ball.vx.toFixed(0)})`);
  t.pad('b', { kick: false });
  // Abklingzeit: sofort nochmal drücken schießt nicht
  t.setBall(f.x1 - 40 - 16, G - KB.BALL_R);
  t.pad('b', { kick: true });
  t.step(1);
  check(Math.abs(t.ball.vx) < 50, 'SCHUSS gleich danach: Abklingzeit, kein zweiter Schuss');
  t.pad('b', { kick: false });
  // Kopfball: Ball fällt auf den Kopf → springt wieder hoch, leicht Richtung gegnerisches Tor
  t.setPlayer('a', f.mid - 40);
  t.setBall(f.mid - 40, G - 110, 0, 0);
  let up = false;
  for (let i = 0; i < 30; i++) {
    t.step(1);
    if (t.ball.vy < -100 && t.ball.y < G - 40) {
      up = true;
      break;
    }
  }
  check(up && t.ball.vx > 0, `Kopfball: Ball prallt vom Kopf nach oben, Richtung Meer-Tor (vx ${t.ball.vx.toFixed(0)})`);
  // Sprung per Knopf und per Stick hoch
  t.setPlayer('a', f.mid - 40);
  t.pad('a', { jump: true });
  t.step(6);
  const hJump = G - t.player('a').y;
  t.pad('a', { jump: false });
  t.step(40);
  check(hJump > 30 && t.player('a').y === G && !t.player('a').air, `SPRUNG: hoch (${hJump.toFixed(0)} px) und wieder gelandet`);
  t.pad('a', { y: -0.9 });
  t.step(6);
  const hStick = G - t.player('a').y;
  t.pad('a', { y: 0 });
  t.step(40);
  check(hStick > 30, `Stick nach oben springt auch (${hStick.toFixed(0)} px)`);
  // Laufen und Loslassen (neutrale Eingabe wie nach input-reset / Halte-Timeout)
  const x0 = t.player('a').x;
  t.pad('a', { x: 1 });
  t.step(15);
  const ran = t.player('a').x - x0;
  t.pad('a', { x: 0, y: 0, jump: false, kick: false });
  t.step(6);
  const x1 = t.player('a').x;
  t.step(10);
  check(ran > 40 && Math.abs(t.player('a').x - x1) < 0.5, `Stick rechts: läuft (${ran.toFixed(0)} px in 0,5 s), losgelassen: steht`);
  game.dispose();
}

console.log('\nSpielende und Aufwärmrunde:');
{
  const { game, t, results } = newGame('kopfball', ['a', 'b', 'c']);
  t.begin();
  const f = t.field;
  check(f.size === 2 && f.w > kbField('fuss', 1).w, `1 gegen 2: Feld für 2 pro Seite (${f.w} px)`);
  for (let i = 0; i < KB.TARGET.fuss; i++) {
    t.setBall(f.goalLine.B + 2, G - 20, 300, 0);
    t.step(3);
    t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 3);
    if (t.sub !== 'over') t.begin();
  }
  check(t.sub === 'over' && t.winner === 'A', `${KB.TARGET.fuss} Tore: Team Sonne gewinnt (${t.score.A}:${t.score.B})`);
  game.dispose();
  void results;

  const p = newGame('kopfball', ['a', 'b'], { practice: true });
  check(p.t.sub === 'kickoff', 'Aufwärmrunde: ohne Countdown');
  p.t.step(30);
  const c0 = p.t.clock;
  p.t.step(300);
  check(p.t.clock === c0, 'Aufwärmrunde: keine Spieluhr');
  for (let i = 0; i < KB.TARGET.fuss + 2; i++) {
    p.t.begin();
    p.t.setBall(p.t.field.goalLine.B + 2, G - 20, 300, 0);
    p.t.step(3);
    p.t.step(Math.ceil((KB.GOAL_MS + KB.KICKOFF_MS) / KB.TICK_MS) + 3);
  }
  check(p.t.sub !== 'over' && p.t.score.A === KB.TARGET.fuss + 2, `Aufwärmrunde: kein Ende nach ${KB.TARGET.fuss} Toren (${p.t.score.A}:${p.t.score.B})`);
  p.game.dispose();

  // Ein Team ganz weg → das andere gewinnt
  let gone = false;
  const q = newGame('kopfball', ['a', 'b'], { isConnected: (id) => id !== 'b' || !gone, offlineMs: (id) => (id === 'b' && gone ? 20_000 : 0) });
  q.t.begin();
  q.t.step(5);
  gone = true;
  q.t.step(2);
  check(q.t.sub === 'over' && q.t.winner === 'A', 'Meer 15 s offline: Team Sonne gewinnt');
  q.game.dispose();
}

console.log('\nDauerlauf (Zufallseingaben):');
for (const kind of ['kopfball', 'kopfkorb'] as const) {
  for (const n of [2, 4, 8]) {
    const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
    const { game, t } = newGame(kind, ids);
    t.begin();
    const f = t.field;
    let bad = 0;
    let still = 0;
    let maxStill = 0;
    let goals = 0;
    let lastScore = 0;
    let lx = t.ball.x;
    let ly = t.ball.y;
    for (let i = 0; i < 30 * 120; i++) {
      if (i % 8 === 0) {
        for (const id of ids) {
          // Halb zufällig, halb Richtung Ball – sonst passiert zu wenig
          const p = t.player(id);
          const toBall = Math.sign(t.ball.x - p.x);
          t.pad(id, { x: Math.random() < 0.6 ? toBall : Math.random() * 2 - 1, y: 0, jump: Math.random() < 0.15, kick: Math.random() < 0.3 });
        }
      }
      t.step(1);
      const b = t.ball;
      if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || b.x < f.x0 || b.x > f.x1 || b.y < f.ceil - 1 || b.y > G) bad++;
      const s = t.score.A + t.score.B;
      if (s !== lastScore) {
        goals += s - lastScore;
        lastScore = s;
      }
      // Ball „hängt“: bewegt sich lange kaum, obwohl gespielt wird (nicht beim schwebenden Anstoß)
      if (t.sub === 'play' && !t.hold && Math.hypot(b.x - lx, b.y - ly) < 0.05) still++;
      else still = 0;
      maxStill = Math.max(maxStill, still);
      lx = b.x;
      ly = b.y;
      if (t.sub === 'over') t.begin();
    }
    check(bad === 0 && maxStill < 30 * 6, `${kind} ${n} Spieler: Ball immer im Feld (${bad} Fehler), längster Stillstand ${(maxStill / 30).toFixed(1)} s, ${goals} ${kind === 'kopfball' ? 'Tore' : 'Punkte'} in 2 min`);
    game.dispose();
  }
}

console.log(failed ? `\n${failed} Test(s) FEHLGESCHLAGEN` : '\nAlle Tests bestanden.');
process.exit(failed ? 1 : 0);
