/**
 * Studio Promo Recorder: LP-CRM & TG Integration Demo (12-14s)
 * Output: assets/promo/lpcrm-demo.mp4 & assets/promo/lpcrm-demo.webp
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const PORT = 8097;
const FPS = 12;
const PROMO_DIR = path.join(process.cwd(), 'assets', 'promo');
const TMP_FRAMES = '/tmp/lpcrm_promo_frames';

if (!fs.existsSync(PROMO_DIR)) fs.mkdirSync(PROMO_DIR, { recursive: true });

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
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.json': 'application/json'
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[Server] Promo Recorder running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const STUDIO_INJECT = `
  (() => {
    // 1. Mouse Cursor
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
      b.style.bottom = '28px';
      b.style.left = '50%';
      b.style.transform = 'translateX(-50%) translateY(20px)';
      b.style.opacity = '0';
      b.style.zIndex = '99999999';
      b.style.background = 'rgba(15, 23, 42, 0.94)';
      b.style.color = '#FFFFFF';
      b.style.padding = '12px 26px';
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

    // 3. LP-CRM Simulation Modal Box
    if (!document.getElementById('studio-crm-simulation')) {
      const sim = document.createElement('div');
      sim.id = 'studio-crm-simulation';
      sim.style.position = 'fixed';
      sim.style.top = '50%';
      sim.style.left = '50%';
      sim.style.transform = 'translate(-50%, -50%) scale(0.95)';
      sim.style.opacity = '0';
      sim.style.zIndex = '9999998';
      sim.style.width = '640px';
      sim.style.background = '#FFFFFF';
      sim.style.borderRadius = '16px';
      sim.style.boxShadow = '0 30px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(15,23,42,0.1)';
      sim.style.padding = '24px 28px';
      sim.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      sim.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      sim.style.pointerEvents = 'none';
      sim.innerHTML = \`
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:#2563eb; color:#fff; font-size:11px; font-weight:700; padding:3px 8px; border-radius:4px; letter-spacing:0.5px;">LP-CRM</span>
            <strong style="color:#0f172a; font-size:15px;">Нове замовлення #84920</strong>
          </div>
          <span style="font-size:12px; color:#64748b;">Форма доставки Нова Пошта</span>
        </div>
        <div style="margin-bottom:14px;">
          <label style="display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:6px;">Населений пункт (випадаючий список CRM):</label>
          <div id="simCrmInputBox" style="position:relative; border:2px solid #2563eb; border-radius:8px; padding:10px 14px; background:#f8fafc; font-size:14px; color:#0f172a; font-weight:600; display:flex; align-items:center; justify-content:space-between;">
            <span id="simCrmInputText" style="color:#94a3b8;">Натисніть Ctrl+V для вставки...</span>
            <span id="simCrmBadge" style="opacity:0; background:#dcfce7; color:#15803d; font-size:11px; padding:3px 8px; border-radius:9999px; font-weight:700;">✓ Точний збіг ОТГ</span>
          </div>
        </div>
        <div id="simCrmDropdown" style="opacity:0; transition:opacity 0.2s ease; background:#fff; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.08); padding:6px; margin-top:4px;">
          <div style="background:#eff6ff; color:#1d4ed8; padding:8px 12px; border-radius:6px; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:space-between;">
            <span>📍 Калинівка (Калинівська територіальна громада)</span>
            <span style="font-size:11px; color:#3b82f6;">Вінницька обл. • 0 колізій</span>
          </div>
        </div>
      \`;
      document.body.appendChild(sim);

      window.studioShowCrmSim = (show) => {
        if (show) {
          sim.style.opacity = '1';
          sim.style.transform = 'translate(-50%, -50%) scale(1)';
        } else {
          sim.style.opacity = '0';
          sim.style.transform = 'translate(-50%, -50%) scale(0.95)';
        }
      };

      window.studioPasteCrmSim = () => {
        const text = document.getElementById('simCrmInputText');
        const badge = document.getElementById('simCrmBadge');
        const drop = document.getElementById('simCrmDropdown');
        if (text) {
          text.textContent = 'Калинівка (Калинівська територіальна громада)';
          text.style.color = '#0f172a';
        }
        if (badge) badge.style.opacity = '1';
        if (drop) drop.style.opacity = '1';
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

  async compile(outputMp4, outputWebp) {
    console.log(`[FFmpeg] Compiling ${this.frameIndex} frames -> ${path.basename(outputMp4)} at ${FPS} fps...`);
    const cmd = `/opt/homebrew/bin/ffmpeg -y -framerate ${FPS} -i "${this.folder}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -preset medium -crf 20 -movflags +faststart -vf "scale=1200:-2" "${outputMp4}"`;
    execSync(cmd, { stdio: 'ignore' });
    const sz = fs.statSync(outputMp4).size;
    console.log(`✓ [Done] ${path.basename(outputMp4)}: ${(sz / 1024).toFixed(1)} KB`);

    if (outputWebp) {
      // Pick a representative frame (~frame 50 or 60) for preview
      const previewFrame = path.join(this.folder, 'frame_0045.png');
      const targetFrame = fs.existsSync(previewFrame) ? previewFrame : path.join(this.folder, 'frame_0010.png');
      const webpCmd = `/opt/homebrew/bin/ffmpeg -y -i "${targetFrame}" -vf "scale=1200:-2" -c:v libwebp -quality 85 "${outputWebp}"`;
      execSync(webpCmd, { stdio: 'ignore' });
      const webpSz = fs.statSync(outputWebp).size;
      console.log(`✓ [Done WebP] ${path.basename(outputWebp)}: ${(webpSz / 1024).toFixed(1)} KB`);
    }
  }
}

async function recordPromo() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,800']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 2 });
  const rec = new FrameRecorder(page);

  console.log('\n--- Recording LP-CRM & TG Integration Promo (12-14s) ---');
  rec.reset();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(STUDIO_INJECT);

  // 1. Пошук як завжди (0:00 - 0:04)
  await rec.callout('🔍 Шукаєте відділення як завжди: «калинівка 1»');
  await rec.hold(1000);

  await rec.typeInput('#searchInput', 'калинівка 1');
  await rec.moveTo('#btnSearchSubmit', true);
  await page.click('#btnSearchSubmit');
  await rec.hold(1400);

  // 2. Підсвітка та 1 клік копіювання (0:04 - 0:07)
  await rec.callout('✨ 1 клік — точна назва для LP-CRM у буфері!');
  await rec.moveTo('.btn-copy-crm-hint', true);
  const hintBtn = await page.$('.btn-copy-crm-hint');
  if (hintBtn) {
    await hintBtn.click();
  }
  await rec.hold(1600);

  // 3. Вставка у CRM (0:07 - 0:11)
  await rec.callout('📋 Вставили в CRM ➔ точний вибір громади без колізій!');
  await page.evaluate(() => window.studioShowCrmSim(true));
  await rec.hold(800);
  await page.evaluate(() => window.studioPasteCrmSim());
  await rec.hold(2400);
  await page.evaluate(() => window.studioShowCrmSim(false));
  await rec.hold(600);

  // 4. Фінальний титр (0:11 - 0:14)
  await rec.callout('🛡️ 0 помилок при відправці • Підтримка 3 100+ громад України');
  await rec.hold(2400);

  const mp4Path = path.join(PROMO_DIR, 'lpcrm-demo.mp4');
  const webpPath = path.join(PROMO_DIR, 'lpcrm-demo.webp');
  await rec.compile(mp4Path, webpPath);

  await browser.close();
  server.close();
  console.log('\n🎉 Finished recording promo demo video successfully!');
}

recordPromo().catch(err => {
  console.error('Recording error:', err);
  process.exit(1);
});
