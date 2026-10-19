/* BackToNature — provincial agriculture fieldbook, PS1-inspired UI */
(function () {
  'use strict';

  var WORLD_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';
  var PROVINCE_URL = 'https://raw.githubusercontent.com/mashadinoor/Indonesia-Geojson-2026/main/Geojson/indonesia_provinsi.geojson';
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
      '<a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html">OPEN BPS TABLE ↗</a></section>';
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

  function renderCrops(profile) {
    var chips = profile.crops.map(function (crop, i) {
      return '<div class="crop-card"><div class="crop-glyph">' + ['🌾','🌱','🌴','🥬','🍠'][i % 5] + '</div><div><span class="mini-code">CANDIDATE ' + String(i + 1).padStart(2, '0') + '</span><h3>' + esc(crop) + '</h3><p>Investigate local suitability, water needs, variety, pest pressure, harvest window, costs and market access before choosing.</p></div></div>';
    }).join('');
    return '<div class="tab-intro"><div class="eyebrow">CROPS & FARMING / PLANT WITH A PLAN</div><h2>What could we grow?</h2><p>These are candidate crops to investigate based on broad regional farming contexts—not an automated guarantee of suitability. The right crop depends on the individual site, variety, water and the farmer\'s objectives.</p></div>' +
      '<div class="crop-list">' + chips + '</div>' +
      '<div class="section-title"><span class="mini-code">SEASONAL PLANNING</span><h3>Plan around water, not a generic calendar</h3></div><div class="tile-grid">' +
      '<article class="field-card"><div class="card-emoji">🌧️</div><h3>Rainy season</h3><p>Confirm onset and likely duration of rain, drainage, flood exposure and seedbed conditions. Keep soil covered and avoid sowing into saturated soil where the crop is sensitive.</p></article>' +
      '<article class="field-card"><div class="card-emoji">☀️</div><h3>Dry season</h3><p>Check dependable irrigation first. Prioritize water-efficient or locally drought-adapted options where suitable; do not increase planted area beyond reliable water supply.</p></article>' +
      '<article class="field-card"><div class="card-emoji">📅</div><h3>Local crop calendar</h3><p>Planting months vary by district, elevation and irrigation schedule. Confirm with the local agricultural extension office and current BMKG rainfall outlook.</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="https://www.bmkg.go.id/">Check BMKG ↗</a></article>' +
      '</div><section class="quest-panel"><div class="quest-icon">🧺</div><div><div class="mini-code">FARMER CHECK</div><h3>Market before monoculture</h3><p>Compare input costs, labour, storage, buyers, transport and food-security needs before converting land to a single cash crop.</p></div></section>';
  }

  function renderTechnology(profile) {
    return '<div class="tab-intro"><div class="eyebrow">TECHNOLOGY & RESTORATION / TOOLBOX</div><h2>Choose the right tool for the land</h2><p>Technology is a response to a diagnosed constraint. Start with low-regret practices, trial them on a small area and monitor changes before scaling.</p></div>' +
      buildTechCards(profile) +
      '<section class="quest-panel"><div class="quest-icon">🛠️</div><div><div class="mini-code">RESTORATION RULE</div><h3>Do not engineer what you have not diagnosed</h3><p>Terraces, drainage, bunds and water-control structures can create new risks if designed without slope, hydrology and downstream impacts. Get local technical advice before major earthworks.</p></div></section>' +
      '<section class="source-strip"><div><span class="mini-code">DOCUMENTED PRACTICES</span><h3>Search WOCAT sustainable land management technologies</h3><p>WOCAT records can help compare documented techniques and contexts. Exact live API queries may require authorized access; the public catalogue remains available for browsing.</p></div><a class="pixel-btn" target="_blank" rel="noopener noreferrer" href="https://qcat.wocat.net/en/wocat/list/">BROWSE WOCAT ↗</a></section>';
  }

  function renderSources(profile) {
    var sources = [
      {t:'BPS — provincial rice statistics',d:'Official harvested area, productivity and production table. Open the source table and select the relevant year.',u:'https://www.bps.go.id/en/statistics-table/2/MTQ5OCMy/luaspanen-produksi-dan-produktivitas-padi-menurutprovinsi.html',tag:'OFFICIAL STATISTICS'},
      {t:'Kementerian Pertanian — soil and agricultural geodata',d:'Explore available soil and land-resource layers. Coverage, scale and licensing must be checked for each layer.',u:'https://geoportal.pertanian.go.id/',tag:'SOIL / GIS'},
      {t:'FAO Hand-in-Hand',d:'Spatial datasets and context for land, water, climate and agricultural systems.',u:'https://data.apps.fao.org/?lang=en',tag:'GEOSPATIAL'},
      {t:'FAOSTAT',d:'Country-level agricultural indicators and land-use statistics. These are not provincial measurements.',u:'https://www.fao.org/faostat/en/#data',tag:'GLOBAL INDICATORS'},
      {t:'WOCAT QCAT',d:'Documented sustainable land management approaches and technologies. API access may require a token.',u:'https://qcat.wocat.net/en/wocat/list/',tag:'RESTORATION METHODS'},
      {t:'FAO AGROVOC',d:'Multilingual agricultural vocabulary and concept relationships for structured discovery.',u:'https://agrovoc.fao.org/browse/agrovoc/en/',tag:'TAXONOMY'},
      {t:'Provincial boundary GeoJSON',d:'38 Indonesian province boundaries. Repository README cites Kepmendagri No. 300.2.2-2138/2025 and MIT licensing; review the original metadata when reusing.',u:'https://github.com/AlfianAliM/Indonesia-GeoJSON',tag:'MAP BOUNDARIES'}
    ];
    return '<div class="tab-intro"><div class="eyebrow">DATA SOURCES / EVIDENCE SHELF</div><h2>Keep the receipts 📚</h2><p>Open source records to check update date, methodology, geographic coverage, license and units. This app separates a curated regional starter profile from measured statistics.</p></div>' +
      '<div class="source-list">' + sources.map(function (s, i) {
        return '<article class="source-card"><div class="source-index">' + String(i + 1).padStart(2, '0') + '</div><div class="source-main"><span class="mini-code">' + esc(s.tag) + '</span><h3>' + esc(s.t) + '</h3><p>' + esc(s.d) + '</p><a class="text-link" target="_blank" rel="noopener noreferrer" href="' + esc(s.u) + '">Open source ↗</a></div></article>';
      }).join('') + '</div>' +
      '<section class="data-integrity"><span class="data-tag green">DATA INTEGRITY</span><h3>What this panel does—and does not—claim</h3><p><b>It does:</b> organize regional planning cues, crop candidates, field-check lists and trusted data portals.</p><p><b>It does not:</b> claim laboratory soil values, precise yield, farm-level suitability or confirmed API measurements where those data were not retrieved and validated.</p><p>Selected province: <b>' + esc(profile.name) + '</b>. Profile type: <b>curated regional starter</b>.</p></section>';
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
      tab === 'technology' ? renderTechnology(profile) : renderSources(profile);
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    content.scrollTop = 0;
  }

  function openModal(name, feature) {
    var profile = profileFor(name);
    currentProvince = { name:name, feature:feature || null };
    currentTab = 'overview';
    setText('modal-title', name);
    setText('modal-subtitle', 'PROVINCE FIELD GUIDE · ' + profile.zone.toUpperCase());
    setText('modal-stamp', 'FIELD NOTE / ' + (feature && feature.properties && feature.properties.code ? feature.properties.code : 'REGIONAL PROFILE'));
    el('province-modal').classList.add('open');
    el('province-modal').setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    renderTab('overview');
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
    {id:'crops',label:'03 CROPS & FARMING',icon:'🌾'},
    {id:'technology',label:'04 TECHNOLOGY',icon:'🛠️'},
    {id:'sources',label:'05 SOURCES',icon:'📚'}
  ];
  el('modal-tabs').innerHTML = tabs.map(function (t) {
    return '<button class="tab-btn" type="button" role="tab" aria-selected="false" data-tab="' + t.id + '">' + t.icon + ' ' + t.label + '</button>';
  }).join('');

  el('modal-tabs').addEventListener('click', function (event) {
    var button = event.target.closest('.tab-btn');
    if (button) renderTab(button.getAttribute('data-tab'));
  });
  el('modal-close').addEventListener('click', closeModal);
  el('modal-backdrop').addEventListener('click', function (event) {
    if (event.target === el('modal-backdrop')) closeModal();
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
  function fillProvinceSelect() {
    var select = el('province-select');
    if (!select || !provincesGeoJSON) return;
    var list = provincesGeoJSON.features.slice().sort(function (a, b) {
      return norm((a.properties || {}).name).localeCompare(norm((b.properties || {}).name));
    });
    select.innerHTML = '<option value="">JUMP TO PROVINCE…</option>' + list.map(function (feature) {
      var p = feature.properties || {};
      return '<option value="' + esc(p.name || '') + '">' + esc(p.name || 'Unknown province') + '</option>';
    }).join('');
  }

  function provinceStyle() {
    return { color:'#513e2a', weight:2, opacity:1, fillColor:'#98bd68', fillOpacity:0.72 };
  }
  function provinceHoverStyle() {
    return { color:'#fff2bd', weight:3, opacity:1, fillColor:'#e8bb53', fillOpacity:0.92 };
  }

  async function enterProvinceMode() {
    closeModal();
    hideMapStatus();
    if (worldLayer) { map.removeLayer(worldLayer); worldLayer = null; }
    mode = 'provinces';
    document.body.classList.add('province-mode');
    setText('map-title', 'INDONESIA · PROVINCE EXPLORER');
    el('btn-world').hidden = false;
    el('btn-provinces').hidden = true;
    el('province-select-wrap').hidden = false;
    showMapStatus('Loading province map…', 'Fetching boundaries for all 38 provinces. This is a one-time download per browser cache.');
    try {
      if (!provincesGeoJSON) {
        var response = await fetch(PROVINCE_URL, { cache:'force-cache' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        provincesGeoJSON = await response.json();
      }
      if (provinceLayer) map.removeLayer(provinceLayer);
      provinceLayer = L.geoJSON(provincesGeoJSON, {
        style:provinceStyle,
        onEachFeature:function (feature, layer) {
          var name = (feature.properties || {}).name || 'Unknown province';
          layer.bindTooltip(name, { sticky:true, direction:'auto', className:'retro-tooltip' });
          layer.on('mouseover', function () { layer.setStyle(provinceHoverStyle()); if (layer.bringToFront) layer.bringToFront(); });
          layer.on('mouseout', function () { provinceLayer.resetStyle(layer); });
          layer.on('click', function (event) {
            L.DomEvent.stopPropagation(event);
            openModal(name, feature);
          });
        }
      }).addTo(map);
      map.fitBounds(provinceLayer.getBounds(), { padding:[35,35] });
      fillProvinceSelect();
      setText('map-status-title', '38 provinces ready');
      setText('map-status-text', 'Click a province for its full-screen field guide. Choose a province from the list if you prefer.');
      setTimeout(hideMapStatus, 2600);
      el('province-select').focus({preventScroll:true});
    } catch (error) {
      showMapStatus('Could not load provincial boundaries', 'Check your connection and reload. ' + (error.message || 'The GeoJSON source was unavailable.'));
    }
  }

  function enterWorldMode() {
    closeModal();
    mode = 'world';
    document.body.classList.remove('province-mode');
    if (provinceLayer) { map.removeLayer(provinceLayer); provinceLayer = null; }
    el('btn-world').hidden = true;
    el('btn-provinces').hidden = false;
    el('province-select-wrap').hidden = true;
    setText('map-title', 'GLOBAL LAND RESTORATION MAP');
    if (!worldLayer) loadWorldLayer();
    map.setView([12, 105], 3);
  }

  async function jumpToProvince(name) {
    if (!name) return;
    var feature = provincesGeoJSON && provincesGeoJSON.features.find(function (f) {
      return norm((f.properties || {}).name) === norm(name);
    });
    if (!feature) return;
    if (mode !== 'provinces') await enterProvinceMode();
    openModal((feature.properties || {}).name || name, feature);
    if (provinceLayer) {
      var targetLayer = null;
      provinceLayer.eachLayer(function (layer) {
        if (norm((layer.feature.properties || {}).name) === norm(name)) targetLayer = layer;
      });
      if (targetLayer) map.fitBounds(targetLayer.getBounds(), { padding:[45,45], maxZoom:7 });
    }
  }

  async function loadWorldLayer() {
    var id = ++worldRequestId;
    showMapStatus('Loading world map…', 'Getting country boundaries.');
    try {
      var response = await fetch(WORLD_URL, { cache:'force-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      if (id !== worldRequestId || mode !== 'world') return;
      worldLayer = L.geoJSON(data, {
        style:function () { return { color:'#4c5a38', weight:1, fillColor:'#85a95f', fillOpacity:0.30 }; },
        onEachFeature:function (feature, layer) {
          var props = feature.properties || {};
          var name = props.ADMIN || props.name || props.NAME || 'Unknown region';
          layer.bindTooltip(name, { sticky:true, className:'retro-tooltip' });
          layer.on('mouseover', function () { layer.setStyle({ color:'#ffebac', weight:2, fillColor:'#eac15d', fillOpacity:0.72 }); });
          layer.on('mouseout', function () { worldLayer.resetStyle(layer); });
          layer.on('click', function (event) {
            L.DomEvent.stopPropagation(event);
            if (norm(name) === 'indonesia') {
              enterProvinceMode();
            } else {
              showMapStatus(name + ' · country-level view', 'The detailed 38-province field explorer is currently focused on Indonesia. Click “Province Explorer” to open the Indonesian provincial map.');
            }
          });
        }
      }).addTo(map);
      setText('map-status-title', 'World map ready');
      setText('map-status-text', 'Click Indonesia or use “Province Explorer” to explore all 38 provinces.');
      setTimeout(hideMapStatus, 3000);
    } catch (error) {
      showMapStatus('World boundaries unavailable', 'The map tiles may still work. Reload to retry the country boundary data.');
    }
  }

  el('btn-provinces').addEventListener('click', enterProvinceMode);
  el('btn-world').addEventListener('click', enterWorldMode);
  el('btn-home').addEventListener('click', function () { closeModal(); map.setView([12,105],3); });
  el('province-select').addEventListener('change', function () { jumpToProvince(this.value); });
  el('open-current-province').addEventListener('click', function () {
    if (currentProvince) renderTab('overview');
  });

  loadWorldLayer();
})();