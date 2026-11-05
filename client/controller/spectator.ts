/**
 * Zuschauer-Baustein fürs Handy: `spectatorBar(root)` hängt an jeden Zuschauer-/Warte-Screen
 *
 * - **Live-Stand** aus dem Snapshot: wer lebt noch (Avatare, grau = raus) bzw. Teamstand oder Punkte-Spitze
 * - **Wetten** (Elimination-Spiele mit `spectator` im Snapshot): Wer raus ist, tippt einen Lebenden an
 *   (`mini:input` Action `bet`, einmal pro Runde) – richtig = +1 Punkt
 * - **Emote-Leiste** 😂 😱 👏 🍅 (Event `emote`, 2 s Abklingzeit) – schwebt auf dem TV über dem Porträt
 *
 * Screens mit `spectate`/`watch`/`dead`/`out`/`over` im Screen-Key bekommen die Leiste automatisch
 * (`attachSpectator()` in `main.ts`); eigene Zuschauer-Screens (Arena-/Sumo-Geister) bauen sie selbst ein.
 */
import type { GameState, Team } from '../../shared/types';
import { EMOTES, SPECTATOR, type SpectatorInfo } from '../../shared/spectator';
import { TEAM_INFO } from '../../shared/flunky';
import { avatarCanvas, el, escapeHtml, nameOf, q, send, socket, store, tapButton } from './core';
import { haptic } from './haptic';

/** Screen-Keys, die als Zuschauer-/Warte-Screen gelten */
const SPECTATOR_KEY = /(^|-)(spectate|watch|dead|out|over)(-|$)/;
/** Ausnahmen: Igel hat eine eigene Zuschauer-Karte (eigener Bereich) */
const SKIP_KEY = /^ig-/;

let emoteReadyAt = 0;

/** Was das laufende Spiel über „wer lebt noch“ bzw. den Stand verrät */
type Stand =
  | { kind: 'alive'; ids: string[]; alive: Set<string>; spec: SpectatorInfo | null }
  | { kind: 'teams'; teams: { team: Team; score: number }[] }
  | { kind: 'points'; top: { id: string; pts: number }[] }
  | null;

function readStand(s: GameState | null): Stand {
  const st = s?.phase === 'mini' ? (s.mini?.state as unknown as Record<string, unknown> | undefined) : undefined;
  if (!st) return null;
  const spec = (st.spectator as SpectatorInfo | undefined) ?? null;
  const known = new Set(s!.players.map((p) => p.id));
  if (spec) {
    const ids = (s!.inGame ?? Object.keys((st.players ?? st.fighters ?? {}) as object)).filter((id) => known.has(id));
    return { kind: 'alive', ids, alive: new Set(spec.alive), spec };
  }
  // players: { id: { alive } } (Arena, Sumo, Zauber, Wackel …)
  const players = st.players;
  if (players && typeof players === 'object' && !Array.isArray(players)) {
    const entries = Object.entries(players as Record<string, unknown>).filter(([id, p]) => known.has(id) && p && typeof p === 'object' && 'alive' in (p as object));
    if (entries.length >= 2) return { kind: 'alive', ids: entries.map(([id]) => id), alive: new Set(entries.filter(([, p]) => (p as { alive: boolean }).alive).map(([id]) => id)), spec: null };
  }
  // alive: { id: boolean } (Werwolf)
  const alive = st.alive;
  if (alive && typeof alive === 'object' && !Array.isArray(alive)) {
    const entries = Object.entries(alive as Record<string, unknown>).filter(([id, v]) => known.has(id) && typeof v === 'boolean');
    if (entries.length >= 2) return { kind: 'alive', ids: entries.map(([id]) => id), alive: new Set(entries.filter(([, v]) => v).map(([id]) => id)), spec: null };
  }
  // Teamstand: score { A, B } (Volleyball, Autoball …)
  const score = st.score as Record<string, unknown> | undefined;
  if (score && typeof score === 'object' && typeof score.A === 'number' && typeof score.B === 'number') {
    return { kind: 'teams', teams: (['A', 'B'] as Team[]).map((team) => ({ team, score: score[team] as number })) };
  }
  // Punkte pro Spieler (points/scores) → die Spitze
  for (const k of ['points', 'scores']) {
    const rec = st[k] as Record<string, unknown> | undefined;
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    const top = Object.entries(rec)
      .filter(([id, v]) => known.has(id) && typeof v === 'number')
      .map(([id, v]) => ({ id, pts: v as number }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 3);
    if (top.length >= 2) return { kind: 'points', top };
  }
  return null;
}

/**
 * Zuschauer-Leiste in `root` einhängen (Live-Stand + Wetten + Emotes). Liefert den Updater,
 * den der Screen bei jedem Zustand aufruft (baut nur bei geänderter Spielerliste neu).
 */
export function spectatorBar(root: HTMLElement): () => void {
  const bar = el(`
    <div class="spec-bar">
      <div class="spec-stand"><p class="spec-title"></p><div class="spec-avs"></div></div>
      <div class="spec-emotes">${EMOTES.map((e, i) => `<button class="spec-emote" data-i="${i}" aria-label="Emote ${e}">${e}</button>`).join('')}</div>
    </div>
  `).firstElementChild as HTMLElement;
  root.append(bar);
  const title = q(bar, '.spec-title');
  const avs = q(bar, '.spec-avs');
  const standBox = q(bar, '.spec-stand');
  const emoteBtns = [...bar.querySelectorAll<HTMLButtonElement>('.spec-emote')];
  for (const b of emoteBtns) {
    tapButton(b, () => {
      if (performance.now() < emoteReadyAt) return;
      emoteReadyAt = performance.now() + SPECTATOR.EMOTE_COOLDOWN_MS;
      socket.emit('emote', Number(b.dataset.i));
      haptic('tap');
      b.classList.add('sent');
      setTimeout(() => b.classList.remove('sent'), 300);
      sync();
    });
  }
  const sync = () => {
    const cooling = performance.now() < emoteReadyAt;
    bar.classList.toggle('cooling', cooling);
    for (const b of emoteBtns) b.disabled = cooling;
  };

  let avKey = '';
  const avBtns = new Map<string, HTMLButtonElement>();
  let seenFx = -1;

  return () => {
    sync();
    const s = store.state;
    const stand = readStand(s);
    const myId = store.playerId!;
    standBox.classList.toggle('off', !stand);
    if (!stand) return;
    if (stand.kind === 'teams') {
      avKey = '';
      title.textContent = 'Spielstand';
      avs.innerHTML = stand.teams.map((t) => `<span class="spec-team" style="--team:${TEAM_INFO[t.team].color}">${escapeHtml(TEAM_INFO[t.team].name)} <b>${t.score}</b></span>`).join('');
      return;
    }
    if (stand.kind === 'points') {
      avKey = '';
      title.textContent = 'Vorn liegen';
      avs.innerHTML = stand.top.map((t, i) => `<span class="spec-pts">${i + 1}. ${escapeHtml(nameOf(t.id))} <b>${t.pts}</b></span>`).join('');
      return;
    }
    // Avatare: einmal pro Spielerliste bauen, danach nur Klassen umschalten (Taps bleiben erhalten)
    const key = stand.ids.join(',');
    if (key !== avKey) {
      avKey = key;
      avs.innerHTML = '';
      avBtns.clear();
      for (const id of stand.ids) {
        const p = s!.players.find((x) => x.id === id);
        const b = document.createElement('button');
        b.className = 'spec-av';
        b.append(avatarCanvas(1, p?.look));
        const n = document.createElement('span');
        n.textContent = p?.name ?? '?';
        b.append(n);
        tapButton(b, () => {
          const cur = readStand(store.state);
          if (cur?.kind !== 'alive' || !canBet(cur.spec, myId) || !cur.alive.has(id)) return;
          send('bet', { on: id });
          haptic('tap');
          b.classList.add('pick');
        });
        avs.append(b);
        avBtns.set(id, b);
      }
    }
    const spec = stand.spec;
    const myBet = spec?.bets[myId];
    const betting = canBet(spec, myId);
    for (const [id, b] of avBtns) {
      b.classList.toggle('out', !stand.alive.has(id));
      b.classList.toggle('me', id === myId);
      b.classList.toggle('pick', myBet === id);
      b.classList.toggle('win', !!spec?.roundWinner && spec.roundWinner === id);
      b.disabled = !(betting && stand.alive.has(id) && id !== myId);
    }
    bar.classList.toggle('betting', betting);
    const n = stand.alive.size;
    let t = `${n} von ${stand.ids.length} noch dabei`;
    if (spec) {
      const won = spec.roundWinner;
      const bonus = spec.bonus[myId] ?? 0;
      if (won !== undefined && myBet) t = won === myBet ? 'Richtig getippt! +1 🎲' : `Daneben – ${won ? `${nameOf(won)} gewinnt` : 'Unentschieden'}`;
      else if (myBet) t = `Dein Tipp: ${nameOf(myBet)} 🎲`;
      else if (betting) t = '🎲 Wer gewinnt die Runde? Tippe!';
      if (bonus && !(won !== undefined && myBet)) t += ` · Bonus +${bonus}`;
      // Treffer frisch aufgelöst → kurz jubeln
      const fx = spec.fx[spec.fx.length - 1];
      if (fx && seenFx >= 0 && fx.seq > seenFx && fx.ids.includes(myId)) haptic('win');
      seenFx = fx?.seq ?? 0;
    }
    title.textContent = t;
  };
}

/** Darf ich gerade wetten? (mitgespielt, raus, Runde läuft, noch kein Tipp) */
function canBet(spec: SpectatorInfo | null, myId: string) {
  if (!spec || !spec.open || spec.bets[myId]) return false;
  const inGame = store.state?.inGame;
  return !spec.alive.includes(myId) && (!inGame || inGame.includes(myId));
}

/**
 * Für `main.ts`: Zuschauer-/Warte-Screens (Key mit spectate/watch/dead/out/over) bekommen die Leiste,
 * sofern der Screen sie nicht schon selbst eingebaut hat. Liefert den (ggf. erweiterten) Updater.
 */
export function attachSpectator(app: HTMLElement, key: string, updater: (() => void) | null): (() => void) | null {
  if (store.state?.phase !== 'mini' || !SPECTATOR_KEY.test(key) || SKIP_KEY.test(key)) return updater;
  if (app.querySelector('.spec-bar')) return updater;
  const host = app.querySelector<HTMLElement>('.lx-mid') ?? app;
  const bar = spectatorBar(host);
  return () => {
    updater?.();
    bar();
  };
}
