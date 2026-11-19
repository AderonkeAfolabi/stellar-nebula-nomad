# Player Housing System

**Module:** `src/player_housing.rs` (Issue #532)  
**Contract:** `NebulaNomadContract` entry points prefixed `housing_*`  
**Frontend:** `frontend/src/views/Housing.tsx`

Player housing gives every player an instanced personal space they can
customize, furnish, decorate with achievements and guild banners, expand, and
share with visitors. Houses live entirely in Soroban persistent storage and are
addressable by the owner's `Address`.

---

## 1. Feature overview

| Feature | What it does |
|---|---|
| **House instances** | One house per player, created at `Small` size with `Public` access |
| **Size tiers** | `Small` → `Medium` → `Large` upgrades paid in Stellar Dust |
| **Customization** | Wall, floor and lighting theme IDs; access mode |
| **Furniture system** | Define catalog items, purchase, place (x/y/rotation/layer), remove |
| **Achievement display cases** | Show unlocked achievements in bounded slots |
| **Guild banners** | Display the player's on-chain guild name and a motto |
| **Storage expansion** | 5 levels, each granting +100 item slots (and furniture slots) |
| **Visitors** | Public / private / friends-only access, visit records, 1–5 star ratings |
| **Discovery** | Curators can feature houses in named tiers (e.g. `trending`) |

---

## 2. Data model

Storage is namespaced with the `HousingKey` enum so it cannot collide with
other modules:

```text
HousingKey::House(owner)             → HouseInstance
HousingKey::Furniture(id)            → FurnitureItem
HousingKey::Placement(owner)         → Vec<PlacedFurniture>
HousingKey::Rating(owner)            → HouseRating
HousingKey::Visitors(owner)          → Vec<VisitorRecord>
HousingKey::AchievementDisplay(owner)→ Vec<AchievementDisplay>
HousingKey::GuildBanner(owner)       → GuildBanner
HousingKey::Storage(owner)           → HouseStorage
HousingKey::Discovery(tier)          → Vec<Address>
HousingKey::HousingCounter           → u64 (furniture IDs)
HousingKey::DisplayCounter           → u64 (display case IDs)
```

Key types:

- `HouseInstance` — owner, size, access, themes, counters, average rating.
- `FurnitureItem` — catalog definition with category, rarity, cost, bonus.
- `PlacedFurniture` — `furniture_id`, `x`, `y` (0–999), `rotation` (0/90/180/270), `layer`.
- `AchievementDisplay` — `display_id`, `achievement_id`, `slot`, `installed_at`.
- `GuildBanner` — `guild_name`, `motto`, `installed_at`.
- `HouseStorage` — `level`, `base_capacity`, `bonus_capacity`, `last_expanded_at`.

### Bounds

| Constant | Value | Purpose |
|---|---|---|
| `MAX_FURNITURE_PER_HOUSE` | 200 | Global furniture cap (keeps reads bounded) |
| `MAX_ACHIEVEMENT_DISPLAYS` | 24 | Max display cases per house |
| `MAX_VISITOR_RECORDS` | 50 | Rolling visitor history |
| `MAX_FEATURED_HOUSES` | 20 | Per discovery tier |
| `MAX_STORAGE_LEVEL` | 5 | Storage upgrade cap |
| `BASE_STORAGE_CAPACITY` | 100 | Capacity before upgrades |
| `STORAGE_CAPACITY_PER_LEVEL` | 100 | Extra capacity per upgrade |

House size tiers allow 50 (Small), 100 (Medium) and 200 (Large) placements.
Storage upgrades add their bonus to that tier allowance, capped at the global
`MAX_FURNITURE_PER_HOUSE` of 200.

---

## 3. Contract API

All methods are on `NebulaNomadContract`. Every mutating method authenticates
the relevant address via `require_auth()`.

### House lifecycle

```rust
housing_initialize(owner) -> Result<HouseInstance, HousingError>
housing_upgrade(owner) -> Result<HouseInstance, HousingError>
housing_set_access(owner, access) -> Result<(), HousingError>
housing_customize_theme(owner, wall, floor, lighting) -> Result<(), HousingError>
```

`housing_initialize` requires a player profile (`player_profile`). Upgrade
costs 5,000 Stellar Dust (Small→Medium) and 15,000 (Medium→Large).

### Furniture

```rust
housing_define_furniture(creator, name, category, rarity, cost_resource,
                         cost_amount, is_functional, bonus_description,
                         is_limited_edition) -> Result<u64, HousingError>
housing_purchase_furniture(owner, furniture_id) -> Result<(), HousingError>
housing_place_furniture(owner, furniture_id, x, y, rotation, layer)
    -> Result<(), HousingError>
housing_remove_furniture(owner, furniture_id) -> Result<(), HousingError>
```

`housing_define_furniture` is intended for an admin/creator address; there is
no on-chain role check in the module itself, so the calling contract/client
must enforce authorization for catalog writes.

### Achievement displays

```rust
housing_install_achievement(owner, achievement_id, slot) -> Result<u64, HousingError>
housing_remove_achievement(owner, display_id) -> Result<(), HousingError>
housing_get_achievement_displays(owner) -> Vec<AchievementDisplay>
```

An achievement must be **unlocked** by the player — verified through
`achievements::query_progress`. Each achievement and each slot can only be used
once; attempting a duplicate returns `AlreadyDisplayed`.

### Guild banners

```rust
housing_set_guild_banner(owner, motto) -> Result<(), HousingError>
housing_clear_guild_banner(owner) -> Result<(), HousingError>
housing_get_guild_banner(owner) -> Option<GuildBanner>
```

The guild name is read from `leaderboards::get_player_guild` rather than being
user-supplied, so banners cannot claim an arbitrary guild. Setting a banner
without a guild affiliation returns `NoGuildMembership`.

### Storage expansion

```rust
housing_expand_storage(owner) -> Result<HouseStorage, HousingError>
housing_get_storage(owner) -> Option<HouseStorage>
housing_get_storage_capacity(owner) -> u32
```

Cost is quadratic: `2,000 × level²` Stellar Dust for the next level. Each
level grants +100 capacity, usable both as item capacity and as extra furniture
placements.

### Visits, ratings and discovery

```rust
housing_visit(visitor, house_owner) -> Result<(), HousingError>
housing_rate(visitor, house_owner, rating) -> Result<(), HousingError>
housing_feature(curator, house_owner, tier) -> Result<(), HousingError>
housing_get_house(owner) -> Option<HouseInstance>
housing_get_furniture(id) -> Option<FurnitureItem>
housing_get_placements(owner) -> Vec<PlacedFurniture>
housing_get_rating(owner) -> Option<HouseRating>
housing_get_visitors(owner) -> Vec<VisitorRecord>
housing_get_featured(tier) -> Vec<Address>
```

Ratings are integers from 100 to 500 (1.0–5.0 stars scaled by 100). Players
cannot rate their own house and cannot rate twice. `FriendsOnly` currently
requires the visitor to have a profile; bonding/guild checks are a future
enhancement.

---

## 4. Errors

`HousingError` implements the shared `StandardContractError` convention
(`module = "player_housing"`) so clients can map codes to `ErrorKind`s:

| Code | Variant | Class |
|---|---|---|
| 1–2 | `HouseNotFound`, `FurnitureNotFound` | NotFound |
| 3 | `HouseAlreadyExists` | Conflict |
| 4 | `InsufficientResources` | ResourceLimit (retryable) |
| 5–6 | `MaxSizeReached`, `FurnitureLimitReached` | ResourceLimit |
| 7 | `InvalidPlacement` | Validation |
| 8 | `AccessDenied` | Authorization |
| 9–11 | `InvalidRating`, `CannotRateSelf`, `AlreadyRated` | Validation/Conflict |
| 12–13 | `VisitorLimitReached`, `FeaturedLimitReached` | ResourceLimit |
| 14–17 | `ProfileNotFound`, `ArithmeticOverflow`, `InvalidAccess`, `PositionOccupied` | — |
| 18–24 | Achievement / banner / storage errors | Validation / Conflict / ResourceLimit |

---

## 5. Events

Every state change emits an event under the `housing` topic with a short
action symbol, e.g.:

```text
(housing, init)   → (owner, size)
(housing, place)  → (owner, furniture_id, x, y)
(housing, achdsp) → (owner, display_id, achievement_id, slot)
(housing, gldban) → (owner, guild_name)
(housing, stexp)  → (owner, level, bonus_capacity, cost)
(housing, visit)  → (visitor, house_owner)
```

Frontends can subscribe to these via Stellar event streams to refresh views.

---

## 6. Frontend UI

`frontend/src/views/Housing.tsx` exports a `Housing` React component with six
tabs:

1. **Overview** — theme customization, access selector, aggregate stats.
2. **Furniture** — catalog purchase, placement form (x/y/rotation/layer), placed-item removal.
3. **Achievements** — display-case list and unlocked-achievement picker.
4. **Guild Banner** — current banner, motto input, set/clear controls.
5. **Storage** — capacity gauge and expansion button with cost.
6. **Visitors** — visit-another-house form and recent visitor list.

The component is presentational: it accepts on-chain state via props and emits
intent events through `onAction: (action: HousingAction) => void`. Wire the
action types to the corresponding `housing_*` contract methods:

```tsx
<Housing
  house={house}
  placements={placements}
  furnitureCatalog={catalog}
  achievements={displays}
  unlockedAchievements={unlocked}
  guildBanner={banner}
  storage={storage}
  visitors={visitors}
  onAction={(action) => submitHousingAction(action)}
/>
```

Run the UI tests with:

```bash
cd frontend && npx jest src/tests/housing.test.tsx --runInBand
```

---

## 7. Testing

Rust unit tests live in the `#[cfg(test)]` module at the bottom of
`src/player_housing.rs` and cover:

- house creation, duplicate prevention, upgrades and access modes;
- theme customization;
- furniture definition, purchase, placement, removal and slot limits;
- achievement display install/list/remove, unlock enforcement and slot bounds;
- guild banner membership enforcement, set/clear;
- storage capacity growth, max level, insufficient resources and the extra
  furniture-slot bonus;
- visits, ratings, duplicate-rating prevention and featuring.

Run them with:

```bash
cargo test --lib player_housing::tests
```

---

## 8. Operational notes

- All collections are explicitly bounded (`Vec` with max constants) because
  Soroban charges for iteration and ledger footprint.
- Arithmetic uses `saturating_add` / `saturating_mul` to avoid overflow traps.
- `touch_house` updates `last_modified` after customization changes so indexers
  can cheaply detect activity.
- Achievement display verification depends on `achievements::query_progress`;
  that module must remain enabled in `src/lib.rs`.
