import Phaser from 'phaser';
import QRCode from 'qrcode';
import type { GameState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { FONT, bus, getState } from './store';
import { ensureAvatar } from './textures';

const SLOTS = 8;

export class LobbyScene extends Phaser.Scene {
  private playerLayer!: Phaser.GameObjects.Container;
  private qrLayer!: Phaser.GameObjects.Container;
  private urlText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private renderedUrl = '';

  constructor() {
    super('lobby');
  }

  create() {
    // Szenen-Instanzen werden beim Neustart wiederverwendet → Zustand zurücksetzen
    this.renderedUrl = '';
    this.drawBackground();

    this.add
      .text(WORLD.W / 2, 16, 'LAN-ABFAHRT', { fontFamily: FONT, fontSize: '16px', color: '#ffec27' })
      .setOrigin(0.5, 0)
      .setShadow(2, 2, '#ab5236', 0, false, true);
    this.add
      .text(WORLD.W / 2, 38, 'Urlaubs-Edition', { fontFamily: FONT, fontSize: '8px', color: '#fff1e8' })
      .setOrigin(0.5, 0);

    this.qrLayer = this.add.container(0, 0);
    this.playerLayer = this.add.container(0, 0);

    this.add.text(30, 204, 'Mit dem Handy', { fontFamily: FONT, fontSize: '8px', color: '#fff1e8' });
    this.add.text(30, 216, 'scannen!', { fontFamily: FONT, fontSize: '8px', color: '#fff1e8' });
    this.urlText = this.add
      .text(WORLD.W / 2, 246, '', { fontFamily: FONT, fontSize: '8px', color: '#1a1c2c' })
      .setOrigin(0.5, 0);
    this.hintText = this.add
      .text(WORLD.W / 2, 258, '', { fontFamily: FONT, fontSize: '8px', color: '#ab5236' })
      .setOrigin(0.5, 0);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));

    const s = getState();
    if (s) this.render(s);
  }

  private drawBackground() {
    const g = this.add.graphics();
    // Himmel → Meer → Strand
    const bands = [0x29366f, 0x3b5dc9, 0x41a6f6, 0x73eff7];
    bands.forEach((c, i) => g.fillStyle(c).fillRect(0, i * 14, WORLD.W, 14));
    g.fillStyle(0x3b5dc9).fillRect(0, 56, WORLD.W, WORLD.H);
    g.fillStyle(0xf4d58d).fillRect(0, 236, WORLD.W, WORLD.H - 236);
    // Sonne
    g.fillStyle(0xffcd75).fillCircle(420, 22, 12);
    // Panel für Spieler
    g.fillStyle(0x1a1c2c, 0.75).fillRect(170, 58, 290, 172);
    g.lineStyle(1, 0xffec27).strokeRect(170.5, 58.5, 289, 171);
  }

  private render(s: GameState) {
    if (s.joinUrl !== this.renderedUrl) this.renderQr(s.joinUrl);

    this.playerLayer.removeAll(true);
    const cellW = 72;
    const cellH = 84;
    for (let i = 0; i < SLOTS; i++) {
      const p = s.players[i];
      const cx = 170 + 18 + (i % 4) * cellW + cellW / 2 - 18;
      const cy = 64 + Math.floor(i / 4) * cellH;
      if (!p) {
        this.playerLayer.add(
          this.add.text(cx, cy + 28, '?', { fontFamily: FONT, fontSize: '16px', color: '#5f574f' }).setOrigin(0.5, 0),
        );
        continue;
      }
      const sprite = this.add.image(cx, cy + 58, ensureAvatar(this, p.look)).setOrigin(0.5, 1).setScale(3);
      if (!p.connected) sprite.setAlpha(0.35);
      this.tweens.add({ targets: sprite, y: sprite.y - 3, duration: 400 + i * 37, yoyo: true, repeat: -1 });
      this.playerLayer.add(sprite);
      this.playerLayer.add(
        this.add
          .text(cx, cy + 62, p.name.slice(0, 8), { fontFamily: FONT, fontSize: '8px', color: '#fff1e8' })
          .setOrigin(0.5, 0),
      );
      if (p.isVip) {
        this.playerLayer.add(
          this.add.text(cx, cy + 72, 'VIP', { fontFamily: FONT, fontSize: '8px', color: '#ffec27' }).setOrigin(0.5, 0),
        );
      }
    }

    const n = s.players.filter((p) => p.connected).length;
    this.hintText.setText(
      n < 2 ? 'Warte auf mindestens 2 Spieler ...' : 'Der VIP wählt am Handy ein Spiel!',
    );
  }

  private renderQr(url: string) {
    this.renderedUrl = url;
    this.qrLayer.removeAll(true);
    this.urlText.setText(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));

    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const cell = Math.max(2, Math.floor(130 / (size + 4)));
    const total = (size + 4) * cell;
    const ox = 20 + Math.floor((140 - total) / 2);
    const oy = 62;
    const g = this.add.graphics();
    g.fillStyle(0xffffff).fillRect(ox, oy, total, total);
    g.fillStyle(0x000000);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) g.fillRect(ox + (x + 2) * cell, oy + (y + 2) * cell, cell, cell);
      }
    }
    this.qrLayer.add(g);
  }
}
