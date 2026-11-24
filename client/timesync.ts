import type { Socket } from 'socket.io-client';
import { Uhrabgleich } from '../shared/zeitabgleich';

/**
 * Uhrabgleich mit dem Server (wie NTP, nur simpel) – die Schätzung selbst steht in `shared/zeitabgleich.ts`:
 * gleitendes Fenster, schnellste Messungen, Median, sanftes Nachführen. Gemessen wird gegen `performance.now()`
 * (monoton, springt nicht wie `Date.now()` bei einer Uhrkorrektur des Geräts).
 * Damit starten TV und Handys z. B. den Song im Gespräch oder bei der Strand-Band auf wenige ms genau gleichzeitig.
 */
const uhr = new Uhrabgleich();

export function startTimeSync(socket: Socket) {
  const ping = () => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.emit('time:ping', t0, (r: { t0: number; server: number }) => {
      // Antwort auf einen anderen Ping (z. B. nach Neuverbindung) passt nicht zu t0 → verwerfen
      if (!r || r.t0 !== t0) return;
      uhr.probe(t0, r.server, performance.now());
    });
  };
  // Nach dem Verbinden schnell ein paar Messungen, danach eine alle 2 s (das Fenster hält ≈ 1 min)
  const burst = () => {
    for (let i = 0; i < 8; i++) setTimeout(ping, i * 150);
  };
  socket.on('connect', burst);
  if (socket.connected) burst();
  setInterval(ping, 2000);
}

/** Beste gemessene Laufzeit hin und zurück (ms) – für die Vorhersage am Handy */
export const rttMs = () => {
  const r = uhr.bestRtt();
  return Number.isFinite(r) ? r : 40;
};

/** Aktuelle Serverzeit in ms */
export const serverNow = () => {
  const now = performance.now();
  return now + uhr.offset(now);
};

/** Wandelt einen performance.now()-Zeitpunkt (z. B. `event.timeStamp`) in Serverzeit um */
export const toServerMs = (perf: number) => perf + uhr.offset(performance.now());

/** Wandelt einen Server-Zeitpunkt in performance.now()-Zeit um */
export const toLocalPerf = (serverMs: number) => serverMs - uhr.offset(performance.now());
