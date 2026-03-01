import json
import re
from datetime import datetime, timezone
import feedparser

OUTPUT_PATH = "reports.json"

# --- Middle East városok / helyek (regex -> lat,lng,label) ---
PLACE_RULES = [
    # Iraq
    (r"\bbaghdad\b", (33.3152, 44.3661, "Baghdad, Iraq")),
    (r"\bbasra\b", (30.5085, 47.7804, "Basra, Iraq")),
    (r"\berbil\b", (36.1911, 44.0092, "Erbil, Iraq")),
    (r"\bmosul\b", (36.3456, 43.1575, "Mosul, Iraq")),
    (r"\bkirkuk\b", (35.4681, 44.3922, "Kirkuk, Iraq")),

    # Iran
    (r"\btehran\b|\bteheran\b", (35.6892, 51.3890, "Tehran, Iran")),
    (r"\bisfahan\b", (32.6539, 51.6660, "Isfahan, Iran")),
    (r"\bshiraz\b", (29.5918, 52.5837, "Shiraz, Iran")),
    (r"\bt\u00e4briz\b|\btabriz\b", (38.0962, 46.2738, "Tabriz, Iran")),
    (r"\bbandar abbas\b", (27.1865, 56.2808, "Bandar Abbas, Iran")),

    # Syria
    (r"\bdamascus\b|\bdamaskus\b", (33.5138, 36.2765, "Damascus, Syria")),
    (r"\baleppo\b", (36.2021, 37.1343, "Aleppo, Syria")),
    (r"\bhoms\b", (34.7324, 36.7137, "Homs, Syria")),
    (r"\bdeir ez[-\s]?zor\b", (35.3359, 40.1408, "Deir ez-Zor, Syria")),
    (r"\bidlib\b", (35.9306, 36.6339, "Idlib, Syria")),

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

    # Gulf
    (r"\briyadh\b", (24.7136, 46.6753, "Riyadh, Saudi Arabia")),
    (r"\bjeddah\b", (21.4858, 39.1925, "Jeddah, Saudi Arabia")),
    (r"\bdhahran\b", (26.2361, 50.0393, "Dhahran, Saudi Arabia")),
    (r"\bdoha\b", (25.2854, 51.5310, "Doha, Qatar")),
    (r"\bmanama\b", (26.2235, 50.5876, "Manama, Bahrain")),
    (r"\bkuwait city\b", (29.3759, 47.9774, "Kuwait City, Kuwait")),
    (r"\bdubai\b", (25.2048, 55.2708, "Dubai, UAE")),
    (r"\babu dhabi\b", (24.4539, 54.3773, "Abu Dhabi, UAE")),
    (r"\bmuscat\b", (23.5880, 58.3829, "Muscat, Oman")),

    # Yemen
    (r"\bsanaa\b|\bsana'a\b", (15.3694, 44.1910, "Sanaa, Yemen")),
    (r"\baden\b", (12.7855, 45.0187, "Aden, Yemen")),
    (r"\bhodeidah\b|\bal hudaydah\b", (14.7978, 42.9545, "Al Hudaydah, Yemen")),
]

# --- Ország fallback (ha csak ország szerepel) ---
COUNTRY_FALLBACK = [
    (r"\biran\b", (35.6892, 51.3890, "Iran (fallback: Tehran)")),
    (r"\biraq\b", (33.3152, 44.3661, "Iraq (fallback: Baghdad)")),
    (r"\bsyria\b", (33.5138, 36.2765, "Syria (fallback: Damascus)")),
    (r"\blebanon\b", (33.8938, 35.5018, "Lebanon (fallback: Beirut)")),
    (r"\bisrael\b", (32.0853, 34.7818, "Israel (fallback: Tel Aviv)")),
    (r"\bgaza\b", (31.3547, 34.3088, "Gaza (fallback)")),
    (r"\bwest bank\b", (31.9, 35.2, "West Bank (fallback)")),
    (r"\byemen\b", (15.3694, 44.1910, "Yemen (fallback: Sanaa)")),
    (r"\bjordan\b", (31.9454, 35.9284, "Jordan (fallback: Amman)")),
    (r"\bsaudi\b|\bsaudi arabia\b", (24.7136, 46.6753, "Saudi Arabia (fallback: Riyadh)")),
    (r"\bqatar\b", (25.2854, 51.5310, "Qatar (fallback: Doha)")),
    (r"\bbahrain\b", (26.2235, 50.5876, "Bahrain (fallback: Manama)")),
    (r"\bkuwait\b", (29.3759, 47.9774, "Kuwait (fallback: Kuwait City)")),
    (r"\boman\b", (23.5880, 58.3829, "Oman (fallback: Muscat)")),
    (r"\buae\b|\bunited arab emirates\b", (25.2048, 55.2708, "UAE (fallback: Dubai)")),
]

# --- Middle East jel kulcsszavak (ha nincs város, ezekkel még próbálunk fallbacket) ---
ME_SIGNAL = [
    "iraq", "iran", "syria", "lebanon", "israel", "gaza", "west bank", "jordan",
    "yemen", "saudi", "qatar", "bahrain", "kuwait", "oman", "uae", "dubai", "abu dhabi",
    "middle east", "centcom", "levant"
]

# --- Zajszűrő: ha ezek vannak, de semmi ME jel nincs, dobd (pl. amerikai planespotting) ---
GLOBAL_NOISE_HINTS = [
    "california", "texas", "florida", "new york", "toronto", "amsterdam",
    "lakenheath", "mildenhall", "raf", "uk", "england", "levi's stadium",
    "49ers", "bears", "nato air policing"
]

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())

def strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()

def find_location(text_lc: str):
    for pat, (lat, lng, label) in PLACE_RULES:
        if re.search(pat, text_lc):
            return {"name": label, "lat": lat, "lng": lng}
    return None

def looks_middle_east(text_lc: str) -> bool:
    return any(k in text_lc for k in ME_SIGNAL)

def has_global_noise(text_lc: str) -> bool:
    return any(k in text_lc for k in GLOBAL_NOISE_HINTS)

def fallback_country_loc(text_lc: str):
    for pat, (lat, lng, label) in COUNTRY_FALLBACK:
        if re.search(pat, text_lc):
            return {"name": label, "lat": lat, "lng": lng}
    return None

def safe_id(seed: str) -> str:
    return "r_" + str(abs(hash(seed)))

def fetch_feeds():
    # Alap ME fókusz: Mastodon + Reddit
    # (ha valamelyik nem ad vissza, attól még a többi működik)
    FEEDS = [
        # Mastodon hashtag RSS
        ("mastodon.social", "https://mastodon.social/tags/middleeast.rss", "middleeast"),
        ("mastodon.social", "https://mastodon.social/tags/iran.rss", "iran"),
        ("mastodon.social", "https://mastodon.social/tags/israel.rss", "israel"),
        ("mastodon.social", "https://mastodon.social/tags/gaza.rss", "gaza"),
        ("mastodon.social", "https://mastodon.social/tags/syria.rss", "syria"),
        ("mastodon.social", "https://mastodon.social/tags/hezbollah.rss", "hezbollah"),
        ("mastodon.social", "https://mastodon.social/tags/hamas.rss", "hamas"),
        ("mastodon.social", "https://mastodon.social/tags/houthis.rss", "houthis"),
        ("mastodon.social", "https://mastodon.social/tags/yemen.rss", "yemen"),

        # Reddit RSS (gyakran működik, de Actions alatt néha szeszélyes)
        ("reddit", "https://www.reddit.com/r/syriancivilwar/.rss", "syriancivilwar"),
        ("reddit", "https://www.reddit.com/r/Israel/.rss", "Israel"),
        ("reddit", "https://www.reddit.com/r/Iraq/.rss", "Iraq"),
        ("reddit", "https://www.reddit.com/r/iran/.rss", "iran"),
        ("reddit", "https://www.reddit.com/r/lebanon/.rss", "lebanon"),
        ("reddit", "https://www.reddit.com/r/Yemen/.rss", "Yemen"),
        ("reddit", "https://www.reddit.com/r/CombatFootage/.rss", "CombatFootage"),
    ]
    return FEEDS

def parse_feed(url: str):
    # Reddit sokszor igényel user-agentet
    feedparser.USER_AGENT = "ME-Security-Monitor/1.0 (+https://github.com/)"
    return feedparser.parse(url)

def main():
    feeds = fetch_feeds()
    now = datetime.now(timezone.utc).isoformat()

    reports = []

    for source_name, url, tag in feeds:
        d = parse_feed(url)

        # ha teljesen üres/hibás feed, lépj tovább
        if not getattr(d, "entries", None):
            continue

        for e in d.entries:
            title = getattr(e, "title", "") or ""
            link = getattr(e, "link", "") or ""
            summary = getattr(e, "summary", "") or getattr(e, "description", "") or ""
            published = getattr(e, "published", "") or getattr(e, "updated", "") or now

            # Normalizált szöveg
            text = f"{title}\n{summary}".strip()
            text_plain = strip_html(text)
            text_lc = norm(text_plain)

            # Zajszűrés: ha globális planespotting jel van és nincs ME jel → dobd
            if has_global_noise(text_lc) and not looks_middle_east(text_lc):
                continue

            # 1) Város/konkrét hely keresés
            loc = find_location(text_lc)

            # 2) Ha nincs, de van ME jel → ország fallback
            if not loc and looks_middle_east(text_lc):
                loc = fallback_country_loc(text_lc)

            # 3) Ha továbbra sincs loc → nem térképezhető, dobd
            if not loc:
                continue

            rid = safe_id(link or (source_name + "|" + title + "|" + published))

            # repülő hint (nagyon egyszerű: ha talál tipust a szövegben)
            aircraft_hint = None
            m = re.search(r"\b(f-16|f-15|f-35|f-22|kc-135|kc135|kc-46|kc46|c-17|c17|c-130|c130|b-52|b52|su-34|su-35|mig-29|mig29)\b", text_lc)
            if m:
                aircraft_hint = m.group(1).upper().replace("KC135", "KC-135").replace("KC46", "KC-46")

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
                "text": strip_html(summary),
                "aircraft_hint": aircraft_hint,
                "confidence": "MED",
                "published_at": published,
                "location": loc,
                # duplikáljuk, hogy a frontend könnyen kezelje:
                "lat": loc["lat"],
                "lng": loc["lng"],
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
