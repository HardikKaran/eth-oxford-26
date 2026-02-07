"use client";

import { GoogleMap, useJsApiLoader, MarkerF, CircleF } from "@react-google-maps/api";
import { useMemo } from "react";

// Silver/desaturated map style — matches minimal aesthetic
const MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
  { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
];

interface GoogleMapComponentProps {
  userLocation: { lat: number; lng: number };
  disasterZone?: { lat: number; lng: number; radius: number };
  className?: string;
}

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "YOUR_API_KEY_HERE";

export default function GoogleMapComponent({
  userLocation,
  disasterZone,
  className = "",
}: GoogleMapComponentProps) {
  const { isLoaded } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  });

  const mapOptions = useMemo(
    () => ({
      styles: MAP_STYLES,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    }),
    []
  );

  if (!isLoaded) {
    return (
      <div className={`flex items-center justify-center bg-surface rounded-3xl ${className}`}>
        <div className="flex items-center gap-2 text-sm text-muted">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Loading map...
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-3xl overflow-hidden shadow-lg shadow-slate-200/50 ${className}`}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={userLocation}
        zoom={13}
        options={mapOptions}
      >
        {/* User location — blue dot */}
        <MarkerF
          position={userLocation}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#2563eb",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
            scale: 8,
          }}
        />

        {/* Disaster zone — red circle overlay */}
        {disasterZone && (
          <CircleF
            center={{ lat: disasterZone.lat, lng: disasterZone.lng }}
            radius={disasterZone.radius}
            options={{
              fillColor: "#f43f5e",
              fillOpacity: 0.08,
              strokeColor: "#f43f5e",
              strokeOpacity: 0.3,
              strokeWeight: 2,
            }}
          />
        )}
      </GoogleMap>
    </div>
  );
}
