import Phaser from 'phaser';
import type { GameState, SmashFighter, SmashFx, SmashState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { SMASH, SMASH_STAGES, type SmashPlatform, pctColor, platformPos } from '../../shared/smash';
import * as A from '../art/smash';
import { bus, getState, playerById } from './store';
import { avatarSprite, ensurePortrait, playAvatar } from './textures';
import { pcol } from './playerColor';
import { ensureTex, txt } from './ui';
import { Juice } from './juice';
import { SnapBuffer, lerp, lerpJump } from './interp';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

type C = Phaser.GameObjects.Container;

/** Spielerfarben (nach Reihenfolge), damit man sich auch bei gleichem Shirt unterscheidet */
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const ATTACK_ANIMS = new Set(['jab', 'side', 'up', 'down', 'nair', 'dair']);
const HUD_Y = 236;

interface Fig {
  root: C;
  img: Phaser.GameObjects.Sprite;
  shield: Phaser.GameObjects.Arc;
  prop: Phaser.GameObjects.Image;
  held: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  swoosh: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  atkSeq: number;
  atkAt: number;
  atkAnim: string;
  spin: number;
  trailAt: number;
  color: number;
  visible: boolean;
}

interface Card {
  root: C;
  pct: Phaser.GameObjects.Text;
  pctSign: Phaser.GameObjects.Text;
  stocks: Phaser.GameObjects.Graphics;
  out: Phaser.GameObjects.Text;
  key: string;
}

export class SmashScene extends Phaser.Scene {
  private latest: SmashState | null = null;
  /** Wiedergabe-Uhr: 60 ms hinter dem Server, Hit-Stop/Zeitlupe über `juice` */
  private buf = new SnapBuffer<SmashState>();
  private built = '';
  private bgL!: C;
  private actL!: C;
  private fxL!: C;
  private hud!: C;
  private hudCam!: Phaser.Cameras.Scene2D.Camera;
  private plats: { p: SmashPlatform; img: Phaser.GameObjects.Image; ox: number; oy: number }[] = [];
  private figs = new Map<string, Fig>();
  private projs = new Map<number, Phaser.GameObjects.Image>();
  private items = new Map<number, Phaser.GameObjects.Image>();
  private cards = new Map<string, Card>();
  private markers = new Map<string, C>();
  private beamG!: Phaser.GameObjects.Graphics;
  private banner!: Phaser.GameObjects.Text;
  private subline!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private flash!: Phaser.GameObjects.Rectangle;
  private fxSeen = -1;
  private lastSub = '';
  private cam = { x: 240, y: 135, z: 1 };
  private juice!: Juice;

  constructor() {
    super('smash');
  }

  create() {
    this.latest = null;
    this.built = '';
    this.plats = [];
    this.figs.clear();
    this.projs.clear();
    this.items.clear();
    this.cards.clear();
    this.markers.clear();
    this.fxSeen = -1;
    this.lastSub = '';
    this.cam = { x: 240, y: 135, z: 1 };
    this.buf = new SnapBuffer();

    this.bgL = this.add.container(0, 0).setDepth(0);
    this.actL = this.add.container(0, 0).setDepth(10);
    this.fxL = this.add.container(0, 0).setDepth(20);
    this.hud = this.add.container(0, 0).setDepth(100);
    this.beamG = this.add.graphics();
    this.fxL.add(this.beamG);
    this.juice = new Juice(this, { layer: this.fxL, hud: this.hud, manualZoom: true, clock: this.buf });

    const main = this.cameras.main;
    main.setBounds(0, 0, WORLD.W, WORLD.H).setZoom(1).centerOn(240, 135);
    main.ignore(this.hud);
    this.hudCam = this.cameras.add(0, 0, WORLD.W, WORLD.H);
    this.hudCam.ignore([this.bgL, this.actL, this.fxL]);

    this.timer = txt(this, WORLD.W / 2, 4, '', { size: 16 });
    this.banner = txt(this, WORLD.W / 2, 78, '', { size: 24, color: '#ffd25e' });
    this.subline = txt(this, WORLD.W / 2, 108, '', { size: 8 });
    this.flash = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0xffffff, 0).setOrigin(0, 0);
    this.hud.add([this.flash, this.timer, this.banner, this.subline]);

    const fn = (s: GameState) => this.onState(s);
    bus.on('state', fn);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', fn));
    const s = getState();
    if (s) this.onState(s);
  }

  // ---------------------------------------------------------------- Aufbau

  private build(st: SmashState) {
    if (this.built === st.stage) return;
    this.built = st.stage;
    const stage = SMASH_STAGES.find((x) => x.id === st.stage)!;
    const bgKey = ensureTex(this, `smash_bg_${st.stage}`, st.stage === 'beach' ? A.beachBackdrop : A.poolBackdrop);
    this.bgL.add(this.add.image(0, 0, bgKey).setOrigin(0, 0));
    if (st.stage === 'beach') this.bgL.add(txt(this, 240, 131, 'BAR', { color: '#a8342a', shadow: false }));
    for (const p of stage.platforms) {
      let key: string;
      let ox = 0;
      let oy = 0;
      switch (p.kind) {
        case 'deck':
          key = ensureTex(this, `smash_deck_${p.w}`, () => A.deckPix(p.w, p.h));
          break;
        case 'plank':
          key = ensureTex(this, `smash_plank_${p.w}`, () => A.plankPix(p.w));
          break;
        case 'surf':
          key = ensureTex(this, `smash_surf_${p.w}`, () => A.surfPix(p.w));
          oy = -1;
          break;
        case 'pooldeck':
          key = ensureTex(this, `smash_pooldeck_${p.w}`, () => A.poolDeckPix(p.w, p.h));
          break;
        case 'board': {
          const stand = p.x < 240 ? 'right' : 'left';
          key = ensureTex(this, `smash_board_${stand}`, () => A.divingBoardPix(p.w, stand, 48));
          break;
        }
        case 'flamingo':
          key = ensureTex(this, `smash_flamingo_${p.w}`, () => A.flamingoPix(p.w));
          ox = -6;
          oy = -17;
          break;
      }
      const img = this.add.image(p.x + ox, p.y + oy, key).setOrigin(0, 0);
      this.bgL.add(img);
      this.plats.push({ p, img, ox, oy });
    }
  }

  private ensureFig(id: string, idx: number) {
    let f = this.figs.get(id);
    if (f) return f;
    const pl = playerById(id);
    const color = pcol(id, idx).num;
    const root = this.add.container(0, 0);
    const shield = this.add.circle(0, -SMASH.H / 2, 20, color, 0.35).setStrokeStyle(2, 0xffffff, 0.8).setVisible(false);
    const img = (pl ? avatarSprite(this, pl.look) : this.add.sprite(0, 0, '__WHITE')).setOrigin(0.5, 1).setScale(SMASH.SCALE);
    const prop = this.add.image(0, 0, '__WHITE').setVisible(false);
    const held = this.add.image(0, 0, '__WHITE').setVisible(false);
    const swoosh = this.add.graphics();
    const tag = txt(this, 0, -SMASH.H - 18, (pl?.name ?? '?').replace(/^Bot\s+/, '').slice(0, 5), { color: hex(color) });
    root.add([img, held, prop, swoosh, shield, tag]);
    this.actL.add(root);
    f = { root, img, shield, prop, held, tag, swoosh, x: 0, y: 0, atkSeq: -1, atkAt: 0, atkAnim: '', spin: 0, trailAt: 0, color, visible: false };
    this.figs.set(id, f);
    return f;
  }

  private buildCards(st: SmashState) {
    const ids = Object.keys(st.fighters);
    if (this.cards.size === ids.length) return;
    for (const c of this.cards.values()) c.root.destroy();
    this.cards.clear();
    const n = ids.length;
    const cw = Math.min(116, Math.floor(476 / n));
    const x0 = Math.floor((WORLD.W - n * cw) / 2);
    ids.forEach((id, i) => {
      const pl = playerById(id);
      const color = pcol(id, i).num;
      const root = this.add.container(x0 + i * cw, HUD_Y);
      const bg = this.add.graphics();
      bg.fillStyle(0x2d1b12, 0.88).fillRect(1, 0, cw - 2, 34);
      bg.fillStyle(color, 1).fillRect(1, 0, cw - 2, 2);
      bg.lineStyle(1, 0x5e3518, 1).strokeRect(1.5, 0.5, cw - 3, 33);
      root.add(bg);
      if (pl) root.add(this.add.image(4, 4, ensurePortrait(this, pl.look)).setOrigin(0, 0));
      // Schmale Karten (viele Spieler): kein Name, die Leben stehen neben dem Porträt
      const narrow = cw < 84;
      if (!narrow) {
        const maxChars = Math.max(3, Math.floor((cw - 24) / 8));
        root.add(txt(this, 22, 4, (pl?.name ?? '?').replace(/^Bot\s+/, '').slice(0, maxChars), { color: hex(color), origin: [0, 0] }));
      }
      const stocks = this.add.graphics().setData('pipY', narrow ? 6 : 13);
      // Sehr schmale Karten (ab 11 Spielern): Prozente in kleiner Schrift, sonst ragen sie in die Nachbarkarte
      const tiny = cw < 60;
      const pct = tiny ? txt(this, cw - 9, 23, '0', { origin: [1, 0] }) : txt(this, cw - 10, 17, '0', { size: 16, origin: [1, 0] });
      const pctSign = txt(this, cw - 2, tiny ? 23 : 24, '%', { origin: [1, 0] });
      const out = txt(this, tiny ? cw / 2 : narrow ? cw / 2 + 8 : cw / 2, narrow ? 21 : 19, 'RAUS', { color: '#a7a39a', origin: [0.5, 0] }).setVisible(false);
      root.add([stocks, pct, pctSign, out]);
      this.hud.add(root);
      this.cards.set(id, { root, pct, pctSign, stocks, out, key: '' });
    });
  }

  // ---------------------------------------------------------------- Zustand

  private onState(s: GameState) {
    if (s.mini?.kind !== 'smash') return;
    const st = s.mini.state;
    this.build(st);
    this.latest = st;
    this.buf.push(st.ts, st);
    const ids = Object.keys(st.fighters);
    ids.forEach((id, i) => this.ensureFig(id, i));
    this.buildCards(st);

    // Items
    const itemIds = new Set(st.items.map((i) => i.id));
    for (const [id, img] of this.items) if (!itemIds.has(id)) (img.destroy(), this.items.delete(id));
    for (const it of st.items) {
      if (this.items.has(it.id)) continue;
      const img = this.add.image(it.x, it.y, this.itemTex(it.type)).setOrigin(0.5, 1);
      this.actL.add(img);
      this.items.set(it.id, img);
    }
    // Wurfgeschosse
    const projIds = new Set(st.projectiles.map((p) => p.id));
    for (const [id, img] of this.projs) if (!projIds.has(id)) (img.destroy(), this.projs.delete(id));
    for (const p of st.projectiles) {
      if (this.projs.has(p.id)) continue;
      const img = this.add.image(p.x, p.y, p.type === 'flipflop' ? ensureTex(this, 'sm_flipflop', A.flipflopPix) : this.itemTex(p.type));
      this.actL.add(img);
      this.projs.set(p.id, img);
    }

    // Effekte
    const maxSeq = st.fx.reduce((m, f) => Math.max(m, f.seq), 0);
    if (this.fxSeen < 0) this.fxSeen = maxSeq;
    // Effekte erst, wenn die Wiedergabe-Uhr den Stand erreicht – dann stehen die Figuren genau am Treffpunkt
    for (const fx of st.fx) if (fx.seq > this.fxSeen) this.buf.after(st.ts, () => this.playFx(fx, st));
    this.fxSeen = Math.max(this.fxSeen, maxSeq);

    // Banner
    if (st.sub !== this.lastSub) {
      const prev = this.lastSub;
      this.lastSub = st.sub;
      if (st.sub === 'fight' && prev === 'countdown') this.pop('LOS!', '', 800);
      if (st.sub === 'over') {
        this.pop('SPIEL!', '', 1300);
        sfx('win');
        this.juice.flash(0xffffff, 250);
        const w = st.winner;
        this.time.delayedCall(1300, () => this.banner.setText(w ? `${playerById(w)?.name ?? '?'}\ngewinnt!` : 'Zeit um!').setAlpha(1).setScale(1));
      }
    }
    if (st.sub === 'countdown') {
      const stage = SMASH_STAGES.find((x) => x.id === st.stage)!;
      this.banner.setText(String(Math.max(1, Math.ceil(st.endsIn / 1000)))).setAlpha(1);
      this.subline.setText(`Smash-Arena: ${stage.name}\nHau alle von der Bühne!`);
    } else if (st.sub === 'fight') this.subline.setText('');

    const secs = Math.ceil(st.endsIn / 1000);
    this.timer.setText(st.sub === 'countdown' ? '' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    this.timer.setColor(secs <= 10 && st.sub === 'fight' ? '#e04a3f' : '#fff4d6');

    // Anzeigetafeln
    for (const [id, f] of Object.entries(st.fighters)) {
      const c = this.cards.get(id);
      if (!c) continue;
      const key = `${f.pct}-${f.stocks}-${f.state}`;
      if (key === c.key) continue;
      const prevPct = Number(c.key.split('-')[0] || 0);
      c.key = key;
      const out = f.state === 'out';
      c.pct.setText(String(f.pct)).setColor(pctColor(f.pct)).setVisible(!out);
      c.pctSign.setColor(pctColor(f.pct)).setVisible(!out);
      c.out.setVisible(out);
      c.root.setAlpha(out ? 0.6 : 1);
      if (f.pct > prevPct) {
        this.tweens.killTweensOf(c.pct);
        c.pct.setScale(1.35);
        this.tweens.add({ targets: c.pct, scale: 1, duration: 220, ease: 'Back.Out' });
      }
      c.stocks.clear();
      const fig = this.figs.get(id);
      const pipY = c.stocks.getData('pipY') as number;
      for (let k = 0; k < f.stocks; k++) {
        c.stocks.fillStyle(0xfff4d6, 1).fillRect(22 + k * 8, pipY, 6, 6);
        c.stocks.fillStyle(fig?.color ?? 0xffffff, 1).fillRect(23 + k * 8, pipY + 1, 4, 4);
      }
    }
  }

  private itemTex(type: string) {
    if (type === 'kokos') return ensureTex(this, 'sm_kokos', A.kokosPix);
    if (type === 'bombe') return ensureTex(this, 'sm_bombe', A.bombePix);
    return ensureTex(this, 'sm_ananas', A.ananasPix);
  }

  private pop(text: string, sub: string, ms: number) {
    this.tweens.killTweensOf(this.banner);
    this.banner.setText(text).setAlpha(1).setScale(1.6);
    this.subline.setText(sub);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 250, ease: 'Back.Out' });
    this.tweens.add({ targets: this.banner, alpha: 0, delay: ms, duration: 250 });
  }

  // ---------------------------------------------------------------- Effekte

  private playFx(fx: SmashFx, st: SmashState) {
    const color = fx.id ? (this.figs.get(fx.id)?.color ?? 0xffffff) : 0xffffff;
    switch (fx.type) {
      case 'hit': {
        this.star(fx.x, fx.y, 0.5 + fx.p * 1.2, fx.p > 0.5 ? 0xffd25e : 0xffffff);
        this.juice.burst(fx.x, fx.y, 'spark', 4 + Math.round(fx.p * 10));
        sfx(fx.p > 0.55 ? 'hitHard' : 'hit', { x: fx.x, pitch: 1.15 - fx.p * 0.3 });
        if (fx.p > 0.45) this.cameras.main.shake(90 + fx.p * 120, 0.004 + fx.p * 0.008);
        // Starker Rückstoß: Darstellung kurz anhalten + Zoom-Stoß
        if (fx.p > 0.6) {
          this.juice.hitStop(40 + fx.p * 60);
          this.juice.zoomPunch(0.02 + fx.p * 0.04, 200);
        }
        break;
      }
      case 'shield': {
        const r = this.add.circle(fx.x, fx.y, 14, 0x7fd4ff, 0).setStrokeStyle(2, 0x7fd4ff, 1);
        this.fxL.add(r);
        this.tweens.add({ targets: r, scale: 1.6, alpha: 0, duration: 220, onComplete: () => r.destroy() });
        sfx('pop', { x: fx.x, pitch: 1.4, vol: 0.7 });
        break;
      }
      case 'break':
        sfx('crack', { x: fx.x });
        this.juice.burst(fx.x, fx.y, 'spark', 10);
        this.floatText(fx.x, fx.y - 26, 'Schild kaputt!', '#7fd4ff');
        this.star(fx.x, fx.y, 1.3, 0x7fd4ff);
        break;
      case 'stun':
        this.floatText(fx.x, fx.y - 16, '!?', '#ffd25e');
        sfx('bonk', { x: fx.x });
        break;
      case 'heal':
        this.floatText(fx.x, fx.y - 6, `-${SMASH.ANANAS_HEAL}%`, '#9ad65a');
        sfx('powerup', { x: fx.x, vol: 0.7 });
        break;
      case 'wave':
        for (const dir of [-1, 1]) {
          const e = this.add.ellipse(fx.x, fx.y - 2, 16, 6, 0xf4efe2, 0.9);
          this.fxL.add(e);
          this.tweens.add({ targets: e, x: fx.x + dir * 40, scaleX: 2.2, alpha: 0, duration: 320, onComplete: () => e.destroy() });
        }
        this.cameras.main.shake(140, 0.008);
        this.juice.burst(fx.x, fx.y - 2, 'splash', 12);
        sfx('splash', { x: fx.x });
        break;
      case 'boom': {
        const c = this.add.circle(fx.x, fx.y, 8, 0x7fd4ff, 0.8);
        this.fxL.add(c);
        this.tweens.add({ targets: c, scale: 4, alpha: 0, duration: 300, onComplete: () => c.destroy() });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const d = this.add.rectangle(fx.x, fx.y, 3, 3, i % 2 ? 0x3f8fe0 : 0xbfe6f7);
          this.fxL.add(d);
          this.tweens.add({ targets: d, x: fx.x + Math.cos(a) * 30, y: fx.y + Math.sin(a) * 24 + 8, alpha: 0, duration: 420, onComplete: () => d.destroy() });
        }
        this.cameras.main.shake(160, 0.008);
        this.juice.burst(fx.x, fx.y, 'splash', 18);
        sfx('boom', { x: fx.x, vol: 0.8 });
        sfx('splash', { x: fx.x, delay: 0.05 });
        break;
      }
      case 'spawn': {
        const ring = this.add.image(fx.x, fx.y + 4, ensureTex(this, 'sm_ring', A.ringPix));
        this.actL.add(ring);
        this.tweens.add({ targets: ring, y: ring.y + 30, alpha: 0, delay: 900, duration: 600, onComplete: () => ring.destroy() });
        sfx('jump', { x: fx.x, pitch: 0.8, vol: 0.7 });
        break;
      }
      case 'ko': {
        const fig = fx.id ? this.figs.get(fx.id) : undefined;
        if (fig) fig.root.setVisible(false);
        this.cameras.main.shake(320, 0.016);
        sfx('ko', { x: fx.x });
        this.juice.slowMo(0.4, 600);
        this.juice.zoomPunch(0.08, 400);
        this.flash.setFillStyle(0xffffff, 0.55);
        this.tweens.add({ targets: this.flash, fillAlpha: 0, duration: 300 });
        // Lichtstrahl am Bildschirmrand, wo die Figur rausgeflogen ist
        const sx = Phaser.Math.Clamp(fx.x, 0, WORLD.W);
        const sy = Phaser.Math.Clamp(fx.y, 0, HUD_Y);
        const ang = Math.atan2(135 - sy, 240 - sx);
        for (let i = -2; i <= 2; i++) {
          const beam = this.add.rectangle(sx, sy, 160, 10 - Math.abs(i) * 3, i === 0 ? 0xffffff : color, 0.9).setOrigin(0, 0.5).setRotation(ang + i * 0.16);
          this.hud.add(beam);
          this.tweens.add({ targets: beam, scaleX: 0.1, alpha: 0, duration: 650, ease: 'Cubic.In', onComplete: () => beam.destroy() });
        }
        const name = fx.id ? (playerById(fx.id)?.name ?? '') : '';
        const f = fx.id ? st.fighters[fx.id] : undefined;
        this.pop('K.O.!', f && f.state === 'out' ? `${name} ist raus!` : name, 900);
        if (f && f.state === 'out') say(`${spokenName(name)} ist raus!`);
        break;
      }
    }
  }

  private star(x: number, y: number, scale: number, color: number) {
    const g = this.add.graphics({ x, y });
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 4 : 11;
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    g.fillStyle(color, 1).fillPoints(pts, true);
    g.lineStyle(1, 0x2d1b12, 1).strokePoints(pts, true);
    g.setScale(scale * 0.6);
    this.fxL.add(g);
    this.tweens.add({ targets: g, scale: scale, alpha: 0, duration: 240, onComplete: () => g.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = txt(this, x, y, text, { color });
    this.fxL.add(t);
    this.tweens.add({ targets: t, y: y - 16, alpha: 0, delay: 300, duration: 600, onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- Bild für Bild

  update(time: number, delta: number) {
    const s = this.buf.sample();
    if (!s) return;
    const { a, b, f } = s;
    // Kampfzeit (bewegliche Plattformen) läuft mit der Wiedergabe-Uhr – steht also auch im Hit-Stop
    const t = lerp(a.t, b.t, f);
    for (const pl of this.plats) {
      const pos = platformPos(pl.p, t);
      pl.img.setPosition(pos.x + pl.ox, pos.y + pl.oy);
    }
    for (const id of Object.keys(b.fighters)) {
      const fb = b.fighters[id];
      const fa = a.fighters[id] ?? fb;
      this.updateFig(id, fb, lerpJump(fa.x, fb.x, f, 70), lerpJump(fa.y, fb.y, f, 70), time, delta);
    }
    const spin = delta * this.buf.rate;
    for (const p of b.projectiles) {
      const img = this.projs.get(p.id);
      if (!img) continue;
      const pa = a.projectiles.find((q) => q.id === p.id) ?? p;
      img.setPosition(lerp(pa.x, p.x, f), lerp(pa.y, p.y, f));
      if (p.type === 'flipflop') img.rotation += spin * 0.025 * Math.sign(p.vx || 1);
      else img.rotation += spin * 0.01;
    }
    for (const it of b.items) {
      const ia = a.items.find((q) => q.id === it.id) ?? it;
      this.items.get(it.id)?.setPosition(lerp(ia.x, it.x, f), lerp(ia.y, it.y, f) + Math.sin(time / 200 + it.id) * 0.8);
    }
    this.drawBeams(b);
    this.updateCamera(b);
    this.updateMarkers(b);
  }

  private updateFig(id: string, f: SmashFighter, x: number, y: number, time: number, delta: number) {
    const g = this.figs.get(id);
    if (!g) return;
    const show = f.state === 'fight';
    if (!show) {
      g.root.setVisible(false);
      g.visible = false;
      return;
    }
    g.x = x;
    g.y = y;
    g.visible = true;
    g.root.setVisible(true).setPosition(g.x, g.y);

    const S = SMASH.SCALE;
    const img = g.img;
    img.setFlipX(f.face < 0).setOrigin(0.5, 1).setPosition(0, 0).setScale(S).setAngle(0).clearTint();
    g.root.setAlpha(f.away ? 0.4 : f.inv ? (Math.floor(time / 80) % 2 ? 0.45 : 0.9) : 1); // away = Verbindung weg
    g.shield.setVisible(f.anim === 'shield');
    g.prop.setVisible(false);
    g.swoosh.clear();

    if (f.atkSeq !== g.atkSeq) {
      if (g.atkSeq >= 0) {
        g.atkAt = time;
        g.atkAnim = f.anim;
      }
      g.atkSeq = f.atkSeq;
    }
    if (f.anim !== 'hurt') g.spin = 0;

    switch (f.anim) {
      case 'run':
        img.setAngle(f.face * 7);
        break;
      case 'air':
        img.setScale(S * (f.vy < 0 ? 0.94 : 1), S * (f.vy < 0 ? 1.06 : 1));
        if (f.jumps < SMASH.AIR_JUMPS && f.vy < -150) img.setAngle(((time / 2) % 360) * f.face);
        break;
      case 'crouch':
        img.setScale(S * 1.1, S * 0.72);
        break;
      case 'shield':
        g.shield.setRadius(7 + (15 * f.shield) / 100).setFillStyle(g.color, 0.35);
        break;
      case 'hurt': {
        g.spin += delta * this.buf.rate * 0.7 * (f.vx >= 0 ? 1 : -1);
        img.setAngle(g.spin).setPosition(0, -SMASH.H / 2).setOrigin(0.5, 0.5);
        if (Math.floor(time / 60) % 2) img.setTintFill(0xffffff);
        const speed = Math.hypot(f.vx, f.vy);
        if (speed > 200 && time - g.trailAt > 35) {
          g.trailAt = time;
          const puff = this.add.circle(g.x, g.y - SMASH.H / 2, 3 + Math.min(5, speed / 120), speed > 420 ? 0xffd25e : 0xf4efe2, 0.8);
          this.fxL.add(puff);
          this.tweens.add({ targets: puff, scale: 0.2, alpha: 0, duration: 380, onComplete: () => puff.destroy() });
        }
        break;
      }
      case 'stun':
      case 'dizzy':
        img.setAngle(Math.sin(time / 90) * 10);
        this.drawStars(g, time);
        break;
      case 'throw':
        img.setX(f.face * 3).setAngle(f.face * 10);
        break;
      case 'spec':
        this.drawSpecial(g, f, time);
        break;
      default:
        if (ATTACK_ANIMS.has(f.anim)) {
          img.setX(f.face * 2).setAngle(f.anim === 'up' ? 0 : f.face * 8);
          if (f.anim === 'down') img.setScale(S * 1.1, S * 0.8);
        }
    }
    playAvatar(img, f.anim === 'run' ? 'walk' : f.anim === 'air' ? 'jump' : f.anim === 'hurt' || f.anim === 'stun' || f.anim === 'dizzy' ? 'hit' : 'idle');
    // Wisch-Effekt des Angriffs
    const since = time - g.atkAt;
    if (since < 240 && ATTACK_ANIMS.has(g.atkAnim)) this.drawSwoosh(g, g.atkAnim, f.face, 1 - since / 240);

    if (f.hold) {
      g.held.setTexture(this.itemTex(f.hold)).setVisible(true).setPosition(f.face * 10, -SMASH.H * 0.62).setOrigin(0.5, 0.5);
    } else g.held.setVisible(false);
  }

  private drawSpecial(g: Fig, f: SmashFighter, time: number) {
    const p = g.prop;
    switch (f.special) {
      case 'schirm':
        p.setTexture(ensureTex(this, 'sm_schirm', A.schirmPix)).setVisible(true).setPosition(f.face * 2, -SMASH.H - 8).setOrigin(0.5, 0.5).setFlipX(false).setAngle(Math.sin(time / 120) * 6);
        break;
      case 'matratze':
        p.setTexture(ensureTex(this, 'sm_matratze', A.matratzePix)).setVisible(true).setPosition(0, -SMASH.H / 2).setOrigin(0.5, 0.5).setAngle(0).setFlipX(false);
        g.img.setAngle(90 * f.face).setOrigin(0.5, 0.5).setPosition(0, -SMASH.H / 2 - 6);
        break;
      case 'wasser':
        p.setTexture(ensureTex(this, 'sm_wasser', A.wasserpistolePix)).setVisible(true).setPosition(f.face * 9, -SMASH.H * 0.62).setOrigin(0.5, 0.5).setFlipX(f.face < 0).setAngle(0);
        break;
      case 'cocktail':
        p.setTexture(ensureTex(this, 'sm_cocktail', A.cocktailGlassPix)).setVisible(true).setPosition(f.face * 10, -SMASH.H * 0.62).setOrigin(0.5, 0.5).setFlipX(f.face < 0).setAngle(f.face * 35);
        break;
      default:
        g.img.setX(f.face * 3).setAngle(f.face * 10);
    }
  }

  private drawSwoosh(g: Fig, anim: string, face: number, a: number) {
    const s = g.swoosh;
    const H = SMASH.H;
    const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
      s.lineStyle(5, 0xffffff, a * 0.9);
      s.beginPath();
      s.arc(cx, cy, r, Phaser.Math.DegToRad(from), Phaser.Math.DegToRad(to), false);
      s.strokePath();
      s.lineStyle(2, g.color, a);
      s.beginPath();
      s.arc(cx, cy, r, Phaser.Math.DegToRad(from), Phaser.Math.DegToRad(to), false);
      s.strokePath();
    };
    switch (anim) {
      case 'jab':
        arc(face * 10, -H * 0.68, 10, face > 0 ? -50 : 130, face > 0 ? 50 : 230);
        break;
      case 'side':
        arc(face * 12, -H * 0.68, 15, face > 0 ? -70 : 110, face > 0 ? 70 : 250);
        break;
      case 'up':
        arc(0, -H - 4, 15, 190, 350);
        break;
      case 'down':
        arc(-14, -3, 10, 100, 250);
        arc(14, -3, 10, -70, 80);
        break;
      case 'nair':
        arc(0, -H / 2, 18, 0, 360);
        break;
      case 'dair':
        arc(0, -2, 12, 20, 160);
        break;
    }
  }

  private drawStars(g: Fig, time: number) {
    const s = g.swoosh;
    for (let i = 0; i < 3; i++) {
      const a = time / 180 + (i * Math.PI * 2) / 3;
      s.fillStyle(0xffd25e, 1).fillRect(Math.cos(a) * 10 - 1.5, -SMASH.H - 6 + Math.sin(a) * 3 - 1.5, 3, 3);
    }
  }

  private drawBeams(st: SmashState) {
    const g = this.beamG;
    g.clear();
    for (const b of st.beams) {
      const x0 = b.face > 0 ? b.x : b.x - b.w;
      if (b.type === 'wasser') {
        g.fillStyle(0x7fd4ff, 0.85).fillRect(x0, b.y - 3, b.w, 6);
        g.fillStyle(0xffffff, 0.9).fillRect(x0, b.y - 1, b.w, 2);
        for (let i = 0; i < 4; i++) g.fillStyle(0xbfe6f7, 1).fillRect(x0 + Math.random() * b.w, b.y - 5 + Math.random() * 10, 2, 2);
      } else {
        for (let i = 0; i < 9; i++) {
          g.fillStyle(i % 2 ? 0xf07aa8 : 0xffb3d0, 0.95).fillCircle(x0 + Math.random() * b.w, b.y - 6 + Math.random() * 12, 1.5 + Math.random() * 1.5);
        }
      }
    }
  }

  // ---------------------------------------------------------------- Kamera & Randmarker

  private updateCamera(st: SmashState) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const [id, f] of Object.entries(st.fighters)) {
      if (f.state !== 'fight') continue;
      const g = this.figs.get(id);
      const fx = Phaser.Math.Clamp(g?.x ?? f.x, 60, 420);
      const fy = Phaser.Math.Clamp(g?.y ?? f.y, 40, 215);
      x0 = Math.min(x0, fx);
      x1 = Math.max(x1, fx);
      y0 = Math.min(y0, fy - SMASH.H);
      y1 = Math.max(y1, fy);
    }
    if (!Number.isFinite(x0) || st.sub !== 'fight') {
      x0 = 90;
      x1 = 390;
      y0 = 80;
      y1 = 210;
    }
    const z = Phaser.Math.Clamp(Math.min(WORLD.W / (x1 - x0 + 200), HUD_Y / (y1 - y0 + 120)), 1, 1.3);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2 + 14;
    this.cam.z += (z - this.cam.z) * 0.04;
    this.cam.x += (cx - this.cam.x) * 0.06;
    this.cam.y += (cy - this.cam.y) * 0.06;
    this.cameras.main.setZoom(this.cam.z * this.juice.zoom).centerOn(this.cam.x, this.cam.y);
  }

  private updateMarkers(st: SmashState) {
    const cam = this.cameras.main;
    const wv = cam.worldView;
    for (const [id, f] of Object.entries(st.fighters)) {
      const g = this.figs.get(id);
      let m = this.markers.get(id);
      if (!g || f.state !== 'fight') {
        m?.setVisible(false);
        continue;
      }
      const sx = (g.x - wv.x) * cam.zoom;
      const sy = (g.y - SMASH.H / 2 - wv.y) * cam.zoom;
      const off = sx < -4 || sx > WORLD.W + 4 || sy < -4 || sy > HUD_Y;
      if (!off) {
        m?.setVisible(false);
        continue;
      }
      if (!m) {
        const pl = playerById(id);
        m = this.add.container(0, 0);
        m.add(this.add.circle(0, 0, 12, g.color, 1).setStrokeStyle(2, 0x2d1b12));
        if (pl) m.add(this.add.image(0, 1, ensurePortrait(this, pl.look)).setOrigin(0.5, 0.5));
        this.hud.add(m);
        this.markers.set(id, m);
      }
      m.setVisible(true).setPosition(Phaser.Math.Clamp(sx, 14, WORLD.W - 14), Phaser.Math.Clamp(sy, 14, HUD_Y - 14));
    }
  }
}
