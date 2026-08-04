#!/usr/bin/env python3
"""Build a two-date Sentinel-2 before/after record for the ME Security Monitor.

The script:
- accepts a location and coordinate-based area of interest;
- finds the nearest suitable Sentinel-2 L2A scene around an "after" date;
- finds a comparison scene a configurable number of days earlier;
- downloads true-colour PNGs for both scenes;
- preserves the current single-image dashboard contract through top-level image_url;
- performs cautious visual change detection on the generated RGB PNG pair;
- writes a red-overlay change map and a structured change_detection result;
- writes a richer before/after archive record for the comparison UI.

Required environment variables:
    SENTINELHUB_CLIENT_ID
    SENTINELHUB_CLIENT_SECRET

Required Python packages:
    numpy
    opencv-python-headless
    scikit-image
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    import cv2
    import numpy as np
    from skimage.metrics import structural_similarity
except ImportError as dependency_error:  # pragma: no cover - checked at runtime
    cv2 = None
    np = None
    structural_similarity = None
    IMAGE_PROCESSING_IMPORT_ERROR = dependency_error
else:
    IMAGE_PROCESSING_IMPORT_ERROR = None


ROOT_DIR = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT_DIR / "docs"
SATELLITE_DIR = DOCS_DIR / "data" / "satellite"
SENTINEL2_DIR = SATELLITE_DIR / "sentinel2"
SENTINEL2_HISTORY_DIR = SENTINEL2_DIR / "history"

METADATA_PATH = SATELLITE_DIR / "satellite-metadata.json"
LATEST_IMAGE_PATH = SENTINEL2_DIR / "latest.png"
LATEST_JSON_PATH = SENTINEL2_DIR / "latest.json"
INDEX_JSON_PATH = SENTINEL2_DIR / "index.json"
ARCHIVE_INDEX_PATH = SATELLITE_DIR / "archive-index.json"

TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/"
    "protocol/openid-connect/token"
)
PROCESS_API_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"
CATALOG_API_URL = "https://sh.dataspace.copernicus.eu/catalog/v1/search"

WORKFLOW_VERSION = "3.0.0"
PROVIDER_NAME = "Sentinel Hub / Copernicus Data Space Ecosystem"
PRODUCT_NAME = "Sentinel-2 L2A True Color"
CHANGE_ENGINE_NAME = "ME Satellite Visual Change Detector"
CHANGE_ENGINE_VERSION = "1.0.0"

EVALSCRIPT_TRUE_COLOR = """
//VERSION=3
function setup() {
  return {
    input: ["B04", "B03", "B02", "dataMask"],
    output: { bands: 4 }
  };
}

function evaluatePixel(sample) {
  return [
    2.5 * sample.B04,
    2.5 * sample.B03,
    2.5 * sample.B02,
    sample.dataMask
  ];
}
"""


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def utc_now_iso() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def ensure_dirs() -> None:
    SATELLITE_DIR.mkdir(parents=True, exist_ok=True)
    SENTINEL2_DIR.mkdir(parents=True, exist_ok=True)
    SENTINEL2_HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def safe_coord(value: float) -> float:
    return round(float(value), 6)


def slugify(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"[^\w\s-]", "", normalized, flags=re.UNICODE)
    normalized = re.sub(r"[-\s]+", "-", normalized)
    normalized = normalized.strip("-")
    return normalized or "unknown-location"


def bbox_from_center(lat: float, lon: float, radius_km: float) -> list[float]:
    lat_delta = radius_km / 111.32
    cosine = math.cos(math.radians(lat))
    if abs(cosine) < 1e-8:
        raise ValueError("Longitude span is undefined too close to a pole.")
    lon_delta = radius_km / (111.32 * cosine)

    return [
        safe_coord(lon - lon_delta),
        safe_coord(lat - lat_delta),
        safe_coord(lon + lon_delta),
        safe_coord(lat + lat_delta),
    ]


def parse_iso_date(value: str, argument_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(
            f"{argument_name} must use ISO format YYYY-MM-DD: {value!r}"
        ) from error


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def day_start(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def day_end(value: date) -> datetime:
    return datetime.combine(value, time.max, tzinfo=timezone.utc)


def get_env_secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def request_json(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 60,
) -> dict[str, Any]:
    request = urllib.request.Request(
        url=url,
        data=data,
        method=method,
        headers=headers or {},
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP error {error.code} from {url}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network error while requesting {url}: {error}") from error


def http_post_form(url: str, form_data: dict[str, Any]) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(form_data).encode("utf-8")
    return request_json(
        url,
        method="POST",
        data=encoded,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        timeout=60,
    )


def http_post_catalog_json(
    url: str,
    payload: dict[str, Any],
    token: str,
) -> dict[str, Any]:
    return request_json(
        url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        timeout=120,
    )


def http_post_json_for_png(url: str, payload: dict[str, Any], token: str) -> bytes:
    request = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "image/png",
            "Authorization": f"Bearer {token}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            content_type = response.headers.get("Content-Type", "")
            data = response.read()

            if "image/png" not in content_type.lower():
                text = data.decode("utf-8", errors="replace")
                raise RuntimeError(
                    f"Expected image/png, received {content_type}: {text}"
                )

            return data
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP error {error.code} from {url}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network error while requesting {url}: {error}") from error


def get_access_token() -> str:
    response = http_post_form(
        TOKEN_URL,
        {
            "grant_type": "client_credentials",
            "client_id": get_env_secret("SENTINELHUB_CLIENT_ID"),
            "client_secret": get_env_secret("SENTINELHUB_CLIENT_SECRET"),
        },
    )

    token = response.get("access_token")
    if not token:
        raise RuntimeError("Sentinel Hub token response did not contain access_token.")

    return str(token)


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def catalog_scene_datetime(feature: dict[str, Any]) -> datetime | None:
    properties = feature.get("properties") or {}
    return parse_datetime(
        properties.get("datetime")
        or properties.get("start_datetime")
        or properties.get("end_datetime")
    )


def catalog_cloud_cover(feature: dict[str, Any]) -> float | None:
    properties = feature.get("properties") or {}
    value = properties.get("eo:cloud_cover")
    if value is None:
        value = properties.get("cloudCover")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def build_catalog_payload(
    bbox: list[float],
    requested_date: date,
    tolerance_days: int,
    max_cloud_coverage: int,
) -> dict[str, Any]:
    start = day_start(requested_date - timedelta(days=tolerance_days))
    end = day_end(requested_date + timedelta(days=tolerance_days))

    return {
        "bbox": bbox,
        "datetime": f"{iso_z(start)}/{iso_z(end)}",
        "collections": ["sentinel-2-l2a"],
        "limit": 100,
    }


def find_best_scene(
    token: str,
    bbox: list[float],
    requested_date: date,
    tolerance_days: int,
    max_cloud_coverage: int,
) -> dict[str, Any]:
    payload = build_catalog_payload(
        bbox=bbox,
        requested_date=requested_date,
        tolerance_days=tolerance_days,
        max_cloud_coverage=max_cloud_coverage,
    )
    response = http_post_catalog_json(CATALOG_API_URL, payload, token)
    features = response.get("features") or []

    candidates: list[tuple[float, float, datetime, dict[str, Any]]] = []
    requested_midday = datetime.combine(
        requested_date,
        time(hour=12),
        tzinfo=timezone.utc,
    )

    for feature in features:
        scene_dt = catalog_scene_datetime(feature)
        if scene_dt is None:
            continue
        cloud = catalog_cloud_cover(feature)

        if cloud is not None and cloud > float(max_cloud_coverage):
            continue

        cloud_score = cloud if cloud is not None else 101.0
        distance_seconds = abs((scene_dt - requested_midday).total_seconds())
        candidates.append((distance_seconds, cloud_score, scene_dt, feature))

    if not candidates:
        window_start = requested_date - timedelta(days=tolerance_days)
        window_end = requested_date + timedelta(days=tolerance_days)
        raise RuntimeError(
            "No Sentinel-2 L2A scene found for "
            f"{window_start.isoformat()} to {window_end.isoformat()} "
            f"with cloud coverage <= {max_cloud_coverage}%."
        )

    candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    _, cloud_score, scene_dt, feature = candidates[0]
    cloud = catalog_cloud_cover(feature)

    return {
        "feature_id": feature.get("id"),
        "acquisition_datetime": iso_z(scene_dt),
        "acquisition_date": scene_dt.date().isoformat(),
        "cloud_cover_percent": cloud,
        "catalog_feature": feature,
        "candidate_count": len(candidates),
        "cloud_score": cloud_score,
    }


def build_process_payload(
    bbox: list[float],
    acquisition_date: date,
    width: int,
    height: int,
    max_cloud_coverage: int,
) -> dict[str, Any]:
    start = day_start(acquisition_date)
    end = day_end(acquisition_date)

    return {
        "input": {
            "bounds": {
                "bbox": bbox,
                "properties": {
                    "crs": "http://www.opengis.net/def/crs/EPSG/0/4326"
                },
            },
            "data": [
                {
                    "type": "sentinel-2-l2a",
                    "dataFilter": {
                        "timeRange": {
                            "from": iso_z(start),
                            "to": iso_z(end),
                        },
                        "maxCloudCoverage": int(max_cloud_coverage),
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "output": {
            "width": int(width),
            "height": int(height),
            "responses": [
                {
                    "identifier": "default",
                    "format": {"type": "image/png"},
                }
            ],
        },
        "evalscript": EVALSCRIPT_TRUE_COLOR,
    }


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback

    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(path.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    temporary_path.replace(path)


def docs_relative_url(path: Path) -> str:
    return path.relative_to(DOCS_DIR).as_posix()


def normalize_image_url(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized.startswith("docs/"):
        normalized = normalized[len("docs/") :]
    return normalized


def normalize_existing_record(record: Any) -> Any:
    if not isinstance(record, dict):
        return record

    normalized = dict(record)

    for field in ("image_url", "url", "overlay_url", "file_url"):
        if field in normalized:
            normalized[field] = normalize_image_url(normalized[field])

    for side in ("before", "after"):
        side_value = normalized.get(side)
        if isinstance(side_value, dict):
            side_copy = dict(side_value)
            if "image_url" in side_copy:
                side_copy["image_url"] = normalize_image_url(side_copy["image_url"])
            normalized[side] = side_copy

    change_detection = normalized.get("change_detection")
    if isinstance(change_detection, dict):
        change_copy = dict(change_detection)
        if "change_map_url" in change_copy:
            change_copy["change_map_url"] = normalize_image_url(
                change_copy["change_map_url"]
            )
        normalized["change_detection"] = change_copy

    imagery = normalized.get("imagery")
    if isinstance(imagery, dict):
        imagery_copy = dict(imagery)
        for field in (
            "image_url",
            "latest_image",
            "history_image",
            "before_image",
            "after_image",
        ):
            if field in imagery_copy:
                imagery_copy[field] = normalize_image_url(imagery_copy[field])
        normalized["imagery"] = imagery_copy

    return normalized


def save_comparison_images(
    before_bytes: bytes,
    after_bytes: bytes,
    location_slug: str,
    before_scene: dict[str, Any],
    after_scene: dict[str, Any],
) -> dict[str, Any]:
    location_history_dir = SENTINEL2_HISTORY_DIR / location_slug
    location_history_dir.mkdir(parents=True, exist_ok=True)

    generated_stamp = utc_now().strftime("%Y-%m-%dT%H%M%SZ")
    before_date = before_scene["acquisition_date"]
    after_date = after_scene["acquisition_date"]

    before_path = location_history_dir / f"{before_date}_before_{generated_stamp}.png"
    after_path = location_history_dir / f"{after_date}_after_{generated_stamp}.png"

    before_path.write_bytes(before_bytes)
    after_path.write_bytes(after_bytes)

    # Backwards-compatible latest image: always the "after" image.
    LATEST_IMAGE_PATH.write_bytes(after_bytes)

    change_path = location_history_dir / (
        f"{after_date}_change_{generated_stamp}.png"
    )

    return {
        "generated_stamp": generated_stamp,
        "record_id": f"{location_slug}_{after_date}_{generated_stamp}",
        "latest_abs": str(LATEST_IMAGE_PATH),
        "latest_url": docs_relative_url(LATEST_IMAGE_PATH),
        "before_abs": str(before_path),
        "before_url": docs_relative_url(before_path),
        "after_abs": str(after_path),
        "after_url": docs_relative_url(after_path),
        "change_abs": str(change_path),
        "change_url": docs_relative_url(change_path),
    }



def require_image_processing_dependencies() -> None:
    if IMAGE_PROCESSING_IMPORT_ERROR is not None:
        raise RuntimeError(
            "Change detection requires numpy, opencv-python-headless and "
            "scikit-image. Install them before running the builder. "
            f"Import error: {IMAGE_PROCESSING_IMPORT_ERROR}"
        )


def load_png_bgra(path: Path) -> Any:
    require_image_processing_dependencies()
    data = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RuntimeError(f"OpenCV could not decode PNG: {path}")

    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA)
    elif image.shape[2] == 3:
        alpha = np.full(image.shape[:2], 255, dtype=np.uint8)
        image = np.dstack((image, alpha))
    elif image.shape[2] != 4:
        raise RuntimeError(f"Unsupported PNG channel count: {image.shape}")

    return image


def robust_channel_normalize(reference: Any, candidate: Any, mask: Any) -> Any:
    normalized = candidate.astype(np.float32).copy()
    reference_float = reference.astype(np.float32)
    valid = mask > 0

    if int(np.count_nonzero(valid)) < 100:
        return candidate.copy()

    for channel in range(3):
        reference_values = reference_float[:, :, channel][valid]
        candidate_values = normalized[:, :, channel][valid]

        ref_low, ref_high = np.percentile(reference_values, [2, 98])
        can_low, can_high = np.percentile(candidate_values, [2, 98])
        can_span = max(float(can_high - can_low), 1.0)
        ref_span = max(float(ref_high - ref_low), 1.0)

        normalized[:, :, channel] = (
            (normalized[:, :, channel] - can_low) * (ref_span / can_span)
            + ref_low
        )

    return np.clip(normalized, 0, 255).astype(np.uint8)


def apply_clahe_to_bgr(image: Any) -> Any:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lightness, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lightness = clahe.apply(lightness)
    return cv2.cvtColor(
        cv2.merge((lightness, a_channel, b_channel)),
        cv2.COLOR_LAB2BGR,
    )


def classify_change_level(score: float) -> str:
    if score < 20:
        return "LOW"
    if score < 45:
        return "MEDIUM"
    if score < 70:
        return "HIGH"
    return "VERY_HIGH"


def classify_comparability(score: float) -> str:
    if score >= 80:
        return "HIGH"
    if score >= 55:
        return "MEDIUM"
    return "LOW"


def build_change_assessment(
    level: str,
    changed_percent: float,
    comparability: str,
) -> str:
    if level == "LOW":
        statement = (
            "A képpár alapján csak korlátozott kiterjedésű vizuális eltérés "
            "azonosítható."
        )
    elif level == "MEDIUM":
        statement = (
            "A képpár több összefüggő vizuális eltérést jelez; emberi "
            "ellenőrzés indokolt."
        )
    elif level == "HIGH":
        statement = (
            "A képpár jelentős vizuális változást jelez; a változási térkép "
            "részletes elemzése indokolt."
        )
    else:
        statement = (
            "A képpár nagyon nagy kiterjedésű vizuális eltérést jelez. "
            "Először ki kell zárni a légköri és radiometriai eltéréseket."
        )

    return (
        f"{statement} A jelentősnek minősített pixelek aránya "
        f"{changed_percent:.2f}%. Az összehasonlíthatóság: {comparability}."
    )


def run_visual_change_detection(
    *,
    image_paths: dict[str, Any],
    before_scene: dict[str, Any],
    after_scene: dict[str, Any],
    radius_km: float,
) -> dict[str, Any]:
    require_image_processing_dependencies()
    started = datetime.now(timezone.utc)

    before_bgra = load_png_bgra(Path(image_paths["before_abs"]))
    after_bgra = load_png_bgra(Path(image_paths["after_abs"]))

    if before_bgra.shape[:2] != after_bgra.shape[:2]:
        after_bgra = cv2.resize(
            after_bgra,
            (before_bgra.shape[1], before_bgra.shape[0]),
            interpolation=cv2.INTER_AREA,
        )

    before_bgr = before_bgra[:, :, :3]
    after_bgr = after_bgra[:, :, :3]
    valid_mask = (
        (before_bgra[:, :, 3] > 0)
        & (after_bgra[:, :, 3] > 0)
        & (np.max(before_bgr, axis=2) > 3)
        & (np.max(after_bgr, axis=2) > 3)
    ).astype(np.uint8) * 255

    valid_ratio = float(np.count_nonzero(valid_mask)) / float(valid_mask.size)
    if valid_ratio < 0.35:
        raise RuntimeError(
            f"Only {valid_ratio * 100:.1f}% of the image pair is valid; "
            "change detection is not reliable."
        )

    after_normalized = robust_channel_normalize(before_bgr, after_bgr, valid_mask)
    before_enhanced = apply_clahe_to_bgr(before_bgr)
    after_enhanced = apply_clahe_to_bgr(after_normalized)

    before_gray = cv2.cvtColor(before_enhanced, cv2.COLOR_BGR2GRAY)
    after_gray = cv2.cvtColor(after_enhanced, cv2.COLOR_BGR2GRAY)
    before_gray = cv2.GaussianBlur(before_gray, (5, 5), 0)
    after_gray = cv2.GaussianBlur(after_gray, (5, 5), 0)

    ssim_value, ssim_map = structural_similarity(
        before_gray,
        after_gray,
        full=True,
        data_range=255,
    )
    ssim_difference = np.clip(1.0 - ssim_map, 0.0, 1.0)

    absolute_difference = cv2.absdiff(before_gray, after_gray).astype(np.float32) / 255.0
    combined_difference = (0.62 * ssim_difference) + (0.38 * absolute_difference)
    valid_values = combined_difference[valid_mask > 0]

    percentile_threshold = float(np.percentile(valid_values, 92.0))
    robust_threshold = max(0.13, min(percentile_threshold, 0.42))
    raw_change_mask = (
        (combined_difference >= robust_threshold) & (valid_mask > 0)
    ).astype(np.uint8) * 255

    height, width = raw_change_mask.shape
    kernel_size = max(3, int(round(min(height, width) / 300)))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (kernel_size, kernel_size),
    )
    cleaned_mask = cv2.morphologyEx(raw_change_mask, cv2.MORPH_OPEN, kernel)
    cleaned_mask = cv2.morphologyEx(cleaned_mask, cv2.MORPH_CLOSE, kernel)

    minimum_region_pixels = max(24, int(valid_mask.size * 0.00008))
    contours, _ = cv2.findContours(
        cleaned_mask,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    retained_contours = [
        contour
        for contour in contours
        if cv2.contourArea(contour) >= minimum_region_pixels
    ]

    significant_mask = np.zeros_like(cleaned_mask)
    if retained_contours:
        cv2.drawContours(
            significant_mask,
            retained_contours,
            -1,
            255,
            thickness=cv2.FILLED,
        )

    valid_pixels = max(int(np.count_nonzero(valid_mask)), 1)
    changed_pixels = int(np.count_nonzero(significant_mask))
    changed_percent = (changed_pixels / valid_pixels) * 100.0
    region_areas = [float(cv2.contourArea(contour)) for contour in retained_contours]
    largest_region_pixels = max(region_areas, default=0.0)
    largest_region_percent = (largest_region_pixels / valid_pixels) * 100.0

    # Approximate ground area from the coordinate-radius AOI. This is a
    # screening estimate, not cadastral measurement.
    aoi_area_km2 = math.pi * float(radius_km) ** 2
    changed_area_km2 = aoi_area_km2 * (changed_percent / 100.0)
    largest_region_km2 = aoi_area_km2 * (largest_region_percent / 100.0)

    valid = valid_mask > 0
    before_luma = before_gray[valid].astype(np.float32)
    after_luma = after_gray[valid].astype(np.float32)
    mean_difference = abs(float(before_luma.mean()) - float(after_luma.mean())) / 255.0
    contrast_difference = abs(float(before_luma.std()) - float(after_luma.std())) / 128.0

    before_cloud = before_scene.get("cloud_cover_percent")
    after_cloud = after_scene.get("cloud_cover_percent")
    cloud_values = [
        float(value)
        for value in (before_cloud, after_cloud)
        if value is not None
    ]
    mean_cloud = sum(cloud_values) / len(cloud_values) if cloud_values else 50.0

    comparability_score = 100.0
    comparability_score -= min(mean_difference * 120.0, 25.0)
    comparability_score -= min(contrast_difference * 35.0, 20.0)
    comparability_score -= min(mean_cloud * 0.32, 25.0)
    comparability_score -= max(0.0, (0.85 - valid_ratio) * 50.0)
    comparability_score = max(0.0, min(100.0, comparability_score))
    comparability = classify_comparability(comparability_score)

    region_factor = min(len(retained_contours) / 15.0, 1.0)
    change_score = min(
        100.0,
        (changed_percent * 3.4)
        + (largest_region_percent * 2.0)
        + (region_factor * 12.0),
    )
    # Reduce confidence in the score when comparability is weak, but keep the
    # measured changed-pixel percentage intact in the JSON.
    change_score *= 0.65 + (comparability_score / 100.0) * 0.35
    change_score = max(0.0, min(100.0, change_score))
    level = classify_change_level(change_score)

    warnings: list[str] = []
    if mean_difference > 0.12:
        warnings.append(
            "Jelentős fényesség- vagy légköri eltérés van a két kép között."
        )
    if contrast_difference > 0.18:
        warnings.append(
            "A képek kontrasztja eltér; kisebb változások bizonytalanok lehetnek."
        )
    if mean_cloud > 35:
        warnings.append(
            "A katalógus felhőborítottsági értéke magas; az eredmény óvatosan értékelendő."
        )
    if comparability == "LOW":
        warnings.append(
            "Alacsony összehasonlíthatóság: az eredmény csak előszűrésre használható."
        )
    warnings.append(
        "A rendszer vizuális eltérést jelez, nem azonosítja automatikusan a változás okát."
    )

    overlay = after_bgr.copy()
    red_layer = np.zeros_like(overlay)
    red_layer[:, :, 2] = 255
    alpha_mask = (significant_mask.astype(np.float32) / 255.0 * 0.52)[:, :, None]
    overlay = (
        overlay.astype(np.float32) * (1.0 - alpha_mask)
        + red_layer.astype(np.float32) * alpha_mask
    ).astype(np.uint8)
    if retained_contours:
        cv2.drawContours(overlay, retained_contours, -1, (0, 0, 255), 2)

    label = (
        f"CHANGE {change_score:.0f}/100 | {level} | "
        f"changed {changed_percent:.2f}%"
    )
    cv2.rectangle(overlay, (0, 0), (min(width, 720), 42), (15, 23, 42), -1)
    cv2.putText(
        overlay,
        label,
        (12, 28),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.68,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )

    change_path = Path(image_paths["change_abs"])
    change_path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(change_path), overlay):
        raise RuntimeError(f"Could not save change map: {change_path}")

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    assessment = build_change_assessment(
        level,
        changed_percent,
        comparability,
    )

    return {
        "status": "completed",
        "engine": CHANGE_ENGINE_NAME,
        "engine_version": CHANGE_ENGINE_VERSION,
        "method": "CLAHE + radiometric normalization + SSIM + absolute difference + morphology",
        "interpretation": "automatic_visual_change_indication",
        "score": round(change_score, 2),
        "level": level,
        "confidence_percent": round(comparability_score, 2),
        "comparability": comparability,
        "comparability_score": round(comparability_score, 2),
        "ssim": round(float(ssim_value), 6),
        "changed_pixel_percent": round(changed_percent, 4),
        "changed_area_km2_estimate": round(changed_area_km2, 4),
        "significant_regions": len(retained_contours),
        "largest_region_percent": round(largest_region_percent, 4),
        "largest_region_km2_estimate": round(largest_region_km2, 4),
        "valid_pixel_percent": round(valid_ratio * 100.0, 4),
        "difference_threshold": round(robust_threshold, 6),
        "minimum_region_pixels": int(minimum_region_pixels),
        "change_map_url": image_paths["change_url"],
        "assessment": assessment,
        "warnings": warnings,
        "processing_time_seconds": round(elapsed, 3),
        "limitations": [
            "Sentinel-2 RGB visual product with approximately 10 m ground sampling distance.",
            "Small objects and limited structural damage cannot be reliably resolved.",
            "The change score is a screening indicator and requires analyst verification.",
        ],
    }

def scene_archive_payload(
    *,
    role: str,
    requested_date: date,
    scene: dict[str, Any],
    image_url: str,
    tolerance_days: int,
) -> dict[str, Any]:
    acquisition_date = parse_iso_date(scene["acquisition_date"], "acquisition_date")
    offset = (acquisition_date - requested_date).days

    return {
        "role": role,
        "requested_date": requested_date.isoformat(),
        "search_tolerance_days": int(tolerance_days),
        "acquisition_date": scene["acquisition_date"],
        "acquisition_datetime": scene["acquisition_datetime"],
        "date_offset_days": offset,
        "cloud_cover_percent": scene.get("cloud_cover_percent"),
        "catalog_feature_id": scene.get("feature_id"),
        "catalog_candidate_count": scene.get("candidate_count"),
        "image_url": image_url,
    }


def build_record(
    *,
    location_name: str,
    location_slug: str,
    lat: float,
    lon: float,
    radius_km: float,
    bbox: list[float],
    target_date: date,
    comparison_days: int,
    tolerance_days: int,
    width: int,
    height: int,
    max_cloud_coverage: int,
    before_scene: dict[str, Any],
    after_scene: dict[str, Any],
    image_paths: dict[str, Any],
    change_detection: dict[str, Any],
) -> dict[str, Any]:
    before_requested = target_date - timedelta(days=comparison_days)

    before = scene_archive_payload(
        role="before",
        requested_date=before_requested,
        scene=before_scene,
        image_url=image_paths["before_url"],
        tolerance_days=tolerance_days,
    )
    after = scene_archive_payload(
        role="after",
        requested_date=target_date,
        scene=after_scene,
        image_url=image_paths["after_url"],
        tolerance_days=tolerance_days,
    )

    generated_at = utc_now_iso()

    return {
        "id": image_paths["record_id"],
        "generated_at": generated_at,
        "timestamp": after_scene["acquisition_datetime"],
        "provider": "sentinel2",
        "source": PROVIDER_NAME,
        "product": PRODUCT_NAME,
        "workflow_version": WORKFLOW_VERSION,
        "location_name": location_name,
        "location_slug": location_slug,
        "requested_date": target_date.isoformat(),
        "comparison_days": int(comparison_days),
        "search_tolerance_days": int(tolerance_days),
        "image_size": {
            "width": int(width),
            "height": int(height),
        },
        "max_cloud_coverage_requested": int(max_cloud_coverage),
        "target_area": {
            "mode": "coordinate_radius",
            "lat": safe_coord(lat),
            "lon": safe_coord(lon),
            "radius_km": float(radius_km),
            "bbox": bbox,
        },
        # Existing Satellite Intelligence v1 compatibility.
        "bbox": bbox,
        "image_url": image_paths["after_url"],
        "before": before,
        "after": after,
        "change_detection": change_detection,
        "comparison": {
            "mode": "before_after",
            "requested_after_date": target_date.isoformat(),
            "requested_before_date": before_requested.isoformat(),
            "comparison_days": int(comparison_days),
            "search_tolerance_days": int(tolerance_days),
            "before_image_url": image_paths["before_url"],
            "after_image_url": image_paths["after_url"],
            "change_map_url": image_paths["change_url"],
        },
        "imagery": {
            "image_available": True,
            "image_url": image_paths["after_url"],
            "latest_image": image_paths["latest_url"],
            "before_image": image_paths["before_url"],
            "after_image": image_paths["after_url"],
            "change_map": image_paths["change_url"],
            "acquisition_date": after_scene["acquisition_date"],
            "cloud_cover_percent": after_scene.get("cloud_cover_percent"),
            "bounds": {
                "west": bbox[0],
                "south": bbox[1],
                "east": bbox[2],
                "north": bbox[3],
            },
            "width": int(width),
            "height": int(height),
        },
    }


def update_record_list(path: Path, record: dict[str, Any]) -> list[dict[str, Any]]:
    existing = load_json(path, [])
    if not isinstance(existing, list):
        existing = []

    normalized_existing = [
        normalize_existing_record(item)
        for item in existing
        if isinstance(item, dict)
    ]

    # Keep historical runs. Only exact record IDs are replaced.
    records = [item for item in normalized_existing if item.get("id") != record["id"]]
    records.append(record)
    records.sort(key=lambda item: str(item.get("generated_at", "")), reverse=True)
    write_json_atomic(path, records)
    return records


def write_latest_json(record: dict[str, Any]) -> None:
    write_json_atomic(LATEST_JSON_PATH, record)


def write_metadata(record: dict[str, Any], archive_count: int) -> None:
    metadata = {
        "generated_at": utc_now_iso(),
        "module": "satellite",
        "status": "ok",
        "workflow_version": WORKFLOW_VERSION,
        "default_provider": "sentinel2",
        "provider": {
            "key": "sentinel2",
            "name": "Sentinel-2",
            "type": "optical",
            "enabled": True,
            "source": PROVIDER_NAME,
            "resolution_m": 10,
            "auth_required": True,
        },
        "latest_record": record,
        "archive_record_count": int(archive_count),
        "target_area": record["target_area"],
        "comparison": record["comparison"],
        "change_detection": record.get("change_detection"),
        "capabilities": {
            "true_color": True,
            "before_after": True,
            "catalog_scene_selection": True,
            "actual_acquisition_date": True,
            "cloud_cover_metadata": True,
            "false_color": False,
            "burn_index": False,
            "change_detection": True,
            "change_map": True,
            "visual_change_score": True,
            "sentinel1_radar": False,
        },
        "data_paths": {
            "latest_image": docs_relative_url(LATEST_IMAGE_PATH),
            "latest_json": docs_relative_url(LATEST_JSON_PATH),
            "index_json": docs_relative_url(INDEX_JSON_PATH),
            "archive_index_json": docs_relative_url(ARCHIVE_INDEX_PATH),
            "history_dir": docs_relative_url(SENTINEL2_HISTORY_DIR) + "/",
        },
    }
    write_json_atomic(METADATA_PATH, metadata)


def validate_args(args: argparse.Namespace) -> None:
    if not -90 <= args.lat <= 90:
        raise ValueError("Latitude must be between -90 and 90.")
    if not -180 <= args.lon <= 180:
        raise ValueError("Longitude must be between -180 and 180.")
    if not 0.1 <= args.radius_km <= 100:
        raise ValueError("radius-km must be between 0.1 and 100.")
    if not 1 <= args.days_back <= 365:
        raise ValueError("days-back must be between 1 and 365.")
    if not 1 <= args.comparison_days <= 3650:
        raise ValueError("comparison-days must be between 1 and 3650.")
    if not 0 <= args.tolerance_days <= 30:
        raise ValueError("tolerance-days must be between 0 and 30.")
    if not 0 <= args.max_cloud <= 100:
        raise ValueError("max-cloud must be between 0 and 100.")
    if not 128 <= args.width <= 2500 or not 128 <= args.height <= 2500:
        raise ValueError("width and height must be between 128 and 2500 pixels.")
    if not args.location_name.strip():
        raise ValueError("location-name must not be empty.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ME Sentinel-2 before/after True Color image builder"
    )

    parser.add_argument("--location-name", required=True, type=str)
    parser.add_argument("--lat", required=True, type=float)
    parser.add_argument("--lon", required=True, type=float)
    parser.add_argument("--radius-km", default=10, type=float)

    # Kept for compatibility with the existing workflow. If --target-date is
    # omitted, days-back defines the latest acceptable requested date window
    # only indirectly; the requested target date remains today.
    parser.add_argument("--days-back", default=30, type=int)
    parser.add_argument("--target-date", default=None, type=str)
    parser.add_argument("--comparison-days", default=30, type=int)
    parser.add_argument("--tolerance-days", default=5, type=int)

    parser.add_argument("--width", default=1024, type=int)
    parser.add_argument("--height", default=1024, type=int)
    parser.add_argument("--max-cloud", default=80, type=int)

    return parser.parse_args()


def download_scene_image(
    *,
    token: str,
    bbox: list[float],
    scene: dict[str, Any],
    width: int,
    height: int,
    max_cloud: int,
) -> bytes:
    acquisition_date = parse_iso_date(scene["acquisition_date"], "acquisition_date")
    payload = build_process_payload(
        bbox=bbox,
        acquisition_date=acquisition_date,
        width=width,
        height=height,
        max_cloud_coverage=max_cloud,
    )
    image_bytes = http_post_json_for_png(PROCESS_API_URL, payload, token)
    if len(image_bytes) < 1000:
        raise RuntimeError("Downloaded image is unexpectedly small.")
    if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Downloaded content is not a valid PNG signature.")
    return image_bytes


def main() -> None:
    args = parse_args()
    validate_args(args)
    ensure_dirs()

    lat = safe_coord(args.lat)
    lon = safe_coord(args.lon)
    radius_km = float(args.radius_km)
    location_name = args.location_name.strip()
    location_slug = slugify(location_name)

    target_date = (
        parse_iso_date(args.target_date, "target-date")
        if args.target_date
        else utc_now().date()
    )
    before_requested_date = target_date - timedelta(days=args.comparison_days)
    bbox = bbox_from_center(lat=lat, lon=lon, radius_km=radius_km)

    print("ME Sentinel-2 before/after build started")
    print(f"Location: {location_name}")
    print(f"Location slug: {location_slug}")
    print(f"Coordinate: {lat}, {lon}")
    print(f"Radius: {radius_km} km")
    print(f"BBox: {bbox}")
    print(f"Requested AFTER date: {target_date.isoformat()}")
    print(f"Requested BEFORE date: {before_requested_date.isoformat()}")
    print(f"Comparison distance: {args.comparison_days} days")
    print(f"Search tolerance: ±{args.tolerance_days} days")
    print(f"Maximum cloud coverage: {args.max_cloud}%")

    token = get_access_token()

    print("Searching Catalog API for BEFORE scene...")
    before_scene = find_best_scene(
        token=token,
        bbox=bbox,
        requested_date=before_requested_date,
        tolerance_days=args.tolerance_days,
        max_cloud_coverage=args.max_cloud,
    )
    print(
        "BEFORE selected: "
        f"{before_scene['acquisition_datetime']} | "
        f"cloud={before_scene.get('cloud_cover_percent')}% | "
        f"feature={before_scene.get('feature_id')}"
    )

    print("Searching Catalog API for AFTER scene...")
    after_scene = find_best_scene(
        token=token,
        bbox=bbox,
        requested_date=target_date,
        tolerance_days=args.tolerance_days,
        max_cloud_coverage=args.max_cloud,
    )
    print(
        "AFTER selected: "
        f"{after_scene['acquisition_datetime']} | "
        f"cloud={after_scene.get('cloud_cover_percent')}% | "
        f"feature={after_scene.get('feature_id')}"
    )

    if before_scene["feature_id"] == after_scene["feature_id"]:
        print(
            "WARNING: BEFORE and AFTER resolved to the same catalog feature. "
            "Increase comparison-days or reduce tolerance-days if this is unintended."
        )

    print("Downloading BEFORE image...")
    before_bytes = download_scene_image(
        token=token,
        bbox=bbox,
        scene=before_scene,
        width=args.width,
        height=args.height,
        max_cloud=args.max_cloud,
    )

    print("Downloading AFTER image...")
    after_bytes = download_scene_image(
        token=token,
        bbox=bbox,
        scene=after_scene,
        width=args.width,
        height=args.height,
        max_cloud=args.max_cloud,
    )

    image_paths = save_comparison_images(
        before_bytes=before_bytes,
        after_bytes=after_bytes,
        location_slug=location_slug,
        before_scene=before_scene,
        after_scene=after_scene,
    )

    print("Running automatic visual change detection...")
    change_detection = run_visual_change_detection(
        image_paths=image_paths,
        before_scene=before_scene,
        after_scene=after_scene,
        radius_km=radius_km,
    )
    print(
        "Change detection completed: "
        f"score={change_detection['score']}/100 | "
        f"level={change_detection['level']} | "
        f"changed={change_detection['changed_pixel_percent']}% | "
        f"comparability={change_detection['comparability']}"
    )

    record = build_record(
        location_name=location_name,
        location_slug=location_slug,
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        bbox=bbox,
        target_date=target_date,
        comparison_days=args.comparison_days,
        tolerance_days=args.tolerance_days,
        width=args.width,
        height=args.height,
        max_cloud_coverage=args.max_cloud,
        before_scene=before_scene,
        after_scene=after_scene,
        image_paths=image_paths,
        change_detection=change_detection,
    )

    write_latest_json(record)
    sentinel_index = update_record_list(INDEX_JSON_PATH, record)
    archive_index = update_record_list(ARCHIVE_INDEX_PATH, record)
    write_metadata(record, archive_count=len(archive_index))

    print("Build completed successfully.")
    print(f"BEFORE image: {image_paths['before_abs']}")
    print(f"AFTER image: {image_paths['after_abs']}")
    print(f"CHANGE map: {image_paths['change_abs']}")
    print(f"Latest compatibility image: {image_paths['latest_abs']}")
    print(f"Latest JSON: {LATEST_JSON_PATH}")
    print(f"Sentinel index: {INDEX_JSON_PATH} ({len(sentinel_index)} records)")
    print(f"ME archive index: {ARCHIVE_INDEX_PATH} ({len(archive_index)} records)")
    print(f"Metadata: {METADATA_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exi
