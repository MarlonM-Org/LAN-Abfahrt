import type { Socket } from 'socket.io-client';

/**
 * Uhrabgleich mit dem Server (wie NTP, nur simpel):
 * Mehrere Pings, die mit der kürzesten Laufzeit gewinnt.
 * Damit starten TV und Handys z. B. den Rhythmus-Song auf ~10 ms genau gleichzeitig.
 */
let offset = 0; // serverZeit − Date.now()
let bestRtt = Infinity;

export function startTimeSync(socket: Socket) {
  const ping = () => {
    const t0 = Date.now();
    socket.emit('time:ping', t0, (r: { t0: number; server: number }) => {
      const t1 = Date.now();
      const rtt = t1 - r.t0;
      // Neue Messung nur übernehmen, wenn sie mindestens so gut ist (oder die alte veraltet)
      if (rtt <= bestRtt * 1.2) {
        bestRtt = Math.min(bestRtt, rtt);
        offset = r.server - (r.t0 + rtt / 2);
      }
    });
  };
  const burst = () => {
    bestRtt = Infinity;
    for (let i = 0; i < 6; i++) setTimeout(ping, i * 120);
  };
  socket.on('connect', burst);
  if (socket.connected) burst();
  setInterval(burst, 15000);
}

/** Aktuelle Serverzeit in ms */
export const serverNow = () => Date.now() + offset;

/** Wandelt einen Server-Zeitpunkt in performance.now()-Zeit um */
export const toLocalPerf = (serverMs: number) => performance.now() + (serverMs - serverNow());
