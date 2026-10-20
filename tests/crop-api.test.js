/* Offline smoke tests for BackToNature's crop screening and photo mapper. */
const assert = require('node:assert/strict');

global.window = {};
const originalFetch = global.fetch;
require('../api.js');
const api = global.window.BackToNatureAPI;

async function main() {
  assert.equal(typeof api.listCropRecommendations, 'function', 'crop screener is exported');
  assert.equal(typeof api.searchPlantImages, 'function', 'Commons image search is exported');

  const recommendations = api.listCropRecommendations({
    soil: 'sandy',
    ph: 5.8,
    drainage: 'well',
    water: 'seasonal',
    climate: 'dry-tropical',
    use: 'staple'
  });
  assert.ok(recommendations.length > 0 && recommendations.length <= 8, 'returns a bounded result set');
  assert.ok(recommendations.every((item) => item.score >= 0 && item.score <= 100), 'scores are within 0–100');
  assert.ok(recommendations.every((item, i) => i === 0 || recommendations[i - 1].score >= item.score), 'results are sorted by score');
  assert.ok(recommendations.every((item) => item.pHText && item.scientific && Array.isArray(item.cautions)), 'results include transparent crop metadata');
  assert.ok(recommendations.some((item) => item.id === 'cassava'), 'sandy seasonal staple example includes cassava');

  const mismatchedSoil = api.listCropRecommendations({
    soil: 'saline',
    ph: 6.3,
    drainage: 'well',
    water: 'reliable',
    climate: 'humid-tropical',
    use: 'market'
  });
  assert.ok(mismatchedSoil.every((item) => item.score <= 49), 'major soil mismatches cannot get reassuringly high scores');

  let requestedUrl = '';
  global.fetch = async function (url) {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify({
          query: {
            pages: {
              '123': {
                title: 'File:Example rice plant.jpg',
                imageinfo: [{
                  mime: 'image/jpeg',
                  url: 'https://upload.wikimedia.org/wikipedia/commons/example.jpg',
                  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/example.jpg',
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example_rice_plant.jpg',
                  extmetadata: {
                    Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:Example">Example Photographer</a>' },
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' },
                    ImageDescription: { value: 'Rice plant growing in a field' }
                  }
                }]
              }
            }
          }
        });
      }
    };
  };
  const images = await api.searchPlantImages({ name: 'Rice', scientific: 'Oryza sativa' }, 2);
  assert.equal(images.length, 1, 'image search maps Commons API response');
  assert.match(requestedUrl, /commons\.wikimedia\.org\/w\/api\.php/, 'uses Wikimedia Commons API');
  assert.equal(new URL(requestedUrl).searchParams.get('origin'), '*', 'includes MediaWiki CORS parameter');
  assert.equal(images[0].artist, 'Example Photographer', 'cleans the photographer metadata');
  assert.equal(images[0].license, 'CC BY-SA 4.0', 'returns license metadata');
  assert.ok(images[0].imageUrl.startsWith('https://upload.wikimedia.org/'), 'returns a secure thumbnail URL');

  const simulatedNormals = [
    {label:'Jan',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:120,rainyDays:15,windMeanKmh:12,windGustMaxMeanKmh:28,windDirection:'E'},
    {label:'Feb',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:140,rainyDays:16,windMeanKmh:12,windGustMaxMeanKmh:28,windDirection:'E'},
    {label:'Mar',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:150,rainyDays:17,windMeanKmh:13,windGustMaxMeanKmh:30,windDirection:'E'},
    {label:'Apr',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:130,rainyDays:14,windMeanKmh:13,windGustMaxMeanKmh:30,windDirection:'E'},
    {label:'May',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:90,rainyDays:10,windMeanKmh:14,windGustMaxMeanKmh:31,windDirection:'E'},
    {label:'Jun',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:60,rainyDays:7,windMeanKmh:15,windGustMaxMeanKmh:35,windDirection:'ESE'},
    {label:'Jul',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:40,rainyDays:5,windMeanKmh:16,windGustMaxMeanKmh:38,windDirection:'ESE'},
    {label:'Aug',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:35,rainyDays:4,windMeanKmh:17,windGustMaxMeanKmh:40,windDirection:'ESE'},
    {label:'Sep',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:55,rainyDays:6,windMeanKmh:16,windGustMaxMeanKmh:36,windDirection:'E'},
    {label:'Oct',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:100,rainyDays:11,windMeanKmh:14,windGustMaxMeanKmh:32,windDirection:'E'},
    {label:'Nov',temperatureMean:27,temperatureMin:23,temperatureMax:32,precipitationMm:160,rainyDays:18,windMeanKmh:13,windGustMaxMeanKmh:30,windDirection:'E'},
    {label:'Dec',temperatureMean:26,temperatureMin:22,temperatureMax:31,precipitationMm:180,rainyDays:19,windMeanKmh:12,windGustMaxMeanKmh:28,windDirection:'E'}
  ];
  const plantingWindows = api.rankPlantingWindows(simulatedNormals);
  assert.ok(plantingWindows.length > 0 && plantingWindows.length <= 8, 'ranks a bounded list of climate candidates');
  assert.ok(plantingWindows.every((crop) => crop.bestWindow && crop.bestWindow.month && crop.bestWindow.score >= 0 && crop.bestWindow.score <= 100), 'each climate candidate contains a scored planting window');
  assert.ok(plantingWindows.every((crop, i) => i === 0 || plantingWindows[i - 1].climateScore >= crop.climateScore), 'climate candidates are ranked by score');
  assert.ok(plantingWindows.every((crop) => ['suitable','caution','wait','unknown'].includes(crop.currentMonthStatus)), 'every crop exposes a current-month season assessment');
  assert.ok(plantingWindows.every((crop) => crop.currentMonthWindow && crop.currentMonthWindow.monthIndex === new Date().getMonth()), 'current-month assessment evaluates a planting window that starts this month');


  // Test the historical archive response mapper without calling any external API.
  const dates = [];
  for (let date = new Date('2024-01-01T00:00:00Z'); date <= new Date('2024-12-31T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  let climateRequestUrl = '';
  global.fetch = async function (url) {
    climateRequestUrl = String(url);
    const values = (value) => dates.map(() => value);
    const weather = {
      time: dates,
      temperature_2m_mean: values(26),
      temperature_2m_min: values(22),
      temperature_2m_max: values(31),
      precipitation_sum: values(5),
      wind_speed_10m_mean: values(12),
      wind_speed_10m_max: values(26),
      wind_gusts_10m_max: values(35),
      wind_direction_10m_dominant: values(90),
      et0_fao_evapotranspiration: values(3)
    };
    return {
      ok:true,
      status:200,
      text:async function () { return JSON.stringify({ latitude:-6.2,longitude:106.8,daily:weather }); }
    };
  };
  const climate = await api.fetchHistoricalClimate(-6.2,106.8,5);
  assert.equal(climate.monthly.length,12,'historical weather is aggregated into twelve months');
  assert.equal(climate.latitude,-6.2,'representative latitude is retained');
  assert.equal(climate.monthly[0].temperatureMean,26,'monthly temperature is aggregated');
  assert.ok(climate.monthly[0].precipitationMm >= 140 && climate.monthly[0].precipitationMm <= 160,'daily precipitation is aggregated into monthly rainfall');
  assert.equal(climate.monthly[0].windDirection,'E','wind direction is translated to compass direction');
  assert.equal(climate.monthly[0].referenceEt0Mm,93,'daily reference ET0 is aggregated to a monthly total');
  assert.equal(climate.monthly[0].waterBalanceMm,62,'monthly rain-minus-ET0 balance is calculated from averaged rain and ET0 totals');
  assert.match(climateRequestUrl,/archive-api\.open-meteo\.com\/v1\/archive/,'uses the Open-Meteo Historical Weather API');
  const climateParams = new URL(climateRequestUrl).searchParams;
  assert.ok(climateParams.get('daily').includes('wind_gusts_10m_max'),'asks for wind gust information');
  assert.equal(climateParams.get('start_date'),(new Date().getFullYear()-5)+'-01-01','uses five complete calendar years');
  assert.equal(climateParams.get('end_date'),(new Date().getFullYear()-1)+'-12-31','ends at the last complete calendar year');

  // Test country/language-aware plant names against a mocked GBIF response.
  const gbifCalls = [];
  global.fetch = async function (url) {
    const parsed = new URL(String(url));
    gbifCalls.push(parsed.href);
    if (parsed.pathname === '/v1/species/match') {
      return {
        ok:true,status:200,
        text:async function () {
          return JSON.stringify({
            usageKey:2705644,
            key:2705644,
            rank:'SPECIES',
            canonicalName:'Zea mays',
            scientificName:'Zea mays',
            matchType:'EXACT'
          });
        }
      };
    }
    if (parsed.pathname === '/v1/species/2705644/vernacularNames') {
      return {
        ok:true,status:200,
        text:async function () {
          return JSON.stringify({
            results:[
              {vernacularName:'Jagung',language:'id',country:{code:'ID',title:'Indonesia'},source:'Local flora list'},
              {vernacularName:'Corn',language:'en',country:{code:'US',title:'United States'},source:'Checklist'},
              {vernacularName:'Batar',language:'tet',country:{code:'TL',title:'Timor-Leste'},source:'Regional flora'}
            ],
            endOfRecords:true
          });
        }
      };
    }
    return {ok:false,status:404,text:async function(){return JSON.stringify({detail:'Unexpected mocked URL'});}};
  };
  const catalogue = api.getCropCatalog();
  assert.ok(catalogue.some((item) => item.id === 'cashew' && item.scientific === 'Anacardium occidentale'), 'catalogue includes crop species for regional aliases');

  const indonesianMaize = await api.fetchCropTaxonomy('maize','IDN','Indonesia');
  assert.equal(indonesianMaize.englishName,'Maize / Corn','English/common name is retained from crop catalogue');
  assert.equal(indonesianMaize.localName,'Jagung','country and language matching chooses the Indonesian vernacular');
  assert.equal(indonesianMaize.localLanguage,'Indonesian','local language label is exposed');
  assert.equal(indonesianMaize.scientificName,'Zea mays','accepted scientific name is exposed');
  assert.equal(indonesianMaize.status,'matched','GBIF taxon match status is explicit');
  assert.match(indonesianMaize.sourceUrl,/gbif\.org\/species\/2705644/,'taxon source URL is provided');

  const timorMaize = await api.fetchCropTaxonomy('maize','TLS','Timor-Leste');
  assert.equal(timorMaize.localName,'Batar','Timor-Leste preference uses the Tetum vernacular where available');
  assert.equal(timorMaize.localLanguage,'Tetum','the language of the returned vernacular is labelled');
  assert.equal(gbifCalls.filter((url) => new URL(url).pathname === '/v1/species/match').length,1,'scientific matching is cached across selected countries');
  assert.equal(gbifCalls.filter((url) => new URL(url).pathname.endsWith('/vernacularNames')).length,1,'vernacular records are cached across selected countries');


  // Test nearby GBIF occurrence filtering and the public record URL mapper.
  const occurrenceCalls = [];
  global.fetch = async function (url) {
    const parsed = new URL(String(url));
    occurrenceCalls.push(parsed);
    return {
      ok:true,
      status:200,
      text:async function () {
        return JSON.stringify({
          count:3,
          results:[
            {key:111, taxonKey:2705644, scientificName:'Zea mays', vernacularName:'Maize', eventDate:'2025-03-01', decimalLatitude:-6.21, decimalLongitude:106.81, countryCode:'ID', basisOfRecord:'HUMAN_OBSERVATION', datasetName:'Local test dataset'},
            {key:222, taxonKey:12345, scientificName:'Birdus testus', eventDate:'2024-08-10', decimalLatitude:-6.30, decimalLongitude:106.80, countryCode:'ID'},
            {key:333, scientificName:'Too far', decimalLatitude:-6.70, decimalLongitude:106.80}
          ]
        });
      }
    };
  };
  const nearby = await api.fetchGbifOccurrences(-6.2,106.8,25,12);
  assert.equal(nearby.records.length,2,'GBIF records outside the true radius are filtered out');
  assert.equal(nearby.records[0].key,'111','nearby records are sorted by distance');
  assert.equal(nearby.records[0].vernacularName,'Maize','common name is kept when supplied');
  assert.match(nearby.records[0].sourceUrl,/gbif\.org\/occurrence\/111/,'source occurrence URL is supplied');
  assert.ok(occurrenceCalls[0].searchParams.get('decimalLatitude').includes(','),'GBIF is queried with coordinate range filters');
  assert.equal(occurrenceCalls[0].searchParams.get('hasCoordinate'),'true','GBIF query requests georeferenced records');

  // Test the NASA POWER monthly climate mapper with mocked monthly parameter values.
  let nasaRequestUrl = '';
  global.fetch = async function (url) {
    nasaRequestUrl = String(url);
    return {
      ok:true,
      status:200,
      text:async function () {
        return JSON.stringify({
          properties:{
            parameter:{
              T2M:{'202301':20,'202401':22,'202501':24,'202302':25,'202402':27},
              T2M_MIN:{'202301':15,'202401':17,'202501':19,'202302':20,'202402':22},
              T2M_MAX:{'202301':26,'202401':28,'202501':30,'202302':31,'202402':33},
              PRECTOTCORR:{'202301':1,'202401':2,'202501':3,'202302':4,'202402':6},
              ALLSKY_SFC_SW_DWN:{'202301':4,'202401':5,'202501':6,'202302':6,'202402':8}
            }
          }
        });
      }
    };
  };
  const nasa = await api.fetchNasaPowerMonthly(-6.3,106.9,5);
  assert.equal(nasa.monthly.length,12,'NASA POWER returns all twelve calendar months');
  assert.equal(nasa.monthly[0].temperatureMean,22,'January is averaged across available complete years');
  assert.equal(nasa.monthly[0].precipitationRateMmPerDay,2,'precipitation remains labelled as a daily rate');
  assert.equal(nasa.monthly[1].temperatureMean,26,'February monthly values are aggregated across years');
  assert.match(nasaRequestUrl,/power\.larc\.nasa\.gov\/api\/temporal\/monthly\/point/,'NASA POWER monthly endpoint is used');
  const nasaParams = new URL(nasaRequestUrl).searchParams;
  assert.equal(nasaParams.get('community'),'AG','NASA POWER uses its agriculture community');
  assert.equal(nasaParams.get('start'),String(new Date().getFullYear()-5),'NASA POWER uses five complete calendar years');
  assert.equal(nasaParams.get('end'),String(new Date().getFullYear()-1),'NASA POWER excludes the incomplete current year');


  // Plant-only GBIF queries request species-level Plantae records and collapse duplicate observations by taxon.
  const plantCalls = [];
  global.fetch = async function (url) {
    const parsed = new URL(String(url));
    plantCalls.push(parsed);
    return {
      ok:true,
      status:200,
      text:async function () {
        return JSON.stringify({
          count:3,
          results:[
            {key:411,taxonKey:901,scientificName:'Piper betle L.',acceptedScientificName:'Piper betle',taxonRank:'SPECIES',vernacularName:'Betel',eventDate:'2025-03-01',decimalLatitude:-6.21,decimalLongitude:106.81,countryCode:'ID'},
            {key:412,taxonKey:901,scientificName:'Piper betle L.',acceptedScientificName:'Piper betle',taxonRank:'SPECIES',vernacularName:'Betel',eventDate:'2024-04-01',decimalLatitude:-6.22,decimalLongitude:106.82,countryCode:'ID'},
            {key:413,taxonKey:902,scientificName:'Cocos nucifera L.',acceptedScientificName:'Cocos nucifera',taxonRank:'SPECIES',vernacularName:'Coconut',eventDate:'2025-01-01',decimalLatitude:-6.23,decimalLongitude:106.83,countryCode:'ID'}
          ]
        });
      }
    };
  };
  const nearbyPlants = await api.fetchGbifOccurrences(-6.2,106.8,25,20,{plantOnly:true});
  assert.equal(nearbyPlants.records.length,2,'plant-only nearby results collapse repeat records for the same taxon');
  assert.equal(nearbyPlants.records[0].scientificName,'Piper betle','accepted scientific name is preferred when present');
  assert.equal(nearbyPlants.records[0].taxonRank,'SPECIES','taxonomic rank is retained');
  assert.equal(plantCalls[0].searchParams.get('kingdomKey'),'6','plant-only query filters to Plantae');
  assert.equal(plantCalls[0].searchParams.get('taxonRank'),'SPECIES','plant-only query asks for species-level taxa');
  await api.fetchGbifOccurrences(-6.2,106.8,25,20,{plantOnly:true,forceRefresh:true});
  assert.equal(plantCalls.length,2,'forceRefresh bypasses the session cache');


  // Test the public iNaturalist plant-observation mapper and taxon de-duplication.
  const inatCalls = [];
  global.fetch = async function (url) {
    const parsed = new URL(String(url));
    inatCalls.push(parsed);
    return {
      ok:true,status:200,
      text:async function () {
        return JSON.stringify({
          total_results:3,
          results:[
            {id:801,observed_on:'2025-06-01',place_guess:'Sample place',quality_grade:'research',user:{login:'observer1'},latitude:'-6.21',longitude:'106.81',taxon:{id:991,name:'Piper betle',preferred_common_name:'Betel',rank:'species'}},
            {id:802,observed_on:'2024-05-01',place_guess:'Sample place',quality_grade:'research',latitude:'-6.22',longitude:'106.82',taxon:{id:991,name:'Piper betle',preferred_common_name:'Betel',rank:'species'}},
            {id:803,observed_on:'2025-01-01',latitude:'-6.23',longitude:'106.83',taxon:{id:992,name:'Cocos nucifera',preferred_common_name:'Coconut',rank:'species'}}
          ]
        });
      }
    };
  };
  const inat = await api.fetchINaturalistPlantObservations(-6.2,106.8,25,8,false);
  assert.equal(inat.records.length,2,'iNaturalist returns distinct plant taxa rather than repeated observations');
  assert.equal(inat.records[0].scientificName,'Piper betle','iNaturalist plant scientific name is mapped');
  assert.equal(inat.records[0].observer,'observer1','observer credit is retained');
  assert.equal(inatCalls[0].searchParams.get('taxon_id'),'47126','iNaturalist query filters to Plantae');
  assert.equal(inatCalls[0].searchParams.get('quality_grade'),'research','iNaturalist query requests research-grade observations');
  await api.fetchINaturalistPlantObservations(-6.2,106.8,25,8,true);
  assert.equal(inatCalls.length,2,'iNaturalist supports explicit refresh around the page cache');

  // Test the keyless Open-Meteo seven-day agricultural forecast mapper.
  let outlookRequestUrl='';
  global.fetch = async function (url) {
    outlookRequestUrl=String(url);
    return {ok:true,status:200,text:async function(){return JSON.stringify({
      timezone:'Asia/Jakarta',
      daily:{
        time:['2026-10-21','2026-10-22'],
        temperature_2m_mean:[28,29],
        temperature_2m_min:[24,25],
        temperature_2m_max:[32,33],
        precipitation_sum:[6,1],
        et0_fao_evapotranspiration:[4,5]
      },
      hourly:{
        time:['2026-10-21T00:00','2026-10-21T01:00','2026-10-22T00:00','2026-10-22T01:00'],
        soil_moisture_0_to_7cm:[0.20,0.24,0.30,0.32],
        soil_temperature_0_to_7cm:[25,27,26,28],
        vapour_pressure_deficit:[0.8,1.0,0.5,0.7]
      }
    });}};
  };
  const outlook = await api.fetchOpenMeteoAgroOutlook(-6.2,106.8,true);
  assert.equal(outlook.days.length,2,'Open-Meteo outlook maps daily forecast rows');
  assert.equal(outlook.days[0].waterBalanceMm,2,'forecast rain-minus-ET0 balance is explicit');
  assert.equal(outlook.days[0].soilMoistureTopM3M3,0.22,'hourly soil moisture is averaged by local forecast day');
  assert.equal(outlook.days[0].soilTemperatureTopC,26,'hourly topsoil temperature is averaged by day');
  assert.equal(outlook.days[0].vapourPressureDeficitKpa,0.9,'hourly vapour pressure deficit is averaged by day');
  assert.match(outlookRequestUrl,/api\.open-meteo\.com\/v1\/forecast/,'Open-Meteo forecast endpoint is used');
  assert.ok(new URL(outlookRequestUrl).searchParams.get('daily').includes('et0_fao_evapotranspiration'),'outlook asks for reference ET0');
  assert.ok(new URL(outlookRequestUrl).searchParams.get('hourly').includes('soil_moisture_0_to_7cm'),'outlook asks for modelled topsoil moisture');

  // Pl@ntNet must reject missing user credentials before attempting any network request.
  await assert.rejects(() => api.identifyPlantWithPlantNet([], '', 'auto'), /API key/i, 'Pl@ntNet never uses a hard-coded shared key');
  await assert.rejects(() => api.identifyPlantWithPlantNet([], 'user-key', 'auto'), /1–5 photos/i, 'Pl@ntNet requires one to five plant photos');


  // WaPOR v3 catalog is a public metadata API; no token is attached and only useful global mapsets are presented.
  let waporRequestUrl='';
  global.fetch = async function (url) {
    waporRequestUrl=String(url);
    return {
      ok:true,status:200,
      text:async function(){return JSON.stringify({
        response:{
          items:[
            {code:'L1-AETI-D',caption:'Actual EvapoTranspiration and Interception (Global - Dekadal - 300m)'},
            {code:'L1-RET-M',caption:'Reference Evapotranspiration (Global - Monthly - 30km)'},
            {code:'L1-RSM-D',caption:'Relative Soil Moisture (Global - Dekadal - 300m)'},
            {code:'L2-AETI-D',caption:'National AETI (regional availability)'},
            {caption:'Record without a code'}
          ],
          links:[]
        }
      });}
    };
  };
  const wapor=await api.fetchWaporMapsets(true);
  assert.equal(wapor.records.length,3,'WaPOR catalogue keeps only curated global water/productivity mapsets');
  assert.ok(wapor.records.some((item)=>item.code==='L1-AETI-D'&&item.resolutionNote==='Approximately 300 m'),'AETI global resolution metadata is retained');
  assert.ok(wapor.records.some((item)=>item.code==='L1-RET-M'&&item.resolutionNote==='Approximately 30 km'),'RET resolution is described separately');
  assert.match(waporRequestUrl,/data\.apps\.fao\.org\/gismgr\/api\/v2\/catalog\/workspaces\/WAPOR-3\/mapsets/,'public WaPOR v3 catalog endpoint is used');
  assert.ok(!/token|authorization/i.test(waporRequestUrl),'WaPOR v3 catalog request does not attach credentials');
  assert.match(wapor.records[0].apiUrl,/\/rasters\?overview=false&paged=false/,'each mapset exposes the official raster metadata link');


  // Country-specific source registry keeps Indonesian national sources scoped to Indonesia.
  const idnSources = api.getCountrySourceCatalog('IDN','Indonesia');
  assert.ok(idnSources.some((source)=>/BPS/.test(source.title)),'Indonesia registry includes BPS');
  assert.ok(idnSources.some((source)=>/Kementerian Pertanian/.test(source.title)),'Indonesia registry includes Kementan');
  assert.ok(!api.getCountrySourceCatalog('USA','United States').some((source)=>/BPS|Kementerian Pertanian/.test(source.title)),'Indonesia-only institutions are absent for the US');
  const canadaSources = api.getCountrySourceCatalog('CAN','Canada');
  assert.ok(canadaSources.some((source)=>/Statistics Canada Web Data Service/.test(source.title)&&/no API key/i.test(source.access)),'Canada receives a reviewed public Statistics Canada API');
  const germanySources = api.getCountrySourceCatalog('DEU','Germany');
  assert.ok(germanySources.some((source)=>/Eurostat/.test(source.title)&&source.apiUrl.includes('geo=DE')),'EU countries receive a country-filtered Eurostat API URL');
  assert.equal(api.getCountrySourceCatalog('XYZ','Example').length,0,'unreviewed countries do not receive fabricated national API records');

  // World Bank API data are requested for the selected ISO-3 country and can return partial series.
  const wbCalls = [];
  global.fetch = async function (url) {
    wbCalls.push(String(url));
    const match=String(url).match(/indicator\/([^?]+)/);
    const code=match?decodeURIComponent(match[1]):'';
    const valueMap={'AG.LND.AGRI.ZS':48.1,'AG.YLD.CREL.KG':5320,'AG.PRD.CROP.XD':121.4,'NV.AGR.TOTL.ZS':12.3};
    return {
      ok:true,status:200,
      text:async function(){return JSON.stringify([{page:1},[{date:'2024',value:valueMap[code],indicator:{id:code},country:{id:'IDN'}}]]);}
    };
  };
  const wbSnapshot = await api.fetchWorldBankAgricultureSnapshot('IDN',true);
  assert.equal(wbSnapshot.indicators.length,4,'World Bank snapshot requests four agriculture indicator series');
  assert.equal(wbSnapshot.indicators.find((item)=>item.id==='AG.YLD.CREL.KG').value,5320,'World Bank cereal yield is mapped');
  assert.ok(wbCalls.every((url)=>url.includes('/country/IDN/indicator/')),'World Bank API queries are scoped to the selected ISO-3 country');

  // FAO FPMA is a public no-key API; check selected-country filtering and price trend mapping.
  const fpmaCalls = [];
  global.fetch = async function (url, options) {
    const urlText = String(url);
    fpmaCalls.push({url:urlText,headers:options && options.headers || {}});
    if (urlText.includes('/FpmaSeriePrice/')) {
      return {
        ok:true,status:200,
        text:async function(){return JSON.stringify({results:[{uuid:'series-rice',datapoints:[
          {date:'2024-01-01',price_value:100,price_value_dollar:0.7},
          {date:'2024-02-01',price_value:110,price_value_dollar:0.75},
          {date:'2024-04-01',price_value:125,price_value_dollar:0.82}
        ]}]});}
      };
    }
    return {
      ok:true,status:200,
      text:async function(){return JSON.stringify({count:1,next:null,results:[{
        uuid:'series-rice',iso3_country_code:'IDN',commodity:'Rice',price_type:'RETAIL',
        currency:'IDR',measure_unit_label:'kg',periodicity:[{period:'monthly'}]
      }]});}
    };
  };
  const fpma = await api.fetchFaoFoodPrices('IDN','rice');
  assert.equal(fpma.series.length,1,'FAO FPMA connector maps one matching country/commodity series');
  assert.equal(fpma.series[0].commodity,'Rice','FAO FPMA commodity metadata is preserved');
  assert.equal(fpma.series[0].latest.value,125,'FAO FPMA latest price point is selected');
  assert.ok(fpma.series[0].changePct90d > 0,'FAO FPMA computes a descriptive 90-day price change');
  assert.ok(fpmaCalls.every((call)=>call.url.includes('iso3_country_codes=IDN') || call.url.includes('/FpmaSeriePrice/')),'FAO FPMA metadata request is country-filtered');
  assert.ok(fpmaCalls.every((call)=>!/apikey|authorization|token/i.test(call.url+' '+JSON.stringify(call.headers))),'FAO FPMA uses no API key or authorization header');

  global.fetch = originalFetch;
  console.log('Crop, taxonomy, vernacular-name, planting-window, climate, GBIF occurrence, nearby plant species, iNaturalist, NASA POWER, Open-Meteo outlook, ET0, WaPOR catalog, country-specific API registry, World Bank agriculture snapshot, keyless FAO FPMA food-price API and Pl@ntNet validation smoke tests passed.');
}

main().catch((error) => {
  global.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
