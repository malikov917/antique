import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import type {
  AuthErrorResponse,
  MeResponse,
  RoleSwitchResponse,
  SellerApplication,
  SellerApplicationResponse,
  SellerApplyResponse
} from "@antique/types";
import { useAuthSession } from "../auth/session";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface ApiError {
  code?: string;
  message: string;
  status: number;
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
  const { accessToken, user, setUser, signOut, isAuthenticated } = useAuthSession();
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [roleDraft, setRoleDraft] = useState<"buyer" | "seller" | "admin">("buyer");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Manage your account and role.");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${accessToken}`
    }),
    [accessToken]
  );

  const loadProfileAndApplication = useCallback(async () => {
    setBusy(true);
    try {
      const meResponse = await fetch(`${API_BASE_URL}/v1/me`, { headers: authHeaders });
      const meBody = await readJson<MeResponse>(meResponse);
      setUser(meBody.user);
      setDisplayName(meBody.user.displayName ?? "");
      if (meBody.user.allowedRoles.includes(meBody.user.activeRole)) {
        setRoleDraft(meBody.user.activeRole);
      }

      const appResponse = await fetch(`${API_BASE_URL}/v1/seller/application`, { headers: authHeaders });
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
  }, [authHeaders, setUser]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadProfileAndApplication();
    }
  }, [isAuthenticated, loadProfileAndApplication]);

  async function saveDisplayName() {
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
      setUser(body.user);
      setDisplayName(body.user.displayName ?? "");
      setMessage("Display name updated.");
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to update display name."));
    } finally {
      setBusy(false);
    }
  }

  async function switchRole() {
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
      setUser(body.user);
      setMessage(`Active role: ${body.user.activeRole}`);
      await loadProfileAndApplication();
    } catch (error) {
      setMessage(safeErrorMessage(error, "Role switch failed."));
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
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
      setMessage(`Seller application: ${body.application.status}`);
    } catch (error) {
      setMessage(safeErrorMessage(error, "Seller application submit failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!isAuthenticated) {
    return <Redirect href={"/auth" as never} />;
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="profile-screen">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your profile</Text>
        <Text style={styles.help}>Account details and seller access controls.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.statusLine}>Phone: {user?.phone ?? "-"}</Text>
        <Text style={styles.statusLine}>User ID: {user?.id ?? "-"}</Text>
        <Text style={styles.statusLine}>Active role: {user?.activeRole ?? "-"}</Text>
        <Text style={styles.statusLine}>Allowed roles: {user?.allowedRoles.join(", ") ?? "-"}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.input}
          autoCapitalize="words"
          placeholder="Antique seller"
          placeholderTextColor="#7d7d7d"
        />
        <Pressable onPress={() => void saveDisplayName()} style={styles.secondaryButton} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Save display name</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Active role</Text>
        <View style={styles.roleRow}>
          {(["buyer", "seller", "admin"] as const).map((role) => (
            <Pressable
              key={role}
              onPress={() => setRoleDraft(role)}
              style={[styles.roleButton, roleDraft === role ? styles.roleButtonActive : null]}
              disabled={busy}
            >
              <Text style={[styles.roleButtonText, roleDraft === role ? styles.roleButtonTextActive : null]}>{role}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => void switchRole()} style={styles.secondaryButton} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Switch role</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Seller application</Text>
        <Text style={styles.statusLine}>Current status: {application?.status ?? "not loaded"}</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholder="Legal full name"
          placeholderTextColor="#7d7d7d"
        />
        <TextInput
          value={shopName}
          onChangeText={setShopName}
          style={styles.input}
          placeholder="Shop name"
          placeholderTextColor="#7d7d7d"
        />
        <TextInput
          value={note}
          onChangeText={setNote}
          style={[styles.input, styles.multiline]}
          placeholder="Optional note"
          placeholderTextColor="#7d7d7d"
          multiline
          numberOfLines={3}
        />
        <Pressable onPress={() => void submitApplication()} style={styles.secondaryButton} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Submit seller application</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.statusLine}>Message: {message}</Text>
        <Pressable onPress={() => void loadProfileAndApplication()} style={styles.ghostButton} disabled={busy}>
          <Text style={styles.ghostButtonText}>Refresh profile</Text>
        </Pressable>
        <Pressable onPress={signOut} style={styles.signOutButton} disabled={busy}>
          <Text style={styles.signOutButtonText}>Sign out</Text>
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
  signOutButton: {
    backgroundColor: "#3a1f1f",
    borderRadius: 10,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  signOutButtonText: {
    color: "#fbe2e2",
    fontWeight: "700"
  },
  spinner: {
    marginVertical: 8
  }
});
