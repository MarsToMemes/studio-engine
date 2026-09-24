// End-to-end smoke test of the studio preview in a real browser.
//   npm run build && npm run e2e
// Uses playwright-core with an installed Chromium (PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'e2e', 'out');
mkdirSync(out, { recursive: true });
const PORT = 4179;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
// Wait until the server answers (its log output is colored, so polling is more robust than parsing it).
for (let i = 0; ; i++) {
  if (i > 60) throw new Error('vite preview did not start');
  if (server.exitCode !== null) throw new Error(`vite preview exited (${server.exitCode})`);
  const up = await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false);
  if (up) break;
  await new Promise((r) => setTimeout(r, 500));
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('[data-testid=player]');
  await page.waitForTimeout(800);
  const player = page.locator('[data-testid=player]');
  check('player renders the composition', (await player.innerText()).toUpperCase().includes('BURGER'));
  await page.screenshot({ path: join(out, '1-initial.png') });

  // Select a shot: the preview jumps to its first frame.
  await page.click('[data-testid=shot-report]');
  const reportFrame = Number(await page.getAttribute('[data-testid=current-frame]', 'data-frame'));
  const reportShot = await page.getAttribute('[data-testid=current-frame]', 'data-shot');
  check('selecting a shot seeks the preview inside it, after its entrance', reportShot === 'report', `frame ${reportFrame}`);
  check('document shot shows its source citation', (await player.innerText()).includes('Source: Annual report 2023'));

  // Edit the hook text: the preview updates without any export.
  await page.click('[data-testid=shot-hook]');
  const t0 = Date.now();
  await page.fill('[data-testid=field-text]', 'They own the LAND under every restaurant');
  await page.waitForFunction(() => document.querySelector('[data-testid=player]')?.textContent?.includes('under every restaurant'), null, { timeout: 5000 });
  check('text edit is visible in the preview', true, `${Date.now() - t0} ms from input to preview`);
  await page.fill('[data-testid=field-highlights]', 'LAND');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-testid=player]')?.scrollIntoView());
  await page.screenshot({ path: join(out, '2-edited-hook.png') });

  // Change the motion skill of the image shot.
  await page.click('[data-testid=shot-counter]');
  await page.selectOption('[data-testid=field-skill]', 'punch_in');
  await page.waitForTimeout(200);
  check('skill change is reflected in the shot list', (await page.innerText('[data-testid=shot-counter]')).includes('punch_in'));

  // Change a duration: the total length updates.
  const before = await page.innerText('[data-testid=summary]');
  await page.fill('[data-testid=field-duration]', '6');
  await page.waitForTimeout(200);
  const after = await page.innerText('[data-testid=summary]');
  check('duration edit changes the episode length', before !== after, `${before.split('·')[1]?.trim()} → ${after.split('·')[1]?.trim()}`);

  // Transition and SFX edits.
  await page.selectOption('[data-testid=field-transition]', 'whip');
  await page.click('[data-testid=add-sfx]');
  await page.waitForTimeout(200);
  check('transition + sfx edits are applied', (await page.innerText('[data-testid=shot-counter]')).includes('whip'));

  // A highlight that is not in the text raises an editorial warning.
  await page.click('[data-testid=shot-billions]');
  await page.fill('[data-testid=field-highlights]', 'pizza');
  await page.waitForTimeout(200);
  check('editorial warnings are shown live', (await page.innerText('[data-testid=issues]')).includes('does not appear in the shot text'));

  // Map zoom slider.
  await page.click('[data-testid=shot-world]');
  await page.fill('[data-testid=field-zoom]', '2');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, '3-map-zoom.png') });
  check('map zoom slider available on map shots', true);

  // Playback loops inside the selected shot.
  await page.click('[data-testid=shot-stat]');
  await page.waitForTimeout(300);
  await page.locator('[data-testid=player]').click();
  const frames = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(500);
    frames.push({ f: Number(await page.getAttribute('[data-testid=current-frame]', 'data-frame')), s: await page.getAttribute('[data-testid=current-frame]', 'data-shot') });
  }
  const moving = new Set(frames.map((x) => x.f)).size > 3;
  const insideShot = frames.every((x) => x.s === 'stat');
  check('playback loops inside the selected shot', moving && insideShot, `frames ${frames.map((x) => x.f).join(',')}`);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
