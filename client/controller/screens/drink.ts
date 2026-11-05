import type { BombState, HiloState, NhieState } from '../../../shared/types';
import { cardLabel } from '../../../shared/games';
import { type Screen, app, el, escapeHtml, message, nameOf, q, send, store, tapButton, timerText } from '../core';

const sipText = (n: number) => (n === 1 ? '1 Schluck' : `${n} Schlücke`);

// ------------------------------------------------------------------ Ich hab noch nie

export function pickNhie(s: NhieState): Screen {
  const id = store.playerId!;
  if (!(id in s.sips)) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'question') {
    if (s.answered.includes(id)) return [`nh-wait-${s.round}`, message('Antwort gespeichert', 'Warte auf die anderen ...')];
    return [`nh-q-${s.round}`, () => {
      const root = el(`
        <p>Runde ${s.round}/${s.rounds}<span class="timer"></span></p>
        <h2>Ich hab noch nie ${escapeHtml(s.statement.replace(/^\.\.\.\s*/, ''))}</h2>
        <button class="big-btn half drink-btn" data-v="1">Hab ich schon!</button>
        <button class="big-btn half secondary" data-v="0">Noch nie!</button>
      `);
      let sent = false;
      root.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
        b.addEventListener('click', () => {
          if (sent) return;
          sent = true;
          send('answer', { have: b.dataset.v === '1' });
        }),
      );
      app.append(root);
      return () => (q(root, '.timer').textContent = timerText((sec) => ` · ${sec}s`));
    }];
  }
  if (s.sub === 'reveal') {
    const have = s.have ?? [];
    const mine = have.includes(id);
    const sips = mine ? (have.length === 1 ? 2 : 1) : 0;
    return [`nh-r-${s.round}`, message(mine ? `Trink ${sipText(sips)}!` : 'Glück gehabt!', have.length === 1 ? `Nur ${nameOf(have[0])} – erzähl!` : `${have.length} haben es schon getan.`)];
  }
  return ['nh-over', message('Runde vorbei')];
}

// ------------------------------------------------------------------ Höher oder Tiefer

export function pickHilo(s: HiloState): Screen {
  const id = store.playerId!;
  if (!(id in s.sips)) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'guess') {
    if (s.guessed.includes(id)) return [`hl-wait-${s.round}`, message('Getippt!', 'Warte auf die anderen ...')];
    return [`hl-g-${s.round}`, () => {
      const root = el(`
        <p>Karte ${s.round}/${s.rounds}<span class="timer"></span></p>
        <div class="card-big">${cardLabel(s.card)}</div>
        <p>Ist die nächste Karte höher oder tiefer?</p>
        <button class="big-btn half drink-btn" data-d="higher">HÖHER ▲</button>
        <button class="big-btn half" data-d="lower">TIEFER ▼</button>
      `);
      let sent = false;
      root.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) =>
        tapButton(b, () => {
          if (sent) return;
          sent = true;
          send('guess', { dir: b.dataset.d });
        }),
      );
      app.append(root);
      return () => (q(root, '.timer').textContent = timerText((sec) => ` · ${sec}s`));
    }];
  }
  if (s.sub === 'reveal') {
    const n = s.roundSips?.[id] ?? 0;
    const same = s.nextCard === s.card;
    return [`hl-r-${s.round}`, message(n ? `Trink ${sipText(n)}!` : 'Richtig!', `${cardLabel(s.card)} → ${cardLabel(s.nextCard ?? 0)}${same ? ' – gleich! Alle trinken.' : ''}`)];
  }
  return ['hl-over', message('Runde vorbei')];
}

// ------------------------------------------------------------------ Tick-Tack-Bumm

export function pickBomb(s: BombState): Screen {
  const id = store.playerId!;
  if (!(id in s.sips)) return ['spectate', message('Du schaust zu')];
  if (s.sub === 'boom') return [`bo-boom-${s.round}`, message('BUMM!', s.holder === id ? 'Erwischt – trink 3 Schlücke!' : `${nameOf(s.holder)} trinkt 3 Schlücke.`)];
  if (s.sub === 'over') return ['bo-over', message('Runde vorbei')];
  if (s.holder === id) {
    return [`bo-hold-${s.passSeq}`, () => {
      const root = el(`
        <p>Kategorie</p>
        <h1>${escapeHtml(s.category)}</h1>
        <p>Sag laut einen Begriff – dann schnell weitergeben!</p>
        <button class="big-btn boom">WEITERGEBEN!</button>
      `);
      const btn = q<HTMLButtonElement>(root, '.big-btn');
      let sent = false;
      tapButton(btn, () => {
        if (sent) return;
        sent = true;
        send('pass');
        navigator.vibrate?.(30);
      });
      app.append(root);
      navigator.vibrate?.([60, 40, 60]);
      return null;
    }];
  }
  return [`bo-watch-${s.passSeq}`, message(`${nameOf(s.holder)} hat die Bombe!`, `Kategorie: ${s.category}`)];
}
