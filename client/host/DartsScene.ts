import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { DARTS, DART_SEGMENTS, type DartsDart, type DartsState } from '../../shared/darts';
import { DART_COLORS, DART_TV, dartPix, dartboardPix, paintDartsBar } from '../art/darts';
import { crown } from '../art/objects';
import { bus, getState, playerById } from './store';
import { Countdown, GOLD, LIGHT, RED_INK, background, ensureTex, ink, panel, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const { CX, CY, S } = DART_TV;
const wx = (x: number) => CX + x * S;
const wy = (y: number) => CY + y * S;
const shortName = (id: string, n = 7) => (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, n);

interface Special {
  text: string;
  sub: string;
  color: string;
}

/**
 * Darts an der Strandbar (TV): große Scheibe an der Bambuswand, alle Darts der Runde in Spielerfarben,
 * live mitlaufende Punktetafel rechts, Runde/Zeit links.
 */
export class DartsScene extends Phaser.Scene {
  private latest: GameState | null = null;
  private darts = new Map<number, Phaser.GameObjects.Image>();
  private lastSeq = 0;
  private primed = false;
  private side!: Phaser.GameObjects.Container;
  private sideKey = '';
  private timerTxt!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private intro!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private plate!: Phaser.GameObjects.Rectangle;
  private queue: Special[] = [];
  private bannerUntil = 0;
  private phaseKey = '';
  private countdown = new Countdown();

  constructor() {
    super('darts');
  }

  create() {
    this.darts = new Map();
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

    this.side = this.add.container(0, 0).setDepth(2000);
    this.timerTxt = ink(this, 41, 78, '', { color: RED_INK }).setDepth(2001);
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
      this.countdown.set(st.endsIn);
      this.onPhase(st);
    }
    this.syncDarts(st);
    this.renderIntro(st);
    this.renderSide(st);
    this.renderBoard(st);
  }

  private onPhase(st: DartsState) {
    this.queue = [];
    if (st.sub === 'throw') {
      const final = st.mult > 1;
      this.showBanner(final ? 'FINALE!' : `RUNDE ${st.round}`, final ? 'Alle Punkte zählen DOPPELT!' : `von ${st.rounds} · 3 Darts für alle`, final ? '#ff9a7a' : GOLD, 1600);
    } else if (st.sub === 'tally' && st.tally) {
      const names = st.tally.best.map((id) => shortName(id, 10)).join(' & ');
      const next = st.round + 1 === st.rounds ? '\nGleich: FINALE – doppelte Punkte!' : '';
      this.showBanner(`RUNDE ${st.round} VORBEI`, st.tally.points > 0 ? `Beste Runde: ${names} +${st.tally.points}${next}` : `Keiner hat getroffen …${next}`, GOLD, DARTS.TALLY_MS);
    } else if (st.sub === 'over') {
      const ranked = [...st.players].sort((a, b) => b.total - a.total);
      const tie = ranked.length > 1 && ranked[0].total === ranked[1].total;
      this.showBanner('ENDSTAND', tie ? 'Gleichstand!' : `${shortName(ranked[0].id, 12)} gewinnt mit ${ranked[0].total}!`, GOLD, DARTS.OVER_MS);
    } else this.hideBanner();
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
    const text = d.ring === 'miss' ? 'DANEBEN' : st.mult > 1 && d.points > 0 ? `${d.short} x2` : d.short;
    const t = txt(this, x + 6, y - 16, text, { color: col }).setDepth(1900);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, delay: 500, duration: 700, onComplete: () => t.destroy() });
    if (d.ring === 'bull' || (d.ring === 'triple' && d.seg >= 17)) {
      this.queueSpecial({ text: d.ring === 'bull' ? 'BULLSEYE!' : `TRIPLE ${d.seg}!`, sub: shortName(d.owner, 12), color: col });
    }
    // Alle drei Darts in der Triple 20 = 180!
    const mine = st.darts.filter((x) => x.owner === d.owner);
    if (mine.length === DARTS.DARTS_PER_ROUND && mine.every((x) => x.ring === 'triple' && x.seg === 20)) {
      this.queueSpecial({ text: 'ONE HUNDRED AND EIGHTY!', sub: shortName(d.owner, 12), color: GOLD });
    }
  }

  private queueSpecial(s: Special) {
    if (this.queue.length < 3) this.queue.push(s);
  }

  // ---------------------------------------------------------------- Banner

  private showBanner(text: string, sub: string, color: string, ms: number, y = 104) {
    this.tweens.killTweensOf([this.banner, this.bannerSub, this.plate]);
    this.banner.setY(y).setText(text).setColor(color).setAlpha(1);
    this.bannerSub.setY(y + 20).setText(sub).setAlpha(1);
    const base = text.length > 12 ? 0.67 : 1;
    // dunkle Tafel hinter dem Text, damit er auf der bunten Scheibe lesbar bleibt
    const w = Math.max(this.banner.width * base, this.bannerSub.width) + 16;
    const h = sub ? 38 + this.bannerSub.height : 30;
    this.plate.setPosition(CX, y - 14 + h / 2).setSize(w, h).setVisible(true).setAlpha(1);
    this.plate.setDisplaySize(w, h);
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

  update(time: number) {
    const st = this.st;
    if (!st) return;
    if (this.queue.length && time >= this.bannerUntil && st.sub === 'throw') {
      const s = this.queue.shift()!;
      this.showBanner(s.text, s.sub, s.color, 1200, 50);
    }
    if (st.sub === 'throw' || st.sub === 'intro') {
      const sec = this.countdown.seconds;
      this.timerTxt.setText(st.sub === 'throw' && !this.countdown.none ? `${sec} s` : '');
    } else this.timerTxt.setText('');
  }

  // ---------------------------------------------------------------- Intro, Rundenanzeige, Punktetafel

  private renderIntro(st: DartsState) {
    const want = st.sub === 'intro';
    if (want === this.intro.visible && this.intro.length) return;
    this.intro.removeAll(true).setVisible(want);
    if (!want) return;
    this.intro.add(panel(this, 70, 58, 340, 150));
    this.intro.add(ink(this, 240, 70, 'DARTS AN DER STRANDBAR', { size: 16, color: RED_INK }));
    this.intro.add(
      ink(
        this,
        240,
        96,
        `Alle werfen GLEICHZEITIG – ${DARTS.ROUNDS} Runden,\nje ${DARTS.DARTS_PER_ROUND} Darts. Höchste Punktzahl gewinnt!\n\nAm Handy zielen, ruhig halten,\ndann werfen (schnippen oder wischen).\nDoppel x2 · Triple x3 · Bull 50\n\nLetzte Runde: alles zählt DOPPELT!`,
      ),
    );
  }

  private renderSide(st: DartsState) {
    const waiting = st.players.filter((p) => p.thrown < DARTS.DARTS_PER_ROUND).length;
    const key = JSON.stringify([st.sub, st.round, st.mult, st.sub === 'throw' ? waiting : -1]);
    if (key === this.sideKey) return;
    this.sideKey = key;
    this.side.removeAll(true);
    if (st.sub === 'intro') return;
    const final = st.mult > 1;
    this.side.add(panel(this, 3, 30, 76, final ? 86 : 74));
    this.side.add(ink(this, 41, 38, 'RUNDE'));
    this.side.add(ink(this, 41, 52, `${Math.max(1, st.round)}/${st.rounds}`, { size: 16, color: RED_INK }));
    // Zeit steht in this.timerTxt (y 78)
    if (st.sub === 'throw') this.side.add(ink(this, 41, 89, waiting ? `${waiting} ${waiting === 1 ? 'wirft' : 'werfen'}` : 'fertig!'));
    else if (st.sub === 'tally') this.side.add(ink(this, 41, 89, 'Wertung'));
    else this.side.add(ink(this, 41, 89, 'Ende'));
    if (final) this.side.add(ink(this, 41, 100, 'FINALE x2', { color: RED_INK }));
  }

  private renderBoard(st: DartsState) {
    const key = JSON.stringify([st.sub, st.players.map((p) => [p.total, p.round, p.thrown])]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (st.sub === 'intro') return;
    const rows = [...st.players].sort((a, b) => b.total - a.total);
    const w = 159;
    const x0 = WORLD.W - w - 3;
    const rowH = st.players.length > 9 ? 13 : 15;
    const top = 30;
    const h = 22 + rows.length * rowH;
    this.board.add(panel(this, x0, top, w, h));
    this.board.add(ink(this, x0 + 8, top + 7, 'PUNKTE', { origin: [0, 0], color: RED_INK }));
    this.board.add(ink(this, x0 + 122, top + 7, 'Rd.', { origin: [1, 0] }));
    this.board.add(ink(this, x0 + w - 6, top + 7, 'Ges', { origin: [1, 0] }));
    const best = rows[0]?.total ?? 0;
    rows.forEach((p, i) => {
      const y = top + 20 + i * rowH + rowH / 2;
      this.board.add(this.add.circle(x0 + 8, y, 3.5, p.color).setStrokeStyle(1, 0x2d1b12));
      this.board.add(ink(this, x0 + 14, y, shortName(p.id), { origin: [0, 0.5] }));
      // übrige Darts dieser Runde
      if (st.sub === 'throw') {
        for (let k = 0; k < DARTS.DARTS_PER_ROUND; k++) {
          const left = k >= p.thrown;
          this.board.add(this.add.rectangle(x0 + 75 + k * 5, y, 3, 7, left ? p.color : 0xb9a37a).setStrokeStyle(1, left ? 0x2d1b12 : 0xb9a37a));
        }
      }
      const rd = st.sub === 'over' ? '' : `+${p.round}`;
      this.board.add(ink(this, x0 + 122, y, rd, { origin: [1, 0.5], color: p.round >= 100 ? RED_INK : undefined }));
      this.board.add(ink(this, x0 + w - 6, y, String(p.total), { origin: [1, 0.5], color: RED_INK }));
      if (st.sub === 'over' && p.total === best && best > 0) this.board.add(this.add.image(x0 + 8, y - 3, ensureTex(this, 'crown', crown)).setOrigin(0.5, 1));
    });
  }
}
