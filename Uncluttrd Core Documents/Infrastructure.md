# Uncluttrd Infrastructure

Last updated: July 2026
Status: Living document. Records domain, DNS, and hosting-level infrastructure that sits outside the app's own architecture (see Architecture.md for product/data architecture).

---

## Domain & Email

**Registrar:** Namecheap (`uncluttrd.app`)

**Email:** Namecheap Private Email — 3 mailboxes available. `hello@uncluttrd.app` created and active as of Jul 2026.

### Required DNS records — Namecheap Private Email

| Type | Host | Value | Priority |
|---|---|---|---|
| MX | @ | mx1.privateemail.com | 10 |
| MX | @ | mx2.privateemail.com | 10 |
| TXT | @ | `v=spf1 include:spf.privateemail.com ~all` | — |
| TXT | `default._domainkey` (or `privateemail._domainkey` for subscriptions from Jun 2026+) | DKIM value, auto-generated in Namecheap's Private Email dashboard after mailbox creation | — |
| TXT | `_dmarc` | `v=DMARC1; p=reject; rua=mailto:postmaster@uncluttrd.app` | Recommended, not yet added |

### Required DNS records — Firebase Auth email sending

Separate from Private Email — used for password reset / verification emails. Requires its own domain verification, added as additional records once Private Email is confirmed working.

| Type | Host | Value |
|---|---|---|
| TXT | @ | Merged into the same SPF record as Private Email — **must be one single SPF record with multiple includes, never two separate SPF TXT records at the same host; they conflict and break both.** |
| TXT | @ | `firebase=cluttrd-3e335` |
| CNAME | `firebase1._domainkey` | `mail-uncluttrd-app.dkim1._domainkey.firebasemail.com.` |
| CNAME | `firebase2._domainkey` | `mail-uncluttrd-app.dkim2._domainkey.firebasemail.com.` |

### Status as of Jul 9, 2026

- Private Email MX/SPF records added, mailbox created.
- Awaiting Namecheap support guidance on where to access/verify the setup.
- Firebase domain verification not yet started — pending Private Email confirmation first.
