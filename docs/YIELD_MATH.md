# Yield Math: Resource Harvesting & Passive Staking

This document explains the economic formulae used in `src/resource_minter.rs` for
harvesting stardust and calculating cosmic essence (Plasma) yields.

---

## 1. Stardust Harvest

### Formula

```
minted = min(stardust_per_anomaly + anomaly_index × 10,  daily_cap - harvested_today)
```

### Parameters

| Parameter             | Default | Notes                                    |
|-----------------------|---------|------------------------------------------|
| `stardust_per_anomaly`| 100     | Base mint per harvest call               |
| `anomaly_index`       | 0–N     | Rarity score returned by Nebula Explorer |
| `daily_cap`           | 1 000   | Max stardust per ship per ~24 h window   |

### Example

| anomaly_index | raw amount | cap remaining | minted |
|---------------|-----------|---------------|--------|
| 0             | 100       | 1 000         | 100    |
| 5             | 150       | 1 000         | 150    |
| 9             | 190       | 200           | 190    |
| 9             | 190       | 100           | 100    |  ← capped

### Daily window reset

The daily window resets when:

```
current_ledger − last_reset_ledger ≥ LEDGERS_PER_DAY
```

`LEDGERS_PER_DAY = 17 280`  (5 s/ledger × 86 400 s/day ÷ 5 = 17 280)

---

## 2. Staking Yield (Cosmic Essence / Plasma)

### APY Model

The contract uses a **continuous pro-rated APY** model backed by ledger sequence
numbers.  There are no discrete compounding periods — yield accrues every ledger
and can be claimed at any time.

### Formula

```
yield = principal × apy_bps / 10_000 × Δledgers / LEDGERS_PER_YEAR
```

Where:

| Variable           | Description                                          |
|--------------------|------------------------------------------------------|
| `principal`        | Staked resource amount                               |
| `apy_bps`          | APY in basis points (500 = 5 %)                      |
| `Δledgers`         | `current_ledger − last_claim_ledger`                 |
| `LEDGERS_PER_YEAR` | `17 280 × 365 = 6 307 200`                           |

### Worked examples

#### 5 % APY, 100 stardust staked

| Period             | Δledgers        | Yield (integer)  |
|--------------------|-----------------|------------------|
| 1 day              | 17 280          | 0 (< 1 unit)     |
| 30 days            | 518 400         | 0 (< 1 unit)     |
| 73 days (~20 %)    | 1 261 440       | 1 plasma         |
| 146 days (~40 %)   | 2 522 880       | 2 plasma         |
| 1 year (365 days)  | 6 307 200       | **5 plasma**     |
| 2 years            | 12 614 400      | **10 plasma**    |

#### 10 % APY, 1 000 stardust staked

| Period   | Δledgers    | Yield (integer) |
|----------|-------------|-----------------|
| 30 days  | 518 400     | 8 plasma        |
| 90 days  | 1 555 200   | 24 plasma       |
| 1 year   | 6 307 200   | **100 plasma**  |

### Integer truncation

All arithmetic uses `i128` integer division.  Sub-unit yields are truncated (not
rounded) per ledger.  This is intentional:

- Makes contract execution **deterministic** across all nodes.
- Prevents micro-rounding exploits (an attacker cannot profit by claiming every
  single ledger because fractional cosmic essence is discarded).
- Long-term stakers receive the full expected yield because truncation is applied
  per claim interval, not per ledger.

**Best practice:** claim yield infrequently (weekly / monthly) to minimise
truncation loss.

---

## 3. Time-Lock Security

### Why time-locks exist

Without a minimum stake duration an attacker could:

1. Stake a large amount at ledger N.
2. Advance one ledger (Δ = 1).
3. Unstake, collect yield = principal × apy_bps / (10_000 × 6_307_200) per ledger.
4. Repeat thousands of times in a single block batch.

The result is near-zero yield per iteration but infinite repetition within a
block — a flash-stake attack draining the yield pool.

### Protection

```
unstake is blocked while  current_ledger < start_ledger + min_stake_duration
```

`min_stake_duration` defaults to `LEDGERS_PER_DAY = 17 280` (≈ 1 day).
Administrators can increase this value for stronger protection.

---

## 4. Multi-Resource Economics

| Resource   | Source                        | Use                                     |
|------------|-------------------------------|-----------------------------------------|
| Stardust   | Harvested from anomalies      | Staking principal; DEX trading          |
| Plasma     | Earned as staking yield       | Ship upgrades; future crafting          |
| Crystals   | Reserved for future mechanics | Not yet issued                          |

Balances for each type are stored independently under
`DataKey::Balance(owner, ResourceType)`, so adding a new resource type
requires no migration of existing balances.

---

## 5. Configuration Reference

| Config field          | `.env.example` key          | Default | Updatable |
|-----------------------|-----------------------------|---------|-----------|
| `apy_basis_points`    | `STARDUST_APY_BPS`          | 500     | Yes (admin) |
| `daily_harvest_cap`   | `DAILY_HARVEST_CAP`         | 1 000   | Yes (admin) |
| `stardust_per_anomaly`| `STARDUST_PER_ANOMALY`      | 100     | No (redeploy) |
| `min_stake_duration`  | `MIN_STAKE_DURATION_LEDGERS`| 17 280  | No (redeploy) |

---

## 6. Event Reference

| Event topic        | Data fields                              | When emitted            |
|--------------------|------------------------------------------|-------------------------|
| `res_harv`         | `(ship_id, anomaly_index, amount)`       | Successful harvest      |
| `yld_claim`        | `(staked_amount, yield_amount, ledger)`  | Yield claimed / unstake |

---

## 7. Arithmetic safety patterns

The contract-level policy (see the `[profile.release]` comment in `Cargo.toml`)
is that arithmetic must never silently wrap. Two complementary mechanisms are
used, and choosing the right one is part of the code review checklist for any
change that touches balances, rewards, or supply:

### 7.1 `checked_*` — fail the transaction with a contract error

Use for **state mutations**: credits, debits, supply changes, fee splits, and
anything that ends up in storage. A failed `checked_*` operation is converted
into the module's domain error (e.g. `MinterError::ArithmeticOverflow`,
`ContentToolsError::ArithmeticOverflow`), which aborts the transaction with a
diagnosable code instead of a raw overflow trap.

```rust
let new_balance = current
    .checked_add(amount)
    .ok_or(MinterError::ArithmeticOverflow)?;
```

### 7.2 `saturating_*` — clamp derived values

Use for **derived, non-state values** where aborting a read-only call would be
disproportionate: yield forecasts, confidence scores, monotonic counters close
to their type limit, and defensive backstops in helpers such as `constant_product`.

```rust
let predicted_yield = adjusted_daily.saturating_mul(i128::from(days));
```

Never use saturating arithmetic to hide an impossible balance condition — that
would silently create or destroy value.

### 7.3 Shared helpers (`src/safe_math.rs`)

| Helper | Behaviour |
|---|---|
| `checked_mul_div_i128` / `checked_mul_div_u64` | Multiply before dividing to preserve precision; `None` on overflow or zero denominator. |
| `saturating_mul_div_i128` | Same order of operations, but clamps; for forecast/display math only. |
| `saturating_add_i128` / `saturating_sub_i128` | Clamp at the type bounds. |

Multiply-before-divide is intentional: `(7 × 10) / 3 = 23`, whereas
`(7 / 3) × 10 = 20`. Truncation happens once, at the end.

### 7.4 Division by zero

Every division whose denominator can originate from configuration or storage
must use `checked_div` (or the helpers above, which reject zero). Raw `/` is
only acceptable for compile-time non-zero constants such as `10_000` (BPS) and
`6_307_200` (`LEDGERS_PER_YEAR`).

### 7.5 Tests

Overflow scenarios live in `src/safe_math.rs` (unit tests for the helpers) and
in `tests/fuzz/` / `tests/chaos/byzantine_attacks.rs` (extreme-value scenarios).
When fixing a raw-arithmetic site, add a test that drives the actual call with
`i128::MAX`/`u64::MAX` inputs and asserts the domain error rather than a panic.
