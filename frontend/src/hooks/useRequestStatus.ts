import { useState, useEffect, useCallback, useRef } from "react";
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
 *
 * Uses a ref for the "fulfilled" check so the polling interval is only
 * created once per requestId (no stale closure / interval churn).
 */
export function useRequestStatus(requestId: number | null | undefined, intervalMs = 5_000) {
  const [data, setData] = useState<OnChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fulfilledRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (requestId == null) return;
    try {
      const res = await fetch(`${API_BASE}/request-status/${requestId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OnChainStatus = await res.json();
      setData(json);
      setError(null);
      if (json.status === "FULFILLED") {
        fulfilledRef.current = true;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [requestId]);

  useEffect(() => {
    if (requestId == null) return;

    fulfilledRef.current = false;

    // Fetch immediately
    fetchStatus();

    const id = setInterval(() => {
      if (fulfilledRef.current) return;
      fetchStatus();
    }, intervalMs);

    return () => clearInterval(id);
  }, [requestId, intervalMs, fetchStatus]);

  return { data, error };
}
