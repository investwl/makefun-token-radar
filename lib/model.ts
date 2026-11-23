// The token radar's value model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below that floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol). The
// snapshot's live-token protocols are kept apart and shown at their market's own value, never mixed
// into the ranked board.
//
// Implied value follows only from the snapshot's own figures, in five factors:
//
//   scale        = tvl_usd
//   sectorMult   = SECTOR[category]                      0.78 .. 1.42
//   momentumMult = 1 + clamp(change_7d, -55, 160)/100 x 0.55
//   dryspellMult = 0.62 + 0.58 x min(age_days, 1460)/1460   (age unknown: 1000 days)
//   reachMult    = 0.86 + 0.045 x min(chains, 6)         0.86 .. 1.13
//   implied      = max(1, round(scale x 0.20 x sectorMult x momentumMult x dryspellMult x reachMult))
//
// The sector table is keyed on the snapshot's own `category` string, never on a protocol name: the
// same function scores every row, and no protocol is special-cased anywhere in this file.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  dryspell_floor: number;
  dryspell_range: number;
  dryspell_days: number;
  unknown_age_days: number;
  reach_floor: number;
  reach_step: number;
  reach_max_chains: number;
}

export const MODEL: ModelConstants = {
  base: 0.2,
  momentum_weight: 0.55,
  momentum_floor: -55,
  momentum_cap: 160,
  dryspell_floor: 0.62,
  dryspell_range: 0.58,
  dryspell_days: 1460,
  unknown_age_days: 1000,
  reach_floor: 0.86,
  reach_step: 0.045,
  reach_max_chains: 6,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * The sector table: a multiple on implied value, keyed on the snapshot's own category string. These
 * are the protocol types whose tokens have historically carried the strongest, and weakest, values
 * relative to the capital they hold. A category the table does not name scores 1.0.
 */
const SECTOR: Array<[RegExp, number]> = [
  [/\bperp|derivativ|options|synthetic\b/i, 1.42],
  [/\bliquid.*(staking|restaking)|restak/i, 1.36],
  [/\bdex|amm|swap|liquidity\b/i, 1.28],
  [/\blending|cdp|collateral|money market\b/i, 1.24],
  [/\byield|aggregator|vault|auto.?comp/i, 1.18],
  // Capital curators and onchain allocators run the same business as a yield aggregator — they
  // deploy other people's capital into strategies for a fee — so they score with the yield bucket
  // rather than as an undifferentiated category.
  [/\bcurator|allocator|basis trading|leveraged farm|\bfarm\b/i, 1.18],
  [/\brwa|real.world asset|tokeniz/i, 1.16],
  [/\bprediction|betting|oracle\b/i, 1.12],
  [/\bstablecoin|stable\b/i, 0.94],
  [/\bgaming|nft|collectible\b/i, 0.86],
  [/\bbridge|canonical|wrap|message|interop/i, 0.8],
  [/\bcex|exchange\b/i, 0.78],
  [/\bchain|rollup|l1|l2|infrastructure|node|validator|staking pool\b/i, 1.1],
];

/** The sector multiple for one category string, 0.78 .. 1.42. */
export function sectorMultiple(category: string | null): number {
  const c = category ?? '';
  for (const [re, mult] of SECTOR) if (re.test(c)) return mult;
  return 1;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  sector: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base: number;
    sector_multiple: number;
    momentum_pct: number;
    momentum_multiplier: number;
    dryspell_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page regenerates the farm plan from it. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  sector: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  sector_multiple: number;
  momentum_pct: number;
  base: number;
  momentum_multiplier: number;
  dryspell_multiplier: number;
  reach_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The five factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; sector: number; momentumPct: number; momentumMult: number; dryspellMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const sector = sectorMultiple(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const momentumPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawGrowth));
  const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const dryspellMult =
    model.dryspell_floor + (Math.min(Math.max(ageForModel, 0), model.dryspell_days) / model.dryspell_days) * model.dryspell_range;
  const chainCount = protocol.chains.length > 0 ? protocol.chains.length : 1;
  const reachMult = model.reach_floor + model.reach_step * Math.min(chainCount, model.reach_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base * sector * momentumMult * dryspellMult * reachMult));
  return { implied, sector, momentumPct, momentumMult, dryspellMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug the list names is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const r = impliedValue(p, snapshot.as_of, model);
    return { p, ...r };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    sector: sectorLabel(s.p.category),
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base: model.base,
      sector_multiple: s.sector,
      momentum_pct: s.momentumPct,
      momentum_multiplier: round4(s.momentumMult),
      dryspell_multiplier: round4(s.dryspellMult),
      reach_multiplier: round4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A short human label for a sector bucket, from the category string. */
export function sectorLabel(category: string | null): string {
  const c = category ?? '';
  if (/\bperp|derivativ|options|synthetic\b/i.test(c)) return 'Derivatives';
  if (/\bliquid.*(staking|restaking)|restak/i.test(c)) return 'Liquid staking';
  if (/\bdex|amm|swap|liquidity\b/i.test(c)) return 'DEX';
  if (/\blending|cdp|collateral|money market\b/i.test(c)) return 'Lending';
  if (/\byield|aggregator|vault|auto.?comp/i.test(c)) return 'Yield';
  if (/\bcurator|allocator|basis trading|leveraged farm|\bfarm\b/i.test(c)) return 'Capital curation';
  if (/\brwa|real.world asset|tokeniz/i.test(c)) return 'RWA';
  if (/\bprediction|betting|oracle\b/i.test(c)) return 'Prediction';
  if (/\bstablecoin|stable\b/i.test(c)) return 'Stablecoin';
  if (/\bgaming|nft|collectible\b/i.test(c)) return 'Gaming / NFT';
  if (/\bbridge|canonical|wrap|message|interop/i.test(c)) return 'Bridge';
  if (/\bcex|exchange\b/i.test(c)) return 'CEX';
  if (/\bchain|rollup|l1|l2|infrastructure|node|validator|staking pool\b/i.test(c)) return 'Infrastructure';
  return category ? 'Other' : 'Uncategorised';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Approximate gas for one transaction on a chain, in dollars, from the chain's name. */
export function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return '$3 to $9';
  if (['arbitrum', 'optimism', 'base', 'blast', 'mode', 'linea', 'scroll', 'zkSync era', 'polygon', 'unichain', 'ink'].some((x) => c.includes(x)))
    return 'under $0.40';
  if (['avalanche', 'binance', 'bsc', 'fantom', 'cronos'].some((x) => c.includes(x))) return 'under $0.30';
  if (c.includes('solana')) return 'under $0.05';
  return 'about $1.50';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 75;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's main action: what to deposit, and where. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = p.category ?? '';
  const name = p.name;
  if (/\blending|cdp|collateral|money market\b/i.test(c))
    return `Supply $${capital} of USDC as collateral to ${name} on ${chain}, then borrow about 40% of it back in a stablecoin so the position shows both a deposit and a borrow.`;
  if (/\bdex|amm|swap|liquidity\b/i.test(c))
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} (a stable-to-stable pair if one exists, else the top volume pair) and keep the LP tokens.`;
  if (/\byield|aggregator|vault|auto.?comp/i.test(c))
    return `Deposit $${capital} into ${name}'s largest vault on ${chain} and keep the receipt tokens; do not auto-restake into a strategy you have not read.`;
  if (/\bcurator|allocator|basis trading|leveraged farm|\bfarm\b/i.test(c))
    return `Deposit $${capital} through ${name}'s own app on ${chain} into its largest strategy or vault, keep the receipt tokens, and read which positions it puts the capital in before you add more.`;
  if (/\bliquid.*(staking|restaking)|restak/i.test(c))
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain}, keep the liquid receipt, and leave it unstacked for now.`;
  if (/\bbridge|canonical|wrap|message|interop/i.test(c))
    return `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name} and leave at least half the amount on the destination.`;
  if (/\bperp|derivativ|options|synthetic\b/i.test(c))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position at 2x or less.`;
  if (/\bprediction|betting|oracle\b/i.test(c))
    return `Fund $${capital} and place one market position on ${name}; leave the rest of the balance unspent.`;
  if (/\brwa|real.world asset|tokeniz/i.test(c))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it without selling.`;
  if (/\binsurance\b/i.test(c))
    return `Buy $${capital} of cover from ${name} on ${chain} against one protocol you actually use, and keep the policy.`;
  if (/\bstablecoin|stable\b/i.test(c))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the stablecoin in the protocol.`;
  if (/\bchain|rollup|l1|l2|infrastructure|node|validator|staking pool\b/i.test(c))
    return `Bridge $${capital} onto ${chain} and use ${name}'s own app (a transfer, a stake or a deploy) so the address is active on it.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, deeper action so the address has more than one kind of activity. */
function depthAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = p.category ?? '';
  const name = p.name;
  if (/\blending|cdp|collateral|money market\b/i.test(c))
    return `Repay a third of the borrow on ${name} after a week, then borrow again: a closed loop of repay and re-borrow reads as real use.`;
  if (/\bdex|amm|swap|liquidity\b/i.test(c))
    return `Make two small swaps through ${name}'s own interface (about $${Math.max(5, Math.round(capital / 20))} each) so the wallet has trade volume, not only liquidity.`;
  if (/\bperp|derivativ|options|synthetic\b/i.test(c))
    return `Close the ${name} position and reopen it once, so the account books two trades rather than one.`;
  if (/\bliquid.*(staking|restaking)|restak/i.test(c))
    return `Move half the ${name} receipt into a lending market that accepts it, so the address both stakes and lends.`;
  if (/\byield|aggregator|vault|auto.?comp/i.test(c))
    return `Split the deposit across two ${name} vaults on ${chain} rather than one, so more than one strategy counts the wallet.`;
  if (/\bbridge|canonical|wrap|message|interop/i.test(c))
    return `Make a second, smaller bridge back through ${name} so the transfer is not a one-off.`;
  if (/\bgovernance|dao\b/i.test(c) || /\bvault|yield|aggregator/i.test(c))
    return `Cast one vote in ${name}'s governance with the balance you hold, if a proposal is live.`;
  return `Use a second feature of ${name} on ${chain} (a swap, a deposit or a vote) so the address has more than one transaction kind.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Capital scales with TVL, gas with the chain, and the hold window with the age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const main = mainAction(p, capital, chain);
  const depth = depthAction(p, capital, chain);
  return [
    {
      text: 'Set up a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a file or a cloud note.',
      cost: 'nothing: a new address is free to create',
      time: '5 minutes',
    },
    {
      text: `Fund that wallet on ${chain}: buy the asset on an exchange and withdraw it, or bridge it in. Send a little extra to cover gas.`,
      cost: `$${capital} of capital plus about ${gas} of gas for the transfer`,
      time: '20 to 40 minutes including the transfer confirming',
    },
    {
      text: main,
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: depth,
      cost: `about ${gas} of gas, the capital stays deployed`,
      time: '10 minutes',
    },
    {
      text: 'Make one qualifying action each week while you hold: a small deposit, a borrow, a swap, or a vote. Keep it small enough that gas never eats the position.',
      cost: `about ${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot and is not written off as a one-day farmer.`,
      cost: `the $${capital} stays in the position the whole time`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points, rewards or airdrop page and claim only from a link it publishes; never pay a fee to claim.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Log the wallet address, the dates, every transaction hash and the amounts in a spreadsheet so you can repeat the position or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    sector: row.sector,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    momentum_pct: row.model.momentum_pct,
    base: row.model.base,
    momentum_multiplier: row.model.momentum_multiplier,
    dryspell_multiplier: row.model.dryspell_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
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
      slug: p.slug,
      name: p.name,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}