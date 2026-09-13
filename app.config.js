// Dynamic config, replacing the old static app.json. Branches bundle
// identity, display name, icon, and Google Services config by APP_ENV,
// which every EAS build profile sets explicitly (see eas.json) - this is
// the enforcement point for "only the production profile may resolve to
// production," not a runtime toggle. Defaults to "staging" (not
// "production") when unset, so an unexpected local run or a misconfigured
// profile fails safe toward staging, never silently toward production.
const APP_ENV = process.env.APP_ENV || "staging";
const IS_PRODUCTION = APP_ENV === "production";

// Tracks the store release. Bump for every App Store / Play submission.
const PRODUCTION_VERSION = "2.1.0";
// PINNED to whichever staging binary is installed on the test device - see the
// long note on `version` below. Bumping this orphans the installed staging app.
const STAGING_VERSION = "2.0.0";

// THE FIREBASE CLIENT CONFIG FILES ARE NOT IN THE REPOSITORY, so EAS Build
// cannot receive them the way it receives source.
//
// They are gitignored (2063a6e, deliberately - play-service-account.json in
// that same list is a real private key). EAS Build's project upload excludes
// ignored files, so from that commit onward every native build failed with
// EAS_BUILD_MISSING_GOOGLE_SERVICES_PLIST_ERROR / _JSON_ERROR. Before it they
// were merely untracked, which the upload does include - which is why this
// stayed invisible until a build was attempted.
//
// EAS file environment variables are the supported answer: the file is stored
// by EAS with secret visibility, materialised on the builder, and its PATH is
// handed to the build in these variables. Scoped per environment, so the
// preview environment holds the staging pair and production will hold the
// production pair.
//
// The fallback is what keeps local work unchanged. Nothing in a local `expo
// start`, `expo config` or fingerprint run sets these, so the literal paths
// below are used exactly as before, still chosen by APP_ENV. The environment
// variable only ever wins on an EAS builder, where the local file does not
// exist at all.
const GOOGLE_SERVICES_IOS =
  process.env.GOOGLE_SERVICES_IOS ||
  (IS_PRODUCTION ? "./GoogleService-Info.plist" : "./GoogleService-Info.staging.plist");
const GOOGLE_SERVICES_ANDROID =
  process.env.GOOGLE_SERVICES_ANDROID ||
  (IS_PRODUCTION ? "./google-services.json" : "./google-services.staging.json");

// META (FACEBOOK) SDK - PRODUCTION ONLY, AND STRUCTURALLY SO.
//
// Both values are Meta client-side identifiers that ship inside every PRODUCTION
// binary by design (Info.plist / AndroidManifest). Neither is the App Secret, which
// must never appear in this repository.
//
// Staging gets NO Meta configuration at all - not a disabled flag, no App ID.
// A staging binary therefore cannot address the production Meta app, so no
// runtime mistake can mix staging events into production attribution. The
// library is still linked into staging (autolinking is not per-environment),
// which is why App.js only ever requires it behind IS_PRODUCTION: on Android
// the SDK's init provider fails harmlessly without an App ID, and a native
// module that is never touched from JS is never initialised.
const META_APP_ID = "1578860883970731";
const META_CLIENT_TOKEN = "483c6de488418214fbe2021c1f1b123c";

// Production-only plugins. Kept out of staging so staging carries no Meta
// identity and no ATT prompt text or AD_ID permission of its own.
const PRODUCTION_ONLY_PLUGINS = IS_PRODUCTION
  ? [
      [
        "react-native-fbsdk-next",
        {
          appID: META_APP_ID,
          clientToken: META_CLIENT_TOKEN,
          displayName: "Uncluttrd",
          scheme: `fb${META_APP_ID}`,
          // Automatic logging is what records App Install and App Launch -
          // react-native-fbsdk-next 13.4.3 exposes no activateApp() to call.
          autoLogAppEventsEnabled: true,
          advertiserIDCollectionEnabled: true,
          // Android initialises from its manifest provider at process start;
          // iOS has no auto-init and is started from App.js.
          isAutoInitEnabled: true,
        },
      ],
      [
        "expo-tracking-transparency",
        {
          userTrackingPermission:
            "This identifier will be used to measure the effectiveness of advertising and provide more relevant ads.",
        },
      ],
    ]
  : [];

module.exports = {
  expo: {
    name: IS_PRODUCTION ? "Uncluttrd" : "Uncluttrd Staging",
    slug: "cluttrd",
    // Staging's version is FROZEN, and that is the whole point.
    //
    // `version` is a fingerprint input, so bumping it for a store release
    // changes the runtime fingerprint of EVERY environment that shares this
    // file - including staging, which has no store, no version ordering and no
    // reason to care. The 1.0.4 -> 2.0.0 bump forced four builds: two
    // production ones that were genuinely needed for the release, and two
    // staging ones that were pure collateral. Measured directly: setting this
    // back to "1.0.4" recomputes the staging fingerprint to 194c6294..., byte
    // for byte the runtime already installed on the staging device.
    //
    // Freezing the staging value decouples the two. Production bumps no longer
    // invalidate staging binaries, so a store release costs two builds instead
    // of four. A real native change - new plugin, permission, SDK upgrade -
    // still moves both fingerprints, which is correct: staging genuinely needs
    // rebuilding then.
    //
    // THE PINNED VALUE MUST MATCH THE STAGING BINARY THAT IS ACTUALLY
    // INSTALLED. It is not arbitrary. Pin it to 1.0.4 and staging fingerprints
    // to 194c6294; pin it to 2.0.0 and it fingerprints to a491de68. Whichever
    // build is on the test device is the value that belongs here - get it
    // wrong and every staging OTA silently lands on a runtime no device runs.
    // That happened once already: preview build 24 (a491de68) was installed
    // while this was pinned to 1.0.4, so an OTA published to 194c6294 could
    // never arrive.
    //
    // Currently 2.0.0, matching preview build 24.
    // Only change it when a new staging binary is built AND installed.
    version: IS_PRODUCTION ? PRODUCTION_VERSION : STAGING_VERSION,
    orientation: "portrait",
    icon: IS_PRODUCTION ? "./assets/icon.png" : "./assets/icon-staging.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0F2A52",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_PRODUCTION ? "com.mharrison.uncluttrd" : "com.mharrison.uncluttrd.staging",
      googleServicesFile: GOOGLE_SERVICES_IOS,
      infoPlist: {
        NSCameraUsageDescription: "Uncluttrd needs camera access to photograph your space.",
        NSPhotoLibraryUsageDescription: "Uncluttrd needs your photos to analyze your space.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: IS_PRODUCTION ? "./assets/adaptive-icon.png" : "./assets/adaptive-icon-staging.png",
        backgroundColor: "#0F2A52",
      },
      package: IS_PRODUCTION ? "com.mharrison.uncluttrd" : "com.mharrison.uncluttrd.staging",
      googleServicesFile: GOOGLE_SERVICES_ANDROID,
      permissions: ["android.permission.CAMERA"],
      // The app captures still photos only (image-picker, mediaTypes images)
      // and never records audio or video. expo-camera's own library manifest
      // declares RECORD_AUDIO, so turning its plugin option off is not enough:
      // this emits tools:node="remove" to strip the merged declaration.
      blockedPermissions: ["android.permission.RECORD_AUDIO"],
    },
    // EAS Update (DecisionLog.md 2026-07-18). Fingerprint policy, not
    // appVersion - runtimeVersion is derived from the actual resolved
    // native project (which already differs between staging/production via
    // APP_ENV above), so an incompatible update is never even offered to a
    // build, rather than depending on someone remembering to bump `version`.
    // Channel routing (staging vs production) lives in eas.json per build
    // profile, not here.
    updates: {
      url: "https://u.expo.dev/8574a4f2-a2f9-4cac-82ee-f951d37fbb3a",
    },
    runtimeVersion: {
      policy: "fingerprint",
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    plugins: [
      [
        "expo-image-picker",
        {
          photosPermission: "Uncluttrd needs your photos to analyze your space.",
          cameraPermission: "Uncluttrd needs camera access to photograph your space.",
          microphonePermission: false,
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "Uncluttrd needs camera access to photograph your space.",
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      "expo-font",
      "@react-native-firebase/app",
      "@react-native-firebase/analytics",
      [
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static",
            forceStaticLinking: ["RNFBApp", "RNFBAnalytics"],
          },
        },
      ],
      ...PRODUCTION_ONLY_PLUGINS,
    ],
    extra: {
      eas: {
        projectId: "8574a4f2-a2f9-4cac-82ee-f951d37fbb3a",
      },
      // Exposed to the running app via expo-constants (Constants.expoConfig.extra.APP_ENV)
      // for the in-app STAGING banner - see the AppRoot render in App.js.
      APP_ENV,
    },
    owner: "mharrison30",
  },
};
