import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileCondition, compilePriority, composeModel } from '../public/js/custom-model.js';
import { bikeModel, edgeCost } from '../public/js/streets.js';

const config = JSON.parse(readFileSync(new URL('../public/data/bike-models.json', import.meta.url)));
const edge = (o) => ({ road_class: 'RESIDENTIAL', bike_infra: false, oneway: false, push: false, average_slope: 0, ...o });

test('conditions: comparisons, enums, booleans, precedence', () => {
  const c = compileCondition('road_class == PRIMARY && !bike_infra || average_slope >= 8');
  assert.equal(c(edge({ road_class: 'PRIMARY' })), true);
  assert.equal(c(edge({ road_class: 'PRIMARY', bike_infra: true })), false);
  assert.equal(c(edge({ average_slope: 8 })), true);
  assert.equal(compileCondition('(oneway || push) && road_class != STEPS')(edge({ push: true })), true);
});

test('conditions: bad input says what is wrong', () => {
  assert.throws(() => compileCondition('road_class == AVENIDA'), /não conheço “AVENIDA”/);
  assert.throws(() => compileCondition('average_slope'), /não é uma condição/);
  assert.throws(() => compileCondition('road_class > PRIMARY'), /só vale para números/);
  assert.throws(() => compileCondition('bike_infra &&'), /esperava/);
  assert.throws(() => compileCondition('bike_infra; alert(1)'), /símbolo inesperado/);
});

test('priority: first match per if-block, blocks multiply', () => {
  const p = compilePriority([
    { if: 'road_class == PRIMARY', multiply_by: 0.5 },
    { else_if: 'road_class == SECONDARY', multiply_by: 0.8 },
    { else: true, multiply_by: 1.2 },
    { if: 'average_slope > 5', multiply_by: 0.5 },
  ]);
  assert.equal(p(edge({ road_class: 'PRIMARY' })), 0.5);
  assert.equal(p(edge({ road_class: 'SECONDARY', average_slope: 6 })), 0.4);
  assert.equal(p(edge({})), 1.2);
  assert.throws(() => compilePriority([{ else_if: 'push', multiply_by: 1 }]), /sem um if/);
  assert.throws(() => compilePriority([{ if: 'push', multiply_by: -1 }]), /≥ 0/);
});

test('every model and preference in bike-models.json compiles', () => {
  for (const name of Object.keys(config.models)) {
    compilePriority(composeModel(config, name, Object.keys(config.preferences)).priority);
  }
  assert.ok(config.models[config.default]);
});

// The default model must route exactly like the built-in comfort table (and with
// "Evitar avenidas", like avoidArterials), for every kind of street and slope.
test('the default model reproduces the built-in comfort table', () => {
  for (const avoidArterials of [false, true]) {
    const legacy = bikeModel(80, { avoidArterials });
    const prefs = avoidArterials ? ['avoidArterials'] : [];
    const model = bikeModel(80, { model: composeModel(config, 'padrao', prefs) });
    for (let flags = 0; flags < 256; flags++) {
      if (flags & 16) continue; // no bikes there anyway
      for (const dh of [-8, 0, 3]) {
        const a = edgeCost('bike', 100, dh, flags, legacy), b = edgeCost('bike', 100, dh, flags, model);
        assert.ok(Math.abs(a.comfort - b.comfort) < 1e-3 * a.comfort, `flags ${flags}, dh ${dh}: ${a.comfort} vs ${b.comfort}`);
        assert.equal(a.t, b.t);
      }
    }
  }
});

test('a factor of 0 leaves the street out; slopes count uphill only', () => {
  const trunk = 5;
  const noTrunk = bikeModel(80, { model: composeModel(config, 'direto', ['avoidTrunk']) });
  assert.equal(edgeCost('bike', 100, 0, trunk, noTrunk).comfort, Infinity);
  assert.equal(edgeCost('bike', 100, 0, trunk | 64, noTrunk).comfort, 1); // with a bike lane
  const steep = bikeModel(80, { model: composeModel(config, 'direto', ['avoidSteep']) });
  assert.ok(Math.abs(edgeCost('bike', 100, 10, 1, steep).comfort - 5) < 1e-6);
  assert.equal(edgeCost('bike', 100, -10, 1, steep).comfort, 1);
});
