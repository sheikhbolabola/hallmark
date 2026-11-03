# Sloplint regressions

Run from the repository root with Node 20 or later:

```sh
node --test skills/hallmark/scripts/sloplint.test.mjs
```

The `verify` workflow runs this explicit CLI regression step alongside the existing
`refcheck.mjs` checks. Refcheck already exercises positive and negative fixtures;
this suite adds exit-code checks, isolated mutations and preservation controls.
No npm install, credentials, browser or network requests are required by the tests.

The suite checks:

- Clean eyebrow and Tailwind examples: exit 0, no FAIL, REFLEX or WARN findings.
- Negative examples: exit 1 and specific gate IDs and severities, including six
  eyebrow violations. A crash or unrelated failure cannot satisfy the assertions.
- Paired source mutations for keyboard focus (26a), SVG accessibility (33),
  overflow policy and scrollbar width (34), and reduced motion (27).
- `--before` inventories in isolated temporary directories, an unchanged clean
  page with `--kept` exit 0, and a style-only redesign with no preservation findings.
- Separate removal of a link, field, inline handler, test hook and queried script
  hook; each must produce its own `kept` failure. The supplied broken redesign
  must report all five losses and the removed ID warning.
- Documented mailto removal is accepted; undocumented removal and a missing
  snapshot are rejected. Temporary snapshots are removed after each test.

The old kept fixture has unrelated design failures. Its preservation assertions
therefore inspect the `kept` gate specifically; they do not call that page clean.
`--before` deliberately exits 0 while recording an imperfect original page.

The theme-index workflow comparison ignores only the generated `built` date.
All remaining JSON data must match the committed index, so a calendar change
does not fail CI while a stale theme index still does.

## Limits

These are static CLI regressions, not a browser or WCAG audit. Gate 34 checks
source overflow rules, not actual layout at mobile widths. Gate 27 recognizes a
reduced-motion fallback; it does not prove that every animation stops. Handler
and selector preservation does not prove that a booking or submission succeeds.
The Tailwind fixtures contain CDN scripts and uncompiled framework sources;
the static suite does not fetch or execute them.

For rendered checks, install Puppeteer/Chrome using the project's documented
render setup, then run `sloplint.mjs <page> --render --json`. Inspect
`summary.render`: `not run: ...` is unavailable coverage even when the command
exits 0. Verify real mobile layouts, keyboard interaction, contrast and motion
with a working browser before claiming visual or interaction acceptance.
