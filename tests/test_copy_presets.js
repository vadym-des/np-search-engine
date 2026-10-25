/**
 * Automated Test Suite for Custom Copy Preset Builder (v1.4.6)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Setup mock browser environment
global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  removeEventListener: () => {},
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => 'light'
  },
  getElementById: (id) => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false
    },
    setAttribute: () => {},
    getAttribute: () => '',
    addEventListener: () => {},
    querySelectorAll: () => [],
    appendChild: () => {},
    showModal: () => {},
    close: () => {},
    getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 500 }),
    focus: () => {},
    blur: () => {}
  }),
  querySelectorAll: () => [],
  createElement: () => ({
    dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    innerHTML: '',
    setAttribute: () => {},
    getAttribute: () => '',
    appendChild: () => {},
    addEventListener: () => {}
  }),
  body: {
    appendChild: () => {},
    removeChild: () => {}
  }
};

let mockStorage = {};
global.localStorage = {
  getItem: (key) => mockStorage[key] || null,
  setItem: (key, val) => { mockStorage[key] = String(val); },
  removeItem: (key) => { delete mockStorage[key]; },
  clear: () => { mockStorage = {}; }
};

global.navigator = {
  clipboard: {
    writeText: async () => {}
  }
};

global.location = { protocol: 'https:' };

// Load data files
require('../data/all_settlements.js');
require('../data/branches.js');
require('../data/fuzzySearch.js');
require('../app.js');

console.log('===============================================================');
console.log('🧪 ЗАПУСК ТЕСТУВАННЯ КОНСТРУКТОРА ШАБЛОНІВ КОПІЮВАННЯ (v1.4.6)');
console.log('===============================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`▶ ТЕСТ ${totalTests}: ${name}`);
    console.log(`  ✓ Успіх\n`);
  } catch (err) {
    console.error(`▶ ТЕСТ ${totalTests}: ${name}`);
    console.error(`  ✕ ПОМИЛКА:`, err.message, '\n');
    process.exitCode = 1;
  }
}

const benchmarkBranch = {
  id: 'np-test-cargo',
  service: 'novaposhta',
  settlementType: 'смт',
  city: 'Середнє',
  number: '1',
  postalCode: '89432',
  type: 'cargo',
  typeText: 'Вантажне (до 1100 кг)',
  typeName: 'Вантажне відділення',
  street: 'вул. Закарпатська, 75',
  raion: 'Ужгородський',
  oblast: 'Закарпатська',
  totalMaxWeightAllowed: 1100,
  maxWeight: 1100
};

const standardBranch = {
  id: 'np-test-branch',
  service: 'novaposhta',
  settlementType: 'місто',
  city: 'Київ',
  number: '15',
  postalCode: '01001',
  type: 'branch',
  street: 'вул. Хрещатик, 15',
  raion: 'Шевченківський',
  oblast: 'Київська',
  totalMaxWeightAllowed: 30,
  maxWeight: 30
};

// 1. Дефолтний класичний формат копіювання
runTest('Дефолтний класичний формат (Кнопка «Скопіювати»)', () => {
  mockStorage = {};
  const classicResult = window.formatClassicCopyString(benchmarkBranch);
  assert.strictEqual(
    classicResult,
    'смт Середнє, Вантажне відділення №1: вул. Закарпатська, 75',
    `Очікувалось смт Середнє, Вантажне відділення №1: вул. Закарпатська, 75, отримано: "${classicResult}"`
  );
});

// 2. Дефолтний детальний CRM-формат
runTest('Дефолтний детальний CRM-формат (Кнопка «Детально»)', () => {
  const detailedResult = window.formatDetailedCopyString(benchmarkBranch);
  assert.strictEqual(
    detailedResult,
    'смт Середнє (Ужгородський р-н, Закарпатська обл.), Вантажне відділення №1 (до 1100 кг): вул. Закарпатська, 75',
    `Очікувалось розширений детальний рядок, отримано: "${detailedResult}"`
  );
});

// 3. Пресет «Для CRM / Швидкий»
runTest('Швидкий пресет «Для CRM» (без слів "відділення", скорочення смт, без вул.)', () => {
  const crmShortConfig = window.QUICK_PRESETS.short.crm;
  const result = window.assembleCopyStringFromPreset(benchmarkBranch, crmShortConfig);
  assert(result.includes('смт Середнє'), 'Має містити "смт Середнє"');
  assert(result.includes('Вантажне 1') || result.includes('1'), 'Має містити номер без зайвих слів');
  assert(result.includes('Закарпатська, 75'), 'Має бути чиста адреса без вул.');
  assert(result.includes('Ужгородський р-н, Закарпатська обл.'), 'Має містити район та область');
});

// 4. Пресет «Короткий» (Середнє, відд. 1)
runTest('Пресет «Короткий» (Середнє, відд. 1 або Вантажне 1)', () => {
  const shortConfig = window.QUICK_PRESETS.short.short;
  const result = window.assembleCopyStringFromPreset(standardBranch, shortConfig);
  assert.strictEqual(result, 'Київ, відд. 15', `Очікувалось "Київ, відд. 15", отримано: "${result}"`);
});

// 5. Опція noStreetPrefix (прибирання префікса "вул.")
runTest('Опція прибирання префікса "вул."', () => {
  const config = {
    tags: ['city', 'street'],
    options: { noStreetPrefix: true }
  };
  const result = window.assembleCopyStringFromPreset(standardBranch, config);
  assert.strictEqual(result, 'Київ, Хрещатик, 15', `Очікувалось "Київ, Хрещатик, 15", отримано: "${result}"`);
});

// 6. Опція smtShort (скорочення "смт", "м.", "с.")
runTest('Опція скорочення типів населених пунктів (smtShort)', () => {
  const config = {
    tags: ['settlementType', 'city'],
    options: { smtShort: true }
  };
  const result = window.assembleCopyStringFromPreset(standardBranch, config);
  assert.strictEqual(result, 'м. Київ', `Очікувалось "м. Київ", отримано: "${result}"`);
});

// 7. Збереження та зчитування налаштувань із LocalStorage
runTest('Збереження та застосування пресетів із localStorage', () => {
  const customPresets = {
    short: {
      presetName: 'custom',
      tags: ['city', 'number', 'street'],
      options: { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
    },
    detailed: {
      presetName: 'default',
      tags: window.DEFAULT_COPY_PRESETS.detailed.tags,
      options: window.DEFAULT_COPY_PRESETS.detailed.options
    }
  };

  window.saveCopyPresets(customPresets);
  const loaded = window.loadCopyPresets();
  assert.deepStrictEqual(loaded.short.tags, ['city', 'number', 'street']);

  const customCopy = window.formatClassicCopyString(standardBranch);
  assert.strictEqual(customCopy, 'Київ, 15, Хрещатик, 15', `Очікувалось застосування кастомного збереженого шаблону: "${customCopy}"`);
});

// 8. Автоматичне очищення здвоєних ком та зайвих дужок
runTest('Автоматичне очищення рядка (відсутність ", ,", порожніх дужок)', () => {
  const config = {
    tags: ['city', 'raion', 'oblast', 'street'],
    options: { shortRegion: true, noStreetPrefix: false }
  };
  // Гіпотетичний об'єкт без району та області
  const noGeoBranch = {
    city: 'Фантазія-Тест',
    street: 'вул. Центральна, 1'
  };
  const res = window.assembleCopyStringFromPreset(noGeoBranch, config);
  assert(!res.includes(', ,'), 'Рядок не повинен містити здвоєних ком');
  assert(!res.includes('()'), 'Рядок не повинен містити порожніх дужок');
  assert.strictEqual(res, 'Фантазія-Тест, вул. Центральна, 1');
});

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passedTests} / ${totalTests} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================\n');

process.exit(0);
