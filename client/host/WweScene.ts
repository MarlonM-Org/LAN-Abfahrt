import Phaser from 'phaser';
import type { GameState, WweState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { Countdown, panel, txt } from './ui';

export class WweScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private renderedKey = '';

  constructor() {
    super('wwe');
  }

  create() {
    this.renderedKey = '';
    const g = this.add.graphics();
    g.fillStyle(0x7e2553).fillRect(0, 0, WORLD.W, WORLD.H);
    for (let i = 0; i < 14; i++) g.fillStyle(i % 2 ? 0x83285a : 0x7e2553).fillRect(0, i * 20, WORLD.W, 20);
    this.layer = this.add.container(0, 0);
    this.timerBar = this.add.graphics().setDepth(10);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0) return;
    this.timerBar.fillStyle(0x1a1c2c).fillRect(40, 258, WORLD.W - 80, 6);
    this.timerBar.fillStyle(frac < 0.25 ? 0xff004d : 0xffec27).fillRect(41, 259, (WORLD.W - 82) * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'wwe') return;
    const w = s.mini.state;
    const key = `${w.round}-${w.sub}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.countdown.set(w.endsIn);
      this.total = Math.max(1, w.endsIn);
    }
    this.layer.removeAll(true);
    this.layer.add(txt(this, WORLD.W / 2, 8, `WER WÜRDE EHER ...   ${w.round}/${w.rounds}`, { color: '#ff77a8' }));
    this.layer.add(panel(this, 30, 24, WORLD.W - 60, 56, 0.85, 0xff77a8));
    this.layer.add(txt(this, WORLD.W / 2, 34, w.question, { size: 16, wrap: WORLD.W - 80, color: '#fff1e8' }).setFontSize(w.question.length > 60 ? 8 : 16));

    if (w.sub === 'question') this.renderVoting(s, w);
    else this.renderReveal(s, w);
  }

  private renderVoting(s: GameState, w: WweState) {
    const players = s.players.filter((p) => p.id in w.points);
    this.layer.add(txt(this, WORLD.W / 2, 96, 'Stimmt am Handy ab!', { color: '#ffec27' }));
    const n = players.length;
    const spacing = Math.min(56, 420 / Math.max(1, n));
    players.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const voted = w.voted.includes(p.id);
      const img = this.add.image(x, 190, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(3).setAlpha(voted ? 1 : 0.45);
      this.layer.add(img);
      this.layer.add(txt(this, x, 196, p.name.slice(0, 6)));
      this.layer.add(txt(this, x, 212, voted ? 'OK!' : '...', { color: voted ? '#00e436' : '#c2c3c7' }));
    });
  }

  private renderReveal(s: GameState, w: WweState) {
    const tally = w.tally ?? {};
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      this.layer.add(txt(this, WORLD.W / 2, 140, 'Keiner hat abgestimmt?!', { size: 16 }));
      return;
    }
    const max = entries[0][1];
    const winners = entries.filter((e) => e[1] === max).map((e) => playerById(e[0])?.name ?? '?');
    this.layer.add(txt(this, WORLD.W / 2, 90, `${winners.join(' & ')}!`, { size: 16, color: '#ffec27' }));

    const top = entries.slice(0, 6);
    const barMax = 260;
    top.forEach(([id, count], i) => {
      const p = playerById(id);
      const y = 120 + i * 22;
      if (p) this.layer.add(this.add.image(70, y + 18, ensureAvatar(this, p.look)).setOrigin(0.5, 1));
      this.layer.add(txt(this, 84, y + 6, (p?.name ?? '?').slice(0, 8), { origin: [0, 0] }));
      const g = this.add.graphics();
      const width = (count / max) * barMax * 0.75;
      g.fillStyle(count === max ? 0xffec27 : 0xc2c3c7).fillRect(164, y + 4, 0, 12);
      this.layer.add(g);
      this.tweens.addCounter({
        from: 0,
        to: width,
        duration: 600,
        delay: i * 120,
        onUpdate: (tw) => {
          g.clear();
          g.fillStyle(count === max ? 0xffec27 : 0xc2c3c7).fillRect(164, y + 4, tw.getValue() ?? 0, 12);
        },
      });
      this.layer.add(txt(this, 172 + width, y + 6, String(count), { origin: [0, 0] }));
    });
    if (w.sub === 'over') this.layer.add(txt(this, WORLD.W / 2, 246, 'Gleich gibt’s die Punkte ...', { color: '#c2c3c7' }));
  }
}
