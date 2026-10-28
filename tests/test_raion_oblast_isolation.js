/**
 * Тест ізоляції районів та захисту чинних районів України (Адмінреформа 2020)
 */
const assert = require('assert');
global.window = global;
require('../data/fuzzySearch.js');
const engine = global.SmartSearchEngine;

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ОБЛАСНОЇ ІЗОЛЯЦІЇ РАЙОНІВ ТА ЗАХИСТУ ДІЮЧИХ РАЙОНІВ');
console.log('===============================================================\n');

// 1. Тест міста Миколаїв (обласний центр, Миколаївська обл.)
const mykSouth = engine.getHistoricalGeoInfo('Миколаїв', 'Миколаївський', 'Миколаївська');
console.log('1. Миколаїв (Миколаївський, Миколаївська):', mykSouth);
assert.strictEqual(mykSouth.actualRaion, 'Миколаївський', 'Миколаївський район на півдні не повинен ставати Стрийським!');
assert.strictEqual(mykSouth.oldRaion, null, 'Не повинно бути плашки про старий район для діючого Миколаївського району!');
assert.strictEqual(mykSouth.hasHistory, false, 'hasHistory має бути false');

// 2. Тест міста Миколаїв (Стрийський р-н, Львівська обл.)
const mykLviv = engine.getHistoricalGeoInfo('Миколаїв', 'Стрийський', 'Львівська');
console.log('2. Миколаїв (Стрийський, Львівська):', mykLviv);
assert.strictEqual(mykLviv.actualRaion, 'Стрийський', 'Для м. Миколаїв на Львівщині актуальний район має бути Стрийський');
assert.strictEqual(mykLviv.oldRaion, 'Миколаївський', 'Для м. Миколаїв на Львівщині старий район має бути Миколаївський');
assert.strictEqual(mykLviv.hasHistory, true);

// 3. Тест села Миколаїв (Червоноградський / Радехівський, Львівська обл.)
const mykRadekhiv = engine.getHistoricalGeoInfo('Миколаїв', 'Радехівський', 'Львівська');
console.log('3. Миколаїв (Радехівський, Львівська):', mykRadekhiv);
assert.strictEqual(mykRadekhiv.actualRaion, 'Червоноградський');
assert.strictEqual(mykRadekhiv.oldRaion, 'Радехівський');
assert.strictEqual(mykRadekhiv.hasHistory, true);

// 4. Тест м. Городок (Хмельницька обл. vs Львівська обл.)
const horodokKhm = engine.getHistoricalGeoInfo('Городок', 'Городоцький', 'Хмельницька');
console.log('4. Городок (Городоцький, Хмельницька):', horodokKhm);
assert.strictEqual(horodokKhm.actualRaion, 'Хмельницький', 'Городок на Хмельниччині має належати до Хмельницького району!');

const horodokLviv = engine.getHistoricalGeoInfo('Городок', 'Городоцький', 'Львівська');
console.log('5. Городок (Городоцький, Львівська):', horodokLviv);
assert.strictEqual(horodokLviv.actualRaion, 'Львівський', 'Городок на Львівщині має належати до Львівського району!');

// 5. Тест м. Покровськ (Донецька обл.) vs смт Покровське (Дніпропетровська обл.)
const pokrovskDon = engine.getHistoricalGeoInfo('Покровськ', 'Покровський', 'Донецька');
console.log('6. Покровськ (Покровський, Донецька):', pokrovskDon);
assert.strictEqual(pokrovskDon.actualRaion, 'Покровський', 'Покровськ у Донецькій області має залишатися Покровським районом!');
assert.strictEqual(pokrovskDon.oldRaion, null);

const pokrovskeDnipro = engine.getHistoricalGeoInfo('Покровське', 'Покровський', 'Дніпропетровська');
console.log('7. Покровське (Покровський, Дніпропетровська):', pokrovskeDnipro);
assert.strictEqual(pokrovskeDnipro.actualRaion, 'Синельниківський');
assert.strictEqual(pokrovskeDnipro.oldRaion, 'Покровський');

// 6. Тест м. Чернівці (Чернівецька обл.) vs смт Чернівці (Вінницька обл.)
const cvOblast = engine.getHistoricalGeoInfo('Чернівці', 'Чернівецький', 'Чернівецька');
console.log('8. Чернівці (Чернівецький, Чернівецька):', cvOblast);
assert.strictEqual(cvOblast.actualRaion, 'Чернівецький');
assert.strictEqual(cvOblast.oldRaion, null);

const cvVin = engine.getHistoricalGeoInfo('Чернівці', 'Чернівецький', 'Вінницька');
console.log('9. Чернівці (Чернівецький, Вінницька):', cvVin);
assert.strictEqual(cvVin.actualRaion, 'Могилів-подільський');
assert.strictEqual(cvVin.oldRaion, 'Чернівецький');

console.log('\n===============================================================');
console.log('✅ ВСІ 9 ТЕСТІВ ОБЛАСНОЇ ІЗОЛЯЦІЇ РАЙОНІВ ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================\n');
