# Data Model

## Enterprise Tournament Hierarchy

```text
Tenant
  -> Tournament
    -> Sport
      -> Event
        -> Teams / Athletes
        -> Groups
        -> Matches
          -> MatchSets
```

## Core Meaning

| Layer | Purpose |
|---|---|
| Tenant | Organization or customer boundary for SaaS isolation. |
| Tournament | Workspace for one tournament edition or campaign. |
| Sport | Configurable sport definition. Pickleball is the first sport, not the whole system identity. |
| Event | Competition content inside a tournament, such as men's doubles, women's doubles, mixed doubles, or custom content. |
| Teams / Athletes | Participants scoped to an event. |
| Groups | Round-robin grouping within an event. |
| Matches | Match-level schedule and aggregate outcome. |
| MatchSets | Set-level scores for single-set and best-of-3 scoring. |

## Sports

`public.sports` stores sport-level defaults. The first seeded sport is:

```json
{
  "id": "sport_pickleball",
  "name": "Pickleball",
  "slug": "pickleball",
  "scoring_type": "sets",
  "default_settings": {
    "maxScore": 15,
    "capScore": 17,
    "winByTwo": true,
    "matchSetMode": "single",
    "setsToWin": 1,
    "numberOfSets": 1
  }
}
```

Future sports should be added as rows/configuration, not by hard-coding the application around Pickleball.

## Event Config

`public.events` now carries:

| Column | Allowed Values |
|---|---|
| `sport_id` | FK to `public.sports(id)` |
| `competition_type` | `singles`, `doubles`, `team`, `individual_time`, `custom` |
| `format_type` | `round_robin_only`, `knockout_only`, `group_then_knockout` |
| `scoring_config` | JSON scoring rule object |
| `ranking_config` | JSON ranking/tiebreak rule object |

## Scoring Config

Standard scoring fields:

| Field | Meaning |
|---|---|
| `matchSetMode` | `single` or `best_of_3` |
| `numberOfSets` | `1` or `3` |
| `setsToWin` | `1` for single set, `2` for best of 3 |
| `maxScore` | Normal target score for a set |
| `capScore` | Maximum capped score |
| `winByTwo` | Whether a set normally requires a 2-point margin |
| `allowDraw` | Whether the event allows drawn matches |

## MatchSets

`public.match_sets` stores each set in a match. `public.matches` remains the aggregate match row.

### One Set

Example: Team A beats Team B 15-10.

| Table | Stored Result |
|---|---|
| `match_sets` | One row: `set_number=1`, `score_a=15`, `score_b=10`, `winner_id=Team A` |
| `matches` | Aggregate: `score_a=1`, `score_b=0`, `winner_id=Team A` |

### Best Of 3

Example: Team A wins 2-1.

| Table | Stored Result |
|---|---|
| `match_sets` | Up to three rows, one per set |
| `matches` | Aggregate set score: `score_a=2`, `score_b=1`, `winner_id=Team A` |

The winner must be calculated by database-side RPC in a later prompt, not by the frontend.

## Security Notes

- `sports` can be selected by authenticated users when active.
- `sports` write access is limited by RLS to `SUPER_ADMIN`.
- `match_sets` has RLS enabled and is scoped by tenant/event access.
- `anon` is not granted write access to `match_sets`.
- Future score-writing RPCs must validate event access and scoring rules before modifying `match_sets` or aggregate `matches`.
