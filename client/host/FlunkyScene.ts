import Phaser from 'phaser';
import type { FlunkyState, GameState, Point, Team } from '../../shared/types';
import { BOTTLE, FLIGHT_MS, RUN_TAPS, TEAM_INFO, THROW_SPOT, WORLD, missHint, otherTeam } from '../../shared/flunky';
import { FONT, bus, getState, playerById } from './store';
import { ensureAvatar, ensureBall, ensureBottle } from './textures';

interface Actor {
  root: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  barFill: Phaser.GameObjects.Rectangle;
  lookKey: string;
  lastBeer: number;
  lastGluck: number;
}

const BAR_W = 16;

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

  constructor() {
    super('flunky');
  }

  create() {
    this.actors.clear();
    this.bottleDown = false;
    this.flying = false;
    this.lastSeq = getState()?.flunky?.lastThrow?.seq ?? 0;

    this.drawBeach();
    this.bottle = this.add.image(BOTTLE.x, BOTTLE.y, ensureBottle(this)).setOrigin(0.5, 1).setScale(2);

    // HUD
    const hud = this.add.graphics().setDepth(1000);
    hud.fillStyle(0x1a1c2c, 0.8).fillRect(0, 0, WORLD.W, 30);
    this.teamText.A = this.add
      .text(8, 6, '', { fontFamily: FONT, fontSize: '8px', color: TEAM_INFO.A.color, lineSpacing: 4 })
      .setDepth(1001);
    this.teamText.B = this.add
      .text(WORLD.W - 8, 6, '', { fontFamily: FONT, fontSize: '8px', color: TEAM_INFO.B.color, align: 'right', lineSpacing: 4 })
      .setOrigin(1, 0)
      .setDepth(1001);
    this.status = this.add
      .text(WORLD.W / 2, 40, '', { fontFamily: FONT, fontSize: '8px', color: '#fff1e8', align: 'center' })
      .setOrigin(0.5, 0)
      .setShadow(1, 1, '#1a1c2c', 0, false, true)
      .setDepth(1001);
    this.windText = this.add
      .text(WORLD.W / 2, 12, '', { fontFamily: FONT, fontSize: '8px', color: '#c2c3c7' })
      .setOrigin(0.5, 0)
      .setDepth(1001);
    this.runBar = this.add.graphics().setDepth(1001);
    this.overLayer = this.add.container(0, 0).setDepth(2000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));

    const s = getState();
    if (s) this.render(s);
  }

  update() {
    // Weiches Nachziehen zu den Zielpositionen + Tiefensortierung
    for (const a of this.actors.values()) {
      const tx = a.root.getData('tx') as number;
      const ty = a.root.getData('ty') as number;
      a.root.x += (tx - a.root.x) * 0.2;
      a.root.y += (ty - a.root.y) * 0.2;
      a.root.setDepth(a.root.y);
    }
    this.bottle.setDepth(this.bottle.y);
  }

  private drawBeach() {
    const g = this.add.graphics();
    const sea = [0x29366f, 0x3b5dc9, 0x41a6f6, 0x73eff7];
    sea.forEach((c, i) => g.fillStyle(c).fillRect(0, 30 + i * 20, WORLD.W, 20));
    g.fillStyle(0xf4d58d).fillRect(0, 110, WORLD.W, WORLD.H - 110);
    // Sandkörner (deterministisch, damit es nicht flackert)
    const rnd = new Phaser.Math.RandomDataGenerator(['strand']);
    for (let i = 0; i < 260; i++) {
      g.fillStyle(rnd.pick([0xe0b86a, 0xfbe7b0, 0xd9a95b])).fillRect(
        rnd.between(0, WORLD.W),
        rnd.between(112, WORLD.H),
        1,
        1,
      );
    }
    // Wellen
    const waves = this.add.graphics();
    waves.fillStyle(0xffffff, 0.8);
    for (let x = 0; x < WORLD.W; x += 24) waves.fillRect(x, 106, 10, 2);
    this.tweens.add({ targets: waves, x: 12, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    // Wurflinien
    g.fillStyle(0xffffff, 0.6);
    for (let y = 130; y < WORLD.H; y += 8) {
      g.fillRect(THROW_SPOT.A.x + 8, y, 1, 4);
      g.fillRect(THROW_SPOT.B.x - 8, y, 1, 4);
    }
  }

  private homePos(team: Team, index: number, count: number): Point {
    const x = team === 'A' ? 40 + (index % 2) * 16 : WORLD.W - 40 - (index % 2) * 16;
    const y = BOTTLE.y + (index - (count - 1) / 2) * 30;
    return { x, y };
  }

  private ensureActor(id: string): Actor | null {
    const p = playerById(id);
    if (!p) return null;
    const lookKey = ensureAvatar(this, p.look);
    let a = this.actors.get(id);
    if (!a) {
      const sprite = this.add.image(0, 0, lookKey).setOrigin(0.5, 1).setScale(2);
      const barBg = this.add.rectangle(-BAR_W / 2, -42, BAR_W, 3, 0x1a1c2c).setOrigin(0, 0.5);
      const barFill = this.add.rectangle(-BAR_W / 2, -42, BAR_W, 3, 0xffa300).setOrigin(0, 0.5);
      const name = this.add
        .text(0, 2, p.name.slice(0, 6), { fontFamily: FONT, fontSize: '8px', color: '#1a1c2c' })
        .setOrigin(0.5, 0);
      const root = this.add.container(0, 0, [sprite, barBg, barFill, name]);
      a = { root, sprite, barFill, lookKey, lastBeer: 100, lastGluck: 0 };
      this.actors.set(id, a);
    }
    if (a.lookKey !== lookKey) {
      a.sprite.setTexture(lookKey);
      a.lookKey = lookKey;
    }
    a.sprite.setAlpha(p.connected ? 1 : 0.35);
    return a;
  }

  private render(s: GameState) {
    const f = s.flunky;
    if (!f) return;

    for (const team of ['A', 'B'] as Team[]) {
      const ids = f.teams[team];
      ids.forEach((id, i) => {
        const a = this.ensureActor(id);
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
        a.sprite.setFlipX(team === 'B');

        const beer = f.beer[id] ?? 0;
        a.barFill.width = Math.max(0, (beer / 100) * BAR_W);
        if (beer < a.lastBeer) this.gluck(a);
        a.lastBeer = beer;
      });
      const total = ids.reduce((sum, id) => sum + (f.beer[id] ?? 0), 0);
      const pct = Math.round(total / Math.max(1, ids.length));
      this.teamText[team]?.setText(`${TEAM_INFO[team].name.toUpperCase()}\nBier: ${pct}%`);
    }

    // Neuer Wurf → Ball animieren
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
      this.runBar.fillStyle(0x1a1c2c).fillRect(x, 64, w, 6);
      this.runBar.fillStyle(TEAM_INFO[otherTeam(f.turnTeam)].colorNum).fillRect(x + 1, 65, (w - 2) * (f.runProgress / RUN_TAPS), 4);
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
      this.add.rectangle(0, 0, WORLD.W, WORLD.H, 0x000000, 0.6).setOrigin(0),
      this.add.text(WORLD.W / 2, 90, `${info.name.toUpperCase()}\nGEWINNT!`, {
        fontFamily: FONT, fontSize: '16px', color: info.color, align: 'center', lineSpacing: 8,
      }).setOrigin(0.5),
      this.add.text(WORLD.W / 2, 140, names, {
        fontFamily: FONT, fontSize: '8px', color: '#fff1e8', align: 'center', wordWrap: { width: 400 },
      }).setOrigin(0.5, 0),
      this.add.text(WORLD.W / 2, 220, 'VIP: Am Handy zurück zur Lobby', {
        fontFamily: FONT, fontSize: '8px', color: '#c2c3c7',
      }).setOrigin(0.5),
    ]);
  }

  private animateThrow(f: FlunkyState) {
    const t = f.lastThrow!;
    const ball = this.add.image(t.from.x, t.from.y - 24, ensureBall(this)).setScale(2);
    const shadow = this.add.ellipse(t.from.x, t.from.y, 8, 3, 0x000000, 0.25);
    this.flying = true;
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
        ball.setPosition(gx, gy - Phaser.Math.Linear(24, 4, k) - Math.sin(Math.PI * k) * 70).setDepth(9999);
        ball.setAngle(k * 720);
      },
      onComplete: () => {
        this.flying = false;
        shadow.destroy();
        if (t.hit) {
          this.setBottleDown(true);
          this.cameras.main.shake(200, 0.01);
          this.popText(BOTTLE.x, BOTTLE.y - 40, 'TREFFER!', '#ffec27', '16px');
        } else {
          this.popText(t.to.x, t.to.y - 16, missHint(t.team, t.to), '#ff004d', '8px');
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
    this.popText(a.root.x + Phaser.Math.Between(-6, 6), a.root.y - 46, 'gluck', '#fff1e8', '8px');
  }

  private popText(x: number, y: number, text: string, color: string, size: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: size, color })
      .setOrigin(0.5)
      .setShadow(1, 1, '#1a1c2c', 0, false, true)
      .setDepth(5000);
    this.tweens.add({ targets: t, y: y - 18, alpha: 0, duration: 900, ease: 'Quad.out', onComplete: () => t.destroy() });
  }
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function windLabel(w: number) {
  const n = Math.round(Math.abs(w) * 3);
  if (n === 0) return 'WIND: -';
  return `WIND: ${(w < 0 ? '<' : '>').repeat(n)}`;
}
