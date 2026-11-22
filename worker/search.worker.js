/**
 * worker/search.worker.js
 * Фоновий Web Worker для інтелектуального пошуку Нової пошти та Укрпошти.
 * Виконує парсинг, нормалізацію, автокомпліт та важкий скоринг бази (55k+ записів)
 * у фоновому потоці, гарантуючи абсолютно вільний Main Thread (120 FPS).
 */

self.window = self;

var isWorkerReady = false;

try {
  var _v = (self.location && self.location.search) ? self.location.search : '';
  importScripts(
    '../data/all_settlements.js' + _v,
    '../data/crm_settlements.js' + _v,
    '../data/branches.fast.js' + _v,
    '../data/ukrposhta_branches.js' + _v,
    '../data/fuzzySearch.js' + _v
  );

  function mapUkrposhtaRaw(rawList) {
    if (!Array.isArray(rawList)) return [];
    return rawList.map(function(item) {
      var idx = String(item.index || item.number || item.postalCode || '');
      var obl = item.oblast || (item.region ? item.region.replace(/\s*обл\.?.*$/i, '').trim() : '');
      if (obl === 'Київ' || obl === 'м. Київ' || item.city === 'Київ' || item.city === 'м. Київ') {
        obl = 'Київська';
      }
      var rai = item.raion || (item.district ? item.district.replace(/\s*район.*$/i, '').trim() : '');
      var addr = item.address || item.street || ('ВПЗ ' + idx);
      var isCentr = item.type === 'central' || idx.endsWith('000') || idx.endsWith('001') || idx.endsWith('00');
      return {
        id: item.id || ('up-' + idx),
        index: idx,
        number: idx,
        postalCode: idx,
        city: item.city,
        type: item.type || (isCentr ? 'central' : 'standard'),
        typeText: item.typeText || (isCentr ? 'Центральне відділення' : (item.name && item.name.indexOf('Міське') !== -1 ? 'Міське відділення' : "Відділення зв'язку")),
        name: item.name || ("Відділення зв'язку (" + idx + ")"),
        street: addr,
        address: addr,
        oblast: obl,
        raion: rai,
        district: rai,
        region: item.region || (obl ? (obl + ' обл.') : ''),
        lat: item.lat || 0,
        lng: item.lng || 0,
        isAccessible: item.isAccessible !== undefined && item.isAccessible !== null ? item.isAccessible : true,
        hasGenerator: item.hasGenerator !== undefined && item.hasGenerator !== null ? item.hasGenerator : true
      };
    });
  }

  self.BRANCHES_DATA = self.BRANCHES_DATA || {};
  if (Array.isArray(self.UKRPOSHTA_BRANCHES_DATA) && self.UKRPOSHTA_BRANCHES_DATA.length > 0) {
    self.BRANCHES_DATA.ukrposhta = mapUkrposhtaRaw(self.UKRPOSHTA_BRANCHES_DATA);
  }

  if (self.SmartSearchEngine) {
    if (self.ALL_SETTLEMENTS_DATA && typeof self.SmartSearchEngine.setAllSettlementsData === 'function') {
      self.SmartSearchEngine.setAllSettlementsData(self.ALL_SETTLEMENTS_DATA);
    }
    if (self.BRANCHES_DATA && self.BRANCHES_DATA.novaposhta && typeof self.SmartSearchEngine.buildBranchIndex === 'function') {
      self.SmartSearchEngine.buildBranchIndex(self.BRANCHES_DATA.novaposhta);
    }
    if (self.BRANCHES_DATA && Array.isArray(self.BRANCHES_DATA.ukrposhta) && typeof self.SmartSearchEngine.buildBranchIndex === 'function') {
      self.SmartSearchEngine.buildBranchIndex(self.BRANCHES_DATA.ukrposhta);
    }
  }

  isWorkerReady = true;
  self.postMessage({ type: 'WORKER_READY', ready: true });
} catch (err) {
  self.postMessage({ type: 'WORKER_ERROR', error: String(err) });
}

self.onmessage = function(e) {
  var data = e.data;
  if (!data || !data.type) return;

  if (data.type === 'PING') {
    self.postMessage({ type: 'PONG', ready: isWorkerReady });
    return;
  }

  if (!isWorkerReady || !self.SmartSearchEngine) {
    self.postMessage({ id: data.id, type: 'ERROR', error: 'Worker not ready' });
    return;
  }

  var engine = self.SmartSearchEngine;

  if (data.type === 'AUTOCOMPLETE') {
    try {
      var service = data.service || 'novaposhta';
      self.currentService = service;
      var pool = (service === 'ukrposhta')
        ? (self.BRANCHES_DATA && Array.isArray(self.BRANCHES_DATA.ukrposhta) ? self.BRANCHES_DATA.ukrposhta : [])
        : (self.BRANCHES_DATA && self.BRANCHES_DATA.novaposhta ? self.BRANCHES_DATA.novaposhta : []);
      var suggestions = engine.getAutocompleteSuggestions(data.query, service, null, pool);
      self.postMessage({
        id: data.id,
        type: 'AUTOCOMPLETE_RESULT',
        query: data.query,
        suggestions: suggestions
      });
    } catch (err) {
      self.postMessage({ id: data.id, type: 'AUTOCOMPLETE_ERROR', error: String(err) });
    }
  } else if (data.type === 'SEARCH') {
    try {
      var srv = data.service || 'novaposhta';
      self.currentService = srv;
      var allBranches = (srv === 'ukrposhta')
        ? (self.BRANCHES_DATA && Array.isArray(self.BRANCHES_DATA.ukrposhta) ? self.BRANCHES_DATA.ukrposhta : [])
        : (self.BRANCHES_DATA && self.BRANCHES_DATA.novaposhta ? self.BRANCHES_DATA.novaposhta : []);
      
      var parsed = engine.parseQuery(data.query);
      var staticMatches = engine.filterBranchesByNormalizedSearch(data.query, allBranches, null);

      self.postMessage({
        id: data.id,
        type: 'SEARCH_RESULT',
        query: data.query,
        parsed: parsed,
        staticMatches: staticMatches
      });
    } catch (err) {
      self.postMessage({ id: data.id, type: 'SEARCH_ERROR', error: String(err) });
    }
  }
};
