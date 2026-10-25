/**
 * ТЕСТОВИЙ НАБІР ДЛЯ ВЕРИФІКАЦІЇ GOOGLE-LIKE ПОШУКУ
 * Перевірка 15 проблемних кейсів зі скріншотів користувача (Google vs Local search)
 */

global.window = global;
global.document = { querySelector: () => null };

const fs = require('fs');
eval(fs.readFileSync('data/branches.js', 'utf8'));
eval(fs.readFileSync('data/all_settlements.js', 'utf8'));
eval(fs.readFileSync('data/fuzzySearch.js', 'utf8'));

window.SmartSearchEngine.setAllSettlementsData(window.ALL_SETTLEMENTS_DATA);

const pool = window.BRANCHES_DATA.novaposhta;

const testCases = [
  { q: 'коломи я 6', expectedCity: 'Коломия', expectedNum: '6', desc: 'Склеювання розірваного міста + номер' },
  { q: 'житомир попільня 2', expectedCity: 'Попільня', expectedNum: '2', desc: 'Пріоритет СМТ над обласним центром + сумісність районів' },
  { q: 'нвоа пошат -- закарпа ужгород велика доб', expectedCity: 'Велика Добронь', desc: 'Префіксна біграма села + пріоритет над райцентром' },
  { q: 'запоріжжя поштомат михайлова 46', expectedCity: 'Запоріжжя', expectedStreet: 'Михайлова', desc: 'Поштомат за номером будинку на вулиці' },
  { q: 'кри ріг 19', expectedCity: 'Кривий Ріг', expectedNum: '19', desc: 'Біграма скорочення міста (Кривий Ріг)' },
  { q: '17 кри ріг', expectedCity: 'Кривий Ріг', expectedNum: '17', desc: 'Зворотний порядок номер + скорочення міста' },
  { q: 'кри ріг 26', expectedCity: 'Кривий Ріг', expectedNum: '26', desc: 'Скорочення міста + номер' },
  { q: 'нвоа пошат -- рівнеська степан город 1', expectedCity: 'Степангород', expectedNum: '1', desc: 'Склеювання розірваної назви села (Степангород)' },
  { q: 'нвоа пошат -- брацке 1 миколаїв', expectedCity: 'Братське', expectedNum: '1', desc: 'Фонетична заміна брацке -> Братське + дезамбігуація' },
  { q: 'нвоа пошат -- нихаївка 1', expectedCity: 'Нехаївка', expectedNum: '1', desc: 'Фонетичне чергування нихаївка -> Нехаївка' },
  { q: 'нова пошта -- спацьке 1', expectedCity: 'Спаське', expectedNum: '1', desc: 'Фонетичне чергування спацьке -> Спаське' },
  { q: 'нова пошта --- бойовик одеська 1', expectedCity: 'Буялик', expectedNum: '1', desc: 'Сленговий аліас бойовик -> Буялик (Одеська обл.)' },
  { q: 'нова пошта --- ананїв соборна', expectedCity: 'Ананьїв', expectedStreet: 'Соборна', desc: 'Пошук за вулицею без номера відділення' },
  { q: 'нова пошта --- ківерці центральна', expectedCity: 'Ківерці', expectedNum: '1', desc: 'Центральне/головне відділення міста' },
  { q: 'нова пошта -- 15 київ', expectedCity: 'Київ', expectedNum: '15', desc: 'Зворотний порядок номер попереду міста' },
  { q: 'житомир озерянка 1', expectedCity: 'Озерянка', expectedNum: '1', expectedStreet: 'Пушкіна', desc: 'Дезамбігуація тезки села Озерянка у Житомирському районі' },
  { q: 'озерянка пушкіна 1', expectedCity: 'Озерянка', expectedNum: '1', expectedStreet: 'Пушкіна', desc: 'Пошук села без вказаної області за назвою вулиці та номером' },
  { q: '  Кам\'янське 1', expectedCity: 'Кам\'янське', expectedNum: '1', desc: 'Пробіли спереду + стандартний апостроф для м. Кам\'янське' },
  { q: '   Камянське 1', expectedCity: 'Кам\'янське', expectedNum: '1', desc: 'Пробіли спереду + без апострофа (Камянське 1)' },
  { q: '  Кам`янське 1', expectedCity: 'Кам\'янське', expectedNum: '1', desc: 'Пробіли спереду + зворотний апостроф/бектек (Кам`янське 1)' },
  { q: '  Кам’янське 1', expectedCity: 'Кам\'янське', expectedNum: '1', desc: 'Пробіли спереду + типографічний апостроф (Кам’янське 1)' },
  { q: '  Камʼянське 1', expectedCity: 'Кам\'янське', expectedNum: '1', desc: 'Пробіли спереду + літерний апостроф (Камʼянське 1)' },
  { q: '   Кам\'янське   ', expectedCity: 'Кам\'янське', desc: 'Пробіли спереду та ззаду для м. Кам\'янське' }
];

console.log('===============================================================');
console.log('🧪 ПЕРЕВІРКА 23 СКРІНШОТ-КЕЙСІВ (GOOGLE-LIKE SEARCH)');
console.log('===============================================================\n');

let passed = 0;
for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const res = window.SmartSearchEngine.searchBranches(tc.q, pool, 3);
  const top = res[0];
  const okCity = top && top.city && (!tc.expectedCity || top.city.toLowerCase().includes(tc.expectedCity.toLowerCase()));
  const okNum = !tc.expectedNum || (top && String(top.number) === String(tc.expectedNum));
  const okStreet = !tc.expectedStreet || (top && top.street && top.street.toLowerCase().includes(tc.expectedStreet.toLowerCase()));
  const ok = okCity && okNum && okStreet;

  if (ok) {
    passed++;
    console.log(`▶ ТЕСТ ${i + 1}: ${tc.desc}`);
    console.log(`  ✓ Успіх: "${tc.q}" -> ${top.city} #${top.number} (${top.street || top.name})\n`);
  } else {
    console.error(`▶ ТЕСТ ${i + 1}: ${tc.desc}`);
    console.error(`  ✗ Провал: "${tc.q}" -> Отримано: ${top ? top.city + ' #' + top.number : 'НЕ ЗНАЙДЕНО'}\n`);
  }
}

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passed} / ${testCases.length} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

if (passed !== testCases.length) {
  process.exit(1);
}
