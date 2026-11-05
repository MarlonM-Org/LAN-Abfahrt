import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { KOFFER, type KofferActive, type KofferCar, type KofferState, kofferCellOffsets, kofferCellsInside, kofferCom } from '../../shared/koffer';
import { paintSky } from '../art/ground';
import { kofferPiece, paintCar, paintRoad } from '../art/koffer';
import { bus, getState, playerById } from './store';
import { GOLD, background, ensureTex, ink, panel, txt } from './ui';

const B = KOFFER.BLOCK;
const HUD = 22;
const LABEL = 20;
const VIEW_W = KOFFER.VIEW_X1 - KOFFER.VIEW_X0;
const VIEW_H = KOFFER.VIEW_TOP + KOFFER.VIEW_BOTTOM;
const VIEW_MID = (KOFFER.VIEW_X0 + KOFFER.VIEW_X1) / 2;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
/** Heckklappe: offen schräg nach hinten oben, zu senkrecht nach unten (Winkel ab der Waagerechten, nach oben positiv) */
const HATCH_OPEN = 1.0;
const HATCH_CLOSED = -Math.PI / 2;
const CLOSE_MS = 1100;

interface LaneLayout {
  cx: number;
  /** Bildschirm-x von x = 0 (Lehne) */
  ox: number;
  /** Bildschirm-y des Kofferraumbodens */
  baseY: number;
  laneW: number;
  labelY: number;
  top: number;
}

/** Autos auf dem TV verteilen: eine bis drei Reihen – je nachdem, was größer wird */
function layout(n: number): { s: number; lanes: LaneLayout[] } {
  let best = { s: 0, rows: 1 };
  for (const rows of [1, 2, 3]) {
    if (rows > n) break;
    const perRow = Math.ceil(n / rows);
    const laneW = WORLD.W / perRow;
    const rowH = (WORLD.H - HUD) / rows;
    const s = Math.min((laneW - 4) / (VIEW_W * B), (rowH - LABEL - 2) / (VIEW_H * B));
    if (s > best.s + 0.01) best = { s, rows };
  }
  const { rows } = best;
  // Ganzzahlige Pixel pro Block: Kanten benachbarter Teile treffen sich exakt
  const s = best.s * B >= 4 ? Math.floor(best.s * B) / B : best.s;
  const perRow = Math.ceil(n / rows);
  const laneW = WORLD.W / perRow;
  const rowH = (WORLD.H - HUD) / rows;
  const lanes: LaneLayout[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const inRow = row === rows - 1 ? n - row * perRow : perRow;
    const col = i % perRow;
    const offset = ((perRow - inRow) * laneW) / 2;
    const top = HUD + row * rowH;
    const labelY = Math.round(top + rowH - LABEL);
    const cx = Math.round(offset + (col + 0.5) * laneW);
    lanes.push({
      cx,
      ox: Math.round(cx - VIEW_MID * B * s),
      baseY: Math.round(labelY - KOFFER.VIEW_BOTTOM * B * s),
      laneW,
      labelY,
      top,
    });
  }
  return { s, lanes };
}

interface Sprite {
  img: Phaser.GameObjects.Image;
  item: number;
  x: number;
  y: number;
  a: number;
  tx: number;
  ty: number;
  ta: number;
}

interface LaneView {
  sprites: Map<number, Sprite>;
  name: Phaser.GameObjects.Text;
  info: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Text;
  lostSeq: number;
  key: string;
}

export class KofferScene extends Phaser.Scene {
  private views = new Map<string, LaneView>();
  private geo: { s: number; lanes: LaneLayout[] } | null = null;
  private g!: Phaser.GameObjects.Graphics;
  private fg!: Phaser.GameObjects.Graphics;
  private hatch!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: KofferState | null = null;
  private hudKey = '';
  private cell = 8;
  private closingAt = 0;
  private tinted = false;

  constructor() {
    super('koffer');
  }

  create() {
    this.views.clear();
    this.geo = null;
    this.latest = null;
    this.hudKey = '';
    this.closingAt = 0;
    this.tinted = false;
    this.g = this.add.graphics().setDepth(5);
    this.fg = this.add.graphics().setDepth(12);
    this.hatch = this.add.graphics().setDepth(11);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 110, '', { size: 24, color: GOLD }).setDepth(1001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private build(st: KofferState) {
    const n = st.cars.length;
    const geo = layout(n);
    this.geo = geo;
    const s = geo.s;
    const b = B * s;
    this.cell = Phaser.Math.Clamp(Math.round(b), 4, 16);
    const rows = new Set(geo.lanes.map((l) => l.baseY));
    background(this, `koffer_${n}`, WORLD.W, WORLD.H, (p) => {
      paintSky(p, 0, 0, WORLD.W, WORLD.H, ['#7cc4f0', '#a8dcf5', '#d6effa', '#fbe7bd']);
      p.disc(440, 36, 13, '#fff1b0').disc(440, 36, 10, '#ffe27a');
      for (const baseY of rows) {
        const lane = geo.lanes.find((l) => l.baseY === baseY)!;
        const roadY = Math.round(baseY + 2.6 * b);
        paintRoad(p, roadY, WORLD.W, lane.labelY - roadY);
        p.rect(0, lane.labelY, WORLD.W, LABEL, '#f1d49a').hline(0, lane.labelY, WORLD.W, '#dfb878');
      }
      geo.lanes.forEach((l, i) => {
        paintCar(p, l.ox, l.baseY, b, hex(KOFFER.COLORS[i % KOFFER.COLORS.length]));
        if (l.cx - l.laneW / 2 > 1) for (let y = l.top + 2; y < l.labelY; y += 4) p.px(Math.round(l.cx - l.laneW / 2), y, 'rgba(255,255,255,0.45)');
        p.rect(l.cx - l.laneW / 2 + 2, l.labelY + 2, 3, LABEL - 4, hex(KOFFER.COLORS[i % KOFFER.COLORS.length]));
      });
    });
    geo.lanes.forEach((l, i) => {
      const car = st.cars[i];
      const names = car.owners.map((id) => (playerById(id)?.name ?? '?').replace(/^Bot\s+/, ''));
      const maxChars = Math.max(3, Math.floor((l.laneW - 10) / 8));
      const label = (names.length > 1 ? names.map((x) => x.slice(0, Math.max(2, Math.floor((maxChars - 1) / 2)))).join('+') : names[0]).slice(0, maxChars);
      const name = ink(this, l.cx + 2, l.labelY + 2, label).setDepth(20);
      const info = ink(this, l.cx + 2, l.labelY + 11, '').setDepth(20);
      const badge = txt(this, l.cx, l.top + 8, '', { size: 16, color: GOLD }).setDepth(30);
      this.views.set(car.id, { sprites: new Map(), name, info, badge, lostSeq: car.lostSeq, key: '' });
    });
  }

  private texFor(item: number, v: number) {
    const cell = this.cell;
    return ensureTex(this, `koffer_${item}_${v}_${cell}`, () => kofferPiece(item, v, cell));
  }

  private sprite(view: LaneView, id: number, item: number, v: number, x: number, y: number, a: number): Sprite {
    let sp = view.sprites.get(id);
    if (!sp) {
      const com = kofferCom(item);
      const img = this.add
        .image(0, 0, this.texFor(item, v))
        .setOrigin(com.x / com.cols, com.y / com.rows)
        .setScale((B * this.geo!.s) / this.cell)
        .setDepth(10);
      sp = { img, item, x, y, a, tx: x, ty: y, ta: a };
      view.sprites.set(id, sp);
    }
    sp.tx = x;
    sp.ty = y;
    sp.ta = a;
    return sp;
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'koffer') return;
    const st = gs.mini.state;
    this.latest = st;
    if (!this.geo) this.build(st);
    const geo = this.geo!;
    if (st.sub === 'over' && !this.closingAt) this.closingAt = this.time.now;
    st.cars.forEach((car, i) => {
      const view = this.views.get(car.id);
      const lay = geo.lanes[i];
      if (!view || !lay) return;
      const seen = new Set<number>();
      const p = car.pieces;
      for (let k = 0; k < p.length; k += 6) {
        this.sprite(view, p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5] / 100);
        seen.add(p[k]);
      }
      const a = car.active;
      if (a) {
        this.sprite(view, a.id, a.item, a.v, a.x, a.y, (a.rot * Math.PI) / 2);
        seen.add(a.id);
      }
      for (const [id, sp] of view.sprites) {
        if (seen.has(id)) continue;
        view.sprites.delete(id);
        this.tweens.add({ targets: sp.img, alpha: 0, y: sp.img.y + 12, angle: sp.img.angle + 40, duration: 450, onComplete: () => sp.img.destroy() });
      }
      if (car.lostSeq !== view.lostSeq) {
        view.lostSeq = car.lostSeq;
        const rx = lay.ox + (KOFFER.W + 1.5) * B * geo.s;
        const ry = lay.baseY + 2 * B * geo.s;
        const puff = this.add.circle(rx, ry, 3, 0xdedad0, 0.9).setDepth(15);
        this.tweens.add({ targets: puff, scale: 3, alpha: 0, duration: 500, onComplete: () => puff.destroy() });
        const t = txt(this, rx, lay.baseY - 4 * B * geo.s, 'RUMS!', { color: '#e04a3f' }).setDepth(40);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 900, onComplete: () => t.destroy() });
        this.cameras.main.shake(100, 0.002);
      }
      this.updateLabel(car, view, lay, st);
    });

    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000))));
    else if (st.sub === 'settle' && st.cars.length <= 3) this.banner.setText('Zeit um!');
    else this.banner.setText('');

    // Ergebnis: Teile über dem Dach / hinten raus leicht einfärben (zählen nur halb)
    if (st.sub === 'over' && !this.tinted) {
      this.tinted = true;
      for (const view of this.views.values()) {
        for (const sp of view.sprites.values()) {
          const r = kofferCellsInside(sp.item, sp.tx, sp.ty, sp.ta);
          if (r.outside) sp.img.setTint(0xffd8a0);
        }
      }
    }

    const key = `${Math.ceil(st.endsIn / 1000)}-${st.sub}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hud.removeAll(true);
      this.hud.add(panel(this, 110, 0, 260, 20));
      const sec = Math.ceil(st.endsIn / 1000);
      const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const text =
        st.sub === 'countdown'
          ? 'Alles muss in den Kofferraum!'
          : st.sub === 'play'
            ? sec <= 20
              ? `${time}  Papa hupt! TUUT!`
              : `${time}  Packt den Kofferraum voll!`
            : st.sub === 'settle'
              ? 'Zeit um! Gleich geht die Klappe zu ...'
              : 'Heckklappe zu – Abfahrt!';
      const t = ink(this, WORLD.W / 2, 6, text);
      if (st.sub === 'play' && sec <= 20) t.setColor('#a8342a');
      this.hud.add(t);
    }
  }

  private updateLabel(car: KofferCar, view: LaneView, lay: LaneLayout, st: KofferState) {
    const key = `${car.liters}-${car.pct}-${car.full}-${st.sub}`;
    if (key === view.key) return;
    view.key = key;
    const tiny = lay.laneW < 90;
    view.info.setText(tiny ? `${car.liters}L` : `${car.liters} L · ${car.pct}%`);
    view.badge.setText(st.sub === 'over' ? `${car.liters} L` : car.full ? 'VOLL!' : '');
  }

  /** Fast gerade Teile gerade und pixelgenau zeichnen (wie beim Wackelturm) */
  private place(sp: Sprite, x: number, y: number) {
    const q = Math.round(sp.a / (Math.PI / 2));
    if (Math.abs(sp.a - (q * Math.PI) / 2) > 0.025) {
      sp.img.setPosition(x, y).setRotation(sp.a);
      return;
    }
    const rot = (q * Math.PI) / 2;
    const c = Math.round(Math.cos(rot));
    const sn = Math.round(Math.sin(rot));
    const ox = sp.img.originX * sp.img.displayWidth;
    const oy = sp.img.originY * sp.img.displayHeight;
    const dx = -ox * c + oy * sn;
    const dy = -ox * sn - oy * c;
    sp.img.setPosition(Math.round(x + dx) - dx, Math.round(y + dy) - dy).setRotation(rot);
  }

  /** Fall-Vorschau: blasse Spalten bis zur Landestelle + Umriss dort; fällt es raus, rötlich */
  private drawGuide(a: KofferActive, sp: Sprite, lay: LaneLayout, s: number) {
    const g = this.g;
    const offs = kofferCellOffsets(a.item, (a.rot * Math.PI) / 2);
    const cols = new Map<number, { top: number; bottom: number }>();
    for (const o of offs) {
      const k = Math.round(o.x);
      const c = cols.get(k) ?? { top: Infinity, bottom: -Infinity };
      c.top = Math.min(c.top, o.y);
      c.bottom = Math.max(c.bottom, o.y);
      cols.set(k, c);
    }
    const px = lay.ox + sp.x * s;
    const py = lay.baseY - sp.y * s;
    const gy = a.gy === null ? null : lay.baseY - a.gy * s;
    const out = gy === null;
    const sx = (ox: number, edge: number) => Math.round(px + (ox + edge * (B / 2)) * s);
    for (const [ox, c] of cols) {
      const x0 = sx(ox, -1);
      const x1 = sx(ox, 1);
      const yTop = Math.round(py + (c.bottom + B / 2) * s);
      const yEnd = out ? lay.labelY : Math.round(gy + (c.top - B / 2) * s);
      if (yEnd - yTop < 1) continue;
      g.fillStyle(out ? 0xff6b5a : 0xffffff, out ? 0.18 : 0.16);
      g.fillRect(x0, yTop, x1 - x0, yEnd - yTop);
      g.fillStyle(out ? 0xff6b5a : 0xffffff, out ? 0.3 : 0.26);
      g.fillRect(x0, yTop, 1, yEnd - yTop);
      g.fillRect(x1 - 1, yTop, 1, yEnd - yTop);
    }
    if (!out && !a.rest && gy - py > B * s * 0.5) {
      this.outline(g, offs, (ox, e) => sx(ox, e), (oy, e) => Math.round(gy + (oy + (e * B) / 2) * s), 0.8);
    }
    if (a.rest) {
      const alpha = 0.5 + 0.35 * Math.sin(this.time.now / 60);
      this.outline(this.fg, offs, (ox, e) => sx(ox, e), (oy, e) => Math.round(py + (oy + (e * B) / 2) * s), alpha);
    }
  }

  private outline(g: Phaser.GameObjects.Graphics, offs: { x: number; y: number }[], X: (ox: number, e: number) => number, Y: (oy: number, e: number) => number, alpha: number) {
    const has = (x: number, y: number) => offs.some((o) => Math.abs(o.x - x) < 1 && Math.abs(o.y - y) < 1);
    g.fillStyle(0xffffff, alpha);
    for (const o of offs) {
      const x0 = X(o.x, -1);
      const x1 = X(o.x, 1);
      const y0 = Y(o.y, -1);
      const y1 = Y(o.y, 1);
      if (!has(o.x, o.y - B)) g.fillRect(x0, y0, x1 - x0, 1);
      if (!has(o.x, o.y + B)) g.fillRect(x0, y1 - 1, x1 - x0, 1);
      if (!has(o.x - B, o.y)) g.fillRect(x0, y0, 1, y1 - y0);
      if (!has(o.x + B, o.y)) g.fillRect(x1 - 1, y0, 1, y1 - y0);
    }
  }

  /** Heckklappe am Dach-Scharnier: offen schräg nach oben, beim Ende klappt sie zu */
  private drawHatch(lay: LaneLayout, s: number, color: number, t: number) {
    const b = B * s;
    const hx = lay.ox + KOFFER.W * b;
    const hy = lay.baseY - KOFFER.ROOF * b;
    const ang = HATCH_OPEN + (HATCH_CLOSED - HATCH_OPEN) * t;
    const len = (KOFFER.ROOF - KOFFER.LIP + 0.2) * b;
    const dx = Math.cos(ang);
    const dy = -Math.sin(ang);
    // Normale (nach außen/hinten)
    const nx = -dy;
    const ny = dx;
    const th = Math.max(2, 0.45 * b);
    const pts = (a0: number, a1: number, w0: number, w1: number) => [
      new Phaser.Math.Vector2(hx + dx * a0 + nx * w0, hy + dy * a0 + ny * w0),
      new Phaser.Math.Vector2(hx + dx * a1 + nx * w0, hy + dy * a1 + ny * w0),
      new Phaser.Math.Vector2(hx + dx * a1 + nx * w1, hy + dy * a1 + ny * w1),
      new Phaser.Math.Vector2(hx + dx * a0 + nx * w1, hy + dy * a0 + ny * w1),
    ];
    const h = this.hatch;
    h.fillStyle(0x2d1b12, 1).fillPoints(pts(-1, len + 1, -th / 2 - 1, th / 2 + 1), true);
    h.fillStyle(color, 1).fillPoints(pts(0, len, -th / 2, th / 2), true);
    // Heckscheibe
    h.fillStyle(0x9fd6f0, 0.9).fillPoints(pts(len * 0.08, len * 0.55, -th / 4, th / 4), true);
  }

  update(_t: number, dtMs: number) {
    const st = this.latest;
    const geo = this.geo;
    if (!st || !geo) return;
    const s = geo.s;
    const k = 1 - Math.pow(0.0005, dtMs / 1000);
    this.g.clear();
    this.fg.clear();
    this.hatch.clear();
    const close = this.closingAt ? Phaser.Math.Easing.Bounce.Out(Math.min(1, (this.time.now - this.closingAt) / CLOSE_MS)) : 0;
    st.cars.forEach((car, i) => {
      const view = this.views.get(car.id);
      const lay = geo.lanes[i];
      if (!view || !lay) return;
      for (const sp of view.sprites.values()) {
        sp.x += (sp.tx - sp.x) * k;
        sp.y += (sp.ty - sp.y) * k;
        sp.a += Phaser.Math.Angle.Wrap(sp.ta - sp.a) * k;
        this.place(sp, lay.ox + sp.x * s, lay.baseY - sp.y * s);
      }
      const a = car.active;
      const sp = a && view.sprites.get(a.id);
      if (a && sp && st.sub === 'play') this.drawGuide(a, sp, lay, s);
      this.drawHatch(lay, s, KOFFER.COLORS[i % KOFFER.COLORS.length], close);
    });
  }
}
