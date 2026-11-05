import Phaser from 'phaser';
import type { GameState, ParcoursState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { PARCOURS as P, type ParcoursPart, fanZone, partRect, partSize } from '../../shared/parcours';
import * as O from '../art/objects';
import { coconutPix, paintParcours, partPix } from '../art/parcours';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { GOLD, INK, NameTags, background, ensureTex, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const short = (id: string) => (playerById(id)?.name ?? '?').replace(/^Bot\s+/, '');
/** Nur Plattform, Kanone und Ventilator werden gedreht gezeichnet */
const spriteAngle = (p: Pick<ParcoursPart, 'type' | 'rot'>) => (p.type === 'platform' || p.type === 'cannon' || p.type === 'fan' ? p.rot * 90 : 0);

interface PartView {
  part: ParcoursPart;
  img: Phaser.GameObjects.Image;
  frame: Phaser.GameObjects.Rectangle;
  arrow?: Phaser.GameObjects.Text;
}

interface RunnerView {
  root: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  st: string;
}

export class ParcoursScene extends Phaser.Scene {
  private partViews = new Map<number, PartView>();
  private partsRev = -1;
  private ghosts = new Map<string, { root: Phaser.GameObjects.Container; img: Phaser.GameObjects.Image; frame: Phaser.GameObjects.Rectangle; type: string; rot: number }>();
  private runners = new Map<string, RunnerView>();
  private nuts = new Map<number, Phaser.GameObjects.Image>();
  private wind!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private latest: ParcoursState | null = null;
  private hudKey = '';
  private overlayKey = '';
  private fxSeq = 0;
  private lastSub = '';
  private juice!: Juice;
  private tags!: NameTags;
  private ground = new Map<string, boolean>();
  /** Lokale Uhr für Schwebeplattformen */
  private tBase = 0;

  constructor() {
    super('parcours');
  }

  create() {
    this.partViews.clear();
    this.ghosts.clear();
    this.runners.clear();
    this.nuts.clear();
    this.partsRev = -1;
    this.hudKey = '';
    this.overlayKey = '';
    this.fxSeq = 0;
    this.lastSub = '';
    this.latest = null;
    background(this, 'parcours', WORLD.W, WORLD.H, paintParcours);
    prop(this, 'palm', () => O.palm(6), 30, 202).setDepth(-500);
    prop(this, 'cocktailP', O.cocktail, 418, 176).setDepth(-400);
    this.wind = this.add.graphics().setDepth(5);
    this.juice = new Juice(this, { depth: 950 });
    this.tags = new NameTags(this, 600);
    this.ground.clear();
    this.hud = this.add.container(0, 0).setDepth(1000);
    this.overlay = this.add.container(0, 0).setDepth(1100);
    this.banner = txt(this, WORLD.W / 2, 96, '', { size: 24, color: GOLD }).setDepth(1200);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  private localT() {
    const st = this.latest;
    if (!st) return 0;
    return st.sub === 'run' ? performance.now() - this.tBase : st.t;
  }

  update() {
    const st = this.latest;
    if (!st) return;
    const t = this.localT();
    // Schwebeplattformen bewegen
    for (const v of this.partViews.values()) {
      if (v.part.type !== 'mover') continue;
      const r = partRect(v.part, t);
      v.img.setPosition(r.x + r.w / 2, r.y + r.h / 2);
      v.frame.setPosition(r.x + r.w / 2, r.y + r.h / 2);
      v.arrow?.setPosition(r.x + r.w / 2, r.y - 1);
    }
    // Wind
    this.wind.clear();
    for (const v of this.partViews.values()) {
      if (v.part.type !== 'fan') continue;
      const z = fanZone(v.part);
      const horiz = v.part.rot % 2 === 0;
      const sign = v.part.rot === 0 || v.part.rot === 1 ? 1 : -1;
      this.wind.fillStyle(0xffffff, 0.12).fillRect(z.x, z.y, z.w, z.h);
      for (let k = 0; k < 4; k++) {
        const len = horiz ? z.w : z.h;
        const off = (((this.time.now / 6 + k * 23) % len) + len) % len;
        const along = sign > 0 ? off : len - off;
        this.wind.fillStyle(0xffffff, 0.75);
        if (horiz) this.wind.fillRect(z.x + along, z.y + 3 + ((k * 5) % Math.max(1, z.h - 6)), 5, 1);
        else this.wind.fillRect(z.x + 3 + ((k * 5) % Math.max(1, z.w - 6)), z.y + along, 1, 5);
      }
    }
    // Läufer
    const tagSpecs: { id: string; x: number; y: number; name: string; color: string }[] = [];
    for (const [id, r] of Object.entries(st.runners)) {
      const v = this.runners.get(id);
      if (!v) continue;
      v.x += (r.x - v.x) * 0.45;
      v.y += (r.y - v.y) * 0.45;
      v.root.setPosition(Math.round(v.x), Math.round(v.y));
      if (r.st !== 'dead' && v.root.visible) tagSpecs.push({ id, x: Math.round(v.x), y: Math.round(v.y) - 37, name: short(id), color: hex(P.COLORS[st.colors[id] ?? 0]) });
      v.img.setFlipX(r.face < 0);
      const moving = r.st === 'run' && r.ground && Math.abs(r.x - v.x) > 0.3;
      v.img.setY(moving ? -Math.abs(Math.sin(this.time.now / 70)) * 1.5 : 0);
    }
    this.tags.update(st.sub === 'countdown' || st.sub === 'run' || st.sub === 'score' ? tagSpecs : []);
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'parcours') return;
    const st = s.mini.state;
    this.latest = st;
    if (st.sub === 'run') {
      const base = performance.now() - st.t;
      if (Math.abs(base - this.tBase) > 90) this.tBase = base;
    }
    if (st.partsRev !== this.partsRev) this.buildParts(st);
    this.syncGhosts(st);
    this.syncRunners(st);
    this.syncNuts(st);
    this.playFx(st);
    this.drawHud(st);
    this.drawOverlay(st);
    if (st.sub !== this.lastSub) {
      this.lastSub = st.sub;
      if (st.sub === 'build') this.flash(`Runde ${st.round}: BAUEN!`);
      if (st.sub === 'run') this.flash('LOS!');
    }
    // Falls der Tween hängt (z. B. Tab im Hintergrund): Banner spätestens nach 1,5 s weg
    if (this.banner.getData('flash') === true && Date.now() - (this.banner.getData('flashAt') as number) > 1500) {
      this.tweens.killTweensOf(this.banner);
      this.banner.setText('').setAlpha(1).setData('flash', false);
    }
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000))));
    else if (this.banner.getData('flash') !== true) this.banner.setText('');
  }

  private flash(text: string) {
    this.banner.setText(text).setData('flash', true).setData('flashAt', Date.now()).setScale(1).setAlpha(1);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({
      targets: this.banner,
      alpha: 0,
      delay: 900,
      duration: 400,
      onComplete: () => this.banner.setText('').setAlpha(1).setData('flash', false),
    });
  }

  private buildParts(st: ParcoursState) {
    this.partsRev = st.partsRev;
    const alive = new Set(st.parts.map((p) => p.id));
    for (const [id, v] of this.partViews) {
      if (alive.has(id)) continue;
      v.img.destroy();
      v.frame.destroy();
      v.arrow?.destroy();
      this.partViews.delete(id);
    }
    for (const p of st.parts) {
      if (this.partViews.has(p.id)) continue;
      const r = partRect(p, this.localT());
      const color = P.COLORS[st.colors[p.owner] ?? 0];
      const img = this.add.image(r.x + r.w / 2, r.y + r.h / 2, ensureTex(this, `pc_${p.type}`, () => partPix(p.type))).setAngle(spriteAngle(p)).setDepth(10);
      const frame = this.add.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w + 3, r.h + 3).setStrokeStyle(1, color, 0.9).setDepth(9);
      const view: PartView = { part: p, img, frame };
      if (p.type === 'mover') view.arrow = txt(this, r.x + r.w / 2, r.y - 1, p.rot % 2 ? '↕' : '↔', { color: hex(color) }).setOrigin(0.5, 1).setDepth(11).setScale(0.75);
      this.partViews.set(p.id, view);
      img.setScale(0.2);
      this.tweens.add({ targets: img, scale: 1, duration: 260, ease: 'Back.out' });
    }
  }

  private syncGhosts(st: ParcoursState) {
    const want = st.sub === 'build' ? Object.entries(st.builders).filter(([, b]) => b.stage === 'place' && b.pick) : [];
    const ids = new Set(want.map(([id]) => id));
    for (const [id, g] of this.ghosts) {
      if (!ids.has(id)) {
        g.root.destroy();
        this.ghosts.delete(id);
      }
    }
    for (const [id, b] of want) {
      const type = b.pick!;
      let g = this.ghosts.get(id);
      if (g && (g.type !== type || g.rot !== b.rot)) {
        g.root.destroy();
        this.ghosts.delete(id);
        g = undefined;
      }
      const color = P.COLORS[st.colors[id] ?? 0];
      if (!g) {
        const { w, h } = partSize(type, b.rot);
        const img = this.add.image(0, 0, ensureTex(this, `pc_${type}`, () => partPix(type))).setAngle(spriteAngle({ type, rot: b.rot })).setAlpha(0.75);
        const frame = this.add.rectangle(0, 0, w + 4, h + 4).setStrokeStyle(1, color, 1);
        const name = txt(this, 0, -h / 2 - 12, short(id).slice(0, 6), { color: hex(color) });
        const parts: Phaser.GameObjects.GameObject[] = [frame, img, name];
        if (type === 'mover') {
          const R = P.MOVER_RANGE;
          const track = b.rot % 2 ? this.add.rectangle(0, 0, 2, h + 2 * R, color, 0.35) : this.add.rectangle(0, 0, w + 2 * R, 2, color, 0.35);
          parts.unshift(track);
        }
        if (type === 'bomb') parts.unshift(this.add.circle(0, 0, P.BOMB_R, 0xe0503f, 0.18).setStrokeStyle(1, 0xe0503f, 0.6));
        if (type === 'fan') {
          const z = fanZone({ id: 0, type, x: 0, y: 0, rot: b.rot, owner: '' });
          parts.unshift(this.add.rectangle(z.x + z.w / 2, z.y + z.h / 2, z.w, z.h, 0xffffff, 0.2));
        }
        if (type === 'cannon') {
          const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][b.rot % 4];
          for (let k = 1; k <= 4; k++) parts.unshift(this.add.circle(dx * (6 + k * 10), dy * (6 + k * 8), 1, 0x6b4522, 0.6));
        }
        const root = this.add.container(b.gx, b.gy, parts).setDepth(600);
        g = { root, img, frame, type, rot: b.rot };
        this.ghosts.set(id, g);
      }
      g.root.setPosition(b.gx, b.gy);
      g.img.setTint(b.ok ? 0xffffff : 0xff6a5a);
      g.frame.setStrokeStyle(1, b.ok ? color : 0xff3b30, 1);
      g.root.setAlpha(b.ok ? 1 : 0.6 + Math.sin(this.time.now / 90) * 0.2);
    }
  }

  private syncRunners(st: ParcoursState) {
    const show = st.sub === 'countdown' || st.sub === 'run' || st.sub === 'score';
    for (const [id, v] of this.runners) {
      if (!show || !st.runners[id]) {
        v.root.destroy();
        this.runners.delete(id);
      }
    }
    if (!show) return;
    for (const [id, r] of Object.entries(st.runners)) {
      let v = this.runners.get(id);
      const pl = playerById(id);
      if (!pl) continue;
      if (!v) {
        const color = P.COLORS[st.colors[id] ?? 0];
        const img = this.add.image(0, 0, ensureAvatar(this, pl.look)).setOrigin(0.5, 1).setScale(0.75);
        const mark = this.add.triangle(0, -25, 0, 0, 6, 0, 3, 4, color).setStrokeStyle(1, 0x2d1b12);
        // Namen kommen aus NameTags (verteilt sich selbst, bei Gedränge Initiale + Farbpunkt)
        const root = this.add.container(r.x, r.y, [img, mark]).setDepth(500);
        v = { root, img, x: r.x, y: r.y, st: r.st };
        this.runners.set(id, v);
      }
      if (st.sub === 'countdown') {
        v.x = r.x;
        v.y = r.y;
      }
      if (r.st !== v.st) {
        v.st = r.st;
        if (r.st === 'dead') {
          this.tweens.add({ targets: v.root, alpha: 0, angle: 180, duration: 500 });
          if (!r.by && !r.zzz) {
            // ins Wasser gefallen
            sfx('splash', { x: r.x });
            this.juice.burst(r.x, Math.min(r.y, 262), 'splash', 12);
          }
        }
        if (r.st === 'goal') this.tweens.add({ targets: v.img, scale: 0.9, yoyo: true, duration: 180, repeat: 2 });
      }
      // Sprung: vom Boden abgehoben
      const was = this.ground.get(id);
      if (st.sub === 'run' && r.st === 'run' && was && !r.ground) sfx('jump', { x: r.x, vol: 0.45, pitch: 1.1 });
      this.ground.set(id, r.ground);
      if (r.st === 'run') v.root.setAlpha(r.away ? 0.4 : 1).setAngle(0); // away = Verbindung weg (eingefroren)
    }
  }

  private syncNuts(st: ParcoursState) {
    const alive = new Set(st.nuts.map((n) => n.id));
    for (const [id, img] of this.nuts) {
      if (!alive.has(id)) {
        img.destroy();
        this.nuts.delete(id);
      }
    }
    for (const n of st.nuts) {
      let img = this.nuts.get(n.id);
      if (!img) {
        img = this.add.image(n.x, n.y, ensureTex(this, 'pc_nut', coconutPix)).setDepth(520);
        this.nuts.set(n.id, img);
      }
      img.setPosition(n.x, n.y).setAngle((n.x + n.y) * 8);
    }
  }

  private playFx(st: ParcoursState) {
    for (const f of st.fx) {
      if (f.seq <= this.fxSeq) continue;
      this.fxSeq = f.seq;
      if (f.kind === 'boom') {
        const c = this.add.circle(f.x, f.y, 6, 0xffb03a, 0.9).setDepth(900);
        this.tweens.add({ targets: c, scale: P.BOMB_R / 6 + 0.5, alpha: 0, duration: 450, onComplete: () => c.destroy() });
        this.juice.shake(3);
        this.juice.burst(f.x, f.y, 'fire', 18);
        this.juice.burst(f.x, f.y, 'smoke', 8);
        sfx('boom', { x: f.x });
      } else if (f.kind === 'ko') {
        const t = txt(this, f.x, f.y - 26, 'KO!', { color: '#ff6a5a' }).setDepth(900);
        this.tweens.add({ targets: t, y: t.y - 12, alpha: 0, duration: 900, onComplete: () => t.destroy() });
        const splash = this.add.circle(f.x, f.y - 6, 4, 0xffffff, 0.8).setDepth(899);
        this.tweens.add({ targets: splash, scale: 3, alpha: 0, duration: 400, onComplete: () => splash.destroy() });
        // Falle hat zugeschnappt
        sfx('ko', { x: f.x });
        sfx('bonk', { x: f.x, delay: 0.04 });
        this.juice.burst(f.x, f.y - 8, 'puff', 8);
        this.juice.hitStop(60);
        this.juice.shake(1);
      } else if (f.kind === 'goal') {
        sfx('coin', { x: f.x });
        sfx('cheer', { x: f.x, vol: 0.6, delay: 0.1 });
        this.juice.burst(f.x, f.y - 20, 'confetti', 20);
        const t = txt(this, f.x, f.y - 30, 'PROST!', { color: GOLD }).setDepth(900);
        this.tweens.add({ targets: t, y: t.y - 14, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
      } else if (f.kind === 'place') {
        sfx('pop', { x: f.x, pitch: 0.8 });
        const c = this.add.circle(f.x, f.y, 4, 0xffffff, 0.6).setDepth(899);

        this.tweens.add({ targets: c, scale: 3, alpha: 0, duration: 300, onComplete: () => c.destroy() });
      }
    }
  }

  private drawHud(st: ParcoursState) {
    const ids = Object.keys(st.points);
    // Kein Zeitlimit beim Bauen/Laufen – nur wer lange nichts tut, bekommt einen AFK-Hinweis (mit Restzeit)
    const afk =
      st.sub === 'build'
        ? Object.entries(st.builders).filter(([, b]) => b.stage !== 'done' && b.afk > 0).map(([id, b]) => [id, b.afk] as const)
        : st.sub === 'run'
          ? Object.entries(st.runners).filter(([, r]) => r.st === 'run' && r.afk > 0).map(([id, r]) => [id, r.afk] as const)
          : [];
    const afkText = afk.length ? ` ZZZ ${short(afk[0][0]).slice(0, 6)} ${Math.ceil(afk[0][1] / 1000)}s` : '';
    const key = JSON.stringify([st.sub, st.round, afkText, st.points, ids.map((id) => st.builders[id]?.stage)]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 0, 0, WORLD.W, 24));
    const phase = { intro: 'GLEICH GEHT’S LOS', build: 'BAUEN', countdown: 'BEREIT', run: 'LAUFEN', score: 'WERTUNG', over: 'ENDE' }[st.sub];
    this.hud.add(ink(this, 8, 8, `R${Math.max(1, st.round)}/${st.rounds} ${phase}`, { origin: [0, 0] }));
    if (afkText) {
      // eigener kleiner Kasten unter der Kopfzeile (überdeckt nichts Wichtiges)
      const t = ink(this, 8, 29, afkText.trim(), { origin: [0, 0], color: '#a8342a' });
      const w = Math.ceil(t.width) + 10;
      this.hud.add(panel(this, 3, 25, w, 17));
      this.hud.add(t);
    }
    // Punkte rechts: Farbpunkt + Kurzname + Punkte
    const sorted = [...ids].sort((a, b) => st.points[b] - st.points[a]);
    const slot = Math.min(60, 250 / Math.max(1, sorted.length));
    let x = WORLD.W - 8 - slot * sorted.length;
    for (const id of sorted) {
      const color = P.COLORS[st.colors[id] ?? 0];
      const b = st.builders[id];
      const done = st.sub === 'build' && b?.stage === 'done';
      this.hud.add(this.add.rectangle(x + 3, 12, 6, 6, color).setStrokeStyle(1, 0x2d1b12).setAlpha(st.sub === 'build' && !done ? 0.5 : 1));
      const label = slot >= 48 ? `${short(id).slice(0, 3)} ${st.points[id]}` : `${st.points[id]}`;
      this.hud.add(ink(this, x + 9, 8, label, { origin: [0, 0] }));
      x += slot;
    }
  }

  private drawOverlay(st: ParcoursState) {
    const key = st.sub === 'intro' ? 'intro' : st.sub === 'score' || st.sub === 'over' ? `score-${st.round}-${st.sub}` : st.sub === 'build' ? `build-${st.round}` : '';
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.overlay.removeAll(true);
    if (st.sub === 'intro') {
      this.overlay.add(panel(this, 70, 50, 340, 112));
      this.overlay.add(ink(this, WORLD.W / 2, 60, 'FALLEN-PARCOURS', { size: 16, color: '#a8342a' }));
      this.overlay.add(
        ink(
          this,
          WORLD.W / 2,
          84,
          `1. BAUEN: Teil wählen, mit dem\nJoystick platzieren.\n2. LAUFEN: vom Handtuch zur Bar!\nPunkte nur, wenn nicht ALLE\n(und nicht KEINER) ankommen.\nErster bei ${st.target} Punkten gewinnt.`,
          { align: 'left' },
        ),
      );
      return;
    }
    if (st.sub === 'build' && st.round === 1) {
      const hint = ink(this, WORLD.W / 2, 232, 'Wählt am Handy ein Teil und baut es ein!', { color: INK });
      const bg = this.add.rectangle(WORLD.W / 2, 236, 340, 14, 0xfff4d6, 0.85).setStrokeStyle(1, 0x5e3518);
      this.overlay.add([bg, hint]);
      return;
    }
    if ((st.sub === 'score' || st.sub === 'over') && st.last) {
      const ids = Object.keys(st.points).sort((a, b) => st.points[b] - st.points[a]);
      const h = 44 + ids.length * 12;
      const y0 = Math.max(30, 135 - h / 2);
      this.overlay.add(panel(this, 110, y0, 260, Math.ceil(h / 2) * 2));
      const verdict = st.sub === 'over' ? 'ENDSTAND' : st.last.verdict === 'easy' ? 'ZU LEICHT! Alle im Ziel' : st.last.verdict === 'hard' ? 'ZU SCHWER! Keiner im Ziel' : `Runde ${st.round}`;
      this.overlay.add(ink(this, WORLD.W / 2, y0 + 10, verdict, { color: st.last.verdict === 'ok' || st.sub === 'over' ? INK : '#a8342a' }));
      if (st.last.verdict !== 'ok' && st.sub !== 'over') this.overlay.add(ink(this, WORLD.W / 2, y0 + 22, 'keine Punkte', { color: '#7a5a3a' }));
      ids.forEach((id, i) => {
        const y = y0 + 36 + i * 12;
        const g = st.last!.gains[id] ?? { goal: 0, first: 0, traps: 0 };
        const color = P.COLORS[st.colors[id] ?? 0];
        this.overlay.add(this.add.rectangle(124, y + 3, 6, 6, color).setStrokeStyle(1, 0x2d1b12));
        this.overlay.add(ink(this, 132, y, short(id).slice(0, 8), { origin: [0, 0] }));
        const bits = [g.goal ? `Z+${g.goal}` : '', g.first ? `1.+${g.first}` : '', g.traps ? `F+${g.traps}` : ''].filter(Boolean).join(' ');
        if (st.sub !== 'over') this.overlay.add(ink(this, 232, y, bits, { origin: [0, 0], color: '#2f7d32' }));
        this.overlay.add(ink(this, 360, y, String(st.points[id]), { origin: [1, 0] }));
      });
    }
  }
}
