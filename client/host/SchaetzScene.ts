import Phaser from 'phaser';
import type { GameState, PlayerPublic, SchaetzState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { SCHAETZ, fmtNum, fmtShort } from '../../shared/schaetz';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintSky } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, ink, nameTag, panel, prop, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { pcol } from './playerColor';

const LINE_Y = 164;
const SOFT = '#7a5a3a';

/** Ein Platz auf dem Zahlenstrahl: −1 = „Alle zu hoch“, sonst Kartenindex */
interface Slot {
  k: number;
  x: number;
  /** Mitte der Karte */
  y: number;
  up: boolean;
}

/** Schätzkönig: Quiz-Show am Strand bei Sonnenuntergang, Karten auf einem Zahlenstrahl */
export class SchaetzScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private stateKey = '';
  private timerY = 0;
  private juice!: Juice;
  /** Chips pro Platz beim letzten Zeichnen (nur neue Chips springen ein) */
  private chipSeen = new Map<number, number>();
  private guessedN = 0;
  private spokenRound = '';

  constructor() {
    super('schaetz');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.timerY = 0;
    this.chipSeen = new Map();
    this.guessedN = 0;
    this.spokenRound = '';
    this.juice = new Juice(this, { depth: 900 });
    background(this, 'schaetz', WORLD.W, WORLD.H, (p) => {
      paintSky(p, 0, 0, WORLD.W, 128, ['#2c2a6b', '#6a3f86', '#c25b7a', '#f39a5b', '#ffd27a']);
      // Sonne am Horizont
      p.disc(240, 128, 26, '#ffe39a');
      p.disc(240, 128, 20, '#fff1c4');
      for (let i = 0; i < 30; i++) p.px((i * 89) % WORLD.W, (i * 41) % 60, i % 4 ? '#e9d7ff' : C.white);
      // Meer mit Sonnenglitzern
      p.rect(0, 128, WORLD.W, 24, '#3d4f8f');
      for (let y = 131; y < 152; y += 4) for (let x = (y * 7) % 13; x < WORLD.W; x += 13) p.hline(x, y, 5, Math.abs(x - 240) < 40 ? '#ffd27a' : '#5b6fb0');
      paintSand(p, 0, 152, WORLD.W, WORLD.H - 152, 23);
      p.hline(0, 152, WORLD.W, '#fbe7bd');
    });
    prop(this, 'sz_palmL', () => O.palm(4), 18, 160).setDepth(-800);
    prop(this, 'sz_palmR', () => O.palm(9), 462, 160).setDepth(-800).setFlipX(true);
    prop(this, 'sz_umb', () => O.umbrella(C.blue, C.white), 452, 266).setDepth(-700);
    // Glühbirnen der Show-Bühne
    for (let i = 0; i < 20; i++) {
      const bulb = this.add.rectangle(16 + i * 23.5, 3, 3, 3, i % 2 ? 0xffd25e : 0xf07aa8).setDepth(-600);
      this.tweens.add({ targets: bulb, alpha: 0.3, duration: 380 + (i % 3) * 120, yoyo: true, repeat: -1 });
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
    if (s.mini?.kind !== 'schaetz') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}`;
    const fresh = tKey !== this.timerKey;
    if (fresh) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
      if (st.sub !== 'bet' && st.sub !== 'reveal') this.chipSeen.clear();
    } else if (st.endsIn < this.countdown.remaining - 400) {
      // „Alle fertig“ → der Server kürzt ab
      this.countdown.set(st.endsIn);
    }
    const key = JSON.stringify([tKey, st.guessed, st.chips, s.players.map((p) => p.connected)]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.sounds(st, fresh);

    this.layer.removeAll(true);
    this.timerY = 0;
    if (st.sub === 'guess') this.renderGuess(s, st);
    else if (st.sub === 'scores') this.renderScores(st);
    else if (st.sub === 'over') {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Das war Schätzkönig!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Auswertung ...'));
    } else this.renderLine(s, st, fresh);
  }

  /** Neue Frage: Auswahl-Ton · Schätzung: Tick · Karten: Wusch · Chips: Münze · Trommelwirbel · Auflösung: Jubel */
  private sounds(st: SchaetzState, fresh: boolean) {
    const guessed = st.guessed.length;
    if (fresh) {
      if (st.sub === 'guess') sfx('select');
      if (st.sub === 'line') for (let i = 0; i <= Math.min(8, st.cards?.length ?? 0); i++) sfx('whoosh', { delay: i * 0.12, vol: 0.5, pitch: 0.9 + i * 0.05 });
      if (st.sub === 'bet') sfx('pop', { pitch: 0.9 });
      if (st.sub === 'truth') sfx('tick', { pitch: 0.8 });
      if (st.sub === 'drum') {
        sfx('drumroll', { vol: 0.8 });
        this.juice.shake(1);
      }
      if (st.sub === 'scores') sfx('coin', { pitch: 1.3 });
      if (st.sub === 'over') sfx('fanfare');
      if (st.sub === 'reveal') this.revealFx(st);
    } else if (st.sub === 'guess' && guessed > this.guessedN) sfx('tick', { pitch: 1 + guessed * 0.05 });
    this.guessedN = guessed;
  }

  private revealFx(st: SchaetzState) {
    const key = `${st.round}`;
    sfx('coin', { pitch: 1.1 });
    sfx('cheer', { delay: 0.15, vol: 0.75 });
    const slots = this.slots(st);
    const w = slots.find((sl) => sl.k === st.winner);
    this.time.delayedCall(250, () => this.juice.burst(w?.x ?? WORLD.W / 2, (w?.y ?? 120) - 10, 'confetti', 44));
    const exact = st.winner !== null && st.winner >= 0 && st.cards?.[st.winner]?.value === st.answer;
    if (exact) {
      this.time.delayedCall(500, () => {
        this.juice.banner('VOLLTREFFER!', 'genau richtig geschätzt', 1500);
        sfx('fanfare', { vol: 0.8 });
        this.juice.flash(0xfff1b0, 160);
      });
    }
    if (this.spokenRound !== key && st.answer !== null) {
      this.spokenRound = key;
      const unit = st.unit ? ` ${st.unit}` : '';
      const authors = st.winner !== null && st.winner >= 0 ? (st.cards?.[st.winner]?.by ?? []) : [];
      const who = authors.length ? ` Am nächsten dran: ${authors.map((id) => spokenName(playerById(id)?.name)).join(' und ')}.` : ' Alle lagen drüber!';
      say(`${st.answerByMedian ? 'Der Median' : 'Die richtige Antwort'}: ${st.answer}${unit}.${who}`);
    }
  }

  // ---------------------------------------------------------------- Frage-Kopf

  /** Fragekopf; in der Auflösung steht die Frage klein oben und die Antwort groß darunter */
  private header(st: SchaetzState, small = false, revealFresh?: boolean) {
    const h = small ? 52 : 60;
    const q = st.question;
    if (revealFresh !== undefined && st.answer !== null) {
      // Panel wächst mit der Frage (1–2 Zeilen), bleibt aber über den Karten (≤ y 78)
      const qt = ink(this, WORLD.W / 2, 15, q, { wrap: 424 });
      const ans = ink(this, WORLD.W / 2, 15 + qt.height + 4, `${st.answerByMedian ? 'Median' : 'Richtig'}: ${fmtNum(st.answer)}${st.unit ? ` ${st.unit}` : ''}`, { size: 16, color: RED_INK }).setOrigin(0.5, 0);
      if (ans.width > 424) ans.setScale(424 / ans.width);
      const ph = Math.min(70, Math.ceil((ans.y + 16 + 7 - 8) / 2) * 2);
      this.layer.add(panel(this, 16, 8, 448, ph));
      this.layer.add([qt, ans]);
      if (revealFresh) {
        const sc = ans.scale;
        ans.setScale(sc * 0.2);
        this.tweens.add({ targets: ans, scale: sc, duration: 380, ease: 'Back.Out' });
      }
      return 8 + ph;
    }
    this.layer.add(panel(this, 16, 8, 448, h));
    const subj = st.subject ? playerById(st.subject) : null;
    const label = `${st.rounds > 1 ? `Frage ${st.round}/${st.rounds}` : 'Schätzkönig'}${subj ? ` · GRUPPENFRAGE über ${tagName(subj.name)}` : ''}`;
    this.layer.add(ink(this, WORLD.W / 2, 15, label, { color: RED_INK }));
    const size = q.length <= 26 ? 16 : 8;
    this.layer.add(ink(this, WORLD.W / 2, 8 + (h + 14) / 2, q, { size, wrap: 424 }).setOrigin(0.5, 0.5));
    return 8 + h;
  }

  // ---------------------------------------------------------------- Schätzen

  private renderGuess(s: GameState, st: SchaetzState) {
    const bottom = this.header(st);
    this.timerY = bottom + 4;
    const tip = this.add.container(WORLD.W / 2, 100);
    tip.add(this.add.rectangle(0, 0, 300, 30, 0x2d1b12, 0.75).setStrokeStyle(2, 0xffd25e));
    tip.add(txt(this, 0, -8, 'Zahl am Handy eintippen!', { size: 8, color: GOLD }));
    tip.add(txt(this, 0, 4, st.unit ? `Antwort in ${st.unit}` : 'Antwort als Jahreszahl', { size: 8 }));
    this.layer.add(tip);
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PlayerPublic => !!p);
    const n = players.length;
    const rows = n > 8 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const spacing = Math.min(58, 430 / perRow);
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = WORLD.W / 2 + ((i % perRow) - (inRow - 1) / 2) * spacing;
      const y = rows === 1 ? 222 : 186 + row * 62;
      const done = st.guessed.includes(p.id);
      const f = figure(this, p.look, x, y, 2);
      if (!done) f.setAlpha(p.connected ? 0.65 : 0.3);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, y + 3, p.name, done ? GREEN_INK : INK, spacing - 2));
      const by = y - 64;
      if (done) {
        const card = this.add.container(x, by);
        card.add(this.add.rectangle(0, 0, 22, 16, 0xf7e4b5).setStrokeStyle(2, 0x5e3518));
        card.add(ink(this, 0, -4, '✓', { color: GREEN_INK }));
        this.layer.add(card);
      } else if (p.connected) {
        const b = ink(this, x, by - 6, '?').setBackgroundColor('#fff6dc').setPadding(4, 2, 4, 2);
        this.layer.add(b);
        this.tweens.add({ targets: b, y: by - 9, duration: 480 + (i % 3) * 90, yoyo: true, repeat: -1 });
      }
    });
    if (st.subject) {
      const subj = playerById(st.subject);
      this.layer.add(ink(this, WORLD.W / 2, 130, `${tagName(subj?.name ?? '?')} darf mitschätzen – und bluffen!`, { color: '#fff4d6' }));
    }
  }

  // ---------------------------------------------------------------- Zahlenstrahl

  /**
   * Plätze auf dem Strahl: ganz links „Alle zu hoch“, dann die Karten aufsteigend.
   * Ab 7 Plätzen im Zickzack (oben/unten), damit auch 12 Karten nebeneinander passen.
   */
  private layout(st: SchaetzState) {
    const n = (st.cards?.length ?? 0) + 1;
    const zig = n > 6;
    let spacing = n > 1 ? Math.min(78, 396 / (n - 1)) : 0;
    let cw = 72;
    if (zig) {
      spacing = Math.min(78, 474 / (n + 1));
      cw = Math.min(72, Math.floor((2 * spacing - 6) / 2) * 2);
      if (cw >= 72) spacing = Math.min(78, (468 - 72) / (n - 1));
    }
    return { n, zig, spacing, cw };
  }

  private slots(st: SchaetzState): Slot[] {
    const { n, zig, spacing } = this.layout(st);
    return Array.from({ length: n }, (_, j) => {
      const up = !zig || j % 2 === 0;
      return { k: j - 1, x: Math.round(WORLD.W / 2 + (j - (n - 1) / 2) * spacing), y: up ? 116 : 214, up };
    });
  }

  private cardW(st: SchaetzState) {
    return this.layout(st).cw;
  }

  private renderLine(s: GameState, st: SchaetzState, fresh: boolean) {
    const reveal = st.sub === 'reveal';
    const bottom = this.header(st, true, reveal ? fresh : undefined);
    if (st.sub === 'bet' || st.sub === 'truth') this.timerY = bottom + 3;
    // Der Strahl
    const g = this.add.graphics();
    g.fillStyle(0x2d1b12).fillRect(14, LINE_Y - 2, 452, 5);
    g.fillStyle(0xfff4d6).fillRect(14, LINE_Y - 1, 448, 3);
    g.fillStyle(0x2d1b12).fillTriangle(462, LINE_Y - 6, 472, LINE_Y + 0.5, 462, LINE_Y + 7);
    this.layer.add(g);
    const slots = this.slots(st);
    const cw = this.cardW(st);
    const ch = 44;
    const cards = st.cards ?? [];
    // Chips pro Platz einsammeln (Farbe des Spielers)
    const chipsAt = new Map<number, string[]>();
    for (const [id, picks] of Object.entries(st.chips)) for (const k of picks) chipsAt.set(k, [...(chipsAt.get(k) ?? []), id]);

    slots.forEach((sl, j) => {
      const low = sl.k < 0;
      const card = low ? null : cards[sl.k];
      const won = reveal && st.winner === sl.k;
      const lost = reveal && !won;
      // Stecknadel zum Strahl
      const pin = this.add.graphics();
      pin.fillStyle(won ? 0xffd25e : 0x5e3518).fillRect(sl.x - 1, sl.up ? sl.y + ch / 2 : LINE_Y, 2, sl.up ? LINE_Y - sl.y - ch / 2 : sl.y - ch / 2 - LINE_Y);
      pin.fillStyle(0x2d1b12).fillRect(sl.x - 3, LINE_Y - 3, 6, 6);
      pin.fillStyle(won ? 0xffd25e : 0xf7e4b5).fillRect(sl.x - 2, LINE_Y - 2, 4, 4);
      this.layer.add(pin);

      const c = this.add.container(sl.x, sl.y);
      c.add(panel(this, -cw / 2, -ch / 2, cw, ch, low ? 'dark' : 'paper'));
      if (low) {
        c.add(txt(this, 0, -12, 'ALLE', { size: 8, color: '#ffb3a8' }));
        c.add(txt(this, 0, -2, 'ZU HOCH', { size: 8, color: '#ffb3a8' }));
      } else if (card) {
        const label = fmtShort(card.value);
        const big = label.length * 16 <= cw - 10;
        const t = ink(this, 0, big ? -14 : -10, label, { size: big ? 16 : 8 }).setOrigin(0.5, 0);
        if (t.width > cw - 8) t.setScale((cw - 8) / t.width);
        c.add(t);
        // Autoren als Porträts
        const ppl = card.by.map((id) => playerById(id)).filter((p): p is PlayerPublic => !!p);
        const room = Math.max(1, Math.floor((cw - 10) / 12));
        const shown = ppl.slice(0, ppl.length > room ? room - 1 : room);
        const step = Math.min(17, (cw - 12) / Math.max(1, shown.length + (ppl.length > shown.length ? 1 : 0)));
        const start = -((shown.length + (ppl.length > shown.length ? 1 : 0) - 1) * step) / 2;
        shown.forEach((p, i) => c.add(this.add.image(start + i * step, 11, ensurePortrait(this, p.look))));
        if (ppl.length > shown.length) c.add(ink(this, start + shown.length * step, 7, `+${ppl.length - shown.length}`, { color: SOFT }));
      }
      // Quote
      const odds = low ? st.lowOdds : (card?.odds ?? 2);
      const badge = this.add.container(cw / 2 - 9, -ch / 2 + 1);
      badge.add(this.add.rectangle(0, 0, 20, 11, odds >= 4 ? 0xa8342a : odds === 3 ? 0xd99a2b : 0x2f7d32).setStrokeStyle(1, 0x2d1b12));
      badge.add(txt(this, 0, -4, `×${odds}`, { size: 8, color: '#fff4d6', shadow: false }));
      c.add(badge);
      if (lost) c.setAlpha(0.55);
      this.layer.add(c);
      if (won) {
        const crown = this.add.image(sl.x, sl.y - ch / 2 - 6, ensureTex(this, 'crown', O.crown)).setScale(2);
        this.layer.add(crown);
        this.tweens.add({ targets: crown, y: '-=3', duration: 300, yoyo: true, repeat: -1 });
        if (fresh) this.tweens.add({ targets: c, scale: 1.18, duration: 260, ease: 'Back.Out', yoyo: true, hold: 500 });
      }
      if (fresh && st.sub === 'line') {
        const fromY = sl.up ? -40 : WORLD.H + 40;
        c.setY(fromY);
        this.tweens.add({ targets: c, y: sl.y, duration: 420, delay: 120 * j, ease: 'Back.Out' });
      }
      this.drawChips(sl, chipsAt.get(sl.k) ?? [], ch, fresh && !reveal, won);
    });

    // Antwort-Markierung auf dem Strahl (zwischen Gewinner und nächster Karte)
    if (reveal && st.answer !== null) {
      const wi = slots.findIndex((sl) => sl.k === st.winner);
      const a = slots[Math.max(0, wi)];
      const b = slots[wi + 1];
      const exact = st.winner !== null && st.winner >= 0 && cards[st.winner]?.value === st.answer;
      const mx = exact ? a.x : b ? (a.x + b.x) / 2 : Math.min(470, a.x + 22);
      const mark = this.add.container(mx, LINE_Y);
      mark.add(this.add.triangle(0, -9, -6, -8, 6, -8, 0, 2, 0xffd25e).setStrokeStyle(1, 0x2d1b12));
      mark.add(this.add.rectangle(0, 0, 3, 14, 0xa8342a));
      this.layer.add(mark);
      if (fresh) {
        mark.setY(LINE_Y - 80).setAlpha(0);
        this.tweens.add({ targets: mark, y: LINE_Y, alpha: 1, duration: 380, ease: 'Bounce.Out' });
      }
    }
    this.footer(s, st);
  }

  /** Chips als Münzen in Spielerfarbe zwischen Karte und Strahl; neue springen herein */
  private drawChips(sl: Slot, ids: string[], ch: number, animate: boolean, won: boolean) {
    const seen = this.chipSeen.get(sl.k) ?? 0;
    const perRow = 8;
    const baseY = sl.up ? sl.y + ch / 2 + 6 : sl.y - ch / 2 - 6;
    ids.forEach((id, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, ids.length - row * perRow);
      const x = sl.x + ((i % perRow) - (inRow - 1) / 2) * 7;
      const y = baseY + (sl.up ? 1 : -1) * row * 6;
      const col = pcol(id);
      const img = this.add.image(x, y, ensureTex(this, `sz_chip_${col.hex}`, () => chipPix(col.hex)));
      this.layer.add(img);
      if (animate && i >= seen) {
        img.setScale(2.4).setAlpha(0);
        this.tweens.add({ targets: img, scale: 1, alpha: 1, duration: 260, ease: 'Back.Out' });
        sfx('coin', { pitch: 1.2 + Math.random() * 0.4, vol: 0.4, x });
      }
      if (won) this.tweens.add({ targets: img, y: y - 3, duration: 220, yoyo: true, repeat: -1, delay: i * 40 });
    });
    this.chipSeen.set(sl.k, ids.length);
  }

  private footer(s: GameState, st: SchaetzState) {
    const bar = (text: string, color = INK) =>
      this.layer.add(ink(this, WORLD.W / 2, 252, text, { color }).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2).setOrigin(0.5, 0));
    if (st.sub === 'line') bar('Die Schätzungen – von klein nach groß');
    else if (st.sub === 'bet') bar(`${SCHAETZ.CHIPS} Chips setzen: nächste Karte ohne drüber! (${st.betDone.length}/${st.players.length})`);
    else if (st.sub === 'truth') {
      const vip = s.players.find((p) => p.isVip);
      const subj = st.subject ? playerById(st.subject) : null;
      const own = !!vip && vip.id === st.subject;
      bar(own ? `${tagName(vip.name)}: tipp ehrlich die echte Zahl ein!` : `${tagName(vip?.name ?? 'VIP')}: frag ${tagName(subj?.name ?? '?')} und tipp die Zahl ein!`, RED_INK);
    } else if (st.sub === 'drum') {
      const t = txt(this, WORLD.W / 2, 250, 'Und die richtige Antwort ist ...', { size: 8, color: GOLD });
      this.layer.add(t);
      this.tweens.add({ targets: t, scale: 1.12, duration: 240, yoyo: true, repeat: -1 });
    } else if (st.sub === 'reveal') this.renderGains(st);
  }

  /** Wer hat in dieser Runde gepunktet? */
  private renderGains(st: SchaetzState) {
    const winners = Object.entries(st.gain ?? {})
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    if (!winners.length) {
      this.layer.add(ink(this, WORLD.W / 2, 252, 'Keine Chips auf der richtigen Karte!').setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2).setOrigin(0.5, 0));
      return;
    }
    const shown = winners.slice(0, 10);
    const w = 44;
    const x0 = WORLD.W / 2 - ((shown.length - 1) * w) / 2;
    const plate = this.add.rectangle(WORLD.W / 2, 258, shown.length * w + 8, 20, 0x2d1b12, 0.8).setStrokeStyle(2, 0x5e3518);
    this.layer.add(plate);
    shown.forEach(([id, v], i) => {
      const p = playerById(id);
      const x = x0 + i * w;
      if (p) this.layer.add(this.add.image(x - 9, 258, ensurePortrait(this, p.look)));
      const t = txt(this, x + 9, 254, `+${v}`, { size: 8, color: GOLD });
      this.layer.add(t);
      t.setAlpha(0);
      this.tweens.add({ targets: t, alpha: 1, duration: 260, delay: 600 + i * 110 });
    });
  }

  // ---------------------------------------------------------------- Zwischenstand

  private renderScores(st: SchaetzState) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0));
    const rowH = ranked.length > 8 ? 15 : 18;
    const h = 44 + ranked.length * rowH;
    const top = Math.round((WORLD.H - h) / 2);
    this.layer.add(panel(this, 110, top, 260, h + (h % 2)));
    this.layer.add(ink(this, WORLD.W / 2, top + 10, `Zwischenstand nach Frage ${st.round}/${st.rounds}`, { color: RED_INK }));
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
      const gain = st.gain?.[id] ?? 0;
      if (gain) {
        const g = ink(this, 356, y, `+${gain}`, { origin: [1, 0], color: GREEN_INK });
        this.layer.add(g);
        g.setAlpha(0);
        this.tweens.add({ targets: g, alpha: 1, duration: 300, delay: 300 + i * 120 });
      }
    });
  }
}

/** Chip-Münze (7 × 7) in Spielerfarbe */
function chipPix(hex: string) {
  const p = new Pix(7, 7);
  p.disc(3.5, 3.5, 3.4, '#2d1b12');
  p.disc(3.5, 3.5, 2.6, hex);
  p.px(2, 2, '#ffffff');
  return p;
}
