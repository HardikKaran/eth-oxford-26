// Shared types between frontend and backend

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Disaster {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  distance_km?: number;
}

export interface NearbyResponse {
  safe: boolean;
  disaster?: Disaster;
  distance_km?: number;
  location_name?: string;
}

export interface EvaluationResult {
  status: "PROCESSED" | "DECLINED";
  reason?: string;
  distance_km?: number;
  debate?: string[];
  final_verdict?: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
}
