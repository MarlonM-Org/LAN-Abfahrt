import type { ArenaState, SupState, TidyState } from '../../../shared/types';
import { TEAM_INFO } from '../../../shared/flunky';
import { type Screen, app, avatarCanvas, colorOfId, el, me, message, myColor, nameOf, q, secondsLeft, send, store, tapButton } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';
import { spectatorBar } from '../spectator';
import { ARENA } from '../../../shared/arena';
import { SPECTATOR } from '../../../shared/spectator';

// ------------------------------------------------------------------ Joystick

/** Fester Joystick (Mitte = Kreismitte) – nur noch für den Fallen-Parcours; alle anderen nutzen stickZone() aus stick.ts */
export function joystick(container: HTMLElement, onMove: (x: number, y: number) => void) {
  const pad = el(`<div class="stick-pad"><div class="stick-knob"></div></div>`).firstElementChild as HTMLElement;
  const knob = pad.querySelector('.stick-knob') as HTMLElement;
  container.append(pad);
  let active: number | null = null;
  let cx = 0;
  let cy = 0;
  let last = { x: 0, y: 0, t: 0 };
  const R = 60;
  const emit = (x: number, y: number, force = false) => {
    const now = performance.now();
    if (!force && now - last.t < 45 && Math.hypot(x - last.x, y - last.y) < 0.25) return;
    last = { x, y, t: now };
    onMove(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };
  const move = (e: PointerEvent) => {
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    emit(dx / R, dy / R);
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    active = e.pointerId;
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    move(e);
  });
  pad.addEventListener('pointermove', (e) => e.pointerId === active && move(e));
  const up = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    knob.style.transform = '';
    emit(0, 0, true);
  };
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointercancel', up);
  // Wenn der Finger ruhig bleibt, trotzdem regelmäßig senden (falls ein Paket verloren ging)
  const keepAlive = setInterval(() => {
    if (!pad.isConnected) return clearInterval(keepAlive);
    if (active !== null) emit(last.x, last.y, true);
  }, 300);
  return pad;
}

// ------------------------------------------------------------------ SUP

export function pickSup(s: SupState): Screen {
  const id = store.playerId!;
  const b = s.boards.find((bb) => bb.left === id || bb.right === id);
  if (!b) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'countdown') {
    const role = b.left === b.right ? 'Du paddelst allein – beide Seiten!' : b.left === id ? `Du paddelst LINKS, ${nameOf(b.right)} rechts.` : `Du paddelst RECHTS, ${nameOf(b.left)} links.`;
    return ['sup-count', message('Gleich geht’s los!', `${role}\nLinks paddeln dreht nach rechts – und umgekehrt. Gleichmäßig paddeln, sonst fallt ihr ins Wasser!`)];
  }
  if (s.sub === 'over') return ['sup-over', message(b.finished ? 'Im Ziel!' : 'Zeit ist um!', 'Schau auf den Fernseher!')];
  const sides: ('left' | 'right')[] = b.left === b.right ? ['left', 'right'] : [b.left === id ? 'left' : 'right'];
  return [`sup-race-${sides.join()}`, () => {
    const root = el(`
      <div class="top-row"><span class="timer"></span><span class="prog"></span></div>
      <p class="partner"></p>
      <div class="balance"><div class="needle"></div></div>
      <div class="paddles ${sides.length === 2 ? 'two' : ''}"></div>
    `);
    const wrap = q(root, '.paddles');
    for (const side of sides) {
      const btn = el(`<button class="big-btn paddle ${side}">${side === 'left' ? '◀ LINKS' : 'RECHTS ▶'}<br/><small>paddeln</small></button>`).firstElementChild as HTMLButtonElement;
      tapButton(btn, () => {
        send('paddle', { side });
        haptic(10);
      });
      wrap.append(btn);
    }
    app.append(root);
    return () => {
      const st = store.state?.mini?.kind === 'sup' ? store.state.mini.state : null;
      const bb = st?.boards.find((x) => x.id === b.id);
      if (!st || !bb) return;
      q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
      q(root, '.prog').textContent = `${Math.round((bb.x / st.length) * 100)}%`;
      q(root, '.partner').textContent = bb.fallen ? 'PLATSCH! Wieder aufs Board ...' : bb.finished ? 'Im Ziel!' : bb.left === bb.right ? 'Abwechselnd paddeln!' : `Team mit ${nameOf(bb.left === id ? bb.right : bb.left)}`;
      (q(root, '.needle') as HTMLElement).style.left = `${50 + Math.max(-1, Math.min(1, bb.balance)) * 46}%`;
      q(root, '.balance').classList.toggle('danger', Math.abs(bb.balance) > 0.7);
    };
  }];
}

// ------------------------------------------------------------------ Aufräumen

export function pickTidy(s: TidyState): Screen {
  const me = s.players[store.playerId!];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['td-over', message('Aufgeräumt!', 'Schau auf den Fernseher!')];
  return [`td-${s.sub}`, () => {
    const team = TEAM_INFO[me.team];
    // Quer: zwei Daumen – links Stick, rechts SPRINT (früher Stick und Knopf übereinander für einen Daumen)
    const root = el(`
      <div class="lx td-lx">
        <div class="lx-head"><span class="lx-tag team-${me.team}">${team.name} · Korb ${me.team === 'A' ? 'links' : 'rechts'}</span><span class="timer"></span><span class="score grow"></span></div>
        <div class="lx-left td-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
        <div class="lx-mid"><p class="hint">${s.sub === 'countdown' ? 'Gleich geht’s los! Schiebt die Sachen in euren Korb.' : 'Lauf gegen die Sachen, um sie zu schieben!'}</p></div>
        <div class="lx-right"><button class="big-btn dash">SPRINT</button></div>
      </div>
    `);
    stickZone(q(root, '.td-stick'), (x, y) => send('stick', { x, y }));
    const dash = q<HTMLButtonElement>(root, '.dash');
    tapButton(dash, () => {
      send('dash');
      haptic(20);
    });
    app.append(root);
    return () => {
      const st = store.state?.mini?.kind === 'tidy' ? store.state.mini.state : null;
      if (!st) return;
      q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
      q(root, '.score').textContent = st.baskets.length > 1 ? `Sonne ${st.score.A} : ${st.score.B} Meer` : `${st.score.A} Teile`;
      const pl = st.players[store.playerId!];
      dash.disabled = !!pl && pl.dashLeft > 0;
    };
  }];
}

// ------------------------------------------------------------------ Bomben-Arena

export function pickArena(s: ArenaState): Screen {
  const id = store.playerId!;
  const mine = s.players[id];
  if (!mine) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['ar-over', message('Arena vorbei!', 'Schau auf den Fernseher!')];
  // Raus: als Geist alle 8 s eine Wasserbombe an den Rand werfen + auf den Rundensieger tippen
  if (!mine.alive && (s.sub === 'play' || s.sub === 'roundOver')) return [`ar-dead-${s.round}`, buildArenaGhost];
  return ['ar-ctl', () => {
    const look = me()?.look;
    const color = myColor()?.hex ?? '#f2c33a';
    // Quer wie Bomberman am Gamepad: links Stick, rechts BOMBE
    const root = el(`
      <div class="lx ar-lx" style="--ar-color:${color}">
        <div class="lx-head"><span class="arena-av"></span><span class="arena-round"></span><span class="arena-stats grow"></span></div>
        <div class="lx-left ar-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
        <div class="lx-mid"><p class="hint arena-hint"></p></div>
        <div class="lx-right"><button class="big-btn arena-bomb">BOMBE</button></div>
      </div>
    `);
    if (look) q(root, '.arena-av').append(avatarCanvas(1, look));
    stickZone(q(root, '.ar-stick'), (x, y) => send('stick', { x, y }));
    const bomb = q<HTMLButtonElement>(root, '.arena-bomb');
    tapButton(bomb, () => {
      send('bomb');
      haptic(25);
    });
    app.append(root);
    return () => {
      const st = store.state?.mini?.kind === 'arena' ? store.state.mini.state : null;
      const p = st?.players[id];
      if (!st || !p) return;
      q(root, '.arena-round').textContent = `Runde ${st.round} · Siege ${p.wins}/${st.winRounds}`;
      q(root, '.arena-stats').textContent = `Bomben ${p.bombs} · Weite ${p.range} · Tempo ${p.speed + 1}`;
      let hint = '';
      if (st.sub === 'countdown') hint = `Gleich geht’s los … ${secondsLeft()}`;
      else if (st.sub === 'roundOver') hint = st.roundWinner === id ? 'Rundensieg! Du bist trocken geblieben!' : st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle nass – Unentschieden!';
      else if (st.floodActive) hint = 'FLUT! Weg vom Rand!';
      else hint = `Flut in ${secondsLeft()}s`;
      q(root, '.arena-hint').textContent = hint;
      bomb.disabled = st.sub !== 'play' || !p.alive;
    };
  }];
}

// ------------------------------------------------------------------ Bomben-Arena: Geister-Screen

const GHOST_TILE = 6;
const MAP_COLORS: Record<string, string> = { '#': '#5e3518', P: '#2f7d32', b: '#c99b5a', '.': '#f1d49a', '~': '#3f8fe0' };

/** Quer: links Stick fürs Zielkreuz, Mitte Mini-Karte + Zuschauer-Leiste, rechts WERFEN */
function buildArenaGhost() {
  const id = store.playerId!;
  const root = el(`
    <div class="lx ar-lx ar-ghost">
      <div class="lx-head"><b>👻 Geist</b><span class="arena-round ghost-round"></span><span class="arena-stats grow ghost-hint"></span></div>
      <div class="lx-left ar-stick"><span class="st-label">ZIELEN · Zielkreuz am Rand verschieben</span></div>
      <div class="lx-mid"><canvas class="ghost-map" width="${ARENA.COLS * GHOST_TILE}" height="${ARENA.ROWS * GHOST_TILE}"></canvas></div>
      <div class="lx-right"><button class="big-btn ghost-throw">WASSER-<br/>BOMBE<small>alle 8 s</small><i class="cd"></i></button></div>
    </div>
  `);
  stickZone(q(root, '.ar-stick'), (x, y) => send('ghost', { x, y }));
  const throwBtn = q<HTMLButtonElement>(root, '.ghost-throw');
  const cd = q(root, '.ghost-throw .cd');
  tapButton(throwBtn, () => {
    if (throwBtn.disabled) return;
    send('throw');
    haptic(30);
  });
  const canvas = q<HTMLCanvasElement>(root, '.ghost-map');
  const ctx = canvas.getContext('2d')!;
  const mid = q(root, '.lx-mid');
  const bar = spectatorBar(mid);
  app.append(root);
  haptic([60, 40, 120]);
  return () => {
    bar();
    const st = store.state?.mini?.kind === 'arena' ? store.state.mini.state : null;
    if (!st) return;
    const g = st.ghosts?.[id];
    q(root, '.ghost-round').textContent = `Runde ${st.round}`;
    q(root, '.ghost-hint').textContent =
      st.sub === 'roundOver' ? (st.roundWinner ? `${nameOf(st.roundWinner)} gewinnt die Runde.` : 'Alle nass – Unentschieden!') : g && g.cd > 0 ? `Nachladen … ${Math.ceil(g.cd / 1000)}s` : 'Rache! Wirf eine Wasserbombe an den Rand.';
    const ready = st.sub === 'play' && !!g && g.cd <= 0;
    throwBtn.disabled = !ready;
    cd.style.transform = `scaleY(${g && st.sub === 'play' ? Math.min(1, g.cd / SPECTATOR.ARENA_GHOST_MS) : 1})`;
    // Mini-Karte
    const T = GHOST_TILE;
    for (let y = 0; y < ARENA.ROWS; y++) {
      for (let x = 0; x < ARENA.COLS; x++) {
        ctx.fillStyle = MAP_COLORS[st.grid[y * ARENA.COLS + x]] ?? '#f1d49a';
        ctx.fillRect(x * T, y * T, T, T);
      }
    }
    ctx.fillStyle = '#2d1b12';
    for (const b of st.bombs) ctx.fillRect(b.x * T + 1, b.y * T + 1, T - 2, T - 2);
    for (const [pid, p] of Object.entries(st.players)) {
      if (!p.alive) continue;
      ctx.fillStyle = colorOfId(pid).hex;
      ctx.fillRect(Math.round(p.x * T) + 1, Math.round(p.y * T) + 1, T - 2, T - 2);
    }
    if (g) {
      const blink = Math.floor(performance.now() / 250) % 2 === 0;
      ctx.strokeStyle = blink ? '#e0503f' : '#fff4d6';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(g.x) * T - 2, Math.round(g.y) * T - 2, T + 4, T + 4);
    }
  };
}
