# Polo Go probe

Fetches monitors from the Polo web API, checks targets concurrently, posts results,
and exports Prometheus metrics. The web application must be running separately.

## Run locally in PowerShell

Requires Go 1.27.4 or newer, matching `go.mod`.

```powershell
Set-Location 'E:\devops\polo-uptime-monitoring-platform\probe'
go mod download
go run .
```

Keep one probe instance running. Stop it with Ctrl+C before restarting.
The default port is 8082 because Jenkins already uses 8080 on this machine.

```powershell
curl.exe -i http://localhost:8082/health
curl.exe -s http://localhost:8082/metrics | Select-String 'polo_'
```

The health endpoint reports process availability. Check `polo_scan_success` and
`polo_last_scan_timestamp_seconds` to establish whether scans are completing.
The probe reads process environment variables; it does not load `.env` files.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_API_URL` | `http://localhost:3000` | Web API base address |
| `LISTEN_ADDR` | `:8082` | Health and metrics listening address |
| `CHECK_INTERVAL` | `60s` | Scan ticker interval |
| `HTTP_TIMEOUT` | `10s` | Per-request timeout, including response body reads |
| `MAX_CONCURRENCY` | `10` | Maximum workers checking and submitting results |

For example, set `$env:CHECK_INTERVAL = '30s'` before starting the process.
Duration settings must be positive; the worker limit must be between 1 and 1000.

## How it works

1. `loadConfig` reads and validates the environment. `run` binds the port before
   starting work, so duplicate instances cannot submit results on startup.
2. `fetchMonitors` calls `GET /api/monitors` at the start of every scan, so added
   and deleted monitors are picked up without a restart.
3. `runChecks` feeds a bounded worker pool. Each goroutine takes one monitor at
   a time. A `WaitGroup` waits until all work completes. Scans never overlap.
4. `probe` sends a GET with `User-Agent: Polo-Probe/1.0`, follows normal HTTP
   redirects, and verifies TLS using system certificate authorities. HTTP
   200–399 means UP; HTTP 400–599 and request failures mean DOWN. A failure
   without an HTTP response uses status code 0.
5. Latency measures time to the final response headers or request failure,
   including redirects. It excludes body draining. TLS expiry uses the final
   connection's leaf certificate and rounds remaining time down to whole days.
6. `recordMetrics` updates gauges before submission. `postResult` sends the JSON
   contract expected by `POST /api/check-result`, including a UTC timestamp.
   Failed posts are logged and counted. They are not retried automatically:
   the existing API inserts incidents on DOWN and has no deduplication key.
7. The ticker starts an immediate initial scan, then scans on each interval.
   Slow scans can cause ticker events to be skipped. A failed fetch is retried
   on a later scan; it does not terminate the process.
8. Ctrl+C or SIGTERM cancels in-flight requests, waits for workers, and shuts
   down the HTTP server. Cancellation does not post a new target outage.

HTTP clients are reused; response bodies are closed and small bodies drained
for connection reuse. API redirects are rejected. Target URLs are omitted from
logs because query strings can contain sensitive values.

## Metrics

Target metrics use the `monitor_id` label. Deleted monitors are removed after
the next successful monitor fetch.

| Metric | Meaning |
| --- | --- |
| `polo_target_up` | 1 for UP, 0 for DOWN |
| `polo_target_latency_ms` | Time to headers or failure in milliseconds |
| `polo_target_ssl_expiry_days` | Verified certificate lifetime, absent if unavailable |
| `polo_target_ssl_available` | 1 if the last check obtained a TLS certificate, otherwise 0 |
| `polo_result_post_failures_total` | Failed result submissions |
| `polo_scan_success` | 1 if the last scan fetched targets and submitted every result |
| `polo_last_scan_timestamp_seconds` | Last completed scan time, including failed scans |

Go runtime and process metrics are also included. A failed target can still be
part of a successful scan: target health and result delivery are separate signals.
The web API receives `sslExpiryDays: -1` for unavailable TLS to preserve its integer
contract. Prometheus omits the expiry series in that case, rather than treating
the sentinel as an expiring certificate. An expired certificate normally fails
verification, producing DOWN and no verified TLS expiry value.

## Build and test

```powershell
go vet ./...
go test -cover ./...
go build -o bin/polo-probe.exe .
```

The default tests use local HTTP/TLS servers and do not write to Neon. They cover the API
payload, HTTP failures, verified and untrusted TLS, redirects, timeouts, worker
limits, repeated scans, metrics cleanup, posting failures, health, port conflicts,
and configuration validation.

`live_test.go` also provides an opt-in integration test. It performs a real scan,
checks the HTTP health and metrics endpoints, then reads the web API to verify
fresh stored timestamps for every existing monitor. It posts real check results
and can create incidents for DOWN targets. To explicitly enable it:

```powershell
$env:POLO_LIVE_API_URL = 'http://localhost:3000'
go test -count=1 -run '^TestLiveAPI$' -v ./...
Remove-Item Env:POLO_LIVE_API_URL
```

The Docker test stage provides Linux C tooling for race detection:

```powershell
docker build --target test -t polo-probe:test .
```

## Docker

```powershell
docker build -t polo-probe:local .
docker run -d --name polo-probe --restart unless-stopped -p 127.0.0.1:8082:8080 -e WEB_API_URL=http://host.docker.internal:3000 polo-probe:local
docker logs polo-probe
docker inspect --format '{{.State.Health.Status}}' polo-probe
```

Stop the local Go process before binding port 8082. `host.docker.internal` reaches
the Windows host from Docker Desktop. A future Compose deployment should use
`WEB_API_URL=http://polo-web:3000` on its shared Docker network.

The builder compiles a static Linux binary with `CGO_ENABLED=0`. The final Alpine
image includes CA certificates, runs as the non-root `polo` user, and exposes port
8080 internally. Its Docker health check calls `/health`. The `.dockerignore`
allows only Go source and dependency files into the build context.

To stop and remove a container created with the command above:

```powershell
docker stop polo-probe
docker rm polo-probe
```

The API currently creates an incident for every DOWN submission. A persistent
failing target therefore produces a new incident each scan. This behavior belongs
to the web API. External endpoints such as `httpstat.us` can also fail with EOF
instead of returning the requested HTTP code; both outcomes are recorded as DOWN.
