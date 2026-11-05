import Phaser from 'phaser';
import type { FlunkyState, GameState, Point, Team } from '../../shared/types';
import { BOTTLE, FLIGHT_MS, RUN_TAPS, TEAM_INFO, THROW_SPOT, WORLD, missHint, otherTeam } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintShore, paintWater } from '../art/ground';
import { FONT, bus, getState, playerById } from './store';
import { ensureBall, ensureBottle, figure } from './textures';
import { BLUE_INK, INK, background, ink, panel, prop, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { crowd, foam, gulls } from './ambient';

interface Actor {
  root: Phaser.GameObjects.Container;
  barFill: Phaser.GameObjects.Rectangle;
  lastBeer: number;
  lastGluck: number;
}

const BAR_W = 16;
const TEAM_INK: Record<Team, string> = { A: '#b9770e', B: BLUE_INK };

export class FlunkyScene extends Phaser.Scene {
  private actors = new Map<string, Actor>();
  private bottle!: Phaser.GameObjects.Image;
  private bottleDown = false;
  private status!: Phaser.GameObjects.Text;
  private windText!: Phaser.GameObjects.Text;
  private teamText: Partial<Record<Team, Phaser.GameObjects.Text>> = {};
  private runBar!: Phaser.GameObjects.Graphics;
  private overLayer!: Phaser.GameObjects.Container;
  private lastSeq = 0;
  private flying = false;
  private juice!: Juice;
  private fans: ReturnType<typeof crowd> | null = null;
  private runTaps = 0;

  constructor() {
    super('flunky');
  }

  create() {
    this.actors.clear();
    this.bottleDown = false;
    this.flying = false;
    this.runTaps = 0;
    const st = getState();
    this.lastSeq = st?.mini?.kind === 'flunky' ? (st.mini.state.lastThrow?.seq ?? 0) : 0;

    background(this, 'beach', WORLD.W, WORLD.H, (p) => {
      paintWater(p, 0, 0, WORLD.W, 104, 21);
      paintSand(p, 0, 104, WORLD.W, WORLD.H - 104, 22);
      paintShore(p, 0, 104, WORLD.W, 23);
      // Wurflinien aus Muscheln
      for (let y = 128; y < WORLD.H; y += 7) {
        p.rect(THROW_SPOT.A.x + 8, y, 2, 2, C.white).px(THROW_SPOT.A.x + 9, y + 1, C.sandDark);
        p.rect(THROW_SPOT.B.x - 9, y, 2, 2, C.white).px(THROW_SPOT.B.x - 8, y + 1, C.sandDark);
      }
    });
    // Glitzern auf dem Wasser
    for (let i = 0; i < 10; i++) {
      const s = this.add.rectangle(Phaser.Math.Between(0, WORLD.W), Phaser.Math.Between(36, 98), 3, 1, 0xffffff).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 0.9, duration: 600, yoyo: true, repeat: -1, delay: i * 230, repeatDelay: 1200 });
    }

    // Leerer Strand: Möwen, Wellenschaum an der Wasserkante, Zuschauer am Handtuch
    gulls(this, { n: 3, y: [40, 96], depth: 900 });
    foam(this, { y: 104, n: 16, depth: -900, spread: 2 });
    this.juice = new Juice(this, { depth: 4000 });
    this.fans = crowd(this, [[150, 266], [168, 268], [312, 268], [330, 266]], { depth: 262 });

    prop(this, 'palm', () => O.palm(6), 18, 150);
    prop(this, 'palm2', () => O.palm(9), 464, 160).setFlipX(true);
    prop(this, 'umbrella', () => O.umbrella(), 240, 262).setDepth(262);
    prop(this, 'towelR', () => O.towel(C.red), 214, 268);
    prop(this, 'towelB', () => O.towel(C.blue), 266, 268);

    this.bottle = this.add.image(BOTTLE.x, BOTTLE.y, ensureBottle(this)).setOrigin(0.5, 1);

    // HUD
    panel(this, 0, 0, WORLD.W, 34).setDepth(1000);
    this.teamText.A = ink(this, 12, 8, '', { origin: [0, 0], color: TEAM_INK.A, align: 'left' }).setDepth(1001);
    this.teamText.B = ink(this, WORLD.W - 12, 8, '', { origin: [1, 0], color: TEAM_INK.B, align: 'right' }).setDepth(1001);
    this.windText = ink(this, WORLD.W / 2, 13, '', { color: '#7a5a3a' }).setDepth(1001);
    this.status = txt(this, WORLD.W / 2, 44, '', { align: 'center' }).setDepth(1001);
    this.runBar = this.add.graphics().setDepth(1001);
    this.overLayer = this.add.container(0, 0).setDepth(2000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    if (st) this.render(st);
  }

  update() {
    for (const a of this.actors.values()) {
      const tx = a.root.getData('tx') as number;
      const ty = a.root.getData('ty') as number;
      a.root.x += (tx - a.root.x) * 0.2;
      a.root.y += (ty - a.root.y) * 0.2;
      a.root.setDepth(a.root.y);
    }
    this.bottle.setDepth(this.bottle.y);
  }

  private homePos(team: Team, index: number, count: number): Point {
    const x = team === 'A' ? 40 + (index % 2) * 22 : WORLD.W - 40 - (index % 2) * 22;
    const y = BOTTLE.y + (index - (count - 1) / 2) * 30;
    return { x, y };
  }

  private ensureActor(id: string, team: Team): Actor | null {
    const p = playerById(id);
    if (!p) return null;
    let a = this.actors.get(id);
    if (!a) {
      const root = figure(this, p.look, 0, 0);
      (root.getData('img') as Phaser.GameObjects.Image).setFlipX(team === 'B');
      const barBg = this.add.rectangle(-BAR_W / 2 - 1, -33, BAR_W + 2, 5, 0x2d1b12).setOrigin(0, 0.5);
      const barFill = this.add.rectangle(-BAR_W / 2, -33, BAR_W, 3, 0xf0b13a).setOrigin(0, 0.5);
      root.add([barBg, barFill]);
      a = { root, barFill, lastBeer: 100, lastGluck: 0 };
      this.actors.set(id, a);
    }
    a.root.setAlpha(p.connected ? 1 : 0.45);
    return a;
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'flunky') return;
    const f = s.mini.state;

    for (const team of ['A', 'B'] as Team[]) {
      const ids = f.teams[team];
      ids.forEach((id, i) => {
        const a = this.ensureActor(id, team);
        if (!a) return;
        const home = this.homePos(team, i, ids.length);
        let target = home;
        if (id === f.throwerId && (f.sub === 'aim' || f.sub === 'flight')) target = THROW_SPOT[team];
        if (id === f.runnerId && (f.sub === 'chug' || f.sub === 'reset')) {
          const t = f.runProgress / RUN_TAPS;
          const bottleSide = { x: BOTTLE.x + (team === 'A' ? -10 : 10), y: BOTTLE.y };
          target = t < 0.5 ? lerpPt(home, bottleSide, t * 2) : lerpPt(bottleSide, home, (t - 0.5) * 2);
        }
        if (a.root.getData('tx') === undefined) a.root.setPosition(target.x, target.y);
        a.root.setData('tx', target.x).setData('ty', target.y);

        const beer = f.beer[id] ?? 0;
        a.barFill.width = Math.max(0, (beer / 100) * BAR_W);
        if (beer < a.lastBeer) this.gluck(a);
        a.lastBeer = beer;
      });
      const total = ids.reduce((sum, id) => sum + (f.beer[id] ?? 0), 0);
      const pct = Math.round(total / Math.max(1, ids.length));
      this.teamText[team]?.setText(`${TEAM_INFO[team].name}\nBier: ${pct}%`);
    }

    // Laufen: jeder Tap ein Tick
    if ((f.sub === 'chug' || f.sub === 'reset') && f.runProgress > this.runTaps) sfx('tick', { pitch: 0.9 + (f.runProgress / RUN_TAPS) * 0.6, vol: 0.4 });
    this.runTaps = f.sub === 'chug' || f.sub === 'reset' ? f.runProgress : 0;
    if (f.sub === 'over' && f.winner && !this.overLayer.length) {
      sfx('fanfare');
      this.fans?.cheer();
      this.juice.burst(WORLD.W / 2, 90, 'confetti', 50);
    }

    if (f.lastThrow && f.lastThrow.seq !== this.lastSeq) {
      this.lastSeq = f.lastThrow.seq;
      this.animateThrow(f);
    }

    if (f.sub === 'aim' || (f.sub === 'chug' && f.runProgress >= RUN_TAPS / 2) || f.sub === 'reset') {
      this.setBottleDown(false);
    }

    this.renderStatus(f);
    this.renderOver(f);
  }

  private renderStatus(f: FlunkyState) {
    const thrower = playerById(f.throwerId)?.name ?? '?';
    const runner = playerById(f.runnerId)?.name ?? '?';
    const drinkTeam = TEAM_INFO[f.turnTeam].name;
    this.runBar.clear();

    if (f.sub === 'aim') {
      this.windText.setText(windLabel(f.wind));
      this.status.setText(`${thrower} wirft!\nAm Handy nach oben wischen`);
    } else if (f.sub === 'flight') {
      this.status.setText(`${thrower} wirft ...`);
    } else if (f.sub === 'chug' || f.sub === 'reset') {
      this.windText.setText('');
      this.status.setText(
        f.sub === 'chug'
          ? `TREFFER! ${drinkTeam} trinkt!\n${runner} lauf! (${TEAM_INFO[otherTeam(f.turnTeam)].name})`
          : 'Flasche steht! Wechsel ...',
      );
      const w = 160;
      const x = (WORLD.W - w) / 2;
      this.runBar.fillStyle(0x2d1b12).fillRect(x - 1, 69, w + 2, 8);
      this.runBar.fillStyle(0xf7e4b5).fillRect(x, 70, w, 6);
      this.runBar.fillStyle(TEAM_INFO[otherTeam(f.turnTeam)].colorNum).fillRect(x, 70, w * (f.runProgress / RUN_TAPS), 6);
    } else if (f.sub === 'over') {
      this.status.setText('');
      this.windText.setText('');
    }
  }

  private renderOver(f: FlunkyState) {
    this.overLayer.removeAll(true);
    if (f.sub !== 'over' || !f.winner) return;
    const info = TEAM_INFO[f.winner];
    const names = f.teams[f.winner].map((id) => playerById(id)?.name ?? '?').join(', ');
    this.overLayer.add([
      this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x1a1008, 0.5).setOrigin(0),
      panel(this, 90, 70, 300, 130),
      ink(this, WORLD.W / 2, 90, `${info.name}\ngewinnt!`, { size: 16, color: TEAM_INK[f.winner] }),
      ink(this, WORLD.W / 2, 140, names, { wrap: 270 }),
      ink(this, WORLD.W / 2, 178, 'Gleich kommen die Ergebnisse ...', { color: '#7a5a3a' }),
    ]);
  }

  private animateThrow(f: FlunkyState) {
    const t = f.lastThrow!;
    const ball = this.add.image(t.from.x, t.from.y - 22, ensureBall(this));
    const shadow = this.add.ellipse(t.from.x, t.from.y, 7, 3, 0x000000, 0.25);
    this.flying = true;
    sfx('throw', { x: t.from.x });
    const dur = FLIGHT_MS - 200;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      onUpdate: (tw) => {
        const k = tw.getValue() ?? 0;
        const gx = Phaser.Math.Linear(t.from.x, t.to.x, k);
        const gy = Phaser.Math.Linear(t.from.y, t.to.y, k);
        shadow.setPosition(gx, gy).setDepth(gy - 1);
        ball.setPosition(gx, gy - Phaser.Math.Linear(22, 3, k) - Math.sin(Math.PI * k) * 70).setDepth(9999);
        ball.setAngle(k * 720);
      },
      onComplete: () => {
        this.flying = false;
        shadow.destroy();
        if (t.hit) {
          this.setBottleDown(true);
          // Treffer: Klirren, kurzer Stopp, Sandwolke, Jubel
          this.juice.shake(2);
          this.juice.hitStop(80);
          this.juice.burst(BOTTLE.x, BOTTLE.y - 4, 'sand', 14);
          this.juice.burst(BOTTLE.x, BOTTLE.y - 10, 'spark', 8);
          sfx('crack', { x: BOTTLE.x });
          sfx('hitHard', { x: BOTTLE.x, delay: 0.03 });
          sfx('cheer', { delay: 0.2 });
          this.fans?.cheer();
          this.popText(BOTTLE.x, BOTTLE.y - 40, 'TREFFER!', C.gold, '16px');
        } else {
          this.juice.burst(t.to.x, t.to.y, 'sand', 6);
          sfx('bonk', { x: t.to.x, pitch: 0.7, vol: 0.5 });
          sfx('lose', { x: t.to.x, vol: 0.4, delay: 0.1 });
          this.popText(t.to.x, t.to.y - 16, missHint(t.team, t.to), '#ff6b5e', '8px');
        }
        this.tweens.add({ targets: ball, alpha: 0, delay: 400, duration: 300, onComplete: () => ball.destroy() });
      },
    });
  }

  private setBottleDown(down: boolean) {
    if (down === this.bottleDown || (this.flying && !down)) return;
    this.bottleDown = down;
    this.tweens.add({ targets: this.bottle, angle: down ? 90 : 0, duration: 180, ease: 'Back.out' });
  }

  private gluck(a: Actor) {
    const now = this.time.now;
    if (now - a.lastGluck < 350) return;
    a.lastGluck = now;
    sfx('pop', { x: a.root.x, pitch: 0.5 + Math.random() * 0.2, vol: 0.45 });

    this.popText(a.root.x + Phaser.Math.Between(-6, 6), a.root.y - 40, 'gluck', C.white, '8px');
  }

  private popText(x: number, y: number, text: string, color: string, size: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: size, color })
      .setOrigin(0.5)
      .setShadow(1, 1, INK, 0, false, true)
      .setDepth(5000);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
  }
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function windLabel(w: number) {
  const n = Math.round(Math.abs(w) * 3);
  if (n === 0) return 'Wind: –';
  return `Wind: ${(w < 0 ? '<' : '>').repeat(n)}`;
}
