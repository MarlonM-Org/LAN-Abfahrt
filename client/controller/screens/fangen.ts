import type { FangenState, Look } from '../../../shared/types';
import { AV_H, AV_W, drawAvatar } from '../../../shared/avatar';
import { FANGEN, HEAT_LABELS } from '../../../shared/fangen';
import { animateurHat, footprints, paintResort } from '../../art/resort';
import type { Pix } from '../../art/pix';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton } from '../core';
import { stickZone } from '../stick';
import { haptic } from '../haptic';

const HEAT_CSS = ['#5aa0e8', '#f2e05a', '#f0973a', '#e0402f'];
const HEAT_TEXT = ['Kalt ... hier ist niemand.', 'Lau – irgendwo in der Nähe?', 'Warm! Er ist ganz nah!', 'HEISS! Direkt neben dir!'];

const cur = () => (store.state?.mini?.kind === 'fangen' ? store.state.mini.state : null);

export function pickFangen(s: FangenState): Screen {
  const id = store.playerId!;
  const isRunner = s.runner === id;
  if (!isRunner && !s.hunters[id]) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['fg-over', message('Fangen vorbei!', 'Schau auf den Fernseher!')];
  if (s.sub === 'roundEnd' && s.outcome) {
    const o = s.outcome;
    const mine = isRunner ? (o.caught ? 'Du wurdest geschnappt!' : 'Du bist entkommen!') : o.caught ? (o.by === id ? 'Du hast den Animateur gefangen!' : 'Euer Team hat ihn!') : 'Er ist euch entwischt!';
    const detail = o.caught ? `${nameOf(o.by)} hat ${nameOf(o.runner)} nach ${Math.round(o.survivedMs / 1000)}s gefangen.` : `${nameOf(o.runner)} war ${Math.round(o.survivedMs / 1000)}s unsichtbar.`;
    return [`fg-end-${s.round}`, message(mine, `${detail} Gleich: nächste Runde.`)];
  }
  return isRunner ? [`fg-run-${s.round}`, buildRunner] : [`fg-hunt-${s.round}`, buildHunter];
}

// ------------------------------------------------------------------ Flüchtling: ganze Karte

let bgCache: Pix | null = null;
let hatCache: Pix | null = null;
let printCache: Pix | null = null;
const avatarCache = new Map<string, HTMLCanvasElement>();

function avatarImg(look: Look) {
  const key = JSON.stringify(look);
  let c = avatarCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = AV_W;
    c.height = AV_H;
    drawAvatar(c.getContext('2d')!, look);
    avatarCache.set(key, c);
  }
  return c;
}

function buildRunner() {
  // Quer: die private Karte bekommt die ganze Mitte (≈ 2× so groß wie hochkant), Stick links, ABLENKUNG rechts
  const root = el(`
    <div class="lx fg-lx fg-run">
      <div class="lx-head"><span class="lx-tag fg-role runner">ANIMATEUR</span><span class="timer"></span><span class="fg-round"></span><span class="hint fg-hint grow"></span></div>
      <div class="lx-left fg-stick"><span class="st-label">LAUFEN</span></div>
      <div class="lx-mid"><div class="fg-map"><canvas width="480" height="${FANGEN.ROWS * FANGEN.TILE}"></canvas></div></div>
      <div class="lx-right"><button class="big-btn fg-decoy">ABLENKUNG<br/><small>falsche Spur</small></button></div>
    </div>
  `);
  stickZone(q(root, '.fg-stick'), (x, y) => send('stick', { x, y }));
  const decoy = q<HTMLButtonElement>(root, '.fg-decoy');
  tapButton(decoy, () => {
    if (decoy.disabled) return;
    send('decoy');
    haptic(30);
  });
  const canvas = q<HTMLCanvasElement>(root, '.fg-map canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  bgCache ??= paintResort(480, 270);
  hatCache ??= animateurHat();
  printCache ??= footprints();
  app.append(root);

  let lastHeat = 0;
  return () => {
    const st = cur();
    const priv = store.priv?.kind === 'fangen' ? store.priv.state : null;
    if (!st) return;
    q(root, '.timer').textContent = st.sub === 'intro' ? `Vorsprung ${Math.ceil(st.endsIn / 1000)}s` : `${Math.ceil(st.endsIn / 1000)}s`;
    q(root, '.fg-round').textContent = `Runde ${st.round}/${st.rounds}`;
    const heat = Math.max(0, ...Object.values(st.hunters).map((h) => h.heat));
    q(root, '.fg-hint').textContent =
      st.sub === 'intro' ? 'Lauf los! Die Fänger warten noch. Nur DU siehst die Karte.' : heat >= 3 ? 'Achtung – ein Fänger ist ganz nah!' : heat === 2 ? 'Ein Fänger wird warm ...' : 'Bleib in Bewegung – deine Spuren sind kurz zu sehen!';
    if (heat >= 2 && heat > lastHeat) haptic(heat === 3 ? [40, 40, 40] : 25);
    lastHeat = heat;
    if (priv) {
      const ready = priv.decoyLeft <= 0 && !priv.decoyActive && st.sub === 'chase';
      decoy.disabled = !ready;
      decoy.innerHTML = priv.decoyActive ? 'ABLENKUNG<br/><small>läuft ...</small>' : priv.decoyLeft > 0 ? `ABLENKUNG<br/><small>${Math.ceil(priv.decoyLeft / 1000)}s</small>` : 'ABLENKUNG<br/><small>falsche Spur</small>';
    }

    // Karte zeichnen
    const oy = FANGEN.OY;
    ctx.drawImage(bgCache!.canvas, 0, oy, 480, canvas.height, 0, 0, 480, canvas.height);
    for (const p of st.prints) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.ttl / FANGEN.PRINT_TTL + 0.3);
      ctx.translate(p.x, p.y - oy + 3);
      ctx.rotate(p.angle);
      ctx.drawImage(printCache!.canvas, -6.5, -5.5);
      ctx.restore();
    }
    const now = performance.now();
    for (const [hid, h] of Object.entries(st.hunters)) {
      const pl = store.state?.players.find((p) => p.id === hid);
      ctx.fillStyle = 'rgba(224, 64, 47, 0.45)';
      ctx.beginPath();
      ctx.ellipse(h.x, h.y - oy + 5, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e0402f';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (pl) ctx.drawImage(avatarImg(pl.look), Math.round(h.x - AV_W / 2), Math.round(h.y - oy + 6 - AV_H));
    }
    if (priv) {
      const x = priv.x;
      const y = priv.y - oy;
      const pulse = 10 + Math.abs(Math.sin(now / 250)) * 6;
      ctx.strokeStyle = '#ffd25e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, Math.PI * 2);
      ctx.stroke();
      const me = store.state?.players.find((p) => p.id === store.playerId);
      if (me) {
        ctx.save();
        ctx.translate(Math.round(x), Math.round(y + 6));
        if (priv.dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(avatarImg(me.look), -AV_W / 2, -AV_H);
        ctx.restore();
        ctx.drawImage(hatCache!.canvas, Math.round(x - 10), Math.round(y + 6 - 28));
      }
    }
  };
}

// ------------------------------------------------------------------ Fänger: Fährte + Sprint

function buildHunter() {
  const root = el(`
    <div class="lx fg-lx fg-hunt">
      <div class="lx-head"><span class="lx-tag fg-role hunter">FÄNGER</span><span class="timer"></span><span class="fg-round grow"></span></div>
      <div class="lx-left fg-stick"><span class="st-label">LAUFEN</span></div>
      <div class="lx-mid">
        <div class="fg-heat"><b></b><small></small></div>
        <p class="hint">Der Animateur ist auf dem TV unsichtbar! Achtet auf Fußspuren – und ruft euch zu, bei wem es warm wird.</p>
      </div>
      <div class="lx-right"><button class="big-btn dash fg-sprint">SPRINT</button></div>
    </div>
  `);
  stickZone(q(root, '.fg-stick'), (x, y) => send('stick', { x, y }));
  const sprint = q<HTMLButtonElement>(root, '.fg-sprint');
  tapButton(sprint, () => {
    if (sprint.disabled) return;
    send('sprint');
    haptic(20);
  });
  app.append(root);
  let lastHeat = 0;
  return () => {
    const st = cur();
    const me = st?.hunters[store.playerId!];
    if (!st || !me) return;
    q(root, '.timer').textContent = `${Math.ceil(st.endsIn / 1000)}s`;
    q(root, '.fg-round').textContent = `${st.round}/${st.rounds} · Jagd auf ${nameOf(st.runner).slice(0, 10)}`;
    const box = q(root, '.fg-heat');
    if (st.sub === 'intro') {
      box.style.background = '#3b3b4f';
      box.style.color = '#fff4d6';
      q(box, 'b').textContent = `Augen zu! ${Math.max(1, Math.ceil(st.endsIn / 1000))}`;
      q(box, 'small').textContent = `${nameOf(st.runner)} versteckt sich ...`;
    } else {
      box.style.background = HEAT_CSS[me.heat];
      box.style.color = '';
      q(box, 'b').textContent = HEAT_LABELS[me.heat].toUpperCase();
      q(box, 'small').textContent = HEAT_TEXT[me.heat];
      if (me.heat >= 2 && me.heat > lastHeat) haptic(me.heat === 3 ? [50, 30, 50] : 30);
      lastHeat = me.heat;
    }
    box.classList.toggle('hot', st.sub === 'chase' && me.heat === 3);
    sprint.disabled = st.sub !== 'chase' || me.sprintLeft > 0;
    sprint.textContent = me.sprinting ? 'SPRINT!' : me.sprintLeft > 0 ? `SPRINT ${Math.ceil(me.sprintLeft / 1000)}s` : 'SPRINT';
  };
}
