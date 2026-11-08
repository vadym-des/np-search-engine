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
  { q: '   Кам\'янське   ', expectedCity: 'Кам\'янське', desc: 'Пробіли спереду та ззаду для м. Кам\'янське' },
  { q: 'Новомосковськ Спаська 9а 1', expectedCity: 'Самар', expectedNum: '5', expectedStreet: 'Спаська, 9а', desc: 'Аліас перейменованого міста (Новомосковськ -> Самар) + вулиця + будинок 9а + номер' },
  { q: 'Новомосковськ Спаська 9а', expectedCity: 'Самар', expectedNum: '5', expectedStreet: 'Спаська, 9а', desc: 'Аліас міста (Новомосковськ -> Самар) + вулиця + будинок 9а без номера відділення' },
  { q: 'Самар Спаська 9а 1', expectedCity: 'Самар', expectedNum: '5', expectedStreet: 'Спаська, 9а', desc: 'Офіційна назва міста Самар + вулиця + будинок 9а + номер' },
  // НОВІ КЕЙСИ ЗІ СКРІНШОТІВ 26.10
  { q: 'кіровогрда олександрівка кропив 1 Шевченка, 19а', expectedCity: 'Олександрівка', expectedNum: '2', expectedStreet: 'Шевченка', desc: 'Пріоритет селища над обласним центром + точна адреса Шевченка 19а' },
  { q: 'стриський район рідники 1', expectedCity: 'Рудники', expectedNum: '1', desc: 'Фонетична одруківка рідники -> Рудники в Стрийському районі' },
  { q: 'миколаїв віціліново', expectedCity: 'Веселинове', expectedNum: '1', desc: 'Фонетична одруківка віціліново -> Веселинове (Миколаївська обл.)' },
  { q: 'кропивнийьцки 22', expectedCity: 'Кропивницький', expectedNum: '22', desc: 'Груба перестановка літер у хвості міста (кропивнийьцки 22)' },
  { q: 'полтав петрівка роменська 1', expectedCity: 'Петрівка-Роменська', expectedNum: '1', desc: 'Складена назва дефісного села через пробіл (Петрівка-Роменська)' },
  { q: 'Снігурівка Баштанський Миколаївська', expectedCity: 'Снігурівка', expectedNum: '1', desc: 'КАТОТТГ сумісність районів: Снігурівка Баштанський р-н' },
  { q: 'Вараш Вараський Рівненська 1', expectedCity: 'Вараш', expectedNum: '1', desc: 'КАТОТТГ сумісність: Вараш Вараський (кол. Кузнецовськ)' },
  { q: 'Петрове Олександрійський Кіровоградська', expectedCity: 'Петрове', expectedNum: '1', desc: 'Нормалізація міст із незакритими дужками в базі: Петрове (Олександрійський)' },
  // НОВІ КЕЙСИ: Пошук за вулицею та містом з одруківкою та номерами (культури 6 слобожнаське 1)
  { q: 'культури 6 слобожнаське 1', expectedCity: 'Слобожанське', expectedStreet: 'Культури', desc: 'Пошук за вулицею Культури, 6 у Слобожанському з одруківкою міста та номером 1' },
  { q: 'культури 6 слобожанське', expectedCity: 'Слобожанське', expectedStreet: 'Культури', desc: 'Пошук за вулицею Культури, 6 у Слобожанському без номера відділення' },
  // НОВІ КЕЙСИ: Пошук міста Малин (Житомирська обл.) без колізії з с. Малин (Рівненська обл.)
  { q: 'малин 1', expectedCity: 'Малин', expectedNum: '1', expectedStreet: 'Грушевського', desc: 'Пошук міста Малин з відділенням №1 (вул. Грушевського, 25)' },
  { q: 'нова пошта - - малин 1', expectedCity: 'Малин', expectedNum: '1', expectedStreet: 'Грушевського', desc: 'Google-style запит "нова пошта - - малин 1"' },
  { q: 'малин', expectedCity: 'Малин', desc: 'Пошук усіх відділень міста Малин (30 відділень)' },
  // НОВІ КЕЙСИ: Префікс обласного центру перед селом (львів павлів 1 -> с. Павлів, Львівська обл., №1)
  { q: 'львів павлів 1', expectedCity: 'Павлів', expectedNum: '1', expectedStreet: 'Юності', desc: 'Префікс облцентру перед селом: "львів павлів 1" -> с. Павлів (Львівська обл., Шептицький р-н) №1' },
  { q: 'нова пошта - - львів павлів 1', expectedCity: 'Павлів', expectedNum: '1', expectedStreet: 'Юності', desc: 'Google-style запит "нова пошта - - львів павлів 1"' },
  { q: 'павлів 1', expectedCity: 'Павлів', expectedNum: '1', expectedStreet: 'Юності', desc: 'Прямий пошук села "павлів 1" -> Відділення №1' },
  // НОВІ КЕЙСИ: Розрізнення міста та села Козятин (Вінницька обл.)
  { q: 'козятин 1', expectedCity: 'Козятин', expectedNum: '1', expectedStreet: 'Винниченка', desc: 'Пошук міста Козятин #1 (вул. Винниченка, 19 а)' },
  { q: 'місто козятин 1', expectedCity: 'Козятин', expectedNum: '1', expectedStreet: 'Винниченка', desc: 'Явний пошук "місто козятин 1" -> №1 вул. Винниченка' },
  { q: 'село козятин 1', expectedCity: 'Козятин', expectedNum: '1', expectedStreet: 'Миру', desc: 'Явний пошук "село козятин 1" -> №1 вул. Миру' },
  // НОВІ КЕЙСИ: Пошук у Високопіллі (Херсонська та Харківська обл.)
  { q: 'високопілля херсонська 1', expectedCity: 'Високопілля', expectedNum: '1', expectedStreet: 'Визволителів', desc: 'Пошук смт Високопілля (Херсонська обл.) №1 (вул. Визволителів, 55)' },
  { q: 'високопілля валківський 1', expectedCity: 'Високопілля', expectedNum: '1', expectedStreet: 'Молодіжна', desc: 'Пошук с. Високопілля (Харківська обл., Валківський р-н) №1 (вул. Молодіжна, 27)' },
  // НОВІ КЕЙСИ: Пошук населеного пункту з номером відділення (Хмельницький 2, Хмельницький Хмельницька 2, Кропивницький 1)
  { q: 'Хмельницький 2', expectedCity: 'Хмельницький', expectedNum: '2', expectedStreet: 'Геологів', desc: 'Пошук м. Хмельницький #2 (вул. Геологів, 1)' },
  { q: 'Хмельницький Хмельницька 2', expectedCity: 'Хмельницький', expectedNum: '2', expectedStreet: 'Геологів', desc: 'Пошук м. Хмельницький Хмельницька 2 -> Відділення №2' },
  { q: 'Кропивницький 1', expectedCity: 'Кропивницький', expectedNum: '1', desc: 'Пошук м. Кропивницький #1 без конфлікту з аліасом області' },
  // НОВІ КЕЙСИ: Пошук села Борщовичі з одруківкою (бощовичі) та префіксом облцентру (нова пошта - -львів бощовичі 1)
  { q: 'нова пошта - -львів бощовичі 1', expectedCity: 'Борщовичі', expectedNum: '1', expectedStreet: 'Бандери', desc: 'Google-запит "нова пошта - -львів бощовичі 1" -> с. Борщовичі №1 (вул. Степана Бандери, 96)' },
  { q: 'львів бощовичі 1', expectedCity: 'Борщовичі', expectedNum: '1', expectedStreet: 'Бандери', desc: 'Префікс облцентру перед селом з одруківкою: "львів бощовичі 1" -> с. Борщовичі №1' },
  { q: 'бощовичі 1', expectedCity: 'Борщовичі', expectedNum: '1', expectedStreet: 'Бандери', desc: 'Прямий пошук села з одруківкою: "бощовичі 1" -> с. Борщовичі №1' },
  // НОВІ КЕЙСИ: Розрізнення міста Дунаївці та смт Дунаївці (Хмельницька обл.)
  { q: 'Дунаївці (смт)', expectedCity: 'Дунаївці', expectedType: 'смт', expectedNum: '1', expectedStreet: 'Травнева', desc: 'Пошук смт Дунаївці -> Відділення №1 (вул. Травнева, 2-А)' },
  { q: 'Дунаївці смт 1', expectedCity: 'Дунаївці', expectedType: 'смт', expectedNum: '1', expectedStreet: 'Травнева', desc: 'Пошук Дунаївці смт 1 -> Відділення №1 (вул. Травнева, 2-А)' },
  { q: 'Дунаївці місто 1', expectedCity: 'Дунаївці', expectedType: 'місто', expectedNum: '1', expectedStreet: 'Могилівська', desc: 'Пошук Дунаївці місто 1 -> Відділення №1 (вул. Могилівська, 24/2)' },
  // НОВІ КЕЙСИ: Пошук та розрізнення Могилів (Дніпропетровська обл.) та Могилів-Подільський (Вінницька обл.)
  { q: 'могилів 2', expectedCity: 'Могилів-Подільський', expectedNum: '2', expectedStreet: 'Покровська', desc: 'Пошук могилів 2 -> м. Могилів-Подільський №2' },
  { q: 'могилів-подільський 1', expectedCity: 'Могилів-Подільський', expectedNum: '1', expectedStreet: 'Полтавська', desc: 'Пошук могилів-подільський 1 -> м. Могилів-Подільський №1' },
  { q: 'могилів дніпропетровська 1', expectedCity: 'Могилів', expectedNum: '1', expectedStreet: 'Панікахи', desc: 'Пошук могилів дніпропетровська 1 -> с. Могилів №1' }
];

console.log('===============================================================');
console.log(`🧪 ПЕРЕВІРКА ${testCases.length} СКРІНШОТ-КЕЙСІВ (GOOGLE-LIKE SEARCH)`);
console.log('===============================================================\n');

let passed = 0;
for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const res = window.SmartSearchEngine.searchBranches(tc.q, pool, 3);
  const top = res[0];
  const okCity = top && top.city && (!tc.expectedCity || top.city.toLowerCase().includes(tc.expectedCity.toLowerCase()));
  const okNum = !tc.expectedNum || (top && String(top.number) === String(tc.expectedNum));
  const okStreet = !tc.expectedStreet || (top && top.street && top.street.toLowerCase().includes(tc.expectedStreet.toLowerCase()));
  const okType = !tc.expectedType || (top && top.settlementType && (top.settlementType.toLowerCase().includes(tc.expectedType.toLowerCase()) || (tc.expectedType === 'смт' && top.settlementType.includes('селище'))));
  const ok = okCity && okNum && okStreet && okType;

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
