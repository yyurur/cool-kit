# cool-kit

Small tools for NTU COOL. Currently one Claude Code skill: **ntu-cool-materials**.

It saves an NTU COOL course (slides, zips, notebooks, video transcripts) into per-module folders on your disk.

## Disclaimer

- **Unofficial.** Not affiliated with, endorsed by, or supported by NTU COOL or Instructure (Canvas). Those names belong to their owners.
- **Use at your own risk.** The software is provided as is, without warranty (see [LICENSE](LICENSE)). The author is not responsible for any consequence of using it, including account restrictions, violations of school or course rules, or traces left in course logs. Check your school's and instructors' rules yourself.
- **Personal study only.** Use it for courses you are enrolled in. Do not bulk-scrape, do not redistribute course content, and respect the instructors' copyright.
- **Credentials.** Nothing you enter or save is sent anywhere except NTU COOL's own servers. An access token gives full access to your account: keep it out of chats, files, and git.
- **May break.** It relies on undocumented endpoints that can change at any time.

## Install

Copy the `ntu-cool-materials` folder to `~/.claude/skills/` (Windows: `C:\Users\<you>\.claude\skills\`), then start a new Claude Code session. Requires Node 18+.

## Use

Ask Claude, for example:

> Download the materials of https://cool.ntu.edu.tw/courses/12345 into ~/study/my-course. Slides, notebooks and video transcripts only, skip the projects.

## What you get

```
<root>/
  Week 01 - 9-6, Intro/
    Lecture.pdf
    Lecture video.txt        <- cleaned transcript (cool-video videos)
    video-links.txt          <- YouTube links (not downloaded)
  02 Lecture 1 - Basics/     <- modules without "Week N" are numbered by position
```

## Login: two modes

- **Token mode** (no browser, no password): set a COOL access token as the `COOL_TOKEN` environment variable, then Claude runs `token-sync.js`. Your school may hide or disable token creation; if you do create one, set a short expiry. The token has full access to your account, so keep it out of chats, files and git.
- **Browser mode**: Claude drives a browser you have signed in to. You type your own credentials; Claude never does.
