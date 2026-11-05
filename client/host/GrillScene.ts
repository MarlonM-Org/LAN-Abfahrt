import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { TEAM_INFO, WORLD } from '../../shared/flunky';
import {
  GRILL as G,
  GRILL_INGS,
  GRILL_RECIPES,
  type GrillItem,
  type GrillKitchen,
  type GrillOrder,
  type GrillState,
  canChop,
  grillGrid,
  newBase,
  tileCenter,
} from '../../shared/grill';
import { C } from '../art/palette';
import { flameIcon, grillIngPix, grillItemKey, grillItemPix, knifeIcon, paintGrillGarden, smokePuff, starPix } from '../art/grill';
import { bus, getState, playerById } from './store';
import { figure, playAvatar } from './textures';
import { BLUE_INK, INK, background, ensureTex, ink, panel, txt } from './ui';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const SUN_INK = '#b06d00';
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const TICKET_W = 74;
const TICKET_H = 56;
const TICKET_Y = 32;

interface Fig {
  f: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  held: Phaser.GameObjects.Image;
  heldKey: string;
  x: number;
  y: number;
  no: number;
}

interface Ticket {
  o: GrillOrder;
  recv: number;
  bar: Phaser.GameObjects.Graphics;
  x: number;
}

export class GrillScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private slotImgs = new Map<string, { img: Phaser.GameObjects.Image; key: string }>();
  private tickets: Ticket[][] = [];
  private ticketLayers: Phaser.GameObjects.Container[] = [];
  private ticketKeys: string[] = [];
  private seenEvents = new Set<number>();
  private fxAt = new Map<string, number>();
  private serveFloats: number[] = [];
  private bars!: Phaser.GameObjects.Graphics;
  private hi!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private help!: Phaser.GameObjects.Text;
  private helpBg!: Phaser.GameObjects.Image;
  private overLayer!: Phaser.GameObjects.Container;
  private latest: GrillState | null = null;
  private hudKey = '';
  private built = false;
  private overShown = false;

  constructor() {
    super('grill');
  }

  create() {
    this.figs.clear();
    this.slotImgs.clear();
    this.tickets = [];
    this.ticketLayers = [];
    this.ticketKeys = [];
    this.seenEvents.clear();
    this.fxAt.clear();
    this.serveFloats = [];
    this.latest = null;
    this.hudKey = '';
    this.built = false;
    this.overShown = false;

    this.bars = this.add.graphics().setDepth(960);
    this.hi = this.add.graphics().setDepth(940);
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.banner = txt(this, WORLD.W / 2, 104, '', { size: 24, color: C.gold }).setDepth(1101);
    this.helpBg = panel(this, 60, 96, 360, 124, 'dark').setDepth(1100).setVisible(false);
    this.help = txt(this, WORLD.W / 2, 132, '', { color: C.white, wrap: 340 }).setDepth(1101);
    this.overLayer = this.add.container(0, 0).setDepth(1200);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Aufbau

  private build(st: GrillState) {
    this.built = true;
    const ks = st.kitchens.map((k) => ({ x0: k.x0, y0: k.y0, grid: grillGrid(k.layout, k.mirror), color: k.team ? TEAM_INFO[k.team].color : null }));
    const bgKey = `grillgarden_${st.kitchens.map((k) => `${k.layout}${k.mirror ? 'm' : ''}${k.x0}`).join('_')}`;
    background(this, bgKey, WORLD.W, WORLD.H, (p) => paintGrillGarden(p, ks, WORLD.W, WORLD.H));
    // Ausgabe-Schilder unter den Theken
    for (const k of ks) {
      const serve = k.grid[k.grid.length - 1];
      const cs = [...serve].map((ch, c) => (ch === 'S' ? c : -1)).filter((c) => c >= 0);
      if (cs.length) {
        const cx = k.x0 + ((cs[0] + cs[cs.length - 1] + 1) / 2) * G.TILE;
        txt(this, cx, k.y0 + k.grid.length * G.TILE + 1, 'AUSGABE', { color: C.gold }).setDepth(5);
      }
    }
    for (let i = 0; i < st.kitchens.length; i++) {
      this.ticketLayers.push(this.add.container(0, 0).setDepth(800));
      this.tickets.push([]);
      this.ticketKeys.push('');
    }
  }

  private ticketRegion(st: GrillState, k: number) {
    if (st.kitchens.length === 1) return { x: 6, w: WORLD.W - 12 };
    const kit = st.kitchens[k];
    return { x: kit.x0, w: grillGrid(kit.layout, kit.mirror)[0].length * G.TILE };
  }

  private buildTickets(st: GrillState, ki: number) {
    const layer = this.ticketLayers[ki];
    layer.removeAll(true);
    const list: Ticket[] = [];
    const reg = this.ticketRegion(st, ki);
    const kit = st.kitchens[ki];
    const now = this.time.now;
    kit.orders.forEach((o, i) => {
      const x = reg.x + 2 + i * (TICKET_W + 4);
      if (x + TICKET_W > reg.x + reg.w + 2) return;
      const R = GRILL_RECIPES[o.r];
      layer.add(panel(this, x, TICKET_Y, TICKET_W, TICKET_H));
      const dish: GrillItem = { ...newBase(R.base), p: R.parts.map((t) => ({ t, s: GRILL_INGS[t].path[GRILL_INGS[t].path.length - 1] })) };
      const key = ensureTex(this, `gt_${grillItemKey(dish)}`, () => grillItemPix(dish));
      layer.add(this.add.image(x + 6, TICKET_Y + 5, key).setOrigin(0, 0));
      layer.add(ink(this, x + TICKET_W - 6, TICKET_Y + 8, String(R.points), { color: '#7a5a3a', origin: [1, 0] }));
      // Zutaten + Arbeitsschritte
      R.parts.forEach((t, j) => {
        const ix = x + 7 + j * 21;
        const iy = TICKET_Y + 28;
        layer.add(this.add.image(ix, iy, ensureTex(this, `gi_${t}_raw`, () => grillIngPix(t, 'raw'))).setOrigin(0, 0));
        const steps = GRILL_INGS[t].path.slice(1);
        steps.forEach((s, n) => {
          const k = s === 'chop' ? ensureTex(this, 'g_knife', knifeIcon) : ensureTex(this, 'g_flame', flameIcon);
          layer.add(this.add.image(ix + 10, iy - 2 + n * 9, k).setOrigin(0, 0));
        });
      });
      const bar = this.add.graphics();
      layer.add(bar);
      list.push({ o, recv: now, bar, x });
    });
    this.tickets[ki] = list;
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'grill') return;
    const st = s.mini.state;
    this.latest = st;
    if (!this.built) this.build(st);

    // Figuren
    for (const [id, p] of Object.entries(st.players)) {
      if (this.figs.has(id)) continue;
      const pl = playerById(id);
      if (!pl) continue;
      const f = figure(this, pl.look, p.x, p.y);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      const tag = txt(this, 0, -38, pl.name.replace(/^Bot\s+/, '').slice(0, 6), { color: hex(p.c) });
      const held = this.add.image(0, -9, '__DEFAULT').setVisible(false);
      f.add([tag, held]);
      this.figs.set(id, { f, img, held, heldKey: '', x: p.x, y: p.y, no: p.no });
    }

    // Gegenstände auf Stationen
    const alive = new Set<string>();
    st.kitchens.forEach((k, ki) => {
      for (const sl of k.slots) {
        if (!sl.i) continue;
        const id = `${ki}:${sl.c},${sl.r}`;
        alive.add(id);
        const key = grillItemKey(sl.i);
        const tex = ensureTex(this, key, () => grillItemPix(sl.i!));
        const cur = this.slotImgs.get(id);
        const c = tileCenter(k, sl.c, sl.r);
        if (cur) {
          if (cur.key !== key) {
            cur.img.setTexture(tex);
            cur.key = key;
          }
        } else {
          const img = this.add.image(c.x, c.y + 5, tex).setOrigin(0.5, 1).setDepth(c.y + 9);
          this.slotImgs.set(id, { img, key });
        }
      }
    });
    for (const [id, v] of this.slotImgs) {
      if (alive.has(id)) continue;
      v.img.destroy();
      this.slotImgs.delete(id);
    }

    // Bestellzettel
    st.kitchens.forEach((k, ki) => {
      const key = k.orders.map((o) => o.id).join(',');
      if (key !== this.ticketKeys[ki]) {
        this.ticketKeys[ki] = key;
        this.buildTickets(st, ki);
      } else {
        const now = this.time.now;
        for (const t of this.tickets[ki]) {
          const o = k.orders.find((x) => x.id === t.o.id);
          if (o) {
            t.o = o;
            t.recv = now;
          }
        }
      }
    });

    // Ereignisse
    for (const e of st.events) {
      if (this.seenEvents.has(e.seq)) continue;
      this.seenEvents.add(e.seq);
      this.showEvent(st, e);
    }

    // Banner / Hilfe
    this.helpBg.setVisible(st.sub === 'countdown');
    if (st.sub === 'countdown') {
      this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000)))).setY(100);
      this.help.setText(
        `${st.teams ? 'Team Sonne gegen Team Meer – wer serviert mehr?' : 'Kocht zusammen für die Grillparty!'}\n` +
          'Joystick: laufen · NEHMEN: aufheben/ablegen\nAKTION halten: schneiden / löschen\n' +
          'Zettel oben = Bestellungen. Nicht anbrennen lassen!',
      );
    } else {
      this.banner.setText('');
      this.help.setText('');
    }
    if (st.sub === 'over' && !this.overShown) this.showOver(st);

    // HUD
    const key = JSON.stringify([Math.ceil(st.endsIn / 1000), st.kitchens.map((k) => k.score)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 120, 1, 240, 26));
    if (st.teams) {
      this.hud.add(ink(this, 132, 10, `Sonne ${st.kitchens[0].score}`, { color: SUN_INK, origin: [0, 0] }));
      this.hud.add(ink(this, WORLD.W / 2, 10, mmss(st.endsIn)));
      this.hud.add(ink(this, 348, 10, `${st.kitchens[1].score} Meer`, { color: BLUE_INK, origin: [1, 0] }));
    } else {
      const sc = st.kitchens[0].score;
      this.hud.add(ink(this, 132, 10, `${sc} Pkt`, { origin: [0, 0] }));
      this.hud.add(ink(this, 222, 10, mmss(st.endsIn)));
      st.goals.forEach((g, i) => {
        const on = sc >= g;
        this.hud.add(this.add.image(266 + i * 18, 13, ensureTex(this, `g_star_${on}`, () => starPix(on))));
      });
      const next = st.goals.find((g) => sc < g);
      if (next) this.hud.add(ink(this, 350, 10, String(next), { color: '#7a5a3a', origin: [1, 0] }));
    }
  }

  private float(x: number, y: number, text: string, color: string, scale = 1, life = 1200) {
    const t = txt(this, x, y, text, { color }).setDepth(1050).setScale(scale);
    this.tweens.add({ targets: t, y: y - 16, alpha: 0, delay: life * 0.4, duration: life * 0.6, onComplete: () => t.destroy() });
  }

  private showEvent(st: GrillState, e: GrillState['events'][number]) {
    if (e.kind === 'serve') {
      // Mehrere Servierungen kurz hintereinander: Texte übereinander stapeln statt überlappen
      const now = this.time.now;
      this.serveFloats = this.serveFloats.filter((t) => now - t < 1500);
      const lift = (this.serveFloats.length % 3) * 20;
      this.serveFloats.push(now);
      const kit = st.kitchens[e.k];
      const midX = kit.x0 + (grillGrid(kit.layout, kit.mirror)[0].length * G.TILE) / 2;
      const x = Math.max(kit.x0 + 52, Math.min(e.x, midX + 40));
      const tip = e.tip ?? 0;
      this.float(x, e.y - 30 - lift, `+${(e.pts ?? 0) - tip}`, C.gold, 1, 1500);
      if (tip) this.float(x, e.y - 20 - lift, `+${tip} Trinkgeld`, '#c8f0c0', 1, 1500);
    } else if (e.kind === 'expire') {
      const reg = this.ticketRegion(st, e.k);
      this.float(reg.x + reg.w / 2, TICKET_Y + 18, `Verpasst! -${-(e.pts ?? 0)}`, '#ff8a7a', 1, 1800);
    } else if (e.kind === 'fire') {
      this.float(e.x, e.y - 24, 'FEUER!', '#ff6b4a', 1, 1600);
      this.cameras.main.shake(180, 0.004);
    } else if (e.kind === 'out') {
      this.float(e.x, e.y - 22, 'Gelöscht!', '#9fe0ff', 1, 1200);
      for (let i = 0; i < 10; i++) this.puff(e.x - 8 + Math.random() * 16, e.y - 4, 0xffffff, 700);
    } else if (e.kind === 'trash') {
      for (let i = 0; i < 4; i++) this.puff(e.x - 4 + Math.random() * 8, e.y - 6, 0xcfcbc1, 450);
    }
  }

  private showOver(st: GrillState) {
    this.overShown = true;
    const L = this.overLayer;
    L.add(panel(this, 110, 92, 260, 92));
    if (!st.teams) {
      const k = st.kitchens[0];
      L.add(ink(this, WORLD.W / 2, 102, 'Feierabend am Grill!'));
      for (let i = 0; i < 3; i++) {
        const on = i < st.stars;
        const img = this.add.image(WORLD.W / 2 - 34 + i * 34, 136, ensureTex(this, `g_star_${on}`, () => starPix(on))).setScale(0);
        L.add(img);
        this.tweens.add({ targets: img, scale: 2, delay: 300 + i * 450, duration: 300, ease: 'Back.easeOut' });
      }
      L.add(ink(this, WORLD.W / 2, 160, `${k.score} Punkte · ${k.served} Gerichte`, { color: '#7a5a3a' }));
    } else {
      const [A, B] = st.kitchens;
      const w = st.winner;
      L.add(ink(this, WORLD.W / 2, 104, w ? `${TEAM_INFO[w].name} gewinnt!` : 'Unentschieden!', { color: w === 'A' ? SUN_INK : w === 'B' ? BLUE_INK : INK }));
      L.add(ink(this, WORLD.W / 2, 128, `Sonne ${A.score} : ${B.score} Meer`, { size: 8 }));
      L.add(ink(this, WORLD.W / 2, 150, `${A.served} : ${B.served} Gerichte serviert`, { color: '#7a5a3a' }));
    }
  }

  private puff(x: number, y: number, tint: number, ms: number) {
    const img = this.add.image(x, y, ensureTex(this, 'g_smoke', smokePuff)).setDepth(990).setTint(tint).setAlpha(0.85);
    this.tweens.add({ targets: img, y: y - 10 - Math.random() * 8, x: x + (Math.random() - 0.5) * 6, alpha: 0, scale: 1.6, duration: ms, onComplete: () => img.destroy() });
  }

  private flame(x: number, y: number) {
    const cols = [0xffd25e, 0xf0973a, 0xe0503f];
    const r = this.add.rectangle(x, y, 2 + Math.round(Math.random() * 2), 3, cols[Math.floor(Math.random() * 3)]).setDepth(995);
    this.tweens.add({ targets: r, y: y - 8 - Math.random() * 8, alpha: 0, duration: 380 + Math.random() * 200, onComplete: () => r.destroy() });
  }

  // ---------------------------------------------------------------- Frame

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;

    // Figuren
    this.hi.clear();
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      a.x += (p.x - a.x) * 0.4;
      a.y += (p.y - a.y) * 0.4;
      if (Math.abs(p.fx) > 0.2) a.img.setFlipX(p.fx < 0);
      a.img.setY(!p.m && p.w ? -Math.abs(Math.sin(now / 45)) * 1.5 : 0);
      playAvatar(a.img, p.m ? 'walk' : 'idle');
      a.f.setPosition(a.x, a.y + 4).setDepth(a.y + 4);
      // Getragenes
      if (p.h) {
        const key = grillItemKey(p.h);
        if (key !== a.heldKey) {
          a.heldKey = key;
          a.held.setTexture(ensureTex(this, key, () => grillItemPix(p.h!))).setVisible(true);
        }
        a.held.setPosition(p.fx * 5, p.fy < -0.5 ? -16 : -8 + Math.min(0, p.fy) * 2).setScale(p.h.x ? 0.8 : 0.75);
      } else if (a.heldKey) {
        a.heldKey = '';
        a.held.setVisible(false);
      }
      if (p.no !== a.no) {
        a.no = p.no;
        this.float(a.x, a.y - 46, 'X', '#ff6b5e', 1, 500);
      }
      // Zielstation markieren
      if (p.tc >= 0 && st.sub === 'play') {
        const k = st.kitchens[p.k];
        const x = k.x0 + p.tc * G.TILE;
        const y = k.y0 + p.tr * G.TILE;
        this.hi.lineStyle(1, p.c, 0.95).strokeRect(x + 0.5, y + 0.5, G.TILE - 1, G.TILE - 1);
      }
      // Funken beim Schneiden/Löschen
      if (p.w && p.tc >= 0) {
        const fxKey = `w:${id}`;
        if ((this.fxAt.get(fxKey) ?? 0) < now) {
          this.fxAt.set(fxKey, now + (p.h?.x ? 50 : 160));
          const c = tileCenter(st.kitchens[p.k], p.tc, p.tr);
          if (p.h?.x) this.puff(c.x - 6 + Math.random() * 12, c.y - 2, 0xffffff, 500);
          else {
            const chip = this.add.rectangle(c.x - 3 + Math.random() * 6, c.y - 2, 2, 2, 0x86cc55).setDepth(c.y + 12);
            this.tweens.add({ targets: chip, y: chip.y - 6, x: chip.x + (Math.random() - 0.5) * 10, alpha: 0, duration: 300, onComplete: () => chip.destroy() });
          }
        }
      }
    }

    // Fortschritt, Rauch, Feuer
    const g = this.bars;
    g.clear();
    const blink = Math.floor(now / 160) % 2 === 0;
    st.kitchens.forEach((k: GrillKitchen, ki) => {
      for (const sl of k.slots) {
        const c = tileCenter(k, sl.c, sl.r);
        const bx = c.x - 8;
        const by = c.y - 16;
        const fxKey = `${ki}:${sl.c},${sl.r}`;
        if (sl.f) {
          if ((this.fxAt.get(fxKey) ?? 0) < now) {
            this.fxAt.set(fxKey, now + 45);
            this.flame(c.x - 7 + Math.random() * 14, c.y - 2);
            if (Math.random() < 0.3) this.puff(c.x - 4 + Math.random() * 8, c.y - 12, 0x6a6560, 900);
          }
          if (sl.e) this.bar(g, bx, by, sl.e, 0x93d3f3);
          continue;
        }
        const it = sl.i;
        if (!it) continue;
        const onGrill = grillGrid(k.layout, k.mirror)[sl.r][sl.c] === 'G';
        if (it.g > 0 && (canChop(it) || onGrill)) this.bar(g, bx, by, it.g, onGrill ? 0xf0973a : 0x7cc04a);
        if (onGrill && (it.g > 0 || it.u > 0) && (this.fxAt.get(fxKey) ?? 0) < now) {
          // Brutzeln bzw. Rauch als Warnung
          const warn = it.u > 0.35;
          this.fxAt.set(fxKey, now + (warn ? 140 - it.u * 80 : 380));
          this.puff(c.x - 5 + Math.random() * 10, c.y - 8, warn ? 0x8a8580 : 0xeeeae2, warn ? 900 : 600);
        }
        if (onGrill && it.u > 0) {
          this.bar(g, bx, by, it.u, it.u > 0.6 ? 0xe0503f : 0xffd25e);
          if (it.u > 0.5 && blink) {
            g.fillStyle(0x2d1b12, 1).fillRect(c.x - 2, by - 11, 5, 9);
            g.fillStyle(0xe0503f, 1).fillRect(c.x - 1, by - 10, 3, 5).fillRect(c.x - 1, by - 4, 3, 1);
          }
        }
      }
    });

    // Zeitbalken der Bestellzettel
    st.kitchens.forEach((_, ki) => {
      for (const t of this.tickets[ki] ?? []) {
        const left = Math.max(0, t.o.left - (st.sub === 'play' ? now - t.recv : 0));
        const f = Math.max(0, Math.min(1, left / t.o.dur));
        const col = f > 0.5 ? 0x46b04a : f > 0.25 ? 0xf2c33a : 0xe0503f;
        t.bar.clear();
        t.bar.fillStyle(0x5e3518, 1).fillRect(t.x + 5, TICKET_Y + TICKET_H - 9, TICKET_W - 10, 5);
        t.bar.fillStyle(col, 1).fillRect(t.x + 6, TICKET_Y + TICKET_H - 8, Math.round((TICKET_W - 12) * f), 3);
        if (f < 0.2 && Math.floor(now / 200) % 2) t.bar.lineStyle(1, 0xe0503f, 1).strokeRect(t.x + 1.5, TICKET_Y + 1.5, TICKET_W - 3, TICKET_H - 3);
      }
    });
  }

  private bar(g: Phaser.GameObjects.Graphics, x: number, y: number, f: number, col: number) {
    g.fillStyle(0x2d1b12, 1).fillRect(x, y, 16, 4);
    g.fillStyle(col, 1).fillRect(x + 1, y + 1, Math.round(14 * Math.max(0, Math.min(1, f))), 2);
  }
}
