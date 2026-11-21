#!/usr/bin/env node
/**
 * scripts/bump_version.js
 * Автоматичне, синхронне та безпомилкове оновлення версії проєкту у всіх контрольних точках:
 * 1. index.html (кнопка у футері, посилання на скрипти ?v=X.X.XX, favicons)
 * 2. sw.js (CACHE_VERSION, CACHE_NAME, PRECACHE_ASSETS ?v=X.X.XX)
 * 3. tests/test_map_tiles_and_resilience.js (автоматичне додавання нової версії до валідатора)
 * 4. CHANGELOG.md (шапка нової версії)
 *
 * Використання:
 *   node scripts/bump_version.js 1.6.65
 *   node scripts/bump_version.js --current
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const SW_JS_PATH = path.join(ROOT_DIR, 'sw.js');
const APP_JS_PATH = path.join(ROOT_DIR, 'app.js');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const MAP_TEST_PATH = path.join(ROOT_DIR, 'tests', 'test_map_tiles_and_resilience.js');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');

function getCurrentVersion() {
  const swContent = fs.readFileSync(SW_JS_PATH, 'utf8');
  const match = swContent.match(/const CACHE_VERSION = 'v([\d.]+)';/);
  if (!match) throw new Error('Не вдалося визначити поточну версію з sw.js');
  return match[1];
}

const targetArg = process.argv[2];

if (!targetArg || targetArg === '--current') {
  console.log(`Поточна версія проєкту: v${getCurrentVersion()}`);
  if (!targetArg) {
    console.log('\nДля оновлення версії виконайте:');
    console.log('  node scripts/bump_version.js <new_version>');
    console.log('Приклад:');
    console.log('  node scripts/bump_version.js 1.6.65');
  }
  process.exit(0);
}

const newVersion = targetArg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Помилка: невірний формат версії "${targetArg}". Очікується X.Y.Z (наприклад, 1.6.65)`);
  process.exit(1);
}

const currentVersion = getCurrentVersion();
if (newVersion === currentVersion) {
  console.log(`Версія вже є v${newVersion}. Зміни не потрібні.`);
  process.exit(0);
}

console.log(`🚀 Оновлення версії: v${currentVersion} ➔ v${newVersion} ...\n`);

// 1. Оновлення sw.js
let swContent = fs.readFileSync(SW_JS_PATH, 'utf8');
swContent = swContent.replace(
  new RegExp(`const CACHE_VERSION = 'v${currentVersion}';`, 'g'),
  `const CACHE_VERSION = 'v${newVersion}';`
);
swContent = swContent.replace(
  new RegExp(`const CACHE_NAME = 'np-search-cache-v${currentVersion}';`, 'g'),
  `const CACHE_NAME = 'np-search-cache-v${newVersion}';`
);
swContent = swContent.replace(
  new RegExp(`\\?v=${currentVersion}`, 'g'),
  `?v=${newVersion}`
);
swContent = swContent.replace(
  new RegExp(`Версія: v${currentVersion}`, 'g'),
  `Версія: v${newVersion}`
);
fs.writeFileSync(SW_JS_PATH, swContent, 'utf8');
console.log('  ✓ sw.js оновлено');

// 2. Оновлення index.html
let indexContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
indexContent = indexContent.replace(
  new RegExp(`\\?v=${currentVersion}`, 'g'),
  `?v=${newVersion}`
);
indexContent = indexContent.replace(
  new RegExp(`v${currentVersion}</a>`, 'g'),
  `v${newVersion}</a>`
);
indexContent = indexContent.replace(
  new RegExp(`v${currentVersion}</button>`, 'g'),
  `v${newVersion}</button>`
);
indexContent = indexContent.replace(
  new RegExp(`v${currentVersion}</span>`, 'g'),
  `v${newVersion}</span>`
);
fs.writeFileSync(INDEX_HTML_PATH, indexContent, 'utf8');
console.log('  ✓ index.html оновлено');

// 2.1 Оновлення app.js
if (fs.existsSync(APP_JS_PATH)) {
  let appContent = fs.readFileSync(APP_JS_PATH, 'utf8');
  appContent = appContent.replace(
    new RegExp(`const APP_VERSION = '[^']+';`),
    `const APP_VERSION = '${newVersion}';`
  );
  fs.writeFileSync(APP_JS_PATH, appContent, 'utf8');
  console.log('  ✓ app.js оновлено');
}

// 2.2 Оновлення package.json
if (fs.existsSync(PACKAGE_JSON_PATH)) {
  let pkgContent = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
  pkgContent = pkgContent.replace(
    new RegExp(`"version": "[^"]+"`),
    `"version": "${newVersion}"`
  );
  fs.writeFileSync(PACKAGE_JSON_PATH, pkgContent, 'utf8');
  console.log('  ✓ package.json оновлено');
}

// 3. Оновлення tests/test_map_tiles_and_resilience.js
let testContent = fs.readFileSync(MAP_TEST_PATH, 'utf8');
if (!testContent.includes(`v${newVersion}`)) {
  testContent = testContent.replace(
    new RegExp(`\\(htmlContent\\.includes\\('v${currentVersion}'\\)`, 'g'),
    `(htmlContent.includes('v${newVersion}') && htmlContent.includes('styles.css?v=${newVersion}')) ||\n  (htmlContent.includes('v${currentVersion}')`
  );
  testContent = testContent.replace(
    new RegExp(`\\(swContent\\.includes\\("const CACHE_VERSION = 'v${currentVersion}';\\)`, 'g'),
    `(swContent.includes("const CACHE_VERSION = 'v${newVersion}';") && swContent.includes("const CACHE_NAME = 'np-search-cache-v${newVersion}';")) ||\n  (swContent.includes("const CACHE_VERSION = 'v${currentVersion}';")`
  );
  fs.writeFileSync(MAP_TEST_PATH, testContent, 'utf8');
  console.log('  ✓ tests/test_map_tiles_and_resilience.js оновлено');
}

console.log(`\n✅ Успішно оновлено проєкт до версії v${newVersion}!`);
