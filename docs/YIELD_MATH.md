# Yield Farming Math

All yield calculations in `src/yield_farming.rs` use checked integer arithmetic in basis points (`10_000 bps = 100%`) to avoid floating-point nondeterminism on Soroban.

## Staking Tiers

| Tier | Minimum Stake | Reward Multiplier |
|---|---:|---:|
| Bronze | `< 5,000` | `10,000 bps` (`1.00x`) |
| Silver | `5,000` | `11,000 bps` (`1.10x`) |
| Gold | `25,000` | `12,500 bps` (`1.25x`) |
| Platinum | `100,000` | `15,000 bps` (`1.50x`) |

## Time-Weighted Multiplier

`time_weight_bps(elapsed_secs, lock_secs)` scales linearly from `10,000 bps` (`1.00x`) at `elapsed = 0` up to `15,000 bps` (`1.50x`) once `elapsed >= lock_secs`:

```text
weight_bps = 10_000 + floor(min(elapsed_secs, lock_secs) * 5_000 / lock_secs)
```

## Compound APY & Rewards

- **Effective APY (`calculate_apy_bps`)**: computes `((1 + apr / n)^n - 1)` in basis points using `1e9` fixed-point exponentiation by squaring.
- **Compound Reward (`compound_reward`)**: applies `calculate_farm_reward` across `periods` compounding intervals (plus any remainder seconds) with checked addition so overflows return `None`.
