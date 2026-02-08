import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "@/lib/types";

export interface OnChainStatus {
  request_id: number;
  requester: string;
  status: "PENDING" | "EVENT_VERIFIED" | "APPROVED" | "FULFILLED" | "UNKNOWN";
  provider: string;
  cost_usd: number;
}

/**
 * Polls GET /request-status/{requestId} every `intervalMs` milliseconds.
 * Stops polling once status reaches FULFILLED.
 */
export function useRequestStatus(requestId: number | null | undefined, intervalMs = 10_000) {
  const [data, setData] = useState<OnChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (requestId == null) return;
    try {
      const res = await fetch(`${API_BASE}/request-status/${requestId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OnChainStatus = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [requestId]);

  useEffect(() => {
    if (requestId == null) return;

    // Fetch immediately
    fetchStatus();

    const id = setInterval(() => {
      // Stop polling if already fulfilled
      if (data?.status === "FULFILLED") return;
      fetchStatus();
    }, intervalMs);

    return () => clearInterval(id);
  }, [requestId, intervalMs, fetchStatus, data?.status]);

  return { data, error };
}
