// PDF export helpers. Pure and plan-only, so App.js and the node tests
// (scripts/pdfExport.test.js) run the same code. CommonJS for the same
// reason as shared/spaceMigration.js: require() works with no transform.

// Which approach the PDF documents. A committed selectedApproach always
// wins. Without one, the approach card the user has expanded on Results is
// what they are looking at, so that is what they mean to share - but only
// for this export: nothing here writes, and selectedApproach stays unset
// until "Start with ..." commits it. Either id must name an approach the
// plan actually has; null keeps the existing comparison document.
function resolvePdfApproachId(results, previewApproach) {
  const approaches = results && results.approaches;
  if (!approaches || typeof approaches !== "object") return null;
  const valid = (id) => typeof id === "string"
    && Object.prototype.hasOwnProperty.call(approaches, id)
    && !!approaches[id];
  if (valid(results.selectedApproach)) return results.selectedApproach;
  if (valid(previewApproach)) return previewApproach;
  return null;
}

// Folds a finished original-photo upload into the in-memory Results plan.
// savePlanToHistory writes photoUrl to Firestore and history but the open
// Results object never received it, so the PDF (and the Results photo)
// had nothing to show for a plan created in this session.
//
// Returns `results` itself - same reference, so a React updater is a no-op -
// unless the upload belongs to the plan on screen. Only photoUrl is added;
// every other field, including detail and visualization state that landed
// concurrently, is kept. Only a remote URL is accepted, never the local
// cache file the upload was made from.
function mergeUploadedPhotoUrl(results, activePlanId, upload) {
  if (!results || !upload || !activePlanId) return results;
  if (upload.planId !== activePlanId) return results;
  if (typeof upload.photoUrl !== "string" || !/^https:\/\//i.test(upload.photoUrl)) return results;
  if (results.photoUrl === upload.photoUrl) return results;
  return { ...results, photoUrl: upload.photoUrl };
}

module.exports = { resolvePdfApproachId, mergeUploadedPhotoUrl };
