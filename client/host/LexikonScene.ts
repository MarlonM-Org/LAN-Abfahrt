import Phaser from 'phaser';
import type { GameState, PlayerPublic } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { LEX_CAT, type LexState, type LexStep, lexShow } from '../../shared/lexikon';
import { C } from '../art/palette';
import { paintWoodFloor } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, ink, nameTag, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

const SOFT = '#7a5a3a';
const BOOKS = ['#a8342a', '#2d64a8', '#2f7d32', '#c98a10', '#6b3f86', '#8d5629', '#3b6f75', '#b5473a', '#d9c49a'];

/** Platz einer Antwortkarte im Raster */
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lügen-Lexikon: nächtliche Bibliothek, Antworten als Karteikarten, Aufdecken mit Stempel */
export class LexikonScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private juice!: Juice;
  private countdown = new Countdown();
  private total = 1;
  private timerY = 0;
  private timerKey = '';
  private stateKey = '';
  private sndWritten = 0;
  private sndVoted = 0;
  private spoken = '';

  constructor() {
    super('lexikon');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.timerY = 0;
    this.sndWritten = 0;
    this.sndVoted = 0;
    this.spoken = '';
    this.juice = new Juice(this, { depth: 900 });
    background(this, 'lexikon', WORLD.W, WORLD.H, paintLibrary);
    // Zwei Leselampen mit warmem, leicht flackerndem Licht
    for (const x of [26, 454]) {
      const glow = this.add.ellipse(x, 214, 70, 46, 0xffd27a, 0.16).setDepth(-700);
      this.tweens.add({ targets: glow, alpha: 0.08, duration: 900 + x, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.add.image(x, 230, ensureTex(this, 'lx_lamp', lampPix)).setDepth(-650);
    }
    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.layer.removeAll(true);
    });
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || !this.timerY) return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(99, this.timerY - 1, 282, 6);
    this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(100, this.timerY, 280 * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'lexikon') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}-${st.steps.length}`;
    const fresh = tKey !== this.timerKey;
    if (fresh) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
    }
    const key = JSON.stringify([tKey, st.written, st.voted, s.players.map((p) => p.connected)]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.sounds(st, fresh);

    this.layer.removeAll(true);
    this.timerY = 0;
    if (st.sub === 'write') this.renderWrite(s, st, fresh);
    else if (st.sub === 'vote') this.renderVote(st, fresh);
    else if (st.sub === 'reveal') this.renderReveal(st, fresh);
    else if (st.sub === 'scores') this.renderScores(st);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Das war das Lügen-Lexikon!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Auswertung ...'));
    }
  }

  /** Neue Frage: Auswahl-Ton · Lüge/Tipp: Tick · Abstimmung: Plopp · Zwischenstand: Münze · Ende: Fanfare */
  private sounds(st: LexState, fresh: boolean) {
    if (fresh) {
      if (st.sub === 'write') {
        sfx('select');
        if (st.mult > 1) {
          this.juice.banner('LETZTE FRAGE', `Alle Punkte ×${st.mult}!`, 1700);
          sfx('powerup', { delay: 0.2 });
        }
        const sayKey = `w-${st.round}`;
        if (this.spoken !== sayKey) {
          this.spoken = sayKey;
          say(`${st.mult > 1 ? 'Letzte Frage, doppelte Punkte! ' : ''}${st.prompt.replace(/_{2,}/g, ' … ')}`);
        }
      }
      if (st.sub === 'vote') {
        sfx('pop', { pitch: 0.9 });
        say('Und jetzt: Welche Antwort ist die Wahrheit?');
      }
      if (st.sub === 'scores') sfx('coin', { pitch: 1.3 });
      if (st.sub === 'over') sfx('fanfare');
    } else {
      if (st.sub === 'write' && st.written.length > this.sndWritten) sfx('tick', { pitch: 1.3 + st.written.length * 0.04, vol: 0.6 });
      if (st.sub === 'vote' && st.voted.length > this.sndVoted) sfx('tick', { pitch: 1 + st.voted.length * 0.05 });
    }
    this.sndWritten = st.written.length;
    this.sndVoted = st.voted.length;
  }

  // ---------------------------------------------------------------- Kopf mit Aufgabe

  /** Kopf: Frage-Nummer, Kategorie, Aufgabe mit Lücke – liefert die Unterkante (`compact`: Aufgabe klein, mehr Platz fürs Raster) */
  private header(st: LexState, compact = false) {
    const cat = LEX_CAT[st.cat];
    const label = `${st.rounds > 1 ? `Frage ${st.round}/${st.rounds}` : 'Lügen-Lexikon'} · ${cat.title.toUpperCase()}${st.mult > 1 ? ` · PUNKTE ×${st.mult}` : ''}`;
    const prompt = st.prompt.replace(/_{2,}/g, '_____');
    let q = ink(this, WORLD.W / 2, 0, prompt, { size: 16, wrap: 432 });
    if (compact || q.height > 40 || q.width > 434) {
      q.destroy();
      q = ink(this, WORLD.W / 2, 0, prompt, { wrap: 432 });
    }
    const h = Math.max(46, Math.ceil((26 + q.height + 8) / 2) * 2);
    this.layer.add(panel(this, 12, 6, 456, h));
    this.layer.add(ink(this, WORLD.W / 2, 14, label, { color: RED_INK }));
    q.setY(26 + Math.max(0, (h - 34 - q.height) / 2));
    this.layer.add(q);
    return 6 + h;
  }

  // ---------------------------------------------------------------- Schreiben

  private renderWrite(s: GameState, st: LexState, fresh: boolean) {
    const bottom = this.header(st);
    this.timerY = bottom + 4;
    const hint = this.add.container(WORLD.W / 2, bottom + 22);
    hint.add(this.add.rectangle(0, 0, 376, 28, 0x2d1b12, 0.82).setStrokeStyle(2, 0xffd25e));
    hint.add(txt(this, 0, -10, 'Erfindet am Handy eine glaubwürdige Antwort!', { color: GOLD }));
    hint.add(txt(this, 0, 2, 'Zu nah an der Wahrheit? Dann neu lügen!'));
    this.layer.add(hint);
    if (fresh) {
      hint.setScale(0.4).setAlpha(0);
      this.tweens.add({ targets: hint, scale: 1, alpha: 1, duration: 320, delay: 200, ease: 'Back.Out' });
    }
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => !!p);
    const n = players.length;
    const rows = n > 8 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const spacing = Math.min(58, 430 / perRow);
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = WORLD.W / 2 + ((i % perRow) - (inRow - 1) / 2) * spacing;
      // Zwei Reihen: Kärtchen neben dem Kopf, sonst darüber (sonst überdecken sie die Namen der oberen Reihe)
      const y = rows === 1 ? 222 : 168 + row * 72;
      const done = st.written.includes(p.id);
      const f = figure(this, p.look, x, y, 2);
      if (!done) f.setAlpha(p.connected ? 0.65 : 0.3);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, y + 3, p.name, done ? GREEN_INK : INK, spacing - 2));
      const bx = rows === 1 ? x : x + 17;
      const by = rows === 1 ? y - 62 : y - 40;
      if (done) {
        const card = this.add.image(bx, by, ensureTex(this, 'lx_card', cardPix)).setScale(2);
        this.layer.add(card);
      } else if (p.connected) {
        const b = ink(this, bx, by - 6, '...').setBackgroundColor('#fff6dc').setPadding(3, 2, 3, 2);
        this.layer.add(b);
        this.tweens.add({ targets: b, y: by - 9, duration: 500 + (i % 3) * 90, yoyo: true, repeat: -1 });
      }
    });
    this.layer.add(ink(this, WORLD.W / 2, 258, `${st.written.length}/${n} Lügen abgegeben`).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  // ---------------------------------------------------------------- Antwort-Raster

  /** Raster für n Karten zwischen `top` und `bottom`: 2 Spalten bis 4, 3 bis 9, darüber 4 */
  private grid(n: number, top: number, bottom: number): Cell[] {
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const gap = 5;
    const w = Math.floor((456 - (cols - 1) * gap) / cols / 2) * 2;
    const h = Math.floor(Math.min(58, (bottom - top - (rows - 1) * gap) / rows) / 2) * 2;
    const y0 = top + Math.max(0, (bottom - top - (rows * h + (rows - 1) * gap)) / 2);
    return Array.from({ length: n }, (_, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = i % cols;
      return { x: Math.round(WORLD.W / 2 + (col - (inRow - 1) / 2) * (w + gap)), y: Math.round(y0 + row * (h + gap) + h / 2), w, h };
    });
  }

  /**
   * Gemeinsame Schriftgröße fürs ganze Raster: Würde eine kurze Antwort größer geschrieben als die anderen,
   * stäche sie hervor – und könnte die Wahrheit verraten.
   */
  private gridFit(opts: string[], cells: Cell[]): Fit {
    const fits = opts.map((t, i) => fitSize(this, lexShow(t), textW(cells[i], i), cells[i].h - 12));
    return fits.some((f) => f.size === 8) ? { size: 8, scale: Math.min(...fits.map((f) => (f.size === 8 ? f.scale : 1))) } : { size: 16, scale: 1 };
  }

  /** Eine Antwortkarte mit Nummer (wie am Handy) */
  private card(text: string, i: number, c: Cell, fit: Fit) {
    const box = this.add.container(c.x, c.y);
    box.add(panel(this, -c.w / 2, -c.h / 2, c.w, c.h));
    const num = String(i + 1);
    const bw = badgeW(i);
    box.add(this.add.rectangle(-c.w / 2 + 2 + bw / 2, -c.h / 2 + 8, bw, 12, 0x2d1b12).setStrokeStyle(1, 0x5e3518));
    box.add(txt(this, -c.w / 2 + 2 + bw / 2, -c.h / 2 + 4, num, { color: GOLD, shadow: false }));
    // Text mittig im Bereich rechts neben der Nummer
    box.add(drawFit(this, lexShow(text), textW(c, i), 1, 0, fit).setX(bw / 2 + 1));
    return box;
  }

  private renderVote(st: LexState, fresh: boolean) {
    const opts = st.options ?? [];
    const bottom = this.header(st, opts.length > 6);
    const cells = this.grid(opts.length, bottom + 6, 246);
    const fit = this.gridFit(opts, cells);
    opts.forEach((t, i) => {
      const box = this.card(t, i, cells[i], fit);
      this.layer.add(box);
      if (fresh) {
        box.setScale(0.3).setAlpha(0);
        this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 260, delay: 60 + i * 70, ease: 'Back.Out' });
        sfx('whoosh', { delay: 0.06 + i * 0.07, vol: 0.35, pitch: 0.9 + i * 0.04, x: cells[i].x });
      }
    });
    if (st.endsIn > 0) this.timerY = bottom + 2;
    this.layer.add(
      ink(this, WORLD.W / 2, 252, `Welche ist die Wahrheit? Tippt am Handy! (${st.voted.length}/${st.players.length})`)
        .setBackgroundColor('#f7e4b5')
        .setPadding(4, 2, 4, 2),
    );
  }

  // ---------------------------------------------------------------- Aufdecken

  private renderReveal(st: LexState, fresh: boolean) {
    const opts = st.options ?? [];
    const bottom = this.header(st, opts.length > 6);
    const cells = this.grid(opts.length, bottom + 6, 246);
    const fit = this.gridFit(opts, cells);
    const cur = st.steps[st.steps.length - 1];
    // Raster im Hintergrund: schon entlarvte Lügen tragen einen roten Haken
    opts.forEach((t, i) => {
      const box = this.card(t, i, cells[i], fit);
      const shown = st.steps.slice(0, -1).find((x) => x.idx === i);
      if (shown) box.add(txt(this, cells[i].w / 2 - 6, -cells[i].h / 2 + 3, 'LÜGE', { color: '#ff8a7a', origin: [1, 0], shadow: false }));
      this.layer.add(box);
    });
    if (!cur) return;
    this.layer.add(this.add.rectangle(WORLD.W / 2, (bottom + 4 + WORLD.H) / 2, WORLD.W, WORLD.H - bottom - 4, 0x1a0f0a, 0.93));
    const text = opts[cur.idx] ?? '';
    const lieNo = st.steps.filter((x) => !x.truth).length;
    const lies = st.stepCount - 1;
    const top = bottom + 8;
    this.layer.add(txt(this, WORLD.W / 2, top, cur.truth ? 'UND DIE WAHRHEIT IST ...' : `LÜGE ${lieNo}/${lies} – WER IST REINGEFALLEN?`, { color: GOLD }));
    // Große Karte
    const cy = top + 42;
    const big = this.add.container(WORLD.W / 2, cy);
    big.add(panel(this, -170, -26, 340, 52));
    big.add(fitInk(this, lexShow(text), 316, 44, 0));
    this.layer.add(big);
    // Stempel: unten rechts an der Karte, damit der Text lesbar bleibt
    const stamp = this.add.container(WORLD.W / 2 + 122, cy + 33).setAngle(cur.truth ? -5 : -9);
    stamp.add(this.add.rectangle(0, 0, cur.truth ? 136 : 118, 26, cur.truth ? 0x2f7d32 : 0xa8342a, 0.92).setStrokeStyle(2, cur.truth ? 0xb8f0a0 : 0xffd25e));
    stamp.add(txt(this, 0, -8, cur.truth ? 'WAHRHEIT!' : 'GELOGEN!', { size: 16, color: cur.truth ? '#eaffd8' : GOLD }));
    this.layer.add(stamp);
    // Wer hat getippt?
    const py = cy + 50;
    this.layer.add(txt(this, WORLD.W / 2, py, cur.pickers.length ? (cur.truth ? `Richtig! +${cur.points}` : 'Reingefallen:') : cur.truth ? 'Keiner hat’s gewusst!' : '', { color: '#cfd6ff' }));
    const pickers = cur.pickers.map((id) => playerById(id)).filter((p): p is PlayerPublic => !!p);
    const pw = Math.min(64, 440 / Math.max(1, pickers.length));
    const pics: Phaser.GameObjects.GameObject[] = [];
    pickers.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (pickers.length - 1) / 2) * pw;
      const img = this.add.image(x, py + 22, ensurePortrait(this, p.look)).setScale(2);
      const nm = txt(this, x, py + 38, tagName(p.name).slice(0, Math.max(3, Math.floor((pw - 2) / 8))), {});
      this.layer.add([img, nm]);
      pics.push(img, nm);
    });
    // Autor bzw. Erklärung
    const ay = py + 52;
    const info: Phaser.GameObjects.GameObject[] = [];
    if (cur.truth) {
      if (st.why) info.push(txt(this, WORLD.W / 2, ay, st.why, { wrap: 440, color: '#fff4d6' }));
    } else if (cur.by.length) {
      const names = cur.by.map((id) => tagName(playerById(id)?.name ?? '?')).join(' & ');
      info.push(txt(this, WORLD.W / 2, ay, `Gelogen von ${names}  +${cur.points}`, { color: GOLD }));
    } else info.push(txt(this, WORLD.W / 2, ay, 'Haus-Lüge – das Lexikon war’s!', { color: '#ffb3a8' }));
    this.layer.add(info);
    if (!fresh) return;
    this.stepFx(st, cur, text, big, stamp, pics, info);
  }

  /** Aufdeck-Choreografie: Karte → Opfer → Stempel → Autor/Erklärung (mit Ton und Ansage) */
  private stepFx(st: LexState, cur: LexStep, text: string, big: Phaser.GameObjects.Container, stamp: Phaser.GameObjects.Container, pics: Phaser.GameObjects.GameObject[], info: Phaser.GameObjects.GameObject[]) {
    const t0 = cur.truth ? 900 : 0;
    big.setScale(0.3).setAlpha(0);
    this.tweens.add({ targets: big, scale: 1, alpha: 1, duration: 320, delay: t0, ease: 'Back.Out' });
    if (cur.truth) sfx('drumroll', { vol: 0.8 });
    else sfx('whoosh', { pitch: 0.9 });
    pics.forEach((o, i) => {
      (o as Phaser.GameObjects.Image).setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, duration: 200, delay: t0 + 450 + Math.floor(i / 2) * 110 });
    });
    stamp.setScale(2.4).setAlpha(0);
    const tStamp = t0 + (cur.truth ? 500 : 1300);
    this.tweens.add({ targets: stamp, scale: 1, alpha: 1, duration: 200, delay: tStamp, ease: 'Quad.In' });
    this.time.delayedCall(tStamp + 180, () => {
      if (cur.truth) {
        sfx('fanfare', { vol: 0.8 });
        sfx('cheer', { delay: 0.2, vol: 0.7 });
        this.juice.flash(0xfff1b0, 140);
        this.juice.burst(WORLD.W / 2, 120, 'confetti', 50);
      } else {
        sfx(cur.pickers.length >= 2 ? 'boom' : 'bonk', { vol: 0.7 });
        this.juice.shake(cur.pickers.length >= 3 ? 2 : 1);
        if (cur.by.length && cur.points) this.juice.float(WORLD.W / 2, 160, `+${cur.points}`, 'gold');
      }
    });
    for (const o of info) {
      (o as Phaser.GameObjects.Text).setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, duration: 260, delay: tStamp + 350 });
    }
    // Ansage (einmal pro Schritt)
    const sayKey = `r-${st.round}-${st.steps.length}`;
    if (this.spoken === sayKey) return;
    this.spoken = sayKey;
    if (cur.truth) say(`Die Wahrheit: ${text}!`);
    else if (!cur.by.length) say(`${text}? Eine Haus-Lüge!`);
    else say(`${text}? Gelogen von ${cur.by.map((id) => spokenName(playerById(id)?.name)).join(' und ')}!`);
  }

  // ---------------------------------------------------------------- Zwischenstand

  private renderScores(st: LexState) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0));
    const rowH = ranked.length > 8 ? 15 : 18;
    const h = 44 + ranked.length * rowH;
    const top = Math.round((WORLD.H - h) / 2);
    this.layer.add(panel(this, 110, top, 260, h + (h % 2)));
    const final = st.round >= st.rounds;
    this.layer.add(ink(this, WORLD.W / 2, top + 10, final ? 'Endstand' : `Zwischenstand nach Frage ${st.round}/${st.rounds}`, { color: RED_INK }));
    let place = 0;
    let prev = -1;
    ranked.forEach((id, i) => {
      const pts = st.points[id] ?? 0;
      if (pts !== prev) place = i + 1;
      prev = pts;
      const y = top + 30 + i * rowH;
      const p = playerById(id);
      this.layer.add(ink(this, 126, y, `${place}.`, { origin: [0, 0], color: place === 1 ? RED_INK : INK }));
      if (p) this.layer.add(this.add.image(156, y + 3, ensurePortrait(this, p.look)));
      this.layer.add(ink(this, 170, y, tagName(p?.name ?? '?').slice(0, 10), { origin: [0, 0] }));
      this.layer.add(ink(this, 312, y, String(pts), { origin: [1, 0] }));
      const gain = st.gain[id] ?? 0;
      if (gain) {
        const g = ink(this, 356, y, `+${gain}`, { origin: [1, 0], color: GREEN_INK });
        this.layer.add(g);
        g.setAlpha(0);
        this.tweens.add({ targets: g, alpha: 1, duration: 300, delay: 300 + i * 120 });
      }
    });
    if (final) this.layer.add(ink(this, WORLD.W / 2, top + h - 12, 'Gleich gibt’s die Auswertung ...', { color: SOFT }));
  }
}

/** Schriftgröße: 16 px oder 8 px mit Skalierung */
interface Fit {
  size: 8 | 16;
  scale: number;
}

/** Breite des Nummernschilds einer Karte */
const badgeW = (i: number) => String(i + 1).length * 8 + 6;
/** Platz für den Antworttext rechts neben dem Nummernschild */
const textW = (c: Cell, i: number) => c.w - badgeW(i) - 12;

/** Gemerkte Schriftgröße je Text und Box (das Raster wird bei jeder Stimme neu gezeichnet) */
const fitCache = new Map<string, Fit>();

/** Text mit vorgegebener Größe mittig zeichnen (Umbruch wie bei `fitSize`) */
function drawFit(scene: Phaser.Scene, text: string, w: number, dy: number, pad: number, fit: Fit) {
  return ink(scene, 0, dy, text, { size: fit.size, wrap: Math.max(16, Math.floor((w - pad) / fit.scale)) })
    .setOrigin(0.5, 0.5)
    .setScale(fit.scale);
}

/** Größte Schrift, mit der der Text in die Box passt (16 px, sonst 8 px, notfalls kleiner bis 0,6) */
function fitSize(scene: Phaser.Scene, text: string, w: number, h: number, pad = 0): Fit {
  const key = `${text}|${w}|${h}|${pad}`;
  const known = fitCache.get(key);
  if (known) return known;
  const ok = (fit: Fit) => {
    const t = drawFit(scene, text, w, 0, pad, fit);
    const res = t.displayWidth <= w + 1 && t.displayHeight <= h;
    t.destroy();
    return res;
  };
  let fit: Fit = { size: 16, scale: 1 };
  if (!ok(fit)) {
    fit = { size: 8, scale: 1 };
    while (fit.scale - 0.05 >= 0.6 && !ok(fit)) fit = { size: 8, scale: Math.round((fit.scale - 0.05) * 100) / 100 };
  }
  fitCache.set(key, fit);
  return fit;
}

/** Text so groß wie möglich mittig in eine Box (w × h) */
function fitInk(scene: Phaser.Scene, text: string, w: number, h: number, dy: number, pad = 0) {
  return drawFit(scene, text, w, dy, pad, fitSize(scene, text, w, h, pad));
}

/** Hintergrund: Bibliothek bei Nacht – Regale voller Bücher, Holzboden */
function paintLibrary(p: Pix) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  p.rect(0, 0, WORLD.W, WORLD.H, '#2a1810');
  for (let y = 0; y < 236; y += 4) p.hline(0, y, WORLD.W, y % 8 ? '#2f1c12' : '#27160e');
  // Regalböden mit Büchern
  for (const shelf of [58, 118, 178, 236]) {
    let x = 2;
    while (x < WORLD.W - 4) {
      const w = 4 + Math.floor(rnd() * 5);
      const h = 30 + Math.floor(rnd() * 20);
      const col = BOOKS[Math.floor(rnd() * BOOKS.length)];
      if (rnd() < 0.08) {
        x += 6;
        continue;
      }
      p.rect(x, shelf - h, w, h, col);
      p.vline(x, shelf - h, h, '#1f120b');
      p.hline(x + 1, shelf - h + 4, w - 1, '#f0d98a');
      if (h > 40) p.hline(x + 1, shelf - 8, w - 1, '#f0d98a');
      x += w + (rnd() < 0.15 ? 2 : 0);
    }
    p.rect(0, shelf, WORLD.W, 5, C.woodDark);
    p.hline(0, shelf, WORLD.W, C.woodLight);
    p.hline(0, shelf + 5, WORLD.W, '#1a0f0a');
  }
  paintWoodFloor(p, 0, 241, WORLD.W, WORLD.H - 241, 29);
}

/** Leselampe (Messingfuß, grüner Schirm) */
function lampPix() {
  const p = new Pix(16, 22);
  p.rect(2, 2, 12, 6, '#2f7d32');
  p.hline(2, 2, 12, '#7fd47f');
  p.rect(7, 8, 2, 11, '#c98a10');
  p.rect(4, 19, 8, 3, '#c98a10');
  p.hline(4, 21, 8, '#8a5a10');
  p.outline(C.outline);
  return p;
}

/** Abgegebene Lüge: kleine Karteikarte */
function cardPix() {
  const p = new Pix(12, 10);
  p.rect(1, 1, 10, 8, '#fff6dc');
  p.hline(3, 3, 6, '#a8342a');
  p.hline(3, 5, 6, '#c9ab78');
  p.hline(3, 7, 4, '#c9ab78');
  p.outline(C.outline);
  return p;
}
