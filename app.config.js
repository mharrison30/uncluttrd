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
const PRODUCTION_VERSION = "2.0.0";
// PINNED to whichever staging binary is installed on the test device - see the
// long note on `version` below. Bumping this orphans the installed staging app.
const STAGING_VERSION = "2.0.0";

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
      googleServicesFile: IS_PRODUCTION ? "./GoogleService-Info.plist" : "./GoogleService-Info.staging.plist",
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
      googleServicesFile: IS_PRODUCTION ? "./google-services.json" : "./google-services.staging.json",
      permissions: ["android.permission.CAMERA"],
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
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission: "Uncluttrd needs camera access to photograph your space.",
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
