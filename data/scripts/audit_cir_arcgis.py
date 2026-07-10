#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
CIR / InfoRes ArcGIS technical audit
ME Security Monitor

Purpose:
- Discover public ArcGIS FeatureServer services under the CIR ArcGIS organisation.
- Identify candidate incident layers.
- Test whether layers can be queried with geometry and attributes.
- Write machine-readable audit output for the next integration step.

Outputs:
- data/cir-source-audit.json
- data/cir-candidate-samples.json

This script does not scrape the CIR website.
It only uses standard ArcGIS REST endpoints.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


ORG_ROOT = "https://services-eu1.arcgis.com/06WOSMGHsCnaFyMp/arcgis/rest/services"
OUT_DIR = Path("data")

KEYWORDS = [
    "incident",
    "incidents",
    "conflict",
    "event",
    "events",
    "attack",
    "strike",
    "gaza",
    "israel",
    "lebanon",
    "west",
    "bank",
    "jerusalem",
    "indigo",
]


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, params: Optional[Dict[str, Any]] = None, timeout: int = 30) -> Dict[str, Any]:
    if params:
        query = urllib.parse.urlencode(params, doseq=True)
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}{query}"

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ME-Security-Monitor/1.0 (+OSINT research; non-commercial)",
            "Accept": "application/json",
        },
    )

    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {
            "error": "json_decode_failed",
            "url": url,
            "raw_start": raw[:500],
        }


def safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in value)[:120]


def keyword_score(*parts: str) -> int:
    text = " ".join(parts).lower()
    score = 0
    for kw in KEYWORDS:
        if kw in text:
            score += 1
    return score


def get_services() -> List[Dict[str, Any]]:
    payload = fetch_json(ORG_ROOT, {"f": "json"})
    services = payload.get("services", [])
    if not isinstance(services, list):
        return []
    return services


def get_service_metadata(service_name: str, service_type: str) -> Dict[str, Any]:
    url = f"{ORG_ROOT}/{urllib.parse.quote(service_name)}/{service_type}"
    payload = fetch_json(url, {"f": "json"})
    payload["_service_url"] = url
    return payload


def get_layer_metadata(service_url: str, layer_id: int) -> Dict[str, Any]:
    url = f"{service_url}/{layer_id}"
    payload = fetch_json(url, {"f": "json"})
    payload["_layer_url"] = url
    return payload


def sample_layer(layer_url: str, limit: int = 5) -> Dict[str, Any]:
    params = {
        "f": "json",
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "resultRecordCount": str(limit),
        "outSR": "4326",
    }
    return fetch_json(f"{layer_url}/query", params)


def count_layer(layer_url: str) -> Optional[int]:
    params = {
        "f": "json",
        "where": "1=1",
        "returnCountOnly": "true",
    }
    payload = fetch_json(f"{layer_url}/query", params)
    count = payload.get("count")
    return count if isinstance(count, int) else None


def has_geometry_features(sample: Dict[str, Any]) -> bool:
    features = sample.get("features")
    if not isinstance(features, list) or not features:
        return False
    for feature in features:
        if isinstance(feature, dict) and feature.get("geometry"):
            return True
    return False


def summarise_fields(fields: Any) -> List[Dict[str, Any]]:
    out = []
    if not isinstance(fields, list):
        return out

    for field in fields:
        if not isinstance(field, dict):
            continue
        out.append({
            "name": field.get("name"),
            "alias": field.get("alias"),
            "type": field.get("type"),
            "domain": bool(field.get("domain")),
        })
    return out


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    audit: Dict[str, Any] = {
        "generated_at": now_utc(),
        "source": "CIR / Centre for Information Resilience",
        "arcgis_root": ORG_ROOT,
        "status": "running",
        "services": [],
        "candidate_layers": [],
        "notes": [
            "This audit uses public ArcGIS REST endpoints.",
            "Technical accessibility does not automatically mean reuse is legally permitted.",
            "Check CIR terms/licence before automated republishing.",
        ],
    }

    samples: Dict[str, Any] = {
        "generated_at": audit["generated_at"],
        "candidate_samples": [],
    }

    services = get_services()
    audit["service_count"] = len(services)

    for svc in services:
        service_name = svc.get("name")
        service_type = svc.get("type")

        if not service_name or service_type != "FeatureServer":
            continue

        try:
            meta = get_service_metadata(service_name, service_type)
        except Exception as exc:
            audit["services"].append({
                "name": service_name,
                "type": service_type,
                "error": str(exc),
            })
            continue

        service_url = meta.get("_service_url")
        layers = meta.get("layers", [])
        service_summary = {
            "name": service_name,
            "type": service_type,
            "url": service_url,
            "service_description": meta.get("serviceDescription") or meta.get("description") or "",
            "capabilities": meta.get("capabilities"),
            "supported_query_formats": meta.get("supportedQueryFormats"),
            "supported_export_formats": meta.get("supportedExportFormats"),
            "max_record_count": meta.get("maxRecordCount"),
            "layers": [],
        }

        if not isinstance(layers, list):
            layers = []

        for layer in layers:
            if not isinstance(layer, dict):
                continue

            layer_id = layer.get("id")
            layer_name = layer.get("name", "")
            geometry_type = layer.get("geometryType", "")
            layer_type = layer.get("type", "")

            if not isinstance(layer_id, int):
                continue

            layer_url = f"{service_url}/{layer_id}"

            layer_info = {
                "id": layer_id,
                "name": layer_name,
                "type": layer_type,
                "geometry_type": geometry_type,
                "url": layer_url,
                "score": keyword_score(service_name, layer_name, str(meta.get("serviceDescription", ""))),
            }

            try:
                layer_meta = get_layer_metadata(service_url, layer_id)
                layer_info["fields"] = summarise_fields(layer_meta.get("fields"))
                layer_info["object_id_field"] = layer_meta.get("objectIdField")
                layer_info["display_field"] = layer_meta.get("displayField")
                layer_info["time_info"] = layer_meta.get("timeInfo")
                layer_info["supports_query"] = "Query" in str(layer_meta.get("capabilities", ""))
            except Exception as exc:
                layer_info["layer_metadata_error"] = str(exc)

            if geometry_type == "esriGeometryPoint" or layer_info["score"] > 0:
                try:
                    layer_info["count"] = count_layer(layer_url)
                except Exception as exc:
                    layer_info["count_error"] = str(exc)

                try:
                    sample = sample_layer(layer_url, limit=5)
                    layer_info["sample_has_geometry"] = has_geometry_features(sample)
                    layer_info["sample_feature_count"] = len(sample.get("features", [])) if isinstance(sample.get("features"), list) else 0

                    sample_record = {
                        "service": service_name,
                        "layer_id": layer_id,
                        "layer_name": layer_name,
                        "layer_url": layer_url,
                        "sample": sample,
                    }
                    samples["candidate_samples"].append(sample_record)

                except Exception as exc:
                    layer_info["sample_error"] = str(exc)

                audit["candidate_layers"].append(layer_info)

            service_summary["layers"].append(layer_info)
            time.sleep(0.15)

        audit["services"].append(service_summary)
        time.sleep(0.2)

    audit["candidate_layers"] = sorted(
        audit["candidate_layers"],
        key=lambda x: (x.get("score", 0), x.get("sample_feature_count", 0)),
        reverse=True,
    )

    audit["status"] = "completed"

    (OUT_DIR / "cir-source-audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    (OUT_DIR / "cir-candidate-samples.json").write_text(
        json.dumps(samples, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("CIR audit completed.")
    print(f"Services scanned: {audit.get('service_count', 0)}")
    print(f"Candidate layers: {len(audit['candidate_layers'])}")
    print("Output:")
    print(" - data/cir-source-audit.json")
    print(" - data/cir-candidate-samples.json")

    if audit["candidate_layers"]:
        print("\nTop candidates:")
        for item in audit["candidate_layers"][:10]:
            print(f" - {item.get('name')} | {item.get('url')} | count={item.get('count')} | score={item.get('score')}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
