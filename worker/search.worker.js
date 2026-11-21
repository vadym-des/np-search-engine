/**
 * worker/search.worker.js
 * Фоновий Web Worker для інтелектуального пошуку Нової пошти та Укрпошти.
 * Виконує парсинг, нормалізацію, автокомпліт та важкий скоринг бази (55k+ записів)
 * у фоновому потоці, гарантуючи абсолютно вільний Main Thread (120 FPS).
 */

self.window = self;

var isWorkerReady = false;

try {
  importScripts(
    '../data/all_settlements.js',
    '../data/branches.fast.js',
    '../data/ukrposhta_branches.js',
    '../data/fuzzySearch.js'
  );

  if (self.SmartSearchEngine) {
    if (self.ALL_SETTLEMENTS_DATA && typeof self.SmartSearchEngine.setAllSettlementsData === 'function') {
      self.SmartSearchEngine.setAllSettlementsData(self.ALL_SETTLEMENTS_DATA);
    }
    if (self.BRANCHES_DATA && self.BRANCHES_DATA.novaposhta && typeof self.SmartSearchEngine.buildBranchIndex === 'function') {
      self.SmartSearchEngine.buildBranchIndex(self.BRANCHES_DATA.novaposhta);
    }
    if (self.UKRPOSHTA_BRANCHES_DATA && typeof self.SmartSearchEngine.buildBranchIndex === 'function') {
      self.SmartSearchEngine.buildBranchIndex(self.UKRPOSHTA_BRANCHES_DATA);
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
      var pool = (service === 'ukrposhta')
        ? (self.UKRPOSHTA_BRANCHES_DATA || [])
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
      var allBranches = (srv === 'ukrposhta')
        ? (self.UKRPOSHTA_BRANCHES_DATA || [])
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
