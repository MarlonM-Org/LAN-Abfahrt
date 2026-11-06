import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { type KugelCourse, type KugelState, kugelCourse, wrapAng } from '../../shared/kugel';
import { KugelRenderer, WORLD_H, WORLD_W } from '../kugel3d/render';
import { bus, getState, playerById } from './store';
import { ink, panel, tagName, txt, INK, RED_INK } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';
import { SnapBuffer, lerp, lerpJump } from './interp';
import { pcol } from './playerColor';
import { BalanceHud, RecordPanel, recordLine } from './balanceHud';

/**
 * Tempel-Kugel (Balance Board): Verfolgerkamera hinter der Figur auf der Kugel, wie im Kart (`client/kugel3d/render.ts`).
 * Das Labyrinth kommt aus `kugelCourse(seed)` – derselben Strecke wie am Server; die Blickrichtung (`ang`) berechnet der Server.
 */
const fmtS = (v: number) => `${v.toFixed(1)} s`;

export class KugelScene extends Phaser.Scene {
  private buf = new SnapBuffer<KugelState>();
  private latest: KugelState | null = null;
  private juice!: Juice;
  private hud!: BalanceHud;
  private recPanel!: RecordPanel;
  private course: KugelCourse | null = null;
  private cam3d: KugelRenderer | null = null;
  private seed = -1;
  private tex!: Phaser.Textures.CanvasTexture;
  private view!: Phaser.GameObjects.Image;
  private title!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private boardKey = '';
  private seen = { id: null as string | null, sub: '', falls: 0, cp: 0 };
  private hintUntil = 0;
  /** Abgerollte Strecke der Kugel (px), dreht die Flecken */
  private roll = 0;
  private lastPos = { x: 0, y: 0 };

  constructor() {
    super('kugel');
  }

  create() {
    this.buf = new SnapBuffer();
    this.latest = null;
    this.course = null;
    this.cam3d = null;
    this.seed = -1;
    this.boardKey = '';
    this.seen = { id: null, sub: '', falls: 0, cp: 0 };
    this.hintUntil = 0;
    this.roll = 0;
    this.juice = new Juice(this, { depth: 2500, clock: this.buf, hud: this.add.container(0, 0).setScrollFactor(0).setDepth(5000) });

    const key = 'kug_view';
    this.tex = (this.textures.exists(key) ? this.textures.get(key) : this.textures.createCanvas(key, WORLD_W, WORLD_H)) as Phaser.Textures.CanvasTexture;
    this.view = this.add.image(0, 0, key).setOrigin(0).setDepth(-100);

    this.add.rectangle(240, 13, 480, 26, 0x0b1024, 0.78).setDepth(2900);
    this.title = txt(this, 8, 4, '', { origin: [0, 0] }).setDepth(2901);
    this.info = txt(this, 472, 4, '', { origin: [1, 0], color: '#bcd3ff' }).setDepth(2901);
    this.hint = txt(this, 190, 32, '', { size: 8, color: '#ffd25e' }).setDepth(2901);
    this.board = this.add.container(0, 0).setDepth(2950);
    this.hud = new BalanceHud(this, 392, 190);
    this.recPanel = new RecordPanel(this);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'kugel') return;
    const st = s.mini.state;
    if (st.seed !== this.seed) {
      this.seed = st.seed;
      this.course = kugelCourse(st.seed);
      this.cam3d = new KugelRenderer(this.course, st.seed, WORLD_W, WORLD_H);
    }
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
      this.roll = 0;
      if (st.active) say(`${spokenName(playerById(st.active)?.name)} rollt.`);
    }
    if (st.sub === 'roll' || st.sub === 'done') {
      if (st.falls > sn.falls) {
        sn.falls = st.falls;
        this.buf.after(st.t, () => {
          sfx('whoosh', { pitch: 0.6 });
          sfx('error', { delay: 0.1 });
          this.juice.shake(2);
          this.flashHint('Abgestürzt! +4 s – zurück zum Kontrollpunkt');
        });
      }
      if (st.cp > sn.cp) {
        sn.cp = st.cp;
        this.buf.after(st.t, () => {
          sfx('coin', { pitch: 1.1 });
          this.juice.flash(0xffc070, 120);
          this.flashHint('Kontrollpunkt!');
        });
      }
    }
    if (st.sub === sn.sub) return;
    sn.sub = st.sub;
    if (st.sub === 'done' && st.last) {
      const r = st.last;
      this.buf.after(st.t, () => {
        if (r.finished) {
          sfx('goal');
          this.juice.flash(0xfff1a8, 260);
        } else sfx('lose');
        if (r.rec) {
          const isRec = r.rec === 'record';
          sfx('fanfare', { delay: 0.2 });
          this.juice.banner(isRec ? 'NEUER REKORD!' : 'BESTZEIT!', `${r.score.toFixed(1)} s`, 3200);
          say(isRec ? 'Neuer Rekord!' : 'Persönliche Bestzeit!');
          return;
        }
        this.juice.banner(r.finished ? `${r.score.toFixed(1)} s` : 'Zeit um!', r.finished ? `${r.time.toFixed(1)} s${r.falls ? ` + ${r.falls}× Absturz` : ''}` : 'Nicht im Ziel', 2600);
        say(r.finished ? `${r.score.toFixed(1).replace('.', ',')} Sekunden` : 'Zeit um!');
      });
    }
    if (st.sub === 'over') sfx('fanfare');
  }

  private renderHud(st: KugelState) {
    const name = st.active ? tagName(playerById(st.active)?.name ?? '?') : '';
    const t = `🔮 Tempel-Kugel · ${name}`;
    if (this.title.text !== t) this.title.setText(t);
    const i = st.sub === 'roll' || st.sub === 'done' ? `⏱ ${st.ft.toFixed(1)} s · 🔥 ${st.cp}/${this.course?.checkpoints.length ?? 0} · 💀 ${st.falls}` : '';
    if (this.info.text !== i) this.info.setText(i);
    this.hud.target = null;
    // Rekorde unter den Bestzeiten dieses Abends (links, nur zwischen den Versuchen)
    this.recPanel.update(st.records, fmtS, st.sub === 'ready' || st.sub === 'done', 6, 124);
    if (this.time.now > this.hintUntil) {
      const h = st.sub === 'countdown' ? 'Ruhig stehen – gleich rollt die Kugel!' : st.sub === 'roll' && st.ft < 9 ? 'Wie ein Hoverboard: vorn = Gas · seitlich = drehen · hinten = bremsen' : '';
      if (this.hint.text !== h) this.hint.setText(h);
    }

    // Bestzeiten links (nur zwischen den Versuchen, damit die Sicht frei bleibt)
    const ids = Object.keys(st.points);
    const ranked = ids.filter((id) => st.runs[id]).sort((a, b) => st.runs[a].score - st.runs[b].score);
    const over = st.sub === 'over';
    const show = st.sub === 'ready' || st.sub === 'done' || over;
    const key = JSON.stringify([show, over, st.runs]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.removeAll(true);
    if (!ranked.length || !show) return;
    const rows = over ? ranked : ranked.slice(0, 5);
    const w = over ? 300 : 120;
    const h = 22 + rows.length * 12;
    const x0 = over ? 90 : 6;
    const y0 = over ? 60 : 34;
    this.board.add(panel(this, x0, y0, w, h));
    this.board.add(ink(this, x0 + w / 2, y0 + 6, over ? 'Endstand' : 'Bestzeiten', { color: RED_INK }));
    rows.forEach((id, k) => {
      const r = st.runs[id];
      this.board.add(ink(this, x0 + 6, y0 + 20 + k * 12, `${k + 1}.${tagName(playerById(id)?.name ?? '?').slice(0, over ? 14 : 6)}`, { origin: [0, 0], color: INK }));
      this.board.add(ink(this, x0 + w - 6, y0 + 20 + k * 12, r.dns ? '–' : `${r.score.toFixed(1)}${over ? ` s  ${r.falls}×💀` : ''}`, { origin: [1, 0], color: INK }));
    });
  }

  update() {
    const st = this.latest;
    const R = this.cam3d;
    if (!st || !R) return;
    this.hud.update(st, recordLine(st.records, fmtS));
    const smp = this.buf.sample();
    if (!smp) return;
    const { a, b, f } = smp;
    const same = a.active === b.active && a.sub === b.sub;
    const x = same ? lerpJump(a.x, b.x, f, 60) : b.x;
    const y = same ? lerpJump(a.y, b.y, f, 60) : b.y;
    const vx = same ? lerp(a.vx, b.vx, f) : b.vx;
    const vy = same ? lerp(a.vy, b.vy, f) : b.vy;
    const ang = same ? wrapAng(a.ang + wrapAng(b.ang - a.ang) * f) : b.ang;
    this.roll += Math.hypot(x - this.lastPos.x, y - this.lastPos.y) < 30 ? Math.hypot(x - this.lastPos.x, y - this.lastPos.y) : 0;
    this.lastPos = { x, y };
    const show = !!st.active && b.sub !== 'ready' && b.sub !== 'over';
    const color = pcol(st.active).hex;
    const look = playerById(st.active)?.look;
    R.render({ x, y, ang, vx, vy, fall: b.fall, cp: b.cp, show }, { look, color, roll: this.roll, now: this.time.now });
    this.tex.context.drawImage(R.canvas, 0, 0);
    this.tex.refresh();
  }
}
