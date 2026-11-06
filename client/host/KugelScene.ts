import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { KUG, type KugelCourse, type KugelState, cellX, cellY, kugelCourse, routePoint } from '../../shared/kugel';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensureTex, ink, panel, tagName, txt, INK, RED_INK } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { SnapBuffer, lerpJump } from './interp';
import { twinkle } from './ambient';
import { pcol } from './playerColor';
import { BalanceHud } from './balanceHud';

/**
 * Tempel-Kugel (Balance Board): Draufsicht auf einen schmalen, moosbewachsenen Steinpfad über einem Abgrund.
 * Das Labyrinth kommt aus `kugelCourse(seed)` – derselben Strecke wie am Server. Die Kugel rollt mit dem Schwerpunkt.
 */
const W = 480;
const H = 270;
const R = KUG.R;

function abyss(): Pix {
  const p = new Pix(W, H);
  const cols = ['#06080f', '#090d19', '#0d1322', '#121a2e', '#18223b', '#1d2946'];
  cols.forEach((c, i) => p.rect(0, i * 45, W, 45, c));
  // Ferne Säulen und Mauerreste tief unten
  let r = 11;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(rnd() * W);
    const w = 6 + Math.floor(rnd() * 14);
    const y = 120 + Math.floor(rnd() * 110);
    p.rect(x, y, w, H - y, '#10172a');
    p.rect(x, y, 2, H - y, '#17213a');
  }
  return p;
}

export class KugelScene extends Phaser.Scene {
  private buf = new SnapBuffer<KugelState>();
  private latest: KugelState | null = null;
  private juice!: Juice;
  private hud!: BalanceHud;
  private course: KugelCourse | null = null;
  private seed = -1;
  private layer!: Phaser.GameObjects.Container;
  private torches: { flame: Phaser.GameObjects.Arc; glow: Phaser.GameObjects.Arc; x: number; y: number }[] = [];
  private ball!: Phaser.GameObjects.Container;
  private ballBody!: Phaser.GameObjects.Arc;
  private ballShade!: Phaser.GameObjects.Ellipse;
  private title!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private seen = { id: null as string | null, sub: '', falls: 0, cp: 0 };
  private hintUntil = 0;

  constructor() {
    super('kugel');
  }

  create() {
    this.buf = new SnapBuffer();
    this.latest = null;
    this.course = null;
    this.seed = -1;
    this.torches = [];
    this.boardKey = '';
    this.seen = { id: null, sub: '', falls: 0, cp: 0 };
    this.hintUntil = 0;
    this.juice = new Juice(this, { depth: 2500, clock: this.buf, hud: this.add.container(0, 0).setScrollFactor(0).setDepth(5000) });

    this.add.image(0, 0, ensureTex(this, 'kug_abyss', abyss)).setOrigin(0).setDepth(-1000);
    twinkle(this, { n: 14, y: [4, 20], depth: -995 });
    // Nebel, der durch die Tiefe zieht
    for (let i = 0; i < 7; i++) {
      const y = 70 + i * 28;
      const m = this.add.ellipse(60 + i * 70, y, 180, 22, 0x8fb4e8, 0.07).setDepth(-900);
      this.tweens.add({ targets: m, x: m.x + 60, alpha: 0.03, duration: 5000 + i * 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    this.layer = this.add.container(0, 0).setDepth(100);

    this.ballShade = this.add.ellipse(0, 3, 9, 4, 0x000000, 0.35);
    this.ballBody = this.add.circle(0, 0, KUG.BALL_R, 0xffffff);
    const shine = this.add.circle(-1.6, -1.8, 1.6, 0xffffff, 0.9);
    this.ball = this.add.container(0, 0, [this.ballShade, this.ballBody, shine]).setDepth(500).setVisible(false);

    this.add.rectangle(240, 13, 480, 26, 0x0b1024, 0.75).setDepth(2900);
    this.title = txt(this, 8, 4, '', { origin: [0, 0] }).setDepth(2901);
    this.info = txt(this, 472, 4, '', { origin: [1, 0], color: '#bcd3ff' }).setDepth(2901);
    this.hint = txt(this, 190, 32, '', { size: 8, color: '#ffd25e' }).setDepth(2901);
    this.board = this.add.container(0, 0).setDepth(2950);
    this.hud = new BalanceHud(this, 392, 190);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  /** Labyrinth einmal zeichnen: Pfad mit Mauerkante und Moos, Fackeln, Start, Ziel */
  private buildCourse(seed: number) {
    this.seed = seed;
    const c = (this.course = kugelCourse(seed));
    this.layer.removeAll(true);
    this.torches = [];

    const shape = (g: Phaser.GameObjects.Graphics, r: number, dy = 0) => {
      for (const [c1, r1, c2, r2] of c.links) {
        const x1 = cellX(Math.min(c1, c2));
        const x2 = cellX(Math.max(c1, c2));
        const y1 = cellY(Math.min(r1, r2));
        const y2 = cellY(Math.max(r1, r2));
        g.fillRect(x1 - r, y1 - r + dy, x2 - x1 + 2 * r, y2 - y1 + 2 * r);
      }
      const seen = new Set<number>();
      for (const [c1, r1, c2, r2] of c.links)
        for (const [cc, rr] of [[c1, r1], [c2, r2]]) {
          const k = rr * KUG.COLS + cc;
          if (seen.has(k)) continue;
          seen.add(k);
          g.fillCircle(cellX(cc), cellY(rr) + dy, r);
        }
    };
    // Mauerwand unter dem Pfad (Tiefe), Moosrand, Steinoberfläche
    const wall = this.add.graphics().fillStyle(0x23271f, 1);
    shape(wall, R + 1, 8);
    const wall2 = this.add.graphics().fillStyle(0x333a2b, 1);
    shape(wall2, R + 1, 4);
    const moss = this.add.graphics().fillStyle(0x4f8a3c, 1);
    shape(moss, R + 1.5);
    const stone = this.add.graphics().fillStyle(0x9ca092, 1);
    shape(stone, R - 1);
    this.layer.add([wall, wall2, moss, stone]);

    // Fugen, Steinplatten und Moosflecken
    const det = this.add.graphics();
    let rs = seed % 9973 || 7;
    const rnd = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);
    for (const [c1, r1, c2, r2] of c.links) {
      const horiz = r1 === r2;
      const a = horiz ? cellX(Math.min(c1, c2)) : cellY(Math.min(r1, r2));
      const b = horiz ? cellX(Math.max(c1, c2)) : cellY(Math.max(r1, r2));
      const fixed = horiz ? cellY(r1) : cellX(c1);
      for (let t = a + 6; t < b; t += 9 + Math.floor(rnd() * 4)) {
        det.lineStyle(1, 0x7b8173, 1);
        if (horiz) det.lineBetween(t, fixed - R + 2, t, fixed + R - 2);
        else det.lineBetween(fixed - R + 2, t, fixed + R - 2, t);
      }
      // Moos wächst von den Rändern herein
      for (let k = 0; k < 5; k++) {
        const t = a + rnd() * (b - a);
        const off = (rnd() < 0.5 ? -1 : 1) * (R - 2 - rnd() * 3);
        det.fillStyle(rnd() < 0.5 ? 0x6fa84a : 0x58923c, 0.95);
        det.fillCircle(horiz ? t : fixed + off, horiz ? fixed + off : t, 1.5 + rnd() * 2.2);
      }
    }
    this.layer.add(det);

    // Start: Runenkreis
    const st = this.add.graphics();
    st.lineStyle(1.5, 0xffd25e, 0.9).strokeCircle(cellX(c.start.c), cellY(c.start.r), R - 3);
    st.lineStyle(1, 0xffd25e, 0.6).strokeCircle(cellX(c.start.c), cellY(c.start.r), R - 6);
    this.layer.add(st);
    this.layer.add(txt(this, cellX(c.start.c), cellY(c.start.r) - R - 10, 'START', { color: '#ffd25e' }).setScale(0.75));

    // Ziel: leuchtender Altar
    const gx = cellX(c.goal.c);
    const gy = cellY(c.goal.r);
    const glow = this.add.circle(gx, gy, R + 2, 0xfff1a8, 0.35);
    this.tweens.add({ targets: glow, alpha: 0.7, scale: 1.25, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    const altar = this.add.circle(gx, gy, 6, 0xe2b64a).setStrokeStyle(1.5, 0x7a5a1a);
    const gem = this.add.circle(gx, gy - 1, 2.5, 0x4fd1e8).setStrokeStyle(1, 0x123a52);
    this.layer.add([glow, altar, gem]);
    this.layer.add(txt(this, gx, gy - R - 10, 'ZIEL', { color: '#ffd25e' }).setScale(0.75));

    // Kontrollpunkte: Fackeln am Pfadrand
    c.checkpoints.forEach((idx) => {
      const p = routePoint(c, idx);
      const tx = p.x + R - 1;
      const ty = p.y - R + 3;
      const post = this.add.rectangle(tx, ty + 3, 2, 7, 0x5e3518);
      const glowC = this.add.circle(tx, ty - 2, 8, 0xffa84a, 0).setDepth(0);
      const flame = this.add.circle(tx, ty - 3, 2.6, 0x6b6f78);
      this.layer.add([glowC, post, flame]);
      this.torches.push({ flame, glow: glowC, x: tx, y: ty - 3 });
    });
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'kugel') return;
    const st = s.mini.state;
    if (st.seed !== this.seed) this.buildCourse(st.seed);
    this.latest = st;
    this.buf.push(st.t, st);
    this.cues(st);
    this.renderHud(st);
  }

  private flashHint(text: string, ms = 1400) {
    this.hintUntil = this.time.now + ms;
    this.hint.setText(text);
  }

  private cues(st: KugelState) {
    const sn = this.seen;
    if (st.active !== sn.id) {
      sn.id = st.active;
      sn.falls = 0;
      sn.cp = 0;
      this.torches.forEach((t) => this.lightTorch(t, false));
      if (st.active) {
        const p = playerById(st.active);
        this.ballBody.setFillStyle(pcol(st.active).num);
        say(`${spokenName(p?.name)} rollt.`);
      }
    }
    if (st.sub === 'roll' || st.sub === 'done') {
      if (st.falls > sn.falls) {
        sn.falls = st.falls;
        this.buf.after(st.t, () => {
          sfx('whoosh', { pitch: 0.6 });
          sfx('error', { delay: 0.1 });
          this.juice.shake(1);
          this.flashHint('Abgestürzt! +4 s – zurück zum Kontrollpunkt');
        });
      }
      if (st.cp > sn.cp) {
        sn.cp = st.cp;
        const t = this.torches[st.cp - 1];
        this.buf.after(st.t, () => {
          sfx('coin', { pitch: 1.1 });
          if (t) {
            this.lightTorch(t, true);
            this.juice.burst(t.x, t.y, 'fire', 8);
          }
          this.flashHint('Kontrollpunkt!');
        });
      }
    }
    // Beim (Wieder-)Einstieg mitten im Lauf: schon erreichte Fackeln anzünden
    if (st.sub === 'roll') this.torches.forEach((t, i) => this.lightTorch(t, i < st.cp));
    if (st.sub === sn.sub) return;
    sn.sub = st.sub;
    if (st.sub === 'countdown') this.torches.forEach((t) => this.lightTorch(t, false));
    if (st.sub === 'done' && st.last) {
      const r = st.last;
      this.buf.after(st.t, () => {
        if (r.finished) {
          sfx('goal');
          this.juice.burst(cellX(this.course?.goal.c ?? 0), cellY(this.course?.goal.r ?? 0), 'confetti');
        } else sfx('lose');
        this.juice.banner(r.finished ? `${r.score.toFixed(1)} s` : 'Zeit um!', r.finished ? `${r.time.toFixed(1)} s${r.falls ? ` + ${r.falls}× Absturz` : ''}` : 'Nicht im Ziel', 2600);
        say(r.finished ? `${r.score.toFixed(1).replace('.', ',')} Sekunden` : 'Zeit um!');
      });
    }
    if (st.sub === 'over') sfx('fanfare');
  }

  private lightTorch(t: KugelScene['torches'][number], on: boolean) {
    t.flame.setFillStyle(on ? 0xffa83a : 0x6b6f78);
    t.glow.setFillStyle(0xffa84a, on ? 0.35 : 0);
  }

  private renderHud(st: KugelState) {
    const name = st.active ? tagName(playerById(st.active)?.name ?? '?') : '';
    const t = `🔮 Tempel-Kugel · ${name}`;
    if (this.title.text !== t) this.title.setText(t);
    const i = st.sub === 'roll' || st.sub === 'done' ? `⏱ ${st.ft.toFixed(1)} s · 🔥 ${st.cp}/${this.course?.checkpoints.length ?? 0} · 💀 ${st.falls}` : '';
    if (this.info.text !== i) this.info.setText(i);
    this.hud.target = null;
    if (this.time.now > this.hintUntil) {
      const h = st.sub === 'countdown' ? 'Ruhig stehen – gleich rollt die Kugel!' : st.sub === 'roll' && st.ft < 6 ? 'Vorn lehnen = hoch · hinten = runter' : '';
      if (this.hint.text !== h) this.hint.setText(h);
    }

    const ids = Object.keys(st.points);
    const ranked = ids.filter((id) => st.runs[id]).sort((a, b) => st.runs[a].score - st.runs[b].score);
    const key = JSON.stringify([st.sub === 'over', st.runs]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (!ranked.length) return;
    const over = st.sub === 'over';
    const rows = over ? ranked : ranked.slice(0, 5);
    const w = over ? 300 : 102;
    const h = 22 + rows.length * 12;
    const x0 = over ? 90 : 374;
    const y0 = over ? 60 : 34;
    this.board.add(panel(this, x0, y0, w, h));
    this.board.add(ink(this, x0 + w / 2, y0 + 6, over ? 'Endstand' : 'Bestzeiten', { color: RED_INK }));
    rows.forEach((id, k) => {
      const r = st.runs[id];
      this.board.add(ink(this, x0 + 5, y0 + 20 + k * 12, `${k + 1}.${tagName(playerById(id)?.name ?? '?').slice(0, over ? 14 : 4)}`, { origin: [0, 0], color: INK }));
      this.board.add(ink(this, x0 + w - 5, y0 + 20 + k * 12, r.dns ? '–' : `${r.score.toFixed(1)}${over ? ` s  ${r.falls}×💀` : ''}`, { origin: [1, 0], color: INK }));
    });
  }

  update() {
    const st = this.latest;
    if (!st) return;
    this.hud.update(st);
    const smp = this.buf.sample();
    if (!smp) return;
    const { a, b, f } = smp;
    const same = a.active === b.active;
    const x = same ? lerpJump(a.x, b.x, f, 60) : b.x;
    const y = same ? lerpJump(a.y, b.y, f, 60) : b.y;
    const fall = b.fall;
    this.ball.setVisible(!!st.active && b.sub !== 'ready' && b.sub !== 'over');
    // Fallende Kugel wird kleiner, dunkler und sinkt; am Ende fehlt sie ganz
    this.ball.setPosition(x, y + fall * 16);
    this.ball.setScale(1 - fall * 0.85);
    this.ball.setAlpha(1 - fall * 0.8);
    this.ballShade.setVisible(fall === 0);
    // Leichtes Rollen: Glanzpunkt wandert mit der Bewegung
    const sp = Math.hypot(b.vx, b.vy);
    this.ballBody.setScale(1 + Math.min(0.12, sp / 1200));
    // Fackeln flackern
    const now = this.time.now;
    this.torches.forEach((t, i) => {
      if (t.glow.fillAlpha > 0) t.glow.setScale(1 + Math.sin(now / 90 + i * 2) * 0.12);
    });
  }
}
