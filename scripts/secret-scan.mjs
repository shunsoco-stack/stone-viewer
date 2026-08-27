import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([
  ".git", ".next", ".vercel", ".npm-cache", ".local", ".turbo",
  "node_modules", "out", "coverage", "playwright-report", "test-results",
]);
const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm", ".mp3", ".wav",
  ".zip", ".gz", ".br", ".7z", ".exe", ".dll", ".wasm", ".glb",
]);
const rules = [
  { id: "private-key", expression: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g },
  { id: "github-token", expression: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { id: "github-fine-grained-token", expression: /\bgithub_pat_[A-Za-z0-9_]{70,255}\b/g },
  { id: "aws-access-key", expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { id: "api-secret-key", expression: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,255}\b/g },
  { id: "stripe-secret-key", expression: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,255}\b/g },
  { id: "slack-token", expression: /\bxox[baprs]-[A-Za-z0-9-]{20,255}\b/g },
  { id: "authorization-value", expression: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]{24,255}\b/gi },
  { id: "url-with-password", expression: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]{6,}@/gi },
];

function isPlaceholder(value) {
  return /^(?:your[-_ ]|replace[-_ ]|example(?:[-_ ]|$)|sample(?:[-_ ]|$)|dummy(?:[-_ ]|$)|<|\$\{|process\.env\.|import\.meta\.env\.)/i.test(value);
}

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const proportion = count / value.length;
    result -= proportion * Math.log2(proportion);
  }
  return result;
}

export function scanText(content, filename = "input") {
  const findings = [];
  const seen = new Set();
  const report = (id, offset) => {
    const line = content.slice(0, offset).split("\n").length;
    const key = `${id}:${line}`;
    if (!seen.has(key)) findings.push({ filename, line, rule: id });
    seen.add(key);
  };

  for (const { id, expression } of rules) {
    for (const match of content.matchAll(new RegExp(expression.source, expression.flags))) {
      report(id, match.index);
    }
  }

  // Inspect literals, not environment references. Never print the matched value.
  const assignments = /^[\t ]*(?:(?:const|let|var|export(?:\s+const)?)\s+)?["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#;,]+))/gm;
  for (const match of content.matchAll(assignments)) {
    if (!/(?:token|secret|password|api[_-]?key|private[_-]?key|database[_-]?url)/i.test(match[1])) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (value.length >= 16 && !isPlaceholder(value) && entropy(value) >= 3.2) {
      report("sensitive-literal", match.index);
    }
  }

  const registryAuth = /(?:_authToken|_auth|_password)\s*=\s*([^\s#]+)/g;
  for (const match of content.matchAll(registryAuth)) {
    if (match[1].length >= 12 && !isPlaceholder(match[1])) report("registry-auth", match.index);
  }
  return findings;
}

export async function scanProject() {
  const findings = [];
  let files = 0;
  let skippedBinaryFiles = 0;
  let skippedSymlinks = 0;

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) {
        skippedSymlinks++;
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (binaryExtensions.has(path.extname(entry.name).toLowerCase())) {
        skippedBinaryFiles++;
        continue;
      }
      const bytes = await readFile(fullPath);
      if (bytes.includes(0)) {
        skippedBinaryFiles++;
        continue;
      }
      files++;
      findings.push(...scanText(bytes.toString("utf8"), path.relative(projectRoot, fullPath).split(path.sep).join("/")));
    }
  }

  await visit(projectRoot);
  return { findings, files, skippedBinaryFiles, skippedSymlinks };
}

function selfTest() {
  const synthetic = "aB3dE5fG7hJ9kL2mN4pQ6rS8tV0wX1yZ";
  const githubValue = ["gh", "p_", synthetic, "1234"].join("");
  assert.ok(scanText(githubValue).some((finding) => finding.rule === "github-token"));
  const privateKeyMarker = ["-----", "BEGIN ", "PRIVATE", " KEY", "-----"].join("");
  assert.ok(scanText(privateKeyMarker).some((finding) => finding.rule === "private-key"));
  const assignment = ["EXAMPLE", "SECRET"].join("_") + `="${synthetic}"`;
  assert.ok(scanText(assignment).some((finding) => finding.rule === "sensitive-literal"));
  assert.ok(scanText(["Bearer", synthetic].join(" ")).some((finding) => finding.rule === "authorization-value"));
  assert.ok(scanText(["https://user:", synthetic, "@example.invalid"].join("")).some((finding) => finding.rule === "url-with-password"));
  assert.equal(scanText('API_KEY="your-placeholder-here"').length, 0);
  assert.equal(scanText("const apiKey = process.env.API_KEY;").length, 0);
  assert.equal(scanText("NEXT_PUBLIC_ENABLE_CUSTOM_EVENTS=false").length, 0);
  const safeOutput = JSON.stringify(scanText(githubValue));
  assert.equal(safeOutput.includes(githubValue), false);
  console.log("Secret scanner self-test: 9 assertions passed (synthetic values only).");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  const result = await scanProject();
  if (result.findings.length > 0) {
    console.error(`Secret scan failed: ${result.findings.length} finding(s). Values are redacted.`);
    for (const finding of result.findings) console.error(`${finding.filename}:${finding.line} [${finding.rule}]`);
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed: ${result.files} text files checked; no matching secret patterns.`);
  console.log(`Excluded binary files: ${result.skippedBinaryFiles}; symlinks not followed: ${result.skippedSymlinks}. Dependencies, build output, and Git history are outside this scan.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Secret scan could not complete. Check file permissions; no source content was printed.");
    process.exitCode = 2;
  });
}
