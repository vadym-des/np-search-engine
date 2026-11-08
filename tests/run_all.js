/**
 * ЄДИНИЙ ТЕСТОВИЙ РАННЕР ПРОЄКТУ
 * Запускає всі автоматизовані сьюти послідовно та зупиняється при першій помилці.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const testFiles = fs.readdirSync(__dirname)
  .filter(f => f.startsWith('test_') && f.endsWith('.js'))
  .sort();

console.log('===============================================================');
console.log(`🚀 ЗАПУСК ВСІХ ТЕСТІВ ПРОЄКТУ (${testFiles.length} тестових модулів)`);
console.log('===============================================================\n');

let totalPassed = 0;
const startTime = Date.now();

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  console.log(`\n▶ [RUNNING]: ${file} ...`);
  const res = spawnSync('node', [filePath], { stdio: 'inherit', env: process.env });
  if (res.status !== 0) {
    console.error(`\n❌ [FAILED]: Тестовий сьют ${file} завершився з помилкою (код: ${res.status})`);
    process.exit(1);
  }
  totalPassed++;
  console.log(`✓ [PASSED]: ${file}`);
}

const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
console.log('\n===============================================================');
console.log(`🎉 ВСІ ${totalPassed} / ${testFiles.length} ТЕСТОВИХ МОДУЛІВ ПРОЙДЕНО УСПІШНО ЗА ${elapsedSec}s!`);
console.log('===============================================================');
