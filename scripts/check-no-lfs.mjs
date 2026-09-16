// Fails if git LFS is active for this repository or if any tracked file is an
// LFS pointer. Deploying LFS pointers as "data" would break every consumer
// silently, so this is enforced in CI rather than left to convention.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const problems = [];

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// 1. No LFS filter may be configured for any path in this repo.
try {
  const attrs = execFileSync('git', ['check-attr', '-a', '--', 'data/latest.json', 'data/series/index.json'], {
    cwd: root,
    encoding: 'utf8',
  });
  for (const line of attrs.split('\n')) {
    if (/filter:\s*lfs/i.test(line)) problems.push(`git LFS filter is active: ${line}`);
  }
} catch (e) {
  problems.push(`could not read git attributes: ${e.message}`);
}

// 2. The .gitattributes file must not instruct LFS. Comments are stripped first
//    so that explaining the prohibition doesn't trip the check on itself.
//
//    Careful: these files routinely have CRLF endings on Windows, and `.` does
//    not match `\r` in JavaScript, so an anchored /#.*$/ fails to strip a
//    comment line that ends in \r. That silently makes the check report a
//    violation on a file whose only sin was documenting the rule.
//    Splitting on /\r?\n/ and matching /#.*/ (unanchored) avoids that class of bug.
try {
  const attrs = readFileSync(root + '.gitattributes', 'utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, ''))
    .join('\n');
  if (/filter\s*=\s*lfs/i.test(attrs)) problems.push('.gitattributes contains filter=lfs');
} catch {
  /* optional file */
}

// 2b. A leftover lfs.repositoryformatversion in repo config is an LFS artifact.
try {
  const v = execFileSync('git', ['config', '--local', '--get', 'lfs.repositoryformatversion'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (v) problems.push('local git config still carries lfs.repositoryformatversion=' + v);
} catch {
  /* absent is the desired state */
}

// 3. No LFS pointer files. A pointer is a tiny text file starting with the
//    LFS spec version line. Real JSON data never looks like this.
const scan = (dir, depth = 0) => {
  if (depth > 3) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      scan(p, depth + 1);
      continue;
    }
    if (!/\.(json|md|csv)$/i.test(entry.name)) continue;
    const size = statSync(p).size;
    if (size > 1024) continue; // pointers are always tiny
    const head = readFileSync(p, 'utf8').split('\n', 2);
    if (head[0]?.startsWith('version https://git-lfs.github.com/spec/')) {
      problems.push(`LFS pointer file found: ${p.replace(root, '')}`);
    }
  }
};

scan(root + 'data');

// 4. The data directory must be real content, not pointers.
const bytes = readdirSync(root + 'data/series')
  .filter((f) => f.endsWith('.json'))
  .reduce((a, f) => a + statSync(root + 'data/series/' + f).size, 0);
if (bytes < 50_000) problems.push(`data/series is only ${bytes} bytes - expected real data, not pointers`);

if (problems.length) {
  console.error('LFS CHECK FAILED:');
  for (const p of problems) console.error('  x ' + p);
  process.exit(1);
}
console.log(`no git LFS in use; data/series holds ${(bytes / 1024).toFixed(1)} KiB of real data`);
