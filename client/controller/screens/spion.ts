import type { SpionPrivate, SpionState } from '../../../shared/types';
import { SPION, SP_A, STATIONS, guestAnim, guestDir, guestVariant } from '../../../shared/spion';
import { GF, GUEST_H, GUEST_W, guestPix, paintPartyFlat, partyBalloon, puddle } from '../../art/spion';
import type { Pix } from '../../art/pix';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton, toast } from '../core';

const cur = () => (store.state?.mini?.kind === 'spion' ? store.state.mini.state : null);
const priv = (): SpionPrivate | null => (store.priv?.kind === 'spion' ? store.priv.state : null);

export function pickSpion(s: SpionState): Screen {
  const id = store.playerId!;
  const me = s.players[id];
  if (!me) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'over') return ['sp-over', message('Party vorbei!', 'Schau auf den Fernseher!')];
  if (s.sub === 'reveal') {
    const title = s.winner === id ? 'Alle Aufträge erledigt!' : me.out ? 'Enttarnt!' : 'Unerkannt geblieben!';
    return [`sp-reveal-${s.round}`, message(title, `${s.news?.text ?? ''} Du hast ${me.score} Punkte.`)];
  }
  if (me.out) return [`sp-out-${s.round}`, message('Enttarnt! 💦', `${nameOf(me.outBy)} hat dich mit einem Wasserballon erwischt. Schau auf den TV, wer gewinnt!`)];
  return [`sp-play-${s.round}`, buildPlay];
}

// ------------------------------------------------------------------ Bild-Cache

let bgCache: Pix | null = null;
const sprites = new Map<string, Pix>();
const sprite = (key: string, make: () => Pix) => {
  let p = sprites.get(key);
  if (!p) sprites.set(key, (p = make()));
  return p;
};

/** Sichtbarer Kartenausschnitt (Welt-Koordinaten) */
interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
function seg(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
}

const FULL: View = { x: 0, y: SPION.TOP, w: SPION.W, h: SPION.BOTTOM - SPION.TOP };

function buildPlay() {
  const root = el(`
    <div class="top-row"><span class="timer"></span><span class="sp-round"></span></div>
    <div class="sp-id">🕶️ Du bist Gast Nr. <b></b></div>
    <div class="sp-tasks">${STATIONS.map((s, i) => `<span data-i="${i}">${s.icon}<small>${s.name}</small></span>`).join('')}</div>
    <div class="sp-map"><canvas width="480" height="${FULL.h}"></canvas><button class="sp-zoom small secondary">🔍</button></div>
    <p class="hint sp-hint"></p>
    <div class="sp-modes"><button class="sp-walk">🚶 GEHEN</button><button class="sp-aim">🎈 ZIELEN</button></div>
    <div class="sp-acts"><button class="sp-chat">💬 PLAUDERN</button><button class="sp-use">✋ ERLEDIGEN</button></div>
    <div class="sp-acts sp-throwrow"><button class="sp-throw danger">🎈 WERFEN!</button></div>
  `);
  const canvas = q<HTMLCanvasElement>(root, '.sp-map canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  bgCache ??= paintPartyFlat();
  app.append(root);

  let mode: 'walk' | 'aim' = 'walk';
  let zoom = false;
  let selected: number | null = null;
  let marker: { x: number; y: number; at: number } | null = null;
  let noteSeq = priv()?.note?.seq ?? 0;
  const pos: { x: number; y: number }[] = [];

  const view = (): View => {
    if (!zoom) return FULL;
    const p = priv();
    const g = p ? cur()?.guests[p.g] : null;
    const w = 240, h = FULL.h / 2;
    const cx = g ? g[0] : 240, cy = g ? g[1] - 8 : 136;
    return { x: Math.max(0, Math.min(SPION.W - w, cx - w / 2)), y: Math.max(FULL.y, Math.min(FULL.y + FULL.h - h, cy - h / 2)), w, h };
  };

  const walkBtn = q<HTMLButtonElement>(root, '.sp-walk');
  const aimBtn = q<HTMLButtonElement>(root, '.sp-aim');
  const chatBtn = q<HTMLButtonElement>(root, '.sp-chat');
  const useBtn = q<HTMLButtonElement>(root, '.sp-use');
  const throwBtn = q<HTMLButtonElement>(root, '.sp-throw');
  const acts = q(root, '.sp-acts');
  const throwRow = q(root, '.sp-throwrow');
  const setMode = (m: 'walk' | 'aim') => {
    mode = m;
    selected = null;
    update();
  };
  tapButton(walkBtn, () => setMode('walk'));
  tapButton(aimBtn, () => {
    const me = cur()?.players[store.playerId!];
    if (!me?.balloons) return toast('Keine Wasserballons mehr!');
    setMode(mode === 'aim' ? 'walk' : 'aim');
  });
  tapButton(chatBtn, () => send('chat'));
  tapButton(useBtn, () => {
    if (useBtn.disabled) return;
    send('use');
    navigator.vibrate?.(20);
  });
  tapButton(throwBtn, () => {
    if (selected === null || throwBtn.disabled) return;
    send('throw', { g: selected });
    navigator.vibrate?.([30, 30, 60]);
    setMode('walk');
  });
  tapButton(q(root, '.sp-zoom'), () => {
    zoom = !zoom;
    q(root, '.sp-zoom').textContent = zoom ? '🗺️' : '🔍';
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const st = cur();
    const p = priv();
    if (!st || !p || st.sub !== 'play') return;
    const r = canvas.getBoundingClientRect();
    const v = view();
    const wx = v.x + ((e.clientX - r.left) / r.width) * v.w;
    const wy = v.y + ((e.clientY - r.top) / r.height) * v.h;
    if (mode === 'walk') {
      send('goto', { x: Math.round(wx), y: Math.round(wy) });
      marker = { x: wx, y: wy, at: performance.now() };
      return;
    }
    // Zielen: nächster Gast (Mitte der Figur) in Reichweite
    let best = -1, bd = (SPION.PICK_R * v.w) / SPION.W + 4;
    st.guests.forEach((g, i) => {
      if (i === p.g || guestAnim(g) === SP_A.OUT) return;
      const pp = pos[i] ?? { x: g[0], y: g[1] };
      const d = Math.hypot(pp.x - wx, pp.y - 8 - wy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    selected = best >= 0 ? best : null;
    update();
  });

  // Karte flüssig zeichnen (Positionen werden lokal nachgezogen)
  const draw = () => {
    if (!root.isConnected) return;
    requestAnimationFrame(draw);
    const st = cur();
    const p = priv();
    if (!st) return;
    const v = view();
    const k = canvas.width / v.w;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCache!.canvas, v.x, v.y, v.w, v.h, 0, 0, canvas.width, canvas.height);
    const now = performance.now();
    const X = (x: number) => (x - v.x) * k;
    const Y = (y: number) => (y - v.y) * k;
    // Auftragsorte: erledigte (nur auf dem eigenen Handy) mit Haken
    STATIONS.forEach((s, i) => {
      ctx.lineWidth = 2;
      ctx.strokeStyle = p?.done[i] ? 'rgba(70, 176, 74, 0.9)' : 'rgba(255, 210, 94, 0.85)';
      ctx.setLineDash(p?.done[i] ? [] : [4, 3]);
      ctx.beginPath();
      ctx.ellipse(X(s.x), Y(s.y), 15 * k, 6 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `${Math.round(12 * Math.min(1.6, k))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p?.done[i] ? '✅' : s.icon, X(s.x), Y(s.y) - 22 * k);
    });
    // Gäste von hinten nach vorn
    const order = st.guests.map((_, i) => i);
    st.guests.forEach((g, i) => {
      const pp = (pos[i] ??= { x: g[0], y: g[1] });
      pp.x += (g[0] - pp.x) * 0.3;
      pp.y += (g[1] - pp.y) * 0.3;
    });
    order.sort((a, b) => pos[a].y - pos[b].y);
    const outTags = new Set(st.tags.filter((t) => t.why === 'out').map((t) => t.g));
    for (const i of order) {
      const g = st.guests[i];
      const pp = pos[i];
      const a = guestAnim(g);
      if (a === SP_A.OUT || outTags.has(i)) {
        const pd = sprite('puddle', puddle);
        ctx.drawImage(pd.canvas, X(pp.x) - (pd.w * k) / 2, Y(pp.y) - pd.h * k, pd.w * k, pd.h * k);
        continue;
      }
      const mine = p?.g === i;
      if (mine) {
        const r = (9 + Math.abs(Math.sin(now / 220)) * 4) * k;
        ctx.fillStyle = 'rgba(255, 210, 94, 0.45)';
        ctx.strokeStyle = '#ffd25e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(X(pp.x), Y(pp.y), r, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      const frame = a === SP_A.WALK ? (Math.floor((pp.x + pp.y) / 4) % 2 ? GF.WALK_A : GF.WALK_B) : a === SP_A.USE ? GF.USE : a === SP_A.CHAT ? GF.CHAT : a === SP_A.WET ? GF.WET : GF.STAND;
      const vv = guestVariant(g);
      const spr = sprite(`g${vv}_${frame}`, () => guestPix(vv, frame));
      const x = X(pp.x) - (GUEST_W * k) / 2, y = Y(pp.y) - GUEST_H * k;
      ctx.save();
      if (guestDir(g) < 0) {
        ctx.translate(x + GUEST_W * k, y);
        ctx.scale(-1, 1);
        ctx.drawImage(spr.canvas, 0, 0, GUEST_W * k, GUEST_H * k);
      } else ctx.drawImage(spr.canvas, x, y, GUEST_W * k, GUEST_H * k);
      ctx.restore();
      if (mine) {
        ctx.fillStyle = '#ffd25e';
        ctx.strokeStyle = '#2d1b12';
        ctx.lineWidth = 2;
        const ax = X(pp.x), ay = Y(pp.y) - GUEST_H * k - 4 - Math.abs(Math.sin(now / 200)) * 3;
        ctx.beginPath();
        ctx.moveTo(ax - 6, ay - 8);
        ctx.lineTo(ax + 6, ay - 8);
        ctx.lineTo(ax, ay);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      }
    }
    // Aufgeflogene Werfer (öffentlich auf dem TV) markieren
    for (const t of st.tags) {
      if (t.why !== 'miss') continue;
      const pp = pos[t.g];
      if (!pp) continue;
      ctx.font = `bold ${Math.round(14 * Math.min(1.5, k))}px sans-serif`;
      ctx.fillStyle = Math.floor(now / 250) % 2 ? '#ff4a3a' : '#ffd25e';
      ctx.fillText('!', X(pp.x), Y(pp.y) - GUEST_H * k - 4);
    }
    // Ballons im Flug
    for (const t of st.throws) {
      if (t.hit !== null) continue;
      const pp = pos[t.g];
      if (!pp) continue;
      const b = sprite('balloon', partyBalloon);
      ctx.drawImage(b.canvas, X(pp.x) - b.w, Y(pp.y) - GUEST_H * k - 18 - Math.abs(Math.sin(now / 90)) * 6, b.w * 2, b.h * 2);
    }
    // Ziel-Auswahl
    if (mode === 'aim' && selected !== null && pos[selected]) {
      const pp = pos[selected];
      const cx = X(pp.x), cy = Y(pp.y) - (GUEST_H * k) / 2;
      const r = 12 * Math.max(1, k * 0.8);
      ctx.strokeStyle = Math.floor(now / 200) % 2 ? '#ff4a3a' : '#fff4d6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      seg(ctx, cx - r - 4, cy, cx - r + 4, cy);
      seg(ctx, cx + r - 4, cy, cx + r + 4, cy);
      seg(ctx, cx, cy - r - 4, cx, cy - r + 4);
      seg(ctx, cx, cy + r - 4, cx, cy + r + 4);
      ctx.stroke();
    }
    // Lauf-Ziel
    if (marker && now - marker.at < 1500) {
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.9)';
      ctx.lineWidth = 2;
      const mx = X(marker.x), my = Y(marker.y);
      ctx.beginPath();
      seg(ctx, mx - 4, my - 4, mx + 4, my + 4);
      seg(ctx, mx + 4, my - 4, mx - 4, my + 4);
      ctx.stroke();
    }
    if (mode === 'aim') {
      ctx.fillStyle = 'rgba(168, 52, 42, 0.18)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };
  requestAnimationFrame(draw);

  const update = () => {
    const st = cur();
    const p = priv();
    if (!st) return;
    const me = st.players[store.playerId!];
    q(root, '.timer').textContent = st.sub === 'intro' ? `Gleich geht's los: ${Math.ceil(st.endsIn / 1000)}s` : `${Math.ceil(st.endsIn / 1000)}s`;
    q(root, '.sp-round').textContent = `Runde ${st.round}/${st.rounds} · ${me?.score ?? 0} P.`;
    if (p) q(root, '.sp-id b').textContent = String(p.g + 1);
    root.querySelectorAll<HTMLElement>('.sp-tasks span').forEach((s) => s.classList.toggle('done', !!p?.done[Number(s.dataset.i)]));
    if (p?.note && p.note.seq !== noteSeq) {
      noteSeq = p.note.seq;
      toast(p.note.text);
    }
    const play = st.sub === 'play';
    const balloons = me?.balloons ?? 0;
    if (!balloons && mode === 'aim') {
      mode = 'walk';
      selected = null;
    }
    walkBtn.classList.toggle('active', mode === 'walk');
    aimBtn.classList.toggle('active', mode === 'aim');
    aimBtn.textContent = `🎈 ZIELEN (${balloons})`;
    aimBtn.disabled = !play || !balloons;
    acts.style.display = mode === 'aim' ? 'none' : '';
    throwRow.style.display = mode === 'aim' ? '' : 'none';
    if (selected !== null && (!st.guests[selected] || guestAnim(st.guests[selected]) === SP_A.OUT)) selected = null;
    throwBtn.disabled = !play || selected === null;
    throwBtn.textContent = selected === null ? '🎯 Tippe auf einen Gast' : '🎈 WERFEN!';
    chatBtn.disabled = !play || !!p?.using;
    chatBtn.textContent = p?.chatting ? '👋 TSCHÜSS' : '💬 PLAUDERN';
    const near = p?.near ?? -1;
    useBtn.disabled = !play || near < 0 || !!p?.walking || !!p?.using;
    useBtn.textContent = p?.using ? `⏳ ${Math.ceil(p.using / 1000)}s ...` : near >= 0 ? `✋ ${STATIONS[near].verb}` : '✋ ERLEDIGEN';
    const hint = q(root, '.sp-hint');
    hint.textContent =
      st.sub === 'intro'
        ? 'Merk dir deinen Gast (gelber Ring)! Auf dem TV sieht dich niemand.'
        : mode === 'aim'
          ? 'Wer benimmt sich verdächtig? Tippe auf den Gast – Fehlwurf verrät dich!'
          : p?.using
            ? 'Nicht weglaufen, sonst zählt es nicht!'
            : p && p.cooldown > 0
              ? `Unauffällig bleiben – der nächste Auftrag zählt erst in ${Math.ceil(p.cooldown / 1000)}s.`
              : near >= 0 && !p?.done[near]
                ? `Hier ist ${STATIONS[near].name} – erledigen!`
                : 'Tippe auf die Karte zum Hinschlendern. Gäste stehen nie lange still!';
  };
  return update;
}
