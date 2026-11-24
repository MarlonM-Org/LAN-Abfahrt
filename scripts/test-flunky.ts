/**
 * Tests ohne Browser für Flunkyball:
 * - Kraft-Kurve: typische Sensor-Schwünge (leicht, normal, kräftig, voller Hieb, ohne Kreisel) und Wischer → Weite
 * - Geometrie: perfekter Wurf trifft immer (beide Teams, mit Wind), Vorzeichen, Fehlwurf-Hinweise
 * - Abwechslung: Wurfpunkte und Flasche wandern, bleiben aber in der Zone
 * - Trefferquoten simulierter Wurfreihen (geübt / normal / Anfänger)
 * - Komplette Partien mit dem echten Server-Spiel auf virtueller Uhr: Spieldauer, Treffer bis zum Sieg,
 *   Schluck-Limit pro Treffer, Runden-Ende, Verlängerung/Unentschieden, Überspringen, Aufgeben
 * Aufruf: `npm run test:flunky` (mehr Partien: FLUNKY_GAMES=400 npm run test:flunky)
 */
import {
  BOTTLE,
  FLUNKY,
  FLUNKY_THROWERS,
  type FlunkyThrower,
  THROW_SPOT,
  computeLanding,
  dist,
  flunkyBotThrow,
  flunkyDev,
  flunkyDistance,
  flunkyIdeal,
  flunkyPowerFor,
  flunkyPowerWindow,
  missHint,
  nextBottle,
  nextSpot,
  nextWind,
  teamBeer,
} from '../shared/flunky';
import { flunkySwing, flunkySwipe } from '../client/controller/flunkyThrow';
import { swingToThrow } from '../client/controller/bowlingThrow';
import type { MotionSample } from '../client/controller/motion';
import type { SwipePoint } from '../client/controller/bowlingThrow';
import { FlunkyGame } from '../server/flunky';
import type { MiniCtx, MiniResult } from '../server/minigame';
import type { FlunkyState, Team } from '../shared/types';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? '  ok ' : '  FEHLER'} ${msg}`);
  if (!ok) failed++;
};
const m = (px: number) => `${(px / FLUNKY.PX_PER_M).toFixed(1)} m`;
let seed = 4711;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// Abstände, die im Spiel vorkommen (nächster/weitester Wurfpunkt zur versetzten Flasche)
const NEAR = THROW_SPOT.B.x - FLUNKY.SPOT_DEPTH - (BOTTLE.x + FLUNKY.BOTTLE_DEPTH);
const FAR = Math.hypot(THROW_SPOT.B.x + FLUNKY.SPOT_DEPTH - (BOTTLE.x - FLUNKY.BOTTLE_DEPTH), FLUNKY.SPOT_LAT + FLUNKY.BOTTLE_LAT);

// ------------------------------------------------------------------ Sensor-Schwung

console.log(`Kraft-Kurve Sensor (Abstände im Spiel ${m(NEAR)} … ${m(FAR)}):`);
/**
 * Flunkyball-Wurf mit dem Handy in der Hand: kurz ausholen (Drehrate rückwärts), dann nach vorn durchschwingen
 * bis zur Spitze `peak` (°/s) und loslassen. Beschleunigung = Schwerkraft + Zentripetal (Arm ≈ 0,6 m), am
 * Messbereich ±8 g abgeschnitten (typisches Handy) – `gyro` = false simuliert ein Handy ohne Kreisel.
 */
function throwSwing(peak: number, o: { gyro?: boolean; cap?: number; ms?: number } = {}): MotionSample[] {
  const out: MotionSample[] = [];
  const back = 380;
  const fwdMs = o.ms ?? 320;
  const cap = o.cap ?? 78.5;
  for (let t = 0; t <= back + fwdMs + 60; t += 16) {
    let w: number;
    if (t < back) w = -0.35 * peak * Math.sin((Math.PI * t) / back);
    else if (t < back + fwdMs) w = peak * Math.sin((Math.PI * (t - back)) / fwdMs) ** 1.5;
    else w = 0.05 * peak;
    const om = (Math.abs(w) * Math.PI) / 180;
    const acc = Math.min(cap, 9.81 + om * om * 0.6);
    out.push({ alpha: 100, beta: 40, gamma: 0, ax: 0, ay: acc, az: 0, rotAlpha: 0, rotBeta: o.gyro === false ? 0 : w, rotGamma: 0, t: 5000 + t });
  }
  return out;
}
const distOf = (r: ReturnType<typeof flunkySwing>) => (r.ok ? flunkyDistance(r.t.power) : 0);
{
  check(!flunkySwing(throwSwing(60)).ok, 'Handy kaum bewegt → kein Wurf');
  check(!flunkySwing(throwSwing(900).slice(0, 3)).ok, 'zu kurz gehalten → kein Wurf');
  const light = flunkySwing(throwSwing(400));
  const loose = flunkySwing(throwSwing(600));
  const strong = flunkySwing(throwSwing(1050));
  const strongLo = flunkySwing(throwSwing(850));
  const strongHi = flunkySwing(throwSwing(1350));
  const max = flunkySwing(throwSwing(2000));
  check(distOf(light) < NEAR * 0.5, `leichter Schwung (400 °/s) → ${m(distOf(light))}, reicht bei weitem nicht`);
  check(distOf(loose) < NEAR - FLUNKY.HIT_NEAR, `lockerer Schwung (600 °/s) → ${m(distOf(loose))}, zu kurz`);
  check(Math.abs(distOf(strong) - 150) < 4, `kräftiger Wurf (1050 °/s) → ${m(distOf(strong))}, Mitte des Zielbereichs`);
  check(Math.abs(distOf(strongLo) - NEAR) < 12 && Math.abs(distOf(strongHi) - FAR) < 14, `850 … 1350 °/s → ${m(distOf(strongLo))} … ${m(distOf(strongHi))} = nächster … weitester Wurfpunkt`);
  check(distOf(max) > FAR + FLUNKY.HIT_FAR && max.ok && max.t.power < 0.95, `voller Hieb (Kreisel-Anschlag 2000 °/s) → ${m(distOf(max))}: zu weit, aber nicht am Anschlag (Kraft ${max.ok ? Math.round(max.t.power * 100) : '-'} %)`);
  check(light.ok && loose.ok && strong.ok && max.ok && light.t.power < loose.t.power && loose.t.power < strong.t.power && strong.t.power < max.t.power, 'Kraft steigt monoton mit dem Schwung');
  // Beschleunigung am Anschlag (±8 g und ±16 g) darf den Wurf nicht verfälschen – nur der Kreisel zählt
  const c8 = flunkySwing(throwSwing(1050, { cap: 78.5 }));
  const c16 = flunkySwing(throwSwing(1050, { cap: 157 }));
  check(c8.ok && c16.ok && c8.t.power === c16.t.power, `Beschleunigungs-Anschlag (±8 g / ±16 g) ändert nichts (${c8.ok ? c8.t.power : '-'} / ${c16.ok ? c16.t.power : '-'})`);
  const old = swingToThrow(throwSwing(1050));
  check(old.ok && old.t.speed >= 0.99, `zum Vergleich: alte Bowling-Kurve gab demselben Wurf ${old.ok ? Math.round(old.t.speed * 100) : '-'} % Kraft (= ${m(220)} – bisher immer viel zu weit)`);
  // Handy ohne Kreisel: nur die Beschleunigung – die stößt schon bei mittlerem Schwung an (±8 g), landet dann aber im Spielfeld
  const noGyro = flunkySwing(throwSwing(1050, { gyro: false }));
  const noGyroLight = flunkySwing(throwSwing(300, { gyro: false }));
  check(
    noGyro.ok && !noGyro.t.gyro && distOf(noGyro) > NEAR && distOf(noGyro) < FAR + FLUNKY.HIT_FAR && distOf(noGyroLight) < NEAR - FLUNKY.HIT_NEAR,
    `ohne Kreisel: Beschleunigung zählt (Anschlag ${noGyro.ok ? noGyro.t.peakAcc : '-'} m/s² → ${m(distOf(noGyro))}, leicht → ${m(distOf(noGyroLight))})`,
  );
  check(strong.ok && strong.t.slantDeg === null && flunkyDev('A', strong.t.slantDeg ?? 0) === 0, 'Sensor: Richtung nur vom Zielpfeil (keine Kompass-Abweichung)');
}

// ------------------------------------------------------------------ Wischen

console.log('Kraft-Kurve Wischen:');
/** Wischer nach oben: `len` px lang, endet mit `v` px/ms, schräg um `slant` Grad */
function swipe(v: number, len = 260, slant = 0): SwipePoint[] {
  const pts: SwipePoint[] = [];
  const steps = 14;
  const dur = len / v;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const s = len * u;
    pts.push({ x: 180 + Math.sin((slant * Math.PI) / 180) * s, y: 560 - Math.cos((slant * Math.PI) / 180) * s, t: 1000 + dur * u });
  }
  return pts;
}
{
  const pad = 400;
  check(!flunkySwipe(swipe(1.6, 30), pad).ok, 'zu kurzer Wischer zählt nicht');
  const slow = flunkySwipe(swipe(0.7), pad);
  const mid = flunkySwipe(swipe(1.6), pad);
  const fast = flunkySwipe(swipe(3.4), pad);
  const dSlow = slow.ok ? flunkyDistance(slow.t.power) : 0;
  const dMid = mid.ok ? flunkyDistance(mid.t.power) : 0;
  const dFast = fast.ok ? flunkyDistance(fast.t.power) : 0;
  check(dSlow < NEAR - FLUNKY.HIT_NEAR, `langsamer Wischer (0,7 px/ms) → ${m(dSlow)}, zu kurz`);
  check(Math.abs(dMid - 150) < 5, `zügiger Wischer (1,6 px/ms) → ${m(dMid)}, Mitte`);
  check(dFast > FAR + FLUNKY.HIT_FAR && fast.ok && fast.t.power < 1, `sehr schneller Wischer (3,4 px/ms) → ${m(dFast)}, zu weit, nicht am Anschlag`);
  const straight = flunkySwipe(swipe(1.6, 260, 3), pad);
  const slanted = flunkySwipe(swipe(1.6, 260, 15), pad);
  check(straight.ok && flunkyDev('A', straight.t.slantDeg ?? 0) === 0, 'fast gerade gewischt (3°) → keine Abweichung');
  const dev = slanted.ok ? flunkyDev('A', slanted.t.slantDeg ?? 0) : 0;
  check(dev > 0 && dev < 0.04, `15° schräg nach rechts → Team Sonne zieht ${((dev * 180) / Math.PI).toFixed(1)}° nach unten (klein)`);
  check(slanted.ok && flunkyDev('B', slanted.t.slantDeg ?? 0) === -dev, 'Team Meer: rechts aus Werfersicht = am TV oben');
}

// ------------------------------------------------------------------ Geometrie

console.log('Geometrie:');
{
  let perfect = 0;
  let n = 0;
  let maxErr = 0;
  for (let i = 0; i < 400; i++) {
    const team: Team = i % 2 ? 'A' : 'B';
    const spot = nextSpot(team, null, rnd);
    const bottle = nextBottle(rnd);
    const wind = (rnd() * 2 - 1);
    const id = flunkyIdeal(team, spot, bottle, wind);
    const r = computeLanding(team, spot, id.aim, id.power, wind, bottle);
    n++;
    if (r.hit) perfect++;
    maxErr = Math.max(maxErr, Math.hypot(r.along, r.lat));
  }
  check(perfect === n && maxErr < 0.01, `perfekter Wurf (Pfeil + Kraft + Wind vorgehalten) trifft immer (${perfect}/${n})`);
  const from = THROW_SPOT.A;
  const straight = computeLanding('A', from, 0, flunkyPowerFor(dist(from, BOTTLE)), 0, BOTTLE);
  check(straight.hit && Math.abs(straight.to.x - BOTTLE.x) < 0.01, 'Team Sonne, geradeaus, richtige Kraft → Treffer');
  const mirror = computeLanding('B', THROW_SPOT.B, 0, flunkyPowerFor(dist(THROW_SPOT.B, BOTTLE)), 0, BOTTLE);
  check(mirror.hit && Math.abs(mirror.to.x - BOTTLE.x) < 0.01, 'Team Meer gespiegelt → Treffer');
  const down = computeLanding('A', from, 0.1, flunkyPowerFor(148), 0, BOTTLE);
  const downB = computeLanding('B', THROW_SPOT.B, 0.1, flunkyPowerFor(148), 0, BOTTLE);
  check(down.to.y > BOTTLE.y && downB.to.y > BOTTLE.y && down.lat > 0 && downB.lat > 0, 'Pfeil nach unten (+) → Ball am TV unten, für beide Teams');
  const windy = computeLanding('A', from, 0, flunkyPowerFor(148), 1, BOTTLE);
  check(windy.to.y > BOTTLE.y + 15 && !windy.hit, `voller Wind nach unten verweht um ${m(windy.to.y - BOTTLE.y)} → daneben`);
  const id = flunkyIdeal('A', from, BOTTLE, 1);
  check(id.aim < -0.1, `bei Wind nach unten muss man nach oben vorhalten (${((id.aim * 180) / Math.PI).toFixed(1)}°)`);
  const short = computeLanding('A', from, 0, flunkyPowerFor(120), 0, BOTTLE);
  const long = computeLanding('A', from, 0, flunkyPowerFor(180), 0, BOTTLE);
  check(missHint(short.along, short.lat) === 'Zu kurz!' && missHint(long.along, long.lat) === 'Zu weit!', `Hinweise: „${missHint(short.along, short.lat)}“ / „${missHint(long.along, long.lat)}“`);
  check(missHint(-2, -20) === 'Oben vorbei!' && missHint(30, 20) === 'Zu weit & unten vorbei!', 'Hinweise: oben/unten vorbei (wie am TV)');
  // Trefferbereich: hinten (Ball trifft im Fallen) etwas großzügiger als vorn
  const behind = computeLanding('A', from, 0, flunkyPowerFor(148 + FLUNKY.HIT_FAR - 1), 0, BOTTLE);
  const before = computeLanding('A', from, 0, flunkyPowerFor(148 - FLUNKY.HIT_NEAR - 1), 0, BOTTLE);
  check(behind.hit && !before.hit, `Trefferbereich: ${FLUNKY.HIT_FAR - 1} px dahinter trifft, ${FLUNKY.HIT_NEAR + 1} px davor nicht`);
  const w = flunkyPowerWindow('A', from, BOTTLE, 0.4);
  check(w.lo < w.ideal && w.ideal < w.hi && w.hi - w.lo < 0.13, `Kraftfenster für einen Treffer: ${Math.round(w.lo * 100)}–${Math.round(w.hi * 100)} %`);
}

// ------------------------------------------------------------------ Abwechslung

console.log('Abwechslung (Wurfpunkt, Flasche, Wind):');
{
  let inZone = true;
  let moved = true;
  let ranges: number[] = [];
  for (const team of ['A', 'B'] as Team[]) {
    let prev = null as null | { x: number; y: number };
    for (let i = 0; i < 300; i++) {
      const s = nextSpot(team, prev, rnd);
      if (Math.abs(s.y - THROW_SPOT[team].y) > FLUNKY.SPOT_LAT + 0.5 || Math.abs(s.x - THROW_SPOT[team].x) > FLUNKY.SPOT_DEPTH + 0.5) inZone = false;
      if (prev && Math.abs(s.y - prev.y) < FLUNKY.SPOT_MOVE - 0.5) moved = false;
      ranges.push(dist(s, nextBottle(rnd)));
      prev = s;
    }
  }
  ranges = ranges.sort((a, b) => a - b);
  check(inZone, 'Wurfpunkte bleiben in der Wurfzone');
  check(moved, `jeder Wurf steht seitlich mind. ${FLUNKY.SPOT_MOVE} px (${m(FLUNKY.SPOT_MOVE)}) woanders`);
  check(ranges[ranges.length - 1] - ranges[0] > 45, `Abstände schwanken: ${m(ranges[0])} … ${m(ranges[ranges.length - 1])}`);
  let bottleOk = true;
  for (let i = 0; i < 300; i++) {
    const b = nextBottle(rnd);
    if (Math.abs(b.x - BOTTLE.x) > FLUNKY.BOTTLE_DEPTH || Math.abs(b.y - BOTTLE.y) > FLUNKY.BOTTLE_LAT) bottleOk = false;
  }
  check(bottleOk, 'Flasche wird nur leicht versetzt aufgestellt');
  let w = 0;
  let maxStep = 0;
  for (let i = 0; i < 300; i++) {
    const n = nextWind(w, rnd);
    maxStep = Math.max(maxStep, Math.abs(n - w));
    w = n;
  }
  check(maxStep <= FLUNKY.WIND_STEP + 0.09, 'Wind dreht langsam (kein Springen von ganz links nach ganz rechts)');
}

// ------------------------------------------------------------------ Trefferquoten

console.log('Trefferquoten simulierter Wurfreihen:');
const rates: Record<string, number> = {};
for (const [name, k] of [['geübt', 'profi'], ['normal', 'normal'], ['Anfänger', 'leicht']] as const) {
  let hits = 0;
  const n = 6000;
  let wind = 0;
  let spot = null as null | { x: number; y: number };
  let bottle = { ...BOTTLE };
  let streak = 0;
  let longest = 0;
  for (let i = 0; i < n; i++) {
    const team: Team = i % 2 ? 'A' : 'B';
    spot = nextSpot(team, spot, rnd);
    wind = nextWind(wind, rnd);
    const t = flunkyBotThrow({ spot, bottle, wind, turnTeam: team }, FLUNKY_THROWERS[k], rnd);
    const r = computeLanding(team, spot, t.aim + t.dev, t.power, wind, bottle);
    if (r.hit) {
      hits++;
      bottle = nextBottle(rnd);
      longest = Math.max(longest, streak);
      streak = 0;
    } else streak++;
  }
  rates[k] = hits / n;
  console.log(`       ${name}: ${(rates[k] * 100).toFixed(1)} % (jeder ${(1 / rates[k]).toFixed(1)}. Wurf), längste Serie ohne Treffer ${longest}`);
}
check(rates.profi >= 0.25 && rates.profi <= 0.55, 'geübt (Pfeil sitzt, Wind gut geschätzt, gleichmäßiger Schwung): etwa jeder 2.–4. Wurf');
check(rates.normal >= 0.18 && rates.normal < rates.profi, 'normal: seltener als geübt');
check(rates.leicht >= 0.07 && rates.leicht < rates.normal, 'Anfänger: selten, aber nicht nie');
// Ohne Zielen (Pfeil geradeaus) und ohne Wind-Vorhalten trifft auch ein guter Werfer kaum
{
  let hits = 0;
  const n = 4000;
  let spot = null as null | { x: number; y: number };
  let wind = 0;
  for (let i = 0; i < n; i++) {
    const team: Team = i % 2 ? 'A' : 'B';
    spot = nextSpot(team, spot, rnd);
    wind = nextWind(wind, rnd);
    const t = flunkyBotThrow({ spot, bottle: BOTTLE, wind, turnTeam: team }, FLUNKY_THROWERS.profi, rnd);
    if (computeLanding(team, spot, 0, t.power, wind, BOTTLE).hit) hits++;
  }
  check(hits / n < 0.12, `ohne Zielen (Pfeil geradeaus) nur ${((hits / n) * 100).toFixed(1)} % – die Richtung muss man jedes Mal neu einstellen`);
}

// ------------------------------------------------------------------ Komplette Partien (virtuelle Uhr)

console.log('Komplette Partien (Server-Spiel, virtuelle Uhr):');

type Job = { at: number; fn: () => void; id: number };
let vnow = 1_700_000_000_000;
let jobs: Job[] = [];
let jobId = 1;
const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
function useVirtualClock(on: boolean) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (on) {
    g.setTimeout = (fn: () => void, ms = 0) => {
      const id = jobId++;
      jobs.push({ at: vnow + Math.max(0, ms), fn, id });
      return id;
    };
    g.clearTimeout = (id: number) => void (jobs = jobs.filter((j) => j.id !== id));
    Date.now = () => vnow;
  } else {
    g.setTimeout = real.setTimeout;
    g.clearTimeout = real.clearTimeout;
    Date.now = real.now;
  }
}
/** Läuft die Uhr bis `until` (oder bis keine Aufgabe mehr da ist) */
function runClock(until: number, stop: () => boolean) {
  while (!stop()) {
    jobs.sort((a, b) => a.at - b.at || a.id - b.id);
    const j = jobs.shift();
    if (!j || j.at > until) break;
    vnow = j.at;
    j.fn();
  }
}

interface SimOpts {
  sizes: [number, number];
  skill: [FlunkyThrower, FlunkyThrower];
  /** Bedenkzeit fürs Zielen (ms) */
  think: [number, number];
  /** Tipp-Abstand (ms) beim Trinken/Laufen */
  tap: [number, number];
  /** Läufer tippt gar nicht (abgelenkt) */
  lazyRunner?: boolean;
  /** Werfer werfen immer ins Leere */
  neverHit?: boolean;
}
interface SimResult {
  ms: number;
  result: MiniResult | null;
  state: FlunkyState;
  /** Größter Schluck eines Spielers in einem Treffer (Prozentpunkte) */
  maxSip: number;
  firstHit: Team | null;
  /** Spielstand (Restbier) nach dem ersten Treffer, falls er das Spiel schon entschieden hätte */
  hitsAtEnd: Record<Team, number>;
}

function simulate(o: SimOpts): SimResult {
  const ids = { A: Array.from({ length: o.sizes[0] }, (_, i) => `a${i}`), B: Array.from({ length: o.sizes[1] }, (_, i) => `b${i}`) };
  let result: MiniResult | null = null;
  let game: FlunkyGame | null = null;
  const ctx: MiniCtx = {
    onChange: () => void (game && drive()),
    finish: (r: MiniResult) => void (result = r),
    isConnected: () => true,
    nameOf: (id: string) => id,
    mode: 'arcade',
    teams: { A: ids.A, B: ids.B, label: 'Test' },
  };
  const t0 = vnow;
  let planned = '';
  let chugKey = '';
  let maxSip = 0;
  let firstHit: Team | null = null;
  let chugStart: Record<string, number> = {};
  const range = (r: [number, number]) => r[0] + rnd() * (r[1] - r[0]);
  const drive = () => {
    const s = game!.state;
    if (s.sub === 'aim') {
      const key = `${s.turnTeam}-${s.throws[s.turnTeam]}`;
      if (planned === key) return;
      planned = key;
      const who = s.throwerId;
      const sk = o.skill[s.turnTeam === 'A' ? 0 : 1];
      setTimeout(() => {
        const st = game!.state;
        if (st.sub !== 'aim' || st.throwerId !== who) return;
        const t = o.neverHit ? { aim: 0.5, dev: 0, power: 0 } : flunkyBotThrow(st, sk, rnd);
        game!.input(who, 'aim', { aim: t.aim });
        game!.input(who, 'throw', t);
      }, range(o.think));
    } else if (s.sub === 'chug') {
      const key = `${s.lastThrow?.seq}`;
      if (chugKey !== key) {
        chugKey = key;
        firstHit ??= s.turnTeam;
        chugStart = { ...s.beer };
        const tappers = [...s.teams[s.turnTeam], ...(o.lazyRunner ? [] : [s.runnerId!])];
        for (const id of tappers) {
          const tick = () => {
            const st = game!.state;
            if (st.sub !== 'chug' || st.lastThrow?.seq !== Number(key)) return;
            if (st.teams[st.turnTeam].includes(id) || st.runnerId === id) game!.input(id, 'tap', null);
            setTimeout(tick, range(o.tap));
          };
          setTimeout(tick, 350 + rnd() * 500); // Reaktion: Handy zeigt TRINKEN!/LAUFEN!
        }
      }
    } else if (s.sub === 'reset' || s.sub === 'over') {
      for (const id of Object.keys(chugStart)) maxSip = Math.max(maxSip, chugStart[id] - s.beer[id]);
      chugStart = {};
    }
  };
  game = new FlunkyGame([...ids.A, ...ids.B], ctx);
  drive();
  runClock(vnow + 30 * 60_000, () => !!result);
  const ms = vnow - t0;
  game.dispose();
  jobs = [];
  return { ms, result, state: game.state, maxSip, firstHit, hitsAtEnd: { ...game.state.hits } };
}

useVirtualClock(true);
// Auch der Zufall des Servers (Wurfpunkte, Wind, Flasche) läuft über den festen Seed – Ergebnisse sind reproduzierbar
const realRandom = Math.random;
Math.random = rnd;
const GAMES = Number(process.env.FLUNKY_GAMES) || 120;
const human = { think: [3500, 8000] as [number, number], tap: [110, 165] as [number, number] };
const stats = (rs: SimResult[]) => {
  const mins = rs.map((r) => r.ms / 60000).sort((a, b) => a - b);
  const med = mins[Math.floor(mins.length / 2)];
  const empty = rs.filter((r) => r.state.reason === 'empty');
  const decided = rs.filter((r) => r.state.winner && r.firstHit);
  const firstWins = decided.filter((r) => r.state.winner === r.firstHit).length / Math.max(1, decided.length);
  const winHits = empty.map((r) => r.state.hits[r.state.winner!]);
  return { mins, med, empty, firstWins, winHits, draws: rs.filter((r) => r.state.reason === 'draw').length, maxSip: Math.max(...rs.map((r) => r.maxSip)) };
};
const report = (label: string, st: ReturnType<typeof stats>, n: number) =>
  console.log(
    `       ${label}: Dauer Median ${st.med.toFixed(1)} min (${st.mins[0].toFixed(1)} … ${st.mins[st.mins.length - 1].toFixed(1)}), ausgetrunken ${Math.round((st.empty.length / n) * 100)} % (mit ${Math.min(...st.winHits, 99)}–${Math.max(...st.winHits, 0)} Treffern), nach Runden ${Math.round(((n - st.empty.length - st.draws) / n) * 100)} %, unentschieden ${st.draws}, Team mit dem 1. Treffer gewinnt ${Math.round(st.firstWins * 100)} %`,
  );
{
  const T = FLUNKY_THROWERS;
  const runs: [string, SimOpts][] = [
    ['2 gegen 2, normal', { sizes: [2, 2], skill: [T.normal, T.normal], ...human }],
    ['2 gegen 2, geübt', { sizes: [2, 2], skill: [T.profi, T.profi], ...human }],
    ['2 gegen 2, Anfänger', { sizes: [2, 2], skill: [T.leicht, T.leicht], ...human }],
    ['1 gegen 1, normal', { sizes: [1, 1], skill: [T.normal, T.normal], ...human }],
    ['3 gegen 3, normal', { sizes: [3, 3], skill: [T.normal, T.normal], ...human }],
  ];
  const all: SimResult[] = [];
  for (const [label, o] of runs) {
    const rs = Array.from({ length: GAMES }, () => simulate(o));
    all.push(...rs);
    report(label, stats(rs), rs.length);
    if (label === '2 gegen 2, normal') {
      const st = stats(rs);
      check(st.med >= 2 && st.med <= 4, `normale Partie dauert im Median ${st.med.toFixed(1)} min (Ziel 2–4)`);
      check(st.mins[st.mins.length - 1] <= 5.5, `längste Partie ${st.mins[st.mins.length - 1].toFixed(1)} min (Runden-Limit greift)`);
      check(st.firstWins < 0.8, `der erste Treffer entscheidet nicht: das Team gewinnt nur ${Math.round(st.firstWins * 100)} % der Partien`);
    }
    if (label === '2 gegen 2, geübt') {
      const st = stats(rs);
      check(st.empty.length / rs.length > 0.4, `geübte Teams trinken oft vor Rundenende aus (${Math.round((st.empty.length / rs.length) * 100)} %)`);
    }
  }
  const st = stats(all);
  check(all.every((r) => !!r.result), `alle ${all.length} Partien enden`);
  check(st.maxSip <= FLUNKY.SIP_MAX + 0.01, `Schluck-Limit: höchstens ${st.maxSip.toFixed(1)} % pro Treffer und Spieler (Limit ${FLUNKY.SIP_MAX})`);
  check(st.empty.every((r) => r.state.hits[r.state.winner!] >= Math.ceil(100 / FLUNKY.SIP_MAX)), `Austrinken braucht mindestens ${Math.ceil(100 / FLUNKY.SIP_MAX)} Treffer`);
  check(all.every((r) => r.state.throws.A <= FLUNKY.ROUNDS + FLUNKY.EXTRA_ROUNDS && r.state.throws.B <= FLUNKY.ROUNDS + FLUNKY.EXTRA_ROUNDS), 'nie mehr als Runden + Verlängerung');
  check(
    all.filter((r) => r.state.reason === 'rounds').every((r) => teamBeer(r.state, r.state.winner!) < teamBeer(r.state, r.state.winner === 'A' ? 'B' : 'A')),
    'nach den Runden gewinnt, wer mehr getrunken hat',
  );
  // Abgelenkter Läufer: das Spiel hängt nicht, die Trinker kommen trotzdem nur bis zum Limit
  const lazy = Array.from({ length: 20 }, () => simulate({ sizes: [2, 2], skill: [T.profi, T.profi], ...human, lazyRunner: true }));
  check(lazy.every((r) => !!r.result) && Math.max(...lazy.map((r) => r.maxSip)) <= FLUNKY.SIP_MAX + 0.01, 'Läufer tippt nicht: nach dem Schluck-Limit geht es trotzdem weiter');
  // Niemand trifft: Verlängerung, dann Unentschieden
  const none = simulate({ sizes: [2, 2], skill: [T.normal, T.normal], ...human, neverHit: true });
  check(none.state.reason === 'draw' && none.result?.groups.length === 1 && none.state.throws.A === FLUNKY.ROUNDS + FLUNKY.EXTRA_ROUNDS, `kein Treffer: ${FLUNKY.EXTRA_ROUNDS} Runden Verlängerung, dann Unentschieden (alle gleich platziert)`);
}

// ------------------------------------------------------------------ Eingaben, Überspringen, Aufgeben

console.log('Eingaben, Überspringen, Aufgeben:');
{
  let result: MiniResult | null = null;
  const online = new Set(['a0', 'a1', 'b0', 'b1']);
  const ctx = { onChange() {}, finish: (r: MiniResult) => void (result = r), isConnected: (id: string) => online.has(id), nameOf: (id: string) => id, mode: 'arcade', teams: { A: ['a0', 'a1'], B: ['b0', 'b1'] } } as unknown as MiniCtx;
  const g = new FlunkyGame(['a0', 'a1', 'b0', 'b1'], ctx);
  const s = g.state;
  const thrower = s.throwerId;
  const other = s.teams[s.turnTeam === 'A' ? 'B' : 'A'][0];
  g.input(other, 'aim', { aim: 0.3 });
  check(s.aim === 0, 'Zielen nur durch den Werfer');
  g.input(thrower, 'aim', { aim: 5 });
  check(s.aim === FLUNKY.AIM_MAX, 'Zielpfeil wird begrenzt');
  g.input(thrower, 'aim', { aim: -0.12 });
  check(s.aim === -0.12, 'Zielpfeil kommt live im Zustand an (TV zeigt ihn)');
  const team = s.turnTeam;
  const spot0 = { ...s.spot };
  g.skip();
  check(s.throws[team] === 1 && s.turnTeam !== team && s.sub === 'aim', 'VIP überspringt: zählt als Wurf, das andere Team ist dran');
  check(s.aim === 0, 'neuer Wurf beginnt mit Pfeil geradeaus');
  const t2 = s.throwerId;
  online.delete(t2);
  g.playerDisconnected(t2);
  check(s.throws[team === 'A' ? 'B' : 'A'] === 1 && s.turnTeam === team, 'Werfer offline → Wurf fällt aus, weiter geht es');
  check(s.spot.x !== spot0.x || s.spot.y !== spot0.y, 'neuer Wurfpunkt für das Team');
  for (const id of s.teams.B) online.delete(id);
  g.playerDisconnected(s.teams.B[0]);
  check(s.sub === 'over' && s.winner === 'A' && s.reason === 'forfeit', 'ganzes Team weg → das andere gewinnt');
  runClock(vnow + 10_000, () => !!result);
  check(!!result && (result as MiniResult).groups[0].includes('a0'), 'Ergebnis geht an den Raum');
  g.dispose();
}
useVirtualClock(false);
Math.random = realRandom;

console.log(failed ? `\n${failed} FEHLER` : '\nAlles ok');
process.exit(failed ? 1 : 0);
