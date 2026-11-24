// Free spaces at the station bicicletários that count them: for now those of ViaQuatro
// and ViaMobilidade (Motiva, formerly CCR). The count belongs to the station, as in the
// operator's feed: the stations are listed in data/bike-spaces.json ({ station, line,
// capacity }), the map writes the count under the station's icon, coloured when spaces
// run out, and the station's popup charts the last 24 hours.
//
// THE NUMBERS ARE SIMULATED for now (SIMULATED below): there is no feed yet. The real
// one replaces the bodies of currentSpaces() and spaceHistory() and nothing else; both
// are already async, because it will most likely sit behind a Pages Function.

import { dayType } from './schedule.js';
import { spParts } from './time.js';

/** True while the numbers are made up: the interface says so wherever it shows them. */
export const SIMULATED = true;

// "Few" = 10% of the spaces or less, and never more than this many at a small one.
const FEW_SHARE = 0.1;
const FEW_MIN = 5;

/** 'full' (none free), 'few' or 'ok'. */
export function spaceLevel(free, capacity) {
  if (free <= 0) return 'full';
  return free <= Math.max(FEW_MIN, Math.floor(capacity * FEW_SHARE)) ? 'few' : 'ok';
}

export const LEVEL_LABEL = { ok: 'Com vagas', few: 'Poucas vagas', full: 'Lotado' };

/** "1 vaga livre", "12 vagas livres". */
export const freeText = (n) => `${n} ${n === 1 ? 'vaga livre' : 'vagas livres'}`;

// ------------------------------------------------------------ the source (simulated)

const SAMPLE_MS = 15 * 60_000;
const HISTORY_SAMPLES = 96; // 24 h

// A hash (FNV-1a) of `text` as a number in [0, 1): the same spot and moment always give the same value,
// so the count under the icon, the popup and the chart's last point agree.
function unit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  // Mixed once more (murmur3's finaliser): FNV alone barely moves when only the last
  // character changes, and neighbouring hours must differ.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// A station bicicletário on a working day: fills up in the morning peak, stays so until
// people come back in the evening. Weekends see a third of that, later in the day. Each
// spot has its own peak (some overflow: those are the full ones), its own timing and a
// slow wobble. Times are São Paulo's.
function simulatedFree(spot, ms) {
  const id = spot.station;
  const sample = Math.floor(ms / SAMPLE_MS);
  const p = spParts(new Date(sample * SAMPLE_MS));
  const workday = dayType(p.iso) === 'weekday';
  const minutes = p.minutes + (unit(`${id}|shift`) - 0.5) * 60;
  const [arrive, leave] = workday ? [7.25 * 60, 18.25 * 60] : [9.5 * 60, 16 * 60];
  const filled = sigmoid((minutes - arrive) / 35) * (1 - sigmoid((minutes - leave) / 50));
  const peak = (0.55 + 0.6 * unit(`${id}|peak`)) * (workday ? 1 : 0.35);
  const overnight = 0.03 + 0.07 * unit(`${id}|night`);
  const hour = Math.floor(sample / 4), part = (sample % 4) / 4;
  const wobble = unit(`${id}|${hour}`) * (1 - part) + unit(`${id}|${hour + 1}`) * part - 0.5;
  const occupied = overnight + (peak - overnight) * filled + 0.08 * wobble + 0.02 * (unit(`${id}|${sample}`) - 0.5);
  return Math.min(spot.capacity, Math.max(0, spot.capacity - Math.round(spot.capacity * occupied)));
}

/**
 * The free spaces right now at each of `stations` (entries of data/bike-spaces.json):
 * { [station name]: { free, capacity, at } }, `at` in ms since the epoch.
 */
export async function currentSpaces(stations, now = new Date()) {
  const at = Math.floor(now.getTime() / SAMPLE_MS) * SAMPLE_MS;
  return Object.fromEntries(stations.map((s) => [s.station, { free: simulatedFree(s, at), capacity: s.capacity, at }]));
}

/** The last 24 hours at one station, oldest first: [{ at, free }], ending at the current count. */
export async function spaceHistory(spot, now = new Date()) {
  const last = Math.floor(now.getTime() / SAMPLE_MS);
  return Array.from({ length: HISTORY_SAMPLES + 1 }, (_, i) => {
    const at = (last - HISTORY_SAMPLES + i) * SAMPLE_MS;
    return { at, free: simulatedFree(spot, at) };
  });
}

// ------------------------------------------------------------ the 24 h chart

const clock = (ms) => {
  const p = spParts(new Date(ms));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

/** The chart in words: its lowest and highest points. */
export function historySummary(series) {
  if (!series.length) return '';
  let min = series[0], max = series[0];
  for (const s of series) {
    if (s.free < min.free) min = s;
    if (s.free > max.free) max = s;
  }
  if (min.free === max.free) return `Últimas 24 h: sempre ${freeText(min.free)}`;
  return `Últimas 24 h: de ${min.free} (${clock(min.at)}) a ${freeText(max.free)} (${clock(max.at)})`;
}

// Drawn 1:1 in the popup. Colours and type come from style.css (.spaces-chart).
const W = 260, H = 96;
const PLOT = { left: 26, right: 250, top: 8, bottom: 76 };

function scales(series, capacity) {
  const t0 = series[0].at, span = series.at(-1).at - t0 || 1;
  return {
    x: (at) => PLOT.left + ((at - t0) / span) * (PLOT.right - PLOT.left),
    y: (free) => PLOT.bottom - (Math.min(free, capacity) / capacity) * (PLOT.bottom - PLOT.top),
  };
}
const n = (v) => v.toFixed(1);

/**
 * The series cut where the level changes: [{ level, points }]. Each step between two
 * samples takes the level it arrives at, so a stretch reads as "from here on, few left".
 */
export function levelRuns(series, capacity) {
  const runs = [];
  for (let i = 1; i < series.length; i++) {
    const level = spaceLevel(series[i].free, capacity);
    if (runs.at(-1)?.level === level) runs.at(-1).points.push(series[i]);
    else runs.push({ level, points: [series[i - 1], series[i]] });
  }
  return runs;
}

/**
 * The chart as an SVG string: free spaces (0 to capacity) over the series' time span,
 * each stretch in the colour of its level, like the count on the map.
 */
export function historyChart(series, capacity) {
  const { x, y } = scales(series, capacity);
  const marks = levelRuns(series, capacity).map(({ level, points }) => {
    const line = points.map((s, i) => `${i ? 'L' : 'M'}${n(x(s.at))} ${n(y(s.free))}`).join('');
    return `<path class="area ${level}" d="${line}V${PLOT.bottom}H${n(x(points[0].at))}Z"/><path class="line ${level}" d="${line}"/>`;
  });
  const grid = [0, capacity / 2, capacity].map((v) => `<path class="grid" d="M${PLOT.left} ${n(y(v))}H${PLOT.right}"/>`);
  const yLabels = [0, capacity].map((v) => `<text class="axis" x="${PLOT.left - 4}" y="${n(y(v) + 3.5)}" text-anchor="end">${v}</text>`);
  // A tick at 0h, 6h, 12h and 18h, São Paulo time (not at the very start: its label
  // would run into the 0 of the other axis).
  const ticks = series.slice(1).filter((s) => spParts(new Date(s.at)).minutes % 360 === 0);
  const xLabels = ticks.map((s) => `<path class="grid" d="M${n(x(s.at))} ${PLOT.bottom}v3"/>
    <text class="axis" x="${n(x(s.at))}" y="${PLOT.bottom + 14}" text-anchor="middle">${spParts(new Date(s.at)).hour}h</text>`);
  const last = series.at(-1);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${historySummary(series)}">
    ${grid.join('')}${yLabels.join('')}${xLabels.join('')}
    ${marks.join('')}
    <circle class="now ${spaceLevel(last.free, capacity)}" cx="${n(x(last.at))}" cy="${n(y(last.free))}" r="3.5"/>
    <g class="probe" visibility="hidden"><path class="rule" d="M0 ${PLOT.top}V${PLOT.bottom}"/><circle class="now" cy="0" r="3.5"/></g>
  </svg>`;
}

/**
 * Draws the chart into `el` with a line of text under it: the summary, or, while a
 * finger or the mouse is over the chart, the time, level and count at that point. When
 * spaces ran short in the period, a key names the colours.
 */
export function mountHistory(el, series, capacity) {
  if (series.length < 2) { el.textContent = 'Sem histórico agora'; return; }
  const summary = historySummary(series);
  const seen = new Set(series.map((s) => spaceLevel(s.free, capacity)));
  const key = seen.has('few') || seen.has('full')
    ? `<p class="spaces-key">${Object.keys(LEVEL_LABEL).filter((l) => seen.has(l)).map((l) => `<span><span class="dot inline ${l}"></span> ${LEVEL_LABEL[l]}</span>`).join('')}</p>`
    : '';
  el.innerHTML = `${historyChart(series, capacity)}${key}<p class="spaces-readout" aria-hidden="true">${summary}</p>`;
  const svg = el.querySelector('svg'), probe = el.querySelector('.probe'), readout = el.querySelector('.spaces-readout');
  const { x, y } = scales(series, capacity);
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const at = series[0].at + ((((e.clientX - box.left) / box.width) * W - PLOT.left) / (PLOT.right - PLOT.left)) * (series.at(-1).at - series[0].at);
    const s = series.reduce((best, c) => (Math.abs(c.at - at) < Math.abs(best.at - at) ? c : best));
    probe.setAttribute('transform', `translate(${n(x(s.at))} 0)`);
    const level = spaceLevel(s.free, capacity);
    probe.querySelector('circle').setAttribute('cy', n(y(s.free)));
    probe.querySelector('circle').setAttribute('class', `now ${level}`);
    probe.setAttribute('visibility', 'visible');
    readout.textContent = `${clock(s.at)} · ${level === 'ok' ? '' : `${LEVEL_LABEL[level]} · `}${freeText(s.free)}`;
  };
  const hide = () => {
    probe.setAttribute('visibility', 'hidden');
    readout.textContent = summary;
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', show);
  // A finger "leaves" as soon as it lifts: what it tapped stays up. The mouse clears it.
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
}
