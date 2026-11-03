import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../imagegen.mjs', import.meta.url));
const guard = fileURLToPath(new URL('./network-guard.mjs', import.meta.url));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUioAAAAASUVORK5CYII=';
const otherPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const prompt = 'Rye loaves on a flour-dusted counter';

function fixture(check) {
  const dir = mkdtempSync(join(tmpdir(), 'hallmark-provider-test-'));
  try {
    const trace = join(dir, 'trace.jsonl');
    const response = join(dir, 'response.json');
    writeFileSync(response, JSON.stringify([png, otherPng]));
    const run = (args, { key = true, plain = false } = {}) => {
      rmSync(trace, { force: true });
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.TOGETHER_API_KEY;
      env.HALLMARK_TEST_TRACE = trace;
      env.HALLMARK_TEST_RESPONSE = response;
      if (key) env.TOGETHER_API_KEY = 'offline-test-key';
      const result = spawnSync(process.execPath, ['--import', guard, script, ...args, ...(plain ? [] : ['--json'])], {
        cwd: dir, env, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.error, undefined);
      const calls = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse) : [];
      assert.equal(calls.some(call => call.forbidden), false);
      return { code: result.status, report: plain ? result.stdout.trim() : JSON.parse(result.stdout), calls };
    };
    check({ dir, run, response });
  } finally { rmSync(dir, { force: true, recursive: true }); }
}

for (const output of [[], ['--out', 'chosen.png'], ['--out', 'nested/chosen']]) {
  for (const n of [1, 2]) {
    test('mocked generation, cache reuse and force: n=' + n + ' ' + (output[1] ?? 'default'), () => {
      fixture(({ dir, run, response }) => {
        writeFileSync(response, JSON.stringify([png, otherPng].slice(0, n)));
        const args = [prompt, '--n', String(n), ...output];
        const generated = run(args);
        assert.equal(generated.code, 0);
        assert.equal(generated.report.cached, false);
        assert.equal(generated.calls.length, 1);
        assert.equal(generated.calls[0].body.n, n);
        assert.equal(generated.calls[0].body.prompt, prompt);
        assert.equal(generated.calls[0].body.response_format, 'b64_json');
        const paths = generated.report.paths;
        assert.equal(paths.length, n);
        paths.forEach((path, i) => assert.deepEqual(readFileSync(resolve(dir, path)), Buffer.from([png, otherPng][i], 'base64')));
        for (const key of [true, false]) {
          const cached = run(args, { key });
          assert.equal(cached.code, 0);
          assert.equal(cached.report.cached, true);
          assert.equal(cached.report.path, paths[0]);
          assert.deepEqual(cached.report.paths, paths);
          assert.deepEqual(cached.calls, []);
        }
        const plain = run(args, { plain: true });
        assert.equal(plain.code, 0);
        assert.equal(plain.report, paths[0]);
        assert.deepEqual(plain.calls, []);
        writeFileSync(response, JSON.stringify(Array(n).fill(otherPng)));
        const forced = run([...args, '--force']);
        assert.equal(forced.code, 0);
        assert.equal(forced.report.cached, false);
        assert.equal(forced.calls.length, 1);
        assert.deepEqual(forced.report.paths, paths);
        paths.forEach(path => assert.deepEqual(readFileSync(resolve(dir, path)), Buffer.from(otherPng, 'base64')));
      });
    });
  }
}

for (const change of [
  ['Different prompt'], [prompt, '--model', 'different/model'],
  [prompt, '--size', '512x512'], [prompt, '--steps', '8'], [prompt, '--n', '1'],
]) {
  test('explicit output rejects changed request: ' + change.join(' '), () => {
    fixture(({ dir, run }) => {
      const initial = run([prompt, '--n', '2', '--out', 'chosen.png']);
      assert.equal(initial.code, 0);
      const before = initial.report.paths.map(path => readFileSync(resolve(dir, path)));
      const result = run(['--n', '2', ...change, '--out', 'chosen.png'], { key: false });
      assert.equal(result.code, 3);
      assert.equal(result.report.error, 'no-key');
      assert.deepEqual(result.calls, []);
      initial.report.paths.forEach((path, i) => assert.deepEqual(readFileSync(resolve(dir, path)), before[i]));
    });
  });
}

test('explicit output requires readable matching metadata', () => {
  fixture(({ dir, run }) => {
    const args = [prompt, '--n', '2', '--out', 'chosen.png'];
    assert.equal(run(args).code, 0);
    for (const metadata of [null, '{invalid json', '{}']) {
      if (metadata === null) rmSync(join(dir, 'chosen.json'));
      else writeFileSync(join(dir, 'chosen.json'), metadata);
      const result = run(args, { key: false });
      assert.equal(result.code, 3);
      assert.equal(result.report.error, 'no-key');
      assert.deepEqual(result.calls, []);
    }
  });
});
