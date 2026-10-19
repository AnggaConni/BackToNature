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
    {id:'pineapple', name:'Pineapple', local:'Nanas', scientific:'Ananas comosus', category:'fruit', soils:['sandy','loam','acidic'], phMin:4.5, phMax:6.5, drainage:['well'], water:['seasonal','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical'], uses:['fruit','market'], note:'Often tolerates acidic soils better than many crops and requires good drainage.', caution:'Do not expand onto natural peatlands or clear sensitive ecosystems just because acidity appears suitable.'},
    {id:'sago', name:'Sago Palm', local:'Sagu', scientific:'Metroxylon sagu', category:'perennial', soils:['peat','alluvial'], phMin:4.0, phMax:6.5, drainage:['moderate','waterlogged'], water:['standing','reliable'], climates:['humid-tropical'], uses:['staple','market'], note:'A wet-tropical starch crop associated with suitable swampy landscapes in parts of Southeast Asia and the Pacific.', caution:'Suitability depends on local ecology, land tenure and existing managed landscapes; do not drain or convert peat ecosystems.'},
    {id:'vetiver', name:'Vetiver Grass', local:'Akar wangi / vetiver', scientific:'Chrysopogon zizanioides', category:'restoration', soils:['sandy','loam','clay','volcanic','acidic','alluvial'], phMin:4.0, phMax:8.0, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical','subtropical'], uses:['restoration'], note:'A candidate for contour hedges and erosion-control trials where locally appropriate; it is not a food crop.', caution:'Use a non-invasive, locally approved variety and design erosion-control measures for the actual slope and flow path.'},
    {id:'sunn-hemp', name:'Sunn Hemp', local:'Crotalaria / sunn hemp', scientific:'Crotalaria juncea', category:'cover-crop', soils:['sandy','loam','volcanic','alluvial'], phMin:5.0, phMax:7.5, drainage:['well','moderate'], water:['seasonal','limited','reliable'], climates:['humid-tropical','seasonal-tropical','dry-tropical'], uses:['restoration'], note:'A warm-season cover/green-manure legume candidate for suitable rotations and soil-cover goals.', caution:'Check local regulations, toxicity to livestock, seed availability and avoid use where it could escape cultivation.'}
  ];

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

  window.BackToNatureAPI = {
    fetchIndonesiaLandUse: fetchIndonesiaLandUse,
    searchFaoCatalog: searchFaoCatalog,
    fetchWocatTechnologies: fetchWocatTechnologies,
    listCropRecommendations: listCropRecommendations,
    searchPlantImages: searchPlantImages
  };
})();