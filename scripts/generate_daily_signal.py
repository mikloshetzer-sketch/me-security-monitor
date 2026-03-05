import json
from datetime import datetime, timedelta, timezone
from collections import defaultdict

EVENTS_PATH = "events.json"
OUT_PATH = "daily_signal.md"


def norm_cat(c):
    c = (c or "other").strip().lower()
    if c not in ["military", "security", "political"]:
        return "other"
    return c


def parse_event_date(d):
    """
    Accepts:
    YYYY-MM-DD
    YYYY-MM-DDTHH:MM:SSZ
    """

    if not d:
        return None

    try:
        if "T" in d:
            return datetime.fromisoformat(d.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(d, "%Y-%m-%d")
            return dt.replace(tzinfo=timezone.utc)
    except:
        return None


def main():

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    last24 = []

    for ev in events:

        d = ev.get("date")
        ed = parse_event_date(d)

        if not ed:
            continue

        if ed >= window_start:
            last24.append(ev)

    cat_counts = defaultdict(int)
    loc_counts = defaultdict(int)

    for ev in last24:

        cat = norm_cat(ev.get("category"))
        cat_counts[cat] += 1

        loc = ((ev.get("location") or {}).get("name")) or "Unknown"
        loc_counts[loc] += 1

    total_events = len(last24)

    dominant_cat = max(cat_counts.items(), key=lambda x: x[1])[0] if cat_counts else "none"
    top_loc = max(loc_counts.items(), key=lambda x: x[1])[0] if loc_counts else "Unknown"

    lines = []

    lines.append("# Daily OSINT Signal")
    lines.append("")
    lines.append(f"**Generated:** {now.isoformat()}")
    lines.append("")
    lines.append("## Summary (last 24h)")
    lines.append(f"- Events recorded: **{total_events}**")
    lines.append(f"- Dominant category: **{dominant_cat}**")
    lines.append(f"- Highest activity location: **{top_loc}**")
    lines.append("")
    lines.append("## X POST VERSION")
    lines.append("")
    lines.append("Middle East Security Monitor – Daily Signal")
    lines.append("")
    lines.append(f"Events (last 24h): {total_events}")
    lines.append(f"Dominant category: {dominant_cat}")
    lines.append(f"Highest activity location: {top_loc}")
    lines.append("")
    lines.append("Trend: monitoring continues across the region.")
    lines.append("")
    lines.append("Map + sources:")
    lines.append("https://mikloshetzer-sketch.github.io/me-security-monitor")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Daily signal generated with {total_events} events.")


if __name__ == "__main__":
    main()
