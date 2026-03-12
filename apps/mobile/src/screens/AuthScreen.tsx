import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuthSession } from "../auth/session";

const INITIAL_PHONE = process.env.EXPO_PUBLIC_TEST_PHONE ?? "";

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function AuthScreen() {
  const { hasAccessToken, isAuthenticated, loadingUser, requestOtp, verifyOtp } = useAuthSession();
  const [phone, setPhone] = useState(INITIAL_PHONE);
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Sign in or register with your phone number.");

  if (hasAccessToken && loadingUser) {
    return null;
  }

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/feed" />;
  }

  async function handleRequestOtp() {
    setBusy(true);
    try {
      const result = await requestOtp(phone.trim());
      setMessage(`Code sent. Retry after ${result.retryAfterSec}s.`);
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to request OTP."));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setBusy(true);
    try {
      await verifyOtp({
        phone: phone.trim(),
        code: otpCode.trim()
      });
      setMessage("Signed in successfully.");
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to verify OTP."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="auth-screen">
      <View style={styles.hero}>
        <Text style={styles.title}>Antique</Text>
        <Text style={styles.subtitle}>Sign in to enter feed, inbox, activity, and profile.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Phone number (E.164)</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="phone-pad"
          placeholder="+4915123400011"
          placeholderTextColor="#7a7a7a"
        />
        <Pressable onPress={() => void handleRequestOtp()} style={styles.primaryButton} disabled={busy || loadingUser}>
          <Text style={styles.primaryButtonText}>Send code</Text>
        </Pressable>

        <Text style={styles.label}>One-time code</Text>
        <TextInput
          value={otpCode}
          onChangeText={setOtpCode}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="number-pad"
          placeholder="123456"
          placeholderTextColor="#7a7a7a"
        />
        <Pressable onPress={() => void handleVerifyOtp()} style={styles.secondaryButton} disabled={busy || loadingUser}>
          <Text style={styles.secondaryButtonText}>Continue</Text>
        </Pressable>
      </View>

      <View style={styles.hintBox}>
        <Text style={styles.hintTitle}>Local beta note</Text>
        <Text style={styles.hintText}>OTP is logged by the local API server (`OTP issued`) for quick test access.</Text>
      </View>

      {busy || loadingUser ? <ActivityIndicator color="#f2f2f2" style={styles.spinner} /> : null}
      <Text style={styles.message}>{message}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#060606"
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 48,
    paddingBottom: 32,
    gap: 16
  },
  hero: {
    gap: 6
  },
  title: {
    color: "#f4f4f4",
    fontSize: 34,
    fontWeight: "800"
  },
  subtitle: {
    color: "#bdbdbd",
    fontSize: 15,
    lineHeight: 22
  },
  card: {
    backgroundColor: "#151515",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#232323",
    padding: 14,
    gap: 10
  },
  label: {
    color: "#dddddd",
    fontSize: 13,
    fontWeight: "600"
  },
  input: {
    borderWidth: 1,
    borderColor: "#2f2f2f",
    borderRadius: 10,
    backgroundColor: "#0d0d0d",
    color: "#f7f7f7",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  primaryButton: {
    backgroundColor: "#f4f4f4",
    borderRadius: 10,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#121212",
    fontWeight: "700"
  },
  secondaryButton: {
    backgroundColor: "#2a2a2a",
    borderRadius: 10,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#f1f1f1",
    fontWeight: "700"
  },
  hintBox: {
    backgroundColor: "#111111",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#242424",
    gap: 4
  },
  hintTitle: {
    color: "#ededed",
    fontWeight: "700"
  },
  hintText: {
    color: "#bcbcbc",
    lineHeight: 19,
    fontSize: 13
  },
  message: {
    color: "#c8c8c8",
    fontSize: 13
  },
  spinner: {
    marginTop: 2
  }
});
