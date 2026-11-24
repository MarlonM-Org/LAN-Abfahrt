import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import {
  DARTS,
  DART_SEGMENTS,
  type DartsDart,
  type DartsPlayer,
  type DartsState,
  dartsCalm,
  dartsCheckoutText,
  dartsCross,
  dartsDone,
  dartsLeft,
  dartsPhase,
  dartsRank,
} from '../../shared/darts';
import { DART_COLORS, DART_TV, dartPix, dartboardPix, paintDartsBar } from '../art/darts';
import { crown } from '../art/objects';
import { serverNow } from '../timesync';
import { bus, getState, playerById } from './store';
import { GOLD, LIGHT, RED_INK, background, ensureTex, ink, panel, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say } from './speech';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const { CX, CY, S } = DART_TV;
const wx = (x: number) => CX + x * S;
const wy = (y: number) => CY + y * S;
const shortName = (id: string, n = 7) => (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, n);
const BAD = '#ff7a5e';
/** Checkout-Weg auf der Tafel */
const HINT = '#2f7a3f';

interface Special {
  text: string;
  sub: string;
  color: string;
}

/** Live-Fadenkreuz eines Spielers: Zielpunkt (gleitet zum gemeldeten), Atem-Amplitude ab `ampAt` */
interface AimView {
  x: number;
  y: number;
  tx: number;
  ty: number;
  amp: number;
  ampAt: number;
  on: boolean;
  key: string;
}

/**
 * Darts, 301 Single Out (TV): große Scheibe an der Bambuswand, alle Darts der Runde in Spielerfarben, die
 * Fadenkreuze aller Spieler live (mit demselben Atmen wie am Handy), rechts die Tafel mit Reststand, links die Runde.
 */
export class DartsScene extends Phaser.Scene {
  private latest: GameState | null = null;
  private darts = new Map<number, Phaser.GameObjects.Image>();
  private lastSeq = 0;
  private primed = false;
  private side!: Phaser.GameObjects.Container;
  private sideKey = '';
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private intro!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private plate!: Phaser.GameObjects.Rectangle;
  private cross!: Phaser.GameObjects.Graphics;
  private aims = new Map<string, AimView>();
  private queue: Special[] = [];
  private bannerUntil = 0;
  private phaseKey = '';
  private juice!: Juice;

  constructor() {
    super('darts');
  }

  create() {
    this.darts = new Map();
    this.aims = new Map();
    this.lastSeq = 0;
    this.primed = false;
    this.sideKey = '';
    this.boardKey = '';
    this.queue = [];
    this.bannerUntil = 0;
    this.phaseKey = '';

    background(this, 'darts', WORLD.W, WORLD.H, (p) => paintDartsBar(p, WORLD.W, WORLD.H));
    const boardKey = ensureTex(this, 'darts_board', () => dartboardPix());
    this.add.image(CX, CY, boardKey).setDepth(1);
    // Zahlen im schwarzen Ring
    const numR = (DARTS.DOUBLE_OUT * S + DART_TV.NUM_R) / 2;
    DART_SEGMENTS.forEach((n, i) => {
      const a = (i * 18 * Math.PI) / 180;
      txt(this, Math.round(CX + Math.sin(a) * numR), Math.round(CY - Math.cos(a) * numR), String(n), { color: DART_COLORS.numbers, shadow: false })
        .setOrigin(0.5, 0.5)
        .setDepth(2);
    });

    this.cross = this.add.graphics().setDepth(1500);
    this.juice = new Juice(this, { depth: 1950 });
    this.side = this.add.container(0, 0).setDepth(2000);
    this.board = this.add.container(0, 0).setDepth(2000);
    this.intro = this.add.container(0, 0).setDepth(2005);
    this.plate = this.add.rectangle(CX, 104, 10, 10, 0x2d1b12, 0.8).setStrokeStyle(2, 0xffd25e, 0.9).setDepth(2009).setVisible(false);
    this.banner = txt(this, CX, 104, '', { size: 24, color: GOLD }).setOrigin(0.5).setDepth(2010);
    this.bannerSub = txt(this, CX, 126, '', { size: 8, color: LIGHT }).setDepth(2010);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private get st(): DartsState | null {
    return this.latest?.mini?.kind === 'darts' ? this.latest.mini.state : null;
  }

  private colorOf(st: DartsState, id: string) {
    return st.players.find((p) => p.id === id)?.color ?? 0xffffff;
  }

  private onState(s: GameState) {
    this.latest = s;
    const st = this.st;
    if (!st) return;
    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.onPhase(st);
    }
    this.syncAims(st);
    this.syncDarts(st);
    this.renderIntro(st);
    this.renderSide(st);
    this.renderBoard(st);
  }

  private names(ids: string[], n = 10) {
    return ids.map((id) => shortName(id, n)).join(' & ');
  }

  private onPhase(st: DartsState) {
    this.queue = [];
    if (st.sub === 'throw') {
      const last = st.round >= st.rounds;
      this.showBanner(last ? 'LETZTE RUNDE!' : `RUNDE ${st.round}`, last ? 'Danach gewinnt der niedrigste Rest' : `von ${st.rounds} · 3 Darts für alle`, last ? '#ff9a7a' : GOLD, 1600);
    } else if (st.sub === 'tally' && st.tally) {
      const t = st.tally;
      const lines = [`Vorne: ${this.names(t.lead)} – Rest ${t.rest}`];
      if (t.busts.length) lines.push(`Überworfen: ${this.names(t.busts, 8)}`);
      if (st.round + 1 === st.rounds) lines.push('Gleich: LETZTE RUNDE!');
      this.showBanner(`RUNDE ${st.round} VORBEI`, lines.join('\n'), GOLD, DARTS.TALLY_MS);
    } else if (st.sub === 'over') {
      const outs = st.players.filter((p) => p.out > 0);
      const win = this.names(st.winners, 12);
      const many = st.winners.length > 1;
      if (outs.length) {
        const sub = many ? `${win} checken gleichzeitig aus!` : outs.length > 1 ? `${win} gewinnt – weniger Darts!` : `${win} gewinnt!`;
        this.showBanner('CHECKOUT!', sub, GOLD, DARTS.OVER_MS);
        sfx('fanfare');
        this.juice.burst(CX, 70, 'confetti', 40);
      } else {
        const rest = st.players.find((p) => p.id === st.winners[0])?.rest ?? st.start;
        this.showBanner('ENDSTAND', `Nach ${st.rounds} Runden: ${win} (Rest ${rest})`, GOLD, DARTS.OVER_MS);
      }
      say(many ? 'Gleichstand!' : `${shortName(st.winners[0], 20)} gewinnt!`);
    } else this.hideBanner();
  }

  // ---------------------------------------------------------------- Fadenkreuze

  private syncAims(st: DartsState) {
    const now = performance.now();
    const live = new Set<string>();
    if (st.sub === 'throw') {
      for (const p of st.players) {
        if (!p.aim || dartsDone(p)) continue;
        live.add(p.id);
        const key = `${p.aim.x}|${p.aim.y}|${p.aim.amp}|${p.aim.on}`;
        const a = this.aims.get(p.id);
        if (!a) this.aims.set(p.id, { x: p.aim.x, y: p.aim.y, tx: p.aim.x, ty: p.aim.y, amp: p.aim.amp, ampAt: now, on: p.aim.on, key });
        else if (a.key !== key) Object.assign(a, { tx: p.aim.x, ty: p.aim.y, amp: p.aim.amp, ampAt: now, on: p.aim.on, key });
      }
    }
    for (const id of [...this.aims.keys()]) if (!live.has(id)) this.aims.delete(id);
  }

  private drawAims(st: DartsState, delta: number) {
    const g = this.cross;
    g.clear();
    if (st.sub !== 'throw' || !this.aims.size) return;
    const t = serverNow() - st.t0;
    const now = performance.now();
    const k = 1 - Math.exp(-delta / 55); // gleitet den gemeldeten Positionen nach (Handy sendet ~14×/s)
    // Wer gerade zielt (Finger drauf / Sensor), liegt obenauf
    const list = [...this.aims.entries()].sort((a, b) => Number(a[1].on) - Number(b[1].on));
    for (const [id, a] of list) {
      a.x += (a.tx - a.x) * k;
      a.y += (a.ty - a.y) * k;
      const c = dartsCross({ x: a.x, y: a.y }, t, dartsCalm(a.amp, now - a.ampAt), dartsPhase(id, st.round));
      const x = Math.round(wx(c.x));
      const y = Math.round(wy(c.y));
      const R = a.on ? 6 : 5;
      const alpha = a.on ? 1 : 0.55;
      for (const [col, w] of [[0x2d1b12, 3], [this.colorOf(st, id), 1]] as [number, number][]) {
        g.fillStyle(col, alpha);
        const o = (w - 1) / 2;
        g.fillRect(x - R - o, y - o, R - 2 + w - 1, w); // links
        g.fillRect(x + 3 - o, y - o, R - 2 + w - 1, w); // rechts
        g.fillRect(x - o, y - R - o, w, R - 2 + w - 1); // oben
        g.fillRect(x - o, y + 3 - o, w, R - 2 + w - 1); // unten
        g.lineStyle(w, col, alpha);
        g.strokeCircle(x + 0.5, y + 0.5, 3);
      }
    }
  }

  // ---------------------------------------------------------------- Darts

  private syncDarts(st: DartsState) {
    const live = new Set(st.darts.map((d) => d.seq));
    for (const [seq, img] of this.darts) {
      if (!live.has(seq)) {
        img.destroy();
        this.darts.delete(seq);
      }
    }
    for (const d of st.darts) {
      if (this.darts.has(d.seq)) continue;
      const col = hex(this.colorOf(st, d.owner));
      const img = this.add.image(wx(d.x), wy(d.y), ensureTex(this, `darts_dart_${col}`, () => dartPix(col))).setOrigin(0.5 / 11, 10.5 / 11);
      img.setDepth(100 + wy(d.y));
      this.darts.set(d.seq, img);
      if (this.primed && d.seq > this.lastSeq) this.flyIn(st, d, img);
    }
    this.lastSeq = Math.max(this.lastSeq, ...st.darts.map((d) => d.seq));
    this.primed = true;
  }

  private flyIn(st: DartsState, d: DartsDart, img: Phaser.GameObjects.Image) {
    const tx = wx(d.x);
    const ty = wy(d.y);
    img.setPosition(tx + 40 + (d.n - 1) * 20, WORLD.H + 20).setScale(3).setAlpha(0.9);
    sfx('throw', { x: tx, pitch: 1.3, vol: 0.6 });
    this.tweens.add({
      targets: img,
      x: tx,
      y: ty,
      scale: 1,
      alpha: 1,
      duration: 260,
      ease: 'Quad.In',
      onComplete: () => {
        // Einschlag: kurzes Zittern + Punkte
        this.tweens.add({ targets: img, x: tx + 1, duration: 40, yoyo: true, repeat: 2 });
        this.popLabel(st, d, tx, ty);
      },
    });
  }

  private popLabel(st: DartsState, d: DartsDart, x: number, y: number) {
    const col = hex(this.colorOf(st, d.owner));
    const text = d.bust ? 'ÜBERWORFEN' : d.out ? 'CHECKOUT' : d.ring === 'miss' ? 'DANEBEN' : d.short;
    const t = txt(this, x + 6, y - 16, text, { color: d.bust ? BAD : col }).setDepth(1900);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, delay: d.bust || d.out ? 900 : 500, duration: 700, onComplete: () => t.destroy() });
    const who = shortName(d.owner, 12);
    if (d.out) {
      // Genau auf 0 – Single Out: jedes Feld beendet
      this.queueSpecial({ text: 'CHECKOUT!', sub: `${who} · ${d.label}`, color: GOLD }, true);
      sfx('cheer');
      say(`${shortName(d.owner, 20)} checkt aus!`, { interrupt: true });
      this.juice.burst(x, y, 'confetti', 24);
      this.juice.shake(1);
      return;
    }
    if (d.bust) {
      // Unter 0: Aufnahme zählt nicht, Rest wie vorher
      this.queueSpecial({ text: 'ÜBERWORFEN!', sub: `${who} bleibt bei ${d.rest}`, color: BAD }, true);
      sfx('lose', { x, vol: 0.8 });
      say('Überworfen!');
      this.juice.shake(1);
      return;
    }
    sfx(d.ring === 'miss' ? 'bonk' : 'hit', { x, pitch: d.ring === 'miss' ? 0.7 : 1.3, vol: 0.7 });
    if (d.ring === 'bull') (sfx('goal'), say('Bullseye!'));
    else if (d.ring === 'triple' && d.seg >= 17) (sfx('coin'), say(`Triple ${d.seg}!`));
    if (d.ring === 'bull' || (d.ring === 'triple' && d.seg >= 17)) {
      this.queueSpecial({ text: d.ring === 'bull' ? 'BULLSEYE!' : `TRIPLE ${d.seg}!`, sub: who, color: col });
    }
    // Alle drei Darts in der Triple 20 = 180!
    const mine = st.darts.filter((x) => x.owner === d.owner);
    if (mine.length === DARTS.DARTS_PER_ROUND && mine.every((x) => x.ring === 'triple' && x.seg === 20)) {
      this.queueSpecial({ text: 'ONE HUNDRED AND EIGHTY!', sub: who, color: GOLD }, true);
      sfx('cheer');
      say('One hundred and eighty!', { interrupt: true, rate: 0.9 });
    }
  }

  /** Banner-Warteschlange; Checkout/Überworfen kommen vor die Treffer-Ansagen */
  private queueSpecial(s: Special, urgent = false) {
    if (urgent) {
      this.queue.unshift(s);
      this.queue.length = Math.min(this.queue.length, 4);
    } else if (this.queue.length < 3) this.queue.push(s);
  }

  // ---------------------------------------------------------------- Banner

  /**
   * Banner mit dunkler Tafel. `small` = Treffer-Ansagen während der Runde: klein ganz oben über der Scheibe,
   * damit sie die Fadenkreuze (meist auf T20) nicht verdecken.
   */
  private showBanner(text: string, sub: string, color: string, ms: number, small = false) {
    this.tweens.killTweensOf([this.banner, this.bannerSub, this.plate]);
    const base = small ? (text.length > 12 ? 0.5 : 0.67) : text.length > 12 ? 0.67 : 1;
    const y = small ? 12 : 104;
    this.banner.setY(y).setText(text).setColor(color).setAlpha(1);
    this.bannerSub.setY(y + (small ? 9 : 20)).setText(sub).setAlpha(1);
    // dunkle Tafel hinter dem Text, damit er auf der bunten Scheibe lesbar bleibt
    const w = Math.max(this.banner.width * base, this.bannerSub.width) + 16;
    const top = y - 12 * base - 4;
    const bottom = sub ? this.bannerSub.y + this.bannerSub.height + 3 : y + 12 * base + 4;
    this.plate.setPosition(CX, (top + bottom) / 2).setSize(w, bottom - top).setVisible(true).setAlpha(1);
    this.plate.setDisplaySize(w, bottom - top);
    this.banner.setScale(base * 0.3);
    this.tweens.add({ targets: this.banner, scale: base, duration: 340, ease: 'Back.Out' });
    this.tweens.add({ targets: [this.banner, this.bannerSub, this.plate], alpha: 0, delay: Math.max(400, ms - 300), duration: 300 });
    this.bannerUntil = this.time.now + ms;
  }

  private hideBanner() {
    this.tweens.killTweensOf([this.banner, this.bannerSub, this.plate]);
    this.plate.setVisible(false);
    this.banner.setText('');
    this.bannerSub.setText('');
  }

  update(time: number, delta: number) {
    const st = this.st;
    if (!st) return;
    if (this.queue.length && time >= this.bannerUntil && st.sub === 'throw') {
      const s = this.queue.shift()!;
      this.showBanner(s.text, s.sub, s.color, 1300, true);
    }
    this.drawAims(st, delta);
  }

  // ---------------------------------------------------------------- Intro, Rundenanzeige, Tafel

  private renderIntro(st: DartsState) {
    const want = st.sub === 'intro';
    if (want === this.intro.visible && this.intro.length) return;
    this.intro.removeAll(true).setVisible(want);
    if (!want) return;
    this.intro.add(panel(this, 66, 54, 348, 160));
    this.intro.add(ink(this, 240, 66, `DARTS · ${st.start} SINGLE OUT`, { size: 16, color: RED_INK }));
    this.intro.add(
      ink(
        this,
        240,
        92,
        `Jeder startet bei ${st.start} – wer zuerst GENAU\nauf 0 kommt, gewinnt. Alle werfen GLEICHZEITIG,\n${DARTS.DARTS_PER_ROUND} Darts pro Runde, höchstens ${st.rounds} Runden.\n\nHandy: Finger halten + ziehen = zielen,\nloslassen = werfen (oder Sensor + tippen).\nDas Fadenkreuz atmet – den Moment abpassen!\n\nUnter 0 = ÜBERWORFEN: Runde zählt nicht.`,
      ),
    );
  }

  private renderSide(st: DartsState) {
    const waiting = st.players.filter((p) => !dartsDone(p)).length;
    const key = JSON.stringify([st.sub, st.round, st.sub === 'throw' ? waiting : -1]);
    if (key === this.sideKey) return;
    this.sideKey = key;
    this.side.removeAll(true);
    if (st.sub === 'intro') return;
    const last = st.round >= st.rounds;
    this.side.add(panel(this, 3, 30, 76, last ? 92 : 80));
    this.side.add(ink(this, 41, 37, 'RUNDE'));
    this.side.add(ink(this, 41, 47, String(Math.max(1, st.round)), { size: 24, color: RED_INK }));
    this.side.add(ink(this, 41, 74, `von ${st.rounds}`));
    if (st.sub === 'throw') this.side.add(ink(this, 41, 92, waiting ? `${waiting} dran` : 'fertig!'));
    else if (st.sub === 'tally') this.side.add(ink(this, 41, 92, 'Wertung'));
    else this.side.add(ink(this, 41, 92, 'Ende'));
    if (last) this.side.add(ink(this, 41, 105, 'LETZTE!', { color: RED_INK }));
  }

  /** Zweite Zeile der Tafel: ausgecheckt/überworfen, sonst der Checkout-Weg („Aus: 20·17“) oder die Punkte dieser Runde */
  private statusOf(st: DartsState, p: DartsPlayer): { text: string; color?: string } {
    if (p.out) return { text: st.sub === 'over' ? `${p.out} Darts` : 'CHECKOUT!', color: RED_INK };
    if (p.bust) return { text: 'ÜBERWORFEN', color: RED_INK };
    if (st.sub === 'over') return { text: '' };
    if (p.skipped) return { text: 'verfallen' };
    const left = st.sub === 'throw' ? dartsLeft(p) : DARTS.DARTS_PER_ROUND;
    const co = left ? dartsCheckoutText(p.rest, left) : null;
    if (co) return { text: `Aus: ${co.replace(/ · /g, '·')}`.slice(0, 11), color: HINT };
    return { text: p.thrown > 0 ? `-${p.scored}` : '' };
  }

  private renderBoard(st: DartsState) {
    const key = JSON.stringify([st.sub, st.round, st.players.map((p) => [p.rest, p.scored, p.thrown, p.bust, p.out, p.skipped]), st.winners]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (st.sub === 'intro') return;
    const rows = [...st.players].sort(dartsRank);
    const compact = rows.length > 8;
    const w = 159;
    const x0 = WORLD.W - w - 3;
    const rowH = compact ? 17 : 25;
    const top = compact ? 24 : 30;
    const h = 22 + rows.length * rowH;
    this.board.add(panel(this, x0, top, w, h));
    this.board.add(ink(this, x0 + 8, top + 7, 'SINGLE OUT', { origin: [0, 0], color: RED_INK }));
    this.board.add(ink(this, x0 + w - 6, top + 7, 'REST', { origin: [1, 0] }));
    rows.forEach((p, i) => {
      const y = Math.round(top + 20 + i * rowH + rowH / 2);
      const y1 = compact ? y : y - 5;
      const status = this.statusOf(st, p);
      this.board.add(this.add.circle(x0 + 8, y1, 3.5, p.color).setStrokeStyle(1, 0x2d1b12));
      this.board.add(ink(this, x0 + 14, y1, shortName(p.id, compact ? 6 : 7), { origin: [0, 0.5], color: p.bust ? RED_INK : undefined }));
      // übrige Darts dieser Runde
      const pips = st.sub === 'throw' && !dartsDone(p);
      const px = x0 + (compact ? 66 : 76);
      if (pips) {
        for (let k = 0; k < DARTS.DARTS_PER_ROUND; k++) {
          const left = k >= p.thrown;
          this.board.add(this.add.rectangle(px + 2 + k * 5, y1, 3, 7, left ? p.color : 0xb9a37a).setStrokeStyle(1, left ? 0x2d1b12 : 0xb9a37a));
        }
      }
      if (compact) {
        // eine Zeile: Status kurz statt der Pfeile, sobald fertig
        const short = p.out ? 'AUS' : p.bust ? 'ÜBER' : !pips && (st.sub === 'throw' || st.sub === 'tally') && p.thrown > 0 ? `-${p.scored}` : '';
        if (short) this.board.add(ink(this, px, y, short, { origin: [0, 0.5], color: p.out || p.bust ? RED_INK : undefined }));
      } else if (status.text) this.board.add(ink(this, x0 + 14, y + 6, status.text, { origin: [0, 0.5], color: status.color }));
      this.board.add(txt(this, x0 + w - 6, y + 1, String(p.rest), { size: 16, color: RED_INK, origin: [1, 0.5], shadow: false }));
      if (st.sub === 'over' && st.winners.includes(p.id)) this.board.add(this.add.image(x0 + 8, y1 - 3, ensureTex(this, 'crown', crown)).setOrigin(0.5, 1));
    });
  }
}
