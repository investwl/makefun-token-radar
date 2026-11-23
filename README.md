# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/investwl/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/investwl/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one sealed snapshot of every DeFi protocol DefiLlama tracks, keeps the
protocols that record **no token yet**, ranks them by an **implied value** derived from their own
figures, and hands every one of them a concrete, costed farm plan — on a static dashboard that renders
with no network.

The implied value is a model, not a price, and it never predicts whether or when a token comes. It is
built from five factors the snapshot already carries:

```
scale        = tvl_usd
sector       = SECTOR[category]                       0.78 … 1.42
momentum     = 1 + clamp(change_7d, -55, 160)/100 × 0.55
dry-spell    = 0.62 + 0.58 × min(age_days, 1460)/1460   (age unknown: 1000d)
reach        = 0.86 + 0.045 × min(chains, 6)
implied      = max(1, round(scale × 0.20 × sector × momentum × dry-spell × reach))
```

The sector table is keyed on the snapshot's **category** string, never on a protocol name: one function
scores every row, and nothing is special-cased. Protocols whose token **already trades** are kept out of
the ranking and shown at their market's own value on a separate view, so the two are never mixed.

The board covers every protocol on the snapshot's watchlist (the floor, never the ceiling) and adds the
highest-TVL pre-token protocols below that floor as **early finds** — the rows the radar exists to surface.

## What's in the dashboard

- A ranked board, sortable by rank, name, TVL, 7-day growth, no-token age, implied value and sector.
- Filters for search, category, chain and a TVL floor, plus a pre-token / live-token switch (the live
  view is sortable too, and shows the largest protocols by market cap).
- A detail view per protocol: the full value bridge from TVL to implied value, recomputed in the page
  so it matches `board.json`, the on-record facts, and an eight-step farm plan with a capital cost, a
  gas estimate for its chain, and a time for every step — summarized up top as what it costs to open,
  what it costs to keep and how long to hold.
- A stated model panel with the formula and the sector table, so every number on the board is checkable.

## Run it

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.5/bin:$PATH"
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node --experimental-strip-types main.ts --input ../input/snapshot.json
# then open out/dashboard/index.html in a browser
```

`main.ts` reads the snapshot (`/input/snapshot.json`, or `--input <file|dir>`) and writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` into `$MAKEFUN_OUTPUT_DIR` (or `/output`).
Node 22.18+, standard library only, no installs, no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2yjpmyhm&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>