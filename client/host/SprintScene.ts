import Phaser from 'phaser';
import type { GameState, SprintState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { txt } from './ui';

export class SprintScene extends Phaser.Scene {
  private sky!: Phaser.GameObjects.Graphics;
  private layer!: Phaser.GameObjects.Container;
  private sun!: Phaser.GameObjects.Arc;
  private lastSub = '';

  constructor() {
    super('sprint');
  }

  create() {
    this.lastSub = '';
    this.sky = this.add.graphics();
    this.sun = this.add.circle(WORLD.W / 2, 200, 22, 0xffcd75);
    const g = this.add.graphics();
    g.fillStyle(0x29adff).fillRect(0, 150, WORLD.W, 30);
    g.fillStyle(0xf4d58d).fillRect(0, 180, WORLD.W, 90);
    this.layer = this.add.container(0, 0);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private paintSky(day: boolean) {
    this.sky.clear();
    const night = [0x0b0f1e, 0x111d35, 0x1d2b53];
    const dawn = [0xff77a8, 0xffa300, 0xffcd75];
    (day ? dawn : night).forEach((c, i) => this.sky.fillStyle(c).fillRect(0, i * 50, WORLD.W, 50));
    if (!day) {
      const rnd = new Phaser.Math.RandomDataGenerator(['sterne']);
      for (let i = 0; i < 40; i++) this.sky.fillStyle(0xfff1e8).fillRect(rnd.between(0, WORLD.W), rnd.between(0, 140), 1, 1);
      this.sky.fillStyle(0xfff1e8).fillCircle(400, 30, 10);
      this.sky.fillStyle(0x0b0f1e).fillCircle(405, 27, 9);
    }
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'sprint') return;
    const sp = s.mini.state;
    if (sp.sub !== this.lastSub) {
      this.lastSub = sp.sub;
      const day = sp.sub !== 'wait';
      this.paintSky(day);
      this.tweens.killTweensOf(this.sun);
      if (sp.sub === 'go') {
        this.sun.setY(200);
        this.tweens.add({ targets: this.sun, y: 120, duration: 400, ease: 'Back.out' });
        this.cameras.main.flash(150, 255, 236, 39);
      } else {
        this.sun.setY(day ? 120 : 210);
      }
    }

    this.layer.removeAll(true);
    this.layer.add(txt(this, WORLD.W / 2, 8, `LIEGESTUHL-SPRINT   Runde ${sp.round}/${sp.rounds}`, { color: '#ffec27' }));

    if (sp.sub === 'wait') this.layer.add(txt(this, WORLD.W / 2, 70, '6 Uhr morgens ... psst ...\nNOCH NICHT tippen!', { color: '#c2c3c7' }));
    if (sp.sub === 'go') this.layer.add(txt(this, WORLD.W / 2, 60, 'JETZT!', { size: 24, color: '#ff004d' }));

    this.renderChairs(s, sp);
  }

  private renderChairs(s: GameState, sp: SprintState) {
    const ids = Object.keys(sp.points);
    const n = ids.length;
    const spacing = Math.min(56, 440 / Math.max(1, n));
    const ranked = ids
      .filter((id) => typeof sp.times[id] === 'number')
      .sort((a, b) => (sp.times[a] as number) - (sp.times[b] as number));

    ids.forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const t = sp.times[id];
      // Liegestuhl
      const g = this.add.graphics();
      g.fillStyle(0xfff1e8).fillRect(x - 12, 230, 24, 4);
      g.fillStyle(0x8b5a2b).fillRect(x - 12, 234, 2, 6).fillRect(x + 10, 234, 2, 6);
      if (typeof t === 'number') {
        const rank = ranked.indexOf(id);
        g.fillStyle([0xff004d, 0x29adff, 0x00e436][rank] ?? 0xffa300).fillRect(x - 10, 226, 20, 4);
      }
      this.layer.add(g);
      const img = this.add.image(x, 222, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(2);
      if (t === 'early') img.setAngle(90).setY(232).setAlpha(0.6);
      this.layer.add(img);
      this.layer.add(txt(this, x, 244, p.name.slice(0, 6), { color: '#1a1c2c', shadow: false }));
      let label = '';
      if (t === 'early') label = 'FEHL-\nSTART';
      else if (typeof t === 'number' && sp.sub !== 'wait') label = `${t}ms`;
      if (label) this.layer.add(txt(this, x, 172, label, { color: t === 'early' ? '#ff004d' : '#1a1c2c', shadow: false }));
      this.layer.add(txt(this, x, 256, `${sp.points[id]}P`, { color: '#ab5236', shadow: false }));
    });

    if ((sp.sub === 'reveal' || sp.sub === 'over') && ranked[0]) {
      this.layer.add(txt(this, WORLD.W / 2, 80, `${playerById(ranked[0])?.name} hat die beste Liege!`, { size: 8, color: '#1a1c2c', shadow: false }));
    }
  }
}
