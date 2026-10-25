/**
 * Automated Test for Input Reactivity & Autocomplete Disambiguation
 * Verifies:
 * 1. Single space formatting when selecting settlement from popup
 * 2. Instant reset of selectedSettlement / selectedBranch on manual Backspace editing
 * 3. Re-opening autocomplete dropdown with all region collision variants
 * 4. Refreshing search results without "відділень не знайдено" lockup
 */

const assert = require('assert');

// DOM Mocks
const eventListeners = {};
const mockElements = {};

function createMockElement(id) {
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this.contains(c)) this.remove(c);
          else this.add(c);
        } else if (force) {
          this.add(c);
        } else {
          this.remove(c);
        }
      }
    },
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    removeAttribute(k) { delete this[k]; },
    querySelector() { return { style: {}, setAttribute() {}, getAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } }; },
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
    focus() {},
    blur() {},
    setSelectionRange() {}
  };
  mockElements[id] = el;
  return el;
}

global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener(event, handler) {
    if (!eventListeners.document) eventListeners.document = {};
    if (!eventListeners.document[event]) eventListeners.document[event] = [];
    eventListeners.document[event].push(handler);
  },
  removeEventListener() {},
  documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
  getElementById(id) {
    return mockElements[id] || createMockElement(id);
  },
  querySelectorAll() { return []; },
  createDocumentFragment() {
    return {
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      }
    };
  },
  createElement(tag) {
    return {
      tagName: tag,
      style: {},
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); }
      },
      innerHTML: '',
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; },
      addEventListener(event, handler) {
        if (!this._listeners) this._listeners = {};
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
      },
      dispatchEvent(event) {
        const handlers = (this._listeners && this._listeners[event.type]) || [];
        handlers.forEach(h => h(event));
      }
    };
  },
  body: {
    appendChild() {},
    removeChild() {}
  }
};

global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; }
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.location = { protocol: 'https:' };
global.requestAnimationFrame = (cb) => { cb(); };

require('../data/all_settlements.js');
require('../data/branches.js');
require('../data/fuzzySearch.js');
require('../app.js');

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ РЕАКТИВНОСТІ ІНПУТУ ТА ДЕЗАМБІГУАЦІЇ АВТОКОМПЛІТУ');
console.log('===============================================================\n');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`▶ ТЕСТ ${totalTests}: ${name}`);
    console.log(`  ✓ Успіх\n`);
  } catch (err) {
    console.error(`▶ ТЕСТ ${totalTests}: ${name}`);
    console.error(`  ✕ ПОМИЛКА:`, err.message, '\n');
    process.exitCode = 1;
  }
}

async function runAll() {
  // 1. Перевірка автокомпліту для Березнегувате
  await runTest('Отримання варіантів автокомпліту для Березнегувате (дезамбігуація регіонів)', () => {
    const suggestions = window.SmartSearchEngine.getAutocompleteSuggestions('Березнегувате', 'novaposhta');
    assert(Array.isArray(suggestions) && suggestions.length >= 2, 'Має бути щонайменше 2 варіанти');

    const kirovohrad = suggestions.find(s => (s.subtitle && s.subtitle.includes('Кіровоградська')) || (s.oblast && s.oblast.includes('Кіровоградська')));
    const mykolaiv = suggestions.find(s => (s.subtitle && s.subtitle.includes('Миколаївська')) || (s.oblast && s.oblast.includes('Миколаївська')));

    assert(kirovohrad, 'Повинен бути варіант з Кіровоградською обл.');
    assert(mykolaiv, 'Повинен бути варіант з Миколаївською обл.');

    assert.strictEqual(kirovohrad.settlement, 'Березнегувате', 'Поле settlement має бути чистим');
    assert.strictEqual(kirovohrad.raion, 'Компаніївський', 'Поле raion має бути Компаніївський');
    assert.strictEqual(kirovohrad.oblast, 'Кіровоградська', 'Поле oblast має бути Кіровоградська');
  });

  // 2. Форматування при підстановці з підказки (одинарні пробіли)
  await runTest('Форматування при підстановці: "Березнегувате Компаніївський Кіровоградська"', () => {
    const suggestions = window.SmartSearchEngine.getAutocompleteSuggestions('Березнегувате', 'novaposhta');
    const kirovohradItem = suggestions.find(s => s.subtitle && s.subtitle.includes('Кіровоградська'));
    assert(kirovohradItem, 'Знайдено елемент Кіровоградської обл.');

    const searchInput = mockElements.searchInput;
    assert(searchInput, 'searchInput існує');

    // Симулюємо вибір елемента автокомпліту
    window.selectAutocompleteItem(kirovohradItem);

    assert.strictEqual(
      searchInput.value,
      'Березнегувате Компаніївський Кіровоградська',
      `Очікувалось "Березнегувате Компаніївський Кіровоградська", отримано "${searchInput.value}"`
    );
    assert(!searchInput.value.includes('БерезнегуватеКомпаніївський'), 'Слова не повинні бути склеєні без пробілів');
  });

  // 3. Сценарій: стерти бекспейсом до "Березнегувате" -> перевірка скидання selectedSettlement та повторного відкриття підказок
  await runTest('Сценарій: Backspace до "Березнегувате" скидає selectedSettlement та знову відкриває підказки', async () => {
    const searchInput = mockElements.searchInput;
    const autocompleteDropdown = mockElements.autocompleteDropdown;

    // Крок 1: вибрати варіант Кіровоградської обл.
    const suggestions = window.SmartSearchEngine.getAutocompleteSuggestions('Березнегувате', 'novaposhta');
    const kirovohradItem = suggestions.find(s => s.subtitle && s.subtitle.includes('Кіровоградська'));
    window.selectAutocompleteItem(kirovohradItem);

    assert.strictEqual(searchInput.value, 'Березнегувате Компаніївський Кіровоградська');
    assert(autocompleteDropdown.classList.contains('hidden'), 'Після вибору дропдаун ховається');

    // Крок 2: стираємо бекспейсом до "Березнегувате"
    searchInput.value = 'Березнегувате';
    searchInput.dispatchEvent({ type: 'input' });

    // Очікуємо завершення дебаунсу автокомпліту (80ms)
    await new Promise(r => setTimeout(r, 120));

    // Перевірка 1: selectedSettlement має бути скинуто
    const appState = window._appStateForTesting || null;
    assert(!appState || appState.selectedSettlement === null, 'selectedSettlement скинуто на null');

    // Перевірка 2: відкриття автокомпліту
    assert(!autocompleteDropdown.classList.contains('hidden'), 'Дропдаун автокомпліту має знову ВІДКРИТИСЯ');
    assert(autocompleteDropdown.children.length >= 2, 'У дропдауні знову мають бути варіанти Миколаївської та Кіровоградської обл.');

    const renderedHtml = autocompleteDropdown.children.map(c => c.innerHTML).join(' ');
    assert(renderedHtml.includes('Кіровоградська') && renderedHtml.includes('Миколаївська'), 'Дропдаун містить обидві області');
  });

  // 4. Пошук по місту Березнегувате без прив'язки знаходить відділення
  await runTest('Пошук "Березнегувате" знаходить відділення Миколаївської обл. без помилки "відділень не знайдено"', async () => {
    const searchInput = mockElements.searchInput;
    searchInput.value = 'Березнегувате';
    searchInput.dispatchEvent({ type: 'input' });

    await window.executeSearch('Березнегувате', false, true);

    const resultsList = mockElements.resultsList;
    assert(resultsList, 'resultsList існує');
    assert(!resultsList.innerHTML.includes('відділень не знайдено'), 'Не повинно бути "відділень не знайдено"');
    const appState = window._appStateForTesting;
    assert(appState && appState.currentResults && appState.currentResults.length >= 3, 'Знайдено відділення Березнегуватого');
  });

  console.log('===============================================================');
  console.log(`📊 РЕЗУЛЬТАТ: ${passedTests} / ${totalTests} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
  console.log('===============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
  process.exit(0);
}

runAll();
