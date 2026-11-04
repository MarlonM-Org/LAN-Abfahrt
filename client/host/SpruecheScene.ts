import Phaser from 'phaser';
import type { GameState, SpruecheState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { SPRUECHE } from '../../shared/sprueche';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSky, paintWoodFloor } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, ink, nameTag, panel, prop, txt } from './ui';

const SOFT = '#7a5a3a';
const LIGHTS = [0xe04a3f, 0xf2c33a, 0x46b04a, 0x3f8fe0, 0xe46e98];

/** Sprüche-Duell: Bühne an der Strandbar bei Nacht */
export class SpruecheScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private stateKey = '';
  private timerY = 0;

  constructor() {
    super('sprueche');
  }

  create() {
    this.timerKey = '';
    this.stateKey = '';
    this.timerY = 0;
    background(this, 'sprueche', WORLD.W, WORLD.H, (p) => {
      paintSky(p, 0, 0, WORLD.W, 150, ['#141a3d', '#26305f', '#4b3f7a', '#8a4f7a']);
      for (let i = 0; i < 40; i++) p.px((i * 97) % WORLD.W, (i * 53) % 90, i % 3 ? '#cfd6ff' : C.white);
      // Meer am Horizont
      p.rect(0, 132, WORLD.W, 22, '#2b3f78');
      for (let x = 0; x < WORLD.W; x += 9) p.hline(x, 136 + ((x / 9) % 3) * 5, 4, '#4b62a0');
      // Bühne (Holzboden + Kante)
      paintWoodFloor(p, 0, 154, WORLD.W, WORLD.H - 154, 53);
      p.rect(0, 152, WORLD.W, 4, C.woodDarker);
      p.hline(0, 152, WORLD.W, C.woodLight);
      // Vorhang links/rechts
      for (const x0 of [0, WORLD.W - 18]) {
        p.rect(x0, 0, 18, 154, '#8e2b2b');
        for (let x = x0 + 2; x < x0 + 18; x += 5) p.vline(x, 0, 154, '#6e1f22');
      }
      p.rect(0, 0, WORLD.W, 5, '#6e1f22');
    });
    // Lichterkette
    for (let i = 0; i < 24; i++) {
      const x = 24 + i * 19;
      const y = 9 + Math.round(Math.sin(i * 0.9) * 2);
      const bulb = this.add.rectangle(x, y, 3, 4, LIGHTS[i % LIGHTS.length]).setDepth(-900);
      this.tweens.add({ targets: bulb, alpha: 0.35, duration: 500 + (i % 4) * 160, yoyo: true, repeat: -1 });
    }
    prop(this, 'sq_palmL', () => O.palm(3), 30, 160).setDepth(-800);
    prop(this, 'sq_palmR', () => O.palm(8), 450, 160).setDepth(-800).setFlipX(true);
    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.layer.removeAll(true);
    });
    const s = getState();
    if (s) this.render(s);
  }

  update() {
    this.timerBar.clear();
    const frac = this.countdown.remaining / this.total;
    if (frac <= 0 || !this.timerY) return;
    this.timerBar.fillStyle(0x2d1b12).fillRect(99, this.timerY - 1, 282, 6);
    this.timerBar.fillStyle(frac < 0.2 ? 0xe04a3f : 0xf0b13a).fillRect(100, this.timerY, 280 * frac, 4);
  }

  private render(s: GameState) {
    if (s.mini?.kind !== 'sprueche') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}-${st.match}`;
    if (tKey !== this.timerKey) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
    }
    const key = JSON.stringify([tKey, st.answered, st.voted, st.duel?.votes, st.finalAnswers?.map((a) => a.votes), s.players.map((p) => p.connected)]);
    if (key === this.stateKey) return;
    const prevSub = this.stateKey ? (JSON.parse(this.stateKey) as string[])[0] : '';
    this.stateKey = key;
    const fresh = prevSub !== tKey;

    this.layer.removeAll(true);
    this.timerY = 0;
    if (st.sub === 'intro') this.renderIntro(st, fresh);
    else if (st.sub === 'answer') this.renderAnswer(s, st);
    else if ((st.sub === 'vote' || st.sub === 'reveal') && st.final) this.renderFinal(st, fresh);
    else if (st.sub === 'vote' || st.sub === 'reveal') this.renderDuel(st, fresh);
    else if (st.sub === 'scores') this.renderScores(st);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Das war das Sprüche-Duell!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Auswertung ...'));
    }
  }

  private roundLabel(st: SpruecheState) {
    return st.final ? 'FINALE' : `Runde ${st.round}/${st.rounds}`;
  }

  // ---------------------------------------------------------------- Intro + Antworten

  private renderIntro(st: SpruecheState, fresh: boolean) {
    this.layer.add(panel(this, 80, 46, 320, 124));
    this.layer.add(ink(this, WORLD.W / 2, 58, 'SPRÜCHE-DUELL', { color: RED_INK }));
    const big = ink(this, WORLD.W / 2, 82, st.final ? 'FINALE!' : `RUNDE ${st.round}`, { size: 24 });
    this.layer.add(big);
    this.layer.add(ink(this, WORLD.W / 2, 114, `Punkte ×${st.multiplier}`, { size: 16, color: '#b9770e' }));
    const desc = st.final ? 'Alle beantworten dieselbe Frage – jeder hat 3 Stimmen!' : 'Jeder bekommt 2 Fragen, jede Frage hat 2 Autoren.';
    this.layer.add(ink(this, WORLD.W / 2, 140, desc, { wrap: 290 }));
    if (fresh) {
      big.setScale(0.2);
      this.tweens.add({ targets: big, scale: 1, duration: 420, ease: 'Back.Out' });
    }
  }

  private renderAnswer(s: GameState, st: SpruecheState) {
    this.layer.add(panel(this, 50, 22, 380, 62));
    this.layer.add(ink(this, WORLD.W / 2, 30, `Sprüche-Duell · ${this.roundLabel(st)} · Punkte ×${st.multiplier}`, { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 46, st.final ? 'Alle: dieselbe Frage!' : 'Antworten tippen!', { size: 16 }));
    this.timerY = 70;
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p) => !!p);
    const n = players.length;
    const rows = n > 8 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const spacing = Math.min(58, 420 / perRow);
    let doneCount = 0;
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = WORLD.W / 2 + ((i % perRow) - (inRow - 1) / 2) * spacing;
      const y = rows === 1 ? 214 : 176 + row * 64;
      const got = st.answered[p.id] ?? 0;
      const done = got >= st.need;
      if (done) doneCount++;
      const f = figure(this, p.look, x, y, 2);
      if (!done) f.setAlpha(p.connected ? 0.65 : 0.3);
      this.layer.add(f);
      this.layer.add(nameTag(this, x, y + 3, p.name.slice(0, Math.max(4, Math.floor(spacing / 8) - 1)), done ? GREEN_INK : INK));
      const bubbleY = y - 64;
      if (done) {
        const c = this.add.image(x, bubbleY, ensureTex(this, 'sq_check', checkIcon)).setScale(2);
        this.layer.add(c);
      } else if (p.connected) {
        const label = st.need > 1 ? `${got}/${st.need}` : '...';
        const b = ink(this, x, bubbleY - 6, label).setBackgroundColor('#fff6dc').setPadding(3, 2, 3, 2);
        this.layer.add(b);
        this.tweens.add({ targets: b, y: bubbleY - 9, duration: 500 + (i % 3) * 90, yoyo: true, repeat: -1 });
      }
    });
    this.layer.add(ink(this, WORLD.W / 2, 258, `${doneCount}/${n} fertig · Antworten am Handy tippen`).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  // ---------------------------------------------------------------- Duell

  private promptPanel(st: SpruecheState, label: string) {
    this.layer.add(panel(this, 16, 14, 448, 58));
    this.layer.add(ink(this, WORLD.W / 2, 21, label, { color: RED_INK }));
    const text = st.prompt.replace(/_{2,}/g, '_____');
    const size = text.length <= 26 ? 16 : 8;
    this.layer.add(ink(this, WORLD.W / 2, 50, text, { size, wrap: 428 }).setOrigin(0.5, 0.5));
  }

  private renderDuel(st: SpruecheState, fresh: boolean) {
    const duel = st.duel;
    if (!duel) return;
    const reveal = st.sub === 'reveal' && !!duel.authors;
    this.promptPanel(st, `${this.roundLabel(st)} · Duell ${st.match + 1}/${st.matches} · Punkte ×${st.multiplier}`);
    const cw = 184;
    const ch = 92;
    const top = 84;
    const total = (duel.votes?.[0] ?? 0) + (duel.votes?.[1] ?? 0);
    const winner = reveal && total ? ((duel.votes![0] > duel.votes![1] ? 0 : duel.votes![1] > duel.votes![0] ? 1 : -1) as number) : -1;
    [0, 1].forEach((k) => {
      const cx = k === 0 ? 120 : 360;
      const card = this.add.container(cx, top + ch / 2);
      card.add(panel(this, -cw / 2, -ch / 2, cw, ch));
      card.add(fitText(this, duel.answers[k], cw - 20, ch - 20));
      this.layer.add(card);
      if (!reveal) {
        if (fresh) {
          card.setScale(0.3);
          this.tweens.add({ targets: card, scale: 1, duration: 300, delay: k * 350, ease: 'Back.Out' });
        }
        return;
      }
      const votes = duel.votes![k];
      const pct = total ? Math.round((votes / total) * 100) : 0;
      const author = playerById(duel.authors![k]);
      // Autor unter der Karte
      const fx = cx - 52;
      if (author) {
        const f = figure(this, author.look, fx, 238, 2);
        this.layer.add(f);
        this.layer.add(nameTag(this, fx, 241, author.name.slice(0, 10), k === winner ? RED_INK : INK));
        if (k === winner) this.tweens.add({ targets: f.getData('img'), y: -5, duration: 260, yoyo: true, repeat: -1 });
      }
      const info = this.add.container(cx + 28, 192);
      info.add(this.add.rectangle(0, 0, 112, 46, 0x2d1b12, 0.8).setStrokeStyle(2, 0x5e3518));
      info.add(txt(this, 0, -17, `${votes} Stimme${votes === 1 ? '' : 'n'}`, {}));
      info.add(txt(this, 0, -5, total ? `${pct} %` : '–', { size: 8, color: '#cfd6ff' }));
      info.add(txt(this, 0, 7, `+${duel.gained?.[k] ?? 0}`, { size: 8, color: GOLD }));
      this.layer.add(info);
      // Wer hat dafür gestimmt?
      const voters = (duel.voters?.[k] ?? []).map((id) => playerById(id)).filter((p) => !!p);
      voters.slice(0, 6).forEach((p, i) => {
        const img = this.add.image(cx + 28 - (Math.min(6, voters.length) - 1) * 9 + i * 18, 228, ensurePortrait(this, p.look)).setScale(1);
        this.layer.add(img);
      });
      if (k === winner) {
        const crown = this.add.image(cx - cw / 2 + 10, top + 2, ensureTex(this, 'crown', O.crown)).setScale(2);
        this.layer.add(crown);
        this.tweens.add({ targets: crown, y: '-=3', duration: 300, yoyo: true, repeat: -1 });
      }
      if (fresh) {
        info.setScale(0.2);
        this.tweens.add({ targets: info, scale: 1, duration: 300, delay: 200 + k * 250, ease: 'Back.Out' });
      }
    });
    const vs = txt(this, 240, top + ch / 2, 'VS', { size: 16, color: GOLD, origin: [0.5, 0.5] });
    this.layer.add(vs);
    if (!reveal) {
      this.timerY = 78;
      this.layer.add(
        ink(this, WORLD.W / 2, 196, st.voters.length ? `Stimmt am Handy ab! (${st.voted.length}/${st.voters.length})` : 'Keiner kann abstimmen ...', { size: 8 })
          .setBackgroundColor('#f7e4b5')
          .setPadding(4, 3, 4, 3),
      );
      this.layer.add(ink(this, WORLD.W / 2, 216, 'Wer was geschrieben hat, bleibt bis zur Auflösung geheim.', { color: '#f7e4b5' }));
      this.tweens.add({ targets: vs, scale: 1.15, duration: 450, yoyo: true, repeat: -1 });
      return;
    }
    if (!total) this.layer.add(ink(this, WORLD.W / 2, 186, 'Keine Stimmen!').setBackgroundColor('#f7e4b5').setPadding(3, 2, 3, 2));
    if (duel.sweep !== null) {
      const cx = duel.sweep === 0 ? 120 : 360;
      const banner = this.add.container(cx, top + ch - 4).setAngle(-8);
      banner.add(this.add.rectangle(0, 0, 150, 24, 0xa8342a).setStrokeStyle(2, 0xffd25e));
      banner.add(txt(this, 0, 0, 'ABRÄUMER!', { size: 16, color: GOLD, origin: [0.5, 0.5] }));
      this.layer.add(banner);
      banner.setScale(0);
      this.tweens.add({ targets: banner, scale: 1, duration: 380, delay: fresh ? 700 : 0, ease: 'Back.Out' });
      this.tweens.add({ targets: banner, angle: 8, duration: 520, yoyo: true, repeat: -1, delay: 1100 });
    }
  }

  // ---------------------------------------------------------------- Finale

  private renderFinal(st: SpruecheState, fresh: boolean) {
    const answers = st.finalAnswers ?? [];
    const reveal = st.sub === 'reveal';
    this.promptPanel(st, `FINALE · Punkte ×${st.multiplier} pro Stimme`);
    const n = answers.length;
    if (!n) {
      this.layer.add(panel(this, 120, 120, 240, 40));
      this.layer.add(ink(this, WORLD.W / 2, 136, 'Keiner hat geantwortet?!'));
      return;
    }
    const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const gap = 6;
    const areaTop = reveal ? 80 : 84;
    const areaH = (reveal ? 266 : 238) - areaTop;
    const cw = Math.floor((452 - (cols - 1) * gap) / cols / 2) * 2;
    const ch = Math.floor(Math.min(72, (areaH - (rows - 1) * gap) / rows) / 2) * 2;
    const max = reveal ? Math.max(0, ...answers.map((a) => a.votes ?? 0)) : 0;
    answers.forEach((a, i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      const col = i % cols;
      const cx = WORLD.W / 2 + (col - (inRow - 1) / 2) * (cw + gap);
      const cy = areaTop + row * (ch + gap) + ch / 2;
      const card = this.add.container(cx, cy);
      card.add(panel(this, -cw / 2, -ch / 2, cw, ch));
      card.add(ink(this, -cw / 2 + 7, -ch / 2 + 5, String(i + 1), { color: SOFT, origin: [0, 0] }));
      const textH = reveal ? ch - 30 : ch - 14;
      card.add(fitText(this, a.text, cw - 26, textH, reveal ? -6 : 0));
      if (reveal && a.by) {
        const who = playerById(a.by);
        const votes = a.votes ?? 0;
        const color = votes && votes === max ? RED_INK : SOFT;
        const score = `${votes}× +${a.gained ?? 0}`;
        const room = Math.max(3, Math.floor((cw - 18 - score.length * 8) / 8) - 1);
        card.add(ink(this, -cw / 2 + 8, ch / 2 - 15, (who?.name ?? '?').slice(0, room), { color, origin: [0, 0] }));
        card.add(ink(this, cw / 2 - 8, ch / 2 - 15, score, { color, origin: [1, 0] }));
        if (votes && votes === max) {
          const crown = this.add.image(-cw / 2 + 8, -ch / 2 + 2, ensureTex(this, 'crown', O.crown)).setScale(1.5);
          card.add(crown);
          this.tweens.add({ targets: crown, y: '-=3', duration: 300, yoyo: true, repeat: -1 });
        }
      }
      this.layer.add(card);
      if (fresh) {
        card.setScale(0.3);
        this.tweens.add({ targets: card, scale: 1, duration: 260, delay: i * 90, ease: 'Back.Out' });
      }
    });
    if (!reveal) {
      this.timerY = 78;
      this.layer.add(
        ink(this, WORLD.W / 2, 248, `Bis zu ${SPRUECHE.FINAL_PICKS} Stimmen am Handy verteilen! (${st.voted.length}/${st.voters.length} fertig)`)
          .setBackgroundColor('#f7e4b5')
          .setPadding(4, 3, 4, 3),
      );
    }
  }

  // ---------------------------------------------------------------- Zwischenstand

  private renderScores(st: SpruecheState) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0));
    const rowH = ranked.length > 8 ? 15 : 18;
    const h = 44 + ranked.length * rowH;
    const top = Math.round((WORLD.H - h) / 2);
    this.layer.add(panel(this, 110, top, 260, h + (h % 2)));
    this.layer.add(ink(this, WORLD.W / 2, top + 10, st.final ? 'Endstand' : `Zwischenstand nach Runde ${st.round}`, { color: RED_INK }));
    let place = 0;
    let prev = -1;
    ranked.forEach((id, i) => {
      const pts = st.points[id] ?? 0;
      if (pts !== prev) place = i + 1;
      prev = pts;
      const y = top + 30 + i * rowH;
      const p = playerById(id);
      this.layer.add(ink(this, 126, y, `${place}.`, { origin: [0, 0], color: place === 1 ? RED_INK : INK }));
      if (p) this.layer.add(this.add.image(156, y + 3, ensurePortrait(this, p.look)));
      this.layer.add(ink(this, 170, y, (p?.name ?? '?').slice(0, 10), { origin: [0, 0] }));
      this.layer.add(ink(this, 312, y, String(pts), { origin: [1, 0] }));
      const gain = st.roundGain[id] ?? 0;
      if (gain) {
        const g = ink(this, 356, y, `+${gain}`, { origin: [1, 0], color: GREEN_INK });
        this.layer.add(g);
        g.setAlpha(0);
        this.tweens.add({ targets: g, alpha: 1, duration: 300, delay: 300 + i * 120 });
      }
    });
  }
}

/** Text so groß wie möglich (16 px oder 8 px), mittig in einer Box */
function fitText(scene: Phaser.Scene, text: string, w: number, h: number, dy = 0) {
  let t = ink(scene, 0, dy, text, { size: 16, wrap: w }).setOrigin(0.5, 0.5);
  if (t.width > w + 2 || t.height > h) {
    t.destroy();
    t = ink(scene, 0, dy, text, { size: 8, wrap: w }).setOrigin(0.5, 0.5);
  }
  return t;
}

function checkIcon() {
  const p = new Pix(11, 10);
  p.map(1, 1, ['.......gg', '......gg.', '.....gg..', 'gg..gg...', '.gggg....', '..gg.....'], { g: C.green });
  p.outline(C.outline);
  return p;
}
