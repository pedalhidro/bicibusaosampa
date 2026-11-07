import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTerminals, terminalName } from '../scripts/terminals.mjs';

test('terminalName spells out GeoSampa abbreviations and names EMTU terminals', () => {
  assert.equal(terminalName('Term. Joao Dias', 'sptrans'), 'Terminal João Dias');
  assert.equal(terminalName('Term. Cid. Tiradentes', 'sptrans'), 'Terminal Cidade Tiradentes');
  assert.equal(terminalName('Diadema', 'emtu'), 'Terminal Metropolitano Diadema');
  assert.equal(terminalName('E.T. Munhoz Junior', 'emtu'), 'Estação de Transferência Munhoz Junior');
});

test('buildTerminals keeps terminals in operation and finds a bicicletário nearby', () => {
  const pt = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });
  const out = buildTerminals([
    pt(-46.70, -23.52, { nm_terminal: 'Term. Lapa', nm_tipo_terminal: 'URBANO', tx_endereco_terminal: 'R Guaicurus', tx_status_terminal: 'em operação' }),
    pt(-46.60, -23.50, { nm_terminal: 'Velho', nm_tipo_terminal: 'URBANO', tx_status_terminal: 'desativado' }),
    pt(-46.50, -23.60, { nm_terminal: 'Cotia', nm_tipo_terminal: 'EMTU', tx_endereco_terminal: 'Cotia', tx_status_terminal: 'em operação' }),
  ], [
    pt(-46.7005, -23.52, { kind: 'bicicletario', name: 'Bicicletário Terminal Lapa', access: 'cadastro' }), // ~50 m
    pt(-46.5, -23.6, { kind: 'paraciclo', name: 'Paraciclo' }), // not a bicicletário
  ]);
  assert.deepEqual(out.map((f) => f.properties.name), ['Terminal Lapa', 'Terminal Metropolitano Cotia']);
  assert.equal(out[0].properties.parking.name, 'Bicicletário Terminal Lapa');
  assert.ok(out[0].properties.parking.meters > 40 && out[0].properties.parking.meters < 60);
  assert.equal(out[1].properties.address, undefined); // EMTU repeats the name as the address
  assert.equal(out[1].properties.parking, undefined);
});
