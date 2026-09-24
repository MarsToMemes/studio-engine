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


  // ---------------------------------------------------------------- Timeline
  await page.click('button:has-text("Reset")');
  await page.click('[data-testid=loop-shot]'); // free playhead for timeline checks
  if ((await page.getAttribute('[data-testid=current-frame]', 'data-playing')) === 'true') await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  check('Space toggles playback', (await page.getAttribute('[data-testid=current-frame]', 'data-playing')) === 'false');
  await page.waitForTimeout(500);
  const shotCount = await page.locator('[data-testid^=tl-shot-]').count();
  check('timeline shows every shot as a block', shotCount === 12, `${shotCount} blocks`);

  const waves = await page.evaluate(() =>
    ['wave-voice', 'wave-music'].map((id) => {
      const el = document.querySelector(`[data-testid=${id}]`);
      const c = el?.querySelector('canvas');
      if (!c || el.getAttribute('data-loaded') !== 'true') return 0;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
      return lit;
    }),
  );
  check('voice and music waveforms are decoded and drawn', waves.every((n) => n > 500), `lit pixels ${waves.join(', ')}`);

  const attr = async (sel, name) => Number(await page.getAttribute(sel, name));
  const summary = () => page.innerText('[data-testid=summary]');
  const box = async (sel) => page.locator(sel).boundingBox();

  // Click on the ruler: the playhead seeks there and the shot under it is selected.
  const ruler = await box('[data-testid=tl-ruler]');
  const ppf = Number(await page.getAttribute('[data-testid=timeline]', 'data-ppf'));
  const reportStart = await attr('[data-testid=tl-shot-report]', 'data-start');
  const scrollLeft = await page.evaluate(() => document.querySelector('.tl-scroll').scrollLeft);
  await page.mouse.click(ruler.x + (reportStart + 20) * ppf - scrollLeft, ruler.y + ruler.height / 2);
  await page.waitForTimeout(250);
  const seekFrame = await attr('[data-testid=current-frame]', 'data-frame');
  check('clicking the ruler seeks the preview', Math.abs(seekFrame - (reportStart + 20)) <= 2 && (await page.getAttribute('[data-testid=current-frame]', 'data-shot')) === 'report', `frame ${seekFrame}`);

  // Keyboard: → one frame, Shift+→ one second.
  await page.locator('[data-testid=tl-ruler]').hover();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const f1 = await attr('[data-testid=current-frame]', 'data-frame');
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(100);
  const f2 = await attr('[data-testid=current-frame]', 'data-frame');
  check('arrow keys step frames (→ 1 frame, Shift+→ 1 s)', f1 === seekFrame + 1 && f2 === f1 + 30, `${seekFrame} → ${f1} → ${f2}`);

  // Roll trim: drag the cut after the hook; the next shot absorbs it, the episode length does not change.
  const lenBefore = await summary();
  const hookDur = await attr('[data-testid=tl-shot-hook]', 'data-duration');
  const counterStart = await attr('[data-testid=tl-shot-counter]', 'data-start');
  const trim = await box('[data-testid=tl-trim-hook]');
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2);
  await page.mouse.down();
  await page.mouse.move(trim.x + trim.width / 2 + 20 * ppf, trim.y + trim.height / 2, { steps: 6 });
  const hintText = await page.locator('[data-testid=tl-hint]').innerText().catch(() => '');
  await page.mouse.up();
  await page.waitForTimeout(250);
  const hookDur2 = await attr('[data-testid=tl-shot-hook]', 'data-duration');
  const counterStart2 = await attr('[data-testid=tl-shot-counter]', 'data-start');
  check(
    'roll trim moves the cut and keeps the episode length (voice sync)',
    hookDur2 > hookDur && counterStart2 - counterStart === hookDur2 - hookDur && (await summary()).split('·')[1] === lenBefore.split('·')[1] && hintText.includes('roll'),
    `hook ${hookDur} → ${hookDur2} frames, hint "${hintText}"`,
  );

  // Undo / redo (one drag = one undo step).
  await page.click('[data-testid=undo]');
  await page.waitForTimeout(200);
  const afterUndo = await attr('[data-testid=tl-shot-hook]', 'data-duration');
  await page.keyboard.press('Control+Shift+Z');
  await page.waitForTimeout(200);
  const afterRedo = await attr('[data-testid=tl-shot-hook]', 'data-duration');
  check('undo / redo restore a whole drag in one step', afterUndo === hookDur && afterRedo === hookDur2, `${hookDur2} → ${afterUndo} → ${afterRedo}`);

  // Ripple trim with Alt: the episode gets longer.
  const trim2 = await box('[data-testid=tl-trim-counter]');
  await page.keyboard.down('Alt');
  await page.mouse.move(trim2.x + trim2.width / 2, trim2.y + trim2.height / 2);
  await page.mouse.down();
  await page.mouse.move(trim2.x + trim2.width / 2 + 30 * ppf, trim2.y + trim2.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(250);
  const lenRipple = await summary();
  check('Alt+drag ripples (episode length changes)', lenRipple.split('·')[1] !== lenBefore.split('·')[1], `${lenBefore.split('·')[1].trim()} → ${lenRipple.split('·')[1].trim()}`);
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(200);

  // Reorder: drag the hook block after the counter.
  const hookBox = await box('[data-testid=tl-shot-hook]');
  const counterBox = await box('[data-testid=tl-shot-counter]');
  await page.mouse.move(hookBox.x + hookBox.width / 2, hookBox.y + hookBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(counterBox.x + counterBox.width - 4, hookBox.y + hookBox.height / 2, { steps: 8 });
  const insertShown = await page.locator('[data-testid=tl-insert]').count();
  await page.mouse.up();
  await page.waitForTimeout(250);
  const order = await page.$$eval('.shot-list .shot', (els) => els.slice(0, 2).map((e) => e.getAttribute('data-testid')));
  check('dragging a block reorders shots', insertShown === 1 && order[0] === 'shot-counter' && order[1] === 'shot-hook', order.join(', '));
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(200);

  // SFX: drag the marker of the stat shot 1 s later.
  const sfxSel = '[data-testid=tl-sfx-stat-0]';
  const sfxFrame = await attr(sfxSel, 'data-frame');
  const sfxBox = await box(sfxSel);
  await page.mouse.move(sfxBox.x + 6, sfxBox.y + sfxBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sfxBox.x + 6 + 30 * ppf, sfxBox.y + sfxBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const movedSfx = await page.$$eval('[data-testid^=tl-sfx-]', (els) => els.map((e) => Number(e.getAttribute('data-frame'))));
  check('SFX markers can be dragged in time', movedSfx.some((f) => Math.abs(f - (sfxFrame + 30)) <= 3) && !movedSfx.includes(sfxFrame), `${sfxFrame} → ${movedSfx.join(',')}`);

  // Duplicate (Ctrl+D) and delete (Del).
  await page.click('[data-testid=tl-shot-rent]');
  await page.keyboard.press('Control+D');
  await page.waitForTimeout(200);
  const dup = await page.locator('[data-testid=tl-shot-rent-2]').count();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  const afterDelete = await page.locator('[data-testid^=tl-shot-]').count();
  check('Ctrl+D duplicates, Delete removes the selected shot', dup === 1 && afterDelete === 12, `blocks after delete ${afterDelete}`);

  // Drop a motion skill on a block (the Motion Library will drag these in Phase 6).
  const dropSkill = (selector, skill) =>
    page.evaluate(
      ([sel, id]) => {
        const el = document.querySelector(sel);
        const dt = new DataTransfer();
        dt.setData('application/x-motion-skill', id);
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      [selector, skill],
    );
  await dropSkill('[data-testid=tl-shot-counter]', 'punch_in');
  await page.waitForTimeout(250);
  const counterSkill = await page.innerText('[data-testid=shot-counter]');
  await dropSkill('[data-testid=tl-shot-hook]', 'map_zoom');
  await page.waitForTimeout(150);
  const toast = await page.locator('[data-testid=toast]').innerText().catch(() => '');
  check('dropping a skill applies it; incompatible skills are refused', counterSkill.includes('punch_in') && toast.includes('cannot be applied'), toast);

  // Zoom in: thumbnails of the real composition appear on wide blocks.
  await page.click('[data-testid=tl-fit]');
  for (let i = 0; i < 3; i++) await page.click('button[title="Zoom in"]');
  await page.waitForTimeout(1200);
  const thumbs = await page.locator('.tl-thumb').count();
  check('zoomed-in blocks show composition thumbnails', thumbs > 0, `${thumbs} thumbnails`);
  await page.screenshot({ path: join(out, '4-timeline.png') });
  await page.click('[data-testid=tl-fit]');
  await page.waitForTimeout(400);
  const fitState = await page.evaluate(() => {
    const el = document.querySelector('.tl-scroll');
    return { left: el.scrollLeft, overflow: el.scrollWidth - el.clientWidth };
  });
  check('Fit shows the whole episode from the start', fitState.left === 0 && fitState.overflow <= 130, JSON.stringify(fitState));
  await page.screenshot({ path: join(out, '5-timeline-fit.png') });

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
