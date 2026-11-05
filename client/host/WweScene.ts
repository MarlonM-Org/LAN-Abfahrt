import Phaser from 'phaser';
import type { GameState, WweState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSky, paintWoodFloor } from '../art/ground';
import { bus, getState, playerById } from './store';
import { figure } from './textures';
import { GREEN_INK, RED_INK, Countdown, background, ensureTex, fitText, ink, nameTag, panel, prop, tagName } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';

/** Gemütlicher Hütten-Abend am Kamin */
export class WweScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private renderedKey = '';
  private stateKey = '';
  private votedN = 0;
  private juice!: Juice;

  constructor() {
    super('wwe');
  }

  create() {
    this.renderedKey = '';
    this.stateKey = '';
    this.votedN = 0;
    this.juice = new Juice(this, { depth: 900 });
    background(this, 'cabin', WORLD.W, WORLD.H, (p) => {
      // Rückwand aus dunklen Brettern
      p.rect(0, 0, WORLD.W, 110, C.woodDark);
      for (let x = 0; x < WORLD.W; x += 12) p.vline(x, 0, 110, C.woodDarker).vline(x + 1, 0, 110, '#9b6233');
      p.rect(0, 106, WORLD.W, 6, C.woodDarker);
      paintWoodFloor(p, 0, 112, WORLD.W, WORLD.H - 112, 31);
      // Fenster mit Nachthimmel
      for (const wx of [40, 380]) {
        p.rect(wx - 2, 18, 64, 52, C.woodDarker);
        paintSky(p, wx, 20, 60, 48, ['#1b2350', '#2e3a78', '#4b4f96']);
        p.rect(wx + 44, 26, 6, 6, '#fff7c9');
        for (let i = 0; i < 6; i++) p.px(wx + 6 + ((i * 17) % 50), 24 + ((i * 11) % 30), C.white);
        p.vline(wx + 29, 20, 48, C.woodDarker).hline(wx, 43, 60, C.woodDarker);
        p.rect(wx - 4, 68, 68, 4, C.woodLight);
      }
      // Kamin
      p.rect(196, 20, 88, 92, C.stone);
      for (let y = 20; y < 112; y += 8) for (let x = 196 + ((y / 8) % 2) * 6; x < 284; x += 12) p.rect(x, y, 11, 7, ((x + y) % 3 === 0) ? C.stoneLight : '#b4b0a6');
      p.rect(192, 16, 96, 6, C.woodDark);
      p.rect(214, 62, 52, 50, '#2a1a12');
    });
    this.anims.exists('fire') || this.createFire();
    this.add.sprite(240, 108, 'fire0').setOrigin(0.5, 1).play('fire').setDepth(110);
    prop(this, 'rug_big', () => O.rug(220, 70, '#9e3d33'), 240, 250).setDepth(-500);
    prop(this, 'plantL', O.plant, 20, 128);
    prop(this, 'plantR', O.plant, 460, 128);
    // Wärmeschein des Feuers
    const glow = this.add.ellipse(240, 110, 220, 90, 0xffb347, 0.12).setDepth(-400);
    this.tweens.add({ targets: glow, alpha: 0.6, duration: 700, yoyo: true, repeat: -1 });

    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private createFire() {
    ensureTex(this, 'fire0', () => O.campfire(0));
    ensureTex(this, 'fire1', () => O.campfire(1));
    this.anims.create({ key: 'fire', frames: [{ key: 'fire0' }, { key: 'fire1' }], frameRate: 5, repeat: -1 });
  }

  update() {
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0) return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(99, 89, 282, 6);
    this.timerBar.fillStyle(frac < 0.25 ? 0xe04a3f : 0xf0b13a).fillRect(100, 90, 280 * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'wwe') return;
    const w = s.mini.state;
    const key = `${w.round}-${w.sub}`;
    if (key !== this.renderedKey) {
      const first = this.renderedKey === '';
      this.renderedKey = key;
      this.countdown.set(w.endsIn);
      this.total = Math.max(1, w.endsIn);
      if (!first) {
        // Neue Frage: Gong · Auflösung: Trommelwirbel, Pling, Lacher · Ende: Fanfare
        if (w.sub === 'question') sfx('select');
        else if (w.sub === 'over') sfx('fanfare');
        else {
          sfx('drumroll', { vol: 0.7 });
          sfx('coin', { delay: 0.6 });
          sfx('cheer', { delay: 0.7, vol: 0.7 });
          this.time.delayedCall(600, () => this.juice.burst(WORLD.W / 2, 120, 'confetti', 36));
        }
      }
    }
    if (w.sub === 'question' && w.voted.length > this.votedN) sfx('tick', { pitch: 1 + w.voted.length * 0.05 });
    this.votedN = w.sub === 'question' ? w.voted.length : 0;
    const sKey = JSON.stringify([w.sub, w.round, w.voted, w.tally]);
    if (sKey === this.stateKey) return;
    this.stateKey = sKey;

    this.layer.removeAll(true);
    this.layer.add(panel(this, 50, 4, 380, 80));
    this.layer.add(ink(this, WORLD.W / 2, 13, `Wer würde eher ...   (${w.round}/${w.rounds})`, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 30, w.question.replace(/^\.\.\.\s*/, ''), { size: w.question.length > 34 ? 8 : 16, wrap: 340 }));

    if (w.sub === 'question') this.renderVoting(s, w);
    else this.renderReveal(s, w);
  }

  private renderVoting(s: GameState, w: WweState) {
    const players = s.players.filter((p) => p.id in w.points);
    const n = players.length;
    const spacing = Math.min(70, 420 / Math.max(1, n));
    players.forEach((p, i) => {
      const x = WORLD.W / 2 + (i - (n - 1) / 2) * spacing;
      const voted = w.voted.includes(p.id);
      const f = figure(this, p.look, x, 226, 2);
      if (!voted) f.setAlpha(0.6);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, 230, p.name, voted ? GREEN_INK : undefined, spacing - 2));
      if (voted) this.layer.add(ink(this, x, 160, 'OK!', { color: GREEN_INK }).setBackgroundColor('#f7e4b5').setPadding(2, 1, 2, 1));
    });
  }

  private renderReveal(s: GameState, w: WweState) {
    const tally = w.tally ?? {};
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      this.layer.add(panel(this, 140, 120, 200, 40));
      this.layer.add(ink(this, WORLD.W / 2, 136, 'Keiner hat abgestimmt?!'));
      return;
    }
    const max = entries[0][1];
    const winners = entries.filter((e) => e[1] === max).map((e) => e[0]);
    // Gewinner groß in der Mitte
    winners.slice(0, 3).forEach((id, i) => {
      const p = playerById(id);
      if (!p) return;
      const x = WORLD.W / 2 + (i - (Math.min(3, winners.length) - 1) / 2) * 70;
      const f = figure(this, p.look, x, 186, 3);
      this.layer.add(f);
      this.tweens.add({ targets: f.getData('img'), y: -6, duration: 260, yoyo: true, repeat: -1 });
      this.layer.add(nameTag(this, x, 190, p.name, RED_INK, 68));
    });
    // Stimmen-Liste rechts
    const top = entries.slice(0, 6);
    this.layer.add(panel(this, 352, 96, 122, 20 + top.length * 14));
    top.forEach(([id, count], i) => {
      this.layer.add(fitText(ink(this, 362, 106 + i * 14, tagName(playerById(id)?.name ?? '?'), { origin: [0, 0], color: count === max ? RED_INK : undefined }), 84));

      this.layer.add(ink(this, 464, 106 + i * 14, String(count), { origin: [1, 0] }));
    });
    if (w.drinking && w.sips) {
      const drinkers = Object.entries(w.sips).map(([id, n]) => `${playerById(id)?.name ?? '?'} trinkt ${n}`);
      if (drinkers.length) this.layer.add(ink(this, WORLD.W / 2, 254, drinkers.join(' · ')).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1));
    } else if (w.sub === 'over') this.layer.add(ink(this, WORLD.W / 2, 254, 'Gleich gibt’s die Punkte ...'));
  }
}
