// Local publication audit. Does not stage, commit, push, copy or remove project files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const baselineArg = args.indexOf('--baseline');
if (baselineArg >= 0 && !args[baselineArg + 1]) throw new Error('--baseline needs a directory');
const baseline = baselineArg >= 0 ? path.resolve(args[baselineArg + 1]) : null;
const output = path.join(root, '.local-publication-audit');
fs.mkdirSync(output, { recursive: true });
const emptyGitConfig = path.join(output, 'empty-gitconfig');
fs.writeFileSync(emptyGitConfig, '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyGitConfig };
// Do not inherit a caller's alternate repository or index.
for (const key of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete env[key];
function git(cwd, args, input, allowFailure = false) {
  const result = spawnSync('git', args, { cwd, input, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !allowFailure)) throw new Error(`Git audit failed (${args[0]}): ${result.error?.code ?? result.status}`);
  return result;
}
function inventory(directory) {
  const files = new Map(), links = [], nestedGit = [];
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = slash(path.join(relative, entry.name));
      if (name === '.local-publication-audit' || name.startsWith('.local-publication-audit/')) continue;
      if (entry.name === '.git') { if (relative) nestedGit.push(name); continue; }
      const absolute = path.join(directory, name);
      if (entry.isSymbolicLink()) { links.push(name); continue; }
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files.set(name, { absolute, bytes: fs.statSync(absolute).size });
    }
  }
  visit();
  return { files, links, nestedGit };
}
function repository(directory) {
  const top = git(directory, ['rev-parse', '--show-toplevel'], undefined, true);
  if (top.status !== 0) return { exists: false, tracked: [], history: [], commits: 0, remotes: [], historyScan: 'No local Git metadata/history available' };
  if (path.resolve(top.stdout.trim()).toLowerCase() !== path.resolve(directory).toLowerCase()) throw new Error('Directory belongs to a parent repository; audit that repository separately');
  const tracked = git(directory, ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const commits = git(directory, ['rev-list', '--all', '--count']).stdout.trim();
  const objects = git(directory, ['rev-list', '--objects', '--all', '--reflog']).stdout.trim().split('\n').filter(Boolean);
  // URLs may contain credentials: report remote names, never their raw values.
  const remotes = git(directory, ['remote']).stdout.trim().split('\n').filter(Boolean);
  const history = [], seen = new Set();
  let blobsScanned = 0, blobsSkipped = 0;
  for (const object of objects) {
    const space = object.indexOf(' '), id = space < 0 ? object : object.slice(0, space);
    if (seen.has(id)) continue;
    seen.add(id);
    if (git(directory, ['cat-file', '-t', id]).stdout.trim() !== 'blob') continue;
    const name = space < 0 ? '(unnamed blob)' : object.slice(space + 1);
    if (/(?:^|\/)(?:\.env(?!\.example$)|\.local-usage|\.local-backups|uploads|private|resumes)(?:[/.]|$)|\.(?:pdf|docx|jsonl|pem|key|pfx|p12)$/i.test(name)) history.push({ path: name, kind: 'sensitive_history_path' });
    if (Number(git(directory, ['cat-file', '-s', id]).stdout) > 2 * 1024 * 1024) { blobsSkipped++; continue; }
    const body = git(directory, ['cat-file', 'blob', id]).stdout;
    if (body.includes('\0')) { blobsSkipped++; continue; }
    blobsScanned++;
    history.push(...scanText(name, body).map(item => ({ ...item, object: id })));
  }
  return { exists: true, tracked, commits: Number(commits || 0), remotes, history, blobsScanned, blobsSkipped, historyScan: 'Reachable refs and reflogs only; excludes unreachable objects and unavailable remote history' };
}
const source = inventory(root), reference = baseline ? inventory(baseline) : null;
const secrets = [];
for (const [name, file] of source.files) {
  if (!/(?:^|\/)\.env(?:\.[^/]*)?$/.test(name) || name.endsWith('.example') || file.bytes > 1024 * 1024) continue;
  for (const line of fs.readFileSync(file.absolute, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?[\w]*(?:KEY|TOKEN|SECRET|PASSWORD)[\w]*\s*=\s*(.*?)\s*$/i);
    const value = match?.[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
    if (value && value.length >= 8) secrets.push(value);
  }
}
const patterns = [
  ['credential_pattern', /\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential_url', /https?:\/\/[^\s/@:]+:[^\s/@]+@/],
  ['literal_secret_review', /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|authorization)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{12,}["']/i],
  ['email_review', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['phone_or_id_review', /(?<![\dA-Za-z])(?:1[3-9]\d{9}|[1-9]\d{16}[\dXx])(?![\dA-Za-z])/],
  ['internal_path_review', /[A-Za-z]:[\\/](?:Users|learn_agent|codex)[\\/]/i],
  ['merge_conflict', /^(?:<<<<<<< |=======$|>>>>>>> )/],
];
function scanText(name, body) {
  const found = [];
  body.split(/\r?\n/).forEach((line, index) => {
    if (secrets.some(secret => line.includes(secret))) found.push({ path: name, line: index + 1, kind: 'current_local_secret' });
    for (const [kind, pattern] of patterns) if (pattern.test(line)) {
      const mockAssignment = 'MODEL_API_' + 'KEY: ' + JSON.stringify(['anonymous', 'test', 'key'].join('-'));
      const reviewed = kind === 'literal_secret_review' && ['src/services/jsonRequestSafety.test.ts', 'src/services/modelProxy.test.ts'].includes(name) && line.includes(mockAssignment);
      found.push({ path: name, line: index + 1, kind, ...(reviewed ? { resolution: 'Reviewed fixed fictional credential for local HTTP mock; not a provider key' } : {}) });
    }
  });
  return found;
}
// A disposable Git database gives native ignore semantics without initializing the project.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-interview-sync-'));
let ignored, probes;
try {
  git(temporary, ['init', '--bare', '--template=', path.join(temporary, 'repo')]);
  const prefix = ['--git-dir=' + path.join(temporary, 'repo'), '--work-tree=' + root, '-c', 'core.bare=false', '-c', 'core.excludesFile=' + emptyGitConfig, '-c', 'core.ignoreCase=false'];
  function check(names) {
    const result = git(root, [...prefix, 'check-ignore', '--no-index', '-v', '-z', '--stdin'], names.join('\0') + '\0', true);
    if (![0, 1].includes(result.status)) throw new Error('check-ignore failed');
    const parts = result.stdout.split('\0'), rules = new Map();
    for (let i = 0; i + 3 < parts.length; i += 4) if (!parts[i + 2].startsWith('!')) rules.set(parts[i + 3], { source: slash(path.relative(root, path.resolve(root, parts[i]))), line: Number(parts[i + 1]), pattern: parts[i + 2] });
    return rules;
  }
  ignored = check([...source.files.keys(), ...source.links]);
  const privateProbes = ['.env', '.env.production', 'src/.env', '.local-usage/a.jsonl', '.local-publication-audit/a.json', 'docs/private.md', 'uploads/resume.pdf', 'src/uploads/resume.pdf', 'src/private/a.json', 'src/data/resumes/a.json', 'src/resume.pdf', 'src/leaked.pem', 'src/usage.jsonl', 'src/unknown.zip', 'src/credentials.json', 'e2e/.auth/user.json', 'scripts/private-data.json', 'test-fixtures/public-coach/resume.pdf', 'node_modules/a.js', 'playwright-report-new/index.html', 'test-results-new/a.json'];
  const publicProbes = ['.env.example', '.gitignore', 'README.md', 'package-lock.json', 'server.ts', 'src/App.tsx', 'e2e/coach-boundaries.spec.ts', 'scripts/github-sync-check.mjs', 'test-fixtures/public-coach/02-rag-evaluation.json'];
  const results = check([...privateProbes, ...publicProbes]);
  probes = [...privateProbes.map(name => ({ path: name, expectedIgnored: true, passed: results.has(name) })), ...publicProbes.map(name => ({ path: name, expectedIgnored: false, passed: !results.has(name) }))];
} finally {
  // Only remove the exact temporary directory created by mkdtemp, never a project path.
  if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('ai-interview-sync-') && !fs.lstatSync(temporary).isSymbolicLink()) fs.rmSync(temporary, { recursive: true });
}
const candidates = [...source.files.keys()].filter(name => !ignored.has(name)).sort();
const findings = [], coverage = [], comparison = [];
function scanInventory(inv, label, allowed) {
  for (const [name, file] of inv.files) {
    let status;
    if (/^(?:node_modules|dist|playwright-report[^/]*|test-results[^/]*|blob-report[^/]*)\//.test(name)) status = 'generated_or_dependency_not_content_scanned';
    else if (file.bytes > 2 * 1024 * 1024) status = 'large_file_not_content_scanned';
    else {
      const bytes = fs.readFileSync(file.absolute);
      if (bytes.includes(0)) status = 'binary_not_content_scanned';
      else { status = 'text_scanned'; findings.push(...scanText(name, bytes.toString('utf8')).map(item => ({ ...item, scope: label, candidate: allowed.has(name) }))); }
    }
    coverage.push({ scope: label, path: name, status });
  }
}
scanInventory(source, 'original', new Set(candidates));
if (reference) scanInventory(reference, 'public-reference', new Set(reference.files.keys()));
for (const name of [...new Set([...source.files.keys(), ...(reference?.files.keys() ?? [])])].sort()) {
  const a = source.files.get(name), b = reference?.files.get(name);
  const state = !reference ? 'no_reference' : !a ? 'public_only' : !b ? 'original_only' : hash(fs.readFileSync(a.absolute)) === hash(fs.readFileSync(b.absolute)) ? 'identical' : 'changed';
  comparison.push({ path: name, state, originalBytes: a?.bytes ?? null, publicBytes: b?.bytes ?? null, candidate: !!a && !ignored.has(name), ignoredRule: ignored.get(name)?.pattern ?? '' });
}
const originalGit = repository(root), publicGit = baseline ? repository(baseline) : null;
const trackedIgnored = originalGit.tracked.filter(name => ignored.has(name));
const candidateFindings = findings.filter(item => item.scope === 'original' && item.candidate && !item.resolution);
const reviewedCandidateFindings = findings.filter(item => item.scope === 'original' && item.candidate && item.resolution);
const blockers = [];
if (candidateFindings.length) blockers.push('Candidate content findings require review (see findings.json)');
if (probes.some(item => !item.passed)) blockers.push('Ignore regression probe failed');
if (trackedIgnored.length) blockers.push('Ignored files are already tracked; ignore rules do not untrack them');
if (originalGit.history.length || originalGit.blobsSkipped) blockers.push('Git history needs review');
if (source.links.length || source.nestedGit.length) blockers.push('Symlinks or nested repositories need review');
if (coverage.some(item => item.scope === 'original' && candidates.includes(item.path) && item.status !== 'text_scanned')) blockers.push('Candidate content not fully text-scanned');
if (!source.files.has('LICENSE')) blockers.push('Original project has no LICENSE; reference LICENSE needs owner confirmation before copying');
const requiredFixtures = ['02-rag-evaluation', '03-experience', '04-discovery', '05-dont-know', '06-hypothetical', 'experience-internal-note', 'experience-semantic-expansion'];
for (const name of requiredFixtures) {
  const file = `test-fixtures/public-coach/${name}.json`;
  if (!candidates.includes(file) || JSON.parse(fs.readFileSync(source.files.get(file).absolute, 'utf8')).provenance?.fictional !== true) blockers.push(`Missing/non-fictional public fixture: ${file}`);
}
const plan = JSON.parse(fs.readFileSync(path.join(root, 'release-files.json'), 'utf8'));
const planned = new Set(plan.files.filter(name => source.files.has(name)));
for (const name of source.files.keys()) if (plan.directories.some(dir => name.startsWith(dir + '/')) && !(plan.excludedDirectories ?? []).some(dir => name.startsWith(dir + '/'))) planned.add(name);
const manifestDrift = { gitOnly: candidates.filter(name => !planned.has(name)), planOnly: [...planned].filter(name => !candidates.includes(name)) };
if (manifestDrift.gitOnly.length || manifestDrift.planOnly.length) blockers.push('release-files.json disagrees with native Git ignore results');
const counts = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
const summary = { checkedAt: new Date().toISOString(), originalFiles: source.files.size, publicFiles: reference?.files.size ?? null, candidates: candidates.length, ignored: source.files.size - candidates.length, comparison: counts(comparison.map(item => item.state)), candidateFindings: candidateFindings.length, reviewedCandidateFindings, allFindings: findings.length, coverage: counts(coverage.map(item => item.status)), probesPassed: probes.filter(item => item.passed).length, probesTotal: probes.length, originalGit, publicGit, trackedIgnored, manifestDrift, blockers, readyForHumanReview: blockers.length === 0, limitations: ['No automatic publish approval: review new/changed content before every commit', 'Pattern scans cannot certify privacy, ownership or all secret formats', 'Generated/dependency, binary and large file bodies are skipped; coverage.csv enumerates every skipped path', 'No remote history fetched; no project Git initialization/staging/commit/push', 'Audit output is local and ignored; filenames can themselves be private', 'Existing files only; deletions, Git attributes and staged-only content still require Desktop review'] };
fs.mkdirSync(output, { recursive: true });
function json(name, value) { fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n'); }
function csv(name, rows) {
  if (!rows.length) { fs.writeFileSync(path.join(output, name), ''); return; }
  const keys = Object.keys(rows[0]);
  const cell = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(output, name), '\uFEFF' + [keys, ...rows.map(row => keys.map(key => row[key]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n');
}
json('summary.json', summary); json('findings.json', findings); json('ignore-probes.json', probes);
csv('comparison.csv', comparison); csv('scan-coverage.csv', coverage);
csv('ignored-files.csv', [...ignored].map(([name, rule]) => ({ path: name, ...rule })));
csv('upload-manifest.csv', candidates.map(name => ({ path: name, bytes: source.files.get(name).bytes, sha256: hash(fs.readFileSync(source.files.get(name).absolute)) })));
fs.writeFileSync(path.join(output, 'upload-files.txt'), candidates.join('\n') + '\n');
console.log(JSON.stringify({ candidates: summary.candidates, ignored: summary.ignored, comparison: summary.comparison, candidateFindings: summary.candidateFindings, probes: `${summary.probesPassed}/${summary.probesTotal}`, blockers, output: '.local-publication-audit/' }, null, 2));
process.exitCode = blockers.length ? 1 : 0;
