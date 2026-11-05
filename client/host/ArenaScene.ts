import Phaser from 'phaser';
import type { ArenaState, GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { ARENA, cellIdx } from '../../shared/arena';
import { SHIRTS } from '../../shared/avatar';
import { C } from '../art/palette';
import { paintGrass, paintSand } from '../art/ground';
import { arenaPalm, arenaRock, coconut, cooler, floodTile, hedge, itemIcon, lounger, sandcastle, splash, waterBalloon } from '../art/arena';
import { flower, umbrella } from '../art/objects';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { Countdown, background, ensureTex, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

const T = ARENA.TILE;
const px = (x: number) => ARENA.OX + x * T + T / 2;
const py = (y: number) => ARENA.OY + y * T + T / 2;
const hexNum = (h: string) => parseInt(h.slice(1), 16);

interface Fig {
  f: Phaser.GameObjects.Container;
  ring: Phaser.GameObjects.Ellipse;
  x: number;
  y: number;
  alive: boolean;
}

/** Bomben-Arena: Bomberman im Ferienhaus-Garten am Strand */
export class ArenaScene extends Phaser.Scene {
  private boxes = new Map<number, Phaser.GameObjects.Image>();
  private flooded = new Map<number, Phaser.GameObjects.Image>();
  private bombs = new Map<number, Phaser.GameObjects.Image>();
  private flames = new Map<string, Phaser.GameObjects.Image>();
  private items = new Map<string, Phaser.GameObjects.Image>();
  private figs = new Map<string, Fig>();
  private hud!: Phaser.GameObjects.Container;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private latest: ArenaState | null = null;
  private hudKey = '';
  private phaseKey = '';
  private round = 0;
  private floodShown = false;
  private clock = new Countdown();
  private juice!: Juice;
  private cheerRound = 0;

  constructor() {
    super('arena');
  }

  create() {
    this.boxes.clear();
    this.flooded.clear();
    this.bombs.clear();
    this.flames.clear();
    this.items.clear();
    this.figs.clear();
    this.latest = null;
    this.hudKey = '';
    this.phaseKey = '';
    this.round = 0;
    this.floodShown = false;
    this.cheerRound = 0;
    this.juice = new Juice(this, { depth: 1650 });

    const aw = ARENA.COLS * T;
    const ah = ARENA.ROWS * T;
    background(this, 'arena', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 711);
      paintSand(p, ARENA.OX, ARENA.OY, aw, ah, 712);
      // dezentes Kachelraster im Sand
      for (let y = 1; y < ARENA.ROWS - 1; y++) {
        for (let x = 1; x < ARENA.COLS - 1; x++) {
          if ((x + y) % 2 === 0) p.rect(ARENA.OX + x * T, ARENA.OY + y * T, T, T, 'rgba(223,184,120,0.25)');
        }
      }
      // Hecke als Rand
      for (let y = 0; y < ARENA.ROWS; y++) {
        for (let x = 0; x < ARENA.COLS; x++) {
          if (x === 0 || y === 0 || x === ARENA.COLS - 1 || y === ARENA.ROWS - 1) p.draw(hedge(x * 31 + y * 7), ARENA.OX + x * T, ARENA.OY + y * T);
        }
      }
      // Schatten der Hecke auf dem Sand
      p.rect(ARENA.OX + T, ARENA.OY + T, aw - 2 * T, 2, 'rgba(0,0,0,0.15)');
      // Ferienhaus-Garten: ein paar Blumen außen
      for (let i = 0; i < 6; i++) p.draw(flower([C.pink, C.gold, C.white][i % 3]), 2 + (i % 2) * 465, 60 + i * 34);
    });
    // Feste Säulen: Palmen und Felsen
    for (let y = 2; y < ARENA.ROWS - 1; y += 2) {
      for (let x = 2; x < ARENA.COLS - 1; x += 2) {
        const palm = ((x + y) / 2) % 3 !== 0;
        const img = palm
          ? prop(this, `apalm${(x * y) % 3}`, () => arenaPalm((x * y) % 3), px(x), py(y) + 9)
          : prop(this, `arock${x % 2}`, () => arenaRock(x % 4), px(x), py(y) + 9);
        img.setDepth(py(y) + 9);
      }
    }
    prop(this, 'umbrellaR', () => umbrella(C.red), 8, ARENA.OY + 6).setDepth(1).setScale(0.5);

    this.hud = this.add.container(0, 0).setDepth(2000);
    this.banner = txt(this, WORLD.W / 2, 112, '', { size: 16, color: C.gold }).setDepth(2001);
    this.sub = txt(this, WORLD.W / 2, 136, '', { size: 8 }).setDepth(2001);
    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  update() {
    const st = this.latest;
    if (!st) return;
    const now = this.time.now;
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a || !a.alive) continue;
      a.x += (p.x - a.x) * 0.45;
      a.y += (p.y - a.y) * 0.45;
      const img = a.f.getData('img') as Phaser.GameObjects.Image;
      if (p.dir === 'l' || p.dir === 'r') img.setFlipX(p.dir === 'l');
      img.setY(p.moving ? -Math.abs(Math.sin(now / 70)) * 2 : 0);
      a.f.setPosition(px(a.x), py(a.y) + 7).setDepth(py(a.y) + 7);
      a.ring.setPosition(px(a.x), py(a.y) + 6);
    }
    for (const b of st.bombs) {
      const img = this.bombs.get(b.id);
      if (!img) continue;
      const fast = (img.getData('born') as number) + b.fuse - now < 800;
      img.setScale(1 + Math.sin(now / (fast ? 45 : 130)) * 0.1);
      if (fast) img.setTint(Math.sin(now / 45) > 0 ? 0xffb0a0 : 0xffffff);
    }
    if (st.sub === 'countdown') this.banner.setText(String(Math.max(1, this.clock.seconds)));
  }

  private resetRound(st: ArenaState) {
    for (const m of [this.boxes, this.flooded, this.bombs]) {
      for (const img of m.values()) img.destroy();
      m.clear();
    }
    for (const m of [this.flames, this.items]) {
      for (const img of m.values()) img.destroy();
      m.clear();
    }
    this.floodShown = false;
    for (const [id, p] of Object.entries(st.players)) {
      let a = this.figs.get(id);
      if (!a) {
        const pl = playerById(id);
        if (!pl) continue;
        const color = hexNum(SHIRTS[pl.look.shirt] ?? '#ffffff');
        const ring = this.add.ellipse(px(p.x), py(p.y) + 6, 14, 6).setStrokeStyle(1, color).setDepth(2);
        const f = figure(this, pl.look, px(p.x), py(p.y) + 7);
        a = { f, ring, x: p.x, y: p.y, alive: true };
        this.figs.set(id, a);
      }
      a.x = p.x;
      a.y = p.y;
      a.alive = p.alive;
      this.tweens.killTweensOf(a.f);
      a.f.setVisible(p.alive).setAlpha(1).setAngle(0).setPosition(px(p.x), py(p.y) + 7);
      a.ring.setVisible(p.alive).setPosition(px(p.x), py(p.y) + 6);
    }
  }

  private onState(s: GameState) {
    if (s.mini?.kind !== 'arena') return;
    const st = s.mini.state;
    this.latest = st;
    if (st.round !== this.round) {
      this.round = st.round;
      this.resetRound(st);
    }
    const key = `${st.sub}-${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.clock.set(st.endsIn);
      this.onPhase(st);
    }

    // Kisten & Flut
    for (let i = 0; i < st.grid.length; i++) {
      const c = st.grid[i];
      const x = i % ARENA.COLS;
      const y = Math.floor(i / ARENA.COLS);
      const box = this.boxes.get(i);
      if (c === 'b' && !box) {
        const v = (x * 7 + y * 13) % 5;
        const img =
          v < 2
            ? prop(this, 'sandcastle', sandcastle, px(x), py(y) + 9)
            : v < 4
              ? prop(this, `lounger${v}`, () => lounger(v === 2 ? C.blue : C.red), px(x), py(y) + 9)
              : prop(this, 'cooler', () => cooler('#2fb5a5'), px(x), py(y) + 9);
        this.boxes.set(i, img);
      } else if (c !== 'b' && box) {
        this.boxes.delete(i);
        this.tweens.add({ targets: box, scaleX: 1.4, scaleY: 0.2, alpha: 0, duration: 260, onComplete: () => box.destroy() });
        this.puff(px(x), py(y), 0xf1d49a);
        this.juice.burst(px(x), py(y), (x * 7 + y * 13) % 5 < 2 ? 'sand' : 'wood', 8);
      }
      if (c === '~' && !this.flooded.has(i)) {
        const img = this.add.image(px(x), py(y), ensureTex(this, `flood${(x + y) % 3}`, () => floodTile((x + y) % 3))).setDepth(py(y) - 9).setAlpha(0);
        this.tweens.add({ targets: img, alpha: 0.95, duration: 200 });
        this.flooded.set(i, img);
        // Flut: leises Plätschern je Zelle (gedrosselt in sfx)
        if (st.floodActive) sfx('splash', { x: px(x), vol: 0.25, pitch: 1.3 });
      }
    }

    // Bomben
    const bombIds = new Set(st.bombs.map((b) => b.id));
    for (const [id, img] of this.bombs) {
      if (!bombIds.has(id)) {
        img.destroy();
        this.bombs.delete(id);
      }
    }
    for (const b of st.bombs) {
      if (this.bombs.has(b.id)) continue;
      const pl = playerById(b.owner);
      const shirt = SHIRTS[pl?.look.shirt ?? 0] ?? '#3f8fe0';
      const balloon = (pl?.look.shirt ?? 0) % 2 === 1;
      const key = balloon ? ensureTex(this, `wb_${shirt}`, () => waterBalloon(shirt)) : ensureTex(this, 'coconut', coconut);
      const img = this.add.image(px(b.x), py(b.y) + 1, key).setDepth(py(b.y) + 1);
      img.setData('born', this.time.now - (ARENA.FUSE_MS - b.fuse));
      this.bombs.set(b.id, img);
      // Bombe legen: kurzes „Plopp“ (nur frisch gelegte, nicht beim Aufbau)
      if (b.fuse > ARENA.FUSE_MS - 400) {
        sfx('pop', { x: px(b.x), pitch: balloon ? 0.9 : 0.6 });
        img.setScale(0.4);
        this.tweens.add({ targets: img, scale: 1, duration: 160, ease: 'Back.Out' });
      }
    }

    // Explosionen
    const fl = new Set(st.flames.map((f) => `${cellIdx(f.x, f.y)}-${f.k}`));
    for (const [k, img] of this.flames) {
      if (!fl.has(k)) {
        this.tweens.add({ targets: img, alpha: 0, duration: 120, onComplete: () => img.destroy() });
        this.flames.delete(k);
      }
    }
    let boom = false;
    let boomX = 0;
    for (const f of st.flames) {
      const k = `${cellIdx(f.x, f.y)}-${f.k}`;
      if (this.flames.has(k)) continue;
      boom = true;
      if (f.k === 'c') {
        boomX = px(f.x);
        this.juice.burst(px(f.x), py(f.y), 'splash', 16);
        sfx('boom', { x: boomX, vol: 0.7 });
        sfx('splash', { x: boomX, delay: 0.04 });
      } else if ((f.x + f.y) % 2 === 0) this.juice.burst(px(f.x), py(f.y), 'splash', 3);
      const img = this.add.image(px(f.x), py(f.y), ensureTex(this, `splash_${f.k}`, () => splash(f.k))).setDepth(1500).setAlpha(0.92);
      img.setScale(0.6);
      this.tweens.add({ targets: img, scale: 1, duration: 90 });
      this.flames.set(k, img);
    }
    if (boom) this.juice.shake(1);

    // Power-ups
    const its = new Set(st.items.map((it) => `${cellIdx(it.x, it.y)}-${it.t}`));
    for (const [k, img] of this.items) {
      if (!its.has(k)) {
        // Eingesammelt (ein Spieler steht drauf) oder von der Explosion weggespült?
        const [ci] = k.split('-');
        const cx = Number(ci) % ARENA.COLS;
        const cy = Math.floor(Number(ci) / ARENA.COLS);
        const taker = Object.values(st.players).find((p) => p.alive && Math.round(p.x) === cx && Math.round(p.y) === cy);
        if (taker) {
          sfx('powerup', { x: px(cx) });
          this.juice.burst(px(cx), py(cy), 'spark', 8);
          const label = k.endsWith('bomb') ? '+1 BOMBE' : k.endsWith('range') ? '+REICHWEITE' : '+TEMPO';
          this.juice.float(px(cx), py(cy) - 24, label, 'gold');
        }
        this.tweens.killTweensOf(img);
        this.tweens.add({ targets: img, scale: 0, duration: 150, onComplete: () => img.destroy() });
        this.items.delete(k);
      }
    }
    for (const it of st.items) {
      const k = `${cellIdx(it.x, it.y)}-${it.t}`;
      if (this.items.has(k)) continue;
      const img = this.add.image(px(it.x), py(it.y), ensureTex(this, `aitem_${it.t}`, () => itemIcon(it.t))).setDepth(py(it.y) - 2);
      this.tweens.add({ targets: img, y: py(it.y) - 2, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.items.set(k, img);
    }

    // Spieler: Platsch!
    for (const [id, p] of Object.entries(st.players)) {
      const a = this.figs.get(id);
      if (!a) continue;
      if (a.alive && !p.alive) {
        a.alive = false;
        this.platsch(a, id);
      }
    }

    if (st.floodActive && !this.floodShown) {
      this.floodShown = true;
      this.flash('FLUT!', 'Das Meer holt sich die Arena …');
      sfx('whoosh', { vol: 1.2, pitch: 0.6 });
      sfx('splash', { vol: 0.9, pitch: 0.7, delay: 0.25 });
      this.juice.shake(2);
    }
    this.drawHud(st);
  }

  private onPhase(st: ArenaState) {
    this.tweens.killTweensOf([this.banner, this.sub]);
    this.banner.setAlpha(1);
    this.sub.setAlpha(1);
    if (st.sub === 'countdown') {
      this.banner.setText('3');
      this.sub.setText(`Runde ${st.round} – wer zuerst ${st.winRounds} Runden gewinnt!`);
    } else if (st.sub === 'play') {
      this.flash('LOS!', '');
    } else if (st.sub === 'roundOver' || st.sub === 'over') {
      const w = st.roundWinner ? playerById(st.roundWinner)?.name ?? '?' : null;
      this.banner.setText(w ? `${w} gewinnt!` : 'Alle nass!');
      if (this.cheerRound !== st.round) {
        this.cheerRound = st.round;
        sfx(w ? 'win' : 'lose');
        const wf = st.roundWinner ? this.figs.get(st.roundWinner) : undefined;
        if (wf) this.juice.burst(px(wf.x), py(wf.y) - 10, 'confetti', 30);
      }
      this.sub.setText(st.sub === 'over' ? 'Arena vorbei!' : w ? 'Rundensieg – trocken geblieben!' : 'Unentschieden – diese Runde zählt nicht.');
    }
  }

  private flash(text: string, sub: string) {
    this.banner.setText(text).setAlpha(1);
    this.sub.setText(sub).setAlpha(1);
    this.tweens.add({
      targets: [this.banner, this.sub],
      alpha: 0,
      delay: 900,
      duration: 400,
      onComplete: () => {
        this.banner.setText('').setAlpha(1);
        this.sub.setText('').setAlpha(1);
      },
    });
  }

  private puff(x: number, y: number, color: number) {
    for (let i = 0; i < 5; i++) {
      const d = this.add.circle(x, y, 2, color).setDepth(1400);
      const a = (i / 5) * Math.PI * 2;
      this.tweens.add({ targets: d, x: x + Math.cos(a) * 9, y: y + Math.sin(a) * 7, alpha: 0, duration: 320, onComplete: () => d.destroy() });
    }
  }

  private platsch(a: Fig, id: string) {
    const x = px(a.x);
    const y = py(a.y);
    a.ring.setVisible(false);
    this.juice.burst(x, y, 'splash', 14);
    sfx('splash', { x, pitch: 0.9 });
    this.juice.shake(1);
    this.tweens.add({ targets: a.f, angle: 90, alpha: 0, y: a.f.y + 4, duration: 600, onComplete: () => a.f.setVisible(false) });
    for (let i = 0; i < 8; i++) {
      const d = this.add.circle(x, y, 2, i % 2 ? 0xeaf8ff : 0x93d3f3).setDepth(1600);
      const ang = (i / 8) * Math.PI * 2;
      this.tweens.add({ targets: d, x: x + Math.cos(ang) * 14, y: y + Math.sin(ang) * 10 - 6, alpha: 0, duration: 500, onComplete: () => d.destroy() });
    }
    const name = playerById(id)?.name ?? '';
    const t = txt(this, x, y - 30, 'Platsch!', { color: '#93d3f3' }).setDepth(1700);
    const n = txt(this, x, y - 20, name.slice(0, 8)).setDepth(1700);
    this.tweens.add({ targets: [t, n], y: '-=14', alpha: 0, delay: 500, duration: 900, onComplete: () => (t.destroy(), n.destroy()) });
  }

  private drawHud(st: ArenaState) {
    const ids = Object.keys(st.players);
    const secs = st.sub === 'play' && !st.floodActive ? Math.ceil(st.endsIn / 1000) : -1;
    const key = JSON.stringify([secs, st.sub, st.round, st.floodActive, ids.map((id) => [st.players[id].alive, st.players[id].wins])]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(panel(this, 2, 1, 476, 32));
    const clock = st.floodActive ? 'FLUT!' : secs >= 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '--';
    this.hud.add(ink(this, 10, 6, `Runde ${st.round}`, { origin: [0, 0] }));
    this.hud.add(ink(this, 10, 19, clock, { origin: [0, 0], color: st.floodActive ? '#2d64a8' : undefined }));
    // Spielerliste: Porträt + Siege
    const n = ids.length;
    const slot = Math.min(36, Math.floor(390 / Math.max(1, n)));
    const x0 = 84 + (390 - slot * n) / 2;
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const p = st.players[id];
      if (!pl) return;
      const cx = x0 + i * slot + slot / 2;
      const img = this.add.image(cx, 5, ensurePortrait(this, pl.look)).setOrigin(0.5, 0).setAlpha(p.alive ? 1 : 0.35);
      this.hud.add(img);
      if (!p.alive && st.sub !== 'countdown') this.hud.add(ink(this, cx, 8, 'x', { color: '#2d64a8' }));
      for (let w = 0; w < st.winRounds; w++) {
        const dot = this.add.rectangle(cx - (st.winRounds - 1) * 3 + w * 6, 25, 4, 4, w < p.wins ? 0xffd25e : 0x000000, w < p.wins ? 1 : 0.2);
        this.hud.add(dot);
      }
    });
  }
}
