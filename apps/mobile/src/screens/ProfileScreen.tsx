import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  AuthErrorResponse,
  MeResponse,
  OtpRequestResponse,
  OtpVerifyResponse,
  RoleSwitchResponse,
  SellerApplication,
  SellerApplicationResponse,
  SellerApplyResponse
} from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const INITIAL_ACCESS_TOKEN = process.env.EXPO_PUBLIC_ACCESS_TOKEN ?? "";
const INITIAL_PHONE = process.env.EXPO_PUBLIC_TEST_PHONE ?? "";

interface ApiError {
  code?: string;
  message: string;
  status: number;
}

function asPlatform(): "ios" | "android" {
  return Platform.OS === "android" ? "android" : "ios";
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let parsed: AuthErrorResponse | undefined;
  try {
    parsed = (await response.json()) as AuthErrorResponse;
  } catch {
    // noop
  }

  throw {
    code: parsed?.code,
    message: parsed?.error ?? `Request failed (${response.status})`,
    status: response.status
  } satisfies ApiError;
}

export function ProfileScreen() {
  const [phone, setPhone] = useState(INITIAL_PHONE);
  const [otpCode, setOtpCode] = useState("");
  const [deviceId] = useState(() => `mobile-${asPlatform()}-${Date.now()}`);
  const [accessToken, setAccessToken] = useState(INITIAL_ACCESS_TOKEN);
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roleDraft, setRoleDraft] = useState<"buyer" | "seller" | "admin">("buyer");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Authenticate to load profile data.");

  const isAuthed = accessToken.trim().length > 0;

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${accessToken}`
    }),
    [accessToken]
  );

  async function loadProfileAndApplication(tokenOverride?: string) {
    const token = tokenOverride ?? accessToken;
    if (!token.trim()) {
      return;
    }

    setBusy(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const meResponse = await fetch(`${API_BASE_URL}/v1/me`, { headers });
      const meBody = await readJson<MeResponse>(meResponse);
      setMe(meBody.user);
      setDisplayName(meBody.user.displayName ?? "");
      if (meBody.user.allowedRoles.includes(meBody.user.activeRole)) {
        setRoleDraft(meBody.user.activeRole);
      }

      const appResponse = await fetch(`${API_BASE_URL}/v1/seller/application`, { headers });
      if (appResponse.ok) {
        const appBody = await readJson<SellerApplicationResponse>(appResponse);
        setApplication(appBody.application);
      } else {
        const appError = (await appResponse.json()) as AuthErrorResponse;
        if (appError.code === "application_not_requested") {
          setApplication({
            status: "not_requested",
            fullName: null,
            shopName: null,
            note: null,
            rejectionReason: null,
            submittedAt: null,
            reviewedAt: null,
            updatedAt: null
          });
        } else {
          throw {
            code: appError.code,
            message: appError.error,
            status: appResponse.status
          } satisfies ApiError;
        }
      }

      setMessage("Profile synced.");
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to load profile state."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadProfileAndApplication();
  }, [accessToken]);

  async function requestOtp() {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
      const body = await readJson<OtpRequestResponse>(response);
      setMessage(`OTP requested. Retry after ${body.retryAfterSec}s.`);
    } catch (error) {
      setMessage(safeErrorMessage(error, "OTP request failed."));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          code: otpCode,
          deviceId,
          platform: asPlatform()
        })
      });
      const body = await readJson<OtpVerifyResponse>(response);
      setAccessToken(body.tokens.accessToken);
      setMessage("Signed in.");
      await loadProfileAndApplication(body.tokens.accessToken);
    } catch (error) {
      setMessage(safeErrorMessage(error, "OTP verification failed."));
    } finally {
      setBusy(false);
    }
  }

  async function saveDisplayName() {
    if (!isAuthed) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/me`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ displayName: displayName.trim() || null })
      });
      const body = await readJson<MeResponse>(response);
      setMe(body.user);
      setDisplayName(body.user.displayName ?? "");
      setMessage("Display name updated.");
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to update display name."));
    } finally {
      setBusy(false);
    }
  }

  async function switchRole() {
    if (!isAuthed) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/me/role-switch`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ role: roleDraft })
      });
      const body = await readJson<RoleSwitchResponse>(response);
      setMe(body.user);
      setMessage(`Active role: ${body.user.activeRole}`);
      await loadProfileAndApplication();
    } catch (error) {
      setMessage(safeErrorMessage(error, "Role switch failed."));
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    if (!isAuthed) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/seller/apply`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fullName,
          shopName,
          note: note.trim() || undefined
        })
      });
      const body = await readJson<SellerApplyResponse>(response);
      setApplication(body.application);
      setMessage(`Application state: ${body.application.status}`);
    } catch (error) {
      setMessage(safeErrorMessage(error, "Seller application submit failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="profile-screen">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        <Text style={styles.help}>
          Use OTP auth to manage display name, active role, and seller application status.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Phone (E.164)</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          style={styles.input}
          autoCapitalize="none"
          placeholder="+15551234567"
          placeholderTextColor="#7d7d7d"
        />
        <Pressable onPress={() => void requestOtp()} style={styles.primaryButton} disabled={busy}>
          <Text style={styles.primaryButtonText}>Request OTP</Text>
        </Pressable>

        <Text style={styles.label}>OTP code</Text>
        <TextInput
          value={otpCode}
          onChangeText={setOtpCode}
          style={styles.input}
          autoCapitalize="none"
          placeholder="123456"
          placeholderTextColor="#7d7d7d"
        />
        <Pressable onPress={() => void verifyOtp()} style={styles.primaryButton} disabled={busy}>
          <Text style={styles.primaryButtonText}>Verify + Sign In</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.input}
          autoCapitalize="words"
          editable={isAuthed}
          placeholder="Antique seller"
          placeholderTextColor="#7d7d7d"
        />
        <Pressable onPress={() => void saveDisplayName()} style={styles.secondaryButton} disabled={!isAuthed || busy}>
          <Text style={styles.secondaryButtonText}>Save display name</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Role switch</Text>
        <View style={styles.roleRow}>
          {(["buyer", "seller", "admin"] as const).map((role) => (
            <Pressable
              key={role}
              onPress={() => setRoleDraft(role)}
              style={[styles.roleButton, roleDraft === role ? styles.roleButtonActive : null]}
              disabled={!isAuthed || busy}
            >
              <Text style={[styles.roleButtonText, roleDraft === role ? styles.roleButtonTextActive : null]}>
                {role}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => void switchRole()} style={styles.secondaryButton} disabled={!isAuthed || busy}>
          <Text style={styles.secondaryButtonText}>Switch active role</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Seller application</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          editable={isAuthed}
          placeholder="Legal full name"
          placeholderTextColor="#7d7d7d"
        />
        <TextInput
          value={shopName}
          onChangeText={setShopName}
          style={styles.input}
          editable={isAuthed}
          placeholder="Shop name"
          placeholderTextColor="#7d7d7d"
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          style={[styles.input, styles.multiline]}
          editable={isAuthed}
          placeholder="Optional note"
          placeholderTextColor="#7d7d7d"
          multiline
          numberOfLines={3}
        />
        <Pressable onPress={() => void submitApplication()} style={styles.secondaryButton} disabled={!isAuthed || busy}>
          <Text style={styles.secondaryButtonText}>Submit seller application</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.statusTitle}>Current state</Text>
        <Text style={styles.statusLine}>User: {me ? `${me.id} (${me.activeRole})` : "not loaded"}</Text>
        <Text style={styles.statusLine}>Allowed roles: {me ? me.allowedRoles.join(", ") : "-"}</Text>
        <Text style={styles.statusLine}>Seller application: {application?.status ?? "not loaded"}</Text>
        <Text style={styles.statusLine}>Message: {message}</Text>
        <Pressable onPress={() => void loadProfileAndApplication()} style={styles.ghostButton} disabled={!isAuthed || busy}>
          <Text style={styles.ghostButtonText}>Refresh profile state</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator color="#f8f8f8" style={styles.spinner} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050505"
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 14
  },
  section: {
    backgroundColor: "#131313",
    borderRadius: 12,
    padding: 14,
    gap: 10
  },
  sectionTitle: {
    color: "#f8f8f8",
    fontSize: 28,
    fontWeight: "700"
  },
  help: {
    color: "#bfbfbf",
    fontSize: 14,
    lineHeight: 20
  },
  label: {
    color: "#dddddd",
    fontSize: 13,
    fontWeight: "600"
  },
  input: {
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    backgroundColor: "#090909",
    color: "#f8f8f8",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top"
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: "#f8f8f8",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#121212",
    fontWeight: "700"
  },
  secondaryButton: {
    borderRadius: 10,
    backgroundColor: "#222222",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#f8f8f8",
    fontWeight: "700"
  },
  roleRow: {
    flexDirection: "row",
    gap: 8
  },
  roleButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2f2f2f",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center"
  },
  roleButtonActive: {
    borderColor: "#f8f8f8",
    backgroundColor: "#f8f8f8"
  },
  roleButtonText: {
    color: "#d4d4d4",
    fontWeight: "600"
  },
  roleButtonTextActive: {
    color: "#111111"
  },
  statusTitle: {
    color: "#f8f8f8",
    fontWeight: "700"
  },
  statusLine: {
    color: "#d3d3d3",
    fontSize: 13
  },
  ghostButton: {
    borderColor: "#2f2f2f",
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  ghostButtonText: {
    color: "#f8f8f8",
    fontWeight: "600"
  },
  spinner: {
    marginVertical: 8
  }
});
