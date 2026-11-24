import Phaser from 'phaser';
import type { GameState, PlayerPublic, PostStroke } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { POST, POST_BRUSHES, POST_PAPER, postColor } from '../../shared/stillepost';
import { type MalerState, applyInkOp, cloneStrokes } from '../../shared/maler';
import { playerColor } from '../../shared/players';
import { C } from '../art/palette';
import { Pix, rng } from '../art/pix';
import { paintWoodFloor } from '../art/ground';
import { bus, getState, hostMini, playerById } from './store';
import { figure } from './textures';
import { GOLD, GREEN_INK, INK, LIGHT, RED_INK, Countdown, background, ensureTex, fitText, ink, panel, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { hdFactor } from './hd';

const W = WORLD.W;
const SOFT = '#7a5a3a';
/** Kopfzeile (Bild, Maler, Wort-Lücken, Sekunden) */
const HD = { y: 2, h: 32 };
/** Zeitbalken unter der Kopfzeile */
const BAR_Y = 36;
/** Zeichenfläche (Papier) in Welt-Pixeln */
const CV = { x: 10, y: 47, s: 216 };
/** Rechte Tafel: Punkte + Rate-Chat */
const PN = { x: 236, y: 42, w: 240, h: 226 };
const ROW_H = 12;
const CHAT_H = 11;
const hexNum = (hex: string) => parseInt(hex.slice(1), 16);
const PAPER = hexNum(POST_PAPER);

/**
 * Montagsmaler live: Staffelei links (die Striche des Malers kommen live über den Server und werden inkrementell in
 * eine RenderTexture gemalt – wie beim Kurven-Duell), rechts Punkte und Rate-Chat, oben das Wort als Lücken mit
 * den aufgedeckten Buchstaben. Fehlen Striche (neuer TV, Szene neu gestartet), holt sich der TV ein Schlüsselbild.
 */
export class MalerScene extends Phaser.Scene {
  private rt!: Phaser.GameObjects.RenderTexture;
  private pen!: Phaser.GameObjects.Graphics;
  private rtPx = CV.s;
  private header!: Phaser.GameObjects.Container;
  private board!: Phaser.GameObjects.Container;
  private chatLayer!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private secText!: Phaser.GameObjects.Text;
  private pencil!: Phaser.GameObjects.Image;
  private juice!: Juice;
  private countdown = new Countdown();
  private total = 1;
  private phaseKey = '';
  private headerKey = '';
  private boardKey = '';
  private chatKey = '';
  private rowPos = new Map<string, { x: number; y: number }>();
  /** Oberkante des Chats (unter der Punkte-Tafel) */
  private chatTop = PN.y + 90;
  // --- Striche
  private mirror: PostStroke[] = [];
  private inkRound = -1;
  private applied = 0;
  private cursor = { si: 0, pi: 0 };
  private lastSync = 0;
  private lastOpAt = 0;
  // --- für Töne/Ansagen
  private prev: MalerState | null = null;
  private lastTickSec = 0;

  constructor() {
    super('maler');
  }

  create() {
    this.phaseKey = '';
    this.headerKey = '';
    this.boardKey = '';
    this.chatKey = '';
    this.rowPos = new Map();
    this.chatTop = PN.y + 90;
    this.mirror = [];
    this.inkRound = -1;
    this.applied = 0;
    this.cursor = { si: 0, pi: 0 };
    this.lastSync = 0;
    this.lastOpAt = 0;
    this.prev = null;
    this.lastTickSec = 0;
    this.total = 1;

    background(this, 'maler', W, WORLD.H, paintAtelier);
    // Staffelei-Rahmen um das Papier
    const f = this.add.graphics().setDepth(-10);
    f.fillStyle(0x2d1b12).fillRect(CV.x - 5, CV.y - 5, CV.s + 10, CV.s + 10);
    f.fillStyle(0x8d5629).fillRect(CV.x - 4, CV.y - 4, CV.s + 8, CV.s + 8);
    f.fillStyle(0xb8783f).fillRect(CV.x - 4, CV.y - 4, CV.s + 8, 1).fillRect(CV.x - 4, CV.y - 4, 1, CV.s + 8);
    f.fillStyle(0x5e3518).fillRect(CV.x - 1, CV.y - 1, CV.s + 2, CV.s + 2);

    // Doppelte Auflösung bei HD-TVs (halbe Welt-Pixel wie die übrigen Szenen) – Striche bleiben kantig
    this.rtPx = CV.s * hdFactor();
    this.rt = this.add.renderTexture(CV.x, CV.y, this.rtPx, this.rtPx).setOrigin(0, 0).setScale(CV.s / this.rtPx).setDepth(0);
    this.rt.fill(PAPER);
    this.pen = this.make.graphics({}, false);
    this.pencil = this.add.image(0, 0, ensureTex(this, 'ml_pencil', pencilIcon)).setOrigin(0.1, 0.9).setDepth(5).setVisible(false);

    panel(this, PN.x, PN.y, PN.w, PN.h).setDepth(-5);
    panel(this, 4, HD.y, W - 8, HD.h).setDepth(-5);
    this.header = this.add.container(0, 0).setDepth(20);
    this.board = this.add.container(0, 0).setDepth(20);
    this.chatLayer = this.add.container(0, 0).setDepth(20);
    this.overlay = this.add.container(0, 0).setDepth(30);
    this.timerBar = this.add.graphics().setDepth(25);
    this.secText = ink(this, W - 14, HD.y + 8, '', { size: 16, origin: [1, 0] }).setDepth(21);
    this.juice = new Juice(this, { depth: 900 });

    const onState = (s: GameState) => this.onState(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.prev;
    // Zeitbalken + Sekunden
    this.timerBar.clear();
    const rem = this.countdown.remaining;
    const live = st && (st.sub === 'choose' || st.sub === 'draw') && !this.countdown.none;
    if (live) {
      const frac = Math.max(0, Math.min(1, rem / this.total));
      this.timerBar.fillStyle(0x2d1b12).fillRect(6, BAR_Y, W - 12, 4);
      this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(7, BAR_Y + 1, (W - 14) * frac, 2);
      const sec = Math.ceil(rem / 1000);
      this.secText.setText(String(sec)).setColor(st.sub === 'draw' && sec <= 10 ? RED_INK : INK);
      if (st.sub === 'draw' && sec <= 5 && sec >= 1 && sec !== this.lastTickSec) sfx('tick', { pitch: 1.3 });
      this.lastTickSec = sec;
    } else this.secText.setText('');

    // Stift am Ende des Strichs, solange live gemalt wird
    const last = this.mirror[this.mirror.length - 1];
    const drawing = st?.sub === 'draw' && last && performance.now() - this.lastOpAt < 700;
    this.pencil.setVisible(!!drawing);
    if (drawing && last) {
      const n = last.p.length / 2;
      this.pencil.setPosition(CV.x + (last.p[(n - 1) * 2] * CV.s) / POST.GRID, CV.y + (last.p[(n - 1) * 2 + 1] * CV.s) / POST.GRID);
    }
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'maler') return;
    const st = s.mini.state;
    const pk = `${st.sub}-${st.round}`;
    if (pk !== this.phaseKey || st.endsIn < this.countdown.remaining - 1500) {
      if (pk !== this.phaseKey) this.total = Math.max(1, st.total || st.endsIn);
      this.countdown.set(st.endsIn);
    }
    const fresh = pk !== this.phaseKey;
    this.phaseKey = pk;
    this.syncInk(st);
    this.renderHeader(st);
    this.renderBoard(s, st);
    this.renderChat(st);
    if (fresh) this.renderOverlay(st);
    this.cues(s, st, fresh);
    this.prev = st;
  }

  /** Töne, Ansagen, schwebende Punkte */
  private cues(s: GameState, st: MalerState, fresh: boolean) {
    const prev = this.prev;
    const name = (id: string) => spokenName(playerById(id)?.name);
    if (fresh) {
      if (st.sub === 'choose') {
        sfx('select');
        say(`${name(st.drawer)} malt!`);
      } else if (st.sub === 'draw') sfx('whoosh');
      else if (st.sub === 'reveal') {
        if (st.why === 'all') (sfx('cheer'), this.juice.burst(CV.x + CV.s / 2, CV.y + 40, 'confetti'));
        else if (st.guessed.length) sfx('win');
        else sfx('lose');
        if (st.word) say(`Das war: ${st.word}`, { interrupt: true });
      } else if (st.sub === 'over') sfx('fanfare');
    }
    if (!prev || prev.round !== st.round || st.sub !== 'draw') return;
    // Neuer Buchstabe
    if (prev.hint !== st.hint && prev.hint.split('_').length > st.hint.split('_').length) sfx('pop', { pitch: 1.3 });
    // Neue Chat-Zeilen
    const lastN = prev.chat[prev.chat.length - 1]?.n ?? 0;
    for (const c of st.chat) {
      if (c.n <= lastN) continue;
      if (c.ok) {
        const k = st.guessed.indexOf(c.id);
        sfx('coin', { pitch: 1 + Math.min(0.6, k * 0.08) });
        if (k === 0) say(`${name(c.id)} hat's!`);
        const pos = this.rowPos.get(c.id);
        if (pos) this.juice.float(pos.x, pos.y - 2, `+${st.gain[c.id] ?? 0}`, 'gold');
      } else sfx('tick', { vol: 0.35, pitch: 0.9 });
    }
    const dg = (st.gain[st.drawer] ?? 0) - (prev.gain[st.drawer] ?? 0);
    const dp = this.rowPos.get(st.drawer);
    if (dp && dg > 0) this.juice.float(dp.x, dp.y - 2, `+${dg}`, 'gold');
    const others = s.players.filter((p) => p.connected && st.players.includes(p.id) && p.id !== st.drawer).length;
    if (st.guessed.length > prev.guessed.length && st.guessed.length >= others) this.juice.banner('Alle haben’s!', '', 900);
  }

  // ---------------------------------------------------------------- Kopfzeile: Bild, Maler, Wort-Lücken

  private renderHeader(st: MalerState) {
    const key = JSON.stringify([st.sub, st.round, st.drawer, st.hint, st.word]);
    if (key === this.headerKey) return;
    const hintChanged = this.headerKey !== '' && (JSON.parse(this.headerKey) as unknown[])[3] !== st.hint;
    this.headerKey = key;
    this.header.removeAll(true);
    const top = HD.y;
    const drawer = tagName(playerById(st.drawer)?.name ?? '?');
    if (st.sub !== 'over') {
      this.header.add(ink(this, 12, top + 6, `Bild ${st.round}/${st.rounds}`, { color: RED_INK, origin: [0, 0] }));
      this.header.add(fitText(ink(this, 12, top + 18, `${drawer} malt`, { color: SOFT, origin: [0, 0] }), 92));
    } else this.header.add(ink(this, 12, top + 12, 'Endstand', { color: RED_INK, origin: [0, 0] }));

    const cx = W / 2 + 6;
    if (st.sub === 'choose') {
      this.header.add(fitText(ink(this, cx, top + 12, `${drawer} sucht ein Wort aus ...`, { color: SOFT }), 280));
      return;
    }
    if (st.sub === 'over') {
      this.header.add(ink(this, cx, top + 8, 'Montagsmaler live', { size: 16, color: RED_INK }));
      return;
    }
    const chars = [...st.hint];
    const pitch = Math.min(20, Math.floor(290 / Math.max(1, chars.length)));
    const big = pitch >= 17;
    const x0 = cx - (pitch * chars.length) / 2 + pitch / 2;
    const reveal = st.sub === 'reveal';
    const letters = chars.filter((c) => c !== ' ' && c !== '-').length;
    chars.forEach((c, i) => {
      const x = Math.round(x0 + i * pitch);
      if (c === ' ') return;
      if (c !== '-') this.header.add(this.add.rectangle(x, top + 25, pitch - 4, 2, reveal ? 0x2f7d32 : 0x3d2414).setOrigin(0.5, 0));
      if (c === '_') return;
      const t = ink(this, x, big ? top + 8 : top + 14, c, { size: big ? 16 : 8, color: reveal ? GREEN_INK : c === '-' ? INK : RED_INK });
      this.header.add(t);
      if (hintChanged && !reveal) {
        t.setScale(2);
        this.tweens.add({ targets: t, scale: 1, duration: 300, ease: 'Back.Out' });
      }
    });
    if (!reveal) this.header.add(ink(this, x0 + pitch * (chars.length - 0.5) + 4, top + 17, `(${letters})`, { color: SOFT, origin: [0, 0] }));
  }

  // ---------------------------------------------------------------- Punkte-Tafel

  private renderBoard(s: GameState, st: MalerState) {
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => !!p);
    const key = JSON.stringify([st.sub, st.drawer, st.points, st.gain, st.guessed, players.map((p) => [p.name, p.connected, p.color])]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    this.rowPos.clear();
    const sorted = [...players].sort((a, b) => (st.points[b.id] ?? 0) - (st.points[a.id] ?? 0));
    const cols = sorted.length > 6 ? 2 : 1;
    const perCol = Math.ceil(sorted.length / cols);
    const colW = Math.floor((PN.w - 12) / cols);
    const x0 = PN.x + 6;
    const y0 = PN.y + 7;
    const showGain = st.sub === 'draw' || st.sub === 'reveal';
    sorted.forEach((p, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const x = x0 + col * colW;
      const y = y0 + row * ROW_H;
      const drawer = p.id === st.drawer && st.sub !== 'over';
      const got = st.guessed.includes(p.id);
      if (drawer || got) this.board.add(this.add.rectangle(x, y - 1, colW - 2, ROW_H - 1, drawer ? 0xf2c33a : 0x9be37f, drawer ? 0.55 : 0.6).setOrigin(0, 0));
      this.board.add(this.add.rectangle(x + 2, y + 1, 7, 7, playerColor(p.color).num).setOrigin(0, 0).setStrokeStyle(1, 0x2d1b12).setAlpha(p.connected ? 1 : 0.4));
      const gain = showGain ? (st.gain[p.id] ?? 0) : 0;
      const ptsText = ink(this, x + colW - 5, y + 1, String(st.points[p.id] ?? 0), { origin: [1, 0], color: INK });
      this.board.add(ptsText);
      let right = ptsText.x - ptsText.width - 3;
      if (gain > 0) {
        const g = ink(this, right, y + 1, `+${gain}`, { origin: [1, 0], color: GREEN_INK });
        this.board.add(g);
        right = g.x - g.width - 3;
      }
      let nx = x + 12;
      if (drawer || got) {
        this.board.add(this.add.image(nx + 3, y + 4, ensureTex(this, drawer ? 'ml_pencil' : 'ml_check', drawer ? pencilIcon : checkIcon)).setScale(drawer ? 0.8 : 0.9));
        nx += 10;
      }
      this.board.add(fitText(ink(this, nx, y + 1, tagName(p.name), { origin: [0, 0], color: p.connected ? INK : SOFT }), Math.max(20, right - nx - 2), 0.75));
      this.rowPos.set(p.id, { x: x + colW - 16, y });
    });
    const sepY = y0 + perCol * ROW_H + 2;
    this.board.add(this.add.rectangle(PN.x + 8, sepY, PN.w - 16, 1, 0xd3ad6c).setOrigin(0, 0));
    this.chatTop = sepY + 4;
    this.chatKey = '';
  }

  // ---------------------------------------------------------------- Rate-Chat

  private renderChat(st: MalerState) {
    const key = `${st.round}-${st.sub}-${st.chat[st.chat.length - 1]?.n ?? 0}-${this.chatTop}`;
    if (key === this.chatKey) return;
    const prevLast = Number(this.chatKey.split('-')[2] ?? 0);
    const sameRound = this.chatKey.startsWith(`${st.round}-`);
    this.chatKey = key;
    this.chatLayer.removeAll(true);
    const bottom = PN.y + PN.h - 8;
    const fit = Math.max(1, Math.floor((bottom - this.chatTop) / CHAT_H));
    const lines = st.chat.slice(-fit);
    if (!lines.length) {
      const hint = st.sub === 'draw' ? 'Tippt eure Tipps am Handy!' : st.sub === 'choose' ? 'Gleich geht’s los ...' : '';
      if (hint) this.chatLayer.add(ink(this, PN.x + PN.w / 2, this.chatTop + 6, hint, { color: SOFT }));
      return;
    }
    const y0 = bottom - lines.length * CHAT_H;
    lines.forEach((c, i) => {
      const y = y0 + i * CHAT_H;
      const p = playerById(c.id);
      const nm = tagName(p?.name ?? '?');
      const row = this.add.container(PN.x + 8, y);
      if (c.ok) {
        row.add(this.add.rectangle(-2, -1, PN.w - 12, CHAT_H - 1, 0x9be37f, 0.55).setOrigin(0, 0));
        row.add(this.add.image(4, 4, ensureTex(this, 'ml_check', checkIcon)).setScale(0.9));
        row.add(fitText(ink(this, 11, 1, `${nm} hat’s!`, { origin: [0, 0], color: GREEN_INK }), PN.w - 28));
      } else {
        row.add(this.add.rectangle(1, 2, 5, 5, playerColor(p?.color ?? 0).num).setOrigin(0, 0).setStrokeStyle(1, 0x2d1b12));
        row.add(fitText(ink(this, 10, 1, `${nm}: ${c.text ?? ''}`, { origin: [0, 0], color: INK }), PN.w - 26, 0.6));
      }
      this.chatLayer.add(row);
      if (sameRound && c.n > prevLast) {
        row.x += 30;
        row.alpha = 0;
        this.tweens.add({ targets: row, x: PN.x + 8, alpha: 1, duration: 180, ease: 'Quad.Out' });
      }
    });
  }

  // ---------------------------------------------------------------- Überlagerungen auf dem Papier

  private renderOverlay(st: MalerState) {
    this.overlay.removeAll(true);
    const cx = CV.x + CV.s / 2;
    const p = playerById(st.drawer);
    const fitInk = (y: number, text: string, opts: Parameters<typeof ink>[4] = {}) => this.overlay.add(fitText(ink(this, cx, y, text, opts), CV.s - 16, 0.5));
    if (st.sub === 'choose') {
      if (p) {
        const fig = figure(this, p.look, cx, CV.y + 140, 3);
        this.overlay.add(fig);
        this.tweens.add({ targets: fig, y: fig.y - 3, duration: 450, yoyo: true, repeat: -1 });
      }
      const dots = this.add.image(cx + 26, CV.y + 52, ensureTex(this, 'ml_think', thinkIcon)).setScale(2);
      this.overlay.add(dots);
      this.tweens.add({ targets: dots, y: dots.y - 4, duration: 500, yoyo: true, repeat: -1 });
      fitInk(CV.y + 154, `${tagName(p?.name ?? '?')} ist dran!`, { size: 16, color: RED_INK });
      fitInk(CV.y + 180, 'sucht sich am Handy ein Wort aus –', { color: SOFT });
      fitInk(CV.y + 193, 'alle anderen raten gleich mit!', { color: SOFT });
    } else if (st.sub === 'draw') {
      const t = ink(this, cx, CV.y + CV.s / 2 - 8, 'Los geht’s!', { size: 16, color: RED_INK });
      this.overlay.add(t);
      this.tweens.add({ targets: t, alpha: 0, y: t.y - 12, delay: 900, duration: 500, onComplete: () => t.destroy() });
    } else if (st.sub === 'reveal' && st.word) {
      const ph = 62;
      const plateY = CV.y + CV.s - ph - 4;
      this.overlay.add(panel(this, CV.x + 4, plateY, CV.s - 8, ph, 'dark'));
      const sub = st.why === 'gone' ? 'Maler weg – das Wort war:' : st.guessed.length ? 'Das Wort war:' : 'Keiner hat’s! Es war:';
      this.overlay.add(fitText(txt(this, cx, plateY + 9, sub, { color: LIGHT }), CV.s - 24));
      const word = fitText(txt(this, cx, plateY + 22, st.word.toUpperCase(), { size: 16, color: GOLD }), CV.s - 28, 0.5);
      this.overlay.add(word);
      const full = word.scale;
      word.setScale(full * 0.3);
      this.tweens.add({ targets: word, scale: full, duration: 380, ease: 'Back.Out' });
      const n = st.guessed.length;
      this.overlay.add(txt(this, cx, plateY + 43, `${n}/${st.players.length - 1} haben’s erraten`, { color: n ? '#9ad65a' : '#ff8a7a' }));
    } else if (st.sub === 'over') {
      this.overlay.add(ink(this, cx, CV.y + 80, 'Das war', { size: 16, color: SOFT }));
      fitInk(CV.y + 102, 'Montagsmaler!', { size: 16, color: RED_INK });
      fitInk(CV.y + 132, 'Gleich gibt’s die Auswertung ...', { color: SOFT });
    }
  }

  // ---------------------------------------------------------------- Striche (live)

  private syncInk(st: MalerState) {
    const ink = st.ink;
    if (st.round !== this.inkRound || ink.seq < this.applied) {
      this.inkRound = st.round;
      this.mirror = [];
      this.applied = 0;
      this.redraw();
    }
    if (ink.seq === this.applied) return;
    if (ink.from <= this.applied) {
      let structural = false;
      for (let i = this.applied - ink.from; i < ink.ops.length; i++) structural = applyInkOp(this.mirror, ink.ops[i]) || structural;
      this.applied = ink.seq;
      this.lastOpAt = performance.now();
      if (structural) this.redraw();
      else this.paintNew();
    } else if (ink.full) {
      this.mirror = cloneStrokes(ink.full);
      this.applied = ink.seq;
      this.redraw();
    } else if (performance.now() - this.lastSync > 800) {
      // Striche verpasst → Schlüsselbild anfordern (kommt sonst spätestens nach ein paar Sekunden von selbst)
      this.lastSync = performance.now();
      hostMini('sync');
    }
  }

  private redraw() {
    this.rt.clear();
    this.rt.fill(PAPER);
    this.cursor = { si: 0, pi: 0 };
    this.paintNew();
  }

  /** Malt alles ab dem Cursor (neue Punkte des letzten Strichs, neue Striche) in die RenderTexture */
  private paintNew() {
    const k = this.rtPx / POST.GRID;
    const pen = this.pen;
    let any = false;
    for (let si = this.cursor.si; si < this.mirror.length; si++) {
      const st = this.mirror[si];
      const n = st.p.length / 2;
      const col = hexNum(postColor(st.c));
      const r = Math.max(0.75, ((POST_BRUSHES[st.w] ?? POST_BRUSHES[1]) * k) / 2);
      pen.fillStyle(col, 1);
      pen.lineStyle(r * 2, col, 1);
      for (let pi = si === this.cursor.si ? this.cursor.pi : 0; pi < n; pi++) {
        const x = st.p[pi * 2] * k;
        const y = st.p[pi * 2 + 1] * k;
        if (pi > 0) pen.lineBetween(st.p[pi * 2 - 2] * k, st.p[pi * 2 - 1] * k, x, y);
        pen.fillCircle(x, y, r);
        any = true;
      }
    }
    if (any) {
      this.rt.draw(pen);
      pen.clear();
    }
    const last = this.mirror.length - 1;
    this.cursor = last >= 0 ? { si: last, pi: this.mirror[last].p.length / 2 } : { si: 0, pi: 0 };
  }
}

// ------------------------------------------------------------------ Pixel-Art

/** Atelier: gestreifte Wand mit Farbklecksen, Holzboden (schaut nur zwischen Staffelei und Tafeln hervor) */
function paintAtelier(p: Pix) {
  const H = WORLD.H;
  p.rect(0, 0, W, H, '#cfe3e8');
  for (let x = 0; x < W; x += 12) p.rect(x, 0, 6, 200, '#c3dade');
  const r = rng(9);
  const blots = ['#f2c33a', '#e04a3f', '#46b04a', '#3f8fe0', '#8f4a7d'];
  for (let i = 0; i < 40; i++) p.disc(Math.round(r() * W), Math.round(r() * 190), 1 + Math.round(r()), blots[i % blots.length]);
  p.rect(0, 196, W, 4, C.woodDark);
  paintWoodFloor(p, 0, 200, W, H - 200, 53);
}

function pencilIcon(): Pix {
  const p = new Pix(11, 11);
  p.map(0, 0, [
    '........dd.',
    '.......dYYd',
    '......dYYYd',
    '.....dYYYd.',
    '....dYYYd..',
    '...dYYYd...',
    '..dWYYd....',
    '.dWWWd.....',
    '.dWWd......',
    'dKKd.......',
    'dd.........',
  ], { d: C.outline, Y: '#f2c33a', W: '#f1d49a', K: '#3d2414' });
  return p;
}

function checkIcon(): Pix {
  const p = new Pix(10, 9);
  p.map(1, 1, ['......gg', '.....gg.', 'gg..gg..', '.gggg...', '..gg....'], { g: '#2f7d32' });
  p.outline(C.outline);
  return p;
}

function thinkIcon(): Pix {
  const p = new Pix(19, 9);
  p.rect(1, 1, 17, 7, C.white);
  for (const x of [5, 9, 13]) p.rect(x, 4, 2, 2, C.ink);
  p.outline(C.outline);
  return p;
}
