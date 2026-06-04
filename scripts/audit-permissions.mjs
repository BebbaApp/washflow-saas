import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = 'src';
const files = [];
(function walk(d){ for (const e of readdirSync(d)) { const p = join(d,e); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } })(ROOT);

const permsSrc = readFileSync('src/lib/permissions.ts','utf8');
// Item keys only — those inside `items: [ ... { key: "x.y" } ]`
const itemKeys = new Set();
for (const m of permsSrc.matchAll(/items:\s*\[([\s\S]*?)\],?\s*\}/g)) {
  for (const km of m[1].matchAll(/key:\s*"([^"]+)"/g)) itemKeys.add(km[1]);
}

const callRe = /\b(can|canAny)\s*\(\s*(\[[^\]]*\]|"[^"]+"|'[^']+'|`[^`]+`)/g;
const usages = [];
for (const f of files) {
  const src = readFileSync(f,'utf8');
  if (!/\bcan(Any)?\s*\(/.test(src)) continue;
  let m;
  while ((m = callRe.exec(src))) {
    const line = src.slice(0,m.index).split('\n').length;
    const arg = m[2];
    const keys = arg.startsWith('[')
      ? [...arg.matchAll(/["'`]([^"'`]+)["'`]/g)].map(x=>x[1])
      : [arg.slice(1,-1)];
    for (const k of keys) usages.push({file:f,line,key:k,fn:m[1]});
  }
}

const suspectFiles = new Set();
for (const f of files) {
  if (f === 'src/lib/permissions.ts' || f === 'src/hooks/usePermissions.ts') continue;
  const src = readFileSync(f,'utf8');
  if (!/\bcan\s*\(/.test(src)) continue;
  const usesHook = /usePermissions/.test(src);
  if (!usesHook) suspectFiles.add(f);
}

const usedKeys = new Set(usages.map(u=>u.key));
const unknown = [...new Set(usages.filter(u=>!itemKeys.has(u.key)).map(u=>u.key))].sort();
const unenforced = [...itemKeys].filter(k=>!usedKeys.has(k)).sort();

// Group unenforced by module
const byModule = new Map();
for (const k of unenforced) {
  const mod = k.split('.')[0];
  if (!byModule.has(mod)) byModule.set(mod,[]);
  byModule.get(mod).push(k);
}

let report = '# Permission Audit Report\n\n';
report += `Generated: ${new Date().toISOString()}\n\n`;
report += `- Files scanned: **${files.length}**\n`;
report += `- \`can()\`/\`canAny()\` call sites: **${usages.length}**\n`;
report += `- Declared permission keys: **${itemKeys.size}**\n`;
report += `- Keys actually enforced in UI: **${usedKeys.size}**\n`;
report += `- Keys declared but never enforced: **${unenforced.length}**\n\n`;

report += `## ⚠️ Unenforced permission keys (${unenforced.length})\n\n`;
report += `These keys exist in \`PERMISSION_GROUPS\` and can be toggled per plan/role, but no component calls \`can("…")\` on them — so disabling them in the plan has **no visible effect**.\n\n`;
for (const [mod, keys] of [...byModule.entries()].sort()) {
  report += `### \`${mod}\` (${keys.length})\n`;
  for (const k of keys) report += `- \`${k}\`\n`;
  report += '\n';
}

report += `## Unknown keys used in \`can()\` (${unknown.length})\n\n`;
if (unknown.length === 0) report += `_None — every key referenced in code is declared._\n\n`;
else for (const k of unknown) report += `- \`${k}\`\n`;

report += `\n## Files using \`can()\` without \`usePermissions\` import (${suspectFiles.size})\n\n`;
if (suspectFiles.size === 0) report += `_None — every \`can()\` call goes through the plan-gated hook._\n\n`;
else for (const f of [...suspectFiles].sort()) report += `- \`${f}\`\n`;

report += `\n## All call sites (${usages.length})\n\n`;
for (const u of usages) report += `- \`${u.fn}("${u.key}")\` — ${u.file}:${u.line}\n`;

mkdirSync('/mnt/documents', { recursive: true });
writeFileSync('/mnt/documents/permission-audit.md', report);

// Console summary
console.log(`Scanned ${files.length} files | ${usages.length} call sites | ${itemKeys.size} declared keys`);
console.log(`✓ Unknown keys: ${unknown.length}`);
console.log(`✓ Files bypassing usePermissions: ${suspectFiles.size}`);
console.log(`⚠ Declared but UNENFORCED: ${unenforced.length} keys across ${byModule.size} modules`);
console.log('\nTop offenders by module:');
for (const [mod, keys] of [...byModule.entries()].sort((a,b)=>b[1].length-a[1].length))
  console.log(`  ${mod.padEnd(14)} ${keys.length} unenforced`);
console.log('\nReport written to /mnt/documents/permission-audit.md');
