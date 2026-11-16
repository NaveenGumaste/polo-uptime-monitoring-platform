# EC2 deployment

Pushes to `main` build, scan, and publish both application images, then deploy
the matching commit tags through SSH over AWS Systems Manager. The standalone
access-test workflow remains available for connection troubleshooting.

Required repository variables: `AWS_REGION`, `AWS_ROLE_ARN`, `EC2_INSTANCE_ID`.
Required secrets: `EC2_SSH_KEY`, `DATABASE_URL`, `DISCORD_WEBHOOK_URL`,
`GRAFANA_ADMIN_PASSWORD`. GHCR pulls use the job's temporary `GITHUB_TOKEN`.

Each deployment lives under `/opt/polo/releases/<commit>-<run>-<attempt>`.
`/opt/polo/current` points to the most recent verified release. Secret directories
are accessible only to the deployment user. Registry credentials are removed
after pulling images. Runtime secrets remain on the server because the containers
need them. Never print `docker compose config` without `--quiet`: resolved
configuration includes the database URL.

All five service ports bind to `127.0.0.1`. Use an SSH tunnel until Nginx and HTTPS
are configured. On the server:

```sh
cd /opt/polo/current
docker compose --env-file release.env -f docker-compose.prod.yml ps
python3 scripts/verify-release.py
```

Deployment waits for all container health checks, then checks fresh successful
probe scans, the web API, Prometheus scraping, Grafana, and Alertmanager.
A failing monitored website is expected to produce a DOWN result; it does not
mean the deployment failed. Existing alert rules may send Discord notifications.

Failed updates attempt to restore the previous release using cached images.
This restores container configuration, not database or volume contents. Failed
first deployments have no previous release to restore. Release directories and
images are retained for troubleshooting and rollback; review disk use periodically.
Never delete a release whose bind mounts are still used by running containers.
Docker volumes preserve monitoring data. Grafana's admin password secret sets
the initial password; changing it later requires a Grafana password reset.

The local `docker-compose.yml` remains the development configuration.
