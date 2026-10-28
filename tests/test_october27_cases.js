/**
 * ТЕСТОВИЙ НАБІР ДЛЯ 6 РЕАЛЬНИХ АРТЕФАКТІВ ЗА 27 ЖОВТНЯ 2026
 * Скріншоти користувача з папки Scre-Google Chrome (порівняння з Google Search)
 */

global.window = global;
global.document = { querySelector: () => null };

const fs = require('fs');
eval(fs.readFileSync('data/branches.js', 'utf8'));
eval(fs.readFileSync('data/all_settlements.js', 'utf8'));
eval(fs.readFileSync('data/fuzzySearch.js', 'utf8'));

window.SmartSearchEngine.setAllSettlementsData(window.ALL_SETTLEMENTS_DATA);
const pool = window.BRANCHES_DATA.novaposhta;
window.SmartSearchEngine.buildBranchIndex(pool);

const testCases = [
  {
    id: 1,
    q: 'нова пошта -- троїцбке сафонове 1',
    expectedCity: 'Троїцько-Сафонове',
    expectedNum: '1',
    expectedOblast: 'Миколаївська',
    desc: 'Кейс 1: Оддруківка "б" у дефісному смт (троїцбке сафонове 1 -> Троїцько-Сафонове №1)'
  },
  {
    id: 2,
    q: 'нова пошта --ведликий березний 1 загородян 65',
    expectedCity: 'Великий Березний',
    expectedNum: '1',
    expectedStreet: 'Загородня',
    desc: 'Кейс 2: Оддруківка "ведликий" у смт Великий Березний + вулиця Загородня 65'
  },
  {
    id: 3,
    q: 'нова пошта - світопетрвське 2',
    expectedCity: 'Святопетрівське',
    expectedNum: '2',
    desc: 'Кейс 3: Подвійна оддруківка села поза топ-185 (світопетрвське -> Святопетрівське №2)'
  },
  {
    id: 4,
    q: 'нова пошта - віниціька могилів поділ 1 полатвська 24ї=',
    expectedCity: 'Могилів-Подільський',
    expectedNum: '1',
    expectedStreet: 'Полтавська',
    desc: 'Кейс 4: Оддруківка області (віниціька), скорочення міста (могилів поділ), оддруківка вулиці (полатвська) та сміття будинку (24ї=)'
  },
  {
    id: 5,
    q: 'нова пошта - новоселівка 1 лісова 1',
    expectedCity: 'Новоселівка',
    expectedNum: '1',
    expectedRaion: 'Самарівський',
    desc: 'Кейс 5: Дезамбігуація тезки села Новоселівка за синонімом вулиці (лісова -> Лісна, 1в)'
  },
  {
    id: 6,
    q: 'нова пошта - нововволинськ 4',
    expectedCity: 'Нововолинськ',
    expectedNum: '4',
    desc: 'Кейс 6: Подвоєння літери "вв" у місті Нововолинськ (нововволинськ 4 -> Нововолинськ №4)'
  }
];

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ 6 РЕАЛЬНИХ КЕЙСІВ ЗА 27 ЖОВТНЯ 2026 (GOOGLE EQUIVALENTS)');
console.log('===============================================================\n');

let passed = 0;
let failed = 0;

testCases.forEach((tc) => {
  console.log(`▶ ТЕСТ ${tc.id}: ${tc.desc}`);
  console.log(`  Запит: "${tc.q}"`);

  const t0 = performance.now();
  const results = window.SmartSearchEngine.searchBranches(tc.q, pool, 5);
  const elapsed = (performance.now() - t0).toFixed(2);

  const top = results[0];
  let ok = true;
  let reason = '';

  if (!top) {
    ok = false;
    reason = 'Результатів не знайдено (порожній масив)';
  } else {
    if (tc.expectedCity && !top.city.toLowerCase().includes(tc.expectedCity.toLowerCase())) {
      ok = false;
      reason = `Місто не збігається: очікувалось "${tc.expectedCity}", отримано "${top.city}"`;
    }
    if (tc.expectedNum && String(top.number) !== String(tc.expectedNum)) {
      ok = false;
      reason = `Номер відділення не збігається: очікувалось №${tc.expectedNum}, отримано №${top.number}`;
    }
    if (tc.expectedOblast && (!top.oblast || !top.oblast.toLowerCase().includes(tc.expectedOblast.toLowerCase()))) {
      ok = false;
      reason = `Область не збігається: очікувалось "${tc.expectedOblast}", отримано "${top.oblast}"`;
    }
    if (tc.expectedRaion && (!top.raion || !top.raion.toLowerCase().includes(tc.expectedRaion.toLowerCase()))) {
      ok = false;
      reason = `Район не збігається: очікувалось "${tc.expectedRaion}", отримано "${top.raion}"`;
    }
    if (tc.expectedStreet) {
      const topStr = (top.street || top.name || '').toLowerCase();
      if (!topStr.includes(tc.expectedStreet.toLowerCase().slice(0, 5))) {
        ok = false;
        reason = `Вулиця не збігається: очікувалась "${tc.expectedStreet}", отримано "${top.street || top.name}"`;
      }
    }
  }

  if (ok) {
    passed++;
    console.log(`  ✓ Успіх (${elapsed}ms): знайдено "${top.city} #${top.number}" (${top.street || top.name})\n`);
  } else {
    failed++;
    console.log(`  ✗ Провал (${elapsed}ms): ${reason}`);
    if (top) {
      console.log(`    Фактичний результат: "${top.city} (${top.raion}, ${top.oblast}) #${top.number} ${top.street || top.name}"\n`);
    } else {
      console.log('    Фактичний результат: нема результатів\n');
    }
  }
});

console.log('===============================================================');
console.log(`📊 РЕЗУЛЬТАТ: ${passed} / ${testCases.length} ТЕСТІВ ПРОЙДЕНО УСПІШНО!`);
console.log('===============================================================');

if (failed > 0) {
  process.exitCode = 1;
}
