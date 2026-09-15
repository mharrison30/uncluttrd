import { useState, useEffect, useRef } from "react";
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Linking, StatusBar,
  TextInput, KeyboardAvoidingView, Keyboard, Platform, Alert, Share, Modal as NativeModal, Dimensions, BackHandler, Animated,
  PanResponder, AppState, Easing, AccessibilityInfo, useWindowDimensions
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Rect, Circle, Polyline, Line, Defs, RadialGradient, Stop } from "react-native-svg";
import { ImageZoom } from '@likashefqet/react-native-image-zoom';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Area-row swipe-to-delete. gesture-handler 2.28 ships two Swipeable
// implementations: the legacy Animated-API "Swipeable" (exported from the
// package root) and "ReanimatedSwipeable" (its own subpath export, built
// on Reanimated). The project already depends on react-native-reanimated
// ~4.1.1 - ReanimatedSwipeable is the current, non-deprecated one and the
// one that matches an already-Reanimated-using project, so it's used here
// rather than the legacy component.
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import * as Font from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Menu, Check, X, AlertTriangle, Sparkles, RefreshCw, HelpCircle, Camera, Image as ImageIcon, FileText, Mail, LogOut, User, Clock, ShoppingBag, Folder, Zap, Star, Diamond, Sofa, Shirt, CarFront, UtensilsCrossed, BedDouble, Monitor, Lightbulb, Wrench, Home, ChevronRight, ChevronLeft, Eye, EyeOff, Layers, Pencil, CookingPot, Bath, Warehouse, WashingMachine, DoorOpen, Trash2, Cable, ShoppingBasket, Box, ShelvingUnit, Anchor, Tag, Archive, Package, MoreHorizontal, Plus, Frame, Leaf, Utensils, Wine, GlassWater, Boxes, Armchair, Sprout, ConciergeBell, Amphora, Container, Blinds, Grid2x2 } from "lucide-react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp, arrayUnion, writeBatch, runTransaction, increment, deleteField } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { evaluateSpaceShadowValidation } from "./shared/spaceShadowValidation";
import { computeShadowIds, computeShadowBatchId, deriveFullReprojectionDocs, computeRoomSummaryFields, computeAreaSummaryFields, evaluateMigrationCompleteness, MIGRATION_VERSION, computeMergeCandidateId, CANDIDATE_KEY_VERSION, DETECTION_VERSION, getSpaceDisplayName, validateTargetSpace, resolveRecognitionCandidates, dedupeToKnownRooms, routeRoomConfirmation, resolveExistingRoomConfirmation, resolveNewRoomConfirmation, evaluateCandidateInvalidation, resolveSessionScope } from "./shared/spaceMigration";
import { mergeUploadedPhotoUrl, buildComprehensivePlanPdf, comprehensivePdfAnalytics } from "./shared/pdfExport";
import { createLaunchExitController, LAUNCH_EXIT_FADE_MS, LAUNCH_ANIMATION } from "./shared/launchTiming";
import Purchases from "react-native-purchases";
import { getAnalytics, logEvent } from "@react-native-firebase/analytics";
import Constants from "expo-constants";
import { PIConfetti } from "react-native-fast-confetti";
import * as Updates from "expo-updates";

// Hold the native splash until LaunchScreen has laid out - it hides it
// itself (hideNativeSplashOnce). Called at module load, before the first
// render, as expo-splash-screen requires.
SplashScreen.preventAutoHideAsync().catch(() => {});
// Hide the native splash instantly rather than with expo-splash-screen's
// default 400ms fade-out (Android fades by default; iOS does not). The launch
// screen beneath is on the same background, and its entrance is timed from
// the handoff frame - a fading splash still covered most of the status
// line's fade-in on device.
try { SplashScreen.setOptions({ duration: 0, fade: false }); } catch (e) {}

// TEMP DEBUG. Module-level (not a useRef inside MainApp) so components
// outside MainApp's closure can log into the same buffer without
// prop-drilling a logger through CompanionRevealModal/CompanionCompletedSummary.
// Declared before Firebase init (below) so early init-time logging can use it
// too, without hitting the temporal-dead-zone crash a later declaration would
// cause at module-evaluation time. Retrieved via the existing
// long-press-to-share mechanism on the header logo (see debugShareLog in
// MainApp). The slider investigation this originally covered is closed (the
// slider itself was deleted, DecisionLog.md 2026-07-18) - remove once the
// remaining photo-pipeline/staging-isolation investigations are closed too.
const debugLogBuffer = [];
// The buffer is unbounded otherwise, and a long session (hundreds of companion
// rounds, each logging photo-pipeline lines) grows it until the app is
// restarted. 200 entries is enough to cover the recent activity a shared log is
// ever read for, and the oldest are the least useful once that many have
// accumulated. console.log is untouched - only what is RETAINED is capped, so
// an attached Metro session still sees every line.
const DEBUG_LOG_MAX_ENTRIES = 200;
function dlog(line) {
  console.log(line);
  debugLogBuffer.push(`${new Date().toISOString()} ${line}`);
  while (debugLogBuffer.length > DEBUG_LOG_MAX_ENTRIES) debugLogBuffer.shift();
}
// Lightweight, non-cryptographic fingerprint for a base64 image payload -
// cheap enough to run on a ~150-400KB string without hashing every byte.
// Purpose is purely to confirm two payloads are the same or different
// content, not to be collision-proof.
function debugHashBase64(b64) {
  if (!b64) return "null";
  let hash = 0;
  for (let i = 0; i < b64.length; i += 37) {
    hash = (hash * 31 + b64.charCodeAt(i)) | 0;
  }
  return `len${b64.length}:h${hash}`;
}

// My Rooms -> True Room Grouping, Phase A: Results screen Room-name
// resolution. Space.displayName (via the already-loaded `roomsList`, i.e.
// MainApp's `rooms` state) is the CURRENT, authoritative name; a plan's
// own spaceName is historical - what the Room was called at the time of
// THIS visit, which may since have been renamed. Never mutates the plan's
// own spaceName field - purely a read-time display choice. Falls back to
// getSpaceDisplayName(plan) only when the matching Space genuinely isn't
// in roomsList yet (a deep link, or Results reached before My Rooms has
// loaded this session, e.g. straight from a fresh analysis) - it never
// silently prefers the plan's own historical name when the Space IS
// available. Pure (no I/O, no closure over component state) so it's
// testable directly, independent of any render.
// Hardened 2026-08-12: spaceType is the AI's RAW SUGGESTION ("Bedroom" for
// a bookshelf the user keeps in the Home Office) and must never be shown as
// the Room name once the user has resolved identity. The old single
// fallback to getSpaceDisplayName reached spaceType whenever spaceName was
// absent, which is exactly what surfaced "Bedroom" on Results.
//
// The ladder is now explicit, strongest evidence first:
//   1. the live Space's current displayName - the user's own current name
//   2. the plan's confirmed spaceName - written at save time from the
//      confirmation, so it is a resolved name, never an AI guess
//   3. spaceType, and ONLY for a plan with no canonical identity at all -
//      a freshly parsed, not-yet-filed analysis, where the AI's label
//      genuinely is the best thing known about the space
// A plan that HAS a canonicalSpaceId but resolves to neither 1 nor 2
// returns null rather than falling back to the guess: an empty heading is
// a smaller lie than a confidently wrong Room name, and every caller
// already handles a null (the back-link has its own `|| "Back to Plan"`).
function resolveResultsRoomName(plan, currentPlanId, roomsList) {
  if (!plan) return null;
  const roomId = plan.canonicalSpaceId || currentPlanId;
  const matchedRoom = (roomsList || []).find((r) => r.id === roomId);
  if (matchedRoom?.displayName) return matchedRoom.displayName;
  const confirmedName = typeof plan.spaceName === "string" ? plan.spaceName.trim() : "";
  if (confirmedName) return confirmedName;
  return plan.canonicalSpaceId ? null : getSpaceDisplayName(plan);
}

// Recognition Identity Fix (stale plan metadata bug, 2026-08-10): the same
// live-Space-first, plan-field-fallback precedence resolveResultsRoomName
// already established for Results' own room name, extended to Generic
// Camera Recognition (findRecognitionCandidates, below). resolveRecognition
// Candidates (shared/spaceMigration.js) is deliberately pure and plan-only -
// its own contract, unchanged here - so live Space resolution happens
// entirely in this I/O shell, BEFORE plans ever reach that function, not
// inside it. For each plan, if its canonical Space (canonicalSpaceId, or
// the plan's own id for a not-yet-merged Project - the same computeShadowIds
// precedence used everywhere else) is found in the already-loaded `rooms`
// list, this transient copy's spaceName is overridden to that Space's own
// current displayName - the REAL plan document and its data are never
// touched. getSpaceDisplayName reads spaceName first, so this single
// override is enough to make resolveRecognitionCandidates's own matching
// AND its own candidate.displayName output both resolve through the live
// Space's current name, with zero changes to that function. A plan whose
// canonical Space isn't in `rooms` (legacy/orphaned plan, or `rooms` hasn't
// loaded yet this session) passes through with its original data completely
// unchanged - falls back to getSpaceDisplayName(plan)'s existing historical-
// label behavior automatically, the same graceful degradation
// resolveResultsRoomName already has. Pure (no I/O), independently testable.
function withLiveSpaceIdentity(plans, roomsList) {
  return (plans || []).map((p) => {
    if (!p || !p.data) return p;
    const canonicalSpaceId = p.data.canonicalSpaceId || p.id;
    const matchedRoom = (roomsList || []).find((r) => r.id === canonicalSpaceId);
    const liveDisplayName = typeof matchedRoom?.displayName === "string" ? matchedRoom.displayName.trim() : "";
    if (!liveDisplayName) return p;
    return { ...p, data: { ...p.data, spaceName: liveDisplayName } };
  });
}

// AI Analysis Redesign, Phase B.1 (AIAnalysisRedesign.md Section 2): plans
// saved before this phase store itemsFound as a flat string array; plans
// saved after it store {description, certainty} objects (schemaVersion 3+ -
// see savePlanToHistory). The ONE place that difference gets flattened back
// into a plain list of display strings - every consumer (generateVisualization's
// image-gen prompt today; Results/PDF/share whenever they render itemsFound)
// calls this instead of reading plan.itemsFound directly, so the format
// check exists exactly once rather than being re-derived at each call site.
// Pure, tolerant of any malformed/missing entry (never throws - a bad entry
// is simply dropped, not a reason to break the whole list).
function normalizeItemsFound(itemsFound) {
  if (!Array.isArray(itemsFound)) return [];
  return itemsFound
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item.description === "string") return item.description.trim();
      return "";
    })
    .filter(Boolean);
}

// My Rooms card icons (Room Detail UX Revision, Section 2): matched by
// case-insensitive substring against Space.displayName ONLY - never the
// AI's original spaceType, which isn't stored on the Space document at
// all (only on individual plans) and, per explicit instruction, is not
// being added there just for this. A renamed Room (e.g. "The Guest Room")
// naturally falls through to the generic fallback rather than guessing -
// that's correct behavior, not a gap. Order matters only where one
// keyword could be a substring of another real room name; kept in the
// order specified. Pure, no I/O - independent of any render.
const ROOM_TYPE_ICON_RULES = [
  { keywords: ["living room", "living"], icon: Sofa },
  { keywords: ["kitchen"], icon: CookingPot },
  { keywords: ["bathroom", "bath"], icon: Bath },
  { keywords: ["bedroom", "guest room"], icon: BedDouble },
  { keywords: ["office"], icon: Monitor },
  { keywords: ["garage"], icon: Warehouse },
  { keywords: ["dining"], icon: UtensilsCrossed },
  { keywords: ["laundry"], icon: WashingMachine },
  { keywords: ["closet"], icon: DoorOpen },
  // Shelf isn't available in this lucide-react-native version - falls
  // back to CookingPot per explicit instruction.
  { keywords: ["pantry"], icon: CookingPot },
];
function getRoomTypeIcon(displayName) {
  const name = (displayName || "").toLowerCase();
  const match = ROOM_TYPE_ICON_RULES.find(({ keywords }) => keywords.some((k) => name.includes(k)));
  return match ? match.icon : Home;
}

// Stable per-item id for batch checklist items - only needs to be unique
// within one plan's lifetime, not globally, so a counter + timestamp is
// sufficient without pulling in a uuid dependency.
let batchItemIdCounter = 0;
function makeItemId() {
  batchItemIdCounter += 1;
  return `item-${Date.now()}-${batchItemIdCounter}`;
}

// ---- Space/Project/Session/Batch shadow migration (additive only) ----
// Writes a parallel, read-inert shadow of the target Space -> Project ->
// Session -> Batch model (ObjectModel.md) alongside every new plan.
// Nothing in the app reads this data yet - resume logic, History, the
// resume banner, deletion, PDF export, and analytics all continue to
// read/write `plans` exactly as before. Deliberately scoped to
// plan-creation time only; it does not stay in sync with later
// batches/pauses/completion - that is a separate, later slice.
const SHADOW_SCHEMA_VERSION = 1;

// computeShadowIds/computeShadowBatchId now live in shared/spaceMigration.js
// (imported above) - single shared derivation, deterministic not random,
// used by both this file and the CLI/migration runner so the scheme can
// never independently drift between callers again.

// Pure - no Firestore calls, no side effects. Takes exactly what's known
// at the point savePlanToHistory finishes (the entry it wrote, plus
// whatever photoUrl the upload step obtained - null if that step
// failed). Kept separate from writeSpaceShadowStructure specifically so
// it can be unit-tested (idempotency, field-mapping correctness)
// without a Firestore connection.
//
// Delegates to deriveFullReprojectionDocs - the same shared derivation
// forceFullReprojection/syncPlanToSpaceGraph already use
// (MigrationSyncAlignmentDesign.md) - rather than keeping its own
// separate inline shape. Discovered during Remembered Home v1 Step 1
// testing (required test g) that this creation-time path had never been
// brought into that alignment: it built its own single-Session,
// bare-planId-named session document and never wrote migrationVersion,
// so checkMigrationCompleteness reported every freshly-created plan as
// incomplete from the moment of creation - self-correcting only once a
// live mutation happened to sync it (via syncPlanToSpaceGraph), which
// left the original bare-planId Session document orphaned behind (never
// deleted, since Firestore writes don't delete siblings). Fixed by using
// the exact same derivation everywhere, not a second copy of it.
function buildShadowDocs({ planId, entry, photoUrl }) {
  // entry.canonicalSpaceId is absent for an ordinary first-time plan, and
  // present for a Remembered Home v1 returning visit (RememberedHomeDesign.md
  // §3 Point 3) - passed through either way so computeShadowIds resolves
  // the correct target.
  //
  // entry itself does not yet carry photoUrl (the upload happens after
  // the plan doc write that produces entry) - merged in here just for
  // this derivation call, same as the pre-existing photoUrl parameter.
  const derived = deriveFullReprojectionDocs(planId, { ...entry, photoUrl: photoUrl || entry.photoUrl || null });
  // RememberedHomeDesign.md §3 Point 3: a returning visit (canonicalSpaceId
  // present) targets a Space that ALREADY EXISTS and is already canonical -
  // that's what Step 1 Point 2's validation, run before this is ever
  // called, guarantees. The Space document write is therefore omitted
  // entirely for a returning visit, not merged or partially overwritten -
  // writeSpaceShadowStructure below never calls set() on it at all in that
  // case. This is what makes the new Project purely additive: there is
  // structurally no path left by which a Project-level creation can alter
  // the Space's own displayName/createdAt/any other field. For a genuine
  // first-time plan (canonicalSpaceId absent), this Space IS being created
  // for the first time, so writing it here is correct and unchanged.
  const isReturningVisit = !!entry.canonicalSpaceId;
  return {
    ids: derived.ids,
    space: isReturningVisit ? null : derived.space,
    project: derived.project,
    // [{ id, data, batches: [{ id, data }] }] - reconstructSessionClusters
    // applied to a brand-new entry (empty batchHistory, at most one
    // currentBatch) always collapses to exactly zero or one Session,
    // never more - multi-Session only arises later, from a real gap
    // between subsequent batches.
    sessions: derived.sessions,
  };
}

// The only function that actually touches Firestore for the shadow
// structure. Additive-only: writes under users/{uid}/spaces/..., which
// nothing else in the app reads. Never throws - a shadow-write failure
// must never affect the real plan save it's piggybacking on, so every
// caller treats this as fire-and-forget. Uses a single writeBatch so the
// four documents are created atomically: either all four exist and
// correctly reference each other, or none do - no document is ever left
// half-linked to a Project/Space that doesn't exist. Because every doc
// uses a deterministic ID via setDoc (not addDoc), calling this again
// for the same planId overwrites the same four documents rather than
// creating new ones - this is what Task 3's idempotency invariant
// actually verifies.
// ---- My Rooms -> True Room Grouping, Phase A: Room summary maintenance ----
// Best-effort, non-transactional, run AFTER a Space/Project write has
// already committed - never inside the same transaction/batch. Reading a
// whole subcollection inside a transaction risks the read-set/size limits
// a Room with many visits could eventually hit, and a briefly-stale
// summary (this call fails, or hasn't run yet) is an acceptable,
// self-correcting failure mode - the same tolerance already established
// for writeSpaceShadowStructure/deleteSpaceShadowGraph elsewhere in this
// file (never awaited into a caller's critical path beyond its own
// call site, never throws out).
//
// CRITICAL: recomputes every summary field fresh from the actual Project
// documents every single call - computeRoomSummaryFields (shared/
// spaceMigration.js) is pure and order-independent, so calling this after
// ANY sync (creation, pause, completion, rename, next-batch, retroactive-
// save, or a genuinely new visit) is always idempotent by construction,
// never an increment. Calling it twice in a row for the same Space
// produces byte-identical output both times.
// Soft-Delete Primitives (Phase C1, DeletionDesign.md Soft-Delete
// Revision): a Room's own visitCount/latestPhotoUrl/etc. must not count a
// visit that belongs to a now-retired Area - the shadow Project for that
// visit is still fully live (soft-delete never touches plans/shadows,
// only sets retired+deletedAt on the Area itself), so without this
// exclusion the Room's summary would silently keep counting a
// soft-deleted Area's visits forever. Costs one extra subcollection read
// (areas) alongside the existing projects read - modest, and this
// function is already called sparingly (post-mutation, not per-render).
// A retired Area for ANY reason (merge tombstone OR soft-delete) is
// excluded identically - safe for the merge-tombstone case too, since a
// correctly-migrated Area should have zero live Projects still pointing
// at it by construction (every one of its plans was already repointed to
// the migration target before the source Area was ever retired).
async function updateSpaceRoomSummary(uid, spaceId) {
  try {
    const [projectsSnap, areasSnap] = await Promise.all([
      getDocs(collection(db, "users", uid, "spaces", spaceId, "projects")),
      getDocs(collection(db, "users", uid, "spaces", spaceId, "areas")),
    ]);
    const retiredAreaIds = new Set(areasSnap.docs.filter((d) => d.data().retired).map((d) => d.id));
    const liveProjects = projectsSnap.docs.map((d) => d.data()).filter((p) => !p.areaId || !retiredAreaIds.has(p.areaId));
    const summary = computeRoomSummaryFields(liveProjects);
    await updateDoc(doc(db, "users", uid, "spaces", spaceId), summary);
  } catch (e) {
    dlog(`[ROOM SUMMARY] update failed for space ${spaceId}: ${e.message}`);
  }
}

// Area Identity, Phase A (AreaIdentityDesign.md §2/§5/§11) - same
// idempotent-recompute discipline as updateSpaceRoomSummary above, one
// level down. Areas don't get their own Projects subcollection (see
// AreaIdentityDesign.md §2's path decision) - this reads the WHOLE
// Room's Projects collection (the same read updateSpaceRoomSummary
// already performs) and filters to this one Area's own Projects in
// memory via the areaId field deriveFullReprojectionDocs now carries.
// Never deletes the Area document, even when the filtered list is empty
// (visitCount: 0) - Area is identity, not a projection of its plans
// (item 5's explicit requirement); computeAreaSummaryFields's own
// contract already guarantees this by only ever returning summary
// fields, never a deletion signal.
async function updateAreaSummary(uid, roomId, areaId) {
  try {
    const projectsSnap = await getDocs(collection(db, "users", uid, "spaces", roomId, "projects"));
    const areaProjects = projectsSnap.docs.map((d) => d.data()).filter((p) => p.areaId === areaId);
    const summary = computeAreaSummaryFields(areaProjects);
    await updateDoc(doc(db, "users", uid, "spaces", roomId, "areas", areaId), summary);
  } catch (e) {
    dlog(`[AREA SUMMARY] update failed for area ${areaId} in room ${roomId}: ${e.message}`);
  }
}

// Area Identity, Phase A §3: creates a new, durable Area for a confirmed
// sub-area visit. Phase A NEVER attempts to match an existing Area here -
// every generic-camera sub-area visit gets a brand-new Area, full stop
// (the governing principle: only navigation from an existing Area, i.e.
// startOrganizeAgain's areaId option, or a future Phase B confirmation,
// ever associates a visit with a PRE-EXISTING Area). Sets originalPhotoUrl/
// latestPhotoUrl/visitCount/lastOrganizedAt directly at creation, correct
// by construction (this IS the Area's first and only visit at this
// instant), rather than calling updateAreaSummary - which would need to
// read this plan's own shadow Project back, and that Project may not
// exist yet (writeSpaceShadowStructure runs fire-and-forget, after this
// function's caller already has newPlanId in hand - see
// completeRoomConfirmation). Re-reads the plan for its own photoUrl
// rather than trusting anything passed in, since by the time this runs
// savePlanToHistory's internal photo upload has already completed and
// written it - the same "read back what was actually persisted" caution
// renameSpace itself already uses for canonicalSpaceId.
async function createAreaForPlan(uid, roomId, planId, areaName) {
  try {
    const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
    const photoUrl = planSnap.exists() ? (planSnap.data().photoUrl || null) : null;
    const now = new Date().toISOString();
    const areaRef = await addDoc(collection(db, "users", uid, "spaces", roomId, "areas"), {
      roomId,
      displayName: areaName || "Unnamed Area",
      createdAt: now,
      originalPhotoUrl: photoUrl,
      latestPhotoUrl: photoUrl,
      lastOrganizedAt: now,
      visitCount: 1,
      retired: false,
      redirectTo: null,
    });
    // Real-staging test finding: writeSpaceShadowStructure already wrote
    // this plan's shadow Project BEFORE this Area existed (fire-and-forget,
    // kicked off at the tail of savePlanToHistory - this function's own
    // caller, completeRoomConfirmation, only runs after that returns, not
    // after the shadow write itself finishes) - so that Project was
    // written with areaId: null, and updating the PLAN document's own
    // areaId above does not retroactively fix it. Bumping
    // shadowSourceVersion and re-syncing forces syncPlanToSpaceGraph to
    // re-derive the Project from the plan's now-current areaId, the same
    // "changed something the shadow needs to catch up on" pattern
    // renameSpace already uses for an analogous problem - not a new
    // mechanism.
    // sessionScope is written in the SAME update as areaId, deliberately:
    // savePlanToHistory necessarily stamped this plan "unresolved" a
    // moment ago (its Area did not exist yet - this function is what
    // creates it), and the two fields must never be observable in
    // disagreement. A durable areaId is proof of "area" scope, so this is
    // the write that settles it.
    await updateDoc(doc(db, "users", uid, "plans", planId), { areaId: areaRef.id, sessionScope: "area", shadowSourceVersion: increment(1) });
    // Awaited, not fire-and-forget: completeRoomConfirmation already
    // awaits this whole function, and the caller (and any test) needs
    // Project.areaId to be reliably correct by the time this returns, not
    // "usually correct soon after."
    await syncPlanToSpaceGraph(uid, planId).catch((e) => dlog(`[AREA CREATE] shadow resync failed for plan ${planId}: ${e.message}`));
    dlog(`[AREA CREATE] created area ${areaRef.id} ("${areaName}") in room ${roomId} for plan ${planId}`);
    return areaRef.id;
  } catch (e) {
    dlog(`[AREA CREATE] failed for plan ${planId} in room ${roomId}: ${e.message}`);
    return null;
  }
}

// Area Identity, Phase B: Visual Recognition (AreaRecognitionPhaseBImplementation.md,
// AreaIdentityDesign.md §6). Same three-outcome pattern as Room recognition
// (findRecognitionCandidates), but the comparison itself is a real
// multimodal AI call (compareAreaCandidates, functions/index.js) - Room
// membership (existingAreas is always pre-scoped to ONE Room by the
// caller, never cross-Room) is the hard filter; visual similarity via the
// photos themselves is the actual identity signal; suggestedAreaName is a
// WEAK co-signal used ONLY to narrow which Areas get a visual comparison
// when there are more than 3 eligible ones - never sufficient by itself to
// establish a match (proven necessary by real evidence: the same physical
// corner has been AI-labeled "Display Wall"/"Trophy Wall Display"/
// "Entertainment Center"/"TV Console & Media Center" across different
// visits). newPhotoBase64 (not a URL - deliberate deviation from the
// originally-specified newPhotoUrl param name) because at the point this
// runs, the plan has NOT been saved yet (governing invariant - see
// beginAreaConfirmation below) and so no photoUrl exists yet; the already-
// captured local photo is compressed to base64 by the caller instead,
// exactly like every other multi-image comparison already in this file.
async function findAreaRecognitionCandidates(roomId, newPhotoBase64, existingAreas, suggestedAreaName, uid) {
  const eligible = (existingAreas || []).filter((a) => !a.retired);
  if (eligible.length === 0) {
    return { status: "NO_MATCH", candidates: [], diagnostics: { roomId, uid, reason: "no-existing-areas", totalAreas: 0, consideredAreas: 0, excludedAreas: [] } };
  }

  // Step 0 narrowing (measured, not guessed - see the implementation
  // report): at most 3 candidate Areas go into the visual call (up to 2
  // reference images each + today's photo = up to 7 images total). Real
  // measurement against this exact function found zero accuracy
  // degradation and ~4-5s latency up to 17 images, so 7 has ample
  // headroom - the cap here is a deliberate cost/UX choice, not a
  // technical necessity. When there are more than 3 eligible Areas,
  // narrow by loose suggestedAreaName word-overlap - explicitly a WEAK
  // co-signal for narrowing only, never the match decision itself (that's
  // still made by the visual call, or not made at all). Excluded Areas
  // are always reported in diagnostics, never silently dropped.
  let consideredAreas = eligible;
  let excludedAreas = [];
  if (eligible.length > 3) {
    const norm = (s) => (s || "").toLowerCase().split(/\W+/).filter(Boolean);
    const targetWords = new Set(norm(suggestedAreaName));
    const scored = eligible.map((a) => ({ area: a, score: norm(a.displayName).filter((w) => targetWords.has(w)).length }));
    scored.sort((x, y) => y.score - x.score || new Date(y.area.lastOrganizedAt || 0) - new Date(x.area.lastOrganizedAt || 0));
    consideredAreas = scored.slice(0, 3).map((s) => s.area);
    excludedAreas = scored.slice(3).map((s) => ({ areaId: s.area.id, displayName: s.area.displayName, score: s.score }));
  }

  // Reference photos: originalPhotoUrl + latestPhotoUrl, deduplicated when
  // they resolve to the same URL (an Area never revisited since creation
  // has both fields pointing at the same file) - max 2 distinct images
  // per Area, matching the design doc's own cap.
  const candidatePayload = [];
  const skippedAreas = [];
  for (const area of consideredAreas) {
    const urls = [...new Set([area.originalPhotoUrl, area.latestPhotoUrl].filter(Boolean))];
    if (urls.length === 0) { skippedAreas.push({ areaId: area.id, reason: "no-reference-photos" }); continue; }
    try {
      const images = [];
      for (const url of urls) {
        const localUri = FileSystem.cacheDirectory + `area_recognition_ref_${area.id}_${images.length}.jpg`;
        const { uri } = await FileSystem.downloadAsync(url, localUri);
        const compressed = await manipulateAsync(uri, [{ resize: { width: 768 } }], { compress: 0.5, format: SaveFormat.JPEG, base64: true });
        images.push(compressed.base64);
      }
      candidatePayload.push({ areaId: area.id, displayName: area.displayName, images });
    } catch (e) {
      dlog(`[AREA RECOGNITION] reference photo fetch failed for area ${area.id}: ${e.message}`);
      skippedAreas.push({ areaId: area.id, reason: `fetch-failed: ${e.message}` });
    }
  }

  const diagnostics = {
    roomId, uid,
    totalAreas: eligible.length,
    consideredAreas: consideredAreas.length,
    excludedAreas,
    skippedAreas,
    referenceImageCount: candidatePayload.reduce((n, c) => n + c.images.length, 0),
  };

  if (candidatePayload.length === 0) {
    // Not NO_MATCH - no visual comparison actually happened (every
    // candidate's reference photo(s) failed to fetch/compress), so
    // "genuinely checked, found nothing" would be a false claim. Governing
    // principle: never auto-create an Area when recognition is
    // unavailable - this is exactly that case, just discovered before the
    // Anthropic call rather than during it.
    return { status: "RECOGNITION_FAILED", candidates: [], diagnostics: { ...diagnostics, reason: "no-usable-reference-photos" } };
  }

  try {
    const compareFn = httpsCallable(functions, "compareAreaCandidates");
    const result = await compareFn({ todayImageBase64: newPhotoBase64, candidates: candidatePayload });
    const text = result.data?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found in comparison response");
    const parsed = JSON.parse(match[0]);
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    // Map back to full Area objects for the proposal UI (photo,
    // displayName, lastOrganizedAt, visitCount) - the model only ever
    // sees/returns areaId + evidenceReason, never a confidence score
    // (never requested in the prompt, never parsed here even if the model
    // invented one anyway).
    const candidates = rawCandidates
      .map((c) => {
        const area = consideredAreas.find((a) => a.id === c.areaId);
        return area ? { ...area, evidenceReason: c.evidenceReason || null } : null;
      })
      .filter(Boolean);
    dlog(`[AREA RECOGNITION] room=${roomId} consideredAreas=${consideredAreas.length} matchesReturned=${candidates.length}`);
    return {
      status: candidates.length > 0 ? "MATCH_FOUND" : "NO_MATCH",
      candidates,
      diagnostics: { ...diagnostics, usage: result.data?.usage || null },
    };
  } catch (e) {
    dlog(`[AREA RECOGNITION] compareAreaCandidates call failed for room ${roomId}: ${e.message}`);
    return { status: "RECOGNITION_FAILED", candidates: [], diagnostics: { ...diagnostics, error: e.message } };
  }
}

// Area Identity, Phase A §7/§8: writes ONLY Area.displayName - never
// touches any plan's own historical areaName field, mirroring
// renameSpace's exact contract for Room.displayName one-to-one. No
// shadowSourceVersion bump is needed the way renameSpace needs one for
// Room - Area's own summary fields aren't sourced from a resync the way
// Room's are; they're maintained directly by updateAreaSummary's own
// hook points.
async function renameArea(uid, roomId, areaId, newName) {
  await updateDoc(doc(db, "users", uid, "spaces", roomId, "areas", areaId), { displayName: newName });
}

// ---- Soft-Delete Primitives (Phase C1, DeletionDesign.md Soft-Delete
// Revision). Contract, load-bearing for everything downstream (Recently
// Deleted, restore, the future 30-day hard-purge sweep): retired:true
// ALONE (no deletedAt) is a structural tombstone from a merge/
// reclassification - never user-initiated, never eligible for restore or
// purge. retired:true WITH deletedAt is a user-initiated soft delete -
// eligible for both. The two must never be confused, which is why
// softDeleteRoom below explicitly skips any Area that's already retired
// (a merge tombstone) rather than blindly setting deletedAt on it too.
//
// Both operations are intentionally the ENTIRE delete action - no plan
// deletion, no shadow removal, no Storage cleanup. The existing !retired
// filters already used everywhere (My Rooms, Room Detail, Area
// recognition, Room recognition, merge-candidate detection - all
// pre-existing, none modified by this change) do the rest: the instant
// this write lands, the target is fully hidden from the whole app, with
// zero new filtering code needed at any of those call sites. ----

// Delete Area (Room Detail's per-Area "Delete" action). Single document
// write - nearly instant, no processing overlay needed. Idempotent: a
// second call against an already-retired Area is a no-op, specifically so
// a double-tap (or a retry after a dropped network response) can never
// reset deletedAt and silently restart the 30-day retention countdown.
async function softDeleteArea(uid, roomId, areaId) {
  const areaRef = doc(db, "users", uid, "spaces", roomId, "areas", areaId);
  const snap = await getDoc(areaRef);
  if (!snap.exists() || snap.data().retired) return { outcome: "already-deleted" };
  await updateDoc(areaRef, { retired: true, deletedAt: serverTimestamp() });
  return { outcome: "soft-deleted" };
}

// Delete Room (Room Detail's "Delete Room" action). One atomic writeBatch
// covering the Space document AND every currently-LIVE Area under it (an
// Area already retired via a prior merge is deliberately left untouched -
// see the contract comment above). Firestore batches cap at 500 writes; a
// Room with >499 live Areas would need chunking, not engineered for here
// given real Rooms in this app have single-digit Area counts.
async function softDeleteRoom(uid, roomId) {
  const spaceRef = doc(db, "users", uid, "spaces", roomId);
  const spaceSnap = await getDoc(spaceRef);
  if (!spaceSnap.exists() || spaceSnap.data().retired) return { outcome: "already-deleted" };

  const areasSnap = await getDocs(collection(db, "users", uid, "spaces", roomId, "areas"));
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.set(spaceRef, { retired: true, deletedAt: now }, { merge: true });
  let areasDeletedCount = 0;
  areasSnap.docs.forEach((areaDoc) => {
    if (!areaDoc.data().retired) {
      // Phase C2: deletedWithRoomId marks this Area as CASCADE-deleted by
      // this specific Room deletion - the deterministic signal
      // restoreRoom uses to decide which Areas come back with the Room
      // and which don't (an Area independently soft-deleted before the
      // Room was must stay deleted; only ITS OWN "Restore" ever brings it
      // back). Never written by softDeleteArea (direct, independent
      // delete) - its absence there is exactly what distinguishes the
      // two cases.
      batch.set(areaDoc.ref, { retired: true, deletedAt: now, deletedWithRoomId: roomId }, { merge: true });
      areasDeletedCount++;
    }
  });
  await batch.commit();
  return { outcome: "soft-deleted", areasDeletedCount };
}

// Restore Room (Recently Deleted's own action, Phase C2). One atomic
// writeBatch: un-retires the Space, and un-retires ONLY the Areas this
// exact Room deletion cascade-deleted (deletedWithRoomId === roomId) -
// never a merge tombstone (retired:true, no deletedAt - never matches
// deletedWithRoomId either, since it's never set on one), and never an
// Area that was independently soft-deleted before the Room was (has its
// own deletedAt but a different, or absent, deletedWithRoomId). Idempotent:
// a Room already live (not retired) is a no-op, so tapping Restore twice
// can't do anything the first tap didn't already do.
async function restoreRoom(uid, roomId) {
  const spaceRef = doc(db, "users", uid, "spaces", roomId);
  const spaceSnap = await getDoc(spaceRef);
  if (!spaceSnap.exists() || !spaceSnap.data().retired) return { outcome: "already-restored" };

  const areasSnap = await getDocs(collection(db, "users", uid, "spaces", roomId, "areas"));
  const areasToRestore = areasSnap.docs.filter((a) => a.data().deletedWithRoomId === roomId);

  const batch = writeBatch(db);
  batch.update(spaceRef, { retired: false, deletedAt: deleteField() });
  areasToRestore.forEach((areaDoc) => {
    batch.update(areaDoc.ref, { retired: false, deletedAt: deleteField(), deletedWithRoomId: deleteField() });
  });
  await batch.commit();

  // Recompute, never trust the pre-delete values back to life verbatim -
  // same "recompute from live Projects" discipline every other summary
  // maintenance path in this file already follows.
  await updateSpaceRoomSummary(uid, roomId);
  for (const areaDoc of areasToRestore) {
    await updateAreaSummary(uid, roomId, areaDoc.id);
  }

  return { outcome: "restored", restoredAreaCount: areasToRestore.length };
}

// Restore Area (Recently Deleted Areas' own action, Phase C2). Single
// document write - the mirror image of softDeleteArea. Works identically
// whether the Area was cascade-deleted (has deletedWithRoomId) or
// independently deleted (doesn't) - restoring an Area directly always
// clears all three fields regardless of how it got here. Idempotent, same
// reasoning as restoreRoom.
async function restoreArea(uid, roomId, areaId) {
  const areaRef = doc(db, "users", uid, "spaces", roomId, "areas", areaId);
  const snap = await getDoc(areaRef);
  if (!snap.exists() || !snap.data().retired) return { outcome: "already-restored" };
  await updateDoc(areaRef, { retired: false, deletedAt: deleteField(), deletedWithRoomId: deleteField() });
  await updateSpaceRoomSummary(uid, roomId);
  await updateAreaSummary(uid, roomId, areaId);
  return { outcome: "restored" };
}

// ---- Session Recovery (SessionRecoveryDesign.md §6) ----
// The first and only way to create a Space with no founding plan, closing
// the gap AreaReparentingDesign.md §3b identified. Every other Space in
// this system came into existence as a side effect of a plan being
// projected; a Room created here has zero visits until a session is
// classified into it, which computeRoomSummaryFields' own zero-visits
// branch and Room Detail's empty-state rendering already handle (both
// verified - see the design doc §6).
//
// The projection provenance fields (sourcePlanId, sourceVersion,
// shadowSchemaVersion) are deliberately omitted rather than faked: they
// describe a founding projection that did not happen, and
// shared/spaceMigration.js's own field-ownership comment records that
// nothing ever reads them back. createdWithoutPlan is a breadcrumb for
// anyone later wondering why those fields are absent on this one Space.
async function createRoomSpace(uid, displayName) {
  const name = (displayName || "").trim();
  if (!name) return { outcome: "invalid-name" };
  const ref = await addDoc(collection(db, "users", uid, "spaces"), {
    displayName: name,
    createdAt: new Date().toISOString(),
    retired: false,
    visitCount: 0,
    lastOrganizedAt: null,
    latestPhotoUrl: null,
    latestAreaName: null,
    latestAreaScope: null,
    createdWithoutPlan: true,
  });
  return { outcome: "created", roomId: ref.id };
}

// ---- Plan soft delete / restore (SessionRecoveryDesign.md §5) ----
// New primitive: plans previously had only deletePlan, which is an
// irreversible hard delete of the document AND its Storage objects. A
// session surfaced in Needs Review needs the same 30-day, restorable
// deletion Rooms and Areas already have, so this mirrors softDeleteRoom/
// softDeleteArea's retired+deletedAt shape one level down.
//
// deleteProjectSubtree, not deleteSpaceShadowGraph: the latter deletes the
// parent Space once no sibling Projects remain, which would destroy a real
// Room because one of its sessions was deleted. Removing only the Project
// is what makes summaries fall to the correct counts while leaving the
// Room, the plan document, and every Storage object intact - which is what
// makes restore a true restore rather than a re-creation.
async function softDeletePlan(uid, planId) {
  const planRef = doc(db, "users", uid, "plans", planId);
  const snap = await getDoc(planRef);
  if (!snap.exists()) return { outcome: "missing" };
  const plan = snap.data();
  if (plan.retired === true) return { outcome: "already-deleted" };
  const spaceId = computeShadowIds(planId, plan).spaceId;
  const areaId = plan.areaId || null;

  await updateDoc(planRef, { retired: true, deletedAt: serverTimestamp() });
  // Guarded on the Space actually existing, the same way restorePlan below
  // is. An unresolved orphan's computed spaceId points at no document, so
  // the teardown and both summary recomputes have nothing to act on -
  // running them anyway is a wasted round trip that logs a NOT_FOUND and
  // reads, in the log, exactly like a real failure.
  const spaceSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId));
  if (spaceSnap.exists()) {
    await deleteProjectSubtree(uid, spaceId, planId).catch((e) => dlog(`[PLAN SOFT DELETE] project teardown failed for ${planId}: ${e.message}`));
    await updateSpaceRoomSummary(uid, spaceId);
    if (areaId) await updateAreaSummary(uid, spaceId, areaId);
  }
  return { outcome: "soft-deleted", spaceId, areaId, hadSpace: spaceSnap.exists() };
}

// The mirror image. forceFullReprojection rebuilds the Project subtree
// from the plan document, which is still fully intact - the shadow is
// derived, never authored, so nothing about the session's completed work
// had to be preserved separately for this to work.
async function restorePlan(uid, planId) {
  const planRef = doc(db, "users", uid, "plans", planId);
  const snap = await getDoc(planRef);
  if (!snap.exists()) return { outcome: "missing" };
  const plan = snap.data();
  if (plan.retired !== true) return { outcome: "already-restored" };
  const spaceId = computeShadowIds(planId, plan).spaceId;
  const areaId = plan.areaId || null;

  await updateDoc(planRef, { retired: false, deletedAt: deleteField(), shadowSourceVersion: increment(1) });
  // Only reproject when the plan actually has a Space to project into - an
  // unresolved orphan has none, and forceFullReprojection would create a
  // junk Space at its phantom id. It regains its shadow when classified.
  const spaceSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId));
  if (spaceSnap.exists()) {
    await forceFullReprojection(uid, planId).catch((e) => dlog(`[PLAN RESTORE] reprojection failed for ${planId}: ${e.message}`));
    await updateSpaceRoomSummary(uid, spaceId);
    if (areaId) await updateAreaSummary(uid, spaceId, areaId);
  }
  return { outcome: "restored", spaceId, areaId, reprojected: spaceSnap.exists() };
}

// ---- classifySession (SessionRecoveryDesign.md §4) ----
// Gives one unresolved session a home. Branches on whether a SOURCE Space
// actually exists, which is the whole reason this is not simply a call to
// reclassifyLegacyPlan: 12 of the 14 unresolved sessions are orphans whose
// computed spaceId points at no document, and claimReclassification would
// capture that phantom id as oldSpaceId, after which cleanUpOldSpace's
// setDoc(..., {merge:true}) tombstone write would CREATE a junk retired
// Space per classified session (setDoc-with-merge creates a missing doc).
// The reclassification machine exists to move a plan BETWEEN two Spaces;
// an orphan has no Space to move from, so there is nothing for it to do.
// newAreaName is the "create a new Area" case: the Area document cannot
// exist yet (createAreaForPlan reads the plan's photo and writes into the
// TARGET Room, so the plan has to land there first), but areaName and
// areaScope must still be written as part of THIS move - otherwise the
// reclassification/reprojection projects the session as whole-room and a
// later areaId write leaves Project.areaScope permanently disagreeing with
// the plan. When it is set, the areaId + sessionScope write is deferred to
// createAreaForPlan, which already performs exactly that pair atomically.
async function classifySession(uid, planId, { targetRoomId, targetAreaId = null, newAreaName = null }) {
  const planRef = doc(db, "users", uid, "plans", planId);
  const planSnap = await getDoc(planRef);
  if (!planSnap.exists()) return { outcome: "plan-missing" };
  const plan = planSnap.data();

  const targetSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", targetRoomId));
  if (!targetSpaceSnap.exists() || targetSpaceSnap.data().retired === true) {
    return { outcome: "invalid-target", reason: "target Room does not exist or is retired" };
  }
  const targetRoomName = targetSpaceSnap.data().displayName || null;

  const sourceSpaceId = computeShadowIds(planId, plan).spaceId;
  const sourceSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", sourceSpaceId));
  const sourceExists = sourceSpaceSnap.exists();
  const sourceWasRetired = sourceExists && sourceSpaceSnap.data().retired === true;
  const areaScope = (targetAreaId || newAreaName) ? "sub-area" : "whole-room";
  const areaName = newAreaName ?? plan.areaName ?? null;

  if (sourceExists && sourceSpaceId !== targetRoomId) {
    // A genuine move between two real Spaces - reclassifyLegacyPlan owns
    // the shadow create/delete, summary maintenance, and merge-candidate
    // reconciliation, exactly as it does for Room merge and Area move.
    const result = await reclassifyLegacyPlan(uid, planId, {
      targetSpaceId: targetRoomId,
      requestedRoomName: targetRoomName,
      requestedAreaName: areaName,
      requestedAreaScope: areaScope,
    });
    if (result.outcome !== "completed") return { outcome: "failed", reason: "reclassification did not complete", detail: result };
  } else {
    // Orphan, or already under the target: assign directly and project.
    await updateDoc(planRef, {
      canonicalSpaceId: targetRoomId,
      spaceName: targetRoomName,
      areaName,
      areaScope,
      shadowSourceVersion: increment(1),
    });
    const reprojected = await forceFullReprojection(uid, planId);
    if (reprojected.outcome === "source-plan-missing" || reprojected.outcome === "target-retired") {
      return { outcome: "failed", reason: `reprojection failed: ${reprojected.outcome}` };
    }
  }

  // areaId and sessionScope always travel together (see createAreaForPlan),
  // and the resync is what carries areaId onto the shadow Project - a
  // plan-only write leaves Project.areaId stale, which would keep the
  // Area's own summary at zero visits forever.
  // Skipped entirely when an Area is about to be created: writing
  // sessionScope "room" here and "area" a moment later would make the plan
  // briefly observable in a state that contradicts its own areaScope.
  if (!newAreaName) {
    await updateDoc(planRef, { areaId: targetAreaId, sessionScope: targetAreaId ? "area" : "room", shadowSourceVersion: increment(1) });
    await syncPlanToSpaceGraph(uid, planId).catch((e) => dlog(`[CLASSIFY] shadow resync failed for ${planId}: ${e.message}`));
  }

  // Source-Room retirement repair, identical in intent to moveAreaToRoom's
  // Phase 5a: cleanUpOldSpace tombstones a source Space as soon as its last
  // Project leaves, and cannot tell "the Room was emptied by a correction"
  // from "the whole Room was merged away". An emptied Room is a Room the
  // user keeps. Guarded on the pre-move snapshot so a Room the user had
  // already deleted stays deleted.
  let sourceRoomRestored = false;
  if (sourceExists && !sourceWasRetired && sourceSpaceId !== targetRoomId) {
    const after = await getDoc(doc(db, "users", uid, "spaces", sourceSpaceId));
    if (after.exists() && after.data().retired === true) {
      await updateDoc(doc(db, "users", uid, "spaces", sourceSpaceId), {
        retired: false, redirectTo: deleteField(), retiredAt: deleteField(), reclassificationExecutionId: deleteField(),
      });
      sourceRoomRestored = true;
    }
  }

  await updateSpaceRoomSummary(uid, targetRoomId);
  if (targetAreaId) await updateAreaSummary(uid, targetRoomId, targetAreaId);
  if (sourceExists && sourceSpaceId !== targetRoomId) await updateSpaceRoomSummary(uid, sourceSpaceId);

  return { outcome: "completed", planId, targetRoomId, targetAreaId, path: sourceExists && sourceSpaceId !== targetRoomId ? "reclassified" : "direct", sourceRoomRestored };
}

async function writeSpaceShadowStructure(uid, planId, entry, photoUrl) {
  try {
    const shadow = buildShadowDocs({ planId, entry, photoUrl });
    const { spaceId, projectId } = shadow.ids;
    const batch = writeBatch(db);
    // shadow.space is null for a returning visit (RememberedHomeDesign.md
    // §3 Point 3) - the established Space document is never touched by a
    // Project-level creation, purely additive by construction.
    if (shadow.space) {
      batch.set(doc(db, "users", uid, "spaces", spaceId), shadow.space);
    }
    const projectRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId);
    batch.set(projectRef, shadow.project);
    let batchCount = 0;
    for (const session of shadow.sessions) {
      const sessionRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id);
      batch.set(sessionRef, session.data);
      for (const b of session.batches) {
        batch.set(doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id, "batches", b.id), b.data);
        batchCount++;
      }
    }
    await batch.commit();
    dlog(`[SPACE SHADOW] wrote shadow structure for plan ${planId} (sessionCount: ${shadow.sessions.length}, batchCount: ${batchCount})`);
    // My Rooms -> True Room Grouping, Phase A - see updateSpaceRoomSummary's
    // own comment (below) for why this is safe to call unconditionally on
    // every creation, not just a "new Room" one.
    await updateSpaceRoomSummary(uid, spaceId);
    // Area Identity, Phase A - same hook, one level down, only when this
    // plan actually has a durable areaId (the common case, a whole-Room or
    // legacy-descriptive visit, has none - entry.areaId is null, not
    // absent, per savePlanToHistory's own field contract).
    if (entry.areaId) {
      await updateAreaSummary(uid, spaceId, entry.areaId);
    }
    return { outcome: "written", sessionCount: shadow.sessions.length, batchCount };
  } catch (e) {
    // A genuine atomic-write failure. No shadow docs exist for this plan
    // at all (writeBatch is all-or-nothing) - there is no document to
    // mark anything on. This is reported only as operational telemetry
    // (dlog + this function's own return value to its caller), never as
    // a field written to Firestore - see checkSpaceShadowExists /
    // repairSpaceShadow below for how this state is later detected and
    // recovered from.
    dlog(`[SPACE SHADOW] shadow write FAILED for plan ${planId}: ${e.message}`);
    console.log("Space shadow write error (non-fatal, plan save unaffected):", e.message);
    return { outcome: "failed", error: e.message };
  }
}

// ---- Missing-shadow detection and repair ----
// The write above is fire-and-forget: if it fails silently (app
// backgrounded, connectivity lost, process killed mid-write), the
// shadow simply never exists, with no durable trace beyond a local dlog
// line that may itself never be seen. Given the transactional write's
// all-or-nothing semantics, there is no partial state to repair around -
// a plan's shadow is either fully present (Space, Project, Session, and
// at least one Batch) or fully absent (nothing) by construction, so
// detection only needs to check for that binary.
//
// Batch Identity Alignment fix: a plan can have any number of Batch
// documents (one per archived batchHistory entry, plus the current one),
// so this reads the whole batches subcollection instead of one document
// at a fixed ID - the earlier version checked a single batchId=planId
// document that syncPlanToSpaceGraph/forceFullReprojection never
// actually write to (they use computeShadowBatchId per real batchIndex),
// meaning it always undercounted or missed real batches entirely once a
// plan progressed past creation. presentCount and allPresent can only
// confirm "at least one batch, not zero" without also reading the plan's
// own batchHistory/currentBatch to know the exact expected count - that
// finer check belongs to validateSpaceShadowMigration, which already has
// the plan in hand and cross-checks the real expected set.
async function checkSpaceShadowExists(uid, planId, plan) {
  const { spaceId, projectId, sessionId } = computeShadowIds(planId, plan);
  const [spaceSnap, projectSnap, sessionSnap, batchesSnap] = await Promise.all([
    getDoc(doc(db, "users", uid, "spaces", spaceId)),
    getDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId)),
    getDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sessionId)),
    getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sessionId, "batches")),
  ]);
  const batchSnaps = batchesSnap.docs;
  const coreDocsPresentCount = [spaceSnap, projectSnap, sessionSnap].filter(s => s.exists()).length;
  const nonePresent = coreDocsPresentCount === 0 && batchSnaps.length === 0;
  const allPresent = coreDocsPresentCount === 3 && batchSnaps.length > 0;
  return {
    allPresent,
    nonePresent,
    presentCount: coreDocsPresentCount + batchSnaps.length,
    batchCount: batchSnaps.length,
    snaps: { spaceSnap, projectSnap, sessionSnap, batchSnaps },
  };
}

// Thin wrapper around the canonical syncPlanToSpaceGraph projection.
// Previously called writeSpaceShadowStructure directly - re-verified
// during Step 5 and confirmed that was wrong: writeSpaceShadowStructure
// only ever reconstructs creation-time state (a single batch taken from
// entry.currentBatch, hardcoded "active" status, no batchHistory/
// companionComplete/progressPhotos handling), which is correct for a
// brand-new plan but silently produces an incomplete/incorrect shadow
// for any plan that had already progressed before its shadow went
// missing, and cannot repair a STALE (present but outdated) shadow at
// all - it has no version awareness. Delegating to syncPlanToSpaceGraph
// fixes both: it derives the full current-state projection from the
// live plan (every archived batch plus the current one, real status/
// evidence), and its own transactional version guard makes repeated
// calls safe, so this no longer needs its own presence short-circuit -
// calling it on an already-current shadow is a harmless no-op via that
// guard. This keeps exactly one repair/sync projection in the codebase
// instead of two competing ones.
async function repairSpaceShadow(uid, planId) {
  const result = await syncPlanToSpaceGraph(uid, planId);
  dlog(`[SPACE SHADOW REPAIR] plan ${planId}: ${result.outcome}, result=${JSON.stringify(result)}`);
  if (result.outcome === "source-plan-missing") return { planId, action: "none", reason: "source plan missing" };
  if (result.outcome === "no-op") return { planId, action: "none", reason: result.reason };
  return { planId, action: "repaired", result };
}

// Batch form - "for a given plan (or a batch of plans)" per the repair
// requirement. Sequential, not parallel, to stay gentle on Firestore
// quota when run against many plans at once from the admin path.
async function repairSpaceShadowBatch(uid, planIds) {
  const results = [];
  for (const planId of planIds) {
    results.push(await repairSpaceShadow(uid, planId));
  }
  return results;
}

// ---- Read-only shadow-migration validator (dev-only client trigger) ----
// Every check below only calls getDoc/getDocs. There is no write
// operation anywhere in this function - confirmed directly, not just
// asserted (grep for setDoc/updateDoc/addDoc/deleteDoc/writeBatch inside
// this function's body returns nothing; see the report for the actual
// command run).
//
// Several invariants are deliberately staleness-aware rather than strict
// equality checks: Part 1 only shadow-writes at plan-creation time, so a
// plan that has since progressed (more batches, items toggled,
// completed) will legitimately diverge from its creation-time shadow
// snapshot. That divergence is expected and out of this slice's scope,
// not a shadow-write defect - flagging it as a hard MISMATCH would make
// the validator useless against real, in-progress production plans. Each
// such case is reported as INFO with an explanation, distinct from a
// true MISMATCH.
// Step 6: optional third `prefetched` param - { planSnap, presence } -
// lets a caller that already read these (loadSpaceShadowGraph) pass them
// through instead of triggering a second independent read of the same
// plan doc and the same four shadow docs. Absent (the default) for any
// caller without pre-fetched data - e.g. the CLI's own equivalent, or the
// dev-only post-write check in savePlanToHistory - in which case this
// fetches everything itself exactly as before; standalone behavior and
// return shape are unchanged either way.
async function validateSpaceShadowMigration(uid, planId, prefetched) {
  const findings = [];
  const ok = (name) => findings.push({ invariant: name, status: "OK" });
  const fail = (name, expected, found) => findings.push({ invariant: name, status: "MISMATCH", expected, found });
  const info = (name, note) => findings.push({ invariant: name, status: "INFO", note });

  const planSnap = prefetched?.planSnap || await getDoc(doc(db, "users", uid, "plans", planId));
  if (!planSnap.exists()) {
    fail("source-plan-exists", "plan document present", "not found");
    return { planId, findings };
  }
  const plan = planSnap.data();

  // §12 Migration Part 4: derived from the plan we just read, not bare
  // planId - resolves through plan.canonicalSpaceId if this plan has been
  // through a merge (see computeShadowIds, shared/spaceMigration.js).
  const { spaceId, projectId, sessionId } = computeShadowIds(planId, plan);

  // Shadow-missing is its own distinct condition, not just another
  // mismatch - it's the expected signature of an interrupted
  // fire-and-forget write (see checkSpaceShadowExists/repairSpaceShadow
  // above), and needs to be measured and acted on separately from a
  // shadow that exists but disagrees with its source plan.
  const presence = prefetched?.presence || await checkSpaceShadowExists(uid, planId, plan);
  if (presence.nonePresent) {
    findings.push({ invariant: "shadow-presence", status: "MISSING", note: "no shadow documents exist for this plan - likely an interrupted fire-and-forget write; repairable via repairSpaceShadow(uid, planId), not a data-mismatch" });
    return { planId, findings };
  }
  if (!presence.allPresent) {
    // Should not be reachable given the transactional write's atomicity,
    // but not silently ignored if it somehow happens.
    findings.push({ invariant: "shadow-presence", status: "MISMATCH", expected: "0 documents, or Space+Project+Session plus at least 1 Batch (atomic)", found: `${presence.presentCount} present (${presence.batchCount} batch doc(s))` });
  }

  // presence.snaps already holds all shadow docs (checkSpaceShadowExists
  // fetched them to compute presentCount) - reuse them instead of a second
  // independent read of each, whether presence came from prefetched data or
  // from the call just above. projectsSnap is not something either presence
  // check or loadSpaceShadowGraph ever fetches, so it's always read here.
  const { spaceSnap, projectSnap, sessionSnap, batchSnaps } = presence.snaps;
  const projectsSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects"));

  // One source plan maps to exactly one expected Project.
  const projectsForThisPlan = projectsSnap.docs.filter(d => d.data().sourcePlanId === planId);
  if (projectsForThisPlan.length === 1 && projectSnap.exists()) ok("one-project-per-plan");
  else fail("one-project-per-plan", "exactly 1", `${projectsForThisPlan.length}`);

  // The Project points to the expected Space.
  if (projectSnap.exists() && projectSnap.data().scopeId === spaceId) ok("project-points-to-space");
  else fail("project-points-to-space", spaceId, projectSnap.exists() ? projectSnap.data().scopeId : "(project missing)");

  // Freshness (shadow_freshness / STALE) is a separate axis from every
  // structural check in this function - a shadow can be structurally
  // perfect and stale, or broken and current. Delegated to a shared,
  // SDK-neutral function so this client validator and the admin CLI
  // (scripts/validateSpaceMigration.js) can never drift out of sync on
  // what "stale" means. See shared/spaceShadowValidation.js.
  findings.push(...evaluateSpaceShadowValidation(plan, { project: projectSnap.exists() ? projectSnap.data() : null }));

  // Ownership chain - every doc lives under the same uid path segment.
  // True by construction given how the refs above were built (uid is
  // baked into every path), but confirmed explicitly here rather than
  // assumed. Batches are checked individually (there can be any number
  // of them), not as a single fixed doc.
  [["space", spaceSnap], ["project", projectSnap], ["session", sessionSnap]].forEach(([label, snap]) => {
    if (snap.exists() && snap.ref.path.startsWith(`users/${uid}/`)) ok(`ownership-chain-${label}`);
    else fail(`ownership-chain-${label}`, `path starts with users/${uid}/`, snap.exists() ? snap.ref.path : "(missing)");
  });
  batchSnaps.forEach((snap) => {
    if (snap.ref.path.startsWith(`users/${uid}/`)) ok(`ownership-chain-batch-${snap.id}`);
    else fail(`ownership-chain-batch-${snap.id}`, `path starts with users/${uid}/`, snap.ref.path);
  });

  // Reconstructed Batches match the source plan's batchHistory and
  // currentBatch - staleness-aware per the note below, generalized across
  // every expected batch (Batch Identity Alignment fix - a plan can have
  // any number of batches, not just one). Builds the expected list the
  // same way syncPlanToSpaceGraph/forceFullReprojection do, and looks
  // each one up by its real computeShadowBatchId, not a single fixed ID.
  const archivedBatches = Array.isArray(plan.batchHistory) ? plan.batchHistory : [];
  const expectedBatches = [
    ...archivedBatches.map(b => ({ ...b, archived: true })),
    ...(plan.currentBatch ? [{ ...plan.currentBatch, archived: false }] : []),
  ];
  const batchSnapsById = new Map(batchSnaps.map(s => [s.id, s]));

  if (expectedBatches.length === 0) {
    info("batch-content-match", "source plan has no batchHistory or currentBatch to compare against");
  } else {
    expectedBatches.forEach((sourceBatch) => {
      const expectedId = computeShadowBatchId(planId, sourceBatch.batchIndex);
      const shadowSnap = batchSnapsById.get(expectedId);
      if (!shadowSnap) {
        fail(`batch-${sourceBatch.batchIndex}-shadow-exists`, "batch document present", "not found");
        return;
      }
      const shadowItems = shadowSnap.data().items || [];
      const sourceItems = sourceBatch.items || [];
      const textsMatch = shadowItems.length === sourceItems.length && shadowItems.every((it, i) => it.text === sourceItems[i]?.text);
      if (textsMatch) ok(`batch-${sourceBatch.batchIndex}-item-text-match`);
      else fail(`batch-${sourceBatch.batchIndex}-item-text-match`, sourceItems.map(i => i.text), shadowItems.map(i => i.text));

      // Correction made before staging testing, Slice 1 (caught while
      // designing the "plan progressed" scenario, not after): archived
      // does NOT mean strictly comparable. An archived batch reflects
      // real user resolution (items checked/carried/skipped as the user
      // actually worked) which a creation-time-only shadow snapshot never
      // captured by design. Comparing shadow-vs-archived status would
      // therefore show a false MISMATCH on nearly every genuinely
      // completed batch, not just on real shadow-write defects. The only
      // state where a status mismatch is actually meaningful is when
      // nothing has happened to THIS batch since it was last synced:
      // still the live current batch, and every item still "pending."
      const nothingHasHappenedYet = !sourceBatch.archived && sourceItems.every(i => i.status === "pending");
      if (nothingHasHappenedYet) {
        const statusesMatch = shadowItems.length === sourceItems.length && shadowItems.every((it, i) => it.status === sourceItems[i]?.status);
        if (statusesMatch) ok(`batch-${sourceBatch.batchIndex}-item-status-match`);
        else fail(`batch-${sourceBatch.batchIndex}-item-status-match`, sourceItems.map(i => i.status), shadowItems.map(i => i.status));
      } else {
        info(`batch-${sourceBatch.batchIndex}-item-status-match`, sourceBatch.archived
          ? "this batch has been archived - its final status reflects real user resolution, which a creation-time-only shadow snapshot never captured by design; expected staleness, not a defect"
          : "this batch has live item status changes since the last shadow sync; expected staleness, not validated as pass/fail here");
      }
    });

    // Exact-count cross-check - checkSpaceShadowExists alone can only
    // confirm "at least one batch present," not "exactly the right
    // ones." This is where that finer completeness check happens, now
    // that the plan's real expected set is known.
    const expectedIds = new Set(expectedBatches.map(b => computeShadowBatchId(planId, b.batchIndex)));
    const unexpectedBatchIds = batchSnaps.filter(s => !expectedIds.has(s.id)).map(s => s.id);
    if (unexpectedBatchIds.length) fail("batch-count-matches-plan", `${expectedIds.size} expected batch document(s)`, `${batchSnaps.length} present, including unexpected: ${unexpectedBatchIds.join(", ")}`);
    else if (batchSnaps.length === expectedIds.size) ok("batch-count-matches-plan");
    else fail("batch-count-matches-plan", `${expectedIds.size} expected batch document(s)`, `${batchSnaps.length} present`);
  }

  // companionComplete preserved accurately - same staleness reasoning.
  if (!projectSnap.exists()) {
    fail("companion-complete-reflected", "project document present", "not found");
  } else if (plan.companionComplete) {
    info("companion-complete-reflected", "source plan is now complete; the creation-time shadow snapshot predates this and was never updated - expected, since Part 1 does not sync ongoing state, not a defect");
  } else {
    ok("companion-complete-reflected");
  }

  const mismatches = findings.filter(f => f.status === "MISMATCH");
  dlog(`[SPACE SHADOW VALIDATE] plan ${planId}: ${findings.length} checks, ${mismatches.length} mismatch(es)`);
  if (mismatches.length) dlog(`[SPACE SHADOW VALIDATE] mismatches: ${JSON.stringify(mismatches)}`);
  return { planId, findings };
}

// ---- Slice 2: read-only Space shadow graph loader (dev inspector) ----
// Assembles the full shadow graph for one plan into a single, stable
// shape for display: { sourcePlan, space, project, session, batch,
// validation }. Read-only - the only calls it makes are getDoc/getDocs
// via checkSpaceShadowExists and validateSpaceShadowMigration, both
// already proven read-only in Slice 1 (re-verified for this slice too,
// not carried forward by assumption - see the report). Deliberately
// reuses validateSpaceShadowMigration for the `validation` field rather
// than reimplementing any invariant check, so the inspector and the CLI
// validator can never drift out of sync with each other - if an
// invariant is fixed or added there, this picks it up automatically.
// Never throws on a missing/partial shadow; a pre-Slice-1 legacy plan
// with no shadow at all is a normal, expected, explicit state, not an
// error condition.
async function loadSpaceShadowGraph(uid, planId) {
  const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
  if (!planSnap.exists()) {
    return {
      sourcePlan: { exists: false, id: planId },
      space: { exists: false }, project: { exists: false }, session: { exists: false }, batches: [],
      validation: { findings: [{ invariant: "source-plan-exists", status: "MISMATCH", expected: "plan document present", found: "not found" }] },
      expectedIds: computeShadowIds(planId),
    };
  }
  const sourcePlan = { exists: true, id: planId, data: planSnap.data() };
  const expectedIds = computeShadowIds(planId, sourcePlan.data);

  const presence = await checkSpaceShadowExists(uid, planId, sourcePlan.data);
  const toEntry = (snap) => (snap && snap.exists() ? { exists: true, id: snap.id, data: snap.data() } : { exists: false });
  // Batch Identity Alignment fix: batches is now a list (any number of
  // documents), sorted by batchIndex for stable, predictable display -
  // not a single fixed-ID document.
  const toBatchEntries = (snaps) => [...snaps]
    .map(s => ({ exists: true, id: s.id, data: s.data() }))
    .sort((a, b) => (a.data.batchIndex ?? 0) - (b.data.batchIndex ?? 0));

  if (presence.nonePresent) {
    return {
      sourcePlan,
      space: { exists: false }, project: { exists: false }, session: { exists: false }, batches: [],
      validation: { findings: [{ invariant: "shadow-presence", status: "MISSING", note: "no shadow documents exist for this plan - either a pre-Slice-1 legacy plan, or an interrupted fire-and-forget write" }] },
      expectedIds,
    };
  }

  // Not reachable given the transactional write's atomicity, but not
  // silently mishandled if it somehow occurs - surfaced explicitly
  // rather than treated as either "present" or "missing".
  if (!presence.allPresent) {
    return {
      sourcePlan,
      space: toEntry(presence.snaps.spaceSnap), project: toEntry(presence.snaps.projectSnap),
      session: toEntry(presence.snaps.sessionSnap), batches: toBatchEntries(presence.snaps.batchSnaps),
      validation: { findings: [{ invariant: "shadow-presence", status: "MISMATCH", expected: "0 documents, or Space+Project+Session plus at least 1 Batch (atomic)", found: `${presence.presentCount} present (${presence.batchCount} batch doc(s))` }] },
      expectedIds,
    };
  }

  // Step 6: pass the plan and shadow reads already done above straight
  // through instead of letting validateSpaceShadowMigration re-fetch the
  // same plan doc and the same shadow docs a second time.
  const validation = await validateSpaceShadowMigration(uid, planId, { planSnap, presence });

  return {
    sourcePlan,
    space: toEntry(presence.snaps.spaceSnap),
    project: toEntry(presence.snaps.projectSnap),
    session: toEntry(presence.snaps.sessionSnap),
    batches: toBatchEntries(presence.snaps.batchSnaps),
    validation,
    expectedIds,
  };
}

// ---- Shadow Synchronization: canonical projection function ----
// The single owner of "derive shadow state from the current plan." Not
// wired into any mutation trigger yet (that is Step 3, deliberately not
// started here) - this is the function itself, ready to be called.
//
// Always a full re-projection from freshly-read plan state, never from
// caller-provided data - deliberately, since mutation-triggered syncs are
// fire-and-forget and may complete out of order. Implemented as a real
// Firestore transaction, not a read-then-write sequence: the plan and
// Project docs are read inside the transaction and compared before any
// write is attempted, so an older, later-completing sync can never
// overwrite a newer shadow graph - either the version check no-ops it
// directly, or (if two syncs' reads/writes genuinely interleave)
// Firestore's own transaction conflict detection retries this function
// from scratch against the now-current state.
async function syncPlanToSpaceGraph(uid, planId) {
  const planRef = doc(db, "users", uid, "plans", planId);

  const result = await runTransaction(db, async (tx) => {
    // Explicit plan-existence check, first, before anything else - part of
    // this function's core contract, not a test-only concern. This
    // function may only ever project from an existing authoritative plan.
    // If the plan is absent at transaction-read time - whether deleted
    // before the transaction started, or deleted while it was in flight
    // and forced Firestore to retry it - this is a normal terminal outcome
    // for a fire-and-forget caller, not an error: exit with zero writes,
    // no Space/Project/Session/Batch created or modified.
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists()) {
      return { outcome: "source-plan-missing" };
    }
    const plan = planSnap.data();
    const planVersion = typeof plan.shadowSourceVersion === "number" ? plan.shadowSourceVersion : 1;

    // Migration/Live-Sync Projection Alignment (MigrationSyncAlignmentDesign.md):
    // the full graph - Space, Project (incl. migrationVersion), every
    // reconstructed Session, every Batch - is derived by the exact same
    // shared function forceFullReprojection uses, not a separate inline
    // single-Session projection. This is what makes a migrated plan stay
    // migration-complete after an ordinary live mutation: there is no
    // longer a second, simpler shape for live sync to silently regress it
    // to. ids (spaceId/projectId, canonicalSpaceId-aware) come from the
    // same derivation, not computed separately.
    const derived = deriveFullReprojectionDocs(planId, plan);
    const { spaceId, projectId } = derived.ids;
    const spaceRef = doc(db, "users", uid, "spaces", spaceId);
    const projectRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId);

    // Read the Space alongside the Project - both reads happen before any
    // write, as every Firestore transaction requires. Whether the Space
    // already exists decides which of the two payloads below gets written
    // (Canonical Space Preservation - see deriveFullReprojectionDocs).
    const [spaceSnap, projectSnap] = await Promise.all([tx.get(spaceRef), tx.get(projectRef)]);

    // Retirement guard (DeletionDesign.md Addendum/Phase C1): a Space
    // retired for ANY reason - merge/reclassification tombstone or, as of
    // the soft-delete model, a user-initiated delete sitting in its 30-day
    // retention window - must never receive a fresh projection write.
    // Without this, a stale session's fire-and-forget live-mutation sync
    // (Companion batch pause/wrap-up/completion, next-batch, rename) could
    // silently resurrect real data under a Room the user already deleted -
    // invisible (still retired, still hidden by every existing !retired
    // filter) but real, and a race against the eventual hard-delete sweep's
    // own "verify nothing references this Space" check. Not an error - the
    // plan itself is perfectly valid, it just must not project into a
    // retired destination. Only checked when the Space already exists; a
    // brand-new Space can't be retired before it's ever been created.
    if (spaceSnap.exists() && spaceSnap.data().retired === true) {
      dlog(`[SPACE SHADOW SYNC] refusing to write under retired Space ${spaceId} for plan ${planId}`);
      return { outcome: "target-retired", spaceId };
    }

    const existingVersion = projectSnap.exists() && typeof projectSnap.data().sourceVersion === "number"
      ? projectSnap.data().sourceVersion
      : -1; // no shadow yet - always proceed

    if (existingVersion > planVersion) {
      // A newer projection is already persisted than what this plan state
      // would produce - this call is the late one. Do not write anything.
      return { outcome: "no-op", reason: "existing shadow already at or ahead of this plan version", existingVersion, planVersion, spaceId };
    }

    // syncedAt uses this SDK's own serverTimestamp() sentinel - the shared
    // derivation deliberately omits it (client and admin SDKs' sentinels
    // are different, incompatible objects - see shared/spaceMigration.js's
    // file header). Added here, once, exactly as forceFullReprojection
    // does it.
    const now = serverTimestamp();
    // Canonical Space Preservation: a brand-new Space gets the full
    // document (creation); an already-existing Space is merge-written
    // with ONLY the field(s) projection legitimately owns, leaving every
    // creation-owned/user-owned/merge-owned field - including a retired
    // Space's own tombstone fields - completely untouched.
    if (spaceSnap.exists()) {
      tx.set(spaceRef, { ...derived.spaceProjectionUpdate, syncedAt: now }, { merge: true });
    } else {
      tx.set(spaceRef, { ...derived.space, syncedAt: now });
    }
    tx.set(projectRef, { ...derived.project, syncedAt: now });

    let batchCount = 0;
    derived.sessions.forEach((session) => {
      const sessionRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id);
      tx.set(sessionRef, { ...session.data, syncedAt: now });
      session.batches.forEach((batch) => {
        const batchRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id, "batches", batch.id);
        tx.set(batchRef, { ...batch.data, syncedAt: now });
        batchCount++;
      });
    });

    return { outcome: "written", sourceVersion: derived.sourceVersion, migrationVersion: MIGRATION_VERSION, sessionCount: derived.sessions.length, batchCount, spaceId, areaId: derived.project.areaId ?? null };
  });

  // My Rooms -> True Room Grouping, Phase A - see updateSpaceRoomSummary's
  // own comment for the idempotency contract. Deliberately outside the
  // transaction above (reading a whole subcollection inside a transaction
  // risks the read-set/size limits a Room with many visits could
  // eventually hit) - a failure here never affects the sync's own
  // already-committed result, which is why it's applied after the
  // transaction fully resolves, not folded into it.
  if (result.outcome === "written") {
    await updateSpaceRoomSummary(uid, result.spaceId);
    // Area Identity, Phase A - same hook, one level down.
    if (result.areaId) {
      await updateAreaSummary(uid, result.spaceId, result.areaId);
    }
  }

  return result;
}

// ---- Shadow Synchronization: deletion lifecycle ----
// The projection layer's second deterministic operation (sync current
// state; remove graph for a deleted source) - same single owner, not a
// violation of it. Must be called only AFTER the authoritative plan
// deletion has already succeeded (see deletePlan's call site) - plans
// remains authoritative during this phase, so a temporarily orphaned
// shadow (repairable later by a reconciliation sweep) is a safer failure
// state than ever deleting the shadow while the plan it represents is
// still live.
// §12 Migration Part 4: canonicalSpaceId is an explicit third parameter,
// not resolved internally via computeShadowIds(planId, plan) - by the time
// this runs the plan is already gone (see the comment above), so there is
// no plan document left to read plan.canonicalSpaceId from. The caller
// must capture it from the plan record it already has in hand BEFORE
// initiating deletion (MergeExecutionDesign.md §2). Passing null/undefined
// reproduces today's exact behavior (spaceId === planId), correct for the
// overwhelming majority of plans that have never been merged.
async function deleteSpaceShadowGraph(uid, planId, canonicalSpaceId) {
  const spaceId = canonicalSpaceId || planId;
  const projectId = planId;
  const sessionId = planId;
  try {
    const batchesSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sessionId, "batches"));
    await Promise.all(batchesSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sessionId));

    // A Space could plausibly still be valid for other Projects (post-§12
    // migration, once merging exists) - check before assuming it's safe to
    // delete, rather than assuming today's 1:1 model always holds. Today,
    // pre-migration, this will always find zero siblings - the check is
    // here so this function doesn't need to change once that's no longer
    // true.
    const siblingProjectsSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects"));
    const hasSiblingProjects = siblingProjectsSnap.docs.some(d => d.id !== projectId);

    await deleteDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId));
    if (!hasSiblingProjects) {
      await deleteDoc(doc(db, "users", uid, "spaces", spaceId));
    }
    return { outcome: "deleted", spaceDeleted: !hasSiblingProjects };
  } catch (e) {
    // Non-fatal by design - the plan itself is already gone by the time
    // this runs. A shadow left behind here is an orphan, not a
    // correctness risk to any live plan, and is exactly what the future
    // reconciliation sweep is for.
    dlog(`[SPACE SHADOW DELETE] cleanup failed for plan ${planId}, orphaned shadow left for reconciliation: ${e.message}`);
    return { outcome: "failed", error: e.message };
  }
}

// ---- Step 5: non-blocking app-start reconciliation for the active/
// resumable plan ----
// Deliberately cheap: exactly two reads (the plan, and its Project
// shadow only - not the full 4-doc checkSpaceShadowExists, and not
// validateSpaceShadowMigration's full invariant sweep), to avoid the
// read-amplification pattern already flagged during Slice 3's scoping.
// Classification is presence-of-Project-doc plus the same version
// comparison shared/spaceShadowValidation.js uses for STALE - not a
// third copy of that logic, just the two fields needed to decide whether
// a sync is worth running at all. Any actual repair is delegated to the
// canonical syncPlanToSpaceGraph projection (the same function every
// real mutation call site uses, and what repairSpaceShadow above now
// delegates to as well) - never a separate projection. Never throws:
// every caller of this function is expected to be a fire-and-forget
// call with its own .catch(), matching the pattern already used at the
// five mutation call sites.
async function reconcileActivePlanShadow(uid, planId) {
  const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
  if (!planSnap.exists()) {
    dlog(`[SPACE SHADOW RECONCILE] plan ${planId}: source plan no longer exists, nothing to reconcile`);
    return { outcome: "source-plan-missing" };
  }
  const plan = planSnap.data();
  const { spaceId, projectId } = computeShadowIds(planId, plan);
  const projectSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId));
  const planVersion = typeof plan.shadowSourceVersion === "number" ? plan.shadowSourceVersion : 1;
  const projectVersion = projectSnap.exists() && typeof projectSnap.data().sourceVersion === "number" ? projectSnap.data().sourceVersion : -1;

  if (!projectSnap.exists()) {
    dlog(`[SPACE SHADOW RECONCILE] plan ${planId}: MISSING (no Project shadow) - syncing`);
    return syncPlanToSpaceGraph(uid, planId);
  }
  if (planVersion > projectVersion) {
    dlog(`[SPACE SHADOW RECONCILE] plan ${planId}: STALE (plan v${planVersion} > project v${projectVersion}) - syncing`);
    return syncPlanToSpaceGraph(uid, planId);
  }
  dlog(`[SPACE SHADOW RECONCILE] plan ${planId}: already current (plan v${planVersion}, project v${projectVersion}) - no action`);
  return { outcome: "already-current", planVersion, projectVersion };
}

// ---- Migration engine: unconditional full reprojection + a separate,
// read-only completeness check ----
// Deliberately distinct from syncPlanToSpaceGraph, not a thin variant of
// it. syncPlanToSpaceGraph's internal existingVersion > planVersion guard
// (see its body above) is correct and required for its own callers (live
// mutation sync, reconcileActivePlanShadow, repairSpaceShadow) - it is
// what stops an out-of-order fire-and-forget sync from clobbering a
// newer shadow. But that same guard means its contract is overloaded for
// migration's purposes: it decides "is this already complete enough to
// skip" AND performs the write, in one function - a migration runner
// needs those two decisions kept apart, so it can know definitively,
// before calling anything, whether a write is about to happen, rather
// than discover after the fact that the function it called silently
// chose not to.
//
// forceFullReprojection is the write half: unconditional, no internal
// completeness/staleness decision beyond the same plan-existence
// precondition syncPlanToSpaceGraph already has (a basic precondition,
// not a completeness judgment - there is nothing to project from a plan
// that doesn't exist). It also differs from syncPlanToSpaceGraph on the
// merits, not just by dropping a guard: per SpaceMemoryModel.md §12's
// committed Migration Invariant, migration must "reconstruct Session
// boundaries from the legacy plan's existing batchHistory timestamps
// wherever they are distinguishable, rather than collapsing all
// historical activity into one undifferentiated record."
// syncPlanToSpaceGraph always writes exactly one Session (sessionId =
// planId) - correct for its own job (projecting live current state) but
// not compliant with §12 for a first-time migration. forceFullReprojection
// does real Session reconstruction instead.
//
// checkMigrationCompleteness is the decision half: read-only, intended to
// be called by a migration runner BEFORE forceFullReprojection to decide
// whether there is anything to do at all.

// MIGRATION_VERSION, reconstructSessionClusters, and the payload/
// completeness derivation logic itself now live in shared/spaceMigration.js
// (imported above) - the pure SDK-neutral core, callable from both this
// file and a Node admin CLI/migration runner, so they can never
// independently drift. Both functions below are thin I/O shells: they do
// their own reads/writes with the client SDK and call into the shared
// module for the actual decisions.

async function forceFullReprojection(uid, planId) {
  const planRef = doc(db, "users", uid, "plans", planId);

  const result = await runTransaction(db, async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists()) {
      return { outcome: "source-plan-missing" };
    }
    const plan = planSnap.data();
    const derived = deriveFullReprojectionDocs(planId, plan);
    const { spaceId, projectId } = derived.ids;
    const spaceRef = doc(db, "users", uid, "spaces", spaceId);
    const projectRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId);

    // Read before write, as every Firestore transaction requires -
    // whether the Space already exists decides which payload gets
    // written (Canonical Space Preservation - see deriveFullReprojectionDocs).
    const spaceSnap = await tx.get(spaceRef);

    // Retirement guard - same reasoning as syncPlanToSpaceGraph's own
    // identical check above (this function's sibling, not a separate
    // concern): a retired Space (merge tombstone or soft-deleted, either
    // way) must never receive a fresh projection write, even from the
    // unconditional migration engine.
    if (spaceSnap.exists() && spaceSnap.data().retired === true) {
      dlog(`[FULL REPROJECTION] refusing to write under retired Space ${spaceId} for plan ${planId}`);
      return { outcome: "target-retired", spaceId };
    }

    // syncedAt uses this SDK's own serverTimestamp() sentinel - the shared
    // derivation deliberately omits it, since the client and admin SDKs'
    // sentinels are different, incompatible objects. See
    // shared/spaceMigration.js's file header.
    const now = serverTimestamp();
    if (spaceSnap.exists()) {
      tx.set(spaceRef, { ...derived.spaceProjectionUpdate, syncedAt: now }, { merge: true });
    } else {
      tx.set(spaceRef, { ...derived.space, syncedAt: now });
    }
    tx.set(projectRef, { ...derived.project, syncedAt: now });

    let batchCount = 0;
    derived.sessions.forEach((session) => {
      const sessionRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id);
      tx.set(sessionRef, { ...session.data, syncedAt: now });
      session.batches.forEach((batch) => {
        const batchRef = doc(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", session.id, "batches", batch.id);
        tx.set(batchRef, { ...batch.data, syncedAt: now });
        batchCount++;
      });
    });

    return { outcome: "written", sourceVersion: derived.sourceVersion, migrationVersion: MIGRATION_VERSION, sessionCount: derived.sessions.length, batchCount, spaceId, areaId: derived.project.areaId ?? null };
  });

  // My Rooms -> True Room Grouping, Phase A - same hook and idempotency
  // contract as syncPlanToSpaceGraph's own (see there for the full
  // comment). This function has no live call site in the client today
  // (migration is Admin-SDK-only) - kept consistent so it's correct if
  // that ever changes, not a dead gap.
  if (result.outcome === "written") {
    await updateSpaceRoomSummary(uid, result.spaceId);
    // Area Identity, Phase A - same hook, one level down.
    if (result.areaId) {
      await updateAreaSummary(uid, result.spaceId, result.areaId);
    }
  }

  return result;
}

// Read-only. Reads Space/Project/every Session/every Batch actually
// present, then delegates the completeness decision entirely to the
// shared evaluateMigrationCompleteness. Never writes.
async function checkMigrationCompleteness(uid, planId) {
  const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
  if (!planSnap.exists()) return { complete: false, reasons: ["source plan missing"] };
  const plan = planSnap.data();
  const { spaceId, projectId } = computeShadowIds(planId, plan);

  const spaceSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId));
  const projectSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId));
  if (!spaceSnap.exists() || !projectSnap.exists()) {
    return { complete: false, reasons: ["Space or Project document missing"] };
  }

  const sessionsSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions"));
  const sessionsWithBatches = await Promise.all(sessionsSnap.docs.map(async (sDoc) => {
    const batchesSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sDoc.id, "batches"));
    return { id: sDoc.id, data: sDoc.data(), batches: batchesSnap.docs.map((b) => ({ id: b.id, data: b.data() })) };
  }));

  return evaluateMigrationCompleteness(planId, plan, {
    space: spaceSnap.data(),
    project: projectSnap.data(),
    sessionsWithBatches,
  });
}

// ---- §12 Migration Part 3, Pass 2: merge-proposal surfacing/resolution
// UI - MergeProposalDesign.md. Every write below commits atomically (a
// single writeBatch: the immutable history entry and the current-state
// document change together, or neither does - Firestore batches are
// genuinely all-or-nothing, so a rejected write - e.g. a security-rules
// denial - leaves no partial candidate/history state behind). Every read
// uses the authenticated client SDK, subject to the same rules as any
// other user data (Pass 1's `mergeCandidates`/`history` rules).

// Read-only. Non-blocking app-start query (mirrors reconcileActivePlanShadow's
// own app-start-trigger pattern) - a user's pending candidates only.
//
// stale-confirmed candidates are deliberately NOT queried here (removed
// from proactive surfacing per a later product decision - the
// "Understood"/reversal actions and the stale-confirmed review-screen
// section were pulled, but the underlying data, resolutionStatus
// transition, and acknowledgedAt field are untouched and unchanged in
// Firestore - see acknowledgeStaleConfirmed/reverseStaleConfirmed below,
// kept in place but currently unreferenced by any render path, for a
// possible future history/decisions view). staleUnacknowledged is kept
// in the return shape as an always-empty array rather than removed
// outright, so this function's callers don't need special-casing for a
// shape that may come back if that future view is built.
async function queryMergeCandidatesForBanner(uid) {
  const candidatesRef = collection(db, "users", uid, "mergeCandidates");
  const pendingSnap = await getDocs(query(candidatesRef, where("resolutionStatus", "==", "pending")));
  const pending = pendingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { pending, staleUnacknowledged: [] };
}

// User-Managed Space Identity (§12 Migration Part 3). Just another
// authoritative mutation - the exact same contract already proven at
// five other call sites (e.g. the batch-pause/wrap-up/completion/
// next-batch/retroactive-save syncs above): write the authoritative
// field on the plan document, increment shadowSourceVersion, then fire
// syncPlanToSpaceGraph without awaiting it. No new mechanism, no
// special-cased sync path. `spaceType` (the AI's original classification)
// is never touched - only the new `spaceName` field is written, per the
// design principle recorded at getSpaceDisplayName's definition
// (shared/spaceMigration.js): the user's name becomes canonical: display,
// detection, comparison, merge-candidate grouping.
async function renameSpace(uid, planId, newName) {
  // Canonical Space Preservation: read first so canonicalSpaceId (if this
  // plan is a returning-visit Project) resolves the SAME target Space
  // syncPlanToSpaceGraph below will - a rename must land on the shared
  // established Space, not some other path.
  const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
  const canonicalSpaceId = planSnap.exists() ? planSnap.data().canonicalSpaceId : null;
  // My Rooms -> True Room Grouping, rollout closeout item 3: rename
  // touches ONLY Space.displayName now - the plan's own spaceName is
  // historical metadata under the new source-of-truth contract (Phase A
  // Section 1b/5) and must stay untouched, INCLUDING the plan used to
  // initiate the rename. shadowSourceVersion is still bumped so
  // syncPlanToSpaceGraph below genuinely re-syncs (a real "written"
  // outcome, not a no-op) - which is also what keeps this Room's summary
  // fields (Phase A's updateSpaceRoomSummary hook) current after a rename,
  // for free, via the exact same mechanism every other mutation already
  // uses.
  await updateDoc(doc(db, "users", uid, "plans", planId), { shadowSourceVersion: increment(1) });
  // displayName is user-owned (see deriveFullReprojectionDocs) - written
  // here, directly and explicitly, never through the generic projection
  // sync below, which deliberately excludes displayName from what it
  // writes to an already-existing Space. Without this direct write, a
  // rename would only ever "stick" until some OTHER Project under the
  // same Space next syncs with its own, different spaceType/spaceName -
  // silently reverting it. updateDoc (not set) so a missing Space
  // document fails loudly into the catch below rather than being
  // silently created as a malformed partial document.
  const { spaceId } = computeShadowIds(planId, { canonicalSpaceId });
  updateDoc(doc(db, "users", uid, "spaces", spaceId), { displayName: newName })
    .catch((e) => dlog(`[SPACE RENAME] displayName propagation failed for space ${spaceId}: ${e.message}`));
  syncPlanToSpaceGraph(uid, planId).catch((e) => dlog(`[SPACE SHADOW SYNC] rename sync failed for plan ${planId}: ${e.message}`));
  return { outcome: "renamed", planId, spaceName: newName };
}

// ---- Legacy Reclassification, Client-SDK mirror
// (LegacyReclassificationDesign.md §2) - Room Rename's "Move plans to
// [Room]" correction path (Room Rename Validation, 2026-08-10). Line-for-
// line the same phase sequence and status machine as
// scripts/reclassifyLegacyPlan.js's Admin-SDK version, already proven
// against the real Entertainment Center case - that script is left
// completely unchanged for CLI/staging-test use; this is a parallel
// client-SDK shell around the identical logic so an ordinary user's tap
// in the live app can drive it directly. Every phase is independently
// resumable via the same reclassificationExecutions/{planId} status
// document; the orchestrator (reclassifyLegacyPlan, below) is safe to
// call repeatedly.
//
// One deliberate difference from the Admin version: cleanUpOldSpace can't
// use listCollections() (Admin-SDK-only, no client-SDK equivalent - the
// client security model doesn't allow subcollection discovery) - it
// walks the KNOWN, fixed shadow shape (Project -> Sessions -> Batches,
// the only shape deriveFullReprojectionDocs ever writes) explicitly
// instead of a generic recursive delete.
async function deleteProjectSubtree(uid, spaceId, projectId) {
  const sessionsSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions"));
  for (const sessionDoc of sessionsSnap.docs) {
    const batchesSnap = await getDocs(collection(db, "users", uid, "spaces", spaceId, "projects", projectId, "sessions", sessionDoc.id, "batches"));
    for (const batchDoc of batchesSnap.docs) {
      await deleteDoc(batchDoc.ref);
    }
    await deleteDoc(sessionDoc.ref);
  }
  await deleteDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId)).catch(() => {});
}

// ---- Phase 1: claim (validate target, idempotency, capture oldSpaceId) ----
async function claimReclassification(uid, planId, request) {
  const { targetSpaceId, requestedRoomName, requestedAreaName, requestedAreaScope = "sub-area" } = request;
  const planRef = doc(db, "users", uid, "plans", planId);
  const targetSpaceRef = doc(db, "users", uid, "spaces", targetSpaceId);
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);

  return runTransaction(db, async (tx) => {
    const planSnap = await tx.get(planRef);
    if (!planSnap.exists()) return { outcome: "plan-missing", planId };
    const plan = planSnap.data();

    const targetSpaceSnap = await tx.get(targetSpaceRef);
    const validation = validateTargetSpace(targetSpaceSnap.exists() ? targetSpaceSnap.data() : null);
    if (!validation.valid) return { outcome: "invalid-target-space", planId, targetSpaceId, reason: validation.reason };

    const executionSnap = await tx.get(executionRef);

    const requestTuple = { targetSpaceId, requestedRoomName, requestedAreaName, requestedAreaScope };
    if (executionSnap.exists()) {
      const execution = executionSnap.data();
      const tupleMatches = execution.targetSpaceId === targetSpaceId
        && execution.requestedRoomName === requestedRoomName
        && execution.requestedAreaName === requestedAreaName
        && execution.requestedAreaScope === requestedAreaScope;

      if (execution.status !== "completed" && execution.status !== "blocked") {
        if (tupleMatches) return { outcome: "resumed", planId, status: execution.status };
        return { outcome: "conflict", planId, reason: "a different reclassification is already in progress for this plan", inProgress: { targetSpaceId: execution.targetSpaceId, requestedRoomName: execution.requestedRoomName } };
      }
      if (execution.status === "completed" && tupleMatches) {
        return { outcome: "already-completed", planId, status: execution.status };
      }
      // blocked+matches (retry), blocked+differs (fresh), or completed+differs
      // (fresh, later correction) - all fall through to a fresh claim below.
    }

    // oldSpaceId is captured HERE, before anything changes it - the plan's
    // shadow location as it exists right now, whatever that is.
    const oldSpaceId = computeShadowIds(planId, plan).spaceId;
    const oldSpaceSnap = oldSpaceId === targetSpaceId ? targetSpaceSnap : await tx.get(doc(db, "users", uid, "spaces", oldSpaceId));
    const oldSpaceDisplayNameAtClaim = oldSpaceSnap.exists() ? (oldSpaceSnap.data().displayName || null) : null;
    const targetSpaceDisplayNameAtClaim = targetSpaceSnap.data().displayName || null;

    const now = serverTimestamp();
    const attempt = executionSnap.exists() ? (executionSnap.data().attempt || 1) + 1 : 1;

    tx.set(executionRef, {
      planId, oldSpaceId, targetSpaceId,
      requestedRoomName, requestedAreaName, requestedAreaScope,
      oldSpaceDisplayNameAtClaim, targetSpaceDisplayNameAtClaim,
      status: "claimed",
      blockedReasons: null,
      reconciledCandidateIds: [],
      attempt,
      claimedAt: now,
      completedAt: null,
    });

    return { outcome: "claimed", planId, oldSpaceId, targetSpaceId, attempt };
  });
}

// ---- Phase 2: establish the target projection ----
async function establishTargetProjection(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status !== "claimed") {
    return { outcome: "already-established", planId, status: execution.status };
  }

  const planRef = doc(db, "users", uid, "plans", planId);
  const targetSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", execution.targetSpaceId));
  const inheritedSpaceName = targetSpaceSnap.exists() ? (targetSpaceSnap.data().displayName || null) : execution.requestedRoomName;

  await updateDoc(planRef, {
    canonicalSpaceId: execution.targetSpaceId,
    spaceName: inheritedSpaceName,
    areaName: execution.requestedAreaName,
    areaScope: execution.requestedAreaScope,
    shadowSourceVersion: increment(1),
  });

  const reprojectResult = await forceFullReprojection(uid, planId);
  if (reprojectResult.outcome === "source-plan-missing") {
    await updateDoc(executionRef, { status: "blocked", blockedReasons: ["source plan disappeared during reprojection"] });
    return { outcome: "blocked", planId, reason: "source plan disappeared during reprojection" };
  }
  // Retirement guard, narrow race window: claimReclassification already
  // rejects a retired target at claim time via validateTargetSpace - this
  // only fires if the target Space was retired AFTER a successful claim
  // but BEFORE reprojection ran. Same treatment as source-plan-missing:
  // blocked, not silently marked "established" (the plan's canonicalSpaceId/
  // areaName/areaScope fields above were already written by this point,
  // but with zero shadow Project ever created under the retired target -
  // leaving execution in "blocked" is what lets a retry (once the caller
  // resolves to a real, non-retired target) pick this back up correctly).
  if (reprojectResult.outcome === "target-retired") {
    await updateDoc(executionRef, { status: "blocked", blockedReasons: ["target Space was retired during reprojection"] });
    return { outcome: "blocked", planId, reason: "target Space was retired during reprojection" };
  }

  await updateDoc(executionRef, { status: "target-established" });
  return { outcome: "established", planId, targetSpaceId: execution.targetSpaceId, reprojectResult };
}

// ---- Phase 3: validate the target projection (read-only) ----
async function validateTargetProjection(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "claimed") return { outcome: "target-not-yet-established", planId };
  if (execution.status !== "target-established") {
    return { outcome: "already-validated-or-later", planId, status: execution.status };
  }

  const completeness = await checkMigrationCompleteness(uid, planId);
  const projectSnap = await getDoc(doc(db, "users", uid, "spaces", execution.targetSpaceId, "projects", planId));
  const scopedCorrectly = projectSnap.exists() && projectSnap.data().scopeId === execution.targetSpaceId;
  const reasons = [...completeness.reasons];
  if (!scopedCorrectly) reasons.push(`Project.scopeId does not equal target Space ${execution.targetSpaceId}`);

  if (reasons.length) {
    await updateDoc(executionRef, { status: "blocked", blockedReasons: reasons });
    return { outcome: "invalid", planId, reasons };
  }
  await updateDoc(executionRef, { status: "target-validated" });
  return { outcome: "valid", planId };
}

// ---- Phase 4: clean up the old Space (Case A guard lives here) ----
async function cleanUpOldSpace(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "claimed" || execution.status === "target-established") {
    return { outcome: "not-yet-validated", planId, status: execution.status };
  }
  if (execution.status !== "target-validated") {
    return { outcome: "already-cleaned-up-or-later", planId, status: execution.status };
  }

  // CASE A GUARD: source and target are the same Space - nothing is
  // retired, no self-redirect is ever written.
  if (execution.oldSpaceId === execution.targetSpaceId) {
    await updateDoc(executionRef, { status: "old-space-cleaned-up" });
    return { outcome: "case-a-no-op", planId, reason: "oldSpaceId === targetSpaceId, nothing to retire" };
  }

  await deleteProjectSubtree(uid, execution.oldSpaceId, planId);

  const siblingProjectsSnap = await getDocs(collection(db, "users", uid, "spaces", execution.oldSpaceId, "projects"));
  const hasSiblingProjects = siblingProjectsSnap.docs.some((d) => d.id !== planId);

  let spaceRetired = false;
  if (!hasSiblingProjects) {
    // Tombstone, not hard-delete - preserves the old Space's own original
    // displayName forever (merge, not overwrite) for lineage.
    await setDoc(doc(db, "users", uid, "spaces", execution.oldSpaceId), {
      retired: true,
      redirectTo: execution.targetSpaceId,
      retiredAt: serverTimestamp(),
      reclassificationExecutionId: planId,
    }, { merge: true });
    spaceRetired = true;
  } else {
    // Defensive - should not happen for a genuinely self-owned legacy
    // plan, but handled rather than assumed away. Real for the batch
    // case (mergeRoomIntoRoom below): every plan except the LAST one
    // moved out of a multi-plan source Room hits this branch, since its
    // siblings haven't moved yet.
    await updateSpaceRoomSummary(uid, execution.oldSpaceId);
  }

  await updateDoc(executionRef, { status: "old-space-cleaned-up" });
  return { outcome: "cleaned-up", planId, oldSpaceId: execution.oldSpaceId, spaceRetired };
}

// ---- Phase 5: confirm summaries ----
async function confirmSummaries(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (["claimed", "target-established", "target-validated"].includes(execution.status)) {
    return { outcome: "not-yet-cleaned-up", planId, status: execution.status };
  }
  if (execution.status !== "old-space-cleaned-up") {
    return { outcome: "already-confirmed-or-later", planId, status: execution.status };
  }

  await updateSpaceRoomSummary(uid, execution.targetSpaceId);

  await updateDoc(executionRef, { status: "summaries-confirmed" });
  return { outcome: "confirmed", planId };
}

// ---- Phase 6: reconcile merge candidates ----
async function reconcileMergeCandidates(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (["claimed", "target-established", "target-validated", "old-space-cleaned-up"].includes(execution.status)) {
    return { outcome: "not-yet-ready", planId, status: execution.status };
  }
  if (execution.status !== "summaries-confirmed") {
    return { outcome: "already-reconciled-or-later", planId, status: execution.status };
  }

  const candidatesSnap = await getDocs(query(collection(db, "users", uid, "mergeCandidates"), where("planIds", "array-contains", planId)));
  const reconciled = [];
  for (const candDoc of candidatesSnap.docs) {
    const candidateDoc = candDoc.data();
    if (candidateDoc.resolutionStatus === "superseded" || candidateDoc.resolutionStatus === "stale-confirmed" || candidateDoc.resolutionStatus === "merged") {
      reconciled.push({ candidateId: candDoc.id, action: "skip-terminal", resolutionStatus: candidateDoc.resolutionStatus });
      continue;
    }
    const currentPlansById = {};
    for (const pid of candidateDoc.planIds || []) {
      const pSnap = await getDoc(doc(db, "users", uid, "plans", pid));
      currentPlansById[pid] = pSnap.exists() ? pSnap.data() : null;
    }
    const decision = evaluateCandidateInvalidation(candidateDoc, currentPlansById);
    if (decision.action === "keep") {
      reconciled.push({ candidateId: candDoc.id, action: "keep" });
      continue;
    }
    if (decision.action === "mark-stale") {
      await updateDoc(candDoc.ref, { resolutionStatus: "stale-confirmed", staleReason: decision.staleReason, staleDetectedAt: serverTimestamp() });
      reconciled.push({ candidateId: candDoc.id, action: "mark-stale", staleReason: decision.staleReason });
      continue;
    }
    await updateDoc(candDoc.ref, { resolutionStatus: "superseded", supersededAt: serverTimestamp(), supersededBy: [] });
    reconciled.push({ candidateId: candDoc.id, action: "supersede" });
  }

  await updateDoc(executionRef, { status: "candidates-reconciled", reconciledCandidateIds: reconciled.map((r) => r.candidateId) });
  return { outcome: "reconciled", planId, reconciled };
}

// ---- Phase 7: finalize ----
async function finalizeReclassification(uid, planId) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);
  const executionSnap = await getDoc(executionRef);
  if (!executionSnap.exists()) return { outcome: "execution-missing", planId };
  const execution = executionSnap.data();
  if (execution.status === "completed") return { outcome: "already-completed", planId };
  if (execution.status !== "candidates-reconciled") return { outcome: "not-yet-reconciled", planId, status: execution.status };

  await updateDoc(executionRef, { status: "completed", completedAt: serverTimestamp() });
  return { outcome: "completed", planId };
}

// ---- Orchestrator: resumable, safe to call repeatedly ----
async function reclassifyLegacyPlan(uid, planId, request) {
  const executionRef = doc(db, "users", uid, "reclassificationExecutions", planId);

  const claim = await claimReclassification(uid, planId, request);
  if (claim.outcome === "plan-missing" || claim.outcome === "invalid-target-space" || claim.outcome === "conflict") {
    return { outcome: "blocked-at-claim", detail: claim };
  }
  if (claim.outcome === "already-completed") {
    const executionSnap = await getDoc(executionRef);
    return { outcome: "completed", planId, alreadyCompleted: true, execution: executionSnap.data() };
  }

  const executionSnap = await getDoc(executionRef);
  if (executionSnap.exists() && executionSnap.data().status === "completed") {
    return { outcome: "completed", planId, alreadyCompleted: true, execution: executionSnap.data() };
  }

  const established = await establishTargetProjection(uid, planId);
  if (established.outcome === "blocked") return { outcome: "blocked-at-establish", detail: established };

  const validated = await validateTargetProjection(uid, planId);
  if (validated.outcome === "invalid") return { outcome: "blocked-at-validation", detail: validated };

  const cleanedUp = await cleanUpOldSpace(uid, planId);
  const confirmed = await confirmSummaries(uid, planId);
  const reconciled = await reconcileMergeCandidates(uid, planId);
  const finalized = await finalizeReclassification(uid, planId);

  return { outcome: "completed", planId, claim, established, validated, cleanedUp, confirmed, reconciled, finalized };
}

// ---- Batch wrapper: move EVERY plan out of one Room into another
// (Room Rename Validation §2, "Move plans to [Room]"). reclassifyLegacyPlan
// itself only ever handles one plan - proven safe to call once per plan,
// in sequence, for this exact multi-plan case: cleanUpOldSpace's own
// "hasSiblingProjects" check (above) means the source Room is only ever
// tombstoned once the LAST plan has moved out, never prematurely - no
// change to the underlying phases was needed, just this loop. Sequential,
// not parallel (Promise.all) - deliberately, so each plan's cleanup step
// sees an accurate, already-updated sibling count from the plan(s) moved
// immediately before it, rather than every plan racing to read the same
// stale "who else is still here" snapshot at once.
// ---- Area Preservation for Room Merges (AreaMergePreservation.md).
// establishTargetArea and mergeRoomIntoRoom below replace the prior
// "always clear areaId" behavior, which destroyed durable Area identity
// (visit history, reference photos, recognition eligibility) on every
// Room merge - exactly the regression Phase A/B's own work was meant to
// prevent. ----

// Idempotent, restartable target-twin establishment - the critical
// correction over an earlier, in-memory-only version of this idea:
// establishing the target twin and retiring the source Area are SEPARATE
// steps, tracked by a field PERSISTED on the source Area document itself
// (migrationTargetAreaId), not just a Map living in one function call's
// stack. A crash between "target created" and "source retired" must never
// be able to orphan or duplicate anything - re-calling this after a crash
// reads the already-set migrationTargetAreaId and returns the existing
// target id rather than creating a second twin. retired/redirectTo are
// NEVER written here - only mergeRoomIntoRoom's own later phase (once it
// has verified zero plans still reference the source Area) writes those,
// so a source Area with plans still pointing at it can never look
// retired just because its target twin already exists.
async function establishTargetArea(uid, oldRoomId, oldAreaId, targetRoomId) {
  // Retirement guard (DeletionDesign.md Addendum/Phase C1): unlike a
  // vanished SOURCE Area (below, tolerated as a benign race - defensive
  // null return), a retired TARGET Room is a real caller error, not a
  // benign race - claimReclassification's own validateTargetSpace check
  // already protects the per-plan Room move (Phase 3), but Area migration
  // (Phase 2) runs BEFORE that and would otherwise create a real twin Area
  // document under a retired Space before anything else catches the
  // problem. Thrown, not returned null - this must abort the whole
  // mergeRoomIntoRoom/resolveAreaForSinglePlanMove call loudly, not
  // silently degrade into clearing areaId on every plan that would have
  // migrated.
  const targetSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", targetRoomId));
  if (targetSpaceSnap.exists() && targetSpaceSnap.data().retired === true) {
    throw new Error(`Cannot establish a target Area under retired Room ${targetRoomId}`);
  }

  const oldAreaRef = doc(db, "users", uid, "spaces", oldRoomId, "areas", oldAreaId);
  const oldAreaSnap = await getDoc(oldAreaRef);
  if (!oldAreaSnap.exists()) return null; // defensive - Area vanished somehow, nothing to migrate
  const oldArea = oldAreaSnap.data();

  if (oldArea.migrationTargetAreaId) {
    return oldArea.migrationTargetAreaId;
  }

  // displayName/createdAt/originalPhotoUrl preserved from the source Area
  // - createdAt is the ORIGINAL value, not migration time: a Room merge
  // is an administrative correction, not a new organizing event, and
  // createdAt means "when the user first organized this physical spot"
  // everywhere else in this data model (same lineage-preservation
  // philosophy as Space tombstoning's own "preserves the old Space's
  // displayName forever" comment). visitCount/lastOrganizedAt/
  // latestPhotoUrl are seeded but explicitly NOT trusted - recomputed for
  // real by updateAreaSummary once the migrated plans actually land under
  // the target Room (mergeRoomIntoRoom's own later phase), matching this
  // codebase's "recompute, never copy" convention for summary fields.
  const newAreaRef = await addDoc(collection(db, "users", uid, "spaces", targetRoomId, "areas"), {
    roomId: targetRoomId,
    displayName: oldArea.displayName,
    createdAt: oldArea.createdAt,
    originalPhotoUrl: oldArea.originalPhotoUrl,
    latestPhotoUrl: oldArea.latestPhotoUrl,
    lastOrganizedAt: oldArea.lastOrganizedAt,
    visitCount: 0,
    retired: false,
    redirectTo: null,
  });

  // Item 5 (design doc): never searched for an existing same-named target
  // Area to merge into - addDoc above always creates a fresh document.
  // "TV Console" migrating into a target Room that already has its own
  // "TV Console" simply produces two separate Areas; reconciling them is
  // explicitly out of scope (a future capability), matching Room Rename's
  // own "duplicate names are allowed" philosophy one level down.
  await updateDoc(oldAreaRef, { migrationTargetAreaId: newAreaRef.id });
  return newAreaRef.id;
}

// Single-plan reclassification's own Area handling (design doc §3) - a
// wrapper around reclassifyLegacyPlan, not a change to it, for the same
// reason mergeRoomIntoRoom's own Area logic lives outside it: this
// decision needs to know about every OTHER plan currently referencing the
// same Area, which is not something a single-plan-scoped function can
// determine about itself. Call this AFTER reclassifyLegacyPlan has
// already completed the Room move for oldAreaId's own plan; sourceAreaId
// must be the plan's ORIGINAL areaId, captured before reclassification
// (see mergeRoomIntoRoom's own Phase 1 snapshot for why - reclassifyLegacyPlan
// never touches areaId itself, but a caller must never assume that and
// read it fresh afterward instead of using its own already-known value).
async function resolveAreaForSinglePlanMove(uid, planId, oldRoomId, oldAreaId, targetRoomId) {
  if (!oldAreaId) return { action: "none" }; // whole-room visit - no Area involvement (design doc item 3, "no areaId")

  const siblingSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("areaId", "==", oldAreaId)));
  const othersStillReference = siblingSnap.docs.some((d) => d.id !== planId);
  if (othersStillReference) {
    // Leaving the Area behind - other plans still need it in the source
    // Room. Do NOT touch the source Area at all.
    return { action: "clear" };
  }

  // Last remaining member - establish -> move -> verify -> recompute ->
  // retire, the same sequence mergeRoomIntoRoom uses for every Area, just
  // for this one.
  const newAreaId = await establishTargetArea(uid, oldRoomId, oldAreaId, targetRoomId);
  if (!newAreaId) return { action: "clear" }; // defensive - establishment failed, don't leave the plan pointing at a half-migrated Area

  const stillReferencedSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("areaId", "==", oldAreaId)));
  const verifiedEmpty = stillReferencedSnap.docs.every((d) => d.id === planId); // only this plan itself, which is about to be repointed

  await updateAreaSummary(uid, targetRoomId, newAreaId);

  if (verifiedEmpty) {
    await updateDoc(doc(db, "users", uid, "spaces", oldRoomId, "areas", oldAreaId), {
      retired: true, redirectTo: newAreaId, retiredAt: serverTimestamp(),
    });
  }

  return { action: "migrate", newAreaId };
}

// ---- moveAreaToRoom: Area Re-parenting Phase A (AreaReparentingDesign.md
// §5) - the standalone "move this one Area, with every one of its own
// plans, to a different Room" feature. Architecturally a scoped variant of
// mergeRoomIntoRoom below, not a new orchestrator - same building blocks
// (establishTargetArea, reclassifyLegacyPlan, updateAreaSummary,
// updateSpaceRoomSummary), same phase shape, just selecting plans by
// areaId instead of by canonicalSpaceId, and with exactly one Area to
// migrate instead of N. Where mergeRoomIntoRoom's Phase 1 has to special-
// case the Room's own founding self-plan (doc id === roomId, which never
// changes), that case cannot occur here - a founding whole-Room visit
// always has areaId: null, so it can never match the areaId-scoped query
// below in the first place; only real durable-Area member plans can. ----
async function moveAreaToRoom(uid, sourceRoomId, sourceAreaId, targetRoomId) {
  const targetSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", targetRoomId));
  if (!targetSpaceSnap.exists() || targetSpaceSnap.data().retired === true) {
    return { outcome: "invalid-target", reason: "target Room does not exist or is retired" };
  }
  const targetRoomName = targetSpaceSnap.data().displayName || null;

  const sourceAreaRef = doc(db, "users", uid, "spaces", sourceRoomId, "areas", sourceAreaId);
  const sourceAreaSnap = await getDoc(sourceAreaRef);
  if (!sourceAreaSnap.exists()) {
    return { outcome: "invalid-source", reason: "source Area does not exist" };
  }
  // Idempotency short-circuit: re-running this function after a prior full
  // completion must be a genuine no-op (test l), not just "no duplicates
  // created but every phase still runs and re-stamps retiredAt" the way
  // mergeRoomIntoRoom's own looser Phase 4-6 loop would. A retired source
  // Area with a migrationTargetAreaId already means every phase below has
  // already happened - return the same completed shape immediately without
  // touching Firestore again.
  const sourceAreaData = sourceAreaSnap.data();
  if (sourceAreaData.retired === true) {
    if (sourceAreaData.migrationTargetAreaId) {
      return { outcome: "already-completed", sourceRoomId, sourceAreaId, targetRoomId, newAreaId: sourceAreaData.migrationTargetAreaId };
    }
    return { outcome: "invalid-source", reason: "source Area is already retired for an unrelated reason" };
  }

  // ---- Phase 1: snapshot every plan currently referencing this Area,
  // before any of them move. Unlike mergeRoomIntoRoom's Room-scoped
  // snapshot, no "already moved on a prior attempt" filter is needed here -
  // reclassifyLegacyPlan (Phase 3, below) is independently idempotent per
  // plan regardless of which Room a snapshotted plan currently sits in, so
  // re-including a plan that partially moved on an earlier interrupted
  // attempt (canonicalSpaceId already repointed, areaId not yet repointed)
  // is exactly the case that must be re-processed to finish the repoint. ----
  const memberPlansSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("areaId", "==", sourceAreaId)));
  const planSnapshots = memberPlansSnap.docs.map((d) => ({
    planId: d.id,
    areaName: d.data().areaName ?? null,
    areaScope: d.data().areaScope ?? "whole-room",
  }));
  // Captured before anything moves, for Phase 5a's source-Room repair
  // below: it must only undo a retirement THIS move caused, never
  // resurrect a Room the user had already soft-deleted beforehand.
  const sourceSpaceBeforeSnap = await getDoc(doc(db, "users", uid, "spaces", sourceRoomId));
  const sourceRoomWasRetiredBeforeMove = sourceSpaceBeforeSnap.exists() && sourceSpaceBeforeSnap.data().retired === true;

  // ---- Phase 2: establish the target twin. Idempotent via
  // migrationTargetAreaId persisted on the source Area doc - safe to call
  // again after a crash between this phase and any later one. ----
  const newAreaId = await establishTargetArea(uid, sourceRoomId, sourceAreaId, targetRoomId);
  if (!newAreaId) {
    return { outcome: "failed", reason: "could not establish target Area" };
  }

  // ---- Phase 3: move every plan, then repoint its areaId at the new
  // twin. Sequential, not Promise.all - same reasoning mergeRoomIntoRoom's
  // own Phase 3 gives (App.js comment above it): each plan's cleanup step
  // should see an accurate, already-updated sibling count from whichever
  // plan moved immediately before it. ----
  const results = [];
  for (const snap of planSnapshots) {
    const result = await reclassifyLegacyPlan(uid, snap.planId, {
      targetSpaceId: targetRoomId,
      requestedRoomName: targetRoomName,
      requestedAreaName: snap.areaName,
      requestedAreaScope: snap.areaScope,
    });
    results.push({ planId: snap.planId, result });

    if (result.outcome === "completed") {
      // sessionScope travels with areaId (see createAreaForPlan for why
      // they are always written together). An Area move never changes what
      // KIND of session this is - it had a durable Area before and has one
      // after - so this is always "area"; it is restated rather than left
      // alone only so no plan can ever carry an areaId without the
      // matching scope.
      await updateDoc(doc(db, "users", uid, "plans", snap.planId), { areaId: newAreaId, sessionScope: "area", shadowSourceVersion: increment(1) })
        .catch((e) => dlog(`[AREA MOVE] areaId repoint failed for plan ${snap.planId}: ${e.message}`));
      await syncPlanToSpaceGraph(uid, snap.planId).catch((e) => dlog(`[AREA MOVE] shadow resync failed for plan ${snap.planId}: ${e.message}`));
    }
  }
  const failed = results.filter((r) => r.result.outcome !== "completed");

  // ---- Phase 4 (verify) + Phase 5 (recompute both Room summaries and the
  // target Area summary) + Phase 6 (retire the source Area, only now, only
  // if verification found zero remaining references - a source Area with
  // any plan still pointing at it, e.g. one plan in this batch failed
  // Phase 3, is never retired). ----
  const remainingSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("areaId", "==", sourceAreaId)));
  const stillReferenced = remainingSnap.size > 0;

  // ---- Phase 5a: an Area move must NEVER retire the source Room, even
  // when the move empties it (AreaReparentingDesign.md §4: "an empty Room
  // is a valid physical Room the user wants to keep"). This is not
  // automatic - it needs an explicit repair, because reclassifyLegacyPlan's
  // own Phase 4 (cleanUpOldSpace) tombstones a source Space as soon as its
  // LAST Project leaves, and it cannot distinguish "the whole Room was
  // merged away" (where that tombstone is correct) from "one Area moved
  // out and happened to be the Room's only content" (where it is not).
  // Rather than modify that proven, Room-merge-scoped state machine - the
  // discipline §8 explicitly calls for - this undoes the one side effect
  // that is wrong for THIS caller, and only when this call actually caused
  // it: sourceRoomWasRetiredBeforeMove is captured in Phase 1, so a Room
  // the user had already soft-deleted before starting stays deleted.
  // Clears the full reclassification-tombstone field set (not just
  // `retired`), otherwise a live Room would keep a dangling redirectTo
  // pointing at the target Room - exactly the stale-reference class of bug
  // the tombstone convention exists to avoid.
  let sourceRoomRestored = false;
  if (!sourceRoomWasRetiredBeforeMove) {
    const sourceSpaceRef = doc(db, "users", uid, "spaces", sourceRoomId);
    const sourceSpaceAfter = await getDoc(sourceSpaceRef);
    if (sourceSpaceAfter.exists() && sourceSpaceAfter.data().retired === true) {
      await updateDoc(sourceSpaceRef, {
        retired: false,
        redirectTo: deleteField(),
        retiredAt: deleteField(),
        reclassificationExecutionId: deleteField(),
      });
      sourceRoomRestored = true;
    }
  }

  await updateAreaSummary(uid, targetRoomId, newAreaId);
  await updateSpaceRoomSummary(uid, targetRoomId);
  await updateSpaceRoomSummary(uid, sourceRoomId);

  let retired = false;
  if (!stillReferenced) {
    await updateDoc(sourceAreaRef, { retired: true, redirectTo: newAreaId, retiredAt: serverTimestamp() });
    retired = true;
    // The source Area's own retirement is what makes its (now zero) visits
    // stop counting toward the source Room summary - updateSpaceRoomSummary
    // reads retiredAreaIds fresh, so the recompute above ran one write too
    // early to see it. Re-run it now that the tombstone exists.
    await updateSpaceRoomSummary(uid, sourceRoomId);
  }

  // ---- Phase 7: mark complete (merge-candidate reconciliation already
  // happened per-plan inside each reclassifyLegacyPlan call above, via its
  // own Phase 6 - nothing about an Area move changes any plan's display
  // name or, once Phase 3 completes, its canonicalSpaceId relative to what
  // that reconciliation already watches for, so no separate reconciliation
  // step is needed here - see AreaReparentingDesign.md §8/§1f). ----
  return {
    outcome: failed.length === 0 ? "completed" : "partial",
    sourceRoomId, sourceAreaId, targetRoomId, newAreaId,
    movedCount: results.length - failed.length, totalCount: results.length,
    results, failed, retired, stillReferencedCount: remainingSnap.size,
    sourceRoomRestored,
  };
}

// ---- mergeRoomIntoRoom: the full-Room-merge case (design doc §2),
// corrected 7-phase sequence. Phase numbering matches the design report
// 1:1 for traceability. ----
async function mergeRoomIntoRoom(uid, sourceRoomId, targetRoomId) {
  const targetSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", targetRoomId));
  const targetRoomName = targetSpaceSnap.exists() ? (targetSpaceSnap.data().displayName || null) : null;

  // ---- Phase 1: snapshot every source plan's CURRENT areaId BEFORE any
  // plan moves - the authoritative record of Area membership for this
  // whole run, independent of whatever reclassifyLegacyPlan does to the
  // plan's own fields afterward (it never touches areaId, but this
  // function must never assume that silently). Self-plan (founding visit,
  // doc id === sourceRoomId) is only included if it hasn't ALREADY moved
  // on a prior, interrupted attempt - its own doc id never changes, so
  // existence alone can't distinguish "not yet processed" from "already
  // done"; canonicalSpaceId can. ----
  const canonicalPlansSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("canonicalSpaceId", "==", sourceRoomId)));
  const planIds = canonicalPlansSnap.docs.map((d) => d.id);
  const selfPlanSnap = await getDoc(doc(db, "users", uid, "plans", sourceRoomId));
  if (selfPlanSnap.exists()) {
    const selfPlanData = selfPlanSnap.data();
    if (!selfPlanData.canonicalSpaceId || selfPlanData.canonicalSpaceId === sourceRoomId) {
      planIds.push(sourceRoomId);
    }
  }

  const planSnapshots = planIds.map((planId) => ({ planId }));
  for (const snap of planSnapshots) {
    const planSnap = await getDoc(doc(db, "users", uid, "plans", snap.planId));
    const planData = planSnap.exists() ? planSnap.data() : {};
    snap.areaId = planData.areaId ?? null;
    snap.areaName = planData.areaName ?? null;
    snap.areaScope = planData.areaScope ?? "whole-room";
  }

  // ---- Phase 2: establish a target twin for every DISTINCT source Area
  // referenced by any of these plans. Source Areas are NOT retired here -
  // see establishTargetArea's own comment for why that separation is the
  // whole point of this correction. ----
  const uniqueSourceAreaIds = [...new Set(planSnapshots.map((s) => s.areaId).filter(Boolean))];
  const areaMigrationMap = new Map(); // oldAreaId -> newAreaId
  for (const oldAreaId of uniqueSourceAreaIds) {
    const newAreaId = await establishTargetArea(uid, sourceRoomId, oldAreaId, targetRoomId);
    if (newAreaId) areaMigrationMap.set(oldAreaId, newAreaId);
  }

  // ---- Phase 3: move every plan (Room move unchanged), then repoint its
  // areaId at the durable mapping from Phase 2 - never null-by-default
  // for a plan that had a real Area, and never left at a stale
  // old-Room-scoped id either. ----
  const results = [];
  for (const snap of planSnapshots) {
    const result = await reclassifyLegacyPlan(uid, snap.planId, {
      targetSpaceId: targetRoomId,
      requestedRoomName: targetRoomName,
      requestedAreaName: snap.areaName,
      requestedAreaScope: snap.areaScope,
    });
    results.push({ planId: snap.planId, result });

    if (result.outcome === "completed") {
      const newAreaId = snap.areaId ? (areaMigrationMap.get(snap.areaId) ?? null) : null;
      // Unlike the Area-move case, newAreaId here CAN legitimately be null
      // (a whole-Room founding visit carries no Area through the merge),
      // so the scope is recomputed rather than assumed - from the same
      // areaScope reclassifyLegacyPlan just wrote for this plan.
      await updateDoc(doc(db, "users", uid, "plans", snap.planId), {
        areaId: newAreaId,
        sessionScope: resolveSessionScope({ areaId: newAreaId, areaScope: snap.areaScope }),
        shadowSourceVersion: increment(1),
      }).catch((e) => dlog(`[ROOM MERGE] areaId repoint failed for plan ${snap.planId}: ${e.message}`));
      await syncPlanToSpaceGraph(uid, snap.planId).catch((e) => dlog(`[ROOM MERGE] shadow resync failed for plan ${snap.planId}: ${e.message}`));
    }
  }
  const failed = results.filter((r) => r.result.outcome !== "completed");

  // ---- Phase 4 (verify) + Phase 5 (recompute) + Phase 6 (retire, only
  // now) - per migrated Area. A source Area with ANY plan still pointing
  // at it (e.g. one plan in its group failed Phase 3) is explicitly never
  // retired - design doc item j's own governing rule. ----
  const areaMigrations = [];
  for (const [oldAreaId, newAreaId] of areaMigrationMap.entries()) {
    const remainingSnap = await getDocs(query(collection(db, "users", uid, "plans"), where("areaId", "==", oldAreaId)));
    const stillReferenced = remainingSnap.size > 0;

    await updateAreaSummary(uid, targetRoomId, newAreaId);

    if (stillReferenced) {
      areaMigrations.push({ oldAreaId, newAreaId, retired: false, reason: "plans still reference source Area", remainingCount: remainingSnap.size });
      continue;
    }

    await updateDoc(doc(db, "users", uid, "spaces", sourceRoomId, "areas", oldAreaId), {
      retired: true, redirectTo: newAreaId, retiredAt: serverTimestamp(),
    });
    areaMigrations.push({ oldAreaId, newAreaId, retired: true });
  }

  // ---- Phase 7: final verification / return summary. ----
  return {
    outcome: failed.length === 0 ? "completed" : "partial",
    sourceRoomId, targetRoomId,
    movedCount: results.length - failed.length, totalCount: results.length,
    results, failed, areaMigrations,
  };
}

// Read-only. Snapshots each selected plan's Project shadow document's
// version fields (MergeProposalDesign.md Section 8's expectedSpaceState:
// { [planId]: { sourceVersion, migrationVersion } }) - execution-layer
// state, captured at confirmation time so a future merge-execution step
// can detect drift, never stored as a precomputed "eligible" bit (Section
// 1's governing principle). A plan that hasn't completed Part 1
// structural migration yet has no Project document - recorded as null
// for that plan rather than blocking confirmation, since Part 2
// detection is already independent of structural migration completion
// (Section 4).
async function buildExpectedSpaceState(uid, planIds) {
  const entries = await Promise.all(planIds.map(async (planId) => {
    // §12 Migration Part 4: reads the plan first so a plan that already
    // survived (or lost) an earlier merge resolves to its real canonical
    // Space, not its own bare planId - relevant once the confirmed-cluster-
    // growing case (MergeExecutionDesign.md §12) proposes a new candidate
    // involving an already-merged plan.
    const planSnap = await getDoc(doc(db, "users", uid, "plans", planId));
    const plan = planSnap.exists() ? planSnap.data() : null;
    const { spaceId, projectId } = computeShadowIds(planId, plan);
    const projectSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId, "projects", projectId));
    if (!projectSnap.exists()) return [planId, null];
    const data = projectSnap.data();
    return [planId, { sourceVersion: typeof data.sourceVersion === "number" ? data.sourceVersion : null, migrationVersion: typeof data.migrationVersion === "number" ? data.migrationVersion : null }];
  }));
  return Object.fromEntries(entries);
}

// "Same Space", full selection (every displayed member selected) - the
// set didn't change, so the SAME document is updated in place. No split,
// no supersession, no new candidate ID.
async function confirmMergeCandidateFull(uid, candidateId, spaceType, selectedPlanIds) {
  const expectedSpaceState = await buildExpectedSpaceState(uid, selectedPlanIds);
  const batch = writeBatch(db);
  const candidateRef = doc(db, "users", uid, "mergeCandidates", candidateId);
  const historyRef = doc(collection(db, "users", uid, "mergeCandidates", candidateId, "history"));
  const eventId = historyRef.id;

  batch.set(historyRef, { actor: "user", type: "confirmed", confirmedPlanIds: selectedPlanIds, at: serverTimestamp() });
  batch.update(candidateRef, {
    resolutionStatus: "confirmed-merge",
    confirmationEventId: eventId,
    confirmedPlanIds: selectedPlanIds,
    expectedSpaceState,
    resolvedAt: serverTimestamp(),
  });
  await batch.commit();
  return { outcome: "confirmed-in-place", candidateId, confirmationEventId: eventId };
}

// "Same Space", partial selection (a subset of an N-way candidate) - the
// set changed, so the original is superseded (never mutated into either
// outcome - MergeProposalDesign.md Section 10's write sequence) and two
// new, independent documents are created: the confirmed group, and the
// pending remainder if 2+ plans remain. All in one atomic batch.
async function confirmMergeCandidatePartial(uid, candidateId, spaceType, allPlanIds, selectedPlanIds) {
  const remainderPlanIds = allPlanIds.filter((id) => !selectedPlanIds.includes(id)).sort();
  const confirmedId = computeMergeCandidateId(spaceType, selectedPlanIds);
  const remainderId = remainderPlanIds.length >= 2 ? computeMergeCandidateId(spaceType, remainderPlanIds) : null;
  const expectedSpaceState = await buildExpectedSpaceState(uid, selectedPlanIds);

  const batch = writeBatch(db);
  const now = serverTimestamp();

  const confirmedHistoryRef = doc(collection(db, "users", uid, "mergeCandidates", confirmedId, "history"));
  const confirmedEventId = confirmedHistoryRef.id;
  batch.set(confirmedHistoryRef, { actor: "user", type: "confirmed", confirmedPlanIds: selectedPlanIds, splitFrom: candidateId, at: now });
  batch.set(doc(db, "users", uid, "mergeCandidates", confirmedId), {
    tier: "1", spaceType, planIds: selectedPlanIds, candidateKeyVersion: CANDIDATE_KEY_VERSION, detectionVersion: DETECTION_VERSION,
    detectedAt: now, resolutionStatus: "confirmed-merge", resolvedAt: now,
    confirmationEventId: confirmedEventId, confirmedPlanIds: selectedPlanIds, expectedSpaceState,
    staleReason: null, staleDetectedAt: null, supersededBy: null, supersededAt: null, splitFrom: candidateId,
  });

  if (remainderId) {
    const remainderHistoryRef = doc(collection(db, "users", uid, "mergeCandidates", remainderId, "history"));
    batch.set(remainderHistoryRef, { actor: "system", type: "split-remainder", planIds: remainderPlanIds, splitFrom: candidateId, at: now });
    batch.set(doc(db, "users", uid, "mergeCandidates", remainderId), {
      tier: "1", spaceType, planIds: remainderPlanIds, candidateKeyVersion: CANDIDATE_KEY_VERSION, detectionVersion: DETECTION_VERSION,
      detectedAt: now, resolutionStatus: "pending", resolvedAt: null,
      staleReason: null, staleDetectedAt: null, supersededBy: null, supersededAt: null, splitFrom: candidateId,
    });
  }

  const supersededBy = remainderId ? [confirmedId, remainderId] : [confirmedId];
  batch.update(doc(db, "users", uid, "mergeCandidates", candidateId), {
    resolutionStatus: "superseded",
    supersededBy,
    supersededAt: now,
  });

  await batch.commit();
  return { outcome: "split", confirmedId, remainderId, confirmationEventId: confirmedEventId, supersededBy };
}

// "Keep Separate" - scoped to the currently-displayed set as a whole
// (MergeProposalDesign.md Section 9), preserved as pairwise separation
// among the reviewed members, never a global "never match again" rule -
// enforced downstream by the corrected reconciliation algorithm (Pass 1),
// not by anything special done here.
async function keepMergeCandidateSeparate(uid, candidateId) {
  const batch = writeBatch(db);
  const candidateRef = doc(db, "users", uid, "mergeCandidates", candidateId);
  const historyRef = doc(collection(db, "users", uid, "mergeCandidates", candidateId, "history"));
  batch.set(historyRef, { actor: "user", type: "dismissed", at: serverTimestamp() });
  batch.update(candidateRef, { resolutionStatus: "dismissed", resolvedAt: serverTimestamp() });
  await batch.commit();
  return { outcome: "dismissed", candidateId };
}

// "Not now" / "Not sure yet" - resolutionStatus stays pending (nothing
// decided); only lastShownAt/deferredCount change, disjoint fields from
// what "Keep Separate" touches (Section 5) so deferral can never be
// conflated with rejection at the schema level.
async function deferMergeCandidate(uid, candidateId, reasonTag) {
  const batch = writeBatch(db);
  const candidateRef = doc(db, "users", uid, "mergeCandidates", candidateId);
  const historyRef = doc(collection(db, "users", uid, "mergeCandidates", candidateId, "history"));
  batch.set(historyRef, { actor: "user", type: "deferred", reason: reasonTag, at: serverTimestamp() });
  batch.update(candidateRef, { lastShownAt: serverTimestamp(), deferredCount: increment(1) });
  await batch.commit();
  return { outcome: "deferred", candidateId };
}

// Stale-confirmed "Understood, no longer applicable" - not a question;
// closes out the notification. resolutionStatus remains stale-confirmed
// permanently (Section 6).
async function acknowledgeStaleConfirmed(uid, candidateId) {
  const batch = writeBatch(db);
  const candidateRef = doc(db, "users", uid, "mergeCandidates", candidateId);
  const historyRef = doc(collection(db, "users", uid, "mergeCandidates", candidateId, "history"));
  batch.set(historyRef, { actor: "user", type: "acknowledged-stale", at: serverTimestamp() });
  batch.update(candidateRef, { acknowledgedAt: serverTimestamp() });
  await batch.commit();
  return { outcome: "acknowledged", candidateId };
}

// Stale-confirmed reversal ("Actually, I don't think these are the same
// space") - a genuine identity-layer reversal, distinct from an ordinary
// Keep Separate; recorded in history explicitly as a reversal-of-confirmed
// (Section 6), not merged into ordinary rejection records.
async function reverseStaleConfirmed(uid, candidateId) {
  const batch = writeBatch(db);
  const candidateRef = doc(db, "users", uid, "mergeCandidates", candidateId);
  const historyRef = doc(collection(db, "users", uid, "mergeCandidates", candidateId, "history"));
  batch.set(historyRef, { actor: "user", type: "reversal-of-confirmed", at: serverTimestamp() });
  batch.update(candidateRef, { resolutionStatus: "dismissed", resolvedAt: serverTimestamp() });
  await batch.commit();
  return { outcome: "reversed", candidateId };
}

// Display-only formatter for the stale-confirmed explanation shown to the
// user. The stored staleReason (evaluateCandidateInvalidation,
// shared/spaceMigration.js) is diagnostic text meant for logs/CLI output
// and contains a raw internal plan ID (e.g. "plan aBc123 no longer
// exists") - never shown to a user verbatim. This never reads or writes
// staleReason itself, purely reformats it for one render call.
function friendlyStaleReason(staleReason) {
  if (typeof staleReason === "string" && staleReason.includes("no longer exists")) {
    return "One of the records in this group was removed.";
  }
  if (typeof staleReason === "string" && staleReason.includes("display name changed")) {
    return "One of the records in this group was renamed.";
  }
  return "Something about this group changed since you confirmed it.";
}

// Set at build time by app.config.js's `extra.APP_ENV`, which every EAS
// build profile sets explicitly (see eas.json) - "staging" for
// development/preview, "production" only for the production profile. Read
// before Firebase initializes below so the selected firebaseConfig can never
// silently default to production.
const APP_ENV = Constants.expoConfig?.extra?.APP_ENV;
const IS_PRODUCTION = APP_ENV === "production";

// Firebase config
const productionFirebaseConfig = {
  apiKey: "AIzaSyB4R4hI8_Ej_jwqmukO4y_j1vD1hvIl8-8",
  authDomain: "auth.uncluttrd.app",
  projectId: "cluttrd-3e335",
  storageBucket: "cluttrd-3e335.firebasestorage.app",
  messagingSenderId: "427768202763",
  appId: "1:427768202763:web:f47a4005880db50085690e"
};
const stagingFirebaseConfig = {
  apiKey: "AIzaSyDgBFIR35WcYYllxuGVNDmfGGMt4Hq71E4",
  authDomain: "cluttrd-staging.firebaseapp.com",
  projectId: "cluttrd-staging",
  storageBucket: "cluttrd-staging.firebasestorage.app",
  messagingSenderId: "247455199173",
  appId: "1:247455199173:web:b3c11631fd4aa4770965ac"
};
const firebaseConfig = IS_PRODUCTION ? productionFirebaseConfig : stagingFirebaseConfig;

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
let auth;
try {
  auth = initializeAuth(firebaseApp, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (e) {
  // Already initialized (common after a Fast Refresh hot reload). Reuse the existing instance.
  auth = getAuth(firebaseApp);
}
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const functions = getFunctions(firebaseApp, "us-central1");

// Known test/dev accounts. Update this list as more are added.
const KNOWN_TEST_EMAILS = [
  "hello@uncluttrd.app",
  "michael@earthwiseenergy.net",
  "reviewer@uncluttrd.app",
  "cgignac28@yahoo.com",
];

// Creates the users/{uid} profile document if it doesn't exist yet. Covers both
// brand-new signups and pre-existing users who signed up before this doc existed.
const ensureUserDocument = async (u, extra = {}) => {
  const userRef = doc(db, "users", u.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    const isTestAccount = KNOWN_TEST_EMAILS.includes((u.email || "").toLowerCase());
    await setDoc(userRef, {
      uid: u.uid,
      email: u.email || "",
      displayName: u.displayName || "",
      createdAt: serverTimestamp(),
      platform: Platform.OS,
      isPro: false,
      isTestAccount,
      ...extra,
    });
  }
};



// Uncluttrd drawer icon (transparent background, two versions)
function DrawerIcon({ size = 38, dark = false }) {
  return (
    <Svg width={size} height={size * (150 / 116)} viewBox="70 50 116 150">
      <Path d="M70 50 L70 175 L95 200 L95 75 Z" fill="#1E9E52" />
      <Path d="M186 50 L186 175 L161 200 L161 75 Z" fill="#1463D8" />
      <Path d="M95 175 L161 175 L161 200 L95 200 Z" fill={dark ? "#4A7DB5" : "#0F2A52"} />
      <Rect x="112" y="182" width="32" height="8" rx="4" fill="#ffffff" />
    </Svg>
  );
}

// Room/Area Confirmation processing overlay (2026-08-09): the save
// sequence a confirmation tap triggers (plan save, shadow sync, Area
// creation/association, summary updates) is several awaited Firestore
// round-trips, each of which can touch component state along the way -
// visibly as flickering/blinking cards and photos on the confirmation
// screen underneath, since React keeps re-rendering it while all of that
// runs. Rather than chase down and silence every intermediate state
// change (fragile, and the confirmation screen's own state legitimately
// needs to update for retry/error handling), this simply covers the
// whole screen the instant a save starts. position:"absolute" with
// top/left/right/bottom:0 sizes itself to whatever View it's placed
// inside (Yoga positions absolute children relative to their immediate
// parent, no explicit position:"relative" needed the way web CSS would
// require) - dropped in as the last child of each confirmation screen's
// own <SafeAreaView>, so it sits on top of that screen's own content
// without needing to touch the content itself.
// pointerEvents="auto" is explicit, not decorative: this overlay's job is
// as much to SWALLOW taps as to show a spinner. A View defaults to auto, so
// this is documentation of intent rather than a behaviour change - the real
// tap protection is the re-entry guard on the handler itself, because an
// overlay that has not painted yet protects nothing.
const ProcessingOverlay = ({ text = "Processing..." }) => (
  <View
    pointerEvents="auto"
    style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.94)", alignItems: "center", justifyContent: "center", zIndex: 999 }}
  >
    <ActivityIndicator size="large" color={BRAND.green} />
    <Text style={{ marginTop: 14, fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink }}>{text}</Text>
  </View>
);

// APP_ENV/IS_PRODUCTION are read above, before Firebase initializes, so the
// selected firebaseConfig can never silently default to production.
// IS_STAGING drives the persistent in-app banner below; there is no runtime
// toggle for this, by design, matching the same reasoning as the
// backend/bundle-ID switch.
const IS_STAGING = !IS_PRODUCTION;

const BRAND = {
  green: "#1E9E52", greenLight: "#E6F7EE", greenMid: "#A8DDBF",
  blue: "#1463D8", blueLight: "#E8F0FC",
  navy: "#0F2A52",
  tan: "#C8A97A", tanLight: "#FBF5EC", tanBorder: "#E8D5B4",
  purple: "#8B6BAE", purpleLight: "#F3EEF9", purpleBorder: "#CFC0E8",
  white: "#FFFFFF",
  offWhite: "#E6E9EE",
  stone: "#D7DCE3",
  ink: "#0F2A52",
  slate: "#64748B",
  mist: "#B0B8BF",

  // --- TEXT tokens, WCAG 2.1 AA (ColorContrastAudit.md) ------------------
  // `green`, `slate` and `mist` above remain unchanged: they are correct as
  // BACKGROUNDS, BORDERS and fills, which is most of their use. They are not
  // safe as small TEXT, and these three tokens are the text-safe counterparts.
  //
  // There is no single green that works on both light and dark surfaces, which
  // is why there are two. Darkening green for light backgrounds makes it worse
  // on dark ones, and vice versa:
  //
  //                        on white   on offWhite   on navy   AA normal (4.5:1)
  //   green    #1E9E52       3.46        2.84        4.12     fails everywhere
  //   greenText #166E38      6.32        5.19        2.25     light only
  //   greenOnDark #10B43E    2.76        2.26        5.17     dark only
  //
  // greenOnDark is sampled FROM THE LOGO - the modal pixel of the "U" left
  // panel in assets/icon.png. The panel is a gradient (#2DBD4E brightest ->
  // #0F873F in the shadowed base, 5.77:1 -> 3.09:1 on navy), so the value is
  // taken from the upper/mid panel where the brand colour actually reads;
  // sampling the shadowed base would fail AA. Same brand, same visual
  // language, and it explains why `green` never worked on dark: BRAND.green
  // is itself a darkened derivative of the logo, tuned for light backgrounds.
  greenText: "#166E38",    // text on white/offWhite   - 6.32:1 / 5.19:1
  greenOnDark: "#10B43E",  // text on navy             - 5.17:1
  slateText: "#54607A",    // secondary text on light  - 6.30:1 / 5.18:1
};

// Module-level, not defined inside a component - Animated.createAnimatedComponent
// called on every render would mint a new component type each time, forcing a
// full remount instead of animating. Used for the wrap-up screen's Continue
// button color/scale reward animation.
const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const TIERS = [
  { id: "budget", label: "Budget", range: "Under $50", icon: Check, color: BRAND.green, bg: BRAND.greenLight, border: BRAND.greenMid },
  { id: "mid", label: "Mid-Range", range: "$50-$200", icon: Sparkles, color: BRAND.tan, bg: BRAND.tanLight, border: BRAND.tanBorder },
  { id: "premium", label: "Premium", range: "$200+", icon: Diamond, color: BRAND.purple, bg: BRAND.purpleLight, border: BRAND.purpleBorder },
];

// Approach Selection Phase A (ApproachSelectionDesign.md Section 3): fixed,
// non-AI-authored spending bands - the single source of truth for every
// approach's displayed estimatedSpendRange. The AI only ever classifies
// scopeSize; per the analyze() prompt's own explicit instruction it never
// returns a dollar amount anywhere in its response - this table (via
// applyDeterministicSpendRanges below) is what actually produces the
// persisted/displayed value every time, deterministically, never the
// model's own arithmetic.
const SCOPE_SPEND_TABLE = {
  "micro-area": { simple: "$0-$15", polished: "$15-$50", elevated: "$50-$150" },
  "small-area": { simple: "$0-$25", polished: "$25-$75", elevated: "$75-$250" },
  "room-section": { simple: "$0-$50", polished: "$50-$175", elevated: "$175-$500" },
  "whole-room": { simple: "$0-$100", polished: "$100-$350", elevated: "$350-$1000" },
  "large-room": { simple: "$0-$200", polished: "$200-$600", elevated: "$600-$2000" },
};

// Pure. Overwrites each approach's estimatedSpendRange in place from the
// fixed table above, keyed by the AI's own scopeSize classification -
// called once, right after parsing the AI response and before that object
// is displayed (setResults) or saved (savePlanToHistory), so both always
// see the same deterministic value. Falls back to "room-section" (a
// middle-of-the-road default) when scopeSize is missing or doesn't match
// one of the five known keys, so a malformed classification degrades to a
// reasonable default instead of leaving estimatedSpendRange undefined.
function applyDeterministicSpendRanges(parsed) {
  const band = SCOPE_SPEND_TABLE[parsed.scopeSize] || SCOPE_SPEND_TABLE["room-section"];
  ["simple", "polished", "elevated"].forEach((id) => {
    if (parsed.approaches?.[id]) {
      parsed.approaches[id].estimatedSpendRange = band[id];
    }
  });
  return parsed;
}

// Approach Selection Phase B (ApproachSelectionDesign.md Section 4): display
// name/copy for each of the AI's three fixed approach ids. Client-owned,
// not AI-authored, so copy can evolve without touching the prompt/schema.
const APPROACH_META = {
  simple: { name: "Keep It Simple", color: BRAND.green, bg: BRAND.greenLight, border: BRAND.greenMid },
  polished: { name: "Polished & Practical", color: BRAND.tan, bg: BRAND.tanLight, border: BRAND.tanBorder },
  elevated: { name: "Elevated Finish", color: BRAND.purple, bg: BRAND.purpleLight, border: BRAND.purpleBorder },
};
const APPROACH_ORDER = ["simple", "polished", "elevated"];

// Maps a productRecommendation's `icon` category (fixed vocabulary enforced
// by the analyze() prompt - see approachesInstruction) to a real
// lucide-react-native component. Mirrors getRoomTypeIcon's established
// keyword-table-with-fallback pattern. Falls back to Package for any
// unrecognized/missing value so a malformed AI response can never crash on
// an undefined icon component.
// Pure. Reduces a productRecommendation's own productType - which the AI
// writes as a full descriptive phrase ("decorative tray for cabinet
// surface", "floating shelf or niche shelf") - to the short core noun the
// collapsed card's "Suggested additions" preview needs ("tray", "shelf").
// Display-only: productType itself is never rewritten, and the expanded
// card's product rows still show the AI's full phrase.
//
// Three steps, in order:
//   1. Cut at the first connector. Everything after it is either an
//      alternative ("or niche shelf") or a placement/purpose clause ("for
//      cabinet surface") - neither belongs in a scannable preview.
//   2. Drop a leading descriptor ("decorative tray" -> "tray"). A small
//      explicit list rather than "always take the last word", which would
//      turn "wall art" into "art" and "picture light" into "light" - the
//      failure mode of an unmatched descriptor is a slightly longer but
//      still accurate phrase, which the wrapping preview line can absorb.
//   3. Cap at two words, keeping the last two (the head noun and its
//      nearest qualifier).
const PRODUCT_DESCRIPTOR_WORDS = new Set([
  "decorative", "floating", "small", "large", "modern", "slim", "tall", "wide",
  "compact", "adjustable", "stackable", "clear", "woven", "wooden", "metal",
  "acrylic", "led", "simple", "classic", "minimalist", "sturdy", "portable",
]);
function shortProductNoun(productType) {
  const raw = typeof productType === "string" ? productType.trim() : "";
  if (!raw) return "";
  const cut = raw.split(/\s+(?:or|and|for|with|to|on|in|under|that|which)\s+|\s+[-–—]\s+|[,(]/i)[0].trim();
  let words = cut.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9-]/g, "")).filter(Boolean);
  if (!words.length) return raw.toLowerCase();
  if (words.length > 1 && PRODUCT_DESCRIPTOR_WORDS.has(words[0].toLowerCase())) words = words.slice(1);
  if (words.length > 2) words = words.slice(-2);
  return words.join(" ").toLowerCase();
}

// ---- Compact product card: display-layer transforms (2026-08-16) ----------
// Both of these are PURE VIEW CONCERNS. Neither touches the plan document, and
// neither costs an AI call: productType and reason are written once by the
// model and stay in the data verbatim, exactly as searchTerms/resolveProduct-
// Destination still read them. Everything here only decides what a ~80px card
// shows.
//
// A card HEADING, which is a different job from shortProductNoun's inline
// "shelf · basket · tray" preview - so it shares that function's first rule
// (cut at the connector) and deliberately diverges on the other two:
//
//   * shortProductNoun always strips a leading descriptor, because in a
//     mid-sentence preview "decorative objects" and "objects" read the same.
//     As a heading, stripping it leaves a bare "Objects", which says nothing.
//     So the descriptor is only dropped when a real noun phrase survives it
//     ("modern wall art" -> "Wall Art"); when it would leave one lone word
//     the descriptor is kept ("decorative objects" -> "Decorative Object").
//   * shortProductNoun keeps the LAST two words to protect "wall art" from
//     becoming "art". Once the descriptor rule above is in place the risk is
//     gone, and the FIRST two read far better on the heads that are actually
//     long: "cable management box" -> "Cable Management", not "Management
//     Box"; "drawer organizer inserts" -> "Drawer Organizer".
//
// Singular, because a card names one kind of thing. Only the final word is
// singularized, and only on suffixes that are unambiguous - "glass" and
// "-ss" endings are left alone.
const PRODUCT_NAME_MINOR_WORDS = new Set(["and", "or", "for", "with", "of", "the", "a", "an"]);
function singularizeWord(w) {
  const lower = w.toLowerCase();
  if (lower.length <= 3 || lower.endsWith("ss") || lower.endsWith("us")) return w;
  if (/[^aeiou]ies$/.test(lower)) return w.slice(0, -3) + "y";
  // shelves -> shelf, leaves -> leaf; knives -> knife keeps its silent e.
  if (lower.endsWith("ives")) return w.slice(0, -3) + "fe";
  if (lower.endsWith("ves")) return w.slice(0, -3) + "f";
  if (/(ch|sh|s|x|z)es$/.test(lower)) return w.slice(0, -2);
  if (lower.endsWith("s")) return w.slice(0, -1);
  return w;
}
function displayProductName(productType) {
  const raw = typeof productType === "string" ? productType.trim() : "";
  if (!raw) return "";
  const cut = raw.split(/\s+(?:or|and|for|with|to|on|in|under|that|which)\s+|\s+[-–—]\s+|[,(]/i)[0].trim();
  let words = cut.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9-]/g, "")).filter(Boolean);
  if (!words.length) return "";
  if (words.length > 1 && PRODUCT_DESCRIPTOR_WORDS.has(words[0].toLowerCase())) {
    // Only drop it if at least two words remain - otherwise the descriptor is
    // carrying the meaning and has to stay.
    if (words.length > 2) words = words.slice(1);
  }
  if (words.length > 2) words = words.slice(0, 2);
  words[words.length - 1] = singularizeWord(words[words.length - 1]);
  return words
    .map((w, i) => (i > 0 && PRODUCT_NAME_MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

// One short line explaining why THIS product helps THIS space. The input is
// already space-specific - resolveRecommendationReason hands back the
// grounding sentence, the linked problem descriptions, or the AI's own reason,
// all of which are written about the photographed space rather than the
// product category. So this only has to SHORTEN, never summarize, which is
// what keeps it a display transform instead of a second inference step.
//
// Order matters: take the first sentence, and only if that is still too long
// fall back to the first clause. Doing it the other way round would cut
// "The niche is empty, and the shelf below is crowded" at the comma and lose
// the sentence's actual subject on inputs that were already short enough.
// 45 chars, 5-9 words, and NO ellipsis - measured against real staging output,
// where the median resolved reason is 137 characters, so essentially every one
// is cut. That is what makes the "complete thought" rule the whole job here:
// a plain 45-char word-boundary trim yields "The recessed niche is largely
// empty and needs", which is a sentence stopped mid-air, and an ellipsis only
// advertises the damage rather than repairing it.
//
// So after fitting the budget, trailing words are dropped while the last word
// is one that is still WAITING for something - a determiner, preposition,
// conjunction, auxiliary, or a transitive verb/participle with no object yet.
// "...empty and needs" -> "...largely empty", which reads as a finished
// observation. Taking fewer words is explicitly correct here; the 5-9 word
// target is an aim, not a floor to pad toward.
const REASON_MAX = 45;
const REASON_MAX_WORDS = 9;
const REASON_WEAK_ENDINGS = new Set([
  // determiners / quantifiers
  "a", "an", "the", "this", "that", "these", "those", "its", "their", "his",
  "her", "our", "your", "my", "some", "any", "each", "every", "no", "another",
  "other", "both", "all", "several", "multiple", "various", "additional",
  "more", "most", "few", "many", "much", "such", "one", "two", "three",
  // prepositions
  "of", "in", "on", "at", "to", "for", "with", "from", "by", "into", "onto",
  "over", "under", "above", "below", "across", "through", "between", "among",
  "around", "beside", "behind", "near", "without", "within", "against",
  "alongside", "upon", "off", "out", "up", "down", "about",
  // conjunctions / complementizers
  "and", "or", "but", "nor", "so", "yet", "while", "whereas", "plus", "than",
  "which", "who", "whom", "whose", "where", "when", "as", "if", "because",
  // auxiliaries / copulas
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "do", "does", "did", "will", "would", "can", "could", "should", "may",
  "might", "must", "am",
  // transitive verbs and participles that still want an object
  "needs", "need", "provides", "provide", "providing", "creates", "create",
  "creating", "adds", "add", "adding", "holds", "hold", "holding", "keeps",
  "keep", "keeping", "makes", "make", "making", "gives", "give", "giving",
  "leaves", "leaving", "establishes", "establish", "establishing", "enhances",
  "enhance", "softens", "soften", "offers", "offer", "lacks", "lack",
  "requires", "require", "allows", "allow", "prevents", "prevent", "includes",
  "include", "including", "features", "contains", "becomes", "brings",
  "delivers", "supports", "houses", "stores", "displays", "showcases",
  "anchors", "corrals", "organizes", "organize", "uses", "use", "using",
  "leaving", "turning", "turns", "reducing", "reduce", "improving", "improve",
  // degree/focus adverbs, which always point forward at something
  "only", "just", "even", "still", "very", "quite", "rather", "fairly", "too",
  // attributive adjectives seen dangling in real staging output ("provides a
  // clean", "and neutral"). Predicate adjectives that legitimately END a
  // thought - "is largely empty", "feels incomplete", "appears cluttered" -
  // are deliberately NOT here.
  "clean", "neutral", "warm", "cool", "single", "loose", "plain", "bare",
  "blank", "open", "clear", "small", "large", "deep", "wide", "tall", "short",
  "dark", "soft", "plush", "upgraded", "coordinating", "matching",
  "decorative", "wooden", "metal", "white", "black", "brown", "beige",
  "electronic", "inanimate", "uncertain", "rectangular", "horizontal",
  "vertical", "overhead", "recessed", "upper", "lower", "middle", "current",
  "flat", "round", "square",
  // Attributive participles that dangled in real PDF step titles: "with
  // coordinated", "in a unified", "use a tiered". Same class as
  // "coordinating" and "matching" above.
  "coordinated", "unified", "tiered", "framed", "layered", "defined",
  // degree/frame adverbs that modify something still to come
  "entirely", "currently", "solely", "minimally", "largely", "mostly",
  // more transitive verbs observed dangling in real output
  "relies", "rely", "wraps", "wrap", "contain", "sitting", "distributed",
  "arranged", "positioned", "placed", "stacked", "mounted",
]);
// A trailing word ending in one of these suffixes is almost always an
// adjective still reaching for its noun ("numerous", "architectural",
// "decorative"). Cheaper and broader than trying to enumerate every adjective
// the model might produce, and it only ever removes words - a false positive
// costs one word of context, never correctness.
const REASON_DANGLING_SUFFIX = /(ous|ial|ual|ative|itive|able|ible|ful|less|ish|ary|ory)$/;
// Title-cases a productType for the PDF. Deliberately NOT displayProductName:
// that one also TRUNCATES to two words for the compact in-app card, which would
// turn "Matching Soap Dispenser Set" into "Matching Soap". A document has room
// for the whole name.
//
// Small connector words stay lowercase unless they lead, so "Set of 3 Bins"
// does not become "Set Of 3 Bins".
const PDF_TITLE_MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "in",
  "of", "on", "or", "the", "to", "with"]);
function pdfTitleCase(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      // Already-uppercase words are acronyms and are left exactly as written -
      // otherwise "LED picture light" title-cases to "Led Picture Light", which
      // is wrong and looks careless. The corpus is full of LED.
      if (w.length >= 2 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && PDF_TITLE_MINOR.has(lower)) return lower;
      // Hyphenated compounds capitalise both halves: "pull-out" -> "Pull-Out".
      return lower.split("-").map((part) =>
        part ? part.charAt(0).toUpperCase() + part.slice(1) : part).join("-");
    })
    .join(" ");
}

function shortDisplayReason(reason) {
  const raw = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
  if (!raw) return "";
  // First sentence, then its first clause. The lookahead requires a following
  // capital so "approx. 3in" is not mistaken for a sentence end.
  const firstSentence = raw.split(/(?<=[.!?])\s+(?=[A-Z])/)[0].trim();
  const firstClause = firstSentence.split(/[,;:]\s+/)[0].trim();
  const base = firstClause || firstSentence;
  let words = base.split(/\s+/).filter(Boolean);
  // Fit the character budget by whole words only - never a mid-word cut.
  while (words.length > 1 && words.join(" ").length > REASON_MAX) words.pop();
  if (words.length > REASON_MAX_WORDS) words = words.slice(0, REASON_MAX_WORDS);
  // Back off to something that reads as finished.
  const bare = (w) => w.replace(/[^A-Za-z-]/g, "").toLowerCase();
  const weak = (w) => {
    const b = bare(w);
    if (!b) return true;
    if (REASON_WEAK_ENDINGS.has(b)) return true;
    if (b.length <= 5) return false;
    // "-ous" is checked before the plural guard on purpose: "numerous" and
    // "spacious" both end in s without being plurals, and the guard below
    // would otherwise let them through.
    if (b.endsWith("ous")) return true;
    // Everything else: suffix test, never applied to a plural noun ("items",
    // "bottles", "shelves").
    return !b.endsWith("s") && REASON_DANGLING_SUFFIX.test(b);
  };
  while (words.length > 1 && weak(words[words.length - 1])) words.pop();
  const out = words.join(" ").replace(/[,;:\-–—]+$/, "").trim();
  // A clause that survived whole keeps its own terminal punctuation; a trimmed
  // one gets none - no ellipsis, by design.
  return out.length > REASON_MAX ? out.slice(0, REASON_MAX).trim() : out;
}

// The icon vocabulary is enforced at the prompt level (analyze()'s own
// productInstruction lists these exact keys) - keep the two in sync, and
// keep every name here verified against the installed lucide-react-native
// version before adding it. An unavailable name imports as undefined and
// crashes at render, which is how "Shelf" was lost earlier (see
// ROOM_TYPE_ICON_RULES' own note).
//
// The ten decor/styling keys below were added alongside the AI prompt
// refinement that lets an approach recommend art, lighting, textiles and
// display objects, not just organizing hardware. Without them every such
// recommendation fell through to `other` and rendered the same generic
// Package icon, which made the expanded product rows unreadable.
const PRODUCT_CATEGORY_ICONS = {
  // organizing hardware (original vocabulary, unchanged)
  cable: Cable,
  basket: ShoppingBasket,
  bin: Container,
  shelf: ShelvingUnit,
  hook: Anchor,
  label: Tag,
  "drawer-organizer": Grid2x2,
  hanger: Shirt,
  bag: ShoppingBag,
  // decor / styling / finishing
  art: Frame,
  lighting: Lightbulb,
  textile: Blinds,
  plant: Sprout,
  tray: ConciergeBell,
  barware: Wine,
  glassware: GlassWater,
  decor: Amphora,
  storage: Boxes,
  furniture: Armchair,
  other: Package,
};
function getProductCategoryIcon(iconKey) {
  return PRODUCT_CATEGORY_ICONS[iconKey] || Package;
}
// Derived, never hand-written: analyze()'s productInstruction interpolates
// this so the vocabulary the AI is told to choose from is definitionally
// the vocabulary this file can render. Adding a key to the map above is
// the only edit needed to teach the prompt a new category.
const PRODUCT_ICON_VOCAB = Object.keys(PRODUCT_CATEGORY_ICONS).join(", ");

// ---- AI analysis instruction blocks (TwoStageAnalysisDesign.md §3) --------
// Hoisted out of analyze() 2026-08-12. They used to be local to that one
// function, which was fine while there was one prompt; the two-stage split
// needs the SAME rules composed into two different prompts, and the detail
// prompt is also built from the resume path where analyze() never runs.
// Nothing about the text changed in the move - only vizAndSpendInstruction
// was divided, because it bundled three separate concerns (see below).
const scopeClassificationInstruction = `Before writing anything else, classify the SIZE of what is being organized in this photo into exactly one of five scope levels for scopeSize - this determines realistic spending, not the room's own name: micro-area (a single shelf, drawer, or small fixture), small-area (a desk, vanity, or counter section), room-section (an entertainment center, closet, or pantry), whole-room (a full kitchen, bedroom, or garage), or large-room (an open-plan living area or a full basement). Base this on what is actually visible and being organized, not the parent room's own name - a single drawer inside a kitchen is still micro-area, not whole-room.`;
// Fact vs. inference (AIAnalysisRedesign.md Section 2): itemsFound
// becomes {description, certainty} objects instead of a flat string
// array - the schema-level change that gives the model somewhere
// honest to put "I can see something here but don't know what it
// is" instead of guessing a specific, possibly wrong, object name.
const identificationInstruction = `Before analyzing problems or opportunities, catalog what is actually in the photo for itemsFound. For each entry, write a description and a certainty of "confirmed" or "uncertain". Mark an item confirmed only if you are genuinely sure what it is. If you are not genuinely sure, mark it uncertain and describe ONLY its physical appearance and approximate size, never a guessed object name - a correct "large flat rectangular item on the table, about the size of a placemat" is far more useful than an incorrect "printer" or "laptop". Also record genuine absences as their own confirmed itemsFound entries when a surface or fixture is notably empty or under-used compared to what a finished version of this room would have - a bare wall, a niche with nothing on it, a room with no visible light fixture. Do not pad itemsFound with trivial, obvious contents (floor, walls, ceiling) - only include what is specific enough to inform the rest of your analysis. Do not list more than one entry for the same physical object.`;
// The architectural fix, not just the identification instruction
// (Section 2): a certainty marked in itemsFound is worthless if
// nothing stops it from being silently promoted into a confident
// noun three fields later - that promotion, not a lack of hedging,
// is what actually produced "printer" in the original bug.
const certaintyFirewallInstruction = `CERTAINTY MUST NEVER BE LAUNDERED: every later field you write - problemsFound descriptions, organizingGuidance tips, taskChecklist steps, keyChanges phrases, and productRecommendation reasons - must trace back cleanly to your own itemsFound entries. If it references something you marked confirmed, use it freely and by name. If it references something you marked uncertain, you must keep using that entry's own neutral physical description verbatim, word for word, everywhere it comes up again - never let an uncertain guess quietly turn into a confident, specific noun later just because a confident noun reads more naturally. Writing "large flat rectangular item on the table, possibly a board or tray" in itemsFound and then writing "move the printer" anywhere else in your response is a failure, even though no single field claims certainty out loud - a later field asserting a specific identity silently overrides the earlier hedge, and that is exactly what you must never do. If a task or recommendation genuinely cannot be written without naming an uncertain object precisely, do not include it - use a different, well-grounded task instead of forcing a bad one in.`;
// Problems AND opportunities (Section 3): problemsFound gains a
// type field. The anti-hallucination guardrail ("do not invent an
// opportunity on a surface that already has something on it")
// matters as much as the opportunity instruction itself - swinging
// from "ignores opportunities" to "insists every surface needs
// something" is an equally real failure mode, not a safe direction
// to over-correct toward.
const opportunitiesInstruction = `Then work through problemsFound in two separate passes, giving every entry a type. First pass, type "organization": what here is cluttered, disorganized, or not functioning well - ground each in a problem you can point to, never a generic clutter observation. Second pass, type "opportunity": what would make this space feel more finished, using only genuine, visible absences or under-use you can point to in your own itemsFound entries above - a wall with no art or decor, a niche that is empty or minimally used, a room with no visible ambient, accent, or task lighting, furniture that is poorly positioned for how the space is actually used. An opportunity is a factual observation ("this wall has no decor"), not a verdict that something must be added - do not invent an opportunity on a surface that already has something on it, and do not list a blank surface as an opportunity merely because it is blank, if being blank is appropriate for what that surface is (a plain hallway end-cap, a utility door). Resist the pull to find an opportunity on every wall or surface just because you were asked to look for them - a well-finished space with nothing genuinely missing should produce zero opportunity entries, and that is a correct, complete answer, never a failure to look hard enough. Give every entry of either type a short, stable, lowercase-hyphenated id and a one-sentence description grounded in exactly what is visible, following the certainty rule above.`;
// Three genuinely different transformation VISIONS (Section 4) -
// direct rewrite of the old single "genuinely different... not the
// same plan with products added or removed" sentence, which was
// immediately undercut by an entire paragraph of nothing but
// spending bands right after it. Ambition/scope now leads; spending
// bands (below) are kept only as the AI's own internal calibration
// reference, never the primary differentiation mechanic.
// Evidence-constrained interventions (Prompt Refinement, 2026-08-11).
// Controlled testing against two real staging photos showed the rule
// reaching taskChecklist but leaking in organizingGuidance ("Install
// proper accent lighting in the niche" alongside a correctly
// conditional task in the SAME approach) - so the all-fields sentence
// below names every field explicitly rather than stating the rule
// once and listing fields afterward.
const evidenceConstraintInstruction = `EVIDENCE-CONSTRAINED INTERVENTIONS: never present installation, construction, electrical, plumbing, mounting that depends on unknown structure, or any other infrastructure-dependent work as achievable, unless the necessary infrastructure is VISIBLE in this photo or otherwise confirmed to you. "Install a pendant light" requires a visible ceiling fixture, junction box, or existing outlet at that location. A table lamp requires a visible outlet within reach of where you are placing it.\n\nEvidence-constrained intervention rules apply to ALL generated fields, including strategyDescription, keyChanges, organizingGuidance, taskChecklist, productRecommendations, and visualizationDirection. When required infrastructure or physical conditions cannot be confirmed from the image or known context, the recommendation must be omitted or explicitly conditional. There is no field in which an unconfirmed infrastructure-dependent action may be stated as an instruction. Writing "If an outlet is available in or near the niche, install a picture light" in taskChecklist while writing "Install proper accent lighting in the niche" in organizingGuidance is a failure, because the second sentence states as achievable exactly what the first correctly flagged as unknown.\n\nConditional phrasing names the unknown out loud: "If an outlet is available near the credenza, a small lamp could add ambient light" is acceptable in any field. Instructional phrasing that assumes the unknown is resolved - "Introduce a table lamp on the credenza", "Add accent lighting to the niche", "Install proper accent lighting" - is not acceptable in any field, including guidance and strategy text, unless the required outlet, fixture, or mounting evidence is actually visible. An idea stated conditionally in one field must never appear unconditionally in another.\n\nBattery-powered and adhesive options that need no power source and no structural mounting are unconditional and may be recommended normally; a plug-in option is unconditional only if you can see the outlet it needs. This rule outranks every instruction below about ambition and breadth: an approach is never allowed to reach for a bigger vision by assuming infrastructure it cannot see.`;
const visionApproachesInstruction = `Then generate THREE separate, complete organizing approaches for this exact space, and make them differ in AMBITION AND VISION, not just spending.\n\nThe question you are answering for every approach is "how could this space be better?", not merely "what needs organizing?". A room that is not particularly cluttered still has real transformation potential through styling, completion, and finishing, and it is your job to find it. Equally, a room whose primary problem genuinely IS clutter and disorganization must be met with real organizing work first - never let the "how could this space be better?" framing pull you toward styling and decor while obvious functional disorder goes unaddressed. Solve what is actually wrong with the space in front of you.\n\n"simple" (Keep It Simple) means LOW INTERVENTION, not merely removing things. It must leave the room looking and working noticeably better, using what the user already owns: rearranging, decluttering, consolidating, regrouping, and restyling existing items into intentional arrangements. "Clear the table and wipe the surface" is not a transformation. "Clear the table, make the credenza feel like an intentional bar or display using what is already there, and give the blank wall and niche a more finished treatment by relocating decor that already exists elsewhere in the room" IS a transformation, even at zero cost. Simple should not invent discretionary purchases, but it must still actively improve the space, not just subtract from it. The goal of Simple is: this space works better AND looks noticeably better tomorrow, with minimal effort and essentially no spending.\n\n"polished" (Polished & Practical) solves the organization problems AND finishes the space with targeted purchases that genuinely upgrade function and appearance. The goal of Polished is: this space feels intentional and put together.\n\n"elevated" (Elevated Finish) is a full transformation vision: address every organization problem AND every genuine completion opportunity you identified, proposing whatever combination of storage systems, wall art, accent or task lighting, furniture repositioning or upgrades, concealed storage, and material coordination the space actually calls for, subject always to the evidence-constrained interventions rule above. The goal of Elevated is: this space looks and feels designed, like a professional organizer's finished project, not just decluttered with nicer bins.\n\nCOMPLETION OPPORTUNITIES INFLUENCE ALL THREE APPROACHES. Blank walls, unused niches, awkward empty areas, and unfinished displays are addressed at every approach level when they are visually significant, differing by ambition rather than being deferred entirely to the expensive approach: Simple resolves them at zero or near-zero cost by rearranging, regrouping, and restyling what is already in the room; Polished resolves them with targeted purchases that finish the space; Elevated resolves them as part of a comprehensive transformation. An approach that simply ignores a significant blank wall or empty niche has not done its job at its own level.\n\nEach approach must propose a DIFFERENT SCOPE of transformation, not the same tasks at different price points - Simple solves immediate problems and makes the room feel more finished with what is there, Polished improves the room's feel with targeted additions, Elevated reimagines what the space could be. If your three checklists would read almost the same with the adjectives stripped out, you have not done this correctly - go back and make Elevated genuinely bigger in scope, not merely pricier, and make sure Simple is not quietly doing Polished's job.`;
// Section 5: explicit behavioral-difference requirement, not just
// "grounded in a visible problem" (which the old prompt already
// said and which alone still produced three reworded copies of the
// same checklist).
const taskDifferentiationInstruction = `For each approach, write organizingGuidance (3-4 general tips in that approach's own spirit) and taskChecklist (3-6 doable-right-now tasks for a first working session under that approach, each in one or two warm sentences, in the voice of a calm encouraging professional organizer). organizingGuidance and taskChecklist must behaviorally differ across the three approaches, not just reword the same actions - if Polished or Elevated address a completion opportunity, their own taskChecklist must contain a real step for it that Simple's does not (hanging art, adding lighting, styling a niche), not merely a fancier description of decluttering the same objects. Every tip and task must remain grounded in a problem or opportunity genuinely present in this exact photo, following the certainty rule above, never a generic decorating trope you default to. If a specific approach genuinely has little left to do beyond what a more modest approach already covers, it is correct and honest for that approach to say so rather than inventing busywork.`;
// Section 7: Elevated's recommendations are no longer limited to
// organizing products (art/lighting/furniture/services now
// explicitly allowed) - a direct consequence of opportunities
// existing as their own recommendable category now.
// Product Grounding schema (2026-08-11). Two prior controlled tests
// both produced the same failure under a single mandatory
// relatedProblemId: an area rug whose own reason cited hard flooring
// was pointed first at "blank-wall", then at "credenza-top-styling",
// because the schema left nowhere honest to put a legitimate
// recommendation that solves no NAMED problem. Prose fixes did not
// help - the schema was the constraint, so the schema changed. The
// empty-ids + grounding state is the honest third answer.
const productInstruction = `TASK CHECKLIST AND PRODUCT RECOMMENDATIONS ARE SEPARATE DOMAINS. A product does not need a corresponding chore. "Wall art" can appear in productRecommendations even when "hang wall art" is not in that approach's taskChecklist - the user decides whether to act on a recommendation, and a recommendation is an option you are offering, not a task you are assigning.\n\nEVERY RECOMMENDATION MUST BE GROUNDED, IN EXACTLY ONE OF THREE WAYS. Each recommendation carries relatedProblemIds (an array of problemsFound ids) and grounding (a sentence of visible evidence, or null):\n(a) PROBLEM-SOLVING: relatedProblemIds lists one id, grounding is null. The product directly addresses that identified problem or opportunity.\n(b) MULTI-PROBLEM: relatedProblemIds lists two or more ids, grounding is null. The product genuinely serves several identified issues at once, and you list every one it serves rather than picking one arbitrarily.\n(c) OPTIONAL ENHANCEMENT: relatedProblemIds is an empty array and grounding is a sentence citing the specific visible evidence that supports the recommendation. Use this when a product would genuinely improve the space but does not solve any problem you named - for example an area rug where the visible hard flooring leaves the dining zone unanchored, when "unanchored flooring" is not one of your problemsFound entries. This is the honest answer, not a lesser one: not every good recommendation maps to a problem.\n\nHARD RULES ON GROUNDING: every id you put in relatedProblemIds must actually exist in your own problemsFound - never invent an id, and never point a product at a problem it does not genuinely address just to avoid leaving the array empty. An empty relatedProblemIds is permitted ONLY together with a non-null grounding that cites visible evidence. A recommendation with both an empty relatedProblemIds and a null grounding is invalid and must not be returned at all - that is ungrounded filler. If you find yourself reaching for a loosely-related id, that is the signal to use state (c) instead, or to drop the recommendation.\n\nAn optional enhancement with no relatedProblemIds is permitted only when the photograph provides specific visible evidence of an unmet improvement opportunity. Existing ownership of the same functional product type is evidence AGAINST recommending another unless the image shows why the existing item is inadequate (for example visibly broken, obviously undersized, or the wrong type for the task). Do not recommend a product merely because the room or activity is "compatible" with it. The grounding must cite a specific visible characteristic that the proposed product would improve, not a general assumption about what the space or activity type might benefit from. "The desk already has a task lamp, but detailed creative work often benefits from more focused light" is NOT valid grounding: the product type is already owned and the justification is a general assumption about the activity rather than a visible inadequacy. "The wall above the desk holds papers attached directly to the surface with no frames or boundaries" IS valid grounding: it names a specific visible characteristic the product would improve.\n\nFor each approach, separately decide which of ITS OWN problems or opportunities would genuinely benefit from a purchase. Products and decor do NOT have to be strictly required to complete an organizing task: they can be useful additions that advance that approach's transformation wherever the visible space provides legitimate opportunities. Generate the useful product and decor categories supported by the observed opportunities. Prefer breadth when multiple legitimate opportunities exist, but never create a recommendation to reach a target count. Two well-grounded recommendations are better than four where the last two are reaching.\n\nMatch the recommendations to what the space actually needs. A space whose real problem is clutter and disorder needs organizing products (baskets, bins, drawer organizers, cable management, filing and paper storage, labels); do not substitute decor for organizing hardware in a space that plainly needs organizing. A space that is already functional but visually unfinished is where styling, art, textiles, and display objects belong.\n\nMany organization problems are solved by rearranging what is already there, especially under Keep It Simple, and it is correct for Keep It Simple to have zero recommendations when nothing genuinely needs buying. Conversely, do not withhold a recommendation from Keep It Simple only because it is the cheap tier - a single inexpensive item that solves a real, visible problem (a $5 set of cable ties, a $10 tray) is a completely legitimate Simple recommendation.\n\nFor each recommendation, write productType (a product or service category, never a specific product name or brand), reason (one sentence explaining what the product does for this space), shortReason, searchTerms (retailer-independent search words), icon (choose the single closest match from: ${PRODUCT_ICON_VOCAB}), relatedProblemIds, grounding, and approachId.\n\nshortReason: A 5-9 word, benefit-focused summary of reason. It must communicate why this product helps this specific space and must not introduce any benefit, problem, or claim not supported by the full reason. Same reasoning, same evidence, just compressed around why the product helps. Examples, each paired with the full reason it compresses: "The deep corner area appears to have items pushed toward the back, making them difficult to see and reach; a Lazy Susan would bring those items forward and make the space easier to access." -> "Easy access to deep corner items". "The recessed niche is largely empty and needs additional objects at varying heights to create a finished focal point." -> "Add height and interest to the niche". "The walls around the toilet and beside the vanity have no decoration, leaving the room feeling unfinished." -> "Fill bare walls with visual interest". "Three bottles sit on the credenza without styling, creating a scattered appearance." -> "Organize bottles into an intentional display". Write it as a benefit phrase, not a restated observation, and never pad it to reach nine words. Choose the most specific icon that fits - only use "other" when genuinely nothing in the list applies. Never return more than 6 recommendations for one approach, never invent a recommendation just to fill a slot, and never recommend a product tied to an object you were not confident about identifying.`;
// Section 8: the only genuinely new OUTPUT field this redesign adds
// (itemsFound/problemsFound are reshaped, not new) - short outcome
// phrases for the collapsed approach card's denser "Key changes"
// bullet row, distinct in voice from organizingGuidance's
// advice-voiced tips.
const keyChangesInstruction = `For each approach, also write keyChanges: 3 to 4 very short bullet phrases, two to five words each, not full sentences, naming the specific concrete changes that approach makes - for example "Cables concealed", "Wall styled with art", "Niche lit with accent lighting". These are a scannable summary for a collapsed card, distinct from organizingGuidance's advice-voiced tips - write them as plain outcomes, not instructions.`;
// visualizationDirection's own instruction gains one clause tying it
// to genuine scope, not just price point; the spending-bands
// reference table itself is UNCHANGED text (Section 6 of the
// design doc left recalibrating the bands as a separate, open,
// not-yet-decided follow-up - not part of this implementation).
// The old vizAndSpendInstruction bundled three separate concerns into one
// block: the visualization direction (detail), the spending-band calibration
// table (detail), and the proTip instruction (summary). The two-stage split
// sends the first two to Call 2 and the third to Call 1, so they are three
// constants now. The TEXT of each part is unchanged - only the boundaries
// between them are new.
const visualizationDirectionInstruction = `For each approach, also write visualizationDirection: one descriptive sentence (not a full image-generation prompt, just the creative direction) describing what that approach's finished result should look like for this specific space - distinct enough between the three approaches that someone reading all three, without labels, could tell which is which, and reflecting that approach's own genuine scope of transformation, not just its price point.\n\n`;
const spendCalibrationInstruction = `Reference spending bands, by scope and approach, for your own calibration only - do not return any dollar amount anywhere in your response, only scopeSize; the app determines the actual displayed spending range from these same fixed bands:\nmicro-area: Keep It Simple $0-$15, Polished & Practical $15-$50, Elevated Finish $50-$150.\nsmall-area: Keep It Simple $0-$25, Polished & Practical $25-$75, Elevated Finish $75-$250.\nroom-section: Keep It Simple $0-$50, Polished & Practical $50-$175, Elevated Finish $175-$500.\nwhole-room: Keep It Simple $0-$100, Polished & Practical $100-$350, Elevated Finish $350-$1000.\nlarge-room: Keep It Simple $0-$200, Polished & Practical $200-$600, Elevated Finish $600-$2000.\nUse the row matching your own scopeSize classification to keep each approach's organizingGuidance, taskChecklist, and productRecommendations realistic for that spending level.\n\n`;
const proTipInstruction = `Also write one proTip: general organizing wisdom for this type of space, not tied to any single approach.`;
// Section 9: every explicit prohibition, compiled into one closing
// block - same position roomAreaInstruction's own rules already
// occupy, right before the "never use em dashes"/JSON-contract tail.
const roomAreaInstruction = `Before returning your classification, answer three separate questions about this photo, in this exact order - do not let one contaminate another: (1) ORGANIZING TARGET - what is the primary thing or area the user appears to be asking Uncluttrd to organize in this photo? This is the organizing target: the specific thing they want help with, not a survey of everything visible in the frame. (2) PARENT ROOM - what room of the home is that organizing target located in? Use a short, common label (Living Room, Kitchen, Garage, Bedroom) for suggestedRoomName. (3) SCOPE - Before classifying areaScope, answer this question first: "Is there ONE primary thing or area that the user is asking Uncluttrd to organize in this photo?" If YES, the answer is sub-area, even if other furniture, walls, windows, or decorative items are visible in the background. Set suggestedAreaName to a short label for that organizing target. If NO - the photo genuinely depicts a general room with no single organizing focus and you cannot identify any one area the user is targeting - then the answer is whole-room and suggestedAreaName is null. Do NOT classify as whole-room merely because: multiple furniture types are visible; multiple furniture pieces are present; the photo captures several items across the room; you see decorative elements, plants, or windows alongside the main subject; the photo is not "tightly framed" on one fixture. Any of those can be true while the photo is still clearly ABOUT one organizing target. The question is always: what does the user want to organize? If you can name it, it's sub-area. The third possible classification is "ambiguous" (the room-level label itself commonly means either a fully independent room or a named zone within a larger room, depending on the specific home - for example Pantry, Closet, Mudroom, Laundry Area, or Home Office - and this one photo does not give you enough context to tell which this home means). When ambiguous, still provide your best suggestedRoomName as the standalone-room interpretation - the app will ask the user to confirm which it actually is. Never invent a numerical confidence score. SELF-CONSISTENCY CHECK (do this last, after you have drafted your overview and recommendations in your own reasoning): does your overview describe organizing ONE specific area, fixture, or piece of furniture? If yes, your areaScope MUST be "sub-area" and suggestedAreaName MUST name that area. Your overview and your classification must agree - they are describing the same photo, not answering different questions. If your overview says "your corner shelf" then areaScope cannot be "whole-room." Before returning your JSON, re-read your own overview field and your own areaScope field together and confirm they tell the same story.\n\n`;
const prohibitionsInstruction = `Do not violate any of the following: never state a guess as a fact; never build a task, tip, or recommendation around an object you marked uncertain except by its own neutral physical description; never let an uncertain identification become a confident noun anywhere later in your response; never generate three approaches that are the same plan at three price points; never ignore a genuine blank wall, unused niche, or missing light source; never let styling or decor displace real organizing work in a space whose primary problem is clutter or disorder; never leave a visually significant completion opportunity entirely unaddressed by Keep It Simple on the grounds that it costs money to fix, when a zero-cost rearrangement would partly address it; never treat a room that is not especially cluttered as having no transformation potential; never state an infrastructure-dependent action as achievable in ANY field without visible evidence, and never use instructional phrasing in one field for an idea you correctly made conditional in another; never put an id in relatedProblemIds that does not exist in problemsFound or that the product does not genuinely address; never return a recommendation with both an empty relatedProblemIds and a null grounding; never claim an opportunity exists on a surface that already has something intentional on it, or where being blank is appropriate; never pad recommendations to fill a quota; never insist a space needs more than it does - zero opportunities and zero recommendations are both valid, correct answers when the evidence genuinely supports them.`;

// Call 1 needs just enough product signal for the collapsed card's
// "Suggested additions" line - category nouns, not recommendation objects.
// Deliberately NOT the full productInstruction: generating grounded,
// problem-linked recommendations is the single most expensive part of the
// response, and moving it to Call 2 is most of why Call 1 is fast.
const suggestedAdditionTypesInstruction = `For each approach, also write suggestedAdditionTypes: a short list of the product or decor CATEGORIES that approach would add, as plain nouns the user would recognize ("tray", "wall art", "area rug", "picture light"). Three to six entries at most, and an empty array is correct for an approach that genuinely needs no purchases. These are a preview only - do not write reasons, search terms, or justifications here. Only list a category you would actually be able to ground in a problem or opportunity you identified.`;

// Call 1's JSON contract. Same stable-analysis fields the single call always
// returned, plus per-approach summary fields; every detail field is absent.
const SUMMARY_JSON_TAIL = `Return ONLY valid JSON, nothing else (no markdown, no backticks).\n\n{"suggestedRoomName":"short label, e.g. Living Room","suggestedAreaName":"short label for the specific zone/fixture shown, or null if whole-room","areaScope":"whole-room, sub-area, or ambiguous","overview":"2 warm sentences","itemsFound":[{"description":"specific item, or neutral physical description if uncertain","certainty":"confirmed or uncertain"}],"problemsFound":[{"id":"short-hyphenated-id","type":"organization or opportunity","description":"one sentence grounded in what is visible"}],"scopeSize":"micro-area, small-area, room-section, whole-room, or large-room","approaches":{"simple":{"strategyDescription":"1-2 sentences","keyChanges":["phrase1","phrase2","phrase3"],"suggestedAdditionTypes":["category noun"]},"polished":{"strategyDescription":"1-2 sentences","keyChanges":["phrase1","phrase2","phrase3"],"suggestedAdditionTypes":["category noun"]},"elevated":{"strategyDescription":"1-2 sentences","keyChanges":["phrase1","phrase2","phrase3"],"suggestedAdditionTypes":["category noun"]}},"proTip":"one expert insight"}`;

// ---- Call 2 (detail) ----------------------------------------------------
// The load-bearing part of the split. Call 2 expands; it never re-decides.
const ESTABLISHED_CONTRACT = `The analysis, problems, and approach strategies below are already established. Expand each approach with detailed guidance, tasks, products, and visualization direction that are consistent with and support the established strategy. Do not contradict or redefine any established field.\n\nYou must NOT re-analyze, re-classify, or re-describe the space. Specifically: do not change or restate the room identity, the area identity, the scope size, the overview, the items found, the problems found, any approach's strategyDescription, or any approach's keyChanges. Those decisions are final and the user has already seen them. Do not introduce a problem or opportunity that is not in the established problemsFound list. Every relatedProblemIds entry must be an id from that list.`;

// Call 2 is deliberately TEXT-ONLY - see TwoStageAnalysisDesign.md §4. The
// established itemsFound/problemsFound ARE the visual record, written by the
// call whose entire job was cataloguing what is visible. Withholding the
// photograph is a stronger guarantee against re-analysis than any
// instruction could be, and it is what lets retry and resume run without
// re-uploading or re-downloading an image.
const NO_PHOTO_CLAUSE = `You are not being shown the photograph. The established analysis below IS your evidence: itemsFound and problemsFound are the complete record of what is visible in this space. Ground everything you write in those entries and nothing else. Never describe a visual detail that does not appear in them.`;

const ADDITIONS_CONSISTENCY = `The user has ALREADY been shown each approach's suggestedAdditionTypes as that approach's "Suggested additions" preview. Your productRecommendations for an approach must be consistent with the list it was shown: every listed type should correspond to one of your recommendations for that approach, and you must not introduce a category that contradicts the established strategy. Wording may be refined and made more specific. If a listed type genuinely does not warrant a recommendation once you look closely, omit it rather than inventing a justification. An approach whose list is empty should return an empty productRecommendations array.`;

const DETAIL_JSON_TAIL = `Return ONLY valid JSON, nothing else (no markdown, no backticks). Return exactly this shape, with all three approaches:\n\n{"approaches":{"simple":{"organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","shortReason":"5-9 word benefit phrase","searchTerms":"search phrase","icon":"one key from the icon list above","relatedProblemIds":["matching problemsFound id, or empty array if grounding is used"],"grounding":"visible evidence sentence, or null","approachId":"simple"}],"visualizationDirection":"one descriptive sentence"},"polished":{"organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","shortReason":"5-9 word benefit phrase","searchTerms":"search phrase","icon":"one key from the icon list above","relatedProblemIds":["matching problemsFound id, or empty array if grounding is used"],"grounding":"visible evidence sentence, or null","approachId":"polished"}],"visualizationDirection":"one descriptive sentence"},"elevated":{"organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","shortReason":"5-9 word benefit phrase","searchTerms":"search phrase","icon":"one key from the icon list above","relatedProblemIds":["matching problemsFound id, or empty array if grounding is used"],"grounding":"visible evidence sentence, or null","approachId":"elevated"}],"visualizationDirection":"one descriptive sentence"}}}`;

// CALL 1. Same composition order the single-call prompt used, minus the
// three detail-only blocks (taskDifferentiation, product, visualization +
// spend calibration), plus the additions preview.
function buildSummaryPrompt({ priorPhotoPreamble = "", priorContextNote = "", knownIdentityNote = "", isReturning = false } = {}) {
  const summaryInstruction = [
    identificationInstruction, certaintyFirewallInstruction, opportunitiesInstruction,
    evidenceConstraintInstruction, visionApproachesInstruction, keyChangesInstruction,
    suggestedAdditionTypesInstruction, proTipInstruction, prohibitionsInstruction,
  ].join("\n\n");
  return `${priorPhotoPreamble}You are a warm expert home organizer. Analyze ${isReturning ? "today's" : "this"} photo of a space.\n\n${scopeClassificationInstruction}\n\n${summaryInstruction}${priorContextNote}${knownIdentityNote}\n\nNever use em dashes (—) anywhere in your response; use a comma, period, or parentheses instead.\n\n${roomAreaInstruction}${SUMMARY_JSON_TAIL}`;
}

// Renders Call 1's own output back as JSON rather than as prose about it -
// the shape the model already knows how to read, and unambiguous about what
// is settled. Accepts either the raw parsed summary or a saved plan document
// (the resume path reads Firestore), hence the dual field names.
function renderEstablishedAnalysis(summary) {
  const one = (id) => {
    const a = (summary.approaches || {})[id] || {};
    return "  " + JSON.stringify(id) + ": {\n"
      + '    "strategyDescription": ' + JSON.stringify(a.strategyDescription ?? "") + ",\n"
      + '    "keyChanges": ' + JSON.stringify(a.keyChanges || []) + ",\n"
      + '    "suggestedAdditionTypes": ' + JSON.stringify(a.suggestedAdditionTypes || []) + "\n  }";
  };
  return "ESTABLISHED ANALYSIS (already shown to the user):\n{\n"
    + '  "roomName": ' + JSON.stringify(summary.suggestedRoomName ?? summary.spaceName ?? summary.spaceType ?? null) + ",\n"
    + '  "areaName": ' + JSON.stringify(summary.suggestedAreaName ?? summary.areaName ?? null) + ",\n"
    + '  "areaScope": ' + JSON.stringify(summary.areaScope ?? null) + ",\n"
    + '  "scopeSize": ' + JSON.stringify(summary.scopeSize ?? null) + ",\n"
    + '  "overview": ' + JSON.stringify(summary.overview ?? "") + ",\n"
    + '  "itemsFound": ' + JSON.stringify(summary.itemsFound || []) + ",\n"
    + '  "problemsFound": ' + JSON.stringify(summary.problemsFound || []) + ",\n"
    + '  "approaches": {\n' + APPROACH_ORDER.map(one).join(",\n") + "\n  }\n}";
}

// CALL 2. Text only - no image is attached by the caller.
function buildDetailPrompt(summary) {
  return [
    "You are a warm expert home organizer, continuing work you have already begun on one specific space.",
    ESTABLISHED_CONTRACT,
    NO_PHOTO_CLAUSE,
    renderEstablishedAnalysis(summary),
    "Now write the DETAIL for each of the three approaches.",
    certaintyFirewallInstruction,
    evidenceConstraintInstruction,
    taskDifferentiationInstruction,
    productInstruction,
    ADDITIONS_CONSISTENCY,
    visualizationDirectionInstruction,
    spendCalibrationInstruction,
    prohibitionsInstruction,
    "Never use em dashes (—) anywhere in your response; use a comma, period, or parentheses instead.",
    DETAIL_JSON_TAIL,
  ].join("\n\n");
}



// Product Grounding schema (2026-08-11): a recommendation may cite zero or
// more problemsFound ids AND/OR a free-text `grounding` observation, which
// replaces the old single mandatory `relatedProblemId`. Plans saved before
// this change carry the singular field; this is the one place that
// difference is flattened, exactly as normalizeItemsFound does for the
// itemsFound shape change. Pure and tolerant - a malformed entry degrades
// to an empty id list rather than throwing.
//
// The three valid states the prompt enforces:
//   ids non-empty, grounding null  -> solves one or more named problems
//   ids empty,     grounding set   -> optional enhancement, evidence cited
//   ids empty,     grounding null  -> INVALID (ungrounded filler)
// The invalid state is not filtered out here: rendering it as a bare
// reason line is more honest than silently dropping a recommendation the
// model actually returned, and `isUngrounded` lets a future validation
// pass surface it rather than hiding it.
// [PI-RESOLVER-START] - scripts/coverageAnalysis.js extracts everything
// between this marker and [PI-RESOLVER-END] and evaluates it in Node, so the
// coverage tool measures the EXACT production resolver rather than a copy
// that silently drifts. Everything in this region must stay pure: no React,
// no imports, no module-scope side effects.
function normalizeProductRecommendation(rec) {
  if (!rec || typeof rec !== "object") return null;
  const ids = Array.isArray(rec.relatedProblemIds)
    ? rec.relatedProblemIds.filter((id) => typeof id === "string" && id.trim())
    : (typeof rec.relatedProblemId === "string" && rec.relatedProblemId.trim() ? [rec.relatedProblemId.trim()] : []);
  const grounding = typeof rec.grounding === "string" && rec.grounding.trim() ? rec.grounding.trim() : null;
  // shortReason (Call 2 schema, 2026-08-16). Optional by construction: every
  // plan written before this field existed, and every summary-ready plan whose
  // Call 2 has not returned yet, simply has no shortReason - normalized to null
  // so the card's fallback branch is a plain null check rather than a
  // typeof-guard at the render site.
  const shortReason = typeof rec.shortReason === "string" && rec.shortReason.trim() ? rec.shortReason.trim() : null;
  return { ...rec, relatedProblemIds: ids, grounding, shortReason, isUngrounded: ids.length === 0 && !grounding };
}
// The line rendered under a product's name. Per the schema above:
// grounding wins when present (it IS the reason for an optional
// enhancement), otherwise the linked problems' own descriptions explain
// what the product is for. `reason` is the fallback - it is still written
// by the AI and is all an older plan has.
function resolveRecommendationReason(rec, problemsFound) {
  if (rec.grounding) return rec.grounding;
  if (rec.relatedProblemIds?.length) {
    const byId = new Map((problemsFound || []).filter((p) => p && p.id).map((p) => [p.id, p.description]));
    const linked = rec.relatedProblemIds.map((id) => byId.get(id)).filter(Boolean);
    if (linked.length) return linked.join(" ");
  }
  return rec.reason || "";
}

// ===========================================================================
// PRODUCT INTELLIGENCE - MULTI-SOURCE RESOLVER
// ProductIntelligenceDesign.md Section 4. Recommendations describe WHAT to
// buy and WHY; this module decides WHERE. Nothing above this boundary knows
// a retailer exists.
//
// The layer split, which is the entire point of the module:
//
//   SOURCE ADAPTER LAYER (below)  owns retrieval, source-specific
//     identifiers, and ALL affiliate URL construction. Each adapter builds
//     its own links its own way - Amazon appends a tag to a search URL, a
//     future Awin adapter would read aw_deep_link straight out of a feed
//     row, a future CJ adapter would call linkCode(pid:). Three
//     incompatible mechanisms; each stays inside its own adapter.
//
//   EVERYTHING ABOVE  sees only a normalized resolution object with an
//     opaque `url` and a `resolverKind` label. It never sees a tag, a
//     tracking parameter, or a source-specific id.
//
// Adding a source is a new object in PRODUCT_SOURCES plus a `canResolve`
// predicate. It requires no change to resolveProductDestination's
// signature, to the returned shape, or to any call site. That is what
// makes this load-bearing rather than decorative.
// ===========================================================================

// The Associates tag lives on the next line and nowhere else in the
// codebase. Grepping the tag literal returns exactly one hit - this
// constant - and AmazonSearchSource is the only thing that reads it.
// Deliberately not repeated in this comment, so that grep stays honest.
const AMAZON_ASSOCIATES_TAG = "uncluttrd20-20";

// Ambition words per approach. These express STYLE AND QUALITY INTENT, not
// price. Deliberately not a dollar filter: a $50-$175 band on Polished
// would exclude the best $42 tray and steer toward a $140 one on the
// authority of a table rather than of the product. The same reasoning
// retired SCOPE_SPEND_TABLE's displayed ranges; re-adding them as invisible
// URL parameters would reintroduce exactly the problem we removed.
//
// Two words per approach, not five: Amazon's relevance degrades as a query
// lengthens, and every added word is another chance to over-narrow. These
// are the two that most change the character of the result set.
const APPROACH_QUERY_INTENT = {
  simple: ["simple", "practical"],
  polished: ["modern", "coordinated"],
  elevated: ["premium", "designer"],
};

// Words that must never be appended even when they appear in the context.
// Room names are the main offender: "dining room tray" is a strictly worse
// Amazon query than "tray" because it matches listing titles that happen to
// say "dining room" rather than the product category the user needs. Only
// context that improves COMMERCIAL relevance is allowed through (see
// CONTEXT_QUERY_HINTS), and a room name almost never does.
const QUERY_STOPWORDS = new Set([
  "room", "living", "dining", "bedroom", "bathroom", "kitchen", "garage",
  "office", "hallway", "entry", "entryway", "basement", "attic", "closet",
  "area", "space", "zone", "section", "corner", "wall", "floor", "surface",
  "the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on",
  "your", "this", "that", "these", "those", "some", "any", "is", "are",
]);

// Context words that DO earn their place in a query because they change
// which product a shopper actually wants. "bar" in "bar tray" is the
// canonical example from the design doc: a credenza bar-zone tray is a
// genuinely different product from a generic tray, and the word narrows
// toward the right thing rather than away from it.
//
// Matched against the problem/grounding/area text, not the room name.
const CONTEXT_QUERY_HINTS = [
  { match: /\bbar\b|\bbarware\b|\bcocktail\b|\bliquor\b|\bwine\b/i, word: "bar" },
  { match: /\bcable\b|\bcord\b|\bwire\b|\bcharg/i, word: "cable" },
  { match: /\bdesk\b|\bworkstation\b/i, word: "desk" },
  { match: /\bpantry\b/i, word: "pantry" },
  { match: /\bunder[- ]?sink\b|\bunder the sink\b/i, word: "under sink" },
  { match: /\bspice\b/i, word: "spice" },
  { match: /\bshoe\b|\bfootwear\b/i, word: "shoe" },
  { match: /\bjewel/i, word: "jewelry" },
  { match: /\bbook\b|\bbooks\b|\bbookshelf\b/i, word: "book" },
  { match: /\bmail\b|\bpaper\b|\bdocument\b|\bfiling\b/i, word: "paper" },
  { match: /\blaundry\b/i, word: "laundry" },
  { match: /\btoy\b|\bkids?\b|\bchildren/i, word: "kids" },
  { match: /\bcraft\b|\bhobby\b|\bart supplies\b/i, word: "craft" },
  { match: /\bbath\b|\btowel\b|\btoiletr/i, word: "bath" },
];

// Deterministic string manipulation - no AI call, no network, no
// randomness. Same context in, same query out, which is what makes test (b)
// meaningful and what lets the coverage tool below reproduce production
// queries exactly.
function buildAmazonSearchQuery(ctx) {
  const base = typeof ctx?.searchTerms === "string" ? ctx.searchTerms.trim() : "";
  if (!base) return "";
  const seen = new Set(
    base.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  );
  const parts = [base];
  const push = (word) => {
    if (!word) return;
    const tokens = word.toLowerCase().split(/\s+/);
    // Never repeat a word the AI already chose, and never contribute a
    // stopword. Multi-word hints ("under sink") count as added only if at
    // least one of their tokens is new.
    if (tokens.every((t) => seen.has(t) || QUERY_STOPWORDS.has(t))) return;
    tokens.forEach((t) => seen.add(t));
    parts.push(word);
  };

  // 1. Context hint, from the WHY rather than the WHERE. Problem text,
  //    grounding, and the AI's own reason are all evidence about what the
  //    product is for; the area name is included because "Bar Cart" or
  //    "Desk Nook" is a user-authored functional label. Room name is
  //    deliberately absent - see QUERY_STOPWORDS.
  const intentText = [ctx.problemText, ctx.grounding, ctx.reason, ctx.areaName, ctx.productType]
    .filter((x) => typeof x === "string" && x.trim())
    .join(" ");
  if (intentText) {
    const hit = CONTEXT_QUERY_HINTS.find((h) => h.match.test(intentText));
    if (hit) push(hit.word);
  }

  // 2. Ambition words. Appended last so the AI's own terms lead the query,
  //    which is what Amazon weights most heavily.
  (APPROACH_QUERY_INTENT[ctx.approachId] || []).forEach(push);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

// --- SOURCE ADAPTER: Amazon search -----------------------------------------
// The only adapter that ships in v1. Serves 100% of recommendations, because
// a search destination can always be constructed from searchTerms alone.
const AmazonSearchSource = {
  resolverKind: "amazon-search-v1",
  retailer: "Amazon",
  // Always true: this is the universal fallback path. A future
  // AwinFeedSource would return true only for productTypes it has catalog
  // coverage for, and would be ordered ahead of this one.
  canResolve: () => true,
  resolve(ctx) {
    // Enrichment is best-effort. If anything in it throws, we still owe the
    // user a working destination - test (h). The bare searchTerms query is
    // exactly what shipped before this module existed, so the floor here is
    // "no worse than the previous behaviour", never "no link".
    let queryUsed = "";
    let enriched = false;
    try {
      queryUsed = buildAmazonSearchQuery(ctx);
      enriched = !!queryUsed && queryUsed !== (ctx.searchTerms || "").trim();
    } catch (e) {
      queryUsed = "";
    }
    if (!queryUsed) {
      queryUsed = (typeof ctx?.searchTerms === "string" && ctx.searchTerms.trim())
        || (typeof ctx?.productType === "string" && ctx.productType.trim())
        || "";
      enriched = false;
    }
    // Affiliate construction, owned entirely by this adapter.
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(queryUsed)}&tag=${AMAZON_ASSOCIATES_TAG}`;
    return {
      resolverKind: this.resolverKind,
      retailer: this.retailer,
      url,
      queryUsed,
      // null for a search destination. A future product-resolving adapter
      // fills this with { name, image, price, ... } and the UI branches on
      // its presence, never on the source's identity.
      productData: null,
      analyticsContext: {
        resolverKind: this.resolverKind,
        retailer: this.retailer,
        queryEnriched: enriched,
        productType: ctx.productType || null,
        approachId: ctx.approachId || null,
        relatedProblemIds: Array.isArray(ctx.relatedProblemIds) ? ctx.relatedProblemIds : [],
        hasGrounding: !!ctx.grounding,
        scopeSize: ctx.scopeSize || null,
      },
    };
  },
};

// Ordered. First adapter whose canResolve() accepts the context wins, so a
// future real-product source is added ABOVE AmazonSearchSource and Amazon
// keeps serving everything it declines. No call site changes.
const PRODUCT_SOURCES = [AmazonSearchSource];

// The module's single public entry point. Everything above this line is
// implementation detail; everything below only ever calls this.
//
// Accepts the normalized recommendation plus the surrounding plan context.
// Tolerates a pre-schema recommendation (old `relatedProblemId` singular is
// normalized by normalizeProductRecommendation before it gets here, and a
// plan with neither field still resolves off searchTerms alone).
function resolveProductDestination(rec, context = {}) {
  const normalized = normalizeProductRecommendation(rec) || {};
  const problems = context.problemsFound || [];
  const byId = new Map(problems.filter((p) => p && p.id).map((p) => [p.id, p.description]));
  const ctx = {
    productType: normalized.productType || "",
    searchTerms: normalized.searchTerms || normalized.searchQuery || "",
    reason: normalized.reason || "",
    grounding: normalized.grounding || null,
    relatedProblemIds: normalized.relatedProblemIds || [],
    problemText: (normalized.relatedProblemIds || []).map((id) => byId.get(id)).filter(Boolean).join(" "),
    approachId: normalized.approachId || context.approachId || null,
    roomName: context.roomName || null,
    areaName: context.areaName || null,
    scopeSize: context.scopeSize || null,
    strategyDescription: context.strategyDescription || null,
  };
  const source = PRODUCT_SOURCES.find((s) => {
    try { return s.canResolve(ctx); } catch (e) { return false; }
  }) || AmazonSearchSource;
  return source.resolve(ctx);
}
// [PI-RESOLVER-END]

const REFERRAL_SOURCES = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "pinterest", label: "Pinterest" },
  { id: "google", label: "Google Search" },
  { id: "friend", label: "Friend/Family" },
  { id: "appstore", label: "App Store Search" },
  { id: "other", label: "Other" },
];


// ── ONBOARDING SCREEN ────────────────────────────────────────
const SLIDES = [
  {
    icon: "DRAWER",
    title: "Meet Uncluttrd",
    subtitle: "More space. More time. More you.",
    desc: "Transform any cluttered space into an organized haven. Any budget, any room, in minutes.",
    bg: "#E6F7EE",
  },
  {
    icon: "📷",
    title: "Snap a Photo",
    subtitle: "Any room, any mess",
    desc: "Take a photo of any room, closet, garage, or office. Uncluttrd's AI reads the space and identifies the best opportunities.",
    bg: "#FBF5EC",
  },
  {
    icon: "✦",
    title: "Get Your Plan",
    subtitle: "Three approaches, endless possibilities",
    desc: "Receive three complete ways to transform the space, from a zero-cost tidy-up to a full redesign, each with its own checklist and recommendations.",
    bg: "#F3EEF9",
  },
  {
    icon: "🛍️",
    title: "Shop the Look",
    subtitle: "Curated products at every price",
    desc: "Every plan includes hand-picked product recommendations with direct product links. One tap and you're ready to transform your room.",
    bg: "#E6F7EE",
  },
];

function OnboardingScreen({ onDone }) {
  const [current, setCurrent] = useState(0);
  const [skipNext, setSkipNext] = useState(false);
  const scrollRef = useRef(null);
  const { width } = Dimensions.get("window");

  const goToSlide = (index) => {
    setCurrent(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const handleNext = () => {
    if (current < SLIDES.length - 1) {
      goToSlide(current + 1);
    } else {
      onDone(skipNext);
    }
  };

  const handleGetStarted = () => {
    onDone(skipNext);
  };

  const handleSkip = () => {
    onDone(skipNext);
  };

  const handleScrollEnd = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    if (index !== current) setCurrent(index);
  };

  const slide = SLIDES[current];

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: slide.bg }]}>
      <StatusBar barStyle="dark-content" />

      {/* Skip button */}
      <View style={s.onboardingTop}>
        <View style={{ flex: 1 }} />
        {current < SLIDES.length - 1 && (
          <TouchableOpacity onPress={handleSkip}>
            <Text style={s.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Slide content (swipeable) */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={16}
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[s.slideContent, { width }]}>
            <View style={[s.slideIconWrap, { backgroundColor: BRAND.white }]}>
              {sl.icon === "DRAWER"
                ? <DrawerIcon size={64} dark={false} />
                : <Text style={s.slideIcon}>{sl.icon}</Text>
              }
            </View>
            <Text style={s.slideTitle}>{sl.title}</Text>
            <Text style={s.slideSubtitle}>{sl.subtitle}</Text>
            <Text style={s.slideDesc}>{sl.desc}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots (tappable too, to match swipe navigation) */}
      <View style={s.dotsRow}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goToSlide(i)}>
            <View style={[s.dot, i === current && s.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>



      {/* Don't show again */}
      <TouchableOpacity style={s.checkRow} onPress={() => setSkipNext(!skipNext)}>
        <View style={[s.checkbox, skipNext && s.checkboxOn]}>
          {skipNext && <Text style={s.checkmark}>✓</Text>}
        </View>
        <Text style={s.checkLabel}>Don't show this again</Text>
      </TouchableOpacity>

      {/* Next / Get Started */}
      <View style={s.onboardingBottom}>
        <TouchableOpacity style={s.ctaBtn} onPress={current === SLIDES.length - 1 ? handleGetStarted : handleNext}>
          <Text style={s.ctaText}>{current === SLIDES.length - 1 ? "Get Started" : "Next"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── AUTH SCREEN ──────────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [referralSource, setReferralSource] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const handleAuth = async () => {
    // Trimmed locally rather than mutating email/password state directly, so
    // the visible TextInput isn't silently altered while the user is still
    // looking at it. A pasted trailing space (common from copy-paste) would
    // otherwise reach Firebase untouched - on the email side that produces
    // "auth/invalid-email", which reads as a wrong/unrelated error since the
    // whitespace itself is invisible in the field.
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    if (!trimmedEmail || !trimmedPassword) { setErr("Please enter your email and password."); return; }
    if (mode === "signup" && !firstName) { setErr("Please enter your first name."); return; }
    if (mode === "signup" && !lastName) { setErr("Please enter your last name."); return; }
    if (trimmedPassword.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setLoading(true); setErr(null);
    try {
      if (mode === "signup") {
        const fullName = [firstName, lastName, suffix].filter(Boolean).join(" ");
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
        await updateProfile(cred.user, { displayName: fullName });
        // isNewSignup: true marks this doc as a genuine new signup, not just
        // a first-ever doc materialization - ensureUserDocument also runs on
        // every auth resolution and would otherwise create this same doc for
        // a legacy user's routine login, which should not trigger a welcome
        // email server-side (see sendWelcomeEmail in functions/index.js).
        await ensureUserDocument(cred.user, { referralSource: referralSource || null, isNewSignup: true });
        // Sign out and back in to force auth state to refresh with new displayName
        await signOut(auth);
        await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
      } else {
        await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
      }
    } catch (e) {
      if (e.code === "auth/email-already-in-use") setErr("An account with this email already exists.");
      else if (e.code === "auth/invalid-email") setErr("Please enter a valid email address.");
      else if (e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") setErr("Incorrect email or password.");
      else if (e.code === "auth/user-not-found") setErr("No account found with this email.");
      else setErr("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setErr("Enter your email above, then tap Forgot Password."); return; }
    setLoading(true); setErr(null);
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      Alert.alert("Check your email", "If an account exists for that email, we've sent a link to reset your password.");
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        // Same message as success. Don't reveal whether an account exists for this email.
        Alert.alert("Check your email", "If an account exists for that email, we've sent a link to reset your password.");
      } else if (e.code === "auth/invalid-email") {
        setErr("Please enter a valid email address.");
      } else {
        setErr("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        {/* Keyboard behaviour for the auth screen - this is ONE screen for
            both login and signup (`mode` only swaps the copy), so both get
            the same treatment.

            keyboardShouldPersistTaps="handled" is the load-bearing change.
            Without it, a tap while the keyboard is open is swallowed to
            dismiss the keyboard, so the primary action needed TWO taps -
            visible but not actionable, which reads as a dead button.

            keyboardDismissMode lets a scroll drag the keyboard away, and the
            logo block below is a tap target that dismisses it. Both dismiss
            the KEYBOARD only and never clear the fields - same principle as
            renderRenameSheet's backdrop. */}
        <ScrollView
          style={s.screenScroll}
          contentContainerStyle={s.authScroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >

          {/* Logo - doubles as the tap-outside-to-dismiss target. */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => Keyboard.dismiss()}
            accessibilityLabel="Dismiss keyboard"
            accessibilityRole="button"
          >
            <View style={s.authLogo}>
              <View style={s.hdrMark}><DrawerIcon size={54} dark={true} /></View>
              <Text style={s.authAppName}>Uncluttrd</Text>
              <Text style={s.authTagline}>More Space. More Time. More You.</Text>
            </View>
          </TouchableOpacity>

          {/* Card */}
          <View style={s.authCard}>
            <Text style={s.authTitle}>{mode === "login" ? "Welcome back" : "Create account"}</Text>
            <Text style={s.authSubtitle}>{mode === "login" ? "Sign in to your account" : "Get started for free"}</Text>

            {mode === "signup" && (
              <>
                <View style={s.inputRow}>
                  <View style={[s.inputWrap, { flex: 1, marginRight: 8 }]}>
                    <Text style={s.inputLabel}>First Name</Text>
                    <TextInput
                      style={s.input}
                      placeholder="First name"
                      placeholderTextColor={BRAND.mist}
                      value={firstName}
                      onChangeText={setFirstName}
                      autoCapitalize="words"
                    />
                  </View>
                  <View style={[s.inputWrap, { flex: 1 }]}>
                    <Text style={s.inputLabel}>Last Name</Text>
                    <TextInput
                      style={s.input}
                      placeholder="Last name"
                      placeholderTextColor={BRAND.mist}
                      value={lastName}
                      onChangeText={setLastName}
                      autoCapitalize="words"
                    />
                  </View>
                </View>
                <View style={[s.inputWrap, { width: 120 }]}>
                  <Text style={s.inputLabel}>Suffix <Text style={{ color: BRAND.mist, fontWeight: "400" }}>(optional)</Text></Text>
                  <TextInput
                    style={s.input}
                    placeholder="Jr, III…"
                    placeholderTextColor={BRAND.mist}
                    value={suffix}
                    onChangeText={setSuffix}
                    autoCapitalize="words"
                  />
                </View>

                <View style={s.inputWrap}>
                  <Text style={s.inputLabel}>How did you hear about Uncluttrd? <Text style={{ color: BRAND.mist, fontWeight: "400" }}>(optional)</Text></Text>
                  <View style={s.referralRow}>
                    {REFERRAL_SOURCES.map(r => (
                      <TouchableOpacity
                        key={r.id}
                        style={[s.referralChip, referralSource === r.id && s.referralChipSel]}
                        onPress={() => setReferralSource(referralSource === r.id ? null : r.id)}
                        accessibilityLabel={`Select ${r.label} as referral source`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: referralSource === r.id }}>
                        <Text style={[s.referralChipText, referralSource === r.id && s.referralChipTextSel]}>{r.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            )}

            <View style={s.inputWrap}>
              <Text style={s.inputLabel}>Email</Text>
              <TextInput
                style={s.input}
                placeholder="you@example.com"
                placeholderTextColor={BRAND.mist}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={s.inputWrap}>
              <Text style={s.inputLabel}>Password</Text>
              <View style={s.passwordRow}>
                <TextInput
                  style={s.passwordInput}
                  placeholder="At least 6 characters"
                  placeholderTextColor={BRAND.mist}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={{ padding: 4 }}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                  accessibilityRole="button">
                  {showPassword
                    ? <EyeOff size={18} color={BRAND.mist} strokeWidth={2.25} />
                    : <Eye size={18} color={BRAND.mist} strokeWidth={2.25} />
                  }
                </TouchableOpacity>
              </View>
            </View>

            {mode === "login" && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                style={{ alignSelf: "flex-end", marginBottom: 12 }}
                accessibilityLabel="Forgot password"
                accessibilityRole="button">
                <Text style={s.forgotPasswordText}>Forgot Password?</Text>
              </TouchableOpacity>
            )}

            {err && <View style={[s.errBox, { flexDirection: "row", alignItems: "center", gap: 8 }]}><AlertTriangle size={16} color="#991B1B" strokeWidth={2.25} /><Text style={s.errText}>{err}</Text></View>}

            <TouchableOpacity style={s.ctaBtn} onPress={handleAuth} disabled={loading} accessibilityLabel={mode === "login" ? "Sign in" : "Create account"} accessibilityRole="button">
              {loading
                ? <ActivityIndicator color="white" />
                : <Text style={s.ctaText}>{mode === "login" ? "Sign In" : "Create Account"}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={s.switchBtn} onPress={() => { setMode(mode === "login" ? "signup" : "login"); setErr(null); }}>
              <Text style={s.switchText}>
                {mode === "login" ? "Don't have an account? " : "Already have an account? "}
                <Text style={s.switchLink}>{mode === "login" ? "Sign up" : "Sign in"}</Text>
              </Text>
            </TouchableOpacity>

            {mode === "signup" && (
              <Text style={s.termsText}>
                By creating an account you agree to our{" "}
                <Text style={s.termsLink} onPress={() => Linking.openURL("https://uncluttrd.app/terms.html")}>Terms of Service</Text>
                {" "}and{" "}
                <Text style={s.termsLink} onPress={() => Linking.openURL("https://uncluttrd.app/privacy.html")}>Privacy Policy</Text>.
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>

  );
}

// ── MAIN APP ─────────────────────────────────────────────────
// ── COMPANION CARD ───────────────────────────────────────────
// Renders the single-action Companion loop, one decision at a time,
// per CompanionDesignPrinciples.md. Purely prop-driven. Placement on
// the results screen is a separate change (Milestone 4).
// Simple visual progress indicator. Grows with batchIndex, capped at 90%
// while the loop is ongoing (open-ended, no fixed "done" from the AI's side).
// The only way this bar ever reaches 100% is the `complete` prop, driven by
// the user's own choice to finish - see CompanionDesignPrinciples.md
// principle 8. That's why this is the one place in the loop that animates:
// the fill to 100% is meant to read as a distinct, earned moment.
function CompanionProgressBar({ batchIndex, complete }) {
  const pct = Math.min(90, 15 + (batchIndex - 1) * 20);
  const widthAnim = useRef(new Animated.Value(pct)).current;

  useEffect(() => {
    if (complete) {
      Animated.timing(widthAnim, { toValue: 100, duration: 700, useNativeDriver: false }).start();
    }
  }, [complete]);

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.companionProgressCaption}>{complete ? "Done" : "Getting closer"}</Text>
      <View style={s.companionProgressTrack}>
        {complete ? (
          <Animated.View style={[s.companionProgressFill, { width: widthAnim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }) }]} />
        ) : (
          <View style={[s.companionProgressFill, { width: `${pct}%` }]} />
        )}
      </View>
    </View>
  );
}

// Default side-by-side before/after view (DecisionLog.md 2026-07-18, retiring
// the drag-to-compare slider). No gesture handling at all - two plain Images,
// tappable to open BeforeAfterInspector for a closer look. This is the entire
// reliability win over the old PanResponder slider: there's no continuous
// touch tracking left to get wrong.
function BeforeAfterStack({ beforeUri, afterUri, height = 160, onPress }) {
  if (!beforeUri || !afterUri) return null;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={() => onPress?.("before")}>
        <View style={[s.beforeAfterStackWrap, { height }]}>
          <Image source={{ uri: beforeUri }} style={s.beforeAfterStackImage} resizeMode="cover" />
          <Text style={s.beforeAfterStackLabel}>BEFORE</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.85} onPress={() => onPress?.("after")}>
        <View style={[s.beforeAfterStackWrap, { height }]}>
          <Image source={{ uri: afterUri }} style={s.beforeAfterStackImage} resizeMode="cover" />
          <Text style={s.beforeAfterStackLabel}>AFTER</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

// Fullscreen "look closer" view, opened by tapping either image in
// BeforeAfterStack. Purely discrete state (which segment is selected) plus an
// Animated.timing opacity crossfade - no PanResponder/gesture-handler
// anywhere, so it doesn't inherit the old slider's frozen-closure or
// gesture-stealing-parent bug class. Opacity-only means this can run on the
// native driver too, unlike the old slider's width/position animation.
function BeforeAfterInspector({ visible, beforeUri, afterUri, initialTab, onClose }) {
  const [tab, setTab] = useState(initialTab || "after");
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    const startTab = initialTab || "after";
    setTab(startTab);
    fade.setValue(startTab === "after" ? 1 : 0);
  }, [visible, initialTab]);

  const selectTab = (next) => {
    if (next === tab) return;
    setTab(next);
    Animated.timing(fade, { toValue: next === "after" ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  };

  if (!beforeUri || !afterUri) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.inspectorBackdrop}>
        <TouchableOpacity style={s.inspectorClose} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button">
          <X size={20} color="white" strokeWidth={2.25} />
        </TouchableOpacity>
        <View style={s.inspectorImageArea}>
          <Image source={{ uri: beforeUri }} style={s.inspectorImage} resizeMode="contain" />
          <Animated.Image source={{ uri: afterUri }} style={[s.inspectorImage, s.inspectorImageOverlay, { opacity: fade }]} resizeMode="contain" />
        </View>
        <View style={s.inspectorSegmentRow}>
          <TouchableOpacity style={[s.inspectorSegment, tab === "before" && s.inspectorSegmentActive]} onPress={() => selectTab("before")}>
            <Text style={[s.inspectorSegmentText, tab === "before" && s.inspectorSegmentTextActive]}>Before</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.inspectorSegment, tab === "after" && s.inspectorSegmentActive]} onPress={() => selectTab("after")}>
            <Text style={[s.inspectorSegmentText, tab === "after" && s.inspectorSegmentTextActive]}>After</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function CompanionCard({
  stage, tipIndex, batchIndex, completionReason,
  onUpgrade, onChooseFinish, onChooseContinue,
}) {
  // "reveal" is its own full-screen CompanionRevealModal, and "batch-active"
  // is its own BatchChecklist component - neither renders here (see the
  // results screen render for why: the reveal's before/after comparison
  // deserves more room than this card's single-title-single-body shape, and
  // a checklist needs its own layout rhythm). "finished" goes straight to
  // CompanionCompletedSummary in this card's place - no "project-complete"
  // transitional stage anymore (DecisionLog.md 2026-07-19; "This feels
  // finished" now leads directly into the full celebration, not a second
  // tap first).
  if (stage === "finished" || stage === "reveal" || stage === "batch-active") return null;

  const GENERATING_TIPS = [
    "Looking at what's changed...",
    "Comparing against where you started...",
    "Noticing your progress...",
    "Almost got it...",
  ];

  if (stage === "generating") {
    return (
      <View style={s.companionCard}>
        <View style={{ alignItems: "center", paddingVertical: 8 }}>
          <ActivityIndicator color={BRAND.green} />
          <Text style={s.companionTipText}>{GENERATING_TIPS[tipIndex % GENERATING_TIPS.length]}</Text>
        </View>
      </View>
    );
  }

  if (stage === "paywall-prompt") {
    return (
      <View style={s.companionCard}>
        <Text style={s.companionTitle}>Ready to keep going?</Text>
        <Text style={s.companionBody}>Upgrading keeps this going. New steps, saved as you go.</Text>
        <TouchableOpacity style={s.companionBtn} onPress={onUpgrade}>
          <Text style={s.companionBtnText}>Upgrade</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // The AI recommends finishing, but never decides it - see
  // CompanionDesignPrinciples.md principle 8. Both buttons use the same
  // style/size on purpose: neither is the "default" choice.
  if (stage === "completion-choice") {
    return (
      <View style={s.companionCard}>
        <CompanionProgressBar batchIndex={batchIndex} />
        <Text style={s.companionTitle}>This is looking good</Text>
        <Text style={s.companionBody}>{completionReason}</Text>
        {/* Explicit no-arg call, not onPress={onChooseFinish} directly -
            TouchableOpacity's onPress passes a GestureResponderEvent as the
            first argument, which would otherwise land in
            handleCompanionChooseFinish's `source` parameter instead of its
            "completion_choice" default. */}
        <TouchableOpacity style={s.companionBtn} onPress={() => onChooseFinish()}>
          <Text style={s.companionBtnText}>This feels finished</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.companionBtn, { marginTop: 10 }]} onPress={onChooseContinue}>
          <Text style={s.companionBtnText}>Make one more improvement</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

// The batch checklist itself (stage "batch-active"). Intro framing line
// precedes the list every time a new batch is shown (DecisionLog.md
// 2026-07-18) - plain checkboxes, no progress counters, no per-item
// start/stop ceremony, just toggle what's true. Continue and Pause are
// visually distinct (Pause is a secondary/lower-emphasis action) since
// they mean different things - "plan my next session" vs. "remember where
// I left off" - even though the underlying mechanics converge on the same
// review + photo flow.
function BatchChecklist({ items, batchIndex, onToggleItem, onContinue, onPause, onLikeItAsIs }) {
  return (
    <View style={s.companionCard}>
      <CompanionProgressBar batchIndex={batchIndex} />
      <Text style={s.companionTitle}>Let's Work On These</Text>
      <Text style={s.companionBody}>Let's make a little more progress. Start wherever you'd like - you don't need to finish everything today.</Text>
      <View style={{ marginTop: 4, marginBottom: 4 }}>
        {items.map(item => {
          const checked = item.status === "checked";
          return (
            <TouchableOpacity
              key={item.id}
              style={s.batchItemRow}
              onPress={() => onToggleItem(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
            >
              <View style={[s.batchItemCheckbox, checked && s.batchItemCheckboxChecked]}>
                {checked && <Check size={14} color="white" strokeWidth={3} />}
              </View>
              <Text style={[s.batchItemText, checked && s.batchItemTextChecked]}>{item.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity style={s.companionBtn} onPress={onContinue}>
        <Text style={s.companionBtnText}>Show me what you got done</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.companionSecondaryBtn} onPress={onPause}>
        <Text style={s.companionSecondaryBtnText}>That's enough for today</Text>
      </TouchableOpacity>
      {/* Tertiary, deliberately quieter than Pause - permanent completion
          override, not the common/expected action Pause is (DecisionLog.md
          2026-07-18). Bypasses the AI's completion recommendation entirely,
          matching this project's "completion is a user decision, informed
          by AI, not imposed" philosophy actually reaching the UI. */}
      <TouchableOpacity style={s.companionTertiaryBtn} onPress={onLikeItAsIs}>
        <Text style={s.companionTertiaryBtnText}>I like it as-is</Text>
      </TouchableOpacity>
    </View>
  );
}

// Full-screen wrap-up, replacing the old UnresolvedItemsReview modal
// (DecisionLog.md 2026-07-19 - reframed from "what should I do with
// these?" to a natural session conclusion). Shared by both Continue and
// Pause when something's unresolved - `source` ("continue"|"pause") only
// changes the framing/CTA copy and what happens after resolution (photo
// sheet vs. save+home); the underlying carried/skipped data model is
// unchanged. Leads with what got done (celebration, unconditional) before
// ever mentioning what's left - ordering is deliberate, not incidental.
// No single-vs-multi-item branch anymore (the old component's bespoke
// single-item heading/box) - the celebration-first structure reads fine
// at any count, so that special case is gone, not preserved as dead code.
function CompanionWrapUp({ items, checkedCount, source, onResolve, onCancel }) {
  const [resolved, setResolved] = useState({});
  const [reasonOpenFor, setReasonOpenFor] = useState(null);
  const pending = items.filter(item => !resolved[item.id]);
  const isPause = source === "pause";

  // Unlike the old modal, this doesn't auto-fire onResolve the instant every
  // item has a decision - it's a real page now, not a quick popup, so the
  // bottom CTA (enabled only once allResolved) is the deliberate final step
  // rather than the screen silently advancing out from under the user.
  const resolveItem = (next) => {
    setReasonOpenFor(null);
    setResolved(next);
  };

  const keepForNextTime = (itemId) => resolveItem({ ...resolved, [itemId]: { action: "carried" } });

  // Reason capture stays a lightweight, optional tap-through (never a text
  // field) - framed as helping the AI plan better next time, never a
  // scolding. Inline expandable selector under the item now, not a native
  // Alert.alert - a popup felt like an interruption on what's meant to read
  // as a calm page, not a modal-over-modal. Presentation only - `value`
  // stays the original stored/logged string (batch_item_skipped's `reason`
  // analytics property depends on it; changing it would split that
  // dimension's historical data between old and new wording for the same
  // underlying concept). Only `label`, what the user actually sees, is new.
  const REMOVE_REASONS = [
    { label: "Already done", value: "not applicable" },
    { label: "Don't want to do this", value: "changed my mind" },
    { label: "Not worth the effort", value: "too hard" },
    { label: "Other", value: null },
  ];
  const toggleReasonPicker = (itemId) => setReasonOpenFor(prev => (prev === itemId ? null : itemId));
  const chooseReason = (itemId, reason) => resolveItem({ ...resolved, [itemId]: { action: "skipped", reason } });

  const keepAllForNextTime = () => {
    const next = {};
    items.forEach(item => { next[item.id] = { action: "carried" }; });
    onResolve(next);
  };

  const allResolved = pending.length === 0;
  const ctaLabel = isPause ? "Save and finish for today" : "Continue";

  // CTA reward animation - a color fade plus a small scale pop when the
  // review finishes, not just an instant enabled/disabled style swap
  // (DecisionLog.md 2026-07-19). Color needs useNativeDriver: false (not
  // supported by the native driver); the scale pop runs on the native
  // driver since transform is.
  const ctaColorAnim = useRef(new Animated.Value(0)).current;
  const ctaScaleAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(ctaColorAnim, { toValue: allResolved ? 1 : 0, duration: 400, useNativeDriver: false }).start();
    if (allResolved) {
      Animated.sequence([
        Animated.timing(ctaScaleAnim, { toValue: 1.06, duration: 160, useNativeDriver: true }),
        Animated.spring(ctaScaleAnim, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]).start();
    }
  }, [allResolved]);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" />
      <View style={[s.hdr, { alignItems: "flex-start" }]}>
        <TouchableOpacity onPress={onCancel} style={{ padding: 8 }} accessibilityLabel="Back to checklist" accessibilityRole="button">
          <ChevronLeft size={26} color="rgba(255,255,255,0.9)" strokeWidth={2.25} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>
      <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
        <View style={s.wrapUpCard}>
          {/* Celebration renders first, always, regardless of source or how
              many items are pending - the win comes before the ask. "Nice
              work today!" heading stays; everything below it is the leaner
              structure (DecisionLog.md 2026-07-19) - "You made meaningful
              progress" dropped as redundant now that the remaining-count
              line and the global explanation carry that weight instead. */}
          <Text style={s.wrapUpCelebrationTitle}>Nice work today!</Text>
          <View style={s.wrapUpCelebrationRow}>
            <Check size={16} color={BRAND.green} strokeWidth={3} />
            <Text style={s.wrapUpCelebrationText}>{checkedCount} {checkedCount === 1 ? "task" : "tasks"} completed</Text>
          </View>
          {/* Remaining count colored green to match the completed count -
              reframes both numbers as parts of the same session, not a
              success/problem split (DecisionLog.md 2026-07-19). */}
          <Text style={[s.companionTitle, { marginTop: 6 }]}>
            {allResolved ? (
              "All set."
            ) : pending.length === 1 ? (
              <><Text style={s.wrapUpRemainingCount}>One</Text> thing left. No rush.</>
            ) : (
              <><Text style={s.wrapUpRemainingCount}>{pending.length}</Text> things left. No rush.</>
            )}
          </Text>
          {/* One global line, not repeated per item. */}
          {!allResolved && (
            <Text style={s.companionBody}>We'll include anything you keep in a future organizing session.</Text>
          )}
          {pending.map(item => (
            <View key={item.id} style={s.reviewItemBlock}>
              <Text style={s.reviewItemText}>{item.text}</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {/* Keep is the expected default (filled/primary); Remove
                    stays easily available but visually secondary
                    (outlined) - DecisionLog.md 2026-07-19. */}
                <TouchableOpacity style={s.reviewItemBtnPrimary} onPress={() => keepForNextTime(item.id)}>
                  <Text style={s.reviewItemBtnPrimaryText}>Keep</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.reviewItemBtnOutline} onPress={() => toggleReasonPicker(item.id)}>
                  <Text style={s.reviewItemBtnOutlineText}>Remove</Text>
                </TouchableOpacity>
              </View>
              {reasonOpenFor === item.id && (
                <View style={s.wrapUpReasonBox}>
                  <Text style={s.wrapUpReasonLabel}>Why?</Text>
                  {REMOVE_REASONS.map(r => (
                    <TouchableOpacity key={r.label} style={s.wrapUpReasonRow} onPress={() => chooseReason(item.id, r.value)}>
                      <View style={s.wrapUpReasonDot} />
                      <Text style={s.wrapUpReasonText}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          ))}
          {pending.length > 1 && (
            <TouchableOpacity style={[s.companionSecondaryBtn, { marginTop: 6 }]} onPress={keepAllForNextTime}>
              <Text style={s.companionSecondaryBtnText}>Keep everything for next time</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      <View style={s.wrapUpFooter}>
        <AnimatedTouchable
          style={[
            s.companionBtn,
            {
              backgroundColor: ctaColorAnim.interpolate({ inputRange: [0, 1], outputRange: [BRAND.stone, BRAND.green] }),
              transform: [{ scale: ctaScaleAnim }],
            },
          ]}
          disabled={!allResolved}
          onPress={() => onResolve(resolved)}
        >
          <Text style={s.companionBtnText}>{ctaLabel}</Text>
        </AnimatedTouchable>
      </View>
    </SafeAreaView>
  );
}

// Full-screen reveal, replacing the old inline card so the before/after
// comparison gets real screen space instead of a cramped 260px strip inside
// a scrolling card. Uses BeforeAfterStack/BeforeAfterInspector (DecisionLog.md
// 2026-07-18, retiring the old drag-to-compare slider) - tap either image to
// look closer, no gesture handling. onDismiss is used by both the close
// affordance and the continue button - closing and continuing are the same
// transition here, there's nothing to "cancel back" to once the progress
// photo is already in.
function CompanionRevealModal({ visible, batchIndex, beforeUri, afterUri, visibleChangeText, revealReady, onDismiss }) {
  // Per-batch reveal only - copy/framing here is intentionally unchanged by
  // the completion redesign (DecisionLog.md 2026-07-18). This fires after
  // every batch, not just the one that leads to project completion, so it
  // stays scoped to "here's what changed this session," not a celebration.
  const [inspectTab, setInspectTab] = useState(null);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDismiss}>
      <SafeAreaView style={s.revealModalSafe}>
        <View style={s.revealModalHeader}>
          <TouchableOpacity style={s.revealModalClose} onPress={onDismiss} accessibilityLabel="Close" accessibilityRole="button">
            <X size={18} color={BRAND.ink} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <View style={s.revealModalProgressWrap}>
          <CompanionProgressBar batchIndex={batchIndex} />
        </View>
        <View style={s.revealModalImageArea}>
          <BeforeAfterStack beforeUri={beforeUri} afterUri={afterUri} height={260} onPress={setInspectTab} />
        </View>
        <View style={s.revealModalFooter}>
          <Text style={s.revealModalHint}>Tap a photo to look closer</Text>
          <Text style={s.companionVisibleChangeText}>{visibleChangeText}</Text>
          {revealReady ? (
            <TouchableOpacity style={s.companionBtn} onPress={onDismiss}>
              <Text style={s.companionBtnText}>Ready to keep going?</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ height: 51 }} />
          )}
        </View>
        <BeforeAfterInspector visible={!!inspectTab} beforeUri={beforeUri} afterUri={afterUri} initialTab={inspectTab} onClose={() => setInspectTab(null)} />
      </SafeAreaView>
    </Modal>
  );
}

// Backstop for the AI's own free-form output - the analyzePhoto and
// generateNextAction prompts both explicitly forbid em dashes, but this
// catches any that slip through anyway. A comma reads naturally in the
// large majority of sentences an em dash actually appears in.
function stripEmDashes(text) {
  if (typeof text !== "string") return text;
  // Covers the real em dash plus the most likely lookalikes a model can
  // emit for the same purpose (horizontal bar, doubled hyphen used as a
  // plain-text stand-in). Deliberately excludes the en dash (–) alone -
  // that has legitimate uses in number ranges (e.g. "50-200") and banning
  // it would risk mangling text the prompt never asked to avoid.
  return text.replace(/\s*(—|―|--)\s*/g, ", ").replace(/,(\s*,)+/g, ",").trim();
}

// Recursively applies stripEmDashes to every string in a parsed AI JSON
// response (nested arrays/objects included, e.g. tiers[].suggestions[]),
// since any free-form field the model wrote is equally exposed.
function sanitizeAiText(value) {
  if (typeof value === "string") return stripEmDashes(value);
  if (Array.isArray(value)) return value.map(sanitizeAiText);
  if (value && typeof value === "object") {
    const out = {};
    for (const key in value) out[key] = sanitizeAiText(value[key]);
    return out;
  }
  return value;
}

// Handles both a Firestore Timestamp (has .toDate()) and a plain Date/ISO
// string - the latter is what's used for the instant right after the user
// finishes, before the serverTimestamp() write round-trips back into results.
function formatCompletedDate(value) {
  if (!value) return null;
  const d = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Permanent summary shown on the results screen once the whole project is
// finished, replacing CompanionCard in its place (see the results screen
// render). Not full-screen like CompanionRevealModal - that's a one-time
// "come look at this" moment; this is a persistent section on an
// already-scrolling page, so it stays compact. This is the actual
// "celebrate the accomplishment" screen the completion redesign is about
// (DecisionLog.md 2026-07-18) - headline + accomplishments list are new,
// task count is demoted to small supporting text, no elapsed time anywhere.
function CompanionCompletedSummary({ completedAt, reason, headline, accomplishments, taskCount, beforeUri, currentUri }) {
  const dateText = formatCompletedDate(completedAt);
  const [inspectTab, setInspectTab] = useState(null);
  const hasAccomplishments = Array.isArray(accomplishments) && accomplishments.length > 0;
  return (
    <View style={s.companionCard}>
      <CompanionProgressBar batchIndex={1} complete />
      <View style={s.completedBadgeRow}>
        <View style={s.completedBadge}>
          <Check size={12} color="white" strokeWidth={3} />
          <Text style={s.completedBadgeText}>Completed</Text>
        </View>
        {dateText && <Text style={s.completedDateText}>{dateText}</Text>}
      </View>
      {headline ? (
        <Text style={s.completedHeadline}>{headline}</Text>
      ) : (
        // Fallback for plans finished before this redesign shipped - no
        // headline/accomplishments were ever generated/persisted for them.
        reason ? <Text style={s.companionBody}>{reason}</Text> : null
      )}
      {hasAccomplishments && (
        <View style={s.completedAccomplishmentsList}>
          {accomplishments.map((item, i) => (
            <View key={i} style={s.completedAccomplishmentRow}>
              <Check size={13} color={BRAND.green} strokeWidth={2.5} />
              <Text style={s.completedAccomplishmentText}>{item}</Text>
            </View>
          ))}
        </View>
      )}
      {typeof taskCount === "number" && taskCount > 0 && (
        <Text style={s.completedTaskCountText}>{taskCount} {taskCount === 1 ? "task" : "tasks"} completed</Text>
      )}
      {beforeUri && currentUri && (
        <View style={s.completedBeforeAfterArea}>
          <BeforeAfterStack beforeUri={beforeUri} afterUri={currentUri} height={200} onPress={setInspectTab} />
        </View>
      )}
      <BeforeAfterInspector visible={!!inspectTab} beforeUri={beforeUri} afterUri={currentUri} initialTab={inspectTab} onClose={() => setInspectTab(null)} />
    </View>
  );
}

function MainApp({ user, isPro, setIsPro, analyses, setAnalyses, setSkipPref, revenueCatLinkedRef }) {
  const [photo, setPhoto] = useState(null);
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const [showMenu, setShowMenu] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  // Dev-only Space shadow inspector (Slice 2) - never shown outside __DEV__,
  // see the menu entry below and the screen render block near showFaq.
  const [showSpaceInspector, setShowSpaceInspector] = useState(false);
  const [inspectorUidInput, setInspectorUidInput] = useState("");
  const [inspectorPlanIdInput, setInspectorPlanIdInput] = useState("");
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorResult, setInspectorResult] = useState(null);
  const [inspectorError, setInspectorError] = useState(null);
  // §12 Migration Part 3, Pass 2 - merge-proposal review screen
  // (MergeProposalDesign.md). showMergeReview reuses the Space
  // Inspector's screen shape; see the render block near showSpaceInspector
  // and the menu entry below. mergeBannerDismissedThisSession is set only
  // by an explicit "Not Now"/"Not sure yet" action - simply opening the
  // review screen and navigating back does NOT count as a durable
  // decision and must not hide the banner (MergeProposalDesign.md
  // Section 3 / this pass's explicit test (b)).
  const [showMergeReview, setShowMergeReview] = useState(false);
  const [mergeBannerDismissedThisSession, setMergeBannerDismissedThisSession] = useState(false);
  const [mergeCandidatesLoaded, setMergeCandidatesLoaded] = useState(false);
  const [pendingMergeCandidates, setPendingMergeCandidates] = useState([]);
  const [staleConfirmedCandidates, setStaleConfirmedCandidates] = useState([]);
  const [mergeReviewPlansById, setMergeReviewPlansById] = useState({});
  const [mergeReviewPlansLoading, setMergeReviewPlansLoading] = useState(false);
  const [mergeSelections, setMergeSelections] = useState({}); // candidateId -> Set of selected planIds
  const [mergeActionLoadingId, setMergeActionLoadingId] = useState(null); // candidateId currently mid-write, or null
  // User-Managed Space Identity - rename bottom sheet. renamePlanTarget
  // is { id, currentName } | null; reused from both the merge-review
  // screen's evidence cards and the History screen's row Alert, per Task
  // 6/7's "same bottom sheet, no new mechanism" requirement.
  const [renamePlanTarget, setRenamePlanTarget] = useState(null);
  const [renameSheetValue, setRenameSheetValue] = useState("");
  const [renameSheetSaving, setRenameSheetSaving] = useState(false);
  // Room Rename Validation (2026-08-10): shown INSTEAD OF the immediate
  // rename when the submitted name matches an existing non-retired Room
  // (case-insensitive) other than the one being renamed. null when not
  // showing. { matchedRoom: { id, displayName }, newName, sourceRoomId }.
  // Duplicate names are not prohibited (two legitimate bedrooms) - this is
  // a conscious-choice gate, not a hard block.
  const [renameDuplicateDialog, setRenameDuplicateDialog] = useState(null);
  const [mergeRoomsSaving, setMergeRoomsSaving] = useState(false);
  const [mergeRoomsError, setMergeRoomsError] = useState(null);
  // Area Re-parenting Phase A (AreaReparentingDesign.md §9): which Area's
  // overflow ("...") action sheet is currently open, or null. Distinct
  // from renamePlanTarget - this only decides which action sheet shows;
  // tapping Rename inside it still hands off to the existing
  // openAreaRenameSheet -> renamePlanTarget flow unchanged.
  const [areaActionsFor, setAreaActionsFor] = useState(null);
  // The reusable Room Picker (§9/§10) is shared by Area-move and
  // Room-level move - roomPickerFor's own shape says which flow a
  // selection resolves to: { kind: "area", area, sourceRoomId } or
  // { kind: "room", room }. null means the picker is closed.
  const [roomPickerFor, setRoomPickerFor] = useState(null);
  // Set once a target Room is picked, before the user has confirmed -
  // drives the confirmation dialog. { kind, area?, room?, sourceRoomId?, targetRoom }.
  const [moveConfirmTarget, setMoveConfirmTarget] = useState(null);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [faqOpen, setFaqOpen] = useState(null);
  const [vizImage, setVizImage] = useState({});
  const [currentPlanId, setCurrentPlanId] = useState(null); // Firestore doc id of the plan currently being viewed
  // A ref mirror of currentPlanId, for async work that outlives the render
  // it started in. runDetailCall awaits a ~50s network call and then has to
  // decide whether the plan it just finished is still the one on screen;
  // reading the state variable there reads whatever it was captured as when
  // the function was created, which for a freshly created plan is null.
  // See runDetailCall for the bug this caused.
  const currentPlanIdRef = useRef(null);
  useEffect(() => { currentPlanIdRef.current = currentPlanId; }, [currentPlanId]);
  // The most recent original-photo upload, { planId, photoUrl }. Room
  // confirmation sets `results` only after savePlanToHistory has returned,
  // so the upload has already finished by then and there is no Results
  // object yet for savePlanToHistory to merge into - that path reads it
  // from here instead. See mergeUploadedPhotoUrl.
  const lastPhotoUploadRef = useRef(null);
  // vizImage/vizLoading are keyed by tier id on an old-format plan and by
  // approach id ("simple"/"polished"/"elevated") on a new-format one. The
  // two vocabularies never coexist on a single plan - a plan has tiers or
  // approaches, never both - so one flat map serves both formats.
  const [vizModal, setVizModal] = useState(null); // holds the URL being viewed full-screen
  const [vizModalKey, setVizModalKey] = useState(0);
  const [vizLoading, setVizLoading] = useState({}); // keyed by tier id or approach id, see vizImage above
  // Regeneration errors only. Initial generation still uses an Alert:
  // there is no thumbnail to attach a message to when nothing exists yet.
  const [vizError, setVizError] = useState({});
  // Two-Stage Analysis. detailRunning is keyed by planId (a background
  // resume for one plan must not paint a spinner on another); detailError
  // is scoped to the plan on screen, since that is the only one that has
  // anywhere to show it.
  const [detailRunning, setDetailRunning] = useState({});
  const [detailError, setDetailError] = useState(null);
  const [vizTipIndex, setVizTipIndex] = useState(0);
  const vizTipTimer = useRef(null);

  const VIZ_TIPS = [
    "Analyzing your space dimensions...",
    "Reimagining your layout...",
    "Placing furniture and storage solutions...",
    "Adding finishing details...",
    "Your transformation is almost ready...",
  ];

  const startVizTips = () => {
    setVizTipIndex(0);
    vizTipTimer.current = setInterval(() => {
      setVizTipIndex(prev => (prev + 1) % VIZ_TIPS.length);
    }, 4000);
  };

  const stopVizTips = () => {
    if (vizTipTimer.current) clearInterval(vizTipTimer.current);
  };

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  // My Rooms -> True Room Grouping, Phase A: the authoritative Room list,
  // sourced from users/{uid}/spaces (see loadRooms below) - deliberately
  // separate state from `history` (the capped, plan-level cache). Room
  // Detail (Phase B) reads its own plan list fresh per Room, uncapped, via
  // roomDetailPlans below - `history` remains what rename suggestions,
  // the resumable-plan banner, and PDF share read from. Each entry is a
  // Space document's data plus its own doc id (the canonical Space id /
  // Room id).
  const [rooms, setRooms] = useState([]);
  // Phase C2: Recently Deleted (My Rooms' own section) - populated from
  // the SAME already-fetched allSpaces list loadRooms below reads, not a
  // second query. Only Rooms with a real deletedAt (user soft-delete, not
  // a bare merge tombstone) within the last 30 days.
  const [recentlyDeletedRooms, setRecentlyDeletedRooms] = useState([]);
  // ---- Session Recovery (SessionRecoveryDesign.md) ----
  // Everything below is a TEMPORARY migration surface. When the last
  // unresolved session is classified (and the last soft-deleted one is
  // restored or ages out), the entry point stops rendering and this screen
  // becomes unreachable. Nothing here is a domain object.
  const [unresolvedSessions, setUnresolvedSessions] = useState([]);
  const [deletedSessions, setDeletedSessions] = useState([]);
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  // The session currently being classified, plus where in the flow we are.
  // step: "options" | "room" | "area" | "new-room" | "new-area"
  const [classifyFor, setClassifyFor] = useState(null);
  const [classifyStep, setClassifyStep] = useState(null);
  const [classifyRoom, setClassifyRoom] = useState(null); // chosen target Room while picking an Area
  const [classifyAreas, setClassifyAreas] = useState([]);
  const [classifyName, setClassifyName] = useState("");
  const [classifySaving, setClassifySaving] = useState(false);
  const [classifyError, setClassifyError] = useState(null);
  // Names the destination in the overlay ("Assigning to Kitchen...") rather
  // than a generic "Saving...", so the user can see their choice was the one
  // that registered - the same reason roomConfirmationText exists.
  const [classifyText, setClassifyText] = useState("Filing this session...");
  // Re-entry guard for every Needs Review commit path. A ref, not
  // classifySaving, for exactly the reason completeRoomConfirmation documents:
  // setClassifySaving(true) does not apply until React re-renders, so two taps
  // in the same frame both pass a state check and both run the whole save.
  // classifySession is NOT idempotent across a double-fire - the second call
  // re-reads a plan whose canonicalSpaceId the first already moved, so it takes
  // the "already under the target" branch and reprojects a second time. A ref
  // flips synchronously, so the second tap loses the race even if the overlay
  // has not painted a pixel.
  const classifyInFlightRef = useRef(false);
  const [recoveryReloadKey, setRecoveryReloadKey] = useState(0);
  const [historyItem, setHistoryItem] = useState(null); // viewing a past plan
  // Room Detail screen (My Rooms -> True Room Grouping, Phase B) - replaces
  // the old single-plan Space Detail as the primary destination from My
  // Rooms. Holds only the Room (Space) id, not a copy of the room itself -
  // the header reads the current entry from `rooms` by id on every render,
  // so a rename (which already patches `rooms` in place, see
  // handleSaveRename) is reflected immediately with no separate patch
  // target to keep in sync. roomDetailPlans/roomDetailLoading are the
  // Room's own plan list, loaded fresh per Section 1's verified query
  // whenever roomDetailRoomId changes (see the effect below) - deliberately
  // NOT sourced from `history` (the capped, plan-level cache), since a Room
  // with more visits than that cap would otherwise silently show only some
  // of its own history.
  const [roomDetailRoomId, setRoomDetailRoomId] = useState(null);
  const [roomDetailPlans, setRoomDetailPlans] = useState([]);
  const [roomDetailLoading, setRoomDetailLoading] = useState(false);
  // Area Identity, Phase A: this Room's own durable Areas, loaded fresh
  // whenever roomDetailRoomId changes, same effect-per-Room-change pattern
  // as roomDetailPlans above. Not filtered here by visitCount - the
  // render layer hides a zero-matching-plan Area from the ordinary view
  // (item 5's "hide, don't delete") by simply never rendering a section
  // for an Area with no plans left in roomDetailPlans, not by filtering
  // this array itself.
  const [roomDetailAreas, setRoomDetailAreas] = useState([]);
  // Results -> back -> Room Detail navigation contract (Phase B §5/§3.h):
  // holds the Room id to return to, set ONLY when Results was entered via
  // Room Detail (a prior-visit tap, or Room Detail's own unfinished-work
  // CTA by way of Companion) - null for every other Results entry path
  // (first-time analysis, deep link, Home's resumable-plan banner, etc.),
  // which keeps their existing back-to-Home behavior completely unchanged.
  const [resultsCameFromRoomDetail, setResultsCameFromRoomDetail] = useState(null);
  // Navigation UI Consistency audit: Companion's own back-bar contract.
  // True ONLY when Companion was entered by tapping a button WHILE the
  // user was actually looking at Results (the welcome-back banner, or
  // "Let's Get Started") - not merely whenever `results` happens to be
  // set, which is true for every Companion entry path including ones that
  // skip Results entirely (Home's resumable-plan banner jumps straight
  // there). That distinction is exactly why this needs its own flag
  // rather than being inferred from `results` truthiness: "back to
  // Results" is only a real, previously-visited destination for the two
  // paths that set this true. Never true at the same time as a
  // meaningful resultsCameFromRoomDetail in a way that matters - if both
  // are set (arrived via Room Detail, then also tapped a Results button),
  // the Room Detail destination wins, same "the whole session originated
  // there" reasoning already applied to Results' own back bar.
  const [companionEnteredFromResults, setCompanionEnteredFromResults] = useState(false);
  // Approach Selection Phase B (ApproachSelectionDesign.md Section 4):
  // which of the three approach cards is currently expanded on Results.
  // Local/ephemeral only - never written to Firestore. Free, unlimited
  // browsing between Simple/Polished/Elevated happens entirely here;
  // durable commitment only happens via handleStartThisPlan.
  const [previewApproach, setPreviewApproach] = useState(null);
  const [startingPlan, setStartingPlan] = useState(false);
  // Approach switching (Section 6). switchPickerOpen re-opens the three
  // cards as a chooser; switchingApproach is the id being applied, so only
  // the tapped card shows a spinner.
  const [switchPickerOpen, setSwitchPickerOpen] = useState(false);
  const [switchingApproach, setSwitchingApproach] = useState(null);
  // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1): set by
  // startOrganizeAgain when the user taps "Organize Again" from either
  // entry point (History row, Space Detail's own button) - carries the
  // target Space's id plus the specific plan item navigated from (its
  // data captured once, here, in memory - so it survives that prior plan
  // being deleted before analyze() runs, since nothing re-reads it from
  // Firestore; see analyze()'s prior-context section). null means "this
  // is an ordinary first-time analysis," the default, unchanged path.
  // Consumed and explicitly cleared inside analyze() the moment it's
  // used (success OR an invalid-target-space outcome) - deliberately NOT
  // cleared on an earlier failure (network error, unparseable response),
  // so retrying the same photo after a transient failure still targets
  // the same Space. Also cleared by goHome()/reset(), same as `photo`/
  // `results`/every other in-flight flow flag. Accepted edge case,
  // consistent with how `photo` itself already behaves: if a user starts
  // "Organize Again," cancels the photo picker without picking anything,
  // and - without ever navigating through goHome() in between - later
  // taps the same upload button for an unrelated fresh photo, that photo
  // would still be attached to the earlier target Space. Not guarded
  // against explicitly (doing so would also break the legitimate case of
  // retaking/reselecting a photo mid-Organize-Again, which reuses this
  // exact same button); recoverable in the worst case by
  // validateTargetSpace, since the plan lands under a real, still-valid
  // Space, not a corrupted one.
  const [organizeAgainContext, setOrganizeAgainContext] = useState(null); // { spaceId, areaId, priorItem } | null - areaId (Area Identity, Phase A) is null except for an existing-Area "Organize Again" from Room Detail
  // Room-First Identity, Phase B (supersedes Step 3's single-outcome
  // recognition proposal - RoomFirstIdentityDesign.md §2). Non-null
  // triggers the Room confirmation screen, ahead of Results in the
  // if-chain. Shape while active:
  //   {
  //     routing: <output of routeRoomConfirmation - {outcome, ...}>,
  //     knownRooms: <output of dedupeToKnownRooms - the user's existing Rooms>,
  //     view: "main" | "picker" | "freeform",
  //     pickerContext: null | "b1-decline" | "b2-inside" | "b3-inside" | "c-secondary",
  //     freeformContext: null | "c-tertiary" | "b2-own-zero" | "b2-parent-zero" | "b2-freeform-zero",
  //   }
  // routing.outcome starts as one of "a"/"b1"/"b2"/"b3"/"c" (routeRoomConfirmation's
  // decision); "view"/"pickerContext"/"freeformContext" track in-flow
  // navigation (e.g. tapping "Choose another Room" opens the picker
  // without re-running recognition). Declining outcome (a)/(b1)/(b2)/(b3)
  // falls through by replacing `routing` with { outcome: "c" } in place,
  // matching RoomFirstIdentityDesign.md's own "decline -> outcome (c)"
  // rule for every declinable path.
  // recognitionPendingRef holds { parsed, analysesRemaining } for the
  // duration - a ref, not state, since it doesn't need to trigger its own
  // render, only be available once the user completes confirmation. Both
  // cleared together, always, by whichever of
  // completeRoomConfirmation/goHome/reset fires first - never left set
  // once the screen is no longer showing.
  const [roomConfirmation, setRoomConfirmation] = useState(null);
  const recognitionPendingRef = useRef(null);
  // Controlled input for whichever freeform Room-name entry is currently
  // open (roomConfirmation.freeformContext) - cleared whenever freeform
  // mode closes, opens, or the whole flow resets.
  const [roomFreeformInput, setRoomFreeformInput] = useState("");
  // Room-First Identity, Phase B (Constraint per the task: Phase B does
  // NOT persist anything - Phase C consumes this). Holds the resolved
  // confirmation result object once the user completes any outcome, purely
  // for local display (a preview of what Phase C will eventually save) and
  // for dev inspection - never written to Firestore by Phase B itself.
  const [pendingRoomConfirmationResult, setPendingRoomConfirmationResult] = useState(null);
  // Room-First Identity, Phase C: in-flight save state for the Room
  // confirmation screen. roomConfirmationSaving disables the action
  // buttons while a save is outstanding (prevents a double-tap firing two
  // creates). roomConfirmationError, when set, renders an inline error +
  // retry banner on whichever confirmation view is currently showing -
  // per the task's error-handling contract, a failed save must NOT clear
  // roomConfirmation/recognitionPendingRef, so the user's selection stays
  // intact and "try again" re-attempts without re-doing confirmation.
  const [roomConfirmationSaving, setRoomConfirmationSaving] = useState(false);
  // The overlay caption. One state instead of a hardcoded string because
  // the confirmation flow has two genuinely different waits: saving the
  // plan, and looking up the Room's existing Areas before the Area screen
  // can show. Telling the user which one they are in is the whole point of
  // having an overlay at all.
  const [roomConfirmationText, setRoomConfirmationText] = useState("Setting up your plan...");
  const [roomConfirmationError, setRoomConfirmationError] = useState(null);
  // Holds { resolvedResult, sourceCandidate } for whichever action was
  // last attempted, so retryRoomConfirmation can re-invoke the exact same
  // completeRoomConfirmation call after a failure - a ref, not state,
  // since it doesn't need its own render.
  const lastRoomConfirmationAttemptRef = useRef(null);
  // Synchronous tap guard for the Room confirmation actions. See
  // completeRoomConfirmation for why this is a ref and not state.
  const roomConfirmationInFlightRef = useRef(false);
  // Synchronous tap guards for the three remaining unguarded async commits
  // (ProcessingFeedbackAudit.md, HIGH/MEDIUM findings 1-3). Same contract as
  // the ref above and classifyInFlightRef: a ref flips synchronously, so a
  // second tap in the SAME frame loses the race - which a state flag cannot
  // do, because setState does not apply until React re-renders.
  //   mergeRoomsInFlightRef  - rename-duplicate "move plans into existing"
  //   vizInFlightRef         - keyed by vizKey, so the three approach images
  //                            stay independently generatable
  //   deleteAccountInFlightRef - irreversible, so it gets the same treatment
  const mergeRoomsInFlightRef = useRef(false);
  const vizInFlightRef = useRef(new Set());
  const deleteAccountInFlightRef = useRef(false);
  // Processing-feedback guards (audit MEDIUM items). Each is an independent
  // ref so two different flows can never block one another, and each flips
  // SYNCHRONOUSLY before the first await - a state flag cannot do this job,
  // because setState does not apply until re-render and two taps in the same
  // frame would both read the old value and both proceed.
  const pdfInFlightRef = useRef(false);
  const restoreSessionInFlightRef = useRef(false);
  const restoreRoomInFlightRef = useRef(false);
  const restoreAreaInFlightRef = useRef(false);
  const roomRenameInFlightRef = useRef(false);
  // One overlay text for all of the above. null = no overlay. Reuses the
  // existing ProcessingOverlay rather than introducing a second visual
  // system; only the label differs per flow.
  const [asyncBusyText, setAsyncBusyText] = useState(null);
  // Area Identity, Phase B (AreaRecognitionPhaseBImplementation.md): the
  // Area-level analog of roomConfirmation above - null when not showing,
  // else { status: "MATCH_FOUND" | "RECOGNITION_FAILED", candidates,
  // existingAreas, roomId, view: "main" | "picker" }. NO_MATCH never
  // reaches this state at all (beginAreaConfirmation resolves it
  // immediately, no screen shown - "no unnecessary friction when there
  // genuinely are no matches", per the design doc). Paused here means: the
  // AI photo analysis already completed and Room identity is already
  // confirmed, but NOTHING has been saved yet - the governing invariant
  // (no plan saved until BOTH Room and Area identity are established).
  const [areaConfirmation, setAreaConfirmation] = useState(null);
  const [areaConfirmationSaving, setAreaConfirmationSaving] = useState(false);
  const [areaConfirmationError, setAreaConfirmationError] = useState(null);
  // Holds { saveContinuation } for the in-flight Area confirmation -
  // saveContinuation(areaIntent) is what actually persists the plan, once
  // called with the user's resolved Area identity ({kind:"matched"|"new"|
  // "picked", areaId?}). A ref, not state (mirrors
  // lastRoomConfirmationAttemptRef above) - holds a function, not
  // renderable data, and both of Phase B's entry points (the generic-camera
  // Room confirmation flow and the "Organize Another Area" returning-visit
  // flow) populate it identically before ever showing the proposal screen.
  const areaConfirmationPendingRef = useRef(null);
  // Mirrors lastRoomConfirmationAttemptRef, one level down - lets
  // retryAreaConfirmation re-invoke the exact same completeAreaConfirmation
  // call after a failed save, without re-running recognition again.
  const lastAreaConfirmationAttemptRef = useRef(null);
  // Remembered Home v1 Step 3, Phase D (RememberedHomeDesign.md §4): set
  // only by confirmRecognitionCandidate, read only by the Results screen's
  // own orientation banner. Not a separate timed sequence of screens (5s/
  // 30s/60s) - this app has no existing mechanism for timed UI reveals,
  // and Results already appears within a couple of seconds of confirming
  // (the save happens in the background, same pattern as every other
  // creation path in this file) - so the "Welcome back"/orientation
  // content is combined into one banner rather than staged across
  // separate screens. The "first minute" momentum beat needs no separate
  // code at all: it's simply the checklist Results already renders,
  // already informed by the enriched prompt (Step 2).
  const [justConfirmedRecognition, setJustConfirmedRecognition] = useState(null);
  // Results/Companion screen split (DecisionLog.md 2026-07-18). `results`
  // truthy still gates "we're viewing a plan at all" - this just selects
  // which of the two screens to render within that context. Pure view
  // toggle, no data reload: `results` stays populated switching either way.
  const [showCompanion, setShowCompanion] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallPlan, setPaywallPlan] = useState("yearly");
  // Tags which entry point opened the (single, shared) paywall screen, for the
  // subscription_started source property. Set to "companion" only by the
  // Companion upgrade prompt; reset back to the default whenever the paywall
  // is dismissed without purchasing, so a later unrelated paywall open never
  // inherits a stale "companion" tag. Every other existing entry point never
  // touches this. It's already correct by default.
  const [paywallSource, setPaywallSource] = useState("general_paywall");
  const [purchaseInProgress, setPurchaseInProgress] = useState(false); // tap-guard: a slow native Apple ID prompt shouldn't read as "nothing happened, tap again"
  const [selectedRoom, setSelectedRoom] = useState(null);
  const resultsScrollRef = useRef(null);
  const companionScrollRef = useRef(null);
  const homeScrollRef = useRef(null);
  const [loadMsg, setLoadMsg] = useState(0);
  const loadTimer = useRef(null);

  const LOAD_MESSAGES = [
    "Studying your space layout...",
    "Identifying what needs to stay and what can go...",
    "Selecting storage solutions...",
    "Building three options for your room...",
    "Almost ready...",
  ];

  const startLoadMessages = () => {
    setLoadMsg(0);
    let i = 0;
    loadTimer.current = setInterval(() => {
      i = Math.min(i + 1, LOAD_MESSAGES.length - 1);
      setLoadMsg(i);
    }, 2500);
  };

  const stopLoadMessages = () => {
    if (loadTimer.current) clearInterval(loadTimer.current);
    setLoadMsg(0);
  };
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState(null);

  // Product Intelligence v1 impression tracking. recommendation_shown is an
  // IMPRESSION event, not a render event, so it cannot live in the render
  // path - an approach card re-renders on every unrelated state change and
  // would inflate the count without a single new exposure.
  //
  // The exposure rule, stated once so it stays stable:
  //   ONE event per (planId, approachId, productType), for as long as the
  //   user stays on that plan.
  // Collapsing and re-expanding the same card does NOT re-fire, because the
  // key is already in the set (test e). The set is cleared when currentPlanId
  // changes, so opening a different plan is a fresh exposure session.
  //
  // POSITION IS LOAD-BEARING. This block must stay BELOW the declarations of
  // previewApproach, currentPlanId and results. A dependency array is
  // evaluated during render, not when the effect body runs, so placing this
  // above `results` put those consts in the temporal dead zone and threw
  // "Cannot access 'previewApproach' before initialization" on every render
  // of MainApp - which crashed the app on launch and made expo-updates roll
  // back to the previous bundle. node -c and `expo export` both pass on that
  // code; only running it catches it. See scripts/auditTdz.js.
  const shownRecommendationsRef = useRef(new Set());
  const shownRecommendationsPlanRef = useRef(null);
  useEffect(() => {
    if (shownRecommendationsPlanRef.current !== currentPlanId) {
      shownRecommendationsRef.current = new Set();
      shownRecommendationsPlanRef.current = currentPlanId;
    }
    if (!previewApproach || !results) return;
    const approach = results.approaches?.[previewApproach];
    if (!approach) return;
    // At summary-ready Call 2 has not landed, so there are no product
    // objects to be exposed to yet. The impression belongs to the real
    // recommendation, not to the loading state.
    if (planAnalysisStage(results) === "summary-ready") return;
    (approach.productRecommendations || [])
      .map(normalizeProductRecommendation)
      .filter(Boolean)
      .forEach((rec) => {
        const key = `${currentPlanId}::${previewApproach}::${rec.productType || ""}`;
        if (shownRecommendationsRef.current.has(key)) return;
        shownRecommendationsRef.current.add(key);
        const resolution = resolveProductDestination(rec, {
          approachId: previewApproach,
          problemsFound: results.problemsFound,
          scopeSize: results.scopeSize || null,
        });
        logEvent(getAnalytics(), "recommendation_shown", {
          productType: rec.productType || null,
          approachId: previewApproach,
          relatedProblemIds: (rec.relatedProblemIds || []).join(",") || null,
          resolverKind: resolution.resolverKind,
        });
      });
  }, [previewApproach, currentPlanId, results]);

  // ── Companion loop state ──────────────────────────────────
  // Analytics-only correlator for the free-tier funnel, since free plans are
  // never persisted and so never get a real Firestore planId. Minted once per
  // analysis, never written to Firestore. See Analytics.md / DecisionLog.md
  // 2026-07-13 (Companion Analytics: Event Catalog, Philosophy, and Commerce Reuse).
  const analysisIdRef = useRef(null);
  // Holds { analysisId, photoUri } for the most recent analysis attempt that
  // never succeeded, so a retry of the exact same photo reuses the same
  // analysisId instead of minting a fresh one - the server treats a repeated
  // analysisId as idempotent, so a retry can't consume a second free use.
  // Cleared on success (a completed ID must never be reused - that would just
  // replay the old cached result) and in reset()/goHome().
  const lastFailedAnalysisRef = useRef(null);

  const [companionStage, setCompanionStage] = useState("batch-active"); // batch-active | generating | reveal | paywall-prompt | completion-choice | finished
  // The live, in-progress checklist: [{id, text, status}], status one of
  // "pending" | "checked" | "carried" | "skipped" - carried/skipped are only
  // ever set by the unresolved-items review, never by direct toggling.
  const [batchItems, setBatchItems] = useState([]);
  // Mirrors batchItems for submitCompanionProgressPhoto to read (same
  // established pattern as companionBasePhotoRef/companionOriginalPhotoRef -
  // DecisionLog.md 2026-07-18). Needed because openBatchPhotoSheet is called
  // synchronously right after setBatchItems whenever Continue resolves
  // skip/carry decisions via the wrap-up screen (CompanionWrapUp), and that
  // photo-sheet's native
  // Alert.alert's callbacks (captureCompanionPhoto/pickCompanionPhoto ->
  // submitCompanionProgressPhoto) are permanently bound to that same
  // render's closures - by the time the user actually takes/picks a photo
  // (a real, multi-second delay), reading `batchItems` directly would still
  // return the pre-resolution value, silently dropping whatever was just
  // skipped or carried from that round's own context and from the
  // whole-project skip-exclusion list.
  const batchItemsRef = useRef(batchItems);
  useEffect(() => {
    batchItemsRef.current = batchItems;
  }, [batchItems]);
  // STAGING ONLY, and `undefined` rather than a no-op function on production.
  //
  // The accumulated log carries plan IDs, photo URIs and update IDs, so the
  // share affordance must not exist in a customer's hands. All eleven headers
  // pass this straight to `onLongPress`, so leaving it undefined REMOVES the
  // long-press handler at every one of them from a single place - a no-op
  // function would instead leave eleven live gestures that silently do
  // nothing, which is the harder thing to reason about later. With no
  // `onLongPress`, a long press on the header logo simply behaves like a tap
  // and goes home.
  //
  // Gated here rather than at each header for the same reason: one decision,
  // one place, and no way to add a twelfth header that forgets it. The
  // separate staging-only share button on the confirmation screen is already
  // inside its own `IS_STAGING &&` block, so it is unaffected either way.
  const debugShareLog = IS_STAGING
    ? async () => {
        const text = debugLogBuffer.length ? debugLogBuffer.join("\n\n") : "(no debug log entries captured yet)";
        try {
          await Share.share({ message: text, title: "Companion Debug Log" });
        } catch (e) {
          Alert.alert("Share failed", e.message);
        }
      }
    : undefined;
  // Fires once per mount so a shared log can be matched to the exact OTA
  // update that produced it - confirms whether a given device is actually
  // running the code containing a given fix, not a stale/cached bundle.
  // Updates.updateId/createdAt reflect the actual running bundle (no manual
  // upkeep needed, unlike a hardcoded marker string) - added after a debug
  // session where an expected log line was entirely absent and the running
  // update's identity couldn't be confirmed from the log alone.
  useEffect(() => {
    dlog(`[BUILD DEBUG] MainApp mounted | updateId=${Updates.updateId || "embedded (no OTA update loaded)"} | channel=${Updates.channel || "n/a"} | createdAt=${Updates.createdAt ? Updates.createdAt.toISOString() : "n/a"}`);
  }, []);
  // Fires whenever this state actually settles (not when the setter is called),
  // since setState is async. This is the true post-update value.
  useEffect(() => {
    dlog(`[COMPANION DEBUG 4] batchItems settled to: ${JSON.stringify(batchItems)}`);
  }, [batchItems]);
  const [companionBatchIndex, setCompanionBatchIndex] = useState(1); // 1 = first batch, 2+ = later batches
  const [progressPhoto, setProgressPhoto] = useState(null);
  // Holds the unresolved-items review's data while it's showing: null when
  // hidden, otherwise { items: [...unchecked] }. Only Continue ever opens
  // this now - Pause is a single-tap action straight to Home, no review
  // (DecisionLog.md 2026-07-18).
  const [unresolvedReview, setUnresolvedReview] = useState(null);
  const [companionTipIndex, setCompanionTipIndex] = useState(0);
  const companionTipTimer = useRef(null);
  // Most recent "before" photo used for the next comparison. Set once when
  // results first arrive (fresh analysis) or once a resumed plan's photo (or
  // last progress photo) finishes downloading (see restorePhotoFromPlan) -
  // not just the [results] effect, since that effect fires synchronously on
  // setResults(item), before a resumed session's download has resolved
  // (DecisionLog.md 2026-07-18 - was previously never set on resume at all,
  // leaving submitCompanionProgressPhoto permanently unable to proceed).
  const companionBasePhotoRef = useRef(null);
  // The very first "before" photo for the whole project - unlike
  // companionBasePhotoRef, this never rolls forward. Set once when results
  // first arrive (fresh analysis) or once a resumed plan's photo finishes
  // downloading (see restorePhotoFromPlan) - not just the [results] effect,
  // since that effect can fire before the resumed photo has actually loaded.
  const companionOriginalPhotoRef = useRef(null);
  // Cache of the compressed/base64-encoded original, keyed by the source uri
  // it was built from. The original photo never changes mid-session, so this
  // avoids re-compressing and re-encoding the same image on every single step.
  const companionOriginalCompressedRef = useRef(null); // { uri, base64 }
  // AI-recommended completion signal (see CompanionDesignPrinciples.md
  // principle 8) - the AI can only recommend, never decide. Reset to
  // defaults whenever a new action starts, including "one more improvement."
  const [companionCompletionRecommended, setCompanionCompletionRecommended] = useState(false);
  const [companionCompletionReason, setCompanionCompletionReason] = useState(null);
  // Whole-project celebration copy (DecisionLog.md 2026-07-18) - generated
  // alongside completionReason on every round-trip (cheap, harmless when
  // unused), not a separate AI call at finish time. Distinct from
  // completionReason: that's the AI's judgment of *why* it's recommending
  // finishing (still used by the completion-choice screen), these are
  // triumphant, itemized accomplishments for the post-finish celebration.
  const [companionCompletionHeadline, setCompanionCompletionHeadline] = useState(null);
  const [companionCompletionAccomplishments, setCompanionCompletionAccomplishments] = useState([]);
  // Running total of checked items across the whole project, not read from
  // results.batchHistory at finish time - that array only reflects whatever
  // was persisted when `results` was last set (fresh analysis or reopen) and
  // goes stale the moment a batch is archived mid-session (results is never
  // locally patched after that Firestore write). Seeded from
  // results.batchHistory in the [results] effect, incremented by
  // checkedItems.length each time a batch is actually archived below.
  const completedTaskCountRef = useRef(0);
  // Whole-project "never suggest again" list. Same shape/reasoning as
  // completedTaskCountRef above: batchItems/checklistLines only ever reflect
  // the current round, so an item skipped in batch 1 has already fallen out
  // of context by batch 3 with nothing to stop generateNextAction from
  // re-noticing the same still-visible clutter and re-suggesting it as "new"
  // - a skip means permanently excluded for this project, not just excluded
  // from the immediate next round. Seeded from results.batchHistory, appended
  // to (not replaced) each time a batch is actually archived below.
  const skippedItemTextsRef = useRef([]);
  // Set locally the instant the user chooses to finish, so the completed
  // summary can render immediately without waiting on the Firestore
  // serverTimestamp() write to round-trip back into `results`.
  const [companionCompletedProject, setCompanionCompletedProject] = useState(null); // { completedAt, reason }
  // Before/after reveal (Milestone 8). Populated right before entering the
  // "reveal" stage, cleared on reset/goHome like everything else here.
  const [companionRevealBefore, setCompanionRevealBefore] = useState(null);
  const [companionRevealAfter, setCompanionRevealAfter] = useState(null);
  const [companionVisibleChange, setCompanionVisibleChange] = useState(null);
  const [companionRevealReady, setCompanionRevealReady] = useState(false); // gates the continue button so the user has a beat to register the change first
  const companionRevealTimer = useRef(null);

  const startCompanionTips = () => {
    setCompanionTipIndex(0);
    companionTipTimer.current = setInterval(() => {
      setCompanionTipIndex(prev => prev + 1);
    }, 3000);
  };
  const stopCompanionTips = () => {
    if (companionTipTimer.current) clearInterval(companionTipTimer.current);
  };

  // Initializes or resumes the Companion loop whenever a new plan's results arrive.
  // A reopened saved plan returns the persisted currentBatch shape
  // { batchIndex, suggestedAt, items: [{id, text, status}] } - handled by
  // the branch below, whether old-format (firstActionBatch) or new-format
  // (currentBatch is null until the user explicitly taps "Start This Plan"
  // on Results - see savePlanToHistory and handleStartThisPlan). A fresh
  // new-format analysis has no currentBatch yet, so this effect leaves
  // batchItems empty and Results renders the approach cards instead;
  // Companion isn't populated until handleStartThisPlan seeds it directly.
  useEffect(() => {
    if (!results) return;
    setUnresolvedReview(null);
    // Approach Card Redesign (ApproachCardRedesign.md item 5): a plan the
    // user has already committed to reopens with ITS OWN approach card
    // expanded, so returning to Results shows the plan they chose rather
    // than three equally-collapsed options they have to re-find. An
    // uncommitted plan still opens with everything collapsed (null) - the
    // comparison state. previewApproach remains ephemeral either way; this
    // seeds the expanded card from already-persisted state, it never
    // writes anything.
    setPreviewApproach(results.selectedApproach || null);
    setStartingPlan(false);
    if (results.currentBatch?.items?.length) {
      setCompanionBatchIndex(results.currentBatch.batchIndex || 1);
      setBatchItems(results.currentBatch.items);
      setCompanionStage("batch-active");
      // Only reached when reopening a saved plan (a fresh analysis composes
      // batchItems from the branch below instead, then batch_shown fires
      // from analyze()/completeRoomConfirmation itself). This is a resumed
      // view, not a freshly generated one.
      logEvent(getAnalytics(), "batch_shown", { planId: currentPlanId, batchIndex: results.currentBatch.batchIndex || 1 });
    } else {
      setBatchItems([]);
    }
    // A resumed plan that was already finished should land straight on the
    // completed summary, not reopen mid-loop - "finished" is what makes the
    // checklist render nothing, and CompanionCompletedSummary (gated on
    // results.companionComplete / companionCompletedProject) takes its place.
    if (results.companionComplete) {
      setCompanionStage("finished");
    }
    setCompanionCompletionRecommended(false);
    setCompanionCompletionReason(null);
    setCompanionCompletionHeadline(null);
    setCompanionCompletionAccomplishments([]);
    completedTaskCountRef.current = Array.isArray(results.batchHistory)
      ? results.batchHistory.reduce((sum, batch) => sum + (batch.items || []).filter(i => i.status === "checked").length, 0)
      : 0;
    skippedItemTextsRef.current = Array.isArray(results.batchHistory)
      ? results.batchHistory.flatMap(batch => (batch.items || []).filter(i => i.status === "skipped").map(i => i.text))
      : [];
    setCompanionCompletedProject(null);
    setProgressPhoto(null);
    dlog(`[PHOTO DEBUG] [results] effect: companionBasePhotoRef ${companionBasePhotoRef.current} -> ${photo?.uri || null}`);
    companionBasePhotoRef.current = photo?.uri || null;
    // See restorePhotoFromPlan for why this is also (re)set there - this line
    // alone is correct for a fresh analysis, where `photo` is already loaded
    // synchronously by the time results arrives.
    dlog(`[PHOTO DEBUG] [results] effect: companionOriginalPhotoRef ${companionOriginalPhotoRef.current} -> ${photo?.uri || null}`);
    companionOriginalPhotoRef.current = photo?.uri || null;
    companionOriginalCompressedRef.current = null;
    // Inlined rather than calling a shared helper. That helper is declared
    // later in this function (near reset/goHome), and referencing it from an
    // effect this early would reintroduce the exact TDZ bug already fixed once.
    if (companionRevealTimer.current) clearTimeout(companionRevealTimer.current);
    setCompanionRevealBefore(null);
    setCompanionRevealAfter(null);
    setCompanionVisibleChange(null);
    setCompanionRevealReady(false);
  }, [results]);

  const toggleBatchItem = (itemId) => {
    setBatchItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const checking = item.status !== "checked";
      logEvent(getAnalytics(), checking ? "batch_step_checked" : "batch_step_unchecked", { planId: currentPlanId, batchIndex: companionBatchIndex, itemId });
      return { ...item, status: checking ? "checked" : "pending" };
    }));
  };

  const openBatchPhotoSheet = () => {
    Alert.alert(
      "Show me what you got done",
      "How would you like to share your progress?",
      [
        { text: "Take Photo", onPress: () => captureCompanionPhoto() },
        { text: "Choose from Camera Roll", onPress: () => pickCompanionPhoto() },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const handleBatchContinueTapped = () => {
    const unchecked = batchItems.filter(i => i.status !== "checked");
    logEvent(getAnalytics(), "batch_continue_tapped", { planId: currentPlanId, batchIndex: companionBatchIndex, checkedCount: batchItems.length - unchecked.length, uncheckedCount: unchecked.length });
    if (unchecked.length === 0) {
      openBatchPhotoSheet();
      return;
    }
    logEvent(getAnalytics(), "batch_item_skip_popup_shown", { planId: currentPlanId, batchIndex: companionBatchIndex, uncheckedCount: unchecked.length });
    setUnresolvedReview({ items: unchecked, source: "continue" });
  };

  // Single-tap action straight to Home when nothing's unresolved - no
  // review, no required photo (DecisionLog.md 2026-07-18, reversing the
  // earlier photo-required design). When there IS something unresolved,
  // Pause now enters the same wrap-up screen Continue uses (DecisionLog.md
  // 2026-07-19, a deliberate scoped update to the 2026-07-18 "Pause is
  // always single-tap" decision) - still never requires a photo either way,
  // that part of the original decision holds.
  const handleBatchPauseTapped = () => {
    const unchecked = batchItems.filter(i => i.status !== "checked");
    if (unchecked.length > 0) {
      setUnresolvedReview({ items: unchecked, source: "pause" });
      return;
    }
    logEvent(getAnalytics(), "batch_session_paused", { planId: currentPlanId, batchIndex: companionBatchIndex });
    if (currentPlanId) {
      updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), { "currentBatch.items": batchItems, shadowSourceVersion: increment(1) })
        .then(() => {
          syncPlanToSpaceGraph(user.uid, currentPlanId).catch(e => dlog(`[SPACE SHADOW SYNC] pause sync failed for plan ${currentPlanId}: ${e.message}`));
        })
        .catch(e => console.log("Save paused batch state error:", e.message));
    }
    goHome();
  };

  // resolutions: { [itemId]: { action: "carried" | "skipped", reason?: string } }.
  // Post-resolution behavior branches on unresolvedReview.source
  // (DecisionLog.md 2026-07-19): Continue proceeds to the progress-photo
  // sheet as before; Pause now saves currentBatch.items (with these
  // resolutions applied) and goes home, same write handleBatchPauseTapped's
  // zero-unresolved-items shortcut already does, just reached via the
  // wrap-up screen instead of immediately. nextItems is computed explicitly
  // rather than trusting `batchItems` right after setBatchItems - same
  // stale-closure reasoning as batchItemsRef elsewhere, cheap to apply here
  // too since we need the resolved array as a value regardless.
  const handleWrapUpResolve = (resolutions) => {
    const source = unresolvedReview?.source;
    const nextItems = batchItems.map(item => {
      const resolution = resolutions[item.id];
      if (!resolution) return item;
      if (resolution.action === "carried") {
        logEvent(getAnalytics(), "batch_item_marked_not_done", { planId: currentPlanId, batchIndex: companionBatchIndex, itemId: item.id });
        return { ...item, status: "carried" };
      }
      logEvent(getAnalytics(), "batch_item_skipped", { planId: currentPlanId, batchIndex: companionBatchIndex, itemId: item.id, reason: resolution.reason || null });
      return { ...item, status: "skipped", skipReason: resolution.reason || null };
    });
    setBatchItems(nextItems);
    setUnresolvedReview(null);
    if (source === "pause") {
      logEvent(getAnalytics(), "batch_session_paused", { planId: currentPlanId, batchIndex: companionBatchIndex });
      if (currentPlanId) {
        updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), { "currentBatch.items": nextItems, shadowSourceVersion: increment(1) })
          .then(() => {
            syncPlanToSpaceGraph(user.uid, currentPlanId).catch(e => dlog(`[SPACE SHADOW SYNC] wrap-up (pause) sync failed for plan ${currentPlanId}: ${e.message}`));
          })
          .catch(e => console.log("Save paused batch state error:", e.message));
      }
      goHome();
    } else {
      openBatchPhotoSheet();
    }
  };

  const handleCompanionRevealContinue = () => {
    if (companionRevealTimer.current) clearTimeout(companionRevealTimer.current);
    // The AI can recommend finishing, never decide it - see
    // CompanionDesignPrinciples.md principle 8. This just routes to the
    // choice; the outcome is entirely up to the two buttons there.
    if (companionCompletionRecommended) {
      logEvent(getAnalytics(), "companion_completion_prompt_viewed", { planId: currentPlanId, batchIndex: companionBatchIndex });
      setCompanionStage("completion-choice");
    } else {
      setCompanionStage("batch-active");
    }
  };

  const handleCompanionChooseContinue = () => {
    logEvent(getAnalytics(), "companion_continued_past_complete", { planId: currentPlanId, batchIndex: companionBatchIndex });
    // No stale recommendation should carry into the next batch - the next
    // generateNextAction call will judge completion fresh, on its own terms.
    setCompanionCompletionRecommended(false);
    setCompanionCompletionReason(null);
    setCompanionCompletionHeadline(null);
    setCompanionCompletionAccomplishments([]);
    setCompanionStage("batch-active");
  };

  // source: "completion_choice" (default - AI recommended, user agreed via
  // "This feels finished") or "user_override" ("I like it as-is" on the
  // batch-active screen, bypassing an AI recommendation entirely -
  // DecisionLog.md 2026-07-18, the "user decides" half of the completion
  // philosophy actually reaching the UI). companionCompletionReason/Headline/
  // Accomplishments reflect the AI's LAST completion judgment - on the
  // override path that judgment was completionRecommended: false (that's the
  // whole reason the override exists), so its "reason" text explains why the
  // space *isn't* finished. Showing that on a screen celebrating that it now
  // IS finished would be actively contradictory, not just stale - so the
  // override path skips it entirely rather than reusing it. The celebration
  // screen already renders gracefully with no headline/reason (badge + task
  // count + photos only), which reads as honest given there's no real AI
  // judgment behind this completion.
  const handleCompanionChooseFinish = (source = "completion_choice") => {
    const isOverride = source === "user_override";
    // Local timestamp for the immediate UI - CompanionCompletedSummary can
    // render right away without waiting on the serverTimestamp() write below
    // to round-trip back into `results`.
    const completedLocal = {
      completedAt: new Date().toISOString(),
      reason: isOverride ? null : companionCompletionReason,
      // Static, not AI-generated - the override path has no real AI
      // completion judgment behind it, so there's nothing to summarize
      // specifically (DecisionLog.md 2026-07-19). No accomplishment bullets
      // either - simple beats fabricated specifics.
      celebrationHeadline: isOverride ? "You created a room that works better for you." : companionCompletionHeadline,
      accomplishments: isOverride ? [] : companionCompletionAccomplishments,
      taskCount: completedTaskCountRef.current,
    };
    setCompanionCompletedProject(completedLocal);
    logEvent(getAnalytics(), "companion_project_finished", { planId: currentPlanId, batchIndex: companionBatchIndex });
    if (isOverride) {
      // Distinct from batch_completion_accepted below - there was no AI
      // recommendation to agree with, so counting this as "accepted" would
      // corrupt that event's documented meaning (its absence is used to
      // infer "user chose continue instead"). See Analytics.md.
      logEvent(getAnalytics(), "batch_completion_overridden", { planId: currentPlanId, batchIndex: companionBatchIndex });
    } else {
      // Absence of this event after a batch_completion_recommended implies the
      // user chose "Make one more improvement" instead - see Analytics.md.
      logEvent(getAnalytics(), "batch_completion_accepted", { planId: currentPlanId, batchIndex: companionBatchIndex });
    }
    // Straight to "finished" - no intermediate "project-complete" tap
    // (DecisionLog.md 2026-07-19). Reaching the full celebration in one
    // motion, not two.
    setCompanionStage("finished");
    if (currentPlanId) {
      updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
        companionComplete: {
          completedAt: serverTimestamp(),
          reason: completedLocal.reason,
          celebrationHeadline: completedLocal.celebrationHeadline,
          accomplishments: completedLocal.accomplishments,
          taskCount: completedLocal.taskCount,
        },
        shadowSourceVersion: increment(1),
      }).then(() => {
        syncPlanToSpaceGraph(user.uid, currentPlanId).catch(e => dlog(`[SPACE SHADOW SYNC] completion sync failed for plan ${currentPlanId}: ${e.message}`));
        // history is a one-time getDocs load, not onSnapshot (same gap
        // Session 1 discovery flagged for plan delete) - without this, My
        // Plans keeps showing the pre-completion snapshot until next reload,
        // same principle as deletePlan's setHistory filter.
        setHistory(prev => prev.map(h => h.id === currentPlanId ? { ...h, companionComplete: completedLocal } : h));
      }).catch(e => console.log("Save companion complete error:", e.message));
    }
  };

  const handleCompanionUpgradeRequest = () => {
    logEvent(getAnalytics(), "companion_upgrade_clicked", { planId: currentPlanId });
    // Reuses the existing paywall screen entirely unchanged. Same screen every
    // other "Upgrade to Pro" entry point already opens. Only the source tag is new.
    setPaywallSource("companion");
    setShowPaywall(true);
  };

  const submitCompanionProgressPhoto = async (progressUri, progressBase64, planIdOverride = null) => {
    // planIdOverride lets the isPro-mid-session effect re-invoke this exact
    // function once a plan has just been retroactively saved, before
    // currentPlanId state has actually re-rendered with the new value.
    const effectivePlanId = planIdOverride || currentPlanId;
    dlog(`[PHOTO DEBUG] submitCompanionProgressPhoto called | batchIndex=${companionBatchIndex} | progressUri=${progressUri} | progressBase64Len=${progressBase64?.length ?? "null"} | companionBasePhotoRef.current=${companionBasePhotoRef.current} | t=${Date.now()}`);
    // Restored on any failure below - the stage is only ever allowed to move
    // forward (into "generating" and then "reveal") after a valid server
    // response. Never a hardcoded fallback destination.
    const stageBeforeSubmit = companionStage;
    setProgressPhoto({ uri: progressUri, base64: progressBase64 });
    if (!isPro) {
      setCompanionStage("paywall-prompt");
      logEvent(getAnalytics(), "companion_paywall_viewed", { planId: effectivePlanId });
      return;
    }

    const originalSource = companionOriginalPhotoRef.current;
    if (!originalSource) {
      // Don't touch companionStage at all - the user stays exactly where
      // they were, so the submission is still available to retry and nothing
      // about the current batch is overwritten. This is the resumed-plan
      // race where restorePhotoFromPlan's download hasn't resolved yet.
      console.log("Companion next-batch error: original photo not yet available");
      logEvent(getAnalytics(), "batch_generation_failed", { planId: effectivePlanId, batchIndex: companionBatchIndex, reason: "missing_original_photo" });
      Alert.alert("Still loading", "We're still loading your original photo. Please try again in a moment.");
      return;
    }

    setCompanionStage("generating");
    startCompanionTips();
    try {
      const beforeSource = companionBasePhotoRef.current;
      if (!beforeSource) throw new Error("Missing before photo for comparison");

      // The original never changes mid-session, so its compressed/encoded
      // form is cached and reused rather than redone on every single batch.
      let compressedOriginal = companionOriginalCompressedRef.current;
      if (!compressedOriginal || compressedOriginal.uri !== originalSource) {
        const originalResult = await manipulateAsync(originalSource, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
        compressedOriginal = { uri: originalSource, base64: originalResult.base64 };
        companionOriginalCompressedRef.current = compressedOriginal;
      }
      const compressedBefore = await manipulateAsync(beforeSource, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      const compressedAfter = await manipulateAsync(progressUri, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });

      dlog(`[PHOTO DEBUG] about to call generateNextAction | batchIndex=${companionBatchIndex} | beforeSource=${beforeSource} | progressUri(after)=${progressUri} | originalHash=${debugHashBase64(compressedOriginal.base64)} | beforeHash=${debugHashBase64(compressedBefore.base64)} | afterHash=${debugHashBase64(compressedAfter.base64)} | t=${Date.now()}`);

      // Priority hierarchy (DecisionLog.md 2026-07-18): the photo is the real
      // signal, the checklist is intent, and any disagreement is never
      // surfaced to the user as a correction - the next batch is just
      // generated naturally around what the photo actually shows.
      // batchItemsRef, not batchItems directly - see its declaration for why
      // (stale-closure fix, DecisionLog.md 2026-07-18).
      const currentBatchItems = batchItemsRef.current;
      const checkedItems = currentBatchItems.filter(i => i.status === "checked");
      const carriedItems = currentBatchItems.filter(i => i.status === "carried");
      const skippedItems = currentBatchItems.filter(i => i.status === "skipped");
      const checklistLines = currentBatchItems.map(item => {
        const label = item.status === "checked" ? "the user marked this done"
          : item.status === "carried" ? "the user is still working on this, not done yet"
          : item.status === "skipped" ? `the user skipped this${item.skipReason ? ` (reason: ${item.skipReason})` : ""}`
          : "unresolved";
        return `- "${item.text}" - ${label}`;
      }).join("\n");
      // Whole-project exclusion list (DecisionLog.md 2026-07-18) - built from
      // everything skipped in EARLIER rounds (skippedItemTextsRef), not this
      // round's own skips, which are already represented above via
      // checklistLines with their reason. Kept as its own paragraph, distinct
      // from the carried-items instruction below: carried items SHOULD keep
      // reappearing until resolved, skipped items should never come back.
      const skippedExclusionText = skippedItemTextsRef.current.length
        ? `\n\nThe user has permanently skipped the following items earlier in this project - do not suggest these again in any form (not reworded, not narrower/broader versions of the same task), even if still visible in photo 3. This is different from items reported as "still working on this, not done yet" below, which SHOULD keep appearing until resolved:\n${skippedItemTextsRef.current.map(t => `- "${t}"`).join("\n")}`
        : "";
      const nextPrompt = `You are a warm, encouraging professional organizer helping with an ongoing organizing session. You are shown three photos of the same space, in order: (1) the original photo, before any organizing began, (2) the state at the start of this session, (3) the state right now, after this session's work.\n\nThis session's checklist, and what the user reported for each item:\n${checklistLines}${skippedExclusionText}\n\nTrust photo 3 over what the user reported. The checklist reflects intent, not verified fact - if an item was marked done but photo 3 shows it clearly wasn't addressed, don't call out the discrepancy or tell the user they're wrong. Just generate the next batch naturally around what photo 3 actually shows, prioritizing what's genuinely still needed there.\n\nFirst, compare photo 2 and photo 3. In one short sentence, describe the overall visible progress made this session - specific and photo-grounded (name what got cleared or organized), not a generic compliment and not a count of items checked off. If you cannot identify confident, specific visible progress, respond with exactly this sentence instead: "You made progress this session and moved the space forward."\n\nThen generate the next balanced session's worth of steps (a small checklist, not one item and not an exhaustive plan), based only on what is visible in photo 3 right now, accounting for any items above reported as "still working on this, not done yet" - those will be carried into the next session automatically, so do not repeat or rephrase them; only return additional NEW steps needed to round out a well-sized session given what's already carried over. Also exclude anything from the permanently-skipped list above, if one was given. Same qualitative sizing rules as before: don't return several trivial items, don't disguise one overwhelming task as one item, prefer a genuine mix suited to what this space actually needs. Never estimate or state how long any step will take. Before suggesting each new step, verify the problem is genuinely visible and unaddressed in photo 3, not a common decluttering trope you're defaulting to. If no new steps are needed, return an empty list - that combined with nothing carried over is itself a meaningful signal the space may be substantially complete, and should inform completionRecommended below.\n\nThen compare photo 1 (the original) and photo 3 (right now) only, to judge overall project progress. Using only what you can actually see: has clutter decreased, are related items grouped, is the intended surface or area usable, is there an obvious next improvement still visible? Before citing anything as still remaining, verify it is confidently and clearly visible in photo 3 right now, not a plausible guess or a common decluttering trope you're defaulting to - if you can't confidently confirm an item is still there, don't cite it as a reason to continue. "Substantially complete" means the space is functional and meaningfully improved, not that it looks visually perfect. Judge only the original-vs-now comparison, not whether this specific session went well.\n\nIf completionRecommended is true, also write a short, punchy celebratory headline naming the specific space and transformation (e.g. "You reclaimed your kitchen"), based only on the photo 1 vs photo 3 comparison, plus a short list of 2 to 4 specific, photo-grounded accomplishments as brief phrases, not full sentences (e.g. "Counter cleared", "Pantry organized", "Recycling removed") - nothing you can't verify by looking at the photos, no percentages, no generic praise. If completionRecommended is false, return an empty string for celebrationHeadline and an empty list for accomplishments.\n\nNever use em dashes (—) anywhere in your response; use a comma, period, or parentheses instead.\n\nReturn ONLY valid JSON, nothing else (no markdown, no backticks).\n\n{"visibleChange":"one short sentence describing this session's visible progress, or the exact fallback sentence if none is confident","nextBatch":["one or two warm sentences describing one new step","..."],"completionRecommended":true or false,"completionReason":"one short, specific sentence. If completionRecommended is true, explain specifically why the space now appears substantially complete. If false, describe the clearest single remaining visible opportunity. No generic praise, nothing you can't verify by looking at the photos.","celebrationHeadline":"short celebratory headline if completionRecommended is true, else empty string","accomplishments":["short accomplishment phrase","..."]}`;
      const generateNextActionFn = httpsCallable(functions, "generateNextAction");
      const result = await generateNextActionFn({
        originalImageBase64: compressedOriginal.base64,
        beforeImageBase64: compressedBefore.base64,
        afterImageBase64: compressedAfter.base64,
        prompt: nextPrompt,
      });
      const raw = result.data?.text || "";
      const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
      // Backstop for the prompt's own "never use em dashes" instruction.
      const parsed = sanitizeAiText(JSON.parse(cleaned));

      const visibleChangeText = typeof parsed.visibleChange === "string" && parsed.visibleChange.trim() ? parsed.visibleChange.trim() : null;
      const newItemTexts = Array.isArray(parsed.nextBatch) ? parsed.nextBatch.filter(t => typeof t === "string" && t.trim()) : [];
      // Completion fields are judged separately from visibleChange above - a
      // malformed completion judgment defaults safely and still lets the
      // next batch proceed, rather than breaking the whole loop over a
      // non-critical field.
      const completionRecommended = typeof parsed.completionRecommended === "boolean" ? parsed.completionRecommended : false;
      const completionReasonText = typeof parsed.completionReason === "string" && parsed.completionReason.trim() ? parsed.completionReason.trim() : null;
      // Celebration copy (DecisionLog.md 2026-07-18) - same "malformed defaults
      // safely, doesn't break the loop" treatment as completionReason above.
      const celebrationHeadlineText = typeof parsed.celebrationHeadline === "string" && parsed.celebrationHeadline.trim() ? parsed.celebrationHeadline.trim() : null;
      const accomplishmentsList = Array.isArray(parsed.accomplishments) ? parsed.accomplishments.filter(t => typeof t === "string" && t.trim()) : [];

      // Client composes the final next batch, not the AI response - carried
      // items are kept verbatim (their own text/identity), the AI's response
      // is only ever the NEW items rounding out the session (DecisionLog.md
      // 2026-07-18: "context for sizing, not source of truth for carried
      // item identity").
      const composedItems = [
        ...carriedItems.map(item => ({ id: item.id, text: item.text, status: "pending" })),
        ...newItemTexts.map(text => ({ id: makeItemId(), text, status: "pending" })),
      ];
      if (!visibleChangeText || (composedItems.length === 0 && !completionRecommended)) {
        throw new Error("Malformed response: missing visibleChange, or no next batch items and completion not recommended");
      }

      // Upload the progress photo to Storage (same pattern as the original analysis
      // photo) so it can be persisted on the plan doc, not just held in memory.
      let progressPhotoUrl = null;
      if (effectivePlanId) {
        try {
          const uploadCompressed = await manipulateAsync(progressUri, [{ resize: { width: 1024 } }], { compress: 0.75, format: SaveFormat.JPEG });
          const blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => resolve(xhr.response);
            xhr.onerror = () => reject(new Error("Failed to read progress photo file"));
            xhr.responseType = "blob";
            xhr.open("GET", uploadCompressed.uri, true);
            xhr.send(null);
          });
          const path = `plans/${user.uid}/${effectivePlanId}/progress/${Date.now()}.jpg`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
          progressPhotoUrl = await getDownloadURL(fileRef);
        } catch (uploadErr) {
          console.log("Progress photo upload error:", uploadErr.message);
        }
      }

      const newBatchIndex = companionBatchIndex + 1;
      if (effectivePlanId) {
        const archivedBatch = {
          batchIndex: companionBatchIndex,
          items: currentBatchItems,
          completedAt: new Date().toISOString(),
        };
        updateDoc(doc(db, "users", user.uid, "plans", effectivePlanId), {
          batchHistory: arrayUnion(archivedBatch),
          ...(progressPhotoUrl ? { progressPhotos: arrayUnion({ batchIndex: companionBatchIndex, url: progressPhotoUrl, uploadedAt: new Date().toISOString() }) } : {}),
          currentBatch: {
            batchIndex: newBatchIndex,
            suggestedAt: new Date().toISOString(),
            items: composedItems,
          },
          shadowSourceVersion: increment(1),
        }).then(() => {
          syncPlanToSpaceGraph(user.uid, effectivePlanId).catch(e => dlog(`[SPACE SHADOW SYNC] next-batch sync failed for plan ${effectivePlanId}: ${e.message}`));
        }).catch(e => console.log("Save companion progress error:", e.message));
      }

      logEvent(getAnalytics(), "batch_photo_submitted", { planId: effectivePlanId, batchIndex: companionBatchIndex, checkedCount: checkedItems.length, carriedCount: carriedItems.length, skippedCount: skippedItems.length });
      if (newBatchIndex === 2) {
        // Pro north star (replaces companion_session_started - see
        // DecisionLog.md 2026-07-18): measures engagement into a second
        // session, not conversion. A free user hitting the paywall never
        // reaches newBatchIndex 2 in the first place, so this only fires for
        // genuinely continuing (Pro) sessions.
        logEvent(getAnalytics(), "batch_second_batch_reached", { planId: effectivePlanId });
      }
      if (completionRecommended) {
        logEvent(getAnalytics(), "batch_completion_recommended", { planId: effectivePlanId, batchIndex: newBatchIndex });
      }

      // completionReasonText/visibleChangeText included here permanently, not
      // just for this investigation - "why didn't the AI recommend
      // completion" had been unanswerable after the fact all session, since
      // neither field was persisted anywhere (not in batchHistory, not in
      // analytics, not previously in this log) and companionCompletionReason
      // is in-memory only, gone once the app closes.
      dlog(`[PHOTO DEBUG] generateNextAction response received | batchIndex ${companionBatchIndex} -> ${newBatchIndex} | composedItems=${composedItems.length} | completionRecommended=${completionRecommended} | completionReason=${completionReasonText} | visibleChange=${visibleChangeText} | t=${Date.now()}`);
      dlog(`[PHOTO DEBUG] companionBasePhotoRef updating | from=${companionBasePhotoRef.current} | to=${progressUri}`);
      companionBasePhotoRef.current = progressUri;
      setBatchItems(composedItems);
      setCompanionBatchIndex(newBatchIndex);
      setCompanionCompletionRecommended(completionRecommended);
      setCompanionCompletionReason(completionReasonText);
      setCompanionCompletionHeadline(celebrationHeadlineText);
      setCompanionCompletionAccomplishments(accomplishmentsList);
      // The batch that's ending here is archived into batchHistory above -
      // its checked count is authoritative now, not something to re-derive
      // from results.batchHistory later (see completedTaskCountRef's own
      // comment for why that's stale mid-session).
      completedTaskCountRef.current += checkedItems.length;
      // This round's own skips join the exclusion list for FUTURE rounds -
      // not read back into this same call's prompt, which already showed
      // them via checklistLines above with their reason attached.
      if (skippedItems.length) {
        skippedItemTextsRef.current = [...skippedItemTextsRef.current, ...skippedItems.map(i => i.text)];
      }

      // Before/after reveal: show the comparison and the visible-change
      // reaction before the next batch appears, not instead of it.
      setCompanionRevealBefore(beforeSource);
      setCompanionRevealAfter(progressUri);
      setCompanionVisibleChange(visibleChangeText);
      setCompanionRevealReady(false);
      setCompanionStage("reveal");
      if (companionRevealTimer.current) clearTimeout(companionRevealTimer.current);
      companionRevealTimer.current = setTimeout(() => setCompanionRevealReady(true), 1200);
    } catch (e) {
      console.log("Companion next-batch error:", e.message);
      logEvent(getAnalytics(), "batch_generation_failed", { planId: effectivePlanId, batchIndex: companionBatchIndex, reason: e.message });
      // Never a hardcoded fallback stage - only enter reveal/further stages
      // after a valid server response. Revert to wherever the user actually
      // was, so the button that got them here is still there and tappable.
      setCompanionStage(stageBeforeSubmit);
      Alert.alert("Something went wrong", "We couldn't review your progress. Please try again.");
    } finally {
      stopCompanionTips();
    }
  };

  const captureCompanionPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera Permission Required", "Please allow camera access in Settings → Uncluttrd → Camera.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.2, base64: true });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        submitCompanionProgressPhoto(a.uri, a.base64);
      }
    } catch (e) {
      Alert.alert("Could not open camera", "Please try again.");
    }
  };

  const pickCompanionPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photos Permission Required", "Uncluttrd needs access to your photos to see your progress. Please go to Settings → Uncluttrd → Photos and allow access.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.2, base64: true });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        submitCompanionProgressPhoto(a.uri, a.base64);
      }
    } catch (e) {
      Alert.alert("We couldn't open your photos", "Please try again.");
    }
  };

  const pickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photos Permission Required", "Cluttrd needs access to your photos to analyze your room. Please go to Settings → Uncluttrd → Photos and allow access.", [{ text: "OK" }]);
        return;
      }
      dlog("[CROP] pickPhoto: opening library");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.2,
      });
      dlog(`[CROP] pickPhoto returned canceled=${result.canceled} assets=${result.assets?.length ?? 0}`);
      if (!result.canceled && result.assets?.[0]) {
        requestCrop(result.assets[0], acceptPhoto);
      }
    } catch (e) {
      dlog(`[CROP] pickPhoto ERROR ${e?.message}`);
      setErr("We couldn't open your photos. Please check your permissions in Settings and try again.");
    }
  };

  // Loads History from Firestore. isPro is in the dependency array on
  // purpose - MainApp mounts as soon as `user` is set, which happens before
  // the RevenueCat entitlement round trip in onAuthStateChanged resolves.
  // With an empty deps array this effect used to fire once on mount, see
  // isPro still false at that instant, and never run again even after isPro
  // correctly flipped true moments later - a real Pro user could get a
  // permanently empty History for the whole session depending on how fast
  // that round trip happened to resolve. Re-running on the isPro transition
  // fixes it at the source instead of guessing at retry/timing workarounds.
  useEffect(() => {
    const loadHistory = async () => {
      try {
        console.log("Loading history for user:", user.uid);
        const q = query(collection(db, "users", user.uid, "plans"), orderBy("createdAt", "desc"), limit(20));
        const snapshot = await getDocs(q);
        // Session Recovery: plans gained a soft-deleted state, so every
        // plans consumer now has to exclude retired ones. Filtered in
        // memory rather than with a where clause - this query already
        // carries orderBy + limit, and adding an inequality would need a
        // composite index for no behavioral gain at this scale.
        const plans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.retired !== true);
        console.log("Loaded", plans.length, "plans from Firestore");
        setHistory(plans);
      } catch (e) {
        console.log("Load history error:", e.message, e.code);
      }
    };
    loadHistory();
  }, [isPro]);

  // My Rooms -> True Room Grouping, Phase A: the authoritative Room list.
  // Reads users/{uid}/spaces directly, NOT plans - a Room with any number
  // of visits still appears exactly once, and the old 20-plan cap no
  // longer determines which Rooms appear at all (every Space is fetched).
  // Retired/redirected Spaces (merge losers) are filtered in-memory, not
  // via a `where("retired","!=",true)` query clause - that operator
  // excludes any document where the field is simply ABSENT (the "!=
  // excludes missing field" trap already avoided the same way elsewhere
  // in this codebase, e.g. checkOrphanedUserDeletions), and the
  // overwhelming majority of real Spaces never have `retired` set at all.
  // Same isPro-dependency mount-timing reasoning as loadHistory above.
  useEffect(() => {
    const loadRooms = async () => {
      try {
        const snapshot = await getDocs(collection(db, "users", user.uid, "spaces"));
        const allSpaces = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const nonRetired = allSpaces.filter(s => s.retired !== true);
        const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : 0));
        nonRetired.sort((a, b) => toMillis(b.lastOrganizedAt || b.createdAt) - toMillis(a.lastOrganizedAt || a.createdAt));
        console.log("Loaded", nonRetired.length, "rooms from Firestore (", allSpaces.length - nonRetired.length, "retired, filtered)");
        setRooms(nonRetired);

        // Phase C2: Recently Deleted - deletedAt is the load-bearing
        // filter, not retired alone (a bare merge tombstone has retired
        // but no deletedAt, and must never appear here - see
        // DeletionImplementation.md's contract). 30-day window enforced
        // client-side too, defense in depth ahead of the eventual
        // background purge sweep.
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const recentlyDeleted = allSpaces
          .filter((s) => s.retired === true && s.deletedAt && (Date.now() - toMillis(s.deletedAt)) <= THIRTY_DAYS_MS)
          .sort((a, b) => toMillis(b.deletedAt) - toMillis(a.deletedAt));
        setRecentlyDeletedRooms(recentlyDeleted);
      } catch (e) {
        console.log("Load rooms error:", e.message, e.code);
      }
    };
    loadRooms();
  }, [isPro]);

  // ---- Session Recovery: the recovery query (SessionRecoveryDesign.md §7).
  // The uncapped uid-scoped subcollection query, deliberately NOT the
  // collectionGroup form: Firestore rules here are user-scoped, so a
  // client-side collection-group read would span other users' plans and be
  // denied. It is uncapped on purpose - the 20-plan History cache is
  // exactly what made these sessions invisible in the first place.
  // Re-runs on recoveryReloadKey after every classify/delete/restore.
  useEffect(() => {
    let cancelled = false;
    const loadUnresolved = async () => {
      try {
        const snap = await getDocs(query(collection(db, "users", user.uid, "plans"), where("sessionScope", "==", "unresolved")));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const toMillis = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : (typeof t === "string" ? Date.parse(t) : 0));
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const byCreated = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
        if (cancelled) return;
        setUnresolvedSessions(all.filter((p) => p.retired !== true).sort(byCreated));
        // Soft-deleted unresolved sessions keep sessionScope "unresolved",
        // so the same query finds them - they are split out here rather
        // than by a second query.
        setDeletedSessions(all
          .filter((p) => p.retired === true && p.deletedAt && (Date.now() - toMillis(p.deletedAt)) <= THIRTY_DAYS_MS)
          .sort((a, b) => toMillis(b.deletedAt) - toMillis(a.deletedAt)));
      } catch (e) {
        dlog(`[RECOVERY] unresolved session query failed: ${e.message}`);
        if (!cancelled) { setUnresolvedSessions([]); setDeletedSessions([]); }
      }
    };
    loadUnresolved();
    return () => { cancelled = true; };
  }, [isPro, recoveryReloadKey]);

  // ---- Two-Stage Analysis: background auto-heal on launch ----------------
  // The per-plan auto-resume only fires when the user actually opens a
  // stranded plan, so a plan whose Call 2 was missed sits incomplete until
  // they happen to navigate to it. This sweeps them all once per sign-in,
  // so by the time they open any of them the detail is already there.
  //
  // Deliberately sequential. Call 2 runs ~50s; firing N of them at once
  // would compete with each other, with a fresh analysis the user might
  // start right now, and with their connection. One at a time is slower in
  // aggregate and invisible either way, since nothing waits on it.
  //
  // No UI at all: runDetailCall only touches detailError/results when the
  // plan it is working on is the one on screen, and on launch that is
  // nothing, so a background heal cannot paint a spinner or an error over
  // whatever the user is actually doing.
  //
  // Keyed by uid rather than a boolean so signing out and back in re-arms
  // it, but a re-render never does.
  const detailSweepUidRef = useRef(null);
  useEffect(() => {
    if (!user?.uid) return;
    if (detailSweepUidRef.current === user.uid) return;
    detailSweepUidRef.current = user.uid;
    let cancelled = false;
    const sweep = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, "users", user.uid, "plans"),
          where("analysisStage", "==", "summary-ready")
        ));
        // Newest first: the plan the user is most likely to open next is
        // the one they just made.
        const stranded = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p) => p.retired !== true && p.approaches)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        if (!stranded.length) return;
        dlog(`[TWO-STAGE SWEEP] ${stranded.length} stranded plan(s) to heal`);
        for (const plan of stranded) {
          if (cancelled) return;
          // runDetailCall never throws - it returns an outcome - so one
          // plan failing cannot abort the rest of the sweep. The in-flight
          // ref makes this a no-op for a plan the Results screen is
          // already healing.
          const result = await runDetailCall(plan.id, plan);
          dlog(`[TWO-STAGE SWEEP] ${plan.id} -> ${result?.outcome}`);
        }
      } catch (e) {
        // A failed sweep is not worth surfacing: every plan it would have
        // healed still heals when opened, via the per-plan effect.
        dlog(`[TWO-STAGE SWEEP] failed: ${e.message}`);
      }
    };
    sweep();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // My Rooms -> True Room Grouping, Phase B: Room Detail's own plan list.
  // Verified against real staging data (merged + reclassified cases,
  // Phase B scoping pass Section 1) that a Room's full plan membership is
  // exactly: plans whose canonicalSpaceId points here, PLUS the Room's own
  // self-owned founding plan (canonicalSpaceId absent, its own id equals
  // the Space id) - a real merge writes canonicalSpaceId onto the survivor
  // itself too (executeMerge.js), but a Room that was never on either side
  // of a merge or reclassification never gets that self-write, so both
  // halves of this OR are real, load-bearing cases, not redundant. Two
  // queries (Firestore can't OR across different fields), merged and
  // deduped by plan id (belt-and-suspenders for the case where a Room IS
  // itself the survivor of a merge and so appears in both), sorted by
  // createdAt descending client-side.
  useEffect(() => {
    if (!roomDetailRoomId) { setRoomDetailPlans([]); return; }
    let cancelled = false;
    const loadRoomDetailPlans = async () => {
      setRoomDetailLoading(true);
      try {
        const [byCanonicalSnap, selfSnap] = await Promise.all([
          getDocs(query(collection(db, "users", user.uid, "plans"), where("canonicalSpaceId", "==", roomDetailRoomId))),
          getDoc(doc(db, "users", user.uid, "plans", roomDetailRoomId)),
        ]);
        const byId = new Map();
        // Session Recovery: exclude soft-deleted sessions from both halves
        // of the OR-query - a deleted session must not appear in its
        // Room's history while it sits in the 30-day retention window.
        byCanonicalSnap.docs.forEach((d) => { const p = { id: d.id, ...d.data() }; if (p.retired !== true) byId.set(d.id, p); });
        if (selfSnap.exists() && selfSnap.data().retired !== true) byId.set(selfSnap.id, { id: selfSnap.id, ...selfSnap.data() });
        const toMillis = (t) => (typeof t === "string" ? Date.parse(t) : (t && typeof t.toMillis === "function" ? t.toMillis() : 0));
        const plans = [...byId.values()].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        if (!cancelled) setRoomDetailPlans(plans);
      } catch (e) {
        dlog(`[ROOM DETAIL] failed to load plans for room ${roomDetailRoomId}: ${e.message}`);
        if (!cancelled) setRoomDetailPlans([]);
      } finally {
        if (!cancelled) setRoomDetailLoading(false);
      }
    };
    loadRoomDetailPlans();
    return () => { cancelled = true; };
  }, [roomDetailRoomId]);

  // Area Identity, Phase A: this Room's own durable Areas - a plain
  // subcollection read (spaces/{roomId}/areas), no OR-query complexity
  // needed the way roomDetailPlans has, since an Area is definitionally
  // Room-owned and lives entirely under this one path.
  useEffect(() => {
    if (!roomDetailRoomId) { setRoomDetailAreas([]); return; }
    let cancelled = false;
    const loadRoomDetailAreas = async () => {
      try {
        const areasSnap = await getDocs(collection(db, "users", user.uid, "spaces", roomDetailRoomId, "areas"));
        const areas = areasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!cancelled) setRoomDetailAreas(areas);
      } catch (e) {
        dlog(`[ROOM DETAIL] failed to load areas for room ${roomDetailRoomId}: ${e.message}`);
        if (!cancelled) setRoomDetailAreas([]);
      }
    };
    loadRoomDetailAreas();
    return () => { cancelled = true; };
  }, [roomDetailRoomId]);

  useEffect(() => {
    if (showPaywall) {
      logEvent(getAnalytics(), "paywall_viewed");
    }
  }, [showPaywall]);

  // Save plan to Firestore after successful analysis - free and Pro alike.
  // The free-plan monthly limit (functions/index.js's analyzePhoto) is
  // enforced entirely via analysisCount/analysisCountMonth on the user doc,
  // independent of this write, so saving here doesn't interact with it.
  // Remembered Home v1 (RememberedHomeDesign.md §3): the ONLY creation
  // implementation for both first-time and returning plans - the sole
  // structural difference is whether canonicalSpaceId is supplied.
  // Deliberately not a separate createReturningPlan function with its own
  // copy of this logic (see createReturningPlan below, which delegates
  // here rather than duplicating) - the same consolidation principle
  // already applied to computeShadowBatchId/getSpaceDisplayName/
  // deriveFullReprojectionDocs elsewhere in this codebase.
  //
  // options.canonicalSpaceId: when supplied, this save targets an
  // EXISTING, already-established Space (established via navigation -
  // Section 1 - or explicit user confirmation - Section 2 - never by this
  // function inferring identity on its own). Validated fresh, here, every
  // time - never trusted from the caller and never a cached/stored
  // "eligible" flag - Section 1's governing principle applied to plan
  // creation, not just merge execution. An invalid or missing target
  // (Step 1 Point 2: not found, or retired: true) means NO plan is
  // created at all - options.onInvalidTarget, if supplied, is called with
  // the specific reason, and this function returns null exactly as it
  // already does for any other failure, preserving its existing
  // string-planId-or-null contract for the two existing call sites, which
  // never supply this option and are therefore entirely unaffected.
  const savePlanToHistory = async (plan, { canonicalSpaceId = null, onInvalidTarget } = {}) => {
    try {
      console.log("Saving plan for user:", user.uid);
      let inheritedSpaceName = null;
      if (canonicalSpaceId) {
        const targetSpaceSnap = await getDoc(doc(db, "users", user.uid, "spaces", canonicalSpaceId));
        const validation = validateTargetSpace(targetSpaceSnap.exists() ? targetSpaceSnap.data() : null);
        if (!validation.valid) {
          dlog(`[SPACE ASSOCIATION] target Space ${canonicalSpaceId} rejected: ${validation.reason}`);
          onInvalidTarget?.(validation.reason);
          return null;
        }
        // RememberedHomeDesign.md §3 Point 4 / Implementation Step 1 Point 3:
        // the returning plan inherits the Space's own current, user-owned
        // display name - not the fresh AI label - so getSpaceDisplayName
        // continues returning the name the user already trusts everywhere
        // (History, Companion, etc.), regardless of what this new photo's
        // analysis called the room.
        inheritedSpaceName = targetSpaceSnap.data().displayName || null;
      }
      const entry = {
        // Approach Selection Phase A: every plan saved from now on is the
        // new approaches-based schema (bumped from 1) - old plans already
        // saved keep schemaVersion 1 forever (no backfill,
        // ApproachSelectionDesign.md Section 11), so this field alone
        // (or, equivalently, tiers vs. approaches presence) is what every
        // reader uses to pick the right rendering path. Bumped to 3 for AI
        // Analysis Redesign, Phase B.1 (AIAnalysisRedesign.md): itemsFound
        // is now {description, certainty} objects (was a flat string
        // array), problemsFound entries gain a type ("organization" |
        // "opportunity"), and each approach gains keyChanges. No backfill
        // here either - schemaVersion 2 plans keep their flat itemsFound
        // array and untyped problemsFound forever, exactly as schemaVersion
        // 1 plans already do relative to 2. normalizeItemsFound (top of
        // file) is what lets every itemsFound consumer render both shapes
        // without a version check of its own; problemsFound/keyChanges
        // aren't rendered anywhere yet (see AIAnalysisRedesignImplementation.md),
        // so they need no equivalent shim.
        schemaVersion: 3,
        shadowSourceVersion: 1,
        createdAt: new Date().toISOString(),
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        // spaceType is always the fresh AI classification for THIS photo,
        // stored as-is, unchanged, whether or not this is a returning
        // visit - the AI's own label is never suppressed, only
        // getSpaceDisplayName's PREFERRED source (spaceName) is set below
        // when a canonical name already exists to inherit. Room-First
        // Identity (Implementation Phase A, Constraint 1): sourced from
        // suggestedRoomName now - the AI no longer returns a flat
        // spaceType field at all, so this is a field-source change, not
        // just a rename. suggestedRoomName/suggestedAreaName themselves
        // are never persisted (they exist only in the AI response/pending
        // state) - only their confirmed-into-fields results are: spaceType
        // (below), areaName/areaScope (below), and, when applicable,
        // spaceName (via inheritance, unchanged). roomReason/areaReason
        // (Constraint 2) are never referenced here at all - this object is
        // built from an explicit field list, so there is no path by which
        // either of the four ephemeral/evaluation-only fields could reach
        // Firestore.
        spaceType: plan.suggestedRoomName,
        // areaName/areaScope: the CONFIRMED area-level classification
        // (Room-First Identity Phase C) - plan.areaName/plan.areaScope are
        // set by completeRoomConfirmation's confirmedPlan construction
        // from the resolved confirmation result, not read directly off the
        // AI's raw suggestedAreaName/areaScope (which may have been
        // overridden by the user - e.g. "its own Room" always resolves to
        // areaScope "whole-room" regardless of what the AI originally
        // guessed). Falls back to the raw AI fields only for a caller that
        // predates Phase C's confirmedPlan shape (defensive, not expected
        // on any current call path). Descriptive metadata only (Room and
        // Space Model.md's "Option A: plan only" - no Location Reference
        // document, no sub-area UI, not durable identity yet).
        areaName: plan.areaName !== undefined ? plan.areaName : (plan.suggestedAreaName ?? null),
        areaScope: plan.areaScope ?? null,
        // Area Identity, Phase A (AreaIdentityDesign.md §2/§3): always
        // written, deliberately never omitted - null means a genuine
        // whole-Room visit (or a legacy-style visit with only the
        // descriptive areaName above and no durable identity yet), a
        // string means a durable Area established either by navigation
        // (startOrganizeAgain's areaId option, an existing-Area "Organize
        // Again") or by completeRoomConfirmation's own post-save Area
        // creation for a fresh sub-area visit. Phase A never infers this
        // value from areaName/suggestedAreaName - only an explicit
        // plan.areaId set by one of those two call sites ever populates
        // it.
        areaId: plan.areaId !== undefined ? plan.areaId : null,
        // Session Scope (SessionScopeDesign.md Q4 / SessionScopeImplementation.md):
        // THE authoritative discriminator for this session's scope, from
        // now on. Every other signal previously used to infer it - areaId
        // absence, areaScope absence, schemaVersion - is either ambiguous
        // or unrelated (Q2/Q3), so no consumer should ever go back to
        // them. Derived here from exactly the two values being written
        // immediately above, restated rather than referenced so this can
        // never silently disagree with what actually lands in the document.
        //
        // This is the single creation chokepoint: createReturningPlan
        // wraps this function, and finalizeAnalysisResult/
        // completeRoomConfirmation both reach Firestore only through one
        // of those two - so stamping it here covers every plan-creation
        // path in the app. The one case this cannot settle at save time is
        // a fresh sub-area visit whose Area does not exist yet (the Area
        // is created AFTER the plan, by createAreaForPlan) - that lands
        // here as "unresolved" and is corrected to "area" in the same
        // write that sets areaId. See createAreaForPlan.
        sessionScope: resolveSessionScope({
          areaId: plan.areaId !== undefined ? plan.areaId : null,
          areaScope: plan.areaScope ?? null,
        }),
        // spaceName: the CONFIRMED Room name (Phase C). For a returning
        // visit (canonicalSpaceId set), inheritedSpaceName - re-read fresh
        // from the target Space's own displayName - always wins, exactly
        // as before Room-First Identity (Step 1's own established
        // contract: the Space's already-trusted name, not whatever this
        // one photo's confirmation happened to say). For a NEW Room,
        // plan.spaceName (the user-confirmed identity from Phase B/C) is
        // written directly if provided - previously spaceName was never
        // set at creation time for a first-time plan (only added later via
        // an explicit rename); Room-First Identity changes this, since
        // Room confirmation now IS that explicit identity act, just
        // happening at creation time instead of afterward.
        ...(canonicalSpaceId
          ? { canonicalSpaceId, spaceName: inheritedSpaceName }
          : (plan.spaceName ? { spaceName: plan.spaceName } : {})),
        overview: plan.overview,
        itemsFound: plan.itemsFound,
        // Approach Selection Phase A (ApproachSelectionDesign.md Sections
        // 2/11): replaces tiers entirely for every plan saved from now on -
        // no `tiers` key at all on a new-format plan, which is itself the
        // schema-version discriminator every reader below keys off. problemsFound/
        // scopeSize/approaches mirror the AI's own response shape 1:1 -
        // each approach's estimatedSpendRange was already overwritten by
        // applyDeterministicSpendRanges (analyze()'s own call, right after
        // parsing) before this function ever sees `plan`, so what's stored
        // here is never the AI's own dollar-string authorship, always the
        // fixed scope x approach table's value.
        problemsFound: plan.problemsFound,
        scopeSize: plan.scopeSize,
        approaches: plan.approaches,
        // Two-Stage Analysis (TwoStageAnalysisDesign.md §2). This is the
        // state machine's only durable field, and it is written here
        // because THIS is the moment a plan first exists: Call 1 has
        // returned, the user has confirmed the Room, and the document is
        // complete and useful on its own even though its approaches carry
        // no detail yet.
        //
        // "summary-ready" is a real, valid, renderable state - not a
        // half-written document. Collapsed cards work, Room/Area identity
        // is settled, and the Companion simply has nothing to start yet.
        // A plan that never reaches "complete" stays usable rather than
        // becoming garbage to clean up.
        //
        // Absent on every plan written before this change; readers treat
        // absence as "complete" (see planAnalysisStage), so this is
        // additive and needs no migration.
        analysisStage: "summary-ready",
        // Genuinely null at save time - this field records the user's own
        // explicit approach choice, made on Results (Phase B's "Start This
        // Plan" button), which by definition hasn't happened yet for a plan
        // that's only just now being saved.
        selectedApproach: null,
        proTip: plan.proTip,
        // vizImages is deliberately NOT initialized here. Every reader
        // already spells it `item.vizImages || {}`, and generateVisualization
        // writes with the dotted path `vizImages.<key>`, which Firestore
        // creates on demand - so an empty map at save time carried no
        // information and only made "has this plan ever been visualized?"
        // unanswerable without inspecting the map's size.
        // Approach Selection Phase B: Companion has nothing to show until
        // the user explicitly taps "Start This Plan" on Results and
        // handleStartThisPlan seeds currentBatch from their chosen
        // approach's taskChecklist. No fallback here - looking at approach
        // cards is free; only starting one produces a checklist.
        currentBatch: null,
        approachHistory: [],
        batchHistory: [],
        progressPhotos: [],
      };
      const docRef = await addDoc(collection(db, "users", user.uid, "plans"), entry);
      console.log("Plan saved successfully:", docRef.id);
      setCurrentPlanId(docRef.id);
      setHistory(prev => [{ id: docRef.id, ...entry }, ...prev]);

      // Persist the original photo so reopening this plan later (e.g. to regenerate
      // a visualization) uses its own photo instead of whatever is in the live `photo` state.
      let shadowPhotoUrl = null;
      if (photo?.uri) {
        try {
          const compressed = await manipulateAsync(photo.uri, [{ resize: { width: 1024 } }], { compress: 0.75, format: SaveFormat.JPEG });
          const blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => resolve(xhr.response);
            xhr.onerror = () => reject(new Error("Failed to read compressed photo file"));
            xhr.responseType = "blob";
            xhr.open("GET", compressed.uri, true);
            xhr.send(null);
          });
          const path = `plans/${user.uid}/${docRef.id}/original.jpg`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
          const photoUrl = await getDownloadURL(fileRef);
          await updateDoc(doc(db, "users", user.uid, "plans", docRef.id), { photoUrl });
          setHistory(prev => prev.map(h => h.id === docRef.id ? { ...h, photoUrl } : h));
          // And the open Results plan, when it is still this one (paths that
          // show Results before saving: Organize Again, the paywall upgrade).
          // Guarded on the ref for the same reason runDetailCall is.
          lastPhotoUploadRef.current = { planId: docRef.id, photoUrl };
          setResults((prev) => mergeUploadedPhotoUrl(prev, currentPlanIdRef.current, { planId: docRef.id, photoUrl }));
          shadowPhotoUrl = photoUrl;
        } catch (photoErr) {
          console.log("Save original photo error:", photoErr.message);
        }
      }

      // Space/Project/Session/Batch shadow write - additive only, see the
      // block of functions above savePlanToHistory's definition. Never
      // awaited into the caller's critical path beyond this point, and
      // its own try/catch already guarantees it never throws - fire and
      // forget is intentional here, not an oversight.
      writeSpaceShadowStructure(user.uid, docRef.id, entry, shadowPhotoUrl).then(() => {
        if (__DEV__) validateSpaceShadowMigration(user.uid, docRef.id);
      });

      return docRef.id;
    } catch (e) {
      console.log("Save history error:", e.message, e.code);
      return null;
    }
  };

  // Remembered Home v1 (RememberedHomeDesign.md §3 Point (f) / Implementation
  // Step 1 Point 1): a thin wrapper, not a second creation implementation -
  // delegates entirely to savePlanToHistory for plan fields, photo upload,
  // shadowSourceVersion, analytics-adjacent bookkeeping, creation-time
  // shadow writes, and error handling. Its only job is turning
  // savePlanToHistory's existing string-or-null contract (preserved
  // exactly, unchanged, for its two pre-existing call sites) into a richer,
  // discriminated outcome for the NEW returning-visit call sites (Sections
  // 1 and 2), which need to distinguish "created" from "target Space was
  // invalid" to recover honestly rather than just failing silently.
  const createReturningPlan = async (plan, targetSpaceId) => {
    let invalidReason = null;
    const planId = await savePlanToHistory(plan, {
      canonicalSpaceId: targetSpaceId,
      onInvalidTarget: (reason) => { invalidReason = reason; },
    });
    if (planId) return { outcome: "created", planId };
    if (invalidReason) return { outcome: "invalid-target-space", planId: null, reason: invalidReason };
    return { outcome: "failed", planId: null, reason: "save-error" };
  };

  // ---- Remembered Home v1 Step 3: Generic Camera Recognition ----
  // Named as a recognition engine entry point (RememberedHomeDesign.md §2 /
  // Implementation Step 3) even though exact getSpaceDisplayName match is
  // the only signal it has today - governing principle: recognition
  // proposes, never asserts, and exact-match is the only v1 signal.
  //
  // Cache-first, query-as-fallback: checks the already-loaded `history`
  // array (zero new reads, covers the common case - a user's 20 most
  // recent plans) via the shared pure resolveRecognitionCandidates.
  // Only if that finds nothing does it fall back to Firestore. Deliberate
  // deviation from RememberedHomeDesign.md §2a, which said to run the
  // query unconditionally in parallel with the cache check: doing that
  // would mean extra Firestore reads on EVERY analysis, including the
  // common first-time-user case with no history at all to match against.
  // Conditional-on-cache-miss still catches exactly the case §2a's own
  // reasoning cared about (an older Room the 20-item cache missed) - it
  // just avoids paying the query's cost when the cache already has a real
  // answer. Flagged explicitly, not silently changed.
  //
  // The fallback itself (Recognition Rename Fix - Fallback Completion) is
  // Space-identity-first, not plan-label-first: it queries the user's own
  // active Spaces for one whose CURRENT displayName matches freshLabel
  // (single-field equality, auto-indexed, no deployment needed) - this is
  // what makes a renamed Room discoverable even when every one of its own
  // plans still carries its obsolete pre-rename label, since renameSpace
  // never touches plan documents (see its own comment). The original
  // exact-field plan queries (spaceType, spaceName) still run alongside
  // it, unconditionally - that's what keeps a genuinely legacy plan (no
  // canonicalSpaceId, no live Space at all) discoverable via its own
  // historical label, exactly as before. Recognition is therefore no
  // longer dependent on `history` cache state at all: a renamed Room with
  // no matching plan anywhere in the cache OR in the exact-field query
  // is still found, through its live Space identity alone.
  //
  // Never THROWS out to its caller - a recognition failure must never
  // block the fresh-start path it's proposing something in front of (§2d's
  // structural guarantee). But it no longer silently collapses a genuine
  // query failure into "no match" either (Track 2 diagnostic finding,
  // 2026-08-07: a live on-device test showed a real matching Room went
  // unfound with zero trace of why, because this function's old contract
  // - bare array, [] for both "queried and found nothing" and "query threw"
  // - made the two indistinguishable after the fact). Now returns
  // { status, candidates, diagnostics }:
  //   status: "MATCH_FOUND" | "NO_MATCH" | "RECOGNITION_FAILED"
  //   candidates: the resolved candidate array (always [] for NO_MATCH/RECOGNITION_FAILED)
  //   diagnostics: a structured, JSON-loggable object describing exactly
  //     what happened at every step - cache state, whether the fallback
  //     query ran and why, its raw per-field result counts, and (only for
  //     RECOGNITION_FAILED) the thrown error's name/message/code. Logged
  //     via dlog on every call (not just failures) so it's captured in the
  //     existing debugLogBuffer/debugShareLog mechanism (long-press the
  //     header logo) for the next on-device test to export. Not persisted
  //     to Firestore anywhere - purely in-memory operational telemetry.
  const findRecognitionCandidates = async (freshLabel, historyList, forUid) => {
    const diagnostics = {
      freshLabel: freshLabel || null,
      cacheLoaded: Array.isArray(historyList),
      cacheSize: Array.isArray(historyList) ? historyList.length : 0,
      cacheCandidateCount: 0,
      fallbackQueryRan: false,
      fallbackQueryReason: null, // "no-fresh-label" | "cache-not-loaded" | "cache-had-zero-matches" | null
      byTypeCount: null,
      byNameCount: null,
      liveSpaceMatchCount: null,
      error: null,
      finalCandidateCount: 0,
      status: null,
    };
    const finish = (status, candidates) => {
      diagnostics.status = status;
      diagnostics.finalCandidateCount = candidates.length;
      dlog(`[RECOGNITION] ${JSON.stringify(diagnostics)}`);
      return { status, candidates, diagnostics };
    };

    if (!freshLabel) {
      diagnostics.fallbackQueryReason = "no-fresh-label";
      return finish("NO_MATCH", []);
    }

    // Phase C1 (DeletionDesign.md item 5): resolveRecognitionCandidates
    // itself is pure and plan-only - it has no way to know a candidate's
    // canonicalSpaceId now belongs to a soft-deleted Room, since
    // soft-delete deliberately never touches plans (only the Space/Area
    // doc). Under the ORIGINAL hard-delete design this couldn't happen -
    // a deleted Room's plans were gone too, so there was nothing left to
    // match - but soft-delete's whole 30-day retention window means a
    // deleted Room's plans stay fully live and would otherwise still
    // surface here, proposing "is this your [Room you just deleted]?".
    // Bounded to at most 3 reads (candidates are already capped at 3).
    const excludeRetiredCandidates = async (candidates) => {
      if (!candidates.length) return candidates;
      const flags = await Promise.all(candidates.map((c) => getDoc(doc(db, "users", forUid, "spaces", c.canonicalSpaceId))));
      return candidates.filter((c, i) => !(flags[i].exists() && flags[i].data().retired === true));
    };

    const cachePlans = (historyList || []).map((h) => ({ id: h.id, data: h }));
    // Recognition Identity Fix: resolve each plan's live Space identity
    // (via the already-loaded `rooms` state) before it ever reaches the
    // pure resolveRecognitionCandidates - see withLiveSpaceIdentity's own
    // comment. resolveRecognitionCandidates itself is untouched.
    const cacheCandidatesRaw = resolveRecognitionCandidates(freshLabel, withLiveSpaceIdentity(cachePlans, rooms));
    const cacheCandidates = await excludeRetiredCandidates(cacheCandidatesRaw);
    diagnostics.cacheCandidateCount = cacheCandidates.length;
    if (cacheCandidates.length) return finish("MATCH_FOUND", cacheCandidates);

    diagnostics.fallbackQueryRan = true;
    diagnostics.fallbackQueryReason = diagnostics.cacheLoaded && diagnostics.cacheSize > 0 ? "cache-had-zero-matches" : "cache-not-loaded";

    try {
      const plansRef = collection(db, "users", forUid, "plans");
      // Recognition Rename Fix - Fallback Completion: Space identity comes
      // FIRST now, not just plan labels. A renamed Room's own plans may
      // never carry its current name anywhere in spaceType/spaceName -
      // renameSpace never touches them (see its own comment) - so the
      // exact-field plan queries below can structurally never find a
      // renamed Room whose plans are all still labeled with its obsolete
      // name. Querying the user's own active Spaces for one whose CURRENT
      // displayName matches freshLabel finds it directly, independent of
      // what any of its plans' own historical fields say - closing the
      // residual gap the previous fix (cache-path-only) explicitly
      // disclosed. Equality-only on both the Space query and the
      // per-Space plan lookup below - no orderBy, no composite index
      // needed (this file's own established indexing discipline
      // elsewhere) - "most recent" is picked client-side from a small
      // bounded fetch instead. Retired Spaces are filtered client-side
      // too, same reasoning as excludeRetiredCandidates below: a `!=`
      // filter would incorrectly exclude every Space that's never had
      // `retired` written at all, which is the common, non-deleted case.
      const spacesRef = collection(db, "users", forUid, "spaces");
      const [spaceMatchSnap, byType, byName] = await Promise.all([
        getDocs(query(spacesRef, where("displayName", "==", freshLabel))),
        getDocs(query(plansRef, where("spaceType", "==", freshLabel))),
        getDocs(query(plansRef, where("spaceName", "==", freshLabel))),
      ]);
      const liveSpaceMatches = spaceMatchSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => s.retired !== true);
      diagnostics.liveSpaceMatchCount = liveSpaceMatches.length;
      diagnostics.byTypeCount = byType.size;
      diagnostics.byNameCount = byName.size;

      // Bounded to the first 3 name-matching live Spaces - matches
      // resolveRecognitionCandidates's own final .slice(0,3) cap; more
      // than 3 live Spaces sharing one exact display name is already an
      // unusual edge case, low-stakes the same way this file already
      // treats similarly rare collisions elsewhere.
      const spaceIdentityPlans = liveSpaceMatches.length
        ? (await Promise.all(liveSpaceMatches.slice(0, 3).map(async (space) => {
            const plansSnap = await getDocs(query(plansRef, where("canonicalSpaceId", "==", space.id), limit(5)));
            const plans = plansSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
            plans.sort((a, b) => Date.parse(b.data.createdAt || 0) - Date.parse(a.data.createdAt || 0));
            return plans[0] || null; // most recent, client-side - no plans yet under a brand-new Space is a valid, if unlikely, outcome
          }))).filter(Boolean)
        : [];

      // Historical spaceType/spaceName matching (byType/byName) still
      // coexists unconditionally - it's what keeps a genuinely legacy
      // plan (no canonicalSpaceId, no live Space at all) discoverable via
      // its own historical label, exactly as before this fix.
      const merged = new Map();
      // Session Recovery: a soft-deleted session must never found a
      // recognition match - it is invisible everywhere else in the app for
      // its retention window, and proposing "is this your X?" from a plan
      // the user just deleted would be a confusing resurrection.
      const addPlan = (id, data) => { if (!merged.has(id) && data?.retired !== true) merged.set(id, { id, data }); };
      spaceIdentityPlans.forEach((p) => addPlan(p.id, p.data));
      byType.docs.forEach((d) => addPlan(d.id, d.data()));
      byName.docs.forEach((d) => addPlan(d.id, d.data()));

      // withLiveSpaceIdentity still does the same job it always has -
      // re-stamping each candidate plan's transient spaceName from its
      // live Space's displayName - it's just no longer the only path by
      // which a live Space's own plan can reach this point.
      const resolvedRaw = resolveRecognitionCandidates(freshLabel, withLiveSpaceIdentity([...merged.values()], rooms));
      const resolved = await excludeRetiredCandidates(resolvedRaw);
      return finish(resolved.length ? "MATCH_FOUND" : "NO_MATCH", resolved);
    } catch (e) {
      diagnostics.error = { name: e.name || null, message: e.message || String(e), code: e.code || null };
      return finish("RECOGNITION_FAILED", []);
    }
  };

  // Reacts to isPro transitioning false -> true mid-session (e.g. a purchase
  // completed partway through a free-tier Companion loop). Free plans now
  // save immediately (see savePlanToHistory), so currentPlanId is normally
  // already set by the time this fires - the retroactive-save branch below
  // is now a narrow safety net for the async race between `results` being
  // set and that save's Firestore write actually resolving, not the primary
  // path it used to be. The deferred-continuation branch is a separate
  // concern and must NOT be gated on !currentPlanId the way it used to be:
  // a free user who hit the paywall mid-continuing-loop
  // (submitCompanionProgressPhoto's isPro gate) and upgrades right there
  // needs that submission resumed regardless of whether a plan doc already
  // existed, which it normally already does now. See DecisionLog.md
  // 2026-07-14 for the investigation that originally found the need for
  // this effect.
  const prevIsProRef = useRef(isPro);
  useEffect(() => {
    const justBecamePro = !prevIsProRef.current && isPro;
    prevIsProRef.current = isPro;
    if (!justBecamePro) return;
    const isPaywallContinuation = companionStage === "paywall-prompt" && !!progressPhoto;
    if (!isPaywallContinuation && (currentPlanId || !results)) return; // nothing to do

    (async () => {
      let planId = currentPlanId;
      if (!planId && results) {
        planId = await savePlanToHistory(results);
        if (!planId) {
          // Unlike savePlanToHistory's normal console.log-only failures, this
          // one is user-facing on purpose - this whole effect exists to
          // prevent silent data loss, so a silent failure here would defeat it.
          Alert.alert("We couldn't save your progress", "You may need to redo your last step.");
          return;
        }
        // CALL 2 for the fourth creation path (audit, 2026-08-12). A free
        // user who hit the paywall mid-analysis and then upgraded gets
        // their plan written HERE, by a direct savePlanToHistory that no
        // other Call 2 trigger covers - so their plan would have been born
        // at "summary-ready" with nothing scheduled to finish it. Rarer
        // than the Room-confirmation path, and it never surfaced in
        // testing precisely because it needs a real upgrade to reach, but
        // it is the same defect and it is fixed here rather than left to
        // be rediscovered. Not awaited; the in-flight ref dedupes it
        // against the launch sweep.
        runDetailCall(planId, results);
        // savePlanToHistory only ever writes currentBatch fresh (every item
        // "pending") - backfill it with whatever the client already knows
        // actually happened (checked/carried/skipped items from this
        // session), since the batch schema has one items array to sync
        // rather than several separate dotted status/timestamp fields.
        if (batchItems.length) {
          try {
            await updateDoc(doc(db, "users", user.uid, "plans", planId), { "currentBatch.items": batchItems, shadowSourceVersion: increment(1) });
            syncPlanToSpaceGraph(user.uid, planId).catch(e => dlog(`[SPACE SHADOW SYNC] retroactive-save sync failed for plan ${planId}: ${e.message}`));
          } catch (e) {
            console.log("Retroactive companion backfill error:", e.message);
          }
        }
      }
      // paywall-prompt specifically means a progress photo was already
      // submitted while free and the AI call was skipped - now that isPro is
      // true, actually run the deferred generation instead of just
      // correcting the stage cosmetically.
      if (isPaywallContinuation) {
        submitCompanionProgressPhoto(progressPhoto.uri, progressPhoto.base64, planId);
      }
    })();
  }, [isPro]);

  // Tracks which plan's photo is currently being restored so a late-resolving download
  // for an abandoned plan can't overwrite the photo of whichever plan is now on screen.
  const activePlanIdRef = useRef(null);

  // Step 5 shadow reconciliation - see the useEffect near resumablePlan below.
  const reconciledPlanIdRef = useRef(null);

  // Downloads a plan's stored photo locally so manipulateAsync (which requires a
  // local file URI, not a remote URL) can use it when regenerating a visualization.
  const restorePhotoFromPlan = async (item) => {
    activePlanIdRef.current = item.id;
    setPhoto(null); // clear immediately so nothing can fire generateVisualization with a stale photo while this loads
    // The [results] effect seeds companionOriginalPhotoRef from `photo` too,
    // but that effect fires synchronously on setResults(item) - before this
    // download resolves. Reset here and set it again below once the real
    // local file is ready, so a resumed plan never gets stuck with a stale or
    // missing original photo ref.
    dlog(`[PHOTO DEBUG] restorePhotoFromPlan: companionOriginalPhotoRef reset to null | planId=${item.id}`);
    companionOriginalPhotoRef.current = null;
    companionOriginalCompressedRef.current = null;
    if (!item.photoUrl) return;
    try {
      const localUri = FileSystem.cacheDirectory + `plan_photo_${item.id}.jpg`;
      const { uri } = await FileSystem.downloadAsync(item.photoUrl, localUri);
      if (activePlanIdRef.current !== item.id) return; // user switched/left before this resolved
      setPhoto({ uri, base64: null, mimeType: "image/jpeg" });
      dlog(`[PHOTO DEBUG] restorePhotoFromPlan: companionOriginalPhotoRef null -> ${uri} | planId=${item.id}`);
      companionOriginalPhotoRef.current = uri;

      // companionBasePhotoRef ("before" image for the next comparison) was
      // never set here at all - resuming straight into batch-active (no
      // fresh analyzePhoto in this sitting) left it permanently null, since
      // only a successful submitCompanionProgressPhoto round-trip otherwise
      // sets it. Prefer the plan's most recent progress photo if one exists
      // (a truer "most recent known state" than the original), falling back
      // to the original just downloaded above for a plan with no progress
      // photos yet (still on its first batch).
      const lastProgressUrl = item.progressPhotos?.length ? item.progressPhotos[item.progressPhotos.length - 1].url : null;
      if (lastProgressUrl) {
        const baseLocalUri = FileSystem.cacheDirectory + `plan_photo_${item.id}_base.jpg`;
        const { uri: baseUri } = await FileSystem.downloadAsync(lastProgressUrl, baseLocalUri);
        if (activePlanIdRef.current !== item.id) return;
        dlog(`[PHOTO DEBUG] restorePhotoFromPlan: companionBasePhotoRef null -> ${baseUri} (last progress photo) | planId=${item.id}`);
        companionBasePhotoRef.current = baseUri;
      } else {
        dlog(`[PHOTO DEBUG] restorePhotoFromPlan: companionBasePhotoRef null -> ${uri} (original, no progress photos yet) | planId=${item.id}`);
        companionBasePhotoRef.current = uri;
      }
    } catch (e) {
      console.log("Restore plan photo error:", e.message);
      if (activePlanIdRef.current === item.id) setPhoto(null);
    }
  };

  const compressPhoto = async (uri) => {
    try {
      console.log("Compressing photo...");
      const result = await manipulateAsync(
        uri,
        [{ resize: { width: 768 } }],
        { compress: 0.5, format: SaveFormat.JPEG, base64: true }
      );
      console.log("Compressed base64 length:", result.base64.length);
      return { uri: result.uri, base64: result.base64, mimeType: "image/jpeg" };
    } catch (e) {
      console.log("Compress failed:", e.message);
      return null;
    }
  };

  // Crop hand-off. requestCrop parks the asset and remembers what the caller
  // wanted to do with it; the modal calls back with either the cropped asset
  // or the original. Each entry point keeps its own tail - the camera path
  // compresses and measures, the two library paths do not - so inserting the
  // crop changes none of what they already did afterwards.
  const [cropSource, setCropSource] = useState(null);
  const cropDoneRef = useRef(null);

  // Every entry point now ends here, and none of them takes base64 from the
  // picker any more.
  //
  // That combination is what broke the crop. Turning allowsEditing off was
  // necessary - its editor is a forced square on iOS - but allowsEditing was
  // also what kept the returned image small. With it off the picker hands back
  // the full-resolution original, and base64: true made it encode all of it,
  // on the bridge, before launchCameraAsync ever resolved. On a 12MP photo
  // that is a multi-megabyte string built at the moment the camera is already
  // holding the image in memory. Nothing downstream ever needed it at that
  // size: analyze() reads photo.base64, but compressPhoto has always produced
  // it at 768px, and the camera path already called compressPhoto anyway.
  //
  // It fits every symptom - no [CROP] requestCrop line ever, because the
  // failure is inside the picker before it returns; unaffected by force-quit,
  // because it is photo size and not state; and invisible in the log, because
  // debugLogBuffer is a plain in-memory array that a restart wipes.
  const acceptPhoto = async (a) => {
    const compressed = await compressPhoto(a.uri);
    if (!compressed) {
      dlog(`[CROP] compressPhoto FAILED for ${a?.uri?.slice(-28)}`);
      setErr("We couldn't process that photo. Please try another one.");
      return;
    }
    dlog(`[CROP] accepted, base64 ${Math.round(compressed.base64.length / 1024)}KB`);
    setPhoto(compressed);
    logEvent(getAnalytics(), "photo_uploaded");
    Image.getSize(compressed.uri, (w, h) => setPhotoSize({ width: w, height: h }), () => { });
    setResults(null); setErr(null);
  };

  const requestCrop = (asset, done) => {
    dlog(`[CROP] requestCrop uri=${asset?.uri?.slice(-28)} ${asset?.width}x${asset?.height}`);
    cropDoneRef.current = done;
    // The crop rectangle is converted back into source pixels on confirm, so
    // the modal cannot open without real dimensions. The picker supplies them;
    // Image.getSize is the fallback, and if even that fails the crop is
    // skipped rather than opened against a guess.
    if (asset?.width > 0 && asset?.height > 0) {
      setCropSource(asset);
      return;
    }
    Image.getSize(
      asset.uri,
      (w, h) => setCropSource({ ...asset, width: w, height: h }),
      () => { cropDoneRef.current = null; done(asset); }
    );
  };

  const finishCrop = (asset) => {
    dlog(`[CROP] finishCrop uri=${asset?.uri?.slice(-28)} ${asset?.width}x${asset?.height}`);
    const done = cropDoneRef.current;
    cropDoneRef.current = null;
    setCropSource(null);
    if (done && asset) done(asset);
  };

  const showPhotoOptions = () => {
    Alert.alert(
      "Add a Photo",
      "How would you like to add your photo?",
      [
        { text: "Take Photo", onPress: openCamera },
        { text: "Choose from Camera Roll", onPress: pickPhoto },
        { text: "Browse Files", onPress: pickFile },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const pickFile = async () => {
    try {
      dlog("[CROP] pickFile: opening library");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        // allowsEditing off: it opens the OS editor, which is a forced square
        // on iOS. The crop screen below is free-form and needs the full frame.
        allowsEditing: false,
        quality: 0.2,
      });
      dlog(`[CROP] pickFile returned canceled=${result.canceled} assets=${result.assets?.length ?? 0}`);
      if (!result.canceled && result.assets?.[0]) {
        requestCrop(result.assets[0], acceptPhoto);
      }
    } catch (e) {
      dlog(`[CROP] pickFile ERROR ${e?.message}`);
      setErr("We couldn't open your files. Please try another option.");
    }
  };

  const openCamera = async () => {
    try {
      dlog("[CROP] openCamera: requesting permission");
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        dlog("[CROP] openCamera: permission denied");
        Alert.alert("Camera Permission Required", "Please allow camera access in Settings → Uncluttrd → Camera.");
        return;
      }
      dlog("[CROP] openCamera: launching");
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.2,
      });
      dlog(`[CROP] openCamera returned canceled=${result.canceled} assets=${result.assets?.length ?? 0}`);
      if (!result.canceled && result.assets?.[0]) {
        requestCrop(result.assets[0], acceptPhoto);
      }
    } catch (e) {
      dlog(`[CROP] openCamera ERROR ${e?.message}`);
      setErr("Could not open camera. Please try again.");
    }
  };

  // Remembered Home v1 Step 3: shared save+bookkeeping tail, used by
  // analyze()'s own first-time/Organize-Again paths AND by the recognition
  // proposal's confirm/decline handlers below - one implementation of
  // save-plan/batch-analytics/scroll-reset/analyses-remaining, not three
  // copies of it. canonicalSpaceId null means an ordinary fresh-start save
  // (savePlanToHistory); non-null means a returning visit
  // (createReturningPlan), handling the invalid-target-space race exactly
  // as Step 2 already does.
  // areaId (Area Identity, Phase A §4): optional, threaded straight
  // through from organizeAgainContext.areaId (see the analyze() call
  // site below) - identity already established by navigation, so this
  // never triggers any Area creation/matching here, just carries the
  // existing Area's id onto the new plan exactly like canonicalSpaceId
  // already carries the existing Room's id.

  // ---- Two-Stage Analysis: the detail call (TwoStageAnalysisDesign.md §2)
  //
  // One entry point, reached from exactly three places: straight after a
  // plan is created, on reopening a plan still stuck at "summary-ready",
  // and from the user's own retry tap. Keeping it to one function is what
  // makes "no duplicate plan" true by construction - it only ever UPDATES
  // a planId it was handed, and has no code path that creates anything.
  //
  // detailInFlightRef guards against the three entry points racing: the
  // resume effect and the post-create kick can both fire for the same plan
  // within the same render pass. A Set of planIds, not a boolean, because
  // two different plans legitimately can be in flight at once (create one,
  // reopen another).
  const detailInFlightRef = useRef(new Set());

  // Absence means "written before the two-stage split" - those plans have
  // their detail already, so they are complete by definition. This is the
  // whole of the backward-compatibility story (§7).
  const planAnalysisStage = (plan) => {
    if (!plan) return "complete";
    if (!plan.approaches) return "complete";          // old tier-format plan
    return plan.analysisStage || "complete";          // pre-split approach plan
  };

  const runDetailCall = async (planId, summaryPlan, { isRetry = false } = {}) => {
    if (!planId || !summaryPlan?.approaches) return { outcome: "not-applicable" };
    if (detailInFlightRef.current.has(planId)) return { outcome: "already-running" };
    detailInFlightRef.current.add(planId);
    // Only surfaces in the UI for the plan currently on screen; a
    // background resume for some other plan must not paint this one.
    if (planId === currentPlanIdRef.current) setDetailError(null);
    setDetailRunning((prev) => ({ ...prev, [planId]: true }));
    const startedAt = Date.now();
    try {
      const detailFn = httpsCallable(functions, "analyzePhotoDetail", { timeout: 300000 });
      const result = await detailFn({ prompt: buildDetailPrompt(summaryPlan), planId });
      const raw = result.data?.text || "";
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("unparseable detail response");
      const detail = sanitizeAiText(JSON.parse(match[0]));
      if (!detail.approaches) throw new Error("detail response missing approaches");

      // MERGE, never replace. Each approach keeps every field Call 1 wrote
      // and gains only the four detail fields - so a Call 2 that somehow
      // returned a contradictory strategyDescription could not overwrite
      // the one the user has already read. Enforced here in code rather
      // than trusted to the prompt.
      const merged = {};
      for (const id of APPROACH_ORDER) {
        const base = summaryPlan.approaches[id];
        if (!base) continue;
        const d = detail.approaches[id] || {};
        merged[id] = {
          ...base,
          organizingGuidance: Array.isArray(d.organizingGuidance) ? d.organizingGuidance : [],
          taskChecklist: Array.isArray(d.taskChecklist) ? d.taskChecklist : [],
          productRecommendations: Array.isArray(d.productRecommendations) ? d.productRecommendations : [],
          visualizationDirection: typeof d.visualizationDirection === "string" ? d.visualizationDirection : null,
        };
      }
      // The one field Call 2 is allowed to have moved: spend ranges are
      // recomputed deterministically from the ESTABLISHED scopeSize, never
      // from anything Call 2 said.
      const withSpend = { scopeSize: summaryPlan.scopeSize, approaches: merged };
      applyDeterministicSpendRanges(withSpend);

      await updateDoc(doc(db, "users", user.uid, "plans", planId), {
        approaches: withSpend.approaches,
        analysisStage: "complete",
      });
      // Local state, so the open Results screen fills in without a reload
      // (§6 state 1 -> state 2). Guarded on the plan still being the one on
      // screen: a resume that finishes after the user navigated elsewhere
      // must not resurrect stale results.
      setHistory((prev) => prev.map((h) => (h.id === planId
        ? { ...h, approaches: withSpend.approaches, analysisStage: "complete" } : h)));
      // currentPlanIdRef, NOT currentPlanId (fix, 2026-08-12). This is why
      // a brand-new plan showed no detail even though Firestore said
      // "complete": runDetailCall closes over currentPlanId from the render
      // that created it, and on the create path that render happened before
      // savePlanToHistory's setCurrentPlanId landed - so the captured value
      // was still null from analyze()'s own reset. Fifty seconds later this
      // comparison was `newPlanId === null`, false, and the screen was never
      // told, leaving the Call 1 snapshot on display indefinitely while the
      // document underneath it was finished. The ref always holds the live
      // value, so the answer is about now rather than about then.
      if (planId === currentPlanIdRef.current) {
        setResults((prev) => (prev ? { ...prev, approaches: withSpend.approaches, analysisStage: "complete" } : prev));
      }
      const elapsed = Date.now() - startedAt;
      dlog(`[TWO-STAGE] detail merged for ${planId} in ${elapsed}ms (retry=${isRetry})`);
      logEvent(getAnalytics(), "analysis_detail_complete", { planId, ms: elapsed, retry: isRetry });
      return { outcome: "complete", ms: elapsed };
    } catch (e) {
      dlog(`[TWO-STAGE] detail failed for ${planId}: ${e.message}`);
      logEvent(getAnalytics(), "analysis_detail_failed", { planId, reason: e.code || e.message, retry: isRetry });
      // The plan is untouched and still "summary-ready" - a failure here
      // costs the user nothing they already had, which is the entire point
      // of writing the summary first.
      if (planId === currentPlanIdRef.current) setDetailError(e.message || "Couldn't load the full details.");
      return { outcome: "failed", reason: e.message };
    } finally {
      detailInFlightRef.current.delete(planId);
      setDetailRunning((prev) => { const next = { ...prev }; delete next[planId]; return next; });
    }
  };

  // AUTO-RESUME (§2, test g). Fires whenever the Results screen is showing
  // a plan that is still summary-ready - which covers both "app was closed
  // between the two calls" and "Call 2 failed earlier in this session and
  // the user navigated back". The in-flight guard makes it safe to
  // re-evaluate on every render.
  useEffect(() => {
    if (!results || !currentPlanId || !user?.uid) return;
    if (planAnalysisStage(results) !== "summary-ready") return;
    if (detailInFlightRef.current.has(currentPlanId)) return;
    // Do not auto-retry a call that already failed this session; the user
    // gets an explicit retry affordance instead, so a persistent failure
    // cannot become a silent request loop.
    if (detailError) return;
    runDetailCall(currentPlanId, results);
  }, [results, currentPlanId, user?.uid, detailError]);

  const finalizeAnalysisResult = async (parsedResult, canonicalSpaceId, analysesRemaining, areaId = null) => {
    let newPlanId;
    const planWithArea = areaId ? { ...parsedResult, areaId } : parsedResult;
    if (canonicalSpaceId) {
      const returningResult = await createReturningPlan(planWithArea, canonicalSpaceId);
      newPlanId = returningResult.planId;
      if (returningResult.outcome === "invalid-target-space") {
        // Point 2 (Step 1) working as designed: the target Room became
        // invalid (retired by a merge, or otherwise gone) between
        // proposing/navigating and finishing analysis. The analysis itself
        // (results, already set by the caller) is not thrown away -
        // surfaced honestly instead of silently creating an unrelated new
        // Room.
        Alert.alert("This room is no longer available", "It may have been merged with another room. Your new photo was still analyzed, but couldn't be saved to that room.");
      }
    } else {
      newPlanId = await savePlanToHistory(planWithArea);
    }
    // Approach Selection: "usable content produced" signal for analytics,
    // not a currentBatch check - simple.taskChecklist is a reasonable proxy
    // since every approach's checklist is generated together in the same
    // AI call. Unrelated to whether the user has started a plan yet.
    // Two-Stage Analysis: taskChecklist no longer exists at this point -
    // Call 1 does not produce it. The equivalent "usable content" signal
    // for Call 1 is a strategy per approach, which is exactly what the
    // collapsed cards need to be worth showing. The checklist's own
    // batch_shown event moves to Call 2's completion, where the checklist
    // actually arrives.
    const validSummary = APPROACH_ORDER.every((id) => typeof parsedResult.approaches?.[id]?.strategyDescription === "string"
      && parsedResult.approaches[id].strategyDescription.trim().length > 0);
    if (validSummary) {
      logEvent(getAnalytics(), "summary_shown", { planId: newPlanId });
    } else {
      logEvent(getAnalytics(), "summary_incomplete", { planId: newPlanId, reason: "missing_strategy" });
    }
    setTimeout(() => resultsScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
    // CALL 2 starts here: the moment a durable plan exists to merge into.
    // Deliberately not awaited - Results renders now, and the detail lands
    // underneath it when it lands. Nothing downstream depends on it, and a
    // rejection is handled inside runDetailCall, so there is no unhandled
    // promise even though the result is discarded.
    if (newPlanId) {
      runDetailCall(newPlanId, parsedResult);
    }
    // analysesRemaining is the server's real count (null means Pro/unlimited)
    // - AsyncStorage is now a display cache only, never authoritative.
    if (typeof analysesRemaining === "number") {
      const newCount = Math.max(0, 3 - analysesRemaining);
      setAnalyses(newCount);
      await AsyncStorage.setItem("analysisCount", newCount.toString());
    }
    return newPlanId;
  };

  // Room-First Identity, Phase B: NOT currently called anywhere - Phase B
  // never creates a plan (identity-capture only, zero Firestore writes),
  // so there is no planId yet for this to carry items onto. Left defined,
  // unchanged, for Phase C to call once real persistence exists (after
  // createReturningPlan/savePlanToHistory returns a real newPlanId) -
  // exactly the role it already played in Step 3, unaffected by Phase B's
  // routing changes.
  // Remembered Home v1 Step 3 (Implementation task, Companion hand-off /
  // test k): the recognition path cannot enrich its own initial
  // analyzePhoto prompt with prior context the way Step 2's Organize Again
  // does - recognition depends on spaceType, which only exists once that
  // same call has already returned (Question 5's own timing conclusion),
  // so there is no point before the call where the target Room, and
  // therefore its prior context, is knowable. Instead, prior unresolved
  // items are carried forward directly onto the new plan's own first
  // checklist immediately after creation - literal text carry-over, the
  // same mechanism (not AI-mediated) already used for in-session
  // batch-to-batch carry-over elsewhere in this file - guaranteeing the
  // original wording survives rather than a paraphrase. Placed first in
  // the list (ahead of the AI's fresh suggestions), matching the "pick up
  // where you left off" framing. Non-fatal: a failure here never
  // invalidates the plan/shadow write that already succeeded.
  const carryForwardUnresolvedItems = async (uid, planId, unresolvedItemTexts) => {
    if (!unresolvedItemTexts?.length) return;
    try {
      const planRef = doc(db, "users", uid, "plans", planId);
      const snap = await getDoc(planRef);
      if (!snap.exists() || !snap.data().currentBatch) return;
      const carriedItems = unresolvedItemTexts.map(text => ({ id: makeItemId(), text, status: "carried" }));
      const updatedItems = [...carriedItems, ...(snap.data().currentBatch.items || [])];
      await updateDoc(planRef, { "currentBatch.items": updatedItems });
      setHistory(prev => prev.map(h => h.id === planId ? { ...h, currentBatch: { ...h.currentBatch, items: updatedItems } } : h));
      // Safe to patch unconditionally: this function is only ever called
      // synchronously from confirmRecognitionCandidate, immediately after
      // it set `results` to this exact plan - nothing else can have
      // changed `results` to a different plan in between.
      setResults(prev => prev ? { ...prev, currentBatch: { ...prev.currentBatch, items: updatedItems } } : prev);
    } catch (e) {
      console.log("Carry-forward unresolved items error (non-fatal):", e.message);
    }
  };

  // ---- Room-First Identity, Phase C: Room confirmation -> persistence ----
  // The single completion point for every outcome (a/b1/b2/b3/c, and every
  // sub-path within them): builds the normalized confirmedPlan payload
  // from the CONFIRMED facts (resolvedResult), never the raw AI
  // suggestions directly, then persists it via createReturningPlan (an
  // existing Room) or savePlanToHistory (a new one) - the same two
  // functions every other creation path in this file already uses, not a
  // third, parallel save implementation. sourceCandidate (optional) is the
  // full recognition-candidate object when this confirmation came directly
  // from a matched candidate (outcome a, or a b1 card) - it carries
  // unresolvedItems for carry-forward; b2/b3/picker/freeform paths don't
  // have this (dedupeToKnownRooms's Room shape doesn't carry it), so
  // carry-forward simply doesn't fire there - a disclosed, low-stakes
  // limitation, not a silent gap (flagged in the implementation report).
  // Area Identity Phase B: the actual save + Area association/creation +
  // success bookkeeping, extracted from completeRoomConfirmation so it can
  // run either immediately (whole-room, new-room, or NO_MATCH - no pause
  // needed) or later, as the saveContinuation invoked once the user
  // resolves the Area confirmation screen (MATCH_FOUND/RECOGNITION_FAILED
  // - see beginAreaConfirmation). areaIntent is null for "no Area gating
  // needed, behave exactly like Phase A always did" or
  // {kind:"matched"|"picked", areaId} (associate with that existing Area,
  // no creation) or {kind:"new"} (create a fresh Area, same as Phase A).
  // Throws on failure rather than setting error state directly - the two
  // callers (completeRoomConfirmation's own immediate path, and
  // completeAreaConfirmation below) each display the error on whichever
  // screen is actually showing.
  const finishRoomConfirmationSave = async (resolvedResult, sourceCandidate, confirmedPlan, areaIntent) => {
    const pending = recognitionPendingRef.current;
    const planToSave = (areaIntent && areaIntent.kind !== "new") ? { ...confirmedPlan, areaId: areaIntent.areaId } : confirmedPlan;

    let newPlanId = null;
    if (resolvedResult.outcome === "existing-room") {
      const returningResult = await createReturningPlan(planToSave, resolvedResult.canonicalSpaceId);
      if (returningResult.outcome === "invalid-target-space") {
        throw new Error("This room is no longer available. It may have been merged with another room.");
      }
      newPlanId = returningResult.planId;
    } else {
      newPlanId = await savePlanToHistory(planToSave);
    }

    if (!newPlanId) {
      throw new Error("We couldn't save your plan. Please try again.");
    }

    // Area Identity: a whole-room outcome needs no action here at all -
    // areaId stays null/absent per confirmedPlan's own default. A
    // sub-area visit either associates with an EXISTING Area (matched via
    // Phase B recognition, or manually picked/chosen after a recognition
    // failure - areaId was already written directly onto the plan above,
    // so just maintain that Area's projection fields the same way every
    // other revisit already does, plus the same shadowSourceVersion
    // bump + resync Phase A's own bug fix established) or creates a brand
    // new one (Phase A's original path - no existing Areas, NO_MATCH, or
    // the user explicitly chose "this is a new area"). Non-fatal by
    // design either way (createAreaForPlan/updateAreaSummary never throw)
    // - a failure here never blocks the confirmation flow the user is
    // already past.
    const roomIdForArea = resolvedResult.outcome === "existing-room" ? resolvedResult.canonicalSpaceId : newPlanId;
    if (confirmedPlan.areaScope === "sub-area") {
      if (areaIntent && areaIntent.kind !== "new") {
        await updateDoc(doc(db, "users", user.uid, "plans", newPlanId), { shadowSourceVersion: increment(1) }).catch((e) => dlog(`[AREA RECOGNITION] shadowSourceVersion bump failed for plan ${newPlanId}: ${e.message}`));
        await syncPlanToSpaceGraph(user.uid, newPlanId).catch((e) => dlog(`[AREA RECOGNITION] shadow resync failed for plan ${newPlanId}: ${e.message}`));
        await updateAreaSummary(user.uid, roomIdForArea, areaIntent.areaId);
      } else {
        await createAreaForPlan(user.uid, roomIdForArea, newPlanId, confirmedPlan.areaName);
      }
    }

    // Success - only now clear the pending/confirmation state and
    // navigate. Everything above this point is retry-safe: a failure
    // never touched roomConfirmation/areaConfirmation, recognitionPendingRef,
    // or results.
    lastRoomConfirmationAttemptRef.current = null;
    lastAreaConfirmationAttemptRef.current = null;
    recognitionPendingRef.current = null;
    areaConfirmationPendingRef.current = null;
    setRoomFreeformInput("");
    setRoomConfirmationSaving(false);
    setRoomConfirmationError(null);
    setAreaConfirmationSaving(false);
    setAreaConfirmationError(null);
    setAreaConfirmation(null);
    setPendingRoomConfirmationResult(resolvedResult);
    dlog(`[ROOM-FIRST] resolved confirmation persisted: ${JSON.stringify(resolvedResult)}, planId=${newPlanId}, areaIntent=${JSON.stringify(areaIntent)}`);
    logEvent(getAnalytics(), "room_confirmation_resolved", { outcome: resolvedResult.outcome });

    // CALL 2 (Two-Stage Analysis). This was the bug: runDetailCall was only
    // ever kicked off from finalizeAnalysisResult, and THIS path never calls
    // it - finishRoomConfirmationSave writes the plan itself, via
    // createReturningPlan or savePlanToHistory directly. So every plan
    // created through Room confirmation (the whole generic-camera flow) was
    // stranded at "summary-ready" with no detail, while plans from "Organize
    // Another Area" completed normally, because that path does go through
    // finalizeAnalysisResult. Not awaited - Results renders now and the
    // detail lands underneath it.
    //
    // The stamp below matters just as much. setResults was handed
    // confirmedPlan, which carries no analysisStage, so planAnalysisStage()
    // read it as "complete" and the auto-resume effect - the backstop that
    // should have caught this - bailed on every render. Stamping the
    // in-memory object makes that effect a real universal safety net
    // instead of dead code, for this path and any future one.
    setResults((prev) => (prev ? { ...prev, analysisStage: "summary-ready" } : prev));
    runDetailCall(newPlanId, confirmedPlan);

    // Point 3: welcome-back fires ONLY for a genuine returning
    // confirmation - the user explicitly said "yes, I'm returning," so
    // "Welcome back to your X" is honest, unlike Phase B's transitional
    // state where nothing was actually confirmed yet.
    if (resolvedResult.outcome === "existing-room") {
      // unresolvedCount drives the banner's actionable-vs-quiet split
      // below - the same signal already used to decide whether
      // carryForwardUnresolvedItems fires at all (a few lines down), not
      // a separate derivation. sourceCandidate carries this Room's own
      // most-recent unresolved items regardless of what area within the
      // Room today's photo targets (recognition matches at the Room
      // level - see findRecognitionCandidates - so the same candidate,
      // and the same unresolvedItems, come back whether today's
      // suggestedAreaName is the whole Room or one specific area inside
      // it). Only populated for outcome (a)/a b1 card (sourceCandidate is
      // a real recognition candidate there); b2/b3/picker/freeform paths
      // pass no sourceCandidate at all, so this is correctly 0 for them -
      // a pre-existing, disclosed limitation (see completeRoomConfirmation's
      // own comment above), not something this change introduces.
      setJustConfirmedRecognition({
        displayName: resolvedResult.confirmedRoomName,
        unresolvedCount: sourceCandidate?.unresolvedItems?.length || 0,
      });
    }

    setRoomConfirmation(null);
    // photoUrl from this plan's own upload, which finished inside
    // savePlanToHistory before confirmedPlan (which has none) is shown.
    setResults(mergeUploadedPhotoUrl(confirmedPlan, newPlanId, lastPhotoUploadRef.current));
    logEvent(getAnalytics(), "plan_completed");
    requestTrackingPermissionWhenClear();

    // Approach Selection: same "usable content produced" analytics proxy as
    // finalizeAnalysisResult's identical check - see its own comment.
    const validBatch = Array.isArray(confirmedPlan.approaches?.simple?.taskChecklist) && confirmedPlan.approaches.simple.taskChecklist.filter(t => typeof t === "string" && t.trim()).length > 0;
    if (validBatch) {
      logEvent(getAnalytics(), "batch_shown", { planId: newPlanId, batchIndex: 1 });
    } else {
      logEvent(getAnalytics(), "batch_generation_failed", { planId: newPlanId, batchIndex: 1, reason: "missing_batch" });
    }
    setTimeout(() => resultsScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
    if (typeof pending?.analysesRemaining === "number") {
      const newCount = Math.max(0, 3 - pending.analysesRemaining);
      setAnalyses(newCount);
      await AsyncStorage.setItem("analysisCount", newCount.toString());
    }

    // Carry-forward (Step 3's existing mechanism) - only when this
    // confirmation came directly from a matched candidate that actually
    // carries unresolvedItems (outcome a, or a b1 card).
    if (sourceCandidate?.unresolvedItems?.length) {
      await carryForwardUnresolvedItems(user.uid, newPlanId, sourceCandidate.unresolvedItems);
    }
  };

  // ---- Room-First Identity, Phase C: Room confirmation -> persistence ----
  // The single completion point for every outcome (a/b1/b2/b3/c, and every
  // sub-path within them): builds the normalized confirmedPlan payload
  // from the CONFIRMED facts (resolvedResult), never the raw AI
  // suggestions directly, then either saves immediately (via
  // finishRoomConfirmationSave, whole-room/new-room/no-existing-Areas) or
  // pauses for Area Identity Phase B's own confirmation screen first
  // (existing-room + sub-area + at least one existing Area) - the
  // governing invariant: no plan is saved until BOTH Room and Area
  // identity are established.
  const completeRoomConfirmation = async (resolvedResult, sourceCandidate) => {
    const pending = recognitionPendingRef.current;
    if (!pending) return; // defensive - not reachable while the screen isn't showing
    // Re-entry guard (on-device fix, 2026-08-12). A ref, not the
    // roomConfirmationSaving state, because state is the thing that cannot
    // be trusted here: setRoomConfirmationSaving(true) does not take effect
    // until React re-renders, so two taps landing in the same frame BOTH
    // passed a state check and both ran the whole save - creating the plan
    // twice. A ref flips synchronously, so the second tap loses the race
    // even if the overlay has not painted a single pixel yet.
    if (roomConfirmationInFlightRef.current) return;
    roomConfirmationInFlightRef.current = true;
    lastRoomConfirmationAttemptRef.current = { resolvedResult, sourceCandidate };
    setRoomConfirmationError(null);
    setRoomConfirmationSaving(true);

    // Room-First Identity Phase C, point 1: the confirmation result, not
    // the transient AI suggestion, determines persisted identity.
    // suggestedRoomName/suggestedAreaName/roomReason/areaReason survive on
    // this object only as inputs to savePlanToHistory's own explicit field
    // list (which never spreads them into what's written - see its own
    // declaration) - never persisted themselves (Constraint 1/2).
    const confirmedPlan = {
      ...pending.parsed,
      spaceType: pending.parsed.suggestedRoomName,
      spaceName: resolvedResult.confirmedRoomName,
      areaName: resolvedResult.areaName,
      areaScope: resolvedResult.areaScope,
    };

    if (resolvedResult.outcome === "existing-room" && confirmedPlan.areaScope === "sub-area") {
      try {
        const areasSnap = await getDocs(collection(db, "users", user.uid, "spaces", resolvedResult.canonicalSpaceId, "areas"));
        const existingAreas = areasSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => !a.retired);
        if (existingAreas.length > 0) {
          // THE "Existing Room" DELAY (on-device fix, 2026-08-12).
          //
          // The overlay used to be switched OFF on this line, immediately
          // before beginAreaConfirmation - which compresses the photo and
          // runs visual Area recognition through a Cloud Function. That is
          // the multi-second gap the user hit: the spinner vanished and the
          // screen sat there looking finished and unresponsive, so they
          // tapped again. The overlay now stays up across that work and is
          // cleared only once the Area confirmation screen is ready.
          setRoomConfirmationText("Checking your areas...");
          await beginAreaConfirmation({
            roomId: resolvedResult.canonicalSpaceId,
            existingAreas,
            suggestedAreaName: confirmedPlan.areaName,
            saveContinuation: (areaIntent) => finishRoomConfirmationSave(resolvedResult, sourceCandidate, confirmedPlan, areaIntent),
          });
          setRoomConfirmationSaving(false);
          setRoomConfirmationText("Setting up your plan...");
          // The user now acts on the Area screen, so this flow is no longer
          // in flight and its guard must not stay latched.
          roomConfirmationInFlightRef.current = false;
          return; // paused - Area confirmation screen now showing, nothing saved yet
        }
      } catch (e) {
        dlog(`[AREA RECOGNITION] existing-areas lookup failed for room ${resolvedResult.canonicalSpaceId}, proceeding as a fresh Area (Phase A path): ${e.message}`);
        // fall through - treated exactly like "zero existing areas"
      }
    }

    try {
      await finishRoomConfirmationSave(resolvedResult, sourceCandidate, confirmedPlan, null);
    } catch (e) {
      setRoomConfirmationSaving(false);
      setRoomConfirmationError(e.message || "Something went wrong saving your plan. Please try again.");
      console.log("Room confirmation save error:", e.message);
    } finally {
      // Released on BOTH paths. On success the screen is gone and the guard
      // is moot; on failure the retry affordance has to actually work, and
      // a latched guard would make Retry a silent no-op - a worse bug than
      // the one being fixed.
      roomConfirmationInFlightRef.current = false;
    }
  };

  const retryRoomConfirmation = () => {
    const attempt = lastRoomConfirmationAttemptRef.current;
    if (attempt) completeRoomConfirmation(attempt.resolvedResult, attempt.sourceCandidate);
  };

  // Area Identity Phase B: the shared gate used by BOTH integration points
  // (completeRoomConfirmation above, and analyze()'s "Organize Another
  // Area" returning-visit branch) - each supplies its own saveContinuation
  // (what to actually do once Area identity resolves) and otherwise goes
  // through identical recognition/proposal logic, so the two entry paths
  // can never drift into two different Area-recognition behaviors.
  // NO_MATCH resolves immediately with zero UI friction (design doc's own
  // explicit rule) - only MATCH_FOUND and RECOGNITION_FAILED ever show the
  // proposal screen; a caller with zero existingAreas never even reaches
  // recognition at all (Phase A path).
  const beginAreaConfirmation = async ({ roomId, existingAreas, suggestedAreaName, saveContinuation }) => {
    const eligible = (existingAreas || []).filter((a) => !a.retired);
    if (eligible.length === 0) {
      await saveContinuation({ kind: "new" });
      return;
    }

    let newPhotoBase64 = null;
    try {
      const compressed = await manipulateAsync(photo.uri, [{ resize: { width: 768 } }], { compress: 0.5, format: SaveFormat.JPEG, base64: true });
      newPhotoBase64 = compressed.base64;
    } catch (e) {
      dlog(`[AREA RECOGNITION] today's photo compression failed, treating as a recognition failure: ${e.message}`);
      areaConfirmationPendingRef.current = { saveContinuation };
      setAreaConfirmationError(null);
      setAreaConfirmation({ status: "RECOGNITION_FAILED", candidates: [], existingAreas: eligible, roomId, view: "main" });
      return;
    }

    const result = await findAreaRecognitionCandidates(roomId, newPhotoBase64, eligible, suggestedAreaName, user.uid);

    if (result.status === "NO_MATCH") {
      await saveContinuation({ kind: "new" });
      return;
    }

    // MATCH_FOUND or RECOGNITION_FAILED - pause here, nothing saved yet.
    areaConfirmationPendingRef.current = { saveContinuation };
    setAreaConfirmationError(null);
    setAreaConfirmation({ status: result.status, candidates: result.candidates, existingAreas: eligible, roomId, view: "main" });
  };

  const completeAreaConfirmation = async (areaIntent) => {
    const pending = areaConfirmationPendingRef.current;
    if (!pending) return; // defensive - not reachable while the screen isn't showing
    lastAreaConfirmationAttemptRef.current = { areaIntent };
    setAreaConfirmationError(null);
    setAreaConfirmationSaving(true);
    try {
      // Success clears areaConfirmation/areaConfirmationPendingRef and
      // navigates itself (inside finishRoomConfirmationSave, or the
      // "Organize Another Area" continuation's own equivalent tail) -
      // mirrors completeRoomConfirmation's "only clear on success"
      // discipline, nothing further to do here on the happy path.
      await pending.saveContinuation(areaIntent);
    } catch (e) {
      setAreaConfirmationSaving(false);
      setAreaConfirmationError(e.message || "Something went wrong saving your plan. Please try again.");
      console.log("Area confirmation save error:", e.message);
    }
  };

  const retryAreaConfirmation = () => {
    const attempt = lastAreaConfirmationAttemptRef.current;
    if (attempt) completeAreaConfirmation(attempt.areaIntent);
  };

  // Area Identity Phase B: the "Organize Another Area" integration point's
  // own saveContinuation (mirrors finishRoomConfirmationSave's role for
  // the generic-camera path) - invoked once Area identity resolves (either
  // immediately, via beginAreaConfirmation's NO_MATCH/zero-Areas shortcut,
  // or after the user resolves the proposal screen). Sets results/clears
  // organizeAgainContext here, at the point identity is actually final -
  // relocated from analyze()'s own body (where this used to run
  // unconditionally, before Area identity could possibly be known) to
  // here, its natural new home. Throws on failure (mirrors
  // finishRoomConfirmationSave) so completeAreaConfirmation's own catch
  // surfaces it on whichever screen is showing.
  const finishOrganizeAnotherAreaSave = async (parsed, returningContext, analysesRemaining, areaIntent) => {
    // Stamp the resolved identity onto the in-memory results before it is
    // displayed (Results heading bug, 2026-08-12).
    //
    // `parsed` is the raw AI object: it carries spaceType (the AI's guess -
    // "Bedroom") and has NO canonicalSpaceId and NO spaceName. The SAVED
    // document gets both a moment later, but the object handed to
    // setResults did not, so resolveResultsRoomName had nothing to resolve
    // through: roomId fell back to currentPlanId, which is a plan id and
    // never matches a Space id, and the lookup then fell through to
    // getSpaceDisplayName -> spaceType -> "Bedroom".
    //
    // Not a rooms-loading race. `rooms` was loaded the whole time; the
    // object being resolved simply had no canonical identity on it. The
    // Room-confirmation path never showed this because it passes
    // confirmedPlan, which already carries spaceName.
    const resolvedRoomName = (rooms.find((r) => r.id === returningContext.spaceId) || {}).displayName
      || returningContext.spaceName || parsed.spaceName || null;
    setResults({ ...parsed, canonicalSpaceId: returningContext.spaceId, spaceName: resolvedRoomName, analysisStage: "summary-ready" });
    logEvent(getAnalytics(), "plan_completed");
    requestTrackingPermissionWhenClear();
    setOrganizeAgainContext(null);

    const resolvedAreaId = (areaIntent && areaIntent.kind !== "new") ? areaIntent.areaId : null;
    const returningPlanId = await finalizeAnalysisResult(parsed, returningContext.spaceId, analysesRemaining, resolvedAreaId);
    if (!returningPlanId) {
      throw new Error("We couldn't save your plan. Please try again.");
    }

    if (areaIntent && areaIntent.kind !== "new") {
      // Matched/picked an EXISTING Area - areaId was already written
      // directly onto the plan above via finalizeAnalysisResult's own
      // areaId param (same contract the existing-Area Organize Again path
      // already uses). Maintain the Area's projection fields the same way
      // every other revisit already does, plus the same
      // shadowSourceVersion bump + resync Phase A's own bug fix
      // established, for uniformity/defense in depth.
      await updateDoc(doc(db, "users", user.uid, "plans", returningPlanId), { shadowSourceVersion: increment(1) }).catch((e) => dlog(`[AREA RECOGNITION] shadowSourceVersion bump failed for plan ${returningPlanId}: ${e.message}`));
      await syncPlanToSpaceGraph(user.uid, returningPlanId).catch((e) => dlog(`[AREA RECOGNITION] shadow resync failed for plan ${returningPlanId}: ${e.message}`));
      await updateAreaSummary(user.uid, returningContext.spaceId, areaIntent.areaId);
    } else {
      // NO_MATCH, zero existing Areas, or the user explicitly chose "this
      // is a new area" - create fresh (Phase A's original path).
      await createAreaForPlan(user.uid, returningContext.spaceId, returningPlanId, parsed.suggestedAreaName ?? null);
    }

    lastAreaConfirmationAttemptRef.current = null;
    areaConfirmationPendingRef.current = null;
    setAreaConfirmationSaving(false);
    setAreaConfirmationError(null);
    setAreaConfirmation(null);
  };

  // Declining outcome (a)/(b1)/(b2)/(b3) falls through to outcome (c) IN
  // PLACE - RoomFirstIdentityDesign.md's own "decline -> outcome (c)" rule
  // for every declinable path, no new recognition run (the same
  // knownRooms/pending analysis stay valid).
  const declineToOutcomeC = () => {
    setRoomConfirmation(prev => prev ? { ...prev, routing: { outcome: "c" }, view: "main", pickerContext: null, freeformContext: null } : prev);
  };

  const openRoomPicker = (pickerContext) => {
    setRoomConfirmation(prev => prev ? { ...prev, view: "picker", pickerContext } : prev);
  };

  const openRoomFreeform = (freeformContext) => {
    setRoomFreeformInput("");
    setRoomConfirmation(prev => prev ? { ...prev, view: "freeform", freeformContext } : prev);
  };

  const backToRoomConfirmationMain = () => {
    setRoomFreeformInput("");
    setRoomConfirmation(prev => prev ? { ...prev, view: "main", pickerContext: null, freeformContext: null } : prev);
  };

  // Room picker selection - used by b1's decline-fallback, b2/b3's
  // "choose another Room", and outcome (c)'s existing-Rooms secondary
  // option. pickerContext decides what the same selection means: a
  // "-inside" context means the picked Room becomes the PARENT of the
  // ambiguous label (areaName set, sub-area); every other context is a
  // plain "this plan belongs to this Room" confirmation, passing the AI's
  // own area fields through unchanged (same as outcome (a)).
  const onRoomPickerSelect = (room) => {
    const parsed = recognitionPendingRef.current?.parsed;
    const ctx = roomConfirmation?.pickerContext;
    if (ctx === "b2-inside" || ctx === "b3-inside") {
      completeRoomConfirmation(resolveExistingRoomConfirmation(room, { areaName: parsed?.suggestedRoomName ?? null, areaScope: "sub-area" }));
    } else {
      completeRoomConfirmation(resolveExistingRoomConfirmation(room, { areaName: parsed?.suggestedAreaName ?? null, areaScope: parsed?.areaScope || "whole-room" }));
    }
  };

  // b2/b3's "[Label] is its own Room" - checks routing.exactStandaloneMatch
  // first (RoomFirstIdentityDesign.md §4 b2's own nuance: if a real
  // existing Room already shares this exact label, confirm THAT Room
  // rather than creating a duplicate).
  const onOwnRoom = () => {
    const routing = roomConfirmation?.routing;
    const parsed = recognitionPendingRef.current?.parsed;
    if (routing?.outcome === "b2" && routing.exactStandaloneMatch) {
      completeRoomConfirmation(resolveExistingRoomConfirmation(routing.exactStandaloneMatch, { areaName: null, areaScope: "whole-room" }));
      return;
    }
    const label = routing?.outcome === "b3" ? routing.candidate.displayName : parsed?.suggestedRoomName;
    completeRoomConfirmation(resolveNewRoomConfirmation(label, { areaName: null, areaScope: "whole-room" }));
  };

  // b2/b3's specific "[Label] is inside [Room]" button (the plausibleParent
  // case, shown only when exactly one plausible parent was found) - same
  // resolution as picking that same Room from the picker.
  const onInsideSpecificParent = () => {
    const parent = roomConfirmation?.routing?.plausibleParent;
    if (parent) onRoomPickerSelect(parent);
  };

  // Freeform Room-name entry - covers outcome (c)'s tertiary option, and
  // the first-time-zero-Rooms b2 variant's two freeform choices.
  // "b2-parent-zero" ("Create the Room it belongs to"): the typed name
  // becomes the whole NEW Room; the ambiguous label becomes its area -
  // this is the one freeform path where areaName/areaScope survive.
  // Every other freeform path: the typed name IS the whole Room: the user
  // is asserting this is its own thing under a name they chose, so the
  // area distinction dissolves (areaName null, whole-room).
  const onSubmitRoomFreeform = () => {
    const trimmed = roomFreeformInput.trim();
    if (!trimmed) return;
    const parsed = recognitionPendingRef.current?.parsed;
    if (roomConfirmation?.freeformContext === "b2-parent-zero") {
      completeRoomConfirmation(resolveNewRoomConfirmation(trimmed, { areaName: parsed?.suggestedRoomName ?? null, areaScope: "sub-area" }));
    } else {
      completeRoomConfirmation(resolveNewRoomConfirmation(trimmed, { areaName: null, areaScope: "whole-room" }));
    }
  };

  // Outcome (c) primary: accept the AI's own suggestion as-is.
  const onAcceptSuggestedRoom = () => {
    const parsed = recognitionPendingRef.current?.parsed;
    completeRoomConfirmation(resolveNewRoomConfirmation(parsed?.suggestedRoomName, { areaName: parsed?.suggestedAreaName ?? null, areaScope: parsed?.areaScope || "whole-room" }));
  };

  const analyze = async () => {
    setVizImage({});
    setVizLoading({});
    console.log("Analyze called");
    console.log("Photo exists:", !!photo);
    console.log("Photo base64 exists:", !!photo?.base64);
    console.log("isPro:", isPro);
    console.log("analyses:", analyses);
    if (!photo?.base64) { setErr("Please select a photo first."); return; }
    if (!isPro && (analyses || 0) >= 3) { setShowPaywall(true); return; }
    console.log("Starting analysis...");
    if (lastFailedAnalysisRef.current && lastFailedAnalysisRef.current.photoUri === photo?.uri) {
      analysisIdRef.current = lastFailedAnalysisRef.current.analysisId; // retry of the same photo - reuse, don't consume a second free use
    } else {
      analysisIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    setLoading(true); setErr(null); setResults(null); setCurrentPlanId(null); startLoadMessages();
    // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1e): snapshot
    // once, here, rather than reading organizeAgainContext again later in
    // this function - this function is async and organizeAgainContext is
    // consumed and cleared partway through (see below), so every later
    // reference in this function uses this same captured value, never the
    // live state.
    const returningContext = organizeAgainContext;
    try {
      // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1e): exactly
      // the two justified context items, nothing else - full past
      // overview/proTip text, session history, and completed items are
      // deliberately excluded (§1e's own rejection list). Unresolved =
      // "carried" or the last batch's still-"pending" items - the design
      // doc's own precise two-value definition, not every status other
      // than "checked" (which would also sweep in "skipped" items the
      // user already explicitly decided against, not left unresolved).
      let priorContextNote = "";
      let priorPhotoBase64 = null;
      if (returningContext?.priorItem) {
        const priorItem = returningContext.priorItem;
        const unresolvedItems = (priorItem.currentBatch?.items || [])
          .filter(i => i.status === "carried" || i.status === "pending")
          .map(i => i.text)
          .filter(Boolean);
        if (unresolvedItems.length) {
          priorContextNote = `\n\nThis space was organized before. From the user's last session here, these specific items were left unresolved: ${unresolvedItems.map(t => `"${t}"`).join(", ")}. If any of these are still visible and relevant in today's photo, fold them into this session's checklist once, correctly, rather than re-discovering or re-suggesting them as if new. If one no longer applies, don't mention it.`;
        }
        const lastProgressUrl = priorItem.progressPhotos?.length
          ? priorItem.progressPhotos[priorItem.progressPhotos.length - 1].url
          : (priorItem.photoUrl || null);
        if (lastProgressUrl) {
          try {
            const localUri = FileSystem.cacheDirectory + `organize_again_prior_${analysisIdRef.current}.jpg`;
            const { uri: priorUri } = await FileSystem.downloadAsync(lastProgressUrl, localUri);
            const compressedPrior = await manipulateAsync(priorUri, [{ resize: { width: 768 } }], { compress: 0.5, format: SaveFormat.JPEG, base64: true });
            priorPhotoBase64 = compressedPrior.base64;
          } catch (priorPhotoErr) {
            // Non-fatal - proceed without the prior photo rather than
            // blocking this analysis over a download failure. Matches this
            // file's existing tolerance for photo-pipeline failures
            // elsewhere (e.g. compressPhoto's own try/catch).
            console.log("Prior progress photo fetch failed (proceeding without it):", priorPhotoErr.message);
          }
        }
      }
      // Known-identity AI context (Existing Area -> Organize Again,
      // 2026-08-09): when returningContext carries BOTH spaceId and areaId,
      // Room and Area identity are already established by the user's own
      // navigation (the tap itself - AreaIdentityDesign.md's governing
      // principle: only explicit user confirmation establishes identity),
      // never by this photo's own AI classification. suggestedRoomName/
      // suggestedAreaName are still requested in the JSON schema below and
      // still correctly ignored for filing (canonicalSpaceId/areaId come
      // from returningContext, see finalizeAnalysisResult) - but nothing
      // previously stopped the model's own free-text prose (overview,
      // tasks, product suggestions, pro tip) from using a DIFFERENT room's
      // name. Real staging evidence: the same physical Corner Shelf photo
      // was twice classified suggestedRoomName "Entryway" - filing was
      // correctly unaffected, but the checklist text itself said "...this
      // entryway space." This note grounds the prose without touching the
      // classification instructions (roomAreaInstruction, below) at all -
      // the model still analyzes the real photo content, it just narrates
      // it under the names the user already confirmed by navigating here.
      // Room-level-only Organize Again ("Organize Another Area," areaId
      // null) deliberately does NOT get this note - the Area itself is
      // genuinely undetermined in that case, so there is no confirmed Area
      // name yet to ground the prose with.
      let knownIdentityNote = "";
      if (returningContext?.spaceId && returningContext?.areaId) {
        try {
          let knownRoomName = rooms.find(r => r.id === returningContext.spaceId)?.displayName || null;
          if (!knownRoomName) {
            const spaceSnap = await getDoc(doc(db, "users", user.uid, "spaces", returningContext.spaceId));
            knownRoomName = spaceSnap.exists() ? (spaceSnap.data().displayName || null) : null;
          }
          const areaSnap = await getDoc(doc(db, "users", user.uid, "spaces", returningContext.spaceId, "areas", returningContext.areaId));
          const knownAreaName = areaSnap.exists() ? (areaSnap.data().displayName || null) : null;
          if (knownRoomName && knownAreaName) {
            knownIdentityNote = `\n\nThe user has confirmed they are organizing "${knownAreaName}" in their "${knownRoomName}". Use these exact names in all generated text (overview, approach strategies, organizing guidance, task checklists, product recommendations, pro tip) - never refer to this space by any other room or area name, even if the photo visually resembles a different kind of room. Do not reclassify or rename the Room or Area. Still analyze the actual photo content for clutter, tasks, and recommendations - this only affects naming, not the organizing analysis itself.`;
          }
        } catch (identityLookupErr) {
          // Non-fatal - proceed without the grounding note rather than
          // blocking this analysis over a lookup failure, matching this
          // function's existing tolerance for photo-pipeline failures
          // (e.g. the prior-photo fetch above).
          console.log("Known-identity lookup failed (proceeding without grounding):", identityLookupErr.message);
        }
      }
      // Same prompt as today, byte-for-byte, when priorPhotoBase64 is null
      // (every first-time analysis, and any returning visit whose prior
      // plan happened to have no progress photo) - priorPhotoPreamble and
      // priorContextNote are both "" in that case, so this template
      // literal reduces to exactly today's string. See generateNextAction
      // (functions/index.js) for the proven precedent of narrating a fixed
      // multi-image order in the prompt text itself.
      const priorPhotoPreamble = priorPhotoBase64
        ? `You are shown two photos, in this exact order. Photo 1 is how this space looked during the last organizing session - prior evidence only, not something to re-describe. Photo 2 is how it looks right now, today. Base every recommendation on what is genuinely visible in Photo 2 (today's photo) - Photo 1 is only for noticing what has changed since last time, never a substitute for looking freshly at today's photo.\n\n`
        : "";
      // Room-First Identity (Implementation Phase A): two separate
      // classification questions, not one flat label - RoomFirstIdentityDesign
      // (the design pass this implements) §1a. Placed right before the
      // "never use em dashes"/JSON-contract tail, same position the old
      // single-field instruction never needed since spaceType had no
      // classification logic of its own to explain.
      //
      // Organizing Target vs. Room Location revision (2026-08-07): the
      // original single question ("what kind of room does this photo
      // appear to show?") made Room and Area compete for the same answer,
      // and used "multiple furniture types visible" as its whole-room
      // signal - which misclassified a tightly-organizing-target photo
      // (e.g. an entertainment center with a couch and window merely
      // visible in the background) as whole-room just because more than
      // one kind of furniture was in frame. Reordered into three
      // independent questions - organizing target first, then the room it
      // lives in, then whether that target IS the room or a part of it -
      // so scope is decided by what the user wants organized, never by how
      // much background happens to be in the shot. Output schema
      // unchanged: still suggestedRoomName/suggestedAreaName/areaScope/
      // roomReason/areaReason, only the reasoning path to each changed.
      // Sub-area prompt tightening (2026-08-08): real staging evidence
      // (AreaIdentityDesign.md-adjacent investigation, not part of Area
      // Identity itself) showed the model dodging the letter of the old
      // "do NOT use multiple furniture types visible" prohibition while
      // keeping its substance - areaReason literally read "multiple
      // furniture pieces... not focused on a single fixture" for a photo
      // whose own roomReason had already correctly named the TV console
      // as the dominant subject. Banning one phrase didn't ban the
      // reasoning pattern behind it. Replaced with a positive test the
      // model must pass before it's allowed to say whole-room (can you
      // NAME the one thing the user wants organized?), plus an explicit
      // list of paraphrase variants of the old banned reasoning - drawn
      // directly from the real failure's own wording - so restating the
      // same heuristic in different words no longer works either.
      //
      // Second tightening (2026-08-09): the first revision wasn't
      // sufficient by itself - real staging evidence showed the model's
      // own `overview` correctly describing one specific fixture ("your
      // corner shelf is looking wonderfully styled...") while its
      // `areaScope` still said "whole-room" in the same response. The
      // classification and the free-text description were answering
      // different questions about the same photo, not contradicting each
      // other on the same question - the first revision's positive test
      // governs the CLASSIFICATION step but nothing previously forced
      // that classification to actually agree with what the model was
      // about to write in `overview`. Added an explicit self-consistency
      // check as the last instruction before the JSON schema, closest to
      // where generation actually begins.
      // Approach Selection Phase A (ApproachSelectionDesign.md Sections
      // 2/3): replaces the old per-tier budget-math + single checklist
      // paragraph entirely. priorPhotoPreamble, priorContextNote,
      // knownIdentityNote, the em-dash rule, and roomAreaInstruction are
      // all unchanged, exactly as before this phase.
      //
      // Phase B.1 (AIAnalysisRedesign.md): replaces approachesInstruction
      // entirely. Three real problems found in on-device testing (a real
      // dining room photo): (1) the AI stated guesses as facts - a
      // portable puzzle board became "printer", with no certainty
      // framework anywhere to catch it; (2) analysis only ever looked for
      // clutter, never for completion opportunities (blank walls, unstyled
      // niches, missing lighting); (3) the three approaches differed only
      // by spending, not by ambition - "clear the table, organize the
      // bottles, arrange the credenza" at three price points. Validated
      // against the same real photo before shipping (9.5/10 test
      // criteria, then a full 20/20 second pass after fixing one
      // Firestore-arrayUnion bug found along the way - see
      // AIAnalysisRedesignImplementation.md for the real before/after
      // output this replaces).
      // Two-Stage Analysis: this is now CALL 1 (summary) only. The
      // instruction blocks moved to module scope so the detail call can
      // compose from the same source - see buildSummaryPrompt.
      const prompt = buildSummaryPrompt({ priorPhotoPreamble, priorContextNote, knownIdentityNote, isReturning: !!priorPhotoBase64 });

      // Check base64 size - if too large, warn user
      const sizeKB = Math.round((photo.base64.length * 3 / 4) / 1024);
      console.log("Photo size KB:", sizeKB);

      // Compress image right before sending
      let imageBase64 = photo.base64;
      try {
        console.log("Compressing before send...");
        const compressed = await manipulateAsync(
          photo.uri,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: SaveFormat.JPEG, base64: true }
        );
        imageBase64 = compressed.base64;
        console.log("Original length:", photo.base64.length, "Compressed:", imageBase64.length);
      } catch (ce) {
        console.log("Compression failed, using original:", ce.message);
      }

      console.log("Starting API call...");
      console.log("Photo base64 length:", imageBase64?.length);
      console.log("Photo mime:", photo.mimeType);

      logEvent(getAnalytics(), "plan_started");

      const analyzePhotoFn = httpsCallable(functions, "analyzePhoto");
      let raw = "";
      let analysesRemaining = null; // server's real count, per this analysis - not a local guess
      try {
        const result = await analyzePhotoFn({ imageBase64, prompt, analysisId: analysisIdRef.current, priorPhotoBase64 });
        raw = result.data?.text || "";
        analysesRemaining = typeof result.data?.analysesRemaining === "number" ? result.data.analysesRemaining : null;
        dlog(`[COMPANION DEBUG 1] raw analyzePhotoFn response: ${raw}`);
      } catch (fnErr) {
        console.log("Function error:", fnErr.code, fnErr.message);
        if (fnErr.code === "functions/resource-exhausted") {
          // Server-enforced free-plan limit, not a transient failure - show
          // the paywall directly rather than a generic error message.
          setShowPaywall(true);
          return;
        }
        lastFailedAnalysisRef.current = { analysisId: analysisIdRef.current, photoUri: photo?.uri };
        logEvent(getAnalytics(), "plan_failed", { reason: fnErr.code });
        if (fnErr.code === "functions/unavailable" || (fnErr.message || "").includes("Network")) {
          setErr("No internet connection. Please check your WiFi or cellular and try again.");
        } else {
          setErr("Something went wrong analyzing your photo. Please try again.");
        }
        return;
      }
      const match = raw.match(/\{[\s\S]*\}/);
      dlog(`[COMPANION DEBUG 2] regex match found: ${!!match} | extracted length: ${match ? match[0].length : 0}`);
      if (!match) {
        lastFailedAnalysisRef.current = { analysisId: analysisIdRef.current, photoUri: photo?.uri };
        logEvent(getAnalytics(), "plan_failed", { reason: "unparseable_response" });
        setErr("We had trouble reading your space. Try a clearer, well-lit photo.");
        return;
      }
      // Backstop for the prompt's own "never use em dashes" instruction -
      // covers every free-form field the model wrote (overview, proTip,
      // suggestions, firstAction, etc.), not just Companion text.
      const parsed = sanitizeAiText(JSON.parse(match[0]));
      // Room-First Identity (Implementation Phase A): getSpaceDisplayName
      // (shared/spaceMigration.js) reads spaceName||spaceType - a stable,
      // widely-used contract this change deliberately does not touch, since
      // every SAVED plan document continues to have spaceType populated
      // (savePlanToHistory now sources it from suggestedRoomName). But
      // `results`/`parsed` is displayed (Results screen header, share
      // sheet, image-generation prompt) for a window BEFORE the background
      // save completes, and the AI no longer returns spaceType directly -
      // this local alias keeps that window showing the same label it
      // always has, in memory only, matching exactly what savePlanToHistory
      // is about to persist a moment later. Not a Constraint 1 violation:
      // Constraint 1 governs the PERSISTED document (built independently,
      // explicitly, in savePlanToHistory) - this is a local display
      // convenience on the transient in-memory object, same value either way.
      parsed.spaceType = parsed.suggestedRoomName;
      // Approach Selection Phase A (ApproachSelectionDesign.md Section 3):
      // overwrites each approach's estimatedSpendRange from the fixed
      // scope x approach table, keyed by the AI's own scopeSize
      // classification - never trusts any dollar figure the model might
      // have written itself (the prompt asks it not to write one at all;
      // this is the actual enforcement, not just the prompt's own good
      // behavior). Applied here, before setResults/finalizeAnalysisResult
      // below, so both the in-memory display and the saved plan document
      // see the identical deterministic value.
      applyDeterministicSpendRanges(parsed);
      dlog(`[COMPANION DEBUG 3] parsed.scopeSize: ${parsed.scopeSize} | approaches: ${JSON.stringify(Object.keys(parsed.approaches || {}))} | simple.taskChecklist: ${JSON.stringify(parsed.approaches?.simple?.taskChecklist)} | isArray: ${Array.isArray(parsed.approaches?.simple?.taskChecklist)}`);
      // Room-First Identity (Implementation Phase A, Constraint 2).
      //
      // Call 1 Output Optimization (2026-08-12): roomReason and areaReason
      // used to be logged here too. They were the only two fields Call 1
      // generated that nothing read - never persisted, never consumed by
      // the Room/Area confirmation flow (which reads only
      // suggestedRoomName/suggestedAreaName/areaScope), never referenced
      // past this one dev-only dlog - and they were 4.4% of Call 1's
      // output. They are no longer requested at all.
      //
      // What was NOT removed with them: roomAreaInstruction still makes the
      // model answer its three ordering questions and still runs the
      // self-consistency check. Only the requirement to WRITE the
      // justification out is gone. Classification quality was re-verified
      // against the same three photos afterwards - see
      // TwoStageAnalysisImplementation.md.
      dlog(`[ROOM-FIRST] suggestedRoomName=${parsed.suggestedRoomName} | suggestedAreaName=${parsed.suggestedAreaName} | areaScope=${parsed.areaScope}`);
      lastFailedAnalysisRef.current = null; // this analysisId succeeded - never reuse it, a later reuse would just replay this cached result

      // Room-First Identity, Phase B (RoomFirstIdentityDesign.md §2):
      // supersedes Step 3's single-outcome recognition check - a returning
      // visit via Organize Again (Step 2) still knows its target through
      // navigation and skips this entirely (returningContext), but for the
      // generic-camera path, Room identity must ALWAYS be established now,
      // not just when a match happens to exist (revising Step 3's own
      // "zero friction on no match" principle - flagged explicitly in the
      // design pass and reaffirmed in the implementation report). Matches
      // at the ROOM level - parsed.suggestedRoomName; suggestedAreaName
      // never reaches this call, by construction.
      if (!returningContext) {
        const recognitionResult = await findRecognitionCandidates(parsed.suggestedRoomName, history, user.uid);
        const knownRooms = dedupeToKnownRooms(history.map(h => ({ id: h.id, data: h })));
        // RECOGNITION_FAILED bypasses routeRoomConfirmation entirely - the
        // lookup never completed, so there is no candidate data for it to
        // classify/route on. A dedicated "failed" outcome, not folded into
        // (c): (c) means "we checked, genuinely nothing matched," which is
        // a different, true statement from "we don't know if anything
        // matched" (Track 2 diagnostic finding - showing (c)'s copy here
        // would misrepresent an incomplete lookup as a completed one).
        const routing = recognitionResult.status === "RECOGNITION_FAILED"
          ? { outcome: "failed" }
          : routeRoomConfirmation(parsed, recognitionResult.candidates, knownRooms);
        // Pause here - the Room confirmation screen (roomConfirmation
        // truthy) takes over on the next render, ahead of Results in the
        // if-chain. Nothing is saved yet, for ANY outcome including (a) -
        // Phase B produces a resolved result and stops; Phase C persists
        // it. parsed/analysesRemaining held in a ref, not state, since
        // they don't need to trigger a render themselves.
        recognitionPendingRef.current = { parsed, analysesRemaining };
        setRoomConfirmation({ routing, knownRooms, view: "main", pickerContext: null, freeformContext: null });
        setLoading(false);
        stopLoadMessages();
        return;
      }

      // Area Identity Phase B (supersedes the prior Area Creation
      // stopgap): "Organize Another Area" (Room known via
      // returningContext.spaceId, Area NOT known - returningContext.areaId
      // null) must resolve Area identity BEFORE the plan is saved (the
      // same governing invariant completeRoomConfirmation's own gate
      // enforces) - pause here and let beginAreaConfirmation/
      // completeAreaConfirmation finish the save via
      // finishOrganizeAnotherAreaSave once the user resolves it. Skipped
      // entirely when returningContext.areaId is already set (existing-Area
      // Organize Again - identity established by navigation, falls
      // straight through to the unchanged finalizeAnalysisResult call
      // below) or areaScope isn't "sub-area" (nothing to resolve).
      if (returningContext && !returningContext.areaId && parsed.areaScope === "sub-area") {
        let existingAreas = [];
        try {
          const areasSnap = await getDocs(collection(db, "users", user.uid, "spaces", returningContext.spaceId, "areas"));
          existingAreas = areasSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => !a.retired);
        } catch (e) {
          dlog(`[AREA RECOGNITION] existing-areas lookup failed for room ${returningContext.spaceId}, proceeding as a fresh Area (Phase A path): ${e.message}`);
        }
        await beginAreaConfirmation({
          roomId: returningContext.spaceId,
          existingAreas,
          suggestedAreaName: parsed.suggestedAreaName,
          saveContinuation: (areaIntent) => finishOrganizeAnotherAreaSave(parsed, returningContext, analysesRemaining, areaIntent),
        });
        setLoading(false);
        stopLoadMessages();
        return; // paused (or already resolved+saved via NO_MATCH/zero-Areas) - see beginAreaConfirmation
      }

      // Same identity stamp as finishOrganizeAnotherAreaSave above, for the
      // returning visit that needs no Area confirmation (its Area is
      // already known, or the visit is whole-room). Everything past the
      // `if (!returningContext)` room-confirmation pause is a returning
      // visit, so returningContext.spaceId is the resolved Room here.
      const returningRoomName = (rooms.find((r) => r.id === returningContext.spaceId) || {}).displayName
        || returningContext.spaceName || parsed.spaceName || null;
      setResults({ ...parsed, canonicalSpaceId: returningContext.spaceId, spaceName: returningRoomName, analysisStage: "summary-ready" });
      logEvent(getAnalytics(), "plan_completed");
      requestTrackingPermissionWhenClear();
      // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1d): a
      // returning visit (organizeAgainContext set) creates its plan via
      // createReturningPlan - the Step 1 wrapper around this exact same
      // savePlanToHistory, with canonicalSpaceId supplied - rather than a
      // second, parallel creation path. Consumed and cleared here,
      // immediately, the moment this attempt reaches a save outcome - see
      // organizeAgainContext's own declaration for why an earlier failure
      // (before this point) leaves it uncleared for a retry instead.
      if (returningContext) setOrganizeAgainContext(null);
      // Awaited (unlike the old fire-and-forget savePlanToHistory call) so
      // the real planId is available for batch_shown/batch_generation_failed
      // inside finalizeAnalysisResult - currentPlanId itself doesn't reflect
      // the new doc until a re-render, and every batch event is
      // planId-correlated (see Analytics.md).
      await finalizeAnalysisResult(parsed, returningContext?.spaceId || null, analysesRemaining, returningContext?.areaId || null);
    } catch (e) {
      lastFailedAnalysisRef.current = { analysisId: analysisIdRef.current, photoUri: photo?.uri };
      logEvent(getAnalytics(), "plan_failed", { reason: e.message });
      if (e.message.includes("Network")) {
        setErr("No internet connection. Please check your WiFi or cellular and try again.");
      } else {
        setErr("Error: " + e.message);
      }
    } finally {
      setLoading(false);
      stopLoadMessages();
    }
  };

  // ---- Canonical Room/Area identity for exports (ApproachCompatibility §4)
  // Share and PDF are artifacts the user sends to other people, so they
  // must carry the names the user currently uses - not the label the AI
  // wrote the day the photo was taken. Same precedence resolveResultsRoomName
  // established for the Results header: live Space first, plan fields only
  // as fallback when the Space is genuinely unavailable (deep link, or My
  // Rooms not visited yet this session).
  //
  // Async because there is no loaded Area list at this point the way there
  // is a loaded `rooms` list - roomDetailAreas is scoped to whichever Room
  // the user last opened, which is frequently not this plan's Room. One
  // document read is cheaper than keeping a second cache correct.
  const resolveExportIdentity = async () => {
    const roomName = resolveResultsRoomName(results, currentPlanId, rooms);
    const roomId = results.canonicalSpaceId || currentPlanId;
    const areaId = results.areaId || null;
    let liveAreaName = null;
    if (areaId && roomId && user?.uid) {
      try {
        const areaRef = doc(db, "users", user.uid, "spaces", roomId, "areas", areaId);
        let snap = await getDoc(areaRef);
        // An Area retired by a merge or a re-parent leaves a redirectTo
        // breadcrumb. Followed exactly once: the plan's own areaId is
        // repointed by those flows, so a chain here would mean something
        // else is wrong, and looping on user data is never worth it.
        if (snap.exists() && snap.data().retired === true && snap.data().redirectTo) {
          const redirected = await getDoc(doc(db, "users", user.uid, "spaces", roomId, "areas", snap.data().redirectTo));
          if (redirected.exists()) snap = redirected;
        }
        if (snap.exists() && snap.data().retired !== true) {
          const dn = typeof snap.data().displayName === "string" ? snap.data().displayName.trim() : "";
          if (dn) liveAreaName = dn;
        }
      } catch (e) {
        dlog(`[EXPORT IDENTITY] area lookup failed for ${areaId}: ${e.message}`);
      }
    }
    const areaName = liveAreaName
      || (typeof results.areaName === "string" && results.areaName.trim() ? results.areaName.trim() : null);
    return {
      roomName,
      areaName,
      // The Area qualifies the Room, never replaces it - "Corner Shelf"
      // alone is meaningless to whoever receives the share.
      label: areaName ? `${roomName} · ${areaName}` : roomName,
      liveAreaResolved: !!liveAreaName,
    };
  };

  // Remote image -> inlined data URI, downscaled. Inlined rather than left
  // as an https src because the print renderer fetches remote images on its
  // own schedule and silently produces a blank box when it loses the race;
  // a data URI is already there when layout runs. Returns null on ANY
  // failure, which is what makes visualization optional content that can
  // never block an export (§3, test k).
  const imageToDataUri = async (url, width) => {
    if (!url || typeof url !== "string") return null;
    try {
      let sourceUri = url;
      if (/^https?:/i.test(url)) {
        const local = FileSystem.cacheDirectory + `pdf_img_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
        const dl = await FileSystem.downloadAsync(url, local);
        sourceUri = dl.uri;
      }
      const out = await manipulateAsync(sourceUri, [{ resize: { width } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
    } catch (e) {
      dlog(`[PDF IMAGE] skipped ${String(url).slice(0, 60)}: ${e.message}`);
      return null;
    }
  };

  const generatePDF = async () => {
    if (!results) return;
    if (pdfInFlightRef.current) return;
    pdfInFlightRef.current = true;
    setAsyncBusyText("Preparing your plan...");
    try {
      // Yield one tick so the overlay actually PAINTS before the expensive
      // synchronous HTML construction below begins. Without this the string
      // building blocks the JS thread through the render that would have
      // shown the spinner, and the user sees nothing until the share sheet
      // appears - which is the exact complaint this fixes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const tierColors = {
        budget: { color: "#1E9E52", bg: "#E6F7EE", border: "#A8DDBF" },
        mid: { color: "#1463D8", bg: "#EBF1FC", border: "#A8C0EE" },
        premium: { color: "#0F2A52", bg: "#E6E9EE", border: "#B0BFCF" },
      };

      const buildTier = (t) => {
        const c = tierColors[t.id] || tierColors.mid;
        const suggestions = t.suggestions?.map(s => `<li style="margin-bottom:4px;font-size:13px;color:#0F2A52;">${s}</li>`).join("");
        const products = t.products?.map(p =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#F4F6F8;border-radius:8px;margin-bottom:4px;font-size:13px;">
            <span style="font-weight:600;color:#0F2A52;">${p.icon} ${p.name}</span>
            <span style="font-weight:700;color:${c.color};">${p.price}</span>
          </div>`
        ).join("");
        return `
          <div class="tier" style="border:1.5px solid ${c.border};border-radius:12px;padding:16px;margin-bottom:10px;background:white;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid ${c.border};">
              <span style="background:${c.bg};color:${c.color};border:1px solid ${c.border};padding:3px 12px;border-radius:20px;font-weight:700;font-size:12px;">${t.label}</span>
              <span style="color:#64748B;font-size:12px;">${t.range}</span>
            </div>
            <ul style="margin:0 0 10px 0;padding-left:18px;line-height:1.6;">${suggestions}</ul>
            <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#64748B;margin-bottom:6px;">SUGGESTED PRODUCTS</div>
            ${products}
          </div>`;
      };

      const pdfTiers = results.tiers || [];
      const pdfBudget = pdfTiers.find(t => t.id === "budget");
      const pdfMid = pdfTiers.find(t => t.id === "mid");
      const pdfPremium = pdfTiers.find(t => t.id === "premium");






      // (The base64 HEADER_IMG banner that used to live here is gone - the
      // masthead is built from markup now, and the image was ~9KB of dead
      // string shipped in every bundle.)

      // ---- Document chrome -------------------------------------------------
      // The masthead is CSS, not an image. The previous base64 banner was 9KB
      // in every bundle and could not adapt to the per-page variant below.
      // `right` carries the page-2 room label; page 1 passes nothing.
      // The real brand mark, rasterised from the canonical asset
      // (uncluttrd-website/public/images/uncluttrd-logo.svg) rather than
      // approximated. The previous revision drew two coloured bars in CSS,
      // which read as a generic glyph and not as our logo. Baked onto its own
      // white tile because the mark's base is #0F2A52 - the same navy as the
      // masthead - so on the bar the base and the white pill inside it would
      // simply vanish.
      const PDF_LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPwAAAD8CAYAAABTq8lnAAAI2ElEQVR42u3dv4scVQDA8fkPPNA6XG11nRYW1ynYHOnFBSvB4ghWgjCdP5otgggi2UIsUl1EG0FcUEG0WdAE0y3YpFEuSgJayJN3zIW7y2WzP2Zm5733+cL0s7Pz2Xnz9u1sVQ28EMJOCGE/hHAYQqhDCNNmmwdpO83PnId1c27Gc3Sn0srAd0MIoxDCBGol+mEwac7hXaKfjDx+Us6cL8qsWXNu75aOfKf5FIRcJeEfFTX0b67m4xDCsfdfhXbcGNjNHfrEey2da5IV/GboXntfpYXVyQ/1QwgHhu7SSkP9g1Sv6kfeP2mtjpK52ruqS4Vc7ZuZR0ntNR7qEH7qvZE6aTqYIX4IYc/iGanzorG9IWB3vy71d1+/B7sEPewS9LBL0K8wG2+CThpGs05n7331Jg2uqUU1UlmN28Z+4JhKg+6gzft2k3TSsDtu5X7er96kZDoylJcM7fMYyt/501Os1W+//v5PnkP7FB5LNZ7dDNe+u+4sVC+9deNe+PCLP1LY1XqdB06GFMBfuXEVevWC/bk37qYCPqz0YMxUni57Ch569YE9MfCTrK7uF8FDr66xJwZ+uat8SivqLoKHXl1iTxD8OKtFNpeBh15dYU8Q/OIZ++Z/r0Lq4KFXF9gTBB8bLQI/ywU89Gobe6LgZ8lP1i0LHnq1iT1R8OHSybsU//9tGfDQqy3sCYOvkx/OrwIeerWBPWHws+SH86uCh16bYk8Y/PlhfWqz8+uCh16bYE8c/Ci5pbRtgIde62JPHPzkLPh5SeChh30d7ImDn59dXRdKAw897IWBDyer7kII+6WChx72wsDvR/CHJYOHHvaCwB8mueCmbfDQw14I+Drpf5NpEzz0sBcAfgo89LAXBn4OPPSwFwF+XqW8912Bhx72TMEH4KGHHXjgoYcd+ALBQw878IWBhx524AsDDz3swBcGHvqysQNfIHjoy8UOfKHgoS8TO/AFg4e+POzAFw4e+rKwAw/8yfbjvds0dtwPdx9uHTvwwAMPPPDAC3jggRfwwAMv4IEHXsADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888MADDzzwwAMv4IEHXsADD7yABx54AQ888MADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888MADD7yABx54AQ888AIeeOAFPPDAAw888MADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888EQCDzzwAh544AU88MALeOCBF/DAAw888MADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888MALeOCBF/DAAy/ggQdewAMPPPDAAw888MADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAy/ggQdewAMPvIAHHngBDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888MADDzzwwAMPvIAHHngBDzzwAh544AU88MADDzzwwAMPPPDAAw888MADDzzwwAMPPPDAAw888MADDzzwAh544AU88MALeOCBF/DAAy/ggQceeOCBBx544IEHHnjggQceeOCBBx544IEHHnjggQceeOCBF/DAAy/ggQdewAMPvIAHHnjggQceeOCBBx544IEHHnjggQceeOCBBx544IEHHnjggQdewAMPvIAHHngBDzzwAh544IEHHnjggQceeOCBBx544IEHHnjggQceeOCBBx544IEHHngBDzzwAh544AU88MALeOCBBx544IEHHnjggQceeOCBBx544IEHHnjggQceeOCBBx544AU88MALeOCBF/DAAy/ggQceeOCBBx544IEHHnjggQceeOCBBx544IEHHnjggb9k+2T6Zfj+59u2DrePb90BvnTwf/37ILxy69rWwT/78tXwzPO2LredF9/eOvb9eh7uP/wP+NLRA58/+BywZwF+COiBzxt8LtizAb9t9MDnCz4n7FmB3yZ64PMEnxv27MBvCz3w+YHPEXuW4LeBHvi8wOeKPVvwfaMHPh/wOWPPGnyf6IHPA3zu2LMH3xf6vsC/+vq74fOjbwez+i3uS9ynHMCXgL0I8H2g7xr8lRdeC19989Ngj2/ct7iPqYIvBfsp+Dn0wwY/ZOxn0acIviTs0XoEPy3l1XaFvkvwccicSl0O77sAXxj22LQo8F2h7xL8ex/dTObYxn1NBXyB2B+Br0t71W2j7xJ8nBxLpbivKYAvFHusjuAPS3zlbaLvEnycCU+luK9DB18w9thhBL9f6qtvC32X4N9853oyxzPu65DBF449th/B75R8BNpA3/Us/S+/Df+LlLiPQ56lh/2knSpWyldzXaHvGvxLV6+F+38/GOzxi/sW93Go4GE/aV6dFkKYlH40NkHfx0q7uLAl3iMPCX7cl7hPXS+62QQ87I+anAU/cjzWR28t/TCX1sJ+rtFZ8LuOx/rogR8eeNgfa7c6Wwhh5pishx74YYGH/bFm1cVKXIDTFnrghwMe9kurLwNvWL8meuCHAR72JYfzhvWboQd+++BhX2E4b7Z+M/TAbxc87EvOzl8CPq66O3aMVkMP/PbAw76w40er6xagHztOq6EHfjvgYX9q4+ppmbxbHT3w/YOHfYPJukvQTxyr5dED3y942JdqUi2bq/xq6IHvDzzsLV/dLcRZHT3w/YCHfenqatXM2C+P/oPPbp48z83W3fb+p1/D3tbM/AL0B46flFQH1SaFEI4cQymJjqpNM7SXMh/KG9pLhQ3lrcCTkmlcdVFp/1IjJdC06qrmft5PaKVhNGvtvn0B+j2TeNLWiwb3qj6CXioEO/RSYdihlwrDfgG9iTyp22Zbx35h9t5XdlI3TTufjbc4RxpE42rINctw3ddLm9+vH1Qp1Azx/cpOWq+jQQ7hXe2lQq/qT7nae1yWtLg6yav6Ux6M6Wm40vkmKz9wMkH4Y0N9FT50H2cN/QlD/ZFFOyqoWXPO71Ql11z1a/iVKfK6qKv5GvhHzb3N3PmixJo35+4I8vWH/vshhMPmk3LabD4MtE3Up+dh3Zyb+ykM1f8HX414zjZU9aIAAAAASUVORK5CYII=";

      const makeHeader = (pageBreak, right) => `
        <div class="brandbar"${pageBreak ? ' style="page-break-before:always;"' : ""}>
          <div class="brandleft">
            <img class="ulogo" src="${PDF_LOGO}"/>
            <div>
              <div class="brandmark">Uncluttrd</div>
              <div class="tagline"><span class="t-green">MORE SPACE.</span> <span class="t-blue">MORE TIME.</span> <span class="t-white">MORE YOU.</span></div>
            </div>
          </div>
          ${right ? `<div class="brandright"><div class="br1">${right.top}</div><div class="br2">${right.sub}</div></div>` : ""}
        </div>
        <div class="brandrule"></div>`;

      const PDF_SHELL = {
        css: `* { box-sizing:border-box; margin:0; padding:0;
                -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          /* Without the two color-adjust declarations above, WebKit drops every
             background fill when it prints - the navy masthead, the green rule
             and all the cards render as bare text on white. */
          /* Zero page margin so the masthead bleeds to the paper edge. The
             content inset lives on .page instead, which also means the footer -
             it sits inside .page - lines up with the body rather than running
             out to the trim. The bottom inset works per page rather than only
             on the last one because every page here is its own .page block,
             ended by the forced break on the next masthead. */
          @page { size: letter; margin: 0; }
          html, body { font-family:Inter,Arial,Helvetica,sans-serif; background:#FFFFFF; color:#0F2A52; }
          .page { padding:0 0.75in 0.75in 0.75in; }

          /* KEEP-TOGETHER. A section that splits across a page boundary is the
             defect this exists to prevent - most visibly the summary, which
             used to strand a single word at the foot of page 1. */
          .summary-card, .approach-section, .step, .product-card,
          .pro-tip, .viz-section, .photo-section, .prodgrid-row {
            page-break-inside: avoid; break-inside: avoid;
          }
          p, li, div { orphans:3; widows:3; }

          /* ---- masthead ---- */
          /* Full width by virtue of the zero page margin; the 0.75in side
             padding lines the wordmark up with the body text below it. */
          .brandbar { background:#0F2A52; padding:14px 0.75in; display:flex;
                      align-items:center; justify-content:space-between; }
          .brandrule { height:4px; background:#3FC77A; margin-bottom:18px; }
          .brandleft { display:flex; align-items:center; }
          /* 52px tile puts the mark itself at roughly 42px, the size Michael
             asked for. The PNG is emitted at 252px, six times the display size,
             so it stays sharp when the PDF is printed rather than viewed. */
          .ulogo { width:52px; height:52px; margin-right:12px; display:block; }
          .brandmark { color:#FFFFFF; font-size:19px; font-weight:700; letter-spacing:-0.2px; line-height:1.1; }
          .tagline { margin-top:3px; font-size:7.5px; font-weight:600; letter-spacing:1.1px; }
          /* Brand colours lightened for the dark bar, the same adjustment the
             app makes with greenOnDark. On #0F2A52 the raw brand green is
             4.12:1 and the raw brand blue only 2.58:1, unreadable at this size;
             these are 5.17:1 and 5.02:1. */
          .t-green { color:#10B43E; } .t-blue { color:#5B9BF0; } .t-white { color:#FFFFFF; }
          .brandright { text-align:right; }
          .br1 { color:#FFFFFF; font-size:9px; font-weight:700; letter-spacing:1.2px; }
          .br2 { color:#C6D2E4; font-size:8.5px; margin-top:2px; }

          /* ---- page 1 ---- */
          .eyebrow { font-size:10px; font-weight:700; letter-spacing:1.4px;
                     text-transform:uppercase; color:#166E38; margin-bottom:6px; }
          .h1 { font-size:30px; font-weight:700; color:#0F2A52; margin-bottom:14px; letter-spacing:-0.5px; }
          .photo-section { margin:0 0 18px 0; text-align:center; }
          /* Constrained, NOT full width. The mockup shows the photo as a hero
             and a previous pass took it to 100%, but in real plans that pushes
             "What we noticed" and the approach card off page 1 entirely - worse
             with a photo that carries a letterboxed black bar, which buys height
             without adding any information. */
          .photo { max-width:60%; max-height:300px; object-fit:cover; display:block;
                   margin:0 auto; border-radius:10px; border:1px solid #D7DCE3; }
          .cap { font-size:8.5px; font-weight:700; letter-spacing:1.3px;
                 text-transform:uppercase; color:#8A94A6; text-align:center; margin-top:9px; }

          .lbl { font-size:9px; font-weight:700; letter-spacing:1.2px;
                 text-transform:uppercase; color:#64748B; margin:0 0 7px 0; }
          .summary-card { background:#F7F8FA; border:1px solid #E2E6EC; border-radius:10px;
                          padding:16px 18px; margin-bottom:16px; }
          .summary-card .lbl { color:#64748B; }
          .body { font-size:12.5px; color:#3D4A5C; line-height:1.65; }

          .approach-section { background:#FAFAFC; border:1px solid #E4E2EE; border-radius:10px;
                              padding:16px 18px; margin-bottom:16px; }
          .approach-name { font-size:9.5px; font-weight:700; letter-spacing:1.2px;
                           text-transform:uppercase; color:#166E38;
                           border-bottom:2px solid #10B43E; padding-bottom:7px;
                           margin-bottom:11px; display:block; }
          .lead { font-weight:700; color:#0F2A52; }

          /* ---- page 2 ---- */
          .h2 { font-size:25px; font-weight:700; color:#0F2A52; margin-bottom:20px; letter-spacing:-0.4px; }
          .step { display:flex; padding:11px 0; border-bottom:1px solid #EDEFF3; }
          .step:last-child { border-bottom:none; }
          .stepno { width:34px; flex:0 0 34px; font-size:12.5px; font-weight:700; color:#166E38; }
          .steptitle { font-size:12.5px; font-weight:700; color:#0F2A52; margin-bottom:3px; }
          .stepbody { font-size:11.5px; color:#5D6B7F; line-height:1.6; }

          .sublbl { font-size:11px; color:#64748B; margin:0 0 11px 0; }
          /* Two-up grid built from table rows, not flex-wrap: WebKit's print
             path breaks flex-wrapped children across pages unpredictably, and a
             row is something page-break-inside can actually hold together. */
          .prodgrid { width:100%; border-collapse:separate; border-spacing:9px 9px; margin:0 -9px; }
          .prodgrid td { width:50%; vertical-align:top; }
          .product-card { background:#F7F8FA; border:1px solid #E9ECF1; border-radius:8px;
                          padding:11px 12px; display:flex; align-items:flex-start; }
          .prodicon { width:17px; height:17px; flex:0 0 17px; border-radius:4px;
                      background:#166E38; margin-right:10px; margin-top:1px; }
          .prodname { font-size:11.5px; font-weight:700; color:#0F2A52; margin-bottom:2px; }
          .prodwhy { font-size:10.5px; color:#6B7787; line-height:1.5; }

          .viz-section { margin:18px 0 0 0; }
          .viz { width:100%; display:block; border-radius:10px; border:1px solid #D7DCE3; }

          .pro-tip { background:#EAF7EF; border:1px solid #A8DDBF; border-radius:10px;
                     padding:15px 18px; margin-top:18px; }
          .pro-tip .lbl { color:#166E38; }
          .pro-tip .body { color:#1B5E34; }

          /* ---- footer, every page ---- */
          .foot { border-top:1px solid #E2E6EC; margin-top:26px; padding-top:9px;
                  display:flex; justify-content:space-between;
                  font-size:8.5px; color:#8A94A6; }`,
        footer: `<div class="foot"><span>Generated by Uncluttrd Pro</span><span>uncluttrd.app</span></div>`,
      };

      // Every approach-format plan exports the complete plan: all three
      // approaches in full - strategy, every task, every product and each
      // visualization - whether or not one has been selected; a selection only
      // adds its label. Layout and pagination live in shared/pdfExport.js;
      // this gathers the content and inlines the images. Read only: nothing
      // here writes to the plan or starts an approach.
      if (results.approaches) {
        const identity = await resolveExportIdentity();
        const ids = APPROACH_ORDER.filter((id) => results.approaches[id]);
        // Each image is optional - imageToDataUri returns null on any
        // failure and the document simply leaves that image out. Visualization
        // prefers this session's state, then the persisted map, so one
        // generated moments ago is included without a plan reload.
        const [photo, ...vizUris] = await Promise.all([
          imageToDataUri(results.photoUrl, 1400),
          ...ids.map((id) => imageToDataUri(vizImage[id] || results.vizImages?.[id] || null, 1400)),
        ]);
        const approaches = ids.map((id, i) => {
          const a = results.approaches[id];
          return {
            id,
            name: APPROACH_META[id]?.name || id,
            strategy: a.strategyDescription,
            spendRange: a.estimatedSpendRange,
            tasks: (a.taskChecklist || []).filter((task) => typeof task === "string" && task.trim()),
            // shortReason first, the truncation fallback second, the full
            // reason never - the cards are a shopping list, not the evidence.
            products: (a.productRecommendations || []).map(normalizeProductRecommendation).filter(Boolean).map((item) => ({
              name: pdfTitleCase(item.productType),
              why: item.shortReason || shortDisplayReason(resolveRecommendationReason(item, results.problemsFound)),
            })),
            visualization: vizUris[i],
          };
        });
        const plan = buildComprehensivePlanPdf({
          roomLabel: identity.label,
          overview: results.overview,
          proTip: results.proTip,
          photo,
          approaches,
          selectedApproachId: results.selectedApproach || null,
          logo: PDF_LOGO,
        });
        const out = await Print.printToFileAsync({ html: plan.html, base64: false, width: 612, height: 792 });
        logEvent(getAnalytics(), "pdf_exported", comprehensivePdfAnalytics(plan.stats));
        await Sharing.shareAsync(out.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
        return;
      }

      // The legacy tier document shares the shell so the margin and
      // page-break rules apply to old-format plans too, rather than leaving a
      // second template with the original defects.
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>${PDF_SHELL.css}
          .page-break { page-break-before:always; }
          .header-break { page-break-before:always; }
        </style></head><body>

        <!-- PAGE 1 -->
        ${makeHeader(false)}
        <div class="page">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#1E9E52;margin-bottom:4px;margin-top:8px;">${getSpaceDisplayName(results)}</div>
          <div style="font-size:22px;font-weight:700;color:#0F2A52;margin-bottom:10px;">Your Organization Plan</div>
          <div style="background:#E6E9EE;border:1px solid #D7DCE3;border-radius:10px;padding:14px;margin-bottom:14px;font-size:13px;color:#64748B;line-height:1.6;">${results.overview}</div>
          ${pdfBudget ? buildTier(pdfBudget) : ""}
          ${pdfMid ? buildTier(pdfMid) : ""}
        </div>

        <!-- PAGE 2 -->
        ${makeHeader(true)}
        <div class="page" style="padding-top:16px;">
          ${pdfPremium ? buildTier(pdfPremium) : ""}
          ${results.proTip ? `
          <div style="background:#E6F7EE;border:1px solid #A8DDBF;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1E9E52;margin-bottom:4px;">&#9989; PRO TIP</div>
            <div style="color:#166E38;font-size:13px;line-height:1.6;">${results.proTip}</div>
          </div>` : ""}
          ${PDF_SHELL.footer}
        </div>

      </body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false, width: 612, height: 792 });
      logEvent(getAnalytics(), "pdf_exported");
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch (e) {
      Alert.alert("PDF Error", e.message);
    } finally {
      // Always released, including the approach-PDF path's early `return`
      // inside the try - finally runs on that too.
      pdfInFlightRef.current = false;
      setAsyncBusyText(null);
    }
  };

  // ---- Visualization prompt construction ----
  // Two builders, one per plan format, because the two formats carry
  // genuinely different source material - not because the image model
  // needs different handling. Everything they share (the architectural
  // preservation clause, the photographic direction, the no-text/no-people
  // prohibitions) lives in VIZ_PROMPT_FRAME so the two can never drift on
  // the parts that are actually the same requirement.
  //
  // Room-First Identity (Implementation Phase A): results.spaceType is only
  // populated once a plan is actually saved (savePlanToHistory sets it from
  // suggestedRoomName) - a freshly-analyzed, not-yet-saved `results` (the
  // raw parsed AI response) carries suggestedRoomName directly instead.
  // Both are read since a visualization can run against either shape,
  // depending on how quickly the user taps relative to the background save.
  const resolveVizSpaceLabel = () => {
    // spaceName is the Room's own durable displayName once the plan is
    // filed (it is written from the Space, not from the AI), so it wins -
    // a Room the user renamed "The Snug" should visualize as the snug, not
    // as whatever the AI called it the day the photo was taken.
    const room = (typeof results.spaceName === "string" && results.spaceName.trim())
      || results.spaceType || results.suggestedRoomName || "room";
    const area = (typeof results.areaName === "string" && results.areaName.trim())
      || results.suggestedAreaName || null;
    // The Area is a qualifier, never a replacement: the image model still
    // has to be told it is looking at a whole room, or it reframes the
    // photo around the sub-area and invents architecture outside it.
    return area ? `${room} (specifically the ${area})` : room;
  };
  const VIZ_PROMPT_FRAME = {
    preserve: "Keep the same room (the same walls, floor, window, door, ceiling, and architecture) exactly as shown in the photo. Do not invent a different room or change its layout, dimensions, or finishes.",
    // The image-side half of the evidence-constrained intervention rule
    // that already governs every generated TEXT field. `preserve` above is
    // not sufficient and was never meant to be: it forbids ALTERING the
    // ceiling, and says nothing about MOUNTING something new to it, so a
    // visualizationDirection reading "layered lighting from a statement
    // chandelier" satisfies it completely while producing exactly the
    // fabricated infrastructure the text rule exists to prevent.
    //
    // Deliberately positioned as the LAST substantive instruction, after
    // the direction, the guidance and the product list. It has to override
    // all three - a "lighting" product recommendation can smuggle in a
    // fixture just as easily as the direction can - and an image model
    // weights later instructions more heavily than earlier ones.
    // Leads with an affirmative statement of what the ceiling IS, because a
    // purely negative rule performed worse in testing - stating the desired
    // state gives the model something to render, where a prohibition only
    // gives it a concept to avoid, which it is demonstrably bad at.
    noNewInfrastructure: "The ceiling stays exactly as photographed, carrying only the light fixtures already visible in it. If no hanging light fixture is visible on the ceiling in the original photo, then no hanging light fixture appears in the result and the space above the table remains open and empty. Do not add ceiling-mounted light fixtures (pendants, chandeliers, ceiling fans), vaulted or altered ceilings, windows, doors, or any architectural/structural features not visible in the original photo. Only add items that could be placed on surfaces, hung on visible walls, or positioned on the floor without requiring new construction or electrical work.",
    style: "Photorealistic result, warm natural lighting, magazine-quality home organization photography. No text, no labels, no annotations, no callouts, no arrows, no watermarks, no overlays. No people.",
  };
  // Old-format (tiers). Byte-for-byte the prompt this function has always
  // produced - extracted, not rewritten, so an old plan visualized before
  // this change and after it get the same instruction.
  const buildTierVizPrompt = (tier) => {
    const productList = tier.products?.map(p => p.name).join(", ");
    const suggestionList = tier.suggestions?.join(". ");
    const itemsFound = normalizeItemsFound(results.itemsFound).join(", ");
    const roomLabelForViz = results.spaceType || results.suggestedRoomName || "room";
    return `Reorganize and declutter this exact ${roomLabelForViz}. ${VIZ_PROMPT_FRAME.preserve} Only change the contents: remove clutter, and apply these specific changes: ${suggestionList}.${productList ? ` Add these storage solutions in a realistic way: ${productList}.` : ""}${itemsFound ? ` The space currently contains: ${itemsFound}. Organize these rather than removing them entirely unless the suggestions say to.` : ""} ${VIZ_PROMPT_FRAME.style}`;
  };
  // New-format (approaches). visualizationDirection leads, deliberately:
  // it is the one field the analysis prompt wrote FOR this purpose ("what
  // that approach's finished result should look like for this specific
  // space"), and it is what makes three visualizations of one photo differ
  // in ambition rather than in tidiness. Until now it was generated on
  // every plan and read by nothing.
  //
  // organizingGuidance and productRecommendations follow as supporting
  // context, not as instructions of equal weight - guidance is written as
  // advice to a person ("group like with like"), and handing that to an
  // image model as a co-equal directive produces literal-minded results.
  // Product TYPES only, never searchTerms or reasons: the model needs to
  // know a tray may appear, not how to shop for one.
  // Removes requests for ceiling-mounted infrastructure from text that is
  // about to be handed to the image model.
  //
  // This exists because the prohibition alone measurably does not work.
  // Tested on the real Dining Room photo: with noNewInfrastructure present
  // as the final instruction, and the direction still reading "illuminated
  // by a stylish pendant light", the model returned a pendant anyway - and
  // a crystal chandelier for the approach whose direction named one. An
  // image model resolves a contradiction in favour of the affirmative,
  // concrete request, and naming a fixture even inside a negation makes it
  // MORE likely to appear, not less. The only reliable way to not get a
  // chandelier is to never ask for one.
  //
  // Two passes, because a single clause routinely carries both something
  // wanted and something forbidden ("a clear table illuminated by a stylish
  // pendant light" - the clear table is the point of the sentence):
  //   1. strip the prepositional phrase that requests the fixture
  //   2. drop any whole clause still naming one
  const CEILING_INFRA_RE = /pendant|chandelier|ceiling fan|ceiling-mounted|ceiling light|ceiling fixture|track light|recessed light|flush mount|sconce/i;
  const stripInfrastructureClaims = (text) => {
    if (!text) return "";
    // Pass 1: "illuminated by a stylish pendant light" -> removed, the rest
    // of the clause survives.
    let out = text.replace(
      /,?\s*\b(?:illuminated|lit|brightened|crowned|topped|centered|anchored|highlighted|accented|washed)\b\s+(?:by|with|from|under|beneath)\s+[^,.;]*/gi,
      (m) => (CEILING_INFRA_RE.test(m) ? "" : m)
    );
    // Pass 2: the bare prepositional form - "a dining room WITH layered
    // lighting from a statement chandelier". Must run AFTER pass 1: on
    // "a clear table illuminated by a stylish pendant light" this pattern
    // would otherwise swallow the clear table along with the pendant,
    // whereas by now pass 1 has already removed the offending phrase and
    // what remains carries no fixture word to match on.
    out = out.replace(
      /,?\s*\b(?:with|featuring|including|plus)\b\s+[^,.;]*/gi,
      (m) => (CEILING_INFRA_RE.test(m) ? "" : m)
    );
    // Pass 3: whole clauses that are themselves the request.
    out = out
      .split(/(?<=[,;])\s+|(?<=\.)\s+/)
      .filter((clause) => !CEILING_INFRA_RE.test(clause))
      .join(" ");
    // Tidy the seams left by removal.
    return out
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;])/g, "$1")
      .replace(/([,;])\s*([,.;])/g, "$2")
      .replace(/,\s*(and\s+)?$/i, "")
      .replace(/^\s*(and|with)\s+/i, "")
      .trim()
      .replace(/[,;]$/, ".");
  };

  const buildApproachVizPrompt = (approachId, approach) => {
    const meta = APPROACH_META[approachId];
    const rawDirection = typeof approach.visualizationDirection === "string" ? approach.visualizationDirection.trim() : "";
    // Sanitized at the point of use, never written back: the stored field
    // is the AI's own output and is the record of what it said. Plans
    // written before the all-fields evidence rule shipped still carry
    // fixture requests in this field, and re-analysis is not on the table
    // for a plan the user has already started working.
    const direction = stripInfrastructureClaims(rawDirection);
    // Same treatment for the two other channels a fixture can arrive
    // through. A "pendant light" productType would otherwise be handed
    // straight to the model as an item to add, and guidance regularly
    // repeats the direction's own lighting language.
    const guidance = (approach.organizingGuidance || [])
      .filter((g) => typeof g === "string" && g.trim())
      .map(stripInfrastructureClaims)
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
    const productTypes = [...new Set(
      (approach.productRecommendations || [])
        .map((p) => (typeof p?.productType === "string" ? p.productType.trim() : ""))
        .filter(Boolean)
        .filter((t) => !CEILING_INFRA_RE.test(t))
    )].join(", ");
    const itemsFound = normalizeItemsFound(results.itemsFound).join(", ");
    const spaceLabel = resolveVizSpaceLabel();

    return [
      `Transform this photo to show the ${spaceLabel} after implementing the "${meta?.name || approachId}" approach.`,
      // Falls back to the approach's own strategy rather than to nothing:
      // a plan written before visualizationDirection existed, or one where
      // the AI omitted it, should still visualize as ITS approach and not
      // silently collapse into a generic tidy-up.
      direction || (typeof approach.strategyDescription === "string" ? approach.strategyDescription.trim() : ""),
      VIZ_PROMPT_FRAME.preserve,
      guidance ? `The space should reflect these changes: ${guidance}` : "",
      productTypes ? `Items that may be added, rendered realistically and only where they plausibly fit: ${productTypes}.` : "",
      // Same reasoning as the tier prompt: without this the model tends to
      // empty the room rather than organize it.
      itemsFound ? `The space currently contains: ${itemsFound}. Organize these rather than removing them entirely unless the approach calls for it.` : "",
      // Last, and after the product list, on purpose - see the note on
      // noNewInfrastructure. Applied to the approach prompt only: the
      // old-format tier prompt is asserted byte-identical to its
      // pre-refactor text by evidence (f1), and silently changing what an
      // old plan renders is not this fix's business. Extending it there is
      // one line if old plans turn out to invent fixtures too.
      VIZ_PROMPT_FRAME.noNewInfrastructure,
      VIZ_PROMPT_FRAME.style,
    ].filter(Boolean).join(" ");
  };

  // Accepts EITHER an old-format tier object (unchanged call site) or a
  // new-format { approachId, approach } descriptor. Everything after the
  // prompt - the edit call, compression, Storage upload, persistence - is
  // format-independent and deliberately shared: the two formats differ in
  // what they ask for, not in what happens to the image that comes back.
  const generateVisualization = async (target, { isRegeneration = false } = {}) => {
    if (!isPro) { setShowPaywall(true); return; }
    if (!photo?.uri) {
      Alert.alert("Photo unavailable", "We couldn't find the original photo for this room. Please reopen it from My Rooms and try again.");
      return;
    }
    const isApproach = !!target?.approachId;
    // The storage key. For an approach this is "simple"/"polished"/
    // "elevated", which is what makes the three independent: generating
    // one writes vizImages.<thatId> and cannot touch the other two.
    const vizKey = isApproach ? target.approachId : target.id;
    // Synchronous re-entry guard (ProcessingFeedbackAudit.md finding 1, the
    // highest-value one). This had NO guard whatsoever - not even a check of
    // vizLoading - and it calls a Cloud Function with a 300 SECOND timeout.
    // A double-tap meant two real image generations: double spend, and a
    // genuine late-write race where the slower call's image overwrites the
    // one the user actually waited for.
    //
    // A Set keyed by vizKey, not a single boolean, mirroring
    // detailInFlightRef: the three approach images are independent by design
    // (each writes only vizImages.<its own id>), so generating Polished must
    // not lock out Elevated. Released in the same finally that clears
    // vizLoading.
    if (vizInFlightRef.current.has(vizKey)) return;
    vizInFlightRef.current.add(vizKey);
    // The known-good image, captured BEFORE anything is attempted. It is
    // what the thumbnail keeps showing throughout a regeneration, and the
    // object deleted at the very end - only once its replacement is
    // confirmed persisted.
    const previousUrl = isRegeneration ? (vizImage[vizKey] || null) : null;
    setVizError(prev => { const next = { ...prev }; delete next[vizKey]; return next; });
    setVizLoading(prev => ({ ...prev, [vizKey]: true }));
    startVizTips();
    try {
      const prompt = isApproach
        ? buildApproachVizPrompt(target.approachId, target.approach)
        : buildTierVizPrompt(target);

      // Use the image EDIT endpoint (not generations) so the model anchors on the
      // user's actual photo instead of inventing an unrelated room from text alone.
      const vizInput = await manipulateAsync(
        photo.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.8, format: SaveFormat.JPEG, base64: true }
      );

      const generateVisualizationFn = httpsCallable(functions, "generateVisualization", { timeout: 300000 });
      let b64;
      try {
        // planId is sent so the function can verify the caller actually
        // owns the plan being visualized, not merely that they are signed
        // in. Null for a not-yet-saved plan, which the function treats as
        // "authenticated but unattributable" and allows - the alternative
        // would break visualizing a plan the background save hasn't
        // finished writing yet.
        const result = await generateVisualizationFn({ imageBase64: vizInput.base64, prompt, planId: currentPlanId || null });
        b64 = result.data?.b64;
      } catch (vizErr) {
        console.log("Viz function error:", vizErr.code, vizErr.message);
        // The server uses three distinct codes so the client can respond
        // correctly rather than showing one generic message:
        //   failed-precondition -> entitlement. The local isPro said yes and
        //     the server disagreed, which means the local value is stale or
        //     forged. The paywall is the right destination, not an error.
        //   permission-denied / unauthenticated -> identity, not payment.
        if (vizErr.code === "functions/failed-precondition") {
          dlog(`[VIZ] server rejected on entitlement (local isPro=${isPro})`);
          setShowPaywall(true);
          return;
        }
        Alert.alert(
          "Visualization failed",
          vizErr.code === "functions/permission-denied" || vizErr.code === "functions/unauthenticated"
            ? "Please sign in again and retry."
            : "Please try again."
        );
        return;
      }
      const rawImage = b64 ? ("data:image/png;base64," + b64) : null;
      if (!rawImage) { Alert.alert("No image returned", "Please try again."); return; }

      // Compress the generated PNG down to a small JPEG and store it in Firebase Storage,
      // so reopening this plan later shows the real image instead of needing to
      // re-pay for another OpenAI generation (and instead of leaking a stale one, see vizImages below).
      let finalUrl = rawImage; // fallback: still show locally this session even if upload fails
      try {
        let sourceUri = rawImage;
        if (b64) {
          // manipulateAsync needs a file URI, not a raw base64 string. Write it to a temp file first.
          const tempPath = FileSystem.cacheDirectory + `viz_raw_${vizKey}_${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(tempPath, b64, { encoding: FileSystem.EncodingType.Base64 });
          sourceUri = tempPath;
        }
        const compressed = await manipulateAsync(sourceUri, [], { compress: 0.75, format: SaveFormat.JPEG });
        // Read the compressed file into a real Blob via XHR rather than constructing one from
        // raw bytes in JS. Modern React Native's Blob constructor only supports Blobs/strings,
        // not ArrayBuffer/ArrayBufferView, which is what breaks uploadString/manual Blob building.
        const blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => resolve(xhr.response);
          xhr.onerror = () => reject(new Error("Failed to read compressed image file"));
          xhr.responseType = "blob";
          xhr.open("GET", compressed.uri, true);
          xhr.send(null);
        });
        const path = `viz/${user.uid}/${currentPlanId || "unsaved"}/${vizKey}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
        finalUrl = await getDownloadURL(fileRef);
      } catch (compressErr) {
        console.log("Visualization compress/upload error:", compressErr.message);
        // finalUrl stays as the raw OpenAI image. Works for this session, just won't persist cheaply.
        // For a REGENERATION that fallback is not acceptable: it would put a
        // multi-megabyte data URI where a Storage URL belongs, and step 3 of
        // the safe-replacement sequence has genuinely failed. Fail hard and
        // keep the known-good image instead.
        if (isRegeneration) throw new Error(`upload failed: ${compressErr.message}`);
      }

      // SAFE REPLACEMENT ORDER (VisualizationRegenerationImplementation.md
      // §3). Firestore is written BEFORE the thumbnail changes, so what the
      // user sees can never be ahead of what is recorded: an image on screen
      // is always one they will still have after reopening the plan. The
      // original generation used the opposite order, which was harmless when
      // there was nothing to lose - but a regeneration has a known-good
      // image at stake, so the ordering matters.
      if (currentPlanId) {
        try {
          // A dotted field path, so this is a targeted write to ONE key
          // inside vizImages - the other approaches' images are not read,
          // rewritten, or even present in the payload, which is what makes
          // "generate Polished, then Elevated" additive rather than a
          // last-writer-wins overwrite of the map. It is also what keeps a
          // regeneration of one approach from disturbing the other two.
          await updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), { [`vizImages.${vizKey}`]: finalUrl });
          setHistory(prev => prev.map(h => h.id === currentPlanId ? { ...h, vizImages: { ...(h.vizImages || {}), [vizKey]: finalUrl } } : h));
        } catch (saveErr) {
          console.log("Save vizImage to plan error:", saveErr.message);
          if (isRegeneration) throw new Error(`persist failed: ${saveErr.message}`);
        }
      } else if (isRegeneration) {
        // Nothing to replace against - refuse rather than swap the thumbnail
        // for something that will not survive a reopen.
        throw new Error("this plan isn't saved yet");
      } else {
        console.log("No currentPlanId yet. Visualization shown locally but not persisted to a saved plan.");
      }

      // Step 5. Only now does the picture change.
      setVizImage(prev => ({ ...prev, [vizKey]: finalUrl }));
      logEvent(getAnalytics(), "visualization_generated", { format: isApproach ? "approach" : "tier", vizKey, regenerated: isRegeneration });

      // Step 6, best effort and deliberately last. The regeneration is
      // ALREADY successful by this point; an orphaned old object costs a
      // few KB of Storage, while rolling back would cost the user the new
      // image they just asked for. So this never throws and never reverts -
      // it only logs, so the orphan is findable later.
      if (isRegeneration && previousUrl && previousUrl !== finalUrl) {
        try {
          await deleteObject(storageRef(storage, previousUrl));
          dlog(`[VIZ REGEN] old object deleted for ${vizKey}`);
        } catch (cleanupErr) {
          dlog(`[VIZ REGEN] old object cleanup FAILED for ${vizKey} (new image kept): ${cleanupErr.message}`);
          logEvent(getAnalytics(), "visualization_cleanup_failed", { vizKey, reason: cleanupErr.message });
        }
      }
    } catch (e) {
      if (isRegeneration) {
        // The old image is untouched in Storage, in Firestore and on screen -
        // nothing above this point mutates any of them until the new one is
        // fully persisted.
        dlog(`[VIZ REGEN] failed for ${vizKey}, keeping existing image: ${e.message}`);
        logEvent(getAnalytics(), "visualization_regenerate_failed", { vizKey, reason: e.message });
        setVizError(prev => ({ ...prev, [vizKey]: "Couldn't regenerate. Tap to try again." }));
      } else {
        Alert.alert("Visualization failed", e.message);
      }
    } finally {
      stopVizTips();
      vizInFlightRef.current.delete(vizKey);
      setVizLoading(prev => ({ ...prev, [vizKey]: false }));
    }
  };


  // ---- Approach switching (ApproachSelectionDesign.md Section 6) ---------
  // Core rule: changing approach changes the FUTURE, not the past.
  //
  // State is derived, never stored, so it cannot go stale against the batch
  // it describes:
  //   none   - nothing selected yet; the initial chooser handles this
  //   state2 - selected, but every item is still untouched. Trivial.
  //   state3 - ANY item is checked, carried or skipped. Skipped counts:
  //            it is a deliberate user action and must be archived
  //            truthfully rather than silently dropped.
  //   state4 - the visit is finished. The approach is history; a new one is
  //            chosen by starting a fresh visit.
  const liveBatchItems = () => (batchItems.length ? batchItems : (results?.currentBatch?.items || []));
  const approachSwitchState = () => {
    if (!results?.approaches || !results.selectedApproach) return "none";
    if (results.companionComplete || companionCompletedProject) return "state4";
    return liveBatchItems().some((i) => i.status && i.status !== "pending") ? "state3" : "state2";
  };

  const switchApproach = async (newApproachId) => {
    if (!currentPlanId || !results?.approaches?.[newApproachId] || switchingApproach) return;
    // Tapping the approach you are already on is a dismissal, not a switch.
    if (newApproachId === results.selectedApproach) { setSwitchPickerOpen(false); return; }
    const state = approachSwitchState();
    if (state === "state4") return;
    setSwitchingApproach(newApproachId);
    try {
      const liveItems = liveBatchItems();
      // THE DISPOSITION RULE, in one place:
      //   checked  -> already permanent in the archived batch; not repeated
      //   carried  -> survives verbatim, same item id. The user said "still
      //               working on this"; that is invested effort, closer to
      //               completed than to a fresh suggestion
      //   pending  -> retired with the old approach. These belong to the old
      //               approach's guidance, and the new batch is composed
      //               fresh from the new approach's own checklist
      //   skipped  -> stays skipped in history, never reintroduced
      const carried = liveItems.filter((i) => i.status === "carried");
      const newTasks = (results.approaches[newApproachId].taskChecklist || [])
        .filter((t) => typeof t === "string" && t.trim())
        .map((text) => ({ id: makeItemId(), text, status: "pending" }));
      // Carried first, matching the ordering the existing rotation already
      // uses - continuing work reads above newly suggested work.
      const composedItems = [...carried, ...newTasks];

      // Archive ONLY in state 3. In state 2 nothing happened, so writing a
      // batch of untouched items into batchHistory would invent a chapter
      // of history the user never lived.
      const currentIndex = companionBatchIndex || results.currentBatch?.batchIndex || 1;
      const shouldArchive = state === "state3" && liveItems.length > 0;
      const archivedBatch = shouldArchive
        ? { batchIndex: currentIndex, items: liveItems, completedAt: new Date().toISOString() }
        : null;
      // Same shape generateNextAction writes. Not a new mechanism - an
      // early, user-triggered rotation without the progress-photo step,
      // because the user is changing direction, not reporting progress.
      const newBatchIndex = shouldArchive ? currentIndex + 1 : currentIndex;
      const newBatch = { batchIndex: newBatchIndex, suggestedAt: new Date().toISOString(), items: composedItems };
      const historyEntry = { approach: newApproachId, selectedAt: Timestamp.now() };

      await updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
        selectedApproach: newApproachId,
        approachHistory: arrayUnion(historyEntry),
        ...(archivedBatch ? { batchHistory: arrayUnion(archivedBatch) } : {}),
        currentBatch: newBatch,
        shadowSourceVersion: increment(1),
      });
      syncPlanToSpaceGraph(user.uid, currentPlanId)
        .catch((e) => dlog(`[APPROACH SWITCH] shadow resync failed for ${currentPlanId}: ${e.message}`));

      setResults((prev) => (prev ? {
        ...prev,
        selectedApproach: newApproachId,
        approachHistory: [...(prev.approachHistory || []), historyEntry],
        ...(archivedBatch ? { batchHistory: [...(prev.batchHistory || []), archivedBatch] } : {}),
        currentBatch: newBatch,
      } : prev));
      setHistory((prev) => prev.map((h) => (h.id === currentPlanId ? {
        ...h,
        selectedApproach: newApproachId,
        approachHistory: [...(h.approachHistory || []), historyEntry],
        ...(archivedBatch ? { batchHistory: [...(h.batchHistory || []), archivedBatch] } : {}),
        currentBatch: newBatch,
      } : h)));
      setBatchItems(composedItems);
      setCompanionBatchIndex(newBatchIndex);
      // The new approach becomes the expanded card, so returning to Results
      // shows what is now in effect rather than what used to be.
      setPreviewApproach(newApproachId);
      setSwitchPickerOpen(false);
      dlog(`[APPROACH SWITCH] ${results.selectedApproach} -> ${newApproachId} (${state}), carried ${carried.length}, new ${newTasks.length}, archived=${!!archivedBatch}`);
      logEvent(getAnalytics(), "approach_switched", {
        planId: currentPlanId, from: results.selectedApproach, to: newApproachId,
        state, carried: carried.length, archived: !!archivedBatch,
      });
    } catch (e) {
      console.log("Approach switch error:", e.message);
      Alert.alert("Couldn't change approach", "Please check your connection and try again.");
    } finally {
      setSwitchingApproach(null);
    }
  };

  // Product Intelligence v1: the single outbound path. Takes a resolution
  // object from resolveProductDestination and hands its URL to the OS.
  //
  // outbound_link_opened fires only after Linking.openURL resolves, and it
  // means exactly one thing: the OS accepted the handoff. It is NOT
  // evidence the user saw the retailer page, or that a browser rendered
  // anything - the app loses visibility the moment the URL leaves it. Named
  // "opened" rather than "viewed" or "visited" for that reason; do not
  // report it as a page view.
  const openResolvedProduct = async (resolution) => {
    if (!resolution?.url) return;
    try {
      await Linking.openURL(resolution.url);
      logEvent(getAnalytics(), "outbound_link_opened", {
        retailer: resolution.retailer,
        resolverKind: resolution.resolverKind,
        url: resolution.url,
      });
    } catch (e) {
      // Handoff refused by the OS (no browser, malformed scheme). Not an
      // open, so no event - the absence is the signal.
    }
  };

  // Back-compat shim for the pre-resolver call shape (a bare query string).
  // Old plans store `searchQuery` on tier products with no approach, no
  // grounding, and no problem ids; they route through the same resolver and
  // get the same resolution object, just with a thinner context.
  const openProduct = (q, context = {}) =>
    openResolvedProduct(resolveProductDestination({ searchTerms: q }, context));

  // Approach Selection Phase B (ApproachSelectionDesign.md Section 4): the
  // ONLY place a preview (previewApproach) ever becomes a durable
  // commitment. Two writes - selectedApproach and the first approachHistory
  // entry - must both land before Companion is seeded/shown; on failure the
  // user stays on Results with previewApproach untouched so they can retry
  // the same tap immediately, no state lost.
  const handleStartThisPlan = async () => {
    if (!previewApproach || !currentPlanId || startingPlan) return;
    const chosen = results.approaches?.[previewApproach];
    if (!chosen) return;
    setStartingPlan(true);
    try {
      // Firestore rejects the serverTimestamp() sentinel inside an array
      // element passed to arrayUnion (it can only resolve at the top level
      // of a write) - Timestamp.now() is the standard workaround: a real,
      // already-resolved client timestamp instead of a server-resolved
      // sentinel. Precise enough for a "when did the user pick this"
      // record; nothing here depends on server-authoritative time.
      const historyEntry = { approach: previewApproach, selectedAt: Timestamp.now() };
      await updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
        selectedApproach: previewApproach,
        approachHistory: arrayUnion(historyEntry),
      });
      const items = (chosen.taskChecklist || [])
        .filter(t => typeof t === "string" && t.trim())
        .map(text => ({ id: makeItemId(), text, status: "pending" }));
      const newBatch = { batchIndex: 1, suggestedAt: new Date().toISOString(), items };
      logEvent(getAnalytics(), "approach_selected", { planId: currentPlanId, approach: previewApproach });
      // Local echo of both writes, using the same historyEntry object
      // already sent to Firestore (Timestamp.now() is a real resolved
      // value, unlike the serverTimestamp() sentinel, so it's safe to
      // reuse directly instead of constructing a second stand-in value).
      setResults(prev => prev ? {
        ...prev,
        selectedApproach: previewApproach,
        approachHistory: [...(prev.approachHistory || []), historyEntry],
        currentBatch: newBatch,
      } : prev);
      setHistory(prev => prev.map(h => h.id === currentPlanId ? { ...h, selectedApproach: previewApproach, currentBatch: newBatch } : h));
      setCompanionBatchIndex(1);
      setBatchItems(items);
      setCompanionStage("batch-active");
      logEvent(getAnalytics(), "batch_shown", { planId: currentPlanId, batchIndex: 1 });
      setShowCompanion(true);
      setCompanionEnteredFromResults(true);
      setTimeout(() => companionScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
    } catch (e) {
      console.log("Start This Plan error:", e.message);
      Alert.alert("Couldn't start this plan", "Please check your connection and try again.");
    } finally {
      setStartingPlan(false);
    }
  };

  const shareResults = async () => {
    if (!results) return;
    try {
      // Format detection is presence-based, the same discriminator every
      // other reader uses: a plan has approaches or tiers, never both.
      if (results.approaches) {
        const identity = await resolveExportIdentity();
        const selectedId = results.selectedApproach || null;
        const a = selectedId ? results.approaches[selectedId] : null;

        let text = "✨ Uncluttrd Organization Plan\n";
        text += "Room: " + identity.label + "\n\n";
        text += "What we noticed\n" + results.overview + "\n\n";

        if (a) {
          const meta = APPROACH_META[selectedId] || {};
          text += `--- ${meta.name || selectedId} ---\n`;
          if (a.strategyDescription) text += a.strategyDescription + "\n";
          const guidance = (a.organizingGuidance || []).filter((g) => typeof g === "string" && g.trim());
          if (guidance.length) {
            text += "\nOrganizing guidance:\n";
            guidance.forEach((g, i) => { text += (i + 1) + ". " + g + "\n"; });
          }
          // Type and reason only - no price, no retailer link. Prices are
          // not on the recommendation schema at all any more, and the
          // affiliate search is a live app affordance rather than something
          // that belongs in a message someone forwards.
          const products = (a.productRecommendations || []).map(normalizeProductRecommendation).filter(Boolean);
          if (products.length) {
            text += "\nProducts for this space:\n";
            products.forEach((p) => {
              text += "• " + p.productType + " - " + resolveRecommendationReason(p, results.problemsFound) + "\n";
            });
          }
          text += "\n";
        } else {
          // Nothing chosen yet. Sharing one arbitrary approach here would
          // misrepresent a decision the user has not made.
          text += "Three organizing approaches available in the app.\n\n";
        }

        if (results.proTip) text += "💡 Pro Tip: " + results.proTip + "\n";
        text += "\nGenerated by Uncluttrd. More Space. More Time. More You.";
        await Share.share({ message: text, title: "My Uncluttrd Organization Plan" });
        return;
      }

      let text = "✨ Uncluttrd Organization Plan\n";
      text += "Room: " + getSpaceDisplayName(results) + "\n\n";
      text += results.overview + "\n\n";
      results.tiers?.forEach(t => {
        text += "--- " + t.label + " (" + t.range + ") ---\n";
        t.suggestions?.forEach((s, i) => { text += (i + 1) + ". " + s + "\n"; });
        text += "\nSuggested Products:\n";
        t.products?.forEach(p => { text += "• " + p.name + " - " + p.price + "\n"; });
        text += "\n";
      });
      if (results.proTip) text += "💡 Pro Tip: " + results.proTip + "\n";
      text += "\nGenerated by Uncluttrd. More Space. More Time. More You.";

      await Share.share({ message: text, title: "My Uncluttrd Organization Plan" });
    } catch (e) {
      Alert.alert("Share failed", e.message);
    }
  };


  const meta = (id) => TIERS.find(t => t.id === id) || TIERS[1];

  // A plan counts as an active Companion session worth surfacing on Home if the
  // user has engaged with it beyond just seeing the suggestion. Either they're
  // mid-loop (at least one item in currentBatch has been checked, carried, or
  // skipped). A freshly generated batch where every item is still "pending"
  // doesn't count; there's nothing to "continue" yet. Free plans are saved
  // and get a currentBatch too now, and the continuing-loop boundary (batch 2+)
  // is still entirely gated behind submitCompanionProgressPhoto's own isPro
  // check - this naturally stays scoped to a free user's one free batch, with
  // no separate isPro check needed here.
  // A plan the user already finished is never resumable, regardless of what
  // currentBatch still says - companionComplete is never cleared once set, so
  // without this check a finished project would keep showing the Home
  // "continue where you left off" banner forever.
  const isCompanionResumable = (plan) => {
    if (plan?.companionComplete) return false;
    const items = plan?.currentBatch?.items;
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.some(i => i.status !== "pending");
  };
  const resumablePlan = history.find(isCompanionResumable);

  // Room Detail (Phase B §2): a Room-level notion of "unfinished work",
  // broader than isCompanionResumable alone - a freshly generated batch
  // where every item is still "pending" isn't resumable (nothing to
  // continue yet, per isCompanionResumable's own comment), but it's still
  // unfinished work worth surfacing at the Room level. Same
  // "carried"/"pending" = unresolved definition used everywhere else in
  // this file (Remembered Home's prior-context note, the welcome-back
  // banner's unresolvedCount) - "skipped" items are an explicit past
  // decision, not left unresolved. A finished project is never unfinished
  // regardless of what currentBatch still says, same guard
  // isCompanionResumable already applies.
  const planHasUnfinishedWork = (plan) => {
    if (plan?.companionComplete) return false;
    if (isCompanionResumable(plan)) return true;
    const items = plan?.currentBatch?.items;
    return Array.isArray(items) && items.some((i) => i.status === "carried" || i.status === "pending");
  };

  // Step 5: non-blocking app-start reconciliation, scoped to the same
  // resumable plan Home already surfaces via the banner below - not a
  // sweep over all of history. Guarded by reconciledPlanIdRef so the
  // isPro-triggered re-run of loadHistory's effect (see its own comment)
  // doesn't re-trigger this for the same plan twice in one session;
  // harmless if it somehow did (syncPlanToSpaceGraph is itself
  // idempotent/version-guarded), this just avoids the extra reads.
  // Fire-and-forget: never awaited by render or navigation, and every
  // failure - from either the classification reads or the sync itself -
  // is caught here and only ever reaches dlog, never thrown.
  useEffect(() => {
    if (!resumablePlan || !user) return;
    if (reconciledPlanIdRef.current === resumablePlan.id) return;
    reconciledPlanIdRef.current = resumablePlan.id;
    reconcileActivePlanShadow(user.uid, resumablePlan.id)
      .catch(e => dlog(`[SPACE SHADOW RECONCILE] startup reconciliation failed for plan ${resumablePlan.id}: ${e.message}`));
  }, [resumablePlan?.id, user]);

  // §12 Migration Part 3, Pass 2 - non-blocking app-start query for the
  // merge-proposal Home banner (MergeProposalDesign.md Section 3). Runs
  // once per user (not re-polled/re-escalated during the session - a
  // single fetch, exactly like the "shown at most once per app session"
  // decision requires). After the user acts on a candidate inside the
  // review screen, the relevant handler splices it out of this state
  // directly rather than re-querying.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    queryMergeCandidatesForBanner(user.uid)
      .then(({ pending, staleUnacknowledged }) => {
        if (cancelled) return;
        setPendingMergeCandidates(pending);
        setStaleConfirmedCandidates(staleUnacknowledged);
        setMergeCandidatesLoaded(true);
      })
      .catch((e) => dlog(`[MERGE CANDIDATES] app-start query failed: ${e.message}`));
    return () => { cancelled = true; };
  }, [user]);

  // Fetches (once each) the plan documents referenced by whatever
  // candidates are currently loaded, for the review screen's evidence
  // cards. Only fetches plans not already cached, so revisiting the
  // review screen mid-session doesn't re-read anything already fetched.
  useEffect(() => {
    if (!showMergeReview || !user) return;
    const allPlanIds = new Set();
    pendingMergeCandidates.forEach((c) => (c.planIds || []).forEach((id) => allPlanIds.add(id)));
    const missing = [...allPlanIds].filter((id) => !(id in mergeReviewPlansById));
    if (missing.length === 0) return;
    setMergeReviewPlansLoading(true);
    Promise.all(missing.map(async (id) => {
      try {
        const snap = await getDoc(doc(db, "users", user.uid, "plans", id));
        return [id, snap.exists() ? { id, ...snap.data() } : null];
      } catch (e) {
        dlog(`[MERGE REVIEW] plan fetch failed for ${id}: ${e.message}`);
        return [id, null];
      }
    })).then((entries) => {
      setMergeReviewPlansById((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    }).finally(() => setMergeReviewPlansLoading(false));
  }, [showMergeReview, user, pendingMergeCandidates]);

  const toggleMergeSelection = (candidateId, planId) => {
    setMergeSelections((prev) => {
      const current = new Set(prev[candidateId] || []);
      if (current.has(planId)) current.delete(planId); else current.add(planId);
      return { ...prev, [candidateId]: current };
    });
  };

  // Full-vs-partial selection consistency (MergeProposalDesign.md Section
  // 9/10, this pass's explicit requirement): if every displayed member is
  // selected, the set didn't change - update the SAME document in place,
  // no split. Otherwise the set changed - supersede the original, create
  // two new independent documents.
  const handleConfirmSameSpace = async (candidate) => {
    const selected = Array.from(mergeSelections[candidate.id] || []).sort();
    if (selected.length < 2) return;
    setMergeActionLoadingId(candidate.id);
    try {
      const allIds = [...candidate.planIds].sort();
      const isFullSelection = selected.length === allIds.length && selected.every((id, i) => id === allIds[i]);
      if (isFullSelection) {
        await confirmMergeCandidateFull(user.uid, candidate.id, candidate.spaceType, selected);
      } else {
        await confirmMergeCandidatePartial(user.uid, candidate.id, candidate.spaceType, candidate.planIds, selected);
      }
      setPendingMergeCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      setMergeSelections((prev) => { const next = { ...prev }; delete next[candidate.id]; return next; });
    } catch (e) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setMergeActionLoadingId(null);
    }
  };

  const handleKeepSeparate = async (candidate) => {
    setMergeActionLoadingId(candidate.id);
    try {
      await keepMergeCandidateSeparate(user.uid, candidate.id);
      setPendingMergeCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch (e) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setMergeActionLoadingId(null);
    }
  };

  const handleDeferMergeCandidate = async (candidate, reasonTag) => {
    setMergeActionLoadingId(candidate.id);
    try {
      await deferMergeCandidate(user.uid, candidate.id, reasonTag);
      // Session-local removal only - resolutionStatus stays "pending" in
      // Firestore (deferMergeCandidate only touches lastShownAt/
      // deferredCount, per Section 5), so this candidate is still fully
      // eligible to surface again. Removing it from this array is what
      // advances the review flow to the next candidate and keeps THIS
      // session from re-showing it, exactly mirroring how the once-per-
      // session query effect (queryMergeCandidatesForBanner) already
      // only ever runs once on app start - the next real re-query, on
      // the next app launch, will pick it back up from Firestore as-is.
      setPendingMergeCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      // "Not Now"/"Not sure yet" hides the banner for the remainder of
      // this session only - nothing durable was decided about the
      // candidate itself (it stays pending).
      setMergeBannerDismissedThisSession(true);
    } catch (e) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setMergeActionLoadingId(null);
    }
  };

  // Not called from any render path - stale-confirmed candidates are no
  // longer proactively surfaced (see queryMergeCandidatesForBanner).
  // Left in place, not deleted, for a possible future history/decisions
  // view where acknowledging/reversing a stale-confirmed record would
  // still make sense.
  const handleAcknowledgeStale = async (candidate) => {
    setMergeActionLoadingId(candidate.id);
    try {
      await acknowledgeStaleConfirmed(user.uid, candidate.id);
      setStaleConfirmedCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch (e) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setMergeActionLoadingId(null);
    }
  };

  const handleReverseStale = async (candidate) => {
    setMergeActionLoadingId(candidate.id);
    try {
      await reverseStaleConfirmed(user.uid, candidate.id);
      setStaleConfirmedCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
    } catch (e) {
      Alert.alert("Couldn't save", e.message);
    } finally {
      setMergeActionLoadingId(null);
    }
  };

  // User-Managed Space Identity - rename bottom sheet handlers. Reused
  // from both the merge-review screen's evidence cards and the History
  // screen's row Alert (Task 6/7) - opening it only needs a planId and
  // its current display name, regardless of which screen triggered it.
  // roomId (Phase B): optional, explicit Room id to patch in `rooms` state
  // on save - passed by Room Detail, whose target plan may not be in the
  // capped `history` cache at all (an older visit `loadHistory`'s 20-plan
  // cap never fetched). Existing call sites (Results/Space-Detail-era
  // rename pencils) omit it and fall back to resolving the Room id from
  // `history` inside handleSaveRename, same as before this addition.
  // kind ("plan" | "area"): Area Identity, Phase A §7 - reuses this exact
  // sheet/Modal for Area rename rather than building a second one, since
  // the shape (title + text input + suggestions + Cancel/Save) is
  // otherwise identical. Only handleSaveRename's save call and this
  // sheet's title actually branch on it; everything else (the Modal
  // itself, the TextInput, the buttons) is shared unchanged.
  const openRenameSheet = (planId, currentName, roomId = null, kind = "plan") => {
    setRenamePlanTarget({ id: planId, currentName: currentName || "", roomId, kind });
    setRenameSheetValue(currentName || "");
  };
  // Area Identity, Phase A §7: id/roomId here are the AREA's own id and
  // its parent Room's id (not a plan id at all) - handleSaveRename's
  // "area" branch reads them that way.
  const openAreaRenameSheet = (area) => {
    openRenameSheet(area.id, area.displayName, area.roomId, "area");
  };
  const closeRenameSheet = () => {
    if (renameSheetSaving) return;
    setRenamePlanTarget(null);
    setRenameSheetValue("");
  };
  // Resolves which Room id a plan-rename target actually belongs to - the
  // same resolution renameSpace itself performs server-side. Shared by
  // the duplicate-name check and the actual save, so they can never
  // disagree about which Room is being renamed.
  const resolveRenameTargetRoomId = () => {
    if (!renamePlanTarget || renamePlanTarget.kind === "area") return null;
    const cachedForRename = history.find((h) => h.id === renamePlanTarget.id);
    return renamePlanTarget.roomId || (cachedForRename ? (cachedForRename.canonicalSpaceId || cachedForRename.id) : null);
  };

  // The actual Room rename save + local-cache patching - extracted so
  // both the direct (no-duplicate) path and "Rename anyway" (Room Rename
  // Validation, 2026-08-10) call the exact same save logic, never two
  // parallel implementations of it.
  const performRoomRename = async () => {
    const trimmed = renameSheetValue.trim();
    // Synchronous re-entry guard. The existing renameSheetSaving state still
    // drives the visible "Saving..." label; it cannot also serve as the
    // guard, because two submits in the same frame both read it as false.
    if (roomRenameInFlightRef.current) return;
    roomRenameInFlightRef.current = true;
    setRenameSheetSaving(true);
    try {
      await renameSpace(user.uid, renamePlanTarget.id, trimmed);
      // Patch every local cache that might be displaying this plan's name
      // right now, so the UI reflects the rename immediately without
      // waiting for a re-query - the review screen's evidence cards and
      // the History list are both plain plan-field caches, keyed the same
      // way real Firestore documents are, so a targeted patch is exact,
      // not a guess.
      setMergeReviewPlansById((prev) => (renamePlanTarget.id in prev ? { ...prev, [renamePlanTarget.id]: { ...prev[renamePlanTarget.id], spaceName: trimmed } } : prev));
      setHistory((prev) => prev.map((h) => (h.id === renamePlanTarget.id ? { ...h, spaceName: trimmed } : h)));
      if (currentPlanId === renamePlanTarget.id) setResults((prev) => (prev ? { ...prev, spaceName: trimmed } : prev));
      // My Rooms -> True Room Grouping, Phase B: `rooms` is now the
      // primary source Room Detail's header (and My Rooms' own cards) read
      // displayName from - without this patch a rename wouldn't visibly
      // "stick" on either screen until the next loadRooms() re-fetch.
      const renamedRoomId = resolveRenameTargetRoomId();
      if (renamedRoomId) {
        setRooms((prev) => prev.map((r) => (r.id === renamedRoomId ? { ...r, displayName: trimmed } : r)));
      }
      setRoomDetailPlans((prev) => prev.map((p) => (p.id === renamePlanTarget.id ? { ...p, spaceName: trimmed } : p)));
      setRenamePlanTarget(null);
      setRenameSheetValue("");
      setRenameDuplicateDialog(null);
    } catch (e) {
      Alert.alert("Couldn't rename", e.message);
    } finally {
      setRenameSheetSaving(false);
      roomRenameInFlightRef.current = false;
    }
  };

  const handleSaveRename = async () => {
    const trimmed = renameSheetValue.trim();
    if (!renamePlanTarget || !trimmed) return;
    setRenameSheetSaving(true);
    // Area Identity, Phase A §7/§8: a completely separate, much smaller
    // save path - writes ONLY Area.displayName (renameArea's own
    // contract), never touches any plan's spaceName/areaName field, and
    // patches only roomDetailAreas (the one place an Area's name is
    // rendered in Phase A). Does not fall through to the plan-rename
    // logic below at all. No duplicate-name check either - Room Rename
    // Validation is a Room-level concern only (an Area's uniqueness scope
    // is a whole separate question the task doesn't ask for).
    if (renamePlanTarget.kind === "area") {
      try {
        await renameArea(user.uid, renamePlanTarget.roomId, renamePlanTarget.id, trimmed);
        setRoomDetailAreas((prev) => prev.map((a) => (a.id === renamePlanTarget.id ? { ...a, displayName: trimmed } : a)));
        setRenamePlanTarget(null);
        setRenameSheetValue("");
      } catch (e) {
        Alert.alert("Couldn't rename", e.message);
      } finally {
        setRenameSheetSaving(false);
      }
      return;
    }

    // Room Rename Validation (2026-08-10): case-insensitive match against
    // every OTHER non-retired Room (rooms is already filtered to
    // non-retired at load time - see loadRooms). Duplicate names are
    // allowed (two legitimate bedrooms) - this only gates on it being a
    // CONSCIOUS choice, never blocks outright. No match -> proceed
    // exactly as before, unchanged.
    const renamedRoomId = resolveRenameTargetRoomId();
    const existingMatch = rooms.find((r) => r.id !== renamedRoomId && (r.displayName || "").trim().toLowerCase() === trimmed.toLowerCase());
    if (existingMatch) {
      setRenameSheetSaving(false);
      setMergeRoomsError(null);
      setRenameDuplicateDialog({ matchedRoom: { id: existingMatch.id, displayName: existingMatch.displayName }, newName: trimmed, sourceRoomId: renamedRoomId });
      return;
    }

    await performRoomRename();
  };

  // Room Rename Validation option (b): "this IS the existing Room, the AI
  // just got it wrong" - moves every plan out of the misidentified Room
  // into the matched existing one via the proven reclassification
  // workflow, then closes both the dialog and the rename sheet (renaming
  // the source Room's own displayName would be meaningless - it's about
  // to be retired). If the Room Detail screen for the source Room happens
  // to be open right now, it's no longer a valid destination (the Room
  // was just retired) - back out to My Rooms rather than leave a dead
  // screen showing.
  const handleMovePlansIntoExisting = async () => {
    if (!renameDuplicateDialog) return;
    // Synchronous re-entry guard (2026-08-17, production freeze diagnostic).
    // mergeRoomIntoRoom is a multi-second, multi-phase operation - the real
    // production run took ~2.5s - and the confirm button had no guard at all,
    // not even a state check. A second tap started a second full merge whose
    // Phase 1 snapshot reads plans the first run had already moved.
    if (mergeRoomsInFlightRef.current) return;
    mergeRoomsInFlightRef.current = true;
    setMergeRoomsSaving(true);
    setMergeRoomsError(null);
    try {
      const result = await mergeRoomIntoRoom(user.uid, renameDuplicateDialog.sourceRoomId, renameDuplicateDialog.matchedRoom.id);
      if (result.outcome !== "completed") {
        throw new Error(`${result.movedCount}/${result.totalCount} plans moved - one or more failed. Please try again.`);
      }
      setRooms((prev) => prev.filter((r) => r.id !== renameDuplicateDialog.sourceRoomId));
      if (roomDetailRoomId === renameDuplicateDialog.sourceRoomId) {
        setRoomDetailRoomId(null);
        setShowHistory(true);
      }
      // STACKED MODAL DISMISSAL - the production freeze (2026-08-17).
      //
      // The duplicate-name branch of handleSaveRename deliberately leaves
      // renamePlanTarget set while it opens renameDuplicateDialog, so BOTH
      // sibling Modals are mounted at once: the rename sheet
      // (animationType="slide") underneath, the duplicate dialog
      // (animationType="fade") on top. Clearing both in this one commit
      // dismissed two stacked RN Modals in a single frame, which on iOS
      // leaves an invisible, undismissed overlay swallowing every touch -
      // the app keeps rendering but is dead to input. The Firestore writes
      // had already completed ~2.5s earlier, which is why the merge landed
      // perfectly while the UI was unusable.
      //
      // Dismissed in sequence instead: the top (fade) modal first, then the
      // sheet underneath only after its exit animation has run. setTimeout
      // rather than Modal's onDismiss because onDismiss is iOS-only, and this
      // ordering must hold on Android too. 400ms comfortably clears RN's
      // ~300ms modal transition without being perceptible as a delay - the
      // dialog is already gone by then.
      setRenameDuplicateDialog(null);
      setTimeout(() => {
        setRenamePlanTarget(null);
        setRenameSheetValue("");
      }, 400);
    } catch (e) {
      setMergeRoomsError(e.message || "Something went wrong moving your plans. Please try again.");
    } finally {
      mergeRoomsInFlightRef.current = false;
      setMergeRoomsSaving(false);
    }
  };

  // Suggestions: distinct display names already used across the user's
  // OWN other plans (never AI-generated) - derived from `history`, which
  // is already loaded (loadHistory's effect), so this is a plain
  // client-side computation, not a new query (Task 6).
  const renameSuggestions = () => {
    // Area Identity, Phase A: these are OTHER ROOMS' names - irrelevant,
    // and potentially confusing, as rename suggestions for an Area.
    if (!renamePlanTarget || renamePlanTarget.kind === "area") return [];
    const names = new Set();
    history.forEach((h) => {
      const n = getSpaceDisplayName(h);
      if (n && n !== renamePlanTarget.currentName) names.add(n);
    });
    return [...names].slice(0, 8);
  };

  // Rendered from within both the merge-review screen and the History
  // screen's own return blocks (each is a separate early-return branch,
  // so the same Modal element has to be included in each one to ever
  // render, regardless of which screen triggered it) - defined once here
  // so neither branch duplicates the JSX itself.
  const renderRenameSheet = () => (
    <>
      {/* Keyboard fix (on-device, iOS, 2026-08-12). The sheet is bottom-
          anchored (renameSheetBackdrop is justifyContent: flex-end), so an
          iOS keyboard covered the input and both buttons outright - the
          user could not see what they were typing. KeyboardAvoidingView
          with behavior="padding" lifts the card; "height" is used on
          Android, where the window resizes instead.

          The KAV wraps the WHOLE backdrop rather than just the card,
          because the card is positioned by the backdrop's flex-end and
          padding applied outside that has nothing to push against. */}
      <Modal visible={!!renamePlanTarget} animationType="slide" transparent onRequestClose={closeRenameSheet}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={s.renameSheetBackdrop}>
          {/* Dismisses the KEYBOARD, not the sheet. Closing the sheet here
              threw away whatever the user had typed the moment they tapped
              anywhere to get the keyboard out of the way - Cancel is the
              deliberate way out. */}
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => Keyboard.dismiss()} accessibilityLabel="Dismiss keyboard" accessibilityRole="button" />
          <View style={s.renameSheetCard}>
            <Text style={s.renameSheetTitle}>{renamePlanTarget?.kind === "area" ? "Rename Area" : "Rename Room"}</Text>
            <TextInput
              style={s.renameSheetInput}
              value={renameSheetValue}
              onChangeText={setRenameSheetValue}
              maxLength={50}
              placeholder="e.g. Kitchen"
              placeholderTextColor="#94A3B8"
              autoFocus
              editable={!renameSheetSaving}
              returnKeyType="done"
              onSubmitEditing={() => { if (renameSheetValue.trim() && !renameSheetSaving) handleSaveRename(); }}
            />
            {renameSuggestions().length > 0 && (
              <>
                <Text style={s.renameSuggestionsLabel}>Names you've used before</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {renameSuggestions().map((name) => (
                    <TouchableOpacity key={name} style={s.renameSuggestionChip} onPress={() => setRenameSheetValue(name)} disabled={renameSheetSaving}>
                      <Text style={s.renameSuggestionChipText}>{name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} onPress={closeRenameSheet} disabled={renameSheetSaving}>
                <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.startOverBtn, { flex: 1, marginTop: 0, backgroundColor: (renameSheetValue.trim() && !renameSheetSaving) ? BRAND.green : "#CBD5E1", borderWidth: 0 }]}
                onPress={handleSaveRename}
                disabled={!renameSheetValue.trim() || renameSheetSaving}
              >
                <Text style={[s.startOverText, { color: "white" }]}>{renameSheetSaving ? "Saving..." : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Room Rename Validation (2026-08-10): shown INSTEAD OF an
          immediate rename when the submitted name matches an existing
          non-retired Room. Three options, per the design's own explicit
          rule - no per-candidate reject, just these three: (a) rename
          anyway (duplicate names are allowed, this just makes it a
          conscious choice), (b) move plans into the existing Room (the
          actual "this was a misclassification, not a rename" correction
          path - reclassifyLegacyPlan/mergeRoomIntoRoom above), (c) cancel
          (back out, nothing changes, the rename sheet stays open with the
          typed name intact so the user can edit it). Rendered as a
          second Modal stacked on top of the rename sheet's own Modal,
          same pattern this function already uses for one screen showing
          two modals. */}
      <Modal visible={!!renameDuplicateDialog} animationType="fade" transparent onRequestClose={() => { if (!mergeRoomsSaving) setRenameDuplicateDialog(null); }}>
        <View style={s.renameSheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => { if (!mergeRoomsSaving) setRenameDuplicateDialog(null); }} accessibilityLabel="Close" accessibilityRole="button" />
          <View style={s.renameSheetCard}>
            <Text style={s.renameSheetTitle}>{`You already have a Room called "${renameDuplicateDialog?.matchedRoom?.displayName || ""}"`}</Text>
            <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 16 }}>Are you sure you want to use this name - or is this actually the same Room, just misidentified?</Text>
            {mergeRoomsError && (
              <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: "#B91C1C" }}>{mergeRoomsError}</Text>
              </View>
            )}
            <TouchableOpacity
              disabled={mergeRoomsSaving}
              style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0, opacity: mergeRoomsSaving ? 0.6 : 1 }]}
              onPress={performRoomRename}
              accessibilityLabel="Rename anyway"
              accessibilityRole="button"
            >
              <Text style={[s.startOverText, { color: "white" }]}>Rename anyway</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={mergeRoomsSaving}
              style={[s.startOverBtn, { marginTop: 10, backgroundColor: BRAND.green, borderWidth: 0, opacity: mergeRoomsSaving ? 0.6 : 1 }]}
              onPress={handleMovePlansIntoExisting}
              accessibilityLabel={`Move plans to ${renameDuplicateDialog?.matchedRoom?.displayName || "existing Room"}`}
              accessibilityRole="button"
            >
              <Text style={[s.startOverText, { color: "white" }]}>{mergeRoomsSaving ? "Moving..." : `Move plans to ${renameDuplicateDialog?.matchedRoom?.displayName || ""}`}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={mergeRoomsSaving} style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => setRenameDuplicateDialog(null)}>
              <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
            {mergeRoomsSaving && <ProcessingOverlay text="Moving plans..." />}
          </View>
        </View>
      </Modal>
    </>
  );

  // Full-screen photo viewer - reuses the existing vizModal/vizModalKey
  // state (pinch-zoom, close button) originally built for the AI
  // visualization images and Results' own starting photo. Extracted here
  // (Phase B) since Room Detail is now a second real caller alongside
  // Results, matching this file's own renderRenameSheet precedent for a
  // modal rendered from more than one screen's return block.
  const renderPhotoZoomModal = () => (
    <Modal visible={!!vizModal} transparent={true} animationType="fade" onRequestClose={() => setVizModal(null)}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={s.vizModalBg}>
          <TouchableOpacity style={s.vizModalClose} onPress={() => setVizModal(null)}>
            <X size={20} color="white" strokeWidth={2.25} />
          </TouchableOpacity>
          {vizModal && (
            <ImageZoom
              key={vizModalKey}
              uri={vizModal}
              minScale={1}
              maxScale={5}
              isDoubleTapEnabled={true}
              style={s.vizModalImage}
              resizeMode="contain"
            />
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );

  const resumeCompanionSession = (item) => {
    logEvent(getAnalytics(), "companion_session_resumed", { planId: item.id, source: "home_banner" });
    setResults(item);
    setShowCompanion(true);
    // Jumps straight from Home to Companion, skipping Results entirely -
    // explicitly NOT a "came from Results" entry (companionEnteredFromResults
    // stays false), so Companion's back bar correctly stays hidden for this
    // path per the Navigation UI Consistency audit's own instruction.
    setCompanionEnteredFromResults(false);
    setResultsCameFromRoomDetail(null);
    setVizImage(item.vizImages || {});
    setVizLoading({});
    setCurrentPlanId(item.id);
    restorePhotoFromPlan(item);
  };

  // Two explicit, unambiguous destinations from Space Detail - replacing
  // the previous single openCompanionOrResults(item), which computed
  // showCompanion from `hasCompanionContent = !!item.companionComplete ||
  // (currentBatch.items.length > 0)`. That expression is true for nearly
  // every real plan (a completed plan always has companionComplete set;
  // an in-progress one always has currentBatch.items) - so
  // setShowCompanion(hasCompanionContent) was landing on Companion
  // (results && showCompanion, ~5150) almost unconditionally, and Results
  // (results && !showCompanion, ~4967) - where the actual approach cards/
  // product recommendations/visualization live - was becoming
  // unreachable from "View Full Plan" in practice. Root cause was this
  // conflation, not a missing navigation path - the Results screen itself
  // was never touched and never went anywhere.
  //
  // "View Full Plan" must ALWAYS open Results - no conditional.
  //
  // Also clears every OTHER screen flag that sits between Room Detail's
  // own render condition and Results' in the render chain - showFaq,
  // showMergeReview, showSpaceInspector, showAccount. Each top-level
  // screen is its own early-return `if (flag) return (...)`, checked in
  // source order on every render - Room Detail's check fires first and
  // masks any of these being left true from earlier navigation in the
  // same session, but the instant roomDetailRoomId is cleared (as this
  // function does), the chain falls through to the next truthy flag
  // instead of Results if one of them was never reset. Third occurrence
  // of this exact bug class (goHome, then the merge-review screen, now
  // here) - always clear every flag between where you are and where
  // you're going, not just the one you're leaving.

  // My Rooms -> True Room Grouping, Phase B: opens Room Detail for a tapped
  // Room card - replaces Phase A's temporary Alert-bridge tap behavior
  // (showPlanActionsAlert/openRoomFromCard, both removed; Room Detail is
  // now the real destination, not a bridge to plan-shaped actions).
  const openRoomDetail = (room) => {
    setShowHistory(false);
    setRoomDetailRoomId(room.id);
  };

  const openSpaceResults = (item) => {
    setShowFaq(false);
    setShowMergeReview(false);
    setShowSpaceInspector(false);
    setShowAccount(false);
    setJustConfirmedRecognition(null); // browsing to a plan via History/Room Detail is not a fresh confirmation - no stale banner
    setResults(item);
    setShowCompanion(false);
    setVizImage(item.vizImages || {});
    setVizLoading({});
    setCurrentPlanId(item.id);
    setRoomDetailRoomId(null);
    setResultsCameFromRoomDetail(null);
    setCompanionEnteredFromResults(false);
    restorePhotoFromPlan(item);
  };
  // "Continue Organizing" - only ever reached when the user explicitly
  // chooses it (only rendered when isCompanionResumable(item) is true -
  // see the Room Detail screen below), never as a default. Same
  // intervening-flag vulnerability and fix as openSpaceResults above -
  // the Companion render condition (results && showCompanion) sits even
  // further down the chain, past all the same flags.
  const openCompanionSession = (item) => {
    setShowFaq(false);
    setShowMergeReview(false);
    setShowSpaceInspector(false);
    setShowAccount(false);
    logEvent(getAnalytics(), "companion_session_resumed", { planId: item.id, source: "room_detail" });
    setJustConfirmedRecognition(null);
    setResults(item);
    setShowCompanion(true);
    setVizImage(item.vizImages || {});
    setVizLoading({});
    setCurrentPlanId(item.id);
    setRoomDetailRoomId(null);
    setResultsCameFromRoomDetail(null);
    setCompanionEnteredFromResults(false);
    restorePhotoFromPlan(item);
  };
  // Room Detail -> tap a prior visit -> that plan's Results (Phase B §5).
  // Captures roomDetailRoomId BEFORE openSpaceResults clears it (same
  // clear-every-flag-between-screens discipline its own comment already
  // documents), so the correct Room to return to survives into
  // resultsCameFromRoomDetail.
  const openRoomDetailVisit = (item) => {
    const roomId = roomDetailRoomId;
    openSpaceResults(item);
    setResultsCameFromRoomDetail(roomId);
  };
  // Room Detail's own "Continue where you left off" CTA (Phase B §2) -
  // same capture-before-clear pattern as openRoomDetailVisit. Companion's
  // own back arrow already returns to Results unchanged; tagging this path
  // too means Results' OWN back (see returnToRoomDetail) correctly
  // continues the chain back to Room Detail from there.
  const openRoomDetailUnfinishedCTA = (item) => {
    const roomId = roomDetailRoomId;
    openCompanionSession(item);
    setResultsCameFromRoomDetail(roomId);
  };
  // Results -> back -> Room Detail (Phase B §5/§3.h), reached only when
  // resultsCameFromRoomDetail is set. Mirrors the relevant subset of
  // goHome()'s own resets for leaving Results/Companion, but deliberately
  // does NOT touch showHistory/showMenu/etc - this is a lateral return to
  // Room Detail, not a full reset to Home.
  const returnToRoomDetail = (roomId) => {
    setResults(null);
    setShowCompanion(false);
    setCurrentPlanId(null);
    setVizImage({});
    setVizLoading({});
    setJustConfirmedRecognition(null);
    setResultsCameFromRoomDetail(null);
    setCompanionEnteredFromResults(false);
    setRoomDetailRoomId(roomId);
  };
  // Area Re-parenting Phase A (AreaReparentingDesign.md §9/§10): the
  // reusable Room Picker's own entry points. Room-level "Move to another
  // Room" was a placeholder until now - closes that gap by opening the
  // SAME picker/confirmation/processing components Area-move uses, scoped
  // to { kind: "room" } instead of { kind: "area" }. roomPickerFor's own
  // shape is what onRoomPickerSelectForMove/confirmMove below branch on.
  const openAreaMovePicker = (area) => {
    setAreaActionsFor(null);
    setMoveError(null);
    setRoomPickerFor({ kind: "area", area, sourceRoomId: roomDetailRoomId });
  };
  const openRoomMovePicker = (room) => {
    setMoveError(null);
    setRoomPickerFor({ kind: "room", room });
  };
  // Cancelling out of the picker means something different for a session:
  // the picker is step 2 of a flow whose step 1 (the options sheet) is
  // still open underneath, so Cancel goes BACK rather than abandoning the
  // whole classification. For the two move flows it stays a plain close.
  const closeRoomPicker = () => {
    // A whole-Room classification now commits from inside this picker, so this
    // is a live dismissal path during that write - backdrop tap, Cancel and
    // Android back all land here.
    if (classifyInFlightRef.current) return;
    if (roomPickerFor?.kind === "session") {
      setRoomPickerFor(null);
      setClassifyStep("options");
      return;
    }
    setRoomPickerFor(null);
  };

  // Picking a Room never moves anything directly - it resolves to a
  // confirmation step first, matching the destructive/consequential-action
  // discipline every other move/delete flow in this file already follows
  // (rename-duplicate's own "Move plans to X" is a second, explicit tap,
  // never a same-tap action).
  const onRoomPickerSelectForMove = (targetRoom) => {
    const ctx = roomPickerFor;
    if (!ctx) return;
    // Session classification has no separate confirmation step, and that
    // is deliberate: it is a repair, not a destructive move. Nothing is
    // merged or retired, the session simply lands where the user says it
    // belongs, and getting it wrong is fixable by classifying again.
    if (ctx.kind === "session") {
      if (ctx.mode === "whole") {
        // Deliberately does NOT clear roomPickerFor first. runClassify's
        // overlay needs a mounted host to paint on, and this picker is the
        // only thing on screen at this point - closing it here ran the entire
        // commit behind a bare Needs Review list with no feedback at all,
        // which is the gap being fixed. closeClassify (on success) clears
        // roomPickerFor itself; on failure the picker stays up and shows the
        // error inline.
        runClassify(targetRoom.id, null);
        return;
      }
      setRoomPickerFor(null);
      enterAreaStep(targetRoom);
      return;
    }
    setRoomPickerFor(null);
    setMoveConfirmTarget({ ...ctx, targetRoom });
  };

  const closeMoveConfirm = () => {
    if (moveSaving) return;
    setMoveConfirmTarget(null);
    setMoveError(null);
  };

  // The actual execution step, shared by both flows - branches only on
  // moveConfirmTarget.kind to call moveAreaToRoom vs. the existing
  // mergeRoomIntoRoom, then patches local state and navigates to the
  // target Room's Room Detail. roomDetailPlans/roomDetailAreas are both
  // keyed on roomDetailRoomId (see their own effects) - changing that one
  // id is enough to load the target Room's now-current data, no separate
  // refetch call needed.
  const confirmMove = async () => {
    if (!moveConfirmTarget) return;
    setMoveSaving(true);
    setMoveError(null);
    try {
      if (moveConfirmTarget.kind === "area") {
        const { area, sourceRoomId, targetRoom } = moveConfirmTarget;
        const result = await moveAreaToRoom(user.uid, sourceRoomId, area.id, targetRoom.id);
        // "already-completed" is moveAreaToRoom's own idempotency
        // short-circuit (a prior run of this exact move finished) - a
        // success for the user's purposes, not an error: the Area really
        // is under the target Room, which is all the confirmation
        // promised. Only genuine failures fall through to the throw.
        if (result.outcome !== "completed" && result.outcome !== "already-completed") {
          throw new Error(result.reason || `${result.movedCount ?? 0}/${result.totalCount ?? 0} visits moved - one or more failed. Please try again.`);
        }
        const [freshSource, freshTarget] = await Promise.all([
          getDoc(doc(db, "users", user.uid, "spaces", sourceRoomId)),
          getDoc(doc(db, "users", user.uid, "spaces", targetRoom.id)),
        ]);
        setRooms((prev) => prev.map((r) => {
          if (r.id === sourceRoomId && freshSource.exists()) return { id: r.id, ...freshSource.data() };
          if (r.id === targetRoom.id && freshTarget.exists()) return { id: r.id, ...freshTarget.data() };
          return r;
        }));
        setMoveConfirmTarget(null);
        setShowHistory(false);
        setRoomDetailRoomId(targetRoom.id);
      } else {
        const { room, targetRoom } = moveConfirmTarget;
        const result = await mergeRoomIntoRoom(user.uid, room.id, targetRoom.id);
        if (result.outcome !== "completed") {
          throw new Error(`${result.movedCount}/${result.totalCount} visits moved - one or more failed. Please try again.`);
        }
        // A full Room-level merge moves every plan out, which retires the
        // source Room itself (reclassifyLegacyPlan's own cleanUpOldSpace,
        // once its last Project is gone) - same post-merge state patch
        // handleMovePlansIntoExisting already applies for the identical
        // outcome via the rename-duplicate path.
        setRooms((prev) => prev.filter((r) => r.id !== room.id));
        setMoveConfirmTarget(null);
        setShowHistory(false);
        setRoomDetailRoomId(targetRoom.id);
      }
    } catch (e) {
      setMoveError(e.message || "Something went wrong moving this. Please try again.");
    } finally {
      setMoveSaving(false);
    }
  };

  // ---- Session Recovery: classification flow (SessionRecoveryDesign.md §4)
  // classifyStep encodes both where we are AND what a Room selection means,
  // so no separate "mode" state can drift out of sync with it:
  //   options | pick-room-whole | pick-room-area | pick-area | name-room | name-area
  const refreshRecovery = () => setRecoveryReloadKey((k) => k + 1);
  const openClassify = (plan) => {
    setClassifyFor(plan);
    setClassifyStep("options");
    setClassifyRoom(null);
    setClassifyAreas([]);
    setClassifyName("");
    setClassifyError(null);
  };
  const closeClassify = () => {
    // Guards on the ref, not classifySaving: the state a given render captured
    // can be stale by the time a tap fires, and every dismissal path (backdrop
    // tap, Cancel, Android back, onRequestClose) routes through here.
    if (classifyInFlightRef.current) return;
    setClassifyFor(null);
    setClassifyStep(null);
    setClassifyRoom(null);
    setClassifyAreas([]);
    setClassifyName("");
    setClassifyError(null);
    setRoomPickerFor(null);
  };
  // Areas are definitionally Room-owned, so this is a plain subcollection
  // read with none of roomDetailPlans' OR-query complexity.
  const enterAreaStep = async (room) => {
    setClassifyRoom(room);
    setClassifyStep("pick-area");
    try {
      const snap = await getDocs(collection(db, "users", user.uid, "spaces", room.id, "areas"));
      setClassifyAreas(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => !a.retired));
    } catch (e) {
      dlog(`[RECOVERY] area load failed for room ${room.id}: ${e.message}`);
      setClassifyAreas([]);
    }
  };
  // The single commit point for options 1, 2 and 3. Everything upstream
  // only decides which (Room, Area) pair to pass, so a session classified
  // as whole-Room and one classified into an Area travel identical code.
  const runClassify = async (targetRoomId, targetAreaId, newAreaName = null) => {
    if (!classifyFor) return;
    if (classifyInFlightRef.current) return;
    classifyInFlightRef.current = true;
    // Resolve the destination label BEFORE any await, from the arguments this
    // call was given - reading it off state later could race a re-render.
    const roomName = (rooms.find((r) => r.id === targetRoomId) || classifyRoom || {}).displayName || "this Room";
    const areaLabel = newAreaName || (classifyAreas.find((a) => a.id === targetAreaId) || {}).displayName || null;
    setClassifyText(areaLabel ? `Moving to ${roomName} / ${areaLabel}...` : `Assigning to ${roomName}...`);
    setClassifySaving(true);
    setClassifyError(null);
    try {
      const result = await classifySession(user.uid, classifyFor.id, { targetRoomId, targetAreaId, newAreaName });
      if (result.outcome !== "completed") throw new Error(result.reason || "Couldn't file this session. Please try again.");
      // Create-a-new-Area runs AFTER the move, deliberately: createAreaForPlan
      // creates the Area under the target Room and reads the plan's OWN
      // photoUrl for originalPhotoUrl, so the plan must already be under
      // that Room for its shadow Project to land with the right areaId.
      if (newAreaName) {
        const created = await createAreaForPlan(user.uid, targetRoomId, classifyFor.id, newAreaName);
        if (!created) throw new Error("The session moved, but the new Area couldn't be created. Try assigning it to an Area again.");
        await updateSpaceRoomSummary(user.uid, targetRoomId);
      }
      const freshRoom = await getDoc(doc(db, "users", user.uid, "spaces", targetRoomId));
      if (freshRoom.exists()) {
        setRooms((prev) => {
          const next = { id: targetRoomId, ...freshRoom.data() };
          return prev.some((r) => r.id === targetRoomId) ? prev.map((r) => (r.id === targetRoomId ? next : r)) : [next, ...prev];
        });
      }
      logEvent(getAnalytics(), "session_classified", { planId: classifyFor.id, scope: (targetAreaId || newAreaName) ? "area" : "room" });
      // Release the guard BEFORE closeClassify, which now refuses to run while
      // a commit is in flight - the behaviour we want for a Cancel tap and
      // exactly wrong for this success path. refreshRecovery re-runs the
      // unresolved query, which is what drops this session out of the list and
      // updates the header count.
      classifyInFlightRef.current = false;
      setClassifySaving(false);
      closeClassify();
      refreshRecovery();
      return;
    } catch (e) {
      // Failure leaves the plan in whatever state classifySession left it -
      // unclassified unless it reported "completed" - and keeps the sheet open
      // with the error visible so the user can retry. Only the overlay comes
      // down; nothing here rolls anything back or closes the flow.
      setClassifyError(e.message || "Something went wrong. Please try again.");
    }
    classifyInFlightRef.current = false;
    setClassifySaving(false);
  };
  const submitNewRoomName = async () => {
    const trimmed = classifyName.trim();
    if (!trimmed) return;
    if (classifyInFlightRef.current) return;
    classifyInFlightRef.current = true;
    setClassifyText(`Creating ${trimmed}...`);
    setClassifySaving(true);
    setClassifyError(null);
    try {
      const created = await createRoomSpace(user.uid, trimmed);
      if (created.outcome !== "created") throw new Error("Couldn't create that Room. Please try again.");
      const snap = await getDoc(doc(db, "users", user.uid, "spaces", created.roomId));
      const room = { id: created.roomId, ...snap.data() };
      setRooms((prev) => [room, ...prev]);
      setClassifyName("");
      // Straight into the Area step for the new Room. Its first entry is
      // "Whole Room", so this covers both "new Room, whole-room session"
      // and "new Room, then an Area inside it" without a second pass -
      // which is what §3 option 3's "or continue to Area selection within
      // the new Room" asks for.
      await enterAreaStep(room);
    } catch (e) {
      setClassifyError(e.message || "Couldn't create that Room. Please try again.");
    } finally {
      // Released on BOTH paths: success hands off to the Area step, which is
      // its own commit and needs the guard free again.
      classifyInFlightRef.current = false;
      setClassifySaving(false);
    }
  };
  const handleDeleteSession = (plan) => {
    Alert.alert(
      DELETE_CONFIRM.session().title,
      DELETE_CONFIRM.session().body,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            // Same guard as every other commit here. The Alert itself is
            // dismissed by the tap, so a double-tap cannot re-enter through it -
            // but handleDeleteSession is also reachable from the options sheet,
            // and softDeletePlan is a real write with real latency.
            if (classifyInFlightRef.current) return;
            classifyInFlightRef.current = true;
            setClassifyText("Deleting session...");
            setClassifySaving(true);
            try {
              await softDeletePlan(user.uid, plan.id);
              classifyInFlightRef.current = false;
              setClassifySaving(false);
              closeClassify();
              refreshRecovery();
            } catch (e) {
              classifyInFlightRef.current = false;
              setClassifySaving(false);
              Alert.alert("Couldn't delete", e.message);
            }
          },
        },
      ]
    );
  };
  const handleRestoreSession = async (plan) => {
    if (restoreSessionInFlightRef.current) return;
    restoreSessionInFlightRef.current = true;
    setAsyncBusyText("Restoring...");
    try {
      await restorePlan(user.uid, plan.id);
      refreshRecovery();
    } catch (e) {
      Alert.alert("Couldn't restore", e.message);
    } finally {
      restoreSessionInFlightRef.current = false;
      setAsyncBusyText(null);
    }
  };
  // Completed / remaining counts, using the same unresolved definition
  // ("carried" or "pending", never "skipped") that Room Detail's own
  // visitStatusLabel and the Companion carry-forward already use.
  const sessionWorkSummary = (plan) => {
    const batches = [...(Array.isArray(plan.batchHistory) ? plan.batchHistory : []), ...(plan.currentBatch ? [plan.currentBatch] : [])];
    const items = batches.flatMap((b) => b?.items || []);
    return {
      completed: items.filter((i) => i.status === "checked").length,
      remaining: items.filter((i) => i.status === "carried" || i.status === "pending").length,
    };
  };

  // ---- Area Picker (§4, option 2) ----
  // Its first row is always "Whole Room", which is what lets one component
  // serve "this session covers all of the Room I just picked" and "it
  // belongs to one Area inside it", including right after creating a Room.
  const renderAreaPicker = () => (
    <Modal visible={classifyStep === "pick-area"} animationType="slide" transparent onRequestClose={closeClassify}>
      <View style={s.renameSheetBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeClassify} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[s.renameSheetCard, { maxHeight: "80%" }]}>
          <Text style={s.renameSheetTitle} numberOfLines={2}>{`Where in ${classifyRoom?.displayName || "this Room"}?`}</Text>
          {classifyError && (
            <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: "#B91C1C" }}>{classifyError}</Text>
            </View>
          )}
          {/* Was an inline spinner that REPLACED the list. Now the shared
              ProcessingOverlay covers the whole sheet instead, so this sheet
              behaves like every other multi-step save in the app and the
              destination name is visible while it runs. */}
          {(
            <ScrollView keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                disabled={classifySaving}
                style={[s.historyItem, { marginBottom: 8 }]}
                onPress={() => runClassify(classifyRoom.id, null)}
                accessibilityLabel="This session covers the whole Room"
                accessibilityRole="button"
              >
                <View style={s.historyIcon}><Home size={26} color={BRAND.green} strokeWidth={2.25} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.historySpace}>Whole Room</Text>
                  <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>This session covered the room overall</Text>
                </View>
              </TouchableOpacity>
              {classifyAreas.map((area) => (
                <TouchableOpacity
                  key={area.id}
                  disabled={classifySaving}
                  style={[s.historyItem, { marginBottom: 8 }]}
                  onPress={() => runClassify(classifyRoom.id, area.id)}
                  accessibilityLabel={`File under ${area.displayName}`}
                  accessibilityRole="button"
                >
                  {area.latestPhotoUrl || area.originalPhotoUrl ? (
                    <Image source={{ uri: area.latestPhotoUrl || area.originalPhotoUrl }} style={s.historyIcon} resizeMode="cover" />
                  ) : (
                    <View style={s.historyIcon}><Layers size={26} color={BRAND.green} strokeWidth={2.25} /></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.historySpace} numberOfLines={1}>{area.displayName}</Text>
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{`${area.visitCount ?? 0} visit${(area.visitCount ?? 0) === 1 ? "" : "s"}`}</Text>
                  </View>
                  <ChevronRight size={18} color="#94A3B8" strokeWidth={2.25} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                disabled={classifySaving}
                style={[s.historyItem, { marginBottom: 0 }]}
                onPress={() => { setClassifyName(""); setClassifyStep("name-area"); }}
                accessibilityLabel="Create a new Area"
                accessibilityRole="button"
              >
                <View style={[s.historyIcon, { backgroundColor: BRAND.offWhite }]}><Plus size={26} color={BRAND.green} strokeWidth={2.25} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.historySpace}>Create a new Area...</Text>
                  <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Uses this session's own photo</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          )}
          <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 12 }]} onPress={closeClassify} disabled={classifySaving}>
            <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        {classifySaving && <ProcessingOverlay text={classifyText} />}
      </View>
    </Modal>
  );

  // ---- Name entry, shared by "new Room" and "new Area" ----
  const renderClassifyNameSheet = () => {
    const isRoom = classifyStep === "name-room";
    // Same keyboard treatment as renderRenameSheet - this is the other
    // sheet in the app with a text input in a bottom-anchored card, so it
    // had the identical iOS problem.
    return (
      <Modal visible={classifyStep === "name-room" || classifyStep === "name-area"} animationType="slide" transparent onRequestClose={closeClassify}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={s.renameSheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => Keyboard.dismiss()} accessibilityLabel="Dismiss keyboard" accessibilityRole="button" />
          <View style={s.renameSheetCard}>
            <Text style={s.renameSheetTitle}>{isRoom ? "Name this Room" : "Name this Area"}</Text>
            <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 14 }}>
              {isRoom
                ? "A new Room will be created, then you can choose where in it this session belongs."
                : `A new Area will be created in ${classifyRoom?.displayName || "this Room"}, using this session's own photo.`}
            </Text>
            <TextInput
              style={s.renameSheetInput}
              value={classifyName}
              onChangeText={setClassifyName}
              maxLength={50}
              placeholder={isRoom ? "e.g. Kitchen" : "e.g. Corner Shelf"}
              placeholderTextColor="#94A3B8"
              autoFocus
              editable={!classifySaving}
              returnKeyType="done"
              onSubmitEditing={() => { if (classifyName.trim() && !classifySaving) { isRoom ? submitNewRoomName() : runClassify(classifyRoom.id, null, classifyName.trim()); } }}
            />
            {classifyError && (
              <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: "#B91C1C" }}>{classifyError}</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} onPress={closeClassify} disabled={classifySaving}>
                <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.startOverBtn, { flex: 1, marginTop: 0, backgroundColor: (classifyName.trim() && !classifySaving) ? BRAND.green : "#CBD5E1", borderWidth: 0 }]}
                onPress={() => (isRoom ? submitNewRoomName() : runClassify(classifyRoom.id, null, classifyName.trim()))}
                disabled={!classifyName.trim() || classifySaving}
              >
                <Text style={[s.startOverText, { color: "white" }]}>{classifySaving ? "Saving..." : (isRoom ? "Create Room" : "Create Area")}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Covers the text input too - without it the keyboard stays up and
              the field stays editable while the Room/Area is being created. */}
          {classifySaving && <ProcessingOverlay text={classifyText} />}
        </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  // ---- The four classification options (§3) ----
  const renderClassifyOptions = () => (
    <Modal visible={classifyStep === "options"} animationType="slide" transparent onRequestClose={closeClassify}>
      <View style={s.renameSheetBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeClassify} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={s.renameSheetCard}>
          <Text style={s.renameSheetTitle}>Where does this session belong?</Text>
          <TouchableOpacity disabled={classifySaving} style={s.areaActionRow} onPress={() => { setClassifyStep("pick-room-whole"); setRoomPickerFor({ kind: "session", mode: "whole" }); }} accessibilityRole="button" accessibilityLabel="This is a whole-Room session">
            <Home size={18} color="#334155" strokeWidth={2.25} />
            <Text style={s.areaActionText}>This is a whole-Room session</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={classifySaving} style={s.areaActionRow} onPress={() => { setClassifyStep("pick-room-area"); setRoomPickerFor({ kind: "session", mode: "area" }); }} accessibilityRole="button" accessibilityLabel="This belongs to an Area">
            <Layers size={18} color="#334155" strokeWidth={2.25} />
            <Text style={s.areaActionText}>This belongs to an Area</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={classifySaving} style={s.areaActionRow} onPress={() => { setClassifyName(""); setClassifyStep("name-room"); }} accessibilityRole="button" accessibilityLabel="Create a new Room for this">
            <Plus size={18} color="#334155" strokeWidth={2.25} />
            <Text style={s.areaActionText}>Create a new Room for this</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={classifySaving} style={[s.areaActionRow, { borderBottomWidth: 0 }]} onPress={() => handleDeleteSession(classifyFor)} accessibilityRole="button" accessibilityLabel="Delete this session">
            <Trash2 size={18} color="#DC2626" strokeWidth={2.25} />
            <Text style={[s.areaActionText, { color: "#DC2626" }]}>Delete this session</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={classifySaving} style={[s.mergeSecondaryBtn, { marginTop: 16 }]} onPress={closeClassify}>
            <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        {/* Delete runs from this sheet, so the overlay lives here too. Placed
            as the last child of the backdrop so it covers the card AND the
            tap-to-dismiss area above it. */}
        {classifySaving && <ProcessingOverlay text={classifyText} />}
      </View>
    </Modal>
  );

  // ---- Area overflow ("...") action sheet (AreaReparentingDesign.md §9).
  // Rename and Delete are the EXISTING flows, only relocated into this
  // sheet - openAreaRenameSheet and handleDeleteArea are called unchanged,
  // so swipe-left-to-delete keeps working alongside this menu rather than
  // being replaced by it (two entry points, one implementation). Delete is
  // invoked with no swipeableMethods argument, which handleDeleteArea
  // already tolerates (every use is optional-chained) - there is no open
  // swipe row to close when the action came from here. ----
  const renderAreaActionsSheet = () => (
    <Modal visible={!!areaActionsFor} animationType="slide" transparent onRequestClose={() => setAreaActionsFor(null)}>
      <View style={s.renameSheetBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setAreaActionsFor(null)} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={s.renameSheetCard}>
          <Text style={s.renameSheetTitle} numberOfLines={1}>{areaActionsFor?.displayName || "Area"}</Text>
          <TouchableOpacity
            style={s.areaActionRow}
            onPress={() => { const a = areaActionsFor; setAreaActionsFor(null); openAreaRenameSheet(a); }}
            accessibilityLabel="Rename Area"
            accessibilityRole="button"
          >
            <Pencil size={18} color="#334155" strokeWidth={2.25} />
            <Text style={s.areaActionText}>Rename Area</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.areaActionRow}
            onPress={() => openAreaMovePicker(areaActionsFor)}
            accessibilityLabel="Move to another Room"
            accessibilityRole="button"
          >
            <Layers size={18} color="#334155" strokeWidth={2.25} />
            <Text style={s.areaActionText}>Move to another Room</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.areaActionRow, { borderBottomWidth: 0 }]}
            onPress={() => { const a = areaActionsFor; setAreaActionsFor(null); handleDeleteArea(a); }}
            accessibilityLabel="Delete Area"
            accessibilityRole="button"
          >
            <Trash2 size={18} color="#DC2626" strokeWidth={2.25} />
            <Text style={[s.areaActionText, { color: "#DC2626" }]}>Delete Area</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 16 }]} onPress={() => setAreaActionsFor(null)}>
            <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // ---- The reusable Room Picker (AreaReparentingDesign.md §9/§10). Built
  // deliberately standalone rather than extracted from the Room-First-
  // Identity confirmation flow's own picker (§10: that one is tightly
  // coupled to roomConfirmation/recognitionPendingRef and unwinding it
  // buys nothing) - it takes its whole input from `rooms`, which loadRooms
  // already filters to non-retired, and its whole output from one
  // callback. That genericity is what lets Area-move and Room-level move
  // share it verbatim, branching only on roomPickerFor.kind.
  //
  // Exclusion rule: never offer the Room the thing already lives in. For
  // an Area that's its current parent Room; for a Room-level move it's the
  // Room itself (moving a Room into itself is Case A, a guaranteed no-op).
  const roomPickerExcludedId = roomPickerFor?.kind === "area" ? roomPickerFor.sourceRoomId : roomPickerFor?.room?.id;
  const roomPickerOptions = rooms.filter((r) => r.id !== roomPickerExcludedId && r.retired !== true);
  const renderRoomPicker = () => (
    <Modal visible={!!roomPickerFor} animationType="slide" transparent onRequestClose={closeRoomPicker}>
      <View style={s.renameSheetBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeRoomPicker} accessibilityLabel="Close" accessibilityRole="button" />
        <View style={[s.renameSheetCard, { maxHeight: "80%" }]}>
          <Text style={s.renameSheetTitle}>
            {roomPickerFor?.kind === "session"
              ? "Which Room?"
              : roomPickerFor?.kind === "area"
              ? `Move "${roomPickerFor?.area?.displayName || "this Area"}" to...`
              : `Move "${roomPickerFor?.room?.displayName || "this Room"}" into...`}
          </Text>
          {/* A whole-Room classification commits from THIS sheet (see
              onRoomPickerSelectForMove), so its failure has to surface here -
              otherwise the picker would simply sit there after a failed write
              with no explanation. */}
          {roomPickerFor?.kind === "session" && classifyError && (
            <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, color: "#B91C1C" }}>{classifyError}</Text>
            </View>
          )}
          {roomPickerOptions.length === 0 && roomPickerFor?.kind !== "session" ? (
            <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 16 }}>
              You don't have another Room to move this into yet. Organize a different room first, then try again.
            </Text>
          ) : (
            <ScrollView style={{ marginBottom: 4 }} keyboardShouldPersistTaps="handled">
              {roomPickerOptions.map((r) => {
                const RoomIcon = getRoomTypeIcon(r.displayName);
                return (
                  <TouchableOpacity
                    key={r.id}
                    disabled={classifySaving}
                    style={[s.historyItem, { marginBottom: 8 }]}
                    onPress={() => onRoomPickerSelectForMove(r)}
                    accessibilityLabel={`Move to ${r.displayName}`}
                    accessibilityRole="button"
                  >
                    <View style={s.historyIcon}>
                      <RoomIcon size={26} color={BRAND.green} strokeWidth={2.25} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.historySpace} numberOfLines={1}>{r.displayName}</Text>
                      <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                        {`${r.visitCount ?? 0} visit${(r.visitCount ?? 0) === 1 ? "" : "s"}`}
                      </Text>
                    </View>
                    <ChevronRight size={18} color="#94A3B8" strokeWidth={2.25} />
                  </TouchableOpacity>
                );
              })}
              {/* Session Recovery supplies the "create a Room with no plan"
                  path the two move flows still lack (createRoomSpace), so
                  the row is live for kind: "session" and stays shown-but-
                  disabled for Area/Room moves - Phase B territory there.
                  Disabled rather than hidden so the capability is
                  discoverable and its absence explained, not just missing. */}
              {roomPickerFor?.kind === "session" ? (
                <TouchableOpacity
                  disabled={classifySaving}
                  style={[s.historyItem, { marginBottom: 0 }]}
                  onPress={() => { setRoomPickerFor(null); setClassifyName(""); setClassifyStep("name-room"); }}
                  accessibilityLabel="Create a new Room"
                  accessibilityRole="button"
                >
                  <View style={[s.historyIcon, { backgroundColor: BRAND.offWhite }]}>
                    <Plus size={26} color={BRAND.green} strokeWidth={2.25} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.historySpace} numberOfLines={1}>Create a new Room...</Text>
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                      {roomPickerOptions.length === 0 ? "You don't have any Rooms yet" : "Name it and file this session into it"}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[s.historyItem, { marginBottom: 0, opacity: 0.5, backgroundColor: "#F8F9FA" }]}>
                  <View style={[s.historyIcon, { backgroundColor: "#E2E8F0" }]}>
                    <Plus size={26} color="#94A3B8" strokeWidth={2.25} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.historySpace, { color: "#94A3B8" }]} numberOfLines={1}>Create a new Room...</Text>
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Coming soon</Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}
          <TouchableOpacity disabled={classifySaving} style={[s.mergeSecondaryBtn, { marginTop: 12 }]} onPress={closeRoomPicker}>
            <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
        {/* Only ever true for kind: "session" - the Area/Room move paths hand
            off to renderMoveConfirm, which carries its own moveSaving overlay. */}
        {classifySaving && <ProcessingOverlay text={classifyText} />}
      </View>
    </Modal>
  );

  // ---- Move confirmation + processing overlay (§9). The overlay is a
  // real requirement here, not decoration: an Area move runs N sequential
  // reclassifyLegacyPlan calls, each itself a 7-phase state machine, so
  // multi-second latency is expected and must be visibly covered. While
  // moveSaving is true every dismissal path is disabled (backdrop tap,
  // Cancel, onRequestClose all early-return via closeMoveConfirm) - a
  // half-finished move must never be left running behind a dismissed
  // dialog, even though the operation itself would survive it. ----
  const renderMoveConfirm = () => {
    const isArea = moveConfirmTarget?.kind === "area";
    const subjectName = isArea ? moveConfirmTarget?.area?.displayName : moveConfirmTarget?.room?.displayName;
    const targetName = moveConfirmTarget?.targetRoom?.displayName;
    return (
      <Modal visible={!!moveConfirmTarget} animationType="fade" transparent onRequestClose={closeMoveConfirm}>
        <View style={s.renameSheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeMoveConfirm} accessibilityLabel="Close" accessibilityRole="button" />
          <View style={s.renameSheetCard}>
            <Text style={s.renameSheetTitle}>{`Move ${subjectName || "this"} to ${targetName || "that Room"}?`}</Text>
            <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 16 }}>
              {isArea
                ? "All visits, photos, and history will move with it."
                : "All of this Room's visits, photos, and history will move into that Room, and this Room will be merged away."}
            </Text>
            {moveError && (
              <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: "#B91C1C" }}>{moveError}</Text>
              </View>
            )}
            {moveSaving ? (
              <View style={{ alignItems: "center", paddingVertical: 18 }}>
                <ActivityIndicator size="large" color={BRAND.green} />
                <Text style={{ fontSize: 14, color: "#64748B", marginTop: 12 }}>Moving...</Text>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} onPress={closeMoveConfirm}>
                  <Text style={s.mergeSecondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.startOverBtn, { flex: 1, marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]}
                  onPress={confirmMove}
                  accessibilityLabel="Confirm move"
                  accessibilityRole="button"
                >
                  <Text style={[s.startOverText, { color: "white" }]}>Move</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    );
  };
  // Phase C1 (DeletionDesign.md Soft-Delete Revision): real soft delete,
  // replacing the prior "Coming soon" placeholder. One atomic writeBatch
  // (softDeleteRoom) - nearly instant, so no processing overlay is used
  // here, matching the design's own "no meaningful async work to cover"
  // conclusion. On success, the Room is immediately gone from My Rooms
  // (existing !retired filter, no new filtering code) - navigate back
  // there rather than leave the user on a Room Detail screen for a Room
  // that no longer resolves.
  // Reached two ways now: the "Delete Room" button at the bottom of Room
  // Detail (no swipe row to close, so swipeableMethods is undefined), and a
  // left-swipe on a Room row in My Rooms. The optional-chaining on
  // swipeableMethods is what lets one handler serve both without the button
  // path needing a fake object.
  const handleDeleteRoom = (room, swipeableMethods) => {
    const copy = DELETE_CONFIRM.room(room.displayName);
    Alert.alert(
      copy.title,
      copy.body,
      [
        // Cancel returns the row to rest. Nothing is written.
        { text: "Cancel", style: "cancel", onPress: () => swipeableMethods?.close() },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            // Close the swipe row FIRST and let its own animation finish
            // before the Room leaves `rooms` - otherwise the list yanks a
            // still-open row out from under itself. Same 300ms the Area
            // path uses, so the two feel identical.
            swipeableMethods?.close();
            try {
              if (swipeableMethods) await new Promise((resolve) => setTimeout(resolve, 300));
              await softDeleteRoom(user.uid, room.id);
              setRooms((prev) => prev.filter((r) => r.id !== room.id));
              // No-ops when the swipe came from My Rooms (already there);
              // load-bearing when the button was tapped inside Room Detail,
              // which must not stay open on a Room that no longer exists.
              setRoomDetailRoomId(null);
              setShowHistory(true);
            } catch (e) {
              Alert.alert("Couldn't delete", e.message);
            }
          },
        },
      ]
    );
  };

  // Per-visit delete, for the Earlier Organizing Visits rows. Deliberately
  // NOT handleDeleteSession: that one is owned by the classify sheet and
  // drives classifyInFlightRef / setClassifyText / closeClassify, none of
  // which exist on Room Detail. Calling it from here would set sheet state
  // for a sheet that is not open, and - the real bug - would never remove the
  // row, because it patches recovery state rather than roomDetailPlans.
  //
  // The plan is FILTERED OUT rather than patched to retired:true, because
  // the Room Detail loader excludes retired plans entirely. Filtering is what
  // a reload would produce; patching would leave a row visiblePlans still
  // shows, since that filter keys on retired AREAS, not on the plan's own flag.
  const handleDeleteVisit = (plan, swipeableMethods) => {
    const copy = DELETE_CONFIRM.session();
    Alert.alert(
      copy.title,
      copy.body,
      [
        { text: "Cancel", style: "cancel", onPress: () => swipeableMethods?.close() },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            swipeableMethods?.close();
            try {
              await new Promise((resolve) => setTimeout(resolve, 300));
              await softDeletePlan(user.uid, plan.id);
              setRoomDetailPlans((prev) => prev.filter((p) => p.id !== plan.id));
              refreshRecovery();
            } catch (e) {
              Alert.alert("Couldn't delete", e.message);
            }
          },
        },
      ]
    );
  };
  // Per-Area "Delete" action (Room Detail's own AREAS IN THIS ROOM rows).
  // Reached only via swipe-left-then-tap-trash now (the visible "Delete"
  // text link is retired) - swipeableMethods (from Swipeable's own
  // renderRightActions render prop) is passed through so this same
  // confirm/cancel flow can close that specific row's swipe panel at the
  // right moment, regardless of which row's trash icon was tapped.
  // Single-document soft delete (softDeleteArea) followed by an explicit
  // Room summary recompute (the Room's own visitCount/latestPhotoUrl must
  // no longer count this Area's visits - see updateSpaceRoomSummary's own
  // comment for why this needs a live query, not a local decrement).
  // Stays on Room Detail afterward - only the deleted Area's own state is
  // patched locally, so the rest of the screen doesn't need a full re-fetch.
  const handleDeleteArea = (area, swipeableMethods) => {
    Alert.alert(
      DELETE_CONFIRM.area(area.displayName).title,
      DELETE_CONFIRM.area(area.displayName).body,
      [
        // Cancel: close the swipe row back to its resting state, Area
        // stays exactly as it was - no delete call at all.
        { text: "Cancel", style: "cancel", onPress: () => swipeableMethods?.close() },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            // Close the swipe row FIRST, then give its own close animation
            // a moment to actually finish before the Area disappears from
            // roomDetailAreas (which is what makes the row vanish from the
            // list). Removing it immediately would yank an still-open/
            // still-animating row out from under itself - the exact visual
            // jump this flow is meant to avoid.
            swipeableMethods?.close();
            try {
              await new Promise((resolve) => setTimeout(resolve, 300));
              await softDeleteArea(user.uid, roomDetailRoomId, area.id);
              await updateSpaceRoomSummary(user.uid, roomDetailRoomId);
              // deletedAt must be included here, not just retired - the
              // Recently Deleted Areas filter (toMillisDeletedAt/
              // recentlyDeletedAreas below) requires BOTH fields, and only
              // recognizes a Firestore Timestamp (.toMillis()) or a string
              // (Date.parse) - a bare `new Date()` object matches neither
              // branch and would fall through to 0, which fails the filter
              // exactly the same way omitting the field entirely did.
              // toISOString() matches the string branch those helpers
              // already handle. Firestore itself received the authoritative
              // serverTimestamp() in softDeleteArea above; this is only the
              // client-side optimistic patch standing in until the next
              // full reload reads the real value back.
              setRoomDetailAreas((prev) => prev.map((a) => (a.id === area.id ? { ...a, retired: true, deletedAt: new Date().toISOString() } : a)));
            } catch (e) {
              Alert.alert("Couldn't delete", e.message);
            }
          },
        },
      ]
    );
  };
  // Restore Room (Phase C2, Recently Deleted's own action, My Rooms
  // screen). Mirrors handleDeleteRoom's structure, but unlike delete this
  // can't just patch the old pre-delete object back into `rooms` -
  // restoreRoom's own server-side recompute (updateSpaceRoomSummary) can
  // change visitCount/lastOrganizedAt/etc. from whatever they were at
  // delete time, so this refetches the Space doc instead.
  const handleRestoreRoom = async (room) => {
    if (restoreRoomInFlightRef.current) return;
    restoreRoomInFlightRef.current = true;
    setAsyncBusyText("Restoring...");
    try {
      await restoreRoom(user.uid, room.id);
      const spaceSnap = await getDoc(doc(db, "users", user.uid, "spaces", room.id));
      const restored = { id: room.id, ...spaceSnap.data() };
      setRecentlyDeletedRooms((prev) => prev.filter((r) => r.id !== room.id));
      setRooms((prev) => [restored, ...prev.filter((r) => r.id !== room.id)]);
    } catch (e) {
      Alert.alert("Couldn't restore", e.message);
    } finally {
      restoreRoomInFlightRef.current = false;
      setAsyncBusyText(null);
    }
  };
  // Restore Area (Phase C2, Recently Deleted Areas' own action, Room
  // Detail screen). Local patch only, same convention handleDeleteArea
  // already established - AREAS IN THIS ROOM re-derives its rows from
  // roomDetailPlans + roomDetailAreas.retired, not from any cached
  // visitCount here, so a full re-fetch isn't needed for the Area to
  // reappear.
  const handleRestoreArea = async (area) => {
    if (restoreAreaInFlightRef.current) return;
    restoreAreaInFlightRef.current = true;
    setAsyncBusyText("Restoring...");
    try {
      await restoreArea(user.uid, roomDetailRoomId, area.id);
      setRoomDetailAreas((prev) => prev.map((a) => (a.id === area.id ? { ...a, retired: false, deletedAt: undefined, deletedWithRoomId: undefined } : a)));
    } catch (e) {
      Alert.alert("Couldn't restore", e.message);
    } finally {
      restoreAreaInFlightRef.current = false;
      setAsyncBusyText(null);
    }
  };
  // Remembered Home v1 Step 2 (RememberedHomeDesign.md §1a): the one flow
  // behind every "Organize Again" entry point (originally the History
  // row's Alert action and Space Detail's own button; now Room Detail's
  // own button, Section 2) - not a separate flow per entry point, same
  // pattern as this file's one renderRenameSheet()/openRenameSheet() bottom
  // sheet serving multiple call sites. Resolves the target Space id the same
  // way computeShadowIds does (this item's own canonicalSpaceId if it's
  // itself a returning-visit plan, else its own id), stores it plus the
  // item itself (§1c/1e's prior context) in organizeAgainContext, clears
  // every other screen flag via goHome() first (same discipline every nav
  // helper in this file follows), then reuses the exact same photo-picker
  // Alert the Home screen's own camera button opens - no second picker.
  // areaId (Area Identity, Phase A §4): optional. Room Detail's own
  // per-Room "Organize Again" omits it (unchanged, whole-Room/legacy
  // behavior). Room Detail's per-Area "Organize Again" passes the
  // existing Area's own id - identity established through navigation,
  // not inference, exactly the same governing rule Room identity itself
  // already follows for this same button.
  const startOrganizeAgain = (item, areaId = null) => {
    const targetSpaceId = item.canonicalSpaceId || item.id;
    goHome();
    setOrganizeAgainContext({ spaceId: targetSpaceId, areaId, priorItem: item });
    showPhotoOptions();
  };
  const clearCompanionRevealState = () => {
    if (companionRevealTimer.current) clearTimeout(companionRevealTimer.current);
    setCompanionRevealBefore(null);
    setCompanionRevealAfter(null);
    setCompanionVisibleChange(null);
    setCompanionRevealReady(false);
  };
  const reset = () => { dlog(`[PHOTO DEBUG] reset(): companionBasePhotoRef ${companionBasePhotoRef.current} -> null | companionOriginalPhotoRef ${companionOriginalPhotoRef.current} -> null`); activePlanIdRef.current = null; setPhoto(null); setResults(null); setShowCompanion(false); setErr(null); setTierTouched(false); setVizImage({}); setVizLoading({}); setPhotoSize({ width: 1, height: 1 }); setVizModal(null); setVizModal(null); setCurrentPlanId(null); setOrganizeAgainContext(null); setRoomConfirmation(null); recognitionPendingRef.current = null; setRoomFreeformInput(""); setPendingRoomConfirmationResult(null); setJustConfirmedRecognition(null); setCompanionStage("batch-active"); setBatchItems([]); setCompanionBatchIndex(1); setUnresolvedReview(null); setProgressPhoto(null); companionBasePhotoRef.current = null; companionOriginalPhotoRef.current = null; companionOriginalCompressedRef.current = null; setCompanionCompletionRecommended(false); setCompanionCompletionReason(null); setCompanionCompletedProject(null); analysisIdRef.current = null; lastFailedAnalysisRef.current = null; clearCompanionRevealState(); };
  const goHome = () => { dlog(`[PHOTO DEBUG] goHome(): companionBasePhotoRef ${companionBasePhotoRef.current} -> null | companionOriginalPhotoRef ${companionOriginalPhotoRef.current} -> null`); activePlanIdRef.current = null; setShowMenu(false); setShowHistory(false); setShowFaq(false); setShowAccount(false); setShowMergeReview(false); setShowSpaceInspector(false); setRoomDetailRoomId(null); setResultsCameFromRoomDetail(null); setCompanionEnteredFromResults(false); setResults(null); setShowCompanion(false); setPhoto(null); setErr(null); setVizImage({}); setVizLoading({}); setCurrentPlanId(null); setOrganizeAgainContext(null); setRoomConfirmation(null); recognitionPendingRef.current = null; setRoomFreeformInput(""); setPendingRoomConfirmationResult(null); setJustConfirmedRecognition(null); setCompanionStage("batch-active"); setBatchItems([]); setCompanionBatchIndex(1); setUnresolvedReview(null); setProgressPhoto(null); companionBasePhotoRef.current = null; companionOriginalPhotoRef.current = null; companionOriginalCompressedRef.current = null; setCompanionCompletionRecommended(false); setCompanionCompletionReason(null); setCompanionCompletedProject(null); analysisIdRef.current = null; lastFailedAnalysisRef.current = null; clearCompanionRevealState(); setTimeout(() => homeScrollRef.current?.scrollTo({ y: 0, animated: false }), 100); };

  // Android hardware/gesture back button: step back through in-app screens instead of
  // exiting. Each branch matches that screen's own existing back/close behavior exactly
  // (e.g. History/FAQ/Account's own back arrows return to Menu, not Home) rather than
  // inventing a different navigation model. No-op on iOS by construction (addEventListener
  // is a hardcoded no-op there, see react-native's BackHandler.ios.js), but guarded
  // explicitly anyway so that's obvious from the code itself, not just implicit platform behavior.
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const onBackPress = () => {
      if (showPaywall) { setShowPaywall(false); setPaywallSource("general_paywall"); return true; }
      if (showMenu) { setShowMenu(false); return true; }
      // Needs Review sits ON TOP of My Rooms (showHistory stays true
      // underneath), so it must be checked before it - otherwise back
      // would close My Rooms out from under an open recovery flow. Its
      // own modals unwind one step at a time, same as every other
      // multi-step sheet in this handler.
      if (showNeedsReview) {
        if (classifySaving) return true;
        if (classifyStep === "name-room" || classifyStep === "name-area" || classifyStep === "pick-area") { setClassifyStep("options"); return true; }
        if (roomPickerFor?.kind === "session") { closeRoomPicker(); return true; }
        if (classifyStep) { closeClassify(); return true; }
        setShowNeedsReview(false);
        return true;
      }
      if (showHistory) { setShowHistory(false); setShowMenu(true); return true; }
      if (showFaq) { setShowFaq(false); setShowMenu(true); return true; }
      if (showAccount) { setShowAccount(false); setShowMenu(true); return true; }
      if (showSpaceInspector) { setShowSpaceInspector(false); setShowMenu(true); return true; }
      if (showMergeReview) { setShowMergeReview(false); setShowMenu(true); return true; }
      // Reached only from My Rooms (History) - back returns there, not
      // to Menu, matching the drill-down it actually came from.
      if (roomDetailRoomId) { setRoomDetailRoomId(null); setShowHistory(true); return true; }
      // Room-First Identity, Phase B: backing out of the Room confirmation
      // screen steps back through it, never a no-op. Within a sub-view
      // (picker/freeform), back returns to that outcome's main chooser.
      // At the main view of a declinable outcome (a/b1/b2/b3), back
      // declines to outcome (c), same as the explicit decline buttons. At
      // outcome (c) itself (nothing left to fall through to) or from any
      // other state, back cancels the whole confirmation - clears
      // roomConfirmation/recognitionPendingRef with zero residual state
      // (test k) and returns to the photo-preview Home screen, keeping the
      // photo so the user can retry rather than losing it entirely.
      // Area Identity Phase B: checked BEFORE roomConfirmation below, since
      // areaConfirmation can be truthy while roomConfirmation itself is
      // STILL truthy too (Room confirmation is paused, not cleared, while
      // Area confirmation shows - see completeRoomConfirmation) - back
      // must cancel the Area screen that's actually visible, not fall
      // through to Room confirmation's own handling underneath it.
      if (areaConfirmation) {
        if (areaConfirmation.view !== "main") { setAreaConfirmation(prev => prev ? { ...prev, view: "main" } : prev); return true; }
        areaConfirmationPendingRef.current = null;
        setAreaConfirmation(null);
        setAreaConfirmationError(null);
        return true;
      }
      if (roomConfirmation) {
        if (roomConfirmation.view !== "main") { backToRoomConfirmationMain(); return true; }
        // "failed" has no completed check to decline BACK to (unlike a/b1/
        // b2/b3, which decline to (c) - "checked, found nothing"). Declining
        // "failed" to (c) would show (c)'s "We think this is your X" copy,
        // the exact misrepresentation this outcome exists to avoid. Falls
        // straight through to full cancel instead, same as (c) itself.
        if (roomConfirmation.routing.outcome !== "c" && roomConfirmation.routing.outcome !== "failed") { declineToOutcomeC(); return true; }
        recognitionPendingRef.current = null;
        setRoomFreeformInput("");
        setRoomConfirmation(null);
        return true;
      }
      // Checked before the Companion branch below, same reasoning as
      // History/FAQ/Account above it - the wrap-up screen (DecisionLog.md
      // 2026-07-19) is a step within Companion, not its own destination, so
      // back from it returns to the checklist rather than skipping past
      // Companion entirely.
      if (results && showCompanion && unresolvedReview) { setUnresolvedReview(null); return true; }
      // Checked before the plain `results` branch below - otherwise back
      // from Companion would skip Results entirely and exit straight to
      // Home, instead of stepping back one screen like every other back
      // arrow here does.
      if (results && showCompanion) { setShowCompanion(false); return true; }
      // Phase B: back from Results returns to Room Detail specifically
      // when that's where the user came from (resultsCameFromRoomDetail),
      // matching the general "step back to where you came from" rule
      // every other branch here already follows - otherwise falls through
      // to the existing goHome() default, completely unchanged.
      if (results) {
        if (resultsCameFromRoomDetail) { returnToRoomDetail(resultsCameFromRoomDetail); return true; }
        goHome();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [showPaywall, showMenu, showHistory, showFaq, showAccount, showSpaceInspector, showMergeReview, roomDetailRoomId, roomConfirmation, results, showCompanion, unresolvedReview, resultsCameFromRoomDetail, showNeedsReview, classifyStep, classifySaving, roomPickerFor]);

  const handleSignOut = () => {
    setShowMenu(false);
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut(auth) },
      ...(__DEV__ ? [{
        text: "🔧 Reset Test Data", onPress: async () => {
          await AsyncStorage.removeItem("analysisCount");
          await AsyncStorage.removeItem("isPro");
          await AsyncStorage.removeItem("skipOnboarding");
          setAnalyses(0);
          setIsPro(false);
          setHistory([]);
          setSkipPref(false);
          Alert.alert("Test data reset!", "Analysis count, Pro status and onboarding cleared. Firestore history preserved.");
        }
      }] : []),
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This permanently deletes your account and all your saved data, including your room history and visualizations. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            setDeletePassword("");
            setDeleteError("");
            setDeleteLoading(false);
            setShowDeleteModal(true);
          },
        },
      ]
    );
  };

  // Phase C5 (DeletionImplementation.md): all actual deletion work now
  // happens server-side, via the hardDeleteAccount callable - Admin-SDK
  // orchestration that reuses the proven Phase C3 hard-delete engine and
  // handles every resource this client-side version never touched
  // (shadow Projects/Sessions/Batches, mergeCandidates,
  // reclassificationExecutions, orphaned data with no matching Room at
  // all). The client's only remaining jobs: confirm the user really wants
  // this and really is who they say they are (password reauthentication,
  // unchanged - still the right client-side gate even though the server
  // now does the work, since it proves the person holding this signed-in
  // session actually knows the account's password), call the server
  // function, and only THEN sign out / clear local state - never before
  // the server confirms completion.
  const handleConfirmDelete = async () => {
    if (!deletePassword) {
      setDeleteError("Please enter your password.");
      return;
    }
    // Synchronous re-entry guard (ProcessingFeedbackAudit.md finding 2). The
    // overlay here was already good, but an overlay that has not painted yet
    // protects nothing - and this is the one irreversible operation in the
    // app. A double-tap re-authenticated and called deleteAccount twice, the
    // second against a session the first had already torn down.
    if (deleteAccountInFlightRef.current) return;
    deleteAccountInFlightRef.current = true;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      // Re-authenticate
      const credential = EmailAuthProvider.credential(currentUser.email, deletePassword);
      await reauthenticateWithCredential(currentUser, credential);

      // The entire deletion (Firestore, Storage, Auth) happens here,
      // server-side. uid is never sent - hardDeleteAccount reads it from
      // the verified ID token (request.auth.uid), so this call can only
      // ever delete the signed-in caller's own account. The server's own
      // content-gate (hardDeleteAccountAdmin) guarantees this either
      // fully succeeds or leaves nothing half-done - a caught error here
      // means it's genuinely safe to retry, never a reason to fall back
      // to any client-side cleanup of its own.
      const hardDeleteAccountFn = httpsCallable(functions, "hardDeleteAccount");
      await hardDeleteAccountFn();

      // Only now, after the server has confirmed the account is actually
      // gone: sign out (the client's own local session doesn't know the
      // server just deleted this Auth account server-side - it has to be
      // told) and clear local state, same fields the pre-Phase-C5 version
      // cleared (onAuthStateChanged's own sign-out branch already clears
      // analysisCount/isPro, but not skipOnboarding or the login form's
      // own fields - the just-deleted account's email shouldn't stay
      // prefilled on the sign-in screen).
      await signOut(auth);
      setEmail("");
      setPassword("");
      await AsyncStorage.removeItem("analysisCount");
      await AsyncStorage.removeItem("isPro");
      await AsyncStorage.removeItem("skipOnboarding");

      setShowDeleteModal(false);
      setDeleteLoading(false);

    } catch (err) {
      setDeleteLoading(false);
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setDeleteError("Incorrect password. Please try again.");
      } else {
        // Covers both a reauthentication failure of some other kind and a
        // hardDeleteAccount HttpsError - either way, the modal stays open
        // with Retry available (re-pressing "Delete My Account" simply
        // calls this same idempotent flow again).
        setDeleteError("Something went wrong. Please try again.");
      }
    } finally {
      // Released on every path, including the bare `if (!currentUser) return;`
      // above - without a finally that early return would leave the guard
      // stuck true and permanently disable the button. The retry path noted
      // in the catch above depends on this being released.
      deleteAccountInFlightRef.current = false;
    }
  };

  // Whole-plan delete from My Plans (DecisionLog.md 2026-07-18). Deletes the
  // Firestore doc first, then every Storage object under both prefixes tied
  // to this plan - plans/{uid}/{planId}/ (original + progress photos) and
  // viz/{uid}/{planId}/ (every AI visualization, including stale
  // regenerations no longer referenced by the current vizImages map, so this
  // has to list the folder rather than walk the doc's own URLs). Firestore
  // first, same ordering reasoning as account deletion: if Storage cleanup
  // fails partway, a leftover orphaned image is harmless, but a doc left
  // pointing at now-missing images would show broken thumbnails in the list.
  const deletePlan = async (planId) => {
    const uid = user.uid;
    // TEMP DEBUG (remove once the on-device delete failure is diagnosed):
    // step is tagged into the dlog line so we know which call actually threw
    // - console.log alone is invisible on a preview/OTA build with no
    // attached Metro session, so this uses the same debugLogBuffer/
    // debugShareLog mechanism (long-press the header logo) as the rest of
    // the app's on-device debugging.
    let step = "readCanonicalSpaceId";
    try {
      // §12 Migration Part 4: captured BEFORE deletion, specifically so
      // deleteSpaceShadowGraph below can still resolve the correct (possibly
      // merged-away) Space after the plan document is gone - there is no
      // other place left to read plan.canonicalSpaceId from once the plan
      // doc no longer exists (MergeExecutionDesign.md §2). A cheap read;
      // failure here is treated as "assume never merged" (null), not a
      // reason to abort the delete - a stale-but-findable orphaned shadow at
      // the wrong path is a strictly better failure mode than blocking the
      // user's own delete action on a diagnostic read.
      let canonicalSpaceId = null;
      // Area Identity, Phase A: same reasoning as canonicalSpaceId just
      // above - captured before deletion since there's nowhere left to
      // read plan.areaId from once the plan doc is gone.
      let deletedPlanAreaId = null;
      try {
        const planSnapForDelete = await getDoc(doc(db, "users", uid, "plans", planId));
        canonicalSpaceId = planSnapForDelete.exists() ? (planSnapForDelete.data().canonicalSpaceId || null) : null;
        deletedPlanAreaId = planSnapForDelete.exists() ? (planSnapForDelete.data().areaId || null) : null;
      } catch (e) {
        dlog(`[PLAN DELETE] canonicalSpaceId/areaId pre-read failed for ${planId}, proceeding as unmerged/no-area: ${e.message}`);
      }

      step = "deleteDoc";
      await deleteDoc(doc(db, "users", uid, "plans", planId));

      // Shadow cleanup only ever runs AFTER the authoritative plan deletion
      // above has already succeeded - never before. deleteSpaceShadowGraph
      // never throws (it catches internally), so awaiting it here cannot
      // fail this function or roll back the plan deletion that already
      // happened; a failure here just leaves an orphaned shadow for the
      // future reconciliation sweep to find and remove, which is a safer
      // failure state than ever risking the reverse order.
      step = "deleteSpaceShadowGraph";
      const shadowResult = await deleteSpaceShadowGraph(uid, planId, canonicalSpaceId);

      // My Rooms -> True Room Grouping, rollout closeout item 2: the
      // deleted plan's own Project is gone, so this Room's summary
      // (visitCount, latest photo/date/area) is now stale if the Space
      // survived (other Projects remain) - recompute it from what's
      // actually left, same idempotent mechanism every other mutation
      // already uses. If the Space itself was removed (this was the last
      // Project), there is nothing left to summarize - updateSpaceRoomSummary
      // would just fail trying to read a Space that no longer exists, so
      // it's skipped entirely rather than called and swallowed.
      step = "updateSpaceRoomSummary";
      const spaceId = canonicalSpaceId || planId;
      if (shadowResult.outcome === "deleted" && !shadowResult.spaceDeleted) {
        await updateSpaceRoomSummary(uid, spaceId);
        const refreshedSpaceSnap = await getDoc(doc(db, "users", uid, "spaces", spaceId));
        if (refreshedSpaceSnap.exists()) {
          setRooms(prev => prev.map(r => r.id === spaceId ? { id: spaceId, ...refreshedSpaceSnap.data() } : r));
        }
      } else if (shadowResult.spaceDeleted) {
        setRooms(prev => prev.filter(r => r.id !== spaceId));
      }

      // Area Identity, Phase A §5, item (j)/(i): recompute the owning
      // Area's own summary the same way, whenever this plan had one.
      // Deliberately unconditional on shadowResult.spaceDeleted (unlike
      // the Room summary above) - even when deleting this plan also
      // deleted the whole Room (this was the Room's last visit too), the
      // Area document itself lives at spaces/{roomId}/areas/{areaId},
      // which Firestore does not require its parent Space document to
      // still exist for - the read/write still succeeds, correctly
      // recomputes to visitCount: 0, and the Area survives (item i),
      // simply now orphaned under a Room that no longer exists. Real
      // cleanup of that orphan is real Room-deletion's job (Phase C,
      // AreaIdentityDesign.md §11/§13), not this function's.
      step = "updateAreaSummary";
      if (deletedPlanAreaId) {
        await updateAreaSummary(uid, spaceId, deletedPlanAreaId);
      }

      step = "listAll";
      const prefixes = [
        storageRef(storage, `plans/${uid}/${planId}`),
        storageRef(storage, `viz/${uid}/${planId}`),
      ];
      const items = (await Promise.all(prefixes.map(p => listAll(p)))).flatMap(r => r.items);

      step = "deleteObject";
      await Promise.all(items.map(async item => {
        try {
          await deleteObject(item);
        } catch (itemErr) {
          if (itemErr.code !== "storage/object-not-found") throw itemErr;
        }
      }));

      logEvent(getAnalytics(), "plan_deleted", { planId });
      setHistory(prev => prev.filter(h => h.id !== planId));
      if (currentPlanId === planId) goHome();
    } catch (e) {
      dlog(`[PLAN DELETE] step=${step} planId=${planId} code=${e.code} message=${e.message}`);
      Alert.alert("Something went wrong", "Couldn't delete this plan. Please try again.");
    }
  };

  // Ahead of every other gate on purpose. Whatever screen the photo was
  // started from, the crop is what renders next - which is the whole reason
  // it is a gate and not something mounted inside one screen's return.
  if (cropSource) {
    dlog(`[CROP] gate rendering for ${cropSource.uri?.slice(-28)}`);
    return (
      <PhotoCropScreen
        key={cropSource.uri}
        source={cropSource}
        onCancel={() => { cropDoneRef.current = null; setCropSource(null); }}
        onUseOriginal={() => finishCrop(cropSource)}
        onConfirm={(cropped) => finishCrop(cropped)}
      />
    );
  }

  // PAYWALL SCREEN
  if (showPaywall) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <ScrollView style={s.screenScroll} contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}>
          <View style={s.paywallHeader}>
            <View style={{ alignItems: "center", marginBottom: 12 }}><DrawerIcon size={80} dark={false} /></View>
            <Text style={s.paywallTitle}>Go Unlimited</Text>
            <Text style={s.paywallSubtitle}>AI visualizations, branded PDFs, and full room history.</Text>
          </View>

          {/* Free vs Pro comparison */}
          <Text style={[s.sectionLabel, { marginTop: 4, alignSelf: "flex-start" }]}>COMPARE FEATURES</Text>
          <View style={{ width: "100%", marginBottom: 24 }}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <View style={[s.compareCol, { borderColor: BRAND.stone }]}>
                <Text style={s.compareColHeader}>Free</Text>
                {[
                  "3 rooms/month",
                  "Text sharing",
                  "Great for getting started",
                ].map((t, i) => (
                  <View key={i} style={s.compareRow}>
                    <View style={{ width: 16 }}><Check size={14} color={BRAND.mist} strokeWidth={2.5} /></View>
                    <Text style={s.compareText}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={[s.compareCol, { borderColor: BRAND.green, backgroundColor: "#F8FBF9", borderWidth: 2 }]}>
                <Text style={[s.compareColHeader, { color: BRAND.green }]}>Pro</Text>
                {[
                  "Unlimited rooms",
                  "AI visualizations",
                  "Full room history",
                  "Branded PDF exports",
                  "Priority results",
                ].map((t, i) => (
                  <View key={i} style={s.compareRow}>
                    <View style={{ width: 16 }}><Check size={14} color={BRAND.green} strokeWidth={2.5} /></View>
                    <Text style={[s.compareText, { color: BRAND.ink, fontFamily: "Inter_500Medium" }]}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Plan selector */}
          {/*
            THESE PRICES ARE HARDCODED USD DISPLAY STRINGS, not live ones.
            getOfferings() is called in the CTA handler below, at purchase
            time - nothing fetches RevenueCat packages for this render - so
            there is no localized price string available here to show. What
            the customer is actually charged comes from App Store Connect and
            Google Play Console; these strings only have to agree with them.
            CHANGE THEM TOGETHER OR THE PAYWALL LIES.

            Save 30% is arithmetic, not marketing: 2.99 x 12 = 35.88, minus
            24.99 leaves 10.89, which is 30.35% of 35.88. The per-month
            equivalent below it is 24.99 / 12 = 2.0825, shown as 2.08.
          */}
          <Text style={[s.sectionLabel, { alignSelf: "flex-start" }]}>CHOOSE BILLING</Text>
          <View style={{ flexDirection: "row", gap: 10, width: "100%", marginBottom: 20 }}>
            <TouchableOpacity
              style={[s.planOption, paywallPlan === "monthly" && s.planOptionSelMonthly]}
              onPress={() => setPaywallPlan("monthly")}>
              <View style={{ height: 22, marginBottom: 6 }} />
              <Text style={s.planOptionLabel}>Monthly</Text>
              <Text style={s.planOptionPrice}>$2.99/mo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.planOption, paywallPlan === "yearly" && s.planOptionSelYearly]}
              onPress={() => setPaywallPlan("yearly")}>
              <View style={s.planSaveBadge}><Text style={s.planSaveText}>Save 30%</Text></View>
              <Text style={s.planOptionLabel}>Yearly</Text>
              <Text style={s.planOptionPrice}>$24.99/yr</Text>
              <Text style={[s.planOptionSub, { color: BRAND.green }]}>$2.08/mo</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.paywallCta, purchaseInProgress && { opacity: 0.7 }]}
            disabled={purchaseInProgress}
            onPress={async () => {
            if (purchaseInProgress) return; // belt-and-suspenders alongside the disabled prop
            setPurchaseInProgress(true);
            logEvent(getAnalytics(), "pro_upgrade_clicked");
            try {
              // Second-layer check: onAuthStateChanged links RevenueCat's
              // identity before unlocking this screen, but a failed (not
              // just slow) logIn() there still lets the UI through. Retry
              // here - logIn() is idempotent - and refuse to purchase under
              // an unlinked identity rather than risk a repeat of the real
              // sandbox purchase that landed on no RevenueCat customer record
              // under the signed-in uid at all.
              if (!revenueCatLinkedRef.current) {
                try {
                  await Purchases.logIn(user.uid);
                  revenueCatLinkedRef.current = true;
                } catch (e) {
                  Alert.alert("Unable to prepare your account for purchase", "Please check your connection and try again.");
                  return;
                }
              }
              const offerings = await Purchases.getOfferings();
              const current = offerings.current;
              const product = paywallPlan === "yearly"
                ? current?.annual?.product
                : current?.monthly?.product;

              if (!product) {
                Alert.alert("Unavailable", "Unable to load subscription options. Please check your connection and try again.");
                return;
              }

              logEvent(getAnalytics(), "subscription_started", { analysisId: analysisIdRef.current, source: paywallSource });
              const { customerInfo } = await Purchases.purchaseStoreProduct(product);
              if (customerInfo.entitlements.active["Uncluttrd Pro"]) {
                logEvent(getAnalytics(), "subscription_completed");
                setIsPro(true);
                await AsyncStorage.setItem("isPro", "true");
                setShowPaywall(false);
                Alert.alert("Welcome to Pro!", "You now have unlimited access.");
              } else {
                Alert.alert("Something went wrong", "Your purchase was processed but Pro could not be activated. Please restore purchases or contact support at hello@uncluttrd.app.");
              }
            } catch (e) {
              if (e.userCancelled) return;
              Alert.alert("Purchase failed", "Something went wrong. Please try again or contact support at hello@uncluttrd.app.");
            } finally {
              setPurchaseInProgress(false);
            }
          }}>
            {purchaseInProgress ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator color="white" size="small" />
                <Text style={s.paywallCtaText}>Processing...</Text>
              </View>
            ) : (
              <Text style={s.paywallCtaText}>{paywallPlan === "yearly" ? "Go Unlimited - $24.99/year" : "Go Unlimited - $2.99/month"}</Text>
            )}
          </TouchableOpacity>
          <Text style={s.paywallCtaSub}>Cancel anytime • Managed by {Platform.OS === "android" ? "Google Play" : "Apple"}</Text>
          <Text style={[s.paywallCtaSub, { marginTop: -8 }]}>
            <Text onPress={() => Linking.openURL("https://uncluttrd.app/terms.html")} style={{ textDecorationLine: "underline" }}>Terms of Use</Text>
            {"  •  "}
            <Text onPress={() => Linking.openURL("https://uncluttrd.app/privacy.html")} style={{ textDecorationLine: "underline" }}>Privacy Policy</Text>
          </Text>

          <TouchableOpacity style={s.paywallSkip} onPress={() => { setShowPaywall(false); setPaywallSource("general_paywall"); }}>
            <Text style={s.paywallSkipText}>Maybe later</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 12, padding: 8 }} onPress={async () => {
            try {
              // restorePurchases() resolves with the CustomerInfo object
              // directly (RevenueCat docs), unlike purchaseStoreProduct()/
              // purchasePackage() which resolve with { customerInfo, ... }.
              // Destructuring { customerInfo } here always produced
              // undefined, so this threw "Cannot read property
              // 'entitlements' of undefined" on every single tap,
              // regardless of whether the restore itself succeeded.
              const customerInfo = await Purchases.restorePurchases();
              if (customerInfo.entitlements.active["Uncluttrd Pro"]) {
                setIsPro(true);
                await AsyncStorage.setItem("isPro", "true");
                setShowPaywall(false);
                Alert.alert("Restored!", "Your Pro subscription has been restored.");
              } else {
                Alert.alert("No purchases found", "We could not find any previous purchases for this Apple ID.");
              }
            } catch (e) {
              Alert.alert("Restore failed", e.message);
            }
          }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center" }}>Restore Purchases</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Menu navigation bug class (fourth+ occurrence - see openSpaceResults'
  // own comment above for the first three: goHome, openSpaceResults,
  // openCompanionSession). Every top-level screen below is its own
  // early-return `if (flag) return (...)`, checked in the SAME fixed
  // source order on every render (showHistory, roomDetailRoomId, showFaq,
  // showMergeReview, showSpaceInspector, showAccount, showPaywall, ...).
  // A menu item that sets only its OWN target flag can be silently masked
  // by whichever of the others was left true from earlier in the session -
  // confirmed not every "open menu" header button across every screen
  // resets its own flag before opening the menu, so this can't be an
  // invariant the menu items rely on. Every destination below clears the
  // full set unconditionally first, the same "clear everything you might
  // be leaving, don't assume it's already clear" discipline as the three
  // prior fixes - applied once here since, unlike those three, every menu
  // item needs the exact same clear list and differs only in which flag
  // ends up true.
  const closeMenuAndGoTo = (setTarget) => {
    setShowMenu(false);
    setShowHistory(false);
    setRoomDetailRoomId(null);
    setShowFaq(false);
    setShowMergeReview(false);
    setShowSpaceInspector(false);
    setShowAccount(false);
    setShowPaywall(false);
    setTarget(true);
  };

  if (showMenu) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <FreeRoomsBadge isPro={isPro} analyses={analyses} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(false)} style={{ padding: 8 }}>
            <X size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          <Text style={[s.sectionLabel, { marginTop: 8 }]}>MENU</Text>

          {[
            { icon: Home, label: "Home", action: goHome },
            { icon: Folder, label: "My Rooms", action: () => closeMenuAndGoTo(setShowHistory) },
            // §12 Migration Part 3, Pass 2 - always reachable regardless of
            // banner state (MergeProposalDesign.md Section 3 / this pass's
            // "Menu access" requirement), not gated on pendingMergeCandidates.length.
            { icon: Layers, label: "Review Duplicate Rooms", action: () => closeMenuAndGoTo(setShowMergeReview) },
            { icon: User, label: "Account", action: () => closeMenuAndGoTo(setShowAccount) },
            { icon: Star, label: "Upgrade to Pro", action: () => closeMenuAndGoTo(setShowPaywall), hide: isPro },
            { icon: HelpCircle, label: "Help & FAQ", action: () => closeMenuAndGoTo(setShowFaq) },
            { icon: Mail, label: "Contact Us", action: () => Linking.openURL("mailto:hello@uncluttrd.app") },
            { icon: Wrench, label: "🔍 Space Inspector (dev)", action: () => closeMenuAndGoTo(setShowSpaceInspector), hide: !__DEV__ },
          ].filter(item => !item.hide).map((item, i) => (
            <TouchableOpacity key={i} style={s.menuItem} onPress={() => {
              if (item.pro && !isPro) { closeMenuAndGoTo(setShowPaywall); return; }
              item.action();
            }}>
              <item.icon size={20} color={BRAND.navy} strokeWidth={2.25} />
              <Text style={s.menuLabel}>{item.label}</Text>
              {item.pro && !isPro && <View style={s.proBadge}><Text style={s.proBadgeText}>Pro</Text></View>}
              <Text style={{ color: BRAND.mist, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          ))}

          <View style={{ marginTop: 32 }}>
            <TouchableOpacity style={s.menuItem} onPress={handleSignOut}>
              <LogOut size={20} color="#991B1B" strokeWidth={2.25} />
              <Text style={[s.menuLabel, { color: "#991B1B" }]}>Sign Out</Text>
              <Text style={{ color: BRAND.mist, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // NEEDS REVIEW SCREEN (SessionRecoveryDesign.md §2-§3). A temporary
  // migration surface: it is reachable only from the My Rooms entry row,
  // which itself only exists while there is something to review, so once
  // every legacy session is placed and the 30-day deletion window closes
  // this whole screen becomes unreachable without any further change.
  //
  // Placed before the History screen's own early return because it is
  // opened FROM My Rooms and showHistory stays true underneath - closing
  // it therefore returns the user to exactly the scroll position they
  // left, rather than to Home.
  if (showNeedsReview) {
    const formatSessionDate = (plan) => {
      const iso = plan.createdAt || plan.lastOrganizedAt;
      if (!iso) return "Date unknown";
      const ms = typeof iso === "string" ? Date.parse(iso) : (iso?.toMillis ? iso.toMillis() : 0);
      if (!ms) return "Date unknown";
      return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    };
    const formatSessionDeletedAgo = (deletedAt) => {
      const ms = deletedAt && typeof deletedAt.toMillis === "function" ? deletedAt.toMillis() : (typeof deletedAt === "string" ? Date.parse(deletedAt) : 0);
      const days = Math.max(0, Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000)));
      if (days === 0) return "Deleted today";
      if (days === 1) return "Deleted yesterday";
      return `Deleted ${days} days ago`;
    };
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={() => setShowNeedsReview(false)} style={s.hdrMark} accessibilityLabel="Back to My Rooms" accessibilityRole="button">
            <ChevronLeft size={26} color="rgba(255,255,255,0.9)" strokeWidth={2.25} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>Needs Review</Text>
            <Text style={s.hdrTag}>
              {unresolvedSessions.length} session{unresolvedSessions.length === 1 ? "" : "s"} to place
            </Text>
          </View>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          {/* Explains the situation once, at the top, rather than on every
              card. These sessions predate Rooms and Areas - the user did
              nothing wrong, and the copy says so plainly. */}
          <View style={{ backgroundColor: "#FFFBEB", borderRadius: 12, borderWidth: 1, borderColor: "#FDE68A", padding: 14, marginBottom: 16 }}>
            <Text style={{ fontSize: 14, color: "#92400E", lineHeight: 20 }}>
              These sessions were saved before Uncluttrd organized things into Rooms and Areas, so we don't know where they belong. Tell us where each one goes, or delete the ones you don't need.
            </Text>
          </View>

          {unresolvedSessions.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 30 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>✅</Text>
              <Text style={[s.resTitle, { textAlign: "center", marginBottom: 8 }]}>All caught up</Text>
              <Text style={[s.heroP, { textAlign: "center" }]}>Every session has a home now.</Text>
            </View>
          ) : (
            unresolvedSessions.map((plan) => {
              const work = sessionWorkSummary(plan);
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[s.historyItem, { alignItems: "flex-start" }]}
                  onPress={() => openClassify(plan)}
                  accessibilityLabel={`Place session from ${formatSessionDate(plan)}`}
                  accessibilityRole="button"
                >
                  {/* The thumbnail is its own Touchable INSIDE the card's
                      Touchable. A nested Touchable wins the press, so tapping
                      the photo opens the viewer without also firing the card's
                      openClassify - which is what makes "look at the photo"
                      and "classify this session" two separate gestures on one
                      card. Reuses renderPhotoZoomModal (ImageZoom: pinch,
                      double-tap, pan), the same viewer Results and Room Detail
                      already use, so there is no second zoom implementation.
                      Closing only clears vizModal, so the Needs Review list,
                      its scroll position and any open sheet are untouched. */}
                  {plan.photoUrl ? (
                    <TouchableOpacity
                      onPress={() => { setVizModal(plan.photoUrl); setVizModalKey((k) => k + 1); }}
                      accessibilityLabel={`View full-screen photo from ${formatSessionDate(plan)}`}
                      accessibilityRole="imagebutton"
                    >
                      <Image source={{ uri: plan.photoUrl }} style={s.historyIcon} resizeMode="cover" />
                    </TouchableOpacity>
                  ) : (
                    <View style={s.historyIcon}><HelpCircle size={26} color="#94A3B8" strokeWidth={2.25} /></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.historySpace} numberOfLines={1}>{formatSessionDate(plan)}</Text>
                    {/* Marked as the AI's ORIGINAL label, deliberately (§2).
                        These strings are exactly why these sessions are
                        unresolved: spaceType/areaName were free text the AI
                        wrote per photo, never a link to anything, so the
                        same physical corner carries a different label in
                        every session. Presenting them unqualified would
                        read as "this session already belongs somewhere",
                        which is the belief the whole screen exists to
                        correct. areaId is null here by definition. */}
                    {(plan.areaName || plan.spaceName || plan.spaceType) ? (
                      <>
                        <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, letterSpacing: 0.4 }}>AI'S ORIGINAL LABEL</Text>
                        <Text style={{ fontSize: 13, color: "#475569", marginTop: 1 }} numberOfLines={2}>
                          {[plan.spaceName || plan.spaceType, plan.areaName].filter(Boolean).join(" · ")}
                        </Text>
                      </>
                    ) : (
                      <Text style={{ fontSize: 13, color: "#94A3B8", marginTop: 6 }}>No label recorded</Text>
                    )}
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 6 }}>
                      {work.completed + work.remaining === 0
                        ? "No tasks recorded"
                        : `${work.completed} task${work.completed === 1 ? "" : "s"} completed · ${work.remaining} remaining`}
                    </Text>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green, marginTop: 8 }}>Choose where this belongs →</Text>
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {/* Recently Deleted sessions - same quiet styling and same
              30-day window as My Rooms' own Recently Deleted section, and
              deliberately here rather than there: a deleted session is a
              recovery-flow artifact, and mixing it into the Rooms list
              would put migration debris on a permanent screen. */}
          {deletedSessions.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>RECENTLY DELETED</Text>
              {deletedSessions.map((plan) => (
                <View key={plan.id} style={[s.historyItem, { backgroundColor: "#F8F9FA", alignItems: "center" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#64748B" }} numberOfLines={1}>
                      {plan.areaName || plan.spaceName || "Untitled session"}
                    </Text>
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{formatSessionDeletedAgo(plan.deletedAt)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRestoreSession(plan)}
                    accessibilityLabel="Restore this session"
                    accessibilityRole="button"
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Restore</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </ScrollView>
        {renderClassifyOptions()}
        {renderRoomPicker()}
        {renderAreaPicker()}
        {renderClassifyNameSheet()}
        {/* Needs Review is now a third caller of the shared viewer, alongside
            Results and Room Detail. Rendered last so it layers above the
            classify sheets if one happens to be open. */}
        {renderPhotoZoomModal()}
        {/* Shared processing overlay for PDF export and the restore actions.
            Same component every other flow uses. */}
        {asyncBusyText && <ProcessingOverlay text={asyncBusyText} />}
      </SafeAreaView>
    );
  }

  // HISTORY SCREEN
  if (showHistory) {
    // Local, matches the existing Room Confirmation screen's own daysAgo
    // helper in spirit (App.js's roomConfirmation render block) but
    // produces the exact "Organized {X}" phrase this screen's cards need -
    // not reused directly since that one returns a bare day count, not a
    // formatted phrase.
    const formatLastOrganized = (iso) => {
      if (!iso) return "Not yet synced";
      const days = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / (24 * 60 * 60 * 1000)));
      if (days === 0) return "Organized today";
      if (days === 1) return "Organized yesterday";
      return `Organized ${days} days ago`;
    };
    // Phase C2: deletedAt is a Firestore serverTimestamp() once round-tripped
    // through Firestore (has toMillis()), not an ISO string like
    // lastOrganizedAt above - can't reuse formatLastOrganized's Date.parse.
    const formatDeletedAgo = (deletedAt) => {
      const ms = deletedAt && typeof deletedAt.toMillis === "function" ? deletedAt.toMillis() : (typeof deletedAt === "string" ? Date.parse(deletedAt) : 0);
      const days = Math.max(0, Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000)));
      if (days === 0) return "Deleted today";
      if (days === 1) return "Deleted yesterday";
      return `Deleted ${days} days ago`;
    };
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>My Rooms</Text>
            <Text style={s.hdrTag}>{rooms.length} saved {rooms.length === 1 ? "room" : "rooms"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowHistory(false); setShowFaq(false); setShowAccount(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          {rooms.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
              <Text style={[s.resTitle, { textAlign: "center", marginBottom: 8 }]}>No rooms yet</Text>
              <Text style={[s.heroP, { textAlign: "center" }]}>Your analyzed rooms will appear here after you get your first organization plan.</Text>
            </View>
          ) : (
            // My Rooms -> True Room Grouping, Phase A: one card per Space
            // (Room), not per plan - sourced entirely from `rooms` (see
            // loadRooms above), never from `history`. A Room with 3 visits
            // renders exactly once here, regardless of the old 20-plan cap.
            rooms.map((room) => {
              // Room Detail UX Revision, Section 2: a Room-type icon, not
              // the most recent visit's photo - that photo is usually a
              // specific area (entertainment center, vanity, counter), not
              // a picture of the whole room, which reads as misleading on
              // a card labeled "Living Room". s.historyIcon is already the
              // exact rounded-square/BRAND-tinted shape this calls for -
              // only its child changes.
              const RoomIcon = getRoomTypeIcon(room.displayName);
              return (
                // Swipe-to-delete on the Rooms list. The row keeps tap-to-open; the gesture
                // only reveals the trash action, and handleDeleteRoom owns the
                // confirmation. marginBottom moves to the swipe container so the red panel
                // sits flush with the card.
                <SwipeToDeleteRow
                  key={room.id}
                  accessibilityLabel={`Delete ${room.displayName}`}
                  onDelete={(swipeableMethods) => handleDeleteRoom(room, swipeableMethods)}
                >
                <TouchableOpacity style={[s.historyItem, { marginBottom: 0 }]} onPress={() => openRoomDetail(room)}>
                  <View style={s.historyIcon}>
                    <RoomIcon size={30} color={BRAND.green} strokeWidth={2.25} />
                  </View>
                  <View style={{ flex: 1 }}>
                  <Text style={s.historySpace} numberOfLines={1}>{room.displayName}</Text>
                  {/* Only when the latest visit was genuinely a sub-area
                      (Room-First Identity's own areaScope contract) - a
                      whole-room latest visit shows no area line at all,
                      never an empty one. */}
                  {room.latestAreaName && room.latestAreaScope === "sub-area" && (
                    <Text style={s.historyOverview} numberOfLines={1}>{`Last worked on: ${room.latestAreaName}`}</Text>
                  )}
                  <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                    {`${formatLastOrganized(room.lastOrganizedAt)} · ${room.visitCount ?? 1} visit${(room.visitCount ?? 1) === 1 ? "" : "s"}`}
                  </Text>
                  </View>
                </TouchableOpacity>
                </SwipeToDeleteRow>
              );
            })
          )}
          {/* Session Recovery entry point (SessionRecoveryDesign.md §2).
              One row, not 14 photo cards - these are legacy sessions the
              hierarchy couldn't place, and putting them inline would make
              a migration artifact the loudest thing on the user's own
              Rooms screen. It stays visible while EITHER unresolved or
              recently-deleted sessions exist (§1c): disappearing the
              instant the last one is classified would strand every
              soft-deleted session with no way back to Restore. */}
          {(unresolvedSessions.length > 0 || deletedSessions.length > 0) && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>NEEDS REVIEW</Text>
              <TouchableOpacity
                style={[s.historyItem, { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", alignItems: "flex-start" }]}
                onPress={() => setShowNeedsReview(true)}
                accessibilityLabel="Review sessions that need a home"
                accessibilityRole="button"
              >
                <View style={[s.historyIcon, { backgroundColor: "#FEF3C7" }]}>
                  <HelpCircle size={26} color="#B45309" strokeWidth={2.25} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.historySpace, { color: "#92400E" }]} numberOfLines={1}>
                    {unresolvedSessions.length > 0
                      ? `${unresolvedSessions.length} session${unresolvedSessions.length === 1 ? "" : "s"} need${unresolvedSessions.length === 1 ? "s" : ""} a home`
                      : `${deletedSessions.length} recently deleted session${deletedSessions.length === 1 ? "" : "s"}`}
                  </Text>
                  <Text style={{ fontSize: 12, color: "#B45309", marginTop: 2, lineHeight: 17 }}>
                    {unresolvedSessions.length > 0
                      ? "Some earlier organizing sessions need to be assigned to a Room or Area."
                      : "Restore a session you deleted, within 30 days."}
                  </Text>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#B45309", marginTop: 8 }}>Review sessions →</Text>
                </View>
              </TouchableOpacity>
            </>
          )}
          {/* Phase C2: Recently Deleted - deliberately small (no fancy
              archive browser, per the task spec). Quiet/secondary styling
              throughout: gray text, no Room-type icon, no BRAND-tinted
              historyIcon - visually distinct from the active-Room cards
              above so it doesn't read as "just another room". Omitted
              entirely when nothing qualifies (recentlyDeletedRooms is
              already 30-day-filtered in loadRooms). */}
          {recentlyDeletedRooms.length > 0 && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 20 }]}>RECENTLY DELETED</Text>
              {recentlyDeletedRooms.map((room) => (
                <View key={room.id} style={[s.historyItem, { backgroundColor: "#F8F9FA", alignItems: "center" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#64748B" }} numberOfLines={1}>{room.displayName}</Text>
                    <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{formatDeletedAgo(room.deletedAt)}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRestoreRoom(room)}
                    accessibilityLabel={`Restore ${room.displayName}`}
                    accessibilityRole="button"
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Restore</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
        </ScrollView>
        {renderRenameSheet()}
        {/* Shared processing overlay for PDF export and the restore actions.
            Same component every other flow uses. */}
        {asyncBusyText && <ProcessingOverlay text={asyncBusyText} />}
      </SafeAreaView>
    );
  }

  // ROOM DETAIL SCREEN (My Rooms -> True Room Grouping, Phase B). Replaces
  // the old single-plan Space Detail as the primary destination from My
  // Rooms (openRoomDetail) - shows the Room's full organizing history
  // (every visit under this Space, Section 1's verified query), not just
  // one plan. The Room is the durable place; plans are dated chapters
  // inside it. Reuses the exact same rename bottom sheet and full-screen
  // photo viewer as every other screen (renderRenameSheet/
  // renderPhotoZoomModal) - no new modal patterns introduced. Structurally
  // modeled on the retired Space Detail screen's own shape (header +
  // ScrollView of SectionCard-shaped blocks).
  if (roomDetailRoomId) {
    const room = rooms.find((r) => r.id === roomDetailRoomId);
    if (!room) {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <View style={[s.hdr, { alignItems: "flex-start" }]}>
            <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
              <DrawerIcon size={54} dark={true} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
              <Text style={s.hdrPageName}>Room Not Found</Text>
            </View>
            <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
              <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
            </TouchableOpacity>
          </View>
          {/* Navigation Consistency fix: was a Menu-icon-reused-as-back
              (same ambiguity the Results fix already addressed elsewhere) -
              now the same explicit "<- [destination]" bar pattern, below
              the header. The hamburger above reverts to unconditionally
              opening the menu. */}
          <TouchableOpacity
            onPress={() => { setRoomDetailRoomId(null); setShowHistory(true); }}
            style={{ backgroundColor: BRAND.greenLight, borderBottomWidth: 1, borderBottomColor: BRAND.greenMid, paddingVertical: 10, paddingHorizontal: 16 }}
            accessibilityLabel="Back to My Rooms"
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }} numberOfLines={1}>← My Rooms</Text>
          </TouchableOpacity>
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            <Text style={{ fontSize: 14, color: "#64748B" }}>This room could no longer be found.</Text>
          </ScrollView>
        </SafeAreaView>
      );
    }

    // Phase C1 (DeletionDesign.md Soft-Delete Revision): a visit whose
    // areaId points at a now-retired Area must not appear anywhere in
    // Room Detail's own visit list - soft-delete only ever touches the
    // Area document itself (plan/shadow data is untouched during the
    // retention window), so without this filter a soft-deleted Area's
    // visits would keep showing here even though the Area they belonged
    // to has already disappeared from AREAS IN THIS ROOM above.
    // roomDetailAreas is already loaded with every Area including retired
    // ones (see its own loading effect) - reused here, not a new query.
    const retiredAreaIdsInRoom = new Set(roomDetailAreas.filter((a) => a.retired).map((a) => a.id));
    const visiblePlans = roomDetailPlans.filter((p) => !p.areaId || !retiredAreaIdsInRoom.has(p.areaId));

    // Phase C2: Recently Deleted Areas - sourced entirely from the
    // already-loaded roomDetailAreas (zero new query), same reuse
    // discipline as retiredAreaIdsInRoom above. deletedAt is the
    // load-bearing filter, not retired alone - a bare merge tombstone
    // (retired:true, no deletedAt) must never appear here.
    const toMillisDeletedAt = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : (typeof ts === "string" ? Date.parse(ts) : 0));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const recentlyDeletedAreas = roomDetailAreas
      .filter((a) => a.retired === true && a.deletedAt && (Date.now() - toMillisDeletedAt(a.deletedAt)) <= THIRTY_DAYS_MS)
      .sort((a, b) => toMillisDeletedAt(b.deletedAt) - toMillisDeletedAt(a.deletedAt));
    const formatDeletedAgo = (deletedAt) => {
      const days = Math.max(0, Math.round((Date.now() - toMillisDeletedAt(deletedAt)) / (24 * 60 * 60 * 1000)));
      if (days === 0) return "Deleted today";
      if (days === 1) return "Deleted yesterday";
      return `Deleted ${days} days ago`;
    };

    // Room Detail Layout Revision: LAST SESSION shows exactly the most
    // recent visit; EARLIER ORGANIZING VISITS shows every visit except
    // it, so the same visit is never rendered in both places at once.
    const mostRecent = visiblePlans[0] || null;
    const earlierVisits = visiblePlans.slice(1);
    // The CTA is now scoped to THIS specific visit (Last Session) only,
    // not a room-wide search for any plan with unfinished work anywhere
    // (that was the prior design) - a deliberate narrowing per this
    // revision's own spec: "the visit has unfinished... items", singular,
    // referring to the Last Session visit itself.
    const lastSessionHasUnfinishedWork = mostRecent ? planHasUnfinishedWork(mostRecent) : false;

    // The SAME three-way split the old Space Detail's own statusLabel used
    // (companionComplete -> Completed / currentBatch -> In progress / else
    // Not started) - companionComplete is the one authoritative "done"
    // signal, never inferred from batch contents. The only addition is a
    // finer branch between the top two, using the exact unresolved
    // definition already authoritative everywhere else in this file
    // ("carried"/"pending" = unresolved, "skipped" is an explicit past
    // decision, never conflated with "still open") - per Section 3's own
    // worked examples ("3 items remaining", not just "In progress"). This
    // is deliberately NOT a Room-Detail-specific interpretation of
    // completion - a fully-resolved-but-not-explicitly-completed batch
    // (e.g. every item skipped, none carried/pending, companionComplete
    // still false) still reads "In progress", same as it always has.
    const visitStatusLabel = (plan) => {
      if (plan.companionComplete) return "Completed";
      const items = plan?.currentBatch?.items || [];
      const unresolvedCount = items.filter((i) => i.status === "carried" || i.status === "pending").length;
      if (unresolvedCount > 0) return `${unresolvedCount} item${unresolvedCount === 1 ? "" : "s"} remaining`;
      if (plan.currentBatch) return "In progress";
      return "Not started";
    };

    // Same day-bucket math as My Rooms' own formatLastOrganized (today/
    // yesterday/else), scoped to a single visit's date - falls back to the
    // plan's own already-formatted `date` string (e.g. "Aug 7, 2026") for
    // anything older than yesterday, rather than an open-ended "N days ago"
    // count, since the per-visit row already has more going on (area,
    // status) than a single Room-level summary line.
    const formatVisitDate = (plan) => {
      const ms = typeof plan.createdAt === "string" ? Date.parse(plan.createdAt) : (plan.createdAt?.toMillis ? plan.createdAt.toMillis() : NaN);
      if (Number.isNaN(ms)) return plan.date || "";
      const days = Math.max(0, Math.round((Date.now() - ms) / (24 * 60 * 60 * 1000)));
      if (days === 0) return "Today";
      if (days === 1) return "Yesterday";
      return plan.date || "";
    };

    // Room Detail Layout Revision: the single area-label resolution used
    // by both LAST SESSION and every EARLIER ORGANIZING VISITS row, so
    // the two sections can never disagree about the same kind of visit.
    // Prefers the durable Area's own CURRENT displayName (via areaId) -
    // never stale once an Area is renamed - over the plan's own
    // historical areaName string, which is the fallback only for a
    // legacy sub-area visit with no durable areaId yet. Whole-room (or
    // any visit with neither) resolves to null - no placeholder text is
    // ever rendered for it, the same rule this screen has followed since
    // the "no Whole Room label" fix.
    const resolveVisitAreaLabel = (plan) => {
      if (!plan) return null;
      if (plan.areaId) {
        const area = roomDetailAreas.find((a) => a.id === plan.areaId);
        if (area) return area.displayName;
      }
      if (plan.areaScope === "sub-area" && plan.areaName) return plan.areaName;
      return null;
    };

    // Shared row renderer for every EARLIER ORGANIZING VISITS entry -
    // photo, area label (resolveVisitAreaLabel above), date and status
    // each on their own line (no " · " join - that combined line was
    // truncating with an ellipsis on longer status text; three
    // independent short lines instead of one long one). No share icon -
    // the row means exactly one thing now, "tap to open this visit" in
    // Results, which already has its own sharing. Single tap target
    // (the whole row), not split between a content area and a separate
    // icon anymore.
    const renderVisitRow = (plan) => (
      // Same gesture and component as Room and Area rows. Deleting a visit routes through
      // handleDeleteVisit, which confirms first and removes the plan from roomDetailPlans
      // so the row disappears.
      <SwipeToDeleteRow
        key={plan.id}
        accessibilityLabel="Delete this organizing session"
        onDelete={(swipeableMethods) => handleDeleteVisit(plan, swipeableMethods)}
      >
      <TouchableOpacity style={[s.historyItem, { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 0 }]} onPress={() => openRoomDetailVisit(plan)}>
        {plan.photoUrl ? (
          <Image source={{ uri: plan.photoUrl }} style={s.historyIcon} resizeMode="cover" />
        ) : (
          <View style={s.historyIcon}>
            <Text style={{ fontSize: 20 }}>🏠</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          {resolveVisitAreaLabel(plan) && (
            <Text style={s.historySpace} numberOfLines={1}>{resolveVisitAreaLabel(plan)}</Text>
          )}
          <Text style={s.historyOverview} numberOfLines={1}>{formatVisitDate(plan)}</Text>
          <Text style={s.historyOverview} numberOfLines={1}>{visitStatusLabel(plan)}</Text>
        </View>
      </TouchableOpacity>
      </SwipeToDeleteRow>
    );

    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            {/* Room Detail Layout Revision: Room name only - no sub-area
                subtitle line underneath anymore. Font size reverted to
                the shared hdrPageName default (14px) - a 20px per-screen
                override was tried and reverted, too close in size to the
                Uncluttrd logo above it. */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={s.hdrPageName} numberOfLines={1}>{room.displayName}</Text>
              {/* roomId passed explicitly (3rd arg) - this Room's target plan
                  may not be in the capped `history` cache at all, so
                  handleSaveRename can't rely on resolving it from there. */}
              <TouchableOpacity onPress={() => openRenameSheet(mostRecent?.id || room.id, room.displayName, room.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Rename this room" accessibilityRole="button">
                <Pencil size={14} color="rgba(255,255,255,0.85)" strokeWidth={2.25} />
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        {/* Navigation Consistency fix: was a Menu-icon-reused-as-back (same
            ambiguity the Results fix already addressed elsewhere) - now the
            same explicit "<- [destination]" bar pattern, below the header.
            The hamburger above reverts to unconditionally opening the menu. */}
        <TouchableOpacity
          onPress={() => { setRoomDetailRoomId(null); setShowHistory(true); }}
          style={{ backgroundColor: BRAND.greenLight, borderBottomWidth: 1, borderBottomColor: BRAND.greenMid, paddingVertical: 10, paddingHorizontal: 16 }}
          accessibilityLabel="Back to My Rooms"
          accessibilityRole="button"
        >
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }} numberOfLines={1}>← My Rooms</Text>
        </TouchableOpacity>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          {roomDetailLoading && roomDetailPlans.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <ActivityIndicator size="small" color={BRAND.green} />
            </View>
          ) : (
            <>
              {/* Room Detail Layout Revision, item 3: LAST SESSION - the
                  Room-level hero photo (old Photos section) is gone
                  entirely, replaced by this, since it always showed
                  whichever Area was last touched, not the Room itself, and
                  was misleading on that basis. Only rendered when at least
                  one visit exists (item 3's own "brand new Room" case). */}
              {mostRecent && (
                <View style={{ marginBottom: 20 }}>
                  <Text style={[s.sectionLabel, { marginBottom: 10 }]}>LAST SESSION</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: lastSessionHasUnfinishedWork ? 12 : 0 }}>
                    {/* Photo tap -> full-screen zoom (reuses the existing
                        vizModal viewer); area name/date/status tap ->
                        Results (openRoomDetailVisit) - two independent tap
                        targets side by side, not one shared row tap,
                        matching the spec's two separate statements about
                        what tapping the photo vs. the area name each do. */}
                    <TouchableOpacity
                      onPress={() => { if (mostRecent.photoUrl) { setVizModal(mostRecent.photoUrl); setVizModalKey((k) => k + 1); } }}
                      disabled={!mostRecent.photoUrl}
                      accessibilityLabel="View photo full screen"
                      accessibilityRole="button"
                    >
                      {mostRecent.photoUrl ? (
                        <Image source={{ uri: mostRecent.photoUrl }} style={{ width: 96, height: 96, borderRadius: 14 }} resizeMode="cover" />
                      ) : (
                        <View style={{ width: 96, height: 96, borderRadius: 14, backgroundColor: BRAND.greenLight, alignItems: "center", justifyContent: "center" }}>
                          <Text style={{ fontSize: 26 }}>🏠</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openRoomDetailVisit(mostRecent)} style={{ flex: 1 }} accessibilityRole="button">
                      {resolveVisitAreaLabel(mostRecent) && (
                        <Text style={[s.historySpace, { fontSize: 16 }]} numberOfLines={1}>{resolveVisitAreaLabel(mostRecent)}</Text>
                      )}
                      <Text style={s.historyOverview} numberOfLines={1}>{formatVisitDate(mostRecent)}</Text>
                      <Text style={s.historyOverview} numberOfLines={1}>{visitStatusLabel(mostRecent)}</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Only when THIS visit (Last Session) itself has
                      unfinished carried/pending items - no longer a
                      room-wide search for any plan with unfinished work
                      (that was the prior design). A completed Last Session
                      shows no CTA at all - "Completed" above already says
                      so, per this revision's own explicit instruction. */}
                  {lastSessionHasUnfinishedWork && (
                    <TouchableOpacity
                      onPress={() => openRoomDetailUnfinishedCTA(mostRecent)}
                      style={{ backgroundColor: "#F0FBF6", borderRadius: 12, borderWidth: 1, borderColor: "#CDEFDD", padding: 14 }}
                      accessibilityLabel="Continue where you left off"
                      accessibilityRole="button"
                    >
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Continue where you left off →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={() => startOrganizeAgain(mostRecent || { id: room.id })}>
                <Text style={[s.startOverText, { color: "white" }]}>Organize Another Area</Text>
              </TouchableOpacity>

              {/* Five Fixes pass, item 1 (2026-08-09): AREAS IN THIS ROOM
                  moved above EARLIER ORGANIZING VISITS - Areas are
                  navigational (start new work in a known Area), visit
                  history is archival; navigation belongs above archive.
                  Phase B prerequisite #2's own reasoning (still applies):
                  the Phase A data path (organizeAgainContext.areaId ->
                  finalizeAnalysisResult's areaId param) has existed since
                  Phase A but had no live UI trigger once the per-Area
                  grouped section was retired by the Layout Revision. This
                  is a lightweight list, not a revival of that section - one
                  row per durable Area still represented among this Room's
                  visits (same "hide, don't delete" rule the rest of this
                  screen already follows for a zero-visit Area). */}
              {roomDetailAreas.filter((a) => !a.retired && roomDetailPlans.some((p) => p.areaId === a.id)).length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { marginTop: 20, marginBottom: 10 }]}>AREAS IN THIS ROOM</Text>
                  {roomDetailAreas.filter((a) => !a.retired && roomDetailPlans.some((p) => p.areaId === a.id)).map((area) => {
                    // Item 3: area.latestPhotoUrl is derived by
                    // updateAreaSummary, which writeSpaceShadowStructure
                    // calls fire-and-forget (never awaited) from
                    // savePlanToHistory - so on a REVISIT, there is a real
                    // window where the plan/photo are already saved and the
                    // user has already navigated away, but this Area's own
                    // projected latestPhotoUrl hasn't caught up yet in
                    // Firestore. A fast return to Room Detail during that
                    // window reads the stale value; a later return (after
                    // the fire-and-forget write lands) reads the correct
                    // one - this is the "icon initially, photo after
                    // navigation" behavior. Rather than making the save
                    // path slower (touching every other consumer of that
                    // fire-and-forget write), fall back to the most recent
                    // matching PLAN's own photoUrl - which IS reliably set
                    // by the time Room Detail's data loads, since
                    // savePlanToHistory awaits the plan's own photo
                    // upload/patch before ever returning. The icon renders
                    // only when genuinely no photo can be found either way.
                    const matchingPlans = roomDetailPlans.filter((p) => p.areaId === area.id && p.photoUrl);
                    const fallbackPhotoUrl = matchingPlans.length
                      ? matchingPlans.reduce((latest, p) => (new Date(p.createdAt) > new Date(latest.createdAt) ? p : latest)).photoUrl
                      : null;
                    const resolvedPhotoUrl = area.latestPhotoUrl || fallbackPhotoUrl;
                    // Swipe-to-delete replaces the old visible "Delete" text
                    // link entirely - the only way to reach Area delete now
                    // is swipe-left-then-tap-trash. renderRightActions'
                    // own swipeableMethods (not a separate ref) is what
                    // handleDeleteArea uses to close this exact row cleanly
                    // on both confirm and cancel.
                    return (
                      <SwipeToDeleteRow
                        key={area.id}
                        accessibilityLabel={`Delete ${area.displayName}`}
                        onDelete={(swipeableMethods) => handleDeleteArea(area, swipeableMethods)}
                      >
                        <View style={[s.historyItem, { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 0 }]}>
                          {resolvedPhotoUrl ? (
                            <Image source={{ uri: resolvedPhotoUrl }} style={s.historyIcon} resizeMode="cover" />
                          ) : (
                            <View style={s.historyIcon}>
                              <Text style={{ fontSize: 20 }}>🏠</Text>
                            </View>
                          )}
                          {/* Item 2: name and "Organize Again" each on their
                              own line (matching renderVisitRow's own fix) -
                              no shared row width to truncate against.
                              Area Re-parenting Phase A (§9): the "..."
                              overflow control shares the Organize Again
                              line, pushed to the far right by a spacer, so
                              Organize Again keeps the primary-action slot
                              and Rename/Move/Delete all live behind one
                              secondary control instead of competing with
                              it. */}
                          <View style={{ flex: 1 }}>
                            <Text style={s.historySpace} numberOfLines={1}>{area.displayName}</Text>
                            <Text style={s.historyOverview} numberOfLines={1}>{`${area.visitCount ?? 0} visit${area.visitCount === 1 ? "" : "s"}`}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                              <TouchableOpacity
                                onPress={() => startOrganizeAgain(mostRecent || { id: room.id }, area.id)}
                                accessibilityLabel={`Organize Again in ${area.displayName}`}
                                accessibilityRole="button"
                                style={{ paddingVertical: 6, paddingRight: 12 }}
                              >
                                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Organize Again</Text>
                              </TouchableOpacity>
                              <View style={{ flex: 1 }} />
                              <TouchableOpacity
                                onPress={() => setAreaActionsFor(area)}
                                style={s.areaOverflowBtn}
                                accessibilityLabel={`More options for ${area.displayName}`}
                                accessibilityRole="button"
                              >
                                <MoreHorizontal size={20} color="#94A3B8" strokeWidth={2.25} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      </SwipeToDeleteRow>
                    );
                  })}
                </>
              )}

              {/* Phase C2: Recently Deleted Areas - deliberately small,
                  same quiet/secondary styling as My Rooms' own Recently
                  Deleted section (gray text, no photo/icon). Omitted
                  entirely when nothing qualifies. */}
              {recentlyDeletedAreas.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { marginTop: 20, marginBottom: 10 }]}>RECENTLY DELETED AREAS</Text>
                  {recentlyDeletedAreas.map((area) => (
                    <View key={area.id} style={[s.historyItem, { backgroundColor: "#F8F9FA", alignItems: "center" }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#64748B" }} numberOfLines={1}>{area.displayName}</Text>
                        <Text style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{formatDeletedAgo(area.deletedAt)}</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRestoreArea(area)}
                        accessibilityLabel={`Restore ${area.displayName}`}
                        accessibilityRole="button"
                        style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                      >
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Restore</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              )}

              {/* Room Detail Layout Revision, item 5: EARLIER ORGANIZING
                  VISITS - every visit except the one already shown in Last
                  Session, so no visit ever renders twice. Deliberately
                  flat, not grouped by Area (see resolveVisitAreaLabel
                  above for why each row can still show a durable Area's
                  current name without needing a grouped section around
                  it) - the prior Area-grouped section design (with its own
                  per-Area "Organize Again"/rename) is retired by this
                  revision; nothing in the Area data model itself changed
                  (Area documents, areaId, summary maintenance all still
                  work exactly as before - see AreaIdentityImplementation.md
                  - only this screen's visual grouping is gone). Omitted
                  entirely when there are no earlier visits (item 5's own
                  "only one visit ever" case). */}
              {earlierVisits.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { marginTop: 20, marginBottom: 10 }]}>{`EARLIER ORGANIZING VISITS (${earlierVisits.length})`}</Text>
                  {earlierVisits.map(renderVisitRow)}
                </>
              )}

              {/* Room-level actions (Section 1) - quiet/destructive text
                  links at the bottom of content, replacing the removed
                  three-dot overflow. Move is real as of Area Re-parenting
                  Phase A - wired to mergeRoomIntoRoom via the same Room
                  Picker Area-move uses. Delete is real as of Phase C1 -
                  soft delete only (handleDeleteRoom), the 30-day hard-purge
                  sweep is a later phase. */}
              <TouchableOpacity onPress={() => openRoomMovePicker(room)} style={{ marginTop: 28, alignItems: "center", paddingVertical: 10 }} accessibilityLabel="Move to another Room" accessibilityRole="button">
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#64748B" }}>Move to another Room</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteRoom(room)}
                style={{ marginTop: 4, alignItems: "center", paddingVertical: 14, borderTopWidth: 1, borderTopColor: "#E6E9EE" }}
                accessibilityLabel="Delete Room"
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>Delete Room</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
        {renderRenameSheet()}
        {renderPhotoZoomModal()}
        {/* Area Re-parenting Phase A (§9/§10): all three live only on Room
            Detail, which is the sole screen that can start either move -
            the Area overflow sheet (per-Area) and the Room Picker +
            confirmation, which the Area flow and the Room-level "Move to
            another Room" link at the bottom of this same screen share. */}
        {renderAreaActionsSheet()}
        {renderRoomPicker()}
        {renderMoveConfirm()}
        {/* Shared processing overlay for PDF export and the restore actions.
            Same component every other flow uses. */}
        {asyncBusyText && <ProcessingOverlay text={asyncBusyText} />}
      </SafeAreaView>
    );
  }

  // FAQ SCREEN
  if (showFaq) {
    const faqs = [
      { q: "How does Uncluttrd work?", a: "Take a photo of any room or organizing area, such as a closet, garage, kitchen, or pantry. Uncluttrd's AI analyzes what it sees and offers three different approaches to transforming it, each with its own guidance, first-session checklist, and product recommendations." },
      { q: "What can I organize?", a: "Any space! Closets, garages, kitchens, pantries, home offices, bedrooms, laundry rooms, storage units. If you can photograph it, Uncluttrd can help organize it." },
      { q: "What's the difference between the three approaches?", a: "They differ in ambition, not just price. Keep It Simple makes the space work and look noticeably better using what you already own. Polished & Practical solves the organization problems and finishes the space with a few targeted purchases. Elevated Finish is a full transformation, addressing every problem and every opportunity the photo shows. Open any approach to see its full guidance, checklist, and recommendations before you choose." },
      { q: "What is Uncluttrd Pro?", a: "Uncluttrd Pro ($2.99/mo) gives you unlimited analyses, full room history saved to your account, AI visualization of your transformed room, and branded PDF sharing. Free users get 3 free transformations per month." },
      { q: "What is the AI Visualization feature?", a: "After getting your organization plan, open any approach and tap 'See the transformation' to preview the result: an AI-created image showing what your space could look like under that approach. Each approach has its own visualization, so you can generate one, several, or all three and compare them. This is a Pro feature." },
      { q: "How do I share my organization plan?", a: "Tap the share icon in the top right of your results. Free users can share as text. Pro users can also share a beautifully branded PDF with your full room." },
      { q: "Where are my saved rooms?", a: "Tap the ☰ menu and select 'My Rooms' to see all your past organization plans, synced across devices via your account. Pro members also get unlimited continuing guidance on each room and can share a branded PDF." },
      { q: "How do I cancel my subscription?", a: "You can cancel anytime through your iPhone Settings → Apple ID → Subscriptions → Uncluttrd. Your Pro access continues until the end of your billing period." },
      { q: "Is my data secure?", a: "Yes. Your photos are sent securely to our AI for analysis and are not stored on our servers. Your account data is secured through Firebase, Google's enterprise-grade platform." },
      { q: "The product links aren't working. What do I do?", a: "Make sure you have a stable internet connection. The product links open Google Shopping with a search for the recommended item." },
      { q: "How do I contact support?", a: "Email us at hello@uncluttrd.app and we'll get back to you within 24 hours." },
    ];
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>Help & FAQ</Text>
            <Text style={s.hdrTag}>Common questions answered</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowHistory(false); setShowFaq(false); setShowAccount(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          <View style={s.faqIntro}>
            <Text style={s.faqIntroText}>Have a question? Tap any topic below. If you still need help, email us at <Text style={{ color: BRAND.green }}>hello@uncluttrd.app</Text></Text>
          </View>
          {faqs.map((faq, i) => (
            <TouchableOpacity key={i} style={s.faqItem} onPress={() => setFaqOpen(faqOpen === i ? null : i)}>
              <View style={s.faqQuestion}>
                <Text style={s.faqQuestionText}>{faq.q}</Text>
                <Text style={s.faqChevron}>{faqOpen === i ? "▲" : "▼"}</Text>
              </View>
              {faqOpen === i && (
                <Text style={s.faqAnswer}>{faq.a}</Text>
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.contactBtn} onPress={() => Linking.openURL("mailto:hello@uncluttrd.app")}>
            <Text style={s.contactBtnText}>📧 Contact Support</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // MERGE PROPOSAL REVIEW SCREEN (§12 Migration Part 3, Pass 2 -
  // MergeProposalDesign.md) - reuses the Space Inspector's screen shape
  // (header-with-back + ScrollView of stacked SectionCard-style blocks).
  // Also independently reachable via its own menu entry above, so it is
  // never only reachable through the banner. Every write below goes
  // through the atomic module-level functions defined near
  // checkMigrationCompleteness - each one a single writeBatch, never a
  // bare updateDoc/setDoc from inside this render block.
  if (showMergeReview) {
    const allPlanIds = new Set();
    pendingMergeCandidates.forEach((c) => (c.planIds || []).forEach((id) => allPlanIds.add(id)));
    const stillLoadingPlans = mergeReviewPlansLoading && [...allPlanIds].some((id) => !(id in mergeReviewPlansById));

    const MergeSectionCard = ({ children }) => (
      <View style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 14 }}>
        {children}
      </View>
    );

    const EvidenceCard = ({ plan, onRename }) => {
      if (plan === undefined) {
        return <View style={s.mergeEvidenceCard}><ActivityIndicator size="small" color={BRAND.green} /></View>;
      }
      if (!plan) {
        return (
          <View style={s.mergeEvidenceCard}>
            <Text style={{ fontSize: 12, color: "#B45309" }}>Record no longer available</Text>
          </View>
        );
      }
      const startingUri = plan.photoUrl || null;
      const latestUri = Array.isArray(plan.progressPhotos) && plan.progressPhotos.length ? plan.progressPhotos[plan.progressPhotos.length - 1].url : null;
      const dateLabel = plan.date || (plan.createdAt ? new Date(plan.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
      // Project-level status doesn't exist until Part 1 structural
      // migration completes for this plan - falls back to reading the
      // equivalent facts directly from the plan document instead of
      // blocking or erroring (MergeProposalDesign.md Section 4).
      const statusLabel = plan.companionComplete ? "Completed" : (plan.currentBatch ? "In progress" : "Not started");
      return (
        <View style={s.mergeEvidenceCard}>
          <Text style={s.mergeEvidenceLabel}>{getSpaceDisplayName(plan) || "Room"}</Text>
          {onRename && (
            // A TouchableOpacity nested inside another TouchableOpacity
            // (this card's own checkbox-select wrapper, in
            // renderPendingCandidate) captures its own taps in React
            // Native's responder system without also triggering the
            // parent's onPress - unlike DOM event bubbling, no
            // stopPropagation is needed for this to work correctly.
            <TouchableOpacity onPress={onRename} style={s.mergeRenameLink} accessibilityLabel="Rename this room" accessibilityRole="button" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Pencil size={11} color={BRAND.green} strokeWidth={2.25} />
              <Text style={s.mergeRenameLinkText}>Rename</Text>
            </TouchableOpacity>
          )}
          {startingUri && latestUri ? (
            <BeforeAfterStack beforeUri={startingUri} afterUri={latestUri} height={110} />
          ) : startingUri ? (
            <Image source={{ uri: startingUri }} style={s.mergeEvidencePhoto} resizeMode="cover" />
          ) : (
            <View style={[s.mergeEvidencePhoto, { alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" }]}>
              <Text style={{ fontSize: 11, color: "#94A3B8" }}>No photo</Text>
            </View>
          )}
          <Text style={s.mergeEvidenceMeta} numberOfLines={1}>{dateLabel}</Text>
          <Text style={s.mergeEvidenceMeta} numberOfLines={1}>{statusLabel}</Text>
        </View>
      );
    };

    const renderPendingCandidate = (candidate) => {
      const selected = mergeSelections[candidate.id] || new Set();
      const canConfirm = selected.size >= 2;
      const loading = mergeActionLoadingId === candidate.id;
      return (
        <MergeSectionCard key={candidate.id}>
          <Text style={s.mergeCandidateSignal}>These rooms currently share the name "{candidate.spaceType}".</Text>
          <Text style={s.mergeCandidateInstruction}>Select all of the records that belong to the same physical room.</Text>
          <Text style={s.mergeCandidateSupportCopy}>Records you leave unselected will not be included in this group. You can review the remaining records separately.</Text>
          <Text style={[s.mergeCandidateSupportCopy, { marginTop: 4 }]}>If that's not correct, you can rename either room before deciding whether they're the same place.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10, marginBottom: 12 }}>
            {candidate.planIds.map((planId) => {
              const isSelected = selected.has(planId);
              const planForCard = mergeReviewPlansById[planId];
              return (
                <TouchableOpacity
                  key={planId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  onPress={() => toggleMergeSelection(candidate.id, planId)}
                  style={[s.mergeEvidenceCardWrap, isSelected && s.mergeEvidenceCardWrapSelected]}
                  disabled={loading}
                >
                  <EvidenceCard plan={planForCard} onRename={planForCard ? () => openRenameSheet(planId, getSpaceDisplayName(planForCard)) : null} />
                  <View style={[s.mergeCheckbox, isSelected && s.mergeCheckboxChecked]}>
                    {isSelected && <Check size={14} color="white" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            style={[s.startOverBtn, { marginTop: 0, backgroundColor: canConfirm ? BRAND.green : "#CBD5E1", borderWidth: 0 }]}
            disabled={!canConfirm || loading}
            onPress={() => handleConfirmSameSpace(candidate)}
          >
            <Text style={[s.startOverText, { color: "white" }]}>{loading ? "Saving..." : "These are the same room"}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} disabled={loading} onPress={() => handleKeepSeparate(candidate)}>
              <Text style={s.mergeSecondaryBtnText}>Keep Separate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} disabled={loading} onPress={() => handleDeferMergeCandidate(candidate, "not-now")}>
              <Text style={s.mergeSecondaryBtnText}>Not Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mergeSecondaryBtn, { flex: 1 }]} disabled={loading} onPress={() => handleDeferMergeCandidate(candidate, "not-sure")}>
              <Text style={s.mergeSecondaryBtnText}>Not sure yet</Text>
            </TouchableOpacity>
          </View>
        </MergeSectionCard>
      );
    };

    // Stale-confirmed candidates are deliberately never rendered on this
    // screen (removed from proactive surfacing - see
    // queryMergeCandidatesForBanner's comment). The card/actions that used
    // to render them (renderStaleCandidate, "Understood, no longer
    // applicable", the reversal action) were removed from this render path
    // rather than left as dead-but-reachable UI; the underlying handlers
    // (handleAcknowledgeStale/handleReverseStale) and their I/O functions
    // are still defined below, unreferenced by any render path, kept for a
    // possible future history/decisions view - see their own comments.

    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>Review Duplicate Rooms</Text>
            <Text style={s.hdrTag}>{pendingMergeCandidates.length} to review</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowMergeReview(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={[s.scrollContent, { paddingBottom: 140 }]}>
          {stillLoadingPlans && (
            <Text style={{ fontSize: 13, color: "#64748B", marginBottom: 12 }}>Loading...</Text>
          )}
          {pendingMergeCandidates.length === 0 && !stillLoadingPlans && (
            <View style={{ alignItems: "center", paddingTop: 40 }}>
              <Text style={s.mergeAllCaughtUpTitle}>All caught up!</Text>
              <Text style={s.mergeAllCaughtUpSub}>No duplicate rooms need your review right now.</Text>
              <TouchableOpacity style={[s.startOverBtn, { backgroundColor: BRAND.green, borderWidth: 0, paddingHorizontal: 32 }]} onPress={goHome}>
                <Text style={[s.startOverText, { color: "white" }]}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          )}
          {pendingMergeCandidates.map(renderPendingCandidate)}
        </ScrollView>
        {renderRenameSheet()}
      </SafeAreaView>
    );
  }

  // SPACE INSPECTOR SCREEN (dev-only, Slice 2) - read-only diagnostic tool.
  // Never reachable outside __DEV__ (see the menu entry above, gated with
  // hide: !__DEV__). Everything below only calls loadSpaceShadowGraph,
  // which is itself read-only (getDoc/getDocs only - see the report for
  // the grep confirming this). No mutation, no repair action anywhere on
  // this screen - a MISSING shadow only ever displays the CLI command to
  // run separately, never a button that would write from here.
  if (showSpaceInspector) {
    const runInspection = async () => {
      const uid = inspectorUidInput.trim();
      const planId = inspectorPlanIdInput.trim();
      if (!uid || !planId) { setInspectorError("Enter both a uid and a planId."); return; }
      setInspectorLoading(true);
      setInspectorError(null);
      setInspectorResult(null);
      try {
        const graph = await loadSpaceShadowGraph(uid, planId);
        setInspectorResult(graph);
      } catch (e) {
        setInspectorError(e.message);
      } finally {
        setInspectorLoading(false);
      }
    };

    const Row = ({ label, value }) => (
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
        <Text style={{ fontSize: 13, color: "#64748B" }}>{label}</Text>
        <Text style={{ fontSize: 13, color: "#0F2A52", fontFamily: "Inter_600SemiBold", maxWidth: "60%", textAlign: "right" }}>{String(value)}</Text>
      </View>
    );
    const SectionCard = ({ title, children }) => (
      <View style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 12 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: BRAND.green, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{title}</Text>
        {children}
      </View>
    );

    const graph = inspectorResult;
    const isMissing = graph && graph.validation.findings.some(f => f.status === "MISSING");
    const findingColor = (status) => status === "OK" ? "#15803D" : status === "INFO" ? "#64748B" : status === "MISSING" ? "#B45309" : status === "STALE" ? "#CA8A04" : "#DC2626";

    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>🔍 Space Inspector</Text>
            <Text style={s.hdrTag}>Dev-only, read-only</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowSpaceInspector(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        {/* Staging-only inspector. Same keyboard props as Home: its uid/planId
            fields sit above a Load button, and without persistTaps the first
            tap on that button is swallowed dismissing the keyboard. */}
        <ScrollView
          style={s.screenScroll}
          contentContainerStyle={s.scrollContent}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <SectionCard title="Lookup">
            <TextInput
              style={{ borderWidth: 1, borderColor: "#D7DCE3", borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 8, color: "#0F2A52" }}
              placeholder="uid (staging)" placeholderTextColor="#94A3B8" autoCapitalize="none" autoCorrect={false}
              value={inspectorUidInput} onChangeText={setInspectorUidInput}
            />
            <TextInput
              style={{ borderWidth: 1, borderColor: "#D7DCE3", borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 10, color: "#0F2A52" }}
              placeholder="planId" placeholderTextColor="#94A3B8" autoCapitalize="none" autoCorrect={false}
              value={inspectorPlanIdInput} onChangeText={setInspectorPlanIdInput}
            />
            <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={runInspection} disabled={inspectorLoading}>
              <Text style={[s.startOverText, { color: "white" }]}>{inspectorLoading ? "Loading..." : "Load Shadow Graph"}</Text>
            </TouchableOpacity>
            {inspectorError && <Text style={{ color: "#DC2626", fontSize: 13, marginTop: 8 }}>{inspectorError}</Text>}
          </SectionCard>

          {graph && isMissing && (
            <SectionCard title="Validation">
              <Text style={{ fontSize: 13, color: "#B45309", fontFamily: "Inter_600SemiBold", marginBottom: 10 }}>MISSING - no shadow documents exist for this plan.</Text>
              <Text style={{ fontSize: 12, color: "#64748B", marginBottom: 4 }}>Expected deterministic IDs (Space/Project/Session all equal to planId, by design; batches are per-index, see below):</Text>
              <Row label="spaceId" value={graph.expectedIds.spaceId} />
              <Row label="projectId" value={graph.expectedIds.projectId} />
              <Row label="sessionId" value={graph.expectedIds.sessionId} />
              <Row label="batch ID scheme" value="planId-batch{N}, one per batchIndex" />
              <Text style={{ fontSize: 12, color: "#64748B", marginTop: 12, marginBottom: 6 }}>To repair (run separately, not from this screen):</Text>
              <View style={{ backgroundColor: "#0F2A52", borderRadius: 8, padding: 10 }}>
                <Text style={{ color: "#A7F3D0", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" }} selectable={true}>
                  {`node scripts/validateSpaceMigration.js --uid=${inspectorUidInput.trim()} --planId=${inspectorPlanIdInput.trim()} --repair`}
                </Text>
              </View>
            </SectionCard>
          )}

          {graph && !isMissing && (
            <>
              <SectionCard title="Overview">
                <Row label="Space name/type" value={graph.space.data?.displayName ?? "(none)"} />
                <Row label="Project status" value={graph.project.data?.status ?? "(missing)"} />
                <Row label="Session status" value={graph.session.data?.status ?? "(missing)"} />
                <Row label="Batch count" value={graph.batches.length} />
                <Row label="Highest batch index" value={graph.batches.length ? graph.batches[graph.batches.length - 1].data.batchIndex : "(missing)"} />
                <Row label="Source plan ID" value={graph.sourcePlan.id} />
                <Row label="Shadow schema version" value={graph.project.data?.shadowSchemaVersion ?? "(n/a)"} />
              </SectionCard>

              <SectionCard title="Ownership">
                <Row label="spaceId" value={graph.expectedIds.spaceId} />
                <Row label="projectId" value={graph.expectedIds.projectId} />
                <Row label="sessionId" value={graph.expectedIds.sessionId} />
                {graph.batches.map((b) => (
                  <Row key={b.id} label={`batchId (index ${b.data.batchIndex})`} value={b.id} />
                ))}
                <Row label="Project -> Space (scopeId matches)" value={graph.project.data?.scopeId === graph.expectedIds.spaceId ? "✓ correct" : "✗ MISMATCH"} />
                <Row label="Session -> Project (projectId matches)" value={graph.session.data?.projectId === graph.expectedIds.projectId ? "✓ correct" : "✗ MISMATCH"} />
                <Row label="Batch -> Session" value="(structural - proven by Firestore path, no separate pointer field in this schema)" />
              </SectionCard>

              <SectionCard title="Evidence">
                <Row label="Starting evidence URL" value={graph.project.data?.startingEvidence?.photoUrl ?? "(none)"} />
                <Row label="Current evidence URL" value={graph.project.data?.currentEvidence?.photoUrl ?? "(none)"} />
                <Row label="Evidence status" value={graph.project.data?.evidenceStatus ?? "(n/a)"} />
                {graph.project.data?.evidenceStatus === "unavailable" && (
                  <Text style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>Unavailable reason: photoUrl was not yet available at shadow-write time (photo upload had not completed) - Part 1's expected, non-error state, not a defect.</Text>
                )}
              </SectionCard>

              <SectionCard title="Work State">
                {graph.batches.map((b) => (
                  <View key={b.id} style={{ marginBottom: 10 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.green, marginBottom: 2 }}>Batch {b.data.batchIndex} ({b.id})</Text>
                    {(b.data.items || []).map((item, i) => (
                      <Row key={i} label={item.text} value={item.status} />
                    ))}
                  </View>
                ))}
                <Row label="companionComplete (source plan)" value={graph.sourcePlan.data?.companionComplete ? "set" : "not set"} />
              </SectionCard>

              <SectionCard title="Validation">
                {graph.validation.findings.map((f, i) => (
                  <View key={i} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: findingColor(f.status) }}>{f.status}  {f.invariant}</Text>
                    {f.note && <Text style={{ fontSize: 12, color: "#64748B" }}>{f.note}</Text>}
                    {(f.status === "MISMATCH" || f.status === "STALE") && <Text style={{ fontSize: 12, color: "#64748B" }}>expected: {JSON.stringify(f.expected)}  found: {JSON.stringify(f.found)}</Text>}
                  </View>
                ))}
              </SectionCard>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ACCOUNT SCREEN
  if (showAccount) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>Account</Text>
            <Text style={s.hdrTag}>Manage your profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowHistory(false); setShowFaq(false); setShowAccount(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          <View style={s.accountCard}>
            <View style={s.accountAvatar}>
              <Text style={s.accountAvatarText}>{user.displayName?.charAt(0)?.toUpperCase() || "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.accountName}>{user.displayName}</Text>
              <Text style={s.accountEmail}>{user.email}</Text>
            </View>
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>SUBSCRIPTION</Text>
          <View style={s.accountInfoCard}>
            <View style={s.accountRow}>
              <Text style={s.accountRowLabel}>Plan</Text>
              <View style={[s.accountBadge, { backgroundColor: isPro ? BRAND.greenLight : BRAND.offWhite, borderColor: isPro ? BRAND.greenMid : BRAND.stone }]}>
                <Text style={[s.accountBadgeText, { color: isPro ? BRAND.green : BRAND.slate }]}>{isPro ? "⭐ Uncluttrd Pro" : "Free"}</Text>
              </View>
            </View>
            {!isPro && (
              <View style={s.accountRow}>
                <Text style={s.accountRowLabel}>Transformations remaining</Text>
                <Text style={s.accountRowValue}>{Math.max(0, 3 - (analyses || 0))} of 3</Text>
              </View>
            )}
            {!isPro && (
              <TouchableOpacity style={s.upgradeBtn} onPress={() => { setShowAccount(false); setShowPaywall(true); }}>
                <Text style={s.upgradeBtnText}>Upgrade to Pro</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>PROFILE</Text>
          <View style={s.accountInfoCard}>
            <View style={s.accountRow}>
              <Text style={s.accountRowLabel}>Name</Text>
              <Text style={s.accountRowValue}>{user.displayName}</Text>
            </View>
            <View style={[s.accountRow, { borderBottomWidth: 0 }]}>
              <Text style={s.accountRowLabel}>Email</Text>
              <Text style={s.accountRowValue}>{user.email}</Text>
            </View>
          </View>
          <Text style={[s.sectionLabel, { marginTop: 20 }]}>ACCOUNT</Text>
          <View style={s.accountInfoCard}>
            <TouchableOpacity style={s.accountRow} onPress={handleSignOut}>
              <Text style={[s.accountRowLabel, { color: "#991B1B" }]}>Sign Out</Text>
              <Text style={{ color: BRAND.mist, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.accountRow, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
              <Text style={[s.accountRowLabel, { color: "#991B1B" }]}>Delete Account</Text>
              <Text style={{ color: BRAND.mist, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

          {/* Delete Account Password Modal */}
          {/* Keyboard audit (2026-08-12). Centred rather than bottom-
              anchored, so it is less exposed than the sheets - but "less"
              is not "not": the card is centred in the FULL screen height,
              and an iOS keyboard covers roughly the bottom 40%, which on a
              smaller device reaches the password field and the buttons
              under it. KAV recentres it in the space that is actually
              left. This modal is also the one place where not being able
              to see the field is worst, since the text is obscured. */}
          <Modal visible={showDeleteModal} transparent={true} animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 }}>
              <View style={{ backgroundColor: "white", borderRadius: 20, padding: 28, width: "100%", maxWidth: 360 }}>
                <Text style={{ fontSize: 20, fontWeight: "700", color: "#0F2A52", marginBottom: 8 }}>Confirm Deletion</Text>
                <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 20, lineHeight: 20 }}>
                  Enter your password to permanently delete your account and all saved data.
                </Text>
                <TextInput
                  style={{
                    borderWidth: 1, borderColor: deleteError ? "#DC2626" : "#D7DCE3",
                    borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 8,
                    color: "#0F2A52"
                  }}
                  placeholder="Password"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={true}
                  value={deletePassword}
                  onChangeText={(t) => { setDeletePassword(t); setDeleteError(""); }}
                  autoFocus={true}
                  editable={!deleteLoading}
                />
                {deleteError ? (
                  <Text style={{ fontSize: 13, color: "#DC2626", marginBottom: 12 }}>{deleteError}</Text>
                ) : (
                  <View style={{ height: 12 }} />
                )}
                <TouchableOpacity
                  style={{
                    backgroundColor: deleteLoading ? "#FCA5A5" : "#DC2626",
                    borderRadius: 10, padding: 14, alignItems: "center", marginBottom: 10
                  }}
                  onPress={handleConfirmDelete}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Delete My Account</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ padding: 14, alignItems: "center" }}
                  onPress={() => setShowDeleteModal(false)}
                  disabled={deleteLoading}
                >
                  <Text style={{ color: "#64748B", fontSize: 15 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
              {/* Phase C5: server-side deletion can genuinely take a while
                  for an account with a lot of history - the existing
                  ProcessingOverlay convention (every other multi-step save
                  flow in this file already uses it) covers the whole modal
                  while hardDeleteAccount is in flight, not just the
                  button's own inline spinner. */}
              {deleteLoading && <ProcessingOverlay text="Deleting your account..." />}
            </View>
            </KeyboardAvoidingView>
          </Modal>

      </SafeAreaView>
    );
  }

  // AREA CONFIRMATION SCREEN (Area Identity, Phase B - Visual Recognition,
  // AreaRecognitionPhaseBImplementation.md). Checked BEFORE roomConfirmation
  // below, same reason as the Android back-handler above: roomConfirmation
  // stays truthy (paused, not cleared) while this screen shows, for the
  // generic-camera entry point. Governing principle, restated: visual
  // similarity may PROPOSE Area identity; only explicit user confirmation
  // ESTABLISHES it - nothing here saves anything; every action routes
  // through completeAreaConfirmation, which only ever touches local React
  // state until the user actually picks one.
  if (areaConfirmation) {
    const daysAgo = (iso) => {
      if (!iso) return null;
      const ms = Date.now() - Date.parse(iso);
      return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
    };
    const { status, candidates, existingAreas, view } = areaConfirmation;

    const AreaConfirmationHeader = ({ title }) => (
      <>
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          {/* Cancels the whole Area confirmation - clears areaConfirmation/
              areaConfirmationPendingRef with zero residual state (test m:
              "back/cancel -> no plan, no Area" - nothing was ever saved
              during the pause, so clearing local state is sufficient).
              Disabled while a save is outstanding, same as
              RoomConfirmationHeader's own cancel button. */}
          <TouchableOpacity disabled={areaConfirmationSaving} onPress={() => { areaConfirmationPendingRef.current = null; setAreaConfirmation(null); setAreaConfirmationError(null); }} style={s.hdrMark} accessibilityLabel="Cancel and go home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>{title}</Text>
          </View>
        </View>
        {areaConfirmationError && (
          <View style={{ backgroundColor: "#FEF2F2", borderBottomWidth: 1, borderBottomColor: "#FCA5A5", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 13, color: "#B91C1C" }}>{areaConfirmationError}</Text>
            <TouchableOpacity onPress={retryAreaConfirmation} style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#B91C1C", borderRadius: 8 }}>
              <Text style={{ color: "white", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );

    // Mirrors Room Confirmation's own EvidenceCardForCandidate (LAST TIME/
    // TODAY side-by-side, not the shared BeforeAfterStack component - see
    // that component's own comment for why). evidenceReason is shown as a
    // small caption - the model's own cited visible evidence for this
    // specific match (never a numeric score, never requested/parsed).
    const EvidenceCardForAreaCandidate = ({ area, onConfirm, confirmLabel }) => {
      const days = daysAgo(area.lastOrganizedAt);
      const priorPhotoUrl = area.latestPhotoUrl || area.originalPhotoUrl || null;
      return (
        <View style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 14 }}>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <View style={[s.beforeAfterStackWrap, { height: 140 }]}>
                {priorPhotoUrl && <Image source={{ uri: priorPhotoUrl }} style={s.beforeAfterStackImage} resizeMode="cover" />}
                <Text style={s.beforeAfterStackLabel}>LAST TIME</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <View style={[s.beforeAfterStackWrap, { height: 140 }]}>
                {photo?.uri && <Image source={{ uri: photo.uri }} style={s.beforeAfterStackImage} resizeMode="cover" />}
                <Text style={s.beforeAfterStackLabel}>TODAY</Text>
              </View>
            </View>
          </View>
          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 2 }}>{area.displayName}</Text>
          <Text style={{ fontSize: 12, color: "#64748B", marginBottom: area.evidenceReason ? 4 : 10 }}>
            {days !== null ? `Last organized ${days} day${days === 1 ? "" : "s"} ago` : "Last organized a while ago"}
            {` · ${area.visitCount ?? 0} visit${area.visitCount === 1 ? "" : "s"}`}
          </Text>
          {area.evidenceReason && (
            <Text style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", marginBottom: 10 }}>{area.evidenceReason}</Text>
          )}
          <TouchableOpacity disabled={areaConfirmationSaving} style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0, opacity: areaConfirmationSaving ? 0.6 : 1 }]} onPress={onConfirm} disabled={roomConfirmationSaving}>
            <Text style={[s.startOverText, { color: "white" }]}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      );
    };

    // ---- Sub-view: picker - "Choose another saved area", lists every
    // Area in this Room (not just the proposed candidates), no photos
    // required, no auto-select - mirrors the Room picker's own plain-list
    // pattern one level down. ----
    if (view === "picker") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <AreaConfirmationHeader title="Choose a saved Area" />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            {existingAreas.map((area) => (
              <TouchableOpacity key={area.id} disabled={areaConfirmationSaving} style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => completeAreaConfirmation({ kind: "picked", areaId: area.id })}>
                {area.latestPhotoUrl || area.originalPhotoUrl ? (
                  <Image source={{ uri: area.latestPhotoUrl || area.originalPhotoUrl }} style={s.historyIcon} resizeMode="cover" />
                ) : (
                  <View style={s.historyIcon}><Text style={{ fontSize: 20 }}>🏠</Text></View>
                )}
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink, flex: 1 }}>{area.displayName}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => setAreaConfirmation((prev) => (prev ? { ...prev, view: "main" } : prev))}>
              <Text style={s.mergeSecondaryBtnText}>← Back</Text>
            </TouchableOpacity>
          </ScrollView>
          {areaConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // ---- Main view: RECOGNITION_FAILED - failure-state chooser. Never
    // auto-creates an Area from a technical failure (governing principle).
    // Same pattern as Room recognition's own "failed" outcome. ----
    if (status === "RECOGNITION_FAILED") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <AreaConfirmationHeader title="We couldn't check your saved Areas right now." />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 16 }}>Choose an existing Area, or continue with a new one.</Text>
            {existingAreas.map((area) => (
              <TouchableOpacity key={area.id} disabled={areaConfirmationSaving} style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => completeAreaConfirmation({ kind: "picked", areaId: area.id })}>
                {area.latestPhotoUrl || area.originalPhotoUrl ? (
                  <Image source={{ uri: area.latestPhotoUrl || area.originalPhotoUrl }} style={s.historyIcon} resizeMode="cover" />
                ) : (
                  <View style={s.historyIcon}><Text style={{ fontSize: 20 }}>🏠</Text></View>
                )}
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink, flex: 1 }}>{area.displayName}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity disabled={areaConfirmationSaving} style={[s.startOverBtn, { marginTop: 10, backgroundColor: BRAND.green, borderWidth: 0, opacity: areaConfirmationSaving ? 0.6 : 1 }]} onPress={() => completeAreaConfirmation({ kind: "new" })}>
              <Text style={[s.startOverText, { color: "white" }]}>This is a new area</Text>
            </TouchableOpacity>
          </ScrollView>
          {areaConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // ---- Main view: MATCH_FOUND - one candidate is a compact single-card
    // confirmation; multiple candidates stack. No per-candidate reject
    // button either way - either tap a match, or use one of the two
    // options below (per the design doc's own explicit UI rule). ----
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <AreaConfirmationHeader title="Have we worked on this area before?" />
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          {candidates.map((area) => (
            <EvidenceCardForAreaCandidate
              key={area.id}
              area={area}
              confirmLabel={`Yes, this is my ${area.displayName}`}
              onConfirm={() => completeAreaConfirmation({ kind: "matched", areaId: area.id })}
            />
          ))}
          <TouchableOpacity disabled={areaConfirmationSaving} style={s.mergeSecondaryBtn} onPress={() => completeAreaConfirmation({ kind: "new" })}>
            <Text style={s.mergeSecondaryBtnText}>This is a new area</Text>
          </TouchableOpacity>
          {existingAreas.length > candidates.length && (
            <TouchableOpacity disabled={areaConfirmationSaving} style={[s.mergeSecondaryBtn, { marginTop: 8 }]} onPress={() => setAreaConfirmation((prev) => (prev ? { ...prev, view: "picker" } : prev))}>
              <Text style={s.mergeSecondaryBtnText}>Choose another saved area</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
        {areaConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
      </SafeAreaView>
    );
  }

  // ROOM CONFIRMATION SCREEN (Room-First Identity, Phase B -
  // RoomFirstIdentityDesign.md §2). Shown for every generic-camera photo
  // analysis (Organize Again/Step 2 skips it entirely via
  // navigation-established identity) - Room identity must always be
  // established now, not just when a match happens to exist. Governing
  // principle: recognition proposes, never asserts - this screen is
  // always its own explicit stop, ahead of Results, exactly like every
  // other interstitial in this file. Phase B produces a resolved
  // confirmation result and stops - it does NOT save anything; every
  // action below routes through completeRoomConfirmation, which only
  // ever touches local React state (see its own declaration above).
  if (roomConfirmation) {
    const daysAgo = (iso) => {
      if (!iso) return null;
      const ms = Date.now() - Date.parse(iso);
      return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
    };
    const pendingParsed = recognitionPendingRef.current?.parsed;
    const { routing, knownRooms, view, freeformContext } = roomConfirmation;

    const EvidenceCardForCandidate = ({ candidate, onConfirm, confirmLabel }) => {
      const days = daysAgo(candidate.lastOrganizedAt);
      return (
        <View style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 14 }}>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <View style={[s.beforeAfterStackWrap, { height: 140 }]}>
                {candidate.priorPhotoUrl && <Image source={{ uri: candidate.priorPhotoUrl }} style={s.beforeAfterStackImage} resizeMode="cover" />}
                <Text style={s.beforeAfterStackLabel}>LAST TIME</Text>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <View style={[s.beforeAfterStackWrap, { height: 140 }]}>
                {photo?.uri && <Image source={{ uri: photo.uri }} style={s.beforeAfterStackImage} resizeMode="cover" />}
                <Text style={s.beforeAfterStackLabel}>TODAY</Text>
              </View>
            </View>
          </View>
          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 2 }}>{candidate.displayName}</Text>
          <Text style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
            {days !== null ? `Last organized ${days} day${days === 1 ? "" : "s"} ago` : "Last organized a while ago"}
            {candidate.workSummary ? ` · ${candidate.workSummary}` : ""}
          </Text>
          <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onConfirm} disabled={roomConfirmationSaving}>
            <Text style={[s.startOverText, { color: "white" }]}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      );
    };

    const RoomConfirmationHeader = ({ title }) => (
      <>
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          {/* Cancels the whole confirmation - clears roomConfirmation/
              recognitionPendingRef with zero residual state (test k),
              returning to the photo-preview Home screen rather than losing
              the photo entirely. Same clearing the Android back handler's
              outcome-(c) branch does. Disabled while a save is outstanding
              - cancelling mid-save could otherwise orphan a write already
              in flight. */}
          <TouchableOpacity disabled={roomConfirmationSaving} onPress={() => { recognitionPendingRef.current = null; setRoomFreeformInput(""); setRoomConfirmation(null); }} style={s.hdrMark} accessibilityLabel="Cancel and go home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>{title}</Text>
          </View>
          {/* Track 2 finding (2026-08-07): this header is its own local
              component, not the shared goHome/debugShareLog header pattern
              used elsewhere - its logo TouchableOpacity only ever had
              onPress (cancel-and-return), never onLongPress, so the
              long-press-to-share gesture was never wired here at all; a
              long press just resolved to the plain cancel tap. Explicit
              button instead of trying to retrofit onLongPress onto the
              cancel button (which would make one gesture do two unrelated
              things on the one screen where accidentally triggering
              "cancel" mid-confirmation is worst). Staging-only (IS_STAGING,
              same gate as the STAGING banner) - never shown in production. */}
          {IS_STAGING && (
            <TouchableOpacity onPress={debugShareLog} style={{ paddingHorizontal: 10, paddingVertical: 6, marginTop: 2 }} accessibilityLabel="Share debug log" accessibilityRole="button">
              <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: BRAND.mist }}>Debug Log</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* Error handling, point 5: a failed save leaves roomConfirmation/
            recognitionPendingRef untouched (see completeRoomConfirmation's
            own catch/early-return paths) - this banner surfaces the error
            with a retry that re-attempts the EXACT same resolved result,
            never asking the user to redo their Room choice. */}
        {roomConfirmationError && (
          <View style={{ backgroundColor: "#FEF2F2", borderBottomWidth: 1, borderBottomColor: "#FCA5A5", padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ flex: 1, fontSize: 13, color: "#B91C1C" }}>{roomConfirmationError}</Text>
            <TouchableOpacity onPress={retryRoomConfirmation} style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#B91C1C", borderRadius: 8 }}>
              <Text style={{ color: "white", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>Try Again</Text>
            </TouchableOpacity>
          </View>
        )}
      </>
    );

    // ---- Sub-view: Room picker - reused by b1's decline-fallback, b2/b3's
    // "choose another Room", and outcome (c)'s existing-Rooms option.
    // pickerContext (read inside onRoomPickerSelect) decides what
    // selecting a Room actually means. ----
    if (view === "picker") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title="Choose a Room" />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            {knownRooms.length === 0 && (
              <Text style={{ fontSize: 13, color: "#64748B", marginBottom: 12 }}>You don't have any saved Rooms yet.</Text>
            )}
            {knownRooms.map((room) => (
              <TouchableOpacity key={room.canonicalSpaceId} style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 10 }} onPress={() => onRoomPickerSelect(room)} disabled={roomConfirmationSaving}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink }}>{room.displayName}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={backToRoomConfirmationMain} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>← Back</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // ---- Sub-view: freeform Room-name entry ----
    if (view === "freeform") {
      const isParentFlavor = freeformContext === "b2-parent-zero";
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title={isParentFlavor ? "What's the Room called?" : "Enter a Room name"} />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            <TextInput
              style={s.renameSheetInput}
              value={roomFreeformInput}
              onChangeText={setRoomFreeformInput}
              placeholder={isParentFlavor ? "e.g. Kitchen" : "e.g. Guest Bedroom"}
              autoFocus
              editable={!roomConfirmationSaving}
              returnKeyType="done"
              onSubmitEditing={() => { if (roomFreeformInput.trim() && !roomConfirmationSaving) onSubmitRoomFreeform(); }}
            />
            <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0, opacity: roomFreeformInput.trim() ? 1 : 0.5 }]} disabled={!roomFreeformInput.trim() || roomConfirmationSaving} onPress={onSubmitRoomFreeform}>
              <Text style={[s.startOverText, { color: "white" }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={backToRoomConfirmationMain} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>← Back</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // ---- Main view: outcome-specific chooser ----

    // Outcome (a): one exact Room match, compact confirmation - "nearly
    // invisible" friction: one tap to confirm, one to decline.
    if (routing.outcome === "a") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title={`Is this in your ${routing.candidate.displayName}?`} />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            <EvidenceCardForCandidate
              candidate={routing.candidate}
              confirmLabel={`Yes, this is my ${routing.candidate.displayName}`}
              onConfirm={() => completeRoomConfirmation(resolveExistingRoomConfirmation(routing.candidate, { areaName: pendingParsed?.suggestedAreaName ?? null, areaScope: pendingParsed?.areaScope || "whole-room" }), routing.candidate)}
            />
            <TouchableOpacity style={s.mergeSecondaryBtn} onPress={declineToOutcomeC} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>No, this is a new room</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // Outcome (b1): multiple same-named Rooms - stacked cards, not a
    // carousel, each with its own evidence.
    if (routing.outcome === "b1") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title="Have we organized this room before?" />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            {routing.candidates.map((candidate) => (
              <EvidenceCardForCandidate
                key={candidate.canonicalSpaceId}
                candidate={candidate}
                confirmLabel={`Yes, this is my ${candidate.displayName}`}
                onConfirm={() => completeRoomConfirmation(resolveExistingRoomConfirmation(candidate, { areaName: pendingParsed?.suggestedAreaName ?? null, areaScope: pendingParsed?.areaScope || "whole-room" }), candidate)}
              />
            ))}
            <TouchableOpacity style={s.mergeSecondaryBtn} onPress={declineToOutcomeC} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>None of these - it's a new room</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // Outcome (b2)/(b3): ambiguous chooser - same shape and options
    // (RoomFirstIdentityDesign.md §4 b3: "same ambiguous chooser as b2"),
    // different header copy and label source.
    if (routing.outcome === "b2" || routing.outcome === "b3") {
      const label = routing.outcome === "b3" ? routing.candidate.displayName : (pendingParsed?.suggestedRoomName || "");
      const headerTitle = routing.outcome === "b3"
        ? `"${label}" looks like it might be part of a larger room`
        : `Is ${label} its own room, or part of another room?`;
      const insidePickerContext = routing.outcome === "b3" ? "b3-inside" : "b2-inside";
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title={headerTitle} />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            {routing.outcome === "b3" && (
              <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 14 }}>Is it its own room, or part of an existing room?</Text>
            )}
            <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onOwnRoom} disabled={roomConfirmationSaving}>
              <Text style={[s.startOverText, { color: "white" }]}>{`${label} is its own Room`}</Text>
            </TouchableOpacity>
            {routing.firstTimeUser ? (
              <>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("b2-parent-zero")} disabled={roomConfirmationSaving}>
                  <Text style={s.mergeSecondaryBtnText}>Create the Room it belongs to</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("b2-freeform-zero")} disabled={roomConfirmationSaving}>
                  <Text style={s.mergeSecondaryBtnText}>Enter a different Room name</Text>
                </TouchableOpacity>
              </>
            ) : routing.plausibleParent ? (
              <>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={onInsideSpecificParent} disabled={roomConfirmationSaving}>
                  <Text style={s.mergeSecondaryBtnText}>{`${label} is inside ${routing.plausibleParent.displayName}`}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker(insidePickerContext)} disabled={roomConfirmationSaving}>
                  <Text style={s.mergeSecondaryBtnText}>Choose another Room</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker(insidePickerContext)} disabled={roomConfirmationSaving}>
                <Text style={s.mergeSecondaryBtnText}>{`${label} is inside another Room`}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // Outcome (failed): the recognition lookup itself never completed
    // (query threw/errored) - deliberately distinct copy from (c) below.
    // (c) asserts a completed check found nothing; that would be false
    // here, since we genuinely don't know whether a matching Room exists
    // (Track 2 diagnostic finding, 2026-08-07). Two honest choices only:
    // pick an existing Room directly (skips recognition entirely, same
    // resolution as (c)'s secondary option), or continue with a new one
    // (same as (c)'s "accept suggestion" - reuses onAcceptSuggestedRoom
    // verbatim, since "continue as new" and "accept the AI's suggestion"
    // are the same resolution regardless of why we ended up here).
    if (routing.outcome === "failed") {
      return (
        <SafeAreaView style={s.safe}>
          <StatusBar barStyle="light-content" />
          <RoomConfirmationHeader title="We couldn't check your saved Rooms right now." />
          <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
            <Text style={{ fontSize: 14, color: BRAND.slate, marginBottom: 16 }}>Choose an existing Room or continue with a new one.</Text>
            {knownRooms.length > 0 && (
              <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={() => openRoomPicker("failed-secondary")}>
                <Text style={[s.startOverText, { color: "white" }]}>Choose an existing Room</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={onAcceptSuggestedRoom} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>{`Continue as new: "${pendingParsed?.suggestedRoomName || "Room"}"`}</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
        </SafeAreaView>
      );
    }

    // Outcome (c): no existing match.
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <RoomConfirmationHeader title={`We think this is your ${pendingParsed?.suggestedRoomName || "room"}. Is that right?`} />
        <ScrollView style={s.screenScroll} contentContainerStyle={s.scrollContent}>
          <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onAcceptSuggestedRoom} disabled={roomConfirmationSaving}>
            <Text style={[s.startOverText, { color: "white" }]}>{`Yes, create "${pendingParsed?.suggestedRoomName || ""}"`}</Text>
          </TouchableOpacity>
          {knownRooms.length > 0 && (
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker("c-secondary")} disabled={roomConfirmationSaving}>
              <Text style={s.mergeSecondaryBtnText}>Actually, it's an existing Room</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("c-tertiary")} disabled={roomConfirmationSaving}>
            <Text style={s.mergeSecondaryBtnText}>Enter a different name</Text>
          </TouchableOpacity>
        </ScrollView>
        {roomConfirmationSaving && <ProcessingOverlay text={roomConfirmationText} />}
      </SafeAreaView>
    );
  }

  // RESULTS SCREEN (photo, visualization, tiers - "inspiration/vision mode",
  // see DecisionLog.md 2026-07-18 for the split from the Companion screen)
  if (results && !showCompanion) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          {/* TEMP DEBUG: long-press the logo to export the [COMPANION DEBUG] log via the
              share sheet (no Xcode/Mac needed). Remove this onLongPress with the rest of
              the debug instrumentation once the bug is found. */}
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <FreeRoomsBadge isPro={isPro} analyses={analyses} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        {/* Phase B device-fix (§5/§3.h): the prior fix reused this header's
            Menu icon as a silent context-dependent "back" (only its
            accessibilityLabel changed - the visible glyph never did),
            which on-device testing confirmed reads as "menu," not "back."
            Replaced with an explicit, visually distinct bar - its own row
            below the header, not sharing the header's icon slot - shown
            ONLY when Results was reached via Room Detail. Every other
            entry path (first-time analysis, deep link, Home's resumable
            banner) renders nothing here, unchanged. */}
        {resultsCameFromRoomDetail && (
          <TouchableOpacity
            onPress={() => returnToRoomDetail(resultsCameFromRoomDetail)}
            style={{ backgroundColor: BRAND.greenLight, borderBottomWidth: 1, borderBottomColor: BRAND.greenMid, paddingVertical: 10, paddingHorizontal: 16 }}
            accessibilityLabel={`Back to ${rooms.find((r) => r.id === resultsCameFromRoomDetail)?.displayName || "Room"}`}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }} numberOfLines={1}>
              {`← ${rooms.find((r) => r.id === resultsCameFromRoomDetail)?.displayName || "Room"}`}
            </Text>
          </TouchableOpacity>
        )}
        <ScrollView style={s.screenScroll} ref={resultsScrollRef} contentContainerStyle={s.scrollContent}>
          <View style={s.resTop}>
            <View style={{ flex: 1 }}>
              {/* Room/area hierarchy fix (2026-08-07): the Room's actual
                  identity is now the primary heading - it was previously a
                  12px eyebrow label beneath a static, non-data-driven
                  "Your Room" heading, which buried the one thing this
                  screen most needs to say. Deliberately stable across
                  every arrival path (first visit or a returning
                  confirmation) - the heading's job is identity (where you
                  are), never context (what the app remembers); that's the
                  welcome-back banner's job below, so the two never say the
                  same thing twice. */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {/* My Rooms -> True Room Grouping, Phase A: the CURRENT
                    Space.displayName (via the already-loaded `rooms` list),
                    not the plan's own historical spaceName - see
                    resolveResultsRoomName's own comment for the fallback
                    contract when the Space isn't loaded (deep link / no My
                    Rooms visit yet this session). */}
                <Text style={s.resRoomName} numberOfLines={1}>{resolveResultsRoomName(results, currentPlanId, rooms)}</Text>
                {/* Reuses the exact same rename bottom sheet as the merge-
                    review cards, History's "Rename" action, and Space
                    Detail's pencil - currentPlanId, not results.id, since
                    a just-analyzed plan may not have an id on `results`
                    yet before it's saved (currentPlanId is only ever set
                    once a real saved plan is being viewed). Prefilled with
                    the same resolved current name as the heading above,
                    not the plan's own historical spaceName. */}
                {currentPlanId && (
                  <TouchableOpacity onPress={() => openRenameSheet(currentPlanId, resolveResultsRoomName(results, currentPlanId, rooms))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Rename this room" accessibilityRole="button">
                    <Pencil size={14} color={BRAND.green} strokeWidth={2.25} />
                  </TouchableOpacity>
                )}
              </View>
              {/* Room-First Identity's area-level identity (Phase C) -
                  descriptive only, shown as a secondary line under the Room
                  name exclusively for a confirmed sub-area; a whole-room
                  plan or one with no areaName shows nothing here at all -
                  no empty line, no placeholder. */}
              {results.areaName && results.areaScope === "sub-area" && (
                <Text style={s.resAreaName} numberOfLines={1}>{results.areaName}</Text>
              )}
            </View>
            <TouchableOpacity style={s.shareBtn} accessibilityLabel="Share your room" accessibilityRole="button" onPress={() => setTimeout(() => {
              Alert.alert(
                "Share Your Room",
                isPro ? "How would you like to share?" : "Upgrade to Pro for a beautiful branded PDF",
                isPro ? [
                  { text: "📄 Share as PDF", onPress: generatePDF },
                  { text: "📝 Share as Text", onPress: shareResults },
                  { text: "Cancel", style: "cancel" },
                ] : [
                  { text: "📝 Share as Text (Free)", onPress: shareResults },
                  { text: "⭐ Upgrade for PDF", onPress: () => setShowPaywall(true) },
                  { text: "Cancel", style: "cancel" },
                ]
              );
            }, 100)}>
              <Ionicons name="share-outline" size={26} color={BRAND.green} />
            </TouchableOpacity>
          </View>
          {/* Remembered Home v1 Step 3, Phase D (RememberedHomeDesign.md
              §4): the first-5-seconds/first-30-seconds beats, combined into
              one banner rather than staged across timed screens - see
              justConfirmedRecognition's own declaration. Reinforces what
              the proposal card already showed a moment earlier, doesn't
              repeat a data dump. Only ever shown once, right after
              confirming - cleared by every navigation helper. */}
          {justConfirmedRecognition && (
            justConfirmedRecognition.unresolvedCount > 0 ? (
              // Actionable: tapping the whole card enters Companion on
              // TODAY's just-created plan (results/currentPlanId - already
              // set to it by savePlanToHistory inside completeRoomConfirmation,
              // not the prior historical plan, which the convergence
              // contract keeps untouched). Same entry mechanism as the
              // "Let's Get Started" button below - not a separate Companion
              // launch path. The carried-forward items already lead
              // results.currentBatch.items (carryForwardUnresolvedItems
              // prepends them) by the time this is tappable, so they render
              // first with no extra wiring here.
              <TouchableOpacity
                onPress={() => {
                  setShowCompanion(true);
                  setCompanionEnteredFromResults(true);
                  setTimeout(() => companionScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
                }}
                style={{ backgroundColor: "#F0FBF6", borderRadius: 12, borderWidth: 1, borderColor: "#CDEFDD", padding: 14, marginBottom: 14 }}
                accessibilityLabel="Continue where you left off"
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink, marginBottom: 4 }}>{`Welcome back to your ${justConfirmedRecognition.displayName}.`}</Text>
                <Text style={{ fontSize: 13, color: "#64748B", marginBottom: 6 }}>{`You had ${justConfirmedRecognition.unresolvedCount} item${justConfirmedRecognition.unresolvedCount === 1 ? "" : "s"} left to do.`}</Text>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Continue where you left off →</Text>
              </TouchableOpacity>
            ) : (
              // Quiet: recognition still acknowledged, but nothing to act
              // on - not tappable, no arrow, no CTA (a dead tap target is
              // worse than no card at all).
              <View style={{ backgroundColor: "#F0FBF6", borderRadius: 12, borderWidth: 1, borderColor: "#CDEFDD", padding: 14, marginBottom: 14 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink, marginBottom: 4 }}>{`Welcome back to your ${justConfirmedRecognition.displayName}.`}</Text>
                <Text style={{ fontSize: 13, color: "#64748B" }}>Everything from your last visit is wrapped up.</Text>
              </View>
            )
          )}
          {results.photoUrl && (
            // Same photoUrl source as the History list thumbnails and the
            // (now-deactivated) Space Detail screen - not a separate field.
            // Reuses the existing vizModal full-screen viewer (pinch-zoom,
            // close button) already used for AI visualization images below,
            // rather than building a second modal pattern.
            <TouchableOpacity
              onPress={() => { setVizModal(results.photoUrl); setVizModalKey(k => k + 1); }}
              activeOpacity={0.9}
              accessibilityLabel="View original photo full screen"
              accessibilityRole="button"
            >
              <Image source={{ uri: results.photoUrl }} style={s.resPhoto} resizeMode="cover" />
              <Text style={s.resPhotoHint}>Tap photo to view full screen</Text>
            </TouchableOpacity>
          )}
          {/* Approach Card Redesign, item 1: the overview card previously
              had no heading at all, so the user met a wall of AI prose
              before reaching the approach choices with no idea what it
              was. Named rather than styled-away because the block is
              genuinely useful - it just needed to say what it is. Applies
              to old- and new-format plans alike; the overview itself is
              schema-independent. */}
          <Text style={s.resSectionHeading}>What we noticed</Text>
          <View style={s.overviewCard}>
            <Text style={s.overviewText}>{results.overview}</Text>
          </View>
          {results.tiers?.map(t => {
            const m = meta(t.id);
            return (
              // Two badges used to sit in this header: "Best Match", driven by
              // the retired budget field, and "Your Choice", driven by the
              // retired tier pills. With the selector gone the first could
              // never render and the second would have claimed every old
              // plan chose Mid-Range, which the user never did. The tier
              // card itself - label, range, suggestions, products - is
              // untouched.
              <View key={t.id} style={[s.tcard, { borderColor: m.border }]}>
                <View style={[s.tcardHead, { borderBottomColor: m.border }]}>
                  <m.icon size={18} color={m.color} strokeWidth={2.25} />
                  <View style={[s.tcardPill, { backgroundColor: m.bg, borderColor: m.border }]}>
                    <Text style={[s.tcardPillText, { color: m.color }]}>{t.label}</Text>
                  </View>
                  <Text style={s.tcardRange}>{t.range}</Text>
                </View>
                {t.suggestions?.map((sug, i) => (
                  <View key={i} style={s.step}>
                    <View style={[s.stepChk, { backgroundColor: m.bg }]}>
                      <Text style={[s.stepChkText, { color: m.color }]}>✓</Text>
                    </View>
                    <Text style={s.stepText}>{sug}</Text>
                  </View>
                ))}
                <Text style={s.prodLabel}>SUGGESTED PRODUCTS</Text>
                {t.products?.map((p, i) => (
                  <TouchableOpacity key={i} style={s.prodRow} onPress={() => {
                    // Pre-approach plans: no approachId, no grounding, no
                    // problem ids - only a name and a stored searchQuery.
                    // Same resolver, thinner context, same resolution shape.
                    const resolution = resolveProductDestination(
                      { productType: p.name, searchTerms: p.searchQuery },
                      { problemsFound: results.problemsFound, roomName: resolveResultsRoomName(results, currentPlanId, rooms), scopeSize: results.scopeSize || null }
                    );
                    logEvent(getAnalytics(), "recommendation_tapped", {
                      productType: p.name || null,
                      approachId: null,
                      relatedProblemIds: null,
                      resolverKind: resolution.resolverKind,
                      queryUsed: resolution.queryUsed,
                    });
                    openResolvedProduct(resolution);
                  }}>
                    <View style={[s.prodIco, { backgroundColor: m.bg }]}>
                      <Text style={{ fontSize: 14 }}>{p.icon}</Text>
                    </View>
                    <Text style={s.prodName}>{p.name}</Text>
                    <Text style={[s.prodPrice, { color: m.color }]}>{p.price}</Text>
                    <ChevronRight size={16} color={BRAND.mist} strokeWidth={2.25} style={{ marginLeft: 2 }} />
                  </TouchableOpacity>
                ))}

                {/* AI Visualization */}
                {vizImage[t.id] ? (
                  <View style={{ marginTop: 14 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Sparkles size={14} color={m.color} strokeWidth={2.25} />
                      <Text style={s.prodLabel}>YOUR SPACE VISUALIZED</Text>
                    </View>
                    <TouchableOpacity onPress={() => { setVizModal(vizImage[t.id]); setVizModalKey(k => k + 1); }} activeOpacity={0.9}>
                      <Image source={{ uri: vizImage[t.id] }} style={s.vizImage} resizeMode="cover" />
                      <Text style={{ fontSize: 11, color: BRAND.mist, textAlign: "center", marginTop: 6, fontFamily: "Inter_400Regular" }}>Tap to view full screen</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[s.vizBtn, { borderColor: m.color }]}
                    onPress={() => generateVisualization(t)}
                    disabled={vizLoading[t.id]}
                  >
                    {vizLoading[t.id] ? (
                      <View style={{ alignItems: "center", gap: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <ActivityIndicator color={m.color} size="small" />
                          <Text style={[s.vizBtnText, { color: m.color }]}>Creating your transformation...</Text>
                        </View>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", paddingHorizontal: 8 }}>{VIZ_TIPS[vizTipIndex]}</Text>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ fontSize: 16 }}>🎨</Text>
                        <Text style={[s.vizBtnText, { color: m.color }]}>See the transformation{!isPro ? " ⭐ PRO" : ""}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
          {/* Approach Selection Phase B (ApproachSelectionDesign.md Section
              4). Only renders for a new-format plan (results.approaches
              present) that hasn't been started yet (no batchItems - once
              "Start This Plan" succeeds, or a started plan is reopened,
              the currentBatch-driven "Let's Get Started" button below takes
              over instead). Old-format plans keep rendering the unmodified
              tier cards above, completely untouched. */}
          {results.approaches && (() => {
          // Two-Stage Analysis (§6). Resolved once for the whole section:
          // "summary-ready" means Call 2 is still outstanding, and every
          // plan written before the split resolves to "complete", which is
          // what keeps old plans rendering exactly as they did.
          const stage = planAnalysisStage(results);
          return (
            <View style={{ marginTop: 20 }}>
              {/* Item 5: once an approach is committed, the section stops
                  asking a question and starts reporting an answer. The
                  other cards stay present and expandable for reference -
                  the user can still read what they didn't pick.
                  "Change approach" is now live (Section 6). It is hidden in
                  state 4: once the visit is finished the approach is
                  history, and a new one is chosen by starting a fresh
                  visit rather than by rewriting a closed one. */}
              {results.selectedApproach ? (
                <View style={s.approachChosenRow}>
                  <Text style={s.approachChosenText} numberOfLines={1}>
                    {switchPickerOpen
                      ? "Choose a different approach"
                      : `Your approach: ${APPROACH_META[results.selectedApproach]?.name || results.selectedApproach}`}
                  </Text>
                  {approachSwitchState() !== "state4" && (
                  <TouchableOpacity
                    onPress={() => setSwitchPickerOpen((v) => !v)}
                    accessibilityLabel={switchPickerOpen ? "Cancel changing approach" : "Change approach"}
                    accessibilityRole="button"
                    style={{ paddingVertical: 4, paddingLeft: 10 }}
                  >
                    <Text style={s.approachChangeLink}>{switchPickerOpen ? "Cancel" : "Change approach"}</Text>
                  </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={s.sectionLabel}>HOW WOULD YOU LIKE TO APPROACH THIS?</Text>
              )}
              {/* State 3 confirmation (Section 6). Deliberately not a modal
                  Alert: the decision needs the three cards visible to
                  browse, so the warning sits above them and selecting a
                  different card IS the confirmation. Tapping the current
                  card, or Cancel, dismisses without changing anything. */}
              {switchPickerOpen && approachSwitchState() === "state3" && (
                <View style={{ backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FDE68A", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 6 }}>Change approach?</Text>
                  <Text style={{ fontSize: 13, color: "#B45309", lineHeight: 19 }}>
                    Your completed work will stay in your history. Unfinished tasks from your current approach will be replaced with the new approach's plan.
                  </Text>
                </View>
              )}
              {APPROACH_ORDER.map((id) => {
                const a = results.approaches?.[id];
                if (!a) return null;
                const meta = APPROACH_META[id];
                const expanded = previewApproach === id;
                // Item 2: the collapsed card has to carry enough to compare
                // all three WITHOUT expanding any of them - name, spend,
                // strategy, keyChanges, and a product-type preview. The
                // previous card showed only name/spend/strategy plus a bare
                // chevron, which made expansion mandatory just to find out
                // what an approach actually changed.
                const keyChanges = (a.keyChanges || []).filter((k) => typeof k === "string" && k.trim()).slice(0, 4);
                const products = a.productRecommendations || [];
                // Product TYPES only, never a shop affordance - item 6 is
                // explicit that shopping lives solely in the expanded
                // card's full product rows. This line is informational.
                // Results Polish item 2: short core nouns, deduped - two
                // recommendations reducing to the same noun ("floating
                // shelf", "niche shelf") would otherwise read as
                // "shelf · shelf". Order preserved.
                // Two-Stage Analysis: at summary-ready there are no product
                // objects yet, only Call 1's suggestedAdditionTypes. The
                // collapsed card must read identically in both stages -
                // that is the whole promise of showing Results early - so
                // the preview falls back to the type list and runs it
                // through the same shortening and dedupe.
                const additionsSource = products.length
                  ? products.map((p) => p.productType)
                  : (a.suggestedAdditionTypes || []);
                const additionsPreview = [...new Set(
                  additionsSource.map((t) => shortProductNoun(t)).filter(Boolean)
                )].join(" · ");
                // Section 5 (future service-referral extensibility): an
                // ordered list of recommendation groups, not a single
                // hardcoded productRecommendations.map(...) call. Today
                // there is exactly one group (products); a future
                // serviceRecommendations array joins this list as a second
                // group with kind: "service" without any change to the
                // card layout below - only a new branch in the per-item
                // renderer, same pattern as the existing "product" branch.
                // Product Grounding schema: normalized once here so every
                // consumer below (the collapsed additions preview and the
                // expanded product rows alike) sees relatedProblemIds as an
                // array and grounding as string-or-null, whether the plan
                // was written before or after the schema change.
                const recommendationGroups = [
                  { kind: "product", items: (a.productRecommendations || []).map(normalizeProductRecommendation).filter(Boolean) },
                ].filter(g => g.items.length > 0);
                return (
                  <View key={id} style={[s.approachCard, { borderColor: expanded ? meta.color : BRAND.stone }, expanded && { borderWidth: 2 }]}>
                    {/* Item 3: tapping is expand/collapse ONLY - never a
                        selection, never a Firestore write. Toggling to null
                        on a second tap is what makes "read it, close it,
                        open the next one" work; setting a different id
                        collapses the current card implicitly, since exactly
                        one id can equal previewApproach at a time. */}
                    <TouchableOpacity
                      onPress={() => setPreviewApproach((prev) => (prev === id ? null : id))}
                      activeOpacity={0.8}
                      accessibilityLabel={meta.name}
                      accessibilityState={{ expanded }}
                      accessibilityRole="button"
                    >
                      <View style={s.approachCardHead}>
                        <View style={[s.approachPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
                          <Text style={[s.approachPillText, { color: meta.color }]}>{meta.name}</Text>
                        </View>
                        {/* Which one is in effect, marked on the card
                            itself rather than only in the heading, so it is
                            still answerable while browsing the others. */}
                        {results.selectedApproach === id && (
                          <View style={{ backgroundColor: meta.color, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 9, marginLeft: 6 }}>
                            <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "white", letterSpacing: 0.3 }}>CURRENT</Text>
                          </View>
                        )}
                        {/* Results Polish item 1: the estimated spend range
                            is deliberately NOT rendered. The deterministic
                            scope x approach table (SCOPE_SPEND_TABLE) still
                            runs and estimatedSpendRange is still persisted
                            on every plan - the number isn't architecturally
                            wrong, it's just disconnected from the actual
                            recommendations until Product Intelligence can
                            derive it from real product data. Display only;
                            nothing about how it's computed or stored
                            changed, so restoring this is a one-line
                            revert. */}
                      </View>
                      <Text style={s.approachStrategy}>{a.strategyDescription}</Text>
                      {keyChanges.length > 0 && (
                        <View style={{ marginTop: 10 }}>
                          {keyChanges.map((k, i) => (
                            <View key={i} style={s.approachChangeRow}>
                              <View style={[s.approachChangeDot, { backgroundColor: meta.color }]} />
                              <Text style={s.approachChangeText}>{k}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {/* Results Polish items 2 and 3. No numberOfLines
                          cap: the line wraps rather than truncating with an
                          ellipsis, since a clipped "decorative tray for cab…"
                          is strictly worse than a second line. Shortening
                          (shortProductNoun) makes wrapping rare; wrapping
                          makes the remaining long cases readable.

                          An approach with no products now SAYS so, rather
                          than silently dropping the line - "Uses what you
                          already have" reads as a deliberate property of
                          that approach (which for "Keep It Simple" it
                          usually is), where an absent line read as
                          incomplete data. */}
                      {additionsPreview ? (
                        <Text style={s.approachAdditions}>
                          <Text style={s.approachAdditionsLabel}>Suggested additions: </Text>
                          {additionsPreview}
                        </Text>
                      ) : (
                        <Text style={[s.approachAdditions, s.approachAdditionsLabel]}>Uses what you already have</Text>
                      )}
                      {/* Replaces the bare chevron: a worded affordance
                          that says what tapping does and which way it goes,
                          rather than leaving a mystery arrow as the only
                          clue that more content exists (item 2). */}
                      <View style={s.approachToggleRow}>
                        <Text style={[s.approachToggleText, { color: meta.color }]}>
                          {expanded ? "Show less" : "See full details"}
                        </Text>
                        <ChevronRight
                          size={14}
                          color={meta.color}
                          strokeWidth={2.5}
                          style={{ transform: [{ rotate: expanded ? "-90deg" : "90deg" }] }}
                        />
                      </View>
                    </TouchableOpacity>
                    {expanded && stage === "summary-ready" && (
                      /* Two-Stage Analysis, state 1 (§6). The collapsed card
                         above is already complete and correct; only the
                         detail is outstanding, so this replaces the inside
                         of the card and nothing else. Two sub-states: still
                         working, or failed and retryable. */
                      <View style={s.approachExpanded}>
                        {detailError ? (
                          <TouchableOpacity
                            onPress={() => runDetailCall(currentPlanId, results, { isRetry: true })}
                            style={{ paddingVertical: 14, alignItems: "center" }}
                            accessibilityLabel="Retry loading the full details"
                            accessibilityRole="button"
                          >
                            <Text style={{ fontSize: 14, color: "#64748B", textAlign: "center", marginBottom: 6 }}>
                              Couldn't load full details.
                            </Text>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: meta.color }}>Tap to retry</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 }}>
                            <ActivityIndicator size="small" color={meta.color} />
                            <Text style={{ fontSize: 14, color: "#64748B" }}>Finishing the details...</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {expanded && stage !== "summary-ready" && (
                      <View style={s.approachExpanded}>
                        {(a.organizingGuidance || []).length > 0 && (
                          <>
                            <Text style={s.prodLabel}>ORGANIZING GUIDANCE</Text>
                            {a.organizingGuidance.map((g, i) => (
                              <View key={i} style={s.step}>
                                <View style={[s.stepChk, { backgroundColor: meta.bg }]}>
                                  <Text style={[s.stepChkText, { color: meta.color }]}>✓</Text>
                                </View>
                                <Text style={s.stepText}>{g}</Text>
                              </View>
                            ))}
                          </>
                        )}
                        {recommendationGroups.length > 0 && (
                          <>
                            <Text style={s.prodLabel}>PRODUCT RECOMMENDATIONS</Text>
                            {recommendationGroups.flatMap((group) => group.items.map((item, i) => {
                              if (group.kind !== "product") return null;
                              const Icon = getProductCategoryIcon(item.icon);
                              // Call 2's own shortReason wins when present.
                              // shortDisplayReason stays as the fallback for
                              // plans written before the field existed and for
                              // summary-ready plans whose Call 2 has not landed
                              // yet - both are normal states, not errors. The
                              // length guard is defensive only: the prompt asks
                              // for 5-9 words, and if a response ever overruns
                              // it the same complete-thought trimmer tidies it
                              // rather than letting it wrap the card.
                              const modelShort = item.shortReason && item.shortReason.length <= 45 ? item.shortReason : null;
                              const shortReason = modelShort
                                || shortDisplayReason(item.shortReason || resolveRecommendationReason(item, results.problemsFound));
                              return (
                                <TouchableOpacity
                                  key={`${group.kind}-${i}`}
                                  style={s.recCard}
                                  onPress={() => {
                                    const resolution = resolveProductDestination(item, {
                                      approachId: id,
                                      problemsFound: results.problemsFound,
                                      roomName: resolveResultsRoomName(results, currentPlanId, rooms),
                                      areaName: results.areaName || results.suggestedAreaName || null,
                                      scopeSize: results.scopeSize || null,
                                      strategyDescription: a.strategyDescription || null,
                                    });
                                    // Recommendation analytics: about the
                                    // recommendation the user acted on.
                                    // Kept separate from the affiliate
                                    // handoff event fired inside
                                    // openResolvedProduct.
                                    logEvent(getAnalytics(), "recommendation_tapped", {
                                      productType: item.productType || null,
                                      approachId: id,
                                      relatedProblemIds: (item.relatedProblemIds || []).join(",") || null,
                                      resolverKind: resolution.resolverKind,
                                      queryUsed: resolution.queryUsed,
                                    });
                                    openResolvedProduct(resolution);
                                  }}
                                  accessibilityLabel={`Find options for ${displayProductName(item.productType) || item.productType}`}
                                  accessibilityRole="button"
                                >
                                  {/* THE THUMBNAIL SLOT. Fixed 48x48 with
                                      overflow hidden, so swapping this icon
                                      for a real product image later is a
                                      one-element change inside this box and
                                      needs no layout change anywhere else -
                                      the row height is already driven by the
                                      text column, not by this tile. */}
                                  <View style={[s.recIcon, { backgroundColor: meta.bg }]}>
                                    <Icon size={30} color={meta.color} strokeWidth={2} />
                                  </View>
                                  <View style={s.recBody}>
                                    {/* Short display name. item.productType is
                                        untouched in the data and is still what
                                        resolveProductDestination builds the
                                        search query from - this is only what
                                        the card shows. Falls back to the raw
                                        type if shortening yields nothing. */}
                                    <Text style={s.recName} numberOfLines={1}>
                                      {displayProductName(item.productType) || item.productType}
                                    </Text>
                                    {/* Product Grounding schema: an optional
                                        enhancement explains itself with its
                                        own grounding evidence; a
                                        problem-solving recommendation
                                        explains itself with the problem(s)
                                        it is linked to. `reason` remains the
                                        fallback and is all a pre-schema plan
                                        has. See resolveRecommendationReason.
                                        shortDisplayReason then trims that to
                                        one line for the card - a pure display
                                        transform, no AI call, and the full
                                        text stays in the plan document. */}
                                    {/* No numberOfLines here, deliberately.
                                        shortDisplayReason has already capped
                                        this at 45 chars on a word boundary,
                                        backing off to a complete thought - and
                                        the text column is narrower than that
                                        budget assumed once the 48px icon and
                                        padding are subtracted, so RN's own
                                        tail-clipping was re-adding the very
                                        "..." the word-boundary trimming exists
                                        to avoid. Wrapping to a second line on a
                                        narrow screen is the better failure. */}
                                    {shortReason ? (
                                      <Text style={s.recReason}>{shortReason}</Text>
                                    ) : null}
                                    {/* Results Polish item 4: "Shop options"
                                        overpromised - what actually happens is
                                        an Amazon search built from generic
                                        searchTerms, not a curated shopping
                                        surface. "Find options" describes that
                                        honestly until real product
                                        intelligence exists. */}
                                    <Text style={s.recLink}>Find options →</Text>
                                  </View>
                                </TouchableOpacity>
                              );
                            }))}
                          </>
                        )}
                        {/* Approach-Aware Visualization: each approach owns
                            its own image, keyed by approach id, so
                            generating Polished leaves Simple and Elevated
                            untouched and all three can coexist. Placed
                            below the recommendations and above the
                            commitment button deliberately - it is the last
                            piece of evidence for the decision, not the
                            decision itself. */}
                        {vizImage[id] ? (
                          <View style={{ marginTop: 14 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Sparkles size={14} color={meta.color} strokeWidth={2.25} />
                              <Text style={s.prodLabel}>{`${meta.name.toUpperCase()} VISUALIZED`}</Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => { setVizModal(vizImage[id]); setVizModalKey(k => k + 1); }}
                              activeOpacity={0.9}
                              accessibilityLabel={`View the ${meta.name} transformation full screen`}
                              accessibilityRole="button"
                            >
                              <Image source={{ uri: vizImage[id] }} style={s.vizImage} resizeMode="cover" />
                              <Text style={{ fontSize: 11, color: BRAND.mist, textAlign: "center", marginTop: 6, fontFamily: "Inter_400Regular" }}>Tap to view full screen</Text>
                            </TouchableOpacity>
                            {/* Regeneration (§1/§2). The EXISTING thumbnail
                                above stays mounted and visible throughout -
                                this is the loading treatment placed BESIDE
                                it, never in place of it, which is what makes
                                "never lose the known-good visualization"
                                true in the UI as well as in the data.
                                Pro-gated by omission: a non-Pro user has no
                                visualization here to regenerate, and the
                                link is inside this branch. */}
                            {vizLoading[id] ? (
                              <View style={{ alignItems: "center", gap: 6, paddingVertical: 10 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <ActivityIndicator size="small" color={meta.color} />
                                  <Text style={{ fontSize: 13, color: meta.color, fontFamily: "Inter_600SemiBold" }}>Creating your transformation...</Text>
                                </View>
                                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", paddingHorizontal: 8 }}>{VIZ_TIPS[vizTipIndex]}</Text>
                              </View>
                            ) : vizError[id] ? (
                              <TouchableOpacity
                                onPress={() => generateVisualization({ approachId: id, approach: a }, { isRegeneration: true })}
                                style={{ alignItems: "center", paddingVertical: 10 }}
                                accessibilityLabel="Retry regenerating this visualization"
                                accessibilityRole="button"
                              >
                                <Text style={{ fontSize: 12, color: "#B91C1C", textAlign: "center" }}>{vizError[id]}</Text>
                              </TouchableOpacity>
                            ) : isPro ? (
                              <TouchableOpacity
                                onPress={() => generateVisualization({ approachId: id, approach: a }, { isRegeneration: true })}
                                style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 }}
                                accessibilityLabel={`Regenerate the ${meta.name} visualization`}
                                accessibilityRole="button"
                              >
                                <RefreshCw size={13} color={BRAND.slate} strokeWidth={2.25} />
                                <Text style={{ fontSize: 13, color: BRAND.slate, fontFamily: "Inter_400Regular" }}>Regenerate visualization</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[s.vizBtn, { borderColor: meta.color }]}
                            onPress={() => generateVisualization({ approachId: id, approach: a })}
                            disabled={vizLoading[id]}
                            accessibilityLabel={`See the ${meta.name} transformation${!isPro ? ", Pro feature" : ""}`}
                            accessibilityRole="button"
                          >
                            {vizLoading[id] ? (
                              <View style={{ alignItems: "center", gap: 8 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <ActivityIndicator color={meta.color} size="small" />
                                  <Text style={[s.vizBtnText, { color: meta.color }]}>Creating your transformation...</Text>
                                </View>
                                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", paddingHorizontal: 8 }}>{VIZ_TIPS[vizTipIndex]}</Text>
                              </View>
                            ) : (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                <Text style={{ fontSize: 16 }}>🎨</Text>
                                <Text style={[s.vizBtnText, { color: meta.color }]}>See the transformation{!isPro ? " ⭐ PRO" : ""}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        )}
                        {/* Item 4: THE single commitment action, and it
                            lives inside the card it commits to. The old
                            layout put one shared "Start This Plan →" below
                            all three cards, which meant the button was
                            frequently off-screen at the moment the user had
                            just decided - and, being shared, it never named
                            what it was starting. Naming the approach is
                            what makes it unambiguous that expanding is
                            browsing and this is the decision.
                            Rendered only for a plan with nothing committed
                            yet: after commitment the section is a record,
                            not a chooser, and re-committing is "Change
                            approach"'s job (a later phase). */}
                        {!results.selectedApproach && (
                          <TouchableOpacity
                            style={[s.approachStartBtn, { backgroundColor: startingPlan ? BRAND.stone : BRAND.green }]}
                            onPress={handleStartThisPlan}
                            disabled={startingPlan}
                            accessibilityLabel={`Start with ${meta.name}`}
                            accessibilityRole="button"
                          >
                            <Text style={s.approachStartBtnText}>
                              {startingPlan ? "Starting..." : `Start with ${meta.name} →`}
                            </Text>
                          </TouchableOpacity>
                        )}
                        {/* The same button becomes the switch action once
                            the chooser is open, on the cards that are not
                            already current. Selecting IS the confirmation -
                            the warning above the cards has already been
                            read by then in state 3. */}
                        {switchPickerOpen && results.selectedApproach && results.selectedApproach !== id && (
                          <TouchableOpacity
                            style={[s.approachStartBtn, { backgroundColor: switchingApproach ? BRAND.stone : meta.color }]}
                            onPress={() => switchApproach(id)}
                            disabled={!!switchingApproach}
                            accessibilityLabel={`Switch to ${meta.name}`}
                            accessibilityRole="button"
                          >
                            <Text style={s.approachStartBtnText}>
                              {switchingApproach === id ? "Switching..." : `Switch to ${meta.name} →`}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
          })()}
          {results.proTip && (
            <View style={s.tipBox}>
              <Text style={{ fontSize: 20 }}>✅</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.tipHead}>PRO TIP</Text>
                <Text style={s.tipBody}>{results.proTip}</Text>
              </View>
            </View>
          )}
          {batchItems.length > 0 && (
            <TouchableOpacity style={[s.companionBtn, { marginTop: 20 }]} onPress={() => {
              setShowCompanion(true);
              setCompanionEnteredFromResults(true);
              // Companion's ScrollView doesn't exist yet at the moment of this
              // tap (it mounts fresh once showCompanion flips) - same deferred
              // pattern already used for analyze()'s scroll-to-top via
              // resultsScrollRef, not a workaround unique to this button.
              setTimeout(() => companionScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
            }}>
              <Text style={s.companionBtnText}>Let's Get Started</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.startOverBtn} onPress={reset}>
            <Text style={s.startOverText}>Analyze Another Area</Text>
          </TouchableOpacity>
        </ScrollView>
        {/* Rendered as a SIBLING of the ScrollView, not inside it. A <Modal>
            in a scroll content container is a layout hazard: this one wraps a
            GestureHandlerRootView with flex:1, and inside a flexGrow content
            container that inflates the scrollable area, so the screen could be
            dragged past its real content into blank space. My Rooms and Room
            Detail already call this the same way; Results was the odd one out. */}
        {renderPhotoZoomModal()}
        {renderRenameSheet()}
        {/* Shared processing overlay for PDF export and the restore actions.
            Same component every other flow uses. */}
        {asyncBusyText && <ProcessingOverlay text={asyncBusyText} />}
      </SafeAreaView>
    );
  }

  // COMPANION SCREEN (checklist, batch loop - "execution mode", split from
  // Results per DecisionLog.md 2026-07-18)
  if (results && showCompanion) {
    // Wrap-up is its own full screen now, not a Modal nested in the
    // Companion ScrollView (DecisionLog.md 2026-07-19) - checked first,
    // same "more specific screen before its parent" pattern already used
    // elsewhere in this file (e.g. History checked before Menu).
    if (unresolvedReview) {
      return (
        <CompanionWrapUp
          items={unresolvedReview.items}
          checkedCount={batchItems.filter(i => i.status === "checked").length}
          source={unresolvedReview.source}
          onResolve={handleWrapUpResolve}
          onCancel={() => setUnresolvedReview(null)}
        />
      );
    }
    dlog(`[COMPANION DEBUG 5] render gate, batchItems: ${batchItems.length} | stage: ${companionStage}`);
    // companionCompletedProject (set the instant the user finishes, this
    // session) takes priority over results.companionComplete (the persisted
    // field, read back on a later resume) since it's always the freshest.
    // The summary replaces CompanionCard the instant companionStage becomes
    // "finished" - handleCompanionChooseFinish sets that directly now
    // (DecisionLog.md 2026-07-19, no intermediate tap) - or the plan is
    // reopened already complete (the [results] effect sets "finished"
    // directly in that case too).
    const projectCompleteData = companionCompletedProject || results.companionComplete || null;
    const showCompletedSummary = companionStage === "finished" && !!projectCompleteData;
    const completedAtValue = projectCompleteData?.completedAt ?? null;
    const completedReasonValue = projectCompleteData?.reason ?? null;
    const completedHeadlineValue = projectCompleteData?.celebrationHeadline ?? null;
    const completedAccomplishmentsValue = projectCompleteData?.accomplishments ?? [];
    const completedTaskCountValue = typeof projectCompleteData?.taskCount === "number" ? projectCompleteData.taskCount : null;
    // Confetti is a one-time "you just did this" moment, not something a
    // returning visit to an already-finished plan should replay -
    // companionCompletedProject only exists for the session that actually
    // just finished; results.companionComplete alone (a reopen) never sets it.
    const justCompletedThisSession = !!companionCompletedProject;
    // Prefer the persisted Storage URLs (always correct for a resumed plan);
    // fall back to the live session's local refs for the instant right after
    // finishing, before those URLs exist on `results` yet.
    const lastProgressPhotoUrl = results.progressPhotos?.length ? results.progressPhotos[results.progressPhotos.length - 1].url : null;
    const completedBeforeUri = results.photoUrl || companionOriginalPhotoRef.current || null;
    const completedCurrentUri = lastProgressPhotoUrl || companionBasePhotoRef.current || null;
    // Navigation UI Consistency audit, item 1: the old ChevronLeft
    // "Back to your room" control always navigated to Results
    // (setShowCompanion(false) - Companion's own render condition is
    // `results && showCompanion`, so clearing showCompanion alone always
    // falls through to Results, never anywhere else) - but that
    // destination is only a place the user actually WAS when Companion
    // was entered via a Results button (companionEnteredFromResults).
    // When arrived via Room Detail's own CTA, the meaningful destination
    // is Room Detail directly (resultsCameFromRoomDetail), same priority
    // order as Results' own back bar. When neither is set (Home's
    // resumable-plan banner, which jumps straight past Results), there is
    // no previously-visited screen to name, so no bar renders at all -
    // matching this file's own "reused icon that silently means something
    // else" lesson from the Results fix: better no affordance than one
    // that can't be labeled honestly.
    const companionBackLabel = resultsCameFromRoomDetail
      ? `← ${rooms.find((r) => r.id === resultsCameFromRoomDetail)?.displayName || "Room"}`
      : companionEnteredFromResults
        ? `← ${resolveResultsRoomName(results, currentPlanId, rooms) || "Back to Plan"}`
        : null;
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          {/* Same logo/title/menu shape as every other top-level screen
              (Results included) - the ChevronLeft that used to live here
              is gone, replaced entirely by the bar below. TEMP DEBUG:
              long-press exports the [COMPANION DEBUG] log via the share
              sheet - remove with the rest of the debug instrumentation
              once the bug is found. */}
          <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <FreeRoomsBadge isPro={isPro} analyses={analyses} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        {companionBackLabel && (
          <TouchableOpacity
            onPress={() => (resultsCameFromRoomDetail ? returnToRoomDetail(resultsCameFromRoomDetail) : setShowCompanion(false))}
            style={{ backgroundColor: BRAND.greenLight, borderBottomWidth: 1, borderBottomColor: BRAND.greenMid, paddingVertical: 10, paddingHorizontal: 16 }}
            accessibilityLabel={companionBackLabel.replace("← ", "Back to ")}
            accessibilityRole="button"
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }} numberOfLines={1}>{companionBackLabel}</Text>
          </TouchableOpacity>
        )}
        <ScrollView style={s.screenScroll} ref={companionScrollRef} contentContainerStyle={s.scrollContent}>
          {!showCompletedSummary && (
            companionStage === "batch-active" ? (
              // Only the checklist stage genuinely needs items to render -
              // every other stage (generating/paywall-prompt/completion-choice)
              // is driven by companionStage alone.
              // completion-choice in particular can legitimately be reached
              // with an empty batchItems: the AI returning no next-batch items
              // is itself the completion signal, not an error state - gating
              // CompanionCard on batchItems.length here silently dropped that
              // stage's UI (and with it, the only path to
              // handleCompanionChooseFinish) whenever that happened.
              batchItems.length > 0 && (
                <BatchChecklist
                  items={batchItems}
                  batchIndex={companionBatchIndex}
                  onToggleItem={toggleBatchItem}
                  onContinue={handleBatchContinueTapped}
                  onPause={handleBatchPauseTapped}
                  onLikeItAsIs={() => handleCompanionChooseFinish("user_override")}
                />
              )
            ) : (
              <CompanionCard
                stage={companionStage}
                tipIndex={companionTipIndex}
                batchIndex={companionBatchIndex}
                completionReason={companionCompletionReason}
                onUpgrade={handleCompanionUpgradeRequest}
                onChooseFinish={handleCompanionChooseFinish}
                onChooseContinue={handleCompanionChooseContinue}
              />
            )
          )}
          {showCompletedSummary && (
            <CompanionCompletedSummary
              completedAt={completedAtValue}
              reason={completedReasonValue}
              headline={completedHeadlineValue}
              accomplishments={completedAccomplishmentsValue}
              taskCount={completedTaskCountValue}
              beforeUri={completedBeforeUri}
              currentUri={completedCurrentUri}
            />
          )}
          <CompanionRevealModal
            visible={companionStage === "reveal"}
            batchIndex={companionBatchIndex}
            beforeUri={companionRevealBefore}
            afterUri={companionRevealAfter}
            visibleChangeText={companionVisibleChange}
            revealReady={companionRevealReady}
            onDismiss={handleCompanionRevealContinue}
          />
        </ScrollView>
        {/* Full-screen overlay, sibling to the ScrollView, not nested inside
            CompanionCompletedSummary's card (DecisionLog.md 2026-07-20).
            ConfettiCanvas (react-native-fast-confetti's internals) sizes
            itself to 100% of its immediate parent, and every physics formula
            in the library scales directly off that measured container
            height - nested inside the content-sized companionCard, the
            confetti was rendering into a few hundred pixels, not the
            screen, which is why three rounds of prop tuning never fixed the
            "looks like rain" symptom. s.confettiOverlay sizes to the actual
            screen/safe-area via this SafeAreaView, not the scrolling card. */}
        {justCompletedThisSession && (
          <View style={s.confettiOverlay} pointerEvents="none">
            <PIConfetti autoplay fadeOutOnEnd gravity={2}>
              <PIConfetti.Origin blastPosition="top-center" count={100} spread={Math.PI} initialSpeed={2} speedVariation={{ min: 0.7, max: 1 }}>
                <PIConfetti.Flake width={8} height={14} radius={2} />
              </PIConfetti.Origin>
            </PIConfetti>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // HOME SCREEN
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={[s.hdr, { alignItems: "flex-start" }]}>
        <TouchableOpacity onPress={goHome} onLongPress={debugShareLog} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
          <DrawerIcon size={54} dark={true} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <TouchableOpacity onPress={goHome} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { if (!isPro && (analyses || 0) >= 3) setShowPaywall(true); }}>
            <FreeRoomsBadge isPro={isPro} analyses={analyses} showUpgrade />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }}>
          <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
        </TouchableOpacity>
      </View>
      {/* Keyboard audit (2026-08-12), kept after the budget field was
          removed: these three props still matter for any future input on
          this screen, and keyboardShouldPersistTaps in particular affects
          every button here, not just text entry. */}
      <ScrollView
        style={s.screenScroll}
        ref={homeScrollRef}
        contentContainerStyle={s.scrollContent}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={s.welcomeText}>Hi, {user.displayName?.split(' ')[0] || "there"}</Text>
        <Text style={s.heroH1}>Turn Clutter{"\n"}Into Calm</Text>
        <Text style={s.heroP}>Take a photo of any space and get personalized recommendations for every budget.{"\n"}Results in seconds.</Text>

        {resumablePlan && (
          <TouchableOpacity style={s.companionResumeBanner} onPress={() => resumeCompanionSession(resumablePlan)}>
            <Sparkles size={18} color={BRAND.green} strokeWidth={2.25} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={s.companionResumeTitle}>Continue Your Session</Text>
              <Text style={s.companionResumeSub} numberOfLines={1}>{getSpaceDisplayName(resumablePlan)}</Text>
            </View>
            <ChevronRight size={18} color={BRAND.green} strokeWidth={2.25} />
          </TouchableOpacity>
        )}

        {/* §12 Migration Part 3, Pass 2 - merge-proposal Home banner
            (MergeProposalDesign.md Section 3). Same visual weight/pattern as
            the resumablePlan banner above. Shown for pending candidates
            only - stale-confirmed candidates are deliberately never
            proactively surfaced (queryMergeCandidatesForBanner no longer
            queries them at all, so pendingMergeCandidates is the only
            count that matters here). Hidden once the user has explicitly
            deferred ("Not Now"/"Not sure yet") this session - merely
            opening and leaving the review screen does not set that flag
            (this pass's explicit test (b)). */}
        {mergeCandidatesLoaded && !mergeBannerDismissedThisSession && pendingMergeCandidates.length > 0 && (
          <TouchableOpacity style={s.companionResumeBanner} onPress={() => setShowMergeReview(true)}>
            <Layers size={18} color={BRAND.green} strokeWidth={2.25} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={s.companionResumeTitle}>Possible Duplicate Rooms</Text>
              <Text style={s.companionResumeSub} numberOfLines={1}>
                {`${pendingMergeCandidates.length} room${pendingMergeCandidates.length === 1 ? "" : "s"} may be the same`}
              </Text>
            </View>
            <ChevronRight size={18} color={BRAND.green} strokeWidth={2.25} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={photo ? s.uploadBoxFilled : s.uploadBox}
          onPress={showPhotoOptions}>
          {photo ? (
            <Image
              source={{ uri: photo.uri }}
              style={{
                width: "100%",
                height: photoSize.width > 1
                  ? Math.round((photoSize.height / photoSize.width) * 360)
                  : 270
              }}
              resizeMode="contain"
              onLoad={(e) => {
                const { width, height } = e.nativeEvent.source;
                setPhotoSize({ width, height });
              }}
            />
          ) : (
            <View style={s.uploadInner}>
              <Camera size={38} color={BRAND.green} strokeWidth={2} style={{ marginBottom: 10 }} />
              <Text style={[s.uploadTitle, { marginBottom: 4 }]}>Start With a Photo</Text>
              <Text style={[s.uploadHint, { marginBottom: 4 }]}>Take a picture of any space</Text>
              <View style={{ alignSelf: "stretch", marginHorizontal: -20 }}>
                <Text style={s.photoHandwritten}>It only takes a few seconds</Text>
              </View>
            </View>
          )}
        </TouchableOpacity>

        <Text style={s.sectionLabel}>WHAT SPACE NEEDS HELP?</Text>
        <View style={s.roomGrid}>
          {[
            { id: "living", label: "Living Room", icon: Sofa },
            { id: "closet", label: "Closet", icon: Shirt },
            { id: "garage", label: "Garage", icon: CarFront },
            { id: "kitchen", label: "Kitchen", icon: UtensilsCrossed },
            { id: "bedroom", label: "Bedroom", icon: BedDouble },
            { id: "office", label: "Home Office", icon: Monitor },
          ].map(room => (
            <TouchableOpacity
              key={room.id}
              style={[s.roomBtn, selectedRoom === room.id && s.roomBtnSel]}
              onPress={() => setSelectedRoom(selectedRoom === room.id ? null : room.id)}>
              <room.icon size={30} color={selectedRoom === room.id ? BRAND.green : "#64748B"} strokeWidth={2.25} style={{ marginBottom: 4 }} />
              <Text style={[s.roomLabel, selectedRoom === room.id && { color: BRAND.green }]}>{room.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.roomNote}>Don't see your space? No problem. Indoors or out, from a single drawer to a whole basement.</Text>

        {err && <View style={[s.errBox, { flexDirection: "row", alignItems: "center", gap: 8 }]}><AlertTriangle size={16} color="#991B1B" strokeWidth={2.25} /><Text style={s.errText}>{err}</Text></View>}

        <TouchableOpacity
          style={[s.ctaBtn, (!photo || loading) && s.ctaDisabled]}
          onPress={analyze} disabled={!photo || loading}>
          {loading
            ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator color="white" />
              <Text style={s.ctaText}>Analyzing…</Text>
            </View>
            : <Text style={s.ctaText}>{photo ? "Generate My Plan" : "Add a Photo to Continue"}</Text>
          }
        </TouchableOpacity>

        {loading && (
          <View style={s.loadingBox}>
            <ActivityIndicator color={BRAND.green} size="large" />
            <Text style={s.loadingMsg}>{LOAD_MESSAGES[loadMsg]}</Text>
            <Text style={s.loadingHint}>This usually takes 10–15 seconds</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );

}

// Soft update-availability nudge (DecisionLog.md 2026-07-30). Compares the
// installed version (app.config.js's `version`, read via expo-constants)
// against `config/appVersion` in Firestore, per platform. Never blocks
// usage - dismissible, and suppressed for 24h after being shown (which also
// covers "don't reappear this session" as a side effect, since 24h always
// exceeds a single session). Only checked for production builds; staging
// isn't distributed via the App Store/Play Store, so there's nothing
// meaningful to compare against.
// (The former UPDATE_NUDGE_LAST_SHOWN_KEY / _MIN_INTERVAL_MS pair is gone -
// suppression is now the module-level once-per-cold-launch flag next to
// checkForAppUpdate. The AsyncStorage key "lastVersionNudgeShownAt" may still
// exist on devices that ran the old build; it is simply never read again.)
// App Store URLs are keyed by numeric App ID, not bundle identifier - no way
// to derive this at runtime, so it's hardcoded here. Must match eas.json's
// submit.production.ios.ascAppId if that ever changes.
const IOS_APP_STORE_URL = "https://apps.apple.com/app/id6781513811";

// Compares two "major.minor.patch"-style version strings (the same shape as
// app.config.js's `version` field). Returns true only if `current` is
// strictly behind `latest` - equal or ahead returns false. No semver
// dependency: both values are always plain dot-separated integers, so a
// small direct comparison is simpler and adds nothing to install.
function isVersionBehind(current, latest) {
  if (!current || !latest) return false;
  const cur = String(current).split(".").map(n => parseInt(n, 10) || 0);
  const lat = String(latest).split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(cur.length, lat.length);
  for (let i = 0; i < len; i++) {
    const c = cur[i] || 0;
    const l = lat[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// Guards "once per cold launch". Module-level, so it resets when the process
// is killed and not before - which is exactly the requested behaviour. It
// replaces the previous 24h AsyncStorage suppression; note that is a
// DELIBERATE LOOSENING, since a user who cold-launches repeatedly in one day
// will now be nudged each time rather than once. Tighten by restoring the
// AsyncStorage floor if that proves annoying.
let updateNudgeShownThisLaunch = false;

async function checkForAppUpdate() {
  // Runs in every environment. It used to be `if (!IS_PRODUCTION) return`,
  // which made the feature untestable: staging already had a config doc set to
  // 9.9.9 specifically to force the prompt, and it could never have fired.
  // Each environment reads its own project's config doc, so staging nudging
  // staging is correct.
  if (updateNudgeShownThisLaunch) return;
  try {
    const snap = await getDoc(doc(db, "config", "appVersion"));
    if (!snap.exists()) return;
    const data = snap.data();

    // Two accepted shapes. `currentVersion` is the single-value form; `ios` /
    // `android` is the original per-platform form, kept because the staging
    // document already uses it and because a store rollout can legitimately
    // land on one platform before the other.
    const latest = data.currentVersion
      || (Platform.OS === "ios" ? data.ios : data.android);

    const current = Constants.expoConfig?.version;
    if (!isVersionBehind(current, latest)) return;

    // Set only once we know we are actually going to show something, so a
    // launch that finds nothing to say does not burn the one-shot.
    updateNudgeShownThisLaunch = true;

    const androidPackage = Constants.expoConfig?.android?.package || "com.mharrison.uncluttrd";
    const storeUrl = Platform.OS === "ios"
      ? IOS_APP_STORE_URL
      : `https://play.google.com/store/apps/details?id=${androidPackage}`;

    // Awaited until a button dismisses it, so this function's promise means
    // "the nudge is finished", not merely "the nudge was asked for". The ATT
    // prompt waits on exactly that - see requestTrackingPermissionWhenClear.
    await new Promise((resolve) => {
      Alert.alert(
        "Update Available",
        data.updateMessage
          || "A new version of Uncluttrd is available. Update for the latest features and improvements.",
        [
          // Never blocking: "Not Now" always dismisses and the user carries on.
          // There is deliberately no forced-update path, and `minimumVersion` in
          // the config document is NOT read here - it is stored for a possible
          // future hard gate, and wiring it in now would quietly turn a nudge
          // into a wall.
          { text: "Not Now", style: "cancel", onPress: resolve },
          { text: "Update Now", onPress: () => { Linking.openURL(storeUrl); resolve(); } },
        ]
      );
    });
  } catch (e) {
    console.log("Update check error:", e.message);
  }
}

// ── META SDK AND APP TRACKING TRANSPARENCY ───────────────────
// PRODUCTION ONLY. Staging binaries carry no Meta App ID (see app.config.js),
// and these packages are required lazily INSIDE the IS_PRODUCTION guard rather
// than imported at the top of the file. That is load-bearing, not style:
// evaluating react-native-fbsdk-next touches every one of its native modules,
// and on Android FBAppEventsLoggerModule.initialize() calls
// AppEventsLogger.newLogger(), which throws when the SDK was never initialised -
// exactly the state of a staging build with no App ID. A static import would
// crash staging on launch.
//
// No activateApp() call: react-native-fbsdk-next 13.4.3 does not expose one.
// App Install and App Launch are logged by Meta's automatic event logging
// (autoLogAppEventsEnabled in app.config.js) once the SDK is initialised.
// No custom or conversion events are logged here.
function startMetaSdk() {
  if (!IS_PRODUCTION) return;
  try {
    require("react-native-fbsdk-next").Settings.initializeSDK();
  } catch (e) {
    console.log("Meta SDK init error:", e.message);
  }
}

// ── ATT TIMING ───────────────────────────────────────────────
// iOS production only. Meta SDK initialisation above never waits on any of it.
//
// WHEN: never during the first production launch. From the second launch on,
// the prompt is requested at startup, and again whenever a plan is completed,
// but only while the system status is still "undetermined" - once the user has
// answered (or the OS has decided), it is never requested again. A first plan
// completed during launch one is therefore answered on launch two.
//
// NOTHING ELSE ON SCREEN: the prompt is only presented after the startup
// "Update Available" check has fully finished (its dialog shown AND dismissed,
// or never needed), with no alert or modal visible, and with the app active.
// Visibility is tracked centrally rather than at the 55 alert and 12 modal call
// sites: Alert.alert is wrapped to count open alerts until a button closes
// them, and <Modal> below is a thin wrapper that counts while visible. Both
// render exactly what they did before. Not covered: overlays that are plain
// Views rather than Modals, and system sheets (share, print, photo picker).
//
// No IDFA is read here. getTrackingPermissionsAsync reads the authorisation
// status only; this code never calls getAdvertisingId.
const TRACKS_OVERLAYS = IS_PRODUCTION && Platform.OS === "ios";
const ATT_LAUNCH_COUNT_KEY = "attProductionLaunchCount";
// How long "nothing visible" must hold before presenting, so a dismissal
// animation or an alert chained from a button press is not raced.
const OVERLAY_SETTLE_MS = 800;

let visibleOverlays = 0;
const overlayListeners = new Set();
function changeVisibleOverlays(delta) {
  visibleOverlays = Math.max(0, visibleOverlays + delta);
  overlayListeners.forEach((listener) => listener());
}

if (TRACKS_OVERLAYS) {
  const presentAlert = Alert.alert;
  Alert.alert = (title, message, buttons, options) => {
    let open = true;
    const close = () => {
      if (open) { open = false; changeVisibleOverlays(-1); }
    };
    // A lone button with no text is what RN itself sends when a caller passes no
    // buttons: iOS still shows its localised default "OK", and the callback now
    // reports the dismissal.
    const source = Array.isArray(buttons) && buttons.length ? buttons : [{}];
    const tracked = source.map((button) => ({
      ...button,
      onPress: (...args) => {
        close();
        return button.onPress ? button.onPress(...args) : undefined;
      },
    }));
    changeVisibleOverlays(1);
    presentAlert.call(Alert, title, message, tracked, options);
  };
}

// Stands in for react-native's Modal throughout this file (imported as
// NativeModal). RN's Modal defaults `visible` to true, so only an explicit
// false counts as hidden.
function Modal(props) {
  const shown = props.visible !== false;
  useEffect(() => {
    if (!TRACKS_OVERLAYS || !shown) return undefined;
    changeVisibleOverlays(1);
    return () => changeVisibleOverlays(-1);
  }, [shown]);
  return <NativeModal {...props} />;
}

function waitUntilNothingIsPresented() {
  return new Promise((resolve) => {
    let timer = null;
    let appStateSub = null;
    const clear = () => visibleOverlays === 0 && AppState.currentState === "active";
    function finish() {
      clearTimeout(timer);
      overlayListeners.delete(check);
      if (appStateSub) appStateSub.remove();
      resolve();
    }
    function check() {
      clearTimeout(timer);
      if (!clear()) return;
      timer = setTimeout(() => { if (clear()) finish(); }, OVERLAY_SETTLE_MS);
    }
    overlayListeners.add(check);
    appStateSub = AppState.addEventListener("change", check);
    check();
  });
}

// Settled by AppRoot once checkForAppUpdate has finished, dialog included.
let settleAppUpdateCheck;
const appUpdateCheckSettled = new Promise((resolve) => { settleAppUpdateCheck = resolve; });

// Null until this launch has been counted. A plan completed before then is
// not eligible, which errs toward not asking.
let productionLaunchNumber = null;
let trackingRequestInFlight = false;

async function requestTrackingPermissionWhenClear() {
  if (!TRACKS_OVERLAYS || trackingRequestInFlight) return;
  if (productionLaunchNumber === null || productionLaunchNumber < 2) return;
  trackingRequestInFlight = true;
  try {
    const tracking = require("expo-tracking-transparency");
    if ((await tracking.getTrackingPermissionsAsync()).status !== "undetermined") return;
    await appUpdateCheckSettled;
    await waitUntilNothingIsPresented();
    // Re-read: the wait can be long, and the answer may have changed meanwhile.
    if ((await tracking.getTrackingPermissionsAsync()).status !== "undetermined") return;
    await tracking.requestTrackingPermissionsAsync();
  } catch (e) {
    console.log("Tracking permission error:", e.message);
  } finally {
    trackingRequestInFlight = false;
  }
}

async function countProductionLaunchForTracking() {
  if (!TRACKS_OVERLAYS) return;
  try {
    const previous = parseInt(await AsyncStorage.getItem(ATT_LAUNCH_COUNT_KEY), 10) || 0;
    productionLaunchNumber = previous + 1;
    await AsyncStorage.setItem(ATT_LAUNCH_COUNT_KEY, String(productionLaunchNumber));
    requestTrackingPermissionWhenClear();
  } catch (e) {
    console.log("Tracking launch count error:", e.message);
  }
}

// ── LAUNCH SCREEN ────────────────────────────────────────────
// The animated screen between the native splash and the first real screen,
// shown once per cold launch (AppRoot mounts once per JS runtime, so coming
// back from the background never shows it again).
//
// HANDOFF. The native splash is held (preventAutoHideAsync, at the top of
// this file) until this screen has laid out, then hidden on the next frame, so
// the switch is between two identical frames: both are LAUNCH_BACKGROUND,
// and on iOS both show the approved logo SPLASH_LOGO_WIDTH points wide,
// centred on the whole screen - exactly where expo-splash-screen's
// storyboard puts it (app.config.js, ios.imageWidth). That is also why the
// logo has no entrance animation: fading it up from zero would first make
// the logo the native splash was already showing disappear. Android's
// native splash shows the U mark alone (Android 12+ masks splash artwork to
// a circle), and the full logo simply replaces it.
//
// ENTRANCE. Timed from the same visible frame (LAUNCH_ANIMATION): the status
// line fades in over 400ms from the handoff, and the dots start pulsing at
// 300ms, 150ms apart. The native splash hides instantly (setOptions above),
// so none of it plays underneath the splash.
//
// EXIT. The screen stays up for at least 1,700ms from the moment it became
// visible (first layout, native splash hidden), so a fast startup still
// shows the status line and the dots moving; once that has passed and
// `ready` is true - whichever comes last - every running animation is
// stopped and the whole screen fades out over 300ms from wherever it is,
// then unmounts - about 2,000ms at the shortest. The minimum never dismisses
// a screen that is not ready, and there is no maximum. The decision lives in
// shared/launchTiming.js (createLaunchExitController), which the tests drive
// with a fake clock.
const LAUNCH_BACKGROUND = "#F8FAF9"; // = expo-splash-screen backgroundColor
const SPLASH_LOGO_WIDTH = 260; // = expo-splash-screen ios.imageWidth
const FULL_LOGO = require("./assets/uncluttrd-logo-full.png");
const FULL_LOGO_ASPECT = 457 / 1798; // the asset's own pixel size - uniform scaling only

// Idempotent: onLayout can fire more than once, and hideAsync rejects if the
// splash is already gone.
let nativeSplashHidden = false;
function hideNativeSplashOnce() {
  if (nativeSplashHidden) return;
  nativeSplashHidden = true;
  SplashScreen.hideAsync().catch(() => {});
}

function LaunchScreen({ ready, onExited }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const logoWidth = Math.min(SPLASH_LOGO_WIDTH, windowWidth - 48);
  const logoHeight = logoWidth * FULL_LOGO_ASPECT;

  // Inter may still be loading (it is half of the readiness gate). Whatever
  // the status line starts in, it keeps, so it never reflows mid-fade.
  const statusFont = useRef(Font.isLoaded("Inter_500Medium") ? "Inter_500Medium" : undefined).current;

  const screenOpacity = useRef(new Animated.Value(1)).current;
  const decorOpacity = useRef(new Animated.Value(0)).current;
  const statusOpacity = useRef(new Animated.Value(0)).current;
  const dots = useRef([0, 1, 2].map(() => ({ opacity: new Animated.Value(0.3), scale: new Animated.Value(1) }))).current;
  const running = useRef([]);
  const exiting = useRef(false);
  const mounted = useRef(true);
  const layoutFrame = useRef(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const [reduceMotion, setReduceMotion] = useState(null); // null until the OS answers
  // Touches stay blocked while the screen is up - including the minimum wait
  // after startup is ready, when the destination is already rendered beneath.
  const [exitStarted, setExitStarted] = useState(false);
  // True from the handoff frame; the entrance is timed from it.
  const [visible, setVisible] = useState(false);

  const stopAll = () => {
    running.current.forEach((a) => a.stop());
    running.current = [];
  };

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) setReduceMotion(!!v); })
      .catch(() => { if (alive) setReduceMotion(false); });
    return () => { alive = false; };
  }, []);

  // Entrance and dot loop: from the handoff frame, once reduced-motion is
  // known, and unless the exit has already begun.
  useEffect(() => {
    if (!visible || reduceMotion === null || exiting.current) return;
    if (reduceMotion) {
      // Final state, no motion: text shown, dots still and fully visible.
      decorOpacity.setValue(1);
      statusOpacity.setValue(1);
      dots.forEach((d) => { d.opacity.setValue(1); d.scale.setValue(1); });
      return;
    }
    const easeOut = Easing.out(Easing.cubic);
    const entrance = Animated.parallel([
      // The native splash has no tints; bringing them up gently keeps the
      // handoff frame identical.
      Animated.timing(decorOpacity, { toValue: 1, duration: 450, easing: easeOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(LAUNCH_ANIMATION.statusFade.delay),
        Animated.timing(statusOpacity, { toValue: 1, duration: LAUNCH_ANIMATION.statusFade.duration, easing: easeOut, useNativeDriver: true }),
      ]),
    ]);
    const pulse = (d, i) => Animated.sequence([
      Animated.delay(LAUNCH_ANIMATION.dots[i].delay),
      Animated.loop(Animated.sequence([
        Animated.parallel([
          Animated.timing(d.opacity, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(d.scale, { toValue: 1.15, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(d.opacity, { toValue: 0.3, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(d.scale, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.delay(200),
      ])),
    ]);
    const all = [entrance, ...dots.map(pulse)];
    running.current = all;
    all.forEach((a) => a.start());
    return stopAll;
  }, [reduceMotion, visible]);

  // Exit once both the 1,700ms minimum and readiness are in - interrupting
  // the entrance if needed. The controller calls beginExit at most once.
  const beginExit = () => {
    if (!mounted.current || exiting.current) return;
    exiting.current = true;
    setExitStarted(true);
    stopAll();
    const fade = Animated.timing(screenOpacity, { toValue: 0, duration: LAUNCH_EXIT_FADE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true });
    running.current = [fade];
    fade.start(({ finished }) => { if (finished && mounted.current) onExitedRef.current(); });
  };
  const exitController = useRef(null);
  if (exitController.current === null) exitController.current = createLaunchExitController({ startExit: beginExit });

  useEffect(() => { exitController.current.setReady(ready); }, [ready]);

  // Visible = laid out and the native splash hidden, on the same frame.
  const handleLayout = () => {
    if (layoutFrame.current !== null || exiting.current) return;
    layoutFrame.current = requestAnimationFrame(() => {
      hideNativeSplashOnce();
      exitController.current.markVisible();
      if (mounted.current) setVisible(true);
    });
  };

  // Unmount: stop every animation, clear the minimum timer and the pending
  // frame, and never leave the native splash up if this screen goes away
  // before it laid out.
  useEffect(() => () => {
    mounted.current = false;
    exitController.current.dispose();
    if (layoutFrame.current !== null) cancelAnimationFrame(layoutFrame.current);
    stopAll();
    hideNativeSplashOnce();
  }, []);

  const statusTop = windowHeight / 2 + logoHeight / 2 + 36;
  const dotColors = [BRAND.green, BRAND.blue, BRAND.ink];
  // Soft corner glows, as in the concept: radial gradients from a faint tint
  // to nothing. react-native-svg is already a dependency.
  const glow = (id, color, peak, cx, cy, r) => (
    <>
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} rx={r} ry={r} fx={cx} fy={cy} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={color} stopOpacity={peak} />
          <Stop offset="0.55" stopColor={color} stopOpacity={peak * 0.45} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width={windowWidth} height={windowHeight} fill={`url(#${id})`} />
    </>
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: LAUNCH_BACKGROUND, opacity: screenOpacity, zIndex: 1000 }]}
      pointerEvents={exitStarted ? "none" : "auto"}
      onLayout={handleLayout}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: decorOpacity }]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Svg width={windowWidth} height={windowHeight}>
          {glow("launchGlowGreen", BRAND.green, 0.1, windowWidth * 0.02, windowHeight * 0.15, windowWidth * 0.72)}
          {glow("launchGlowBlue", BRAND.blue, 0.08, windowWidth * 0.98, windowHeight * 0.87, windowWidth * 0.72)}
        </Svg>
      </Animated.View>

      {/* One accessible element for the whole state; the dots never change
          its label, so the loop does not re-announce. */}
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityLabel="Uncluttrd. Getting things ready"
      >
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="none">
          <Image source={FULL_LOGO} style={{ width: logoWidth, height: logoHeight }} resizeMode="contain" />
        </View>
        <View style={{ position: "absolute", left: 24, right: 24, top: statusTop, alignItems: "center" }} pointerEvents="none">
          <Animated.Text style={{ opacity: statusOpacity, fontSize: 15, color: BRAND.slateText, fontFamily: statusFont, letterSpacing: 0.2 }}>
            Getting things ready...
          </Animated.Text>
          <View style={{ flexDirection: "row", marginTop: 18 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {dots.map((d, i) => (
              <Animated.View key={i} style={{
                width: 8, height: 8, borderRadius: 4, marginHorizontal: 5, backgroundColor: dotColors[i],
                opacity: d.opacity, transform: [{ scale: d.scale }],
              }} />
            ))}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ── ROOT ─────────────────────────────────────────────────────
function AppRoot() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboard, setShowOnboard] = useState(true);
  const [skipPref, setSkipPref] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [analyses, setAnalyses] = useState(null); // null = not loaded yet
  // Lets the RevenueCat listener (registered once, [] deps) attribute later
  // entitlement changes to whichever account is actually signed in right now,
  // without the stale-closure trap a plain `user` reference would have here.
  const currentUidRef = useRef(null);
  // True only once Purchases.logIn(uid) has actually succeeded for the
  // *current* uid. Read imperatively (paywall CTA retry-check), never used
  // to render, so a ref matches currentUidRef's pattern above rather than
  // adding new state threaded through MainApp's props.
  const revenueCatLinkedRef = useRef(false);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    // Initialize RevenueCat. SDK configuration and the ongoing listener are
    // legitimately one-time/global concerns, not per-auth-change ones - the
    // authoritative per-account entitlement fetch lives in onAuthStateChanged
    // below, sequenced after Purchases.logIn() so it reads the right account.
    // The standalone getCustomerInfo() that used to live here was removed -
    // it raced against that authoritative fetch for no benefit and was part
    // of the original leakage risk.
    try {
      // iOS key is APP_ENV-branched the same way firebaseConfig is - production
      // and staging are separate RevenueCat apps (see DecisionLog.md
      // 2026-07-16), each with their own API key, keyed to bundle ID. Without
      // this, a staging build configures against production's app and its
      // entitlement/offering lookups silently fail. Android's key is not yet
      // known to be staging-aware - left as-is, not assumed fixed.
      const iosApiKey = IS_PRODUCTION ? "appl_SIucLbhCtkbSMSuMrhGyxsfWmxx" : "appl_ZHUurKUlRoGySqASsIkNlbnWEDd";
      Purchases.configure({ apiKey: Platform.OS === "android" ? "goog_zsRKzNXkxcdeXQLKducjtXXsJhP" : iosApiKey });

      // Keep Pro status in sync if it changes while the app is open
      // (e.g. a refund processes, or the subscription is restored on another
      // device).
      //
      // LOCAL ONLY - this deliberately does NOT write isPro to Firestore.
      // users/{uid}.isPro is server-owned: the RevenueCat webhook
      // (revenueCatWebhook -> syncProStatus) is its sole writer, and the
      // Firestore rules now reject any client write to it. Writing here
      // would fail permission-denied, and silently, since the old .catch
      // only console.logged.
      //
      // setIsPro/AsyncStorage stay: they give instant in-session feedback
      // the moment a purchase resolves, without waiting on the webhook
      // round trip. They are a UI cache, never an authority - every paid
      // action is checked server-side against RevenueCat
      // (verifyProEntitlement in analyzePhoto and generateVisualization).
      const listener = (customerInfo) => {
        const proActive = !!customerInfo.entitlements.active["Uncluttrd Pro"];
        setIsPro(proActive);
        AsyncStorage.setItem("isPro", proActive ? "true" : "false");
      };
      Purchases.addCustomerInfoUpdateListener(listener);
      return () => Purchases.removeCustomerInfoUpdateListener(listener);
    } catch (e) {
      console.log("RevenueCat init error:", e.message);
    }
  }, []);

  useEffect(() => {
    // One-off test event to confirm the @react-native-firebase/analytics pipeline
    // reaches Firebase end to end, before the real 14 documented events are wired up.
    logEvent(getAnalytics(), "analytics_test")
      .then(() => console.log("analytics_test event sent"))
      .catch(e => console.log("Analytics test event error:", e.message));
  }, []);

  useEffect(() => {
    // Meta SDK first and unconditionally. ATT eligibility is counted separately
    // and never gates it - see startMetaSdk and the ATT TIMING section. Both
    // are no-ops outside production.
    startMetaSdk();
    countProductionLaunchForTracking();
  }, []);

  useEffect(() => {
    // Soft update-availability nudge - see checkForAppUpdate's own comment.
    // Runs once per app launch, independent of auth state (this is a
    // dismissible nudge about the app itself, not account data).
    checkForAppUpdate().finally(settleAppUpdateCheck);
  }, []);

  useEffect(() => {
    // skipOnboarding is intentionally device-scoped, not account-scoped - it's
    // a UI preference ("has this device seen onboarding"), not account data,
    // so it stays a one-time mount load separate from the auth callback below.
    AsyncStorage.getItem("skipOnboarding").then(saved => {
      if (saved === "true") setSkipPref(true);
    });

    const unsub = onAuthStateChanged(auth, async (u) => {
      // Reset account-specific state FIRST, before anything async, so no
      // previous account's isPro/analyses can render even for one frame -
      // this replaces the old mount-only AsyncStorage init(), which is the
      // root cause of both the free-plan count and isPro leaking across
      // accounts signed into the same device.
      setAnalyses(0);
      setIsPro(false);
      revenueCatLinkedRef.current = false;
      currentUidRef.current = u ? u.uid : null;
      if (u) {
        // Right after sign-in (especially the forced signOut/signIn re-auth
        // in handleAuth's signup flow), auth.currentUser can still be a
        // partially-hydrated object - profile fields like displayName can
        // fill in a beat later via the SDK's own background refresh, which
        // mutates this same object in place without firing onAuthStateChanged
        // again. Reloading before setUser() ensures the first render already
        // has the real value, instead of it only self-correcting whenever
        // some unrelated re-render happens to occur later.
        try {
          await u.reload();
        } catch (e) {
          console.log("User reload error:", e.message);
        }

        // Link RevenueCat's identity to this uid BEFORE unlocking the
        // authenticated UI below (setUser/setLoading) - closes a real race
        // where a fast navigator could reach the paywall CTA while
        // RevenueCat was still on its prior/anonymous identity, causing a
        // purchase to be attributed to the wrong RevenueCat customer
        // entirely (confirmed via RevenueCat's REST API after a real
        // sandbox purchase produced no record under the signed-in uid).
        // Bounded so a RevenueCat outage delays launch rather than blocking
        // it forever; if logIn() resolves after the bound, the ref still
        // gets set from .then() below, and the paywall CTA re-checks/
        // retries it anyway as a second layer.
        const loginPromise = Purchases.logIn(u.uid)
          .then(() => { revenueCatLinkedRef.current = true; })
          .catch(() => {});
        await Promise.race([loginPromise, new Promise(resolve => setTimeout(resolve, 8000))]);
      }
      setUser(u);
      setLoading(false);

      if (!u) {
        // Signed out - clear the display cache too, so nothing stale lingers
        // for whoever signs in next before their own data loads.
        await AsyncStorage.removeItem("analysisCount");
        await AsyncStorage.removeItem("isPro");
        return;
      }

      ensureUserDocument(u).catch(e => console.log("Ensure user doc error:", e.message));

      // Load this account's real server-side analysis count. Same
      // month-rollover math as the server (see functions/index.js
      // currentMonthUTC), computed here only for correct initial display -
      // the server remains authoritative on every actual analyzePhoto call.
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? userSnap.data() : {};
        const currentMonth = new Date().toISOString().slice(0, 7);
        const effectiveCount = data.analysisCountMonth === currentMonth ? (data.analysisCount || 0) : 0;
        setAnalyses(effectiveCount);
        await AsyncStorage.setItem("analysisCount", effectiveCount.toString());
        // hasSeenTutorial: Firestore is the source of truth (DecisionLog.md
        // 2026-07-18 - reverses the earlier "intentionally device-scoped"
        // decision now that reinstalls/new devices for an existing account
        // are a real scenario), AsyncStorage stays a fast local cache.
        // One-time backfill (DecisionLog.md 2026-07-18): accounts that
        // existed before hasSeenTutorial was introduced never had the field
        // written at all, so the field-based check alone would wrongly
        // treat them as never onboarded. analysisCount/isPro are both
        // already loaded right here, no extra read - and both are
        // structurally impossible for a genuinely new user to have at their
        // very first onAuthStateChanged, since reaching MainApp (where an
        // analysis or a purchase could happen) requires completing
        // onboarding first. Known, accepted gap: an existing user who never
        // ran an analysis and isn't Pro still sees onboarding once more -
        // narrow and low-stakes enough not to solve.
        const looksLikeExistingUser = (data.analysisCount || 0) > 0 || data.isPro === true;
        if (data.hasSeenTutorial === true || looksLikeExistingUser) {
          setSkipPref(true);
          await AsyncStorage.setItem("skipOnboarding", "true");
          if (data.hasSeenTutorial !== true) {
            updateDoc(doc(db, "users", u.uid), { hasSeenTutorial: true })
              .catch(e => console.log("Backfill hasSeenTutorial error:", e.message));
          }
        }
      } catch (e) {
        console.log("Load analysisCount error:", e.message);
      }

      // Refresh RevenueCat's stored attributes and pull a fresh entitlement
      // read for this account. Identity linking itself (Purchases.logIn)
      // already happened earlier, before setUser() unlocked the UI above -
      // this block just keeps attributes/entitlement current on every auth
      // resolution (cold launch for already-signed-in users, fresh sign-in,
      // and post-signup, where handleAuth forces a sign-out/sign-in to get
      // here with displayName already set).
      try {
        const nameParts = (u.displayName || "").trim().split(" ");
        Purchases.setAttributes({
          "$email": u.email || "",
          "$displayName": u.displayName || "",
          "firstName": nameParts[0] || "",
          "lastName": nameParts.slice(1).join(" "),
        });

        // Fresh entitlement read for THIS account, sequenced after logIn() -
        // calling this any earlier would read whichever account RevenueCat
        // was previously tracking, not the one that just signed in.
        //
        // LOCAL ONLY, same as the customerInfo listener above: seeds the
        // in-session UI from RevenueCat directly so a Pro user sees Pro
        // immediately at launch, without waiting for the Firestore read or
        // the webhook. It does NOT write users/{uid}.isPro - that field is
        // server-owned and client writes to it are rejected by rules.
        const customerInfo = await Purchases.getCustomerInfo();
        const proActive = !!customerInfo.entitlements.active["Uncluttrd Pro"];
        setIsPro(proActive);
        await AsyncStorage.setItem("isPro", proActive ? "true" : "false");
      } catch (e) {
        console.log("RevenueCat setAttributes/getCustomerInfo error:", e.message);
      }
    });
    return unsub;
  }, []);

  // Startup gate: unchanged conditions - Inter loaded, and the first
  // onAuthStateChanged resolved (signed out, or signed in with the user
  // reloaded and RevenueCat linked or its 8s bound reached).
  const startupReady = !loading && fontsLoaded;
  // Cold launch only: AppRoot mounts once per JS runtime.
  const [showLaunch, setShowLaunch] = useState(true);

  let screen;
  if (!startupReady) {
    // Only ever visible if LaunchScreen is gone before startup resolves,
    // which it never is - kept as the plain fallback it always was.
    screen = (
      <SafeAreaView style={[s.safe, { alignItems: "center", justifyContent: "center" }]}>
        <View style={s.hdrMark}><DrawerIcon size={54} dark={true} /></View>
        <Text style={[s.hdrName, { marginTop: 12 }]}>Uncluttrd</Text>
        <ActivityIndicator color={BRAND.green} style={{ marginTop: 20 }} />
      </SafeAreaView>
    );
  } else if (!user) {
    // Not logged in, show auth screen
    screen = <AuthScreen />;
  } else if (showOnboard && !skipPref) {
    // Logged in but hasn't dismissed onboarding, show it
    screen = <OnboardingScreen onDone={async (skip) => {
      if (skip) {
        setSkipPref(true);
        await AsyncStorage.setItem("skipOnboarding", "true");
        // Firestore is the source of truth (DecisionLog.md 2026-07-18) so
        // this syncs to other devices/reinstalls - AsyncStorage above is
        // just the fast local cache for this device's next launch.
        updateDoc(doc(db, "users", user.uid), { hasSeenTutorial: true })
          .catch(e => console.log("Save hasSeenTutorial error:", e.message));
      }
      setShowOnboard(false);
    }} />;
  } else {
    // Logged in and onboarding done, show main app
    screen = <MainApp user={user} isPro={isPro} setIsPro={setIsPro} analyses={analyses} setAnalyses={setAnalyses} setSkipPref={setSkipPref} revenueCatLinkedRef={revenueCatLinkedRef} />;
  }

  // The destination renders underneath from the moment startup is ready, so
  // the launch screen fades out onto the real first screen. Same wrapper and
  // child position throughout, so nothing remounts when the overlay leaves.
  return (
    <View style={{ flex: 1 }}>
      {screen}
      {showLaunch ? <LaunchScreen ready={startupReady} onExited={() => setShowLaunch(false)} /> : null}
    </View>
  );
}

export default function App() {
  return (
    // Required at the app root for react-native-gesture-handler's pan-
    // gesture-based controls (Area row swipe-to-delete's Swipeable) to
    // work reliably everywhere in the tree - previously only wrapped
    // locally around the photo-zoom modal's own pinch-zoom gesture, which
    // doesn't cover Room Detail.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <View style={{ flex: 1 }}>
          <AppRoot />
        </View>
        {/*
          * AN OVERLAY, NOT A ROW. It used to be a normal-flow sibling ABOVE
          * this view, which meant it removed its own height - the top safe-area
          * inset plus its padding, 69-81pt on a notched phone - from every
          * screen in the app. On the twenty-seven screens that scroll that was
          * invisible; on the one that does not, PhotoCropScreen, it pushed
          * "Use Original" off the bottom. Worse, it meant staging was a
          * systematically shorter phone than production, so layout tested here
          * was never quite the layout shipped.
          *
          * Rendered AFTER the content so it paints on top, absolutely
          * positioned so it displaces nothing, and pointerEvents="none" so it
          * cannot take a touch from whatever is beneath it.
          *
          * TOP-RIGHT, and deliberately: the header logo - whose long-press is
          * the debug-log share - is top-LEFT on every screen that has one, so
          * this cannot sit over it. `edges={["top"]}` pushes the pill below the
          * status bar, into the 22pt of padding `s.hdr` leaves above its
          * controls, so on a standard screen it overlaps nothing interactive
          * at all.
          */}
        {IS_STAGING && (
          <SafeAreaView edges={["top"]} pointerEvents="none" style={s.stagingBanner}>
            <Text style={s.stagingBannerText}>STAGING</Text>
          </SafeAreaView>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}


// ---------------------------------------------------------------------------
// DELETE CONFIRMATION COPY
// ---------------------------------------------------------------------------
// One source for all three levels. Previously each handler carried its own
// string, which is how they drifted: two understated the cascade and one
// overstated it. Keeping them here means a Room row swiped from My Rooms and
// the "Delete Room" button inside Room Detail cannot ever say different things
// about the same action.
//
// Each body answers the only two questions that matter at the moment of a
// destructive tap: what ELSE goes with this, and can I get it back.
const DELETE_CONFIRM = {
  room: (name) => ({
    title: `Delete ${name}?`,
    body: "This will also delete all areas and organizing sessions inside it. You can restore it from Recently Deleted within 30 days.",
  }),
  area: (name) => ({
    title: `Delete ${name}?`,
    body: "This will also delete all organizing sessions for this area. You can restore it from Recently Deleted within 30 days.",
  }),
  // A session is a leaf - nothing cascades from it - so this says only what
  // recovery is available, and does not claim to remove "organizing history".
  session: () => ({
    title: "Delete this organizing session?",
    body: "You can restore it from Recently Deleted within 30 days.",
  }),
};

// ---------------------------------------------------------------------------
// SWIPE-TO-DELETE ROW
// ---------------------------------------------------------------------------
// The single gesture implementation, used at all three levels - Room rows in
// My Rooms, Area rows in Room Detail, and visit rows in Earlier Organizing
// Visits. Sharing the component is what makes "all three feel identical"
// structurally true rather than three copies that happen to match today.
//
// The gesture only REVEALS. Nothing here writes: onDelete is handed the row's
// own swipeableMethods and is expected to open a confirmation dialog, which
// owns the actual delete. That separation is the whole safety model.
//
// overshootRight={false} plus a fixed 80px action is deliberate - without it
// Swipeable measures a flex-stretched action and lets the row slide fully off
// screen with no visible way back (see the areaSwipeDeleteAction fix).
function SwipeToDeleteRow({ onDelete, accessibilityLabel, children }) {
  return (
    <Swipeable
      containerStyle={s.areaSwipeContainer}
      overshootRight={false}
      rightThreshold={40}
      renderRightActions={(progress, translation, swipeableMethods) => (
        <TouchableOpacity
          style={s.areaSwipeDeleteAction}
          onPress={() => onDelete(swipeableMethods)}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
        >
          <Trash2 size={22} color="white" strokeWidth={2.25} />
        </TouchableOpacity>
      )}
    >
      {children}
    </Swipeable>
  );
}

// ---------------------------------------------------------------------------
// FREE ROOMS HEADER INDICATOR
// ---------------------------------------------------------------------------
// One component, four call sites. It previously existed as four separate inline
// copies - Home, Results, Companion and the menu drawer - which is how they
// drifted: Home was given the bordered badge treatment and the other three were
// left as plain `hdrTag` text at rgba(255,255,255,0.6). Same string, same data,
// two different designs depending on which screen you were on.
//
// "Four call sites" was aspirational when this was written: the component was
// extracted and then wired into Home and the drawer only, leaving Results and
// Companion on their original inline `hdrTag` line. The drift the extraction
// was meant to end therefore survived it, in the same two places, for the same
// reason - the inline copy is what renders, not the component. Both are now
// converted, so the count is real and there is no inline copy left to drift.
//
// Declared at module level rather than inside MainApp on purpose. A component
// defined inside a render function is a NEW component type on every render, so
// React unmounts and remounts it each time instead of updating it.
//
// `showUpgrade` is Home-only, and deliberately so: only Home wraps this in a
// TouchableOpacity that opens the paywall, so only Home can honestly offer an
// "Upgrade to Pro" affordance. On the other three screens the surrounding tap
// target navigates home, and a button that says Upgrade but goes home is worse
// than no button.
// ---------------------------------------------------------------------------
// PHOTO CROP
// ---------------------------------------------------------------------------
// Free-form crop, shown between the picker and everything downstream.
//
// It sits at the one point where all three entry points - camera, camera roll,
// file browser - converge on setPhoto. Because nothing reads the photo until
// setPhoto has run, analysis, the Storage upload, the plan's photoUrl, My
// Rooms and Room Detail thumbnails, the PDF and the visualization input all
// receive the cropped image without any of them knowing a crop took place.
// Covering those seven consumers by construction rather than by editing seven
// call sites is the entire reason the crop goes here.
//
// expo-image-picker's allowsEditing was already on at these call sites, but
// the editor it opens is the OS one: a forced square on iOS. Rooms are not
// square, which is what this screen is for, so allowsEditing is turned off on
// the three calls that feed it and the full frame arrives here instead.
// It is a SCREEN, not a Modal mounted inside one. The first version rendered
// a <Modal> at the end of the Home screen's return, which meant it could only
// ever appear while Home was the screen being rendered. MainApp returns early
// per screen - thirteen gates ahead of Home - so any photo started while one
// of those was showing set cropSource against a modal that was not mounted,
// and the crop was silently skipped. Making it its own gate ahead of all the
// others means every caller reaches it, whatever screen they came from, and
// there is no second place to remember to mount it.
//
// Dropping the <Modal> wrapper also removes a re-presentation hazard: an iOS
// Modal being unmounted and remounted in quick succession can miss its second
// presentation entirely, which is a strong candidate for the crop appearing
// once and then not again.
const CROP_MIN = 72;      // smallest crop side, in fitted-image px - two
                          // corner handles wide, so they meet but never
                          // overlap. Edge midpoints hide before that point
                          // rather than forcing a larger minimum on everyone.
const CROP_HANDLE = 34;   // corner touch target
const CROP_EDGE = 30;     // edge-midpoint touch target
const CROP_ZOOM_MAX = 4;
const CROP_BAR = 4;       // bracket arm thickness - the old border width, kept

// HOW MANY FINGERS ARE DOWN, without assuming the event says so.
//
// Android does not always populate `nativeEvent.touches`; on the New
// Architecture a move can arrive with it undefined or empty. Reading `.length`
// off it directly is what broke this screen: the stage's CAPTURE-phase handler
// runs on every move BEFORE any child can be granted the responder, so the
// TypeError took the whole gesture down with it - the frame did not move, no
// handle resized, nothing was interactive at all. iOS always populates it,
// which is why it survived every iOS test and failed on the first Android
// build of this screen.
//
// `gestureState.numberActiveTouches` is PanResponder's own count and is the
// fallback when the raw list is missing.
const touchCountOf = (e, g) => {
  const fromEvent = e?.nativeEvent?.touches?.length ?? 0;
  return fromEvent || g?.numberActiveTouches || 0;
};
/** The raw touch list, or an empty array. Only pinch needs the coordinates. */
const touchesOf = (e) => {
  const t = e?.nativeEvent?.touches;
  return Array.isArray(t) ? t : [];
};

// Which bracket arms each grab point draws. These are also its OUTWARD sides,
// which is what makes the hit slop below safe.
const HANDLE_ARMS = {
  tl: ["top", "left"], tr: ["top", "right"],
  bl: ["bottom", "left"], br: ["bottom", "right"],
  top: ["top"], bottom: ["bottom"], left: ["left"], right: ["right"],
};
// SLOP OUTWARD ONLY, never toward a neighbouring handle.
//
// At CROP_MIN two 34pt corner handles leave a 4pt gap, so a uniform slop of any
// useful size would make adjacent targets overlap and the wrong one would win a
// press. Growing only on the sides the bracket already points at cannot collide
// with anything: the neighbour is always along an axis this handle does not
// grow on. At the image edge the extra area falls outside the parent and is
// simply clipped, which costs nothing.
const CROP_SLOP = 8;
const HANDLE_SLOP = Object.fromEntries(
  Object.entries(HANDLE_ARMS).map(([key, sides]) => [
    key,
    { top: 0, bottom: 0, left: 0, right: 0, ...Object.fromEntries(sides.map((side) => [side, CROP_SLOP])) },
  ])
);

function PhotoCropScreen({ source, onCancel, onUseOriginal, onConfirm }) {
  const win = Dimensions.get("window");
  const stageW = win.width - 32;
  const stageH = Math.max(220, win.height * 0.56);

  // The image is laid out at an explicitly computed "contain" size rather than
  // being handed to resizeMode, because the crop rectangle has to be converted
  // back into source pixels and that conversion needs the fitted size as a
  // known number, not one the layout engine picked.
  const srcW = Math.max(1, source?.width || 1);
  const srcH = Math.max(1, source?.height || 1);
  const fit = Math.min(stageW / srcW, stageH / srcH);
  const fitW = srcW * fit;
  const fitH = srcH * fit;

  const [rect, setRect] = useState({ x: 0, y: 0, w: fitW, h: fitH });
  const [zoom, setZoom] = useState({ k: 1, tx: 0, ty: 0 });
  const [busy, setBusy] = useState(false);
  const rectRef = useRef(rect);
  const zoomRef = useRef(zoom);
  const startRef = useRef(null);
  const pinchRef = useRef(null);

  const applyRect = (r) => {
    const w = Math.max(CROP_MIN, Math.min(r.w, fitW));
    const h = Math.max(CROP_MIN, Math.min(r.h, fitH));
    const c = {
      x: Math.max(0, Math.min(r.x, fitW - w)),
      y: Math.max(0, Math.min(r.y, fitH - h)),
      w, h,
    };
    rectRef.current = c;
    setRect(c);
  };

  // Drag inside the frame moves it. Screen distance is divided by the zoom
  // factor because the frame's coordinates are in unzoomed stage pixels.
  const moveResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { startRef.current = rectRef.current; },
    onPanResponderMove: (_e, g) => {
      const a = startRef.current;
      if (!a) return;
      const k = zoomRef.current.k || 1;
      applyRect({ w: a.w, h: a.h, x: a.x + g.dx / k, y: a.y + g.dy / k });
    },
  })).current;

  // One responder per grab point. cx/cy of 0 drags the left/top edge, which
  // moves the origin as well as the size; 1 drags the right/bottom edge, which
  // only changes the size; null leaves that axis alone. Corners pass two
  // numbers, edge midpoints pass one number and one null, so pulling the top
  // edge down crops the ceiling without touching the sides.
  const cornersRef = useRef(null);
  if (!cornersRef.current) {
    const mk = (cx, cy) => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = rectRef.current; },
      onPanResponderMove: (_e, g) => {
        const a = startRef.current;
        if (!a) return;
        const k = zoomRef.current.k || 1;
        const dx = g.dx / k;
        const dy = g.dy / k;
        let { x, y, w, h } = a;
        if (cx === 0) { x = a.x + dx; w = a.w - dx; } else if (cx === 1) { w = a.w + dx; }
        if (cy === 0) { y = a.y + dy; h = a.h - dy; } else if (cy === 1) { h = a.h + dy; }
        // Pin the near edge when the frame hits its minimum, so dragging past
        // the limit stops the handle instead of pushing the opposite edge.
        if (w < CROP_MIN) { if (cx === 0) x = a.x + a.w - CROP_MIN; w = CROP_MIN; }
        if (h < CROP_MIN) { if (cy === 0) y = a.y + a.h - CROP_MIN; h = CROP_MIN; }
        if (x < 0) { if (cx === 0) w += x; x = 0; }
        if (y < 0) { if (cy === 0) h += y; y = 0; }
        if (x + w > fitW) w = fitW - x;
        if (y + h > fitH) h = fitH - y;
        applyRect({ x, y, w, h });
      },
    });
    cornersRef.current = {
      tl: mk(0, 0), tr: mk(1, 0), bl: mk(0, 1), br: mk(1, 1),
      top: mk(null, 0), bottom: mk(null, 1), left: mk(0, null), right: mk(1, null),
    };
  }

  // Two fingers zoom and pan the stage. Claimed on the CAPTURE phase so the
  // parent takes a two-finger gesture away from the frame and handles beneath
  // it, while one-finger gestures are never captured and reach them normally.
  const stageResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => false,
    // ONE FINGER IS NEVER CAPTURED, so a drag on the frame or on a handle
    // always reaches the child that was pressed. When the count cannot be
    // determined at all this reads 0, which is not 2 - so an event Android
    // fails to describe leaves the child's gesture alone rather than taking it.
    onMoveShouldSetPanResponderCapture: (e, g) => touchCountOf(e, g) === 2,
    onPanResponderGrant: (e) => {
      const t = touchesOf(e);
      if (t.length !== 2) { pinchRef.current = null; return; }
      const dx = t[0].pageX - t[1].pageX;
      const dy = t[0].pageY - t[1].pageY;
      pinchRef.current = { d: Math.max(1, Math.hypot(dx, dy)), z: zoomRef.current };
    },
    onPanResponderMove: (e, g) => {
      const t = touchesOf(e);
      const p = pinchRef.current;
      // Pinch needs the two coordinates, not just the count, so a platform that
      // does not supply them simply does not zoom. It never throws, and it
      // never disturbs the one-finger gestures that matter most here.
      if (!p || t.length < 2) return;
      const dx = t[0].pageX - t[1].pageX;
      const dy = t[0].pageY - t[1].pageY;
      const k = Math.max(1, Math.min(CROP_ZOOM_MAX, p.z.k * (Math.max(1, Math.hypot(dx, dy)) / p.d)));
      // Keep the image from being dragged off the stage: at scale k it can
      // move by half the overhang in each direction, and not at all at k = 1.
      const maxX = (fitW * (k - 1)) / 2;
      const maxY = (fitH * (k - 1)) / 2;
      const z = {
        k,
        tx: Math.max(-maxX, Math.min(maxX, p.z.tx + g.dx)),
        ty: Math.max(-maxY, Math.min(maxY, p.z.ty + g.dy)),
      };
      zoomRef.current = z;
      setZoom(z);
    },
    onPanResponderRelease: () => { pinchRef.current = null; },
    onPanResponderTerminate: () => { pinchRef.current = null; },
  })).current;

  // Now that this is a screen rather than a Modal it no longer gets
  // onRequestClose, so Android's back gesture is wired up explicitly - it
  // cancels, exactly as the header's Cancel does.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onCancel(); return true; });
    return () => sub.remove();
  }, [onCancel]);

  const reset = () => {
    applyRect({ x: 0, y: 0, w: fitW, h: fitH });
    const z = { k: 1, tx: 0, ty: 0 };
    zoomRef.current = z;
    setZoom(z);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const toSrc = srcW / fitW;   // fit preserves aspect, so one factor serves both axes
      const originX = Math.max(0, Math.min(Math.round(rect.x * toSrc), srcW - 1));
      const originY = Math.max(0, Math.min(Math.round(rect.y * toSrc), srcH - 1));
      const width = Math.max(1, Math.min(Math.round(rect.w * toSrc), srcW - originX));
      const height = Math.max(1, Math.min(Math.round(rect.h * toSrc), srcH - originY));
      // A frame still covering the whole image is not a crop. Take the
      // untouched original rather than paying for a re-encode that only loses
      // quality - this is the same path the Use Original button takes.
      if (originX <= 1 && originY <= 1 && width >= srcW - 2 && height >= srcH - 2) {
        onUseOriginal();
        return;
      }
      // No base64 here either. acceptPhoto runs the result through
      // compressPhoto, which produces the 768px base64 analyze() actually
      // reads; encoding the full-size crop first would just be a second large
      // string built for nothing.
      const out = await manipulateAsync(
        source.uri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.9, format: SaveFormat.JPEG }
      );
      onConfirm({ ...source, uri: out.uri, base64: null, width: out.width, height: out.height });
    } catch (e) {
      // Cropping is an enhancement, not a gate. If the manipulator fails the
      // original is still a perfectly good photo and the run is not lost.
      onUseOriginal();
    } finally {
      setBusy(false);
    }
  };

  // BRACKET ARMS AS FILLED VIEWS, not partial borders.
  //
  // The handles used to be transparent boxes whose whole appearance came from
  // two of their four border sides. Android painted none of them - and the one
  // element on this screen that DID render, the crop frame, is also the only
  // one with a UNIFORM border. The symptom split the component exactly along
  // that line. A filled view is unambiguous on both renderers.
  //
  // The look is deliberately unchanged: same colour, same 4pt thickness, same
  // L-shaped bracket - not a solid square. The arms are pointerEvents="none"
  // so the press still belongs to the container holding the pan handlers.
  const arm = (side, size) => {
    const box =
      side === "top" ? { left: 0, top: 0, width: size, height: CROP_BAR }
      : side === "bottom" ? { left: 0, bottom: 0, width: size, height: CROP_BAR }
      : side === "left" ? { left: 0, top: 0, width: CROP_BAR, height: size }
      : { right: 0, top: 0, width: CROP_BAR, height: size };
    return <View key={side} pointerEvents="none" style={[s.cropBar, box]} />;
  };

  const handle = (key, left, top, size) => (
    <View
      key={key}
      style={[s.cropHandle, { width: size, height: size, left, top }]}
      hitSlop={HANDLE_SLOP[key]}
      {...cornersRef.current[key].panHandlers}
      accessibilityLabel={"Resize crop, " + key}
    >
      {HANDLE_ARMS[key].map((side) => arm(side, size))}
    </View>
  );
  // Edge midpoints are hidden while a side is too short to hold one without
  // covering its own corners - at that size the corners do the same job.
  const roomAcross = rect.w > CROP_HANDLE * 2 + CROP_EDGE;
  const roomDown = rect.h > CROP_HANDLE * 2 + CROP_EDGE;

  return (
    <SafeAreaView style={s.cropSafe}>
        <View style={s.cropHead}>
          <TouchableOpacity onPress={onCancel} style={s.cropCancel} accessibilityRole="button">
            <Text style={s.cropCancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={s.cropTitle}>Frame your space</Text>
          <TouchableOpacity onPress={reset} style={s.cropCancel} accessibilityRole="button">
            <Text style={s.cropCancelText}>Reset</Text>
          </TouchableOpacity>
        </View>
      {/* Shortened to hold ONE line at the larger size. Both affordances are
          still named - the pinch is not discoverable otherwise. */}
      <Text style={s.cropHint}>Drag the corners or edges. Pinch to zoom.</Text>

        <View style={[s.cropStage, { width: stageW, height: stageH }]} {...stageResponder.panHandlers}>
          <View style={{
            width: fitW, height: fitH,
            transform: [{ translateX: zoom.tx }, { translateY: zoom.ty }, { scale: zoom.k }],
          }}>
            <Image source={{ uri: source.uri }} style={{ width: fitW, height: fitH }} />
            {/* Four bands rather than one overlay with a hole: React Native has
                no cut-out, and four plain views cost nothing. */}
            <View pointerEvents="none" style={[s.cropDim, { left: 0, top: 0, width: fitW, height: rect.y }]} />
            <View pointerEvents="none" style={[s.cropDim, { left: 0, top: rect.y + rect.h, width: fitW, height: Math.max(0, fitH - rect.y - rect.h) }]} />
            <View pointerEvents="none" style={[s.cropDim, { left: 0, top: rect.y, width: rect.x, height: rect.h }]} />
            <View pointerEvents="none" style={[s.cropDim, { left: rect.x + rect.w, top: rect.y, width: Math.max(0, fitW - rect.x - rect.w), height: rect.h }]} />

            <View style={[s.cropFrame, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]} {...moveResponder.panHandlers} />

            {/* Handles sit INSIDE the frame corners. Half-overlapping the edge
                reads better but Android clips anything outside the parent, and
                a handle you cannot press at the image edge is worse. */}
            {handle("tl", rect.x, rect.y, CROP_HANDLE)}
            {handle("tr", rect.x + rect.w - CROP_HANDLE, rect.y, CROP_HANDLE)}
            {handle("bl", rect.x, rect.y + rect.h - CROP_HANDLE, CROP_HANDLE)}
            {handle("br", rect.x + rect.w - CROP_HANDLE, rect.y + rect.h - CROP_HANDLE, CROP_HANDLE)}
            {roomAcross && handle("top", rect.x + rect.w / 2 - CROP_EDGE / 2, rect.y, CROP_EDGE)}
            {roomAcross && handle("bottom", rect.x + rect.w / 2 - CROP_EDGE / 2, rect.y + rect.h - CROP_EDGE, CROP_EDGE)}
            {roomDown && handle("left", rect.x, rect.y + rect.h / 2 - CROP_EDGE / 2, CROP_EDGE)}
            {roomDown && handle("right", rect.x + rect.w - CROP_EDGE, rect.y + rect.h / 2 - CROP_EDGE / 2, CROP_EDGE)}
          </View>
        </View>

        <View style={s.cropActions}>
          <TouchableOpacity style={s.cropPrimary} onPress={confirm} disabled={busy} accessibilityRole="button">
            {busy
              ? <ActivityIndicator color="white" />
              : <Text style={s.cropPrimaryText}>Use This Photo</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.cropSecondary} onPress={onUseOriginal} disabled={busy} accessibilityRole="button">
            <Text style={s.cropSecondaryText}>Use Original</Text>
          </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function FreeRoomsBadge({ isPro, analyses, showUpgrade = false }) {
  if (isPro) return <Text style={s.hdrTag}>Pro member</Text>;
  if (showUpgrade && (analyses || 0) >= 3) {
    return (
      <View style={s.freeBadgeUpgrade}>
        <Zap size={11} color={BRAND.ink} strokeWidth={2.5} />
        <Text style={s.freeBadgeUpgradeText}>Upgrade to Pro</Text>
      </View>
    );
  }
  return (
    <View style={s.freeBadge}>
      <View style={s.freeBadgeDot} />
      <Text style={s.freeBadgeText}>{Math.max(0, 3 - (analyses || 0))} Free Rooms Remaining</Text>
    </View>
  );
}

const s = StyleSheet.create({
  cropSafe: { flex: 1, backgroundColor: "#0F2A52", alignItems: "center" },
  cropHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%", paddingHorizontal: 8, paddingTop: 6 },
  cropTitle: { color: "white", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cropCancel: { padding: 10, minWidth: 72 },
  cropCancelText: { color: "rgba(255,255,255,0.85)", fontSize: 15, fontFamily: "Inter_500Medium" },
  // 12pt at 60% white on navy was legible on iOS and barely there on Android,
  // which renders small type more thinly. 14pt at 80% is comfortably readable
  // on both without becoming a headline - this is an instruction you read once.
  cropHint: { color: "rgba(255,255,255,0.8)", fontSize: 14, textAlign: "center", paddingHorizontal: 24, marginTop: 2, marginBottom: 12 },
  cropStage: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cropDim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  cropFrame: { position: "absolute", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.95)" },
  // The touch target only. Its appearance is the filled arms inside it - see
  // the bracket note in PhotoCropScreen for why this is not a border any more.
  cropHandle: { position: "absolute" },
  // THE FRAME IS THE BOUNDARY, THE ARMS ARE THE GRAB POINTS, and they are
  // coloured to say so: a white line marks where the crop edge is, green marks
  // what you can actually pull. `greenOnDark` rather than BRAND.green because
  // that token exists for exactly this situation - it is the on-navy green,
  // documented at 5.17:1, and this stage is navy.
  //
  // The 1pt dark outline is what keeps green legible on green: foliage, lawns
  // and painted walls are the one background a green handle would otherwise
  // vanish into. It sits INSIDE the 4pt arm, so the arm's footprint, the
  // 34/30pt touch targets and every coordinate are unchanged - colour only.
  //
  // NO Platform BRANCHING, here or anywhere in PhotoCropScreen. Both platforms
  // read these same three values.
  cropBar: {
    position: "absolute",
    backgroundColor: BRAND.greenOnDark,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.3)",
  },
  // paddingBottom is ON TOP of whatever bottom inset the SafeAreaView supplies,
  // not a replacement for it. On a home-indicator phone that reads 34 + 16; on
  // an SE-class device, where the bottom inset is ZERO, it is the only thing
  // standing between "Use Original" and the bottom edge of the screen - which
  // it was flush against before, in production as well as staging.
  cropActions: { width: "100%", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 10 },
  cropPrimary: { backgroundColor: BRAND.green, borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  cropPrimaryText: { color: "white", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cropSecondary: { borderRadius: 14, paddingVertical: 13, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  cropSecondaryText: { color: "rgba(255,255,255,0.9)", fontSize: 15, fontFamily: "Inter_500Medium" },
  // Absolute, so it occupies no layout height anywhere. The amber lives on the
  // TEXT rather than this container, which keeps the marker a compact pill
  // instead of a full-width bar - unobtrusive, still unmistakable, and narrow
  // enough that anchoring it right keeps it clear of the header logo.
  stagingBanner: { position: "absolute", top: 0, right: 12, alignItems: "flex-end" },
  stagingBannerText: {
    color: "#1F2937", backgroundColor: "#F59E0B",
    fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1.2,
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 4, overflow: "hidden",
  },
  safe: { flex: 1, backgroundColor: BRAND.offWhite },
  // flexGrow:1 is the load-bearing part. Without it a screen whose content is
  // shorter than the viewport has a contentSize SMALLER than its frame, and the
  // scroll view happily drags that content up into empty space. iOS defaults
  // alwaysBounceVertical to true for vertical scroll views, so the gesture is
  // always available even when there is nothing to scroll. With flexGrow the
  // content container is at least the height of the viewport, so there is no
  // empty region to scroll into. It never shrinks taller content.
  scrollContent: { padding: 20, paddingBottom: 80, flexGrow: 1 },
  // Every screen-level ScrollView gets this. A ScrollView with no flex inside a
  // flex:1 parent sizes itself to its CONTENT rather than to the remaining
  // viewport, which is what makes flexGrow above meaningless on its own - the
  // two only work as a pair.
  screenScroll: { flex: 1 },
  hdr: { backgroundColor: BRAND.navy, borderBottomWidth: 0, paddingTop: 22, paddingBottom: 18, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  hdrMark: { width: 58, height: 58, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  hdrMarkText: { color: "white", fontSize: 22, fontFamily: "Inter_700Bold" },
  hdrName: { fontSize: 22, fontFamily: "Inter_700Bold", color: BRAND.white },
  hdrTag: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  hdrPageName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  // The translucent green fill was REMOVED, not recoloured. rgba(30,158,82,0.2)
  // over navy composites to #124152, which lifts the background toward the text
  // and cost 0.93 of contrast ratio - green on it measured 3.19:1 against 4.12:1
  // for the same green on plain navy. A tint behind same-hue text always works
  // against legibility. Transparent fill + a green border keeps the badge
  // visually distinct while letting the text sit on plain navy (5.17:1).
  freeBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "transparent", borderWidth: 1.5, borderColor: BRAND.greenOnDark, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6, alignSelf: "flex-start" },
  freeBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND.greenOnDark },
  freeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: BRAND.greenOnDark },
  freeBadgeUpgrade: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: BRAND.tan, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4, alignSelf: "flex-start" },
  // white on tan #C8A97A was 2.23:1 - the worst interactive element in the app,
  // and it is the paid-conversion affordance. ink on tan is 6.39:1. None of the
  // three new text tokens apply here: the surface is tan, not light or dark.
  freeBadgeUpgradeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: BRAND.ink },
  signOutBtn: { marginLeft: "auto", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  signOutText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.7)" },
  welcomeText: { fontSize: 16, fontFamily: "Inter_700Bold", color: BRAND.green, marginTop: 8, marginBottom: 4 },
  heroH1: { fontSize: 30, fontFamily: "Inter_400Regular", color: BRAND.ink, lineHeight: 38, marginBottom: 12 },
  heroP: { fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 24, marginBottom: 24 },
  uploadBox: { backgroundColor: BRAND.white, borderRadius: 18, marginBottom: 12, overflow: "hidden", minHeight: 200, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  uploadBoxFilled: { borderWidth: 2, borderColor: BRAND.greenMid, borderRadius: 16, marginBottom: 12, overflow: "hidden", backgroundColor: BRAND.offWhite },
  uploadInner: { padding: 28, alignItems: "center" },
  uploadEmoji: { fontSize: 40, marginBottom: 12 },
  uploadTitle: { fontSize: 19, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 5 },
  uploadHint: { fontSize: 14, fontFamily: "Inter_500Medium", color: BRAND.slate },
  photoPreview: { width: "100%" },
  changeBtn: { borderWidth: 1.5, borderColor: BRAND.green, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, alignSelf: "flex-start", marginBottom: 20 },
  changeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  roomGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  roomBtn: { width: "30%", backgroundColor: BRAND.white, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1.5, borderColor: BRAND.stone },
  roomBtnSel: { borderColor: BRAND.green, backgroundColor: BRAND.greenLight },
  roomIcon: { fontSize: 24, marginBottom: 4 },
  roomLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: BRAND.slate, textAlign: "center" },
  roomNote: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", marginBottom: 18 },
  photoHandwritten: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#64748B", textAlign: "center", opacity: 0.9 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: BRAND.slate, marginBottom: 11 },
  tierIcon: { fontSize: 17, marginBottom: 4 },
  tierName: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 2 },
  errBox: { backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", borderRadius: 8, padding: 13, marginBottom: 12 },
  errText: { color: "#991B1B", fontSize: 13, fontFamily: "Inter_400Regular" },
  ctaBtn: { backgroundColor: "#1E9E52", borderRadius: 20, height: 60, alignItems: "center", justifyContent: "center", marginTop: 8, shadowColor: "#1E9E52", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 5 },
  ctaDisabled: { opacity: 0.68 },
  ctaText: { color: "white", fontSize: 16, fontFamily: "Inter_700Bold" },
  resTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 18 },
  resTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: BRAND.ink },
  resRoomName: { fontSize: 22, fontFamily: "Inter_700Bold", color: BRAND.ink },
  resAreaName: { fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 2 },
  overviewCard: { backgroundColor: BRAND.white, borderWidth: 1, borderColor: BRAND.stone, borderRadius: 14, padding: 16, marginBottom: 16 },
  resPhoto: { width: "100%", height: 220, borderRadius: 14, backgroundColor: BRAND.stone },
  resPhotoHint: { fontSize: 11, color: BRAND.mist, textAlign: "center", marginTop: 6, marginBottom: 16, fontFamily: "Inter_400Regular" },
  overviewText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 22 },
  tcard: { backgroundColor: BRAND.white, borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 12 },
  tcardHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, paddingBottom: 12, borderBottomWidth: 1, marginBottom: 12 },
  tcardIcon: { fontSize: 16 },
  tcardPill: { borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  tcardPillText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  tcardRange: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slateText },
  step: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BRAND.offWhite },
  stepChk: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 2 },
  stepChkText: { fontSize: 9, fontWeight: "800" },
  stepText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.ink, lineHeight: 20, flex: 1 },
  prodLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: BRAND.mist, marginTop: 14, marginBottom: 8 },
  prodRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: BRAND.offWhite, borderRadius: 11, padding: 11, marginBottom: 6 },
  prodIco: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  prodName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  prodPrice: { fontSize: 13, fontFamily: "Inter_700Bold" },
  // Compact recommendation card (2026-08-16). DELIBERATELY separate styles
  // from prodRow/prodIco/prodName above, which the legacy tier-based
  // "SUGGESTED PRODUCTS" list still uses - old-format plans must render
  // exactly as before, and sharing these would have silently restyled them.
  // Height: 12 + 12 padding around a ~54px text column = ~78px per card, so
  // three fit on screen without scrolling. The icon tile is 48px and never
  // drives the row height, which is what makes the later swap to a product
  // thumbnail a drop-in.
  recCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: BRAND.offWhite, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8 },
  recIcon: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  recBody: { flex: 1, minWidth: 0 },
  recName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  recReason: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slateText, marginTop: 2 },
  recLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.greenText, marginTop: 4 },
  amznBadge: { backgroundColor: BRAND.white, borderWidth: 1, borderColor: BRAND.stone, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  amznText: { fontSize: 9, fontFamily: "Inter_700Bold", color: BRAND.slateText },
  approachCard: { backgroundColor: BRAND.white, borderWidth: 1.5, borderRadius: 16, padding: 16, marginBottom: 12 },
  approachCardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  approachPill: { borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  approachPillText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  // Retained, currently unrendered - Results Polish item 1 removed the
  // spend range from display only. Kept so restoring it (once Product
  // Intelligence can derive a real figure) needs no style archaeology.
  approachRange: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.slate },
  approachStrategy: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 19 },
  approachExpanded: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: BRAND.offWhite },
  approachProdReason: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 1 },
  approachShopLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.green, marginLeft: 6 },
  // ---- Approach Card Redesign (ApproachCardRedesign.md) ----
  // Item 1: a quiet sentence-case heading, deliberately NOT s.sectionLabel's
  // all-caps tracked style - that style marks machine-ish section dividers
  // ("HOW WOULD YOU LIKE TO APPROACH THIS?"), and this is meant to read as
  // the app talking, matching the overview prose it introduces.
  resSectionHeading: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink, marginBottom: 8 },
  // Item 2: keyChanges as scannable bullet phrases. Tight leading and a
  // small dot rather than the heavier s.step/stepChk checkmark rows used
  // in the expanded guidance - these are outcomes to skim, not tips to
  // follow, and the collapsed card has to stay compact enough that all
  // three fit without excessive scrolling (item 8).
  approachChangeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 5 },
  approachChangeDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  approachChangeText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: BRAND.ink, lineHeight: 19 },
  approachAdditions: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 18, marginTop: 8 },
  approachAdditionsLabel: { fontFamily: "Inter_600SemiBold", color: BRAND.mist },
  // Replaces the bare chevron as the expansion affordance.
  approachToggleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10 },
  approachToggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  // Item 4/8: full-width WITHIN the card, green, prominent - the one
  // commitment action, visually distinct from every expand/collapse and
  // shop affordance around it.
  approachStartBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  approachStartBtnText: { color: "white", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  // Item 5: the post-commitment header, replacing the chooser prompt.
  approachChosenRow: { flexDirection: "row", alignItems: "center", marginBottom: 11 },
  approachChosenText: { flex: 1, fontSize: 13, fontFamily: "Inter_700Bold", color: BRAND.ink },
  approachChangeLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  tipBox: { backgroundColor: BRAND.greenLight, borderWidth: 1, borderColor: BRAND.greenMid, borderRadius: 14, padding: 16, flexDirection: "row", marginTop: 4 },
  tipHead: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: BRAND.green, marginBottom: 4 },
  tipBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#166E38", lineHeight: 20 },
  startOverBtn: { backgroundColor: BRAND.white, borderWidth: 2, borderColor: BRAND.green, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 20, marginBottom: 10 },
  companionCard: { backgroundColor: BRAND.white, borderWidth: 1.5, borderColor: BRAND.greenMid, borderRadius: 16, padding: 18, marginBottom: 16 },
  companionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 8 },
  companionBody: { fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 22, marginBottom: 16 },
  companionBtn: { backgroundColor: BRAND.green, borderRadius: 12, padding: 15, alignItems: "center", justifyContent: "center" },
  companionBtnText: { color: "white", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  companionSecondaryBtn: { marginTop: 12, padding: 8, alignItems: "center" },
  companionSecondaryBtnText: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, textDecorationLine: "underline" },
  companionTertiaryBtn: { marginTop: 2, padding: 8, alignItems: "center" },
  companionTertiaryBtnText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist },
  companionTipText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", marginTop: 10 },
  companionProgressCaption: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: BRAND.green, marginBottom: 6, letterSpacing: 0.3 },
  companionProgressTrack: { height: 4, backgroundColor: BRAND.offWhite, borderRadius: 2, overflow: "hidden" },
  companionProgressFill: { height: 4, backgroundColor: BRAND.green, borderRadius: 2 },
  companionVisibleChangeText: { fontSize: 14, fontFamily: "Inter_500Medium", color: BRAND.ink, lineHeight: 20, marginBottom: 16, textAlign: "center" },
  batchItemRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  batchItemCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: BRAND.greenMid, alignItems: "center", justifyContent: "center", marginRight: 12, marginTop: 1 },
  batchItemCheckboxChecked: { backgroundColor: BRAND.green, borderColor: BRAND.green },
  batchItemText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.ink, lineHeight: 21 },
  batchItemTextChecked: { color: BRAND.slate, textDecorationLine: "line-through" },
  reviewItemBlock: { marginTop: 14 },
  reviewItemText: { fontSize: 14, fontFamily: "Inter_500Medium", color: BRAND.ink, marginBottom: 8 },
  reviewItemBtnPrimary: { flex: 1, backgroundColor: BRAND.green, borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  reviewItemBtnPrimaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "white", textAlign: "center" },
  reviewItemBtnOutline: { flex: 1, backgroundColor: "transparent", borderWidth: 1.5, borderColor: BRAND.green, borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  reviewItemBtnOutlineText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.greenText, textAlign: "center" },
  wrapUpCelebrationTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 8 },
  wrapUpCelebrationRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  wrapUpCelebrationText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  wrapUpRemainingCount: { color: BRAND.green },
  // No green border, unlike companionCard - a calmer white card with a
  // subtle shadow instead (same shadow recipe as uploadBox) reads better
  // now that the tone here is calm, not celebratory or attention-seeking
  // (DecisionLog.md 2026-07-19).
  wrapUpCard: { backgroundColor: BRAND.white, borderRadius: 16, padding: 18, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  wrapUpReasonBox: { marginTop: 10, backgroundColor: BRAND.offWhite, borderRadius: 10, padding: 12 },
  wrapUpReasonLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.slate, marginBottom: 8 },
  wrapUpReasonRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  wrapUpReasonDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: BRAND.mist },
  wrapUpReasonText: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.ink },
  wrapUpFooter: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, backgroundColor: BRAND.white },
  // Sized to this screen's SafeAreaView, not a scrolling content card -
  // ConfettiCanvas's own height/width: 100% resolves against whatever
  // immediate parent it's given, and the library's physics formulas scale
  // directly off that measured size (DecisionLog.md 2026-07-20).
  confettiOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  beforeAfterStackWrap: { borderRadius: 12, overflow: "hidden", backgroundColor: BRAND.offWhite, position: "relative" },
  beforeAfterStackImage: { width: "100%", height: "100%" },
  beforeAfterStackLabel: { position: "absolute", top: 8, left: 8, fontSize: 10, fontFamily: "Inter_700Bold", color: "white", backgroundColor: "rgba(15,42,82,0.7)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, letterSpacing: 0.5 },
  inspectorBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  inspectorClose: { position: "absolute", top: 50, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", zIndex: 1 },
  inspectorImageArea: { width: "100%", flex: 1, position: "relative" },
  inspectorImage: { width: "100%", height: "100%", position: "absolute", top: 0, left: 0 },
  inspectorImageOverlay: { position: "absolute" },
  inspectorSegmentRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 20, padding: 4, marginBottom: 30, marginTop: 16 },
  inspectorSegment: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
  inspectorSegmentActive: { backgroundColor: "white" },
  inspectorSegmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.7)" },
  inspectorSegmentTextActive: { color: BRAND.ink },
  revealModalSafe: { flex: 1, backgroundColor: BRAND.white },
  revealModalHeader: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 8 },
  revealModalClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: BRAND.offWhite, alignItems: "center", justifyContent: "center" },
  revealModalProgressWrap: { paddingHorizontal: 18, paddingTop: 4 },
  revealModalImageArea: { flex: 1, paddingHorizontal: 12, paddingTop: 8, justifyContent: "center" },
  revealModalFooter: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18 },
  revealModalHint: { fontSize: 11, fontFamily: "Inter_400Regular", color: BRAND.mist, textAlign: "center", marginTop: 8, marginBottom: 4 },
  completedBadgeRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  completedBadge: { flexDirection: "row", alignItems: "center", backgroundColor: BRAND.green, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8 },
  completedBadgeText: { color: "white", fontSize: 12, fontFamily: "Inter_600SemiBold", marginLeft: 4 },
  completedDateText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate },
  completedHeadline: { fontSize: 19, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 10, lineHeight: 25 },
  completedAccomplishmentsList: { marginBottom: 12 },
  completedAccomplishmentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  completedAccomplishmentText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, flex: 1 },
  completedTaskCountText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist, marginBottom: 12 },
  completedBeforeAfterArea: { height: 220, borderRadius: 12, overflow: "hidden", marginTop: 4 },
  companionResumeBanner: { flexDirection: "row", alignItems: "center", backgroundColor: BRAND.greenLight, borderWidth: 1, borderColor: BRAND.greenMid, borderRadius: 14, padding: 14, marginBottom: 16 },
  companionResumeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  companionResumeSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 1 },
  // §12 Migration Part 3, Pass 2 - merge-proposal review screen styles.
  mergeCandidateSignal: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.green, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  mergeCandidateInstruction: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink, marginBottom: 4, lineHeight: 20 },
  mergeCandidateSupportCopy: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 17 },
  mergeEvidenceCardWrap: { width: "47%", borderRadius: 12, borderWidth: 2, borderColor: "transparent", padding: 2, position: "relative" },
  mergeEvidenceCardWrapSelected: { borderColor: BRAND.green },
  mergeEvidenceCard: { backgroundColor: "#F8FAFC", borderRadius: 10, padding: 8 },
  mergeEvidencePhoto: { width: "100%", height: 110, borderRadius: 8 },
  mergeEvidenceLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 6, paddingRight: 26, flexWrap: "wrap" },
  mergeEvidenceMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 4 },
  mergeCheckbox: { position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.9)", borderWidth: 2, borderColor: BRAND.mist, alignItems: "center", justifyContent: "center" },
  mergeCheckboxChecked: { backgroundColor: BRAND.green, borderColor: BRAND.green },
  mergeSecondaryBtn: { backgroundColor: BRAND.white, borderWidth: 1, borderColor: BRAND.stone, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  mergeSecondaryBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.slate, textAlign: "center" },
  mergeAllCaughtUpTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 6 },
  mergeAllCaughtUpSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", marginBottom: 20 },
  mergeRenameLink: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6, alignSelf: "flex-start" },
  mergeRenameLinkText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  renameSheetBackdrop: { flex: 1, backgroundColor: "rgba(15,42,82,0.5)", justifyContent: "flex-end" },
  renameSheetCard: { backgroundColor: "white", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  renameSheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 14 },
  renameSheetInput: { borderWidth: 1, borderColor: BRAND.stone, borderRadius: 12, padding: 14, fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink, marginBottom: 16 },
  renameSuggestionsLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.slate, marginBottom: 8 },
  renameSuggestionChip: { backgroundColor: BRAND.greenLight, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  renameSuggestionChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  shareBtn: { padding: 12, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  vizBtn: { borderWidth: 1.5, borderRadius: 8, padding: 13, alignItems: "center", justifyContent: "center", marginTop: 12 },
  vizModalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" },
  vizModalClose: { position: "absolute", top: 50, right: 20, zIndex: 10, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  vizModalCloseText: { color: "white", fontSize: 18, fontWeight: "bold" },
  vizModalImage: { width: "100%", height: "80%" },
  vizBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  vizImage: { width: "100%", height: 260, borderRadius: 8, marginTop: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: BRAND.white, borderRadius: 14, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: BRAND.stone },
  menuIcon: { width: 28, alignItems: "center", justifyContent: "center" },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  proBadge: { backgroundColor: BRAND.green, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 8, marginRight: 4 },
  proBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "white" },
  faqIntro: { backgroundColor: BRAND.white, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: BRAND.stone },
  faqIntroText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 20 },
  faqItem: { backgroundColor: BRAND.white, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: BRAND.stone },
  faqQuestion: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  faqQuestionText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  faqChevron: { fontSize: 11, color: BRAND.mist },
  faqAnswer: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 21, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BRAND.stone },
  contactBtn: { backgroundColor: BRAND.white, borderWidth: 2, borderColor: BRAND.green, borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8 },
  contactBtnText: { color: BRAND.green, fontSize: 15, fontFamily: "Inter_700Bold" },
  accountCard: { backgroundColor: BRAND.white, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 14, borderWidth: 1, borderColor: BRAND.stone, marginBottom: 4 },
  accountAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: BRAND.green, alignItems: "center", justifyContent: "center" },
  accountAvatarText: { fontSize: 22, fontWeight: "700", color: "white" },
  accountName: { fontSize: 16, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 2 },
  accountEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate },
  accountInfoCard: { backgroundColor: BRAND.white, borderRadius: 16, borderWidth: 1, borderColor: BRAND.stone, overflow: "hidden" },
  accountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: BRAND.stone },
  accountRowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: BRAND.ink },
  accountRowValue: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate },
  accountBadge: { borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  accountBadgeText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  upgradeBtn: { backgroundColor: BRAND.green, margin: 12, borderRadius: 8, padding: 13, alignItems: "center" },
  upgradeBtnText: { color: "white", fontFamily: "Inter_700Bold", fontSize: 14 },
  historyItem: { flexDirection: "row", gap: 12, backgroundColor: BRAND.white, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: BRAND.stone, alignItems: "flex-start" },
  // AREAS IN THIS ROOM swipe-to-delete. marginBottom/borderRadius live
  // here (on the Swipeable's own outer container) rather than on the row
  // content itself (historyItem's own marginBottom is zeroed out at that
  // usage site) - overflow:"hidden" clips the revealed red action to the
  // same rounded corners as the card, instead of a square panel poking out
  // past them.
  areaSwipeContainer: { marginBottom: 10, borderRadius: 14, overflow: "hidden" },
  // Fixed width ONLY, deliberately no flex - Swipeable measures this
  // rendered action's own width (via onLayout) to determine both the
  // "open" resting position AND the max swipe distance (overshootRight
  // is false below, so it can never exceed this). `flex: 1` here was the
  // original bug: flex's own flexBasis:0 wins over an explicit `width`
  // on the row's main axis, so the button silently stretched to fill the
  // ENTIRE row's width instead of staying a fixed 80px - producing a
  // full-row slide with no way back, not the intended narrow reveal.
  // Height needs no explicit value - the actions row's default
  // alignItems:"stretch" already fills it to match the card's height.
  areaSwipeDeleteAction: { width: 80, backgroundColor: "#DC2626", alignItems: "center", justifyContent: "center" },
  // Area Re-parenting Phase A (AreaReparentingDesign.md §9): the "..."
  // overflow control on an Area row, and the rows inside the action sheet
  // it opens. The control is deliberately a fixed 44x44 hit target (the
  // platform minimum) sitting to the RIGHT of the row's own content, so
  // it never competes with "Organize Again" for the primary-action slot -
  // §9's governing point: a move is rarer and more consequential than
  // starting a visit, and must not read as a second same-tier action.
  areaOverflowBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  areaActionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#E6E9EE" },
  areaActionText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#334155" },
  historyIcon: { width: 66, height: 66, backgroundColor: BRAND.greenLight, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  historySpace: { fontSize: 14, fontFamily: "Inter_700Bold", color: BRAND.ink },
  historyDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist },
  historyOverview: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 18 },
  historyCompleteBadge: { backgroundColor: BRAND.greenLight, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginBottom: 4 },
  historyCompleteBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: BRAND.green, letterSpacing: 0.3 },
  paywallHeader: { alignItems: "center", paddingTop: 20, paddingBottom: 24 },
  paywallIcon: { fontSize: 48, marginBottom: 12 },
  paywallTitle: { fontSize: 30, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 8, textAlign: "center" },
  paywallSubtitle: { fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center" },
  paywallCard: { backgroundColor: BRAND.white, borderRadius: 20, padding: 24, width: "100%", borderWidth: 1, borderColor: BRAND.stone, marginBottom: 20 },
  paywallPrice: { fontSize: 42, fontFamily: "Inter_700Bold", color: BRAND.ink, textAlign: "center" },
  paywallPer: { fontSize: 18, fontFamily: "Inter_400Regular", color: BRAND.slate },
  paywallPriceSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.green, textAlign: "center", marginBottom: 20 },
  paywallFeature: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BRAND.offWhite },
  paywallFeatureIcon: { fontSize: 20, width: 28, textAlign: "center" },
  paywallFeatureText: { fontSize: 15, fontFamily: "Inter_500Medium", color: BRAND.ink, flex: 1 },
  compareCol: { flex: 1, borderWidth: 1.5, borderRadius: 14, padding: 12, backgroundColor: "#F4F6F8", borderColor: BRAND.stone },
  compareColHeader: { fontSize: 13, fontFamily: "Inter_700Bold", color: BRAND.slate, textAlign: "center", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  compareIcon: { fontSize: 14, color: BRAND.mist, width: 16 },
  compareText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, flex: 1 },
  planOption: { flex: 1, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 14, padding: 14, alignItems: "center", backgroundColor: BRAND.white },

  planOptionSelMonthly: { borderColor: BRAND.navy, borderWidth: 2 },
  planOptionSelYearly: { borderColor: BRAND.green, borderWidth: 2, backgroundColor: "#F8FBF9" },
  planOptionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.slate, marginBottom: 4 },
  planOptionPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: BRAND.ink },
  planOptionSub: { fontSize: 11, fontFamily: "Inter_500Medium", color: BRAND.slate, marginTop: 2 },
  planSaveBadge: { backgroundColor: BRAND.green, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1, marginBottom: 6 },
  planSaveText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "white" },
  paywallCta: { backgroundColor: BRAND.green, borderRadius: 14, padding: 17, alignItems: "center", width: "100%", marginBottom: 8 },
  paywallCtaText: { color: "white", fontSize: 16, fontFamily: "Inter_700Bold" },
  paywallCtaSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slateText, marginBottom: 16 },
  paywallSkip: { padding: 12 },
  paywallSkipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#A8AFBC" },
  shareBtnIcon: { fontSize: 26, color: BRAND.green },
  shutterBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: "white", borderWidth: 3, borderColor: "#ddd" },
  photoButtonsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  photoBtn: { flex: 1, backgroundColor: BRAND.white, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 13, padding: 14, alignItems: "center", gap: 6 },
  photoBtnIcon: { fontSize: 24 },
  photoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  loadingBox: { backgroundColor: BRAND.white, borderRadius: 16, padding: 28, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: BRAND.stone },
  loadingMsg: { fontSize: 17, fontFamily: "Inter_700Bold", color: BRAND.ink, marginTop: 16, marginBottom: 6, textAlign: "center" },
  loadingHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.mist, textAlign: "center" },
  startOverText: { color: BRAND.green, fontSize: 16, fontFamily: "Inter_700Bold" },
  // Onboarding styles
  onboardingTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  skipText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.slate },
  slideContent: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  slideIconWrap: { width: 100, height: 100, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 28, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  slideIcon: { fontSize: 48 },
  slideTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: BRAND.ink, textAlign: "center", marginBottom: 8 },
  slideSubtitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.green, textAlign: "center", marginBottom: 16 },
  slideDesc: { fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", lineHeight: 24 },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: BRAND.stone },
  dotActive: { width: 24, backgroundColor: BRAND.green },
  checkRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16, paddingHorizontal: 24 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: BRAND.stone, backgroundColor: BRAND.white, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: BRAND.green, borderColor: BRAND.green },
  checkmark: { color: "white", fontSize: 13, fontWeight: "800" },
  checkLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate },
  onboardingBottom: { paddingHorizontal: 24, paddingBottom: 16 },
  // Auth styles
  authScroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  authLogo: { alignItems: "center", marginBottom: 32 },
  authAppName: { fontSize: 32, fontFamily: "Inter_700Bold", color: BRAND.ink, marginTop: 12 },
  authTagline: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 4 },
  authCard: { backgroundColor: BRAND.white, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: BRAND.stone },
  authTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 4 },
  authSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate, marginBottom: 24 },
  inputWrap: { marginBottom: 16 },
  inputLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.slate, marginBottom: 6, letterSpacing: 0.5 },
  input: { backgroundColor: BRAND.offWhite, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 8, padding: 14, fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.ink },
  passwordRow: { backgroundColor: BRAND.offWhite, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  passwordInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: BRAND.ink, paddingVertical: 14 },
  referralRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  referralChip: { borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: BRAND.white },
  referralChipSel: { borderColor: BRAND.green, backgroundColor: BRAND.greenLight },
  referralChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.slate },
  referralChipTextSel: { color: BRAND.green },
  switchBtn: { marginTop: 20, alignItems: "center" },
  switchText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.slate },
  termsText: { fontSize: 11, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", marginTop: 12, lineHeight: 18 },
  termsLink: { color: BRAND.green, fontFamily: "Inter_600SemiBold" },
  switchLink: { color: BRAND.green, fontFamily: "Inter_700Bold" },
  forgotPasswordText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  inputRow: { flexDirection: "row", marginBottom: 0 },
});
