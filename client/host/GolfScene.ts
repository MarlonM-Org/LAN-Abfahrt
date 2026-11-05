import Phaser from 'phaser';
import type { GameState, GolfState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { GOLF, GOLF_HOLES, moverAt, spinnerBlades } from '../../shared/golf';
import { flagPix, flamingoBumperPix, golfBallPix, lighthouseTopPix, paintGolfHole, surfboardPix } from '../art/golf';
import { crown } from '../art/objects';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { Countdown, GOLD, INK, LIGHT, RED_INK, ensureTex, ink, panel, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const MAX_P = 12;

/**
 * Urlaubs-Minigolf (TV): Loch von oben, alle Bälle gleichzeitig. Der Server simuliert in Echtzeit und
 * schickt nur Ballpositionen; Leuchtturm-Flügel und Surfbrett rechnet die Szene aus der Lochzeit `t` aus.
 */
export class GolfScene extends Phaser.Scene {
  private latest: GolfState | null = null;
  private recvAt = 0;
  private bg!: Phaser.GameObjects.Image;
  private g!: Phaser.GameObjects.Graphics;
  private balls: Phaser.GameObjects.Image[] = [];
  private shown: { x: number; y: number }[] = [];
  private flag!: Phaser.GameObjects.Image;
  private bumpers: Phaser.GameObjects.Image[] = [];
  private hubs: Phaser.GameObjects.Image[] = [];
  private boards: Phaser.GameObjects.Image[] = [];
  private hud!: Phaser.GameObjects.Container;
  private chips!: Phaser.GameObjects.Container;
  private card!: Phaser.GameObjects.Container;
  private intro!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private timerTxt!: Phaser.GameObjects.Text;
  private clock = new Countdown();
  private holeShown = -1;
  private teeShown = -1;
  private lastFx = 0;
  private hudKey = '';
  private chipKey = '';
  private cardKey = '';

  constructor() {
    super('golf');
  }

  create() {
    this.latest = null;
    this.balls = [];
    this.shown = [];
    this.bumpers = [];
    this.hubs = [];
    this.boards = [];
    this.holeShown = -1;
    this.teeShown = -1;
    this.lastFx = 0;
    this.hudKey = '';
    this.chipKey = '';
    this.cardKey = '';

    this.bg = this.add.image(0, 0, this.holeTex(0)).setOrigin(0, 0).setDepth(-1000);
    this.g = this.add.graphics().setDepth(300);
    this.flag = this.add.image(0, 0, ensureTex(this, 'golf_flag0', () => flagPix(0))).setOrigin(0.2, 1).setDepth(450);
    ensureTex(this, 'golf_flag1', () => flagPix(1));
    for (let i = 0; i < MAX_P; i++) {
      this.balls.push(this.add.image(-20, -20, ensureTex(this, 'golf_ball_ffffff', () => golfBallPix('#ffffff'))).setDepth(500).setVisible(false));
      this.shown.push({ x: -20, y: -20 });
    }
    this.hud = this.add.container(0, 0).setDepth(2000);
    this.chips = this.add.container(0, 0).setDepth(2000);
    this.timerTxt = txt(this, WORLD.W - 30, 10, '', { size: 8, color: LIGHT }).setDepth(2001);
    this.card = this.add.container(0, 0).setDepth(2100);
    this.intro = this.add.container(0, 0).setDepth(2100);
    this.banner = txt(this, 240, 110, '', { size: 24, color: GOLD }).setOrigin(0.5).setDepth(2200);
    this.bannerSub = txt(this, 240, 134, '', { size: 8, color: LIGHT }).setDepth(2200);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private holeTex(i: number) {
    return ensureTex(this, `bg_golf_${i}`, () => {
      const p = new Pix(WORLD.W, WORLD.H);
      paintGolfHole(p, GOLF_HOLES[i], i, WORLD.W, WORLD.H);
      return p;
    });
  }

  /** Lochzeit (s), zwischen zwei Zuständen lokal weitergezählt */
  private get holeT() {
    const st = this.latest;
    if (!st) return 0;
    const extra = st.sub === 'play' ? Math.min(GOLF.HOLE_S, (performance.now() - this.recvAt) / 1000) : 0;
    return st.t + extra;
  }

  private onState(s: GameState) {
    const st = s.mini?.kind === 'golf' ? s.mini.state : null;
    if (!st) return;
    if (!this.latest || this.latest.t !== st.t || this.latest.sub !== st.sub) this.recvAt = performance.now();
    this.latest = st;
    this.clock.set(st.endsIn);
    if (st.hole !== this.holeShown && st.sub !== 'intro') this.setupHole(st.hole);
    if (st.sub === 'tee' && this.teeShown !== st.hole) {
      this.teeShown = st.hole;
      const h = GOLF_HOLES[st.hole];
      this.showBanner(`LOCH ${st.hole + 1}`, `${h.name} · Par ${h.par}`, GOLD, 2600);
    }
    for (const f of st.fx) {
      if (f.seq <= this.lastFx) continue;
      this.lastFx = f.seq;
      this.playFx(st, f);
    }
    if (st.fx.length) this.lastFx = Math.max(this.lastFx, st.fx[st.fx.length - 1].seq);
    this.renderIntro(st);
    this.renderHud(st);
    this.renderChips(st);
    this.renderCard(st);
  }

  private setupHole(i: number) {
    this.holeShown = i;
    const h = GOLF_HOLES[i];
    this.bg.setTexture(this.holeTex(i));
    for (const o of [...this.bumpers, ...this.hubs, ...this.boards]) o.destroy();
    this.bumpers = h.bumpers.map((b) => this.add.image(b.x, b.y, ensureTex(this, `golf_flam_${b.r}`, () => flamingoBumperPix(b.r))).setDepth(400));
    this.hubs = h.spinners.map((s) => this.add.image(s.x, s.y, ensureTex(this, `golf_lh_${s.hub}`, () => lighthouseTopPix(s.hub))).setDepth(420));
    this.boards = h.movers.map((m) => {
      const img = this.add.image(m.x, m.y, ensureTex(this, `golf_surf_${m.len}_${m.thick}`, () => surfboardPix(m.len, m.thick))).setDepth(410);
      if (!m.vertical) img.setAngle(90);
      return img;
    });
    this.flag.setPosition(h.cup.x, h.cup.y + 1);
    this.lastFx = 0;
    for (let k = 0; k < MAX_P; k++) this.shown[k] = { x: h.tee.x, y: h.tee.y };
  }

  // ---------------------------------------------------------------- Zeichnen

  update(time: number) {
    const st = this.latest;
    if (!st) return;
    const g = this.g;
    g.clear();
    this.timerTxt.setText(st.sub === 'play' ? `0:${String(Math.min(59, this.clock.seconds)).padStart(2, '0')}` : '').setColor(this.clock.seconds <= 10 ? '#ff9a7a' : LIGHT);
    if (st.sub === 'intro') {
      this.balls.forEach((b) => b.setVisible(false));
      return;
    }
    const h = GOLF_HOLES[st.hole];
    const t = this.holeT;
    this.flag.setTexture(Math.floor(time / 380) % 2 ? 'golf_flag1' : 'golf_flag0');

    // Leuchtturm-Flügel
    for (const sp of h.spinners) {
      for (const bl of spinnerBlades(sp, t)) {
        g.lineStyle(5, 0x2d1b12, 1).lineBetween(bl[0], bl[1], bl[2], bl[3]);
        g.lineStyle(3, 0xf4efe2, 1).lineBetween(bl[0], bl[1], bl[2], bl[3]);
        const mx = bl[0] + (bl[2] - bl[0]) * 0.55;
        const my = bl[1] + (bl[3] - bl[1]) * 0.55;
        g.lineStyle(3, 0xe0503f, 1).lineBetween(mx, my, bl[2], bl[3]);
      }
    }
    h.movers.forEach((m, i) => {
      const p = moverAt(m, t);
      this.boards[i]?.setPosition(p.x, p.y);
    });

    // Bälle: weich zur Serverposition gleiten; liegende Bälle am selben Fleck leicht auffächern
    const ids = st.order;
    const groups = new Map<string, number[]>();
    ids.forEach((id, k) => {
      const b = st.balls[id];
      if (!b || b.m || b.d) return;
      const key = `${Math.round(b.x / 5)}|${Math.round(b.y / 5)}`;
      groups.set(key, [...(groups.get(key) ?? []), k]);
    });
    const fan: Record<number, { dx: number; dy: number }> = {};
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const rad = 3 + list.length * 0.7;
      list.forEach((k, j) => {
        const a = (j / list.length) * Math.PI * 2 - Math.PI / 2;
        fan[k] = { dx: Math.cos(a) * rad, dy: Math.sin(a) * rad };
      });
    }
    for (let k = 0; k < MAX_P; k++) {
      const img = this.balls[k];
      const id = ids[k];
      const b = id ? st.balls[id] : undefined;
      if (!b || b.d === 1 || b.tube || st.sub === 'card' || st.sub === 'over') {
        img.setVisible(false);
        if (b) this.shown[k] = { x: b.x, y: b.y };
        continue;
      }
      const tx = b.x + (fan[k]?.dx ?? 0);
      const ty = b.y + (fan[k]?.dy ?? 0);
      const cur = this.shown[k];
      const jump = Math.hypot(tx - cur.x, ty - cur.y) > 60;
      cur.x = jump ? tx : cur.x + (tx - cur.x) * 0.45;
      cur.y = jump ? ty : cur.y + (ty - cur.y) * 0.45;
      const col = hex(st.colors[id] ?? 0xffffff);
      img.setTexture(ensureTex(this, `golf_ball_${col}`, () => golfBallPix(col)));
      img.setVisible(true).setPosition(Math.round(cur.x), Math.round(cur.y)).setAlpha(b.d === 2 ? 0.5 : 1);
      g.fillStyle(0x1d1410, 0.3).fillEllipse(Math.round(cur.x) + 1, Math.round(cur.y) + 3, 6, 2);
      // Zielhilfe: gepunktete Linie in Spielerfarbe
      if (b.aim && !b.m && !b.d && st.sub === 'play') {
        const [a, pw] = b.aim;
        const len = 10 + pw * 70;
        this.dotted(cur.x, cur.y, a, len, st.colors[id] ?? 0xffffff, time);
      }
    }
  }

  private dotted(x: number, y: number, a: number, len: number, color: number, time: number) {
    const g = this.g;
    const off = (time / 60) % 4;
    for (let d = 5 + off; d < len; d += 4) {
      const px = Math.round(x + Math.cos(a) * d);
      const py = Math.round(y + Math.sin(a) * d);
      g.fillStyle(0x1d1410, 0.8).fillRect(px, py + 1, 2, 2);
      g.fillStyle(color, 1).fillRect(px, py, 2, 2);
    }
    const ex = x + Math.cos(a) * (len + 2);
    const ey = y + Math.sin(a) * (len + 2);
    g.lineStyle(1, color, 1).strokeCircle(ex, ey, 2.5);
  }

  // ---------------------------------------------------------------- Effekte

  private playFx(st: GolfState, f: GolfState['fx'][number]) {
    const name = playerById(f.id)?.name ?? '';
    const col = hex(st.colors[f.id] ?? 0xffffff);
    if (f.k === 'ace') {
      this.showBanner('HOLE-IN-ONE!', name, GOLD, 2600);
      this.sparkle(f.x, f.y, 18);
    } else if (f.k === 'hole') {
      this.floatText(f.x, f.y - 14, `${name.replace(/^Bot\s+/, '').slice(0, 8)}: ${f.n}`, col);
      this.sparkle(f.x, f.y, 8);
    } else if (f.k === 'water') {
      this.splash(f.x, f.y);
      this.floatText(f.x, f.y - 12, 'PLATSCH! +1', '#8fd8ff');
    } else if (f.k === 'tube') {
      this.floatText(f.x, f.y - 14, 'WUSCH!', '#ffd25e');
    } else if (f.k === 'lip') {
      this.floatText(f.x, f.y - 12, 'Lippe!', LIGHT);
    } else if (f.k === 'cap') {
      this.floatText(f.x, f.y - 12, `MAX ${f.n ?? GOLF.MAX_SCORE}`, '#ff9a7a');
    } else if (f.k === 'bump') {
      const h = GOLF_HOLES[st.hole];
      let best = -1;
      let bd = Infinity;
      h.bumpers.forEach((b, i) => {
        const d = Math.hypot(b.x - f.x, b.y - f.y);
        if (d < bd) (bd = d), (best = i);
      });
      const img = this.bumpers[best];
      if (img && bd < 20) {
        this.tweens.killTweensOf(img);
        img.setScale(1);
        this.tweens.add({ targets: img, scale: 1.25, duration: 90, yoyo: true, ease: 'Quad.Out' });
      }
    }
  }

  private floatText(x: number, y: number, s: string, color: string) {
    const t = txt(this, Math.max(40, Math.min(440, x)), y, s, { color }).setDepth(1800);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, delay: 700, duration: 700, onComplete: () => t.destroy() });
  }

  private sparkle(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.add.rectangle(x, y, 2, 2, i % 2 ? 0xffd25e : 0xfff4d6).setDepth(1700);
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 14;
      this.tweens.add({ targets: c, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d - 4, alpha: 0, duration: 500 + Math.random() * 300, onComplete: () => c.destroy() });
    }
  }

  private splash(x: number, y: number) {
    for (let i = 0; i < 9; i++) {
      const c = this.add.circle(x, y, 1.5 + Math.random(), i % 2 ? 0xeaf8ff : 0x93d3f3).setDepth(1700);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      this.tweens.add({ targets: c, x: x + Math.cos(a) * 12, y: y + Math.sin(a) * 12, alpha: 0, duration: 500, ease: 'Quad.Out', onComplete: () => c.destroy() });
    }
    const ring = this.add.circle(x, y, 3).setStrokeStyle(1, 0xeaf8ff).setDepth(1700);
    this.tweens.add({ targets: ring, scale: 3, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
  }

  private showBanner(text: string, sub: string, color: string, ms: number) {
    this.tweens.killTweensOf([this.banner, this.bannerSub]);
    this.banner.setText(text).setColor(color).setAlpha(1);
    this.bannerSub.setText(sub).setAlpha(1);
    const base = text.length > 10 ? 0.75 : 1;
    this.banner.setScale(base * 0.3);
    this.tweens.add({ targets: this.banner, scale: base, duration: 380, ease: 'Back.Out' });
    this.tweens.add({ targets: [this.banner, this.bannerSub], alpha: 0, delay: ms, duration: 350 });
  }

  // ---------------------------------------------------------------- HUD, Spieler, Karte

  private renderIntro(st: GolfState) {
    const want = st.sub === 'intro';
    if (want === this.intro.visible && this.intro.length) return;
    this.intro.removeAll(true).setVisible(want);
    if (!want) return;
    this.bg.setTexture(this.holeTex(0));
    this.intro.add(panel(this, 70, 58, 340, 150));
    this.intro.add(ink(this, 240, 70, 'URLAUBS-MINIGOLF', { size: 16, color: RED_INK }));
    this.intro.add(
      ink(
        this,
        240,
        96,
        `${st.holes} Löcher – alle putten gleichzeitig!\nAm Handy vom Ball zurückziehen\nwie eine Schleuder, loslassen = Schlag.\nWasser = +1 Schlag. Max. ${GOLF.MAX_STROKES} Schläge,\n${GOLF.HOLE_S} Sekunden pro Loch.\nWenigste Schläge gewinnen!`,
      ),
    );
  }

  private renderHud(st: GolfState) {
    const key = JSON.stringify([st.sub, st.hole]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    if (st.sub === 'intro') return;
    const h = GOLF_HOLES[st.hole];
    this.hud.add(panel(this, 3, 3, 214, 22));
    this.hud.add(ink(this, 10, 10, `LOCH ${st.hole + 1}/${st.holes}`, { origin: [0, 0], color: RED_INK }));
    this.hud.add(ink(this, 98, 10, h.name.toUpperCase(), { origin: [0, 0] }));
    this.hud.add(panel(this, 220, 3, 52, 22));
    this.hud.add(ink(this, 246, 10, `PAR ${h.par}`, { color: RED_INK }));
    if (st.sub === 'play') this.hud.add(panel(this, WORLD.W - 57, 3, 54, 22, 'dark'));
  }

  private renderChips(st: GolfState) {
    const key = JSON.stringify([st.sub, st.hole, st.order.map((id) => [st.balls[id]?.s, st.balls[id]?.d])]);
    if (key === this.chipKey) return;
    this.chipKey = key;
    this.chips.removeAll(true);
    if (st.sub === 'intro' || st.sub === 'card' || st.sub === 'over') return;
    const n = st.order.length;
    const cols = Math.min(6, n);
    const rows = Math.ceil(n / cols);
    const w = 78;
    const x0 = (WORLD.W - cols * w) / 2;
    const y0 = rows > 1 ? 244 : 252;
    st.order.forEach((id, i) => {
      const cx = x0 + (i % cols) * w;
      const cy = y0 + Math.floor(i / cols) * 13;
      const b = st.balls[id];
      const bg = this.add.rectangle(cx + 1, cy, w - 2, 12, 0x2d1b12, 0.78).setOrigin(0, 0).setStrokeStyle(1, b?.d === 1 ? 0xffd25e : 0x5e3518);
      this.chips.add(bg);
      this.chips.add(this.add.circle(cx + 8, cy + 6, 3.5, st.colors[id] ?? 0xffffff).setStrokeStyle(1, 0x1d1410));
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 6);
      this.chips.add(txt(this, cx + 14, cy + 2, name, { origin: [0, 0], shadow: false }));
      const s = b?.s ?? 0;
      const col = b?.d === 1 ? GOLD : b?.d === 2 ? '#ff9a7a' : LIGHT;
      this.chips.add(txt(this, cx + w - 5, cy + 2, b?.d === 2 ? String(st.scores[id]?.[st.hole] ?? s) : String(s), { origin: [1, 0], color: col, shadow: false }));
    });
  }

  private renderCard(st: GolfState) {
    const want = st.sub === 'card' || st.sub === 'over';
    const key = want ? JSON.stringify([st.sub, st.hole, st.scores]) : '';
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.removeAll(true);
    if (!want) return;
    const total = (id: string) => (st.scores[id] ?? []).reduce<number>((a, s) => a + (s ?? 0), 0);
    const rows = [...st.order].sort((a, b) => total(a) - total(b));
    const parSum = (n: number) => st.par.slice(0, n).reduce((a, p) => a + p, 0);
    const rowH = 12;
    const w = 330;
    const x0 = (WORLD.W - w) / 2;
    const h = 48 + (rows.length + 1) * rowH + 18;
    const y0 = Math.max(30, Math.round((WORLD.H - h) / 2));
    this.card.add(this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1d1410, 0.45).setOrigin(0, 0));
    this.card.add(panel(this, x0, y0, w, h));
    const over = st.sub === 'over';
    this.card.add(ink(this, 240, y0 + 8, over ? 'ENDSTAND' : `SCORECARD · LOCH ${st.hole + 1}`, { size: 8, color: RED_INK }));
    const colX = (k: number) => x0 + 108 + k * 26;
    const totX = x0 + w - 44;
    const parX = x0 + w - 18;
    let y = y0 + 24;
    this.card.add(ink(this, x0 + 10, y, 'LOCH', { origin: [0, 0] }));
    for (let k = 0; k < st.holes; k++) {
      if (k === st.hole && !over) this.card.add(this.add.rectangle(colX(k) - 11, y0 + 21, 22, h - 32, 0xffd25e, 0.35).setOrigin(0, 0));
      this.card.add(ink(this, colX(k), y, String(k + 1)));
    }
    this.card.add(ink(this, totX, y, 'GES'));
    this.card.add(ink(this, parX, y, '+/-'));
    y += rowH;
    this.card.add(ink(this, x0 + 10, y, 'PAR', { origin: [0, 0], color: '#2d64a8' }));
    st.par.forEach((p, k) => this.card.add(ink(this, colX(k), y, String(p), { color: '#2d64a8' })));
    this.card.add(ink(this, totX, y, String(parSum(st.holes)), { color: '#2d64a8' }));
    y += rowH + 2;
    const played = over ? st.holes : st.hole + 1;
    rows.forEach((id, i) => {
      const yy = y + i * rowH;
      if (i % 2 === 0) this.card.add(this.add.rectangle(x0 + 6, yy - 2, w - 12, rowH, 0xe6c88a, 0.45).setOrigin(0, 0));
      this.card.add(this.add.circle(x0 + 14, yy + 3, 3.5, st.colors[id] ?? 0xffffff).setStrokeStyle(1, 0x2d1b12));
      const name = (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 8);
      this.card.add(ink(this, x0 + 22, yy, name, { origin: [0, 0] }));
      if (over && total(id) === total(rows[0])) this.card.add(this.add.image(x0 + 26 + name.length * 8, yy + 4, ensureTex(this, 'crown', crown)).setOrigin(0, 0.5));
      (st.scores[id] ?? []).forEach((s, k) => {
        if (s === null) return;
        const par = st.par[k];
        const color = s === 1 ? '#c98a10' : s < par ? '#2f7d32' : s > par ? RED_INK : INK;
        if (s === 1) this.card.add(this.add.circle(colX(k), yy + 3, 6, 0xffd25e).setStrokeStyle(1, 0xc98a10));
        this.card.add(ink(this, colX(k), yy, String(s), { color }));
      });
      const tot = total(id);
      this.card.add(ink(this, totX, yy, String(tot), { color: RED_INK }));
      const rel = tot - parSum(played);
      this.card.add(ink(this, parX, yy, rel === 0 ? '0' : rel > 0 ? `+${rel}` : String(rel), { color: rel < 0 ? '#2f7d32' : rel > 0 ? RED_INK : INK }));
    });
    // Hole-in-one dieses Lochs
    const aces = st.order.filter((id) => st.scores[id]?.[st.hole] === 1);
    const tie = rows.length > 1 && total(rows[0]) === total(rows[1]);
    const foot = over
      ? tie
        ? 'Gleichstand an der Spitze!'
        : `${(playerById(rows[0])?.name ?? '').slice(0, 14)} gewinnt!`
      : aces.length
        ? `HOLE-IN-ONE: ${aces.map((id) => (playerById(id)?.name ?? '').replace(/^Bot\s+/, '')).join(', ').slice(0, 30)}!`
        : st.hole + 1 < st.holes
          ? `Gleich: Loch ${st.hole + 2} – ${GOLF_HOLES[st.hole + 1].name}`
          : 'Gleich: Endstand';
    this.card.add(ink(this, 240, y0 + h - 14, foot, { color: aces.length || over ? '#c98a10' : INK }));
  }
}
