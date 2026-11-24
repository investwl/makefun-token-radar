// Token Radar's value model: peer-calibrated valuation for every protocol that records no token.
//
// The snapshot already prices 118 protocol tokens. Each gives a multiple, mcap / TVL. Those multiples
// are the calibration set: a pre-token protocol is worth its TVL times the multiple its own sector's
// tokened peers command at that size. Size matters — the multiple falls as TVL rises (log mcap =
// a + b·log TVL, b ≈ 0.46) — so each peer multiple is normalised to the target's size first. A thin
// sector is shrunk toward its sector group, then toward the whole peer set, so one outlier cannot
// price a category. Growth (change_7d) and no-token age (listed_at) are secondary ±15% / ±4% tilts.
//
// The estimator is validated on the tokened protocols themselves: leave-one-out and a walk-forward
// split. The dashboard prints the measured error, the naive baseline it beats, and 80% conformal
// bands from the held-out residuals. Every number comes from the snapshot; no name is special-cased.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}

export interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: SnapshotProtocol[]; watchlist: string[] }

export interface ModelConstants {
  shrink_k: number; min_cat: number; min_group: number;
  growth_weight: number; growth_floor: number; growth_cap: number;
  age_floor: number; age_range: number; age_days: number; unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrink_k: 4, min_cat: 3, min_group: 5,
  growth_weight: 0.15, growth_floor: -50, growth_cap: 100,
  age_floor: 0.96, age_range: 0.08, age_days: 1095, unknown_age_days: 548,
};

export const MODEL_VERSION = 'radar-3-peer';

export interface FarmStep { text: string; cost: string; time: string }

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; sector: string; chains: string[];
  tvl_usd: number; change_7d: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; band_low_usd: number; band_high_usd: number;
  peer_multiple: number; peer_n: number; anchor_level: string;
  token_rate: number; token_count: number; token_total: number;
  growth_mult: number; age_mult: number; farm_steps: string[];
}

export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; sector: string; chains: string[];
  tvl_usd: number; change_7d: number | null; listed_at: string | null; age_days: number | null;
  implied_value_usd: number; band_low_usd: number; band_high_usd: number;
  peer_multiple: number; peer_n: number; anchor_level: string;
  token_rate: number; token_count: number; token_total: number;
  growth_mult: number; age_mult: number; farm_steps: string[];
}

export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; multiple: number | null; change_7d: number | null;
}

export interface ExcludedRow { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; reason: string }

export interface Backtest {
  peers: number; beta: number; n: number; mdape: number; within2: number; within3: number;
  spearman: number; top10: number;
  baseline_mdape: number; baseline_within2: number; baseline_within3: number;
  wf_n: number; wf_mdape: number; wf_within2: number; wf_within3: number; wf_split: string;
  coverage: number; band_low: number; band_high: number;
}

export interface SectorStat {
  category: string; sector: string; rows: number; peers: number; multiple_100m: number;
  token_count: number; token_total: number; token_rate: number; band_low: number; band_high: number;
}

export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants; model_version: string;
  universe_size: number; watchlist_size: number; watchlist: string[]; board_size: number; early_size: number;
  live_size: number; excluded_size: number; board_tvl_usd: number;
  backtest: Backtest; sectors: SectorStat[]; rows: RadarRow[]; live: LiveRow[]; excluded: ExcludedRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const log = Math.log;
const finite = (v: unknown, f: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : f);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`), b = Date.parse(`${listedAt}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((a - b) / DAY_MS)) : null;
}

// A name ending in a release is a pool of another protocol; wrapped/staked names and exchange-branded
// products are products of a token that already trades. The house watchlist rule keeps all three out.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

export const isLive = (p: SnapshotProtocol): boolean => p.mcap_usd !== null;

/** A protocol the board may rank: no token recorded, not a wrapped/staked/bridged product of one that trades.
 *  Above the watchlist floor the house watchlist is the evidence: a protocol it leaves out there has a parent
 *  whose token already trades (the snapshot carries no parent field), so it is kept out too. */
export function isRankable(p: SnapshotProtocol, floorUsd: number, watchlist: Set<string>): boolean {
  return (
    p.mcap_usd === null &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !(p.tvl_usd >= floorUsd && !watchlist.has(p.slug))
  );
}

export function exclusionReason(p: SnapshotProtocol, floorUsd: number, watchlist: Set<string>): string | null {
  if (p.mcap_usd !== null) return null;
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return `${p.category} product: its underlying token already trades`;
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED.test(p.name)) return 'a wrapped or staked product of a token that trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'an exchange-branded product';
  if (p.tvl_usd >= floorUsd && !watchlist.has(p.slug)) return 'above the floor but off the watchlist: a product of a protocol whose token trades';
  return null;
}

/** The peer pool: protocols whose token already prices and whose TVL is real. */
export const isPeer = (p: SnapshotProtocol): boolean =>
  p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name);

const GROUPS: Array<[string, RegExp]> = [
  ['Derivatives', /\bperp|derivativ|options|synthetic\b/i],
  ['Liquid staking', /\bliquid.*(staking|restaking)|restak/i],
  ['DEX', /\bdex|amm|swap|liquidity\b/i],
  ['Lending', /\blending|cdp|collateral|money market\b/i],
  ['Yield', /\byield|aggregator|vault|auto.?comp/i],
  ['Curation', /\bcurator|allocator|basis trading|leveraged farm|\bfarm\b/i],
  ['RWA', /\brwa|real.world asset|tokeniz/i],
  ['Prediction', /\bprediction|betting|oracle\b/i],
  ['Stablecoin', /\bstablecoin|stable\b/i],
  ['Gaming', /\bgaming|nft|collectible\b/i],
  ['Bridge', /\bbridge|canonical|wrap|message|interop/i],
  ['CEX', /\bcex|exchange\b/i],
  ['Infra', /\bchain|rollup|l1|l2|infrastructure|node|validator|staking pool\b/i],
];

export function peerGroup(category: string | null): string {
  const c = category ?? '';
  for (const [label, re] of GROUPS) if (re.test(c)) return label;
  return 'Other';
}

export const sectorLabel = (category: string | null): string => {
  const g = peerGroup(category);
  return g === 'Other' ? (category ? 'Other' : 'Uncategorised') : g;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b), n = v.length;
  return n % 2 === 1 ? v[(n - 1) / 2]! : (v[n / 2 - 1]! + v[n / 2]!) / 2;
}

function quantile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const v = values.slice().sort((a, b) => a - b);
  if (v.length === 1) return v[0]!;
  const k = (v.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
  return v[lo]! + (v[hi]! - v[lo]!) * (k - lo);
}

/** The size law's slope: log mcap against log TVL, fitted on the peer pool. */
function fitBeta(rows: SnapshotProtocol[]): number {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const r of rows) {
    if (r.mcap_usd === null || r.mcap_usd <= 0 || r.tvl_usd <= 0) continue;
    const x = log(r.tvl_usd), y = log(r.mcap_usd);
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  return n < 3 || den === 0 ? 1 : (n * sxy - sx * sy) / den;
}

/** log(mcap) − β·log(TVL): the size-adjusted multiple a protocol's token commands. */
const residual = (p: SnapshotProtocol, beta: number): number => log(p.mcap_usd ?? 1) - beta * log(p.tvl_usd);

/** Shrink a thin sample's median toward the wider pool: weight n/(n+k). */
function shrink(values: number[], base: number, k: number): number {
  if (values.length === 0) return base;
  const w = values.length / (values.length + k);
  return w * median(values) + (1 - w) * base;
}

interface Anchor { c: number; level: 'category' | 'group' | 'global'; n: number }

/** The peer anchor: the category's own peers, else its sector group, else the whole pool. */
function anchorFor(category: string | null, train: SnapshotProtocol[], beta: number, model: ModelConstants): Anchor {
  const global = median(train.map((p) => residual(p, beta)));
  const group = train.filter((p) => peerGroup(p.category) === peerGroup(category)).map((p) => residual(p, beta));
  let base = global, level: Anchor['level'] = 'global', n = train.length;
  if (group.length >= model.min_group) { base = shrink(group, global, model.shrink_k); level = 'group'; n = group.length; }
  const same = train.filter((p) => p.category === category).map((p) => residual(p, beta));
  if (same.length >= model.min_cat) { base = shrink(same, base, model.shrink_k); level = 'category'; n = same.length; }
  return { c: base, level, n };
}

/** Secondary tilts: growth and no-token age, each small and bounded. */
export function tilts(p: SnapshotProtocol, asOf: string, model: ModelConstants): { growth: number; age: number; age_days: number | null } {
  const g = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const age = ageDays(asOf, p.listed_at);
  const a = Math.min(model.age_days, Math.max(0, age ?? model.unknown_age_days));
  return { growth: 1 + (g / 100) * model.growth_weight, age: model.age_floor + (a / model.age_days) * model.age_range, age_days: age };
}

interface Prediction { implied: number; multiple: number; growth: number; age: number; age_days: number | null; anchor: Anchor }

/** TVL × the peer multiple at that size × the two tilts. */
function predict(p: SnapshotProtocol, train: SnapshotProtocol[], beta: number, asOf: string, model: ModelConstants): Prediction {
  const anchor = anchorFor(p.category, train, beta, model);
  const t = tilts(p, asOf, model);
  const multiple = Math.exp(beta * log(p.tvl_usd) + anchor.c) / p.tvl_usd;
  return { implied: Math.max(1, Math.round(p.tvl_usd * multiple * t.growth * t.age)), multiple, growth: t.growth, age: t.age, age_days: t.age_days, anchor };
}

/** Average ranks for ties. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

function spearman(a: number[], b: number[]): number {
  const ra = ranks(a), rb = ranks(b), n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i]! - ma) * (rb[i]! - mb); da += (ra[i]! - ma) ** 2; db += (rb[i]! - mb) ** 2; }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

function errorStats(pred: number[], actual: number[]): { mdape: number; within2: number; within3: number } {
  const ape = pred.map((p, i) => Math.abs(p / actual[i]! - 1));
  const l = pred.map((p, i) => Math.abs(log(p / actual[i]!)));
  return {
    mdape: median(ape),
    within2: l.filter((x) => x <= Math.LN2).length / l.length,
    within3: l.filter((x) => x <= log(3)).length / l.length,
  };
}

export interface Calibration { beta: number; peers: number; backtest: Backtest; bands: { global: [number, number]; byGroup: Map<string, [number, number]> } }

/** Fit the peer model and validate it on the peers: leave-one-out, walk-forward, conformal bands. */
export function calibrate(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): Calibration {
  const peers = protocols.filter(isPeer);
  const beta = fitBeta(peers);
  const looPred: number[] = [], actual: number[] = [], residuals: number[] = [];
  const residualByGroup = new Map<string, number[]>();
  for (const p of peers) {
    const train = peers.filter((x) => x !== p);
    const pred = predict(p, train, fitBeta(train), asOf, model).implied;
    looPred.push(pred); actual.push(p.mcap_usd!);
    const r = log(pred) - log(p.mcap_usd!);
    residuals.push(r);
    const g = peerGroup(p.category), list = residualByGroup.get(g) ?? [];
    list.push(r); residualByGroup.set(g, list);
  }
  const stats = errorStats(looPred, actual);
  const globalBand: [number, number] = [quantile(residuals, 0.1), quantile(residuals, 0.9)];
  const byGroup = new Map<string, [number, number]>();
  for (const [g, list] of residualByGroup) if (list.length >= 10) byGroup.set(g, [quantile(list, 0.1), quantile(list, 0.9)]);
  const bandFor = (category: string | null): [number, number] => byGroup.get(peerGroup(category)) ?? globalBand;
  const coverage = peers.filter((p, i) => { const [lo, hi] = bandFor(p.category); return residuals[i]! >= lo && residuals[i]! <= hi; }).length / peers.length;

  // The naive baseline the peer model has to beat: one global multiple for every protocol.
  const raw = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const base = errorStats(peers.map((p) => p.tvl_usd * raw), actual);

  // Walk forward: train on the earlier half by first-listed date, test on the later half.
  const dated = peers.filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length / 2), train = dated.slice(0, cut), test = dated.slice(cut);
  const wb = fitBeta(train);
  const wf = errorStats(test.map((p) => predict(p, train, wb, asOf, model).implied), test.map((p) => p.mcap_usd!));

  const predictedTop = peers.map((p, i) => [p.slug, looPred[i]!] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const actualTop = new Set(peers.slice().sort((a, b) => b.mcap_usd! - a.mcap_usd!).slice(0, 10).map((p) => p.slug));
  return {
    beta, peers: peers.length,
    backtest: {
      peers: peers.length, beta, n: peers.length,
      mdape: stats.mdape, within2: stats.within2, within3: stats.within3,
      spearman: spearman(looPred, actual.map((a) => log(a))),
      top10: predictedTop.filter(([slug]) => actualTop.has(slug)).length,
      baseline_mdape: base.mdape, baseline_within2: base.within2, baseline_within3: base.within3,
      wf_n: test.length, wf_mdape: wf.mdape, wf_within2: wf.within2, wf_within3: wf.within3,
      wf_split: train.length > 0 && test.length > 0 ? `${train[train.length - 1]!.listed_at} → ${test[0]!.listed_at}` : '',
      coverage, band_low: Math.exp(globalBand[0]), band_high: Math.exp(globalBand[1]),
    },
    bands: { global: globalBand, byGroup },
  };
}

/** The universe split three ways: ranked pre-token, live token, excluded product. */
export function universe(snapshot: Snapshot): { board: SnapshotProtocol[]; live: SnapshotProtocol[]; excluded: SnapshotProtocol[] } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) { const p = bySlug.get(slug); if (p !== undefined) chosen.set(slug, p); }
  for (const p of snapshot.protocols) if (isRankable(p, snapshot.floor_usd, watch)) chosen.set(p.slug, p);
  const board = [...chosen.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const boardSlugs = new Set(board.map((p) => p.slug));
  return {
    board,
    live: snapshot.protocols.filter((p) => isLive(p) && !boardSlugs.has(p.slug)),
    excluded: snapshot.protocols.filter((p) => p.mcap_usd === null && !boardSlugs.has(p.slug)),
  };
}

/** The ranked board, strongest implied value first, ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, cal?: Calibration): BoardRow[] {
  const peers = snapshot.protocols.filter(isPeer);
  const calibration = cal ?? calibrate(snapshot.protocols, snapshot.as_of, model);
  const counts = new Map<string, { tokened: number; total: number }>();
  for (const p of snapshot.protocols) {
    const c = counts.get(p.category ?? '') ?? { tokened: 0, total: 0 };
    c.total++; if (isLive(p)) c.tokened++;
    counts.set(p.category ?? '', c);
  }
  const scored = universe(snapshot).board.map((p) => {
    const pred = predict(p, peers, calibration.beta, snapshot.as_of, model);
    const [lo, hi] = calibration.bands.byGroup.get(peerGroup(p.category)) ?? calibration.bands.global;
    return { p, pred, lo: Math.exp(lo), hi: Math.exp(hi), count: counts.get(p.category ?? '') ?? { tokened: 0, total: 0 } };
  });
  scored.sort((a, b) => b.pred.implied - a.pred.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, sector: sectorLabel(s.p.category),
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, listed_at: s.p.listed_at,
    age_days: s.pred.age_days, implied_value_usd: s.pred.implied,
    band_low_usd: Math.max(1, Math.round(s.pred.implied * s.lo)), band_high_usd: Math.max(1, Math.round(s.pred.implied * s.hi)),
    peer_multiple: s.pred.multiple, peer_n: s.pred.anchor.n, anchor_level: s.pred.anchor.level,
    token_rate: s.count.total === 0 ? 0 : s.count.tokened / s.count.total,
    token_count: s.count.tokened, token_total: s.count.total,
    growth_mult: s.pred.growth, age_mult: s.pred.age,
    farm_steps: farmSteps(s.p, s.pred.age_days).map(stepText),
  }));
}

/** The live-token rows: the market's own value, with the multiple that peers it. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols.filter(isLive)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd, multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null, change_7d: p.change_7d,
    }));
}

/** The kept-out products, with the reason the house rule keeps them out of the ranking. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  const watch = new Set(snapshot.watchlist);
  return universe(snapshot).excluded.map((p) => ({
    slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
    reason: exclusionReason(p, snapshot.floor_usd, watch) ?? 'kept out of the ranking',
  })).sort((a, b) => b.tvl_usd - a.tvl_usd);
}

/** The sector table: peers, the peer multiple at $100M, and the sector's own token record. */
export function sectorStats(snapshot: Snapshot, board: BoardRow[], cal: Calibration): SectorStat[] {
  const peers = snapshot.protocols.filter(isPeer);
  const rows = new Map<string, number>();
  for (const r of board) rows.set(r.category ?? '', (rows.get(r.category ?? '') ?? 0) + 1);
  const totals = new Map<string, { tokened: number; total: number }>();
  for (const p of snapshot.protocols) {
    const c = totals.get(p.category ?? '') ?? { tokened: 0, total: 0 };
    c.total++; if (isLive(p)) c.tokened++;
    totals.set(p.category ?? '', c);
  }
  return [...rows.entries()].map(([category, count]) => {
    const anchor = anchorFor(category, peers, cal.beta, MODEL);
    const t = totals.get(category) ?? { tokened: 0, total: 0 };
    const [lo, hi] = cal.bands.byGroup.get(peerGroup(category)) ?? cal.bands.global;
    return {
      category, sector: sectorLabel(category), rows: count, peers: anchor.n,
      multiple_100m: Math.exp(cal.beta * log(1e8) + anchor.c) / 1e8,
      token_count: t.tokened, token_total: t.total, token_rate: t.total === 0 ? 0 : t.tokened / t.total,
      band_low: Math.exp(lo), band_high: Math.exp(hi),
    };
  }).sort((a, b) => b.rows - a.rows || b.multiple_100m - a.multiple_100m);
}

/** Everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot.protocols, snapshot.as_of, model);
  const board = buildBoard(snapshot, model, cal);
  const live = liveRows(snapshot), excluded = excludedRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, universe_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist, board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length, excluded_size: excluded.length,
    board_tvl_usd: board.reduce((sum, r) => sum + r.tvl_usd, 0),
    backtest: cal.backtest, sectors: sectorStats(snapshot, board, cal),
    rows: board.map(radarRow), live, excluded,
  };
  return { board, radar };
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, sector: row.sector,
    chains: row.chains, tvl_usd: row.tvl_usd, change_7d: row.change_7d, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    band_low_usd: row.band_low_usd, band_high_usd: row.band_high_usd,
    peer_multiple: row.peer_multiple, peer_n: row.peer_n, anchor_level: row.anchor_level,
    token_rate: row.token_rate, token_count: row.token_count, token_total: row.token_total,
    growth_mult: row.growth_mult, age_mult: row.age_mult, farm_steps: row.farm_steps,
  };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board has ${board.length} rows, under the 100 the gate wants`;
  if (board.length > 4000) return `the board has ${board.length} rows, over the 4,000 the gate takes`;
  const slugs = new Set(board.map((r) => r.slug));
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share one implied value`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Gas for one transaction on a chain, in dollars: the table every farm plan is costed from. */
const GAS_TABLE: Array<[RegExp, string, number]> = [
  [/ethereum/i, 'Ethereum mainnet', 6],
  [/arbitrum|optimism|base|blast|mode|linea|scroll|zksync|polygon|unichain|ink|mantle/i, 'an L2', 0.15],
  [/binance|bsc|avalanche|fantom|cronos|gnosis/i, 'an EVM L1', 0.25],
  [/solana/i, 'Solana', 0.02],
  [/tron/i, 'Tron', 0.6],
  [/bitcoin/i, 'Bitcoin', 1.5],
];

export function gasFor(chain: string): { label: string; usd: number } {
  for (const [re, label, usd] of GAS_TABLE) if (re.test(chain)) return { label, usd };
  return { label: chain || 'its main chain', usd: 1.2 };
}

/** Minimum viable capital: enough that one transaction's gas is under about 5% of the position. */
export function capitalFor(tvl: number, gasUsd: number): number {
  const gasFloor = Math.max(50, Math.ceil((gasUsd * 20) / 10) * 10);
  const depth = tvl >= 5e9 ? 500 : tvl >= 1e9 ? 300 : tvl >= 2.5e8 ? 200 : tvl >= 1e8 ? 120 : tvl >= 5e7 ? 80 : 50;
  return Math.max(gasFloor, depth);
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 75;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

const chainOf = (p: SnapshotProtocol): string => (p.chains.length > 0 ? p.chains[0]! : 'its main chain');

/** The category's main action: what to deposit, and where. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = p.category ?? '', n = p.name;
  if (/\blending|cdp|collateral|money market\b/i.test(c)) return `Supply $${capital} of USDC as collateral to ${n} on ${chain}, then borrow about 40% of it back in a stablecoin so the position shows both a deposit and a borrow.`;
  if (/\bdex|amm|swap|liquidity\b/i.test(c)) return `Add $${capital} of liquidity to ${n}'s deepest pool on ${chain} (a stable-to-stable pair if one exists, else the top-volume pair) and keep the LP tokens.`;
  if (/\byield|aggregator|vault|auto.?comp/i.test(c)) return `Deposit $${capital} into ${n}'s largest vault on ${chain} and keep the receipt tokens; do not auto-restake into a strategy you have not read.`;
  if (/\bcurator|allocator|basis trading|leveraged farm|\bfarm\b/i.test(c)) return `Deposit $${capital} through ${n}'s own app on ${chain} into its largest strategy or vault, keep the receipt tokens, and read which positions it puts the capital in first.`;
  if (/\bliquid.*(staking|restaking)|restak/i.test(c)) return `Stake $${capital} of the chain's native asset through ${n} on ${chain}, keep the liquid receipt, and leave it unstaked for now.`;
  if (/\bbridge|canonical|wrap|message|interop/i.test(c)) return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n} and leave at least half the amount on the destination.`;
  if (/\bperp|derivativ|options|synthetic\b/i.test(c)) return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small position at 2x or less.`;
  if (/\bprediction|betting|oracle\b/i.test(c)) return `Fund $${capital} and place one market position on ${n}; leave the rest of the balance unspent.`;
  if (/\brwa|real.world asset|tokeniz/i.test(c)) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it without selling.`;
  if (/\binsurance\b/i.test(c)) return `Buy $${capital} of cover from ${n} on ${chain} against one protocol you actually use, and keep the policy.`;
  if (/\bstablecoin|stable\b/i.test(c)) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold the stablecoin in the protocol.`;
  if (/\bchain|rollup|l1|l2|infrastructure|node|validator|staking pool\b/i.test(c)) return `Bridge $${capital} onto ${chain} and use ${n}'s own app (a transfer, a stake or a deploy) so the address is active on it.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/** A second, deeper action so the address has more than one kind of activity. */
function depthAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = p.category ?? '', n = p.name;
  if (/\blending|cdp|collateral|money market\b/i.test(c)) return `Repay a third of the borrow on ${n} after a week, then borrow again: a closed loop of repay and re-borrow reads as real use.`;
  if (/\bdex|amm|swap|liquidity\b/i.test(c)) return `Make two small swaps through ${n}'s own interface (about $${Math.max(5, Math.round(capital / 20))} each) so the wallet has trade volume, not only liquidity.`;
  if (/\bperp|derivativ|options|synthetic\b/i.test(c)) return `Close the ${n} position and reopen it once, so the account books two trades rather than one.`;
  if (/\bliquid.*(staking|restaking)|restak/i.test(c)) return `Move half the ${n} receipt into a lending market that accepts it, so the address both stakes and lends.`;
  if (/\byield|aggregator|vault|auto.?comp/i.test(c)) return `Split the deposit across two ${n} vaults on ${chain} rather than one, so more than one strategy counts the wallet.`;
  if (/\bbridge|canonical|wrap|message|interop/i.test(c)) return `Make a second, smaller bridge back through ${n} so the transfer is not a one-off.`;
  if (/\bgovernance|dao\b/i.test(c) || /\bvault|yield|aggregator/i.test(c)) return `Cast one vote in ${n}'s governance with the balance you hold, if a proposal is live.`;
  return `Use a second feature of ${n} on ${chain} (a swap, a deposit or a vote) so the address has more than one transaction kind.`;
}

/** Six costed steps: a fresh wallet, funding, the main position, a second action, the hold, the claim. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p), gas = gasFor(chain), capital = capitalFor(p.tvl_usd, gas.usd), hold = holdDaysFor(age);
  const g = `$${gas.usd.toFixed(2)}`;
  return [
    { text: 'Set up a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a file or a cloud note.', cost: 'nothing: a new address is free', time: '5 minutes' },
    { text: `Fund that wallet on ${chain} from an exchange withdrawal or a bridge, and send a little extra to cover gas on ${gas.label}.`, cost: `$${capital} of capital plus ${g} of gas`, time: '20 to 40 minutes including the transfer confirming' },
    { text: mainAction(p, capital, chain), cost: `$${capital} of capital and ${g} of gas`, time: '15 minutes to set up' },
    { text: depthAction(p, capital, chain), cost: `${g} of gas; the capital stays deployed`, time: '10 minutes' },
    { text: `Make one qualifying action each week (a small deposit, a borrow, a swap or a vote) and hold for at least ${hold} days, so the activity spans more than one snapshot.`, cost: `${g} a week on ${gas.label}; $${capital} stays in the position`, time: `${hold} days` },
    { text: "Open the protocol's own points, rewards or airdrop page before you withdraw and claim only from a link it publishes; log every address, date, hash and amount.", cost: 'no fee to check, and never pay to claim', time: '15 minutes' },
  ];
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
