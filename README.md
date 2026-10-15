# rdb-rtt-benchmark

rdb-rtt-benchmark measures how the round-trip time (RTT) between an application and a database affects SQL response time, and simulates the response time of a scenario that runs several SQL statements.

The benchmark is based on the following model:

```text
T = T0 + n × ΔRTT
```

T is the SQL response time, T0 is the response time at ΔRTT 0 ms, n is the number of round trips, and ΔRTT is the time added to each round trip. The benchmark adds ΔRTT to the network and measures T and n.

## Demo

[The sample report](https://hainet50b.github.io/rdb-rtt-benchmark/) shows SQL response times for each application configuration.

![The report](docs/images/report.png)

## Quick start

You need Docker with Docker Compose, and [uv](https://docs.astral.sh/uv/).

```bash
docker compose up -d
uv run driver.py profile.yaml --conditions conditions/quick.yaml --output measurements/quick
uv run renderer/renderer.py measurements/quick
```

Open `reports/quick.en.html`. To render the report in Japanese, use `--lang ja`:

```bash
uv run renderer/renderer.py measurements/quick --lang ja
```

Setup creates the tables of each workload and never drops them. To measure again, recreate the database container with `docker compose down` and `docker compose up -d`.

## Customize a run

### Profile

`profile.yaml` defines what one run of the driver measures.

```yaml
name: RDB RTT Benchmark
database: databases/oracle.yaml
conditions: conditions/standard.yaml
apps:
  - spring-boot-doma-ucp-ojdbc
  - spring-boot-doma-hikari-ojdbc
workloads:
  - W-01
  - W-02
```

Each field can be overridden with an option of the same name:

```bash
uv run driver.py profile.yaml \
  --conditions conditions/quick.yaml
```

### Database

`databases/oracle.yaml` defines the database that the applications connect to.

```yaml
type: oracle
host: rdb-rtt-benchmark-oracle
port: 1521
database: FREEPDB1
user: rdb_rtt_benchmark
setup: true
```

With `setup: true`, the driver runs `schema.sql` and `data.sql` of each workload in the database container. To measure another database, run those scripts in advance and set `setup: false`.

Values in the file can refer to environment variables, such as `password: ${DB_PASSWORD}`. The password can be written in the file directly, but it is better to pass it through an environment variable.

### Conditions

`conditions/standard.yaml` defines how each query is executed.

```yaml
delay: netem               # netem | none
rows: [1, 10, 100, 1000, 10000]
fetch_sizes: [10, 100, 1000]
delays_ms: [0, 1, 2, 5, 10, 20, 50]
repeats: 10
warmups: 10
```

`conditions/quick.yaml` measures fewer conditions for a trial run. To measure the actual network path instead of an added delay, set `delay: none` and `delays_ms: [0]`.

> [!NOTE]
> `delay: netem` uses `tc netem`, which works on Linux and on Docker Desktop with WSL 2.

### Applications

An application issues the SQL that the driver measures. `profile.yaml` lists applications by the names of their directories in `apps/`, and a directory with `app.yaml` is one application.

With `delay: none`, `--launch APP=COMMAND` runs an application without its container image.

### Workloads

Each directory in `workloads/` is a workload: a query and the dataset that it reads. The SQL files are placed in a directory for each database type.

```text
workloads/W-01/
  workload.yaml
  oracle/
    schema.sql
    data.sql
    query.sql
```

`workload.yaml` defines how the query is executed.

```yaml
name: Fetch one row by primary key
rows:
  source: fixed
  count: 1
parameters:
  id: 42
```

`rows.source` decides which rows the driver measures: `fixed` measures the `count` rows that the query always returns, and `parameter` measures each of the rows in the conditions through `:rows` in the query.

### Scenarios

Each file in `scenarios/` is a scenario: the queries that one operation runs.

```yaml
name: Order lookup (example)
queries:
  - workload: W-01
    count: 3
  - workload: W-02
    rows: 100
    count: 1
```

The report shows the response time of each scenario.

## License

Licensed under either of

 * Apache License, Version 2.0
   ([LICENSE-APACHE](LICENSE-APACHE) or <http://www.apache.org/licenses/LICENSE-2.0>)
 * MIT license
   ([LICENSE-MIT](LICENSE-MIT) or <http://opensource.org/licenses/MIT>)

at your option.

## Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
