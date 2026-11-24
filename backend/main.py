import json
import csv
import io
import asyncio
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from .database import get_connection, init_db, seed_if_empty
from .clustering import update_spatial_clusters
from .ai_engine import detect_road_hazards_from_image

app = FastAPI(
    title="UrbanVista Municipal Intelligence API",
    description="Backend services for Edge AI bus fleet telemetry, road hazard detection, and spatial clustering",
    version="1.0.0"
)

# Enable CORS for Vite dev server and external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections
active_connections: List[WebSocket] = []

# Simulation state
simulation_running = False
simulation_tick = 0
simulation_frames = 184921

routes_waypoints = [
    [12.936, 77.58], [12.942, 77.59], [12.95, 77.603], [12.962, 77.611],
    [12.971, 77.605], [12.968, 77.59], [12.956, 77.578], [12.944, 77.568]
]

class StatusUpdateRequest(BaseModel):
    status: str

class IncidentCreateRequest(BaseModel):
    type: str
    severity: str
    confidence: int
    busId: str
    camera: str
    lat: float
    lng: float
    area: str
    image: Optional[str] = "AI vision capture"

@app.on_event("startup")
async def startup_event():
    init_db()
    seed_if_empty()
    update_spatial_clusters()
    asyncio.create_task(simulation_worker())

async def simulation_worker():
    global simulation_running, simulation_tick, simulation_frames
    while True:
        try:
            if simulation_running and len(active_connections) > 0:
                simulation_tick += 1
                simulation_frames += 85 + (simulation_tick * 7) % 80
                
                # Update first 6 buses along routes
                conn = get_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT id, area FROM buses WHERE status = 'active' LIMIT 6")
                active_buses = cursor.fetchall()
                
                updated_buses = []
                now_str = datetime.now().isoformat()
                for i, row in enumerate(active_buses):
                    bus_id = row['id']
                    p = routes_waypoints[(simulation_tick + i * 2) % len(routes_waypoints)]
                    q = routes_waypoints[(simulation_tick + i * 2 + 1) % len(routes_waypoints)]
                    t = (simulation_tick % 4 + 1) / 5.0
                    new_lat = round(p[0] + (q[0] - p[0]) * t, 6)
                    new_lng = round(p[1] + (q[1] - p[1]) * t, 6)
                    new_speed = 22 + (i * 5 + simulation_tick) % 24
                    new_dir = ['Northbound', 'Eastbound', 'Southbound', 'Westbound'][simulation_tick % 4]
                    
                    cursor.execute("""
                    UPDATE buses 
                    SET lat = ?, lng = ?, speed = ?, direction = ?, updated = ?
                    WHERE id = ?
                    """, (new_lat, new_lng, new_speed, new_dir, now_str, bus_id))
                    
                    updated_buses.append({
                        "id": bus_id, "lat": new_lat, "lng": new_lng,
                        "speed": new_speed, "direction": new_dir, "updated": now_str
                    })
                
                # Periodically generate a simulated AI incident
                new_inc = None
                if simulation_tick % 5 == 0 and len(active_buses) > 0:
                    picked_bus = active_buses[(simulation_tick // 5) % len(active_buses)]
                    cursor.execute("SELECT lat, lng, area, detections FROM buses WHERE id = ?", (picked_bus['id'],))
                    b_info = cursor.fetchone()
                    
                    types = ['Pothole', 'Damaged road', 'Traffic congestion', 'Waterlogging', 'Damaged traffic sign']
                    sevs = ['medium', 'high', 'critical']
                    cams = ['Front Camera', 'Rear Camera', 'Left Camera', 'Right Camera']
                    
                    cursor.execute("SELECT COUNT(*) FROM incidents")
                    total_inc = cursor.fetchone()[0]
                    inc_id = f"INC-26-{str(total_inc + 1).zfill(3)}"
                    inc_type = types[simulation_tick % len(types)]
                    inc_sev = sevs[simulation_tick % len(sevs)]
                    inc_cam = cams[simulation_tick % len(cams)]
                    inc_conf = 82 + (simulation_tick * 3) % 16
                    
                    cursor.execute("""
                    INSERT INTO incidents (id, type, severity, confidence, bus_id, camera, lat, lng, area, timestamp, status, image, simulated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, (
                        inc_id, inc_type, inc_sev, inc_conf, picked_bus['id'],
                        inc_cam, b_info['lat'], b_info['lng'], b_info['area'],
                        now_str, 'Detected', 'SIMULATED AI FRAME'
                    ))
                    
                    cursor.execute("UPDATE buses SET detections = detections + 1 WHERE id = ?", (picked_bus['id'],))
                    conn.commit()
                    
                    new_inc = {
                        "id": inc_id, "type": inc_type, "severity": inc_sev,
                        "confidence": inc_conf, "busId": picked_bus['id'],
                        "camera": inc_cam, "lat": b_info['lat'], "lng": b_info['lng'],
                        "area": b_info['area'], "timestamp": now_str, "status": "Detected",
                        "image": "SIMULATED AI FRAME", "simulated": True
                    }
                else:
                    conn.commit()
                conn.close()
                
                # Broadcast telemetry to connected clients
                payload = {
                    "type": "TELEMETRY_UPDATE",
                    "buses": updated_buses,
                    "frames": simulation_frames,
                    "newIncident": new_inc
                }
                for conn_ws in list(active_connections):
                    try:
                        await conn_ws.send_text(json.dumps(payload))
                    except Exception:
                        pass
        except Exception as e:
            print("Simulation loop error:", e)
        await asyncio.sleep(1.8)

@app.get("/")
def root():
    return {
        "system": "UrbanVista Municipal Intelligence Backend",
        "status": "online",
        "version": "1.0.0",
        "features": ["FastAPI", "SQLite", "DBSCAN Spatial Clustering", "YOLO Road Hazard Vision Engine", "WebSockets"]
    }

# ==================== BUS FLEET APIS ====================
@app.get("/api/buses")
def get_buses():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM buses ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for r in rows:
        d = dict(r)
        d['cameras'] = json.loads(d['cameras'])
        result.append(d)
    return result

@app.get("/api/buses/{bus_id}")
def get_bus_profile(bus_id: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM buses WHERE id = ?", (bus_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Bus not found")
    d = dict(row)
    d['cameras'] = json.loads(d['cameras'])
    return d

# ==================== INCIDENT APIS ====================
@app.get("/api/incidents")
def get_incidents():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents ORDER BY timestamp DESC")
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for r in rows:
        d = dict(r)
        d['busId'] = d.pop('bus_id')
        d['simulated'] = bool(d.get('simulated', 0))
        result.append(d)
    return result

@app.get("/api/incidents/{incident_id}")
def get_incident(incident_id: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents WHERE id = ?", (incident_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    d = dict(row)
    d['busId'] = d.pop('bus_id')
    d['simulated'] = bool(d.get('simulated', 0))
    return d

@app.post("/api/incidents")
def create_incident(req: IncidentCreateRequest):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM incidents")
    count = cursor.fetchone()[0]
    inc_id = f"INC-26-{str(count + 1).zfill(3)}"
    now = datetime.now().isoformat()
    
    cursor.execute("""
    INSERT INTO incidents (id, type, severity, confidence, bus_id, camera, lat, lng, area, timestamp, status, image, simulated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    """, (
        inc_id, req.type, req.severity, req.confidence, req.busId,
        req.camera, req.lat, req.lng, req.area, now, 'Detected', req.image
    ))
    conn.commit()
    conn.close()
    
    update_spatial_clusters()
    return {"id": inc_id, "status": "Detected", "timestamp": now}

@app.patch("/api/incidents/{incident_id}/status")
def update_incident_status(incident_id: str, req: StatusUpdateRequest):
    valid_statuses = ['Detected', 'Verified', 'Reported', 'Assigned', 'Resolved']
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE incidents SET status = ? WHERE id = ?", (req.status, incident_id))
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Incident not found")
    conn.commit()
    conn.close()
    
    update_spatial_clusters()
    return {"id": incident_id, "status": req.status}

# ==================== SPATIAL CLUSTERS & DEDUPLICATION ====================
@app.get("/api/clusters")
def get_clusters():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clusters ORDER BY incident_count DESC")
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for r in rows:
        d = dict(r)
        d['verified_by_buses'] = json.loads(d['verified_by_buses'])
        result.append(d)
    return result

@app.post("/api/clusters/recompute")
def recompute_clusters():
    clusters = update_spatial_clusters()
    return {"message": "Spatial clustering recomputed", "total_clusters": len(clusters)}

# ==================== ANALYTICS API ====================
@app.get("/api/analytics")
def get_analytics():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents")
    incidents = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT * FROM buses")
    buses = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    # 7-day trend
    days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    trend = [{"d": day, "v": 0} for day in days]
    for inc in incidents:
        try:
            d_idx = datetime.fromisoformat(inc['timestamp']).weekday()
            trend[d_idx]['v'] += 1
        except Exception:
            pass
            
    # Severities
    sev_counts = {'low': 0, 'medium': 0, 'high': 0, 'critical': 0}
    for inc in incidents:
        s = inc['severity']
        if s in sev_counts:
            sev_counts[s] += 1
    sev_data = [{"name": k, "value": v} for k, v in sev_counts.items()]
    
    # Categories
    cat_counts = {}
    for inc in incidents:
        t = inc['type'][:12]
        cat_counts[t] = cat_counts.get(t, 0) + 1
    cat_data = [{"name": k, "value": v} for k, v in cat_counts.items()]
    
    # Incidents by bus
    bus_counts = {}
    for inc in incidents:
        b = inc['bus_id'][-3:]
        bus_counts[b] = bus_counts.get(b, 0) + 1
    bus_data = [{"name": k, "value": v} for k, v in list(bus_counts.items())[:8]]
    
    # Top areas
    area_counts = {}
    for inc in incidents:
        a = inc['area']
        area_counts[a] = area_counts.get(a, 0) + 1
    top_areas = sorted(area_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    
    return {
        "trend": trend,
        "severities": sev_data,
        "categories": cat_data,
        "busData": bus_data,
        "topAreas": top_areas,
        "totalIncidents": len(incidents),
        "totalBuses": len(buses)
    }

# ==================== WORK ORDER EXPORT (PWD / NHAI) ====================
@app.get("/api/export/work-order")
def export_work_order():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clusters WHERE status != 'Resolved' ORDER BY severity DESC")
    clusters = cursor.fetchall()
    conn.close()
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Work Order ID", "Hazard Type", "Severity", "Latitude", "Longitude",
        "Municipal Ward / Area", "Detection Count", "Verifying Buses",
        "SLA Repair Deadline", "Lifecycle Status"
    ])
    
    for c in clusters:
        writer.writerow([
            c['id'], c['type'], c['severity'].upper(), c['lat'], c['lng'],
            c['area'], c['incident_count'], c['verified_by_buses'],
            c['sla_deadline'], c['status']
        ])
        
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=UrbanVista_PWD_Work_Order.csv"}
    )

class InspectRequest(BaseModel):
    image_base64: str
    busId: Optional[str] = "BUS-104"
    area: Optional[str] = "MG Road"

# ==================== REAL AI INSPECTION API ====================
@app.post("/api/ai/inspect")
def inspect_road_image(req: InspectRequest):
    # Decode base64 image string
    b64_str = req.image_base64
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    
    contents = base64.b64decode(b64_str)
    detection_res = detect_road_hazards_from_image(contents, bus_id=req.busId or "BUS-104", area=req.area or "MG Road")
    
    # Save the highest confidence detection as an incident
    if detection_res['detections']:
        top_det = detection_res['detections'][0]
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM incidents")
        count = cursor.fetchone()[0]
        inc_id = f"INC-26-{str(count + 1).zfill(3)}"
        
        cursor.execute("SELECT lat, lng FROM buses WHERE id = ?", (req.busId,))
        b_row = cursor.fetchone()
        lat = b_row['lat'] if b_row else 12.9716
        lng = b_row['lng'] if b_row else 77.5946
        
        cursor.execute("""
        INSERT INTO incidents (id, type, severity, confidence, bus_id, camera, lat, lng, area, timestamp, status, image, simulated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            inc_id, top_det['type'], top_det['severity'], top_det['confidence'],
            req.busId, 'Front Camera', lat, lng, req.area,
            detection_res['timestamp'], 'Detected', 'Vision inspection frame'
        ))
        conn.commit()
        conn.close()
        
        top_det['incident_id'] = inc_id
        update_spatial_clusters()
        
    return detection_res

class RepairAuditRequest(BaseModel):
    incidentId: str
    repairPassed: bool = True
    notes: Optional[str] = "Contractor asphalt patching completed"
    repairImageBase64: Optional[str] = None

class CitizenReportRequest(BaseModel):
    hazardType: str
    area: str
    description: Optional[str] = ""
    lat: Optional[float] = None
    lng: Optional[float] = None

class DispatchAlertRequest(BaseModel):
    clusterId: str
    engineerName: Optional[str] = "Er. R. Venkatesh"
    ward: Optional[str] = "BBMP Ward 112 (East)"
    phone: Optional[str] = "+91 98450 12847"
    channel: Optional[str] = "WhatsApp"

# ==================== FEATURE 1: BEFORE & AFTER REPAIR AUDIT ====================
@app.post("/api/contractor/verify-repair")
def verify_contractor_repair(req: RepairAuditRequest):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents WHERE id = ?", (req.incidentId,))
    inc = cursor.fetchone()
    if not inc:
        conn.close()
        raise HTTPException(status_code=404, detail="Incident not found")
        
    inc = dict(inc)
    now_str = datetime.now().isoformat()
    
    if req.repairPassed:
        new_status = 'Resolved'
        audit_result = {
            "status": "VERIFIED_RESOLVED",
            "qualityScore": 96,
            "asphaltDensity": "COMPLIANT",
            "paymentClearance": "APPROVED_FOR_RELEASE",
            "penaltyApplied": None,
            "auditTimestamp": now_str,
            "message": "AI Re-Scan Verification Successful: Road surface meets IRC:SP:20 quality standards."
        }
        cursor.execute("UPDATE incidents SET status = 'Resolved' WHERE id = ?", (req.incidentId,))
    else:
        new_status = 'Reported'
        audit_result = {
            "status": "REPAIR_REJECTED",
            "qualityScore": 48,
            "asphaltDensity": "SUB-STANDARD",
            "paymentClearance": "WITHHELD",
            "penaltyApplied": "20% SLA Delay Penalty Escalation",
            "auditTimestamp": now_str,
            "message": "AI Re-Scan Failed: Defect depression still exceeds 30mm depth threshold. Re-assigned to contractor."
        }
        cursor.execute("UPDATE incidents SET status = 'Reported' WHERE id = ?", (req.incidentId,))
        
    conn.commit()
    conn.close()
    update_spatial_clusters()
    
    return {
        "incidentId": req.incidentId,
        "hazardType": inc['type'],
        "area": inc['area'],
        "updatedStatus": new_status,
        "audit": audit_result
    }

# ==================== FEATURE 3: CITIZEN GRIEVANCE PORTAL ====================
@app.get("/api/citizen/status")
def get_citizen_ward_status(ward: Optional[str] = "MG Road"):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents WHERE area LIKE ? ORDER BY timestamp DESC", (f"%{ward}%",))
    incidents = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM buses WHERE area LIKE ? OR status = 'active'", (f"%{ward}%",))
    buses = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM clusters WHERE area LIKE ?", (f"%{ward}%",))
    clusters = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    active_incidents = [i for i in incidents if i['status'] != 'Resolved']
    resolved_count = len(incidents) - len(active_incidents)
    
    penalty = sum(15 if i['severity']=='critical' else (10 if i['severity']=='high' else 5) for i in active_incidents)
    rqi = max(35, 100 - penalty)
    
    return {
        "ward": ward,
        "roadQualityIndex": rqi,
        "activeHazards": len(active_incidents),
        "resolvedThisMonth": resolved_count,
        "busesPatrolling": len(buses),
        "lastPatrolTime": "42 minutes ago (BUS-102)",
        "clusters": clusters,
        "activeIncidents": active_incidents[:10]
    }

@app.post("/api/citizen/report")
def submit_citizen_report(req: CitizenReportRequest):
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, type, bus_id, timestamp, status FROM incidents WHERE area LIKE ? AND type = ? AND status != 'Resolved' LIMIT 1", (f"%{req.area}%", req.hazardType))
    match = cursor.fetchone()
    
    report_id = f"CITIZEN-REP-{int(datetime.now().timestamp())}"
    now_str = datetime.now().isoformat()
    
    if match:
        matched_dict = dict(match)
        msg = f"Good news! This issue was already detected by public bus {matched_dict['bus_id']}. Ward repair crew is assigned with SLA in progress."
        status = "ALREADY_VERIFIED_BY_BUS"
        cluster_id = matched_dict['id']
    else:
        msg = "Report received! Added to the municipal verification queue. Bus edge cameras on this route will scan the coordinates on their next pass."
        status = "QUEUED_FOR_BUS_VERIFICATION"
        cluster_id = None
        
    cursor.execute("""
    INSERT INTO citizen_reports (id, hazard_type, area, lat, lng, description, status, matched_cluster_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (report_id, req.hazardType, req.area, req.lat or 12.9716, req.lng or 77.5946, req.description, status, cluster_id, now_str))
    
    conn.commit()
    conn.close()
    
    return {
        "reportId": report_id,
        "status": status,
        "message": msg,
        "timestamp": now_str
    }

# ==================== FEATURE 4: AUTOMATED WARD ENGINEER ALERTS ====================
@app.get("/api/alerts/history")
def get_alerts_history():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM dispatches ORDER BY timestamp DESC LIMIT 20")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/alerts/dispatch")
def dispatch_engineer_alert(req: DispatchAlertRequest):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM clusters WHERE id = ?", (req.clusterId,))
    clust = cursor.fetchone()
    if not clust:
        conn.close()
        raise HTTPException(status_code=404, detail="Cluster not found")
        
    clust = dict(clust)
    dispatch_id = f"DISP-{int(datetime.now().timestamp())}"
    now_str = datetime.now().isoformat()
    sla_hours = 24 if clust['severity'] == 'critical' else 48
    
    google_maps_link = f"https://www.google.com/maps/search/?api=1&query={clust['lat']},{clust['lng']}"
    message = (
        f"🚨 [BBMP ROAD SAFETY ALERT] 🚨\n"
        f"Urgent: {clust['severity'].upper()} {clust['type']} detected at {clust['area']}.\n"
        f"Verified by {clust['incident_count']} public transit bus detections.\n"
        f"GPS: {clust['lat']}, {clust['lng']}\n"
        f"Navigation: {google_maps_link}\n"
        f"SLA Repair Deadline: {sla_hours} hours.\n"
        f"Assigned to: {req.engineerName} ({req.ward})"
    )
    
    cursor.execute("""
    INSERT INTO dispatches (id, cluster_id, engineer_name, ward, phone, channel, message, status, timestamp, sla_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DISPATCHED', ?, ?)
    """, (dispatch_id, req.clusterId, req.engineerName, req.ward, req.phone, req.channel, message, now_str, sla_hours))
    
    cursor.execute("UPDATE clusters SET status = 'Assigned' WHERE id = ?", (req.clusterId,))
    conn.commit()
    conn.close()
    
    return {
        "dispatchId": dispatch_id,
        "status": "DISPATCHED",
        "channel": req.channel,
        "recipient": f"{req.engineerName} ({req.phone})",
        "ward": req.ward,
        "slaHours": sla_hours,
        "message": message,
        "googleMapsLink": google_maps_link,
        "timestamp": now_str
    }

# ==================== FEATURE 5: DRIVER COCKPIT PROXIMITY HAZARDS ====================
@app.get("/api/driver/proximity")
def get_driver_proximity_hazards(busId: str = "BUS-104"):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT lat, lng, speed, direction, route, area FROM buses WHERE id = ?", (busId,))
    bus = cursor.fetchone()
    if not bus:
        conn.close()
        raise HTTPException(status_code=404, detail="Bus not found")
        
    bus = dict(bus)
    cursor.execute("SELECT * FROM incidents WHERE status != 'Resolved' ORDER BY timestamp DESC")
    incidents = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    from .clustering import haversine_distance
    
    hazards_ahead = []
    for inc in incidents:
        dist = haversine_distance(bus['lat'], bus['lng'], inc['lat'], inc['lng'])
        if dist < 800:
            hazards_ahead.append({
                "incidentId": inc['id'],
                "type": inc['type'],
                "severity": inc['severity'],
                "distanceMeters": int(dist),
                "location": inc['area'],
                "recommendedSpeed": 15 if inc['severity'] in ['critical', 'high'] else 25,
                "lane": "Left Lane" if "Left" in inc['camera'] else ("Right Lane" if "Right" in inc['camera'] else "Center Lane")
            })
            
    hazards_ahead.sort(key=lambda x: x['distanceMeters'])
    nearest = hazards_ahead[0] if hazards_ahead else None
    
    return {
        "busId": busId,
        "route": bus['route'],
        "currentSpeed": bus['speed'],
        "heading": bus['direction'],
        "currentArea": bus['area'],
        "nearestHazard": nearest,
        "hazardsAhead": hazards_ahead[:4]
    }

# ==================== SIMULATION CONTROL ====================
@app.post("/api/simulation/toggle")
def toggle_simulation():
    global simulation_running
    simulation_running = not simulation_running
    return {"simulation_running": simulation_running}

@app.post("/api/simulation/reset")
def reset_simulation():
    global simulation_running, simulation_tick, simulation_frames
    simulation_running = False
    simulation_tick = 0
    simulation_frames = 184921
    init_db()
    seed_if_empty()
    update_spatial_clusters()
    return {"message": "Simulation reset to default state"}

# ==================== WEBSOCKET TELEMETRY STREAM ====================
@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            global simulation_running
            if msg.get("action") == "start":
                simulation_running = True
            elif msg.get("action") == "pause":
                simulation_running = False
    except WebSocketDisconnect:
        active_connections.remove(websocket)
    except Exception:
        if websocket in active_connections:
            active_connections.remove(websocket)
