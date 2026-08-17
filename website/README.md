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

## RESOLVED 2026-08-17 — and a correction

The site has since been **recovered byte-exactly from production and placed
under version control** at `C:\uncluttrd-website` (outside this repo, because
`C:\uncluttrd54\.gitignore` is an EAS fingerprint input). That repo is now the
source of truth. Deploys remain drag-and-drop to Netlify; nothing has been
deployed.

**Correction to an earlier claim in this file and in the report that accompanied
it.** It stated the live pages "link to NONE" of the legal pages. **That was
wrong.** The footers *do* link to `/privacy`, `/terms` and `/partners` on all
four pages. The error was mine: my grep matched only double-quoted `href`
attributes, and the site uses single quotes for exactly those links
(`href='/privacy'`).

What is actually true after inspecting the recovered files:

| Page | `/privacy` | `/terms` | `/partners` | `/disclosure` |
|---|---|---|---|---|
| `index.html` | yes | yes | yes | **no** |
| `terms.html` | yes | yes | yes | **no** |
| `partners.html` | yes | yes | yes | **no** |
| `privacy.html` | yes | yes | **no** | **no** |

So the footer work is much smaller than described: add `/disclosure` to all four
pages, and add the missing `/partners` link to `privacy.html`. The disclosure
page itself is still genuinely absent (`/disclosure` returns 404) and there is
**zero** affiliate or FTC language anywhere in the real markup — confirmed after
stripping the 537 KB base64 blob that was producing false keyword matches.

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
