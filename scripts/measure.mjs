#!/usr/bin/env node
// Measurement harness for Backtickle: memory (the app plus its WebKit helper processes), startup
// time and keystroke-to-preview delay, on this Mac, without any user interaction.
//
//   node scripts/measure.mjs [--runs 5] [--settle 20] [--scenarios all|S1,S2,...]
//                            [--typing-runs 1] [--out-dir perf-results] [--label phase-0]
//
// It launches the built app (outputs/Backtickle.app) directly, with BACKTICKLE_PERF=1, reads the
// timing marks from its stdout and measures memory with scripts/memstat (compiled from
// scripts/memstat.swift on first use). Progress goes to stderr; the Markdown summary goes to
// stdout and to <out-dir>/<label>-summary.md; every sample goes to <out-dir>/<label>-raw.json.
//
// Scenarios: S1 welcome screen; S2 100 KiB document; S3 5 MiB document; S4 welcome screen plus
// the Preferences window; S5 the wireframe sample. S6 to S10 are the Phase 2 flavor
// documents from scripts/gen-flavor-perf.mjs. S11 (S2 plus a 2,000-file folder in the Files tab) and
// IDLE (CPU time over 60 s of the S11 setup) are Phase 3; S12 is the Search tab's search for
// "lantern" in the S11 folder, run 5 times by the app (BACKTICKLE_BENCH=search). S13 is S2 with the accessibility features on (WP4.8c).
// Typing benchmark (60 keystrokes): S2, S3, S5 to S9, S13.
//
// What makes a run valid (everything else is reported and left out of the statistics):
// - The page was never hidden. A locked screen, a covered or minimized window, or a sleeping
//   display hides the page, WebKit then defers rendering, and the app prints `page-hidden`.
//   Such a run is invalid and is repeated, up to 3 more times.
// - The screen was not locked before or after the run. A locked screen is waited out: checked
//   every 30 s, for up to 20 minutes, then the harness stops and writes what it has.
// - In the welcome-plus-Preferences scenario the two ready marks are close together. The
//   Preferences page prints no page-hidden mark, but when it is hidden its mark slips by the 1 s
//   no-frame fallback, so a gap of more than 900 ms makes that run invalid too.
// - The ready mark(s) arrived within 30 s, the app stayed up, and memory could be read for the
//   app and every attributed helper (see scripts/memstat.swift for how helpers are attributed).
// - The attributed helpers are exactly the expected set (1 each of WebContent, GPU and
//   Networking; 2 WebContent in S4). An extra helper means another WebKit process (for example a
//   Playwright browser) started under the same responsible process and would be counted as the
//   app's: the run is invalid and is repeated.
//
// While it runs the harness holds `caffeinate -di -w <its own pid>`: no display or idle sleep, no
// settings changed, released when the harness exits. The app is never left running: every exit
// path (error, Ctrl+C, SIGTERM) quits it and checks that its helper processes are gone.
//
// Exit codes: 0 every planned run has a valid result; 3 results are partial (see the summary);
// 4 stopped because the screen stayed locked; 130 interrupted; 1 error.

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR as FLAVOR_DIR, generate as generateFlavorDocs } from './gen-flavor-perf.mjs';
import { DOC_SIZES, ensureDocument } from './gen-large-doc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const BUNDLE_ID = 'app.backtickle.desktop';
const MB = 1_048_576;
const SAMPLES_PER_RUN = 3;
const SAMPLE_INTERVAL_MS = 1000;
const PAUSE_AFTER_RUN_MS = 2000;
const HELPERS_GONE_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const HIDDEN_CONFIRM_MS = 300;
const PREFS_GAP_LIMIT_MS = 900;
const SETTLE_SPREAD_LIMIT = 0.02;
const BENCH_INSERTIONS = 60;
/** Typing interval of the app's benchmark (BENCH_INTERVAL_MS in src/perf/typing-bench.ts). */
const BENCH_INTERVAL_MS = 150;
/** Searches the app runs in one search benchmark run (SEARCH_BENCH_RUNS in src/perf/search-bench.ts). */
const SEARCH_RUNS = 5;
const ROLES = ['app', 'webkit-webcontent', 'webkit-gpu', 'webkit-networking', 'other'];
const ROLE_LABEL = {
  app: 'App process',
  'webkit-webcontent': 'WebContent',
  'webkit-gpu': 'GPU',
  'webkit-networking': 'Networking',
  other: 'Other',
};

const HELPERS = {
  'webkit-webcontent': 1,
  'webkit-gpu': 1,
  'webkit-networking': 1,
};
const SCENARIOS = {
  S1: {
    name: 'Welcome screen',
    args: ['--welcome'],
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  S2: {
    name: '100 KiB document, Split view',
    args: ['--open', '{large-100k}', '--view', 'split'],
    doc: '100k',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  // S2 with the accessibility features on (WP4.8c): dyslexia, ruler, spotlight and scale 1.5.
  // Other settings stay at their defaults; the summary shows the difference from S2.
  S13: {
    name: '100 KiB document, Split view, dyslexia, ruler, spotlight, scale 1.5',
    args: ['--open', '{large-100k}', '--view', 'split'],
    doc: '100k',
    settings: { a11y: { dyslexia: true, ruler: true, spotlight: true, scale: 1.5 } },
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  // Phase 5 (WP5.1): S2 in the main window plus the S5 document in a second window. The app
  // restores both from a session.json seeded in the run's config folder, so no code path exists
  // only for the benchmark.
  S14: {
    name: '100 KiB document in main plus the wireframe sample in a second window',
    args: [],
    doc: '100k',
    session_windows: true,
    ready: ['ready'],
    // A second window runs in its own WebContent process.
    expected_helpers: { ...HELPERS, 'webkit-webcontent': 2 },
  },
  S3: {
    name: '5 MiB document, Split view',
    args: ['--open', '{large-5m}', '--view', 'split'],
    doc: '5m',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S4: {
    name: 'Welcome screen plus Preferences window',
    args: ['--welcome', '--prefs'],
    ready: ['ready', 'prefs-ready'],
    expected_helpers: { ...HELPERS, 'webkit-webcontent': 2 },
  },
  S5: {
    name: 'Wireframe sample, Split view',
    args: ['--open', '{wireframe-sample}', '--view', 'split'],
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S6: {
    name: 'Pandoc, 40 citations, Split view',
    args: ['--open', '{flavor-s6}', '--view', 'split'],
    flavor_file: 's6-pandoc.md',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S7: {
    name: 'Quarto, 12 chunks, Split view',
    args: ['--open', '{flavor-s7}', '--view', 'split'],
    flavor_file: 's7-quarto.qmd',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S8: {
    name: 'Obsidian note in a vault, Split view',
    args: ['--open', '{flavor-s8}', '--view', 'split'],
    flavor_file: 'vault/Perf note.md',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S9: {
    name: 'MDX, 15 components, Split view',
    args: ['--open', '{flavor-s9}', '--view', 'split'],
    flavor_file: 's9-mdx.mdx',
    ready: ['ready'],
    expected_helpers: HELPERS,
    typing: true,
  },
  S10: {
    name: 'GFM with 3 Mermaid diagrams, Split view',
    args: ['--open', '{flavor-s10}', '--view', 'split'],
    flavor_file: 's10-mermaid.md',
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  // Phase 5 (WP5.6): S10's twin for Graphviz, three `dot` graphs; budget proposed at the gate.
  S15: {
    name: 'GFM with 3 Graphviz graphs, Split view',
    args: ['--open', '{flavor-s15}', '--view', 'split'],
    flavor_file: 's15-graphviz.md',
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  // Phase 3. No command-line flag shows the Files tab or expands folders, and --open or --folder
  // would leave the Files model unloaded, so these two start with no arguments and a session.json
  // seeded in the run's own config folder: S2's document in Split, the folder, the Files tab and
  // every folder of the two levels expanded (the app restores it like a normal restart).
  S11: {
    name: '100 KiB document, Split view, 2,000-file folder open in Files (two levels)',
    args: [],
    doc: '100k',
    session_folder: 2000,
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  // Diagnosis variants of S11 (WP3.11): the Files tab hidden (Outline shown), and the folder open
  // in the Files tab but collapsed.
  S11H: {
    name: 'S11 with the Outline tab shown (Files tab hidden)',
    args: [],
    doc: '100k',
    session_folder: 2000,
    sidebar_tab: 'outline',
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  S11C: {
    name: 'S11 with the folder open but collapsed',
    args: [],
    doc: '100k',
    session_folder: 2000,
    collapsed: true,
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  // The search benchmark: the app runs the Search tab's search 5 times after ready (one launch per
  // run) and prints the time of each plus the file and match counts. No memory sampling.
  S12: {
    name: 'Search for "lantern" in the 2,000-file folder (5 searches per run)',
    args: [],
    doc: '100k',
    session_folder: 2000,
    search_bench: true,
    query: 'lantern',
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  // The same search with a word the generated folder never contains, so every file is scanned.
  // It expects 0 matches and is not compared with the lantern line count.
  S12Z: {
    name: 'S12 with a query that never occurs (full scan)',
    args: [],
    doc: '100k',
    session_folder: 2000,
    search_bench: true,
    query: 'quernstone',
    expected_matches: 0,
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
  IDLE: {
    name: 'Idle CPU, S11 setup, no input',
    args: [],
    doc: '100k',
    session_folder: 2000,
    idle_s: 60,
    ready: ['ready'],
    expected_helpers: HELPERS,
  },
};

// ---------- command line ----------

const USAGE = `Usage: node scripts/measure.mjs [options]

  --runs N             valid runs wanted per scenario (default 5)
  --settle S           seconds to wait after ready before sampling memory (default 20)
  --scenarios LIST     all, or a list such as S1,S3 (default all)
  --typing-runs N      typing benchmark runs for each of S2, S3, S5 to S9 when selected; 0 skips (default 1)
  --out-dir DIR        where the raw JSON and the Markdown summary go (default perf-results)
  --label NAME         prefix of those two files (default phase-0)

For testing the harness itself:
  --app PATH           app bundle to measure (default outputs/Backtickle.app)
  --memstat PATH       memstat binary (default scripts/.bin/memstat, built on demand)
  --ready-timeout S    seconds to wait for the ready mark (default 30)
  --typing-timeout S   seconds to wait for the typing benchmark (default 600)
  --lock-poll S        seconds between checks while the screen is locked (default 30)
  --lock-wait MIN      minutes to wait for an unlocked screen before giving up (default 20)
  --retry-cooldown S   seconds to wait before repeating an invalid run (default 15)
  --quit-wait S        seconds to wait for the app to quit by itself before SIGTERM (default 6)
`;

function parseArguments(argv) {
  const options = {
    runs: 5,
    settle: 20,
    scenarios: 'all',
    typingRuns: 1,
    outDir: 'perf-results',
    label: 'phase-0',
    app: 'outputs/Backtickle.app',
    memstat: null,
    readyTimeout: 30,
    typingTimeout: 600,
    lockPoll: 30,
    lockWait: 20,
    retryCooldown: 15,
    quitWait: 6,
  };
  const numeric = {
    '--runs': ['runs', 1],
    '--settle': ['settle', 0],
    '--typing-runs': ['typingRuns', 0],
    '--ready-timeout': ['readyTimeout', 1],
    '--typing-timeout': ['typingTimeout', 1],
    '--lock-poll': ['lockPoll', 0.05],
    '--lock-wait': ['lockWait', 0],
    '--retry-cooldown': ['retryCooldown', 0],
    '--quit-wait': ['quitWait', 0],
  };
  const text = {
    '--scenarios': 'scenarios',
    '--out-dir': 'outDir',
    '--label': 'label',
    '--app': 'app',
    '--memstat': 'memstat',
  };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value;
    const equals = flag.indexOf('=');
    if (flag.startsWith('--') && equals > 0) {
      value = flag.slice(equals + 1);
      flag = flag.slice(0, equals);
    }
    if (flag === '--help' || flag === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (!(flag in numeric) && !(flag in text)) throw new Error(`Unknown argument: ${argv[i]}`);
    value ??= argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag in numeric) {
      const [key, min] = numeric[flag];
      const number = Number(value);
      if (!Number.isFinite(number) || number < min) {
        throw new Error(`${flag} must be a number of at least ${min}`);
      }
      options[key] = number;
    } else {
      options[text[flag]] = value;
    }
  }
  const wanted =
    options.scenarios === 'all' ? Object.keys(SCENARIOS) : options.scenarios.split(',');
  const unknown = wanted.filter((id) => !(id in SCENARIOS));
  if (unknown.length > 0) throw new Error(`Unknown scenario: ${unknown.join(', ')}`);
  options.scenarioIds = Object.keys(SCENARIOS).filter((id) => wanted.includes(id));
  return options;
}

// ---------- small helpers ----------

const startedAt = new Date();
const abortController = new AbortController();
let abortSignalName = null;

class AbortedError extends Error {}
class LockedScreenError extends Error {}

/** A path relative to the repository, or absolute if it lies outside it. */
function shortPath(path) {
  const relativePath = relative(repoRoot, path);
  return relativePath === '' || relativePath.startsWith('..') ? path : relativePath;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localIso(date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function log(message) {
  const now = new Date();
  process.stderr.write(
    `[${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}] ${message}\n`,
  );
}

/** Sleep that a stop request (Ctrl+C, SIGTERM) ends at once, by throwing. */
function sleep(ms) {
  return new Promise((resolvePromise, reject) => {
    if (abortController.signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      abortController.signal.removeEventListener('abort', onAbort);
      resolvePromise();
    }, ms);
    abortController.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Sleep for cleanup code: not interrupted by a stop request. */
function hardSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Runs a command; never rejects. `code` is -1 when the command could not run or timed out. */
function exec(command, args, { timeout = 20_000 } = {}) {
  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      { timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        resolvePromise({
          code: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          timedOut: Boolean(error?.killed),
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

async function output(command, args) {
  const result = await exec(command, args);
  return result.code === 0 ? result.stdout.trim() : null;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const byNumber = (a, b) => a - b;

// ---------- statistics ----------

/** Linear interpolation between order statistics (R's default `quantile`, type 7). */
function quantile(values, p) {
  const sorted = [...values].sort(byNumber);
  if (sorted.length === 0) return null;
  const h = (sorted.length - 1) * p;
  const low = Math.floor(h);
  const high = Math.ceil(h);
  return sorted[low] + (h - low) * (sorted[high] - sorted[low]);
}

function summarize(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { n: 0, median: null, min: null, max: null };
  return {
    n: finite.length,
    median: quantile(finite, 0.5),
    min: finite.reduce((a, b) => Math.min(a, b)),
    max: finite.reduce((a, b) => Math.max(a, b)),
  };
}

function summarizeWithPercentiles(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    ...summarize(finite),
    p50: quantile(finite, 0.5),
    p95: quantile(finite, 0.95),
  };
}

// ---------- processes ----------

async function listProcesses() {
  const result = await exec('/bin/ps', ['-axo', 'pid=,comm=']);
  if (result.code !== 0) throw new Error(`ps failed: ${result.stderr.trim()}`);
  const processes = [];
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (match) processes.push({ pid: Number(match[1]), comm: match[2] });
  }
  return processes;
}

const isWebKitHelper = (p) => basename(p.comm).startsWith('com.apple.WebKit.');
const isBacktickle = (p) =>
  /(^|\/)backtickle$/i.test(p.comm) || /Backtickle\.app\/Contents\/MacOS\//.test(p.comm);

async function webkitPids() {
  return (await listProcesses())
    .filter(isWebKitHelper)
    .map((p) => p.pid)
    .sort(byNumber);
}

async function otherBacktickleInstances(ownPid) {
  return (await listProcesses()).filter((p) => isBacktickle(p) && p.pid !== ownPid);
}

// ---------- memstat ----------

let memstatPath = null;

async function ensureMemstat(options) {
  if (options.memstat) {
    memstatPath = resolve(options.memstat);
    if (!existsSync(memstatPath)) throw new Error(`memstat not found: ${memstatPath}`);
    return;
  }
  const source = join(here, 'memstat.swift');
  memstatPath = join(here, '.bin', 'memstat');
  if (existsSync(memstatPath) && statSync(memstatPath).mtimeMs >= statSync(source).mtimeMs) return;
  log('Compiling scripts/memstat.swift (swiftc -O) ...');
  mkdirSync(dirname(memstatPath), { recursive: true });
  const result = await exec('swiftc', ['-O', source, '-o', memstatPath], {
    timeout: 600_000,
  });
  if (result.code !== 0) {
    throw new Error(
      `swiftc failed (code ${result.code}). Is the Command Line Tools install complete?\n${result.stderr}`,
    );
  }
}

/** One memstat call for the app pid. Exit codes 0 and 4 are usable (4 carries caveats). */
async function runMemstat(pid) {
  const result = await exec(memstatPath, [String(pid)], { timeout: 15_000 });
  let processes = null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) processes = parsed;
  } catch {
    // Reported through `usable` below.
  }
  const complete =
    processes !== null &&
    processes.length > 0 &&
    processes.every((p) => Number.isFinite(p.phys_footprint_bytes)) &&
    processes.some((p) => p.role === 'app');
  return {
    code: result.code,
    usable: (result.code === 0 || result.code === 4) && complete,
    processes: processes ?? [],
    stderr: result.stderr.trim(),
  };
}

async function sessionState() {
  const locked = await exec(memstatPath, ['--screen-locked'], {
    timeout: 10_000,
  });
  const detail = await exec(memstatPath, ['--session-state'], {
    timeout: 10_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(detail.stdout);
  } catch {
    // Unknown, handled below.
  }
  const word = locked.stdout.trim();
  const screenLocked =
    word === 'true' ? true : word === 'false' ? false : (parsed?.screen_locked ?? null);
  const state = {
    screen_locked: screenLocked,
    on_console: parsed?.on_console ?? null,
    display_asleep: parsed?.display_asleep ?? null,
    display_refresh_hz: parsed?.display_refresh_hz ?? null,
    display_count: parsed?.display_count ?? null,
  };
  state.unknown = screenLocked === null && parsed === null;
  const reasons = [];
  if (state.screen_locked === true) reasons.push('screen locked');
  if (state.on_console === false) reasons.push('login session not on the console');
  if (state.display_asleep === true) reasons.push('display asleep');
  state.blocked_by = reasons;
  state.blocked = reasons.length > 0;
  return state;
}

let warnedSessionUnknown = false;

/** Waits (checking every `lockPoll` s, up to `lockWait` min) until the screen is usable. */
async function waitForUsableScreen(options, record) {
  const waitStart = performance.now();
  for (;;) {
    const state = await sessionState();
    record.session_checks.push({ at: new Date().toISOString(), ...state });
    if (state.unknown && !warnedSessionUnknown) {
      warnedSessionUnknown = true;
      log('WARNING: the session state cannot be read; relying on the page-hidden mark alone.');
    }
    if (!state.blocked) return state;
    const waited = (performance.now() - waitStart) / 1000;
    if (waited >= options.lockWait * 60) {
      throw new LockedScreenError(
        `${state.blocked_by.join(', ')} for more than ${options.lockWait} minutes`,
      );
    }
    log(
      `Cannot measure now (${state.blocked_by.join(', ')}). Checking again in ${options.lockPoll} s ` +
        `(giving up after ${options.lockWait} min; waited ${Math.round(waited)} s so far).`,
    );
    await sleep(options.lockPoll * 1000);
  }
}

// ---------- the app under test ----------

const liveRuns = new Set();
let caffeinateChild = null;

class AppRun {
  constructor({ binary, args, env, cwd, seed }) {
    this.binary = binary;
    this.args = args;
    // The stores (recents, settings, document state) of every run live in a folder of their own,
    // so a measurement never touches the stores of the user's real app (BACKTICKLE_CONFIG_DIR).
    this.configDir = mkdtempSync(join(os.tmpdir(), 'backtickle-measure-'));
    this.env = { ...env, BACKTICKLE_CONFIG_DIR: this.configDir };
    if (seed) seed(this.configDir);
    this.cwd = cwd;
    this.marks = [];
    this.otherLines = [];
    this.stderrText = '';
    this.bench = null;
    this.hidden = null;
    this.hiddenAfterQuit = false;
    this.quitting = false;
    this.exited = null;
    this.closed = false;
    this.spawnError = null;
    this.waiters = new Set();
    this.buffer = '';
    // Helper processes of this app instance as attributed by memstat. Only these are waited for
    // and, if they outlive the app, stopped. The process-list difference can contain another
    // app's helper that started meanwhile, so it is never used for that.
    this.helperPids = new Set();
    this.t0 = 0n;
    this.child = null;
    this.pid = null;
  }

  elapsedMs() {
    return Number(process.hrtime.bigint() - this.t0) / 1e6;
  }

  start() {
    this.wall = new Date();
    this.t0 = process.hrtime.bigint();
    this.child = spawn(this.binary, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.pid = this.child.pid ?? null;
    liveRuns.add(this);
    this.child.on('error', (error) => {
      this.spawnError = error;
      rmSync(this.configDir, { recursive: true, force: true });
      this.notify();
    });
    this.child.on('spawn', () => {
      this.spawnedAtMs = this.elapsedMs();
    });
    this.child.on('exit', (code, signal) => {
      this.exited = { code, signal, at_ms: this.elapsedMs() };
      this.notify();
      // The last stdout lines can still be on their way: a waiter acts on the exit only once the
      // pipe has closed, or after this short grace period if it never does.
      setTimeout(() => this.notify(), 600);
    });
    this.child.on('close', () => {
      this.closed = true;
      // Only the temporary folder made above is removed, never the app's own folders.
      rmSync(this.configDir, { recursive: true, force: true });
      this.notify();
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      if (this.stderrText.length < 8000) this.stderrText += chunk;
    });
  }

  onStdout(chunk) {
    const ms = this.elapsedMs();
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trimEnd();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onLine(line, ms);
    }
    this.notify();
  }

  onLine(line, ms) {
    try {
      if (line.startsWith('BACKTICKLE_PERF ')) {
        const data = JSON.parse(line.slice('BACKTICKLE_PERF '.length));
        this.marks.push({ mark: data.mark, app_ms: data.ms, script_ms: ms });
        if (data.mark === 'page-hidden') {
          // After the quit began, or after the benchmark line (the app then quits itself), the
          // window is closing: that is shutdown, not a hidden page during the measurement.
          if (this.quitting || this.bench) this.hiddenAfterQuit = true;
          else this.hidden ??= { app_ms: data.ms, script_ms: ms };
        }
        return;
      }
      if (line.startsWith('BACKTICKLE_BENCH ')) {
        this.bench = {
          ...JSON.parse(line.slice('BACKTICKLE_BENCH '.length)),
          script_ms: ms,
        };
        return;
      }
    } catch {
      // Falls through: an unparseable line is kept as plain output.
    }
    if (this.otherLines.length < 20) this.otherLines.push(line);
  }

  notify() {
    for (const waiter of [...this.waiters]) waiter();
  }

  mark(name) {
    return this.marks.find((m) => m.mark === name) ?? null;
  }

  /** Waits until `condition()` returns a reason, or `timeoutMs` pass (then "timeout"). */
  async waitUntil(condition, timeoutMs, { abortable = true } = {}) {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      if (abortable && abortController.signal.aborted) throw new AbortedError();
      const outcome = condition();
      if (outcome) return outcome;
      const remaining = deadline - performance.now();
      if (remaining <= 0) return 'timeout';
      await new Promise((resolvePromise) => {
        const finish = () => {
          clearTimeout(timer);
          this.waiters.delete(finish);
          abortController.signal.removeEventListener('abort', finish);
          resolvePromise();
        };
        const timer = setTimeout(finish, remaining);
        this.waiters.add(finish);
        if (abortable)
          abortController.signal.addEventListener('abort', finish, {
            once: true,
          });
      });
    }
  }

  /** Why the run cannot go on, or null. */
  stopReason() {
    if (this.spawnError) return 'spawn-error';
    if (this.hidden) return 'hidden';
    if (this.exited && (this.closed || this.elapsedMs() - this.exited.at_ms > 500)) return 'exit';
    return null;
  }
}

function hardCleanup() {
  for (const run of liveRuns) {
    for (const pid of [run.pid, ...run.helperPids]) {
      if (!pid) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  if (caffeinateChild?.pid) {
    try {
      process.kill(caffeinateChild.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Quits the app the way a user would (the AppleScript quit event), falling back to SIGTERM and
 * then SIGKILL, then makes sure the helper processes are gone. Never throws, never aborts.
 */
async function quitApp(run, record, quitWaitMs = 6000) {
  const cleanup = {
    method: null,
    exit_ms: null,
    exit_code: null,
    exit_signal: null,
    helpers_waited_for: [...run.helperPids].sort(byNumber),
    helpers_gone_ms: null,
    leftover_helpers: [],
  };
  record.cleanup = cleanup;
  run.quitting = true;
  const quitStart = performance.now();
  const stillRunning = () => run.pid !== null && !run.exited && isAlive(run.pid);

  if (!stillRunning()) {
    cleanup.method = 'exited-by-itself';
  } else {
    // Only while the process is alive: an AppleScript quit would otherwise start the app first.
    await exec('/usr/bin/osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`], {
      timeout: 5000,
    });
    const graceful = await run.waitUntil(() => (run.exited ? 'exit' : null), quitWaitMs, {
      abortable: false,
    });
    if (graceful === 'exit') {
      cleanup.method = 'osascript-quit';
    } else {
      try {
        process.kill(run.pid, 'SIGTERM');
      } catch {
        // Gone in the meantime.
      }
      const term = await run.waitUntil(() => (run.exited ? 'exit' : null), 3000, {
        abortable: false,
      });
      cleanup.method = 'sigterm';
      if (term !== 'exit') {
        try {
          process.kill(run.pid, 'SIGKILL');
        } catch {
          // Gone in the meantime.
        }
        cleanup.method = 'sigkill';
        await run.waitUntil(() => (run.exited ? 'exit' : null), 2000, {
          abortable: false,
        });
      }
    }
  }
  if (run.exited) {
    cleanup.exit_ms = Math.round(performance.now() - quitStart);
    cleanup.exit_code = run.exited.code;
    cleanup.exit_signal = run.exited.signal;
  }

  const waitStart = quitStart;
  const alive = () => [...run.helperPids].filter((pid) => isAlive(pid));
  while (alive().length > 0 && performance.now() - waitStart < HELPERS_GONE_TIMEOUT_MS) {
    await hardSleep(50);
  }
  const left = alive();
  if (left.length === 0) {
    cleanup.helpers_gone_ms = Math.round(performance.now() - waitStart);
  } else {
    cleanup.leftover_helpers = left;
    log(
      `WARNING: helper processes still alive ${HELPERS_GONE_TIMEOUT_MS / 1000} s after quit: ${left.join(', ')}. Stopping them.`,
    );
    for (const pid of left) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Gone.
      }
    }
    await hardSleep(2000);
    for (const pid of alive()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Gone.
      }
    }
  }
  liveRuns.delete(run);
}

// ---------- one run ----------

function newRecord(kind, scenarioId, run, attempt) {
  return {
    kind,
    scenario: scenarioId,
    run,
    attempt,
    status: 'pending',
    reason: null,
    notes: [],
    spawn_wall: null,
    spawn_pid: null,
    load_avg_1m: null,
    prefs_ready_gap_ms: null,
    session_checks: [],
    session_after: null,
    marks: [],
    webkit_before: [],
    webkit_at_ready: [],
    webkit_final: [],
    attribution_at_ready: null,
    attribution_final: null,
    at_ready_sample: null,
    samples: [],
    settle: null,
    bench: null,
    cleanup: null,
    app_stdout_other: [],
    app_stderr: '',
  };
}

/**
 * Memory of one sample. The total is the app plus its WebKit helpers (WebContent, GPU, Networking).
 * Processes of role "other" (a child of the app, or a macOS system service that a Finder launch
 * attributes to the app) are listed on their own and are not part of the total.
 */
function memoryOf(processes) {
  const byRole = Object.fromEntries(ROLES.map((role) => [role, 0]));
  let total = 0;
  let peak = 0;
  for (const p of processes) {
    byRole[p.role] = (byRole[p.role] ?? 0) + p.phys_footprint_bytes;
    if (p.role === 'other') continue;
    total += p.phys_footprint_bytes;
    peak += p.lifetime_max_phys_footprint_bytes ?? p.phys_footprint_bytes;
  }
  return { by_role_bytes: byRole, total_bytes: total, peak_sum_bytes: peak };
}

/** Second opinion on the helper list: WebKit helpers that appeared since before the launch. */
function crossCheck({ processes, before, now, appPid, scenario }) {
  const attributed = processes
    .filter((p) => p.pid !== appPid && p.name.startsWith('com.apple.WebKit.'))
    .map((p) => p.pid)
    .sort(byNumber);
  const knownBefore = new Set(before);
  const appeared = now.filter((pid) => !knownBefore.has(pid)).sort(byNumber);
  const onlyResponsible = attributed.filter((pid) => !appeared.includes(pid));
  const onlyDifference = appeared.filter((pid) => !attributed.includes(pid));
  const counts = Object.fromEntries(
    Object.keys(scenario.expected_helpers).map((role) => [
      role,
      processes.filter((p) => p.role === role).length,
    ]),
  );
  const countsMatch = Object.entries(scenario.expected_helpers).every(
    ([role, expected]) => counts[role] === expected,
  );
  return {
    responsible_pid_method: attributed,
    process_list_difference: appeared,
    agree: onlyResponsible.length === 0 && onlyDifference.length === 0,
    only_in_responsible_pid_method: onlyResponsible,
    only_in_process_list_difference: onlyDifference,
    helper_counts: counts,
    expected_helper_counts: scenario.expected_helpers,
    helper_counts_match: countsMatch,
    non_webkit_attributed: processes
      .filter((p) => p.pid !== appPid && !p.name.startsWith('com.apple.WebKit.'))
      .map((p) => ({ pid: p.pid, name: p.name, basis: p.basis })),
    bases: [...new Set(processes.map((p) => p.basis))].sort(),
  };
}

function describeExit(run) {
  if (run.spawnError) return `could not start the app: ${run.spawnError.message}`;
  const e = run.exited;
  return e
    ? `the app exited (code ${e.code}, signal ${e.signal}) after ${Math.round(e.at_ms)} ms`
    : 'unknown';
}

function finishRecord(record, run) {
  record.marks = run.marks;
  record.app_stdout_other = run.otherLines;
  record.app_stderr = run.stderrText.trim().slice(0, 2000);
  if (run.hiddenAfterQuit) {
    record.notes.push(
      'page-hidden was printed after the measurement ended, while quitting (ignored)',
    );
  }
}

/** Gives up on a run: invalid if the screen is no longer usable, otherwise failed. */
async function failOrInvalid(record, reason) {
  const state = await sessionState();
  record.session_after = { at: new Date().toISOString(), ...state };
  if (state.blocked) {
    record.status = 'invalid';
    record.reason = `${state.blocked_by.join(', ')} (run ended with: ${reason})`;
  } else {
    record.status = 'failed';
    record.reason = reason;
  }
}

function scenarioArguments(scenario, documents) {
  return scenario.args.map((arg) => {
    const match = arg.match(/^\{(.*)\}$/);
    return match ? documents[match[1]].absolute : arg;
  });
}

// ---------- Phase 3: seeded session and idle CPU ----------

/** Writes session.json into the run's config folder for scenarios that start from a session. */
function sessionSeeder(scenario, documents) {
  if (!scenario.session_folder && !scenario.session_windows) return null;
  return (configDir) => {
    const folder = scenario.session_folder ? documents[`folder-${scenario.session_folder}`] : null;
    const doc = documents[`large-${scenario.doc}`];
    const session = {
      version: 1,
      tabs: [{ path: doc.absolute, view: 'split' }],
      active: 0,
      folder: folder ? folder.absolute : null,
      sidebarTab: scenario.sidebar_tab ?? (folder ? 'files' : 'outline'),
      expanded: folder && !scenario.collapsed ? folder.expanded : [],
    };
    if (scenario.session_windows) {
      // Main and a second window side by side, as Move Tab to New Window would place them.
      session.bounds = { x: 0, y: 40, width: 1280, height: 820 };
      session.windows = [
        {
          tabs: [{ path: documents['wireframe-sample'].absolute, view: 'split' }],
          active: 0,
          bounds: { x: 1280, y: 40, width: 1280, height: 820 },
        },
      ];
    }
    writeFileSync(join(configDir, 'session.json'), JSON.stringify(session));
  };
}

/**
 * Writes settings.json into the run's config folder when a scenario sets `settings`: the
 * defaults of tests/fixtures/settings-defaults.json with the scenario's values merged in.
 */
function settingsSeeder(scenario) {
  if (!scenario.settings) return null;
  return (configDir) => {
    const defaults = JSON.parse(
      readFileSync(join(repoRoot, 'tests', 'fixtures', 'settings-defaults.json'), 'utf8'),
    );
    const merge = (target, source) => {
      for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          target[key] = merge(target[key] ?? {}, value);
        } else {
          target[key] = value;
        }
      }
      return target;
    };
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify(merge(defaults, scenario.settings)),
    );
  };
}

/** The config seed of a scenario run: the session (Phase 3) and/or the settings (Phase 4). */
function scenarioSeed(scenario, documents) {
  const seeders = [sessionSeeder(scenario, documents), settingsSeeder(scenario)].filter(Boolean);
  if (seeders.length === 0) return undefined;
  return (configDir) => {
    for (const seed of seeders) seed(configDir);
  };
}

/** Folder tree of gen-folder.mjs: the root's group folders and the dir folders below them. */
function folderDocument(n) {
  const script = join(here, 'gen-folder.mjs');
  const root = join(repoRoot, 'tests', 'fixtures', 'generated', `folder-${n}`);
  if (!existsSync(root)) {
    execFileSync('node', [script, '--n', String(n)], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
  const expanded = [];
  for (const group of readdirSync(root).sort()) {
    const groupPath = join(root, group);
    if (!statSync(groupPath).isDirectory()) continue;
    expanded.push(groupPath);
    for (const dir of readdirSync(groupPath).sort()) {
      if (statSync(join(groupPath, dir)).isDirectory()) expanded.push(join(groupPath, dir));
    }
  }
  return {
    absolute: root,
    path: relative(repoRoot, root),
    expanded,
    generated: true,
    generator: 'scripts/gen-folder.mjs',
    lantern_lines: lanternLinesOf(n),
  };
}

/** The "lantern lines" count the generator prints for n files (it is deterministic). */
function lanternLinesOf(n) {
  const scratch = mkdtempSync(join(os.tmpdir(), 'backtickle-genfolder-'));
  try {
    const output = execFileSync(
      'node',
      [join(here, 'gen-folder.mjs'), '--n', String(n), '--out', scratch],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    const match = output.match(/lantern lines:\s*(\d+)/);
    return match ? Number(match[1]) : null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Parses `ps` CPU time ("M:SS.cc", "H:MM:SS.cc" or "D-HH:MM:SS") to milliseconds. */
function parseCpuTime(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : ['0', text];
  const parts = rest.split(':').map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round((Number(days) * 86400 + seconds) * 1000);
}

/** CPU time used so far by each of these processes, in ms, from `ps -o time=`. */
function cpuTimes(pids) {
  return new Promise((resolveTimes, reject) => {
    execFile('ps', ['-o', 'pid=,time=', '-p', pids.join(',')], (error, stdout) => {
      if (error && !stdout) return reject(error);
      const times = {};
      for (const line of stdout.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(\S+)$/);
        if (match) times[match[1]] = parseCpuTime(match[2]);
      }
      resolveTimes(times);
    });
  });
}

/** CPU used by the app and its helpers over `seconds` without input; null if the run ended. */
async function measureIdle(run, seconds, record) {
  const pids = [run.pid, ...run.helperPids].filter((pid) => isAlive(pid));
  const before = await cpuTimes(pids);
  const waited = await run.waitUntil(() => run.stopReason(), seconds * 1000);
  if (waited !== 'timeout') return waited;
  const after = await cpuTimes(pids);
  const missing = pids.filter((pid) => !(pid in before) || !(pid in after));
  if (missing.length > 0)
    throw new Error(`process ${missing.join(', ')} gone during the idle window`);
  const perProcess = Object.fromEntries(pids.map((pid) => [pid, after[pid] - before[pid]]));
  record.idle = {
    window_s: seconds,
    pids,
    cpu_ms_per_process: perProcess,
    cpu_ms_total: Object.values(perProcess).reduce((a, b) => a + b, 0),
    resolution_ms: 10,
  };
  return 'timeout';
}

async function standardRun(options, ctx, scenarioId, runNumber, attemptNumber) {
  const scenario = SCENARIOS[scenarioId];
  const record = newRecord('standard', scenarioId, runNumber, attemptNumber);
  let run = null;
  try {
    await waitForUsableScreen(options, record);
    const strangers = await otherBacktickleInstances(process.pid);
    if (strangers.length > 0) {
      throw new Error(
        `Another Backtickle process appeared: ${strangers.map((p) => p.pid).join(', ')}`,
      );
    }
    record.load_avg_1m = os.loadavg()[0];
    const before = await webkitPids();
    record.webkit_before = before;

    run = new AppRun({
      binary: ctx.binary,
      args: scenarioArguments(scenario, ctx.documents),
      seed: scenarioSeed(scenario, ctx.documents),
      env: { ...process.env, BACKTICKLE_PERF: '1' },
      cwd: repoRoot,
    });
    run.start();
    record.spawn_wall = run.wall.toISOString();
    record.spawn_pid = run.pid;

    const have = (name) => run.mark(name) !== null;
    const outcome = await run.waitUntil(
      () => run.stopReason() ?? (scenario.ready.every(have) ? 'ready' : null),
      options.readyTimeout * 1000,
    );
    if (outcome === 'hidden') {
      record.status = 'invalid';
      record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch before ready (screen locked, or the window covered, minimized or on a sleeping display)`;
      return record;
    }
    if (outcome !== 'ready') {
      const why =
        outcome === 'timeout'
          ? `no ${scenario.ready.filter((m) => !have(m)).join(' / ')} mark within ${options.readyTimeout} s`
          : describeExit(run);
      await failOrInvalid(record, why);
      return record;
    }

    // The Preferences page is a separate page and prints no page-hidden mark. When it is hidden,
    // its prefs-ready mark waits for the 1 s no-frame fallback, so a late mark gives it away.
    if (scenario.ready.includes('prefs-ready')) {
      const gap = run.mark('prefs-ready').app_ms - run.mark('ready').app_ms;
      record.prefs_ready_gap_ms = gap;
      if (Math.abs(gap) > PREFS_GAP_LIMIT_MS) {
        record.status = 'invalid';
        record.reason = `prefs-ready and ready are ${Math.round(Math.abs(gap))} ms apart, which points to the 1 s no-frame fallback: the Preferences window was probably hidden or covered`;
        return record;
      }
    }

    // Everything the app reported up to here is what startup means. Nothing heavy ran meanwhile.
    const readyAt = Math.max(...scenario.ready.map((name) => run.mark(name).script_ms));
    const snapshot = await webkitPids();
    record.webkit_at_ready = snapshot;
    const early = await runMemstat(run.pid);
    record.at_ready_sample = {
      t_ms: Math.round(run.elapsedMs()),
      exit_code: early.code,
      stderr: early.stderr,
      processes: early.processes,
    };
    for (const p of early.processes) if (p.pid !== run.pid) run.helperPids.add(p.pid);
    if (early.usable) {
      record.attribution_at_ready = crossCheck({
        processes: early.processes,
        before,
        now: snapshot,
        appPid: run.pid,
        scenario,
      });
    }

    // Settle, then three samples one second apart. The last one is the result.
    const sampleTimes = Array.from(
      { length: SAMPLES_PER_RUN },
      (_, i) => readyAt + options.settle * 1000 + i * SAMPLE_INTERVAL_MS,
    );
    for (const [index, due] of sampleTimes.entries()) {
      const wait = due - run.elapsedMs();
      const waited = await run.waitUntil(() => run.stopReason(), Math.max(0, wait));
      if (waited !== 'timeout') {
        if (waited === 'hidden') {
          record.status = 'invalid';
          record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch, during settling or sampling`;
        } else {
          await failOrInvalid(record, `${describeExit(run)} before sample ${index + 1}`);
        }
        return record;
      }
      const sample = await runMemstat(run.pid);
      record.samples.push({
        index: index + 1,
        t_ms: Math.round(run.elapsedMs()),
        wall: new Date().toISOString(),
        exit_code: sample.code,
        stderr: sample.stderr,
        processes: sample.processes,
        memory: sample.usable ? memoryOf(sample.processes) : null,
      });
      for (const p of sample.processes) if (p.pid !== run.pid) run.helperPids.add(p.pid);
      if (!sample.usable) {
        await failOrInvalid(
          record,
          `memstat gave no usable result for sample ${index + 1} (exit code ${sample.code}): ${sample.stderr || 'no message'}`,
        );
        return record;
      }
      if (index === SAMPLES_PER_RUN - 1) {
        const now = await webkitPids();
        record.webkit_final = now;
        record.attribution_final = crossCheck({
          processes: sample.processes,
          before,
          now,
          appPid: run.pid,
          scenario,
        });
      }
    }

    // Spread of the three totals, as a share of the last one: has the memory settled?
    const totals = record.samples.map((s) => s.memory.total_bytes);
    record.settle = {
      totals_bytes: totals,
      spread_share_of_last: (Math.max(...totals) - Math.min(...totals)) / totals[totals.length - 1],
      limit: SETTLE_SPREAD_LIMIT,
    };

    if (scenario.idle_s) {
      const idleOutcome = await measureIdle(run, scenario.idle_s, record);
      if (idleOutcome !== 'timeout') {
        if (idleOutcome === 'hidden') {
          record.status = 'invalid';
          record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch, during the idle window`;
        } else {
          await failOrInvalid(record, `${describeExit(run)} during the idle window`);
        }
        return record;
      }
    }

    // Give a late page-hidden mark time to arrive, then judge the whole run.
    await run.waitUntil(() => run.stopReason(), HIDDEN_CONFIRM_MS);
    const after = await sessionState();
    record.session_after = { at: new Date().toISOString(), ...after };
    if (run.hidden) {
      record.status = 'invalid';
      record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch, after sampling`;
    } else if (after.blocked) {
      record.status = 'invalid';
      record.reason = `${after.blocked_by.join(', ')} at the end of the run`;
    } else if (run.exited) {
      record.status = 'failed';
      record.reason = `${describeExit(run)} while sampling`;
    } else if (record.attribution_final && !record.attribution_final.helper_counts_match) {
      // Another WebKit process started under the same responsible process during the run (for
      // example a Playwright browser of a test run): its memory would be counted as the app's.
      record.status = 'invalid';
      record.reason = `helper counts ${JSON.stringify(record.attribution_final.helper_counts)}, expected ${JSON.stringify(record.attribution_final.expected_helper_counts)} (another WebKit process was counted)`;
    } else {
      record.status = 'ok';
    }
    return record;
  } catch (error) {
    if (error instanceof AbortedError || error instanceof LockedScreenError) throw error;
    record.status = 'failed';
    record.reason = `harness error: ${error.message}`;
    return record;
  } finally {
    if (run) {
      await quitApp(run, record, options.quitWait * 1000);
      finishRecord(record, run);
    }
  }
}

async function typingRun(options, ctx, scenarioId, runNumber, attemptNumber, mode = 'typing') {
  const scenario = SCENARIOS[scenarioId];
  const searching = mode === 'search';
  const record = newRecord(mode, scenarioId, runNumber, attemptNumber);
  let run = null;
  try {
    await waitForUsableScreen(options, record);
    const strangers = await otherBacktickleInstances(process.pid);
    if (strangers.length > 0) {
      throw new Error(
        `Another Backtickle process appeared: ${strangers.map((p) => p.pid).join(', ')}`,
      );
    }
    record.load_avg_1m = os.loadavg()[0];
    const before = await webkitPids();
    record.webkit_before = before;

    run = new AppRun({
      binary: ctx.binary,
      args: scenarioArguments(scenario, ctx.documents),
      seed: searching ? sessionSeeder(scenario, ctx.documents) : undefined,
      env: {
        ...process.env,
        BACKTICKLE_PERF: '1',
        BACKTICKLE_BENCH: mode,
        BACKTICKLE_BENCH_EXIT: '1',
        ...(searching ? { BACKTICKLE_BENCH_QUERY: scenario.query } : {}),
      },
      cwd: repoRoot,
    });
    run.start();
    record.spawn_wall = run.wall.toISOString();
    record.spawn_pid = run.pid;

    // Which helpers belong to this app instance, for the cleanup. The first keystroke comes
    // 150 ms after ready, so this call is over before the benchmark types anything.
    const noteHelpers = async () => {
      const early = await runMemstat(run.pid);
      record.at_ready_sample = {
        t_ms: Math.round(run.elapsedMs()),
        exit_code: early.code,
        stderr: early.stderr,
        processes: early.processes,
      };
      for (const p of early.processes) if (p.pid !== run.pid) run.helperPids.add(p.pid);
    };
    const ready = await run.waitUntil(
      () => run.stopReason() ?? (run.mark('ready') ? 'ready' : null),
      options.readyTimeout * 1000,
    );
    if (ready === 'ready') await noteHelpers();
    const outcome =
      ready === 'ready'
        ? await run.waitUntil(
            () => (run.bench ? 'bench' : (run.stopReason() ?? null)),
            options.typingTimeout * 1000,
          )
        : ready;
    if (outcome === 'hidden') {
      record.status = 'invalid';
      record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch (screen locked, or the window covered, minimized or on a sleeping display)`;
      return record;
    }
    if (outcome !== 'bench') {
      const why =
        outcome === 'timeout'
          ? ready === 'ready'
            ? `no benchmark line within ${options.typingTimeout} s`
            : `no ready mark within ${options.readyTimeout} s`
          : describeExit(run);
      await failOrInvalid(record, why);
      return record;
    }

    if (searching) {
      record.bench = {
        query: run.bench.query,
        runs: run.bench.runs,
        error: run.bench.error,
        script_ms: run.bench.script_ms,
      };
    }
    const { render_ms: render, e2e_ms: e2e, doc_bytes: docBytes } = run.bench;
    if (!searching)
      record.bench = {
        doc_bytes: docBytes,
        render_ms: render,
        e2e_ms: e2e,
        samples_expected: BENCH_INSERTIONS,
        script_ms: run.bench.script_ms,
      };
    // The app quits itself after printing the benchmark line (BACKTICKLE_BENCH_EXIT=1). Give it
    // time to do so before any quit command could race with it.
    await run.waitUntil(() => (run.exited ? 'exit' : null), 8000, {
      abortable: false,
    });
    await run.waitUntil(() => run.stopReason(), HIDDEN_CONFIRM_MS);
    const after = await sessionState();
    record.session_after = { at: new Date().toISOString(), ...after };
    if (run.hidden) {
      record.status = 'invalid';
      record.reason = `page-hidden mark ${Math.round(run.hidden.script_ms)} ms after launch, during the benchmark`;
    } else if (after.blocked) {
      record.status = 'invalid';
      record.reason = `${after.blocked_by.join(', ')} at the end of the run`;
    } else if (searching) {
      const found = record.bench.runs;
      if (record.bench.error || !Array.isArray(found) || found.length < SEARCH_RUNS) {
        record.status = 'failed';
        record.reason = `the search benchmark did not finish: ${record.bench.error ?? `${found?.length ?? 0} of ${SEARCH_RUNS} searches`}`;
      } else {
        record.status = 'ok';
      }
    } else if (
      !Array.isArray(render) ||
      !Array.isArray(e2e) ||
      render.length === 0 ||
      render.length !== e2e.length
    ) {
      record.status = 'failed';
      record.reason = 'the benchmark line has no usable render_ms and e2e_ms arrays';
    } else {
      record.status = 'ok';
      if (e2e.length < BENCH_INSERTIONS) {
        record.notes.push(`incomplete benchmark: ${e2e.length} of ${BENCH_INSERTIONS} samples`);
      }
    }
    return record;
  } catch (error) {
    if (error instanceof AbortedError || error instanceof LockedScreenError) throw error;
    record.status = 'failed';
    record.reason = `harness error: ${error.message}`;
    return record;
  } finally {
    if (run) {
      await quitApp(run, record, options.quitWait * 1000);
      finishRecord(record, run);
    }
  }
}

// ---------- plan and execution ----------

async function runSlot(options, ctx, kind, scenarioId, runNumber) {
  const attemptFunction =
    kind === 'standard'
      ? standardRun
      : kind === 'search'
        ? (...args) => typingRun(...args, 'search')
        : typingRun;
  const label = `${scenarioId} ${kind === 'typing' ? 'typing run' : kind === 'search' ? 'search run' : 'run'} ${runNumber}`;
  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    log(`${label}, attempt ${attempt}: start`);
    const record = await attemptFunction(options, ctx, scenarioId, runNumber, attempt);
    ctx.attempts.push(record);
    ctx.checkpoint();
    log(describeRecord(label, record));
    await sleep(PAUSE_AFTER_RUN_MS);
    if (record.status !== 'invalid') return record;
    if (attempt <= MAX_RETRIES) {
      log(
        `${label}: invalid, repeating (retry ${attempt} of ${MAX_RETRIES}) after ${options.retryCooldown} s`,
      );
      await sleep(options.retryCooldown * 1000);
    }
  }
  log(`${label}: no valid result after ${1 + MAX_RETRIES} attempts`);
  return null;
}

function describeRecord(label, record) {
  if (record.status === 'ok') {
    if (record.kind === 'search') {
      const times = record.bench.runs.map((r) => r.ms);
      return `${label}: OK, ${times.length} searches, median ${quantile(times, 0.5).toFixed(1)} ms, ${record.bench.runs[0].files} files, ${record.bench.runs[0].matches} matches`;
    }
    if (record.kind === 'typing') {
      const e2e = summarizeWithPercentiles(record.bench.e2e_ms);
      return `${label}: OK, ${record.bench.e2e_ms.length} samples, e2e p50 ${e2e.p50} ms, p95 ${e2e.p95} ms`;
    }
    const ready = record.marks.find((m) => m.mark === 'ready');
    const last = record.samples[record.samples.length - 1].memory;
    const disagree =
      record.attribution_final && !record.attribution_final.agree
        ? ', ATTRIBUTION CHECK DISAGREES'
        : '';
    return `${label}: OK, ready ${Math.round(ready.script_ms)} ms, total memory ${(last.total_bytes / MB).toFixed(1)} MB${disagree}`;
  }
  return `${label}: ${record.status.toUpperCase()}: ${record.reason}`;
}

// ---------- results ----------

const startupMarks = [
  'frontend-init',
  'doc-loaded',
  'first-preview-painted',
  'ready',
  'prefs-ready',
];

function firstMark(record, name) {
  return record.marks.find((m) => m.mark === name) ?? null;
}

function computeStats(raw) {
  const stats = { memory: {}, startup: {}, typing: {}, runs: {}, checks: {} };
  for (const id of raw.parameters.scenario_ids) {
    if (SCENARIOS[id].search_bench) {
      const okRuns = raw.attempts.filter(
        (a) => a.kind === 'search' && a.scenario === id && a.status === 'ok',
      );
      const searches = okRuns.flatMap((a) => a.bench.runs);
      stats.search ??= {};
      stats.search[id] = {
        runs: okRuns.length,
        ms: summarize(searches.map((r) => r.ms)),
        first_search_ms: summarize(okRuns.map((a) => a.bench.runs[0].ms)),
        file_counts: [...new Set(searches.map((r) => r.files))],
        match_counts: [...new Set(searches.map((r) => r.matches))],
        cap_hit: searches.some((r) => r.truncated),
        cap_hit_all: searches.length > 0 && searches.every((r) => r.truncated),
        expected_lantern_lines:
          SCENARIOS[id].expected_matches === undefined
            ? (raw.documents[`folder-${SCENARIOS[id].session_folder}`]?.lantern_lines ?? null)
            : null,
        expected_matches: SCENARIOS[id].expected_matches ?? null,
      };
      const all = raw.attempts.filter((a) => a.kind === 'search' && a.scenario === id);
      stats.runs[id] = {
        planned: raw.parameters.runs,
        valid: okRuns.length,
        attempts: all.length,
        invalid: all.filter((a) => a.status === 'invalid').length,
        failed: all.filter((a) => a.status === 'failed').length,
      };
      continue;
    }
    const ok = raw.attempts.filter(
      (a) => a.kind === 'standard' && a.scenario === id && a.status === 'ok',
    );
    const memory = ok.map((a) => memoryOf(a.samples[a.samples.length - 1].processes));
    const toMb = (bytes) => bytes / MB;
    stats.memory[id] = {
      n: ok.length,
      per_run_total_mb: memory.map((m) => toMb(m.total_bytes)),
      total_mb: summarize(memory.map((m) => toMb(m.total_bytes))),
      peak_sum_mb: summarize(memory.map((m) => toMb(m.peak_sum_bytes))),
      by_role_mb: Object.fromEntries(
        ROLES.map((role) => [role, summarize(memory.map((m) => toMb(m.by_role_bytes[role] ?? 0)))]),
      ),
    };
    const ready = ok.map((a) => firstMark(a, 'ready'));
    stats.startup[id] = {
      n: ok.length,
      spawn_to_ready_script_ms: summarize(ready.map((m) => m.script_ms)),
      outside_app_clock_ms: summarize(ready.map((m) => m.script_ms - m.app_ms)),
      app_marks_ms: Object.fromEntries(
        startupMarks.map((name) => [
          name,
          summarize(ok.map((a) => firstMark(a, name)?.app_ms ?? Number.NaN)),
        ]),
      ),
      prefs_ready_script_ms: summarize(
        ok.map((a) => firstMark(a, 'prefs-ready')?.script_ms ?? Number.NaN),
      ),
    };
    const typing = raw.attempts.filter(
      (a) => a.kind === 'typing' && a.scenario === id && a.status === 'ok',
    );
    if (typing.length > 0 || SCENARIOS[id].typing) {
      const render = typing.flatMap((a) => a.bench.render_ms);
      const e2e = typing.flatMap((a) => a.bench.e2e_ms);
      stats.typing[id] = {
        runs: typing.length,
        per_run: typing.map((a) => ({
          run: a.run,
          samples: a.bench.e2e_ms.length,
          e2e_p50: quantile(a.bench.e2e_ms.filter(Number.isFinite), 0.5),
          e2e_p95: quantile(a.bench.e2e_ms.filter(Number.isFinite), 0.95),
        })),
        doc_bytes: typing.map((a) => a.bench.doc_bytes),
        samples: e2e.filter(Number.isFinite).length,
        samples_dropped_not_finite:
          render.length +
          e2e.length -
          render.filter(Number.isFinite).length -
          e2e.filter(Number.isFinite).length,
        render_ms: summarizeWithPercentiles(render),
        e2e_ms: summarizeWithPercentiles(e2e),
        incomplete_runs: typing.filter((a) => a.bench.e2e_ms.length < BENCH_INSERTIONS).length,
      };
    }
    if (SCENARIOS[id].idle_s) {
      stats.idle ??= {};
      stats.idle[id] = {
        window_s: SCENARIOS[id].idle_s,
        cpu_ms_total: summarize(ok.map((a) => a.idle?.cpu_ms_total ?? Number.NaN)),
      };
    }
    const all = raw.attempts.filter((a) => a.kind === 'standard' && a.scenario === id);
    stats.runs[id] = {
      planned: raw.parameters.runs,
      valid: ok.length,
      attempts: all.length,
      invalid: all.filter((a) => a.status === 'invalid').length,
      failed: all.filter((a) => a.status === 'failed').length,
    };
  }

  const standardOk = raw.attempts.filter((a) => a.kind === 'standard' && a.status === 'ok');
  const checked = standardOk.filter((a) => a.attribution_final);
  stats.checks = {
    ok_runs: standardOk.length,
    cross_check_agree_at_ready: standardOk.filter((a) => a.attribution_at_ready?.agree).length,
    cross_check_agree_at_last_sample: checked.filter((a) => a.attribution_final.agree).length,
    helper_counts_match: checked.filter((a) => a.attribution_final.helper_counts_match).length,
    bases: [...new Set(checked.flatMap((a) => a.attribution_final.bases))].sort(),
    non_webkit_attributed_runs: checked.filter(
      (a) => a.attribution_final.non_webkit_attributed.length > 0,
    ).length,
    memstat_caveat_runs: standardOk.filter((a) => a.samples.some((s) => s.exit_code === 4)).length,
    settle_over_limit_runs: standardOk.filter(
      (a) => a.settle.spread_share_of_last > SETTLE_SPREAD_LIMIT,
    ).length,
    settle_largest_spread: standardOk.reduce(
      (max, a) => Math.max(max, a.settle.spread_share_of_last),
      0,
    ),
    leftover_helper_runs: raw.attempts.filter((a) => a.cleanup?.leftover_helpers?.length > 0)
      .length,
    helpers_gone_ms: summarize(
      raw.attempts
        .filter((a) => a.kind === 'standard' && a.cleanup?.method !== 'exited-by-itself')
        .map((a) => a.cleanup?.helpers_gone_ms ?? Number.NaN),
    ),
    load_avg_1m: summarize(standardOk.map((a) => a.load_avg_1m)),
  };
  return stats;
}

function planComplete(raw) {
  const missing = [];
  for (const id of raw.parameters.scenario_ids) {
    const runKind = SCENARIOS[id].search_bench ? 'search' : 'standard';
    const valid = raw.attempts.filter(
      (a) => a.kind === runKind && a.scenario === id && a.status === 'ok',
    ).length;
    if (valid < raw.parameters.runs)
      missing.push(`${id}: ${valid} of ${raw.parameters.runs} valid runs`);
    if (SCENARIOS[id].typing && raw.parameters.typing_runs > 0) {
      const typing = raw.attempts.filter(
        (a) => a.kind === 'typing' && a.scenario === id && a.status === 'ok',
      ).length;
      if (typing < raw.parameters.typing_runs) {
        missing.push(`${id} typing: ${typing} of ${raw.parameters.typing_runs} valid runs`);
      }
    }
  }
  return missing;
}

// ---------- Markdown summary ----------

function fixed(value, digits) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'n/a'
    : value.toFixed(digits);
}

function range(stat, digits) {
  if (!stat || stat.n === 0) return 'n/a';
  return `${fixed(stat.median, digits)} (${fixed(stat.min, digits)} to ${fixed(stat.max, digits)})`;
}

/** "10 (4 Performance and 6 Efficiency)" becomes "10 cores (4 Performance and 6 Efficiency)". */
function describeCores(host) {
  const match = host.core_description?.match(/^(\d+)\s*(\(.*\))?$/);
  if (!match) return `${host.cpu_count} cores`;
  return `${match[1]} cores${match[2] ? ` ${match[2]}` : ''}`;
}

function buildSummary(raw) {
  const s = raw.stats;
  const ids = raw.parameters.scenario_ids;
  const missing = planComplete(raw);
  const status =
    raw.status === 'complete'
      ? missing.length === 0
        ? 'COMPLETE: every planned run has a valid result.'
        : `PARTIAL: ${missing.join('; ')}.`
      : `${raw.status.toUpperCase()}. ${missing.length ? `Missing: ${missing.join('; ')}.` : ''}`;
  const lines = [];
  const add = (text = '') => lines.push(text);

  // The title follows --label: phase-1 gives "Phase 1".
  const label = basename(raw.files.summary).replace(/-summary\.md$/, '');
  add(`# ${label.replace(/^phase-(\d+)$/, 'Phase $1')} measurements: summary`);
  add();
  add(`Status: ${status}`);
  if (raw.status === 'stopped: screen locked') {
    add();
    add(
      'The full measurement is PENDING an unlocked screen: the harness stopped because the screen stayed locked. ' +
        'Only valid runs below are results; nothing from an invalid run is reported as a number.',
    );
  }
  add();
  add(`- Measured: ${raw.started_at_local} to ${raw.finished_at_local}`);
  add(`- Command: \`${raw.parameters.command}\``);
  add(
    `- Machine: ${raw.host.model_name ?? 'Mac'} ${raw.host.model} (${raw.host.chip}, ${describeCores(raw.host)}, ` +
      `${fixed(raw.host.memory_bytes / 1024 ** 3, 0)} GB), macOS ${raw.host.macos_version} (${raw.host.macos_build}), ` +
      `${raw.host.power_source}, low power mode ${raw.host.low_power_mode}, ` +
      `system-wide free memory ${raw.host.memory_free_percent ?? 'unknown'}% at the start`,
  );
  add(
    `- App: Backtickle ${raw.app.version}, \`${raw.app.bundle}\`, binary built ${raw.app.binary_mtime}, ` +
      `SHA-256 ${raw.app.binary_sha256.slice(0, 16)}...`,
  );
  add(
    `- Source: commit ${raw.git.commit.slice(0, 12)} on ${raw.git.branch}` +
      `${
        raw.git.dirty
          ? ` (working tree has uncommitted changes: ${raw.git.uncommitted_paths
              .slice(0, 6)
              .map((l) => l.slice(3))
              .join(
                ', ',
              )}${raw.git.uncommitted_paths.length > 6 ? `, and ${raw.git.uncommitted_paths.length - 6} more` : ''})`
          : ''
      }` +
      `${raw.app.build_may_be_stale ? '. WARNING: sources are newer than the built app; rebuild with npm run build:app' : ''}`,
  );
  add(`- Raw data: \`${raw.files.raw}\` (every sample, timestamps, scenario definitions)`);

  add();
  add('## How the numbers were obtained');
  add();
  add(
    `- Each run launches the binary inside \`${raw.app.bundle}\` directly with BACKTICKLE_PERF=1, waits for the ready mark ` +
      `(and prefs-ready in S4), waits ${raw.parameters.settle_s} s, then samples memory ${SAMPLES_PER_RUN} times one second apart. The last sample is the result. Then the app is quit and the next run starts after 2 s. ` +
      'Scenarios take turns (S1, S2, ... then the next round) so slow drift in the machine does not favor one scenario.',
  );
  add(
    '- Memory is `phys_footprint` of each process (the "Memory" column of Activity Monitor), in MB of 1,048,576 bytes. ' +
      '**Total = the app process + the WebContent, GPU and Networking helper processes attributed to that app instance.** ' +
      'The app process alone is never reported as the total.',
  );
  add(
    '- Attribution: helpers are matched through the macOS responsible-process relationship (private API, the same one Activity Monitor uses), see `scripts/memstat.swift`. ' +
      'When the app is started by a script or terminal, as here, it does not hold its own responsibility: it and its helpers inherit the responsible pid of whatever launched them, shared with every other process of that tool. ' +
      "A process is therefore counted only if it has the app's responsible pid, is a WebKit helper and started after the app. " +
      'Each run is cross-checked against the process list: the com.apple.WebKit.* processes that appeared between just before the launch and the sample.',
  );
  add(
    '- Before each run the harness checks that the screen is not locked and the display is awake; a locked screen is waited out (checked every ' +
      `${raw.parameters.lock_poll_s} s, up to ${raw.parameters.lock_wait_min} minutes). ` +
      'Runs with a `page-hidden` mark, a locked or unusable screen, a timeout or an unreadable process are not in any statistic (see "Runs that were not used"); a run with a `page-hidden` mark is repeated, up to 3 more times. ' +
      'Statistics are the median over valid runs, with the minimum and maximum, and n = number of valid runs.',
  );

  // Memory table.
  add();
  add('## Memory');
  add();
  add(
    'Median (minimum to maximum) over valid runs, in MB. Total = app + WebContent + GPU + Networking processes of the app.',
  );
  add();
  // Scenarios without memory statistics (S12, the search benchmark) have no row here.
  const memIds = ids.filter((id) => s.memory[id]);
  const otherUsed = memIds.some((id) => (s.memory[id].by_role_mb.other.max ?? 0) > 0);
  const roleColumns = ROLES.filter((role) => role !== 'other' || otherUsed);
  add(
    `| Scenario | n | ${roleColumns.map((r) => (r === 'other' ? 'Other (not in Total)' : ROLE_LABEL[r])).join(' | ')} | **Total** | Peak (sum of per-process lifetime maxima) |`,
  );
  add(`|---|---|${roleColumns.map(() => '---').join('|')}|---|---|`);
  for (const id of memIds) {
    const m = s.memory[id];
    const cells = roleColumns.map((role) => range(m.by_role_mb[role], 1));
    const total =
      m.total_mb.n === 0
        ? 'no valid run'
        : `**${fixed(m.total_mb.median, 1)}** (${fixed(m.total_mb.min, 1)} to ${fixed(m.total_mb.max, 1)})`;
    add(
      `| ${id} ${SCENARIOS[id].name} | ${m.n} | ${cells.join(' | ')} | ${total} | ${range(m.peak_sum_mb, 1)} |`,
    );
  }
  add();
  add(
    'The per-process columns are medians of each process role; they need not add up exactly to the median of the total. ' +
      'In S4 the WebContent column is the sum of two processes (main window and Preferences window). ' +
      'The peak column adds up the highest footprint each process has reached since it started (kernel lifetime maximum). The processes need not have peaked at the same moment, so it is an upper bound on the true combined peak, and it includes the startup spike.',
  );
  add();
  add('Totals of each valid run, in MB, in run order:');
  add();
  for (const id of memIds) {
    add(
      `- ${id}: ${s.memory[id].per_run_total_mb.map((v) => fixed(v, 1)).join(', ') || 'no valid run'}`,
    );
  }
  if (s.memory.S2?.total_mb.n && s.memory.S13?.total_mb.n) {
    const diff = s.memory.S13.total_mb.median - s.memory.S2.total_mb.median;
    add();
    add(
      `Accessibility features (S13 minus S2, median totals): ${diff >= 0 ? '+' : '-'}${fixed(Math.abs(diff), 1)} MB ` +
        `(S2 ${fixed(s.memory.S2.total_mb.median, 1)} MB, S13 ${fixed(s.memory.S13.total_mb.median, 1)} MB).`,
    );
  }

  // Startup table.
  add();
  add('## Startup time');
  add();
  add(
    'Median (minimum to maximum) over the same valid runs, in milliseconds, rounded to whole milliseconds. ' +
      '"Spawn to ready" is the harness clock from just before the process was created until the ready line arrived. ' +
      'The other marks are the app clock, which starts at the top of the Rust `run()` function, so process creation and dynamic loading are not in them. ' +
      '"Outside the app clock" is the difference per run (spawn to ready minus the app ready mark).',
  );
  add();
  add(
    '| Scenario | n | Spawn to ready | Outside the app clock | frontend-init | doc-loaded | first-preview-painted | ready (app clock) | prefs-ready (app clock) |',
  );
  add('|---|---|---|---|---|---|---|---|---|');
  for (const id of memIds) {
    const t = s.startup[id];
    const mark = (name) => range(t.app_marks_ms[name], 0);
    add(
      `| ${id} ${SCENARIOS[id].name} | ${t.n} | ${t.n === 0 ? 'no valid run' : `**${range(t.spawn_to_ready_script_ms, 0)}**`} | ${range(t.outside_app_clock_ms, 0)} | ` +
        `${mark('frontend-init')} | ${mark('doc-loaded')} | ${mark('first-preview-painted')} | ${mark('ready')} | ${mark('prefs-ready')} |`,
    );
  }
  add();
  add(
    'n/a means the app does not print that mark in this scenario (the welcome screen loads no document and no editor). ' +
      'The window is shown by a direct launch of the binary, not through Finder or the Dock, so LaunchServices and Gatekeeper checks are not included. ' +
      'The file cache is warm: the same binary and files were used a moment earlier. A truly cold start needs `sudo purge`, which was not run.',
  );

  // Search table.
  if (s.search) {
    add();
    add('## Search time');
    add();
    add(
      "Milliseconds from the `searchFolder` call to its result, for the Search tab's search (case-insensitive, no regex) in the open folder; the app runs it 5 times in a row after ready, each after the previous result. n is the number of searches in valid runs. Median (minimum to maximum).",
    );
    add();
    add(
      '| Scenario | runs | n | search time (ms) | first search of a run (ms) | files | matches | match cap (1,000) hit | lantern lines in the folder |',
    );
    add('|---|---|---|---|---|---|---|---|---|');
    for (const [id, x] of Object.entries(s.search)) {
      const cap = x.cap_hit ? (x.cap_hit_all ? 'yes, every search' : 'yes, some searches') : 'no';
      add(
        `| ${id} ${SCENARIOS[id].name} | ${x.runs} | ${x.ms.n} | ${range(x.ms, 1)} | ${range(x.first_search_ms, 1)} | ${x.file_counts.join(', ') || 'n/a'} | ${x.match_counts.join(', ') || 'n/a'} | ${cap} | ${x.expected_lantern_lines ?? 'n/a'} |`,
      );
    }
    add();
    for (const [id, x] of Object.entries(s.search)) {
      const lines = x.expected_lantern_lines;
      const counts = x.match_counts;
      if (counts.length === 0) continue;
      if (x.expected_matches !== null) {
        add(
          `${id}: reported matches ${counts.join(', ')} against the expected ${x.expected_matches} (the query never occurs in the folder; ${counts.length === 1 && counts[0] === x.expected_matches ? 'equal' : 'DIFFERENT, check the search'}).${x.cap_hit ? ' The match cap was hit, which is unexpected.' : ''}`,
        );
        continue;
      }
      if (lines == null) continue;
      if (x.cap_hit) {
        add(
          `${id}: the search stops at 1,000 matches; the folder has ${lines} lantern lines, so ${lines > 1000 ? 'the cap is expected' : 'a cap hit is unexpected'}. Reported matches: ${counts.join(', ')}.`,
        );
      } else {
        add(
          `${id}: reported matches ${counts.join(', ')} against ${lines} lantern lines in the folder (${counts.length === 1 && counts[0] === lines ? 'equal' : 'DIFFERENT, check the search'}).`,
        );
      }
    }
  }

  // Idle CPU table.
  if (s.idle) {
    add();
    add('## Idle CPU time');
    add();
    add(
      'CPU time (user plus system) used by the app and its attributed helper processes over the window below, with no input, read with `ps -o time=` before and after (resolution 10 ms per process). The window starts after the settle samples. Median (minimum to maximum) over valid runs.',
    );
    add();
    add('| Scenario | n | Window (s) | CPU time (ms) |');
    add('|---|---|---|---|');
    for (const [id, idle] of Object.entries(s.idle)) {
      add(
        `| ${id} ${SCENARIOS[id].name} | ${idle.cpu_ms_total.n} | ${idle.window_s} | ${range(idle.cpu_ms_total, 0)} |`,
      );
    }
  }

  // Typing table.
  add();
  add('## Delay from keystroke to preview');
  add();
  add(
    `The benchmark types ${BENCH_INSERTIONS} characters into the middle of the document, one every 150 ms, and records for each one render_ms ` +
      '(parse, sanitize and patch of the preview update that picked it up) and e2e_ms (from the keystroke until that update was drawn; it includes the 120 ms debounce and two frames, so the floor is roughly 130 to 149 ms). ' +
      'Values are whole milliseconds because WebKit rounds its clock. n is the number of keystrokes (samples) in valid typing runs. ' +
      'Percentiles use linear interpolation between order statistics (the default of R `quantile`, type 7); p50 is the median. ' +
      'When an update takes longer than the typing interval, keystrokes share one update, so samples are not independent.',
  );
  add();
  add(
    '| Scenario | Document (bytes) | Valid runs | n (samples) | render_ms p50 | render_ms p95 | render_ms min to max | e2e_ms p50 | e2e_ms p95 | e2e_ms min to max |',
  );
  add('|---|---|---|---|---|---|---|---|---|---|');
  const typingIds = ids.filter((id) => SCENARIOS[id].typing);
  if (raw.parameters.typing_runs === 0) {
    add('| (typing benchmark skipped with --typing-runs 0) | | | | | | | | | |');
  }
  for (const id of raw.parameters.typing_runs === 0 ? [] : typingIds) {
    const t = s.typing[id];
    if (!t || t.runs === 0) {
      add(`| ${id} ${SCENARIOS[id].name} | n/a | 0 | 0 | no valid run | | | | | |`);
      continue;
    }
    const spread = (stat) => `${fixed(stat.min, 0)} to ${fixed(stat.max, 0)}`;
    add(
      `| ${id} ${SCENARIOS[id].name} | ${[...new Set(t.doc_bytes)].join(', ')} | ${t.runs} | ${t.samples} | ${fixed(t.render_ms.p50, 1)} | ${fixed(t.render_ms.p95, 1)} | ${spread(t.render_ms)} | ` +
        `**${fixed(t.e2e_ms.p50, 1)}** | **${fixed(t.e2e_ms.p95, 1)}** | ${spread(t.e2e_ms)} |`,
    );
  }
  if (typingIds.length === 0 && raw.parameters.typing_runs > 0) {
    add('| (no typing scenario selected) | | | | | | | | | |');
  }
  const incomplete = typingIds.filter((id) => s.typing[id]?.incomplete_runs > 0);
  add();
  add(
    incomplete.length > 0
      ? `Incomplete benchmark (fewer than ${BENCH_INSERTIONS} samples) in: ${incomplete.join(', ')}.`
      : `Every valid typing run delivered all ${BENCH_INSERTIONS} samples.`,
  );
  if (raw.parameters.typing_runs > 0 && typingIds.some((id) => s.typing[id]?.runs > 0)) {
    add();
    add('Each typing run on its own, e2e_ms p50 / p95 in ms, in run order:');
    add();
    for (const id of typingIds) {
      const runs = s.typing[id]?.per_run ?? [];
      add(
        `- ${id}: ${runs.map((r) => `${fixed(r.e2e_p50, 0)} / ${fixed(r.e2e_p95, 0)}`).join(', ') || 'no valid run'}`,
      );
    }
    const hz = raw.host.display_refresh_hz;
    const frameMs = hz ? 1000 / hz : null;
    const frames = frameMs ? BENCH_INTERVAL_MS / frameMs : null;
    const aliased = frames !== null && Math.abs(frames - Math.round(frames)) < 0.05;
    // A spread of more than half a frame, and more than 5% of the value: slower scenarios vary a
    // few percent from run to run anyway, and that is not the frame effect.
    const wide = typingIds.filter((id) => {
      const p50s = (s.typing[id]?.per_run ?? []).map((r) => r.e2e_p50);
      if (p50s.length < 2) return false;
      const spread = Math.max(...p50s) - Math.min(...p50s);
      return spread > (frameMs ?? 16) / 2 && spread > 0.05 * quantile(p50s, 0.5);
    });
    add();
    if (hz) {
      add(
        `The main display runs at ${hz} Hz, one frame every ${fixed(frameMs, 1)} ms. ` +
          (aliased
            ? `The typing interval of ${BENCH_INTERVAL_MS} ms is ${Math.round(frames)} whole frames, so within one run each keystroke keeps nearly the same position relative to the display frames. ` +
              'The e2e values then fall into groups about one frame apart, and which group holds most samples differs from run to run: the p50 of one run can move by about one frame without any change in the app. ' +
              'The p95 and the maximum are much less affected, and render_ms is not affected. ' +
              (raw.parameters.typing_runs > 1
                ? `${raw.parameters.typing_runs} runs per scenario are pooled in the table above so that both groups are represented.`
                : 'With one run per scenario the p50 is therefore not a stable figure; use --typing-runs 5 or more to pool several runs.')
            : `The typing interval of ${BENCH_INTERVAL_MS} ms is not a whole number of frames, so the keystrokes sweep across the frame phase.`),
      );
    }
    if (wide.length > 0) {
      add();
      add(
        `**The e2e_ms p50 differs by more than half a frame between runs of ${wide.join(', ')}.** Compare builds on the p95 and the range, not on the p50 of a single run.`,
      );
    }
  }

  // Runs that were not used.
  add();
  add('## Runs that were not used');
  add();
  const unused = raw.attempts.filter((a) => a.status !== 'ok');
  if (unused.length === 0) {
    add('None: every attempt was valid.');
  } else {
    add(
      `${unused.length} attempt(s) are excluded from all statistics. Invalid attempts are repeated up to ${MAX_RETRIES} times; failed attempts are not.`,
    );
    add();
    for (const a of unused) {
      add(
        `- ${a.scenario} ${a.kind === 'typing' ? 'typing run' : a.kind === 'search' ? 'search run' : 'run'} ${a.run}, attempt ${a.attempt} (${a.spawn_wall ?? 'not started'}): ${a.status.toUpperCase()}: ${a.reason}`,
      );
    }
  }
  if (raw.stop_reason) add(`\nThe harness stopped early: ${raw.stop_reason}.`);

  // Checks.
  add();
  add('## Checks on the measurement itself');
  add();
  const c = s.checks;
  add(
    `- Valid standard runs: ${c.ok_runs}. Process-list cross-check agreed with the responsible-pid result in ${c.cross_check_agree_at_ready} of ${c.ok_runs} runs at the ready mark and in ${c.cross_check_agree_at_last_sample} of ${c.ok_runs} at the last sample.`,
  );
  const disagreements = raw.attempts.filter(
    (a) =>
      a.status === 'ok' &&
      a.kind === 'standard' &&
      ((a.attribution_at_ready && !a.attribution_at_ready.agree) ||
        (a.attribution_final && !a.attribution_final.agree)),
  );
  if (disagreements.length > 0) {
    add(
      '- **Attribution disagreements (kept in the statistics, flagged here; both pid sets are in the raw JSON):**',
    );
    for (const a of disagreements) {
      const f = a.attribution_final ?? a.attribution_at_ready;
      add(
        `  - ${a.scenario} run ${a.run}: responsible-pid method [${f.responsible_pid_method.join(', ')}], process-list difference [${f.process_list_difference.join(', ')}]`,
      );
    }
  }
  add(
    `- Helper counts matched the expected set (1 each of WebContent, GPU and Networking; 2 WebContent in S4) in ${c.helper_counts_match} of ${c.ok_runs} runs.`,
  );
  add(
    `- Attribution rule used (see scripts/memstat.swift): ${c.bases.join(', ') || 'n/a'}. Runs in which a non-WebKit process was attributed as well (listed outside the total): ${c.non_webkit_attributed_runs}. Runs where memstat reported caveats (exit code 4): ${c.memstat_caveat_runs}.`,
  );
  add(
    `- Settling: the three samples of a run differ by at most ${fixed(c.settle_largest_spread * 100, 2)}% of the last total (largest over all runs); ${c.settle_over_limit_runs} run(s) exceeded ${SETTLE_SPREAD_LIMIT * 100}%.`,
  );
  add(
    `- Cleanup: helper processes were gone ${range(c.helpers_gone_ms, 0)} ms (median, minimum to maximum) after the quit began; runs with helpers still alive after ${HELPERS_GONE_TIMEOUT_MS / 1000} s: ${c.leftover_helper_runs}.`,
  );
  add(
    `- Background load: 1-minute load average at the start of valid runs ${range(c.load_avg_1m, 2)}.`,
  );
  add(
    `- The harness held \`caffeinate -di\` for its whole duration: ${raw.caffeinate.assertion_seen ? 'the assertion was seen in pmset' : 'started, but the assertion was not confirmed in pmset'}.`,
  );

  add();
  add('## Limits of these numbers');
  add();
  add(
    `- Memory is read ${raw.parameters.settle_s} s after the window is ready, with nothing typed: a plateau reached a few seconds after ready, not the worst case. ` +
      'WebKit keeps releasing memory in small steps for some tens of seconds afterwards, so a later reading is a little lower. The peak column shows how high the startup went; unlike the steady-state totals it depends on timing during startup (garbage collection against whatever else the machine is doing) and can differ by several percent between otherwise identical launches at different times. The settle time is a protocol choice (option --settle); compare like with like.',
  );
  add(
    raw.parameters.typing_runs === 1
      ? '- Typing results come from one run per scenario (60 samples from one process), so run-to-run variation of the typing delay is not measured.'
      : `- Typing results pool ${raw.parameters.typing_runs} runs per scenario.`,
  );
  add(
    '- `phys_footprint` is what the operating system charges to a process. Memory shared between processes or held by the GPU driver is counted by the kernel according to its own rules, so the total is the Activity Monitor view, not a count of distinct physical pages.',
  );
  add(
    '- One window per scenario; the cost of further windows or tabs is not part of these scenarios.',
  );
  add();
  return `${lines.join('\n')}\n`;
}

// ---------- environment record ----------

async function collectHost() {
  const [version, build, chip, model, memsize, ncpu, batt, pmset, therm, pressure, hardware] =
    await Promise.all([
      output('/usr/bin/sw_vers', ['-productVersion']),
      output('/usr/bin/sw_vers', ['-buildVersion']),
      output('/usr/sbin/sysctl', ['-n', 'machdep.cpu.brand_string']),
      output('/usr/sbin/sysctl', ['-n', 'hw.model']),
      output('/usr/sbin/sysctl', ['-n', 'hw.memsize']),
      output('/usr/sbin/sysctl', ['-n', 'hw.ncpu']),
      output('/usr/bin/pmset', ['-g', 'batt']),
      output('/usr/bin/pmset', ['-g']),
      output('/usr/bin/pmset', ['-g', 'therm']),
      output('/usr/bin/memory_pressure', ['-Q']),
      output('/usr/sbin/system_profiler', ['SPHardwareDataType']),
    ]);
  // Only the two descriptive lines are kept: that report also holds the serial number and UUID.
  const modelName = hardware?.match(/^\s*Model Name:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const cores = hardware?.match(/^\s*Total Number of Cores:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const source = batt?.match(/Now drawing from '([^']+)'/)?.[1] ?? 'power source unknown';
  return {
    macos_version: version,
    macos_build: build,
    chip,
    model,
    model_name: modelName,
    core_description: cores,
    memory_bytes: Number(memsize),
    cpu_count: Number(ncpu),
    power_source: source,
    low_power_mode: pmset?.match(/lowpowermode\s+(\d)/)?.[1] === '1' ? 'on' : 'off',
    thermal_notes: therm ? therm.split('\n').slice(0, 3) : null,
    memory_free_percent:
      Number(pressure?.match(/free percentage:\s*(\d+)%/)?.[1] ?? Number.NaN) || null,
    node: process.version,
    arch: process.arch,
  };
}

async function collectGit() {
  const git = (...args) => output('git', ['-C', repoRoot, ...args]);
  // Not through `output`: it trims, and the first status line starts with a space.
  const status = (await exec('git', ['-C', repoRoot, 'status', '--porcelain'])).stdout.trimEnd();
  return {
    commit: (await git('rev-parse', 'HEAD')) ?? 'unknown',
    branch: (await git('rev-parse', '--abbrev-ref', 'HEAD')) ?? 'unknown',
    commit_date: await git('log', '-1', '--format=%cI'),
    dirty: status.length > 0,
    uncommitted_paths: status.split('\n').filter(Boolean).slice(0, 40),
  };
}

function newestSourceChange() {
  const skip = new Set(['node_modules', 'target', 'gen', '.DS_Store', '.git']);
  let newest = { mtimeMs: 0, path: null };
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) if (!skip.has(entry)) visit(join(path, entry));
    } else if (stat.mtimeMs > newest.mtimeMs) {
      newest = { mtimeMs: stat.mtimeMs, path };
    }
  };
  for (const entry of [
    'src',
    'src-tauri',
    'index.html',
    'preferences.html',
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'svelte.config.js',
    'tests/fixtures/perf/wireframe-sample-phase0.md',
  ]) {
    const path = join(repoRoot, entry);
    if (existsSync(path)) visit(path);
  }
  return newest;
}

function collectApp(options) {
  const bundle = resolve(repoRoot, options.app);
  const binary = join(bundle, 'Contents', 'MacOS', 'backtickle');
  if (!existsSync(binary)) {
    throw new Error(
      `The built app was not found at ${shortPath(binary)}.\nBuild it first with: npm run build:app`,
    );
  }
  const plist = join(bundle, 'Contents', 'Info.plist');
  const version = existsSync(plist)
    ? (readFileSync(plist, 'utf8').match(
        /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/,
      )?.[1] ?? 'unknown')
    : 'unknown';
  const stat = statSync(binary);
  const newest = newestSourceChange();
  return {
    bundle: shortPath(bundle),
    binary,
    version,
    binary_mtime: localIso(stat.mtime),
    binary_sha256: sha256File(binary),
    newest_source_change: newest.path
      ? {
          path: relative(repoRoot, newest.path),
          mtime: localIso(new Date(newest.mtimeMs)),
        }
      : null,
    build_may_be_stale: newest.mtimeMs > stat.mtimeMs,
  };
}

function prepareDocuments(ids) {
  const documents = {};
  // The Phase 0 sample, kept unchanged so that S5 stays comparable with the baseline.
  const sample = join(repoRoot, 'tests', 'fixtures', 'perf', 'wireframe-sample-phase0.md');
  if (!existsSync(sample)) {
    throw new Error('tests/fixtures/perf/wireframe-sample-phase0.md is missing');
  }
  documents['wireframe-sample'] = {
    absolute: sample,
    path: relative(repoRoot, sample),
    bytes: statSync(sample).size,
    sha256: sha256File(sample),
    generated: false,
  };
  const needed = new Set(ids.map((id) => SCENARIOS[id].doc).filter(Boolean));
  for (const key of Object.keys(DOC_SIZES)) {
    if (!needed.has(key)) continue;
    const info = ensureDocument(key);
    documents[`large-${key}`] = {
      absolute: info.path,
      path: relative(repoRoot, info.path),
      bytes: info.bytes,
      sha256: info.sha256,
      lines: info.lines,
      generated: true,
      generator: 'scripts/gen-large-doc.mjs',
      file_action: info.action,
    };
  }
  for (const n of new Set(ids.map((id) => SCENARIOS[id].session_folder).filter(Boolean))) {
    documents[`folder-${n}`] = folderDocument(n);
  }
  for (const id of ids) {
    const file = SCENARIOS[id].flavor_file;
    if (!file) continue;
    let absolute = join(FLAVOR_DIR, file);
    if (!existsSync(absolute)) {
      generateFlavorDocs();
      absolute = join(FLAVOR_DIR, file);
    }
    documents[`flavor-${id.toLowerCase()}`] = {
      absolute,
      path: relative(repoRoot, absolute),
      bytes: statSync(absolute).size,
      sha256: sha256File(absolute),
      generated: true,
      generator: 'scripts/gen-flavor-perf.mjs',
    };
  }
  return documents;
}

function describeScenarios(ids, documents) {
  return Object.fromEntries(
    ids.map((id) => {
      const scenario = SCENARIOS[id];
      return [
        id,
        {
          name: scenario.name,
          args: scenario.args.map((arg) => {
            const match = arg.match(/^\{(.*)\}$/);
            return match ? documents[match[1]].path : arg;
          }),
          env: {
            BACKTICKLE_PERF: '1',
            BACKTICKLE_CONFIG_DIR: '<temporary folder per run>',
          },
          typing_env: {
            BACKTICKLE_PERF: '1',
            BACKTICKLE_BENCH: 'typing',
            BACKTICKLE_BENCH_EXIT: '1',
            BACKTICKLE_CONFIG_DIR: '<temporary folder per run>',
          },
          wait_for_marks: scenario.ready,
          expected_helper_counts: scenario.expected_helpers,
          document: scenario.doc
            ? documents[`large-${scenario.doc}`].path
            : scenario.flavor_file
              ? documents[`flavor-${id.toLowerCase()}`].path
              : null,
          typing_benchmark: Boolean(scenario.typing),
          search_benchmark: scenario.search_bench
            ? {
                env: {
                  BACKTICKLE_PERF: '1',
                  BACKTICKLE_BENCH: 'search',
                  BACKTICKLE_BENCH_QUERY: scenario.query,
                  BACKTICKLE_BENCH_EXIT: '1',
                },
                searches_per_run: SEARCH_RUNS,
              }
            : null,
          session_seed: scenario.session_folder
            ? {
                folder: documents[`folder-${scenario.session_folder}`].path,
                sidebar_tab: 'files',
                expanded_count: documents[`folder-${scenario.session_folder}`].expanded.length,
              }
            : null,
          idle_window_s: scenario.idle_s ?? null,
        },
      ];
    }),
  );
}

function startCaffeinate() {
  caffeinateChild = spawn('/usr/bin/caffeinate', ['-d', '-i', '-w', String(process.pid)], {
    stdio: 'ignore',
  });
  caffeinateChild.on('error', () => {
    caffeinateChild = null;
  });
  caffeinateChild.unref();
}

async function caffeinateAssertionSeen() {
  await hardSleep(300);
  const assertions = await output('/usr/bin/pmset', ['-g', 'assertions']);
  return Boolean(
    assertions &&
      /caffeinate/.test(assertions) &&
      /PreventUserIdleDisplaySleep\s+1/.test(assertions),
  );
}

// ---------- main ----------

async function main() {
  if (process.platform !== 'darwin') throw new Error('The harness only runs on macOS.');
  const options = parseArguments(process.argv.slice(2));
  const outDir = resolve(repoRoot, options.outDir);

  const app = collectApp(options);
  const strangers = await otherBacktickleInstances(process.pid);
  if (strangers.length > 0) {
    throw new Error(
      `Another Backtickle instance is already running (pid ${strangers.map((p) => p.pid).join(', ')}). ` +
        'A measurement would be wrong. Quit it first (for example: pkill -x backtickle), then start again.',
    );
  }
  await ensureMemstat(options);
  const documents = prepareDocuments(options.scenarioIds);
  const [host, git] = await Promise.all([collectHost(), collectGit()]);
  if (app.build_may_be_stale) {
    log(
      `WARNING: ${app.newest_source_change.path} is newer than the built app. Run npm run build:app, or the numbers describe an old build.`,
    );
  }

  const harnessFiles = Object.fromEntries(
    ['measure.mjs', 'memstat.swift', 'gen-large-doc.mjs', 'gen-folder.mjs'].map((name) => [
      `scripts/${name}`,
      sha256File(join(here, name)),
    ]),
  );

  startCaffeinate();
  const caffeinate = {
    started: Boolean(caffeinateChild),
    assertion_seen: await caffeinateAssertionSeen(),
  };

  const raw = {
    schema: 'backtickle-perf-raw/1',
    status: 'running',
    stop_reason: null,
    started_at: startedAt.toISOString(),
    started_at_local: localIso(startedAt),
    finished_at: null,
    finished_at_local: null,
    host,
    app: { ...app, binary: undefined },
    git,
    harness_files: harnessFiles,
    caffeinate,
    files: {
      raw: shortPath(join(outDir, `${options.label}-raw.json`)),
      summary: shortPath(join(outDir, `${options.label}-summary.md`)),
    },
    parameters: {
      runs: options.runs,
      settle_s: options.settle,
      samples_per_run: SAMPLES_PER_RUN,
      sample_interval_ms: SAMPLE_INTERVAL_MS,
      ready_timeout_s: options.readyTimeout,
      typing_timeout_s: options.typingTimeout,
      typing_runs: options.typingRuns,
      max_retries_per_run: MAX_RETRIES,
      retry_cooldown_s: options.retryCooldown,
      pause_after_run_s: PAUSE_AFTER_RUN_MS / 1000,
      lock_poll_s: options.lockPoll,
      lock_wait_min: options.lockWait,
      command: ['node', 'scripts/measure.mjs', ...process.argv.slice(2)].join(' '),
      scenario_ids: options.scenarioIds,
      memory_unit: 'MB = 1,048,576 bytes',
      percentile_method: 'linear interpolation between order statistics (R quantile type 7)',
      memstat: memstatPath === join(here, '.bin', 'memstat') ? 'scripts/.bin/memstat' : memstatPath,
    },
    scenarios: describeScenarios(options.scenarioIds, documents),
    documents: Object.fromEntries(
      Object.entries(documents).map(([key, d]) => [key, { ...d, absolute: undefined }]),
    ),
    attempts: [],
    stats: null,
  };

  const write = () => {
    raw.stats = computeStats(raw);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${options.label}-raw.json`), `${JSON.stringify(raw, null, 2)}\n`);
  };
  const ctx = {
    binary: app.binary,
    documents,
    attempts: raw.attempts,
    checkpoint: () => {
      try {
        write();
      } catch (error) {
        log(`Could not write the checkpoint: ${error.message}`);
      }
    },
  };

  log(
    `Measuring ${options.scenarioIds.join(', ')}: ${options.runs} run(s) each, settle ${options.settle} s, ` +
      `typing runs ${options.typingRuns}. App ${app.version}, commit ${git.commit.slice(0, 10)}${git.dirty ? ' (dirty)' : ''}.`,
  );
  const display = await sessionState();
  host.display_refresh_hz = display.display_refresh_hz;
  host.display_count = display.display_count;
  let exitCode = 0;
  try {
    for (let round = 1; round <= options.runs; round++) {
      for (const id of options.scenarioIds) {
        if (!SCENARIOS[id].search_bench) await runSlot(options, ctx, 'standard', id, round);
      }
    }
    if (options.typingRuns > 0) {
      const typingIds = options.scenarioIds.filter((x) => SCENARIOS[x].typing);
      for (let n = 1; n <= options.typingRuns; n++) {
        for (const id of typingIds) await runSlot(options, ctx, 'typing', id, n);
      }
    }
    for (const id of options.scenarioIds.filter((x) => SCENARIOS[x].search_bench)) {
      for (let n = 1; n <= options.runs; n++) await runSlot(options, ctx, 'search', id, n);
    }
    raw.status = 'complete';
  } catch (error) {
    if (error instanceof LockedScreenError) {
      raw.status = 'stopped: screen locked';
      raw.stop_reason = `the screen stayed locked: ${error.message}. The full measurement is pending an unlocked screen.`;
      exitCode = 4;
      log(`STOPPING: ${raw.stop_reason}`);
    } else if (error instanceof AbortedError) {
      raw.status = 'interrupted';
      raw.stop_reason = `${abortSignalName ?? 'a stop request'} received`;
      exitCode = 130;
    } else {
      raw.status = 'error';
      raw.stop_reason = error.message;
      exitCode = 1;
      log(`ERROR: ${error.stack ?? error.message}`);
    }
  }

  const finished = new Date();
  raw.finished_at = finished.toISOString();
  raw.finished_at_local = localIso(finished);
  write();
  const summary = buildSummary(raw);
  writeFileSync(join(outDir, `${options.label}-summary.md`), summary);
  process.stdout.write(summary);
  log(`Wrote ${raw.files.raw} and ${raw.files.summary}`);
  if (exitCode === 0 && planComplete(raw).length > 0) exitCode = 3;
  return exitCode;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (abortController.signal.aborted) {
      log('Second stop request: ending the app now.');
      hardCleanup();
      process.exit(130);
    }
    abortSignalName = signal;
    log(`${signal} received: stopping, closing the app, writing partial results.`);
    abortController.abort();
  });
}
process.on('exit', hardCleanup);

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    hardCleanup();
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  },
);
