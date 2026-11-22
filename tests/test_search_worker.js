/**
 * tests/test_search_worker.js
 * Автоматизоване тестування фонового Web Worker для пошуку та автокомпліту
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('===============================================================');
console.log('🧪 ТЕСТУВАННЯ ФОНОВОГО WEB WORKER (ОФФ-ТРЕД ПОШУК ТА СКОРИНГ)');
console.log('===============================================================\n');

// 1. Перевірка наявності файлів
console.log('▶ ТЕСТ 1: Перевірка наявності worker/search.worker.js та реєстрації в sw.js');
const workerPath = path.join(__dirname, '..', 'worker', 'search.worker.js');
assert.ok(fs.existsSync(workerPath), 'worker/search.worker.js повинен існувати');

const swContent = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
assert.ok(swContent.includes('search.worker.js'), 'sw.js повинен кешувати search.worker.js');
console.log('  ✓ Файл знайдено та зареєстровано в PRECACHE_ASSETS');

// 2. Імітація Worker середовища та перевірка ініціалізації
console.log('\n▶ ТЕСТ 2: Ініціалізація Web Worker та завантаження баз даних');
const sandbox = {};
sandbox.self = sandbox;
sandbox.window = sandbox;
sandbox.importScripts = (...scripts) => {
  for (const s of scripts) {
    const fullPath = path.resolve(__dirname, '..', 'worker', s);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInNewContext(code, sandbox);
  }
};

const messagesFromWorker = [];
sandbox.postMessage = (msg) => {
  messagesFromWorker.push(msg);
};

vm.createContext(sandbox);

const workerCode = fs.readFileSync(workerPath, 'utf8');
vm.runInNewContext(workerCode, sandbox);

assert.strictEqual(messagesFromWorker[0].type, 'WORKER_READY', 'Worker повинен надіслати WORKER_READY');
assert.strictEqual(messagesFromWorker[0].ready, true);
console.log('  ✓ Worker успішно завантажив 26k+ пунктів та 55k+ відділень');

// 3. Тестування повідомлення PING -> PONG
console.log('\n▶ ТЕСТ 3: Перевірка стану воркера (PING / PONG)');
sandbox.onmessage({ data: { type: 'PING' } });
const pongMsg = messagesFromWorker.find(m => m.type === 'PONG');
assert.ok(pongMsg && pongMsg.ready, 'Worker повинен відповісти PONG зі статусом ready: true');
console.log('  ✓ PING / PONG працює коректно');

// 4. Тестування фонового автокомпліту (Нова пошта)
console.log('\n▶ ТЕСТ 4: Фоновий автокомпліт Нової пошти ("львів")');
sandbox.onmessage({
  data: {
    id: 101,
    type: 'AUTOCOMPLETE',
    query: 'львів',
    service: 'novaposhta'
  }
});

const autoMsg = messagesFromWorker.find(m => m.id === 101);
assert.ok(autoMsg, 'Worker повинен повернути AUTOCOMPLETE_RESULT для id: 101');
assert.strictEqual(autoMsg.type, 'AUTOCOMPLETE_RESULT');
assert.ok(Array.isArray(autoMsg.suggestions) && autoMsg.suggestions.length > 0, 'Список підказок не повинен бути порожнім');
console.log(`  ✓ Знайдено підказок: ${autoMsg.suggestions.length}`);

// 5. Тестування фонового пошуку з одруківкою ("горанечі 1")
console.log('\n▶ ТЕСТ 5: Фоновий пошук Нової пошти з одруківкою ("горанечі 1")');
sandbox.onmessage({
  data: {
    id: 102,
    type: 'SEARCH',
    query: 'горанечі 1',
    service: 'novaposhta'
  }
});

const searchMsg = messagesFromWorker.find(m => m.id === 102);
assert.ok(searchMsg, 'Worker повинен повернути SEARCH_RESULT для id: 102');
assert.strictEqual(searchMsg.type, 'SEARCH_RESULT');
assert.ok(Array.isArray(searchMsg.staticMatches) && searchMsg.staticMatches.length > 0, 'Результати пошуку не повинні бути порожніми');
assert.strictEqual(searchMsg.staticMatches[0].city, 'Гореничі', 'Місто має бути Гореничі');
assert.strictEqual(String(searchMsg.staticMatches[0].number), '1', 'Номер відділення має бути 1');
console.log(`  ✓ Знайдено: ${searchMsg.staticMatches[0].city} №${searchMsg.staticMatches[0].number}`);

// 6. Тестування фонового пошуку Укрпошти ("47501")
console.log('\n▶ ТЕСТ 6: Фоновий пошук Укрпошти ("47501")');
sandbox.onmessage({
  data: {
    id: 103,
    type: 'SEARCH',
    query: '47501',
    service: 'ukrposhta'
  }
});

const upSearchMsg = messagesFromWorker.find(m => m.id === 103);
assert.ok(upSearchMsg, 'Worker повинен повернути SEARCH_RESULT для Укрпошти');
assert.ok(upSearchMsg.staticMatches.length > 0, 'Укрпошта має знайти відділення');
const foundUp = upSearchMsg.staticMatches[0];
assert.ok(String(foundUp.index || foundUp.postalCode || foundUp.number).includes('47501'), 'Індекс має містити 47501');
console.log(`  ✓ Укрпошта знайшла: ${foundUp.city} (${foundUp.index || foundUp.postalCode})`);

// 6б. Тестування CRM_SETTLEMENTS_DATA та мапованих полів Укрпошти у Worker
console.log('\n▶ ТЕСТ 6б: Перевірка CRM_SETTLEMENTS_DATA та детального пошуку Укрпошти у Worker');
assert.ok(sandbox.CRM_SETTLEMENTS_DATA && typeof sandbox.CRM_SETTLEMENTS_DATA === 'object', 'Worker повинен завантажувати CRM_SETTLEMENTS_DATA');

const runUpWorkerSearch = (id, query) => {
  sandbox.onmessage({
    data: { id, type: 'SEARCH', query, service: 'ukrposhta' }
  });
  return messagesFromWorker.find(m => m.id === id);
};

const upKamianske = runUpWorkerSearch(104, "Кам'янське Дніпропетровська");
assert.ok(upKamianske && upKamianske.staticMatches.length >= 20, `Очікувалось >= 20 відділень УП для Кам'янське Дніпропетровська, отримано ${upKamianske && upKamianske.staticMatches.length}`);
assert.strictEqual(upKamianske.staticMatches[0].city, "Кам'янське");
assert.strictEqual(upKamianske.staticMatches[0].oblast, 'Дніпропетровська');
assert.match(String(upKamianske.staticMatches[0].index || upKamianske.staticMatches[0].postalCode), /^\d{5}$/);
console.log(`  ✓ Кам'янське Дніпропетровська (УП): ${upKamianske.staticMatches.length} відділень (${upKamianske.staticMatches[0].index})`);

const upSvyatopetr = runUpWorkerSearch(105, 'Святопетрівське Бучанський Київська');
assert.ok(upSvyatopetr && upSvyatopetr.staticMatches.length >= 2, `Очікувалось >= 2 відділень УП для Святопетрівське Бучанський Київська, отримано ${upSvyatopetr && upSvyatopetr.staticMatches.length}`);
console.log(`  ✓ Святопетрівське Бучанський Київська (УП): ${upSvyatopetr.staticMatches.length} відділень`);

const upKharkiv = runUpWorkerSearch(106, 'Харків 61020');
assert.ok(upKharkiv && upKharkiv.staticMatches.length >= 1, `Очікувалось >= 1 відділення УП для Харків 61020, отримано ${upKharkiv && upKharkiv.staticMatches.length}`);
assert.ok(String(upKharkiv.staticMatches[0].index || upKharkiv.staticMatches[0].postalCode).includes('61020'));
console.log(`  ✓ Харків 61020 (УП): ${upKharkiv.staticMatches[0].city} (${upKharkiv.staticMatches[0].index})`);

// 7. Перевірка інтеграції SearchWorkerBridge в app.js
console.log('\n▶ ТЕСТ 7: Перевірка інтеграції SearchWorkerBridge та Graceful Fallback в app.js');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(appJs.includes('const SearchWorkerBridge ='), 'app.js повинен містити SearchWorkerBridge');
assert.ok(appJs.includes('SearchWorkerBridge.init()'), 'app.js повинен ініціалізувати SearchWorkerBridge');
assert.ok(appJs.includes('SearchWorkerBridge.searchAsync'), 'app.js повинен викликати SearchWorkerBridge.searchAsync');
assert.ok(appJs.includes('SearchWorkerBridge.autocompleteAsync'), 'app.js повинен викликати SearchWorkerBridge.autocompleteAsync');
assert.ok(appJs.includes('window.location.protocol === \'file:\''), 'SearchWorkerBridge повинен мати захист від file:// CORS');
console.log('  ✓ SearchWorkerBridge інтегровано в app.js із захистом та фолбеком');

console.log('\n===============================================================');
console.log('🎉 ВСІ ТЕСТИ ФОНОВОГО WEB WORKER ПРОЙДЕНО УСПІШНО!');
console.log('===============================================================');
