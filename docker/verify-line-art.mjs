/** Exercise live controls and downloads in the real browser, with visual evidence. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? resolve(root, '.claude/line-art-export'));
await mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1060 }, acceptDownloads: true, reducedMotion:'reduce' });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  assert(server.resolvedUrls?.local[0]);
  await page.goto(`${server.resolvedUrls.local[0]}docker/line-art-preview.html`);
  const card = page.locator('easy-floorplan-card');
  const control = name => card.getByRole('button', { name, exact:true });
  await control('Line art').waitFor();
  const shot = name => page.screenshot({ path:resolve(output,name), fullPage:true });
  const download = async name => {
    const before = await card.locator('.plan-zoom').getAttribute('style');
    const saved = page.waitForEvent('download');
    await control('Download SVG').click();
    const file = await saved;
    assert.equal(file.suggestedFilename(), name);
    const path = resolve(output, name);
    await file.saveAs(path);
    assert.equal(await file.failure(), null);
    assert.equal(await card.locator('.plan-zoom').getAttribute('style'), before);
    const xml = await readFile(path, 'utf8');
    assert(!/var\(|data-entity|<script|<image|<foreignObject|<!--/.test(xml));
    return { xml, path };
  };
  const checkLayout = async () => {
    const stage = await card.locator('.stage').boundingBox();
    const bar = await card.locator('.view-controls').boundingBox();
    assert(stage && bar && bar.y >= stage.y+stage.height, 'Controls belong below the drawing');
    for(const button of await card.locator('.view-controls button').all()) {
      const box=await button.boundingBox();
      assert(box && box.width>=44 && box.height>=44, 'Controls need comfortable touch targets');
      assert(box.x>=bar.x && box.x+box.width<=bar.x+bar.width, 'Controls must fit the card');
    }
  };
  await checkLayout();
  assert.equal(await control('Line art').getAttribute('aria-pressed'),'true');
  await shot('live-line-art-desktop.png');
  const first = await download('floorplan-Ground-floor-3d.svg');
  await control('Normal').click();
  assert.equal(await card.locator('.solid-edges').count(),0);
  await shot('live-normal-desktop.png');
  await control('Line art').focus();
  await page.keyboard.press('Space');
  assert.equal(await control('Line art').getAttribute('aria-pressed'),'true');
  assert(await control('Line art').evaluate(b=>/** @type {ShadowRoot} */ (b.getRootNode()).activeElement===b));
  // The drawing follows real entities, including a tap on the live light badge.
  assert(await card.locator('.fp-glow').count()>0);
  await card.locator('.fp-item[data-id="lamp"]').click();
  assert.equal(await card.locator('.fp-glow').count(),0);
  const panel = card.locator('.fp-iso-panel[data-id="entry"]').first();
  const shut = await panel.getAttribute('points');
  await panel.click();
  assert.notEqual(await panel.getAttribute('points'),shut);
  assert.equal((await download('floorplan-Ground-floor-3d.svg')).xml,first.xml);
  await page.locator('#door').click();
  await page.locator('#light').click();
  await control('Rotate right').click();
  assert.equal(await card.locator('output').textContent(),'90°');
  await shot('live-line-art-rotated.png');
  await control('Reset view').click();
  assert.equal(await card.locator('output').textContent(),'0°');
  // Room selection remains selected through view/appearance changes.
  await card.locator('.area-tap-target').first().click();
  await control('Zoom out').waitFor();
  await control('2D plan').click();
  await control('Zoom out').waitFor();
  await control('Normal').click();
  await control('Zoom out').waitFor();
  await control('Line art').click();
  await control('Reset view').click();
  await control('1').click();
  const upper = await download('floorplan-Upper-floor-3d.svg');
  assert(upper.xml.includes('Bedroom') && !upper.xml.includes('Living room'));
  await control('G').click();
  await control('2D plan').click();
  const flat = await download('floorplan-Ground-floor-2d.svg');
  assert(!flat.xml.includes('fp-iso-face'));
  await shot('live-line-art-2d.png');
  const preview=await browser.newPage({viewport:{width:1100,height:730}});
  await preview.goto(pathToFileURL(first.path).href);
  assert.equal(await preview.locator('parsererror').count(),0);
  assert.equal(await preview.locator('svg').count(),1);
  await preview.screenshot({path:resolve(output,'ground-floor-3d.png')});
  await preview.goto(pathToFileURL(flat.path).href);
  await preview.screenshot({path:resolve(output,'ground-floor-2d.png')});
  await control('3D isometric').click();
  await page.locator('#theme').selectOption('dark');
  await shot('live-line-art-dark.png');
  await control('Normal').click();
  await shot('live-normal-dark.png');
  await control('Line art').click();
  await page.locator('#theme').selectOption('light');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:900});
    await checkLayout();
    await shot(`live-line-art-mobile-${width}.png`);
  }
  // A dashboard tile can have a fixed height: controls must remain reachable.
  await card.evaluate(c=>{c.style.height='360px';});
  const cardBox=await card.boundingBox(), bar=await card.locator('.view-controls').boundingBox();
  assert(cardBox && bar && bar.y+bar.height<=cardBox.y+cardBox.height+1);
  assert.deepEqual(errors,[]);
  console.log(`Verified live appearances, devices, doors, room zoom, rotation, reset, keyboard, themes, 320/390px touch layout, fixed-height layout and SVG downloads. Artifacts: ${output}`);
} catch (error) {
  const page=browser.contexts()[0]?.pages()[0];
  if(page) await page.screenshot({path:resolve(output,'verification-failure.png'),fullPage:true});
  throw error;
} finally {
  await browser.close();
  await server.close();
}
