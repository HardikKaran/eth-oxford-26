import os
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from geopy.distance import geodesic
from langchain_openai import ChatOpenAI
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

class AidRequest(BaseModel):
    disaster_id: str
    aid_type: str
    description: str
    lat: float
    lng: float

def run_debate(aid_type, description):
    llm = ChatOpenAI(model="gpt-4o", temperature=0.7, openai_api_key="YOUR_OPENAI_KEY")
    
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

    # 2. AI Debate
    debate_results = run_debate(req.aid_type, req.description)
    return {
        "status": "PROCESSED",
        "distance_km": round(distance, 2),
        "debate": debate_results,
        "final_verdict": debate_results[-1]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)