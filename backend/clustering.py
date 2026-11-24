import json
import math
from datetime import datetime, timedelta
from .database import get_connection

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def update_spatial_clusters(distance_threshold_m: float = 75.0):
    """
    Pure-Python spatial clustering engine:
    Groups duplicate road hazard detections within 75 meters of each other
    into unified Road Hazard Clusters, preventing ticket duplication for municipal wards.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT id, type, severity, confidence, bus_id, lat, lng, area, timestamp, status
    FROM incidents
    """)
    rows = cursor.fetchall()
    if not rows:
        conn.close()
        return []

    incidents = [dict(row) for row in rows]
    types = set(inc['type'] for inc in incidents)
    
    all_clusters = []
    cluster_counter = 1
    now = datetime.now()
    sev_levels = {'low': 1, 'medium': 2, 'high': 3, 'critical': 4}

    for defect_type in types:
        type_incidents = [inc for inc in incidents if inc['type'] == defect_type]
        visited = set()
        
        for i, inc in enumerate(type_incidents):
            if inc['id'] in visited:
                continue
                
            # Form cluster around this seed incident
            cluster_members = [inc]
            visited.add(inc['id'])
            
            for j, other in enumerate(type_incidents):
                if other['id'] in visited:
                    continue
                dist = haversine_distance(inc['lat'], inc['lng'], other['lat'], other['lng'])
                if dist <= distance_threshold_m:
                    cluster_members.append(other)
                    visited.add(other['id'])
                    
            # Compute centroid
            centroid_lat = sum(m['lat'] for m in cluster_members) / len(cluster_members)
            centroid_lng = sum(m['lng'] for m in cluster_members) / len(cluster_members)
            unique_buses = list(set(m['bus_id'] for m in cluster_members))
            
            # Severity calculation
            max_sev = max(cluster_members, key=lambda m: sev_levels.get(m['severity'], 1))['severity']
            if len(unique_buses) >= 2 and sev_levels[max_sev] < 3:
                max_sev = 'high'
                
            cluster_id = f"CLUST-RD-{str(cluster_counter).zfill(4)}"
            cluster_counter += 1
            
            statuses = [m['status'] for m in cluster_members]
            if all(s == 'Resolved' for s in statuses):
                cluster_status = 'Resolved'
            elif any(s == 'Assigned' for s in statuses):
                cluster_status = 'Assigned'
            elif any(s == 'Reported' for s in statuses):
                cluster_status = 'Reported'
            elif len(unique_buses) > 1 or 'Verified' in statuses:
                cluster_status = 'Verified'
            else:
                cluster_status = 'Detected'
                
            sla_hours = 24 if max_sev == 'critical' else (48 if max_sev == 'high' else 168)
            sla_deadline = (now + timedelta(hours=sla_hours)).isoformat()
            
            all_clusters.append({
                'id': cluster_id,
                'type': defect_type,
                'severity': max_sev,
                'lat': round(centroid_lat, 6),
                'lng': round(centroid_lng, 6),
                'area': cluster_members[0]['area'],
                'incident_count': len(cluster_members),
                'verified_by_buses': json.dumps(unique_buses),
                'status': cluster_status,
                'created_at': cluster_members[0]['timestamp'],
                'sla_deadline': sla_deadline,
                'member_ids': [m['id'] for m in cluster_members]
            })

    cursor.execute("DELETE FROM clusters")
    for c in all_clusters:
        cursor.execute("""
        INSERT INTO clusters (id, type, severity, lat, lng, area, incident_count, verified_by_buses, status, created_at, sla_deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            c['id'], c['type'], c['severity'], c['lat'], c['lng'],
            c['area'], c['incident_count'], c['verified_by_buses'],
            c['status'], c['created_at'], c['sla_deadline']
        ))
        for m_id in c['member_ids']:
            cursor.execute("UPDATE incidents SET cluster_id = ? WHERE id = ?", (c['id'], m_id))

    conn.commit()
    conn.close()
    return all_clusters
