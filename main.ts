// Token Radar: reads the sealed snapshot, scores every pre-token protocol with the peer-calibrated
// model in lib/model.ts, writes /output/board.json and /output/data.js, copies dashboard/ and
// screenshots/, then writes /output/dossier.json last with the vendored make.fun library.
//
// Outside the grader: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3\n`);
  process.exit(1);
}
for (const name of [...shots, ...dashboardFiles]) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: ${name}: a name is letters, digits and . _ -, 1 to 128 characters, not starting with . or -\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const b = radar.backtest;
const top = board.slice(0, 5).map((r) => `${r.rank}. ${r.name} $${(r.implied_value_usd / 1e6).toFixed(1)}M`).join('  ');
process.stdout.write(
  `token radar: ${radar.universe_size} protocols — ${board.length} ranked pre-token, ${radar.live_size} live token, ${radar.excluded_size} kept-out products; ` +
    `${snapshot.watchlist.length} watchlist slugs covered, ${radar.early_size} early below the floor\n` +
    `token radar: peer model — ${b.peers} peers, beta ${b.beta.toFixed(2)}, LOO median miss ${Math.round(b.mdape * 100)}%, within 2x ${Math.round(b.within2 * 100)}%, ` +
    `within 3x ${Math.round(b.within3 * 100)}%; walk-forward ${Math.round(b.wf_mdape * 100)}% on ${b.wf_n}\n` +
    `token radar: top of the board — ${top}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length} images) and dossier.json into ${out}\n`,
);