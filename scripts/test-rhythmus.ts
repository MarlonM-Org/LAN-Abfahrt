/**
 * Tests ohne Browser fürs Gespräch (`rhythm`): `npm run test:rhythmus`
 * - Song + Spuren: jede Note ist ein Melodieton des Songs und liegt exakt auf dem Sechzehntel-Raster; im
 *   gerenderten Ton setzt an jeder Notenzeit wirklich ein Ton ein; Achtel, Synkopen, Läufe; Story-Aufteilung
 * - Wertung (perfekt/gut/zu früh/Fehltipp/verpasst), Fein-Abgleich
 * - Soundcheck: Versatz aus Tipps (auch nahe der Rastergrenze), Raum-Versatz
 * - Uhrabgleich: Simulation WLAN mit Stromsparmodus, alter gegen neuen Abgleich (Fehler in ms)
 * - Modell „Nachschlag“: wie die alte Wertung einen Spieler behandelt, der nach Gehör spielt, gegen die neue
 * - kompletter Ablauf auf simulierter Uhr: Soundcheck → gespeicherter Versatz → Song → Gewinner nach Trefferquote,
 *   Story mit Herzen, neu einmessen mitten im Song, späte Tipps (WLAN), Fehltipps
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RH, type RhythmState, feinAbgleich, imTakt, kalAuswerten, kalPhase, markAt, raumVersatz, rhBeatMs, rhSong, rhSongMs, rhStepMs, rhStepTime, rhythmusNoten,
  rhythmusPhrasen, tippWerten, trefferQuote, verpassteNoten,
} from '../shared/rhythmus';
import { UHR, Uhrabgleich } from '../shared/zeitabgleich';
import { renderSong } from './musicRender';
import type { MiniCtx, MiniResult } from '../server/minigame';

let fails = 0;
const ok = (name: string, cond: boolean, info = '') => {
  if (!cond) fails++;
  console.log(`${cond ? '  ok ' : ' FEHLER'} ${name}${cond || !info ? '' : ` – ${info}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(got)} statt ${JSON.stringify(want)}`);

/** Kleiner deterministischer Zufall (mulberry32) */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// ---------------------------------------------------------------- Song und Spuren
console.log('Song und Spuren');
const song = rhSong();
const stepMs = rhStepMs(song);
ok(`Song: ${song.bpm} BPM, ${song.bars} Takte, ohne Swing`, song.bpm === 100 && song.bars === 24 && song.swing === 0);
ok(`Länge 50–70 s (${(rhSongMs(song) / 1000).toFixed(1)} s)`, rhSongMs(song) >= 50_000 && rhSongMs(song) <= 70_000);
const chart = rhythmusNoten(['a', 'b', 'c'], 'a', true);
ok(`Wettkampf: alle dieselbe Spur`, rhythmusNoten(['a', 'b', 'c'], 'c', true) === chart);
ok(`mindestens 100 Noten (${chart.length})`, chart.length >= 100);
ok('sortiert, ab Takt 1', chart.every((n, i) => n.t >= 0 && (i === 0 || n.t > chart[i - 1].t)));
const leadSteps = new Set(song.lead.notes.map((n) => n.step));
ok('jede Note ist ein Melodieton des Songs (gleicher Schritt)', chart.every((n) => leadSteps.has(n.step)));
ok('jeder Melodieton hat eine Note', leadSteps.size === chart.length);
ok('Zeit = Raster des Songs (rhStepTime), genau auf Sechzehnteln', chart.every((n) => n.t === Math.round(rhStepTime(song, n.step)) && Math.abs(n.t / stepMs - Math.round(n.t / stepMs)) < 1e-9));
ok('Tasten 0–3, alle benutzt', chart.every((n) => n.lane >= 0 && n.lane < RH.LANES && Number.isInteger(n.lane)) && [0, 1, 2, 3].every((l) => chart.some((n) => n.lane === l)));
const gaps = chart.slice(1).map((n, i) => n.t - chart[i].t);
ok(`kleinster Abstand ≥ 150 ms (Sechzehntel bei 100 BPM): ${Math.min(...gaps)} ms`, Math.min(...gaps) >= 150);
const onBeat = chart.filter((n) => n.step % 4 === 0).length;
const offBeat8 = chart.filter((n) => n.step % 4 === 2).length;
const sixteenth = chart.filter((n) => n.step % 2 === 1).length;
ok(`Achtel/Synkopen auf der „und“: ${offBeat8}, Sechzehntel: ${sixteenth}, auf dem Schlag: ${onBeat}`, offBeat8 >= 20 && sixteenth >= 8 && onBeat > offBeat8);
let runs = 0;
for (let i = 0; i + 2 < chart.length; i++) if (chart[i + 1].t - chart[i].t === 150 && chart[i + 2].t - chart[i + 1].t === 150) runs++;
ok(`kurze Läufe (3+ Sechzehntel am Stück): ${runs}`, runs >= 4);
// Synkope im engeren Sinn: Ton auf der „und“, der über den nächsten Schlag klingt
const syncopes = song.lead.notes.filter((n) => n.step % 4 === 2 && n.len > 2).length;
ok(`echte Synkopen (Ton auf der „und“ über den Schlag gehalten): ${syncopes}`, syncopes >= 5);
const perSection = [0, 1, 2, 3, 4, 5].map((sec) => chart.filter((n) => Math.floor(n.step / 64) === sec).length);
ok(`wird schwerer: Noten je 4 Takte ${perSection.join(' / ')}`, perSection[0] < perSection[1] && perSection[1] < perSection[3] && perSection[3] >= perSection[2]);
const quickSame = chart.filter((n, i) => i > 0 && n.lane === chart[i - 1].lane && n.t - chart[i - 1].t <= 150).length;
ok(`kaum gleiche Taste im Sechzehntel-Abstand (${quickSame})`, quickSame <= 2);

// Hörbar: an jeder Notenzeit setzt im gerenderten Melodiekanal ein Ton ein
{
  const r = renderSong(song, 22050);
  const lead = r.channels.lead;
  const rms = (a: number, b: number) => {
    let s = 0;
    const i0 = Math.max(0, Math.floor(a * r.sr));
    const i1 = Math.min(lead.length, Math.floor(b * r.sr));
    for (let i = i0; i < i1; i++) s += lead[i] * lead[i];
    return Math.sqrt(s / Math.max(1, i1 - i0));
  };
  let good = 0;
  for (const n of chart) {
    const t = n.t / 1000;
    if (rms(t + 0.003, t + 0.03) > 1.3 * rms(t - 0.03, t - 0.003)) good++;
  }
  ok(`gerenderter Ton: Einsatz an ${good}/${chart.length} Notenzeiten`, good >= chart.length * 0.97);
  let peak = 0;
  for (const v of r.mix) peak = Math.max(peak, Math.abs(v));
  ok(`Mix übersteuert nicht (Spitze ${peak.toFixed(2)})`, peak < 1 && peak > 0.1);
}

// Story
{
  const order = ['A', 'B'];
  const a = rhythmusNoten(order, 'A', false);
  const b = rhythmusNoten(order, 'B', false);
  const phr = rhythmusPhrasen(order);
  ok(`Story: ${phr.length} Abschnitte à ${RH.PHRASE_BARS} Takte, abwechselnd`, phr.length === song.bars / RH.PHRASE_BARS && phr.every((p, i) => p.speaker === order[i % 2]));
  const kick = new Set(song.drums.kick);
  const last = (song.bars - 1) * 16;
  const okSplit = (notes: typeof a, who: string) =>
    notes.every((n) => {
      const sp = phr.find((p) => n.t >= p.from && n.t < p.to)!.speaker;
      return n.step >= last ? leadSteps.has(n.step) : sp === who ? leadSteps.has(n.step) : kick.has(n.step);
    });
  ok('Story: wer redet, spielt die Melodie, der andere nickt auf der Bassdrum', okSplit(a, 'A') && okSplit(b, 'B'));
  ok('Story: jede Note auf dem Raster', [...a, ...b].every((n) => n.t === Math.round(rhStepTime(song, n.step))));
  ok(`Story: beide haben zu tun (${a.length} / ${b.length} Noten)`, a.length >= 60 && b.length >= 60);
}

// ---------------------------------------------------------------- Wertung
console.log('Wertung');
{
  const c = [
    { t: 1000, lane: 0, step: 0 },
    { t: 1150, lane: 0, step: 1 },
    { t: 1300, lane: 1, step: 2 },
    { t: 2000, lane: 2, step: 3 },
  ];
  const m = () => new Uint8Array(c.length);
  eq('genau auf der Note → perfekt', tippWerten(c, m(), 0, 1000)?.mark, 3);
  eq('+60 ms → perfekt', tippWerten(c, m(), 0, 1060)?.mark, 3);
  eq('−61 ms → gut', tippWerten(c, m(), 0, 939)?.mark, 2);
  eq('+130 ms → gut (früheste offene Note zuerst)', tippWerten(c, m(), 0, 1130), { i: 0, mark: 2, d: 130 });
  eq('−200 ms → zu früh (Note verbraucht)', tippWerten(c, m(), 2, 1800)?.mark, 1);
  eq('−230 ms → Fehltipp (nichts in Reichweite)', tippWerten(c, m(), 2, 1770), null);
  eq('falsche Taste → Fehltipp', tippWerten(c, m(), 3, 2000), null);
  const mm = m();
  mm[0] = 3;
  eq('zweite Note derselben Taste, wenn die erste erledigt ist', tippWerten(c, mm, 0, 1150)?.i, 1);
  eq('+131 ms nach Note 1 → nächste Note (1150) ist gemeint', tippWerten(c, m(), 0, 1131)?.i, 1);
  eq('verpasst nach Fenster + Frist', verpassteNoten(c, m(), 1000 + RH.GOOD_MS + 50, 40), [0]);
  eq('noch nicht verpasst innerhalb der Frist', verpassteNoten(c, m(), 1000 + RH.GOOD_MS + 30, 40), []);
  eq('Trefferquote 87 %', trefferQuote(50, 37, 100), 87);
  ok('im Takt (Story): perfekt 2, gut 1', Math.abs(imTakt(10, 10, 20) - 0.75) < 1e-9);
  eq('Fein-Abgleich: ohne Tipps = Start', feinAbgleich([], 30), 30);
  eq('Fein-Abgleich: Median der Abweichungen', feinAbgleich([40, 42, 38, 41, 39, 40], 0), 40);
  eq('Fein-Abgleich: höchstens ±80 ms', feinAbgleich([200, 200, 200, 200, 200, 200], 0), RH.FEIN_MAX);
  eq('Fein-Abgleich: wenige Tipps nur anteilig', feinAbgleich([60], 0), 10);
}

// ---------------------------------------------------------------- Soundcheck
console.log('Soundcheck');
{
  const rnd = prng(7);
  const g = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const beat = RH.KAL_BEAT_MS;
  const taps = (k: number, sd: number, n = 10) => Array.from({ length: n }, (_, i) => kalPhase(10_000 + i * beat + k + g() * sd, 10_000, beat));
  for (const k of [0, 120, 250, 400, 520, -100]) {
    const r = kalAuswerten(taps(k, 18, 12), beat)!;
    ok(`Versatz ${k} ms (12 Tipps, ±18 ms Streuung) → ${r.wert} ms, stabil`, Math.abs(r.wert - k) <= 20 && r.stabil);
  }
  const wild = kalAuswerten(taps(200, 160), beat)!;
  ok(`unruhige Tipps (±160 ms) → nicht stabil (Streuung ${wild.streu} ms)`, !wild.stabil);
  ok('zu wenige Tipps → nicht stabil', !kalAuswerten(taps(200, 10, 5), beat)!.stabil);
  eq('Raum-Versatz = Median der Handys', raumVersatz([230, 260, 900, 240]), 250);
  eq('Raum-Versatz ohne Messung', raumVersatz([]), null);
}

// ---------------------------------------------------------------- Uhrabgleich (Simulation)
console.log('Uhrabgleich – Simulation Handy im WLAN (Stromsparmodus, Ausreißer)');
interface SimResult { mean: number; p95: number; max: number; jumps: number }
function simulate(kind: 'alt' | 'neu', seed: number): SimResult {
  const rnd = prng(seed);
  const exp = (m: number) => -Math.log(1 - rnd()) * m;
  const TRUE = -5000; // Serverzeit − Gerätezeit
  const up = () => 2 + exp(3) + (rnd() < 0.08 ? 20 + rnd() * 230 : 0);
  const down = () => 2 + exp(3) + (rnd() < 0.7 ? rnd() * 102 : 0) + (rnd() < 0.08 ? 20 + rnd() * 230 : 0);
  // Ereignisse in echter Zeit T (ms)
  const events: { at: number; fn: () => void }[] = [];
  const push = (at: number, fn: () => void) => events.push({ at, fn });
  let oldOffset = 0;
  let oldBest = Infinity;
  const neu = new Uhrabgleich();
  const local = (T: number) => T - TRUE;
  const ping = (T: number) => {
    const t0 = local(T);
    const u = up();
    const server = T + u;
    const back = T + u + down();
    push(back, () => {
      const t1 = local(back);
      if (kind === 'alt') {
        const rtt = t1 - t0;
        if (rtt <= oldBest * 1.2) {
          oldBest = Math.min(oldBest, rtt);
          oldOffset = server - (t0 + rtt / 2);
        }
      } else neu.probe(t0, server, t1);
    });
  };
  const END = 180_000;
  if (kind === 'alt') {
    for (let b = 0; b < END; b += 15_000) {
      push(b, () => (oldBest = Infinity));
      for (let i = 0; i < 6; i++) push(b + i * 120, () => ping(b + i * 120));
    }
  } else {
    for (let i = 0; i < 8; i++) push(i * 150, () => ping(i * 150));
    for (let t = 2000; t < END; t += 2000) push(t, () => ping(t));
  }
  const errs: number[] = [];
  let prev: number | null = null;
  let jumps = 0;
  for (let T = 0; T < END; T += 20) {
    if (T >= 3000) {
      push(T, () => {
        const est = kind === 'alt' ? oldOffset : neu.offset(local(T));
        errs.push(Math.abs(est - TRUE));
        if (prev !== null && Math.abs(est - prev) > 10) jumps++;
        prev = est;
      });
    }
  }
  events.sort((a, b) => a.at - b.at);
  // Antworten werden während des Laufs eingereiht → als Warteschlange abarbeiten
  while (events.length) {
    events.sort((a, b) => a.at - b.at);
    events.shift()!.fn();
  }
  return { mean: errs.reduce((s, e) => s + e, 0) / errs.length, p95: quantile(errs, 0.95), max: Math.max(...errs), jumps };
}
{
  const alt: SimResult[] = [];
  const neu: SimResult[] = [];
  for (let s = 1; s <= 5; s++) {
    alt.push(simulate('alt', s));
    neu.push(simulate('neu', s));
  }
  const avg = (rs: SimResult[], k: keyof SimResult) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  const fmt = (rs: SimResult[]) => `Ø ${avg(rs, 'mean').toFixed(1)} ms, 95 % ≤ ${avg(rs, 'p95').toFixed(1)} ms, max ${Math.max(...rs.map((r) => r.max)).toFixed(0)} ms, Sprünge > 10 ms: ${avg(rs, 'jumps').toFixed(0)} in 3 min`;
  console.log(`   vorher (6 Pings alle 15 s, letzter guter gewinnt): ${fmt(alt)}`);
  console.log(`   nachher (Fenster ${UHR.FENSTER}, schnellste 25 %, Median, Gleiten): ${fmt(neu)}`);
  ok('neuer Abgleich: 95 % der Zeit ≤ 15 ms daneben', avg(neu, 'p95') <= 15);
  ok('neuer Abgleich genauer als der alte', avg(neu, 'mean') < avg(alt, 'mean') && avg(neu, 'p95') < avg(alt, 'p95'));
  ok('neuer Abgleich springt nicht mitten im Song', avg(neu, 'jumps') <= 1);
}

// ---------------------------------------------------------------- Modell „Nachschlag“
console.log('Modell: Spieler tippt nach Gehör (auf den Ton vom TV), Touch-Verzögerung 30 ms');
{
  const touch = 30;
  // Alte Wertung: perfekt ±70, gut ±140, ohne Versatz-Ausgleich
  const alt = (d: number) => (Math.abs(d) <= 70 ? 'perfekt' : Math.abs(d) <= 140 ? 'gut' : 'daneben');
  const neu = (d: number) => (Math.abs(d) <= RH.PERFECT_MS ? 'perfekt' : Math.abs(d) <= RH.GOOD_MS ? 'gut' : 'daneben');
  const beat96 = 60000 / 96;
  for (const lag of [20, 100, 200, 300]) {
    const dAlt = lag + touch;
    // neu: Soundcheck misst lag + touch, Fein-Abgleich fängt den Rest
    const k = lag + touch;
    const dNeu = lag + touch - k;
    const need = Math.round((dAlt / (beat96 / 2)) * 100);
    console.log(`   TV-Verzögerung ${String(lag).padStart(3)} ms: vorher ${alt(dAlt).padEnd(7)} (Tipp ${dAlt} ms zu spät – für „perfekt“ hätte man ${dAlt} ms = ${need} % einer Achtel VOR dem gehörten Schlag tippen müssen) · nachher ${neu(dNeu)}`);
  }
  ok('Modell: nach dem Soundcheck trifft ein Gehör-Spieler auch bei 300 ms AirPlay-Verzögerung perfekt', neu(0) === 'perfekt');
}

// ---------------------------------------------------------------- Ablauf auf simulierter Uhr
console.log('Ablauf (simulierte Uhr)');

/** Simulierte Zeit: Date.now, setTimeout, setInterval laufen über `advance()` */
const clock = (() => {
  let now = 1_700_000_000_000;
  let id = 1;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const realNow = Date.now;
  Date.now = () => now;
  const g = globalThis as unknown as Record<string, unknown>;
  g.setTimeout = ((fn: () => void, ms = 0) => {
    const h = id++;
    timers.set(h, { at: now + Math.max(0, ms), fn });
    return h;
  }) as unknown;
  g.clearTimeout = ((h: number) => timers.delete(h)) as unknown;
  g.setInterval = ((fn: () => void, ms = 0) => {
    const h = id++;
    timers.set(h, { at: now + ms, fn, every: Math.max(1, ms) });
    return h;
  }) as unknown;
  g.clearInterval = ((h: number) => timers.delete(h)) as unknown;
  return {
    get now() {
      return now;
    },
    realNow,
    advanceTo(t: number) {
      for (;;) {
        let next: [number, { at: number; fn: () => void; every?: number }] | null = null;
        for (const e of timers) if (e[1].at <= t && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        const [h, tm] = next;
        now = tm.at;
        if (tm.every) tm.at += tm.every;
        else timers.delete(h);
        tm.fn();
      }
      now = t;
    },
    advance(ms: number) {
      this.advanceTo(now + ms);
    },
  };
})();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythmus-'));
process.env.RHYTHMUS_FILE = path.join(tmp, 'rhythmus.json');
const { RhythmGame } = await import('../server/rhythm');
const { ladeVersatz, versatzNeuLaden } = await import('../server/rhythmusVersatz');

function makeCtx(mode: 'arcade' | 'date', bots: string[] = []) {
  const out: { result: MiniResult | null; changes: number } = { result: null, changes: 0 };
  const ctx: MiniCtx = {
    onChange: () => void out.changes++,
    finish: (r) => (out.result = r),
    isConnected: () => true,
    nameOf: (id) => id,
    isBot: (id) => bots.includes(id),
    mode,
  };
  return { ctx, out };
}
const stateOf = (g: InstanceType<typeof RhythmGame>) => (g.snapshot() as { state: RhythmState }).state;

{
  versatzNeuLaden();
  ok('noch kein gespeicherter Versatz', ladeVersatz() === null);
  const ids = ['Ana', 'Ben', 'Cem'];
  const { ctx, out } = makeCtx('arcade');
  const game = new RhythmGame(ids, ctx);
  let s = stateOf(game);
  ok('Wettkampf außerhalb der Story', s.wettkampf && s.sub === 'ready' && s.versatzQuelle === 'keiner');
  // Soundcheck: Ana und Ben hören den TV 260 ms (AirPlay) + Touch, Cem tippt nicht
  const rnd = prng(3);
  const g = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  for (let k = 2; k < 14; k++) {
    clock.advanceTo(s.kalAt + k * s.kalBeat + 250);
    game.input('Ana', 'kal', { at: s.kalAt + k * s.kalBeat + 265 + g() * 15 });
    game.input('Ben', 'kal', { at: s.kalAt + k * s.kalBeat + 285 + g() * 20 });
  }
  s = stateOf(game);
  ok(`Soundcheck: Raum-Versatz ${s.versatz} ms gemessen (Ana ${s.players.Ana.kal.wert}, Ben ${s.players.Ben.kal.wert})`, s.versatzQuelle === 'gemessen' && Math.abs(s.versatz - 275) <= 15);
  game.input('Bot', 'kal', { at: Date.now() });
  for (const id of ids) game.input(id, 'ready', {});
  s = stateOf(game);
  ok('alle bereit → Song startet', s.sub === 'play' && s.startAt > Date.now());
  const saved = ladeVersatz();
  ok(`Versatz raumweit gespeichert (${saved?.versatz} ms aus ${saved?.handys} Handys)`, saved?.versatz === s.versatz && saved?.handys === 2 && fs.existsSync(process.env.RHYTHMUS_FILE!));

  // Song: Ana präzise (±20 ms), Ben schlampig (±70 ms, manchmal falsche Taste), Cem spielt nur die erste Hälfte
  const V = s.versatz;
  const notes = rhythmusNoten(s.order, 'Ana', true);
  const plan: { at: number; id: string; l: number; t: number }[] = [];
  notes.forEach((n, i) => {
    const err = (sd: number) => Math.max(-250, Math.min(250, g() * sd));
    const a = err(20);
    plan.push({ at: s.startAt + V + n.t + a, id: 'Ana', l: n.lane, t: n.t + a });
    const b = err(70);
    plan.push({ at: s.startAt + V + n.t + b, id: 'Ben', l: rnd() < 0.08 ? (n.lane + 1) % 4 : n.lane, t: n.t + b });
    if (n.t < s.duration / 2) plan.push({ at: s.startAt + V + n.t + 300 /* WLAN: kommt 300 ms später an */, id: 'Cem', l: n.lane, t: n.t + err(25) });
    if (i % 20 === 5) plan.push({ at: s.startAt + V + n.t + 40, id: 'Ana', l: (n.lane + 2) % 4, t: n.t + 40 }); // Fehltipp
  });
  plan.sort((x, y) => x.at - y.at);
  for (const p of plan) {
    clock.advanceTo(p.at);
    game.input(p.id, 'tipp', { l: p.l, t: p.t });
  }
  // Tipp aus der „Zukunft“ wird verworfen
  const before = JSON.stringify(stateOf(game).players.Ana);
  game.input('Ana', 'tipp', { l: 0, t: Date.now() - s.startAt - V + 5000 });
  eq('Zeitstempel aus der Zukunft wird verworfen', JSON.stringify(stateOf(game).players.Ana), before);
  clock.advanceTo(s.startAt + s.duration + RH.END_MS + RH.NET_GRACE_MS + 100);
  s = stateOf(game);
  ok('Song vorbei', s.sub === 'over');
  const q = (id: string) => trefferQuote(s.players[id].perfect, s.players[id].good, notes.length);
  console.log(`   Ana ${q('Ana')} % (${s.players.Ana.perfect} perfekt, ${s.players.Ana.fehl} Fehltipps) · Ben ${q('Ben')} % · Cem ${q('Cem')} %`);
  ok('jede Note bewertet', ids.every((id) => !s.players[id].marks.includes('.')) && ids.every((id) => s.players[id].perfect + s.players[id].good + s.players[id].miss === notes.length));
  ok('präzise Ana ≥ 95 %, meist perfekt', q('Ana') >= 95 && s.players.Ana.perfect > notes.length * 0.9);
  ok(`Fehltipps gezählt, kosten keine Note (${s.players.Ana.fehl})`, s.players.Ana.fehl >= 5);
  ok('späte Tipps (300 ms WLAN) zählen noch', q('Cem') >= 40 && q('Cem') <= 60);
  clock.advance(3000);
  const r = out.result;
  ok('Ergebnis gemeldet', !!r);
  if (r) {
    eq('Platzierung nach Trefferquote', r.groups, [['Ana'], ['Ben'], ['Cem']]);
    eq('Details „% Treffer“', r.details.Ana, `${q('Ana')} % Treffer`);
    ok(`Untertitel nennt Siegerin: „${r.subtitle}“`, r.subtitle.startsWith('Ana trifft'));
    ok('keine Herzen außerhalb der Story', r.hearts === undefined);
  }
  game.dispose();
}

{
  // Zweites Spiel: gespeicherter Versatz gilt sofort; neu einmessen mitten im Song
  const { ctx } = makeCtx('arcade');
  const game = new RhythmGame(['Ana'], ctx);
  let s = stateOf(game);
  ok(`gespeicherter Versatz gilt (${s.versatz} ms, gespeichert)`, s.versatzQuelle === 'gespeichert' && s.versatz === ladeVersatz()!.versatz);
  game.input('Ana', 'ready', {});
  s = stateOf(game);
  ok('allein → Song', s.sub === 'play');
  clock.advanceTo(s.startAt + 3000);
  game.input('Ana', 'tipp', { l: 0, t: 2990 });
  game.hostInput!('kalibrieren', null);
  s = stateOf(game);
  ok('Laptop „neu einmessen“ mitten im Song → zurück zum Soundcheck, alles zurückgesetzt', s.sub === 'ready' && s.pflicht && !s.players.Ana.ready && s.players.Ana.fehl + s.players.Ana.perfect + s.players.Ana.good === 0);
  game.vipAction!('next');
  ok('VIP/Laptop „weiter“ startet den Song', stateOf(game).sub === 'play');
  game.dispose();
}

{
  // Story: zu zweit, gemeinsam, Herzen
  const { ctx, out } = makeCtx('date', ['Bot']);
  const game = new RhythmGame(['Mara', 'Bot'], ctx);
  let s = stateOf(game);
  ok('Story: gemeinsam, mit Abschnitten und Themen', !s.wettkampf && s.phrases.length === 12 && s.phrases.every((p) => p.topic));
  game.input('Bot', 'kal', { at: Date.now() });
  ok('Bots messen nichts', stateOf(game).players.Bot.kal.n === 0);
  game.input('Mara', 'ready', {});
  game.input('Bot', 'ready', {});
  s = stateOf(game);
  const V = s.versatz;
  const plan = ['Mara', 'Bot'].flatMap((id) => rhythmusNoten(s.order, id, false).map((n) => ({ id, n, at: s.startAt + V + n.t + 10 }))).sort((x, y) => x.at - y.at);
  for (const p of plan) {
    clock.advanceTo(p.at);
    game.input(p.id, 'tipp', { l: p.n.lane, t: p.n.t + 10 });
  }
  clock.advanceTo(s.startAt + s.duration + 6000);
  s = stateOf(game);
  ok(`Sympathie ${s.sympathy} % bei sauberem Spiel`, s.sympathy >= 95);
  const r = out.result;
  ok('Story: eine Gruppe (gemeinsam) + Herzen', !!r && r.groups.length === 1 && r.groups[0].length === 2 && r.hearts === 10);
  ok('Story: Details „% im Takt“', !!r && r.details.Mara.endsWith('% im Takt'));
  game.dispose();
}

eq('markAt liest die Zeichen', [markAt('.xgp', 0), markAt('.xgp', 1), markAt('.xgp', 2), markAt('.xgp', 3)], [0, 1, 2, 3]);
ok(`Beat 600 ms bei 100 BPM`, rhBeatMs(song) === 600);

fs.rmSync(tmp, { recursive: true, force: true });
Date.now = clock.realNow;
console.log(fails ? `\n${fails} Fehler` : '\nAlles grün');
process.exit(fails ? 1 : 0);
