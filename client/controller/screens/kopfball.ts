import type { Team } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { KB, KB_WORDS, type KbState } from '../../../shared/kopfball';
import { stickZone } from '../stick';
import { slideButtons } from '../slide';
import { haptic } from '../haptic';
import { type Screen, app, avatarCanvas, el, me, message, nameOf, q, secondsLeft, send, store } from '../core';

/**
 * Kopfball-Duell / Kopf-Korb am Handy (quer, gemeinsames Querlayout `.lx`):
 *   links  – schwebender Stick (`stickZone`): laufen; Stick nach oben = springen (wie SPRUNG)
 *   Mitte  – Spielstand, Uhr, Anstoß/Einwurf, Hinweise
 *   rechts – SPRUNG und SCHUSS nebeneinander (Rüberrutschen geht, beide gleichzeitig auch)
 * Alles geht als ein Zustand raus (`pad`: Stick x/y + gehaltene Knöpfe) – bei jeder Änderung und, solange etwas
 * gehalten wird, regelmäßig wieder (der Raum lässt nach 700 ms ohne Nachschub los). `input-reset`, Blur und
 * Loslassen setzen alles auf neutral.
 */

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const cur = (): KbState | null => {
  const m = store.state?.mini;
  return m && (m.kind === 'kopfball' || m.kind === 'kopfkorb') ? m.state : null;
};

export function pickKopfball(s: KbState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  const title = s.mode === 'korb' ? 'Kopf-Korb' : 'Kopfball-Duell';
  if (!mine) return ['spectate', message('Du schaust zu', `${title} läuft – schau auf den Fernseher!`)];
  if (s.sub === 'over') {
    const res = s.winner ? (s.winner === mine.t ? 'Gewonnen!' : 'Verloren …') : 'Unentschieden!';
    return [`kb-over-${s.mode}`, message(`Abpfiff – ${res}`, `${s.score.A}:${s.score.B} · Schau auf den Fernseher!`)];
  }
  // Ein Screen fürs ganze Spiel, damit gehaltene Finger beim Anstoß/Tor erhalten bleiben
  return [`kb-play-${s.mode}`, () => buildPad(mine.t, s.mode)];
}

function buildPad(team: Team, mode: KbState['mode']) {
  const korb = mode === 'korb';
  const dirText = team === 'A' ? 'spielt nach rechts →' : '← spielt nach links';
  const root = el(`
    <div class="lx kb-lx kb-${team}">
      <div class="lx-head">
        <span class="kb-av"></span>
        <span class="lx-tag team-${team}">${TEAM_INFO[team].name.toUpperCase()}</span>
        <span class="kb-dir grow">${dirText}</span>
        <span class="timer kb-clock"></span>
      </div>
      <div class="lx-left kb-stick"><span class="st-label">LAUFEN · Stick hoch = springen</span></div>
      <div class="lx-mid kb-mid">
        <div class="kb-score"><span class="sa">0</span><i>:</i><span class="sb">0</span></div>
        <div class="kb-center"></div>
        <div class="kb-msg"></div>
      </div>
      <div class="lx-right kb-pad">
        <button class="big-btn kb-btn kb-jump">⤴<br/>SPRUNG</button>
        <button class="big-btn kb-btn kb-kick">${korb ? '🏀' : '🦶'}<br/>${korb ? 'WURF' : 'SCHUSS'}<i class="kb-cd"></i></button>
      </div>
    </div>
  `);
  const look = me()?.look;
  if (look) q(root, '.kb-av').append(avatarCanvas(1, look));
  app.append(root);

  // ---- Eingaben: ein Zustand für Stick + Knöpfe
  const inp = { x: 0, y: 0, jump: false, kick: false };
  let lastSent = 0;
  const push = () => {
    lastSent = performance.now();
    send('pad', { ...inp });
  };
  let stickUp = false;
  stickZone(
    q(root, '.kb-stick'),
    (x, y) => {
      inp.x = x;
      inp.y = y;
      const up = y < -KB.STICK_JUMP;
      if (up && !stickUp) haptic('tick');
      stickUp = up;
      push();
    },
    { radius: 46 },
  );
  // SPRUNG / SCHUSS: Rutsch-Knöpfe – jeder Finger drückt den Knopf, über dem er gerade liegt (auch beide)
  slideButtons(
    q(root, '.kb-pad'),
    { jump: q(root, '.kb-jump'), kick: q(root, '.kb-kick') },
    (held) => {
      const jump = held.includes('jump');
      const kick = held.includes('kick');
      if (jump === inp.jump && kick === inp.kick) return;
      inp.jump = jump;
      inp.kick = kick;
      push();
    },
    {
      slack: 14,
      onEnter: (k) => haptic(k === 'kick' ? 18 : 10),
    },
  );
  // Gehaltene Knöpfe regelmäßig wiederholen (der Stick wiederholt sich selbst alle 250 ms)
  const keepAlive = setInterval(() => {
    if (!root.isConnected) return clearInterval(keepAlive);
    if ((inp.jump || inp.kick) && performance.now() - lastSent > 280) push();
  }, 100);

  // ---- Anzeige
  const center = q(root, '.kb-center');
  const msgEl = q(root, '.kb-msg');
  const cdEl = q(root, '.kb-cd');
  const kickBtn = q(root, '.kb-kick');
  const st0 = cur();
  let seenGoal = st0?.lastGoal?.seq ?? 0;
  let touches = st0?.players[store.playerId!]?.h ?? 0;
  let centerUntil = 0;
  let lastSub = '';
  const flash = (text: string, cls = '', ms = 1200) => {
    center.textContent = text;
    center.className = `kb-center ${cls}`;
    centerUntil = performance.now() + ms;
  };
  return () => {
    const st = cur();
    const p = st?.players[store.playerId!];
    if (!st || !p) return;
    const w = KB_WORDS[st.mode];
    q(root, '.sa').textContent = String(st.score.A);
    q(root, '.sb').textContent = String(st.score.B);
    const golden = st.overtime ? (korb ? 'Golden Basket ' : 'Golden Goal ') : '';
    q(root, '.kb-clock').textContent = st.practice ? 'Aufwärmen' : `${golden}${fmtClock(st.sub === 'play' ? secondsLeft() : Math.ceil(st.clock / 1000))}`;
    cdEl.style.transform = `scaleY(${p.cd > 0 ? Math.min(1, p.cd / KB.KICK_CD_MS) : 0})`;
    kickBtn.classList.toggle('cool', p.cd > 0);
    root.classList.toggle('off', !!p.off || !!p.out);
    if (p.h !== touches) {
      touches = p.h;
      haptic(12);
    }
    const g = st.lastGoal;
    if (g && g.seq !== seenGoal) {
      seenGoal = g.seq;
      const ours = g.team === team;
      const head = korb ? (g.dunk ? 'DUNK!' : g.pts === 3 ? 'DREIER!' : 'KORB!') : 'TOR!';
      flash(ours ? head : korb ? 'Korb kassiert' : 'GEGENTOR', ours ? 'go' : 'hit', 2200);
      haptic(ours ? [60, 40, 60, 40, 120] : 120);
    }
    const now = performance.now();
    if (st.sub === 'countdown') {
      center.textContent = String(Math.max(1, secondsLeft()));
      center.className = 'kb-center count';
    } else if (st.sub === 'play' && (lastSub === 'countdown' || lastSub === 'kickoff')) flash('LOS!', 'go', 700);
    else if (centerUntil && now > centerUntil) {
      center.textContent = '';
      centerUntil = 0;
    }
    lastSub = st.sub;
    const kicking = st.kick === team;
    const scorer = g?.scorer ? nameOf(g.scorer) : '';
    let msg = '';
    if (p.out) msg = 'Du warst zu lange weg – gleich bist du wieder im Feld.';
    else if (st.sub === 'countdown' || st.sub === 'kickoff' || st.hold) {
      msg = `${w.kick}: ${kicking ? 'IHR habt den Ball!' : `${TEAM_INFO[st.kick].name}`}${st.first ? ' (per Los)' : ''}`;
      if (!kicking && st.hold) msg += korb ? ' – schnell hin und verteidigen!' : ' – bleibt in eurer Hälfte, bis er berührt wird.';
    } else if (st.sub === 'goal' && g) msg = g.own ? `Eigentor${scorer ? ` von ${scorer}` : ''}!` : scorer ? `${scorer} trifft${korb ? ` (+${g.pts})` : ''}!` : '';
    else if (korb) msg = 'WURF, wenn der Ball bei dir ist – aus der eigenen Hälfte zählt er 3!';
    else msg = p.air ? 'In der Luft: SCHUSS = Direktabnahme!' : 'Hohe Bälle köpfen, flache Bälle schießen!';
    if (msgEl.textContent !== msg) msgEl.textContent = msg;
  };
}
