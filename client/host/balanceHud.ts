import Phaser from 'phaser';
import type { BalanceTurn } from '../../shared/balance';
import { playerById } from './store';
import { tagName, txt } from './ui';

/**
 * Board-Anzeige für die Balance-Board-Spiele: Draufsicht aufs Board mit dem Schwerpunkt als Punkt und der
 * Zielzone als Ring, darunter das Gewicht. Dazu die „Steig aufs Board“-Karte in Phase `ready`.
 * Liegt fest auf dem Bildschirm (scrollFactor 0).
 */
export class BalanceHud {
  private c: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private card: Phaser.GameObjects.Container;
  private cardTitle: Phaser.GameObjects.Text;
  private cardSub: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.Graphics;
  private dot = { x: 0, y: 0 };
  /** Zielzone (Schwerpunkt), null = keine */
  target: { x: number; y: number; r: number } | null = null;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private w = 64,
    private h = 38,
    depth = 3000,
  ) {
    this.c = scene.add.container(x, y).setDepth(depth).setScrollFactor(0);
    this.g = scene.add.graphics();
    this.label = txt(scene, w / 2, h + 4, '', { size: 8 });
    this.c.add([this.g, this.label, txt(scene, w / 2, -10, 'vorn', { size: 8, color: '#bcd3ff' })]);

    this.card = scene.add.container(240, 128).setDepth(depth + 1).setScrollFactor(0);
    const bg = scene.add.rectangle(0, 0, 360, 96, 0x141c30, 0.93).setStrokeStyle(2, 0xa0c8ff, 0.8);
    this.cardTitle = txt(scene, 0, -38, '', { size: 16, color: '#ffd25e' });
    this.cardSub = txt(scene, 0, -10, '', { size: 8, wrap: 330 });
    this.bar = scene.add.graphics();
    this.card.add([bg, this.cardTitle, this.cardSub, this.bar]);
    this.card.setVisible(false);
  }

  /** Jeden Frame: Punkt weich nachziehen, Karte zeigen/verstecken */
  update(st: BalanceTurn & { sub: string }) {
    const b = st.bal;
    const tx = b ? b.x : 0;
    const ty = b ? b.y : 0;
    this.dot.x += (tx - this.dot.x) * 0.35;
    this.dot.y += (ty - this.dot.y) * 0.35;
    const { w, h, g } = this;
    g.clear();
    // Board: weißer Kasten mit grauer Standfläche
    g.fillStyle(0xf2f2ee, 1).fillRoundedRect(0, 0, w, h, 6);
    g.fillStyle(0xc9ccd2, 1).fillRoundedRect(4, 4, w / 2 - 6, h - 8, 4).fillRoundedRect(w / 2 + 2, 4, w / 2 - 6, h - 8, 4);
    g.lineStyle(1, 0x7b8090, 1).strokeRoundedRect(0, 0, w, h, 6);
    const sx = (v: number) => w / 2 + v * (w / 2 - 5);
    const sy = (v: number) => h / 2 - v * (h / 2 - 5);
    if (this.target) {
      g.lineStyle(2, 0x3fbf5a, 0.9).strokeEllipse(sx(this.target.x), sy(this.target.y), this.target.r * (w - 10), this.target.r * (h - 10));
    }
    if (b && b.w > 10) {
      g.fillStyle(0xe2574c, 1).fillCircle(sx(this.dot.x), sy(this.dot.y), 3.5);
      g.lineStyle(1, 0x7a1e18, 1).strokeCircle(sx(this.dot.x), sy(this.dot.y), 3.5);
    }
    const lbl = !st.board ? 'kein Board' : b ? `${b.w} kg` : '';
    if (this.label.text !== lbl) this.label.setText(lbl).setColor(st.board ? '#fff4d6' : '#ff8a7a');

    const ready = st.sub === 'ready' && !!st.active;
    this.card.setVisible(ready);
    if (ready) {
      const name = tagName(playerById(st.active)?.name ?? '?');
      const title = `${name}, du bist dran!`;
      if (this.cardTitle.text !== title) this.cardTitle.setText(title);
      const standing = !!b && b.w >= 15;
      const sub = !st.board
        ? 'Kein Balance Board verbunden – am Laptop B drücken.\nErsatz: Pfeiltasten + J'
        : standing
          ? 'Ruhig stehen … Gewicht wird eingemessen'
          : `Stell dich aufs Balance Board!  (${Math.ceil(st.endsIn / 1000)} s)`;
      if (this.cardSub.text !== sub) this.cardSub.setText(sub);
      this.bar.clear();
      this.bar.fillStyle(0x2a3550, 1).fillRect(-120, 34, 240, 8);
      this.bar.fillStyle(0x3fbf5a, 1).fillRect(-120, 34, 240 * st.calib, 8);
    }
  }

  setVisible(v: boolean) {
    this.c.setVisible(v);
  }
}
