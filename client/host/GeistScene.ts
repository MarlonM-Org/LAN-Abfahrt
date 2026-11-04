import Phaser from 'phaser';
import type { GameState, GeistState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { GEIST, GEIST_FURNITURE, GEIST_ROOMS, GEIST_WALLS, conePolygon, roomRect } from '../../shared/geist';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { candle, cobweb, ghostSprite, wardrobe } from '../art/geist';
import { paintTiles, paintWoodFloor } from '../art/ground';
import type { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GREEN_INK, RED_INK, background, ensureTex, ink, panel, txt } from './ui';

const A = GEIST.AREA;
const DARK = 0x060818;

function paintHouse(p: Pix) {
  p.rect(0, 0, WORLD.W, WORLD.H, '#1b1026');
  // Außenwand
  p.rect(A.x - 6, A.y - 6, A.w + 12, A.h + 12, C.woodDarker);
  for (let i = 0; i < 6; i++) {
    const r = roomRect(i);
    const { x, y, w, h } = r;
    switch (i) {
      case 0: paintTiles(p, x, y, w, h, '#ece6d3', '#cfc6ad', 9); break; // Küche
      case 1: paintWoodFloor(p, x, y, w, h, 71); break; // Wohnzimmer
      case 2: paintTiles(p, x, y, w, h, '#a8d8ea', '#86c1d9', 8); break; // Bad
      case 3: paintWoodFloor(p, x, y, w, h, 72, '#a96a3a'); break; // Schlafzimmer
      case 4: // Flur mit Läufer
        paintWoodFloor(p, x, y, w, h, 73, '#9a6234');
        p.rect(x + w / 2 - 22, y + 10, 44, h - 20, '#7b2f3a');
        p.rect(x + w / 2 - 19, y + 13, 38, h - 26, '#a8434f');
        for (let yy = y + 16; yy < y + h - 14; yy += 10) p.hline(x + w / 2 - 14, yy, 28, '#c9665f');
        break;
      case 5: // Keller: Steinboden
        p.rect(x, y, w, h, C.stoneDark);
        for (let yy = y; yy < y + h; yy += 10) {
          for (let xx = x + ((yy / 10) % 2) * 7; xx < x + w; xx += 14) p.rect(xx, yy, 13, 9, (xx + yy) % 3 ? C.stone : '#959188');
        }
        break;
    }
  }
  for (const w of GEIST_WALLS) {
    p.rect(w.x, w.y, w.w, w.h, '#6e4521');
    p.rect(w.x, w.y, w.w, 2, '#8d5a2c');
  }
}

const FURN: Record<string, () => Pix> = {
  counter: O.counter,
  table: O.table,
  sofa: () => O.sofa(),
  bathtub: O.bathtub,
  bed: () => O.bed(),
  bedR: () => O.bed(C.red),
  crate: O.crate,
  plant: O.plant,
  wardrobe,
};

interface HunterView {
  f: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  x: number;
  y: number;
  angle: number;
}

export class GeistScene extends Phaser.Scene {
  private dark!: Phaser.GameObjects.RenderTexture;
  private eraser!: Phaser.GameObjects.Graphics;
  private glow!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;
  private ghost!: Phaser.GameObjects.Image;
  private ghostPos = { x: 0, y: 0 };
  private ghostShown = false;
  private hunters = new Map<string, HunterView>();
  private hud!: Phaser.GameObjects.Container;
  private card!: Phaser.GameObjects.Container;
  private latest: GeistState | null = null;
  private hudKey = '';
  private cardKey = '';
  private flashSeq = 0;
  private scareSeq = 0;
  private reviveSeq = 0;
  private darkAlpha = 1;
  private hunterKey = '';

  constructor() {
    super('geist');
  }

  create() {
    this.hunters.clear();
    this.hudKey = '';
    this.cardKey = '';
    this.hunterKey = '';
    this.ghostShown = false;
    this.darkAlpha = 1;
    this.latest = null;
    const st0 = getState();
    const g0 = st0?.mini?.kind === 'geist' ? st0.mini.state : null;
    this.flashSeq = g0?.flashSeq ?? 0;
    this.scareSeq = g0?.lastScare?.seq ?? 0;
    this.reviveSeq = g0?.lastRevive?.seq ?? 0;

    background(this, 'geisthouse', WORLD.W, WORLD.H, paintHouse);
    for (const f of GEIST_FURNITURE) {
      this.add.image(f.x + f.w / 2, f.y + f.h, ensureTex(this, `g_${f.sprite}`, FURN[f.sprite])).setOrigin(0.5, 1).setDepth(f.y + f.h);
    }
    const kr = roomRect(5);
    this.add.image(kr.x + 3, kr.y + 3, ensureTex(this, 'g_cobweb', cobweb)).setOrigin(0, 0).setDepth(5);
    this.add.image(kr.x + kr.w - 3, kr.y + kr.h - 3, ensureTex(this, 'g_cobweb', cobweb)).setOrigin(0, 0).setAngle(180).setDepth(5);
    this.add.image(roomRect(2).x + roomRect(2).w - 3, roomRect(2).y + 3, ensureTex(this, 'g_cobweb', cobweb)).setOrigin(0, 0).setAngle(90).setDepth(5);

    // Dunkelheit: Lichtkegel werden herausradiert
    this.dark = this.add.renderTexture(0, 0, WORLD.W, WORLD.H).setOrigin(0).setDepth(600);
    this.eraser = this.make.graphics({}, false);
    this.glow = this.add.graphics().setDepth(610).setBlendMode(Phaser.BlendModes.ADD);
    this.ui = this.add.graphics().setDepth(720);

    // Kerzen als Orientierung (leuchten durch die Dunkelheit)
    for (const [room, dx, dy] of [[4, 18, 14], [1, 130, 14], [3, 130, 14]] as const) {
      const r = roomRect(room);
      this.add.image(r.x + dx, r.y + dy, ensureTex(this, 'g_candle', candle)).setOrigin(0.5, 1).setDepth(705);
    }
    GEIST_ROOMS.forEach((name, i) => {
      const r = roomRect(i);
      txt(this, r.x + r.w / 2, r.y + (i < 3 ? 5 : r.h - 13), name.toUpperCase(), { color: '#8f86b8', shadow: false }).setDepth(650).setAlpha(0.45);
    });

    this.ghost = this.add.image(0, 0, ensureTex(this, 'g_ghost_idle', () => ghostSprite('idle'))).setOrigin(0.5, 0.75).setDepth(800).setAlpha(0);
    ensureTex(this, 'g_ghost_hit', () => ghostSprite('hit'));
    ensureTex(this, 'g_ghost_boo', () => ghostSprite('boo'));

    this.hud = this.add.container(0, 0).setDepth(1000);
    this.card = this.add.container(0, 0).setDepth(1100);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    if (st0) this.onState(st0);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'geist') return;
    const g = s.mini.state;
    this.latest = g;

    // Figuren neu aufbauen, wenn sich die Jäger ändern (neue Runde → anderer Geist)
    const hk = `${g.round}-${Object.keys(g.hunters).join(',')}`;
    if (hk !== this.hunterKey) {
      this.hunterKey = hk;
      for (const v of this.hunters.values()) v.f.destroy();
      this.hunters.clear();
      for (const [id, h] of Object.entries(g.hunters)) {
        const p = playerById(id);
        if (!p) continue;
        const f = figure(this, p.look, h.x, h.y + 6);
        const img = f.getData('img') as Phaser.GameObjects.Image;
        const tag = txt(this, 0, -36, p.name.replace(/^Bot\s+/, '').slice(0, 6), { color: '#e8e2ff' });
        const status = txt(this, 0, -46, '', { color: C.gold });
        f.add([tag, status]);
        this.hunters.set(id, { f, img, tag, status, x: h.x, y: h.y, angle: h.angle });
      }
    }

    if (g.flashSeq !== this.flashSeq) {
      this.flashSeq = g.flashSeq;
      this.lightning();
    }
    if (g.lastScare && g.lastScare.seq !== this.scareSeq) {
      this.scareSeq = g.lastScare.seq;
      const h = g.hunters[g.lastScare.victim];
      if (h) this.popText(h.x, h.y - 30, 'BUH!', '#ff9fc4', 16);
      this.cameras.main.shake(260, 0.008);
    }
    if (g.lastRevive && g.lastRevive.seq !== this.reviveSeq) {
      this.reviveSeq = g.lastRevive.seq;
      const h = g.hunters[g.lastRevive.id];
      if (h) this.popText(h.x, h.y - 30, 'Gerettet!', '#9be37f', 8);
    }

    if (g.ghost) {
      if (!this.ghostShown) {
        this.ghostShown = true;
        this.ghostPos = { x: g.ghost.x, y: g.ghost.y };
        this.tweens.killTweensOf(this.ghost);
        this.ghost.setAlpha(1);
      }
      this.ghost.setTexture(g.ghost.why === 'light' ? 'g_ghost_hit' : g.ghost.why === 'touch' ? 'g_ghost_boo' : 'g_ghost_idle');
    } else if (this.ghostShown) {
      this.ghostShown = false;
      this.tweens.add({ targets: this.ghost, alpha: 0, duration: 350 });
    }

    this.renderHud(g);
    this.renderCard(g);
  }

  update(_t: number, dms: number) {
    const g = this.latest;
    if (!g) return;
    const k = Math.min(1, dms / 1000 * 14);
    // Dunkelheit
    this.darkAlpha += (1 - this.darkAlpha) * Math.min(1, dms / 600);
    this.dark.clear();
    const lightsOut = g.sub === 'play' || g.sub === 'intro';
    this.dark.fill(DARK, (lightsOut ? 0.94 : 0.55) * this.darkAlpha);
    this.eraser.clear();
    this.glow.clear();
    this.ui.clear();

    for (const [id, h] of Object.entries(g.hunters)) {
      const v = this.hunters.get(id);
      if (!v) continue;
      v.x += (h.x - v.x) * k;
      v.y += (h.y - v.y) * k;
      let da = Math.atan2(Math.sin(h.angle - v.angle), Math.cos(h.angle - v.angle));
      v.angle += da * k;
      v.f.setPosition(v.x, v.y + 6).setDepth(700 + v.y / 10);
      v.img.setFlipX(Math.cos(v.angle) < 0);
      if (h.down) {
        v.img.setAngle(90).setTint(0x9d9ab8).setY(-2);
      } else {
        v.img.setAngle(0).clearTint().setY(h.moving ? -Math.abs(Math.sin(this.time.now / 80)) * 2 : 0);
      }
      v.status.setText(h.down ? 'HILFE!' : h.empty ? 'Akku leer' : '');
      v.status.setColor(h.down ? '#ff9fc4' : C.gold);
      // Kleiner Lichthof um jede Figur, damit man sich selbst findet
      this.eraser.fillStyle(0xffffff, 0.5).fillCircle(v.x, v.y, 15);
      if (h.light && !h.down) {
        const poly = conePolygon(v.x, v.y, v.angle, 16);
        this.eraser.fillStyle(0xffffff, 0.55).fillPoints(poly, true);
        const inner = conePolygon(v.x, v.y, v.angle, 16).map((p, i) => (i === 0 ? p : { x: v.x + (p.x - v.x) * 0.8, y: v.y + (p.y - v.y) * 0.8 }));
        this.eraser.fillStyle(0xffffff, 0.9).fillPoints(inner, true);
        this.glow.fillStyle(0xffd97a, 0.13).fillPoints(poly, true);
      }
      // Akku-Balken
      if (!h.down && (h.light || h.battery < 0.99)) {
        const bx = v.x - 8;
        const by = v.y + 10;
        this.ui.fillStyle(0x1b1026, 0.9).fillRect(bx - 1, by - 1, 18, 4);
        this.ui.fillStyle(h.empty ? 0xe04a3f : h.battery < 0.3 ? 0xf0973a : 0xffd25e, 1).fillRect(bx, by, 16 * h.battery, 2);
      }
      // Rettungsring
      if (h.down) {
        this.ui.lineStyle(2, 0x2d1b12, 0.8).strokeCircle(v.x, v.y, 10);
        if (h.revive > 0) {
          this.ui.lineStyle(2, 0x9be37f, 1).beginPath();
          this.ui.arc(v.x, v.y, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * h.revive);
          this.ui.strokePath();
        }
      }
    }
    this.dark.erase(this.eraser);

    // Geist (nur wenn enthüllt)
    if (g.ghost) {
      this.ghostPos.x += (g.ghost.x - this.ghostPos.x) * k;
      this.ghostPos.y += (g.ghost.y - this.ghostPos.y) * k;
    }
    this.ghost.setPosition(this.ghostPos.x, this.ghostPos.y + Math.sin(this.time.now / 220) * 1.5);
    this.ghost.setDepth(800);
  }

  // ---------------------------------------------------------------- Effekte

  private lightning() {
    this.darkAlpha = 0;
    this.cameras.main.flash(260, 235, 240, 255);
    const t = txt(this, WORLD.W / 2, 120, 'BLITZ!', { size: 16, color: '#eef0ff' }).setDepth(1050);
    this.tweens.add({ targets: t, alpha: 0, y: 108, duration: 900, onComplete: () => t.destroy() });
  }

  private popText(x: number, y: number, text: string, color: string, size: 8 | 16) {
    const t = txt(this, x, y, text, { size, color }).setDepth(1050);
    this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 1100, ease: 'Quad.out', onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- HUD + Karten

  private renderHud(g: GeistState) {
    const key = JSON.stringify([g.round, g.sub, g.ghostId, Math.ceil(g.endsIn / 1000), Math.round((g.health / g.maxHealth) * 60)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 0, 0, WORLD.W, 26));
    this.hud.add(ink(this, 10, 9, `Runde ${g.round}/${g.rounds}`, { origin: [0, 0] }));
    const name = (playerById(g.ghostId)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 8);
    this.hud.add(this.add.image(146, 13, 'g_ghost_idle').setScale(1));
    this.hud.add(ink(this, 158, 9, name, { origin: [0, 0], color: '#6b4fa8' }));
    const bx = 240;
    const bw = 150;
    const gfx = this.add.graphics();
    gfx.fillStyle(0x2d1b12).fillRect(bx - 1, 8, bw + 2, 10);
    gfx.fillStyle(0xe6c88a).fillRect(bx, 9, bw, 8);
    const frac = Math.max(0, g.health / g.maxHealth);
    gfx.fillStyle(frac < 0.3 ? 0xe04a3f : 0x9b5fc0).fillRect(bx, 9, bw * frac, 8);
    this.hud.add(gfx);
    if (g.sub === 'play') {
      const sec = Math.ceil(g.endsIn / 1000);
      this.hud.add(ink(this, WORLD.W - 10, 9, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, { origin: [1, 0], color: sec <= 10 ? RED_INK : undefined }));
    }
  }

  private renderCard(g: GeistState) {
    const key = `${g.sub}-${g.round}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.card.removeAll(true);
    const ghostName = playerById(g.ghostId)?.name ?? '?';
    const box = (h: number) => {
      const y = 148 - h / 2;
      this.card.add(panel(this, 70, y, 340, h));
      return y;
    };
    if (g.sub === 'intro') {
      const y = box(150);
      this.card.add(ink(this, WORLD.W / 2, y + 12, g.round === 1 ? 'Stromausfall im Ferienhaus!' : `Runde ${g.round} von ${g.rounds}`, { color: '#6b4fa8' }));
      this.card.add(this.add.image(WORLD.W / 2, y + 44, 'g_ghost_boo').setScale(2));
      this.card.add(ink(this, WORLD.W / 2, y + 70, `${ghostName} ist der Geist!`, { size: 8, color: RED_INK, wrap: 310 }));
      this.card.add(
        ink(this, WORLD.W / 2, y + 90, 'Jäger: Licht an und den Geist anleuchten!\nHandy brummt = Geist in der Nähe.\nGeist: Von hinten anschleichen – BUH!', { wrap: 320 }),
      );
      this.tweens.add({ targets: this.card, alpha: { from: 0, to: 1 }, duration: 300 });
      this.time.delayedCall(GEIST.INTRO_MS - 400, () => {
        if (this.cardKey === key) this.tweens.add({ targets: this.card, alpha: 0, duration: 300 });
      });
    } else if (g.sub === 'roundEnd') {
      this.card.setAlpha(1);
      const y = box(86);
      const hunters = g.roundWinner === 'hunters';
      this.card.add(ink(this, WORLD.W / 2, y + 14, hunters ? 'Die Jäger gewinnen!' : 'Der Geist gewinnt!', { size: 16, color: hunters ? GREEN_INK : '#6b4fa8' }));
      this.card.add(ink(this, WORLD.W / 2, y + 44, g.roundReason ?? '', { wrap: 310 }));
    } else if (g.sub === 'over') {
      this.card.setAlpha(1);
      const y = box(120);
      this.card.add(ink(this, WORLD.W / 2, y + 12, 'Geisterjagd vorbei!', { size: 16, color: '#6b4fa8' }));
      const ranked = Object.entries(g.points).sort((a, b) => b[1] - a[1]).slice(0, 4);
      ranked.forEach(([id, pts], i) => {
        this.card.add(ink(this, WORLD.W / 2, y + 42 + i * 16, `${i + 1}. ${(playerById(id)?.name ?? '?').slice(0, 10)}  ${pts} Pkt`));
      });
    } else {
      this.card.setAlpha(1);
    }
  }
}
