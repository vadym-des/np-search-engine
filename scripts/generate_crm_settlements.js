/**
 * scripts/generate_crm_settlements.js
 * 
 * Генерує нормалізований довідник відповідностей назв населених пунктів для LP-CRM
 * на основі офіційного реєстру відділень Нової Пошти (data/all_warehouses.json).
 * 
 * Створює:
 * - data/crm_settlements.json
 * - data/crm_settlements.js
 */

const fs = require('fs');
const path = require('path');

const whPath = path.join(__dirname, '..', 'data', 'all_warehouses.json');
if (!fs.existsSync(whPath)) {
  console.error('Помилка: data/all_warehouses.json не знайдено!');
  process.exit(1);
}

const warehouses = JSON.parse(fs.readFileSync(whPath, 'utf8'));
const crmMap = {};
const oblastCityCount = {};

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

const jsonOut = path.join(__dirname, '..', 'data', 'crm_settlements.json');
const jsOut = path.join(__dirname, '..', 'data', 'crm_settlements.js');

fs.writeFileSync(jsonOut, JSON.stringify(crmMap, null, 2), 'utf8');
fs.writeFileSync(jsOut, `// LP-CRM & Nova Poshta Official City Disambiguation Registry\nwindow.CRM_SETTLEMENTS_DATA = ${JSON.stringify(crmMap)};\n`, 'utf8');

console.log(`✓ Згенеровано довідник CRM-населених пунктів:`);
console.log(`  - Записів у довіднику: ${Object.keys(crmMap).length} (з них однозначних скорочень: ${shortcutsAdded})`);
console.log(`  - Файли збережено: data/crm_settlements.json та data/crm_settlements.js`);
