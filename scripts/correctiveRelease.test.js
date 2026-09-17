/**
 * 2.2.1 corrective release: Call 2 progress state, My Rooms freshness, and the
 * copy corrections.
 *
 *   node --test scripts/correctiveRelease.test.js
 *
 * Three defects and four inaccurate claims shipped together in 2.2.0:
 *
 *   - A plan created through Room confirmation reached the Results screen with
 *     no analysisStage, so planAnalysisStage() read its own backward-compat
 *     default "complete" and the expander rendered the detail branch with no
 *     detail in it - an empty card for the whole ~30-70s Call 2 runs.
 *   - My Rooms was a mount-time snapshot: the analysis paths created the Space
 *     document and never told the list, and the screen is an early return in
 *     the same component, so it never remounted or re-queried. A first-ever
 *     analysis was followed by "No rooms yet".
 *   - The paywall, FAQ and onboarding claimed priority results, full room
 *     history, Google Shopping links and direct product links. None existed.
 *
 * The room helpers and loader are LIFTED OUT OF App.js AND EXECUTED here, with
 * their I/O injected, so the de-duplication and stale-reload behaviour is
 * tested rather than pattern-matched. The rest is asserted against the source,
 * which is the right instrument for a render branch or a copy string.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "App.js"), "utf8").replace(/\r\n/g, "\n");
const CONFIG = fs.readFileSync(path.join(ROOT, "app.config.js"), "utf8").replace(/\r\n/g, "\n");
const pdf = require("../shared/pdfExport");

/** Lifts a region of the real source so the tests run the shipping code. */
function region(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  assert.ok(a > 0, `not found in App.js: ${startMarker}`);
  const b = SRC.indexOf(endMarker, a);
  assert.ok(b > a, `end marker not found after ${startMarker}: ${endMarker}`);
  return SRC.slice(a, b + endMarker.length);
}

/** The FAQ array, evaluated for a given Platform.OS. */
function faqsFor(os) {
  const src = region("const faqs = [", "\n    ];");
  return new Function("Platform", `${src}\nreturn faqs;`)({ OS: os });
}

// ---- 1. the room helpers, executed ----------------------------------------

const upsertRoomById = new Function(
  `${region("function upsertRoomById(list, room) {", "\n}")}\nreturn upsertRoomById;`,
)();

test("upsertRoomById inserts a new Room at the front", () => {
  const out = upsertRoomById([{ id: "b" }], { id: "a", displayName: "Office" });
  assert.deepEqual(out.map((r) => r.id), ["a", "b"], "newest first, matching loadRooms' own sort");
  assert.equal(out[0].displayName, "Office");
});

test("upsertRoomById never produces a duplicate, whatever the insert site", () => {
  // The exact race the reload introduces: a local insert lands, the reload
  // returns carrying the same Room, and both want to add it.
  let list = [];
  list = upsertRoomById(list, { id: "space-1", displayName: "Home Office" });
  list = upsertRoomById(list, { id: "space-1", displayName: "Home Office" });
  assert.equal(list.length, 1, "one Space id, one card");
  assert.equal(list.filter((r) => r.id === "space-1").length, 1);
});

test("upsertRoomById MERGES an existing Room rather than replacing it", () => {
  // A refresh that carries only some fields must not blank the rest - the
  // Room's displayName survives a summary-only update.
  const list = upsertRoomById(
    [{ id: "space-1", displayName: "Home Office", createdAt: "2026-01-01" }],
    { id: "space-1", lastOrganizedAt: "2026-09-17" },
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, "Home Office", "an unrelated field must survive");
  assert.equal(list[0].createdAt, "2026-01-01");
  assert.equal(list[0].lastOrganizedAt, "2026-09-17");
});

test("upsertRoomById ignores a Room with no id, rather than inserting a keyless card", () => {
  assert.deepEqual(upsertRoomById([{ id: "a" }], null), [{ id: "a" }]);
  assert.deepEqual(upsertRoomById([{ id: "a" }], {}), [{ id: "a" }]);
});

test("every local insert into rooms goes through the shared helper", () => {
  // The rule this suite exists to keep: no call site rolls its own insert.
  // submitNewRoomName used to prepend with no id check at all.
  const inserts = SRC.match(/mutateRooms\(\(prev\) => \[/g) || [];
  assert.deepEqual(inserts, [], "a bare prepend bypasses upsertRoomById");
  assert.ok(SRC.includes("mutateRooms((prev) => upsertRoomById(prev, room));"), "submitNewRoomName");
  assert.ok(SRC.includes("mutateRooms((prev) => upsertRoomById(prev, restored));"), "handleRestoreRoom");
  assert.ok(SRC.includes("mutateRooms((prev) => upsertRoomById(prev, { id: targetRoomId, ...freshRoom.data() }));"), "runClassify");
  assert.ok(SRC.includes("mutateRooms((prev) => upsertRoomById(prev, { id: spaceId, ...snap.data() }));"), "refreshRoomFromSpace");
});

test("only loadRooms writes rooms directly; every mutation bumps the revision", () => {
  // setRooms outside loadRooms/mutateRooms would be a mutation an in-flight
  // reload could silently revert.
  const direct = SRC.match(/setRooms\(/g) || [];
  assert.equal(direct.length, 2, "expected exactly setRooms(updater) in mutateRooms and setRooms(nonRetired) in loadRooms");
  assert.ok(SRC.includes("roomsRevisionRef.current += 1;\n    setRooms(updater);"), "mutateRooms must bump before it sets");
});

// ---- 2. the loader, executed, against the stale-reload race ----------------

/** Builds loadRooms with its I/O injected, over a controllable query. */
function makeLoader({ serverRooms, onQuery }) {
  const src = region("const loadRooms = async (reason) => {", "\n  };");
  const state = { rooms: null, recentlyDeleted: null, revision: { current: 0 }, logs: [] };
  const deps = {
    user: { uid: "u1" },
    db: {},
    collection: () => ({}),
    getDocs: async () => {
      if (onQuery) await onQuery(state);
      return { docs: serverRooms.map((r) => ({ id: r.id, data: () => r })) };
    },
    dlog: (l) => state.logs.push(l),
    console: { log: () => {} },
    setRooms: (v) => { state.rooms = v; },
    setRecentlyDeletedRooms: (v) => { state.recentlyDeleted = v; },
    roomsRevisionRef: state.revision,
  };
  const loadRooms = new Function("deps", `
    const { user, db, collection, getDocs, dlog, console, setRooms, setRecentlyDeletedRooms, roomsRevisionRef } = deps;
    ${src}
    return loadRooms;
  `)(deps);
  return { loadRooms, state };
}

test("a reload replaces the list when nothing changed while it was in flight", async () => {
  const { loadRooms, state } = makeLoader({
    serverRooms: [{ id: "s1", displayName: "Kitchen", createdAt: "2026-01-01" }],
  });
  await loadRooms("my-rooms-open");
  assert.equal(state.rooms.length, 1);
  assert.equal(state.rooms[0].id, "s1");
  assert.deepEqual(state.logs, [], "no discard on the quiet path");
});

test("a reload that began before a local insertion does NOT remove that Room", async () => {
  // The exact sequence the fix exists for: My Rooms opens and queries, the
  // pending Space write commits, refreshRoomFromSpace inserts the new Room,
  // and only then does the stale query come back without it.
  const { loadRooms, state } = makeLoader({
    serverRooms: [{ id: "old-room", displayName: "Kitchen" }], // no new-room yet
    onQuery: (s) => {
      s.revision.current += 1;                                  // mutateRooms
      s.rooms = [{ id: "new-room", displayName: "Home Office" }, { id: "old-room" }];
    },
  });
  await loadRooms("my-rooms-open");
  assert.ok(state.rooms.some((r) => r.id === "new-room"), "the new Room must survive the stale reload");
  assert.equal(state.rooms.length, 2);
  assert.match(state.logs.join("\n"), /discarded a my-rooms-open reload/);
});

test("a discarded reload leaves Recently Deleted alone too", async () => {
  // Both lists come from the one snapshot, so a snapshot that is too old for
  // one is too old for the other.
  const { loadRooms, state } = makeLoader({
    serverRooms: [{ id: "s1" }],
    onQuery: (s) => { s.revision.current += 1; },
  });
  await loadRooms("mount");
  assert.equal(state.recentlyDeleted, null, "nothing from a discarded snapshot may be applied");
});

test("a reload with no signed-in user does nothing at all", async () => {
  const src = region("const loadRooms = async (reason) => {", "\n  };");
  let queried = false;
  const loadRooms = new Function("deps", `
    const { user, db, collection, getDocs, dlog, console, setRooms, setRecentlyDeletedRooms, roomsRevisionRef } = deps;
    ${src}
    return loadRooms;
  `)({
    user: null, db: {}, collection: () => ({}),
    getDocs: async () => { queried = true; return { docs: [] }; },
    dlog: () => {}, console: { log: () => {} },
    setRooms: () => {}, setRecentlyDeletedRooms: () => {}, roomsRevisionRef: { current: 0 },
  });
  await loadRooms("mount");
  assert.equal(queried, false);
});

// ---- 3. the single central update point -----------------------------------

test("the Space write is the one place My Rooms learns about a new analysis", () => {
  const save = region("writeSpaceShadowStructure(user.uid, docRef.id, entry, shadowPhotoUrl)", "});");
  assert.match(save, /shadowResult\?\.outcome === "written"/, "only a committed write may announce a Room");
  assert.match(save, /refreshRoomFromSpace\(shadowResult\.spaceId\)/);
  // One caller, so all three analysis-creation paths share it by construction.
  assert.equal((SRC.match(/writeSpaceShadowStructure\(user\.uid/g) || []).length, 1);
  assert.equal((SRC.match(/refreshRoomFromSpace\(/g) || []).length, 1, "exactly one call site");
  assert.ok(SRC.includes("const refreshRoomFromSpace = async (spaceId) => {"), "and one definition");
  // And one plan-creation chokepoint feeding it.
  assert.equal((SRC.match(/addDoc\(collection\(db, "users", user\.uid, "plans"\)/g) || []).length, 1);
});

test("a failed Space write adds nothing to My Rooms", async () => {
  // writeBatch is all-or-nothing: outcome "failed" means there is no Space
  // document, so a card would be a lie the next reload silently corrects.
  const src = region("const refreshRoomFromSpace = async (spaceId) => {", "\n  };");
  const calls = [];
  const make = (snap) => new Function("deps", `
    const { user, db, doc, getDoc, dlog, mutateRooms, upsertRoomById } = deps;
    ${src}
    return refreshRoomFromSpace;
  `)({
    user: { uid: "u1" }, db: {}, doc: () => ({}),
    getDoc: async () => snap, dlog: () => {},
    mutateRooms: (fn) => calls.push(fn([])), upsertRoomById,
  });

  await make({ exists: () => false, data: () => ({}) })("gone");
  assert.deepEqual(calls, [], "a missing Space must not be shown");

  await make({ exists: () => true, data: () => ({ retired: true }) })("merged-away");
  assert.deepEqual(calls, [], "a retired Space is a merge loser and is filtered everywhere else too");

  await make({ exists: () => true, data: () => ({ displayName: "Home Office" }) })("s1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [{ id: "s1", displayName: "Home Office" }]);
});

test("My Rooms reloads when it is opened", () => {
  assert.ok(SRC.includes('if (showHistory) loadRooms("my-rooms-open");'));
  assert.match(region('if (showHistory) loadRooms("my-rooms-open");', "[showHistory]);"), /\[showHistory\]\);/);
  assert.ok(SRC.includes('loadRooms("mount");'), "the mount load must still happen");
});

// ---- 4. Call 2 progress state ---------------------------------------------

test("a plan from the Room-confirmation path carries analysisStage before Call 2", () => {
  const confirmed = region("const confirmedPlan = {\n      ...pending.parsed,", "};");
  assert.match(confirmed, /analysisStage: "summary-ready",/,
    "stamped at construction, so the absolute setResults commits it whatever results held before");

  const save = region("const finishRoomConfirmationSave = async", "logEvent(getAnalytics(), \"plan_completed\");");
  const commit = save.indexOf("setResults(mergeUploadedPhotoUrl(confirmedPlan");
  const call2 = save.indexOf("runDetailCall(newPlanId, confirmedPlan)");
  assert.ok(commit > 0 && call2 > 0);
  // The ordering is unchanged on purpose - the fix is at the source, so the
  // object is already correct wherever it is committed.
  assert.ok(commit > call2, "the absolute commit still comes last, and still wins");
});

test("the three other new-plan paths still stamp the stage themselves", () => {
  const stamps = SRC.match(/analysisStage: "summary-ready"/g) || [];
  assert.ok(stamps.length >= 4, `expected the Firestore write plus each in-memory path, found ${stamps.length}`);
  assert.ok(SRC.includes('setResults({ ...parsed, canonicalSpaceId: returningContext.spaceId, spaceName: resolvedRoomName, analysisStage: "summary-ready" });'));
  assert.ok(SRC.includes('setResults({ ...parsed, canonicalSpaceId: returningContext.spaceId, spaceName: returningRoomName, analysisStage: "summary-ready" });'));
});

test("the expander renders loading, retry and content from the same stage value", () => {
  assert.ok(SRC.includes('{expanded && stage === "summary-ready" && ('), "loading/retry branch");
  assert.ok(SRC.includes('{expanded && stage !== "summary-ready" && ('), "content branch");

  const loading = region('{expanded && stage === "summary-ready" && (', "{expanded && stage !== \"summary-ready\" && (");
  assert.match(loading, /detailError \?/, "failure is a sub-state of the same branch");
  assert.match(loading, /Couldn't load full details\./);
  assert.match(loading, /Tap to retry/);
  assert.match(loading, /isRetry: true/);
  assert.match(loading, /Finishing the details\.\.\./);
  assert.match(loading, /<ActivityIndicator/);

  // planAnalysisStage's default is what makes a MISSING stage render as
  // finished content. That default is correct for pre-split plans and must
  // stay, which is exactly why the new plan has to carry the field.
  const resolver = region("const planAnalysisStage = (plan) => {", "\n  };");
  assert.match(resolver, /return plan\.analysisStage \|\| "complete";/);
});

test("Results layout is untouched: the card, its order and the toggle are as shipped", () => {
  assert.ok(SRC.includes('{expanded ? "Show less" : "See full details"}'));
  // Scoped to the expanded card, since the uppercase label text also appears
  // in the Call 2 prompt far earlier in the file.
  const card = region('{expanded && stage !== "summary-ready" && (', "{/* Approach-Aware Visualization:");
  assert.ok(card.includes("<Text style={s.prodLabel}>ORGANIZING GUIDANCE</Text>"));
  assert.ok(card.includes("<Text style={s.prodLabel}>PRODUCT RECOMMENDATIONS</Text>"));
  assert.ok(card.indexOf("ORGANIZING GUIDANCE") < card.indexOf("PRODUCT RECOMMENDATIONS"), "product placement unchanged");
});

// ---- 5. copy -------------------------------------------------------------

test("the paywall claims only what Pro actually does", () => {
  const paywall = region("{/* Free vs Pro comparison */}", "{/* Plan selector */}");
  assert.ok(!paywall.includes("Priority results"), "no priority path exists anywhere in the app or the functions");
  assert.ok(!paywall.includes("Full room history"), "My Rooms is not gated on Pro");
  assert.ok(!paywall.includes("3 rooms/month"), "the meter counts analyses, not rooms");
  assert.ok(!paywall.includes("Unlimited rooms"));
  assert.ok(paywall.includes('"3 analyses/month"'));
  assert.ok(paywall.includes('"Unlimited analyses"'));
  assert.ok(paywall.includes('"AI visualizations"'), "kept");
  assert.ok(paywall.includes('"Branded PDF exports"'), "kept");
});

/** The two comparison columns, as ordered lists of their benefit strings. */
function compareColumns() {
  const block = region("{/* Free vs Pro comparison */}", "{/* Plan selector */}");
  const freeStart = block.indexOf("<Text style={s.compareColHeader}>Free</Text>");
  const proStart = block.indexOf("Pro</Text>");
  assert.ok(freeStart > 0 && proStart > freeStart, "could not locate both column headers");
  const strings = (src) => [...src.matchAll(/^\s*"([^"]+)",$/gm)].map((m) => m[1]);
  return { free: strings(block.slice(freeStart, proStart)), pro: strings(block.slice(proStart)) };
}

test("the Pro column names the one gated Companion action, in its place", () => {
  const { pro } = compareColumns();
  assert.deepEqual(pro, [
    "Unlimited analyses",
    "AI visualizations",
    "Photo check-ins with next steps",
    "Branded PDF exports",
  ], "Pro benefits, in display order");
});

test("the Free column is unchanged", () => {
  const { free } = compareColumns();
  assert.deepEqual(free, [
    "3 analyses/month",
    "Text sharing",
    "Great for getting started",
  ], "Free benefits, in display order");
});

test("the new Pro row names the photo check-in, not the guidance around it", () => {
  // The row has to survive the accuracy assertion below, which is the whole
  // point of wording it as the ACTION (send a photo, get steps) rather than as
  // the guidance a free user already has.
  const { pro } = compareColumns();
  const row = pro.find((t) => /check-in/i.test(t));
  assert.ok(row, "no check-in row found");
  assert.ok(!/checklist/i.test(row));
  assert.ok(!/\bguidance\b/i.test(row));
  assert.ok(!/task/i.test(row));
  assert.ok(!/complete/i.test(row));
});

test("the Go Unlimited subtitle no longer claims room history", () => {
  const sub = region("<Text style={s.paywallSubtitle}>", "</Text>");
  assert.ok(!/room history/i.test(sub), sub);
  assert.equal(sub, "<Text style={s.paywallSubtitle}>Unlimited analyses, AI visualizations, and branded PDFs.</Text>");
});

test("no surface still advertises priority results or full room history", () => {
  assert.ok(!/priority results/i.test(SRC));
  assert.ok(!/full room history/i.test(SRC));
});

test("the FAQ photo answer matches the privacy policy, point for point", () => {
  const a = faqsFor("ios").find((f) => f.q === "Is my data secure?").a;
  assert.ok(!/not stored on our servers/i.test(a), "the claim that contradicted the policy and the code");
  assert.match(a, /resized copy of each photo with its saved plan/);
  assert.match(a, /progress photos/);
  assert.match(a, /visualization images/);
  assert.match(a, /Google Firebase/);
  assert.match(a, /kept for 30 days/);
  assert.match(a, /permanently removed from Uncluttrd's storage systems/);
  assert.match(a, /A record of the deleted plan, without those images, remains in your account until you delete your account/);
  assert.match(a, /Deleting your account deletes your plans, photos, visualization images, and progress photos/);
  // Not collapsed into "everything is deleted", which is what made the old
  // answer wrong in the first place.
  assert.ok(!/everything/i.test(a));
});

test("the FAQ describes the real product destination, and discloses the affiliate link", () => {
  const a = faqsFor("ios").find((f) => f.q.startsWith("The product links")).a;
  assert.ok(!/google shopping/i.test(a), "links go to Amazon and always have");
  assert.match(a, /Amazon search results/);
  assert.match(a, /As an Amazon Associate, Uncluttrd earns from qualifying purchases\./);
});

test("cancellation instructions match the platform the user is on", () => {
  const ios = faqsFor("ios").find((f) => f.q === "How do I cancel my subscription?").a;
  const android = faqsFor("android").find((f) => f.q === "How do I cancel my subscription?").a;
  assert.match(ios, /iPhone Settings/);
  assert.ok(!/Google Play/.test(ios));
  assert.match(android, /Google Play Store/);
  assert.match(android, /Payments and subscriptions/);
  assert.ok(!/iPhone/.test(android), "an Android user was being sent to a screen they do not have");
  assert.match(ios, /until the end of your billing period/);
  assert.match(android, /until the end of your billing period/);
});

test("the Pro FAQ answer carries both prices and names only what is gated", () => {
  const a = faqsFor("ios").find((f) => f.q === "What is Uncluttrd Pro?").a;
  assert.match(a, /\$2\.99 per month/);
  assert.match(a, /\$24\.99 per year/);
  assert.ok(!/room history/i.test(a));
  assert.match(a, /3 analyses per month/);
  // The single gated action, named as itself.
  assert.match(a, /photo-based progress check-ins that generate your next set of steps from what changed in the room/);
  assert.match(a, /unlimited analyses/);
  assert.match(a, /AI visualization/);
  assert.match(a, /branded PDF sharing/);
});

test("the saved-rooms answer answers only the question, with no tier language", () => {
  // It says where My Rooms is and what it holds. It makes no claim about what
  // Free includes or what Pro adds, in either direction - those belong in the
  // Pro answer and on the paywall, stated once.
  for (const os of ["ios", "android"]) {
    const a = faqsFor(os).find((f) => f.q === "Where are my saved rooms?").a;
    assert.equal(
      a,
      "Tap the ☰ menu and select 'My Rooms' to see all your past organization plans, synced across devices via your account.",
      `${os}: saved-rooms answer`,
    );
    for (const claim of [/\bfree\b/i, /\bpro\b/i, /upgrade/i, /subscription/i]) {
      assert.ok(!claim.test(a), `${os}: tier language ${claim} crept back into this answer`);
    }
  }
});

test("no user-facing string sells ordinary Companion guidance as a Pro benefit", () => {
  // The audit behind this: the checklist, ticking items off, carry-forward
  // and skip-with-reason, resuming a plan later, a fresh batch from switching
  // approach, and finishing a plan are ALL free - the only gated action is
  // submitting a progress photo (App.js, submitCompanionProgressPhoto's
  // isPro check) and what runs after it. A Pro claim over any of the rest is
  // contradicted by the user's own session, which is the worst kind to make.
  //
  // Phrases that would only ever appear in such a claim. Deliberately narrow:
  // "guidance" alone is fine and true when describing the plan itself, which
  // is why "How does Uncluttrd work?" and the three-approaches answer are
  // untouched.
  const FORBIDDEN = [
    /continuing guidance/i,
    /ongoing guidance/i,
    /step-by-step guidance[^.]{0,40}\bpro\b/i,
    /\bpro\b[^.]{0,60}\bchecklists?\b/i,
    /\bpro\b[^.]{0,60}\btask (completion|tracking)\b/i,
    /\bpro\b[^.]{0,60}\bcomplete (a |your )?plan\b/i,
    /\bpro\b[^.]{0,60}\bmark (tasks|items) (as )?done\b/i,
  ];

  // Every string a user can read that makes a Pro claim: both FAQ variants,
  // the paywall comparison columns, the paywall subtitle, and the
  // paywall-prompt card Companion shows at the photo step.
  const surfaces = [];
  for (const os of ["ios", "android"]) {
    for (const f of faqsFor(os)) surfaces.push([`faq(${os}): ${f.q}`, f.a]);
  }
  surfaces.push(["paywall comparison", region("{/* Free vs Pro comparison */}", "{/* Plan selector */}")]);
  surfaces.push(["paywall subtitle", region("<Text style={s.paywallSubtitle}>", "</Text>")]);
  surfaces.push(["paywall-prompt card", region('if (stage === "paywall-prompt") {', "\n  }")]);

  const offenders = [];
  for (const [where, text] of surfaces) {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(text)) offenders.push(`${where} matches ${pattern}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("onboarding no longer oversells the product links", () => {
  const slide = region('title: "Shop the Look",', "bg: \"#E6F7EE\",");
  assert.ok(!/Curated products at every price/.test(slide));
  assert.ok(!/hand-picked/.test(slide));
  assert.ok(!/direct product links/.test(slide));
  assert.match(slide, /Amazon search results/);
  // And nowhere else either.
  assert.ok(!/Curated products at every price/.test(SRC));
  assert.ok(!/hand-picked/.test(SRC));
  assert.ok(!/direct product links/.test(SRC));
});

test("no user-facing copy uses an em dash", () => {
  // The app already strips them from AI output and instructs the model not to
  // produce them; hand-written copy holds to the same rule.
  for (const os of ["ios", "android"]) {
    for (const f of faqsFor(os)) {
      assert.ok(!f.q.includes("—"), f.q);
      assert.ok(!f.a.includes("—"), f.a);
    }
  }
  const slide = region('title: "Shop the Look",', "bg: \"#E6F7EE\",");
  assert.ok(!slide.includes("—"));
  assert.ok(!pdf.AFFILIATE_DISCLOSURE.includes("—"));
});

// ---- 6. affiliate disclosure ----------------------------------------------

const DISCLOSURE = "As an Amazon Associate, Uncluttrd earns from qualifying purchases.";

test("the disclosure sits with the product links on Results", () => {
  // Inside the recommendationGroups block, after the rows, so it is present
  // exactly when an affiliate link is on screen.
  const block = region("{recommendationGroups.length > 0 && (", "{/* Approach-Aware Visualization:");
  assert.ok(block.includes(DISCLOSURE), "disclosure missing from the product section");
  assert.ok(block.indexOf("Find options →") < block.indexOf(DISCLOSURE), "it belongs with the links, below them");
  assert.match(block, /style=\{s\.affiliateDisclosure\}/);
  assert.ok(SRC.includes("affiliateDisclosure: { fontSize: 11"), "must be legible, not hidden fine print");
});

test("the disclosure is not rendered for an approach with no products", () => {
  // It lives inside the same length guard as the rows, so there is no
  // separate condition that could drift out of step with them.
  const section = region("{recommendationGroups.length > 0 && (", "{/* Approach-Aware Visualization:");
  const guardEnd = section.lastIndexOf("</>");
  assert.ok(guardEnd > section.indexOf(DISCLOSURE), "the disclosure must close inside the guard");
});

test("the disclosure appears in the PDF wherever products do", () => {
  assert.equal(pdf.AFFILIATE_DISCLOSURE, DISCLOSURE, "one wording, shared with the app and the website");

  // One approach with products, two without, so both branches are exercised
  // in the same document.
  const model = {
    roomLabel: "Home Office", overview: "A desk that has become a shelf.",
    proTip: "Keep daily items within reach.", photo: "", logo: "", selectedApproachId: null,
    approaches: [
      {
        id: "simple", name: "Keep It Simple", strategy: "Use what is already here.", spendRange: "$0",
        tasks: ["Sort the papers into keep, file and recycle, then clear the desk surface entirely."],
        products: [{ name: "Desk organizer", why: "Holds the paper that has nowhere to live." }],
        visualization: null,
      },
      { id: "polished", name: "Polished & Practical", strategy: "Add a little.", spendRange: "$40", tasks: [], products: [], visualization: null },
      { id: "elevated", name: "Elevated Finish", strategy: "Rebuild it.", spendRange: "$120", tasks: [], products: [], visualization: null },
    ],
  };
  const { html } = pdf.buildComprehensivePlanPdf(model);
  assert.ok(html.includes(DISCLOSURE), "an exported plan with products must disclose");
  assert.equal((html.match(new RegExp(DISCLOSURE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1,
    "once, on the one approach that actually lists products");
  assert.ok(html.includes(pdf.NO_PRODUCTS_MESSAGE), "the other two approaches still say they need nothing");
  // Adjacency: the disclosure belongs with the product rows, not adrift.
  assert.ok(html.indexOf(DISCLOSURE) > html.indexOf("Products for this approach"));
  assert.ok(html.indexOf(DISCLOSURE) < html.indexOf("Desk organizer"));
});

// ---- 7. callable timeouts -------------------------------------------------

test("analyzePhoto and hardDeleteAccount carry an explicit 310s client deadline", () => {
  assert.ok(SRC.includes('httpsCallable(functions, "analyzePhoto", { timeout: 310000 })'));
  assert.ok(SRC.includes('httpsCallable(functions, "hardDeleteAccount", { timeout: 310000 })'));
});

test("310000 stays above the server's 300s limit and the planned 280s internal deadline", () => {
  // Below the server's own limit, the client abandons a call the server is
  // still running: a burned monthly analysis, or a deletion reported as
  // failed after it completed.
  assert.ok(310000 > 300000);
  assert.ok(310000 > 280000);
});

test("no other callable's timeout changed", () => {
  const calls = SRC.match(/httpsCallable\(functions, "[a-zA-Z]+"(, \{ timeout: \d+ \})?\)/g) || [];
  const byName = Object.fromEntries(calls.map((c) => [c.match(/"([a-zA-Z]+)"/)[1], (c.match(/timeout: (\d+)/) || [])[1] || "default"]));
  assert.deepEqual(byName, {
    compareAreaCandidates: "default",   // server 60s < client 70s default: already correctly ordered
    generateNextAction: "default",      // same
    analyzePhotoDetail: "300000",       // unchanged
    analyzePhoto: "310000",
    generateVisualization: "300000",    // unchanged
    hardDeleteAccount: "310000",
  });
});

// ---- 8. version and deep linking ------------------------------------------

test("the production version is 2.2.1 and staging stays pinned", () => {
  assert.match(CONFIG, /const PRODUCTION_VERSION = "2\.2\.1";/);
  assert.match(CONFIG, /const STAGING_VERSION = "2\.0\.0";/);
});

test("deep linking is preserved exactly, and staging still claims nothing", () => {
  assert.match(CONFIG, /\.\.\.\(IS_PRODUCTION \? \{ associatedDomains: \["applinks:uncluttrd\.app"\] \} : \{\}\)/);
  assert.match(CONFIG, /autoVerify: true/);
  assert.match(CONFIG, /data: \[\{ scheme: "https", host: "uncluttrd\.app" \}\]/);
  assert.match(CONFIG, /scheme: IS_PRODUCTION \? "uncluttrd" : "uncluttrd-staging"/);
  assert.ok(!/uncluttrd\.app\.staging|com\.mharrison\.uncluttrd\.staging"\s*\]/.test(CONFIG), "no staging identifier may claim the domain");
  // The handler itself is unchanged: it records and returns.
  const handler = region("// INBOUND LINKS.", "}, []);");
  assert.match(handler, /deep_link_opened/);
  assert.match(handler, /Linking\.getInitialURL\(\)\.then\(record\)/);
  assert.match(handler, /Linking\.addEventListener\("url"/);
});
