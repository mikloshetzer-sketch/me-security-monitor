import json
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from pathlib import Path

EVENTS_PATH = "events.json"
OUT_PATH = "brief.md"
ARCHIVE_DIR = "archive"  # create folder in repo root

CAT_W = {"military": 3.0, "security": 2.0, "political": 1.0, "other": 0.5}
ISW_MULT = 1.3

MAP_URL = "https://mikloshetzer-sketch.github.io/me-security-monitor"

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

def risk_level(total_risk: float) -> str:
    if total_risk >= 250:
        return "HIGH"
    if total_risk >= 120:
        return "MEDIUM"
    return "LOW"

def confidence_level(src_counts: dict, total_events: int) -> str:
    # simple heuristic: more events + presence of ISW boosts confidence
    isw = src_counts.get("isw", 0)
    if total_events >= 150 and isw >= 3:
        return "HIGH"
    if total_events >= 60:
        return "MEDIUM"
    return "LOW"

def format_period(start, now) -> str:
    # compact period string for X
    return f"{start.isoformat()} → {now.isoformat()}"

def build_key_developments(top_events):
    """
    Extracts short themes from titles/locations without inventing facts.
    We only refer to what is explicitly in the titles/locations.
    """
    themes = []
    for s, ev in top_events[:10]:
        title = safe(ev.get("title") or "")
        loc = safe(((ev.get("location") or {}).get("name")) or "")
        st = source_type(ev)

        # Keep it conservative: one-liners based on title keywords
        t = title.lower()
        if "israel" in t and "iran" in t:
            themes.append("Continued Israel–Iran military escalation signaled by high-weight reporting.")
        elif "hormuz" in t:
            themes.append("Energy-security sensitivity indicated around the Strait of Hormuz in reporting.")
        elif "lebanon" in t:
            themes.append("Operational warnings/alerts linked to southern Lebanon appeared in reporting.")
        elif "nato" in t and "missile" in t:
            themes.append("Missile-defence developments involving NATO were referenced in reporting.")
        elif "un" in t or "united nations" in t:
            themes.append("International reactions were referenced in reporting.")
        elif loc:
            themes.append(f"High-weight reporting referenced developments tied to {loc}.")
        elif st == "isw":
            themes.append("Multiple ISW updates carried high weights within the reporting window.")
        else:
            themes.append("High-weight reporting referenced military developments in the region.")

    # de-duplicate while preserving order
    seen = set()
    out = []
    for x in themes:
        if x not in seen:
            out.append(x)
            seen.add(x)
        if len(out) >= 5:
            break
    if not out:
        out = ["No clear dominant developments could be derived from the top-weighted titles this week."]
    return out

def make_osint_narrative(start, now, window_days, total_events, cat_counts, src_counts, total_risk, top_locs, top_events):
    lvl = risk_level(total_risk)
    conf = confidence_level(src_counts, total_events)

    top1 = top_locs[0] if len(top_locs) > 0 else ("Unknown", 0.0)
    top2 = top_locs[1] if len(top_locs) > 1 else ("Unknown", 0.0)

    # share of top2 in total (avoid div0)
    share_top2 = 0.0
    if total_risk > 0:
        share_top2 = (top1[1] + top2[1]) / total_risk

    key_dev = build_key_developments(top_events)

    # Executive Summary: grounded in numbers only
    exec_sum = (
        f"During the reporting period ({start.isoformat()}–{now.isoformat()}), the monitor recorded "
        f"**{total_events} events** across the region and calculated a cumulative **risk index of {total_risk:.1f}** "
        f"({lvl} volatility). Military incidents remained prominent (**{cat_counts['military']}**), "
        f"while overall activity was concentrated in the top risk locations led by **{safe(top1[0])}** and **{safe(top2[0])}**."
    )

    # Strategic Assessment: still conservative, uses risk concentration
    conc_phrase = "highly concentrated" if share_top2 >= 0.65 else "broadly distributed"
    assess = (
        f"Risk distribution was **{conc_phrase}**, with the top two locations accounting for ~**{share_top2*100:.0f}%** "
        f"of the window risk. This pattern suggests the weekly security picture was driven by a small number of core theatres, "
        f"while secondary locations contributed marginally to overall volatility."
    )

    outlook = (
        f"**Outlook:** Short-term escalation risk remains **{lvl}** based on this week’s aggregated risk and incident mix. "
        f"Priority monitoring should focus on the leading hotspots and any indicators of spillover into adjacent theatres."
    )

    confidence = f"**Confidence:** {conf} (based on event volume and source mix within this window)."

    lines = []
    lines.append("## Executive Summary")
    lines.append(exec_sum)
    lines.append("")
    lines.append("## Key Developments")
    for b in key_dev:
        lines.append(f"- {b}")
    lines.append("")
    lines.append("## Strategic Assessment")
    lines.append(assess)
    lines.append("")
    lines.append(outlook)
    lines.append(confidence)
    lines.append("")
    return lines

def make_x_thread(start, now, total_events, total_risk, cat_counts, top_locs, key_dev, lvl):
    period = f"{start.strftime('%d %b')}–{now.strftime('%d %b %Y')}"
    top1 = top_locs[0] if len(top_locs) > 0 else ("Unknown", 0.0)
    top2 = top_locs[1] if len(top_locs) > 1 else ("Unknown", 0.0)
    dominant_cat = "military" if cat_counts["military"] >= max(cat_counts["security"], cat_counts["political"], cat_counts["other"]) else "mixed"

    # Keep each post readable; user will paste manually.
    posts = []
    posts.append(
        "Middle East Security Monitor — Weekly OSINT Brief\n"
        f"{period}\n\n"
        f"The monitor recorded {total_events} events and a cumulative risk index of {total_risk:.1f} "
        f"({lvl}). Incident mix was dominated by {dominant_cat} activity ({cat_counts['military']} military events)."
    )
    posts.append(
        "Geographic risk remained concentrated in the leading hotspots.\n\n"
        f"Top risk locations: {safe(top1[0])} ({top1[1]:.1f}) and {safe(top2[0])} ({top2[1]:.1f}). "
        "Secondary locations contributed materially less to overall weekly volatility."
    )
    # summarize 2–3 key developments from extracted bullets
    kd = key_dev[:3]
    posts.append(
        "Key developments reflected sustained escalation dynamics in top-weighted reporting:\n\n"
        + "\n".join([f"• {x}" for x in kd])
    )
    posts.append(
        "Strategic signal:\n\n"
        "When military activity clusters in a small number of theatres, the risk of spillover typically rises — "
        "especially when missile-defence, maritime, or cross-border warning signals appear in top reporting."
    )
    posts.append(
        f"Outlook: {lvl} short-term escalation risk. Monitoring priorities remain the leading hotspots and "
        "any expansion indicators into adjacent theatres.\n\n"
        f"Map + sources: {MAP_URL}"
    )
    return posts

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

    # Build OSINT narrative + X thread based strictly on computed window/top events
    narrative = make_osint_narrative(
        start, now, window_days, len(window), cat_counts, src_counts, total_risk, top_locs, top_events
    )
    lvl = risk_level(total_risk)
    key_dev = build_key_developments(top_events)
    x_posts = make_x_thread(start, now, len(window), total_risk, cat_counts, top_locs, key_dev, lvl)

    # render
    lines = []
    lines.append("# Middle East Security Monitor — Weekly Brief")
    lines.append("")
    lines.append(f"**Period:** {start.isoformat()} → {now.isoformat()} (last {window_days} days)")
    lines.append("")
    # NEW: analytical OSINT layer
    lines.extend(narrative)

    # Existing blocks (kept)
    lines.append("## Summary stats")
    lines.append(f"- **Total events:** {len(window)}")
    lines.append(
        f"- **By category:** military {cat_counts['military']}, security {cat_counts['security']}, "
        f"political {cat_counts['political']}, other {cat_counts['other']}"
    )
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
    lines.append("## X THREAD VERSION (copy/paste)")
    lines.append("")
    for i, p in enumerate(x_posts, 1):
        lines.append(f"**Post {i}**")
        lines.append(p)
        lines.append("")
    lines.append(f"_Auto-generated from `events.json`._")
    lines.append("")

    # Write main brief
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    # Archive copy (optional but recommended)
    try:
        Path(ARCHIVE_DIR).mkdir(parents=True, exist_ok=True)
        archive_path = Path(ARCHIVE_DIR) / f"brief_{now.isoformat()}.md"
        with open(archive_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
    except Exception:
        # Do not fail the run if archive cannot be written
        pass

    print(f"Wrote {OUT_PATH} with {len(window)} events. Total risk {total_risk:.1f}")

if __name__ == "__main__":
    main()
