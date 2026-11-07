// Bus terminals for the map: GeoSampa's `geoportal:terminal_onibus` layer (SPTrans
// urban terminals, EMTU metropolitan terminals and the three coach stations), with
// tidier names and the nearest bicicletário.

const KIND = { URBANO: 'sptrans', EMTU: 'emtu', RODOVIARIO: 'rodoviario' };
const PARKING_RADIUS_M = 200;

// GeoSampa writes the names without accents and with abbreviations.
const WORDS = [
  [/^Term\.\s*/, 'Terminal '], [/^E\.T\.\s*/, 'Estação de Transferência '], [/\bCid\.\s*/g, 'Cidade '],
  [/\bRodoviario\b/g, 'Rodoviário'], [/\bTiete\b/g, 'Tietê'], [/\bJoao\b/g, 'João'], [/\bSao\b/g, 'São'],
  [/\bGrajau\b/g, 'Grajaú'], [/\bSacoma\b/g, 'Sacomã'], [/\bCarrao\b/g, 'Carrão'], [/\bAngela\b/g, 'Ângela'],
  [/\bBritania\b/g, 'Britânia'], [/\bD\. Pedro\b/g, 'Dom Pedro'], [/\bA\. E\. Carvalho\b/g, 'A. E. Carvalho'],
];

/** Display name of a GeoSampa terminal: EMTU ones are only the place name. */
export function terminalName(name, kind) {
  let out = name.trim();
  for (const [re, to] of WORDS) out = out.replace(re, to);
  if (kind === 'emtu' && !/^(Terminal|Estação)/.test(out)) out = `Terminal Metropolitano ${out}`;
  return out.replace(/\s+/g, ' ');
}

function meters([lon1, lat1], [lon2, lat2]) {
  const k = Math.PI / 180, x = (lon2 - lon1) * k * Math.cos(((lat1 + lat2) / 2) * k), y = (lat2 - lat1) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/**
 * GeoJSON features of the terminals in operation: { name, kind: 'sptrans' | 'emtu' |
 * 'rodoviario', address, parking: { name, access, meters } | absent }.
 * `parking`: the features of public/data/bike-parking.geojson.
 */
export function buildTerminals(geoSampaFeatures, parking = []) {
  const lots = parking.filter((f) => f.properties.kind === 'bicicletario');
  const out = [];
  for (const f of geoSampaFeatures) {
    const p = f.properties ?? {};
    const kind = KIND[p.nm_tipo_terminal];
    if (!kind || f.geometry?.type !== 'Point' || !/opera/i.test(p.tx_status_terminal ?? 'em operação')) continue;
    const at = f.geometry.coordinates.map((x) => Math.round(x * 1e6) / 1e6);
    const props = { name: terminalName(p.nm_terminal ?? '', kind), kind };
    // EMTU rows repeat the place name as the address.
    if (p.tx_endereco_terminal && p.tx_endereco_terminal !== p.nm_terminal) props.address = p.tx_endereco_terminal.trim();
    let best = null;
    for (const lot of lots) {
      const d = meters(at, lot.geometry.coordinates);
      if (d <= PARKING_RADIUS_M && (!best || d < best.meters)) best = { name: lot.properties.name ?? 'Bicicletário', access: lot.properties.access, meters: Math.round(d) };
    }
    if (best) props.parking = best;
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: props });
  }
  return out.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'pt'));
}
