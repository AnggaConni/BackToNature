(function (root) {
  'use strict';

  var DB_NAME = 'backtonature-my-plot-field-log';
  var DB_VERSION = 1;
  var STORE_NAME = 'entries';
  var dbPromise = null;
  var MAX_PHOTOS = 6;
  var activePhotos = [];
  var loadedEntries = [];
  var editingOriginal = null;

  var REPORT_STYLES = [
    'body{margin:0;background:#f3f1e8;color:#263126;font:14px/1.55 Arial,Helvetica,sans-serif}',
    '.report-toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;background:#263d2a;color:#fff8e3;border-bottom:4px solid #b79a62;box-shadow:0 3px 9px #0002}',
    '.report-toolbar button{border:1px solid #a9c18d;border-radius:6px;padding:9px 12px;background:#557a42;color:white;font-weight:700;cursor:pointer}',
    '.report-toolbar button.secondary{background:#fff4d6;color:#3c392e;border-color:#c4b58b}',
    '.report-help{max-width:1000px;margin:14px auto;padding:0 20px;color:#596652;font-size:12px}',
    '#report-content{max-width:1000px;margin:0 auto 38px;background:white;padding:clamp(18px,4vw,42px);border:1px solid #d5d1c1;box-shadow:0 6px 24px #0001;outline-offset:4px}',
    '#report-content:focus{outline:2px dashed #73905d}',
    '.report-title{border-bottom:3px solid #668651;padding-bottom:18px;margin-bottom:22px}',
    '.report-title .eyebrow{letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#5b7549;font-size:11px}',
    '.report-title h1{font-size:32px;line-height:1.15;margin:6px 0;color:#2e462e}',
    '.report-title p{margin:5px 0;color:#64705e}',
    '.entry{margin:25px 0 32px;padding-bottom:25px;border-bottom:2px solid #e7e2d4;break-inside:avoid}',
    '.entry h2{font-size:23px;margin:0;color:#2e462e;overflow-wrap:anywhere}',
    '.entry-meta{color:#64705e;font-size:12px;margin:5px 0 12px}',
    '.entry table{width:100%;border-collapse:collapse;margin:10px 0;table-layout:fixed}',
    '.entry th,.entry td{border:1px solid #d6d6c8;padding:7px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}',
    '.entry th{width:28%;background:#edf2e7;color:#35482f}',
    '.entry td{white-space:pre-wrap}',
    '.notes{white-space:pre-wrap;overflow-wrap:anywhere;background:#faf8ef;padding:10px;border-left:3px solid #86a36a;min-height:20px}',
    '.photos{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}',
    '.photos figure{margin:0;width:min(230px,46%)}',
    '.photos img{width:100%;max-height:250px;object-fit:contain;border:1px solid #d7d0bd;background:#faf8ef}',
    '.photos figcaption{font-size:11px;color:#64705e;overflow-wrap:anywhere}',
    '.map-link{color:#245d88}',
    '.empty{padding:22px;border:1px dashed #b9c4ad;background:#f5f8f0;color:#586753}',
    '.method-note{margin-top:26px;font-size:12px;color:#64705e;border-top:1px solid #ddd8c8;padding-top:12px}',
    '[contenteditable=true]{cursor:text}',
    '@media print{body{background:white;font-size:11pt}.report-toolbar,.report-help{display:none!important}#report-content{max-width:none;margin:0;border:0;box-shadow:none;padding:0}.entry{break-inside:avoid}.entry h2{break-after:avoid}a{color:inherit;text-decoration:none}.photos img{max-height:180px}}',
    '@media(max-width:640px){#report-content{padding:17px;margin:0 8px 24px}.report-title h1{font-size:26px}.entry th{width:34%}.report-toolbar button{flex:1}}'
  ].join('');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeImageDataUrl(value) {
    return typeof value === 'string' && /^data:image\/(?:jpeg|jpg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value);
  }

  function makeId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'plot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function normalizeEntry(input) {
    input = input && typeof input === 'object' ? input : {};
    var photos = Array.isArray(input.photos) ? input.photos.slice(0, MAX_PHOTOS).map(function (photo) {
      photo = photo && typeof photo === 'object' ? photo : {};
      if (!safeImageDataUrl(photo.dataUrl)) return null;
      return {
        name: String(photo.name || 'field-photo.jpg').slice(0, 240),
        type: 'image/jpeg',
        dataUrl: photo.dataUrl,
        size: Number(photo.size) || 0
      };
    }).filter(Boolean) : [];
    return {
      id: String(input.id || makeId()).slice(0, 120),
      plotName: String(input.plotName || '').slice(0, 120),
      observationDate: String(input.observationDate || '').slice(0, 20),
      regionName: String(input.regionName || '').slice(0, 180),
      observerName: String(input.observerName || '').slice(0, 120),
      latitude: input.latitude == null ? '' : String(input.latitude).slice(0, 40),
      longitude: input.longitude == null ? '' : String(input.longitude).slice(0, 40),
      soilTexture: String(input.soilTexture || '').slice(0, 100),
      soilPh: input.soilPh == null ? '' : String(input.soilPh).slice(0, 10),
      drainage: String(input.drainage || '').slice(0, 100),
      waterSource: String(input.waterSource || '').slice(0, 120),
      landCover: String(input.landCover || '').slice(0, 140),
      cropSpecies: String(input.cropSpecies || '').slice(0, 180),
      activity: String(input.activity || '').slice(0, 180),
      notes: String(input.notes || '').slice(0, 8000),
      photos: photos,
      createdAt: String(input.createdAt || new Date().toISOString()).slice(0, 40),
      updatedAt: String(input.updatedAt || new Date().toISOString()).slice(0, 40)
    };
  }

  function csvCell(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function buildCSV(entries) {
    var headers = [
      'Record ID','Observation date','Plot / site','Region','Observer','Latitude','Longitude',
      'Soil texture','Measured pH','Drainage','Water source','Land cover / use','Crop / species',
      'Activity / intervention','Field notes','Photo count','Photo file names','Created at','Updated at'
    ];
    var rows = [headers];
    (Array.isArray(entries) ? entries : []).forEach(function (raw) {
      var entry = normalizeEntry(raw);
      rows.push([
        entry.id,entry.observationDate,entry.plotName,entry.regionName,entry.observerName,entry.latitude,entry.longitude,
        entry.soilTexture,entry.soilPh,entry.drainage,entry.waterSource,entry.landCover,entry.cropSpecies,
        entry.activity,entry.notes,entry.photos.length,entry.photos.map(function (p) { return p.name; }).join('; '),
        entry.createdAt,entry.updatedAt
      ]);
    });
    return '\uFEFF' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
  }

  function makeBackup(entries) {
    return {
      format: 'BackToNature My Plot Field Log',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: (Array.isArray(entries) ? entries : []).map(normalizeEntry)
    };
  }

  function safeJsonForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }

  function valueOrUnknown(value) {
    return value ? escapeHtml(value) : '<span class="muted">Not recorded</span>';
  }

  function coordinateLink(entry) {
    var lat = Number(entry.latitude);
    var lon = Number(entry.longitude);
    if (entry.latitude === '' || entry.longitude === '' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) return valueOrUnknown('');
    var url = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) +
      '&mlon=' + encodeURIComponent(lon) + '#map=16/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lon);
    return escapeHtml(entry.latitude) + ', ' + escapeHtml(entry.longitude) +
      ' · <a class="map-link" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">Open map ↗</a>';
  }

  function renderReportEntry(raw, index) {
    var entry = normalizeEntry(raw);
    var metadata = [entry.observationDate, entry.regionName, entry.observerName ? 'Observer: ' + entry.observerName : '']
      .filter(Boolean).map(escapeHtml).join(' · ');
    var rows = [
      ['GPS coordinates', coordinateLink(entry)],
      ['Soil texture', valueOrUnknown(entry.soilTexture)],
      ['Measured soil pH', valueOrUnknown(entry.soilPh)],
      ['Drainage / wetness', valueOrUnknown(entry.drainage)],
      ['Water source', valueOrUnknown(entry.waterSource)],
      ['Land cover / use', valueOrUnknown(entry.landCover)],
      ['Crop / species', valueOrUnknown(entry.cropSpecies)],
      ['Activity / intervention', valueOrUnknown(entry.activity)]
    ];
    var table = '<table><tbody>' + rows.map(function (row) {
      return '<tr><th>' + row[0] + '</th><td>' + row[1] + '</td></tr>';
    }).join('') + '</tbody></table>';
    var photos = entry.photos.map(function (photo) {
      if (!safeImageDataUrl(photo.dataUrl)) return '';
      return '<figure><img src="' + photo.dataUrl + '" alt="' + escapeHtml(photo.name) + '"><figcaption>' +
        escapeHtml(photo.name) + '</figcaption></figure>';
    }).join('');
    return '<article class="entry"><h2>' + (index + 1) + '. ' + escapeHtml(entry.plotName || 'Unnamed plot') + '</h2>' +
      '<p class="entry-meta">' + (metadata || 'Observation details not recorded') + '</p>' + table +
      '<h3>Field notes / observations</h3><div class="notes">' + valueOrUnknown(entry.notes) + '</div>' +
      (photos ? '<h3>Field photos</h3><div class="photos">' + photos + '</div>' : '') + '</article>';
  }

  function reportToolbarScript(entries) {
    var data = safeJsonForScript(makeBackup(entries));
    var styles = JSON.stringify(REPORT_STYLES);
    return '<script>' +
      'window.BTN_FIELD_LOG_BACKUP=' + data + ';' +
      'var btnReportStyles=' + styles + ';' +
      'function btnDownload(content,mime,name){var blob=new Blob([content],{type:mime});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1500);}' +
      'function btnCsvCell(value){var quote=String.fromCharCode(34);return quote+String(value==null?"":value).replace(/"/g,quote+quote)+quote;}' +
      'function btnMakeCSV(){var h=["Record ID","Observation date","Plot / site","Region","Observer","Latitude","Longitude","Soil texture","Measured pH","Drainage","Water source","Land cover / use","Crop / species","Activity / intervention","Field notes","Photo count","Photo file names","Created at","Updated at"];var rows=[h];(window.BTN_FIELD_LOG_BACKUP.entries||[]).forEach(function(e){var p=Array.isArray(e.photos)?e.photos:[];rows.push([e.id,e.observationDate,e.plotName,e.regionName,e.observerName,e.latitude,e.longitude,e.soilTexture,e.soilPh,e.drainage,e.waterSource,e.landCover,e.cropSpecies,e.activity,e.notes,p.length,p.map(function(x){return x.name;}).join("; "),e.createdAt,e.updatedAt]);});return String.fromCharCode(65279)+rows.map(function(r){return r.map(btnCsvCell).join(",");}).join(String.fromCharCode(13,10));}' +
      'function btnToday(){return new Date().toISOString().slice(0,10);}' +
      'document.getElementById("word-btn").addEventListener("click",function(){var html="<!doctype html><html lang=\\"en\\"><head><meta charset=\\"utf-8\\"><style>"+btnReportStyles+"</style></head><body>"+document.getElementById("report-content").innerHTML+"</body></html>";btnDownload(html,"application/msword","backtonature-field-report-"+btnToday()+".doc");});' +
      'document.getElementById("pdf-btn").addEventListener("click",function(){window.print();});' +
      'document.getElementById("json-btn").addEventListener("click",function(){btnDownload(JSON.stringify(window.BTN_FIELD_LOG_BACKUP,null,2),"application/json;charset=utf-8","backtonature-field-log-"+btnToday()+".json");});' +
      'document.getElementById("csv-btn").addEventListener("click",function(){btnDownload(btnMakeCSV(),"text/csv;charset=utf-8","backtonature-field-log-"+btnToday()+".csv");});' +
      'document.getElementById("html-btn").addEventListener("click",function(){btnDownload("<!doctype html>\\n"+document.documentElement.outerHTML,"text/html;charset=utf-8","backtonature-field-report-"+btnToday()+".html");});' +
      'document.getElementById("edit-hint").textContent="Click inside the report to edit text. Word, PDF and HTML exports capture those document edits; JSON and CSV export the original structured field records. Edit records in My Plot Field Log, then generate a new report to refresh the structured export."; ' +
      '</script>';
  }

  function buildReportHTML(entries) {
    var normalized = (Array.isArray(entries) ? entries : []).map(normalizeEntry);
    var recordsHtml = normalized.length ? normalized.map(renderReportEntry).join('') :
      '<div class="empty">There are no field observations in this report yet. Return to My Plot Field Log and save a record first.</div>';
    var dateText = new Date().toLocaleString();
    var content = '<div class="report-title"><div class="eyebrow">BackToNature · Living Land Lab</div>' +
      '<h1>My Plot Field Report</h1><p>Field observations, soil and water notes, GPS coordinates, and photographs.</p>' +
      '<p><strong>Records:</strong> ' + normalized.length + ' · <strong>Generated:</strong> ' + escapeHtml(dateText) + '</p></div>' +
      recordsHtml +
      '<div class="method-note"><strong>Method and interpretation note.</strong> These are user-entered field observations. Values are not independently verified. Soil pH is reported only as entered by the observer; do not treat unmeasured or blank values as zero. Confirm management decisions with locally appropriate expertise and tests. Images and GPS coordinates may contain sensitive site information.</div>';
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Editable My Plot Field Report · BackToNature</title><style>' + REPORT_STYLES + '</style></head><body>' +
      '<nav class="report-toolbar" aria-label="Export report tools">' +
      '<button type="button" id="word-btn">Download Word (.doc)</button>' +
      '<button type="button" id="pdf-btn">Print / Save PDF</button>' +
      '<button type="button" id="json-btn" class="secondary">Download JSON backup</button>' +
      '<button type="button" id="csv-btn" class="secondary">Download CSV</button>' +
      '<button type="button" id="html-btn" class="secondary">Download edited HTML</button>' +
      '</nav><p id="edit-hint" class="report-help" contenteditable="false">This report is editable. Click into the report body and type to revise the document before exporting.</p>' +
      '<main id="report-content" contenteditable="true" spellcheck="true">' + content + '</main>' +
      reportToolbarScript(normalized) + '</body></html>';
    return html;
  }

  function requestToPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed.')); };
    });
  }

  function openDatabase() {
    if (!root.indexedDB) return Promise.reject(new Error('This browser does not support local IndexedDB storage.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Could not open the local field log database.')); };
      request.onblocked = function () { reject(new Error('The field log database is busy in another tab. Close other BackToNature field-log tabs and retry.')); };
    });
    return dbPromise;
  }

  function storeRequest(mode, action) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction;
        try {
          transaction = database.transaction(STORE_NAME, mode);
          var request = action(transaction.objectStore(STORE_NAME));
          var output;
          request.onsuccess = function () { output = request.result; };
          request.onerror = function () { reject(request.error || new Error('Field log storage operation failed.')); };
          transaction.oncomplete = function () { resolve(output); };
          transaction.onerror = function () { reject(transaction.error || new Error('Field log transaction failed.')); };
          transaction.onabort = function () { reject(transaction.error || new Error('Field log transaction was cancelled.')); };
        } catch (error) { reject(error); }
      });
    });
  }

  function getAllEntries() {
    return storeRequest('readonly', function (store) { return store.getAll(); }).then(function (entries) {
      return (entries || []).map(normalizeEntry).sort(function (a, b) {
        return String(b.observationDate).localeCompare(String(a.observationDate)) ||
          String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
    });
  }

  function saveEntry(entry) {
    return storeRequest('readwrite', function (store) { return store.put(normalizeEntry(entry)); });
  }

  function deleteEntry(id) {
    return storeRequest('readwrite', function (store) { return store.delete(id); });
  }

  function fileToDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read photo: ' + file.name)); };
      reader.readAsDataURL(file);
    });
  }

  function imageFromDataURL(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The selected file is not a readable image.')); };
      image.src = dataUrl;
    });
  }

  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not prepare the compressed photo.')); };
      reader.readAsDataURL(blob);
    });
  }

  async function compressPhoto(file) {
    if (!file || !/^image\//i.test(file.type || '')) throw new Error('Only image files can be attached.');
    var originalData = await fileToDataURL(file);
    var image = await imageFromDataURL(originalData);
    var maxEdge = 1440;
    var scale = Math.min(1, maxEdge / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    var width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    var height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext('2d');
    if (!context) throw new Error('Photo compression is not available in this browser.');
    context.drawImage(image, 0, 0, width, height);
    var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.78); });
    if (!blob) throw new Error('Could not compress photo: ' + file.name);
    return { name: String(file.name || 'field-photo.jpg').slice(0, 240), type: 'image/jpeg', dataUrl: await blobToDataURL(blob), size: blob.size };
  }

  function isValidCoordinates(latitude, longitude) {
    if (latitude === '' || longitude === '') return false;
    var lat = Number(latitude), lon = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  // Keep pure helpers available to offline Node smoke tests.
  var exported = {
    escapeHtml: escapeHtml,
    csvCell: csvCell,
    buildCSV: buildCSV,
    makeBackup: makeBackup,
    normalizeEntry: normalizeEntry,
    buildReportHTML: buildReportHTML,
    isValidCoordinates: isValidCoordinates
  };
  root.BackToNatureFieldLog = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (typeof document === 'undefined') return;

  function byId(id) { return document.getElementById(id); }

  function setStatus(message, isError) {
    var node = byId('form-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'status' + (isError ? ' error' : '');
  }

  function setDefaultDate() {
    var now = new Date();
    var localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    byId('observation-date').value = localDate;
  }

  function renderPhotoPreviews() {
    var container = byId('photo-preview');
    if (!container) return;
    container.innerHTML = '';
    if (!activePhotos.length) {
      container.innerHTML = '<div class="hint">No saved photos attached to this record.</div>';
      return;
    }
    activePhotos.forEach(function (photo, index) {
      var item = document.createElement('div');
      item.className = 'photo-item';
      var image = document.createElement('img');
      image.src = photo.dataUrl;
      image.alt = photo.name || 'Field photo';
      var name = document.createElement('small');
      name.textContent = photo.name || 'field-photo.jpg';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove photo ' + (index + 1));
      remove.addEventListener('click', function () {
        activePhotos.splice(index, 1);
        renderPhotoPreviews();
        updatePhotoStatus();
      });
      item.appendChild(image);
      item.appendChild(name);
      item.appendChild(remove);
      container.appendChild(item);
    });
  }

  function updatePhotoStatus() {
    var input = byId('photo-files');
    var newCount = input && input.files ? input.files.length : 0;
    var node = byId('photo-selection-status');
    if (node) node.textContent = activePhotos.length + ' saved photo(s) retained; ' + newCount +
      ' new photo(s) selected. Up to ' + MAX_PHOTOS + ' photos per record. New photos are compressed before saving.';
  }

  function resetForm() {
    byId('field-log-form').reset();
    byId('entry-id').value = '';
    activePhotos = [];
    editingOriginal = null;
    setDefaultDate();
    renderPhotoPreviews();
    updatePhotoStatus();
    byId('form-heading').textContent = '📝 New field observation';
    byId('save-btn').textContent = 'Save observation';
    byId('cancel-edit-btn').hidden = true;
    setStatus('Form cleared. Your saved records are unchanged.');
  }

  function formValue(id) {
    var node = byId(id);
    return node ? String(node.value || '').trim() : '';
  }

  function readFormRecord() {
    return {
      id: formValue('entry-id') || makeId(),
      plotName: formValue('plot-name'),
      observationDate: formValue('observation-date'),
      regionName: formValue('region-name'),
      observerName: formValue('observer-name'),
      latitude: formValue('latitude'),
      longitude: formValue('longitude'),
      soilTexture: formValue('soil-texture'),
      soilPh: formValue('soil-ph'),
      drainage: formValue('drainage'),
      waterSource: formValue('water-source'),
      landCover: formValue('land-cover'),
      cropSpecies: formValue('crop-species'),
      activity: formValue('activity'),
      notes: formValue('notes')
    };
  }

  function makeMapUrl(entry) {
    if (!isValidCoordinates(entry.latitude, entry.longitude)) return '';
    return 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(entry.latitude) +
      '&mlon=' + encodeURIComponent(entry.longitude) + '#map=16/' +
      encodeURIComponent(entry.latitude) + '/' + encodeURIComponent(entry.longitude);
  }

  function renderEntryCard(raw) {
    var entry = normalizeEntry(raw);
    var card = document.createElement('article');
    card.className = 'record-card';
    var firstPhoto = entry.photos.length && safeImageDataUrl(entry.photos[0].dataUrl)
      ? '<img class="record-preview-photo" src="' + entry.photos[0].dataUrl + '" alt="' + escapeHtml(entry.photos[0].name) + '">'
      : '';
    var tags = [
      entry.soilTexture ? '<span class="tag">' + escapeHtml(entry.soilTexture) + '</span>' : '',
      entry.soilPh !== '' ? '<span class="tag">pH ' + escapeHtml(entry.soilPh) + '</span>' : '',
      entry.landCover ? '<span class="tag">' + escapeHtml(entry.landCover) + '</span>' : '',
      entry.photos.length ? '<span class="tag">📷 ' + entry.photos.length + ' photo(s)</span>' : ''
    ].filter(Boolean).join('');
    var regionLine = [entry.observationDate, entry.regionName, entry.observerName].filter(Boolean).map(escapeHtml).join(' · ');
    var coordLine = isValidCoordinates(entry.latitude, entry.longitude)
      ? '<p>📍 ' + escapeHtml(entry.latitude) + ', ' + escapeHtml(entry.longitude) +
        ' · <a href="' + escapeHtml(makeMapUrl(entry)) + '" target="_blank" rel="noopener noreferrer">Open map ↗</a></p>'
      : '';
    card.innerHTML = '<div class="record-top"><div><h3>' + escapeHtml(entry.plotName || 'Unnamed plot') + '</h3>' +
      '<div class="record-meta">' + (regionLine || 'No location details recorded') + '</div></div>' + firstPhoto + '</div>' +
      '<div class="record-tags">' + tags + '</div>' +
      (entry.activity ? '<p><strong>Activity:</strong> ' + escapeHtml(entry.activity) + '</p>' : '') +
      (entry.notes ? '<p>' + escapeHtml(entry.notes.length > 260 ? entry.notes.slice(0, 260) + '…' : entry.notes) + '</p>' : '') +
      coordLine + '<div class="record-actions"><button class="btn small" data-action="edit" type="button">Edit</button>' +
      '<button class="btn small danger" data-action="delete" type="button">Delete</button></div>';
    card.querySelector('[data-action="edit"]').addEventListener('click', function () { beginEdit(entry.id); });
    card.querySelector('[data-action="delete"]').addEventListener('click', function () { removeEntry(entry.id); });
    return card;
  }

  function renderRecords() {
    var list = byId('records-list');
    if (!list) return;
    var query = formValue('record-search').toLowerCase();
    var filtered = loadedEntries.filter(function (entry) {
      var blob = [entry.plotName,entry.regionName,entry.observerName,entry.cropSpecies,entry.activity,entry.notes,
        entry.soilTexture,entry.landCover].join(' ').toLowerCase();
      return !query || blob.indexOf(query) !== -1;
    });
    byId('records-count').textContent = '(' + loadedEntries.length + ')';
    list.innerHTML = '';
    if (!loadedEntries.length) {
      list.innerHTML = '<div class="empty-state">No field observations yet. Add the first record using the form.</div>';
      return;
    }
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state">No records matched that search. Try another keyword.</div>';
      return;
    }
    filtered.forEach(function (entry) { list.appendChild(renderEntryCard(entry)); });
  }

  async function refreshRecords() {
    loadedEntries = await getAllEntries();
    renderRecords();
  }

  function beginEdit(id) {
    var entry = loadedEntries.find(function (record) { return record.id === id; });
    if (!entry) return;
    editingOriginal = entry;
    byId('entry-id').value = entry.id;
    byId('plot-name').value = entry.plotName;
    byId('observation-date').value = entry.observationDate;
    byId('region-name').value = entry.regionName;
    byId('observer-name').value = entry.observerName;
    byId('latitude').value = entry.latitude;
    byId('longitude').value = entry.longitude;
    byId('soil-texture').value = entry.soilTexture;
    byId('soil-ph').value = entry.soilPh;
    byId('drainage').value = entry.drainage;
    byId('water-source').value = entry.waterSource;
    byId('land-cover').value = entry.landCover;
    byId('crop-species').value = entry.cropSpecies;
    byId('activity').value = entry.activity;
    byId('notes').value = entry.notes;
    byId('photo-files').value = '';
    activePhotos = entry.photos.slice();
    renderPhotoPreviews();
    updatePhotoStatus();
    byId('form-heading').textContent = '✏️ Edit field observation';
    byId('save-btn').textContent = 'Save changes';
    byId('cancel-edit-btn').hidden = false;
    setStatus('Editing ' + entry.plotName + '. Changes will be saved locally.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeEntry(id) {
    var entry = loadedEntries.find(function (record) { return record.id === id; });
    if (!entry || !root.confirm('Delete the field observation "' + entry.plotName + '" and its attached photos from this browser?')) return;
    try {
      await deleteEntry(id);
      if (editingOriginal && editingOriginal.id === id) resetForm();
      await refreshRecords();
      setStatus('Record deleted from this browser.');
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not delete the record.', true);
    }
  }

  async function createReportInNewTab() {
    var reportWindow = root.open('about:blank', '_blank');
    if (!reportWindow) {
      setStatus('The report tab was blocked by the browser. Allow pop-ups for this site and try again.', true);
      return;
    }
    try {
      var records = await getAllEntries();
      var html = buildReportHTML(records);
      reportWindow.document.open();
      reportWindow.document.write(html);
      reportWindow.document.close();
      setStatus('Opened an editable report in a new tab. Edit the report body, then export Word, PDF, HTML, JSON or CSV from its toolbar.');
    } catch (error) {
      reportWindow.close();
      setStatus(error && error.message ? error.message : 'Could not build the report.', true);
    }
  }

  async function downloadBackupJSON() {
    try {
      var records = await getAllEntries();
      downloadBlob(JSON.stringify(makeBackup(records), null, 2), 'application/json;charset=utf-8', 'backtonature-field-log-' + todayStamp() + '.json');
      setStatus('JSON backup downloaded. It includes the compressed photos.');
    } catch (error) { setStatus(error && error.message ? error.message : 'JSON export failed.', true); }
  }

  async function downloadRecordsCSV() {
    try {
      var records = await getAllEntries();
      downloadBlob(buildCSV(records), 'text/csv;charset=utf-8', 'backtonature-field-log-' + todayStamp() + '.csv');
      setStatus('CSV downloaded. It contains observation fields and photo names, not image bytes.');
    } catch (error) { setStatus(error && error.message ? error.message : 'CSV export failed.', true); }
  }

  function downloadBlob(content, mime, filename) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      var text = await file.text();
      var parsed = JSON.parse(text);
      var records = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.entries) ? parsed.entries : null;
      if (!records) throw new Error('This file does not contain an entries array from a field-log JSON backup.');
      if (!root.confirm('Import ' + records.length + ' record(s)? If a record has the same ID as an existing record, the imported version will replace it. This will not upload data anywhere.')) return;
      for (var i = 0; i < records.length; i++) {
        var entry = normalizeEntry(records[i]);
        if (!entry.plotName || !entry.observationDate) continue;
        await saveEntry(entry);
      }
      await refreshRecords();
      setStatus('Import completed. ' + records.length + ' record(s) were processed locally.');
    } catch (error) {
      setStatus(error && error.message ? error.message : 'Could not import this JSON file.', true);
    } finally {
      byId('import-json-file').value = '';
    }
  }

  function setup() {
    byId('field-log-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var button = byId('save-btn');
      var fileInput = byId('photo-files');
      var selectedFiles = fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
      if (activePhotos.length + selectedFiles.length > MAX_PHOTOS) {
        setStatus('A record can contain up to ' + MAX_PHOTOS + ' photos. Remove a photo or select fewer files.', true);
        return;
      }
      var latitude = formValue('latitude'), longitude = formValue('longitude');
      if ((latitude && !longitude) || (!latitude && longitude)) {
        setStatus('Enter both latitude and longitude, or leave both blank.', true);
        return;
      }
      if ((latitude || longitude) && !isValidCoordinates(latitude, longitude)) {
        setStatus('Coordinates are out of range. Latitude must be -90 to 90, longitude -180 to 180.', true);
        return;
      }
      var pH = formValue('soil-ph');
      if (pH !== '' && (!Number.isFinite(Number(pH)) || Number(pH) < 0 || Number(pH) > 14)) {
        setStatus('Soil pH must be between 0 and 14. Use a measured value.', true);
        return;
      }
      button.disabled = true;
      button.textContent = 'Saving…';
      setStatus(selectedFiles.length ? 'Compressing selected photos and saving the record locally…' : 'Saving record locally…');
      try {
        var photos = activePhotos.slice();
        for (var i = 0; i < selectedFiles.length; i++) photos.push(await compressPhoto(selectedFiles[i]));
        var fields = readFormRecord();
        var entry = normalizeEntry({
          id: fields.id,
          plotName: fields.plotName,
          observationDate: fields.observationDate,
          regionName: fields.regionName,
          observerName: fields.observerName,
          latitude: fields.latitude,
          longitude: fields.longitude,
          soilTexture: fields.soilTexture,
          soilPh: fields.soilPh,
          drainage: fields.drainage,
          waterSource: fields.waterSource,
          landCover: fields.landCover,
          cropSpecies: fields.cropSpecies,
          activity: fields.activity,
          notes: fields.notes,
          photos: photos,
          createdAt: editingOriginal ? editingOriginal.createdAt : new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        await saveEntry(entry);
        await refreshRecords();
        resetForm();
        setStatus('Observation saved on this device. Export a JSON backup to protect your data.');
      } catch (error) {
        setStatus(error && error.message ? error.message : 'Could not save this record.', true);
      } finally {
        button.disabled = false;
        button.textContent = editingOriginal ? 'Save changes' : 'Save observation';
      }
    });

    byId('gps-btn').addEventListener('click', function () {
      if (!navigator.geolocation) {
        setStatus('Geolocation is not supported by this browser.', true);
        return;
      }
      var gpsButton = byId('gps-btn');
      gpsButton.disabled = true;
      setStatus('Requesting current device location…');
      navigator.geolocation.getCurrentPosition(function (position) {
        byId('latitude').value = position.coords.latitude.toFixed(6);
        byId('longitude').value = position.coords.longitude.toFixed(6);
        gpsButton.disabled = false;
        setStatus('GPS coordinates filled in. Review them before saving.');
      }, function (error) {
        gpsButton.disabled = false;
        var message = error.code === 1 ? 'Location permission was denied.' :
          error.code === 2 ? 'Device location is unavailable.' :
          error.code === 3 ? 'Location request timed out.' : 'Could not obtain device location.';
        setStatus(message + ' You can enter coordinates manually.', true);
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });

    byId('photo-files').addEventListener('change', function () {
      updatePhotoStatus();
      var files = this.files ? Array.prototype.slice.call(this.files) : [];
      if (activePhotos.length + files.length > MAX_PHOTOS) {
        setStatus('You selected too many photos. This record allows up to ' + MAX_PHOTOS + '.', true);
      } else {
        setStatus(files.length ? files.length + ' new photo(s) selected. They will be compressed when saved.' : '');
      }
    });
    byId('cancel-edit-btn').addEventListener('click', resetForm);
    byId('reset-btn').addEventListener('click', resetForm);
    byId('record-search').addEventListener('input', renderRecords);
    byId('refresh-records-btn').addEventListener('click', function () {
      refreshRecords().then(function () { setStatus('Local records refreshed.'); }).catch(function (error) {
        setStatus(error && error.message ? error.message : 'Could not refresh local records.', true);
      });
    });
    byId('open-report-btn').addEventListener('click', createReportInNewTab);
    byId('export-json-btn').addEventListener('click', downloadBackupJSON);
    byId('export-csv-btn').addEventListener('click', downloadRecordsCSV);
    byId('import-json-btn').addEventListener('click', function () { byId('import-json-file').click(); });
    byId('import-json-file').addEventListener('change', function () {
      var file = this.files && this.files[0];
      if (file) importBackup(file);
    });

    resetForm();
    refreshRecords().then(function () {
      setStatus('Field log ready. Records and photos stay in this browser on this device.');
    }).catch(function (error) {
      byId('records-list').innerHTML = '<div class="empty-state">Local storage is unavailable: ' + escapeHtml(error && error.message ? error.message : 'unknown error') + '</div>';
      setStatus('Could not open the local database. Try a standard browser window with site storage enabled.', true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})(typeof window !== 'undefined' ? window : globalThis);