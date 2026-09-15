// When the launch screen may begin its exit. Pure and timer-injectable, so
// App.js (LaunchScreen) and the node tests (scripts/launchScreen.test.js)
// run the same logic. CommonJS for the same reason as shared/pdfExport.js.
//
// The screen stays up for at least MIN_VISIBLE_BEFORE_EXIT_MS after it
// became visible - its first layout, with the native splash hidden - so a
// fast startup still shows the status line arrive, the dots move and the
// screen fade away (900ms and 1,500ms were both too short on device). The
// exit fade that follows (LAUNCH_EXIT_FADE_MS) brings the shortest total to
// about 2,000ms.
//
//   ready before the minimum  -> exit starts when the minimum elapses
//   ready after the minimum   -> exit starts immediately
//   not ready                 -> nothing; the minimum alone never exits
//
// startExit is called at most once, and never after dispose().
const MIN_VISIBLE_BEFORE_EXIT_MS = 1700;
const LAUNCH_EXIT_FADE_MS = 300;

// Entrance, in ms from the same visible frame. The status line fades in over
// 400ms from the handoff; the dots start at 300ms, each 150ms after the one
// before, so all three are moving well before the earliest exit.
const LAUNCH_ANIMATION = Object.freeze({
  statusFade: Object.freeze({ delay: 0, duration: 400 }),
  dots: Object.freeze([0, 1, 2].map((i) => Object.freeze({ delay: 300 + i * 150 }))),
});

function createLaunchExitController({
  startExit,
  minVisibleMs = MIN_VISIBLE_BEFORE_EXIT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let visible = false;
  let minElapsed = false;
  let ready = false;
  let exited = false;
  let disposed = false;
  let timer = null;

  const maybeExit = () => {
    if (disposed || exited || !ready || !minElapsed) return;
    exited = true;
    startExit();
  };

  return {
    // The screen is on screen. Repeated calls are ignored.
    markVisible() {
      if (disposed || visible) return;
      visible = true;
      timer = setTimer(() => {
        timer = null;
        minElapsed = true;
        maybeExit();
      }, minVisibleMs);
    },
    // Startup readiness, as the existing gate reports it. Only ever latches on.
    setReady(value) {
      if (disposed || !value) return;
      ready = true;
      maybeExit();
    },
    // Unmount: clears the pending timer; nothing fires afterwards.
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
    get state() {
      return { visible, minElapsed, ready, exited, disposed, timerPending: timer !== null };
    },
  };
}

module.exports = { createLaunchExitController, MIN_VISIBLE_BEFORE_EXIT_MS, LAUNCH_EXIT_FADE_MS, LAUNCH_ANIMATION };
