import Phaser from 'phaser';
import type { GameState, SprintState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSand, paintShore, paintSky, paintWater } from '../art/ground';
import { bus, getState, playerById } from './store';
import { ensureTex, ink, nameTag, panel, prop, txt, RED_INK, INK } from './ui';
import { figure } from './textures';
import { Pix } from '../art/pix';

const CHAIR_COLORS = [C.red, C.blue, C.green, C.orange, C.purple, C.pink, '#2fb5a5', C.gold];

function beach(sky: string[]) {
  return (p: Pix) => {
    paintSky(p, 0, 0, WORLD.W, 130, sky);
    paintWater(p, 0, 130, WORLD.W, 46, 41);
    paintSand(p, 0, 176, WORLD.W, WORLD.H - 176, 42);
    paintShore(p, 0, 176, WORLD.W, 43);
  };
}

export class SprintScene extends Phaser.Scene {
  private night!: Phaser.GameObjects.Image;
  private day!: Phaser.GameObjects.Image;
  private sun!: Phaser.GameObjects.Arc;
  private layer!: Phaser.GameObjects.Container;
  private lastSub = '';
  private stateKey = '';

  constructor() {
    super('sprint');
  }

  create() {
    this.lastSub = '';
    this.stateKey = '';
    this.day = this.add.image(0, 0, ensureTex(this, 'bg_sprint_day', () => {
      const p = new Pix(WORLD.W, WORLD.H);
      beach(['#6fb7e8', '#f3a07b', '#ffcf86', '#ffe7b0'])(p);
      return p;
    })).setOrigin(0).setDepth(-1000);
    this.night = this.add.image(0, 0, ensureTex(this, 'bg_sprint_night', () => {
      const p = new Pix(WORLD.W, WORLD.H);
      beach(['#0e1430', '#1b2350', '#2e3a78', '#4b4f96'])(p);
      for (let i = 0; i < 50; i++) p.px((i * 97) % WORLD.W, (i * 53) % 120, C.white);
      p.disc(410, 30, 9, '#fff7c9');
      p.disc(414, 27, 8, '#1b2350');
      return p;
    })).setOrigin(0).setDepth(-999);
    this.sun = this.add.circle(WORLD.W / 2, 150, 20, 0xffd25e).setDepth(-990);
    const core = this.add.circle(WORLD.W / 2, 150, 15, 0xfff1b0).setDepth(-989).setName('sunCore');
    // Sonne nur über dem Horizont sichtbar
    const horizon = this.make.graphics({}, false).fillRect(0, 0, WORLD.W, 130).createGeometryMask();
    this.sun.setMask(horizon);
    core.setMask(horizon);
    prop(this, 'palm', () => O.palm(6), 22, 214);
    prop(this, 'palm2', () => O.palm(9), 462, 220).setFlipX(true);
    this.layer = this.add.container(0, 0).setDepth(200);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'sprint') return;
    const sp = s.mini.state;
    const core = this.children.getByName('sunCore') as Phaser.GameObjects.Arc;
    if (sp.sub !== this.lastSub) {
      this.lastSub = sp.sub;
      const isNight = sp.sub === 'wait';
      this.tweens.killTweensOf([this.night, this.sun, core]);
      if (sp.sub === 'go') {
        this.tweens.add({ targets: this.night, alpha: 0, duration: 250 });
        this.tweens.add({ targets: [this.sun, core], y: 104, duration: 400, ease: 'Back.out' });
        this.cameras.main.flash(150, 255, 230, 160);
      } else {
        this.night.setAlpha(isNight ? 1 : 0);
        this.sun.setY(isNight ? 154 : 104);
        core.setY(isNight ? 154 : 104);
      }
    }

    const key = JSON.stringify([sp.sub, sp.round, sp.times, sp.points]);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.layer.removeAll(true);
    this.layer.add(panel(this, 120, 4, 240, 30));
    this.layer.add(ink(this, WORLD.W / 2, 15, `Liegestuhl-Sprint · Runde ${sp.round}/${sp.rounds}`, { color: RED_INK }));

    if (sp.sub === 'wait') this.layer.add(txt(this, WORLD.W / 2, 60, '6 Uhr morgens ... psst ...\nNOCH NICHT tippen!'));
    if (sp.sub === 'go') this.layer.add(txt(this, WORLD.W / 2, 54, 'JETZT!', { size: 24, color: C.gold }));
    this.renderChairs(sp);
  }

  private renderChairs(sp: SprintState) {
    const ids = Object.keys(sp.points);
    const n = ids.length;
    const spacing = Math.min(80, 440 / Math.max(1, n));
    const ranked = ids
      .filter((id) => typeof sp.times[id] === 'number')
      .sort((a, b) => (sp.times[a] as number) - (sp.times[b] as number));

    ids.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const t = sp.times[id];
      const chair = this.add.image(x, 236, ensureTex(this, `chair_${i}`, () => O.deckchair(CHAIR_COLORS[i % CHAIR_COLORS.length]))).setOrigin(0.5, 1);
      this.layer.add(chair);
      const rank = ranked.indexOf(id);
      if (rank >= 0) {
        const towel = this.add.image(x + 2, 226, ensureTex(this, `towel_${i}`, () => O.towel(CHAIR_COLORS[i % CHAIR_COLORS.length]))).setScale(0.6).setAngle(80);
        this.layer.add(towel);
      }
      const f = figure(this, p.look, x, t === 'early' ? 250 : 214);
      if (t === 'early') (f.getData('img') as Phaser.GameObjects.Image).setAngle(90).setTint(0xdddddd);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, 240, p.name.slice(0, 6)));
      let label = '';
      if (t === 'early') label = 'früh!';
      else if (typeof t === 'number' && sp.sub !== 'wait') label = `${t}ms`;
      if (label) this.layer.add(txt(this, x, 168, label, { color: t === 'early' ? '#ff8a7a' : C.white }));
      this.layer.add(ink(this, x, 254, `${sp.points[id]} P`, { color: INK }));
    });

    if ((sp.sub === 'reveal' || sp.sub === 'over') && ranked[0]) {
      this.layer.add(txt(this, WORLD.W / 2, 46, `${playerById(ranked[0])?.name} hat die beste Liege!`, { color: C.gold }));
    }
  }
}
