/**
 * Тести підтримки старих/нових районів (Адмінреформа 2020) та історичних назв
 */

const assert = require('assert');

global.window = global;
const eventListeners = {};
const mockElements = {};
function createMockElement(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '', style: {},
    classList: { _classes: new Set(), add(c) { this._classes.add(c); }, remove(c) { this._classes.delete(c); }, contains(c) { return this._classes.has(c); } },
    children: [], appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; }, removeAttribute(k) { delete this[k]; },
    querySelector(sel) {
      if (sel === '.card-geo-line') return { textContent: this.innerHTML, innerHTML: this.innerHTML };
      if (sel === '.settlement-history-hint') {
        const match = this.innerHTML.match(/<div class="settlement-history-hint"[^>]*>([\s\S]*?)<\/div>/);
        return match ? { textContent: match[1], innerHTML: match[1] } : null;
      }
      return { style: {}, setAttribute() {}, getAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } };
    },
    querySelectorAll() { return []; },
    addEventListener(event, handler) {
      if (!eventListeners[id]) eventListeners[id] = {};
      if (!eventListeners[id][event]) eventListeners[id][event] = [];
      eventListeners[id][event].push(handler);
    },
    dispatchEvent(event) {
      const handlers = (eventListeners[id] && eventListeners[id][event.type]) || [];
      handlers.forEach(h => h(event));
    },
    focus() {}, blur() {}, setSelectionRange() {}
  };
  mockElements[id] = el;
  return el;
}

global.document = {
  readyState: 'complete',
  addEventListener(event, handler) {
    if (!eventListeners.document) eventListeners.document = {};
    if (!eventListeners.document[event]) eventListeners.document[event] = [];
    eventListeners.document[event].push(handler);
  },
  documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
  getElementById(id) { return mockElements[id] || createMockElement(id); },
  querySelectorAll() { return []; },
  createDocumentFragment() { return { children: [], appendChild(c) { this.children.push(c); return c; } }; },
  createElement(tag) {
    return {
      tagName: tag, style: {}, dataset: {},
      classList: { _classes: new Set(), add(c) { this._classes.add(c); }, remove(c) { this._classes.delete(c); }, contains(c) { return this._classes.has(c); } },
      innerHTML: '', children: [], appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k]; },
      querySelector(sel) {
        if (sel === '.settlement-history-hint') {
          const match = this.innerHTML.match(/<div class="settlement-history-hint"[^>]*>([\s\S]*?)<\/div>/);
          return match ? { textContent: match[1], innerHTML: match[1] } : null;
        }
        return { style: {}, setAttribute() {}, getAttribute() {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} };
      },
      querySelectorAll() { return []; },
      addEventListener() {}
    };
  },
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

const eng = window.SmartSearchEngine;
const branches = window.BRANCHES_DATA.novaposhta;

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ АДМІНРЕФОРМИ 2020: СТАРІ/НОВІ РАЙОНИ ТА ІСТОРІЯ');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  console.log(`▶ ТЕСТ ${totalTests}: ${name}`);
  try {
    fn();
    passedTests++;
    console.log('  ✓ Успіх\n');
  } catch (err) {
    console.error(`  ✗ ПОМИЛКА: ${err.message}\n`, err);
    process.exitCode = 1;
  }
}

// 1. Пошук Буялик за старим районом "Іванівський"
runTest('Запит "Буялик Іванівський" знаходить відділення Буялика', () => {
  const res = eng.searchBranches('Буялик Іванівський', branches);
  assert(res.length > 0, 'Має знайти хоча б одне відділення');
  assert.strictEqual(res[0].city, 'Буялик', 'Місто першого результату має бути Буялик');
});

// 2. Пошук Буялик за новим районом "Березівський"
runTest('Запит "Буялик Березівський" знаходить те саме відділення Буялика', () => {
  const res = eng.searchBranches('Буялик Березівський', branches);
  assert(res.length > 0, 'Має знайти хоча б одне відділення');
  assert.strictEqual(res[0].city, 'Буялик', 'Місто першого результату має бути Буялик');
});

// 3. Картка результату Буялик: новий район Березівський + підказка До 2020: Іванівський р-н + кол. назва Петрівка
runTest('Картка Буялика показує Березівський р-н та підказку До 2020 року: Іванівський р-н', () => {
  const branch = branches.find(b => b.city === 'Буялик' && b.number === '1');
  assert(branch, 'Відділення №1 Буялик має існувати в базі');
  const card = window.renderResultCard(branch);
  const cardHtml = card.innerHTML;

  assert(cardHtml.includes('Березівський р-н'), 'Картка повинна показувати актуальний Березівський р-н');
  assert(cardHtml.includes('settlement-history-hint'), 'Картка повинна містити блок settlement-history-hint');
  assert(cardHtml.includes('До 2020 року: <strong>Іванівський р-н</strong>'), 'Підказка повинна містити старий Іванівський р-н');
  assert(cardHtml.includes('кол. назва: <strong>Петрівка</strong>'), 'Підказка повинна містити колишню назву Петрівка');
});

// 4. Картка результату Березнегувате (Миколаївська): показує Баштанський р-н + До 2020 року: Березнегуватський р-н
runTest('Картка Березнегуватого показує Баштанський р-н та підказку До 2020 року: Березнегуватський р-н', () => {
  const branch = branches.find(b => b.city === 'Березнегувате' && b.number === '1');
  assert(branch, 'Відділення №1 Березнегувате має існувати в базі');
  const card = window.renderResultCard(branch);
  const cardHtml = card.innerHTML;

  assert(cardHtml.includes('Баштанський р-н'), 'Картка повинна показувати актуальний Баштанський р-н');
  assert(cardHtml.includes('settlement-history-hint'), 'Картка повинна містити блок settlement-history-hint');
  assert(cardHtml.includes('До 2020 року: <strong>Березнегуватський р-н</strong>'), 'Підказка повинна містити старий Березнегуватський р-н');
});

// 5. Конструктор копіювання ("Скопіювати" / "Детально") використовує актуальний новий район КАТОТТГ
runTest('Конструктор копіювання використовує новий район (Березівський, Баштанський) замість ліквідованих', () => {
  const branchBuyalyk = branches.find(b => b.city === 'Буялик' && b.number === '1');
  const detailedBuyalyk = window.formatDetailedCopyString(branchBuyalyk);
  assert(detailedBuyalyk.includes('Березівський р-н'), `Детальне копіювання Буялика має містити Березівський р-н: "${detailedBuyalyk}"`);
  assert(!detailedBuyalyk.includes('Іванівський'), `Детальне копіювання не повинно містити старий Іванівський р-н: "${detailedBuyalyk}"`);

  const branchBerez = branches.find(b => b.city === 'Березнегувате' && b.number === '1');
  const detailedBerez = window.formatDetailedCopyString(branchBerez);
  assert(detailedBerez.includes('Баштанський р-н'), `Детальне копіювання Березнегуватого має містити Баштанський р-н: "${detailedBerez}"`);
  assert(!detailedBerez.includes('Березнегуватський р-н'), `Детальне копіювання не повинно містити старий Березнегуватський р-н: "${detailedBerez}"`);
});

// 6. Довідник data/raion_aliases.json валідний та містить необхідні прив'язки
runTest('Довідник data/raion_aliases.json валідний та доступний', () => {
  const fs = require('fs');
  const raw = fs.readFileSync('./data/raion_aliases.json', 'utf8');
  const parsed = JSON.parse(raw);
  assert(parsed.raion_aliases, 'Має містити raion_aliases');
  assert(parsed.raion_aliases['іванівський'], 'Має містити іванівський');
  assert.strictEqual(parsed.raion_aliases['іванівський'].new, 'Березівський');
  assert(parsed.raion_aliases['березнегуватський'], 'Має містити березнегуватський');
  assert.strictEqual(parsed.raion_aliases['березнегуватський'].new, 'Баштанський');
});

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passedTests} / ${totalTests} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

process.exit(0);
