import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Deal } from "@antique/types";
import { useAuthSession } from "../auth/session";
import { useInboxTimeline } from "../hooks/useInboxTimeline";
import { formatRelativeTime } from "./activityHelpers";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function getCounterpartyName(item: { perspective: "buyer" | "seller"; chat: { sellerDisplayName: string; buyerDisplayName: string } }): string {
  if (item.perspective === "buyer") {
    return item.chat.sellerDisplayName || "Seller";
  }
  return item.chat.buyerDisplayName || "Buyer";
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function getDealStatusColor(status: string): string {
  switch (status) {
    case "open":
      return "#4a9a4a";
    case "paid":
      return "#3a7aca";
    case "shipped":
      return "#c4a23a";
    case "delivered":
      return "#8a8a8a";
    case "completed":
      return "#4a9a4a";
    case "payment_overdue":
      return "#ca4a3a";
    case "cancellation_requested":
      return "#ca7a3a";
    case "refunded":
      return "#8a8a8a";
    case "cancelled":
      return "#8a8a8a";
    default:
      return "#8a8a8a";
  }
}

function formatDealStatusLabel(status: string): string {
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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accessToken, user } = useAuthSession();
  const { items, loading, error, refresh } = useInboxTimeline(accessToken);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDealActions, setPendingDealActions] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, { shippingAddress: string; reason: string }>>({});
  const [expandedCorrections, setExpandedCorrections] = useState<Record<string, boolean>>({});

  const setPending = (dealId: string, value: boolean) => {
    setPendingDealActions((current) => ({ ...current, [dealId]: value }));
  };

  const toggleCorrection = (dealId: string) => {
    setExpandedCorrections((current) => ({ ...current, [dealId]: !current[dealId] }));
  };

  const handleCorrectionRequest = async (dealId: string) => {
    const token = accessToken;
    if (!token) {
      setActionError("Sign in first to submit correction requests.");
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
      setExpandedCorrections((current) => ({ ...current, [dealId]: false }));
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
    const token = accessToken;
    if (!token) {
      setActionError("Sign in first to resolve correction requests.");
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
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]} testID="inbox-screen">
      <Text style={styles.heading}>Inbox</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubbles-outline" size={48} color="#555" />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySubtitle}>Your deal chats will appear here.</Text>
        </View>
      ) : (
        items.map((item) => {
          const dealId = item.deal?.id;
          const pending = dealId ? pendingDealActions[dealId] === true : false;
          const form = dealId ? forms[dealId] ?? { shippingAddress: "", reason: "" } : { shippingAddress: "", reason: "" };
          const correction = item.deal?.addressCorrection;
          const counterpartyName = getCounterpartyName(item);
          const listingTitle = item.chat.listingTitle || "Untitled listing";
          const isUnread = item.latestMessage ? item.latestMessage.senderUserId !== user?.id : false;
          const dealStatus = item.deal?.status ?? "open";
          const expanded = dealId ? expandedCorrections[dealId] === true : false;

          return (
            <Pressable
              key={item.chat.id}
              style={styles.card}
              onPress={() => router.push(`/chat/${item.chat.id}` )}
              testID={`inbox-item-${item.chat.id}`}
            >
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(counterpartyName)}</Text>
                </View>
                <View style={styles.cardHeaderText}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {listingTitle}
                    </Text>
                    {isUnread ? <View style={styles.unreadDot} /> : null}
                  </View>
                  <Text style={styles.cardSubtitle}>{counterpartyName}</Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.perspective === "seller" ? "Selling" : "Buying"}</Text>
                </View>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.messagePreview} numberOfLines={2}>
                  {item.latestMessage?.text ?? "No messages yet. Start the conversation in this chat."}
                </Text>
              </View>

              <View style={styles.cardFooter}>
                <View style={[styles.statusBadge, { backgroundColor: `${getDealStatusColor(dealStatus)}22` }]}>
                  <View style={[styles.statusDot, { backgroundColor: getDealStatusColor(dealStatus) }]} />
                  <Text style={[styles.statusText, { color: getDealStatusColor(dealStatus) }]}>
                    {formatDealStatusLabel(dealStatus)}
                  </Text>
                </View>
                <Text style={styles.timestamp}>{formatRelativeTime(item.updatedAt)}</Text>
              </View>

              {dealId && canRequestCorrection(item.deal, item.perspective) ? (
                <View style={styles.actionRow}>
                  <Pressable onPress={() => toggleCorrection(dealId)}>
                    <Text style={styles.actionLink}>{expanded ? "Cancel" : "Request address change"}</Text>
                  </Pressable>
                </View>
              ) : null}

              {dealId && expanded && canRequestCorrection(item.deal, item.perspective) ? (
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
                      {pending ? "Submitting..." : "Submit correction request"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {dealId && correction && canResolveCorrection(item.deal, item.perspective) ? (
                <View style={styles.resolveRow}>
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
                    onPress={() =>
                      handleCorrectionResolve(dealId, correction.latestCorrectionId, "reject")
                    }
                  >
                    <Text style={styles.actionButtonText}>Reject</Text>
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
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
    gap: 12
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
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 80,
    gap: 12
  },
  emptyTitle: {
    color: "#b8b8b8",
    fontSize: 16,
    fontWeight: "600"
  },
  emptySubtitle: {
    color: "#777",
    fontSize: 14
  },
  card: {
    backgroundColor: "#161616",
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#242424"
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    color: "#f5f5f5",
    fontSize: 14,
    fontWeight: "700"
  },
  cardHeaderText: {
    flex: 1,
    gap: 2
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  cardTitle: {
    color: "#f2f2f2",
    fontSize: 15,
    fontWeight: "600",
    flexShrink: 1
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4a9a4a",
    marginTop: 2
  },
  cardSubtitle: {
    color: "#999",
    fontSize: 13
  },
  previewRow: {
    marginLeft: 52
  },
  messagePreview: {
    color: "#cccccc",
    lineHeight: 20,
    fontSize: 14
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginLeft: 52
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize"
  },
  timestamp: {
    color: "#969696",
    fontSize: 12
  },
  badge: {
    backgroundColor: "#2a2a2a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999
  },
  badgeText: {
    color: "#f0f0f0",
    fontSize: 12,
    fontWeight: "700"
  },
  metaText: {
    color: "#b8b8b8"
  },
  errorText: {
    color: "#ff9789"
  },
  actionRow: {
    marginLeft: 52,
    marginTop: 2
  },
  actionLink: {
    color: "#7aab7a",
    fontSize: 13,
    fontWeight: "600"
  },
  actionBlock: {
    gap: 8,
    marginLeft: 52,
    marginTop: 4
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
  },
  resolveRow: {
    flexDirection: "row",
    gap: 10,
    marginLeft: 52,
    marginTop: 4
  }
});
