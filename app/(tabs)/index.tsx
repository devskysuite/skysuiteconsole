import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "expo-router";
import { auth, db } from "../../firebase";

export default function HomeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();

  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("b.sibbick@skysuite.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [readyToScan, setReadyToScan] = useState(false);
  const readyToScanRef = useRef(false); // ref for synchronous guard
  const [lastCode, setLastCode] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  function triggerScan() {
    readyToScanRef.current = true;
    setReadyToScan(true);
  }

  const onBarcodeScanned = async ({ data }: { data: string }) => {
    if (!readyToScanRef.current) return;
    readyToScanRef.current = false; // synchronous — blocks any rapid repeat fires
    setReadyToScan(false);

    const toolId = (data || "").trim();
    setLastCode(toolId);

    try {
      const ref = doc(db, "tools", toolId);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        Alert.alert("Tool not found", `No tool found for ID: ${toolId}`);
        return;
      }

      router.push(`/tool/${encodeURIComponent(toolId)}`);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to load tool");
    }
  };

  async function doLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Missing info", "Enter email and password.");
      return;
    }
    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e: any) {
      Alert.alert("Login failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
  }

  // ---------------- LOGIN SCREEN ----------------
  if (!user) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <Image
          source={require("../../assets/images/rbt_logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.headingPill}>
          <Text style={styles.headingLoginText}>TOOL TRACKER</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign In</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
          />

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={doLogin}
            disabled={busy}
          >
            <Text style={styles.primaryBtnText}>
              {busy ? "Signing In..." : "Sign In"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ---------------- SCANNER SCREEN ----------------
  if (!permission) {
    return (
      <View style={styles.center}>
        <Text>Loading camera permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={{ marginBottom: 12, textAlign: "center" }}>
          Camera permission is required.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={requestPermission}
        >
          <Text style={styles.primaryBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/images/rbt_logo.png")}
        style={styles.logo}
        resizeMode="contain"
      />

      <View style={styles.headingPillBig}>
        <Text style={styles.headingScanText}>SCAN TOOL</Text>
      </View>

      <View style={styles.cameraSpacer} />

      <View style={styles.scannerBox}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={readyToScan ? onBarcodeScanned : undefined}
          barcodeScannerSettings={{
            barcodeTypes: [
              "qr",
              "code128",
              "code39",
              "ean13",
              "ean8",
              "upc_a",
              "upc_e",
            ],
          }}
        />
      </View>

      <TouchableOpacity
        style={[styles.scanBtn, readyToScan && styles.scanBtnActive]}
        onPress={triggerScan}
        disabled={readyToScan}
      >
        <Text style={styles.scanBtnText}>
          {readyToScan ? "Scanning…" : "SCAN"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.scanLabel}>
        Last scanned: {lastCode ? lastCode : "—"}
      </Text>

      <TouchableOpacity style={styles.logoutPill} onPress={doLogout}>
        <Text style={styles.logoutText}>LOG OUT</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------- STYLES ----------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: "#ffffff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  logo: {
    width: "100%",
    height: 95,
    marginBottom: 6,
  },

  headingPill: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#d6d6d6",
    backgroundColor: "#fafafa",
    marginTop: 10,
    marginBottom: 10,
  },
  headingLoginText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: "#6B6B6B",
  },

  headingPillBig: {
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d6d6d6",
    backgroundColor: "#fafafa",
    marginTop: 10,
    marginBottom: 10,
  },
  headingScanText: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#6B6B6B",
  },

  cameraSpacer: { height: 20 },

  scannerBox: {
    height: 330,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#dddddd",
  },

  scanBtn: {
    marginTop: 20,
    alignSelf: "center",
    backgroundColor: "#003366",
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 14,
  },
  scanBtnActive: {
    backgroundColor: "#6B6B6B",
  },
  scanBtnText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 2,
  },

  scanLabel: {
    marginTop: 14,
    fontSize: 16,
    textAlign: "center",
  },

  logoutPill: {
    marginTop: 25,
    alignSelf: "center",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#003366",
    backgroundColor: "#f5f8fc",
  },
  logoutText: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1.5,
    color: "#003366",
  },

  card: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 14,
    padding: 16,
    marginTop: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: "#003366",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
});