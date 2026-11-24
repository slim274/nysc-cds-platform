# Infrastructure monitoring

This stack is optional and runs through the Docker Compose `monitoring` profile. It does not change the normal development startup.

## Components

- **Prometheus** collects metrics every 15 seconds.
- **Grafana** provides the provisioned *NYSC CDS Platform - Infrastructure Overview* dashboard.
- **PostgreSQL Exporter** collects database metrics from the existing `postgres` service.
- **Node Exporter** collects host CPU, memory, filesystem, and network metrics.
- **cAdvisor** collects Docker container resource metrics.
- **Blackbox Exporter** checks the API's `/health` and `/health/db` endpoints.

The Blackbox probes target the API Compose service at `api:3001`. Start the API service with `docker compose --profile app up -d api` before starting the monitoring profile. The API health panels will show DOWN while the API container is stopped; the other exporters can still report their metrics.

## Start monitoring

1. Make sure the root `.env` file contains the PostgreSQL variables used by the existing Compose setup. Copy `.env.example` if you do not already have one, then replace the example passwords.
2. Start the API service and monitoring stack:

   ```bash
   docker compose --profile app up -d api
   docker compose --profile monitoring up -d
   ```

4. Open the services locally:

   | Service | URL |
   |---|---|
   | Grafana | http://localhost:3000 |
   | Prometheus | http://localhost:9090 |

Grafana uses `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` from the root `.env` file. `GRAFANA_ADMIN_USER` defaults to `admin`, but `GRAFANA_ADMIN_PASSWORD` is required when the monitoring profile starts; the Compose configuration deliberately has no default admin password. Use a unique password and do not expose Grafana beyond your machine without an appropriate access-control and TLS setup.

Check Prometheus targets at http://localhost:9090/targets. The dashboard and Prometheus UI are bound to `127.0.0.1`, so they are not published to your LAN by this Compose configuration. Container CPU and memory panels are filtered to the Compose project label `nysc-cds-platform`, excluding unrelated Docker projects on the same host.

## Stop monitoring

To stop only monitoring while leaving the database and Redis running, use `docker compose stop prometheus grafana postgres-exporter node-exporter cadvisor blackbox-exporter`. To stop every container in this Compose project, use `docker compose --profile monitoring down`; this also stops PostgreSQL, Redis and any active app-profile containers. Both commands retain named volumes. Do not add `-v` unless you intentionally want to delete database or monitoring data.

## Notes

- The host and container exporters use Linux host mounts. This configuration is intended for the Ubuntu/Linux development environment.
- The API is monitored through HTTP probes, not application-level request metrics. A future API instrumentation change can add request counts, latency, and error-rate metrics.
