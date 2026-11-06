import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { BIRD_R, TEP, type TepCourse, type TepState, birdX, birdY, tepCourse } from '../../shared/teppich';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensureTex, ink, panel, tagName, txt, INK, RED_INK } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { type Figure, figure } from './textures';
import { SnapBuffer, lerpJump } from './interp';
import { twinkle } from './ambient';
import { BalanceHud, RecordPanel, recordLine } from './balanceHud';

/**
 * Teppich-Parcours (Balance Board): Seitenansicht einer Wüstenstadt bei Nacht. Die Kamera scrollt mit dem Teppich
 * (er sitzt bei `TEP.SCREEN_X`), Hindernisse und Juwelen kommen aus `tepCourse(seed)` – derselben Strecke wie am Server.
 */
const fmtS = (v: number) => `${v.toFixed(1)} s`;
const W = 480;
const H = 270;

function rug(): Pix {
  const p = new Pix(36, 9);
  p.rect(2, 2, 32, 5, '#a8342a');
  p.rect(4, 3, 28, 3, '#c94a3a');
  for (let x = 6; x < 31; x += 5) p.rect(x, 4, 2, 1, '#ffd25e');
  p.hline(2, 2, 32, '#ffd25e').hline(2, 6, 32, '#ffd25e');
  for (let y = 2; y < 7; y += 2) {
    p.px(0, y, '#f7e4b5').px(1, y, '#f7e4b5');
    p.px(34, y, '#f7e4b5').px(35, y, '#f7e4b5');
  }
  return p;
}

function vulture(frame: number): Pix {
  const p = new Pix(18, 10);
  p.rect(6, 4, 7, 3, '#4a3a33');
  p.rect(12, 3, 3, 2, '#e8c9a8');
  p.px(15, 4, '#f0973a');
  if (frame === 0) {
    p.rect(1, 1, 6, 2, '#3a2d28').rect(3, 3, 4, 1, '#3a2d28');
    p.rect(9, 0, 3, 4, '#3a2d28');
  } else {
    p.rect(1, 6, 6, 2, '#3a2d28').rect(9, 7, 3, 2, '#3a2d28');
  }
  p.outline('#1c1412');
  return p;
}

function gem(): Pix {
  const p = new Pix(9, 10);
  p.rect(2, 0, 5, 2, '#9ff3ff');
  p.rect(0, 2, 9, 3, '#4fd1e8');
  p.rect(1, 5, 7, 2, '#2fa5c8');
  p.rect(3, 7, 3, 2, '#1f7fa8');
  p.px(2, 2, '#ffffff').px(3, 1, '#ffffff');
  p.outline('#123a52');
  return p;
}

function skyline(w: number, h: number, seed: number, color: string, lit: string) {
  const p = new Pix(w, h);
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let x = 0;
  while (x < w) {
    const bw = 14 + Math.floor(rnd() * 22);
    const bh = 20 + Math.floor(rnd() * (h - 30));
    p.rect(x, h - bh, bw, bh, color);
    if (rnd() < 0.4) p.disc(x + bw / 2, h - bh, bw / 2 - 1, color);
    if (rnd() < 0.3) p.rect(x + bw / 2 - 1, h - bh - 14, 3, 14, color);
    for (let wy = h - bh + 6; wy < h - 4; wy += 7) for (let wx = x + 3; wx < x + bw - 3; wx += 6) if (rnd() < 0.25) p.rect(wx, wy, 2, 3, lit);
    x += bw + Math.floor(rnd() * 6);
  }
  return p;
}

function dunes(w: number, h: number) {
  const p = new Pix(w, h);
  for (let x = 0; x < w; x++) {
    const y = Math.round(6 + Math.sin(x / 37) * 4 + Math.sin(x / 13) * 1.5);
    p.vline(x, y, h - y, '#c99a5e');
    p.vline(x, y, 2, '#ddb47a');
    if ((x * 7) % 23 === 0) p.px(x, y + 6, '#a97a43');
  }
  return p;
}

export class TeppichScene extends Phaser.Scene {
  private buf = new SnapBuffer<TepState>();
  private latest: TepState | null = null;
  private juice!: Juice;
  private hud!: BalanceHud;
  private recPanel!: RecordPanel;
  private course: TepCourse | null = null;
  private seed = -1;
  private courseLayer!: Phaser.GameObjects.Container;
  private gems: Phaser.GameObjects.Image[] = [];
  private birds: { img: Phaser.GameObjects.Image; o: Extract<TepCourse['obstacles'][number], { k: 'bird' }> }[] = [];
  private carpet!: Phaser.GameObjects.Container;
  private rugImg!: Phaser.GameObjects.Image;
  private fig: Figure | null = null;
  private figId: string | null = null;
  private title!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private progress!: Phaser.GameObjects.Graphics;
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private seen = { id: null as string | null, sub: '', hits: 0, got: 0 };

  constructor() {
    super('teppich');
  }

  create() {
    this.buf = new SnapBuffer();
    this.latest = null;
    this.course = null;
    this.seed = -1;
    this.gems = [];
    this.birds = [];
    this.fig = null;
    this.figId = null;
    this.boardKey = '';
    this.seen = { id: null, sub: '', hits: 0, got: 0 };
    this.juice = new Juice(this, { depth: 2500, clock: this.buf, hud: this.add.container(0, 0).setScrollFactor(0).setDepth(5000) });
    this.cameras.main.setBounds(0, 0, TEP.LEN + W, H);

    // Nachthimmel, Mond, Sterne, Stadt-Silhouetten (Parallaxe), Dünen
    this.add.image(0, 0, ensureTex(this, 'tep_sky', () => {
      const p = new Pix(W, H);
      ['#0e1430', '#141c40', '#1b2350', '#26306a', '#38407e', '#5a4f8e'].forEach((c, i) => p.rect(0, i * 45, W, 45, c));
      p.disc(400, 46, 16, '#fff7c9');
      p.disc(394, 42, 15, '#141c40');
      return p;
    })).setOrigin(0).setScrollFactor(0).setDepth(-1000);
    twinkle(this, { n: 40, y: [4, 140], depth: -995 });
    for (const go of this.children.list) (go as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor?.(0);
    const far = ensureTex(this, 'tep_city_far', () => skyline(600, 120, 5, '#262a55', '#5a5f9e'));
    const near = ensureTex(this, 'tep_city_near', () => skyline(700, 110, 11, '#1a1a38', '#f0b860'));
    this.add.tileSprite(0, 150, W, 120, far).setOrigin(0).setScrollFactor(0).setDepth(-990).setName('far');
    this.add.tileSprite(0, 170, W, 110, near).setOrigin(0).setScrollFactor(0).setDepth(-980).setName('near');
    this.add.tileSprite(0, TEP.GROUND_Y - 6, TEP.LEN + W, H - TEP.GROUND_Y + 6, ensureTex(this, 'tep_dunes', () => dunes(240, 30))).setOrigin(0).setDepth(80);

    this.courseLayer = this.add.container(0, 0).setDepth(100);

    // Teppich + Figur
    this.carpet = this.add.container(TEP.START_X, TEP.START_Y).setDepth(500);
    this.rugImg = this.add.image(0, 2, ensureTex(this, 'tep_rug', rug));
    this.carpet.add(this.rugImg);

    // HUD
    this.add.rectangle(240, 13, 480, 26, 0x0b1024, 0.7).setScrollFactor(0).setDepth(2900);
    this.title = txt(this, 8, 4, '', { origin: [0, 0] }).setScrollFactor(0).setDepth(2901);
    this.info = txt(this, 472, 4, '', { origin: [1, 0], color: '#bcd3ff' }).setScrollFactor(0).setDepth(2901);
    this.progress = this.add.graphics().setScrollFactor(0).setDepth(2901);
    this.board = this.add.container(0, 0).setScrollFactor(0).setDepth(2950);
    this.hud = new BalanceHud(this, 404, 210);
    this.recPanel = new RecordPanel(this);
    ensureTex(this, 'tep_bird0', () => vulture(0));
    ensureTex(this, 'tep_bird1', () => vulture(1));

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  /** Strecke einmal zeichnen (Türme, Wolken, Ziel), Juwelen und Geier als Bilder */
  private buildCourse(seed: number) {
    this.seed = seed;
    this.course = tepCourse(seed);
    this.courseLayer.removeAll(true);
    this.gems = [];
    this.birds = [];
    const g = this.add.graphics();
    this.courseLayer.add(g);
    for (const o of this.course.obstacles) {
      if (o.k === 'tower') {
        const h = TEP.GROUND_Y - o.top;
        g.fillStyle(0xc98a4e, 1).fillRect(o.x, o.top + 8, o.w, h);
        g.fillStyle(0xa96c38, 1).fillRect(o.x, o.top + 8, 4, h);
        g.fillStyle(0xe0b070, 1).fillRect(o.x + 2, o.top + 6, o.w - 4, 4);
        // Zwiebelkuppel
        g.fillStyle(0x3fbf9a, 1).fillCircle(o.x + o.w / 2, o.top + 6, o.w / 2 - 2);
        g.fillTriangle(o.x + o.w / 2 - 4, o.top - 1, o.x + o.w / 2 + 4, o.top - 1, o.x + o.w / 2, o.top - 10);
        g.fillStyle(0xffd25e, 1).fillRect(o.x + o.w / 2 - 1, o.top - 14, 2, 5);
        for (let y = o.top + 18; y < TEP.GROUND_Y - 8; y += 16) g.fillStyle(0xf0b860, 1).fillRect(o.x + o.w / 2 - 2, y, 4, 6);
        g.lineStyle(1, 0x5e3518, 1).strokeRect(o.x, o.top + 8, o.w, h);
      } else if (o.k === 'cloud') {
        g.fillStyle(0x3a3f5c, 1).fillRect(o.x, 0, o.w, o.bottom - 6);
        for (let x = o.x - 2; x <= o.x + o.w + 2; x += 8) g.fillCircle(x, o.bottom - 6, 7);
        g.fillStyle(0x50567a, 1);
        for (let x = o.x + 2; x <= o.x + o.w; x += 12) g.fillCircle(x, o.bottom - 12, 5);
        // Blitz
        const bolt = this.add.graphics();
        bolt.lineStyle(2, 0xfff27a, 1).lineBetween(o.x + o.w / 2, o.bottom, o.x + o.w / 2 - 4, o.bottom + 8).lineBetween(o.x + o.w / 2 - 4, o.bottom + 8, o.x + o.w / 2 + 2, o.bottom + 14);
        bolt.setAlpha(0);
        this.courseLayer.add(bolt);
        this.tweens.add({ targets: bolt, alpha: 1, duration: 70, yoyo: true, repeat: -1, delay: (o.x * 13) % 2500, repeatDelay: 2600 + ((o.x * 7) % 1800) });
      } else {
        const img = this.add.image(o.x, o.y0, 'tep_bird0');
        this.courseLayer.add(img);
        this.birds.push({ img, o });
      }
    }
    for (const gm of this.course.gems) {
      const img = this.add.image(gm.x, gm.y, ensureTex(this, 'tep_gem', gem));
      this.courseLayer.add(img);
      this.gems.push(img);
    }
    // Ziel: Torbogen mit Fahnen
    const fx = TEP.LEN;
    g.fillStyle(0xf7e4b5, 1).fillRect(fx - 3, 46, 6, TEP.GROUND_Y - 46);
    for (let y = 46; y < TEP.GROUND_Y; y += 12) g.fillStyle(y % 24 ? 0x2d1b12 : 0xffffff, 1).fillRect(fx - 3, y, 6, 6);
    const flag = txt(this, fx, 34, 'ZIEL', { color: '#ffd25e' });
    this.courseLayer.add(flag);
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'teppich') return;
    const st = s.mini.state;
    if (st.seed !== this.seed) this.buildCourse(st.seed);
    this.latest = st;
    this.buf.push(st.t, st);
    this.cues(st);
    this.renderHud(st);
  }

  private cues(st: TepState) {
    const sn = this.seen;
    if (st.active !== sn.id) {
      sn.id = st.active;
      sn.hits = 0;
      sn.got = 0;
      if (st.active) say(`${spokenName(playerById(st.active)?.name)} fliegt.`);
    }
    if (st.sub === 'fly' || st.sub === 'done') {
      if (st.hits > sn.hits) {
        sn.hits = st.hits;
        this.buf.after(st.t, () => {
          sfx('bonk');
          sfx('hit', { delay: 0.05 });
          this.juice.shake(1);
          this.juice.burst(st.x, st.y, 'smoke', 10);
        });
      }
      if (st.got.length > sn.got) {
        sn.got = st.got.length;
        this.buf.after(st.t, () => {
          sfx('coin', { pitch: 1 + Math.min(1, st.got.length / 20) });
          this.juice.burst(st.x + 10, st.y, 'spark', 8);
        });
      }
    }
    if (st.sub === sn.sub) return;
    sn.sub = st.sub;
    if (st.sub === 'fly') sfx('whoosh');
    if (st.sub === 'done' && st.last) {
      const r = st.last;
      this.buf.after(st.t, () => {
        if (r.finished) {
          sfx('goal');
          this.juice.burst(st.x, st.y, 'confetti');
        } else sfx('lose');
        if (r.rec) {
          const isRec = r.rec === 'record';
          sfx('fanfare', { delay: 0.2 });
          this.juice.banner(isRec ? 'NEUER REKORD!' : 'BESTZEIT!', `${r.score.toFixed(2)} s`, 3200);
          say(isRec ? 'Neuer Rekord!' : 'Persönliche Bestzeit!');
          return;
        }
        this.juice.banner(r.finished ? `${r.score.toFixed(2)} s` : 'Zeit um!', `${r.time.toFixed(2)} s − ${r.gems} 💎 · ${r.hits} Treffer`, 2600);
        say(r.finished ? `${r.score.toFixed(1).replace('.', ',')} Sekunden` : 'Zeit um!');
      });
    }
    if (st.sub === 'over') sfx('fanfare');
  }

  private renderHud(st: TepState) {
    const name = st.active ? tagName(playerById(st.active)?.name ?? '?') : '';
    const t = `🧞 Teppich-Parcours · ${name}`;
    if (this.title.text !== t) this.title.setText(t);
    const i = st.sub === 'fly' || st.sub === 'done' ? `⏱ ${st.ft.toFixed(1)} s · 💎 ${st.got.length} · 💥 ${st.hits}` : '';
    if (this.info.text !== i) this.info.setText(i);
    this.hud.target = null;
    this.recPanel.update(st.records, fmtS, st.sub === 'ready' || st.sub === 'done', 6, 34);

    const ids = Object.keys(st.points);
    const ranked = ids.filter((id) => st.runs[id]).sort((a, b) => st.runs[a].score - st.runs[b].score);
    const over = st.sub === 'over';
    const key = JSON.stringify([over, ranked, st.runs]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (!ranked.length) return;
    const rows = over ? ranked : ranked.slice(0, 5);
    const w = over ? 300 : 160;
    const h = 22 + rows.length * 12;
    const x0 = over ? 90 : 6;
    const y0 = over ? 60 : 264 - h;
    this.board.add(panel(this, x0, y0, w, h));
    this.board.add(ink(this, x0 + w / 2, y0 + 6, over ? 'Endstand' : 'Bestzeiten', { color: RED_INK }));
    rows.forEach((id, k) => {
      const r = st.runs[id];
      this.board.add(ink(this, x0 + 8, y0 + 20 + k * 12, `${k + 1}. ${tagName(playerById(id)?.name ?? '?').slice(0, over ? 14 : 9)}`, { origin: [0, 0], color: INK }));
      this.board.add(ink(this, x0 + w - 8, y0 + 20 + k * 12, r.dns ? '–' : `${r.score.toFixed(1)} s${over ? `  ${r.gems}💎` : ''}`, { origin: [1, 0], color: INK }));
    });
  }

  private ensureFigure(id: string | null) {
    if (id === this.figId) return;
    this.figId = id;
    this.fig?.destroy();
    this.fig = null;
    const p = id ? playerById(id) : null;
    if (!p) return;
    this.fig = figure(this, p.look, -2, 0, 0.85);
    (this.fig.getData('img') as Phaser.GameObjects.Image).setScale(0.85, 0.7);
    this.carpet.add(this.fig);
  }

  update() {
    const st = this.latest;
    if (!st) return;
    this.hud.update(st, recordLine(st.records, fmtS));
    const smp = this.buf.sample();
    if (!smp) return;
    const { a, b, f } = smp;
    const same = a.active === b.active;
    const x = same ? lerpJump(a.x, b.x, f, 120) : b.x;
    const y = same ? lerpJump(a.y, b.y, f, 80) : b.y;
    const ft = same ? a.ft + (b.ft - a.ft) * f : b.ft;
    this.ensureFigure(st.active);
    const now = this.time.now;
    const flying = b.sub === 'fly';
    const stunned = flying && ft * 1000 < b.stunMs;
    this.carpet.setVisible(!!st.active && b.sub !== 'ready' && b.sub !== 'over');
    this.carpet.setPosition(x, y + Math.sin(now / 260) * (flying ? 0.6 : 1.5));
    this.carpet.setRotation(Phaser.Math.Clamp(b.vy / 600, -0.25, 0.25) + (stunned ? Math.sin(now / 40) * 0.15 : 0));
    this.carpet.setAlpha(flying && ft * 1000 < b.safeMs ? (Math.floor(now / 90) % 2 ? 0.45 : 1) : 1);
    // Teppich wellt sich
    this.rugImg.setScale(1, 1 + Math.sin(now / 120) * 0.12);

    // Juwelen ausblenden, Geier bewegen
    this.gems.forEach((img, i) => img.setVisible(!b.got.includes(i)).setY((this.course?.gems[i].y ?? 0) + Math.sin(now / 300 + i) * 1.5));
    const flap = Math.floor(now / 160) % 2;
    for (const bd of this.birds) {
      bd.img.setPosition(birdX(bd.o, ft), birdY(bd.o, ft)).setTexture(flap ? 'tep_bird1' : 'tep_bird0');
      void BIRD_R;
    }

    // Kamera + Parallaxe
    const camX = Math.max(0, x - TEP.SCREEN_X);
    this.cameras.main.setScroll(Math.round(camX), 0);
    (this.children.getByName('far') as Phaser.GameObjects.TileSprite | null)?.setTilePosition(camX * 0.15, 0);
    (this.children.getByName('near') as Phaser.GameObjects.TileSprite | null)?.setTilePosition(camX * 0.35, 0);

    // Fortschritt
    const pg = this.progress;
    pg.clear();
    if (flying || b.sub === 'done') {
      pg.fillStyle(0x2a3550, 1).fillRect(140, 28, 200, 4);
      pg.fillStyle(0xffd25e, 1).fillRect(140, 28, 200 * Phaser.Math.Clamp((x - TEP.START_X) / (TEP.LEN - TEP.START_X), 0, 1), 4);
    }
  }
}
