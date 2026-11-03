import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = dirname(fileURLToPath(import.meta.url));
const lint = join(scripts, 'sloplint.mjs');
const fixtures = join(scripts, 'fixtures');

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hallmark-regression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Exercise the real CLI. A crash, timeout, invalid JSON or incorrect exit status
// must fail the test rather than masquerade as a detected design violation.
function run(cwd, target, ...flags) {
  const result = spawnSync(process.execPath, [lint, target, '--json', ...flags], {
    cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(Array.isArray(report.findings));
  assert.ok(report.summary.files > 0, 'the fixture must actually be read');
  assert.equal(report.summary.render, 'off');
  const expected = flags.includes('--before') ? 0
    : (report.summary.fails || report.summary.reflex ? 1 : 0);
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return { ...report, status: result.status };
}

function findings(report, gate, grade) {
  return report.findings.filter((f) => f.gate === gate && (!grade || f.grade === grade));
}

for (const name of ['eyebrow-pass', 'tailwind-pass']) {
  test(`${name}: exit 0 with no FAIL, REFLEX or WARN`, (t) => {
    const r = run(workspace(t), join(fixtures, name));
    assert.equal(r.status, 0);
    for (const key of ['fails', 'reflex', 'warns']) assert.equal(r.summary[key], 0, key);
  });
}

test('eyebrow-fail: exit 1 and exactly six gate 54 failures', (t) => {
  const r = run(workspace(t), join(fixtures, 'eyebrow-fail'));
  assert.equal(r.status, 1);
  assert.equal(findings(r, '54', 'FAIL').length, 6);
});

test('tailwind-fail: expected gates and severity, including focus and reduced motion', (t) => {
  const r = run(workspace(t), join(fixtures, 'tailwind-fail'));
  assert.equal(r.status, 1);
  const expected = {
    FAIL: ['67', '54', '10a', '2a', '6a', '34', '48', '26a', '27'],
    REFLEX: ['64', '12', '2b'], WARN: ['11', '29', '74', '3'],
  };
  for (const [grade, gates] of Object.entries(expected)) {
    for (const gate of gates) assert.ok(findings(r, gate, grade).length, `${grade} ${gate}`);
  }
});

// Paired mutations isolate a rule, instead of relying on unrelated failures in
// the deliberately slopped pages. These check source recognition, not rendering.
const cssCases = [
  ['CSS reduced motion', '27', '.probe { animation: arrival 1s; } @keyframes arrival { from { opacity: 0; } to { opacity: 1; } }',
    '@media (prefers-reduced-motion: reduce) { .probe { animation: none; } }'],
  ['keyboard focus', '26a', '', ':focus-visible { outline: 2px solid currentColor; }'],
  ['horizontal overflow policy', '34', 'html, body { overflow-x: hidden; }', 'html, body { overflow-x: clip; }'],
  ['scrollbar width overflow', '34', 'main { width: 100vw; }', 'main { width: 100%; }'],
];
for (const [name, gate, broken, fixed] of cssCases) {
  test(`${name}: detects the violation and accepts the correction`, (t) => {
    const dir = workspace(t);
    const base = readFileSync(join(fixtures, 'eyebrow-pass/index.html'), 'utf8');
    let src = gate === '26a' ? base.replace(':focus-visible', '.removed-focus') : base;
    if (name === 'horizontal overflow policy') src = src.replace('html, body { overflow-x: clip; }', '');
    const write = (css) => writeFileSync(join(dir, 'index.html'), src.replace('</style>', `${css}\n</style>`));
    write(broken);
    assert.ok(findings(run(dir, 'index.html'), gate, 'FAIL').length, `missing gate ${gate}`);
    write(name === 'CSS reduced motion' ? broken + fixed : fixed);
    assert.equal(findings(run(dir, 'index.html'), gate).length, 0);
  });
}

test('SVG accessibility: missing name fails; decorative aria-hidden passes gate 33', (t) => {
  const dir = workspace(t);
  const base = readFileSync(join(fixtures, 'eyebrow-pass/index.html'), 'utf8');
  for (const [attrs, count] of [['', 1], [' aria-hidden="true"', 0]]) {
    writeFileSync(join(dir, 'index.html'), base.replace('</body>', `<svg${attrs} viewBox="0 0 16 16"></svg></body>`));
    assert.equal(findings(run(dir, 'index.html'), '33', 'FAIL').length, count);
  }
});

const before = readFileSync(join(fixtures, 'kept/before.html'), 'utf8');
function record(t) {
  const dir = workspace(t);
  writeFileSync(join(dir, 'index.html'), before);
  const r = run(dir, 'index.html', '--before');
  assert.equal(r.status, 0); // Recording is allowed even when the old design fails gates.
  assert.ok(r.summary.before);
  const snapshot = join(dir, '.hallmark/before.json');
  assert.ok(existsSync(snapshot));
  const inventory = JSON.parse(readFileSync(snapshot, 'utf8'));
  assert.ok(inventory.wiring.links.includes('rooms.html'));
  assert.ok(inventory.wiring.fields.includes('nights'));
  assert.ok(inventory.wiring.handlers.includes(`onclick="track('book')"`));
  return dir;
}

test('clean page: --before then unchanged --kept exits 0', (t) => {
  const dir = workspace(t);
  cpSync(join(fixtures, 'tailwind-pass'), join(dir, 'page'), { recursive: true });
  run(dir, 'page', '--before');
  const r = run(dir, 'page', '--kept');
  assert.equal(r.status, 0);
  assert.equal(findings(r, 'kept').length, 0);
  assert.match(r.summary.kept, /links \d+\/\d+/);
});

test('kept fixture: style-only redesign preserves all recorded wiring', (t) => {
  const dir = record(t);
  writeFileSync(join(dir, 'index.html'), before.replace('font-family: sans-serif', 'font-family: serif'));
  assert.equal(findings(run(dir, 'index.html', '--kept'), 'kept').length, 0);
});

const losses = [
  ['link', '<a href="rooms.html">Rooms</a>', '', 'links', 'rooms.html'],
  ['field', '<input name="nights" type="number">', '', 'fields', 'nights'],
  ['handler', ` onclick="track('book')"`, '', 'handlers', `track('book')`],
  ['test hook', ' data-testid="book-button"', '', 'test hooks', 'book-button'],
  ['script hook', 'id="nav-toggle"', 'id="menu-button"', 'a script still queries', '#nav-toggle'],
];
for (const [name, old, replacement, category, needle] of losses) {
  test(`--kept rejects isolated lost ${name}`, (t) => {
    const dir = record(t);
    assert.ok(before.includes(old), 'mutation must change the fixture');
    writeFileSync(join(dir, 'index.html'), before.replace(old, replacement));
    const r = run(dir, 'index.html', '--kept');
    assert.equal(r.status, 1);
    const hard = findings(r, 'kept', 'FAIL');
    assert.equal(hard.length, 1, JSON.stringify(hard));
    assert.ok(hard[0].evidence.includes(category), hard[0].evidence);
    assert.ok(hard[0].evidence.includes(needle), hard[0].evidence);
  });
}

test('supplied after.html detects all losses and honours documented mailto removal', (t) => {
  const dir = record(t);
  cpSync(join(fixtures, 'kept/after.html'), join(dir, 'index.html'));
  const r = run(dir, 'index.html', '--kept');
  const hard = findings(r, 'kept', 'FAIL').map((f) => f.evidence).join('\n');
  for (const needle of ['rooms.html', 'nights', `track('book')`, 'book-button', '#nav-toggle']) {
    assert.ok(hard.includes(needle), needle);
  }
  assert.ok(!hard.includes('mailto:desk@example.com'));
  assert.ok(findings(r, 'kept', 'WARN').some((f) => f.evidence.includes('nav-toggle')));
});

test('mailto removal without an explanatory stamp fails preservation', (t) => {
  const dir = record(t);
  writeFileSync(join(dir, 'index.html'), before.replace('<a href="mailto:desk@example.com">Email the desk</a>', ''));
  assert.ok(findings(run(dir, 'index.html', '--kept'), 'kept', 'FAIL')
    .some((f) => f.evidence.includes('mailto:desk@example.com')));
});

test('--kept without a snapshot fails explicitly', (t) => {
  const dir = workspace(t);
  writeFileSync(join(dir, 'index.html'), before);
  assert.ok(findings(run(dir, 'index.html', '--kept'), 'kept', 'FAIL')
    .some((f) => f.evidence.includes('no before record')));
});
