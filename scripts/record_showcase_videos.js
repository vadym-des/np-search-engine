/**
 * Calm Director Studio Recorder for NP+UKR Search Engine
 * Features:
 * - Deterministic frame capture (FPS = 12)
 * - Calm, human-paced interactions with 2.0-3.0s holds on key results
 * - High-contrast animated callout badges
 * - Universal browser-compatible H.264 baseline 3.1 MP4 encoding
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const PORT = 8096;
const FPS = 12;
const VIDEO_DIR = path.join(process.cwd(), 'assets', 'video');
const TMP_FRAMES = '/tmp/calm_frames';

if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

function startServer() {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath);
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json'
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[Server] Calm Studio running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const STUDIO_INJECT = `
  (() => {
    // 1. Smooth Mouse Cursor
    if (!document.getElementById('studio-cursor')) {
      const c = document.createElement('div');
      c.id = 'studio-cursor';
      c.style.position = 'fixed';
      c.style.width = '24px';
      c.style.height = '24px';
      c.style.zIndex = '9999999';
      c.style.pointerEvents = 'none';
      c.style.transition = 'transform 0.12s linear';
      c.style.transform = 'translate(-50px, -50px)';
      c.innerHTML = \`
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5.5 3.5l12.5 9-6 1.5-3 6.5-2.5-1 3-6.5-4-9.5z" fill="#141413" stroke="#FFFFFF" stroke-width="2"/>
        </svg>
      \`;
      document.body.appendChild(c);
      window.studioMoveCursor = (x, y, isClick = false) => {
        c.style.transform = \`translate(\${x}px, \${y}px) \${isClick ? 'scale(0.80)' : 'scale(1)'}\`;
      };
    }

    // 2. High-Contrast Animated Callout Badge
    if (!document.getElementById('studio-callout')) {
      const b = document.createElement('div');
      b.id = 'studio-callout';
      b.style.position = 'fixed';
      b.style.bottom = '24px';
      b.style.left = '50%';
      b.style.transform = 'translateX(-50%) translateY(20px)';
      b.style.opacity = '0';
      b.style.zIndex = '99999999';
      b.style.background = 'rgba(15, 23, 42, 0.94)';
      b.style.color = '#FFFFFF';
      b.style.padding = '12px 24px';
      b.style.borderRadius = '9999px';
      b.style.fontSize = '15px';
      b.style.fontWeight = '600';
      b.style.letterSpacing = '-0.01em';
      b.style.boxShadow = '0 16px 40px rgba(0,0,0,0.40)';
      b.style.border = '1px solid rgba(255,255,255,0.22)';
      b.style.backdropFilter = 'blur(12px)';
      b.style.transition = 'all 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
      b.style.pointerEvents = 'none';
      b.style.whiteSpace = 'nowrap';
      document.body.appendChild(b);

      window.studioShowCallout = (text) => {
        b.innerHTML = text;
        b.style.opacity = '1';
        b.style.transform = 'translateX(-50%) translateY(0)';
      };
      window.studioHideCallout = () => {
        b.style.opacity = '0';
        b.style.transform = 'translateX(-50%) translateY(20px)';
      };
    }
  })();
`;

class FrameRecorder {
  constructor(page) {
    this.page = page;
    this.folder = TMP_FRAMES;
    this.frameIndex = 0;
    this.lastFramePath = null;
  }

  reset() {
    if (fs.existsSync(this.folder)) {
      fs.rmSync(this.folder, { recursive: true, force: true });
    }
    fs.mkdirSync(this.folder, { recursive: true });
    this.frameIndex = 0;
    this.lastFramePath = null;
  }

  async snap() {
    const pad = String(this.frameIndex++).padStart(4, '0');
    const fPath = path.join(this.folder, `frame_${pad}.png`);
    await this.page.screenshot({
      path: fPath,
      type: 'png'
    });
    this.lastFramePath = fPath;
    return fPath;
  }

  async hold(durationMs) {
    const count = Math.max(1, Math.round(durationMs / (1000 / FPS)));
    if (!this.lastFramePath) {
      await this.snap();
    }
    for (let i = 1; i < count; i++) {
      const pad = String(this.frameIndex++).padStart(4, '0');
      fs.copyFileSync(this.lastFramePath, path.join(this.folder, `frame_${pad}.png`));
    }
  }

  async moveTo(selector, click = false) {
    try {
      const el = await this.page.$(selector);
      if (!el) return;
      const box = await el.boundingBox();
      if (!box) return;
      const targetX = Math.round(box.x + box.width / 2);
      const targetY = Math.round(box.y + box.height / 2);

      // Interpolate 3-4 steps to target
      await this.page.evaluate((x, y) => window.studioMoveCursor && window.studioMoveCursor(x, y, false), targetX, targetY);
      await this.snap();
      await this.snap();

      if (click) {
        await this.page.evaluate((x, y) => window.studioMoveCursor && window.studioMoveCursor(x, y, true), targetX, targetY);
        await this.snap();
        await this.page.evaluate((x, y) => window.studioMoveCursor && window.studioMoveCursor(x, y, false), targetX, targetY);
        await this.snap();
      }
    } catch (e) {}
  }

  async typeInput(selector, text) {
    await this.moveTo(selector, true);
    await this.page.click(selector, { clickCount: 3 });
    await this.hold(200);

    for (let i = 0; i < text.length; i++) {
      await this.page.type(selector, text[i]);
      // snap every character or every 2 chars
      await this.snap();
      await new Promise(r => setTimeout(r, 60));
    }
    await this.hold(400);
  }

  async callout(text) {
    await this.page.evaluate(t => window.studioShowCallout && window.studioShowCallout(t), text);
    await this.snap();
    await this.snap();
  }

  async compile(outputMp4) {
    console.log(`[FFmpeg] Compiling ${this.frameIndex} frames -> ${path.basename(outputMp4)} at ${FPS} fps...`);
    // Universal baseline profile compatible with all Safari, WebKit, Chrome & Firefox
    const cmd = `/opt/homebrew/bin/ffmpeg -y -framerate ${FPS} -i "${this.folder}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -preset medium -crf 20 -movflags +faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${outputMp4}"`;
    execSync(cmd, { stdio: 'ignore' });
    const sz = fs.statSync(outputMp4).size;
    console.log(`✓ [Done] ${path.basename(outputMp4)}: ${(sz / 1024).toFixed(1)} KB`);
  }
}

async function runCalmDirector() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,800']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: 2 });
  const rec = new FrameRecorder(page);

  // =========================================================================
  // SCENARIO 1: HERO-ВІТРИНА (01_hero.mp4)
  // Спокійна демонстрація: пошук "київ 1", видача, копіювання в 1 клік
  // =========================================================================
  console.log('\n--- [1/9] Recording Scenario 1: Hero Showcase ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('⚡ Блискавичний пошук без реклами та затримок');
  await rec.hold(1200);

  await rec.typeInput('#searchInput', 'київ 1');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1200);

  await rec.callout('✨ 1 клік — готовий рядок для вашої CRM');
  const copyBtn = await page.$('.btn-copy-action, .btn-copy-short');
  if (copyBtn) {
    await rec.moveTo('.btn-copy-action, .btn-copy-short', true);
    await copyBtn.click();
    await rec.hold(1000);
  }
  await rec.hold(2400); // Спокійна 2.4-секундна пауза на фіналі
  await rec.compile(path.join(VIDEO_DIR, '01_hero.mp4'));

  // =========================================================================
  // SCENARIO 2: КРОС-МІСТ УКРПОШТИ (02_bridge.mp4)
  // Введення 5-значного індексу "79040", поява банера Укрпошти, клік [Детальніше]
  // =========================================================================
  console.log('\n--- [2/9] Recording Scenario 2: Cross-Service Bridge ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('🔀 Введено поштовий індекс: «79040»');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', '79040');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1200);

  await rec.callout('✓ Рушій знайшов Укрпошту та пропонує перехід в 1 клік');
  const switchBtn = await page.$('#btnCrossBannerSwitch, .btn-cross-switch');
  if (switchBtn) {
    await rec.moveTo('#btnCrossBannerSwitch, .btn-cross-switch', true);
    await switchBtn.click();
    await rec.hold(1200);
  }
  await rec.hold(2500); // Спокійна пауза для перегляду вкладки Укрпошти
  await rec.compile(path.join(VIDEO_DIR, '02_bridge.mp4'));

  // =========================================================================
  // SCENARIO 3: FUZZY ПОШУК З РЕАЛЬНИМ ОДРУКОМ (03_fuzzy.mp4)
  // Реальний одрук оператора "брвари 2" -> авторозпізнавання "м. Бровари, Відділення №2"
  // =========================================================================
  console.log('\n--- [3/9] Recording Scenario 3: Real Typo Fuzzy Engine ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('⌨️ Реальний одрук оператора: «брвари 2»');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'брвари 2');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1200);

  await rec.callout('✓ Миттєво знайдено: м. Бровари, Відділення №2');
  await rec.moveTo('.card-main-title', false);
  await rec.hold(2600); // Спокійна пауза для сприйняття результату
  await rec.compile(path.join(VIDEO_DIR, '03_fuzzy.mp4'));

  // =========================================================================
  // SCENARIO 4: LP-CRM ІСТОРІЯ РАЙОНІВ ДО 2020 (04_crm_history.mp4)
  // Пошук за ліквідованим районом "Буялик Іванівський" -> картка з бейджем "До 2020 року"
  // =========================================================================
  console.log('\n--- [4/9] Recording Scenario 4: LP-CRM Historical Raions ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('📋 Клієнт вказав старий район до 2020: «Буялик Іванівський»');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'буялик іванівський');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1400);

  await rec.callout('🏷️ До 2020: Іванівський р-н • кол. назва: Петрівка');
  await rec.moveTo('.settlement-history-hint, .card-geo-line', false);
  await rec.hold(2600);
  await rec.compile(path.join(VIDEO_DIR, '04_crm_history.mp4'));

  // =========================================================================
  // SCENARIO 5: ПОШТОМАТИ ТА ТОЧНІ ОРІЄНТИРИ (05_postomats.mp4)
  // Пошук за адресою "львів керченська" -> Поштомат №33159 з міткою ЖК та під'їзду
  // =========================================================================
  console.log('\n--- [5/9] Recording Scenario 5: Postomats & Door Landmarks ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('🚪 Пошук поштомату за адресою: «львів керченська»');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'львів керченська');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1400);

  await rec.callout('✓ Точний орієнтир: ЖК Вуличний, підʼїзд №1');
  await rec.moveTo('.branch-address, .card-main-title', false);
  await rec.hold(2800);
  await rec.compile(path.join(VIDEO_DIR, '05_postomats.mp4'));

  // =========================================================================
  // SCENARIO 6: ТОП-МІСТА В 1 ДОТИК (06_popular.mp4)
  // Плавне наведення на кнопку "Київ" у сітці частих запитів -> клік -> видача
  // =========================================================================
  console.log('\n--- [6/9] Recording Scenario 6: Popular Cities Click ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('⚡ Швидкий старт: клік по топ-місту «Київ»');
  await rec.hold(1000);

  const chipEl = await page.$('#frequentChipsGrid .query-chip-btn, #frequentChipsGrid button');
  if (chipEl) {
    await rec.moveTo('#frequentChipsGrid .query-chip-btn, #frequentChipsGrid button', false);
    await rec.hold(400);
    await rec.moveTo('#frequentChipsGrid .query-chip-btn, #frequentChipsGrid button', true);
    await chipEl.click();
    await rec.hold(1400);
  }

  await rec.callout('✓ Миттєва видача за 0.01 секунди');
  await rec.moveTo('.results-count-badge, .branch-card', false);
  await rec.hold(2500);
  await rec.compile(path.join(VIDEO_DIR, '06_popular.mp4'));

  // =========================================================================
  // SCENARIO 7: ФІЛЬТРИ ВАГИ ТА СТАНЦІЇ МЕТРО (07_weight_limits.mp4)
  // Пошук "київ", клік на пігулку фільтра "Вантажні" -> відділення з мітками ваги та метро
  // =========================================================================
  console.log('\n--- [7/9] Recording Scenario 7: Weight Filters & Metro ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('⚖️ Пошук відділень у Києві');
  await rec.hold(800);

  await rec.typeInput('#searchInput', 'київ');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1200);

  await rec.callout('⚖️ Фільтрація: перемикання на «Вантажні»');
  const cargoPill = await page.$('.type-pill-btn[data-type="cargo"]');
  if (cargoPill) {
    await rec.moveTo('.type-pill-btn[data-type="cargo"]', true);
    await cargoPill.click();
    await rec.hold(1200);
  }

  await rec.callout('🚇 Орієнтир станцій метро та вага до 1100 кг');
  await rec.moveTo('.badge-weight-cargo, .type-badge, .branch-card', false);
  await rec.hold(2600);
  await rec.compile(path.join(VIDEO_DIR, '07_weight_limits.mp4'));

  // =========================================================================
  // SCENARIO 8: ВАНТАЖНІ ТЕРМІНАЛИ ТА ПАНДУСИ (08_cargo_hubs.mp4)
  // Пошук "дніпро 1" -> вантажне відділення №1 з параметрами рампи та палет
  // =========================================================================
  console.log('\n--- [8/9] Recording Scenario 8: Cargo Hubs & Ramps ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('🚛 Вантажний хаб №1 для палет та великогабариту');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'дніпро 1');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1400);

  await rec.callout('✓ Рампа, гідроборт, прийом палет без обмежень');
  await rec.moveTo('.branch-card, .type-badge', false);
  await rec.hold(2800);
  await rec.compile(path.join(VIDEO_DIR, '08_cargo_hubs.mp4'));

  // =========================================================================
  // SCENARIO 9: ВЕЛИКА ВІТРИНА ІНТЕРФЕЙСУ (09_showcase.mp4)
  // Копіювання очищеного рядка для CRM в 1 клік
  // =========================================================================
  console.log('\n--- [9/9] Recording Scenario 9: Showcase CRM Copy ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  await rec.callout('📋 Очищення та копіювання адреси в 1 клік');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'львів 1');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1200);

  const cBtn = await page.$('.btn-copy-action, .btn-copy-short');
  if (cBtn) {
    await rec.moveTo('.btn-copy-action, .btn-copy-short', true);
    await cBtn.click();
    await rec.hold(1000);
  }

  await rec.callout('✨ Готовий CRM-рядок без «вул.» та слів-паразитів');
  await rec.hold(2800);
  await rec.compile(path.join(VIDEO_DIR, '09_showcase.mp4'));

  await browser.close();
  server.close();
  console.log('\n🎉 ALL 9 CALM SCENARIOS RECORDED AND COMPILED SUCCESSFULLY!');
}

runCalmDirector().catch(err => {
  console.error('Calm Director Error:', err);
  process.exit(1);
});
