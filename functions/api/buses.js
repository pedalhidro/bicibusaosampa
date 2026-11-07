// GET /api/buses — live positions of the buses with a bike rack, from SPTrans Olho Vivo.
// Buses are picked by prefix from the fleet list (data/bike-fleet.json), wherever they run.
// How the snapshot is fetched (relay or direct): functions/_lib/olhovivo.js.

import { cachedJson } from '../_lib/cache.js';
import { missingConfig, positions } from '../_lib/olhovivo.js';
import { vehicleFilter } from '../_lib/vehicles.js';
// Plain JSON imports: the Pages build's bundler doesn't accept import attributes.
import fleet from '../../data/bike-fleet.json';
import config from '../../public/data/bike-buses.json';

const TTL = 20; // Olho Vivo refreshes positions every ~30–60 s.

const selectVehicles = vehicleFilter(config, fleet.prefixes);

export async function onRequestGet(context) {
  const missing = missingConfig(context.env);
  if (missing) return Response.json({ error: missing }, { status: 503 });
  return cachedJson(context, TTL, async () => {
    const snapshot = await positions(context.env);
    return { updated: new Date().toISOString(), hr: snapshot.hr, vehicles: selectVehicles(snapshot) };
  });
}
