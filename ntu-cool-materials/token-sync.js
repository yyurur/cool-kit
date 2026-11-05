// Usage: node token-sync.js <course-id> <root-folder> [--skip <regex>]
// Needs env COOL_TOKEN (an NTU COOL access token). No browser, no password.
// Saves into <root>\<module folder>\:
//   files (pdf preferred over same-name pptx), original-language transcripts of cool-video videos (<title>.txt),
//   and YouTube links collected into video-links.txt.
// --skip: case-insensitive regex tested against "<module name> / <item title>"; matches are not downloaded
//   (and their videos are never launched).
const fs = require("fs"), path = require("path");
const { download } = require("./fetch.js");

const BASE = "https://cool.ntu.edu.tw", VIDEO = "https://cool-video.dlc.ntu.edu.tw";
const TOKEN = process.env.COOL_TOKEN;
const args = process.argv.slice(2);
const skipAt = args.indexOf("--skip");
const SKIP = skipAt >= 0 ? new RegExp(args.splice(skipAt, 2)[1], "i") : null;
const [CID, root] = args;
if (!TOKEN || !CID || !root) { console.error("usage: COOL_TOKEN=... node token-sync.js <course-id> <root> [--skip <regex>]"); process.exit(1); }

async function api(p) {
  const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${r.status} ${p}${r.status === 401 ? " (token invalid or expired)" : ""}`);
  return r.json();
}

// "Week 3 - 9/20, X" -> "Week 03 - 9-20, X"; modules without "Week N" get their course position ("02 L1 - Text mining")
const folderOf = (name, idx) => {
  const n = name.match(/Week\s*(\d+)/i);
  const base = n ? name.replace(/^\s*Week\s*\d+/i, "Week " + n[1].padStart(2, "0")) : `${String(idx + 1).padStart(2, "0")} ${name}`;
  return base.replace(/\s*:\s*/g, " - ").replace(/\s+/g, " ").replace(/\//g, "-").replace(/[\\*?"<>|]/g, "_").trim();
};

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// cool-video only serves a video's subtitles after that video's LTI launch, so launch each one in a shared cookie jar.
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function launchAndGetSubtitle(moduleItemId, videoSourceId) {
  const { url } = await api(`/api/v1/courses/${CID}/external_tools/sessionless_launch?launch_type=module_item&module_item_id=${moduleItemId}`);
  const html = await (await fetch(url)).text();
  const action = decode(html.match(/<form[^>]*action="([^"]+)"/)[1]);
  const body = new URLSearchParams();
  for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
    const n = tag.match(/name="([^"]*)"/), v = tag.match(/value="([^"]*)"/);
    if (n) body.append(decode(n[1]), v ? decode(v[1]) : "");
  }
  const r = await fetch(action, { method: "POST", body, redirect: "manual", headers: { cookie: cookieHeader() } });
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  const s = await fetch(`${VIDEO}/api/courses/${CID}/video-sources/${videoSourceId}/subtitles/view`, { headers: { cookie: cookieHeader() } });
  if (!s.ok) throw new Error(`subtitles HTTP ${s.status}`);
  const subs = (await s.json()).subtitles || [];
  return (subs.find((x) => x.type === "Original") || subs[0])?.sourceUri; // Original = spoken-language auto transcript
}

const EXT = /\.[A-Za-z0-9]{2,5}$/;
const YOUTUBE = /^https?:\/\/(www\.)?(youtu\.be|youtube\.com)\//i;

(async () => {
  const modules = await api(`/api/v1/courses/${CID}/modules?include[]=items&per_page=100`);
  const rows = [], skipped = [], links = new Map();
  for (const [idx, mod] of modules.entries()) {
    // Canvas omits inline items for very large modules
    const items = mod.items || await api(`/api/v1/courses/${CID}/modules/${mod.id}/items?per_page=100`);
    const folder = folderOf(mod.name, idx);
    const kept = items.filter((i) => {
      if (SKIP && SKIP.test(`${mod.name} / ${i.title}`)) { if (i.type !== "SubHeader") skipped.push(`${folder} / ${i.title} (--skip)`); return false; }
      return true;
    });
    // Item titles may lack an extension ("L1 講義"); take it from the file's real name.
    const files = [];
    for (const i of kept.filter((i) => i.type === "File")) {
      try {
        const meta = await api(`/api/v1/files/${i.content_id}`);
        const ext = (meta.display_name.match(EXT) || [""])[0];
        // "example_1.ipynb 斷詞範例" -> "example_1 斷詞範例.ipynb"
        const t = i.title.trim();
        files.push({ i, name: EXT.test(t) ? t : (ext ? t.replace(ext, "").replace(/\s+/g, " ").trim() + ext : t) });
      } catch (e) { skipped.push(`${folder} / ${i.title} (ERROR ${e.message})`); }
    }
    const names = files.map((f) => f.name);
    for (const { i, name } of files) {
      if (/\.pptx?$/i.test(name) && names.includes(name.replace(/\.pptx?$/i, ".pdf"))) continue;
      try { rows.push([folder, name.replace(/\s+(\.[A-Za-z0-9]+)$/, "$1"), (await api(`/api/v1/files/${i.content_id}/public_url`)).public_url]); }
      catch (e) { skipped.push(`${folder} / ${i.title} (ERROR ${e.message})`); }
    }
    for (const i of kept.filter((i) => i.type !== "File")) {
      try {
        if (i.type === "ExternalTool" && /cool-video\.dlc\.ntu\.edu\.tw\/ltiv1p1\/launch\/videos\/\d+/.test(i.external_url || "")) {
          const srt = await launchAndGetSubtitle(i.id, i.external_url.match(/videos\/(\d+)/)[1]);
          if (srt) rows.push([folder, i.title, srt]); else skipped.push(`${folder} / ${i.title} (no subtitles)`);
        } else if (i.type === "ExternalUrl" && YOUTUBE.test(i.external_url || "")) {
          if (!links.has(folder)) links.set(folder, []);
          links.get(folder).push(`${i.title}: ${i.external_url}`);
        } else if (i.type !== "SubHeader") {
          skipped.push(`${folder} / ${i.title} (${i.type}${i.external_url ? " " + i.external_url : ""})`);
        }
      } catch (e) {
        skipped.push(`${folder} / ${i.title} (ERROR ${e.message})`);
      }
    }
  }
  console.log(`manifest: ${rows.length} items, YouTube links in ${links.size} folders`);
  const failed = await download(rows, root);
  for (const [folder, lines] of links) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    fs.writeFileSync(path.join(root, folder, "video-links.txt"), lines.join("\n") + "\n", "utf8");
    console.log(`ok ${lines.length} link(s) | ${folder} / video-links.txt`);
  }
  if (skipped.length) console.log("skipped:\n  " + skipped.join("\n  "));
  process.exit(failed ? 2 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
