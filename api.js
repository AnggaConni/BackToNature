/* BackToNature — data service layer used by the provincial fieldbook.
 * Credentials are passed per request and never persisted in this module.
 */
(function () {
  'use strict';

  var FAOSTAT_BASE = 'https://fenixservices.fao.org/faostat/api/v1';
  var WOCAT_BASE = 'https://qcat.wocat.net/en/api/v2/questionnaires/';
  var FAO_CSW = 'https://data.apps.fao.org/map/catalog/srv/eng/csw';
  var crossrefSearchCache = Object.create(null);

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
    {id:'clove', name:'Clove', local:'Cengkeh', scientific:'Syzygium aromaticum', category:'perennial', soils:['loam','volcanic','alluvial'], phMin:5.0, phMax:7.0, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A tropical perennial spice candidate for suitable humid settings and locally adapted elevations.', caution:'Confirm local cultivar, rainfall pattern during flowering, shade, disease pressure and post-harvest drying.'},
    {id:'durian', name:'Durian', local:'Durian', scientific:'Durio zibethinus', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:5.0, phMax:6.5, drainage:['well'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['fruit','market'], note:'Usually considered in warm humid regions with deep, well-drained soil and dependable moisture.', caution:'Avoid waterlogged sites; assess tree spacing, pollination, storm exposure, local cultivar and market logistics.'},
    {id:'rubber', name:'Rubber Tree', local:'Karet', scientific:'Hevea brasiliensis', category:'perennial', soils:['loam','acidic','alluvial'], phMin:4.0, phMax:6.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A tropical plantation tree candidate only where rainfall, soil depth, slope and local livelihood conditions fit.', caution:'Check land-use safeguards, erosion risk, disease, price exposure and avoid conversion of natural forest or peatland.'},
    {id:'cinnamon', name:'Indonesian Cinnamon', local:'Kayu manis', scientific:'Cinnamomum burmannii', category:'perennial', soils:['loam','volcanic','acidic'], phMin:4.5, phMax:6.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','highland-tropical'], uses:['market'], note:'A regional spice-tree candidate often grown in humid tropical uplands where local conditions and markets support it.', caution:'Confirm species identity, local growing requirements, harvest method and regeneration practices.'},
    {id:'black-pepper', name:'Black Pepper', local:'Lada', scientific:'Piper nigrum', category:'perennial', soils:['loam','volcanic','alluvial'], phMin:5.0, phMax:6.5, drainage:['well'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A climbing spice crop needing support, moisture and drainage in an appropriate warm humid climate.', caution:'Check local disease risks, especially root diseases, plus support-tree and labour requirements.'},
    {id:'nutmeg', name:'Nutmeg', local:'Pala', scientific:'Myristica fragrans', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:5.0, phMax:6.5, drainage:['well','moderate'], water:['reliable'], climates:['humid-tropical'], uses:['market'], note:'A tropical perennial spice tree considered in humid settings with deep soils and consistent moisture.', caution:'Verify local suitability, pollination/sex of planting material, disease risks and processing access.'},
    {id:'oil-palm', name:'Oil Palm', local:'Kelapa sawit', scientific:'Elaeis guineensis', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:4.0, phMax:6.5, drainage:['well','moderate'], water:['reliable'], climates:['humid-tropical'], uses:['market'], note:'A high-input perennial commodity crop requiring humid climate, suitable land and supply-chain access.', caution:'Suitability must never justify clearing natural forest, draining peatland, or encroaching on protected/community land. Assess water impacts and responsible-sourcing rules.'},
    {id:'areca-palm', name:'Areca Palm / Betel Nut', local:'Pinang', scientific:'Areca catechu', category:'perennial', soils:['loam','alluvial','volcanic'], phMin:5.0, phMax:7.0, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A tropical palm grown in suitable warm, moist regions; local use and markets vary.', caution:'Check local market context, planting material and diversified agroforestry options.'},
    {id:'sugarcane', name:'Sugarcane', local:'Tebu', scientific:'Saccharum officinarum', category:'staple', soils:['loam','clay','alluvial','volcanic'], phMin:5.0, phMax:8.0, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical','subtropical'], uses:['market'], note:'A long-duration crop needing a suitable growing season, moisture, nutrients and harvesting/processing access.', caution:'Check irrigation demand, dry-season supply, slope erosion and access to a mill or buyer before planting.'},
    {id:'tea', name:'Tea', local:'Teh', scientific:'Camellia sinensis', category:'perennial', soils:['loam','volcanic','acidic'], phMin:4.0, phMax:5.5, drainage:['well'], water:['reliable'], climates:['highland-tropical','subtropical'], uses:['market'], note:'A perennial shrub usually associated with suitable cooler and humid highland conditions and acidic soil.', caution:'Confirm elevation-specific temperature, soil acidity, plucking labour and local processing access.'},
    {id:'shallot', name:'Shallot', local:'Bawang merah', scientific:'Allium cepa', category:'vegetable', soils:['loam','sandy','alluvial','volcanic'], phMin:5.5, phMax:7.0, drainage:['well'], water:['reliable','seasonal'], climates:['seasonal-tropical','dry-tropical','subtropical'], uses:['vegetable','market'], note:'Shallot types need well-drained soil, healthy planting bulbs and a crop calendar suited to local rainfall.', caution:'The accepted taxon covers cultivated onion groups; confirm local shallot variety and avoid prolonged wet foliage/soil conditions.'},
    {id:'coffee-liberica', name:'Liberica Coffee', local:'Kopi Liberika', scientific:'Coffea liberica', category:'perennial', soils:['loam','alluvial','acidic'], phMin:4.5, phMax:6.5, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['market'], note:'A coffee species grown in some tropical lowland and humid settings, including specific Southeast Asian production zones.', caution:'Confirm local ecotype, flood/drought tolerance, harvest quality and buyer demand before expansion.'},
    {id:'salak', name:'Snake Fruit', local:'Salak', scientific:'Salacca zalacca', category:'perennial', soils:['loam','volcanic','alluvial'], phMin:5.0, phMax:7.0, drainage:['well','moderate'], water:['reliable','seasonal'], climates:['humid-tropical','seasonal-tropical'], uses:['fruit','market'], note:'A tropical fruit palm that is grown in locally suitable humid environments and production systems.', caution:'Check cultivar, pollination, shade, drainage, harvesting safety and market access.'},
    {id:'tobacco', name:'Tobacco', local:'Tembakau', scientific:'Nicotiana tabacum', category:'cash-crop', soils:['sandy','loam','alluvial'], phMin:5.0, phMax:7.0, drainage:['well'], water:['seasonal','reliable'], climates:['seasonal-tropical','dry-tropical','subtropical','temperate'], uses:['market'], note:'A commercial crop with strict variety and curing requirements; suitable conditions vary strongly by production type.', caution:'Consider health impacts, farm-worker protections, input costs and market/regulatory risks before production.'},
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
    'clove': {months:6,tempMin:22,tempMax:32,rainMin:500,rainMax:1400},
    'durian': {months:6,tempMin:22,tempMax:32,rainMin:600,rainMax:1600},
    'rubber': {months:6,tempMin:22,tempMax:32,rainMin:500,rainMax:1400},
    'cinnamon': {months:6,tempMin:18,tempMax:30,rainMin:450,rainMax:1300},
    'black-pepper': {months:6,tempMin:22,tempMax:32,rainMin:600,rainMax:1600},
    'nutmeg': {months:6,tempMin:22,tempMax:32,rainMin:600,rainMax:1600},
    'oil-palm': {months:12,tempMin:24,tempMax:32,rainMin:1200,rainMax:3000},
    'areca-palm': {months:6,tempMin:22,tempMax:32,rainMin:600,rainMax:1600},
    'sugarcane': {months:10,tempMin:20,tempMax:35,rainMin:700,rainMax:1800},
    'tea': {months:6,tempMin:15,tempMax:28,rainMin:900,rainMax:2200},
    'shallot': {months:4,tempMin:18,tempMax:30,rainMin:150,rainMax:500},
    'coffee-liberica': {months:6,tempMin:22,tempMax:32,rainMin:700,rainMax:1800},
    'salak': {months:6,tempMin:22,tempMax:32,rainMin:500,rainMax:1400},
    'tobacco': {months:4,tempMin:18,tempMax:32,rainMin:150,rainMax:600},
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
          'wind_direction_10m_dominant',
          'et0_fao_evapotranspiration'
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
        'wind_gusts_10m_max','wind_direction_10m_dominant','et0_fao_evapotranspiration'
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
            precipitation:0, rainyDays:0, et0Values:[], windMeans:[], windMaxima:[], gustMaxima:[],
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
        if (values.et0_fao_evapotranspiration != null) bucket.et0Values.push(values.et0_fao_evapotranspiration);
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
        var monthlyEt0 = buckets.map(function (bucket) { return bucket.et0Values.reduce(function (sum, value) { return sum + value; }, 0); });
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
          referenceEt0Mm:round(mean(monthlyEt0),0),
          waterBalanceMm:(mean(rainfall) != null && mean(monthlyEt0) != null) ? round(mean(rainfall)-mean(monthlyEt0),0) : null,
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

      // Assess the current local calendar month against every establishment window
      // that includes it. This remains a historical climate screen, not a field calendar.
      var currentMonthIndex = new Date().getMonth();
      // The recommendation asks whether the user should START planting now.
      // Score only the establishment window that begins this month; do not mark a
      // crop "suitable now" just because this month falls inside a window that began earlier.
      var currentMonthWindows = windows.filter(function (window) {
        return window.monthIndex === currentMonthIndex;
      }).sort(function (a, b) {
        return b.score - a.score || (a.windWarning === b.windWarning ? 0 : (a.windWarning ? 1 : -1));
      });
      var currentMonthWindow = currentMonthWindows[0] || null;
      var currentMonthStatus = !currentMonthWindow ? 'unknown' :
        (currentMonthWindow.score === 100 && !currentMonthWindow.windWarning ? 'suitable' :
          (currentMonthWindow.score >= 78 ? 'caution' : 'wait'));

      return Object.assign({}, crop, {
        climateRule:rule,
        bestWindows:selectedWindows,
        bestWindow:selectedWindows[0] || null,
        climateScore:selectedWindows.length ? selectedWindows[0].score : 0,
        currentMonthIndex:currentMonthIndex,
        currentMonthStatus:currentMonthStatus,
        currentMonthWindow:currentMonthWindow,
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
      var expectedCountryNames = pref.countryNames.concat([countryName || ''])
        .map(function (item) { return String(item || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); })
        .filter(Boolean);
      var normalizedRecordCountry = String(countryTitle || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      var countryMatches = !!(
        (pref.iso2 && countryCode && (countryCode === pref.iso2 || countryCode === iso3)) ||
        (normalizedRecordCountry && expectedCountryNames.indexOf(normalizedRecordCountry) >= 0)
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
    // Prefer an actual country + preferred-language record first, then a vernacular
    // in the selected country's expected language, and only then country-only records.
    var preferred = candidates.find(function (item) { return item.countryMatches && item.languageMatches; }) ||
      candidates.find(function (item) { return item.languageMatches; }) ||
      candidates.find(function (item) { return item.countryMatches; }) ||
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


  // Lightweight live nature and climate connectors. Results are cached for this page session.
  var occurrenceRequestCache = {};
  var iNaturalistRequestCache = {};
  var openMeteoOutlookCache = {};
  var nasaMonthlyRequestCache = {};
  var NASA_POWER_BASE = 'https://power.larc.nasa.gov/api/temporal/monthly/point';
  var GBIF_OCCURRENCE_BASE = 'https://api.gbif.org/v1/occurrence/search';
  var NATURE_MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function validateNatureCoordinates(latitude, longitude) {
    var lat = Number(latitude);
    var lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error('A valid latitude and longitude are required for this lookup.');
    }
    return { latitude:lat, longitude:lon };
  }

  function natureDistanceKm(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  async function fetchGbifOccurrences(latitude, longitude, requestedRadiusKm, requestedLimit, options) {
    var point = validateNatureCoordinates(latitude, longitude);
    var opts = options && typeof options === 'object' ? options : {};
    var plantOnly = opts.plantOnly === true;
    var forceRefresh = opts.forceRefresh === true;
    var radiusKm = Math.max(5, Math.min(100, Number(requestedRadiusKm) || 25));
    var limit = Math.max(1, Math.min(20, Math.round(Number(requestedLimit) || 12)));
    var cacheKey = point.latitude.toFixed(3) + ',' + point.longitude.toFixed(3) + ':' + radiusKm + ':' + limit + ':' + (plantOnly ? 'plants' : 'all');
    if (forceRefresh) delete occurrenceRequestCache[cacheKey];
    if (occurrenceRequestCache[cacheKey]) return occurrenceRequestCache[cacheKey];

    var promise = (async function () {
      // GBIF accepts coordinate range filters. Narrow the rectangular query to a
      // circle locally so returned records are actually within the displayed radius.
      var latDelta = radiusKm / 111.32;
      var cosLat = Math.max(0.05, Math.abs(Math.cos(point.latitude * Math.PI / 180)));
      var lonDelta = Math.min(180, radiusKm / (111.32 * cosLat));
      var minLat = Math.max(-90, point.latitude - latDelta);
      var maxLat = Math.min(90, point.latitude + latDelta);
      var minLon = Math.max(-180, point.longitude - lonDelta);
      var maxLon = Math.min(180, point.longitude + lonDelta);
      var params = new URLSearchParams({
        decimalLatitude:minLat.toFixed(5) + ',' + maxLat.toFixed(5),
        decimalLongitude:minLon.toFixed(5) + ',' + maxLon.toFixed(5),
        hasCoordinate:'true',
        hasGeospatialIssue:'false',
        limit:'300',
        offset:'0'
      });
      if (plantOnly) {
        params.set('kingdomKey', '6'); // GBIF Backbone key for Plantae.
        params.set('taxonRank', 'SPECIES');
      }
      var payload = await requestJSON(GBIF_OCCURRENCE_BASE + '?' + params.toString());
      var raw = Array.isArray(payload.results) ? payload.results : [];
      var records = raw.map(function (record) {
        if (record.decimalLatitude == null || record.decimalLongitude == null) return null;
        var lat = Number(record.decimalLatitude);
        var lon = Number(record.decimalLongitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        var distanceKm = natureDistanceKm(point.latitude, point.longitude, lat, lon);
        if (distanceKm > radiusKm) return null;
        var key = record.key != null ? String(record.key) : '';
        var taxonKey = record.taxonKey != null ? String(record.taxonKey) : '';
        return {
          key:key,
          taxonKey:taxonKey,
          scientificName:String(record.acceptedScientificName || record.scientificName || record.species || 'Unidentified taxon'),
          taxonRank:String(record.taxonRank || ''),
          vernacularName:String(record.vernacularName || ''),
          eventDate:String(record.eventDate || (record.year ? String(record.year) : '') || ''),
          locality:String(record.locality || record.verbatimLocality || record.stateProvince || ''),
          countryCode:String(record.countryCode || ''),
          basisOfRecord:String(record.basisOfRecord || ''),
          datasetName:String(record.datasetName || ''),
          latitude:lat,
          longitude:lon,
          distanceKm:Math.round(distanceKm * 10) / 10,
          sourceUrl:key ? 'https://www.gbif.org/occurrence/' + encodeURIComponent(key) : 'https://www.gbif.org/occurrence/search'
        };
      }).filter(Boolean);
      records.sort(function (a, b) {
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        return String(b.eventDate).localeCompare(String(a.eventDate));
      });
      if (plantOnly) {
        var seenPlantTaxa = {};
        records = records.filter(function (record) {
          var taxonId = record.taxonKey || record.scientificName.toLowerCase();
          if (!taxonId || seenPlantTaxa[taxonId]) return false;
          seenPlantTaxa[taxonId] = true;
          return true;
        });
      }
      return {
        latitude:point.latitude,
        longitude:point.longitude,
        radiusKm:radiusKm,
        searchedAt:new Date().toISOString(),
        scanned:raw.length,
        records:records.slice(0, limit),
        source:'GBIF occurrence search',
        sourceUrl:'https://www.gbif.org/occurrence/search'
      };
    })().catch(function (error) {
      delete occurrenceRequestCache[cacheKey];
      throw error;
    });
    occurrenceRequestCache[cacheKey] = promise;
    return promise;
  }


  async function fetchINaturalistPlantObservations(latitude, longitude, requestedRadiusKm, requestedLimit, forceRefresh) {
    var point = validateNatureCoordinates(latitude, longitude);
    var radiusKm = Math.max(1, Math.min(100, Number(requestedRadiusKm) || 25));
    var limit = Math.max(1, Math.min(20, Math.round(Number(requestedLimit) || 8)));
    var cacheKey = point.latitude.toFixed(3) + ',' + point.longitude.toFixed(3) + ':' + radiusKm + ':' + limit;
    if (forceRefresh === true) delete iNaturalistRequestCache[cacheKey];
    if (iNaturalistRequestCache[cacheKey]) return iNaturalistRequestCache[cacheKey];

    var promise = (async function () {
      var params = new URLSearchParams({
        lat:point.latitude.toFixed(5),
        lng:point.longitude.toFixed(5),
        radius:String(radiusKm),
        taxon_id:'47126',
        per_page:'100',
        order_by:'observed_on',
        order:'desc',
        quality_grade:'research'
      });
      params.append('has[]','geo');
      params.append('has[]','photos');
      var payload = await requestJSON('https://api.inaturalist.org/v1/observations?' + params.toString());
      var raw = Array.isArray(payload.results) ? payload.results : [];
      var seen = {};
      var records = [];
      raw.forEach(function (record) {
        var taxon = record && record.taxon || {};
        var lat = record && record.geojson && Array.isArray(record.geojson.coordinates)
          ? Number(record.geojson.coordinates[1])
          : Number(record && record.latitude);
        var lon = record && record.geojson && Array.isArray(record.geojson.coordinates)
          ? Number(record.geojson.coordinates[0])
          : Number(record && record.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        var distanceKm = natureDistanceKm(point.latitude, point.longitude, lat, lon);
        if (distanceKm > radiusKm) return;
        var taxonId = taxon.id != null ? String(taxon.id) : '';
        var scientificName = String(taxon.name || record.species_guess || 'Unidentified plant');
        var uniqueTaxon = taxonId || scientificName.toLowerCase();
        if (!uniqueTaxon || seen[uniqueTaxon]) return;
        seen[uniqueTaxon] = true;
        var observationId = record.id != null ? String(record.id) : '';
        var uri = record.uri || (observationId ? 'https://www.inaturalist.org/observations/' + encodeURIComponent(observationId) : 'https://www.inaturalist.org/observations');
        records.push({
          id:observationId,
          taxonId:taxonId,
          scientificName:scientificName,
          commonName:String(taxon.preferred_common_name || record.species_guess || ''),
          rank:String(taxon.rank || ''),
          observedOn:String(record.observed_on || ''),
          place:String(record.place_guess || ''),
          qualityGrade:String(record.quality_grade || ''),
          observer:String(record.user && record.user.login || ''),
          latitude:lat,
          longitude:lon,
          distanceKm:Math.round(distanceKm * 10) / 10,
          sourceUrl:uri,
          taxonUrl:taxonId ? 'https://www.inaturalist.org/taxa/' + encodeURIComponent(taxonId) : 'https://www.inaturalist.org/observations'
        });
      });
      records.sort(function (a, b) {
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
        return String(b.observedOn).localeCompare(String(a.observedOn));
      });
      return {
        latitude:point.latitude,
        longitude:point.longitude,
        radiusKm:radiusKm,
        searchedAt:new Date().toISOString(),
        totalReturned:Number(payload.total_results) || raw.length,
        records:records.slice(0,limit),
        source:'iNaturalist API v1',
        sourceUrl:'https://www.inaturalist.org/observations'
      };
    })().catch(function (error) {
      delete iNaturalistRequestCache[cacheKey];
      throw error;
    });
    iNaturalistRequestCache[cacheKey] = promise;
    return promise;
  }


  var waporMapsetCatalogCache = null;
  var waporMapsetCatalogPromise = null;
  var WAPOR_V3_CATALOG_URL = 'https://data.apps.fao.org/gismgr/api/v2/catalog/workspaces/WAPOR-3/mapsets?overview=false&paged=false';

  async function fetchWaporMapsets(forceRefresh) {
    if (forceRefresh === true) {
      waporMapsetCatalogCache = null;
      waporMapsetCatalogPromise = null;
    }
    if (waporMapsetCatalogCache) return waporMapsetCatalogCache;
    if (waporMapsetCatalogPromise) return waporMapsetCatalogPromise;

    waporMapsetCatalogPromise = (async function () {
      var pageUrl = WAPOR_V3_CATALOG_URL;
      var rawItems = [];
      var visited = {};
      // The mapset catalogue is small. Follow a bounded number of official pagination
      // links so a schema or paging regression cannot create an unbounded browser loop.
      for (var page = 0; page < 5 && pageUrl; page++) {
        if (visited[pageUrl]) break;
        visited[pageUrl] = true;
        var payload = await requestJSON(pageUrl);
        var envelope = payload && payload.response ? payload.response : payload;
        var items = envelope && Array.isArray(envelope.items) ? envelope.items : [];
        rawItems = rawItems.concat(items);
        var links = envelope && Array.isArray(envelope.links) ? envelope.links :
          (payload && Array.isArray(payload.links) ? payload.links : []);
        var next = links.find(function (link) { return link && link.rel === 'next' && link.href; });
        pageUrl = next && next.href ? new URL(next.href, pageUrl).href : '';
      }
      var allowed = {
        'L1-AETI-D':true,'L1-AETI-M':true,
        'L1-RET-D':true,'L1-RET-M':true,'L1-RET-E':true,
        'L1-RSM-D':true,'L1-NPP-D':true,
        'L1-PCP-D':true,'L1-PCP-M':true
      };
      var records = rawItems.map(function (item) {
        var code = String(item.code || item.mapsetCode || '');
        var caption = String(item.caption || item.title || item.description || code);
        if (!code) return null;
        return {
          code:code,
          caption:caption,
          level:/^L1-/.test(code) ? 'Global / Level 1' : /^L2-/.test(code) ? 'National / Level 2' : 'Other level',
          temporalResolution:/-[D]$/.test(code) ? 'Dekadal' : /-[M]$/.test(code) ? 'Monthly' : /-[E]$/.test(code) ? 'Daily' : /-[A]$/.test(code) ? 'Annual' : 'See metadata',
          resolutionNote:/RET/.test(code) ? 'Approximately 30 km' : /PCP/.test(code) ? 'Approximately 5 km' : /^L1-/.test(code) ? 'Approximately 300 m' : 'See official mapset metadata',
          apiUrl:'https://data.apps.fao.org/gismgr/api/v2/catalog/workspaces/WAPOR-3/mapsets/' + encodeURIComponent(code) + '/rasters?overview=false&paged=false',
          portalUrl:'https://data.apps.fao.org/?lang=en',
          source:'FAO WaPOR v3 GISMGR API'
        };
      }).filter(function (item) { return item && allowed[item.code]; });
      records.sort(function (a, b) { return a.code.localeCompare(b.code); });
      if (!records.length) {
        throw new Error('WaPOR responded, but none of the expected global water/vegetation mapsets were present in the catalogue.');
      }
      return {
        records:records,
        mapsetCount:rawItems.length,
        retrievedAt:new Date().toISOString(),
        source:'FAO WaPOR v3 GISMGR API',
        sourceUrl:WAPOR_V3_CATALOG_URL,
        note:'This is live dataset metadata, not a raster value sampled at the selected point.'
      };
    })().then(function (result) {
      waporMapsetCatalogCache = result;
      return result;
    }).catch(function (error) {
      waporMapsetCatalogCache = null;
      throw error;
    }).finally(function () {
      waporMapsetCatalogPromise = null;
    });
    return waporMapsetCatalogPromise;
  }

  async function fetchOpenMeteoAgroOutlook(latitude, longitude, forceRefresh) {
    var point = validateNatureCoordinates(latitude, longitude);
    var cacheKey = point.latitude.toFixed(3) + ',' + point.longitude.toFixed(3);
    if (forceRefresh === true) delete openMeteoOutlookCache[cacheKey];
    if (openMeteoOutlookCache[cacheKey]) return openMeteoOutlookCache[cacheKey];

    var promise = (async function () {
      var params = new URLSearchParams({
        latitude:point.latitude.toFixed(5),
        longitude:point.longitude.toFixed(5),
        daily:'temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,et0_fao_evapotranspiration',
        hourly:'soil_moisture_0_to_7cm,soil_temperature_0_to_7cm,vapour_pressure_deficit',
        forecast_days:'7',
        timezone:'auto',
        temperature_unit:'celsius',
        precipitation_unit:'mm',
        wind_speed_unit:'kmh'
      });
      var payload = await requestJSON('https://api.open-meteo.com/v1/forecast?' + params.toString());
      var daily = payload && payload.daily;
      if (!daily || !Array.isArray(daily.time) || !daily.time.length) {
        throw new Error('Open-Meteo returned no daily outlook for this point.');
      }
      var hourly = payload && payload.hourly || {};
      var hourlyByDate = {};
      function addHourlyValue(date, key, value) {
        if (value == null || !Number.isFinite(Number(value))) return;
        if (!hourlyByDate[date]) hourlyByDate[date] = { soilMoisture:[], soilTemperature:[], vpd:[] };
        if (key === 'soil_moisture_0_to_7cm') hourlyByDate[date].soilMoisture.push(Number(value));
        if (key === 'soil_temperature_0_to_7cm') hourlyByDate[date].soilTemperature.push(Number(value));
        if (key === 'vapour_pressure_deficit') hourlyByDate[date].vpd.push(Number(value));
      }
      (Array.isArray(hourly.time) ? hourly.time : []).forEach(function (stamp, hourIndex) {
        var date = String(stamp).slice(0,10);
        addHourlyValue(date,'soil_moisture_0_to_7cm',(hourly.soil_moisture_0_to_7cm || [])[hourIndex]);
        addHourlyValue(date,'soil_temperature_0_to_7cm',(hourly.soil_temperature_0_to_7cm || [])[hourIndex]);
        addHourlyValue(date,'vapour_pressure_deficit',(hourly.vapour_pressure_deficit || [])[hourIndex]);
      });
      function average(values) {
        return values && values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
      }
      var days = daily.time.map(function (date, index) {
        var rain = daily.precipitation_sum && daily.precipitation_sum[index] != null ? Number(daily.precipitation_sum[index]) : null;
        var et0 = daily.et0_fao_evapotranspiration && daily.et0_fao_evapotranspiration[index] != null ? Number(daily.et0_fao_evapotranspiration[index]) : null;
        var soil = hourlyByDate[String(date)] || {};
        var moisture = average(soil.soilMoisture);
        var soilTemperature = average(soil.soilTemperature);
        var vpd = average(soil.vpd);
        return {
          date:String(date),
          temperatureMean:daily.temperature_2m_mean && daily.temperature_2m_mean[index] != null ? Number(daily.temperature_2m_mean[index]) : null,
          temperatureMin:daily.temperature_2m_min && daily.temperature_2m_min[index] != null ? Number(daily.temperature_2m_min[index]) : null,
          temperatureMax:daily.temperature_2m_max && daily.temperature_2m_max[index] != null ? Number(daily.temperature_2m_max[index]) : null,
          precipitationMm:rain != null && Number.isFinite(rain) ? rain : null,
          referenceEt0Mm:et0 != null && Number.isFinite(et0) ? et0 : null,
          waterBalanceMm:rain != null && et0 != null && Number.isFinite(rain) && Number.isFinite(et0) ? Math.round((rain-et0)*10)/10 : null,
          soilMoistureTopM3M3:moisture == null ? null : Math.round(moisture*10000)/10000,
          soilTemperatureTopC:soilTemperature == null ? null : Math.round(soilTemperature*10)/10,
          vapourPressureDeficitKpa:vpd == null ? null : Math.round(vpd*100)/100
        };
      });
      return {
        latitude:point.latitude,
        longitude:point.longitude,
        timezone:String(payload.timezone || ''),
        days:days,
        source:'Open-Meteo Forecast API',
        sourceUrl:'https://open-meteo.com/en/docs'
      };
    })().catch(function (error) {
      delete openMeteoOutlookCache[cacheKey];
      throw error;
    });
    openMeteoOutlookCache[cacheKey] = promise;
    return promise;
  }

  async function identifyPlantWithPlantNet(files, apiKey, organ) {
    var key = String(apiKey || '').trim();
    if (!key) throw new Error('Enter your own Pl@ntNet API key to use the optional image-identification service.');
    if (!files || !files.length || files.length > 5) throw new Error('Choose 1–5 photos of the same plant.');
    var totalBytes = 0;
    var imageFiles = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || !/^image\/(jpeg|png)$/i.test(String(file.type || ''))) {
        throw new Error('Pl@ntNet accepts JPEG or PNG photos only.');
      }
      totalBytes += Number(file.size) || 0;
      imageFiles.push(file);
    }
    if (totalBytes > 50 * 1024 * 1024) throw new Error('Combined photo size must not exceed 50 MB.');
    var allowedOrgans = ['auto','leaf','flower','fruit','bark'];
    var selectedOrgan = allowedOrgans.indexOf(String(organ || 'auto')) >= 0 ? String(organ || 'auto') : 'auto';
    var form = new FormData();
    imageFiles.forEach(function (file) {
      form.append('images',file,file.name || 'plant-photo.jpg');
      form.append('organs',selectedOrgan);
    });
    var params = new URLSearchParams({
      'api-key':key,
      lang:'en',
      'include-related-images':'false',
      'no-reject':'false',
      'nb-results':'5'
    });
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 30000);
    try {
      var response = await fetch('https://my-api.plantnet.org/v2/identify/all?' + params.toString(), {
        method:'POST',
        body:form,
        signal:controller.signal,
        cache:'no-store'
      });
      var responseText = await response.text();
      var payload;
      try { payload = JSON.parse(responseText); }
      catch (_) { throw new Error('Pl@ntNet returned a non-JSON response (HTTP ' + response.status + ').'); }
      if (!response.ok) {
        var detail = payload && (payload.message || payload.error || payload.detail);
        throw new Error('Pl@ntNet HTTP ' + response.status + (detail ? ': ' + detail : '') + '. Check the key and daily quota.');
      }
      var results = Array.isArray(payload.results) ? payload.results : [];
      return {
        bestMatch:String(payload.bestMatch || ''),
        version:String(payload.version || ''),
        remainingIdentificationRequests:payload.remainingIdentificationRequests == null ? null : Number(payload.remainingIdentificationRequests),
        queriedAt:new Date().toISOString(),
        results:results.slice(0,5).map(function (item) {
          var species = item && item.species || {};
          var commonNames = Array.isArray(species.commonNames) ? species.commonNames : [];
          return {
            scientificName:String(species.scientificNameWithoutAuthor || species.scientificName || payload.bestMatch || 'Unresolved plant'),
            authorship:String(species.scientificNameAuthorship || ''),
            commonName:String(commonNames[0] || ''),
            family:String(species.family && (species.family.scientificNameWithoutAuthor || species.family.scientificName) || ''),
            score:Number.isFinite(Number(item.score)) ? Number(item.score) : null
          };
        }),
        source:'Pl@ntNet recognition API',
        sourceUrl:'https://my.plantnet.org/'
      };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Pl@ntNet identification exceeded the 30-second timeout.');
      if (error instanceof TypeError) throw new Error('Browser network/CORS access to Pl@ntNet failed. Check your connection and retry.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchNasaPowerMonthly(latitude, longitude, requestedYears, forceRefresh) {
    var point = validateNatureCoordinates(latitude, longitude);
    var years = Math.max(3, Math.min(10, Math.round(Number(requestedYears) || 5)));
    var currentYear = new Date().getFullYear();
    var startYear = currentYear - years;
    var endYear = currentYear - 1;
    var cacheKey = point.latitude.toFixed(3) + ',' + point.longitude.toFixed(3) + ':' + years;
    if (forceRefresh === true) delete nasaMonthlyRequestCache[cacheKey];
    if (nasaMonthlyRequestCache[cacheKey]) return nasaMonthlyRequestCache[cacheKey];

    var promise = (async function () {
      var params = new URLSearchParams({
        parameters:'T2M,T2M_MIN,T2M_MAX,PRECTOTCORR,ALLSKY_SFC_SW_DWN',
        community:'AG',
        longitude:point.longitude.toFixed(5),
        latitude:point.latitude.toFixed(5),
        start:String(startYear),
        end:String(endYear),
        format:'JSON'
      });
      var payload = await requestJSON(NASA_POWER_BASE + '?' + params.toString());
      var parameterData = payload && payload.properties && payload.properties.parameter;
      if (!parameterData || typeof parameterData !== 'object') {
        throw new Error('NASA POWER returned an unexpected response structure.');
      }
      var temperature = parameterData.T2M || {};
      var monthlyKeys = Object.keys(temperature).filter(function (key) {
        if (!/^\d{6}$/.test(key)) return false;
        var year = Number(key.slice(0, 4));
        var month = Number(key.slice(4, 6));
        return year >= startYear && year <= endYear && month >= 1 && month <= 12;
      }).sort();
      if (!monthlyKeys.length) throw new Error('NASA POWER returned no monthly values for this point and period.');

      var bins = NATURE_MONTH_LABELS.map(function (label, index) {
        return { month:index + 1, label:label, t:[], tmin:[], tmax:[], rain:[], solar:[] };
      });
      function pushFinite(target, value) {
        if (value == null) return;
        var number = Number(value);
        if (Number.isFinite(number) && number > -900) target.push(number);
      }
      monthlyKeys.forEach(function (key) {
        var monthIndex = Number(key.slice(4, 6)) - 1;
        pushFinite(bins[monthIndex].t, temperature[key]);
        pushFinite(bins[monthIndex].tmin, (parameterData.T2M_MIN || {})[key]);
        pushFinite(bins[monthIndex].tmax, (parameterData.T2M_MAX || {})[key]);
        pushFinite(bins[monthIndex].rain, (parameterData.PRECTOTCORR || {})[key]);
        pushFinite(bins[monthIndex].solar, (parameterData.ALLSKY_SFC_SW_DWN || {})[key]);
      });
      function average(values) {
        return values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : null;
      }
      var monthly = bins.map(function (bin) {
        return {
          month:bin.month,
          label:bin.label,
          temperatureMean:average(bin.t),
          temperatureMin:average(bin.tmin),
          temperatureMax:average(bin.tmax),
          precipitationRateMmPerDay:average(bin.rain),
          solarRadiationKwhM2Day:average(bin.solar)
        };
      });
      return {
        latitude:point.latitude,
        longitude:point.longitude,
        startYear:startYear,
        endYear:endYear,
        years:years,
        monthly:monthly,
        source:'NASA POWER Monthly Point API',
        sourceUrl:'https://power.larc.nasa.gov/docs/services/api/temporal/monthly/'
      };
    })().catch(function (error) {
      delete nasaMonthlyRequestCache[cacheKey];
      throw error;
    });
    nasaMonthlyRequestCache[cacheKey] = promise;
    return promise;
  }


  var worldBankAgricultureCache = {};
  var WORLD_BANK_AGRICULTURE_INDICATORS = [
    {id:'AG.LND.AGRI.ZS',label:'Agricultural land',unit:'% of land area'},
    {id:'AG.YLD.CREL.KG',label:'Cereal yield',unit:'kg per hectare'},
    {id:'AG.PRD.CROP.XD',label:'Crop production index',unit:'2014–2016 = 100'},
    {id:'NV.AGR.TOTL.ZS',label:'Agriculture, forestry and fishing value added',unit:'% of GDP'}
  ];

  async function fetchWorldBankAgricultureSnapshot(iso3, forceRefresh) {
    var country = String(iso3 || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) throw new Error('A valid ISO-3 country code is required.');
    if (forceRefresh === true) delete worldBankAgricultureCache[country];
    if (worldBankAgricultureCache[country]) return worldBankAgricultureCache[country];

    var promise = (async function () {
      var results = await Promise.allSettled(WORLD_BANK_AGRICULTURE_INDICATORS.map(async function (indicator) {
        var params = new URLSearchParams({format:'json',per_page:'100'});
        var url = 'https://api.worldbank.org/v2/country/' + encodeURIComponent(country) +
          '/indicator/' + encodeURIComponent(indicator.id) + '?' + params.toString();
        var payload = await requestJSON(url);
        var observations = Array.isArray(payload) && Array.isArray(payload[1]) ? payload[1] : [];
        var available = observations.filter(function (observation) {
          return observation && observation.value != null && Number.isFinite(Number(observation.value));
        });
        var latest = available.length ? available[0] : null;
        return {
          id:indicator.id,
          label:indicator.label,
          unit:indicator.unit,
          value:latest ? Number(latest.value) : null,
          year:latest ? String(latest.date || '') : '',
          observations:available.slice(0,5).map(function (observation) {
            return {year:String(observation.date || ''),value:Number(observation.value)};
          }),
          sourceUrl:url
        };
      }));
      var indicators = [];
      var errors = [];
      results.forEach(function (result, index) {
        if (result.status === 'fulfilled') indicators.push(result.value);
        else errors.push(WORLD_BANK_AGRICULTURE_INDICATORS[index].id);
      });
      if (!indicators.length) throw new Error('The World Bank API did not return any country agriculture indicators. The country may have limited coverage or the service may be unavailable.');
      return {
        countryIso3:country,
        retrievedAt:new Date().toISOString(),
        indicators:indicators,
        failedIndicators:errors,
        source:'World Bank Indicators API v2',
        sourceUrl:'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation'
      };
    })().catch(function (error) {
      delete worldBankAgricultureCache[country];
      throw error;
    });
    worldBankAgricultureCache[country] = promise;
    return promise;
  }


  // Public FAO FPMA food-price API: no key/login. Keep per-query traffic bounded.
  var FAO_FPMA_BASE = 'https://fpma.fao.org/giews/v4/global/price_module/api/v1';

  function fpmaText(record, candidates) {
    if (!record || typeof record !== 'object') return '';
    var keys = Object.keys(record);
    for (var i = 0; i < candidates.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === candidates[i].toLowerCase() &&
            record[keys[j]] != null && record[keys[j]] !== '') {
          var value = record[keys[j]];
          if (typeof value === 'string' || typeof value === 'number') return String(value);
        }
      }
    }
    return '';
  }

  function fpmaPeriodicity(series) {
    var periods = Array.isArray(series && series.periodicity) ? series.periodicity : [];
    var names = periods.map(function (item) {
      return typeof item === 'string' ? item.toLowerCase() : String(item && (item.period || item.name) || '').toLowerCase();
    });
    var preferred = ['monthly','weekly','daily'];
    for (var i = 0; i < preferred.length; i++) {
      if (names.indexOf(preferred[i]) >= 0) return preferred[i];
    }
    return names[0] || 'monthly';
  }

  function summarizeFpmaPrices(points) {
    var clean = (Array.isArray(points) ? points : []).filter(function (point) {
      return point && point.date && Number.isFinite(Date.parse(point.date));
    }).slice().sort(function (a, b) {
      return Date.parse(a.date) - Date.parse(b.date);
    });
    var latest = clean.length ? clean[clean.length - 1] : null;
    var latestValue = latest && Number(latest.price_value);
    var reference = null;
    if (latest) {
      var target = Date.parse(latest.date) - 90 * 24 * 60 * 60 * 1000;
      clean.forEach(function (point) {
        if (Date.parse(point.date) <= target) reference = point;
      });
      if (!reference && clean.length > 1) reference = clean[0];
    }
    var referenceValue = reference && Number(reference.price_value);
    var changePct = latest && reference &&
      Number.isFinite(latestValue) && Number.isFinite(referenceValue) && referenceValue !== 0
      ? ((latestValue - referenceValue) / referenceValue) * 100 : null;
    return {
      latest:latest,
      reference:reference,
      changePct:Number.isFinite(changePct) ? changePct : null,
      points:clean.slice(-24)
    };
  }

  async function fetchFaoFoodPrices(iso3, commodityQuery) {
    var country = String(iso3 || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(country)) throw new Error('A valid ISO-3 country code is required for FAO FPMA.');
    var query = String(commodityQuery || 'rice').trim().toLowerCase();
    var allSeries = [];
    var page = 1;
    var morePages = true;
    // Three pages bounds metadata traffic to at most 300 series for this search.
    while (morePages && page <= 3) {
      var params = new URLSearchParams({
        iso3_country_codes:country,
        page_size:'100',
        page:String(page)
      });
      var payload = await requestJSON(FAO_FPMA_BASE + '/FpmaSerie/?' + params.toString());
      var pageRows = payload && Array.isArray(payload.results) ? payload.results : [];
      allSeries = allSeries.concat(pageRows);
      morePages = !!(payload && payload.next && pageRows.length);
      page += 1;
    }

    var candidates = allSeries.filter(function (series) {
      var commodity = fpmaText(series, ['commodity','commodity_name','commodity_label','product','product_name','name']);
      return !query || commodity.toLowerCase().indexOf(query) >= 0;
    });
    candidates.sort(function (a, b) {
      var aName = fpmaText(a, ['commodity','commodity_name','commodity_label','product','product_name','name']);
      var bName = fpmaText(b, ['commodity','commodity_name','commodity_label','product','product_name','name']);
      var aExact = aName.toLowerCase() === query ? 0 : 1;
      var bExact = bName.toLowerCase() === query ? 0 : 1;
      return aExact - bExact || aName.localeCompare(bName);
    });
    var chosen = candidates.slice(0, 4);
    if (!chosen.length) {
      return {countryIso3:country,query:query,series:[],searchedSeries:allSeries.length,retrievedAt:new Date().toISOString(),errors:[]};
    }

    var fetched = await Promise.allSettled(chosen.map(async function (source) {
      var uuid = fpmaText(source, ['uuid','id']);
      if (!uuid) throw new Error('The FAO FPMA source series did not include a UUID.');
      var periodicity = fpmaPeriodicity(source);
      var params = new URLSearchParams({uuid__in:uuid,periodicity:periodicity,page_size:'100'});
      var response = await requestJSON(FAO_FPMA_BASE + '/FpmaSeriePrice/?' + params.toString());
      var resultRows = response && Array.isArray(response.results) ? response.results : [];
      var priceSeries = resultRows.find(function (row) { return String(row.uuid || '') === uuid; }) || resultRows[0] || {};
      var datapoints = Array.isArray(priceSeries.datapoints) ? priceSeries.datapoints :
        (Array.isArray(priceSeries.prices) ? priceSeries.prices : []);
      var summary = summarizeFpmaPrices(datapoints);
      return {
        uuid:uuid,
        commodity:fpmaText(source, ['commodity','commodity_name','commodity_label','product','product_name','name']) || 'Unlabelled commodity',
        priceType:fpmaText(source, ['price_type','price_type_name','priceType']),
        market:fpmaText(source, ['market','market_name','market_type','admin_unit_name','administrative_unit','admin_units','region']),
        currency:fpmaText(source, ['currency','currency_code','currency_iso_code']),
        unit:fpmaText(source, ['measure_unit_label','measure_unit','unit','unit_label']),
        periodicity:periodicity,
        observationCount:summary.points.length,
        latest:summary.latest ? {
          date:summary.latest.date,
          value:Number.isFinite(Number(summary.latest.price_value)) ? Number(summary.latest.price_value) : null,
          valueUsd:summary.latest.price_value_dollar == null ? null : Number(summary.latest.price_value_dollar),
          realValue:summary.latest.price_value_real == null ? null : Number(summary.latest.price_value_real)
        } : null,
        reference:summary.reference ? {
          date:summary.reference.date,
          value:Number.isFinite(Number(summary.reference.price_value)) ? Number(summary.reference.price_value) : null
        } : null,
        changePct90d:summary.changePct,
        prices:summary.points.map(function (point) {
          return {
            date:String(point.date),
            value:point.price_value == null ? null : Number(point.price_value),
            valueUsd:point.price_value_dollar == null ? null : Number(point.price_value_dollar)
          };
        })
      };
    }));
    var records = [];
    var errors = [];
    fetched.forEach(function (result, index) {
      if (result.status === 'fulfilled') records.push(result.value);
      else errors.push({
        commodity:fpmaText(chosen[index], ['commodity','commodity_name','commodity_label','product','product_name','name']) || 'Series ' + (index + 1),
        message:result.reason && result.reason.message ? result.reason.message : 'Price series request failed'
      });
    });
    return {
      countryIso3:country,
      query:query,
      series:records,
      searchedSeries:allSeries.length,
      retrievedAt:new Date().toISOString(),
      errors:errors,
      sourceUrl:'https://fpma.fao.org/giews/v4/global/swagger/'
    };
  }

  var COUNTRY_SOURCE_REGISTRY = {
    IDN:[
      {title:'BPS — provincial paddy statistics',description:'Official harvested area, productivity and production tables for Indonesian provinces.',url:'https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html',kind:'Official statistics table',access:'Free table'},
      {title:'BPS WebAPI',description:'Programmatic access to BPS statistical products. Free registration is required to obtain an API key/token.',url:'https://webapi.bps.go.id/developer',kind:'National statistics API',access:'Free registration + key'},
      {title:'Kementerian Pertanian — Geoportal',description:'Official Indonesian agriculture/soil and land-resource map services. Coverage and map scale vary by layer.',url:'https://geoportal.pertanian.go.id/',kind:'Agriculture / soil geodata',access:'Portal access; layer terms vary'}
    ],
    USA:[
      {title:'USDA NASS Quick Stats API',description:'Agricultural statistics by commodity, geography and year. API queries require a free API key; do not put a personal key in public source code.',url:'https://quickstats.nass.usda.gov/api',kind:'National agriculture statistics API',access:'Free API key required'},
      {title:'USDA NASS Quick Stats',description:'Browse agricultural data and downloadable reports without configuring an API client.',url:'https://www.nass.usda.gov/Quick_Stats/',kind:'Official agriculture statistics',access:'Public portal'},
      {title:'USDA NASS datasets',description:'Official datasets and precomputed agriculture products for the United States.',url:'https://www.nass.usda.gov/datasets/',kind:'Agriculture datasets',access:'Public downloads vary by product'}
    ],
    CAN:[
      {title:'Statistics Canada Web Data Service',description:'Official REST/JSON API for Canadian statistical tables and time series, including agriculture data.',url:'https://www.statcan.gc.ca/en/developers/wds/user-guide',apiUrl:'https://www150.statcan.gc.ca/t1/wds/rest/getAllCubesListLite',kind:'National statistics API',access:'Public API; no API key documented'},
      {title:'Statistics Canada agriculture statistics',description:'Official agriculture data, including farm structure, crops, livestock and food statistics.',url:'https://www.statcan.gc.ca/en/subjects-start/agriculture_and_food',kind:'Agriculture statistics',access:'Public portal'}
    ],
    BRA:[
      {title:'IBGE SIDRA API',description:'Brazilian official statistical tables, including agricultural production. Query table and geography before interpreting a result.',url:'https://apisidra.ibge.gov.br/',kind:'National statistics API',access:'Public API; no key generally required'},
      {title:'IBGE Aggregate API documentation',description:'API documentation for Brazilian geographic and statistical aggregates.',url:'https://servicodados.ibge.gov.br/api/docs/agregados?versao=3',apiUrl:'https://servicodados.ibge.gov.br/api/v3/agregados',kind:'Official statistics API',access:'Public API'}
    ],
    AUS:[
      {title:'data.gov.au — agriculture dataset API search',description:'Search the Australian open-data catalogue for agriculture-related datasets. Individual resources can have different formats, licences or access conditions.',url:'https://data.gov.au/data/',apiUrl:'https://data.gov.au/data/api/3/action/package_search?q=agriculture',kind:'National open-data catalogue API',access:'Public catalogue search; resource terms vary'},
      {title:'ABARES — Australian agriculture and resource economics',description:'Official Australian agriculture, commodities, land and resource-economics research and statistics.',url:'https://www.agriculture.gov.au/abares',kind:'Agriculture statistics and research',access:'Public portal'}
    ],
    IND:[
      {title:'data.gov.in — agriculture datasets/API',description:'Indian government open-data catalogue with agriculture and allied-sector datasets. API use requires a registered API key.',url:'https://api.data.gov.in/',kind:'National open-data API',access:'Free registration + API key'},
      {title:'Ministry of Agriculture & Farmers Welfare',description:'Official Indian agriculture policies, schemes, statistics and publications.',url:'https://agriwelfare.gov.in/',kind:'Agriculture ministry data',access:'Public portal'}
    ],
    JPN:[
      {title:'e-Stat Government Statistics API',description:'Japan’s official statistical portal provides machine-readable statistics; API usage requires an application ID.',url:'https://www.e-stat.go.jp/api/',kind:'National statistics API',access:'Free registration + app ID'},
      {title:'MAFF Japan',description:'Official Ministry of Agriculture, Forestry and Fisheries statistics, reports and policy data.',url:'https://www.maff.go.jp/e/data/stat/',kind:'Agriculture statistics',access:'Public portal'}
    ],
    MEX:[
      {title:'INEGI APIs',description:'Mexico’s national statistics and geography APIs. Some calls require a registered token; review the dataset and API conditions.',url:'https://www.inegi.org.mx/servicios/api_indicadores.html',kind:'National statistics API',access:'Free registration/token may be required'},
      {title:'SIAP — agricultural and fisheries information',description:'Official Mexican agriculture, livestock, fisheries and food-production statistics.',url:'https://www.gob.mx/siap',kind:'Agriculture statistics',access:'Public portal; dataset access varies'}
    ]
  };

  var EUROSTAT_ISO3_TO_GEO = {
    AUT:'AT', BEL:'BE', BGR:'BG', HRV:'HR', CYP:'CY', CZE:'CZ', DNK:'DK',
    EST:'EE', FIN:'FI', FRA:'FR', DEU:'DE', GRC:'EL', HUN:'HU', IRL:'IE',
    ITA:'IT', LVA:'LV', LTU:'LT', LUX:'LU', MLT:'MT', NLD:'NL', POL:'PL',
    PRT:'PT', ROU:'RO', SVK:'SK', SVN:'SI', ESP:'ES', SWE:'SE'
  };

  function getCountrySourceCatalog(iso3, countryName) {
    var country = String(iso3 || '').toUpperCase();
    var records = (COUNTRY_SOURCE_REGISTRY[country] || []).map(function (item) {
      return Object.assign({}, item);
    });
    var euroGeo = EUROSTAT_ISO3_TO_GEO[country];
    if (euroGeo) {
      records.unshift({
        title:'Eurostat — crop production API',
        description:'Official EU crop-production statistics, including area and production indicators. The API is keyless; this endpoint filters the dataset to the selected EU member country.',
        url:'https://ec.europa.eu/eurostat/databrowser/product/page/apro_cpsh1',
        apiUrl:'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/apro_cpsh1?geo=' + euroGeo + '&lang=EN',
        kind:'Regional agriculture statistics API',
        access:'Public API; no key',
        queryCountry:euroGeo
      });
    }
    return records;
  }


  // Crossref public REST API: bibliographic metadata only, no API key required.
  // Cache identical searches briefly to reduce repeated requests.
  async function searchCrossrefWorks(query, limit) {
    var term = String(query || '').replace(/\s+/g, ' ').trim();
    if (term.length < 3) throw new Error('Enter at least three characters to search publication metadata.');
    if (term.length > 180) throw new Error('Keep the search phrase to 180 characters or fewer.');
    var rows = Math.min(12, Math.max(3, Number(limit) || 8));
    var cacheKey = term.toLowerCase() + '|' + rows;
    var cached = crossrefSearchCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return Object.assign({}, cached.data, { cached: true });
    }
    var params = new URLSearchParams({
      'query.bibliographic': term,
      rows: String(rows),
      select: 'DOI,title,author,publisher,container-title,URL,published-print,published-online,issued,type'
    });
    var requestUrl = 'https://api.crossref.org/works?' + params.toString();
    var payload = await requestJSON(requestUrl);
    var message = payload && payload.message;
    if (!message || !Array.isArray(message.items)) throw new Error('Crossref returned an unexpected response format.');
    var works = message.items.map(function (item) {
      item = item || {};
      var rawDoi = String(item.DOI || '').trim();
      var doi = rawDoi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
      var doiUrl = /^10\.\d{4,9}\//.test(doi) ? 'https://doi.org/' + doi : '';
      var rawUrl = String(item.URL || '').trim();
      var recordUrl = doiUrl || (/^https?:\/\//i.test(rawUrl) ? rawUrl : '');
      var dates = item['published-print'] || item['published-online'] || item.issued || {};
      var dateParts = dates && dates['date-parts'] && dates['date-parts'][0] ? dates['date-parts'][0] : [];
      var year = dateParts.length ? String(dateParts[0]) : '';
      var authors = Array.isArray(item.author) ? item.author.map(function (author) {
        if (!author) return '';
        return String(author.literal || [author.given, author.family].filter(Boolean).join(' ')).trim();
      }).filter(Boolean) : [];
      var type = String(item.type || '').replace(/-/g, ' ').trim();
      var title = Array.isArray(item.title) && item.title.length ? String(item.title[0] || '').trim() : '';
      var journal = Array.isArray(item['container-title']) && item['container-title'].length
        ? String(item['container-title'][0] || '').trim() : '';
      return {
        title:title, doi:doi, url:recordUrl, year:year,
        authors:authors.slice(0,8), additionalAuthors:Math.max(0,authors.length-8),
        publisher:String(item.publisher || '').trim(), journal:journal,
        type:type || 'publication', source:'Crossref'
      };
    }).filter(function (work) { return work.title; });
    var result = {
      query:term, totalResults:Number(message['total-results']) || works.length,
      works:works, retrievedAt:new Date().toISOString(), sourceUrl:requestUrl, cached:false
    };
    crossrefSearchCache[cacheKey] = { timestamp:Date.now(), data:result };
    var cacheKeys = Object.keys(crossrefSearchCache);
    if (cacheKeys.length > 30) {
      cacheKeys.sort(function (a,b) { return crossrefSearchCache[a].timestamp-crossrefSearchCache[b].timestamp; });
      delete crossrefSearchCache[cacheKeys[0]];
    }
    return result;
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
    fetchCropTaxonomy: fetchCropTaxonomy,
    fetchGbifOccurrences: fetchGbifOccurrences,
    fetchNasaPowerMonthly: fetchNasaPowerMonthly,
    fetchINaturalistPlantObservations: fetchINaturalistPlantObservations,
    fetchOpenMeteoAgroOutlook: fetchOpenMeteoAgroOutlook,
    identifyPlantWithPlantNet: identifyPlantWithPlantNet,
    fetchWaporMapsets: fetchWaporMapsets,
    getCountrySourceCatalog: getCountrySourceCatalog,
    fetchWorldBankAgricultureSnapshot: fetchWorldBankAgricultureSnapshot,
    fetchFaoFoodPrices: fetchFaoFoodPrices,
    searchCrossrefWorks: searchCrossrefWorks
  };
})();