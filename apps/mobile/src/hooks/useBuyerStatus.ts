import { useCallback, useEffect, useMemo, useState } from "react";
import type { BuyerStatusResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface BuyerStatusState {
  basketListingIds: Set<string>;
  offerListingIds: Set<string>;
  loading: boolean;
  error: string | null;
}

export function useBuyerStatus(accessToken?: string) {
  const [state, setState] = useState<BuyerStatusState>({
    basketListingIds: new Set(),
    offerListingIds: new Set(),
    loading: false,
    error: null
  });

  const fetchStatus = useCallback(async () => {
    if (!accessToken) {
      setState({ basketListingIds: new Set(), offerListingIds: new Set(), loading: false, error: null });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch(`${API_BASE_URL}/v1/me/buyer-status`, {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`Failed to load buyer status (${response.status})`);
      }
      const payload = (await response.json()) as BuyerStatusResponse;
      setState({
        basketListingIds: new Set(payload.basketListingIds ?? []),
        offerListingIds: new Set(payload.offerListingIds ?? []),
        loading: false,
        error: null
      });
    } catch (fetchError) {
      setState((current) => ({
        ...current,
        loading: false,
        error: fetchError instanceof Error ? fetchError.message : "Failed to load buyer status"
      }));
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const addBasket = useCallback((listingId: string) => {
    setState((current) => {
      const next = new Set(current.basketListingIds);
      next.add(listingId);
      return { ...current, basketListingIds: next };
    });
  }, []);

  const addOffer = useCallback((listingId: string) => {
    setState((current) => {
      const next = new Set(current.offerListingIds);
      next.add(listingId);
      return { ...current, offerListingIds: next };
    });
  }, []);

  return useMemo(
    () => ({
      basketListingIds: state.basketListingIds,
      offerListingIds: state.offerListingIds,
      loading: state.loading,
      error: state.error,
      refresh: fetchStatus,
      addBasket,
      addOffer
    }),
    [state, fetchStatus, addBasket, addOffer]
  );
}
