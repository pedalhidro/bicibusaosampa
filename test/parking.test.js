import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseOpeningHours } from '../scripts/opening-hours.mjs';
import { buildParking, fromGeoSampa, fromOsm, titleCase } from '../scripts/parking.mjs';
import { parkingStatus } from '../public/js/parking.js';
import { currentSpaces, historyChart, historySummary, levelRuns, reportsSpaces, spaceHistory, spaceLevel } from '../public/js/spaces.js';

// São Paulo is UTC-3 all year.
const sp = (iso) => new Date(`${iso}-03:00`);

test('parseOpeningHours handles the forms used on bike parking', () => {
  const all = [['04:00', '23:59']];
  assert.deepEqual(parseOpeningHours('Mo-Su 04:00-23:59'), { weekday: all, saturday: all, sunday: all });
  assert.deepEqual(parseOpeningHours('Mo-Su,PH 04:40-24:00').holiday, [['04:40', '24:00']]);
  assert.deepEqual(parseOpeningHours('Mo-Fr 07:00-19:00'), { weekday: [['07:00', '19:00']], saturday: [], sunday: [] });
  assert.deepEqual(parseOpeningHours('Mo-Sa 06:00-22:00; Su off').sunday, []);
  assert.deepEqual(parseOpeningHours('Mo-Fr 22:00-02:00').weekday, [['22:00', '26:00']]);
  assert.deepEqual(parseOpeningHours('Mo-Su 08:00-12:00,13:00-18:00').sunday, [['08:00', '12:00'], ['13:00', '18:00']]);
  assert.equal(parseOpeningHours('24/7').sunday[0][1], '24:00');
});

test('parseOpeningHours refuses what it cannot represent', () => {
  assert.equal(parseOpeningHours('Mo-Th 08:00-18:00; Fr 08:00-17:00'), null);
  assert.equal(parseOpeningHours('sunrise-sunset'), null);
  assert.equal(parseOpeningHours('Jan-Mar Mo-Fr 08:00-12:00'), null);
  assert.equal(parseOpeningHours(''), null);
});

test('fromOsm tells paraciclos from bicicletários and classifies access', () => {
  assert.deepEqual(fromOsm({ amenity: 'bicycle_parking', bicycle_parking: 'stands', capacity: '10', covered: 'no' }),
    { kind: 'paraciclo', access: 'livre', capacity: 10 });
  const cptm = fromOsm({
    amenity: 'bicycle_parking', bicycle_parking: 'building', supervised: 'yes', name: 'Bicicletário Estação Osasco',
    operator: 'CPTM', opening_hours: 'Mo-Su 04:00-23:59', 'authentication:biometric': 'yes',
  });
  assert.equal(cptm.kind, 'bicicletario');
  assert.equal(cptm.access, 'cadastro');
  assert.equal(cptm.covered, true);
  assert.equal(cptm.biometric, true);
  assert.deepEqual(cptm.hours.weekday, [['04:00', '23:59']]);
  // SPTrans terminals: run by Socicam, tagged as stands, not supervised.
  assert.equal(fromOsm({ amenity: 'bicycle_parking', bicycle_parking: 'stands', supervised: 'no', name: 'Bicicletário Terminal Lapa', operator: 'Socicam' }).access, 'cadastro');
  // A station bicicletário mistagged as private is still open to anyone who signs up.
  assert.equal(fromOsm({ amenity: 'bicycle_parking', bicycle_parking: 'building', access: 'private', operator: 'ViaMobilidade' }).access, 'cadastro');
  assert.equal(fromOsm({ amenity: 'bicycle_parking', access: 'private' }), null);
  assert.equal(fromOsm({ amenity: 'bicycle_parking', access: 'customers' }).access, 'clientes');
  assert.equal(fromOsm({ amenity: 'bicycle_parking', access: 'customers', fee: 'yes', supervised: 'yes' }).access, 'pago');
  assert.equal(fromOsm({ amenity: 'bicycle_parking', opening_hours: '24/7' }).hours, '24h');
  assert.equal(fromOsm({ amenity: 'bicycle_parking', opening_hours: 'Mo-Th 08:00-18:00; Fr 08:00-17:00' }).hours, undefined);
});

test('GeoSampa names and operators are tidied', () => {
  assert.equal(titleCase('ESTACAO VILA LOBOS- JAGUARE'), 'Estação Vila Lobos - Jaguare');
  assert.equal(titleCase('TERMINAL PARQUE DOM PEDRO II'), 'Terminal Parque Dom Pedro Ii');
  assert.deepEqual(fromGeoSampa({ tx_tipo_equipamento: 'BICICLETARIO', nm_local: 'TERMINAL SAO MIGUEL', qt_vaga: 64, nm_orgao_responsavel: 'SPTRANS' }),
    { kind: 'bicicletario', access: 'cadastro', name: 'Bicicletário Terminal São Miguel', operator: 'SPTrans', capacity: 64, covered: true });
  assert.equal(fromGeoSampa({ tx_tipo_equipamento: 'PARACICLO', nm_orgao_responsavel: 'METRÔ - MONOTRI' }).operator, 'Metrô');
});

test('buildParking merges a GeoSampa point into the same OSM parking nearby', () => {
  const osm = [
    { type: 'way', id: 1, center: { lat: -23.5, lon: -46.6 }, tags: { amenity: 'bicycle_parking', bicycle_parking: 'building', operator: 'CPTM' } },
    { type: 'node', id: 2, lat: -23.6, lon: -46.7, tags: { amenity: 'bicycle_parking', access: 'private' } },
  ];
  const city = [
    { geometry: { type: 'Point', coordinates: [-46.6005, -23.5005] }, properties: { tx_tipo_equipamento: 'BICICLETARIO', qt_vaga: 80 } }, // ~75 m away
    { geometry: { type: 'Point', coordinates: [-46.6005, -23.5005] }, properties: { tx_tipo_equipamento: 'PARACICLO', qt_vaga: 8 } }, // other kind
    { geometry: { type: 'Point', coordinates: [-46.65, -23.55] }, properties: { tx_tipo_equipamento: 'BICICLETARIO' } }, // far
  ];
  const features = buildParking(osm, city);
  assert.equal(features.length, 3);
  assert.equal(features[0].properties.osm, 'way/1');
  assert.equal(features[0].properties.capacity, 80);
  assert.deepEqual(features.slice(1).map((f) => [f.properties.kind, f.properties.source]), [['paraciclo', 'geosampa'], ['bicicletario', 'geosampa']]);
});

test('parkingStatus says whether it is open now', () => {
  const hours = { weekday: [['06:00', '22:00']], saturday: [['06:00', '22:00']], sunday: [] };
  const p = { kind: 'bicicletario', access: 'cadastro', hours };
  assert.deepEqual(parkingStatus(p, sp('2026-10-07T10:00')), { open: true, colorKey: 'cadastro', detail: 'Aberto até 22:00' });
  assert.deepEqual(parkingStatus(p, sp('2026-10-07T23:00')), { open: false, colorKey: 'closed', detail: 'Fechado · abre amanhã 06:00' });
  // Sunday, and Monday 12/10 is a holiday (Sunday hours), so it opens on Tuesday.
  assert.equal(parkingStatus(p, sp('2026-10-11T10:00')).detail, 'Fechado · abre ter 06:00');
  assert.equal(parkingStatus({ ...p, hours: { weekday: [['04:40', '24:00']] } }, sp('2026-10-07T10:00')).detail, 'Aberto até meia-noite');
  assert.equal(parkingStatus({ ...p, hours: '24h' }).detail, 'Aberto 24 horas');
  assert.equal(parkingStatus({ kind: 'paraciclo', access: 'livre' }).detail, null);
  assert.equal(parkingStatus({ kind: 'bicicletario', access: 'livre' }).detail, 'Horário não informado');
  assert.match(parkingStatus({ kind: 'bicicletario', access: 'cadastro' }).detail, /estação ou terminal/);
  assert.equal(parkingStatus({ kind: 'paraciclo', access: 'livre' }).open, null);
  assert.equal(parkingStatus({ kind: 'paraciclo', access: 'livre' }).colorKey, 'livre');
});

// Free spaces at the bicicletários that count them (spaces.js). The numbers are
// simulated for now; these tests hold for the real feed too, except the last one.
test('reportsSpaces picks the ViaQuatro and ViaMobilidade bicicletários with a capacity', () => {
  const spot = { kind: 'bicicletario', capacity: 80, operator: 'ViaMobilidade' };
  assert.ok(reportsSpaces(spot));
  assert.ok(reportsSpaces({ ...spot, operator: 'Via Mobilidade' })); // as OSM has Grajaú and Autódromo
  assert.ok(reportsSpaces({ ...spot, operator: 'ViaQuatro' }));
  assert.ok(!reportsSpaces({ ...spot, operator: 'CPTM' }));
  assert.ok(!reportsSpaces({ ...spot, operator: undefined }));
  assert.ok(!reportsSpaces({ ...spot, kind: 'paraciclo' }));
  assert.ok(!reportsSpaces({ ...spot, capacity: undefined }));
});

test('spaceLevel: full at zero, few at 10% of the spaces or 5, whichever is more', () => {
  assert.equal(spaceLevel(0, 80), 'full');
  assert.equal(spaceLevel(1, 80), 'few');
  assert.equal(spaceLevel(8, 80), 'few');
  assert.equal(spaceLevel(9, 80), 'ok');
  assert.equal(spaceLevel(5, 30), 'few'); // a small one: 10% would be 3
  assert.equal(spaceLevel(6, 30), 'ok');
  assert.equal(spaceLevel(26, 261), 'few');
  assert.equal(spaceLevel(27, 261), 'ok');
});

test('the 24 h history ends at the current count, in 15-minute steps, within the capacity', async () => {
  const spot = { kind: 'bicicletario', capacity: 80, operator: 'ViaQuatro', osm: 'way/1' };
  const now = sp('2026-11-24T12:07');
  const current = (await currentSpaces([spot], now))['way/1'];
  const series = await spaceHistory(spot, now);
  assert.equal(series.length, 97);
  assert.equal(series.at(-1).at - series[0].at, 24 * 3_600_000);
  assert.ok(series.every((s, i) => i === 0 || s.at - series[i - 1].at === 900_000));
  assert.ok(series.every((s) => Number.isInteger(s.free) && s.free >= 0 && s.free <= 80));
  assert.deepEqual({ at: current.at, free: current.free }, series.at(-1));
  assert.equal(current.capacity, 80);
  assert.equal(current.at, sp('2026-11-24T12:00').getTime());
  // The same moment always gives the same numbers: the icon, popup and chart agree.
  assert.deepEqual(await spaceHistory(spot, sp('2026-11-24T12:14')), series);
});

test('historySummary names the lowest and highest points in São Paulo time', () => {
  const at = (hhmm) => sp(`2026-11-24T${hhmm}`).getTime();
  const series = [{ at: at('04:30'), free: 64 }, { at: at('09:15'), free: 0 }, { at: at('12:00'), free: 12 }];
  assert.equal(historySummary(series), 'Últimas 24 h: de 0 (09:15) a 64 vagas livres (04:30)');
  assert.equal(historySummary([{ at: at('04:30'), free: 1 }, { at: at('04:45'), free: 1 }]), 'Últimas 24 h: sempre 1 vaga livre');
  assert.match(historyChart(series, 80), /aria-label="Últimas 24 h: de 0 \(09:15\) a 64 vagas livres \(04:30\)"/);
});

test('the chart colours each stretch by the level it arrives at', () => {
  const series = [40, 30, 8, 3, 0, 0, 5, 20].map((free, i) => ({ at: sp('2026-11-24T08:00').getTime() + i * 900_000, free }));
  const runs = levelRuns(series, 80);
  assert.deepEqual(runs.map((r) => [r.level, r.points.map((p) => p.free)]), [
    ['ok', [40, 30]], ['few', [30, 8, 3]], ['full', [3, 0, 0]], ['few', [0, 5]], ['ok', [5, 20]],
  ]);
  const svg = historyChart(series, 80);
  for (const level of ['ok', 'few', 'full']) assert.ok(svg.includes(`class="line ${level}"`) && svg.includes(`class="area ${level}"`));
  assert.ok(svg.includes('class="now ok"')); // the last point: 20 free
});

test('simulated spaces: a working day empties the bicicletário by midday, a Sunday does not', async () => {
  const spot = { kind: 'bicicletario', capacity: 100, operator: 'ViaQuatro', osm: 'way/2' };
  const free = async (iso) => (await currentSpaces([spot], sp(iso)))['way/2'].free;
  assert.ok(await free('2026-11-24T03:00') > 80); // Tuesday, before the first train
  assert.ok(await free('2026-11-24T12:00') < 60);
  assert.ok(await free('2026-11-29T12:00') > 60); // Sunday
});
