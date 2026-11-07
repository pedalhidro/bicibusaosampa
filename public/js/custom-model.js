// Road preferences for cycling legs, written like GraphHopper's custom models
// (https://docs.graphhopper.com/openapi/custom-model), priority part only:
//
//   { "priority": [
//       { "if": "road_class == PRIMARY && !bike_infra", "multiply_by": 0.5 },
//       { "else_if": "road_class == CYCLEWAY", "multiply_by": 1.25 },
//       { "if": "average_slope > 6", "multiply_by": 0.5 } ] }
//
// Each `if` starts a block; within a block the first matching `if` / `else_if` / `else`
// applies, and the factors of all blocks multiply. The route search counts each street
// as (time or energy) ÷ priority, so priority 0.5 makes a street "cost" double and 0
// leaves it out. Times and kcal shown stay the real ones: models only steer the route.
// Unlike GraphHopper, factors above 1 are allowed (a cycleway counts less than a
// street). Speed statements aren't supported: speed comes from the power model.
//
// Variables, all from data/routing/streets.bin:
//   road_class    CYCLEWAY, RESIDENTIAL (any local street), TERTIARY, SECONDARY,
//                 PRIMARY, TRUNK, FOOTWAY, STEPS
//   bike_infra    bike lane or track along the street
//   oneway        one-way for bikes
//   push          bikes must be walked (footways, pedestrian streets)
//   average_slope grade in %, positive uphill in the direction of travel
// Operators: == != < <= > >= && || ! and parentheses; numbers, true, false.

export const ROAD_CLASSES = ['CYCLEWAY', 'RESIDENTIAL', 'TERTIARY', 'SECONDARY', 'PRIMARY', 'TRUNK', 'FOOTWAY', 'STEPS'];
const VARIABLES = { road_class: 'enum', bike_infra: 'bool', oneway: 'bool', push: 'bool', average_slope: 'number' };

// ------------------------------------------------------------------ expressions

function tokenize(src) {
  const lexed = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[<>!()]))/y;
  let m;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    if (!(m = re.exec(src))) {
      if (!src.slice(at).trim()) break;
      throw new Error(`símbolo inesperado em “${src.slice(at).trim()}”`);
    }
    if (m[1]) lexed.push({ kind: 'num', value: Number(m[1]) });
    else if (m[2]) lexed.push({ kind: 'id', value: m[2] });
    else lexed.push({ kind: 'op', value: m[3] });
  }
  return lexed;
}

/**
 * Compiles a condition ("road_class == PRIMARY && !bike_infra") into a function of an
 * edge { road_class, bike_infra, oneway, push, average_slope }. Throws on bad input,
 * with a message for the person editing the model. No eval.
 */
export function compileCondition(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (value) => {
    const t = toks[i];
    if (!t || (value && t.value !== value)) throw new Error(`esperava “${value ?? 'algo'}” em “${src}”`);
    i++;
    return t;
  };

  // A value: { type, get(edge) }.
  function primary() {
    const t = take();
    if (t.kind === 'op' && t.value === '(') {
      const inner = or();
      take(')');
      return inner;
    }
    if (t.kind === 'num') return { type: 'number', get: () => t.value };
    if (t.kind === 'id') {
      if (t.value === 'true' || t.value === 'false') return { type: 'bool', get: () => t.value === 'true' };
      if (t.value in VARIABLES) return { type: VARIABLES[t.value], get: (e) => e[t.value] };
      if (ROAD_CLASSES.includes(t.value)) return { type: 'enum', get: () => t.value };
      throw new Error(`não conheço “${t.value}” (variáveis: ${Object.keys(VARIABLES).join(', ')}; road_class: ${ROAD_CLASSES.join(', ')})`);
    }
    throw new Error(`“${t.value}” fora do lugar em “${src}”`);
  }
  function comparison() {
    const left = primary();
    const op = peek();
    if (!op || op.kind !== 'op' || !['==', '!=', '<', '<=', '>', '>='].includes(op.value)) return left;
    i++;
    const right = primary();
    if (left.type !== right.type) throw new Error(`não dá para comparar ${left.type} com ${right.type} em “${src}”`);
    if (left.type !== 'number' && !['==', '!='].includes(op.value)) throw new Error(`“${op.value}” só vale para números em “${src}”`);
    const a = left.get, b = right.get;
    const f = { '==': (e) => a(e) === b(e), '!=': (e) => a(e) !== b(e), '<': (e) => a(e) < b(e), '<=': (e) => a(e) <= b(e), '>': (e) => a(e) > b(e), '>=': (e) => a(e) >= b(e) }[op.value];
    return { type: 'bool', get: f };
  }
  function unary() {
    if (peek()?.value === '!') {
      i++;
      const inner = unary();
      if (inner.type !== 'bool') throw new Error(`“!” precisa de condição em “${src}”`);
      return { type: 'bool', get: (e) => !inner.get(e) };
    }
    return comparison();
  }
  const chain = (next, op, join) => () => {
    let left = next();
    while (peek()?.value === op) {
      i++;
      const right = next();
      if (left.type !== 'bool' || right.type !== 'bool') throw new Error(`“${op}” liga condições em “${src}”`);
      const a = left.get, b = right.get;
      left = { type: 'bool', get: join(a, b) };
    }
    return left;
  };
  const and = chain(unary, '&&', (a, b) => (e) => a(e) && b(e));
  const or = chain(and, '||', (a, b) => (e) => a(e) || b(e));

  const out = or();
  if (i < toks.length) throw new Error(`sobrou “${toks.slice(i).map((t) => t.value).join(' ')}” em “${src}”`);
  if (out.type !== 'bool') throw new Error(`“${src}” não é uma condição`);
  return out.get;
}

// ------------------------------------------------------------------ models

/**
 * Compiles a model's `priority` list into a function edge → factor (≥ 0).
 * Throws with a readable message on a bad statement.
 */
export function compilePriority(statements = []) {
  if (!Array.isArray(statements)) throw new Error('“priority” tem que ser uma lista');
  const blocks = [];
  statements.forEach((st, n) => {
    const where = `regra ${n + 1}`;
    const keys = ['if', 'else_if', 'else'].filter((k) => k in st);
    if (keys.length !== 1) throw new Error(`${where}: use um de if, else_if ou else`);
    const factor = Number(st.multiply_by);
    if (!Number.isFinite(factor) || factor < 0) throw new Error(`${where}: multiply_by tem que ser um número ≥ 0`);
    const key = keys[0];
    if (key === 'if') blocks.push([]);
    else if (!blocks.length || blocks.at(-1).closed) throw new Error(`${where}: ${key} sem um if antes`);
    const block = blocks.at(-1);
    block.push({ test: key === 'else' ? () => true : compileCondition(st[key]), factor });
    if (key === 'else') block.closed = true;
  });
  return (edge) => {
    let p = 1;
    for (const block of blocks) {
      for (const { test, factor } of block) {
        if (test(edge)) { p *= factor; break; }
      }
    }
    return p;
  };
}

/**
 * The model the planner runs: the chosen base model's priority (after the model it
 * `extends`, if any), then the statements of each preference turned on (keys of `config.preferences`). `config` is
 * data/bike-models.json; a `custom` model object replaces the base model.
 */
export function composeModel(config, name, preferences = [], custom = null) {
  const base = custom ?? config.models[name] ?? config.models[config.default];
  const priority = modelPriority(config, base);
  for (const key of preferences) priority.push(...(config.preferences[key]?.priority ?? []));
  return { priority };
}

/** A model's statements, after those of the model it `extends` (by name). */
function modelPriority(config, model, seen = new Set()) {
  if (!model) return [];
  const parent = model.extends && config.models[model.extends];
  if (model.extends && (!parent || seen.has(model.extends))) throw new Error(`extends: estilo “${model.extends}” não existe`);
  if (model.extends) seen.add(model.extends);
  return [...(parent ? modelPriority(config, parent, seen) : []), ...(model.priority ?? [])];
}
