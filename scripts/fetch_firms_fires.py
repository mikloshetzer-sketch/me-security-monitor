import os
import csv
import json
import time
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

OUTPUT_PATH = "fires.json"

# Middle East bbox (durva, de jó zajszűrő)
ME_LAT_MIN, ME_LAT_MAX = 10.0, 42.0
ME_LNG_MIN, ME_LNG_MAX = 25.0, 65.0

# FIRMS: “last N days” lekérés (world/2) + mi 48 órát tartunk meg
API_DAYS = 2
KEEP_HOURS = 48

# NRT források (stabil, friss)
SOURCES = [
    "VIIRS_SNPP_NRT",
    "VIIRS_NOAA20_NRT",
]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def parse_acq_datetime(acq_date: str, acq_time: str):
    """
    FIRMS CSV tipikusan:
      acq_date: YYYY-MM-DD
      acq_time: HHMM (UTC)
    """
    if not acq_date:
        return None
    acq_time = (acq_time or "").strip()
    if len(acq_time) == 4 and acq_time.isdigit():
        hh = int(acq_time[:2])
        mm = int(acq_time[2:])
    else:
        hh, mm = 0, 0
    try:
        dt = datetime(
            int(acq_date[0:4]),
            int(acq_date[5:7]),
            int(acq_date[8:10]),
            hh, mm, 0,
            tzinfo=timezone.utc
        )
        return dt
    except Exception:
        return None

def in_middle_east(lat: float, lng: float) -> bool:
    return (ME_LAT_MIN <= lat <= ME_LAT_MAX) and (ME_LNG_MIN <= lng <= ME_LNG_MAX)

def hours_ago(dt: datetime) -> float:
    return (datetime.now(timezone.utc) - dt).total_seconds() / 3600.0

def http_get_text(url: str, timeout=30, retries=3, backoff=2.0) -> str:
    last_err = None
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "ME-Security-Monitor/1.0"})
            with urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError) as e:
            last_err = e
            time.sleep(backoff * (i + 1))
    raise RuntimeError(f"HTTP fetch failed: {url} ({last_err})")

def fetch_firms_csv(map_key: str, source: str, days: int) -> str:
    # FIRMS API area/csv minta: /api/area/csv/<key>/<source>/world/<days>
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/{source}/world/{days}"
    return http_get_text(url)

def main():
    key = (os.environ.get("FIRMS_KEY") or "").strip()
    if not key:
        raise SystemExit("Missing FIRMS_KEY. Add it as GitHub Actions secret FIRMS_KEY.")

    out = []
    seen = set()

    for source in SOURCES:
        csv_text = fetch_firms_csv(key, source, API_DAYS)

        # csv reader a stringből
        reader = csv.DictReader(csv_text.splitlines())
        for row in reader:
            try:
                lat = float(row.get("latitude", "") or row.get("lat", ""))
                lng = float(row.get("longitude", "") or row.get("lon", ""))
            except Exception:
                continue

            if not in_middle_east(lat, lng):
                continue

            acq_date = (row.get("acq_date") or "").strip()
            acq_time = (row.get("acq_time") or "").strip()
            dt = parse_acq_datetime(acq_date, acq_time)
            if dt is None:
                continue
            if hours_ago(dt) > KEEP_HOURS:
                continue

            # de-dupe kulcs (kb egyedi: source+datetime+coords)
            k = f"{source}|{dt.isoformat()}|{lat:.4f}|{lng:.4f}"
            if k in seen:
                continue
            seen.add(k)

            # mezők (nem mindegyik van mindig jelen, ezért óvatosan)
            confidence = (row.get("confidence") or row.get("conf") or "").strip()
            frp = row.get("frp", "")
            daynight = (row.get("daynight") or row.get("day_night") or "").strip()

            # brightness mezők VIIRS-nél tipikusan bright_ti4 / bright_ti5
            bright_ti4 = row.get("bright_ti4", "")
            bright_ti5 = row.get("bright_ti5", "")

            out.append({
                "id": "f_" + str(abs(hash(k))),
                "type": "fire",
                "source": "FIRMS",
                "dataset": source,
                "published_at": dt.isoformat(),
                "lat": lat,
                "lng": lng,
                "confidence": confidence or None,
                "frp": float(frp) if str(frp).strip().replace(".", "", 1).isdigit() else None,
                "daynight": daynight or None,
                "bright_ti4": float(bright_ti4) if str(bright_ti4).strip().replace(".", "", 1).isdigit() else None,
                "bright_ti5": float(bright_ti5) if str(bright_ti5).strip().replace(".", "", 1).isdigit() else None,
            })

    # Legfrissebb elöl
    out.sort(key=lambda x: x.get("published_at") or "", reverse=True)

    payload = {
        "generated_at": now_iso(),
        "count": len(out),
        "bbox": {"lat": [ME_LAT_MIN, ME_LAT_MAX], "lng": [ME_LNG_MIN, ME_LNG_MAX]},
        "fires": out,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(out)} fires to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
