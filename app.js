/* BackToNature — provincial agriculture fieldbook, PS1-inspired UI */
(function () {
  'use strict';

  var WORLD_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  var PROVINCE_URL = 'https://raw.githubusercontent.com/mashadinoor/Indonesia-Geojson-2026/main/Geojson/indonesia_provinsi.geojson';
  var ADM1_INDEX_URL = './data/province.json';
  var ADM2_INDEX_URL = './data/district-index.json';
  var COUNTRIES_INDEX_URL = './data/countries.json';
  var map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([12, 105], 3);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Optional ESA WorldCover land-cover overlay. It is off by default so the
  // basemap stays legible and no extra map tiles are requested until enabled.
  var esaWorldCover2021Layer = L.tileLayer.wms('https://services.terrascope.be/wms/v2', {
    layers:'WORLDCOVER_2021_MAP',
    format:'image/png',
    transparent:true,
    version:'1.1.1',
    opacity:0.76,
    attribution:'&copy; ESA WorldCover 2021 / Contains modified Copernicus Sentinel data'
  });
  // Observation points appear after live GBIF/iNaturalist data has loaded in Nature Data.
  var natureObservationLayer = L.layerGroup();
  L.control.layers(null, {
    'ESA WorldCover 2021 · land cover':esaWorldCover2021Layer,
    'Species observations · GBIF + iNaturalist':natureObservationLayer
  }, { collapsed:true, position:'topright' }).addTo(map);
  var natureObservationLayerSelectionKey = '';
  var natureInlineMap = null;
  var natureInlineMarkerLayer = null;
  var natureInlineMapSelectionKey = '';

  var worldLayer = null;
  var provinceLayer = null;
  var provincesGeoJSON = null;
  var mode = 'world';
  var currentProvince = null;
  var currentTab = 'overview';
  var profileByName = {};
  var worldRequestId = 0;
  var adminLoadRequestId = 0;
  var adm1Index = null;
  var adm2Index = null;
  var countriesIndex = null;
  var countryByISO3 = {};
  var countryByNormalizedName = {};
  var activeAdminGeoJSON = null;
  var selectedCountry = null;
  var selectedProvinceBounds = null;
  var activeAdminLevel = 1;
  var countryDataCache = {};
  var climateResultsBySelection = {};
  var climateStatusBySelection = {};
  var climatePromisesBySelection = {};
  var fieldBriefOutlookBySelection = {};
  var fieldBriefOutlookStatusBySelection = {};
  var fieldBriefOutlookPromisesBySelection = {};
  var climatePhotoRequestId = 0;
  var climatePhotosLoadedBySelection = {};
  var summarySelection = null;
  var cropTaxonomyBySelection = {};
  var cropTaxonomyPendingBySelection = {};
  var cropTaxonomyStatusBySelection = {};
  var natureOccurrenceDataBySelection = {};
  var natureOccurrenceStatusBySelection = {};
  var naturePowerDataBySelection = {};
  var naturePowerStatusBySelection = {};
  var natureINaturalistDataBySelection = {};
  var natureINaturalistStatusBySelection = {};
  var natureOutlookDataBySelection = {};
  var natureOutlookStatusBySelection = {};
  var natureWaporDataBySelection = {};
  var natureWaporStatusBySelection = {};
  var natureOccurrenceRequestId = 0;
  var natureINaturalistRequestId = 0;
  var natureOutlookRequestId = 0;
  var natureWaporRequestId = 0;
  var plantNetRequestId = 0;
  var naturePowerRequestId = 0;


  function clearNatureObservationMarkers() {
    if (natureObservationLayer) natureObservationLayer.clearLayers();
    natureObservationLayerSelectionKey = '';
    if (natureObservationLayer && map.hasLayer(natureObservationLayer)) map.removeLayer(natureObservationLayer);
  }

  function norm(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }
  // Render external URLs only when they use HTTPS; several UI renderers share this helper.
  function safeHttps(value) {
    try {
      var raw = String(value == null ? '' : value).trim();
      if (!raw) return '#';
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol !== 'https:') return '#';
      return parsed.href;
    } catch (_) {
      return '#';
    }
  }
  function el(id) { return document.getElementById(id); }
  function setText(id, value) { var node = el(id); if (node) node.textContent = value; }
  function setStatus(id, value, type) {
    var node = el(id);
    if (!node) return;
    node.className = 'status-pill ' + (type || 'neutral');
    node.textContent = value;
  }

  // Live data panels use a distinct visual status style from the global HUD.
  // This helper is used by Sources/Nature controls and must remain available
  // before those handlers are invoked.
  function setLiveStatus(id, value, type) {
    var node = el(id);
    if (!node) return;
    var normalizedType = type === 'success' || type === 'error' ? type : 'pending';
    node.className = 'live-status ' + normalizedType;
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.textContent = value == null ? '' : String(value);
  }

  function dataField(row, names) {
    var keys = Object.keys(row || {});
    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === names[i].toLowerCase() && row[keys[j]] != null && row[keys[j]] !== '') {
          return row[keys[j]];
        }
      }
    }
    return '';
  }

  function provinceFeatureName(feature) {
    var p = feature && feature.properties ? feature.properties : {};
    return p.shapeName || p.NAME_2 || p.NAME_1 || p.name || p.PROVINSI || p.provinsi || p.NAME || p._prov || 'Unknown region';
  }
  function provinceFeatureCode(feature) {
    var p = feature && feature.properties ? feature.properties : {};
    return p.shapeISO || p.shapeID || p.code || p.KODE_PROV || p.PROV_CODE || p.PROVNO || p.prov_code || '';
  }

  var profiles = [
    {name:'Aceh', kind:'humid-upland', zone:'Coastal plains, wet lowlands and uplands', intro:'A mixed landscape where irrigated rice, tree crops and upland farming can coexist. Recommendations should distinguish the coast, peat/wetlands where present, and cooler highland farms.', focus:'Protect slopes and diversify tree-crop systems', crops:['Padi sawah','Kopi Arabika (dataran tinggi)','Kakao','Kelapa','Pinang'], soilCue:'The province spans several landforms. Slope, drainage, acidity and soil depth can change substantially between coastal plains and uplands.'},
    {name:'Sumatera Utara', kind:'humid-upland', zone:'Wet lowlands, volcanic uplands and highland valleys', intro:'A diverse farming region with rice, plantation crops and highland horticulture. Match each crop to elevation, rainfall, slope and road access instead of treating the province as one soil zone.', focus:'Agroforestry and erosion control on sloping farms', crops:['Padi sawah','Kopi Arabika','Kopi Robusta','Sayuran dataran tinggi','Kakao','Karet'], soilCue:'Volcanic uplands, valleys, coastal plains and wet lowlands create different soil and drainage conditions.'},
    {name:'Sumatera Barat', kind:'humid-upland', zone:'Mountainous uplands, volcanic landscapes and coastal plains', intro:'Rice and horticulture are important in suitable valleys and plains, while tree crops can support diversified upland livelihoods. On steeper land, avoid leaving soil bare during intense rainfall.', focus:'Contour cultivation and perennial crop cover', crops:['Padi sawah','Kopi','Kayu manis','Cabai','Bawang merah','Kakao'], soilCue:'Steep terrain and high rainfall make erosion, soil depth and drainage important site-level checks.'},
    {name:'Riau', kind:'peat-wet', zone:'Lowland forests, peat landscapes and riverine wetlands', intro:'Land and water management are central in many lowland areas. Where peat is present, restoration and fire prevention should come before any crop expansion that requires drainage.', focus:'Water-table management and peat protection', crops:['Sagu (area yang sesuai)','Kelapa','Padi lahan basah','Nanas pada lahan sesuai','Karet pada lokasi yang sesuai'], soilCue:'Peat and mineral soils require very different management. Confirm peat depth, drainage status, flood duration and fire risk before planning.'},
    {name:'Jambi', kind:'peat-wet', zone:'River basins, lowlands and humid interior hills', intro:'Smallholder tree crops, rice and mixed farming occur across different landscapes. Soil cover, careful drainage and diversified farm systems can reduce exposure to drought, flood and erosion.', focus:'Mixed agroforestry and soil-cover management', crops:['Padi sawah','Karet','Kelapa sawit pada lahan sesuai','Pinang','Kopi Liberika pada lokasi yang sesuai','Kakao'], soilCue:'Riverine, lowland and hilly areas vary. Identify peat/organic soils, flood-prone land and slope before choosing technology.'},
    {name:'Sumatera Selatan', kind:'peat-wet', zone:'Alluvial plains, tidal wetlands and inland uplands', intro:'Rice, plantation crops and swamp farming each need different water strategies. Tidal or swamp areas should be assessed for salinity, acidity, flooding and drainage before crop recommendations.', focus:'Water control, soil acidity assessment and diversified farms', crops:['Padi sawah','Padi rawa pada lokasi sesuai','Karet','Kopi Robusta','Nanas','Kakao'], soilCue:'Tidal, swamp, alluvial and upland soils are not interchangeable; assess acidity, waterlogging and seasonal flood depth.'},
    {name:'Bengkulu', kind:'humid-upland', zone:'Rainy coastal belt and hilly interior', intro:'Coffee, rice and tree crops suit different elevations and farm conditions. On hilly land, permanent cover and contour practices are useful candidates for reducing runoff.', focus:'Coffee-based agroforestry and erosion reduction', crops:['Kopi Robusta','Padi sawah','Kelapa','Kakao','Lada','Sayuran'], soilCue:'High rainfall and varied slopes make soil erosion, drainage and soil depth essential checks.'},
    {name:'Lampung', kind:'mixed-lowland', zone:'Lowland plains, rolling uplands and seasonally dry areas', intro:'Rice and maize coexist with cassava, coffee and other crops. Crop planning should match water availability and land capability; protect slopes and avoid repeated soil exposure on cassava fields.', focus:'Soil cover, crop rotation and water-efficient systems', crops:['Padi sawah','Jagung','Singkong','Kopi Robusta','Lada','Tebu'], soilCue:'Rainfall and soil conditions vary between uplands and plains. Check erosion susceptibility, acidity, compaction and dry-season water access.'},
    {name:'Kepulauan Bangka Belitung', kind:'islands', zone:'Small islands, coastal landscapes and humid lowlands', intro:'Island agriculture faces limited land, variable soil depth and water availability, alongside coastal ecosystem pressures. Diversification and careful soil protection are priorities.', focus:'Mixed gardens, water conservation and coastal buffers', crops:['Lada','Kelapa','Karet pada lokasi sesuai','Ubi kayu','Padi lokal pada lahan sesuai','Buah-buahan'], soilCue:'Island soils can be shallow, sandy or strongly weathered in places. Test water availability, acidity and organic matter before scaling up.'},
    {name:'Kepulauan Riau', kind:'islands', zone:'Small islands, coastal soils and limited freshwater resources', intro:'A small-island approach fits better than a single large-scale cropping template. Focus on diversified gardens, local food, efficient water use and protecting mangrove/coastal buffers.', focus:'Smallholder mixed gardens and efficient water use', crops:['Kelapa','Ubi kayu','Sayuran skala kebun','Buah tropis','Sagu di habitat yang sesuai'], soilCue:'Freshwater availability, shallow soils, salinity and exposure to coastal winds may limit crop choices on some islands.'},
    {name:'DKI Jakarta', kind:'urban', zone:'Dense urban area with limited agricultural land', intro:'The province is better approached through urban and peri-urban food systems than broad-acre farming. Rooftop gardens, community plots, composting and short supply chains may be relevant where space and regulations allow.', focus:'Urban food growing and circular organic waste', crops:['Sayuran daun','Cabai dalam wadah','Herbs','Microgreens','Buah dalam pot pada lokasi sesuai'], soilCue:'For container and urban growing, assess growing media safety, water quality, drainage and possible contamination; do not assume urban soil is food-safe.'},
    {name:'Jawa Barat', kind:'humid-upland', zone:'Irrigated plains, volcanic uplands and steep hills', intro:'Rice, horticulture, tea and tree crops occur across very different elevations and market zones. High rainfall on slopes increases the value of groundcover, contour planting and careful road/drainage design.', focus:'Protect upland soil while sustaining irrigated food production', crops:['Padi sawah','Sayuran dataran tinggi','Teh','Kopi','Buah-buahan','Kakao pada lokasi sesuai'], soilCue:'Volcanic uplands, river plains and steep slopes have different soil constraints. Test soil and map slope rather than applying one province-wide recipe.'},
    {name:'Jawa Tengah', kind:'irrigated-lowland', zone:'Irrigated plains, volcanic slopes and seasonally dry areas', intro:'Rice production is important in suitable plains, while maize, sugarcane, tobacco and horticulture occur in other landscapes. Irrigation coordination and dry-season planning are crucial.', focus:'Water-smart rice systems and diversified rotations', crops:['Padi sawah','Jagung','Tebu','Tembakau sesuai lokasi','Kedelai','Sayuran'], soilCue:'Plains, volcanic slopes and drier northern/coastal zones need different water, drainage and nutrient management.'},
    {name:'DI Yogyakarta', kind:'mixed-lowland', zone:'Southern coastal plain, volcanic slopes and karst landscapes', intro:'Cropping conditions differ between irrigated areas, volcanic foothills and dry/karst landscapes. Crop selection should be aligned with soil depth and dependable dry-season water.', focus:'Water harvesting and matching crops to land capability', crops:['Padi sawah','Jagung','Ubi kayu','Salak pada lokasi sesuai','Cabai','Kacang tanah'], soilCue:'Karst and shallow soils in some areas contrast with deeper volcanic soils and irrigated plains. Check soil depth and available water first.'},
    {name:'Jawa Timur', kind:'mixed-lowland', zone:'Irrigated plains, dryland uplands and volcanic landscapes', intro:'Rice, maize, sugarcane, tobacco and horticulture are grown under varied rainfall and irrigation conditions. Dryland soil conservation and efficient irrigation can be as important as crop selection.', focus:'Dry-season water management and diversified cropping', crops:['Padi sawah','Jagung','Tebu','Kedelai','Tembakau sesuai lokasi','Mangga'], soilCue:'Water availability changes across the province. Assess salinity near coasts, slope erosion in uplands and irrigation reliability in plains.'},
    {name:'Banten', kind:'mixed-lowland', zone:'Coastal plains, uplands and peri-urban areas', intro:'Rice, cassava, coconut and horticulture occupy distinct settings. Protecting catchments and retaining soil cover can help farms dealing with heavy rainfall and expanding urban land use.', focus:'Mixed farming, erosion reduction and soil cover', crops:['Padi sawah','Singkong','Kelapa','Jagung','Buah-buahan','Sayuran'], soilCue:'Coastal, lowland and upland soils vary. Check drainage/flood exposure, erosion and possible salinity before crop planning.'},
    {name:'Bali', kind:'irrigated-lowland', zone:'Terraced uplands, volcanic landscapes and coastal plains', intro:'Rice terraces, horticulture and perennial crops rely on highly place-specific water and land management. Protect irrigation systems, terrace stability and soil organic matter.', focus:'Maintain terrace function and efficient irrigation', crops:['Padi sawah','Kopi','Kakao','Salak pada lokasi sesuai','Sayuran','Kelapa'], soilCue:'Volcanic uplands and coastal plains differ. On terraces, inspect bund integrity, slope stability and irrigation water before changes to cropping.'},
    {name:'Nusa Tenggara Barat', kind:'dryland', zone:'Seasonally dry islands with irrigated pockets', intro:'Dry-season water limitation is a major planning factor beyond reliable irrigation areas. Drought-adapted crops, water harvesting, residue retention and mixed crop–livestock systems are useful options to evaluate.', focus:'Water retention and resilient seasonal cropping', crops:['Padi pada area beririgasi','Jagung','Sorgum','Kacang hijau','Kedelai','Jambu mete'], soilCue:'Rainfall seasonality, wind exposure and shallow soils in some locations make moisture storage, erosion and organic matter key checks.'},
    {name:'Nusa Tenggara Timur', kind:'dryland', zone:'Seasonally dry savannas, hills and scattered irrigated valleys', intro:'Water availability and variable rainfall drive many farming decisions. Local maize, sorghum, legumes, tree crops and livestock-integrated systems may fit different microclimates.', focus:'Drought-resilient farming and water harvesting', crops:['Jagung','Sorgum','Kacang hijau','Jambu mete','Asam','Ubi-ubian lokal'], soilCue:'Assess soil depth, erosion, water-holding capacity and the length of the local dry season before selecting crops.'},
    {name:'Kalimantan Barat', kind:'peat-wet', zone:'Humid lowlands, river basins, peat landscapes and interior hills', intro:'Farms span wet lowlands and inland areas. Where peat occurs, avoid new drainage and prioritize water management; on mineral soils, maintain cover and diversify tree-based systems.', focus:'Peat-aware water management and diversified agroforestry', crops:['Padi sawah','Kelapa','Karet','Lada','Kakao','Sagu pada lokasi sesuai'], soilCue:'Peat, riverine alluvium and upland mineral soils require distinct management. Verify the actual soil unit and water regime.'},
    {name:'Kalimantan Tengah', kind:'peat-wet', zone:'Large lowland peatlands, rivers and interior mineral-soil areas', intro:'Peat fire risk and water-table management are essential in peat landscapes. Agricultural options on mineral soils should be assessed separately and must not be used to justify draining peat.', focus:'Peat rewetting, fire prevention and low-impact land use', crops:['Padi pada lahan sesuai','Rotan dalam sistem sesuai','Karet pada mineral soil yang sesuai','Buah lokal','Sagu pada habitat sesuai'], soilCue:'Differentiate peat thickness, hydrology, acid sulfate conditions and mineral soils. Drainage can create serious subsidence and fire risks on peat.'},
    {name:'Kalimantan Selatan', kind:'peat-wet', zone:'Tidal plains, swamps, river basins and rolling uplands', intro:'Rice and horticulture need careful water control in tidal/swamp locations; upland tree crops require separate soil and slope evaluation. Avoid generic drainage recommendations.', focus:'Tidal water control and soil acidity management', crops:['Padi rawa pada lokasi sesuai','Padi sawah','Jagung','Karet','Kelapa','Hortikultura'], soilCue:'Tidal water level, flooding, acidity and salinity are important in wetland areas; uplands have different erosion and drainage concerns.'},
    {name:'Kalimantan Timur', kind:'humid-upland', zone:'Coastal lowlands, river basins and forested interior uplands', intro:'Mixed local food crops and perennial systems are best planned with forest and water safeguards. On slopes, maintain permanent cover and avoid expanding onto unsuitable land.', focus:'Agroforestry and land-use safeguards around watersheds', crops:['Padi pada lahan sesuai','Kakao','Lada','Kelapa','Buah lokal','Umbi lokal'], soilCue:'River plains and hilly interior landscapes vary widely. Check slope stability, erosion, drainage and nearby forest/watershed restrictions.'},
    {name:'Kalimantan Utara', kind:'humid-upland', zone:'Humid coastal zone, river corridors and forested uplands', intro:'Remote landscapes and diverse ecosystems favour locally adapted mixed farming where appropriate. Prioritize soil cover, watersheds and locally proven crops over broad-acre prescriptions.', focus:'Mixed agroforestry and watershed protection', crops:['Padi lokal','Kakao pada lokasi sesuai','Kelapa','Buah lokal','Umbi lokal','Sayuran'], soilCue:'Floodplain and upland soils require different approaches. Soil mapping may be limited in remote locations; validate locally before investment.'},
    {name:'Sulawesi Utara', kind:'humid-upland', zone:'Volcanic uplands, coastal plains and humid island landscapes', intro:'Rice, coconut, clove and horticulture fit distinct landscapes. Perennial systems benefit from soil cover and targeted nutrient management, while steep slopes require erosion controls.', focus:'Perennial-crop diversification and slope conservation', crops:['Kelapa','Cengkeh','Padi sawah','Sayuran','Pala','Kakao'], soilCue:'Volcanic uplands and coastal settings differ; slope, drainage, soil depth and local nutrient status should guide crop choice.'},
    {name:'Sulawesi Tengah', kind:'mixed-lowland', zone:'Mountain basins, coastal plains and seasonally dry valleys', intro:'Cacao, rice, maize and coconut occur across mixed production zones. Protect slopes in wetter areas and manage soil moisture carefully in drier valleys.', focus:'Cacao agroforestry and soil-moisture management', crops:['Kakao','Padi sawah','Jagung','Kelapa','Kopi','Durian'], soilCue:'Coastal dry pockets and rainy highlands need different crop calendars and soil conservation approaches.'},
    {name:'Sulawesi Selatan', kind:'irrigated-lowland', zone:'Major rice plains, dryland plateaus and mountainous catchments', intro:'Rice production areas coexist with maize, cacao, coffee and horticulture. Keep irrigation plans coordinated and maintain soil cover on dryland slopes and uplands.', focus:'Water-efficient rice and dryland crop rotations', crops:['Padi sawah','Jagung','Kakao','Kopi','Bawang merah','Kacang-kacangan'], soilCue:'Soil moisture, irrigation reliability and slope differ greatly between plains, plateaus and uplands.'},
    {name:'Sulawesi Tenggara', kind:'mixed-island', zone:'Coastal islands, dryland areas and humid interior hills', intro:'Coconut, cashew, cacao and food crops are candidates in suitable locations. Coastal vegetation, island freshwater and slope cover should be considered in farm planning.', focus:'Tree-crop systems, water storage and coastal buffers', crops:['Jambu mete','Kelapa','Kakao','Jagung','Ubi kayu','Padi di lokasi sesuai'], soilCue:'On islands and dryland areas, check soil depth, salinity, moisture retention and freshwater access; hills need erosion control.'},
    {name:'Gorontalo', kind:'dryland', zone:'Seasonally dry valleys, rolling hills and coastal lowlands', intro:'Maize is a prominent crop in the region, but drought risk and erosion should shape field-level decisions. Retain residues and diversify rotations where locally suitable.', focus:'Moisture retention and erosion-aware maize systems', crops:['Jagung','Padi pada area irigasi','Kelapa','Kakao','Kedelai','Kacang tanah'], soilCue:'Dry-season moisture stress and runoff on slopes can limit yield. Assess soil depth, organic matter and rainfall timing.'},
    {name:'Sulawesi Barat', kind:'humid-upland', zone:'Coastal strip and hilly, humid interior', intro:'Cacao, coconut and coffee are candidates for diversified farms, with protection for sloping land and riparian areas. Soil cover helps keep nutrients on farm during heavy rains.', focus:'Cacao agroforestry and perennial ground cover', crops:['Kakao','Kelapa','Kopi','Padi sawah','Jagung','Durian'], soilCue:'Heavy-rain runoff and slope can drive soil loss. Verify drainage, acidity and nutrient status for each farm.'},
    {name:'Maluku', kind:'islands', zone:'Dispersed islands with humid tropical and coastal ecosystems', intro:'Island farm systems often depend on perennial crops and locally adapted food plants. Protect coastal buffers and manage water and soil carefully on steep island terrain.', focus:'Mixed tree gardens and protection of coastal watersheds', crops:['Pala','Cengkeh','Kelapa','Sagu','Ubi-ubian lokal','Kakao pada lokasi sesuai'], soilCue:'Island soils and freshwater supplies vary. Check slope, erosion, soil depth, salinity and proximity to coastal ecosystems.'},
    {name:'Maluku Utara', kind:'islands', zone:'Volcanic islands, coastal plains and humid uplands', intro:'Nutmeg, clove, coconut and local food crops may fit different island environments. Agroforestry and permanent cover can limit erosion on volcanic slopes.', focus:'Tree-crop agroforestry and slope protection', crops:['Pala','Cengkeh','Kelapa','Kakao','Padi pada lahan sesuai','Umbi lokal'], soilCue:'Volcanic soils can differ in depth and drainage even over short distances. Inspect slope stability and nutrient status before expanding crops.'},
    {name:'Papua', kind:'humid-upland', zone:'Extensive lowlands, wetlands, river systems and mountain areas', intro:'This province has very diverse landscapes and food systems. Separate lowland wetlands from upland gardens and avoid transferring recommendations between them without local evidence.', focus:'Locally adapted food systems and watershed protection', crops:['Sagu pada habitat sesuai','Ubi jalar','Padi pada lokasi sesuai','Kakao di zona sesuai','Kopi dataran tinggi','Umbi lokal'], soilCue:'Wetlands, floodplains and highlands require distinct assessments. In remote areas, prioritize community knowledge and parcel-level validation.'},
    {name:'Papua Barat', kind:'humid-upland', zone:'Humid coastal lowlands, islands and forested uplands', intro:'Mixed local food crops and perennial tree gardens should be planned around rainforest conservation, water quality and slope stability.', focus:'Agroforestry and low-impact land management', crops:['Pala','Kakao','Kelapa','Sagu','Umbi lokal','Buah tropis'], soilCue:'Coastal/island, wet lowland and upland soils differ. Map restrictions and watercourses before proposing new cultivation.'},
    {name:'Papua Selatan', kind:'peat-wet', zone:'Extensive lowlands, floodplains, wetlands and savanna mosaics', intro:'Seasonal flooding and wetland hydrology need to be understood before crop expansion. Keep food-security planning compatible with wetlands and local land-use rights.', focus:'Wetland-compatible agriculture and water-level planning', crops:['Sagu','Padi pada lahan yang sesuai','Umbi lokal','Jagung pada lokasi sesuai','Palawija sesuai kondisi'], soilCue:'Flood duration, water-table variation, acidity and wetland ecology are critical. Avoid drainage prescriptions until soil and hydrology are assessed.'},
    {name:'Papua Tengah', kind:'humid-upland', zone:'Mountain ranges, interior valleys and coastal lowlands', intro:'Elevation differences create distinct crop systems. Use local highland and lowland knowledge separately, and include slope stability and access in technology selection.', focus:'Highland soil conservation and local food diversification', crops:['Ubi jalar','Kopi dataran tinggi','Kakao di zona sesuai','Umbi lokal','Sayuran dataran tinggi','Padi di area sesuai'], soilCue:'Mountain slopes and valley soils differ. Check erosion, landslide susceptibility, drainage and soil depth before earthworks.'},
    {name:'Papua Pegunungan', kind:'highland', zone:'High-elevation valleys, mountain slopes and cool highland gardens', intro:'Highland food gardens need site-specific attention to slope, frost/cold exposure where relevant, drainage and soil fertility. Avoid applying lowland crop or fertilizer schedules directly.', focus:'Highland garden soil conservation and compost cycling', crops:['Ubi jalar','Kentang pada zona sesuai','Sayuran dataran tinggi','Umbi lokal','Kacang-kacangan sesuai elevasi'], soilCue:'Slope stability, shallow soils, erosion and cool highland conditions are important. Field advice should be based on local altitude and soils.'},
    {name:'Papua Barat Daya', kind:'islands', zone:'Island coasts, karst landscapes, lowlands and humid uplands', intro:'Island and coastal environments favour carefully planned mixed gardens and tree crops, while water security and habitat protection should remain central.', focus:'Mixed agroforestry, local food crops and coastal protection', crops:['Pala','Kelapa','Sagu pada habitat sesuai','Kakao pada lokasi sesuai','Umbi lokal','Buah tropis'], soilCue:'Karst, islands and coastal land can have shallow soils and constrained freshwater. Check soil depth, salinity and erosion exposure.'}
  ];

  profiles.forEach(function (p) {
    profileByName[norm(p.name)] = p;
  });
  profileByName[norm('Daerah Istimewa Yogyakarta')] = profileByName[norm('DI Yogyakarta')];
  profileByName[norm('D.I. Yogyakarta')] = profileByName[norm('DI Yogyakarta')];
  profileByName[norm('Kepulauan Bangka Belitung')] = profileByName[norm('Kepulauan Bangka Belitung')];

  var techByKind = {
    'humid-upland': [
      {title:'Contour planting & vegetative strips', icon:'🌿', problem:'Runoff and topsoil loss on sloping fields', action:'Plant along contour lines, keep living ground cover, and use locally appropriate grass/legume strips. Do not terrace slopes without a stability assessment.'},
      {title:'Agroforestry with permanent cover', icon:'🌳', problem:'Bare soil, unstable income and loss of tree cover', action:'Combine suitable perennial crops with shade trees and ground cover where species, local rights and market access support the system.'},
      {title:'Mulch & compost cycle', icon:'🍂', problem:'Organic-matter loss and exposed soil', action:'Retain safe crop residues, use mature compost and avoid burning residues. Adjust nutrient inputs after soil testing.'},
      {title:'Waterway and riparian buffers', icon:'💧', problem:'Sediment entering streams and irrigation channels', action:'Stabilize drainage paths and retain native vegetation along waterways; do not cultivate into river buffers.'}
    ],
    'peat-wet': [
      {title:'Water-table and drainage assessment', icon:'💧', problem:'Peat oxidation, fire risk or waterlogging', action:'Identify peat and mineral soils before construction. Where peat is present, avoid new drainage and follow peat rewetting/fire-prevention guidance.'},
      {title:'Fire prevention & community monitoring', icon:'🔥', problem:'Dry peat and landscape fire', action:'Maintain wetness on peat, plan early warning, manage ignition sources and coordinate with local fire-prevention programs.'},
      {title:'Raised-bed or tidal water control — only where suitable', icon:'🌾', problem:'Seasonal inundation in appropriate mineral/tidal soils', action:'Use local engineering and extension advice; first evaluate acidity, salinity, flood duration and impacts downstream.'},
      {title:'Mixed tree crops on suitable mineral soils', icon:'🌴', problem:'Dependence on a single crop or exposed soil', action:'Diversify only on suitable mineral soils after land capability, biodiversity safeguards and tenure have been checked.'}
    ],
    'dryland': [
      {title:'Rainwater harvesting & infiltration', icon:'💦', problem:'Short rainy season and dry spells', action:'Capture runoff safely with contour bunds, farm ponds or small infiltration structures designed for the slope and local rainfall.'},
      {title:'Drought-tolerant crop trials', icon:'🌽', problem:'Yield loss during dry periods', action:'Compare locally approved varieties and short-duration crops in small trial plots before scaling up.'},
      {title:'Mulch, residue retention & rotation', icon:'🍂', problem:'Rapid soil-moisture loss and erosion', action:'Retain residue when safe, rotate crops with legumes where suitable, and keep soil covered between crop cycles.'},
      {title:'Integrated crop–livestock planning', icon:'🐐', problem:'Seasonal feed shortages and nutrient loss', action:'Match herd size and fodder production to carrying capacity; compost manure safely and prevent grazing on recovering slopes.'}
    ],
    'irrigated-lowland': [
      {title:'Irrigation scheduling & field water control', icon:'💧', problem:'Water waste or uneven water supply', action:'Coordinate with irrigation managers and use locally validated water-saving methods where field level, soil and infrastructure allow.'},
      {title:'Rice-field soil and nutrient management', icon:'🌾', problem:'Unbalanced fertilizer and declining soil organic matter', action:'Use soil testing, balanced nutrients and safe organic amendments; compare results through farmer field trials.'},
      {title:'Crop rotation and cover between seasons', icon:'🌱', problem:'Bare fields and repeated pest pressure', action:'Use locally suitable legumes or cover crops where the crop calendar, water and market demand allow.'},
      {title:'Bund and drainage maintenance', icon:'🛠️', problem:'Flooding, leakage and soil loss', action:'Maintain field bunds and drains with neighbours; protect outlets and avoid shifting flood risk downstream.'}
    ],
    'mixed-lowland': [
      {title:'Crop rotation and intercropping', icon:'🌱', problem:'Soil depletion and production risk', action:'Plan combinations around compatible planting windows, soil moisture and markets; introduce legumes where agronomically suitable.'},
      {title:'Soil cover on erosion-prone fields', icon:'🍂', problem:'Runoff during heavy rain', action:'Use mulch, cover crops, contour strips and stable drainage paths, especially on sloping cassava/maize fields.'},
      {title:'Efficient irrigation for dry periods', icon:'💧', problem:'Water shortages during critical growth stages', action:'Prioritize water for sensitive growth stages, repair leaks and check water supply before changing crop patterns.'},
      {title:'Integrated pest management', icon:'🐞', problem:'Repeated pesticide use and pest outbreaks', action:'Monitor pests, use thresholds and cultural/biological controls, and choose registered products only when necessary.'}
    ],
    'islands': [
      {title:'Mixed home gardens & perennial crops', icon:'🌴', problem:'Small land parcels and limited crop diversity', action:'Combine local food crops and suitable tree crops while protecting native habitats and avoiding invasive species.'},
      {title:'Small-scale water storage', icon:'💧', problem:'Limited freshwater during dry periods', action:'Capture roof or runoff water safely, improve storage and use drip/micro-irrigation where maintenance is feasible.'},
      {title:'Coastal buffer protection', icon:'🌊', problem:'Erosion, salt spray and coastal hazards', action:'Protect mangroves and native coastal vegetation where naturally appropriate; do not plant mangroves on unsuitable habitats.'},
      {title:'Compost and safe growing media', icon:'♻️', problem:'Low organic matter or limited soil depth', action:'Use mature compost, keep containers well drained and test the safety of soil/media used for edible crops.'}
    ],
    'highland': [
      {title:'Contour gardens and stable drainage', icon:'⛰️', problem:'Slope erosion and unstable paths', action:'Plant along contours, keep drainage outlets stable and avoid large cuts or terraces without geotechnical guidance.'},
      {title:'Compost and residue recycling', icon:'🍂', problem:'Nutrient export from repeated harvests', action:'Return safe crop residues and compost to the garden; complement with soil-test-based nutrients where available.'},
      {title:'Locally adapted seed and crop calendar', icon:'🌱', problem:'Poor crop fit to elevation and climate', action:'Use local extension advice and community seed knowledge; test varieties in small plots across elevation zones.'},
      {title:'Agroforestry and wind protection', icon:'🌳', problem:'Exposure on suitable upland sites', action:'Use native or locally appropriate trees for wind protection and diversified production without shading crops excessively.'}
    ],
    'urban': [
      {title:'Container and raised-bed gardens', icon:'🪴', problem:'Limited space and uncertain soil safety', action:'Use traceable growing media in clean containers; test soil/water safety before producing food in potentially contaminated areas.'},
      {title:'Composting organic waste', icon:'♻️', problem:'Organic waste and input costs', action:'Compost clean plant-based waste with appropriate management; avoid untreated sewage sludge or contaminated inputs.'},
      {title:'Drip irrigation and rainwater capture', icon:'💧', problem:'Water constraints and runoff', action:'Use low-flow watering and safe rainwater collection while preventing mosquito breeding and contamination.'},
      {title:'Community plots and short-cycle crops', icon:'🥬', problem:'Need for accessible local food', action:'Coordinate access, food-safe water, sunlight and maintenance with local communities and property managers.'}
    ]
  };

  function profileFor(name) {
    return profileByName[norm(name)] || {
      name:name, kind:'mixed-lowland', zone:'Regional landscape needs verification',
      intro:'A province-level starting profile is not enough to diagnose an individual farm. Use local agricultural extension data and site observations before selecting a crop or restoration method.',
      focus:'Build a site-specific baseline before investment',
      crops:['Locally established staple crops','Legumes suited to the local season','Locally adapted fruit/tree crops'],
      soilCue:'No province-specific soil measurement is asserted here. Soil type, drainage, depth, pH, salinity and slope must be checked at the actual field.'
    };
  }

  function buildTechCards(profile) {
    var list = techByKind[profile.kind] || techByKind['mixed-lowland'];
    return '<div class="tile-grid">' + list.map(function (item, i) {
      return '<article class="field-card"><div class="card-topline"><span class="card-emoji">' + item.icon +
        '</span><span class="mini-code">FIELD TECH ' + String(i + 1).padStart(2, '0') + '</span></div>' +
        '<h3>' + esc(item.title) + '</h3><p class="card-problem"><b>Target:</b> ' + esc(item.problem) +
        '</p><p>' + esc(item.action) + '</p></article>';
    }).join('') + '</div>';
  }

  function climateSelectionKey(selection) {
    selection = selection || currentProvince || {};
    return [
      String(selection.countryIso3 || selectedCountry && selectedCountry.iso3 || 'UNK').toUpperCase(),
      String(selection.adminLevel || activeAdminLevel || 1),
      norm(selection.name || 'unknown-region')
    ].join('|');
  }

  function geometryCentroid(feature) {
    var geometry = feature && feature.geometry;
    if (!geometry || !geometry.coordinates) return null;
    var polygonList = [];
    if (geometry.type === 'Polygon') polygonList = [geometry.coordinates];
    else if (geometry.type === 'MultiPolygon') polygonList = geometry.coordinates;
    else return null;

    function outerRingCentroid(ring) {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      var twiceArea = 0, cx = 0, cy = 0;
      for (var i = 0; i < ring.length - 1; i++) {
        var first = ring[i], second = ring[i + 1];
        if (!Array.isArray(first) || !Array.isArray(second)) continue;
        var cross = Number(first[0]) * Number(second[1]) - Number(second[0]) * Number(first[1]);
        twiceArea += cross;
        cx += (Number(first[0]) + Number(second[0])) * cross;
        cy += (Number(first[1]) + Number(second[1])) * cross;
      }
      if (Math.abs(twiceArea) < 1e-10) return null;
      return {
        longitude:cx / (3 * twiceArea),
        latitude:cy / (3 * twiceArea),
        weight:Math.abs(twiceArea) / 2
      };
    }

    var centroids = polygonList.map(function (polygon) {
      return outerRingCentroid(polygon && polygon[0]);
    }).filter(function (point) {
      return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
    });
    if (centroids.length) {
      var weight = centroids.reduce(function (sum, point) { return sum + point.weight; }, 0);
      if (weight > 0) {
        var longitude = centroids.reduce(function (sum, point) { return sum + point.longitude * point.weight; }, 0) / weight;
        var latitude = centroids.reduce(function (sum, point) { return sum + point.latitude * point.weight; }, 0) / weight;
        if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
          return { latitude:latitude, longitude:longitude, method:'polygon area-weighted representative point' };
        }
      }
    }

    // Last-resort fallback for small or degenerate shapes; it is still only a proxy.
    var points = [];
    function collect(value) {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        points.push(value);
        return;
      }
      value.forEach(collect);
    }
    collect(geometry.coordinates);
    if (!points.length) return null;
    var lon = points.reduce(function (sum, point) { return sum + point[0]; }, 0) / points.length;
    var lat = points.reduce(function (sum, point) { return sum + point[1]; }, 0) / points.length;
    return Number.isFinite(lat) && Number.isFinite(lon)
      ? { latitude:lat, longitude:lon, method:'vertex-average fallback' }
      : null;
  }

  function climateResultForSelection(selection) {
    return climateResultsBySelection[climateSelectionKey(selection)] || null;
  }

  function climatePreviewMarkup() {
    var levelName = currentProvince && currentProvince.adminLevel === 2 ? 'district' : 'province / region';
    return '<section class="climate-preview-panel">' +
      '<div class="climate-preview-icon">🌦️</div><div class="climate-preview-copy">' +
      '<span class="mini-code">SEASONS / TEMPERATURE / WIND</span><h3>Climate & Planting Scout</h3>' +
      '<p id="climate-preview-status" aria-live="polite">Preparing climate profile for this ' + levelName + '…</p>' +
      '<div id="climate-preview-crops" class="climate-preview-candidates">Planting candidates will appear here after the climate lookup.</div>' +
      '<p class="climate-preview-note">Historical monthly patterns help screen planting windows. They are not a farm-level forecast or a guarantee of crop suitability.</p>' +
      '</div><button id="open-climate-tab" class="pixel-btn green" type="button">OPEN CLIMATE & PLANTING ↗</button>' +
      '</section>';
  }

  function averageClimateValue(values) {
    var valid = (values || []).filter(function (value) {
      return value != null && Number.isFinite(Number(value));
    }).map(Number);
    return valid.length ? valid.reduce(function (sum, value) { return sum + value; }, 0) / valid.length : null;
  }

  function updateClimatePreview() {
    updateRegionSummary();
    var statusNode = el('climate-preview-status');
    if (!statusNode || !currentProvince) return;
    var key = climateSelectionKey(currentProvince);
    var result = climateResultsBySelection[key];
    var status = climateStatusBySelection[key];
    if (result) {
      var climate = result.climate;
      var meanTemp = climate.monthly.map(function (month) { return month.temperatureMean; })
        .filter(function (value) { return value != null; });
      var annualRain = climate.monthly.reduce(function (sum, month) { return sum + (Number(month.precipitationMm) || 0); }, 0);
      var tempValue = meanTemp.length ? (averageClimateValue(meanTemp).toFixed(1) + ' °C') : 'n/a';
      statusNode.textContent = climate.startYear + '–' + climate.endYear + ' climate ready · average temperature ' + tempValue +
        ' · estimated annual rainfall ' + Math.round(annualRain) + ' mm.';
      var candidateNode = el('climate-preview-crops');
      if (candidateNode) {
        candidateNode.innerHTML = (result.recommendations || []).slice(0,3).map(function (crop) {
          var window = crop.bestWindow || {};
          return '<span class="climate-candidate-chip"><b>' + esc(crop.name) + '</b><small>Try ' + esc(window.month || '—') + ' · ' + esc(window.score == null ? '—' : window.score) + '/100</small></span>';
        }).join('');
      }
    } else if (status && status.state === 'error') {
      statusNode.textContent = 'Climate data unavailable: ' + status.message + ' You can retry in Climate & Planting.';
    } else {
      statusNode.textContent = status && status.state === 'error'
        ? 'Climate data unavailable: ' + status.message + ' You can retry in Climate & Planting.'
        : 'Loading five complete years of monthly temperature, rainfall and wind for a representative point in this region…';
      var waitingNode = el('climate-preview-crops');
      if (waitingNode) waitingNode.textContent = 'Planting candidates will appear when the climate lookup finishes.';
    }
  }

  async function loadClimateForSelection(selection, force) {
    if (!selection) return;
    var key = climateSelectionKey(selection);
    if (force) {
      delete climateResultsBySelection[key];
      delete climateStatusBySelection[key];
      delete climatePromisesBySelection[key];
    }
    if (climateResultsBySelection[key]) {
      if (currentProvince === selection) updateClimatePreview();
      return climateResultsBySelection[key];
    }
    if (climatePromisesBySelection[key]) return climatePromisesBySelection[key];

    var api = window.BackToNatureAPI;
    var point = geometryCentroid(selection.feature);
    if (!point) {
      climateStatusBySelection[key] = { state:'error', message:'No representative map coordinate is available for this boundary.' };
      if (currentProvince === selection) updateClimatePreview();
      return null;
    }
    if (!api || !api.fetchHistoricalClimate || !api.rankPlantingWindows) {
      climateStatusBySelection[key] = { state:'error', message:'The climate API module is not available. Reload the page and retry.' };
      if (currentProvince === selection) updateClimatePreview();
      return null;
    }

    climateStatusBySelection[key] = { state:'loading' };
    if (currentProvince === selection) updateClimatePreview();
    var promise = (async function () {
      try {
        var climate = await api.fetchHistoricalClimate(point.latitude, point.longitude, 5);
        var recommendations = api.rankPlantingWindows(climate.monthly);
        var result = { climate:climate, recommendations:recommendations, point:point };
        climateResultsBySelection[key] = result;
        climateStatusBySelection[key] = { state:'ready' };
        return result;
      } catch (error) {
        climateStatusBySelection[key] = {
          state:'error',
          message:error && error.message ? error.message : 'The historical climate source could not be reached.'
        };
        return null;
      } finally {
        delete climatePromisesBySelection[key];
        if (currentProvince && climateSelectionKey(currentProvince) === key) {
          updateClimatePreview();
          if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
          if (el('province-modal').classList.contains('open') && currentTab === 'climate') {
            renderTab('climate');
          }
        }
      }
    })();
    climatePromisesBySelection[key] = promise;
    return promise;
  }

  function numberOrDash(value, suffix) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', {
      maximumFractionDigits:1,
      minimumFractionDigits:0
    }) + (suffix || '');
  }

  function renderLearningGuide(meaning, connection, recommendation, heading) {
    return '<section class="learning-guide">' +
      '<div class="learning-guide-heading"><span aria-hidden="true">🧭</span><div><div class="mini-code">MAKE SENSE OF THE DATA</div><h3>' + esc(heading || 'What does this tell us?') + '</h3></div></div>' +
      '<div class="learning-grid">' +
      '<article class="learning-item"><span class="learning-step">1</span><h4>What does it mean?</h4><p>' + esc(meaning) + '</p></article>' +
      '<article class="learning-item"><span class="learning-step">2</span><h4>How is it connected?</h4><p>' + esc(connection) + '</p></article>' +
      '<article class="learning-item"><span class="learning-step">3</span><h4>What can I do next?</h4><p>' + esc(recommendation) + '</p></article>' +
      '</div></section>';
  }

  function renderClimateLoading(profile, status) {
    var message = status && status.state === 'error'
      ? status.message
      : 'Retrieving and summarizing monthly weather from five complete calendar years…';
    var isError = status && status.state === 'error';
    return '<div class="tab-intro"><div class="eyebrow">CLIMATE & PLANTING / SEASON SCOUT</div>' +
      '<h2>When should we plant? 🌦️</h2><p>Seasonal windows for ' + esc(currentProvince && currentProvince.name || profile.name) +
      ', based on historical temperature, rainfall and wind at a representative point.</p></div>' +
      '<section class="climate-loading-panel"><div class="climate-big-icon">' + (isError ? '🧭' : '🌦️') + '</div>' +
      '<h3>' + (isError ? 'Could not build the climate profile' : 'Reading the seasons…') + '</h3><p>' + esc(message) + '</p>' +
      (isError ? '<button id="climate-retry" class="pixel-btn green" type="button">↻ RETRY CLIMATE LOOKUP</button>' : '<div class="climate-loading-bar"><span></span></div>') +
      '<p class="live-note">Source: Open-Meteo Historical Weather API. Network access or source availability may affect this panel.</p></section>';
  }

  function renderClimateAndPlanting(profile) {
    var key = climateSelectionKey(currentProvince);
    var result = climateResultsBySelection[key];
    var status = climateStatusBySelection[key];
    if (!result) return renderClimateLoading(profile, status);
    var climate = result.climate;
    var monthly = climate.monthly || [];
    var recommendations = result.recommendations || [];
    var annualRain = monthly.reduce(function (sum, month) { return sum + (Number(month.precipitationMm) || 0); }, 0);
    var meanTemp = averageClimateValue(monthly.map(function (month) { return month.temperatureMean; }));
    var maxRain = Math.max(1, ...monthly.map(function (month) { return Number(month.precipitationMm) || 0; }));
    var avgWind = averageClimateValue(monthly.map(function (month) { return month.windMeanKmh; }));
    var peakGust = Math.max.apply(null, monthly.map(function (month) { return Number(month.windGustMaxMeanKmh) || 0; }));
    var region = currentProvince && currentProvince.name || profile.name;
    var levelLabel = currentProvince && currentProvince.adminLevel === 2 ? 'district / local area' : 'province / region';
    var sortedRain = monthly.slice().sort(function (a,b) { return (Number(b.precipitationMm)||0)-(Number(a.precipitationMm)||0); });
    var wettest = sortedRain[0], driest = sortedRain[sortedRain.length-1];
    var dryBalanceMonths = monthly.filter(function (month) { return month.waterBalanceMm != null && Number(month.waterBalanceMm) < 0; }).length;
    var climateMeaning = 'The long-term climate near ' + region + ' averages about ' +
      (meanTemp == null ? 'an unreported temperature' : Number(meanTemp).toFixed(1) + ' °C') +
      '. Monthly rain changes through the year, so the same planting plan may not work in every season.';
    if (wettest && driest && wettest.label && driest.label) climateMeaning += ' The wetter part of the year is usually around ' + wettest.label + ', while ' + driest.label + ' is comparatively drier in this historical profile.';
    var climateConnection = 'Temperature affects how plants grow, while rainfall affects water supply. Soil texture, slope, drainage and irrigation decide how much of that water stays available to the crop. A large province can contain different local climates.';
    var climateAction = 'Use the planting windows as ideas to investigate, not orders to plant. Check this week’s forecast, inspect soil moisture and drainage, compare the local planting calendar, and ask agricultural extension before spending money on seed or fertiliser.';
    if (dryBalanceMonths) climateAction += ' The model shows rain below reference atmospheric water demand in ' + dryBalanceMonths + ' month(s); check real soil and water conditions in those periods.';
    var learnerGuide = renderLearningGuide(climateMeaning, climateConnection, climateAction, 'How should I read this season?');

    var monthCards = monthly.map(function (month) {
      var barWidth = Math.max(2, Math.min(100, ((Number(month.precipitationMm) || 0) / maxRain) * 100));
      var windCaution = Number(month.windMeanKmh) >= 25 || Number(month.windGustMaxMeanKmh) >= 50;
      return '<article class="climate-month-card">' +
        '<div class="climate-month-top"><b>' + esc(month.label) + '</b><span>Rain ' + esc(numberOrDash(month.precipitationMm,' mm')) + '</span></div>' +
        '<div class="climate-rain-track" aria-label="Rainfall relative to the wettest month"><span style="width:' + barWidth + '%"></span></div>' +
        '<p class="month-plain-note">' + esc(Number(month.precipitationMm) >= annualRain / Math.max(1,monthly.length) ? 'Usually a wetter-than-average month in this profile.' : 'Usually a drier-than-average month in this profile.') + '</p>' +
        '<details class="technical-details"><summary>See weather measurements</summary><div class="climate-month-metrics">' +
        '<span>Mean temperature</span><b>' + esc(numberOrDash(month.temperatureMean,' °C')) + '</b>' +
        '<span>Typical low–high</span><b>' + esc(numberOrDash(month.temperatureMin,'–') + numberOrDash(month.temperatureMax,' °C')) + '</b>' +
        '<span>Rainy days / month</span><b>' + esc(numberOrDash(month.rainyDays,' days')) + '</b>' +
        '<span>Reference ET₀</span><b>' + esc(numberOrDash(month.referenceEt0Mm,' mm')) + '</b>' +
        '<span>Rain − reference demand</span><b class="' + (month.waterBalanceMm != null && Number(month.waterBalanceMm) < 0 ? 'water-deficit' : '') + '">' + esc(numberOrDash(month.waterBalanceMm,' mm')) + '</b>' +
        '<span>Mean wind</span><b class="' + (windCaution ? 'wind-warning' : '') + '">' + esc(numberOrDash(month.windMeanKmh,' km/h')) + '</b>' +
        '<span>Strongest typical gust</span><b class="' + (windCaution ? 'wind-warning' : '') + '">' + esc(numberOrDash(month.windGustMaxMeanKmh,' km/h')) + '</b>' +
        '<span>Dominant wind direction</span><b>' + esc(month.windDirection || '—') + '</b></div>' +
        (windCaution ? '<p class="climate-wind-note">Wind exposure flag: consider local shelter and staking.</p>' : '') +
        '</details></article>';
    }).join('');

    var cropCards = recommendations.slice(0,6).map(function (crop, index) {
      var best = crop.bestWindow || {};
      var reasons = (best.reasons || []).slice(0,2).map(function (reason) { return '<li>' + esc(reason) + '</li>'; }).join('');
      var cautions = (best.cautions || []).slice(0,2).map(function (caution) { return '<li>' + esc(caution) + '</li>'; }).join('');
      return '<article class="climate-crop-card">' +
        '<div id="climate-photo-' + esc(crop.id) + '" class="climate-crop-photo"><div class="crop-image-placeholder"><span>🌱</span><b>Plant reference</b><small>Looking for a GBIF species photo first</small></div></div>' +
        '<div class="climate-crop-body"><div class="climate-crop-heading"><span class="data-tag green">SEASON SHORTLIST ' + String(index + 1).padStart(2,'0') + '</span></div>' +
        '<h3>' + esc(crop.name) + '</h3><p class="crop-local-name">' + esc(crop.local) + ' · <i>' + esc(crop.scientific) + '</i></p>' +
        '<p class="climate-start-month"><strong>Season to investigate:</strong> ' + esc(best.month || 'Not identified') + ' · about ' + esc(best.durationMonths || crop.climateRule && crop.climateRule.months || '—') + ' month(s)</p>' +
        '<p class="climate-current-month ' + esc(crop.currentMonthStatus === 'suitable' ? 'is-open' : crop.currentMonthStatus === 'caution' ? 'is-caution' : crop.currentMonthStatus === 'wait' ? 'is-wait' : 'is-unknown') + '"><strong>This month:</strong> ' + esc(crop.currentMonthStatus === 'suitable' ? 'historical climate looks broadly supportive' : crop.currentMonthStatus === 'caution' ? 'check conditions before planting' : crop.currentMonthStatus === 'wait' ? 'another month may be a better starting point' : 'season not verified') + '</p>' +
        '<p>' + esc(crop.note) + '</p>' +
        (reasons ? '<div class="crop-reason"><b>Why it appears on the list</b><ul>' + reasons + '</ul></div>' : '') +
        (cautions ? '<div class="crop-caution"><b>Check before planting</b><ul>' + cautions + '</ul></div>' : '') +
        '<details class="technical-details"><summary>See the screening figures</summary><p>These are provisional climate-screening values, not a probability of success or a yield forecast.</p>' +
        '<div class="climate-crop-meta"><span>Screening score ' + esc(best.score == null ? '—' : best.score) + '/100</span><span>Temperature range ' + esc(crop.climateRule.tempMin) + '–' + esc(crop.climateRule.tempMax) + ' °C</span><span>Window rainfall ' + esc(numberOrDash(best.totalRainMm,' mm')) + '</span><span>Mean wind ' + esc(numberOrDash(best.avgWindKmh,' km/h')) + '</span></div></details>' +
        '<p class="crop-photo-credit" id="climate-credit-' + esc(crop.id) + '">Reference photo source and license appear here when available.</p>' +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&amp;search=' + encodeURIComponent(crop.scientific) + '">Search more crop photos ↗</a>' +
        '</div></article>';
    }).join('');

    var methodWarnings = [];
    if (avgWind != null && avgWind >= 25) methodWarnings.push('Long-term average wind is high enough to merit checking windbreaks, lodging and exposed sites.');
    if (peakGust >= 50) methodWarnings.push('Monthly peak gust statistics show potentially damaging gust exposure in some months.');
    if (!methodWarnings.length) methodWarnings.push('The monthly averages did not trigger a generic high-wind flag. This does not rule out storms or local wind exposure.');

    return '<div class="tab-intro"><div class="eyebrow">SEASONS & PLANTING / WEATHER GUIDE</div>' +
      '<h2>When might planting work best? 🌱</h2><p>Here is the usual seasonal pattern around <b>' + esc(region) + '</b>. It is based on historical weather from ' + esc(climate.startYear) + '–' + esc(climate.endYear) + ', not a measurement of your own farm.</p></div>' +
      learnerGuide +
      '<div class="climate-summary-grid">' +
      '<article><span>YEARS COMPARED</span><b>' + esc(climate.startYear + '–' + climate.endYear) + '</b><small>five completed calendar years</small></article>' +
      '<article><span>AVERAGE TEMPERATURE</span><b>' + esc(numberOrDash(meanTemp,' °C')) + '</b><small>helps describe the growing climate</small></article>' +
      '<article><span>AVERAGE RAIN PER YEAR</span><b>' + esc(numberOrDash(annualRain,' mm')) + '</b><small>sum of typical monthly rainfall</small></article>' +
      '<article><span>AVERAGE WIND</span><b>' + esc(numberOrDash(avgWind,' km/h')) + '</b><small>local exposure still varies</small></article>' +
      '</div>' +
      '<details class="technical-details"><summary>Where did the weather sample come from?</summary><p>' + esc(levelLabel) + ' · approximate point ' + esc(climate.latitude) + ', ' + esc(climate.longitude) + '. Large or island-rich regions can contain very different microclimates.</p></details>' +
      '<div class="section-title"><span class="mini-code">THE YEAR AT A GLANCE</span><h3>How rain changes by month</h3></div>' +
      '<div class="climate-month-grid">' + monthCards + '</div>' +
      '<div class="section-title"><span class="mini-code">PLANTS TO INVESTIGATE</span><h3>Seasonal crop ideas</h3></div>' +
      '<p class="live-explainer">These are plants worth researching first because broad temperature and rainfall patterns may match their starter profiles. Soil, actual water supply, crop variety, pests, market access and local calendars can change the decision.</p>' +
      '<div class="climate-crop-grid">' + cropCards + '</div>' +
      '<details class="technical-details"><summary>Wind and data methods</summary><ul>' + methodWarnings.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' +
      '<p>Wind speed and gust figures are historical reference values, not storm forecasts. Historical weather source: <a target="_blank" rel="noopener noreferrer" href="https://open-meteo.com/en/docs/historical-weather-api">Open-Meteo Historical Weather API</a>. Crop temperature/rainfall bands are provisional app rules, not a verified global agronomic model. Confirm with local extension and soil tests.</p></details>';
  }

  function renderPlantImageCandidates(slot, credit, images, altText) {
    if (!slot) return;
    var candidates = Array.isArray(images) ? images.slice() : [];
    function tryCandidate(index) {
      if (index >= candidates.length) {
        slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>No usable photo could be loaded</b><small>Try the source record or the photo-search link below.</small></div>';
        if (credit) credit.textContent = 'No image URL could be loaded. Photo availability and reuse terms depend on the original record.';
        return;
      }
      var image = candidates[index] || {};
      var imageUrl = safeHttps(image.imageUrl);
      var fileUrl = safeHttps(image.fileUrl);
      if (imageUrl === '#' || fileUrl === '#') { tryCandidate(index + 1); return; }
      slot.innerHTML = '<a class="crop-image-link" href="' + esc(fileUrl) + '" target="_blank" rel="noopener noreferrer" title="Open the source record and photo details"><img src="' + esc(imageUrl) + '" alt="' + esc(altText || image.title || 'Plant reference photo') + '" loading="lazy" decoding="async"><span class="crop-image-open">OPEN SOURCE PHOTO ↗</span></a>';
      var imageNode = slot.querySelector('img');
      if (!imageNode) return;
      imageNode.onload = function () {
        if (slot.querySelector('img') !== imageNode || !credit) return;
        var licenseHref = safeHttps(image.licenseUrl);
        var sourceName = String(image.source || 'public data');
        var licenseText = String(image.license || 'Check the source record');
        credit.innerHTML = 'Photo source: <b>' + esc(sourceName) + '</b> · <a target="_blank" rel="noopener noreferrer" href="' + esc(fileUrl) + '">open record ↗</a><br>Credit: ' +
          esc(image.artist || 'See source record') + ' · License: ' +
          (licenseHref !== '#' ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(licenseHref) + '">' + esc(licenseText) + '</a>' : esc(licenseText));
      };
      imageNode.onerror = function () {
        if (slot.querySelector('img') !== imageNode) return;
        tryCandidate(index + 1);
      };
    }
    tryCandidate(0);
  }

  async function loadClimateCropPhotos(recommendations, selection) {
    var api = window.BackToNatureAPI;
    if (!api || !api.searchPlantImages) return;
    var key = climateSelectionKey(selection);
    var requestId = ++climatePhotoRequestId;
    if (climatePhotosLoadedBySelection[key]) return;
    climatePhotosLoadedBySelection[key] = true;
    for (var i = 0; i < Math.min(recommendations.length,4); i += 2) {
      var batch = recommendations.slice(i,i+2);
      await Promise.all(batch.map(async function (crop) {
        try {
          var images = await api.searchPlantImages(crop, 5);
          if (requestId !== climatePhotoRequestId || currentProvince !== selection) return;
          var slot = el('climate-photo-' + crop.id);
          var credit = el('climate-credit-' + crop.id);
          if (!slot) return;
          if (!images.length) {
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>No public photo found</b><small>Open the species search link below.</small></div>';
            if (credit) credit.textContent = 'No usable image was returned from GBIF or the fallback photo library.';
            return;
          }
          renderPlantImageCandidates(slot, credit, images, crop.name + ' (' + crop.scientific + ')');
        } catch (_) {
          if (requestId !== climatePhotoRequestId || currentProvince !== selection) return;
          var failedSlot = el('climate-photo-' + crop.id);
          var failedCredit = el('climate-credit-' + crop.id);
          if (failedSlot) failedSlot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo lookup unavailable</b><small>Check the connection, then open the source search.</small></div>';
          if (failedCredit) failedCredit.textContent = 'Photo search is temporarily unavailable. The crop and season screening still work without an image.';
        }
      }));
    }
    if (currentProvince !== selection || requestId !== climatePhotoRequestId) {
      delete climatePhotosLoadedBySelection[key];
    }
  }

  function wireClimatePreview() {
    var button = el('open-climate-tab');
    if (button) button.addEventListener('click', function () {
      renderTab('climate');
      if (currentProvince) loadClimateForSelection(currentProvince);
    });
  }

  function wireClimateControls() {
    var retryButton = el('climate-retry');
    if (retryButton) retryButton.addEventListener('click', function () {
      if (currentProvince) loadClimateForSelection(currentProvince, true);
      renderTab('climate');
    });
    var result = climateResultForSelection(currentProvince);
    if (result) loadClimateCropPhotos(result.recommendations, currentProvince);
  }


  function currentCountryIso3() {
    return String(currentProvince && currentProvince.countryIso3 ||
      selectedCountry && selectedCountry.iso3 || '').toUpperCase();
  }

  function countrySourceCardsMarkup(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      return '<p class="country-source-empty">No country-specific API preset has been reviewed for this country yet. Global country-filtered indicators remain available below.</p>';
    }
    return '<div class="source-list country-source-list">' + sources.map(function (source, index) {
      var links = '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(source.url)) + '">Official source ↗</a>';
      if (source.apiUrl && source.apiUrl !== source.url) links += ' <a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(source.apiUrl)) + '">Open API ↗</a>';
      return '<article class="source-card"><div class="source-index">' + String(index+1).padStart(2,'0') + '</div><div class="source-main">' +
        '<span class="mini-code">' + esc(source.access || source.kind || 'OFFICIAL SOURCE') + '</span>' +
        '<h3>' + esc(source.title) + '</h3><p>' + esc(source.description) + '</p>' +
        '<div class="country-source-links">' + links + '</div></div></article>';
    }).join('') + '</div>';
  }

  function renderFaoFoodPricePanel(countryIso3, countryName) {
    return '<section class="live-connectors fpma-panel"><div class="section-title"><span class="mini-code">FAO FPMA / PUBLIC API · NO LOGIN</span><h3>Food price intelligence · ' + esc(countryName || countryIso3) + '</h3></div>' +
      '<p class="live-explainer">Search publicly available domestic and market price series for this country. Prices retain the source currency, unit and market type. The 90-day change compares a recent observation with the closest available point around three months earlier; it is not a forecast.</p>' +
      '<div class="crop-lab-controls"><div class="crop-control"><label for="fpma-commodity-query">Commodity search</label><input id="fpma-commodity-query" type="search" value="rice" maxlength="60" placeholder="e.g. rice, maize, wheat, beans"></div></div>' +
      '<button id="fpma-fetch-btn" class="pixel-btn green" type="button">FETCH FOOD PRICES</button>' +
      '<div id="fpma-status" class="live-status" aria-live="polite">Not queried yet · no API key or account required</div>' +
      '<div id="fpma-results" class="live-results">Live values appear here after you run a query. Search terms must match commodity names published by the source.</div>' +
      '<p class="nature-method-note">Official API: <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://fpma-documentation.web.app/docs/api-docs/intro/">FAO FPMA API documentation ↗</a> · <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://fpma.fao.org/giews/v4/global/swagger/">API explorer ↗</a></p></section>';
  }

  function formatPriceValue(value, currency) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return (currency ? currency + ' ' : '') + Number(value).toLocaleString('en-US',{maximumFractionDigits:3});
  }

  function renderFaoFoodPriceResults(data) {
    var records = data && Array.isArray(data.series) ? data.series : [];
    if (!records.length) {
      return renderLearningGuide(
        'No matching published price series came back for this search. That does not mean the commodity has no price.',
        'Price records depend on which market, product name, unit and time period the source publishes for a country.',
        'Try another common name such as maize, wheat, beans or onion. If you find a series, compare only records with the same currency, unit and market type.',
        'No price match found'
      ) + '<p class="live-note">Searched ' + esc(data && data.searchedSeries || 0) + ' metadata series. No sample prices were substituted.</p>';
    }
    var cards = records.map(function (record) {
      var place = [record.market,record.priceType].filter(Boolean).join(' · ') || 'Market details not listed';
      var latest = record.latest;
      var latestText = latest ? formatPriceValue(latest.value,record.currency) : 'No published price value';
      var priceMeta = [record.unit,record.periodicity].filter(Boolean).join(' · ');
      var change = record.changePct90d == null ? 'Not enough comparable records' :
        ((record.changePct90d > 0 ? '+' : '') + record.changePct90d.toFixed(1) + '%');
      var changeMeaning = record.changePct90d == null ? 'There are not enough comparable dates to describe a change.' :
        record.changePct90d > 0 ? 'The most recent reported price is higher than the comparison point.' :
        record.changePct90d < 0 ? 'The most recent reported price is lower than the comparison point.' :
        'The most recent reported price is about the same as the comparison point.';
      return '<article class="simple-indicator-card"><h4>' + esc(record.commodity) + '</h4>' +
        '<div class="simple-indicator-value">' + esc(latestText) + '</div>' +
        '<p><b>Market:</b> ' + esc(place) + '</p><p><b>Reported:</b> ' + esc(latest && latest.date || 'date not provided') +
        (priceMeta ? ' · ' + esc(priceMeta) : '') + '</p><p><b>Compared with around three months earlier:</b> ' + esc(change) + '</p>' +
        '<details class="mini-explanation"><summary>What does this mean?</summary><p>' + esc(changeMeaning) +
        ' This is a comparison of reported prices, not a forecast and not an explanation of why the price changed.</p></details></article>';
    }).join('');
    var table = '<div class="live-table-wrap"><table class="live-table"><thead><tr><th>Commodity / market</th><th>Latest price</th><th>Observation date</th><th>90-day change</th><th>Series</th></tr></thead><tbody>';
    records.forEach(function (record) {
      var place = [record.market,record.priceType].filter(Boolean).join(' · ') || 'Market not specified in series metadata';
      var latest = record.latest;
      var latestText = latest ? formatPriceValue(latest.value,record.currency) : 'No populated price value';
      var priceMeta = [record.unit,record.periodicity].filter(Boolean).join(' · ');
      var change = record.changePct90d == null ? 'Not enough comparable points' :
        ((record.changePct90d > 0 ? '+' : '') + record.changePct90d.toFixed(1) + '%');
      table += '<tr><td><b>' + esc(record.commodity) + '</b><br><small>' + esc(place) + '</small></td>' +
        '<td>' + esc(latestText) + '<br><small>' + esc(priceMeta) + '</small>' +
        (latest && latest.valueUsd != null && Number.isFinite(latest.valueUsd) ? '<br><small>Approx. USD ' + esc(Number(latest.valueUsd).toLocaleString('en-US',{maximumFractionDigits:3})) + '</small>' : '') + '</td>' +
        '<td>' + esc(latest && latest.date || '—') + '</td><td>' + esc(change) +
        (record.reference && record.changePct90d != null ? '<br><small>vs ' + esc(record.reference.date) + '</small>' : '') + '</td>' +
        '<td><a class="text-link" target="_blank" rel="noopener noreferrer" href="https://fpma.fao.org/giews/v4/global/swagger/">Open source API ↗</a></td></tr>';
    });
    table += '</tbody></table></div>';
    var errors = data.errors && data.errors.length
      ? '<p class="live-note">Some matching series could not return price history: ' + esc(data.errors.map(function (error) { return error.commodity + ': ' + error.message; }).join(' · ')) + '</p>' : '';
    return renderLearningGuide(
      'These are prices reported by a particular market source on particular dates, in the currency and unit shown. Different markets can report different prices.',
      'Price changes can relate to season, transport, supply, demand and many other factors. This dataset describes what was reported; it does not establish the cause.',
      'Compare like with like: same commodity, market type, unit, currency and dates. Check local market prices before making a buying or selling decision.',
      'How to use food-price information'
    ) + '<div class="simple-indicator-grid">' + cards + '</div>' +
      '<details class="technical-details"><summary>See the complete price table and source series</summary>' + table + errors +
      '<p class="live-note">Country ' + esc(data.countryIso3) + ' · searched ' + esc(data.searchedSeries) +
      ' metadata series · retrieved ' + esc(new Date(data.retrievedAt).toLocaleString()) +
      '. A missing 90-day change means comparable observations were unavailable.</p></details>';
  }

  function renderWaporPublicApiPanel() {
    return '<section class="live-connectors wapor-public-api-panel"><div class="section-title"><span class="mini-code">FAO WAPOR V3 / PUBLIC API · NO LOGIN</span><h3>Water use & vegetation data catalog</h3></div>' +
      '<p class="live-explainer">Fetch the official WaPOR v3 mapset catalog for actual evapotranspiration, reference evapotranspiration, relative soil moisture, precipitation and vegetation productivity. This request returns dataset metadata and download links—not a measured value for this region.</p>' +
      '<button id="wapor-source-fetch-btn" class="pixel-btn green" type="button">FETCH WAPOR DATA CATALOG</button>' +
      '<div id="wapor-source-status" class="live-status" aria-live="polite">Not queried yet · no API key or account required</div>' +
      '<div id="wapor-source-results" class="live-results">No catalog metadata loaded.</div>' +
      '<p class="nature-method-note">FAO states WaPOR v3 API access requires no token or credentials. Geographic coverage, resolution and time range differ by layer.</p>' +
      '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en">Official FAO WaPOR data access guide ↗</a></section>';
  }

  function renderWorldBankIndicatorPanel(countryIso3, countryName) {
    return '<section class="live-connectors country-worldbank-panel"><div class="section-title"><span class="mini-code">GLOBAL API / COUNTRY-FILTERED</span><h3>Agriculture snapshot · ' + esc(countryName || countryIso3) + '</h3></div>' +
      '<p class="live-explainer">Fetch recent country-level agricultural indicators from the free World Bank API (no API key). Coverage and latest year differ by indicator. These are national indicators, not province, district or farm measurements.</p>' +
      '<button id="country-wb-fetch-btn" class="pixel-btn green" type="button">FETCH COUNTRY INDICATORS</button>' +
      '<div id="country-wb-status" class="live-status" aria-live="polite">Not queried yet</div>' +
      '<div id="country-wb-results" class="live-results">No figures are shown until the API responds.</div>' +
      '<p class="nature-method-note">Source: <a href="https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation" target="_blank" rel="noopener noreferrer">World Bank Indicators API documentation ↗</a></p></section>';
  }

  function renderOverview(profile) {
    var indonesiaProductionMarkup = currentCountryIso3() === 'IDN'
      ? '<section class="source-strip"><div><span class="mini-code">OFFICIAL PRODUCTION DATA / INDONESIA</span><h3>Rice area, productivity and output by province</h3><p>BPS provides official provincial paddy statistics. Open the source table to verify year and units.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html">OPEN BPS TABLE ↗</a></section>'
      : '';
    return '<div class="tab-intro"><div class="eyebrow">PROVINCE FIELD NOTE / ' + esc(profile.name.toUpperCase()) +
      '</div><h2>Welcome to ' + esc(profile.name) + '!</h2><p>' + esc(profile.intro) + '</p>' +
      '<div class="profile-stamp"><span>🌱</span><div><b>Starting field profile</b><small>Regional planning cues · not a field survey</small></div></div></div>' +
      '<div class="tile-grid overview-grid">' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🗺️</span><span class="mini-code">LANDSCAPE</span></div><h3>Regional setting</h3><p>' + esc(profile.zone) + '</p></article>' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🎯</span><span class="mini-code">MAIN QUEST</span></div><h3>Priority to investigate</h3><p>' + esc(profile.focus) + '</p></article>' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🌾</span><span class="mini-code">CROP IDEAS</span></div><h3>' + profile.crops.length + ' crop candidates</h3><p>Candidate crops to validate against elevation, soil, local water, varieties, markets and farmer knowledge.</p></article>' +
      '</div>' +
      '<section class="quest-panel"><div class="quest-icon">📜</div><div><div class="mini-code">TODAY\'S FIELD QUEST</div><h3>Know the site before you plant</h3><p>Choose a specific farm or landscape unit, collect soil and water observations, check local rainfall and consult the agricultural extension service. A province is too large to have one universal soil profile.</p></div></section>' +
      indonesiaProductionMarkup + climatePreviewMarkup();
  }

  function renderSoil(profile) {
    var soilChecks = [
      {n:'01',t:'Soil texture & depth',d:'Record sand/silt/clay feel, effective rooting depth, stones and any restrictive layer.'},
      {n:'02',t:'pH & nutrient status',d:'Use a representative soil test before deciding lime, fertilizer or amendments; do not guess a dose.'},
      {n:'03',t:'Drainage & water regime',d:'Note ponding, flood duration, dry-season moisture and water access. Check salinity in coastal or tidal sites.'},
      {n:'04',t:'Slope & erosion signs',d:'Map slope, rills, exposed roots, sediment movement and unstable drainage lines before earthworks.'}
    ];
    return '<div class="tab-intro"><div class="eyebrow">SOIL & LAND / CHECK BEFORE YOU INVEST</div><h2>What is under the ground?</h2><p>Soil conditions can change within a single district or farm. This module shows what to investigate and where to look for mapped evidence; it does not claim that laboratory measurements exist for every province.</p></div>' +
      '<section class="soil-profile"><div class="soil-profile-icon">🧪</div><div><span class="mini-code">REGIONAL LANDSCAPE CUE</span><h3>' + esc(profile.zone) + '</h3><p>' + esc(profile.soilCue) + '</p><span class="data-tag amber">Not a measured soil result</span></div></section>' +
      '<div class="section-title"><span class="mini-code">FIELD CHECKLIST</span><h3>Collect these four clues</h3></div><div class="tile-grid">' +
      soilChecks.map(function (c) { return '<article class="field-card checklist-card"><span class="check-number">' + c.n + '</span><h3>' + c.t + '</h3><p>' + c.d + '</p></article>'; }).join('') +
      '</div>' +
      (currentCountryIso3() === 'IDN'
        ? '<section class="source-strip"><div><span class="mini-code">INDONESIA ONLY / KEMENTAN</span><h3>Look up the actual soil unit</h3><p>The Ministry of Agriculture geoportal hosts detailed soil-map services in some areas, but coverage is not uniform nationwide. Confirm map scale and availability for the actual site.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://geoportal.pertanian.go.id/">OPEN KEMENTAN GEOPORTAL ↗</a></section>'
        : '<section class="source-strip"><div><span class="mini-code">COUNTRY DATA</span><h3>National soil and agriculture sources</h3><p>National soil surveys and agriculture portals differ by country. Open the Sources tab for reviewed official APIs and data portals for this selection.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://data.apps.fao.org/?lang=en">BROWSE OPEN GEOSPATIAL DATA ↗</a></section>') +
      '<section class="source-strip"><div><span class="mini-code">LANDSCAPE CONTEXT</span><h3>FAO Hand-in-Hand</h3><p>Use geospatial layers for broader context, then validate them against local observations and current official datasets.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://data.apps.fao.org/?lang=en">OPEN FAO MAP ↗</a></section>';
  }

  var cropLabRequestId = 0;

  function cropLabStatus(message, type) {
    var node = el('crop-lab-status');
    if (!node) return;
    node.className = 'live-status ' + (type || 'pending');
    node.textContent = message;
  }

  function renderCropLabForm() {
    return '<section class="live-connectors crop-lab">' +
      '<div class="section-title"><span class="mini-code">CROP & SOIL LAB / SMART FIELD GUIDE</span><h3>Find crops for your soil</h3></div>' +
      '<p class="live-explainer">Choose what you know about the plot. The screener compares your inputs with broad crop profiles and explains the match. It is a planning aid, not a yield forecast or an agronomist’s diagnosis.</p>' +
      '<div class="crop-lab-controls">' +
      '<div class="crop-control"><label for="crop-soil">Soil group</label><select id="crop-soil">' +
      '<option value="unknown">Not sure yet</option><option value="loam">Loam / balanced soil</option><option value="clay">Clay-rich soil</option><option value="sandy">Sandy / loose soil</option><option value="alluvial">Alluvial / river plain</option><option value="volcanic">Volcanic soil</option><option value="acidic">Strongly acidic soil</option><option value="peat">Peat / organic wetland</option><option value="saline">Coastal / saline soil</option>' +
      '</select></div>' +
      '<div class="crop-control"><label for="crop-ph">Soil pH (optional)</label><input id="crop-ph" type="number" min="0" max="14" step="0.1" inputmode="decimal" placeholder="e.g. 5.8"></div>' +
      '<div class="crop-control"><label for="crop-drainage">Drainage</label><select id="crop-drainage"><option value="unknown">Not sure</option><option value="well">Drains well</option><option value="moderate">Stays moist sometimes</option><option value="waterlogged">Often waterlogged / flooded</option></select></div>' +
      '<div class="crop-control"><label for="crop-water">Water availability</label><select id="crop-water"><option value="unknown">Not sure</option><option value="reliable">Reliable rain / irrigation</option><option value="seasonal">Seasonal water</option><option value="limited">Limited / dry season</option><option value="standing">Standing water available</option></select></div>' +
      '<div class="crop-control"><label for="crop-climate">Climate / growing zone</label><select id="crop-climate"><option value="unknown">Not sure</option><option value="humid-tropical">Humid tropical lowland</option><option value="seasonal-tropical">Seasonal tropical</option><option value="dry-tropical">Dry / semi-arid tropical</option><option value="highland-tropical">Cool tropical highland</option><option value="subtropical">Subtropical</option><option value="temperate">Temperate / cool season</option></select></div>' +
      '<div class="crop-control"><label for="crop-use">Main purpose</label><select id="crop-use"><option value="any">Any purpose</option><option value="staple">Staple food</option><option value="vegetable">Vegetables</option><option value="fruit">Fruit / perennial crop</option><option value="market">Market / cash crop</option><option value="restoration">Soil cover / restoration</option></select></div>' +
      '</div>' +
      '<div class="crop-lab-actions"><button id="crop-match-btn" class="pixel-btn green" type="button">🌱 FIND CROP MATCHES</button><span class="live-note">No location or personal data is sent by this soil screener.</span></div>' +
      '<div id="crop-lab-status" class="live-status" aria-live="polite">Choose your soil and conditions, then find crop matches.</div>' +
      '<div id="crop-match-results" class="crop-match-grid" aria-live="polite"></div>' +
      '</section>';
  }

  function renderCropMatchCards(crops) {
    if (!crops.length) return '<p>No crop ideas matched those inputs. Leave uncertain fields as “Not sure” and check the local soil and climate information.</p>';
    var cards = crops.map(function (crop, index) {
      var reasons = (crop.reasons || []).slice(0, 3).map(function (reason) {
        return '<li>' + esc(reason) + '</li>';
      }).join('');
      var cautions = (crop.cautions || []).slice(0, 2).map(function (caution) {
        return '<li>' + esc(caution) + '</li>';
      }).join('');
      return '<article class="crop-match-card">' +
        '<div class="crop-match-image" id="crop-image-' + esc(crop.id) + '"><div class="crop-image-placeholder"><span>🌱</span><b>Searching GBIF for a plant photo…</b><small>Public biodiversity records first</small></div></div>' +
        '<div class="crop-match-body">' +
        '<div class="crop-match-topline"><span class="data-tag green">CROP IDEA ' + String(index + 1).padStart(2, '0') + '</span></div>' +
        '<h4>' + esc(crop.name) + '</h4><p class="crop-local-name">' + esc(crop.local) + ' · <i>' + esc(crop.scientific) + '</i></p>' +
        '<p>' + esc(crop.note) + '</p>' +
        (reasons ? '<div class="crop-reason"><b>Why it appears on the list</b><ul>' + reasons + '</ul></div>' : '') +
        (cautions ? '<div class="crop-caution"><b>Check before planting</b><ul>' + cautions + '</ul></div>' : '') +
        '<details class="technical-details"><summary>See the screening details</summary>' +
        '<p>This is a rule-based shortlist, not a probability of success, yield forecast, or soil diagnosis.</p>' +
        '<div class="crop-match-meta"><span>Screening score ' + esc(crop.score) + '/100</span><span>pH profile ' + esc(crop.pHText) + '</span><span>Crop group ' + esc(crop.category.replace(/-/g, ' ')) + '</span></div></details>' +
        '<p class="crop-photo-credit" id="crop-credit-' + esc(crop.id) + '">Photo credit and license will be shown when a suitable image is available.</p>' +
        '</div></article>';
    }).join('');
    return renderLearningGuide(
      'This shortlist compares your answers with broad starter profiles for different crops. It helps you decide what to investigate first.',
      'Soil texture, pH, drainage, water supply and climate work together. A strong match for one condition can still be a poor choice if another important condition is wrong.',
      'Read the reasons and cautions, confirm pH with a real soil test, check local varieties and season, and ask an extension worker before buying seed or changing the land.',
      'How to use these crop ideas'
    ) + cards;
  }

  async function loadCropPhotos(crops, requestId) {
    var api = window.BackToNatureAPI;
    if (!api || !api.searchPlantImages) {
      cropLabStatus('Crop matches are ready, but the public photo lookup is unavailable. Reload the page and try again.', 'error');
      return;
    }
    var successCount = 0;
    var errorCount = 0;
    for (var i = 0; i < Math.min(crops.length, 4); i += 2) {
      var batch = crops.slice(i, i + 2);
      await Promise.all(batch.map(async function (crop) {
        try {
          var images = await api.searchPlantImages(crop, 5);
          if (requestId !== cropLabRequestId) return;
          var slot = el('crop-image-' + crop.id);
          var credit = el('crop-credit-' + crop.id);
          if (!slot) return;
          if (!images.length) {
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>No public photo found</b><small>Try the photo-search link below.</small></div>';
            if (credit) credit.innerHTML = '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.gbif.org/occurrence/search?scientific_name=' + encodeURIComponent(crop.scientific) + '">Search species observations on GBIF ↗</a> · <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&amp;search=' + encodeURIComponent(crop.scientific) + '">Search Commons ↗</a>';
            return;
          }
          renderPlantImageCandidates(slot, credit, images, crop.name + ' (' + crop.scientific + ')');
          successCount++;
        } catch (_) {
          if (requestId !== cropLabRequestId) return;
          errorCount++;
          var failedSlot = el('crop-image-' + crop.id);
          var failedCredit = el('crop-credit-' + crop.id);
          if (failedSlot) failedSlot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo lookup unavailable</b><small>Try again when the source is reachable.</small></div>';
          if (failedCredit) failedCredit.textContent = 'No sample image was substituted. You can still review the crop screening and open a public species search.';
        }
      }));
    }
    if (requestId === cropLabRequestId) {
      var note = el('crop-photo-status');
      if (note) note.textContent = successCount + ' crop photo searches returned candidates; ' + errorCount + ' request(s) could not be completed. GBIF is checked first and Wikimedia Commons is only a fallback.';
    }
  }

  function wireCropLab(profile) {
    var button = el('crop-match-btn');
    var resultNode = el('crop-match-results');
    if (!button || !resultNode) return;
    button.addEventListener('click', async function () {
      var api = window.BackToNatureAPI;
      if (!api || !api.listCropRecommendations) {
        cropLabStatus('Crop screening API is not available. Reload this page and try again.', 'error');
        return;
      }
      var phInput = el('crop-ph');
      var phValue = phInput ? phInput.value.trim() : '';
      if (phValue && (!Number.isFinite(Number(phValue)) || Number(phValue) < 0 || Number(phValue) > 14)) {
        cropLabStatus('Soil pH must be between 0 and 14. Leave it blank if you do not have a soil test.', 'error');
        if (phInput) phInput.focus();
        return;
      }
      var requestId = ++cropLabRequestId;
      button.disabled = true;
      cropLabStatus('Comparing soil, drainage, water and climate with the crop library…', 'pending');
      resultNode.innerHTML = '';
      try {
        var matches = api.listCropRecommendations({
          soil:el('crop-soil').value,
          ph:phValue,
          drainage:el('crop-drainage').value,
          water:el('crop-water').value,
          climate:el('crop-climate').value,
          use:el('crop-use').value
        });
        if (requestId !== cropLabRequestId) return;
        resultNode.innerHTML = renderCropMatchCards(matches);
        if (!matches.length) {
          cropLabStatus('No screening matches. Change a filter or leave unknown fields open.', 'pending');
          return;
        }
        cropLabStatus('Found ' + matches.length + ' crops to investigate. Loading reference photos for the first four…', 'pending');
        await loadCropPhotos(matches, requestId);
      } catch (error) {
        if (requestId === cropLabRequestId) cropLabStatus('Could not complete crop screening: ' + (error && error.message ? error.message : 'Unknown error'), 'error');
      } finally {
        if (requestId === cropLabRequestId) button.disabled = false;
      }
    });
  }

  function renderCrops(profile) {
    var chips = profile.crops.map(function (crop, i) {
      return '<article class="crop-card"><div class="crop-glyph">' + ['🌾','🌱','🌴','🥬','🍠'][i % 5] + '</div><div><span class="mini-code">REGIONAL CANDIDATE ' + String(i + 1).padStart(2, '0') + '</span><h3>' + esc(crop) + '</h3><p>Investigate local suitability, water needs, varieties, pest pressure, harvest window, costs and market access before choosing.</p></div></article>';
    }).join('');
    return '<div class="tab-intro"><div class="eyebrow">CROPS / WHAT SHOULD WE PLANT?</div><h2>Find the right plant for your plot 🌾</h2><p>Start with the soil and water you actually have. The screening results explain what matched and what still needs checking. Results are broad guides—not a parcel-level agronomic diagnosis, yield prediction or guarantee of success.</p></div>' +
      renderCropLabForm() +
      '<div class="section-title"><span class="mini-code">REGIONAL STARTING IDEAS</span><h3>Plants worth investigating in ' + esc(profile.name) + '</h3></div>' +
      '<div class="crop-list">' + chips + '</div>' +
      '<div class="section-title"><span class="mini-code">FIELD CHECKLIST</span><h3>Before buying seed or seedlings</h3></div>' +
      '<div class="tile-grid">' +
      '<article class="field-card"><div class="card-emoji">💧</div><h3>1. Water fit</h3><p>Is rain timing or irrigation reliable through the crop growth stages? Do not expand planted area beyond dependable water supply.</p></article>' +
      '<article class="field-card"><div class="card-emoji">🧪</div><h3>2. Soil fit</h3><p>Check soil depth, drainage, pH and nutrient status. Get a local soil test before deciding lime or fertilizer rates.</p></article>' +
      '<article class="field-card"><div class="card-emoji">🌱</div><h3>3. Seed and season</h3><p>Use locally recommended varieties and certified/traceable planting material where available. Confirm local planting windows with extension services.</p></article>' +
      '<article class="field-card"><div class="card-emoji">🧺</div><h3>4. Market and labour</h3><p>Compare input costs, labour, storage, harvest losses, transport, buyers and household food needs before converting land to a cash crop.</p></article>' +
      '</div>' +
      '<section class="source-strip"><div><span class="mini-code">NEXT QUEST</span><h3>Need province-level production statistics?</h3><p>Use the official BPS table for rice harvested area, productivity and output. It is a statistical source, not a field-level crop suitability assessment.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html">OPEN BPS DATA ↗</a></section>';
  }

  function renderFarmingSystemLibrary() {
    var systems = [
      {
        icon:'🚜', category:'SOIL-BASED', title:'Open-field / conventional farming',
        summary:'Plants grow directly in soil, in rows, beds or plots. Farmers manage soil, seed, water, weeds, pests and harvest.',
        best:'A plot with suitable soil, enough light and a workable water supply; it is the default comparison for many crops.',
        first:'Check soil texture and drainage, water access, sunlight, crop variety and the local planting calendar. Start with one small test bed.',
        watch:'Rainfall, soil fertility, weeds and pests can change results. “Conventional” does not automatically mean sustainable or unsustainable.',
        url:'https://www.fao.org/3/i2215e/i2215e.pdf', link:'FAO crop-production guide'
      },
      {
        icon:'🌧️', category:'WATER SOURCE', title:'Rainfed farming',
        summary:'The crop depends mainly on rain rather than a dependable irrigation system.',
        best:'Areas with a reliable seasonal rainy period and crops/varieties suited to local rainfall.',
        first:'Look at the start and end of the rainy season, likely dry spells, soil water-holding capacity and locally recommended seed.',
        watch:'A planting date on the calendar cannot guarantee rain. Keep soil covered and make a safe plan for dry spells.',
        url:'https://www.fao.org/land-water/water/agricultural-water-management/rainfed-agriculture/en', link:'FAO rainfed agriculture'
      },
      {
        icon:'💧', category:'WATER SOURCE', title:'Irrigated farming',
        summary:'Water is delivered to crops when rainfall is not enough, using a canal, pump, sprinkler, drip line or another system.',
        best:'Where the water source is legal, reliable, affordable and suitable for the crop.',
        first:'Confirm water availability across the whole season, water quality, energy/labour costs and safe drainage.',
        watch:'Irrigation is not “add as much water as possible”. Poor scheduling can waste water, damage roots or increase salinity.',
        url:'https://www.fao.org/land-water/water/agricultural-water-management/en', link:'FAO agricultural water management'
      },
      {
        icon:'🥬', category:'SOIL-LESS', title:'Hydroponics',
        summary:'Roots get dissolved plant nutrients from water, with or without an inert support such as coco coir or another growing medium. Field soil is not used.',
        best:'Often used for leafy vegetables and herbs where clean water, nutrients, a suitable place and regular monitoring are available.',
        first:'Learn safe nutrient mixing, water quality, pH and electrical conductivity (EC), hygiene, and how to handle a system failure.',
        watch:'It can save space, but it is not automatically cheap or easier: nutrient mistakes, contaminated water or a pump failure can affect many plants quickly. Some simple non-circulating systems do not need a pump.',
        url:'https://teca.apps.fao.org/en/technologies/8825/', link:'FAO TECA: simple hydroponics'
      },
      {
        icon:'🐟', category:'FISH + PLANTS', title:'Aquaponics',
        summary:'Fish farming and hydroponics are linked: helpful bacteria convert waste from fish into nutrients plants can use, and water circulates through the system.',
        best:'A learning project or farm that can manage fish care and plant production together—not just a tank with plants added.',
        first:'Plan fish welfare, filtration/biofilter capacity, water quality testing, oxygen, feeding and a safe backup plan before stocking fish.',
        watch:'Fish, bacteria and plants need a stable balance. A failure in water quality or oxygen can harm fish quickly; setup and monitoring are more complex than a basic garden.',
        url:'https://teca.apps.fao.org/en/technologies/8350/', link:'FAO TECA: design an aquaponics unit'
      },
      {
        icon:'🏡', category:'PROTECTED GROWING', title:'Greenhouse / net-house farming',
        summary:'A structure such as a greenhouse or insect net-house changes the growing environment or blocks some weather and pest pressure.',
        best:'Higher-value crops where protecting plants or extending the growing period can justify construction and daily management.',
        first:'Plan ventilation, temperature, humidity, light, irrigation, sanitation and the crop’s pollination needs. A net-house and a sealed greenhouse behave differently.',
        watch:'A structure does not eliminate heat, humidity or pests. Poor ventilation can make disease worse, and construction can be expensive.',
        url:'https://www.fao.org/family-farming/detail/en/c/1697565/', link:'FAO: protected cultivation factsheets'
      },
      {
        icon:'🪴', category:'SMALL SPACE', title:'Container, rooftop or vertical gardening',
        summary:'Plants grow in pots, sacks, raised beds or stacked structures using a suitable growing medium rather than open ground.',
        best:'Homes, schools, rooftops or small urban spaces with adequate sunlight and safe water.',
        first:'Use clean containers with drainage, known growing media, safe water and a plan for frequent watering and nutrient replacement.',
        watch:'Containers dry out faster than open ground; roofs must carry the load safely. Avoid vegetables in potentially contaminated soil or water.',
        url:'https://www.fao.org/family-farming/detail/en/c/1697565/', link:'FAO: protected and small-space cultivation'
      },
      {
        icon:'🌳', category:'TREES + CROPS', title:'Agroforestry / mixed farming',
        summary:'Trees or shrubs are deliberately combined with crops and sometimes livestock in a planned layout or sequence.',
        best:'Farms where compatible trees can add food, shade, fodder, soil protection or income without harming the main crop.',
        first:'Choose suitable species, check mature tree size, spacing, shade, root competition, land rights and the time before trees produce.',
        watch:'Trees can improve diversity, but the wrong species or layout can compete for light and water. Local context and long-term planning matter.',
        url:'https://www.fao.org/agroforestry/about-agroforestry/overview/', link:'FAO agroforestry overview'
      },
      {
        icon:'🍂', category:'SOIL PROTECTION', title:'Conservation agriculture',
        summary:'A soil-protection approach built around three ideas: disturb soil less, keep it covered, and diversify crops through rotation or association.',
        best:'Many rainfed and irrigated systems when the practices can be adapted to local crops, residues, weeds and equipment.',
        first:'Try appropriate residue cover, crop diversification and less disruptive planting methods on a small plot; plan how weeds will be managed.',
        watch:'It is not just “never till”. Results depend on local adaptation, weed management, machinery, soil and crop sequence.',
        url:'https://www.fao.org/conservation-agriculture/overview/conservation-agriculture-principles/en/', link:'FAO conservation agriculture principles'
      }
    ];
    var cards = systems.map(function (system, index) {
      return '<article class="farming-system-card">' +
        '<div class="farming-system-top"><span class="farming-system-icon" aria-hidden="true">' + system.icon + '</span><span class="mini-code">' + esc(system.category) + '</span></div>' +
        '<h4>' + esc(system.title) + '</h4><p>' + esc(system.summary) + '</p>' +
        '<details class="farming-system-details"><summary>When to use it and what to check</summary>' +
        '<p><b>When it may fit:</b> ' + esc(system.best) + '</p>' +
        '<p><b>Start by checking:</b> ' + esc(system.first) + '</p>' +
        '<p><b>Important limitation:</b> ' + esc(system.watch) + '</p>' +
        '<a class="text-link" href="' + esc(safeHttps(system.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(system.link) + ' ↗</a>' +
        '</details></article>';
    }).join('');
    return '<section class="farming-system-library">' +
      '<div class="section-title"><span class="mini-code">FARMING SYSTEMS 101</span><h3>Choose how you want to grow 🌱</h3></div>' +
      '<p class="live-explainer">“Traditional farming”, irrigation, hydroponics and greenhouses are not all the same kind of category. Some describe where roots grow, some describe the water source, and some describe structures. A farm can combine them—for example, a greenhouse with hydroponics.</p>' +
      '<div class="farming-system-grid">' + cards + '</div>' +
      '<p class="nature-method-note">These are learning summaries curated from public FAO guides, not promises of yield or a recommendation for every location. Check local crop, water, soil and food-safety advice before investing.</p>' +
      '</section>';
  }

  function renderFarming(profile) {
    var useGlobalClimatePortal = !!(currentProvince && currentProvince.countryIso3 && currentProvince.countryIso3 !== 'IDN');
    var climatePortalUrl = useGlobalClimatePortal ? 'https://climateknowledgeportal.worldbank.org/' : 'https://www.bmkg.go.id/';
    var climatePortalLabel = useGlobalClimatePortal ? 'CHECK CLIMATE CONTEXT' : 'CHECK BMKG';
    var plans = {
      'humid-upland': [
        ['Map the plot first','Mark slope direction, water paths, shade and existing trees. Avoid clearing steep or unstable ground before getting local technical advice.'],
        ['Keep soil covered','Retain safe residues, use mulch and keep living cover between rows. On slopes, plan planting lines along the contour.'],
        ['Establish the crop mix','Choose locally recommended varieties; introduce compatible shade or companion trees only where crop light needs and local extension advice support them.'],
        ['Manage soil and pests','Base fertilizer and lime decisions on soil tests. Scout pests regularly and prioritize integrated pest management before pesticide use.'],
        ['Record the result','Track rainfall, labour, inputs, yield, erosion signs and farm-gate price to learn what works for this specific site.']
      ],
      'peat-wet': [
        ['Identify peat, mineral and wetland areas','Check soil type, peat depth where relevant, flood duration and water-table variation before proposing a crop or earthwork.'],
        ['Plan water before planting','Where peat is present, do not create new drainage simply to fit a crop. Prioritize hydrology, rewetting and fire-prevention guidance.'],
        ['Choose a water-compatible system','Use crops only where soil, acidity, salinity, flooding and local land-use safeguards indicate they are suitable.'],
        ['Prevent fire and soil loss','Avoid burning. Coordinate water-level monitoring and fire preparedness with community and local authorities.'],
        ['Monitor the landscape','Record water level, flooding, subsidence signs, crop performance and downstream effects; adjust only with local technical advice.']
      ],
      'dryland': [
        ['Check the local rainfall window','Review recent rainfall and seasonal outlook. Plan around moisture available at establishment and flowering—not the calendar alone.'],
        ['Secure water and infiltration','Maintain safe water storage and infiltration measures appropriate to slope. Never build bunds or ponds without checking overflow and downstream effects.'],
        ['Select locally adapted seed','Compare drought-adapted or short-duration varieties recommended by local extension, and try them on a small area before scaling.'],
        ['Protect soil moisture','Retain suitable residues, mulch and control weeds early. Rotate with locally appropriate legumes where water and disease risk permit.'],
        ['Harvest and store safely','Prepare drying and storage before harvest, check moisture requirements for the crop and record losses as well as yield.']
      ],
      'irrigated-lowland': [
        ['Confirm the water schedule','Coordinate with the irrigation group and confirm when water is actually available. Check field level, inlet/outlet and drainage.'],
        ['Prepare the field carefully','Repair bunds and drains. Avoid overworking wet soil or shifting flood risk to neighbouring fields.'],
        ['Plant recommended varieties','Use locally appropriate seed and planting density guidance; crop calendars differ by district and irrigation schedule.'],
        ['Manage nutrients and pests','Use soil-test-based nutrient planning, safe organic amendments and pest scouting. Apply registered crop-protection products only when needed and as directed.'],
        ['Compare performance','Keep notes on water use, labour, input cost, harvested area and output to compare practices across seasons.']
      ],
      'mixed-lowland': [
        ['Classify the field','Separate irrigated, rainfed, sloping and flood-prone parts. One farm may need more than one crop plan.'],
        ['Plan crop sequence','Match planting windows, water and market demand. Consider locally suitable rotations or intercropping instead of repeating one crop everywhere.'],
        ['Prepare with soil protection','Keep residues or mulch where appropriate, use contour lines on slopes and maintain safe drainage outlets.'],
        ['Monitor the crop','Scout pests, water stress and nutrient symptoms. Verify suspected deficiencies with extension advice or soil testing before applying inputs.'],
        ['Review costs and returns','Record seed, fertilizer, water, labour, harvest losses, price and soil-cover condition at the end of each cycle.']
      ],
      'islands': [
        ['Check fresh water and land limits','Assess water storage, dry-season supply, soil depth, salinity and exposure to wind or coastal hazards.'],
        ['Start with mixed gardens','Combine locally valued food crops and suitable perennial crops on the land available; avoid introducing invasive species.'],
        ['Protect the coast and watershed','Keep appropriate native coastal buffers and protect watercourses. Mangroves belong in suitable natural habitats—not every shoreline.'],
        ['Improve soil safely','Use mature compost and well-drained beds/containers where appropriate. Verify the safety of soil and water used for edible crops.'],
        ['Plan for supply and markets','Check transport, storage, local demand and the cost of water before scaling a high-input crop.']
      ],
      'highland': [
        ['Mark slope and drainage','Map garden edges, footpaths and runoff. Avoid deep cuts or unstable terraces without technical guidance.'],
        ['Use locally adapted planting material','Select varieties proven for the local elevation and temperature; do not transfer lowland advice without validation.'],
        ['Recycle organic matter','Use safe compost and crop residues to support soil structure. Test soil before deciding fertilizer or lime applications.'],
        ['Manage pests and planting windows','Monitor crop health and use a planting schedule that reflects local elevation, rainfall and available seed.'],
        ['Track soil stability and harvest','Observe rills, slips and drainage changes after heavy rainfall. Record yields and save planting material where suitable and safe.']
      ],
      'urban': [
        ['Choose a safe growing site','Check sunlight, access, water quality and possible soil contamination. If unsure, use clean containers and traceable growing media.'],
        ['Prepare growing media','Use a well-drained, crop-appropriate mix. Compost only clean organic material and avoid contaminated inputs.'],
        ['Plant short-cycle crops','Start with locally suitable leafy vegetables, herbs or container crops that match light, heat and watering capacity.'],
        ['Water and observe daily','Use low-flow watering, monitor drainage and pests, and keep containers clean. Use crop protection only according to label and food-safety guidance.'],
        ['Harvest and close the loop','Harvest hygienically, compost clean plant residues and record water use and yield to decide what to grow next.']
      ]
    };
    var plan = plans[profile.kind] || plans['mixed-lowland'];
    var steps = plan.map(function (step, index) {
      return '<article class="field-card guide-step"><div class="check-number">' + String(index + 1).padStart(2, '0') + '</div><div><span class="mini-code">FIELD DAY ' + String(index + 1).padStart(2, '0') + '</span><h3>' + esc(step[0]) + '</h3><p>' + esc(step[1]) + '</p></div></article>';
    }).join('');
    return '<div class="tab-intro"><div class="eyebrow">FARMING GUIDE / HOW TO CULTIVATE</div><h2>Your farm, one step at a time 🚜</h2><p>This starter workflow is adapted to the broad landscape type for ' + esc(profile.name) + '. It deliberately avoids invented seed rates, spacing or fertilizer dosages; use local crop-specific extension recommendations for those details.</p></div>' +
      '<section class="soil-profile"><div class="soil-profile-icon">📍</div><div><span class="mini-code">PLANNING CONTEXT</span><h3>' + esc(profile.zone) + '</h3><p>Priority: ' + esc(profile.focus) + '. Start small, observe the response and scale only when the site, water and economics support it.</p><span class="data-tag green">CURATED STARTER WORKFLOW</span></div></section>' +
      '<div class="guide-grid">' + steps + '</div>' +
      renderFarmingSystemLibrary() +
      '<section class="source-strip"><div><span class="mini-code">LOCAL CALENDAR & EXTENSION</span><h3>Check the latest field guidance</h3><p>Exact planting month, plant spacing, seed rate, fertilizer rate and pest controls depend on crop variety and local conditions. Confirm them with extension staff and seasonal rainfall outlook.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="' + climatePortalUrl + '">' + climatePortalLabel + ' ↗</a></section>';
  }

  function renderTechnology(profile) {
    return '<div class="tab-intro"><div class="eyebrow">TECHNOLOGY & RESTORATION / TOOLBOX</div><h2>Choose the right tool for the land</h2><p>Technology is a response to a diagnosed constraint. Start with low-regret practices, trial them on a small area and monitor changes before scaling.</p></div>' +
      '<section class="tech-method-note"><div class="mini-code">HOW THESE SUGGESTIONS ARE GENERATED</div><h3>Curated rules, matched to the landscape type</h3><p>These cards currently come from a small, hand-curated library in BackToNature’s JavaScript (<code>techByKind</code>). The app chooses a group using the selected region’s broad landscape profile. This tab is <b>not currently populated by a live WOCAT or technology API</b>, and the suggestions are not a diagnosis of an individual farm.</p></section>' +
      buildTechCards(profile) +
      '<section class="quest-panel"><div class="quest-icon">🛠️</div><div><div class="mini-code">RESTORATION RULE</div><h3>Do not engineer what you have not diagnosed</h3><p>Terraces, drainage, bunds and water-control structures can create new risks if designed without slope, hydrology and downstream impacts. Get local technical advice before major earthworks.</p></div></section>' +
      '<section class="tech-reference-block"><div class="section-title"><span class="mini-code">OPEN LEARNING SOURCES</span><h3>Read how these practices work</h3></div>' +
      '<div class="tech-reference-grid">' +
      '<a target="_blank" rel="noopener noreferrer" href="https://www.fao.org/conservation-agriculture/overview/conservation-agriculture-principles/en/"><b>Conservation agriculture</b><span>Soil cover, less disturbance and crop diversity ↗</span></a>' +
      '<a target="_blank" rel="noopener noreferrer" href="https://www.fao.org/farmer-field-schools/themes/integrated-pest-management/"><b>Integrated pest management</b><span>Observe, prevent and control pests responsibly ↗</span></a>' +
      '<a target="_blank" rel="noopener noreferrer" href="https://www.fao.org/agroforestry/about-agroforestry/overview/"><b>Agroforestry</b><span>Plan trees with crops or livestock ↗</span></a>' +
      '<a target="_blank" rel="noopener noreferrer" href="https://www.fao.org/land-water/water/agricultural-water-management/rainfed-agriculture/en"><b>Rainfed water management</b><span>Plan around rain and soil moisture ↗</span></a>' +
      '<a target="_blank" rel="noopener noreferrer" href="https://teca.apps.fao.org/en/technologies/8825/"><b>Hydroponics</b><span>A simple method for growing vegetables without field soil ↗</span></a>' +
      '<a target="_blank" rel="noopener noreferrer" href="https://teca.apps.fao.org/en/technologies/8350/"><b>Aquaponics</b><span>Learn the fish-and-plant system design ↗</span></a>' +
      '</div></section>' +
      '<section class="source-strip"><div><span class="mini-code">DOCUMENTED PRACTICES</span><h3>Compare real-world case studies in WOCAT</h3><p>WOCAT remains a useful next step for documented sustainable land-management practices and context-specific case studies. This build currently links to its public catalogue rather than fetching records through a live WOCAT API.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://qcat.wocat.net/en/wocat/list/">BROWSE WOCAT ↗</a></section>';
  }


  function renderWorldBankAgricultureSnapshot(data) {
    var indicators = data && Array.isArray(data.indicators) ? data.indicators : [];
    var explanations = {
      'AG.LND.AGRI.ZS': {
        title:'How much land is used for agriculture?',
        meaning:'The share of a country’s total land area classified as agricultural land.',
        connection:'A larger share does not automatically mean better soil, higher yields, or more land available for new farms.',
        action:'Compare it with forest, water and land-cover information. Never use this national percentage to guess what a particular plot looks like.'
      },
      'AG.YLD.CREL.KG': {
        title:'How much cereal is harvested per hectare?',
        meaning:'An average cereal yield: how much grain is produced from a unit of harvested area.',
        connection:'Yield can be affected by weather, soil, seed varieties, water, pests, farm inputs and measurement methods. This indicator alone cannot tell us the cause.',
        action:'Use it for broad national context, then check crop-specific and province-level statistics and ask what conditions explain the difference.'
      },
      'AG.PRD.CROP.XD': {
        title:'Is crop production rising or falling?',
        meaning:'A crop production index that compares a country’s production level with a fixed reference period. It is an index, not tonnes of food.',
        connection:'A change can reflect several crops together, not the harvest from one crop or one district.',
        action:'Compare multiple years and open the original indicator notes before explaining why production changed.'
      },
      'NV.AGR.TOTL.ZS': {
        title:'How much does agriculture contribute to the economy?',
        meaning:'The percentage of national economic value added from agriculture, forestry and fishing.',
        connection:'This is an economic share, not the income of an individual farmer. It can change because agriculture changes or other parts of the economy grow.',
        action:'Pair it with employment, food prices and local livelihood evidence before making claims about farmers’ welfare.'
      }
    };
    var cards = indicators.map(function (indicator) {
      var info = explanations[indicator.id] || {
        title:indicator.label || 'Agriculture indicator',
        meaning:'The source reports a national-level statistic. Read the unit and year before interpreting it.',
        connection:'A national number cannot describe every province, district or farm.',
        action:'Open the source metadata, then compare it with a more local and recent source.'
      };
      var val = indicator.value == null ? 'No published value returned' :
        Number(indicator.value).toLocaleString('en-US',{maximumFractionDigits:2}) + ' ' + (indicator.unit || '');
      return '<article class="simple-indicator-card"><h4>' + esc(info.title) + '</h4>' +
        '<div class="simple-indicator-value">' + esc(val) + '</div>' +
        '<p><b>What it means:</b> ' + esc(info.meaning) + '</p>' +
        '<details class="mini-explanation"><summary>Why it matters and what to do</summary><p><b>How it connects:</b> ' + esc(info.connection) + '</p><p><b>Next step:</b> ' + esc(info.action) + '</p></details>' +
        '<small>Latest available year: ' + esc(indicator.year || 'not provided') + '</small></article>';
    }).join('');
    var rows = indicators.map(function (indicator) {
      return '<tr><td><b>' + esc(indicator.label) + '</b><small>' + esc(indicator.id) + '</small></td>' +
        '<td>' + esc(indicator.value == null ? 'No value returned' : Number(indicator.value).toLocaleString('en-US',{maximumFractionDigits:2})) + '</td>' +
        '<td>' + esc(indicator.unit) + '</td><td>' + esc(indicator.year || '—') + '</td>' +
        '<td><a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(indicator.sourceUrl)) + '">Source record ↗</a></td></tr>';
    }).join('');
    return renderLearningGuide(
      'These statistics describe a whole country, not the selected province or one farm. Each card explains what a particular indicator measures.',
      'Land use, crop yield, overall production and agriculture’s economic role describe different parts of the food system. One indicator cannot explain the whole picture.',
      'Use these figures as a starting point. Compare dates and units, open the source notes, and look for province-level statistics or field observations before making a local recommendation.',
      'National data, local decisions'
    ) + '<div class="simple-indicator-grid">' + cards + '</div>' +
    '<details class="technical-details"><summary>See the exact figures, units, years and indicator codes</summary>' +
    '<div class="live-table-wrap"><table class="live-table"><thead><tr><th>Indicator</th><th>Value</th><th>Unit</th><th>Year</th><th>Source</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<p class="nature-method-note">Retrieved ' + esc(new Date(data.retrievedAt).toLocaleString()) + '. ' +
    (data.failedIndicators && data.failedIndicators.length ? 'Some indicator endpoints failed: ' + esc(data.failedIndicators.join(', ')) + '. ' : '') +
    'World Bank values are national-level and the latest available year may lag behind the current year.</p></details>';
  }

  function renderCrossrefWorks(result) {
    var works = result && Array.isArray(result.works) ? result.works : [];
    if (!works.length) return '<p>No matching publication records were found. Try simpler words or search without the region name.</p>';
    var cards = works.map(function (work) {
      var title = esc(work.title || 'Untitled publication');
      var meta = [work.year, work.journal || work.publisher].filter(Boolean).map(esc).join(' · ');
      var linkMarkup = work.url
        ? '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(work.url)) + '">Open publication ↗</a>'
        : '<span class="live-note">No direct publication link was supplied.</span>';
      var authors = Array.isArray(work.authors) && work.authors.length ? work.authors.join(', ') : 'Author details not listed';
      if (work.additionalAuthors) authors += ' +' + work.additionalAuthors + ' more';
      return '<article class="simple-publication-card"><h4>' + title + '</h4>' +
        (meta ? '<p class="publication-meta">' + meta + '</p>' : '') +
        '<p class="publication-help">This title may be relevant to your search. Open the record and check its abstract, study location, method and findings before using it as evidence.</p>' +
        linkMarkup +
        '<details class="mini-explanation"><summary>Bibliographic details</summary><p><b>Authors:</b> ' + esc(authors) + '</p>' +
        (work.publisher ? '<p><b>Publisher:</b> ' + esc(work.publisher) + '</p>' : '') +
        '<p><b>Record type:</b> ' + esc(work.type || 'publication') + '</p></details></article>';
    }).join('');
    return renderLearningGuide(
      'These are publication records related to your search words. A title helps you decide what to open, but does not tell you whether the study supports a claim.',
      'Research can explain what happened in a study setting. To apply it to this region, check whether its climate, soil, crop and farming conditions are similar.',
      'Open a promising publication, read its abstract and methods, note where the study was done, then compare its findings with trusted local information and field observations.',
      'Turn a search result into useful evidence'
    ) +
    '<p class="live-note">Showing ' + works.length + ' publication record(s) from ' + Number(result.totalResults || works.length).toLocaleString('en-US') +
    ' matching metadata entries. Crossref metadata does not guarantee free full-text access.</p>' +
    '<div class="simple-publication-grid">' + cards + '</div>' +
    '<details class="technical-details"><summary>Search and retrieval details</summary><p>Search phrase: ' + esc(result.query) +
    '<br>Retrieved: ' + esc(new Date(result.retrievedAt).toLocaleString()) +
    '<br>Source: <a target="_blank" rel="noopener noreferrer" href="https://www.crossref.org/documentation/retrieve-metadata/rest-api/">Crossref REST API ↗</a></p></details>';
  }

  function renderCrossrefEvidencePanel(countryName) {
    var context = String(countryName || '').trim();
    var defaultQuery = context && context !== 'UNK' ? context + ' sustainable land management' : 'sustainable land management';
    return '<section class="live-connectors crossref-literature-panel"><div class="section-title"><span class="mini-code">OPEN SCHOLARLY METADATA / NO API KEY</span><h3>Research & Evidence Finder</h3></div>' +
      '<p class="live-explainer">Search publication metadata for sustainable land management, agroforestry, soil conservation, land restoration, food security and related topics. Add a country or region name when useful. Crossref is free to query; this panel does not bypass publisher access controls or assume that full text is open access.</p>' +
      '<div class="crop-lab-controls"><div class="crop-control"><label for="crossref-query">Search terms</label><input id="crossref-query" type="search" maxlength="180" value="' + esc(defaultQuery) + '" placeholder="e.g. agroforestry soil restoration"></div></div>' +
      '<button id="crossref-search-btn" class="pixel-btn green" type="button">SEARCH RESEARCH LITERATURE</button>' +
      '<div id="crossref-status" class="live-status" aria-live="polite">Not queried yet</div>' +
      '<div id="crossref-results" class="live-results">No publication records are loaded until you start a search.</div>' +
      '<p class="nature-method-note">Metadata source: <a href="https://www.crossref.org/documentation/retrieve-metadata/rest-api/" target="_blank" rel="noopener noreferrer">Crossref REST API documentation ↗</a></p></section>';
  }

  function renderSources(profile) {
    var selectedIso3 = currentCountryIso3() || 'UNK';
    var selectedCountryName = (currentProvince && currentProvince.countryName) ||
      (selectedCountry && selectedCountry.name) ||
      (countryByISO3[selectedIso3] && countryByISO3[selectedIso3].name) || selectedIso3;
    var wocatCountryName = selectedCountryName;
    var featureProps = currentProvince && currentProvince.feature && currentProvince.feature.properties
      ? currentProvince.feature.properties : {};
    var boundaryMetadataUrl = featureProps._bt_source_metadata_url || '';
    var boundaryLicense = featureProps._bt_boundary_license || 'See the source metadata for applicable license and attribution terms.';
    var api = window.BackToNatureAPI;
    var countrySources = api && api.getCountrySourceCatalog
      ? api.getCountrySourceCatalog(selectedIso3, selectedCountryName) : [];
    var isIndonesia = selectedIso3 === 'IDN';

    var countrySourceMarkup = '<section class="country-api-section"><div class="section-title"><span class="mini-code">NATIONAL DATA / ' + esc(selectedIso3) + '</span><h3>Official APIs for ' + esc(selectedCountryName) + '</h3></div>' +
      '<p class="live-explainer">Only reviewed country-relevant sources are listed. Access labels distinguish public APIs from services that require registration or a key.</p>' +
      countrySourceCardsMarkup(countrySources) + '</section>' +
      renderWorldBankIndicatorPanel(selectedIso3, selectedCountryName);

    var indonesiaLiveTerminal = isIndonesia
      ? '<section class="live-connectors"><div class="section-title"><span class="mini-code">LIVE DATA TERMINAL / INDONESIA</span><h3>Query national and spatial sources</h3></div>' +
        '<p class="live-explainer">BPS and Kementerian Pertanian are Indonesia-only sources. FAOSTAT returns national context, not province-level measurements.</p>' +
        '<div class="tile-grid">' +
        '<article class="field-card"><div class="card-topline"><span class="card-emoji">📊</span><span class="mini-code">FAOSTAT / LIVE</span></div><h3>Land use · Indonesia</h3><p>Request Indonesia-level land-use observations from the public FAOSTAT API.</p><button id="live-faostat-btn" class="pixel-btn" type="button">FETCH NATIONAL DATA</button><div id="live-faostat-status" class="live-status" aria-live="polite">Not queried yet</div><div id="live-faostat-results" class="live-results">No values are shown until the live API responds.</div></article>' +
        '<article class="field-card"><div class="card-topline"><span class="card-emoji">🗺️</span><span class="mini-code">FAO CATALOGUE / LIVE</span></div><h3>Spatial metadata · ' + esc(profile.name) + '</h3><p>Search FAO catalogue metadata for records mentioning this region and soil, land, water, climate or agriculture.</p><button id="live-fao-catalog-btn" class="pixel-btn" type="button">SEARCH FAO CATALOGUE</button><div id="live-fao-catalog-status" class="live-status" aria-live="polite">Not queried yet</div><div id="live-fao-catalog-results" class="live-results">No catalogue results loaded.</div></article>' +
        '</div></section>'
      : '';

    var globalSources = [
      {t:'Crossref REST API — scholarly publication metadata',d:'Search publication metadata for research related to sustainable land management, agroforestry, soil conservation and food security. Full-text access and reuse rights remain with the publisher or rights holder.',u:'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',tag:'RESEARCH LITERATURE · NO API KEY'},
      {t:'FAO Hand-in-Hand geospatial catalogue',d:'Explore land, water, climate and agriculture geospatial datasets. Coverage varies by country and layer.',u:'https://data.apps.fao.org/?lang=en',tag:'GEOSPATIAL DATA'},
      {t:'FAOSTAT',d:'Country-level agriculture, land-use and food-system indicators. These are national statistics, not measurements for this specific region.',u:'https://www.fao.org/faostat/en/#data',tag:'GLOBAL STATISTICS'},
      {t:'World Bank Climate Change Knowledge Portal',d:'Country-level climate context. Validate local seasons and field conditions with national services and extension specialists.',u:'https://climateknowledgeportal.worldbank.org/',tag:'CLIMATE CONTEXT'},
      {t:'ESA WorldCover 2021',d:'A 10 m global land-cover product. It is not a parcel survey and does not represent current-year land cover.',u:'https://esa-worldcover.org/en/data-access',tag:'LAND COVER'},
      {t:'FAO WaPOR v3',d:'Open water-productivity and evapotranspiration datasets. Check resolution and time coverage for the selected point.',u:'https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en',tag:'WATER / ET DATA'},
      {t:'GBIF Occurrence API',d:'Global taxonomic and georeferenced species records. Occurrences are not abundance estimates or crop-suitability evidence.',u:'https://techdocs.gbif.org/en/openapi/v1/occurrence',tag:'BIODIVERSITY API'},
      {t:'iNaturalist API',d:'Community nature observations as an independent cross-check against GBIF. Observation effort varies by location.',u:'https://www.inaturalist.org/pages/developers',tag:'BIODIVERSITY API'},
      {t:'Pl@ntNet API',d:'Optional photo-based plant identification. Free quota, personal key and attribution terms apply.',u:'https://my.plantnet.org/terms_of_use',tag:'PHOTO IDENTIFICATION'},
      {t:'WOCAT QCAT',d:'Documented sustainable land-management practices and technologies. Live API calls may require an authorized token.',u:'https://qcat.wocat.net/en/wocat/list/',tag:'FARMING PRACTICES'},
      {t:'FAO FPMA — food price data API',d:'Public country-filtered price series for food commodities, with observations, currency and market metadata. A live query panel is available above; no API key or login is required.',u:'https://fpma-documentation.web.app/docs/api-docs/intro/',tag:'LIVE FOOD PRICES · NO LOGIN'},
      {t:'Open-Meteo weather and agricultural variables',d:'Public forecast and historical weather endpoints used elsewhere in BackToNature, including rainfall and reference evapotranspiration. Free use is limited to non-commercial fair use and requires attribution.',u:'https://open-meteo.com/en/docs',tag:'WEATHER API · NO LOGIN'},
      {t:'NASA POWER Data Access Viewer / API',d:'Public gridded meteorological and solar data used for monthly climate context. The app labels precipitation units explicitly and does not treat gridded estimates as farm measurements.',u:'https://power.larc.nasa.gov/docs/services/api/',tag:'CLIMATE API · NO LOGIN'},
      {t:'World Bank Indicators API',d:'Public country-level time series for agriculture, land use, cereal yield and economic context. The live country snapshot above uses this keyless API.',u:'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api',tag:'GLOBAL INDICATORS · NO LOGIN'},
      {t:'geoBoundaries administrative data',d:'Administrative boundary provenance. The represented year and license differ by country and administrative level.',u:boundaryMetadataUrl || 'https://www.geoboundaries.org/',tag:'BOUNDARY PROVENANCE'}
    ];

    var wocatBox = '<details class="token-box"><summary>🔐 Connect authorized WOCAT QCAT access (optional)</summary>' +
      '<p>Search published sustainable land-management technologies for <b>' + esc(wocatCountryName) + '</b>. Browsing the database is free; API calls require an authorized token. The token is used for this request only and is not saved. <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://qcat.readthedocs.io/en/latest/api/v2.html">API authorization guide ↗</a> · <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://wocat.net/en/account/register/">WOCAT registration ↗</a></p>' +
      '<label for="live-wocat-token">WOCAT QCAT API token</label><input id="live-wocat-token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste an authorized token for one request">' +
      '<button id="live-wocat-btn" class="pixel-btn wood" type="button">FETCH WOCAT TECHNOLOGIES</button><div id="live-wocat-status" class="live-status" aria-live="polite">Token not supplied</div><div id="live-wocat-results" class="live-results">No sample records are fabricated.</div></details>';

    var integrity = '<section class="data-integrity"><span class="data-tag green">DATA INTEGRITY</span><h3>What this panel does—and does not—claim</h3>' +
      '<p><b>It does:</b> provide country-appropriate official source links and country-filtered data where a live connector is available.</p>' +
      '<p><b>It does not:</b> claim laboratory soil values, precise yield, farm-level suitability or official measurements where those values were not retrieved and validated.</p>' +
      '<p><b>Administrative level:</b> ' + esc(currentProvince && Number(currentProvince.adminLevel) === 2 ? 'ADM2 · second-level local unit' : 'ADM1 · first-level region') +
      '. <b>Boundary license:</b> ' + esc(boundaryLicense) + '</p></section>';

    return '<div class="tab-intro"><div class="eyebrow">DATA & RESEARCH / EVIDENCE SHELF</div><h2>Where does the information come from? 📚</h2><p>BackToNature checks a few free public sources when this tab opens. Each source answers a different question; no single number explains a whole farm.</p></div>' +
      renderLearningGuide('A data source is where a number, map or research record comes from. The publisher and method help us check whether it is trustworthy for our question.','National statistics, research papers, satellite maps and field observations describe different things. Compare them only when location, date, units and methods make sense together.','Start with the plain-language explanation, open technical details when needed, and verify local decisions with field observations or an official local source.','Use the source, not just the number') +
      countrySourceMarkup + renderCrossrefEvidencePanel(selectedCountryName) + renderFaoFoodPricePanel(selectedIso3, selectedCountryName) + indonesiaLiveTerminal +
      '<div class="source-list">' + globalSources.map(function (source, index) {
        return '<article class="source-card"><div class="source-index">' + String(index + 1).padStart(2,'0') + '</div><div class="source-main"><span class="mini-code">' + esc(source.tag) + '</span><h3>' + esc(source.t) + '</h3><p>' + esc(source.d) + '</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(source.u)) + '">Open source ↗</a></div></article>';
      }).join('') + '</div>' + wocatBox + integrity;
  }

  function wireSourceControls(profile) {
    var api = window.BackToNatureAPI;
    var currentSourceIso3 = currentProvince && currentProvince.countryIso3 ? currentProvince.countryIso3 : (selectedCountry && selectedCountry.iso3) || 'IDN';
    var currentSourceCountryName = (currentProvince && currentProvince.countryName) || (selectedCountry && selectedCountry.name) || (countryByISO3[currentSourceIso3] && countryByISO3[currentSourceIso3].name) || currentSourceIso3;

    var crossrefBtn = el('crossref-search-btn');
    if (crossrefBtn) crossrefBtn.addEventListener('click', async function () {
      if (!api || !api.searchCrossrefWorks) {
        setLiveStatus('crossref-status', 'Crossref connector unavailable. Reload the page and retry.', 'error');
        return;
      }
      var queryInput = el('crossref-query');
      var query = queryInput ? queryInput.value.trim() : '';
      if (query.length < 3) {
        setLiveStatus('crossref-status', 'Enter at least three search characters.', 'error');
        return;
      }
      crossrefBtn.disabled = true;
      setLiveStatus('crossref-status', 'Searching Crossref publication metadata…', 'pending');
      var resultNode = el('crossref-results');
      if (resultNode) resultNode.textContent = 'Searching for ' + query + '. No article full text is downloaded.';
      try {
        var result = await api.searchCrossrefWorks(query, 8);
        var works = result && Array.isArray(result.works) ? result.works : [];
        if (resultNode) resultNode.innerHTML = renderCrossrefWorks(result);
        setLiveStatus('crossref-status',
          works.length ? works.length + ' publication metadata record(s) retrieved' + (result.cached ? ' · session cache' : '') + '.'
            : 'Request succeeded; no matching records were returned.',
          works.length ? 'success' : 'pending');
      } catch (error) {
        setLiveStatus('crossref-status', error && error.message ? error.message : 'Crossref search failed.', 'error');
        if (resultNode) resultNode.textContent = 'No example records were substituted. Check network/API availability and try broader keywords.';
      } finally {
        crossrefBtn.disabled = false;
      }
    });

    var waporSourceBtn = el('wapor-source-fetch-btn');
    if (waporSourceBtn) waporSourceBtn.addEventListener('click', async function () {
      if (!api || !api.fetchWaporMapsets) {
        setLiveStatus('wapor-source-status', 'WaPOR connector is unavailable. Reload the page.', 'error');
        return;
      }
      waporSourceBtn.disabled = true;
      setLiveStatus('wapor-source-status', 'Requesting official WaPOR v3 catalog metadata…', 'pending');
      var resultNode = el('wapor-source-results');
      if (resultNode) resultNode.textContent = 'Loading public metadata. No raster values or example data are being substituted.';
      try {
        var result = await api.fetchWaporMapsets(true);
        if (resultNode) resultNode.innerHTML = renderWaporMapsetCatalog(result);
        setLiveStatus('wapor-source-status', 'PUBLIC LIVE CATALOG · ' + result.records.length + ' mapsets returned', 'success');
      } catch (error) {
        setLiveStatus('wapor-source-status', 'WaPOR catalog request failed', 'error');
        if (resultNode) resultNode.textContent = (error && error.message ? error.message : 'Unknown API error') +
          ' The endpoint may be temporarily unavailable or blocked by browser network policy. No sample layers were inserted.';
      } finally {
        waporSourceBtn.disabled = false;
      }
    });

    var countryWbBtn = el('country-wb-fetch-btn');
    if (countryWbBtn) countryWbBtn.addEventListener('click', async function () {
      if (!api || !api.fetchWorldBankAgricultureSnapshot) {
        setLiveStatus('country-wb-status', 'Country-indicator API is unavailable. Reload the page.', 'error');
        return;
      }
      countryWbBtn.disabled = true;
      setLiveStatus('country-wb-status', 'Requesting country-filtered agriculture indicators from the World Bank API…', 'pending');
      var resultNode = el('country-wb-results');
      if (resultNode) resultNode.textContent = 'Waiting for official country-level observations. No placeholder values are used.';
      try {
        var result = await api.fetchWorldBankAgricultureSnapshot(currentSourceIso3, true);
        if (currentProvince && currentCountryIso3() !== currentSourceIso3) return;
        if (resultNode) resultNode.innerHTML = renderWorldBankAgricultureSnapshot(result);
        setLiveStatus('country-wb-status', result.indicators.length + ' indicator series retrieved for ' + currentSourceIso3 + '.', 'success');
      } catch (error) {
        setLiveStatus('country-wb-status', error && error.message ? error.message : 'World Bank API request failed.', 'error');
        if (resultNode) resultNode.textContent = 'No example values were substituted. Check the API status and retry.';
      } finally {
        countryWbBtn.disabled = false;
      }
    });

    var fpmaBtn = el('fpma-fetch-btn');
    if (fpmaBtn) fpmaBtn.addEventListener('click', async function () {
      if (!api || !api.fetchFaoFoodPrices) {
        setLiveStatus('fpma-status', 'FAO FPMA connector is unavailable. Reload the page.', 'error');
        return;
      }
      var queryInput = el('fpma-commodity-query');
      var query = queryInput ? queryInput.value.trim() : '';
      if (!query) {
        setLiveStatus('fpma-status', 'Enter a commodity name such as rice, maize or wheat.', 'error');
        return;
      }
      fpmaBtn.disabled = true;
      setLiveStatus('fpma-status', 'Requesting public FAO price series for ' + currentSourceCountryName + '…', 'pending');
      var resultNode = el('fpma-results');
      if (resultNode) resultNode.textContent = 'Loading matching public price series and a bounded price history. No login or key is sent.';
      try {
        var result = await api.fetchFaoFoodPrices(currentSourceIso3, query);
        if (currentProvince && currentCountryIso3() !== currentSourceIso3) return;
        if (resultNode) resultNode.innerHTML = renderFaoFoodPriceResults(result);
        var count = result.series ? result.series.length : 0;
        setLiveStatus('fpma-status', count ? 'PUBLIC LIVE DATA · ' + count + ' matching price series' : 'No matching series returned · refine the search term', count ? 'success' : 'pending');
      } catch (error) {
        setLiveStatus('fpma-status', 'FAO FPMA request failed', 'error');
        if (resultNode) resultNode.textContent = (error && error.message ? error.message : 'Unknown API error') +
          ' The public API may be temporarily unavailable or block browser access. No sample prices were substituted.';
      } finally {
        fpmaBtn.disabled = false;
      }
    });

    var faoBtn = el('live-faostat-btn');
    if (faoBtn) faoBtn.addEventListener('click', async function () {
      if (!api || !api.fetchIndonesiaLandUse) {
        setLiveStatus('live-faostat-status', 'API module unavailable. Reload this page.', 'error');
        return;
      }
      faoBtn.disabled = true;
      setLiveStatus('live-faostat-status', 'Requesting live FAOSTAT records…', 'pending');
      el('live-faostat-results').textContent = 'Waiting for the official source. No placeholder values are shown.';
      try {
        var response = await api.fetchIndonesiaLandUse();
        var rows = response.rows || [];
        if (!rows.length) {
          setLiveStatus('live-faostat-status', 'Source responded; no populated observations found', 'pending');
          el('live-faostat-results').textContent = 'The request succeeded but the selected period returned no populated land-use values.';
          return;
        }
        rows.sort(function (a,b) {
          return Number(dataField(b, ['Year','Year Code']) || 0) - Number(dataField(a, ['Year','Year Code']) || 0);
        });
        var pick = [], seen = {};
        rows.forEach(function (row) {
          var item = row.Item || row['Item Name'] || row.ItemName || 'Land-use item';
          var element = row.Element || row['Element Name'] || 'Observation';
          var key = String(item).toLowerCase() + '|' + String(element).toLowerCase();
          if (!seen[key] && pick.length < 8) { seen[key] = true; pick.push(row); }
        });
        var table = '<div class="live-table-wrap"><table class="live-table"><thead><tr><th>Item / indicator</th><th>Year</th><th>Value</th></tr></thead><tbody>';
        pick.forEach(function (row) {
          var item = dataField(row, ['Item','Item Name','ItemName']) || 'Land-use item';
          var elName = dataField(row, ['Element','Element Name']) || 'Observation';
          var year = dataField(row, ['Year','Year Code']) || '—';
          var value = dataField(row, ['Value','value']);
          if (value === '') value = '—';
          var unit = dataField(row, ['Unit','Unit Name']);
          table += '<tr><td>' + esc(item) + '<br><small>' + esc(elName) + '</small></td><td>' + esc(year) + '</td><td>' + esc(Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US',{maximumFractionDigits:2}) : value) + '<br><small>' + esc(unit) + '</small></td></tr>';
        });
        table += '</tbody></table></div><p class="live-note">Indonesia · domain Land Use (RL) · request window ' + esc(response.startYear) + '–' + esc(response.endYear) + '. Values, units and years follow the source response. These are national context, not province-level results.</p>';
        el('live-faostat-results').innerHTML = renderLearningGuide(
          'These figures describe land-use categories for Indonesia as a whole. Each row can measure a different thing and use a different unit.',
          'National land-use trends can provide context, but they do not tell us how a specific province, village or farm is being used.',
          'Look at the year and unit for each row. For a local decision, compare the national context with province-level data, recent maps and observations from the actual site.',
          'What does the national land-use data mean?'
        ) + '<details class="technical-details"><summary>See the land-use table and exact units</summary>' + table + '</details>';
        setLiveStatus('live-faostat-status', 'LIVE SOURCE · ' + rows.length + ' populated records', 'success');
      } catch (error) {
        setLiveStatus('live-faostat-status', 'Live request failed', 'error');
        el('live-faostat-results').textContent = (error && error.message ? error.message : 'Unknown API error') + ' No sample data were substituted.';
      } finally { faoBtn.disabled = false; }
    });

    var catBtn = el('live-fao-catalog-btn');
    if (catBtn) catBtn.addEventListener('click', async function () {
      if (!api || !api.searchFaoCatalog) {
        setLiveStatus('live-fao-catalog-status', 'API module unavailable. Reload this page.', 'error');
        return;
      }
      catBtn.disabled = true;
      setLiveStatus('live-fao-catalog-status', 'Searching FAO metadata catalogue…', 'pending');
      el('live-fao-catalog-results').textContent = 'Querying the catalogue for ' + profile.name + '.';
      try {
        var records = await api.searchFaoCatalog(profile.name);
        if (!records.length) {
          setLiveStatus('live-fao-catalog-status', 'No matching catalogue records returned', 'pending');
          el('live-fao-catalog-results').textContent = 'No matches were returned for this query. Try the official catalogue and broaden the search terms.';
          return;
        }
        el('live-fao-catalog-results').innerHTML = renderLearningGuide(
          'These are catalogue entries describing available datasets. They are not measurements of this province or a farm by themselves.',
          'A dataset can be useful only if its map area, date, resolution and method match the question you are asking.',
          'Open the metadata and check coverage, collection date, units and scale before using a map or table for a field decision.',
          'How do I choose a useful dataset?'
        ) + '<ul class="live-record-list">' + records.map(function (record) {
          return '<li><b>' + esc(record.title) + '</b>' +
            (record.summary ? '<details class="mini-explanation"><summary>What does this dataset describe?</summary><p>' + esc(record.summary.slice(0,500)) + (record.summary.length > 500 ? '…' : '') + '</p></details>' : '') +
            '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.url)) + '">Open dataset metadata ↗</a></li>';
        }).join('') + '</ul>';
        setLiveStatus('live-fao-catalog-status', 'LIVE CATALOGUE · ' + records.length + ' records', 'success');
      } catch (error) {
        setLiveStatus('live-fao-catalog-status', 'Catalogue request failed', 'error');
        el('live-fao-catalog-results').textContent = (error && error.message ? error.message : 'Unknown API error') + ' The request may be blocked by CORS or network policy. No fake records were substituted.';
      } finally { catBtn.disabled = false; }
    });

    // Start a small set of public, no-key data lookups as soon as Sources opens.
    // WOCAT and Pl@ntNet are excluded because they require user-provided credentials.
    window.setTimeout(function () {
      ['crossref-search-btn','country-wb-fetch-btn'].concat(
        currentSourceIso3 === 'IDN' ? ['live-faostat-btn'] : []
      ).forEach(function (buttonId, index) {
        window.setTimeout(function () {
          var button = el(buttonId);
          if (button && !button.disabled) button.click();
        }, index * 180);
      });
    }, 80);

    var wocatBtn = el('live-wocat-btn');
    if (wocatBtn) wocatBtn.addEventListener('click', async function () {
      if (!api || !api.fetchWocatTechnologies) {
        setLiveStatus('live-wocat-status', 'API module unavailable. Reload this page.', 'error');
        return;
      }
      var input = el('live-wocat-token');
      var token = input ? input.value.trim() : '';
      if (input) input.value = '';
      if (!token) {
        setLiveStatus('live-wocat-status', 'Token required for authenticated QCAT access', 'error');
        return;
      }
      wocatBtn.disabled = true;
      setLiveStatus('live-wocat-status', 'Requesting WOCAT records for ' + currentSourceCountryName + '…', 'pending');
      el('live-wocat-results').textContent = 'The token was removed from the input. Query country: ' + currentSourceCountryName + ' (' + currentSourceIso3 + '). The token will only be passed to this request.';
      try {
        var records = await api.fetchWocatTechnologies(token, currentSourceIso3);
        if (!records.length) {
          setLiveStatus('live-wocat-status', 'Request succeeded; no records returned', 'pending');
          el('live-wocat-results').textContent = 'The API returned no technology records for the country-level query.';
          return;
        }
        el('live-wocat-results').innerHTML = '<ul class="live-record-list">' + records.map(function (record) {
          return '<li><b>' + esc(record.title) + '</b>' +
            (record.code ? '<small class="record-code">' + esc(record.code) + '</small>' : '') +
            (record.summary ? '<p>' + esc(record.summary.slice(0,260)) + (record.summary.length > 260 ? '…' : '') + '</p>' : '') +
            '<a target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.url)) + '">Open WOCAT record ↗</a></li>';
        }).join('') + '</ul><p class="live-note">Country-level WOCAT results: records are not guaranteed to match this province specifically.</p>';
        setLiveStatus('live-wocat-status', 'LIVE SOURCE · ' + records.length + ' records', 'success');
      } catch (error) {
        setLiveStatus('live-wocat-status', 'WOCAT request failed', 'error');
        el('live-wocat-results').textContent = (error && error.message ? error.message : 'Unknown API error') + ' Check token authorization and QCAT browser access. No sample records were substituted.';
      } finally { wocatBtn.disabled = false; }
    });
  }


  function renderNatureOccurrenceCards(data) {
    var records = data && Array.isArray(data.records) ? data.records : [];
    if (!records.length) {
      return '<p>No georeferenced plant records were returned in this search area. That does not prove plants are absent; some places have fewer reported observations.</p>';
    }
    return '<div class="nature-record-grid">' + records.map(function (record) {
      var detail = [record.locality, record.countryCode].filter(Boolean).join(' · ');
      var taxonUrl = /^\d+$/.test(String(record.taxonKey || ''))
        ? 'https://www.gbif.org/species/' + encodeURIComponent(record.taxonKey)
        : 'https://www.gbif.org/occurrence/search?scientific_name=' + encodeURIComponent(record.scientificName);
      return '<article class="field-card nature-record-card">' +
        '<div class="card-topline"><span class="card-emoji">🌿</span><span class="mini-code">REPORTED NEARBY</span></div>' +
        '<h3>' + esc(record.vernacularName || record.scientificName || 'Plant record') + '</h3>' +
        '<p>This plant has a record in the nearby search area. It does not show how many plants exist or whether this species is suitable to grow here.</p>' +
        ((record.eventDate || detail) ? '<p class="record-meta">' + esc([record.eventDate,detail].filter(Boolean).join(' · ')) + '</p>' : '') +
        '<details class="mini-explanation"><summary>Scientific and source details</summary>' +
        '<p><i>' + esc(record.scientificName || 'Scientific name not supplied') + '</i></p>' +
        (record.basisOfRecord ? '<p><b>Record type:</b> ' + esc(record.basisOfRecord.replace(/_/g,' ').toLowerCase()) + '</p>' : '') +
        (record.datasetName ? '<p><b>Dataset:</b> ' + esc(record.datasetName) + '</p>' : '') +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(taxonUrl)) + '">Open species page ↗</a> ' +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.sourceUrl)) + '">Original record ↗</a></details>' +
        '</article>';
    }).join('') + '</div>';
  }

  function renderNasaPowerMonthCards(data) {
    var months = data && Array.isArray(data.monthly) ? data.monthly : [];
    if (!months.length) return '<p>No historical monthly climate values were returned by NASA POWER.</p>';
    var validTemps = months.filter(function (m) { return m.temperatureMean != null && Number.isFinite(Number(m.temperatureMean)); });
    var warmest = validTemps.slice().sort(function (a,b) { return Number(b.temperatureMean)-Number(a.temperatureMean); })[0];
    var coolest = validTemps.slice().sort(function (a,b) { return Number(a.temperatureMean)-Number(b.temperatureMean); })[0];
    var rainMonths = months.filter(function (m) { return m.precipitationRateMmPerDay != null && Number.isFinite(Number(m.precipitationRateMmPerDay)); });
    var wettest = rainMonths.slice().sort(function (a,b) { return Number(b.precipitationRateMmPerDay)-Number(a.precipitationRateMmPerDay); })[0];
    var driest = rainMonths.slice().sort(function (a,b) { return Number(a.precipitationRateMmPerDay)-Number(b.precipitationRateMmPerDay); })[0];
    var meaning = 'This historical snapshot helps compare usual weather patterns across months. It is not today’s weather and is not a sensor reading from the selected farm.';
    if (warmest && coolest) meaning += ' In this profile, ' + warmest.label + ' is typically warmer and ' + coolest.label + ' cooler.';
    var connection = 'Temperature and sunlight affect plant growth; rainfall helps describe water supply. The same rain can soak in, run off or drain away differently depending on soil and land shape.';
    var action = 'Compare these broad patterns with the local weather service and your own rain or soil-moisture observations. Rainfall is shown as an average daily rate, not a monthly total.';
    if (wettest && driest) action += ' ' + wettest.label + ' is the wetter month in this dataset and ' + driest.label + ' the drier one, so inspect water access in the drier season.';
    var technical = '<div class="climate-month-grid">' + months.map(function (month) {
      return '<article class="climate-month-card">' +
        '<div class="climate-month-top"><b>' + esc(month.label) + '</b><span>' + esc(numberOrDash(month.temperatureMean,' °C')) + '</span></div>' +
        '<div class="climate-month-metrics">' +
        '<span>Mean temperature</span><b>' + esc(numberOrDash(month.temperatureMean,' °C')) + '</b>' +
        '<span>Typical low–high</span><b>' + esc(numberOrDash(month.temperatureMin,'–') + numberOrDash(month.temperatureMax,' °C')) + '</b>' +
        '<span>Average rain per day</span><b>' + esc(numberOrDash(month.precipitationRateMmPerDay,' mm/day')) + '</b>' +
        '<span>Solar radiation</span><b>' + esc(numberOrDash(month.solarRadiationKwhM2Day,' kWh/m²/day')) + '</b>' +
        '</div></article>';
    }).join('') + '</div>';
    return renderLearningGuide(meaning,connection,action,'What can this climate snapshot tell us?') +
      '<details class="technical-details"><summary>See month-by-month climate figures</summary>' + technical + '</details>';
  }

  function renderINaturalistPlantRecords(data) {
    var records = data && Array.isArray(data.records) ? data.records : [];
    if (!records.length) return '<p>No research-grade plant observations came back in this search. This does not mean the area has no plants; observation effort varies.</p>';
    return '<div class="nature-observation-grid">' + records.map(function (record) {
      return '<article class="field-card nature-observation-card">' +
        '<div class="card-topline"><span class="card-emoji">🌿</span><span class="mini-code">COMMUNITY OBSERVATION</span></div>' +
        '<h3>' + esc(record.commonName || record.scientificName || 'Plant observation') + '</h3>' +
        '<p>Someone recorded this plant near the selected region. A record is a clue to investigate, not a count of how common the plant is.</p>' +
        (record.observedOn || record.place ? '<p class="record-meta">' + esc([record.observedOn,record.place].filter(Boolean).join(' · ')) + '</p>' : '') +
        '<details class="mini-explanation"><summary>Scientific and observer details</summary>' +
        '<p><i>' + esc(record.scientificName || 'Scientific name not provided') + '</i></p>' +
        (record.observer ? '<p><b>Observer:</b> ' + esc(record.observer) + '</p>' : '') +
        (record.distanceKm != null ? '<p><b>Approx. distance from map point:</b> ' + esc(numberOrDash(record.distanceKm,' km')) + '</p>' : '') +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.taxonUrl)) + '">Open species page ↗</a> ' +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.sourceUrl)) + '">Original observation ↗</a></details>' +
        '</article>';
    }).join('') + '</div>';
  }

  function renderOpenMeteoOutlook(data) {
    var days = data && Array.isArray(data.days) ? data.days : [];
    if (!days.length) return '<p>No seven-day outlook was returned for this location.</p>';
    var rainDays = days.filter(function (d) { return d.precipitationMm != null && Number.isFinite(Number(d.precipitationMm)); });
    var tempDays = days.filter(function (d) { return d.temperatureMean != null && Number.isFinite(Number(d.temperatureMean)); });
    var pairs = days.filter(function (d) { return d.precipitationMm != null && d.referenceEt0Mm != null &&
      Number.isFinite(Number(d.precipitationMm)) && Number.isFinite(Number(d.referenceEt0Mm)); });
    var totalRain = rainDays.reduce(function (sum,d) { return sum + Number(d.precipitationMm); },0);
    var meanTemp = tempDays.length ? tempDays.reduce(function (sum,d) { return sum + Number(d.temperatureMean); },0)/tempDays.length : null;
    var balance = pairs.length ? pairs.reduce(function (sum,d) { return sum + Number(d.precipitationMm) - Number(d.referenceEt0Mm); },0) : null;
    var deficitDays = pairs.filter(function (d) { return Number(d.precipitationMm)-Number(d.referenceEt0Mm)<0; }).length;
    var meaning = 'This is a model forecast for the next seven days near a representative point, not a promise about what will happen on every farm.';
    meaning += ' It predicts about ' + Number(totalRain).toFixed(1) + ' mm of rain across the days returned' +
      (meanTemp == null ? '.' : ' and an average temperature near ' + meanTemp.toFixed(1) + ' °C.');
    var connection = 'Rain, temperature, soil and drainage work together. Forecast rain is not the same as water stored in the root zone; runoff, previous rainfall and irrigation all matter.';
    var action = balance == null ? 'Check the local forecast and actual field conditions before planning work.' :
      balance < 0 ? 'Forecast rain is below the reference water-demand estimate overall. Check soil moisture and irrigation before sowing; this does not prove drought.' :
      'Forecast rain is at or above reference water demand overall. Check drainage and field conditions; this does not prove that the soil is saturated.';
    if (pairs.length && deficitDays) action += ' ' + deficitDays + ' forecast day(s) have less rain than reference demand.';
    var technical = '<div class="outlook-day-grid">' + days.map(function (day) {
      return '<article class="outlook-day-card">' +
        '<b>' + esc(day.date) + '</b>' +
        '<span class="outlook-temperature">' + esc(numberOrDash(day.temperatureMean,' °C')) + '</span>' +
        '<span>Rain <b>' + esc(numberOrDash(day.precipitationMm,' mm')) + '</b></span>' +
        '<span>Reference water demand (ET₀) <b>' + esc(numberOrDash(day.referenceEt0Mm,' mm')) + '</b></span>' +
        '<span class="' + (day.waterBalanceMm != null && day.waterBalanceMm < 0 ? 'water-deficit' : '') + '">Rain − reference demand <b>' + esc(numberOrDash(day.waterBalanceMm,' mm')) + '</b></span>' +
        '<span>Modelled topsoil moisture <b>' + esc(day.soilMoistureTopM3M3 == null ? '—' : numberOrDash(day.soilMoistureTopM3M3*100,' %')) + '</b></span>' +
        '<span>Modelled topsoil temperature <b>' + esc(numberOrDash(day.soilTemperatureTopC,' °C')) + '</b></span>' +
        '<span>Air dryness estimate <b>' + esc(numberOrDash(day.vapourPressureDeficitKpa,' kPa')) + '</b></span>' +
        '</article>';
    }).join('') + '</div>';
    return renderLearningGuide(meaning,connection,action,'What might next week mean for the field?') +
      '<details class="technical-details"><summary>See the daily forecast estimates</summary>' + technical + '</details>';
  }

  function renderPlantNetResults(data) {
    var records = data && Array.isArray(data.results) ? data.results : [];
    if (!records.length) return '<p>No candidate species were returned. Try a sharper photo of the leaf, flower or fruit.</p>';
    return '<div class="plantnet-result-list">' + records.map(function (record, index) {
      return '<article class="plantnet-result-card">' +
        '<div class="plantnet-result-rank">0' + String(index+1) + '</div><div class="plantnet-result-copy">' +
        '<h4>' + esc(record.commonName || record.scientificName) + '</h4>' +
        '<p><i>' + esc(record.scientificName) + (record.authorship ? ' ' + esc(record.authorship) : '') + '</i></p>' +
        (record.family ? '<p>Family: ' + esc(record.family) + '</p>' : '') +
        '<p><b>Model confidence:</b> ' + esc(record.score == null ? '—' : (record.score*100).toFixed(1) + '%') + '</p>' +
        '</div></article>';
    }).join('') + '</div>';
  }


  function explainWaporMapset(record) {
    var code = String(record && record.code || '').toUpperCase();
    var parts = code.split('-');
    var variable = parts[1] || '';
    var timeCode = parts[2] || '';
    var levelCode = parts[0] || '';
    var dictionary = {
      AETI:{
        title:'Water leaving soil and plants',
        short:'Combines water evaporating from the soil, water released by plants and rain caught on leaves that later evaporates.',
        question:'How does water leaving the land and vegetation change through the season?',
        caution:'More water loss does not automatically mean healthier crops. Plants may be actively growing, or the area may be losing water quickly.',
        high:'Water loss is above the seasonal reference. Check crop stage, rainfall, soil moisture and whether irrigation timing is appropriate before adding or reducing water.',
        low:'Water loss is below the seasonal reference. Check whether crops are dormant, vegetation is sparse or water is limited; compare rainfall and plant-growth data before deciding.',
        steady:'The latest value is near this point’s seasonal reference. Keep observing the crop stage and soil conditions rather than changing irrigation based on this layer alone.'
      },
      E:{
        title:'Water evaporating from soil and wet surfaces',
        short:'Estimates water that returns to the air from soil or wet surfaces, separate from water released by plants through their leaves.',
        question:'Is evaporation from soil and surfaces changing compared with the same season?',
        caution:'A high value can reflect wet exposed soil and weather, not necessarily healthy crop growth.',
        high:'Evaporation is above the seasonal reference. Check whether bare or waterlogged soil is exposed; suitable soil cover or mulch may reduce avoidable evaporation.',
        low:'Evaporation is below the seasonal reference. This may reflect drier surfaces or different weather. Check rainfall and soil moisture before assuming water is sufficient.',
        steady:'Evaporation is near its seasonal reference. Maintain appropriate ground cover and compare it with rainfall and crop conditions.'
      },
      T:{
        title:'Water released by growing plants',
        short:'Estimates water absorbed by roots and released by plants through their leaves.',
        question:'How does plant water use change over the season?',
        caution:'More transpiration may mean active growth, but it can also mean more water is moving through the crop. This number alone does not diagnose plant health.',
        high:'Plant water release is above the seasonal reference. Check crop growth stage, canopy condition and soil moisture; make sure the water supply matches the crop’s stage.',
        low:'Plant water release is below the seasonal reference. Inspect crop vigour, soil moisture and whether the field is in a normal resting stage before assuming water stress.',
        steady:'Plant water release is near its seasonal reference. Continue field observation and compare with the crop’s expected growth stage.'
      },
      I:{
        title:'Rain caught by leaves and vegetation',
        short:'Estimates rain intercepted by foliage that can evaporate before reaching the ground.',
        question:'How much rain may be caught by the plant canopy in this season?',
        caution:'This does not tell us how much water reached the roots. It is influenced by the amount and type of vegetation.',
        high:'More rain interception than the seasonal reference may reflect a wet period or a developed canopy. Check soil moisture separately; do not treat this as water stored for roots.',
        low:'Less interception than the seasonal reference may reflect less rainfall or a different canopy. Compare with precipitation and field observations.',
        steady:'Interception is near its seasonal reference. Use rainfall and soil-moisture evidence to understand water available to roots.'
      },
      RET:{
        title:'How strongly the weather draws water',
        short:'Reference evapotranspiration estimates the atmosphere’s evaporative demand for a well-watered reference surface; it is not the actual water use of your crop.',
        question:'Is the atmosphere likely to draw water faster or slower than usual for this season?',
        caution:'High reference evapotranspiration can increase crop water demand, but the actual need depends on crop type, growth stage, soil and local conditions.',
        high:'Atmospheric demand is above the seasonal reference. Check soil moisture more often and use locally recommended irrigation scheduling if irrigation is available.',
        low:'Atmospheric demand is below the seasonal reference. Water demand may be lower than usual, but keep checking soil and crop conditions rather than following a fixed schedule.',
        steady:'Atmospheric demand is near its seasonal reference. Use the normal locally recommended water plan and adjust only after checking field conditions.'
      },
      RSM:{
        title:'How wet the soil is, relative to its usual range',
        short:'A model/satellite indicator of relative soil moisture—not a sensor reading at the crop’s root depth.',
        question:'Does the mapped area look relatively wetter or drier than it usually does at this time of year?',
        caution:'Very wet is not always better: some crops suffer when roots stay waterlogged. Relative moisture is not the same as a soil sample or calibrated probe.',
        high:'The soil-moisture signal is above the seasonal reference. Check for waterlogging and whether drainage is safe and adequate; avoid extra irrigation until the field is checked.',
        low:'The soil-moisture signal is below the seasonal reference. Check moisture at root depth and signs of stress. Consider locally approved water-saving measures or irrigation only if field evidence supports it.',
        steady:'Relative soil moisture is near its seasonal reference. Keep monitoring the root zone; the satellite/model pixel can differ from the actual plot.'
      },
      PCP:{
        title:'Rainfall',
        short:'A gridded estimate of rain for the map pixel and time period. It may differ from a rain gauge on the farm.',
        question:'Was this period wetter or drier than the same period in previous years?',
        caution:'More rain is not always better. Heavy rainfall may cause flooding, erosion or nutrient loss; a low total may be serious for water-sensitive crops.',
        high:'Rainfall is above the seasonal reference. Check field drainage, flood risk, erosion and crop disease. Do not work wet soil or build drainage without local advice.',
        low:'Rainfall is below the seasonal reference. Check field moisture and the local forecast; conserve moisture and review the water plan before sowing or applying inputs.',
        steady:'Rainfall is near its seasonal reference. Continue to compare with a rain gauge or field observations—short storms can be missed by a coarse pixel.'
      },
      NPP:{
        title:'New plant growth (not harvest yield)',
        short:'Net primary production estimates the carbon plants turn into new organic matter after using some energy themselves. Natural vegetation may also contribute.',
        question:'Is estimated plant growth higher or lower than in comparable periods?',
        caution:'It is not tonnes harvested, food calories or farm profit. Season, crop type, natural vegetation and pixel size all affect interpretation.',
        high:'Estimated plant productivity is above the seasonal reference. Check whether this matches the crop’s growth stage and field appearance; record the result, but do not assume the harvest will rise by the same amount.',
        low:'Estimated plant productivity is below the seasonal reference. Inspect the crop, rainfall, root-zone moisture and growth stage. Seek soil-test or extension advice before adding fertilizer or pesticide.',
        steady:'Estimated plant productivity is near its seasonal reference. Keep field notes and compare the same crop and growth stage where possible.'
      }
    };
    var explanation = dictionary[variable] || {
      title:String(record && record.caption || 'Environmental map layer'),
      short:'A satellite/model dataset describing water, rainfall or vegetation.',
      question:'What pattern does this variable show across the map or over time?',
      caution:'Open the dataset metadata and verify its unit before interpreting a number.',
      high:'A higher value should be interpreted using the variable’s unit, time period and local field conditions.',
      low:'A lower value should be interpreted using the variable’s unit, time period and local field conditions.',
      steady:'Compare with field observations and the source methodology before changing farm practices.'
    };
    var time = {D:'Every 10 days (dekadal)',M:'Monthly',E:'Daily',A:'Annual'}[timeCode] ||
      String(record && record.temporalResolution || 'Time step not confirmed');
    var level = levelCode === 'L1' ? 'Broad/global product' :
      levelCode === 'L2' ? 'National/local product where available' :
      levelCode === 'L3' ? 'Area-specific product' : String(record && record.level || 'Coverage not confirmed');
    return {
      code:code, variable:variable, time:time, level:level,
      title:explanation.title, short:explanation.short, question:explanation.question,
      caution:explanation.caution, highAction:explanation.high, lowAction:explanation.low,
      steadyAction:explanation.steady,
      resolution:String(record && record.resolutionNote || 'Check the original layer details'),
      temporal:String(record && record.temporalResolution || time)
    };
  }

  function renderWaporPointChart(data) {
    var points = data && Array.isArray(data.series) ? data.series : [];
    var visible = points.filter(function (point) { return Number.isFinite(point.value); });
    if (visible.length < 2) {
      return '<p class="wapor-chart-empty">Only ' + visible.length + ' usable point value(s) were returned, so a trend line cannot yet be drawn.</p>';
    }
    var width = 680, height = 240;
    var padL = 60, padR = 18, padT = 18, padB = 46;
    var plotW = width - padL - padR, plotH = height - padT - padB;
    var yValues = [];
    visible.forEach(function (point) {
      yValues.push(point.value);
      if (Number.isFinite(point.baselineValue)) yValues.push(point.baselineValue);
    });
    var min = Math.min.apply(null,yValues);
    var max = Math.max.apply(null,yValues);
    var span = max - min || Math.max(Math.abs(max) * 0.2, 1);
    min -= span * 0.12;
    max += span * 0.12;
    function x(index) { return padL + (index / Math.max(1,points.length - 1)) * plotW; }
    function y(value) { return padT + (max - value) / (max - min) * plotH; }
    function linePath(key) {
      var path = '';
      var started = false;
      points.forEach(function (point,index) {
        var value = point[key];
        if (!Number.isFinite(value)) { started = false; return; }
        path += (started ? ' L ' : ' M ') + x(index).toFixed(1) + ' ' + y(value).toFixed(1);
        started = true;
      });
      return path;
    }
    var grid = '';
    for (var tick = 0; tick <= 4; tick++) {
      var value = min + (max - min) * tick / 4;
      var yy = y(value);
      grid += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (width-padR) + '" y2="' + yy.toFixed(1) + '" stroke="#d8d1ba" stroke-width="1"/>' +
        '<text x="' + (padL-8) + '" y="' + (yy+4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#74654b">' + esc(value.toLocaleString('en-US',{maximumFractionDigits:2})) + '</text>';
    }
    var dots = points.map(function (point,index) {
      if (!Number.isFinite(point.value)) return '';
      return '<circle cx="' + x(index).toFixed(1) + '" cy="' + y(point.value).toFixed(1) + '" r="3.5" fill="#2d6c91"><title>' + esc(point.date) + ': ' + esc(point.value.toLocaleString('en-US',{maximumFractionDigits:3})) + ' ' + esc(data.unit) + '</title></circle>';
    }).join('');
    var labels = [0,Math.floor((points.length-1)/2),points.length-1].filter(function (v,i,a) { return a.indexOf(v) === i; }).map(function (idx) {
      return '<text x="' + x(idx).toFixed(1) + '" y="' + (height-15) + '" text-anchor="' + (idx === 0 ? 'start' : idx === points.length-1 ? 'end' : 'middle') + '" font-size="10" fill="#65543b">' + esc(points[idx].date) + '</text>';
    }).join('');
    return '<div class="wapor-chart-legend"><span><i class="wapor-legend-current"></i> Actual pixel value</span><span><i class="wapor-legend-baseline"></i> Same season in earlier years</span></div>' +
      '<svg class="wapor-line-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Recent WaPOR values compared with historical seasonal baseline">' +
      grid + '<path d="' + linePath('baselineValue') + '" fill="none" stroke="#b48a3b" stroke-width="2.5" stroke-dasharray="6 5"/>' +
      '<path d="' + linePath('value') + '" fill="none" stroke="#2d6c91" stroke-width="3"/>' + dots + labels + '</svg>';
  }

  function renderWaporPointActions(data) {
    var variable = String(data.mapset || '').split('-')[1] || '';
    var change = data.differencePercent;
    if (!Number.isFinite(change) || !Number.isFinite(data.baseline)) {
      return '<div class="wapor-result-advice"><b>How to use the result</b><p>The current value is available, but there are not enough comparable historical pixels to calculate a seasonal baseline. Read the trend and check the source portal before judging the result.</p></div>';
    }
    var label = Math.abs(change) < 20 ? 'Near seasonal baseline' : change > 0 ? 'Higher than seasonal baseline' : 'Lower than seasonal baseline';
    var description = Math.abs(change) < 20
      ? 'The latest value is within 20% of this provisional seasonal reference. This is a learning flag, not an official FAO threshold.'
      : 'The latest value differs by ' + Math.abs(change).toFixed(1) + '% from the provisional seasonal reference. A difference is a clue to investigate, not proof that a farm is good or bad.';
    var action = Math.abs(change) < 20
      ? (variable === 'NPP' ? 'Keep field notes on growth stage and visible plant condition; compare the same crop and season next time.' :
        variable === 'PCP' ? 'Keep checking the local forecast and a rain gauge; seasonal similarity does not rule out local storms or dry spells.' :
        variable === 'RSM' ? 'Keep monitoring actual root-zone moisture; the mapped pixel is not a soil probe.' :
        variable === 'RET' ? 'Follow the locally advised water plan and adjust only after observing soil and crop conditions.' :
        'Continue observation and check crop stage, rainfall and field moisture before changing farm practices.')
      : (variable === 'PCP' && change > 0 ? 'Check flooding, erosion, waterlogged areas and crop-disease conditions. Avoid working wet soil or redesigning drainage without local advice.' :
        variable === 'PCP' && change < 0 ? 'Check local rainfall and root-zone moisture; conserve moisture and review the crop water plan before sowing or applying inputs.' :
        variable === 'RSM' && change > 0 ? 'Check whether the field is waterlogged and whether the crop tolerates wet roots; do not add irrigation based on this signal.' :
        variable === 'RSM' && change < 0 ? 'Inspect root-zone moisture and signs of plant stress; consider safe water-saving or locally recommended irrigation only if field checks support it.' :
        variable === 'RET' && change > 0 ? 'Atmospheric water demand is higher; monitor soil moisture more frequently and review local irrigation scheduling.' :
        variable === 'RET' && change < 0 ? 'Atmospheric demand is lower than the seasonal reference; do not assume the crop needs the same amount of water as during hotter/drier periods.' :
        variable === 'NPP' && change > 0 ? 'Estimated plant growth is higher; check whether the crop stage and field appearance support this. Do not treat it as a yield estimate.' :
        variable === 'NPP' && change < 0 ? 'Inspect crop health, water availability, season and land cover. Confirm suspected nutrient issues with soil tests or extension advice before applying fertilizer.' :
        variable === 'AETI' && change > 0 ? 'Water leaving soil and vegetation is higher. Compare with active growth, rainfall and soil moisture; do not automatically increase irrigation.' :
        variable === 'AETI' && change < 0 ? 'Water loss is lower. Check for dormancy, sparse vegetation or water limitation, and compare with rainfall and plant-growth indicators.' :
        'Compare this signal with the layer’s specific guidance, field conditions and local technical advice before taking action.');
    return '<div class="wapor-result-advice"><span class="wapor-result-signal">' + esc(label) + '</span><p>' + esc(description) + '</p><p><b>Suggested next step:</b> ' + esc(action) + '</p></div>';
  }

  function analyzeWaporTrend(data) {
    var points = data && Array.isArray(data.series) ? data.series : [];
    var values = points.filter(function (point) { return Number.isFinite(point.value); }).map(function (point) { return point.value; });
    if (values.length < 4) return {direction:'insufficient', label:'Not enough points to see a trend', meanChange:null};
    var min = Math.min.apply(null,values);
    var max = Math.max.apply(null,values);
    var span = max-min;
    var meanAbs = values.reduce(function(sum,value){return sum+Math.abs(value);},0)/values.length;
    var noise = Math.max(span*0.04,meanAbs*0.015,1e-9);
    var rises = 0, falls = 0;
    for(var i=1;i<values.length;i++){
      var delta=values[i]-values[i-1];
      if(delta>noise) rises++;
      else if(delta< -noise) falls++;
    }
    var net=values[values.length-1]-values[0];
    var threshold=Math.max(span*0.18,meanAbs*0.04,1e-9);
    var direction='fluctuating';
    if(net>threshold && rises>=Math.max(2,falls+1)) direction='rising';
    else if(net< -threshold && falls>=Math.max(2,rises+1)) direction='falling';
    else if(rises<2 && falls<2) direction='steady';
    return {
      direction:direction,
      label:direction==='rising'?'Mostly rising':direction==='falling'?'Mostly falling':direction==='steady'?'Mostly steady':'Going up and down',
      rises:rises,falls:falls,first:values[0],last:values[values.length-1],
      meanChange:values[0]===0?null:(values[values.length-1]-values[0])/Math.abs(values[0])*100
    };
  }

  function renderWaporTrendStory(data) {
    var trend=analyzeWaporTrend(data);
    var variable=String(data && data.mapset || '').split('-')[1]||'';
    var advice={
      AETI:{
        rising:['Water loss from soil and plants is generally increasing. This can happen during active plant growth or when weather pulls more water into the air; it does not automatically mean crops are healthier.','Compare rainfall, soil moisture and plant stage. Do not automatically add irrigation.'],
        falling:['Less water is leaving the soil and vegetation than earlier in this series. Possible reasons include cooler/wetter weather changes, plants reaching maturity, sparse vegetation or limited water.','Check soil moisture and the plants themselves, then compare with rainfall before changing the water plan.'],
        fluctuating:['Water loss rises in some periods and falls in others. Weather, rainfall and plant growth stages may be changing through the season.','Compare the peaks and dips with rainfall and soil moisture; check whether these changes match the crop calendar.'],
        steady:['Water loss is staying within a similar range in the recent periods.','Keep monitoring the crop and compare this signal with field moisture; a steady line does not prove that irrigation is correct.']
      },
      PCP:{
        rising:['The rainfall estimate is getting higher across the recent periods. This may signal a wetter part of the season, not a long-term climate trend.','Check field drainage, erosion and flood risk; avoid working saturated soil. Compare with a local rain gauge or weather station.'],
        falling:['The rainfall estimate is getting lower across recent periods. The area may be moving into a drier spell or the rainy season may be ending.','Check the forecast and soil moisture, conserve water where appropriate, and review planting plans before sowing.'],
        fluctuating:['Rainfall estimates jump between wetter and drier periods. Rain often comes in bursts, so a few wet periods do not guarantee enough water for the whole crop cycle.','Check both total rainfall and dry gaps, plus local rain-gauge readings. Prepare for both heavy-rain runoff and dry spells when relevant.'],
        steady:['The rainfall estimate is fairly similar across the recent periods.','A steady pixel estimate can still miss a local storm. Keep checking the local forecast and rain gauge.']
      },
      RSM:{
        rising:['The relative-soil-moisture signal is becoming wetter. That may help a water-stressed crop, but very wet soil can also reduce oxygen around roots.','Check soil moisture at root depth and look for waterlogging. Do not irrigate more based on this map alone.'],
        falling:['The relative-soil-moisture signal is becoming drier. Plants may face more water stress, but this is a modelled relative indicator—not a sensor at the roots.','Check soil by hand or with a probe, inspect leaves, and consider local water-saving or irrigation advice only if field evidence agrees.'],
        fluctuating:['The soil-moisture signal alternates between wetter and drier periods. That can reflect rain events, drainage and plant water use.','Look for a pattern between rain and drying; check actual root-zone moisture before deciding to irrigate or drain.'],
        steady:['Relative soil moisture stays within a similar range in these periods.','Keep watching the root zone, especially during heat or critical growth stages; this broad map pixel is not a soil sensor.']
      },
      NPP:{
        rising:['The estimated production of new plant material is increasing. Vegetation may be growing more actively, but this layer can include natural vegetation and is not a crop-yield measurement.','Compare with crop stage and field appearance. Record crop condition, but do not assume harvest will rise by the same percentage.'],
        falling:['The estimated production of new plant material is decreasing. This can happen naturally as crops mature or dry, but may also signal water stress, disease or land-cover change.','Inspect plants and check rainfall, soil moisture and crop calendar. Do not apply fertilizer or pesticide until the cause is checked.'],
        fluctuating:['Estimated plant growth rises and falls across the recent periods. Seasonal growth cycles, harvesting, weather or changes in vegetation can produce this pattern.','Compare with the expected crop stage and field notes. Check the mapped pixel covers the kind of land you are studying.'],
        steady:['Estimated plant growth is within a similar range in the recent periods.','Check whether this matches the expected crop stage; stable estimated productivity does not tell us how much food will be harvested.']
      },
      RET:{
        rising:['The atmosphere’s demand for water is increasing, often with hotter, sunnier or drier conditions. Plants may lose water faster.','Check root-zone moisture more often and follow locally recommended irrigation scheduling if the crop is irrigated.'],
        falling:['The atmosphere’s demand for water is decreasing, which can happen in cooler, cloudier or more humid conditions.','Do not assume the crop needs exactly the same amount of water as in hotter periods; still check soil and crop condition.'],
        fluctuating:['Weather-driven demand for water is rising and falling. Changes in sun, wind, humidity and temperature can alter how quickly water evaporates.','Compare the peaks with weather and soil moisture; use a locally appropriate crop-water plan rather than this layer alone.'],
        steady:['Atmospheric demand for water is fairly similar across recent periods.','Continue normal monitoring and adjust water only to the crop stage and field evidence.']
      }
    };
    var entry=advice[variable]||{
      rising:['This indicator is generally increasing. Whether that is helpful depends on what the variable measures.','Read the unit and compare with field observations before acting.'],
      falling:['This indicator is generally decreasing. A lower number is not automatically better or worse.','Check the data meaning and local conditions before making a change.'],
      fluctuating:['The indicator is going up and down across recent periods. Seasonal and weather changes may explain some of the movement.','Compare dates with other layers and field notes to investigate the pattern.'],
      steady:['This indicator is fairly stable over the recent periods.','Keep observing and compare with the same season in later years.']
    };
    var selected=entry[trend.direction]||entry.fluctuating;
    var heading={
      rising:'The line is mostly going up',
      falling:'The line is mostly going down',
      fluctuating:'The line is going up and down',
      steady:'The line is mostly steady',
      insufficient:'Not enough data points yet'
    }[trend.direction];
    var pattern=trend.direction==='insufficient'
      ?'There are not enough usable dates to describe the direction confidently.'
      :trend.direction==='fluctuating'
        ?'This does not automatically mean something is wrong. The variable may change with weather, seasons and plant growth stages.'
        :trend.direction==='steady'
          ?'The recent values are within a similar range. That is a description of the data, not proof that the field is healthy or unhealthy.'
          :'The recent values show a fairly consistent direction. A few more periods and field observations help confirm whether the pattern continues.';
    return '<section class="wapor-trend-story"><div class="wapor-trend-story-heading"><span aria-hidden="true">📈</span><div><span class="mini-code">READ THE LINE IN PLAIN LANGUAGE</span><h5>' + esc(heading) + '</h5></div></div>' +
      '<p>' + esc(selected[0]) + '</p><p class="wapor-trend-context">' + esc(pattern) + '</p>' +
      '<div class="wapor-trend-action"><b>What should I do?</b><p>' + esc(selected[1]) + '</p></div>' +
      '<p class="wapor-trend-disclaimer">This story describes the recent points shown in the chart, not a long-term climate trend. The chart alone cannot prove the cause.</p></section>';
  }

  function renderWaporPointSeries(data) {
    var latest = data && data.latest;
    if (!latest || !Number.isFinite(latest.value)) return '<p class="wapor-chart-empty">No usable value was returned for this point.</p>';
    var baselineText = Number.isFinite(data.baseline)
      ? data.baseline.toLocaleString('en-US',{maximumFractionDigits:3}) + ' ' + esc(data.unit)
      : 'Not available';
    var differenceText = Number.isFinite(data.differencePercent)
      ? (data.differencePercent > 0 ? '+' : '') + data.differencePercent.toFixed(1) + '%'
      : 'Not available';
    var coords = Number(data.latitude).toFixed(4) + ', ' + Number(data.longitude).toFixed(4);
    var valueText = latest.value.toLocaleString('en-US',{maximumFractionDigits:3}) + ' ' + esc(data.unit);
    return '<section class="wapor-point-result">' +
      '<div class="wapor-result-grid">' +
      '<article><span>Latest usable value</span><strong>' + valueText + '</strong><small>' + esc(latest.date) + ' · sampled pixel</small></article>' +
      '<article><span>Seasonal baseline</span><strong>' + baselineText + '</strong><small>Mean from ' + esc(data.baselineSamples || 0) + ' comparable pixel sample(s) across previous years</small></article>' +
      '<article><span>Difference from baseline</span><strong>' + esc(differenceText) + '</strong><small>Comparison with the same calendar dekad/month/day</small></article>' +
      '</div>' +
      '<div class="wapor-trend-heading"><h5>Recent trend vs previous years</h5><span>' + esc(data.sampledPeriods) + ' usable period(s)</span></div>' +
      renderWaporPointChart(data) +
      renderWaporTrendStory(data) +
      renderWaporPointActions(data) +
      '<details class="mini-explanation"><summary>How were these numbers calculated?</summary>' +
      '<p>BackToNature samples the selected point from the official WaPOR v3 raster for each date. Raw pixel values are converted using the published layer scale factor. The seasonal baseline is the average of available samples from the same calendar period in the previous two years; it is a comparison reference, not an agronomic target or a universal definition of good/bad.</p>' +
      '<p><b>Location:</b> ' + esc(coords) + ' · <b>Scale:</b> ' + esc(data.mapset) + ' · <b>Unit:</b> ' + esc(data.unit) + '. This is one map pixel at the selected region’s representative point, not an average over the whole district or a direct sensor reading from the farm.</p>' +
      (data.partialFailures ? '<p>' + esc(data.partialFailures) + ' raster sample(s) could not be read and were omitted; check the official portal if the trend has gaps.</p>' : '') +
      '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://wapor.apps.fao.org/">Open the official WaPOR map ↗</a></details>' +
      '</section>';
  }

  function renderWaporMapsetCatalog(data) {
    var records = data && Array.isArray(data.records) ? data.records : [];
    if (!records.length) {
      return '<section class="wapor-howto"><h4>No dataset list returned</h4><p>The official catalogue returned no records this time. You can still explore the official WaPOR map.</p><a class="pixel-btn green" target="_blank" rel="noopener noreferrer" href="https://wapor.apps.fao.org/">OPEN WAPOR PORTAL ↗</a></section>';
    }
    var grid = '<div class="wapor-mapset-grid">' + records.map(function (record) {
      var explanation = explainWaporMapset(record);
      var quickStart = /PCP/.test(explanation.code) ? 'Good first layer: explore rainfall' :
        /RSM/.test(explanation.code) ? 'Good first layer: explore relative soil moisture' :
        /AETI/.test(explanation.code) ? 'Explore water loss from soil and plants' :
        /NPP/.test(explanation.code) ? 'Explore plant growth, not harvest yield' : '';
      return '<article class="wapor-mapset-card">' +
        '<div class="wapor-mapset-heading"><span class="wapor-level-tag">' + esc(explanation.level) + '</span><span class="wapor-mapset-code">Technical code: ' + esc(explanation.code) + '</span></div>' +
        '<h4>' + esc(explanation.title) + '</h4><p class="wapor-plain-meaning">' + esc(explanation.short) + '</p>' +
        '<div class="wapor-why"><b>What question can it help answer?</b><p>' + esc(explanation.question) + '</p></div>' +
        '<div class="wapor-card-guidance">' +
        '<article><b>If the value is higher than baseline</b><p>' + esc(explanation.highAction) + '</p></article>' +
        '<article><b>If the value is lower than baseline</b><p>' + esc(explanation.lowAction) + '</p></article>' +
        '</div>' +
        (quickStart ? '<p class="wapor-starter-tag">★ ' + esc(quickStart) + '</p>' : '') +
        '<details class="mini-explanation"><summary>Time period, map scale and caution</summary>' +
        '<div class="wapor-mapset-meta"><span>' + esc(explanation.time) + '</span><span>' + esc(explanation.resolution) + '</span></div>' +
        '<p><b>Important:</b> ' + esc(explanation.caution) + '</p>' +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.apiUrl)) + '">Open the original dataset details ↗</a></details>' +
        '<button class="pixel-btn green wapor-point-fetch" data-wapor-point-btn="1" data-wapor-code="' + esc(explanation.code) + '" type="button">FETCH VALUES & TREND</button>' +
        '<div class="wapor-point-status" id="wapor-status-' + esc(explanation.code) + '" aria-live="polite">Samples one pixel at the selected region’s representative point; no values are fabricated.</div>' +
        '<div class="wapor-point-results" id="wapor-series-' + esc(explanation.code) + '"><p class="wapor-chart-empty">Click “Fetch values & trend” to retrieve actual raster values and compare them with earlier matching seasons.</p></div>' +
        '</article>';
    }).join('') + '</div>';

    var pointAvailable = !!(currentProvince && geometryCentroid(currentProvince.feature));
    var pointMessage = pointAvailable
      ? 'Selected region: ' + String(currentProvince.name || 'current region') + '. Values will be sampled at an approximate representative point, not averaged over every pixel in the region.'
      : 'Select a region on the map before requesting actual pixel values.';
    return '<section class="wapor-howto">' +
      '<div class="wapor-howto-heading"><span aria-hidden="true">🗺️</span><div><div class="mini-code">START HERE</div><h4>From dataset description to real numbers</h4></div></div>' +
      '<ol><li>Choose one layer and read what it measures.</li><li>Press <b>Fetch values & trend</b> on that card to sample actual WaPOR raster values at the selected region’s representative point.</li><li>Compare the latest value with the average from the same calendar period in the previous two years.</li><li>Use the high/low guidance as a question to check in the field—not as an automatic instruction to add water or fertilizer.</li></ol>' +
      '<p class="wapor-point-selection">' + esc(pointMessage) + '</p>' +
      '<p><b>Baseline is not a universal target.</b> Seasons, crops and landscape types differ. Some layers have a coarse pixel that may cover several fields; a value above or below the reference is a signal to investigate.</p>' +
      '<p class="wapor-autoload-note"><b>Automatic on tab opening:</b> rainfall, relative soil moisture, water leaving soil/plants and estimated plant growth are loaded one at a time. The remaining variants stay on-demand to avoid downloading too many rasters at once.</p>' +
      '<a class="pixel-btn green" target="_blank" rel="noopener noreferrer" href="https://wapor.apps.fao.org/">OPEN INTERACTIVE WAPOR MAP ↗</a> ' +
      '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en">Read FAO’s data-access guide ↗</a>' +
      '</section>' +
      renderLearningGuide(
        'The card gives the meaning of the layer; the live query adds a number, an earlier-season reference and a line chart for the selected point.',
        'Rainfall, soil moisture, water loss and plant growth are related but are not interchangeable. A higher number is not always better.',
        'Read the current value and baseline together, check the date and map resolution, then verify any concern with field observations or local agricultural guidance.',
        'What do the numbers say—and what do they not say?'
      ) +
      '<section class="wapor-catalog-block"><div class="wapor-catalog-heading"><h4>Available WaPOR datasets</h4><span>' + records.length + ' datasets from the live FAO catalogue</span></div>' + grid +
      '<p class="nature-method-note">Catalogue refreshed ' + esc(new Date(data.retrievedAt).toLocaleString()) +
      '. Time step and spatial resolution differ by dataset. Pixel values are loaded only when you request them on an individual card.</p></section>';
  }

  function initNatureInlineMap(selection, selectionKey, point) {
    var node = el('nature-observation-map');
    if (!node || !window.L) return;
    if (natureInlineMap) {
      natureInlineMap.remove();
      natureInlineMap = null;
      natureInlineMarkerLayer = null;
    }
    var lat = point && Number(point.latitude);
    var lon = point && Number(point.longitude);
    var validCenter = Number.isFinite(lat) && Number.isFinite(lon);
    natureInlineMap = L.map(node, { scrollWheelZoom:false, worldCopyJump:true });
    natureInlineMap.setView(validCenter ? [lat,lon] : [0,0], validCenter ? 8 : 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:18,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
    }).addTo(natureInlineMap);
    natureInlineMarkerLayer = L.layerGroup().addTo(natureInlineMap);
    natureInlineMapSelectionKey = selectionKey;
    renderNatureInlineMarkers(selectionKey);
    window.setTimeout(function () {
      if (natureInlineMap) natureInlineMap.invalidateSize();
    }, 100);
  }

  function renderNatureInlineMarkers(selectionKey) {
    if (!natureInlineMap || !natureInlineMarkerLayer || selectionKey !== natureInlineMapSelectionKey) return 0;
    natureInlineMarkerLayer.clearLayers();
    var gbif = natureOccurrenceDataBySelection[selectionKey];
    var inat = natureINaturalistDataBySelection[selectionKey];
    var markerCount = 0;
    var seen = {};

    function addRecord(record, source) {
      if (!record) return;
      var lat = Number(record.latitude);
      var lon = Number(record.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
      var sourceId = String(record.key || record.id || '');
      var identity = source + ':' + (sourceId || String(record.scientificName || '') + ':' + lat.toFixed(5) + ':' + lon.toFixed(5));
      if (seen[identity]) return;
      seen[identity] = true;
      var name = String(record.vernacularName || record.commonName || record.scientificName || 'Unidentified species');
      var sourceUrl = safeHttps(record.sourceUrl || record.uri);
      var date = String(record.eventDate || record.observedOn || '');
      var popup = '<div class="nature-map-popup"><span class="nature-map-popup-source">' + esc(source === 'GBIF' ? 'GBIF RECORD' : 'iNATURALIST OBSERVATION') + '</span>' +
        '<h3>' + esc(name) + '</h3><p><i>' + esc(record.scientificName || name) + '</i></p>' +
        (date ? '<p><b>Date:</b> ' + esc(date) + '</p>' : '') +
        (record.locality ? '<p>' + esc(record.locality) + '</p>' : '') +
        '<p class="nature-map-popup-note">This is a reported observation, not a complete survey.</p>' +
        (sourceUrl !== '#' ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(sourceUrl) + '">Open source record ↗</a>' : '') + '</div>';
      var marker = L.circleMarker([lat,lon], {
        radius:source === 'GBIF' ? 6 : 5,
        color:source === 'GBIF' ? '#2e6b45' : '#2367a8',
        weight:2,
        fillColor:source === 'GBIF' ? '#70b778' : '#6ab5ef',
        fillOpacity:0.9
      });
      marker.bindPopup(popup, { maxWidth:260 });
      marker.addTo(natureInlineMarkerLayer);
      markerCount++;
    }

    var gbifRecords = gbif && Array.isArray(gbif.observations) ? gbif.observations :
      (gbif && Array.isArray(gbif.records) ? gbif.records : []);
    gbifRecords.forEach(function (record) { addRecord(record, 'GBIF'); });
    (inat && Array.isArray(inat.records) ? inat.records : []).forEach(function (record) { addRecord(record, 'iNaturalist'); });

    var summary = el('nature-map-summary');
    if (summary) summary.textContent = markerCount
      ? 'Showing ' + markerCount + ' mapped observations returned by the live sources. A point means a record exists—not that a species is common.'
      : 'No mapped observations yet. The map will update when GBIF or iNaturalist returns records with coordinates.';
    if (markerCount && natureInlineMarkerLayer.getLayers().length) {
      var bounds = natureInlineMarkerLayer.getBounds();
      if (bounds && bounds.isValid()) natureInlineMap.fitBounds(bounds.pad(0.15), { maxZoom:11 });
    }
    return markerCount;
  }

  function renderNatureObservationMarkers(selectionKey) {
    if (!natureObservationLayer || !map || !selectionKey) return;
    natureObservationLayer.clearLayers();
    natureObservationLayerSelectionKey = selectionKey;
    var gbif = natureOccurrenceDataBySelection[selectionKey];
    var inat = natureINaturalistDataBySelection[selectionKey];
    var markerCount = 0;
    var seen = {};

    function addRecord(record, source) {
      if (!record) return;
      var latitude = Number(record.latitude);
      var longitude = Number(record.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
      var sourceId = String(record.key || record.id || '');
      var scientificName = String(record.scientificName || 'Unidentified species');
      var date = String(record.eventDate || record.observedOn || '');
      var recordKey = source + ':' + (sourceId || scientificName.toLowerCase() + ':' + latitude.toFixed(5) + ':' + longitude.toFixed(5));
      if (seen[recordKey]) return;
      seen[recordKey] = true;

      var commonName = String(record.vernacularName || record.commonName || '');
      var displayName = commonName || scientificName;
      var distance = Number(record.distanceKm);
      var distanceText = Number.isFinite(distance) ? distance.toFixed(1) + ' km from representative point' : 'Distance not supplied';
      var sourceUrl = safeHttps(record.sourceUrl || record.uri);
      var taxonUrl = safeHttps(record.taxonUrl ||
        (/^\\d+$/.test(String(record.taxonKey || '')) ? 'https://www.gbif.org/species/' + record.taxonKey : sourceUrl));
      var detailLines = [
        '<div class="nature-map-popup">',
        '<div class="nature-map-popup-source">' + (source === 'GBIF' ? 'GBIF OCCURRENCE' : 'iNATURALIST OBSERVATION') + '</div>',
        '<h3>' + esc(displayName) + '</h3>',
        '<p class="nature-map-popup-scientific"><i>' + esc(scientificName) + '</i></p>',
        date ? '<p><b>Observed / recorded:</b> ' + esc(date) + '</p>' : '',
        '<p>' + esc(distanceText) + '</p>',
        source === 'GBIF' && record.locality ? '<p>' + esc(record.locality) + '</p>' : '',
        source === 'iNaturalist' && record.place ? '<p>' + esc(record.place) + '</p>' : '',
        source === 'iNaturalist' && record.observer ? '<p><b>Observer:</b> ' + esc(record.observer) + '</p>' : '',
        '<p class="nature-map-popup-note">A reported observation, not a complete species distribution or crop-suitability assessment.</p>',
        '<div class="nature-map-popup-links">',
        sourceUrl !== '#' ? '<a href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Open source record ↗</a>' : '',
        taxonUrl !== '#' ? '<a href="' + esc(taxonUrl) + '" target="_blank" rel="noopener noreferrer">Open taxon ↗</a>' : '',
        '</div></div>'
      ].filter(Boolean).join('');
      var isGbif = source === 'GBIF';
      var marker = L.circleMarker([latitude,longitude], {
        radius:isGbif ? 7 : 6,
        color:isGbif ? '#2e6b45' : '#2367a8',
        weight:2,
        fillColor:isGbif ? '#70b778' : '#6ab5ef',
        fillOpacity:0.9,
        opacity:1
      });
      marker.bindTooltip(esc(displayName), { direction:'top', sticky:true, className:'retro-tooltip' });
      marker.bindPopup(detailLines, { maxWidth:300, minWidth:220, autoPan:true });
      marker.addTo(natureObservationLayer);
      markerCount += 1;
    }

    var gbifRecords = gbif && Array.isArray(gbif.observations) ? gbif.observations :
      (gbif && Array.isArray(gbif.records) ? gbif.records : []);
    gbifRecords.forEach(function (record) { addRecord(record,'GBIF'); });
    (inat && Array.isArray(inat.records) ? inat.records : []).forEach(function (record) { addRecord(record,'iNaturalist'); });

    renderNatureInlineMarkers(selectionKey);
    if (markerCount) {
      natureObservationLayer.addTo(map);
    } else if (map.hasLayer(natureObservationLayer)) {
      map.removeLayer(natureObservationLayer);
    }
    return markerCount;
  }

  function renderNatureExplorer(profile) {
    var key = climateSelectionKey(currentProvince);
    var occurrenceData = natureOccurrenceDataBySelection[key];
    var occurrenceStatus = natureOccurrenceStatusBySelection[key] || { type:'neutral', message:'Not queried yet' };
    var iNatData = natureINaturalistDataBySelection[key];
    var iNatStatus = natureINaturalistStatusBySelection[key] || { type:'neutral', message:'Not queried yet' };
    var powerData = naturePowerDataBySelection[key];
    var powerStatus = naturePowerStatusBySelection[key] || { type:'neutral', message:'Not queried yet' };
    var outlookData = natureOutlookDataBySelection[key];
    var outlookStatus = natureOutlookStatusBySelection[key] || { type:'neutral', message:'Not queried yet' };
    var waporData = natureWaporDataBySelection[key];
    var waporStatus = natureWaporStatusBySelection[key] || { type:'neutral', message:'Not queried yet' };
    var region = currentProvince && currentProvince.name || profile.name;
    var point = currentProvince && geometryCentroid(currentProvince.feature);
    var pointText = point ? (Number(point.latitude).toFixed(4) + ', ' + Number(point.longitude).toFixed(4)) : 'representative point unavailable';
    var intro = '<div class="tab-intro"><div class="eyebrow">NATURE & CLIMATE / FIELD EXPLORER</div>' +
      '<h2>What has been reported near this region? 🌿</h2>' +
      '<p>When this tab opens, BackToNature checks several free public sources automatically. It shows an error rather than inventing a result if a source is unavailable.</p>' +
      '<details class="technical-details"><summary>How do the map searches work?</summary><p>Searches use an approximate representative point (' + esc(pointText) + ') and a nearby radius. This is a discovery aid, not a complete survey of every place in ' + esc(region) + '.</p></details></div>';
    var beginnerGuide = renderLearningGuide(
      'Species lists show plants that people or research projects have reported nearby. Weather layers describe a broader area using historical records or computer models.',
      'Plant observations help us ask what may live in the area. Rainfall, temperature and soil moisture describe conditions, but they do not prove that a plant will grow well on a farm.',
      'Open the original observation for context, check the date, then compare the map with a real field visit. Record what you see in My Plot Field Log.',
      'A clue is not the whole story'
    );
    return intro + beginnerGuide +
      '<div class="tile-grid nature-connectors-grid">' +
      '<article class="field-card nature-connector-card"><div class="card-topline"><span class="card-emoji">🌱</span><span class="mini-code">GBIF / PLANTS</span></div>' +
      '<h3>Plant reports nearby</h3><p>Find georeferenced plant reports within about 25 km. They document reported presence, not how many plants exist or whether they are suitable crops.</p>' +
      '<button id="nature-gbif-btn" class="pixel-btn green" type="button">↻ REFRESH PLANT REPORTS</button>' +
      '<div id="nature-gbif-status" class="live-status ' + esc(occurrenceStatus.type) + '" aria-live="polite">' + esc(occurrenceStatus.message) + '</div>' +
      '<section class="nature-inline-map-wrap" aria-label="Biodiversity observation map">' +
      '<div class="nature-inline-map-heading"><b>Where were plants reported?</b><span class="mini-code">MAP OF OBSERVATIONS</span></div>' +
      '<p>Each dot is a georeferenced report, not a count of all plants. Green dots are GBIF records; blue dots are iNaturalist observations.</p>' +
      '<div id="nature-observation-map" class="nature-inline-map" role="region" aria-label="Interactive map of nearby biodiversity records"></div>' +
      '<p id="nature-map-summary" class="nature-inline-map-summary">Loading nearby records…</p></section>' +
      '<div id="nature-gbif-results" class="live-results">' + (occurrenceData ? renderNatureOccurrenceCards(occurrenceData) : 'Nearby plant reports will appear here when the search finishes.') + '</div>' +
      '<p class="nature-method-note">Source: <a target="_blank" rel="noopener noreferrer" href="https://techdocs.gbif.org/en/openapi/v1/occurrence">GBIF Occurrence API ↗</a></p></article>' +
      '<article class="field-card nature-connector-card"><div class="card-topline"><span class="card-emoji">🌿</span><span class="mini-code">INATURALIST / PLANTS</span></div>' +
      '<h3>Check another source</h3><p>iNaturalist adds a second set of community observations. The same plant may appear in both sources, and some places have more observers than others.</p>' +
      '<button id="nature-inat-btn" class="pixel-btn green" type="button">↻ REFRESH SECOND SOURCE</button>' +
      '<div id="nature-inat-status" class="live-status ' + esc(iNatStatus.type) + '" aria-live="polite">' + esc(iNatStatus.message) + '</div>' +
      '<div id="nature-inat-results" class="live-results">' + (iNatData ? renderINaturalistPlantRecords(iNatData) : 'A second set of plant reports will appear here.') + '</div>' +
      '<p class="nature-method-note">Source: <a target="_blank" rel="noopener noreferrer" href="https://www.inaturalist.org/pages/developers">iNaturalist API ↗</a></p></article>' +
      '<article class="field-card nature-connector-card"><div class="card-topline"><span class="card-emoji">☀️</span><span class="mini-code">NASA POWER / HISTORY</span></div>' +
      '<h3>Usual climate through the year</h3><p>Historical estimates for temperature, rainfall rate and sunlight, averaged by month over five complete years.</p>' +
      '<button id="nature-power-btn" class="pixel-btn green" type="button">↻ REFRESH CLIMATE HISTORY</button>' +
      '<div id="nature-power-status" class="live-status ' + esc(powerStatus.type) + '" aria-live="polite">' + esc(powerStatus.message) + '</div>' +
      '<div id="nature-power-results" class="live-results">' + (powerData ? renderNasaPowerMonthCards(powerData) : 'The usual seasonal pattern will appear here.') + '</div>' +
      '<p class="nature-method-note">Source: <a target="_blank" rel="noopener noreferrer" href="https://power.larc.nasa.gov/docs/services/api/temporal/monthly/">NASA POWER API ↗</a></p></article>' +
      '<article class="field-card nature-connector-card"><div class="card-topline"><span class="card-emoji">💧</span><span class="mini-code">OPEN-METEO / NEXT WEEK</span></div>' +
      '<h3>What may the next week bring?</h3><p>A short-term forecast to help plan a visit or observation. It is modelled weather, not a sensor installed on the farm.</p>' +
      '<button id="nature-outlook-btn" class="pixel-btn green" type="button">↻ REFRESH NEXT-WEEK OUTLOOK</button>' +
      '<div id="nature-outlook-status" class="live-status ' + esc(outlookStatus.type) + '" aria-live="polite">' + esc(outlookStatus.message) + '</div>' +
      '<div id="nature-outlook-results" class="live-results">' + (outlookData ? renderOpenMeteoOutlook(outlookData) : 'The forecast summary will appear here.') + '</div>' +
      '<p class="nature-method-note">Source: <a target="_blank" rel="noopener noreferrer" href="https://open-meteo.com/en/docs">Open-Meteo API ↗</a></p></article>' +
      '</div>' +
      '<section class="live-connectors plantnet-panel"><div class="section-title"><span class="mini-code">OPTIONAL PHOTO TOOL / PL@NTNET</span><h3>Would you like help identifying a plant? 📷</h3></div>' +
      '<p class="live-explainer">This optional tool needs your own Pl@ntNet key and sends selected photos only after you press Identify. Treat its best match as a suggestion and compare it with the original photo and local expertise. Never paste a shared organisation secret into this public page.</p>' +
      '<div class="plantnet-controls"><label for="plantnet-api-key">Your Pl@ntNet API key</label><input id="plantnet-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your personal key for this request">' +
      '<label for="plantnet-photos">Photos of one plant (1–5)</label><input id="plantnet-photos" type="file" accept="image/jpeg,image/png" multiple>' +
      '<label for="plantnet-organ">What part is in the photo?</label><select id="plantnet-organ"><option value="auto">Not sure / automatic</option><option value="leaf">Leaf</option><option value="flower">Flower</option><option value="fruit">Fruit</option><option value="bark">Bark</option></select>' +
      '<button id="plantnet-identify-btn" class="pixel-btn green" type="button">IDENTIFY PLANT</button></div>' +
      '<div id="plantnet-status" class="live-status" aria-live="polite">Optional service · your key has not been supplied</div>' +
      '<div id="plantnet-results" class="live-results">No photo has been sent.</div>' +
      '<a href="https://my.plantnet.org/" target="_blank" rel="noopener noreferrer" aria-label="Powered by Pl@ntNet"><img class="plantnet-powered-logo" src="https://my.plantnet.org/images/powered-by-plantnet-light.png" alt="Powered by Pl@ntNet" loading="lazy"></a>' +
      '<p class="nature-method-note">Photo identification can be wrong. <a target="_blank" rel="noopener noreferrer" href="https://my.plantnet.org/terms_of_use">Pl@ntNet use terms ↗</a></p></section>' +
      '<section class="live-connectors wapor-panel"><div class="section-title"><span class="mini-code">FAO / WAPOR VERSION 3</span><h3>Explore water and plant-growth maps</h3></div>' +
      '<p class="live-explainer">The free public catalogue lists satellite/model datasets on rainfall, water use, soil moisture and vegetation productivity. The catalogue itself does not read a value from your plot.</p>' +
      '<button id="nature-wapor-btn" class="pixel-btn green" type="button">↻ REFRESH DATASET LIST</button>' +
      '<div id="nature-wapor-status" class="live-status ' + esc(waporStatus.type) + '" aria-live="polite">' + esc(waporStatus.message) + '</div>' +
      '<div id="nature-wapor-results" class="live-results">' + (waporData ? renderWaporMapsetCatalog(waporData) : 'The dataset list will appear here.') + '</div>' +
      '<p class="nature-method-note">Source: <a target="_blank" rel="noopener noreferrer" href="https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en">FAO WaPOR v3 data guide ↗</a></p></section>' +
      '<details class="technical-details"><summary>How to interpret this tab</summary><p>GBIF and iNaturalist show reported observations, not abundance. NASA POWER and Open-Meteo show gridded estimates, not in-situ measurements. A blank result often means the source did not return a record, not that no plants or water exist.</p><p>Use the data to ask a better field question, then verify on site. <a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en">FAO WaPOR source guide ↗</a></p></details>';
  }

  function wireWaporPointControls() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-wapor-point-btn]'), function (button) {
      if (button.getAttribute('data-wapor-wired') === '1') return;
      button.setAttribute('data-wapor-wired','1');
      button.addEventListener('click', async function () {
        var selection = currentProvince;
        var point = selection && geometryCentroid(selection.feature);
        var code = button.getAttribute('data-wapor-code') || '';
        var resultNode = el('wapor-series-' + code);
        var statusNode = el('wapor-status-' + code);
        var api = window.BackToNatureAPI;
        if (!point) {
          if (statusNode) statusNode.textContent = 'Select a region first. No geographic point is available for this boundary.';
          return;
        }
        if (!api || typeof api.fetchWaporPointSeries !== 'function') {
          if (statusNode) statusNode.textContent = 'WaPOR point-sampling connector is unavailable. Refresh the page and retry.';
          return;
        }
        button.disabled = true;
        button.textContent = 'READING RASTER PIXELS…';
        if (statusNode) statusNode.textContent = 'Requesting the official raster time series and sampling the selected point. This may take a little while; no sample values are inserted.';
        if (resultNode) resultNode.innerHTML = '<p class="wapor-chart-empty">Loading time series and historical comparisons from the public WaPOR rasters…</p>';
        try {
          var automatic = button.getAttribute('data-wapor-autoloading') === '1';
          var result = await api.fetchWaporPointSeries(code, point.latitude, point.longitude, automatic ? {maxPeriods:6} : {maxPeriods:12});
          if (currentProvince !== selection || currentTab !== 'nature') return;
          if (resultNode) resultNode.innerHTML = renderWaporPointSeries(result);
          if (statusNode) statusNode.textContent = result.sampledPeriods + ' recent period(s) with values loaded from the live WaPOR v3 raster. Point: ' +
            Number(result.latitude).toFixed(4) + ', ' + Number(result.longitude).toFixed(4) + '.';
          button.textContent = 'VALUES & TREND LOADED';
        } catch (error) {
          if (currentProvince !== selection || currentTab !== 'nature') return;
          if (statusNode) statusNode.textContent = error && error.message ? error.message : 'The WaPOR point query failed.';
          if (resultNode) resultNode.innerHTML = '<div class="wapor-query-error"><b>No value was substituted.</b><p>The raster could not be sampled for this point. You can still inspect the location in the official WaPOR map, or retry after checking your network connection.</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="https://wapor.apps.fao.org/">Open official WaPOR map ↗</a></div>';
          button.textContent = 'RETRY VALUES & TREND';
        } finally {
          if (currentProvince === selection && currentTab === 'nature') button.disabled = false;
        }
      });
    });
  }

  function autoFetchWaporLearningLayers() {
    if (currentTab !== 'nature' || !currentProvince) return;
    var selection = currentProvince;
    var codes = ['L1-PCP-D','L1-RSM-D','L1-AETI-D','L1-NPP-D'];
    (async function () {
      for (var i=0;i<codes.length;i++) {
        if (currentTab !== 'nature' || currentProvince !== selection) return;
        var code = codes[i];
        var button = document.querySelector('[data-wapor-point-btn][data-wapor-code="' + code + '"]');
        if (!button || button.getAttribute('data-wapor-autoloaded') === '1') continue;
        button.setAttribute('data-wapor-autoloaded','1');
        button.setAttribute('data-wapor-autoloading','1');
        button.click();
        var started = Date.now();
        while (button.isConnected && button.disabled && Date.now()-started < 180000) {
          if (currentTab !== 'nature' || currentProvince !== selection) return;
          await new Promise(function (resolve) { window.setTimeout(resolve,250); });
        }
        button.removeAttribute('data-wapor-autoloading');
        if (!button.isConnected || currentTab !== 'nature' || currentProvince !== selection) return;
        await new Promise(function (resolve) { window.setTimeout(resolve,250); });
      }
    })();
  }

  function wireNatureControls() {
    var selection = currentProvince;
    if (!selection) return;
    var key = climateSelectionKey(selection);
    var point = geometryCentroid(selection.feature);
    initNatureInlineMap(selection, key, point);
    renderNatureObservationMarkers(key);
    wireWaporPointControls();
    autoFetchWaporLearningLayers();

    function updateAsyncConnector(config) {
      var button = el(config.buttonId);
      if (!button) return;
      button.addEventListener('click', async function () {
        if (!point && config.requiresPoint !== false) {
          config.statusStore[key] = { type:'error', message:'No representative coordinate is available for this boundary.' };
          setLiveStatus(config.statusId, config.statusStore[key].message, 'error');
          return;
        }
        var api = window.BackToNatureAPI;
        if (!api || typeof api[config.method] !== 'function') {
          setLiveStatus(config.statusId, 'Connector unavailable. Reload the page and retry.', 'error');
          return;
        }
        var requestId = ++config.requestCounter.value;
        button.disabled = true;
        config.statusStore[key] = { type:'pending', message:config.loadingMessage };
        setLiveStatus(config.statusId, config.statusStore[key].message, 'pending');
        try {
          var result = await api[config.method].apply(api, config.args(point, true));
          if (requestId !== config.requestCounter.value || currentProvince !== selection) return;
          config.dataStore[key] = result;
          if (typeof config.onSuccess === 'function') config.onSuccess(result, key, selection);
          config.statusStore[key] = { type:'success', message:config.successMessage(result) };
          if (currentTab === 'nature') {
            setLiveStatus(config.statusId, config.statusStore[key].message, 'success');
            var results = el(config.resultsId);
            if (results) results.innerHTML = config.render(result);
            if (typeof config.afterRender === 'function') config.afterRender(result,key,selection);
          }
        } catch (error) {
          if (requestId !== config.requestCounter.value || currentProvince !== selection) return;
          config.statusStore[key] = { type:'error', message:error && error.message ? error.message : config.failureMessage };
          if (currentTab === 'nature') {
            setLiveStatus(config.statusId, config.statusStore[key].message, 'error');
            var failedResults = el(config.resultsId);
            if (failedResults) failedResults.textContent = 'No sample data was substituted. Check the network/source and retry.';
          }
        } finally {
          if (requestId === config.requestCounter.value) {
            var activeButton = el(config.buttonId);
            if (activeButton && currentProvince === selection && currentTab === 'nature') activeButton.disabled = false;
          }
        }
      });
      if (!config.statusStore[key]) button.click();
    }

    updateAsyncConnector({
      buttonId:'nature-gbif-btn', statusId:'nature-gbif-status', resultsId:'nature-gbif-results',
      statusStore:natureOccurrenceStatusBySelection, dataStore:natureOccurrenceDataBySelection,
      requestCounter:{ get value(){ return natureOccurrenceRequestId; }, set value(v){ natureOccurrenceRequestId=v; } },
      method:'fetchGbifOccurrences',
      args:function(p,refresh){return [p.latitude,p.longitude,25,12,{plantOnly:true,forceRefresh:refresh}];},
      loadingMessage:'Searching GBIF for plant species records…',
      successMessage:function(d){return (d.records||[]).length+' distinct nearby plant taxa returned by GBIF.';},
      failureMessage:'GBIF plant search failed.',
      render:renderNatureOccurrenceCards,
      onSuccess:function(){renderNatureObservationMarkers(key);}
    });
    updateAsyncConnector({
      buttonId:'nature-inat-btn', statusId:'nature-inat-status', resultsId:'nature-inat-results',
      statusStore:natureINaturalistStatusBySelection, dataStore:natureINaturalistDataBySelection,
      requestCounter:{ get value(){ return natureINaturalistRequestId; }, set value(v){ natureINaturalistRequestId=v; } },
      method:'fetchINaturalistPlantObservations',
      args:function(p,refresh){return [p.latitude,p.longitude,25,8,refresh];},
      loadingMessage:'Searching iNaturalist for recent research-grade plant observations…',
      successMessage:function(d){return (d.records||[]).length+' distinct nearby plant taxa returned by iNaturalist.';},
      failureMessage:'iNaturalist search failed.',
      render:renderINaturalistPlantRecords,
      onSuccess:function(){renderNatureObservationMarkers(key);}
    });
    updateAsyncConnector({
      buttonId:'nature-power-btn', statusId:'nature-power-status', resultsId:'nature-power-results',
      statusStore:naturePowerStatusBySelection, dataStore:naturePowerDataBySelection,
      requestCounter:{ get value(){ return naturePowerRequestId; }, set value(v){ naturePowerRequestId=v; } },
      method:'fetchNasaPowerMonthly',
      args:function(p,refresh){return [p.latitude,p.longitude,5,refresh];},
      loadingMessage:'Requesting NASA POWER monthly data…',
      successMessage:function(d){return 'Monthly averages across '+d.startYear+'–'+d.endYear+' loaded from NASA POWER.';},
      failureMessage:'NASA POWER query failed.',
      render:renderNasaPowerMonthCards
    });
    updateAsyncConnector({
      buttonId:'nature-outlook-btn', statusId:'nature-outlook-status', resultsId:'nature-outlook-results',
      statusStore:natureOutlookStatusBySelection, dataStore:natureOutlookDataBySelection,
      requestCounter:{ get value(){ return natureOutlookRequestId; }, set value(v){ natureOutlookRequestId=v; } },
      method:'fetchOpenMeteoAgroOutlook',
      args:function(p,refresh){return [p.latitude,p.longitude,refresh];},
      loadingMessage:'Requesting the Open-Meteo seven-day rain/ET₀ outlook…',
      successMessage:function(d){return 'Seven-day outlook loaded'+(d.timezone?' · '+d.timezone:'')+'.';},
      failureMessage:'Open-Meteo forecast query failed.',
      render:renderOpenMeteoOutlook
    });
    updateAsyncConnector({
      buttonId:'nature-wapor-btn', statusId:'nature-wapor-status', resultsId:'nature-wapor-results',
      statusStore:natureWaporStatusBySelection, dataStore:natureWaporDataBySelection,
      requestCounter:{ get value(){ return natureWaporRequestId; }, set value(v){ natureWaporRequestId=v; } },
      method:'fetchWaporMapsets',
      requiresPoint:false,
      args:function(p,refresh){return [refresh];},
      loadingMessage:'Loading public WaPOR v3 dataset metadata…',
      successMessage:function(d){return (d.records||[]).length+' global WaPOR mapsets returned from the official catalog.';},
      failureMessage:'WaPOR catalogue request failed.',
      render:renderWaporMapsetCatalog,
      afterRender:function(){wireWaporPointControls();autoFetchWaporLearningLayers();}
    });

    var identifyButton = el('plantnet-identify-btn');
    if (identifyButton) identifyButton.addEventListener('click', async function () {
      var api = window.BackToNatureAPI;
      var keyInput = el('plantnet-api-key');
      var photoInput = el('plantnet-photos');
      var organInput = el('plantnet-organ');
      var statusId = 'plantnet-status';
      var resultsId = 'plantnet-results';
      var suppliedKey = keyInput ? keyInput.value.trim() : '';
      var files = photoInput && photoInput.files ? photoInput.files : [];
      if (!api || typeof api.identifyPlantWithPlantNet !== 'function') {
        setLiveStatus(statusId,'Pl@ntNet connector unavailable. Reload the page and retry.','error');
        return;
      }
      if (!suppliedKey) {
        setLiveStatus(statusId,'Enter your own personal Pl@ntNet API key. It is not saved by this app.','error');
        if (keyInput) keyInput.focus();
        return;
      }
      if (!files.length || files.length > 5) {
        setLiveStatus(statusId,'Choose 1–5 JPEG/PNG photos of the same plant.','error');
        if (photoInput) photoInput.focus();
        return;
      }
      var totalBytes=0;
      for (var i=0;i<files.length;i++) totalBytes+=Number(files[i].size)||0;
      if (totalBytes>50*1024*1024) {
        setLiveStatus(statusId,'Combined photo size must not exceed 50 MB.','error');
        return;
      }
      var requestId=++plantNetRequestId;
      identifyButton.disabled=true;
      setLiveStatus(statusId,'Sending the selected photos to Pl@ntNet for identification…','pending');
      var resultNode=el(resultsId);
      if(resultNode) resultNode.textContent='Waiting for the identification result…';
      try {
        var result=await api.identifyPlantWithPlantNet(files,suppliedKey,organInput?organInput.value:'auto');
        if(requestId!==plantNetRequestId || currentProvince!==selection) return;
        if(resultNode) resultNode.innerHTML=renderPlantNetResults(result);
        var quota=result.remainingIdentificationRequests==null?'':' · '+result.remainingIdentificationRequests+' daily request(s) remaining';
        setLiveStatus(statusId,'Identification returned '+(result.results||[]).length+' candidate(s)'+quota+'. Review the confidence scores; this is not a definitive determination.','success');
        if(keyInput) keyInput.value='';
      } catch(error) {
        if(requestId!==plantNetRequestId || currentProvince!==selection) return;
        setLiveStatus(statusId,error&&error.message?error.message:'Pl@ntNet identification failed.','error');
        if(resultNode) resultNode.textContent='No example identifications were substituted. Check the API key, quota, file format or network and retry.';
      } finally {
        if(requestId===plantNetRequestId && currentProvince===selection && currentTab==='nature') identifyButton.disabled=false;
        if(keyInput) keyInput.value='';
      }
    });
  }

  function renderTab(tab) {
    if (!currentProvince) return;
    var profile = profileFor(currentProvince.name);
    var content = el('modal-content');
    if (!content) return;
    if (natureInlineMap) {
      natureInlineMap.remove();
      natureInlineMap = null;
      natureInlineMarkerLayer = null;
      natureInlineMapSelectionKey = '';
    }
    currentTab = tab;
    content.innerHTML = tab === 'overview' ? renderOverview(profile) :
      tab === 'soil' ? renderSoil(profile) :
      tab === 'crops' ? renderCrops(profile) :
      tab === 'climate' ? renderClimateAndPlanting(profile) :
      tab === 'farming' ? renderFarming(profile) :
      tab === 'technology' ? renderTechnology(profile) :
      tab === 'nature' ? renderNatureExplorer(profile) : renderSources(profile);
    if (tab === 'sources') wireSourceControls(profile);
    if (tab === 'nature') wireNatureControls();
    if (tab === 'crops') wireCropLab(profile);
    if (tab === 'climate') wireClimateControls();
    if (tab === 'overview') { wireClimatePreview(); updateClimatePreview(); }
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    content.scrollTop = 0;
  }

  function regionSummaryContext(selection) {
    var profile = profileFor(selection && selection.name || 'Selected region');
    var techList = techByKind[profile.kind] || techByKind['mixed-lowland'] || [];
    var countryName = selection && selection.countryName ||
      (selection && selection.countryIso3 && countryByISO3[selection.countryIso3] && countryByISO3[selection.countryIso3].name) ||
      (selectedCountry && selectedCountry.name) || 'Selected country';
    var level = selection && Number(selection.adminLevel) === 2 ? 'District / ADM2' : 'Province, state or region / ADM1';
    return { profile:profile, techList:techList, countryName:countryName, level:level };
  }

  function summaryCropCandidates(selection, profile, climateResult) {
    var api = window.BackToNatureAPI;
    var catalog = api && api.getCropCatalog ? api.getCropCatalog() : [];
    var byId = {};
    catalog.forEach(function (crop) { byId[crop.id] = crop; });
    var output = [];
    var seen = {};

    function addId(id) {
      var item = byId[id];
      if (item && !seen[id]) {
        seen[id] = true;
        output.push(item);
      }
    }

    // A fresh climate profile takes priority because its ranking changes with location.
    if (climateResult && Array.isArray(climateResult.recommendations) && climateResult.recommendations.length) {
      climateResult.recommendations.slice(0,4).forEach(function (crop) { addId(crop.id); });
      if (output.length >= 3) return output;
    }

    var aliases = {
      'padi sawah':['rice'],'padi rawa':['rice'],'padi lokal':['rice'],'padi':['rice'],'rice':['rice'],
      'jagung':['maize'],'maize':['maize'],'corn':['maize'],
      'sorgum':['sorghum'],'sorghum':['sorghum'],
      'kacang hijau':['mung-bean'],'mung bean':['mung-bean'],
      'kacang tanah':['peanut'],'peanut':['peanut'],'groundnut':['peanut'],
      'kedelai':['soybean'],'soybean':['soybean'],
      'singkong':['cassava'],'ubi kayu':['cassava'],'cassava':['cassava'],
      'ubi jalar':['sweet-potato'],'sweet potato':['sweet-potato'],
      'cabai':['chili'],'cabai rawit':['chili'],'chili':['chili'],'tomat':['tomato'],'tomato':['tomato'],
      'sayuran daun':['leafy-greens'],'sayuran':['leafy-greens'],'sayuran skala kebun':['leafy-greens'],
      'kentang':['potato'],'potato':['potato'],
      'pisang':['banana'],'banana':['banana'],'kelapa':['coconut'],'coconut':['coconut'],
      'kopi arabika':['coffee-arabica'],'kopi robusta':['coffee-robusta'],
      'kopi':['coffee-arabica','coffee-robusta'],'arabica coffee':['coffee-arabica'],'robusta coffee':['coffee-robusta'],
      'kakao':['cacao'],'cokelat':['cacao'],'cocoa':['cacao'],'cacao':['cacao'],
      'mangga':['mango'],'mango':['mango'],'nanas':['pineapple'],'pineapple':['pineapple'],
      'sagu':['sago'],'sago':['sago'],'vetiver':['vetiver'],'akar wangi':['vetiver'],
      'jambu mete':['cashew'],'jambu monyet':['cashew'],'cashew':['cashew'],
      'asam':['tamarind'],'asam jawa':['tamarind'],'tamarind':['tamarind'],
      'bawang merah':['shallot'],'shallot':['shallot'],
      'cengkeh':['clove'],'clove':['clove'],
      'durian':['durian'],
      'karet':['rubber'],'rubber':['rubber'],
      'kayu manis':['cinnamon'],'cinnamon':['cinnamon'],
      'lada':['black-pepper'],'black pepper':['black-pepper'],
      'pala':['nutmeg'],'nutmeg':['nutmeg'],
      'kelapa sawit':['oil-palm'],'oil palm':['oil-palm'],
      'tebu':['sugarcane'],'sugarcane':['sugarcane'],
      'teh':['tea'],'tea':['tea'],
      'pinang':['areca-palm'],'areca palm':['areca-palm'],
      'salak':['salak'],'snake fruit':['salak'],
      'tembakau':['tobacco'],'tobacco':['tobacco'],
      'kopi liberika':['coffee-liberica'],'liberica coffee':['coffee-liberica']
    };
    (profile.crops || []).forEach(function (cropName) {
      var keyName = norm(cropName);
      var ids = aliases[keyName];
      // Regional crop labels often contain a qualifier like "on suitable land".
      if (!ids && /padi|beras/.test(keyName)) ids = ['rice'];
      if (!ids && /jambu mete|jambu monyet/.test(keyName)) ids = ['cashew'];
      if (!ids && /asam( jawa)?/.test(keyName)) ids = ['tamarind'];
      if (!ids && /kacang hijau/.test(keyName)) ids = ['mung-bean'];
      if (!ids && /kacang tanah/.test(keyName)) ids = ['peanut'];
      if (!ids && /kacang kacangan|legumes/.test(keyName)) ids = ['mung-bean','peanut','soybean'];
      if (!ids && /buah buahan|buah lokal|buah tropis|fruit|tree crops/.test(keyName)) ids = ['mango','banana','cashew'];
      if (!ids && /umbi lokal|ubi ubian lokal|root crops/.test(keyName)) ids = ['cassava','sweet-potato'];
      if (!ids && /kopi arabika|kopi dataran tinggi|arabica/.test(keyName)) ids = ['coffee-arabica'];
      if (!ids && /kopi robusta|robusta/.test(keyName)) ids = ['coffee-robusta'];
      if (!ids && /kopi liberika|liberica/.test(keyName)) ids = ['coffee-liberica'];
      if (!ids && /kopi/.test(keyName)) ids = ['coffee-arabica','coffee-robusta'];
      if (!ids && /kelapa sawit/.test(keyName)) ids = ['oil-palm'];
      if (!ids && /kelapa/.test(keyName)) ids = ['coconut'];
      if (!ids && /kakao|cacao|cocoa/.test(keyName)) ids = ['cacao'];
      if (!ids && /cengkeh/.test(keyName)) ids = ['clove'];
      if (!ids && /durian/.test(keyName)) ids = ['durian'];
      if (!ids && /karet/.test(keyName)) ids = ['rubber'];
      if (!ids && /kayu manis/.test(keyName)) ids = ['cinnamon'];
      if (!ids && /lada/.test(keyName)) ids = ['black-pepper'];
      if (!ids && /pala/.test(keyName)) ids = ['nutmeg'];
      if (!ids && /tebu/.test(keyName)) ids = ['sugarcane'];
      if (!ids && /teh/.test(keyName)) ids = ['tea'];
      if (!ids && /pinang/.test(keyName)) ids = ['areca-palm'];
      if (!ids && /salak/.test(keyName)) ids = ['salak'];
      if (!ids && /tembakau/.test(keyName)) ids = ['tobacco'];
      if (!ids && /sagu/.test(keyName)) ids = ['sago'];
      if (!ids && /nanas/.test(keyName)) ids = ['pineapple'];
      if (!ids && /jagung/.test(keyName)) ids = ['maize'];
      if (!ids && /sorgum/.test(keyName)) ids = ['sorghum'];
      if (!ids && /singkong|ubi kayu/.test(keyName)) ids = ['cassava'];
      if (!ids && /ubi jalar/.test(keyName)) ids = ['sweet-potato'];
      if (!ids && /sayuran|herbs|microgreens|hortikultura/.test(keyName)) ids = ['leafy-greens','tomato','chili'];
      if (!ids && /palawija/.test(keyName)) ids = ['maize','sorghum','mung-bean','soybean'];
      if (ids) ids.forEach(addId);
    });

    var fallbacks = {
      'dryland':['maize','sorghum','mung-bean','cashew','tamarind','cassava','peanut'],
      'humid-upland':['rice','coffee-arabica','coffee-robusta','cacao','banana','sweet-potato'],
      'peat-wet':['sago','coconut','rice','cassava','pineapple'],
      'islands':['coconut','cassava','cashew','sweet-potato','mango'],
      'mixed-island':['cashew','coconut','cassava','maize','cacao'],
      'irrigated-lowland':['rice','maize','soybean','chili','tomato'],
      'urban':['leafy-greens','tomato','chili','banana'],
      'mixed-lowland':['rice','maize','cassava','mung-bean','mango'],
      'highland':['potato','coffee-arabica','tomato','leafy-greens','chili']
    };
    (fallbacks[profile.kind] || fallbacks['mixed-lowland']).forEach(addId);
    return output;
  }

  async function loadRegionCropNames(selection) {
    if (!selection || !window.BackToNatureAPI || !window.BackToNatureAPI.fetchCropTaxonomy) return;
    var key = climateSelectionKey(selection);
    var records = cropTaxonomyBySelection[key] || (cropTaxonomyBySelection[key] = {});
    var pending = cropTaxonomyPendingBySelection[key] || (cropTaxonomyPendingBySelection[key] = {});
    var context = regionSummaryContext(selection);
    var climateResult = climateResultsBySelection[key] || null;
    var crops = summaryCropCandidates(selection, context.profile, climateResult).slice(0,4);
    var missing = crops.filter(function (crop) { return !records[crop.id] && !pending[crop.id]; });
    if (!missing.length) {
      cropTaxonomyStatusBySelection[key] = 'ready';
      return;
    }
    cropTaxonomyStatusBySelection[key] = 'loading';
    var iso3 = selection.countryIso3 || '';
    var countryName = context.countryName;
    await Promise.all(missing.map(async function (crop) {
      pending[crop.id] = true;
      try {
        records[crop.id] = await window.BackToNatureAPI.fetchCropTaxonomy(crop, iso3, countryName);
      } catch (error) {
        records[crop.id] = {
          cropId:crop.id,
          englishName:crop.name,
          localName:'',
          localLanguage:window.BackToNatureAPI.getCountryLanguagePreference(iso3).label,
          scientificName:crop.scientific,
          status:'source-unavailable',
          error:error && error.message ? error.message : 'Taxonomy lookup failed.',
          sourceUrl:'https://www.gbif.org/species/search?q=' + encodeURIComponent(crop.scientific)
        };
      } finally {
        delete pending[crop.id];
      }
    }));
    cropTaxonomyStatusBySelection[key] = 'ready';
    if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
  }


  async function loadFieldBriefOutlook(selection, forceRefresh) {
    if (!selection) return null;
    var key = climateSelectionKey(selection);
    if (forceRefresh === true) {
      delete fieldBriefOutlookBySelection[key];
      delete fieldBriefOutlookStatusBySelection[key];
      delete fieldBriefOutlookPromisesBySelection[key];
    }
    if (fieldBriefOutlookBySelection[key]) return fieldBriefOutlookBySelection[key];
    if (fieldBriefOutlookPromisesBySelection[key]) return fieldBriefOutlookPromisesBySelection[key];

    var point = geometryCentroid(selection.feature);
    var api = window.BackToNatureAPI;
    if (!point) {
      fieldBriefOutlookStatusBySelection[key] = {state:'error',message:'The map boundary has no representative coordinate for a forecast.'};
      if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
      return null;
    }
    if (!api || !api.fetchOpenMeteoAgroOutlook) {
      fieldBriefOutlookStatusBySelection[key] = {state:'error',message:'The Open-Meteo outlook connector is unavailable. Reload the page and retry.'};
      if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
      return null;
    }

    fieldBriefOutlookStatusBySelection[key] = {state:'loading'};
    if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
    var promise = api.fetchOpenMeteoAgroOutlook(point.latitude,point.longitude,forceRefresh === true)
      .then(function (data) {
        fieldBriefOutlookBySelection[key] = data;
        fieldBriefOutlookStatusBySelection[key] = {state:'ready'};
        return data;
      })
      .catch(function (error) {
        fieldBriefOutlookStatusBySelection[key] = {
          state:'error',
          message:error && error.message ? error.message : 'The public weather API could not be reached.'
        };
        return null;
      })
      .finally(function () {
        delete fieldBriefOutlookPromisesBySelection[key];
        if (summarySelection && climateSelectionKey(summarySelection) === key) updateRegionSummary();
      });
    fieldBriefOutlookPromisesBySelection[key] = promise;
    return promise;
  }

  function renderFieldBriefOutlook(selection) {
    var key = climateSelectionKey(selection);
    var status = fieldBriefOutlookStatusBySelection[key];
    var data = fieldBriefOutlookBySelection[key];
    var refreshButton = '<button id="field-brief-outlook-refresh" class="pixel-btn" type="button">REFRESH 7-DAY OUTLOOK</button>';
    var heading = '<section class="region-summary-section field-brief-outlook"><div class="region-summary-section-heading"><span>🌦️</span><div><div class="mini-code">LIVE WEATHER API · NO KEY</div><h3>What might the next week look like?</h3></div></div>';

    if (!status || status.state === 'loading') {
      return heading + '<p>Checking the latest seven-day forecast for a reference point in this region. This is a model forecast, not a field sensor reading.</p><div class="live-status pending">Loading Open-Meteo forecast…</div></section>';
    }
    if (status.state === 'error' || !data || !Array.isArray(data.days) || !data.days.length) {
      return heading + '<p>We could not load a forecast just now, so this brief is using only the historical seasonal screen. No weather values have been invented.</p><p class="field-brief-error">' + esc(status.message || 'No forecast values were returned.') + '</p>' + refreshButton +
        '<p class="nature-method-note">Open-Meteo is a free public API for non-commercial use; attribution is required. The request can still fail because of network or service availability.</p></section>';
    }

    var days = data.days.slice(0,7);
    var rainDays = days.filter(function (day) { return day.precipitationMm != null && Number.isFinite(Number(day.precipitationMm)); });
    var tempDays = days.filter(function (day) { return day.temperatureMean != null && Number.isFinite(Number(day.temperatureMean)); });
    var etDays = days.filter(function (day) { return day.referenceEt0Mm != null && Number.isFinite(Number(day.referenceEt0Mm)); });
    var totalRain = rainDays.length ? rainDays.reduce(function (sum,day) { return sum + Number(day.precipitationMm); },0) : null;
    var meanTemp = tempDays.length ? tempDays.reduce(function (sum,day) { return sum + Number(day.temperatureMean); },0) / tempDays.length : null;
    var pairedDays = days.filter(function (day) { return day.precipitationMm != null && day.referenceEt0Mm != null &&
      Number.isFinite(Number(day.precipitationMm)) && Number.isFinite(Number(day.referenceEt0Mm)); });
    var rainMinusEt0 = pairedDays.length ? pairedDays.reduce(function (sum,day) {
      return sum + Number(day.precipitationMm) - Number(day.referenceEt0Mm);
    },0) : null;
    var metrics = '<div class="field-brief-weather-metrics">' +
      '<div class="field-brief-weather-metric"><span>Forecast rain · 7 days</span><b>' + esc(numberOrDash(totalRain,' mm')) + '</b></div>' +
      '<div class="field-brief-weather-metric"><span>Average temperature</span><b>' + esc(numberOrDash(meanTemp,' °C')) + '</b></div>' +
      '<div class="field-brief-weather-metric"><span>Rain − reference ET₀</span><b class="' + (rainMinusEt0 != null && rainMinusEt0 < 0 ? 'water-deficit' : '') + '">' + esc(numberOrDash(rainMinusEt0,' mm')) + '</b></div></div>';
    var daily = '<div class="field-brief-weather-days">' + days.map(function (day) {
      return '<article class="field-brief-weather-day"><b>' + esc(day.date) + '</b><span>Rain <strong>' + esc(numberOrDash(day.precipitationMm,' mm')) + '</strong></span><span>Mean <strong>' + esc(numberOrDash(day.temperatureMean,' °C')) + '</strong></span></article>';
    }).join('') + '</div>';
    var meaning = rainMinusEt0 == null ? 'Some forecast variables are missing. Check the national weather service before fieldwork.' :
      rainMinusEt0 < 0
        ? 'The forecast shows less rain than reference atmospheric water demand across this period. Check actual soil moisture, stored water and irrigation; this is not proof that the plot is drought-stressed.'
        : 'Forecast rain is at or above reference atmospheric water demand across this period. That does not prove a field is saturated: actual rainfall, soil drainage and irrigation can differ.';
    return heading + metrics + '<p class="field-brief-weather-meaning">' + esc(meaning) + '</p>' + daily + refreshButton +
      '<p class="nature-method-note">Forecast fetched ' + esc(new Date(data.retrievedAt || Date.now()).toLocaleString()) +
      ' for a representative point near ' + esc(numberOrDash(data.latitude,'°')) + ', ' + esc(numberOrDash(data.longitude,'°')) +
      '. Open-Meteo forecast models can change. Rain − ET₀ is a rough planning cue, not a complete farm water balance.</p></section>';
  }

  function renderFieldBriefExplanation(profile, selection) {
    var isPeat = /peat|wetland/i.test(String(profile.kind || '') + ' ' + String(profile.zone || ''));
    var landMessage = isPeat
      ? 'This region may contain both peat and mineral soils. A crop that can grow on mineral soil is not automatically suitable for peat. Do not drain peat to fit a crop; protect the water table, prevent fire and check land-use safeguards first.'
      : 'The brief has not measured your plot’s soil, pH, drainage, elevation, salinity, irrigation supply, pest pressure or access to buyers. Those can change the answer even when the climate timing looks good.';
    return '<section class="region-summary-section field-brief-explainer"><div class="region-summary-section-heading"><span>🧭</span><div><div class="mini-code">HOW TO READ THIS</div><h3>What does the recommendation actually mean?</h3></div></div>' +
      '<div class="field-brief-explainer-grid">' +
      '<article class="field-brief-explainer-card"><h4>1 · It is a shortlist, not an instruction</h4><p>The crop appears because it is a regional idea or matches broad seasonal temperature and rainfall patterns. It does not mean “plant this now” or guarantee a harvest.</p></article>' +
      '<article class="field-brief-explainer-card"><h4>2 · Why be cautious?</h4><p>' + esc(landMessage) + '</p></article>' +
      '<article class="field-brief-explainer-card"><h4>3 · What should I do next?</h4><p>Check a soil test, water and drainage, the current forecast, a locally recommended variety, planting calendar, pests, input costs and likely buyers. Start small and ask local agricultural extension before investing heavily.</p></article>' +
      '</div><p class="field-brief-method-note">The seasonal badge uses five complete years of monthly weather at one representative map point. It does not use a farm survey or check every field inside the selected region.</p></section>';
  }

  function renderRegionSummary() {
    if (!summarySelection) return '';
    var selection = summarySelection;
    var context = regionSummaryContext(selection);
    var profile = context.profile;
    var key = climateSelectionKey(selection);
    var climateResult = climateResultsBySelection[key];
    var climateStatus = climateStatusBySelection[key];
    var cropObjects = summaryCropCandidates(selection, profile, climateResult).slice(0,4);
    var currentMonthLabel = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date().getMonth()];
    var cropCards = cropObjects.map(function (crop, index) {
      var rankedCrop = climateResult && (climateResult.recommendations || []).find(function (item) { return item.id === crop.id; });
      var status = rankedCrop && rankedCrop.currentMonthStatus || 'unknown';
      var best = rankedCrop && rankedCrop.bestWindow || null;
      var statusClass = status === 'suitable' ? 'is-open' : status === 'caution' ? 'is-caution' : status === 'wait' ? 'is-wait' : 'is-unknown';
      var statusLabel = status === 'suitable' ? 'TIMING LOOKS PROMISING' :
        status === 'caution' ? 'CHECK BEFORE PLANTING' :
        status === 'wait' ? 'BETTER TO WAIT' : 'NOT ENOUGH SEASON DATA';
      var statusMessage = status === 'suitable'
        ? 'The last five years of monthly weather look broadly supportive for starting in ' + currentMonthLabel + '. This checks timing only, not soil suitability.'
        : status === 'caution'
          ? 'Weather conditions are near the screening limits or a caution was flagged. Check this week’s forecast, water supply and drainage before planting.'
          : status === 'wait'
            ? 'This does not mean the crop cannot grow here. The historical pattern points to ' + (best && best.month ? best.month : 'another month') + ' as a better start window; confirm with the local calendar and actual weather.'
            : climateStatus && climateStatus.state === 'error'
              ? 'A reliable seasonal result could not be retrieved. Treat this as an idea to investigate, not a planting recommendation.'
              : climateStatus && climateStatus.state === 'ready'
                ? 'The available seasonal data did not confirm a clear start window for this crop. Check the crop and local conditions in the Detailed Fieldbook.'
                : 'Checking the historical seasonal pattern…';
      var icon = /rice|padi/i.test(crop.name) ? '🌾' :
        /coffee|cacao|cocoa|coconut|mango|banana|cashew|tamarind|tree/i.test(crop.name) ? '🌳' :
        /vegetable|greens|chili|potato|tomato/i.test(crop.name) ? '🥬' :
        /legume|bean|peanut|soy/i.test(crop.name) ? '🫘' : '🌱';
      return '<article class="region-summary-crop region-summary-crop-brief">' +
        '<span class="region-summary-crop-icon">' + icon + '</span><div class="region-summary-crop-copy">' +
        '<span class="mini-code">STARTER IDEA ' + String(index+1).padStart(2,'0') + '</span>' +
        '<h4>' + esc(crop.name || crop.englishName || crop.id) + '</h4>' +
        '<span class="crop-season-pill ' + statusClass + '">' + esc(statusLabel) + '</span>' +
        '<p class="crop-season-message">' + esc(statusMessage) + '</p>' +
        '</div></article>';
    }).join('');
    var technologyCards = context.techList.slice(0,3).map(function (technology, index) {
      return '<article class="region-summary-tech"><div class="region-summary-tech-title"><span>' + esc(technology.icon || '🛠️') + '</span><h4>' + esc(technology.title) + '</h4></div><p><b>Can help with:</b> ' + esc(technology.problem) + '</p><p>' + esc(technology.action) + '</p></article>';
    }).join('');
    return '<div class="region-summary-hero">' +
      '<div class="mini-code">YOUR LAND / QUICK RECOMMENDATION</div>' +
      '<h2>What could grow here? 🌱</h2>' +
      '<p>' + esc(profile.intro) + '</p>' +
      '<div class="region-summary-tags"><span>' + esc(context.countryName) + '</span><span>' + esc(context.level) + '</span><span>' + esc(profile.zone) + '</span></div>' +
      '</div>' +
      '<section class="region-summary-section"><div class="region-summary-section-heading"><span>🌾</span><div><div class="mini-code">START HERE</div><h3>Plants worth investigating</h3></div></div>' +
      '<p>Shortlist only: the seasonal screen checks whether this is a sensible month to start, separately from soil suitability. Open the Detailed Fieldbook for names, reasons and source data.</p>' +
      '<div class="region-summary-crops">' + cropCards + '</div>' +
      '</section>' +
      renderFieldBriefOutlook(selection) +
      renderFieldBriefExplanation(profile, selection) +
      '<section class="region-summary-section"><div class="region-summary-section-heading"><span>🛠️</span><div><div class="mini-code">LOW-REGRET PRACTICES</div><h3>Technologies to consider</h3></div></div>' +
      '<div class="region-summary-tech-grid">' + technologyCards + '</div></section>' +
      '<section class="region-summary-note"><span>📌</span><p><b>Before investing:</b> confirm actual soil conditions and water access, then check local planting calendars, seed availability, weather warnings, market access and advice from local agricultural extension services.</p></section>';
  }

  function updateRegionSummaryDistrictButton() {
    var button = el('region-summary-districts');
    if (!button) return;
    var selection = summarySelection;
    var country = selection && String(selection.countryIso3 || '').toUpperCase();
    var entry = country && adm2Index && adm2Index.countries ? adm2Index.countries[country] : null;
    var available = !!(selection && Number(selection.adminLevel) === 1 && entry && entry.file);
    button.hidden = !available;
    button.disabled = false;
    button.textContent = country === 'IDN' ? '🏘 VIEW KABUPATEN / CITIES' : '🏘 VIEW DISTRICTS';
    button.title = country === 'IDN'
      ? 'Open the map of regencies and cities (ADM2)'
      : 'Open second-level administrative areas (ADM2)';
  }

  function openSummaryDistricts() {
    var selection = summarySelection;
    if (!selection || Number(selection.adminLevel) !== 1) return;
    var country = String(selection.countryIso3 || '').toUpperCase();
    var button = el('region-summary-districts');

    if (!adm2Index) {
      if (button) {
        button.disabled = true;
        button.textContent = 'LOADING DISTRICT DATA…';
      }
      ensureBoundaryIndexes().then(function () {
        updateRegionSummaryDistrictButton();
        if (summarySelection === selection) openSummaryDistricts();
      }).catch(function () {
        if (button) {
          button.disabled = false;
          button.textContent = 'DISTRICTS UNAVAILABLE';
          button.title = 'Could not load district availability metadata. Close this dialog and retry.';
        }
      });
      return;
    }

    var entry = adm2Index.countries && adm2Index.countries[country];
    if (!country || !entry || !entry.file) {
      if (button) {
        button.disabled = true;
        button.textContent = 'DISTRICTS NOT AVAILABLE';
      }
      return;
    }

    var bounds = null;
    if (provinceLayer && selection.feature) {
      provinceLayer.eachLayer(function (layer) {
        if (layer.feature === selection.feature && layer.getBounds) bounds = layer.getBounds();
      });
    }
    closeRegionSummary(false);
    summarySelection = null;
    enterDistrictMode(country, selection.countryName || (countryByISO3[country] && countryByISO3[country].name) || country, bounds);
  }

  function updateRegionSummary() {
    var backdrop = el('region-summary-modal');
    var content = el('region-summary-content');
    if (!backdrop || !content || !backdrop.classList.contains('open') || !summarySelection) return;
    content.innerHTML = renderRegionSummary();
    updateRegionSummaryDistrictButton();
    var forecastRefreshButton = el('field-brief-outlook-refresh');
    if (forecastRefreshButton) forecastRefreshButton.addEventListener('click', function () {
      if (summarySelection) loadFieldBriefOutlook(summarySelection, true);
    });
  }

  function closeRegionSummary(clearSelection) {
    var backdrop = el('region-summary-modal');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden','true');
    }
    if (clearSelection) {
      if (!el('province-modal').classList.contains('open') && currentProvince === summarySelection) {
        currentProvince = null;
      }
      summarySelection = null;
      if (!el('province-modal').classList.contains('open')) document.body.classList.remove('modal-open');
    }
  }

  function showRegionSummary(name, feature, context) {
    clearNatureObservationMarkers();
    var summary = Object.assign({ name:name, feature:feature || null, adminLevel:activeAdminLevel }, context || {});
    summary.feature = feature || summary.feature || null;
    summary.name = name;
    summarySelection = summary;
    currentProvince = summary;
    currentTab = 'overview';
    setText('region-summary-title',name);
    var backdrop = el('region-summary-modal');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden','false');
    document.body.classList.add('modal-open');
    updateRegionSummary();
    loadClimateForSelection(summary);
    loadFieldBriefOutlook(summary);
    var button = el('region-summary-details');
    if (button) button.focus();
  }

  function openDetailedFieldbook() {
    var selection = summarySelection;
    if (!selection) return;
    closeRegionSummary(false);
    summarySelection = null;
    openModal(selection.name,selection.feature,selection);
  }

  function openModal(name, feature, context) {
    var profile = profileFor(name);
    currentProvince = Object.assign({ name:name, feature:feature || null, adminLevel:activeAdminLevel }, context || {});
    currentProvince.feature = feature || currentProvince.feature || null;
    currentProvince.name = name;
    currentTab = 'overview';
    setText('modal-title', name);
    var fieldbookLabel = currentProvince.adminLevel === 2 ? 'DISTRICT FIELD GUIDE' : (currentProvince.countryIso3 === 'IDN' ? 'PROVINCE FIELD GUIDE' : 'REGIONAL FIELD GUIDE');
    setText('modal-subtitle', fieldbookLabel + ' · ' + profile.zone.toUpperCase());
    var levelLabel = currentProvince.adminLevel === 2 ? 'DISTRICT / ADM2' : 'REGION / ADM1';
    setText('modal-stamp', 'FIELD NOTE / ' + (feature ? (provinceFeatureCode(feature) || levelLabel) : levelLabel));
    if (el('btn-drill-down')) {
      var hasDistricts = !!(currentProvince.countryIso3 && adm2Index && adm2Index.countries && adm2Index.countries[currentProvince.countryIso3]);
      el('btn-drill-down').hidden = !(currentProvince.adminLevel === 1 && hasDistricts);
      el('btn-drill-down').textContent = currentProvince.countryIso3 === 'IDN' ? '🏘 VIEW KABUPATEN / CITIES' : '🏘 VIEW DISTRICTS';
    }
    el('province-modal').classList.add('open');
    el('province-modal').setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    renderTab('overview');
    loadClimateForSelection(currentProvince);
    var close = el('modal-close');
    if (close) close.focus();
  }

  function closeModal() {
    el('province-modal').classList.remove('open');
    el('province-modal').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  var tabs = [
    {id:'overview',label:'01 OVERVIEW',icon:'🏡'},
    {id:'soil',label:'02 SOIL & LAND',icon:'🧪'},
    {id:'crops',label:'03 CROPS',icon:'🌾'},
    {id:'climate',label:'04 SEASONS',icon:'🌦️'},
    {id:'farming',label:'05 FARMING GUIDE',icon:'🚜'},
    {id:'technology',label:'06 TECHNOLOGY',icon:'🛠️'},
    {id:'sources',label:'07 DATA & RESEARCH',icon:'📚'},
    {id:'nature',label:'08 NATURE AROUND US',icon:'🦋'}
  ];
  el('modal-tabs').innerHTML = tabs.map(function (t) {
    return '<button class="tab-btn" type="button" role="tab" aria-selected="false" data-tab="' + t.id + '">' + t.icon + ' ' + t.label + '</button>';
  }).join('');

  el('modal-tabs').addEventListener('click', function (event) {
    var button = event.target.closest('.tab-btn');
    if (!button) return;
    try {
      renderTab(button.getAttribute('data-tab'));
    } catch (error) {
      var content = el('modal-content');
      if (content) content.innerHTML = '<section class="data-integrity"><h3>Could not load this section</h3><p>' +
        esc(error && error.message ? error.message : 'Unexpected rendering error') +
        '</p><p>Try another tab, then reopen this section. No source data have been substituted.</p></section>';
      if (window.console && console.error) console.error('BackToNature tab rendering failed:', error);
    }
  });
  el('modal-close').addEventListener('click', closeModal);
  el('region-summary-close').addEventListener('click', function () { closeRegionSummary(true); });
  el('region-summary-details').addEventListener('click', openDetailedFieldbook);
  var summaryDistrictButton = el('region-summary-districts');
  if (summaryDistrictButton) summaryDistrictButton.addEventListener('click', openSummaryDistricts);
  el('region-summary-modal').addEventListener('click', function (event) {
    if (event.target === el('region-summary-modal')) closeRegionSummary(true);
  });

  var translateButton = el('btn-translate');
  var translateMenu = el('translate-menu');
  if (translateButton && translateMenu) {
    translateButton.addEventListener('click',function (event) {
      event.stopPropagation();
      var willOpen = translateMenu.hidden;
      translateMenu.hidden = !willOpen;
      translateButton.setAttribute('aria-expanded',willOpen ? 'true' : 'false');
    });
    translateMenu.addEventListener('click',function (event) {
      var languageButton = event.target.closest('[data-translate-lang]');
      if (!languageButton) return;
      var targetLanguage = languageButton.getAttribute('data-translate-lang');
      var translateUrl = new URL('https://translate.google.com/translate');
      translateUrl.searchParams.set('sl','auto');
      translateUrl.searchParams.set('tl',targetLanguage);
      translateUrl.searchParams.set('u',window.location.href);
      translateMenu.hidden = true;
      translateButton.setAttribute('aria-expanded','false');
      window.open(translateUrl.href,'_blank','noopener,noreferrer');
    });
    document.addEventListener('click',function (event) {
      if (!event.target.closest('.translate-picker')) {
        translateMenu.hidden = true;
        translateButton.setAttribute('aria-expanded','false');
      }
    });
  }
  el('province-modal').addEventListener('click', function (event) {
    if (event.target === el('province-modal')) closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (el('region-summary-modal').classList.contains('open')) closeRegionSummary(true);
      else closeModal();
    }
    if (el('province-modal').classList.contains('open') && event.key === 'ArrowRight') {
      var index = tabs.findIndex(function (t) { return t.id === currentTab; });
      renderTab(tabs[(index + 1) % tabs.length].id);
    }
    if (el('province-modal').classList.contains('open') && event.key === 'ArrowLeft') {
      var idx = tabs.findIndex(function (t) { return t.id === currentTab; });
      renderTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
    }
  });

  function showMapStatus(title, text) {
    setText('map-status-title', title);
    setText('map-status-text', text);
    el('map-status').classList.add('visible');
  }
  function hideMapStatus() { el('map-status').classList.remove('visible'); }
  async function fetchJSON(url) {
    var response = await fetch(url, { cache:'force-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' while loading ' + url);
    return response.json();
  }

  async function ensureBoundaryIndexes() {
    if (adm1Index && adm2Index && countriesIndex) return;
    var results = await Promise.all([
      fetchJSON(ADM1_INDEX_URL),
      fetchJSON(ADM2_INDEX_URL),
      fetchJSON(COUNTRIES_INDEX_URL)
    ]);
    adm1Index = results[0];
    adm2Index = results[1];
    countriesIndex = results[2];
    countryByISO3 = {};
    countryByNormalizedName = {};
    (countriesIndex.countries || []).forEach(function (country) {
      if (country.iso3) countryByISO3[country.iso3.toUpperCase()] = country;
      [country.name, country.iso3].forEach(function (name) {
        if (name) countryByNormalizedName[norm(name)] = country;
      });
    });
  }

  function countryIso3ForFeature(feature, countryName) {
    var props = feature && feature.properties ? feature.properties : {};
    var candidates = [
      props.ISO_A3_EH, props.ISO_A3, props.ADM0_A3, props.SOV_A3,
      props.GU_A3, props.iso_a3, props.ISO3, props.ISO3CD, props.shapeISO
    ];
    for (var i = 0; i < candidates.length; i++) {
      var code = String(candidates[i] || '').trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(code) && (countryByISO3[code] || (adm1Index && adm1Index.countries && adm1Index.countries[code]) || (adm2Index && adm2Index.countries && adm2Index.countries[code]))) {
        return code;
      }
    }

    var aliases = {
      'united states of america':'united states',
      'russia':'russian federation',
      'south korea':'republic of korea',
      'north korea':"democratic people's republic of korea",
      'iran':'iran islamic republic of',
      'syria':'syrian arab republic',
      'tanzania':'united republic of tanzania',
      'bolivia':'bolivia plurinational state of',
      'venezuela':'venezuela bolivarian republic of',
      'moldova':'republic of moldova',
      'laos':"lao people's democratic republic",
      'brunei':'brunei darussalam',
      'ivory coast':"cote d ivoire",
      'czechia':'czech republic',
      'cape verde':'cabo verde',
      'swaziland':'eswatini',
      'macedonia':'north macedonia',
      'vietnam':'viet nam',
      'east timor':'timor leste',
      'palestine':'state of palestine'
    };
    var normalizedName = norm(countryName || props.ADMIN || props.name || props.NAME || '');
    var lookup = aliases[normalizedName] || normalizedName;
    var match = countryByNormalizedName[lookup];
    if (match && match.iso3) return match.iso3.toUpperCase();
    return '';
  }

  function fillProvinceSelect() {
    var select = el('province-select');
    if (!select || !activeAdminGeoJSON) return;
    var placeholder = activeAdminLevel === 1 ? 'JUMP TO REGION…' : 'JUMP TO DISTRICT…';
    var list = (activeAdminGeoJSON.features || []).slice().sort(function (a, b) {
      return norm(provinceFeatureName(a)).localeCompare(norm(provinceFeatureName(b)));
    });
    select.innerHTML = '<option value="">' + placeholder + '</option>' + list.map(function (feature, index) {
      var displayName = provinceFeatureName(feature);
      return '<option value="' + index + '">' + esc(displayName) + '</option>';
    }).join('');
  }

  function provinceStyle() {
    return activeAdminLevel === 2
      ? { color:'#344f72', weight:1.4, opacity:1, fillColor:'#8cb6d8', fillOpacity:0.65 }
      : { color:'#513e2a', weight:2, opacity:1, fillColor:'#98bd68', fillOpacity:0.72 };
  }
  function provinceHoverStyle() {
    return { color:'#fff2bd', weight:3, opacity:1, fillColor:'#e8bb53', fillOpacity:0.92 };
  }

  function setExplorerChrome(label, level) {
    setText('map-title', label);
    el('btn-world').hidden = false;
    el('btn-world').textContent = level === 2 ? '↩ BACK TO REGIONS' : '🌍 WORLD MAP';
    el('btn-provinces').hidden = true;
    el('province-select-wrap').hidden = false;
  }

  async function fetchAdmin1ForCountry(iso3) {
    if (countryDataCache['ADM1:' + iso3]) return countryDataCache['ADM1:' + iso3];
    var data;
    if (iso3 === 'IDN') {
      // Keep the app's curated 38-province Indonesian layer while other countries use the global dataset.
      data = await fetchJSON(PROVINCE_URL);
    } else {
      var entry = adm1Index && adm1Index.countries ? adm1Index.countries[iso3] : null;
      if (!entry || !entry.file) throw new Error('No first-level administrative boundary is available for this country in the current dataset.');
      data = await fetchJSON('./data/' + entry.file);
    }
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) {
      throw new Error('The first-level boundary file was empty or had an unexpected format.');
    }
    countryDataCache['ADM1:' + iso3] = data;
    return data;
  }

  async function fetchAdmin2ForCountry(iso3) {
    if (countryDataCache['ADM2:' + iso3]) return countryDataCache['ADM2:' + iso3];
    var entry = adm2Index && adm2Index.countries ? adm2Index.countries[iso3] : null;
    if (!entry || !entry.file) throw new Error('No second-level administrative boundary is available for this country.');
    var data = await fetchJSON('./data/' + entry.file);
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length) {
      throw new Error('The district boundary file was empty or had an unexpected format.');
    }
    countryDataCache['ADM2:' + iso3] = data;
    return data;
  }

  function drawAdministrativeLayer(data, level, focusBounds) {
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    activeAdminGeoJSON = data;
    activeAdminLevel = level;

    var thisLayerGroup = L.geoJSON(data, {
      style: provinceStyle,
      onEachFeature:function (feature, layer) {
        var name = provinceFeatureName(feature);
        layer.bindTooltip(name, { sticky:true, direction:'auto', className:'retro-tooltip' });
        layer.on('mouseover', function () {
          layer.setStyle(provinceHoverStyle());
          if (layer.bringToFront) layer.bringToFront();
        });
        layer.on('mouseout', function () { thisLayerGroup.resetStyle(layer); });
        layer.on('click', function (event) {
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
          var context = {
            countryIso3: selectedCountry ? selectedCountry.iso3 : '',
            countryName: selectedCountry ? selectedCountry.name : '',
            adminLevel: level,
            feature: feature
          };
          showRegionSummary(name, feature, context);
        });
      }
    });
    provinceLayer = thisLayerGroup.addTo(map);
    fillProvinceSelect();

    if (focusBounds && focusBounds.isValid && focusBounds.isValid()) {
      map.fitBounds(focusBounds, { padding:[40,40], maxZoom:8 });
    } else if (provinceLayer.getBounds().isValid()) {
      map.fitBounds(provinceLayer.getBounds(), { padding:[35,35], maxZoom: level === 2 ? 9 : 7 });
    }
  }

  async function enterCountryMode(iso3, countryName, focusBounds) {
    clearNatureObservationMarkers();
    var requestId = ++adminLoadRequestId;
    closeModal();
    hideMapStatus();
    await ensureBoundaryIndexes();
    if (worldLayer && map.hasLayer(worldLayer)) map.removeLayer(worldLayer);
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    mode = 'provinces';
    document.body.classList.add('province-mode');
    selectedCountry = { iso3: iso3, name: (countryByISO3[iso3] && countryByISO3[iso3].name) || countryName || iso3 };
    selectedProvinceBounds = focusBounds || null;
    setExplorerChrome(String(selectedCountry.name).toUpperCase() + ' · REGIONS', 1);
    showMapStatus('Loading ' + selectedCountry.name + '…', 'Loading first-level administrative boundaries from the monthly dataset.');
    try {
      var data = await fetchAdmin1ForCountry(iso3);
      if (requestId !== adminLoadRequestId || mode !== 'provinces') return;
      drawAdministrativeLayer(data, 1, focusBounds);
      setText('map-status-title', (data.features || []).length + ' regions ready');
      setText('map-status-text', 'Click a region for its fieldbook. Use the district button in the fieldbook to drill down further.');
      setTimeout(hideMapStatus, 2800);
    } catch (error) {
      if (requestId !== adminLoadRequestId) return;
      showMapStatus('Regional boundaries unavailable', (error && error.message ? error.message : 'Unknown boundary loading error') + ' Try another country or return to the world map.');
    }
  }

  async function enterDistrictMode(iso3, countryName, focusBounds) {
    clearNatureObservationMarkers();
    var requestId = ++adminLoadRequestId;
    closeModal();
    hideMapStatus();
    await ensureBoundaryIndexes();
    if (worldLayer && map.hasLayer(worldLayer)) map.removeLayer(worldLayer);
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    mode = 'districts';
    document.body.classList.add('province-mode');
    selectedCountry = { iso3: iso3, name: (countryByISO3[iso3] && countryByISO3[iso3].name) || countryName || iso3 };
    selectedProvinceBounds = focusBounds || selectedProvinceBounds || null;
    setExplorerChrome(String(selectedCountry.name).toUpperCase() + ' · DISTRICTS', 2);
    showMapStatus('Loading districts…', 'Fetching available second-level administrative boundaries.');
    try {
      var data = await fetchAdmin2ForCountry(iso3);
      if (requestId !== adminLoadRequestId || mode !== 'districts') return;
      drawAdministrativeLayer(data, 2, selectedProvinceBounds);
      setText('map-status-title', (data.features || []).length + ' districts / local units ready');
      setText('map-status-text', 'This source labels ADM2 differently by country. Click a mapped unit to open its fieldbook.');
      setTimeout(hideMapStatus, 3000);
    } catch (error) {
      if (requestId !== adminLoadRequestId) return;
      showMapStatus('District boundaries unavailable', (error && error.message ? error.message : 'Unknown boundary loading error') + ' The country may not have ADM2 data.');
    }
  }

  function enterWorldMode() {
    clearNatureObservationMarkers();
    ++adminLoadRequestId;
    closeModal();
    mode = 'world';
    selectedCountry = null;
    selectedProvinceBounds = null;
    document.body.classList.remove('province-mode');
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    provinceLayer = null;
    el('btn-world').hidden = true;
    el('btn-provinces').hidden = false;
    el('province-select-wrap').hidden = true;
    setText('map-title', 'GLOBAL LAND RESTORATION MAP');
    setText('map-help', 'Click any country to explore its regions. Drill into districts from a region fieldbook.');
    if (worldLayer) {
      if (!map.hasLayer(worldLayer)) worldLayer.addTo(map);
    } else {
      loadWorldLayer();
    }
    map.setView([12, 105], 3);
  }

  async function goBackFromAdminMode() {
    if (mode === 'districts' && selectedCountry) {
      await enterCountryMode(selectedCountry.iso3, selectedCountry.name, selectedProvinceBounds);
    } else {
      enterWorldMode();
    }
  }

  async function jumpToProvince(name) {
    if (!name || !activeAdminGeoJSON) return;
    var index = Number(name);
    var feature = Number.isInteger(index) && index >= 0
      ? activeAdminGeoJSON.features[index]
      : activeAdminGeoJSON.features.find(function (f) {
          return norm(provinceFeatureName(f)) === norm(name);
        });
    if (!feature) return;
    var featureName = provinceFeatureName(feature);
    showRegionSummary(featureName, feature, {
      countryIso3: selectedCountry ? selectedCountry.iso3 : '',
      countryName: selectedCountry ? selectedCountry.name : '',
      adminLevel: activeAdminLevel,
      feature: feature
    });
    if (provinceLayer) {
      var targetLayer = null;
      provinceLayer.eachLayer(function (layer) {
        if (layer.feature === feature) targetLayer = layer;
      });
      if (targetLayer) {
        var bounds = targetLayer.getBounds();
        map.fitBounds(bounds, { padding:[45,45], maxZoom:activeAdminLevel === 2 ? 9 : 8 });
      }
    }
  }

  async function loadWorldLayer() {
    var id = ++worldRequestId;
    showMapStatus('Loading world map…', 'Getting country boundaries.');
    try {
      var data = await fetchJSON(WORLD_URL);
      if (id !== worldRequestId || mode !== 'world') return;
      var thisWorldLayer = L.geoJSON(data, {
        style:function () { return { color:'#4c5a38', weight:1, fillColor:'#85a95f', fillOpacity:0.30 }; },
        onEachFeature:function (feature, layer) {
          var props = feature.properties || {};
          var name = props.ADMIN || props.name || props.NAME || props.NAME_LONG || 'Unknown region';
          layer.bindTooltip(name, { sticky:true, className:'retro-tooltip' });
          layer.on('mouseover', function () { layer.setStyle({ color:'#ffebac', weight:2, fillColor:'#eac15d', fillOpacity:0.72 }); });
          layer.on('mouseout', function () { thisWorldLayer.resetStyle(layer); });
          layer.on('click', function (event) {
            L.DomEvent.stopPropagation(event);
            (async function () {
              try {
                await ensureBoundaryIndexes();
                var iso3 = countryIso3ForFeature(feature, name);
                if (!iso3) {
                  showMapStatus(name + ' · country selected', 'Could not match this map polygon to an ISO-3 code in the boundary index. Try another country or use the global region explorer.');
                  return;
                }
                await enterCountryMode(iso3, name, layer.getBounds());
              } catch (error) {
                showMapStatus('Could not open ' + name, error && error.message ? error.message : 'Unknown error');
              }
            })();
          });
        }
      });
      worldLayer = thisWorldLayer;
      if (mode === 'world') worldLayer.addTo(map);
      setText('map-status-title', 'World map ready');
      setText('map-status-text', 'Click any country to explore its available regions and districts.');
      setTimeout(hideMapStatus, 2600);
    } catch (error) {
      showMapStatus('World boundaries unavailable', 'The map tiles may still work. ' + (error && error.message ? error.message : 'Reload to retry the country boundary data.'));
    }
  }
  el('btn-provinces').textContent = '🌍 REGION EXPLORER';
  el('btn-provinces').addEventListener('click', function () {
    enterWorldMode();
    map.setView([20, 0], 2);
    showMapStatus('GLOBAL REGION EXPLORER', 'Click any country to open its available provinces, states or regions. From there, explore districts and climate-based planting windows.');
  });
  el('btn-world').addEventListener('click', goBackFromAdminMode);
  el('btn-home').addEventListener('click', enterWorldMode);
  el('province-select').addEventListener('change', function () { jumpToProvince(this.value); });
  var drillButton = el('btn-drill-down');
  if (drillButton) drillButton.addEventListener('click', function () {
    if (!currentProvince || !currentProvince.countryIso3 || currentProvince.adminLevel !== 1) return;
    var bounds = null;
    if (provinceLayer && currentProvince.feature) {
      provinceLayer.eachLayer(function (layer) {
        if (layer.feature === currentProvince.feature) bounds = layer.getBounds();
      });
    }
    enterDistrictMode(
      currentProvince.countryIso3,
      currentProvince.countryName || currentProvince.countryIso3,
      bounds
    );
  });
  var openCurrentProvinceButton = el('open-current-province');
  if (openCurrentProvinceButton) {
    openCurrentProvinceButton.addEventListener('click', function () {
      if (currentProvince) renderTab('overview');
    });
  }

  // Background music is intentionally user-initiated. No autoplay calls are made.
  (function wireMusicPlayer() {
    var audio = el('background-music');
    var playButton = el('music-play-toggle');
    var muteButton = el('music-mute-toggle');
    var volumeSlider = el('music-volume');
    var volumeOutput = el('music-volume-value');
    var seekSlider = el('music-seek');
    var currentTimeNode = el('music-current-time');
    var durationNode = el('music-duration');
    var statusNode = el('music-player-status');
    if (!audio || !playButton || !muteButton || !volumeSlider || !seekSlider) return;

    audio.volume = Number(volumeSlider.value || 0.35);
    audio.preload = 'none';

    function timeLabel(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
      var total = Math.floor(seconds);
      return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    }

    function setStatus(label, kind) {
      if (!statusNode) return;
      statusNode.textContent = label;
      statusNode.classList.toggle('is-playing', kind === 'playing');
      statusNode.classList.toggle('is-error', kind === 'error');
    }

    function updatePlayButton() {
      var playing = !audio.paused && !audio.ended;
      playButton.textContent = playing ? 'Ⅱ PAUSE' : '▶ PLAY';
      playButton.setAttribute('aria-label', playing ? 'Pause background music' : 'Play background music');
      playButton.title = playing ? 'Pause music' : 'Play music';
      if (playing) setStatus('PLAYING', 'playing');
      else if (audio.ended) setStatus('ENDED', '');
      else if (audio.currentTime > 0) setStatus('PAUSED', '');
      else if (statusNode && !statusNode.classList.contains('is-error')) setStatus('READY', '');
    }

    function updateMuteButton() {
      var muted = audio.muted || audio.volume === 0;
      muteButton.textContent = muted ? '🔇' : '🔊';
      muteButton.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
      muteButton.title = muted ? 'Unmute music' : 'Mute music';
      if (volumeOutput) volumeOutput.value = Math.round(Number(volumeSlider.value) * 100) + '%';
    }

    playButton.addEventListener('click', async function () {
      if (!audio.paused && !audio.ended) {
        audio.pause();
        return;
      }
      setStatus('LOADING', '');
      playButton.disabled = true;
      try {
        // Calling play() directly in this click handler satisfies browser user-gesture policies.
        var promise = audio.play();
        if (promise && typeof promise.then === 'function') await promise;
        setStatus('PLAYING', 'playing');
      } catch (error) {
        setStatus('AUDIO ERROR', 'error');
        console.error('BackToNature music could not start:', error);
      } finally {
        playButton.disabled = false;
        updatePlayButton();
      }
    });

    muteButton.addEventListener('click', function () {
      audio.muted = !audio.muted;
      updateMuteButton();
    });

    volumeSlider.addEventListener('input', function () {
      audio.volume = Number(volumeSlider.value);
      if (audio.volume > 0) audio.muted = false;
      updateMuteButton();
    });

    seekSlider.addEventListener('input', function () {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      if (currentTimeNode) {
        currentTimeNode.textContent = timeLabel((Number(seekSlider.value) / 1000) * audio.duration);
      }
    });
    seekSlider.addEventListener('change', function () {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      audio.currentTime = (Number(seekSlider.value) / 1000) * audio.duration;
    });

    audio.addEventListener('play', function () { updatePlayButton(); });
    audio.addEventListener('pause', function () { updatePlayButton(); });
    audio.addEventListener('ended', function () { updatePlayButton(); });
    audio.addEventListener('volumechange', updateMuteButton);
    audio.addEventListener('loadedmetadata', function () {
      if (durationNode) durationNode.textContent = timeLabel(audio.duration);
      seekSlider.disabled = !(Number.isFinite(audio.duration) && audio.duration > 0);
    });
    audio.addEventListener('durationchange', function () {
      if (durationNode) durationNode.textContent = timeLabel(audio.duration);
      seekSlider.disabled = !(Number.isFinite(audio.duration) && audio.duration > 0);
    });
    audio.addEventListener('timeupdate', function () {
      if (currentTimeNode) currentTimeNode.textContent = timeLabel(audio.currentTime);
      if (!seekSlider.matches(':active') && Number.isFinite(audio.duration) && audio.duration > 0) {
        seekSlider.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
      }
    });
    audio.addEventListener('error', function () {
      setStatus('AUDIO ERROR', 'error');
      playButton.disabled = false;
    });

    updateMuteButton();
    updatePlayButton();
  })();

  loadWorldLayer();
})();