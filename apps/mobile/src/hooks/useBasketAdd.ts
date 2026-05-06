import { useCallback, useState } from "react";
import type { CreateBasketResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface BasketAddState {
  loading: boolean;
  error: string | null;
  success: boolean;
}

export function useBasketAdd({
  accessToken,
  listingId,
  onSuccess
}: {
  accessToken?: string;
  listingId: string;
  onSuccess?: () => void;
}) {
  const [state, setState] = useState<BasketAddState>({
    loading: false,
    error: null,
    success: false
  });

  const add = useCallback(async () => {
    if (!accessToken) {
      setState({ loading: false, error: "Sign in to add to basket", success: false });
      return;
    }
    setState({ loading: true, error: null, success: false });
    try {
      const response = await fetch(`${API_BASE_URL}/v1/listings/${listingId}/basket`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorPayload.error ?? `Basket add failed (${response.status})`);
      }
      const payload = (await response.json()) as CreateBasketResponse;
      if (payload.basketItem) {
        setState({ loading: false, error: null, success: true });
        onSuccess?.();
      } else {
        throw new Error("Basket add returned no item");
      }
    } catch (addError) {
      setState({
        loading: false,
        error: addError instanceof Error ? addError.message : "Basket add failed",
        success: false
      });
    }
  }, [accessToken, listingId, onSuccess]);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, success: false });
  }, []);

  return {
    ...state,
    add,
    reset
  };
}
