/**
 * scripts/download_all_settlements.js
 * 
 * Автономний скрипт для повного завантаження реєстру всіх населених пунктів України
 * (26 000+ міст, смт, селищ та сіл) через офіційне API Нової Пошти (AddressGeneral/getSettlements).
 * 
 * Оптимізовано за правилами:
 * - token-budget-guard
 * - js-memory-perf-optimizer
 * Зберігає лише критично необхідні поля: name, cleanName, type, oblast, raion.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Читання .env файлу, якщо змінні не передані через process.env
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...rest] = trimmed.split('=');
          const val = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = val;
          }
        }
      }
    } catch (e) {
      console.warn('Не вдалося завантажити .env:', e.message);
    }
  }
}

loadEnv();

const API_KEY = process.env.NP_API_KEY || process.env.NOVA_POSHTA_API_KEY || '';
const PAGE_SIZE = 1000;
const CONCURRENCY = 4;

function queryApi(model, method, props, retryCount = 3) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('Не задано NP_API_KEY або NOVA_POSHTA_API_KEY у .env або змінних середовища'));
    }
    const payload = JSON.stringify({
      apiKey: API_KEY,
      modelName: model,
      calledMethod: method,
      methodProperties: props
    });

    const attempt = (left) => {
      const req = https.request('https://api.novaposhta.ua/v2.0/json/', {
        method: 'POST',
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.success) {
              resolve(parsed);
            } else {
              if (left > 0) {
                setTimeout(() => attempt(left - 1), 1000);
              } else {
                reject(new Error(JSON.stringify(parsed.errors || parsed.warnings)));
              }
            }
          } catch (err) {
            if (left > 0) setTimeout(() => attempt(left - 1), 1000);
            else reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        if (left > 0) setTimeout(() => attempt(left - 1), 1000);
        else reject(new Error('Запит до API перевищив таймаут (20с)'));
      });

      req.on('error', err => {
        if (left > 0) setTimeout(() => attempt(left - 1), 1000);
        else reject(err);
      });

      req.write(payload);
      req.end();
    };

    attempt(retryCount);
  });
}

function transformSettlement(item) {
  const rawDesc = (item.Description || '').trim();
  const pureDesc = rawDesc.replace(/\s*\([^)]+\)/g, '').trim();
  const cleanName = pureDesc || rawDesc;
  const type = (item.SettlementTypeDescription || '').trim().toLowerCase();
  const name = type ? `${type} ${cleanName}` : cleanName;
  const oblast = (item.AreaDescription || '').replace(/\s+область$/i, '').trim();
  const raion = (item.RegionsDescription || '').replace(/\s+(р-н|район)$/i, '').trim();

  return {
    name,
    cleanName,
    type,
    oblast,
    raion
  };
}

async function downloadAllSettlements() {
  console.log('===============================================================');
  console.log('🚀 ЗАВАНТАЖЕННЯ ПОВНОГО РЕЄСТРУ НАСЕЛЕНИХ ПУНКТІВ УКРАЇНИ');
  console.log('===============================================================\n');

  console.log('[1/4] Запит першої сторінки для визначення кількості...');
  const page1 = await queryApi('AddressGeneral', 'getSettlements', {
    Limit: String(PAGE_SIZE),
    Page: '1'
  });

  if (!page1 || !page1.success || !Array.isArray(page1.data)) {
    throw new Error('Помилка отримання першої сторінки: ' + JSON.stringify(page1 ? page1.errors : 'null'));
  }

  const totalCount = (page1.info && page1.info.totalCount) ? parseInt(page1.info.totalCount, 10) : 27000;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  console.log(`✓ Загальна кількість населених пунктів в API: ${totalCount} (сторінок: ${totalPages})`);

  const allItems = [...page1.data];
  console.log(`✓ Сторінка 1 / ${totalPages} завантажена (${page1.data.length} записів)`);

  console.log(`\n[2/4] Завантаження сторінок 2..${totalPages} (паралельність: ${CONCURRENCY})...`);
  const remainingPages = [];
  for (let p = 2; p <= totalPages; p++) {
    remainingPages.push(p);
  }

  let index = 0;
  async function worker() {
    while (index < remainingPages.length) {
      const pageNum = remainingPages[index++];
      try {
        const res = await queryApi('AddressGeneral', 'getSettlements', {
          Limit: String(PAGE_SIZE),
          Page: String(pageNum)
        });
        if (res && res.success && Array.isArray(res.data)) {
          allItems.push(...res.data);
          process.stdout.write(`\rЗавантажено сторінку ${pageNum}/${totalPages} | Загалом: ${allItems.length}...`);
        }
      } catch (err) {
        console.error(`\nПомилка на сторінці ${pageNum}:`, err.message);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  console.log(`\n✓ Усі сторінки завантажено. Всього отримано сирих записів: ${allItems.length}`);

  console.log('\n[3/4] Оптимізація та видалення дублікатів...');
  const seenKeys = new Set();
  const cleanSettlements = [];

  for (const item of allItems) {
    if (!item.Description) continue;
    const transformed = transformSettlement(item);
    const key = `${transformed.cleanName.toLowerCase()}|${transformed.oblast.toLowerCase()}|${transformed.raion.toLowerCase()}|${transformed.type.toLowerCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      cleanSettlements.push(transformed);
    }
  }

  console.log(`✓ Унікальних населених пунктів після дедуплікації: ${cleanSettlements.length}`);

  console.log('\n[4/4] Збереження оптимізованого реєстру...');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 1. data/all_settlements.json
  const jsonPath = path.join(dataDir, 'all_settlements.json');
  fs.writeFileSync(jsonPath, JSON.stringify(cleanSettlements), 'utf8');
  const jsonSizeMb = (fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2);
  console.log(`✓ Збережено JSON: ${jsonPath} (${jsonSizeMb} MB)`);

  // 2. data/all_settlements.js (компактна словникова схема для автономної роботи в браузері без CORS)
  const jsPath = path.join(dataDir, 'all_settlements.js');
  const jsContent = buildCompactSettlementsJs(cleanSettlements);
  fs.writeFileSync(jsPath, jsContent, 'utf8');
  const jsSizeMb = (fs.statSync(jsPath).size / 1024 / 1024).toFixed(2);
  console.log(`✓ Збережено JS: ${jsPath} (${jsSizeMb} MB)`);

  console.log('\n===============================================================');
  console.log('🎉 УСПІШНО ЗАВАНТАЖЕНО ТА ЗБЕРЕЖЕНО ПОВНИЙ РЕЄСТР!');
  console.log('===============================================================');
}

function buildCompactSettlementsJs(settlements) {
  const sp = [];
  const spMap = new Map();
  function intern(s) {
    if (!spMap.has(s)) {
      spMap.set(s, sp.length);
      sp.push(s);
    }
    return spMap.get(s);
  }
  const rows = settlements.map(s => {
    const isStandardName = s.name === (s.type + ' ' + s.cleanName);
    return [
      isStandardName ? 0 : s.name,
      s.cleanName,
      intern(s.type || ''),
      intern(s.oblast || ''),
      intern(s.raion || '')
    ];
  });
  const packedStr = JSON.stringify({ sp, r: rows });
  const escaped = packedStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return (
    `// Реєстр населених пунктів України (Нова Пошта API AddressGeneral/getSettlements)\n` +
    `// Оновлено: ${new Date().toISOString()} | Кількість: ${settlements.length}\n` +
    `(function() {\n` +
    `  var p = JSON.parse('${escaped}');\n` +
    `  var sp = p.sp;\n` +
    `  var r = p.r;\n` +
    `  var len = r.length;\n` +
    `  var out = new Array(len);\n` +
    `  for (var i = 0; i < len; i++) {\n` +
    `    var row = r[i];\n` +
    `    var t = sp[row[2]];\n` +
    `    var cn = row[1];\n` +
    `    out[i] = {\n` +
    `      name: row[0] === 0 ? (t + ' ' + cn) : row[0],\n` +
    `      cleanName: cn,\n` +
    `      type: t,\n` +
    `      oblast: sp[row[3]],\n` +
    `      raion: sp[row[4]]\n` +
    `    };\n` +
    `  }\n` +
    `  var root = typeof window !== 'undefined' ? window : globalThis;\n` +
    `  root.ALL_SETTLEMENTS_DATA = out;\n` +
    `})();\n`
  );
}

if (process.argv.includes('--from-json')) {
  const dataDir = path.join(__dirname, '..', 'data');
  const cleanSettlements = JSON.parse(fs.readFileSync(path.join(dataDir, 'all_settlements.json'), 'utf8'));
  const jsPath = path.join(dataDir, 'all_settlements.js');
  const jsContent = buildCompactSettlementsJs(cleanSettlements);
  fs.writeFileSync(jsPath, jsContent, 'utf8');
  console.log(`OK: ${jsPath} (${(jsContent.length / 1e6).toFixed(2)} MB, count=${cleanSettlements.length})`);
} else {
  downloadAllSettlements().catch(err => {
    console.error('\n❌ Критична помилка під час вивантаження:', err);
    process.exit(1);
  });
}
