"""Check the running application, completed probes, and Prometheus scrapes."""
import json
import time
from urllib.error import URLError
from urllib.request import urlopen


def read(url):
    with urlopen(url, timeout=10) as response:
        return response.read().decode()


deadline = time.monotonic() + 120
while True:
    try:
        monitors = json.loads(read("http://127.0.0.1:3001/api/monitors"))
        if not isinstance(monitors, list) or not monitors:
            raise ValueError("Monitor API returned no monitors")
        if read("http://127.0.0.1:8082/health").strip() != "ok":
            raise ValueError("Probe health check failed")
        metrics = read("http://127.0.0.1:8082/metrics")
        values = dict(line.split()[:2] for line in metrics.splitlines() if line and not line.startswith("#"))
        if float(values.get("polo_scan_success", "0")) != 1:
            raise ValueError("Probe has not successfully posted a complete scan")
        age = time.time() - float(values.get("polo_last_scan_timestamp_seconds", "0"))
        if age < -30 or age > 120:
            raise ValueError("Probe scan timestamp is stale")
        query = json.loads(read("http://127.0.0.1:9090/api/v1/query?query=up%7Bjob%3D%22polo-probe%22%7D"))
        targets = query["data"]["result"]
        if not targets or any(float(target["value"][1]) != 1 for target in targets):
            raise ValueError("Prometheus is not scraping the probe successfully")
        grafana = json.loads(read("http://127.0.0.1:3002/api/health"))
        if grafana.get("database") != "ok":
            raise ValueError("Grafana database is not healthy")
        read("http://127.0.0.1:9093/-/ready")
        print(f"Verified {len(monitors)} monitors, fresh posted probe results, Prometheus scrape, Grafana, and Alertmanager.")
        break
    except (URLError, ValueError, KeyError, TimeoutError) as error:
        if time.monotonic() >= deadline:
            raise SystemExit(f"Deployment verification failed: {type(error).__name__}") from None
        time.sleep(5)
