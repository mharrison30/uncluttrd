import { useState, useEffect, useRef } from "react";
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  Image, ActivityIndicator, Linking, StatusBar,
  TextInput, KeyboardAvoidingView, Platform, Alert, Share, Modal, Dimensions, BackHandler
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Rect, Circle, Polyline, Line } from "react-native-svg";
import { ImageZoom } from '@likashefqet/react-native-image-zoom';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import * as Font from "expo-font";
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Menu, Check, X, AlertTriangle, Sparkles, HelpCircle, Camera, Image as ImageIcon, FileText, Mail, LogOut, User, Clock, ShoppingBag, Folder, Share2, Zap, Star, Diamond, Sofa, Shirt, CarFront, UtensilsCrossed, BedDouble, Monitor, Lightbulb, Wrench, Home, ChevronRight, Eye, EyeOff } from "lucide-react-native";
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence, getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, deleteUser, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, updateDoc, getDocs, query, orderBy, limit, serverTimestamp, arrayUnion } from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getFunctions, httpsCallable } from "firebase/functions";
import Purchases from "react-native-purchases";
import { getAnalytics, logEvent } from "@react-native-firebase/analytics";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyB4R4hI8_Ej_jwqmukO4y_j1vD1hvIl8-8",
  authDomain: "auth.uncluttrd.app",
  projectId: "cluttrd-3e335",
  storageBucket: "cluttrd-3e335.firebasestorage.app",
  messagingSenderId: "427768202763",
  appId: "1:427768202763:web:f47a4005880db50085690e"
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
let auth;
try {
  auth = initializeAuth(firebaseApp, { persistence: getReactNativePersistence(AsyncStorage) });
} catch (e) {
  // Already initialized (common after a Fast Refresh hot reload) — reuse the existing instance.
  auth = getAuth(firebaseApp);
}
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const functions = getFunctions(firebaseApp, "us-central1");

// Known test/dev accounts — update this list as more are added.
const KNOWN_TEST_EMAILS = [
  "hello@uncluttrd.app",
  "michael@earthwiseenergy.net",
  "reviewer@uncluttrd.app",
  "cgignac28@yahoo.com",
];

// Creates the users/{uid} profile document if it doesn't exist yet — covers both
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



// Uncluttrd drawer icon — transparent background, two versions
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

const TIERS = [
  { id: "budget", label: "Budget", range: "Under $50", icon: Check, color: BRAND.green, bg: BRAND.greenLight, border: BRAND.greenMid },
  { id: "mid", label: "Mid-Range", range: "$50-$200", icon: Sparkles, color: BRAND.tan, bg: BRAND.tanLight, border: BRAND.tanBorder },
  { id: "premium", label: "Premium", range: "$200+", icon: Diamond, color: BRAND.purple, bg: BRAND.purpleLight, border: BRAND.purpleBorder },
];

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
    desc: "Every plan includes hand-picked product recommendations with direct product links. One tap and you're ready to transform your space.",
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

      {/* Slide content — swipeable */}
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

      {/* Dots — tappable too, to match swipe navigation */}
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
    if (!email || !password) { setErr("Please enter your email and password."); return; }
    if (mode === "signup" && !firstName) { setErr("Please enter your first name."); return; }
    if (mode === "signup" && !lastName) { setErr("Please enter your last name."); return; }
    if (password.length < 6) { setErr("Password must be at least 6 characters."); return; }
    setLoading(true); setErr(null);
    try {
      if (mode === "signup") {
        const fullName = [firstName, lastName, suffix].filter(Boolean).join(" ");
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: fullName });
        await ensureUserDocument(cred.user, { referralSource: referralSource || null });
        // Sign out and back in to force auth state to refresh with new displayName
        await signOut(auth);
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
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
    if (!email) { setErr("Enter your email above, then tap Forgot Password."); return; }
    setLoading(true); setErr(null);
    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert("Check your email", "If an account exists for that email, we've sent a link to reset your password.");
    } catch (e) {
      if (e.code === "auth/user-not-found") {
        // Same message as success — don't reveal whether an account exists for this email.
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
// per CompanionDesignPrinciples.md. Purely prop-driven — placement on
// the results screen is a separate change (Milestone 4).
function CompanionCard({ stage, actionText, tipIndex, onStart, onComplete, onSharePhoto, onFinishedForToday, onUpgrade }) {
  if (stage === "finished") return null;

  const GENERATING_TIPS = [
    "Looking at what's changed...",
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
        <Text style={s.companionBody}>Upgrading keeps this going — new steps, saved as you go.</Text>
        <TouchableOpacity style={s.companionBtn} onPress={onUpgrade}>
          <Text style={s.companionBtnText}>Upgrade</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (stage === "celebrating") {
    return (
      <View style={s.companionCard}>
        <Text style={s.companionTitle}>Nice work</Text>
        <Text style={s.companionBody}>Great progress.</Text>
        <TouchableOpacity style={s.companionBtn} onPress={onSharePhoto}>
          <Text style={s.companionBtnText}>Show me what you accomplished</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // suggested | started | companion-active share one layout
  const title = stage === "companion-active" ? "Ready to keep going?" : "Let's Start Here";
  return (
    <View style={s.companionCard}>
      <Text style={s.companionTitle}>{title}</Text>
      <Text style={s.companionBody}>{actionText}</Text>
      {stage === "started" ? (
        <TouchableOpacity style={s.companionBtn} onPress={onComplete}>
          <Text style={s.companionBtnText}>I'm Done</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={s.companionBtn} onPress={onStart}>
          <Text style={s.companionBtnText}>I'm Ready</Text>
        </TouchableOpacity>
      )}
      {stage === "companion-active" && (
        <TouchableOpacity style={s.companionSecondaryBtn} onPress={onFinishedForToday}>
          <Text style={s.companionSecondaryBtnText}>Finished for today</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function MainApp({ user, isPro, setIsPro, analyses, setAnalyses, setSkipPref }) {
  const [photo, setPhoto] = useState(null);
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const [showMenu, setShowMenu] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
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

  // ── Companion loop state ──────────────────────────────────
  // Analytics-only correlator for the free-tier funnel, since free plans are
  // never persisted and so never get a real Firestore planId. Minted once per
  // analysis, never written to Firestore — see Analytics.md / DecisionLog.md
  // 2026-07-13 (Companion Analytics: Event Catalog, Philosophy, and Commerce Reuse).
  const analysisIdRef = useRef(null);
  const secondsSince = (msTimestamp) => (msTimestamp ? Math.round((Date.now() - msTimestamp) / 1000) : null);

  const [companionStage, setCompanionStage] = useState("suggested"); // suggested | started | celebrating | generating | companion-active | paywall-prompt | finished
  const [companionActionText, setCompanionActionText] = useState(null);
  const [companionActionIndex, setCompanionActionIndex] = useState(1); // 1 = firstAction, 2+ = companionAction
  const [companionStartedAt, setCompanionStartedAt] = useState(null); // ms timestamp — feeds a future secondsSinceStarted analytics property (Milestone 6)
  const [companionCompletedAt, setCompanionCompletedAt] = useState(null); // ISO string, used when archiving into companionActionHistory
  const [progressPhoto, setProgressPhoto] = useState(null);
  const [companionTipIndex, setCompanionTipIndex] = useState(0);
  const companionTipTimer = useRef(null);
  const companionBasePhotoRef = useRef(null); // most recent "before" photo used for the next comparison

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
  // A fresh analysis returns firstAction as a plain string (see the analyzePhoto
  // prompt); a reopened saved plan returns the persisted object shape
  // { text, status, suggestedAt, startedAt, completedAt } — both are handled here
  // so resuming a saved plan picks up exactly where it was left, not from scratch.
  useEffect(() => {
    if (!results) return;
    if (results.companionAction) {
      setCompanionActionIndex(results.companionAction.actionIndex || 2);
      setCompanionActionText(results.companionAction.text || null);
      setCompanionStage(results.companionAction.status === "started" ? "started" : "companion-active");
      setCompanionStartedAt(results.companionAction.startedAt ? new Date(results.companionAction.startedAt).getTime() : null);
      // Only reached when reopening a saved plan (a fresh analysis never has a
      // companionAction yet) — this is a resumed view, not a freshly generated one.
      logEvent(getAnalytics(), "companion_action_viewed", { planId: currentPlanId, actionIndex: results.companionAction.actionIndex || 2 });
    } else if (results.firstAction) {
      const isFreshAnalysis = typeof results.firstAction === "string";
      setCompanionActionIndex(1);
      setCompanionActionText(isFreshAnalysis ? results.firstAction : (results.firstAction.text || null));
      setCompanionStage(isFreshAnalysis || results.firstAction.status !== "started" ? "suggested" : "started");
      setCompanionStartedAt(!isFreshAnalysis && results.firstAction.startedAt ? new Date(results.firstAction.startedAt).getTime() : null);
    } else {
      setCompanionActionText(null);
    }
    setCompanionCompletedAt(null);
    setProgressPhoto(null);
    companionBasePhotoRef.current = photo?.uri || null;
  }, [results]);

  const handleCompanionStart = () => {
    const startedAtIso = new Date().toISOString();
    setCompanionStartedAt(Date.now());
    setCompanionStage("started");
    if (companionActionIndex === 1) {
      logEvent(getAnalytics(), "first_action_started", { analysisId: analysisIdRef.current });
    } else {
      logEvent(getAnalytics(), "companion_action_started", { planId: currentPlanId, actionIndex: companionActionIndex });
    }
    if (isPro && currentPlanId) {
      const field = companionActionIndex === 1 ? "firstAction" : "companionAction";
      updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
        [`${field}.status`]: "started",
        [`${field}.startedAt`]: startedAtIso,
      }).catch(e => console.log("Save companion start error:", e.message));
    }
  };

  const handleCompanionComplete = () => {
    const completedAtIso = new Date().toISOString();
    setCompanionCompletedAt(completedAtIso);
    setCompanionStage("celebrating");
    if (companionActionIndex === 1) {
      logEvent(getAnalytics(), "first_action_completed", { analysisId: analysisIdRef.current, secondsSinceStarted: secondsSince(companionStartedAt) });
      logEvent(getAnalytics(), "progress_photo_prompted", { analysisId: analysisIdRef.current });
    } else {
      logEvent(getAnalytics(), "companion_action_completed", { planId: currentPlanId, actionIndex: companionActionIndex, secondsSinceStarted: secondsSince(companionStartedAt) });
    }
    if (isPro && currentPlanId) {
      const field = companionActionIndex === 1 ? "firstAction" : "companionAction";
      updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
        [`${field}.status`]: "completed",
        [`${field}.completedAt`]: completedAtIso,
      }).catch(e => console.log("Save companion complete error:", e.message));
    }
  };

  const handleCompanionFinishedForToday = () => {
    setCompanionStage("finished");
    logEvent(getAnalytics(), "companion_session_completed", { planId: currentPlanId });
  };

  const handleCompanionUpgradeRequest = () => {
    logEvent(getAnalytics(), "companion_upgrade_clicked", { analysisId: analysisIdRef.current });
    // Paywall integration lands in Milestone 7 — this is a placeholder hook point.
    console.log("Companion upgrade requested");
  };

  const submitCompanionProgressPhoto = async (progressUri, progressBase64) => {
    setProgressPhoto({ uri: progressUri, base64: progressBase64 });
    if (!isPro) {
      setCompanionStage("paywall-prompt");
      logEvent(getAnalytics(), "companion_paywall_viewed", { analysisId: analysisIdRef.current });
      return;
    }
    setCompanionStage("generating");
    startCompanionTips();
    try {
      const beforeSource = companionBasePhotoRef.current;
      if (!beforeSource) throw new Error("Missing before photo for comparison");
      const compressedBefore = await manipulateAsync(beforeSource, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      const compressedAfter = await manipulateAsync(progressUri, [{ resize: { width: 1024 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
      const nextPrompt = `You are a warm, encouraging professional organizer. Compare these two photos of the same space: the first is before, the second is after the user completed this step: "${companionActionText}". In one warm sentence, acknowledge what's improved. Then suggest one single new specific next step, doable in roughly 15-20 minutes, written the same way — one or two warm sentences, no time estimate stated, no list-like phrasing.\n\nReturn ONLY valid JSON, nothing else — no markdown, no backticks.\n\n{"progressNote":"one warm sentence acknowledging the improvement","companionAction":"one or two warm sentences describing the next step"}`;
      const generateNextActionFn = httpsCallable(functions, "generateNextAction");
      const result = await generateNextActionFn({ beforeImageBase64: compressedBefore.base64, afterImageBase64: compressedAfter.base64, prompt: nextPrompt });
      const raw = result.data?.text || "";
      const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      // Upload the progress photo to Storage (same pattern as the original analysis
      // photo) so it can be persisted on the plan doc, not just held in memory.
      let progressPhotoUrl = null;
      if (currentPlanId) {
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
          const path = `plans/${user.uid}/${currentPlanId}/progress/${Date.now()}.jpg`;
          const fileRef = storageRef(storage, path);
          await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
          progressPhotoUrl = await getDownloadURL(fileRef);
        } catch (uploadErr) {
          console.log("Progress photo upload error:", uploadErr.message);
        }
      }

      const newActionIndex = companionActionIndex + 1;
      if (currentPlanId) {
        const archivedAction = {
          actionIndex: companionActionIndex,
          text: companionActionText,
          startedAt: companionStartedAt ? new Date(companionStartedAt).toISOString() : null,
          completedAt: companionCompletedAt || new Date().toISOString(),
        };
        updateDoc(doc(db, "users", user.uid, "plans", currentPlanId), {
          companionActionHistory: arrayUnion(archivedAction),
          ...(progressPhotoUrl ? { progressPhotos: arrayUnion({ actionIndex: companionActionIndex, url: progressPhotoUrl, uploadedAt: new Date().toISOString() }) } : {}),
          companionAction: {
            actionIndex: newActionIndex,
            text: parsed.companionAction || "",
            status: "suggested",
            suggestedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          },
        }).catch(e => console.log("Save companion progress error:", e.message));
      }

      logEvent(getAnalytics(), "companion_progress_photo_uploaded", { planId: currentPlanId, actionIndex: companionActionIndex });
      logEvent(getAnalytics(), "companion_next_action_generated", { planId: currentPlanId, actionIndex: newActionIndex });
      if (newActionIndex === 2) {
        logEvent(getAnalytics(), "companion_session_started", { planId: currentPlanId });
      }
      logEvent(getAnalytics(), "companion_action_viewed", { planId: currentPlanId, actionIndex: newActionIndex });

      companionBasePhotoRef.current = progressUri;
      setCompanionActionText(parsed.companionAction || "");
      setCompanionActionIndex(newActionIndex);
      setCompanionStage("companion-active");
    } catch (e) {
      console.log("Companion next-action error:", e.message);
      logEvent(getAnalytics(), "companion_action_failed", { planId: currentPlanId, actionIndex: companionActionIndex, reason: e.message });
      setCompanionStage("celebrating"); // fall back to the photo-share moment rather than strand the user
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

  const handleCompanionSharePhoto = () => {
    if (companionActionIndex === 1) {
      logEvent(getAnalytics(), "progress_photo_started", { analysisId: analysisIdRef.current });
    }
    Alert.alert(
      "Show me what you accomplished",
      "How would you like to share your progress?",
      [
        { text: "Take Photo", onPress: captureCompanionPhoto },
        { text: "Choose from Camera Roll", onPress: pickCompanionPhoto },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyItem, setHistoryItem] = useState(null); // viewing a past plan
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallPlan, setPaywallPlan] = useState("yearly");
  const [selectedRoom, setSelectedRoom] = useState(null);
  const resultsScrollRef = useRef(null);
  const [loadMsg, setLoadMsg] = useState(0);
  const loadTimer = useRef(null);

  const LOAD_MESSAGES = [
    "Studying your space layout...",
    "Identifying what needs to stay and what can go...",
    "Selecting storage solutions for your budget...",
    "Building your three-tier organization plan...",
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

  const pickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Photos Permission Required", "Cluttrd needs access to your photos to analyze your space. Please go to Settings → Uncluttrd → Photos and allow access.", [{ text: "OK" }]);
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

  // Load history from AsyncStorage
  useEffect(() => {
    const loadHistory = async () => {
      if (!isPro) return;
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
  }, []);

  useEffect(() => {
    if (showPaywall) {
      logEvent(getAnalytics(), "paywall_viewed");
    }
  }, [showPaywall]);

  // Save plan to Firestore after successful analysis
  const savePlanToHistory = async (plan) => {
    if (!isPro) { console.log("Not pro - skipping save"); return; }
    try {
      console.log("Saving plan for user:", user.uid);
      const entry = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        spaceType: plan.spaceType,
        overview: plan.overview,
        itemsFound: plan.itemsFound,
        tiers: plan.tiers,
        proTip: plan.proTip,
        vizImages: {},
        firstAction: plan.firstAction ? {
          text: plan.firstAction,
          status: "suggested",
          suggestedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        } : null,
        companionAction: null,
        companionActionHistory: [],
        progressPhotos: [],
      };
      const docRef = await addDoc(collection(db, "users", user.uid, "plans"), entry);
      console.log("Plan saved successfully:", docRef.id);
      setCurrentPlanId(docRef.id);
      setHistory(prev => [{ id: docRef.id, ...entry }, ...prev]);

      // Persist the original photo so reopening this plan later (e.g. to regenerate
      // a visualization) uses its own photo instead of whatever is in the live `photo` state.
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
        } catch (photoErr) {
          console.log("Save original photo error:", photoErr.message);
        }
      }
    } catch (e) {
      console.log("Save history error:", e.message, e.code);
    }
  };

  // Tracks which plan's photo is currently being restored so a late-resolving download
  // for an abandoned plan can't overwrite the photo of whichever plan is now on screen.
  const activePlanIdRef = useRef(null);

  // Downloads a plan's stored photo locally so manipulateAsync (which requires a
  // local file URI, not a remote URL) can use it when regenerating a visualization.
  const restorePhotoFromPlan = async (item) => {
    activePlanIdRef.current = item.id;
    setPhoto(null); // clear immediately so nothing can fire generateVisualization with a stale photo while this loads
    if (!item.photoUrl) return;
    try {
      const localUri = FileSystem.cacheDirectory + `plan_photo_${item.id}.jpg`;
      const { uri } = await FileSystem.downloadAsync(item.photoUrl, localUri);
      if (activePlanIdRef.current !== item.id) return; // user switched/left before this resolved
      setPhoto({ uri, base64: null, mimeType: "image/jpeg" });
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
    analysisIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setLoading(true); setErr(null); setResults(null); setCurrentPlanId(null); startLoadMessages();
    try {
      const budgetNote = budget
        ? `The user has a specific budget of $${budget}. Highlight which tier best fits their budget, but still show all three.`
        : `Show all three tiers: Budget (under $50), Mid-Range ($50-$200), and Premium ($200+).`;
      const prompt = `You are a warm expert home organizer. Analyze this photo of a space.\n\n${budgetNote}\n\nIMPORTANT: For each tier, the three suggested products must collectively ADD UP to fall within that tier's price range — this is a total budget, not a per-item price. For the Budget tier, all three product prices combined must total under $50 (for example $15 + $20 + $12 = $47, NOT three items at ~$50 each). For Mid-Range, the three combined must total within $50-$200. For Premium, combined total should be $200 or more. Check your math before responding.\n\nAlso identify one single "first action": the single most obvious, encouraging, doable-right-now step for this space, independent of budget tier. It should be scoped to roughly 15-20 minutes of real work — small enough to start immediately, substantial enough to feel like real progress. Describe what to do, in one or two warm sentences, in the voice of a calm, encouraging professional organizer — not a task-list label, not an estimate of how long it will take.\n\nReturn ONLY valid JSON, nothing else — no markdown, no backticks.\n\n{"spaceType":"short label","overview":"2 warm sentences","itemsFound":["3-6 specific items or clutter types you can actually see in the photo"],"firstAction":"one or two warm sentences describing the single best doable-right-now step","tiers":[{"id":"budget","label":"Budget","range":"Under $50","suggestions":["tip1","tip2","tip3","tip4"],"products":[{"name":"product","price":"$X","searchQuery":"search","icon":"📦"},{"name":"product","price":"$X","searchQuery":"search","icon":"🗂️"},{"name":"product","price":"$X","searchQuery":"search","icon":"🏷️"}]},{"id":"mid","label":"Mid-Range","range":"$50-$200","suggestions":["tip1","tip2","tip3","tip4"],"products":[{"name":"product","price":"$X","searchQuery":"search","icon":"🗃️"},{"name":"product","price":"$X","searchQuery":"search","icon":"✨"},{"name":"product","price":"$X","searchQuery":"search","icon":"📋"}]},{"id":"premium","label":"Premium","range":"$200+","suggestions":["tip1","tip2","tip3","tip4"],"products":[{"name":"product","price":"$X","searchQuery":"search","icon":"💎"},{"name":"product","price":"$X","searchQuery":"search","icon":"🏡"},{"name":"product","price":"$X","searchQuery":"search","icon":"✦"}]}],"proTip":"one expert insight"}`;

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
      try {
        const result = await analyzePhotoFn({ imageBase64, prompt });
        raw = result.data?.text || "";
      } catch (fnErr) {
        console.log("Function error:", fnErr.code, fnErr.message);
        logEvent(getAnalytics(), "plan_failed", { reason: fnErr.code });
        if (fnErr.code === "functions/unavailable" || (fnErr.message || "").includes("Network")) {
          setErr("No internet connection. Please check your WiFi or cellular and try again.");
        } else {
          setErr("Something went wrong analyzing your photo. Please try again.");
        }
        return;
      }
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        logEvent(getAnalytics(), "plan_failed", { reason: "unparseable_response" });
        setErr("We had trouble reading your space. Try a clearer, well-lit photo.");
        return;
      }
      const parsed = JSON.parse(match[0]);
      setResults(parsed);
      logEvent(getAnalytics(), "plan_completed");
      if (parsed.firstAction) {
        logEvent(getAnalytics(), "first_action_viewed", { analysisId: analysisIdRef.current });
      } else {
        logEvent(getAnalytics(), "first_action_failed", { analysisId: analysisIdRef.current, reason: "missing_first_action" });
      }
      savePlanToHistory(parsed);
      setTimeout(() => resultsScrollRef.current?.scrollTo({ y: 0, animated: false }), 100);
      if (!isPro) {
        const current = analyses || 0;
        const newCount = current + 1;
        await AsyncStorage.setItem("analysisCount", newCount.toString());
        setAnalyses(newCount);
      }
    } catch (e) {
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






      const HEADER_IMG = "data:image/png;base64,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";

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
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#1E9E52;margin-bottom:4px;margin-top:8px;">${results.spaceType}</div>
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
      Alert.alert("Photo unavailable", "We couldn't find the original photo for this plan. Please reopen it from My Plans and try again.");
      return;
    }
    setVizLoading(prev => ({ ...prev, [tier.id]: true }));
    startVizTips();
    try {
      const productList = tier.products?.map(p => p.name).join(", ");
      const suggestionList = tier.suggestions?.join(". ");
      const itemsFound = results.itemsFound?.join(", ") || "";
      const prompt = `Reorganize and declutter this exact ${results.spaceType}. Keep the same room — the same walls, floor, window, door, ceiling, and architecture exactly as shown in the photo. Do not invent a different room or change its layout, dimensions, or finishes. Only change the contents: remove clutter, and apply these specific changes: ${suggestionList}.${productList ? ` Add these storage solutions in a realistic way: ${productList}.` : ""}${itemsFound ? ` The space currently contains: ${itemsFound} — organize these rather than removing them entirely unless the suggestions say to.` : ""} Photorealistic result, warm natural lighting, magazine-quality home organization photography. No text, no labels, no annotations, no callouts, no arrows, no watermarks, no overlays. No people.`;

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
      // re-pay for another OpenAI generation (and instead of leaking a stale one — see vizImages below).
      let finalUrl = rawImage; // fallback: still show locally this session even if upload fails
      try {
        let sourceUri = rawImage;
        if (b64) {
          // manipulateAsync needs a file URI, not a raw base64 string — write it to a temp file first.
          const tempPath = FileSystem.cacheDirectory + `viz_raw_${tier.id}_${Date.now()}.png`;
          await FileSystem.writeAsStringAsync(tempPath, b64, { encoding: FileSystem.EncodingType.Base64 });
          sourceUri = tempPath;
        }
        const compressed = await manipulateAsync(sourceUri, [], { compress: 0.75, format: SaveFormat.JPEG });
        // Read the compressed file into a real Blob via XHR rather than constructing one from
        // raw bytes in JS — modern React Native's Blob constructor only supports Blobs/strings,
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
        // finalUrl stays as the raw OpenAI image — works for this session, just won't persist cheaply.
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
        console.log("No currentPlanId yet — visualization shown locally but not persisted to a saved plan.");
      }
    } catch (e) {
      Alert.alert("Visualization failed", e.message);
    } finally {
      stopVizTips();
      setVizLoading(prev => ({ ...prev, [tier.id]: false }));
    }
  };

  const openProduct = (q) => Linking.openURL(`https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=uncluttrd20-20`);

  const shareResults = async () => {
    if (!results) return;
    try {
      let text = "✨ Uncluttrd Organization Plan\n";
      text += "Space: " + results.spaceType + "\n\n";
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
  // user has engaged with it beyond just seeing the suggestion — either they're
  // mid-loop (a companionAction exists) or they started/finished their first
  // action. Plans where firstAction was never even started don't count; there's
  // nothing to "continue" yet. Free-tier sessions are never persisted, so this
  // only ever applies to Pro plans (history is already Pro-only, see loadHistory).
  const isCompanionResumable = (plan) => {
    if (plan?.companionAction) return true;
    if (plan?.firstAction && typeof plan.firstAction === "object" && plan.firstAction.status && plan.firstAction.status !== "suggested") return true;
    return false;
  };
  const resumablePlan = isPro ? history.find(isCompanionResumable) : null;

  const resumeCompanionSession = (item) => {
    logEvent(getAnalytics(), "companion_session_resumed", { planId: item.id, source: "home_banner" });
    setResults(item);
    setVizImage(item.vizImages || {});
    setVizLoading({});
    setCurrentPlanId(item.id);
    restorePhotoFromPlan(item);
  };
  const reset = () => { activePlanIdRef.current = null; setPhoto(null); setResults(null); setErr(null); setBudget(""); setTierTouched(false); setVizImage({}); setVizLoading({}); setPhotoSize({ width: 1, height: 1 }); setVizModal(null); setVizModal(null); setCurrentPlanId(null); setCompanionStage("suggested"); setCompanionActionText(null); setCompanionActionIndex(1); setCompanionStartedAt(null); setCompanionCompletedAt(null); setProgressPhoto(null); companionBasePhotoRef.current = null; analysisIdRef.current = null; };
  const goHome = () => { activePlanIdRef.current = null; setShowMenu(false); setShowHistory(false); setShowFaq(false); setShowAccount(false); setResults(null); setPhoto(null); setErr(null); setVizImage({}); setVizLoading({}); setCurrentPlanId(null); setCompanionStage("suggested"); setCompanionActionText(null); setCompanionActionIndex(1); setCompanionStartedAt(null); setCompanionCompletedAt(null); setProgressPhoto(null); companionBasePhotoRef.current = null; analysisIdRef.current = null; };

  // Android hardware/gesture back button: step back through in-app screens instead of
  // exiting. Each branch matches that screen's own existing back/close behavior exactly
  // (e.g. History/FAQ/Account's own back arrows return to Menu, not Home) rather than
  // inventing a different navigation model. No-op on iOS by construction — addEventListener
  // is a hardcoded no-op there (see react-native's BackHandler.ios.js) — but guarded
  // explicitly anyway so that's obvious from the code itself, not just implicit platform behavior.
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const onBackPress = () => {
      if (showPaywall) { setShowPaywall(false); return true; }
      if (showMenu) { setShowMenu(false); return true; }
      if (showHistory) { setShowHistory(false); setShowMenu(true); return true; }
      if (showFaq) { setShowFaq(false); setShowMenu(true); return true; }
      if (showAccount) { setShowAccount(false); setShowMenu(true); return true; }
      if (results) { goHome(); return true; }
      return false;
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [showPaywall, showMenu, showHistory, showFaq, showAccount, results]);

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
      "This permanently deletes your account and all your saved data, including your plan history and visualizations. This cannot be undone.",
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
      const uid = currentUser.uid;

      // Re-authenticate
      const credential = EmailAuthProvider.credential(currentUser.email, deletePassword);
      await reauthenticateWithCredential(currentUser, credential);

      // Delete Firestore data WHILE USER IS STILL AUTHENTICATED
      // Security rules require auth.uid == userId, so cleanup must happen before deleteUser()
      // Critical: if this fails for any reason, stop and surface the error.
      // Do not proceed to delete Auth if Firestore cleanup fails.
      const { collection, getDocs, deleteDoc, doc } = await import("firebase/firestore");
      const plansSnap = await getDocs(collection(db, "users", uid, "plans"));
      await Promise.all(plansSnap.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "users", uid));

      // Delete Storage files WHILE USER IS STILL AUTHENTICATED
      // Non-critical errors (object not found) are logged and skipped.
      // Critical errors (permissions, network) stop the process.
      const { listAll, deleteObject } = await import("firebase/storage");
      const vizRef = storageRef(storage, `viz/${uid}`);
      const vizList = await listAll(vizRef);
      const allItems = [
        ...vizList.items,
        ...(await Promise.all(vizList.prefixes.map(async folder => {
          const folderList = await listAll(folder);
          return folderList.items;
        }))).flat()
      ];
      await Promise.all(allItems.map(async item => {
        try {
          await deleteObject(item);
        } catch (itemErr) {
          // object/not-found is non-critical — file already gone, safe to continue
          if (itemErr.code === "storage/object-not-found") {
            console.log("Storage item already deleted:", item.fullPath);
          } else {
            // Any other storage error is critical — rethrow to stop deletion
            throw itemErr;
          }
        }
      }));

      // Delete Firebase Auth account LAST
      // Firestore and Storage are clean. If this fails, user can try again.
      await deleteUser(currentUser);

      // Clear auth form fields and local storage
      setEmail("");
      setPassword("");
      await AsyncStorage.removeItem("analysisCount");
      await AsyncStorage.removeItem("isPro");
      await AsyncStorage.removeItem("skipOnboarding");

      setShowDeleteModal(false);

    } catch (err) {
      setDeleteLoading(false);
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        setDeleteError("Incorrect password. Please try again.");
      } else {
        setDeleteError("Something went wrong. Please try again.");
      }
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
            <Text style={s.paywallSubtitle}>AI visualizations, branded PDFs, and full plan history.</Text>
          </View>

          {/* Free vs Pro comparison */}
          <Text style={[s.sectionLabel, { marginTop: 4, alignSelf: "flex-start" }]}>COMPARE FEATURES</Text>
          <View style={{ width: "100%", marginBottom: 24 }}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
              <View style={[s.compareCol, { borderColor: BRAND.stone }]}>
                <Text style={s.compareColHeader}>Free</Text>
                {[
                  "3 plans/month",
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
                  "Unlimited plans",
                  "AI visualizations",
                  "Full plan history",
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

          <TouchableOpacity style={s.paywallCta} onPress={async () => {
            logEvent(getAnalytics(), "pro_upgrade_clicked");
            try {
              const offerings = await Purchases.getOfferings();
              const current = offerings.current;
              const product = paywallPlan === "yearly"
                ? current?.annual?.product
                : current?.monthly?.product;

              if (!product) {
                Alert.alert("Unavailable", "Unable to load subscription options. Please check your connection and try again.");
                return;
              }

              logEvent(getAnalytics(), "subscription_started", { analysisId: analysisIdRef.current, source: "general_paywall" });
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
            }
          }}>
            <Text style={s.paywallCtaText}>{paywallPlan === "yearly" ? "Go Unlimited - $39.99/year" : "Go Unlimited - $4.99/month"}</Text>
          </TouchableOpacity>
          <Text style={s.paywallCtaSub}>Cancel anytime • Managed by {Platform.OS === "android" ? "Google Play" : "Apple"}</Text>
          <Text style={[s.paywallCtaSub, { marginTop: -8 }]}>
            <Text onPress={() => Linking.openURL("https://uncluttrd.app/terms.html")} style={{ textDecorationLine: "underline" }}>Terms of Use</Text>
            {"  •  "}
            <Text onPress={() => Linking.openURL("https://uncluttrd.app/privacy.html")} style={{ textDecorationLine: "underline" }}>Privacy Policy</Text>
          </Text>

          <TouchableOpacity style={s.paywallSkip} onPress={() => setShowPaywall(false)}>
            <Text style={s.paywallSkipText}>Maybe later</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{ marginTop: 12, padding: 8 }} onPress={async () => {
            try {
              const { customerInfo } = await Purchases.restorePurchases();
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

  if (showMenu) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrTag}>{isPro ? "Pro member" : `${Math.max(0, 3 - (analyses || 0))} Free Plans Remaining`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(false)} style={{ padding: 8 }}>
            <X size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.scrollContent}>
          <Text style={[s.sectionLabel, { marginTop: 8 }]}>MENU</Text>

          {[
            { icon: Home, label: "Home", action: goHome },
            { icon: Folder, label: "My Plans", action: () => { setShowMenu(false); setShowHistory(true); }, pro: true },
            { icon: User, label: "Account", action: () => { setShowMenu(false); setShowAccount(true); } },
            { icon: Star, label: "Upgrade to Pro", action: () => { setShowMenu(false); setShowPaywall(true); }, hide: isPro },
            { icon: HelpCircle, label: "Help & FAQ", action: () => { setShowMenu(false); setShowFaq(true); } },
            { icon: Mail, label: "Contact Us", action: () => Linking.openURL("mailto:hello@uncluttrd.app") },
          ].filter(item => !item.hide).map((item, i) => (
            <TouchableOpacity key={i} style={s.menuItem} onPress={() => {
              if (item.pro && !isPro) { setShowMenu(false); setShowPaywall(true); return; }
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
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrPageName}>My Plans</Text>
            <Text style={s.hdrTag}>{history.length} saved {history.length === 1 ? "plan" : "plans"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setShowHistory(false); setShowFaq(false); setShowAccount(false); setShowMenu(true); }} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.scrollContent}>
          {history.length === 0 ? (
            <View style={{ alignItems: "center", paddingTop: 60 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
              <Text style={[s.resTitle, { textAlign: "center", marginBottom: 8 }]}>No plans yet</Text>
              <Text style={[s.heroP, { textAlign: "center" }]}>Your analyzed spaces will appear here after you get your first organization plan.</Text>
            </View>
          ) : (
            history.map((item) => (
              <TouchableOpacity key={item.id} style={s.historyItem} onPress={() => {
                Alert.alert(item.spaceType, "What would you like to do?", [
                  { text: "View Full Plan", onPress: () => { console.log("Opening plan", item.id, "vizImages:", JSON.stringify(item.vizImages)); if (isCompanionResumable(item)) { logEvent(getAnalytics(), "companion_session_resumed", { planId: item.id, source: "my_plans" }); } setResults(item); setVizImage(item.vizImages || {}); setVizLoading({}); setCurrentPlanId(item.id); setShowHistory(false); restorePhotoFromPlan(item); } },
                  { text: "Share as PDF", onPress: () => { setResults(item); setVizImage(item.vizImages || {}); setVizLoading({}); setCurrentPlanId(item.id); restorePhotoFromPlan(item); setTimeout(() => generatePDF(), 100); } },
                  { text: "Cancel", style: "cancel" },
                ]);
              }}>
                <View style={s.historyIcon}>
                  <Text style={{ fontSize: 20 }}>🏠</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4, gap: 8 }}>
                    <Text style={[s.historySpace, { flex: 1 }]} numberOfLines={1}>{item.spaceType}</Text>
                    <Text style={[s.historyDate, { flexShrink: 0 }]}>{item.date}</Text>
                  </View>
                  <Text style={s.historyOverview} numberOfLines={2}>{item.overview}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // FAQ SCREEN
  if (showFaq) {
    const faqs = [
      { q: "How does Uncluttrd work?", a: "Take a photo of any space: a closet, garage, kitchen, or room. Uncluttrd's AI analyzes what it sees and creates a personalized organization plan across three budget levels with specific product recommendations." },
      { q: "What spaces can I organize?", a: "Any space! Closets, garages, kitchens, pantries, home offices, bedrooms, laundry rooms, storage units. If you can photograph it, Uncluttrd can help organize it." },
      { q: "What's the difference between the budget tiers?", a: "Budget (under $50) uses quick wins and items you may already have. Mid-Range ($50-$200) adds quality organizers and storage systems. Premium ($200+) features custom solutions and high-end products for a fully transformed space." },
      { q: "Can I enter my own budget?", a: "Yes! Below the budget tier buttons you'll find a custom budget field. Enter any dollar amount and Uncluttrd will highlight which tier best fits your budget." },
      { q: "What is Uncluttrd Pro?", a: "Uncluttrd Pro ($4.99/mo) gives you unlimited analyses, full plan history saved to your account, AI visualization of your transformed space, and branded PDF sharing. Free users get 3 free transformations per month." },
      { q: "What is the AI Visualization feature?", a: "After getting your organization plan, tap 'See the transformation' on any tier to generate an AI-created image showing what your space could look like after organizing. This is a Pro feature." },
      { q: "How do I share my organization plan?", a: "Tap the share icon in the top right of your results. Free users can share as text. Pro users can also share a beautifully branded PDF with your full plan." },
      { q: "Where are my saved plans?", a: "Tap the ☰ menu and select 'My Plans' to see all your past organization plans. This is a Pro feature and plans sync across devices via your account." },
      { q: "How do I cancel my subscription?", a: "You can cancel anytime through your iPhone Settings → Apple ID → Subscriptions → Uncluttrd. Your Pro access continues until the end of your billing period." },
      { q: "Is my data secure?", a: "Yes. Your photos are sent securely to our AI for analysis and are not stored on our servers. Your account data is secured through Firebase, Google's enterprise-grade platform." },
      { q: "The product links aren't working. What do I do?", a: "Make sure you have a stable internet connection. The product links open Google Shopping with a search for the recommended item." },
      { q: "How do I contact support?", a: "Email us at hello@uncluttrd.app and we'll get back to you within 24 hours." },
    ];
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
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

  // ACCOUNT SCREEN
  if (showAccount) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
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
            </View>
          </Modal>

      </SafeAreaView>
    );
  }

  // RESULTS SCREEN
  if (results) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" />
        <View style={[s.hdr, { alignItems: "flex-start" }]}>
          <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
            <DrawerIcon size={54} dark={true} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goHome} style={{ flex: 1 }} accessibilityLabel="Go to home" accessibilityRole="button">
            <Text style={s.hdrName}>Uncluttrd{isPro ? <Text style={{ color: BRAND.green, fontFamily: "Inter_600SemiBold" }}> Pro</Text> : ""}</Text>
            <Text style={s.hdrTag}>{isPro ? "Pro member" : `${Math.max(0, 3 - (analyses || 0))} Free Plans Remaining`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }} accessibilityLabel="Open menu" accessibilityRole="button">
            <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <ScrollView ref={resultsScrollRef} contentContainerStyle={s.scrollContent}>
          <View style={s.resTop}>
            <View style={{ flex: 1 }}>
              <Text style={s.resSpace} numberOfLines={1}>{results.spaceType?.toUpperCase()}</Text>
              <Text style={s.resTitle}>Your Plan</Text>
            </View>
            <TouchableOpacity style={s.shareBtn} accessibilityLabel="Share your plan" accessibilityRole="button" onPress={() => setTimeout(() => {
              Alert.alert(
                "Share Your Plan",
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
          <View style={s.overviewCard}>
            <Text style={s.overviewText}>{results.overview}</Text>
          </View>
          {budget ? (
            <View style={s.budgetBanner}>
              <Text style={s.budgetBannerText}>💰 Based on your ${budget} budget. Best Match highlighted below.</Text>
            </View>
          ) : null}
          {companionActionText && (
            <CompanionCard
              stage={companionStage}
              actionText={companionActionText}
              tipIndex={companionTipIndex}
              onStart={handleCompanionStart}
              onComplete={handleCompanionComplete}
              onSharePhoto={handleCompanionSharePhoto}
              onFinishedForToday={handleCompanionFinishedForToday}
              onUpgrade={handleCompanionUpgradeRequest}
            />
          )}
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
          {/* Full screen visualization modal */}
          <Modal visible={!!vizModal} transparent={true} animationType="fade" onRequestClose={() => setVizModal(null)}>
            <GestureHandlerRootView style={{flex:1}}>
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

          {results.proTip && (
            <View style={s.tipBox}>
              <Text style={{ fontSize: 20 }}>✅</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.tipHead}>PRO TIP</Text>
                <Text style={s.tipBody}>{results.proTip}</Text>
              </View>
            </View>
          )}
          <TouchableOpacity style={s.startOverBtn} onPress={reset}>
            <Text style={s.startOverText}>Analyze a New Space</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // HOME SCREEN
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={[s.hdr, { alignItems: "flex-start" }]}>
        <TouchableOpacity onPress={goHome} style={s.hdrMark} accessibilityLabel="Go to home" accessibilityRole="button">
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
                <Text style={s.freeBadgeText}>{Math.max(0, 3 - (analyses || 0))} Free Plans Remaining</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={() => setShowMenu(true)} style={{ padding: 8 }}>
          <Menu size={22} color="rgba(255,255,255,0.8)" strokeWidth={2.25} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <Text style={s.welcomeText}>Hi, {user.displayName?.split(' ')[0] || "there"}</Text>
        <Text style={s.heroH1}>Turn Clutter{"\n"}Into Calm</Text>
        <Text style={s.heroP}>Take a photo of any space and get personalized recommendations for every budget.{"\n"}Results in seconds.</Text>

        {resumablePlan && (
          <TouchableOpacity style={s.companionResumeBanner} onPress={() => resumeCompanionSession(resumablePlan)}>
            <Sparkles size={18} color={BRAND.green} strokeWidth={2.25} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={s.companionResumeTitle}>Continue Your Session</Text>
              <Text style={s.companionResumeSub} numberOfLines={1}>{resumablePlan.spaceType}</Text>
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

// ── ROOT ─────────────────────────────────────────────────────
function AppRoot() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboard, setShowOnboard] = useState(true);
  const [skipPref, setSkipPref] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [analyses, setAnalyses] = useState(null); // null = not loaded yet

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    // Initialize RevenueCat
    try {
      Purchases.configure({ apiKey: "appl_SIucLbhCtkbSMSuMrhGyxsfWmxx" }); Purchases.configure({ apiKey: Platform.OS === "android" ? "goog_zsRKzNXkxcdeXQLKducjtXXsJhP" : "appl_SIucLbhCtkbSMSuMrhGyxsfWmxx" });

      // Verify entitlement live on launch rather than trusting the local cache alone —
      // catches lapsed/refunded subscriptions and syncs Pro status on a new device.
      Purchases.getCustomerInfo()
        .then(customerInfo => {
          const proActive = !!customerInfo.entitlements.active["Uncluttrd Pro"];
          setIsPro(proActive);
          AsyncStorage.setItem("isPro", proActive ? "true" : "false");
        })
        .catch(e => console.log("RevenueCat getCustomerInfo error:", e.message));

      // Keep Pro status in sync if it changes while the app is open
      // (e.g. a refund processes, or the subscription is restored on another device).
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
    const init = async () => {
      const saved = await AsyncStorage.getItem("skipOnboarding");
      if (saved === "true") setSkipPref(true);
      const pro = await AsyncStorage.getItem("isPro");
      if (pro === "true") setIsPro(true);
      const count = await AsyncStorage.getItem("analysisCount");
      if (count) setAnalyses(parseInt(count) || 0);
    };
    init();

    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setLoading(false);

      // Link RevenueCat's customer record to our Firebase UID so it's identifiable
      // in the RevenueCat dashboard by UID/email/name (needed for manual promo grants),
      // instead of showing up as an anonymous RevenueCat-generated ID.
      // Fires on every auth resolution — cold launch for already-signed-in users,
      // fresh sign-in, and post-signup (handleAuth forces a sign-out/sign-in to get
      // here with displayName already set). logIn() is idempotent, so repeat calls
      // for the same user are safe and just refresh the attributes below.
      if (u) {
        ensureUserDocument(u).catch(e => console.log("Ensure user doc error:", e.message));

        Purchases.logIn(u.uid)
          .then(() => {
            const nameParts = (u.displayName || "").trim().split(" ");
            Purchases.setAttributes({
              "$email": u.email || "",
              "$displayName": u.displayName || "",
              "firstName": nameParts[0] || "",
              "lastName": nameParts.slice(1).join(" "),
            });
          })
          .catch(e => console.log("RevenueCat logIn error:", e.message));
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

  // Not logged in — show auth screen
  if (!user) return <AuthScreen />;

  // Logged in but hasn't dismissed onboarding — show it
  if (showOnboard && !skipPref) {
    return <OnboardingScreen onDone={async (skip) => {
      if (skip) {
        setSkipPref(true);
        await AsyncStorage.setItem("skipOnboarding", "true");
      }
      setShowOnboard(false);
    }} onSkip={() => setShowOnboard(false)} />;
  }

  // Logged in and onboarding done — show main app
  return <MainApp user={user} isPro={isPro} setIsPro={setIsPro} analyses={analyses} setAnalyses={setAnalyses} setSkipPref={setSkipPref} />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
    </SafeAreaProvider>
  );
}


const s = StyleSheet.create({
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
  resSpace: { fontSize: 12, fontFamily: "Inter_700Bold", color: BRAND.green, letterSpacing: 0.8, marginBottom: 3 },
  resTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: BRAND.ink },
  overviewCard: { backgroundColor: BRAND.white, borderWidth: 1, borderColor: BRAND.stone, borderRadius: 14, padding: 16, marginBottom: 16 },
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
  companionTipText: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, textAlign: "center", marginTop: 10 },
  companionResumeBanner: { flexDirection: "row", alignItems: "center", backgroundColor: BRAND.greenLight, borderWidth: 1, borderColor: BRAND.greenMid, borderRadius: 14, padding: 14, marginBottom: 16 },
  companionResumeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: BRAND.ink },
  companionResumeSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.slate, marginTop: 1 },
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
  historyIcon: { width: 40, height: 40, backgroundColor: BRAND.greenLight, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  historySpace: { fontSize: 14, fontFamily: "Inter_700Bold", color: BRAND.ink },
  historyDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: BRAND.mist },
  historyOverview: { fontSize: 13, fontFamily: "Inter_400Regular", color: BRAND.slate, lineHeight: 18 },
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
