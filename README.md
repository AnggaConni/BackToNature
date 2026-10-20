# BackToNature — Living Land Lab

A retro, PlayStation-era farming fieldbook inspired by the cozy menus and dialogue panels of *Harvest Moon: Back to Nature*. The world map remains the starting screen. Click any country to open its available ADM1 regions, then click a region for the fieldbook and use **View Districts** to drill into ADM2 where available. The **Region Explorer** button returns to a world-focused view; click a country polygon to explore its available first- and second-level administrative units.

## What's in the provincial fieldbook?

Each province opens a full-screen, tabbed field guide:

1. **Overview** — regional landscape context, priority questions and candidate crops.
2. **Soil & Land** — a transparent regional soil/landscape cue, a field sampling checklist and links to mapped soil resources.
3. **Crops** — a new Crop & Soil Lab lets users screen a curated crop library against soil group, optional measured pH, drainage, water availability, climate and intended use. Results show a transparent screening score, reasons, caveats and reference photos where available.
4. **Climate & Planting** — automatically loads five complete years of historical weather for a representative point inside the selected province/district and summarizes monthly temperature, rainfall, rainy days, mean wind, gusts and dominant wind direction. It ranks provisional crop planting windows using the seasonal temperature/rainfall pattern.
5. **Farming Guide** — a five-step starter workflow adapted to the broad landscape type (upland, peat/wetland, dryland, irrigated lowland, island, highland or urban).
6. **Technology** — potential soil conservation, irrigation, agroforestry, wetland/peat or urban-growing practices selected according to the broad landscape type.
7. **Sources** — official data portals plus optional live queries to FAOSTAT, the FAO geospatial metadata catalogue and WOCAT QCAT.

When a user clicks an ADM1 region or ADM2 district, a compact recommendation brief opens first. It summarizes starter crop ideas, low-regret technologies and the climate-based planting hints; **Detailed Fieldbook** opens the full-screen tabbed guide. The interface uses pixel fonts, wood-sign borders, parchment panels, controller-style prompts and remains usable on phones.

The header's **LANG** menu opens a Google Translate view of the current page in a new tab for Indonesian, English, Spanish, French, Japanese, Simplified Chinese or Arabic. This deliberately uses the public Translate website instead of Google's retired Website Translator embed widget. It is a convenience translation path; the full-screen map and interactive features may not behave identically through the translated proxy.

## Map boundary data

The provincial map loads a GeoJSON FeatureCollection containing **38 provinces** from:

- https://github.com/mashadinoor/Indonesia-Geojson-2026
- GeoJSON path: `Geojson/indonesia_provinsi.geojson`
- The source repository README references Kepmendagri No. 100.1.1-6117/2022 for corrected province codes and provides information about the data source and reuse terms. Review the original metadata/license before redistributing the boundary data.

The world map uses the public datasets/geo-countries GeoJSON source. Monthly generated datasets under `data/` provide global ADM1/ADM2 regions, while the Indonesian explorer keeps the existing 38-province source. OpenStreetMap provides the basemap and is attributed in the map.

## Data connectors

### FAOSTAT — national land-use context
The Sources tab can request the Land Use (RL) domain for Indonesia from the public FAOSTAT API. Results are labelled as **national context** and must not be interpreted as province-level measurements.

### FAO Hand-in-Hand / geospatial catalogue
The Sources tab can query the FAO Agro-informatics CSW metadata catalogue for records mentioning the selected province and themes such as soil, land, water, climate, forest or agriculture. The connector returns metadata records if the browser can access the service; a link to the official catalogue is shown otherwise.

### WOCAT QCAT — sustainable land management technologies
The Sources tab can query WOCAT QCAT API v2 for the currently selected country. WOCAT states that reading/filtering the database does not require a database-user login, and that a free Database User account is available. API calls are a separate matter: the QCAT API documentation says requests to read configurations, questionnaire lists and questionnaire details require an activated WOCAT account and a token issued by the WOCAT Secretariat after the user explains the purpose of the API requests. The public documentation does not list a per-call API price, so confirm any special or high-volume usage terms with the Secretariat.

The site takes a token only in a password field for one user-initiated query; it clears the input and does not save the token to localStorage or commit it to the repository. Do not hard-code tokens into the public GitHub Pages frontend. The live endpoint may still fail because of CORS, token permissions or changes in the API.

If registration asks for an institution you do not have, do not invent an affiliation. WOCAT lists a free Database User registration route, and also has an Individual Member route for SLM professionals/experts with proven experience (including independent experts, subject to approval). If neither route fits your situation, ask the WOCAT Secretariat which account type supports your intended API use.

Official links:
- API authorization guide: https://qcat.readthedocs.io/en/latest/api/v2.html
- Free database-user registration: https://wocat.net/en/account/register/
- Membership and individual-member information: https://wocat.net/en/wocat-membership/

### CGIAR GARDIAN and OpenFarm
The Sources tab links to CGIAR GARDIAN as a research-publication and dataset discovery portal. The current API access model and schema must be verified before adding an automated connector.

OpenFarm is deliberately **not** called as a live API: the OpenFarm maintainers announced that the service servers were shut down in April 2025 and the project was archived. The original repository remains linked as a reference, not as a working endpoint. Crop candidates in this site are curated starter ideas and are not presented as OpenFarm data.

### Historical climate & planting-window API
When a user opens a province/region or district fieldbook, the app calculates an area-weighted representative coordinate from the selected boundary geometry and requests five complete calendar years of daily historical weather from the Open-Meteo Historical Weather API. The API module aggregates observations into monthly temperature averages, average monthly rainfall, rainy-day counts, mean/max wind speed, gust statistics and dominant wind direction. The Climate & Planting tab uses these month-by-month patterns to rank provisional establishment windows for the crop screening library.

The weather point is a regional proxy; it is not a parcel forecast and does not represent every elevation, coastline or microclimate in a large boundary. The crop temperature/rainfall bands are provisional rules added to help users investigate planting seasons—not an agronomically validated global model. The UI intentionally labels scores as screening indicators, exposes reasons and cautions, and reminds users to check soil, irrigation, crop variety, the current national forecast and local extension advice. Wind warnings are generic exposure flags rather than crop-specific thresholds.

Source documentation: https://open-meteo.com/en/docs/historical-weather-api

### Crop & Soil Lab — local screening library
The Crops tab includes a curated screening library for common staple crops, vegetables, perennials and soil-cover options. It compares the user's stated soil group, optional pH test, drainage, water pattern, climate group and crop purpose. Each result lists why it scored well and what still needs checking. The score is a rule-based screening indicator, not a statistical probability, yield prediction, or scientifically validated global crop-suitability model. Crop profiles and ranges are broad starting points and should be improved with locally validated sources and extension recommendations.

### GBIF Species API — English, local and scientific crop names
The quick region brief uses a curated crop candidate list, then enriches exact species names through GBIF's public Species API. The view shows the app's English/common crop label, a vernacular name when a GBIF record is associated with the selected country or a preferred local language, and the accepted scientific name when GBIF matches the species. Country-to-language preferences are curated defaults for common languages and are not a complete map of multilingual or Indigenous language use.

GBIF vernacular records are uneven across species and countries. The app therefore marks a missing local name rather than translating or inventing one; a fallback name is clearly identified as a BackToNature-curated Indonesian common name. Broad groups such as “leafy vegetables” do not get a fabricated species-level Latin name. Each crop card links to the GBIF taxon record or search page where available.

API documentation: https://techdocs.gbif.org/en/openapi/v1/species
Vernacular name model and available fields (language, country, source): https://gbif.github.io/gbif-api/apidocs/org/gbif/api/model/checklistbank/VernacularName.html


### GBIF Occurrence Explorer — nearby biodiversity records
The **Nature Data** tab can request public GBIF occurrence records around the representative point of the selected administrative unit. The browser requests georeferenced records, filters the rectangular search results to a circular radius, sorts by distance, and displays up to 12 source-linked records. A representative point is only a discovery proxy; broad regions and islands can contain very different ecosystems. Observation counts reflect reporting effort, not total biodiversity or population size.

API documentation: https://techdocs.gbif.org/en/openapi/v1/occurrence

### NASA POWER — monthly climate cross-check
The **Nature Data** tab can request monthly NASA POWER agriculture-community parameters for temperature, precipitation rate and solar radiation, then average each calendar month across five complete calendar years. Precipitation is explicitly displayed as a daily rate (mm/day), not misrepresented as a monthly rainfall total. POWER is a gridded estimate and should be compared with the existing Open-Meteo summary, national meteorological data and field conditions.

API documentation: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

The **Nature Data** tab automatically starts both the nearby GBIF occurrence search and NASA POWER climate lookup the first time it is opened for a selected region. The buttons remain available as **Refresh** actions, including after a previous request fails.

The quick region recommendation modal also includes **Plant species recorded nearby**, which queries species-level Plantae records from GBIF within 25 km of a representative point. This is an occurrence-evidence panel separate from the crop starter recommendations: a nearby record is not proof that a species is suitable for cultivation or will thrive at every site. The modal caches the region's returned records for the page session and provides an explicit refresh control.

Both connectors load only after the user presses a button, use an in-memory page-session cache, and report failures rather than silently replacing missing data with examples. The APIs are accessed directly from the browser; source availability and CORS behavior can differ by environment.

### Wikimedia Commons — reference plant photos
The Crop & Soil Lab queries the Wikimedia Commons MediaWiki API for reference photos. When usable media is returned, the card links to the original file page and shows the available author/credit and license metadata. Image search may return the wrong growth stage, cultivar, or even a misleadingly similar image; always check the original file page and its license. Photo lookup is limited to the top four crop matches per search to reduce the number of requests.

### SoilGrids and FAO ECOCROP — future evidence connectors
ISRIC SoilGrids has a public REST API for selected soil properties at a supplied coordinate, but it is still described as beta and applies a fair-use limit. The current interface does not infer soil conditions from a province polygon; users enter their own soil observations, and the optional numeric pH should come from a real soil test. FAO ECOCROP provides crop environmental requirements through the GAEZ platform/web interface, but the legacy database was discontinued as a standalone database and no supported public API is assumed by this app. These are potential next-step data sources after their access and output schemas are verified.

### FAO FPMA — public food-price API (no login)
The Sources tab includes a live FAO FPMA price panel. It queries the public `FpmaSerie` endpoint filtered by the selected country's ISO-3 code, searches up to three pages of series metadata, then requests history for at most four matching series. No API key, login or token is sent. Enter a commodity keyword such as `rice`, `maize`, `wheat` or `beans`.

Each series preserves the publisher's currency, unit, market/price type and date. The panel shows the latest populated observation and, where comparable points exist, an approximately 90-day change against the closest earlier observation. It is descriptive, not a forecast or an explanation of causality. Series coverage differs by country/commodity; a missing series is not a zero price. Failures are reported and no example values are substituted. Browser access still depends on the public server's CORS configuration.

Official API documentation:
- Introduction and no-authentication public API: https://fpma-documentation.web.app/docs/api-docs/intro/
- Series metadata and ISO-3 filtering: https://fpma-documentation.web.app/docs/api-docs/time-series/
- Price history endpoint and units: https://fpma-documentation.web.app/docs/api-docs/series-price/

### Sources tab rendering fix
The source/photo links used `safeHttps()`, but that helper was missing from the app bundle. Its absence threw during `renderSources()`, making Sources appear unresponsive. The helper is now defined centrally; external links are restricted to HTTPS, and a tab-rendering failure produces an explicit on-screen message instead of a silent no-op.

### BPS — province-level paddy statistics
The Overview tab links to BPS's official table for harvested area, productivity and production of paddy by province. The values are not copied into the site as fabricated or manually inferred figures; open the source table to verify the year and units.

## Important interpretation limits

- Province profiles are **curated regional starter guides**, not live diagnoses of all farmland within a province.
- Candidate crops and technology ideas are prompts for further assessment—not automatic agronomic prescriptions or yield guarantees.
- No laboratory soil pH, texture, organic carbon, salinity, nutrient value or parcel-specific soil type is asserted unless an actual georeferenced source or test result is separately connected and validated.
- Soil-map availability and map scale vary by place. Check coverage and source metadata for the actual farm area.
- Field recommendations should be validated with local agricultural extension, farmers' knowledge, parcel-level observation and suitable soil/water tests.
- Browser API calls may fail due to CORS, network conditions, service availability, authentication or changes in source schemas. Failures are reported rather than replaced silently with invented observations.
- This is a static GitHub Pages-compatible app; private API keys must not be stored in repository code.

## Background music

The mini-player uses the repository audio file `music/allicante-cozy-game-beats.mp3`, identified as “Cozy Game Beats — Alicante”. Playback is user-initiated only; `preload="none"` is used and the page does not autoplay the track. The player supports play/pause, volume, mute and seeking. The player links back to the track's Pixabay page for the current license terms.

## Files

- `index.html` — page shell and retro game-inspired styles.
- `app.js` — map navigation, country-to-region-to-district drilldown, compact recommendation brief, full-screen tabbed fieldbook, historical climate summary, live Nature Data tab and Translate menu behavior.
- `api.js` — FAOSTAT, FAO catalogue and WOCAT request functions; rule-based crop screening, GBIF taxonomy and nearby occurrence lookup, NASA POWER monthly climate summaries, Wikimedia Commons photos, and historical climate/planting-window functions with reference ET₀, Open-Meteo seven-day outlook, iNaturalist observations and optional Pl@ntNet photo identification.
- `tests/crop-api.test.js` — offline smoke tests for crop screening, GBIF taxonomy and nearby occurrence records, country-aware vernacular names, Commons image metadata mapping, historical weather aggregation, NASA POWER monthly aggregation and seasonal windows.

## Try it

1. Open the GitHub Pages site.
2. Click **Province Explorer**, or click Indonesia on the world map.
3. Click a province or choose it from the province dropdown.
4. Explore **Overview**, **Soil & Land**, **Crops & Farming**, **Technology**, and **Sources**.
5. Use the mini jukebox to start/pause the uploaded “Cozy Game Beats — Alicante” track, adjust volume, mute or scrub the timeline. Audio never starts until the Play button is pressed.
6. In Sources, request FAOSTAT or the FAO catalogue. Enter a WOCAT token only if you have authorized access.


### District navigation in the Quick Field Brief
The Quick Field Brief footer now offers a direct **View Districts / View Kabupaten & Cities** action when ADM2 boundaries are available for the selected country. The Detailed Fieldbook retains the same drill-down action. The direct action closes the brief and opens the district map, avoiding the need to discover the button in a second modal.


### Seasonal crop advice: concise decision, detailed explanation
The Quick Field Brief keeps crop cards compact. Each card displays a current-month status from the historical monthly climate screening. The status evaluates the establishment window starting this month (not a window that started earlier): **climate window open**, **check conditions**, **not recommended this month**, or **season not verified**. When the month is not recommended, it shows the best climate-screen window. Soil suitability and planting timing are separate questions; this screening is not a crop-specific agronomic calendar and must be checked against local varieties, observed soil/water conditions and extension guidance. Explanations, weather context, and data sources remain in the Detailed Fieldbook.

### Additional no-cost data connectors
- **Open-Meteo ET₀ + water balance:** historical daily reference evapotranspiration is aggregated by month; the detailed climate tab now shows monthly rain minus reference ET₀. The detailed Nature Data tab also offers a seven-day rain-minus-ET₀ outlook. ET₀ describes a well-watered reference surface, not the water requirement of every crop.
- **iNaturalist API v1:** research-grade, photo-backed plant observations within a selected radius. The app deduplicates the returned observations by taxon and retains observation links. It supplements GBIF; it does not establish species abundance or crop suitability.
- **ESA WorldCover 2021 WMS:** optional map overlay, disabled by default. It is a 10 m global land-cover product from 2021, not a present-day parcel survey. Source/attribution: https://esa-worldcover.org/en/data-access
- **Pl@ntNet API:** optional photo identification, requiring the user's own key. The key and selected photos are sent only when the user presses the identification button; the app does not persist the key. The free API quota is up to 500 identifications per day and has its own account/attribution conditions: https://my.plantnet.org/terms_of_use
- **FAO WaPOR v3:** linked as an additional water-productivity source. Availability, product level, spatial resolution and temporal coverage should be checked for the selected location before interpreting an observation.

All live responses are optional and may be blocked by network/CORS limits or provider availability. Failure states do not fabricate fallback observations or measurements.


### WaPOR v3 live catalogue
The Detailed Fieldbook's Nature Data tab queries the public FAO GISMGR v2 catalogue at `/catalog/workspaces/WAPOR-3/mapsets` without credentials. It lists the global mapsets used for actual evapotranspiration/interception (AETI), reference evapotranspiration (RET), relative soil moisture (RSM), precipitation (PCP), and net primary production (NPP), with time-step and resolution labels plus official raster-catalog links. This is a real metadata/API connector; it does not yet extract a per-coordinate raster value, and opening a raster link may list or download GeoTIFF sources. FAO's WaPOR v3 documentation states no API key or token is required. The global Level 1 datasets cover the globe, but resolution differs by variable (for example AETI vs RET), and regional Level 2 coverage is not global.

Official references:
- https://www.fao.org/in-action/remote-sensing-for-water-productivity/wapor-data-access/en
- https://data.apps.fao.org/gismgr/shared/docs/api-reference/index.html


The Open-Meteo seven-day outlook also requests the modelled topsoil moisture (0–7 cm), topsoil temperature (0–7 cm), and vapour-pressure deficit series. Hourly values are averaged by local forecast date and displayed in the Detailed Nature Data tab. These forecast/model variables are location-grid estimates and must not be presented as in-situ soil readings; field decisions should be confirmed with soil moisture probes or field observations.


### Clickable species observations on the map
When the Nature Data tab retrieves GBIF and iNaturalist plant observations, the application adds the returned coordinates as clickable Leaflet circle markers. GBIF points and iNaturalist points use different colours; each popup shows source, common/scientific name, record date when supplied, distance from the regional representative point, and links to the source record/taxon. The layer can be toggled from the map's top-right layer control. It is cleared when users select another region or change map scale so observations from a previous selection do not appear to belong to the new area.

Markers are created only for georeferenced API records with valid coordinates. A lack of markers is not proof that the area lacks a species, because observation coverage and reporting effort vary. The points show reported observations, not full distribution boundaries, abundance, or crop-suitability.


### Country-specific agriculture data sources
The Sources tab uses a curated registry keyed by ISO-3 country code. Indonesia-only sources—BPS provincial rice statistics, BPS WebAPI and the Kementerian Pertanian geoportal—are displayed only when the selected country is Indonesia (IDN). BPS WebAPI is free after registration and requires a key/token; the Kementan geoportal's data coverage and layer conditions vary.

The registry currently includes reviewed official sources for:
- Canada (CAN): Statistics Canada Web Data Service public JSON API; no API key is documented.
- Brazil (BRA): IBGE SIDRA / aggregate statistics APIs.
- Australia (AUS): data.gov.au agriculture catalogue API and ABARES.
- United States (USA): USDA NASS Quick Stats (free API key required) and public Quick Stats pages.
- India (IND): data.gov.in APIs (registered API key required) and the Ministry of Agriculture portal.
- Japan (JPN): e-Stat API (application ID required) and MAFF statistics.
- Mexico (MEX): INEGI API documentation and SIAP agriculture statistics.
- EU member states: Eurostat crop-production API, with a query URL filtered to the selected member state's GEO code.

Countries without a reviewed national source preset are not assigned guessed API endpoints. Their Sources tab still provides global sources and the free World Bank Indicators API, which requests four country-filtered agriculture indicators by ISO-3 code. World Bank data are national context, not province/district/farm-level observations. To add another national source, extend the country source registry after checking official ownership, API availability, access requirements, and licensing.
