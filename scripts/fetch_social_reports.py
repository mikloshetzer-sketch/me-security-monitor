import json
import re
from datetime import datetime, timezone
import feedparser

OUTPUT_PATH = "reports.json"

# --- Middle East helyszótár (bővíthető) ---
# Kulcs: regex (lowercase szövegre), érték: (lat, lng, címke)
PLACE_RULES = [
    # Iraq
    (r"\bbaghdad\b", (33.3152, 44.3661, "Baghdad, Iraq")),
    (r"\bbasra\b", (30.5085, 47.7804, "Basra, Iraq")),
    (r"\berbil\b", (36.1911, 44.0092, "Erbil, Iraq")),
    (r"\bmosul\b", (36.3456, 43.1575, "Mosul, Iraq")),
    (r"\bkirkuk\b", (35.4681, 44.3922, "Kirkuk, Iraq")),

    # Iran
    (r"\btehran\b", (35.6892, 51.3890, "Tehran, Iran")),
    (r"\bisfahan\b", (32.6539, 51.6660, "Isfahan, Iran")),
    (r"\bshiraz\b", (29.5918, 52.5837, "Shiraz, Iran")),
    (r"\bt\u00e4briz\b|\btabriz\b", (38.0962, 46.2738, "Tabriz, Iran")),
    (r"\bbandar abbas\b", (27.1865, 56.2808, "Bandar Abbas, Iran")),

    # Syria
    (r"\bdamascus\b|\bdamaskus\b", (33.5138, 36.2765, "Damascus, Syria")),
    (r"\baleppo\b", (36.2021, 37.1343, "Aleppo, Syria")),
    (r"\bhoms\b", (34.7324, 36.7137, "Homs, Syria")),
    (r"\bdeir ez[-\s]?zor\b", (35.3359, 40.1408, "Deir ez-Zor, Syria")),

    # Lebanon
    (r"\bbeirut\b", (33.8938, 35.5018, "Beirut, Lebanon")),
    (r"\btyre\b|\bsur\b", (33.2700, 35.2033, "Tyre, Lebanon")),
    (r"\bsidon\b|\bsaida\b", (33.5606, 35.3758, "Sidon, Lebanon")),

    # Israel/Palestine
    (r"\btel aviv\b", (32.0853, 34.7818, "Tel Aviv, Israel")),
    (r"\bhaifa\b", (32.7940, 34.9896, "Haifa, Israel")),
    (r"\bgaza\b|\bgaza strip\b", (31.3547, 34.3088, "Gaza")),
    (r"\bjerusalem\b", (31.7683, 35.2137, "Jerusalem")),
    (r"\bwest bank\b", (31.9, 35.2, "West Bank")),

    # Jordan
    (r"\bamman\b", (31.9454, 35.9284, "Amman, Jordan")),
    (r"\baqaba\b", (29.5320, 35.0063, "Aqaba, Jordan")),

    # Gulf / Arabian Peninsula
    (r"\briyadh\b", (24.7136, 46.6753, "Riyadh, Saudi Arabia")),
    (r"\bjeddah\b", (21.4858, 39.1925, "Jeddah, Saudi Arabia")),
    (r"\bdhahran\b", (26.2361, 50.0393, "Dhahran, Saudi Arabia")),
    (r"\bdoha\b", (25.2854, 51.5310, "Doha, Qatar")),
    (r"\bmanama\b", (26.2235, 50.5876, "Manama, Bahrain")),
    (r"\bkuwait city\b|\bkuwait\b", (29.3759, 47.9774, "Kuwait City, Kuwait")),
    (r"\bdubai\b", (25.2048, 55.2708, "Dubai, UAE")),
    (r"\babu dhabi\b", (24.4539, 54.3773, "Abu Dhabi, UAE")),
    (r"\bmuscat\b", (23.5880, 58.3829, "Muscat, Oman")),

    # Yemen
    (r"\bsanaa\b|\bsana'a\b", (15.3694, 44.1910, "Sanaa, Yemen")),
    (r"\baden\b", (12.7855, 45.0187, "Aden, Yemen")),
    (r"\bhodeidah\b|\bal hudaydah\b", (14.7978, 42.9545, "Al Hudaydah, Yemen")),
]

# Middle East “jelenlét” kulcsszavak – ha semmi hely nincs, ezek alapján sem akarjuk megtartani
ME_SIGNAL = [
    "iraq", "iran", "syria", "lebanon", "israel", "gaza", "west bank", "jordan",
    "yemen", "saudi", "qatar", "bahrain", "kuwait", "oman", "uae", "dubai", "abu dhabi",
    "middle east", "centcom"
]

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def find_location(text_lc: str):
    for pat, (lat, lng, label) in PLACE_RULES:
        if re.search(pat, text_lc):
            return {"name": label, "lat": lat, "lng": lng}
    return None

def looks_middle_east(text_lc: str) -> bool:
    return any(k in text_lc for k in ME_SIGNAL)

def safe_id(seed: str) -> str:
    # stabil, egyszerű id
    return "r_" + str(abs(hash(seed)))

def fetch_feeds():
    # TODO: ide tedd be a saját RSS URL-jeidet (Mastodon hashtag RSS, Reddit RSS stb.)
    # Példa (csak minta!):
    FEEDS = [
        # ("mastodon.social", "https://mastodon.social/tags/middleeast.rss", "middleeast"),
        # ("reddit", "https://www.reddit.com/r/CombatFootage/.rss", "CombatFootage"),
    ]
    return FEEDS

def main():
    feeds = fetch_feeds()

    reports = []
    now = datetime.now(timezone.utc).isoformat()

    for source_name, url, tag in feeds:
        d = feedparser.parse(url)
        for e in d.entries:
            title = getattr(e, "title", "") or ""
            link = getattr(e, "link", "") or ""
            summary = getattr(e, "summary", "") or getattr(e, "description", "") or ""
            published = getattr(e, "published", "") or getattr(e, "updated", "") or now

            text = f"{title}\n{summary}".strip()
            text_lc = norm(re.sub(r"<[^>]+>", " ", text))  # strip HTML tags

            # ME szűrés: ha sem hely, sem jel nincs → dobjuk
            loc = find_location(text_lc)
            if not loc and not looks_middle_east(text_lc):
                continue

            # ha nincs konkrét hely, akkor inkább dobjuk (map-hez kell lat/lng)
            if not loc:
                continue

            rid = safe_id(link or (source_name + "|" + title + "|" + published))

            reports.append({
                "id": rid,
                "type": "crowd_report",
                "source": {
                    "type": "mastodon" if "mastodon" in source_name else ("reddit" if "reddit" in source_name else "rss"),
                    "name": source_name,
                    "url": link,
                    "tag": tag
                },
                "title": title,
                "text": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", summary)).strip(),
                "published_at": published,
                "location": loc,
                # duplikáljuk is, hogy a frontend egyszerűen kezelje:
                "lat": loc["lat"],
                "lng": loc["lng"],
                "confidence": "MED"
            })

    out = {
        "generated_at": now,
        "count": len(reports),
        "reports": reports
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(reports)} reports to {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
