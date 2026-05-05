import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { useOfferSubmit } from "../hooks/useOfferSubmit";

function formatPrice(cents: number | undefined, currency: string | undefined): string {
  if (typeof cents !== "number" || !currency) {
    return "";
  }
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

export function OfferFlow({
  item,
  accessToken,
  onDone
}: {
  item: ReelPlayableItem;
  accessToken?: string;
  onDone: () => void;
}) {
  const { loading, error, offer, submit, reset } = useOfferSubmit({ accessToken, listingId: item.listingId ?? "" });
  const [amountText, setAmountText] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");

  const listedPriceCents = item.listedPriceCents ?? 0;
  const currency = item.currency ?? "USD";

  const handleSubmit = () => {
    const amountCents = Math.round(parseFloat(amountText) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return;
    }
    if (!shippingAddress.trim()) {
      return;
    }
    void submit({ amountCents, shippingAddress: shippingAddress.trim() });
  };

  if (offer) {
    return (
      <View style={styles.container} testID="offer-flow-success">
        <Text style={styles.title}>Offer submitted</Text>
        <Text style={styles.status}>
          {formatPrice(offer.amountCents, currency)} — {offer.shippingAddress}
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            reset();
            setAmountText("");
            setShippingAddress("");
            onDone();
          }}
        >
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="offer-flow">
      <Text style={styles.title}>Make an offer</Text>
      <Text style={styles.listedPrice}>Listed price: {formatPrice(listedPriceCents, currency)}</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <TextInput
        style={styles.input}
        placeholder="Offer amount"
        placeholderTextColor="#777"
        keyboardType="decimal-pad"
        value={amountText}
        onChangeText={setAmountText}
        testID="offer-amount-input"
      />
      <TextInput
        style={styles.input}
        placeholder="Shipping address"
        placeholderTextColor="#777"
        value={shippingAddress}
        onChangeText={setShippingAddress}
        testID="offer-address-input"
      />
      <Pressable
        style={[
          styles.button,
          (!amountText.trim() || !shippingAddress.trim() || loading) && styles.buttonDisabled
        ]}
        disabled={!amountText.trim() || !shippingAddress.trim() || loading}
        onPress={handleSubmit}
        testID="offer-submit-button"
      >
        {loading ? <ActivityIndicator color="#111111" /> : <Text style={styles.buttonText}>Submit offer</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 14
  },
  title: {
    color: "#f8f8f8",
    fontSize: 20,
    fontWeight: "700"
  },
  listedPrice: {
    color: "#d8d8d8",
    fontSize: 14
  },
  status: {
    color: "#d8d8d8",
    fontSize: 14
  },
  errorText: {
    color: "#ff9789",
    fontSize: 13
  },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: "#f5f5f5",
    backgroundColor: "#111"
  },
  button: {
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44
  },
  buttonDisabled: {
    opacity: 0.5
  },
  buttonText: {
    color: "#111111",
    fontWeight: "700"
  }
});
