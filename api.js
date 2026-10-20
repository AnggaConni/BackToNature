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


  // Curated crop screening library. These are broad agronomic ranges for discovery,
  // not a substitute for local extension advice or a parcel-level suitability model.
  var CROP_LIBRARY = [
    {id:'rice', name:'Rice', local:'Padi', scientific:'Oryza sativa', category:'staple', soils:['clay','loam','alluvial','volcanic'], phMin:5.0, phMax:7.2, drainage:['waterlogged','moderate'], water:['standing','reliable'], climates:['humid-tropical','seasonal-tropical','subtropical'], uses:['staple'], note:'Paddy rice needs a suitable water-control system and a locally recommended variety. Not every rice variety suits flooded or upland conditions.', caution:'Confirm irrigation, flood control, salinity and the local planting calendar.'},
    {id:'maize', name:'Maize / Corn', local:'Jagung', scientific:'Zea mays', category:'staple', soils:['loam','clay','alluvial','volcanic'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['staple','market'], note:'Generally prefers fertile, well-drained soil and reliable moisture during flowering and grain filling.', caution:'Waterlogging and severe acidity can limit yield; use a locally adapted variety.'},
    {id:'cassava', name:'Cassava', local:'Singkong / Ubi kayu', scientific:'Manihot esculenta', category:'root', soils:['sandy','loam','volcanic','acidic'], phMin:4.5, phMax:7.0, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical'], uses:['staple','market'], note:'Often tolerates relatively acidic and seasonally dry soils, but performs poorly in prolonged waterlogging.', caution:'Prevent erosion on sloping land and use healthy planting stems.'},
    {id:'sweet-potato', name:'Sweet Potato', local:'Ubi jalar', scientific:'Ipomoea batatas', category:'root', soils:['sandy','loam','volcanic'], phMin:5.0, phMax:7.0, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['staple','market'], note:'Loose, well-drained soil supports root development; avoid compacted or persistently waterlogged plots.', caution:'Choose locally adapted cuttings and check weevil and virus pressure.'},
    {id:'soybean', name:'Soybean', local:'Kedelai', scientific:'Glycine max', category:'legume', soils:['loam','clay','alluvial','volcanic'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['seasonal-tropical','subtropical','temperate'], uses:['staple','market'], note:'Prefers well-drained soil and a suitable variety/rhizobium association. Sensitive to prolonged waterlogging.', caution:'Confirm local varieties, inoculation needs, day length and planting window.'},
    {id:'mung-bean', name:'Mung Bean', local:'Kacang hijau', scientific:'Vigna radiata', category:'legume', soils:['sandy','loam','alluvial'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['staple','market','restoration'], note:'A short-duration legume that may fit warm seasonal systems and rotations where drainage is adequate.', caution:'Avoid prolonged waterlogging; check local disease and seed availability.'},
    {id:'peanut', name:'Groundnut / Peanut', local:'Kacang tanah', scientific:'Arachis hypogaea', category:'legume', soils:['sandy','loam'], phMin:5.5, phMax:7.0, drainage:['well'], water:['seasonal','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['staple','market'], note:'Loose, friable soil is useful for pod development and harvest; poorly drained heavy soils raise disease risk.', caution:'Check calcium needs, rotation history, aflatoxin-safe drying and local varieties.'},
    {id:'sorghum', name:'Sorghum', local:'Sorgum', scientific:'Sorghum bicolor', category:'staple', soils:['sandy','loam','clay','alluvial'], phMin:5.0, phMax:8.0, drainage:['well','moderate'], water:['limited','seasonal','reliable'], climates:['seasonal-tropical','dry-tropical','subtropical'], uses:['staple','market','restoration'], note:'A candidate for warm regions with seasonal water limitation; still needs establishment moisture and suitable soil drainage.', caution:'Select grain, forage or sweet sorghum types according to intended use.'},
    {id:'millet', name:'Millet', local:'Jewawut / millet', scientific:'Cenchrus americanus', category:'staple', soils:['sandy','loam'], phMin:5.0, phMax:8.0, drainage:['well','moderate'], water:['limited','seasonal'], climates:['dry-tropical','seasonal-tropical','subtropical'], uses:['staple','market'], note:'A drought-adapted cereal candidate for many warm, seasonally dry environments.', caution:'The crop and variety need to match local rainfall, soils and food-market preferences.'},
    {id:'tomato', name:'Tomato', local:'Tomat', scientific:'Solanum lycopersicum', category:'vegetable', soils:['loam','sandy','volcanic','alluvial'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable'], climates:['highland-tropical','subtropical','temperate'], uses:['vegetable','market'], note:'Best considered where temperature is suitable, drainage is good and moisture can be managed evenly.', caution:'Heat, humidity, bacterial/wilt diseases and pesticide management vary substantially by location.'},
    {id:'chili', name:'Chili Pepper', local:'Cabai', scientific:'Capsicum annuum', category:'vegetable', soils:['loam','volcanic','alluvial','sandy'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical','highland-tropical','subtropical'], uses:['vegetable','market'], note:'Needs well-drained soil and careful water management; conditions should suit the chosen chili type.', caution:'Check virus/vector pressure, rainfall during flowering and local market-price risk.'},
    {id:'leafy-greens', name:'Leafy Vegetables', local:'Sayuran daun', scientific:'Brassica / Amaranthus spp.', category:'vegetable', soils:['loam','clay','alluvial','volcanic'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable'], climates:['humid-tropical','seasonal-tropical','highland-tropical','subtropical','temperate'], uses:['vegetable','market'], note:'A broad group rather than one species. Crop choice depends on temperature, food preference, clean water and harvest logistics.', caution:'Use food-safe water and growing media, especially in urban or roadside sites.'},
    {id:'potato', name:'Potato', local:'Kentang', scientific:'Solanum tuberosum', category:'vegetable', soils:['loam','sandy','volcanic'], phMin:5.0, phMax:6.5, drainage:['well'], water:['reliable'], climates:['highland-tropical','subtropical','temperate'], uses:['vegetable','market'], note:'Usually better suited to cool conditions, loose soil and reliable moisture without waterlogging.', caution:'Warm lowland climates, seed quality, late blight and input costs can make production unsuitable.'},
    {id:'banana', name:'Banana / Plantain', local:'Pisang', scientific:'Musa spp.', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:5.5, phMax:7.5, drainage:['well','moderate'], water:['reliable'], climates:['humid-tropical','seasonal-tropical'], uses:['fruit','market'], note:'Typically needs warm conditions, steady moisture and fertile, well-drained soil.', caution:'Avoid stagnant water and use locally recommended disease-free planting material.'},
    {id:'coconut', name:'Coconut', local:'Kelapa', scientific:'Cocos nucifera', category:'perennial', soils:['sandy','loam','alluvial'], phMin:5.0, phMax:8.0, drainage:['well','moderate'], water:['seasonal','reliable'], climates:['humid-tropical','seasonal-tropical'], uses:['fruit','market'], note:'A warm-climate perennial often associated with coastal and lowland settings, but soil depth and freshwater availability matter.', caution:'Saline spray tolerance is not the same as tolerance of saline root-zone soil.'},
    {id:'coffee-arabica', name:'Arabica Coffee', local:'Kopi Arabika', scientific:'Coffea arabica', category:'perennial', soils:['volcanic','loam','acidic'], phMin:5.0, phMax:6.5, drainage:['well'], water:['reliable','seasonal'], climates:['highland-tropical','subtropical'], uses:['market'], note:'Usually a cooler-elevation coffee requiring suitable temperature, rainfall seasonality and well-drained soil.', caution:'Elevation bands, shade, varieties and coffee leaf rust risk are location-specific.'},
    {id:'coffee-robusta', name:'Robusta Coffee', local:'Kopi Robusta', scientific:'Coffea canephora', category:'perennial', soils:['volcanic','loam','acidic'], phMin:4.5, phMax:6.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A warm tropical coffee candidate that usually needs moisture and good drainage.', caution:'Confirm local elevation, rainfall, clone/variety and pest/disease conditions.'},
    {id:'cacao', name:'Cacao', local:'Kakao', scientific:'Theobroma cacao', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:5.0, phMax:7.0, drainage:['well','moderate'], water:['reliable'], climates:['humid-tropical'], uses:['market'], note:'Typically prefers warm humid environments, deep soils and reliable moisture without prolonged root-zone flooding.', caution:'Check shade, drainage, local disease pressure and access to fermentation/drying facilities.'},
    {id:'mango', name:'Mango', local:'Mangga', scientific:'Mangifera indica', category:'perennial', soils:['sandy','loam','volcanic','alluvial'], phMin:5.5, phMax:7.5, drainage:['well'], water:['seasonal','limited','reliable'], climates:['seasonal-tropical','dry-tropical','subtropical'], uses:['fruit','market'], note:'Often suits warm seasonally dry climates and deep well-drained soils; flowering can be affected by local rainfall patterns.', caution:'Choose varieties for local rainfall, disease pressure, fruit quality and market timing.'},
    {id:'cashew', name:'Cashew', local:'Jambu mete / Jambu monyet', scientific:'Anacardium occidentale', category:'perennial', soils:['sandy','loam','alluvial'], phMin:4.5, phMax:7.5, drainage:['well'], water:['limited','seasonal','reliable'], climates:['seasonal-tropical','dry-tropical','humid-tropical'], uses:['fruit','market','restoration'], note:'A tropical tree crop often considered in seasonally dry systems; establishment needs enough moisture even where mature trees tolerate dry periods.', caution:'Verify local cultivar, flowering/rainfall timing, fire exposure, soil depth and access to safe nut processing.'},
    {id:'tamarind', name:'Tamarind', local:'Asam jawa', scientific:'Tamarindus indica', category:'perennial', soils:['sandy','loam','alluvial'], phMin:5.0, phMax:8.0, drainage:['well','moderate'], water:['limited','seasonal','reliable'], climates:['seasonal-tropical','dry-tropical','humid-tropical'], uses:['fruit','market','restoration'], note:'A long-lived tropical tree often adapted to seasonal dry periods once established.', caution:'Use locally appropriate planting material and check land tenure, establishment water, grazing and harvest needs.'},
    {id:'pineapple', name:'Pineapple', local:'Nanas', scientific:'Ananas comosus', category:'fruit', soils:['sandy','loam','acidic'], phMin:4.5, phMax:6.5, drainage:['well'], water:['seasonal','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical'], uses:['fruit','market'], note:'Often tolerates acidic soils better than many crops and requires good drainage.', caution:'Do not expand onto natural peatlands or clear sensitive ecosystems just because acidity appears suitable.'},
    {id:'sago', name:'Sago Palm', local:'Sagu', scientific:'Metroxylon sagu', category:'perennial', soils:['peat','alluvial'], phMin:4.0, phMax:6.5, drainage:['moderate','waterlogged'], water:['standing','reliable'], climates:['humid-tropical'], uses:['staple','market'], note:'A wet-tropical starch crop associated with suitable swampy landscapes in parts of Southeast Asia and the Pacific.', caution:'Suitability depends on local ecology, land tenure and existing managed landscapes; do not drain or convert peat ecosystems.'},
    {id:'vetiver', name:'Vetiver Grass', local:'Akar wangi / vetiver', scientific:'Chrysopogon zizanioides', category:'restoration', soils:['sandy','loam','clay','volcanic','acidic','alluvial'], phMin:4.0, phMax:8.0, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['restoration'], note:'A candidate for contour hedges and erosion-control trials where locally appropriate; it is not a food crop.', caution:'Use a non-invasive, locally approved variety and design erosion-control measures for the actual slope and flow path.'},
    {id:'sunn-hemp', name:'Sunn Hemp', local:'Crotalaria / sunn hemp', scientific:'Crotalaria juncea', category:'cover-crop', soils:['sandy','loam','volcanic','alluvial'], phMin:5.0, phMax:7.5, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical'], uses:['restoration'], note:'A warm-season cover/green-manure legume candidate for suitable rotations and soil-cover goals.', caution:'Check local regulations, toxicity to livestock, seed availability and avoid use where it could escape cultivation.'}
  ];

  // Broad planting-window bands used only for initial screening. They must be
  // calibrated against local crop calendars and agricultural-extension advice.
  // Rainfall is accumulated over the establishment/growing window, not per month.
  var CLIMATE_CROP_RULES = {
    'rice': {months:4,tempMin:20,tempMax:32,rainMin:350,rainMax:1200},
    'maize': {months:4,tempMin:18,tempMax:32,rainMin:180,rainMax:700},
    'cassava': {months:6,tempMin:20,tempMax:34,rainMin:300,rainMax:1200},
    'sweet-potato': {months:4,tempMin:18,tempMax:30,rainMin:180,rainMax:650},
    'soybean': {months:4,tempMin:20,tempMax:30,rainMin:200,rainMax:650},
    'mung-bean': {months:3,tempMin:20,tempMax:35,rainMin:100,rainMax:350},
    'peanut': {months:4,tempMin:20,tempMax:30,rainMin:200,rainMax:600},
    'sorghum': {months:4,tempMin:20,tempMax:35,rainMin:120,rainMax:500},
    'millet': {months:3,tempMin:20,tempMax:35,rainMin:80,rainMax:300},
    'tomato': {months:4,tempMin:15,tempMax:30,rainMin:180,rainMax:600},
    'chili': {months:5,tempMin:18,tempMax:32,rainMin:250,rainMax:800},
    'leafy-greens': {months:2,tempMin:15,tempMax:30,rainMin:80,rainMax:260},
    'potato': {months:4,tempMin:10,tempMax:24,rainMin:180,rainMax:550},
    'banana': {months:4,tempMin:22,tempMax:32,rainMin:300,rainMax:1000},
    'coconut': {months:6,tempMin:22,tempMax:32,rainMin:450,rainMax:1500},
    'coffee-arabica': {months:4,tempMin:15,tempMax:24,rainMin:300,rainMax:900},
    'coffee-robusta': {months:4,tempMin:20,tempMax:30,rainMin:300,rainMax:1000},
    'cacao': {months:6,tempMin:21,tempMax:32,rainMin:500,rainMax:1500},
    'mango': {months:4,tempMin:24,tempMax:35,rainMin:150,rainMax:600},
    'pineapple': {months:4,tempMin:20,tempMax:32,rainMin:180,rainMax:600},
    'cashew': {months:6,tempMin:22,tempMax:35,rainMin:250,rainMax:900},
    'tamarind': {months:6,tempMin:22,tempMax:38,rainMin:180,rainMax:800},
    'sago': {months:6,tempMin:24,tempMax:32,rainMin:600,rainMax:1800},
    'vetiver': {months:3,tempMin:18,tempMax:35,rainMin:100,rainMax:450},
    'sunn-hemp': {months:3,tempMin:20,tempMax:35,rainMin:100,rainMax:350}
  };

  function listCropRecommendations(criteria) {
    criteria = criteria || {};
    var soil = String(criteria.soil || 'unknown');
    var drainage = String(criteria.drainage || 'unknown');
    var water = String(criteria.water || 'unknown');
    var climate = String(criteria.climate || 'unknown');
    var use = String(criteria.use || 'any');
    var ph = criteria.ph === '' || criteria.ph == null ? null : Number(criteria.ph);
    if (ph != null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) ph = null;

    return CROP_LIBRARY.map(function (crop) {
      var score = 0;
      var reasons = [];
      var cautions = [crop.caution];
      var soilMismatch = false;
      var pHOutsideRange = false;

      if (soil === 'unknown') {
        score += 15;
      } else if (crop.soils.indexOf(soil) >= 0) {
        score += 30;
        reasons.push('The selected soil group is included in this crop’s broad screening profile.');
      } else {
        soilMismatch = true;
        cautions.push('The selected soil group is not a strong match in this broad screen; verify texture, depth, drainage and local evidence before planting.');
      }

      if (ph == null) {
        score += 10;
      } else if (ph >= crop.phMin && ph <= crop.phMax) {
        score += 20;
        reasons.push('The entered pH is within the broad screening range (' + crop.phMin.toFixed(1) + '–' + crop.phMax.toFixed(1) + ').');
      } else if (ph >= crop.phMin - 0.5 && ph <= crop.phMax + 0.5) {
        score += 9;
        cautions.push('The entered pH is near, but outside, the screening range; check the crop’s local tolerance and soil-test advice.');
      } else {
        pHOutsideRange = true;
        cautions.push('The entered pH is outside the broad screening range; do not correct it without a suitable soil test and local advice.');
      }

      if (drainage === 'unknown') score += 10;
      else if (crop.drainage.indexOf(drainage) >= 0) {
        score += 20;
        reasons.push('The selected drainage condition fits the broad profile.');
      } else {
        score += 2;
        cautions.push('Drainage mismatch: prolonged waterlogging or excessive dryness can change the outcome.');
      }

      if (water === 'unknown') score += 8;
      else if (crop.water.indexOf(water) >= 0) {
        score += 15;
        reasons.push('The selected water-availability pattern fits the broad profile.');
      } else {
        score += 2;
        cautions.push('Water availability may not meet this crop’s needs through its full growth cycle.');
      }

      if (climate === 'unknown') score += 5;
      else if (crop.climates.indexOf(climate) >= 0) {
        score += 10;
        reasons.push('The selected climate group is compatible at a broad screening level.');
      } else {
        score += 1;
        cautions.push('The selected climate group is not a strong match; confirm temperature, rainfall seasonality and elevation.');
      }

      if (use === 'any') score += 2;
      else if (crop.uses.indexOf(use) >= 0) score += 5;
      else score += 0;

      return Object.assign({}, crop, {
        // Avoid a reassuring score when an explicit soil/pH input is a major mismatch.
        score: Math.min(score, soilMismatch ? 49 : (pHOutsideRange ? 59 : 100)),
        reasons: reasons,
        cautions: cautions,
        pHText: crop.phMin.toFixed(1) + '–' + crop.phMax.toFixed(1)
      });
    }).sort(function (a, b) {
      return b.score - a.score || a.name.localeCompare(b.name);
    }).slice(0, 8);
  }

  var plantImageCache = {};
  function plainMetadata(value) {
    return String(value || '').replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&#0*39;/gi, "'")
      .replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
  }

  async function searchPlantImages(crop, limit) {
    var cropInfo = typeof crop === 'string' ? { name:crop, scientific:crop } : (crop || {});
    var scientific = String(cropInfo.scientific || cropInfo.scientificName || '').trim();
    var common = String(cropInfo.name || cropInfo.commonName || '').trim();
    var query = [scientific, common, 'plant crop'].filter(Boolean).join(' ');
    var cacheKey = query.toLowerCase();
    if (plantImageCache[cacheKey]) return plantImageCache[cacheKey];

    var params = new URLSearchParams({
      action:'query',
      format:'json',
      origin:'*',
      generator:'search',
      gsrsearch:query,
      gsrnamespace:'6',
      gsrlimit:String(Math.min(Math.max(Number(limit) || 4, 1), 8)),
      prop:'imageinfo',
      iiprop:'url|extmetadata',
      iiurlwidth:'640',
      iiextmetadatafilter:'Artist|Credit|LicenseShortName|LicenseUrl|Attribution|ImageDescription'
    });
    var payload = await requestJSON('https://commons.wikimedia.org/w/api.php?' + params.toString());
    var pages = payload && payload.query && payload.query.pages ? Object.keys(payload.query.pages).map(function (key) {
      return payload.query.pages[key];
    }) : [];
    var images = pages.map(function (page) {
      var info = page.imageinfo && page.imageinfo[0] ? page.imageinfo[0] : null;
      if (!info || !info.url || !/^image\//i.test(info.mime || '')) return null;
      var meta = info.extmetadata || {};
      function metaValue(key) { return plainMetadata(meta[key] && meta[key].value || ''); }
      return {
        title: String(page.title || ''),
        imageUrl: String(info.thumburl || info.url),
        fileUrl: String(info.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(page.title || '').replace(/%3A/gi, ':').replace(/%20/g, '_'))),
        artist: metaValue('Artist') || metaValue('Credit') || 'Author details on the file page',
        license: metaValue('LicenseShortName') || 'Check file page',
        licenseUrl: String(meta.LicenseUrl && meta.LicenseUrl.value || ''),
        description: metaValue('ImageDescription'),
        source: 'Wikimedia Commons'
      };
    }).filter(Boolean);
    plantImageCache[cacheKey] = images;
    return images;
  }

  var climateRequestCache = {};

  function mean(values) {
    var valid = values.filter(function (value) { return value != null && Number.isFinite(Number(value)); }).map(Number);
    return valid.length ? valid.reduce(function (sum, value) { return sum + value; }, 0) / valid.length : null;
  }

  function round(value, digits) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    var scale = Math.pow(10, digits || 0);
    return Math.round(Number(value) * scale) / scale;
  }

  function degreesFromVector(sinSum, cosSum) {
    if (!sinSum && !cosSum) return null;
    return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
  }

  function compassDirection(degrees) {
    if (degrees == null || !Number.isFinite(Number(degrees))) return 'Not available';
    return ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][
      Math.round(Number(degrees) / 22.5) % 16
    ];
  }

  async function fetchHistoricalClimate(latitude, longitude, requestedYears) {
    var lat = Number(latitude);
    var lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error('A valid representative latitude and longitude are required for climate lookup.');
    }
    var years = Math.max(3, Math.min(10, Math.round(Number(requestedYears) || 5)));
    var cacheKey = lat.toFixed(3) + ',' + lon.toFixed(3) + ':' + years;
    if (climateRequestCache[cacheKey]) return climateRequestCache[cacheKey];

    var promise = (async function () {
      var currentYear = new Date().getFullYear();
      var startYear = currentYear - years;
      var endYear = currentYear - 1;
      var params = new URLSearchParams({
        latitude:lat.toFixed(5),
        longitude:lon.toFixed(5),
        start_date:startYear + '-01-01',
        end_date:endYear + '-12-31',
        daily:[
          'temperature_2m_mean',
          'temperature_2m_min',
          'temperature_2m_max',
          'precipitation_sum',
          'wind_speed_10m_mean',
          'wind_speed_10m_max',
          'wind_gusts_10m_max',
          'wind_direction_10m_dominant'
        ].join(','),
        timezone:'auto',
        temperature_unit:'celsius',
        precipitation_unit:'mm',
        wind_speed_unit:'kmh'
      });
      var url = 'https://archive-api.open-meteo.com/v1/archive?' + params.toString();
      var payload = await requestJSON(url);
      var daily = payload && payload.daily;
      if (!daily || !Array.isArray(daily.time) || daily.time.length < 300) {
        throw new Error('The historical weather service returned too few daily observations for a seasonal profile.');
      }
      var variables = [
        'temperature_2m_mean','temperature_2m_min','temperature_2m_max',
        'precipitation_sum','wind_speed_10m_mean','wind_speed_10m_max',
        'wind_gusts_10m_max','wind_direction_10m_dominant'
      ];
      var yearly = {};
      daily.time.forEach(function (date, index) {
        var month = Number(String(date).slice(5,7)) - 1;
        var year = Number(String(date).slice(0,4));
        if (month < 0 || month > 11 || !Number.isFinite(year)) return;
        var key = year + '-' + month;
        if (!yearly[key]) {
          yearly[key] = {
            year:year, month:month, days:0, temperatures:[], minima:[], maxima:[],
            precipitation:0, rainyDays:0, windMeans:[], windMaxima:[], gustMaxima:[],
            directionSin:0, directionCos:0, directionCount:0
          };
        }
        var bucket = yearly[key];
        bucket.days++;
        var values = {};
        variables.forEach(function (variable) {
          var array = daily[variable];
          values[variable] = Array.isArray(array) && array[index] != null && Number.isFinite(Number(array[index]))
            ? Number(array[index]) : null;
        });
        if (values.temperature_2m_mean != null) bucket.temperatures.push(values.temperature_2m_mean);
        if (values.temperature_2m_min != null) bucket.minima.push(values.temperature_2m_min);
        if (values.temperature_2m_max != null) bucket.maxima.push(values.temperature_2m_max);
        if (values.precipitation_sum != null) {
          bucket.precipitation += values.precipitation_sum;
          if (values.precipitation_sum >= 1) bucket.rainyDays++;
        }
        if (values.wind_speed_10m_mean != null) bucket.windMeans.push(values.wind_speed_10m_mean);
        if (values.wind_speed_10m_max != null) bucket.windMaxima.push(values.wind_speed_10m_max);
        if (values.wind_gusts_10m_max != null) bucket.gustMaxima.push(values.wind_gusts_10m_max);
        if (values.wind_direction_10m_dominant != null) {
          var radians = values.wind_direction_10m_dominant * Math.PI / 180;
          bucket.directionSin += Math.sin(radians);
          bucket.directionCos += Math.cos(radians);
          bucket.directionCount++;
        }
      });

      var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var monthly = monthNames.map(function (name, monthIndex) {
        var buckets = Object.keys(yearly).map(function (key) { return yearly[key]; })
          .filter(function (bucket) { return bucket.month === monthIndex && bucket.days >= 20; });
        var rainfall = buckets.map(function (bucket) { return bucket.precipitation; });
        var rainDays = buckets.map(function (bucket) { return bucket.rainyDays; });
        var tempMeans = buckets.map(function (bucket) { return mean(bucket.temperatures); });
        var tempMins = buckets.map(function (bucket) { return mean(bucket.minima); });
        var tempMaxs = buckets.map(function (bucket) { return mean(bucket.maxima); });
        var windMeans = buckets.map(function (bucket) { return mean(bucket.windMeans); });
        var windMaxima = buckets.map(function (bucket) { return bucket.windMaxima.length ? Math.max.apply(null, bucket.windMaxima) : null; });
        var gustMaxima = buckets.map(function (bucket) { return bucket.gustMaxima.length ? Math.max.apply(null, bucket.gustMaxima) : null; });
        var sin = buckets.reduce(function (sum, bucket) { return sum + bucket.directionSin; }, 0);
        var cos = buckets.reduce(function (sum, bucket) { return sum + bucket.directionCos; }, 0);
        var direction = degreesFromVector(sin, cos);
        return {
          month:monthIndex,
          label:name,
          yearsAvailable:buckets.length,
          temperatureMean:round(mean(tempMeans),1),
          temperatureMin:round(mean(tempMins),1),
          temperatureMax:round(mean(tempMaxs),1),
          precipitationMm:round(mean(rainfall),0),
          rainyDays:round(mean(rainDays),1),
          windMeanKmh:round(mean(windMeans),1),
          windDailyMaxMeanKmh:round(mean(windMaxima),1),
          windGustMaxMeanKmh:round(mean(gustMaxima),1),
          windDirectionDegrees:round(direction,0),
          windDirection:compassDirection(direction)
        };
      });
      if (monthly.filter(function (month) { return month.temperatureMean != null && month.precipitationMm != null; }).length < 10) {
        throw new Error('The historical record does not contain enough monthly climate observations.');
      }
      return {
        latitude:round(lat,4),
        longitude:round(lon,4),
        startYear:startYear,
        endYear:endYear,
        yearsRequested:years,
        monthly:monthly,
        source:'Open-Meteo Historical Weather API',
        sourceUrl:'https://open-meteo.com/en/docs/historical-weather-api',
        retrievedAt:new Date().toISOString(),
        note:'Historical point climate averages are a regional proxy, not a farm-level forecast or soil measurement.'
      };
    })();

    climateRequestCache[cacheKey] = promise;
    try {
      return await promise;
    } catch (error) {
      delete climateRequestCache[cacheKey];
      throw error;
    }
  }

  function rankPlantingWindows(monthlyClimate) {
    if (!Array.isArray(monthlyClimate) || monthlyClimate.length !== 12) {
      throw new Error('Twelve monthly climate summaries are required to rank planting windows.');
    }
    var monthNames = monthlyClimate.map(function (month) { return month.label; });
    return CROP_LIBRARY.map(function (crop) {
      var rule = CLIMATE_CROP_RULES[crop.id];
      if (!rule) return null;
      var windows = [];
      for (var start = 0; start < 12; start++) {
        var months = [];
        for (var offset = 0; offset < rule.months; offset++) {
          months.push(monthlyClimate[(start + offset) % 12]);
        }
        var temps = months.map(function (item) { return item.temperatureMean; }).filter(function (v) { return v != null; });
        var rains = months.map(function (item) { return item.precipitationMm; }).filter(function (v) { return v != null; });
        var winds = months.map(function (item) { return item.windMeanKmh; }).filter(function (v) { return v != null; });
        var gusts = months.map(function (item) { return item.windGustMaxMeanKmh; }).filter(function (v) { return v != null; });
        if (!temps.length || rains.length !== months.length) continue;
        var avgTemp = mean(temps);
        var totalRain = rains.reduce(function (sum, value) { return sum + value; }, 0);
        var avgWind = mean(winds);
        var peakGust = gusts.length ? Math.max.apply(null, gusts) : null;
        var tempScore = avgTemp >= rule.tempMin && avgTemp <= rule.tempMax ? 50 :
          (avgTemp >= rule.tempMin - 3 && avgTemp <= rule.tempMax + 3 ? 28 : 6);
        var rainScore = totalRain >= rule.rainMin && totalRain <= rule.rainMax ? 50 :
          (totalRain >= rule.rainMin * 0.70 && totalRain <= rule.rainMax * 1.30 ? 28 : 6);
        var cautions = [];
        var reasons = [];
        if (tempScore === 50) reasons.push('The average temperature across the establishment window is within the broad screening band (' + rule.tempMin + '–' + rule.tempMax + ' °C).');
        else if (tempScore === 28) cautions.push('Average temperature is near but outside the broad screening band; variety, altitude and local extension guidance may change the result.');
        else cautions.push('Average temperature is well outside this crop’s broad screening band; local verification is essential.');
        if (rainScore === 50) reasons.push('Historical average rainfall across the ' + rule.months + '-month establishment window is within the provisional screen (' + rule.rainMin + '–' + rule.rainMax + ' mm).');
        else if (rainScore === 28) cautions.push('Rainfall is near but outside the broad window. Irrigation, soil moisture, drainage and the exact crop calendar may change suitability.');
        else cautions.push('Rainfall is outside this broad window; investigate dry spells, water supply, flooding and drainage before planting.');
        if (avgWind != null && avgWind >= 25) cautions.push('Average wind is around 25 km/h or higher. This is a generic exposure flag, not a crop-specific wind tolerance threshold.');
        if (peakGust != null && peakGust >= 50) cautions.push('Historical monthly maximum gusts average at least 50 km/h. Check local storm exposure, staking and windbreak needs.');
        var rainDays = mean(months.map(function (item) { return item.rainyDays; }));
        windows.push({
          month:monthNames[start] || monthlyClimate[start].label,
          monthIndex:start,
          durationMonths:rule.months,
          avgTemperatureC:round(avgTemp,1),
          minTemperatureC:round(Math.min.apply(null, temps),1),
          maxTemperatureC:round(Math.max.apply(null, temps),1),
          totalRainMm:round(totalRain,0),
          avgRainDaysPerMonth:round(rainDays,1),
          avgWindKmh:round(avgWind,1),
          maxGustKmh:round(peakGust,1),
          windWarning:(avgWind != null && avgWind >= 25) || (peakGust != null && peakGust >= 50),
          score:tempScore + rainScore,
          reasons:reasons,
          cautions:cautions
        });
      }
      windows.sort(function (a, b) {
        return b.score - a.score || (a.windWarning === b.windWarning ? 0 : (a.windWarning ? 1 : -1)) ||
          a.monthIndex - b.monthIndex;
      });
      var selectedWindows = [];
      windows.forEach(function (window) {
        if (selectedWindows.length >= 3) return;
        var spaced = selectedWindows.every(function (selected) {
          var diff = Math.abs(selected.monthIndex - window.monthIndex);
          return Math.min(diff, 12 - diff) >= 2;
        });
        if (spaced) selectedWindows.push(window);
      });
      if (!selectedWindows.length) selectedWindows = windows.slice(0,3);
      return Object.assign({}, crop, {
        climateRule:rule,
        bestWindows:selectedWindows,
        bestWindow:selectedWindows[0] || null,
        climateScore:selectedWindows.length ? selectedWindows[0].score : 0,
        climateProfile:'provisional temperature and rainfall window'
      });
    }).filter(Boolean).sort(function (a, b) {
      return b.climateScore - a.climateScore || a.name.localeCompare(b.name);
    }).slice(0,8);
  }

  // Country-aware plant names via the public GBIF Species API.
  // Crop labels authored in this app remain the English display baseline;
  // vernacular names are shown only when a published source record is returned.
  var COUNTRY_LOCALIZATION = {
    IDN:{iso2:'ID',languages:['id'],label:'Indonesian',names:['indonesia']},
    TLS:{iso2:'TL',languages:['tet','pt'],label:'Tetum / Portuguese',names:['timor leste','east timor','timor leste']},
    MYS:{iso2:'MY',languages:['ms'],label:'Malay',names:['malaysia']},
    SGP:{iso2:'SG',languages:['en','ms','zh','ta'],label:'Singapore languages',names:['singapore']},
    BRN:{iso2:'BN',languages:['ms'],label:'Malay',names:['brunei darussalam','brunei']},
    PHL:{iso2:'PH',languages:['fil','tl','en'],label:'Filipino / Tagalog',names:['philippines']},
    THA:{iso2:'TH',languages:['th'],label:'Thai',names:['thailand']},
    VNM:{iso2:'VN',languages:['vi'],label:'Vietnamese',names:['viet nam','vietnam']},
    KHM:{iso2:'KH',languages:['km'],label:'Khmer',names:['cambodia']},
    LAO:{iso2:'LA',languages:['lo'],label:'Lao',names:['lao peoples democratic republic','laos']},
    MMR:{iso2:'MM',languages:['my'],label:'Burmese',names:['myanmar']},
    CHN:{iso2:'CN',languages:['zh'],label:'Chinese',names:['china']},
    JPN:{iso2:'JP',languages:['ja'],label:'Japanese',names:['japan']},
    KOR:{iso2:'KR',languages:['ko'],label:'Korean',names:['republic of korea','south korea']},
    PRK:{iso2:'KP',languages:['ko'],label:'Korean',names:['democratic peoples republic of korea','north korea']},
    IND:{iso2:'IN',languages:['hi','bn','ta','te','mr'],label:'Indian language (varies by region)',names:['india']},
    BGD:{iso2:'BD',languages:['bn'],label:'Bengali',names:['bangladesh']},
    PAK:{iso2:'PK',languages:['ur','pa'],label:'Urdu / Punjabi',names:['pakistan']},
    NPL:{iso2:'NP',languages:['ne'],label:'Nepali',names:['nepal']},
    LKA:{iso2:'LK',languages:['si','ta'],label:'Sinhala / Tamil',names:['sri lanka']},
    BTN:{iso2:'BT',languages:['dz'],label:'Dzongkha',names:['bhutan']},
    MDV:{iso2:'MV',languages:['dv'],label:'Dhivehi',names:['maldives']},
    RUS:{iso2:'RU',languages:['ru'],label:'Russian',names:['russian federation','russia']},
    KAZ:{iso2:'KZ',languages:['kk','ru'],label:'Kazakh / Russian',names:['kazakhstan']},
    UZB:{iso2:'UZ',languages:['uz','ru'],label:'Uzbek / Russian',names:['uzbekistan']},
    KGZ:{iso2:'KG',languages:['ky','ru'],label:'Kyrgyz / Russian',names:['kyrgyzstan']},
    TJK:{iso2:'TJ',languages:['tg','ru'],label:'Tajik / Russian',names:['tajikistan']},
    TKM:{iso2:'TM',languages:['tk','ru'],label:'Turkmen / Russian',names:['turkmenistan']},
    MNG:{iso2:'MN',languages:['mn'],label:'Mongolian',names:['mongolia']},
    TUR:{iso2:'TR',languages:['tr'],label:'Turkish',names:['turkiye','turkey']},
    IRN:{iso2:'IR',languages:['fa'],label:'Persian',names:['iran islamic republic of','iran']},
    IRQ:{iso2:'IQ',languages:['ar','ku'],label:'Arabic / Kurdish',names:['iraq']},
    SAU:{iso2:'SA',languages:['ar'],label:'Arabic',names:['saudi arabia']},
    ARE:{iso2:'AE',languages:['ar'],label:'Arabic',names:['united arab emirates']},
    EGY:{iso2:'EG',languages:['ar'],label:'Arabic',names:['egypt']},
    ETH:{iso2:'ET',languages:['am'],label:'Amharic',names:['ethiopia']},
    KEN:{iso2:'KE',languages:['sw','en'],label:'Swahili / English',names:['kenya']},
    TZA:{iso2:'TZ',languages:['sw','en'],label:'Swahili / English',names:['united republic of tanzania','tanzania']},
    UGA:{iso2:'UG',languages:['sw','en'],label:'Swahili / English',names:['uganda']},
    RWA:{iso2:'RW',languages:['rw','fr','en'],label:'Kinyarwanda / French / English',names:['rwanda']},
    BDI:{iso2:'BI',languages:['rn','fr'],label:'Kirundi / French',names:['burundi']},
    ZAF:{iso2:'ZA',languages:['zu','af','en','xh'],label:'South African languages',names:['south africa']},
    NGA:{iso2:'NG',languages:['en','ha','yo','ig'],label:'Nigerian languages',names:['nigeria']},
    GHA:{iso2:'GH',languages:['en','tw'],label:'English / Akan',names:['ghana']},
    SEN:{iso2:'SN',languages:['fr','wo'],label:'French / Wolof',names:['senegal']},
    CIV:{iso2:'CI',languages:['fr'],label:'French',names:['cote d ivoire','ivory coast']},
    MAR:{iso2:'MA',languages:['ar','fr'],label:'Arabic / French',names:['morocco']},
    DZA:{iso2:'DZ',languages:['ar','fr'],label:'Arabic / French',names:['algeria']},
    TUN:{iso2:'TN',languages:['ar','fr'],label:'Arabic / French',names:['tunisia']},
    FRA:{iso2:'FR',languages:['fr'],label:'French',names:['france']},
    DEU:{iso2:'DE',languages:['de'],label:'German',names:['germany']},
    ESP:{iso2:'ES',languages:['es'],label:'Spanish',names:['spain']},
    PRT:{iso2:'PT',languages:['pt'],label:'Portuguese',names:['portugal']},
    ITA:{iso2:'IT',languages:['it'],label:'Italian',names:['italy']},
    NLD:{iso2:'NL',languages:['nl'],label:'Dutch',names:['netherlands']},
    BEL:{iso2:'BE',languages:['nl','fr','de'],label:'Dutch / French / German',names:['belgium']},
    CHE:{iso2:'CH',languages:['de','fr','it'],label:'Swiss languages',names:['switzerland']},
    AUT:{iso2:'AT',languages:['de'],label:'German',names:['austria']},
    POL:{iso2:'PL',languages:['pl'],label:'Polish',names:['poland']},
    UKR:{iso2:'UA',languages:['uk'],label:'Ukrainian',names:['ukraine']},
    CZE:{iso2:'CZ',languages:['cs'],label:'Czech',names:['czechia','czech republic']},
    SVK:{iso2:'SK',languages:['sk'],label:'Slovak',names:['slovakia']},
    HUN:{iso2:'HU',languages:['hu'],label:'Hungarian',names:['hungary']},
    ROU:{iso2:'RO',languages:['ro'],label:'Romanian',names:['romania']},
    BGR:{iso2:'BG',languages:['bg'],label:'Bulgarian',names:['bulgaria']},
    GRC:{iso2:'GR',languages:['el'],label:'Greek',names:['greece']},
    NOR:{iso2:'NO',languages:['no','nb'],label:'Norwegian',names:['norway']},
    SWE:{iso2:'SE',languages:['sv'],label:'Swedish',names:['sweden']},
    FIN:{iso2:'FI',languages:['fi','sv'],label:'Finnish / Swedish',names:['finland']},
    DNK:{iso2:'DK',languages:['da'],label:'Danish',names:['denmark']},
    ISL:{iso2:'IS',languages:['is'],label:'Icelandic',names:['iceland']},
    IRL:{iso2:'IE',languages:['ga','en'],label:'Irish / English',names:['ireland']},
    GBR:{iso2:'GB',languages:['en'],label:'English',names:['united kingdom']},
    USA:{iso2:'US',languages:['en'],label:'English',names:['united states','united states of america']},
    CAN:{iso2:'CA',languages:['en','fr'],label:'English / French',names:['canada']},
    MEX:{iso2:'MX',languages:['es'],label:'Spanish',names:['mexico']},
    GTM:{iso2:'GT',languages:['es'],label:'Spanish',names:['guatemala']},
    CRI:{iso2:'CR',languages:['es'],label:'Spanish',names:['costa rica']},
    PAN:{iso2:'PA',languages:['es'],label:'Spanish',names:['panama']},
    COL:{iso2:'CO',languages:['es'],label:'Spanish',names:['colombia']},
    PER:{iso2:'PE',languages:['es','qu'],label:'Spanish / Quechua',names:['peru']},
    BOL:{iso2:'BO',languages:['es','ay','qu'],label:'Spanish / Indigenous languages',names:['bolivia plurinational state of','bolivia']},
    CHL:{iso2:'CL',languages:['es'],label:'Spanish',names:['chile']},
    ARG:{iso2:'AR',languages:['es'],label:'Spanish',names:['argentina']},
    URY:{iso2:'UY',languages:['es'],label:'Spanish',names:['uruguay']},
    PRY:{iso2:'PY',languages:['es','gn'],label:'Spanish / Guarani',names:['paraguay']},
    BRA:{iso2:'BR',languages:['pt'],label:'Portuguese',names:['brazil']},
    AUS:{iso2:'AU',languages:['en'],label:'English',names:['australia']},
    NZL:{iso2:'NZ',languages:['en','mi'],label:'English / Māori',names:['new zealand']},
    PNG:{iso2:'PG',languages:['en','tpi'],label:'English / Tok Pisin',names:['papua new guinea']},
    FJI:{iso2:'FJ',languages:['en','fj'],label:'Fijian / English',names:['fiji']},
    WSM:{iso2:'WS',languages:['sm'],label:'Samoan',names:['samoa']},
    TON:{iso2:'TO',languages:['to'],label:'Tongan',names:['tonga']}
  };
  var GBIF_TAXON_CACHE = {};
  var GBIF_VERNACULAR_CACHE = {};

  function normalizeLanguageCode(value) {
    if (value && typeof value === 'object') value = value.code || value.isoCode || value.name || '';
    var code = String(value || '').trim().toLowerCase();
    var aliases = {
      eng:'en',ind:'id',indonesian:'id',por:'pt',fra:'fr',fre:'fr',deu:'de',ger:'de',
      spa:'es',ita:'it',rus:'ru',zho:'zh',chi:'zh',jpn:'ja',jpn:'ja',kor:'ko',
      tha:'th',vie:'vi',tuk:'tk',ara:'ar',fas:'fa',per:'fa',urd:'ur',ben:'bn',
      hin:'hi',tam:'ta',tel:'te',msa:'ms',may:'ms',fil:'fil',tgl:'tl',swa:'sw',
      cym:'cy',wel:'cy',ell:'el',gre:'el',nld:'nl',dut:'nl',nor:'no',nob:'nb'
    };
    return aliases[code] || code;
  }

  function localizedValue(value) {
    if (value && typeof value === 'object') return value.title || value.name || value.code || '';
    return value == null ? '' : String(value);
  }

  function languageLabel(code) {
    var labels = {
      en:'English',id:'Indonesian',tet:'Tetum',pt:'Portuguese',ms:'Malay',fil:'Filipino',tl:'Tagalog',
      th:'Thai',vi:'Vietnamese',km:'Khmer',lo:'Lao',my:'Burmese',zh:'Chinese',ja:'Japanese',ko:'Korean',
      hi:'Hindi',bn:'Bengali',ta:'Tamil',te:'Telugu',ne:'Nepali',si:'Sinhala',ur:'Urdu',ru:'Russian',
      kk:'Kazakh',uz:'Uzbek',ky:'Kyrgyz',tg:'Tajik',tk:'Turkmen',mn:'Mongolian',tr:'Turkish',fa:'Persian',
      ar:'Arabic',sw:'Swahili',am:'Amharic',zu:'Zulu',af:'Afrikaans',xh:'Xhosa',ha:'Hausa',yo:'Yoruba',
      ig:'Igbo',fr:'French',de:'German',es:'Spanish',it:'Italian',nl:'Dutch',pl:'Polish',uk:'Ukrainian',
      cs:'Czech',sk:'Slovak',hu:'Hungarian',ro:'Romanian',bg:'Bulgarian',el:'Greek',no:'Norwegian',
      nb:'Norwegian Bokmål',sv:'Swedish',fi:'Finnish',da:'Danish',is:'Icelandic',ga:'Irish',qu:'Quechua',
      ay:'Aymara',gn:'Guarani',mi:'Māori',tpi:'Tok Pisin',fj:'Fijian',sm:'Samoan',to:'Tongan'
    };
    return labels[normalizeLanguageCode(code)] || String(code || '').toUpperCase() || 'Other language';
  }

  function getCountryLanguagePreference(iso3) {
    var key = String(iso3 || '').toUpperCase();
    var entry = COUNTRY_LOCALIZATION[key];
    return entry ? {
      iso3:key, iso2:entry.iso2, languages:entry.languages.slice(),
      label:entry.label, countryNames:entry.names.slice()
    } : {
      iso3:key, iso2:'', languages:[], label:'local language for this country', countryNames:[]
    };
  }

  function getCropCatalog() {
    return CROP_LIBRARY.map(function (crop) {
      return Object.assign({}, crop, {
        localNameIndonesian:crop.local,
        englishName:crop.name,
        scientificName:crop.scientific
      });
    });
  }

  function taxonCacheKey(scientificName) {
    return String(scientificName || '').trim().toLowerCase();
  }

  async function loadGbifTaxon(crop) {
    var scientific = String(crop && (crop.scientificName || crop.scientific) || '').trim();
    var key = taxonCacheKey(scientific);
    if (!scientific || /\b(spp?\.?|sp\.)\b|\/|\bvegetables\b/i.test(scientific) || !/^[A-Z][a-z-]+\s+[a-z][a-z-]+$/.test(scientific)) {
      return {
        key:null, scientificName:scientific, rank:'UNRESOLVED_GROUP',
        canonicalName:scientific, sourceUrl:'https://www.gbif.org/species/search?q=' + encodeURIComponent(scientific),
        vernacularNames:[], matchType:'NOT_QUERIED'
      };
    }
    if (GBIF_TAXON_CACHE[key]) return GBIF_TAXON_CACHE[key];
    var pending = (async function () {
      var url = 'https://api.gbif.org/v1/species/match?name=' + encodeURIComponent(scientific) +
        '&rank=SPECIES&strict=true&kingdom=Plantae';
      var match = await requestJSON(url);
      var usageKey = match && (match.usageKey || match.key);
      var rank = String(match && (match.rank || match.usage && match.usage.rank) || '').toUpperCase();
      if (!usageKey || (rank && rank !== 'SPECIES')) {
        return {
          key:null, scientificName:scientific, rank:rank || 'UNMATCHED',
          canonicalName:scientific, sourceUrl:'https://www.gbif.org/species/search?q=' + encodeURIComponent(scientific),
          vernacularNames:[], matchType:'UNMATCHED'
        };
      }
      var acceptedName = match.canonicalName || match.scientificName || scientific;
      var vernacularNames = [];
      if (GBIF_VERNACULAR_CACHE[String(usageKey)]) {
        vernacularNames = await GBIF_VERNACULAR_CACHE[String(usageKey)];
      } else {
        var namesPromise = requestJSON('https://api.gbif.org/v1/species/' + encodeURIComponent(String(usageKey)) + '/vernacularNames?limit=1000');
        GBIF_VERNACULAR_CACHE[String(usageKey)] = namesPromise;
        try {
          var namesResponse = await namesPromise;
          vernacularNames = rowsFrom(namesResponse);
          GBIF_VERNACULAR_CACHE[String(usageKey)] = Promise.resolve(vernacularNames);
        } catch (error) {
          delete GBIF_VERNACULAR_CACHE[String(usageKey)];
          throw error;
        }
      }
      return {
        key:usageKey, scientificName:acceptedName, rank:rank || 'SPECIES',
        canonicalName:acceptedName, sourceUrl:'https://www.gbif.org/species/' + encodeURIComponent(String(usageKey)),
        vernacularNames:vernacularNames, matchType:match.matchType || 'MATCH'
      };
    })();
    GBIF_TAXON_CACHE[key] = pending;
    try {
      var result = await pending;
      GBIF_TAXON_CACHE[key] = Promise.resolve(result);
      return result;
    } catch (error) {
      delete GBIF_TAXON_CACHE[key];
      throw error;
    }
  }

  function resolveCropTaxonomyName(taxon, crop, iso3, countryName) {
    var pref = getCountryLanguagePreference(iso3);
    var names = Array.isArray(taxon.vernacularNames) ? taxon.vernacularNames : [];
    function nameInfo(record) {
      var language = normalizeLanguageCode(record.language);
      var country = record.country;
      var countryCode = '';
      var countryTitle = '';
      if (country && typeof country === 'object') {
        countryCode = String(country.code || country.iso2 || country.isoCode || '').trim().toUpperCase();
        countryTitle = String(country.title || country.name || '').trim();
      } else if (country) {
        var text = String(country).trim();
        if (/^[A-Za-z]{2,3}$/.test(text)) countryCode = text.toUpperCase();
        else countryTitle = text;
      }
      var countryMatches = !!(
        (pref.iso2 && countryCode && (countryCode === pref.iso2 || countryCode === iso3)) ||
        [countryTitle].concat(pref.countryNames).some(function (item) {
          return item && pref.countryNames.concat([countryName || '']).some(function (candidate) {
            return candidate && String(item).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() ===
              String(candidate).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
          });
        })
      );
      var langIndex = pref.languages.indexOf(language);
      return {
        record:record,
        language:language,
        languageLabel:languageLabel(language),
        vernacularName:String(record.vernacularName || record.name || '').trim(),
        countryMatches:countryMatches,
        languageIndex:langIndex,
        languageMatches:langIndex >= 0
      };
    }
    var candidates = names.map(nameInfo).filter(function (item) { return !!item.vernacularName; });
    candidates.sort(function (a,b) {
      function score(item) {
        var total = 0;
        if (item.countryMatches) total += 100;
        if (item.languageMatches) total += 30 - Math.max(item.languageIndex,0);
        if (item.language === 'en') total -= 4;
        return total;
      }
      return score(b)-score(a) || a.vernacularName.localeCompare(b.vernacularName);
    });
    var preferred = candidates.find(function (item) { return item.countryMatches; }) ||
      candidates.find(function (item) { return item.languageMatches; }) ||
      candidates.find(function (item) { return item.language === 'en'; }) ||
      candidates[0] || null;
    var localName = preferred ? preferred.vernacularName : '';
    var localLabel = preferred ? preferred.languageLabel :
      (pref.label || 'Local language');
    var nameOrigin = preferred ? (
      preferred.countryMatches ? 'GBIF vernacular record associated with the selected country' :
      preferred.languageMatches ? 'GBIF vernacular record in a preferred language; country association not verified' :
      'GBIF vernacular name; country association not verified'
    ) : 'No matching published vernacular name found';
    if (!localName && String(iso3 || '').toUpperCase() === 'IDN' && crop.local) {
      localName = crop.local;
      localLabel = 'Indonesian';
      nameOrigin = 'BackToNature curated Indonesian common name; verify locally';
    }
    return {
      cropId:crop.id || '',
      englishName:crop.englishName || crop.name || crop.commonName || '',
      localName:localName,
      localLanguage:localLabel,
      localLanguageCode:preferred ? preferred.language : (String(iso3).toUpperCase() === 'IDN' ? 'id' : ''),
      localNameSource: nameOrigin,
      scientificName:taxon.scientificName || crop.scientificName || crop.scientific || '',
      rank:taxon.rank || 'UNVERIFIED',
      gbifKey:taxon.key || null,
      sourceUrl:taxon.sourceUrl || '',
      source:'GBIF Backbone Taxonomy / Vernacular Names API'
    };
  }

  async function fetchCropTaxonomy(cropOrId, countryIso3, countryName) {
    var crop = typeof cropOrId === 'string'
      ? CROP_LIBRARY.find(function (item) { return item.id === cropOrId; })
      : cropOrId;
    if (!crop) throw new Error('Unknown crop record.');
    var taxon;
    try {
      taxon = await loadGbifTaxon(crop);
    } catch (error) {
      return Object.assign(resolveCropTaxonomyName({
        key:null, scientificName:crop.scientificName || crop.scientific,
        rank:'UNVERIFIED', sourceUrl:'https://www.gbif.org/species/search?q=' + encodeURIComponent(crop.scientific || crop.name),
        vernacularNames:[]
      }, crop, countryIso3, countryName), {
        status:'source-unavailable',
        error:error && error.message ? error.message : 'GBIF taxonomy lookup failed.'
      });
    }
    var resolved = resolveCropTaxonomyName(taxon,crop,countryIso3,countryName);
    resolved.status = taxon.key ? 'matched' : taxon.matchType === 'NOT_QUERIED' ? 'broad-group' : 'no-match';
    resolved.matchType = taxon.matchType;
    return resolved;
  }

  window.BackToNatureAPI = {
    fetchIndonesiaLandUse: fetchIndonesiaLandUse,
    searchFaoCatalog: searchFaoCatalog,
    fetchWocatTechnologies: fetchWocatTechnologies,
    listCropRecommendations: listCropRecommendations,
    searchPlantImages: searchPlantImages,
    fetchHistoricalClimate: fetchHistoricalClimate,
    rankPlantingWindows: rankPlantingWindows,
    getCropCatalog: getCropCatalog,
    getCountryLanguagePreference: getCountryLanguagePreference,
    fetchCropTaxonomy: fetchCropTaxonomy
  };
})();