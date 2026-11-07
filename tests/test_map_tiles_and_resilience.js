/**
 * Тести валідації оновленої картографічної системи (v1.6.30)
 * Перевіряє відсутність заблокованих API-ключів Carto, усунення помилок 403 OSM,
 * наявність GPU-адаптації темної теми та відмовостійкий фолбек плиток.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const appJsPath = path.join(rootDir, 'app.js');
const stylesCssPath = path.join(rootDir, 'styles.css');
const indexHtmlPath = path.join(rootDir, 'index.html');
const swJsPath = path.join(rootDir, 'sw.js');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    console.log(`  ✓ Успіх: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ ПОМИЛКА: ${testName}`);
    if (details) console.error(`    Деталі: ${details}`);
    process.exitCode = 1;
  }
}

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ КАРТИ, ТАЙЛІВ ТА ШВИДКОДІЇ (v1.6.30)');
console.log('===============================================================\n');

// 1. styles.css перевірка
console.log('▶ ТЕСТ 1: Перевірка стилів CSS для темної підкладки карти');
const cssContent = fs.readFileSync(stylesCssPath, 'utf8');
assert(
  cssContent.includes('[data-theme="dark"] .leaflet-tile') &&
  cssContent.includes('filter: brightness(0.65) invert(1) contrast(3) hue-rotate(200deg) saturate(0.35) brightness(0.75)'),
  'Апаратний GPU-фільтр темної теми присутній у styles.css'
);
assert(
  !cssContent.includes('[data-theme="dark"] .leaflet-tile {\n  filter: none;\n}'),
  'Застарілий "filter: none" для темної теми успішно прибрано'
);
assert(
  cssContent.includes('transition: filter 0.15s ease-out;'),
  'Плавний перехід фільтра між темами (.leaflet-tile) присутній'
);

// 2. app.js перевірка конфігурації тайлів
console.log('\n▶ ТЕСТ 2: Перевірка логіки тайлів та фолбеку в app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

assert(
  !appJsContent.includes('basemaps.cartocdn.com'),
  'CartoDB URL (водяний знак API KEY REQUIRED) повністю прибрано з app.js'
);

assert(
  appJsContent.includes('isLocalFileProtocol'),
  'Локальний протокол file:// детектується для захисту від блокування OpenStreetMap'
);

assert(
  appJsContent.includes('server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'),
  'Високошвидкісний резервний CDN Esri налаштований'
);

assert(
  appJsContent.includes('createOptimizedTileLayer'),
  'Функція створення оптимізованого шару плиток присутня'
);

assert(
  appJsContent.includes('tileerror') && appJsContent.includes('_fallbackTried'),
  'Автоматичний захист від збоїв мережі та 403 (обробник tileerror) реалізовано'
);

assert(
  appJsContent.includes('if (state.currentTileLayer && state.currentTileLayer._url === tileConf.url)'),
  'Миттєве 0 мс перемикання теми без зайвого перестворення шару реалізовано'
);

// 3. index.html та мета-теги
console.log('\n▶ ТЕСТ 3: Перевірка index.html та Referrer Policy');
const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

assert(
  htmlContent.includes('<meta name="referrer" content="strict-origin-when-cross-origin">'),
  'Сучасний meta referrer strict-origin-when-cross-origin додано до <head>'
);

assert(
  (htmlContent.includes('v1.6.31') && htmlContent.includes('styles.css?v=1.6.31')) ||
  (htmlContent.includes('v1.6.30') && htmlContent.includes('styles.css?v=1.6.30')),
  'Версію index.html та query-параметри підключення актуалізовано до актуальної версії'
);

assert(
  !htmlContent.includes('online-counter-badge') && !htmlContent.includes('onlineUsersCount'),
  'Тег "Онлайн: 1" повністю прибрано зі сторінки'
);

assert(
  htmlContent.includes('corner-feedback-btn') && !htmlContent.includes('class="feedback-text">Фідбек<'),
  'Кнопка Feedback переміщена в правий нижній кут у вигляді лаконічної іконки чату'
);

assert(
  htmlContent.includes('<div class="top-nav-actions">\n        <!-- Кнопка налаштувань шаблону копіювання -->\n        <button id="btnHeaderCopySettings"') &&
  htmlContent.includes('<button id="btnThemeToggle" class="theme-toggle-btn icon-tool-btn"'),
  'Кнопки зміни теми та налаштувань розташовані у правому верхньому куті'
);

// 4. sw.js та CHANGELOG.md
console.log('\n▶ ТЕСТ 4: Синхронізація версій sw.js та CHANGELOG.md');
const swContent = fs.readFileSync(swJsPath, 'utf8');
const changelogContent = fs.readFileSync(changelogPath, 'utf8');

assert(
  (swContent.includes("const CACHE_VERSION = 'v1.6.31';") && swContent.includes("const CACHE_NAME = 'np-search-cache-v1.6.31';")) ||
  (swContent.includes("const CACHE_VERSION = 'v1.6.30';") && swContent.includes("const CACHE_NAME = 'np-search-cache-v1.6.30';")),
  'Service Worker оновлено до актуальної версії'
);

assert(
  changelogContent.includes('## [1.6.30] — 2026-11-06'),
  'CHANGELOG.md містить детальний звіт релізу 1.6.30'
);

console.log('\n===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passedTests} / ${totalTests} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

if (passedTests !== totalTests) {
  process.exit(1);
}
