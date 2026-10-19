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
  var climatePhotoRequestId = 0;
  var climatePhotosLoadedBySelection = {};

  function norm(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function setText(id, value) { var node = el(id); if (node) node.textContent = value; }
  function setStatus(id, value, type) {
    var node = el(id);
    if (!node) return;
    node.className = 'status-pill ' + (type || 'neutral');
    node.textContent = value;
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
        if (currentProvince === selection) {
          updateClimatePreview();
          if (currentTab === 'climate') {
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
    var levelLabel = currentProvince && currentProvince.adminLevel === 2 ? 'ADM2 / district-level unit' : 'ADM1 / first-level region';
    var monthCards = monthly.map(function (month) {
      var barWidth = Math.max(2, Math.min(100, ((Number(month.precipitationMm) || 0) / maxRain) * 100));
      var windCaution = Number(month.windMeanKmh) >= 25 || Number(month.windGustMaxMeanKmh) >= 50;
      return '<article class="climate-month-card">' +
        '<div class="climate-month-top"><b>' + esc(month.label) + '</b><span>' + esc(numberOrDash(month.precipitationMm,' mm')) + '</span></div>' +
        '<div class="climate-rain-track" aria-label="Rainfall relative to the wettest month"><span style="width:' + barWidth + '%"></span></div>' +
        '<div class="climate-month-metrics"><span>Mean temp</span><b>' + esc(numberOrDash(month.temperatureMean,' °C')) + '</b>' +
        '<span>Typical low–high</span><b>' + esc(numberOrDash(month.temperatureMin,'–') + numberOrDash(month.temperatureMax,' °C')) + '</b>' +
        '<span>Rain days / month</span><b>' + esc(numberOrDash(month.rainyDays,' days')) + '</b>' +
        '<span>Mean wind</span><b class="' + (windCaution ? 'wind-warning' : '') + '">' + esc(numberOrDash(month.windMeanKmh,' km/h')) + '</b>' +
        '<span>Monthly peak gust</span><b class="' + (windCaution ? 'wind-warning' : '') + '">' + esc(numberOrDash(month.windGustMaxMeanKmh,' km/h')) + '</b>' +
        '<span>Dominant wind</span><b>' + esc(month.windDirection || '—') + '</b></div>' +
        (windCaution ? '<p class="climate-wind-note">Wind exposure flag: consider local shelter and staking.</p>' : '') +
        '</article>';
    }).join('');

    var cropCards = recommendations.slice(0,6).map(function (crop, index) {
      var best = crop.bestWindow || {};
      var reasons = (best.reasons || []).slice(0,2).map(function (reason) { return '<li>' + esc(reason) + '</li>'; }).join('');
      var cautions = (best.cautions || []).slice(0,2).map(function (caution) { return '<li>' + esc(caution) + '</li>'; }).join('');
      return '<article class="climate-crop-card">' +
        '<div id="climate-photo-' + esc(crop.id) + '" class="climate-crop-photo"><div class="crop-image-placeholder"><span>🌱</span><b>Plant reference</b><small>Image loads from Wikimedia Commons</small></div></div>' +
        '<div class="climate-crop-body"><div class="climate-crop-heading"><span class="data-tag green">CLIMATE PICK ' + String(index + 1).padStart(2,'0') + '</span><span class="crop-score">' + esc(best.score == null ? '—' : best.score) + '/100</span></div>' +
        '<h3>' + esc(crop.name) + '</h3><p class="crop-local-name">' + esc(crop.local) + ' · <i>' + esc(crop.scientific) + '</i></p>' +
        '<p class="climate-start-month"><strong>Try planting window:</strong> ' + esc(best.month || '—') + ' · establishment screen ' + esc(best.durationMonths || crop.climateRule && crop.climateRule.months || '—') + ' months</p>' +
        '<p>' + esc(crop.note) + '</p>' +
        '<div class="climate-crop-meta"><span>Temperature screen ' + esc(crop.climateRule.tempMin) + '–' + esc(crop.climateRule.tempMax) + ' °C</span><span>Window rainfall ' + esc(numberOrDash(best.totalRainMm,' mm')) + '</span><span>Mean wind ' + esc(numberOrDash(best.avgWindKmh,' km/h')) + '</span></div>' +
        (reasons ? '<div class="crop-reason"><b>Why the climate matched</b><ul>' + reasons + '</ul></div>' : '') +
        (cautions ? '<div class="crop-caution"><b>Check before planting</b><ul>' + cautions + '</ul></div>' : '') +
        '<p class="crop-photo-credit" id="climate-credit-' + esc(crop.id) + '">Reference photo source and license appear here when available.</p>' +
        '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&amp;search=' + encodeURIComponent(crop.scientific) + '">Search more crop photos ↗</a>' +
        '</div></article>';
    }).join('');

    var methodWarnings = [];
    if (avgWind != null && avgWind >= 25) methodWarnings.push('Long-term average wind is high enough to merit checking windbreaks, lodging and exposed sites.');
    if (peakGust >= 50) methodWarnings.push('Monthly peak gust statistics show potentially damaging gust exposure in some months.');
    if (!methodWarnings.length) methodWarnings.push('No generic high-wind flag was triggered by the monthly averages. This does not rule out storms, typhoons, squalls or field-level exposure.');

    return '<div class="tab-intro"><div class="eyebrow">CLIMATE & PLANTING / SEASON SCOUT</div>' +
      '<h2>What grows well, and when? 🌱</h2><p>Climate-based planting-window candidates for <b>' + esc(region) + '</b>. Month-by-month normals are estimated from daily observations for ' + esc(climate.startYear) + '–' + esc(climate.endYear) + ' at a representative point within the selected boundary.</p></div>' +
      '<div class="climate-summary-grid">' +
      '<article><span>HISTORICAL PROFILE</span><b>' + esc(climate.startYear + '–' + climate.endYear) + '</b><small>five completed calendar years</small></article>' +
      '<article><span>AVERAGE TEMPERATURE</span><b>' + esc(numberOrDash(meanTemp,' °C')) + '</b><small>mean of monthly averages</small></article>' +
      '<article><span>AVERAGE ANNUAL RAIN</span><b>' + esc(numberOrDash(annualRain,' mm')) + '</b><small>sum of average monthly rainfall</small></article>' +
      '<article><span>AVERAGE WIND</span><b>' + esc(numberOrDash(avgWind,' km/h')) + '</b><small>10 m above ground</small></article>' +
      '</div>' +
      '<section class="climate-method-note"><b>Where is this climate measured?</b><p>' + esc(levelLabel) + ' · approximate point ' + esc(climate.latitude) + ', ' + esc(climate.longitude) +
      '. Large or island-rich regions can contain very different microclimates. The selected point is a proxy, not a measurement for every farm in the region.</p></section>' +
      '<div class="section-title"><span class="mini-code">MONTH-BY-MONTH PATTERN</span><h3>Temperature, rain and wind</h3></div>' +
      '<div class="climate-month-grid">' + monthCards + '</div>' +
      '<div class="section-title"><span class="mini-code">PLANTING WINDOW SCREEN</span><h3>Top climate candidates</h3></div>' +
      '<p class="live-explainer">Rankings compare broad temperature and accumulated rainfall windows with provisional crop profiles. Soil type, soil pH, irrigation, variety, pests and local planting calendars can change the decision. Wind warnings are general exposure signals, not a crop-specific wind-tolerance model.</p>' +
      '<div class="climate-crop-grid">' + cropCards + '</div>' +
      '<section class="climate-method-note"><b>Wind and storm check</b><ul>' + methodWarnings.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' +
      '<p>Wind speed and gust figures are historical reference values, not storm forecasts. For planting in the coming weeks, also consult the current national meteorological service and local agricultural extension.</p></section>' +
      '<section class="climate-method-note"><b>Data provenance</b><p>Historical daily weather data via <a target="_blank" rel="noopener noreferrer" href="https://open-meteo.com/en/docs/historical-weather-api">Open-Meteo Historical Weather API</a>. Crop temperature/rainfall bands are provisional screening rules in this app, not a verified global agronomic model. Confirm recommendations with local agricultural extension and soil tests before committing land, seed or money.</p></section>';
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
          if (!slot || !images.length) {
            if (credit && !images.length) credit.textContent = 'No suitable reference photo returned. Use the photo search link below.';
            return;
          }
          var image = images[0];
          var imageUrl = safeHttps(image.imageUrl);
          var fileUrl = safeHttps(image.fileUrl);
          if (imageUrl === '#' || fileUrl === '#') return;
          slot.innerHTML = '<a class="crop-image-link" href="' + esc(fileUrl) + '" target="_blank" rel="noopener noreferrer" title="Open the original image and its license"><img src="' + esc(imageUrl) + '" alt="' + esc(crop.name + ' (' + crop.scientific + ')') + '" loading="lazy" decoding="async"><span class="crop-image-open">OPEN IMAGE ↗</span></a>';
          var imageNode = slot.querySelector('img');
          if (imageNode) imageNode.addEventListener('error', function () {
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo unavailable</b><small>Open the original file page to investigate.</small></div>';
          }, { once:true });
          var licenseHref = safeHttps(image.licenseUrl);
          if (credit) credit.innerHTML = 'Photo: <a target="_blank" rel="noopener noreferrer" href="' + esc(fileUrl) + '">' + esc(image.title.replace(/^File:/,'') ) + '</a><br>Credit: ' + esc(image.artist) + ' · License: ' +
            (licenseHref !== '#' ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(licenseHref) + '">' + esc(image.license) + '</a>' : esc(image.license));
        } catch (_) {
          if (requestId !== climatePhotoRequestId || currentProvince !== selection) return;
          var failedCredit = el('climate-credit-' + crop.id);
          if (failedCredit) failedCredit.textContent = 'Photo lookup is unavailable; use the photo search link below.';
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

  function renderOverview(profile) {
    return '<div class="tab-intro"><div class="eyebrow">PROVINCE FIELD NOTE / ' + esc(profile.name.toUpperCase()) +
      '</div><h2>Welcome to ' + esc(profile.name) + '!</h2><p>' + esc(profile.intro) + '</p>' +
      '<div class="profile-stamp"><span>🌱</span><div><b>Starting field profile</b><small>Regional planning cues · not a field survey</small></div></div></div>' +
      '<div class="tile-grid overview-grid">' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🗺️</span><span class="mini-code">LANDSCAPE</span></div><h3>Regional setting</h3><p>' + esc(profile.zone) + '</p></article>' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🎯</span><span class="mini-code">MAIN QUEST</span></div><h3>Priority to investigate</h3><p>' + esc(profile.focus) + '</p></article>' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🌾</span><span class="mini-code">CROP IDEAS</span></div><h3>' + profile.crops.length + ' crop candidates</h3><p>Candidate crops to validate against elevation, soil, local water, varieties, markets and farmer knowledge.</p></article>' +
      '</div>' +
      '<section class="quest-panel"><div class="quest-icon">📜</div><div><div class="mini-code">TODAY\'S FIELD QUEST</div><h3>Know the site before you plant</h3><p>Choose a specific farm or landscape unit, collect soil and water observations, check local rainfall and consult the agricultural extension service. A province is too large to have one universal soil profile.</p></div></section>' +
      '<section class="source-strip"><div><span class="mini-code">OFFICIAL PRODUCTION DATA</span><h3>Rice area, productivity and output by province</h3><p>BPS provides official provincial paddy statistics for 2024. This app links to the source instead of inventing statistics inside the profile.</p></div>' +
      '<a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html">OPEN BPS TABLE ↗</a></section>' + climatePreviewMarkup();
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
      '</div><section class="source-strip"><div><span class="mini-code">MAP SOURCES</span><h3>Look up the actual soil unit</h3><p>The Ministry of Agriculture geoportal hosts detailed soil-map services in some areas, but coverage is not uniform nationwide. Confirm the map scale and whether your site falls inside the mapped area.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://geoportal.pertanian.go.id/">OPEN KEMENTAN GEOPORTAL ↗</a></section>' +
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
    if (!crops.length) return '<p>No screening matches were found. Try leaving uncertain fields as “Not sure” and check the local soil and climate data.</p>';
    return crops.map(function (crop, index) {
      var reasons = (crop.reasons || []).slice(0, 3).map(function (reason) {
        return '<li>' + esc(reason) + '</li>';
      }).join('');
      var cautions = (crop.cautions || []).slice(0, 2).map(function (caution) {
        return '<li>' + esc(caution) + '</li>';
      }).join('');
      return '<article class="crop-match-card">' +
        '<div class="crop-match-image" id="crop-image-' + esc(crop.id) + '"><div class="crop-image-placeholder"><span>🌱</span><b>Searching plant photos…</b><small>Wikimedia Commons</small></div></div>' +
        '<div class="crop-match-body">' +
        '<div class="crop-match-topline"><span class="data-tag green">SCREEN ' + String(index + 1).padStart(2, '0') + '</span><span class="crop-score">' + esc(crop.score) + '/100</span></div>' +
        '<h4>' + esc(crop.name) + '</h4><p class="crop-local-name">' + esc(crop.local) + ' · <i>' + esc(crop.scientific) + '</i></p>' +
        '<p>' + esc(crop.note) + '</p>' +
        '<div class="crop-match-meta"><span>Screening pH ' + esc(crop.pHText) + '</span><span>' + esc(crop.category.replace(/-/g, ' ')) + '</span></div>' +
        (reasons ? '<div class="crop-reason"><b>Why it matched</b><ul>' + reasons + '</ul></div>' : '') +
        (cautions ? '<div class="crop-caution"><b>Before planting</b><ul>' + cautions + '</ul></div>' : '') +
        '<p class="crop-photo-credit" id="crop-credit-' + esc(crop.id) + '">Photo credit and license will be shown when a suitable image is available.</p>' +
        '</div></article>';
    }).join('');
  }

  async function loadCropPhotos(crops, requestId) {
    var api = window.BackToNatureAPI;
    if (!api || !api.searchPlantImages) {
      cropLabStatus('Crop matches are ready, but the photo API is not available. Reload the page and try again.', 'error');
      return;
    }

    var successCount = 0;
    var errorCount = 0;
    // Limit concurrent requests to reduce load on Commons; the API is also cached in memory.
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
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌿</span><b>No suitable public photo found</b><small>Try another crop or search the Commons file library.</small></div>';
            if (credit) credit.innerHTML = '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&amp;search=' + encodeURIComponent(crop.scientific) + '">Search more photos ↗</a>';
            return;
          }
          var image = images[0];
          var imageUrl = safeHttps(image.imageUrl);
          var fileUrl = safeHttps(image.fileUrl);
          if (imageUrl === '#' || fileUrl === '#') {
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo URL unavailable</b></div>';
            return;
          }
          slot.innerHTML = '<a class="crop-image-link" href="' + esc(fileUrl) + '" target="_blank" rel="noopener noreferrer" title="Open the original image and its license"><img src="' + esc(imageUrl) + '" alt="' + esc(crop.name + ' (' + crop.scientific + ')') + '" loading="lazy" decoding="async"><span class="crop-image-open">OPEN IMAGE ↗</span></a>';
          var imgNode = slot.querySelector('img');
          if (imgNode) imgNode.addEventListener('error', function () {
            slot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo could not be loaded</b><small>Open the source file page to check availability.</small></div>';
          }, { once:true });
          if (credit) {
            var licenseHref = safeHttps(image.licenseUrl);
            credit.innerHTML = 'Photo: <a target="_blank" rel="noopener noreferrer" href="' + esc(fileUrl) + '">' + esc(image.title.replace(/^File:/, '')) + '</a><br>Credit: ' + esc(image.artist) + ' · License: ' +
              (licenseHref !== '#' ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(licenseHref) + '">' + esc(image.license) + '</a>' : esc(image.license));
          }
          successCount++;
        } catch (_) {
          if (requestId !== cropLabRequestId) return;
          errorCount++;
          var failedSlot = el('crop-image-' + crop.id);
          if (failedSlot) failedSlot.innerHTML = '<div class="crop-image-placeholder"><span>🌱</span><b>Photo search unavailable</b><small>Crop matching still works without photos.</small></div>';
        }
      }));
    }
    if (requestId !== cropLabRequestId) return;
    crops.slice(4).forEach(function (crop) {
      var slot = el('crop-image-' + crop.id);
      var credit = el('crop-credit-' + crop.id);
      if (slot) slot.innerHTML = '<div class="crop-image-placeholder"><span>🌿</span><b>Photo search not run</b><small>To keep requests modest, photos load for the first four matches.</small></div>';
      if (credit) credit.innerHTML = '<a class="text-link" target="_blank" rel="noopener noreferrer" href="https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&amp;search=' + encodeURIComponent(crop.scientific) + '">Search photos on Commons ↗</a>';
    });
    if (successCount && errorCount) cropLabStatus('Crop screening complete. Some photo searches were blocked or returned no image; available images show their source and license.', 'success');
    else if (successCount) cropLabStatus('Crop screening complete. Open each photo source to review image identity, attribution and license.', 'success');
    else cropLabStatus('Crop matches are ready, but photo lookup did not return any usable images. Check the connection or open Wikimedia Commons manually.', 'pending');
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
      '<section class="source-strip"><div><span class="mini-code">LOCAL CALENDAR & EXTENSION</span><h3>Check the latest field guidance</h3><p>Exact planting month, plant spacing, seed rate, fertilizer rate and pest controls depend on crop variety and local conditions. Confirm them with extension staff and seasonal rainfall outlook.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="' + climatePortalUrl + '">' + climatePortalLabel + ' ↗</a></section>';
  }

  function renderTechnology(profile) {
    return '<div class="tab-intro"><div class="eyebrow">TECHNOLOGY & RESTORATION / TOOLBOX</div><h2>Choose the right tool for the land</h2><p>Technology is a response to a diagnosed constraint. Start with low-regret practices, trial them on a small area and monitor changes before scaling.</p></div>' +
      buildTechCards(profile) +
      '<section class="quest-panel"><div class="quest-icon">🛠️</div><div><div class="mini-code">RESTORATION RULE</div><h3>Do not engineer what you have not diagnosed</h3><p>Terraces, drainage, bunds and water-control structures can create new risks if designed without slope, hydrology and downstream impacts. Get local technical advice before major earthworks.</p></div></section>' +
      '<section class="source-strip"><div><span class="mini-code">DOCUMENTED PRACTICES</span><h3>Search WOCAT sustainable land management technologies</h3><p>WOCAT records can help compare documented techniques and contexts. Exact live API queries may require authorized access; the public catalogue remains available for browsing.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://qcat.wocat.net/en/wocat/list/">BROWSE WOCAT ↗</a></section>';
  }

  function renderSources(profile) {
    var selectedIso3 = currentProvince && currentProvince.countryIso3 ? currentProvince.countryIso3 : 'IDN';
    if (selectedIso3 !== 'IDN') {
      var selectedCountryName = currentProvince.countryName || selectedCountry && selectedCountry.name || selectedIso3;
      var featureProps = currentProvince.feature && currentProvince.feature.properties ? currentProvince.feature.properties : {};
      var boundaryMetadataUrl = featureProps._bt_source_metadata_url || '';
      var boundaryLicense = featureProps._bt_boundary_license || 'See the source metadata for applicable license and attribution terms.';
      var generalSources = [
        {t:'FAO Hand-in-Hand geospatial catalogue',d:'Explore available land, water, climate and agricultural geospatial datasets. Coverage varies by country and layer.',u:'https://data.apps.fao.org/?lang=en',tag:'GEOSPATIAL DATA'},
        {t:'FAOSTAT',d:'Country-level agriculture, land-use and food-system indicators. These are national statistics, not measurements for this specific region.',u:'https://www.fao.org/faostat/en/#data',tag:'GLOBAL STATISTICS'},
        {t:'World Bank Climate Change Knowledge Portal',d:'Country-level climate context to support further investigation. Validate local seasons and field conditions with national services and extension specialists.',u:'https://climateknowledgeportal.worldbank.org/',tag:'CLIMATE CONTEXT'},
        {t:'WOCAT sustainable land management',d:'Browse documented soil, water and sustainable land management practices. A method should only be applied when the local conditions fit the documented context.',u:'https://qcat.wocat.net/en/wocat/list/',tag:'FARMING PRACTICES'},
        {t:'geoBoundaries administrative data',d:'Boundary provenance for the selected region. The represented year and license can differ between countries and administrative levels.',u:boundaryMetadataUrl || 'https://www.geoboundaries.org/',tag:'BOUNDARY PROVENANCE'}
      ];
      return '<div class="tab-intro"><div class="eyebrow">DATA SOURCES / EVIDENCE SHELF</div><h2>Keep the receipts 📚</h2><p>Regional field notes for <b>' + esc(selectedCountryName) + '</b>. These are discovery resources, not proof that a crop is suitable for a particular farm.</p></div>' +
        '<div class="source-list">' + generalSources.map(function (source, i) {
          return '<article class="source-card"><div class="source-index">' + String(i + 1).padStart(2, '0') + '</div><div class="source-main"><span class="mini-code">' + esc(source.tag) + '</span><h3>' + esc(source.t) + '</h3><p>' + esc(source.d) + '</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(source.u)) + '">Open source ↗</a></div></article>';
        }).join('') + '</div>' +
        '<section class="data-integrity"><span class="data-tag green">BOUNDARY METADATA</span><h3>Check the original source</h3><p><b>Administrative level:</b> ' + esc(currentProvince.adminLevel === 2 ? 'ADM2 · second-level local unit' : 'ADM1 · first-level region') + '.</p><p><b>Boundary license:</b> ' + esc(boundaryLicense) + '</p><p>Administrative names and legal categories differ between countries. Do not interpret this generic regional fieldbook as a verified local soil survey or crop prescription.</p></section>';
    }
    var sources = [
      {t:'BPS — provincial rice statistics',d:'Official harvested area, productivity and production table. Open the source table and select the relevant year.',u:'https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html',tag:'OFFICIAL STATISTICS'},
      {t:'Kementerian Pertanian — soil and agricultural geodata',d:'Explore available soil and land-resource layers. Coverage, scale and licensing must be checked for each layer.',u:'https://geoportal.pertanian.go.id/',tag:'SOIL / GIS'},
      {t:'FAO Hand-in-Hand',d:'Spatial datasets and context for land, water, climate and agricultural systems.',u:'https://data.apps.fao.org/?lang=en',tag:'GEOSPATIAL'},
      {t:'FAOSTAT',d:'Country-level agricultural indicators and land-use statistics. These are not provincial measurements.',u:'https://www.fao.org/faostat/en/#data',tag:'GLOBAL INDICATORS'},
      {t:'WOCAT QCAT',d:'Documented sustainable land management approaches and technologies. API access may require a token.',u:'https://qcat.wocat.net/en/wocat/list/',tag:'RESTORATION METHODS'},
      {t:'FAO AGROVOC',d:'Multilingual agricultural vocabulary and concept relationships for structured discovery.',u:'https://agrovoc.fao.org/browse/agrovoc/en/',tag:'TAXONOMY'},
      {t:'CGIAR GARDIAN',d:'Agricultural research and dataset discovery. The discovery portal is linked here; verify current API access, schema and authentication before building an automated connector.',u:'https://gardian.bigdata.cgiar.org/',tag:'RESEARCH DISCOVERY'},
      {t:'OpenFarm growing guides — archived',d:'OpenFarm announced that its servers shut down in April 2025. The original growing-guide API is not treated as live; its archived repository is available for reference only.',u:'https://github.com/openfarmcc/OpenFarm',tag:'ARCHIVED / NOT LIVE'},
      {t:'Provincial boundary GeoJSON',d:'38 Indonesian province boundaries. Repository README cites Kepmendagri No. 300.2.2-2138/2025 and MIT licensing; review the original metadata when reusing.',u:'https://github.com/AlfianAliM/Indonesia-GeoJSON',tag:'MAP BOUNDARIES'}
    ];
    return '<div class="tab-intro"><div class="eyebrow">DATA SOURCES / EVIDENCE SHELF</div><h2>Keep the receipts 📚</h2><p>Open source records to check update date, methodology, geographic coverage, license and units. This app separates a curated regional starter profile from measured statistics.</p></div>' +
      '<section class="live-connectors"><div class="section-title"><span class="mini-code">LIVE DATA TERMINAL</span><h3>Query the source systems</h3></div>' +
      '<p class="live-explainer">These connectors request real records when you press a button. National FAOSTAT observations provide country context only; they are not provincial soil or yield measurements.</p>' +
      '<div class="tile-grid">' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">📊</span><span class="mini-code">FAOSTAT / LIVE</span></div><h3>Land use · Indonesia</h3><p>Request Indonesia-level land-use observations from the public FAOSTAT API.</p><button id="live-faostat-btn" class="pixel-btn" type="button">FETCH NATIONAL DATA</button><div id="live-faostat-status" class="live-status" aria-live="polite">Not queried yet</div><div id="live-faostat-results" class="live-results">No values are shown until the live API responds.</div></article>' +
      '<article class="field-card"><div class="card-topline"><span class="card-emoji">🗺️</span><span class="mini-code">FAO CATALOGUE / LIVE</span></div><h3>Spatial metadata · ' + esc(profile.name) + '</h3><p>Search FAO catalogue metadata for records mentioning this province and soil, land, water, climate or agriculture.</p><button id="live-fao-catalog-btn" class="pixel-btn" type="button">SEARCH FAO CATALOGUE</button><div id="live-fao-catalog-status" class="live-status" aria-live="polite">Not queried yet</div><div id="live-fao-catalog-results" class="live-results">No catalogue results loaded.</div></article>' +
      '</div><details class="token-box"><summary>🔐 Connect authorized WOCAT QCAT access (optional)</summary><p>WOCAT results are searched at the Indonesia/country level because a province-specific technology filter is not guaranteed. The token is used for this request only and is not written to localStorage or the repository. Only enter a token you are authorized to use.</p><label for="live-wocat-token">WOCAT QCAT token</label><input id="live-wocat-token" type="password" autocomplete="off" spellcheck="false" placeholder="Paste token for one request"><button id="live-wocat-btn" class="pixel-btn wood" type="button">FETCH WOCAT TECHNOLOGIES</button><div id="live-wocat-status" class="live-status" aria-live="polite">Token not supplied</div><div id="live-wocat-results" class="live-results">Live access requires a valid WOCAT token; no sample records are fabricated.</div></details></section>' +
      '<div class="source-list">' + sources.map(function (s, i) {
        return '<article class="source-card"><div class="source-index">' + String(i + 1).padStart(2, '0') + '</div><div class="source-main"><span class="mini-code">' + esc(s.tag) + '</span><h3>' + esc(s.t) + '</h3><p>' + esc(s.d) + '</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(s.u) + '">Open source ↗</a></div></article>';
      }).join('') + '</div>' +
      '<section class="data-integrity"><span class="data-tag green">DATA INTEGRITY</span><h3>What this panel does—and does not—claim</h3><p><b>It does:</b> organize regional planning cues, crop candidates, field-check lists and trusted data portals.</p><p><b>It does not:</b> claim laboratory soil values, precise yield, farm-level suitability or confirmed API measurements where those data were not retrieved and validated.</p><p>Selected province: <b>' + esc(profile.name) + '</b>. Profile type: <b>curated regional starter</b>.</p></section>';
  }

  function setLiveStatus(id, text, type) {
    var node = el(id);
    if (!node) return;
    node.className = 'live-status ' + (type || 'neutral');
    node.textContent = text;
  }

  function safeHttps(value) {
    try {
      var parsed = new URL(String(value || ''), window.location.href);
      return parsed.protocol === 'https:' ? parsed.href : '#';
    } catch (_) { return '#'; }
  }

  function wireSourceControls(profile) {
    var api = window.BackToNatureAPI;
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
        el('live-faostat-results').innerHTML = table;
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
        el('live-fao-catalog-results').innerHTML = '<ul class="live-record-list">' + records.map(function (record) {
          return '<li><b>' + esc(record.title) + '</b>' +
            (record.summary ? '<p>' + esc(record.summary.slice(0,240)) + (record.summary.length > 240 ? '…' : '') + '</p>' : '') +
            '<a target="_blank" rel="noopener noreferrer" href="' + esc(safeHttps(record.url)) + '">Open metadata ↗</a></li>';
        }).join('') + '</ul>';
        setLiveStatus('live-fao-catalog-status', 'LIVE CATALOGUE · ' + records.length + ' records', 'success');
      } catch (error) {
        setLiveStatus('live-fao-catalog-status', 'Catalogue request failed', 'error');
        el('live-fao-catalog-results').textContent = (error && error.message ? error.message : 'Unknown API error') + ' The request may be blocked by CORS or network policy. No fake records were substituted.';
      } finally { catBtn.disabled = false; }
    });

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
      setLiveStatus('live-wocat-status', 'Requesting authorized WOCAT records…', 'pending');
      el('live-wocat-results').textContent = 'The token was removed from the input and will only be passed to this request.';
      try {
        var records = await api.fetchWocatTechnologies(token, 'IDN');
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

  function renderTab(tab) {
    if (!currentProvince) return;
    var profile = profileFor(currentProvince.name);
    var content = el('modal-content');
    if (!content) return;
    currentTab = tab;
    content.innerHTML = tab === 'overview' ? renderOverview(profile) :
      tab === 'soil' ? renderSoil(profile) :
      tab === 'crops' ? renderCrops(profile) :
      tab === 'climate' ? renderClimateAndPlanting(profile) :
      tab === 'farming' ? renderFarming(profile) :
      tab === 'technology' ? renderTechnology(profile) : renderSources(profile);
    if (tab === 'sources') wireSourceControls(profile);
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
    {id:'climate',label:'04 CLIMATE & PLANTING',icon:'🌦️'},
    {id:'farming',label:'05 FARMING GUIDE',icon:'🚜'},
    {id:'technology',label:'06 TECHNOLOGY',icon:'🛠️'},
    {id:'sources',label:'07 SOURCES',icon:'📚'}
  ];
  el('modal-tabs').innerHTML = tabs.map(function (t) {
    return '<button class="tab-btn" type="button" role="tab" aria-selected="false" data-tab="' + t.id + '">' + t.icon + ' ' + t.label + '</button>';
  }).join('');

  el('modal-tabs').addEventListener('click', function (event) {
    var button = event.target.closest('.tab-btn');
    if (button) renderTab(button.getAttribute('data-tab'));
  });
  el('modal-close').addEventListener('click', closeModal);
  el('province-modal').addEventListener('click', function (event) {
    if (event.target === el('province-modal')) closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeModal();
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
          openModal(name, feature, context);
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
    var requestId = ++adminLoadRequestId;
    closeModal();
    hideMapStatus();
    await ensureBoundaryIndexes();
    if (worldLayer && map.hasLayer(worldLayer)) map.removeLayer(worldLayer);
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    mode = 'provinces';
    document.body.classList.add('province-mode');
    selectedCountry = { iso3: iso3, name: countryName || (countryByISO3[iso3] && countryByISO3[iso3].name) || iso3 };
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
    var requestId = ++adminLoadRequestId;
    closeModal();
    hideMapStatus();
    await ensureBoundaryIndexes();
    if (worldLayer && map.hasLayer(worldLayer)) map.removeLayer(worldLayer);
    if (provinceLayer && map.hasLayer(provinceLayer)) map.removeLayer(provinceLayer);
    mode = 'districts';
    document.body.classList.add('province-mode');
    selectedCountry = { iso3: iso3, name: countryName || (countryByISO3[iso3] && countryByISO3[iso3].name) || iso3 };
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
    openModal(featureName, feature, {
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
                  showMapStatus(name + ' · country selected', 'Could not match this map polygon to an ISO-3 code in the boundary index. Use the Indonesia Explorer button or choose another country.');
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
      setText('map-status-text', 'Click any country to explore its regions. Use Indonesia Explorer as a shortcut.');
      setTimeout(hideMapStatus, 2600);
    } catch (error) {
      showMapStatus('World boundaries unavailable', 'The map tiles may still work. ' + (error && error.message ? error.message : 'Reload to retry the country boundary data.'));
    }
  }
  el('btn-provinces').textContent = '🇮🇩 INDONESIA EXPLORER';
  el('btn-provinces').addEventListener('click', function () { enterCountryMode('IDN', 'Indonesia'); });
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

  loadWorldLayer();
})();