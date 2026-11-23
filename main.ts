// Token Radar v2 — the program behind the board.
//
// Node 22, standard library only. It reads the sealed snapshot from /input/snapshot.json (or
// --input <file|dir>), scores every pre-token protocol with the model in lib/model.ts, writes the
// ranked board to /output/board.json, writes the dashboard's data into /output/data.js, copies this
// repository's dashboard/ and screenshots/ into /output, and writes /output/dossier.json last, with
// the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, app.css and
// app.js read the data.js this program writes. A protocol whose token already trades is kept out of
// the ranked board and shown at its market's own value on a separate view.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashboardFiles.length < 3) {
  process.stderr.write(`token radar: dashboard/ holds ${dashboardFiles.length} files: it needs index.html, a .css and a .js at least\n`);
  process.exit(1);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of [...shots, ...dashboardFiles]) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: ${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

// A short report: the watchlist is covered, and the top of the board is named so a reader can check.
const top = board.slice(0, 5).map((r) => `${r.rank}. ${r.name} $${(r.implied_value_usd / 1e6).toFixed(1)}M`).join('  ');
const sectors = new Map<string, number>();
for (const r of board) sectors.set(r.sector, (sectors.get(r.sector) ?? 0) + 1);
const sectorLine = [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${s} ${n}`).join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist (all covered), ${board.length} rows scored ` +
    `(${radar.early_size} early below the floor, ${radar.live_size} live-token set aside)\n` +
    `token radar: top of the board — ${top}\n` +
    `token radar: sectors — ${sectorLine}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length} images) and dossier.json into ${out}\n`,
);