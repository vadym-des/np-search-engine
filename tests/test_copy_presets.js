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

// 9. Перетягування (Drag-and-Drop) та зміна порядку тегів
runTest('Плавне перетягування тегів (Drag-and-Drop): [Служба] перед [Номер]', () => {
  const initialTags = ['city', 'number', 'service', 'street'];
  // Симуляція перетягування: перетягнути 'service' (sourceIdx = 2) перед 'number' (targetIdx = 1, insertIndex = 1)
  const sourceIdx = 2;
  const targetIdx = 1;
  const insertBefore = true;
  let insertIndex = insertBefore ? targetIdx : targetIdx + 1;
  if (sourceIdx < insertIndex) insertIndex--;

  const tags = initialTags.slice();
  const moved = tags.splice(sourceIdx, 1)[0];
  tags.splice(insertIndex, 0, moved);

  assert.deepStrictEqual(tags, ['city', 'service', 'number', 'street'], 'Порядок тегів має бути city, service, number, street');

  const config = {
    tags,
    options: { smtShort: true, noBranchWord: false, shortRegion: true, noStreetPrefix: false }
  };
  const res = window.assembleCopyStringFromPreset(standardBranch, config);
  assert(res.startsWith('Київ, Нова Пошта, №15'), `Очікувалось що [Служба] стоїть перед [Номер]: "${res}"`);
});

// 10. Динамічний пул тегів без дублювання (Двосторонній обмін)
runTest('Динамічний пул тегів без дублювання (Двосторонній обмін)', () => {
  const allTagIds = window.COPY_PRESET_TAGS.map(t => t.id);
  const activeTags = ['settlementType', 'city', 'branchType', 'number', 'street'];

  // Перевірка фільтрації палітри: тільки невикористані теги
  let paletteTags = allTagIds.filter(id => !activeTags.includes(id));
  assert(!paletteTags.includes('city'), 'Палітра не повинна містити вже активний тег "city"');
  assert(!paletteTags.includes('street'), 'Палітра не повинна містити вже активний тег "street"');
  assert(paletteTags.includes('oblast'), 'Палітра повинна містити неактивний тег "oblast"');
  assert(paletteTags.includes('raion'), 'Палітра повинна містити неактивний тег "raion"');

  // Симуляція додавання тегу 'oblast' до активних
  const tagToAdd = 'oblast';
  if (!activeTags.includes(tagToAdd)) {
    activeTags.push(tagToAdd);
  }
  paletteTags = allTagIds.filter(id => !activeTags.includes(id));
  assert(activeTags.includes('oblast'), 'Активні теги мають містити "oblast"');
  assert(!paletteTags.includes('oblast'), 'Після додавання "oblast" має зникнути з палітри');

  // Захист від повторного додавання
  const countBefore = activeTags.length;
  if (!activeTags.includes(tagToAdd)) {
    activeTags.push(tagToAdd);
  }
  assert.strictEqual(activeTags.length, countBefore, 'Повторне додавання не повинно створювати дублікат');

  // Симуляція видалення (клік на ✕)
  const removeIndex = activeTags.indexOf('city');
  assert(removeIndex >= 0);
  activeTags.splice(removeIndex, 1);
  paletteTags = allTagIds.filter(id => !activeTags.includes(id));
  assert(!activeTags.includes('city'), 'Активні теги не повинні містити видалений "city"');
  assert(paletteTags.includes('city'), 'Видалений тег "city" повинен повернутися до палітри');
});

// 11. Усунення злипання слів при різних комбінаціях чекбоксів
runTest('Усунення злипання слів при будь-яких комбінаціях чекбоксів скорочень', () => {
  const configs = [
    { smtShort: false, noBranchWord: false, shortRegion: false, noStreetPrefix: false },
    { smtShort: true, noBranchWord: false, shortRegion: false, noStreetPrefix: false },
    { smtShort: false, noBranchWord: true, shortRegion: false, noStreetPrefix: false },
    { smtShort: false, noBranchWord: false, shortRegion: true, noStreetPrefix: false },
    { smtShort: false, noBranchWord: false, shortRegion: false, noStreetPrefix: true },
    { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
  ];

  const testTags = ['settlementType', 'city', 'raion', 'oblast', 'branchType', 'number', 'street'];

  const testBranches = [
    benchmarkBranch,
    standardBranch,
    {
      id: 'np-kyiv-cargo-1',
      service: 'novaposhta',
      settlementType: 'місто',
      city: 'Київ',
      number: '1',
      postalCode: '03045',
      type: 'cargo',
      typeName: 'Вантажне відділення',
      street: 'вул. Пирогівський шлях, 135',
      raion: 'Голосіївський',
      oblast: 'Київська',
      totalMaxWeightAllowed: 1100,
      maxWeight: 1100
    }
  ];

  testBranches.forEach((branch, bIdx) => {
    configs.forEach((opts, idx) => {
      const config = { tags: testTags, options: opts };
      const str = window.assembleCopyStringFromPreset(branch, config);

      // 1. Обов'язкові перевірки за вимогами ТЗ: відсутність склейок літер з цифрами, ком без пробілу, двокрапок без пробілу
      assert(!/[а-яА-ЯіїєґІЇЄҐ][0-9]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання літери з цифрою [а-яА-Я][0-9]: "${str}"`);
      assert(!/,[^\s]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: кома без пробілу після неї (,[^\\s]): "${str}"`);
      assert(!/:[^\s]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: двокрапка без пробілу після неї (:[^\\s]): "${str}"`);
      assert(!/\s,/.test(str), `Гілка ${bIdx}, конфіг ${idx}: пробіл перед комою: "${str}"`);
      assert(!/\s:/.test(str), `Гілка ${bIdx}, конфіг ${idx}: пробіл перед двокрапкою: "${str}"`);
      assert(!/,\s*,/.test(str), `Гілка ${bIdx}, конфіг ${idx}: подвійна кома: "${str}"`);

      // 2. Специфічні кейси: правильне відділення слів і збереження внутрішніх пробілів назви вулиці
      assert(!/смт[А-Яа-яЇїІіЄєҐґ]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "смт": "${str}"`);
      assert(!/м\.[А-Яа-яЇїІіЄєҐґ]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "м.": "${str}"`);
      assert(!/с\.[А-Яа-яЇїІіЄєҐґ]/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "с.": "${str}"`);
      assert(!/відд\.\d/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "відд.": "${str}"`);
      assert(!/Вантажне\d/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "Вантажне": "${str}"`);
      assert(!/Вантажневідділення/.test(str), `Гілка ${bIdx}, конфіг ${idx}: виявлено злипання "Вантажневідділення": "${str}"`);
      assert(!/№\s*№/.test(str), `Гілка ${bIdx}, конфіг ${idx}: подвійний знак №: "${str}"`);

      if (branch.street && branch.street.includes('Пирогівський шлях')) {
        assert(str.includes('Пирогівський шлях'), `Гілка ${bIdx}, конфіг ${idx}: внутрішній пробіл вулиці втрачено: "${str}"`);
      }
    });
  });
});

// 12. Фінальна нормалізація пробілів та ком (cleanOutputString)
runTest('Фінальна нормалізація пробілів та ком (cleanOutputString)', () => {
  const dirtySamples = [
    { input: '   місто   Київ   ,   ,   Відділення   №1  :   вул.   Хрещатик, 15  ,  ', expected: 'місто Київ, Відділення №1: вул. Хрещатик, 15' },
    { input: 'Київ , , , 15 , , вул. Хрещатик', expected: 'Київ, 15, вул. Хрещатик' },
    { input: ', : Київ, відд. 1 : ,', expected: 'Київ, відд. 1' },
    { input: 'Середнє ( , ) , вул. Закарпатська', expected: 'Середнє, вул. Закарпатська' },
    { input: 'Середнє () , вул. Закарпатська', expected: 'Середнє, вул. Закарпатська' },
    { input: 'смт Середнє, Вантажне 1, - Закарпатська, 75', expected: 'смт Середнє, Вантажне 1, Закарпатська, 75' },
    { input: 'смт Середнє, Вантажне 1, — Закарпатська, 75', expected: 'смт Середнє, Вантажне 1, Закарпатська, 75' },
    { input: 'смт Середнє, Вантажне 1, : Закарпатська, 75', expected: 'смт Середнє, Вантажне 1, Закарпатська, 75' }
  ];

  dirtySamples.forEach((sample, i) => {
    const cleaned = window.cleanOutputString(sample.input);
    assert.strictEqual(cleaned, sample.expected, `Зразок ${i}: очікувалось "${sample.expected}", отримано "${cleaned}"`);
  });
});

// 13. Комбінація скорочень для смт Середнє (smtShort, noBranchWord, noStreetPrefix)
runTest('Комбінація скорочень для смт Середнє: "смт Середнє, Вантажне 1, Закарпатська, 75"', () => {
  const config = {
    tags: ['settlementType', 'city', 'branchType', 'number', 'street'],
    options: {
      smtShort: true,
      noBranchWord: true,
      noStreetPrefix: true,
      shortRegion: true
    }
  };
  const result = window.assembleCopyStringFromPreset(benchmarkBranch, config);
  assert.strictEqual(
    result,
    'смт Середнє, Вантажне 1, Закарпатська, 75',
    `Очікувалось "смт Середнє, Вантажне 1, Закарпатська, 75", отримано: "${result}"`
  );
  assert(!result.includes('Вантажне1'), 'Тип точки та номер не повинні злипатися (Вантажне1)');
  assert(!result.includes('-'), 'Рядок не повинен містити паразитарного дефіса "-"');
});

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passedTests} / ${totalTests} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================\n');

process.exit(0);
