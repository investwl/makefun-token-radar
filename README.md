# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/investwl/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/investwl/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one sealed snapshot of every DeFi protocol DefiLlama tracks, keeps the
protocols that record **no token yet**, ranks them by a **peer-calibrated implied value** derived from
the snapshot's own figures, and hands every one of them a concrete, costed farm plan — on a static
dashboard that renders with no network.

## The value model

The snapshot already prices 118 protocol tokens. Each one gives a multiple, market cap / TVL. Those
multiples are the calibration set. A pre-token protocol is worth its TVL times the multiple its own
sector's tokened peers command **at that size**:

```
peer set     protocols with a market cap and TVL > 0 (CEX and versioned pools excluded)
size law     log mcap = a + 0.46 × log TVL          fitted on the peer set
anchor       median[ log mcap − β·log TVL ] over the category's peers,
             shrunk toward the sector group by n/(n+4), then the whole pool
implied      TVL × peer multiple at this size × growth × age
growth       1 + 0.15 × clamp(change_7d, −50, +100)/100
age          0.96 + 0.08 × min(age_days, 1095)/1095   (unknown age: 548 days)
```

Growth and no-token age are secondary tilts of at most ±15% and ±4%, never the anchor. The sector
table is keyed on the snapshot's **category** string; no protocol name is special-cased.

## Validated on held-out data

The estimator is tested on the tokened protocols themselves, and the dashboard prints the measured
result rather than asserting it:

| Held-out test | n | Median miss | Within 2× | Within 3× |
|---|---:|---:|---:|---:|
| Leave-one-out (predict each peer from the others) | 118 | 85% | 31% | 47% |
| Walk-forward (train earlier half by listing date) | 44 | 69% | 43% | 55% |
| Naive baseline: one global multiple | 118 | 87% | 31% | 36% |

Per-sector 80% conformal bands come from the held-out residuals; the global band is ×0.10–×10.9 and
the measured coverage is 76%. Market caps in this snapshot span four orders of magnitude, so a 3×
interval is the honest resolution, not a price target.

## What's in the dashboard

- A ranked board of **246** pre-token protocols, sortable by rank, name, TVL, 7-day growth, no-token
  age, peer multiple and implied value, with each row's 80% band and its sector's token rate.
- The **live-token** view: all 144 protocols whose token already trades, at the market's own value —
  the calibration set, kept out of the ranking so the two are never mixed.
- The **kept-out** view: the 368 pre-token protocols the house rule excludes as wrapped, staked or
  bridged products, exchange-branded names, versioned pools, or above-floor products of a protocol
  whose token already trades. All 758 snapshot protocols are accounted for across the three views.
- A detail drawer per protocol: the peer anchor, the value bridge, the conformal band, the sector's
  token record, and a six-step farm plan with a capital cost, a per-chain gas estimate and a time for
  every step.
- A model panel with the formula, the held-out table and the per-sector calibration table.

## Run it

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.5/bin:$PATH"
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
# then open out/dashboard/index.html in a browser
```

`main.ts` reads the snapshot (`/input/snapshot.json`, or `--input <file|dir>`) and writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` into `$MAKEFUN_OUTPUT_DIR` (or `/output`).
Node 22, standard library only, no installs, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2yjpmyhm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>