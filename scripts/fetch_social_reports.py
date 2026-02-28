import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import feedparser

OUT_PATH = Path("reports.json")

# --------- CONFIG ---------
MASTODON_INSTANCES = [
    "https://mastodon.social",
    "https://fosstodon.org",
]
MASTODON_TAGS = [
    "planespotting",
    "osint",
    "aviation",
    "militaryaviation",
    "militaryaircraft",
    "airpolicing",
]

REDDIT_FEEDS = [
    "https://www.reddit.com/r/planespotting/.rss",
    "https://www.reddit.com/r/aviation/.rss",
    "https://www.reddit.com/r/osint/.rss",
]

AC_HINT_PATTERNS = [
    r"\bC-?17\b", r"\bC-?130\b", r"\bA400M\b", r"\bKC-?135\b", r"\bKC-?46\b", r"\bA330\b.*\bMRTT\b",
    r"\bE-?3\b", r"\bE-?7\b", r"\bP-?8\b", r"\bRC-?135\b",
    r"\bF-?15\b", r"\bF-?16\b", r"\bF-?18\b", r"\bF-?35\b", r"\bTyphoon\b", r"\bRafale\b",
    r"\bAWACS\b", r"\btanker\b", r"\brefuel\b", r"\brefuelling\b",
    r"\bdrone\b", r"\bUAV\b", r"\bMQ-?9\b", r"\bReaper\b", r"\bBayraktar\b", r"\bHeron\b",
]

GAZETTEER = {
    "baghdad": (33.3152, 44.3661),
    "basra": (30.5085, 47.7804),
    "erbil": (36.1900, 44.0089),
    "mosul": (36.3650, 43.1320),
    "damascus": (33.5138, 36.2765),
    "aleppo": (36.2021, 37.1343),
    "latakia": (35.5236, 35.7916),
    "beirut": (33.8938, 35.5018),
    "tripoli lebanon": (34.4367, 35.8497),
    "jerusalem": (31.7683, 35.2137),
    "tel aviv": (32.0853, 34.7818),
    "gaza": (31.5017, 34.4668),
    "amman": (31.9454, 35.9284),
    "riyadh": (24.7136, 46.6753),
    "jeddah": (21.4858, 39.1925),
    "doha": (25.2854, 51.5310),
    "manama": (26.2235, 50.5876),
    "kuwait city": (29.3759, 47.9774),
    "muscat": (23.5880, 58.3829),
    "abu dhabi": (24.4539, 54.3773),
    "dubai": (25.2048, 55.2708),
    "sana'a": (15.3694, 44.1910),
    "aden": (12.7855, 45.0187),
    "tehran": (35.6892, 51.3890),
    "isfahan": (32.6546, 51.6680),
    "ankara": (39.9334, 32.8597),
    "istanbul": (41.0082, 28.9784),
    "izmir": (38.4237, 27.1428),
    "cairo": (30.0444, 31.2357),
    "alexandria": (31.2001, 29.9187),
}

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def pick_aircraft_hint(text: str) -> str | None:
    for pat in AC_HINT_PATTERNS:
        m = re.search(pat, text or "", flags=re.IGNORECASE)
        if m:
            return m.group(0)
    return None

def extract_location(text: str):
    t = norm(text)
    for key, (lat, lng) in GAZETTEER.items():
        if key in t:
            return {"name": key.title(), "lat": lat, "lng": lng}
    return None

def parse_mastodon_tag_rss(instance: str, tag: str):
    url = f"{instance}/tags/{tag}.rss"
    feed = feedparser.parse(url)
    out = []
    for e in feed.entries:
        title = getattr(e, "title", "") or ""
        link = getattr(e, "link", "") or ""
        summary = getattr(e, "summary", "") or ""
        published = getattr(e, "published", "") or ""
        out.append({
            "source": "mastodon",
            "source_name": instance.replace("https://", ""),
            "tag": tag,
            "title": title,
            "text": re.sub(r"<[^>]+>", " ", summary),
            "url": link,
            "published_raw": published,
        })
    return out

def parse_reddit_rss(url: str):
    feed = feedparser.parse(url)
    out = []
    for e in feed.entries:
        title = getattr(e, "title", "") or ""
        link = getattr(e, "link", "") or ""
        summary = getattr(e, "summary", "") or ""
        published = getattr(e, "published", "") or ""
        out.append({
            "source": "reddit",
            "source_name": "reddit.com",
            "tag": None,
            "title": title,
            "text": re.sub(r"<[^>]+>", " ", summary),
            "url": link,
            "published_raw": published,
        })
    return out

def to_iso_utc(_: str) -> str:
    return datetime.now(timezone.utc).isoformat()

def make_id(item: dict) -> str:
    base = f"{item.get('source')}|{item.get('url')}|{item.get('title')}"
    return "r_" + str(abs(hash(base)))

def main():
    items = []

    for inst in MASTODON_INSTANCES:
        for tag in MASTODON_TAGS:
            try:
                items.extend(parse_mastodon_tag_rss(inst, tag))
                time.sleep(0.25)
            except Exception as ex:
                print("mastodon error", inst, tag, ex)

    for feed_url in REDDIT_FEEDS:
        try:
            items.extend(parse_reddit_rss(feed_url))
            time.sleep(0.25)
        except Exception as ex:
            print("reddit error", feed_url, ex)

    reports = []
    seen = set()

    for it in items:
        rid = make_id(it)
        if rid in seen:
            continue
        seen.add(rid)

        text = (it.get("title", "") + " " + it.get("text", "")).strip()
        hint = pick_aircraft_hint(text)
        loc = extract_location(text)

        if not hint and not re.search(r"\b(aircraft|plane|jet|helicopter|military|tanker|awacs|refuel|planespot)\b", text, re.IGNORECASE):
            continue

        reports.append({
            "id": rid,
            "type": "crowd_report",
            "source": {
                "type": it["source"],
                "name": it["source_name"],
                "url": it.get("url", ""),
                "tag": it.get("tag"),
            },
            "title": (it.get("title", "") or "")[:160],
            "text": text[:600],
            "aircraft_hint": hint,
            "confidence": "LOW",
            "published_at": to_iso_utc(it.get("published_raw", "")),
            "location": loc,
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "count": len(reports),
        "reports": reports,
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(reports)} reports)")

if __name__ == "__main__":
    main()
