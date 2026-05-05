import { useCallback, useState } from "react";
import type { BasketItem, CreateBasketResponse, CreateOfferRequest, CreateOfferResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface OfferSubmitState {
  loading: boolean;
  error: string | null;
  basketItem: BasketItem | null;
  offer: CreateOfferResponse["offer"] | null;
}

export function useOfferSubmit({
  accessToken,
  listingId
}: {
  accessToken?: string;
  listingId: string;
}) {
  const [state, setState] = useState<OfferSubmitState>({
    loading: false,
    error: null,
    basketItem: null,
    offer: null
  });

  const submit = useCallback(
    async (params: CreateOfferRequest) => {
      if (!accessToken) {
        setState((current) => ({ ...current, error: "Sign in to submit an offer" }));
        return;
      }

      setState({ loading: true, error: null, basketItem: null, offer: null });

      try {
        // Step 1: add to basket
        const basketResponse = await fetch(`${API_BASE_URL}/v1/listings/${listingId}/basket`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        });

        let basketItem: BasketItem | null = null;
        if (basketResponse.ok) {
          const basketPayload = (await basketResponse.json()) as CreateBasketResponse;
          basketItem = basketPayload.basketItem ?? null;
        }
        // Non-fatal: if basket fails, still attempt offer

        // Step 2: submit offer
        const offerResponse = await fetch(`${API_BASE_URL}/v1/listings/${listingId}/offers`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(params)
        });

        if (!offerResponse.ok) {
          const errorPayload = (await offerResponse.json().catch(() => ({}))) as { error?: string };
          throw new Error(errorPayload.error ?? `Offer failed (${offerResponse.status})`);
        }

        const offerPayload = (await offerResponse.json()) as CreateOfferResponse;
        setState({
          loading: false,
          error: null,
          basketItem,
          offer: offerPayload.offer
        });
      } catch (submitError) {
        setState({
          loading: false,
          error: submitError instanceof Error ? submitError.message : "Offer submission failed",
          basketItem: null,
          offer: null
        });
      }
    },
    [accessToken, listingId]
  );

  const reset = useCallback(() => {
    setState({ loading: false, error: null, basketItem: null, offer: null });
  }, []);

  return {
    ...state,
    submit,
    reset
  };
}
