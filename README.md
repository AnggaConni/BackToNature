# BackToNature — Living Land Lab

A retro, PlayStation-era farming fieldbook inspired by the cozy menus and dialogue panels of *Harvest Moon: Back to Nature*. The world map remains the starting screen; clicking Indonesia or choosing **Province Explorer** opens an interactive map of Indonesia's 38 provinces.

## What's in the provincial fieldbook?

Each province opens a full-screen, tabbed field guide:

1. **Overview** — regional landscape context, priority questions and candidate crops.
2. **Soil & Land** — a transparent regional soil/landscape cue, a field sampling checklist and links to mapped soil resources.
3. **Crops** — crop candidates plus a checklist to screen water, soil, seed/season, market and labour fit.
4. **Farming Guide** — a five-step starter workflow adapted to the broad landscape type (upland, peat/wetland, dryland, irrigated lowland, island, highland or urban).
5. **Technology** — potential soil conservation, irrigation, agroforestry, wetland/peat or urban-growing practices selected according to the broad landscape type.
6. **Sources** — official data portals plus optional live queries to FAOSTAT, the FAO geospatial metadata catalogue and WOCAT QCAT.

The interface uses pixel fonts, wood-sign borders, parchment panels, controller-style prompts and a full-screen tab layout, while remaining usable on phones.

## Map boundary data

The provincial map loads a GeoJSON FeatureCollection containing **38 provinces** from:

- https://github.com/mashadinoor/Indonesia-Geojson-2026
- GeoJSON path: `Geojson/indonesia_provinsi.geojson`
- The source repository README references Kepmendagri No. 100.1.1-6117/2022 for corrected province codes and provides information about the data source and reuse terms. Review the original metadata/license before redistributing the boundary data.

The global map continues to use the public datasets/geo-countries GeoJSON source. OpenStreetMap provides the basemap and is attributed in the map.

## Data connectors

### FAOSTAT — national land-use context
The Sources tab can request the Land Use (RL) domain for Indonesia from the public FAOSTAT API. Results are labelled as **national context** and must not be interpreted as province-level measurements.

### FAO Hand-in-Hand / geospatial catalogue
The Sources tab can query the FAO Agro-informatics CSW metadata catalogue for records mentioning the selected province and themes such as soil, land, water, climate, forest or agriculture. The connector returns metadata records if the browser can access the service; a link to the official catalogue is shown otherwise.

### WOCAT QCAT — sustainable land management technologies
The Sources tab supports an optional query of WOCAT QCAT API v2. It requires an authorized token. The token is taken from the input for one request and is not stored in localStorage or committed to the repository. WOCAT results use an Indonesia/country-level filter; they are not guaranteed to be province-specific. QCAT may block direct browser access through CORS or reject credentials that lack authorization.

### CGIAR GARDIAN and OpenFarm
The Sources tab links to CGIAR GARDIAN as a research-publication and dataset discovery portal. The current API access model and schema must be verified before adding an automated connector.

OpenFarm is deliberately **not** called as a live API: the OpenFarm maintainers announced that the service servers were shut down in April 2025 and the project was archived. The original repository remains linked as a reference, not as a working endpoint. Crop candidates in this site are curated starter ideas and are not presented as OpenFarm data.

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
- `app.js` — map interaction, 38 provincial field profiles, full-screen tabbed modal and source UI.
- `api.js` — FAOSTAT, FAO catalogue and WOCAT request functions used by the Sources tab.

## Try it

1. Open the GitHub Pages site.
2. Click **Province Explorer**, or click Indonesia on the world map.
3. Click a province or choose it from the province dropdown.
4. Explore **Overview**, **Soil & Land**, **Crops & Farming**, **Technology**, and **Sources**.
5. In Sources, request FAOSTAT or the FAO catalogue. Enter a WOCAT token only if you have authorized access.
