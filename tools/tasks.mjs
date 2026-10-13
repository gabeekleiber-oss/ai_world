#!/usr/bin/env node
// Task board CLI. No dependencies. Every command works on a fresh shallow clone of
// origin/main, so it never touches your working tree or your current branch.
//   node tools/tasks.mjs list [--all]        ready tasks (deps done, status open); --all shows everything
//   node tools/tasks.mjs show <ID>           print a task file
//   node tools/tasks.mjs claim <ID> <agent>  atomic claim (push to main; first push wins)
//   node tools/tasks.mjs release <ID>        give a task back (status open)
//   node tools/tasks.mjs set <ID> <status>   open|claimed|review|done|blocked (merger sets done)
//   node tools/tasks.mjs finish <ID>         LOCAL: mark your task file as review, commit it with your code
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUSES = ['open', 'claimed', 'review', 'done', 'blocked'];
const STALE_HOURS = 24;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function parse(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`bad frontmatter: ${file}`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    let v = line.slice(i + 1).trim();
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    meta[line.slice(0, i).trim()] = v;
  }
  return { meta, text, file };
}
function setField(task, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  const line = `${key}:${value ? ' ' + value : ''}`;
  task.text = re.test(task.text) ? task.text.replace(re, line) : task.text.replace(/\n---/, `\n${line}\n---`);
  writeFileSync(task.file, task.text);
}
const loadAll = (dir) =>
  readdirSync(join(dir, 'tasks')).filter((f) => /^[A-Z]+-\d+\.md$/.test(f)).map((f) => parse(join(dir, 'tasks', f)));

function freshClone() {
  let url = git(root, 'remote', 'get-url', 'origin');
  if (url.startsWith('.')) url = resolve(root, url);
  const dir = mkdtempSync(join(tmpdir(), 'tasks-'));
  git(tmpdir(), 'clone', '--quiet', '--depth', '1', '--branch', 'main', url, dir);
  return dir;
}
function withClone(fn) {
  const dir = freshClone();
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function pushChange(mutate, message, agent = 'task-bot') {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const dir = freshClone();
    try {
      const result = mutate(dir);
      if (result === false) return false;
      const cfg = ['-c', `user.name=${agent}`, '-c', `user.email=${agent.replace(/\W/g, '-')}@agents.local`];
      git(dir, ...cfg, 'commit', '--quiet', '-am', message);
      try { git(dir, 'push', '--quiet', 'origin', 'main'); return true; } catch { /* lost the race, retry */ }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  throw new Error('could not push after 5 attempts');
}
const byId = (tasks, id) => tasks.find((t) => t.meta.id === id) ?? (() => { throw new Error(`no task ${id}`); })();
const depsDone = (t, all) => (t.meta.depends_on || []).every((d) => all.find((x) => x.meta.id === d)?.meta.status === 'done');
const ageHours = (t) => (t.meta.claimed_at ? (Date.now() - Date.parse(t.meta.claimed_at)) / 36e5 : 0);

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'list') {
  withClone((dir) => {
    const all = loadAll(dir);
    const rows = all.filter((t) => a === '--all' || (t.meta.status === 'open' && depsDone(t, all)));
    for (const t of rows) {
      const stale = t.meta.status === 'claimed' && ageHours(t) > STALE_HOURS ? ' STALE' : '';
      const who = t.meta.claimed_by ? ` [${t.meta.claimed_by}]` : '';
      console.log(`${t.meta.id.padEnd(8)} ${t.meta.status.padEnd(8)} ${t.meta.title}${who}${stale}`);
    }
    if (!rows.length) console.log('nothing ready');
  });
} else if (cmd === 'show') {
  withClone((dir) => console.log(byId(loadAll(dir), a).text));
} else if (cmd === 'claim') {
  if (!a || !b) throw new Error('usage: claim <ID> <agent>');
  const ok = pushChange((dir) => {
    const all = loadAll(dir), t = byId(all, a);
    const stale = t.meta.status === 'claimed' && ageHours(t) > STALE_HOURS;
    if (t.meta.status !== 'open' && !stale) { console.error(`${a} is ${t.meta.status} (${t.meta.claimed_by})`); return false; }
    if (!depsDone(t, all)) { console.error(`${a} has unfinished dependencies: ${t.meta.depends_on}`); return false; }
    setField(t, 'status', 'claimed'); setField(t, 'claimed_by', b);
    setField(t, 'claimed_at', new Date().toISOString()); setField(t, 'branch', `task/${a}`);
  }, `claim: ${a} by ${b}`, b);
  console.log(ok ? `claimed ${a}. Next: git checkout -b task/${a} origin/main` : `NOT claimed ${a}. Pick another.`);
  process.exit(ok ? 0 : 1);
} else if (cmd === 'release' || cmd === 'set') {
  const status = cmd === 'release' ? 'open' : b;
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES}`);
  pushChange((dir) => {
    const t = byId(loadAll(dir), a);
    setField(t, 'status', status);
    if (status === 'open') { setField(t, 'claimed_by', ''); setField(t, 'claimed_at', ''); }
  }, `${cmd}: ${a} -> ${status}`);
  console.log(`${a} -> ${status}`);
} else if (cmd === 'finish') {
  const t = parse(join(root, 'tasks', `${a}.md`));
  setField(t, 'status', 'review');
  console.log(`${a} marked review in your working tree. Commit it with your code and open the PR.`);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
}
