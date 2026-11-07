/**
 * Automated Test Suite: Service Worker Silent Background Update Verification
 * Tests the entire silent update lifecycle, caching headers, tab switching, and user protection.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('===============================================================');
console.log('🧪 АВТОМАТИЗОВАНЕ ТЕСТУВАННЯ БЕЗПАЛІВНОГО ОНОВЛЕННЯ SERVICE WORKER');
console.log('===============================================================');

const rootDir = path.resolve(__dirname, '..');
const swPath = path.join(rootDir, 'sw.js');
const appPath = path.join(rootDir, 'app.js');

const swContent = fs.readFileSync(swPath, 'utf8');
const appContent = fs.readFileSync(appPath, 'utf8');

// -----------------------------------------------------------------------------
// ТЕСТ 1: Перевірка правил кешування та запитів у sw.js
// -----------------------------------------------------------------------------
console.log('\n▶ ТЕСТ 1: Обхід дискового HTTP-кешу та логіка встановлення у sw.js');
assert(
  swContent.includes("fetch(req.url, { cache: 'no-cache' })"),
  'Помилка: sw.js повинен виконувати навігаційний запит із { cache: "no-cache" } для обходу HTTP-кешу'
);
console.log('  ✓ Успіх: { cache: "no-cache" } налаштовано для навігації (Cmd+Shift+R більше не потрібен)');

assert(
  swContent.includes('if (!self.registration.active) {\n    self.skipWaiting();\n  }'),
  'Помилка: sw.js повинен викликати skipWaiting() тільки якщо немає активного воркера (перший запуск)'
);
console.log('  ✓ Успіх: Перший візит активується одразу, а оновлення чекає команди сторінки');

assert(
  swContent.includes("event.data.type === 'SKIP_WAITING'"),
  'Помилка: sw.js повинен слухати команду SKIP_WAITING від вкладки'
);
console.log('  ✓ Успіх: Обробник повідомлення SKIP_WAITING наявний у sw.js');


// -----------------------------------------------------------------------------
// ТЕСТ 2: Перевірка чистоти реєстрації та відсутності конфліктів у app.js
// -----------------------------------------------------------------------------
console.log('\n▶ ТЕСТ 2: Чистота реєстрації та ліквідація конфліктного видалення кешу');
assert(
  !appContent.includes("register('./sw.js?v="),
  'Помилка: реєстрація не повинна містити захардкоджені версії типу ?v=1.4.6'
);
assert(
  appContent.includes("register('./sw.js', { updateViaCache: 'none' })"),
  'Помилка: має бути чиста реєстрація ./sw.js з updateViaCache: "none"'
);
console.log('  ✓ Успіх: Чиста реєстрація ./sw.js з updateViaCache: "none"');

assert(
  !appContent.includes("if (key !== 'np-ukr-cache-v1.4.6')"),
  'Помилка: старий деструктивний код видалення кешу v1.4.6 має бути прибраний'
);
console.log('  ✓ Успіх: Деструктивний конфлікт кешу видалено');

assert(
  appContent.includes("r.active.scriptURL.includes('sw.js?v=')"),
  'Помилка: має бути автоочищення старих реєстрацій із query-параметрами'
);
console.log('  ✓ Успіх: Механізм автоочищення застарілих реєстрацій браузера активний');


// -----------------------------------------------------------------------------
// ТЕСТ 3: Емуляція життєвого циклу браузера (Моделювання сценаріїв)
// -----------------------------------------------------------------------------
console.log('\n▶ ТЕСТ 3: Емуляція життєвого циклу оновлення та поведінки вкладок');

// Створюємо ізольоване середовище браузера (Mock DOM & ServiceWorker API)
class MockServiceWorker {
  constructor() {
    this.state = 'installing';
    this.messages = [];
    this.listeners = {};
  }
  addEventListener(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  postMessage(msg) {
    this.messages.push(msg);
  }
  changeState(newState) {
    this.state = newState;
    (this.listeners['statechange'] || []).forEach(cb => cb());
  }
}

class MockRegistration {
  constructor(hasController) {
    this.installing = null;
    this.waiting = null;
    this.active = hasController ? new MockServiceWorker() : null;
    this.listeners = {};
    this.updateCallCount = 0;
  }
  addEventListener(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  update() {
    this.updateCallCount++;
    return Promise.resolve();
  }
  triggerUpdateFound(newWorker) {
    this.installing = newWorker;
    (this.listeners['updatefound'] || []).forEach(cb => cb());
  }
}

// Функція для запуску логіки initServiceWorker у змодельованому середовищі
async function runMockInitServiceWorker(options = {}) {
  let reloadCalled = false;
  let eventListeners = {};

  const mockWindow = {
    location: {
      protocol: 'https:',
      reload: () => { reloadCalled = true; }
    },
    addEventListener: (evt, cb) => {
      if (!eventListeners[evt]) eventListeners[evt] = [];
      eventListeners[evt].push(cb);
    }
  };

  const mockDocument = {
    hidden: options.initiallyHidden || false,
    visibilityState: options.initiallyHidden ? 'hidden' : 'visible',
    listeners: {},
    addEventListener: (evt, cb, opts) => {
      if (!mockDocument.listeners[evt]) mockDocument.listeners[evt] = [];
      mockDocument.listeners[evt].push({ cb, once: opts && opts.once });
    },
    removeEventListener: (evt, cb) => {
      if (mockDocument.listeners[evt]) {
        mockDocument.listeners[evt] = mockDocument.listeners[evt].filter(item => item.cb !== cb);
      }
    },
    dispatchEvent: (evt) => {
      if (mockDocument.listeners[evt]) {
        const list = [...mockDocument.listeners[evt]];
        list.forEach(item => {
          item.cb();
          if (item.once) {
            mockDocument.removeEventListener(evt, item.cb);
          }
        });
      }
    },
    querySelector: () => options.hasOpenModal ? {} : null
  };

  const reg = new MockRegistration(options.hasController);
  const swListeners = {};

  const mockNavigator = {
    serviceWorker: {
      controller: options.hasController ? {} : null,
      getRegistrations: () => Promise.resolve([]),
      register: () => Promise.resolve(reg),
      addEventListener: (evt, cb) => {
        if (!swListeners[evt]) swListeners[evt] = [];
        swListeners[evt].push(cb);
      },
      triggerControllerChange: () => {
        (swListeners['controllerchange'] || []).forEach(cb => cb());
      }
    }
  };

  // Витягуємо безпосередньо функцію initServiceWorker із реального app.js
  const fnMatch = appContent.match(/function initServiceWorker\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ =+/);
  assert(fnMatch, 'Не знайдено функцію initServiceWorker в app.js');

  const fnBody = fnMatch[1];
  const dom = { searchInput: { value: options.searchValue || '' } };

  // Виконуємо тіло функції в мок-середовищі
  const runner = new Function(
    'window', 'document', 'navigator', 'dom', 'setInterval',
    `const caches = { delete: () => Promise.resolve() };\n` + fnBody
  );

  let intervalCallback = null;
  const mockSetInterval = (cb) => { intervalCallback = cb; };

  runner(mockWindow, mockDocument, mockNavigator, dom, mockSetInterval);

  // Очікуємо виконання мікротасок (register.then)
  await new Promise(r => setImmediate(r));

  return {
    reg,
    mockDocument,
    mockNavigator,
    getReloadCalled: () => reloadCalled,
    getIntervalCallback: () => intervalCallback
  };
}

async function runAllTests() {
  // -----------------------------------------------------------------------------
  // СЦЕНАРІЙ А: Перший візит нового користувача
  // -----------------------------------------------------------------------------
  {
    const env = await runMockInitServiceWorker({ hasController: false, initiallyHidden: false });
    // Симулюємо зміну контролера (активація першого воркера)
    env.mockNavigator.serviceWorker.triggerControllerChange();
    assert.strictEqual(env.getReloadCalled(), false, 'Перший візит не повинен викликати перезавантаження сторінки');
    console.log('  ✓ Сценарій А (Перший вхід): Сторінка НЕ перезавантажується раптово при першому встановленні');
  }

  // -----------------------------------------------------------------------------
  // СЦЕНАРІЙ Б: Оновлення, коли вкладка ПРИХОВАНА (користувач на іншій вкладці)
  // -----------------------------------------------------------------------------
  {
    const env = await runMockInitServiceWorker({ hasController: true, initiallyHidden: true });
    const newWorker = new MockServiceWorker();
    env.reg.triggerUpdateFound(newWorker);
    newWorker.changeState('installed');

    // Оскільки вкладка прихована (document.hidden === true), вона повинна негайно надіслати SKIP_WAITING
    assert(
      newWorker.messages.some(m => m.type === 'SKIP_WAITING'),
      'Вкладка у фоні повинна миттєво відправити SKIP_WAITING'
    );

    // Коли воркер переймає керування — сторінка у фоні повинна тихо викликати reload
    env.mockNavigator.serviceWorker.triggerControllerChange();
    assert.strictEqual(env.getReloadCalled(), true, 'Прихована вкладка повинна перезавантажитися у фоні');
    console.log('  ✓ Сценарій Б (Фонова вкладка): Нова версія активується і сторінка тихо перезавантажується у фоні');
  }

  // -----------------------------------------------------------------------------
  // СЦЕНАРІЙ В: Оновлення прийшло, коли користувач АКТИВНИЙ (дивиться на екран)
  // -----------------------------------------------------------------------------
  {
    const env = await runMockInitServiceWorker({ hasController: true, initiallyHidden: false });
    const newWorker = new MockServiceWorker();
    env.reg.triggerUpdateFound(newWorker);
    newWorker.changeState('installed');

    // Поки вкладка відкрита перед очима — SKIP_WAITING НЕ відправляється, reload НЕ викликається!
    assert.strictEqual(
      newWorker.messages.some(m => m.type === 'SKIP_WAITING'),
      false,
      'Активна вкладка не повинна раптово переривати роботу'
    );
    assert.strictEqual(env.getReloadCalled(), false, 'Активна сторінка не повинна перезавантажуватися перед очима');

    // Тепер користувач перемикається на іншу вкладку:
    env.mockDocument.hidden = true;
    env.mockDocument.dispatchEvent('visibilitychange');

    // Тепер оновлення повинно негайно активуватися:
    assert(
      newWorker.messages.some(m => m.type === 'SKIP_WAITING'),
      'При перемиканні вкладки SKIP_WAITING повинен бути відправлений'
    );
    env.mockNavigator.serviceWorker.triggerControllerChange();
    assert.strictEqual(env.getReloadCalled(), true, 'Після переходу на іншу вкладку сторінка повинна перезавантажитися');
    console.log('  ✓ Сценарій В (Активна вкладка): Робота користувача не переривається; оновлення чекає моменту перемикання вкладки');
  }

  // -----------------------------------------------------------------------------
  // СЦЕНАРІЙ Г: Регулярний фоновий радар (Polling)
  // -----------------------------------------------------------------------------
  {
    const env = await runMockInitServiceWorker({ hasController: true, initiallyHidden: false });
    assert(typeof env.getIntervalCallback() === 'function', 'Таймер періодичного опитування має бути встановлений');
    const countBefore = env.reg.updateCallCount;
    env.getIntervalCallback()();
    assert.strictEqual(env.reg.updateCallCount, countBefore + 1, 'Фоновий таймер повинен викликати reg.update()');
    console.log('  ✓ Сценарій Г (Фоновий радар): Автоматична періодична перевірка reg.update() кожні 3 хвилини працює коректно');
  }

  console.log('\n===============================================================');
  console.log('🎉 ВСІ ТЕСТИ БЕЗПАЛІВНОГО ОНОВЛЕННЯ ПРОЙДЕНО УСПІШНО! ВСЕ ГУД! 👍');
  console.log('===============================================================');
  process.exit(0);
}

runAllTests().catch(err => {
  console.error(err);
  process.exit(1);
});
