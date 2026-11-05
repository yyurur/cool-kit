// Usage: node fetch.js <manifest.tsv> <root-folder>
// Each manifest line: <week folder>\t<file name>\t<cookie-free url>
// Subtitle rows (url contains raw.srt) are cleaned to plain text and saved as <name>.txt;
// everything else is saved byte-for-byte as <name>.
const fs = require("fs"), path = require("path");

// Same rules as background.js stripSrtMeta: drop index lines, timecodes, blank lines.
const stripSrt = (srt) => srt.split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !/^\d+$/.test(l) && !/^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}$/.test(l))
  .join("\n");
const safe = (s) => s.replace(/[\\/:*?"<>|]/g, "_").trim();

// rows: [[folder, name, url], ...]; returns the number of failures.
async function download(rows, root) {
  let failed = 0;
  for (const [folder, name, url] of rows) {
    const dir = path.join(root, safe(folder));
    fs.mkdirSync(dir, { recursive: true });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (/raw\.srt/.test(url)) {
        const srt = await res.text();
        const zh = (srt.match(/[一-鿿]/g) || []).length, en = (srt.match(/[A-Za-z]/g) || []).length;
        const text = stripSrt(srt);
        fs.writeFileSync(path.join(dir, safe(name) + ".txt"), text, "utf8");
        console.log(`ok ${zh > en ? "cjk" : "latin"} ${text.split("\n").length} lines | ${folder} / ${name}.txt`);
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(dir, safe(name)), buf);
        console.log(`ok ${(buf.length / 1e6).toFixed(1)}MB | ${folder} / ${name}`);
      }
    } catch (e) {
      failed++;
      console.log(`FAIL ${e.message} | ${folder} / ${name}`);
    }
  }
  if (failed) console.log(`${failed} failed`);
  return failed;
}

module.exports = { download };

if (require.main === module) {
  const [manifest, root] = process.argv.slice(2);
  if (!manifest || !root) { console.error("usage: node fetch.js <manifest.tsv> <root>"); process.exit(1); }
  const rows = fs.readFileSync(manifest, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
  download(rows, root).then((failed) => process.exit(failed ? 2 : 0));
}
