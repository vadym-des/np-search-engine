const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const PORT = 8098;
const FPS = 12;
const VIDEO_DIR = path.join(process.cwd(), 'assets', 'video');
const SHOWCASE_DIR = path.join(process.cwd(), 'assets', 'showcase');
const TMP_FRAMES = '/tmp/calm_frames_esc';

if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!fs.existsSync(SHOWCASE_DIR)) fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
if (fs.existsSync(TMP_FRAMES)) fs.rmSync(TMP_FRAMES, { recursive: true, force: true });
fs.mkdirSync(TMP_FRAMES, { recursive: true });

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
      console.log(`[Server] running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

class FrameRecorder {
  constructor(page, folder) {
    this.page = page;
    this.folder = folder;
    this.frameIndex = 0;
  }

  async capture(count = 1) {
    const buf = await this.page.screenshot({ type: 'png' });
    for (let i = 0; i < count; i++) {
      const p = path.join(this.folder, `frame_${String(this.frameIndex++).padStart(4, '0')}.png`);
      fs.writeFileSync(p, buf);
    }
  }

  async compile(outputMp4) {
    console.log(`[FFmpeg] Compiling ${this.frameIndex} frames -> ${outputMp4}...`);
    const cmd = `/opt/homebrew/bin/ffmpeg -y -framerate ${FPS} -i "${this.folder}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.1 -preset medium -crf 20 -movflags +faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${outputMp4}"`;
    execSync(cmd, { stdio: 'ignore' });
    const sz = fs.statSync(outputMp4).size;
    console.log(`✓ [Done] ${path.basename(outputMp4)}: ${(sz / 1024).toFixed(1)} KB`);
  }
}

async function showBadge(page, title, sub) {
  await page.evaluate(({ title, sub }) => {
    let el = document.getElementById('demo-director-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-director-badge';
      el.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 20, 19, 0.94);
        color: #ffffff;
        padding: 9px 18px;
        border-radius: 9999px;
        box-shadow: 0 12px 36px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.18);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 99999;
      `;
      document.body.appendChild(el);
    }
    el.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;"></span><b>${title}</b> <span style="opacity:0.75;font-weight:400;">• ${sub}</span>`;
  }, { title, sub });
}

async function run() {
  const server = await startServer();
  const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--window-size=1200,764"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 764, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle0' });

  const recorder = new FrameRecorder(page, TMP_FRAMES);

  // 1. Initial State (1.0 sec)
  await showBadge(page, '⌨️ Розумні Hotkeys', 'натисніть Esc для заміни запиту в 1 дотик');
  await recorder.capture(12);

  // 2. Type initial query: "Київ Хрещатик 1"
  const input = await page.$('#searchInput');
  await input.click();
  const text1 = 'Київ Хрещатик 1';
  for (const ch of text1) {
    await page.keyboard.type(ch);
    await recorder.capture(1);
  }
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 600));

  // Hold result (1.5 sec)
  await showBadge(page, '✅ Знайдено відділення', 'Київ • Хрещатик, 1');
  await recorder.capture(16);

  // 3. User hits ESC!
  await page.keyboard.press('Escape');
  // Visual indicator: show key badge
  await showBadge(page, '⌨️ Натиснуто [ Esc ]', 'рядок виділено! Друкуйте нове місто одразу');
  
  // Save poster frame exactly at this key moment!
  const posterPath = path.join(SHOWCASE_DIR, '09_esc_hotkey_demo.png');
  await page.screenshot({ path: posterPath });
  console.log(`Saved poster to ${posterPath}`);

  // Hold selection state (2.0 sec) so user sees the text is completely selected in blue
  await recorder.capture(24);

  // 4. User types new city without backspace: "Львів"
  const text2 = 'Львів 1';
  for (const ch of text2) {
    await page.keyboard.type(ch);
    await recorder.capture(2);
  }
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 600));

  await showBadge(page, '⚡ Заміна в 1 дотик без Backspace!', 'Львів • Відділення №1');
  // Hold final result (2.5 sec)
  await recorder.capture(28);

  const outVideo = path.join(VIDEO_DIR, '00_esc_hotkey.mp4');
  await recorder.compile(outVideo);

  await browser.close();
  server.close();
  console.log('Video recording completed successfully!');
}

run().catch(console.error);
