# Website assets — READY TO DEPLOY, NOT DEPLOYED

**Nothing in this folder is live.** These are prepared artifacts for
`uncluttrd.app`, staged here because deployment is blocked. See below.

| File | Purpose | Status |
|---|---|---|
| `disclosure.html` | New `/disclosure` page (affiliate disclosure) | **not deployed** |
| `footer-snippet.html` | Canonical footer for every page | **not applied** |

---

## Why this could not be deployed

`uncluttrd.app` is served by **Netlify** (confirmed from the `Server: Netlify`
and `X-Nf-Request-Id` response headers). Deploying requires access this
environment does not have, and — more importantly — **there is no
version-controlled source for the website anywhere on this machine.**

What was actually found, after searching:

| Location | Contents |
|---|---|
| `C:\uncluttrd54` (this repo) | no site source; `marketing/` is design assets only |
| `C:\Users\mharr\uncluttrd-auth-hosting` | a **stock Firebase Hosting placeholder** (`Welcome to Firebase Hosting`), unrelated to the live site |
| `C:\Users\mharr\Downloads` | **~34 candidate `index*.html` files**, none confirmed to match live |

The closest Downloads candidate, `index_final_transparent_phone.html`
(567,578 bytes), is **143 bytes off** the live homepage (567,721 bytes) — close
enough to be a near-ancestor, **not close enough to treat as the source**.

Critically, `/privacy`, `/terms` and `/partners` are real, distinct pages
(6.6 KB / 9.9 KB / 24.5 KB) that exist **only on Netlify**. No local copy of any
of them exists. Editing a stale download and redeploying would risk overwriting
the live public site with an older version — an outward-facing, hard-to-reverse
change. That is why this stopped here rather than proceeding.

---

## What still needs to happen

1. **Identify the authoritative source.** Either a Netlify-connected Git repo,
   or confirmation that deploys are drag-and-drop from a local folder.
2. **Put the site under version control.** Four public pages currently have no
   source of truth outside Netlify itself, and the working copy appears to be
   whichever `index (N).html` was most recently edited. That is the actual
   root problem here; the missing disclosure page is a symptom.
3. Then apply `disclosure.html` and `footer-snippet.html`.

---

## Applying the changes, once access exists

**New page:** deploy `disclosure.html` at `/disclosure`. It is self-contained
and matches the existing `/privacy` template exactly — same `:root` custom
properties, same `nav`, same `.privacy-card`, same footer styles — so it will
not look foreign next to the pages already live.

**Footer:** apply `footer-snippet.html` to all five pages.

- On the **homepage**, paste the `<style>` block **and** the `<footer>`. The
  homepage has no footer styles of its own.
- On `/privacy`, `/terms`, `/partners`, paste the **`<footer>` element only** —
  those pages already define `footer`, `footer a` and `.footer-copy`.

**Verification after deploy** (all four currently fail on at least one point):

```
curl -sI https://uncluttrd.app/disclosure          # expect 200 (currently 404)
curl -s  https://uncluttrd.app | grep -o 'href="/disclosure"'
curl -s  https://uncluttrd.app | grep -o 'href="/privacy"'
curl -s  https://uncluttrd.app/privacy | grep -o 'href="/disclosure"'
curl -s  https://uncluttrd.app/partners | grep -o 'href="/privacy"'
```

Then check the footer visually at desktop width and at ≤640 px, where the
media query switches the links to wrapped `inline-block` with larger tap
targets.
