import argparse
import json
import math
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]

# The ME Security Monitor is published from the repository's docs directory,
# while its main page may also be opened from the repository root during testing.
# Therefore every generated satellite asset is stored under docs/data.
SATELLITE_DIR = ROOT_DIR / "docs" / "data" / "satellite"
SENTINEL2_DIR = SATELLITE_DIR / "sentinel2"
SENTINEL2_HISTORY_DIR = SENTINEL2_DIR / "history"

METADATA_PATH = SATELLITE_DIR / "satellite-metadata.json"
ARCHIVE_INDEX_PATH = SATELLITE_DIR / "archive-index.json"
LATEST_IMAGE_PATH = SENTINEL2_DIR / "latest.png"
LATEST_JSON_PATH = SENTINEL2_DIR / "latest.json"
SENTINEL2_INDEX_PATH = SENTINEL2_DIR / "index.json"

TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/"
    "protocol/openid-connect/token"
)
PROCESS_API_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"

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
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Coordinate must be a finite number.")
    return round(number, 6)


def validate_target(lat: float, lon: float, radius_km: float) -> None:
    if not -90 <= lat <= 90:
        raise ValueError("Latitude must be between -90 and 90.")
    if not -180 <= lon <= 180:
        raise ValueError("Longitude must be between -180 and 180.")
    if not 0.5 <= radius_km <= 100:
        raise ValueError("Radius must be between 0.5 and 100 km.")
    if abs(lat) >= 89.5:
        raise ValueError("Targets closer than 0.5 degrees to a pole are unsupported.")


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.strip())
    normalized = normalized.encode("ascii", "ignore").decode("ascii")
    normalized = normalized.lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    return normalized or "unknown-location"


def bbox_from_center(lat: float, lon: float, radius_km: float) -> list[float]:
    lat_delta = radius_km / 111.32
    cosine = max(abs(math.cos(math.radians(lat))), 0.01)
    lon_delta = radius_km / (111.32 * cosine)

    west = max(-180.0, lon - lon_delta)
    south = max(-90.0, lat - lat_delta)
    east = min(180.0, lon + lon_delta)
    north = min(90.0, lat + lat_delta)

    return [
        safe_coord(west),
        safe_coord(south),
        safe_coord(east),
        safe_coord(north),
    ]


def get_env_secret(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def http_post_form(url: str, form_data: dict[str, Any]) -> dict[str, Any]:
    encoded = urllib.parse.urlencode(form_data).encode("utf-8")
    request = urllib.request.Request(
        url=url,
        data=encoded,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "ME-Security-Monitor-Sentinel2-Builder/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP error {error.code} from {url}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Network error while requesting {url}: {error}") from error


def http_post_json_for_png(url: str, payload: dict[str, Any], token: str) -> bytes:
    request = urllib.request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "image/png",
            "Authorization": f"Bearer {token}",
            "User-Agent": "ME-Security-Monitor-Sentinel2-Builder/1.0",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            content_type = response.headers.get("Content-Type", "")
            data = response.read()
            if "image/png" not in content_type:
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


def build_process_payload(
    bbox: list[float],
    start_date: str,
    end_date: str,
    width: int,
    height: int,
    max_cloud_coverage: int,
) -> dict[str, Any]:
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
                            "from": f"{start_date}T00:00:00Z",
                            "to": f"{end_date}T23:59:59Z",
                        },
                        "maxCloudCoverage": max_cloud_coverage,
                        "mosaickingOrder": "leastCC",
                    },
                }
            ],
        },
        "output": {
            "width": width,
            "height": height,
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
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    temporary.replace(path)


def save_png(image_bytes: bytes, location_slug: str) -> dict[str, Any]:
    LATEST_IMAGE_PATH.write_bytes(image_bytes)

    generated = utc_now()
    timestamp = generated.strftime("%Y-%m-%dT%H%M%SZ")
    record_id = f"{location_slug}_{timestamp}"

    location_history_dir = SENTINEL2_HISTORY_DIR / location_slug
    location_history_dir.mkdir(parents=True, exist_ok=True)

    history_name = f"{timestamp}.png"
    history_path = location_history_dir / history_name
    history_path.write_bytes(image_bytes)

    # Paths are intentionally repository-root relative because the current ME
    # dashboard first loads ./docs/data/satellite/archive-index.json.
    latest_web_path = "./docs/data/satellite/sentinel2/latest.png"
    history_web_path = (
        f"./docs/data/satellite/sentinel2/history/{location_slug}/{history_name}"
    )

    return {
        "record_id": record_id,
        "timestamp": timestamp,
        "latest_web_path": latest_web_path,
        "history_web_path": history_web_path,
        "latest_abs": str(LATEST_IMAGE_PATH),
        "history_abs": str(history_path),
    }


def build_record(
    location_name: str,
    location_slug: str,
    lat: float,
    lon: float,
    radius_km: float,
    bbox: list[float],
    start_date: str,
    end_date: str,
    width: int,
    height: int,
    max_cloud_coverage: int,
    image_paths: dict[str, Any],
) -> dict[str, Any]:
    generated_at = utc_now_iso()
    return {
        "id": image_paths["record_id"],
        "record_id": image_paths["record_id"],
        "generated_at": generated_at,
        "timestamp": image_paths["timestamp"],
        "provider": "sentinel2",
        "source": "Sentinel Hub / Copernicus Data Space Ecosystem",
        "product": "Sentinel-2 L2A True Color",
        "location_name": location_name,
        "location_slug": location_slug,
        # Direct fields used by the ME Satellite Intelligence layer.
        "image_url": image_paths["history_web_path"],
        "bbox": bbox,
        "lat": safe_coord(lat),
        "lon": safe_coord(lon),
        "radius_km": radius_km,
        "target_area": {
            "mode": "coordinate_radius",
            "name": location_name,
            "lat": safe_coord(lat),
            "lon": safe_coord(lon),
            "radius_km": radius_km,
            "bbox": bbox,
        },
        "imagery": {
            "image_available": True,
            "image_url": image_paths["history_web_path"],
            "latest_image": image_paths["latest_web_path"],
            "history_image": image_paths["history_web_path"],
            "requested_time_range": {
                "from": start_date,
                "to": end_date,
            },
            "acquisition_date": None,
            "cloud_cover_percent": None,
            "max_cloud_coverage_requested": max_cloud_coverage,
            "width": width,
            "height": height,
            "bounds": {
                "west": bbox[0],
                "south": bbox[1],
                "east": bbox[2],
                "north": bbox[3],
            },
        },
    }


def update_list_index(path: Path, record: dict[str, Any]) -> list[dict[str, Any]]:
    index = load_json(path, [])
    if isinstance(index, dict):
        index = index.get("records") or index.get("images") or []
    if not isinstance(index, list):
        index = []

    index = [
        item
        for item in index
        if isinstance(item, dict) and item.get("id") != record["id"]
    ]
    index.append(record)
    index.sort(key=lambda item: str(item.get("generated_at", "")), reverse=True)
    write_json_atomic(path, index)
    return index


def write_metadata(record: dict[str, Any], record_count: int) -> None:
    metadata = {
        "generated_at": utc_now_iso(),
        "module": "satellite-intelligence",
        "status": "ok",
        "default_provider": "sentinel2",
        "provider": {
            "key": "sentinel2",
            "name": "Sentinel-2",
            "type": "optical",
            "enabled": True,
            "source": "Sentinel Hub / Copernicus Data Space Ecosystem",
            "resolution_m": 10,
            "auth_required": True,
        },
        "latest_record": record,
        "record_count": record_count,
        "imagery": record["imagery"],
        "target_area": record["target_area"],
        "capabilities": {
            "coordinate_target": True,
            "true_color": True,
            "archive": True,
            "history": True,
            "leaflet_image_overlay": True,
            "false_color": False,
            "burn_index": False,
            "before_after": False,
            "change_detection": False,
            "sentinel1_radar": False,
        },
        "data_paths": {
            "archive_index": "docs/data/satellite/archive-index.json",
            "latest_image": "docs/data/satellite/sentinel2/latest.png",
            "latest_json": "docs/data/satellite/sentinel2/latest.json",
            "sentinel2_index": "docs/data/satellite/sentinel2/index.json",
            "history_dir": "docs/data/satellite/sentinel2/history/",
        },
    }
    write_json_atomic(METADATA_PATH, metadata)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a Sentinel-2 True Color overlay for ME Security Monitor"
    )
    parser.add_argument("--location-name", required=True, type=str)
    parser.add_argument("--lat", required=True, type=float)
    parser.add_argument("--lon", required=True, type=float)
    parser.add_argument("--radius-km", default=10, type=float)
    parser.add_argument("--days-back", default=30, type=int)
    parser.add_argument("--width", default=1024, type=int)
    parser.add_argument("--height", default=1024, type=int)
    parser.add_argument("--max-cloud", default=80, type=int)
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if not args.location_name.strip():
        raise ValueError("Location name cannot be empty.")
    if not 1 <= int(args.days_back) <= 365:
        raise ValueError("days-back must be between 1 and 365.")
    if not 256 <= int(args.width) <= 2500:
        raise ValueError("width must be between 256 and 2500 pixels.")
    if not 256 <= int(args.height) <= 2500:
        raise ValueError("height must be between 256 and 2500 pixels.")
    if not 0 <= int(args.max_cloud) <= 100:
        raise ValueError("max-cloud must be between 0 and 100.")


def main() -> None:
    args = parse_args()
    validate_args(args)
    ensure_dirs()

    lat = safe_coord(args.lat)
    lon = safe_coord(args.lon)
    radius_km = float(args.radius_km)
    validate_target(lat, lon, radius_km)

    location_name = args.location_name.strip()
    location_slug = slugify(location_name)

    end_dt = utc_now().date()
    start_dt = end_dt - timedelta(days=int(args.days_back))
    start_date = start_dt.isoformat()
    end_date = end_dt.isoformat()
    bbox = bbox_from_center(lat=lat, lon=lon, radius_km=radius_km)

    print("ME Sentinel-2 build started")
    print(f"Location: {location_name}")
    print(f"Location slug: {location_slug}")
    print(f"Coordinate: {lat}, {lon}")
    print(f"Radius: {radius_km} km")
    print(f"BBox: {bbox}")
    print(f"Time range: {start_date} to {end_date}")

    token = get_access_token()
    payload = build_process_payload(
        bbox=bbox,
        start_date=start_date,
        end_date=end_date,
        width=int(args.width),
        height=int(args.height),
        max_cloud_coverage=int(args.max_cloud),
    )
    image_bytes = http_post_json_for_png(PROCESS_API_URL, payload, token)

    if len(image_bytes) < 1000:
        raise RuntimeError("Downloaded image is unexpectedly small.")
    if not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError("Downloaded content is not a valid PNG file.")

    image_paths = save_png(image_bytes=image_bytes, location_slug=location_slug)
    record = build_record(
        location_name=location_name,
        location_slug=location_slug,
        lat=lat,
        lon=lon,
        radius_km=radius_km,
        bbox=bbox,
        start_date=start_date,
        end_date=end_date,
        width=int(args.width),
        height=int(args.height),
        max_cloud_coverage=int(args.max_cloud),
        image_paths=image_paths,
    )

    write_json_atomic(LATEST_JSON_PATH, record)
    sentinel_index = update_list_index(SENTINEL2_INDEX_PATH, record)
    archive_index = update_list_index(ARCHIVE_INDEX_PATH, record)
    write_metadata(record, len(archive_index))

    print(f"Latest Sentinel-2 image saved: {image_paths['latest_abs']}")
    print(f"History Sentinel-2 image saved: {image_paths['history_abs']}")
    print(f"Latest JSON saved: {LATEST_JSON_PATH}")
    print(f"Sentinel-2 index saved: {SENTINEL2_INDEX_PATH} ({len(sentinel_index)} records)")
    print(f"ME archive index saved: {ARCHIVE_INDEX_PATH} ({len(archive_index)} records)")
    print(f"Metadata updated: {METADATA_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
