/* BackToNature — data service layer used by the provincial fieldbook.
 * Credentials are passed per request and never persisted in this module.
 */
(function () {
  'use strict';

  var FAOSTAT_BASE = 'https://fenixservices.fao.org/faostat/api/v1';
  var WOCAT_BASE = 'https://qcat.wocat.net/en/api/v2/questionnaires/';
  var FAO_CSW = 'https://data.apps.fao.org/map/catalog/srv/eng/csw';

  function rowsFrom(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return [];
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.records)) return json.records;
    if (Array.isArray(json.features)) return json.features;
    return [];
  }

  function getValue(row, candidates) {
    if (!row || typeof row !== 'object') return '';
    var keys = Object.keys(row);
    for (var i = 0; i < candidates.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === candidates[i].toLowerCase() && row[keys[j]] != null) {
          return row[keys[j]];
        }
      }
    }
    return '';
  }

  async function requestJSON(url, headers) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 18000);
    try {
      var response = await fetch(url, {
        method: 'GET',
        headers: Object.assign({ 'Accept': 'application/json' }, headers || {}),
        signal: controller.signal,
        cache: 'no-store'
      });
      var text = await response.text();
      var payload;
      try { payload = JSON.parse(text); } catch (_) {
        throw new Error('The source returned a non-JSON response (HTTP ' + response.status + ').');
      }
      if (!response.ok) {
        var detail = payload && (payload.detail || payload.message || payload.error);
        throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
      }
      if (payload && payload.error) throw new Error(String(payload.error));
      return payload;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Request exceeded the 18-second timeout.');
      if (error instanceof TypeError) {
        throw new Error('Browser access failed. Network, source availability or CORS restrictions may block this request.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchIndonesiaLandUse() {
    var endYear = new Date().getFullYear();
    var startYear = endYear - 6;
    var url = FAOSTAT_BASE + '/en/data/RL?area=101&year_start=' + startYear +
      '&year_end=' + endYear + '&output_type=objects&show_codes=true&show_unit=true&show_flags=true';
    var json = await requestJSON(url);
    var rows = rowsFrom(json).filter(function (row) {
      return getValue(row, ['Value', 'value']) !== '' && getValue(row, ['Value', 'value']) != null;
    });
    return { rows: rows, startYear: startYear, endYear: endYear, rawCount: rowsFrom(json).length };
  }

  async function searchFaoCatalog(provinceName) {
    var safeName = String(provinceName || '').replace(/'/g, "''");
    var params = new URLSearchParams({
      service: 'CSW',
      version: '2.0.2',
      request: 'GetRecords',
      resultType: 'results',
      typeNames: 'csw:Record',
      elementSetName: 'summary',
      maxRecords: '12',
      startPosition: '1',
      constraintLanguage: 'CQL_TEXT',
      constraint: "AnyText LIKE '%" + safeName + "%' AND (AnyText LIKE '%soil%' OR AnyText LIKE '%land%' OR AnyText LIKE '%water%' OR AnyText LIKE '%climate%' OR AnyText LIKE '%forest%' OR AnyText LIKE '%agriculture%')"
    });
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 18000);
    try {
      var response = await fetch(FAO_CSW + '?' + params.toString(), {
        headers: { 'Accept': 'application/xml, text/xml, */*' },
        signal: controller.signal,
        cache: 'no-store'
      });
      var xmlText = await response.text();
      if (!response.ok) throw new Error('HTTP ' + response.status + ' from the FAO catalogue.');
      var xml = new DOMParser().parseFromString(xmlText, 'application/xml');
      if (xml.getElementsByTagName('parsererror').length) throw new Error('The catalogue response could not be parsed as XML.');
      var exception = xml.getElementsByTagNameNS('*', 'ExceptionText');
      if (exception.length) throw new Error(exception[0].textContent || 'The catalogue returned an exception.');
      var records = Array.from(xml.getElementsByTagNameNS('*', 'BriefRecord'));
      if (!records.length) records = Array.from(xml.getElementsByTagNameNS('*', 'SummaryRecord'));
      if (!records.length) records = Array.from(xml.getElementsByTagNameNS('*', 'Record'));
      return records.slice(0, 12).map(function (record) {
        var titleNodes = record.getElementsByTagNameNS('*', 'title');
        var abstractNodes = record.getElementsByTagNameNS('*', 'abstract');
        var ids = record.getElementsByTagNameNS('*', 'identifier');
        var title = titleNodes.length ? titleNodes[0].textContent.trim() : 'FAO geospatial dataset';
        var summary = abstractNodes.length ? abstractNodes[0].textContent.trim() : '';
        var identifier = ids.length ? ids[0].textContent.trim() : '';
        var href = /^[0-9a-f-]{36}$/i.test(identifier)
          ? 'https://data.apps.fao.org/map/catalog/srv/eng/catalog.search#/metadata/' + encodeURIComponent(identifier)
          : 'https://data.fao.org/catalog/';
        return { title: title, summary: summary, url: href };
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Catalogue request exceeded the 18-second timeout.');
      if (error instanceof TypeError) throw new Error('Browser access failed. CORS or network restrictions may block the catalogue endpoint.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWocatTechnologies(token, iso3) {
    var cleanToken = String(token || '').trim();
    if (!cleanToken) throw new Error('Enter an authorized WOCAT QCAT token first.');
    var country = String(iso3 || 'IDN').toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) throw new Error('A valid ISO-3 country code is required.');
    var params = new URLSearchParams({
      type: 'technologies',
      'filter__qg_location__country': 'country_' + country,
      page: '1'
    });
    var json = await requestJSON(WOCAT_BASE + '?' + params.toString(), {
      'Authorization': 'Token ' + cleanToken
    });
    var records = rowsFrom(json);
    return records.slice(0, 12).map(function (record) {
      var title = getValue(record, ['name', 'title', 'code']) || 'WOCAT technology';
      var summary = getValue(record, ['description', 'summary', 'objective', 'technology']);
      var code = getValue(record, ['code']);
      var rawUrl = getValue(record, ['url', 'details', 'absolute_url']);
      var href = rawUrl ? (String(rawUrl).indexOf('http') === 0 ? rawUrl : 'https://qcat.wocat.net' + rawUrl) : 'https://qcat.wocat.net/en/wocat/list/';
      return { title: String(title), summary: String(summary || ''), code: String(code || ''), url: String(href) };
    });
  }

  window.BackToNatureAPI = {
    fetchIndonesiaLandUse: fetchIndonesiaLandUse,
    searchFaoCatalog: searchFaoCatalog,
    fetchWocatTechnologies: fetchWocatTechnologies
  };
})();