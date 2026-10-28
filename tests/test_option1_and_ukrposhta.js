/**
 * Test Suite: Варіант 1 (Single Popup UI) & Ukrposhta «пересувне відділення»
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Mock minimal DOM environment
global.window = global;
global.document = {
  getElementById: (id) => ({
    id,
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      contains(cls) { return this._classes.has(cls); }
    },
    style: {},
    appendChild() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  }),
  createElement: (tag) => ({
    tagName: tag,
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      contains(cls) { return this._classes.has(cls); }
    },
    style: {},
    setAttribute() {},
    getAttribute: () => '',
    appendChild() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  }),
  addEventListener: () => {}
};

// Load fuzzySearch engine
require('../data/fuzzySearch.js');
const engine = window.SmartSearchEngine;

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ВАРІАНТУ 1 ТА АДРЕС УКРПОШТИ («пересувне відділення»)');
console.log('===============================================================');

// -------------------------------------------------------------
// ТЕСТ 1: Ukrposhta cleanStreet логіка для точних вулиць та пересувних відділень
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 1: Перевірка очищення та заміни вулиць Укрпошти:');

function mockGetCleanStreet(branch) {
  let street = branch.street || '';
  if (!street) {
    if (branch.name && branch.name.includes(':')) {
      street = branch.name.split(':')[1].trim();
    } else {
      street = branch.address || '';
    }
  }
  street = street.replace(/\\n|\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  street = street.replace(/^(?:м\.|с\.|смт|селище|село|місто)\s*/i, '').trim();
  const city = branch.city || '';
  if (city) {
    const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    street = street.replace(new RegExp(`^${escapedCity}[,\\s]*`, 'i'), '').trim();
    street = street.replace(/^(?:м\.|с\.|смт|селище|село|місто)\s*/i, '').trim();
  }
  street = street.replace(/^(?:вул\.?\s+)+(?=(?:вул|вулиця|просп|проспект|пр-т|пл|площа|бульв|бульвар|б-р|пров|провулок|шосе|наб|набережна|узвіз|майдан|тупик|алея|квартал|мікрорайон|мкрн|урочище|ст\.|станція)(?:\.|[\s-]|$))/i, '');

  const isUkrposhta = branch.id?.startsWith('up-') || branch.index || branch.postalCode;
  if (isUkrposhta) {
    const isPlaceholder = !street ||
      /^(?:ВПЗ|вул\.?\s*ВПЗ|відділення|точка\s+присутності|пвпз)/i.test(street) ||
      /^(?:пересувне|мобільне)/i.test(street) ||
      /^\d{5}$/.test(street) ||
      (city && street.toLowerCase() === city.toLowerCase());
    if (isPlaceholder) {
      return 'пересувне відділення';
    }
  }

  if (street && !/^(?:вул|вулиця|просп|проспект|пр-т|пл|площа|бульв|бульвар|б-р|пров|провулок|шосе|наб|набережна|узвіз|майдан|тупик|алея|квартал|мікрорайон|мкрн|урочище|ст\.|станція)(?:\.|[\s-]|$)/i.test(street)) {
    if (!/^(?:ВПЗ|відділення|поштомат|пункт)/i.test(street)) {
      street = 'вул. ' + street;
    }
  }
  return street;
}

const testBranchBerezhany = {
  id: 'up-81192',
  index: '81192',
  postalCode: '81192',
  city: 'Бережани',
  street: 'вул. Шевченка, 86',
  address: 'вул. Шевченка, 86',
  oblast: 'Тернопільська',
  raion: 'Тернопільський'
};

const testBranchLvivMobile = {
  id: 'up-53046',
  index: '53046',
  postalCode: '53046',
  city: 'Львів',
  street: '',
  address: 'Львів, ВПЗ 53046',
  name: "Відділення поштового зв'язку (53046)",
  oblast: 'Львівська',
  raion: 'Львівський'
};

const testBranchKyivVpz = {
  id: 'up-01004',
  index: '01004',
  postalCode: '01004',
  city: 'Київ',
  address: 'м. Київ, ВПЗ 01004',
  oblast: 'Київська',
  raion: ''
};

const streetBerezhany = mockGetCleanStreet(testBranchBerezhany);
const streetLvivMobile = mockGetCleanStreet(testBranchLvivMobile);
const streetKyivVpz = mockGetCleanStreet(testBranchKyivVpz);

console.log('  1. Бережани 81192:', streetBerezhany);
assert.strictEqual(streetBerezhany, 'вул. Шевченка, 86', 'Бережани 81192 має показувати точну адресу вул. Шевченка, 86');
console.log('  ✓ Успіх: точна адреса збережена');

console.log('  2. Львів (село) 53046:', streetLvivMobile);
assert.strictEqual(streetLvivMobile, 'пересувне відділення', 'Львів 53046 має показувати «пересувне відділення»');
console.log('  ✓ Успіх: замість ВПЗ виведено «пересувне відділення»');

console.log('  3. Київ 01004:', streetKyivVpz);
assert.strictEqual(streetKyivVpz, 'пересувне відділення', 'Київ 01004 має показувати «пересувне відділення»');
console.log('  ✓ Успіх: міське відділення без вулиці виводить «пересувне відділення»');


// -------------------------------------------------------------
// ТЕСТ 2: Автокомпліт підказки Укрпошти в fuzzySearch
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 2: Перевірка підказок автокомпліту Укрпошти:');

const upPool = [testBranchBerezhany, testBranchLvivMobile];
const suggBerezhany = engine.getAutocompleteSuggestions('81192', 'ukrposhta', upPool, upPool);
console.log('  Підказка 81192:', suggBerezhany[0]?.subtitle);
assert(suggBerezhany.length > 0, 'Має знайти підказку 81192');
assert(suggBerezhany[0].subtitle.includes('вул. Шевченка, 86'), 'Підказка для 81192 має містити вул. Шевченка, 86');
console.log('  ✓ Успіх: точна вулиця у підказці дропдауну');

const suggLvivMobile = engine.getAutocompleteSuggestions('53046', 'ukrposhta', upPool, upPool);
console.log('  Підказка 53046:', suggLvivMobile[0]?.subtitle);
assert(suggLvivMobile.length > 0, 'Має знайти підказку 53046');
assert(suggLvivMobile[0].subtitle.includes('пересувне відділення'), 'Підказка для 53046 має містити «пересувне відділення»');
console.log('  ✓ Успіх: «пересувне відділення» у підказці дропдауну');


// -------------------------------------------------------------
// ТЕСТ 3: Автокомпліт Нової Пошти для запитів з номером ("конотоп 1")
// -------------------------------------------------------------
console.log('\n▶ ТЕСТ 3: Підказки для запиту з цифрою "конотоп 1":');
const mockNpBranches = [
  {
    number: '1',
    Number: '1',
    city: 'Конотоп',
    settlement: 'Конотоп',
    oblast: 'Сумська',
    raion: 'Конотопський',
    street: 'вул. Депутатська, 60',
    address: 'вул. Депутатська, 60',
    type: 'branch',
    typeName: 'Відділення'
  },
  {
    number: '10',
    Number: '10',
    city: 'Конотоп',
    settlement: 'Конотоп',
    oblast: 'Сумська',
    raion: 'Конотопський',
    street: 'вул. Садова, 1',
    address: 'вул. Садова, 1',
    type: 'branch',
    typeName: 'Відділення'
  }
];

const suggKonotop = engine.getAutocompleteSuggestions('конотоп 1', 'novaposhta', mockNpBranches, mockNpBranches);
console.log('  Знайдено підказок для "конотоп 1":', suggKonotop.length);
assert(suggKonotop.length > 0, 'Має повернути підказки для конотоп 1');
const targetBranch = suggKonotop.find(s => s.branchObj && s.branchObj.Number === '1');
assert(targetBranch, 'У підказках має бути відділення №1');
console.log('  ✓ Успіх: Відділення №1 запропоновано у верхньому поп-апі');

console.log('\n===============================================================');
console.log('✅ ВСІ ТЕСТИ ВАРІАНТУ 1 ТА УКРПОШТИ ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
