import Phaser from 'phaser';
import type { BoardState, GameState, Point } from '../../shared/types';
import { FIELD_POS, FIELD_TYPES, MINI_INFO } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { panel, txt } from './ui';

const FIELD_COLORS: Record<string, number> = { start: 0x00e436, blue: 0x29adff, red: 0xff004d, event: 0xffa300 };
const STEP_MS = 280;

export class BoardScene extends Phaser.Scene {
  private tokens = new Map<string, Phaser.GameObjects.Image>();
  private animating = new Set<string>();
  private lastRollSeq = 0;
  private roundText!: Phaser.GameObjects.Text;
  private msgText!: Phaser.GameObjects.Text;
  private scoreLayer!: Phaser.GameObjects.Container;
  private bar!: Phaser.GameObjects.Container;
  private arrow!: Phaser.GameObjects.Text;
  private introLayer!: Phaser.GameObjects.Container;
  private introShown = false;

  constructor() {
    super('board');
  }

  create() {
    this.tokens.clear();
    this.animating.clear();
    this.introShown = false;
    const st = getState();
    this.lastRollSeq = st?.board?.lastRoll?.seq ?? 0;

    this.drawGround();
    this.drawFields();

    this.bar = this.add.container(0, 0, this.drawCocktail()).setDepth(500);
    this.tweens.add({ targets: this.bar.list, y: '-=3', duration: 500, yoyo: true, repeat: -1 });

    panel(this, 0, 0, WORLD.W, 60, 0.85);
    this.roundText = txt(this, 8, 6, '', { origin: [0, 0], color: '#ffec27' });
    this.msgText = txt(this, WORLD.W / 2, 20, '', { wrap: 460 });
    this.scoreLayer = this.add.container(0, 0).setDepth(400);
    this.arrow = txt(this, 0, 0, 'v', { size: 8, color: '#ffec27' }).setDepth(900).setVisible(false);
    this.tweens.add({ targets: this.arrow, alpha: 0.3, duration: 300, yoyo: true, repeat: -1 });
    this.introLayer = this.add.container(0, 0).setDepth(3000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  private drawGround() {
    const g = this.add.graphics();
    g.fillStyle(0x3b7d4f).fillRect(0, 0, WORLD.W, WORLD.H);
    const rnd = new Phaser.Math.RandomDataGenerator(['garten']);
    for (let i = 0; i < 300; i++) {
      g.fillStyle(rnd.pick([0x2f6a40, 0x4a9460, 0x58a86e])).fillRect(rnd.between(0, WORLD.W), rnd.between(0, WORLD.H), 1, 2);
    }
    // Weg zwischen den Feldern
    g.lineStyle(10, 0xe8c872);
    g.beginPath();
    FIELD_POS.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.strokePath();

    // Ferienhaus + Pool in der Mitte links
    const hx = 64, hy = 96;
    g.fillStyle(0xab5236).fillTriangle(hx - 4, hy + 18, hx + 44, hy - 6, hx + 92, hy + 18);
    g.fillStyle(0xfff1e8).fillRect(hx + 4, hy + 18, 80, 44);
    g.fillStyle(0x7e2553).fillRect(hx + 36, hy + 38, 14, 24);
    g.fillStyle(0x29adff).fillRect(hx + 12, hy + 26, 14, 10).fillRect(hx + 62, hy + 26, 14, 10);
    g.fillStyle(0x73eff7).fillRect(hx + 8, hy + 76, 76, 34);
    g.fillStyle(0x29adff).fillRect(hx + 8, hy + 104, 76, 6);
    g.lineStyle(2, 0xc2c3c7).strokeRect(hx + 8, hy + 76, 76, 34);
    // Palme
    g.fillStyle(0x8b5a2b).fillRect(hx + 100, hy + 56, 4, 40);
    g.fillStyle(0x00e436).fillEllipse(hx + 102, hy + 54, 30, 10).fillEllipse(hx + 96, hy + 50, 18, 8).fillEllipse(hx + 110, hy + 50, 18, 8);
  }

  private drawFields() {
    const g = this.add.graphics();
    FIELD_POS.forEach((p, i) => {
      const type = FIELD_TYPES[i];
      g.fillStyle(0x1a1c2c).fillRect(p.x - 8, p.y - 7, 16, 16);
      g.fillStyle(FIELD_COLORS[type]).fillRect(p.x - 7, p.y - 8, 14, 14);
      g.fillStyle(0xffffff, 0.35).fillRect(p.x - 7, p.y - 8, 14, 3);
      if (type === 'event') txt(this, p.x, p.y - 5, '?', { color: '#1a1c2c', shadow: false });
      if (type === 'start') txt(this, p.x, p.y - 5, 'S', { color: '#1a1c2c', shadow: false });
    });
  }

  private drawCocktail() {
    const g = this.add.graphics();
    g.fillStyle(0xff77a8).fillTriangle(-7, -12, 7, -12, 0, -3);
    g.fillStyle(0xfff1e8).fillRect(-1, -3, 2, 6).fillRect(-4, 3, 8, 2);
    g.fillStyle(0xffec27).fillCircle(5, -13, 2);
    g.fillStyle(0x00e436).fillRect(-6, -16, 1, 5);
    return g;
  }

  private tokenOffset(id: string, order: string[]): Point {
    const k = Math.max(0, order.indexOf(id));
    return { x: ((k % 4) - 1.5) * 5, y: -Math.floor(k / 4) * 5 };
  }

  private posFor(field: number, id: string, order: string[]): Point {
    const p = FIELD_POS[field];
    const o = this.tokenOffset(id, order);
    return { x: p.x + o.x, y: p.y + 2 + o.y };
  }

  private render(s: GameState) {
    const b = s.board;
    if (!b) return;

    for (const id of b.order) {
      const p = playerById(id);
      if (!p) continue;
      const key = ensureAvatar(this, p.look);
      let t = this.tokens.get(id);
      if (!t) {
        const start = this.posFor(b.pos[id], id, b.order);
        t = this.add.image(start.x, start.y, key).setOrigin(0.5, 1);
        this.tokens.set(id, t);
      }
      t.setTexture(key).setAlpha(p.connected ? 1 : 0.4);
      if (!this.animating.has(id)) {
        const target = this.posFor(b.pos[id], id, b.order);
        t.setPosition(target.x, target.y);
      }
      t.setDepth(t.y + 100);
    }

    if (b.lastRoll && b.lastRoll.seq !== this.lastRollSeq) {
      this.lastRollSeq = b.lastRoll.seq;
      this.animateRoll(b);
    }

    const bp = FIELD_POS[b.barField];
    this.bar.setPosition(bp.x, bp.y - 10);

    this.roundText.setText(`RUNDE ${Math.min(b.round, b.maxRounds)}/${b.maxRounds}`);
    const cur = playerById(b.order[b.turnIdx]);
    const turnLine = b.sub === 'roll' && cur ? `\n> ${cur.name} ist dran – am Handy würfeln!` : '';
    this.msgText.setText(b.message + turnLine);

    // Pfeil über dem Spieler, der dran ist
    const curId = b.order[b.turnIdx];
    const tok = curId ? this.tokens.get(curId) : undefined;
    this.arrow.setVisible(b.sub === 'roll' && !!tok);
    if (tok) this.arrow.setPosition(tok.x, tok.y - 30);

    this.renderScores(b);
    this.renderIntro(b);
  }

  private renderScores(b: BoardState) {
    this.scoreLayer.removeAll(true);
    const x = 196, y = 92, w = 222;
    const sorted = [...b.order].sort((a, c) => b.cocktails[c] - b.cocktails[a] || b.coins[c] - b.coins[a]);
    const h = 18 + sorted.length * 15;
    this.scoreLayer.add(panel(this, x, y, w, h, 0.85));
    this.scoreLayer.add(txt(this, x + 8, y + 5, 'NAME', { origin: [0, 0], color: '#c2c3c7' }));
    this.scoreLayer.add(txt(this, x + 150, y + 5, '$', { origin: [0.5, 0], color: '#ffec27' }));
    this.scoreLayer.add(txt(this, x + 196, y + 5, 'COCKT.', { origin: [0.5, 0], color: '#ff77a8' }));
    sorted.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const ry = y + 16 + i * 15;
      const isTurn = b.sub === 'roll' && b.order[b.turnIdx] === id;
      this.scoreLayer.add(this.add.image(x + 12, ry + 15, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(0.8));
      this.scoreLayer.add(txt(this, x + 24, ry + 4, p.name.slice(0, 10), { origin: [0, 0], color: isTurn ? '#ffec27' : '#fff1e8' }));
      this.scoreLayer.add(txt(this, x + 150, ry + 4, String(b.coins[id]), { origin: [0.5, 0] }));
      this.scoreLayer.add(txt(this, x + 196, ry + 4, String(b.cocktails[id]), { origin: [0.5, 0], color: '#ff77a8' }));
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
    const isFinale = b.round === b.maxRounds && b.nextMini === 'murder';
    const bg = this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x000000, 0.75).setOrigin(0);
    const head = txt(this, WORLD.W / 2, 70, isFinale ? 'FINALE!' : 'MINISPIEL!', { size: 16, color: '#ff77a8' });
    const title = txt(this, WORLD.W / 2, 110, info.title, { size: 16, color: '#ffec27', wrap: 440 });
    const tag = txt(this, WORLD.W / 2, 160, info.tagline, { wrap: 400 });
    const hint = txt(this, WORLD.W / 2, 220, 'Schaut auf eure Handys!', { color: '#c2c3c7' });
    this.introLayer.add([bg, head, title, tag, hint]);
    title.setScale(0.2);
    this.tweens.add({ targets: title, scale: 1, duration: 500, ease: 'Back.out' });
  }

  private animateRoll(b: BoardState) {
    const roll = b.lastRoll!;
    const tok = this.tokens.get(roll.playerId);
    if (!tok) return;
    this.animating.add(roll.playerId);

    // Würfel einblenden
    const dice = this.add.container(Phaser.Math.Clamp(tok.x, 30, WORLD.W - 30), Math.max(36, tok.y - 48)).setDepth(2000);
    const box = this.add.rectangle(0, 0, 30, 30, 0xfff1e8).setStrokeStyle(2, 0x1a1c2c);
    const num = txt(this, 0, -8, '1', { size: 16, color: '#1a1c2c', shadow: false });
    dice.add([box, num]);
    let ticks = 0;
    this.time.addEvent({
      delay: 70,
      repeat: 10,
      callback: () => {
        ticks++;
        num.setText(ticks > 10 ? String(roll.value) : String(1 + Math.floor(Math.random() * 6)));
      },
    });
    this.tweens.add({ targets: dice, alpha: 0, delay: 1500, duration: 300, onComplete: () => dice.destroy() });

    // Schritt für Schritt laufen
    const steps = roll.path.map((f) => this.posFor(f, roll.playerId, b.order));
    steps.forEach((p, i) => {
      this.time.delayedCall(900 + i * STEP_MS, () => {
        this.tweens.add({ targets: tok, x: p.x, y: p.y - 6, duration: STEP_MS / 2, yoyo: false, ease: 'Quad.out',
          onComplete: () => this.tweens.add({ targets: tok, y: p.y, duration: STEP_MS / 2 - 10 }) });
        if (i === steps.length - 1) {
          this.time.delayedCall(STEP_MS, () => this.animating.delete(roll.playerId));
        }
      });
    });
  }
}
