/**
 * Тест нововведень UX:
 * 1. Дзеркальний низ картки (.card-foot-actions ліворуч, .card-foot-meta з вагою та статусом праворуч)
 * 2. Приховування плаваючих віджетів (.bottom-bar.hidden-during-search) під час пошуку
 * 3. Локалізована анімація валідації порожнього пошуку (input-shake-error замість браузерного tooltip)
 * 4. Внутрішній скрол списку видачі (.results-grid.has-match-rows)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ НОВИХ UX-ПОКРАЩЕНЬ (КАРТКИ, СКРОЛ, ВАЛІДАЦІЯ, BOTTOM-BAR)');
console.log('===============================================================\n');

// 1. Перевірка index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

console.log('▶ ТЕСТ 1: Відсутність нативного tooltip браузера (novalidate та видалення required)');
assert.ok(indexHtml.includes('<form id="searchForm" class="search-box-card" role="search" novalidate>'), 'Форма повинна мати атрибут novalidate');
const inputMatch = indexHtml.match(/<input[^>]*id="searchInput"[^>]*>/);
assert.ok(inputMatch, 'Поле searchInput має бути присутнє');
assert.ok(!inputMatch[0].includes('required'), 'Поле searchInput не повинно містити атрибут required');
console.log('  ✓ Успіх: novalidate встановлено, required прибрано.\n');

// 2. Перевірка styles.css
const stylesCss = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

console.log('▶ ТЕСТ 2: Перевірка стилів CSS (.input-shake-error, .results-grid.has-match-rows, .bottom-bar.hidden-during-search, .card-foot-meta)');
assert.ok(stylesCss.includes('.search-box-card.input-shake-error'), 'styles.css повинен містити клас .input-shake-error');
assert.ok(stylesCss.includes('@keyframes inputShake'), 'styles.css повинен містити keyframes inputShake');
assert.ok(stylesCss.includes('.results-grid.has-match-rows'), 'styles.css повинен містити .results-grid.has-match-rows з max-height');
assert.ok(stylesCss.includes('.bottom-bar.hidden-during-search'), 'styles.css повинен містити .bottom-bar.hidden-during-search');
assert.ok(stylesCss.includes('.card-foot-actions'), 'styles.css повинен містити .card-foot-actions');
assert.ok(stylesCss.includes('.card-foot-meta'), 'styles.css повинен містити .card-foot-meta');
assert.ok(stylesCss.includes('.status-pill'), 'styles.css повинен містити .status-pill');
console.log('  ✓ Успіх: Усі CSS-класи та анімації присутні.\n');

// 3. Перевірка коду app.js
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

console.log('▶ ТЕСТ 3: Дзеркальна структура картки в app.js (.card-foot-actions та .card-foot-meta)');
assert.ok(appJs.includes('<div class="card-foot-actions">'), 'app.js повинен містити контейнер .card-foot-actions');
assert.ok(appJs.includes('<div class="card-foot-meta">'), 'app.js повинен містити контейнер .card-foot-meta');
assert.ok(appJs.includes('<span class="status-pill"><span class="status-dot"></span> Працює</span>'), 'app.js повинен генерувати бейдж статусу');

const actionsIdx = appJs.indexOf('<div class="card-foot-actions">');
const metaIdx = appJs.indexOf('<div class="card-foot-meta">');
assert.ok(actionsIdx !== -1 && metaIdx !== -1 && actionsIdx < metaIdx, 'Кнопки дій повинні стояти ліворуч від блоку мета-інформації');
console.log('  ✓ Успіх: Кнопки дій ліворуч, мета та статус праворуч.\n');

console.log('▶ ТЕСТ 4: Локалізована анімація валідації input-shake-error при порожньому submit');
assert.ok(appJs.includes('searchBoxCard.classList.add(\'input-shake-error\')'), 'app.js повинен додавати input-shake-error');
assert.ok(appJs.includes('if (!rawVal)'), 'app.js повинен перевіряти rawVal на порожній рядок');
console.log('  ✓ Успіх: input-shake-error коректно викликається при submit без тексту.\n');

console.log('▶ ТЕСТ 5: updateBottomBarVisibility() та внутрішній скрол результатів');
assert.ok(appJs.includes('function updateBottomBarVisibility'), 'app.js повинен містити функцію updateBottomBarVisibility');
assert.ok(appJs.includes('hidden-during-search'), 'app.js повинен перемикати клас hidden-during-search');
assert.ok(appJs.includes('dom.resultsList.addEventListener(\'scroll\''), 'app.js повинен мати scroll listener на dom.resultsList');
console.log('  ✓ Успіх: updateBottomBarVisibility та скрол списку результатів налаштовані.\n');

console.log('===============================================================');
console.log('🎉 ВСІ UX-ТЕСТИ ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
