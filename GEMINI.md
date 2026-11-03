# Project Context & Guidelines

## GitHub Profile & Repository Information
- **GitHub Username**: `vadym-des` (раніше був `Vadim4ik0909`)
- **Repository Base URL**: `https://github.com/vadym-des/`
- **GitHub Pages Base URL**: `https://vadym-des.github.io/`
- **Current Repository Remote**: `https://github.com/vadym-des/np-search-engine.git`

Будь-які посилання на GitHub-профіль, репозиторії, сторінки GitHub Pages та конфігурації remote-URL для Git повинні формуватися виключно з використанням нікнейму `vadym-des`.

## Правило Пушу (Strict Push & Release Protocol)
Коли користувач дає команду `push` або `пуш`:
1. **Перевірка версій**: Обов'язково актуалізувати версію у всіх точках проєкту:
   - `index.html` (кнопка версії у футері `.version-tag`, заголовок у модальному вікні та query-параметри підключення скриптів `?v=X.X.XX`);
   - `sw.js` (`CACHE_VERSION`, `CACHE_NAME` та `PRECACHE_ASSETS`);
   - `CHANGELOG.md`.
2. **Синхронізація гілок**: Оскільки GitHub Pages транслюється з гілки `gh-pages`, пуш ЗАВЖДИ виконується в обидві гілки:
   - Зафіксувати зміни на `main` та виконати `git push origin main`;
   - Переключитися або злити `main` у `gh-pages` (`git checkout gh-pages && git merge main`) та виконати `git push origin gh-pages`;
   - Повернутися на гілку `main` (`git checkout main`).
3. Користувач повинен завжди бачити найновішу версію сайту на GitHub Pages протягом 1 хвилини без застарілого кешу.
