import Phaser from 'phaser';
import QRCode from 'qrcode';
import type { GameMode, GameState, MiniKind } from '../../shared/types';
import { ARCADE_KINDS, MINI_INFO } from '../../shared/games';
import { WORLD } from '../../shared/flunky';
import * as O from '../art/objects';
import { CABINET_ACCENTS, CABINET_H, CABINET_SCREEN, CABINET_W, HALL, HALL_FLOOR_Y, cabinet, marquee, neonPanel, paintHall, qrKiosk } from '../art/arcadeHall';
import { bus, getState, joinUrlOf } from './store';
import { figure } from './textures';
import { GOLD, LIGHT, RED_INK, background, ensureTex, fitText, ink, nameTag, txt } from './ui';
import { drawSessionBoard } from './sessionBoard';

/** Bis 8 Spieler: 2 Reihen à 4; ab 9 Spielern: 2 Reihen à 6 im Zickzack (Platz für 12) */
const SLOTS = 8;
const SLOTS_MAX = 12;

/** Punkte unter den Namen: Spitzenreiter golden */
const GOLD_INK = '#ffd25e';
const SOFT = '#9ad6ff';

/** So viele Zeichen (8 px, Festbreite) passen auf das Laufband unten (316 px breit) */
const URL_CHARS = 38;

/** Automaten an der Rückwand: Mitten (x), Unterkante steht auf der Bodenlinie */
const CABINET_X = [172, 226, 280, 334, 388, 442];
const CABINET_BOTTOM = HALL_FLOOR_Y + 6;
/** Alle paar Sekunden wandert das Rampenlicht zum nächsten Automaten, der dann ein neues Spiel zeigt */
const SPOT_MS = 3200;

const MODE_TITLE: Record<GameMode, string> = { arcade: '~ ARCADE ~', party: '~ PARTY ~', turnier: '~ TURNIER ~', drink: '~ TRINKSPIEL ~', date: '~ STORY ~' };
const MODE_COLOR: Record<GameMode, string> = { arcade: HALL.neonCyan, party: HALL.neonGreen, turnier: HALL.neonYellow, drink: '#ff9a4a', date: HALL.neonPink };

/** Adresse in höchstens zwei Zeilen à `max` Zeichen – umbrechen vor „.“ oder nach „-“/„:“, notfalls hart */
function fitLines(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  let cut = -1;
  for (let i = 1; i <= max; i++) if (text[i] === '.' || text[i - 1] === '-' || text[i - 1] === ':') cut = i;
  if (cut < 8) cut = max;
  const rest = text.slice(cut);
  return [text.slice(0, cut), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Cabinet {
  x: number;
  kind: MiniKind;
  icon: Phaser.GameObjects.Text;
  glow: Phaser.GameObjects.Ellipse;
  screenLight: Phaser.GameObjects.Rectangle;
}

/**
 * Startseite als Arcade-Halle: Neon-Schild, Automaten an der Rückwand, deren Bildschirme durch die
 * Minispiele blättern (getestete zuerst), die anwesenden Spieler stehen davor; QR-Automat links,
 * Adresse auf dem Laufband unten.
 */
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
  private cabinets: Cabinet[] = [];
  private spot = -1;
  private spotLabel!: Phaser.GameObjects.Container;
  private spotLabelBg!: Phaser.GameObjects.Image;
  private spotLabelText!: Phaser.GameObjects.Text;
  /** Reihenfolge, in der die Automaten die Spiele zeigen (getestete zuerst) */
  private pool: MiniKind[] = [];
  private poolAt = 0;
  private poolKey = '';

  constructor() {
    super('lobby');
  }

  create() {
    // Szenen-Instanzen werden beim Neustart wiederverwendet → Zustand zurücksetzen
    this.renderedUrl = '';
    this.renderedPlayers = '';
    this.cabinets = [];
    this.spot = -1;
    this.pool = [];
    this.poolAt = 0;
    this.poolKey = '';

    background(this, 'hall', WORLD.W, WORLD.H, (p) => paintHall(p, WORLD.W, WORLD.H));

    // Automaten an der Rückwand – Bildschirm bekommt ein Spiel-Icon, Lichtschein auf den Boden
    const s0 = getState();
    this.refillPool(s0);
    CABINET_X.forEach((x, i) => {
      const accent = CABINET_ACCENTS[i % CABINET_ACCENTS.length];
      const key = ensureTex(this, `cabinet_${i % CABINET_ACCENTS.length}`, () => cabinet(accent, i + 1));
      this.add.image(x, CABINET_BOTTOM, key).setOrigin(0.5, 1).setDepth(CABINET_BOTTOM);
      const top = CABINET_BOTTOM - 4 - CABINET_H;
      const sx = x - CABINET_W / 2 + CABINET_SCREEN.x + CABINET_SCREEN.w / 2;
      const sy = top + CABINET_SCREEN.y + CABINET_SCREEN.h / 2;
      const screenLight = this.add.rectangle(sx, sy, CABINET_SCREEN.w, CABINET_SCREEN.h, Phaser.Display.Color.HexStringToColor(accent).color, 0.16).setDepth(CABINET_BOTTOM + 1);
      const icon = txt(this, sx, sy + 1, '', { size: 16, origin: [0.5, 0.5], shadow: false }).setScale(0.8).setDepth(CABINET_BOTTOM + 2);
      const glow = this.add.ellipse(x, CABINET_BOTTOM + 3, 44, 9, Phaser.Display.Color.HexStringToColor(accent).color, 0.14).setDepth(CABINET_BOTTOM - 1);
      this.tweens.add({ targets: screenLight, alpha: 0.3, duration: 900 + i * 130, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      const cab: Cabinet = { x, kind: this.nextKind(), icon, glow, screenLight };
      icon.setText(MINI_INFO[cab.kind].icon);
      this.cabinets.push(cab);
    });

    // Rampenlicht: Schild mit dem Titel des gerade leuchtenden Automaten
    this.spotLabelBg = this.add.image(0, 0, ensureTex(this, 'neon_label_8', () => neonPanel(8, 14))).setOrigin(0.5, 0);
    this.spotLabelText = txt(this, 0, 3, '', { color: LIGHT, shadow: false });
    this.spotLabel = this.add.container(0, 38, [this.spotLabelBg, this.spotLabelText]).setDepth(400).setAlpha(0);
    this.time.addEvent({ delay: SPOT_MS, loop: true, callback: () => this.advanceSpot() });
    this.advanceSpot();

    // Neon-Schild mit Lauflicht
    const mqA = this.add.image(150, 0, ensureTex(this, 'marquee_a', () => marquee(220, 36, 0))).setOrigin(0, 0).setDepth(500);
    const mqB = this.add.image(150, 0, ensureTex(this, 'marquee_b', () => marquee(220, 36, 1))).setOrigin(0, 0).setDepth(500).setVisible(false);
    this.time.addEvent({ delay: 420, loop: true, callback: () => (mqA.setVisible(!mqA.visible), mqB.setVisible(!mqA.visible)) });
    const glowTitle = txt(this, 260, 7, 'LAN-ABFAHRT', { size: 16, color: GOLD, shadow: false }).setDepth(501).setAlpha(0.45);
    glowTitle.setStroke(HALL.neonPink, 4);
    this.tweens.add({ targets: glowTitle, alpha: 0.85, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    txt(this, 260, 7, 'LAN-ABFAHRT', { size: 16, color: GOLD }).setDepth(502);
    this.subtitle = txt(this, 260, 25, MODE_TITLE.arcade, { color: HALL.neonCyan, shadow: false }).setDepth(502);

    // QR-Code auf einem Automaten
    this.add.image(10, 104, ensureTex(this, 'qrkiosk', () => qrKiosk(124, 122))).setOrigin(0, 0).setDepth(240);
    this.qrLayer = this.add.container(0, 0).setDepth(241);

    this.playerLayer = this.add.container(0, 0).setDepth(300);

    this.urlPanel = this.add.image(150, 232, ensureTex(this, 'neon_panel_316_36', () => neonPanel(316, 36))).setOrigin(0, 0).setDepth(500);
    // Höheres Laufband für Adressen auf zwei Zeilen (TV bei Freunden über den Online-Tunnel)
    this.urlPanelTall = this.add.image(150, 225, ensureTex(this, 'neon_panel_316_43', () => neonPanel(316, 43))).setOrigin(0, 0).setDepth(500).setVisible(false);
    this.urlText = txt(this, 308, 240, '', { color: LIGHT, shadow: false }).setDepth(501);
    this.hintText = txt(this, 308, 252, '', { color: HALL.neonCyan, shadow: false }).setDepth(501);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.off('state', onState));

    const s = getState();
    if (s) this.render(s);
  }

  /** Spiele-Reihenfolge für die Automaten: getestete (Feedback von Marlon) zuerst, dann der Rest – beides gemischt */
  private refillPool(s: GameState | null) {
    const reviewed = new Set(s?.reviewed ?? []);
    const key = [...reviewed].sort().join(',');
    if (key === this.poolKey && this.pool.length) return;
    this.poolKey = key;
    const tested = shuffle(ARCADE_KINDS.filter((k) => reviewed.has(k)));
    const rest = shuffle(ARCADE_KINDS.filter((k) => !reviewed.has(k)));
    this.pool = [...tested, ...rest];
    this.poolAt = 0;
  }

  /** Nächstes Spiel aus dem Pool, das gerade auf keinem Automaten läuft */
  private nextKind(): MiniKind {
    const shown = new Set(this.cabinets.map((c) => c.kind));
    for (let i = 0; i < this.pool.length; i++) {
      const k = this.pool[(this.poolAt + i) % this.pool.length];
      if (!shown.has(k)) {
        this.poolAt = (this.poolAt + i + 1) % this.pool.length;
        return k;
      }
    }
    return this.pool[0] ?? 'kart';
  }

  /** Rampenlicht zum nächsten Automaten: der blättert (mit Flackern) zu einem neuen Spiel, Schild zeigt den Titel */
  private advanceSpot() {
    if (!this.cabinets.length) return;
    const prev = this.cabinets[this.spot];
    if (prev) this.tweens.add({ targets: prev.glow, alpha: 0.14, scaleX: 1, duration: 300 });
    this.spot = (this.spot + 1) % this.cabinets.length;
    const cab = this.cabinets[this.spot];
    cab.kind = this.nextKind();
    const info = MINI_INFO[cab.kind];
    // Flackern: altes Icon aus, neues rein
    this.tweens.add({ targets: cab.icon, alpha: 0, duration: 90, yoyo: true, repeat: 1, onYoyo: () => cab.icon.setText(info.icon) });
    this.tweens.add({ targets: cab.glow, alpha: 0.42, scaleX: 1.5, duration: 350 });
    this.tweens.add({ targets: cab.icon, scale: 1, duration: 260, yoyo: true, ease: 'Back.Out', onComplete: () => cab.icon.setScale(0.8) });

    // Titel-Schild über dem Automaten (innerhalb des Bildes halten)
    const title = info.title.length > 24 ? `${info.title.slice(0, 23)}…` : info.title;
    this.spotLabelText.setText(title);
    const w = Math.max(40, title.length * 8 + 10);
    this.spotLabelBg.setTexture(ensureTex(this, `neon_label_${w}`, () => neonPanel(w, 14)));
    fitText(this.spotLabelText, w - 6);
    const x = Phaser.Math.Clamp(cab.x, 150 + w / 2, WORLD.W - 4 - w / 2);
    this.spotLabel.setAlpha(0);
    this.spotLabel.setX(x);
    this.tweens.add({ targets: this.spotLabel, alpha: 1, duration: 220, delay: 120 });
  }

  private render(s: GameState) {
    const url = joinUrlOf(s);
    if (url !== this.renderedUrl) this.renderQr(url);
    this.refillPool(s);

    this.subtitle.setText(MODE_TITLE[s.mode] ?? MODE_TITLE.arcade).setColor(MODE_COLOR[s.mode] ?? HALL.neonCyan);
    const n = s.players.filter((p) => p.connected && !p.removed).length;
    const offMin = (p: GameState['players'][number]) => Math.floor((p.offlineMs ?? 0) / 60_000);
    this.hintText.setText(
      s.showBoard ? 'Leaderboard des Abends (L / VIP-Handy)' : n < 2 ? 'Scannt den QR-Code – mind. 2 Spieler!' : s.mode === 'arcade' && s.arcadeVote ? this.voteHint(s) : s.mode === 'turnier' ? 'Der VIP wählt am Handy eine Playlist!' : 'Der VIP wählt am Handy ein Spiel!',
    );

    // Startseite = die Spieler, die gerade da sind. Das Leaderboard des Abends (nur Anwesende) gibt es auf Wunsch
    // (L / VIP-Handy); in Arcade/Turnier stehen die Punkte von heute klein unter den Namen.
    const players = s.players.filter((p) => !p.removed);
    const scored = (s.mode === 'arcade' || s.mode === 'turnier') && s.session.rows.some((r) => r.points > 0);
    const scores = scored ? new Map(s.session.rows.map((r) => [r.id, r])) : null;
    const key =
      s.mode +
      players.map((p) => `${p.id}${p.connected}${p.isVip}${p.name}${JSON.stringify(p.look)}${p.connected ? '' : offMin(p)}`).join('|') +
      (s.showBoard ? `S${JSON.stringify(s.session)}` : scores ? `P${s.session.rows.map((r) => `${r.id}:${r.rank}:${r.points}`).join('|')}` : '');
    if (key === this.renderedPlayers) return;
    this.renderedPlayers = key;

    this.playerLayer.removeAll(true);
    if (s.showBoard) {
      drawSessionBoard(this, this.playerLayer, s.session, { x: 150, y: 42, w: 316, maxBottom: 228 }, { title: s.session.games ? undefined : 'LEADERBOARD HEUTE · NOCH LEER' });
      return;
    }
    const wide = players.length > SLOTS;
    for (let i = 0; i < (wide ? SLOTS_MAX : SLOTS); i++) {
      const p = players[i];
      const cols = wide ? 6 : 4;
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Breit: Spalten abwechselnd versetzt, damit sich die Namensschilder nicht überlappen.
      // Vordere Reihe so hoch, dass „offline“/Punkte unter dem Namen noch über dem Laufband stehen.
      const x = wide ? 178 + col * 52 : 196 + col * 74 + (row % 2) * 18;
      const y = wide ? 114 + row * 80 + (col % 2) * 14 : 136 + row * 74;
      if (!p) {
        // Leerer Platz: Lichtfleck auf dem Teppich
        const ghost = this.add.ellipse(x, y - 2, 22, 7, 0xffffff, 0.06);
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
      if (!p.connected) this.playerLayer.add(txt(this, x, y + 19, offMin(p) ? `offline ${offMin(p)}m` : 'offline', { color: '#ff8aa8' }));
      else if (scores) {
        const r = scores.get(p.id);
        const lead = r?.rank === 1 && r.points > 0;
        this.playerLayer.add(txt(this, x, y + 19, `${r?.points ?? 0} Pkt`, { color: lead ? GOLD_INK : SOFT }));
      }
    }
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
    g.fillStyle(Phaser.Display.Color.HexStringToColor(HALL.outline).color);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) g.fillRect(ox + (x + 1) * cell, oy + (y + 1) * cell, cell, cell);
      }
    }
    this.qrLayer.add(g);
  }
}
