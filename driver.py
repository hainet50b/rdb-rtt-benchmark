# /// script
# requires-python = ">=3.12"
# dependencies = ["pyyaml"]
# ///
"""Runs a profile: measures every workload with every application, and writes the measurements.

The measurements mirror the layout of this repository: profile.yaml, databases/, conditions/, workloads/, and
apps/<app>/results/<workload>.csv, with run.json recording when the run started and ended and how ΔRTT was added.
"""

import argparse
import csv
import json
import os
import re
import shlex
import shutil
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
DEFAULT_NAME = "RDB RTT Benchmark"
# Written to the measurements. Everything else, such as the password, is left out.
DATABASE_FIELDS_TO_RECORD = ["type", "host", "port", "database", "user", "setup"]
LOCAL_DATABASE_CONTAINER = "rdb-rtt-benchmark-{type}"
DELAY_CONTAINER = "rdb-rtt-benchmark-delay"
# What services/delay/delay.sh runs, recorded so that the report can show how ΔRTT was added.
DELAY_COMMAND = "tc qdisc replace dev eth0 root netem delay {ms}ms"
RESULT_COLUMNS = ["rows", "fetch_size", "delay_ms", "repeat", "elapsed_ms", "roundtrips", "fetched_rows", "error"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("profile", type=Path)
    parser.add_argument("--output", type=Path, help="default: measurements/<date and time>")
    parser.add_argument("--name", help="overrides name in the profile")
    parser.add_argument("--database", type=Path, help="overrides database in the profile")
    parser.add_argument("--conditions", type=Path, help="overrides conditions in the profile")
    parser.add_argument("--apps", help="overrides apps in the profile, comma-separated")
    parser.add_argument("--workloads", help="overrides workloads in the profile, comma-separated")
    parser.add_argument("--launch", action="append", default=[], metavar="APP=COMMAND",
                        help="launch APP with COMMAND instead of its container image (needs delay: none)")
    args = parser.parse_args()

    try:
        run = Run.prepare(args)
    except InvalidProfile as e:
        sys.exit(f"error: {e}")
    run.execute()


class InvalidProfile(Exception):
    pass


def check(condition, message):
    if not condition:
        raise InvalidProfile(message)


class Run:
    """One launch of the driver."""

    @classmethod
    def prepare(cls, args):
        check(args.profile.is_file(), f"{args.profile} does not exist")
        profile = read_yaml(args.profile)
        for field in ("database", "conditions", "apps", "workloads"):
            check(field in profile or getattr(args, field), f"{args.profile}: {field} is required")
        base = args.profile.parent
        database_file = args.database or base / profile["database"]
        conditions_file = args.conditions or base / profile["conditions"]
        app_names = args.apps.split(",") if args.apps else profile["apps"]
        workload_ids = args.workloads.split(",") if args.workloads else profile["workloads"]
        launches = dict(launch.split("=", 1) for launch in args.launch)

        database = Database(database_file)
        conditions = Conditions(conditions_file)
        apps = [App(name, database.type, launches.get(name)) for name in app_names]
        workloads = [Workload(id, database.type) for id in workload_ids]
        check(conditions.delay == "none" or not launches, "--launch needs delay: none in the conditions")
        if conditions.delay == "netem":
            check(container_running(DELAY_CONTAINER), f"delay: netem needs the {DELAY_CONTAINER} container")
        output = args.output or Path("measurements") / datetime.now().strftime("%Y-%m-%d-%H%M%S")
        check(not output.exists(), f"{output} already exists")
        return cls(args.name or profile.get("name") or DEFAULT_NAME, database, conditions, apps, workloads, output)

    def __init__(self, name, database, conditions, apps, workloads, output):
        self.name = name
        self.database = database
        self.conditions = conditions
        self.apps = apps
        self.workloads = workloads
        self.output = output

    def execute(self):
        self.write_inputs()
        run_record = {"started_at": now(), "finished_at": None, "status": "running", "error": None,
                     "delay": {"method": self.conditions.delay,
                               "command": DELAY_COMMAND if self.conditions.delay == "netem" else None}}
        write_json(self.output / "run.json", run_record)
        try:
            for app in self.apps:
                app.build()
            self.set_delay(0)
            for workload in self.workloads:
                if self.database.setup:
                    for script in ("schema.sql", "data.sql"):
                        print(f"{workload.id}: {script}", flush=True)
                        self.database.run_script(workload.sql_dir / script)
                for app in self.apps:
                    for delay in self.conditions.delays_ms:
                        self.set_delay(delay)
                        for rows in workload.rows_to_measure(self.conditions):
                            for fetch_size in self.conditions.fetch_sizes:
                                self.measure(app, workload, rows, fetch_size, delay)
            self.set_delay(0)
            run_record["status"] = "completed"
        except BaseException as e:
            run_record["status"] = "failed"
            run_record["error"] = str(e)
            raise
        finally:
            run_record["finished_at"] = now()
            write_json(self.output / "run.json", run_record)
            if run_record["status"] == "failed":
                self.reset_delay()

    def write_inputs(self):
        """Copies what this run uses, in the layout of the repository."""
        database_file = Path("databases") / self.database.file.name
        conditions_file = Path("conditions") / self.conditions.file.name
        (self.output / "databases").mkdir(parents=True)
        (self.output / "conditions").mkdir()
        write_yaml(self.output / "profile.yaml", {
            "name": self.name,
            "database": database_file.as_posix(),
            "conditions": conditions_file.as_posix(),
            "apps": [app.name for app in self.apps],
            "workloads": [workload.id for workload in self.workloads],
        })
        write_yaml(self.output / database_file, self.database.recorded())
        shutil.copy(self.conditions.file, self.output / conditions_file)
        for workload in self.workloads:
            target = self.output / "workloads" / workload.id
            target.mkdir(parents=True)
            shutil.copy(workload.dir / "workload.yaml", target)
            shutil.copytree(workload.sql_dir, target / workload.sql_dir.name)
        for app in self.apps:
            (self.output / "apps" / app.name / "results").mkdir(parents=True)

    def measure(self, app, workload, rows, fetch_size, delay):
        warmups = self.conditions.warmups
        output = app.launch({
            **self.database.environment(),
            "RDB_RTT_BENCHMARK_QUERY": workload.query,
            "RDB_RTT_BENCHMARK_PARAMETERS": json.dumps(workload.parameters_for(rows)),
            "RDB_RTT_BENCHMARK_FETCH_SIZE": str(fetch_size),
            "RDB_RTT_BENCHMARK_EXECUTIONS": str(warmups + self.conditions.repeats),
        }, join_delay=self.conditions.delay == "netem")
        app_dir = self.output / "apps" / app.name
        if not (app_dir / "configuration.json").exists():
            write_json(app_dir / "configuration.json", output["configuration"])

        results = app_dir / "results" / f"{workload.id}.csv"
        new = not results.exists()
        executions = output["executions"][warmups:]
        with results.open("a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, RESULT_COLUMNS)
            if new:
                writer.writeheader()
            for repeat, e in enumerate(executions, 1):
                writer.writerow(result_row(e, rows, fetch_size, delay, repeat))
        elapsed = [e["elapsed_ms"] for e in executions if not e["error"]]
        median = f"{statistics.median(elapsed):.3f} ms" if elapsed else "failed"
        roundtrips = executions[-1]["roundtrips"] if elapsed else "-"
        print(f"{app.name} {workload.id} rows={rows} fetchSize={fetch_size} ΔRTT={delay}ms: "
              f"median {median}, n={roundtrips}", flush=True)

    def set_delay(self, ms):
        if self.conditions.delay == "netem":
            run(["docker", "exec", DELAY_CONTAINER, "delay", str(ms)])

    def reset_delay(self):
        """After a failure, leaves the delay container without delay; the original error is what matters."""
        try:
            self.set_delay(0)
        except RuntimeError:
            pass


def result_row(execution, rows, fetch_size, delay, repeat):
    """Flattens one execution that the application returned into a line of the measurements."""
    error = execution["error"]
    if not error and execution["fetched_rows"] != rows:
        error = f"fetched {execution['fetched_rows']} rows instead of {rows}"
    return {"rows": rows, "fetch_size": fetch_size, "delay_ms": delay, "repeat": repeat,
            "elapsed_ms": execution["elapsed_ms"], "roundtrips": execution["roundtrips"],
            "fetched_rows": execution["fetched_rows"], "error": error or ""}


def run_oracle_script(database, script):
    """Runs a script with SQL*Plus in the local container. Any error stops the run."""
    v = database.values
    input = "\n".join([
        "WHENEVER SQLERROR EXIT FAILURE",
        "WHENEVER OSERROR EXIT FAILURE",
        "SET DEFINE OFF",
        "SET SQLBLANKLINES ON",
        "SET FEEDBACK OFF",
        f'CONNECT {v["user"]}/"{v["password"]}"@//localhost:{v["port"]}/{v["database"]}',
        script.read_text(encoding="utf-8"),
        "COMMIT;",
        "EXIT",
    ])
    run(["docker", "exec", "-i", database.container, "sqlplus", "-s", "-L", "/nolog"], input=input,
        description=f"{script} failed")


# How to run the setup scripts for each type of database. A type that is not here is not supported.
SCRIPT_RUNNERS = {"oracle": run_oracle_script}


class Database:

    def __init__(self, file):
        check(file.is_file(), f"{file} does not exist")
        self.file = file
        self.values = {k: expand_environment(v) for k, v in read_yaml(file).items()}
        self.type = self.values.get("type")
        check(self.type in SCRIPT_RUNNERS, f"{file}: type must be one of {', '.join(SCRIPT_RUNNERS)}")
        for field in ("host", "port", "database", "user", "password"):
            check(self.values.get(field) not in (None, ""), f"{file}: {field} is required")
        self.setup = bool(self.values.get("setup", False))
        self.container = LOCAL_DATABASE_CONTAINER.format(type=self.type)
        if self.setup:
            check(container_running(self.container),
                  f"{file}: setup: true runs the scripts in the local {self.container} container, which is not "
                  "running. For another database, run schema.sql and data.sql in advance and set setup: false")

    def environment(self):
        v = self.values
        return {
            "RDB_RTT_BENCHMARK_DB_TYPE": v["type"],
            "RDB_RTT_BENCHMARK_DB_HOST": str(v["host"]),
            "RDB_RTT_BENCHMARK_DB_PORT": str(v["port"]),
            "RDB_RTT_BENCHMARK_DB_DATABASE": str(v["database"]),
            "RDB_RTT_BENCHMARK_DB_USER": str(v["user"]),
            "RDB_RTT_BENCHMARK_DB_PASSWORD": str(v["password"]),
        }

    def recorded(self):
        return {k: self.values[k] for k in DATABASE_FIELDS_TO_RECORD if k in self.values}

    def run_script(self, script):
        SCRIPT_RUNNERS[self.type](self, script)


class Conditions:

    def __init__(self, file):
        check(file.is_file(), f"{file} does not exist")
        self.file = file
        c = read_yaml(file)
        for field in ("delay", "rows", "fetch_sizes", "delays_ms", "repeats", "warmups"):
            check(field in c, f"{file}: {field} is required")
        self.delay = c.get("delay")
        check(self.delay in ("netem", "none"), f"{file}: delay must be netem or none")
        self.rows = c["rows"]
        self.fetch_sizes = c["fetch_sizes"]
        self.delays_ms = c["delays_ms"]
        self.repeats = c["repeats"]
        self.warmups = c["warmups"]
        check(self.delay == "netem" or self.delays_ms == [0], f"{file}: delay: none can only have delays_ms: [0]")


class Workload:

    def __init__(self, id, database_type):
        self.id = id
        self.dir = ROOT / "workloads" / id
        check((self.dir / "workload.yaml").is_file(), f"workload {id}: workloads/{id}/workload.yaml does not exist")
        w = read_yaml(self.dir / "workload.yaml")
        self.name = w.get("name")
        check(self.name, f"workload {id}: name is required")
        self.sql_dir = self.dir / database_type
        for script in ("schema.sql", "data.sql", "query.sql"):
            check((self.sql_dir / script).is_file(), f"workload {id}: {database_type}/{script} does not exist")
        self.query = (self.sql_dir / "query.sql").read_text(encoding="utf-8")
        self.parameters = w.get("parameters") or {}
        rows = w.get("rows") or {}
        self.source = rows.get("source")
        uses_rows = re.search(r":rows\b", self.query) is not None
        if self.source == "fixed":
            self.count = rows.get("count")
            check(isinstance(self.count, int), f"workload {id}: rows.count is required when rows.source is fixed")
            check(not uses_rows, f"workload {id}: rows.source is fixed, but query.sql uses :rows")
        else:
            check(self.source == "parameter", f"workload {id}: rows.source must be fixed or parameter")
            check(uses_rows, f"workload {id}: rows.source is parameter, but query.sql does not use :rows")

    def rows_to_measure(self, conditions):
        return [self.count] if self.source == "fixed" else conditions.rows

    def parameters_for(self, rows):
        return self.parameters if self.source == "fixed" else {**self.parameters, "rows": rows}


class App:

    def __init__(self, name, database_type, launch):
        self.name = name
        self.dir = ROOT / "apps" / name
        check((self.dir / "app.yaml").is_file(), f"app {name}: apps/{name}/app.yaml does not exist")
        database = read_yaml(self.dir / "app.yaml").get("database")
        check(database == database_type, f"app {name} connects to {database}, not {database_type}")
        self.launch_command = shlex.split(launch) if launch else None
        self.image = f"rdb-rtt-benchmark/{name}"

    def build(self):
        if self.launch_command is None:
            print(f"Building {self.image}", flush=True)
            run(["docker", "build", "-q", "-t", self.image, "-f", str(self.dir / "Dockerfile"), str(ROOT / "apps")])

    def launch(self, environment, join_delay):
        """Runs the application once and returns what it wrote to standard output."""
        if self.launch_command:
            command = self.launch_command
        else:
            network = ["--network", f"container:{DELAY_CONTAINER}"] if join_delay else []
            command = ["docker", "run", "--rm", *network,
                       *[arg for name in environment for arg in ("-e", name)], self.image]
        stdout = run(command, env={**os.environ, **environment}, description=f"{self.name} failed")
        return json.loads(stdout)


def run(command, env=None, input=None, description=None):
    completed = subprocess.run(command, env=env, input=input, capture_output=True, text=True, encoding="utf-8")
    if completed.returncode != 0:
        raise RuntimeError(f"{description or shlex.join(command)} ({completed.returncode}):\n"
                           f"{completed.stdout}{completed.stderr}")
    return completed.stdout


def container_running(name):
    completed = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", name],
                               capture_output=True, text=True)
    return completed.stdout.strip() == "true"


def expand_environment(value):
    """Replaces ${NAME} and ${NAME:-default} in a string with environment variables."""
    if not isinstance(value, str):
        return value

    def replace(match):
        name, default = match.group(1), match.group(3)
        if name in os.environ:
            return os.environ[name]
        check(default is not None, f"environment variable {name} is not set")
        return default

    return re.sub(r"\$\{(\w+)(:-([^}]*))?\}", replace, value)


def read_yaml(file):
    return yaml.safe_load(Path(file).read_text(encoding="utf-8")) or {}


def write_yaml(file, value):
    Path(file).write_text(yaml.safe_dump(value, sort_keys=False, allow_unicode=True), encoding="utf-8", newline="\n")


def write_json(file, value):
    Path(file).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


if __name__ == "__main__":
    main()
