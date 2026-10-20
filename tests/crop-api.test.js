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
      wind_direction_10m_dominant: values(90)
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

  global.fetch = originalFetch;
  console.log('Crop, taxonomy, vernacular-name, planting-window, climate, GBIF occurrence, nearby plant species and NASA POWER smoke tests passed.');
}

main().catch((error) => {
  global.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
