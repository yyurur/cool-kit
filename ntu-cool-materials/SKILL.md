---
name: ntu-cool-materials
description: Download an NTU COOL course's materials (slides, zips, notebooks, video transcripts) into per-module folders on disk, via a COOL access token or a browser. Use when asked to save, download, or archive a cool.ntu.edu.tw course's 教材, 簡報, 講義, 字幕, 逐字稿, or 練習題.
---

# NTU COOL course materials → disk

Unofficial tool for saving your own copies of courses you are enrolled in. Respect your school's terms of use and the instructors' copyright: keep the files personal, do not redistribute them.

Saves every module of one course into `<root>/<module folder>/`:

- **Slides**: when a module has both `X.pdf` and `X.pptx`, keep only the pdf (easier for text tools and AI). Otherwise keep whatever exists. Honor the user if they ask for something else.
- **Other files** (zips, notebooks, datasets): every other File item, as is.
- **Transcripts**: each cool-video video's original-language subtitle, cleaned to plain text (no index or timecodes), saved as `<video title>.txt`.
- **YouTube videos**: not downloaded; the links go into `video-links.txt` in the module folder.

Files go straight to disk with the local [fetch.js](fetch.js), not through browser downloads (those land in the Downloads folder and may open save dialogs).

Inputs: the course id (from `https://cool.ntu.edu.tw/courses/<id>`) and the target root folder. Ask for whichever is missing. Requires Node 18+.

## Token mode (preferred: no browser, no password)

Check for the token: `[ -n "$COOL_TOKEN" ]` (bash) or `$env:COOL_TOKEN` (PowerShell). The token is the user's credential, so never print, echo or log its value.

On Windows, a token saved with `setx` is only visible to sessions started afterwards. To load it for one command in an older session: `COOL_TOKEN="$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('COOL_TOKEN','User')" | tr -d '\r\n')" node ...`.

- **Token present**: run `node "<this skill dir>/token-sync.js" <course-id> "<root>" [--skip '<regex>']`. It reads the modules, saves files, launches each cool-video video over LTI in its own cookie jar, saves transcripts, and writes YouTube links. Then run the step 7 checks below, plus `json.load` on every `.ipynb`.
  - **Partial requests**: when the user wants only some material (e.g. "no projects or datasets"), list the modules first with a small `/api/v1/courses/<id>/modules?include[]=items` script. Then build `--skip`, a case-insensitive regex tested against `<module name> / <item title>`, e.g. `'^(Project|Final)|dataset'`. Ask the user about borderline modules such as homework. Skipped videos are never launched, so they leave no viewing record.
  - **Filters --skip cannot express** (e.g. "PDFs only, skip student reports"): write a one-off script that `require`s `fetch.js`'s `download` and calls `/api/v1/files/<id>/public_url` for the chosen files.
  - **Folder names**: modules named `Week N` become `Week NN - ...`. Any other module is prefixed with its position in the course (`02 Lecture 1`), so folders sort in course order.
- **No token, or the script reports `401 ... token invalid or expired`**: use browser mode. Whether students can create access tokens is up to the school (look under COOL → Settings → Approved Integrations / New Access Token); it may be hidden or disabled. If the user wants one, they create and copy it themselves; you never create, click through, or see a token. A token carries the user's full account access: advise a short expiry and a school-policy check. They store it as the `COOL_TOKEN` environment variable (`setx COOL_TOKEN "<token>"` on Windows, `export` in a shell profile elsewhere), and it takes effect in a new session. Never ask them to paste it into chat.

Report the script's `skipped:` list to the user.

## Browser mode (no token)

Paste the course id into every snippet where it says `CID`. Run the snippets with whatever tool lets you execute JavaScript in a logged-in browser page. One call may time out after about 45 seconds, so keep each call short.

1. **Log in.** Navigate to `https://cool.ntu.edu.tw/courses/CID`. If you land on `/login`, ask the user to sign in in the browser and wait for them. You never type their credentials. You are done when `fetch('/api/v1/users/self')` returns 200.

2. **Build the manifest** on the `cool.ntu.edu.tw` origin:

   ```js
   const CID = 0; // course id
   const m = await (await fetch(`/api/v1/courses/${CID}/modules?include[]=items&per_page=100`)).json();
   const files = [], videos = [];
   for (const mod of m) {
     const its = mod.items.filter(i => i.type === 'File' || i.type === 'ExternalTool');
     if (!its.length) continue;
     const n = mod.name.match(/Week\s*(\d+)/i);
     const folder = (n ? mod.name.replace(/^\s*Week\s*\d+/i, 'Week ' + n[1].padStart(2, '0')) : mod.name)
       .replace(/\s+/g, ' ').replace(/\//g, '-').replace(/[\\:*?"<>|]/g, '_').trim();
     const names = its.map(i => i.title);
     for (const i of its) {
       if (i.type === 'File') {
         if (/\.pptx?$/i.test(i.title) && names.includes(i.title.replace(/\.pptx?$/i, '.pdf'))) continue;
         const { public_url } = await (await fetch(`/api/v1/files/${i.content_id}/public_url`)).json();
         files.push([folder, i.title, public_url].join('\t'));
       } else if (/cool-video\.dlc\.ntu\.edu\.tw\/ltiv1p1\/launch\/videos\/\d+/.test(i.external_url || '')) {
         videos.push([folder, i.title, i.id, i.external_url.match(/videos\/(\d+)/)[1]]);
       }
     }
   }
   window.__videos = videos;
   ({ files: files.join('\n'), videos: JSON.stringify(videos) })
   ```

   Write `files` to `<tmp>/manifest.tsv` and keep the `videos` JSON for step 5. Module names without `Week N` keep their own name as the folder. Skip ExternalTool items that are not cool-video links, and list them for the user at the end.

3. **Download files now**: `node "<this skill dir>/fetch.js" "<tmp>/manifest.tsv" "<root>"`. The `public_url` verifiers are short-lived, so run this right after step 2. You are done when every line prints `ok`.

4. **Open every video once.** cool-video only returns a video's subtitles after that video has been launched in this browser.
   - First, make one top-level launch so the cool-video session exists: on the cool origin, run `location.href = (await (await fetch('/api/v1/courses/CID/external_tools/sessionless_launch?launch_type=module_item&module_item_id=' + window.__videos[0][2])).json()).url`.
   - Navigate back to `https://cool.ntu.edu.tw/courses/CID/modules`. Re-set `window.__videos` from the JSON, then launch the rest through hidden iframes, 6 per call:

   ```js
   window.__todo ??= [...window.__videos];
   const log = [];
   for (const v of window.__todo.splice(0, 6)) {
     const { url } = await (await fetch(`/api/v1/courses/CID/external_tools/sessionless_launch?launch_type=module_item&module_item_id=${v[2]}`)).json();
     const f = document.createElement('iframe'); f.src = url; document.body.appendChild(f);
     await new Promise(r => setTimeout(r, 6000)); f.remove(); log.push(v[3]);
   }
   log.join(',') + ' | left ' + window.__todo.length
   ```

   Repeat the call until it reports `left 0`.

5. **Collect subtitle URLs.** Navigate to `https://cool-video.dlc.ntu.edu.tw/`, any page on that origin will do. Paste the `videos` JSON as `V` and run:

   ```js
   const CID = 0, V = [/* videos JSON from step 2 */];
   const rows = await Promise.all(V.map(async ([folder, name, , vs]) => {
     const r = await fetch(`/api/courses/${CID}/video-sources/${vs}/subtitles/view`);
     if (!r.ok) return `#HTTP${r.status}\t${folder}\t${name}`;
     const subs = (await r.json()).subtitles || [];
     const s = subs.find(s => s.type === 'Original') || subs[0];
     return s ? [folder, name, s.sourceUri].join('\t') : `#NONE\t${folder}\t${name}`;
   }));
   rows.join('\n')
   ```

   `Original` is the auto-generated transcript in the lecture's spoken language; `EnTranslate` is a machine translation. A `#HTTP403` or `#NONE` row means that video was never launched, so go back to step 4 for it. The `sourceUri` links expire after 3 hours.

6. **Download transcripts**: write the non-`#` rows to `<tmp>/subs.tsv` and run `fetch.js` on it, as in step 3. Each line reports `cjk` or `latin`, the dominant script of that transcript. Tell the user if it is not the language they expected.

7. **Verify.** You are done when all of these hold:
   - The count of pdf, pptx, zip and txt files under `<root>` matches the manifests.
   - Every `.pdf` starts with `%PDF`.
   - Every `.zip` and `.pptx` passes `python -c "import zipfile,sys; assert zipfile.ZipFile(sys.argv[1]).testzip() is None" <file>`.

   Report the per-type counts, the pptx files with no pdf twin, and anything skipped.

## Gotchas

- Inside a course page the player is a cross-origin iframe, so a script on `cool.ntu.edu.tw` cannot see subtitle requests. This is why steps 4–5 talk to the cool-video API directly.
- `/api/courses/CID/videos` on cool-video returns 403. There is no course-wide video list, so the video-source ids come from the Canvas module items' `external_url`.
- Resubmitting the Canvas LTI form yourself returns 401 because its nonce was already used. Always use `sessionless_launch`. Its `verifier` URL works without cookies, which is what lets token mode run headless.
- Launching a video may register a view in COOL's viewing records. Tell the user before opening videos in a course that is still running.
- These endpoints are undocumented and may change.
