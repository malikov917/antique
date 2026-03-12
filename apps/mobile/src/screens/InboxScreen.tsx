import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Deal } from "@antique/types";
import { useInboxTimeline } from "../hooks/useInboxTimeline";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const DEV_ACCESS_TOKEN = process.env.EXPO_PUBLIC_ACCESS_TOKEN;

function formatDealStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function canRequestCorrection(deal: Deal | null, perspective: "buyer" | "seller"): boolean {
  if (!deal || perspective !== "buyer") {
    return false;
  }
  return deal.status === "open" || deal.status === "paid";
}

function canResolveCorrection(deal: Deal | null, perspective: "buyer" | "seller"): boolean {
  if (!deal || perspective !== "seller") {
    return false;
  }
  return deal.addressCorrection?.latestStatus === "pending";
}

export function InboxScreen() {
  const { items, loading, error, refresh } = useInboxTimeline();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDealActions, setPendingDealActions] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, { shippingAddress: string; reason: string }>>({});

  const setPending = (dealId: string, value: boolean) => {
    setPendingDealActions((current) => ({ ...current, [dealId]: value }));
  };

  const handleCorrectionRequest = async (dealId: string) => {
    const token = DEV_ACCESS_TOKEN;
    if (!token) {
      setActionError("Set EXPO_PUBLIC_ACCESS_TOKEN to submit correction requests.");
      return;
    }

    const form = forms[dealId] ?? { shippingAddress: "", reason: "" };
    const shippingAddress = form.shippingAddress.trim();
    const reason = form.reason.trim();
    if (!shippingAddress || !reason) {
      setActionError("Address and reason are required.");
      return;
    }

    setActionError(null);
    setPending(dealId, true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/deals/${dealId}/address-corrections`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ shippingAddress, reason })
      });
      if (!response.ok) {
        throw new Error(`Correction request failed: ${response.status}`);
      }
      setForms((current) => ({ ...current, [dealId]: { shippingAddress: "", reason: "" } }));
      refresh();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Correction request failed");
    } finally {
      setPending(dealId, false);
    }
  };

  const handleCorrectionResolve = async (
    dealId: string,
    correctionId: string,
    decision: "approve" | "reject"
  ) => {
    const token = DEV_ACCESS_TOKEN;
    if (!token) {
      setActionError("Set EXPO_PUBLIC_ACCESS_TOKEN to resolve correction requests.");
      return;
    }

    setActionError(null);
    setPending(dealId, true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/v1/deals/${dealId}/address-corrections/${correctionId}/${decision}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      );
      if (!response.ok) {
        throw new Error(`Correction ${decision} failed: ${response.status}`);
      }
      refresh();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Correction update failed");
    } finally {
      setPending(dealId, false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.metaText}>Loading inbox...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="inbox-screen">
      <Text style={styles.heading}>Inbox</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {items.length === 0 ? (
        <Text style={styles.metaText}>No active deal chats yet.</Text>
      ) : (
        items.map((item) => {
          const dealId = item.deal?.id;
          const pending = dealId ? pendingDealActions[dealId] === true : false;
          const form = dealId ? forms[dealId] ?? { shippingAddress: "", reason: "" } : { shippingAddress: "", reason: "" };
          const correction = item.deal?.addressCorrection;

          return (
            <View key={item.chat.id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.cardTitle}>Listing {item.chat.listingId}</Text>
                <Text style={styles.badge}>{item.perspective === "seller" ? "Selling" : "Buying"}</Text>
              </View>
              <Text style={styles.cardSubtitle}>Deal status: {formatDealStatus(item.deal?.status ?? "open")}</Text>
              {item.deal ? (
                <Text style={styles.cardSubtitle}>Active address: {item.deal.activeShippingAddress}</Text>
              ) : null}
              {correction ? (
                <Text style={styles.cardSubtitle}>
                  Correction: {formatDealStatus(correction.latestStatus)} ({correction.pendingCount} pending)
                </Text>
              ) : null}
              <Text style={styles.messagePreview} numberOfLines={2}>
                {item.latestMessage?.text ?? "No messages yet. Start the conversation in this chat."}
              </Text>
              <Text style={styles.cardMeta}>
                {new Date(item.updatedAt).toLocaleString()} · Chat {item.chat.id}
              </Text>

              {dealId && canRequestCorrection(item.deal, item.perspective) ? (
                <View style={styles.actionBlock}>
                  <TextInput
                    style={styles.input}
                    placeholder="New shipping address"
                    placeholderTextColor="#777"
                    value={form.shippingAddress}
                    onChangeText={(value) =>
                      setForms((current) => ({
                        ...current,
                        [dealId]: {
                          shippingAddress: value,
                          reason: form.reason
                        }
                      }))
                    }
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Reason for correction"
                    placeholderTextColor="#777"
                    value={form.reason}
                    onChangeText={(value) =>
                      setForms((current) => ({
                        ...current,
                        [dealId]: {
                          shippingAddress: form.shippingAddress,
                          reason: value
                        }
                      }))
                    }
                  />
                  <Pressable
                    style={[styles.actionButton, pending ? styles.actionButtonDisabled : null]}
                    disabled={pending}
                    onPress={() => handleCorrectionRequest(dealId)}
                  >
                    <Text style={styles.actionButtonText}>
                      {pending ? "Submitting..." : "Request address correction"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {dealId && correction && canResolveCorrection(item.deal, item.perspective) ? (
                <View style={styles.row}>
                  <Pressable
                    style={[styles.secondaryButton, pending ? styles.actionButtonDisabled : null]}
                    disabled={pending}
                    onPress={() =>
                      handleCorrectionResolve(dealId, correction.latestCorrectionId, "approve")
                    }
                  >
                    <Text style={styles.actionButtonText}>Approve</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.secondaryButton, pending ? styles.actionButtonDisabled : null]}
                    disabled={pending}
                    onPress={() => handleCorrectionResolve(dealId, correction.latestCorrectionId, "reject")}
                  >
                    <Text style={styles.actionButtonText}>Reject</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070707"
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 10
  },
  centered: {
    flex: 1,
    backgroundColor: "#070707",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  heading: {
    color: "#f5f5f5",
    fontSize: 22,
    fontWeight: "700"
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  card: {
    backgroundColor: "#161616",
    borderRadius: 14,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: "#242424"
  },
  cardTitle: {
    color: "#f2f2f2",
    fontSize: 15,
    fontWeight: "600"
  },
  cardSubtitle: {
    color: "#bbbbbb",
    fontSize: 13
  },
  messagePreview: {
    color: "#dddddd",
    lineHeight: 20,
    fontSize: 14
  },
  cardMeta: {
    color: "#969696",
    fontSize: 12
  },
  badge: {
    color: "#f0f0f0",
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: "#2a2a2a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999
  },
  metaText: {
    color: "#b8b8b8"
  },
  errorText: {
    color: "#ff9789"
  },
  actionBlock: {
    gap: 8,
    marginTop: 6
  },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#f5f5f5",
    backgroundColor: "#111"
  },
  actionButton: {
    backgroundColor: "#2f5d2f",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12
  },
  secondaryButton: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 100,
    alignItems: "center"
  },
  actionButtonText: {
    color: "#f5f5f5",
    fontWeight: "600",
    fontSize: 13
  },
  actionButtonDisabled: {
    opacity: 0.6
  }
});
