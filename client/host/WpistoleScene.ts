import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { WP, type WpDuel, type WpSide, type WpistoleState, wpSec, wpTargetAt } from '../../shared/wpistole';
import { C } from '../art/palette';
import { bucket, waterPistol } from '../art/garden';
import { gnome, paintWpGarden, sheriffStar } from '../art/wpistole';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { GOLD, LIGHT, RED_INK, ensureTex, ink, panel, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const short = (name: string) => name.replace(/^Bot\s+/, '').slice(0, 8);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bahnen-Aufteilung auf dem TV: n Duelle untereinander, je zwei Zielkästen (links Seite a, rechts Seite b) */
export function wpLayout(n: number) {
  const top = 36;
  const bottom = 266;
  const L = n <= 1 ? 150 : Math.min(76, (bottom - top) / n);
  const s = n <= 1 ? 2.2 : Math.min(1.6, (L - 6) / WP.BOX_H);
  const y0 = top + (bottom - top - L * n) / 2;
  const bw = WP.BOX_W * s;
  const bh = WP.BOX_H * s;
  return {
    s,
    L,
    lanes: Array.from({ length: n }, (_, i) => {
      const y = y0 + i * L;
      const by = Math.round(y + (L - bh) / 2);
      const left: Box = { x: 22, y: by, w: Math.round(bw), h: Math.round(bh) };
      const right: Box = { x: Math.round(458 - bw), y: by, w: Math.round(bw), h: Math.round(bh) };
      return { y, h: L, left, right, boxes: [left, right] };
    }),
  };
}

interface SideView {
  fig: Phaser.GameObjects.Image;
  gun: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  box: Box;
  /** Gegnerischer Kasten (dorthin wird gezielt) */
  target: Box;
  left: boolean;
  dripAt: number;
  foulSeen: boolean;
}

interface LaneView {
  a: SideView;
  b: SideView;
  note: Phaser.GameObjects.Text;
  /** Szenen-Zeit, ab der das Duell eingefroren ist */
  freezeT: number | null;
}

/** Wasserpistolen-Duell auf dem TV: alle Duelle einer Runde als Bahnen untereinander */
export class WpistoleScene extends Phaser.Scene {
  private latest: WpistoleState | null = null;
  private bg: Phaser.GameObjects.Image | null = null;
  private bgN = 0;
  private lanes: LaneView[] = [];
  private laneKey = '';
  private layout = wpLayout(1);
  private fx!: Phaser.GameObjects.Graphics;
  private header!: Phaser.GameObjects.Container;
  private headerKey = '';
  private overlay!: Phaser.GameObjects.Container;
  private overlayKey = '';
  private callBox!: Phaser.GameObjects.Container;
  private callText!: Phaser.GameObjects.Text;
  private lastCallSeq = 0;
  private drawSeq = 0;
  private drawLocal = 0;
  private lastShot = 0;

  constructor() {
    super('wpistole');
  }

  create() {
    this.latest = null;
    this.bg = null;
    this.bgN = 0;
    this.lanes = [];
    this.laneKey = '';
    this.headerKey = '';
    this.overlayKey = '';
    this.lastCallSeq = 0;
    this.drawSeq = 0;
    this.drawLocal = 0;
    this.lastShot = 0;

    this.fx = this.add.graphics().setDepth(500);
    this.header = this.add.container(0, 0).setDepth(900);
    this.overlay = this.add.container(0, 0).setDepth(1500);
    this.callBox = this.add.container(WORLD.W / 2, 124).setDepth(2000).setVisible(false);
    this.callBox.add(this.add.rectangle(0, 0, 340, 56, 0x2d1b12, 0.82).setStrokeStyle(2, 0xffd25e));
    this.callText = txt(this, 0, 0, '', { size: 24, color: GOLD, origin: [0.5, 0.5] });
    this.callBox.add(this.callText);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'wpistole') return;
    const st = s.mini.state;
    this.latest = st;
    const now = this.time.now;

    // Hintergrund mit passender Bahnenzahl
    const n = st.duels.length || (st.final ? 1 : Math.ceil(Object.keys(st.players).length / 2));
    if (n !== this.bgN) {
      this.bgN = n;
      this.layout = wpLayout(n);
      this.bg?.destroy();
      const lay = this.layout;
      const key = ensureTex(this, `bg_wp_${n}`, () => {
        const p = new Pix(WORLD.W, WORLD.H);
        paintWpGarden(p, lay.lanes);
        return p;
      });
      this.bg = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-1000);
    }

    // „ZIEHT!“ – lokale Uhr für die Ausweich-Bahnen
    if (st.drawSeq !== this.drawSeq) {
      this.drawSeq = st.drawSeq;
      if (st.sub === 'draw') this.drawLocal = now;
    }

    // Bahnen neu aufbauen, wenn eine neue Runde beginnt
    const lk = `${st.final}-${st.round}-${st.duels.length}`;
    if (lk !== this.laneKey) {
      this.laneKey = lk;
      this.buildLanes(st);
    }
    st.duels.forEach((d, i) => this.updateLane(st, d, this.lanes[i], now));

    // Schüsse
    for (const sh of st.shots) {
      if (sh.seq <= this.lastShot) continue;
      this.lastShot = sh.seq;
      const lane = this.lanes[sh.duel];
      if (lane) this.squirt(lane[sh.from], sh.x, sh.y, sh.hit, st.players[st.duels[sh.duel][sh.from].id]?.color ?? 0x93d3f3);
    }

    // Ruf
    if (st.callSeq !== this.lastCallSeq) {
      this.lastCallSeq = st.callSeq;
      if (st.call) this.showCall(st.call, st.callReal);
    }

    this.updateHeader(st);
    this.updateOverlay(st);
  }

  private buildLanes(st: WpistoleState) {
    for (const l of this.lanes) {
      for (const sv of [l.a, l.b]) [sv.fig, sv.gun, sv.name, sv.status].forEach((o) => o.destroy());
      l.note.destroy();
    }
    this.lanes = [];
    this.lastShot = Math.max(this.lastShot, ...st.shots.map((x) => x.seq), 0);
    const { s, lanes } = this.layout;
    st.duels.forEach((d, i) => {
      const lay = lanes[i];
      if (!lay) return;
      const mk = (side: WpSide, left: boolean): SideView => {
        const box = left ? lay.left : lay.right;
        const target = left ? lay.right : lay.left;
        const pl = playerById(side.id);
        const tex = side.id === WP.GNOME_ID ? ensureTex(this, 'wp_gnome', gnome) : pl ? ensureAvatar(this, pl.look) : ensureTex(this, 'wp_gnome', gnome);
        const fig = this.add.image(0, 0, tex).setOrigin(0.5, 15 / 27).setScale(s).setDepth(box.y + 10);
        const gun = this.add.image(0, 0, ensureTex(this, 'wp_pistol', waterPistol)).setScale(Math.max(0.6, s * 0.7)).setFlipX(!left).setDepth(box.y + 11);
        const col = side.id === WP.GNOME_ID ? '#ffd25e' : hex(st.players[side.id]?.color ?? 0xffffff);
        const nm = side.id === WP.GNOME_ID ? 'Gustav' : short(pl?.name ?? '?');
        const midTop = lay.y + lay.h / 2 - (s >= 1.4 ? 14 : 9);
        const nx = left ? box.x + box.w + 6 : box.x - 6;
        const name = txt(this, nx, midTop, nm, { color: col, origin: [left ? 0 : 1, 0.5] }).setDepth(600);
        const status = txt(this, nx, midTop + (s >= 1.4 ? 14 : 10), '', { color: LIGHT, origin: [left ? 0 : 1, 0.5] }).setDepth(600).setScale(s >= 1.4 ? 1 : 0.75);
        return { fig, gun, name, status, box, target, left, dripAt: 0, foulSeen: false };
      };
      const note = txt(this, WORLD.W / 2, lay.y + lay.h / 2 + (s >= 1.4 ? 24 : 0), '', { color: GOLD, origin: [0.5, 0.5] }).setDepth(600);
      if (this.layout.lanes.length === 1) note.setY(lay.y + lay.h - 12);
      this.lanes.push({ a: mk(d.a, true), b: mk(d.b, false), note, freezeT: null });
    });
  }

  private updateLane(st: WpistoleState, d: WpDuel, lane: LaneView | undefined, now: number) {
    if (!lane) return;
    if (d.done && lane.freezeT === null) lane.freezeT = st.sub === 'draw' ? now - this.drawLocal : 0;
    for (const [side, sv] of [
      [d.a, lane.a],
      [d.b, lane.b],
    ] as const) {
      let status = '';
      let color = LIGHT;
      if (side.foul) {
        status = 'FRÜHSTART!';
        color = '#ff8a7a';
      } else if (st.sub === 'arm') {
        status = side.armed ? 'bereit' : 'Holster?';
        color = side.armed ? '#b6e05a' : LIGHT;
      } else if (st.sub === 'wait') status = side.armed ? '...' : '';
      else if (side.hitMs !== null && (st.sub === 'result' || d.done)) {
        status = d.winner === side.id ? `SIEG ${wpSec(side.hitMs)}` : `Treffer ${wpSec(side.hitMs)}`;
        color = GOLD;
      } else if (d.done && d.winner && d.winner !== side.id) {
        status = 'nass!';
        color = '#9fe0ff';
      } else if (side.drawMs !== null) status = `gezogen ${wpSec(side.drawMs)}`;
      sv.status.setText(status).setColor(color);
      const p = st.players[side.id];
      const wins = st.final ? p?.fw : p?.wins;
      const base = side.id === WP.GNOME_ID ? 'Gustav' : short(playerById(side.id)?.name ?? '?');
      sv.name.setText(wins !== undefined && side.id !== WP.GNOME_ID ? (sv.left ? `${base} [${wins}]` : `[${wins}] ${base}`) : base);
      // Frühstart: Eimer Wasser von oben
      if (side.foul && !sv.foulSeen) {
        sv.foulSeen = true;
        this.bucketDump(sv);
      }
    }
    lane.note.setText(d.done ? d.note : '');
  }

  // ---------------------------------------------------------------- Effekte

  private sidePos(sv: SideView, side: WpSide, t: number) {
    const c = wpTargetAt(side.path, t);
    const s = this.layout.s;
    return { x: sv.box.x + c.x * s, y: sv.box.y + c.y * s };
  }

  private squirt(sv: SideView, x: number, y: number, hit: boolean, color: number) {
    const s = this.layout.s;
    const tx = sv.target.x + x * s;
    const ty = sv.target.y + y * s;
    const fx = sv.gun.x + (sv.left ? 6 : -6) * s;
    const fy = sv.gun.y - 2 * s;
    // Wasserstrahl: Tropfenkette im Bogen
    const n = 12;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const d = this.add.rectangle(fx, fy, 3, 3, i % 3 ? 0x93d3f3 : 0xeaf8ff).setDepth(700);
      this.tweens.add({
        targets: d,
        x: fx + (tx - fx) * k,
        y: fy + (ty - fy) * k - Math.sin(Math.PI * k) * 10,
        duration: 140 + k * 60,
        onComplete: () => this.tweens.add({ targets: d, alpha: 0, duration: 200, onComplete: () => d.destroy() }),
      });
    }
    this.time.delayedCall(200, () => {
      const ring = this.add.ellipse(tx, ty, 4, 3, hit ? 0xeaf8ff : 0x93d3f3, 0.9).setDepth(710);
      this.tweens.add({ targets: ring, displayWidth: hit ? 26 * s : 14 * s, displayHeight: hit ? 16 * s : 8 * s, alpha: 0, duration: 380, onComplete: () => ring.destroy() });
      for (let i = 0; i < (hit ? 10 : 5); i++) {
        const a = Math.random() * Math.PI * 2;
        const dr = this.add.rectangle(tx, ty, 2, 2, i % 3 === 0 ? color : 0xeaf8ff).setDepth(711);
        this.tweens.add({ targets: dr, x: tx + Math.cos(a) * 12 * s, y: ty + Math.sin(a) * 8 * s + 6, alpha: 0, duration: 420, onComplete: () => dr.destroy() });
      }
      if (hit) {
        const t = txt(this, tx, ty - 14 * s, 'PLATSCH!', { color: '#9fe0ff' }).setDepth(720);
        this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, delay: 300, duration: 800, onComplete: () => t.destroy() });
      }
    });
  }

  private bucketDump(sv: SideView) {
    const s = Math.max(1, this.layout.s);
    const b = this.add.image(sv.fig.x, sv.box.y - 20, ensureTex(this, 'wp_bucket', () => bucket(C.blue))).setScale(s).setDepth(800);
    this.tweens.add({
      targets: b,
      y: sv.fig.y - 18 * this.layout.s,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.tweens.add({ targets: b, angle: sv.left ? 140 : -140, duration: 180 });
        for (let i = 0; i < 14; i++) {
          const dr = this.add.rectangle(sv.fig.x - 8 + Math.random() * 16, b.y + 4, 2, 3, 0x93d3f3).setDepth(801);
          this.tweens.add({ targets: dr, y: sv.fig.y + 12 * this.layout.s, alpha: 0, delay: 120 + i * 20, duration: 320, onComplete: () => dr.destroy() });
        }
        this.tweens.add({ targets: b, alpha: 0, delay: 900, duration: 400, onComplete: () => b.destroy() });
      },
    });
  }

  private showCall(text: string, real: boolean) {
    this.tweens.killTweensOf(this.callBox);
    this.callBox.setVisible(true).setAlpha(1).setScale(real ? 0.4 : 1).setAngle(real ? 0 : -3);
    this.callText.setText(text).setColor(real ? GOLD : '#ffffff').setScale(text.length > 10 ? 0.66 : 1);
    if (real) {
      this.tweens.add({ targets: this.callBox, scale: 1, duration: 140, ease: 'Back.easeOut' });
      this.tweens.add({ targets: this.callBox, alpha: 0, delay: 900, duration: 300, onComplete: () => this.callBox.setVisible(false) });
      this.cameras.main.shake(120, 0.004);
    } else {
      this.tweens.add({ targets: this.callBox, alpha: 0, delay: WP.FAKE_MS - 150, duration: 150, onComplete: () => this.callBox.setVisible(false) });
    }
  }

  private updateHeader(st: WpistoleState) {
    let title = '';
    let sub = '';
    if (st.final && st.finalists.length === 2) {
      const [a, b] = st.finalists;
      const na = short(playerById(a)?.name ?? '?');
      const nb = short(playerById(b)?.name ?? '?');
      title = `${st.rounds ? 'FINALE' : 'DUELL'}  ${na} ${st.players[a]?.fw ?? 0} : ${st.players[b]?.fw ?? 0} ${nb}`;
      sub = `wer zuerst ${st.finalTo} Duelle gewinnt`;
    } else if (st.sub !== 'intro') {
      title = `Vorrunde ${st.round}/${st.rounds}`;
      sub = 'die besten zwei kommen ins Finale';
    } else title = 'Wasserpistolen-Duell';
    const hint = st.sub === 'arm' ? 'Hand ans Holster!' : st.sub === 'wait' ? 'Ruhig bleiben ...' : st.sub === 'draw' ? 'ZIEHT!' : sub;
    const key = `${title}|${hint}`;
    if (key === this.headerKey) return;
    this.headerKey = key;
    this.header.removeAll(true);
    this.header.add(panel(this, 90, 1, 300, 30));
    this.header.add(ink(this, WORLD.W / 2, 7, title));
    this.header.add(ink(this, WORLD.W / 2, 18, hint, { color: st.sub === 'draw' ? RED_INK : undefined }).setScale(0.75));
  }

  private updateOverlay(st: WpistoleState) {
    const key = st.sub === 'intro' ? 'intro' : st.sub === 'table' ? `table-${st.finalists.join()}` : st.sub === 'over' ? 'over' : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.removeAll(true);
    if (!key) return;
    if (st.sub === 'intro') {
      this.overlay.add(panel(this, 40, 44, 400, 196, 'dark'));
      this.overlay.add(txt(this, WORLD.W / 2, 56, 'HIGH NOON IM GARTEN', { size: 16, color: GOLD }));
      const lines = [
        'Hand ans Holster: Handy mit der Oberkante',
        'nach unten halten – oder den Knopf halten.',
        '',
        'Erst bei ZIEHT! ziehen (nicht bei ZIEGE!).',
        'Frühstart = Eimer Wasser über den Kopf!',
        '',
        'Dann auf den tänzelnden Gegner zielen',
        'und spritzen – 3 Spritzer pro Duell.',
        '',
        st.rounds ? `${st.rounds} Runden Vorrunde, dann Finale bis ${st.finalTo} Siege.` : `Wer zuerst ${st.finalTo} Duelle gewinnt!`,
      ];
      this.overlay.add(txt(this, WORLD.W / 2, 84, lines.join('\n'), { color: LIGHT }).setLineSpacing(2));
      return;
    }
    if (st.sub === 'table') {
      this.overlay.add(panel(this, 90, 40, 300, 222));
      this.overlay.add(ink(this, WORLD.W / 2, 50, 'Zwischenstand', { size: 16 }));
      const ids = Object.keys(st.players).sort((a, b) => {
        const fa = st.finalists.indexOf(a);
        const fb = st.finalists.indexOf(b);
        if (fa >= 0 || fb >= 0) return (fa < 0 ? 9 : fa) - (fb < 0 ? 9 : fb);
        const pa = st.players[a];
        const pb = st.players[b];
        return pb.wins - pa.wins || (pa.best ?? 99999) - (pb.best ?? 99999);
      });
      ids.slice(0, 12).forEach((id, i) => {
        const p = st.players[id];
        const y = 74 + i * 15;
        const fin = st.finalists.includes(id);
        this.overlay.add(ink(this, 104, y, `${i + 1}. ${short(playerById(id)?.name ?? '?')}`, { origin: [0, 0], color: fin ? RED_INK : undefined }));
        this.overlay.add(ink(this, 300, y, `${p.wins} S`, { origin: [1, 0] }));
        this.overlay.add(ink(this, 376, y, wpSec(p.best), { origin: [1, 0] }));
      });
      this.overlay.add(this.add.image(WORLD.W / 2 - 112, 57, ensureTex(this, 'wp_star', sheriffStar)));
      this.overlay.add(this.add.image(WORLD.W / 2 + 112, 57, ensureTex(this, 'wp_star', sheriffStar)));
      return;
    }
    // Ende
    const [a, b] = st.finalists;
    const pa = st.players[a];
    const pb = st.players[b];
    const champ = pa && pb ? (pa.fw >= pb.fw ? a : b) : a;
    this.overlay.add(this.add.rectangle(WORLD.W / 2, 128, 360, 60, 0x2d1b12, 0.85).setStrokeStyle(2, 0xffd25e));
    this.overlay.add(this.add.image(WORLD.W / 2 - 150, 128, ensureTex(this, 'wp_star', sheriffStar)).setScale(2));
    this.overlay.add(this.add.image(WORLD.W / 2 + 150, 128, ensureTex(this, 'wp_star', sheriffStar)).setScale(2));
    this.overlay.add(txt(this, WORLD.W / 2, 112, `${short(playerById(champ)?.name ?? '?')}`, { size: 16, color: GOLD }));
    this.overlay.add(txt(this, WORLD.W / 2, 136, 'schnellster Spritzer im Garten!', { color: LIGHT }));
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    const s = this.layout.s;
    const g = this.fx;
    g.clear();
    st.duels.forEach((d, i) => {
      const lane = this.lanes[i];
      if (!lane) return;
      const t = st.sub === 'draw' && lane.freezeT === null ? now - this.drawLocal : lane.freezeT ?? 0;
      for (const [side, sv] of [
        [d.a, lane.a],
        [d.b, lane.b],
      ] as const) {
        const pos = this.sidePos(sv, side, t);
        // Leichtes Wippen beim Warten (Western-Anspannung)
        const bob = st.sub === 'wait' || st.sub === 'arm' ? Math.round(Math.sin(now / 160 + i) * 0.6) : 0;
        sv.fig.setPosition(Math.round(pos.x), Math.round(pos.y + bob));
        const drawn = side.drawMs !== null || side.hitMs !== null || (st.sub === 'draw' && side.id === WP.GNOME_ID && now - this.drawLocal > 300);
        sv.gun.setPosition(sv.fig.x + (sv.left ? 7 : -7) * s, sv.fig.y + (drawn ? -1 : 5) * s);
        sv.gun.setAngle(drawn ? 0 : sv.left ? 80 : -80);
        // Nass = bläulich + Tropfen
        if (side.wet) {
          sv.fig.setTint(0x8fc4ff);
          if (now > sv.dripAt) {
            sv.dripAt = now + 130;
            const dr = this.add.rectangle(sv.fig.x - 5 * s + Math.random() * 10 * s, sv.fig.y - 4 * s + Math.random() * 8 * s, 1, 2, 0x93d3f3).setDepth(sv.fig.depth + 2);
            this.tweens.add({ targets: dr, y: dr.y + 8 * s, alpha: 0, duration: 380, onComplete: () => dr.destroy() });
          }
        } else sv.fig.clearTint();
        sv.fig.setAlpha(d.done && d.winner && d.winner !== side.id && !side.wet ? 0.8 : 1);

        // Wassertank: 3 Tropfen unter dem Kasten
        const tankX = sv.box.x + (sv.left ? 2 : sv.box.w - 14);
        for (let k = 0; k < WP.SHOTS; k++) {
          g.fillStyle(0x2d1b12, 1).fillRect(tankX + k * 5, sv.box.y + sv.box.h + 2, 4, 4);
          g.fillStyle(k < WP.SHOTS - side.shots ? 0x3f8fe0 : 0x7a5a3a, 1).fillRect(tankX + k * 5 + 1, sv.box.y + sv.box.h + 3, 2, 2);
        }

        // Fadenkreuz (Bewegungssensor) im gegnerischen Kasten
        if (side.aim && st.sub === 'draw' && !d.done) {
          const col = st.players[side.id]?.color ?? 0xffffff;
          const ax = sv.target.x + side.aim.x * s;
          const ay = sv.target.y + side.aim.y * s;
          const r = Math.max(3, WP.HIT_R_MOTION * s * 0.7);
          g.lineStyle(3, 0x2d1b12, 0.9).strokeCircle(ax, ay, r);
          g.lineStyle(1, col, 1).strokeCircle(ax, ay, r);
          g.fillStyle(col, 1).fillRect(ax - 1, ay - 1, 2, 2);
        }
      }
    });
  }
}
