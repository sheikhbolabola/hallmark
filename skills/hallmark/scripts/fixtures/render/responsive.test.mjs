import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderCheck } from '../../sloplint-render.mjs';

test('renderCheck runs mechanical checks at the documented responsive widths', async (t) => {
  const doc = readFileSync(new URL('../../../references/responsive.md', import.meta.url), 'utf8');
  const widths = doc.match(/sloplint covers the mechanical half at ([\d, ]+ and \d+):/);
  assert.ok(widths, 'responsive.md lists the mechanical check widths');

  const dir = mkdtempSync(join(tmpdir(), 'hallmark-render-'));
  const previous = { HALLMARK_PUPPETEER: process.env.HALLMARK_PUPPETEER, CHROME_PATH: process.env.CHROME_PATH };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  // Record browser calls without requiring Chromium or Puppeteer in CI.
  const stub = join(dir, 'node_modules', 'puppeteer-core');
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, 'index.js'), `
    let viewport;
    module.exports.launch = async () => ({
      close: async () => {},
      newPage: async () => ({
        on() {},
        emulateMediaFeatures: async () => {},
        goto: async () => {},
        close: async () => {},
        screenshot: async () => { throw new Error('Screenshots disabled in this test'); },
        keyboard: { press: async () => {} },
        setViewport: async (value) => { viewport = value; },
        evaluate: async (fn, ...args) => {
          if (['observe', 'observeSpace', 'lineBreaks'].includes(fn.name)) {
            return [{ gate: fn.name, evidence: JSON.stringify([viewport, ...args.slice(0, 1)]) }];
          }
          return [];
        },
      }),
    });
  `);
  process.env.HALLMARK_PUPPETEER = dir;
  process.env.CHROME_PATH = process.execPath;

  const findings = await renderCheck([join(dir, 'page.html')]);
  assert.equal(findings.notRun, undefined);
  assert.deepEqual(findings.failed, []);

  const calls = (gate) => findings.filter((f) => f.gate === gate)
    .map((f) => JSON.parse(f.evidence.replace(/^\[\d+px\] /, '')));
  assert.deepEqual(calls('observe'), widths[1].match(/\d+/g).map(Number)
    .map((width) => [{ width, height: 800 }, width === 1280]));
  assert.deepEqual(calls('observeSpace'), [
    [{ width: 1440, height: 900 }, true],
    [{ width: 1920, height: 1080 }, false],
  ]);
  assert.deepEqual(calls('lineBreaks'), [[{ width: 375, height: 800 }], [{ width: 1280, height: 800 }]]);
});
