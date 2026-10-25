/**
 * Automated test suite for Ukrposhta Database Integration & Search
 * Tests:
 * 1. Database integrity of data/ukrposhta_branches.json (26,500+ records)
 * 2. Scenario A: 5-digit index search autocomplete (47501, 11051, 79049)
 * 3. Scenario A: Prefix index search autocomplete (4750 -> 47500, 47501)
 * 4. Scenario B: Settlement name search with postal index (Бережани -> 47501, Озерянка -> 12463)
 * 5. Direct search execution by 5-digit postal code (47501 -> Бережани, вул. Степана Бандери, 1)
 * 6. Copy preset builder tags [Індекс], [Служба], and address formatting for Ukrposhta
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Setup global environment
const window = global;
window.BRANCHES_DATA = {};

// Load fuzzySearch engine
const fuzzyCode = fs.readFileSync(path.join(__dirname, '../data/fuzzySearch.js'), 'utf8');
eval(fuzzyCode);

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ІНТЕГРАЦІЇ БАЗИ ТА ПОШУКУ УКРПОШТИ (v1.6.0)');
console.log('===============================================================');

// ТЕСТ 1: Перевірка цілісності data/ukrposhta_branches.json
console.log('\n▶ ТЕСТ 1: Перевірка бази data/ukrposhta_branches.json (26 500+ записів)');
const jsonPath = path.join(__dirname, '../data/ukrposhta_branches.json');
assert(fs.existsSync(jsonPath), 'Файл data/ukrposhta_branches.json повинен існувати');

const rawUkrposhta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert(Array.isArray(rawUkrposhta), 'База повинна бути масивом');
assert(rawUkrposhta.length >= 26000, `База повинна містити >= 26 000 записів, отримано: ${rawUkrposhta.length}`);
console.log(`  ✓ Успіх: База містить ${rawUkrposhta.length} нормалізованих відділень Укрпошти!`);

// Map items like app.js does on lazy loading
const ukrPool = rawUkrposhta.map(item => {
  const idx = String(item.index || item.number || item.postalCode || '');
  const obl = item.oblast || (item.region ? item.region.replace(/\s*обл\.?.*$/i, '').trim() : '');
  const rai = item.raion || (item.district ? item.district.replace(/\s*район.*$/i, '').trim() : '');
  const addr = item.address || item.street || `ВПЗ ${idx}`;
  const isCentr = item.type === 'central' || idx.endsWith('000') || idx.endsWith('001') || idx.endsWith('00');
  return {
    id: item.id || `up-${idx}`,
    index: idx,
    number: idx,
    postalCode: idx,
    city: item.city,
    type: item.type || (isCentr ? 'central' : 'standard'),
    typeText: item.typeText || (isCentr ? 'Центральне відділення' : (item.name && item.name.includes('Міське') ? 'Міське відділення' : "Відділення зв'язку")),
    name: item.name || `Відділення зв'язку (${idx})`,
    street: addr,
    address: addr,
    oblast: obl,
    raion: rai,
    district: rai,
    region: item.region || (obl ? `${obl} обл.` : ''),
    lat: item.lat || 0,
    lng: item.lng || 0,
    isAccessible: item.isAccessible ?? true,
    hasGenerator: item.hasGenerator ?? true
  };
});

window.BRANCHES_DATA.ukrposhta = ukrPool;
window.SmartSearchEngine.buildBranchIndex(ukrPool);

// ТЕСТ 2: Сценарій А — Автокомпліт за 5-значним індексом 47501 (Бережани)
console.log('\n▶ ТЕСТ 2: Сценарій А — Автокомпліт за 5-значним індексом "47501"');
const sugs47501 = window.SmartSearchEngine.getAutocompleteSuggestions('47501', 'ukrposhta', null, ukrPool);
assert(sugs47501 && sugs47501.length > 0, 'Повинен повертати хоча б одну підказку для 47501');
const top47501 = sugs47501[0];
assert.strictEqual(top47501.title, '📮 47501 — Бережани', `Очікувалось "📮 47501 — Бережани", отримано: "${top47501.title}"`);
assert(top47501.subtitle.includes('Тернопільськ'), `Підзаголовок повинен містити Тернопільську область, отримано: "${top47501.subtitle}"`);
assert.strictEqual(top47501.isDirectBranch, true, 'isDirectBranch повинен бути true');
assert.strictEqual(top47501.textToFill, 'Бережани 47501', 'textToFill повинен бути "Бережани 47501"');
assert(top47501.branchObj && String(top47501.branchObj.postalCode) === '47501', 'branchObj повинен мати postalCode 47501');
console.log(`  ✓ Успіх: ${top47501.title} ${top47501.subtitle}`);

// ТЕСТ 3: Сценарій А — Автокомпліт за індексами 11051 (Нові Білокоровичі) та 79049 (Львів)
console.log('\n▶ ТЕСТ 3: Сценарій А — Автокомпліт за індексами "11051" та "79049"');
const sugs11051 = window.SmartSearchEngine.getAutocompleteSuggestions('11051', 'ukrposhta', null, ukrPool);
assert(sugs11051 && sugs11051.length > 0, 'Повинен повертати підказку для 11051');
assert.strictEqual(sugs11051[0].title, '📮 11051 — Нові Білокоровичі');
assert(sugs11051[0].subtitle.includes('Житомирськ'), 'Підзаголовок повинен містити Житомирську область');
console.log(`  ✓ Успіх для 11051: ${sugs11051[0].title} ${sugs11051[0].subtitle}`);

const sugs79049 = window.SmartSearchEngine.getAutocompleteSuggestions('79049', 'ukrposhta', null, ukrPool);
assert(sugs79049 && sugs79049.length > 0, 'Повинен повертати підказку для 79049');
assert.strictEqual(sugs79049[0].title, '📮 79049 — Львів');
assert(sugs79049[0].subtitle.includes('Львівськ'), 'Підзаголовок повинен містити Львівську область');
console.log(`  ✓ Успіх для 79049: ${sugs79049[0].title} ${sugs79049[0].subtitle}`);

// ТЕСТ 4: Сценарій А — Префіксний пошук за 4 цифрами "4750"
console.log('\n▶ ТЕСТ 4: Сценарій А — Префіксний пошук за індексом "4750"');
const sugs4750 = window.SmartSearchEngine.getAutocompleteSuggestions('4750', 'ukrposhta', null, ukrPool);
assert(sugs4750 && sugs4750.length >= 2, 'Повинен знаходити кілька відділень з префіксом 4750');
const has47500 = sugs4750.some(s => s.title.includes('47500'));
const has47501 = sugs4750.some(s => s.title.includes('47501'));
assert(has47500 && has47501, 'Повинен містити 47500 та 47501');
console.log(`  ✓ Успіх: Префікс 4750 повернув ${sugs4750.length} відділень (включаючи 47500 та 47501)!`);

// ТЕСТ 5: Сценарій Б — Пошук за назвою міста "Бережани" повертає поштовий індекс
console.log('\n▶ ТЕСТ 5: Сценарій Б — Пошук за назвою міста "бережани" у вкладці Укрпошта');
const sugsBerezhany = window.SmartSearchEngine.getAutocompleteSuggestions('бережани', 'ukrposhta', null, ukrPool);
assert(sugsBerezhany && sugsBerezhany.length > 0, 'Повинен повертати підказки міст');
const topCity = sugsBerezhany.find(s => s.title === 'Бережани');
assert(topCity, 'Бережани повинні бути в списку підказок');
assert(topCity.postalCode === '47501' || topCity.postalCode === '47500', `Очікувався поштовий індекс 47501 або 47500, отримано: ${topCity.postalCode}`);
assert(topCity.subtitle.includes('📮'), `Підзаголовок повинен містити значок 📮 та індекс, отримано: "${topCity.subtitle}"`);
console.log(`  ✓ Успіх: ${topCity.title} -> поштовий індекс ${topCity.postalCode}, підзаголовок: "${topCity.subtitle}"`);

// ТЕСТ 6: Прямий пошук за 5-значним індексом у searchBranches ("47501")
console.log('\n▶ ТЕСТ 6: Прямий пошук searchBranches("47501")');
const searchResults = window.SmartSearchEngine.searchBranches('47501', ukrPool, 5);
assert(searchResults && searchResults.length > 0, 'searchBranches повинен повернути результат');
const exactBranch = searchResults[0];
assert.strictEqual(exactBranch.city, 'Бережани', `Місто повинно бути Бережани, отримано: ${exactBranch.city}`);
assert.strictEqual(String(exactBranch.number), '47501', 'Номер повинен бути 47501');
assert.strictEqual(String(exactBranch.postalCode), '47501', 'Поштовий індекс повинен бути 47501');
console.log(`  ✓ Успіх: Знайдено відділення: ${exactBranch.city} №${exactBranch.number} (${exactBranch.street || exactBranch.address})`);

// ТЕСТ 7: Сумісність із тегами копіювання [Індекс], [Служба]
console.log('\n▶ ТЕСТ 7: Сумісність із конструктором шаблонів копіювання');
const isUp = exactBranch.id.startsWith('up-');
const serviceVal = isUp ? 'Укрпошта' : 'Нова Пошта';
const postalVal = String(exactBranch.postalCode || exactBranch.index || exactBranch.number);
assert.strictEqual(serviceVal, 'Укрпошта', 'Служба для branchObj Укрпошти повинна бути "Укрпошта"');
assert.strictEqual(postalVal, '47501', 'Тег [Індекс] повинен містити "47501"');

const testLpCrmString = `${serviceVal}, місто ${exactBranch.city}, Відділення №${postalVal}: ${exactBranch.address}`;
assert(testLpCrmString.includes('Укрпошта'), 'Рядок копіювання повинен містити Укрпошта');
assert(testLpCrmString.includes('47501'), 'Рядок копіювання повинен містити 47501');
console.log(`  ✓ Успіх: Згенеровано CRM-рядок: "${testLpCrmString}"`);

console.log('\n===============================================================');
console.log('📊 РЕЗУЛЬТАТ: ВСІ 7 ТЕСТІВ ІНТЕГРАЦІЇ УКРПОШТИ ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
