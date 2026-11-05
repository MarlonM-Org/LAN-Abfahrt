import Phaser from 'phaser';
import type { GameState, TurmLane, TurmState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { TURM, turmCellOffsets, turmCom } from '../../shared/games';
import { C } from '../art/palette';
import { heart } from '../art/objects';
import { paintSky, paintWater } from '../art/ground';
import { gustStreak, summitCross, turmPiece } from '../art/turm';
import { bus, getState, playerById } from './store';
import { GOLD, background, ensureTex, ink, panel, txt } from './ui';

const B = TURM.BLOCK;
const HUD = 22;
const LABEL = 20;
/** Benötigte Bahnbreite in Blöcken (Plattform + etwas Luft für überstehende Teile) */
const VIEW_W = TURM.PLATFORM_W + 3;
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const meters = (h: number) => `${(h / B).toFixed(1).replace('.', ',')}m`;

interface LaneLayout {
  cx: number;
  /** Bildschirm-y der Plattform-Oberkante */
  baseY: number;
  laneW: number;
  labelY: number;
  top: number;
}

/** Bahnen auf dem TV verteilen: eine oder zwei Reihen – je nachdem, was größer wird. */
function layout(n: number): { s: number; lanes: LaneLayout[] } {
  let best: { s: number; rows: number } = { s: 0, rows: 1 };
  for (const rows of n >= 4 ? [1, 2] : [1]) {
    const perRow = Math.ceil(n / rows);
    const laneW = WORLD.W / perRow;
    const rowH = (WORLD.H - HUD) / rows;
    const s = Math.min((laneW - 6) / (VIEW_W * B), (rowH - LABEL - 4) / ((TURM.VIEW_TOP + TURM.VIEW_BOTTOM) * B));
    if (s > best.s + 0.01) best = { s, rows };
  }
  const { rows } = best;
  // Ganzzahlige Pixel pro Block: Teile werden unskaliert gezeichnet, Kanten benachbarter Teile treffen
  // sich exakt (bei krummen Faktoren entstehen sonst 1-px-Lücken, obwohl die Teile anliegen)
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
    lanes.push({
      cx: Math.round(offset + (col + 0.5) * laneW),
      // Plattform unten verankern – ist die Bahn schmal, bleibt oben mehr Himmel
      baseY: Math.round(labelY - Math.max(10, TURM.VIEW_BOTTOM * B * s)),
      laneW,
      labelY,
      top,
    });
  }
  return { s, lanes };
}

interface Sprite {
  img: Phaser.GameObjects.Image;
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
  hearts: Phaser.GameObjects.Image[];
  badge: Phaser.GameObjects.Text;
  lostSeq: number;
  key: string;
  gustAt: number;
}

export class TurmScene extends Phaser.Scene {
  private views = new Map<string, LaneView>();
  private geo: { s: number; lanes: LaneLayout[] } | null = null;
  private g!: Phaser.GameObjects.Graphics;
  /** Über den Teilen: Umriss des aufgesetzten, noch steuerbaren Teils */
  private fg!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: TurmState | null = null;
  private hudKey = '';
  private cell = 8;

  constructor() {
    super('turm');
  }

  create() {
    this.views.clear();
    this.geo = null;
    this.latest = null;
    this.hudKey = '';
    this.g = this.add.graphics().setDepth(5);
    this.fg = this.add.graphics().setDepth(12);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 110, '', { size: 24, color: GOLD }).setDepth(1001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  /** Hintergrund + Bahnen einmalig aufbauen (abhängig von der Spielerzahl) */
  private build(st: TurmState) {
    const n = st.lanes.length;
    const geo = layout(n);
    this.geo = geo;
    const s = geo.s;
    this.cell = Phaser.Math.Clamp(Math.round(B * s), 4, 16);
    const platW = Math.round(TURM.PLATFORM_W * B * s);
    const rows = new Set(geo.lanes.map((l) => l.baseY));
    background(this, `turm_${n}`, WORLD.W, WORLD.H, (p) => {
      paintSky(p, 0, 0, WORLD.W, WORLD.H, ['#7cc4f0', '#a8dcf5', '#d6effa', '#fbe7bd']);
      p.disc(420, 40, 14, '#fff1b0').disc(420, 40, 11, '#ffe27a');
      for (const baseY of rows) {
        const lane = geo.lanes.find((l) => l.baseY === baseY)!;
        const rowBottom = lane.labelY + LABEL;
        paintWater(p, 0, baseY + 3, WORLD.W, rowBottom - baseY - 3, 900 + baseY);
        for (let x = 0; x < WORLD.W; x += 2) p.px(x, baseY + 3, C.foam);
        // Namensleiste: Sandstreifen
        p.rect(0, lane.labelY, WORLD.W, LABEL, C.sand).hline(0, lane.labelY, WORLD.W, C.sandDark);
      }
      geo.lanes.forEach((l, i) => {
        const x0 = l.cx - platW / 2;
        // Steg: Planke + Pfähle ins Wasser
        p.rect(x0, l.baseY, platW, Math.max(3, Math.round(B * s * 0.6)), C.wood);
        p.hline(x0, l.baseY, platW, C.woodLight).hline(x0, l.baseY + Math.max(3, Math.round(B * s * 0.6)) - 1, platW, C.woodDarker);
        for (const px of [x0 + 1, x0 + platW / 2 - 1, x0 + platW - 3]) p.rect(px, l.baseY + 3, 2, l.labelY - l.baseY - 3, C.woodDark);
        // Ziellinie (gestrichelt)
        const gy = Math.round(l.baseY - TURM.GOAL * B * s);
        const half = Math.round((l.laneW - 8) / 2);
        for (let x = l.cx - half; x < l.cx + half; x += 6) p.rect(x, gy, 3, 1, x % 12 < 6 ? C.red : C.white);
        // Bahn-Trenner
        if (l.cx - l.laneW / 2 > 1) for (let y = l.top + 2; y < l.labelY; y += 4) p.px(Math.round(l.cx - l.laneW / 2), y, 'rgba(255,255,255,0.45)');
        // Farbmarke der Bahn
        p.rect(l.cx - l.laneW / 2 + 2, l.labelY + 2, 3, LABEL - 4, hex(TURM.COLORS[i % TURM.COLORS.length]));
      });
    });
    const crossKey = ensureTex(this, 'summitCross', summitCross);
    geo.lanes.forEach((l, i) => {
      const gy = Math.round(l.baseY - TURM.GOAL * B * s);
      this.add.image(Math.round(l.cx + (l.laneW - 8) / 2 - 6), gy + 1, crossKey).setOrigin(0.5, 1).setScale(s < 0.45 ? 0.5 : 1).setDepth(4);
      const lane = st.lanes[i];
      const p = playerById(lane.id);
      const maxChars = Math.max(3, Math.floor((l.laneW - 10) / 8));
      const name = ink(this, l.cx + 2, l.labelY + 2, (p?.name ?? '?').replace(/^Bot\s+/, '').slice(0, maxChars)).setDepth(20);
      const info = ink(this, l.cx + 2, l.labelY + 11, '').setDepth(20);
      const hearts: Phaser.GameObjects.Image[] = [];
      const badge = txt(this, l.cx, l.top + 8, '', { size: 16, color: GOLD }).setDepth(30);
      this.views.set(lane.id, { sprites: new Map(), name, info, hearts, badge, lostSeq: lane.lostSeq, key: '', gustAt: 0 });
    });
  }

  private texFor(shape: number, v: number) {
    const cell = this.cell;
    return ensureTex(this, `turm_${shape}_${v}_${cell}`, () => turmPiece(shape, v, cell));
  }

  private sprite(view: LaneView, id: number, shape: number, v: number, x: number, y: number, a: number): Sprite {
    let sp = view.sprites.get(id);
    if (!sp) {
      const com = turmCom(shape);
      const img = this.add
        .image(0, 0, this.texFor(shape, v))
        .setOrigin(com.x / com.cols, com.y / com.rows)
        .setScale((B * this.geo!.s) / this.cell)
        .setDepth(10);
      sp = { img, x, y, a, tx: x, ty: y, ta: a };
      view.sprites.set(id, sp);
    }
    sp.tx = x;
    sp.ty = y;
    sp.ta = a;
    return sp;
  }

  private onState(gs: GameState) {
    if (gs.mini?.kind !== 'turm') return;
    const st = gs.mini.state;
    this.latest = st;
    if (!this.geo) this.build(st);
    const geo = this.geo!;
    st.lanes.forEach((lane, i) => {
      const view = this.views.get(lane.id);
      const lay = geo.lanes[i];
      if (!view || !lay) return;
      const seen = new Set<number>();
      const p = lane.pieces;
      for (let k = 0; k < p.length; k += 6) {
        this.sprite(view, p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5] / 100);
        seen.add(p[k]);
      }
      const a = lane.active;
      if (a) {
        this.sprite(view, a.id, a.shape, a.v, a.x, a.y, (a.rot * Math.PI) / 2);
        seen.add(a.id);
      }
      for (const [id, sp] of view.sprites) {
        if (seen.has(id)) continue;
        view.sprites.delete(id);
        this.tweens.add({ targets: sp.img, alpha: 0, y: sp.img.y + 10, duration: 400, onComplete: () => sp.img.destroy() });
      }
      // Teil verloren → Platsch + "-♥"
      if (lane.lostSeq !== view.lostSeq) {
        view.lostSeq = lane.lostSeq;
        const splash = this.add.circle(lay.cx, lay.baseY + 8, 3, 0xeaf8ff, 0.9).setDepth(15);
        this.tweens.add({ targets: splash, scale: 3, alpha: 0, duration: 500, onComplete: () => splash.destroy() });
        const minus = txt(this, lay.cx, lay.baseY - 30, '-1', { color: C.red }).setDepth(40);
        this.tweens.add({ targets: minus, y: minus.y - 18, alpha: 0, duration: 900, onComplete: () => minus.destroy() });
        this.cameras.main.shake(120, 0.002);
      }
      this.updateLabel(lane, view, lay, geo.s);
    });

    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000))));
    else if (st.sub === 'play') this.banner.setText('');
    else this.banner.setText(st.lanes.some((l) => l.place) ? 'Gipfel!' : 'Zeit um!');

    const key = `${Math.ceil(st.endsIn / 1000)}-${Math.ceil(st.gustIn / 1000)}-${st.sub}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hud.removeAll(true);
      this.hud.add(panel(this, 110, 0, 260, 20));
      const sec = Math.ceil(st.endsIn / 1000);
      const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const gust = st.sub === 'play' && st.gustIn < 5000 ? `  Böe in ${Math.ceil(st.gustIn / 1000)}s!` : `  Ziel ${TURM.GOAL} m`;
      this.hud.add(ink(this, WORLD.W / 2, 6, st.sub === 'countdown' ? `Stapelt bis zum Gipfelkreuz!` : `${time}${gust}`));
    }
  }

  private updateLabel(lane: TurmLane, view: LaneView, lay: LaneLayout, s: number) {
    const key = `${lane.lives}-${lane.height}-${lane.place}-${lane.frozen}`;
    if (key === view.key) return;
    view.key = key;
    for (const h of view.hearts) h.destroy();
    view.hearts = [];
    const small = lay.laneW < 90;
    // Sehr schmale Bahnen (ab 11 Spielern): Herzen enger, Höhe ohne Nachkommastelle rechtsbündig
    const tiny = lay.laneW < 60;
    const hk = ensureTex(this, 'heart9', heart);
    for (let k = 0; k < TURM.LIVES; k++) {
      const img = this.add
        .image(lay.cx - lay.laneW / 2 + (tiny ? 5 + k * 5 : 9 + k * (small ? 6 : 10)), lay.labelY + 15, hk)
        .setScale(small ? 0.67 : 1)
        .setAlpha(k < lane.lives ? 1 : 0.25)
        .setDepth(20);
      view.hearts.push(img);
    }
    const heartsW = small ? 20 : 30;
    if (tiny) view.info.setText(lane.place ? `${lane.place}.` : String(Math.round(lane.height / B))).setOrigin(1, 0).setX(lay.cx + lay.laneW / 2 - 2);
    else view.info.setText(lane.place ? `${lane.place}. Platz` : meters(lane.height)).setX(lay.cx - lay.laneW / 2 + 6 + heartsW + (lay.laneW - heartsW - 6) / 2);
    view.badge.setText(lane.place ? `${lane.place}.` : lane.frozen ? 'AUS' : '').setColor(lane.place ? GOLD : '#d6dde6');
    if (lane.frozen) for (const sp of view.sprites.values()) sp.img.setTint(0xb8c4d0);
    void s;
  }

  /**
   * Sprite setzen. Fast gerade Teile (Winkel bis ~1,5° neben einem Vielfachen von 90°) werden gerade
   * und mit der Ecke aufs Pixelraster gezeichnet – so liegen bündige Teile auch optisch ohne Spalt an.
   */
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
    // Linke obere Ecke der Textur relativ zum Drehpunkt (gedreht)
    const dx = -ox * c + oy * sn;
    const dy = -ox * sn - oy * c;
    sp.img.setPosition(Math.round(x + dx) - dx, Math.round(y + dy) - dy).setRotation(rot);
  }

  private drawGuide(a: NonNullable<TurmLane['active']>, sp: Sprite, lay: LaneLayout, s: number) {
    const g = this.g;
    const offs = turmCellOffsets(a.shape, (a.rot * Math.PI) / 2);
    // Zellspalten des Teils (Bildschirm-Offsets, y nach unten)
    const cols = new Map<number, { top: number; bottom: number }>();
    for (const o of offs) {
      const k = Math.round(o.x);
      const c = cols.get(k) ?? { top: Infinity, bottom: -Infinity };
      c.top = Math.min(c.top, o.y);
      c.bottom = Math.max(c.bottom, o.y);
      cols.set(k, c);
    }
    const px = lay.cx + sp.x * s;
    const py = lay.baseY - sp.y * s;
    const gy = a.gy === null ? null : lay.baseY - a.gy * s;
    const sea = gy === null;
    const sx = (ox: number, edge: number) => Math.round(px + (ox + edge * (B / 2)) * s);
    for (const [ox, c] of cols) {
      const x0 = sx(ox, -1);
      const x1 = sx(ox, 1);
      const yTop = Math.round(py + (c.bottom + B / 2) * s);
      const yEnd = sea ? lay.labelY : Math.round(gy + (c.top - B / 2) * s);
      if (yEnd - yTop < 1) continue;
      g.fillStyle(sea ? 0xff6b5a : 0xffffff, sea ? 0.16 : 0.14);
      g.fillRect(x0, yTop, x1 - x0, yEnd - yTop);
      // Kanten der Spalte etwas kräftiger – zum Ausrichten an Nachbarn
      g.fillStyle(sea ? 0xff6b5a : 0xffffff, sea ? 0.3 : 0.24);
      g.fillRect(x0, yTop, 1, yEnd - yTop);
      g.fillRect(x1 - 1, yTop, 1, yEnd - yTop);
    }
    if (!sea && !a.rest && gy - py > B * s * 0.5) {
      for (const o of offs) {
        const x0 = sx(o.x, -1);
        const x1 = sx(o.x, 1);
        g.fillStyle(0xffffff, 0.28).fillRect(x0, Math.round(gy + (o.y - B / 2) * s), x1 - x0, Math.round(gy + (o.y + B / 2) * s) - Math.round(gy + (o.y - B / 2) * s));
      }
      this.outline(g, offs, (ox, e) => sx(ox, e), (oy, e) => Math.round(gy + (oy + (e * B) / 2) * s), 0.75);
    }
    // Aufgesetzt, aber noch steuerbar (Lock-Delay): pulsierender Umriss
    if (a.rest) {
      const alpha = 0.5 + 0.35 * Math.sin(this.time.now / 60);
      this.outline(this.fg, offs, (ox, e) => sx(ox, e), (oy, e) => Math.round(py + (oy + (e * B) / 2) * s), alpha);
    }
  }

  /** Außenkontur einer Form (nur Zellkanten ohne Nachbarzelle), 1 px breit */
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

  update(_t: number, dtMs: number) {
    const st = this.latest;
    const geo = this.geo;
    if (!st || !geo) return;
    const s = geo.s;
    const k = 1 - Math.pow(0.0005, dtMs / 1000);
    const g = this.g;
    g.clear();
    this.fg.clear();
    st.lanes.forEach((lane, i) => {
      const view = this.views.get(lane.id);
      const lay = geo.lanes[i];
      if (!view || !lay) return;
      for (const sp of view.sprites.values()) {
        sp.x += (sp.tx - sp.x) * k;
        sp.y += (sp.ty - sp.y) * k;
        sp.a += Phaser.Math.Angle.Wrap(sp.ta - sp.a) * k;
        this.place(sp, lay.cx + sp.x * s, lay.baseY - sp.y * s);
      }
      // Bestmarke
      const color = TURM.COLORS[i % TURM.COLORS.length];
      if (lane.best > 0) {
        const by = Math.round(lay.baseY - lane.best * s);
        const half = (TURM.PLATFORM_W / 2 + 1) * B * s;
        g.fillStyle(color, 0.9);
        for (let x = lay.cx - half; x < lay.cx + half; x += 4) g.fillRect(Math.round(x), by, 2, 1);
      }
      // Fall-Vorschau (wie der Schatten bei Tricky Towers): blasse Spalten unter jeder Zellspalte bis zur
      // Landestelle + Umriss des Teils dort. Fällt es ins Meer, sind die Spalten rötlich.
      const a = lane.active;
      const sp = a && view.sprites.get(a.id);
      if (a && sp && st.sub === 'play') this.drawGuide(a, sp, lay, s);
      // "Halten!"-Balken
      if (lane.hold > 0 && !lane.place) {
        const w = Math.round((lay.laneW - 16) * lane.hold);
        g.fillStyle(0x2d1b12, 0.8).fillRect(lay.cx - (lay.laneW - 16) / 2 - 1, lay.top + 3, lay.laneW - 14, 5);
        g.fillStyle(0xffd25e, 1).fillRect(lay.cx - (lay.laneW - 16) / 2, lay.top + 4, w, 3);
      }
      // Windböe
      if (lane.gust && this.time.now - view.gustAt > 140) {
        view.gustAt = this.time.now;
        const y = lay.top + 10 + Math.random() * (lay.baseY - lay.top - 20);
        const x0 = lay.cx - (lane.gust * lay.laneW) / 2;
        const streak = this.add.image(x0, y, ensureTex(this, 'gustStreak', gustStreak)).setFlipX(lane.gust < 0).setDepth(25).setAlpha(0.9);
        this.tweens.add({ targets: streak, x: x0 + lane.gust * lay.laneW * 0.9, alpha: 0, duration: 650, onComplete: () => streak.destroy() });
      }
    });
  }
}
