import { useState, useEffect, useRef } from "react";
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Linking, StatusBar,
  TextInput, KeyboardAvoidingView, Platform, Alert, Share, Modal, Dimensions, BackHandler, Animated
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Rect, Circle, Polyline, Line } from "react-native-svg";
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
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Menu, Check, X, AlertTriangle, Sparkles, HelpCircle, Camera, Image as ImageIcon, FileText, Mail, LogOut, User, Clock, ShoppingBag, Folder, Zap, Star, Diamond, Sofa, Shirt, CarFront, UtensilsCrossed, BedDouble, Monitor, Lightbulb, Wrench, Home, ChevronRight, ChevronLeft, Eye, EyeOff, Layers, Pencil, CookingPot, Bath, Warehouse, WashingMachine, DoorOpen, Trash2, Cable, ShoppingBasket, Box, ShelvingUnit, Anchor, Tag, Archive, Package } from "lucide-react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, limit, serverTimestamp, Timestamp, arrayUnion, writeBatch, runTransaction, increment, deleteField } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, listAll, deleteObject } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import { evaluateSpaceShadowValidation } from "./shared/spaceShadowValidation";
import { computeShadowIds, computeShadowBatchId, deriveFullReprojectionDocs, computeRoomSummaryFields, computeAreaSummaryFields, evaluateMigrationCompleteness, MIGRATION_VERSION, computeMergeCandidateId, CANDIDATE_KEY_VERSION, DETECTION_VERSION, getSpaceDisplayName, validateTargetSpace, resolveRecognitionCandidates, dedupeToKnownRooms, routeRoomConfirmation, resolveExistingRoomConfirmation, resolveNewRoomConfirmation, evaluateCandidateInvalidation } from "./shared/spaceMigration";
import Purchases from "react-native-purchases";
import { getAnalytics, logEvent } from "@react-native-firebase/analytics";
import Constants from "expo-constants";
import { PIConfetti } from "react-native-fast-confetti";
import * as Updates from "expo-updates";

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
function dlog(line) {
  console.log(line);
  debugLogBuffer.push(`${new Date().toISOString()} ${line}`);
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
function resolveResultsRoomName(plan, currentPlanId, roomsList) {
  if (!plan) return null;
  const roomId = plan.canonicalSpaceId || currentPlanId;
  const matchedRoom = (roomsList || []).find((r) => r.id === roomId);
  return matchedRoom?.displayName || getSpaceDisplayName(plan);
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
    await updateDoc(doc(db, "users", uid, "plans", planId), { areaId: areaRef.id, shadowSourceVersion: increment(1) });
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
      await updateDoc(doc(db, "users", uid, "plans", snap.planId), { areaId: newAreaId, shadowSourceVersion: increment(1) })
        .catch((e) => dlog(`[ROOM MERGE] areaId repoint failed for plan ${snap.planId}: ${e.message}`));
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
const ProcessingOverlay = ({ text = "Processing..." }) => (
  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.94)", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
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
const PRODUCT_CATEGORY_ICONS = {
  cable: Cable,
  basket: ShoppingBasket,
  bin: Box,
  shelf: ShelvingUnit,
  hook: Anchor,
  label: Tag,
  "drawer-organizer": Archive,
  hanger: Shirt,
  bag: ShoppingBag,
  other: Package,
};
function getProductCategoryIcon(iconKey) {
  return PRODUCT_CATEGORY_ICONS[iconKey] || Package;
}

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
    subtitle: "Three budgets, endless possibilities",
    desc: "Receive a personalized step-by-step organization plan across Budget, Mid-Range, and Premium tiers. Or enter your exact budget.",
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
        <ScrollView contentContainerStyle={s.authScroll}>

          {/* Logo */}
          <View style={s.authLogo}>
            <View style={s.hdrMark}><DrawerIcon size={54} dark={true} /></View>
            <Text style={s.authAppName}>Uncluttrd</Text>
            <Text style={s.authTagline}>More Space. More Time. More You.</Text>
          </View>

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
      <ScrollView contentContainerStyle={s.scrollContent}>
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [faqOpen, setFaqOpen] = useState(null);
  const [vizImage, setVizImage] = useState({});
  const [currentPlanId, setCurrentPlanId] = useState(null); // Firestore doc id of the plan currently being viewed
  const [vizModal, setVizModal] = useState(null); // keyed by tier id
  const [vizModalKey, setVizModalKey] = useState(0);
  const [vizLoading, setVizLoading] = useState({}); // keyed by tier id
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
  const [roomConfirmationError, setRoomConfirmationError] = useState(null);
  // Holds { resolvedResult, sourceCandidate } for whichever action was
  // last attempted, so retryRoomConfirmation can re-invoke the exact same
  // completeRoomConfirmation call after a failure - a ref, not state,
  // since it doesn't need its own render.
  const lastRoomConfirmationAttemptRef = useRef(null);
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
    "Selecting storage solutions for your budget...",
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
  const [tier, setTier] = useState("mid");
  const [tierTouched, setTierTouched] = useState(false); // true once the user actually taps a tier pill
  const [budget, setBudget] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [err, setErr] = useState(null);

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
  const debugShareLog = async () => {
    const text = debugLogBuffer.length ? debugLogBuffer.join("\n\n") : "(no debug log entries captured yet)";
    try {
      await Share.share({ message: text, title: "Companion Debug Log" });
    } catch (e) {
      Alert.alert("Share failed", e.message);
    }
  };
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
    setPreviewApproach(null);
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.2,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        setPhoto({ uri: a.uri, base64: a.base64, mimeType: "image/jpeg" });
        logEvent(getAnalytics(), "photo_uploaded");
        setResults(null); setErr(null);
      }
    } catch (e) {
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
        const plans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        byCanonicalSnap.docs.forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
        if (selfSnap.exists()) byId.set(selfSnap.id, { id: selfSnap.id, ...selfSnap.data() });
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
        // reader uses to pick the right rendering path.
        schemaVersion: 2,
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
        // Genuinely null at save time - this field records the user's own
        // explicit approach choice, made on Results (Phase B's "Start This
        // Plan" button), which by definition hasn't happened yet for a plan
        // that's only just now being saved.
        selectedApproach: null,
        proTip: plan.proTip,
        vizImages: {},
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
  // Only if that finds nothing does it run the two targeted single-field
  // queries (spaceType, spaceName - each auto-indexed, no deployment
  // needed) to catch a Room organized 6+ months ago, outside the cache.
  // Deliberate deviation from RememberedHomeDesign.md §2a, which said to
  // run the query unconditionally in parallel with the cache check: doing
  // that would mean two extra Firestore reads on EVERY analysis,
  // including the common first-time-user case with no history at all to
  // match against. Conditional-on-cache-miss still catches exactly the
  // case §2a's own reasoning cared about (an older Room the 20-item cache
  // missed) - it just avoids paying the query's cost when the cache
  // already has a real answer. Flagged explicitly, not silently changed.
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
    const cacheCandidatesRaw = resolveRecognitionCandidates(freshLabel, cachePlans);
    const cacheCandidates = await excludeRetiredCandidates(cacheCandidatesRaw);
    diagnostics.cacheCandidateCount = cacheCandidates.length;
    if (cacheCandidates.length) return finish("MATCH_FOUND", cacheCandidates);

    diagnostics.fallbackQueryRan = true;
    diagnostics.fallbackQueryReason = diagnostics.cacheLoaded && diagnostics.cacheSize > 0 ? "cache-had-zero-matches" : "cache-not-loaded";

    try {
      const plansRef = collection(db, "users", forUid, "plans");
      const [byType, byName] = await Promise.all([
        getDocs(query(plansRef, where("spaceType", "==", freshLabel))),
        getDocs(query(plansRef, where("spaceName", "==", freshLabel))),
      ]);
      diagnostics.byTypeCount = byType.size;
      diagnostics.byNameCount = byName.size;
      const merged = new Map();
      [...byType.docs, ...byName.docs].forEach((d) => {
        if (!merged.has(d.id)) merged.set(d.id, { id: d.id, data: d.data() });
      });
      const resolvedRaw = resolveRecognitionCandidates(freshLabel, [...merged.values()]);
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
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        quality: 0.2,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        setPhoto({ uri: a.uri, base64: a.base64, mimeType: "image/jpeg" });
        logEvent(getAnalytics(), "photo_uploaded");
        setResults(null); setErr(null);
      }
    } catch (e) {
      setErr("We couldn't open your files. Please try another option.");
    }
  };

  const openCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Camera Permission Required", "Please allow camera access in Settings → Uncluttrd → Camera.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.2,
        base64: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const compressed = await compressPhoto(a.uri);
        if (compressed) {
          setPhoto(compressed);
          logEvent(getAnalytics(), "photo_uploaded");
          Image.getSize(compressed.uri, (w, h) => setPhotoSize({ width: w, height: h }), () => { });
        } else {
          setPhoto({ uri: a.uri, base64: a.base64, mimeType: "image/jpeg" });
          logEvent(getAnalytics(), "photo_uploaded");
          Image.getSize(a.uri, (w, h) => setPhotoSize({ width: w, height: h }), () => { });
        }
        setResults(null); setErr(null);
      }
    } catch (e) {
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
    const validBatch = Array.isArray(parsedResult.approaches?.simple?.taskChecklist) && parsedResult.approaches.simple.taskChecklist.filter(t => typeof t === "string" && t.trim()).length > 0;
    if (validBatch) {
      logEvent(getAnalytics(), "batch_shown", { planId: newPlanId, batchIndex: 1 });
    } else {
      logEvent(getAnalytics(), "batch_generation_failed", { planId: newPlanId, batchIndex: 1, reason: "missing_batch" });
    }
    setTimeout(() => resultsScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
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
    setResults(confirmedPlan);
    logEvent(getAnalytics(), "plan_completed");

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
          setRoomConfirmationSaving(false);
          await beginAreaConfirmation({
            roomId: resolvedResult.canonicalSpaceId,
            existingAreas,
            suggestedAreaName: confirmedPlan.areaName,
            saveContinuation: (areaIntent) => finishRoomConfirmationSave(resolvedResult, sourceCandidate, confirmedPlan, areaIntent),
          });
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
    setResults(parsed);
    logEvent(getAnalytics(), "plan_completed");
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
      const roomAreaInstruction = `Before returning your classification, answer three separate questions about this photo, in this exact order - do not let one contaminate another: (1) ORGANIZING TARGET - what is the primary thing or area the user appears to be asking Uncluttrd to organize in this photo? This is the organizing target: the specific thing they want help with, not a survey of everything visible in the frame. (2) PARENT ROOM - what room of the home is that organizing target located in? Use a short, common label (Living Room, Kitchen, Garage, Bedroom) for suggestedRoomName. (3) SCOPE - Before classifying areaScope, answer this question first: "Is there ONE primary thing or area that the user is asking Uncluttrd to organize in this photo?" If YES, the answer is sub-area, even if other furniture, walls, windows, or decorative items are visible in the background. Set suggestedAreaName to a short label for that organizing target. If NO - the photo genuinely depicts a general room with no single organizing focus and you cannot identify any one area the user is targeting - then the answer is whole-room and suggestedAreaName is null. Do NOT classify as whole-room merely because: multiple furniture types are visible; multiple furniture pieces are present; the photo captures several items across the room; you see decorative elements, plants, or windows alongside the main subject; the photo is not "tightly framed" on one fixture. Any of those can be true while the photo is still clearly ABOUT one organizing target. The question is always: what does the user want to organize? If you can name it, it's sub-area. The third possible classification is "ambiguous" (the room-level label itself commonly means either a fully independent room or a named zone within a larger room, depending on the specific home - for example Pantry, Closet, Mudroom, Laundry Area, or Home Office - and this one photo does not give you enough context to tell which this home means). When ambiguous, still provide your best suggestedRoomName as the standalone-room interpretation - the app will ask the user to confirm which it actually is. Never invent a numerical confidence score. For roomReason and areaReason, cite the specific visible evidence behind your classification (for example "multiple seating pieces and a TV console visible" or "photo is centered on a single shelving unit that is clearly the organizing target, with a couch and window only partially visible in the background") - never just restate the label itself as its own justification. SELF-CONSISTENCY CHECK (do this last, after you have drafted your overview and recommendations in your own reasoning): does your overview describe organizing ONE specific area, fixture, or piece of furniture? If yes, your areaScope MUST be "sub-area" and suggestedAreaName MUST name that area. Your overview and your classification must agree - they are describing the same photo, not answering different questions. If your overview says "your corner shelf" then areaScope cannot be "whole-room." Before returning your JSON, re-read your own overview field and your own areaScope field together and confirm they tell the same story.\n\n`;
      // Approach Selection Phase A (ApproachSelectionDesign.md Sections
      // 2/3): replaces the old per-tier budget-math + single checklist
      // paragraph entirely. scopeClassificationInstruction/
      // approachesInstruction below are the only new prompt content -
      // priorPhotoPreamble, priorContextNote, knownIdentityNote, the
      // em-dash rule, and roomAreaInstruction are all unchanged, exactly
      // as before this phase (confirmed independent in the design doc's
      // own Section 1 audit).
      const scopeClassificationInstruction = `Before writing anything else, classify the SIZE of what is being organized in this photo into exactly one of five scope levels for scopeSize - this determines realistic spending, not the room's own name: micro-area (a single shelf, drawer, or small fixture), small-area (a desk, vanity, or counter section), room-section (an entertainment center, closet, or pantry), whole-room (a full kitchen, bedroom, or garage), or large-room (an open-plan living area or a full basement). Base this on what is actually visible and being organized, not the parent room's own name - a single drawer inside a kitchen is still micro-area, not whole-room.`;
      const approachesInstruction = `Identify the genuine problems visible in this photo and list each one in problemsFound, with a short, stable, lowercase-hyphenated id (for example "visible-cords") and a one-sentence description grounded in exactly what is visible - never a generic clutter observation you cannot point to in this specific photo.\n\nThen generate THREE separate, complete organizing approaches for this exact space: "simple" (Keep It Simple - maximize improvement with minimal purchasing or change, emphasizing decluttering and reusing what the user already has), "polished" (Polished & Practical - targeted upgrades, a real balance of function, appearance, and cost), and "elevated" (Elevated Finish - prioritizes aesthetics, materials, and concealment for a fully finished result). Each approach must be a genuinely different, internally coherent strategy for the SAME photo, not the same plan with products added or removed and different adjectives - if all three would tell the user to do the same things in the same order, you have not done this correctly.\n\nFor each approach, write organizingGuidance (3-4 general tips in that approach's own spirit, independent of any specific product) and taskChecklist (3-6 doable-right-now tasks for a first working session under that approach, each described in one or two warm sentences, in the voice of a calm, encouraging professional organizer, not a task-list label). Every tip and task must be grounded in a problem genuinely visible in this exact photo, not a common decluttering trope you default to - do not suggest gathering cables, sorting a drawer, or grouping similar items unless you can point to a specific instance of that exact problem actually visible and unaddressed in this photo. If a specific approach genuinely has little left to do, it is correct for that approach's guidance and checklist to say so honestly rather than inventing busywork.\n\nFor each approach, separately decide whether any of ITS OWN problems would genuinely benefit from a purchase - many are solved by rearranging what is already there, especially under Keep It Simple. For each one that would, add ONE recommendation to that approach's own productRecommendations: productType (a product category, never a specific product name or brand - no real product catalog backs that specificity), reason (one sentence grounded in the specific problem, not a generic benefit), searchTerms (retailer-independent search words a person could type into any shopping search box), icon (choose exactly one of: cable, basket, bin, shelf, hook, label, drawer-organizer, hanger, bag, other), relatedProblemId (must match a real problemsFound id), and approachId (must match this approach's own id: simple, polished, or elevated). Return between 0 and 4 recommendations per approach, independently for each approach - Keep It Simple will often have zero, and that is a correct, complete answer, never a failure to fix. Never invent a recommendation just to fill a slot.\n\nFor each approach, also write visualizationDirection: one descriptive sentence (not a full image-generation prompt, just the creative direction) describing what that approach's finished result should look like for this specific space - distinct enough between the three approaches that someone reading all three, without labels, could tell which is which.\n\nReference spending bands, by scope and approach, for your own calibration only - do not return any dollar amount anywhere in your response, only scopeSize; the app determines the actual displayed spending range from these same fixed bands:\nmicro-area: Keep It Simple $0-$15, Polished & Practical $15-$50, Elevated Finish $50-$150.\nsmall-area: Keep It Simple $0-$25, Polished & Practical $25-$75, Elevated Finish $75-$250.\nroom-section: Keep It Simple $0-$50, Polished & Practical $50-$175, Elevated Finish $175-$500.\nwhole-room: Keep It Simple $0-$100, Polished & Practical $100-$350, Elevated Finish $350-$1000.\nlarge-room: Keep It Simple $0-$200, Polished & Practical $200-$600, Elevated Finish $600-$2000.\nUse the row matching your own scopeSize classification to keep each approach's organizingGuidance, taskChecklist, and productRecommendations realistic for that spending level - Keep It Simple's own recommendations, if any, should stay cheap and minimal even within a large-room band; Elevated Finish's should feel like a genuine investment even within a micro-area band.\n\nAlso write one proTip: general organizing wisdom for this type of space, not tied to any single approach.`;
      const prompt = `${priorPhotoPreamble}You are a warm expert home organizer. Analyze ${priorPhotoBase64 ? "today's" : "this"} photo of a space.\n\n${scopeClassificationInstruction}\n\n${approachesInstruction}${priorContextNote}${knownIdentityNote}\n\nNever use em dashes (—) anywhere in your response; use a comma, period, or parentheses instead.\n\n${roomAreaInstruction}Return ONLY valid JSON, nothing else (no markdown, no backticks).\n\n{"suggestedRoomName":"short label, e.g. Living Room","suggestedAreaName":"short label for the specific zone/fixture shown, or null if whole-room","areaScope":"whole-room, sub-area, or ambiguous","roomReason":"one short phrase citing specific visible evidence for the room classification","areaReason":"one short phrase justifying the areaScope classification, citing what is or isn't visible","overview":"2 warm sentences","itemsFound":["3-6 specific items or clutter types you can actually see in the photo"],"problemsFound":[{"id":"short-hyphenated-id","description":"one sentence grounded in what is visible"}],"scopeSize":"micro-area, small-area, room-section, whole-room, or large-room","approaches":{"simple":{"strategyDescription":"1-2 sentences","organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","searchTerms":"search phrase","icon":"cable, basket, bin, shelf, hook, label, drawer-organizer, hanger, bag, or other","relatedProblemId":"matching problemsFound id","approachId":"simple"}],"visualizationDirection":"one descriptive sentence"},"polished":{"strategyDescription":"1-2 sentences","organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","searchTerms":"search phrase","icon":"icon id","relatedProblemId":"matching problemsFound id","approachId":"polished"}],"visualizationDirection":"one descriptive sentence"},"elevated":{"strategyDescription":"1-2 sentences","organizingGuidance":["tip1","tip2","tip3"],"taskChecklist":["step1","step2","step3"],"productRecommendations":[{"productType":"category","reason":"one sentence","searchTerms":"search phrase","icon":"icon id","relatedProblemId":"matching problemsFound id","approachId":"elevated"}],"visualizationDirection":"one descriptive sentence"}},"proTip":"one expert insight"}`;

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

      if (budget) {
        logEvent(getAnalytics(), "custom_budget_entered", { amount: Number(budget) });
      }
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
      // Room-First Identity (Implementation Phase A, Constraint 2):
      // roomReason/areaReason are evaluation-only - logged here, to this
      // file's own dev-only debug buffer (debugShareLog, never Firestore),
      // for staging/prompt-tuning visibility, and never referenced again
      // after this line. They are NOT added to any object that later
      // reaches Firestore - savePlanToHistory builds its own explicit
      // field list and does not spread parsed/plan wholesale, so there is
      // no code path by which these two fields could leak into a saved
      // plan document.
      dlog(`[ROOM-FIRST] suggestedRoomName=${parsed.suggestedRoomName} | suggestedAreaName=${parsed.suggestedAreaName} | areaScope=${parsed.areaScope} | roomReason=${parsed.roomReason} | areaReason=${parsed.areaReason}`);
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

      setResults(parsed);
      logEvent(getAnalytics(), "plan_completed");
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

  const generatePDF = async () => {
    if (!results) return;
    try {
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






      const HEADER_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABLAAAABkCAIAAAAZo16yAAAaJUlEQVR4nO3deXxU1dnA8efOZJYkkx1Iwh6WsO+ERfZFEBBZihWKuFRsrQu1vFjtq7Zq7etbsdpKVVq7uEC1VUCURWQRCBAWA0KEsISdAAlkIyGZzHbfP2ZIJjOTkAyTxLzz+/5177nPPfPcCfl8eHLOPUeJ6j5TAAAAAADBR9PYCQAAAAAAGgcFIQAAAAAEKQpCAAAAAAhSFIQAAAAAEKQoCAEAAAAgSFEQAgAAAECQoiAEAAAAgCBFQQgAAAAAQYqCEAAAAACCFAUhAAAAAAQpCkIAAAAACFIUhAAAAAAQpCgIAQAAACBIURACAAAAQJCiIAQAAACAIEVBCAAAAABBioIQAAAAAIIUBSEAAAAABCkKQgAAAAAIUhSEAAAAABCkKAgBAAAAIEhREAIAAABAkKIgBAAAAIAgRUEIAAAAAEEqpLETaJJyDnxs0OvcW+Yu+P3azXsbK58mYfFz8x+eM8m9Zee+w1Me+HVj5QMAAAAg8AXhv5Y8PXnsII/GjsMfzCu45jN+35olnZNaurfkFxZ3GPZAwBMDAAAAALhjhLBpuG/W+Ddf/Jl7y6Wc/G5jHw7sLQAAAACCCu8QAgAAAECQoiAEAAAAgCBFQQgAAAAAQYqCEAAAAACCVJNZVKaGnR4mjUmZOWnYwN6dE5rH2O2OC5fztqYdXPrh2jMXcmrTc4u46LsmDEnp06VPt6SY6IjoyHCr1XYxN393euaK9Tu27c7wL+FeXZNSV7zm0dh/0mOnzl32aPRel/XDFZuf+PXbIvLCwnuffGiGz/4T42MLD6/waFzwm3c6tE2o6y0ffLqp4rSG77lvj47zZ9+R0je5TWLzsFDDv7/Y/tNn/uQeOaBX57kzxowc3KtlfJzd7rh8pWBX+uFP1qTu2HfYZz4AAAAAGleTKQh96pzUcslvHxvSr6t7Y9eOrbt2bP3jeyY++cLSf332dQ23JzSPeWHhvJmThul1Vb4Hg16XnNQqOanVfbPGHz5+9plX/pG697uAJKyqAemmoWm1msXPzv/xPRPdGxWl8livC3n12fn3zxqvuLVGmEI7J7W8f9btX2za/fPfLG2wbAEAAADUUhMuCAf2Tl7y0qOx0RE+r+p1IW+9/Fju1cJNOw74DJgwsv/SVxZUd3uFHsntlr/5dNsh82413abszRd/NnfGWI/GitpPrwtZvuTp20f0r+72qeOHdGybePx0dj2mCAAAAKDumvA7hL+YP6Pmck5RlMXPzddoFO9LIwb1XPbm0zetBgNObYJDhPdMHeVdDbr71eOza6gGnbont5s+8baA5gUAAADgVjXhgrA2ktokjBzcy6MxKiL8/TcWeUwTbRiqNL2C8K7bh/hsd44Qdk5queDBaQ2bEQAAAIDAaMJTRkVEVdV3Plzz9483XLh0tWP7lv/zywdGD+3tETM8pefWtEPuLb942PfQ4qYdB/7x76/2Z5zIK7gWYQrrkdzurglD5s0YF9CE6xb/wuvLXnh9mYjcN2v8my/+zP3SpZz8bmMfru6uut5yU4cyTy9e+mna/iMlpeYObRNHDu6Z2DxWRH4yd7JW6/lnhYs5eS+8vmzTjgPXS81JbRPmz75j/pw7/PtcAAAAAPWnaReEL76x/I9/X+U8PnL87OzHX8nYuLR5bJR7TPfObTzumn3XaO+unlv8/p/f+7ziNL+wOHXvd6l7v3tt6acvLbo/UAk7HI5AddWQtuw6OOexV8otVufpkeNnjxw/6zyeNmGoR3DJ9bJJ9z139kKu8/Ro1vlFL79bUFTy1COzGixhAAAAALXRhKeMnrmQs+S91e4tZrNl9/5MjzCPwcAeye0Smsd4xKz/ep97Negu52qhx+YKt8LhaHpTRsst1kf/e0lFNeguqU1Ci7hoj8Z//uerimqwwuvvriwuKaunDAEAAAD4pwkXhGs27bHbPQfcLubke7SEhxndTzu1b+nd1QcrNgc2t/9Pvtz6zeUrBT4vJbWJ9270mKDrVGYu3/Pt0QBnBgAAAODWBL4gtFht3o1aTbUfFBLiecniazDKW2bWee/GMnO5R4v7zngi0iw20vuuE426I4Km+i/n+2Dvt8equxQdZfJuzM7J8xl88bLvdgAAAACNJfClSOG1696NEabQ6uJN4Z6XfPbg7VpxqXej95ihB4/60KnBdoPQ6bTejZGmsIb5dP/kVDM8KNV8mdWtnOM7GAAAAEDjCXxBmF9Y7N3YoW2iz+AIU6jHGjDV9eDNofqo/W5a2V3JK/JuTO7QujafWCc+i8xQo6FhPj2Aysot1V0q8PWTapXQzGdwYnxswHICAAAAEAiBLwgPZZ72bvTeDcLVPqRPLXsIlKwzF70b582saeN1/5SWmb0bW8XHebQMS+nhcxarBz/GMBtg2PP0+RzvRp8/61CjYXDfrvWdDwAAAIA6CXxBmJZ+xLvx/lnj27Zq4dFoNOh8bkWwy1cPgXL4+FnvJVImjx30yLwpPuOjI01LXnrUjw8qKCrxbrx9RH/3U6NR//JTtdrTorzc873K2JgIjaamSZh+3FJXp89fzs0r9Gh84O4J7Vp7/qwXPjyzhmnDAAAAABpF4AvCnKuF3utMmsJDN3z4u3tnjk1oERui1cZEme4YNXDdBy/37pbkEZlXcG1j6oGAZ+Xuo9VbvRv/95kf/+edZ+8YPbBFXHSIVhsdaRrct8sLC+899NU73lvt1UZBUYl35fmTuZN//tD02OiIUKNheEqPNf98qV+PjrXprajY871Kg173q8dmN4uNrO7dPD9u8cPnX+32aIkwha7/4OW7p4yIiTLpdSFdOrRe/Nx8NiEEAAAAvofqZWP6199d6T1vMDE+9s+/feym9y5dttZ7pdDA+uPfVt0/a7zH/oQiMmFk/wkj+3vH+1y9pjZS935395QR7i0ajfLiwnkvLpxX166Onbzg3fjUI7PcC60Tpy+m3PnErdzih78uX/fgDydotVX+stAyPu7dV5+8lW4BAAAANIB62fBg+56MpR+u9ePG3QeO/unvnwU6HU9FxdcfWPgHn9tjBNZ7n2wMVFdnLuR47/Ye8Fv8cPx09pv/XF3fnwIAAACgPtTXDnjPLn5v2cotdbplz7fH5i14tQHqNBHZvidj3s9f9fmaXwDt3Hf403U7ao7ZvPNbnzu5e3tn2Zq6JuDHLX545c8fb0zdX3PM0azzn23Y1QDJAAAAAKi9+ioI7XbH48+/9dBTb5w47WNVTw9X86/9bslHU+57/kq+jz0h6smGbelDp//i319sr7kEPXL87NwFv/f7Ux5//q11W/b6vGSz2996/4vZj/6Pz/VIvf11+bqPP99Wp0/34xY/WKy2exe8+sGnm6pb1/TLrd/c+eCvG/KHCwAAAKA26uUdwgor1u1YuX7nyME9Rw3pPbB35/at46Miw01hoWXm8mslpRdz8vd/l5WWfmTdln3lFs8lMRvA5dz8nz7zp+cXvz9twtCUvsm9u3WIi4mIigi3Wm3ZOXm70zNXbdi1Ne3QrezfYDZbfvTE7yeNSZkzbXRK7+S42MjSMnP25bzNO75dvmrLsVM+XvOrjsOhPvKrNz/+fOucaWMG9OqU0DwmPMxY8/Iwftzin3KLdcFv3nn/003zfjBuxKCeLeNjHQ718pWCPQeOfro2dcuugwH/RAAAAAC3TonqPrOxcwAAAAAANIL6mjIKAAAAAPieoyAEAAAAgCBFQQgAAAAAQYqCEAAAAACCFAUhAAAAAAQpCkIAAAAACFIUhAAAAAAQpCgIAQAAACBIURACAAAAQJCiIAQAAACAIEVBCAAAAABBioIQAAAAAIJUSAD7Mo4UwyDXsXmnlKdVXgodJ/p+Ny5tk/J9lZe0CWIYINpWogkX1S6OArFmiWW/qOW+exYRcYijVOwXpXy32HOribnBclDKNvpOWBMrxttEmygak6hWUUvFflWsR8SaVU2fqqhlYrsk5XvEfrGy2TRXtImu4+J/iiPP12dFib6/6NqLEikiopaILVssGWLP9ifzOmk3cnrrQROcx+d2rjmftq7iUodx9yT2G+U8PrNtZfa+TZUPldCu5YAxka066cMjHXZbWcGV/KyDl/Z/bSsv89mziKgOu7W0pPjiqfO7v7yee95nTIXLB1NPbvzIo3HwY4tDQsOre5DSq5cOvPfbig7P7fji/O71fjxgnVKqvdkzJ06dONJ5vOKLzSvXbKm49MCcqbePHuI8/teKL9d+lVqZYfvWd4y9rWvndlGRETab7XJuXvrBzC+37CotNfvsWUTsdvu14usnTp1fvW7rmfMXfcZU2Lx97z+Wr3Zv0Wq1L//3o21bJ4jI8k/Wrdu0s6L9lecfb5XYQkQ++HjNhq/T6preJ6s3fbbua2fj9Mlj7p42XkS+2LD945Ub6vJFAgAAoOHU1wihvreI4jpWdKLr7jvMkCKmuaLrJppIEa0oetHGi3GYmO4XTVz1vWtEYxJdsoTPEU2Unxlq4yXiPtF1FU2UiFYUo2hiRZcsIUnV36OIEia6jmKaUxmmia6sBkVE7+tJdV3F9KAYBogmThSdKDrRxIi+pxiH+pm83+J7D1MU1w9do9O36O6rEhVplXJ7n7m/bN5tkCEyVtGGaPVGU3ybtsPu7Hv/s6FxCdV1rmi0elNUXHK/3nP+yxhVw8+vHtXyAevb6OEDNRpXGnq9btjgvj7D7pww4qVnHhk2uE9cbHRIiNZoNLRv2/IHU8f97/NPtEpsXl3nWq02JjpyUP8ev/nlT5o3i6lrbna7/d0PVzkcDhGZddf4uJioimSc1WDWqfNfbd3td3oAAABoQgI5QuhOEyEhHcR2UkRE11UUg6/P7iDGUSIiqlXKNogtSxSjGIaLvqdoIiV8uhS/J2Kvcot5h5TvFk2EhE0TbYIoOtF1kvJ0HzE3ZRjkevrSNWI7KRIimljRdxHV6iPY2adiEOMY0fcUUcQ4SkpOi4hnravrJubUKi3aRAmb7Cq9y/eI5VtRy0QTLdpWom3mT+a3whARE9OhR/7JDBFp3nWg1hDqHRPToWf7UTNExG4tz9qwLD/rUIgxvN3wqS16DjVExnab/siB915W7Tb3W5yDdYaImK7TfmJKaKfR6WM79bmYvsU7pub09rz1lPNAqzMM+fkbIuKw29LeWBDYB6xTSv6Ji4nq0zP5wKGjIjI0pXdYqNE7pm/PLnN+cIeImMst736wcv/Bo+HhoXdPGz/qtgFxsdELH5339It/stmq/AI4h+DiYqKefORHHdq31ut1A/t2X39jiM89pub0Tp25sGFL2qTxwwwG/f1zpr7+9rIWzWKnTxktIjab/d0PV6qq6kd6AAAAaHLqZYRQLRVxDhJK5YGz0V3F+Fj5LrEeFdUmjhIp2yCOAhERTYzou/ru31EstrM3Tvx9Ak2siIhqFusxUa2ilok9W8q2eJZz7tRyKd/hOtY2EyVEpGJI0O6aaKqJlJDWVe4yjnAlaflWzKniKBbVJvarYjkoZZv9TN4/1tJrIhLfe7jzNKH38IpGd22GTnIenN+19urRdIfNaikpPLFhWVlBroiExrRo3nWAz/7LiwsKz2Y6jxWNth6e4CZq+YD1rehaiYiMHZHiPB03clBFo7sZU8Y4D1au2bL7mwyL1VpQeO3dD1ZdyrkqIgkt4oYO7C2+5BUUZWS6pjVrNX7+Avxn9cYrVwtEZECfbgP6dHvgR1P1Op2IfP7ltgsXc28lPQAAADQh9VIQWjJERHQdRBMh2hauGZWW76rEKAbR3ph7aDnsdkGtPA1p77t/TYSEtHMd2874maR6XUREMUr4LNH3rHGGqjulypk2UTTRIiK2c2K98YC6Hm7heglp4zp2f3OyUeRkpIlITIce+ojo8BatTYntRdSc76oMSmoNoREJ7Z3HuYf3VF5Q1dzDrsjo9t189q+PiI5u57ykFp45EuDsa6E2D9gAtu1KF5G+PZNjY6LatUns2L61qqrb0/a7x4SFGjsmuf5ykOp2SVXVHbsPOI97de/ss//YmCjnJVVVDx054V+SFov178s+cx4/+tAP+/RIFpHsS7mr12+9xfQAAADQhNTLlFF7jthzRBsv+l6ihIuI2M66xv0qaCJcxZVzNRd3jiLXgRLh2bNxuBiH3wgrFvNWsV+pKUZErq8Q22kfSVoyXAVnSDtXeamWifWomNN8DGa68jGIYdiNZ7wqqq3yjUHrcbGdEdUqik50yVK2yTXZVbnxmGKrfK7q1DJzv5XknCvJOWeKb5vQa5guPFJECs8eMxdU+QYNEdGiKCLisFqspcXul8qL8m7ExHr03Hb41LbDp7rCigvObF15/Up2DTEicmTFnwtOB7horM0DNkBKp89ePH02O6ldqzHDB0ZFmkTk8NFTOblV1hqKjYlUFEVELBbrteLr7pdyr7p+VZrFer4ge/e08c6VWkQkr6DoX5+uP3fhcg0xIvLqm+8fPHzcZ54ZmVmpuw+MGNLPaNCLiKqqf/twlXMWqH/pAQAAoMmpr0VlLAdFRHS9Rdet8jTAFHF4zsKrA+sxKV1XpUhTQkXfT8Jn+fhWjMMlapFEPiH6niIioop5u4hGdF1dp9aTotpcw5WKQXQd/U+sXl0+mCoi8b2HNe+WUnFaa8rNQ0QURbGUFPqRW0Dc2gMGzObUfSIyZvjAYYP6iMjm7Xtrf69y42tWawzTKEp+wa3Ohl32n7UV9d6mbXuOnzwXqPQAAADQJNTXojLWTDGOFo1JREQtFWuW6HtUCXAUi6giiig6UcKqDMpVLByqVhmgEnEuu7JPDH3FOEY0JgmfJsV/E9XiFVO7SYLWI2I9Itrmom0juiTXwqHOOa52z/EtZ0KimsV+Ucr3ii1bdB1FCRURsV1w5W89IbrOIiK67mI9fuMRVBFFJEQ0UTcZJGyARWWuZn6TNPoHelO0iFhLr+VnHWrRY4h7QHlxoaiqKIpGp9eFRbgPEhqiYm/E5Ht0e27HF9n7Nib0HZk0ZpbeFN112sPpf3vBbjF7xNTTCi7ubvqADZNS2t6D986aFBMdKSJF10rSD2aOHNrPPSC/4Jqqqoqi6PW6yIhw91G45nGuhUPz8j3/uXyyetPar1LHjRo074dTYqIjn3zkRwuff91sLveIuemiMhVKrpedPHOhX68uInLwcOXs0zqlV7G0jE5X+eJoxTELzwAAAHyf1dcIoWoVq2t5EbFkiDi8AsrFfmOyW5VaUak89f1+oF3K08V2TkRECavc3tBv9iti2S/XV1QmrPHaCc+8Q4pek6I/yLW35PoqsWWLuK0vGtJGohZJ1CIJm+xq0SWJYhQRUS1ic23IJ4aUW0311tmt5VcyXe8y5mSkqQ7P/6zby8uKL59xHrfoMbjygqJUVFaFZzLFi8Nuu5i+pejcMRHRhUUm9hsd0MRr66YP2DDM5Zade13D4tt2ptvtnmmUlplPnr7gPB4xtH9Fu6Iow4e4/k1n+Ho/0Gqzfbl51+Gjp0QkKtI0cUy9bF1Sp/QKi1x/NWgWV7kHRvM4158PCgobelEfAAAA1F59FYTiNk3Ucsh3gPnGzvWGoaLrIhIiGpOEThRNjIiIo1AsR6vtvGKBFn0/Px8i7E4xjpWQtqKJENGKtplo412XPF539EnR1zgvVCu6Lq5D8w5XPazvK8YRoom4scVFbwkdV6tUdd1dBWdASsobsyjVnEM7fAacT3MNmrUZOrlZlwGaEJ3eFNV54r2hMS1ExFx45crRdJ83ikjF1vaJ/UY1ykKjUosHvKnm3QcNW/T2sEVvt0oZf/PoajiniaqqumWH79WEKsbxZk4ZM2RgL50uJCY68uH7ZiTGNxORnNy8tG+q+c0RWbvRNRX29tGDtdp6+Z5rn15GZpaqqiKS0rd7r26dDAZ9r26dBvbtJiKqqmYccS2IOnxw3+V/+d3yv/xuyoQR9ZEwAAAA/FBfU0ZFxJ4rRa/VFGA7JebtYhwpil7Cpla55CiW66s8NyGscu9pcRSIJsa1Q73VrXT0WJrFni0lH/noQQkXQ1cx9Pdst530sVCNN2cFKyLWo1K6prI9pL2EzxIR0fdwlcT2i1K6XsImioSIYbAY3EbdPIZAa5n5Lbqee2Hna4/WEFBw6rsz21e1Hzldqzd2mfqQ+6Xy4oLMVUs9NiGscu/pI2UFuaExLfSmqGbJ/a4c/abikscKLteyT2Z89IdbeI5q3fQBGyals+cvzf3pszUEHMg49tHKDbNnTDAaDU88PNv9Ul5B0R/eXlbDZMtDh09cyrmaGN8sJjpycP8eu/ZVlo4ei8ocP3n2xVf/6kf+tU8vJzdv/eZdk8cPMxj0zzz5oHvk2q9Sc696TjAGAADA90c9FoS1Ub5XbOfF0F+0rUUTJqpDHAVizRLLflHNN7t3v2uEzTCgSkFY24/eJfZOEtJKNBGihIpqF0ehWI96bnNfHd2NnRcsVZeltJ0VR4loTKJtWfnSoDVTii+Job+EtBMlUkRELRFbtlgz6px2w8jeu7Ho/ImW/cdEtu6kD4twOOzmgty8rEOX9n9tM1ezBquLemn/1x3G3SMiiQPGuheE8LZmw/bMY6fuGHdbl87toyJMNrv9cu7V9G8zN2xJu15aVsONqqpu2JL2wJypIjJx3G3uBWGjpLf8k3VnzmWPGZ7SrnWi0ag3my1nL1zakrpv1976WE4KAAAAAaNEdZ/Z2DkAAAAAABpBPb5DCAAAAAD4PqMgBAAAAIAgRUEIAAAAAEGKghAAAAAAghQFIQAAAAAEKQpCAAAAAAhSFIQAAAAAEKQoCAEAAAAgSFEQAgAAAECQoiAEAAAAgCBFQQgAAAAAQYqCEAAAAACCFAUhAAAAAAQpCkIAAAAACFIUhAAAAAAQpCgIAQAAACBIURACAAAAQJCiIAQAAACAIBUStaixUwAAAAAANAZGCAEAAAAgSFEQAgAAAECQoiAEAAAAgCD1f1D+hd89L7OYAAAAAElFTkSuQmCC";

      const makeHeader = (pageBreak) => `
        <img src="${HEADER_IMG}" width="100%" style="display:block;width:100%;${pageBreak ? 'page-break-before:always;' : ''}"/>`;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
        <style>
          * { box-sizing:border-box; margin:0; padding:0; }
          @page { size: letter; margin: 0; }
          body { font-family:Inter,Arial,sans-serif; background:white; color:#0F2A52; margin:0; padding:0; }
          .page { padding:4px 24px 24px 24px; }
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
          <div style="text-align:center;padding-top:12px;border-top:1px solid #D7DCE3;color:#64748B;font-size:10px;">
            Generated by Uncluttrd Pro &middot; More Space. More Time. More You. &middot; uncluttrd.app
          </div>
        </div>

      </body></html>`;

      const { uri } = await Print.printToFileAsync({ html, base64: false, width: 612, height: 792 });
      logEvent(getAnalytics(), "pdf_exported");
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch (e) {
      Alert.alert("PDF Error", e.message);
    }
  };

  const generateVisualization = async (tier) => {
    if (!isPro) { setShowPaywall(true); return; }
    if (!photo?.uri) {
      Alert.alert("Photo unavailable", "We couldn't find the original photo for this room. Please reopen it from My Rooms and try again.");
      return;
    }
    setVizLoading(prev => ({ ...prev, [tier.id]: true }));
    startVizTips();
    try {
      const productList = tier.products?.map(p => p.name).join(", ");
      const suggestionList = tier.suggestions?.join(". ");
      const itemsFound = results.itemsFound?.join(", ") || "";
      // Room-First Identity (Implementation Phase A): results.spaceType is
      // only populated once a plan is actually saved (savePlanToHistory
      // sets it from suggestedRoomName) - a freshly-analyzed, not-yet-saved
      // `results` (the raw parsed AI response) carries suggestedRoomName
      // directly instead. Both read here since generateVisualization can
      // run against either shape, depending on how quickly the user taps
      // "See the transformation" relative to the background save.
      const roomLabelForViz = results.spaceType || results.suggestedRoomName || "room";
      const prompt = `Reorganize and declutter this exact ${roomLabelForViz}. Keep the same room (the same walls, floor, window, door, ceiling, and architecture) exactly as shown in the photo. Do not invent a different room or change its layout, dimensions, or finishes. Only change the contents: remove clutter, and apply these specific changes: ${suggestionList}.${productList ? ` Add these storage solutions in a realistic way: ${productList}.` : ""}${itemsFound ? ` The space currently contains: ${itemsFound}. Organize these rather than removing them entirely unless the suggestions say to.` : ""} Photorealistic result, warm natural lighting, magazine-quality home organization photography. No text, no labels, no annotations, no callouts, no arrows, no watermarks, no overlays. No people.`;

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
        const result = await generateVisualizationFn({ imageBase64: vizInput.base64, prompt });
        b64 = result.data?.b64;
      } catch (vizErr) {
        console.log("Viz function error:", vizErr.code, vizErr.message);
        Alert.alert("Visualization failed", "Please try again.");
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
          const tempPath = FileSystem.cacheDirectory + `viz_raw_${tier.id}_${Date.now()}.png`;
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
        const path = `viz/${user.uid}/${currentPlanId || "unsaved"}/${tier.id}_${Date.now()}.jpg`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
        finalUrl = await getDownloadURL(fileRef);
      } catch (compressErr) {
        console.log("Visualization compress/upload error:", compressErr.message);
        // finalUrl stays as the raw OpenAI image. Works for this session, just won't persist cheaply.
      }

      setVizImage(prev => ({ ...prev, [tier.id]: finalUrl }));
      logEvent(getAnalytics(), "visualization_generated");

      if (currentPlanId) {
        try {
          await updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), { [`vizImages.${tier.id}`]: finalUrl });
          setHistory(prev => prev.map(h => h.id === currentPlanId ? { ...h, vizImages: { ...(h.vizImages || {}), [tier.id]: finalUrl } } : h));
        } catch (saveErr) {
          console.log("Save vizImage to plan error:", saveErr.message);
        }
      } else {
        console.log("No currentPlanId yet. Visualization shown locally but not persisted to a saved plan.");
      }
    } catch (e) {
      Alert.alert("Visualization failed", e.message);
    } finally {
      stopVizTips();
      setVizLoading(prev => ({ ...prev, [tier.id]: false }));
    }
  };

  const openProduct = (q) => Linking.openURL(`https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=uncluttrd20-20`);

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

  const getBestMatch = () => {
    if (!budget || tierTouched) return null;
    const b = parseFloat(budget);
    if (b < 50) return "budget";
    if (b <= 200) return "mid";
    return "premium";
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
      setRenamePlanTarget(null);
      setRenameSheetValue("");
      setRenameDuplicateDialog(null);
    } catch (e) {
      setMergeRoomsError(e.message || "Something went wrong moving your plans. Please try again.");
    } finally {
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
      <Modal visible={!!renamePlanTarget} animationType="slide" transparent onRequestClose={closeRenameSheet}>
        <View style={s.renameSheetBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeRenameSheet} accessibilityLabel="Close" accessibilityRole="button" />
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
  // (results && !showCompanion, ~4967) - where the actual budget tiers/
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
  // Room Detail UX Revision, Section 1: Room-level actions, placed as
  // quiet/destructive text links at the bottom of Room Detail's own
  // content (see the Room Detail render block) - not behind a three-dot
  // menu. Both remain placement only this pass: Move is not wired to
  // reclassifyLegacyPlan yet, and Delete's confirmation is real (exact
  // copy specified) but the actual deletion is Phase C - confirming today
  // only leads to a "Coming soon" acknowledgement, never a real write.
  const handleMoveRoomPlaceholder = () => {
    Alert.alert("Coming soon", "Moving a room's visits to another room will be available in a future update.");
  };
  // Phase C1 (DeletionDesign.md Soft-Delete Revision): real soft delete,
  // replacing the prior "Coming soon" placeholder. One atomic writeBatch
  // (softDeleteRoom) - nearly instant, so no processing overlay is used
  // here, matching the design's own "no meaningful async work to cover"
  // conclusion. On success, the Room is immediately gone from My Rooms
  // (existing !retired filter, no new filtering code) - navigate back
  // there rather than leave the user on a Room Detail screen for a Room
  // that no longer resolves.
  const handleDeleteRoom = (room) => {
    Alert.alert(
      `Delete ${room.displayName}?`,
      "This will remove this room and all its organizing history. You can restore it from Recently Deleted within 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive", onPress: async () => {
            try {
              await softDeleteRoom(user.uid, room.id);
              setRooms((prev) => prev.filter((r) => r.id !== room.id));
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
      `Delete ${area.displayName}?`,
      "This will remove this area and its organizing history. You can restore it from Recently Deleted within 30 days.",
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
    try {
      await restoreRoom(user.uid, room.id);
      const spaceSnap = await getDoc(doc(db, "users", user.uid, "spaces", room.id));
      const restored = { id: room.id, ...spaceSnap.data() };
      setRecentlyDeletedRooms((prev) => prev.filter((r) => r.id !== room.id));
      setRooms((prev) => [restored, ...prev.filter((r) => r.id !== room.id)]);
    } catch (e) {
      Alert.alert("Couldn't restore", e.message);
    }
  };
  // Restore Area (Phase C2, Recently Deleted Areas' own action, Room
  // Detail screen). Local patch only, same convention handleDeleteArea
  // already established - AREAS IN THIS ROOM re-derives its rows from
  // roomDetailPlans + roomDetailAreas.retired, not from any cached
  // visitCount here, so a full re-fetch isn't needed for the Area to
  // reappear.
  const handleRestoreArea = async (area) => {
    try {
      await restoreArea(user.uid, roomDetailRoomId, area.id);
      setRoomDetailAreas((prev) => prev.map((a) => (a.id === area.id ? { ...a, retired: false, deletedAt: undefined, deletedWithRoomId: undefined } : a)));
    } catch (e) {
      Alert.alert("Couldn't restore", e.message);
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
  const reset = () => { dlog(`[PHOTO DEBUG] reset(): companionBasePhotoRef ${companionBasePhotoRef.current} -> null | companionOriginalPhotoRef ${companionOriginalPhotoRef.current} -> null`); activePlanIdRef.current = null; setPhoto(null); setResults(null); setShowCompanion(false); setErr(null); setBudget(""); setTierTouched(false); setVizImage({}); setVizLoading({}); setPhotoSize({ width: 1, height: 1 }); setVizModal(null); setVizModal(null); setCurrentPlanId(null); setOrganizeAgainContext(null); setRoomConfirmation(null); recognitionPendingRef.current = null; setRoomFreeformInput(""); setPendingRoomConfirmationResult(null); setJustConfirmedRecognition(null); setCompanionStage("batch-active"); setBatchItems([]); setCompanionBatchIndex(1); setUnresolvedReview(null); setProgressPhoto(null); companionBasePhotoRef.current = null; companionOriginalPhotoRef.current = null; companionOriginalCompressedRef.current = null; setCompanionCompletionRecommended(false); setCompanionCompletionReason(null); setCompanionCompletedProject(null); analysisIdRef.current = null; lastFailedAnalysisRef.current = null; clearCompanionRevealState(); };
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
  }, [showPaywall, showMenu, showHistory, showFaq, showAccount, showSpaceInspector, showMergeReview, roomDetailRoomId, roomConfirmation, results, showCompanion, unresolvedReview, resultsCameFromRoomDetail]);

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

  // PAYWALL SCREEN
  if (showPaywall) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}>
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
          <Text style={[s.sectionLabel, { alignSelf: "flex-start" }]}>CHOOSE BILLING</Text>
          <View style={{ flexDirection: "row", gap: 10, width: "100%", marginBottom: 20 }}>
            <TouchableOpacity
              style={[s.planOption, paywallPlan === "monthly" && s.planOptionSelMonthly]}
              onPress={() => setPaywallPlan("monthly")}>
              <View style={{ height: 22, marginBottom: 6 }} />
              <Text style={s.planOptionLabel}>Monthly</Text>
              <Text style={s.planOptionPrice}>$4.99/mo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.planOption, paywallPlan === "yearly" && s.planOptionSelYearly]}
              onPress={() => setPaywallPlan("yearly")}>
              <View style={s.planSaveBadge}><Text style={s.planSaveText}>Save 33%</Text></View>
              <Text style={s.planOptionLabel}>Yearly</Text>
              <Text style={s.planOptionPrice}>$39.99/yr</Text>
              <Text style={[s.planOptionSub, { color: BRAND.green }]}>$3.33/mo</Text>
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
              <Text style={s.paywallCtaText}>{paywallPlan === "yearly" ? "Go Unlimited - $39.99/year" : "Go Unlimited - $4.99/month"}</Text>
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
            <Text style={s.hdrTag}>{isPro ? "Pro member" : `${Math.max(0, 3 - (analyses || 0))} Free Rooms Remaining`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(false)} style={{ padding: 8 }}>
            <X size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.scrollContent}>
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
                <TouchableOpacity key={room.id} style={s.historyItem} onPress={() => openRoomDetail(room)}>
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
              );
            })
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
          <ScrollView contentContainerStyle={s.scrollContent}>
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
      <TouchableOpacity key={plan.id} style={[s.historyItem, { flexDirection: "row", alignItems: "center", gap: 12 }]} onPress={() => openRoomDetailVisit(plan)}>
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
                      <Swipeable
                        key={area.id}
                        containerStyle={s.areaSwipeContainer}
                        overshootRight={false}
                        rightThreshold={40}
                        renderRightActions={(progress, translation, swipeableMethods) => (
                          <TouchableOpacity
                            style={s.areaSwipeDeleteAction}
                            onPress={() => handleDeleteArea(area, swipeableMethods)}
                            accessibilityLabel={`Delete ${area.displayName}`}
                            accessibilityRole="button"
                          >
                            <Trash2 size={22} color="white" strokeWidth={2.25} />
                          </TouchableOpacity>
                        )}
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
                              no shared row width to truncate against. */}
                          <View style={{ flex: 1 }}>
                            <Text style={s.historySpace} numberOfLines={1}>{area.displayName}</Text>
                            <Text style={s.historyOverview} numberOfLines={1}>{`${area.visitCount ?? 0} visit${area.visitCount === 1 ? "" : "s"}`}</Text>
                            <TouchableOpacity
                              onPress={() => startOrganizeAgain(mostRecent || { id: room.id }, area.id)}
                              accessibilityLabel={`Organize Again in ${area.displayName}`}
                              accessibilityRole="button"
                              style={{ marginTop: 4, alignSelf: "flex-start" }}
                            >
                              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green }}>Organize Again</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </Swipeable>
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
                  three-dot overflow. Move remains placement only (not
                  wired to reclassifyLegacyPlan). Delete is real as of
                  Phase C1 - soft delete only (handleDeleteRoom), the
                  30-day hard-purge sweep is a later phase. */}
              <TouchableOpacity onPress={handleMoveRoomPlaceholder} style={{ marginTop: 28, alignItems: "center", paddingVertical: 10 }} accessibilityLabel="Move to another Room" accessibilityRole="button">
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
      </SafeAreaView>
    );
  }

  // FAQ SCREEN
  if (showFaq) {
    const faqs = [
      { q: "How does Uncluttrd work?", a: "Take a photo of any room or organizing area, such as a closet, garage, kitchen, or pantry. Uncluttrd's AI analyzes what it sees and creates a personalized organization plan across three budget levels with specific product recommendations." },
      { q: "What can I organize?", a: "Any space! Closets, garages, kitchens, pantries, home offices, bedrooms, laundry rooms, storage units. If you can photograph it, Uncluttrd can help organize it." },
      { q: "What's the difference between the budget tiers?", a: "Budget (under $50) uses quick wins and items you may already have. Mid-Range ($50-$200) adds quality organizers and storage systems. Premium ($200+) features custom solutions and high-end products for a fully transformed room." },
      { q: "Can I enter my own budget?", a: "Yes! Below the budget tier buttons you'll find a custom budget field. Enter any dollar amount and Uncluttrd will highlight which tier best fits your budget." },
      { q: "What is Uncluttrd Pro?", a: "Uncluttrd Pro ($4.99/mo) gives you unlimited analyses, full room history saved to your account, AI visualization of your transformed room, and branded PDF sharing. Free users get 3 free transformations per month." },
      { q: "What is the AI Visualization feature?", a: "After getting your organization plan, tap 'See the transformation' on any tier to generate an AI-created image showing what your room could look like after organizing. This is a Pro feature." },
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
        <ScrollView contentContainerStyle={[s.scrollContent, { paddingBottom: 140 }]}>
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
          <Modal visible={showDeleteModal} transparent={true} animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
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
          <TouchableOpacity disabled={areaConfirmationSaving} style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0, opacity: areaConfirmationSaving ? 0.6 : 1 }]} onPress={onConfirm}>
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
          <ScrollView contentContainerStyle={s.scrollContent}>
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
          {areaConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
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
          {areaConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
        <ScrollView contentContainerStyle={s.scrollContent}>
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
        {areaConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onConfirm}>
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            {knownRooms.length === 0 && (
              <Text style={{ fontSize: 13, color: "#64748B", marginBottom: 12 }}>You don't have any saved Rooms yet.</Text>
            )}
            {knownRooms.map((room) => (
              <TouchableOpacity key={room.canonicalSpaceId} style={{ backgroundColor: "white", borderRadius: 12, borderWidth: 1, borderColor: "#E6E9EE", padding: 14, marginBottom: 10 }} onPress={() => onRoomPickerSelect(room)}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: BRAND.ink }}>{room.displayName}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={backToRoomConfirmationMain}>
              <Text style={s.mergeSecondaryBtnText}>← Back</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            <TextInput
              style={s.renameSheetInput}
              value={roomFreeformInput}
              onChangeText={setRoomFreeformInput}
              placeholder={isParentFlavor ? "e.g. Kitchen" : "e.g. Guest Bedroom"}
              autoFocus
            />
            <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0, opacity: roomFreeformInput.trim() ? 1 : 0.5 }]} disabled={!roomFreeformInput.trim()} onPress={onSubmitRoomFreeform}>
              <Text style={[s.startOverText, { color: "white" }]}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={backToRoomConfirmationMain}>
              <Text style={s.mergeSecondaryBtnText}>← Back</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            <EvidenceCardForCandidate
              candidate={routing.candidate}
              confirmLabel={`Yes, this is my ${routing.candidate.displayName}`}
              onConfirm={() => completeRoomConfirmation(resolveExistingRoomConfirmation(routing.candidate, { areaName: pendingParsed?.suggestedAreaName ?? null, areaScope: pendingParsed?.areaScope || "whole-room" }), routing.candidate)}
            />
            <TouchableOpacity style={s.mergeSecondaryBtn} onPress={declineToOutcomeC}>
              <Text style={s.mergeSecondaryBtnText}>No, this is a new room</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            {routing.candidates.map((candidate) => (
              <EvidenceCardForCandidate
                key={candidate.canonicalSpaceId}
                candidate={candidate}
                confirmLabel={`Yes, this is my ${candidate.displayName}`}
                onConfirm={() => completeRoomConfirmation(resolveExistingRoomConfirmation(candidate, { areaName: pendingParsed?.suggestedAreaName ?? null, areaScope: pendingParsed?.areaScope || "whole-room" }), candidate)}
              />
            ))}
            <TouchableOpacity style={s.mergeSecondaryBtn} onPress={declineToOutcomeC}>
              <Text style={s.mergeSecondaryBtnText}>None of these - it's a new room</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            {routing.outcome === "b3" && (
              <Text style={{ fontSize: 14, color: "#64748B", marginBottom: 14 }}>Is it its own room, or part of an existing room?</Text>
            )}
            <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onOwnRoom}>
              <Text style={[s.startOverText, { color: "white" }]}>{`${label} is its own Room`}</Text>
            </TouchableOpacity>
            {routing.firstTimeUser ? (
              <>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("b2-parent-zero")}>
                  <Text style={s.mergeSecondaryBtnText}>Create the Room it belongs to</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("b2-freeform-zero")}>
                  <Text style={s.mergeSecondaryBtnText}>Enter a different Room name</Text>
                </TouchableOpacity>
              </>
            ) : routing.plausibleParent ? (
              <>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={onInsideSpecificParent}>
                  <Text style={s.mergeSecondaryBtnText}>{`${label} is inside ${routing.plausibleParent.displayName}`}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker(insidePickerContext)}>
                  <Text style={s.mergeSecondaryBtnText}>Choose another Room</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker(insidePickerContext)}>
                <Text style={s.mergeSecondaryBtnText}>{`${label} is inside another Room`}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
          <ScrollView contentContainerStyle={s.scrollContent}>
            <Text style={{ fontSize: 14, color: BRAND.slate, marginBottom: 16 }}>Choose an existing Room or continue with a new one.</Text>
            {knownRooms.length > 0 && (
              <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={() => openRoomPicker("failed-secondary")}>
                <Text style={[s.startOverText, { color: "white" }]}>Choose an existing Room</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={onAcceptSuggestedRoom}>
              <Text style={s.mergeSecondaryBtnText}>{`Continue as new: "${pendingParsed?.suggestedRoomName || "Room"}"`}</Text>
            </TouchableOpacity>
          </ScrollView>
          {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
        </SafeAreaView>
      );
    }

    // Outcome (c): no existing match.
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <RoomConfirmationHeader title={`We think this is your ${pendingParsed?.suggestedRoomName || "room"}. Is that right?`} />
        <ScrollView contentContainerStyle={s.scrollContent}>
          <TouchableOpacity style={[s.startOverBtn, { marginTop: 0, backgroundColor: BRAND.green, borderWidth: 0 }]} onPress={onAcceptSuggestedRoom}>
            <Text style={[s.startOverText, { color: "white" }]}>{`Yes, create "${pendingParsed?.suggestedRoomName || ""}"`}</Text>
          </TouchableOpacity>
          {knownRooms.length > 0 && (
            <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomPicker("c-secondary")}>
              <Text style={s.mergeSecondaryBtnText}>Actually, it's an existing Room</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[s.mergeSecondaryBtn, { marginTop: 10 }]} onPress={() => openRoomFreeform("c-tertiary")}>
            <Text style={s.mergeSecondaryBtnText}>Enter a different name</Text>
          </TouchableOpacity>
        </ScrollView>
        {roomConfirmationSaving && <ProcessingOverlay text="Setting up your plan..." />}
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
            <Text style={s.hdrTag}>{isPro ? "Pro member" : `${Math.max(0, 3 - (analyses || 0))} Free Rooms Remaining`}</Text>
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
        <ScrollView ref={resultsScrollRef} contentContainerStyle={s.scrollContent}>
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
          <View style={s.overviewCard}>
            <Text style={s.overviewText}>{results.overview}</Text>
          </View>
          {budget ? (
            <View style={s.budgetBanner}>
              <Text style={s.budgetBannerText}>💰 Based on your ${budget} budget. Best Match highlighted below.</Text>
            </View>
          ) : null}
          {results.tiers?.map(t => {
            const m = meta(t.id);
            const isSelectedTier = t.id === tier;
            return (
              <View key={t.id} style={[s.tcard, { borderColor: isSelectedTier ? m.color : m.border }, isSelectedTier && { borderWidth: 2.5 }]}>
                <View style={[s.tcardHead, { borderBottomColor: m.border }]}>
                  <m.icon size={18} color={m.color} strokeWidth={2.25} />
                  <View style={[s.tcardPill, { backgroundColor: m.bg, borderColor: m.border }]}>
                    <Text style={[s.tcardPillText, { color: m.color }]}>{t.label}</Text>
                  </View>
                  <Text style={s.tcardRange}>{t.range}</Text>
                  {getBestMatch() === t.id && (
                    <View style={s.bestMatchBadge}>
                      <Text style={s.bestMatchText}>⭐ Best Match</Text>
                    </View>
                  )}
                  {isSelectedTier && (
                    <View style={[s.bestMatchBadge, { backgroundColor: m.color }]}>
                      <Text style={s.bestMatchText}>✓ Your Choice</Text>
                    </View>
                  )}
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
                  <TouchableOpacity key={i} style={s.prodRow} onPress={() => { logEvent(getAnalytics(), "product_clicked", { product: p.name }); openProduct(p.searchQuery); }}>
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
          {results.approaches && !batchItems.length && (
            <View style={{ marginTop: 20 }}>
              <Text style={s.sectionLabel}>HOW WOULD YOU LIKE TO APPROACH THIS?</Text>
              {APPROACH_ORDER.map((id) => {
                const a = results.approaches?.[id];
                if (!a) return null;
                const meta = APPROACH_META[id];
                const expanded = previewApproach === id;
                // Section 5 (future service-referral extensibility): an
                // ordered list of recommendation groups, not a single
                // hardcoded productRecommendations.map(...) call. Today
                // there is exactly one group (products); a future
                // serviceRecommendations array joins this list as a second
                // group with kind: "service" without any change to the
                // card layout below - only a new branch in the per-item
                // renderer, same pattern as the existing "product" branch.
                const recommendationGroups = [
                  { kind: "product", items: a.productRecommendations || [] },
                ].filter(g => g.items.length > 0);
                return (
                  <View key={id} style={[s.approachCard, { borderColor: expanded ? meta.color : BRAND.stone }, expanded && { borderWidth: 2 }]}>
                    <TouchableOpacity
                      onPress={() => setPreviewApproach(id)}
                      activeOpacity={0.8}
                      accessibilityLabel={`${meta.name}, estimated ${a.estimatedSpendRange}${expanded ? ", expanded" : ""}`}
                      accessibilityRole="button"
                    >
                      <View style={s.approachCardHead}>
                        <View style={[s.approachPill, { backgroundColor: meta.bg, borderColor: meta.border }]}>
                          <Text style={[s.approachPillText, { color: meta.color }]}>{meta.name}</Text>
                        </View>
                        <Text style={s.approachRange}>{a.estimatedSpendRange}</Text>
                        <ChevronRight size={16} color={BRAND.mist} strokeWidth={2.25} />
                      </View>
                      <Text style={s.approachStrategy}>{a.strategyDescription}</Text>
                    </TouchableOpacity>
                    {expanded && (
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
                              return (
                                <TouchableOpacity
                                  key={`${group.kind}-${i}`}
                                  style={s.prodRow}
                                  onPress={() => { logEvent(getAnalytics(), "product_clicked", { product: item.productType, approach: id }); openProduct(item.searchTerms); }}
                                  accessibilityLabel={`Shop options for ${item.productType}`}
                                  accessibilityRole="button"
                                >
                                  <View style={[s.prodIco, { backgroundColor: meta.bg }]}>
                                    <Icon size={15} color={meta.color} strokeWidth={2.25} />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={s.prodName}>{item.productType}</Text>
                                    <Text style={s.approachProdReason}>{item.reason}</Text>
                                  </View>
                                  <Text style={s.approachShopLink}>Shop options →</Text>
                                </TouchableOpacity>
                              );
                            }))}
                          </>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
              {previewApproach && (
                <TouchableOpacity
                  style={[s.companionBtn, { marginTop: 8 }]}
                  onPress={handleStartThisPlan}
                  disabled={startingPlan}
                  accessibilityLabel="Start this plan"
                  accessibilityRole="button"
                >
                  <Text style={s.companionBtnText}>{startingPlan ? "Starting..." : "Start This Plan →"}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {renderPhotoZoomModal()}

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
        {renderRenameSheet()}
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
            <Text style={s.hdrTag}>{isPro ? "Pro member" : `${Math.max(0, 3 - (analyses || 0))} Free Rooms Remaining`}</Text>
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
        <ScrollView ref={companionScrollRef} contentContainerStyle={s.scrollContent}>
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
            {isPro ? (
              <Text style={s.hdrTag}>Pro member</Text>
            ) : (analyses || 0) >= 3 ? (
              <View style={s.freeBadgeUpgrade}>
                <Zap size={11} color="white" strokeWidth={2.5} />
                <Text style={s.freeBadgeUpgradeText}>Upgrade to Pro</Text>
              </View>
            ) : (
              <View style={s.freeBadge}>
                <View style={s.freeBadgeDot} />
                <Text style={s.freeBadgeText}>{Math.max(0, 3 - (analyses || 0))} Free Rooms Remaining</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }}>
          <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
        </TouchableOpacity>
      </View>
      <ScrollView ref={homeScrollRef} contentContainerStyle={s.scrollContent}>
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

        <Text style={s.sectionLabel}>CHOOSE YOUR BUDGET LEVEL</Text>
        <View style={s.tiersRow}>
          {TIERS.map(t => (
            <TouchableOpacity key={t.id}
              style={[s.tierBtn, tier === t.id && { borderColor: t.color, backgroundColor: t.bg }]}
              accessibilityLabel={`Select ${t.label} tier`}
              accessibilityRole="button"
              accessibilityState={{ selected: tier === t.id }}
              onPress={() => {
                setTier(t.id);
                setTierTouched(true);
                logEvent(getAnalytics(), "tier_selected", { tier: t.id === "mid" ? "mid_range" : t.id });
              }}>
              {t.id === "mid" && <View style={s.popularBadgeTop}><Text style={s.popularBadgeText}>POPULAR</Text></View>}
              <t.icon size={24} color={tier === t.id ? t.color : (t.id === "mid" ? "#C9A86A" : "#475569")} strokeWidth={2.5} style={{ marginBottom: 5 }} />
              <Text style={[s.tierName, tier === t.id && { color: t.color }]}>{t.label}</Text>
              <Text style={s.tierRange}>{t.range}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.tierHint}>All three plans are included. Your selected budget will simply be highlighted.</Text>

        <View style={s.budgetRow}>
          <Text style={s.budgetSign}>$</Text>
          <TextInput
            style={s.budgetInput}
            placeholder="Specific budget (optional)"
            placeholderTextColor={BRAND.mist}
            value={budget}
            onChangeText={setBudget}
            keyboardType="numeric"
          />
          {budget.length > 0 && (
            <TouchableOpacity onPress={() => setBudget("")} style={{ padding: 4 }}>
              <X size={16} color={BRAND.mist} strokeWidth={2.25} />
            </TouchableOpacity>
          )}
        </View>

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
const UPDATE_NUDGE_LAST_SHOWN_KEY = "lastVersionNudgeShownAt";
const UPDATE_NUDGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
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

async function checkForAppUpdate() {
  if (!IS_PRODUCTION) return;
  try {
    const lastShown = await AsyncStorage.getItem(UPDATE_NUDGE_LAST_SHOWN_KEY);
    if (lastShown && Date.now() - parseInt(lastShown, 10) < UPDATE_NUDGE_MIN_INTERVAL_MS) {
      return; // shown within the last 24h (including earlier this session) - stay quiet
    }

    const snap = await getDoc(doc(db, "config", "appVersion"));
    if (!snap.exists()) return;
    const data = snap.data();
    const latest = Platform.OS === "ios" ? data.ios : data.android;
    const current = Constants.expoConfig?.version;
    if (!isVersionBehind(current, latest)) return;

    // Recorded before the alert is even shown, not just on "Not Now" - the
    // 24h suppression is meant to apply regardless of which action the user
    // takes (or if they dismiss without tapping either), per the "don't show
    // more than once per day" requirement being a general rule, not a
    // consequence of the "Not Now" button specifically.
    await AsyncStorage.setItem(UPDATE_NUDGE_LAST_SHOWN_KEY, Date.now().toString());

    const androidPackage = Constants.expoConfig?.android?.package || "com.mharrison.uncluttrd";
    const storeUrl = Platform.OS === "ios"
      ? IOS_APP_STORE_URL
      : `https://play.google.com/store/apps/details?id=${androidPackage}`;

    Alert.alert(
      "A new version of Uncluttrd is available",
      "Update now for the latest features and fixes.",
      [
        { text: "Not Now", style: "cancel" },
        { text: "Update Now", onPress: () => Linking.openURL(storeUrl) },
      ]
    );
  } catch (e) {
    console.log("Update check error:", e.message);
  }
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
      // device). Reads currentUidRef rather than closing over `user` directly,
      // since this effect only runs once and would otherwise always see
      // whichever value `user` had at mount (null).
      const listener = (customerInfo) => {
        const proActive = !!customerInfo.entitlements.active["Uncluttrd Pro"];
        setIsPro(proActive);
        AsyncStorage.setItem("isPro", proActive ? "true" : "false");
        if (currentUidRef.current) {
          updateDoc(doc(db, "users", currentUidRef.current), { isPro: proActive })
            .catch(e => console.log("Sync isPro error:", e.message));
        }
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
    // Soft update-availability nudge - see checkForAppUpdate's own comment.
    // Runs once per app launch, independent of auth state (this is a
    // dismissible nudge about the app itself, not account data).
    checkForAppUpdate();
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
        const customerInfo = await Purchases.getCustomerInfo();
        const proActive = !!customerInfo.entitlements.active["Uncluttrd Pro"];
        setIsPro(proActive);
        await AsyncStorage.setItem("isPro", proActive ? "true" : "false");
        updateDoc(doc(db, "users", u.uid), { isPro: proActive })
          .catch(e => console.log("Sync isPro error:", e.message));
      } catch (e) {
        console.log("RevenueCat setAttributes/getCustomerInfo error:", e.message);
      }
    });
    return unsub;
  }, []);

  if (loading || !fontsLoaded) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: "center", justifyContent: "center" }]}>
        <View style={s.hdrMark}><DrawerIcon size={54} dark={true} /></View>
        <Text style={[s.hdrName, { marginTop: 12 }]}>Uncluttrd</Text>
        <ActivityIndicator color={BRAND.green} style={{ marginTop: 20 }} />
      </SafeAreaView>
    );
  }

  // Not logged in, show auth screen
  if (!user) return <AuthScreen />;

  // Logged in but hasn't dismissed onboarding, show it
  if (showOnboard && !skipPref) {
    return <OnboardingScreen onDone={async (skip) => {
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
  }

  // Logged in and onboarding done, show main app
  return <MainApp user={user} isPro={isPro} setIsPro={setIsPro} analyses={analyses} setAnalyses={setAnalyses} setSkipPref={setSkipPref} revenueCatLinkedRef={revenueCatLinkedRef} />;
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
        {IS_STAGING && (
          <SafeAreaView edges={["top"]} style={s.stagingBanner}>
            <Text style={s.stagingBannerText}>STAGING</Text>
          </SafeAreaView>
        )}
        <View style={{ flex: 1 }}>
          <AppRoot />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}


const s = StyleSheet.create({
  stagingBanner: { backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", paddingVertical: 4 },
  stagingBannerText: { color: "#1F2937", fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1.5 },
  safe: { flex: 1, backgroundColor: BRAND.offWhite },
  scrollContent: { padding: 20, paddingBottom: 80 },
  hdr: { backgroundColor: BRAND.navy, borderBottomWidth: 0, paddingTop: 22, paddingBottom: 18, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", gap: 12 },
  hdrMark: { width: 58, height: 58, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  hdrMarkText: { color: "white", fontSize: 22, fontFamily: "Inter_700Bold" },
  hdrName: { fontSize: 22, fontFamily: "Inter_700Bold", color: BRAND.white },
  hdrTag: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 2 },
  hdrPageName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.85)", marginTop: 1 },
  freeBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(30,158,82,0.2)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6, alignSelf: "flex-start" },
  freeBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND.green },
  freeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: BRAND.green },
  freeBadgeUpgrade: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: BRAND.tan, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4, alignSelf: "flex-start" },
  freeBadgeUpgradeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "white" },
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
  popularBadgeTop: { backgroundColor: BRAND.green, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6, alignSelf: "center" },
  popularBadgeText: { fontSize: 8, fontFamily: "Inter_700Bold", color: "white", letterSpacing: 0.3 },
  photoHandwritten: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#64748B", textAlign: "center", opacity: 0.9 },
  tierHint: { fontSize: 13, fontFamily: "Inter_500Medium", color: BRAND.ink, textAlign: "center", marginTop: 12, marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: BRAND.slate, marginBottom: 11 },
  tiersRow: { flexDirection: "row", gap: 8, marginBottom: 0 },
  tierBtn: { flex: 1, backgroundColor: BRAND.white, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 13, padding: 12, alignItems: "center" },
  tierIcon: { fontSize: 17, marginBottom: 4 },
  tierName: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.ink, marginBottom: 2 },
  tierRange: { fontSize: 11, fontFamily: "Inter_400Regular", color: BRAND.mist },
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
  tcardRange: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist },
  step: { flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BRAND.offWhite },
  stepChk: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center", marginTop: 2 },
  stepChkText: { fontSize: 9, fontWeight: "800" },
  stepText: { fontSize: 14, fontFamily: "Inter_400Regular", color: BRAND.ink, lineHeight: 20, flex: 1 },
  prodLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: BRAND.mist, marginTop: 14, marginBottom: 8 },
  prodRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: BRAND.offWhite, borderRadius: 11, padding: 11, marginBottom: 6 },
  prodIco: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  prodName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  prodPrice: { fontSize: 13, fontFamily: "Inter_700Bold" },
  amznBadge: { backgroundColor: BRAND.white, borderWidth: 1, borderColor: BRAND.stone, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  amznText: { fontSize: 9, fontFamily: "Inter_700Bold", color: BRAND.mist },
  approachCard: { backgroundColor: BRAND.white, borderWidth: 1.5, borderRadius: 16, padding: 16, marginBottom: 12 },
  approachCardHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  approachPill: { borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10 },
  approachPillText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  approachRange: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.slate },
  approachStrategy: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 19 },
  approachExpanded: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: BRAND.offWhite },
  approachProdReason: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 1 },
  approachShopLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: BRAND.green, marginLeft: 6 },
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
  reviewItemBtnOutlineText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green, textAlign: "center" },
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
  // TEMPORARY DIAGNOSTIC - remove alongside the debug badges in the
  // render chain once the View Full Plan -> Results bug is confirmed fixed.
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
  paywallCtaSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist, marginBottom: 16 },
  paywallSkip: { padding: 12 },
  paywallSkipText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#A8AFBC" },
  shareBtnIcon: { fontSize: 26, color: BRAND.green },
  shutterBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: "white", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 68, height: 68, borderRadius: 34, backgroundColor: "white", borderWidth: 3, borderColor: "#ddd" },
  photoButtonsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  photoBtn: { flex: 1, backgroundColor: BRAND.white, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 13, padding: 14, alignItems: "center", gap: 6 },
  photoBtnIcon: { fontSize: 24 },
  photoBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  budgetBanner: { backgroundColor: BRAND.greenLight, borderWidth: 1, borderColor: BRAND.greenMid, borderRadius: 8, padding: 10, paddingHorizontal: 14, marginBottom: 16 },
  budgetBannerText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: BRAND.green },
  bestMatchBadge: { backgroundColor: BRAND.green, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 10, marginLeft: 4 },
  bestMatchText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "white" },
  loadingBox: { backgroundColor: BRAND.white, borderRadius: 16, padding: 28, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: BRAND.stone },
  budgetRow: { backgroundColor: BRAND.white, borderWidth: 1.5, borderColor: BRAND.stone, borderRadius: 13, padding: 13, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  budgetSign: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: BRAND.mist },
  budgetInput: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: BRAND.ink, padding: 0 },
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
