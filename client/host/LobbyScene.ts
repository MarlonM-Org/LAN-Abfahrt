import Phaser from 'phaser';
import QRCode from 'qrcode';
import type { GameState, MiniKind } from '../../shared/types';
import { MINI_INFO } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintGrass, paintPath } from '../art/ground';
import { bus, getState, joinUrlOf } from './store';
import { ensurePortrait, figure } from './textures';
import { INK, RED_INK, background, ensureTex, ink, nameTag, panel, prop } from './ui';
import { drawSessionBoard } from './sessionBoard';
import { daylight, gulls, sway } from './ambient';

/** Bis 8 Spieler: 2 Reihen à 4; ab 9 Spielern: 2 Reihen à 6 im Zickzack (Platz für 12) */
const SLOTS = 8;
const SLOTS_MAX = 12;

/** So viele Zeichen (8 px, Festbreite) passen auf das Schild unten (316 px breit) */
const URL_CHARS = 38;

/** Adresse in höchstens zwei Zeilen à `max` Zeichen – umbrechen vor „.“ oder nach „-“/„:“, notfalls hart */
function fitLines(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  let cut = -1;
  for (let i = 1; i <= max; i++) if (text[i] === '.' || text[i - 1] === '-' || text[i - 1] === ':') cut = i;
  if (cut < 8) cut = max;
  const rest = text.slice(cut);
  return [text.slice(0, cut), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

export class LobbyScene extends Phaser.Scene {
  private playerLayer!: Phaser.GameObjects.Container;
  private qrLayer!: Phaser.GameObjects.Container;
  private urlText!: Phaser.GameObjects.Text;
  private urlPanel!: Phaser.GameObjects.Image;
  private urlPanelTall!: Phaser.GameObjects.Image;
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

    // Tageszeit (echte Uhrzeit bzw. Brett) färbt den Garten; Möwen ziehen vorbei, Bäume wiegen sich leicht
    daylight(this, { depth: -950, strength: 0.7 });
    gulls(this, { n: 2, y: [40, 120], depth: 800 });

    // Deko
    prop(this, 'cottage', O.cottage, 64, 92);
    for (let x = 130; x < WORLD.W; x += 32) prop(this, 'fence32', () => O.fence(32), x + 16, 30);
    sway(this, [prop(this, 'tree1', () => O.tree(1), 462, 74), prop(this, 'tree7', () => O.tree(7), 22, 268)], { angle: 1, ms: 2600 });
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

    this.urlPanel = panel(this, 150, 232, 316, 36).setDepth(500);
    // Höheres Schild für Adressen auf zwei Zeilen (TV bei Freunden über den Online-Tunnel)
    this.urlPanelTall = panel(this, 150, 225, 316, 43).setDepth(500).setVisible(false);
    this.urlText = ink(this, 308, 240, '').setDepth(501);
    this.hintText = ink(this, 308, 252, '', { color: RED_INK }).setDepth(501);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));

    const s = getState();
    if (s) this.render(s);
  }

  private render(s: GameState) {
    const url = joinUrlOf(s);
    if (url !== this.renderedUrl) this.renderQr(url);

    this.subtitle.setText(s.mode === 'date' ? '~ Date Night ~' : s.mode === 'drink' ? '~ Trinkspiel ~' : s.mode === 'arcade' ? '~ Arcade ~' : '~ Urlaubs-Edition ~').setColor(s.mode === 'date' ? '#b0306a' : s.mode === 'drink' ? '#c06a1f' : INK);
    const n = s.players.filter((p) => p.connected).length;
    const offMin = (p: GameState['players'][number]) => Math.floor((p.offlineMs ?? 0) / 60_000);
    this.hintText.setText(
      s.showBoard ? 'Leaderboard des Abends (L / VIP-Handy)' : n < 2 ? 'Scannt den QR-Code – mind. 2 Spieler!' : s.mode === 'arcade' && s.arcadeVote ? this.voteHint(s) : 'Der VIP wählt am Handy ein Spiel!',
    );

    // Arcade: Leaderboard des Abends, sobald heute gespielt wurde – vorher die ewige Tabelle
    const sessionBoard = s.showBoard || (s.mode === 'arcade' && s.session.games > 0);
    const key =
      s.mode +
      s.players.map((p) => `${p.id}${p.connected}${p.isVip}${p.name}${JSON.stringify(p.look)}${p.connected ? '' : offMin(p)}`).join('|') +
      (sessionBoard ? `S${s.showBoard}${JSON.stringify(s.session)}` : s.mode === 'arcade' ? JSON.stringify(s.leaderboard) : '');
    if (key === this.renderedPlayers) return;
    this.renderedPlayers = key;

    this.playerLayer.removeAll(true);
    if (sessionBoard) {
      drawSessionBoard(this, this.playerLayer, s.session, { x: 150, y: 46, w: 316, maxBottom: 228 }, { title: s.session.games ? undefined : 'LEADERBOARD HEUTE · NOCH LEER' });
      return;
    }
    if (s.mode === 'arcade') return this.renderLeaderboard(s);
    const wide = s.players.length > SLOTS;
    for (let i = 0; i < (wide ? SLOTS_MAX : SLOTS); i++) {
      const p = s.players[i];
      const cols = wide ? 6 : 4;
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Breit: Spalten abwechselnd versetzt, damit sich die Namensschilder nicht überlappen
      const x = wide ? 178 + col * 52 : 196 + col * 74 + (row % 2) * 18;
      const y = wide ? 112 + row * 84 + (col % 2) * 16 : 120 + row * 88;
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
      // Offline: grau + Hinweis (nach ein paar Minuten fliegt er automatisch raus)
      if (!p.connected) this.playerLayer.add(ink(this, x, y + 19, offMin(p) ? `offline ${offMin(p)}m` : 'offline', { color: RED_INK }));
    }
  }

  private renderLeaderboard(s: GameState) {
    const x = 160, y = 50, w = 306;
    // Bis zu 12 Einträge (Lobby-Maximum); ab 9 enger, damit die Tafel über der Adresse endet
    const rows = s.leaderboard.slice(0, 12);
    const rowH = rows.length > 8 ? 12 : 18;
    this.playerLayer.add(panel(this, x, y, w, 30 + Math.max(1, rows.length) * rowH));
    this.playerLayer.add(ink(this, x + w / 2, y + 9, 'ARCADE-LEADERBOARD', { color: RED_INK }));
    this.playerLayer.add(ink(this, x + w - 70, y + 20, 'Pkt', { color: '#7a5a3a' }));
    this.playerLayer.add(ink(this, x + w - 30, y + 20, 'Siege', { color: '#7a5a3a' }));
    if (!rows.length) this.playerLayer.add(ink(this, x + w / 2, y + 32, 'Noch keine Punkte – los geht’s!'));
    rows.forEach((e, i) => {
      const ry = y + 32 + i * rowH;
      const p = s.players.find((pl) => pl.name === e.name && pl.connected);
      this.playerLayer.add(ink(this, x + 14, ry, `${i + 1}.`, { origin: [0, 0], color: i === 0 ? '#c98a10' : INK }));
      if (p) this.playerLayer.add(this.add.image(x + 42, ry + 12, ensurePortrait(this, p.look)).setOrigin(0.5, 1));
      this.playerLayer.add(ink(this, x + 54, ry, e.name.slice(0, 12), { origin: [0, 0], color: p ? INK : '#7a5a3a' }));
      this.playerLayer.add(ink(this, x + w - 70, ry, String(e.points)));
      this.playerLayer.add(ink(this, x + w - 30, ry, String(e.wins)));
    });
  }

  /** Arcade-Abstimmung: meistgewünschtes Spiel in der Fußzeile */
  private voteHint(s: GameState) {
    const counts = new Map<MiniKind, number>();
    for (const k of Object.values(s.arcadeVote?.votes ?? {})) counts.set(k, (counts.get(k) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!top) return 'Alle wählen am Handy – tippt euer Wunschspiel!';
    const title = MINI_INFO[top[0]].title;
    // Fußzeile fasst ~38 Zeichen
    return `Wunsch: ${MINI_INFO[top[0]].icon} ${title.length > 21 ? `${title.slice(0, 20)}…` : title} (${top[1]})`;
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
    // Lange Adressen (Online-Tunnel: …trycloudflare.com) auf zwei Zeilen, der Hinweis rutscht darunter
    const lines = fitLines(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), URL_CHARS);
    const two = lines.length > 1;
    this.urlPanel.setVisible(!two);
    this.urlPanelTall.setVisible(two);
    this.urlText.setText(lines.join('\n')).setY(two ? 231 : 240);
    this.hintText.setY(two ? 255 : 252);

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
