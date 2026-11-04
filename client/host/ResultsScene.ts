import Phaser from 'phaser';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath } from '../art/ground';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { PLACE_COLORS, RED_INK, background, ensureTex, ink, nameTag, panel, prop } from './ui';

export class ResultsScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private stateKey = '';

  constructor() {
    super('results');
  }

  create() {
    this.stateKey = '';
    background(this, 'results', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 61);
      paintPath(p, [{ x: 0, y: 250 }, { x: 480, y: 246 }], 18, 62);
    });
    prop(this, 'tree1', () => O.tree(1), 22, 120);
    prop(this, 'tree7', () => O.tree(7), 460, 110);
    prop(this, 'fruitTree', () => O.fruitTree(3), 34, 236);
    prop(this, 'bush4', () => O.bush(4, true), 446, 236);
    this.layer = this.add.container(0, 0).setDepth(500);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));
    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    const r = s.results;
    const key = JSON.stringify(r);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.layer.removeAll(true);
    if (!r) return;

    this.layer.add(panel(this, 60, 2, 360, 64));
    this.layer.add(ink(this, WORLD.W / 2, 9, r.final ? '~ Endstand ~' : '~ Ergebnis ~', { color: '#7a5a3a' }));
    this.layer.add(ink(this, WORLD.W / 2, r.title.length > 20 ? 25 : 21, r.title, { size: r.title.length > 20 ? 8 : 16, color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 40, r.subtitle, { wrap: 340 }));

    if (r.final) this.renderPodium(s);
    else if (r.hearts !== undefined) this.renderHearts(s);
    else this.renderList(s);

    const footer = s.drinkActive ? 'VIP: Nächste Runde oder Beenden am Handy' : s.date ? 'Am Handy auf „Weiter“ tippen' : r.final || !s.partyActive ? 'VIP: Am Handy zurück zur Lobby' : 'VIP: Am Handy weiter zum Spielbrett';
    this.layer.add(ink(this, WORLD.W / 2, 258, footer).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  private renderHearts(s: GameState) {
    const r = s.results!;
    const max = r.maxHearts ?? 10;
    const heart = ensureTex(this, 'heart', O.heart);
    this.layer.add(panel(this, 80, 74, 320, 44));
    for (let i = 0; i < max; i++) {
      const img = this.add.image(WORLD.W / 2 + (i - (max - 1) / 2) * 26, 96, heart).setScale(2);
      if (i >= (r.hearts ?? 0)) img.setTint(0x6e6a62).setAlpha(0.45);
      else {
        img.setScale(0);
        this.tweens.add({ targets: img, scale: 2, duration: 300, delay: 200 + i * 120, ease: 'Back.out' });
      }
      this.layer.add(img);
    }
    this.renderList(s, 126);
  }

  private renderList(s: GameState, top = 72) {
    const r = s.results!;
    const x = 60, y = top, w = 360;
    const rowH = Math.min(22, Math.floor((236 - top) / Math.max(1, r.rows.length)));
    this.layer.add(panel(this, x, y, w, rowH * r.rows.length + 16));
    r.rows.forEach((row, i) => {
      const p = playerById(row.playerId);
      const ry = y + 8 + i * rowH;
      const color = r.hearts !== undefined ? '#3d2414' : PLACE_COLORS[Math.min(row.place - 1, PLACE_COLORS.length - 1)];
      if (r.hearts === undefined) this.layer.add(ink(this, x + 14, ry + 6, `${row.place}.`, { origin: [0, 0], color }));
      if (p) this.layer.add(this.add.image(x + 44, ry + rowH - 3, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      this.layer.add(ink(this, x + 58, ry + 6, p?.name ?? '?', { origin: [0, 0], color }));
      this.layer.add(ink(this, x + 156, ry + 6, row.detail.slice(0, r.hearts !== undefined ? 24 : 16), { origin: [0, 0], color: '#7a5a3a' }));
      if (s.partyActive) {
        this.layer.add(this.add.image(x + w - 46, ry + 9, ensureTex(this, 'coin', O.coinIcon)));
        this.layer.add(ink(this, x + w - 14, ry + 6, `+${row.coins}`, { origin: [1, 0] }));
      } else if (r.arcade) {
        this.layer.add(ink(this, x + w - 14, ry + 6, `+${r.arcade[row.playerId] ?? 0} Pkt`, { origin: [1, 0], color: RED_INK }));
      }
    });
  }

  private renderPodium(s: GameState) {
    const r = s.results!;
    const podium = [
      { place: 2, x: 136, h: 3 },
      { place: 1, x: 240, h: 4 },
      { place: 3, x: 344, h: 2 },
    ];
    const baseY = 214;
    const crate = ensureTex(this, 'crate', O.crate);
    for (const slot of podium) {
      for (let k = 0; k < slot.h; k++) {
        for (const dx of [-16, 0, 16]) this.layer.add(this.add.image(slot.x + dx, baseY - k * 16, crate).setOrigin(0.5, 1));
      }
      const top = baseY - slot.h * 16;
      this.layer.add(ink(this, slot.x, baseY - 12, String(slot.place), { size: 8, color: C.white }).setShadow(1, 1, '#2d1b12', 0, false, true));
      const row = r.rows.filter((rw) => rw.place === slot.place);
      row.slice(0, 3).forEach((rw, i) => {
        const p = playerById(rw.playerId);
        if (!p) return;
        const ox = (i - (Math.min(3, row.length) - 1) / 2) * 24;
        const f = figure(this, p.look, slot.x + ox, top, 2);
        this.layer.add(f);
        if (slot.place === 1) {
          this.tweens.add({ targets: f.getData('img'), y: -6, duration: 300, yoyo: true, repeat: -1 });
          this.layer.add(this.add.image(slot.x + ox, top - 62, ensureTex(this, 'crown', O.crown)).setScale(2));
        }
      });
      const names = row.map((rw) => playerById(rw.playerId)?.name ?? '?').join(', ');
      const detail = row[0]?.detail.replace(' Cocktails · ', ' Cockt.\n').replace(' Münzen', ' $') ?? '';
      if (row.length) {
        this.layer.add(nameTag(this, slot.x, baseY + 2, names.slice(0, 10)));
        this.layer.add(ink(this, slot.x, baseY + 16, detail, { color: '#7a5a3a' }).setBackgroundColor('#f7e4b5').setPadding(2, 1, 2, 1));
      }
    }
    const rest = r.rows.filter((rw) => rw.place > 3);
    if (rest.length) {
      const line = rest.map((rw) => `${rw.place}. ${playerById(rw.playerId)?.name ?? '?'}`).join('  ');
      this.layer.add(ink(this, WORLD.W / 2, 72, line).setBackgroundColor('#f7e4b5').setPadding(3, 1, 3, 1));
    }
  }
}
