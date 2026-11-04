import Phaser from 'phaser';
import type { BoardState, GameState, Point } from '../../shared/types';
import { FIELD_POS, FIELD_TYPES, FINALE_KINDS, MINI_INFO } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath, paintWater } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { INK, RED_INK, background, ensureTex, ink, panel, prop, txt } from './ui';

const STEP_MS = 280;
const GEM: Record<string, [string, 'q' | 's' | undefined]> = {
  start: [C.green, 's'],
  blue: [C.blue, undefined],
  red: [C.red, undefined],
  event: [C.orange, 'q'],
};

export class BoardScene extends Phaser.Scene {
  private tokens = new Map<string, Phaser.GameObjects.Container>();
  private animating = new Set<string>();
  private lastRollSeq = 0;
  private roundText!: Phaser.GameObjects.Text;
  private msgText!: Phaser.GameObjects.Text;
  private scoreLayer!: Phaser.GameObjects.Container;
  private bar!: Phaser.GameObjects.Image;
  private arrow!: Phaser.GameObjects.Text;
  private introLayer!: Phaser.GameObjects.Container;
  private introShown = false;
  private scoreKey = '';

  constructor() {
    super('board');
  }

  create() {
    this.tokens.clear();
    this.animating.clear();
    this.introShown = false;
    this.scoreKey = '';
    const st = getState();
    this.lastRollSeq = st?.board?.lastRoll?.seq ?? 0;

    background(this, 'board', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 12);
      paintPath(p, FIELD_POS, 12, 14, true);
      // Teich unten links in der Mitte
      p.ellipse(120, 212, 34, 13, C.stoneDark);
      const water = new Pix(70, 26);
      paintWater(water, 0, 0, 70, 26, 4);
      const pond = new Pix(70, 26);
      pond.ellipse(35, 13, 32, 11, '#000');
      pond.overlayOn(() => pond.draw(water, 0, 0));
      p.draw(pond, 85, 199);
    });

    // Felder
    FIELD_POS.forEach((pt, i) => {
      const [gem, sym] = GEM[FIELD_TYPES[i]];
      prop(this, `field_${FIELD_TYPES[i]}`, () => O.fieldStone(gem, sym), pt.x, pt.y + 7).setDepth(pt.y - 20);
    });

    // Deko innerhalb des Rundwegs
    prop(this, 'cottage', O.cottage, 120, 186);
    prop(this, 'bush3', () => O.bush(3), 70, 120);
    prop(this, 'bush4', () => O.bush(4, true), 176, 118);
    prop(this, 'flowerPink', () => O.flower(C.pink), 64, 186);
    prop(this, 'flowerWhite', () => O.flower(C.white), 178, 190);
    prop(this, 'rock', () => O.rock(), 180, 232);
    prop(this, 'tree7', () => O.tree(7), 466, 46);
    prop(this, 'tree1', () => O.tree(1), 14, 46);

    this.bar = this.add.image(0, 0, ensureTex(this, 'cocktail', O.cocktail)).setOrigin(0.5, 1).setDepth(800);
    this.tweens.add({ targets: this.bar, scale: 1.15, duration: 500, yoyo: true, repeat: -1 });

    panel(this, 60, 0, 360, 58).setDepth(1000);
    this.roundText = ink(this, 72, 9, '', { origin: [0, 0], color: RED_INK }).setDepth(1001);
    this.msgText = ink(this, WORLD.W / 2, 22, '', { wrap: 336 }).setDepth(1001);
    this.scoreLayer = this.add.container(0, 0).setDepth(900);
    this.arrow = txt(this, 0, 0, 'v', { color: C.gold }).setDepth(950).setVisible(false);
    this.tweens.add({ targets: this.arrow, y: '+=3', duration: 300, yoyo: true, repeat: -1 });
    this.introLayer = this.add.container(0, 0).setDepth(3000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  private tokenOffset(id: string, order: string[]): Point {
    const k = Math.max(0, order.indexOf(id));
    return { x: ((k % 4) - 1.5) * 5, y: -Math.floor(k / 4) * 4 };
  }

  private posFor(field: number, id: string, order: string[]): Point {
    const p = FIELD_POS[field];
    const o = this.tokenOffset(id, order);
    return { x: p.x + o.x, y: p.y + 4 + o.y };
  }

  private render(s: GameState) {
    const b = s.board;
    if (!b) return;

    for (const id of b.order) {
      const p = playerById(id);
      if (!p) continue;
      let t = this.tokens.get(id);
      if (!t) {
        const start = this.posFor(b.pos[id], id, b.order);
        t = figure(this, p.look, start.x, start.y);
        this.tokens.set(id, t);
      }
      t.setAlpha(p.connected ? 1 : 0.45);
      if (!this.animating.has(id)) {
        const target = this.posFor(b.pos[id], id, b.order);
        t.setPosition(target.x, target.y);
      }
      t.setDepth(t.y);
    }

    if (b.lastRoll && b.lastRoll.seq !== this.lastRollSeq) {
      this.lastRollSeq = b.lastRoll.seq;
      this.animateRoll(b);
    }

    const bp = FIELD_POS[b.barField];
    this.bar.setPosition(bp.x, bp.y - 4).setDepth(bp.y + 30);

    this.roundText.setText(`Runde ${Math.min(b.round, b.maxRounds)}/${b.maxRounds}`);
    const cur = playerById(b.order[b.turnIdx]);
    const turnLine = b.sub === 'roll' && cur ? `\n> ${cur.name} ist dran – am Handy würfeln!` : '';
    this.msgText.setText(b.message + turnLine);

    const curId = b.order[b.turnIdx];
    const tok = curId ? this.tokens.get(curId) : undefined;
    this.arrow.setVisible(b.sub === 'roll' && !!tok);
    if (tok) this.arrow.setPosition(tok.x, tok.y - 40);

    this.renderScores(b);
    this.renderIntro(b);
  }

  private renderScores(b: BoardState) {
    const key = JSON.stringify([b.order, b.coins, b.cocktails, b.sub, b.turnIdx]);
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    this.scoreLayer.removeAll(true);
    const x = 214, y = 92, w = 200;
    const sorted = [...b.order].sort((a, c) => b.cocktails[c] - b.cocktails[a] || b.coins[c] - b.coins[a]);
    const h = 26 + sorted.length * 15;
    this.scoreLayer.add(panel(this, x, y, w, h));
    this.scoreLayer.add(this.add.image(x + 136, y + 13, ensureTex(this, 'coin', O.coinIcon)));
    this.scoreLayer.add(this.add.image(x + 172, y + 16, ensureTex(this, 'cocktail', O.cocktail)).setScale(0.8));
    sorted.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const ry = y + 22 + i * 15;
      const isTurn = b.sub === 'roll' && b.order[b.turnIdx] === id;
      this.scoreLayer.add(this.add.image(x + 16, ry + 13, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      this.scoreLayer.add(ink(this, x + 26, ry + 3, p.name.slice(0, 11), { origin: [0, 0], color: isTurn ? RED_INK : INK }));
      this.scoreLayer.add(ink(this, x + 136, ry + 3, String(b.coins[id])));
      this.scoreLayer.add(ink(this, x + 172, ry + 3, String(b.cocktails[id]), { color: '#b0306a' }));
    });
  }

  private renderIntro(b: BoardState) {
    if (b.sub !== 'intro' || !b.nextMini) {
      this.introLayer.removeAll(true);
      this.introShown = false;
      return;
    }
    if (this.introShown) return;
    this.introShown = true;
    const info = MINI_INFO[b.nextMini];
    const isFinale = b.round === b.maxRounds && FINALE_KINDS.includes(b.nextMini);
    const bg = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.6).setOrigin(0);
    const card = this.add.container(WORLD.W / 2, WORLD.H / 2);
    card.add(panel(this, -170, -70, 340, 140));
    card.add(ink(this, 0, -54, isFinale ? '~ FINALE ~' : '~ Minispiel ~', { color: RED_INK }));
    card.add(ink(this, 0, -30, info.title, { size: 16, wrap: 300 }));
    card.add(ink(this, 0, 10, info.tagline, { wrap: 290 }));
    card.add(ink(this, 0, 46, 'Schaut auf eure Handys!', { color: '#7a5a3a' }));
    this.introLayer.add([bg, card]);
    card.setScale(0.2);
    this.tweens.add({ targets: card, scale: 1, duration: 450, ease: 'Back.out' });
  }

  private animateRoll(b: BoardState) {
    const roll = b.lastRoll!;
    const tok = this.tokens.get(roll.playerId);
    if (!tok) return;
    this.animating.add(roll.playerId);

    // Würfel über der Figur
    const dice = this.add.container(Phaser.Math.Clamp(tok.x, 30, WORLD.W - 30), Math.max(78, tok.y - 52)).setDepth(2000);
    dice.add(panel(this, -13, -13, 26, 26));
    const num = ink(this, 0, -4, '1', { size: 8 });
    dice.add(num);
    let ticks = 0;
    this.time.addEvent({
      delay: 70,
      repeat: 10,
      callback: () => {
        ticks++;
        num.setText(ticks > 10 ? String(roll.value) : String(1 + Math.floor(Math.random() * 6)));
        dice.setAngle(ticks > 10 ? 0 : Phaser.Math.Between(-12, 12));
      },
    });
    this.tweens.add({ targets: dice, alpha: 0, delay: 1600, duration: 300, onComplete: () => dice.destroy() });

    // Schritt für Schritt hüpfen
    const steps = roll.path.map((f) => this.posFor(f, roll.playerId, b.order));
    steps.forEach((p, i) => {
      this.time.delayedCall(900 + i * STEP_MS, () => {
        this.tweens.add({
          targets: tok,
          x: p.x,
          y: p.y - 6,
          duration: STEP_MS / 2,
          ease: 'Quad.out',
          onComplete: () => this.tweens.add({ targets: tok, y: p.y, duration: STEP_MS / 2 - 10 }),
        });
        if (i === steps.length - 1) this.time.delayedCall(STEP_MS, () => this.animating.delete(roll.playerId));
      });
    });
  }
}
