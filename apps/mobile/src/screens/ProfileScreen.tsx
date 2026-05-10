import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { Redirect } from "expo-router";
import type {
  AuthErrorResponse,
  MeResponse,
  MeStatsResponse,
  RoleSwitchResponse,
  SellerApplication,
  SellerApplicationResponse,
  SellerApplyResponse
} from "@antique/types";
import { useAuthSession } from "../auth/session";
import {
  canAccessRoleGovernance,
  canAccessSellerMutationControls,
  isAllowlistedAdmin
} from "./profileGovernance";

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

function getInitials(name: string | null | undefined, phone: string | undefined): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (phone && phone.length >= 2) {
    return phone.slice(-2).toUpperCase();
  }
  return "?";
}

export function ProfileScreen() {
  const { accessToken, user, setUser, signOut, isAuthenticated } = useAuthSession();
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [paymentInfo, setPaymentInfo] = useState("");
  const [roleDraft, setRoleDraft] = useState<"buyer" | "seller" | "admin">("buyer");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Manage your account and role.");
  const [stats, setStats] = useState<MeStatsResponse | null>(null);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [language] = useState("English");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${accessToken}`
    }),
    [accessToken]
  );
  const showRoleGovernance = canAccessRoleGovernance(user);
  const showSellerMutationControls = canAccessSellerMutationControls(user);

  const loadProfileAndApplication = useCallback(async () => {
    setBusy(true);
    try {
      const meResponse = await fetch(`${API_BASE_URL}/v1/me`, { headers: authHeaders });
      const meBody = await readJson<MeResponse>(meResponse);
      setUser(meBody.user);
      setDisplayName(meBody.user.displayName ?? "");
      setPaymentInfo(meBody.user.paymentInfo ?? "");
      if (meBody.user.allowedRoles.includes(meBody.user.activeRole)) {
        setRoleDraft(meBody.user.activeRole);
      }

      if (isAllowlistedAdmin(meBody.user)) {
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
      } else {
        setApplication(null);
      }

      const statsResponse = await fetch(`${API_BASE_URL}/v1/me/stats`, { headers: authHeaders });
      if (statsResponse.ok) {
        const statsBody = await readJson<MeStatsResponse>(statsResponse);
        setStats(statsBody);
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

  async function savePaymentInfo() {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/me`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ paymentInfo: paymentInfo.trim() || null })
      });
      const body = await readJson<MeResponse>(response);
      setUser(body.user);
      setPaymentInfo(body.user.paymentInfo ?? "");
      setMessage("Payment info updated.");
    } catch (error) {
      setMessage(safeErrorMessage(error, "Failed to update payment info."));
    } finally {
      setBusy(false);
    }
  }

  async function switchRole() {
    if (!showRoleGovernance) {
      setMessage("Role controls are restricted to allowlisted admins.");
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
    if (!showSellerMutationControls) {
      setMessage("Seller application controls are restricted to allowlisted admins.");
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
      setMessage(`Seller application: ${body.application.status}`);
    } catch (error) {
      setMessage(safeErrorMessage(error, "Seller application submit failed."));
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: signOut }
    ]);
  }

  if (!isAuthenticated) {
    return <Redirect href={"/auth" as never} />;
  }

  const initials = getInitials(user?.displayName, user?.phone);
  const isSeller = user?.allowedRoles.includes("seller");

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="profile-screen">
      <View style={styles.avatarSection}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.avatarName}>{user?.displayName || "Your name"}</Text>
        <Text style={styles.avatarPhone}>{user?.phone ?? "-"}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={styles.input}
          autoCapitalize="words"
          placeholder="Your display name"
          placeholderTextColor="#7d7d7d"
        />
        <Pressable onPress={() => void saveDisplayName()} style={styles.secondaryButton} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Save display name</Text>
        </Pressable>
      </View>

      {isSeller ? (
        <View style={styles.section}>
          <Text style={styles.label}>Payment info template</Text>
          <Text style={styles.help}>
            This text is inserted into deal chat with one tap so buyers know how to pay you.
          </Text>
          <TextInput
            value={paymentInfo}
            onChangeText={setPaymentInfo}
            style={[styles.input, styles.multiline]}
            placeholder="e.g. PayPal: seller@example.com / Venmo: @seller"
            placeholderTextColor="#7d7d7d"
            multiline
            numberOfLines={3}
          />
          <Pressable onPress={() => void savePaymentInfo()} style={styles.secondaryButton} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Save payment info</Text>
          </Pressable>
        </View>
      ) : null}

      {stats ? (
        <View style={styles.section}>
          <Text style={styles.label}>Stats</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats.buyerStats.offersMade}</Text>
              <Text style={styles.statLabel}>Offers made</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats.buyerStats.dealsWon}</Text>
              <Text style={styles.statLabel}>Deals won</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{stats.buyerStats.itemsInBasket}</Text>
              <Text style={styles.statLabel}>In basket</Text>
            </View>
            {isSeller ? (
              <>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.sellerStats.listingsCreated}</Text>
                  <Text style={styles.statLabel}>Listings</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.sellerStats.listingsSold}</Text>
                  <Text style={styles.statLabel}>Sold</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.sellerStats.sessionsHeld}</Text>
                  <Text style={styles.statLabel}>Sessions</Text>
                </View>
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>Settings</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Push notifications</Text>
          <Switch value={pushEnabled} onValueChange={setPushEnabled} />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Language</Text>
          <Text style={styles.settingValue}>{language}</Text>
        </View>
        <Pressable onPress={confirmSignOut} style={styles.signOutButton} disabled={busy}>
          <Text style={styles.signOutButtonText}>Log out</Text>
        </Pressable>
      </View>

      {showRoleGovernance ? (
        <View style={styles.section}>
          <Text style={[styles.label, { color: "#e8a33c" }]}>Admin</Text>
          <Text style={styles.help}>Role governance controls are restricted to allowlisted admins.</Text>
          <View style={styles.roleRow}>
            {(["buyer", "seller", "admin"] as const).map((role) => (
              <Pressable
                key={role}
                onPress={() => setRoleDraft(role)}
                style={[styles.roleButton, roleDraft === role ? styles.roleButtonActive : null]}
                disabled={busy}
              >
                <Text style={[styles.roleButtonText, roleDraft === role ? styles.roleButtonTextActive : null]}>
                  {role}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={() => void switchRole()} style={styles.secondaryButton} disabled={busy}>
            <Text style={styles.secondaryButtonText}>Switch role</Text>
          </Pressable>
        </View>
      ) : null}

      {showSellerMutationControls ? (
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
      ) : null}

      <View style={styles.section}>
        <Text style={styles.statusLine}>Message: {message}</Text>
        <Pressable onPress={() => void loadProfileAndApplication()} style={styles.ghostButton} disabled={busy}>
          <Text style={styles.ghostButtonText}>Refresh profile</Text>
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
  avatarSection: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 16
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#f8f8f8",
    fontSize: 28,
    fontWeight: "700"
  },
  avatarName: {
    color: "#f8f8f8",
    fontSize: 18,
    fontWeight: "600"
  },
  avatarPhone: {
    color: "#a0a0a0",
    fontSize: 14
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
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  statCell: {
    flex: 1,
    minWidth: "30%",
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 12,
    alignItems: "center"
  },
  statValue: {
    color: "#f8f8f8",
    fontSize: 20,
    fontWeight: "700"
  },
  statLabel: {
    color: "#a0a0a0",
    fontSize: 12,
    marginTop: 4
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40
  },
  settingLabel: {
    color: "#d3d3d3",
    fontSize: 14
  },
  settingValue: {
    color: "#a0a0a0",
    fontSize: 14
  }
});
