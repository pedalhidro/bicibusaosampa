import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { lowFloorFilter, vehicleFilter } from '../functions/_lib/vehicles.js';
import { normalize } from '../functions/api/rail-status.js';
import { normalizeRoute } from '../functions/api/route.js';

test('selectVehicles keeps fleet buses on any line and flags unusual lines', () => {
  const select = vehicleFilter({ lines: [{ code: '809P-10' }] }, ['71858', '30001']);
  const snapshot = {
    hr: '12:26',
    l: [
      { c: '809P-10', sl: 1, lt0: 'TERM. PINHEIROS', lt1: 'TERM. CAMPO LIMPO', vs: [{ p: 71858, a: true, ta: 't', py: -23.6, px: -46.7 }] },
      { c: '809P-10', sl: 2, lt0: 'TERM. PINHEIROS', lt1: 'TERM. CAMPO LIMPO', vs: [{ p: 71250, a: false, ta: 't', py: -23.6, px: -46.7 }] },
      { c: '3459-10', sl: 2, lt0: 'TERM. PQ. D. PEDRO II', lt1: 'ITAIM PAULISTA', vs: [{ p: 30001, py: 0, px: 0 }, { p: 30002, py: 0, px: 0 }] },
    ],
  };
  const v = select(snapshot);
  assert.deepEqual(v.map((x) => x.prefix), ['71858', '30001']);
  assert.equal(v[0].expected, true);
  assert.equal(v[0].to, 'TERM. PINHEIROS');
  assert.equal(v[1].expected, false);
  assert.equal(v[1].to, 'ITAIM PAULISTA');
});

test('the fleet list has only superarticulated buses', () => {
  const fleet = JSON.parse(readFileSync(new URL('../data/bike-fleet.json', import.meta.url)));
  assert.deepEqual(fleet.types, ['Articulado (23m)', 'Articulado', 'A23']);
  assert.equal(fleet.prefixes.length, fleet.count);
  assert.ok(fleet.count > 1000);
});

test('lowFloorFilter keeps register buses as compact rows with their door', () => {
  const select = lowFloorFilter({ D: ['10001'], C: ['20002'], T: [] });
  const out = select({
    hr: '13:00',
    l: [
      { c: '8000-10', sl: 2, lt0: 'Lapa', lt1: 'Pça. Ramos', vs: [{ p: 10001, py: -23.5, px: -46.6 }, { p: 99999, py: 0, px: 0 }] },
      { c: '1012-10', sl: 1, lt0: 'Jd. Monte Belo', lt1: 'Term. Princesa Isabel', vs: [{ p: 30003, py: 0, px: 0 }] },
      { c: '5111-10', sl: 1, lt0: 'Term. Grajaú', lt1: 'Pq. D. Pedro', vs: [{ p: 20002, py: -23.6, px: -46.7 }] },
    ],
  });
  assert.deepEqual(out.vehicles, [['10001', '8000-10', 2, -23.5, -46.6, 'D'], ['20002', '5111-10', 1, -23.6, -46.7, 'C']]);
  // Destination sign: lt1 in sentido 2, lt0 in sentido 1; lines without one are left out.
  assert.deepEqual(out.to, { '8000-10|2': 'Pça. Ramos', '5111-10|1': 'Term. Grajaú' });
});

test('normalizeRoute turns GeoSampa features into simplified directions', () => {
  const line = Array.from({ length: 50 }, (_, i) => [-46.6 + i * 0.0001, -23.5]);
  const out = normalizeRoute({
    features: [
      { properties: { cd_sentido_linha_onibus: 1 }, geometry: { type: 'LineString', coordinates: line } },
      { properties: { cd_sentido_linha_onibus: 2 }, geometry: { type: 'MultiLineString', coordinates: [line.slice(0, 2), line.slice(2, 4)] } },
    ],
  });
  assert.deepEqual(out.map((d) => d.sentido), [1, 2, 2]);
  assert.equal(out[0].coordinates.length, 2); // a straight line simplifies to its ends
});

test('normalize maps the Motiva feed by line number', () => {
  const out = normalize({
    data: {
      dataAtualizacao: '2026-09-30T12:25:28',
      concessoes: [
        { linhas: [{ numero: '4', statusLinha: { codigo: 'OperacaoNormal', status: 'Operação Normal', descricao: '' } }] },
        { linhas: [{ numero: 1, statusLinha: { codigo: 'OperacaoNormal', status: 'Operação Normal', descricao: 'Operação Normal' } }] },
      ],
    },
  });
  assert.equal(out.updated, '2026-09-30T12:25:28');
  assert.deepEqual(out.lines['4'], { code: 'OperacaoNormal', status: 'Operação Normal', description: null });
  assert.equal(out.lines['1'].description, null);
});
