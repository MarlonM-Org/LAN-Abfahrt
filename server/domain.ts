import acme from 'acme-client';
import { X509Certificate } from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Eigene Domain für HTTPS im Heimnetz (Bewegungssensor auf iPhones).
 *
 * Aufbau:  lan-party.ma-und-ma.de  ──CNAME──▶  <name>.dedyn.io  (bei deSEC, A-Record = Laptop-IP)
 *          _acme-challenge.lan-party…  ──CNAME──▶  _acme-challenge.<name>.dedyn.io  (TXT für Let's Encrypt)
 *
 * Beim Start: A-Record auf die aktuelle Laptop-IP setzen und – falls nötig – ein
 * Let's-Encrypt-Zertifikat für PUBLIC_DOMAIN holen bzw. erneuern (DNS-01 über die deSEC-API).
 */

const API = 'https://desec.io/api/v1';
const RENEW_DAYS = 30;

export interface DomainConfig {
  token: string;
  /** Zone bei deSEC, z. B. lan-abfahrt.dedyn.io */
  zone: string;
  /** Name, unter dem die Handys verbinden, z. B. lan-party.ma-und-ma.de */
  domain: string;
  email?: string;
  staging: boolean;
  certFile: string;
  keyFile: string;
  accountFile: string;
}

export function domainConfigFromEnv(root: string): DomainConfig | null {
  const token = process.env.DESEC_TOKEN;
  const zone = process.env.DESEC_ZONE;
  if (!token || !zone) return null;
  return {
    token,
    zone,
    domain: process.env.PUBLIC_DOMAIN ?? zone,
    email: process.env.ACME_EMAIL,
    staging: process.env.ACME_STAGING === '1',
    certFile: path.resolve(root, process.env.TLS_CERT ?? 'certs/fullchain.pem'),
    keyFile: path.resolve(root, process.env.TLS_KEY ?? 'certs/privkey.pem'),
    accountFile: path.resolve(root, 'certs/acme-account.pem'),
  };
}

// ------------------------------------------------------------------ deSEC

async function desec(cfg: DomainConfig, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Token ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`deSEC ${method} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function minimumTtl(cfg: DomainConfig): Promise<number> {
  try {
    const d = await desec(cfg, 'GET', `${API}/domains/${cfg.zone}/`);
    return Math.max(60, Number(d?.minimum_ttl) || 3600);
  } catch {
    return 3600;
  }
}

/**
 * Legt einen Eintrag an oder ändert ihn (leere `records` = löschen).
 * PUT auf einen einzelnen Eintrag geht bei deSEC nur, wenn es ihn schon gibt –
 * der Sammel-PATCH auf /rrsets/ legt ihn bei Bedarf neu an.
 */
async function putRecord(cfg: DomainConfig, subname: string, type: string, records: string[], ttl: number) {
  await desec(cfg, 'PATCH', `${API}/domains/${cfg.zone}/rrsets/`, [{ subname, type, ttl, records }]);
}

/** Setzt den A-Record der deSEC-Zone auf die Laptop-IP. */
export async function updateAddress(cfg: DomainConfig, ip: string): Promise<void> {
  // 1. Versuch: dynDNS-Schnittstelle (setzt automatisch eine kurze TTL von 60 s)
  try {
    const res = await fetch(
      `https://update.dedyn.io/?hostname=${encodeURIComponent(cfg.zone)}&myipv4=${ip}&myipv6=preserve`,
      { headers: { Authorization: `Token ${cfg.token}` }, signal: AbortSignal.timeout(15000) },
    );
    const text = (await res.text()).trim();
    if (res.ok && /^(good|nochg)/.test(text)) return;
    console.warn(`  deSEC dynDNS: ${res.status} ${text} – versuche REST-API`);
  } catch (e) {
    console.warn(`  deSEC dynDNS nicht erreichbar (${(e as Error).message}) – versuche REST-API`);
  }
  // 2. Versuch: normale REST-API
  await putRecord(cfg, '', 'A', [ip], await minimumTtl(cfg));
}

// ------------------------------------------------------------------ Let's Encrypt

/** Tage bis zum Ablauf des vorhandenen Zertifikats (oder null, wenn keins/passt nicht). */
function certDaysLeft(cfg: DomainConfig): number | null {
  try {
    const cert = new X509Certificate(fs.readFileSync(cfg.certFile));
    if (!cert.checkHost(cfg.domain)) return null;
    return (new Date(cert.validTo).getTime() - Date.now()) / 86_400_000;
  } catch {
    return null;
  }
}

/** Wartet, bis der autoritative deSEC-Nameserver den TXT-Eintrag ausliefert. */
async function waitForTxt(name: string, value: string): Promise<void> {
  // Jeden deSEC-Nameserver einzeln fragen: Let's Encrypt prüft von mehreren
  // Standorten aus und erwischt sonst einen Server, der den Eintrag noch nicht hat.
  const servers: string[] = [];
  for (const host of ['ns1.desec.io', 'ns2.desec.org']) {
    try {
      servers.push((await dns.lookup(host, { family: 4 })).address);
    } catch {
      /* nicht auflösbar – überspringen */
    }
  }
  const has = async (server?: string) => {
    const r = new dns.Resolver();
    if (server) r.setServers([server]);
    try {
      return (await r.resolveTxt(name)).some((parts) => parts.join('') === value);
    } catch {
      return false;
    }
  };
  const until = Date.now() + 240_000;
  let ok = false;
  while (Date.now() < until) {
    const results = servers.length ? await Promise.all(servers.map((s) => has(s))) : [await has()];
    if (results.every(Boolean)) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ok) console.warn('  TXT-Eintrag nach 4 Minuten nicht überall sichtbar – versuche es trotzdem.');
  // deSEC verteilt Einträge an viele Standorte weltweit – kurz Puffer geben
  console.log('  … warte 30 s, bis der Eintrag überall angekommen ist');
  await new Promise((r) => setTimeout(r, 30_000));
}

export async function ensureCertificate(cfg: DomainConfig, force = false): Promise<'ok' | 'issued'> {
  const left = certDaysLeft(cfg);
  if (!force && left !== null && left > RENEW_DAYS) return 'ok';

  console.log(`  🔐 Hole Zertifikat für ${cfg.domain}${cfg.staging ? ' (Let’s Encrypt Staging)' : ''} …`);
  fs.mkdirSync(path.dirname(cfg.certFile), { recursive: true });
  fs.mkdirSync(path.dirname(cfg.accountFile), { recursive: true });

  let accountKey: Buffer;
  if (fs.existsSync(cfg.accountFile)) {
    accountKey = fs.readFileSync(cfg.accountFile);
  } else {
    accountKey = await acme.crypto.createPrivateKey();
    fs.writeFileSync(cfg.accountFile, accountKey, { mode: 0o600 });
  }

  const client = new acme.Client({
    directoryUrl: cfg.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey,
  });
  const [key, csr] = await acme.crypto.createCsr({ commonName: cfg.domain, altNames: [cfg.domain] });
  const ttl = await minimumTtl(cfg);
  const txtName = `_acme-challenge.${cfg.zone}`;

  const cert = await client.auto({
    csr,
    email: cfg.email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    // Prüfung läuft gegen die deSEC-Nameserver (waitForTxt) – der lokale Resolver
    // würde die CNAME-Kette ggf. aus dem Cache beantworten.
    skipChallengeVerification: true,
    challengeCreateFn: async (_authz, _challenge, keyAuthorization) => {
      await putRecord(cfg, '_acme-challenge', 'TXT', [`"${keyAuthorization}"`], ttl);
      await waitForTxt(txtName, keyAuthorization);
    },
    challengeRemoveFn: async () => {
      await putRecord(cfg, '_acme-challenge', 'TXT', [], ttl).catch(() => {});
    },
  });

  fs.writeFileSync(cfg.keyFile, key, { mode: 0o600 });
  fs.writeFileSync(cfg.certFile, cert);
  console.log(`  ✅ Zertifikat gespeichert (${path.relative(process.cwd(), cfg.certFile)})`);
  return 'issued';
}

/** Alles für den Serverstart: IP eintragen, Zertifikat sicherstellen. Fehler sind nicht fatal. */
export async function prepareDomain(cfg: DomainConfig, ip: string): Promise<void> {
  try {
    await updateAddress(cfg, ip);
    console.log(`  🌐 ${cfg.zone} → ${ip}`);
  } catch (e) {
    console.warn(`  ⚠️  IP konnte nicht bei deSEC eingetragen werden: ${(e as Error).message}`);
  }
  try {
    await ensureCertificate(cfg);
  } catch (e) {
    console.warn(`  ⚠️  Zertifikat konnte nicht geholt werden: ${(e as Error).message}`);
  }
}
