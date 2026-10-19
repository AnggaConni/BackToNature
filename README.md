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

The interface uses pixel fonts, wood-sign borders, parchment panels, controller-style prompts and a full-screen tab layout, while remaining usable on phones.

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

### Wikimedia Commons — reference plant photos
The Crop & Soil Lab queries the Wikimedia Commons MediaWiki API for reference photos. When usable media is returned, the card links to the original file page and shows the available author/credit and license metadata. Image search may return the wrong growth stage, cultivar, or even a misleadingly similar image; always check the original file page and its license. Photo lookup is limited to the top four crop matches per search to reduce the number of requests.

### SoilGrids and FAO ECOCROP — future evidence connectors
ISRIC SoilGrids has a public REST API for selected soil properties at a supplied coordinate, but it is still described as beta and applies a fair-use limit. The current interface does not infer soil conditions from a province polygon; users enter their own soil observations, and the optional numeric pH should come from a real soil test. FAO ECOCROP provides crop environmental requirements through the GAEZ platform/web interface, but the legacy database was discontinued as a standalone database and no supported public API is assumed by this app. These are potential next-step data sources after their access and output schemas are verified.

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

## Files

- `index.html` — page shell and retro game-inspired styles.
- `app.js` — map interaction, country-to-region-to-district navigation, 38 Indonesian provincial field profiles, full-screen tabbed modal and source UI.
- `api.js` — FAOSTAT, FAO catalogue and WOCAT request functions; rule-based crop screening, Wikimedia Commons plant photo search, and historical climate/planting-window functions.
- `tests/crop-api.test.js` — offline smoke tests for crop screening, Commons image metadata mapping, historical weather aggregation and seasonal windows.

## Try it

1. Open the GitHub Pages site.
2. Click **Province Explorer**, or click Indonesia on the world map.
3. Click a province or choose it from the province dropdown.
4. Explore **Overview**, **Soil & Land**, **Crops & Farming**, **Technology**, and **Sources**.
5. In Sources, request FAOSTAT or the FAO catalogue. Enter a WOCAT token only if you have authorized access.
