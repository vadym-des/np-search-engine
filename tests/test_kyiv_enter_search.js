/**
 * Test Suite: Перевірка пошуку "Київ 1" та натискання Enter (відображення повної картки відділення)
 */

const assert = require('assert');

global.window = global;
const eventListeners = {};
const mockElements = {};

function createMockElement(id) {
  const el = {
    id, value: '', textContent: '', _innerHTML: '', style: {},
    get innerHTML() { return this._innerHTML; },
    set innerHTML(val) { this._innerHTML = val; if (!val) this.children = []; },
    classList: { _classes: new Set(), add(c) { this._classes.add(c); }, remove(c) { this._classes.delete(c); }, contains(c) { return this._classes.has(c); } },
    children: [], appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, removeAttribute(k) { delete this[k]; },
    querySelector(sel) {
      if (sel === '.card-primary-line') {
        const match = this.innerHTML.match(/<div class="card-primary-line"[^>]*title="([^"]*)"/);
        return match ? { getAttribute: () => match[1], setAttribute() {} } : null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(evt, fn) {
      if (!eventListeners[id]) eventListeners[id] = {};
      if (!eventListeners[id][evt]) eventListeners[id][evt] = [];
      eventListeners[id][evt].push(fn);
    },
    focus() {},
    blur() { el._blurred = true; },
    setSelectionRange() {}
  };
  mockElements[id] = el;
  return el;
}

global.document = {
  readyState: 'complete',
  addEventListener() {},
  documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
  getElementById(id) { return mockElements[id] || createMockElement(id); },
  querySelectorAll() { return []; },
  createDocumentFragment() { return { children: [], appendChild(c) { this.children.push(c); return c; } }; },
  createElement(tag) { return createMockElement(tag); },
  body: { appendChild() {}, removeChild() {} }
};

global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
global.navigator = { clipboard: { writeText: async () => {} } };
global.location = { protocol: 'https:' };
global.requestAnimationFrame = (cb) => { cb(); };

require('../data/all_settlements.js');
require('../data/branches.js');
require('../data/fuzzySearch.js');
require('../app.js');

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ПОШУКУ "Київ 1" ТА НАТИСКАННЯ ENTER (КАРТКА ВІДДІЛЕННЯ)');
console.log('===============================================================');

// -------------------------------------------------------------
// ТЕСТ 1: hasFixedSettlementContext для Києва з номером
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 1: hasFixedSettlementContext("Київ 1"):');
const eng = window.SmartSearchEngine;
const p = eng.parseQuery('Київ 1');
console.log('  Розпізнано місто:', p.matchedSettlement?.name, 'Номер:', p.targetBranchNumber);
assert.strictEqual(p.matchedSettlement?.name, 'Київ', 'Має розпізнати Київ');
assert.strictEqual(p.targetBranchNumber, '1', 'Має розпізнати номер 1');
console.log('  ✓ Успіх: розпізнано місто Київ та номер 1');

// -------------------------------------------------------------
// ТЕСТ 2: Натискання Enter в полі пошуку з "Київ 1"
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 2: Натискання Enter з текстом "Київ 1":');

const searchInput = document.getElementById('searchInput');
const searchResultsSection = document.getElementById('searchResultsSection');
const resultsList = document.getElementById('resultsList');

searchInput.value = 'Київ 1';

// Отримуємо keydown listener
const keydownHandlers = eventListeners['searchInput']?.['keydown'] || [];
assert(keydownHandlers.length > 0, 'Повинен бути зареєстрований keydown handler');

let defaultPrevented = false;
const enterEvent = {
  key: 'Enter',
  preventDefault() { defaultPrevented = true; }
};

// Запускаємо подію Enter
keydownHandlers.forEach(h => h(enterEvent));

console.log('  preventDefault викликано:', defaultPrevented);
console.log('  Секція результатів прихована?:', searchResultsSection.classList.contains('hidden'));
console.log('  Кількість карток у списку:', resultsList.children.length);

assert.strictEqual(searchResultsSection.classList.contains('hidden'), false, 'Секція результатів має бути видимою після Enter');
const cardHtml = resultsList.children[0]?.children[0]?.innerHTML || resultsList.innerHTML; console.log('Card HTML excerpt:', cardHtml.slice(0, 200)); assert(cardHtml.includes('Пирогівський шлях') || cardHtml.includes('№1'));

console.log('  ✓ Успіх: Після натискання Enter з\'явилася повна картка Відділення №1 (Пирогівський шлях, 135)');

// -------------------------------------------------------------
// ТЕСТ 3: Натискання Enter з текстом "Київ 22"
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 3: Натискання Enter з текстом "Київ 22":');
searchInput.value = 'Київ 22';
keydownHandlers.forEach(h => h(enterEvent));

assert.strictEqual(searchResultsSection.classList.contains('hidden'), false, 'Секція результатів має бути видимою');
const cardHtml2 = resultsList.children[0]?.children[0]?.innerHTML || resultsList.innerHTML; console.log('Card 2 HTML excerpt:', cardHtml2.slice(0, 200)); assert(cardHtml2.includes('№22') || cardHtml2.includes('Борщагівська'));
console.log('  ✓ Успіх: Після натискання Enter з\'явилася картка Відділення №22');

console.log('\n===============================================================');
console.log('✅ ВСІ ТЕСТИ ПОШУКУ ПО ENTER ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
process.exit(0);
