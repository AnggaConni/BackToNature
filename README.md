# BackToNature

A retro, Harvest Moon-inspired global map for land restoration and evidence-based agricultural learning.

## Live data connectors

BackToNature now includes a source panel that appears when a user clicks a country on the map.

### FAOSTAT — live land-use observations
- Calls the public FAOSTAT API at `https://fenixservices.fao.org/faostat/api/v1`.
- Looks up the selected country in the FAOSTAT area dimension, then requests the Land Use domain (`RL`) for the latest seven-year window available to the API.
- Shows returned item, element, year, value and unit fields. It does not silently substitute mock observations when the request fails.
- Official API information: https://www.fao.org/faostat/en/#developer-portal

### FAO Hand-in-Hand — geospatial metadata search
- Queries the public FAO Agro-informatics CSW catalogue at `https://data.apps.fao.org/map/catalog/srv/eng/csw` for metadata matching the selected country.
- Displays matching catalogue records when the browser can access the endpoint, and links each record to the FAO catalogue.
- The Hand-in-Hand platform contains many independently published datasets rather than one universal country-level restoration API. Users should confirm each layer’s coverage, licence, reference period and service URL before using it.
- Workspace: https://data.apps.fao.org/?lang=en
- Catalogue: https://data.fao.org/catalog/

### WOCAT — SLM technologies
- Supports querying WOCAT QCAT API v2 for the selected country and listing technology records.
- QCAT requires an authorized WOCAT token. The UI accepts a token for the current page session only; it is not stored in localStorage or committed to this repository.
- Direct browser access may still be blocked by QCAT CORS settings. A token/access error is reported instead of fabricated results.
- Documentation and access requirements: https://qcat.readthedocs.io/en/latest/api/v2.html

## Important limitations

- Country-level observations are context, not a field assessment. They must not be treated as proof that a particular plot is degraded or as automatic planting prescriptions.
- API results depend on the source’s latest published data, network availability, country-code matching, authentication and browser CORS rules.
- WOCAT is not fully usable until an authorized token is supplied by a user who has API access.
- The Hand-in-Hand integration searches metadata and links to the spatial workspace; the user must still select and inspect a specific mapped layer before it can be used as a map overlay.
- No private API credentials belong in this public static repository.

## Hosting

The site is designed for static hosting (for example, GitHub Pages). The existing world map and GeoJSON country boundaries remain the base interface.
