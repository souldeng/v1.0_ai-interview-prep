// Read-only source-publication preview: no copying, deleting, Git writes or network requests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const plan = JSON.parse(fs.readFileSync(path.join(root, "release-files.json"), "utf8"));
const files = new Set(plan.files), errors = [], warnings = [], blockers = [];
const excluded = (plan.excludedDirectories ?? []).map(name => name.replace(/\/$/, ""));
const isExcluded = relative => excluded.some(name => relative === name || relative.startsWith(`${name}/`));
function collect(relative) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root) || fs.lstatSync(absolute).isSymbolicLink()) throw new Error("Unsafe publication path");
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (isExcluded(name)) continue;
    if (entry.isSymbolicLink()) errors.push(`Symbolic link excluded: ${name}`);
    else if (entry.isDirectory()) collect(name);
    else files.add(name);
  }
}
for (const directory of plan.directories) if (fs.existsSync(path.join(root, directory))) collect(directory);
// Read only for local matching. Never include values or matching lines in output.
const env = fs.existsSync(path.join(root, ".env")) ? fs.readFileSync(path.join(root, ".env"), "utf8") : "";
const secrets = env.split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*\w*(?:KEY|TOKEN|SECRET|PASSWORD)\w*\s*=\s*(.*?)\s*$/);
  const value = match?.[1].replace(/^['"]|['"]$/g, "");
  return value?.length >= 8 ? [value] : [];
});
const output = [];
for (const relative of [...files].sort()) {
  if (isExcluded(relative)) continue;
  if (relative.split("/").includes("..") || path.isAbsolute(relative) || /(?:^|\/)(?:\.env(?!\.example$)[^/]*|node_modules|dist|\.local-backups|\.local-usage|designs|playwright-report[^/]*|test-results[^/]*)(?:\/|$)|\.(?:log|zip|webm|mp4|pdf|docx|pen|pem|key|p12|pfx|har|trace|bak|tmp)$/i.test(relative)) {
    errors.push(`Private/generated file excluded: ${relative}`); continue;
  }
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root) || fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) { errors.push(`Unsafe file: ${relative}`); continue; }
  if (!fs.existsSync(absolute)) { blockers.push({ code: "missing_required_file", path: relative, message: `Required publication file is missing: ${relative}` }); continue; }
  const bytes = fs.readFileSync(absolute), text = bytes.toString("utf8");
  if (secrets.some(secret => text.includes(secret))) errors.push(`Current local secret match: ${relative}`);
  if (/(?:^|[^A-Za-z])sk-[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) errors.push(`Credential-like pattern: ${relative}`);
  if (/[A-Za-z]:[\\/](?:Users|learn_agent|codex)[\\/]/i.test(text)) warnings.push(`Review internal path: ${relative}`);
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)) {
    // Detect the current direct/template URL references, not arbitrary program execution.
    const references = [...text.matchAll(/\bnew\s+URL\(\s*["'`]([^"'`\r\n]+)["'`]/g)].map(match => match[1]);
    if (references.some(reference => excluded.some(name => reference.includes(`${name}/`)))) {
      blockers.push({ code: "excluded_test_fixture", path: relative, message: `Test still needs excluded fixtures; replace or authorize before publication: ${relative}` });
    }
  }
  output.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const ready = errors.length === 0 && blockers.length === 0;
const result = { ready, files: output, excluded, blockers, errors, warnings, limitations: ["This file preview does not inspect Git index/history; run npm run sync:check", "Pattern checks do not certify privacy or copyright", "Test reference checks cover current direct/template URL references, not a complete dependency graph", "Excluded historical model outputs remain local and require owner distribution approval", "Project LICENSE remains an owner decision"] };
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
  console.log(output.map(file => `${file.path}\t${file.bytes}\t${file.sha256}`).join("\n"));
  console.log(`\nFiles: ${output.length}; errors: ${errors.length}; warnings: ${warnings.length}; blockers: ${blockers.length}; ready: ${ready}`);
  for (const name of excluded) console.log(`Excluded directory: ${name}`);
  for (const message of [...errors, ...warnings, ...blockers.map(item => item.message), ...result.limitations]) console.log(message);
}
process.exitCode = ready ? 0 : 1;
