import sqlite3
import json
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "urbanvista.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS buses (
        id TEXT PRIMARY KEY,
        route TEXT NOT NULL,
        status TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        speed INTEGER NOT NULL,
        direction TEXT NOT NULL,
        cameras TEXT NOT NULL,
        detections INTEGER NOT NULL,
        updated TEXT NOT NULL,
        area TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        bus_id TEXT NOT NULL,
        camera TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        area TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        status TEXT NOT NULL,
        image TEXT NOT NULL,
        simulated INTEGER DEFAULT 0,
        cluster_id TEXT
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS clusters (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        area TEXT NOT NULL,
        incident_count INTEGER NOT NULL,
        verified_by_buses TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sla_deadline TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS dispatches (
        id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        engineer_name TEXT NOT NULL,
        ward TEXT NOT NULL,
        phone TEXT NOT NULL,
        channel TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        sla_hours INTEGER NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS citizen_reports (
        id TEXT PRIMARY KEY,
        hazard_type TEXT NOT NULL,
        area TEXT NOT NULL,
        lat REAL,
        lng REAL,
        description TEXT,
        status TEXT NOT NULL,
        matched_cluster_id TEXT,
        created_at TEXT NOT NULL
    )
    """)

    conn.commit()
    conn.close()

def seed_if_empty():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM buses")
    count = cursor.fetchone()[0]
    if count > 0:
        conn.close()
        return

    routes = [
        'R-01 · Central Loop', 'R-02 · Tech Park', 'R-03 · East Corridor',
        'R-04 · Airport Link', 'R-05 · Riverfront', 'R-06 · University'
    ]
    areas = [
        'Civic Square', 'MG Road', 'Lake View Junction', 'Metro Station',
        'Indiranagar 100ft Rd', 'Koramangala 5th Block', 'Yeshwanthpur',
        'Hebbal Flyover', 'Richmond Circle', 'Whitefield Main Rd'
    ]
    statuses = ['active', 'active', 'active', 'active', 'idle', 'maintenance', 'offline']
    cam_names = ['front', 'rear', 'left', 'right', 'cabin']

    now = datetime.now()
    buses_data = []
    for i in range(18):
        bus_id = f"BUS-{str(i+101).zfill(3)}"
        route = routes[i % 6]
        st = statuses[i % 7]
        lat = 12.93 + (i % 6) * 0.018
        lng = 77.57 + (i // 6) * 0.035
        speed = 18 + (i * 7) % 32 if st == 'active' else 0
        direction = ['Northbound', 'Eastbound', 'Southbound', 'Westbound'][i % 4]
        cameras = {
            c: 'offline' if (i + j * 3) % 13 == 0 else ('degraded' if (i + j) % 9 == 0 else 'online')
            for j, c in enumerate(cam_names)
        }
        detections = 9 + (i * 11) % 45
        updated = (now - timedelta(seconds=i * 190)).isoformat()
        area = areas[i % 10]
        buses_data.append((
            bus_id, route, st, lat, lng, speed, direction,
            json.dumps(cameras), detections, updated, area
        ))

    cursor.executemany("""
    INSERT INTO buses (id, route, status, lat, lng, speed, direction, cameras, detections, updated, area)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, buses_data)

    types = [
        'Pothole', 'Damaged road', 'Missing traffic sign', 'Damaged traffic sign',
        'Missing zebra crossing', 'Waterlogging', 'Traffic congestion',
        'High vehicle density', 'Pedestrian risk'
    ]
    severities = ['low', 'medium', 'medium', 'high', 'critical']
    stages = ['Detected', 'Verified', 'Reported', 'Assigned', 'Resolved']

    incidents_data = []
    for i in range(84):
        b = buses_data[(i * 7) % 18]
        inc_id = f"INC-26-{str(i+1).zfill(3)}"
        inc_type = types[i % 9]
        sev = severities[(i * 3) % 5]
        conf = 72 + (i * 7) % 27
        bus_id = b[0]
        camera = ['Front', 'Rear', 'Left', 'Right'][i % 4] + ' Camera'
        lat = b[3] + ((i % 5) - 2) * 0.003
        lng = b[4] + ((i % 7) - 3) * 0.003
        area = areas[(i * 3) % 10]
        ts = (now - timedelta(minutes=i * 55)).isoformat()
        st = stages[(i * 5) % 5]
        incidents_data.append((
            inc_id, inc_type, sev, conf, bus_id, camera,
            lat, lng, area, ts, st, 'AI vision capture', 0, None
        ))

    cursor.executemany("""
    INSERT INTO incidents (id, type, severity, confidence, bus_id, camera, lat, lng, area, timestamp, status, image, simulated, cluster_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, incidents_data)

    conn.commit()
    conn.close()
