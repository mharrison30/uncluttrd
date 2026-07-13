# Uncluttrd Architecture

Last updated: June 2026
Status: living document. Update it whenever an architectural decision is made, not after.

This document explains how Uncluttrd is built and, more importantly, why. It exists so that future decisions stay consistent with past ones, and so anyone joining the project can understand the shape of the system without reading every line of code.

---

## 1. What Uncluttrd is

Uncluttrd is the platform for owning things. The world has plenty of apps for buying. Uncluttrd is the operating system for everything that happens after the purchase.

Every feature is a verb in the lifecycle of ownership:

- **Organize** (live): photograph a cluttered space, get an AI organization plan across Budget, Mid-Range, and Premium tiers.
- **Find** (next): photo-based home inventory. Know what you own and where it is.
- **Move**, **Sell**, **Donate**, **Share** (future): each a different action taken on the same owned items.

The strategic point: these are not separate apps. They are workflows on top of one shared data layer. An item you photograph in Find is the same item you later list in Sell or pack in Move. Nothing gets re-entered. This is why the architecture centers on a shared ownership model rather than on individual features.

---

## 2. North Star

Our mission is to reduce the friction of ownership. Everything we build should improve one of four outcomes for the user:

- Know what you own.
- Know where it is.
- Know what it is worth.
- Know what to do with it next.

These four outcomes are the business in one frame, and they map directly onto the modules. "What you own" and "where it is" are Find. "What it is worth" is valuation. "What to do next" is the action modules (Move, Sell, Donate, Share). If a feature does not improve one of these four, it is probably not an Uncluttrd feature. This keeps engineering work aligned with the business rather than drifting toward whatever is technically interesting.

---

## 3. Guiding principles

These are decision filters. When a feature, a refactor, or a structural choice is on the table, run it through these before committing. They exist so that six months from now the answer to "should we build this" has a consistent basis rather than depending on the mood of the week.

- **One ownership database. Many workflows.** The shared graph is the product. Features are lenses on it.
- **Modules own UI. Shared data owns business rules.** A screen lives in a module. The rules about what an item is live in `data/`.
- **Extract only when it simplifies the next feature.** Refactor in service of the next thing you are building, not for tidiness alone.
- **Optimize for the common user path before edge cases.** Make the thing most people do most often excellent first.
- **Every new feature must strengthen the ownership graph.** If a feature does not make the shared data more valuable, question whether it belongs.
- **Keep the AI behind our own API layer.** Vendors are called through our Cloud Functions, never directly from the app.
- **Prefer incremental evolution over rewrites.** Move one piece at a time, keep the app running, never stop the business for a perfect refactor.

The sharpest of these as a filter: "Does this strengthen the ownership graph?" If the answer is no, it probably does not belong in Uncluttrd.

---

## 4. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | React Native / Expo | iOS first, Android to follow |
| Language | JavaScript (ES6+) | Migrating the shared data model to TypeScript incrementally. See section 11. |
| Auth | Firebase Auth | Email/password, AsyncStorage persistence |
| Database | Firestore | NoSQL, household-scoped |
| File storage | Firebase Storage | Photos, thumbnails, visualizations |
| Subscriptions | RevenueCat | Monthly $4.99, Yearly $39.99, bundle `com.mharrison.uncluttrd` |
| AI (analysis) | Claude (Anthropic) | Photo to organization plan |
| AI (visualization) | gpt-image-2 (OpenAI) | Before/after space visualization, Pro only |
| Secrets | Firebase Cloud Functions | API keys never live in the app binary. See section 7. |
| Build | EAS (Expo App Services) | Production builds and App Store submission |
| Icons | Lucide React Native | strokeWidth 2.25 |
| Fonts | Inter | weights 400, 500, 600, 700 |

---

## 5. Folder philosophy

The codebase is organized by responsibility, not by file type. The target structure:

```
src
├── app          App shell: navigation, providers, auth gate
├── core         Cross-cutting helpers that are ours, not a vendor's
├── services     One file per external integration (the vendor plumbing)
├── data         Domain read/write logic (our business logic)
├── modules      Feature modules, one folder each
├── shared       Reusable UI components used across modules
└── theme        Colors, spacing, typography tokens
```

### The rule that decides where code goes

This is the distinction worth keeping crisp, because it is the one that gets blurry first.

- **services/** is for talking to an outside vendor. `services/claude.js`, `services/gptImage.js`, `services/firebase.js`, `services/revenueCat.js`. If the vendor disappeared, this file would be rewritten or deleted.
- **data/** is for our logic that happens to use a vendor. `data/organizeData.js`, `data/findData.js`. These hold the queries, collection shapes, and domain rules. If we migrated off Firestore tomorrow, the data files change but the concept of "a plan" or "an item" does not.
- **core/** is for helpers that are ours and belong to no single vendor or feature. Image compression, formatting utilities, ID generation.

Quick test: "Is this code about a vendor, about our data, or about neither?" That answers which folder.

### Create folders empty, fill them on demand

The structure is laid out for six modules and many services, but we do not write speculative files. `services/claude.js` and `services/firebase.js` are real today. `services/affiliate.js` and `services/analytics.js` do not get created until the feature that needs them arrives. Build the skeleton, not the speculative flesh.

---

## 6. The ownership graph

Everything a person owns has a location, a condition, and a next best action. All modules read from and write to this same model. One ownership database, many workflows.

### Households

Data is scoped to a household, not just a user. A household has an owner and members, so that a family shares one inventory rather than maintaining separate copies. This is why Find and everything after it is household-scoped from day one, even though Organize v1 was user-scoped.

### Locations are recursive

There is no separate concept of "container" versus "room" versus "shelf." Everything is a **Location** with a `type` field and a `parentLocationId` pointing at its parent. A garage contains a shelving unit contains a bin contains an item, and every level is the same shape.

To make breadcrumbs and ancestor queries instant, locations are denormalized with:
- `path`: array of ancestor location IDs from root to here.
- `pathNames`: array of ancestor names, for displaying a breadcrumb without extra reads.

### Items and search

An item belongs to a location and carries its own photos. To support search without a separate search service, each item stores a `searchTerms` array that Firestore can query directly.

### Actions are first-class

An action (organize, move, sell, donate, share) is its own object with flexible metadata per workflow type, rather than a flag on the item. This is what lets the same item flow through multiple workflows over time without the item record getting cluttered with workflow-specific fields.

---

## 7. AI flow and the proxy

API keys never live in the app binary. The app calls our own Firebase Cloud Functions, which hold the keys as encrypted Firebase secrets and call the AI providers server-side. To rotate a key, we change one server-side secret with zero app rebuilds.

```
Photo
  ↓
App calls analyzePhoto (Cloud Function)
  ↓
Claude analyzes the photo, returns a three-tier plan
  ↓
Plan saved to Firestore
  ↓
(Pro) App calls generateVisualization (Cloud Function)
  ↓
gpt-image-2 returns a before/after image, uploaded to Firebase Storage
```

Current functions, deployed to `us-central1`:
- `analyzePhoto`: wraps the Anthropic call.
- `generateVisualization`: wraps the gpt-image-2 call (300s timeout, 512MiB).

Planned hardening: App Check, so only the real app can call these functions and abuse cannot run up the AI bill.

---

## 8. Firestore schema

### Live today (Organize v1)

```
users/{uid}/plans/{planId}
  schemaVersion: 1
  createdAt, date, spaceType
  overview, itemsFound
  tiers: [{ id, steps[], products[] }]
  proTip
  vizImages: {}
  photoUrl

  # Companion (Jul 2026) — Pro only; free-tier Companion state is
  # in-memory for the session and never written here. See
  # CompanionDesignPrinciples.md and DecisionLog.md 2026-07-13.
  firstAction: { text, status, suggestedAt, startedAt, completedAt }
  companionAction: { actionIndex, text, status, suggestedAt, startedAt, completedAt } | null
  companionActionHistory: [{ actionIndex, text, startedAt, completedAt }]
  progressPhotos: [{ actionIndex, url, uploadedAt }]

viz/{uid}/...   visualization images
plans/{uid}/{planId}/original.jpg     original source photo
plans/{uid}/{planId}/progress/...     Companion progress photos
```

`schemaVersion` is now actually stamped on newly created plan documents (it previously appeared in this doc but was not implemented in code — corrected Jul 2026 alongside the Companion field additions, since extending this document's shape is exactly the case this field exists for). Older plan documents predating this fix do not have it and are not backfilled.

Security rules are user-scoped: a user can only read and write their own documents. Firestore rules are version-controlled at `firestore.rules` (added Jul 2026 — previously console-only, the same gap that caused the Storage permission-denied incident logged in DecisionLog.md).

### Designed for Find (not yet implemented)

Household-scoped ownership graph as described in section 6. Roughly:

```
households/{householdId}
  schemaVersion: 1
  ownerId, memberIds[], name, createdAt

households/{householdId}/locations/{locationId}
  schemaVersion: 1
  name, type, parentLocationId
  path[], pathNames[]          denormalized for breadcrumbs

households/{householdId}/items/{itemId}
  schemaVersion: 1
  name, locationId, condition
  photos[], searchTerms[]
  createdAt, updatedAt

households/{householdId}/actions/{actionId}
  schemaVersion: 1
  itemId, type, status, metadata{}
```

Note: v1 plan data stays where it is. The household model lives alongside it. No migration of existing v1 data is required.

### Why every major document carries schemaVersion

Each top-level document (plans, households, locations, items, actions) stores a `schemaVersion` field, starting at 1. You may never need it. But the first time a future version changes how a document is shaped (for example, if Find v4 reworks how locations nest), this field is what makes migration and backward compatibility tractable: code can read the version and handle old and new shapes side by side, rather than guessing or forcing a risky bulk migration. It costs one integer per document now and saves a great deal of pain later.

---

## 9. Find MVP scope

The ownership graph in sections 6 and 8 can support far more than the first version of Find should ship. Without an explicit boundary, Find expands to fill everything the schema allows, and a clean module becomes the next monolith. This section draws the line.

**One-sentence definition of Find v1:** photograph an item, assign it to a location, and find it again later by searching. That is the whole MVP.

### In scope (v1)

- Add an item by photo, with a name and a location.
- A small set of item fields: name, photo, location, condition, optional note.
- Locations that nest, but only a few levels deep to start (for example: room, then furniture or container, then item). Not arbitrary infinite depth yet.
- Browse by drilling into a location and seeing what is inside.
- Search across items by name, using the `searchTerms` array so Firestore handles it natively with no separate search service.
- Single active household assumed. The data is household-scoped (so nothing has to be remodeled later), but v1 behaves as if there is one member.

### Out of scope for v1 (deferred, with the reason)

- **Actions (the `actions` collection).** Actions are what connect Find to Move, Sell, and Donate. Those modules do not exist yet, so there is nothing to connect to. The collection is in the schema, but Find v1 writes nothing to it. Defer until the first action-based module is built.
- **Multi-member household sharing and invites.** The model supports it; the UI and the invite flow are real work that does not make the core "find my stuff" loop better. Fast-follow, not v1.
- **Deep arbitrary location nesting.** Cap depth in v1 to keep the browse UI and breadcrumbs simple. The `path` and `pathNames` design already supports going deeper later with no migration.
- **Bulk import or moving items between locations in bulk.** Single-item add and edit only to start.

### One open scope decision: AI object recognition

This is the genuine call to make before building, not something to default into.

The long-term Find vision includes AI that looks at a photo and identifies the objects in it, so the inventory partly fills itself. That is also the feature that makes Find feel like an Uncluttrd product rather than a generic inventory app, since it reuses the same photo-to-AI muscle Organize already has.

The tension: manual entry (snap a photo, type the name) is simpler, more reliable, and fully sufficient to prove the core loop. AI recognition adds a Cloud Function, cost per scan, and a whole class of "it guessed wrong" UX to handle.

Two honest options:
- **Manual-first (lower risk):** ship v1 with manual item naming, add AI recognition as v1.1 once the core loop is proven. Recommended if the goal is to validate that people will inventory their homes at all.
- **AI-from-day-one (higher differentiation):** include recognition in v1 because it is the magic moment and the reason to choose Uncluttrd over a notes app. Reasonable if the bet is that manual entry is too much friction for anyone to actually do it.

This one is a product judgment, not an architecture one. Worth deciding deliberately and recording the choice in the decisions log.

### What "done" looks like for v1

A user can photograph ten things around their house, put them in locations, close the app, come back a week later, search a name, and find where the item is. If that loop works and feels good, Find v1 is done. Everything else is a later version.

---

## 10. Module philosophy

A module is a feature with its own screens, its own local state, and its own data access, that reads the shared ownership model through `data/`. Modules do not reach into each other. If two modules need the same thing, that thing belongs in `data/`, `core/`, or `shared/`, not copied between modules.

`App.js` is the front door only: auth state, navigation, and global providers. It is not the home of any single feature. Organize is a peer module sitting alongside Find, History, and Profile, not the thing the app shell is built around.

---

## 11. State management strategy

Today the app uses a single large pile of `useState` inside one component. The target is to split state by how often it changes, rather than adopt one global tool for everything.

1. **Identity and session state** (current user, isPro/subscription, household, theme): **React Context**. Stable, every screen needs it, changes rarely. This Context layer goes in before Find, since Find is the first module that touches all of it.
2. **Feature state** (Find's search text, active filters, the location being browsed): **local to the module**. Most of it never needs to leave Find, so it should not be global.
3. **Shared fast-changing state**, if it ever genuinely needs to cross modules: **Zustand**. It is tiny, needs no provider, and re-renders only the components reading the specific slice that changed, which is the thing React Context cannot do efficiently.

We do not expect to need Redux. The Context plus local plus Zustand combination is sufficient for an app of this size, and can be revisited only if Uncluttrd grows into a much larger platform with many independent feature teams.

Why not just one global Context for everything: a Context re-renders every consumer whenever its value changes. That is fine for session state that rarely changes, but a performance problem for search state that changes on every keystroke. Find introduces fast-changing shared state for the first time, which is exactly why the split matters now and did not before.

---

## 12. Naming conventions

- **Services** answer: "How do we talk to this vendor?" One file per integration.
- **Data** answers: "How do we read and write our domain objects?" One file per domain area.
- **Core** answers: "What helper is ours and belongs nowhere else?"
- **Modules** answer: "What does this feature do?" One folder per feature.
- **Shared** answers: "What UI do multiple modules reuse?"
- Files that talk to a vendor are named for the vendor (`claude.js`), not the capability (`ai.js`), so a second vendor in the same category gets its own file rather than a tangle.

---

## 13. Roadmap

Near term:
1. Extract App.js into the `src` structure, one structural change per commit.
2. Introduce the session Context layer.
3. Build Find: data layer, then screens.

Later modules, each an action on the same owned items:
- Move
- Sell
- Donate
- Share

Possible longer-term directions worth holding in mind but not building toward yet: dedicated storage/insurance use cases, deeper household features, and affiliate or marketplace integrations. These are noted so future decisions can leave room for them, not because they are committed.

---

## 14. Why this architecture creates enterprise value

This section is not for engineers. It is the bridge between how the product is built and why that construction is worth investing in. The architecture is not just clean, it is a business strategy expressed in code.

- **One ownership graph powers multiple revenue-generating workflows.** Organize, Find, Move, Sell, and Donate are not separate products to be built and sold separately. They are workflows on a single shared dataset, so the cost of adding the next one is a fraction of building a standalone app.
- **Every module increases the value of the shared data.** Each feature a user adopts enriches the same ownership graph. The more they use, the more complete and accurate their inventory becomes, which makes every other workflow more useful. The data compounds.
- **New modules reuse existing infrastructure instead of duplicating it.** Auth, storage, the AI proxy, the data layer, and the design system are built once and shared. Module number five ships faster and cheaper than module number two.
- **Customer lifetime value grows as more workflows are adopted.** A user who only organizes is worth less than one who organizes, inventories, and sells. The architecture is designed for that expansion, so revenue per user can grow without acquiring a new user.

The short version for an investor: the shared ownership graph is a moat that deepens with every feature and every active user, and the module architecture means each new revenue stream is built on top of paid-for infrastructure rather than from scratch.

---

## Appendix: decisions log

Keep a running list here of choices made and the reason, so future-you does not have to reconstruct the thinking.

- **Keys moved server-side (June 2026):** API keys were hardcoded in the binary and kept leaking during file sharing. Moved to Cloud Functions with encrypted secrets so keys never ship in the app and rotate without a rebuild.
- **Find is a module, not a separate app (June 2026):** keeps brand equity under one name and lets all modules share one ownership database. Modeled on the Apple Music / Apple Pay naming convention.
- **Locations are recursive, no container/space split (June 2026):** a single Location type with a parent pointer covers rooms, furniture, and bins uniformly, removing a needless distinction.
- **TypeScript for the shared data model only (June 2026):** types pay off most where modules must agree on a shared shape, and cost the least when scoped to one file, so the data model is typed first while the rest stays JavaScript.
- **schemaVersion reserved on all major documents (June 2026):** one integer per document now makes future schema migrations and backward compatibility tractable instead of risky.
