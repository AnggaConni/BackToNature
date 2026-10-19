#!/usr/bin/env python3
"""Refresh administrative boundary data through geoBoundaries gbOpen."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

API_BASE = "https://www.geoboundaries.org/api/current/gbOpen"
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TIMEOUT = (15, 120)
MAX_RETRIES = 3
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "BackToNature-BoundaryUpdater/1.0",
    "Accept": "application/json, application/geo+json, */*",
})


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_json(url: str) -> Any:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = SESSION.get(url, timeout=TIMEOUT)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                time.sleep(2**attempt)
    raise RuntimeError(f"Failed to fetch JSON from {url}: {last_error}")


def as_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "results", "boundaries", "items"):
            if isinstance(payload.get(key), list):
                return [item for item in payload[key] if isinstance(item, dict)]
        return [payload]
    return []


def first(obj: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = obj.get(key)
        if value not in (None, ""):
            return value
    return default


def source_urls(meta: dict[str, Any], fallback: str) -> tuple[str, str]:
    boundary_id = str(first(meta, "boundaryID"))
    metadata_url = f"https://www.geoboundaries.org/api/gbID/{boundary_id}/" if boundary_id else fallback
    return metadata_url, fallback


def build_collection(meta: dict[str, Any], level: str, endpoint: str) -> dict[str, Any]:
    actual_level = str(first(meta, "boundaryType", default=level)).upper()
    if actual_level and actual_level != level:
        raise ValueError(f"Expected {level}, source metadata reports {actual_level}")
    iso3 = str(first(meta, "boundaryISO", "boundaryISO3", "iso3")).upper()
    if len(iso3) != 3:
        raise ValueError("Missing/invalid ISO-3 code")
    download_url = str(first(meta, "gjDownloadURL", "geoJSONURL", "downloadURL", "downloadUrl"))
    if not download_url:
        raise ValueError("Metadata has no GeoJSON download URL")

    payload = get_json(download_url)
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("Downloaded boundary is not a GeoJSON FeatureCollection")
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Downloaded boundary has zero features")
    metadata_url, _ = source_urls(meta, endpoint)

    normalized = []
    for i, feature in enumerate(features, start=1):
        if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
            raise ValueError(f"Feature {i} has no geometry")
        props = dict(feature.get("properties") or {})
        props.update({
            "_bt_country_iso3": iso3,
            "_bt_admin_level": level,
            "_bt_boundary_id": str(first(meta, "boundaryID")),
            "_bt_country_name": str(first(meta, "boundaryName")),
            "_bt_boundary_source": "geoBoundaries gbOpen",
            "_bt_source_metadata_url": metadata_url,
            "_bt_boundary_license": str(first(meta, "boundaryLicense", "license")),
            "_bt_boundary_year": str(first(meta, "boundaryYearRepresented")),
        })
        normalized.append({
            "type": "Feature",
            "id": feature.get("id", props.get("shapeID", f"{iso3}-{level}-{i}")),
            "geometry": feature["geometry"],
            "properties": props,
        })

    return {
        "type": "FeatureCollection",
        "name": f"{iso3}-{level}",
        "source": {
            "provider": "geoBoundaries gbOpen",
            "country_iso3": iso3,
            "admin_level": level,
            "boundary_id": str(first(meta, "boundaryID")),
            "country_name": str(first(meta, "boundaryName")),
            "canonical_name": str(first(meta, "boundaryCanonical", "boundaryName")),
            "source_metadata_url": metadata_url,
            "boundary_source": str(first(meta, "boundarySource")),
            "boundary_source_url": str(first(meta, "boundarySourceURL")),
            "license": str(first(meta, "boundaryLicense", "license")),
            "license_detail": str(first(meta, "licenseDetail")),
            "license_source": str(first(meta, "licenseSource")),
            "year_represented": str(first(meta, "boundaryYearRepresented")),
            "last_checked_utc": utc_now(),
            "download_url": download_url,
        },
        "features": normalized,
    }


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--levels", nargs="+", choices=[f"ADM{i}" for i in range(6)],
                        default=["ADM0", "ADM1", "ADM2"])
    parser.add_argument("--max-countries", type=int, default=0,
                        help="Fetch only the first N catalog entries for a smoke test; never publish.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build and validate data but do not replace files.")
    args = parser.parse_args()
    smoke_test = args.max_countries > 0

    started = utc_now()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="backtonature-boundaries-") as tmp:
        stage = Path(tmp)
        by_level: dict[str, list[dict[str, Any]]] = {level: [] for level in args.levels}
        countries: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, str]] = []
        manifest: dict[str, Any] = {
            "schema_version": 1,
            "provider": "geoBoundaries gbOpen",
            "api_base": API_BASE,
            "generated_at_utc": started,
            "levels_requested": args.levels,
            "boundaries": [],
            "errors": errors,
        }
        counts = {level: 0 for level in args.levels}
        catalogue_sizes: dict[str, int] = {}

        for level in args.levels:
            endpoint = f"{API_BASE}/ALL/{level}/"
            try:
                entries = as_list(get_json(endpoint))
            except Exception as exc:
                raise RuntimeError(f"Cannot fetch {level} catalogue; keeping existing outputs. {exc}") from exc
            catalogue_sizes[level] = len(entries)
            if smoke_test:
                entries = entries[:args.max_countries]
            if not entries:
                errors.append({"level": level, "message": "Catalogue was empty"})
                continue

            for item in entries:
                iso3 = str(first(item, "boundaryISO", "boundaryISO3", "iso3")).upper()
                country_name = str(first(item, "boundaryName", "name", default=iso3))
                if not iso3 or len(iso3) != 3:
                    errors.append({"level": level, "message": "Catalogue item has no valid ISO-3"})
                    continue
                try:
                    collection = build_collection(item, level, endpoint)
                    n = len(collection["features"])
                    by_level[level].append(collection)
                    counts[level] += n
                    manifest["boundaries"].append({
                        **collection["source"],
                        "feature_count": n,
                        "feature_collection_name": collection["name"],
                    })
                    country = countries.setdefault(iso3, {
                        "iso3": iso3,
                        "name": country_name,
                        "levels_available": [],
                    })
                    if level not in country["levels_available"]:
                        country["levels_available"].append(level)
                except Exception as exc:
                    errors.append({
                        "iso3": iso3,
                        "country": country_name,
                        "level": level,
                        "message": str(exc),
                    })
                    print(f"[WARN] {iso3} {level}: {exc}", file=sys.stderr)

        # Guard against truncated catalogues, widespread download errors, or empty output.
        if not smoke_test:
            for level, expected in catalogue_sizes.items():
                successful = sum(1 for c in manifest["boundaries"] if c["admin_level"] == level)
                if expected < 100 or successful < 80 or successful / max(expected, 1) < 0.80:
                    raise RuntimeError(
                        f"Suspicious {level} coverage: catalogue={expected}, successful={successful}; "
                        "existing data preserved."
                    )
                if not by_level[level]:
                    raise RuntimeError(f"No valid features for {level}; existing data preserved.")
        if smoke_test and not any(by_level.values()):
            raise RuntimeError("Smoke test produced no valid boundaries.")

        country_features = [
            feature
            for collection in by_level.get("ADM0", [])
            for feature in collection["features"]
        ]
        outputs: dict[str, Any] = {}
        for level, collections in by_level.items():
            features = [feature for collection in collections for feature in collection["features"]]
            filename = {
                "ADM0": "countries.geojson",
                "ADM1": "province.json",
                "ADM2": "district.json",
            }.get(level, f"{level.lower()}.geojson")
            outputs[filename] = {
                "type": "FeatureCollection",
                "name": level.lower(),
                "generated_at_utc": started,
                "sources": [collection["source"] for collection in collections],
                "features": features,
            }

        outputs["countries.json"] = {
            "type": "FeatureCollection",
            "name": "countries",
            "generated_at_utc": started,
            "features": country_features,
            "countries": sorted(countries.values(), key=lambda country: country["name"].casefold()),
        }
        outputs["boundary-manifest.json"] = manifest
        outputs["boundary-update-report.json"] = {
            "started_at_utc": started,
            "finished_at_utc": utc_now(),
            "country_count": len(countries),
            "catalogue_count_by_level": catalogue_sizes,
            "feature_count_by_level": counts,
            "successful_boundary_count": len(manifest["boundaries"]),
            "error_count": len(errors),
            "errors": errors[:250],
            "levels_requested": args.levels,
            "smoke_test": smoke_test,
            "published": False,
        }

        for filename, payload in outputs.items():
            write_json(stage / filename, payload)
            # Read the bytes back to ensure output is valid JSON before publishing.
            json.loads((stage / filename).read_text(encoding="utf-8"))

        if smoke_test or args.dry_run:
            print(json.dumps({
                "dry_run": True,
                "smoke_test": smoke_test,
                "country_count": len(countries),
                "catalogue_count_by_level": catalogue_sizes,
                "feature_count_by_level": counts,
                "error_count": len(errors),
                "staged_files": sorted(outputs),
            }, ensure_ascii=False, indent=2))
            return 0

        # Replace only after all outputs pass broad validation.
        for filename in sorted(outputs):
            shutil.copy2(stage / filename, DATA_DIR / filename)
        print(json.dumps({
            "country_count": len(countries),
            "catalogue_count_by_level": catalogue_sizes,
            "feature_count_by_level": counts,
            "successful_boundary_count": len(manifest["boundaries"]),
            "error_count": len(errors),
            "published_files": sorted(outputs),
            "note": "Review data/boundary-manifest.json for per-boundary attribution and license requirements.",
        }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
