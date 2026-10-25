/**
 * Generator script for Ukrposhta postal branches and index database.
 * Processes /tmp/geonames/UA.txt (or downloads UA.zip if needed)
 * Maps and joins with data/all_settlements.json for rich Ukrainian topology.
 * Merges with existing fixtures from data/branches.js.
 * Produces data/ukrposhta_branches.json in compressed normalized format:
 * { index, city, type, district, region, address, name, lat, lng }
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OBLAST_MAP = {
  'Cherkaska': 'Черкаська',
  'Chernihivska': 'Чернігівська',
  'Chernivetska': 'Чернівецька',
  'Dnipropetrovska': 'Дніпропетровська',
  'Donetska': 'Донецька',
  'Ivano-Frankivska': 'Івано-Франківська',
  'Kharkivska': 'Харківська',
  'Khersonska': 'Херсонська',
  'Khmelnytska': 'Хмельницька',
  'Kirovohradska': 'Кіровоградська',
  'Kyiv': 'Київська',
  'Kyivska': 'Київська',
  'Luhanska': 'Луганська',
  'Lvivska': 'Львівська',
  'Mykolaivska': 'Миколаївська',
  'Odeska': 'Одеська',
  'Poltavska': 'Полтавська',
  'Rivnenska': 'Рівненська',
  'Sumska': 'Сумська',
  'Ternopilska': 'Тернопільська',
  'Vinnytska': 'Вінницька',
  'Volynska': 'Волинська',
  'Zakarpatska': 'Закарпатська',
  'Zaporizka': 'Запорізька',
  'Zhytomyrska': 'Житомирська'
};

function ensureGeonamesData() {
  const uaTxtPath = '/tmp/geonames/UA.txt';
  if (fs.existsSync(uaTxtPath)) {
    return uaTxtPath;
  }
  console.log('Downloading GeoNames UA.zip...');
  fs.mkdirSync('/tmp/geonames', { recursive: true });
  execSync('curl -s -o /tmp/geonames/UA.zip http://download.geonames.org/export/zip/UA.zip');
  execSync('unzip -q -o /tmp/geonames/UA.zip -d /tmp/geonames/');
  return uaTxtPath;
}

function cleanSettlement(rawName) {
  let name = (rawName || '').replace(/\s*\([^)]*\)/g, '').trim().replace(/\s*-\s*/g, '-');
  if (name.startsWith('Хутір ')) {
    name = name.replace(/^Хутір\s+/, '');
  }
  return name.trim();
}

function run() {
  const uaPath = ensureGeonamesData();
  const rawSettlements = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/all_settlements.json'), 'utf8'));

  // Build lookup index of settlements
  const settByNameObl = new Map();
  const settByName = new Map();
  for (const s of rawSettlements) {
    const oblClean = (s.oblast || '').replace(/\s*область$/i, '').trim().toLowerCase();
    const nameLow = (s.cleanName || s.name).toLowerCase();
    const key = `${nameLow}|${oblClean}`;
    if (!settByNameObl.has(key)) settByNameObl.set(key, s);

    if (!settByName.has(nameLow)) settByName.set(nameLow, []);
    settByName.get(nameLow).push(s);
  }

  // Load existing fixtures from data/branches.js
  let existingFixtures = [];
  try {
    const branchesContent = fs.readFileSync(path.join(__dirname, '../data/branches.js'), 'utf8');
    const dummyWindow = {};
    const fn = new Function('window', branchesContent);
    fn(dummyWindow);
    if (dummyWindow.BRANCHES_DATA && Array.isArray(dummyWindow.BRANCHES_DATA.ukrposhta)) {
      existingFixtures = dummyWindow.BRANCHES_DATA.ukrposhta;
    }
  } catch (e) {
    console.warn('Could not read existing fixtures from data/branches.js:', e.message);
  }

  const lines = fs.readFileSync(uaPath, 'utf8').split('\n').filter(Boolean);
  console.log(`Processing ${lines.length} lines from ${uaPath}...`);

  const branchMap = new Map();

  // First process all GeoNames lines
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const postalCode = parts[1].trim();
    if (!postalCode || branchMap.has(postalCode)) continue;

    const rawPlaceName = parts[2].trim();
    const cleanName = cleanSettlement(rawPlaceName);
    const latinOblast = parts[3].trim();
    const oblast = OBLAST_MAP[latinOblast] || latinOblast;
    const isKyivCity = (postalCode.startsWith('01') || postalCode.startsWith('02') || postalCode.startsWith('03') || postalCode.startsWith('04')) && cleanName === 'Київ';

    let matchedSettlement = settByNameObl.get(`${cleanName.toLowerCase()}|${oblast.toLowerCase()}`);
    if (!matchedSettlement) {
      const candidates = settByName.get(cleanName.toLowerCase());
      if (candidates && candidates.length === 1) {
        matchedSettlement = candidates[0];
      }
    }

    const city = matchedSettlement ? (matchedSettlement.cleanName || cleanName) : cleanName;
    const settlementType = matchedSettlement ? matchedSettlement.type : (isKyivCity ? 'місто' : 'село');
    const raion = matchedSettlement && matchedSettlement.raion ? matchedSettlement.raion : '';
    const lat = Math.round((parseFloat(parts[9]) || 0) * 10000) / 10000;
    const lng = Math.round((parseFloat(parts[10]) || 0) * 10000) / 10000;

    const isCentral = postalCode.endsWith('000') || postalCode.endsWith('001') || postalCode.endsWith('00');
    const type = isCentral ? 'central' : 'standard';
    const typeText = isCentral ? 'Центральне відділення' : (settlementType === 'місто' ? 'Міське відділення' : 'Сільське відділення');
    const name = `Відділення поштового зв'язку (${postalCode})`;

    branchMap.set(postalCode, {
      index: postalCode,
      city: city,
      type: type,
      district: raion,
      region: isKyivCity ? 'м. Київ' : `${oblast} обл.`,
      address: isKyivCity ? `м. Київ, ВПЗ ${postalCode}` : `${city}, ВПЗ ${postalCode}`,
      name: name,
      lat: lat,
      lng: lng
    });
  }

  // Overlay rich existing fixtures
  for (const f of existingFixtures) {
    const code = String(f.postalCode || f.number);
    if (!code) continue;

    const fOblast = f.oblast || (f.region && f.region.includes('область') ? f.region.split('область')[0].trim() : (f.region || ''));
    const fRaion = f.raion || (f.district ? f.district.replace(/\s*район.*/i, '').trim() : '') ||
      (f.region && f.region.includes('район') ? f.region.split('район')[0].split('(').pop().trim() : '');

    let matchedSettlement = settByNameObl.get(`${(f.city || '').toLowerCase()}|${fOblast.toLowerCase()}`);
    if (!matchedSettlement) {
      const candidates = settByName.get((f.city || '').toLowerCase());
      if (candidates && candidates.length > 0) {
        matchedSettlement = candidates.find(c => (c.oblast || '').toLowerCase().includes(fOblast.toLowerCase())) || candidates[0];
      }
    }

    const district = fRaion || (matchedSettlement && matchedSettlement.raion ? matchedSettlement.raion : '');
    const region = fOblast ? `${fOblast} обл.` : (matchedSettlement && matchedSettlement.oblast ? `${matchedSettlement.oblast} обл.` : '');
    const address = f.street || f.address || `ВПЗ ${code}`;

    branchMap.set(code, {
      index: code,
      city: f.city,
      type: f.type || 'standard',
      district: district,
      region: region,
      address: address,
      name: f.name || `Відділення поштового зв'язку (${code})`,
      lat: Math.round((f.lat || 0) * 10000) / 10000,
      lng: Math.round((f.lng || 0) * 10000) / 10000
    });
  }

  const branches = Array.from(branchMap.values()).sort((a, b) => a.index.localeCompare(b.index));

  const outPath = path.join(__dirname, '../data/ukrposhta_branches.json');
  console.log(`Writing ${branches.length} branches to ${outPath}...`);
  fs.writeFileSync(outPath, JSON.stringify(branches));

  const stat = fs.statSync(outPath);
  console.log(`Successfully generated ${outPath}! Size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
}

run();
