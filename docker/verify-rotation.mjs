/** Real-browser motion/layout check and reproducible images for issue #354. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { load } from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? resolve(root, '.claude/rotation'));
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 900 }, reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  assert(server.resolvedUrls?.local[0]);
  await page.goto(`${server.resolvedUrls.local[0]}docker/3d-preview.html`);
  const card = page.locator('easy-floorplan-card');
  const control = name => card.getByRole('button', { name, exact: true });
  await control('Rotate right').waitFor();
  const layout = async () => {
    const stage = await card.locator('.plan').boundingBox();
    const toolbar = await card.locator('.view-controls').boundingBox();
    assert(stage && toolbar && toolbar.y >= stage.y + stage.height - 1);
    for (const button of await card.locator('.view-controls button').all()) {
      const box = await button.boundingBox();
      assert(box && box.width >= 44 && box.height >= 44);
      assert(box.x >= toolbar.x - 1 && box.x + box.width <= toolbar.x + toolbar.width + 1);
    }
  };
  const measureTurn = async () => {
    const motion = page.evaluate(() => new Promise(resolve => {
      const c = /** @type {any} */ (document.querySelector('easy-floorplan-card'));
      const started = performance.now(), frames = [];
      let seen = false;
      function sample() {
        if (c._rotation.running) {
          seen = true;
          frames.push({ time: performance.now(), angle: c._rotation.value });
        }
        if (seen && !c._rotation.running || performance.now() - started > 5000) resolve(frames);
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    await control('Rotate right').click();
    const frames = /** @type {Array<{time:number,angle:number}>} */ (await motion);
    assert(frames.length >= 4, 'A turn must visibly traverse intermediate angles');
    const gaps = frames.slice(1).map((f, i) => f.time - frames[i].time);
    return { frames: frames.length, maximumFrameGapMs: Math.round(Math.max(...gaps)) };
  };
  await layout();
  const timing = /** @type {Record<string, unknown>} */ ({ preview: await measureTurn() });
  await control('Reset view').click();

  // Freeze only the injected animation clock, not the renderer. Screenshots
  // sample the exact same callback path used by real RAF above.
  await page.evaluate(async () => {
    const modulePath = '/src/opening-tween.ts';
    const { rafTweenFrames } = await import(modulePath);
    let now = performance.now(), id = 0;
    const callbacks = new Map();
    rafTweenFrames.now = () => now;
    rafTweenFrames.request = cb => { callbacks.set(++id, cb); return id; };
    rafTweenFrames.cancel = key => callbacks.delete(key);
    /** @type {any} */ (window).orbitTick = async ms => {
      now += ms;
      const due = [...callbacks.values()];
      callbacks.clear();
      due.forEach(cb => cb());
      await /** @type {any} */ (document.querySelector('easy-floorplan-card')).updateComplete;
    };
  });
  await card.screenshot({ path: resolve(output, 'rotation-start.png') });
  await control('Rotate right').click();
  for (let i = 0; i <= 27; i++) {
    if (i) await page.evaluate(() => /** @type {any} */ (window).orbitTick(450 / 27));
    await card.screenshot({ path: resolve(output, `frame-${String(i).padStart(2, '0')}.png`), animations: 'allow' });
    if (i === 8) await card.screenshot({ path: resolve(output, 'rotation-midway.png') });
  }
  await page.evaluate(() => /** @type {any} */ (window).orbitTick(1));
  await card.screenshot({ path: resolve(output, 'rotation-finish.png') });
  assert.equal(await card.locator('output').textContent(), '90°');
  await page.setViewportSize({ width: 390, height: 850 });
  await layout();
  await control('Rotate left').click();
  await page.evaluate(() => /** @type {any} */ (window).orbitTick(133));
  await card.screenshot({ path: resolve(output, 'rotation-mobile.png') });
  await page.setViewportSize({ width: 320, height: 850 });
  await layout();

  // Also exercise the repository's larger demo, including roof windows and
  // all its furniture, through the real RAF scheduler after reloading.
  await page.setViewportSize({ width: 1050, height: 900 });
  await page.reload();
  await control('Rotate right').waitFor();
  const demo = /** @type {any} */ (load(await readFile(resolve(root, 'docker/config/floorplan-demo.yaml'), 'utf8')));
  const config = demo.views[0].sections[0].cards[0];
  await card.evaluate((el, config) => {
    const c = /** @type {any} */ (el);
    c.setConfig({ ...config, view: '3d', showViewControls: true, wallOpacity: .65, historyReplay: { enabled: false } });
  }, config);
  timing.demo = await measureTurn();
  await card.screenshot({ path: resolve(output, 'rotation-demo.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control('Rotate right').click();
  assert.equal(await card.locator('.rotating').count(), 0);
  assert.equal(await card.locator('output').textContent(), '180°');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'timing.json'), JSON.stringify(timing, null, 2) + '\n');
  console.log(JSON.stringify({ output, timing, pageErrors: errors.length }));
} finally {
  await browser.close();
  await server.close();
}
