# Test Organization

Unit tests live inline next to the code (`src/*.rs`, `#[cfg(test)] mod tests`).
Everything under `tests/` is an **integration test** — it goes through the
deployed contract client, not bare module functions.

Integration tests are grouped by module/domain into subdirectories. Each file
is still registered as its own `[[test]]` target in `Cargo.toml` with an
explicit `path`, so existing invocations like
`cargo test --test test_disaster_recovery` or `cargo test test_event_scheduler`
keep working unchanged.

| Directory      | Contents                                                        |
|----------------|------------------------------------------------------------------|
| `fuzz/`        | Fuzz / property-based tests (`fuzz*.rs`)                          |
| `economy/`     | Staking, yield, DEX, gas sponsorship, batching, fractional resources |
| `governance/`  | DAO, RBAC, emergency controls                                    |
| `gameplay/`    | Ships, seasons, gifting, exploration, difficulty scaling          |
| `infra/`       | Storage, snapshots, disaster recovery, oracles, event scheduling, memory leaks |
| `integration/` | End-to-end cross-contract flows (player journey, guilds, economy, governance, emergency) |
| `property/`    | `proptest` property suites for core modules (Issue #477)         |
| `property_tests/` | Determinism property tests for `nebula_gen` (Issue #428)      |
| `misc/`        | Cross-cutting / multi-issue regression suites                    |
| `fixtures/`    | Shared test data builders                                         |
| `helpers/`     | Shared test setup helpers                                         |
| `chaos/`       | Chaos-engineering scenario configs (not Rust tests)               |
| `load/`        | k6 load-test scripts (not Rust tests)                             |

To run one group: `cargo test --test 'test_*' -- --test-threads=1` won't
filter by directory (Cargo test names are flat), so use the file's `name` or
run everything with `cargo test --all`.

## E2E integration tests (`integration/`)

These exercise full flows across multiple contract modules through the
deployed client, not bare module functions. Every file is its own
`[[test]]` target (see `Cargo.toml`), so a single suite runs as
`cargo test --test player_journey_test`.

| Target | Flow covered |
|---|---|
| `test_e2e_flows` | Cross-cutting end-to-end scenarios (Issue #427) |
| `player_journey_test` | Full player lifecycle: onboard → gather → craft → upgrade → trade |
| `guild_operations_test` | Guild creation, membership, treasury, cooperative quests |
| `economic_cycle_test` | Mint → spend → sink → re-mint economic loop, incl. dynamic pricing |
| `governance_flow_test` | Proposal → vote → execute, parameter changes landing in game code |
| `emergency_scenarios_test` | Pause/unpause, emergency withdrawal, degraded-mode behaviour |

**E2E test patterns.** Keep to these when extending the suites:

1. **Setup once, then act through entry points.** Use `tests/helpers` /
   `tests/fixtures` builders for accounts and starting state; every action
   after setup goes through the contract client, the same path a user hits.
2. **Assert observable state, not internals.** Read back balances, records,
   and emitted events rather than poking module internals.
3. **Scenario tests, not unit tests.** One test = one story ("player buys a
   ship upgrade mid-season"). Cover the happy path first, then the failure
   branches the flow can actually hit (rate limits, insufficient resources,
   paused contract).
4. **Cross-contract flows must verify the seam.** When a flow crosses two
   modules (e.g. `ship_upgrade` spending `resource_minter` balances), assert
   both sides: the target state changed *and* the ledger moved.
5. **Emergency tests must be order-independent.** State that a scenario
   mutates (pause flags, sink totals) is reset in that test's setup so suites
   can run in any order.

## Property tests (`property/`, `property_tests/`)

`proptest` suites that assert *invariants* over randomly generated inputs
rather than fixed examples. Each file is its own `[[test]]` target.

| Target | Property area |
|---|---|
| `nebula_gen_properties` | Generation invariants: bounds, anomaly placement, layout hashes |
| `test_nebula_gen_properties` | Determinism: same seed ⇒ identical layout (Issue #428) |
| `resource_minter_properties` | Ledger invariants: conservation, non-negative balances, supply |
| `economic_properties` | Economic bounds: price caps, sink monotonicity, EMA smoothing |

**What a property test is for.** A unit test says "input X gives output Y"; a
property test says "for *all* inputs, relation Z holds" and uses `proptest` to
search for counterexamples — including the awkward ones nobody would
hand-write (zero values, `u64::MAX`, overflow-adjacent numbers). When a
regression is found, the shrinking output names the minimal failing input;
add that case as a named regression alongside the property.

**Conventions for new properties:**

1. Name the invariant, not the function: `prop_mint_never_exceeds_supply`,
   not `test_mint`.
2. Constrain the strategy to *valid* inputs where the API has preconditions
   (e.g. region ids in `1..=MAX_REGION_ID`); keep a separate property for
   the rejection behaviour with out-of-range inputs.
3. Properties must be order-independent and side-effect-free with respect to
   each other; no shared mutable fixtures between cases.
4. Determinism properties (same seed ⇒ same output) are the cheapest
   regression net for procedural generation — prefer them over golden files.
