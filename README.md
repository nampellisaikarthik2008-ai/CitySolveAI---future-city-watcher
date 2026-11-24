# UrbanVista — Municipal Intelligence Network

> **AI-Powered Mobile Transit Sensor Network for Real-Time Road Infrastructure & Hazard Monitoring**

UrbanVista transforms ordinary public transit buses into mobile edge-sensing platforms that map city-wide road hazards (potholes, damaged signage, waterlogging, congestion) in real time. It provides municipal authorities, bus drivers, and citizens with a closed-loop civic intelligence platform.

---

## 🌟 Key Architecture & Capabilities

### 1. Edge AI Computer Vision
* Onboard cameras (Front, Rear, Left, Right) process road frames at the vehicle edge.
* Detects road surface defects, potholes, waterlogging, and damaged traffic signs.
* Emits lightweight (~2 KB) telemetry metadata instead of bandwidth-heavy video streams over cellular networks.

### 2. Spatial Deduplication & Clustering Engine (DBSCAN / Haversine)
* Solves the **"Duplicate Complaints"** problem when 20 buses pass the same pothole.
* Uses great-circle Haversine clustering to group detections within a 75-meter radius into a single **Unique Road Defect Asset ID** (`CLUST-RD-XXXX`).
* Tracks **Multi-Bus Verification** scores and enforces automated contractor repair SLAs.

### 3. Closed-Loop Contractor Verification & SLA Audit
* Enables authority action workflows: `Detected` → `Verified` → `Reported` → `Assigned` → `Resolved`.
* When a contractor claims a pothole is repaired, subsequent buses passing the coordinates automatically re-scan the surface.
* AI verifies asphalt smoothness and compliance with road standards (IRC:SP:20) before releasing payment or applying delay penalties.

### 4. Onboard Bus Driver Safety HUD
* In-vehicle tablet cockpit displaying real-time speed, compass heading, and multi-cam health.
* Proximity hazard radar warning drivers 65 meters ahead of critical craters with safe speed limits.

### 5. Citizen Grievance & Public Transparency Portal
* Live Road Quality Index (RQI) score (0–100) per municipal ward.
* Citizen hazard reporting that matches against existing bus fleet telemetry in real time.

### 6. Automated Ward Engineer Dispatches & PWD Work Order Export
* Automated WhatsApp/SMS dispatches to jurisdictional ward engineers with direct Google Maps navigation links.
* One-click CSV export of municipal contractor work orders.

---

## 🛠️ Tech Stack

* **Frontend:** React 19, TypeScript, Vite, React Router, Lucide React, Recharts, Leaflet & React-Leaflet
* **Backend:** FastAPI (Python), Uvicorn, SQLite, PIL (Pillow), NumPy
* **Analytics & Clustering:** Pure-Python Haversine Spatial Clustering, RQI Algorithm

---

## 🚀 Quick Start

### One-Click Launch (Windows)
Double-click `start.bat` in the root directory to launch both the backend and frontend simultaneously.

### Manual Setup

#### 1. Backend (FastAPI)
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```
* API Documentation (Swagger UI): `http://localhost:8000/docs`

#### 2. Frontend (Vite)
```bash
npm install
npm run dev
```
* Web Dashboard: `http://localhost:5173`

---

## 📄 License
MIT License. Developed for Smart City & Road Safety Hackathons.
