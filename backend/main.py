import os
import json
import asyncio
import httpx
import operator
from dotenv import load_dotenv
from typing import TypedDict, Annotated, List, Optional

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END

# --- CONFIGURATION ---
MODE = "DEMO" # DEMO for video
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

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

# --- AGENT DEFINITIONS ---
AGENTS = [
    {
        "node": "Miller",
        "name": "The Skeptic (Miller)",
        "style": "Fraud Auditor — You aggressively question legitimacy, look for inconsistencies, and demand hard evidence. You distrust vague claims.",
    },
    {
        "node": "Aris",
        "name": "The Empath (Dr. Aris)",
        "style": "Clinical Lead & Humanitarian — You prioritise human life above all. You advocate for immediate aid even with incomplete data. Empathetic but professional.",
    },
    {
        "node": "Reyes",
        "name": "The Logistician (Reyes)",
        "style": "Supply Chain & Operations Expert — You evaluate whether the requested aid is logistically feasible: transport routes, inventory, delivery time, resource constraints.",
    },
    {
        "node": "Okonkwo",
        "name": "The Field Medic (Okonkwo)",
        "style": "Emergency Medicine Specialist — You triage requests by medical urgency. You flag life-threatening situations and deprioritise non-critical asks.",
    },
    {
        "node": "Chen",
        "name": "The Analyst (Chen)",
        "style": "Infrastructure & Risk Analyst — You assess structural safety, environmental hazards, access routes, and secondary disaster risks before approving aid deployment.",
    },
]

def agent_node(state: AgentState, name: str, style: str):
    prompt = (
        f"You are {name}. Your expertise: {style}\n\n"
        f"Situation: {state['context']}.\n"
        f"User request: {state['user_request']}.\n"
        f"Debate so far: {state['messages']}.\n\n"
        f"Provide a sharp 15-20 word response from YOUR unique expertise, "
        f"either challenging or supporting the request. Be specific to your domain."
    )
    res = llm.invoke(prompt)
    return {"messages": [f"{name}: {res.content}"], "iteration": state['iteration'] + 1}

# Keywords that trigger automatic rejection
MONEY_KEYWORDS = ["money", "cash", "payment", "fund", "donate", "dollar", "euro", "pound", "£", "$", "€",
                  "transfer", "bank", "bitcoin", "crypto", "compensat", "reimburse", "salary", "wage"]

def contains_money_request(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in MONEY_KEYWORDS)

def judge_node(state: AgentState):
    prompt = (
        f"You are The Arbiter, the final judge reviewing an aid request debate.\n"
        f"Five specialist agents have weighed in:\n"
        f"{chr(10).join(state['messages'])}\n\n"
        f"Rules:\n"
        f"- VALID: majority of agents support the request\n"
        f"- DECLINED: majority of agents oppose or doubt the request\n\n"
        f"Count how many agents support vs oppose. Respond with exactly one word: VALID or DECLINED."
    )
    res = llm.invoke(prompt)
    raw = res.content.strip().upper().replace(".", "")
    if "DECLINED" in raw:
        verdict = "DECLINED"
    else:
        verdict = "VALID"
    return {"verdict": verdict}

# --- BUILD LANGGRAPH WORKFLOW ---
workflow = StateGraph(AgentState)

# Register all agent nodes + judge
for agent in AGENTS:
    node_name = agent["node"]
    workflow.add_node(node_name, lambda s, n=agent["name"], st=agent["style"]: agent_node(s, n, st))
workflow.add_node("Judge", judge_node)

# Chain: Miller → Aris → Reyes → Okonkwo → Chen → Judge → END
workflow.set_entry_point(AGENTS[0]["node"])
for i in range(len(AGENTS) - 1):
    workflow.add_edge(AGENTS[i]["node"], AGENTS[i + 1]["node"])
workflow.add_edge(AGENTS[-1]["node"], "Judge")
workflow.add_edge("Judge", END)

graph = workflow.compile()

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
    """Check if user is near any known disaster. Returns closest threat or safe status."""
    if MODE == "DEMO":
        demo_event = {
            "id": "demo-001",
            "name": "SIMULATED: Urban Emergency",
            "lat": lat,
            "lon": lng,
            "radius": 10
        }
        return {
            "safe": False,
            "disaster": {**demo_event, "distance_km": 0.0},
            "distance_km": 0.0,
            "location_name": "Demo Environment (Simulated)",
        }

    closest = None
    closest_distance = float("inf")
    for disaster in GLOBAL_DISASTERS:
        try:
            distance = geodesic((lat, lng), (disaster["lat"], disaster["lon"])).km
            if distance <= disaster["radius"] and distance < closest_distance:
                closest = disaster
                closest_distance = distance
        except Exception:
            continue

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

    return {"safe": True, "location_name": location_name}

@app.post("/evaluate")
async def evaluate_aid(req: AidRequest):
    # Check if it's our Demo disaster
    if MODE == "DEMO" and req.disaster_id == "demo-001":
        disaster = {"name": "Simulated Urban Emergency", "lat": req.lat, "lon": req.lng, "radius": 10}
        distance = 0.0
    else:
        disaster = next((d for d in GLOBAL_DISASTERS if d["id"] == req.disaster_id), None)
        if not disaster:
            disaster = {"name": "Manual Override Event", "lat": req.lat, "lon": req.lng, "radius": 50}
        distance = geodesic((req.lat, req.lng), (disaster["lat"], disaster["lon"])).km

    if distance > disaster["radius"] and MODE != "DEMO":
        return {
            "status": "DECLINED",
            "reason": f"User is {round(distance)}km away. Outside zone."
        }

    # Auto-decline monetary requests
    if contains_money_request(req.description):
        return {
            "status": "PROCESSED",
            "distance_km": round(distance, 2),
            "debate": [
                "The Skeptic (Miller): Monetary requests are outside Aegis scope — aid is material, not financial.",
                "The Empath (Dr. Aris): Understood. We provide physical aid — medical, water, shelter — not cash.",
                "The Logistician (Reyes): Financial disbursement has no logistics pathway in our system.",
                "The Field Medic (Okonkwo): Medical aid is in-kind only. Cash requests indicate non-emergency.",
                "The Analyst (Chen): Risk assessment flags monetary requests as potential fraud vectors. Declining.",
                "The Arbiter: VERDICT IS DECLINED",
            ],
            "final_verdict": "DECLINED"
        }

    # AI Debate
    aid_type = req.aid_type or req.description.split(".")[0][:50]
    initial_state = {
        "messages": [],
        "context": f"Disaster: {disaster['name']}. Aid Type: {aid_type}",
        "user_request": req.description,
        "iteration": 0,
        "verdict": ""
    }

    final_state = await graph.ainvoke(initial_state)
    transcript = final_state.get("messages", [])
    verdict = final_state.get("verdict", "PENDING")
    transcript.append(f"The Arbiter: VERDICT IS {verdict}")

    # If approved, have the LLM decide exactly what aid to deploy
    aid_recommendation = None
    if verdict == "VALID":
        rec_prompt = (
            f"You are a disaster relief coordinator. Based on this situation and debate, "
            f"decide exactly what aid to deploy.\n\n"
            f"Disaster: {disaster['name']}\n"
            f"User request: {req.description}\n"
            f"Agent debate summary: {'; '.join(transcript[-5:])}\n\n"
            f"Respond with a single concise line (max 25 words) specifying: "
            f"what items/resources to send, quantity, and priority level. "
            f"Example: 'Deploy 2x medical kits, 10L water, thermal blankets — Priority: CRITICAL'"
        )
        rec_res = llm.invoke(rec_prompt)
        aid_recommendation = rec_res.content.strip()

    return {
        "status": "PROCESSED",
        "distance_km": round(distance, 2),
        "debate": transcript,
        "final_verdict": verdict,
        "aid_recommendation": aid_recommendation
    }

@app.get("/evaluate-stream")
async def evaluate_stream(request_text: str, context: str):
    """SSE endpoint that streams each agent's response in real-time."""
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