/* BackToNature — live evidence connectors
 * FAOSTAT: public API
 * WOCAT QCAT v2: requires a user-provided token; never persist it
 * FAO Hand-in-Hand: official geospatial workspace/catalog connector
 */
(function () {
  'use strict';

  var FAOSTAT_BASE = 'https://fenixservices.fao.org/faostat/api/v1';
  var WOCAT_BASE = 'https://qcat.wocat.net/en/api/v2/questionnaires/';
  var HIH_PORTAL = 'https://data.apps.fao.org/?lang=en';
  var FAO_CATALOG = 'https://data.fao.org/catalog/';
  var requestId = 0;
  var selected = null;
  var wocatToken = '';
  var areaCache = null;
  var areaCacheAt = 0;

  var FALLBACK_AREA_CODES = { IDN: 101, BRA: 21, AUS: 10, IND: 100, EGY: 59, USA: 231 };
  var COUNTRY_ALIASES = {
    'united states of america': ['united states', 'usa'],
    'united states': ['united states of america', 'usa'],
    'russian federation': ['russia'],
    'republic of korea': ['south korea', 'korea, republic of'],
    "democratic people's republic of korea": ['north korea', "korea, democratic people's republic of"],
    'viet nam': ['vietnam'],
    'iran (islamic republic of)': ['iran'],
    "lao people's democratic republic": ['laos'],
    'syrian arab republic': ['syria'],
    'venezuela (bolivarian republic of)': ['venezuela'],
    'bolivia (plurinational state of)': ['bolivia'],
    'united republic of tanzania': ['tanzania'],
    "côte d'ivoire": ['ivory coast', 'cote divoire'],
    'türkiye': ['turkey'],
    'czechia': ['czech republic'],
    'brunei darussalam': ['brunei'],
    'moldova, republic of': ['moldova'],
    'north macedonia': ['macedonia']
  };

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function firstValue(object, names) {
    if (!object) return '';
    var keys = Object.keys(object);
    for (var i = 0; i < names.length; i++) {
      var target = names[i].toLowerCase();
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === target && object[keys[j]] != null && object[keys[j]] !== '') {
          return object[keys[j]];
        }
      }
    }
    return '';
  }

  function extractRows(json) {
    if (Array.isArray(json)) return json;
    if (!json || typeof json !== 'object') return [];
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.results)) return json.results;
    if (Array.isArray(json.areas)) return json.areas;
    if (Array.isArray(json.Domains)) return json.Domains;
    if (Array.isArray(json.items)) return json.items;
    return [];
  }

  async function fetchJSON(url, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 18000);
    try {
      var response = await fetch(url, Object.assign({
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      }, options || {}));
      var text = await response.text();
      var json;
      try { json = JSON.parse(text); } catch (_) {
        throw new Error('Layanan mengembalikan respons yang bukan JSON (HTTP ' + response.status + ').');
      }
      if (!response.ok) {
        var detail = json && (json.error || json.detail || json.message);
        throw new Error('HTTP ' + response.status + (detail ? ': ' + detail : ''));
      }
      if (json && json.error) throw new Error(json.error);
      return json;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Permintaan melewati batas waktu 18 detik.');
      if (error instanceof TypeError) {
        throw new Error('Tidak dapat mengakses layanan dari browser. Koneksi, CORS, atau layanan sumber mungkin membatasi permintaan.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function setStatus(id, text, kind) {
    var node = document.getElementById(id);
    if (!node) return;
    node.className = 'btna-status ' + (kind || 'pending');
    node.textContent = text;
  }

  function addStyles() {
    if (document.getElementById('btna-styles')) return;
    var style = document.createElement('style');
    style.id = 'btna-styles';
    style.textContent = ".btna-panel{position:fixed;z-index:2200;top:88px;right:16px;bottom:18px;width:min(465px,calc(100vw - 24px));overflow-y:auto;box-sizing:border-box;padding:16px;background:linear-gradient(180deg,#17325c 0%,#102443 100%);border:5px solid #e0d0a6;border-radius:12px;color:#fff;box-shadow:7px 7px 0 rgba(0,0,0,.5);font-family:'VT323',monospace;font-size:18px;text-shadow:1px 1px #000}.btna-panel *{box-sizing:border-box}.btna-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;border-bottom:2px dashed #8b9bb4;padding-bottom:10px;margin-bottom:12px}.btna-kicker{font-size:15px;color:#b8d7ff;letter-spacing:1px}.btna-country{font-size:30px;line-height:1.05;color:#ffd700;margin:3px 0 6px;overflow-wrap:anywhere}.btna-close{border:3px solid #ff6b6b;background:#8b0000;color:#fff;padding:4px 10px;font:inherit;cursor:pointer}.btna-section{border:2px solid #8b9bb4;border-radius:8px;background:rgba(4,16,32,.55);padding:11px;margin:10px 0}.btna-section h3{font-size:23px;color:#ffd700;margin:0 0 5px}.btna-muted{font-size:16px;color:#d5e1ef;line-height:1.25}.btna-status{display:inline-block;padding:2px 7px;margin:3px 0 7px;border:1px solid #8b9bb4;border-radius:4px;font-size:15px;text-shadow:none}.btna-status.ok{background:#164b32;color:#c8ffdf;border-color:#54b783}.btna-status.pending{background:#4b3e16;color:#fff0aa;border-color:#d5b648}.btna-status.error{background:#552020;color:#ffd7d7;border-color:#c86c6c}.btna-status.info{background:#183a58;color:#d7eeff;border-color:#5ca6d9}.btna-btn{display:inline-block;margin:5px 4px 0 0;padding:5px 9px;border:2px solid #e0d0a6;background:#8b5a2b;color:#fff;font:inherit;text-decoration:none;cursor:pointer;text-shadow:1px 1px #000}.btna-btn:hover{filter:brightness(1.15)}.btna-btn:disabled{opacity:.5;cursor:wait}.btna-tablewrap{overflow-x:auto;margin-top:6px}.btna-table{width:100%;border-collapse:collapse;font-size:16px;text-shadow:none}.btna-table th,.btna-table td{padding:5px 4px;border-bottom:1px solid #52647d;text-align:left;vertical-align:top}.btna-table th{color:#ffd700;font-weight:normal}.btna-table td{overflow-wrap:anywhere}.btna-field{width:100%;padding:7px;border:2px solid #e0d0a6;background:#f7f3e8;color:#222;font:16px monospace;text-shadow:none}.btna-details{margin-top:8px}.btna-details summary{cursor:pointer;color:#b8d7ff}.btna-list{margin:7px 0 0;padding-left:20px}.btna-list li{margin:6px 0;line-height:1.2}.btna-links{display:flex;flex-wrap:wrap;gap:4px}.btna-foot{font-size:14px;color:#c3d1e2;margin-top:12px;border-top:1px dashed #8b9bb4;padding-top:8px;line-height:1.3}.btna-panel a{color:#ffe28a}.btna-panel a.btna-btn{color:#fff}.btna-panel .btna-status{font-family:monospace;font-size:12px}@media(max-width:600px){.btna-panel{top:76px;right:8px;bottom:8px;width:calc(100vw - 16px);padding:11px;border-width:4px}.btna-country{font-size:26px}.btna-section{padding:8px;margin:8px 0}}";
    document.head.appendChild(style);
  }

  function createPanel() {
    addStyles();
    var panel = document.getElementById('btna-panel');
    if (panel) return panel;
    panel = document.createElement('aside');
    panel.id = 'btna-panel';
    panel.className = 'btna-panel';
    panel.setAttribute('aria-label', 'Live agriculture and restoration data');
    panel.hidden = true;
    document.body.appendChild(panel);
    return panel;
  }

  function renderPanel(countryName) {
    var panel = createPanel();
    panel.hidden = false;
    panel.innerHTML =
      '<div class="btna-head"><div><div class="btna-kicker">BACK TO NATURE / LIVE EVIDENCE</div>' +
      '<div class="btna-country">' + escapeHTML(countryName) + '</div>' +
      '<div class="btna-muted">Country selected on the map. Live data status is shown per source.</div></div>' +
      '<button id="btna-close" class="btna-close" type="button" aria-label="Close evidence panel">X</button></div>' +

      '<section class="btna-section"><h3>🌿 WOCAT — Restoration practices</h3>' +
      '<div id="btna-wocat-status" class="btna-status pending">Token required for QCAT API</div>' +
      '<div id="btna-wocat-content" class="btna-muted">WOCAT documents sustainable land management technologies and approaches. This API needs an authorized WOCAT QCAT token; no credentials are stored in this repository.</div>' +
      '<details class="btna-details"><summary>Connect WOCAT for this session</summary>' +
      '<p class="btna-muted">Paste your authorized token only if you have one. The token stays in this open page memory and is sent to QCAT as an Authorization header; it is not saved to local storage or sent to BackToNature servers. Browser CORS policies may still block direct access.</p>' +
      '<input id="btna-wocat-token" class="btna-field" type="password" autocomplete="off" spellcheck="false" placeholder="WOCAT QCAT token">' +
      '<button id="btna-wocat-connect" class="btna-btn" type="button">Fetch technologies</button>' +
      '<button id="btna-wocat-clear" class="btna-btn" type="button">Clear token</button></details>' +
      '<div class="btna-links"><a class="btna-btn" target="_blank" rel="noopener noreferrer" href="https://qcat.wocat.net/en/wocat/list/">Browse WOCAT</a>' +
      '<a class="btna-btn" target="_blank" rel="noopener noreferrer" href="https://qcat.readthedocs.io/en/latest/api/v2.html">API docs</a></div></section>' +

      '<section class="btna-section"><h3>📊 FAOSTAT — Land use (RL)</h3>' +
      '<div id="btna-faostat-status" class="btna-status pending">Loading public data…</div>' +
      '<div id="btna-faostat-content" class="btna-muted">Looking up the country in FAOSTAT and querying the most recent years available.</div>' +
      '<button id="btna-faostat-refresh" class="btna-btn" type="button">Refresh land-use data</button> ' +
      '<a class="btna-btn" target="_blank" rel="noopener noreferrer" href="https://www.fao.org/faostat/en/#data">FAOSTAT portal</a>' +
      '<div class="btna-foot">Dataset RL = Land Use. Figures are official source observations, not a site-specific diagnosis or restoration prescription. The API can return older years when newer observations are unavailable.</div></section>' +

      '<section class="btna-section"><h3>🗺️ FAO Hand-in-Hand — Geospatial layers</h3>' +
      '<div class="btna-status info">Official spatial workspace linked</div>' +
      '<div class="btna-muted">Hand-in-Hand combines datasets on land, soil, water, climate, crops, forestry and socioeconomic conditions. It does not expose one universal country-level recommendation endpoint; choose and inspect the required public layer in FAO’s workspace.</div>' +
      '<div class="btna-links"><a class="btna-btn" target="_blank" rel="noopener noreferrer" href="' + HIH_PORTAL + '">Open Hand-in-Hand map</a>' +
      '<a class="btna-btn" target="_blank" rel="noopener noreferrer" href="' + FAO_CATALOG + '">Open FAO data catalogue</a></div>' +
      '<p class="btna-muted">Suggested catalogue search: <strong id="btna-hih-query">' + escapeHTML(countryName + ' land degradation soil water climate restoration') + '</strong></p>' +
      '<button id="btna-copy-hih" class="btna-btn" type="button">Copy search terms</button>' +
      '<div id="btna-hih-feedback" class="btna-muted" aria-live="polite"></div></section>' +
      '<div class="btna-foot">Data-source integrity: an “available” badge means the live request succeeded. If a source is unavailable, blocked by CORS, or requires authorization, this panel reports the limitation rather than substituting mock data.</div>';

    document.getElementById('btna-close').addEventListener('click', function () {
      panel.hidden = true;
      if (typeof dialogueBox !== 'undefined') dialogueBox.style.display = 'none';
    });
    document.getElementById('btna-wocat-connect').addEventListener('click', function () {
      var input = document.getElementById('btna-wocat-token');
      wocatToken = String(input.value || '').trim();
      if (!wocatToken) {
        setStatus('btna-wocat-status', 'Paste a valid authorized token first', 'error');
        return;
      }
      loadWocat(selected && selected.country, selected && selected.iso3, requestId);
    });
    document.getElementById('btna-wocat-clear').addEventListener('click', function () {
      wocatToken = '';
      var input = document.getElementById('btna-wocat-token');
      if (input) input.value = '';
      setStatus('btna-wocat-status', 'Token cleared from this page session', 'pending');
      document.getElementById('btna-wocat-content').textContent = 'WOCAT requires an authorized token to query its QCAT API.';
    });
    document.getElementById('btna-faostat-refresh').addEventListener('click', function () {
      if (selected) loadFaostat(selected.country, selected.iso3, requestId);
    });
    document.getElementById('btna-copy-hih').addEventListener('click', async function () {
      var value = document.getElementById('btna-hih-query').textContent;
      var feedback = document.getElementById('btna-hih-feedback');
      try {
        await navigator.clipboard.writeText(value);
        feedback.textContent = 'Search terms copied.';
      } catch (_) {
        feedback.textContent = 'Copy unavailable in this browser. Select the search terms above and copy them manually.';
      }
    });
    return panel;
  }

  function countryAliases(name) {
    var normalized = normalize(name);
    var aliases = [normalized];
    Object.keys(COUNTRY_ALIASES).forEach(function (key) {
      if (normalize(key) === normalized) aliases = aliases.concat(COUNTRY_ALIASES[key].map(normalize));
      COUNTRY_ALIASES[key].forEach(function (alias) {
        if (normalize(alias) === normalized) aliases.push(normalize(key));
      });
    });
    return aliases;
  }

  function getFeatureIso3(feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var candidates = [
      props.ISO_A3, props.ISO_A3_EH, props.ADM0_A3, props.SOV_A3,
      props.iso_a3, props.iso3, props.ISO3, props['ISO 3166-1 alpha-3']
    ];
    for (var i = 0; i < candidates.length; i++) {
      var val = String(candidates[i] || '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(val) && val !== 'UNK') return val;
    }
    return '';
  }

  async function lookupArea(countryName, iso3) {
    if (!areaCache || Date.now() - areaCacheAt > 6 * 60 * 60 * 1000) {
      var json = await fetchJSON(FAOSTAT_BASE + '/en/definitions/types/area?output_type=objects');
      areaCache = extractRows(json);
      areaCacheAt = Date.now();
    }

    var aliases = countryAliases(countryName);
    var match = null;
    for (var i = 0; i < areaCache.length; i++) {
      var code = String(firstValue(areaCache[i], ['ISO3 Code', 'ISO3', 'ISO 3166-1 alpha-3', 'Area Code (ISO3)'])).toUpperCase();
      if (iso3 && code === iso3) { match = areaCache[i]; break; }
    }
    if (!match) {
      for (var j = 0; j < areaCache.length; j++) {
        var rowName = normalize(firstValue(areaCache[j], ['Area', 'Area Name', 'Country', 'Name', 'Area label']));
        if (aliases.indexOf(rowName) >= 0) { match = areaCache[j]; break; }
      }
    }
    if (match) {
      return {
        code: firstValue(match, ['Area Code', 'Area Code (FAO)', 'Code', 'area_code']),
        name: firstValue(match, ['Area', 'Area Name', 'Country', 'Name']) || countryName
      };
    }
    if (iso3 && FALLBACK_AREA_CODES[iso3]) return { code: FALLBACK_AREA_CODES[iso3], name: countryName };
    return null;
  }

  function formatNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return String(value == null ? '—' : value);
    return number.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function renderFaostatRows(rows) {
    var node = document.getElementById('btna-faostat-content');
    if (!node) return;
    if (!rows.length) {
      node.innerHTML = '<p class="btna-muted">The API returned no non-null land-use observations for this country in the requested time window.</p>';
      return;
    }
    rows.sort(function (a, b) {
      return Number(firstValue(b, ['Year', 'Year Code'])) - Number(firstValue(a, ['Year', 'Year Code']));
    });
    var latest = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = firstValue(row, ['Item', 'Item Name']) || 'Unlabelled item';
      var element = firstValue(row, ['Element', 'Element Name']) || 'Observation';
      var key = normalize(item) + '|' + normalize(element);
      if (!seen[key]) {
        seen[key] = true;
        latest.push(row);
      }
      if (latest.length >= 8) break;
    }
    var html = '<div class="btna-tablewrap"><table class="btna-table"><thead><tr><th>Indicator / item</th><th>Year</th><th>Value</th></tr></thead><tbody>';
    latest.forEach(function (row) {
      var item = firstValue(row, ['Item', 'Item Name']) || 'Unlabelled item';
      var element = firstValue(row, ['Element', 'Element Name']) || 'Observation';
      var year = firstValue(row, ['Year', 'Year Code']) || '—';
      var value = firstValue(row, ['Value', 'value']);
      var unit = firstValue(row, ['Unit', 'Unit Name']);
      html += '<tr><td>' + escapeHTML(item) + '<br><span class="btna-muted">' + escapeHTML(element) + '</span></td>' +
        '<td>' + escapeHTML(year) + '</td><td>' + escapeHTML(formatNumber(value)) +
        '<br><span class="btna-muted">' + escapeHTML(unit) + '</span></td></tr>';
    });
    html += '</tbody></table></div><p class="btna-muted">Showing the latest available observation per item/element from the returned time window. Values and units follow the FAOSTAT response.</p>';
    node.innerHTML = html;
  }

  async function loadFaostat(countryName, iso3, id) {
    setStatus('btna-faostat-status', 'Looking up country and loading Land Use (RL)…', 'pending');
    var content = document.getElementById('btna-faostat-content');
    if (content) content.textContent = 'Calling the FAOSTAT public API. No sample values are shown while the live request is pending.';
    var button = document.getElementById('btna-faostat-refresh');
    if (button) button.disabled = true;
    try {
      var area = await lookupArea(countryName, iso3);
      if (id !== requestId) return;
      if (!area || !area.code) {
        setStatus('btna-faostat-status', 'Country code not matched', 'error');
        content.textContent = 'FAOSTAT area lookup did not return a matching country code. Open FAOSTAT to verify the country/area spelling.';
        return;
      }
      var currentYear = new Date().getFullYear();
      var startYear = currentYear - 6;
      var url = FAOSTAT_BASE + '/en/data/RL?area=' + encodeURIComponent(area.code) +
        '&year_start=' + startYear + '&year_end=' + currentYear +
        '&output_type=objects&show_codes=true&show_unit=true&show_flags=true';
      var json = await fetchJSON(url);
      if (id !== requestId) return;
      var rows = extractRows(json).filter(function (row) {
        return firstValue(row, ['Value', 'value']) !== '' && firstValue(row, ['Value', 'value']) != null;
      });
      if (!rows.length) {
        setStatus('btna-faostat-status', 'Request succeeded; no observations found', 'pending');
        content.textContent = 'The API responded but returned no populated Land Use observations for ' + area.name + ' in ' + startYear + '–' + currentYear + '.';
        return;
      }
      setStatus('btna-faostat-status', 'LIVE DATA · ' + rows.length + ' observations returned', 'ok');
      renderFaostatRows(rows);
    } catch (error) {
      if (id !== requestId) return;
      setStatus('btna-faostat-status', 'Live request failed', 'error');
      content.innerHTML = '<p class="btna-muted">' + escapeHTML(error.message || 'Unknown API error') + '</p>' +
        '<p class="btna-muted">No mock values were substituted. Try again later or open the official FAOSTAT portal.</p>';
    } finally {
      if (button && id === requestId) button.disabled = false;
    }
  }

  async function loadWocat(countryName, iso3, id) {
    var content = document.getElementById('btna-wocat-content');
    if (!wocatToken) {
      setStatus('btna-wocat-status', 'Authorized token required', 'pending');
      if (content) content.textContent = 'To query live WOCAT technology records, use a token issued through the WOCAT QCAT process. The repository does not include a token.';
      return;
    }
    if (!iso3) {
      setStatus('btna-wocat-status', 'Country code unavailable', 'error');
      if (content) content.textContent = 'This map feature has no recognized ISO-3 country code, so a reliable WOCAT country filter cannot be constructed.';
      return;
    }
    setStatus('btna-wocat-status', 'Requesting WOCAT records…', 'pending');
    if (content) content.textContent = 'Querying WOCAT sustainable land management technologies for ' + countryName + '.';
    try {
      var url = WOCAT_BASE + '?type=technologies&filter__qg_location__country=' +
        encodeURIComponent('country_' + iso3) + '&page=1';
      var json = await fetchJSON(url, {
        headers: { 'Accept': 'application/json', 'Authorization': 'Token ' + wocatToken }
      });
      if (id !== requestId) return;
      var rows = extractRows(json);
      if (!rows.length) {
        setStatus('btna-wocat-status', 'Request succeeded; no matching records', 'pending');
        content.textContent = 'The authorized API request returned no technology records for this country. Try browsing WOCAT for other query filters.';
        return;
      }
      var list = '<ul class="btna-list">';
      rows.slice(0, 8).forEach(function (row) {
        var name = firstValue(row, ['name', 'title']) || firstValue(row, ['code']) || 'WOCAT technology';
        var urlPath = firstValue(row, ['url', 'details']);
        var fullUrl = urlPath ? (urlPath.indexOf('http') === 0 ? urlPath : 'https://qcat.wocat.net' + urlPath) : '';
        list += '<li><strong>' + escapeHTML(name) + '</strong>' +
          (firstValue(row, ['code']) ? '<br><span class="btna-muted">' + escapeHTML(firstValue(row, ['code'])) + '</span>' : '') +
          (fullUrl ? '<br><a target="_blank" rel="noopener noreferrer" href="' + escapeHTML(fullUrl) + '">Open record ↗</a>' : '') + '</li>';
      });
      list += '</ul>';
      content.innerHTML = list;
      setStatus('btna-wocat-status', 'LIVE DATA · ' + (json.count != null ? json.count : rows.length) + ' records matched', 'ok');
    } catch (error) {
      if (id !== requestId) return;
      setStatus('btna-wocat-status', 'Live request failed', 'error');
      if (content) content.innerHTML = '<p class="btna-muted">' + escapeHTML(error.message || 'Unknown API error') + '</p>' +
        '<p class="btna-muted">A 401/403 means the token lacks access. A browser access error can mean QCAT does not permit this cross-origin request. No sample WOCAT data is shown.</p>';
    }
  }

  window.onRegionClick = function (event, feature) {
    var props = feature && feature.properties ? feature.properties : {};
    var countryName = props.ADMIN || props.name || props.NAME || props.sovereignt || 'Unknown region';
    var iso3 = getFeatureIso3(feature);
    if (typeof map !== 'undefined' && event && event.target && typeof event.target.getBounds === 'function') {
      map.fitBounds(event.target.getBounds(), { padding: [50, 50], maxZoom: 6 });
    }
    if (typeof dialogueBox !== 'undefined') dialogueBox.style.display = 'none';
    requestId += 1;
    selected = { country: countryName, iso3: iso3, feature: feature };
    renderPanel(countryName);
    setStatus('btna-wocat-status', wocatToken ? 'Ready to fetch live records' : 'Authorized token required', 'pending');
    document.getElementById('btna-wocat-content').textContent = wocatToken
      ? 'A WOCAT query can be run for this country using the active session token.'
      : 'WOCAT requires a QCAT authorization token. Expand “Connect WOCAT for this session” to provide one; this is optional.';
    setStatus('btna-faostat-status', 'Loading public data…', 'pending');
    loadFaostat(countryName, iso3, requestId);
    if (wocatToken) loadWocat(countryName, iso3, requestId);
  };
})();