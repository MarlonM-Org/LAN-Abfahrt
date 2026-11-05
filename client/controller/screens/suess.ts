import { SUESS, type SuessState, roomNameAt, suessSpeedFactor } from '../../../shared/suess';
import { candySprite } from '../../art/suess';
import { type Screen, app, el, message, nameOf, q, send, store, tapButton } from '../core';
import { stickZone } from '../stick';

const cur = () => (store.state?.mini?.kind === 'suess' ? store.state.mini.state : null);

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function pickSuess(s: SuessState): Screen {
  const id = store.playerId!;
  const thief = s.thieves[id];
  const guard = s.guards[id];
  if (!thief && !guard) return ['spectate', message('Du schaust zu', 'Süßigkeiten-Klau läuft – schau auf den Fernseher!')];
  if (s.sub === 'over') return ['su-over', message('Süßigkeiten-Klau vorbei!', 'Schau auf den Fernseher!')];
  if (s.sub === 'roundEnd' && s.outcome) {
    const o = s.outcome;
    const won = (o.winner === 'thieves') === !!thief;
    const title = won ? (thief ? 'Geschafft – die Beute ist sicher!' : 'Bewacht! Die Minibar ist gerettet!') : thief ? 'Die Wächter waren zu schnell ...' : 'Die Naschkatzen waren schneller ...';
    const st = s.stats[id];
    const mine = thief ? `Du hast insgesamt ${st?.delivered ?? 0} Süßes abgeliefert.` : `Du hast insgesamt ${st?.catches ?? 0}x geschnappt.`;
    return [`su-end-${s.round}`, message(title, `${o.total}/${o.target} im Versteck. ${mine}${s.round < s.rounds ? ' Gleich: neue Wächter!' : ''}`)];
  }
  return thief ? [`su-thief-${s.round}`, buildThief] : [`su-guard-${s.round}`, buildGuard];
}

function progress(root: HTMLElement, s: SuessState) {
  const frac = Math.min(1, s.total / Math.max(1, s.target));
  q(root, '.su-bar i').style.width = `${Math.round(frac * 100)}%`;
  q(root, '.su-bar span').textContent = `${s.total} / ${s.target} im Versteck`;
  q(root, '.su-time').textContent = s.sub === 'intro' ? `Start in ${Math.ceil(s.endsIn / 1000)}` : clock(s.endsIn);
  q(root, '.su-round').textContent = `Runde ${s.round}/${s.rounds}`;
}

// ------------------------------------------------------------------ Naschkatze

let iconCache: string | null = null;
function candyIcon() {
  if (!iconCache) {
    const p = candySprite(0, 0);
    iconCache = p.canvas.toDataURL();
  }
  return iconCache;
}

function buildThief() {
  // Querlayout: Kopf (Rolle · Zeit · Runde) · links Stick · Mitte Beute/Hinweis · rechts ABLEGEN
  const root = el(`
    <div class="lx su-lx">
      <div class="lx-head"><span class="lx-tag su-tag thief">NASCHKATZE</span><span class="timer su-time"></span><span class="su-round grow"></span></div>
      <div class="lx-left su-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
      <div class="lx-mid">
        <div class="su-bar"><i></i><span></span></div>
        <div class="su-carry">
          <img class="su-icon" alt="" />
          <b class="su-count">0</b>
          <div class="su-carry-txt"><small class="su-load"></small><div class="su-speed"><i></i></div></div>
        </div>
        <p class="su-hint"></p>
      </div>
      <div class="lx-right">
        <button class="big-btn su-drop">ABLEGEN<small>alles fallen lassen</small></button>
      </div>
    </div>
  `);
  q<HTMLImageElement>(root, '.su-icon').src = candyIcon();
  stickZone(q(root, '.su-stick'), (x, y) => send('stick', { x, y }));
  const drop = q<HTMLButtonElement>(root, '.su-drop');
  tapButton(drop, () => {
    if (drop.disabled) return;
    send('drop');
    navigator.vibrate?.(30);
  });
  app.append(root);
  let lastCarry = 0;
  let lastState = 'run';
  let lastDanger = false;
  return () => {
    const s = cur();
    const me = s?.thieves[store.playerId!];
    if (!s || !me) return;
    progress(root, s);
    q(root, '.su-count').textContent = String(me.carry);
    const f = suessSpeedFactor(me.carry);
    q(root, '.su-speed i').style.width = `${Math.round(f * 100)}%`;
    q(root, '.su-speed').classList.toggle('slow', f < 0.65);
    q(root, '.su-load').textContent = me.carry >= SUESS.CARRY_MAX ? 'Taschen voll!' : me.carry > 0 ? `Tempo ${Math.round(f * 100)} %` : 'Taschen leer – volles Tempo';
    // nächster Wächter
    let near = Infinity;
    for (const g of Object.values(s.guards)) near = Math.min(near, Math.hypot(g.x - me.x, g.y - me.y));
    const danger = s.sub === 'play' && me.state === 'run' && !me.safe && near < 45;
    let hint: string;
    if (s.sub === 'intro') hint = `Wächter: ${Object.keys(s.guards).map((id) => nameOf(id)).join(' & ')}. Sammelt Süßes und bringt es ins Versteck (Kissenburg oder Zelt)!`;
    else if (me.state === 'out') hint = `Geschnappt! Gleich bist du wieder im Versteck ... ${Math.ceil(me.respawnIn / 1000)}`;
    else if (me.safe) hint = me.carry > 0 ? 'Im Versteck – abgeliefert!' : 'Im Versteck bist du sicher. Raus und naschen!';
    else if (danger) hint = me.carry > 0 ? 'ACHTUNG, Wächter! Ablegen = schneller weg!' : 'ACHTUNG, Wächter in der Nähe!';
    else if (me.carry >= 8) hint = 'Schwer beladen – ab ins Versteck!';
    else hint = `Du bist im ${roomNameAt(me.x, me.y)}. Minibar (Wohnzimmer) und Kühlschrank (Küche) haben die dicksten Sachen!`;
    q(root, '.su-hint').textContent = hint;
    q(root, '.su-hint').classList.toggle('su-alarm', danger);
    q(root, '.su-lx').classList.toggle('su-out', me.state === 'out');
    drop.disabled = s.sub !== 'play' || me.carry <= 0 || me.state !== 'run';
    if (me.state === 'out' && lastState !== 'out') navigator.vibrate?.([80, 40, 80]);
    if (danger && !lastDanger) navigator.vibrate?.(25);
    if (me.carry > lastCarry) navigator.vibrate?.(8);
    lastCarry = me.carry;
    lastState = me.state;
    lastDanger = danger;
  };
}

// ------------------------------------------------------------------ Wächter

function buildGuard() {
  const root = el(`
    <div class="lx su-lx">
      <div class="lx-head"><span class="lx-tag su-tag guard">WÄCHTER</span><span class="timer su-time"></span><span class="su-round grow"></span></div>
      <div class="lx-left su-stick"><span class="st-label">LAUFEN · Daumen irgendwo aufsetzen</span></div>
      <div class="lx-mid">
        <div class="su-bar"><i></i><span></span></div>
        <div class="su-target"><b></b><small></small></div>
        <p class="su-hint"></p>
      </div>
      <div class="lx-right">
        <button class="big-btn su-sprint">SPRINT<small>kurzer Spurt</small></button>
      </div>
    </div>
  `);
  stickZone(q(root, '.su-stick'), (x, y) => send('stick', { x, y }));
  const sprint = q<HTMLButtonElement>(root, '.su-sprint');
  tapButton(sprint, () => {
    if (sprint.disabled) return;
    send('sprint');
    navigator.vibrate?.(20);
  });
  app.append(root);
  let lastCatches = 0;
  return () => {
    const s = cur();
    const me = s?.guards[store.playerId!];
    if (!s || !me) return;
    progress(root, s);
    // dickste Beute auf der Karte
    const fat = Object.entries(s.thieves)
      .filter(([, t]) => t.state === 'run' && !t.safe && t.carry > 0)
      .sort((a, b) => b[1].carry - a[1].carry)[0];
    q(root, '.su-target b').textContent = fat ? `${nameOf(fat[0]).slice(0, 12)}: ${fat[1].carry}` : '–';
    q(root, '.su-target small').textContent = fat ? `trägt am meisten (${roomNameAt(fat[1].x, fat[1].y)})` : 'Gerade trägt niemand Beute herum.';
    const left = s.target - s.total;
    q(root, '.su-hint').textContent =
      s.sub === 'intro'
        ? 'Fang die Naschkatzen, bevor sie genug ins Versteck bringen! Ins Versteck selbst kommst du nicht.'
        : `Noch ${left} bis die Naschkatzen gewinnen – halte durch! Wer geschnappt wird, verliert seine ganze Beute.`;
    sprint.disabled = s.sub !== 'play' || me.sprintLeft > 0;
    sprint.innerHTML = me.sprinting ? 'SPRINT!' : me.sprintLeft > 0 ? `SPRINT<br/><small>${Math.ceil(me.sprintLeft / 1000)}s</small>` : 'SPRINT';
    const catches = s.stats[store.playerId!]?.catches ?? 0;
    if (catches > lastCatches) navigator.vibrate?.([40, 30, 40]);
    lastCatches = catches;
  };
}
