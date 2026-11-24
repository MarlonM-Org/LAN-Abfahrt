/**
 * Kopfball-Duell / Kopf-Korb: Bot-Verhalten.
 * Der Bot rechnet den Ball ein Stück voraus (`kbPredict`), läuft hinter ihn (von seinem Angriffstor aus gesehen)
 * und schiebt ihn nach vorn, springt zu hohen Bällen hoch (Kopfball) und drückt SCHUSS, sobald der Ball vor dem
 * Fuß liegt (Fußball) bzw. in Wurfweite ist (Korb – aus der eigenen Hälfte nur manchmal, sonst erst näher ran).
 * Liegt der Ball hinter ihm, läuft er zurück und hüpft drüber. Mit Mitspielern geht nur der Nächste zum Ball,
 * einer bleibt hinten vor dem eigenen Tor bzw. Korb. Eingaben als Zustand (`pad`), Knöpfe nur kurz gedrückt.
 * In der Aufwärmrunde steht er still (der Bot-Client ruft das nur in Phase `mini` auf).
 */
import type { GameState, Team } from '../shared/types';
import { KB, type KbField, type KbState, kbDir, kbField, kbPredict } from '../shared/kopfball';

export interface KopfBotHost {
  id: string;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
}

interface Mem {
  nextAt: number;
  /** zuletzt gesendet */
  x: number;
  jump: boolean;
  kick: boolean;
  /** eigene Ungenauigkeit, damit nicht alle gleich spielen */
  slop: number;
  /** wie gern aus der Ferne geworfen wird (Korb) */
  greed: number;
  field: KbField | null;
  key: string;
}

const mems = new WeakMap<KopfBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function kopfBot(bot: KopfBotHost, st: KbState) {
  let mem = mems.get(bot);
  if (!mem) mems.set(bot, (mem = { nextAt: 0, x: 0, jump: false, kick: false, slop: rand(-3, 3), greed: rand(0.05, 0.3), field: null, key: '' }));
  const me = st.players[bot.id];
  const send = (x: number, jump: boolean, kick: boolean) => {
    const xr = Math.round(x * 100) / 100;
    if (xr === mem!.x && jump === mem!.jump && kick === mem!.kick) return;
    mem!.x = xr;
    mem!.jump = jump;
    mem!.kick = kick;
    bot.send('pad', { x: xr, y: 0, jump, kick });
  };
  if (!me || me.out || st.sub === 'over') {
    send(0, false, false);
    return;
  }
  const now = Date.now();
  // Gedrückte Knöpfe nach kurzer Zeit wieder loslassen (der nächste Druck braucht eine neue Flanke)
  if (now < mem.nextAt) {
    if ((mem.jump || mem.kick) && now > mem.nextAt - 40) send(mem.x, false, false);
    return;
  }
  mem.nextAt = now + rand(70, 110);
  const key = `${st.mode}-${st.size}`;
  if (mem.key !== key) {
    mem.key = key;
    mem.field = kbField(st.mode, st.size);
  }
  const f = mem.field!;
  if (st.sub === 'countdown' || st.sub === 'kickoff') {
    send(0, false, false);
    return;
  }

  const team: Team = me.t;
  const d = kbDir(team);
  const G = KB.GROUND;
  const ownX = team === 'A' ? f.x0 : f.x1;
  const b = st.ball;
  // Ball etwa so weit voraus, wie der Bot zum Hinlaufen braucht (höchstens 0,5 s)
  const lead = st.hold ? 0 : clamp(Math.abs(b.x - me.x) / KB.RUN, 0.08, 0.5);
  const p = st.hold ? b : kbPredict(b, f, lead);

  // Rollen: wer am nächsten am Ball ist, greift an; ab 2 im Team bleibt der hinterste Bot vor dem eigenen Tor
  const mates = Object.entries(st.players).filter(([, q]) => q.t === team && !q.out);
  const byBall = [...mates].sort((a, c) => Math.abs(a[1].x - p.x) - Math.abs(c[1].x - p.x));
  const striker = byBall[0]?.[0] === bot.id || (mates.length >= 3 && byBall[1]?.[0] === bot.id && Math.abs(me.x - p.x) < 60);
  const keeper = !striker && mates.length >= 2 && [...mates].sort((a, c) => Math.abs(a[1].x - ownX) - Math.abs(c[1].x - ownX))[0][0] === bot.id;

  let target: number;
  let jump = false;
  let kick = false;
  const behind = (me.x - p.x) * d > 4; // Ball liegt zwischen mir und meinem eigenen Tor
  // Anstoß der anderen: zurück vors eigene Tor, hohe Bälle wegköpfen
  const theirKick = st.hold && st.kick !== team;
  if (theirKick) {
    const line = team === 'A' ? f.x0 + 34 : f.x1 - 34;
    target = line;
  } else if (striker || (!keeper && Math.abs(me.x - p.x) < 50)) {
    if (behind) {
      // Zurück hinter den Ball; ist er nah und flach: drüber hüpfen
      target = p.x - d * 26;
      if (Math.abs(me.x - b.x) < 34 && G - b.y < 22 && !me.air) jump = Math.random() < 0.7;
    } else {
      // Hinter den Ball (vom Angriffstor aus) und reinlaufen
      target = p.x - d * (KB.BODY_R + KB.BALL_R + 2 + mem.slop) + d * 18;
    }
  } else if (keeper) {
    // Vor dem eigenen Tor, zwischen Ball und Tor
    const line = team === 'A' ? f.x0 + 40 : f.x1 - 40;
    target = (p.x - line) * d < 0 ? p.x - d * 20 : line + (p.x - line) * 0.25;
  } else {
    // Unterstützer: etwas hinter dem Ball warten
    target = p.x - d * 70;
  }

  // Hohe Bälle in der Nähe: zum Kopfball hochspringen (fallend oder knapp über dem Kopf)
  const dxNow = Math.abs(b.x - me.x);
  const headTop = KB.HEAD_Y + KB.HEAD_R;
  if (!me.air && dxNow < 26 && G - b.y > headTop - 4 && G - b.y < headTop + 60 && b.vy > -150) jump = Math.random() < 0.8;
  // Ball fliegt aufs eigene Tor zu und ist über Kopfhöhe: hochspringen
  if (!me.air && (b.vx * -d) > 120 && (b.x - me.x) * d > 0 && (b.x - me.x) * d < 60 && G - b.y > headTop && G - b.y < headTop + 70) jump = Math.random() < 0.6;

  const fwd = (b.x - me.x) * d;
  const up = me.y - b.y;
  if (me.cd <= 0) {
    if (st.mode === 'fuss') {
      // Ball vor dem Fuß → Schuss
      if (fwd > -2 && fwd < 30 && up > -2 && up < 32) kick = Math.random() < 0.85;
    } else {
      const reach = Math.hypot(b.x - me.x, b.y - (me.y - 18)) < KB.THROW_REACH - 2;
      const hoop = f.hoops[team === 'A' ? 'B' : 'A'];
      const dist = Math.abs((hoop.xb + hoop.xf) / 2 - me.x);
      // Nah am Korb immer werfen, von weit weg nur manchmal (sonst erst hinlaufen)
      if (reach && (dist < f.w * 0.35 || Math.random() < mem.greed)) kick = true;
      if (reach && !kick) target = me.x + d * 40;
    }
  }

  const [lo, hi] = [f.x0 + KB.HEAD_R, f.x1 - KB.HEAD_R];
  target = clamp(target, lo, hi);
  const dx = target - me.x;
  const x = Math.abs(dx) < 3 ? 0 : clamp(dx / 18, -1, 1);
  send(x, jump, kick);
}
