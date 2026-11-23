/**
 * scripts/build_ukrposhta_fast.js
 * Збирає компактну словникову схему data/ukrposhta_branches.js з data/ukrposhta_branches.json.
 * Зменшує розмір файлу з ~7.71 МБ до ~4.0 МБ, зберігаючи 100% ідентичність JSON.stringify.
 *
 * Запуск: node scripts/build_ukrposhta_fast.js
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'data', 'ukrposhta_branches.json');
const out = path.join(__dirname, '..', 'data', 'ukrposhta_branches.js');

const up = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!Array.isArray(up)) throw new Error('ukrposhta_branches.json має бути масивом');

const schemas = [];
const schemaMap = new Map();
function getSchemaId(keysStr) {
  if (!schemaMap.has(keysStr)) {
    schemaMap.set(keysStr, schemas.length);
    schemas.push(keysStr.split(','));
  }
  return schemaMap.get(keysStr);
}

const sp = [];
const spMap = new Map();
function intern(str) {
  if (typeof str !== 'string') return str;
  if (!spMap.has(str)) {
    spMap.set(str, sp.length);
    sp.push(str);
  }
  return spMap.get(str);
}

const poolFields = new Set(['city', 'type', 'district', 'region', 'phone']);
const DEFAULT_NAME_PREFIX = "Відділення поштового зв'язку (";

const rows = up.map(b => {
  const keys = Object.keys(b);
  const sId = getSchemaId(keys.join(','));
  const vals = keys.map(k => {
    const v = b[k];
    if (k === 'name' && v === DEFAULT_NAME_PREFIX + b.index + ')') {
      return 0;
    }
    return poolFields.has(k) ? intern(v) : v;
  });
  return [sId, ...vals];
});

const packedStr = JSON.stringify({ schemas, sp, r: rows });
const escaped = packedStr.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const clientCode =
  '// АВТОГЕНЕРОВАНО scripts/build_ukrposhta_fast.js з data/ukrposhta_branches.json\n' +
  '(function() {\n' +
  "  var p = JSON.parse('" + escaped + "');\n" +
  '  var sp = p.sp;\n' +
  '  var scs = p.schemas;\n' +
  '  var pf = { city: 1, type: 1, district: 1, region: 1, phone: 1 };\n' +
  '  var r = p.r;\n' +
  '  var rl = r.length;\n' +
  '  var out = new Array(rl);\n' +
  '  for (var i = 0; i < rl; i++) {\n' +
  '    var row = r[i];\n' +
  '    var keys = scs[row[0]];\n' +
  '    var kl = keys.length;\n' +
  '    var obj = {};\n' +
  '    for (var j = 0; j < kl; j++) {\n' +
  '      var k = keys[j];\n' +
  '      var v = row[j + 1];\n' +
  "      if (k === 'name' && v === 0) {\n" +
  "        obj[k] = \"Відділення поштового зв'язку (\" + obj.index + \")\";\n" +
  '      } else {\n' +
  "        obj[k] = (pf[k] && typeof v === 'number') ? sp[v] : v;\n" +
  '      }\n' +
  '    }\n' +
  '    out[i] = obj;\n' +
  '  }\n' +
  "  var root = typeof window !== 'undefined' ? window : globalThis;\n" +
  '  root.UKRPOSHTA_BRANCHES_DATA = out;\n' +
  '})();\n';

fs.writeFileSync(out, clientCode, 'utf8');
console.log(`OK: ${out} (${(clientCode.length / 1e6).toFixed(2)} MB, UP=${up.length})`);
