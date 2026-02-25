import json
from datetime import datetime, timedelta, timezone
from collections import defaultdict

EVENTS_PATH = "events.json"
OUT_PATH = "brief.md"

CAT_W = {"military": 3.0, "security": 2.0, "political": 1.0, "other": 0.5}
ISW_MULT = 1.3

def norm_cat(c: str) -> str:
    c = (c or "other").strip().lower()
    return c if c in CAT_W else "other"

def source_type(ev) -> str:
    t = (((ev.get("source") or {}).get("type")) or "news").strip().lower()
    return "isw" if t == "isw" else "news"

def recency_weight(age_days: int, window_days: int) -> float:
    # newest=1.0 .. oldest=0.4
    if window_days <= 1:
        return 1.0
    t = age_days / (window_days - 1)
    return 1.0 - 0.6 * t

def risk_score(ev, age_days: int, window_days: int) -> float:
    cat = norm_cat(ev.get("category"))
    w_cat = CAT_W[cat]
    w_src = ISW_MULT if source_type(ev) == "isw" else 1.0
    w_rec = recency_weight(age_days, window_days)
    return w_cat * w_src * w_rec

def safe(s):
    return (s or "").replace("\n", " ").strip()

def main():
    now = datetime.now(timezone.utc).date()
    window_days = 7
    start = now - timedelta(days=window_days - 1)

    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
        events = json.load(f)

    # filter last 7 days
    window = []
    for ev in events:
        d = ev.get("date")
        if not d:
            continue
        try:
            ed = datetime.strptime(d, "%Y-%m-%d").date()
        except Exception:
            continue
        if start <= ed <= now:
            window.append(ev)

    # stats
    cat_counts = defaultdict(int)
    src_counts = defaultdict(int)

    # risk per location
    risk_by_loc = defaultdict(float)
    total_risk = 0.0

    for ev in window:
        cat = norm_cat(ev.get("category"))
        cat_counts[cat] += 1
        src_counts[source_type(ev)] += 1

        loc = ((ev.get("location") or {}).get("name")) or "Unknown"
        loc = loc.strip() or "Unknown"

        # age from "now"
        ed = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        age_days = (now - ed).days  # 0..6
        s = risk_score(ev, age_days, window_days)
        total_risk += s
        risk_by_loc[loc] += s

    top_locs = sorted(risk_by_loc.items(), key=lambda x: x[1], reverse=True)[:5]

    # top events (by risk score)
    scored = []
    for ev in window:
        ed = datetime.strptime(ev["date"], "%Y-%m-%d").date()
        age_days = (now - ed).days
        s = risk_score(ev, age_days, window_days)
        scored.append((s, ev))
    scored.sort(key=lambda x: x[0], reverse=True)
    top_events = scored[:10]

    # render
    lines = []
    lines.append(f"# Middle East Security Monitor — Weekly Brief")
    lines.append("")
    lines.append(f"**Period:** {start.isoformat()} → {now.isoformat()} (last {window_days} days)")
    lines.append("")
    lines.append("## Summary stats")
    lines.append(f"- **Total events:** {len(window)}")
    lines.append(f"- **By category:** military {cat_counts['military']}, security {cat_counts['security']}, political {cat_counts['political']}, other {cat_counts['other']}")
    lines.append(f"- **By source:** news {src_counts['news']}, ISW {src_counts['isw']}")
    lines.append("")
    lines.append("## Risk Index")
    lines.append(f"- **Total window risk:** **{total_risk:.1f}**")
    if top_locs:
        lines.append("- **Top locations (risk):**")
        for name, val in top_locs:
            lines.append(f"  - {safe(name)} — {val:.1f}")
    else:
        lines.append("- No risk locations for this window.")
    lines.append("")
    lines.append("## Top events (weighted)")
    if top_events:
        for s, ev in top_events:
            title = safe(ev.get("title") or "Untitled")
            url = ((ev.get("source") or {}).get("url")) or ""
            cat = norm_cat(ev.get("category"))
            st = source_type(ev)
            loc = safe(((ev.get("location") or {}).get("name")) or "Unknown")
            date = ev.get("date") or ""
            if url:
                lines.append(f"- **{s:.1f}** · {date} · {cat} · {st} · {loc} — [{title}]({url})")
            else:
                lines.append(f"- **{s:.1f}** · {date} · {cat} · {st} · {loc} — {title}")
    else:
        lines.append("- No events in this window.")
    lines.append("")
    lines.append("_Auto-generated from `events.json`._")
    lines.append("")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Wrote {OUT_PATH} with {len(window)} events.")

if __name__ == "__main__":
    main()
