import os
import json
import asyncio
import httpx
import operator
from dotenv import load_dotenv
from typing import TypedDict, Annotated, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END

# --- CONFIGURATION ---
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
MODE = os.getenv("MODE")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MAX_RANGE_KM = 10000

# Initialize Model
llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0.3, api_key=GROQ_API_KEY)

# Initialize Geocoder
geolocator = Nominatim(user_agent="aegis-disaster-relief")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL STATE ---
GLOBAL_DISASTERS = []

# --- DATA MODELS ---
class AidRequest(BaseModel):
    disaster_id: str
    description: str
    lat: float
    lng: float
    aid_type: Optional[str] = None

# --- LANGGRAPH SETUP ---
class AgentState(TypedDict):
    messages: Annotated[List[str], operator.add]
    context: str
    user_request: str
    iteration: int
    verdict: str

# Defined Agent Personas from Version 2
AGENTS = [
    {"node": "Miller", "name": "The Skeptic (Miller)", "style": "Fraud Auditor — Aggressively question legitimacy and demand hard evidence."},
    {"node": "Aris", "name": "The Empath (Dr. Aris)", "style": "Clinical Lead — Prioritize human life and advocate for immediate aid."},
    {"node": "Reyes", "name": "The Logistician (Reyes)", "style": "Operations Expert — Evaluate transport routes, inventory, and delivery feasibility."},
    {"node": "Okonkwo", "name": "The Field Medic (Okonkwo)", "style": "Emergency Medicine — Triage by medical urgency and life-threat risks."},
    {"node": "Chen", "name": "The Analyst (Chen)", "style": "Infrastructure Analyst — Assess structural safety and secondary environmental hazards."},
]

def agent_node(state: AgentState, name: str, style: str):
    prompt = (
        f"You are {name}. Expertise: {style}. Situation: {state['context']}. "
        f"Request: {state['user_request']}. Debate history: {state['messages']}. "
        "Provide a 20-word response challenging or supporting based on your persona."
    )
    res = llm.invoke(prompt)
    return {"messages": [f"{name}: {res.content}"], "iteration": state['iteration'] + 1}

def judge_node(state: AgentState):
    prompt = (
        f"Review this debate: {state['messages']}. Rules: VALID if majority support, DECLINED if majority doubt. "
        "Respond with exactly one word: VALID or DECLINED."
    )
    res = llm.invoke(prompt)
    raw = res.content.strip().upper().replace(".", "")
    return {"verdict": "DECLINED" if "DECLINED" in raw else "VALID"}

# Build the Workflow
workflow = StateGraph(AgentState)
for agent in AGENTS:
    workflow.add_node(agent["node"], lambda s, n=agent["name"], st=agent["style"]: agent_node(s, n, st))
workflow.add_node("Judge", judge_node)

workflow.set_entry_point(AGENTS[0]["node"])
for i in range(len(AGENTS) - 1):
    workflow.add_edge(AGENTS[i]["node"], AGENTS[i + 1]["node"])
workflow.add_edge(AGENTS[-1]["node"], "Judge")
workflow.add_edge("Judge", END)
graph = workflow.compile()

# --- UTILITIES ---
MONEY_KEYWORDS = ["money", "cash", "payment", "fund", "donate", "dollar", "euro", "pound", "£", "$", "€", "bitcoin", "crypto"]

def contains_money_request(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in MONEY_KEYWORDS)

# --- BACKGROUND TASKS ---
async def fetch_real_time_disasters():
    global GLOBAL_DISASTERS
    while True:
        new_events = []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson")
                if res.status_code == 200:
                    data = res.json()
                    for f in data.get('features', [])[:10]:
                        new_events.append({
                            "id": f["id"],
                            "name": f"Quake: {f['properties']['place']}",
                            "lat": f["geometry"]["coordinates"][1],
                            "lon": f["geometry"]["coordinates"][0],
                            "radius": 100
                        })
        except Exception as e:
            print(f"Scraper Error: {e}")

        if not new_events:
            new_events = [
                {"id": "d1", "name": "Valencia Flood", "lat": 39.4699, "lon": -0.3763, "radius": 30},
                {"id": "d2", "name": "California Wildfire", "lat": 34.0522, "lon": -118.2437, "radius": 50},
                {"id": "d3", "name": "Oxford Flash Flood", "lat": 51.7534, "lon": -1.2540, "radius": 100},
            ]
        GLOBAL_DISASTERS = new_events
        await asyncio.sleep(300)

@app.on_event("startup")
async def startup():
    asyncio.create_task(fetch_real_time_disasters())

# --- ENDPOINTS ---
@app.get("/disasters")
async def get_disasters():
    return GLOBAL_DISASTERS

@app.get("/nearby")
async def check_nearby(lat: float = Query(...), lng: float = Query(...)):
    if MODE == "DEMO":
        return {
            "safe": False,
            "disaster": {"id": "demo-001", "name": "SIMULATED: Urban Emergency", "lat": lat, "lon": lng, "radius": 10, "distance_km": 0.0},
            "distance_km": 0.0,
            "location_name": "Demo Environment (Simulated)",
        }

    closest, closest_distance = None, float("inf")
    active_list = GLOBAL_DISASTERS if GLOBAL_DISASTERS else [
        {"id": "d1", "name": "Valencia Flood", "lat": 39.4699, "lon": -0.3763, "radius": 30},
        {"id": "d2", "name": "California Wildfire", "lat": 34.0522, "lon": -118.2437, "radius": 50},
    ]

    for d in active_list:
        dist = geodesic((lat, lng), (d["lat"], d["lon"])).km
        if dist <= MAX_RANGE_KM and dist < closest_distance:
            closest, closest_distance = d, dist

    location_name = "Unknown Location"
    try:
        location = geolocator.reverse(f"{lat}, {lng}", exactly_one=True, language="en")
        if location:
            addr = location.raw.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county", "")
            location_name = f"{city}, {addr.get('country', '')}" if city else addr.get('country', '')
    except: pass

    if closest:
        return {"safe": False, "disaster": {**closest, "distance_km": round(closest_distance, 2)}, "distance_km": round(closest_distance, 2), "location_name": location_name}
    return {"safe": True, "location_name": location_name}

@app.post("/evaluate")
async def evaluate_aid(req: AidRequest):
    if MODE == "DEMO" and req.disaster_id == "demo-001":
        disaster = {"name": "Simulated Urban Emergency", "lat": req.lat, "lon": req.lng, "radius": 10}
        distance = 0.0
    else:
        disaster = next((d for d in GLOBAL_DISASTERS if d["id"] == req.disaster_id), None) or {"name": "Manual Override", "lat": req.lat, "lon": req.lng, "radius": 50}
        distance = geodesic((req.lat, req.lng), (disaster["lat"], disaster["lon"])).km

    if distance > disaster["radius"] and MODE != "DEMO":
        return {"status": "DECLINED", "reason": f"Outside zone ({round(distance)}km away)."}

    if contains_money_request(req.description):
        return {"status": "PROCESSED", "final_verdict": "DECLINED", "debate": ["System: Financial requests are not permitted."]}

    initial_state = {"messages": [], "context": f"Disaster: {disaster['name']}", "user_request": req.description, "iteration": 0, "verdict": ""}
    final_state = await graph.ainvoke(initial_state)
    verdict = final_state.get("verdict", "DECLINED")
    
    aid_rec = None
    if verdict == "VALID":
        rec_res = llm.invoke(f"Based on: {req.description}, suggest exact items to send (20 words max).")
        aid_rec = rec_res.content.strip()

    return {
        "status": "PROCESSED",
        "distance_km": round(distance, 2),
        "debate": final_state.get("messages", []) + [f"Arbiter: {verdict}"],
        "final_verdict": verdict,
        "aid_recommendation": aid_rec
    }

@app.get("/evaluate-stream")
async def evaluate_stream(request_text: str, context: str):
    async def stream():
        state = {"messages": [], "context": context, "user_request": request_text, "iteration": 0, "verdict": ""}
        async for event in graph.astream(state):
            for node, output in event.items():
                if "messages" in output:
                    yield f"data: {json.dumps({'type': 'comment', 'text': output['messages'][-1]})}\n\n"
                if "verdict" in output:
                    yield f"data: {json.dumps({'type': 'verdict', 'text': output['verdict']})}\n\n"
    return StreamingResponse(stream(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)