/**
 * Studio Video Tour Recorder: "Про проєкт" (assets/video/about_tour.mp4)
 *
 * Features:
 * - Deterministic 24 FPS Retina frame capture (1200x764 @ 2x -> 1920x1222 H.264)
 * - HTTP server with byte-range (206) support so embedded MP4 demos stream smoothly
 * - Smooth cubic-eased cursor, click ripple highlights, step callouts, and frame-locked video stepping
 * - Procedural stereo Chill / Ambient Lo-Fi soundtrack + synchronized UI micro-SFX
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('/tmp/node_modules/puppeteer-core');

const PORT = 8098;
const FPS = 24;
const VIEWPORT_W = 1200;
const VIEWPORT_H = 764;
const VIDEO_DIR = path.join(process.cwd(), 'assets', 'video');
const OUTPUT_MP4 = path.join(VIDEO_DIR, 'about_tour.mp4');
const TMP_DIR = '/tmp/about_tour_studio';
const TMP_FRAMES = path.join(TMP_DIR, 'frames');
const TMP_WAV = path.join(TMP_DIR, 'soundtrack.wav');

if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

function startServer() {
  const mimeMap = {
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

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeMap[ext] || 'application/octet-stream';

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
        if (start >= stat.size || start > end) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          return res.end();
        }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }

    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[Server] Studio HTTP+Range server running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

const STUDIO_INJECT = `
  (() => {
    if (window.__studioInjected) return;
    window.__studioInjected = true;

    const style = document.createElement('style');
    style.id = 'studio-overlay-styles';
    style.textContent = \`
      @keyframes studioRipple {
        0% { transform: translate(-50%, -50%) scale(0.35); opacity: 0.9; }
        100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
      }
      .studio-target-highlight {
        box-shadow: 0 0 0 4px rgba(217, 37, 52, 0.35), 0 8px 24px rgba(217, 37, 52, 0.25) !important;
        transition: box-shadow 0.2s ease !important;
      }
      #studio-callout {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(18px);
        opacity: 0;
        z-index: 2147483640;
        background: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        padding: 11px 22px;
        border-radius: 9999px;
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
        font-size: 14.5px;
        font-weight: 600;
        letter-spacing: -0.01em;
        box-shadow: 0 18px 44px rgba(2, 6, 23, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        pointer-events: none;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.24s ease, transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      #studio-callout .callout-pill {
        background: #d92534;
        color: #ffffff;
        font-size: 12px;
        font-weight: 700;
        padding: 3px 9px;
        border-radius: 9999px;
        letter-spacing: 0.02em;
      }
      #studio-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 28px;
        height: 28px;
        z-index: 2147483647;
        pointer-events: none;
        transform: translate3d(-60px, -60px, 0);
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.32));
        will-change: transform;
      }
      .studio-ripple {
        position: fixed;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 2.5px solid #d92534;
        background: rgba(217, 37, 52, 0.16);
        z-index: 2147483646;
        pointer-events: none;
        transform: translate(-50%, -50%) scale(0.35);
      }
      #studio-fade-curtain {
        position: fixed;
        inset: 0;
        background: #f8fafc;
        opacity: 0;
        z-index: 2147483645;
        pointer-events: none;
      }
    \`;
    document.head.appendChild(style);

    const curtain = document.createElement('div');
    curtain.id = 'studio-fade-curtain';
    document.body.appendChild(curtain);

    const cursor = document.createElement('div');
    cursor.id = 'studio-cursor';
    cursor.innerHTML = \`
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M5 3l13 9.5-6.2 1.4-2.8 6.4-2.2-.9 2.7-6.3L5 3z" fill="#0f172a" stroke="#ffffff" stroke-width="1.9" stroke-linejoin="round"/>
      </svg>
    \`;
    document.body.appendChild(cursor);

    const callout = document.createElement('div');
    callout.id = 'studio-callout';
    document.body.appendChild(callout);

    window.__cursorPos = { x: 600, y: 380 };
    window.studioMoveCursor = (x, y, scale = 1) => {
      window.__cursorPos = { x, y };
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
      const s = 0.35 + progress * 1.85;
      const op = Math.max(0, 0.9 * (1 - progress));
      rp.style.left = x + 'px';
      rp.style.top = y + 'px';
      rp.style.transform = \`translate(-50%, -50%) scale(\${s.toFixed(3)})\`;
      rp.style.opacity = op.toFixed(3);
    };

    window.studioShowCallout = (badge, text) => {
      if (badge) {
        callout.innerHTML = \`<span class="callout-pill">\${badge}</span><span>\${text}</span>\`;
      } else {
        callout.innerHTML = \`<span>\${text}</span>\`;
      }
      callout.style.opacity = '1';
      callout.style.transform = 'translateX(-50%) translateY(0)';
    };

    window.studioHideCallout = () => {
      callout.style.opacity = '0';
      callout.style.transform = 'translateX(-50%) translateY(18px)';
    };

    window.studioSetCurtain = (opacity, color = '#f8fafc') => {
      curtain.style.background = color;
      curtain.style.opacity = String(opacity);
    };

    window.studioHighlight = (selector, on) => {
      const el = document.querySelector(selector);
      if (!el) return;
      if (on) el.classList.add('studio-target-highlight');
      else el.classList.remove('studio-target-highlight');
    };
  })();
`;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

class StudioRecorder {
  constructor(page) {
    this.page = page;
    this.folder = TMP_FRAMES;
    this.frameIndex = 0;
    this.lastFramePath = null;
    this.cursorX = 600;
    this.cursorY = 380;
    this.sfxEvents = [];
    this.stepVideos = false;
  }

  reset() {
    if (fs.existsSync(TMP_DIR)) {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(this.folder, { recursive: true });
    this.frameIndex = 0;
    this.lastFramePath = null;
    this.sfxEvents = [];
  }

  get currentTimeSec() {
    return this.frameIndex / FPS;
  }

  recordSfx(type) {
    this.sfxEvents.push({ time: this.currentTimeSec, type });
  }

  async prepareAboutVideos() {
    this.stepVideos = true;
    await this.page.evaluate(async () => {
      const videos = Array.from(document.querySelectorAll('video'));
      await Promise.all(videos.map(v => new Promise(resolve => {
        if (!v.src && v.dataset.src) {
          v.src = v.dataset.src;
        }
        v.muted = true;
        v.loop = true;
        v.preload = 'auto';
        try { v.pause(); } catch (e) {}
        if (v.readyState >= 2) return resolve();
        const done = () => {
          v.removeEventListener('loadeddata', done);
          v.removeEventListener('canplay', done);
          resolve();
        };
        v.addEventListener('loadeddata', done);
        v.addEventListener('canplay', done);
        setTimeout(resolve, 2500);
        try { v.load(); } catch (e) { resolve(); }
      })));
    });
  }

  async advanceVisibleVideos() {
    if (!this.stepVideos) return;
    await this.page.evaluate(async (dt) => {
      const vh = window.innerHeight;
      const videos = Array.from(document.querySelectorAll('video'));
      const seeks = [];
      for (const v of videos) {
        const rect = v.getBoundingClientRect();
        if (rect.bottom > -80 && rect.top < vh + 80 && v.duration && isFinite(v.duration) && v.duration > 0) {
          v.pause();
          const nextTime = (v.currentTime + dt) % v.duration;
          seeks.push(new Promise(resolve => {
            let settled = false;
            const finish = () => {
              if (!settled) {
                settled = true;
                v.removeEventListener('seeked', finish);
                resolve();
              }
            };
            v.addEventListener('seeked', finish);
            v.currentTime = nextTime;
            setTimeout(finish, 65);
          }));
        }
      }
      if (seeks.length) await Promise.all(seeks);
    }, 1 / FPS);
  }

  async snap() {
    if (this.stepVideos) {
      await this.advanceVisibleVideos();
    }
    const pad = String(this.frameIndex++).padStart(5, '0');
    const fPath = path.join(this.folder, `frame_${pad}.png`);
    await this.page.screenshot({ path: fPath, type: 'png' });
    this.lastFramePath = fPath;
    return fPath;
  }

  async hold(durationMs) {
    const frames = Math.max(1, Math.round((durationMs / 1000) * FPS));
    for (let i = 0; i < frames; i++) {
      if (this.stepVideos || i === 0 || !this.lastFramePath) {
        await this.snap();
      } else {
        const pad = String(this.frameIndex++).padStart(5, '0');
        fs.copyFileSync(this.lastFramePath, path.join(this.folder, `frame_${pad}.png`));
      }
    }
  }

  async showCallout(badge, text) {
    await this.page.evaluate((b, t) => window.studioShowCallout(b, t), badge, text);
    await this.hold(220);
  }

  async hideCallout() {
    await this.page.evaluate(() => window.studioHideCallout());
    await this.hold(200);
  }

  async getCenter(selector) {
    const pos = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }, selector);
    return pos;
  }

  async moveToPoint(targetX, targetY, durationMs = 550) {
    const startX = this.cursorX;
    const startY = this.cursorY;
    const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));

    for (let i = 1; i <= frames; i++) {
      const p = easeOutCubic(i / frames);
      const cx = startX + (targetX - startX) * p;
      const cy = startY + (targetY - startY) * p;
      this.cursorX = cx;
      this.cursorY = cy;
      await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 1), cx, cy);
      await this.snap();
    }
  }

  async moveTo(selector, durationMs = 550, offsetX = 0, offsetY = 0) {
    const pos = await this.getCenter(selector);
    if (!pos) return null;
    await this.moveToPoint(pos.x + offsetX, pos.y + offsetY, durationMs);
    return pos;
  }

  async clickAt(selector, clickAction = null, sfxType = 'click') {
    const pos = await this.getCenter(selector);
    const cx = pos ? pos.x : this.cursorX;
    const cy = pos ? pos.y : this.cursorY;

    // Press down (2 frames)
    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 0.82), cx, cy);
    await this.snap();
    this.recordSfx(sfxType);
    if (clickAction) {
      await clickAction();
    } else if (selector) {
      await this.page.click(selector);
    }
    await this.snap();

    // Release + ripple expansion (7 frames)
    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 1), cx, cy);
    for (let i = 1; i <= 7; i++) {
      await this.page.evaluate((x, y, p) => window.studioSetRipple(x, y, p), cx, cy, i / 7);
      await this.snap();
    }
    await this.page.evaluate(() => window.studioSetRipple(0, 0, null));
  }

  async typeText(selector, text) {
    await this.moveTo(selector, 450);
    await this.clickAt(selector, async () => {
      await this.page.click(selector, { clickCount: 3 });
    }, 'click');
    await this.hold(160);

    for (let i = 0; i < text.length; i++) {
      await this.page.type(selector, text[i]);
      if (i % 2 === 0 || i === text.length - 1) {
        this.recordSfx('key');
      }
      await this.snap();
      await this.snap();
    }
    await this.hold(350);
  }

  async smoothScrollToElement(selector, offsetFromTop = 140, durationMs = 950) {
    const targetScrollY = await this.page.evaluate((sel, offset) => {
      const el = document.querySelector(sel);
      if (!el) return window.scrollY;
      const rect = el.getBoundingClientRect();
      const absTop = rect.top + window.scrollY;
      return Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, absTop - offset));
    }, selector, offsetFromTop);

    await this.smoothScrollToY(targetScrollY, durationMs);
  }

  async smoothScrollToY(targetY, durationMs = 950) {
    const startY = await this.page.evaluate(() => window.scrollY);
    const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));
    for (let i = 1; i <= frames; i++) {
      const p = easeInOutCubic(i / frames);
      const y = startY + (targetY - startY) * p;
      await this.page.evaluate((scrollTop) => {
        window.scrollTo({ top: scrollTop, behavior: 'instant' });
      }, y);
      await this.snap();
    }
  }

  async dragSlider(selector, fromVal, toVal, durationMs = 1300) {
    const info = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        min: parseFloat(el.min) || 10,
        max: parseFloat(el.max) || 300
      };
    }, selector);
    if (!info) return;

    const getThumbX = (val) => {
      const ratio = (val - info.min) / (info.max - info.min);
      return info.left + 12 + ratio * (info.width - 24);
    };

    const startX = getThumbX(fromVal);
    const endX = getThumbX(toVal);
    const cy = info.top + info.height / 2;

    await this.moveToPoint(startX, cy, 450);
    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 0.86), startX, cy);
    this.recordSfx('click');
    await this.snap();

    const frames = Math.max(4, Math.round((durationMs / 1000) * FPS));
    for (let i = 1; i <= frames; i++) {
      const p = easeInOutCubic(i / frames);
      const curVal = Math.round((fromVal + (toVal - fromVal) * p) / 5) * 5;
      const cx = startX + (endX - startX) * p;
      this.cursorX = cx;
      this.cursorY = cy;
      await this.page.evaluate((sel, val, x, y) => {
        const el = document.querySelector(sel);
        if (el) {
          el.value = String(val);
          if (typeof recalcLandingRoi === 'function') recalcLandingRoi(val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        window.studioMoveCursor(x, y, 0.86);
      }, selector, curVal, cx, cy);
      await this.snap();
    }

    await this.page.evaluate((x, y) => window.studioMoveCursor(x, y, 1), endX, cy);
    this.recordSfx('chime');
    await this.snap();
  }

  async fadeOutCurtain(durationMs = 280, color = '#f8fafc') {
    const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));
    for (let i = 1; i <= frames; i++) {
      await this.page.evaluate((op, c) => window.studioSetCurtain(op, c), i / frames, color);
      await this.snap();
    }
  }

  async fadeInCurtain(durationMs = 320, color = '#f8fafc') {
    const frames = Math.max(2, Math.round((durationMs / 1000) * FPS));
    for (let i = frames - 1; i >= 0; i--) {
      await this.page.evaluate((op, c) => window.studioSetCurtain(op, c), i / frames, color);
      await this.snap();
    }
  }
}

/**
 * Generates warm Chill / Modern Ambient Lo-Fi stereo soundtrack (44100 Hz, 16-bit PCM WAV)
 * synchronized with UI click/chime events.
 */
function generateAmbientWav(wavPath, totalDurationSec, sfxEvents) {
  console.log(`[Audio] Synthesizing ${totalDurationSec.toFixed(2)}s Chill Ambient Lo-Fi soundtrack + ${sfxEvents.length} SFX cues...`);
  const sampleRate = 44100;
  const numSamples = Math.ceil(totalDurationSec * sampleRate);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);

  const bpm = 96;
  const beatSec = 60 / bpm; // 0.625s
  const barSec = beatSec * 4; // 2.5s

  // Fmaj9 -> Em7 -> Dm9 -> Cmaj9
  const chords = [
    { bass: 87.31, notes: [174.61, 220.00, 261.63, 329.63, 392.00], top: [523.25, 659.25] }, // Fmaj9
    { bass: 82.41, notes: [164.81, 196.00, 246.94, 293.66, 392.00], top: [493.88, 587.33] }, // Em7
    { bass: 73.42, notes: [146.83, 174.61, 220.00, 261.63, 329.63], top: [440.00, 523.25] }, // Dm9
    { bass: 65.41, notes: [130.81, 164.81, 196.00, 246.94, 293.66], top: [392.00, 493.88] }  // Cmaj9
  ];

  // Deterministic pseudo-random for hi-hat/brush noise
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646 * 2 - 1;
  };

  // Pre-build 4-bar loop (10.0s) or render seamlessly over bars
  const totalBars = Math.ceil(totalDurationSec / barSec);

  for (let b = 0; b < totalBars; b++) {
    const chord = chords[b % chords.length];
    const barStartSample = Math.floor(b * barSec * sampleRate);
    const barSamples = Math.floor((barSec + 0.4) * sampleRate);

    // 1. Warm Rhodes Pad + Tine
    for (let nIdx = 0; nIdx < chord.notes.length; nIdx++) {
      const freq = chord.notes[nIdx];
      const pan = -0.35 + (nIdx / (chord.notes.length - 1)) * 0.7; // gentle stereo spread
      const gainL = Math.cos((pan + 1) * Math.PI / 4) * 0.085;
      const gainR = Math.sin((pan + 1) * Math.PI / 4) * 0.085;
      const strumOffset = Math.floor(nIdx * 0.022 * sampleRate);

      for (let i = 0; i < barSamples; i++) {
        const idx = barStartSample + strumOffset + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const attack = Math.min(1, t / 0.04);
        const release = t > barSec - 0.15 ? Math.max(0, 1 - (t - (barSec - 0.15)) / 0.45) : 1;
        const env = attack * release * Math.exp(-t * 0.55);
        const tineEnv = attack * Math.exp(-t * 4.2);

        const s1 = Math.sin(2 * Math.PI * freq * t);
        const s2 = 0.25 * Math.sin(2 * Math.PI * freq * 2 * t) * tineEnv;
        const s3 = 0.08 * Math.sin(2 * Math.PI * freq * 3 * t) * tineEnv;
        // Subtle stereo chorus detune
        const valL = (s1 + s2 + s3) * env;
        const valR = (Math.sin(2 * Math.PI * (freq + 0.35) * t) + s2 + s3) * env;

        left[idx] += valL * gainL;
        right[idx] += valR * gainR;
      }
    }

    // 2. Warm Sub Bass (beat 1 & beat 2.5)
    const bassTriggers = [0, beatSec * 2.5];
    for (const trig of bassTriggers) {
      const startS = barStartSample + Math.floor(trig * sampleRate);
      const lenS = Math.floor(beatSec * 1.4 * sampleRate);
      for (let i = 0; i < lenS; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const env = Math.min(1, t / 0.025) * Math.exp(-t * 1.4);
        const sub = (Math.sin(2 * Math.PI * chord.bass * t) + 0.22 * Math.sin(2 * Math.PI * chord.bass * 2 * t)) * env * 0.19;
        left[idx] += sub;
        right[idx] += sub;
      }
    }

    // 3. Gentle Top Bell Sparkle (beat 2 & beat 4)
    const bellTriggers = [
      { offset: beatSec * 1.0, freq: chord.top[0], pan: -0.45 },
      { offset: beatSec * 3.0, freq: chord.top[1], pan: 0.45 }
    ];
    for (const bell of bellTriggers) {
      const startS = barStartSample + Math.floor(bell.offset * sampleRate);
      const lenS = Math.floor(beatSec * 1.6 * sampleRate);
      const gL = Math.cos((bell.pan + 1) * Math.PI / 4) * 0.055;
      const gR = Math.sin((bell.pan + 1) * Math.PI / 4) * 0.055;
      for (let i = 0; i < lenS; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const env = Math.min(1, t / 0.012) * Math.exp(-t * 2.6);
        const val = (Math.sin(2 * Math.PI * bell.freq * t) + 0.15 * Math.sin(2 * Math.PI * bell.freq * 2 * t)) * env;
        left[idx] += val * gL;
        right[idx] += val * gR;
      }
    }

    // 4. Soft Lo-Fi Drum Groove
    // Soft kick on beats 1 and 3
    for (const kBeat of [0, 2, 2.75]) {
      const startS = barStartSample + Math.floor(kBeat * beatSec * sampleRate);
      const kickLen = Math.floor(0.16 * sampleRate);
      const amp = kBeat === 2.75 ? 0.11 : 0.22;
      let phase = 0;
      for (let i = 0; i < kickLen; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const f = 46 + 75 * Math.exp(-t * 32);
        phase += (2 * Math.PI * f) / sampleRate;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 16);
        const s = Math.sin(phase) * env * amp;
        left[idx] += s;
        right[idx] += s;
      }
    }

    // Soft snare/rim on beats 2 and 4
    for (const sBeat of [1, 3]) {
      const startS = barStartSample + Math.floor(sBeat * beatSec * sampleRate);
      const snareLen = Math.floor(0.11 * sampleRate);
      let lp = 0;
      for (let i = 0; i < snareLen; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const n = rand();
        lp = lp * 0.68 + n * 0.32;
        const hpNoise = n - lp * 0.6;
        const env = Math.min(1, t / 0.002) * Math.exp(-t * 28);
        const body = Math.sin(2 * Math.PI * 240 * t) * Math.exp(-t * 40) * 0.5;
        const s = (hpNoise * 0.45 + body) * env * 0.095;
        left[idx] += s * 0.95;
        right[idx] += s * 1.05;
      }
    }

    // Delicate 8th-note closed hats
    for (let e = 0; e < 8; e++) {
      const swing = e % 2 === 1 ? 0.025 : 0;
      const startS = barStartSample + Math.floor((e * 0.5 * beatSec + swing) * sampleRate);
      const hatLen = Math.floor(0.035 * sampleRate);
      const amp = e % 2 === 0 ? 0.032 : 0.018;
      let prevN = 0;
      for (let i = 0; i < hatLen; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const n = rand();
        const hp = n - prevN;
        prevN = n;
        const env = Math.min(1, t / 0.001) * Math.exp(-t * 95);
        const s = hp * env * amp;
        left[idx] += s * 1.1;
        right[idx] += s * 0.9;
      }
    }
  }

  // 5. Overlay synchronized UI SFX
  for (const ev of sfxEvents) {
    const startS = Math.floor(ev.time * sampleRate);
    if (ev.type === 'key') {
      const len = Math.floor(0.018 * sampleRate);
      for (let i = 0; i < len; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const s = Math.sin(2 * Math.PI * 540 * t) * Math.exp(-t * 160) * 0.045;
        left[idx] += s;
        right[idx] += s;
      }
    } else if (ev.type === 'click') {
      const len = Math.floor(0.045 * sampleRate);
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const idx = startS + i;
        if (idx >= numSamples) break;
        const t = i / sampleRate;
        const f = 320 + 620 * Math.exp(-t * 110);
        phase += (2 * Math.PI * f) / sampleRate;
        const s = Math.sin(phase) * Math.exp(-t * 85) * 0.11;
        left[idx] += s;
        right[idx] += s;
      }
    } else if (ev.type === 'chime') {
      const notes = [
        { delay: 0, freq: 783.99 },
        { delay: 0.065, freq: 1046.50 }
      ];
      for (const n of notes) {
        const nStart = startS + Math.floor(n.delay * sampleRate);
        const len = Math.floor(0.28 * sampleRate);
        for (let i = 0; i < len; i++) {
          const idx = nStart + i;
          if (idx >= numSamples) break;
          const t = i / sampleRate;
          const s = Math.sin(2 * Math.PI * n.freq * t) * Math.min(1, t / 0.005) * Math.exp(-t * 11) * 0.09;
          left[idx] += s * 0.9;
          right[idx] += s * 1.1;
        }
      }
    }
  }

  // 6. Master fade-in (1.2s), fade-out (2.0s), soft limiter & 16-bit PCM WAV export
  const fadeInS = Math.floor(1.2 * sampleRate);
  const fadeOutS = Math.floor(2.0 * sampleRate);
  const dataBytes = numSamples * 4;
  const wavBuf = Buffer.alloc(44 + dataBytes);

  // RIFF Header
  wavBuf.write('RIFF', 0);
  wavBuf.writeUInt32LE(36 + dataBytes, 4);
  wavBuf.write('WAVE', 8);
  wavBuf.write('fmt ', 12);
  wavBuf.writeUInt32LE(16, 16); // PCM
  wavBuf.writeUInt16LE(1, 20); // AudioFormat 1
  wavBuf.writeUInt16LE(2, 22); // Stereo
  wavBuf.writeUInt32LE(sampleRate, 24);
  wavBuf.writeUInt32LE(sampleRate * 4, 28); // ByteRate
  wavBuf.writeUInt16LE(4, 32); // BlockAlign
  wavBuf.writeUInt16LE(16, 34); // BitsPerSample
  wavBuf.write('data', 36);
  wavBuf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numSamples; i++) {
    let gain = 1.0;
    if (i < fadeInS) gain = i / fadeInS;
    if (i > numSamples - fadeOutS) gain = Math.max(0, (numSamples - i) / fadeOutS);

    const lSample = Math.tanh(left[i] * 1.15) * gain * 0.88;
    const rSample = Math.tanh(right[i] * 1.15) * gain * 0.88;

    const lInt = Math.max(-32767, Math.min(32767, Math.round(lSample * 32767)));
    const rInt = Math.max(-32767, Math.min(32767, Math.round(rSample * 32767)));

    wavBuf.writeInt16LE(lInt, 44 + i * 4);
    wavBuf.writeInt16LE(rInt, 44 + i * 4 + 2);
  }

  fs.writeFileSync(wavPath, wavBuf);
  console.log(`✓ [Audio] WAV generated: ${wavPath} (${(wavBuf.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function runAboutTourDirector() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${VIEWPORT_W},${VIEWPORT_H + 80}`
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H, deviceScaleFactor: 2 });

    const rec = new StudioRecorder(page);
    rec.reset();

    // =========================================================================
    // SCENE 1 (0:00 - 0:10): Пошуковик index.html + перехід на «Про проєкт»
    // =========================================================================
    console.log('\n--- [Scene 1/5] Main Search Engine & Transition to About ---');
    await page.goto(`http://localhost:${PORT}/index.html?theme=light`, { waitUntil: 'networkidle0' });
    await page.evaluate(STUDIO_INJECT);
    await rec.hold(550);

    await rec.showCallout('Пошук', '⚡ Миттєвий пошук Нової пошти та Укрпошти в одному вікні');
    await rec.typeText('#searchInput', 'київ 1');
    await rec.moveTo('#btnSearchSubmit', 420);
    await rec.clickAt('#btnSearchSubmit');
    await rec.hold(950);

    const copyBtnSel = '.btn-copy-short, .btn-copy-action';
    if (await page.$(copyBtnSel)) {
      await rec.moveTo(copyBtnSel, 520);
      await rec.clickAt(copyBtnSel, null, 'chime');
      await rec.hold(950);
    }

    await rec.showCallout('Про проєкт', '🧭 Дізнайтесь про всі інструменти — розділ «Про проєкт»');
    await rec.hold(450);

    await rec.moveTo('#btnHeaderAbout', 750);
    await page.evaluate(() => window.studioHighlight('#btnHeaderAbout', true));
    await rec.hold(550);
    await rec.clickAt('#btnHeaderAbout', async () => {
      // Prevent opening new tab; keep visual click feedback and fade cleanly
      await page.evaluate(() => {
        const b = document.getElementById('btnHeaderAbout');
        if (b) b.style.transform = 'scale(0.96)';
      });
    }, 'chime');
    await rec.fadeOutCurtain(260, '#f8fafc');

    // =========================================================================
    // SCENE 2 (0:10 - 0:17): Головний екран «Про проєкт» (about.html)
    // =========================================================================
    console.log('\n--- [Scene 2/5] About Landing Hero ---');
    await page.goto(`http://localhost:${PORT}/about.html?theme=light`, { waitUntil: 'networkidle0' });
    await page.evaluate(STUDIO_INJECT);
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.studioSetCurtain(1, '#f8fafc');
    });
    await rec.prepareAboutVideos();
    // Place cursor cleanly near center-top
    rec.cursorX = 600;
    rec.cursorY = 300;
    await page.evaluate(() => window.studioMoveCursor(600, 300, 1));
    await rec.fadeInCurtain(300, '#f8fafc');

    await rec.showCallout('Знайомство', '🚀 Оформлюйте доставку вдвічі швидше без перемикання вкладок');
    await rec.hold(2400);

    const exploreBtnSel = '.ds-hero-ctas a[href="#features"]';
    await rec.moveTo(exploreBtnSel, 700);
    await page.evaluate((sel) => window.studioHighlight(sel, true), exploreBtnSel);
    await rec.hold(350);
    await rec.clickAt(exploreBtnSel, async () => {}, 'click');
    await page.evaluate((sel) => window.studioHighlight(sel, false), exploreBtnSel);
    await rec.smoothScrollToElement('#feature-branch-range-hint', 150, 1000);

    // =========================================================================
    // SCENE 3 (0:17 - 0:36): Тур ключовими можливостями на about.html
    // =========================================================================
    console.log('\n--- [Scene 3/5] Features Walkthrough ---');

    // Block 01: Smart Branch Range Hint
    await rec.showCallout('01 / 04', 'Розумна підказка номерів відділень без спаму поштоматами');
    await rec.moveTo('#feature-branch-range-hint .ds-zigzag-media', 600);
    await rec.hold(3600);

    // Block 02: LP-CRM Hint
    await rec.smoothScrollToElement('#feature-lpcrm-tg', 150, 850);
    await rec.showCallout('02 / 04', 'Підказка «В LP-CRM»: показує, як населений пункт записаний у базі CRM');
    await rec.moveTo('#feature-lpcrm-tg .ds-zigzag-media', 600);
    await rec.hold(3400);

    // Block 03 & 04: Hotkeys Esc + Postomat Landmarks
    await rec.smoothScrollToElement('#feature-hotkeys', 150, 850);
    await rec.showCallout('03 / 04', 'Гаряча клавіша Esc, орієнтири підʼїздів та історичні райони');
    await rec.moveTo('#feature-hotkeys .ds-zigzag-media', 500);
    await rec.hold(1700);

    await rec.smoothScrollToElement('[data-media-slot="postomats"]', 160, 800);
    await rec.moveTo('[data-media-slot="postomats"]', 500);
    await rec.hold(1900);

    // Block 06 & 07: Fuzzy Topo-Engine + Ukrposhta Bridge
    await rec.smoothScrollToElement('[data-media-slot="fuzzy"]', 160, 950);
    await rec.showCallout('04 / 04', 'Виправлення одруків та автоперехід на Укрпошту');
    await rec.moveTo('[data-media-slot="fuzzy"]', 500);
    await rec.hold(1700);

    await rec.smoothScrollToElement('[data-media-slot="bridge"]', 160, 800);
    await rec.moveTo('[data-media-slot="bridge"]', 500);
    await rec.hold(1900);

    // =========================================================================
    // SCENE 4 (0:36 - 0:46): Інтерактивний конструктор CRM та ROI калькулятор
    // =========================================================================
    console.log('\n--- [Scene 4/5] Interactive CRM Constructor & ROI ---');
    await rec.smoothScrollToElement('#calculator', 85, 950);
    await rec.showCallout('CRM-конструктор', '⚙️ Налаштуйте формат рядка під вашу CRM та порахуйте економію часу');
    await rec.hold(500);

    // Toggle rule #2 ("«смт» замість селища")
    const switchSel = '.crm-switches-row .crm-toggle-pill:nth-child(2)';
    await rec.moveTo(switchSel, 550);
    await rec.clickAt(switchSel, async () => {
      await page.evaluate(() => {
        const chk = document.getElementById('chkSmt');
        if (chk) {
          chk.checked = !chk.checked;
          if (typeof updateLandingCrmLine === 'function') updateLandingCrmLine();
        }
      });
    }, 'click');
    await rec.hold(650);

    // Click copy button
    await rec.moveTo('#btnLandingCopyCrm', 550);
    await rec.clickAt('#btnLandingCopyCrm', async () => {
      await page.evaluate(() => {
        const btn = document.getElementById('btnLandingCopyCrm');
        if (btn) {
          btn.textContent = '✓ Скопійовано!';
          btn.classList.add('copied');
        }
      });
    }, 'chime');
    await rec.hold(850);

    // Frame ROI box comfortably and drag slider 50 -> 150
    await rec.smoothScrollToElement('.ds-roi-box', 210, 550);
    await rec.dragSlider('.roi-slider', 50, 150, 1250);
    await rec.hold(1100);

    // =========================================================================
    // SCENE 5 (0:46 - 0:54): FAQ, Темна тема (Dark Mode) та фінал
    // =========================================================================
    console.log('\n--- [Scene 5/5] FAQ, Dark Mode & Finale ---');
    await rec.smoothScrollToElement('#faq', 90, 850);
    await rec.hideCallout();

    const faq2Sel = '.ds-faq-item:nth-child(2) .ds-faq-btn';
    await rec.moveTo(faq2Sel, 550);
    await rec.clickAt(faq2Sel, null, 'click');
    await rec.hold(1100);

    // Scroll back to Hero top
    await rec.smoothScrollToY(0, 1000);
    await rec.showCallout('Фінал', '🌙 Світла й темна теми • Спробуйте в роботі просто зараз!');

    // Toggle Dark Mode
    await rec.moveTo('#btnAboutThemeToggle', 650);
    await page.evaluate(() => window.studioHighlight('#btnAboutThemeToggle', true));
    await rec.hold(300);
    await rec.clickAt('#btnAboutThemeToggle', null, 'chime');
    await page.evaluate(() => window.studioHighlight('#btnAboutThemeToggle', false));
    await rec.hold(1100);

    // Hover CTA "Спробувати в роботі ->"
    const ctaPrimarySel = '.ds-hero-ctas a[href="index.html"]';
    await rec.moveTo(ctaPrimarySel, 700);
    await page.evaluate((sel) => window.studioHighlight(sel, true), ctaPrimarySel);
    await rec.hold(1500);

    const totalSec = rec.frameIndex / FPS;
    console.log(`\n[Capture Complete] Recorded ${rec.frameIndex} frames (${totalSec.toFixed(2)}s @ ${FPS} FPS)`);

    // Generate Soundtrack WAV
    generateAmbientWav(TMP_WAV, totalSec, rec.sfxEvents);

    // Mux Video + Audio with FFmpeg
    console.log(`[FFmpeg] Encoding final MP4 -> ${OUTPUT_MP4}...`);
    const ffmpegCmd = [
      '/opt/homebrew/bin/ffmpeg -y',
      `-framerate ${FPS}`,
      `-i "${rec.folder}/frame_%05d.png"`,
      `-i "${TMP_WAV}"`,
      '-c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 -preset medium -crf 19',
      '-vf "scale=1920:-2"',
      '-c:a aac -b:a 192k -ar 44100',
      '-shortest -movflags +faststart',
      `"${OUTPUT_MP4}"`
    ].join(' ');

    execSync(ffmpegCmd, { stdio: 'inherit' });
    const sizeMb = (fs.statSync(OUTPUT_MP4).size / 1024 / 1024).toFixed(2);
    console.log(`\n🎉 SUCCESS! Created ${OUTPUT_MP4} (${sizeMb} MB, ${totalSec.toFixed(1)}s)`);
  } finally {
    await browser.close();
    server.close();
  }
}

runAboutTourDirector().catch((err) => {
  console.error('About Tour Director Error:', err);
  process.exit(1);
});
