import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'sloplint.mjs');
const dirLink = (target, link) => symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
const cleanCss = ':root { --paper: #f3f2ef; }';
const badCss = 'body { background: #fff; color: #000; }';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hallmark-collect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function lint(cwd, paths, flags = []) {
  const run = spawnSync(process.execPath, [CLI, ...paths, ...flags, '--json'], { cwd, encoding: 'utf8', timeout: 5000 });
  assert.ifError(run.error);
  assert.equal(run.signal, null, run.stderr);
  assert.equal(run.stderr, '');
  return { status: run.status, report: JSON.parse(run.stdout) };
}

for (const cycle of ['self', 'ancestor']) test(`terminates a ${cycle} directory cycle`, (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'style.css'), badCss);
  const baseline = lint(root, ['.']);
  dirLink(cycle === 'self' ? join(root, 'nested') : root, join(root, 'nested', 'loop'));
  assert.deepEqual(lint(root, ['.']), baseline);
  assert.equal(baseline.report.summary.files, 1);
  assert.equal(baseline.status, 1);
});

test('external directory aliases lint each real CSS and document once, keeping the first path', (t) => {
  const root = fixture(t);
  const project = join(root, 'project');
  const shared = join(root, 'shared');
  mkdirSync(project);
  mkdirSync(shared);
  writeFileSync(join(shared, 'style.css'), badCss);
  writeFileSync(join(shared, 'page.html'), '<main><h1>Shared page</h1></main>');
  dirLink(shared, join(project, 'a-shared'));
  dirLink(shared, join(project, 'b-shared'));
  const baseline = lint(project, ['a-shared']);
  const result = lint(project, ['.', 'b-shared', shared]);
  assert.deepEqual(result, baseline);
  assert.equal(result.report.summary.files, 2);
  assert.equal(result.status, 1);
  assert.ok(result.report.findings.length > 0);
  assert.ok(result.report.findings.every((f) => f.file.startsWith(join('a-shared', ''))));
});

// File symlinks require Windows privileges, unlike directory junctions above.
test('file aliases and repeated explicit paths produce one set of findings', { skip: process.platform === 'win32' }, (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'style.css'), badCss);
  symlinkSync(join(root, 'style.css'), join(root, 'alias.css'), 'file');
  const baseline = lint(root, ['style.css']);
  assert.deepEqual(lint(root, ['style.css', 'alias.css', 'style.css']), baseline);
  assert.equal(baseline.report.summary.files, 1);
  assert.equal(baseline.status, 1);
});

const buildDirs = ['dist', 'build', 'coverage'];
const permutations = (xs) => xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => j !== i)).map((tail) => [x, ...tail])) : [[]];
const buildCases = [['.'], ...buildDirs.flatMap((d) => [[d], ['.', d], [d, '.']]), ...permutations(['.', ...buildDirs])];
for (const paths of buildCases) test(`build targets: ${paths.join(' ')}`, (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'source.css'), cleanCss);
  for (const dir of [...buildDirs, 'node_modules', '.hidden']) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, 'page.css'), badCss);
  }
  const explicit = paths.filter((p) => p !== '.');
  const { report, status } = lint(root, paths);
  assert.equal(report.summary.files, explicit.length + Number(paths.includes('.')));
  assert.equal(status, explicit.length ? 1 : 0);
  for (const dir of explicit) assert.ok(report.findings.some((f) => f.file === join(dir, 'page.css')));
  assert.ok(report.findings.every((f) => explicit.some((dir) => f.file === join(dir, 'page.css'))));
});

test('a skipped directory does not consume the realpath of an eligible alias', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'page.css'), badCss);
  dirLink(join(root, 'build'), join(root, 'z-source'));
  const baseline = lint(root, ['z-source']);
  assert.deepEqual(lint(root, ['.']), baseline);
  assert.equal(baseline.report.summary.files, 1);
  assert.equal(baseline.status, 1);
});

test('--before and --kept preserve inventories and detect losses with aliases and a cycle', (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'project'));
  mkdirSync(join(root, 'shared'));
  const project = join(root, 'project');
  const page = join(root, 'shared', 'index.html');
  copyFileSync(join(HERE, 'fixtures', 'kept', 'before.html'), page);
  dirLink(join(root, 'shared'), join(project, 'a-shared'));
  dirLink(join(root, 'shared'), join(project, 'b-shared'));
  dirLink(project, join(project, 'loop'));
  const before = lint(project, ['.'], ['--before']);
  assert.equal(before.status, 0);
  assert.equal(before.report.summary.files, 1);
  assert.ok(before.report.summary.before);
  const snapshot = JSON.parse(readFileSync(join(project, '.hallmark', 'before.json'), 'utf8'));
  assert.deepEqual(Object.keys(snapshot.files), [join('a-shared', 'index.html')]);
  assert.ok(snapshot.wiring.links.includes('rooms.html'));
  assert.ok(snapshot.wiring.fields.includes('nights'));
  const unchanged = lint(project, ['.'], ['--kept']);
  assert.equal(unchanged.report.summary.files, 1);
  assert.ok(unchanged.report.summary.kept);
  assert.ok(!unchanged.report.findings.some((f) => f.gate === 'kept'));
  copyFileSync(join(HERE, 'fixtures', 'kept', 'after.html'), page);
  const changed = lint(project, ['.'], ['--kept']);
  assert.equal(changed.status, 1);
  const kept = changed.report.findings.filter((f) => f.gate === 'kept');
  const fails = kept.filter((f) => f.grade === 'FAIL').map((f) => f.evidence).join(' | ');
  for (const lost of ['rooms.html', 'nights', "track('book')", 'book-button', '#nav-toggle']) assert.ok(fails.includes(lost), lost);
  assert.ok(!fails.includes('mailto:'));
  assert.ok(kept.some((f) => f.grade === 'WARN' && f.evidence.includes('nav-toggle')));
  assert.equal(changed.report.summary.files, 1);
});
