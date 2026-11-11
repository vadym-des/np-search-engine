/**
 * scripts/generate_crm_settlements.js
 * 
 * Генерує нормалізований довідник відповідностей назв населених пунктів для LP-CRM
 * на основі офіційного реєстру відділень Нової Пошти (data/all_warehouses.json та data/branches.js).
 * 
 * Створює:
 * - data/crm_settlements.json
 * - data/crm_branch_overrides.json
 * - data/crm_settlements.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const whPath = path.join(__dirname, '..', 'data', 'all_warehouses.json');
if (!fs.existsSync(whPath)) {
  console.error('Помилка: data/all_warehouses.json не знайдено!');
  process.exit(1);
}

const warehouses = JSON.parse(fs.readFileSync(whPath, 'utf8'));
const crmMap = {};
const oblastCityCount = {};

// 1. Побудова карти на рівні населених пунктів
warehouses.forEach(w => {
  const cd = (w.CityDescription || '').trim();
  if (cd.includes('(')) {
    const city = (w.SettlementDescription || cd.replace(/\s*\(.*\)/, '')).trim().toLowerCase();
    const obl = (w.SettlementAreaDescription || '').replace(/\s+область$/i, '').trim().toLowerCase();
    const raion = (w.SettlementRegionsDescription || '').replace(/\s+(р-н|район)$/i, '').trim().toLowerCase();

    if (city && obl) {
      if (raion) {
        const keyFull = `${city}|${obl}|${raion}`;
        if (!crmMap[keyFull]) {
          crmMap[keyFull] = cd;
        }
      }

      const coKey = `${city}|${obl}`;
      if (!oblastCityCount[coKey]) oblastCityCount[coKey] = new Set();
      oblastCityCount[coKey].add(cd);
    }
  }
});

// Додаємо однозначні ярлики (де в межах області є лише один варіант міста з дужками)
let shortcutsAdded = 0;
for (const [coKey, set] of Object.entries(oblastCityCount)) {
  if (set.size === 1) {
    if (!crmMap[coKey]) {
      crmMap[coKey] = Array.from(set)[0];
      shortcutsAdded++;
    }
  }
}

// 2. Побудова карти точних оверрайдів для конкретних відділень (Branch Overrides)
// Забезпечує 100% точність при колізіях сіл-тезок у межах одного району (наприклад, Олександрівка Попсуйко vs Центральна)
const branchOverrides = {};
const branchesJsPath = path.join(__dirname, '..', 'data', 'branches.js');
if (fs.existsSync(branchesJsPath)) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(branchesJsPath, 'utf8'), sandbox);
  const npBranches = sandbox.window.BRANCHES_DATA ? sandbox.window.BRANCHES_DATA.novaposhta : [];

  const whMap = new Map();
  warehouses.forEach(w => {
    if (w.CityDescription) {
      const city = (w.SettlementDescription || '').trim().toLowerCase();
      const num = String(w.Number || '').trim();
      const lat = w.Latitude ? Number(w.Latitude).toFixed(4) : '';
      const lng = w.Longitude ? Number(w.Longitude).toFixed(4) : '';
      whMap.set(city + '|' + num + '|' + lat + '|' + lng, w.CityDescription);
    }
  });

  for (const b of npBranches) {
    const city = (b.city || '').trim().toLowerCase();
    const num = String(b.number || '').trim();
    const lat = b.lat ? Number(b.lat).toFixed(4) : '';
    const lng = b.lng ? Number(b.lng).toFixed(4) : '';
    const key = city + '|' + num + '|' + lat + '|' + lng;
    const crmDesc = whMap.get(key);
    if (crmDesc && crmDesc.includes('(')) {
      branchOverrides[b.id] = crmDesc;
    }
  }
}

const jsonOut = path.join(__dirname, '..', 'data', 'crm_settlements.json');
const branchJsonOut = path.join(__dirname, '..', 'data', 'crm_branch_overrides.json');
const jsOut = path.join(__dirname, '..', 'data', 'crm_settlements.js');

fs.writeFileSync(jsonOut, JSON.stringify(crmMap, null, 2), 'utf8');
fs.writeFileSync(branchJsonOut, JSON.stringify(branchOverrides, null, 2), 'utf8');

const jsContent = `// LP-CRM & Nova Poshta Official City Disambiguation Registry
window.CRM_SETTLEMENTS_DATA = ${JSON.stringify(crmMap)};
window.CRM_BRANCH_OVERRIDES = ${JSON.stringify(branchOverrides)};
`;
fs.writeFileSync(jsOut, jsContent, 'utf8');

console.log(`✓ Згенеровано довідник CRM-населених пунктів та оверрайдів відділень:`);
console.log(`  - Записів у довіднику населених пунктів: ${Object.keys(crmMap).length} (однозначних скорочень: ${shortcutsAdded})`);
console.log(`  - Точних оверрайдів відділень: ${Object.keys(branchOverrides).length}`);
console.log(`  - Файли збережено: crm_settlements.json, crm_branch_overrides.json та crm_settlements.js`);
