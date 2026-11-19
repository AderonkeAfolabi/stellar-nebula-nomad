# Runbooks Index

Operating procedures for the Stellar Nebula Nomad contract suite. Start here
when deploying, reversing a change, diagnosing a symptom, or responding to an
incident.

| Runbook | Use when | First move |
|---|---|---|
| [deployment.md](deployment.md) | Shipping the economy rebalance (ship upgrades, repair sink, dynamic pricing) | Run the pre-flight checks (§2) |
| [rollback.md](rollback.md) | A deployed change is wrong and must be reversed | Pick the cheapest tier that fixes the symptom |
| [troubleshooting.md](troubleshooting.md) | A specific error code or "why is X behaving oddly" | Find the symptom in the section for that subsystem |
| [incident-response.md](incident-response.md) | Something is wrong in production right now | Classify severity (§1), freeze the feature (§2.1) |
| [MONITORING.md](MONITORING.md) | Need dashboards, alerts, or logs | `docker compose -f monitoring/docker-compose.yml up -d` |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Terraform layout and environment changes | `terraform plan` before any `apply` |

Related docs outside this directory: [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
(general developer troubleshooting), [DISASTER_RECOVERY_PLAN.md](../DISASTER_RECOVERY_PLAN.md),
[ROLLBACK_PROCEDURES.md](../ROLLBACK_PROCEDURES.md), [MONITORING_SETUP.md](../MONITORING_SETUP.md).

---

## Quick reference cards

One card per scenario. Each points at the full procedure — the card gets you
moving, the runbook gets it right.

### Card: shipping a release

1. `git status --short` — only intended changes; note the base commit.
2. `rustup target add wasm32v1-none` then build the release artifact.
3. Run the suites listed in [deployment.md §2](deployment.md) and the
   storage-key collision check.
4. Deploy blue/green; verify before promoting the alias.
5. Apply post-deploy config (upgrade curve, repair sink, pricing) and run the
   verification reads in [deployment.md §5](deployment.md).

### Card: rollback

| Symptom | Tier | Lever |
|---|---|---|
| Prices/volatility wrong | 1 | Retune config on-chain (`set_pricing_config`, `set_upgrade_economy`, `set_repair_config`) |
| Repair sink too hot | 1 | Raise repair cost / throttle (see [rollback.md §1.2](rollback.md)) |
| Upgrade costs wrong | 1 | `set_upgrade_economy` with `growth_bps = 0` restores the legacy flat schedule |
| Feed data corrupt | 2 | Re-seed the pricing baseline (widen cap → corrected observations → re-narrow) |
| Code is the problem | 3 | Blue/green alias flip (zero fee) |
| Previous build was correct | 4 | Redeploy the previous WASM |

Always run the [after-any-rollback](rollback.md) checklist (state capture,
comms, verification reads).

### Card: incident severity

| Sev | Definition | Response |
|---|---|---|
| **Sev-1** | Funds at risk, sink totals corrupted, supply wrong | Page now. Halt feature. Roll back now. |
| **Sev-2** | Feature unusable or badly mispriced (>2×), no fund loss | Within 1 hour. Retune config. |
| **Sev-3** | Degraded but bounded (error spikes, one resource unpriceable) | Same business day. Diagnose, schedule fix. |

**Escalate a level immediately if** a sink total decreased, resource supply is
not conserved between reads, `list_at_market` moved funds without a `DexOffer`,
or a repair happened for zero cost.

First 15 minutes: freeze the feature (push the deviation cap down, throttle
the repair sink) → capture state (config, pricing state, sink totals,
deployment record) → identify the layer (config / feed / code) → then pick the
playbook in [incident-response.md §4](incident-response.md).

### Card: error code → runbook section

| Symptom | Where |
|---|---|
| `InvalidEconomy` (210) on upgrades | [troubleshooting.md §2.1](troubleshooting.md) |
| Upgrade prices did not change | [troubleshooting.md §2.2](troubleshooting.md) |
| `ShipNotFound` / `NotOwner` on repair | [troubleshooting.md §3.1](troubleshooting.md) |
| `InsufficientResources` (3) | [troubleshooting.md §3.2](troubleshooting.md) |
| `ResourceNotFound` (5) on pricing | [troubleshooting.md §4.1](troubleshooting.md) |
| `CooldownActive` (6) | [troubleshooting.md §4.3](troubleshooting.md) |
| A sink total decreased | [troubleshooting.md §5.1](troubleshooting.md) → then [incident-response.md §4.2](incident-response.md) |
| `wasm32v1-none` target missing | [troubleshooting.md §5.3](troubleshooting.md) |

### Card: monitoring triage

1. Alerts dashboard → what is firing and at what severity.
2. System Health → resource exhaustion?
3. The subsystem dashboard (Contract / Economic / Game) for the affected area.
4. Loki in Grafana Explore, e.g. `{container="nebula-contract-exporter"}`.
5. Escalate per the receiver: `critical-alerts` → Slack `#nebula-critical` +
   on-call email; `warning-alerts` → Slack `#nebula-alerts`.

---

## Conventions

- Runbooks describe the **economy rebalance release** (ship upgrades #454,
  repair sink #453, dynamic pricing #452) unless noted otherwise. Each of
  those subsystems is admin-gated configuration: behaviour can be corrected
  on-chain without a code upgrade.
- Commands are run from the repository root unless the block says otherwise.
- Every rollback tier is reversible; prefer the cheapest tier that fixes the
  symptom (config retune over redeploy).
