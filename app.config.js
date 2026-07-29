// Dynamic config, replacing the old static app.json. Branches bundle
// identity, display name, icon, and Google Services config by APP_ENV,
// which every EAS build profile sets explicitly (see eas.json) - this is
// the enforcement point for "only the production profile may resolve to
// production," not a runtime toggle. Defaults to "staging" (not
// "production") when unset, so an unexpected local run or a misconfigured
// profile fails safe toward staging, never silently toward production.
const APP_ENV = process.env.APP_ENV || "staging";
const IS_PRODUCTION = APP_ENV === "production";

module.exports = {
  expo: {
    name: IS_PRODUCTION ? "Uncluttrd" : "Uncluttrd Staging",
    slug: "cluttrd",
    version: "1.0.4",
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
