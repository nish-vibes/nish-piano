const path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const scheme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('file://' + path.resolve(__dirname, '..', 'dist', 'nish_marksteady_piano_v2_0_0.html'));
    await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
    await page.evaluate(() => window.WapiroTest.reset()); await page.reload(); await page.waitForFunction(() => window.WapiroTest && window.WapiroTest.state);
    await page.evaluate(async () => { const s = (await window.WapiroTest.listSongs()).find((x) => /Prelude in C/.test(x.title)); await window.WapiroTest.openSong(s.id); });
    await page.waitForTimeout(500);
    await page.hover('.keys-scroll'); await page.waitForTimeout(250);
    await page.screenshot({ path: `/tmp/q_${scheme}.png` });
    if (scheme === 'dark') { await page.click('[aria-label="Sound and devices"]'); await page.waitForTimeout(250); await page.screenshot({ path: '/tmp/q_sound.png' }); await page.keyboard.press('Escape'); }
    console.log(scheme, (await page.evaluate(() => window.WapiroTest.state())).view, errs.join('|') || 'no errors');
    await ctx.close();
  }
  await b.close();
})();
