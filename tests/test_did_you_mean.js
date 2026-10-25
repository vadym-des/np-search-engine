/**
 * ТЕСТУВАННЯ ЛОГІКИ «МОЖЛИВО, ВИ МАЛИ НА УВАЗІ...» (DID-YOU-MEAN LOGIC)
 * Перевірка порогу спрацьовування та точкової заміни токенів
 */

global.window = global;
global.document = { querySelector: () => null };

const fs = require('fs');
eval(fs.readFileSync('data/branches.js', 'utf8'));
eval(fs.readFileSync('data/all_settlements.js', 'utf8'));
eval(fs.readFileSync('data/fuzzySearch.js', 'utf8'));

window.SmartSearchEngine.setAllSettlementsData(window.ALL_SETTLEMENTS_DATA);
const pool = window.BRANCHES_DATA.novaposhta;

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ЛОГІКИ DID-YOU-MEAN ТА ТОЧКОВОЇ ЗАМІНИ');
console.log('===============================================================\n');

function simulateTokenReplacement(currentVal, didYouMeanData, didYouMeanText) {
  let cleaned = currentVal.replace(/^[\s=+\-*•—–~#№\\\/]+/, '');
  let newVal = cleaned;
  const rawToken = didYouMeanData && didYouMeanData.rawToken ? didYouMeanData.rawToken.trim() : null;
  const correctedToken = (didYouMeanData && didYouMeanData.correctedToken) || didYouMeanText;

  if (rawToken && correctedToken) {
    const esc = rawToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(`(^|\\s)${esc}(\\s|$)`, 'iu');
    if (wordRegex.test(newVal)) {
      newVal = newVal.replace(wordRegex, `$1${correctedToken}$2`);
    } else {
      const simpleRegex = new RegExp(esc, 'iu');
      if (simpleRegex.test(newVal)) {
        newVal = newVal.replace(simpleRegex, correctedToken);
      } else {
        newVal = `${correctedToken} ${newVal}`;
      }
    }
  } else if (correctedToken) {
    newVal = correctedToken;
  }
  return newVal.replace(/\s+/g, ' ').trim();
}

let passed = 0;
let total = 0;

function assert(desc, condition, details) {
  total++;
  if (condition) {
    passed++;
    console.log(`▶ ТЕСТ ${total}: ${desc}`);
    console.log(`  ✓ Успіх ${details ? ': ' + details : ''}\n`);
  } else {
    console.error(`▶ ТЕСТ ${total}: ${desc}`);
    console.error(`  ✗ ПРОВАЛ ${details ? ': ' + details : ''}\n`);
  }
}

// ТЕСТ 1: Точний запит з паразитарним префіксом: ~ запоріжжя поштомат михайлова 46
const p1 = window.SmartSearchEngine.parseQuery('~ запоріжжя поштомат михайлова 46');
const r1 = window.SmartSearchEngine.filterBranchesByNormalizedSearch('~ запоріжжя поштомат михайлова 46', pool, 5);
assert(
  '~ запоріжжя поштомат михайлова 46 НЕ повинен показувати didYouMean',
  p1.didYouMeanText === null && r1.length > 0 && String(r1[0].number) === '56140',
  `didYouMeanText=${p1.didYouMeanText}, topResult=${r1[0] ? r1[0].city + ' #' + r1[0].number + ' (' + r1[0].street + ')' : 'none'}`
);

// ТЕСТ 2: Запит з реальною помилкою в місті: ~ запоріжа поштомат михайлова 46
const p2 = window.SmartSearchEngine.parseQuery('~ запоріжа поштомат михайлова 46');
const rep2 = simulateTokenReplacement('~ запоріжа поштомат михайлова 46', p2.didYouMean, p2.didYouMeanText);
assert(
  '~ запоріжа поштомат михайлова 46 повинен запропонувати "Запоріжжя" та точково замінити токен',
  p2.didYouMeanText === 'Запоріжжя' && rep2 === 'Запоріжжя поштомат михайлова 46',
  `didYouMeanText=${p2.didYouMeanText}, replacedQuery="${rep2}"`
);

// ТЕСТ 3: Регістронезалежність (київ 12 та Київ 12)
const p3a = window.SmartSearchEngine.parseQuery('київ 12');
const p3b = window.SmartSearchEngine.parseQuery('Київ 12');
assert(
  'київ 12 та Київ 12 не повинні показувати didYouMean',
  p3a.didYouMeanText === null && p3b.didYouMeanText === null,
  `p3a.didYouMeanText=${p3a.didYouMeanText}, p3b.didYouMeanText=${p3b.didYouMeanText}`
);

// ТЕСТ 4: Запит брацке 1 -> Братське 1
const p4 = window.SmartSearchEngine.parseQuery('брацке 1');
const rep4 = simulateTokenReplacement('брацке 1', p4.didYouMean, p4.didYouMeanText);
assert(
  'брацке 1 повинен запропонувати "Братське" та замінити токен на "Братське 1"',
  p4.didYouMeanText === 'Братське' && rep4 === 'Братське 1',
  `didYouMeanText=${p4.didYouMeanText}, replacedQuery="${rep4}"`
);

// ТЕСТ 5: Запит з паразитарними дефісами: нова пошта -- спацьке 1
const p5 = window.SmartSearchEngine.parseQuery('нова пошта -- спацьке 1');
const rep5 = simulateTokenReplacement('нова пошта -- спацьке 1', p5.didYouMean, p5.didYouMeanText);
assert(
  'нова пошта -- спацьке 1 повинен розпізнати помилку в "спацьке" -> "Спаське"',
  p5.didYouMeanText === 'Спаське' && rep5.includes('Спаське 1'),
  `didYouMeanText=${p5.didYouMeanText}, replacedQuery="${rep5}"`
);

// ТЕСТ 6: Запит львів франка 5 не показує підказку
const p6 = window.SmartSearchEngine.parseQuery('львів франка 5');
assert(
  'львів франка 5 без помилок не показує підказку',
  p6.didYouMeanText === null,
  `didYouMeanText=${p6.didYouMeanText}`
);

// ТЕСТ 7: Запит кеїв 99999 (помилка в місті та неіснуюче відділення)
const p7 = window.SmartSearchEngine.parseQuery('кеїв 99999');
assert(
  'кеїв 99999 з реальною помилкою пропонує "Київ"',
  p7.didYouMeanText === 'Київ',
  `didYouMeanText=${p7.didYouMeanText}`
);

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passed} / ${total} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

if (passed !== total) {
  process.exit(1);
}
