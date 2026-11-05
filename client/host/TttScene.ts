import Phaser from 'phaser';
import type { GameState, TttAttack, TttBody, TttState } from '../../shared/types';
import { TTT, TTT_ROLES } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { bananaPeel, coconut, detectiveHat, dizzy, medkit, NOODLE_COLORS, waterPistol } from '../art/ttt';
import type { Pix } from '../art/pix';
import { addHouse } from './house';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { BLUE_INK, Countdown, GOLD, GREEN_INK, INK, NameTags, RED_INK, ensureTex, ink, nameTag, panel, tagName, txt } from './ui';

import { Juice } from './juice';
import { sfx } from './sfx';

/** Figuren stehen mit den Füßen etwas unter dem Server-Punkt (der ist Körpermitte) */
const FOOT = 8;

interface Fig {
  c: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Graphics;
  held: Phaser.GameObjects.Image;
  stars: Phaser.GameObjects.Image;
  x: number;
  y: number;
  hp: number;
  name: string;
}

const ITEM_TEX: Record<string, () => Pix> = { pistol: waterPistol, coconut, medkit };
const FEED_COLORS = { info: INK, radio: BLUE_INK, clue: '#7a3fa0', alert: RED_INK };

export class TttScene extends Phaser.Scene {
  private figs = new Map<string, Fig>();
  private items = new Map<number, Phaser.GameObjects.Image>();
  private bodies = new Map<string, Phaser.GameObjects.Container>();
  private juice!: Juice;
  private tags!: NameTags;
  private bodyRole = new Map<string, string | null>();
  private overlay!: Phaser.GameObjects.Container;
  private hud!: Phaser.GameObjects.Container;
  private feedText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private countdown = new Countdown();
  private latest: TttState | null = null;
  private round = 0;
  private phaseKey = '';
  private hudKey = '';
  private lastAttack = 0;
  private lastTrap = 0;
  private lastFeed = 0;

  constructor() {
    super('ttt');
  }

  create() {
    this.juice = new Juice(this, { depth: 1450 });
    this.tags = new NameTags(this, 1300);
    this.figs.clear();
    this.items.clear();
    this.bodies.clear();
    this.bodyRole.clear();
    this.latest = null;
    this.round = 0;
    this.phaseKey = '';
    this.hudKey = '';
    const st = getState();
    // Alte Effekte nicht noch einmal abspielen, wenn die Szene mitten im Spiel startet
    const t = st?.mini?.kind === 'ttt' ? st.mini.state : null;
    this.lastAttack = t?.attacks.at(-1)?.seq ?? 0;
    this.lastTrap = t?.traps.at(-1)?.seq ?? 0;
    this.lastFeed = 0;

    addHouse(this, { ySort: true, labelDepth: 5 });
    // Abendstimmung
    this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1840, 0.16).setOrigin(0).setDepth(900);

    panel(this, 0, 0, WORLD.W, 34).setDepth(1000);
    this.hud = this.add.container(0, 0).setDepth(1001);
    this.timerText = ink(this, WORLD.W - 10, 6, '', { origin: [1, 0] }).setDepth(1002);
    this.feedText = ink(this, WORLD.W / 2, 20, '', { origin: [0.5, 0] }).setDepth(1002);
    this.overlay = this.add.container(0, 0).setDepth(2000);

    const onState = (s: GameState) => this.onState(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.onState(st);
  }

  update() {
    const sec = this.countdown.seconds;
    this.timerText.setText(sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '');
    const t = this.latest;
    if (!t) return;
    const specs: { id: string; x: number; y: number; name: string; color: string }[] = [];
    for (const [id, f] of this.figs) {
      const p = t.players[id];
      if (!p) continue;
      f.x += (p.x - f.x) * 0.35;
      f.y += (p.y - f.y) * 0.35;
      f.img.setFlipX(p.dir < 0);
      f.img.setY(p.moving ? -Math.abs(Math.sin(this.time.now / 80)) * 2 : 0);
      f.img.setAngle(p.stunned ? Math.sin(this.time.now / 60) * 12 : 0);
      f.c.setPosition(Math.round(f.x), Math.round(f.y + FOOT)).setDepth(f.y + FOOT);
      if (f.c.visible) specs.push({ id, x: Math.round(f.x), y: Math.round(f.y + FOOT) - 45, name: f.name, color: id === t.detective ? '#9cc7ff' : '#fff4d6' });
    }
    this.tags.update(specs);
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'ttt') return;
    const t = s.mini.state;
    this.latest = t;
    if (t.round !== this.round) this.newRound(t);
    const key = `${t.sub}-${t.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.countdown.set(t.endsIn);
      this.renderOverlay(t);
    }
    this.syncFigures(t);
    this.syncItems(t);
    this.syncBodies(t);
    this.playEffects(t);
    this.renderHud(t);
  }

  private newRound(t: TttState) {
    this.round = t.round;
    for (const f of this.figs.values()) f.c.destroy();
    this.figs.clear();
    for (const i of this.items.values()) i.destroy();
    this.items.clear();
    for (const b of this.bodies.values()) b.destroy();
    this.bodies.clear();
    this.bodyRole.clear();
    this.lastAttack = t.attacks.at(-1)?.seq ?? 0;
    this.lastTrap = t.traps.at(-1)?.seq ?? 0;
  }

  private syncFigures(t: TttState) {
    for (const [id, p] of Object.entries(t.players)) {
      let f = this.figs.get(id);
      if (!f) {
        const pl = playerById(id);
        if (!pl) continue;
        const c = figure(this, pl.look, p.x, p.y + FOOT);
        const img = c.getData('img') as Phaser.GameObjects.Image;
        if (id === t.detective) c.add(this.add.image(0, -21, ensureTex(this, 'ttt_hat', detectiveHat)).setOrigin(0.5, 1));
        const pips = this.add.graphics();
        const held = this.add.image(7, -9, ensureTex(this, 'ttt_pistol', waterPistol)).setVisible(false);
        const stars = this.add.image(0, -30, ensureTex(this, 'ttt_dizzy', dizzy)).setVisible(false);
        c.add([held, pips, stars]);
        f = { c, img, pips, held, stars, x: p.x, y: p.y, hp: -1, name: tagName(pl.name) };
        this.figs.set(id, f);
      }
      f.c.setVisible(true);
      if (f.hp !== p.hp) {
        if (f.hp > p.hp && f.hp !== -1) this.flash(f);
        f.hp = p.hp;
        f.pips.clear();
        for (let k = 0; k < TTT.HP; k++) {
          f.pips.fillStyle(0x2d1b12).fillRect(-7 + k * 5, -33, 4, 4);
          f.pips.fillStyle(k < p.hp ? 0xe0503f : 0x6e6a62).fillRect(-6 + k * 5, -32, 2, 2);
        }
      }
      if (p.weapon) {
        f.held.setTexture(ensureTex(this, `ttt_${p.weapon}`, ITEM_TEX[p.weapon])).setVisible(true);
        f.held.setFlipX(p.dir < 0).setX(p.dir * 8);
      } else {
        f.held.setVisible(false);
      }
      f.stars.setVisible(p.stunned);
    }
    for (const [id, f] of this.figs) {
      if (t.players[id]) continue;
      if (!t.alive[id]) {
        f.c.destroy();
        this.figs.delete(id);
      } else {
        // Tarnumhang: einfach weg
        f.c.setVisible(false);
      }
    }
  }

  private flash(f: Fig) {
    f.img.setTintFill(0xffffff);
    this.time.delayedCall(90, () => f.img.clearTint());
  }

  private syncItems(t: TttState) {
    const alive = new Set(t.items.map((i) => i.id));
    for (const [id, img] of this.items) {
      if (alive.has(id)) continue;
      this.tweens.add({ targets: img, y: img.y - 8, alpha: 0, duration: 250, onComplete: () => img.destroy() });
      this.items.delete(id);
    }
    for (const it of t.items) {
      if (this.items.has(it.id)) continue;
      const img = this.add.image(it.x, it.y + 3, ensureTex(this, `ttt_${it.kind}`, ITEM_TEX[it.kind])).setDepth(it.y);
      this.tweens.add({ targets: img, y: it.y + 1, duration: 600 + (it.id % 5) * 80, yoyo: true, repeat: -1 });
      this.items.set(it.id, img);
    }
  }

  private syncBodies(t: TttState) {
    for (const b of t.bodies) {
      if (this.bodies.has(b.id) && this.bodyRole.get(b.id) === b.role) continue;
      // Leiche gefunden (Rolle aufgedeckt): dumpfer Gong
      if (this.bodies.has(b.id) && b.role) sfx('drumroll', { x: b.x, vol: 0.6 });
      this.bodies.get(b.id)?.destroy();
      this.bodies.set(b.id, this.makeBody(b));
      this.bodyRole.set(b.id, b.role);
    }
  }

  private makeBody(b: TttBody) {
    const pl = playerById(b.id);
    const c = this.add.container(b.x, b.y + 4).setDepth(b.y - 2);
    if (pl) {
      const f = figure(this, pl.look, 0, 0);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      img.setAngle(90).setTint(0xb0b0b0).setOrigin(0.5, 0.5).setY(-4);
      c.add(f);
      c.add(this.add.image(0, -14, ensureTex(this, 'ttt_dizzy', dizzy)));
    }
    if (b.role) {
      const role = TTT_ROLES[b.role];
      c.add(nameTag(this, 0, 6, role.name, role.color));
    } else {
      const q = txt(this, 0, -26, '?', { color: GOLD });
      this.tweens.add({ targets: q, y: -29, duration: 500, yoyo: true, repeat: -1 });
      c.add(q);
    }
    return c;
  }

  // ---------------------------------------------------------------- Effekte

  private playEffects(t: TttState) {
    for (const a of t.attacks) {
      if (a.seq <= this.lastAttack) continue;
      this.lastAttack = a.seq;
      this.attackFx(a);
    }
    for (const tr of t.traps) {
      if (tr.seq <= this.lastTrap) continue;
      this.lastTrap = tr.seq;
      const peel = this.add.image(tr.x, tr.y + 4, ensureTex(this, 'ttt_banana', bananaPeel)).setDepth(tr.y);
      this.tweens.add({ targets: peel, alpha: 0, delay: 1500, duration: 600, onComplete: () => peel.destroy() });
      this.pop(tr.x, tr.y - 22, 'Ausgerutscht!', GOLD);
      sfx('whoosh', { x: tr.x, pitch: 1.5 });
      sfx('bonk', { x: tr.x, delay: 0.15 });
    }
  }

  private attackFx(a: TttAttack) {
    const y1 = a.y1 - 4;
    const y2 = a.y2 - 4;
    if (a.kind === 'noodle') {
      const color = NOODLE_COLORS[a.seq % NOODLE_COLORS.length];
      const ang = Math.atan2(y2 - y1, a.x2 - a.x1);
      const g = this.add.graphics().setDepth(Math.max(a.y1, a.y2) + 20);
      g.lineStyle(4, 0x2d1b12).lineBetween(0, 0, 16, 0);
      g.lineStyle(2, color).lineBetween(0, 0, 16, 0);
      g.setPosition(a.x1, y1).setRotation(ang - 0.9);
      this.tweens.add({ targets: g, rotation: ang + 0.9, duration: 140, onComplete: () => this.tweens.add({ targets: g, alpha: 0, duration: 120, onComplete: () => g.destroy() }) });
      sfx('whoosh', { x: a.x1, vol: 0.5 });
      if (a.target) sfx(a.ko ? 'hitHard' : 'bonk', { x: a.x2, delay: 0.1 });
      if (a.target) this.pop(a.x2, y2 - 18, a.ko ? 'K.O.!' : 'BONK!', a.ko ? '#ff6b5e' : '#fff4d6');
    } else if (a.kind === 'pistol') {
      const d = Math.hypot(a.x2 - a.x1, y2 - y1);
      sfx('shoot', { x: a.x1, pitch: 1.3, vol: 0.6 });
      if (a.target) sfx('splash', { x: a.x2, vol: 0.6, delay: Math.max(80, d * 2) / 1000 });
      for (let k = 0; k < 4; k++) {
        const drop = this.add.circle(a.x1, y1, 1.5, 0x93d3f3).setDepth(900).setStrokeStyle(1, 0x2b6ba6);
        this.tweens.add({ targets: drop, x: a.x2, y: y2, delay: k * 35, duration: Math.max(80, d * 2), onComplete: () => drop.destroy() });
      }
      this.time.delayedCall(Math.max(80, d * 2), () => {
        const splash = this.add.circle(a.x2, y2, 3, 0xeaf8ff, 0.9).setDepth(900);
        this.tweens.add({ targets: splash, scale: 2.5, alpha: 0, duration: 300, onComplete: () => splash.destroy() });
        if (a.target) this.pop(a.x2, y2 - 18, a.ko ? 'K.O.!' : 'PLATSCH!', a.ko ? '#ff6b5e' : '#bfe8ff');
      });
    } else {
      const nut = this.add.image(a.x1, y1, ensureTex(this, 'ttt_coconut', coconut)).setDepth(900);
      const d = Math.hypot(a.x2 - a.x1, y2 - y1);
      sfx('throw', { x: a.x1 });
      if (a.target) sfx('bonk', { x: a.x2, pitch: 0.7, delay: Math.max(150, d * 3) / 1000 });
      this.tweens.add({ targets: nut, x: a.x2, y: y2, angle: 540, duration: Math.max(150, d * 3), onComplete: () => {
        nut.destroy();
        if (a.target) this.pop(a.x2, y2 - 18, a.ko ? 'K.O.!' : 'KLONK!', a.ko ? '#ff6b5e' : '#ffd25e');
      } });
    }
    if (a.ko) {
      // Angriff mit K.O.: kurzer Stopp, Schreck-Ton
      this.juice.shake(2);
      this.juice.hitStop(90);
      this.juice.burst(a.x2, y2 - 6, 'puff', 10);
      sfx('ko', { x: a.x2, delay: 0.12 });
    }
  }

  private pop(x: number, y: number, text: string, color: string) {
    const t = txt(this, x, y, text, { color }).setDepth(1500);
    this.tweens.add({ targets: t, y: y - 12, alpha: 0, duration: 900, delay: 200, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- HUD + Karten

  private renderHud(t: TttState) {
    const aliveN = Object.values(t.alive).filter(Boolean).length;
    const total = Object.keys(t.alive).length;
    const key = JSON.stringify([t.round, aliveN, t.sub, t.feed.at(-1)?.seq]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.hud.removeAll(true);
    this.hud.add(ink(this, 10, 6, `Runde ${t.round}/${t.rounds}`, { origin: [0, 0] }));
    this.hud.add(ink(this, WORLD.W / 2, 6, `Im Spiel: ${aliveN}/${total}`, { color: GREEN_INK }));
    const f = t.feed.at(-1);
    if (f && f.seq !== this.lastFeed) {
      this.lastFeed = f.seq;
      this.feedText.setText(f.text).setColor(FEED_COLORS[f.tone]).setScale(1);
      if (this.feedText.width > 464) this.feedText.setScale(464 / this.feedText.width);
      this.tweens.add({ targets: this.feedText, alpha: { from: 0.2, to: 1 }, duration: 160, repeat: 2 });
    } else if (!f) {
      this.feedText.setText(t.sub === 'play' ? 'Wer ist der Verräter? Bleibt zusammen!' : '').setColor(INK).setScale(1);
    }
  }

  private card(title: string, sub: string, h: number, titleColor = RED_INK) {
    const y = 152 - h / 2;
    this.overlay.add(this.add.rectangle(0, 34, WORLD.W, WORLD.H - 34, 0x1a1008, 0.45).setOrigin(0));
    this.overlay.add(panel(this, 60, y, 360, h));
    const head = ink(this, WORLD.W / 2, y + 12, title, { size: 16, color: titleColor });
    // Lange Titel lieber verkleinern als umbrechen
    if (head.width > 340) head.setScale(340 / head.width);
    this.overlay.add(head);
    if (sub) this.overlay.add(ink(this, WORLD.W / 2, y + 36, sub, { wrap: 330 }));
    return y;
  }

  private renderOverlay(t: TttState) {
    this.overlay.removeAll(true);
    if (t.sub === 'roles') {
      const y = this.card(`Runde ${t.round} von ${t.rounds}`, 'Schaut heimlich aufs Handy –\ndort steht eure Rolle!', 150);
      this.overlay.add(ink(this, WORLD.W / 2, y + 68, `Unter euch: ${t.traitorCount} Verräter`, { color: RED_INK }));
      const det = playerById(t.detective);
      if (det) {
        const f = figure(this, det.look, WORLD.W / 2 - 60, y + 140, 2);
        f.add(this.add.image(0, -42, ensureTex(this, 'ttt_hat', detectiveHat)).setOrigin(0.5, 1).setScale(2));
        this.overlay.add(f);
        this.overlay.add(ink(this, WORLD.W / 2 + 20, y + 100, `Detektiv:\n${det.name}`, { color: BLUE_INK }));
      } else {
        this.overlay.add(ink(this, WORLD.W / 2, y + 96, 'Poolnudeln bereit?\nWasserpistolen liegen im Haus!', { color: '#7a5a3a' }));
      }
    } else if (t.sub === 'roundEnd' && t.last) {
      const win = t.last.winner === 'traitor';
      if (this.overlay.getData('fx') !== `end-${t.round}`) {
        this.overlay.setData('fx', `end-${t.round}`);
        sfx(win ? 'lose' : 'win');
        sfx('drumroll', { vol: 0.5 });
      }

      const y = this.card(win ? 'Die Verräter gewinnen!' : 'Die Unschuldigen gewinnen!', t.last.reason, 190, win ? RED_INK : GREEN_INK);
      this.overlay.add(ink(this, WORLD.W / 2, y + 60, t.last.traitors.length > 1 ? 'Die Verräter waren:' : 'Der Verräter war:', { color: RED_INK }));
      const n = t.last.traitors.length;
      t.last.traitors.forEach((id, i) => {
        const p = playerById(id);
        if (!p) return;
        const x = WORLD.W / 2 + (i - (n - 1) / 2) * 90;
        this.overlay.add(figure(this, p.look, x, y + 124, 2));
        this.overlay.add(nameTag(this, x, y + 128, p.name, RED_INK));
      });
      const best = Object.entries(t.last.points).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const line = best.map(([id, pts]) => `${(playerById(id)?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 6)} ${pts >= 0 ? '+' : ''}${pts}`).join('  ');
      this.overlay.add(ink(this, WORLD.W / 2, y + 160, line, { color: '#7a5a3a' }));
    } else if (t.sub === 'over') {
      const y = this.card('Endstand', '', 190);
      const order = Object.entries(t.scores).sort((a, b) => b[1] - a[1]).slice(0, 6);
      order.forEach(([id, pts], i) => {
        const p = playerById(id);
        this.overlay.add(ink(this, 120, y + 44 + i * 22, `${i + 1}. ${p?.name ?? '?'}`, { origin: [0, 0], color: i === 0 ? RED_INK : INK }));
        this.overlay.add(ink(this, 360, y + 44 + i * 22, `${pts} P`, { origin: [1, 0] }));
      });
    }
  }
}
