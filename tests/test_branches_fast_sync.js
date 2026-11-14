// Гарантує, що data/branches.fast.js ідентичний data/branches.js і підключений в index.html та sw.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');
const load = f => { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), sb); return sb.window.BRANCHES_DATA; };
console.log('▶ ТЕСТ: branches.fast.js ідентичний branches.js');
assert.ok(JSON.stringify(load('data/branches.fast.js')) === JSON.stringify(load('data/branches.js')),
  'branches.fast.js застарів — запустіть: node scripts/build_branches_fast.js');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.ok(/data\/branches\.fast\.js\?v=/.test(html), 'index.html має підключати branches.fast.js');
assert.ok(/data\/branches\.fast\.js\?v=/.test(sw), 'sw.js має кешувати branches.fast.js');
console.log('  ✓ Успіх: дані ідентичні, підключення в index.html та sw.js є');
