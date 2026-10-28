/**
 * Enrich Ukrposhta branches with real physical street addresses
 * using Ukrposhta's public index search API.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ukrposhtaPath = path.join(__dirname, '../data/ukrposhta_branches.json');
const data = JSON.parse(fs.readFileSync(ukrposhtaPath, 'utf8'));

// Identify branches in cities/SMT or regional centers
const settPath = path.join(__dirname, '../data/all_settlements.json');
const settlements = JSON.parse(fs.readFileSync(settPath, 'utf8'));
const urbanNames = new Set(
  settlements
    .filter(s => s.type === 'місто' || s.type === 'смт')
    .map(s => (s.cleanName || s.name).toLowerCase())
);

const targets = data.filter(b => {
  const c = (b.city || '').toLowerCase();
  const needsAddress = !b.address || b.address.includes('ВПЗ') || !/^(?:вул|просп|пл|бульв|пров|шосе|наб|майдан)/i.test(b.address);
  return needsAddress && (urbanNames.has(c) || b.region === 'м. Київ' || (b.name && b.name.includes('Міське')) || b.type === 'central');
});

console.log(`Total Ukrposhta branches: ${data.length}`);
console.log(`Urban branches needing address enrichment: ${targets.length}`);

function fetchOfficeAddress(pc) {
  return new Promise(resolve => {
    const url = `https://index.ukrposhta.ua/endpoints-for-apps/index.php?method=get_postoffices_by_postindex_web&pc=${pc}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'application/json'
      },
      timeout: 5000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const entry = json.Entry || (json.Entries && json.Entries.Entry);
          const item = Array.isArray(entry) ? entry[0] : entry;
          if (item && item.ADDRESS && typeof item.ADDRESS === 'string' && item.ADDRESS.trim()) {
            resolve({
              pc,
              address: item.ADDRESS.trim(),
              lat: parseFloat(item.LATTITUDE) || null,
              lng: parseFloat(item.LONGITUDE) || null,
              phone: item.PHONE || null,
              poShort: item.PO_SHORT || null
            });
            return;
          }
        } catch (_) {}
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function run() {
  const CONCURRENCY = 25;
  let enrichedCount = 0;
  let processed = 0;
  const startTime = Date.now();

  const branchIndexMap = new Map();
  for (let i = 0; i < data.length; i++) {
    branchIndexMap.set(data[i].index, i);
  }

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(b => fetchOfficeAddress(b.index)));

    for (const res of results) {
      if (res && res.address) {
        const idx = branchIndexMap.get(res.pc);
        if (idx !== undefined) {
          data[idx].address = res.address;
          data[idx].street = res.address;
          if (res.lat && res.lng) {
            data[idx].lat = res.lat;
            data[idx].lng = res.lng;
          }
          if (res.phone) {
            data[idx].phone = res.phone;
          }
          enrichedCount++;
        }
      }
    }

    processed += chunk.length;
    if (processed % 250 === 0 || processed === targets.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[${elapsed}s] Processed ${processed}/${targets.length} branches... Enriched: ${enrichedCount}`);
    }
  }

  console.log(`\nWriting updated data/ukrposhta_branches.json (${enrichedCount} branches enriched)...`);
  fs.writeFileSync(ukrposhtaPath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Done!');
}

run().catch(err => {
  console.error('Error enriching Ukrposhta branches:', err);
  process.exit(1);
});
