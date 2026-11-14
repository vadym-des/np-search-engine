/**
 * scripts/build_branches_fast.js
 * Збирає data/branches.fast.js (JSON.parse-версія) з data/branches.js.
 * Дані ідентичні; змінюється лише спосіб завантаження в браузері (швидший старт, ~-20% розміру).
 * data/branches.js залишається ДЖЕРЕЛОМ ПРАВДИ (його читають тести та скрипти синхронізації).
 * Запуск: node scripts/build_branches_fast.js  (після кожного оновлення branches.js)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'data', 'branches.js');
const out = path.join(__dirname, '..', 'data', 'branches.fast.js');

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(src, 'utf8'), sandbox);
const data = sandbox.window.BRANCHES_DATA;
if (!data || !Array.isArray(data.novaposhta)) throw new Error('BRANCHES_DATA не знайдено в branches.js');

const json = JSON.stringify(data);
const body = '// АВТОГЕНЕРОВАНО scripts/build_branches_fast.js з data/branches.js — не редагувати вручну\n' +
  "window.BRANCHES_DATA = JSON.parse('" + json.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "');\n";
fs.writeFileSync(out, body);
console.log(`OK: ${out} (${(body.length / 1e6).toFixed(1)} MB, NP=${data.novaposhta.length}, UP=${(data.ukrposhta || []).length})`);
