// GET /api/low-floor — live positions of the SPTrans low-floor buses (step-free
// boarding), picked by prefix from the fleet register (data/low-floor-fleet.json).
// Thousands of buses, so the rows are compact arrays (see lowFloorFilter).

import { cachedJson } from '../_lib/cache.js';
import { missingConfig, positions } from '../_lib/olhovivo.js';
import { lowFloorFilter } from '../_lib/vehicles.js';
// Plain JSON import: the Pages build's bundler doesn't accept import attributes.
import fleet from '../../data/low-floor-fleet.json';

const TTL = 20;

const select = lowFloorFilter(fleet.doors);

export async function onRequestGet(context) {
  const missing = missingConfig(context.env);
  if (missing) return Response.json({ error: missing }, { status: 503 });
  return cachedJson(context, TTL, async () => {
    const snapshot = await positions(context.env);
    return { updated: new Date().toISOString(), hr: snapshot.hr, register: fleet.date, ...select(snapshot) };
  });
}
