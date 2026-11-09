/**
 * Montagsmaler live: Bot-Verhalten.
 * Als Maler wählt er ein Wort und kritzelt ein paar Striche – Punkt für Punkt, gebündelt wie ein Handy (~15 Hz),
 * manchmal mit „Zurück“. Als Rater tippt er alle paar Sekunden ein Wort aus der Liste, das zu Länge und
 * aufgedeckten Buchstaben passt (ab und zu mit Tippfehler – testet den unscharfen Vergleich).
 */
import type { GameState, PrivateState } from '../shared/types';
import { MALER, MALER_WORDS, type MalerOp, type MalerState, malerDisplay, malerFits } from '../shared/maler';
import { POST, POST_BRUSHES, POST_COLORS } from '../shared/stillepost';

export interface MalerBotHost {
  id: string;
  priv: PrivateState;
  state: GameState | null;
  send(action: string, payload?: unknown): void;
  once(key: string, fn: () => Promise<void> | void): void;
}

interface Mem {
  seen: Set<string>;
  /** Op-Zähler des eigenen Bilds */
  n: number;
  round: number;
  tried: Set<string>;
}

const mems = new WeakMap<MalerBotHost, Mem>();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cur = (bot: MalerBotHost) => (bot.state?.mini?.kind === 'maler' ? bot.state.mini.state : null);
const myPriv = (bot: MalerBotHost, round: number) => (bot.priv?.kind === 'maler' && bot.priv.state.round === round ? bot.priv.state : null);

export function malerBot(bot: MalerBotHost, st: MalerState) {
  let mem = mems.get(bot);
  if (!mem) mems.set(bot, (mem = { seen: new Set(), n: 0, round: -1, tried: new Set() }));
  if (st.sub === 'over') {
    mem.seen.clear();
    return;
  }
  if (!st.players.includes(bot.id)) return;
  if (mem.round !== st.round) {
    mem.round = st.round;
    mem.n = 0;
    mem.tried.clear();
  }
  const r = st.round;
  const me = st.drawer === bot.id;

  // Wort wählen
  if (st.sub === 'choose' && me && !mem.seen.has(`choose-${r}`)) {
    mem.seen.add(`choose-${r}`);
    bot.once(`maler-choose-${r}`, async () => {
      await sleep(rand(1200, 4000));
      const s = cur(bot);
      if (s?.sub !== 'choose' || s.round !== r) return;
      bot.send('choose', { round: r, index: Math.floor(Math.random() * MALER.CHOICES) });
    });
  }

  // Malen: ein paar Kritzel-Striche, live verschickt
  if (st.sub === 'draw' && me && !mem.seen.has(`draw-${r}`)) {
    mem.seen.add(`draw-${r}`);
    bot.once(`maler-draw-${r}`, () => drawScribbles(bot, mem!, r));
  }
  // Server hat Striche verpasst → ganzes Bild (der Bot merkt sich keins: leeres Bild mit seinem Zähler)
  if (st.sub === 'draw' && me && myPriv(bot, r)?.need && !mem.seen.has(`full-${r}-${mem.n}`)) {
    mem.seen.add(`full-${r}-${mem.n}`);
    bot.send('full', { round: r, n: mem.n, s: [] });
  }

  // Raten: alle paar Sekunden ein passendes Wort
  if (st.sub === 'draw' && !me && !st.guessed.includes(bot.id)) {
    bot.once(`maler-guess-${r}`, async () => {
      await sleep(rand(2500, 6500));
      const s = cur(bot);
      if (s?.sub !== 'draw' || s.round !== r || s.guessed.includes(bot.id)) return;
      const fits = MALER_WORDS.map(malerDisplay).filter((w) => malerFits(w, s.hint) && !mem!.tried.has(w));
      const pool = fits.length ? fits : MALER_WORDS.map(malerDisplay).filter((w) => !mem!.tried.has(w));
      const word = pool[Math.floor(Math.random() * pool.length)];
      if (!word) return;
      mem!.tried.add(word);
      bot.send('guess', { round: r, text: Math.random() < 0.15 ? typo(word) : word });
    });
  }
}

/** Tippfehler: zwei Buchstaben in der Mitte vertauschen oder einen weglassen */
function typo(w: string): string {
  if (w.length < 5) return w.toLowerCase();
  const i = 1 + Math.floor(Math.random() * (w.length - 3));
  return Math.random() < 0.5 ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w.slice(0, i) + w.slice(i + 1);
}

/** Kreis, Linie, Zickzack oder Spirale als Punktliste im Raster */
function shape(): number[] {
  const G = POST.GRID;
  const cx = rand(50, G - 50);
  const cy = rand(50, G - 50);
  const pts: number[] = [];
  const add = (x: number, y: number) => pts.push(Math.round(Math.max(0, Math.min(G, x))), Math.round(Math.max(0, Math.min(G, y))));
  const kind = Math.floor(Math.random() * 4);
  if (kind === 0) {
    const rad = rand(15, 50);
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.18) add(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  } else if (kind === 1) {
    const x1 = rand(20, G - 20);
    const y1 = rand(20, G - 20);
    for (let t = 0; t <= 1.001; t += 0.06) add(cx + (x1 - cx) * t, cy + (y1 - cy) * t);
  } else if (kind === 2) {
    for (let i = 0; i < 9; i++) add(cx - 40 + i * 10, cy + (i % 2 ? -14 : 14));
  } else {
    for (let a = 0; a < Math.PI * 5; a += 0.25) add(cx + Math.cos(a) * a * 3, cy + Math.sin(a) * a * 3);
  }
  return pts;
}

async function drawScribbles(bot: MalerBotHost, mem: Mem, r: number) {
  const still = () => {
    const s = cur(bot);
    return s?.sub === 'draw' && s.round === r && s.drawer === bot.id;
  };
  const send = (ops: MalerOp[]) => {
    bot.send('ink', { round: r, n: mem.n, ops });
    mem.n += ops.length;
  };
  await sleep(rand(600, 1500));
  const strokes = 3 + Math.floor(Math.random() * 4);
  for (let k = 0; k < strokes && still(); k++) {
    const pts = shape();
    const c = Math.floor(Math.random() * POST_COLORS.length);
    const w = Math.floor(Math.random() * POST_BRUSHES.length);
    send([{ t: 's', c, w, p: pts.slice(0, 2) }]);
    for (let i = 2; i < pts.length && still(); i += 6) {
      await sleep(MALER.SEND_MS);
      send([{ t: 'a', p: pts.slice(i, i + 6) }]);
    }
    await sleep(rand(300, 900));
    // Ab und zu „Zurück“ (testet das Neuzeichnen am TV)
    if (Math.random() < 0.15 && still()) send([{ t: 'u' }]);
  }
}
