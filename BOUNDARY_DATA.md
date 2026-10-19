# BackToNature Boundary Data Pipeline

Monthly refresh of global administrative boundary data via the geoBoundaries `gbOpen` API.

## Data levels

- ADM0: country boundaries, output to `data/countries.geojson`.
- ADM1: first-level administrative units (province, state, region, etc.), split into `data/provinces/ISO3.geojson`.
- `data/province.json`: lightweight ADM1 index that maps each ISO-3 country code to its per-country GeoJSON file.
- ADM2: second-level administrative units (district, county, regency, etc.), split into `data/districts/ISO3.geojson`.
- `data/countries.json`: lightweight country index.
- `data/district-index.json`: maps ISO-3 country codes to the corresponding ADM2 GeoJSON file and source metadata.
- `data/boundary-manifest.json`: metadata, boundary IDs, source URLs, update dates and per-boundary license information.
- `data/boundary-update-report.json`: coverage, errors and output summary.

The name `province.json` is retained for compatibility but now acts as an index, not a combined GeoJSON FeatureCollection. ADM1 and ADM2 are administrative levels, not identical legal labels across all countries.

## Performance and safety

The updater prefers geoBoundaries' `simplifiedGeometryGeoJSON` to reduce download time and file size, uses a small worker pool for concurrent downloads, and prints progress periodically. It splits ADM1 and ADM2 by country so no single global file grows beyond GitHub's 100 MiB per-file limit. It validates every output and checks global coverage before replacing published files. Failed or suspiciously incomplete runs preserve existing generated data.

## Run locally

```bash
python -m pip install -r requirements.txt
python -u scripts/update_boundaries.py --levels ADM0 ADM1 --max-countries 5
python -u scripts/update_boundaries.py
```

The first command is a smoke test and does not publish its limited dataset. The monthly GitHub Actions workflow can also be started manually from **Actions → Update administrative boundaries → Run workflow**.

## Source and licensing

Each ADM dataset retains metadata for source, represented year and license where supplied. Review `data/boundary-manifest.json` and comply with each source's attribution/license requirements before redistributing. Updates depend on the upstream provider and can lag official administrative changes. Disputed territories and varying national ADM definitions require care.
