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

  global.fetch = originalFetch;
  console.log('Crop API smoke tests passed.');
}

main().catch((error) => {
  global.fetch = originalFetch;
  console.error(error);
  process.exitCode = 1;
});
