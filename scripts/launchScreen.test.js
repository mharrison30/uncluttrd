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
 * lifecycle rules the screen relies on. Animation timing and device
 * behaviour are not testable here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

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
  assert.match(APP, /\{showLaunch \? <LaunchScreen ready=\{startupReady\} onExited=\{\(\) => setShowLaunch\(false\)\} \/> : null\}/);
  // No minimum display time: nothing in LaunchScreen waits on a timer to exit.
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.doesNotMatch(launch, /setTimeout|setInterval/);
  assert.match(launch, /if \(!ready \|\| exiting\.current\) return;\s*exiting\.current = true;\s*stopAll\(\);/);
  assert.match(launch, /Animated\.timing\(screenOpacity, \{ toValue: 0, duration: 200/);
});

test("the native splash is held from module load and hidden exactly once, after layout", () => {
  const firstRender = APP.indexOf("function AppRoot(");
  const prevent = APP.indexOf("SplashScreen.preventAutoHideAsync()");
  assert.ok(prevent > 0 && prevent < firstRender, "preventAutoHideAsync at module scope");
  assert.match(APP, /let nativeSplashHidden = false;\nfunction hideNativeSplashOnce\(\) \{\n  if \(nativeSplashHidden\) return;\n  nativeSplashHidden = true;\n  SplashScreen\.hideAsync\(\)\.catch\(\(\) => \{\}\);\n\}/);
  assert.match(APP, /onLayout=\{\(\) => requestAnimationFrame\(hideNativeSplashOnce\)\}/);
  assert.equal((APP.match(/SplashScreen\.hideAsync\(/g) || []).length, 1, "no other path hides the splash");
});

test("loops stop on exit and unmount; reduced motion runs none", () => {
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.match(launch, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(launch, /if \(reduceMotion\) \{[\s\S]*?return;\n    \}/);
  assert.match(launch, /return stopAll;/);
  assert.match(launch, /useEffect\(\(\) => \(\) => \{ stopAll\(\); hideNativeSplashOnce\(\); \}, \[\]\);/);
  assert.equal((launch.match(/Animated\.loop\(/g) || []).length, 1, "the dot pulse is the only loop");
  assert.doesNotMatch(launch, /Animated\.timing\(logo/i, "the logo itself is never animated");
});

test("decorative parts are hidden from assistive tech; the state has one label", () => {
  const launch = APP.slice(APP.indexOf("function LaunchScreen("), APP.indexOf("// ── ROOT"));
  assert.equal((launch.match(/importantForAccessibility="no-hide-descendants"/g) || []).length, 2, "tints and dots");
  assert.equal((launch.match(/accessibilityElementsHidden/g) || []).length, 2);
  assert.match(launch, /accessible\n\s*accessibilityLabel="Uncluttrd\. Getting things ready"/);
  assert.match(launch, />\n\s*Getting things ready\.\.\.\n/);
});
