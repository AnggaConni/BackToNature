const assert = require('node:assert/strict');
const fieldLog = require('../field-log.js');

const sample = [{
  id: 'plot-test-1',
  plotName: 'North plot <trial>',
  observationDate: '2026-10-21',
  regionName: 'Example District, Indonesia',
  observerName: 'Field Team',
  latitude: '-6.2',
  longitude: '106.8',
  soilTexture: 'Loam',
  soilPh: '5.8',
  drainage: 'Moderate',
  waterSource: 'Rain-fed',
  landCover: 'Annual cropland',
  cropSpecies: 'Rice',
  activity: 'Soil sampling',
  notes: 'First line, with comma.\nSecond line says "check drainage". <script>alert(1)</script>',
  photos: [{
    name: 'soil-photo.jpg',
    type: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,AAAA',
    size: 3
  }],
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:05:00.000Z'
}];

assert.equal(fieldLog.escapeHtml('<tag "x">'), '&lt;tag &quot;x&quot;&gt;');
assert.equal(fieldLog.csvCell('say "hello", world'), '"say ""hello"", world"');
assert.equal(fieldLog.isValidCoordinates('-6.2', '106.8'), true);
assert.equal(fieldLog.isValidCoordinates('91', '106.8'), false);
assert.equal(fieldLog.isValidCoordinates('-6.2', ''), false);

const csv = fieldLog.buildCSV(sample);
assert.ok(csv.startsWith('\uFEFF'), 'CSV includes UTF-8 BOM for spreadsheet compatibility');
assert.match(csv, /North plot <trial>/, 'CSV contains the site name');
assert.match(csv, /soil-photo\.jpg/, 'CSV contains photo filenames rather than image bytes');
assert.match(csv, /"First line, with comma\./, 'CSV wraps multiline values and commas safely');

const backup = fieldLog.makeBackup(sample);
assert.equal(backup.format, 'BackToNature My Plot Field Log');
assert.equal(backup.version, 1);
assert.equal(backup.entries[0].photos[0].dataUrl, 'data:image/jpeg;base64,AAAA', 'JSON backup keeps the photo bytes');

const html = fieldLog.buildReportHTML(sample);
assert.match(html, /contenteditable="true"/, 'report body is editable in the new tab');
assert.match(html, /Download Word \(\.doc\)/, 'report provides Word export');
assert.match(html, /Print \/ Save PDF/, 'report provides PDF print flow');
assert.match(html, /Download JSON backup/, 'report provides JSON backup');
assert.match(html, /Download CSV/, 'report provides CSV export');
assert.match(html, /Download edited HTML/, 'report can be saved as editable HTML');
assert.match(html, /North plot &lt;trial&gt;/, 'report escapes user text rather than treating it as markup');
assert.match(html, /data:image\/jpeg;base64,AAAA/, 'report embeds compressed photos');
assert.doesNotMatch(html, /<main[^>]*>.*<script>alert\(1\)<\/script>/s, 'notes cannot inject executable markup into the report');

const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(inlineScript, 'report export script is present');
assert.doesNotThrow(() => new Function(inlineScript[1]), 'report export toolbar script parses');

console.log('My Plot Field Log helper, CSV/JSON export, editable report and export-toolbar smoke tests passed.');
