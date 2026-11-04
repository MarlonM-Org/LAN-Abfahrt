import Phaser from 'phaser';
import QRCode from 'qrcode';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath } from '../art/ground';
import { bus, getState } from './store';
import { figure } from './textures';
import { INK, RED_INK, background, ensureTex, ink, nameTag, panel, prop } from './ui';

const SLOTS = 8;

export class LobbyScene extends Phaser.Scene {
  private playerLayer!: Phaser.GameObjects.Container;
  private qrLayer!: Phaser.GameObjects.Container;
  private urlText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private renderedUrl = '';
  private renderedPlayers = '';
  private subtitle!: Phaser.GameObjects.Text;

  constructor() {
    super('lobby');
  }

  create() {
    // Szenen-Instanzen werden beim Neustart wiederverwendet → Zustand zurücksetzen
    this.renderedUrl = '';
    this.renderedPlayers = '';

    background(this, 'lobby', WORLD.W, WORLD.H, (p) => {
      paintGrass(p, 0, 0, WORLD.W, WORLD.H, 4);
      paintPath(p, [{ x: 66, y: 92 }, { x: 70, y: 150 }, { x: 150, y: 244 }, { x: 480, y: 250 }], 16, 8);
      paintPath(p, [{ x: 150, y: 244 }, { x: 60, y: 270 }], 14, 9);
    });

    // Deko
    prop(this, 'cottage', O.cottage, 64, 92);
    for (let x = 130; x < WORLD.W; x += 32) prop(this, 'fence32', () => O.fence(32), x + 16, 30);
    prop(this, 'tree1', () => O.tree(1), 462, 74);
    prop(this, 'tree7', () => O.tree(7), 22, 268);
    prop(this, 'fruitTree', () => O.fruitTree(3), 452, 214);
    prop(this, 'bush3', () => O.bush(3), 140, 106);
    prop(this, 'bush4', () => O.bush(4, true), 430, 248);
    prop(this, 'flowerPink', () => O.flower(C.pink), 120, 98);
    prop(this, 'flowerWhite', () => O.flower(C.white), 126, 100);
    prop(this, 'rock', () => O.rock(), 28, 112);

    // Titelschild
    panel(this, 150, 2, 220, 40).setDepth(500);
    ink(this, 260, 10, 'LAN-ABFAHRT', { size: 16, color: RED_INK }).setDepth(501);
    this.subtitle = ink(this, 260, 28, '~ Urlaubs-Edition ~').setDepth(501);

    // QR-Code auf einem Brett
    const board = ensureTex(this, 'qrboard', () => O.noticeBoard(124, 122));
    this.add.image(10, 104, board).setOrigin(0, 0).setDepth(240);
    this.qrLayer = this.add.container(0, 0).setDepth(241);

    this.playerLayer = this.add.container(0, 0).setDepth(300);

    panel(this, 150, 232, 316, 36).setDepth(500);
    this.urlText = ink(this, 308, 240, '').setDepth(501);
    this.hintText = ink(this, 308, 252, '', { color: RED_INK }).setDepth(501);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));

    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    if (s.joinUrl !== this.renderedUrl) this.renderQr(s.joinUrl);

    this.subtitle.setText(s.mode === 'date' ? '~ Date Night ~' : s.mode === 'drink' ? '~ Trinkspiel ~' : '~ Urlaubs-Edition ~').setColor(s.mode === 'date' ? '#b0306a' : s.mode === 'drink' ? '#c06a1f' : INK);
    const n = s.players.filter((p) => p.connected).length;
    this.hintText.setText(n < 2 ? 'Scannt den QR-Code – mind. 2 Spieler!' : 'Der VIP wählt am Handy ein Spiel!');

    const key = s.players.map((p) => `${p.id}${p.connected}${p.isVip}${p.name}${JSON.stringify(p.look)}`).join('|');
    if (key === this.renderedPlayers) return;
    this.renderedPlayers = key;

    this.playerLayer.removeAll(true);
    for (let i = 0; i < SLOTS; i++) {
      const p = s.players[i];
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 196 + col * 74 + (row % 2) * 18;
      const y = 120 + row * 88;
      if (!p) {
        const ghost = this.add.ellipse(x, y - 2, 22, 7, 0x000000, 0.12);
        this.playerLayer.add(ghost);
        continue;
      }
      const f = figure(this, p.look, x, y, 2);
      if (!p.connected) f.setAlpha(0.4);
      const img = f.getData('img') as Phaser.GameObjects.Image;
      this.tweens.add({ targets: img, y: -3, duration: 380 + i * 41, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.playerLayer.add(f);
      this.playerLayer.add(nameTag(this, x, y + 4, p.name.slice(0, 8)));
      if (p.isVip) this.playerLayer.add(this.crown(x, y - 59));
    }
  }

  private crown(x: number, y: number) {
    const key = ensureTex(this, 'crown', O.crown);
    const img = this.add.image(x, y, key).setScale(1);
    this.tweens.add({ targets: img, y: y - 2, duration: 600, yoyo: true, repeat: -1 });
    return img;
  }

  private renderQr(url: string) {
    this.renderedUrl = url;
    this.qrLayer.removeAll(true);
    this.urlText.setText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));

    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const cell = Math.max(2, Math.floor(104 / (size + 2)));
    const total = (size + 2) * cell;
    const ox = 10 + Math.floor((124 - total) / 2);
    const oy = 104 + Math.floor((122 - total) / 2);
    const g = this.add.graphics();
    g.fillStyle(0xffffff).fillRect(ox, oy, total, total);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(INK).color);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) g.fillRect(ox + (x + 1) * cell, oy + (y + 1) * cell, cell, cell);
      }
    }
    this.qrLayer.add(g);
  }
}
