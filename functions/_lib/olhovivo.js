// The Olho Vivo /Posicao snapshot (every SPTrans bus on the road), shared by
// /api/buses and /api/low-floor.
//
// SPTrans blocks requests from Cloudflare, so in production the snapshot comes through
// the relay on Cloud Run (relay/), configured with OLHOVIVO_RELAY_URL and
// OLHOVIVO_RELAY_KEY. Without them (local dev) it calls Olho Vivo directly with the
// SPTRANS_TOKEN secret (free key from https://www.sptrans.com.br/desenvolvedores/).

const API = 'https://api.olhovivo.sptrans.com.br/v2.1';

// The session cookie survives between requests served by the same isolate.
let credentials = null;

async function login(token) {
  const res = await fetch(`${API}/Login/Autenticar?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Length': '0' },
  });
  const body = (await res.text()).trim();
  const cookie = res.headers.get('set-cookie')?.match(/apiCredentials=[^;]+/)?.[0];
  if (!res.ok || body !== 'true' || !cookie) {
    // Say what came back: `false` means a rejected token; HTML means we were blocked.
    throw new Error(`Olho Vivo login failed: HTTP ${res.status}, ${body.slice(0, 60) || 'empty body'}${cookie ? '' : ', no cookie'}`);
  }
  credentials = cookie;
}

async function get(path, token) {
  if (!credentials) await login(token);
  let res = await fetch(`${API}${path}`, { headers: { Cookie: credentials } });
  if (res.status === 401) {
    await login(token);
    res = await fetch(`${API}${path}`, { headers: { Cookie: credentials } });
  }
  if (!res.ok) throw new Error(`Olho Vivo ${path}: HTTP ${res.status}`);
  return res.json();
}

async function viaRelay(url, key) {
  const res = await fetch(`${url.replace(/\/$/, '')}/posicao`, { headers: { 'X-Relay-Key': key } });
  if (!res.ok) throw new Error(`relay: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

/** Why the snapshot can't be fetched with this `env`, or null when it can. */
export function missingConfig(env) {
  return (env.OLHOVIVO_RELAY_URL && env.OLHOVIVO_RELAY_KEY) || env.SPTRANS_TOKEN
    ? null
    : 'OLHOVIVO_RELAY_URL/KEY ou SPTRANS_TOKEN não configurados';
}

/** The raw /Posicao JSON: { hr, l: [{ c, sl, lt0, lt1, vs: [{ p, py, px, ta, a }] }] }. */
export function positions(env) {
  const { SPTRANS_TOKEN: token, OLHOVIVO_RELAY_URL: relayUrl, OLHOVIVO_RELAY_KEY: relayKey } = env;
  return relayUrl && relayKey ? viaRelay(relayUrl, relayKey) : get('/Posicao', token);
}
