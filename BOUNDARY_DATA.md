# BackToNature Boundary Data Pipeline

Monthly workflow for refreshing global administrative boundaries through the geoBoundaries `gbOpen` API. `ADM0` means country boundary, `ADM1` first-level subnational unit (province/state/region depending on country), and `ADM2` second-level unit (which may correspond to a district/county, but terms differ between countries).

## Generated data

- `data/countries.geojson`: global ADM0 polygons.
- `data/countries.json`: country index and source metadata.
- `data/province.json`: global ADM1 polygons (filename retained for compatibility with the current app).
- `data/district.json`: global ADM2 polygons.
- `data/boundary-manifest.json`: per-boundary metadata and license fields.
- `data/boundary-update-report.json`: validation/run report.

The first GitHub Actions run creates the files. Subsequent monthly runs commit changes only when generated data changes. Use Actions → Update administrative boundaries → Run workflow for a manual update.

## Data safety and licensing

The script downloads into staging and checks coverage and errors before replacing files. It does not silently publish an empty or drastically incomplete world dataset. Some countries may have no valid data at a particular administrative level. Metadata/license is retained at the boundary collection level because licenses may differ per dataset; review it before redistribution and provide appropriate attribution.

Monthly refresh means re-checking available sources, not that each country's borders are guaranteed to be current. Newly created units may not appear until the source provider updates its dataset. ADM levels are not semantically identical across countries, and disputed boundaries may have multiple interpretations.

## Local run

```bash
python -m pip install -r requirements.txt
python scripts/update_boundaries.py --levels ADM0 ADM1 --max-countries 5
python scripts/update_boundaries.py
```

The first command is only a smoke test and intentionally does not publish its limited output to production automatically. The normal run retrieves all countries for ADM0, ADM1, and ADM2.
