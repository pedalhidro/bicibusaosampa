// GET /api/config — public settings the browser needs from the environment.
// cartoKey: CARTO basemaps key (CARTO_API_KEY). It's meant to be public: it travels in
// every tile URL, and is locked to the site's domains in CARTO's dashboard.

export function onRequestGet({ env }) {
  return Response.json(
    { cartoKey: env.CARTO_API_KEY || null },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  );
}
