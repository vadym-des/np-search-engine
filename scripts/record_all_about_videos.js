/**
 * Studio Suite Recorder for ALL 9 About Page Showcase Videos & Posters
 *
 * Output specs:
 * - Viewport: 1000x636 @ deviceScaleFactor 2 (crisp 25% larger UI scale)
 * - Encoded: 1200x764 @ 24 FPS, H.264 yuv420p +faststart (high compatibility)
 * - Clean localStorage before every scenario (zero stale history, honest 0 counters)
 * - Synchronized smooth cursor, click ripple rings, lifted toast (zero overlap), and real completed actions
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const PORT = 8099;
const FPS = 24;
const VIEWPORT_W = 1000;
const VIEWPORT_H = 636;
const VIDEO_DIR = path.join(process.cwd(), 'assets', 'video');
const SHOWCASE_DIR = path.join(process.cwd(), 'assets', 'showcase');
const PROMO_DIR = path.join(process.cwd(), 'assets', 'promo');
const TMP_FRAMES = '/tmp/about_cards_studio_frames';

[VIDEO_DIR, SHOWCASE_DIR, PROMO_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function startServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2'
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(process.cwd(), reqPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[Server] About Cards Studio running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const STUDIO_INJECT = `
  (() => {
    if (window.__cardStudioInjected) return;
    window.__cardStudioInjected = true;

    const style = document.createElement('style');
    style.textContent = \`
      .toast-notification {
        bottom: 76px !important;
        right: 20px !important;
        z-index: 99999 !important;
      }
      .studio-target-glow {
        box-shadow: 0 0 0 4px rgba(217, 37, 52, 0.28), 0 8px 20px rgba(217, 37, 52, 0.18) !important;
        transition: box-shadow 0.2s ease !important;
      }
      .studio-inline-highlight {
        background: rgba(245, 158, 11, 0.22) !important;
        border-radius: 6px !important;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.28) !important;
        transition: all 0.25s ease !important;
      }
      .studio-crm-row-pad {
        padding-top: 28px !important;
        padding-bottom: 4px !important;
        transition: padding 0.24s ease !important;
      }
      .studio-crm-focus {
        position: relative !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: #fff7ed !important;
        border: 2px solid #ea580c !important;
        border-radius: 8px !important;
        padding: 4px 10px !important;
        box-shadow: 0 10px 24px rgba(234, 88, 12, 0.22) !important;
        transform: scale(1.05) !important;
        transform-origin: left center !important;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        z-index: 20 !important;
      }
      .studio-crm-focus::before {
        content: '👆 Як записано в LP-CRM';
        position: absolute;
        top: -26px;
        left: 0;
        background: #ea580c;
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 9px;
        border-radius: 9999px;
        white-space: nowrap;
        box-shadow: 0 4px 10px rgba(234, 88, 12, 0.28);
      }
      #studio-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 26px;
        height: 26px;
        z-index: 2147483647;
        pointer-events: none;
        transform: translate3d(-60px, -60px, 0);
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.30));
        will-change: transform;
      }
      .studio-ripple {
        position: fixed;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2.5px solid #d92534;
        background: rgba(217, 37, 52, 0.16);
        z-index: 2147483646;
        pointer-events: none;
      }
      #studio-callout {
        position: fixed;
        bottom: 18px;
        left: 50%;
        transform: translateX(-50%) translateY(16px);
        opacity: 0;
        z-index: 2147483640;
        background: rgba(15, 23, 42, 0.94);
        color: #f8fafc;
        padding: 10px 20px;
        border-radius: 9999px;
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
        font-size: 13.5px;
        font-weight: 600;
        letter-spacing: -0.01em;
        box-shadow: 0 14px 36px rgba(2, 6, 23, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        pointer-events: none;
        white-space: nowrap;
      }
      #studio-keycap {
        position: fixed;
        top: 120px;
        right: 36px;
        transform: scale(0.9);
        opacity: 0;
        z-index: 2147483642;
        background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
        color: #0f172a;
        border: 1.5px solid #cbd5e1;
        border-bottom-width: 4px;
        border-radius: 10px;
        padding: 8px 16px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 14px;
        font-weight: 700;
        box-shadow: 0 16px 32px rgba(15, 23, 42, 0.18);
        pointer-events: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'studio-cursor';
    cursor.innerHTML = \`
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M5 3l13 9.5-6.2 1.4-2.8 6.4-2.2-.9 2.7-6.3L5 3z" fill="#0f172a" stroke="#ffffff" stroke-width="1.9" stroke-linejoin="round"/>
      </svg>
    \`;
    document.body.appendChild(cursor);

    const callout = document.createElement('div');
    callout.id = 'studio-callout';
    document.body.appendChild(callout);

    const keycap = document.createElement('div');
    keycap.id = 'studio-keycap';
    keycap.innerHTML = '⌨️ Натиснуто [ Esc ]';
    document.body.appendChild(keycap);

    window.studioMoveCursor = (x, y, scale = 1) => {
      cursor.style.transform = \`translate3d(\${x}px, \${y}px, 0) scale(\${scale})\`;
    };
    window.studioSetRipple = (x, y, progress) => {
      let rp = document.getElementById('studio-active-ripple');
      if (progress === null) {
        if (rp) rp.remove();
        return;
      }
      if (!rp) {
        rp = document.createElement('div');
        rp.id = 'studio-active-ripple';
        rp.className = 'studio-ripple';
        document.body.appendChild(rp);
      }
      const s = 0.35 + progress * 1.8;
      const op = Math.max(0, 0.9 * (1 - progress));
      rp.style.left = x + 'px';
      rp.style.top = y + 'px';
      rp.style.transform = \`translate(-50%, -50%) scale(\${s.toFixed(3)})\`;
      rp.style.opacity = op.toFixed(3);
    };
    window.studioShowCallout = (text) => {
      callout.innerHTML = text;
      callout.style.opacity = '1';
      callout.style.transform = 'translateX(-50%) translateY(0)';
    };
    window.studioHideCallout = () => {
      callout.style.opacity = '0';
      callout.style.transform = 'translateX(-50%) translateY(16px)';
    };
    window.studioShowKeycap = (show, label) => {
      if (label) keycap.innerHTML = label;
      keycap.style.opacity = show ? '1' : '0';
      keycap.style.transform = show ? 'scale(1)' : 'scale(0.9)';
    };
    window.studioFocusCrmHint = (on) => {
      const row = document.querySelector('.settlement-history-hint');
      const wrap = document.querySelector('.crm-hint-wrapper');
      if (row) row.classList.toggle('studio-crm-row-pad', !!on);
      if (wrap) wrap.classList.toggle('studio-crm-focus', !!on);
    };
    window.studioHighlight = (selector, cls, on) => {
      const el = document.querySelector(selector);
      if (!el) return;
      if (on) el.classList.add(cls);
      else el.classList.remove(cls);
    };
  })();
`;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

class CardStudioRecorder {
  constructor(page) {
    this.page = page;
    this.folder = TMP_FRAMES;
    this.frameIndex = 0;
    this.lastFramePath = null;
    this.cursorX = 500;
    this.cursorY = 300;
  }

  async startCleanScenario() {
    if (fs.existsSync(this.folder)) {
      fs.rmSync(this.folder, { recursive: true, force: true });
    }
    fs.mkdirSync(this.folder, { recursive: true });
    this.frameIndex = 0;
    this.lastFramePath = null;
    this.cursorX = 500;
    this.cursorY = 300;

    await this.page.goto(`http://localhost:${PORT}/index.html?theme=light`, { waitUntil: 'networkidle0' });
    await this.page.evaluate(() => localStorage.clear());
    await this.page.reload({ waitUntil: 'networkidle0' });
    await this.page.evaluate(STUDIO_INJECT);
    await this.page.evaluate(() => window.studioMoveCursor(500, 300, 1));
  }

  async snap() {
    const pad = String(this.frameIndex++).padStart(4, '0');
    const fPath = path.join(this.folder, `frame_${pad}.png`);
    await this.page.screenshot({ path: fPath, type: 'png' });
    this.lastFramePath = fPath;
    return fPath;
  }

  async hold(durationMs) {
    const count = Math.max(1, Math.round((durationMs / 1000) * FPS));
    await this.snap();
    for (let i = 1; i < count; i++) {
      const pad = String(this.frameIndex++).padStart(4, '0');
      fs.copyFileSync(this.lastFramePath, path.join(this.folder, `frame_${pad}.png`));
    }
  }

  async callout(text) {
    await this.page.evaluate((t) => window.studioShowCallout(t), text);
    await this.hold(180);
  }

  async getCenter(selector) {
    return this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, selector);
  }

  async moveTo(selector, durationMs = 450) {
    const pos = await this.getCenter(selector);
    if (!pos) return null;
    const sx = this.cursorX;
    const sy = this.cursorY;
    const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));
    for (let i = 1; i <= frames; i++) {
      const p = easeOutCubic(i / frames);
      this.cursorX = sx + (pos.x - sx) * p;
      this.cursorY = sy + (pos.y - sy) * p;
      await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 1), this.cursorX, this.cursorY);
      await this.snap();
    }
    return pos;
  }

  async clickAt(selector, extraAfterFn = null) {
    const pos = await this.getCenter(selector);
    const cx = pos ? pos.x : this.cursorX;
    const cy = pos ? pos.y : this.cursorY;

    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 0.82), cx, cy);
    await this.snap();
    if (selector) {
      await this.page.click(selector);
    }
    if (extraAfterFn) {
      await extraAfterFn();
    }
    await new Promise((r) => setTimeout(r, 120));
    await this.snap();

    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 1), cx, cy);
    for (let i = 1; i <= 6; i++) {
      await this.page.evaluate((x, y, p) => window.studioSetRipple(x, y, p), cx, cy, i / 6);
      await this.snap();
    }
    await this.page.evaluate(() => window.studioSetRipple(0, 0, null));
    await this.snap();
  }

  async typeInput(selector, text, selectFirst = true) {
    if (selectFirst) {
      await this.moveTo(selector, 420);
      await this.clickAt(selector, async () => {
        await this.page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.focus();
            el.select();
          }
        }, selector);
      });
      await this.hold(140);
    }

    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i]);
      await this.snap();
      await this.snap();
      await new Promise((r) => setTimeout(r, 25));
    }
    await this.hold(260);
  }

  async setCleanSearchValue(text) {
    await this.page.evaluate((val) => {
      const inp = document.getElementById('searchInput');
      if (inp) inp.value = val;
    }, text);
  }

  async savePoster(posterPath, useWebp = false) {
    if (!this.lastFramePath) await this.snap();
    if (useWebp) {
      const tmpScaled = '/tmp/about_cards_poster_scaled.png';
      execSync(`/opt/homebrew/bin/ffmpeg -y -i "${this.lastFramePath}" -vf "scale=1200:-2" "${tmpScaled}"`, { stdio: 'ignore' });
      execSync(`/opt/homebrew/bin/cwebp -quiet -q 88 "${tmpScaled}" -o "${posterPath}"`, { stdio: 'ignore' });
    } else {
      execSync(`/opt/homebrew/bin/ffmpeg -y -i "${this.lastFramePath}" -vf "scale=1200:-2" "${posterPath}"`, { stdio: 'ignore' });
    }
    console.log(`  ✓ Poster saved: ${path.relative(process.cwd(), posterPath)}`);
  }

  async compile(outputMp4) {
    console.log(`[FFmpeg] Compiling ${this.frameIndex} frames -> ${path.relative(process.cwd(), outputMp4)} @ ${FPS} fps...`);
    const cmd = `/opt/homebrew/bin/ffmpeg -y -framerate ${FPS} -i "${this.folder}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 -preset medium -crf 19 -movflags +faststart -vf "scale=1200:-2" "${outputMp4}"`;
    execSync(cmd, { stdio: 'ignore' });
    const sz = fs.statSync(outputMp4).size;
    console.log(`  ✓ Video saved: ${path.relative(process.cwd(), outputMp4)} (${(sz / 1024).toFixed(1)} KB, ${(this.frameIndex / FPS).toFixed(1)}s)`);
  }
}

async function runAll() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const onlySet = onlyArg ? new Set(onlyArg.replace('--only=', '').split(',').map((s) => Number(s.trim()))) : null;
  const shouldRun = (id) => !onlySet || onlySet.has(id);

  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', `--window-size=${VIEWPORT_W},${VIEWPORT_H + 80}`]
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(`http://localhost:${PORT}`, ['clipboard-read', 'clipboard-write']);

    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 2 });
    const rec = new CardStudioRecorder(page);

    // =========================================================================
    // 1. HERO-ВІТРИНА (01_hero.mp4 + 00_hero_retina.png + 00_hero_poster.png)
    // =========================================================================
    if (shouldRun(1)) {
      console.log('\n[1/9] Hero Showcase: 01_hero.mp4');
      await rec.startCleanScenario();
      await rec.callout('⚡ Блискавичний пошук за містом, вулицею чи номером');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'київ 1');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('київ 1');
      });
      await rec.hold(850);

      await rec.callout('✨ 1 клік — готовий чистий рядок для вашої CRM');
      await rec.moveTo('.btn-copy-short', 460);
      await rec.clickAt('.btn-copy-short');
      await rec.hold(2200);
      await rec.savePoster(path.join(SHOWCASE_DIR, '00_hero_retina.png'));
      await rec.savePoster(path.join(SHOWCASE_DIR, '00_hero_poster.png'));
      await rec.compile(path.join(VIDEO_DIR, '01_hero.mp4'));
    }

    // =========================================================================
    // 2. РЯДОК 01 — АДАПТИВНИЙ ПОМІЧНИК ДІАПАЗОНУ (10_branch_range_hint.mp4)
    // =========================================================================
    if (shouldRun(2)) {
      console.log('\n[2/9] Row 01 Smart Range Hint: 10_branch_range_hint.mp4');
      await rec.startCleanScenario();
      await rec.callout('⌨️ Клієнт назвав неіснуючий номер: «Білгород-Дністровський 12»');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'Білгород-Дністровський 12');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit');
      await rec.hold(850);

      await rec.callout('💡 Мале місто: діючі номери [№1]–[№5] як кнопки в 1 клік');
      await rec.moveTo('.did-you-mean-chip[data-branch-num="2"]', 520);
      await rec.hold(1100);
      await rec.clickAt('.did-you-mean-chip[data-branch-num="2"]');
      await rec.hold(1600);

      await rec.callout('🏙️ Мегаполіс («Київ 999»): чітка межа №1–822 без спаму поштоматами');
      await rec.moveTo('#btnClearSearch', 360);
      await rec.clickAt('#btnClearSearch');
      await rec.typeInput('#searchInput', 'Київ 999', false);
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit');
      await rec.hold(400);
      await rec.moveTo('#didYouMeanBox', 450);
      await rec.hold(2400);
      await rec.savePoster(path.join(SHOWCASE_DIR, '10_branch_range_hint.png'));
      await rec.compile(path.join(VIDEO_DIR, '10_branch_range_hint.mp4'));
    }

    // =========================================================================
    // 3. РЯДОК 02 — ПІДКАЗКА ЗАПИСУ В LP-CRM (lpcrm-demo.mp4 + lpcrm-demo.webp)
    // =========================================================================
    if (shouldRun(3)) {
      console.log('\n[3/9] Row 02 LP-CRM Hint: lpcrm-demo.mp4');
      await rec.startCleanScenario();
      await rec.callout('🤔 Не можете знайти місто чи село у списку LP-CRM?');
      await rec.hold(650);
      await rec.typeInput('#searchInput', 'олександрія кіровоградська 1');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('олександрія кіровоградська 1');
      });
      await rec.hold(650);

      await page.evaluate(() => window.studioFocusCrmHint(true));
      await rec.moveTo('.crm-hint-wrapper', 520);
      await rec.callout('💡 Підказка в картці показує, як саме пункт записаний в LP-CRM!');
      await rec.hold(2200);

      await rec.moveTo('#btnClearSearch', 380);
      await rec.clickAt('#btnClearSearch');
      await rec.typeInput('#searchInput', 'калинівка 1', false);
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('калинівка 1');
      });
      await rec.hold(650);

      await page.evaluate(() => window.studioFocusCrmHint(true));
      await rec.moveTo('.btn-copy-crm-hint', 520);
      await rec.callout('👁️ Подивіться очима або скопіюйте точний запис в 1 клік');
      await rec.hold(1300);
      await rec.savePoster(path.join(PROMO_DIR, 'lpcrm-demo.webp'), true);
      await rec.clickAt('.btn-copy-crm-hint');
      await rec.hold(2000);
      await rec.compile(path.join(PROMO_DIR, 'lpcrm-demo.mp4'));
    }

    // =========================================================================
    // 4. РЯДОК 03 — ШВИДКИЙ ПОШУК ЗА КЛАВІШЕЮ ESC (00_esc_hotkey.mp4)
    // =========================================================================
    if (shouldRun(4)) {
      console.log('\n[4/9] Row 03 Esc Hotkey: 00_esc_hotkey.mp4');
      await rec.startCleanScenario();
      await rec.callout('⌨️ Попередній пошук: «київ хрещатик»');
      await rec.hold(500);
      await rec.typeInput('#searchInput', 'київ хрещатик');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit');
      await rec.hold(1100);

      await page.keyboard.press('Escape');
      await page.evaluate(() => window.studioShowKeycap(true, '⌨️ Натиснуто [ Esc ]'));
      await rec.callout('⚡ Натиснуто [Esc] — рядок виділено для миттєвої заміни!');
      await rec.hold(1300);
      await rec.savePoster(path.join(SHOWCASE_DIR, '09_esc_hotkey_demo.png'));

      await page.evaluate(() => window.studioShowKeycap(false));
      await rec.typeInput('#searchInput', 'львів 1', false);
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('львів 1');
      });
      await rec.callout('✓ Нова адреса в 1 дотик без зайвих рухів мишкою');
      await rec.hold(2200);
      await rec.compile(path.join(VIDEO_DIR, '00_esc_hotkey.mp4'));
    }

    // =========================================================================
    // 5. РЯДОК 04 — ОРІЄНТИРИ ТА ДОСТУП ДО ПІД'ЇЗДУ (05_postomats.mp4)
    // =========================================================================
    if (shouldRun(5)) {
      console.log('\n[5/9] Row 04 Postomat Landmarks: 05_postomats.mp4');
      await rec.startCleanScenario();
      await rec.callout('🚪 Перевірка поштомату за адресою: «київ стуса 23/9»');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'київ стуса 23/9');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('київ стуса 23/9');
      });
      await rec.hold(900);

      await rec.moveTo('.street-highlight', 500);
      await page.evaluate(() => window.studioHighlight('.street-highlight', 'studio-inline-highlight', true));
      await rec.callout('🛡️ Видно ДО відправки: «підʼїзд №1 (ТІЛЬКИ ДЛЯ МЕШКАНЦІВ)»');
      await rec.hold(2500);
      await rec.savePoster(path.join(SHOWCASE_DIR, '06_postomats_landmarks.png'));
      await rec.compile(path.join(VIDEO_DIR, '05_postomats.mp4'));
    }

    // =========================================================================
    // 6. РЯДОК 05 — РАЙОНИ ДО АДМІНРЕФОРМИ 2020 (04_crm_history.mp4)
    // =========================================================================
    if (shouldRun(6)) {
      console.log('\n[6/9] Row 05 Historical Raions 2020: 04_crm_history.mp4');
      await rec.startCleanScenario();
      await rec.callout('📋 Пошук за старим районом: «буялик іванівський 1»');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'буялик іванівський 1');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('буялик іванівський 1');
      });
      await rec.hold(900);

      await rec.moveTo('.settlement-history-hint', 520);
      await page.evaluate(() => window.studioHighlight('.settlement-history-hint', 'studio-inline-highlight', true));
      await rec.callout('🏷️ Видно новий район, старий «Іванівський р-н» та колишню назву!');
      await rec.hold(2600);
      await rec.savePoster(path.join(SHOWCASE_DIR, '08_lpcrm_historical_index.png'));
      await rec.compile(path.join(VIDEO_DIR, '04_crm_history.mp4'));
    }

    // =========================================================================
    // 7. РЯДОК 06 — FUZZY TOPO-ENGINE: ОДРУКИ (03_fuzzy.mp4)
    // =========================================================================
    if (shouldRun(7)) {
      console.log('\n[7/9] Row 06 Fuzzy Typo Engine: 03_fuzzy.mp4');
      await rec.startCleanScenario();
      await rec.callout('⌨️ Реальний одрук оператора: «брвари 2»');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'брвари 2');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit', async () => {
        await rec.setCleanSearchValue('брвари 2');
      });
      await rec.hold(850);

      await rec.callout('✓ Автовиправлення одруку ➔ м. Бровари, Відділення №2');
      await rec.moveTo('.btn-copy-short', 480);
      await rec.clickAt('.btn-copy-short');
      await rec.hold(2300);
      await rec.savePoster(path.join(SHOWCASE_DIR, '07_homonym_disambiguation.png'));
      await rec.compile(path.join(VIDEO_DIR, '03_fuzzy.mp4'));
    }

    // =========================================================================
    // 8. РЯДОК 07 — КРОС-МІСТ УКРПОШТИ В СЕЛАХ (02_bridge.mp4)
    // =========================================================================
    if (shouldRun(8)) {
      console.log('\n[8/9] Row 07 Cross-Service Ukrposhta Bridge: 02_bridge.mp4');
      await rec.startCleanScenario();
      await rec.callout('🏘️ У селі покупця немає Нової пошти: «багрин київська»');
      await rec.hold(550);
      await rec.typeInput('#searchInput', 'багрин київська');
      await rec.moveTo('#btnSearchSubmit', 380);
      await rec.clickAt('#btnSearchSubmit');
      await rec.hold(900);

      await rec.callout('📮 Рушій автоматично знайшов відділення Укрпошти (08624)');
      await rec.moveTo('#btnSwitchServiceBridge', 500);
      await page.evaluate(() => window.studioHighlight('#btnSwitchServiceBridge', 'studio-target-glow', true));
      await rec.hold(1300);
      await rec.clickAt('#btnSwitchServiceBridge');
      await rec.callout('✓ Перехід в Укрпошту в 1 клік разом із 5-значним індексом!');
      await rec.hold(2400);
      await rec.savePoster(path.join(SHOWCASE_DIR, '03_cross_service_bridge.png'));
      await rec.compile(path.join(VIDEO_DIR, '02_bridge.mp4'));
    }

    // =========================================================================
    // 9. РЯДОК 08 — ТОП-МІСТА ТА ЧЕСНИЙ СТАРТ ІЗ 0 (06_popular.mp4)
    // =========================================================================
    if (shouldRun(9)) {
      console.log('\n[9/9] Row 08 Honest 0 Start & Popular Cities: 06_popular.mp4');
      await rec.startCleanScenario();
      await rec.callout('📊 Чесний старт із 0 — без штучних накруток');
      await rec.hold(1200);

      const firstChipSel = '#frequentChipsGrid .query-chip-btn';
      await rec.moveTo(firstChipSel, 480);
      await page.evaluate((sel) => window.studioHighlight(sel, 'studio-target-glow', true), firstChipSel);
      await rec.hold(400);
      await rec.clickAt(firstChipSel);
      await rec.hold(350);

      const firstAcSel = '#autocompleteDropdown .autocomplete-item';
      if (await page.$(firstAcSel)) {
        await rec.moveTo(firstAcSel, 420);
        await rec.clickAt(firstAcSel);
      }
      await rec.callout('⚡ Миттєва видача за 0.01 с та автопідйом ваших робочих міст у топ');
      await rec.hold(2400);
      await rec.savePoster(path.join(SHOWCASE_DIR, '01_popular_queries.png'));
      await rec.compile(path.join(VIDEO_DIR, '06_popular.mp4'));
    }

    console.log('\n🎉 ABOUT SHOWCASE RECORDING COMPLETE!');
  } finally {
    await browser.close();
    server.close();
  }
}

runAll().catch((err) => {
  console.error('Card Studio Error:', err);
  process.exit(1);
});
