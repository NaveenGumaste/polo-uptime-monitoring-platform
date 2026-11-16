"""Build a private deployment bundle without writing secrets to logs."""
import os
import shutil
from pathlib import Path


def required(name):
    value = os.environ.get(name, "")
    if not value or "\n" in value or "\r" in value or "\x00" in value:
        raise SystemExit(f"{name} must be set to a single-line value")
    return value


os.umask(0o077)
bundle = Path(os.environ["RUNNER_TEMP"]) / "polo-release"
bundle.mkdir(mode=0o700)
secrets = bundle / "secrets"
secrets.mkdir(mode=0o700)
shutil.copy2("docker-compose.prod.yml", bundle)
shutil.copytree("monitoring", bundle / "monitoring", ignore=shutil.ignore_patterns(".env*"))
shutil.copytree("scripts/deploy", bundle / "scripts")

(secrets / "web.env").write_text(f"DATABASE_URL={required('DATABASE_URL')}\n", encoding="utf-8")
(secrets / "discord-webhook").write_text(required("DISCORD_WEBHOOK_URL"), encoding="utf-8")
(secrets / "grafana-admin-password").write_text(required("GRAFANA_ADMIN_PASSWORD"), encoding="utf-8")
(secrets / "registry-token").write_text(required("REGISTRY_TOKEN"), encoding="utf-8")
(bundle / "registry-user").write_text(required("REGISTRY_USER"), encoding="utf-8")
repository = required("GITHUB_REPOSITORY").lower()
commit = required("GITHUB_SHA")
(bundle / "release.env").write_text(
    f"WEB_IMAGE=ghcr.io/{repository}-web:{commit}\n"
    f"PROBE_IMAGE=ghcr.io/{repository}-probe:{commit}\n",
    encoding="utf-8",
)
print("Prepared private release bundle with commit-tagged images.")
