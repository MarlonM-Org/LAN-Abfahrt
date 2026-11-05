import Phaser from 'phaser';
import type { GameState, PlayerPublic, WerwarsState } from '../../shared/types';
import { WORLD } from '../../shared/flunky';
import { WERWARS } from '../../shared/werwars';
import { C } from '../art/palette';
import * as O from '../art/objects';
import { paintSky, paintWoodFloor } from '../art/ground';
import { Pix } from '../art/pix';
import { bus, getState, playerById } from './store';
import { ensurePortrait, figure } from './textures';
import { GOLD, GREEN_INK, INK, RED_INK, Countdown, background, ensureTex, ink, nameTag, panel, prop, tagName, txt } from './ui';
import { Juice } from './juice';
import { sfx } from './sfx';
import { say, spokenName } from './speech';

const LIGHTS = [0xf2c33a, 0xe46e98, 0x7fd4ff, 0xf0973a, 0x9ad65a];
/** Pergament-Tafel für die anonyme Antwort */
const TAFEL = { x: 50, y: 12, w: 380, h: 100 };

/** Wer war's?: Terrasse am Abend, die Antworten erscheinen auf einer Pergament-Tafel */
export class WerwarsScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private timerBar!: Phaser.GameObjects.Graphics;
  private juice!: Juice;
  private countdown = new Countdown();
  private total = 1;
  private timerKey = '';
  private buildKey = '';
  private timerY = 0;
  private sndAnswered = 0;
  private sndVoted = 0;
  private counter: Phaser.GameObjects.Text | null = null;
  private typer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('werwars');
  }

  create() {
    this.timerKey = '';
    this.buildKey = '';
    this.timerY = 0;
    this.sndAnswered = 0;
    this.sndVoted = 0;
    this.counter = null;
    this.typer = null;
    background(this, 'werwars', WORLD.W, WORLD.H, (p) => {
      paintSky(p, 0, 0, WORLD.W, 140, ['#1d2147', '#3a3466', '#7a4a78', '#d9785a']);
      for (let i = 0; i < 30; i++) p.px((i * 89) % WORLD.W, (i * 41) % 70, i % 3 ? '#cfd6ff' : C.white);
      // Meer mit Abendglitzern
      p.rect(0, 128, WORLD.W, 30, '#2d4c86');
      for (let x = 0; x < WORLD.W; x += 7) p.hline(x, 131 + ((x / 7) % 4) * 6, 3, (x / 7) % 3 ? '#4b6aa8' : '#f2b46a');
      // Holzterrasse + Geländer
      paintWoodFloor(p, 0, 158, WORLD.W, WORLD.H - 158, 61);
      p.rect(0, 156, WORLD.W, 3, C.woodDarker);
      p.hline(0, 156, WORLD.W, C.woodLight);
      for (let x = 6; x < WORLD.W; x += 24) p.rect(x, 142, 3, 14, C.woodDark);
      p.rect(0, 140, WORLD.W, 3, C.wood);
      p.hline(0, 140, WORLD.W, C.woodLight);
    });
    // Lichterkette
    for (let i = 0; i < 22; i++) {
      const x = 12 + i * 22;
      const y = 6 + Math.round(Math.abs(Math.sin(i * 0.7)) * 3);
      const bulb = this.add.rectangle(x, y, 3, 4, LIGHTS[i % LIGHTS.length]).setDepth(-900);
      this.tweens.add({ targets: bulb, alpha: 0.4, duration: 600 + (i % 5) * 140, yoyo: true, repeat: -1 });
    }
    prop(this, 'ww_palmL', () => O.palm(4), 18, 158).setDepth(-800);
    prop(this, 'ww_palmR', () => O.palm(9), 462, 158).setDepth(-800).setFlipX(true);
    this.layer = this.add.container(0, 0).setDepth(500);
    this.timerBar = this.add.graphics().setDepth(1000);
    this.juice = new Juice(this, { depth: 1500 });

    const onState = (s: GameState) => this.render(s);
    bus.on('state', onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.off('state', onState);
      this.typer?.remove();
      this.typer = null;
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
    if (s.mini?.kind !== 'werwars') return;
    const st = s.mini.state;
    const tKey = `${st.sub}-${st.round}`;
    const fresh = tKey !== this.timerKey;
    if (fresh) {
      this.timerKey = tKey;
      this.countdown.set(st.endsIn);
      this.total = Math.max(1, st.endsIn);
    }
    this.sounds(st, fresh);
    // Neu aufbauen nur beim Phasenwechsel (Schreibphase: auch bei jedem Fortschritt) – sonst läuft die Schreibmaschine neu an
    const key = JSON.stringify([tKey, st.sub === 'answer' ? [st.answered, s.players.map((p) => p.connected)] : 0]);
    if (key !== this.buildKey) {
      this.buildKey = key;
      this.build(s, st, fresh);
    }
    if (this.counter && st.sub === 'guess') this.counter.setText(`${st.votedCount}/${st.voterCount} getippt · Avatar am Handy antippen`);
  }

  private build(s: GameState, st: WerwarsState, fresh: boolean) {
    this.typer?.remove();
    this.typer = null;
    this.counter = null;
    this.layer.removeAll(true);
    this.timerY = 0;
    if (st.sub === 'intro') this.renderIntro(st, fresh);
    else if (st.sub === 'answer') this.renderAnswer(s, st);
    else if (st.sub === 'guess' || st.sub === 'reveal') this.renderRound(st, fresh);
    else if (st.sub === 'scores') this.renderScores(st, fresh);
    else {
      this.layer.add(panel(this, 120, 100, 240, 50));
      this.layer.add(ink(this, WORLD.W / 2, 112, 'Das war „Wer war’s?“!', { color: RED_INK }));
      this.layer.add(ink(this, WORLD.W / 2, 130, 'Gleich gibt’s die Auswertung ...'));
    }
  }

  /** Tipp-Ton der neuen Antwort, Abstimmungs-Ticks, Auflösung, Endfanfare */
  private sounds(st: WerwarsState, fresh: boolean) {
    const answered = Object.values(st.answered).reduce((a, b) => a + b, 0);
    if (fresh) {
      if (st.sub === 'intro') sfx('select');
      if (st.sub === 'answer') sfx('pop', { pitch: 1.2 });
      if (st.sub === 'guess') {
        sfx('whoosh', { vol: 0.6 });
        say(`${st.question}: ${st.answer}`, { interrupt: true });
      }
      if (st.sub === 'reveal' && st.reveal) {
        sfx('drumroll', { vol: 0.7 });
        const r = st.reveal;
        if (r.bonus === 'hidden') sfx('win', { delay: 0.6 });
        else (sfx('coin', { delay: 0.6 }), r.correct.length && sfx('cheer', { delay: 0.7, vol: 0.7 }));
        const who = spokenName(playerById(r.author)?.name);
        say(r.bonus === 'hidden' ? `Das war ${who}! Und keiner hat's gemerkt.` : `Das war ${who}!`, { interrupt: true });
      }
      if (st.sub === 'scores') sfx('fanfare');
    } else {
      if (st.sub === 'answer' && answered > this.sndAnswered) sfx('tick', { pitch: 1.4, vol: 0.5 });
      if (st.sub === 'guess' && st.votedCount > this.sndVoted) sfx('tick', { pitch: 1 + st.votedCount * 0.05 });
    }
    this.sndAnswered = answered;
    this.sndVoted = st.votedCount;
  }

  // ---------------------------------------------------------------- Intro + Schreiben

  private renderIntro(st: WerwarsState, fresh: boolean) {
    this.layer.add(panel(this, 70, 40, 340, 132));
    this.layer.add(ink(this, WORLD.W / 2, 52, 'Detektiv-Abend auf der Terrasse', { color: RED_INK }));
    const big = ink(this, WORLD.W / 2, 70, 'WER WAR’S?', { size: 24 });
    this.layer.add(big);
    this.layer.add(ink(this, WORLD.W / 2, 104, `Jeder beantwortet ${st.need === 1 ? 'eine persönliche Frage' : `${st.need} persönliche Fragen`} am Handy.`, { wrap: 310 }));
    this.layer.add(ink(this, WORLD.W / 2, 124, 'Dann zeigt der TV jede Antwort anonym – wer hat das geschrieben?', { wrap: 310 }));
    this.layer.add(ink(this, WORLD.W / 2, 152, `Richtig +${WERWARS.POINTS_GUESS} · Keiner errät dich +${WERWARS.POINTS_HIDDEN} · Kaum einer +${WERWARS.POINTS_SNEAKY}`, { color: '#b9770e' }));
    if (fresh) {
      big.setScale(0.2);
      this.tweens.add({ targets: big, scale: 1, duration: 420, ease: 'Back.Out' });
    }
  }

  private renderAnswer(s: GameState, st: WerwarsState) {
    this.layer.add(panel(this, 50, 22, 380, 62));
    this.layer.add(ink(this, WORLD.W / 2, 30, 'Wer war’s? · Fragen nur fürs eigene Handy', { color: RED_INK }));
    this.layer.add(ink(this, WORLD.W / 2, 46, 'Ehrlich antworten!', { size: 16 }));
    this.timerY = 70;
    const players = st.players.map((id) => s.players.find((p) => p.id === id)).filter((p) => !!p);
    let doneCount = 0;
    this.lineup(players, (p, x, y, f, spacing, twoRows) => {
      const got = st.answered[p.id] ?? 0;
      const done = got >= st.need;
      if (done) doneCount++;
      if (!done) f.setAlpha(p.connected ? 0.65 : 0.3);
      this.layer.add(nameTag(this, x, y + 3, p.name, done ? GREEN_INK : INK, spacing - 2));
      const h = f.getData('h') as number;
      const bx = twoRows ? x + 16 : x;
      const bubbleY = twoRows ? y - h + 10 : y - h - 10;
      if (done) this.layer.add(this.add.image(bx, bubbleY, ensureTex(this, 'ww_check', checkIcon)).setScale(twoRows ? 1.5 : 2));
      else if (p.connected) {
        const b = ink(this, bx, bubbleY - 6, st.need > 1 ? `${got}/${st.need}` : '...').setBackgroundColor('#fff6dc').setPadding(3, 2, 3, 2);
        this.layer.add(b);
        this.tweens.add({ targets: b, y: bubbleY - 9, duration: 500 + (x % 3) * 90, yoyo: true, repeat: -1 });
      }
    });
    this.layer.add(ink(this, WORLD.W / 2, 100, `${doneCount}/${players.length} fertig · Kein Einfall? Zufallsantwort!`).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2));
  }

  /** Alle Spieler in einer Reihe (ab 9 in zwei versetzten Reihen) – ruft `each` mit Position und Figur auf */
  private lineup(players: PlayerPublic[], each: (p: PlayerPublic, x: number, y: number, f: Phaser.GameObjects.Container, spacing: number, twoRows: boolean) => void) {
    const n = players.length;
    const rows = n > 8 ? 2 : 1;
    const perRow = Math.ceil(n / rows);
    const scale = rows === 1 ? 2 : 1.5;
    const spacing = Math.min(56, 440 / perRow);
    players.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row === rows - 1 ? n - perRow * (rows - 1) : perRow;
      const x = WORLD.W / 2 + ((i % perRow) - (inRow - 1) / 2) * spacing + (rows === 2 && row === 1 ? spacing / 2 : 0);
      const y = rows === 1 ? 232 : 202 + row * 50;
      const f = figure(this, p.look, x, y, scale);
      f.setData('h', 27 * scale);
      this.layer.add(f);
      each(p, x, y, f, spacing, rows === 2);
    });
  }

  // ---------------------------------------------------------------- Antwort-Tafel: raten + Auflösung

  private renderRound(st: WerwarsState, fresh: boolean) {
    const reveal = st.sub === 'reveal' && !!st.reveal;
    const r = st.reveal;
    // Tafel
    const tafel = this.add.container(TAFEL.x + TAFEL.w / 2, TAFEL.y + TAFEL.h / 2);
    tafel.add(this.add.image(0, 0, ensureTex(this, `ww_tafel_${TAFEL.w}_${TAFEL.h}`, () => parchment(TAFEL.w, TAFEL.h))));
    tafel.add(ink(this, 0, -TAFEL.h / 2 + 10, `Antwort ${st.round}/${st.rounds}`, { color: '#7a5a3a' }));
    const qText = ink(this, 0, -TAFEL.h / 2 + 22, `${st.question}:`, { color: RED_INK, wrap: TAFEL.w - 60 });
    tafel.add(qText);
    // Antwort so groß wie möglich in den Platz unter der Frage
    const answer = `„${st.answer}“`;
    const maxW = TAFEL.w - 56;
    const areaTop = qText.y + qText.height + 6;
    const areaBottom = TAFEL.h / 2 - 8;
    let size: 8 | 16 = 16;
    const probe = ink(this, 0, 0, answer, { size: 16, wrap: maxW });
    if (probe.width > maxW + 2 || probe.height > areaBottom - areaTop) size = 8;
    probe.destroy();
    const full = ink(this, 0, 0, answer, { size, wrap: maxW });
    const top = Math.round((areaTop + areaBottom - full.height) / 2);
    full.destroy();
    const text = ink(this, 0, top, answer, { size, wrap: maxW, origin: [0.5, 0] });
    tafel.add(text);
    this.layer.add(tafel);
    if (fresh && !reveal) {
      tafel.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: tafel, scale: 1, alpha: 1, duration: 320, ease: 'Back.Out' });
      // Schreibmaschine: Buchstabe für Buchstabe, mit leisem Tipp-Ton
      let i = 0;
      text.setText('');
      this.typer = this.time.addEvent({
        delay: Math.max(18, Math.min(45, 1400 / answer.length)),
        repeat: answer.length - 1,
        startAt: -250,
        callback: () => {
          i++;
          text.setText(answer.slice(0, i));
          if (i % 2 === 0 && answer[i - 1] !== ' ') sfx('tick', { pitch: 1.6, vol: 0.25 });
        },
      });
    }

    // Verdächtige
    const players = (getState()?.players ?? []).filter((p) => st.players.includes(p.id));
    const counts = new Map<string, number>();
    if (r) for (const t of Object.values(r.guesses)) counts.set(t, (counts.get(t) ?? 0) + 1);
    let authorPos: { x: number; y: number; h: number } | null = null;
    this.lineup(players, (p, x, y, f, spacing, twoRows) => {
      const h = f.getData('h') as number;
      // Zwei Reihen: Stimmen-Plakette neben den Kopf, sonst verdeckt sie die Reihe davor
      const bx = twoRows ? x + 15 : x;
      const by = twoRows ? y - h + 12 : y - h - 10;
      const isAuthor = reveal && r!.author === p.id;
      if (!reveal) {
        f.setAlpha(p.connected ? 1 : 0.4);
        this.layer.add(nameTag(this, x, y + 3, p.name, INK, spacing - 2));
        const q = txt(this, bx, by - (twoRows ? 4 : 8), '?', { size: twoRows ? 8 : 16, color: GOLD });
        this.layer.add(q);
        this.tweens.add({ targets: q, y: q.y - 3, duration: 420 + (Math.round(x) % 4) * 80, yoyo: true, repeat: -1 });
        return;
      }
      if (isAuthor) {
        authorPos = { x, y, h };
        const glow = this.add.ellipse(x, y - h / 2, spacing + 10, h + 26, 0xffe9a0, 0.35);
        this.layer.addAt(glow, 0);
        this.tweens.add({ targets: glow, alpha: 0.15, duration: 500, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: f.getData('img'), y: -5, duration: 260, yoyo: true, repeat: -1 });
      } else f.setAlpha(0.7);
      this.layer.add(nameTag(this, x, y + 3, p.name, isAuthor ? RED_INK : r!.correct.includes(p.id) ? GREEN_INK : INK, spacing - 2));
      const n = counts.get(p.id) ?? 0;
      if (n) {
        const badge = this.add.container(bx, by);
        badge.add(this.add.rectangle(0, 0, 18, 13, isAuthor ? 0xa8342a : 0x2d1b12, 0.9).setStrokeStyle(1, isAuthor ? 0xffd25e : 0x8d5629));
        badge.add(txt(this, 0, 0, `${n}`, { color: isAuthor ? GOLD : '#fff4d6', origin: [0.5, 0.5] }));
        this.layer.add(badge);
        if (fresh) {
          badge.setScale(0);
          this.tweens.add({ targets: badge, scale: 1, duration: 260, delay: 250, ease: 'Back.Out' });
        }
      }
      const gain = r!.gains[p.id];
      if (gain && fresh) this.time.delayedCall(isAuthor ? 1100 : 800, () => this.juice.float(bx, by - 12, `+${gain}`, 'gold'));
    });

    if (!reveal || !r) {
      this.timerY = TAFEL.y + TAFEL.h + 7;
      this.counter = ink(this, WORLD.W / 2, TAFEL.y + TAFEL.h + 16, `${st.votedCount}/${st.voterCount} getippt · Avatar am Handy antippen`).setBackgroundColor('#f7e4b5').setPadding(4, 3, 4, 3);
      this.layer.add(this.counter);
      return;
    }

    // Auflösung: Autor + Bonus
    const author = playerById(r.author);
    const line = this.add.container(WORLD.W / 2, TAFEL.y + TAFEL.h + 13);
    line.add(this.add.rectangle(0, 0, 300, 24, 0x2d1b12, 0.85).setStrokeStyle(2, 0xffd25e));
    line.add(txt(this, 0, 0, `ES WAR ${tagName(author?.name ?? '?').toUpperCase()}!`, { size: 16, color: GOLD, origin: [0.5, 0.5] }));
    this.layer.add(line);
    const cast = Object.keys(r.guesses).length;
    const sub =
      r.bonus === 'hidden'
        ? `Keiner kam drauf – Pokerface! +${WERWARS.POINTS_HIDDEN}`
        : r.bonus === 'sneaky'
          ? `Nur ${r.correct.length} von ${cast} kamen drauf · Autor +${WERWARS.POINTS_SNEAKY}`
          : cast
            ? `Durchschaut! ${r.correct.length} von ${cast} lagen richtig`
            : 'Keiner hat getippt ...';
    const subT = ink(this, WORLD.W / 2, TAFEL.y + TAFEL.h + 29, sub, { color: r.bonus ? RED_INK : INK }).setBackgroundColor('#f7e4b5').setPadding(4, 2, 4, 2);
    this.layer.add(subT);
    // Wer lag richtig? (Porträts neben dem Satz)
    r.correct.slice(0, 8).forEach((id, i) => {
      const p = playerById(id);
      if (p) this.layer.add(this.add.image(subT.x + subT.width / 2 + 12 + i * 18, subT.y + 6, ensurePortrait(this, p.look)));
    });
    if (fresh) {
      line.setScale(0);
      this.tweens.add({ targets: line, scale: 1, duration: 380, delay: 450, ease: 'Back.Out' });
      subT.setAlpha(0);
      this.tweens.add({ targets: subT, alpha: 1, duration: 300, delay: 800 });
      const pos = authorPos as { x: number; y: number; h: number } | null;
      this.time.delayedCall(550, () => {
        if (pos) this.juice.burst(pos.x, pos.y - pos.h, 'confetti', r.bonus === 'hidden' ? 70 : 40);
        if (r.bonus === 'hidden') (this.juice.flash(0xffe9a0, 160), this.juice.shake(1));
        this.juice.zoomPunch(0.04);
      });
    }
  }

  // ---------------------------------------------------------------- Endstand

  private renderScores(st: WerwarsState, fresh: boolean) {
    const ranked = [...st.players].sort((a, b) => (st.points[b] ?? 0) - (st.points[a] ?? 0));
    const rowH = ranked.length > 8 ? 15 : 18;
    const h = 44 + ranked.length * rowH;
    const top = Math.round((WORLD.H - h) / 2);
    this.layer.add(panel(this, 110, top, 260, h + (h % 2)));
    this.layer.add(ink(this, WORLD.W / 2, top + 10, 'Endstand: Wer kennt wen?', { color: RED_INK }));
    const best = st.points[ranked[0]] ?? 0;
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
      this.layer.add(ink(this, 170, y, tagName(p?.name ?? '?').slice(0, 12), { origin: [0, 0] }));
      const t = ink(this, 352, y, String(pts), { origin: [1, 0] });
      this.layer.add(t);
      if (place === 1 && best > 0) {
        const crown = this.add.image(156, y - 7, ensureTex(this, 'crown', O.crown)).setScale(1);
        this.layer.add(crown);
        this.tweens.add({ targets: crown, y: crown.y - 2, duration: 300, yoyo: true, repeat: -1 });
      }
      if (fresh) {
        t.setAlpha(0);
        this.tweens.add({ targets: t, alpha: 1, duration: 250, delay: 200 + (ranked.length - i) * 90 });
      }
    });
    if (fresh) {
      this.time.delayedCall(400, () => {
        this.juice.burst(130, top + h, 'confetti', 50);
        this.juice.burst(350, top + h, 'confetti', 50);
      });
    }
  }
}

/** Pergament mit gerollten Enden links und rechts */
function parchment(w: number, h: number) {
  const p = new Pix(w, h);
  const roll = 10;
  p.rect(roll - 2, 4, w - 2 * roll + 4, h - 8, '#f3e2b3');
  // leichte Flecken und Linien
  for (let y = 18; y < h - 10; y += 14) p.hline(roll + 8, y, w - 2 * roll - 16, '#ecd7a0');
  for (let i = 0; i < 40; i++) p.px(roll + ((i * 53) % (w - 2 * roll)), 6 + ((i * 31) % (h - 12)), '#e3c98e');
  p.hline(roll - 2, 4, w - 2 * roll + 4, '#d9bf86');
  p.hline(roll - 2, h - 5, w - 2 * roll + 4, '#d9bf86');
  for (const x0 of [0, w - roll]) {
    p.rect(x0, 0, roll, h, '#e6c88a');
    p.rect(x0 + 2, 0, 3, h, '#f3dca6');
    p.rect(x0 + roll - 3, 0, 2, h, '#c9a560');
    p.rect(x0 + 1, 0, roll - 2, 2, '#c9a560');
    p.rect(x0 + 1, h - 2, roll - 2, 2, '#c9a560');
  }
  p.outline(C.outline);
  return p;
}

function checkIcon() {
  const p = new Pix(11, 10);
  p.map(1, 1, ['.......gg', '......gg.', '.....gg..', 'gg..gg...', '.gggg....', '..gg.....'], { g: C.green });
  p.outline(C.outline);
  return p;
}
