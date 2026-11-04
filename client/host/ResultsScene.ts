import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { bus, getState, playerById } from './store';
import { ensureAvatar } from './textures';
import { PLACE_COLORS, panel, txt } from './ui';

export class ResultsScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;

  constructor() {
    super('results');
  }

  create() {
    const g = this.add.graphics();
    const bands = [0x29366f, 0x3b5dc9, 0x41a6f6];
    bands.forEach((c, i) => g.fillStyle(c).fillRect(0, i * 90, WORLD.W, 90));
    this.layer = this.add.container(0, 0);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    const r = s.results;
    this.layer.removeAll(true);
    if (!r) return;

    this.layer.add(txt(this, WORLD.W / 2, 10, r.final ? 'ENDSTAND' : 'ERGEBNIS', { color: '#c2c3c7' }));
    this.layer.add(txt(this, WORLD.W / 2, 24, r.title, { size: 16, color: '#ffec27' }));
    this.layer.add(txt(this, WORLD.W / 2, 46, r.subtitle, { wrap: 440 }));

    if (r.final) this.renderPodium(s);
    else this.renderList(s);

    const footer = r.final ? 'VIP: Am Handy zurück zur Lobby' : s.partyActive ? 'VIP: Am Handy weiter zum Spielbrett' : 'VIP: Am Handy zurück zur Lobby';
    this.layer.add(txt(this, WORLD.W / 2, 254, footer, { color: '#c2c3c7' }));
  }

  private renderList(s: GameState) {
    const r = s.results!;
    const x = 60, y = 70, w = 360;
    const rowH = Math.min(22, Math.floor(176 / Math.max(1, r.rows.length)));
    this.layer.add(panel(this, x, y, w, rowH * r.rows.length + 8, 0.85));
    r.rows.forEach((row, i) => {
      const p = playerById(row.playerId);
      const ry = y + 4 + i * rowH;
      const color = PLACE_COLORS[Math.min(row.place - 1, PLACE_COLORS.length - 1)];
      this.layer.add(txt(this, x + 14, ry + 5, `${row.place}.`, { origin: [0, 0], color }));
      if (p) this.layer.add(this.add.image(x + 46, ry + rowH - 2, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(rowH >= 20 ? 1 : 0.8));
      this.layer.add(txt(this, x + 60, ry + 5, p?.name ?? '?', { origin: [0, 0], color }));
      this.layer.add(txt(this, x + 160, ry + 5, row.detail, { origin: [0, 0], color: '#c2c3c7' }));
      if (s.partyActive) this.layer.add(txt(this, x + w - 10, ry + 5, `+${row.coins} $`, { origin: [1, 0], color: '#ffec27' }));
    });
  }

  private renderPodium(s: GameState) {
    const r = s.results!;
    const podium = [
      { place: 2, x: 150, h: 40 },
      { place: 1, x: 240, h: 60 },
      { place: 3, x: 330, h: 26 },
    ];
    const baseY = 186;
    for (const slot of podium) {
      const row = r.rows.filter((rw) => rw.place === slot.place);
      const g = this.add.graphics();
      g.fillStyle(slot.place === 1 ? 0xffec27 : slot.place === 2 ? 0xc2c3c7 : 0xffa300).fillRect(slot.x - 36, baseY - slot.h, 72, slot.h);
      this.layer.add(g);
      this.layer.add(txt(this, slot.x, baseY - slot.h + 6, String(slot.place), { size: 16, color: '#1a1c2c', shadow: false }));
      row.forEach((rw, i) => {
        const p = playerById(rw.playerId);
        if (!p) return;
        const ox = (i - (row.length - 1) / 2) * 22;
        const img = this.add.image(slot.x + ox, baseY - slot.h, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(slot.place === 1 ? 3 : 2);
        this.layer.add(img);
        if (slot.place === 1) this.tweens.add({ targets: img, y: img.y - 6, duration: 300, yoyo: true, repeat: -1 });
        this.layer.add(txt(this, slot.x + ox, baseY + 4 + i * 0, p.name.slice(0, 8), { color: '#fff1e8' }));
        this.layer.add(txt(this, slot.x + ox, baseY + 16, rw.detail.replace(' · ', '\n'), { color: '#c2c3c7' }));
      });
    }
    const rest = r.rows.filter((rw) => rw.place > 3);
    if (rest.length) {
      const line = rest.map((rw) => `${rw.place}. ${playerById(rw.playerId)?.name ?? '?'}`).join('   ');
      this.layer.add(txt(this, WORLD.W / 2, 234, line, { color: '#c2c3c7', wrap: 460 }));
    }
  }
}
