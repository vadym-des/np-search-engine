/**
 * ТЕСТОВИЙ НАБІР ДЛЯ ВЕРИФІКАЦІЇ ПОКРАЩЕНОГО НЕЧІТКОГО ПОШУКУ (GOOGLE-LIKE TYPO TOLERANCE)
 * Перевірка універсального розпізнавання граматичних помилок, одруківок та спотворень назв
 * по всій базі Нової пошти та Укрпошти без деградації точного пошуку.
 */

global.window = global;
global.document = { querySelector: () => null };

const fs = require('fs');
eval(fs.readFileSync('data/branches.js', 'utf8'));
eval(fs.readFileSync('data/all_settlements.js', 'utf8'));
eval(fs.readFileSync('data/fuzzySearch.js', 'utf8'));

window.SmartSearchEngine.setAllSettlementsData(window.ALL_SETTLEMENTS_DATA);

const poolNP = window.BRANCHES_DATA.novaposhta;
const poolUP = window.BRANCHES_DATA.ukrposhta || [];

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ГНУЧКОГО НЕЧІТКОГО ПОШУКУ ЗА СПОТВОРЕНИМИ НАЗВАМИ');
console.log('===============================================================\n');

const testCases = [
  {
    q: 'горанечі 1',
    pool: poolNP,
    expectedCity: 'Гореничі',
    expectedNum: '1',
    forbiddenCity: 'Гора',
    desc: 'Скріншот користувача: одруківка "горанечі 1" -> село Гореничі Відділення №1 (не село Гора)'
  },
  {
    q: 'горанечі',
    pool: poolNP,
    expectedCity: 'Гореничі',
    forbiddenCity: 'Гора',
    desc: 'Пошук міста без номера: "горанечі" -> село Гореничі'
  },
  {
    q: 'ставіще 1',
    pool: poolNP,
    expectedCity: 'Ставище',
    expectedNum: '1',
    desc: 'Фонетична одруківка в голосному: "ставіще 1" -> Ставище №1'
  },
  {
    q: 'песківка 1',
    pool: poolNP,
    expectedCity: 'Пісківка',
    expectedNum: '1',
    desc: 'Фонетична одруківка: "песківка 1" -> Пісківка №1'
  },
  {
    q: 'вешневе 2',
    pool: poolNP,
    expectedCity: 'Вишневе',
    expectedNum: '2',
    desc: 'Помилка ненаголошеного голосного: "вешневе 2" -> Вишневе №2'
  },
  {
    q: 'бояра 1',
    pool: poolNP,
    expectedCity: 'Боярка',
    expectedNum: '1',
    desc: 'Пропуск кінцевого приголосного: "бояра 1" -> Боярка №1'
  },
  {
    q: 'коршелів 47201',
    pool: poolUP,
    expectedCity: 'Коршилів',
    expectedNum: '47201',
    desc: 'Укрпошта: одруківка села "коршелів 47201" -> Коршилів №47201'
  },
  {
    q: 'зборив 47200',
    pool: poolUP,
    expectedCity: 'Зборів',
    expectedNum: '47200',
    desc: 'Укрпошта: фонетична заміна "зборив 47200" -> Зборів №47200'
  },
  {
    q: '18011',
    pool: poolUP,
    expectedCity: 'Черкаси',
    expectedNum: '18011',
    desc: 'Укрпошта: пошук за індексом "18011" -> Черкаси №18011 (бульв. Шевченка, 355)'
  },
  {
    q: 'закарпат тячів грушево 1',
    pool: poolNP,
    expectedCity: 'Грушово',
    expectedNum: '1',
    forbiddenCity: 'Тячів',
    desc: 'Пріоритет села над райцентром при фонетичній одруківці: "закарпат тячів грушево 1" -> с. Грушово №1 (не м. Тячів)'
  }
];

let passed = 0;
for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  console.log(`▶ ТЕСТ ${i + 1}: ${tc.desc}`);
  const results = window.SmartSearchEngine.searchBranches(tc.q, tc.pool, 3);
  const top = results[0];

  const okCity = top && top.city && top.city.toLowerCase().includes(tc.expectedCity.toLowerCase());
  const notForbidden = !tc.forbiddenCity || (top && !top.city.toLowerCase().startsWith(tc.forbiddenCity.toLowerCase()));
  const okNum = !tc.expectedNum || (top && (String(top.number) === String(tc.expectedNum) || String(top.postalCode) === String(tc.expectedNum)));

  if (okCity && notForbidden && okNum) {
    passed++;
    console.log(`  ✓ Успіх: "${tc.q}" -> ${top.city} №${top.number} (${top.street || top.address || ''})`);
  } else {
    console.error(`  ✕ ПОМИЛКА для "${tc.q}":`);
    console.error(`    Очікувалось: ${tc.expectedCity}${tc.expectedNum ? ' №' + tc.expectedNum : ''}`);
    console.error(`    Отримано: ${top ? `${top.city} №${top.number} (${top.street || top.address || ''})` : 'НІЧОГО'}`);
  }
}

// Перевірка did-you-mean для "горанечі 1"
console.log(`▶ ТЕСТ 9: Підказка did-you-mean пропонує "Гореничі" для "горанечі 1"`);
const parsed = window.SmartSearchEngine.parseQuery('горанечі 1');
if (parsed.didYouMeanText === 'Гореничі' && parsed.didYouMean && parsed.didYouMean.rawToken === 'горанечі') {
  passed++;
  console.log(`  ✓ Успіх: didYouMeanText="${parsed.didYouMeanText}"`);
} else {
  console.error(`  ✕ ПОМИЛКА: didYouMeanText="${parsed.didYouMeanText}", rawToken="${parsed.didYouMean ? parsed.didYouMean.rawToken : null}"`);
}

console.log('\n===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passed} / ${testCases.length + 1} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

if (passed !== testCases.length + 1) {
  process.exit(1);
}
