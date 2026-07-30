# Journey 1 — Design Decisions Needed

Journey 1 ("Returning to the Same Space") has a real, verified wireframe behind it, and a document (`Journey1.md`) faithfully recording exactly what that wireframe shows. Four things in it are genuinely unresolved — not overlooked, actually checked against the project's architecture and decision history and confirmed open. This brief is scoped to just those four. Nothing here should require touching the object model or the broader app architecture; these are UX and interaction calls.

The screen sequence, for context: **Welcome Back** (re-establish the current Space) → **[Second screen]** (surface what was carried forward from last time) → **Fresh Look** (invite a new photo).

---

## 1. Wording consistency

The wireframe itself is internally inconsistent in two places — not a typo, a genuine open question about which version should win.

**A. The second screen's name.**
- The step label above the phone reads **"Your Session."**
- The heading rendered on the phone screen itself reads **"Today's Session."**

These aren't the same phrase, and there's no existing decision saying which one is correct. (We checked — "Today's Focus," which might seem like the obvious third option, was actually a concept invented later during a different journey's design work and was never applied back to Journey 1. It's a legitimate option to consider now, but it's not a default to fall back on.)

**B. The carried-forward items' framing.**
Within that same screen, two different phrases describe the same two items:
- A section header reads **"You asked to come back to:"**
- A callout at the bottom reads **"These are the things you chose to keep."**

Which phrasing should be used consistently?

## 2. Kitchen ↔ Coffee Station relationship

Screen 1 shows "Current Space: Kitchen." Screen 2 and 3 both reference "Coffee Station" as the specific location within that space. The wireframe never states how these relate.

The architecture already contains a general concept (Location Reference) intended for recurring sub-locations within a Space, but it has never been expressed through a concrete user experience. The question for this session is not how to redesign the object model, but how the relationship between Kitchen and Coffee Station should be communicated to the user. If the preferred interaction naturally aligns with the existing Location Reference concept, that can later be reflected during reconciliation.

## 3. What happens after "Take Photo"?

Screen 3 ends with a "Take Photo" button. The wireframe doesn't show or describe what happens next. This likely connects most directly to Journey 2 (the photo-capture flow) — worth deciding what the actual transition looks like: does it go straight into camera capture, is there any intermediate state, etc.

## 4. Growing kept-items list

Screen 2 shows exactly two "kept" items in the wireframe. Real usage could produce more. The wireframe doesn't address what happens if the list grows — does it scroll, cap at a fixed number and summarize the rest, something else?

---

**Not in scope for this session:** anything about the underlying data model (that's settled), Journeys 2–6 (each will get this same treatment separately), or re-litigating anything already decided elsewhere in the app.
