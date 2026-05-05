import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatMessage } from "@antique/types";
import { useAuthSession } from "../auth/session";
import { useChatDetail } from "../hooks/useChatDetail";

function formatDealStatus(status: string): string {
  return status.replaceAll("_", " ");
}

interface ChatDetailScreenProps {
  chatId: string;
}

export function ChatDetailScreen({ chatId }: ChatDetailScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accessToken, user } = useAuthSession();
  const { chat, deal, messages, perspective, loading, error, sendMessage, sending } = useChatDetail(
    chatId,
    accessToken
  );
  const [messageDraft, setMessageDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSend = async () => {
    setSendError(null);
    const ok = await sendMessage(messageDraft);
    if (ok) {
      setMessageDraft("");
    } else {
      setSendError("Failed to send message.");
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.metaText}>Loading chat...</Text>
      </View>
    );
  }

  if (!chat) {
    return (
      <View style={styles.centered}>
        <Text style={styles.metaText}>Chat not found.</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Back to Inbox</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.heading}>Listing {chat.listingId}</Text>
          {perspective ? (
            <Text style={styles.badge}>{perspective === "seller" ? "Selling" : "Buying"}</Text>
          ) : null}
        </View>
        <View style={styles.backButtonPlaceholder} />
      </View>

      {deal ? (
        <View style={styles.dealBar}>
          <Text style={styles.dealBarText}>Deal status: {formatDealStatus(deal.status)}</Text>
          {deal.activeShippingAddress ? (
            <Text style={styles.dealBarSubtext}>Ship to: {deal.activeShippingAddress}</Text>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}

      <ScrollView
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        testID="chat-message-list"
      >
        {messages.length === 0 ? (
          <Text style={styles.metaText}>No messages yet. Start the conversation.</Text>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </ScrollView>

      <View style={styles.composer}>
        {perspective === "seller" && user?.paymentInfo ? (
          <Pressable
            style={[styles.templateButton, sending ? styles.sendButtonDisabled : null]}
            onPress={() => setMessageDraft(user.paymentInfo!)}
            disabled={sending}
          >
            <Text style={styles.templateButtonText}>💳 Insert payment info</Text>
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor="#777"
          value={messageDraft}
          onChangeText={setMessageDraft}
          multiline
        />
        <Pressable
          style={[styles.sendButton, sending ? styles.sendButtonDisabled : null]}
          onPress={handleSend}
          disabled={sending}
          testID="chat-send-button"
        >
          <Text style={styles.sendButtonText}>{sending ? "Sending..." : "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <View style={styles.messageBubble}>
      <Text style={styles.messageText}>{message.text}</Text>
      <Text style={styles.messageMeta}>{new Date(message.createdAt).toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070707"
  },
  centered: {
    flex: 1,
    backgroundColor: "#070707",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#242424"
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  heading: {
    color: "#f5f5f5",
    fontSize: 18,
    fontWeight: "700"
  },
  backButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  backButtonText: {
    color: "#f2f2f2",
    fontWeight: "700",
    fontSize: 12
  },
  backButtonPlaceholder: {
    width: 70
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
  dealBar: {
    backgroundColor: "#161616",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#242424",
    gap: 4
  },
  dealBarText: {
    color: "#f2f2f2",
    fontSize: 14,
    fontWeight: "600"
  },
  dealBarSubtext: {
    color: "#bbbbbb",
    fontSize: 13
  },
  messageList: {
    flex: 1
  },
  messageListContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10
  },
  messageBubble: {
    backgroundColor: "#212121",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6
  },
  messageText: {
    color: "#f5f5f5",
    fontSize: 14,
    lineHeight: 20
  },
  messageMeta: {
    color: "#969696",
    fontSize: 11
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#242424"
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#f5f5f5",
    backgroundColor: "#111",
    maxHeight: 100
  },
  sendButton: {
    backgroundColor: "#2f5d2f",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16
  },
  sendButtonDisabled: {
    opacity: 0.6
  },
  sendButtonText: {
    color: "#f5f5f5",
    fontWeight: "700",
    fontSize: 13
  },
  templateButton: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: "flex-start"
  },
  templateButtonText: {
    color: "#f5f5f5",
    fontWeight: "600",
    fontSize: 13
  },
  metaText: {
    color: "#b8b8b8",
    textAlign: "center",
    marginTop: 20
  },
  errorText: {
    color: "#ff9789",
    paddingHorizontal: 16,
    paddingTop: 8
  }
});
