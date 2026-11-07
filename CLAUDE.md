# Bici Busão Sampa

Live map of the buses and metro/train lines in Greater São Paulo that carry bicycles,
and of the places to park a bike, served at https://busao.bicisampa.info. A static
Leaflet site plus three Cloudflare Pages Functions. No framework and no build step for
the site.

It's the first piece of a planned *bicycling digital twin* of São Paulo: a PWA (later
native apps) for everyday cyclists, aggregating many stakeholders' data, with
intermodal routing (bike + bus + train) and feedback later. Favour mobile-friendly,
light, reusable-data choices.

## Commands

```sh
npm run dev          # wrangler pages dev → http://localhost:8788 (reads SPTRANS_TOKEN from .env)
npm test             # node --test: schedule rules, holidays, headings, lanes, bike parking, terminals, custom models, function helpers
npm run build:data   # regenerate data files (`-- rail`, `-- bus`, `-- emtu`, `-- parking`, `-- terminals` or `-- fleet` for one)
npm run build:tokens # design/tokens/ → public/tokens.css, public/js/tokens.js and the tables in DESIGN.md
npm run build:icons  # design/icons/ → public/js/icons.js and the icons in index.html (icons:fetch copies new SVGs from the icon library)
node scripts/suggest-lines.mjs [--write]   # compare live rack buses with the expected lines
node scripts/plan.mjs --from=LAT,LON --to=LAT,LON [--at=…] [--power=suave] [--model=plano --prefs=avoidArterials] [--networks=sptrans,rail]   # try the trip planner
```

To check UI changes, run the dev server and take screenshots with Playwright. Use
`page.clock.install()` to test other times of day; the colours depend on the clock.
`map` isn't global: to move the view, intercept `js/app.js` with `page.route()` and
append `window.__map = map;`.

## Layout

- `public/`: the site, deployed as-is.
  - `js/app.js`: map, base maps, layers sheet, polling (rail status 60 s, buses 20 s).
    - Base maps: one background as a radio (OSM, "OSM claro" = OSM through a lighter
      CSS filter, none) with an opacity slider, and "Topográfico colorido" (Pedal
      Hidrográfico's `telhas.pedalhidrografi.co/rmsampa-v2`, zooms 8–16) on top with
      its own on/off and opacity (default 20 %). Saved as `baseMaps` in localStorage
      (the older `{ osm, topo }` shape is migrated).
    - CARTO's Positron (Dark Matter in dark mode) and Voyager: since 2026-09 every
      CARTO tile request needs a free, domain-locked key. It's `CARTO_API_KEY` (in
      `.env` locally, a Pages variable in production), served to the page by
      `functions/api/config.js`; the two options appear once it arrives (offline or
      without it: OSM only). Their terms: credits visible on the map, no browser cache
      over 30 days, no server proxy. Don't embed someone else's Mapbox token.
  - `js/ui.js`: the two sheets (☰ menu, ⧉ layers + legend; bottom sheets with a drag
    grip on phones, cards on wider screens), the toast, and the PWA update banner.
  - `js/locate.js`: locate button and blue dot. Opens on Terminal Bandeira at zoom 16;
    follows the user from the start only if location permission was already granted.
  - `js/geocode.js`: place search and reverse lookup with Photon (bbox Greater SP).
  - `js/intent.js`: what the person came to do ("caminho do usuário"), asked on a
    welcome dialog (not over a shared trip link) on the first visit and on every visit
    while "Mostrar esta tela nas próximas vezes" is ticked (default on; also in Ajustes;
    `welcomeEvery`), and from the ⧉ sheet's **Ajustes** tab. Picking the same use
    again keeps the layers changed since: Explorar o entorno (default layers; menu and
    layers sheet closed and every menu section collapsed, unless a shared trip is
    opening), Chegar de bicicleta (planner
    open, destination focused), Chegar com
    acessibilidade (map-only for now: stations, terminals and low-floor buses, bike
    layers off, a note instead of the planner). Choosing one sets the layers and the
    menu; later changes persist as usual and become the defaults. Saved as `intent`.
    Ajustes also has "Voltar ao padrão", which clears saved preferences (not Casa,
    Trabalho or recent searches).
  - `sw-template.js` + `functions/sw.js.js`: the service worker, served at `/sw.js`
    with `__VERSION__` = deployed commit, so each deploy installs a new worker and the
    page shows "Nova versão · toque para atualizar". Shell cached per version (fetched
    with `?v=`, which also dodges the zone's 4 h edge cache); `/data/routing/*` cached
    across versions and re-checked daily. Locally the version is `dev`: no caching.
    Don't put the worker code in a Function module: the bundler injects `__name()`
    helpers that break it in the browser.
  - `manifest.webmanifest`, `icons/icon-*.png`: PWA install and favicon, generated from
    `assets/icon.jpg` (gitignored): full-bleed 180 for iOS, rounded 32/192/512 with
    transparent corners, maskable 512 at 70 % on dark brown (`brand.splash`, the manifest's splash colour too).
  - `vendor/leaflet-rotate/`: leaflet-rotate 0.2.8 (GPL-3.0) as patched by Câmera
    Topográfica (steadier touch rotation and pinch anchor). Map rotation: two fingers
    on phones, Shift + wheel with a mouse; a compass button resets north.
    - **Vector layers must live in the rotating pane** (`rotatingPane(name)` in app.js,
      `map.getPane('rotatePane')`), or lines stay put while tiles turn. Marker panes stay
      in the map pane (they're positioned with rotation, but drawn upright) and stack
      above the whole rotating pane.
    - Anything drawn with an on-screen direction needs `map.getBearing()`: bus arrows
      (heading − bearing), route trail icons (+ bearing), route labels.
    - On phones tile layers only refresh on moveend, so app.js calls `_update()` on
      them after a rotation.
    - Only the required credits stay on the map, in Leaflet's attribution control
      (bottom right): © OpenStreetMap always, © CARTO with a CARTO base map (their
      terms: visible, not behind a click). All other credits and data sources are in
      the ⧉ sheet's **Info** tab. Next to them, a live chip (bottom left: rail lines open to bikes, rack buses
      and EMTU coaches live; tapping it opens the line lists). Both ride above the
      phone sheet via `--sheet-bottom`. The menu has no footer.
  - Pure modules, imported by the tests too:
    - `time.js`: São Paulo time and holidays.
    - `schedule.js`: time-window engine.
    - `rail.js`: line status = timetable plus live override.
    - `heading.js`: bus direction of travel.
    - `offset.js`: polylines offset sideways by a zoom-dependent number of pixels.
    - `raptor.js`: trip planner (prototype). McRAPTOR over `data/routing/transit.json`
      with two criteria, arrival time and energy (net kcal), and every stop in two
      layers, with and without the bike. "Mais rápido" keeps options within the fastest +
      max(15 min, 30%); "Menos esforço" ignores time (up to a 3 h trip) and sorts by kcal;
      "Balanceado" runs both and sorts all their options by U = kcal + k × minutes
      (`balance()`), k = 1, 3 (default) or 10 from the panel's "Equilíbrio" slider, which
      re-ranks the returned candidates without a new search.
      `networks` (`sptrans`, `rail`, `emtu`) limits which patterns are ridden; EMTU
      patterns carry `agency: 'emtu'` in transit.json (older files: told by `bikes`).
    - `custom-model.js`: road preferences for bike legs in GraphHopper custom-model
      syntax, **priority only** (if/else_if/else + multiply_by; variables road_class,
      bike_infra, oneway, push, average_slope). Compiled once per model into a table
      per edge flags × grade bin in `streets.js`; cost = (time or energy) ÷ priority, 0
      leaves the street out. Never touches speed: reported times stay real. Styles and
      preferences live in `data/bike-models.json` (hand-edited); its `padrao` must
      reproduce the built-in comfort table (a test checks it).
    - `streets.js`: street graph (`data/routing/streets.bin`): decoding, snapping, a
      Dijkstra for walking/cycling legs with one-ways, pushing and slopes. Bike speed and
      energy follow amora's model (power level on the flat, 2× on climbs); walking uses
      Tobler and Minetti. Without the file, legs fall back to straight lines × 1.3.
      "Evitar avenidas" (on by default) counts secondary, primary and trunk roads
      without a bike lane or track 5× in route choice; reported times stay real. The
      planner sends it as a custom-model preference; the built-in table and the
      `avoidArterials` flag remain for callers without a model.
    - `live-trips.js`: live 23m buses from `/api/buses` turned into planner trips on
      the line they're actually running.
    - EMTU seletivo patterns (`p.bikes`) ride on their estimated timetable in both
      layers, live coaches aside; their legs carry `hold` (teal, "no bagageiro").
    - `planner.js` + `planner-worker.js`: the "Planejar viagem" section (open by
      default). Points: origin, stops, destination, each a search box (Photon) or a tap
      on the empty map (fills the first empty slot; with all set, the tap becomes the new
      destination and the old one a stop). Taps on buses, stations and lines keep their
      popups. Pins are draggable; their popup removes them. With stops, legs are planned
      one after another (best option each). A shown route fades stations and
      parking (`#map.route-shown`) and every bus/rail line it doesn't ride
      (`focusLines()` in app.js). Each leg is labelled with SVG text along the line
      itself (textPath on an invisible, west→east, screen-smoothed copy of the leg,
      shifted sideways as a parallel curve; own non-rotating pane `planLabels` at z
      660 with its own SVG, guides redrawn in screen coordinates on moveend/rotate so
      text reads left to right at any bearing; A/B/stop pins at 655, just below); a black "Total" label runs over the whole trip:
      time · kcal · distance above, the bus/rail line below; white letters outlined
      in the leg's colour. Each label
      sits on the straightest stretch of the leg's on-screen part (outside the sheet),
      shrinks to fit it (down to 7 px, then fades), and glides to its new spot when
      the view changes. With 2+ rides of a kind, their trail icons carry a 1, 2, …
      badge; a dark ⇄ marker sits at each change of mode. Trail icons shrink when
      zoomed out (full size from zoom 15, half at 11). Route lines don't bubble
      clicks, so tapping them never adds a trip point.
    - The mode selector (emoji buttons under the section title, text in
      aria-label/title) maps to profiles: 🚌 + 🚲 + 🅿️ (intermodal, bike, park) =
      `bike`, 🚌 + 🚲 = `carry`, 🚲 (only the bike, no transit: the planner's direct
      leg) = `cycle`. `walk` (intermodal on foot) is no longer offered: saved choices
      and `m=walk` links fall back to `carry`. The modes and priorities are explained
      behind (i) toggletips, not in captions. ⚙️ Mais opções has the pace, the route
      style and preferences (plus "Personalizado": the person's own JSON rules, saved
      in localStorage), the networks to use, and the departure time. With a route
      shown, "✕ Limpar" sits next to "Compartilhar". The worker downloads the network on the first point or
      search, not on page load.
  - `data/routing/transit.json`: **generated** (`npm run build:data -- routing`) from the
    SPTrans GTFS plus `data/gtfs/emtu-seletivo.zip`: stops and per line-direction patterns
    (stop offsets + departures; timetabled trips with equal stops and offsets fold into
    one pattern). `bikes: 1` (GTFS `bikes_allowed`) = the bike boards at any hour.
  - `data/gtfs/emtu-seletivo.zip`: **generated** (`-- emtu`, so build it before
    `routing`) GTFS of the seletivo lines, published for reuse. EMTU has no current
    GTFS: stops, route, `tempo` and per-day departures come from lineDetails, stop times
    are spread along the route by distance (`timepoint=0`, `distancesAlong()` matches
    stops in order), holidays run the Sunday service via `calendar_dates`. Lines with
    empty per-day lists only have `horarios`, today's timetable: it goes to the day type
    of the build date, so on weekends and holidays (e.g. a Monday holiday) the build
    keeps the existing zip. Passes the MobilityData validator with warnings only.
  - `data/routing/streets.bin`: **generated on request only** (`npm run build:data --
    streets`, not in the weekly run): OSM streets from ~30 Overpass tiles plus node
    elevations from amora's baked graph (`telhas.pedalhidrografi.co/viario/`). Must
    stay under Cloudflare Pages' 25 MiB file limit; the build refuses otherwise.
    - `parking.js`: bike parking access labels and open/closed status.
  - `data/bus-terminals.geojson`: **generated** (`-- terminals`, after `parking`) from
    GeoSampa `geoportal:terminal_onibus` (the source of truth for terminals, per the
    maintainer; don't patch in OSM ones) (SPTrans urban, EMTU metropolitan and coach
    terminals; names tidied in `scripts/terminals.mjs`) with the nearest bicicletário
    within 200 m. Drawn with the stations (same pane, toggle and zoom).
  - `data/rail-lines.json`, `data/bike-buses.json`: **hand-edited** config (lines,
    colours, operating hours, bike rules, the *expected* lines of the rack buses).
  - `data/emtu-seletivo.json`: **hand-edited** list of the EMTU seletivo lines (from
    EMTU's *Relatório Tarifário RMSP*, service SELETIVO) and the bike rule text.
  - `data/emtu-routes.geojson`, `data/emtu-stops.geojson`: **generated** (`-- emtu`)
    from the EMTU feed (`scripts/emtu.mjs`). Lanes keep clear of the SPTrans routes
    (`assignLanes(…, { taken })`), so build `bus` first. Fares come from the feed.
    In app.js the EMTU lines live in `busLineByCode` with `agency: 'emtu'` and share
    the bus route and live bus layers; vehicles are keyed by `busId()` because
    prefixes are only unique per operator.
  - `data/*.geojson`: **generated** by `scripts/build-data.mjs`. Never edit by hand.
    Bus routes carry a precomputed `lane` (`scripts/lanes.mjs`).
  - `data/bike-parking.geojson`: **generated** bicicletários and paraciclos in the
    RMSP: OSM `amenity=bicycle_parking` (inside OSM relation 2661855) merged with the
    GeoSampa `bicicletario_paraciclo` layer. Classified by `scripts/parking.mjs`;
    OSM `opening_hours` become schedule.js schedules (`scripts/opening-hours.mjs`,
    simple forms only, else unknown).
  - `data/lines/<code>.json`: **generated** route and stops of every SPTrans bus line
    (from the GTFS, ~1,350 files, ≤32 KB each), loaded when a rack bus runs off its
    expected lines.
- `data/bike-fleet.json`: **generated** (`-- fleet`) from two SPTrans registers in
  `assets/` (gitignored: only the bus numbers are tracked): "Frota cadastrada"
  (`REGISTER_CSV`) buses with Tecnologia "Articulado (23m)" or plain "Articulado"
  (the maintainer treats both as superarticulated), plus `00_businfo_consolidado.csv`
  `tipo=A23`. Left out: anything either file marks electric (no rack), and plain
  "Articulado" buses that businfo says are 18 or 21 m (~630 of the 1,612). Server-side
  only. Rebuild locally when a register is updated; elsewhere the step is skipped.
- `data/low-floor-fleet.json`: **generated** (`-- fleet`) from SPTrans' "Frota
  cadastrada" register (`assets/sptrans-frota-cadastrada-2026-04-10.csv`, the XLSX
  saved as CSV, gitignored): prefixes of the "Piso Baixo" buses by low door (D/C/T).
  The rest of the fleet is high-floor with a lift; Olho Vivo's `a` flag can't tell
  them apart. Update `REGISTER_CSV`/`REGISTER_DATE` in build-data.mjs with a new register.
- `functions/_lib/olhovivo.js`: the `/Posicao` snapshot. In production it comes from
  the relay (`OLHOVIVO_RELAY_URL` + `OLHOVIVO_RELAY_KEY`); without those (local dev)
  it logs in to Olho Vivo directly with `SPTRANS_TOKEN`.
- `functions/api/buses.js`: keeps the `/Posicao` vehicles whose prefix is in the fleet
  list, wherever they run; each gets `expected: false` when its line isn't in
  `bike-buses.json`.
- `functions/api/low-floor.js`: the low-floor buses, as compact rows
  (`[prefix, line, sentido, lat, lon, door]`, ~60 KB gzipped). The map layer is opt-in
  (off by default, `shownLayers` in localStorage) and polls only while on and at
  zoom ≥ 12; canvas dots culled to the view.
- `relay/`: tiny Node service on Cloud Run (GCP project `bicisampa`,
  `southamerica-east1`, service `olhovivo-relay`). `GET /posicao` with `X-Relay-Key`
  returns the raw `/Posicao` JSON, cached 15 s. `GET /emtu?linhas=…` returns the
  EMTU vehicles and direction names of those lines, cached 15 s. Redeploy the relay
  after changing it (`relay/` is deployed on its own). Secrets in Secret Manager:
  `sptrans-token`, `relay-key`. Deploy command in `relay/README.md`.
- `functions/api/emtu-buses.js`: live EMTU seletivo coaches via the relay's `/emtu`
  (mapping in `functions/_lib/emtu.js`). Fetched separately from `/api/buses`, so
  either feed can fail alone.
- `functions/api/route.js`: route of any line from GeoSampa WFS (`geoportal:linha_onibus`),
  the fallback for off-route lines missing from `data/lines/`. Cached a day.
- `functions/api/rail-status.js`: proxy for the Motiva line-status feed, which covers
  every operator.
- `functions/_lib/`: shared function code.
  - `cache.js`: edge cache with stale-while-revalidate.
  - `vehicles.js`: the vehicle filter, kept separate so Node can test it.

## Gotchas

- **Cloudflare's Pages build compiles Functions with wrangler 3.x.** Its bundler rejects
  JSON import attributes (`with { type: 'json' }`), even though local wrangler 4 accepts
  them. Keep JSON imports plain inside `functions/`. Logic that Node tests need goes in
  `functions/_lib/` without JSON imports. To check that a change builds:
  `npx wrangler@3.114.17 pages functions build --outdir /tmp/x`.
- **Pushing to `main` deploys to production** through the Pages Git integration. Only
  commit or push when asked.
- **A GitHub Action commits regenerated data** ("Atualiza camadas do mapa") every Monday
  and whenever a config file changes. Pull before you push.
- **Secrets:** `SPTRANS_TOKEN` lives in `.env` locally (gitignored), in Secret Manager
  (`sptrans-token`, for the relay) and as a Pages secret. `CARTO_API_KEY` (public by
  design, domain-locked) is in `.env` and must be a Pages variable too. Pages also has
  `OLHOVIVO_RELAY_URL` and `OLHOVIVO_RELAY_KEY`. Pages only picks up a new secret on
  the next deployment.
- **The EMTU feed** (`rest-emtu.noxxonsat.com.br/rest/lineDetails?linha=<code>`, one
  line per call; the feed behind EMTU's apps) has served an expired certificate since
  2025-04. Browsers, Workers (workerd) and Node's default fetch refuse it, and there's
  no plain HTTP. `relay/server.mjs` and `scripts/emtu.mjs` accept `CERT_HAS_EXPIRED`
  only, for that host only, with a fresh connection per request (`agent: false`).
  Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`. It sends `Access-Control-Allow-Origin: *`,
  so if the certificate is ever renewed the browser could call it directly.
  `dataUltimaTransmissao` is ms since the epoch; `sentidoLinha` is ida/volta/circular.
- **Cloud Run reserves paths ending in `z`** (e.g. `/healthz`); the relay uses `/health`.
- **Olho Vivo** (`api.olhovivo.sptrans.com.br/v2.1`):
  - Blocks requests from Cloudflare Workers since ~2026-10 (HTTP 403, Cloudflare error
    1106), hence the relay on GCP. Google Cloud egress isn't blocked.
  - No CORS; the login cookie only works server-side.
  - `/Login/Autenticar` returns `false` for any bad token, with no detail.
  - `/Posicao` has no vehicle-type or bike-rack field.
  - `sl` 1/2 equals GTFS `direction_id` 0/1. The destination is `lt0` when `sl` is 1,
    and `lt1` otherwise.
- **The Motiva status feed** (`webapi.grupoccr.com.br`) returns an empty body to any
  browser Origin, so it must be called server-side.
- **Overpass is often overloaded.** The build script tries several mirrors and keeps the
  existing file if all of them fail. Downloads are cached in `.cache/` for a day.
  Heavy queries need a modest `[maxsize:]` (256 MB): asking for 1 GB gets 504s whenever
  the server is busy. The main server allows 2 queries at a time (429 otherwise).
  Mirrors can lag weeks behind the main server (check `osm3s.timestamp_osm_base`).
- **GeoSampa bike parking** (`geoportal:bicicletario_paraciclo`) covers only the city
  of São Paulo, and its points sit 50–200 m from the same parking in OSM. The build
  merges a GeoSampa point into an OSM spot of the same kind within 250 m.
- **Other Claude sessions may share this working tree.** Check `git status` and
  `git diff` before committing, and commit only your own changes.
- **All times are `America/Sao_Paulo`.** Schedules are `"HH:MM"` windows per day type
  (`weekday`, `saturday`, `sunday`, `holiday`). An end time past `24:00` spills into the
  next day; the Metrô's Saturday-night 24h service uses this. A `service` entry can
  carry an `until` date.
- **Holidays:** national, state (9/7) and city (25/1, Corpus Christi). Carnival is left
  out on purpose, because it's only *ponto facultativo*.

## Domain rules (verify before changing)

- **Rail (all operators):** regular bikes are allowed on weekdays 10:00–16:00 and from
  21:00 to closing, and all day on weekends and holidays. Folding bikes are allowed at
  any time.
- **SPTrans buses:** only superarticulated 23 m buses have a bike rack (Portaria SMT
  32/2016). Bikes are allowed on weekdays 10:01–15:59 and 19:01–05:59, on Saturdays
  from 14:00, and all day on Sundays and holidays. SPTrans publishes no list of these
  buses or lines; we use the fleet register CSV for buses and `suggest-lines.mjs` for
  the expected lines (3+ rack buses that are 20%+ of the line's buses).
- **Intercity buses (Artesp, formerly EMTU)** don't carry bikes and are out of scope,
  except the **seletivo** lines (coaches with a luggage hold): the bike goes in the
  hold if there's room. EMTU publishes no rule or hours for this, so the map shows no
  bike status for them, only the rule text from `emtu-seletivo.json`.
- **Bike parking:** station and terminal bicicletários (Metrô, CPTM, ViaQuatro,
  ViaMobilidade, SPTrans terminals run by Socicam, EMTU, Tembici) are free but need an
  on-site sign-up with a photo ID (CPTM also asks for proof of address). They're
  classed `cadastro` even when OSM tags them private. Paraciclos need no sign-up.
  Private parking is left out.

## Visual conventions (chosen by the maintainer)

Colours, spacing, type, radii, motion and layers are design tokens: read DESIGN.md before
any visual change. Edit `design/tokens/*.tokens.json` (DTCG 2025.10), run
`npm run build:tokens`, never edit `public/tokens.css` or `public/js/tokens.js`, and use no
colour, spacing, type, radius, motion or z-index literal (`test/design.test.js` enforces
it). The rules below are what the colours *mean*; the tokens hold the values.

- **Rail lines:** thin lines in the status colour on a dark casing (the railway
  symbol, so they don't read as bus routes): green when bikes are allowed now, yellow
  when the line runs but it's outside bike hours, red when the line is closed or
  stopped. The core keeps the status dashes; the casing is always solid.
- **Stations:** official Metrô or CPTM icons (`public/icons/`, from Wikimedia Commons),
  chosen by each line's `mode`.
- **Bus colours** (icons, routes, badges) combine two questions: bikes allowed on buses
  at this hour, and is this one of the line's usual superarticulated lines?
  Allowed + usual = green, allowed + off-route = purple, outside hours + usual =
  yellow, outside hours + off-route = orange. EMTU seletivo coaches and routes are
  teal (`map.bus.emtu`) whatever the hour (no published rule), with square-cornered icons.
- **Bus icons:** a rounded box in the bus colour with a white arrow pointing the
  direction of travel.
- **Bus routes:** solid lines in the bus colour, 10 m wide on the ground (never under
  1.5 px). They're offset into lanes so both directions and shared corridors lie side
  by side.
- **No bus stops on the map** (removed 2026-11 by the maintainer: too dense).
  `bus-stops.geojson` and `emtu-stops.geojson` are still generated, for reuse, but the
  site doesn't load them.
- **Bike parking:** a house for a bicicletário (from zoom 12), a circle for a paraciclo
  (from zoom 14), with a white inverted-U stand and a dark outline. Colour: green =
  free, no sign-up; blue = free with sign-up; pink = paid; grey = customers only;
  red = closed now (overrides the others).
- **Bus terminals:** a bus under a roof on a rounded square, coloured by operator
  (`map.terminal.sptrans`, `.emtu`, `.coach`).
- **Low-floor buses:** small blue dots with a white ring, all lines (`map.bus.low-floor`).
- **Rail casing** (`map.rail.casing`) is the same dark tone on both maps: map tokens
  don't change with the colour scheme.
- **Layer control:** two tabs. Camadas: base map, topo, and toggles for rail lines,
  stations and terminals, bus routes, live buses, bike parking and the
  low-floor buses (opt-in). Legenda: the colour and shape key (the menu has none).
- **The tapped bus** is drawn bigger with a thicker outline while its popup is open;
  its line's other buses stay solid and the rest fade.

## Comfort features (keep them working)

- Origin is prefilled with "Minha localização" when location is already allowed
  (`locate.whenLocated`); the planner's 18 MB download waits for a real action.
- On mobile data / data saver, the first planner download asks first; progress is
  shown from the worker's `progress` messages.
- The peeked phone menu grows on click (or on focusing a text field), not on
  pointerdown: growing moves the content and would swallow the first tap.
- After a route is found the form folds into a tappable "A → B" summary
  (`#plan-details.planned`) and results come first.
- Map taps that add a point show a toast with "Desfazer" and vibrate briefly.
- Empty search fields offer 📍 Minha localização, 🏠 Casa / 💼 Trabalho (saved from a
  pin's popup) and recent picks. Search inputs are ARIA comboboxes.
- Planned trips are in the URL hash (`#p=lat,lon;lat,lon&m=mode`) and "Compartilhar"
  uses the share sheet; opening such a link plans the trip.
- Status never relies on colour alone: dashed rail = outside bike hours, dotted =
  closed; dashed bus outline = outside hours; slashed parking icon = closed.
- Map icons have tap areas of at least 32–40 px. Sheets take focus when opened and
  close with Escape. The phone menu opens at a low "peek" height.
- The topographic base map starts off on phones.

## Performance (phones)

- Panning and zooming cost grows with the number of DOM markers, so marker layers are
  culled to the view: live buses (only from zoom 12, `syncBusMarkers()`)
  and bike parking are added/removed on `moveend`. Keep new marker layers culled too.
- No CSS `filter` (e.g. `drop-shadow`) or blurred `box-shadow` on map icons: phones
  repaint each one on every frame. Use outlines drawn in the SVG instead.
- Popups that depend on live data are built when opened (`bindPopup(() => …)`), not on
  every refresh.

## Style

- UI text, the README and data-file comments are in Portuguese. Code comments are in
  English.
- Plain ES modules with no dependencies in the browser. Leaflet is loaded from cdnjs.
