/**
 * ПОШУКОВА СИСТЕМА ВІДДІЛЕНЬ НОВОЇ ПОШТИ ТА УКРПОШТИ
 * Клієнтська логіка: темна тема, автентичний жовтий стиль Укрпошти,
 * чесний лічильник онлайн (1 на localhost), пошук за індексами (47501 тощо) та API.
 */

(function () {
  'use strict';

  const APP_VERSION = '2.0.3';

  // Вебхук автоматичного запису проблемних запитів у Google Таблицю
  const TELEMETRY_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzSV99G9gc9XEvyZRs1cxN3BU5Ka74EBPLJDO0n3R7JODWN3GAtumlIFOcj3VcDTI02/exec';
  const loggedRecentEvents = new Map();
  let settledQueryTimer = null;
  let zeroResultsDebounceTimer = null;

  // Відстеження активного джерела введення (Ручний, Вставка з буфера, Швидкий чіп, Історія, Автокомпліт)
  let currentInputSource = 'manual'; // 'manual' | 'paste' | 'frequent_chip' | 'history_card' | 'autocomplete' | 'smart_banner'

  function getSourceLabel(src) {
    switch (src) {
      case 'paste': return 'Вставка з буфера (Paste)';
      case 'frequent_chip': return 'Швидкі міста (Чіп)';
      case 'history_card': return 'Історія пошуків';
      case 'autocomplete': return 'Автокомпліт';
      case 'smart_banner': return 'Розвилка служб';
      default: return 'Ручний ввід';
    }
  }

  function isEmbeddedMode() {
    return Boolean(
      typeof document !== 'undefined' &&
      document.documentElement &&
      document.documentElement.classList &&
      typeof document.documentElement.classList.contains === 'function' &&
      document.documentElement.classList.contains('is-embedded')
    );
  }

  // Надійна відправка проблемних випадків пошуку в Google Таблицю операторів
  function logFailureTelemetry(payload) {
    try {
      if (typeof window !== 'undefined') window.__lastTelemetryPayload = payload;
      if (typeof window === 'undefined' || typeof location === 'undefined') return;
      if (isEmbeddedMode()) return;
      // Захист: не спамимо в робочу таблицю з localhost, 127.0.0.1 або автоматичних Node/Headless тестів
      if (
        typeof process !== 'undefined' ||
        !location.hostname ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.protocol === 'file:' ||
        (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.includes('HeadlessChrome'))
      ) {
        return;
      }

      const q = (payload.query || '').trim().toLowerCase();
      const statusKey = `${payload.status || ''}_${q}_${payload.service || ''}`;
      // Динамічний тротлінг за часом (10 сек), щоб не спамити дублями під час набору літер
      const now = Date.now();
      const lastLoggedTime = loggedRecentEvents.get(statusKey);
      if (lastLoggedTime && (now - lastLoggedTime) < 10000) return;
      loggedRecentEvents.set(statusKey, now);
      if (loggedRecentEvents.size > 200) {
        const first = loggedRecentEvents.keys().next().value;
        loggedRecentEvents.delete(first);
      }

      const bodyString = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([bodyString], { type: 'text/plain;charset=utf-8' });
        navigator.sendBeacon(TELEMETRY_WEBHOOK_URL, blob);
      } else {
        fetch(TELEMETRY_WEBHOOK_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: bodyString,
          keepalive: true
        }).catch(() => {});
      }
    } catch (e) {
      // Ізоляція від будь-яких мережевих збоїв
    }
  }

  // Відстеження активної пошукової сесії та ланцюжка переписування (Journey)
  const lastSearchSession = {
    query: '',
    initialQuery: '',
    service: 'novaposhta',
    timestamp: 0,
    resultsCount: 0,
    hasAltServiceBranch: false,
    hasCopied: false,
    abandonedTracked: false,
    source: 'manual',
    previousQuery: '',
    previousResultsCount: 0,
    previousService: 'novaposhta'
  };

  function resetSearchSessionState() {
    lastSearchSession.query = '';
    lastSearchSession.initialQuery = '';
    lastSearchSession.previousQuery = '';
    lastSearchSession.previousResultsCount = 0;
    lastSearchSession.timestamp = 0;
    lastSearchSession.resultsCount = 0;
    lastSearchSession.hasAltServiceBranch = false;
    lastSearchSession.hasCopied = false;
    lastSearchSession.abandonedTracked = false;
  }

  function updateSearchSessionState(query, resultsCount, source, hasAltServiceBranch = false) {
    const cleanQ = (query || '').trim();
    if (!cleanQ || cleanQ.length < 2) return;

    checkSearchRefinementFriction(cleanQ);

    if (!lastSearchSession.initialQuery || lastSearchSession.hasCopied) {
      lastSearchSession.initialQuery = cleanQ;
      lastSearchSession.previousQuery = '';
      lastSearchSession.previousResultsCount = 0;
    }

    lastSearchSession.query = cleanQ;
    lastSearchSession.service = (typeof state !== 'undefined' && state.currentService) ? state.currentService : 'novaposhta';
    lastSearchSession.timestamp = Date.now();
    lastSearchSession.resultsCount = (typeof resultsCount === 'number') ? resultsCount : 0;
    lastSearchSession.hasAltServiceBranch = Boolean(hasAltServiceBranch);
    lastSearchSession.source = source || currentInputSource || 'manual';
    lastSearchSession.hasCopied = false;
    lastSearchSession.abandonedTracked = false;
  }

  // Безпечне відправлення подій у Microsoft Clarity
  function trackClarityEvent(eventName) {
    try {
      if (typeof clarity === 'function') {
        clarity('event', eventName);
      } else if (typeof window !== 'undefined' && typeof window.clarity === 'function') {
        window.clarity('event', eventName);
      }
    } catch (e) {
      // Захист від блокувальників реклами
    }
  }

  // Безпечне встановлення кастомних тегів у Microsoft Clarity
  function setClarityTag(key, value) {
    try {
      if (typeof clarity === 'function') {
        clarity('set', key, String(value));
      } else if (typeof window !== 'undefined' && typeof window.clarity === 'function') {
        window.clarity('set', key, String(value));
      }
    } catch (e) {
      // Захист від блокувальників реклами
    }
  }

  // Обробник відвалу оператора (закрив вкладку або пішов на інший сайт без копіювання)
  function handleSessionAbandonment() {
    try {
      if (
        lastSearchSession.query &&
        !lastSearchSession.hasCopied &&
        !lastSearchSession.abandonedTracked &&
        lastSearchSession.timestamp > 0
      ) {
        const elapsed = Date.now() - lastSearchSession.timestamp;
        // Фіксуємо кинутий пошук тільки якщо користувач пробув з результатами хоча б 3 секунди
        if (elapsed >= 3000) {
          lastSearchSession.abandonedTracked = true;
          trackClarityEvent('search_abandoned');
          setClarityTag('abandoned_query', lastSearchSession.query.slice(0, 50));
          trackEvent('search_abandoned', {
            search_term: lastSearchSession.query,
            service: lastSearchSession.service === 'novaposhta' ? 'NP' : 'UKR',
            results_count: lastSearchSession.resultsCount,
            duration_sec: Math.round(elapsed / 1000)
          });
          if (lastSearchSession.query.length >= 2) {
            logFailureTelemetry({
              query: lastSearchSession.query,
              service: lastSearchSession.service,
              status: '🟣 Кинутий пошук',
              resultsCount: lastSearchSession.resultsCount,
              duration: Math.round(elapsed / 1000),
              details: `Оператор залишив сторінку без копіювання адреси. Джерело: ${getSourceLabel(lastSearchSession.source || currentInputSource)}`
            });
          }
        }
      }
    } catch (e) {}
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        handleSessionAbandonment();
      }
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', handleSessionAbandonment);
  }

  // Безпечне відправлення подій у Google Analytics 4 (GA4) та синхронізація з Clarity
  function trackEvent(eventName, params = {}) {
    try {
      if (typeof gtag === 'function') {
        gtag('event', eventName, params);
      } else if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
        window.gtag('event', eventName, params);
      }
    } catch (e) {
      // Захист від блокувальників реклами та розривів виконання
    }

    // Автоматична синхронізація ключових дій у Clarity та телеметрію
    try {
      if (eventName === 'copy_branch_address' || eventName === 'copy_crm_hint') {
        trackClarityEvent('branch_copied');
        if (params && params.branch_type) {
          setClarityTag('branch_type', params.branch_type);
        }
        const activeQuery = (
          lastSearchSession.query ||
          (typeof dom !== 'undefined' && dom.searchInput ? dom.searchInput.value.trim() : '') ||
          (typeof state !== 'undefined' ? state.searchQuery : '') ||
          ''
        ).trim();

        if (activeQuery && !lastSearchSession.hasCopied) {
          lastSearchSession.hasCopied = true;
          const timeToCopy = lastSearchSession.timestamp > 0
            ? Math.max(1, Math.round((Date.now() - lastSearchSession.timestamp) / 1000))
            : 1;
          setClarityTag('time_to_copy_sec', timeToCopy);
          trackEvent('time_to_copy', {
            search_term: activeQuery,
            duration_sec: timeToCopy,
            service: (lastSearchSession.service || state.currentService) === 'novaposhta' ? 'NP' : 'UKR'
          });

          const cleanInit = (lastSearchSession.initialQuery || '').trim().toLowerCase();
          const cleanFinal = activeQuery.toLowerCase();
          const wasRewritten = Boolean(lastSearchSession.previousQuery) ||
            (cleanInit && cleanFinal && !cleanFinal.startsWith(cleanInit));
          const srcLabel = getSourceLabel(lastSearchSession.source || currentInputSource);
          const countVal = lastSearchSession.resultsCount || (typeof state !== 'undefined' && state.currentResults ? state.currentResults.length : 1) || 1;

          if (wasRewritten && cleanInit && cleanInit !== cleanFinal) {
            logFailureTelemetry({
              query: `«${lastSearchSession.initialQuery}» ➔ «${activeQuery}»`,
              service: lastSearchSession.service || state.currentService,
              status: '🟢 Успіх після переписування',
              resultsCount: countVal,
              duration: timeToCopy,
              details: `Оператор успішно знайшов і скопіював відділення після переписування початкового запиту «${lastSearchSession.initialQuery}». Джерело: ${srcLabel}`
            });
          } else {
            logFailureTelemetry({
              query: activeQuery,
              service: lastSearchSession.service || state.currentService,
              status: '🟢 Успішний пошук (Скопійовано)',
              resultsCount: countVal,
              duration: timeToCopy,
              details: `Оператор успішно знайшов і скопіював адресу відділення. Джерело: ${srcLabel}`
            });
          }

          // Скидаємо початковий і попередній запити після успішного копіювання,
          // щоб наступний незалежний пошук ніколи не склеювався зі старим
          lastSearchSession.initialQuery = '';
          lastSearchSession.previousQuery = '';
          lastSearchSession.previousResultsCount = 0;
        }
      }
    } catch (e) {
      // Ізоляція від помилок
    }
  }

  // Детекція заміни/стирання запиту оператором без копіювання (Friction & Query Journey)
  function checkSearchRefinementFriction(newQuery) {
    try {
      if (
        lastSearchSession.query &&
        !lastSearchSession.hasCopied &&
        !lastSearchSession.abandonedTracked &&
        lastSearchSession.query.length >= 2
      ) {
        const cleanOld = lastSearchSession.query.trim().toLowerCase();
        const cleanNew = (newQuery || '').trim().toLowerCase();
        if (cleanOld && cleanNew && cleanOld !== cleanNew) {
          const isRealChange = !cleanNew.startsWith(cleanOld) || lastSearchSession.resultsCount === 0;
          if (isRealChange) {
            const elapsed = Date.now() - lastSearchSession.timestamp;
            if (elapsed >= 200 && elapsed <= 60000) {
              const oldQ = lastSearchSession.query;
              const oldResults = lastSearchSession.resultsCount;
              const isRedZero = oldResults === 0 && !lastSearchSession.hasAltServiceBranch;
              lastSearchSession.previousQuery = oldQ;
              lastSearchSession.previousResultsCount = oldResults;
              if (!lastSearchSession.initialQuery) {
                lastSearchSession.initialQuery = oldQ;
              }

              logFailureTelemetry({
                query: `«${oldQ}» ➔ «${(newQuery || '').trim()}»`,
                service: lastSearchSession.service || state.currentService,
                status: isRedZero ? '🔴 0 рез. ➔ Переписано' : '🟠 Переписування запиту',
                resultsCount: oldResults,
                duration: Math.max(1, Math.round(elapsed / 1000)),
                details: `Початковий запит «${oldQ}» (${oldResults} рез.) було змінено на «${(newQuery || '').trim()}». Джерело: ${getSourceLabel(currentInputSource)}`
              });
            }
          }
        }
      }
    } catch (e) {}
  }

  // ==========================================================================
  // СТАН ДОДАТКУ (STATE)
  // ==========================================================================
  const state = {
    theme: 'light', // 'light' | 'dark' (Default: Light / біла)
    currentService: 'novaposhta', // 'novaposhta' | 'ukrposhta'
    searchQuery: '',
    currentResults: [],
    displayLimit: 10, // 5 | 10 | 20 | 'all'
    typeFilter: 'all', // 'all' | 'cargo' | 'branch' | 'postomat'
    mapTypeFilter: 'all', // 'all' | 'cargo' | 'branch' | 'postomat'
    isMapVisible: false,
    leafletMap: null,
    currentTileLayer: null,
    currentTileTheme: null,
    markersGroup: null,
    branchMarkersMap: new Map(),
    userLocationMarker: null,
    apiKeyNP: localStorage.getItem('np_api_key') || '',
    hasServerKey: false,
    selectedBranch: null, // Обране користувачем відділення для повної картки
    selectedSettlement: null, // Обраний населений пункт з автокомпліту для захисту від змішування міст
    lockedInputValue: null, // Рядок, зафіксований після вибору з підказки автокомпліту
    onlineTabsCount: 1
  };

  const safeRAF = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => { cb(); };

  // Швидкий вибір: стартові міста БЕЗ штучних лічильників. Показуються лише як
  // заповнювач вільних слотів, поки реальні запити користувача не витіснять їх.
  const DEFAULT_CITIES = [
    { query: 'Київ', count: 0 },
    { query: 'Львів', count: 0 },
    { query: 'Дніпро', count: 0 },
    { query: 'Одеса', count: 0 },
    { query: 'Харків', count: 0 },
    { query: 'Житомир', count: 0 },
    { query: 'Запоріжжя', count: 0 },
    { query: 'Вінниця', count: 0 },
    { query: 'Полтава', count: 0 },
    { query: 'Миколаїв', count: 0 }
  ];

  // ==========================================================================
  // DOM ЕЛЕМЕНТИ
  // ==========================================================================
  const dom = {
    body: document.body,
    html: document.documentElement,
    btnThemeToggle: document.getElementById('btnThemeToggle'),
    btnNovaPoshta: document.getElementById('btnNovaPoshta'),
    btnUkrposhta: document.getElementById('btnUkrposhta'),
    activeServiceTag: document.getElementById('activeServiceTag'),
    
    // Пошук
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    btnClearSearch: document.getElementById('btnClearSearch'),
    btnSearchSubmit: document.getElementById('btnSearchSubmit'),
    autocompleteDropdown: document.getElementById('autocompleteDropdown'),
    
    // Результати
    searchResultsSection: document.getElementById('searchResultsSection'),
    didYouMeanBox: document.getElementById('didYouMeanBox'),
    crossServiceBanner: document.getElementById('crossServiceBanner'),
    resultsList: document.getElementById('resultsList'),
    resultsCount: document.getElementById('resultsCount'),
    btnResetSelectedBranch: document.getElementById('btnResetSelectedBranch'),
    resultsTypeFilters: document.getElementById('resultsTypeFilters'),
    limitSelector: document.getElementById('limitSelector'),

    // Карта
    btnToggleMap: document.getElementById('btnToggleMap'),
    mapBtnText: document.getElementById('mapBtnText'),
    mapSection: document.getElementById('mapSection'),
    mapServiceTitle: document.getElementById('mapServiceTitle'),
    mapMarkersCount: document.getElementById('mapMarkersCount'),
    btnGeoLocate: document.getElementById('btnGeoLocate'),
    btnCloseMap: document.getElementById('btnCloseMap'),
    branchesMap: document.getElementById('branchesMap'),
    mapTypeFilters: document.getElementById('mapTypeFilters'),

    // Найчастіші запити та історія
    frequentChipsGrid: document.getElementById('frequentChipsGrid'),
    recentHistorySection: document.getElementById('recentHistorySection'),
    recentHistoryList: document.getElementById('recentHistoryList'),
    btnClearHistory: document.getElementById('btnClearHistory'),

    // Нижні кути
    btnVersionHistory: document.getElementById('btnVersionHistory'),
    versionModal: document.getElementById('versionModal'),
    btnCloseVersionModal: document.getElementById('btnCloseVersionModal'),
    btnDismissVersionModal: document.getElementById('btnDismissVersionModal'),
    bottomBar: (typeof document !== 'undefined') ? (
      (typeof document.getElementById === 'function' && document.getElementById('bottomBar')) ||
      (typeof document.querySelector === 'function' && document.querySelector('.bottom-bar')) ||
      null
    ) : null,

    // Конструктор шаблонів копіювання
    btnHeaderCopySettings: document.getElementById('btnHeaderCopySettings'),
    copyPresetModal: document.getElementById('copyPresetModal'),
    btnCloseCopyModal: document.getElementById('btnCloseCopyModal'),
    btnResetCopyPreset: document.getElementById('btnResetCopyPreset'),
    btnSaveCopyPreset: document.getElementById('btnSaveCopyPreset'),
    btnPresetTestCopy: document.getElementById('btnPresetTestCopy'),
    presetLivePreview: document.getElementById('presetLivePreview'),
    presetQuickButtons: document.getElementById('presetQuickButtons'),
    presetActiveChips: document.getElementById('presetActiveChips'),
    presetChipPalette: document.getElementById('presetChipPalette'),
    optSmtShort: document.getElementById('optSmtShort'),
    optNoBranchWord: document.getElementById('optNoBranchWord'),
    optShortRegion: document.getElementById('optShortRegion'),
    optNoStreetPrefix: document.getElementById('optNoStreetPrefix'),

    // Фідбек
    btnFeedback: (typeof document !== 'undefined' && typeof document.querySelector === 'function') ? document.querySelector('.btn-feedback') : null
  };

  // ==========================================================================
  // 0. ТЕМА ОФОРМЛЕННЯ (СВІТЛА / ТЕМНА, LOCALSTORAGE, ДЕФОЛТ: СВІТЛА)
  // ==========================================================================
  const THEME_STORAGE_KEY = 'app_theme';

  function getStoredTheme() {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const urlTheme = new URLSearchParams(window.location.search).get('theme');
        if (urlTheme === 'dark' || urlTheme === 'light') {
          try { localStorage.setItem(THEME_STORAGE_KEY, urlTheme); } catch (e) {}
          return urlTheme;
        }
      }
      if (typeof document !== 'undefined' && document.documentElement) {
        const attrTheme = document.documentElement.getAttribute('data-theme');
        if (attrTheme === 'dark' || attrTheme === 'light') {
          return attrTheme;
        }
      }
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      return stored === 'dark' ? 'dark' : 'light';
    } catch (e) {
      return (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme')) || 'light';
    }
  }

  function applyTheme(newTheme, saveToStorage = true) {
    const theme = newTheme === 'dark' ? 'dark' : 'light';
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);

    if (dom.btnThemeToggle) {
      const isDark = theme === 'dark';
      const label = isDark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
      dom.btnThemeToggle.setAttribute('aria-label', label);
      dom.btnThemeToggle.setAttribute('title', label);
    }

    // Синхронізуємо посилання на сторінку "Про проєкт" з поточною темою
    if (typeof document !== 'undefined') {
      const btnAbout = document.getElementById('btnHeaderAbout');
      if (btnAbout) {
        btnAbout.setAttribute('href', 'about.html?theme=' + theme);
      }
    }

    if (typeof updateMapTileLayerTheme === 'function') {
      updateMapTileLayerTheme(theme);
    }

    if (saveToStorage) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
      } catch (e) {
        console.error('Помилка запису теми в localStorage', e);
      }
      if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
        try {
          const url = new URL(window.location.href);
          url.searchParams.set('theme', theme);
          window.history.replaceState({}, '', url.toString());
        } catch (e) {}
      }
    }
  }

  function toggleTheme() {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
  }

  // Синхронізація теми в реальному часі між вкладками (наприклад, зміна теми на сторінці about.html)
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (e) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue && e.newValue !== state.theme) {
        applyTheme(e.newValue, false);
      }
    });

    // Перехоплення кліку на перехід до "Про проєкт" для гарантованої передачі теми
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        const link = e.target && e.target.closest ? e.target.closest('a[href*="about.html"]') : null;
        if (link) {
          const curTheme = state.theme || document.documentElement.getAttribute('data-theme') || 'light';
          link.setAttribute('href', 'about.html?theme=' + curTheme);
        }
      });
    }
  }

  // ==========================================================================
  // 1. ПЕРЕМИКАННЯ СЛУЖБИ (НОВА ПОШТА ЧЕРВОНА / УКРПОШТА ЖОВТА) З ПІДТРИМКОЮ МИТТЄВОГО ПЕРЕХОДУ 0ms (DIRECT TARGET)
  // ==========================================================================
  async function switchService(serviceName, explicitTargetQuery = null, directBranchTarget = null) {
    if (state.currentService === serviceName && !explicitTargetQuery && !directBranchTarget) return;

    // Детекція перемикання після неуспішного пошуку (Switch on Failure)
    if (lastSearchSession.query && !lastSearchSession.hasCopied && !lastSearchSession.abandonedTracked && currentInputSource !== 'history_card') {
      const elapsed = Date.now() - lastSearchSession.timestamp;
      if (elapsed >= 200 && elapsed < 45000) {
        trackClarityEvent('switch_after_unsuccessful_search');
        setClarityTag('switched_from_query', lastSearchSession.query.slice(0, 50));
        trackEvent('switch_after_unsuccessful_search', {
          search_term: lastSearchSession.query,
          from_service: state.currentService === 'novaposhta' ? 'NP' : 'UKR',
          to_service: serviceName === 'novaposhta' ? 'NP' : 'UKR',
          results_count: lastSearchSession.resultsCount
        });
        if (lastSearchSession.query.length >= 2) {
          logFailureTelemetry({
            query: lastSearchSession.query,
            service: state.currentService,
            status: '🟡 Перемикання після невдачі',
            resultsCount: lastSearchSession.resultsCount,
            duration: Math.max(1, Math.round(elapsed / 1000)),
            details: `Оператор перемкнувся на ${serviceName === 'novaposhta' ? 'Нову пошту' : 'Укрпошту'} після невдалого пошуку. Джерело: ${getSourceLabel(lastSearchSession.source || currentInputSource)}`
          });
        }
      }
    }

    state.currentService = serviceName;
    dom.body.setAttribute('data-service', serviceName);
    setClarityTag('service', serviceName === 'novaposhta' ? 'NP' : 'UKR');
    trackClarityEvent('switch_service_' + (serviceName === 'novaposhta' ? 'np' : 'ukr'));

    if (serviceName === 'novaposhta') {
      dom.btnNovaPoshta.classList.add('active');
      dom.btnNovaPoshta.setAttribute('aria-selected', 'true');
      dom.btnUkrposhta.classList.remove('active');
      dom.btnUkrposhta.setAttribute('aria-selected', 'false');

      dom.activeServiceTag.textContent = 'Нова пошта';
      dom.searchInput.placeholder = 'Наприклад: 47501, Бережани, Київ, Відділення 1, вул. Хрещатик...';
      dom.mapServiceTitle.textContent = 'Нова пошта';

      applyTypeFiltersVisibility();
    } else {
      dom.btnUkrposhta.classList.add('active');
      dom.btnUkrposhta.setAttribute('aria-selected', 'true');
      dom.btnNovaPoshta.classList.remove('active');
      dom.btnNovaPoshta.setAttribute('aria-selected', 'false');

      dom.activeServiceTag.textContent = 'Укрпошта';
      dom.searchInput.placeholder = 'Наприклад: 47501, Бережани, Київ 01001, Львів 79000, вул. Соборна...';
      dom.mapServiceTitle.textContent = 'Укрпошта';

      // Приховуємо фільтр «Поштомати» для Укрпошти (в Укрпошти немає поштоматів)
      applyTypeFiltersVisibility();

      // Скидаємо фільтр типів на 'all'
      state.typeFilter = 'all';
      updateTypeFilterUI();

      // Для Укрпошти за замовчуванням максимум 5 відділень
      state.displayLimit = 5;
      if (dom.limitSelector) {
        dom.limitSelector.querySelectorAll('.limit-btn').forEach(b => {
          if (b.getAttribute('data-limit') === '5') {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
      }

      // Динамічне ледаче завантаження повної бази Укрпошти (26 500+ індексів та відділень)
      await loadUkrposhtaBranchesIfNeeded();
      if (state.currentService === 'ukrposhta' && state.isMapVisible && state.leafletMap) {
        updateVisibleMarkersFromViewport();
      }
    }

    // ВАРІАНТ 1: МИТТЄВИЙ ПЕРЕХІД 0ms (DIRECT BRANCH HANDOFF)
    // Якщо цільове відділення вже відоме (наприклад, знайдено за індексом у розвилці або в картці),
    // не ганяємо важкий повнотекстовий пошук по 26 500 записах, а миттєво відкриваємо готову картку!
    if (directBranchTarget) {
      const cityClean = cleanSettlementName(directBranchTarget.city);
      const bIdx = directBranchTarget.index || directBranchTarget.postalCode || directBranchTarget.number || '';
      const fullGeoQuery = buildFullGeoQuery(directBranchTarget, bIdx);
      const displayQuery = explicitTargetQuery || fullGeoQuery || `${cityClean} ${bIdx}`.trim();

      state.searchQuery = displayQuery;
      dom.searchInput.value = displayQuery;
      state.lockedInputValue = displayQuery;
      dom.btnClearSearch.classList.remove('hidden');

      state.selectedBranch = directBranchTarget;
      state.selectedSettlement = {
        cleanName: cityClean,
        name: cityClean,
        cleanRaion: cleanRaionName(directBranchTarget.raion || ''),
        raion: cleanRaionName(directBranchTarget.raion || ''),
        cleanOblast: cleanOblastName(directBranchTarget.oblast || ''),
        oblast: cleanOblastName(directBranchTarget.oblast || ''),
        type: directBranchTarget.settlementType || 'місто'
      };
      state.currentResults = [directBranchTarget];

      if (dom.didYouMeanBox) dom.didYouMeanBox.classList.add('hidden');
      if (dom.crossServiceBanner) dom.crossServiceBanner.classList.add('hidden');
      closeAutocomplete();

      recordSearchHistory(displayQuery, 1);

      if (serviceName === 'ukrposhta' && (state.mapTypeFilter === 'cargo' || state.mapTypeFilter === 'postomat')) {
        state.mapTypeFilter = 'all';
      }
      updateTypeFilterUI();
      updateMapTypeFilterUI();

      renderSearchResults([directBranchTarget], displayQuery);

      if (dom.btnResetSelectedBranch) {
        dom.btnResetSelectedBranch.classList.remove('hidden');
      }

      if (state.isMapVisible) {
        if (directBranchTarget.lat && directBranchTarget.lng) {
          updateMapMarkers([directBranchTarget], directBranchTarget);
          if (state.leafletMap) {
            state.leafletMap.flyTo([directBranchTarget.lat, directBranchTarget.lng], 14, { duration: 1.0 });
          }
        } else {
          updateVisibleMarkersFromViewport();
        }
      }
      return;
    }

    // Сценарій 1 & 2: Розумний перенос населеного пункту або цільового запиту при зміні служби
    const currentInputVal = (dom.searchInput ? dom.searchInput.value : '').trim();
    let transferQuery = '';

    if (explicitTargetQuery) {
      transferQuery = explicitTargetQuery.trim();
    } else if (!currentInputVal) {
      // КРИТИЧНО: Якщо поле пошуку в поточній службі повністю порожнє (користувач стер текст або очистив поле),
      // заборонено воскрешати старий збережений запит або трансформувати попередній вибір!
      // Поле нової служби має залишатися абсолютно чистим і результати приховані!
      transferQuery = '';
      state.searchQuery = '';
      state.selectedBranch = null;
      state.selectedSettlement = null;
      state.lockedInputValue = null;
    } else if (state.selectedBranch && state.selectedBranch.city) {
      const b = state.selectedBranch;
      const cCity = cleanSettlementName(b.city);
      let cRaion = cleanRaionName(b.raion || b.district || b.SettlementRegionsDescription || '');
      let cObl = cleanOblastName(b.oblast || b.region || b.SettlementAreaDescription || '');
      if (cCity.toLowerCase() === 'київ' && (!cObl || cObl.toLowerCase() === 'київ')) {
        cObl = 'Київська';
      }
      if ((!cRaion || !cObl) && window.SmartSearchEngine) {
        const found = findSettlementInEngine(cCity, cObl);
        if (found) {
          if (!cObl && found.oblast) cObl = cleanOblastName(found.oblast);
          if (!cRaion && found.raion) cRaion = cleanRaionName(found.raion);
        }
      }
      const parts = [cCity];
      if (cRaion && cRaion.toLowerCase() !== cCity.toLowerCase()) parts.push(cRaion);
      if (cObl && cObl.toLowerCase() !== cCity.toLowerCase()) parts.push(cObl);
      transferQuery = parts.join(' ');
    } else if (state.selectedSettlement && (state.selectedSettlement.cleanName || state.selectedSettlement.name)) {
      const s = state.selectedSettlement;
      const cCity = cleanSettlementName(s.cleanName || s.name);
      let cRaion = cleanRaionName(s.cleanRaion || s.raion || '');
      let cObl = cleanOblastName(s.cleanOblast || s.oblast || '');
      if (cCity.toLowerCase() === 'київ' && (!cObl || cObl.toLowerCase() === 'київ')) {
        cObl = 'Київська';
      }
      const parts = [cCity];
      if (cRaion && cRaion.toLowerCase() !== cCity.toLowerCase()) parts.push(cRaion);
      if (cObl && cObl.toLowerCase() !== cCity.toLowerCase()) parts.push(cObl);
      transferQuery = parts.join(' ');
    } else if (currentInputVal) {
      // Очищаємо запит від специфічних слів (поштомат, відділення тощо), але зберігаємо всю географію
      let cleaned = currentInputVal
        .replace(/(?<!\p{L})(?:поштомат|відділення|склад|вантажне|укрпошта|нова\s*пошта|нп|уп)(?!\p{L})/giu, '')
        .replace(/\b\d{5}\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const tWords = cleaned.split(/\s+/).filter(Boolean);
      const uniqueWords = [];
      for (const w of tWords) {
        if (!uniqueWords.some(uw => uw.toLowerCase() === w.toLowerCase())) {
          uniqueWords.push(w);
        }
      }
      transferQuery = uniqueWords.join(' ');
    }

    state.selectedBranch = null;
    state.selectedSettlement = null;
    state.lockedInputValue = null;
    state.currentResults = [];
    if (dom.didYouMeanBox) dom.didYouMeanBox.classList.add('hidden');
    if (dom.crossServiceBanner) dom.crossServiceBanner.classList.add('hidden');

    if (transferQuery) {
      state.searchQuery = transferQuery;
      dom.searchInput.value = transferQuery;
      dom.btnClearSearch.classList.remove('hidden');
      await executeSearch(transferQuery, true, true);
    } else {
      state.searchQuery = '';
      dom.searchInput.value = '';
      dom.btnClearSearch.classList.add('hidden');
      if (dom.searchResultsSection) {
        dom.searchResultsSection.classList.add('hidden');
      }
      if (dom.btnResetSelectedBranch) {
        dom.btnResetSelectedBranch.classList.add('hidden');
      }
    }
    renderRecentHistory();

    if (serviceName === 'ukrposhta' && (state.mapTypeFilter === 'cargo' || state.mapTypeFilter === 'postomat')) {
      state.mapTypeFilter = 'all';
    }
    updateMapTypeFilterUI();

    if (state.isMapVisible) {
      if (state.currentResults && state.currentResults.length > 0) {
        updateMapMarkers(state.currentResults.slice(0, 20));
      } else {
        updateVisibleMarkersFromViewport();
      }
    }
  }

  // ==========================================================================
  // 2. ГУГЛ-ПОДІБНИЙ ПОШУКОВИЙ ДВИГУН (FUZZY SEARCH, АВТОВИПРАВЛЕННЯ, СИНТЕЗ)
  // ==========================================================================
  function getAllCurrentServiceBranches() {
    if (!window.BRANCHES_DATA) return [];
    return window.BRANCHES_DATA[state.currentService] || [];
  }

  // Кешування пулів за табами (postomat, cargo, branch) для виключення O(N) фільтрації на кожен запит
  const _tabPoolsCache = new WeakMap();

  function getTabFilteredPool(allStaticBranches, tabFilter) {
    if (!tabFilter || tabFilter === 'all' || !Array.isArray(allStaticBranches)) return allStaticBranches;
    let pools = _tabPoolsCache.get(allStaticBranches);
    if (!pools) {
      pools = {
        postomat: allStaticBranches.filter(isPostomatBranch),
        cargo: allStaticBranches.filter(isCargoBranch),
        branch: allStaticBranches.filter(b => !isPostomatBranch(b))
      };
      _tabPoolsCache.set(allStaticBranches, pools);
    }
    return pools[tabFilter] || allStaticBranches;
  }

  // O(1) швидкісний пошук населеного пункту через хеш-мапу рушія замість O(N) Array.find (з урахуванням області)
  function findSettlementInEngine(cityName, oblastName = '') {
    if (!cityName || !window.SmartSearchEngine) return null;
    if (typeof window.SmartSearchEngine.getSettlement === 'function') {
      const s = window.SmartSearchEngine.getSettlement(cityName, oblastName);
      if (s) return s;
    }
    if (Array.isArray(window.SmartSearchEngine.UKRAINE_SETTLEMENTS)) {
      const low = cityName.toLowerCase();
      const oblClean = oblastName ? cleanOblastName(oblastName).toLowerCase() : '';
      if (oblClean) {
        const oblExact = window.SmartSearchEngine.UKRAINE_SETTLEMENTS.find(s =>
          (s.name.toLowerCase() === low || (s.aliases && s.aliases.some(a => a.toLowerCase() === low))) &&
          s.oblast && s.oblast.toLowerCase().includes(oblClean)
        );
        if (oblExact) return oblExact;
      }
      return window.SmartSearchEngine.UKRAINE_SETTLEMENTS.find(s => s.name.toLowerCase() === low);
    }
    return null;
  }

  // Динамічне ледаче завантаження повної бази Укрпошти (data/ukrposhta_branches.json)
  let _ukrposhtaLoadingPromise = null;
  let _ukrposhtaLoaded = false;
  // Підготовлені у фоні (idle) дані Укрпошти: НЕ записуються у BRANCHES_DATA до першого перемикання,
  // тому поведінка пошуку не змінюється — лише прибирається затримка при першому кліку на таб.
  let _ukrposhtaPrepared = null;
  let _ukrposhtaPreparedSrc = null;

  // Мапінг сирих записів Укрпошти у формат відділень застосунку
  function mapUkrposhtaRaw(rawList) {
    return rawList.map(item => {
            const idx = String(item.index || item.number || item.postalCode || '');
            let obl = item.oblast || (item.region ? item.region.replace(/\s*обл\.?.*$/i, '').trim() : '');
            if (obl === 'Київ' || obl === 'м. Київ' || item.city === 'Київ' || item.city === 'м. Київ') {
              obl = 'Київська';
            }
            const rai = item.raion || (item.district ? item.district.replace(/\s*район.*$/i, '').trim() : '');
            const addr = item.address || item.street || `ВПЗ ${idx}`;
            const isCentr = item.type === 'central' || idx.endsWith('000') || idx.endsWith('001') || idx.endsWith('00');
            return {
              id: item.id || `up-${idx}`,
              index: idx,
              number: idx,
              postalCode: idx,
              city: item.city,
              type: item.type || (isCentr ? 'central' : 'standard'),
              typeText: item.typeText || (isCentr ? 'Центральне відділення' : (item.name && item.name.includes('Міське') ? 'Міське відділення' : "Відділення зв'язку")),
              name: item.name || `Відділення зв'язку (${idx})`,
              street: addr,
              address: addr,
              oblast: obl,
              raion: rai,
              district: rai,
              region: item.region || (obl ? `${obl} обл.` : ''),
              lat: item.lat || 0,
              lng: item.lng || 0,
              isAccessible: item.isAccessible ?? true,
              hasGenerator: item.hasGenerator ?? true
            };
    });
  }

  async function loadUkrposhtaBranchesIfNeeded() {
    if (!window.BRANCHES_DATA) window.BRANCHES_DATA = {};
    if (_ukrposhtaLoaded || (Array.isArray(window.BRANCHES_DATA.ukrposhta) && window.BRANCHES_DATA.ukrposhta.length > 100)) {
      _ukrposhtaLoaded = true;
      return window.BRANCHES_DATA.ukrposhta;
    }
    if (_ukrposhtaLoadingPromise) {
      return _ukrposhtaLoadingPromise;
    }

    _ukrposhtaLoadingPromise = (async () => {
      _ukrposhtaLoaded = true;
      try {
        let rawList = (typeof window !== 'undefined' && Array.isArray(window.UKRPOSHTA_BRANCHES_DATA) && window.UKRPOSHTA_BRANCHES_DATA.length > 0)
          ? window.UKRPOSHTA_BRANCHES_DATA
          : null;
        if (!rawList && typeof window !== 'undefined' && window.location && typeof window.location.origin === 'string' && window.location.origin.startsWith('http')) {
          try {
            const resp = await fetch('data/ukrposhta_branches.json');
            if (resp.ok) {
              const parsed = await resp.json();
              if (Array.isArray(parsed)) rawList = parsed;
            }
          } catch (_) {}
        }
        if (!Array.isArray(rawList) && typeof require === 'function') {
          try {
            const fs = require('fs');
            const path = require('path');
            const candidatePaths = [
              path.join(typeof process !== 'undefined' && process.cwd ? process.cwd() : '.', 'data/ukrposhta_branches.json'),
              typeof __dirname !== 'undefined' ? path.resolve(__dirname, 'data/ukrposhta_branches.json') : null,
              typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../data/ukrposhta_branches.json') : null,
              './data/ukrposhta_branches.json'
            ].filter(Boolean);

            for (const cp of candidatePaths) {
              if (fs.existsSync(cp)) {
                rawList = JSON.parse(fs.readFileSync(cp, 'utf8'));
                break;
              }
            }
          } catch (_) {}
        }

        if (Array.isArray(rawList) && rawList.length > 0) {
          const mapped = (_ukrposhtaPrepared && _ukrposhtaPreparedSrc === rawList) ? _ukrposhtaPrepared : mapUkrposhtaRaw(rawList);

          window.BRANCHES_DATA.ukrposhta = mapped;
          if (window.SmartSearchEngine && typeof window.SmartSearchEngine.buildBranchIndex === 'function') {
            window.SmartSearchEngine.buildBranchIndex(mapped);
          }
          if (typeof window !== 'undefined' && window.UKRPOSHTA_BRANCHES_DATA === rawList) {
            window.UKRPOSHTA_BRANCHES_DATA = null;
          }
          _ukrposhtaPrepared = null;
          _ukrposhtaPreparedSrc = null;
          return mapped;
        }
      } catch (e) {
        console.error('Помилка завантаження бази Укрпошти:', e);
      }
      return window.BRANCHES_DATA.ukrposhta || [];
    })();

    return _ukrposhtaLoadingPromise;
  }

  // Допоміжний таймаут-сигнал для зовнішніх мережевих запитів (захист від зависання на повільному 3G/Edge)
  function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    const controller = new AbortController();
    const extSignal = options.signal;
    if (extSignal) {
      if (extSignal.aborted) {
        controller.abort();
      } else {
        extSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  // Резервне динамічне отримання відділення Укрпошти за 5-значним індексом з офіційного API
  async function fetchUkrposhtaBranchLive(postalCode) {
    if (!postalCode || !/^\d{5}$/.test(postalCode)) return null;
    try {
      const resp = await fetchWithTimeout(`https://index.ukrposhta.ua/endpoints-for-apps/index.php?method=get_postoffices_by_postindex_web&pc=${postalCode}`, {}, 5000);
      if (!resp.ok) return null;
      const data = await resp.json();
      const entry = data.Entry || (data.Entries && data.Entries.Entry);
      const item = Array.isArray(entry) ? entry[0] : entry;
      if (item && item.POSTINDEX) {
        const idx = String(item.POSTINDEX);
        const obl = (item.REGION_UA || '').trim();
        const rai = (item.DISTRICT_UA || '').trim();
        const addr = item.ADDRESS || `ВПЗ ${idx}`;
        const isCentr = item.TYPE_SHORT === 'Центральне' || idx.endsWith('000') || idx.endsWith('001') || idx.endsWith('00');
        const branchObj = {
          id: `up-${idx}`,
          index: idx,
          number: idx,
          postalCode: idx,
          city: item.CITY_UA,
          type: isCentr ? 'central' : 'standard',
          typeText: item.TYPE_SHORT || (isCentr ? 'Центральне відділення' : (item.PO_SHORT && item.PO_SHORT.includes('Міське') ? 'Міське відділення' : "Відділення зв'язку")),
          name: (item.TYPE_SHORT || "Відділення зв'язку") + ' №' + idx,
          street: addr,
          address: addr,
          oblast: obl,
          raion: rai,
          district: rai,
          region: obl ? `${obl} обл.` : '',
          lat: parseFloat(item.LATTITUDE) || 0,
          lng: parseFloat(item.LONGITUDE) || 0,
          phone: item.PHONE || '+380-800-300-545',
          isAccessible: true,
          hasGenerator: true
        };
        if (!window.BRANCHES_DATA) window.BRANCHES_DATA = {};
        if (!Array.isArray(window.BRANCHES_DATA.ukrposhta)) window.BRANCHES_DATA.ukrposhta = [];
        window.BRANCHES_DATA.ukrposhta.push(branchObj);
        if (window.SmartSearchEngine && typeof window.SmartSearchEngine.buildBranchIndex === 'function') {
          window.SmartSearchEngine.buildBranchIndex(window.BRANCHES_DATA.ukrposhta);
        }
        return branchObj;
      }
    } catch (_) {}
    return null;
  }

  // ==========================================================================
  // WEB WORKER SEARCH BRIDGE (Фоновий асинхронний пошук поза Main Thread)
  // ==========================================================================
  const SearchWorkerBridge = (() => {
    let worker = null;
    let isReady = false;
    let requestId = 0;
    const pendingCallbacks = new Map();

    function init() {
      if (typeof window === 'undefined' || typeof window.Worker !== 'function') return;
      // Захист від CORS-винятку при відкритті через file://
      if (window.location && window.location.protocol === 'file:') return;

      try {
        worker = new Worker('worker/search.worker.js?v=' + APP_VERSION);
        worker.onmessage = function (e) {
          const data = e.data;
          if (!data) return;
          if (data.type === 'WORKER_READY') {
            isReady = true;
            return;
          }
          if (data.id && pendingCallbacks.has(data.id)) {
            const cb = pendingCallbacks.get(data.id);
            pendingCallbacks.delete(data.id);
            cb(null, data);
          }
        };
        worker.onerror = function (err) {
          console.warn('[SearchWorkerBridge] Worker вимкнено через помилку:', err);
          isReady = false;
          worker = null;
        };
      } catch (err) {
        console.warn('[SearchWorkerBridge] Web Worker не вдалося ініціалізувати:', err);
        worker = null;
      }
    }

    function isAvailable() {
      return Boolean(worker && isReady);
    }

    function searchAsync(query, service) {
      if (!isAvailable()) return Promise.resolve(null);
      const id = ++requestId;
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            resolve(null);
          }
        }, 2000);
        pendingCallbacks.set(id, (err, res) => {
          clearTimeout(timeout);
          if (err || !res) resolve(null);
          else resolve(res);
        });
        worker.postMessage({ id, type: 'SEARCH', query, service });
      });
    }

    function autocompleteAsync(query, service) {
      if (!isAvailable()) return Promise.resolve(null);
      const id = ++requestId;
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            resolve(null);
          }
        }, 1500);
        pendingCallbacks.set(id, (err, res) => {
          clearTimeout(timeout);
          if (err || !res) resolve(null);
          else resolve(res.suggestions);
        });
        worker.postMessage({ id, type: 'AUTOCOMPLETE', query, service });
      });
    }

    return {
      init,
      isAvailable,
      searchAsync,
      autocompleteAsync
    };
  })();

  // Попереднє розігрівання O(1) індексів пошуку при завантаженні (Zero Input Latency < 16ms)
  function prewarmBranchIndices() {
    SearchWorkerBridge.init();
    if (!window.BRANCHES_DATA || !window.SmartSearchEngine) return;
    if (typeof window.SmartSearchEngine.buildBranchIndex === 'function') {
      if (Array.isArray(window.BRANCHES_DATA.novaposhta)) {
        window.SmartSearchEngine.buildBranchIndex(window.BRANCHES_DATA.novaposhta);
        getTabFilteredPool(window.BRANCHES_DATA.novaposhta, 'postomat');
        getTabFilteredPool(window.BRANCHES_DATA.novaposhta, 'cargo');
        getTabFilteredPool(window.BRANCHES_DATA.novaposhta, 'branch');
      }
    }

    // Фонове розігрівання пулів міст, районів та автокомпліту під час очікування (requestIdleCallback),
    // щоб перший натиск клавіші користувача відпрацьовував за < 10 мс без зависань (Zero Jutter)
    const prewarmSearchCachesIdle = () => {
      try {
        const eng = window.SmartSearchEngine;
        if (!eng) return;
        const npPool = window.BRANCHES_DATA && window.BRANCHES_DATA.novaposhta;
        if (Array.isArray(npPool) && npPool.length > 0) {
          if (typeof eng.getCityBranchesFromPool === 'function') {
            eng.getCityBranchesFromPool(npPool, 'київ');
          }
          if (typeof eng.extractFacets === 'function') {
            eng.extractFacets('київ');
          }
          if (typeof eng.getAutocompleteSuggestions === 'function') {
            eng.getAutocompleteSuggestions('ки', 'novaposhta', null, npPool);
          }
        }
      } catch (_) {}
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(prewarmSearchCachesIdle, { timeout: 1000 });
    } else {
      setTimeout(prewarmSearchCachesIdle, 50);
    }

    // Фонове прогрівання бази Укрпошти (мапінг 26 500 записів + індекс), щоб перше перемикання
    // на таб «Укрпошта» було миттєвим. Той самий шлях, що й при кліку на таб, лише раніше.
    const preloadUkrposhtaIdle = () => {
      try {
        if (_ukrposhtaLoaded || _ukrposhtaPrepared) return;
        const raw = window.UKRPOSHTA_BRANCHES_DATA;
        if (!Array.isArray(raw) || raw.length === 0) return;
        const mapped = mapUkrposhtaRaw(raw);
        if (window.SmartSearchEngine && typeof window.SmartSearchEngine.buildBranchIndex === 'function') {
          window.SmartSearchEngine.buildBranchIndex(mapped);
        }
        _ukrposhtaPreparedSrc = raw;
        _ukrposhtaPrepared = mapped;
      } catch (_) {}
    };
    setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(preloadUkrposhtaIdle, { timeout: 3000 });
      } else {
        preloadUkrposhtaIdle();
      }
    }, 1500);
  }

  // Кеш у пам'яті для відділень Нової пошти (швидкодія + збереження завантажених міст)
  const liveWarehousesCache = {
    novaposhta: new Map()
  };

  // Кеш точних фізичних адрес відділень Укрпошти (RAM + LocalStorage)
  const _ukrposhtaAddressCache = new Map();

  async function fetchLiveUkrposhtaAddress(branch, element = null) {
    if (!branch) return null;
    const pc = String(branch.postalCode || branch.index || branch.number || '').trim();
    if (pc.length !== 5 || !/^\d{5}$/.test(pc)) return null;

    if (_ukrposhtaAddressCache.has(pc)) {
      const cached = _ukrposhtaAddressCache.get(pc);
      applyUkrposhtaAddress(branch, cached, element);
      return cached;
    }

    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(`up_addr_${pc}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.address) {
            _ukrposhtaAddressCache.set(pc, parsed);
            applyUkrposhtaAddress(branch, parsed, element);
            return parsed;
          }
        }
      }
    } catch (_) {}

    try {
      const url = `https://index.ukrposhta.ua/endpoints-for-apps/index.php?method=get_postoffices_by_postindex_web&pc=${pc}`;
      const resp = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, 5000);
      if (!resp.ok) return null;
      const json = await resp.json();
      const entry = json.Entry || (json.Entries && json.Entries.Entry);
      const item = Array.isArray(entry) ? entry[0] : entry;
      if (item && item.ADDRESS && typeof item.ADDRESS === 'string' && item.ADDRESS.trim()) {
        const realAddr = item.ADDRESS.trim();
        const info = {
          address: realAddr,
          phone: item.PHONE || '',
          name: item.PO_SHORT || item.PO_LONG || '',
          lat: parseFloat(item.LATTITUDE) || 0,
          lng: parseFloat(item.LONGITUDE) || 0
        };
        _ukrposhtaAddressCache.set(pc, info);
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`up_addr_${pc}`, JSON.stringify(info));
          }
        } catch (_) {}
        applyUkrposhtaAddress(branch, info, element);
        return info;
      }
    } catch (_) {}
    return null;
  }

  function applyUkrposhtaAddress(branch, data, element = null) {
    if (!branch || !data || !data.address) return;
    branch.address = data.address;
    branch.street = data.address;
    delete branch._cleanStreet;
    if (data.lat && data.lng) {
      branch.lat = data.lat;
      branch.lng = data.lng;
    }
    const cleanStreet = getCleanStreet(branch);

    if (element) {
      const streetHighlight = element.querySelector('.street-highlight');
      if (streetHighlight) {
        streetHighlight.textContent = cleanStreet;
      }
      const streetPart = element.querySelector('.street-part');
      if (streetPart) {
        streetPart.textContent = cleanStreet;
      }
      const primaryLine = element.querySelector('.card-primary-line');
      if (primaryLine) {
        let sType = branch.settlementType || 'місто';
        primaryLine.setAttribute('title', `${sType} ${branch.city || ''} - Відділення №${branch.number || branch.postalCode}: ${cleanStreet}`);
      }
      const btnShort = element.querySelector('.btn-copy-short');
      if (btnShort) {
        btnShort.setAttribute('data-copy', formatClassicCopyString(branch));
      }
      const btnDetailed = element.querySelector('.btn-copy-detailed');
      if (btnDetailed) {
        btnDetailed.setAttribute('data-copy', formatDetailedCopyString(branch));
      }
    }
  }

  let activeSearchAbortController = null;

  // Прямий запит до офіційного API Нової пошти (через локальний проксі на localhost або прямий CORS API на хостингу)
  async function queryNovaPoshtaApi(modelName, calledMethod, methodProperties, signal = null) {
    const requestPayload = {
      apiKey: state.apiKeyNP || '',
      modelName: modelName,
      calledMethod: calledMethod,
      methodProperties: methodProperties
    };

    let rawData = null;
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // 1. Якщо локальний dev (localhost) — використовуємо серверний проксі server.py
    if (isLocal) {
      try {
        const response = await fetchWithTimeout('/api/novaposhta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: signal
        }, 5000);
        if (response.ok) {
          rawData = await response.json();
        }
      } catch (e) {
        if (e.name === 'AbortError' && signal && signal.aborted) return null;
      }
    }

    // 2. Якщо хостинг (GitHub Pages тощо) або локальний проксі не відповів — викликаємо прямий CORS API Нової пошти миттєво!
    if (!rawData || !rawData.success) {
      try {
        const response = await fetchWithTimeout('https://api.novaposhta.ua/v2.0/json/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
          signal: signal
        }, 5000);
        if (response.ok) {
          rawData = await response.json();
        }
      } catch (e) {
        if (e.name === 'AbortError') return null;
        console.warn('Прямий виклик API Нової пошти не вдався:', e);
      }
    }

    if (rawData && rawData.success && Array.isArray(rawData.data)) {
      return rawData.data;
    }
    return null;
  }

  // Отримання повного списку відділень для будь-якого населеного пункту України (з 2-рівневим кешуванням RAM + SessionStorage)
  async function fetchLiveNovaPoshta(cityName, signal = null) {
    if (!cityName) return null;
    let normalizedCity = cityName.trim();
    if (window.SmartSearchEngine) {
      normalizedCity = window.SmartSearchEngine.normalizeLocativeCase(normalizedCity);
      const found = findSettlementInEngine(normalizedCity);
      if (found) normalizedCity = found.name;
    }

    const cacheKey = normalizedCity.toLowerCase();
    
    // Рівень 1: Швидкісний RAM Cache (0 ms)
    if (liveWarehousesCache.novaposhta.has(cacheKey)) {
      return liveWarehousesCache.novaposhta.get(cacheKey);
    }

    // Рівень 2: Швидкісний SessionStorage Cache (0 ms, зберігається між оновленнями сторінки)
    try {
      const sessKey = 'np_cache_' + encodeURIComponent(cacheKey);
      const cachedStr = sessionStorage.getItem(sessKey);
      if (cachedStr) {
        const parsedCached = JSON.parse(cachedStr);
        if (Array.isArray(parsedCached) && parsedCached.length > 0) {
          liveWarehousesCache.novaposhta.set(cacheKey, parsedCached);
          return parsedCached;
        }
      }
    } catch (e) {}

    // Крок 1: Отримуємо можливі форми назви населеного пункту (називний відмінок, множина, однина, тощо)
    const candidates = window.SmartSearchEngine && window.SmartSearchEngine.getCandidateCityForms
      ? window.SmartSearchEngine.getCandidateCityForms(normalizedCity)
      : [normalizedCity];

    let rawWarehouses = [];
    let settlements = [];

    // Шукаємо серед адрес/населених пунктів Nova Poshta
    for (const cand of candidates) {
      const sRes = await queryNovaPoshtaApi('Address', 'searchSettlements', {
        CityName: cand,
        Limit: '5'
      }, signal);

      if (sRes && sRes.length > 0 && sRes[0].Addresses && sRes[0].Addresses.length > 0) {
        const cLower = cand.toLowerCase().trim();
        const validAddresses = sRes[0].Addresses.filter(a => {
          const main = (a.MainDescription || a.Present || '').toLowerCase();
          return main.includes(cLower) || cLower.includes(main);
        });
        if (validAddresses.length > 0) {
          settlements = validAddresses;
          break;
        }
      }
    }

    // Якщо знайшли населені пункти через searchSettlements (особливо для сіл, смт або однойменних міст у різних областях)
    if (settlements.length > 0) {
      // Беремо топ-4 співпадіння (наприклад, однойменні села чи селища у різних областях)
      for (const s of settlements.slice(0, 4)) {
        const cityRef = s.DeliveryCity || s.Ref;
        if (cityRef) {
          const wList = await queryNovaPoshtaApi('AddressGeneral', 'getWarehouses', {
            CityRef: cityRef,
            Limit: '300'
          }, signal);
          if (wList && wList.length > 0) {
            // Збагачуємо інформацією про область та район з settlement якщо вони відсутні
            const enriched = wList.map(w => {
              if (!w.SettlementAreaDescription && s.Area) w.SettlementAreaDescription = s.Area;
              if (!w.SettlementRegionsDescription && s.Region) w.SettlementRegionsDescription = s.Region;
              if (!w.SettlementTypeDescription && s.SettlementTypeCode) {
                w.SettlementTypeDescription = s.SettlementTypeCode === 'м.' ? 'місто' : (s.SettlementTypeCode === 'смт' ? 'селище' : 'село');
              }
              return w;
            });
            rawWarehouses = rawWarehouses.concat(enriched);
          }
        }
      }
    }

    // Якщо через searchSettlements не знайдено, спробуємо прямий виклик getWarehouses за формою міста
    if (!rawWarehouses || rawWarehouses.length === 0) {
      for (const cand of candidates) {
        const directList = await queryNovaPoshtaApi('AddressGeneral', 'getWarehouses', {
          CityName: cand,
          Limit: '300'
        }, signal);
        if (directList && directList.length > 0) {
          rawWarehouses = directList;
          break;
        }
      }
    }

    if (!rawWarehouses || rawWarehouses.length === 0) {
      return null;
    }

    const branches = rawWarehouses.map(item => {
      const totalWeight = parseFloat(item.TotalMaxWeightAllowed) || 0;
      const placeWeight = parseFloat(item.PlaceMaxWeightAllowed) || 0;
      const desc = item.Description || '';
      const isPostomat = item.CategoryOfWarehouse === 'Postomat' || desc.toLowerCase().includes('поштомат');
      let maxWeight = Math.max(totalWeight, placeWeight);
      const isUnder30 = (maxWeight > 0 && maxWeight <= 30) || /(?:до\s*(?:5|10|15|20|30)\s*кг|приймання-видачі)/i.test(desc);
      const isCargo = !isPostomat && !isUnder30 && (totalWeight >= 1000 || placeWeight >= 1000 || item.CategoryOfWarehouse === 'Cargo' || desc.toLowerCase().includes('вантажне'));

      if (maxWeight === 0) {
        maxWeight = isCargo ? 1100 : 30;
      }
      const isPickup = maxWeight <= 10 || desc.toLowerCase().includes('приймання-видачі');

      let typeName, typeBadge, typeClass;
      if (isPostomat) {
        typeName = 'Поштомат';
        typeBadge = 'Поштомат (до 20 кг)';
        typeClass = 'poshtomat';
      } else if (isCargo) {
        typeName = 'Вантажне(ий)';
        typeBadge = `Вантажне (до ${maxWeight >= 1000 ? maxWeight : 1100} кг)`;
        typeClass = 'cargo';
      } else if (isPickup) {
        typeName = 'Пункт приймання-видачі';
        typeBadge = `Пункт приймання-видачі (до ${maxWeight || 10} кг)`;
        typeClass = 'pickup';
      } else {
        typeName = 'Поштове';
        typeBadge = `Поштове (до ${maxWeight || 30} кг)`;
        typeClass = 'post';
      }

      let street = '';
      if (desc.includes(':')) {
        street = desc.split(':')[1].trim();
      } else if (item.ShortAddress) {
        street = item.ShortAddress.replace(new RegExp(`^${item.CityDescription || cityName}[,\\s]*`, 'i'), '').trim();
      } else {
        street = desc;
      }

      const branchObj = {
        id: 'np-live-' + item.Ref,
        city: item.CityDescription || normalizedCity || cityName,
        settlementType: item.SettlementTypeDescription || 'місто',
        oblast: item.SettlementAreaDescription || '',
        raion: item.SettlementRegionsDescription || '',
        postalCode: item.PostalCodeUA || '',
        number: item.Number,
        name: desc,
        street: street,
        address: item.ShortAddress || street,
        maxWeight: maxWeight,
        typeName: typeName,
        typeText: typeBadge,
        typeClass: typeClass,
        lat: parseFloat(item.Latitude) || 50.0650,
        lng: parseFloat(item.Longitude) || 31.4450,
        isLiveApi: true
      };
      if (window.SmartSearchEngine && window.SmartSearchEngine.buildNormalizedSearchText) {
        branchObj.normalizedSearchText = window.SmartSearchEngine.buildNormalizedSearchText(branchObj);
      }
      return branchObj;
    });

    liveWarehousesCache.novaposhta.set(cacheKey, branches);
    try {
      const sessKey = 'np_cache_' + encodeURIComponent(cacheKey);
      sessionStorage.setItem(sessKey, JSON.stringify(branches));
    } catch (e) {}

    return branches;
  }

  let suppressNextFocusActivation = false;

  // Утиліта фокусування поля пошуку з встановленням курсору в самий кінець (після назви міста/слова)
  function focusSearchInputAtEnd(appendSpace = true) {
    if (!dom.searchInput) return;
    if (appendSpace && dom.searchInput.value && !dom.searchInput.value.endsWith(' ')) {
      dom.searchInput.value += ' ';
    }
    dom.btnClearSearch.classList.remove('hidden');
    suppressNextFocusActivation = true;
    if (!(dom.searchInput.dataset && dom.searchInput.dataset.demoTyping === '1')) {
      dom.searchInput.focus({ preventScroll: true });
    }
    suppressNextFocusActivation = false;
    const len = dom.searchInput.value.length;
    dom.searchInput.setSelectionRange(len, len);
  }

  /**
   * Шукає відділення в альтернативній службі (Укрпошта <-> Нова пошта)
   * для розпізнаного населеного пункту або 5-значного поштового індексу у запиті.
   */
  function findAlternativeServiceBranchForQuery(targetSettlement, rawQuery) {
    const altService = state.currentService === 'novaposhta' ? 'ukrposhta' : 'novaposhta';
    const pcMatch = (rawQuery || '').match(/\b(\d{5})\b/);
    const engine = window.SmartSearchEngine;

    if (targetSettlement) {
      const sName = cleanSettlementName(targetSettlement.cleanName || targetSettlement.name || '');
      const sRaion = cleanRaionName(targetSettlement.cleanRaion || targetSettlement.raion || '');
      const sOblast = cleanOblastName(targetSettlement.cleanOblast || targetSettlement.oblast || '');

      let altBranch = null;
      if (altService === 'ukrposhta') {
        if (engine && typeof engine.getUkrposhtaBranchesForSettlement === 'function') {
          const upBranches = engine.getUkrposhtaBranchesForSettlement(sName, sOblast, sRaion);
          if (upBranches && upBranches.length > 0) {
            altBranch = upBranches[0];
          }
        }
        if (!altBranch) {
          const upList = (typeof window !== 'undefined' && window.BRANCHES_DATA && Array.isArray(window.BRANCHES_DATA.ukrposhta))
            ? window.BRANCHES_DATA.ukrposhta
            : null;
          if (upList) {
            const cName = canonCity(sName);
            const sObl = sOblast.toLowerCase().slice(0, 4);
            const sRai = sRaion.toLowerCase();
            altBranch = upList.find(b => {
              if ((b._canonCity || canonCity(b.city)) !== cName) return false;
              const bObl = (b.oblast || b.region || '').toLowerCase();
              const bRai = (b.raion || b.district || '').toLowerCase();
              if (sObl && !bObl.includes(sObl)) return false;
              if (sRai && !bRai.includes(sRai.slice(0, 4)) && !areRaionsCompatible(sRai, bRai)) return false;
              return true;
            });
          }
        }
        if (!altBranch && pcMatch && engine && typeof engine.getUkrposhtaBranchByIndex === 'function') {
          altBranch = engine.getUkrposhtaBranchByIndex(pcMatch[1]);
        }
        if (altBranch) {
          const idx = altBranch.index || altBranch.postalCode || altBranch.number || '';
          return {
            service: 'ukrposhta',
            branch: altBranch,
            index: idx ? String(idx) : null,
            number: altBranch.number ? String(altBranch.number) : null
          };
        }
      } else {
        const npList = (typeof window !== 'undefined' && window.BRANCHES_DATA && Array.isArray(window.BRANCHES_DATA.novaposhta))
          ? window.BRANCHES_DATA.novaposhta
          : null;
        if (npList) {
          const cName = canonCity(sName);
          const sObl = sOblast.toLowerCase().slice(0, 4);
          const sRai = sRaion.toLowerCase();
          altBranch = npList.find(b => {
            if ((b._canonCity || canonCity(b.city)) !== cName) return false;
            const bObl = (b.oblast || '').toLowerCase();
            const bRai = (b.raion || '').toLowerCase();
            if (sObl && !bObl.includes(sObl)) return false;
            if (sRai && !bRai.includes(sRai.slice(0, 4)) && !areRaionsCompatible(sRai, bRai)) return false;
            return true;
          });
        }
        if (altBranch) {
          const num = altBranch.number || altBranch.postalCode || altBranch.index || '';
          return {
            service: 'novaposhta',
            branch: altBranch,
            index: altBranch.index ? String(altBranch.index) : null,
            number: num ? String(num) : null
          };
        }
      }
    }

    if (altService === 'ukrposhta' && pcMatch && engine && typeof engine.getUkrposhtaBranchByIndex === 'function') {
      const directUp = engine.getUkrposhtaBranchByIndex(pcMatch[1]);
      if (directUp) {
        const idx = directUp.index || directUp.postalCode || pcMatch[1];
        return {
          service: 'ukrposhta',
          branch: directUp,
          index: String(idx),
          number: directUp.number ? String(directUp.number) : null
        };
      }
    }

    return null;
  }

  async function executeSearch(query, shouldRecordAnalytics = true, isExplicitSubmit = false, allowSingleAutoSelect = true) {
    try {
      const rawQuery = (query || '').trim().replace(/\s+/g, ' ');
      if (!rawQuery) return;

      if (state.currentService === 'ukrposhta' && !_ukrposhtaLoaded) {
        await loadUkrposhtaBranchesIfNeeded();
      }

      // Скасовуємо попередній незавершений запит для миттєвої швидкодії
      if (activeSearchAbortController) {
        activeSearchAbortController.abort();
      }
      activeSearchAbortController = new AbortController();
      const currentSignal = activeSearchAbortController.signal;

    state.searchQuery = rawQuery;
    state.selectedBranch = null;
    closeAutocomplete();
    if (dom.btnResetSelectedBranch) {
      dom.btnResetSelectedBranch.classList.add('hidden');
    }
    if (dom.searchInput) {
      if (isExplicitSubmit) {
        if (!dom.searchInput.value || !dom.searchInput.value.trim() || dom.searchInput.value.startsWith(' ') || dom.searchInput.value.trim() !== rawQuery) {
          dom.searchInput.value = rawQuery;
        }
      } else if (!dom.searchInput.value || !dom.searchInput.value.trim()) {
        dom.searchInput.value = rawQuery;
      }
    }
    dom.btnClearSearch.classList.remove('hidden');

    const engine = window.SmartSearchEngine;
    const parsed = engine ? engine.parseQuery(rawQuery) : {
      rawQuery,
      cleanQuery: rawQuery.toLowerCase(),
      isLayoutFixed: false,
      targetBranchNumber: null,
      isPostomat: false,
      postalCode: null,
      detectedOblast: null,
      detectedRaion: null,
      detectedStreet: null,
      matchedSettlement: null,
      confidence: 0,
      didYouMeanText: null
    };

    const isNP = state.currentService === 'novaposhta';
    let results = [];
    let allCityBranches = [];
    let didYouMeanText = parsed.didYouMeanText;
    let didYouMeanData = parsed.didYouMean;

    const hasStreetInQuery = Boolean(
      (parsed.detectedStreet && !parsed.detectedStreet.toLowerCase().includes(canonCity(parsed.matchedSettlement ? parsed.matchedSettlement.name : ''))) ||
      (engine && engine.extractFacets && (engine.extractFacets(rawQuery).streetTokens || []).some(t => !engine.isOblastToken(t) && t !== canonCity(parsed.matchedSettlement ? parsed.matchedSettlement.name : '')))
    );

    // Встановлення відповідного фільтру типів за ключовими словами
    if (/(?:вантажне|вантажний|вантаж)/i.test(rawQuery)) {
      state.typeFilter = 'cargo';
      updateTypeFilterUI();
    } else if (/(?<!\p{L})(?:поштомат|поштомата|поштомати|почтомат|п\/м|пм)(?!\p{L})/iu.test(rawQuery)) {
      state.typeFilter = 'postomat';
      updateTypeFilterUI();
    } else if (/(?<!\p{L})(?:відділення|відділ|вд|склад)(?!\p{L})/iu.test(rawQuery)) {
      state.typeFilter = 'all';
      updateTypeFilterUI();
    } else if (state.typeFilter !== 'all' && !parsed.targetBranchNumber && !parsed.isPostomat) {
      // При пошуку нового населеного пункту (без прямої вказівки номера/типу), скидаємо попередній таб на \"Всі\",
      // щоб не залишатися випадково в режимі \"Поштомати\" чи \"Вантажні\"!
      state.typeFilter = 'all';
      updateTypeFilterUI();
    }

    // 1. УНІВЕРСАЛЬНИЙ ПОШУК ЗА ПЕРЕДНОРМАЛІЗОВАНИМ ЗНАЧЕННЯМ (CI/CD OFFLINE ІНДЕКС)
    // Фоновий Web Worker для 0 мс затримки та нуль навантаження на Main Thread
    const allStaticBranches = getAllCurrentServiceBranches();
    let staticMatches = [];
    let workerResult = null;
    if (SearchWorkerBridge.isAvailable()) {
      workerResult = await SearchWorkerBridge.searchAsync(rawQuery, state.currentService);
      if (currentSignal.aborted) return;
      if (workerResult && Array.isArray(workerResult.staticMatches)) {
        staticMatches = workerResult.staticMatches;
      }
    }
    if (!workerResult && engine && allStaticBranches.length > 0) {
      // Резервний синхронний пошук, якщо Web Worker недоступний або ініціалізується
      staticMatches = engine.filterBranchesByNormalizedSearch(rawQuery, allStaticBranches, null);
    }

    // Якщо зафіксовано точний населений пункт або в запиті є область чи район — фільтруємо за гео-контекстом
    if (state.selectedSettlement) {
      const selName = canonCity(state.selectedSettlement.cleanName);
      const queryCanon = canonCity(rawQuery);
      if (!queryCanon.startsWith(selName) && (!parsed.matchedSettlement || canonCity(parsed.matchedSettlement.name) !== selName)) {
        state.selectedSettlement = null;
      }
      if (state.selectedSettlement) {
        const queryRaion = parsed.detectedRaion || (parsed.facets && parsed.facets.raion);
        const selRaion = state.selectedSettlement.cleanRaion || state.selectedSettlement.raion;
        if (queryRaion && selRaion && !areRaionsCompatible(queryRaion, selRaion)) {
          state.selectedSettlement = null;
        }
      }
      if (state.selectedSettlement) {
        const isSmtQuery = /(?<!\p{L})(?:смт|селище міського типу|селище|сел\.?)(?!\p{L})/iu.test(rawQuery);
        const isSeloQuery = /(?<!\p{L})(?:село|с\.)(?!\p{L})/iu.test(rawQuery);
        const isMistoQuery = /(?<!\p{L})(?:місто|м\.)(?!\p{L})/iu.test(rawQuery);
        const selType = (state.selectedSettlement.type || '').toLowerCase();
        if (isSmtQuery && (selType === 'село' || selType === 'місто')) {
          state.selectedSettlement = null;
        } else if (isSeloQuery && (selType.includes('селище') || selType === 'смт' || selType === 'місто')) {
          state.selectedSettlement = null;
        } else if (isMistoQuery && selType !== 'місто') {
          state.selectedSettlement = null;
        }
      }
    }
    const activeSettlement = state.selectedSettlement || parsed.matchedSettlement;
    if (activeSettlement) {
      const selName = canonCity(activeSettlement.cleanName || activeSettlement.name);
      const selObl = cleanOblastName(activeSettlement.cleanOblast || activeSettlement.oblast || '').toLowerCase().slice(0, 4);
      // КРИТИЧНО: Фільтруємо за районом ВИКЛЮЧНО якщо користувач явно вказав район у запиті
      // (через parsed.detectedRaion / parsed.facets.raion) або явно обрав населений пункт зі списку (state.selectedSettlement).
      // Якщо район не вказувався (напр. "київ щасливе 1"), заборонено відсікати відділення однойменних сіл у різних районах цієї області!
      const explicitRaion = state.selectedSettlement
        ? (state.selectedSettlement.cleanRaion || state.selectedSettlement.raion)
        : (parsed.detectedRaion || (parsed.facets && parsed.facets.raion));
      const selRaionClean = cleanRaionName(explicitRaion || '').toLowerCase();
      const selRaion = selRaionClean.slice(0, 4);
      const targetNum = (parsed.targetBranchNumber || parsed.postalCode || '').toString();
      const checkBranch = (b, applyRaionFilter = true) => {
        const bNum = String(b.index || b.number || b.postalCode || '');
        // Якщо в статичній базі є точний збіг за 5-значним індексом (або 4-6 значним поштоматом/відділенням),
        // колізія омонімів населеного пункту в іншій області (наприклад, село Київ у Миколаївській обл. vs столиця Київ)
        // категорично не повинна відсікати діюче відділення з цим точним індексом!
        if (targetNum && bNum === targetNum && targetNum.length >= 4) {
          const bc = b._canonCity || canonCity(b.city);
          if (bc === selName || (b._suburbs && b._suburbs.includes(selName))) {
            return true;
          }
        }
        const bc = b._canonCity || canonCity(b.city);
        const matchesCity = bc === selName || (b._suburbs && b._suburbs.includes(selName));
        if (!matchesCity) return false;
        const bObl = (b.oblast || b.region || '').toLowerCase();
        if (selObl && bObl && !bObl.includes(selObl)) return false;
        if (applyRaionFilter && selRaionClean) {
          const bRai = (b.raion || b.district || '').toLowerCase();
          if (bRai && !bRai.includes(selRaion) && !areRaionsCompatible(selRaionClean, b.raion || b.district)) return false;
        }
        return true;
      };

      let filteredMatches = staticMatches.filter(b => checkBranch(b, true));
      // Якщо користувач вказав помилковий район у пошуковому рядку (наприклад: "кобаків Галицький Івано-Франківська 1",
      // де с. Кобаки насправді знаходиться у Косівському р-ні), і жорсткий фільтр дав 0 результатів:
      // робимо Google-like фолбек без конфліктного району, якщо у цьому населеному пункті є діючі відділення
      if (filteredMatches.length === 0 && selRaionClean && !state.selectedSettlement) {
        const relaxedMatches = staticMatches.filter(b => checkBranch(b, false));
        if (relaxedMatches.length > 0) {
          filteredMatches = relaxedMatches;
        }
      }
      staticMatches = filteredMatches;
    } else if (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast)) {
      const targetObl = (parsed.detectedOblast || parsed.facets.oblast).toLowerCase().slice(0, 4);
      staticMatches = staticMatches.filter(b => !b.oblast || b.oblast.toLowerCase().includes(targetObl));
    }

    if (!activeSettlement && (parsed.detectedRaion || (parsed.facets && parsed.facets.raion))) {
      const targetRaion = parsed.detectedRaion || (parsed.facets && parsed.facets.raion);
      const rClean = cleanRaionName(targetRaion).toLowerCase();
      const rStem = rClean.slice(0, 4);
      staticMatches = staticMatches.filter(b => {
        const bR = (b.raion || b.district || '').toLowerCase();
        return !bR || bR.includes(rStem) || (window.SmartSearchEngine && window.SmartSearchEngine.areRaionsCompatible(rClean, b.raion || b.district));
      });
    }

    // Перевіряємо, чи є впевнений збіг у статичній базі
    if (staticMatches.length > 0) {
      const isPostomatSearch = parsed.isPostomat || state.typeFilter === 'postomat' || /(?<!\p{L})(?:поштомат|поштомата|поштомати|почтомат|п\/м|пм)(?!\p{L})/iu.test(rawQuery);
      const isHouseNumberNotBranch = isPostomatSearch && parsed.targetBranchNumber && parseInt(parsed.targetBranchNumber, 10) < 1000;

      if (parsed.targetBranchNumber && !isHouseNumberNotBranch) {
        // Якщо шукали конкретний номер, залишаємо відділення саме з цим номером (відсікаючи номери будинків з адреси)
        let exactMatches = staticMatches.filter(b => 
          (b.number && b.number.toString() === parsed.targetBranchNumber.toString()) || 
          (b.postalCode && b.postalCode.toString() === parsed.targetBranchNumber.toString()) ||
          (b.index && b.index.toString() === parsed.targetBranchNumber.toString())
        );

        // ФОЛЛБЕК ДЛЯ УКРПОШТИ:
        // Якщо клієнт шукає населений пункт + номер ("житомир нові білокоровичі 1"),
        // але в Укрпошті номери відділень - це 5-значні індекси (наприклад 11051):
        if (exactMatches.length === 0 && !isNP && staticMatches.length > 0) {
          exactMatches = staticMatches;
        }

        const hasStreetInQuery = Boolean(
          (parsed.detectedStreet && !parsed.detectedStreet.toLowerCase().includes(canonCity(parsed.matchedSettlement ? parsed.matchedSettlement.name : ''))) ||
          (engine && engine.extractFacets && (engine.extractFacets(rawQuery).streetTokens || []).some(t => !engine.isOblastToken(t) && t !== canonCity(parsed.matchedSettlement ? parsed.matchedSettlement.name : '')))
        );

        if (exactMatches.length > 0) {
          if (hasStreetInQuery) {
            // Якщо користувач також шукав вулицю (напр. "культури 6 слобожанське 1"):
            // зберігаємо точки за вулицею разом із точним номером відділення
            const streetMatches = staticMatches.filter(b => !exactMatches.includes(b));
            results = streetMatches.concat(exactMatches);
          } else {
            results = exactMatches;
          }
          if (!parsed.didYouMeanText) {
            didYouMeanText = null;
            didYouMeanData = null;
          }
        } else {
          const targetNumStr = parsed.targetBranchNumber.toString();
          const isPostomatPrefix = targetNumStr.length >= 3 && staticMatches.some(b => (b.typeClass === 'poshtomat' || b.type === 'poshtomat') && b.number && b.number.toString().startsWith(targetNumStr));
          const prefixMatches = isPostomatPrefix
            ? staticMatches.filter(b => (b.typeClass === 'poshtomat' || b.type === 'poshtomat') && b.number && b.number.toString().startsWith(targetNumStr))
            : [];
          if (prefixMatches.length > 0) {
            results = prefixMatches;
            if (!parsed.didYouMeanText) {
              didYouMeanText = null;
              didYouMeanData = null;
            }
          } else if (hasStreetInQuery && staticMatches.length > 0) {
            // Якщо точного номера немає серед результатів, але вказано слово-вулицю (випадок "145 драгоманов київ"),
            // відображаємо результат скорингового рушія за цією вулицею
            results = staticMatches;
            if (!parsed.didYouMeanText) {
              didYouMeanText = null;
              didYouMeanData = null;
            }
          } else {
            // Перевірка наявності точного номера в іншому місті або близького номера (distance 1) у поточному місті
            const crossCityExact = allStaticBranches.filter(b => 
              (b.number && b.number.toString() === targetNumStr) || 
              (b.postalCode && b.postalCode.toString() === targetNumStr) ||
              (b.index && b.index.toString() === targetNumStr)
            );
            const nearMatches = staticMatches.filter(b => {
              const num = String(b.number || '');
              return num.length === targetNumStr.length && engine && engine.damerauLevenshtein && engine.damerauLevenshtein(num, targetNumStr) <= 1;
            });
            const targetCityTitle = parsed.matchedSettlement ? parsed.matchedSettlement.name : (parsed.facets ? parsed.facets.city : '');
            if (targetCityTitle) {
              results = [];
              if (crossCityExact.length > 0) {
                didYouMeanText = `Відділення №${targetNumStr} розташоване у м. ${crossCityExact[0].city} (${crossCityExact[0].oblast || ''})`;
              } else if (nearMatches.length > 0) {
                didYouMeanText = `Можливо, ви мали на увазі відділення №${nearMatches[0].number}?`;
              }
            } else if (nearMatches.length > 0 || crossCityExact.length > 0) {
              results = nearMatches.concat(crossCityExact);
              if (nearMatches.length > 0 && crossCityExact.length > 0) {
                didYouMeanText = `У ${targetCityTitle || 'обраному місті'} немає №${targetNumStr} (знайдено у м. ${crossCityExact[0].city}). Схожий поруч: №${nearMatches[0].number}`;
              } else if (crossCityExact.length > 0) {
                didYouMeanText = `Відділення №${targetNumStr} розташоване у м. ${crossCityExact[0].city} (${crossCityExact[0].oblast || ''})`;
              } else if (nearMatches.length > 0) {
                didYouMeanText = `Можливо, ви мали на увазі відділення №${nearMatches[0].number}?`;
              }
            }
          }
        }
      } else {
        // Пошук за вулицею, містом або аліасом без фіксованого номера
        if (!hasStreetInQuery && engine && typeof engine.sortBranchesBySettlementOrder === 'function') {
          results = engine.sortBranchesBySettlementOrder(staticMatches, isPostomatSearch, /(?<!\p{L})(?:відділення|відділ|вд|склад)(?!\p{L})/iu.test(rawQuery));
        } else {
          results = staticMatches;
        }
      }
    }

    // 2. ДИНАМІЧНИЙ ОНЛАЙН API FALLBACK ДЛЯ НОВОЇ ПОШТИ
    // Запускається ВИКЛЮЧНО при явному натисканні Enter/Search (isExplicitSubmit === true),
    // якщо місто взагалі відсутнє у статичному реєстрі (55k+ відділень вже у статичній базі).
    // Заборонено виконувати мережеві запити під час фонового введення тексту (live debounce).
    if (isNP && isExplicitSubmit && results.length === 0) {
      let searchCity = state.selectedSettlement ? state.selectedSettlement.cleanName : (parsed.matchedSettlement ? parsed.matchedSettlement.name : '');
      if (!searchCity && parsed.cleanQuery) {
        const candidate = parsed.cleanQuery.split(/[, ]+/)[0];
        if (candidate && candidate.length >= 3 && !/^\d+$/.test(candidate)) {
          searchCity = candidate;
        }
      }

      const cityLower = searchCity ? searchCity.toLowerCase() : '';
      let hasCityInStatic = false;
      if (cityLower) {
        if (engine && engine.buildBranchIndex) {
          const idx = engine.buildBranchIndex(allStaticBranches);
          if (idx && (idx.allCities.has(cityLower) || idx.cityBranches.has(cityLower))) {
            hasCityInStatic = true;
          }
        }
        if (!hasCityInStatic) {
          hasCityInStatic = allStaticBranches.some(b => {
            if (!b.city || b.city.toLowerCase() !== cityLower) return false;
            if (state.selectedSettlement) {
              const selObl = state.selectedSettlement.cleanOblast.toLowerCase().slice(0, 4);
              if (selObl && b.oblast && !b.oblast.toLowerCase().includes(selObl)) return false;
            }
            return true;
          });
        }
      }

      if (searchCity && !hasCityInStatic) {
        let liveData = await fetchLiveNovaPoshta(searchCity, currentSignal);
        if (currentSignal.aborted) return;
        if (liveData && liveData.length > 0) {
          if (state.selectedSettlement) {
            const selObl = (state.selectedSettlement.cleanOblast || '').toLowerCase().slice(0, 4);
            const selRaionClean = (state.selectedSettlement.cleanRaion || '').toLowerCase();
            const selRaion = selRaionClean.slice(0, 4);
            liveData = liveData.filter(b => {
              if (selObl && b.oblast && !b.oblast.toLowerCase().includes(selObl)) return false;
              if (selRaionClean && b.raion && !b.raion.toLowerCase().includes(selRaion) && !areRaionsCompatible(selRaionClean, b.raion)) return false;
              return true;
            });
          } else if (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast)) {
            const oblClean = (parsed.detectedOblast || parsed.facets.oblast).toLowerCase().slice(0, 4);
            liveData = liveData.filter(b => b.oblast && b.oblast.toLowerCase().includes(oblClean));
          }

          if (liveData.length > 0) {
            allCityBranches = liveData;

            // Збагачуємо живі відділення нормалізованим пошуковим індексом
            if (engine) {
              liveData.forEach(b => {
                if (!b.normalizedSearchText) {
                  b.normalizedSearchText = engine.buildNormalizedSearchText(b);
                }
              });
            }

            // Застосовуємо універсальний нормалізований фільтр до відділень цього міста
            const liveFiltered = engine ? engine.filterBranchesByNormalizedSearch(rawQuery, liveData) : [];
            if (liveFiltered.length > 0) {
              results = liveFiltered;
            } else {
              results = [];
            }
          }
        }
      }
    }

    // 3. ДОДАТКОВИЙ ФОЛБЕК ДЛЯ СТАТИЧНИХ ДАНИХ (Укрпошта або якщо API не відповіло)
    // КАТЕГОРИЧНЕ ПРАВИЛО EMPTY STATE:
    // Якщо в запиті вказано номер відділення/поштомату (parsed.targetBranchNumber), і його не знайдено:
    // Для Нової Пошти КАТЕГОРИЧНО ЗАБОРОНЕНО фолбечитись до показу всіх інших відділень міста!
    // Для Укрпошти: у селах/СМТ відділення мають поштовий індекс замість номера 1-9, тому показуємо відділення населеного пункту з індексом
    const isPostomatSearch = parsed.isPostomat || state.typeFilter === 'postomat' || /(?<!\p{L})(?:поштомат|поштомата|поштомати|почтомат|п\/м|пм)(?!\p{L})/iu.test(rawQuery);
    const hasExactTargetMatch = Boolean(
      parsed.targetBranchNumber &&
      results.some(b => String(b.number || '').toLowerCase() === String(parsed.targetBranchNumber).toLowerCase())
    );

    let fellBackToSettlementOnMissingBranch = false;
    if (results.length === 0 || (isNP && state.selectedSettlement && parsed.targetBranchNumber && !hasExactTargetMatch && !hasStreetInQuery && !isPostomatSearch)) {
      if (state.selectedSettlement) {
        const sName = (state.selectedSettlement.cleanName || state.selectedSettlement.name || '').toLowerCase();
        const sObl = (state.selectedSettlement.cleanOblast || state.selectedSettlement.oblast || '').toLowerCase().slice(0, 4);
        const sRaionClean = (state.selectedSettlement.cleanRaion || state.selectedSettlement.raion || '').toLowerCase();
        const sRaion = sRaionClean.slice(0, 4);
        const settlementBranches = allStaticBranches.filter(b => {
          const bc = (b._canonCity || (b.city || '').toLowerCase()).trim();
          if (bc !== sName) return false;
          if (sObl && b.oblast && !b.oblast.toLowerCase().includes(sObl)) return false;
          if (sRaionClean && b.raion && !b.raion.toLowerCase().includes(sRaion) && !areRaionsCompatible(sRaionClean, b.raion)) return false;
          return true;
        });
        if (settlementBranches.length > 0) {
          let sortedSettlement = (engine && typeof engine.sortBranchesBySettlementOrder === 'function')
            ? engine.sortBranchesBySettlementOrder(settlementBranches, isPostomatSearch, !isPostomatSearch)
            : settlementBranches;
          if (parsed.targetBranchNumber && isNP) {
            fellBackToSettlementOnMissingBranch = true;
            if (!isPostomatSearch) {
              const regularOnly = sortedSettlement.filter(b => !isPostomatBranch(b));
              if (regularOnly.length > 0) {
                sortedSettlement = regularOnly;
              }
            }
          }
          results = sortedSettlement;
        }
      } else if (!isNP && parsed.matchedSettlement) {
        const sName = parsed.matchedSettlement.name.toLowerCase();
        const targetObl = (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast) || parsed.matchedSettlement.oblast || '').toLowerCase().slice(0, 4);
        const cityOnly = allStaticBranches.filter(b => {
          const bc = (b._canonCity || (b.city || '').toLowerCase()).trim();
          if (bc !== sName) return false;
          if (targetObl && b.oblast && !b.oblast.toLowerCase().includes(targetObl)) return false;
          return true;
        });
        if (cityOnly.length > 0) results = cityOnly;
      } else if (!parsed.targetBranchNumber) {
        if (staticMatches.length > 0) {
          results = staticMatches;
        } else if (parsed.matchedSettlement) {
          const sName = parsed.matchedSettlement.name.toLowerCase();
          const targetObl = (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast) || parsed.matchedSettlement.oblast || '').toLowerCase().slice(0, 4);
          const targetRaion = (parsed.detectedRaion || (parsed.facets && parsed.facets.raion) || '').toLowerCase().slice(0, 4);
          const cityOnly = allStaticBranches.filter(b => {
            const bc = (b._canonCity || (b.city || '').toLowerCase()).trim();
            if (bc !== sName) return false;
            if (targetObl && b.oblast && !b.oblast.toLowerCase().includes(targetObl)) return false;
            if (targetRaion && b.raion && !b.raion.toLowerCase().includes(targetRaion) && !areRaionsCompatible(targetRaion, b.raion)) return false;
            return true;
          });
          if (cityOnly.length > 0) {
            results = (engine && engine.sortBranchesBySettlementOrder)
              ? engine.sortBranchesBySettlementOrder(cityOnly)
              : cityOnly;
          }
        }
      }
    }

    // Резервний пошук в API Укрпошти за 5-значним індексом, якщо відділення ще немає в локальній базі
    if (results.length === 0 && state.currentService === 'ukrposhta') {
      const pcMatch = rawQuery.match(/\b\d{5}\b/);
      const targetPostal = (parsed.targetBranchNumber && /^\d{5}$/.test(parsed.targetBranchNumber))
        ? parsed.targetBranchNumber
        : (pcMatch ? pcMatch[0] : null);
      if (targetPostal) {
        const liveB = await fetchUkrposhtaBranchLive(targetPostal);
        if (liveB) {
          results = [liveB];
          didYouMeanText = null;
          didYouMeanData = null;
        }
      }
    }

    // Формуємо інформацію про цільове відділення, якого немає в базі
    let missingTargetBranch = null;
    if (parsed.targetBranchNumber && (results.length === 0 || fellBackToSettlementOnMissingBranch || (isNP && !hasExactTargetMatch && !hasStreetInQuery && !isPostomatSearch))) {
      const fallbackSettl = parsed.matchedSettlement || state.selectedSettlement;
      missingTargetBranch = {
        number: parsed.targetBranchNumber,
        city: parsed.matchedSettlement
          ? parsed.matchedSettlement.name
          : (state.selectedSettlement ? (state.selectedSettlement.cleanName || state.selectedSettlement.name) : (parsed.facets ? parsed.facets.city : '')),
        settlement: fallbackSettl,
        oblast: parsed.detectedOblast || (parsed.facets ? parsed.facets.oblast : (fallbackSettl ? (fallbackSettl.cleanOblast || fallbackSettl.oblast || '') : '')),
        raion: parsed.detectedRaion || (parsed.facets ? parsed.facets.raion : (fallbackSettl ? (fallbackSettl.cleanRaion || fallbackSettl.raion || '') : ''))
      };
      if (!parsed.didYouMeanText) {
        didYouMeanText = null;
        didYouMeanData = null;
      }
    }

    let missingSettlement = null;
    if (results.length === 0) {
      if (state.selectedSettlement) {
        missingSettlement = state.selectedSettlement;
      } else if (parsed && (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast) || parsed.detectedRaion || (parsed.facets && parsed.facets.raion)) && parsed.matchedSettlement) {
        missingSettlement = parsed.matchedSettlement;
      }
    }

    if (currentSignal.aborted) return;

    // Гарантуємо природний порядок видачі населеного пункту (спочатку відділення №1..N, потім поштомати)
    if (results.length > 1 && (!parsed.targetBranchNumber || fellBackToSettlementOnMissingBranch) && !hasStreetInQuery) {
      if (engine && typeof engine.sortBranchesBySettlementOrder === 'function') {
        const isPostomatSearch = parsed.isPostomat || state.typeFilter === 'postomat' || /(?<!\p{L})(?:поштомат|поштомата|поштомати|почтомат|п\/м|пм)(?!\p{L})/iu.test(rawQuery);
        const isBranchSearch = /(?<!\p{L})(?:відділення|відділ|вд|склад)(?!\p{L})/iu.test(rawQuery) || state.typeFilter === 'cargo' || state.typeFilter === 'branch' || fellBackToSettlementOnMissingBranch;
        results = engine.sortBranchesBySettlementOrder(results, isPostomatSearch, isBranchSearch);
      }
    }

    state.currentResults = results;
    let fullGeoQuery = '';
    const hasExplicitTargetNum = parsed.targetBranchNumber && results.some(b => String(b.number) === String(parsed.targetBranchNumber));
    if (!fellBackToSettlementOnMissingBranch && ((allowSingleAutoSelect && results.length === 1) || (isExplicitSubmit && results.length > 0 && hasExplicitTargetNum))) {
      state.selectedBranch = hasExplicitTargetNum
        ? results.find(b => String(b.number) === String(parsed.targetBranchNumber))
        : results[0];
      if (hasExplicitTargetNum && !hasStreetInQuery && state.selectedBranch) {
        results = [state.selectedBranch];
        state.currentResults = results;
      }
      if (results[0]) {
        state.selectedSettlement = {
          cleanName: cleanSettlementName(results[0].city),
          name: cleanSettlementName(results[0].city),
          cleanRaion: cleanRaionName(results[0].raion || ''),
          raion: cleanRaionName(results[0].raion || ''),
          cleanOblast: cleanOblastName(results[0].oblast || ''),
          oblast: cleanOblastName(results[0].oblast || ''),
          type: results[0].settlementType || 'місто'
        };
      }
      if (isExplicitSubmit && state.selectedBranch) {
        fullGeoQuery = buildFullGeoQuery(state.selectedBranch, parsed.targetBranchNumber);
        if (fullGeoQuery && dom.searchInput) {
          dom.searchInput.value = fullGeoQuery;
          state.searchQuery = fullGeoQuery;
          state.lockedInputValue = fullGeoQuery;
        }
      }
    } else {
      state.selectedBranch = null;
    }
    if (isExplicitSubmit || (results.length === 0 && /\d/.test(rawQuery))) {
      closeAutocomplete();
    }

    // Якщо в запиті немає реальної помилки або це прямий точний збіг / обране відділення
    if (!parsed.didYouMeanText) {
      if (!parsed.didYouMeanText) {
        didYouMeanText = null;
        didYouMeanData = null;
      }
    }

    renderSearchResults(results, rawQuery, didYouMeanText, missingTargetBranch, missingSettlement, didYouMeanData);

    const svc = state.currentService === 'novaposhta' ? 'NP' : 'UKR';
    setClarityTag('service', svc);

    const activeSource = currentInputSource || 'manual';
    const svcName = state.currentService === 'novaposhta' ? 'Нова пошта' : 'Укрпошта';

    const settlementForAlt = (!missingTargetBranch) ? missingSettlement : null;
    const altInfo = results.length === 0 ? findAlternativeServiceBranchForQuery(settlementForAlt, rawQuery) : null;

    // Оновлюємо стан сесії та перевіряємо переписування попереднього запиту
    updateSearchSessionState(rawQuery, results.length, activeSource, Boolean(altInfo || settlementForAlt));

    clearTimeout(zeroResultsDebounceTimer);
    if (results.length === 0 && rawQuery.length >= 2) {
      let zeroStatus;
      let zeroDetails;
      if (altInfo && altInfo.service === 'ukrposhta') {
        zeroStatus = '🟡 Немає НП (доступна Укрпошта)';
        zeroDetails = `У населеному пункті немає відділень Нової пошти, запропоновано Укрпошту (індекс ${altInfo.index || 'УП'}). Джерело: ${getSourceLabel(activeSource)}`;
      } else if (altInfo && altInfo.service === 'novaposhta') {
        zeroStatus = '🟡 Немає УП (доступна Нова пошта)';
        zeroDetails = `У населеному пункті немає відділень Укрпошти, запропоновано Нову пошту (відділення №${altInfo.number || '1'}). Джерело: ${getSourceLabel(activeSource)}`;
      } else if (settlementForAlt) {
        zeroStatus = state.currentService === 'novaposhta' ? '🟡 У селі немає відділень НП' : '🟡 У селі немає відділень УП';
        zeroDetails = `Населений пункт розпізнано, але в ньому немає відкритих відділень ${svcName}. Джерело: ${getSourceLabel(activeSource)}`;
      } else {
        zeroStatus = activeSource === 'paste' ? '🔴 0 результатів (Вставка)' : '🔴 0 результатів';
        zeroDetails = `Жодного відділення не знайдено. Джерело: ${getSourceLabel(activeSource)}. Служба: ${svcName}`;
      }

      if (zeroStatus.startsWith('🔴')) {
        trackClarityEvent('search_zero_results');
        setClarityTag('last_zero_query', rawQuery.slice(0, 50));
        trackEvent('search_zero_results', { search_term: rawQuery, tab_type: svc });
      } else {
        trackClarityEvent('alt_service_suggested');
        setClarityTag('alt_service_query', rawQuery.slice(0, 50));
        trackEvent('alt_service_suggested', { search_term: rawQuery, tab_type: svc });
      }

      const sendZero = () => {
        const curInput = dom.searchInput ? dom.searchInput.value.trim() : rawQuery;
        if (!isExplicitSubmit && curInput !== rawQuery) return;
        logFailureTelemetry({
          query: rawQuery,
          service: state.currentService,
          status: zeroStatus,
          resultsCount: 0,
          duration: 1,
          details: zeroDetails
        });
      };

      if (isExplicitSubmit || activeSource === 'paste') {
        sendZero();
      } else {
        zeroResultsDebounceTimer = setTimeout(sendZero, 500);
      }
    } else if (results.length > 0) {
      trackClarityEvent('search_success');
      setClarityTag('last_success_query', rawQuery.slice(0, 50));

      if (activeSource === 'paste') {
        logFailureTelemetry({
          query: rawQuery,
          service: state.currentService,
          status: '🔵 Пошук: Вставка з буфера',
          resultsCount: results.length,
          duration: 1,
          details: `Оператор вставив запит з буфера обміну (знайдено ${results.length} рез.). Служба: ${svcName}`
        });
      } else if (shouldRecordAnalytics) {
        if (activeSource === 'frequent_chip') {
          logFailureTelemetry({
            query: rawQuery,
            service: state.currentService,
            status: '🔵 Вибір: Швидкі міста (Чіп)',
            resultsCount: results.length,
            duration: 1,
            details: `Клік по чіпу швидкого вибору міста (знайдено ${results.length} рез.).`
          });
        } else if (activeSource === 'history_card') {
          logFailureTelemetry({
            query: rawQuery,
            service: state.currentService,
            status: '🔵 Вибір: Історія пошуків',
            resultsCount: results.length,
            duration: 1,
            details: `Повторний запуск із карток історії пошуків (знайдено ${results.length} рез.).`
          });
        } else if (activeSource === 'autocomplete') {
          logFailureTelemetry({
            query: rawQuery,
            service: state.currentService,
            status: '🔵 Вибір: Автокомпліт',
            resultsCount: results.length,
            duration: 1,
            details: `Вибір міста/відділення з випадаючого списку (знайдено ${results.length} рез.).`
          });
        } else if (activeSource === 'smart_banner') {
          logFailureTelemetry({
            query: rawQuery,
            service: state.currentService,
            status: '🔵 Перехід: Розвилка служб',
            resultsCount: results.length,
            duration: 1,
            details: `Перехід через розумний банер служб (знайдено ${results.length} рез.).`
          });
        } else if (isExplicitSubmit && rawQuery.length >= 2) {
          logFailureTelemetry({
            query: rawQuery,
            service: state.currentService,
            status: '🔵 Пошук (Enter / Кнопка)',
            resultsCount: results.length,
            duration: 1,
            details: `Підтверджений ручний пошук (знайдено ${results.length} рез.).`
          });
        }
      }
    }

    // Запис у найчастіші запити та історію
    if (shouldRecordAnalytics) {
      const recordTitle = parsed.matchedSettlement ? parsed.matchedSettlement.name : rawQuery;
      recordFrequentQuery(recordTitle);
      const historyQuery = (state.selectedBranch && fullGeoQuery) ? fullGeoQuery : rawQuery;
      recordSearchHistory(historyQuery, results.length);

      trackEvent('search_performed', {
        search_term: rawQuery,
        query_length: rawQuery.length,
        tab_type: svc,
        results_count: results.length,
        has_results: results.length > 0
      });
    }

    // Оновлення карти: показуємо до 20 відділень знайденого міста, а шукане відділення виділяємо!
    if (state.isMapVisible && state.leafletMap) {
      let mapBranches = [];
      let targetBranch = results.length === 1 ? results[0] : (results.length > 0 ? results[0] : null);

      if (results.length > 0) {
        mapBranches = results.slice(0, 20);
      } else if (allCityBranches.length > 0) {
        mapBranches = allCityBranches.slice(0, 20);
      } else if (parsed && parsed.matchedSettlement) {
        const allBranches = getAllCurrentServiceBranches();
        const sName = (state.selectedSettlement ? state.selectedSettlement.cleanName : parsed.matchedSettlement.name).toLowerCase();
        const targetObl = (state.selectedSettlement ? state.selectedSettlement.cleanOblast : (parsed.detectedOblast || (parsed.facets && parsed.facets.oblast) || parsed.matchedSettlement.oblast || '')).toLowerCase().slice(0, 4);
        const targetRaionFull = (state.selectedSettlement ? (state.selectedSettlement.cleanRaion || state.selectedSettlement.raion) : (parsed.detectedRaion || (parsed.facets && parsed.facets.raion) || '')).toLowerCase();
        const targetRaion = targetRaionFull.slice(0, 4);
        mapBranches = allBranches.filter(b => {
          const bc = (b._canonCity || (b.city || '').toLowerCase()).trim();
          if (bc !== sName) return false;
          if (targetObl && b.oblast && !b.oblast.toLowerCase().includes(targetObl)) return false;
          if (targetRaion && b.raion && !b.raion.toLowerCase().includes(targetRaion) && !areRaionsCompatible(targetRaionFull, b.raion)) return false;
          return true;
        }).slice(0, 20);
      }

      if (mapBranches.length > 0) {
        updateMapMarkers(mapBranches, targetBranch);
        if (targetBranch && targetBranch.lat && targetBranch.lng) {
          state.leafletMap.flyTo([targetBranch.lat, targetBranch.lng], 14, { duration: 1.0 });
        } else if (parsed && parsed.matchedSettlement && parsed.matchedSettlement.lat) {
          state.leafletMap.flyTo([parsed.matchedSettlement.lat, parsed.matchedSettlement.lng], 13, { duration: 1.0 });
        }
      } else {
        updateVisibleMarkersFromViewport();
      }
    }
    } catch (err) {
      console.error('executeSearch ERROR:', err);
    }
  }

  // Допоміжний метод: очищення вулиці з кешуванням на об'єкті
  function getCleanStreet(branch) {
    if (!branch) return '';
    if (branch._cleanStreet !== undefined) return branch._cleanStreet;
    let street = branch.street || '';
    if (!street) {
      if (branch.name && branch.name.includes(':')) {
        street = branch.name.split(':')[1].trim();
      } else {
        street = branch.address || '';
      }
    }
    street = street.replace(/\\n|\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    street = street.replace(/^(?:м\.|с\.|смт|селище|село|місто)\s*/i, '').trim();
    const city = branch.city || '';
    if (city) {
      const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      street = street.replace(new RegExp(`^${escapedCity}[,\\s]*`, 'i'), '').trim();
      street = street.replace(/^(?:м\.|с\.|смт|селище|село|місто)\s*/i, '').trim();
    }
    street = street.replace(/^(?:вул\.?\s+)+(?=(?:вул|вулиця|просп|проспект|пр-т|пл|площа|бульв|бульвар|б-р|пров|провулок|шосе|наб|набережна|узвіз|майдан|тупик|алея|квартал|мікрорайон|мкрн|урочище|ст\.|станція)(?:\.|[\s-]|$))/i, '');

    const isUkrposhta = state.currentService === 'ukrposhta' ||
      (branch.id && String(branch.id).startsWith('up-')) ||
      (branch.index && /^\d{5}$/.test(String(branch.index))) ||
      (branch.postalCode && /^\d{5}$/.test(String(branch.postalCode)));

    if (isUkrposhta) {
      const isPlaceholder = !street ||
        /^(?:ВПЗ|вул\.?\s*ВПЗ|відділення|точка\s+присутності|пвпз)/i.test(street) ||
        /^(?:пересувне|мобільне)/i.test(street) ||
        /^\d{5}$/.test(street) ||
        (city && street.toLowerCase() === city.toLowerCase());
      if (isPlaceholder) {
        street = 'пересувне відділення';
        branch._cleanStreet = street;
        return street;
      }
    }

    if (street && !/^(?:вул|вулиця|просп|проспект|пр-т|пл|площа|бульв|бульвар|б-р|пров|провулок|шосе|наб|набережна|узвіз|майдан|тупик|алея|квартал|мікрорайон|мкрн|урочище|ст\.|станція)(?:\.|[\s-]|$)/i.test(street)) {
      if (!/^(?:ВПЗ|відділення|поштомат|пункт)/i.test(street)) {
        street = 'вул. ' + street;
      }
    }
    branch._cleanStreet = street;
    return street;
  }

  const OBLAST_CENTER_RAIONS = {
    'Ужгород': 'Ужгородський',
    'Львів': 'Львівський',
    'Рівне': 'Рівненський',
    'Луцьк': 'Луцький',
    'Тернопіль': 'Тернопільський',
    'Івано-Франківськ': 'Івано-Франківський',
    'Хмельницький': 'Хмельницький',
    'Житомир': 'Житомирський',
    'Чернівці': 'Чернівецький',
    'Вінниця': 'Вінницький',
    'Чернігів': 'Чернігівський',
    'Суми': 'Сумський',
    'Полтава': 'Полтавський',
    'Харків': 'Харківський',
    'Дніпро': 'Дніпровський',
    'Запоріжжя': 'Запорізький',
    'Миколаїв': 'Миколаївський',
    'Херсон': 'Херсонський',
    'Одеса': 'Одеський',
    'Кропивницький': 'Кропивницький',
    'Черкаси': 'Черкаський'
  };

  // Очищення та приведення до називного відмінка географічних сутностей
  function cleanOblastName(raw) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.cleanOblastName) {
      return window.SmartSearchEngine.cleanOblastName(raw);
    }
    if (!raw) return '';
    let o = String(raw)
      .replace(/\\n|\r?\n/g, ' ')
      .replace(/[()[\]{}«»"']/g, ' ')
      .replace(/\s*(?:область|області|областю|обл\.?)$/i, '')
      .trim();
    if (o.toLowerCase() === 'київ' || o.toLowerCase() === 'м. київ' || o.toLowerCase() === 'м київ') {
      return 'Київська';
    }
    if (/(?:ської|ській|ською|ську)$/i.test(o)) {
      o = o.replace(/(?:ської|ській|ською|ську)$/i, 'ська');
    } else if (/(?:цької|цькій|цькою|цьку)$/i.test(o)) {
      o = o.replace(/(?:цької|цькій|цькою|цьку)$/i, 'цька');
    } else if (/(?:зької|зькій|зькою|зьку)$/i.test(o)) {
      o = o.replace(/(?:зької|зькій|зькою|зьку)$/i, 'зька');
    }
    return o.replace(/[-–—.,;:]+$/, '').trim();
  }

  function normalizeApostrophes(str) {
    if (!str) return str || '';
    return String(str).replace(/[`'’ʼʹʻʽ‘′´ˈ\u2018\u2019\u02BC]/g, "'");
  }

  function canonText(s) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.canonText) {
      return window.SmartSearchEngine.canonText(s);
    }
    return (s == null ? '' : String(s)).toLowerCase().replace(/[`'’ʼʹʻʽ‘′´ˈ\u2018\u2019\u02BC]/g, '').trim();
  }

  function canonCity(s) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.canonCity) {
      return window.SmartSearchEngine.canonCity(s);
    }
    return canonText(s)
      .replace(/\s*\([^)]*\)\s*$/g, '')
      .replace(/\s*\([^)]*$/g, '')
      .trim();
  }

  function cleanRaionName(raw) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.cleanRaionName) {
      return window.SmartSearchEngine.cleanRaionName(raw);
    }
    if (!raw) return '';
    let r = String(raw)
      .replace(/\\n|\r?\n/g, ' ')
      .replace(/[()[\]{}«»"]/g, ' ')
      .replace(/\s*(?:район|району|районом|районі|р-н|р-ну|міськрада|громада)$/i, '')
      .trim();
    r = normalizeApostrophes(r);
    r = r.replace(/^['"`«»]+|['"`«»]+$/g, '').trim();
    if (/(?:ського|ському|ським|ськом|ська|ської|ській|ською)$/i.test(r)) {
      r = r.replace(/(?:ського|ському|ським|ськом|ська|ської|ській|ською)$/i, 'ський');
    } else if (/(?:цького|цькому|цьким|цьком|цька|цької|цькій|цькою)$/i.test(r)) {
      r = r.replace(/(?:цького|цькому|цьким|цьком|цька|цької|цькій|цькою)$/i, 'цький');
    } else if (/(?:зького|зькому|зьким|зьком|зька|зької|зькій|зькою)$/i.test(r)) {
      r = r.replace(/(?:зького|зькому|зьким|зьком|зька|зької|зькій|зькою)$/i, 'зький');
    }
    return r.replace(/[-–—.,;:]+$/, '').trim();
  }

  function areRaionsCompatible(r1, r2) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.areRaionsCompatible) {
      return window.SmartSearchEngine.areRaionsCompatible(r1, r2);
    }
    if (!r1 || !r2) return false;
    const s1 = String(r1).toLowerCase().replace(/район|р-н/g, '').trim().slice(0, 4);
    const s2 = String(r2).toLowerCase().replace(/район|р-н/g, '').trim().slice(0, 4);
    return s1 === s2;
  }

  function cleanSettlementName(raw) {
    if (window.SmartSearchEngine && window.SmartSearchEngine.cleanSettlementName) {
      return window.SmartSearchEngine.cleanSettlementName(raw);
    }
    if (!raw) return '';
    let s = String(raw)
      .replace(/\\n|\r?\n/g, ' ')
      .replace(/\s*\([^)]*\)\s*$/, '')
      .replace(/\s*\([^)]*$/, '')
      .replace(/[()[\]{}«»"]/g, ' ')
      .replace(/^(?:місто|селище міського типу|смт|селище|село|м\.|с\.|сел\.)\s+/i, '')
      .replace(/[-–—.,;:]+$/, '')
      .trim();
    s = normalizeApostrophes(s);
    s = s.replace(/^['"`«»]+|['"`«»]+$/g, '').trim();
    return s;
  }

  // Географічна прив'язка (Район, область) для картки відділення у стилі попапу:
  // (Район р-н, Область обл.)
  function formatGeoSub(branch) {
    if (!branch) return '';
    let oblast = branch.oblast || branch.SettlementAreaDescription || '';
    let raion = branch.raion || branch.SettlementRegionsDescription || '';
    const city = cleanSettlementName(branch.city || branch.SettlementDescription || '');

    if (!raion && OBLAST_CENTER_RAIONS[city]) {
      const oblClean = cleanOblastName(oblast);
      if (!oblClean || oblClean.toLowerCase().includes(city.slice(0, 4).toLowerCase())) {
        raion = OBLAST_CENTER_RAIONS[city];
      }
    }
    if ((!oblast || !raion) && window.SmartSearchEngine) {
      const found = findSettlementInEngine(city, oblast);
      if (found) {
        if (!oblast) oblast = found.oblast;
        if (!raion && (!oblast || cleanOblastName(found.oblast).toLowerCase().includes(cleanOblastName(oblast).slice(0, 4).toLowerCase()))) {
          raion = found.raion;
        }
      }
    }

    const oblClean = cleanOblastName(oblast);
    let raionClean = cleanRaionName(raion);

    if (window.SmartSearchEngine && window.SmartSearchEngine.getHistoricalGeoInfo) {
      const hist = window.SmartSearchEngine.getHistoricalGeoInfo(city, raionClean, oblClean);
      if (hist && hist.actualRaion) {
        raionClean = hist.actualRaion;
      }
    }

    const parts = [];
    if (raionClean) parts.push(`${raionClean} р-н`);
    if (oblClean) parts.push(`${oblClean} обл.`);

    return parts.length > 0 ? `(${parts.join(', ')})` : '';
  }

  // Уніфікована перевірка поштомату (без урахування регістру) за всіма можливими полями
  function isPostomatBranch(b) {
    if (!b) return false;
    const hay = [b.CategoryOfWarehouse, b.TypeOfWarehouse, b.type, b.typeClass, b.typeName, b.typeText, b.name, b.Description, b.description]
      .filter(Boolean).join(' ').toLowerCase();
    return /postomat|poshtomat|поштомат|почтомат/.test(hay) ||
      b.TypeOfWarehouse === 'f9316480-5f2d-425d-bc2c-ac7cd29decf0';
  }

  function isCargoBranch(b) {
    if (!b || isPostomatBranch(b)) return false;
    const totalWeight = parseFloat(b.totalMaxWeightAllowed || b.TotalMaxWeightAllowed) || 0;
    const placeWeight = parseFloat(b.placeMaxWeightAllowed || b.PlaceMaxWeightAllowed) || 0;
    const maxWeight = parseFloat(b.maxWeight) || parseFloat(b.weightLimit) || Math.max(totalWeight, placeWeight);

    // Якщо вага <= 30 кг — це СТРОГО "Відділення", навіть якщо в сирому полі опису випадково трапляється слово "вантажне"
    const isUnder30 = (maxWeight > 0 && maxWeight <= 30) ||
      (totalWeight > 0 && totalWeight <= 30) ||
      (placeWeight > 0 && placeWeight <= 30) ||
      /(?:до\s*(?:5|10|15|20|30)\s*кг|приймання-видачі)/i.test([b.name, b.typeText, b.typeName, b.Description].filter(Boolean).join(' '));
    if (isUnder30) return false;

    // Статус "Вантажне відділення" ТІЛЬКИ якщо (TotalMaxWeightAllowed >= 1000 || PlaceMaxWeightAllowed >= 1000 || CategoryOfWarehouse === "Cargo")
    return totalWeight >= 1000 ||
           placeWeight >= 1000 ||
           maxWeight >= 1000 ||
           b.CategoryOfWarehouse === 'Cargo';
  }

  function isRegularBranch(b) {
    if (!b || isPostomatBranch(b)) return false;
    return !isCargoBranch(b);
  }

  // Визначення типу відділення для аналітики (поштомат / відділення / вантажне)
  function getBranchAnalyticsType(b) {
    if (isPostomatBranch(b)) return 'поштомат';
    if (isCargoBranch(b)) return 'вантажне';
    return 'відділення';
  }

  // Визначення бейджа типу, вагового обмеження та габаритів
  function getTypeBadgeInfo(branch) {
    if (isPostomatBranch(branch)) {
      return { label: 'Поштомат (до 20 кг)', cls: 'poshtomat' };
    }

    if (isCargoBranch(branch)) {
      const weight = branch.totalMaxWeightAllowed || branch.maxWeight || 1100;
      const dims = branch.dimensions || branch.maxDimensions || '600×220×220 см';
      return { label: `до ${weight} кг, ${dims}`, cls: 'cargo' };
    }

    const weight = branch.totalMaxWeightAllowed || branch.maxWeight || 30;
    const cls = weight <= 10 ? 'pickup' : 'post';
    return { label: `Поштове (до ${weight} кг)`, cls };
  }


  // ==========================================================================
  // v1.4.6: КОНСТРУКТОР ШАБЛОНУ КОПІЮВАННЯ (CUSTOM COPY PRESET BUILDER)
  // ==========================================================================
  const COPY_PRESET_TAGS = [
    { id: 'settlementType', label: '[Тип НП]', desc: 'м. / с. / смт' },
    { id: 'city', label: '[Місто]', desc: 'Назва населеного пункту' },
    { id: 'service', label: '[Служба]', desc: 'Нова Пошта / Укрпошта' },
    { id: 'branchType', label: '[Тип точки]', desc: 'Відділення / Поштомат / Вантажне' },
    { id: 'number', label: '[Номер]', desc: '№ відділення чи поштомату' },
    { id: 'street', label: '[Вулиця]', desc: 'Назва вулиці' },
    { id: 'house', label: '[Будинок]', desc: 'Номер будинку' },
    { id: 'raion', label: '[Район]', desc: 'Назва району' },
    { id: 'oblast', label: '[Область]', desc: 'Назва області' },
    { id: 'postalCode', label: '[Індекс]', desc: 'Поштовий індекс' },
    { id: 'weight', label: '[Вага/Габарити]', desc: 'до 30 кг / до 1100 кг' }
  ];

  const CANONICAL_TAG_ORDER = [
    'service',
    'settlementType',
    'city',
    'branchType',
    'number',
    'street',
    'house',
    'raion',
    'oblast',
    'postalCode',
    'weight'
  ];

  function getTagDisplayInfo(tagId, options) {
    const isSmtShort = !!(options && options.smtShort);
    const noBranch = !!(options && options.noBranchWord);
    const noStreet = !!(options && options.noStreetPrefix);
    const shortReg = !!(options && options.shortRegion);

    switch (tagId) {
      case 'settlementType':
        return { label: isSmtShort ? 'смт' : 'селище', title: 'Тип населеного пункту (смт / селище / місто / село)' };
      case 'city':
        return { label: 'Середнє', title: 'Назва населеного пункту' };
      case 'service':
        return { label: 'Нова Пошта', title: 'Служба доставки (Нова Пошта / Укрпошта)' };
      case 'branchType':
        return { label: noBranch ? 'Вантажне' : 'відділення', title: 'Тип відділення чи поштомату' };
      case 'number':
        return { label: '№1', title: 'Номер відділення чи поштомату' };
      case 'street':
        return { label: noStreet ? 'Закарпатська, 75' : 'вул. Закарпатська, 75', title: 'Вулиця та номер будинку' };
      case 'house':
        return { label: 'буд. 75', title: 'Номер будинку (якщо окремо від вулиці)' };
      case 'raion':
        return { label: shortReg ? 'Ужгородський р-н' : 'Ужгородський район', title: 'Район області' };
      case 'oblast':
        return { label: shortReg ? 'Закарпатська обл.' : 'Закарпатська область', title: 'Область' };
      case 'postalCode':
        return { label: '89432', title: 'Поштовий індекс' };
      case 'weight':
        return { label: 'до 1100 кг', title: 'Вагові та габаритні обмеження' };
      default:
        return { label: tagId, title: tagId };
    }
  }

  function insertTagInCanonicalOrder(tags, tagId) {
    if (!Array.isArray(tags)) tags = [];
    if (tags.includes(tagId)) return tags;
    const targetRank = CANONICAL_TAG_ORDER.indexOf(tagId);
    if (targetRank === -1) {
      tags.push(tagId);
      return tags;
    }
    let insertIdx = -1;
    for (let i = 0; i < tags.length; i++) {
      const currentRank = CANONICAL_TAG_ORDER.indexOf(tags[i]);
      if (currentRank !== -1 && currentRank > targetRank) {
        insertIdx = i;
        break;
      }
    }
    if (insertIdx !== -1) {
      tags.splice(insertIdx, 0, tagId);
    } else {
      tags.push(tagId);
    }
    return tags;
  }

  const DEFAULT_COPY_PRESETS = {
    short: {
      presetName: 'default',
      tags: ['settlementType', 'city', 'branchType', 'number', 'street'],
      options: {
        smtShort: false,
        noBranchWord: false,
        shortRegion: true,
        noStreetPrefix: false
      }
    },
    detailed: {
      presetName: 'default',
      tags: ['settlementType', 'city', 'raion', 'oblast', 'branchType', 'number', 'weight', 'street'],
      options: {
        smtShort: true,
        noBranchWord: false,
        shortRegion: true,
        noStreetPrefix: false
      }
    }
  };

  const QUICK_PRESETS = {
    short: {
      default: {
        tags: ['settlementType', 'city', 'branchType', 'number', 'street'],
        options: { smtShort: false, noBranchWord: false, shortRegion: true, noStreetPrefix: false }
      },
      crm: {
        tags: ['settlementType', 'city', 'branchType', 'number', 'street', 'raion', 'oblast'],
        options: { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
      },
      short: {
        tags: ['city', 'branchType', 'number'],
        options: { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
      }
    },
    detailed: {
      default: {
        tags: ['settlementType', 'city', 'raion', 'oblast', 'branchType', 'number', 'weight', 'street'],
        options: { smtShort: true, noBranchWord: false, shortRegion: true, noStreetPrefix: false }
      },
      crm: {
        tags: ['settlementType', 'city', 'branchType', 'number', 'street', 'raion', 'oblast', 'weight'],
        options: { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
      },
      short: {
        tags: ['city', 'branchType', 'number', 'street'],
        options: { smtShort: true, noBranchWord: true, shortRegion: true, noStreetPrefix: true }
      }
    }
  };

  const STORAGE_KEY_PRESETS = 'np_custom_copy_presets';

  function loadCopyPresets() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PRESETS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return {
            short: Object.assign({}, DEFAULT_COPY_PRESETS.short, parsed.short || {}, {
              options: Object.assign({}, DEFAULT_COPY_PRESETS.short.options, (parsed.short && parsed.short.options) || {})
            }),
            detailed: Object.assign({}, DEFAULT_COPY_PRESETS.detailed, parsed.detailed || {}, {
              options: Object.assign({}, DEFAULT_COPY_PRESETS.detailed.options, (parsed.detailed && parsed.detailed.options) || {})
            })
          };
        }
      }
    } catch (e) {
      console.warn('Error loading custom copy presets:', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_COPY_PRESETS));
  }

  let userCopyPresets = loadCopyPresets();

  function saveCopyPresets(presets) {
    try {
      userCopyPresets = presets;
      localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(presets));
    } catch (e) {
      console.warn('Error saving custom copy presets:', e);
    }
  }

  function detectPresetType(tabKey, config) {
    const quick = QUICK_PRESETS[tabKey];
    for (const [name, preset] of Object.entries(quick)) {
      const tagsMatch = preset.tags.length === config.tags.length &&
        preset.tags.every((t, i) => t === config.tags[i]);
      const optsMatch = Object.keys(preset.options).every(k => preset.options[k] === config.options[k]);
      if (tagsMatch && optsMatch) {
        return name;
      }
    }
    return 'custom';
  }

  const BENCHMARK_SAMPLE_BRANCH = {
    id: 'benchmark-sample',
    service: 'novaposhta',
    settlementType: 'селище',
    city: 'Середнє',
    number: '1',
    postalCode: '89432',
    type: 'cargo',
    typeText: 'Вантажне (до 1100 кг)',
    typeName: 'Вантажне відділення',
    street: 'вул. Закарпатська, 75',
    raion: 'Ужгородський',
    oblast: 'Закарпатська',
    totalMaxWeightAllowed: 1100,
    maxWeight: 1100
  };

  function cleanOutputString(str) {
    if (!str) return '';
    let text = String(str);
    return text
      .replace(/Вантажневідділення/gi, 'Вантажне відділення')
      .replace(/(Вантажне|відділення|відд\.|Поштомат)(\d+)/gi, '$1 $2')
      .replace(/\(\s*,\s*\)/g, '')
      .replace(/\(\s*\)/g, '')
      .replace(/\s*:\s*/g, ': ')
      .replace(/:\s*/g, ': ')
      .replace(/:\s*[-—–]\s*/g, ': ')
      .replace(/,\s*[-—–:]\s*/g, ', ')
      .replace(/\s*[-—–]\s*,/g, ', ')
      .replace(/(?:,\s*)+,/g, ',')
      .replace(/,\s*,/g, ', ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/,\s*[-—–:]\s*/g, ', ')
      .replace(/Вантажневідділення/gi, 'Вантажне відділення')
      .replace(/(Вантажне|відділення|відд\.|Поштомат)(\d+)/gi, '$1 $2')
      .replace(/\s+/g, ' ')
      .replace(/^\s*[,:\-—–\s]+/g, '')
      .replace(/[,:\-—–\s]+$/g, '')
      .trim();
  }

  // Дефолтний класичний формат копіювання
  function formatClassicCopyStringDefault(branch) {
    let sType = branch.settlementType || '';
    const city = branch.city || '';

    if (!sType && window.SmartSearchEngine) {
      const found = findSettlementInEngine(city);
      if (found) sType = found.type;
    }
    if (!sType) sType = 'місто';

    let sTypeFull = sType.trim().toLowerCase();
    if (sTypeFull === 'м.' || sTypeFull === 'м' || sTypeFull === 'місто') sTypeFull = 'місто';
    else if (sTypeFull === 'с.' || sTypeFull === 'с' || sTypeFull === 'село') sTypeFull = 'село';
    else if (sTypeFull.includes('смт') || sTypeFull.includes('селище') || sTypeFull.includes('сел')) sTypeFull = 'селище';

    const isPost = isPostomatBranch(branch);
    const isCarg = isCargoBranch(branch);

    let typeTitle = 'Відділення';
    if (isPost) {
      typeTitle = 'Поштомат';
    } else if (isCarg) {
      typeTitle = 'Вантажне відділення';
    }

    const num = branch.number || branch.postalCode || branch.index || '1';
    const street = getCleanStreet(branch);

    return cleanOutputString(`${sTypeFull} ${city}, ${typeTitle} №${num}: ${street}`);
  }

  // Дефолтний детальний CRM-формат
  function formatDetailedCopyStringDefault(branch) {
    let sType = branch.settlementType || '';
    const city = branch.city || '';

    let oblast = branch.oblast || branch.SettlementAreaDescription || '';
    let raion = branch.raion || branch.SettlementRegionsDescription || '';

    if (!sType && window.SmartSearchEngine) {
      const found = findSettlementInEngine(city, oblast);
      if (found) sType = found.type;
    }
    if (!sType) sType = 'місто';

    let sTypePrefix = sType.trim().toLowerCase();
    if (sTypePrefix === 'село' || sTypePrefix === 'с' || sTypePrefix === 'с.') sTypePrefix = 'с.';
    else if (sTypePrefix === 'місто' || sTypePrefix === 'м' || sTypePrefix === 'м.') sTypePrefix = 'м.';
    else if (sTypePrefix.includes('смт') || sTypePrefix.includes('селище') || sTypePrefix.includes('сел')) sTypePrefix = 'смт';
    else if (!sTypePrefix.endsWith('.')) sTypePrefix = sTypePrefix + '.';

    if (!raion && OBLAST_CENTER_RAIONS[city]) {
      const oblClean = cleanOblastName(oblast);
      if (!oblClean || oblClean.toLowerCase().includes(city.slice(0, 4).toLowerCase())) {
        raion = OBLAST_CENTER_RAIONS[city];
      }
    }
    if ((!oblast || !raion) && window.SmartSearchEngine) {
      const found = findSettlementInEngine(city, oblast);
      if (found) {
        if (!oblast) oblast = found.oblast;
        if (!raion && (!oblast || cleanOblastName(found.oblast).toLowerCase().includes(cleanOblastName(oblast).slice(0, 4).toLowerCase()))) {
          raion = found.raion;
        }
      }
    }

    let raionClean = cleanRaionName(raion);
    const oblClean = cleanOblastName(oblast);

    if (window.SmartSearchEngine && window.SmartSearchEngine.getHistoricalGeoInfo) {
      const hist = window.SmartSearchEngine.getHistoricalGeoInfo(city, raionClean, oblClean);
      if (hist && hist.actualRaion) {
        raionClean = hist.actualRaion;
      }
    }

    const geoParts = [];
    if (raionClean) {
      geoParts.push(`${raionClean} р-н`);
    }
    if (oblClean) {
      geoParts.push(`${oblClean} обл.`);
    }
    const geoBracket = geoParts.length > 0 ? ` (${geoParts.join(', ')})` : '';

    const isPost = isPostomatBranch(branch);
    const isCarg = isCargoBranch(branch);

    let typeTitle = 'Відділення';
    if (isPost) {
      typeTitle = 'Поштомат';
    } else if (isCarg) {
      typeTitle = 'Вантажне відділення';
    }

    const num = branch.number || branch.postalCode || branch.index || '1';
    const street = getCleanStreet(branch);

    let weightText = '';
    if (isCarg) {
      const weight = branch.totalMaxWeightAllowed || branch.maxWeight || 1100;
      weightText = ` (до ${weight} кг)`;
    } else if (isPost) {
      const weight = branch.totalMaxWeightAllowed || branch.maxWeight || 20;
      weightText = ` (до ${weight} кг)`;
    } else if (branch.totalMaxWeightAllowed || branch.maxWeight) {
      const weight = branch.totalMaxWeightAllowed || branch.maxWeight;
      weightText = ` (до ${weight} кг)`;
    }

    return cleanOutputString(`${sTypePrefix} ${city}${geoBracket}, ${typeTitle} №${num}${weightText}: ${street}`);
  }

  // Генератор рядка на основі активного набору тегів та опцій (Token-based sequential builder)
  function assembleCopyStringFromPreset(branch, config) {
    const tags = config.tags || [];
    const options = config.options || {};

    let sType = branch.settlementType || '';
    const rawCity = branch.city || '';
    if (!sType && window.SmartSearchEngine) {
      const found = findSettlementInEngine(rawCity);
      if (found) sType = found.type;
    }
    if (!sType) sType = 'місто';

    let sTypeVal = sType.trim().toLowerCase();
    if (options.smtShort) {
      if (sTypeVal.includes('смт') || sTypeVal.includes('селище') || sTypeVal.includes('сел')) sTypeVal = 'смт';
      else if (sTypeVal.includes('село') || sTypeVal === 'с' || sTypeVal === 'с.') sTypeVal = 'с.';
      else if (sTypeVal.includes('міст') || sTypeVal === 'м' || sTypeVal === 'м.') sTypeVal = 'м.';
      else sTypeVal = sTypeVal.endsWith('.') ? sTypeVal : sTypeVal + '.';
    } else {
      if (sTypeVal.includes('смт') || sTypeVal.includes('селище') || sTypeVal.includes('сел')) sTypeVal = 'селище';
      else if (sTypeVal.includes('село') || sTypeVal === 'с' || sTypeVal === 'с.') sTypeVal = 'село';
      else if (sTypeVal.includes('міст') || sTypeVal === 'м' || sTypeVal === 'м.') sTypeVal = 'місто';
    }
    sTypeVal = sTypeVal.trim();

    const cityVal = cleanSettlementName(rawCity).trim();
    const isUp = branch.service === 'ukrposhta' || (branch.id && String(branch.id).startsWith('up-'));
    const serviceVal = isUp ? 'Укрпошта' : 'Нова Пошта';

    const isPost = isPostomatBranch(branch);
    const isCarg = isCargoBranch(branch);
    const numRaw = (branch.number || branch.Number || branch.postalCode || branch.PostalCode || branch.index || '1').toString().trim();

    let branchTypeVal = '';
    if (isPost) {
      branchTypeVal = 'Поштомат';
    } else if (isCarg) {
      branchTypeVal = options.noBranchWord ? 'Вантажне' : 'Вантажне відділення';
    } else {
      branchTypeVal = options.noBranchWord ? 'відд.' : 'Відділення';
    }
    branchTypeVal = branchTypeVal.trim();

    const numberVal = (options.noBranchWord ? numRaw : `№${numRaw}`).trim();

    let rawStreet = getCleanStreet(branch).trim();
    if (options.noStreetPrefix) {
      rawStreet = rawStreet.replace(/^(?:вул\.|вулиця|просп\.|проспект|пров\.|провулок|бульв\.|бульвар|площа|пл\.)\s*/i, '').trim();
    }
    rawStreet = rawStreet.replace(/^[-—–\s,:]+/, '').replace(/[-—–\s,:]+$/, '').trim();

    let streetVal = rawStreet;
    let houseVal = '';
    if (tags.includes('street') && tags.includes('house')) {
      const hm = rawStreet.match(/^(.*?)(?:,\s*|\s+)(?:буд\.\s*|№\s*)?(\d+[а-яА-Яa-zA-Z0-9\/\-]*)$/);
      if (hm) {
        streetVal = hm[1].trim();
        houseVal = hm[2].trim();
      }
    }
    streetVal = streetVal.replace(/^[-—–\s,:]+/, '').replace(/[-—–\s,:]+$/, '').trim();
    houseVal = houseVal.replace(/^[-—–\s,:]+/, '').replace(/[-—–\s,:]+$/, '').trim();

    let oblast = branch.oblast || branch.SettlementAreaDescription || '';
    let raion = branch.raion || branch.SettlementRegionsDescription || '';
    if (!raion && OBLAST_CENTER_RAIONS[cityVal]) {
      const oblClean = cleanOblastName(oblast);
      if (!oblClean || oblClean.toLowerCase().includes(cityVal.slice(0, 4).toLowerCase())) {
        raion = OBLAST_CENTER_RAIONS[cityVal];
      }
    }
    if ((!oblast || !raion) && window.SmartSearchEngine) {
      const found = findSettlementInEngine(cityVal, oblast);
      if (found) {
        if (!oblast) oblast = found.oblast;
        if (!raion && (!oblast || cleanOblastName(found.oblast).toLowerCase().includes(cleanOblastName(oblast).slice(0, 4).toLowerCase()))) {
          raion = found.raion;
        }
      }
    }

    let raionClean = cleanRaionName(raion).trim();
    const oblClean = cleanOblastName(oblast).trim();

    if (window.SmartSearchEngine && window.SmartSearchEngine.getHistoricalGeoInfo) {
      const hist = window.SmartSearchEngine.getHistoricalGeoInfo(cityVal, raionClean, oblClean);
      if (hist && hist.actualRaion) {
        raionClean = hist.actualRaion;
      }
    }
    const raionVal = raionClean ? (options.shortRegion ? `${raionClean} р-н` : `${raionClean} район`).trim() : '';
    const oblVal = oblClean ? (options.shortRegion ? `${oblClean} обл.` : `${oblClean} область`).trim() : '';

    const postalCodeVal = (branch.postalCode || branch.PostalCode || '').toString().trim();

    let weightNum = branch.totalMaxWeightAllowed || branch.maxWeight;
    if (!weightNum) {
      if (isCarg) weightNum = 1100;
      else if (isPost) weightNum = 20;
      else weightNum = 30;
    }
    const weightVal = `(до ${weightNum} кг)`;

    // Послідовне формування самостійних токенів у масив parts
    const parts = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      const nextTag = tags[i + 1];

      // 1. [Тип населеного пункту] + [Місто]
      if (tag === 'settlementType' && nextTag === 'city' && cityVal) {
        const fullSettlement = (sTypeVal ? sTypeVal + ' ' : '') + cityVal;
        if (fullSettlement.trim()) parts.push(fullSettlement.trim());
        i++;
        continue;
      }
      if (tag === 'settlementType') {
        if (sTypeVal) parts.push(sTypeVal);
        continue;
      }
      if (tag === 'city') {
        if (cityVal) parts.push(cityVal);
        continue;
      }

      // 2. [Тип точки] + [Номер]
      if (tag === 'branchType' && nextTag === 'number' && numberVal) {
        const branchFull = (branchTypeVal ? branchTypeVal + ' ' : '') + numberVal;
        if (branchFull.trim()) parts.push(branchFull.trim());
        i++;
        continue;
      }
      if (tag === 'number' && nextTag === 'branchType' && branchTypeVal) {
        const branchFull = numberVal + (branchTypeVal ? ' ' + branchTypeVal : '');
        if (branchFull.trim()) parts.push(branchFull.trim());
        i++;
        continue;
      }
      if (tag === 'branchType') {
        if (branchTypeVal) parts.push(branchTypeVal);
        continue;
      }
      if (tag === 'number') {
        if (numberVal) parts.push(numberVal);
        continue;
      }

      // 3. [Вулиця] + [Будинок]
      if (tag === 'street' && nextTag === 'house' && houseVal) {
        const fullStreet = (streetVal ? streetVal + ', ' : '') + houseVal;
        if (fullStreet.trim()) parts.push(fullStreet.trim());
        i++;
        continue;
      }
      if (tag === 'street') {
        if (streetVal) parts.push(streetVal);
        continue;
      }
      if (tag === 'house') {
        if (houseVal) parts.push(houseVal);
        continue;
      }

      // 4. [Район] + [Область]
      if (tag === 'raion' && nextTag === 'oblast' && oblVal) {
        if (raionVal) {
          parts.push(`${raionVal}, ${oblVal}`);
        } else {
          parts.push(oblVal);
        }
        i++;
        continue;
      }
      if (tag === 'raion') {
        if (raionVal) parts.push(raionVal);
        continue;
      }
      if (tag === 'oblast') {
        if (oblVal) parts.push(oblVal);
        continue;
      }

      // 5. Інші теги
      if (tag === 'service' && serviceVal) {
        parts.push(serviceVal);
        continue;
      }
      if (tag === 'postalCode' && postalCodeVal) {
        parts.push(postalCodeVal);
        continue;
      }
      if (tag === 'weight' && weightVal) {
        parts.push(weightVal);
        continue;
      }
    }

    // З'єднання токенів: за замовчуванням через ", "
    // Якщо опція noBranchWord вимкнена і вулиця йде після номера/типу/ваги, ставимо ": "
    let result = '';
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      if (p === 0) {
        result = part;
        continue;
      }
      const prevPart = parts[p - 1];
      const isStreetPart = streetVal && (part === streetVal || part.startsWith(streetVal + ','));
      const prevIsBranchOrWeight = prevPart && (
        (numberVal && prevPart.includes(numberVal)) ||
        (branchTypeVal && prevPart.includes(branchTypeVal)) ||
        (weightVal && prevPart.includes(weightVal))
      );

      if (!options.noBranchWord && isStreetPart && prevIsBranchOrWeight) {
        result += ': ' + part;
      } else {
        result += ', ' + part;
      }
    }

    return cleanOutputString(result);
  }

  // Публічна функція форматування з урахуванням кастомного пресету
  function formatBranchWithPreset(branch, targetTab = 'short') {
    const config = (userCopyPresets && userCopyPresets[targetTab]) || DEFAULT_COPY_PRESETS[targetTab];
    const detected = detectPresetType(targetTab, config);

    if (detected === 'default') {
      return targetTab === 'detailed'
        ? formatDetailedCopyStringDefault(branch)
        : formatClassicCopyStringDefault(branch);
    }

    return assembleCopyStringFromPreset(branch, config);
  }

  // 1. Класичний формат копіювання
  function formatClassicCopyString(branch) {
    return formatBranchWithPreset(branch, 'short');
  }

  // 2. Розширений детальний CRM-формат
  function formatDetailedCopyString(branch) {
    return formatBranchWithPreset(branch, 'detailed');
  }

  // Для зворотної сумісності: formatLpCrmCopyString повертає детальний формат
  function formatLpCrmCopyString(branch) {
    return formatDetailedCopyString(branch);
  }

  // Toast сповіщення про успішне копіювання
  function showToast(message) {
    let toast = document.getElementById('toastNotification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastNotification';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span>✓</span> <span>${escapeHtml(message)}</span>`;
    toast.classList.remove('hide');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.add('hide');
    }, 2800);
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    if (typeof ta.select === 'function') {
      ta.select();
    }
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('Fallback copy error:', e);
    }
    document.body.removeChild(ta);
  }

  function copyTextToClipboard(text, btnElement, successText = 'Скопійовано!', duration = 2000) {
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(() => {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
    } catch (e) {
      fallbackCopy(text);
    }

    if (btnElement) {
      if (!btnElement._originalHtml) {
        btnElement._originalHtml = btnElement.innerHTML;
      }
      if (btnElement._copyTimeout) {
        clearTimeout(btnElement._copyTimeout);
      }
      btnElement.classList.add('copied');
      btnElement.innerHTML = `<span>✓</span> <span>${successText}</span>`;
      btnElement._copyTimeout = setTimeout(() => {
        btnElement.classList.remove('copied');
        if (btnElement._originalHtml) {
          btnElement.innerHTML = btnElement._originalHtml;
          delete btnElement._originalHtml;
        }
        delete btnElement._copyTimeout;
      }, duration);
    }

    showToast(text);
  }

  // Створення повнорозмірної картки відділення (з'являється тільки при виборі конкретної адреси)
  function createFullBranchCard(branch, query = state.searchQuery) {
    const card = document.createElement('div');
    card.className = 'branch-card';

    let oblast = branch.oblast || branch.SettlementAreaDescription || '';
    let raion = branch.raion || branch.SettlementRegionsDescription || '';

    let sType = branch.settlementType || '';
    if (!sType && window.SmartSearchEngine) {
      const found = findSettlementInEngine(branch.city, oblast);
      if (found) sType = found.type;
    }
    if (!sType) sType = 'село';

    const isUkrposhta = state.currentService === 'ukrposhta' || (branch.id && branch.id.startsWith('up-'));
    const postalCode = (branch.postalCode || branch.number || branch.index || '').toString().trim();
    const classicCopyText = formatClassicCopyString(branch);
    const detailedCopyText = formatDetailedCopyString(branch);
    const cleanStreet = getCleanStreet(branch);
    const typeInfo = getTypeBadgeInfo(branch);
    const isPostomat = branch.type === 'poshtomat' || (branch.typeText && branch.typeText.includes('Поштомат')) || (branch.typeName && branch.typeName.includes('Поштомат')) || (branch.name && branch.name.includes('Поштомат'));

    const renaming = window.SmartSearchEngine
      ? window.SmartSearchEngine.detectRenaming(branch.city, (branch.name || '') + ' ' + (branch.street || branch.address || ''))
      : null;

    let renamingHtml = '';
    if (renaming) {
      renamingHtml = `
        <div class="branch-renamed-note" title="В LP-CRM може використовуватися попередня назва">
          ℹ️ Попередня назва (для LP-CRM): <strong>${escapeHtml(renaming.oldName)}</strong>
        </div>
      `;
    }

    let typeDisplay;
    if (isPostomatBranch(branch)) {
      typeDisplay = 'Поштомат';
    } else if (isCargoBranch(branch)) {
      typeDisplay = 'Вантажне відділення';
    } else {
      typeDisplay = 'Відділення';
    }

    const branchNumber = (branch.number || branch.Number || branch.postalCode || branch.PostalCode || branch.index || '').toString().trim();
    const cleanCity = cleanSettlementName(branch.city || '');

    if (!raion && OBLAST_CENTER_RAIONS[cleanCity]) {
      const oblClean = cleanOblastName(oblast);
      if (!oblClean || oblClean.toLowerCase().includes(cleanCity.slice(0, 4).toLowerCase())) {
        raion = OBLAST_CENTER_RAIONS[cleanCity];
      }
    }
    if ((!oblast || !raion) && window.SmartSearchEngine) {
      const found = findSettlementInEngine(cleanCity, oblast);
      if (found) {
        if (!oblast) oblast = found.oblast;
        if (!raion && (!oblast || cleanOblastName(found.oblast).toLowerCase().includes(cleanOblastName(oblast).slice(0, 4).toLowerCase()))) {
          raion = found.raion;
        }
      }
    }
    const oblClean = cleanOblastName(oblast);
    let raionClean = cleanRaionName(raion);

    let histGeo = null;
    if (window.SmartSearchEngine && window.SmartSearchEngine.getHistoricalGeoInfo) {
      histGeo = window.SmartSearchEngine.getHistoricalGeoInfo(cleanCity, raionClean, oblClean, branch);
      if (histGeo && histGeo.actualRaion) {
        raionClean = histGeo.actualRaion;
      }
    }

    const geoParts = [];
    if (raionClean) geoParts.push(`${raionClean} р-н`);
    if (oblClean) geoParts.push(`${oblClean} обл.`);
    const geoSub = geoParts.length > 0 ? `(${geoParts.join(', ')})` : '';

    const isBest = branch._isBestMatch !== false;
    const hlQuery = isBest ? query : '';
    const subHlQuery = getCitySubtitleHighlightQuery(hlQuery, cleanCity);

    const hlCity = highlightMatch(cleanCity, hlQuery);
    const hlNumber = highlightMatch(branchNumber, hlQuery);
    const hlStreet = highlightMatch(cleanStreet, hlQuery);
    let hlGeoSub = geoSub ? highlightMatch(geoSub, subHlQuery) : '';

    const oblDisplay = oblClean ? (oblClean.endsWith('область') ? oblClean : `${oblClean} область`) : '';
    let hlObl = oblDisplay ? highlightMatch(oblDisplay, subHlQuery) : '';

    if (isBest && hlStreet && hlStreet.includes('class="hl-match"')) {
      const streetTokensInMatch = hlStreet.match(/<mark class="hl-match">([^<]+)<\/mark>/g) || [];
      for (const mTag of streetTokensInMatch) {
        const textInside = mTag.replace(/<\/?mark[^>]*>/g, '');
        if (textInside.length >= 3) {
          if (hlGeoSub.includes(mTag)) hlGeoSub = hlGeoSub.split(mTag).join(textInside);
          if (hlObl.includes(mTag)) hlObl = hlObl.split(mTag).join(textInside);
        }
      }
    }
    const cityWithOblast = oblDisplay
      ? `${escapeHtml(sType)} ${hlCity.trim()}, ${hlObl.trim()}`.replace(/\s+,/g, ',')
      : `${escapeHtml(sType)} ${hlCity.trim()}`;
    const primaryLineText = `${sType} ${cleanCity}${oblDisplay ? ', ' + oblDisplay : ''} - ${typeDisplay} №${branchNumber}: ${cleanStreet}`;

    const fullSettlementText = `${sType} ${cleanCity}${geoSub ? ' ' + geoSub : ''}`;
    const hlSettlement = `${escapeHtml(sType)} ${hlCity.trim()}${hlGeoSub ? ' ' + hlGeoSub.trim() : ''}`
      .replace(/\(\s+/g, '(')
      .replace(/\s+,/g, ',');

    let historyHtml = '';
    if (histGeo && (histGeo.oldRaion || histGeo.oldName || histGeo.crmName)) {
      const hParts = [];
      if (histGeo.oldRaion) {
        hParts.push(`<span>До 2020 року: <strong>${escapeHtml(histGeo.oldRaion)} р-н</strong></span>`);
      }
      if (histGeo.oldName) {
        hParts.push(`<span>кол. назва: <strong>${escapeHtml(histGeo.oldName)}</strong></span>`);
      }
      if (histGeo.crmName) {
        hParts.push(`<span class="crm-hint-wrapper" title="Точна назва у випадаючому списку LP-CRM (натисніть, щоб скопіювати)">В LP-CRM: <button type="button" class="btn-copy-crm-hint" data-crm-name="${escapeHtml(histGeo.crmName)}"><strong>${escapeHtml(histGeo.crmName)}</strong><span class="crm-copy-icon" aria-hidden="true">📋</span></button></span>`);
      }
      historyHtml = `
      <div class="settlement-history-hint" title="Адміністративні довідкові дані та формат LP-CRM">
        <span class="history-icon">ℹ️</span> 
        ${hParts.join('\n        <span class="history-separator">•</span> ')}
      </div>
      `;
    }

    // СЦЕНАРІЙ 1: ШВИДКА УКРПОШТА ДЛЯ ЦЬОГО НАСЕЛЕНОГО ПУНКТУ (Варіант 1: Компактна кнопка-міст у футері)
    const targetGeoParts = [cleanCity];
    if (raionClean) targetGeoParts.push(raionClean);
    if (oblClean) targetGeoParts.push(oblClean);
    const targetGeoQuery = targetGeoParts.join(' ');

    let upBridgeBtnHtml = '';
    let upBranches = [];
    if (!isUkrposhta && window.SmartSearchEngine && typeof window.SmartSearchEngine.getUkrposhtaBranchesForSettlement === 'function') {
      upBranches = window.SmartSearchEngine.getUkrposhtaBranchesForSettlement(cleanCity, oblClean, raionClean);
      if (upBranches.length === 1) {
        const upB = upBranches[0];
        const upIdx = upB.index || upB.postalCode || upB.number;
        upBridgeBtnHtml = `
          <span class="card-action-sep" aria-hidden="true"></span>
          <button class="btn-copy-action btn-up-bridge" type="button" data-up-action="copy" data-up-idx="${escapeHtml(upIdx)}" title="Клік: скопіювати реквізити Укрпошти (${escapeHtml(upIdx)}). Подвійний клік: показати в Укрпошті">
            Укрпошта (${escapeHtml(upIdx)})
          </button>
        `;
      } else if (upBranches.length > 1) {
        upBridgeBtnHtml = `
          <span class="card-action-sep" aria-hidden="true"></span>
          <button class="btn-copy-action btn-up-bridge" type="button" data-up-action="switch-city" title="Перейти до пошуку Укрпошти у м. ${escapeHtml(cleanCity)}">
            Укрпошта (${upBranches.length} відд.) →
          </button>
        `;
      }
    } else if (isUkrposhta) {
      upBridgeBtnHtml = `
        <span class="card-action-sep" aria-hidden="true"></span>
        <button class="btn-copy-action btn-up-bridge" type="button" data-np-action="switch-city" title="Перейти до Нової Пошти у цьому населеному пункті">
          Нова пошта →
        </button>
      `;
    }

    card.innerHTML = `
      <!-- Рядок 1: місто [Місто], [Область] - [Тип] №[Номер]: [Вулиця] (одне речення без іконок та крапок) -->
      <div class="card-primary-line" title="${escapeHtml(primaryLineText)}">
        <span class="city-highlight">${cityWithOblast}</span>
        <span class="line-sep">-</span>
        <span class="branch-highlight">${escapeHtml(typeDisplay)} №${hlNumber}:</span>
        <span class="street-highlight">${hlStreet}</span>
      </div>

      <!-- Рядок 2: Населений пункт (район, область) -->
      <div class="card-geo-line" title="Населений пункт: ${escapeHtml(fullSettlementText)}">
        <span class="geo-label">Населений пункт:</span>
        <span class="geo-val">${hlSettlement}</span>
      </div>

      ${historyHtml}

      ${renamingHtml}

      <div class="card-foot">
        <div class="card-foot-actions">
          <button class="btn-copy-action btn-copy-short" type="button" title="Скопіювати класичний формат">
            Скопіювати
          </button>
          <button class="btn-copy-action btn-copy-detailed" type="button" title="Скопіювати розширений CRM-формат (з областю, районом та вагою)">
            Детально
          </button>
          ${upBridgeBtnHtml}
        </div>
        <div class="card-foot-meta">
          <span class="weight-pill ${typeInfo.cls}">${escapeHtml(typeInfo.label)}</span>
          <span class="status-pill"><span class="status-dot"></span> Працює</span>
        </div>
      </div>
    `;

    const btnCopyShort = card.querySelector('.btn-copy-short') || card.querySelector('.btn-copy-action');
    if (btnCopyShort) {
      btnCopyShort.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = btnCopyShort.getAttribute('data-copy') || formatClassicCopyString(branch);
        copyTextToClipboard(textToCopy, btnCopyShort, 'Скопійовано!');
        trackEvent('copy_branch_address', {
          branch_type: getBranchAnalyticsType(branch)
        });
      });
    }

    const btnCopyDetailed = card.querySelector('.btn-copy-detailed');
    if (btnCopyDetailed) {
      btnCopyDetailed.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = btnCopyDetailed.getAttribute('data-copy') || formatDetailedCopyString(branch);
        copyTextToClipboard(textToCopy, btnCopyDetailed, 'Детально скопійовано!');
        trackEvent('copy_branch_address', {
          branch_type: getBranchAnalyticsType(branch)
        });
      });
    }

    const btnCrm = card.querySelector('.btn-copy-crm-hint');
    if (btnCrm) {
      btnCrm.addEventListener('click', (e) => {
        e.stopPropagation();
        const textToCopy = btnCrm.getAttribute('data-crm-name');
        if (textToCopy) {
          copyTextToClipboard(textToCopy, btnCrm, 'Скопійовано для LP-CRM!');
          trackEvent('copy_crm_hint', { crm_name: textToCopy });
        }
      });
    }


    // Обробник кнопки швидкої Укрпошти / Нової Пошти у футері картки (Варіант 1)
    const upBridgeBtn = card.querySelector('.btn-up-bridge');
    if (upBridgeBtn) {
      const upAction = upBridgeBtn.getAttribute('data-up-action');
      const npAction = upBridgeBtn.getAttribute('data-np-action');
      if (upAction === 'copy' && upBranches.length === 1) {
        const upB = upBranches[0];
        const upIdx = upB.index || upB.postalCode || upB.number;
        upBridgeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const copyText = formatClassicCopyString(upB);
          copyTextToClipboard(copyText, upBridgeBtn, 'Скопійовано!');
          showToast(`✅ Скопійовано: ${copyText}`);
        });
        upBridgeBtn.addEventListener('dblclick', async (e) => {
          e.stopPropagation();
          const upQuery = `${targetGeoQuery} ${upIdx}`;
          await switchService('ukrposhta', upQuery, upB);
        });
      } else if (upAction === 'switch-city') {
        upBridgeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          currentInputSource = 'smart_banner';
          await switchService('ukrposhta', targetGeoQuery);
        });
      } else if (npAction) {
        upBridgeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          currentInputSource = 'smart_banner';
          await switchService('novaposhta', targetGeoQuery);
        });
      }
    }

    if (isUkrposhta && (!cleanStreet || cleanStreet.includes('ВПЗ') || cleanStreet.startsWith('вул. ВПЗ'))) {
      fetchLiveUkrposhtaAddress(branch, card);
    }

    return card;
  }

  // Автоматичне формування розширеного пошукового рядка: назва міста + район + обл + номер відділення
  function buildFullGeoQuery(branch, targetNum) {
    if (!branch) return '';
    const parts = [];
    const cName = cleanSettlementName(branch.city || '');
    if (cName) parts.push(cName);

    const cRaion = cleanRaionName(branch.raion || '');
    let cOblast = cleanOblastName(branch.oblast || '');
    if (cName.toLowerCase() === 'київ' && (!cOblast || cOblast.toLowerCase() === 'київ')) {
      cOblast = 'Київська';
    }

    if (cRaion && cRaion.toLowerCase() !== cName.toLowerCase()) {
      const rStem = cRaion.toLowerCase().slice(0, 4);
      const nStem = cName.toLowerCase().slice(0, 4);
      // Додаємо район, якщо він не має спільного кореня з містом (наприклад Ужгородський для Середнє, Бучанський для Макарів)
      if (rStem !== nStem) {
        parts.push(cRaion);
      }
    }

    if (cOblast && cOblast.toLowerCase() !== cName.toLowerCase()) {
      parts.push(cOblast);
    }

    const isUp = branch.service === 'ukrposhta' || (branch.id && String(branch.id).startsWith('up-'));
    const num = (isUp
      ? (branch.postalCode || branch.index || branch.number || targetNum || '')
      : (targetNum || branch.number || branch.postalCode || branch.index || '')
    ).toString().trim();
    if (num) {
      parts.push(num);
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // Очищення номера відділення/поштомату з пошукового рядка при закритті обраної картки
  function extractSettlementQueryFromInput(inputVal, branch) {
    let q = (inputVal || '').trim();
    if (branch && branch.number) {
      const numRegex = new RegExp(`(?:№|#|відділення|віділення|відділ|відд|вд|поштомат|почтомат|склад)?\\s*\\b${escapeRegex(branch.number.toString())}\\b`, 'gi');
      q = q.replace(numRegex, ' ');
    }
    if (branch && (branch.postalCode || branch.index)) {
      const idx = (branch.postalCode || branch.index).toString();
      const idxRegex = new RegExp(`\\b${escapeRegex(idx)}\\b`, 'g');
      q = q.replace(idxRegex, ' ');
    }
    q = q
      .replace(/(?<!\p{L})(?:поштомат|поштомати|почтомат|відділення|віділення|відділ|відд|вд|склад|п\/м|пм|№|#)(?!\p{L})/giu, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/[,\-:—–]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (q.length >= 2 && /[а-яА-Яa-zA-ZіІїЇєЄґҐ]/.test(q)) {
      return q;
    }

    if (branch && branch.city) {
      let base = cleanSettlementName(branch.city);
      const oblClean = cleanOblastName(branch.oblast || '');
      if (oblClean && !base.toLowerCase().includes(oblClean.toLowerCase().slice(0, 4))) {
        return `${base} ${oblClean}`;
      }
      return base;
    }
    return q;
  }

  function resetBranchSelection() {
    const previousBranch = state.selectedBranch;
    state.selectedBranch = null;
    activeResultIndex = -1;

    // 1) Знімати підсвітку/активний стан із маркера на карті
    if (typeof updateMapMarkersHighlight === 'function') {
      updateMapMarkersHighlight(null);
    } else if (previousBranch && typeof setMarkerHighlightedOnMap === 'function') {
      setMarkerHighlightedOnMap(previousBranch, false);
    }
    if (state.leafletMap) {
      state.leafletMap.closePopup();
    }

    // 2) Якщо активний таб фільтра порожній (наприклад, "Поштомати" у селі, де їх немає), не блокувати інтерфейс, а коректно скидати фільтр на "Всі"
    const resultsPool = (state.currentResults && state.currentResults.length > 0) ? state.currentResults : [];
    if (resultsPool.length > 0 && state.typeFilter !== 'all') {
      let hasMatching = false;
      if (state.typeFilter === 'postomat') {
        hasMatching = resultsPool.some(isPostomatBranch);
      } else if (state.typeFilter === 'cargo') {
        hasMatching = resultsPool.some(isCargoBranch);
      } else if (state.typeFilter === 'branch') {
        hasMatching = resultsPool.some(isRegularBranch);
      }
      if (!hasMatching) {
        state.typeFilter = 'all';
        updateTypeFilterUI();
      }
    }

    if (state.mapTypeFilter !== 'all') {
      state.mapTypeFilter = 'all';
      updateMapTypeFilterUI();
    }

    // 3) Очищаємо номер відділення/поштомату з інпуту, повертаючи запит населеного пункту
    const currentInputVal = dom.searchInput ? dom.searchInput.value : '';
    const targetCityQuery = extractSettlementQueryFromInput(currentInputVal, previousBranch);

    if (targetCityQuery) {
      if (dom.searchInput) {
        dom.searchInput.value = targetCityQuery;
      }
      state.searchQuery = targetCityQuery;
      state.lockedInputValue = null;
    }

    // 4) Плавне закриття картки та повернення до списку запропонованих відділень населеного пункту
    const container = dom.resultsList ? (dom.resultsList.querySelector('.selected-branch-container') || dom.resultsList.querySelector('.branch-card')) : null;
    if (container) {
      container.classList.add('closing');
    }

    setTimeout(() => {
      if (dom.btnResetSelectedBranch) {
        dom.btnResetSelectedBranch.classList.add('hidden');
      }

      const hasFullCityCache = state.currentResults &&
        state.currentResults.length > 1 &&
        previousBranch &&
        state.currentResults.every(b => canonCity(b.city) === canonCity(previousBranch.city));

      if (hasFullCityCache) {
        renderSearchResults(state.currentResults, targetCityQuery || state.searchQuery || '');
      } else if (targetCityQuery) {
        // Миттєво шукаємо та відображаємо всі інші відділення цього населеного пункту
        executeSearch(targetCityQuery, false, false, false);
      } else {
        if (dom.searchResultsSection) {
          dom.searchResultsSection.classList.add('hidden');
        }
        if (dom.resultsList) {
          dom.resultsList.innerHTML = '';
          if (typeof dom.resultsList.scrollTop !== 'undefined') {
            dom.resultsList.scrollTop = 0;
          }
        }
        if (state.isMapVisible && state.leafletMap) {
          updateVisibleMarkersFromViewport();
        }
      }
      if (dom.searchInput && !(dom.searchInput.dataset && dom.searchInput.dataset.demoTyping === '1')) {
        dom.searchInput.focus({ preventScroll: true });
      }
    }, container ? 120 : 0);
  }

  // Відмінювання слова "адреса" для точного українського лічильника результатів
  function formatAddressCount(n) {
    const abs = Math.abs(n);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${n} адрес`;
    if (mod10 === 1) return `${n} адреса`;
    if (mod10 >= 2 && mod10 <= 4) return `${n} адреси`;
    return `${n} адрес`;
  }

  function renderSearchResults(branches, query, didYouMeanText, missingTargetBranch, missingSettlement, didYouMeanData) {
    if (isAutocompleteOpen && !missingSettlement && !missingTargetBranch) {
      dom.searchResultsSection.classList.add('hidden');
      updateBottomBarVisibility();
      return;
    }

    // Zero Layout Shift (Варіант 3): фіксуємо поточну висоту списку ДО мутацій DOM, щоб уникнути forced reflow
    const prevResultsHeight = dom.resultsList ? dom.resultsList.offsetHeight : 0;

    dom.searchResultsSection.classList.remove('hidden');
    updateBottomBarVisibility();

    // 1. Фільтрація за типом (Всі | Вантажні | Відділення | Поштомати)
    let filtered = branches || [];
    let typedFiltered = filtered;
    if (state.typeFilter === 'postomat') {
      typedFiltered = filtered.filter(isPostomatBranch);
    } else if (state.typeFilter === 'cargo') {
      typedFiltered = filtered.filter(isCargoBranch);
    } else if (state.typeFilter === 'branch') {
      typedFiltered = filtered.filter(isRegularBranch);
    }

    // Якщо активний таб фільтра порожній (наприклад, "Поштомати" у селі, де їх немає), не блокувати інтерфейс, а коректно скидати фільтр на "Всі"
    if (state.typeFilter !== 'all' && typedFiltered.length === 0 && filtered.length > 0) {
      state.typeFilter = 'all';
      updateTypeFilterUI();
      typedFiltered = filtered;
    }
    filtered = typedFiltered;

    if (prevResultsHeight > 0 && dom.resultsList) {
      dom.resultsList.style.minHeight = `${prevResultsHeight}px`;
    }

    dom.resultsList.innerHTML = '';
    if (typeof dom.resultsList.scrollTop !== 'undefined') {
      dom.resultsList.scrollTop = 0;
    }

    // Відображення Google-style підказки (лише якщо є реальна помилка та не обрано конкретне відділення)
    if (didYouMeanText && dom.didYouMeanBox && !state.selectedBranch) {
      dom.didYouMeanBox.innerHTML = '';
      dom.didYouMeanBox.classList.remove('hidden');
      dom.didYouMeanBox.style.cursor = 'pointer';
      dom.didYouMeanBox.setAttribute('title', 'Натисніть, щоб підставити виправлену назву');
      dom.didYouMeanBox.innerHTML = `
        <span class="did-you-mean-icon" aria-hidden="true">💡</span>
        <span class="did-you-mean-label">Можливо, ви мали на увазі:</span>
        <a class="did-you-mean-link" id="linkDidYouMean" href="#" role="button">${escapeHtml(didYouMeanText)}</a>
      `;

      const handleDidYouMeanClick = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        let currentVal = dom.searchInput ? dom.searchInput.value : '';

        // 1. Прибираємо паразитарні символи на початку рядка (~, -, --, =, +, *, #, №, /, \ тощо)
        let cleaned = currentVal.trim().replace(/^[\s=+\-*•—–~#№\\\/]+/, '').trim();

        // 2. Точкова заміна помилкового токена на виправлену назву міста/села
        let newVal = cleaned;
        const rawToken = didYouMeanData && didYouMeanData.rawToken ? didYouMeanData.rawToken.trim() : null;
        const correctedToken = (didYouMeanData && didYouMeanData.correctedToken) || didYouMeanText;

        if (rawToken && correctedToken) {
          const esc = rawToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`(^|\\s)${esc}(\\s|$)`, 'iu');
          if (wordRegex.test(newVal)) {
            newVal = newVal.replace(wordRegex, `$1${correctedToken}$2`);
          } else {
            const simpleRegex = new RegExp(esc, 'iu');
            if (simpleRegex.test(newVal)) {
              newVal = newVal.replace(simpleRegex, correctedToken);
            } else {
              const numMatch = newVal.match(/\d+/);
              if (numMatch) {
                newVal = `${correctedToken} ${numMatch[0]}`;
              } else {
                newVal = correctedToken;
              }
            }
          }
        } else if (correctedToken) {
          newVal = correctedToken;
        }

        newVal = newVal.replace(/\s+/g, ' ').trim();
        if (dom.searchInput) {
          dom.searchInput.value = newVal;
        }
        if (dom.btnClearSearch) {
          dom.btnClearSearch.classList.remove('hidden');
        }
        dom.didYouMeanBox.classList.add('hidden');
        closeAutocomplete();
        executeSearch(newVal, true, true);
        if (dom.searchInput) {
          suppressNextFocusActivation = true;
          dom.searchInput.focus();
          suppressNextFocusActivation = false;
          const len = dom.searchInput.value.length;
          dom.searchInput.setSelectionRange(len, len);
        }
      };

      dom.didYouMeanBox.onclick = handleDidYouMeanClick;
      const link = document.getElementById('linkDidYouMean');
      if (link) {
        link.onclick = handleDidYouMeanClick;
      }
    } else if (missingTargetBranch && missingTargetBranch.number && missingTargetBranch.city && dom.didYouMeanBox && !state.selectedBranch) {
      const allPool = getAllCurrentServiceBranches();
      const mCityCanon = canonCity(missingTargetBranch.city);
      const mObl = cleanOblastName(missingTargetBranch.oblast || '').toLowerCase().slice(0, 4);
      const mRai = cleanRaionName(missingTargetBranch.raion || '').toLowerCase();
      const mRaiShort = mRai.slice(0, 4);
      let cityBranches = allPool.filter(b => {
        const bc = b._canonCity || canonCity(b.city);
        if (bc !== mCityCanon) return false;
        if (mObl && b.oblast && !b.oblast.toLowerCase().includes(mObl)) return false;
        if (mRai && b.raion && !b.raion.toLowerCase().includes(mRaiShort) && !areRaionsCompatible(mRai, b.raion)) return false;
        return true;
      });
      if (cityBranches.length === 0 && mRai) {
        cityBranches = allPool.filter(b => {
          const bc = b._canonCity || canonCity(b.city);
          if (bc !== mCityCanon) return false;
          if (mObl && b.oblast && !b.oblast.toLowerCase().includes(mObl)) return false;
          return true;
        });
      }

      const postomatCount = cityBranches.filter(isPostomatBranch).length;
      const regularBranches = cityBranches.filter(b => !isPostomatBranch(b));
      const stdNumsSet = new Set();
      const allRegNumsSet = new Set();
      regularBranches.forEach(b => {
        const rawNum = String(b.number || b.postalCode || b.index || '').trim();
        const n = parseInt(rawNum, 10);
        if (!isNaN(n) && n > 0 && String(n) === rawNum) {
          allRegNumsSet.add(n);
          const bName = b.name || '';
          if (n < 900 && !/^(?:Пункт|Склад)\b/i.test(bName) && !/ЗАКРИТОГО ТИПУ|Фулфілмент/i.test(bName)) {
            stdNumsSet.add(n);
          }
        }
      });
      const branchNums = Array.from(stdNumsSet.size > 0 ? stdNumsSet : allRegNumsSet).sort((a, b) => a - b);

      const formatPostomats = (n) => {
        const abs = Math.abs(n) % 100;
        const last = abs % 10;
        if (abs > 10 && abs < 20) return `${n} поштоматів`;
        if (last === 1) return `${n} поштомат`;
        if (last >= 2 && last <= 4) return `${n} поштомати`;
        return `${n} поштоматів`;
      };

      let typePrefix = 'м.';
      if (missingTargetBranch.settlement && missingTargetBranch.settlement.type) {
        const t = missingTargetBranch.settlement.type.toLowerCase();
        typePrefix = t === 'місто' ? 'м.' : (t === 'смт' ? 'смт' : (t === 'селище' ? 'сел.' : 'с.'));
      }

      const SMALL_CITY_BRANCH_LIMIT = 6;
      dom.didYouMeanBox.innerHTML = '';
      dom.didYouMeanBox.onclick = null;
      dom.didYouMeanBox.removeAttribute('title');

      if (branchNums.length > 0 && branchNums.length <= SMALL_CITY_BRANCH_LIMIT) {
        dom.didYouMeanBox.classList.remove('hidden');
        dom.didYouMeanBox.style.cursor = 'default';
        dom.didYouMeanBox.innerHTML = `
          <span class="did-you-mean-icon" aria-hidden="true">💡</span>
          <span class="did-you-mean-label">Відділення №<strong>${escapeHtml(String(missingTargetBranch.number))}</strong> немає. Діють:</span>
        `;
        const chipsWrap = document.createElement('span');
        chipsWrap.className = 'did-you-mean-chips';
        branchNums.forEach(num => {
          const btn = document.createElement('button');
          btn.className = 'did-you-mean-chip';
          btn.setAttribute('type', 'button');
          btn.setAttribute('data-branch-num', String(num));
          btn.setAttribute('title', `Перейти до відділення №${num}`);
          btn.textContent = `№${num}`;
          btn.addEventListener('click', (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();
            const nextQuery = [
              missingTargetBranch.city,
              missingTargetBranch.raion,
              missingTargetBranch.oblast,
              String(num)
            ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            if (dom.searchInput) dom.searchInput.value = nextQuery;
            if (dom.btnClearSearch) dom.btnClearSearch.classList.remove('hidden');
            dom.didYouMeanBox.classList.add('hidden');
            closeAutocomplete();
            executeSearch(nextQuery, true, true);
          });
          chipsWrap.appendChild(btn);
        });
        dom.didYouMeanBox.appendChild(chipsWrap);
        if (postomatCount > 0) {
          const metaEl = document.createElement('span');
          metaEl.className = 'did-you-mean-meta';
          metaEl.textContent = `• та ${formatPostomats(postomatCount)}`;
          dom.didYouMeanBox.appendChild(metaEl);
        }
      } else if (branchNums.length > SMALL_CITY_BRANCH_LIMIT) {
        const minNum = branchNums[0];
        const maxNum = branchNums[branchNums.length - 1];
        const postomatPart = postomatCount > 0 ? ` та ${formatPostomats(postomatCount)}` : '';
        dom.didYouMeanBox.classList.remove('hidden');
        dom.didYouMeanBox.style.cursor = 'default';
        dom.didYouMeanBox.innerHTML = `
          <span class="did-you-mean-icon" aria-hidden="true">💡</span>
          <span class="did-you-mean-label">Відділення №<strong>${escapeHtml(String(missingTargetBranch.number))}</strong> немає. У ${typePrefix} ${escapeHtml(missingTargetBranch.city)} діють <strong>відділення №${minNum}–${maxNum}</strong>${postomatPart}.</span>
        `;
      } else if (postomatCount > 0) {
        dom.didYouMeanBox.classList.remove('hidden');
        dom.didYouMeanBox.style.cursor = 'default';
        dom.didYouMeanBox.innerHTML = `
          <span class="did-you-mean-icon" aria-hidden="true">💡</span>
          <span class="did-you-mean-label">Відділення №<strong>${escapeHtml(String(missingTargetBranch.number))}</strong> немає. У ${typePrefix} ${escapeHtml(missingTargetBranch.city)} діють лише поштомати (${formatPostomats(postomatCount)}).</span>
        `;
      } else {
        dom.didYouMeanBox.classList.add('hidden');
      }
    } else if (dom.didYouMeanBox) {
      dom.didYouMeanBox.classList.add('hidden');
      dom.didYouMeanBox.onclick = null;
    }

    // СЦЕНАРІЙ 2: РОЗВИЛКА ЧИСЕЛ (Cross-Service Ambiguity Resolver)
    // Якщо в табі Нової Пошти введено 5-значний номер (напр. "львів 79040" або "79040"),
    // і цей номер є індексом Укрпошти, але в Новій Пошті немає відділення з цим номером:
    const crossBanner = dom.crossServiceBanner || document.getElementById('crossServiceBanner');
    if (crossBanner) {
      crossBanner.classList.add('hidden');
      crossBanner.innerHTML = '';
      if (state.currentService === 'novaposhta') {
        const queryText = (query || state.searchQuery || '').trim();
        const fiveDigitMatch = queryText.match(/\b\d{5}\b/);
        if (fiveDigitMatch && window.SmartSearchEngine && typeof window.SmartSearchEngine.getUkrposhtaBranchByIndex === 'function') {
          const targetCode = fiveDigitMatch[0];
          const upBranch = window.SmartSearchEngine.getUkrposhtaBranchByIndex(targetCode);
          if (upBranch) {
            const upCity = cleanSettlementName(upBranch.city);
            let sTypePrefix = '';
            if (window.SmartSearchEngine && typeof window.SmartSearchEngine.findSettlementByNameOrFuzzy === 'function') {
              const sFound = window.SmartSearchEngine.findSettlementByNameOrFuzzy(upCity, upBranch.region || upBranch.oblast);
              if (sFound && sFound.type) {
                const t = sFound.type.toLowerCase();
                if (t === 'місто') sTypePrefix = 'м.';
                else if (t === 'село') sTypePrefix = 'с.';
                else if (t.includes('смт') || t.includes('селище')) sTypePrefix = 'сел.';
              }
            }
            if (!sTypePrefix) {
              sTypePrefix = (upBranch.settlementType === 'село' || /село/i.test(upBranch.name || '')) ? 'с.' : 'м.';
            }
            const cityDisplay = `${sTypePrefix} ${upCity}`.trim();
            const upAddr = getCleanStreet(upBranch);
            const upObl = upBranch.region || upBranch.oblast || '';
            const upOblText = upObl ? ` (${cleanOblastName(upObl)} обл.)` : '';

            crossBanner.classList.remove('hidden');
            crossBanner.innerHTML = `
              <div class="smart-banner-main">
                <div class="smart-banner-content">
                  <div class="smart-banner-title">
                    Поштовий індекс — <strong class="up-code">${escapeHtml(targetCode)}</strong>: ${escapeHtml(cityDisplay)}, ${escapeHtml(upAddr)}${escapeHtml(upOblText)}
                  </div>
                </div>
              </div>
              <div class="smart-banner-actions">
                <button type="button" class="btn-cross-switch" id="btnCrossBannerSwitch">
                  Детальніше
                </button>
                <button type="button" class="btn-cross-copy" id="btnCrossBannerCopy">
                  Скопіювати
                </button>
              </div>
            `;

              const btnSwitch = crossBanner.querySelector('#btnCrossBannerSwitch') || crossBanner.querySelector('.btn-cross-switch');
              if (btnSwitch) {
                btnSwitch.onclick = async (e) => {
                  if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  const upQuery = `${upCity} ${targetCode}`;
                  await switchService('ukrposhta', upQuery, upBranch);
                };
              }

              const btnCopy = crossBanner.querySelector('#btnCrossBannerCopy') || crossBanner.querySelector('.btn-cross-copy');
              if (btnCopy) {
                btnCopy.onclick = (e) => {
                  if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  const copyText = formatClassicCopyString(upBranch);
                  copyTextToClipboard(copyText, btnCopy, 'Скопійовано!');
                  showToast(`✅ Скопійовано: ${copyText}`);
                };
              }
            }
          }
        }
      }

    // EMPTY STATE: Якщо нічого не знайдено
    if (filtered.length === 0) {
      if (!didYouMeanText && !missingTargetBranch && dom.didYouMeanBox) dom.didYouMeanBox.classList.add('hidden');
      if (dom.limitSelector) dom.limitSelector.style.display = 'none';
      // Панель табів залишається видимою, щоб можна було переключитись на інший таб
      applyTypeFiltersVisibility();
      dom.resultsCount.textContent = 'Знайдено: 0 відділень';

      if (missingTargetBranch) {
        let typePrefix = 'м.';
        if (missingTargetBranch.settlement && missingTargetBranch.settlement.type) {
          const t = missingTargetBranch.settlement.type.toLowerCase();
          typePrefix = t === 'місто' ? 'м.' : (t === 'смт' ? 'смт' : (t === 'селище' ? 'сел.' : 'с.'));
        }
        const cityPart = missingTargetBranch.city ? ` у ${typePrefix} ${escapeHtml(missingTargetBranch.city)}` : '';

        // Додаткові клікабельні підказки, щоб користувач міг одразу виправити запит
        const fallbackActions = [];
        const allPool = getAllCurrentServiceBranches();
        if (missingTargetBranch.city && allPool.length > 0) {
          const mCityCanon = canonCity(missingTargetBranch.city);
          const mObl = (missingTargetBranch.oblast || '').toLowerCase().slice(0, 4);
          const cityBranches = allPool.filter(b => {
            const bc = b._canonCity || canonCity(b.city);
            if (bc !== mCityCanon) return false;
            if (mObl && b.oblast && !b.oblast.toLowerCase().includes(mObl)) return false;
            return true;
          });
          if (cityBranches.length > 0) {
            const qCityOnly = [missingTargetBranch.city, missingTargetBranch.oblast].filter(Boolean).join(' ');
            fallbackActions.push({
              label: `Показати всі у ${typePrefix} ${missingTargetBranch.city} (${cityBranches.length})`,
              query: qCityOnly
            });
          } else if (missingTargetBranch.number) {
            const numStr = String(missingTargetBranch.number);
            const sameNumInOblast = mObl
              ? allPool.filter(b => b.oblast && b.oblast.toLowerCase().includes(mObl) && String(b.number) === numStr)
              : [];
            const seenCities = new Set();
            for (let i = 0; i < sameNumInOblast.length && fallbackActions.length < 3; i++) {
              const b = sameNumInOblast[i];
              const cKey = (b.city || '').toLowerCase();
              if (!seenCities.has(cKey)) {
                seenCities.add(cKey);
                fallbackActions.push({
                  label: `${b.city} №${b.number} (${b.oblast || ''})`,
                  query: `${b.city} ${b.oblast || ''} ${b.number}`.trim()
                });
              }
            }
          }
        }

        const suggestionsHtml = fallbackActions.length > 0
          ? `<div style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">
              ${fallbackActions.map((act, idx) => `<button type="button" class="btn-switch-service-bridge empty-fallback-btn" data-fallback-idx="${idx}">${escapeHtml(act.label)} →</button>`).join('')}
            </div>`
          : '';

        dom.resultsList.innerHTML = `
          <div class="empty-results-box" style="padding: 40px 16px; text-align: center; color: var(--text-muted); width: 100%;">
            <div style="font-size: 38px; margin-bottom: 12px;">⚠️</div>
            <h4 style="font-weight: 800; color: var(--text-main); font-size: 16px; margin-bottom: 6px;">
              Відділення або поштомат №${escapeHtml(missingTargetBranch.number)}${cityPart} не знайдено.
            </h4>
            <p style="font-size: 13px; max-width: 500px; margin: 0 auto; line-height: 1.5; color: var(--text-muted);">
              Перевірте правильність введеного номера.
            </p>
            ${suggestionsHtml}
          </div>
        `;
        dom.resultsList.querySelectorAll('.empty-fallback-btn').forEach(btn => {
          btn.onclick = () => {
            const idx = parseInt(btn.getAttribute('data-fallback-idx'), 10);
            const act = fallbackActions[idx];
            if (act && act.query) {
              if (dom.searchInput) dom.searchInput.value = act.query;
              state.selectedSettlement = null;
              executeSearch(act.query, true, true);
            }
          };
        });
        return;
      }

      const targetSettlement = missingSettlement || state.selectedSettlement || (
        (window.SmartSearchEngine && (query || state.searchQuery))
          ? (() => {
              const p = window.SmartSearchEngine.parseQuery(query || state.searchQuery);
              return (p && (p.detectedOblast || p.detectedRaion || (p.facets && (p.facets.oblast || p.facets.raion))))
                ? (p.detectedSettlement || p.matchedSettlement)
                : null;
            })()
          : null
      );

      if (targetSettlement) {
        const sType = (targetSettlement.type || 'село').toLowerCase();
        const shortType = sType === 'місто' ? 'м.' : (sType === 'смт' ? 'смт' : (sType === 'селище' ? 'сел.' : 'с.'));
        const sName = cleanSettlementName(targetSettlement.cleanName || targetSettlement.name);
        const sRaion = cleanRaionName(targetSettlement.cleanRaion || targetSettlement.raion);
        const sOblast = cleanOblastName(targetSettlement.cleanOblast || targetSettlement.oblast);
        const geoDesc = sRaion ? ` (${sRaion} р-н)` : (sOblast ? ` (${sOblast} обл.)` : '');
        const emptyTitle = `У ${shortType} ${sName}${geoDesc} відділень не знайдено`;

        const isNP = state.currentService === 'novaposhta';
        const svcName = isNP ? 'Нової Пошти' : 'Укрпошти';
        const altService = isNP ? 'ukrposhta' : 'novaposhta';
        const altSvcTitle = altService === 'ukrposhta' ? 'Укрпошті' : 'Новій пошті';
        const altSvcIcon = altService === 'ukrposhta' ? '📮' : '🏢';

        const altMatch = findAlternativeServiceBranchForQuery(targetSettlement, query || state.searchQuery);
        const altBranchFound = altMatch ? altMatch.branch : null;

        let altActionHtml = '';
        const altIdx = altMatch && altMatch.service === 'ukrposhta' ? altMatch.index : null;
        const altDetail = altIdx
          ? `(індекс ${altIdx})`
          : (altBranchFound && altBranchFound.number ? `(відділення №${altBranchFound.number})` : '');
        const btnText = `${altSvcIcon} Знайти в ${altSvcTitle} ${altDetail}`.trim() + ' →';

        altActionHtml = `
          <div style="margin-top: 18px;">
            <button type="button" class="btn-switch-service-bridge" id="btnSwitchServiceBridge">
              ${escapeHtml(btnText)}
            </button>
          </div>
        `;

        dom.resultsList.innerHTML = `
          <div class="empty-results-box" style="padding: 40px 16px; text-align: center; color: var(--text-muted); width: 100%;">
            <div style="font-size: 38px; margin-bottom: 12px;">📍</div>
            <h4 style="font-weight: 800; color: var(--text-main); font-size: 16px; margin-bottom: 6px;">
              ${escapeHtml(emptyTitle)}
            </h4>
            <p style="font-size: 13px; max-width: 500px; margin: 0 auto; line-height: 1.5; color: var(--text-muted);">
              У цьому населеному пункті наразі немає відкритих відділень або поштоматів ${svcName}.
            </p>
            ${altActionHtml}
          </div>
        `;

        const bridgeBtn = dom.resultsList.querySelector('#btnSwitchServiceBridge');
        if (bridgeBtn) {
          bridgeBtn.onclick = async () => {
            currentInputSource = 'smart_banner';
            if (altBranchFound) {
              const targetIdx = altBranchFound.index || altBranchFound.postalCode || altBranchFound.number;
              const targetQuery = targetIdx ? `${sName} ${targetIdx}` : [sName, sRaion, sOblast].filter(Boolean).join(' ');
              await switchService(altService, targetQuery, altBranchFound);
            } else {
              const targetQuery = [sName, sRaion, sOblast].filter(Boolean).join(' ');
              await switchService(altService, targetQuery);
            }
          };
        }
        safeRAF(() => {
          if (dom.resultsList) dom.resultsList.style.minHeight = '';
        });
        return;
      }
      const rawQ = query || state.searchQuery || '';
      const pcMatch = rawQ.match(/\b(\d{5})\b/);
      const directAltMatch = state.currentService === 'novaposhta' && pcMatch ? findAlternativeServiceBranchForQuery(null, rawQ) : null;
      const directUpBranch = directAltMatch ? directAltMatch.branch : null;
      const directUpHtml = directUpBranch ? `
        <div style="margin-top: 18px;">
          <button type="button" class="btn-switch-service-bridge" id="btnSwitchServiceBridgeDirect">
            ${escapeHtml(`📮 Знайти в Укрпошті (індекс ${directUpBranch.index || pcMatch[1]} — ${cleanSettlementName(directUpBranch.city || '')}) →`)}
          </button>
        </div>
      ` : '';

      dom.resultsList.innerHTML = `
        <div style="padding: 36px 16px; text-align: center; color: var(--text-muted); width: 100%;">
          <div style="font-size: 36px; margin-bottom: 10px;">🔍</div>
          <h4 style="font-weight: 800; color: var(--text-main); font-size: 16px; margin-bottom: 6px;">
            Населений пункт або відділення не знайдено
          </h4>
          <p style="font-size: 13px; max-width: 500px; margin: 0 auto; line-height: 1.5;">
            За запитом «${escapeHtml(rawQ)}» нічого не знайдено. Перевірте правильність написання міста або номера відділення.
          </p>
          ${directUpHtml}
        </div>
      `;
      if (directUpBranch) {
        const directBtn = dom.resultsList.querySelector('#btnSwitchServiceBridgeDirect');
        if (directBtn) {
          directBtn.onclick = async () => {
            currentInputSource = 'smart_banner';
            const upIdx = String(directUpBranch.index || directUpBranch.postalCode || pcMatch[1]);
            const upCity = cleanSettlementName(directUpBranch.city || '');
            const targetQuery = upCity ? `${upCity} ${upIdx}` : upIdx;
            await switchService('ukrposhta', targetQuery, directUpBranch);
          };
        }
      }
      safeRAF(() => {
        if (dom.resultsList) dom.resultsList.style.minHeight = '';
      });
      return;
    }

    // РЕЖИМ 1: КОРИСТУВАЧ ОБРАВ КОНКРЕТНЕ ВІДДІЛЕННЯ (або є 1 точний результат)
    // Повну картку показуємо тільки коли вже вибрано конкретну адресу!
    // Зайві елементи масового списку (ліміти 5/10/20, фільтри) ховаємо для 100% фокусу на картці.
    if (state.selectedBranch) {
      if (searchResultsIntersectionObserver) {
        searchResultsIntersectionObserver.disconnect();
        searchResultsIntersectionObserver = null;
      }
      currentSearchResults = [];
      renderedSearchResultsCount = 0;
      const oldSentinel = document.getElementById('infiniteScrollSentinel');
      if (oldSentinel && oldSentinel.parentNode) {
        oldSentinel.parentNode.removeChild(oldSentinel);
      }
      if (dom.limitSelector) dom.limitSelector.style.display = 'none';
      const hasExplicitTargetNum = Boolean(query && /\d/.test(query));
      if (hasExplicitTargetNum) {
        if (dom.resultsTypeFilters) dom.resultsTypeFilters.style.display = 'none';
      } else {
        applyTypeFiltersVisibility();
      }
      if (dom.btnResetSelectedBranch) dom.btnResetSelectedBranch.classList.remove('hidden');
      dom.resultsCount.textContent = `1 обране відділення`;
      const branch = state.selectedBranch;

      const container = document.createElement('div');
      container.className = 'selected-branch-container';
      container.style.width = '100%';

      const card = createFullBranchCard(branch, query || state.searchQuery);
      card.addEventListener('mouseenter', () => setMarkerHighlightedOnMap(branch, true));
      card.addEventListener('mouseleave', () => setMarkerHighlightedOnMap(branch, false));
      container.appendChild(card);
      dom.resultsList.classList.remove('has-match-rows');
      if (dom.searchResultsSection) dom.searchResultsSection.classList.remove('has-address-list');
      dom.resultsList.appendChild(container);
      safeRAF(() => {
        if (dom.resultsList) dom.resultsList.style.minHeight = '';
      });
      return;
    }

    // РЕЖИМ 2: ПОШУК ПО АДРЕСІ — ПОКАЗУЄМО СУТО ЗБІГИ АДРЕСИ В 1 КОЛОНКУ (як в LP-CRM)
    dom.resultsList.classList.add('has-match-rows');
    if (dom.searchResultsSection) dom.searchResultsSection.classList.add('has-address-list');
    if (dom.limitSelector) dom.limitSelector.style.display = 'none';
    if (dom.btnResetSelectedBranch) dom.btnResetSelectedBranch.classList.add('hidden');
    applyTypeFiltersVisibility();

    currentSearchResults = filtered;
    renderedSearchResultsCount = 0;
    activeResultIndex = -1;

    if (searchResultsIntersectionObserver) {
      searchResultsIntersectionObserver.disconnect();
      searchResultsIntersectionObserver = null;
    }

    const oldSentinel = document.getElementById('infiniteScrollSentinel');
    if (oldSentinel && oldSentinel.parentNode) {
      oldSentinel.parentNode.removeChild(oldSentinel);
    }

    dom.resultsCount.textContent = `Знайдено: ${formatAddressCount(filtered.length)}`;

    // Початковий рендер у DOM: вставляємо лише першу порцію з 20 карток через DocumentFragment
    appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);

    // Якщо залишились елементи для підвантаження — додаємо невидимий якір для IntersectionObserver
    if (renderedSearchResultsCount < currentSearchResults.length) {
      let sentinel = document.getElementById('infiniteScrollSentinel');
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'infiniteScrollSentinel';
        sentinel.style.height = '20px';
        sentinel.style.width = '100%';
        sentinel.setAttribute('aria-hidden', 'true');
      }
      dom.resultsList.appendChild(sentinel);
      setupSearchResultsObserver(sentinel);
    }
    safeRAF(() => {
      if (dom.resultsList) dom.resultsList.style.minHeight = '';
    });
  }

  const SEARCH_RESULTS_CHUNK_SIZE = 20;
  let currentSearchResults = [];
  let renderedSearchResultsCount = 0;
  let searchResultsIntersectionObserver = null;

  function appendNextSearchResultsChunk(chunkSize = SEARCH_RESULTS_CHUNK_SIZE) {
    if (!dom.resultsList || renderedSearchResultsCount >= currentSearchResults.length) return;

    const fragment = (typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function')
      ? document.createDocumentFragment()
      : document.createElement('div');

    const nextEnd = Math.min(currentSearchResults.length, renderedSearchResultsCount + chunkSize);
    for (let i = renderedSearchResultsCount; i < nextEnd; i++) {
      const el = createAddressMatchRowElement(currentSearchResults[i], state.searchQuery);
      fragment.appendChild(el);
    }
    renderedSearchResultsCount = nextEnd;

    const sentinel = document.getElementById('infiniteScrollSentinel');
    if (sentinel && sentinel.parentNode === dom.resultsList) {
      dom.resultsList.insertBefore(fragment, sentinel);
    } else {
      dom.resultsList.appendChild(fragment);
    }

    if (renderedSearchResultsCount >= currentSearchResults.length) {
      if (searchResultsIntersectionObserver) {
        searchResultsIntersectionObserver.disconnect();
        searchResultsIntersectionObserver = null;
      }
      if (sentinel && sentinel.parentNode) {
        sentinel.parentNode.removeChild(sentinel);
      }
    }
  }

  function setupSearchResultsObserver(sentinel) {
    if (searchResultsIntersectionObserver) {
      searchResultsIntersectionObserver.disconnect();
      searchResultsIntersectionObserver = null;
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const isInternalScroll = dom.resultsList && dom.resultsList.classList.contains('has-match-rows');
      searchResultsIntersectionObserver = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && renderedSearchResultsCount < currentSearchResults.length) {
            appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);
          }
        }
      }, {
        root: isInternalScroll ? dom.resultsList : null,
        rootMargin: '250px',
        threshold: 0.01
      });
      searchResultsIntersectionObserver.observe(sentinel);
    }
  }

  function createAddressMatchRowElement(branch, query) {
    const row = document.createElement('div');
    row.className = 'address-match-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    let sType = branch.settlementType || '';
    if (!sType && window.SmartSearchEngine) {
      if (typeof window.SmartSearchEngine.getSettlementType === 'function') {
        sType = window.SmartSearchEngine.getSettlementType(branch.city, branch.oblast);
      } else {
        const found = findSettlementInEngine(branch.city, branch.oblast);
        if (found) sType = found.type;
      }
    }
    if (!sType) sType = 'місто';

    const cleanStreet = getCleanStreet(branch);
    const geoSub = formatGeoSub(branch);
    const typeInfo = getTypeBadgeInfo(branch);
    const isPostomat = isPostomatBranch(branch);
    const isCargo = isCargoBranch(branch);
    const isUkrposhta = state.currentService === 'ukrposhta' || (branch.id && branch.id.startsWith('up-'));
    const branchNumber = (branch.number || branch.Number || branch.postalCode || branch.PostalCode || '').toString().trim();
    const postalCode = (branch.postalCode || branch.PostalCode || '').toString().trim();

    let typeDisplay;
    if (isPostomat) {
      typeDisplay = 'Поштомат';
    } else if (isCargo) {
      typeDisplay = 'Вантажне відділення';
    } else {
      typeDisplay = 'Відділення';
    }

    const cleanCity = cleanSettlementName(branch.city || '');
    const isBest = branch._isBestMatch !== false;
    const hlQuery = isBest ? (query || state.searchQuery) : '';
    const subHlQuery = getCitySubtitleHighlightQuery(hlQuery, cleanCity);

    const hlNumber = highlightMatch(branchNumber, hlQuery);
    const hlStreet = highlightMatch(cleanStreet, hlQuery);
    const hlCity = highlightMatch(cleanCity, hlQuery);
    let hlGeoSub = geoSub ? highlightMatch(geoSub, subHlQuery) : '';

    if (isBest && hlStreet && hlStreet.includes('class="hl-match"')) {
      const streetTokensInMatch = hlStreet.match(/<mark class="hl-match">([^<]+)<\/mark>/g) || [];
      for (const mTag of streetTokensInMatch) {
        const textInside = mTag.replace(/<\/?mark[^>]*>/g, '');
        if (textInside.length >= 3 && hlGeoSub.includes(mTag)) {
          hlGeoSub = hlGeoSub.split(mTag).join(textInside);
        }
      }
    }


    const branchTitle = `${typeDisplay} №${hlNumber}: <span class="street-part">${hlStreet}</span>`;
    const locationSub = `${escapeHtml(sType)} ${hlCity}${hlGeoSub ? ' ' + hlGeoSub : ''}`;

    row.innerHTML = `
      <div class="address-match-left">
        <div class="address-match-icon">${isPostomat ? '📦' : '🏢'}</div>
        <div class="address-match-content">
          <div class="address-match-title">${branchTitle}</div>
          <div class="address-match-sub">${locationSub}</div>
        </div>
      </div>
      <div class="address-match-right">
        ${isUkrposhta && postalCode ? `<span class="ukrposhta-index-badge-sm">📮 ${escapeHtml(postalCode)}</span>` : ''}
        <span class="weight-pill ${typeInfo.cls}">${escapeHtml(typeInfo.label)}</span>
      </div>
    `;

    const selectThis = () => {
      state.selectedBranch = branch;
      const bNum = branch.number || branch.postalCode || branch.index;
      const fullGeoQuery = buildFullGeoQuery(branch, bNum);
      if (fullGeoQuery && dom.searchInput) {
        dom.searchInput.value = fullGeoQuery;
        state.searchQuery = fullGeoQuery;
        state.lockedInputValue = fullGeoQuery;
      }
      state.selectedSettlement = {
        cleanName: cleanSettlementName(branch.city),
        name: cleanSettlementName(branch.city),
        cleanRaion: cleanRaionName(branch.raion || ''),
        raion: cleanRaionName(branch.raion || ''),
        cleanOblast: cleanOblastName(branch.oblast || ''),
        oblast: cleanOblastName(branch.oblast || ''),
        type: branch.settlementType || 'місто'
      };
      renderSearchResults(currentSearchResults.length > 0 ? currentSearchResults : state.currentResults, fullGeoQuery || query, null, null, null, null);
      if (state.isMapVisible && state.leafletMap && branch.lat && branch.lng) {
        state.leafletMap.flyTo([branch.lat, branch.lng], 15, { duration: 1.0 });
      }
    };

    row.addEventListener('mouseenter', () => {
      setMarkerHighlightedOnMap(branch, true);
      if (activeResultIndex !== -1 && dom.resultsList) {
        const prevFocused = dom.resultsList.querySelector('.address-match-row.focused');
        if (prevFocused && prevFocused !== row) {
          prevFocused.classList.remove('focused');
          prevFocused.removeAttribute('aria-selected');
        }
      }
    });
    row.addEventListener('mouseleave', () => setMarkerHighlightedOnMap(branch, false));

    row.addEventListener('click', selectThis);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectThis();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = row.nextElementSibling;
        if (next && next.classList && next.classList.contains('address-match-row')) {
          next.focus();
          if (typeof next.scrollIntoView === 'function') next.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = row.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('address-match-row')) {
          prev.focus();
          if (typeof prev.scrollIntoView === 'function') prev.scrollIntoView({ block: 'nearest' });
        } else if (dom.searchInput) {
          dom.searchInput.focus();
        }
      }
    });

    if (isUkrposhta && (!cleanStreet || cleanStreet.includes('ВПЗ') || cleanStreet.startsWith('вул. ВПЗ'))) {
      fetchLiveUkrposhtaAddress(branch, row);
    }

    return row;
  }



  // ==========================================================================
  // 3. АНАЛІЗ НАЙЧАСТІШИХ ЗАПИТІВ ДНЯ
  // ==========================================================================
  // Реальна статистика: рахується з нуля, зберігається за ковзне вікно 14 днів,
  // старі дні впливають на рейтинг слабше (експоненційне згасання).
  const FREQ_STORAGE_KEY = 'frequent_queries_v3';
  const FREQ_WINDOW_DAYS = 14;
  const FREQ_DECAY = 0.85;
  const FREQ_SLOTS = 10;

  function getDayKey(date) {
    const d = date || new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  function dayKeyToAge(key) {
    const [y, m, d] = key.split('-').map(Number);
    const then = new Date(y, m - 1, d).getTime();
    const today = new Date();
    const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    return Math.round((now - then) / 86400000);
  }

  function cleanupLegacyFrequentKeys() {
    // Старі ключі freq_queries_YYYY_M_D містили штучно завищені дефолтні лічильники
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^freq_queries_\d/.test(k)) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }

  function loadFrequentStore() {
    cleanupLegacyFrequentKeys();
    let store = { days: {} };
    try {
      const raw = localStorage.getItem(FREQ_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.days && typeof parsed.days === 'object') store = parsed;
      }
    } catch (e) {
      console.error('Помилка парсингу частих запитів', e);
    }
    Object.keys(store.days).forEach(day => {
      const age = dayKeyToAge(day);
      if (!(age >= 0 && age < FREQ_WINDOW_DAYS)) delete store.days[day];
    });
    return store;
  }

  function saveFrequentStore(store) {
    try {
      localStorage.setItem(FREQ_STORAGE_KEY, JSON.stringify(store));
    } catch (e) { /* ignore */ }
  }

  function getFrequentQueries() {
    const store = loadFrequentStore();
    const agg = new Map();
    Object.keys(store.days).forEach(day => {
      const weight = Math.pow(FREQ_DECAY, dayKeyToAge(day));
      const entries = store.days[day] || {};
      Object.keys(entries).forEach(lower => {
        const e = entries[lower];
        if (!e || !e.q || !(e.c > 0)) return;
        const cur = agg.get(lower) || { query: e.q, count: 0, score: 0 };
        cur.count += e.c;
        cur.score += e.c * weight;
        agg.set(lower, cur);
      });
    });

    const real = Array.from(agg.values())
      .sort((a, b) => (b.score - a.score) || (b.count - a.count))
      .slice(0, FREQ_SLOTS)
      .map(({ query, count }) => ({ query, count }));

    if (real.length < FREQ_SLOTS) {
      const used = new Set(real.map(r => r.query.toLowerCase()));
      for (const def of DEFAULT_CITIES) {
        if (real.length >= FREQ_SLOTS) break;
        if (!used.has(def.query.toLowerCase())) real.push({ query: def.query, count: 0 });
      }
    }
    return real;
  }

  // Один пошуковий «сеанс» = одне зарахування: уточнення того ж міста
  // (Київ → Київ 123 + Enter) не рахується повторно. Сеанс скидається
  // очищенням поля, кліком по чіпу або запитом іншого міста.
  let lastRecordedFreqKey = null;
  function resetFrequentSession() {
    lastRecordedFreqKey = null;
  }

  function recordFrequentQuery(query) {
    const normalized = (query || '').trim();
    if (!normalized || normalized.length < 2) return;
    if (lastRecordedFreqKey === normalized.toLowerCase()) return;
    lastRecordedFreqKey = normalized.toLowerCase();

    const store = loadFrequentStore();
    const day = getDayKey();
    const lower = normalized.toLowerCase();
    if (!store.days[day]) store.days[day] = {};
    const entry = store.days[day][lower];
    if (entry) {
      entry.c += 1;
      entry.q = normalized;
    } else {
      store.days[day][lower] = { q: normalized, c: 1 };
    }
    saveFrequentStore(store);
    renderFrequentChips();
  }

  function renderFrequentChips(list) {
    const items = list || getFrequentQueries();
    dom.frequentChipsGrid.innerHTML = '';

    const hasReal = items.some(i => i.count > 0);
    const subtext = document.getElementById('frequentSubtext');
    if (subtext) {
      subtext.textContent = hasReal ? 'Ваші найчастіші запити за 14 днів' : 'Швидкий вибір міста';
    }
    const titleEl = document.getElementById('frequentTitleText');
    if (titleEl) titleEl.textContent = hasReal ? 'Найчастіші запити' : 'Швидкий вибір';

    items.forEach(item => {
      const chip = document.createElement('button');
      chip.className = 'query-chip-btn';
      chip.setAttribute('type', 'button');
      chip.innerHTML = `
        <span class="chip-text">${escapeHtml(item.query)}</span>
        ${item.count > 0
          ? `<span class="chip-count" title="${item.count} запитів за 14 днів">${item.count}</span>`
          : `<span class="chip-count" title="Запитів поки не було">0</span>`}
      `;

      chip.addEventListener('click', (e) => {
        e.preventDefault();
        clearTimeout(settledQueryTimer);
        clearTimeout(zeroResultsDebounceTimer);
        currentInputSource = 'frequent_chip';
        resetFrequentSession();
        const q = (item.query || '').trim();
        if (!q) return;

        dom.searchInput.value = q;
        dom.btnClearSearch.classList.remove('hidden');

        // Якщо в запиті є цифри (наприклад, конкретне відділення або індекс), виконуємо прямий пошук
        if (/\d/.test(q)) {
          executeSearch(q, true, true);
          focusSearchInputAtEnd(true);
          setTimeout(() => focusSearchInputAtEnd(true), 25);
          return;
        }

        // Якщо це шаблон населеного пункту (Львів, Київ тощо):
        // Скидаємо попередній вибір, приховуємо нижній масив карток відділень
        // та миттєво відкриваємо випадаючий список автокомпліту з варіантами (із областями/районами)
        state.selectedSettlement = null;
        state.selectedBranch = null;
        state.lockedInputValue = null;
        if (dom.btnResetSelectedBranch) {
          dom.btnResetSelectedBranch.classList.add('hidden');
        }
        if (dom.searchResultsSection) {
          dom.searchResultsSection.classList.add('hidden');
        }
        closeAutocomplete();
        triggerAutocomplete(q);

        const suggCount = (autocompleteItems && autocompleteItems.length) ? autocompleteItems.length : 1;
        updateSearchSessionState(q, suggCount, 'frequent_chip');
        logFailureTelemetry({
          query: q,
          service: state.currentService,
          status: '🔵 Вибір: Швидкі міста (Чіп)',
          resultsCount: suggCount,
          duration: 1,
          details: `Клік по чіпу швидкого вибору міста (показано підказок: ${suggCount}).`
        });

        focusSearchInputAtEnd(true);
      });

      dom.frequentChipsGrid.appendChild(chip);
    });
  }

  // ==========================================================================
  // 4. ІСТОРІЯ ОСТАННІХ ПОШУКІВ ЗА 5 ДНІВ
  // ==========================================================================
  const HISTORY_STORAGE_KEY = 'search_history_v2';
  const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

  function getSearchHistory() {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      const now = Date.now();
      return [
        { query: '47501', service: 'ukrposhta', timestamp: now - 1000 * 60 * 2, count: 1 },
        { query: 'Київ Головпоштамт', service: 'ukrposhta', timestamp: now - 1000 * 60 * 20, count: 3 },
        { query: 'Дніпро Яворницького', service: 'novaposhta', timestamp: now - 1000 * 60 * 60 * 3, count: 2 },
        { query: 'Львів Відділення 1', service: 'novaposhta', timestamp: now - 1000 * 60 * 60 * 24, count: 1 },
        { query: 'Бережани Відділення 1', service: 'novaposhta', timestamp: now - 1000 * 60 * 60 * 48, count: 1 }
      ];
    }

    try {
      const list = JSON.parse(raw);
      const now = Date.now();
      return list.filter(item => now - item.timestamp <= FIVE_DAYS_MS);
    } catch (e) {
      return [];
    }
  }

  function saveSearchHistory(list) {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
  }

  function recordSearchHistory(query, resultsCount) {
    const list = getSearchHistory();
    const filtered = list.filter(item => !(item.query.toLowerCase() === query.toLowerCase() && item.service === state.currentService));

    filtered.unshift({
      query: query,
      service: state.currentService,
      timestamp: Date.now(),
      count: resultsCount
    });

    const topFive = filtered.filter(item => item.service === state.currentService).slice(0, 5);
    const otherServices = filtered.filter(item => item.service !== state.currentService).slice(0, 5);
    saveSearchHistory(topFive.concat(otherServices));
    renderRecentHistory();
  }

  function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Щойно';
    if (minutes < 60) return `${minutes} хв тому`;
    if (hours < 24) return `${hours} год тому`;
    if (days === 1) return 'Вчора';
    return `${days} дн. тому`;
  }

  function renderRecentHistory(items) {
    const list = (items || getSearchHistory()).filter(item => item.service === state.currentService);
    dom.recentHistoryList.innerHTML = '';

    if (list.length === 0) {
      dom.recentHistoryList.innerHTML = `
        <div class="history-empty-state">
          Історія пошуків порожня. Виконайте пошук, щоб тут збереглися останні запити за 5 днів.
        </div>
      `;
      return;
    }

    const fragment = (typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function')
      ? document.createDocumentFragment()
      : document.createElement('div');

    list.slice(0, 5).forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card-item';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const isNP = item.service === 'novaposhta';
      const badgeClass = isNP ? 'np' : 'up';
      const badgeText = isNP ? 'НП' : 'Укрпошта';

      card.innerHTML = `
        <div class="history-card-left">
          <span class="history-service-badge ${badgeClass}">${badgeText}</span>
          <span class="history-query-text">${escapeHtml(item.query)}</span>
        </div>
        <div class="history-card-right">
          <span class="history-timestamp">${formatRelativeTime(item.timestamp)}</span>
          <span class="history-rerun-icon" title="Повторити пошук">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </span>
        </div>
      `;

      card.addEventListener('click', async (e) => {
        e.preventDefault();
        clearTimeout(settledQueryTimer);
        clearTimeout(zeroResultsDebounceTimer);
        currentInputSource = 'history_card';
        const q = (item.query || '').trim();
        if (!q) return;

        // Скидаємо зафіксований вибір перед перевіркою, щоб гола назва міста з історії відкривала поп-ап
        state.selectedSettlement = null;
        state.selectedBranch = null;
        state.lockedInputValue = null;

        if (!/\d/.test(q) && !hasFixedSettlementContext(q)) {
          if (state.currentService !== item.service) {
            if (dom.searchInput) dom.searchInput.value = '';
            await switchService(item.service);
          }
          dom.searchInput.value = q;
          dom.btnClearSearch.classList.remove('hidden');
          if (dom.btnResetSelectedBranch) {
            dom.btnResetSelectedBranch.classList.add('hidden');
          }
          if (dom.searchResultsSection) {
            dom.searchResultsSection.classList.add('hidden');
          }
          closeAutocomplete();
          triggerAutocomplete(q);

          const suggCount = (autocompleteItems && autocompleteItems.length) ? autocompleteItems.length : 1;
          updateSearchSessionState(q, suggCount, 'history_card');
          logFailureTelemetry({
            query: q,
            service: state.currentService,
            status: '🔵 Вибір: Історія пошуків',
            resultsCount: suggCount,
            duration: 1,
            details: `Повторний запуск із карток історії пошуків (показано підказок: ${suggCount}).`
          });
          focusSearchInputAtEnd(true);
          setTimeout(() => focusSearchInputAtEnd(true), 25);
          return;
        }

        if (state.currentService !== item.service) {
          await switchService(item.service, q);
        }
        dom.searchInput.value = q + ' ';
        dom.btnClearSearch.classList.remove('hidden');
        executeSearch(q, true, true);
        focusSearchInputAtEnd(true);
        setTimeout(() => focusSearchInputAtEnd(true), 25);
      });

      fragment.appendChild(card);
    });

    dom.recentHistoryList.appendChild(fragment);
  }

  // ==========================================================================
  // 5. ТЕМНА / СВІТЛА КАРТА LEAFLET (АДАПТИВНІ ТАЙЛИ + АВТОФОЛБЕК + ZERO-KEY GPU-DARK)
  // ==========================================================================
  const ukraineBounds = (typeof L !== 'undefined' && L.latLngBounds)
    ? L.latLngBounds(L.latLng(44.0, 22.0), L.latLng(52.5, 40.5))
    : null;

  // Визначення протоколу file:// (локальне відкриття файлу без вебсервера):
  // Сервери tile.openstreetmap.org блокують браузерні запити без заголовка Referer (HTTP 403 Access Blocked).
  // Для file:// та в якості відмовостійкого CDN використовуємо Esri World Street Map (працює без API-ключа, без водяних знаків та без обмежень за Referer).
  const isLocalFileProtocol = typeof window !== 'undefined' && window.location && window.location.protocol === 'file:';

  const MAP_TILES = {
    light: {
      url: isLocalFileProtocol
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        subdomains: isLocalFileProtocol ? '' : 'abc',
        attribution: isLocalFileProtocol
          ? 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> &mdash; OpenStreetMap contributors'
          : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    },
    dark: {
      // Для темної теми використовується той самий високошвидкісний шар плиток з апаратним GPU-фільтром Obsidian Dark у CSS.
      // Це повністю усуває залежність від сторонніх заблокованих API-ключів Carto (водяний знак "API KEY REQUIRED"),
      // гарантує 0 мс перемикання між темами та заощаджує мережевий трафік без зайвих повторних запитів.
      url: isLocalFileProtocol
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        subdomains: isLocalFileProtocol ? '' : 'abc',
        attribution: isLocalFileProtocol
          ? 'Tiles &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> &mdash; OpenStreetMap contributors'
          : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }
    }
  };

  function createOptimizedTileLayer(tileConf) {
    if (typeof L === 'undefined' || !tileConf) return null;

    const layer = L.tileLayer(tileConf.url, {
      ...tileConf.options,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: true
    });

    // Автоматичний захист від блокувань 403 / збоїв мережі:
    // якщо плитка не завантажилася, непомітно підвантажуємо її з резервного CDN Esri
    layer.on('tileerror', function(error) {
      const tile = error && error.tile;
      if (!tile || tile._fallbackTried) return;
      tile._fallbackTried = true;

      const coords = error.coords;
      if (!coords) return;
      const z = coords.z;
      const x = coords.x;
      const y = coords.y;

      tile.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`;
    });

    return layer;
  }

  function getBranchUniqueKey(b) {
    if (!b) return '';
    if (b.id) return String(b.id);
    if (b.ref) return String(b.ref);
    const city = (b.city || '').toLowerCase().trim();
    const num = (b.number || b.Number || b.postalCode || '').toString().trim();
    if (city && num) return `${city}_${num}`;
    if (b.lat && b.lng) return `${b.lat}_${b.lng}`;
    return String(b.name || '');
  }

  function updateMapMarkersHighlight(targetBranch = state.selectedBranch) {
    if (!state.leafletMap || !state.branchMarkersMap) return;
    const isNP = state.currentService === 'novaposhta';
    const regularPin = createCustomPin(isNP, false);
    const highlightedPin = createCustomPin(isNP, true);
    const targetKey = targetBranch ? getBranchUniqueKey(targetBranch) : null;

    state.branchMarkersMap.forEach((marker, key) => {
      const isTarget = Boolean(targetKey && (
        key === targetKey ||
        (targetBranch.id && marker._branch && marker._branch.id === targetBranch.id) ||
        (targetBranch.number && marker._branch && marker._branch.number &&
         marker._branch.number.toString() === targetBranch.number.toString() &&
         (marker._branch.city || '').toLowerCase() === (targetBranch.city || '').toLowerCase())
      ));

      marker.setIcon(isTarget ? highlightedPin : regularPin);
      marker.setZIndexOffset(isTarget ? 1000 : 0);
      const el = marker.getElement();
      if (el) {
        if (isTarget) {
          el.classList.add('highlighted-marker');
        } else {
          el.classList.remove('highlighted-marker');
        }
      }
    });
  }

  function renderSelectedBranch(branch) {
    if (!branch) return;
    state.selectedBranch = branch;
    if (dom.searchResultsSection) {
      dom.searchResultsSection.classList.remove('hidden');
    }

    updateMapMarkersHighlight(branch);

    const list = (state.currentResults && state.currentResults.length > 0)
      ? state.currentResults
      : [branch];

    // Заборонено викликати window.scrollTo() чи стрибати фокусом вниз сторінки
    renderSearchResults(list, state.searchQuery || branch.city || '');
  }

  function setMarkerHighlightedOnMap(branch, isHover) {
    if (!state.isMapVisible || !state.leafletMap || !state.branchMarkersMap) return;
    const bKey = getBranchUniqueKey(branch);
    const marker = state.branchMarkersMap.get(bKey);
    if (!marker) return;

    const el = marker.getElement();
    if (el) {
      if (isHover) {
        el.classList.add('marker-hovered');
        marker.setZIndexOffset(9999);
      } else {
        el.classList.remove('marker-hovered');
        const isTarget = state.selectedBranch && getBranchUniqueKey(state.selectedBranch) === bKey;
        marker.setZIndexOffset(isTarget ? 1000 : 0);
      }
    }
  }

  function updateMapTileLayerTheme(theme) {
    if (!state.leafletMap || typeof L === 'undefined') return;
    const targetTheme = theme === 'dark' ? 'dark' : 'light';
    state.currentTileTheme = targetTheme;

    const tileConf = MAP_TILES[targetTheme] || MAP_TILES.light;

    // Якщо підкладка використовує той самий тайловий URL (темна тема реалізована апаратним GPU CSS-фільтром),
    // не перестворюємо шар у Leaflet: перемикання теми стає миттєвим (0 мс), без повторних запитів і без блимання
    if (state.currentTileLayer && state.currentTileLayer._url === tileConf.url) {
      return;
    }

    const newLayer = createOptimizedTileLayer(tileConf);
    if (!newLayer) return;

    newLayer.addTo(state.leafletMap);
    if (state.currentTileLayer) {
      state.leafletMap.removeLayer(state.currentTileLayer);
    }
    state.currentTileLayer = newLayer;
  }

  let mapMoveDebounceTimer = null;

  function debounceUpdateVisibleMarkers() {
    clearTimeout(mapMoveDebounceTimer);
    mapMoveDebounceTimer = setTimeout(() => {
      updateVisibleMarkersFromViewport();
    }, 200);
  }

  let _leafletLoadPromise = null;

  function ensureLeafletLoaded() {
    if (typeof L !== 'undefined') return Promise.resolve();
    if (_leafletLoadPromise) return _leafletLoadPromise;
    if (typeof document === 'undefined') return Promise.reject(new Error('Document unavailable'));

    _leafletLoadPromise = new Promise((resolve, reject) => {
      const cssHref = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      if (!document.querySelector(`link[href="${cssHref}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssHref;
        link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        link.crossOrigin = '';
        document.head.appendChild(link);
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        _leafletLoadPromise = null;
        reject(new Error('Не вдалося завантажити бібліотеку карти Leaflet'));
      };
      document.head.appendChild(script);
    });

    return _leafletLoadPromise;
  }

  function initMapIfNeeded() {
    if (state.leafletMap) return;
    if (typeof L === 'undefined') return;

    const bounds = ukraineBounds || (L.latLngBounds && L.latLngBounds(L.latLng(44.0, 22.0), L.latLng(52.5, 40.5)));

    // Ініціалізація карти з Canvas-рендерером та жорсткими межами України
    state.leafletMap = L.map('branchesMap', {
      preferCanvas: true,
      maxBounds: bounds,
      maxBoundsViscosity: 1.0,
      minZoom: 6,
      maxZoom: 19
    });

    window.leafMap = state.leafletMap;

    // Адаптивна картографічна підкладка без блокувань та водяних знаків Carto
    const initialTheme = state.theme === 'dark' ? 'dark' : 'light';
    const tileConf = MAP_TILES[initialTheme] || MAP_TILES.light;
    state.currentTileLayer = createOptimizedTileLayer(tileConf);
    if (state.currentTileLayer) {
      state.currentTileLayer.addTo(state.leafletMap);
    }
    state.currentTileTheme = initialTheme;

    state.markersGroup = L.layerGroup().addTo(state.leafletMap);

    // Слухач подій переміщення та зуму карти для динамічного підвантаження
    state.leafletMap.on('moveend zoomend', debounceUpdateVisibleMarkers);

    // Початковий вигляд: територія України
    if (bounds) {
      state.leafletMap.fitBounds(bounds);
    } else {
      state.leafletMap.setView([48.5, 31.5], 6);
    }
  }

  function updateMapTypeFilterUI() {
    if (!dom.mapTypeFilters) return;
    const current = state.mapTypeFilter || 'all';
    const btns = dom.mapTypeFilters.querySelectorAll('.map-filter-btn');
    btns.forEach(btn => {
      const type = btn.getAttribute('data-map-type');
      if (type === current) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    });
  }

  function finishOpenMap() {
    if (!state.isMapVisible) return;
    initMapIfNeeded();
    updateMapTypeFilterUI();

    setTimeout(() => {
      if (!state.isMapVisible) return;
      if (window.leafMap) window.leafMap.invalidateSize();
      if (state.leafletMap) state.leafletMap.invalidateSize();

      let mapBranches = [];
      let targetBranch = state.selectedBranch || (state.currentResults.length > 0 ? state.currentResults[0] : null);

      if (state.currentResults && state.currentResults.length > 0) {
        mapBranches = state.currentResults.slice(0, 20);
        renderMapMarkers(mapBranches, targetBranch, true);
      } else if (state.searchQuery && window.SmartSearchEngine) {
        const parsed = window.SmartSearchEngine.parseQuery(state.searchQuery);
        if (parsed && parsed.matchedSettlement) {
          const sName = parsed.matchedSettlement.name.toLowerCase();
          const allBranches = getAllCurrentServiceBranches();
          mapBranches = allBranches.filter(b => b.city && b.city.toLowerCase() === sName).slice(0, 20);
          renderMapMarkers(mapBranches, targetBranch, true);
        } else {
          updateVisibleMarkersFromViewport();
        }
      } else {
        updateVisibleMarkersFromViewport();
      }
    }, 150);
  }

  function toggleMapView() {
    state.isMapVisible = !state.isMapVisible;

    if (state.isMapVisible) {
      dom.mapSection.classList.remove('hidden');
      dom.btnToggleMap.classList.add('active');
      if (dom.mapBtnText) dom.mapBtnText.textContent = 'Сховати карту';
      dom.btnToggleMap.setAttribute('aria-expanded', 'true');
      dom.btnToggleMap.setAttribute('title', 'Сховати карту');
      dom.btnToggleMap.setAttribute('aria-label', 'Сховати карту');

      if (typeof L !== 'undefined') {
        finishOpenMap();
      } else {
        if (dom.mapMarkersCount) dom.mapMarkersCount.textContent = '(завантаження карти...)';
        ensureLeafletLoaded()
          .then(() => {
            finishOpenMap();
          })
          .catch(() => {
            if (dom.mapMarkersCount) dom.mapMarkersCount.textContent = '(офлайн: карта недоступна)';
          });
      }
    } else {
      dom.mapSection.classList.add('hidden');
      dom.btnToggleMap.classList.remove('active');
      if (dom.mapBtnText) dom.mapBtnText.textContent = 'Показати карту';
      dom.btnToggleMap.setAttribute('aria-expanded', 'false');
      dom.btnToggleMap.setAttribute('title', 'Показати карту');
      dom.btnToggleMap.setAttribute('aria-label', 'Показати карту');
      if (state.markersGroup) {
        state.markersGroup.clearLayers();
      }
      if (state.userLocationMarker && state.leafletMap) {
        state.leafletMap.removeLayer(state.userLocationMarker);
        state.userLocationMarker = null;
      }
    }
  }

  function updateVisibleMarkersFromViewport() {
    if (!state.leafletMap || !state.markersGroup || !state.isMapVisible) return;

    let bounds;
    try {
      bounds = state.leafletMap.getBounds();
    } catch (e) {
      return;
    }
    if (!bounds || !bounds.isValid()) return;

    const zoom = state.leafletMap.getZoom();
    const allBranches = getAllCurrentServiceBranches();
    const filterType = state.mapTypeFilter || 'all';

    const maxLimit = zoom < 11 ? 45 : 60;
    const visibleBranches = [];

    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const west = bounds.getWest();
    const east = bounds.getEast();

    for (let i = 0; i < allBranches.length; i++) {
      const b = allBranches[i];
      if (!b.lat || !b.lng) continue;

      if (b.lat < south || b.lat > north || b.lng < west || b.lng > east) {
        continue;
      }

      if (filterType === 'cargo') {
        if (!isCargoBranch(b)) continue;
      } else if (filterType === 'branch') {
        if (isPostomatBranch(b) || isCargoBranch(b)) continue;
      } else if (filterType === 'postomat') {
        if (!isPostomatBranch(b)) continue;
      }

      if (zoom < 11) {
        const isHub = isCargoBranch(b) || b.number === 1 || b.number === '1';
        if (!isHub) continue;
      }

      visibleBranches.push(b);
      if (visibleBranches.length >= maxLimit) {
        break;
      }
    }

    renderMapMarkers(visibleBranches, state.selectedBranch, false);
  }

  function createCustomPin(isNP, isHighlighted = false) {
    const pinColor = isNP ? (isHighlighted ? '#ff003c' : '#e11d48') : (isHighlighted ? '#ffe600' : '#ffd200');
    const centerColor = isNP ? '#ffffff' : '#0b0f19';
    const width = isHighlighted ? 36 : 28;
    const height = isHighlighted ? 46 : 36;
    const glow = isHighlighted 
      ? `filter: drop-shadow(0 0 10px ${isNP ? 'rgba(255, 0, 60, 0.95)' : 'rgba(255, 230, 0, 0.95)'});` 
      : 'filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));';

    const svgIcon = `
      <div style="${glow} display: flex; align-items: center; justify-content: center;">
        <svg width="${width}" height="${height}" viewBox="0 0 30 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C6.716 0 0 6.716 0 15C0 26.25 15 38 15 38C15 38 30 26.25 30 15C30 6.716 23.284 0 15 0Z" fill="${pinColor}"/>
          <circle cx="15" cy="15" r="7.5" fill="${centerColor}"/>
          ${isHighlighted ? '<circle cx="15" cy="15" r="4" fill="' + pinColor + '"/>' : ''}
        </svg>
      </div>
    `;
    return L.divIcon({
      html: svgIcon,
      className: isHighlighted ? 'custom-leaflet-marker highlighted-marker' : 'custom-leaflet-marker',
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
      popupAnchor: [0, -height + 4]
    });
  }

  function formatPopupContent(b, isTarget, isNP) {
    const lpCopyStr = formatClassicCopyString(b);
    const cleanStreet = getCleanStreet(b);

    let typeDisplay;
    if (isPostomatBranch(b)) {
      typeDisplay = 'Поштомат';
    } else if (isCargoBranch(b)) {
      typeDisplay = 'Вантажне відділення';
    } else {
      typeDisplay = 'Відділення';
    }

    const branchNumber = (b.number || b.Number || b.postalCode || b.PostalCode || '').toString().trim();

    let badgeText = '';
    let badgeCls = 'map-badge-regular';
    if (isPostomatBranch(b)) {
      badgeText = '📮 Поштомат: до 20 кг';
      badgeCls = 'map-badge-postomat';
    } else if (isCargoBranch(b)) {
      const weight = b.totalMaxWeightAllowed || b.maxWeight || 1100;
      const dims = b.dimensions || b.maxDimensions || '600×220×220 см';
      badgeText = `🚛 Вантажне: до ${weight} кг (${dims})`;
      badgeCls = 'map-badge-cargo';
    } else {
      const isUp = state.currentService === 'ukrposhta' || (b.id && b.id.startsWith('up-'));
      const weight = b.totalMaxWeightAllowed || b.maxWeight || 30;
      if (isUp) {
        badgeText = `📮 Індекс: ${branchNumber} (до ${weight} кг)`;
        badgeCls = 'map-badge-up';
      } else {
        badgeText = `🏬 До ${weight} кг`;
        badgeCls = 'map-badge-regular';
      }
    }

    return `
      <div class="map-popup-card">
        <div class="map-popup-top">
          <span class="map-popup-badge ${badgeCls}">${escapeHtml(badgeText)}</span>
          ${isTarget ? '<span class="map-popup-target">⭐ Вибране</span>' : ''}
        </div>
        <div class="map-popup-title">${escapeHtml(typeDisplay)} №${escapeHtml(branchNumber)}</div>
        <div class="map-popup-street">📍 <strong>${escapeHtml(b.city)}</strong>, ${escapeHtml(cleanStreet)}</div>
        <div class="map-popup-actions">
          <button type="button" class="btn-popup-copy" data-copy="${escapeHtml(lpCopyStr)}" data-branch-type="${getBranchAnalyticsType(b)}">
            Скопіювати
          </button>
        </div>
      </div>
    `;
  }

  function renderMapMarkers(branches, highlightedBranch = null, autoFitBounds = true) {
    if (!state.leafletMap || !state.markersGroup) return;

    state.markersGroup.clearLayers();
    if (state.branchMarkersMap) {
      state.branchMarkersMap.clear();
    }

    const safeBranches = (branches || []).slice(0, 60);
    dom.mapMarkersCount.textContent = `(${safeBranches.length} відділень)`;

    const isNP = state.currentService === 'novaposhta';
    const regularPin = createCustomPin(isNP, false);
    const highlightedPin = createCustomPin(isNP, true);
    const bounds = [];
    let targetMarker = null;

    safeBranches.forEach(b => {
      if (b.lat && b.lng) {
        const isTarget = highlightedBranch && (
          (highlightedBranch.id && b.id === highlightedBranch.id) ||
          (highlightedBranch.number && b.number && b.number.toString() === highlightedBranch.number.toString() && (b.city || '').toLowerCase() === (highlightedBranch.city || '').toLowerCase())
        );

        const marker = L.marker([b.lat, b.lng], {
          icon: isTarget ? highlightedPin : regularPin,
          zIndexOffset: isTarget ? 1000 : 0
        });

        const bKey = getBranchUniqueKey(b);
        marker._branchId = bKey;
        marker._branch = b;
        if (state.branchMarkersMap) {
          state.branchMarkersMap.set(bKey, marker);
        }

        const popupContent = formatPopupContent(b, isTarget, isNP);
        marker.bindPopup(popupContent, {
          autoPan: false,
          autoPanPadding: (typeof L !== 'undefined' && L.point) ? L.point(10, 10) : [10, 10]
        });

        // Двосторонній фокус: клік на маркер відкриває балун та автоматично вибирає повну картку без стрибків екрана
        marker.on('click', (e) => {
          if (e && e.originalEvent && typeof e.originalEvent.stopPropagation === 'function') {
            e.originalEvent.stopPropagation();
          }
          renderSelectedBranch(b);
          marker.openPopup();
        });

        state.markersGroup.addLayer(marker);
        bounds.push([b.lat, b.lng]);

        if (isTarget) {
          targetMarker = marker;
        }
      }
    });

    if (targetMarker) {
      setTimeout(() => {
        targetMarker.openPopup();
      }, 250);
    }

    if (autoFitBounds && bounds.length > 0) {
      if (highlightedBranch && highlightedBranch.lat && highlightedBranch.lng) {
        state.leafletMap.setView([highlightedBranch.lat, highlightedBranch.lng], 14, { animate: true });
      } else {
        state.leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    }
  }

  function updateMapMarkers(branches, highlightedBranch = null) {
    renderMapMarkers(branches, highlightedBranch, true);
  }

  function getUserLocation() {
    if (!navigator.geolocation) {
      alert('Геолокація не підтримується вашим браузером');
      return;
    }

    dom.btnGeoLocate.textContent = 'Визначаємо...';

    navigator.geolocation.getCurrentPosition(
      pos => {
        dom.btnGeoLocate.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          Моя геолокація
        `;
        const userLat = pos.coords.latitude;
        const userLng = pos.coords.longitude;

        ensureLeafletLoaded().then(() => {
          if (!state.leafletMap) initMapIfNeeded();
          if (!state.isMapVisible) toggleMapView();
          if (!state.leafletMap || typeof L === 'undefined') return;

          if (state.userLocationMarker) {
            state.leafletMap.removeLayer(state.userLocationMarker);
          }

          state.userLocationMarker = L.circleMarker([userLat, userLng], {
            radius: 9,
            fillColor: '#38bdf8',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.95
          }).addTo(state.leafletMap).bindPopup('📍 Ви знаходитесь тут', {
            autoPan: false,
            autoPanPadding: (typeof L !== 'undefined' && L.point) ? L.point(10, 10) : [10, 10]
          }).openPopup();

          state.leafletMap.setView([userLat, userLng], 13);
        }).catch(() => {});
      },
      () => {
        dom.btnGeoLocate.textContent = 'Моя геолокація';
        alert('Не вдалося визначити геолокацію. Перевірте дозволи у браузері.');
      }
    );
  }

  // ==========================================================================
  // 8. УТИЛІТИ ТА AUTOCOMPLETE DROPDOWN (LP-CRM STYLE)
  // ==========================================================================
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\n|\r?\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  let activeAutocompleteIndex = -1;
  let autocompleteItems = [];
  let isAutocompleteOpen = false;
  let activeAutocompleteAbortController = null;
  let autocompleteDebounceTimer = null;
  let liveSearchDebounceTimer = null;

  function updateBottomBarVisibility() {
    if (!dom.bottomBar || !dom.bottomBar.classList) return;
    const hasSearchText = Boolean(dom.searchInput && dom.searchInput.value && dom.searchInput.value.trim().length > 0);
    const isAutocompleteVisible = Boolean(
      dom.autocompleteDropdown &&
      dom.autocompleteDropdown.classList &&
      typeof dom.autocompleteDropdown.classList.contains === 'function' &&
      !dom.autocompleteDropdown.classList.contains('hidden') &&
      (!dom.autocompleteDropdown.style || dom.autocompleteDropdown.style.display !== 'none')
    );
    const isResultsVisible = Boolean(
      dom.searchResultsSection &&
      dom.searchResultsSection.classList &&
      typeof dom.searchResultsSection.classList.contains === 'function' &&
      !dom.searchResultsSection.classList.contains('hidden')
    );

    if (hasSearchText || isAutocompleteVisible || isResultsVisible) {
      dom.bottomBar.classList.add('hidden-during-search');
    } else {
      dom.bottomBar.classList.remove('hidden-during-search');
    }
  }

  function closeAutocomplete() {
    if (!dom.autocompleteDropdown) return;
    clearTimeout(autocompleteDebounceTimer);
    dom.autocompleteDropdown.classList.add('hidden');
    dom.autocompleteDropdown.style.display = 'none';
    dom.autocompleteDropdown.innerHTML = '';
    dom.autocompleteDropdown.scrollTop = 0;
    activeAutocompleteIndex = -1;
    renderedAutocompleteCount = 0;
    currentAutocompleteQuery = '';
    autocompleteItems = [];
    isAutocompleteOpen = false;
    if (dom.searchResultsSection && state.currentResults && state.currentResults.length > 0 && dom.searchInput && dom.searchInput.value.trim().length >= 2) {
      dom.searchResultsSection.classList.remove('hidden');
    }
    updateBottomBarVisibility();
  }

  const HIGHLIGHT_STOP_WORDS = new Set([
    'вул', 'вулиця', 'просп', 'проспект', 'пр-т', 'прт', 'буд', 'будинок',
    'пров', 'провулок', 'бульв', 'бульвар', 'б-р', 'пл', 'площа', 'шосе',
    'наб', 'набережна', 'узвіз', 'майдан', 'тупик', 'алея', 'квартал', 'мкрн',
    'обл', 'область', 'район', 'р-н', 'рн', 'селище', 'село', 'місто', 'смт',
    'відділення', 'віділення', 'відділ', 'вантажне', 'вантажний', 'пункт',
    'поштомат', 'почтомат', 'нова', 'пошта', 'укрпошта', 'вд', 'пм', 'номер',
    'вага', 'до', 'кг'
  ]);

  function highlightMatch(text, query) {
    if (!text) return '';
    if (!query) return escapeHtml(text);

    let cleanQuery = query;
    if (window.SmartSearchEngine && window.SmartSearchEngine.fixKeyboardLayout) {
      cleanQuery = window.SmartSearchEngine.fixKeyboardLayout(query);
    }

    // Відокремлюємо літери від цифр при злитому написанні ("Київ1" -> "Київ 1", "Хрещатик15" -> "Хрещатик 15")
    cleanQuery = cleanQuery.replace(/([А-Яа-яІіЇїЄєA-Za-z]{2,})(\d+)/gu, '$1 $2')
                           .replace(/(\d+)([А-Яа-яІіЇїЄєA-Za-z]{2,})/gu, '$1 $2');

    // Відокремлюємо префікси вулиць та топонімів
    cleanQuery = cleanQuery.replace(/(?<!\p{L})(?:вулиця|проспект|провулок|бульвар|площа|вул|просп|пров|бульв|наб|шосе|тупик)\.(?=\p{L})/giu, '$& ')
                           .replace(/(?<!\p{L})(?:вулиця|проспект|провулок|бульвар|площа|вул|просп|пров|бульв)(?=[А-Яа-яІіЇїЄєA-Za-z]{3,})/giu, '$& ')
                           .replace(/(?<!\p{L})(?:м|місто|с|село|смт|сел)\.(?=\p{L})/giu, '$& ');

    const rawTokens = cleanQuery.toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
    const patterns = new Set();

    for (const t of rawTokens) {
      if (HIGHLIGHT_STOP_WORDS.has(t)) continue;
      if (/^\d+$/.test(t)) {
        patterns.add('(?<!\\d)' + escapeRegex(t) + '(?!\\d)');
        patterns.add('(?<=№)' + escapeRegex(t));
      } else if (t.length >= 3) {
        patterns.add('(?<!\\p{L})' + escapeRegex(t) + '(?!\\p{L})');
        let raionStem = window.SmartSearchEngine && window.SmartSearchEngine.getRaionStem ? window.SmartSearchEngine.getRaionStem(t) : '';
        if (window.SmartSearchEngine && window.SmartSearchEngine.detectRaion) {
          const detectedR = window.SmartSearchEngine.detectRaion(t);
          if (detectedR) {
            const canonicalRaionStem = window.SmartSearchEngine.getRaionStem ? window.SmartSearchEngine.getRaionStem(detectedR) : '';
            if (canonicalRaionStem && canonicalRaionStem.length >= 3) {
              raionStem = canonicalRaionStem;
            }
          }
        }
        if (raionStem && raionStem.length >= 3) {
          patterns.add('(?<!\\p{L})' + escapeRegex(raionStem) + '[\\p{L}]*');
        }
        const uStem = window.SmartSearchEngine && window.SmartSearchEngine.getUkrainianStem ? window.SmartSearchEngine.getUkrainianStem(t) : '';
        if (uStem && uStem.length >= 3) {
          patterns.add('(?<!\\p{L})' + escapeRegex(uStem) + '[\\p{L}]*');
        }
        if (!raionStem && !uStem) {
          const stem = t.replace(/(?:енськ|инськ|івськ|овськ|ськ|цьк|зьк)(?:ий|ого|ому|им|е|а)?$/iu, '')
                        .replace(/(?:ний|ного|ному|не|на|тий|того)$/iu, '');
          if (stem && stem.length >= 3 && !HIGHLIGHT_STOP_WORDS.has(stem)) {
            patterns.add('(?<!\\p{L})' + escapeRegex(stem) + '[\\p{L}]*');
          }
        }
      } else if (t.length >= 2) {
        patterns.add('(?<!\\p{L})' + escapeRegex(t));
      }
    }

    // Підтримка злитого написання багатослівних назв вулиць (наприклад, "пирогівськийшлях", "червоноїкалини")
    const textWords = (text.match(/[\p{L}0-9]+/gu) || []).map(w => w.toLowerCase());
    for (const t of rawTokens) {
      if (t.length >= 6) {
        for (let i = 0; i < textWords.length; i++) {
          let combo = '';
          const matchedSubwords = [];
          for (let j = i; j < Math.min(i + 3, textWords.length); j++) {
            const w = textWords[j];
            if (HIGHLIGHT_STOP_WORDS.has(w)) break;
            combo += w;
            matchedSubwords.push(w);
            if (matchedSubwords.length >= 2 && (combo === t || (combo.length >= 6 && t.includes(combo)))) {
              for (const sw of matchedSubwords) {
                if (sw.length >= 3) patterns.add('(?<!\\p{L})' + escapeRegex(sw) + '(?!\\p{L})');
              }
            }
          }
        }
      }
    }

    // Нечітке підсвічування для слів тексту при одруківках у запиті (Fuzzy Typo Highlighting: "горанечі" -> "Гореничі")
    if (window.SmartSearchEngine) {
      const eng = window.SmartSearchEngine;
      const originalTextWords = (text.match(/[\p{L}0-9]+/gu) || []);
      for (let i = 0; i < originalTextWords.length; i++) {
        const tw = originalTextWords[i];
        const twLow = tw.toLowerCase();
        if (HIGHLIGHT_STOP_WORDS.has(twLow) || twLow.length < 3 || /^\d+$/.test(twLow)) continue;
        const twSk = typeof eng.consonantSkeleton === 'function' ? eng.consonantSkeleton(twLow) : '';
        for (let j = 0; j < rawTokens.length; j++) {
          const t = rawTokens[j];
          if (HIGHLIGHT_STOP_WORDS.has(t) || t.length < 3 || /^\d+$/.test(t)) continue;
          const tSk = typeof eng.consonantSkeleton === 'function' ? eng.consonantSkeleton(t) : '';
          const isSkeletonMatch = Boolean(twSk && tSk && twSk.length >= 3 && twSk === tSk);
          const isDlMatch = Boolean(
            twLow.length >= 4 && t.length >= 4 &&
            typeof eng.damerauLevenshtein === 'function' &&
            eng.damerauLevenshtein(twLow, t) <= 1
          );
          if (isSkeletonMatch || isDlMatch) {
            patterns.add('(?<!\\p{L})' + escapeRegex(tw) + '(?!\\p{L})');
          }
        }
      }
    }

    if (patterns.size === 0) return escapeHtml(text);

    const combinedRegex = new RegExp('(' + Array.from(patterns).join('|') + ')', 'giu');
    const safeText = escapeHtml(text);
    return safeText.replace(combinedRegex, (match, _p1, offset, fullStr) => {
      // Перевіряємо повне слово навколо збігу, щоб ніколи не підсвічувати службові слова
      let start = offset;
      let end = offset + match.length;
      while (start > 0 && /[\p{L}-]/u.test(fullStr[start - 1])) start--;
      while (end < fullStr.length && /[\p{L}-]/u.test(fullStr[end])) end++;
      const wholeWord = fullStr.slice(start, end).toLowerCase();
      const wholeWordNoHyphen = wholeWord.replace(/^-+|-+$/g, '');
      if (HIGHLIGHT_STOP_WORDS.has(wholeWord) || HIGHLIGHT_STOP_WORDS.has(wholeWordNoHyphen)) {
        return match;
      }
      return '<mark class="hl-match">' + match + '</mark>';
    });
  }

  function getCitySubtitleHighlightQuery(query, cityTitle) {
    if (!query) return '';
    let q = query;
    if (window.SmartSearchEngine && window.SmartSearchEngine.fixKeyboardLayout) {
      q = window.SmartSearchEngine.fixKeyboardLayout(query);
    }
    q = q.replace(/([А-Яа-яІіЇїЄєA-Za-z]{2,})(\d+)/gu, '$1 $2')
         .replace(/(\d+)([А-Яа-яІіЇїЄєA-Za-z]{2,})/gu, '$1 $2');
    const cityWords = String(cityTitle || '').toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
    const tokens = q.toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
    const remaining = tokens.filter(tok => {
      if (HIGHLIGHT_STOP_WORDS.has(tok)) return false;
      for (const cw of cityWords) {
        if (cw === tok || cw.startsWith(tok) || tok.startsWith(cw)) return false;
      }
      return true;
    });
    return remaining.join(' ');
  }

  function getBranchStreetHighlightQuery(query, item) {
    if (!query) return '';
    let q = query;
    if (window.SmartSearchEngine && window.SmartSearchEngine.fixKeyboardLayout) {
      q = window.SmartSearchEngine.fixKeyboardLayout(query);
    }
    q = q.replace(/([А-Яа-яІіЇїЄєA-Za-z]{2,})(\d+)/gu, '$1 $2')
         .replace(/(\d+)([А-Яа-яІіЇїЄєA-Za-z]{2,})/gu, '$1 $2')
         .replace(/(?<!\p{L})(?:вулиця|проспект|провулок|бульвар|площа|вул|просп|пров|бульв|наб|шосе|тупик)\.(?=\p{L})/giu, '$& ')
         .replace(/(?<!\p{L})(?:вулиця|проспект|провулок|бульвар|площа|вул|просп|пров|бульв)(?=[А-Яа-яІіЇїЄєA-Za-z]{3,})/giu, '$& ');
    const cityWords = String(item.value || (item.branchObj && item.branchObj.city) || '')
      .toLowerCase()
      .split(/[^\p{L}0-9]+/u)
      .filter(Boolean);
    const tokens = q.toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
    const wordTokens = [];
    const numTokens = [];
    for (const tok of tokens) {
      if (HIGHLIGHT_STOP_WORDS.has(tok)) continue;
      if (/^\d+$/.test(tok)) {
        numTokens.push(tok);
        continue;
      }
      let isCityWord = false;
      for (const cw of cityWords) {
        if (cw === tok || (tok.length >= 3 && cw.startsWith(tok))) {
          isCityWord = true;
          break;
        }
      }
      if (!isCityWord) {
        wordTokens.push(tok);
      }
    }
    if (wordTokens.length > 0) {
      return wordTokens.concat(numTokens).join(' ');
    }
    // Якщо введено лише місто + номер (напр. "київ 222"), не підсвічуємо цифри номерів будинків у рядку вулиці,
    // якщо номер вже збігається з номером відділення/поштомату
    const branchNum = item.branchObj && item.branchObj.number ? String(item.branchObj.number) : '';
    const unmatchedNums = numTokens.filter(n => !branchNum.startsWith(n));
    return unmatchedNums.join(' ');
  }

  function renderAutocomplete(suggestions, query) {
    if (!dom.autocompleteDropdown) return;

    if (!query || query.trim().length < 2) {
      closeAutocomplete();
      return;
    }

    const hasDigits = /\d/.test(query);

    dom.autocompleteDropdown.innerHTML = '';
    dom.autocompleteDropdown.scrollTop = 0;
    activeAutocompleteIndex = -1;
    renderedAutocompleteCount = 0;
    currentAutocompleteQuery = query;

    // Якщо нічого не знайдено:
    // При наявності цифр (напр. "київ 99999" або "33159") закриваємо дропдаун, щоб показати картку помилки результатів.
    // При пошуку міста показуємо охайне повідомлення «Нічого не знайдено».
    if (!suggestions || suggestions.length === 0) {
      if (hasDigits) {
        // Якщо користувач продовжує друкувати (вміст поля вже змінився/довший), не викликаємо застарілий executeSearch
        if (dom.searchInput && dom.searchInput.value.trim() !== query.trim()) {
          return;
        }
        closeAutocomplete();
        executeSearch(query, false, false);
        return;
      }
      autocompleteItems = [];
      dom.autocompleteDropdown.removeAttribute('data-mode');
      const emptyEl = document.createElement('div');
      emptyEl.className = 'autocomplete-empty';
      emptyEl.innerHTML = `
        <span style="display:inline-block; margin-right:6px;">🔍</span>
        <span>За запитом «<strong>${escapeHtml(query)}</strong>» міст чи відділень не знайдено</span>
      `;
      dom.autocompleteDropdown.appendChild(emptyEl);
      dom.autocompleteDropdown.style.display = '';
      dom.autocompleteDropdown.classList.remove('hidden');
      isAutocompleteOpen = true;
      updateBottomBarVisibility();

      const cleanZeroQ = query.trim();
      if (cleanZeroQ.length >= 2) {
        clearTimeout(zeroResultsDebounceTimer);
        zeroResultsDebounceTimer = setTimeout(() => {
          const curVal = dom.searchInput ? dom.searchInput.value.trim() : cleanZeroQ;
          if (curVal !== cleanZeroQ) return;
          updateSearchSessionState(cleanZeroQ, 0, currentInputSource);
          logFailureTelemetry({
            query: cleanZeroQ,
            service: state.currentService,
            status: '🔴 0 результатів (автокомпліт)',
            resultsCount: 0,
            duration: 1,
            details: `Порожні підказки в автокомпліті: місто чи відділення не знайдено. Джерело: ${getSourceLabel(currentInputSource)}`
          });
        }, 500);
      }
      return;
    }

    autocompleteItems = suggestions;
    const isBranchMode = suggestions.some(s => s.mode === 'branch' || s.type === 'branch' || s.type === 'postomat');
    dom.autocompleteDropdown.setAttribute('data-mode', isBranchMode ? 'branch' : 'city');

    // Віртуальний рендеринг: виводимо початковий чанк (15 елементів: 6 видимих + буфер унизу)
    appendAutocompleteChunk(AUTOCOMPLETE_CHUNK_SIZE);

    dom.autocompleteDropdown.style.display = '';
    dom.autocompleteDropdown.classList.remove('hidden');
    isAutocompleteOpen = true;
    if (dom.searchResultsSection) {
      dom.searchResultsSection.classList.add('hidden');
    }
    updateBottomBarVisibility();
  }

  const AUTOCOMPLETE_CHUNK_SIZE = 15;
  let renderedAutocompleteCount = 0;
  let currentAutocompleteQuery = '';

  function appendAutocompleteChunk(chunkSize = AUTOCOMPLETE_CHUNK_SIZE) {
    if (!dom.autocompleteDropdown || renderedAutocompleteCount >= autocompleteItems.length) return;
    const fragment = (typeof document !== 'undefined' && typeof document.createDocumentFragment === 'function')
      ? document.createDocumentFragment()
      : document.createElement('div');

    const nextEnd = Math.min(autocompleteItems.length, renderedAutocompleteCount + chunkSize);
    for (let i = renderedAutocompleteCount; i < nextEnd; i++) {
      const el = createAutocompleteItemElement(autocompleteItems[i], i, currentAutocompleteQuery);
      fragment.appendChild(el);
    }
    renderedAutocompleteCount = nextEnd;
    dom.autocompleteDropdown.appendChild(fragment);
  }

  function createAutocompleteItemElement(item, idx, query) {
    const el = document.createElement('div');
    const itemIsBranch = item.mode === 'branch' || item.type === 'branch' || item.type === 'postomat';
    el.className = 'autocomplete-item ' + (itemIsBranch ? 'autocomplete-item-branch' : 'autocomplete-item-city');
    el.setAttribute('role', 'option');
    el.setAttribute('data-index', idx);
    el.setAttribute('data-mode', itemIsBranch ? 'branch' : 'city');

    let iconHtml = item.icon || '📍';
    let badgeClass = 'badge-city';
    if (!item.icon) {
      if (item.type === 'postomat') {
        iconHtml = '📦';
      } else if (item.type === 'branch') {
        iconHtml = '🏢';
      }
    }
    if (item.type === 'postomat') {
      badgeClass = 'badge-postomat';
    } else if (item.type === 'branch') {
      badgeClass = item.isCargo ? 'badge-cargo' : 'badge-branch';
    } else if (item.type === 'смт' || item.type === 'селище') {
      badgeClass = 'badge-smt';
    } else if (item.type === 'село') {
      badgeClass = 'badge-village';
    }

    if (itemIsBranch) {
      // Компактна дворядкова структура відділення:
      // Рядок 1 (жирний): [Іконка] [Місто] ([Район] р-н, [Область] обл.): [Тип відділення] №[Номер]
      // Рядок 2 (вторинний): вул. [Назва вулиці], [номер будинку] (Орієнтир) • (вага: до X кг)
      let branchIcon = item.icon || (item.type === 'postomat' ? '📦' : '🏢');
      if (item.title && item.title.startsWith('📮')) {
        branchIcon = '';
      }

      const bObj = item.branchObj;
      const cleanCity = (bObj && (bObj.cityClean || bObj.city)) || item.value || '';
      const geoParts = [];
      const rClean = cleanRaionName(bObj && bObj.raion);
      if (rClean) {
        geoParts.push(`${rClean} р-н`);
      }
      const oClean = cleanOblastName(bObj && bObj.oblast);
      if (oClean) {
        geoParts.push(`${oClean} обл.`);
      }
      const geo = geoParts.join(', ');

      let fullTitle = item.title;
      if (!item.title || !item.title.startsWith('📮')) {
        const isMajorCity = (window.SmartSearchEngine && window.SmartSearchEngine.canonText)
          ? ['київ', 'львів', 'харків', 'одеса', 'дніпро'].includes(window.SmartSearchEngine.canonText(cleanCity))
          : false;
        const cityGeoPrefix = (geo && !isMajorCity) ? `${cleanCity} (${geo})` : (cleanCity || '');
        fullTitle = cityGeoPrefix ? `${cityGeoPrefix}: ${item.title}` : item.title;
      }

      const isBest = !(item._isBestMatch === false || (bObj && bObj._isBestMatch === false));
      // Запит для підсвічування заголовка: токени запиту користувача
      const titleHighlightQuery = isBest ? query : '';
      let highlightedBranchTitle = highlightMatch(fullTitle, titleHighlightQuery);

      // Рядок 2: вулиця та адреса + ліміт ваги в кінці
      const streetText = item.street || (bObj && (bObj.street || bObj.address)) || item.subtitle || '';
      const streetQuery = isBest ? getBranchStreetHighlightQuery(query, item) : '';
      const highlightedStreet = highlightMatch(streetText, streetQuery);

      if (isBest && highlightedStreet && highlightedStreet.includes('class="hl-match"')) {
        const streetTokensInMatch = highlightedStreet.match(/<mark class="hl-match">([^<]+)<\/mark>/g) || [];
        for (const mTag of streetTokensInMatch) {
          const textInside = mTag.replace(/<\/?mark[^>]*>/g, '');
          if (textInside.length >= 3 && highlightedBranchTitle.includes(mTag)) {
            highlightedBranchTitle = highlightedBranchTitle.split(mTag).join(textInside);
          }
        }
      }


      const weightText = item.weightLabel ? escapeHtml(item.weightLabel) : '';
      const weightHtml = weightText
        ? ` <span class="autocomplete-sep">•</span> <span class="autocomplete-weight">${weightText}</span>`
        : '';

      const iconSpan = branchIcon ? `<span class="autocomplete-inline-icon">${branchIcon}</span>` : '';

      el.innerHTML = `
        <div class="autocomplete-item-main">
          <div class="autocomplete-content autocomplete-content-branch">
            <div class="autocomplete-title">${iconSpan}<strong class="autocomplete-branch-name">${highlightedBranchTitle}</strong></div>
            <div class="autocomplete-sub autocomplete-street">${highlightedStreet}${weightHtml}</div>
          </div>
        </div>
      `;
    } else {
      // Режим топонімів у дропдауні (City Suggestion Mode — формат LP-CRM):
      // Жирний текст: назва пункту; вторинний сірий текст у дужках праворуч: (Район р-н, Область обл.); бейдж типу праворуч (місто / смт / село)
      const highlightedTitle = highlightMatch(item.title, query);
      const subQuery = getCitySubtitleHighlightQuery(query, item.title);
      const highlightedSub = highlightMatch(item.subtitle, subQuery);
      const postalBadgeHtml = (item.postalCode && (state.currentService === 'ukrposhta' || item.icon === '📮'))
        ? `<span class="autocomplete-postal-badge" title="Поштовий індекс">📮 ${escapeHtml(item.postalCode)}</span>`
        : '';

      let branchBadgeHtml = '';
      if (typeof item.branchCount === 'number') {
        const reg = item.regularCount || 0;
        const post = item.postomatCount || 0;
        if (reg > 0 && post > 0) {
          branchBadgeHtml = `<span class="autocomplete-branch-count-badge" title="${reg} відділень та ${post} поштоматів">🏢 ${reg} відд. • 📦 ${post} пошт.</span>`;
        } else if (reg > 0) {
          const bLabel = reg === 1 ? '1 відділення' : (reg < 5 ? `${reg} відділення` : `${reg} відділень`);
          branchBadgeHtml = `<span class="autocomplete-branch-count-badge" title="${reg} відділень">🏢 ${escapeHtml(bLabel)}</span>`;
        } else if (post > 0) {
          const pLabel = post === 1 ? '1 поштомат' : (post < 5 ? `${post} поштомати` : `${post} поштоматів`);
          branchBadgeHtml = `<span class="autocomplete-branch-count-badge badge-postomat-count" title="${post} поштоматів">📦 ${escapeHtml(pLabel)}</span>`;
        } else {
          const svcShort = state.currentService === 'ukrposhta' ? 'УП' : 'НП';
          let bridgeBtnHtml = '';
          if (state.currentService === 'novaposhta' && item.postalCode) {
            bridgeBtnHtml = ` <button type="button" class="btn-autocomplete-bridge" data-bridge-index="${escapeHtml(item.postalCode)}" data-bridge-city="${escapeHtml(item.title)}" title="Перейти до відділення Укрпошти">📮 Є Укрпошта (${escapeHtml(item.postalCode)}) →</button>`;
          } else if (state.currentService === 'ukrposhta' && item.npBranchCount) {
            bridgeBtnHtml = ` <button type="button" class="btn-autocomplete-bridge bridge-to-np" data-bridge-np="true" data-bridge-city="${escapeHtml(item.title)}" title="Перейти до відділення Нової Пошти">🏢 Є Нова пошта →</button>`;
          }
          branchBadgeHtml = `<span class="autocomplete-no-branch-badge" title="У цьому населеному пункті немає відкритих точок">немає точок ${svcShort}</span>${bridgeBtnHtml}`;
          el.classList.add('autocomplete-item-no-branch');
        }
      }

      el.innerHTML = `
        <div class="autocomplete-item-main">
          <div class="autocomplete-icon">${iconHtml}</div>
          <div class="autocomplete-content autocomplete-content-city">
            <strong class="autocomplete-title">${highlightedTitle}</strong>
            <span class="autocomplete-sub">${highlightedSub}</span>
            ${postalBadgeHtml}
            ${branchBadgeHtml}
          </div>
        </div>
        <span class="autocomplete-badge ${badgeClass}">${escapeHtml(item.badge || item.type)}</span>
      `;
    }

    // Запобігаємо втраті фокусу інпутом при виборі підказки та дублюванню викликів
    let selectHandled = false;
    const handleSelect = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectHandled) return;
      selectHandled = true;
      selectAutocompleteItem(item);
    };

    const bridgeBtn = el.querySelector('.btn-autocomplete-bridge');
    if (bridgeBtn) {
      const handleBridgeSelect = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selectHandled) return;
        selectHandled = true;
        clearTimeout(settledQueryTimer);
        clearTimeout(zeroResultsDebounceTimer);
        currentInputSource = 'smart_banner';

        const isToNp = bridgeBtn.getAttribute('data-bridge-np') === 'true';
        const targetIndex = bridgeBtn.getAttribute('data-bridge-index');
        const targetCity = bridgeBtn.getAttribute('data-bridge-city') || item.title;

        if (isToNp) {
          switchService('novaposhta');
          const targetQuery = [item.title, item.raion, item.oblast].filter(Boolean).join(' ');
          if (dom.searchInput) dom.searchInput.value = targetQuery + ' ';
          closeAutocomplete();
          executeSearch(targetQuery, true, true);
        } else {
          switchService('ukrposhta');
          const targetQuery = targetIndex ? `${targetCity} ${targetIndex}` : targetCity;
          if (dom.searchInput) dom.searchInput.value = targetQuery;
          closeAutocomplete();

          let upBranch = null;
          if (targetIndex && window.SmartSearchEngine && typeof window.SmartSearchEngine.getUkrposhtaBranchByIndex === 'function') {
            upBranch = window.SmartSearchEngine.getUkrposhtaBranchByIndex(targetIndex);
          }
          if (!upBranch) {
            const upList = (window.BRANCHES_DATA && Array.isArray(window.BRANCHES_DATA.ukrposhta))
              ? window.BRANCHES_DATA.ukrposhta
              : null;
            if (upList && targetIndex) {
              upBranch = upList.find(b => String(b.index || b.postalCode || b.number) === String(targetIndex));
            }
          }

          if (upBranch) {
            state.searchQuery = targetQuery;
            state.selectedBranch = upBranch;
            state.selectedSettlement = null;
            state.currentResults = [upBranch];
            renderSearchResults([upBranch], targetQuery, null, null);
            updateSearchSessionState(targetQuery, 1, 'smart_banner');
            logFailureTelemetry({
              query: targetQuery,
              service: state.currentService,
              status: '🔵 Перехід: Розвилка служб',
              resultsCount: 1,
              duration: 1,
              details: 'Перехід на Укрпошту через кнопку швидкого мосту в автокомпліті (знайдено 1 рез.).'
            });
            if (state.isMapVisible && state.leafletMap && upBranch.lat && upBranch.lng) {
              updateMapMarkers([upBranch], upBranch);
              state.leafletMap.flyTo([upBranch.lat, upBranch.lng], 14, { duration: 1.2 });
            }
          } else {
            executeSearch(targetQuery, true, true);
          }
        }
      };

      bridgeBtn.addEventListener('mousedown', handleBridgeSelect);
      bridgeBtn.addEventListener('pointerdown', handleBridgeSelect);
      bridgeBtn.addEventListener('click', handleBridgeSelect);
    }

    if (item.branchObj) {
      el.addEventListener('mouseenter', () => setMarkerHighlightedOnMap(item.branchObj, true));
      el.addEventListener('mouseleave', () => setMarkerHighlightedOnMap(item.branchObj, false));
    }

    el.addEventListener('mousedown', handleSelect);
    el.addEventListener('pointerdown', handleSelect);
    el.addEventListener('click', handleSelect);

    return el;
  }

  async function selectAutocompleteItem(item) {
    if (!item) return;
    currentInputSource = 'autocomplete';
    clearTimeout(settledQueryTimer);
    clearTimeout(zeroResultsDebounceTimer);
    clearTimeout(autocompleteDebounceTimer);
    clearTimeout(liveSearchDebounceTimer);
    if (activeAutocompleteAbortController) {
      activeAutocompleteAbortController.abort();
      activeAutocompleteAbortController = null;
    }

    const isSettlement = item.mode === 'city' || item.mode === 'settlement' || item.type === 'місто' || item.type === 'смт' || item.type === 'село' || item.type === 'селище';
    let fill = '';

    if (isSettlement) {
      const settlement = item.settlementObj || item;
      const sName = cleanSettlementName(item.settlement || settlement.settlement || settlement.cleanName || settlement.name || item.title || item.value || '').replace(/[()]/g, '').trim();
      let sRaion = cleanRaionName(item.raion || settlement.cleanRaion || settlement.raion || '').replace(/[()]/g, '').trim();
      const sOblast = cleanOblastName(item.oblast || settlement.cleanOblast || settlement.oblast || '').replace(/[()]/g, '').trim();

      // Запобігаємо дублюванню району з назвою міста (напр. "Кам'янець-Подільський Кам'янець-Подільський", "Коломия Коломийський"):
      const sType = (settlement.type || item.type || item.badge || '').toLowerCase();
      if (sRaion) {
        const rCanon = (window.SmartSearchEngine && window.SmartSearchEngine.canonCity)
          ? window.SmartSearchEngine.canonCity(sRaion)
          : sRaion.toLowerCase().replace(/[^а-яіїєґa-z0-9]/gi, '');
        const nCanon = (window.SmartSearchEngine && window.SmartSearchEngine.canonCity)
          ? window.SmartSearchEngine.canonCity(sName)
          : sName.toLowerCase().replace(/[^а-яіїєґa-z0-9]/gi, '');
        const rStem = rCanon.slice(0, 4);
        const nStem = nCanon.slice(0, 4);
        if (rCanon === nCanon || (rStem && nStem && rStem === nStem) || sType === 'місто') {
          sRaion = '';
        }
      }

      // Гарантуємо чистий формат виключно через одинарні пробіли з кінцевим пробілом для швидкого дописування номера
      const fillParts = [sName];
      if (item.title && item.title.includes('(смт)')) {
        fillParts.push('(смт)');
      } else if (item.title && item.title.includes('(село)')) {
        fillParts.push('(село)');
      }
      if (sRaion) {
        fillParts.push(sRaion);
      }
      if (sOblast && sOblast.toLowerCase() !== sName.toLowerCase()) {
        fillParts.push(sOblast);
      }
      fill = fillParts.join(' ').replace(/\s+/g, ' ').trim() + ' ';

      state.selectedSettlement = {
        cleanName: sName,
        name: sName,
        cleanRaion: sRaion,
        raion: sRaion,
        cleanOblast: sOblast,
        oblast: sOblast,
        type: settlement.type || item.type || 'село',
        settlementRef: settlement.settlementRef || settlement.ref || settlement.Ref || null
      };
      state.selectedBranch = null;
      state.lockedInputValue = fill;
    } else {
      fill = (item.textToFill || item.title || '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
      state.selectedSettlement = null;
      state.lockedInputValue = fill;
    }

    dom.searchInput.value = fill;
    dom.btnClearSearch.classList.remove('hidden');
    closeAutocomplete();

    if (item.branchObj) {
      const b = item.branchObj;
      if (item.isCrossService && item.service && item.service !== state.currentService) {
        currentInputSource = 'smart_banner';
        await switchService(item.service, fill.trim(), b);
        return;
      }
      const bNum = b.number || b.postalCode || b.index;
      const fullGeoQuery = buildFullGeoQuery(b, bNum);
      if (fullGeoQuery) {
        fill = fullGeoQuery;
        dom.searchInput.value = fullGeoQuery;
        state.lockedInputValue = fullGeoQuery;
      }
      state.searchQuery = fill.trim();
      state.selectedBranch = b;
      state.selectedSettlement = {
        cleanName: cleanSettlementName(b.city),
        name: cleanSettlementName(b.city),
        cleanRaion: cleanRaionName(b.raion || ''),
        raion: cleanRaionName(b.raion || ''),
        cleanOblast: cleanOblastName(b.oblast || ''),
        oblast: cleanOblastName(b.oblast || ''),
        type: b.settlementType || 'місто'
      };
      state.currentResults = [b];
      renderSearchResults([b], fill.trim(), null, null);
      recordFrequentQuery(b.city || fill.trim());
      recordSearchHistory(fill.trim(), 1);
      updateSearchSessionState(fill.trim(), 1, 'autocomplete');
      logFailureTelemetry({
        query: fill.trim(),
        service: state.currentService,
        status: '🔵 Вибір: Автокомпліт',
        resultsCount: 1,
        duration: 1,
        details: 'Обрано конкретне відділення зі списку автокомпліту (знайдено 1 рез.).'
      });
      if (state.isMapVisible && state.leafletMap) {
        updateMapMarkers([b], b);
        if (b.lat && b.lng) {
          state.leafletMap.flyTo([b.lat, b.lng], 14, { duration: 1.2 });
        }
      }
      return;
    }

    // Якщо в базі відділень для цього села діє єдине відділення — одразу показувати його картку з кнопкою копіювання
    if (isSettlement) {
      const allBranches = getAllCurrentServiceBranches();
      const searchPool = getTabFilteredPool(allBranches, state.typeFilter);

      const engine = window.SmartSearchEngine;
      let matchedVillageBranches = [];
      const settlement = item.settlementObj || item;
      const sNameCanon = canonCity(settlement.cleanName || settlement.name || item.title || '');
      const sOblast = cleanOblastName(settlement.cleanOblast || settlement.oblast || '').toLowerCase();
      const sRaion = cleanRaionName(settlement.cleanRaion || settlement.raion || '').toLowerCase();

      // Швидкісна перевірка через індекс міста O(1) замість важкого подвійного пошуку по 55k відділеннях
      if (engine && engine.getCityBranchesFromPool) {
        matchedVillageBranches = engine.getCityBranchesFromPool(searchPool, sNameCanon);
      } else {
        matchedVillageBranches = searchPool.filter(b => (b._canonCity || canonCity(b.city)) === sNameCanon);
      }

      if (matchedVillageBranches.length > 0 && (sOblast || sRaion || item.badge || item.type)) {
        const itemType = (item.badge || item.type || '').toLowerCase();
        matchedVillageBranches = matchedVillageBranches.filter(b => {
          if (sOblast && b.oblast && !b.oblast.toLowerCase().includes(sOblast.slice(0, 4))) return false;
          if (sRaion && b.raion && !b.raion.toLowerCase().includes(sRaion.slice(0, 4)) && !areRaionsCompatible(sRaion, b.raion)) return false;
          if (itemType && b.settlementType) {
            const bType = (window.SmartSearchEngine && window.SmartSearchEngine.normalizeSettlementBadge)
              ? window.SmartSearchEngine.normalizeSettlementBadge(b.settlementType).toLowerCase()
              : b.settlementType.toLowerCase();
            if (bType && bType !== itemType) return false;
          }
          return true;
        });
      }

      if (matchedVillageBranches.length === 1) {
        const singleBranch = matchedVillageBranches[0];
        state.searchQuery = fill.trim();
        state.selectedBranch = singleBranch;
        state.currentResults = [singleBranch];
        renderSearchResults([singleBranch], fill.trim(), null, null);
        recordFrequentQuery(singleBranch.city || fill.trim());
        recordSearchHistory(fill.trim(), 1);
        updateSearchSessionState(fill.trim(), 1, 'autocomplete');
        logFailureTelemetry({
          query: fill.trim(),
          service: state.currentService,
          status: '🔵 Вибір: Автокомпліт',
          resultsCount: 1,
          duration: 1,
          details: 'Обрано населений пункт з автокомпліту (автоматично знайдено єдине відділення).'
        });
        if (state.isMapVisible && state.leafletMap) {
          updateMapMarkers([singleBranch], singleBranch);
          if (singleBranch.lat && singleBranch.lng) {
            state.leafletMap.flyTo([singleBranch.lat, singleBranch.lng], 14, { duration: 1.2 });
          }
        }
        focusSearchInputAtEnd(false);
        setTimeout(() => focusSearchInputAtEnd(false), 25);
        return;
      }
    }

    executeSearch(fill.trim(), true, true);
    if (isSettlement) {
      focusSearchInputAtEnd(false);
      setTimeout(() => focusSearchInputAtEnd(false), 25);
    }
  }

  function selectSuggestion(item) {
    return selectAutocompleteItem(item);
  }
  const onSuggestionClick = selectSuggestion;

  function updateAutocompleteFocus() {
    if (!dom.autocompleteDropdown) return;
    if (activeAutocompleteIndex >= renderedAutocompleteCount && renderedAutocompleteCount < autocompleteItems.length) {
      appendAutocompleteChunk(AUTOCOMPLETE_CHUNK_SIZE);
    }
    const isEmbedded = isEmbeddedMode();
    const items = dom.autocompleteDropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, idx) => {
      if (idx === activeAutocompleteIndex) {
        item.classList.add('focused');
        if (!isEmbedded && typeof item.scrollIntoView === 'function') {
          item.scrollIntoView({ block: 'nearest' });
        }
      } else {
        item.classList.remove('focused');
      }
    });
  }

  let activeResultIndex = -1;

  function updateSearchResultsFocus() {
    if (!dom.resultsList) return;
    if (activeResultIndex >= renderedSearchResultsCount && renderedSearchResultsCount < currentSearchResults.length) {
      appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);
    }
    const items = dom.resultsList.querySelectorAll('.address-match-row');
    if (items.length === 0) return;
    const isEmbedded = isEmbeddedMode();

    items.forEach((item, idx) => {
      if (idx === activeResultIndex) {
        item.classList.add('focused');
        item.setAttribute('aria-selected', 'true');
        if (!isEmbedded && typeof item.scrollIntoView === 'function') {
          item.scrollIntoView({ block: 'nearest' });
        }
        const branch = currentSearchResults[idx];
        if (branch && typeof setMarkerHighlightedOnMap === 'function') {
          setMarkerHighlightedOnMap(branch, true);
        }
      } else {
        item.classList.remove('focused');
        item.removeAttribute('aria-selected');
      }
    });

    if (activeResultIndex === -1 && typeof updateMapMarkersHighlight === 'function') {
      updateMapMarkersHighlight(null);
    }
  }

  // Показує панель табів; для Укрпошти ховає «Вантажні» та «Поштомати»
  function applyTypeFiltersVisibility() {
    if (!dom.resultsTypeFilters) return;
    dom.resultsTypeFilters.style.display = '';
    const isUP = state.currentService === 'ukrposhta';
    ['cargo', 'postomat'].forEach(t => {
      const pill = dom.resultsTypeFilters.querySelector(`[data-type="${t}"]`);
      if (pill) pill.style.display = isUP ? 'none' : '';
    });
  }

  function updateTypeFilterUI() {
    if (!dom.resultsTypeFilters) return;
    dom.resultsTypeFilters.querySelectorAll('.type-pill-btn').forEach(b => {
      if (b.getAttribute('data-type') === state.typeFilter) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }

  function hasFixedSettlementContext(query) {
    if (!query || query.length < 2) return false;

    const engine = window.SmartSearchEngine;

    // 1. Повний геоконтекст: у запиті розпізнано місто ТА область чи район
    // (наприклад: "Київ Київська", "Олександрія Кіровоградська", "Миколаїв Стрийський")
    let hasExplicitRegion = false;
    let detectedCity = '';
    if (engine && engine.extractFacets) {
      const facets = engine.extractFacets(query);
      if (facets && facets.city) {
        detectedCity = facets.city;
        if (facets.oblast || facets.raion) {
          hasExplicitRegion = true;
        }
      }
    }

    if (hasExplicitRegion) {
      return true;
    }

    const qTokens = query.trim().split(/\s+/).filter(Boolean);
    if (qTokens.length === 1 && !/\d/.test(query)) {
      return false;
    }

    // Перевірка на одноіменні населені пункти (Disambiguation Priority)
    if (!detectedCity) {
      const cleanVal = query.replace(/^(?:(?:місто|селище міського типу|смт|селище|село|сел)(?:\.|\s*)|\s*(?:м|с)(?:\.|\s+))\s*/iu, '').trim();
      detectedCity = cleanVal.split(/[, /;.]+/)[0];
    }

    if (detectedCity && engine && engine.findSettlementsByName) {
      const homonyms = engine.findSettlementsByName(detectedCity);
      if (homonyms.length >= 2) {
        // Якщо населений пункт має >= 2 омонімів в Україні, фіксація дозволена ВИКЛЮЧНО якщо:
        // а) Користувач явно зафіксував вибір кліком у дропдауні (lockedInputValue активний і запит починається з нього)
        if (state.lockedInputValue && canonText(query).startsWith(canonText(state.lockedInputValue.trim()))) {
          return true;
        }
        // б) Або в запиті є точне уточнення області чи району (перевірено вище через hasExplicitRegion)
        // Для простої назви міста (наприклад "Олександрія", "Миколаїв", "Кам'янка") фіксація суворо ЗАБОРОНЕНА!
        return false;
      }
    }

    // 2. Якщо вже вибрано або зафіксовано населений пункт і запит все ще починається з його назви
    if (state.selectedSettlement) {
      const sLower = canonText(state.selectedSettlement.cleanName);
      const qCanon = canonText(query);
      if (qCanon.startsWith(sLower)) {
        return true;
      }
    }

    // 3. Запит містить розпізнане місто та номер відділення/поштомату (наприклад: "львів 32348", "київ 111")
    if (detectedCity && (/\d+/.test(query) || (engine && engine.extractFacets && engine.extractFacets(query).number))) {
      return true;
    }

    return false;
  }

  function triggerAutocomplete(val) {
    if (!val || val.length < 2) {
      closeAutocomplete();
      return;
    }

    if (state.currentService === 'ukrposhta' && !_ukrposhtaLoaded) {
      loadUkrposhtaBranchesIfNeeded().then(() => {
        triggerAutocomplete(val);
      });
      return;
    }

    if (SearchWorkerBridge.isAvailable()) {
      const currentVal = val;
      SearchWorkerBridge.autocompleteAsync(val, state.currentService).then(suggestions => {
        if (suggestions && dom.searchInput && dom.searchInput.value.trim() === currentVal.trim()) {
          renderAutocomplete(suggestions, currentVal);
        }
      });
      return;
    }

    let cityPool = null;
    let candidate = null;
    if (window.SmartSearchEngine) {
      const facets = window.SmartSearchEngine.extractFacets(val);
      if (facets && facets.city) {
        candidate = facets.city.toLowerCase();
      }
    }
    if (!candidate) {
      const cleanVal = val.replace(/^(?:(?:місто|селище міського типу|смт|селище|село|сел)(?:\.|\s*)|\s*(?:м|с)(?:\.|\s+))\s*/iu, '').trim();
      candidate = cleanVal.split(/[, /;.]+/)[0].toLowerCase();
    }
    if (candidate && liveWarehousesCache.novaposhta.has(candidate)) {
      cityPool = liveWarehousesCache.novaposhta.get(candidate);
    }
    if (window.SmartSearchEngine) {
      const suggestions = window.SmartSearchEngine.getAutocompleteSuggestions(val, state.currentService, cityPool, getAllCurrentServiceBranches());
      renderAutocomplete(suggestions, val);
    }
  }

  // ==========================================================================
  // 9. EVENT LISTENERS
  // ==========================================================================
  function initEventListeners() {
    if (dom.btnThemeToggle) {
      dom.btnThemeToggle.addEventListener('click', toggleTheme);
    }
    dom.btnNovaPoshta.addEventListener('click', () => switchService('novaposhta'));
    dom.btnUkrposhta.addEventListener('click', () => switchService('ukrposhta'));

    dom.searchForm.addEventListener('submit', e => {
      e.preventDefault();
      clearTimeout(autocompleteDebounceTimer);
      clearTimeout(liveSearchDebounceTimer);
      if (activeAutocompleteAbortController) {
        activeAutocompleteAbortController.abort();
        activeAutocompleteAbortController = null;
      }

      const rawVal = (dom.searchInput ? dom.searchInput.value : '').trim();
      if (!rawVal) {
        const searchBoxCard = dom.searchForm;
        if (searchBoxCard && searchBoxCard.classList) {
          searchBoxCard.classList.remove('input-shake-error');
          if (typeof searchBoxCard.offsetWidth !== 'undefined') void searchBoxCard.offsetWidth;
          searchBoxCard.classList.add('input-shake-error');
          setTimeout(() => {
            if (searchBoxCard && searchBoxCard.classList) {
              searchBoxCard.classList.remove('input-shake-error');
            }
          }, 600);
        }
        if (dom.searchInput && typeof dom.searchInput.focus === 'function') dom.searchInput.focus();
        return;
      }

      const val = rawVal;
      const engine = window.SmartSearchEngine;
      const facets = engine && engine.extractFacets ? engine.extractFacets(val) : null;
      const hasRegion = facets && (facets.oblast || facets.raion);
      if (!hasRegion && !/\d/.test(val) && (!isAutocompleteOpen || currentAutocompleteQuery.trim() !== val.trim())) {
        triggerAutocomplete(val);
      }

      if (activeAutocompleteIndex >= 0 && activeAutocompleteIndex < autocompleteItems.length) {
        selectAutocompleteItem(autocompleteItems[activeAutocompleteIndex]);
        if (dom.searchInput) dom.searchInput.blur();
        return;
      }
      if (autocompleteItems.length > 0 && autocompleteItems[0].branchObj) {
        selectAutocompleteItem(autocompleteItems[0]);
        if (dom.searchInput) dom.searchInput.blur();
        return;
      }

      // Перевірка на вибір населеного пункту з омонімами (Disambiguation Priority)
      const isCityDisambiguation = autocompleteItems.length >= 2 && autocompleteItems.some(i => i.mode === 'city');

      if (isCityDisambiguation && !hasRegion) {
        // КАТЕГОРИЧНО ЗАБОРОНЕНО автозакривати попап або обирати перший ліпший:
        // залишаємо попап відкритим, підсвічуємо перший варіант для зручності
        activeAutocompleteIndex = 0;
        updateAutocompleteFocus();
        return;
      }

      clearTimeout(settledQueryTimer);
      clearTimeout(zeroResultsDebounceTimer);
      closeAutocomplete();
      if (dom.searchInput) {
        dom.searchInput.blur();
      }
      executeSearch(dom.searchInput.value, true, true);
    });

    // Відкриття поп-апу при кліку або фокусі на інпуті з вже введеним текстом
    const handleInputActivation = () => {
      updateBottomBarVisibility();
      if (suppressNextFocusActivation) return;
      const val = dom.searchInput.value.trim();
      if (val.length >= 2 && !isAutocompleteOpen) {
        // Якщо вже вибрано конкретне відділення і текст інпуту відповідає вибраному запиту, не перекриваємо картку при кліку
        if (state.selectedBranch && state.currentResults.length === 1 && val === state.searchQuery) {
          return;
        }
        // Якщо населений пункт уже зафіксовано (або введено повний геоконтекст), не вибиваємо поп-ап міст при фокусі/кліку
        if (hasFixedSettlementContext(val)) {
          return;
        }
        triggerAutocomplete(val);
      }
    };
    dom.searchInput.addEventListener('focus', handleInputActivation);
    dom.searchInput.addEventListener('click', handleInputActivation);

    // Відстеження вставки з буфера обміну (Paste)
    // Не викликаємо executeSearch напряму на paste, щоб не вбивати автокомпліт:
    // наступна подія input сама відкриє поп-ап вибору населених пунктів (або запустить пошук за повним контекстом).
    dom.searchInput.addEventListener('paste', () => {
      clearTimeout(settledQueryTimer);
      clearTimeout(zeroResultsDebounceTimer);
      currentInputSource = 'paste';
      state.selectedSettlement = null;
      state.selectedBranch = null;
      state.lockedInputValue = null;
      if (dom.btnResetSelectedBranch) {
        dom.btnResetSelectedBranch.classList.add('hidden');
      }
    });

    // Автодоповнення та миттєвий живий пошук при введенні (LP-CRM City Mode <-> Branch Mode + дебаунс + AbortController)
    dom.searchInput.addEventListener('input', () => {
      clearTimeout(settledQueryTimer);
      clearTimeout(zeroResultsDebounceTimer);
      const val = dom.searchInput.value.trim();
      if (!val) resetFrequentSession();
      activeResultIndex = -1;
      updateSearchResultsFocus();

      // Скидання зафіксованого вибору при ручному редагуванні (Input Event):
      // Якщо поточне значення змінилося і більше не збігається з раніше зафіксованим рядком
      const lockedTrim = state.lockedInputValue ? state.lockedInputValue.trim() : '';
      if (lockedTrim && val !== lockedTrim && !val.startsWith(lockedTrim + ' ')) {
        state.selectedBranch = null;
        state.selectedSettlement = null;
        state.lockedInputValue = null;
        if (dom.btnResetSelectedBranch) {
          dom.btnResetSelectedBranch.classList.add('hidden');
        }
      }

      if (state.selectedSettlement) {
        const sLower = canonText(state.selectedSettlement.cleanName);
        const valCanon = canonText(val);

        const isSmtQuery = /(?<!\p{L})(?:смт|селище міського типу|селище|сел\.?)(?!\p{L})/iu.test(val);
        const isSeloQuery = /(?<!\p{L})(?:село|с\.)(?!\p{L})/iu.test(val);
        const isMistoQuery = /(?<!\p{L})(?:місто|м\.)(?!\p{L})/iu.test(val);
        const selType = (state.selectedSettlement.type || '').toLowerCase();
        const typeConflict = (isSmtQuery && (selType === 'село' || selType === 'місто')) ||
                             (isSeloQuery && (selType.includes('селище') || selType === 'смт' || selType === 'місто')) ||
                             (isMistoQuery && selType !== 'місто');

        // Якщо введено омонім (наприклад "Олександрія") без уточнення області/району і без активного lockedInputValue,
        // скидаємо попередньо зафіксоване місто, щоб гарантувати показ випадаючого списку варіантів!
        let isHomonymWithoutRegion = false;
        if (window.SmartSearchEngine && window.SmartSearchEngine.findSettlementsByName) {
          const homonyms = window.SmartSearchEngine.findSettlementsByName(state.selectedSettlement.cleanName);
          if (homonyms.length >= 2) {
            const facets = window.SmartSearchEngine.extractFacets ? window.SmartSearchEngine.extractFacets(val) : null;
            if (!facets || (!facets.oblast && !facets.raion)) {
              if (!state.lockedInputValue || !valCanon.startsWith(canonText(state.lockedInputValue.trim()))) {
                isHomonymWithoutRegion = true;
              }
            }
          }
        }

        // Якщо користувач почав стирати або змінив саму назву зафіксованого міста (наприклад "ки" замість "київ") або змінив тип
        if (!valCanon.startsWith(sLower) || isHomonymWithoutRegion || typeConflict) {
          state.selectedSettlement = null;
          state.selectedBranch = null;
          state.lockedInputValue = null;
          if (dom.btnResetSelectedBranch) {
            dom.btnResetSelectedBranch.classList.add('hidden');
          }
        }
      }

      if (state.selectedBranch && val !== state.searchQuery) {
        state.selectedBranch = null;
        if (dom.btnResetSelectedBranch) {
          dom.btnResetSelectedBranch.classList.add('hidden');
        }
      }

      if (val.length > 0) {
        dom.btnClearSearch.classList.remove('hidden');
      } else {
        dom.btnClearSearch.classList.add('hidden');
        closeAutocomplete();
        state.searchQuery = '';
        state.currentResults = [];
        state.selectedSettlement = null;
        state.selectedBranch = null;
        state.lockedInputValue = null;
        if (dom.btnResetSelectedBranch) {
          dom.btnResetSelectedBranch.classList.add('hidden');
        }
      }

      // Скасовуємо попередні незавершені запити пошуку та автокомпліту
      if (activeSearchAbortController) {
        activeSearchAbortController.abort();
      }
      if (activeAutocompleteAbortController) {
        activeAutocompleteAbortController.abort();
      }
      activeAutocompleteAbortController = new AbortController();
      const currentSignal = activeAutocompleteAbortController.signal;

      clearTimeout(autocompleteDebounceTimer);
      clearTimeout(liveSearchDebounceTimer);

      const isDemoTyping = Boolean(dom.searchInput && dom.searchInput.dataset && dom.searchInput.dataset.demoTyping === '1');

      if (val.length >= 2) {
        const hasDigitOrBranch = /\d/.test(val) || /(?:поштомат|відділення|віділення|відділ|№|#)/i.test(val);
        const isFixedSettlement = hasFixedSettlementContext(val);

        if (isFixedSettlement && !hasDigitOrBranch) {
          // 1. Придушення попапу, коли населений пункт уже зафіксовано або введено повний геоконтекст БЕЗ номера:
          // (напр. "Київ Київська", "Олександрія Кіровоградська")
          closeAutocomplete();

          // Якщо користувач видалив номер або запит не містить номера відділення (напр. стер "1" з "Київ Київська 1"),
          // скидаємо selectedBranch, щоб з'явився список запропонованих відділень міста!
          if (!/\d/.test(val)) {
            state.selectedBranch = null;
            if (dom.btnResetSelectedBranch) {
              dom.btnResetSelectedBranch.classList.add('hidden');
            }
          }

          if (isDemoTyping) {
            executeSearch(val, false, false);
          } else {
            // 2. Живий фільтр основного списку карток (debounce 150ms + safeRAF для 60fps)
            liveSearchDebounceTimer = setTimeout(() => {
              if (!currentSignal.aborted) {
                safeRAF(() => {
                  if (currentSignal.aborted) return;
                  const currentInput = dom.searchInput ? dom.searchInput.value.trim() : val;
                  if (!currentInput || currentInput.length < 2) return;
                  executeSearch(currentInput, false, false); // isExplicitSubmit = false
                });
              }
            }, 150);
          }
        } else {
          // Варіант 1: Коли користувач друкує запит (напр. "конотоп", "конотоп 1"),
          // відображається ВИКЛЮЧНО верхній поп-ап автокомпліту.
          // Нижня секція результатів (searchResultsSection) жорстко прихована,
          // щоб картки не пробивалися і не накладалися під випадаючий список.
          dom.searchResultsSection.classList.add('hidden');

          if (isDemoTyping) {
            triggerAutocomplete(val);
          } else {
            const acDelay = currentInputSource === 'paste' ? 20 : 180;
            autocompleteDebounceTimer = setTimeout(() => {
              if (currentSignal.aborted) return;
              safeRAF(() => {
                if (currentSignal.aborted) return;
                const currentInput = dom.searchInput ? dom.searchInput.value.trim() : val;
                if (!currentInput || currentInput.length < 2) return;
                triggerAutocomplete(currentInput);
              });
            }, acDelay);
          }
        }

        if (!isDemoTyping) {
          // Фіксація стабілізованого запиту через 700 мс після зупинки друку
          settledQueryTimer = setTimeout(() => {
            if (currentSignal.aborted) return;
            const settledVal = dom.searchInput ? dom.searchInput.value.trim() : val;
            if (!settledVal || settledVal.length < 2) return;
            const curCount = isAutocompleteOpen
              ? autocompleteItems.length
              : (state.searchQuery === settledVal ? state.currentResults.length : autocompleteItems.length);
            updateSearchSessionState(settledVal, curCount, currentInputSource);
            if (curCount > 0) {
              if (currentInputSource === 'paste') {
                const svcName = state.currentService === 'novaposhta' ? 'Нова пошта' : 'Укрпошта';
                logFailureTelemetry({
                  query: settledVal,
                  service: state.currentService,
                  status: '🔵 Пошук: Вставка з буфера',
                  resultsCount: curCount,
                  duration: 1,
                  details: `Оператор вставив запит з буфера обміну (знайдено ${curCount} варіантів/відділень). Служба: ${svcName}`
                });
              } else if (currentInputSource === 'manual') {
                logFailureTelemetry({
                  query: settledVal,
                  service: state.currentService,
                  status: '🔵 Ручний ввід (живий пошук)',
                  resultsCount: curCount,
                  duration: 1,
                  details: `Стабілізований ручний ввід (знайдено ${curCount} варіантів/відділень).`
                });
              }
            }
          }, 700);
        }
      } else {
        closeAutocomplete();
        if (dom.searchResultsSection) {
          dom.searchResultsSection.classList.add('hidden');
        }
      }
      updateBottomBarVisibility();
    });

    // Навігація клавішами в autocomplete та списку карток (ArrowUp, ArrowDown, Enter, Esc, Cmd+A / Ctrl+A)
    dom.searchInput.addEventListener('keydown', (e) => {
      if ((e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey) || e.key === 'Backspace' || e.key === 'Delete') {
        currentInputSource = 'manual';
      }
      const isSelectAll = (e.metaKey || e.ctrlKey) && (
        e.code === 'KeyA' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф'
      );
      if (e.key === 'Escape' || isSelectAll) {
        if (dom.autocompleteDropdown && !dom.autocompleteDropdown.classList.contains('hidden') && autocompleteItems.length > 0) {
          e.preventDefault();
          closeAutocomplete();
        } else if (activeResultIndex >= 0) {
          e.preventDefault();
          activeResultIndex = -1;
          updateSearchResultsFocus();
        }
        if (dom.searchInput) {
          e.preventDefault();
          dom.searchInput.focus();
          dom.searchInput.select();
        }
        return;
      }

      if (!dom.autocompleteDropdown || dom.autocompleteDropdown.classList.contains('hidden') || autocompleteItems.length === 0) {
        const hasSearchResults = dom.searchResultsSection && 
          !dom.searchResultsSection.classList.contains('hidden') && 
          !state.selectedBranch && 
          currentSearchResults && 
          currentSearchResults.length > 0;

        if (hasSearchResults) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeResultIndex < currentSearchResults.length - 1) {
              activeResultIndex++;
              if (activeResultIndex >= renderedSearchResultsCount - 3 && renderedSearchResultsCount < currentSearchResults.length) {
                appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);
              }
              updateSearchResultsFocus();
            }
            return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeResultIndex > 0) {
              activeResultIndex--;
              updateSearchResultsFocus();
            } else if (activeResultIndex === 0) {
              activeResultIndex = -1;
              updateSearchResultsFocus();
              if (dom.searchInput) {
                dom.searchInput.focus();
              }
            }
            return;
          } else if (e.key === 'Enter' && activeResultIndex >= 0) {
            e.preventDefault();
            clearTimeout(autocompleteDebounceTimer);
            clearTimeout(liveSearchDebounceTimer);
            const items = dom.resultsList ? dom.resultsList.querySelectorAll('.address-match-row') : [];
            if (items[activeResultIndex]) {
              if (typeof items[activeResultIndex].click === 'function') {
                items[activeResultIndex].click();
              } else if (typeof items[activeResultIndex].dispatchEvent === 'function') {
                items[activeResultIndex].dispatchEvent({ type: 'click' });
              }
            }
            activeResultIndex = -1;
            return;
          }
        }

        if (e.key === 'Enter') {
          const val = (dom.searchInput ? dom.searchInput.value : '').trim();
          const engine = window.SmartSearchEngine;
          if (engine && !/\d/.test(val)) {
            const facets = engine.extractFacets ? engine.extractFacets(val) : null;
            if (!facets || (!facets.oblast && !facets.raion)) {
              const homonyms = engine.findSettlementsByName ? engine.findSettlementsByName(val) : [];
              if (homonyms.length >= 2) {
                // Заборонено виконувати пошук першого ліпшого: показуємо підказки!
                e.preventDefault();
                triggerAutocomplete(val);
                return;
              }
              triggerAutocomplete(val);
              if (autocompleteItems.length >= 2 && autocompleteItems.some(i => i.mode === 'city')) {
                e.preventDefault();
                activeAutocompleteIndex = 0;
                updateAutocompleteFocus();
                return;
              }
            }
          }

          e.preventDefault();
          clearTimeout(settledQueryTimer);
          clearTimeout(zeroResultsDebounceTimer);
          clearTimeout(autocompleteDebounceTimer);
          clearTimeout(liveSearchDebounceTimer);
          if (activeAutocompleteAbortController) {
            activeAutocompleteAbortController.abort();
            activeAutocompleteAbortController = null;
          }
          closeAutocomplete();
          if (dom.searchInput) dom.searchInput.blur();
          executeSearch(dom.searchInput.value, true, true);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (activeAutocompleteIndex < autocompleteItems.length - 1) {
          activeAutocompleteIndex++;
          if (activeAutocompleteIndex >= renderedAutocompleteCount - 3 && renderedAutocompleteCount < autocompleteItems.length) {
            appendAutocompleteChunk(AUTOCOMPLETE_CHUNK_SIZE);
          }
          updateAutocompleteFocus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeAutocompleteIndex > 0) {
          activeAutocompleteIndex--;
          updateAutocompleteFocus();
        } else if (activeAutocompleteIndex === 0) {
          activeAutocompleteIndex = -1;
          updateAutocompleteFocus();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(autocompleteDebounceTimer);
        clearTimeout(liveSearchDebounceTimer);
        if (activeAutocompleteAbortController) {
          activeAutocompleteAbortController.abort();
          activeAutocompleteAbortController = null;
        }

        const val = (dom.searchInput ? dom.searchInput.value : '').trim();
        const engine = window.SmartSearchEngine;
        const facets = engine && engine.extractFacets ? engine.extractFacets(val) : null;
        const hasRegion = facets && (facets.oblast || facets.raion);
        if (!hasRegion && !/\d/.test(val) && currentAutocompleteQuery.trim() !== val.trim()) {
          triggerAutocomplete(val);
        }

        if (activeAutocompleteIndex >= 0 && activeAutocompleteIndex < autocompleteItems.length) {
          selectAutocompleteItem(autocompleteItems[activeAutocompleteIndex]);
          if (dom.searchInput) dom.searchInput.blur();
        } else if (autocompleteItems.length > 0 && autocompleteItems[0].branchObj) {
          selectAutocompleteItem(autocompleteItems[0]);
          if (dom.searchInput) dom.searchInput.blur();
        } else {
          // Якщо це режим вибору міст-омонімів (>= 2 варіантів міст без вибраного району)
          const isCityDisambiguation = autocompleteItems.length >= 2 && autocompleteItems.some(i => i.mode === 'city');

          if (isCityDisambiguation && !hasRegion) {
            // КАТЕГОРИЧНО ЗАБОРОНЕНО автозакривати попап або обирати перший ліпший!
            activeAutocompleteIndex = 0;
            updateAutocompleteFocus();
            return;
          }

          closeAutocomplete();
          if (dom.searchInput) dom.searchInput.blur();
          executeSearch(dom.searchInput.value, true, true);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAutocomplete();
      }
    });

    // Закриття автокомпліту ТІЛЬКИ при явному кліку поза межами інпута й поп-апу (без конфліктів фокусу blur)
    document.addEventListener('pointerdown', (e) => {
      const isInputClick = dom.searchInput && dom.searchInput.contains(e.target);
      const isDropdownClick = dom.autocompleteDropdown && dom.autocompleteDropdown.contains(e.target);
      const isQuickClick = Boolean(e.target && e.target.closest && e.target.closest('.query-chip-btn, .history-card-item, .frequent-queries-section, .recent-history-section'));
      if (!isInputClick && !isDropdownClick && !isQuickClick) {
        closeAutocomplete();
      }
    });

    // Десктопні гарячі клавіші для оператора: / або Esc / Cmd+A / Ctrl+A для миттєвого фокусу та виділення рядка пошуку
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', (e) => {
        const isModalOpen = (dom.copyPresetModal && dom.copyPresetModal.open) ||
                            (dom.versionModal && dom.versionModal.open);
        if (isModalOpen) return;

        const isSelectAll = (e.metaKey || e.ctrlKey) && (
          e.code === 'KeyA' || e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф'
        );

        if (isSelectAll) {
          const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
          // Працює глобально по всій сторінці (крім спеціальних модалок або сторонніх textarea)
          if (tag !== 'textarea' && (tag !== 'input' || document.activeElement === dom.searchInput)) {
            e.preventDefault();
            closeAutocomplete();
            if (activeResultIndex >= 0) {
              activeResultIndex = -1;
              updateSearchResultsFocus();
            }
            if (dom.searchInput) {
              dom.searchInput.focus();
              dom.searchInput.select();
            }
          }
        } else if (e.key === '/' && document.activeElement !== dom.searchInput) {
          const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
          if (tag !== 'input' && tag !== 'textarea') {
            e.preventDefault();
            if (dom.searchInput) {
              dom.searchInput.focus();
              dom.searchInput.select();
            }
          }
        } else if (e.key === 'Escape') {
          if (dom.autocompleteDropdown && !dom.autocompleteDropdown.classList.contains('hidden')) {
            e.preventDefault();
            closeAutocomplete();
          } else if (dom.searchInput) {
            e.preventDefault();
            dom.searchInput.focus();
            dom.searchInput.select();
          }
        }
      });

      // Клік по інтерактивних бейджах клавіш у підказці
      document.querySelectorAll('.kbd-key').forEach(kbd => {
        kbd.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = (kbd.textContent || '').trim();
          if (dom.searchInput) {
            dom.searchInput.focus();
            if (text === 'Esc') {
              dom.searchInput.select();
            }
          }
        });
      });
    }

    // Оптимізована підгрузка чанків при скролі дропдауну (віртуалізація / progressive lazy-loading)
    if (dom.autocompleteDropdown) {
      dom.autocompleteDropdown.addEventListener('scroll', () => {
        if (renderedAutocompleteCount < autocompleteItems.length) {
          const threshold = 120;
          if (dom.autocompleteDropdown.scrollTop + dom.autocompleteDropdown.clientHeight >= dom.autocompleteDropdown.scrollHeight - threshold) {
            appendAutocompleteChunk(AUTOCOMPLETE_CHUNK_SIZE);
          }
        }
      }, { passive: true });
    }

    // Limit Selector (5 | 10 | 20 | Всі)
    if (dom.limitSelector) {
      dom.limitSelector.addEventListener('click', (e) => {
        const btn = e.target.closest('.limit-btn');
        if (!btn) return;
        const limitVal = btn.getAttribute('data-limit');
        state.displayLimit = limitVal === 'all' ? 'all' : parseInt(limitVal, 10);

        dom.limitSelector.querySelectorAll('.limit-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (state.currentResults.length > 0) {
          renderSearchResults(state.currentResults, state.searchQuery, null);
        }
      });
    }

    // Type Filter Pills (Всі | Відділення | Поштомати)
    if (dom.resultsTypeFilters) {
      dom.resultsTypeFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-pill-btn');
        if (!btn) return;
        const typeVal = btn.getAttribute('data-type');
        state.typeFilter = typeVal;

        updateTypeFilterUI();

        // Скидаємо внутрішній скрол списку до початку без стрибків сторінки вниз
        if (dom.resultsList && typeof dom.resultsList.scrollTop !== 'undefined') {
          dom.resultsList.scrollTop = 0;
        }

        state.selectedBranch = null;
        if (state.currentResults && state.currentResults.length > 0) {
          renderSearchResults(state.currentResults, state.searchQuery, null);
        } else if (state.searchQuery) {
          executeSearch(state.searchQuery, false, false);
        }
      });
    }

    // Плавна підгрузка результатів видачі при скролі внутрішнього контейнера списку
    if (dom.resultsList) {
      dom.resultsList.addEventListener('scroll', () => {
        if (renderedSearchResultsCount < currentSearchResults.length) {
          const sentinel = document.getElementById('infiniteScrollSentinel');
          if (sentinel) {
            const containerRect = dom.resultsList.getBoundingClientRect();
            const sentinelRect = sentinel.getBoundingClientRect();
            if (sentinelRect.top <= containerRect.bottom + 250) {
              appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);
            }
          }
        }
      }, { passive: true });
    }

    // Fallback для плавної підгрузки результатів видачі при скролі сторінки
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('scroll', () => {
        if (renderedSearchResultsCount < currentSearchResults.length) {
          const sentinel = document.getElementById('infiniteScrollSentinel');
          if (sentinel) {
            const rect = sentinel.getBoundingClientRect();
            if (rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 300) {
              appendNextSearchResultsChunk(SEARCH_RESULTS_CHUNK_SIZE);
            }
          }
        }
      }, { passive: true });
    }

    dom.btnClearSearch.addEventListener('click', () => {
      clearTimeout(settledQueryTimer);
      clearTimeout(zeroResultsDebounceTimer);
      resetFrequentSession();
      if (
        lastSearchSession.query &&
        !lastSearchSession.hasCopied &&
        !lastSearchSession.abandonedTracked &&
        lastSearchSession.query.length >= 2
      ) {
        const elapsed = Date.now() - lastSearchSession.timestamp;
        if (elapsed >= 200 && elapsed <= 45000) {
          logFailureTelemetry({
            query: lastSearchSession.query,
            service: lastSearchSession.service,
            status: '🟠 Очищення поля без копіювання',
            resultsCount: lastSearchSession.resultsCount,
            duration: Math.max(1, Math.round(elapsed / 1000)),
            details: `Оператор очистив поле пошуку без копіювання адреси. Джерело: ${getSourceLabel(lastSearchSession.source || currentInputSource)}`
          });
        }
      }
      resetSearchSessionState();
      dom.searchInput.value = '';
      dom.btnClearSearch.classList.add('hidden');
      dom.searchResultsSection.classList.add('hidden');
      closeAutocomplete();
      updateBottomBarVisibility();
      state.searchQuery = '';
      state.currentResults = [];
      state.selectedBranch = null;
      state.selectedSettlement = null;
      state.lockedInputValue = null;
      if (dom.btnResetSelectedBranch) {
        dom.btnResetSelectedBranch.classList.add('hidden');
      }
      if (state.isMapVisible) {
        updateVisibleMarkersFromViewport();
      }
      if (!(dom.searchInput.dataset && dom.searchInput.dataset.demoTyping === '1')) {
        dom.searchInput.focus({ preventScroll: true });
      }
    });

    if (dom.btnResetSelectedBranch) {
      dom.btnResetSelectedBranch.addEventListener('click', () => {
        resetBranchSelection();
      });
    }

    if (dom.mapTypeFilters) {
      dom.mapTypeFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.map-filter-btn');
        if (!btn) return;
        const type = btn.getAttribute('data-map-type') || 'all';
        state.mapTypeFilter = type;
        updateMapTypeFilterUI();
        updateVisibleMarkersFromViewport();
      });
    }

    dom.btnToggleMap.addEventListener('click', toggleMapView);
    if (dom.btnCloseMap) {
      dom.btnCloseMap.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.isMapVisible) toggleMapView();
      });
    }
    if (dom.mapSection) {
      dom.mapSection.addEventListener('click', (e) => {
        const target = e.target;
        if (target && (target.id === 'btnCloseMap' || (target.closest && target.closest('#btnCloseMap')))) {
          e.preventDefault();
          e.stopPropagation();
          if (state.isMapVisible) toggleMapView();
        }
      });
    }
    dom.btnGeoLocate.addEventListener('click', getUserLocation);

    dom.btnClearHistory.addEventListener('click', () => {
      if (confirm('Очистити збережену історію пошуків?')) {
        saveSearchHistory([]);
        renderRecentHistory([]);
      }
    });

    // Модалка версій (ліниве завантаження журналу змін при першому відкритті)
    let _changelogLoaded = false;
    let _changelogLoadingPromise = null;
    function ensureChangelogLoaded() {
      if (_changelogLoaded) return Promise.resolve();
      if (_changelogLoadingPromise) return _changelogLoadingPromise;
      const bodyEl = document.getElementById('versionModalBody');
      if (!bodyEl || typeof fetch !== 'function' || (window.location && window.location.protocol === 'file:')) {
        if (bodyEl) {
          bodyEl.innerHTML = '<div style="text-align:center; padding:24px 16px;"><a href="https://github.com/vadym-des/np-search-engine/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" style="color:var(--brand-primary, #e11d48); font-weight:600; text-decoration:none;">📄 Повна історія змін у CHANGELOG.md ➔</a></div>';
        }
        return Promise.resolve();
      }
      _changelogLoadingPromise = fetch(`data/changelog-modal.html?v=${APP_VERSION}`)
        .then(resp => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.text();
        })
        .then(html => {
          bodyEl.innerHTML = html;
          _changelogLoaded = true;
        })
        .catch(() => {
          _changelogLoadingPromise = null;
          bodyEl.innerHTML = '<div style="text-align:center; padding:24px 16px;"><a href="https://github.com/vadym-des/np-search-engine/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer" style="color:var(--brand-primary, #e11d48); font-weight:600; text-decoration:none;">📄 Повна історія змін у CHANGELOG.md ➔</a></div>';
        });
      return _changelogLoadingPromise;
    }

    dom.btnVersionHistory.addEventListener('click', () => {
      ensureChangelogLoaded();
      dom.versionModal.showModal();
    });
    dom.btnCloseVersionModal.addEventListener('click', () => dom.versionModal.close());
    dom.btnDismissVersionModal.addEventListener('click', () => dom.versionModal.close());
    dom.versionModal.addEventListener('click', e => {
      const rect = dom.versionModal.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.bottom &&
        rect.left <= e.clientX &&
        e.clientX <= rect.right
      );
      if (!isInDialog || e.target === dom.versionModal) {
        dom.versionModal.close();
      }
    });

    // Відстеження відкриття / переходу за посиланням фідбеку
    const feedbackLink = dom.btnFeedback || (typeof document !== 'undefined' && typeof document.querySelector === 'function' ? document.querySelector('.btn-feedback') : null);
    if (feedbackLink && typeof feedbackLink.addEventListener === 'function') {
      feedbackLink.addEventListener('click', () => {
        trackEvent('open_feedback');
      });
    }

    // Делегований обробник копіювання з попапів карти
    if (dom.branchesMap) {
      dom.branchesMap.addEventListener('click', e => {
        const copyBtn = e.target.closest('.btn-popup-copy');
        if (copyBtn) {
          const text = copyBtn.getAttribute('data-copy');
          if (text) {
            copyTextToClipboard(text, copyBtn, 'Скопійовано!', 1500);
            const branchType = copyBtn.getAttribute('data-branch-type') || 'відділення';
            trackEvent('copy_branch_address', {
              branch_type: branchType
            });
          }
        }
      });
    }

    // Ініціалізація конструктора шаблонів копіювання
    initCopyPresetBuilder();
  }

  // ==========================================================================
  // КОНТРОЛЕР МОДАЛЬНОГО ВІКНА КОНСТРУКТОРА ШАБЛОНІВ КОПІЮВАННЯ
  // ==========================================================================
  let activePresetTab = 'short';
  let draftCopyPresets = null;
  let lastPresetLivePreviewStr = '';

  function highlightPreviewDiff(oldStr, newStr) {
    if (!oldStr || oldStr === newStr) return escapeHtml(newStr);

    // Спільний префікс
    let start = 0;
    while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
      start++;
    }

    // Спільний суфікс
    let endOld = oldStr.length - 1;
    let endNew = newStr.length - 1;
    while (endOld >= start && endNew >= start && oldStr[endOld] === newStr[endNew]) {
      endOld--;
      endNew--;
    }

    // Якщо фрагмент видалено або start > endNew: підсвічуємо невеликий контекст у точці зміни
    if (start > endNew) {
      const idx = Math.min(start, newStr.length);
      const ctxStart = Math.max(0, idx - 3);
      const ctxEnd = Math.min(newStr.length, idx + 3);
      const prefix = newStr.slice(0, ctxStart);
      const changed = newStr.slice(ctxStart, ctxEnd);
      const suffix = newStr.slice(ctxEnd);
      return `${escapeHtml(prefix)}<span class="preview-flash-highlight">${escapeHtml(changed)}</span>${escapeHtml(suffix)}`;
    }

    // Розширюємо межі до початку та кінця слів/токенів у межах [0, newStr.length]
    while (start > 0 && !/[\s,.:]/.test(newStr[start - 1])) {
      start--;
    }
    while (endNew < newStr.length - 1 && !/[\s,.:]/.test(newStr[endNew + 1])) {
      endNew++;
    }

    const prefix = newStr.slice(0, start);
    const changed = newStr.slice(start, endNew + 1);
    const suffix = newStr.slice(endNew + 1);

    return `${escapeHtml(prefix)}<span class="preview-flash-highlight">${escapeHtml(changed)}</span>${escapeHtml(suffix)}`;
  }

  function renderPresetModalUI() {
    if (!draftCopyPresets) {
      draftCopyPresets = JSON.parse(JSON.stringify(userCopyPresets));
    }

    const currentConfig = draftCopyPresets[activePresetTab];
    const detectedName = detectPresetType(activePresetTab, currentConfig);
    currentConfig.presetName = detectedName;

    // 1. Оновлення табів
    document.querySelectorAll('.copy-preset-tab').forEach(tab => {
      const isCurrent = tab.dataset.tab === activePresetTab;
      tab.classList.toggle('active', isCurrent);
      tab.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });

    // 2. Оновлення кнопок швидких пресетів
    if (dom.presetQuickButtons) {
      dom.presetQuickButtons.querySelectorAll('.btn-preset-quick').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === detectedName);
      });
    }

    // 3. Рендер активних чіпів з підтримкою HTML5 Drag-and-Drop в актуальному порядку шаблону
    if (dom.presetActiveChips) {
      dom.presetActiveChips.innerHTML = '';
      const tags = currentConfig.tags || [];
      tags.forEach((tagId, index) => {
        const info = getTagDisplayInfo(tagId, currentConfig.options);
        const chip = document.createElement('div');
        chip.className = 'preset-chip';
        chip.setAttribute('draggable', 'true');
        chip.dataset.index = index;
        chip.dataset.tag = tagId;
        chip.title = `${info.title} (перетягніть мишкою для зміни порядку)`;
        chip.innerHTML = `
          <span class="chip-grip" aria-hidden="true" title="Перетягнути">⋮⋮</span>
          <span class="chip-label">${escapeHtml(info.label)}</span>
          <button type="button" class="chip-del-btn" data-index="${index}" title="Видалити «${escapeHtml(info.label)}» із шаблону" aria-label="Видалити" draggable="false">✕</button>
        `;
        dom.presetActiveChips.appendChild(chip);
      });
      if (tags.length === 0) {
        const emptyHint = document.createElement('span');
        emptyHint.className = 'preset-palette-empty';
        emptyHint.textContent = 'Усі елементи видалено. Додайте потрібні елементи з палітри нижче.';
        dom.presetActiveChips.appendChild(emptyHint);
      }
    }

    // 4. Рендер палітри доступних чіпів (динамічний пул без дублювання в канонічному порядку)
    if (dom.presetChipPalette) {
      dom.presetChipPalette.innerHTML = '';
      const activeTags = currentConfig.tags || [];
      const availableTagIds = CANONICAL_TAG_ORDER.filter(id => !activeTags.includes(id));
      availableTagIds.forEach(tagId => {
        const info = getTagDisplayInfo(tagId, currentConfig.options);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'preset-palette-item';
        item.dataset.tag = tagId;
        item.title = `${info.title} (натисніть, щоб додати)`;
        item.innerHTML = `<span class="palette-plus">+</span> <span class="palette-label">${escapeHtml(info.label)}</span>`;
        dom.presetChipPalette.appendChild(item);
      });
      if (availableTagIds.length === 0) {
        const emptyHint = document.createElement('span');
        emptyHint.className = 'preset-palette-empty';
        emptyHint.textContent = 'Усі доступні елементи додано до шаблону';
        dom.presetChipPalette.appendChild(emptyHint);
      }
    }

    // 5. Оновлення чекбоксів та їх пігулок (Швидкі правила скорочення)
    [
      { el: dom.optSmtShort, val: !!currentConfig.options.smtShort },
      { el: dom.optNoBranchWord, val: !!currentConfig.options.noBranchWord },
      { el: dom.optShortRegion, val: !!currentConfig.options.shortRegion },
      { el: dom.optNoStreetPrefix, val: !!currentConfig.options.noStreetPrefix }
    ].forEach(item => {
      if (item.el) {
        item.el.checked = item.val;
        const pill = item.el.closest('.preset-rule-pill');
        if (pill) pill.classList.toggle('active', item.val);
      }
    });

    // 6. Оновлення Live Preview зі спалахом підсвітки (Flash Highlight)
    // У конструкторі шаблону зразок завжди будується на стандартизованому BENCHMARK_SAMPLE_BRANCH (Середнє),
    // щоб не було розсинхрону між полем зразка, інтерактивними чіпсами та підказкою
    const previewBranch = BENCHMARK_SAMPLE_BRANCH;
    let previewStr = '';
    if (detectedName === 'default') {
      previewStr = activePresetTab === 'detailed'
        ? formatDetailedCopyStringDefault(previewBranch)
        : formatClassicCopyStringDefault(previewBranch);
    } else {
      previewStr = assembleCopyStringFromPreset(previewBranch, currentConfig);
    }
    if (dom.presetLivePreview) {
      if (lastPresetLivePreviewStr && lastPresetLivePreviewStr !== previewStr) {
        dom.presetLivePreview.innerHTML = highlightPreviewDiff(lastPresetLivePreviewStr, previewStr);
        dom.presetLivePreview.classList.remove('preview-box-pulse');
        void dom.presetLivePreview.offsetWidth;
        dom.presetLivePreview.classList.add('preview-box-pulse');
      } else {
        dom.presetLivePreview.textContent = previewStr;
      }
      lastPresetLivePreviewStr = previewStr;
    }
  }

  function openCopyPresetModal() {
    lastPresetLivePreviewStr = '';
    draftCopyPresets = JSON.parse(JSON.stringify(userCopyPresets));
    renderPresetModalUI();
    if (dom.copyPresetModal && typeof dom.copyPresetModal.showModal === 'function') {
      dom.copyPresetModal.showModal();
    }
  }

  function initCopyPresetBuilder() {
    if (dom.btnHeaderCopySettings) {
      dom.btnHeaderCopySettings.addEventListener('click', (e) => {
        e.stopPropagation();
        openCopyPresetModal();
      });
    }

    if (dom.btnCloseCopyModal) {
      dom.btnCloseCopyModal.addEventListener('click', () => {
        if (dom.copyPresetModal) dom.copyPresetModal.close();
      });
    }

    if (dom.copyPresetModal) {
      dom.copyPresetModal.addEventListener('click', e => {
        const rect = dom.copyPresetModal.getBoundingClientRect();
        const isInDialog = (
          rect.top <= e.clientY &&
          e.clientY <= rect.bottom &&
          rect.left <= e.clientX &&
          e.clientX <= rect.right
        );
        if (!isInDialog || e.target === dom.copyPresetModal) {
          dom.copyPresetModal.close();
        }
      });
    }

    // Таби: Скопіювати / Детально
    document.querySelectorAll('.copy-preset-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        lastPresetLivePreviewStr = '';
        activePresetTab = btn.dataset.tab;
        renderPresetModalUI();
      });
    });

    // Швидкі пресети
    if (dom.presetQuickButtons) {
      dom.presetQuickButtons.addEventListener('click', e => {
        const btn = e.target.closest('.btn-preset-quick');
        if (!btn) return;
        const presetKey = btn.dataset.preset;
        if (presetKey === 'custom') return;
        const def = QUICK_PRESETS[activePresetTab] && QUICK_PRESETS[activePresetTab][presetKey];
        if (def) {
          draftCopyPresets[activePresetTab] = {
            presetName: presetKey,
            tags: def.tags.slice(),
            options: Object.assign({}, def.options)
          };
          renderPresetModalUI();
        }
      });
    }

    // Нативний Drag-and-Drop для сортування та видалення активних чіпів (без layout thrashing)
    if (dom.presetActiveChips) {
      let draggedChipIndex = null;
      let lastHoverChip = null;
      let lastHoverSide = null;

      function clearHoverIndicators() {
        if (lastHoverChip) {
          lastHoverChip.classList.remove('drag-over-left', 'drag-over-right');
          lastHoverChip = null;
          lastHoverSide = null;
        }
      }

      // 1. Початок перетягування (dragstart)
      dom.presetActiveChips.addEventListener('dragstart', (e) => {
        const chip = e.target.closest('.preset-chip');
        if (!chip || e.target.closest('.chip-del-btn')) {
          e.preventDefault();
          return;
        }
        draggedChipIndex = parseInt(chip.dataset.index, 10);
        chip.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(draggedChipIndex));
        }
      });

      // 2. Наведення під час перетягування (dragover): індикатор лінії вставки з оптимізацією DOM-мутацій
      dom.presetActiveChips.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }

        const chip = e.target.closest('.preset-chip');
        if (!chip || chip.classList.contains('dragging')) {
          clearHoverIndicators();
          return;
        }

        if (chip !== lastHoverChip) {
          clearHoverIndicators();
          lastHoverChip = chip;
        }

        const rect = chip.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const newSide = e.clientX < midX ? 'left' : 'right';

        if (lastHoverSide !== newSide) {
          lastHoverSide = newSide;
          if (newSide === 'left') {
            chip.classList.add('drag-over-left');
            chip.classList.remove('drag-over-right');
          } else {
            chip.classList.add('drag-over-right');
            chip.classList.remove('drag-over-left');
          }
        }
      });

      // 3. Вихід курсора з чіпа (dragleave)
      dom.presetActiveChips.addEventListener('dragleave', (e) => {
        const chip = e.target.closest('.preset-chip');
        if (chip && !chip.contains(e.relatedTarget)) {
          clearHoverIndicators();
        }
      });

      // 4. Завершення скидання (drop): оновлення порядку в стані
      dom.presetActiveChips.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const chip = e.target.closest('.preset-chip');
        const tags = draftCopyPresets && draftCopyPresets[activePresetTab] ? draftCopyPresets[activePresetTab].tags : null;

        const rawSource = e.dataTransfer ? e.dataTransfer.getData('text/plain') : null;
        const sourceIdx = draggedChipIndex !== null ? draggedChipIndex : (rawSource !== null ? parseInt(rawSource, 10) : -1);

        clearHoverIndicators();
        dom.presetActiveChips.querySelectorAll('.preset-chip').forEach(c => {
          c.classList.remove('drag-over-left', 'drag-over-right', 'dragging');
        });
        draggedChipIndex = null;

        if (!tags || isNaN(sourceIdx) || sourceIdx < 0 || sourceIdx >= tags.length) return;

        if (chip) {
          const targetIdx = parseInt(chip.dataset.index, 10);
          const rect = chip.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          let insertIndex = e.clientX < midX ? targetIdx : targetIdx + 1;
          if (sourceIdx < insertIndex) insertIndex--;

          if (sourceIdx !== insertIndex && insertIndex >= 0 && insertIndex <= tags.length) {
            const moved = tags.splice(sourceIdx, 1)[0];
            tags.splice(insertIndex, 0, moved);
            draftCopyPresets[activePresetTab].presetName = detectPresetType(activePresetTab, draftCopyPresets[activePresetTab]);
            renderPresetModalUI();
          }
        } else {
          // Якщо скинули на вільний простір контейнера (в кінець списку)
          if (sourceIdx !== tags.length - 1) {
            const moved = tags.splice(sourceIdx, 1)[0];
            tags.push(moved);
            draftCopyPresets[activePresetTab].presetName = detectPresetType(activePresetTab, draftCopyPresets[activePresetTab]);
            renderPresetModalUI();
          }
        }
      });

      // 5. Завершення перетягування (dragend)
      dom.presetActiveChips.addEventListener('dragend', () => {
        draggedChipIndex = null;
        clearHoverIndicators();
        dom.presetActiveChips.querySelectorAll('.preset-chip').forEach(c => {
          c.classList.remove('drag-over-left', 'drag-over-right', 'dragging');
        });
      });

      // 6. Захист від випадкового старту перетягування при кліку на хрестик ✕
      dom.presetActiveChips.addEventListener('mousedown', (e) => {
        if (e.target.closest('.chip-del-btn')) {
          e.stopPropagation();
        }
      });

      // 7. Видалення чіпа при кліку на хрестик ✕
      dom.presetActiveChips.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.chip-del-btn');
        if (delBtn) {
          e.stopPropagation();
          e.preventDefault();
          const idx = parseInt(delBtn.dataset.index, 10);
          const currentConfig = draftCopyPresets && draftCopyPresets[activePresetTab];
          if (currentConfig && Array.isArray(currentConfig.tags) && !isNaN(idx) && idx >= 0 && idx < currentConfig.tags.length) {
            currentConfig.tags.splice(idx, 1);
            currentConfig.presetName = detectPresetType(activePresetTab, currentConfig);
            renderPresetModalUI();
          }
        }
      });
    }

    // Додавання чіпів із палітри в канонічному порядку (без стрибків у кінець)
    if (dom.presetChipPalette) {
      dom.presetChipPalette.addEventListener('click', e => {
        const item = e.target.closest('.preset-palette-item');
        if (!item) return;
        const tagId = item.dataset.tag;
        if (draftCopyPresets && draftCopyPresets[activePresetTab]) {
          const currentConfig = draftCopyPresets[activePresetTab];
          currentConfig.tags = insertTagInCanonicalOrder(currentConfig.tags || [], tagId);
          currentConfig.presetName = detectPresetType(activePresetTab, currentConfig);
          renderPresetModalUI();
        }
      });
    }

    // Зміна чекбоксів опцій
    [dom.optSmtShort, dom.optNoBranchWord, dom.optShortRegion, dom.optNoStreetPrefix].forEach(cb => {
      if (cb) {
        cb.addEventListener('change', () => {
          if (!draftCopyPresets) return;
          const currentConfig = draftCopyPresets[activePresetTab];
          if (dom.optSmtShort) currentConfig.options.smtShort = dom.optSmtShort.checked;
          if (dom.optNoBranchWord) currentConfig.options.noBranchWord = dom.optNoBranchWord.checked;
          if (dom.optShortRegion) currentConfig.options.shortRegion = dom.optShortRegion.checked;
          if (dom.optNoStreetPrefix) currentConfig.options.noStreetPrefix = dom.optNoStreetPrefix.checked;
          renderPresetModalUI();
        });
      }
    });

    // Тест копіювання зразка
    if (dom.btnPresetTestCopy && dom.presetLivePreview) {
      dom.btnPresetTestCopy.addEventListener('click', () => {
        const text = dom.presetLivePreview.textContent.trim();
        copyTextToClipboard(text, dom.btnPresetTestCopy, 'Скопійовано!');
      });
    }

    // Скидання до стандартного
    if (dom.btnResetCopyPreset) {
      dom.btnResetCopyPreset.addEventListener('click', () => {
        if (!draftCopyPresets) draftCopyPresets = JSON.parse(JSON.stringify(userCopyPresets));
        draftCopyPresets[activePresetTab] = JSON.parse(JSON.stringify(DEFAULT_COPY_PRESETS[activePresetTab]));
        renderPresetModalUI();
        showToast('Скинуто до стандартного');
      });
    }

    // Зберегти та закрити
    if (dom.btnSaveCopyPreset) {
      dom.btnSaveCopyPreset.addEventListener('click', () => {
        if (draftCopyPresets) {
          saveCopyPresets(draftCopyPresets);
        }
        if (dom.copyPresetModal) {
          dom.copyPresetModal.close();
        }
        showToast('Налаштування шаблону збережено!');
        if (state.selectedBranch) {
          renderSelectedBranch(state.selectedBranch);
        }
      });
    }
  }

  // Перевірка наявності захищеного ключа на бекенді (.env) — тільки для локального проксі-сервера
  function checkServerApiStatus() {
    if (typeof window === 'undefined' || !window.location) return;
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return;
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data && data.hasServerKey) {
          state.hasServerKey = true;
        }
      })
      .catch(() => {
        // Працюємо в автономному режимі з локальною базою даних
      });
  }

  // ==========================================================================
  // РЕЄСТРАЦІЯ ТА БЕЗПАЛІВНЕ ФОНОВЕ ОНОВЛЕННЯ SERVICE WORKER
  // ==========================================================================
  function initServiceWorker() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.clear) {
        sessionStorage.clear();
      }
    } catch (e) {}

    // Очищення застарілого тестового кешу 1.4.6, якщо він колись залишився
    if ('caches' in window) {
      caches.delete('np-ukr-cache-v1.4.6').catch(() => {});
    }

    if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') {
      return;
    }

    let refreshing = false;
    const hadControllerAtLoad = !!navigator.serviceWorker.controller;

    // Автоматичне очищення старих реєстрацій з параметрами (?v=...)
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((r) => {
        if (r.active && r.active.scriptURL.includes('sw.js?v=')) {
          r.unregister().catch(() => {});
        }
      });
    }).catch(() => {});

    navigator.serviceWorker
      .register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        // 1. Початкова перевірка наявності оновлення
        reg.update().catch(() => {});

        // Безпечна відправка команди активації воркеру
        function applyWaitingWorker(worker) {
          if (!worker) return;
          worker.postMessage({ type: 'SKIP_WAITING' });
        }

        // Розумне планування безпалівного оновлення без переривання активної роботи
        function scheduleSilentUpdate(worker) {
          if (!worker) return;

          // Варіант А: Користувач не на цій вкладці (вкладка прихована) — оновлюємо негайно!
          if (document.hidden) {
            applyWaitingWorker(worker);
            return;
          }

          // Варіант Б: Користувач прямо зараз на вкладці.
          // Не перериваємо роботу! Оновлюємо в момент, коли він перейде на іншу вкладку:
          const onVisibilityChange = () => {
            if (document.hidden) {
              document.removeEventListener('visibilitychange', onVisibilityChange);
              applyWaitingWorker(worker);
            }
          };
          document.addEventListener('visibilitychange', onVisibilityChange);

          // Варіант В: Якщо користувач не чіпає сторінку 3 хв і поле пошуку порожнє — можна тихо оновити
          let idleTimer = null;
          const resetIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              const query = dom.searchInput ? dom.searchInput.value.trim() : '';
              const hasOpenModal = !!document.querySelector('dialog[open]');
              if (!query && !hasOpenModal) {
                applyWaitingWorker(worker);
              }
            }, 3 * 60 * 1000);
          };
          window.addEventListener('mousemove', resetIdle, { passive: true, once: true });
          window.addEventListener('keydown', resetIdle, { passive: true, once: true });
          resetIdle();
        }

        // Якщо вже є воркер, що очікує активації
        if (reg.waiting) {
          scheduleSilentUpdate(reg.waiting);
        }

        // Відстежуємо появу нового воркера
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // Воркер завантажив усі файли і перейшов у стан installed
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              scheduleSilentUpdate(installing);
            }
          });
        });

        // Періодична фонова перевірка кожні 3 хвилини (тільки коли вкладка видима)
        setInterval(() => {
          if (!document.hidden) {
            reg.update().catch(() => {});
          }
        }, 3 * 60 * 1000);

        // Перевірка при поверненні на вкладку після відсутності
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) {
            reg.update().catch(() => {});
          }
        });

        // Перевірка при відновленні мережі
        window.addEventListener('online', () => {
          reg.update().catch(() => {});
        });
      })
      .catch((err) => {
        console.warn('[SW] Реєстрація Service Worker пропущена:', err);
      });

    // Перезавантажуємо вікно, коли новий контролер переймає керування:
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Якщо це перший візит в історії — перезавантажувати не потрібно
      if (!hadControllerAtLoad || refreshing) return;

      // Якщо вкладка прихована — перезавантажуємося тихо і непомітно прямо зараз!
      if (document.hidden) {
        refreshing = true;
        window.location.reload();
        return;
      }

      // Якщо вкладка відкрита перед очима — чекаємо моменту, коли користувач перемкне вкладку
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
      }, { once: true });
    });
  }

  // ==========================================================================
  // ІНІЦІАЛІЗАЦІЯ ДОДАТКУ
  // ==========================================================================
  function init() {
    prewarmBranchIndices();
    applyTheme(getStoredTheme(), false);
    initEventListeners();
    setClarityTag('service', state.currentService === 'novaposhta' ? 'NP' : 'UKR');
    updateBottomBarVisibility();
    checkServerApiStatus();
    renderFrequentChips();
    renderRecentHistory();
    initServiceWorker();

    // Автофокус на поле пошуку для миттєвої роботи оператора без зайвих кліків
    setTimeout(() => {
      const isEmbedded = isEmbeddedMode();
      if (dom.searchInput && !isEmbedded) {
        dom.searchInput.focus({ preventScroll: true });
      }
    }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__executeSearchForTest = executeSearch;
  window.switchService = switchService;
  window.updateBottomBarVisibility = updateBottomBarVisibility;
  window.selectAutocompleteItem = selectAutocompleteItem;
  window.selectSuggestion = selectSuggestion;
  window.onSuggestionClick = onSuggestionClick;
  window.highlightMatch = highlightMatch;
  window.createFullBranchCard = createFullBranchCard;
  window.renderResultCard = createFullBranchCard;
  window.renderBranchCard = createFullBranchCard;
  window.renderSelectedBranch = renderSelectedBranch;
  window.selectBranch = renderSelectedBranch;
  window.resetBranchSelection = resetBranchSelection;
  window.formatGeoSub = formatGeoSub;
  window.cleanSettlementName = cleanSettlementName;
  window.cleanRaionName = cleanRaionName;
  window.cleanOblastName = cleanOblastName;
  window.setMarkerHighlightedOnMap = setMarkerHighlightedOnMap;
  window.updateMapTileLayerTheme = updateMapTileLayerTheme;
  window.formatClassicCopyString = formatClassicCopyString;
  window.formatDetailedCopyString = formatDetailedCopyString;
  window.formatLpCrmCopyString = formatDetailedCopyString;
  window.formatBranchWithPreset = formatBranchWithPreset;
  window.loadCopyPresets = loadCopyPresets;
  window.saveCopyPresets = saveCopyPresets;
  window.openCopyPresetModal = openCopyPresetModal;
  window.assembleCopyStringFromPreset = assembleCopyStringFromPreset;
  window.triggerAutocomplete = triggerAutocomplete;
  window.renderFrequentChips = renderFrequentChips;
  window.executeSearch = executeSearch;
  window.hasFixedSettlementContext = hasFixedSettlementContext;
  window._appStateForTesting = state;
  window.getActiveResultIndex = () => activeResultIndex;
  window.updateSearchResultsFocus = updateSearchResultsFocus;
  window.cleanOutputString = cleanOutputString;
  window.DEFAULT_COPY_PRESETS = DEFAULT_COPY_PRESETS;
  window.QUICK_PRESETS = QUICK_PRESETS;
  window.COPY_PRESET_TAGS = COPY_PRESET_TAGS;
  window.CANONICAL_TAG_ORDER = CANONICAL_TAG_ORDER;
  window.insertTagInCanonicalOrder = insertTagInCanonicalOrder;
  window.SearchWorkerBridge = SearchWorkerBridge;
  if (window.SmartSearchEngine) {
    window.SmartSearchEngine.highlightMatch = highlightMatch;
    window.SmartSearchEngine.formatClassicCopyString = formatClassicCopyString;
    window.SmartSearchEngine.formatDetailedCopyString = formatDetailedCopyString;
    window.SmartSearchEngine.formatBranchWithPreset = formatBranchWithPreset;
  }

})();
