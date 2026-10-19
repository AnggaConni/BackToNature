#!/usr/bin/env python3
"""Refresh global administrative boundaries through geoBoundaries gbOpen.

ADM0/ADM1 features are combined into world files. ADM2 is split by country
so a single global district file does not grow beyond GitHub's file-size limit.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

API_BASE = "https://www.geoboundaries.org/api/current/gbOpen"
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TIMEOUT = (15, 90)
MAX_RETRIES = 3
MAX_WORKERS = 5
LOCAL = threading.local()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def session() -> requests.Session:
    """One session per worker thread, avoiding concurrent Session mutation."""
    if not hasattr(LOCAL, "session"):
        current = requests.Session()
        current.headers.update({
            "User-Agent": "BackToNature-BoundaryUpdater/1.1",
            "Accept": "application/json, application/geo+json, */*",
        })
        LOCAL.session = current
    return LOCAL.session


def get_json(url: str) -> Any:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = session().get(url, timeout=TIMEOUT)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES - 1:
                # Retry rate limits and temporary provider/network errors.
                time.sleep(2 ** attempt)
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


def build_collection(meta: dict[str, Any], requested_level: str, endpoint: str) -> dict[str, Any]:
    actual_level = str(first(meta, "boundaryType", default=requested_level)).upper()
    if actual_level and actual_level != requested_level:
        raise ValueError(f"Expected {requested_level}; source reports {actual_level}")

    iso3 = str(first(meta, "boundaryISO", "boundaryISO3", "iso3")).upper()
    if len(iso3) != 3:
        raise ValueError("Missing/invalid ISO-3 code")

    # Prefer the provider's simplified GeoJSON to reduce transfer time and repo size.
    # Fall back to the full boundary only when the simplified URL is not supplied.
    download_url = str(first(meta, "simplifiedGeometryGeoJSON", "gjDownloadURL",
                             "geoJSONURL", "downloadURL", "downloadUrl"))
    if not download_url:
        raise ValueError("Metadata has no GeoJSON download URL")

    payload = get_json(download_url)
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("Downloaded boundary is not a GeoJSON FeatureCollection")
    features = payload.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Downloaded boundary has zero features")

    boundary_id = str(first(meta, "boundaryID"))
    metadata_url = (
        f"https://www.geoboundaries.org/api/gbID/{boundary_id}/"
        if boundary_id else endpoint
    )
    normalized: list[dict[str, Any]] = []
    for index, feature in enumerate(features, start=1):
        if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
            raise ValueError(f"Feature {index} has no geometry")
        props = dict(feature.get("properties") or {})
        props.update({
            "_bt_country_iso3": iso3,
            "_bt_admin_level": requested_level,
            "_bt_boundary_id": boundary_id,
            "_bt_country_name": str(first(meta, "boundaryName")),
            "_bt_boundary_source": "geoBoundaries gbOpen",
            "_bt_source_metadata_url": metadata_url,
            "_bt_boundary_license": str(first(meta, "boundaryLicense", "license")),
            "_bt_boundary_year": str(first(meta, "boundaryYearRepresented")),
        })
        normalized.append({
            "type": "Feature",
            "id": feature.get("id", props.get("shapeID", f"{iso3}-{requested_level}-{index}")),
            "geometry": feature["geometry"],
            "properties": props,
        })

    return {
        "type": "FeatureCollection",
        "name": f"{iso3}-{requested_level}",
        "source": {
            "provider": "geoBoundaries gbOpen",
            "country_iso3": iso3,
            "admin_level": requested_level,
            "boundary_id": boundary_id,
            "country_name": str(first(meta, "boundaryName")),
            "canonical_name": str(first(meta, "boundaryCanonical", "boundaryName")),
            "source_metadata_url": metadata_url,
            "boundary_source": str(first(meta, "boundarySource")),
            "boundary_source_url": str(first(meta, "boundarySourceURL")),
            "license": str(first(meta, "boundaryLicense", "license")),
            "license_detail": str(first(meta, "licenseDetail")),
            "license_source": str(first(meta, "licenseSource")),
            "year_represented": str(first(meta, "boundaryYearRepresented")),
            "source_data_update_date": str(first(meta, "sourceDataUpdateDate")),
            "geometry_url": download_url,
            "geometry_simplified": bool(first(meta, "simplifiedGeometryGeoJSON")),
            "last_checked_utc": utc_now(),
        },
        "features": normalized,
    }


def download_one(task: tuple[str, dict[str, Any], str]) -> tuple[str, str, str, dict[str, Any] | None, str | None]:
    level, meta, endpoint = task
    iso3 = str(first(meta, "boundaryISO", "boundaryISO3", "iso3")).upper()
    name = str(first(meta, "boundaryName", "name", default=iso3))
    try:
        collection = build_collection(meta, level, endpoint)
        return level, iso3, name, collection, None
    except Exception as exc:
        return level, iso3, name, None, str(exc)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Validate the generated bytes before they can be published.
    with path.open(encoding="utf-8") as handle:
        json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--levels", nargs="+", choices=[f"ADM{i}" for i in range(6)],
                        default=["ADM0", "ADM1", "ADM2"])
    parser.add_argument("--max-countries", type=int, default=0,
                        help="Limit each catalogue to N entries for a smoke test; never publish.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build and validate results, but do not replace generated files.")
    args = parser.parse_args()
    smoke_test = args.max_countries > 0
    started = utc_now()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="backtonature-boundaries-") as temp:
        stage = Path(temp)
        collections_by_level: dict[str, list[dict[str, Any]]] = {level: [] for level in args.levels}
        countries: dict[str, dict[str, Any]] = {}
        errors: list[dict[str, str]] = []
        catalogue_counts: dict[str, int] = {}

        # Fetch all catalogs first. Catalogue/schema failure aborts without touching current data.
        tasks: list[tuple[str, dict[str, Any], str]] = []
        for level in args.levels:
            endpoint = f"{API_BASE}/ALL/{level}/"
            entries = as_list(get_json(endpoint))
            catalogue_counts[level] = len(entries)
            if smoke_test:
                entries = entries[:args.max_countries]
            if not entries:
                raise RuntimeError(f"Catalogue for {level} was empty; existing data preserved.")
            tasks.extend((level, meta, endpoint) for meta in entries)

        print(
            f"Catalogues loaded: {catalogue_counts}. Downloading {len(tasks)} boundaries "
            f"with {MAX_WORKERS} workers; simplified geometries preferred.",
            flush=True,
        )
        completed_by_level = {level: 0 for level in args.levels}
        successes_by_level = {level: 0 for level in args.levels}
        total = len(tasks)
        completed = 0
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = [pool.submit(download_one, task) for task in tasks]
            for future in as_completed(futures):
                level, iso3, country_name, collection, error = future.result()
                completed += 1
                completed_by_level[level] += 1
                if error:
                    errors.append({"iso3": iso3, "country": country_name, "level": level, "message": error})
                    print(f"[WARN] {iso3} {level}: {error}", file=sys.stderr, flush=True)
                else:
                    assert collection is not None
                    collections_by_level[level].append(collection)
                    successes_by_level[level] += 1
                    item = countries.setdefault(iso3, {
                        "iso3": iso3,
                        "name": country_name or iso3,
                        "levels_available": [],
                    })
                    if level not in item["levels_available"]:
                        item["levels_available"].append(level)
                if completed == total or completed % 10 == 0:
                    print(
                        f"Progress {completed}/{total} | "
                        + " | ".join(
                            f"{lev}: {successes_by_level[lev]}/{completed_by_level[lev]}"
                            for lev in args.levels
                        ),
                        flush=True,
                    )

        if not smoke_test:
            for level, expected in catalogue_counts.items():
                successful = successes_by_level[level]
                coverage = successful / max(expected, 1)
                if expected < 100 or successful < 80 or coverage < 0.80:
                    raise RuntimeError(
                        f"Suspicious {level} coverage ({successful}/{expected}, {coverage:.0%}); "
                        "existing generated data preserved."
                    )
                if not collections_by_level[level]:
                    raise RuntimeError(f"No valid features for {level}; existing data preserved.")

        output_payloads: dict[str, Any] = {}
        province_files: dict[str, str] = {}
        province_index: dict[str, dict[str, Any]] = {}
        district_files: dict[str, str] = {}
        district_index: dict[str, dict[str, Any]] = {}

        for level in args.levels:
            level_collections = sorted(
                collections_by_level[level],
                key=lambda collection: (
                    collection["source"]["country_iso3"],
                    collection["source"]["country_name"].casefold(),
                ),
            )

            if level == "ADM0":
                features = [
                    feature
                    for collection in level_collections
                    for feature in collection["features"]
                ]
                output_payloads["countries.geojson"] = {
                    "type": "FeatureCollection",
                    "name": "adm0-countries",
                    "generated_at_utc": started,
                    "sources": [collection["source"] for collection in level_collections],
                    "features": features,
                }

            elif level in ("ADM1", "ADM2"):
                grouped: dict[str, list[dict[str, Any]]] = {}
                source_by_iso: dict[str, dict[str, Any]] = {}
                for collection in level_collections:
                    iso3 = collection["source"]["country_iso3"]
                    grouped.setdefault(iso3, []).extend(collection["features"])
                    source_by_iso[iso3] = collection["source"]

                is_adm1 = level == "ADM1"
                target_files = province_files if is_adm1 else district_files
                target_index = province_index if is_adm1 else district_index
                directory = "provinces" if is_adm1 else "districts"

                for iso3, features in grouped.items():
                    filename = f"{directory}/{iso3}.geojson"
                    source = source_by_iso[iso3]
                    target_files[filename] = iso3
                    target_index[iso3] = {
                        "iso3": iso3,
                        "country": source["country_name"],
                        "file": filename,
                        "feature_count": len(features),
                        "admin_level": level,
                        "source_metadata_url": source["source_metadata_url"],
                        "license": source["license"],
                        "year_represented": source["year_represented"],
                    }
                    output_payloads[filename] = {
                        "type": "FeatureCollection",
                        "name": f"{iso3}-{level}",
                        "generated_at_utc": started,
                        "source": source,
                        "features": features,
                    }

                # Keep province.json as a small lookup index instead of a single huge
                # FeatureCollection that exceeds GitHub's 100 MiB single-file limit.
                if is_adm1:
                    output_payloads["province.json"] = {
                        "schema_version": 1,
                        "name": "province-index",
                        "generated_at_utc": started,
                        "admin_level": "ADM1",
                        "country_count": len(province_index),
                        "countries": province_index,
                        "note": "ADM1 names differ by country; see each source and metadata record.",
                    }

                output_payloads["countries.json"] = {
            "schema_version": 1,
            "name": "country-index",
            "generated_at_utc": started,
            "countries": sorted(countries.values(), key=lambda item: item["name"].casefold()),
        }
        output_payloads["district-index.json"] = {
            "schema_version": 1,
            "name": "district-index",
            "generated_at_utc": started,
            "admin_level": "ADM2",
            "country_count": len(district_index),
            "countries": district_index,
            "note": "ADM2 labels vary by country; inspect source metadata and local terminology.",
        }
        output_payloads["boundary-manifest.json"] = {
            "schema_version": 1,
            "provider": "geoBoundaries gbOpen",
            "api_base": API_BASE,
            "generated_at_utc": started,
            "levels_requested": args.levels,
            "catalogue_counts": catalogue_counts,
            "success_counts": successes_by_level,
            "boundaries": [
                collection["source"]
                for level in args.levels
                for collection in collections_by_level[level]
            ],
            "errors": errors,
        }
        report = {
            "started_at_utc": started,
            "finished_at_utc": utc_now(),
            "country_count": len(countries),
            "catalogue_count_by_level": catalogue_counts,
            "successful_boundary_count_by_level": successes_by_level,
            "feature_count_by_level": {
                level: sum(len(collection["features"]) for collection in collections_by_level[level])
                for level in args.levels
            },
            "error_count": len(errors),
            "errors": errors[:250],
            "levels_requested": args.levels,
            "max_workers": MAX_WORKERS,
            "geometry_mode": "simplifiedGeometryGeoJSON preferred",
            "smoke_test": smoke_test,
            "published": False,
        }
        output_payloads["boundary-update-report.json"] = report

        for relative_path, payload in output_payloads.items():
            target = stage / relative_path
            write_json(target, payload)
            size = target.stat().st_size
            if size >= 95 * 1024 * 1024:
                raise RuntimeError(
                    f"{relative_path} is {size / (1024 * 1024):.1f} MiB, close to GitHub's 100 MiB file limit. "
                    "Existing generated data preserved."
                )
            print(f"[STAGED] {relative_path}: {size / 1024:.1f} KiB", flush=True)

        if smoke_test or args.dry_run:
            print(json.dumps({
                "dry_run": True,
                "smoke_test": smoke_test,
                "country_count": len(countries),
                "catalogue_count_by_level": catalogue_counts,
                "successful_boundary_count_by_level": successes_by_level,
                "error_count": len(errors),
                "staged_file_count": len(output_payloads),
                "district_country_file_count": len(district_files),
            }, ensure_ascii=False, indent=2))
            return 0

        # Publish only after every requested level and every staged JSON has passed checks.
        district_dir = DATA_DIR / "districts"
        district_dir.mkdir(parents=True, exist_ok=True)
        for relative_path in sorted(output_payloads):
            destination = DATA_DIR / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(stage / relative_path, destination)

        # Remove stale per-country files only after the replacement indexes are written.
        for dirname, expected_files in (
            ("provinces", set(province_files)),
            ("districts", set(district_files)),
        ):
            output_dir = DATA_DIR / dirname
            output_dir.mkdir(parents=True, exist_ok=True)
            for old_file in output_dir.glob("*.geojson"):
                relative = str(old_file.relative_to(DATA_DIR)).replace("\\", "/")
                if relative not in expected_files:
                    old_file.unlink()

        report["published"] = True
        report["finished_at_utc"] = utc_now()
        write_json(DATA_DIR / "boundary-update-report.json", report)
        print(json.dumps({
            "published": True,
            "country_count": len(countries),
            "catalogue_count_by_level": catalogue_counts,
            "successful_boundary_count_by_level": successes_by_level,
            "error_count": len(errors),
            "province_country_file_count": len(province_files),
            "district_country_file_count": len(district_files),
            "note": "Review data/boundary-manifest.json for attribution/license requirements.",
        }, ensure_ascii=False, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
