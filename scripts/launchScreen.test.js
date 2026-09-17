/**
 * Launch screen: the invariants the native-splash handoff depends on.
 *
 *   node --test scripts/launchScreen.test.js
 *
 * The handoff is only seamless if the animated screen's first frame equals
 * the native splash's last one, and the native splash is configured in
 * app.config.js while the screen lives in App.js. Nothing ties the two
 * together at build time, so this does: same background, same iOS logo
 * size, the approved artwork on both sides, and the startup gate and
 * lifecycle rules the screen relies on. The minimum visible duration is
 * tested against the real controller (shared/launchTiming.js) on a fake
 * clock; animation rendering and device behaviour are not testable here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { createLaunchExitController, MIN_VISIBLE_BEFORE_EXIT_MS, LAUNCH_EXIT_FADE_MS, LAUNCH_ANIMATION } = require(path.join(__dirname, "..", "shared", "launchTiming.js"));

const ROOT = path.join(__dirname, "..");
const APP = fs.readFileSync(path.join(ROOT, "App.js"), "utf8").replace(/\r\n/g, "\n");

function expoConfig(appEnv) {
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = appEnv;
  const file = path.join(ROOT, "app.config.js");
  delete require.cache[require.resolve(file)];
  try {
    const mod = require(file);
    const resolved = typeof mod === "function" ? mod({ config: {} }) : mod;
    return resolved.expo || resolved;
  } finally {
    if (prev === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = prev;
  }
}

const splashPlugin = (cfg) => {
  const entry = cfg.plugins.find((p) => Array.isArray(p) && p[0] === "expo-splash-screen");
  assert.ok(entry, "expo-splash-screen plugin configured");
  return entry[1];
};

const constant = (name) => {
  const m = APP.match(new RegExp(`^const ${name} = ([^;]+);`, "m"));
  assert.ok(m, `${name} defined in App.js`);
  return m[1].trim();
};

function png(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString("hex", 0, 8), "89504e470d0a1a0a", `${file} is a PNG`);
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), colorType = b[25];
  let p = 8; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString("ascii", p + 4, p + 8);
    if (type === "IDAT") idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  return { width, height, colorType, bytes: b, idat: Buffer.concat(idat) };
}

// Fraction of fully transparent pixels in an 8-bit RGBA, non-interlaced PNG.
function transparency(img) {
  assert.equal(img.colorType, 6, "RGBA");
  const raw = zlib.inflateSync(img.idat); const ch = 4; const stride = img.width * ch;
  const cur = Buffer.alloc(stride); const prev = Buffer.alloc(stride);
  let clear = 0;
  for (let y = 0; y < img.height; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (let x = 3; x < stride; x += 4) if (cur[x] === 0) clear++;
    cur.copy(prev);
  }
  return { clear: clear / (img.width * img.height), corner: [0, 0] };
}

test("native splash and launch screen share one base colour on both platforms, in both environments", () => {
  const background = JSON.parse(constant("LAUNCH_BACKGROUND").split("//")[0].trim());
  assert.equal(background, "#F8FAF9");
  for (const env of ["staging", "production"]) {
    const cfg = expoConfig(env);
    const plugin = splashPlugin(cfg);
    assert.equal(plugin.backgroundColor, background, `${env} default`);
    assert.equal(plugin.ios.backgroundColor, background, `${env} iOS`);
    assert.equal(plugin.android.backgroundColor, background, `${env} Android`);
    assert.equal(cfg.splash, undefined, `${env}: no legacy top-level splash competing with the plugin`);
  }
});

test("iOS: the launch screen logo is the native splash logo, at the same width", () => {
  const plugin = splashPlugin(expoConfig("staging"));
  assert.equal(plugin.ios.image, "./assets/uncluttrd-logo-full.png");
  assert.equal(plugin.ios.resizeMode, "contain");
  assert.equal(Number(constant("SPLASH_LOGO_WIDTH").split("//")[0]), plugin.ios.imageWidth);
  assert.match(constant("FULL_LOGO"), /^require\("\.\/assets\/uncluttrd-logo-full\.png"\)$/);
});

test("the full logo asset is the approved artwork, untouched, and scaled uniformly", () => {
  const img = png(path.join(ROOT, "assets", "uncluttrd-logo-full.png"));
  assert.equal(crypto.createHash("sha256").update(img.bytes).digest("hex"),
    "62abd81e683aaaf4ce15e180b8bc5711ff901863f13fb3303d816b144332e984",
    "byte-identical to the approved Uncluttrd_Logo_Transparent_2048.png (1798x457)");
  assert.deepEqual([img.width, img.height], [1798, 457]);
  assert.equal(constant("FULL_LOGO_ASPECT").split("//")[0].trim(), `${img.height} / ${img.width}`);
  assert.ok(transparency(img).clear > 0.5, "transparent background");
});

test("Android: the native splash is the transparent U mark alone, sized inside the icon mask", () => {
  const plugin = splashPlugin(expoConfig("staging"));
  assert.equal(plugin.android.image, "./assets/splash-android-u.png");
  const img = png(path.join(ROOT, "assets", "splash-android-u.png"));
  // The U's own proportions (116 x 150 in the approved SVG's coordinates).
  assert.ok(Math.abs(img.height / img.width - 150 / 116) < 0.001, `aspect ${img.width}x${img.height}`);
  assert.ok(transparency(img).clear > 0.4, "transparent background around and inside the U");
  // Android 12+ shows the 288dp canvas through a circle two-thirds its size;
  // the contained U's diagonal must fit that circle.
  const w = plugin.android.imageWidth * (116 / 150);
  const h = plugin.android.imageWidth;
  assert.ok(Math.hypot(w, h) <= 288 * (2 / 3), `U diagonal ${Math.hypot(w, h).toFixed(1)}dp within the 192dp mask`);
  assert.ok(plugin.android.imageWidth * 4 <= img.height, "enough source pixels for xxxhdpi without upscaling");
});

test("the dismissal gate is the existing startup gate, and the screen is shown once", () => {
  assert.match(APP, /const startupReady = !loading && fontsLoaded;/);
  assert.match(APP, /const \[showLaunch, setShowLaunch\] = useState\(true\);/);
  assert.equal((APP.match(/setShowLaunch\(/g) || []).length, 1, "only ever set false, by onExited");
  // The gate is <LaunchScreen ready={...}>, dismissed by its own onExited.
  // `ready` now also waits on holdForTracking, so a restored session keeps
  // the launch screen up until ATT is answered (scripts/attMetaFlow.test.js
  // covers that); startupReady is still the startup half of the condition.
  assert.match(APP, /\{showLaunch \? \(\s*<LaunchScreen/);
  assert.match(APP, /ready=\{startupReady && !holdForTracking\}/);
  assert.match(APP, /onExited=\{\(\) => setShowLaunch\(false\)\}/);
  assert.match(APP, /\/>\s*\) : null\}/);
  // The only timer is the controller's minimum; LaunchScreen adds no maximum
  // and no timer of its own.
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.doesNotMatch(launch, /setTimeout|setInterval/);
  assert.match(launch, /createLaunchExitController\(\{ startExit: beginExit \}\)/);
  assert.match(launch, /useEffect\(\(\) => \{ exitController\.current\.setReady\(ready\); \}, \[ready\]\);/);
  assert.match(launch, /Animated\.timing\(screenOpacity, \{ toValue: 0, duration: LAUNCH_EXIT_FADE_MS/);
  assert.equal(LAUNCH_EXIT_FADE_MS, 300);
  assert.equal(MIN_VISIBLE_BEFORE_EXIT_MS, 1700);
});

test("the native splash is held from module load and hidden exactly once, on the frame the screen becomes visible", () => {
  const firstRender = APP.indexOf("function AppRoot(");
  const prevent = APP.indexOf("SplashScreen.preventAutoHideAsync()");
  assert.ok(prevent > 0 && prevent < firstRender, "preventAutoHideAsync at module scope");
  assert.match(APP, /let nativeSplashHidden = false;\nfunction hideNativeSplashOnce\(\) \{\n  if \(nativeSplashHidden\) return;\n  nativeSplashHidden = true;\n  SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\);\n\}/);
  assert.match(APP, /onLayout=\{handleLayout\}/);
  // The minimum starts in the same frame the splash is hidden, and only once.
  assert.match(APP, /if \(layoutFrame\.current !== null \|\| exiting\.current\) return;\n\s*layoutFrame\.current = requestAnimationFrame\(\(\) => \{\n\s*hideNativeSplashOnce\(\);\n\s*exitController\.current\.markVisible\(\);/);
  assert.equal((APP.match(/SplashScreen\.hideAsync\(/g) || []).length, 1, "no other path hides the splash");
});

test("loops stop on exit and unmount; reduced motion runs none; nothing fires after unmount", () => {
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.match(launch, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(launch, /if \(reduceMotion\) \{[\s\S]*?return;\n    \}/);
  assert.match(launch, /return stopAll;/);
  assert.match(launch, /useEffect\(\(\) => \(\) => \{\n\s*mounted\.current = false;\n\s*exitController\.current\.dispose\(\);\n\s*if \(layoutFrame\.current !== null\) cancelAnimationFrame\(layoutFrame\.current\);\n\s*stopAll\(\);\n\s*hideNativeSplashOnce\(\);\n\s*\}, \[\]\);/);
  assert.match(launch, /const beginExit = \(\) => \{\n\s*if \(!mounted\.current \|\| exiting\.current\) return;/);
  assert.match(launch, /if \(finished && mounted\.current\) onExitedRef\.current\(\);/);
  // Touches are blocked until the exit actually starts, not merely when ready.
  assert.match(launch, /pointerEvents=\{exitStarted \? "none" : "auto"\}/);
  assert.equal((launch.match(/Animated\.loop\(/g) || []).length, 1, "the dot pulse is the only loop");
  assert.doesNotMatch(launch, /Animated\.timing\(logo/i, "the logo itself is never animated");
});

// ---- minimum visible duration (shared/launchTiming.js) ----------------------
//
// A fake clock and a model of LaunchScreen around the real controller: the
// controller decides when the exit starts; the model runs the 200ms fade on
// the same clock and unmounts when it finishes, as beginExit and
// fade.start(... onExited) do in App.js.

function fakeClock() {
  let now = 0; let nextId = 1; const timers = new Map();
  return {
    get now() { return now; },
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let nextKey = null; let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { nextKey = id; next = t; }
        if (!next) break;
        timers.delete(nextKey); now = next.at; next.fn();
      }
      now = end;
    },
  };
}

function mountLaunchScreen(clock, { reduceMotion = false } = {}) {
  const events = [];
  const screen = { mounted: true, exitStartedAt: null, unmountedAt: null, fadeTimer: null, stateUpdatesAfterUnmount: 0 };
  // The entrance, as LaunchScreen runs it from LAUNCH_ANIMATION once visible:
  // timers stand in for Animated.delay/timing/loop, and are stopped the way
  // stopAll() stops the running animations.
  const animationTimers = new Set();
  const loops = new Set(); // dot pulse loops currently running
  const schedule = (label, ms, then) => {
    const id = clock.setTimer(() => { animationTimers.delete(id); events.push([label, clock.now]); if (then) then(); }, ms);
    animationTimers.add(id);
  };
  const stopAll = () => { animationTimers.forEach((id) => clock.clearTimer(id)); animationTimers.clear(); loops.clear(); };
  const startEntrance = () => {
    if (reduceMotion) { events.push(["final-state", clock.now]); return; }
    const { statusFade, dots } = LAUNCH_ANIMATION;
    schedule("status-fade-start", statusFade.delay);
    schedule("status-fade-end", statusFade.delay + statusFade.duration);
    dots.forEach((d, i) => schedule(`dot${i}-start`, d.delay, () => loops.add(i)));
  };
  const controller = createLaunchExitController({
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    startExit: () => {
      if (!screen.mounted) { screen.stateUpdatesAfterUnmount++; return; }
      stopAll();
      events.push(["exit", clock.now]);
      screen.exitStartedAt = clock.now;
      screen.fadeTimer = clock.setTimer(() => {
        screen.fadeTimer = null;
        if (!screen.mounted) { screen.stateUpdatesAfterUnmount++; return; }
        screen.mounted = false; screen.unmountedAt = clock.now; events.push(["unmount", clock.now]);
        controller.dispose();
      }, LAUNCH_EXIT_FADE_MS);
    },
  });
  let visible = false;
  return {
    controller, screen, events,
    // The handoff frame: native splash hidden, minimum starts, entrance starts.
    layout: () => {
      if (visible) return;
      visible = true;
      controller.markVisible();
      if (!screen.exitStartedAt) startEntrance();
    },
    setReady: (v) => controller.setReady(v),
    animationsPending: () => animationTimers.size,
    loopsRunning: () => loops.size,
    unmount: () => { // the component's cleanup
      screen.mounted = false;
      controller.dispose();
      stopAll();
      if (screen.fadeTimer !== null) { clock.clearTimer(screen.fadeTimer); screen.fadeTimer = null; }
    },
  };
}

const exitEvents = (events) => events.filter(([e]) => e === "exit" || e === "unmount");

test("ready before 1,700ms: stays up until 1,700ms, stays mounted through the fade, unmounts at 2,000ms", () => {
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  s.layout();
  clock.advance(120);
  s.setReady(true);
  assert.equal(s.screen.exitStartedAt, null, "not dismissed at readiness");
  clock.advance(1579);
  assert.equal(s.screen.mounted, true, "still mounted at 1,699ms");
  assert.equal(s.screen.exitStartedAt, null);
  clock.advance(1);
  assert.equal(s.screen.exitStartedAt, 1700, "exit begins at 1,700ms");
  for (const at of [1750, 1850, 1999]) {
    clock.advance(at - clock.now);
    assert.equal(s.screen.mounted, true, `mounted during the fade at ${at}ms`);
  }
  clock.advance(1);
  assert.equal(s.screen.unmountedAt, 2000, "removed when the fade completes, about 2,000ms in total");
  assert.deepEqual(exitEvents(s.events), [["exit", 1700], ["unmount", 2000]]);
  assert.equal(clock.pending(), 0);
});

test("ready after 1,700ms: exit begins immediately; only the 300ms fade remains", () => {
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  s.layout();
  clock.advance(2350);
  assert.equal(s.screen.exitStartedAt, null);
  s.setReady(true);
  assert.equal(s.screen.exitStartedAt, 2350, "same instant as readiness");
  clock.advance(299);
  assert.equal(s.screen.mounted, true);
  clock.advance(1);
  assert.equal(s.screen.unmountedAt, 2650, "exactly the 300ms fade after readiness");
});

test("not ready at 1,700ms: the screen stays visible; the minimum never dismisses it and there is no maximum", () => {
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  s.layout();
  clock.advance(1700);
  assert.equal(s.screen.mounted, true);
  assert.equal(s.screen.exitStartedAt, null, "the minimum alone never dismisses");
  assert.equal(s.controller.state.minElapsed, true);
  clock.advance(60000);
  assert.equal(s.screen.mounted, true, "still waiting on readiness a minute later");
  assert.equal(s.screen.exitStartedAt, null);
  assert.equal(clock.pending(), 0, "no maximum timeout pending");
  s.setReady(false);
  assert.equal(s.screen.exitStartedAt, null, "not-ready updates do nothing");
});

test("status text fades in over 400ms, starting only once the screen is visible", () => {
  assert.deepEqual({ ...LAUNCH_ANIMATION.statusFade }, { delay: 0, duration: 400 });
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  clock.advance(500); // mounted, native splash still up: nothing may start yet
  assert.deepEqual(s.events, []);
  s.layout();
  clock.advance(0);
  assert.deepEqual(s.events[0], ["status-fade-start", 500], "fade starts on the handoff frame, not before");
  clock.advance(399);
  assert.ok(!s.events.some(([e]) => e === "status-fade-end"), "still fading at 399ms");
  clock.advance(1);
  assert.ok(s.events.some(([e, t]) => e === "status-fade-end" && t === 900), "fade complete 400ms after handoff");

  // LaunchScreen runs exactly that, gated on the handoff frame.
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.match(launch, /if \(!visible \|\| reduceMotion === null \|\| exiting\.current\) return;/);
  assert.match(launch, /\}, \[reduceMotion, visible\]\);/);
  assert.match(launch, /Animated\.delay\(LAUNCH_ANIMATION\.statusFade\.delay\),\n\s*Animated\.timing\(statusOpacity, \{ toValue: 1, duration: LAUNCH_ANIMATION\.statusFade\.duration/);
  assert.match(launch, /statusOpacity = useRef\(new Animated\.Value\(0\)\)/, "starts from 0");
  assert.match(launch, /hideNativeSplashOnce\(\);\n\s*exitController\.current\.markVisible\(\);\n\s*if \(mounted\.current\) setVisible\(true\);/);
});

test("the native splash hides instantly, so nothing of the entrance plays underneath it", () => {
  // expo-splash-screen fades the Android splash out over 400ms by default,
  // which covered the status fade-in on device.
  const prevent = APP.indexOf("SplashScreen.preventAutoHideAsync()");
  const options = APP.indexOf("SplashScreen.setOptions({ duration: 0, fade: false })");
  const firstRender = APP.indexOf("function AppRoot(");
  assert.ok(options > prevent && options < firstRender, "configured at module load, before any render");
  assert.equal((APP.match(/SplashScreen\.setOptions\(/g) || []).length, 1);
  const types = fs.readFileSync(path.join(ROOT, "node_modules", "expo-splash-screen", "build", "SplashScreen.types.d.ts"), "utf8");
  assert.match(types, /duration\?: number;/);
  assert.match(types, /fade\?: boolean;/);
});

test("dots start at 300ms, 150ms apart, keep pulsing while waiting, and stop on exit", () => {
  assert.deepEqual(LAUNCH_ANIMATION.dots.map((d) => d.delay), [300, 450, 600]);
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  s.layout();
  clock.advance(1000);
  const starts = s.events.filter(([e]) => /^dot\d-start$/.test(e));
  assert.deepEqual(starts, [["dot0-start", 300], ["dot1-start", 450], ["dot2-start", 600]]);
  assert.ok(starts.every(([, t]) => t < MIN_VISIBLE_BEFORE_EXIT_MS), "every dot is moving before the exit can begin");
  // Waiting on readiness well past the minimum: the loops are still running.
  clock.advance(4000);
  assert.equal(s.loopsRunning(), 3, "all three dots still pulsing while waiting");
  s.setReady(true);
  assert.equal(s.loopsRunning(), 0, "every loop stopped the moment the exit begins");

  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.match(launch, /const pulse = \(d, i\) => Animated\.sequence\(\[\n\s*Animated\.delay\(LAUNCH_ANIMATION\.dots\[i\]\.delay\),\n\s*Animated\.loop\(/);
  // The existing pulse: opacity 0.3 <-> 1, scale 1 <-> 1.15.
  assert.match(launch, /Animated\.timing\(d\.opacity, \{ toValue: 1,/);
  assert.match(launch, /Animated\.timing\(d\.scale, \{ toValue: 1\.15,/);
  assert.match(launch, /Animated\.timing\(d\.opacity, \{ toValue: 0\.3,/);
  assert.match(launch, /Animated\.timing\(d\.scale, \{ toValue: 1,/);
});

test("exit fades the whole container over 300ms, from its current opacity, and unmounts only after", () => {
  assert.equal(LAUNCH_EXIT_FADE_MS, 300);
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  // One fade, on the root container's opacity - the logo, status, dots and
  // background are all inside it.
  assert.equal((launch.match(/screenOpacity, \{ toValue: 0/g) || []).length, 1);
  assert.match(launch, /Animated\.timing\(screenOpacity, \{ toValue: 0, duration: LAUNCH_EXIT_FADE_MS/);
  assert.doesNotMatch(launch, /screenOpacity\.setValue\(/, "fades from wherever it is, never reset");
  const root = launch.slice(launch.indexOf("return (\n    <Animated.View"));
  assert.match(root, /^return \(\n\s*<Animated\.View\n\s*style=\{\[StyleSheet\.absoluteFill, \{ backgroundColor: LAUNCH_BACKGROUND, opacity: screenOpacity/);
  assert.ok(root.indexOf("FULL_LOGO") > 0 && root.indexOf("Getting things ready") > 0 && root.indexOf("dots.map") > 0, "logo, status and dots are children of the fading container");
  // Unmount only on completion.
  assert.match(launch, /fade\.start\(\(\{ finished \}\) => \{ if \(finished && mounted\.current\) onExitedRef\.current\(\); \}\);/);
  // The destination is rendered beneath while it fades.
  assert.match(APP, /<View style=\{\{ flex: 1 \}\}>\n\s*\{screen\}\n\s*\{showLaunch \? \(\n\s*<LaunchScreen/);
});

test("readiness and the minimum resolving together run exactly one exit", () => {
  for (const readyFirst of [true, false]) {
    const clock = fakeClock();
    const s = mountLaunchScreen(clock);
    s.layout();
    clock.advance(1699);
    if (readyFirst) { s.setReady(true); clock.advance(1); } else { clock.advance(1); s.setReady(true); }
    s.setReady(true); s.setReady(true); // repeated renders with ready
    s.controller.markVisible(); // a second layout
    clock.advance(1000);
    assert.deepEqual(exitEvents(s.events), [["exit", 1700], ["unmount", 2000]], `readyFirst=${readyFirst}`);
  }
});

test("the minimum is measured from visibility, not mount", () => {
  const clock = fakeClock();
  const s = mountLaunchScreen(clock);
  s.setReady(true);
  clock.advance(5000); // mounted but not yet laid out
  assert.equal(s.screen.exitStartedAt, null);
  s.layout();
  clock.advance(1699);
  assert.equal(s.screen.exitStartedAt, null);
  clock.advance(1);
  assert.equal(s.screen.exitStartedAt, 6700);
});

test("unmount clears every pending timer and animation loop; nothing fires or updates state afterwards", () => {
  // Unmounted during the entrance and the minimum wait.
  let clock = fakeClock();
  let s = mountLaunchScreen(clock);
  s.layout();
  s.setReady(true);
  clock.advance(700);
  assert.equal(s.loopsRunning(), 3, "dots pulsing");
  assert.equal(s.controller.state.timerPending, true, "minimum timer pending");
  s.unmount();
  assert.equal(clock.pending(), 0, "every timer and animation cleared on unmount");
  assert.equal(s.animationsPending(), 0);
  assert.equal(s.loopsRunning(), 0);
  assert.equal(s.controller.state.timerPending, false);
  const before = s.events.length;
  clock.advance(5000);
  s.setReady(true);
  s.controller.markVisible();
  assert.equal(s.events.length, before, "nothing after unmount");
  assert.equal(s.screen.stateUpdatesAfterUnmount, 0);

  // Exit stops the entrance; unmounted mid-fade.
  clock = fakeClock();
  s = mountLaunchScreen(clock);
  s.layout();
  clock.advance(200);
  s.setReady(true);
  clock.advance(1500); // exit at 1,700
  assert.equal(s.animationsPending(), 0, "exit stopped the entrance");
  assert.equal(s.loopsRunning(), 0, "exit stopped the loops");
  clock.advance(150);
  s.unmount();
  clock.advance(5000);
  assert.deepEqual(exitEvents(s.events), [["exit", 1700]], "no onExited after unmount");
  assert.equal(s.screen.stateUpdatesAfterUnmount, 0);
  assert.equal(clock.pending(), 0);
});

test("reduced motion: static final state at the handoff, no loops, same minimum and exit", () => {
  const clock = fakeClock();
  const s = mountLaunchScreen(clock, { reduceMotion: true });
  s.layout();
  assert.equal(s.animationsPending(), 0, "no entrance");
  assert.equal(s.loopsRunning(), 0, "no loop");
  s.setReady(true);
  clock.advance(2000);
  assert.equal(s.loopsRunning(), 0);
  assert.deepEqual(s.events, [["final-state", 0], ["exit", 1700], ["unmount", 2000]]);
});

test("the controller is the only exit path, on the platform timers by default", () => {
  const src = fs.readFileSync(path.join(ROOT, "shared", "launchTiming.js"), "utf8");
  assert.match(src, /setTimer = \(fn, ms\) => setTimeout\(fn, ms\)/);
  assert.match(src, /clearTimer = \(id\) => clearTimeout\(id\)/);
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.equal((launch.match(/beginExit\(/g) || []).length, 0, "beginExit is only ever called by the controller");
  assert.equal((launch.match(/screenOpacity, \{ toValue: 0/g) || []).length, 1, "one exit animation");
});

test("decorative parts are hidden from assistive tech; the state has one label", () => {
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.equal((launch.match(/importantForAccessibility="no-hide-descendants"/g) || []).length, 2, "tints and dots");
  assert.equal((launch.match(/accessibilityElementsHidden/g) || []).length, 2);
  assert.match(launch, /accessible\n\s*accessibilityLabel="Uncluttrd\. Getting things ready"/);
  assert.match(launch, />\n\s*Getting things ready\.\.\.\n/);
});
