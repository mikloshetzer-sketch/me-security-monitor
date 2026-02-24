import json
import re
import hashlib
from datetime import datetime, timezone, timedelta

import feedparser
from bs4 import BeautifulSoup
from dateutil import parser as dtparser


# -------- CONFIG --------
OUT_PATH = "events.json"

FEEDS = [
    {
        "name": "BBC",
        "type": "news",
        "url": "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    },

    # Google News RSS Search (proxy feeds)
    # Note: q param is URL-encoded below by simple replacements.
    {
        "name": "Reuters (via Google News)",
        "type": "news",
        "url": "https://news.google.com/rss/search?q=site%3Areuters.com%20(middle%20east%20OR%20Israel%20OR%20Gaza%20OR%20Lebanon%20OR%20Syria%20OR%20Iraq%20OR%20Iran%20OR%20Yemen)&hl=en-US&gl=US&ceid=US:en",
    },
    {
        "name": "Al Jazeera (via Google News)",
        "type": "news",
        "url": "https://news.google.com/rss/search?q=site%3Aaljazeera.com%20(middle%20east%20OR%20Israel%20OR%20Gaza%20OR%20Lebanon%20OR%20Syria%20OR%20Iraq%20OR%20Iran%20OR%20Yemen)&hl=en-US&gl=US&ceid=US:en",
    },
]

# Very lightweight geocode lookup (heuristic)
PLACE_COORDS = [
    ("gaza", ("Gaza Strip", 31.5, 34.47)),
    ("israel", ("Israel", 31.0461, 34.8516)),
    ("west bank", ("West Bank", 31.9, 35.2)),
    ("jerusalem", ("Jerusalem", 31.7683, 35.2137)),
    ("lebanon", ("Lebanon", 33.8547, 35.8623)),
    ("beirut", ("Beirut", 33.8938, 35.5018)),
    ("syria", ("Syria", 34.8021, 38.9968)),
    ("damascus", ("Damascus", 33.5138, 36.2765)),
    ("iraq", ("Iraq", 33.2232, 43.6793)),
    ("baghdad", ("Baghdad", 33.3152, 44.3661)),
    ("iran", ("Iran", 32.4279, 53.6880)),
    ("tehran", ("Tehran", 35.6892, 51.3890)),
    ("yemen", ("Yemen", 15.5527, 48.5164)),
    ("sanaa", ("Sana'a", 15.3694, 44.1910)),
    ("saudi", ("Saudi Arabia", 23.8859, 45.0792)),
    ("riyadh", ("Riyadh", 24.7136, 46.6753)),
    ("jordan", ("Jordan", 30.5852, 36.2384)),
    ("amman", ("Amman", 31.9539, 35.9106)),
    ("egypt", ("Egypt", 26.8206, 30.8025)),
    ("cairo", ("Cairo", 30.0444, 31.2357)),
    ("turkey", ("Turkey", 38.9637, 35.2433)),
    ("ankara", ("Ankara", 39.9334, 32.8597)),
    ("qatar", ("Qatar", 25.3548, 51.1839)),
    ("doha", ("Doha", 25.2854, 51.5310)),
    ("uae", ("United Arab Emirates", 23.4241, 53.8478)),
    ("dubai", ("Dubai", 25.2048, 55.2708)),
]

REGION_FALLBACK = ("Middle East", 33.5, 44.0)

MILITARY_KW = ["strike", "airstrike", "attack", "drone", "missile", "rocket", "shell", "bomb", "raid", "killed", "clash"]
POLITICAL_KW = ["election", "parliament", "government", "minister", "president", "talks", "deal", "ceasefire", "negotiation"]
SECURITY_KW = ["police", "security", "arrest", "court", "terror", "militant", "border", "checkpoint"]


# -------- HELPERS --------
def strip_html(text: str) -> str:
    if not text:
        return ""
    soup = BeautifulSoup(text, "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()

def safe_date(entry) -> datetime | None:
    # Try common RSS fields
    for key in ("published", "updated", "created"):
        if getattr(entry, key, None):
            try:
                dt = dtparser.parse(getattr(entry, key))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(timezone.utc)
            except Exception:
                pass
    return None

def pick_location(text: str):
    t = (text or "").lower()
    for needle, (name, lat, lng) in PLACE_COORDS:
        if needle in t:
            return {"name": name, "lat": lat, "lng": lng}
    name, lat, lng = REGION_FALLBACK
    return {"name": name, "lat": lat, "lng": lng}

def pick_category(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in MILITARY_KW):
        return "military"
    if any(k in t for k in SECURITY_KW):
        return "security"
    if any(k in t for k in POLITICAL_KW):
        return "political"
    return "other"

def make_id(link: str, title: str, date_ymd: str) -> str:
    base = (link or "") + "|" + (title or "") + "|" + (date_ymd or "")
    h = hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]
    return f"{date_ymd}-{h}"


def main():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=365)

    events = []

    for f in FEEDS:
        feed = feedparser.parse(f["url"])
        for e in feed.entries:
            dt = safe_date(e)
            if not dt:
                continue
            if dt < cutoff:
                continue

            date_ymd = dt.strftime("%Y-%m-%d")
            title = getattr(e, "title", "").strip()
            link = getattr(e, "link", "").strip()

            summary_raw = getattr(e, "summary", "") or getattr(e, "description", "")
            summary = strip_html(summary_raw)
            if len(summary) > 260:
                summary = summary[:257].rstrip() + "..."

            # Heuristic location/category
            loc = pick_location(f"{title} {summary}")
            cat = pick_category(f"{title} {summary}")

            ev = {
                "id": make_id(link, title, date_ymd),
                "date": date_ymd,
                "title": title,
                "summary": summary,
                "category": cat,
                "tags": [],  # (később: auto-tag, NLP, kézi tagek)
                "confidence": 0.55,  # RSS headline alapból közepes; később finomítjuk
                "source": {
                    "name": f["name"],
                    "type": f["type"],
                    "url": link
                },
                "location": loc
            }

            # minimal sanity
            if ev["title"] and ev["source"]["url"]:
                events.append(ev)

    # De-dup by id, keep newest first
    uniq = {}
    for ev in sorted(events, key=lambda x: x["date"], reverse=True):
        uniq.setdefault(ev["id"], ev)
    final_events = list(uniq.values())

    # Hard cap to keep repo light
    final_events = final_events[:500]

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_events, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(final_events)} events to {OUT_PATH}")


if __name__ == "__main__":
    main()
