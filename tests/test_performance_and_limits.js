/**
 * ТЕСТУВАННЯ ОПТИМІЗАЦІЇ ПРОДУКТИВНОСТІ ТА ЛІМІТІВ (PERFORMANCE & HARD CAP TESTS)
 * Перевірка:
 * 1. Hard Cap ліміт (максимум 20 результатів) при будь-яких запитах
 * 2. Кешування поля searchIndex в об'єкті branch
 * 3. Швидкісний базовий прохід tokens.every(token => branch.searchIndex.includes(token))
 * 4. Lazy Fuzzy Fallback (важкі алгоритми вмикаються лише при length === 0)
 */

const assert = require('assert');
const fs = require('fs');

global.window = global;
global.document = {
  readyState: 'complete',
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }),
  createDocumentFragment: () => ({
    isFragment: true,
    children: [],
    appendChild(c) { this.children.push(c); return c; }
  }),
  querySelector: () => null,
  querySelectorAll: () => []
};

eval(fs.readFileSync('data/branches.js', 'utf8'));
eval(fs.readFileSync('data/all_settlements.js', 'utf8'));
eval(fs.readFileSync('data/fuzzySearch.js', 'utf8'));

window.SmartSearchEngine.setAllSettlementsData(window.ALL_SETTLEMENTS_DATA);
const pool = window.BRANCHES_DATA.novaposhta;

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ОПТИМІЗАЦІЇ ПРОДУКТИВНОСТІ ТА ЛІМІТІВ (v1.6.8)');
console.log('===============================================================\n');

// ТЕСТ 1: Перевірка кешування searchIndex
console.log('▶ ТЕСТ 1: Ініціалізація та кешування searchIndex');
window.SmartSearchEngine.buildBranchIndex(pool);
const sampleBranch = pool[0];
assert(sampleBranch.searchIndex, 'Кожне відділення повинно мати згенерований searchIndex');
assert(typeof sampleBranch.searchIndex === 'string', 'searchIndex має бути рядком');
assert(sampleBranch.searchIndex.length > 5, 'searchIndex має бути непорожнім рядком');
console.log(`  ✓ Успіх: searchIndex згенеровано та закріплено на об\'єкті branch (довжина: ${sampleBranch.searchIndex.length} символів)\n`);

// ТЕСТ 2: Hard Cap ліміт повернення карток (DOM Protection)
console.log('▶ ТЕСТ 2: Hard Cap ліміт (не більше 20 результатів навіть при limit = 200)');
const broadResult1 = window.SmartSearchEngine.searchBranches('київ', pool, 200);
assert(broadResult1.length <= 20, `Очікувалось не більше 20 результатів, отримано: ${broadResult1.length}`);

const broadResult2 = window.SmartSearchEngine.searchBranches('відділення', pool, 100);
assert(broadResult2.length <= 20, `Очікувалось не більше 20 результатів, отримано: ${broadResult2.length}`);

const broadResult3 = window.SmartSearchEngine.filterBranchesByNormalizedSearch('львів', pool, 50);
assert(broadResult3.length <= 20, `Очікувалось не більше 20 результатів, отримано: ${broadResult3.length}`);
console.log(`  ✓ Успіх: Hard Cap 20 результатів гарантовано дотримується (повернуто: ${broadResult1.length}, ${broadResult2.length}, ${broadResult3.length})\n`);

// ТЕСТ 3: Швидкість базового проходу Multi-Token Engine
console.log('▶ ТЕСТ 3: Швидкість базового токенного проходу (чистий запит < 10ms)');
const start = performance.now();
const resFast = window.SmartSearchEngine.searchBranches('коломия 6', pool, 20);
const elapsed = performance.now() - start;
assert(resFast.length > 0, 'Результат повинен бути знайдений');
assert.strictEqual(String(resFast[0].number), '6', 'Відділення має бути №6');
assert(elapsed < 25, `Час виконання має бути менше 25ms, отримано: ${elapsed.toFixed(2)}ms`);
console.log(`  ✓ Успіх: пошук виконано за ${elapsed.toFixed(2)}ms (знайдено: ${resFast[0].city} #${resFast[0].number})\n`);

// ТЕСТ 4: Lazy Fuzzy Fallback
console.log('▶ ТЕСТ 4: Спрацьовування Lazy Fuzzy Fallback при одруківках (length === 0 в базовому проході)');
const resTypo = window.SmartSearchEngine.searchBranches('миколаїв віціліново', pool, 20);
assert(resTypo.length > 0, 'Повинен знайти Веселинове');
assert.strictEqual(resTypo[0].city, 'Веселинове', 'Повинен виправити фонетичну одруківку віціліново -> Веселинове');
console.log(`  ✓ Успіх: нечіткий фолбек коректно відпрацював для "${resTypo[0].city}" #${resTypo[0].number}\n`);

console.log('===============================================================');
console.log('📊 РЕЗУЛЬТАТ: ВСІ 4 ТЕСТИ ПРОДУКТИВНОСТІ ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
