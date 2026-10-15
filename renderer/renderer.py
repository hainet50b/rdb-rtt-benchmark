# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml"]
# ///
"""Renders measurements as a report: one self-contained HTML file in one language."""

import argparse
import csv
import json
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TEMPLATE = HERE / "template"
CHART_JS = HERE / "vendor" / "chart.umd.min.js"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("measurements", type=Path, help="for example, measurements/2026-10-20-153000")
    parser.add_argument("--lang", default="en", choices=["en", "ja"])
    parser.add_argument("--scenarios", type=Path, default=ROOT / "scenarios")
    parser.add_argument("--output", type=Path, help="default: reports/<measurements>.<lang>.html")
    args = parser.parse_args()

    i18n = read_json(TEMPLATE / "i18n" / f"{args.lang}.json")
    data = {"i18n": i18n, **load_measurements(args.measurements), "scenarios": load_scenarios(args.scenarios)}
    html = (TEMPLATE / "index.html").read_text(encoding="utf-8")
    for name, value in {
        "lang": args.lang,
        "title": i18n["app.title"],
        "style": (TEMPLATE / "style.css").read_text(encoding="utf-8"),
        "chart": CHART_JS.read_text(encoding="utf-8"),
        "app": (TEMPLATE / "app.js").read_text(encoding="utf-8"),
        "data": json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"),
    }.items():
        html = html.replace("{{" + name + "}}", value)

    output = args.output or ROOT / "reports" / f"{args.measurements.name}.{args.lang}.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8", newline="\n")
    print(f"{output} ({output.stat().st_size // 1024} KB)")


def load_measurements(directory):
    profile = read_yaml(directory / "profile.yaml")
    conditions = read_yaml(directory / profile["conditions"])
    database_type = read_yaml(directory / profile["database"])["type"]
    run_record = read_json(directory / "run.json")

    workloads = []
    for id in profile["workloads"]:
        workload_dir = directory / "workloads" / id
        definition = read_yaml(workload_dir / "workload.yaml")
        rows = definition["rows"]
        workloads.append({
            "id": id,
            "name": definition["name"],
            "rows": [rows["count"]] if rows["source"] == "fixed" else conditions["rows"],
            "files": {name: (workload_dir / database_type / name).read_text(encoding="utf-8")
                      for name in ("query.sql", "schema.sql", "data.sql")},
        })

    configurations = []
    for app in profile["apps"]:
        app_dir = directory / "apps" / app
        if not (app_dir / "configuration.json").exists():
            continue
        configurations.append({
            "id": app,
            "configuration": read_json(app_dir / "configuration.json"),
            "results": {w["id"]: load_results(app_dir / "results" / f"{w['id']}.csv") for w in workloads},
        })
    if not configurations:
        raise SystemExit(f"{directory} has no measured application")

    return {
        "measurement": {
            "name": profile["name"],
            "rows_axis": sorted({r for w in workloads for r in w["rows"]}),
            "fetch_sizes": conditions["fetch_sizes"],
            "delays_ms": conditions["delays_ms"],
            "repeats": conditions["repeats"],
            "warmups": conditions["warmups"],
            "delay": run_record["delay"],
            "started_at": run_record["started_at"],
            "finished_at": run_record["finished_at"],
            "status": run_record["status"],
            "error": run_record["error"],
        },
        "workloads": workloads,
        "configurations": configurations,
    }


SPANS = ["query", "acquire", "commit"]


def load_results(file):
    """Measurements as [rows, fetch_size, delay_ms, query_ms, query_roundtrips, acquire_ms, acquire_roundtrips,
    commit_ms, commit_roundtrips]. A failed one has None for the values of the spans."""
    if not file.exists():
        return []
    with file.open(newline="", encoding="utf-8") as f:
        return [[int(r["rows"]), int(r["fetch_size"]), int(r["delay_ms"]),
                 *(None if r["error"] else convert(r[f"{span}_{unit}"])
                   for span in SPANS for unit, convert in (("ms", float), ("roundtrips", int)))]
                for r in csv.DictReader(f)]


def load_scenarios(directory):
    scenarios = []
    for file in sorted(directory.glob("*.yaml")):
        s = read_yaml(file)
        if not s.get("name"):
            raise SystemExit(f"{file}: name is required")
        transactions = s.get("transactions")
        if not transactions or not all(isinstance(tx, dict) and tx.get("queries") for tx in transactions):
            raise SystemExit(f"{file}: transactions, each with queries, are required")
        for tx in transactions:
            for item in [tx, *tx["queries"]]:
                if not (isinstance(item.get("count"), int) and item["count"] >= 1):
                    raise SystemExit(f"{file}: count of each transaction and query must be 1 or more")
        scenarios.append({"id": file.stem, "name": s["name"], "transactions": s["transactions"]})
    return scenarios


def read_yaml(file):
    return yaml.safe_load(file.read_text(encoding="utf-8")) or {}


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
