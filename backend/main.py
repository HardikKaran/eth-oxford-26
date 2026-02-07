import os
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

app = FastAPI()

# Enable CORS for React communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 0. DUMMY DATA (Now including Oxford)
DUMMY_DISASTERS = [
    {"id": "d1", "name": "Valencia Flood", "lat": 39.4699, "lon": -0.3763, "radius": 30},
    {"id": "d2", "name": "California Wildfire", "lat": 34.0522, "lon": -118.2437, "radius": 50},
    {"id": "d3", "name": "Oxford Flash Flood", "lat": 51.7534, "lon": -1.2540, "radius": 100},
]

# Geocoder for reverse-geocoding user coordinates to a place name
geolocator = Nominatim(user_agent="aegis-disaster-relief")

class AidRequest(BaseModel):
    disaster_id: str
    description: str
    lat: float
    lng: float
    aid_type: Optional[str] = None  # Optional — derived from description if not provided

def run_debate(aid_type, description):
    llm = ChatAnthropic(model="claude-3-5-sonnet-20241022", temperature=0.7, anthropic_api_key="YOUR_ANTHROPIC_API_KEY")
    
    personalities = {
        "The Skeptic": "Your goal is to find signs of fraud or laziness in the request.",
        "The Empath": "Focus on the human suffering and urgency of the text.",
        "The Logistics Expert": "Determine if this aid is actually deliverable in a disaster zone.",
        "The Local Official": "Check if this request overlaps with existing government services.",
        "The Arbiter": "Summarize the debate and provide a final verdict: VALID, MODIFIED, or DECLINED."
    }

    transcript = []
    context = f"Aid Requested: {aid_type}. Context: {description}"

    for name, bio in personalities.items():
        history = "\n".join(transcript)
        prompt = f"Role: {bio}\n\nPrevious Discussion:\n{history}\n\nEvaluate this: {context}"
        response = llm.invoke([SystemMessage(content=prompt)])
        transcript.append(f"{name}: {response.content}")

    return transcript

@app.get("/disasters")
async def get_disasters():
    return DUMMY_DISASTERS

@app.get("/nearby")
async def check_nearby(lat: float = Query(...), lng: float = Query(...)):
    """Check if user is near any known disaster. Returns closest threat or safe status."""
    closest = None
    closest_distance = float("inf")

    for disaster in DUMMY_DISASTERS:
        distance = geodesic((lat, lng), (disaster["lat"], disaster["lon"])).km
        if distance <= disaster["radius"] and distance < closest_distance:
            closest = disaster
            closest_distance = distance

    # Reverse-geocode to get a human-readable location name
    location_name = "Unknown Location"
    try:
        location = geolocator.reverse(f"{lat}, {lng}", exactly_one=True, language="en")
        if location:
            addr = location.raw.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county", "")
            country = addr.get("country", "")
            location_name = f"{city}, {country}" if city else country
    except Exception:
        pass

    if closest:
        return {
            "safe": False,
            "disaster": {**closest, "distance_km": round(closest_distance, 2)},
            "distance_km": round(closest_distance, 2),
            "location_name": location_name,
        }

    return {
        "safe": True,
        "location_name": location_name,
    }

@app.post("/evaluate")
async def evaluate_aid(req: AidRequest):
    # 1. Spatial Validation
    disaster = next((d for d in DUMMY_DISASTERS if d["id"] == req.disaster_id), None)
    if not disaster:
        raise HTTPException(status_code=404, detail="Disaster not found")

    distance = geodesic((req.lat, req.lng), (disaster["lat"], disaster["lon"])).km
    
    if distance > disaster["radius"]:
        return {
            "status": "DECLINED",
            "reason": f"User is {round(distance)}km away. Outside the {disaster['radius']}km emergency zone."
        }

    # 2. AI Debate — derive aid_type from description if not provided
    aid_type = req.aid_type or req.description.split(".")[0][:50]
    debate_results = run_debate(aid_type, req.description)
    return {
        "status": "PROCESSED",
        "distance_km": round(distance, 2),
        "debate": debate_results,
        "final_verdict": debate_results[-1]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)