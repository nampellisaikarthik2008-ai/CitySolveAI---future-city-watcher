import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';import {NavLink,Routes,Route,useNavigate,useParams} from 'react-router-dom';import {Activity,Bus as BusIcon,MapPin,AlertTriangle,CloudRain,Menu,Search,Camera,ChevronRight,Radio,Play,Pause,RotateCcw,Navigation,BrainCircuit,Signal,CheckCircle2,Download,Upload,X,Layers,Gauge,Users,Bell,Flame,ShieldCheck,AlertOctagon,Compass,Send,ExternalLink} from 'lucide-react';import {MapContainer,TileLayer,Marker,Popup,CircleMarker} from 'react-leaflet';import L from 'leaflet';import {BarChart,Bar,ResponsiveContainer,XAxis,YAxis,Tooltip,AreaChart,Area,PieChart,Pie,Cell} from 'recharts';import {buses as initialBuses,incidents as initialIncidents,ago} from './data/mockData';import {Bus,Incident,IncidentStatus,Severity} from './data/types';import 'leaflet/dist/leaflet.css';

const API_BASE = 'http://localhost:8000';
const WS_BASE = 'ws://localhost:8000/ws/telemetry';

const colors:any={low:'#4cbf91',medium:'#f0b44b',high:'#f66c62',critical:'#ff3d59',active:'#3ce6a1',idle:'#f0b44b',maintenance:'#9b8cff',offline:'#6f7b91',Detected:'#ff6577',Verified:'#efb552',Reported:'#47afea',Assigned:'#a58dff',Resolved:'#44c99a'};
const routes=[[12.936,77.58],[12.942,77.59],[12.95,77.603],[12.962,77.611],[12.971,77.605],[12.968,77.59],[12.956,77.578],[12.944,77.568]];
const cameraNames=['Front Camera','Rear Camera','Left Camera','Right Camera','Cabin Camera'];

export interface Cluster {
  id: string;
  type: string;
  severity: Severity;
  lat: number;
  lng: number;
  area: string;
  incident_count: number;
  verified_by_buses: string[];
  status: IncidentStatus;
  created_at: string;
  sla_deadline: string;
}

type Sim={running:boolean;demo:boolean;frames:number;last?:Incident;toast?:Incident;backendOnline:boolean};
type Store={
  buses:Bus[];
  incidents:Incident[];
  clusters:Cluster[];
  sim:Sim;
  toggle:()=>void;
  reset:()=>void;
  demo:()=>void;
  advance:(id:string)=>void;
  refreshClusters:()=>void;
  inspectImage:(base64:string,busId?:string,area?:string)=>Promise<any>;
};

const C=createContext<Store>(null!);
const useStore=()=>useContext(C);

function icon(type:'bus'|'incident'|'cluster',color:string){
  return L.divIcon({
    className:'leaflet-marker',
    html:`<span class="${type==='bus'?'bus':type==='cluster'?'cluster':'incident'}" style="--marker:${color}">${type==='bus'?'🚌':type==='cluster'?'⬢':'●'}</span>`,
    iconSize:[28,28],
    iconAnchor:[14,14]
  });
}

function Provider({children}:{children:any}){
  const[bs,setBs]=useState<Bus[]>(initialBuses);
  const[ins,setIns]=useState<Incident[]>(initialIncidents);
  const[clusters,setClusters]=useState<Cluster[]>([]);
  const[sim,setSim]=useState<Sim>({running:false,demo:false,frames:184921,backendOnline:false});
  const tick=useRef(0);
  const wsRef=useRef<WebSocket|null>(null);

  const demoEvents=[
    ['BUS-104','Pothole','high','Front Camera','MG Road'],
    ['BUS-102','Traffic congestion','medium','Front Camera','Metro Station'],
    ['BUS-105','Waterlogging','critical','Left Camera','Koramangala 5th Block'],
    ['BUS-101','Damaged traffic sign','high','Rear Camera','Civic Square'],
    ['BUS-104','Pedestrian safety risk','critical','Front Camera','Lake View Junction']
  ];

  const fetchAll=()=>{
    fetch(`${API_BASE}/api/buses`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(d&&d.length){setBs(d);setSim(s=>({...s,backendOnline:true}));}})
      .catch(()=>{});

    fetch(`${API_BASE}/api/incidents`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(d&&d.length)setIns(d);})
      .catch(()=>{});

    fetch(`${API_BASE}/api/clusters`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(d&&d.length)setClusters(d);})
      .catch(()=>{});
  };

  useEffect(()=>{fetchAll();},[]);

  useEffect(()=>{
    let ws:WebSocket;
    try {
      ws=new WebSocket(WS_BASE);
      wsRef.current=ws;
      ws.onopen=()=>setSim(s=>({...s,backendOnline:true}));
      ws.onmessage=(e)=>{
        try {
          const data=JSON.parse(e.data);
          if(data.type==='TELEMETRY_UPDATE'){
            if(data.buses&&data.buses.length){
              setBs(prev=>prev.map(b=>{
                const found=data.buses.find((x:any)=>x.id===b.id);
                return found?{...b,...found}:b;
              }));
            }
            if(data.frames)setSim(s=>({...s,frames:data.frames}));
            if(data.newIncident){
              setIns(prev=>[data.newIncident,...prev]);
              setSim(s=>({...s,last:data.newIncident,toast:data.newIncident}));
              setTimeout(()=>setSim(s=>({...s,toast:undefined})),5000);
            }
          }
        }catch(err){}
      };
      ws.onclose=()=>setSim(s=>({...s,backendOnline:false}));
    } catch(err){}
    return()=>{if(ws)ws.close();};
  },[]);

  const newIncident=(spec?:any)=>{
    const b=bs.find(x=>x.id===(spec?.[0]||bs[(tick.current*3)%6].id))||bs[0];
    const type=spec?.[1]||['Pothole','Road damage','Traffic congestion','Waterlogging','Damaged traffic sign','Missing zebra crossing','Vehicle density'][tick.current%7];
    const sev=spec?.[2] as Severity||(['medium','high','critical'] as Severity[])[tick.current%3];
    const cam=spec?.[3]||cameraNames[tick.current%5];
    const area=spec?.[4]||b.area;
    const n:Incident={
      id:`INC-26-${String(initialIncidents.length+tick.current+1).padStart(3,'0')}`,
      type,severity:sev,confidence:84+(tick.current*3)%15,
      busId:b.id,camera:cam,lat:b.lat,lng:b.lng,area,
      timestamp:new Date().toISOString(),status:'Detected',
      image:'SIMULATED AI FRAME',simulated:true
    };
    setIns(v=>[n,...v]);
    setBs(v=>v.map(x=>x.id===b.id?{...x,detections:x.detections+1}:x));
    setSim(s=>({...s,last:n,toast:n}));
    setTimeout(()=>setSim(s=>({...s,toast:undefined})),5000);

    fetch(`${API_BASE}/api/incidents`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        type:n.type,severity:n.severity,confidence:n.confidence,
        busId:n.busId,camera:n.camera,lat:n.lat,lng:n.lng,area:n.area,image:n.image
      })
    }).catch(()=>{});
  };

  useEffect(()=>{
    if(!sim.running)return;
    if(wsRef.current&&wsRef.current.readyState===WebSocket.OPEN){
      wsRef.current.send(JSON.stringify({action:'start'}));
    }
    const id=setInterval(()=>{
      tick.current++;
      setBs(v=>v.map((b,i)=>{
        if(i>5)return b;
        const p=routes[(tick.current+i*2)%routes.length],q=routes[(tick.current+i*2+1)%routes.length];
        const t=(tick.current%4+1)/5;
        return {...b,lat:p[0]+(q[0]-p[0])*t,lng:p[1]+(q[1]-p[1])*t,speed:22+(i*5+tick.current)%24,direction:['Northbound','Eastbound','Southbound','Westbound'][tick.current%4],updated:new Date().toISOString()};
      }));
      setSim(s=>({...s,frames:s.frames+Math.floor(85+Math.random()*80)}));
      if(tick.current%5===0)newIncident(sim.demo?demoEvents[(tick.current/5-1)%demoEvents.length]:undefined);
    },1800);
    return()=>{
      clearInterval(id);
      if(wsRef.current&&wsRef.current.readyState===WebSocket.OPEN){
        wsRef.current.send(JSON.stringify({action:'pause'}));
      }
    };
  },[sim.running,sim.demo,bs]);

  const reset=()=>{
    tick.current=0;
    fetch(`${API_BASE}/api/simulation/reset`,{method:'POST'})
      .then(()=>fetchAll())
      .catch(()=>{setBs(initialBuses);setIns(initialIncidents);});
    setSim(s=>({...s,running:false,demo:false,frames:184921}));
  };

  const advance=(id:string)=>{
    const currentInc=ins.find(x=>x.id===id);
    const stages:IncidentStatus[]=['Detected','Verified','Reported','Assigned','Resolved'];
    const curIdx=stages.indexOf(currentInc?.status||'Detected');
    const nextStatus=stages[Math.min(4,curIdx+1)];

    setIns(v=>v.map(x=>x.id===id?{...x,status:nextStatus}:x));
    fetch(`${API_BASE}/api/incidents/${id}/status`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({status:nextStatus})
    })
    .then(()=>fetch(`${API_BASE}/api/clusters`).then(r=>r.ok?r.json():null).then(d=>{if(d)setClusters(d);}))
    .catch(()=>{});
  };

  const refreshClusters=()=>{
    fetch(`${API_BASE}/api/clusters`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(d)setClusters(d);})
      .catch(()=>{});
  };

  const inspectImage=async(base64:string,busId='BUS-104',area='MG Road')=>{
    const res=await fetch(`${API_BASE}/api/ai/inspect`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({image_base64:base64,busId,area})
    });
    const data=await res.json();
    fetchAll();
    return data;
  };

  return (
    <C.Provider value={{
      buses:bs,incidents:ins,clusters,sim,
      toggle:()=>setSim(s=>({...s,running:!s.running,demo:false})),
      reset,demo:()=>setSim(s=>({...s,running:true,demo:true})),
      advance,refreshClusters,inspectImage
    }}>
      {children}
    </C.Provider>
  );
}

function Badge({value}:{value:string}){
  return <span className="badge" style={{color:colors[value]||'#9cb3cc',borderColor:(colors[value]||'#9cb3cc')+'66'}}><i style={{background:colors[value]||'#9cb3cc'}}/>{value}</span>;
}

const nav=[
  ['/','Overview',Activity],
  ['/fleet','Buses',BusIcon],
  ['/incidents','Incidents',AlertTriangle],
  ['/analytics','Analytics',Radio],
  ['/driver-hud','Driver HUD',Gauge],
  ['/citizen-portal','Citizen Portal',Users]
];

function VisionTesterModal({onClose}:{onClose:()=>void}){
  const{inspectImage}=useStore();
  const[imagePreview,setImagePreview]=useState<string|null>(null);
  const[loading,setLoading]=useState(false);
  const[result,setResult]=useState<any>(null);

  const handleFile=(e:any)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=(evt)=>{
      const b64=evt.target?.result as string;
      setImagePreview(b64);
      setResult(null);
    };
    reader.readAsDataURL(file);
  };

  const handlePreset=(preset:'pothole'|'waterlog')=>{
    const canvas=document.createElement('canvas');
    canvas.width=640;canvas.height=480;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#2b2d30';ctx.fillRect(0,0,640,480);
    ctx.strokeStyle='#f8fafc';ctx.lineWidth=6;ctx.setLineDash([30,20]);
    ctx.beginPath();ctx.moveTo(320,160);ctx.lineTo(320,480);ctx.stroke();
    ctx.strokeStyle='#facc15';ctx.lineWidth=4;ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(80,160);ctx.lineTo(10,480);ctx.stroke();
    ctx.beginPath();ctx.moveTo(560,160);ctx.lineTo(630,480);ctx.stroke();

    if(preset==='pothole'){
      ctx.fillStyle='#0f1113';ctx.beginPath();
      ctx.ellipse(360,340,65,40,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#1e2022';ctx.lineWidth=5;ctx.stroke();
    }else{
      ctx.fillStyle='#1e3a5f';ctx.beginPath();
      ctx.ellipse(340,350,110,50,-0.1,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#38bdf8';ctx.lineWidth=2;ctx.stroke();
    }
    const b64=canvas.toDataURL('image/jpeg');
    setImagePreview(b64);
    setResult(null);
  };

  const runDetection=async()=>{
    if(!imagePreview)return;
    setLoading(true);
    try{
      const res=await inspectImage(imagePreview);
      setResult(res);
    }catch(err){
      alert('Backend AI inspection failed. Make sure backend is running.');
    }finally{
      setLoading(false);
    }
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.65)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{background:'#fff',borderRadius:8,maxWidth:680,width:'100%',padding:24,boxShadow:'0 20px 25px -5px rgba(0,0,0,0.1)',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div>
            <h2 style={{margin:0,fontSize:18,fontWeight:600}}>AI Road Hazard Vision Tester</h2>
            <small style={{color:'#6b7280'}}>Test real computer vision inference on road dashcam frames</small>
          </div>
          <button onClick={onClose} style={{border:0,background:'none',cursor:'pointer',color:'#6b7280'}}><X size={20}/></button>
        </div>

        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          <label style={{display:'inline-flex',alignItems:'center',gap:6,background:'#2563eb',color:'#fff',padding:'8px 12px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            <Upload size={13}/> Upload Road Photo
            <input type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/>
          </label>
          <button onClick={()=>handlePreset('pothole')} style={{display:'inline-flex',alignItems:'center',gap:5,background:'#f3f4f6',border:'1px solid #d1d5db',padding:'8px 12px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            🛣️ Preset: Pothole Crater
          </button>
          <button onClick={()=>handlePreset('waterlog')} style={{display:'inline-flex',alignItems:'center',gap:5,background:'#f3f4f6',border:'1px solid #d1d5db',padding:'8px 12px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            🌧️ Preset: Waterlogged Road
          </button>
          {imagePreview&&<button onClick={runDetection} disabled={loading} style={{display:'inline-flex',alignItems:'center',gap:6,background:'#16a34a',color:'#fff',border:0,padding:'8px 14px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer',marginLeft:'auto'}}>
            {loading?'Analyzing Frame...':'▶ Run AI Detection'}
          </button>}
        </div>

        {imagePreview?(
          <div style={{position:'relative',width:'100%',maxHeight:340,background:'#111827',borderRadius:6,overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <img src={imagePreview} alt="Road Frame" style={{maxWidth:'100%',maxHeight:340,objectFit:'contain',display:'block'}}/>
            {result?.detections?.map((d:any,i:number)=>(
              <div key={i} style={{
                position:'absolute',
                top:`${d.box.ymin*100}%`,left:`${d.box.xmin*100}%`,
                width:`${(d.box.xmax-d.box.xmin)*100}%`,height:`${(d.box.ymax-d.box.ymin)*100}%`,
                border:'2px solid #ef4444',background:'rgba(239,68,68,0.2)',pointerEvents:'none'
              }}>
                <span style={{position:'absolute',top:-22,left:0,background:'#dc2626',color:'#fff',fontSize:10,padding:'2px 6px',fontWeight:700,borderRadius:2}}>
                  {d.type.toUpperCase()} ({d.confidence}%)
                </span>
              </div>
            ))}
          </div>
        ):(
          <div style={{height:220,border:'2px dashed #d1d5db',borderRadius:6,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#9ca3af',gap:8}}>
            <Camera size={36}/>
            <span>Upload a photo or click one of the quick presets above</span>
          </div>
        )}

        {result&&(
          <div style={{marginTop:16,padding:12,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <b style={{color:'#15803d',fontSize:12}}>✓ Hazard Detected & Saved to Municipal Database!</b>
              <div style={{fontSize:11,color:'#4b5563',marginTop:2}}>
                Identified: <b>{result.detections[0]?.type}</b> · Confidence: {result.detections[0]?.confidence}% · Incident: {result.detections[0]?.incident_id}
              </div>
            </div>
            <Badge value={result.detections[0]?.severity}/>
          </div>
        )}
      </div>
    </div>
  );
}

function AlertsDrawer({onClose}:{onClose:()=>void}){
  const{clusters}=useStore();
  const[history,setHistory]=useState<any[]>([]);
  const[dispatching,setDispatching]=useState(false);

  useEffect(()=>{
    fetch(`${API_BASE}/api/alerts/history`)
      .then(r=>r.ok?r.json():[])
      .then(d=>setHistory(d))
      .catch(()=>{});
  },[]);

  const handleDispatchTop=async()=>{
    if(!clusters.length)return;
    const topClust=clusters[0];
    setDispatching(true);
    try {
      const res=await fetch(`${API_BASE}/api/alerts/dispatch`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          clusterId:topClust.id,
          engineerName:'Er. R. Venkatesh',
          ward:'BBMP East Zone Ward 112',
          phone:'+91 98450 12847',
          channel:'WhatsApp'
        })
      });
      const data=await res.json();
      setHistory(prev=>[data,...prev]);
    }catch(err){}
    finally{setDispatching(false);}
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-content" onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div>
            <h2 style={{margin:0,fontSize:18,fontWeight:600}}>Ward Safety Alerts</h2>
            <small style={{color:'#6b7280'}}>Automated WhatsApp / SMS Dispatches to Field Engineers</small>
          </div>
          <button onClick={onClose} style={{border:0,background:'none',cursor:'pointer',color:'#6b7280'}}><X size={20}/></button>
        </div>

        <button 
          onClick={handleDispatchTop}
          disabled={dispatching||!clusters.length}
          style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'#dc2626',color:'#fff',border:0,padding:'11px',borderRadius:6,fontWeight:600,fontSize:12,cursor:'pointer',marginBottom:18}}
        >
          <Send size={14}/> {dispatching?'Sending Dispatch...':'⚡ Send Live Alert for Critical Cluster'}
        </button>

        <h3 style={{fontSize:13,color:'#374151',margin:'0 0 10px'}}>Recent Dispatches Log ({history.length})</h3>
        {history.length?history.map((h,i)=>(
          <div className="dispatch-card" key={i}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <b>{h.recipient||h.engineer_name}</b>
              <span className="badge" style={{color:'#15803d',borderColor:'#bbf7d0'}}>{h.channel}</span>
            </div>
            <small>{h.ward} · SLA: {h.slaHours||h.sla_hours} hours</small>
            <p>{h.message}</p>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
              <small style={{color:'#9ca3af'}}>{new Date(h.timestamp).toLocaleTimeString()}</small>
              {h.googleMapsLink&&<a href={h.googleMapsLink} target="_blank" rel="noreferrer" style={{color:'#2563eb',textDecoration:'none',fontSize:11,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                Google Maps <ExternalLink size={11}/>
              </a>}
            </div>
          </div>
        )):(
          <div style={{textAlign:'center',padding:40,color:'#9ca3af',fontSize:12}}>
            Click above to trigger a live emergency dispatch to the jurisdictional ward engineer.
          </div>
        )}
      </div>
    </div>
  );
}

function Shell({children}:{children:any}){
  const[small,setSmall]=useState(false);
  const[showTester,setShowTester]=useState(false);
  const[showAlerts,setShowAlerts]=useState(false);
  const{sim}=useStore();
  const navigate=useNavigate();

  return (
    <div className={small?'shell compact':'shell'}>
      <aside>
        <div className="brand">
          <span className="brandmark">◈</span><b>URBAN<span>VISTA</span></b>
          <button onClick={()=>setSmall(!small)}><Menu/></button>
        </div>
        <div className="nav">
          {nav.map(([to,label,Icon]:any)=><NavLink end={to==='/'} to={to} key={to}><Icon/><span>{label}</span></NavLink>)}
        </div>
        <div className="asidefoot">
          <span className={sim.backendOnline?'pulse':'pulse muted'}/> {sim.backendOnline?'FastAPI + SQLite Live':'Local Prototype Fallback'}<br/>
          <small>{sim.running?'Simulated telemetry active':'Bengaluru City Grid'}</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p>Municipal Intelligence Network</p>
            <h1>UrbanVista</h1>
          </div>
          <div className="headeractions">
            <button className="alert-pill" onClick={()=>setShowAlerts(true)} title="View Automated Ward Dispatches">
              <Bell size={13}/><span>🚨 Ward Alerts</span>
            </button>
            <a href={`${API_BASE}/api/export/work-order`} download="UrbanVista_PWD_Work_Order.csv" style={{textDecoration:'none'}} title="Download PWD Contractor Work Order CSV">
              <button className="headersearch" style={{width:'auto',cursor:'pointer',color:'#2563eb',borderColor:'#bfdbfe',background:'#eff6ff'}} aria-label="Export PWD Work Order">
                <Download size={14}/><span>Export Work Order</span>
              </button>
            </a>
            <button className="headersearch" onClick={()=>setShowTester(true)} style={{width:'auto',cursor:'pointer',color:'#7c3aed',borderColor:'#ddd6fe',background:'#f5f3ff'}} aria-label="Test AI Vision Model">
              <BrainCircuit size={14}/><span>AI Vision Tester</span>
            </button>
            <button className="headersearch" onClick={()=>navigate('/incidents')} aria-label="Open incident management">
              <Search/><span>Search incidents</span>
            </button>
            <div className="admin">
              <b>A</b><span>Admin<small>Municipal Officer</small></span>
            </div>
          </div>
        </header>
        {children}
        {showTester&&<VisionTesterModal onClose={()=>setShowTester(false)}/>}
        {showAlerts&&<AlertsDrawer onClose={()=>setShowAlerts(false)}/>}
      </main>
    </div>
  );
}

function Stat({label,value,icon:Icon,tone}:{label:string;value:number|string;icon:any;tone:string}){
  return <div className="stat"><div className={'icon '+tone}><Icon/></div><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function CityMap({focus,showClusters=false}:{focus?:Incident;showClusters?:boolean}){
  const{buses,incidents,clusters}=useStore();
  const nav=useNavigate();
  const[viewMode,setViewMode]=useState<'pins'|'heat'|'clusters'>(showClusters?'clusters':'pins');
  const shown=focus?[focus]:incidents;

  return (
    <div className="realmap">
      {!focus&&(
        <div className="map-switcher">
          <button className={viewMode==='pins'?'active':''} onClick={()=>setViewMode('pins')}>📌 Pins</button>
          <button className={viewMode==='heat'?'active':''} onClick={()=>setViewMode('heat')}><Flame size={12}/> Heatmap</button>
          <button className={viewMode==='clusters'?'active':''} onClick={()=>setViewMode('clusters')}><Layers size={12}/> Clusters</button>
        </div>
      )}

      {viewMode==='heat'&&!focus&&(
        <div style={{position:'absolute',top:12,left:12,zIndex:500}} className="heat-scale">
          <span>Density:</span>
          <div className="heat-gradient-bar"/>
          <span>Low → High Risk</span>
        </div>
      )}

      <MapContainer center={[12.954,77.594]} zoom={12} scrollWheelZoom style={{height:'100%',width:'100%'}}>
        <TileLayer attribution="© OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
        
        {/* Buses */}
        {!focus&&buses.filter(b=>b.status==='active'||b.id<='BUS-106').map(b=>(
          <Marker position={[b.lat,b.lng]} icon={icon('bus',colors[b.status])} key={b.id}>
            <Popup>
              <b>{b.id}</b><br/>{b.route}<br/>Status: {b.status}<br/>
              {b.speed} km/h · {b.area}<br/>Today's detections: {b.detections}<br/>
              <button onClick={()=>nav('/fleet/'+b.id)}>Open bus profile</button>
            </Popup>
          </Marker>
        ))}

        {/* View mode 1: Heatmap Circles */}
        {viewMode==='heat'&&!focus&&incidents.slice(0,60).map((x,i)=>(
          <CircleMarker
            center={[x.lat,x.lng]}
            radius={x.severity==='critical'?34:(x.severity==='high'?26:18)}
            pathOptions={{
              color:colors[x.severity],
              fillColor:colors[x.severity],
              fillOpacity:0.35,
              weight:0
            }}
            key={`heat-${i}`}
          >
            <Popup>
              <b>Hazard Density Hotspot</b><br/>
              {x.type} · <span style={{color:colors[x.severity]}}>{x.severity.toUpperCase()}</span><br/>
              Area: {x.area}
            </Popup>
          </CircleMarker>
        ))}

        {/* View mode 2: Deduplicated Clusters */}
        {viewMode==='clusters'&&!focus&&clusters.map(c=>(
          <Marker position={[c.lat,c.lng]} icon={icon('cluster',colors[c.severity])} key={c.id}>
            <Popup>
              <b>{c.id} · {c.type}</b><br/>
              <span style={{color:colors[c.severity]}}>{c.severity.toUpperCase()}</span> · {c.incident_count} reports<br/>
              Area: {c.area}<br/>
              SLA Deadline: {new Date(c.sla_deadline).toLocaleString()}<br/>
              Status: {c.status}
            </Popup>
          </Marker>
        ))}

        {/* View mode 3: Normal Incident Markers */}
        {(viewMode==='pins'||focus)&&shown.map(x=>(
          <Marker position={[x.lat,x.lng]} icon={icon('incident',colors[x.severity])} key={x.id}>
            <Popup>
              <b>{x.id} · {x.type}</b><br/>
              <span style={{color:colors[x.severity]}}>{x.severity.toUpperCase()}</span> · {x.confidence}%<br/>
              Bus: {x.busId} · {new Date(x.timestamp).toLocaleTimeString()}<br/>
              {x.area} · {x.status}<br/>
              <button onClick={()=>nav('/incidents/'+x.id)}>Open incident</button>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <div className="maplabel">
        BENGALURU · {viewMode==='heat'?'HAZARD DENSITY HEATMAP':(viewMode==='clusters'?'DBSCAN DEDUPLICATED ASSETS':'FLEET GPS OVERVIEW')}
      </div>
      <div className="maplegend">
        <span>🚌 Active buses</span>
        <span>● Critical</span>
        <span>● High</span>
        <span>● Medium</span>
        <span>● Resolved</span>
      </div>
    </div>
  );
}

function SimControls(){
  const{sim,toggle,reset,demo}=useStore();
  return (
    <div className="simcontrols">
      <button className="start" onClick={toggle}>
        {sim.running?<><Pause/> PAUSE SIMULATION</>:<><Play/> START LIVE SIMULATION</>}
      </button>
      <button onClick={demo}><Play/> DEMO MODE</button>
      <button onClick={reset}><RotateCcw/> RESET DEMO</button>
    </div>
  );
}

function Detection({item}:{item:Incident}){
  const nav=useNavigate();
  return (
    <button className="detection" onClick={()=>nav('/incidents/'+item.id)}>
      <span className="detecticon" style={{background:colors[item.severity]}}><AlertTriangle/></span>
      <span>
        <b>{item.type}{item.simulated&&<em className="simtag"> NEW</em>}</b>
        <small>{item.area} · {ago(item.timestamp)} · {item.busId}</small>
      </span>
      <Badge value={item.severity}/>
      <ChevronRight/>
    </button>
  );
}

function Dashboard(){
  const{buses,incidents,clusters,sim}=useStore();
  const nav=useNavigate();
  const today=incidents.filter(i=>Date.now()-new Date(i.timestamp).getTime()<86400000);
  const active=incidents.filter(i=>i.status!=='Resolved');

  return (
    <>
      <div className="overviewtitle">
        <div>
          <small>CITY OPERATIONS</small>
          <h2>City Overview</h2>
        </div>
        <SimControls/>
      </div>

      <section className="stats overviewstats">
        <Stat label="ACTIVE BUSES" value={buses.filter(b=>b.status==='active').length} icon={BusIcon} tone="blue"/>
        <Stat label="RAW INCIDENTS" value={today.length} icon={AlertTriangle} tone="red"/>
        <Stat label="DEDUPLICATED ASSETS" value={clusters.length||active.length} icon={Layers} tone="purple"/>
        <Stat label="CRITICAL INCIDENTS" value={active.filter(i=>i.severity==='critical').length} icon={AlertTriangle} tone="red"/>
      </section>

      <section className="panel heroMap">
        <div className="panelhead">
          <div>
            <small>SIMULATED GPS + DENSITY ENGINE</small>
            <h2>Fleet and incident map</h2>
          </div>
          <Badge value={sim.running?'active':'idle'}/>
        </div>
        <CityMap/>
      </section>

      <section className="overviewsection panel">
        <div className="panelhead">
          <div>
            <small>FLEET STATUS</small>
            <h2>Active Buses</h2>
          </div>
          <button className="textbutton" onClick={()=>nav('/fleet')}>View complete fleet</button>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>BUS ID</th><th>ROUTE</th><th>STATUS</th><th>SPEED</th><th>CURRENT LOCATION</th><th>GPS</th><th>AI DETECTIONS</th><th>ACTION</th></tr>
            </thead>
            <tbody>
              {buses.filter(b=>b.status==='active').slice(0,6).map(b=>(
                <tr key={b.id} onClick={()=>nav('/fleet/'+b.id)}>
                  <td><b>{b.id}</b></td>
                  <td>{b.route}</td>
                  <td><Badge value={b.status}/></td>
                  <td>{b.speed} km/h</td>
                  <td>{b.area}</td>
                  <td><span className="gps">● Locked</span></td>
                  <td>{b.detections}</td>
                  <td><button className="rowaction">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overviewlower">
        <div className="panel">
          <div className="panelhead">
            <div>
              <small>AI DETECTION STREAM</small>
              <h2>Recent AI Detections</h2>
            </div>
            <span className="count">{incidents.length}</span>
          </div>
          <div className="detectiontable">
            {incidents.slice(0,6).map(x=>(
              <button onClick={()=>nav('/incidents/'+x.id)} key={x.id}>
                <span>{new Date(x.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                <b>{x.type}</b>
                <span>{x.busId}</span>
                <span>{x.camera}</span>
                <span>{x.confidence}%</span>
                <Badge value={x.severity}/>
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelhead">
            <div>
              <small>REQUIRES ACTION</small>
              <h2>Active Incidents</h2>
            </div>
            <button className="textbutton" onClick={()=>nav('/incidents')}>View all</button>
          </div>
          {active.slice(0,6).map(x=><Detection item={x} key={x.id}/>)}
        </div>
      </section>

      <section className="engine panel">
        <div>
          <div className="engineicon"><BrainCircuit/></div>
          <small>AI DETECTION ENGINE · FASTAPI + SQLITE POWERED</small>
          <h2>UrbanVision Edge Pipeline <Badge value={sim.backendOnline?'active':'idle'}/></h2>
          <p>Multi-camera edge vision simulator linked with DBSCAN spatial deduplication and PWD contractor dispatch SLA tracking.</p>
        </div>
        <div><small>CAMERA STREAMS</small><strong>18</strong></div>
        <div><small>FRAMES PROCESSED</small><strong>{sim.frames.toLocaleString()}</strong></div>
        <div><small>DEDUPLICATED CLUSTERS</small><strong>{clusters.length}</strong></div>
        <div className="process">
          <small>PROCESSING FLOW</small>
          <span>Camera Feed</span><ChevronRight/>
          <span>AI Analysis</span><ChevronRight/>
          <span>Spatial Clustering</span><ChevronRight/>
          <b>Work Order Dispatched</b>
        </div>
      </section>
    </>
  );
}

function Title({title,desc}:{title:string;desc:string}){
  return (
    <div className="title">
      <div>
        <small>URBANVISTA / COMMAND CENTER</small>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      <span className="prototype">FASTAPI CONNECTED</span>
    </div>
  );
}

function Fleet(){
  const{buses}=useStore();
  const nav=useNavigate();
  const[q,setQ]=useState('');
  const[s,setS]=useState('all');
  const[c,setC]=useState('all');

  const rows=buses.filter(b=>(s==='all'||b.status===s)&&(c==='all'||Object.values(b.cameras).includes(c as any))&&(b.id+b.route+b.area).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <Title title="Bus Fleet" desc="Complete fleet telemetry, speed, camera diagnostics and simulated GPS tracking"/>
      <section className="stats fleetstats">
        <Stat label="TOTAL BUSES" value={buses.length} icon={BusIcon} tone="blue"/>
        <Stat label="ACTIVE" value={buses.filter(b=>b.status==='active').length} icon={Activity} tone="blue"/>
        <Stat label="OFFLINE" value={buses.filter(b=>b.status==='offline').length} icon={AlertTriangle} tone="red"/>
        <Stat label="PROCESSING" value={buses.filter(b=>Object.values(b.cameras).includes('degraded')).length} icon={Camera} tone="amber"/>
      </section>

      <div className="filters">
        <Search/>
        <input placeholder="Search bus, route or location" value={q} onChange={e=>setQ(e.target.value)}/>
        <select value={s} onChange={e=>setS(e.target.value)}>
          <option value="all">All statuses</option>
          {['active','idle','maintenance','offline'].map(x=><option key={x}>{x}</option>)}
        </select>
        <select onChange={e=>setC(e.target.value)} value={c}>
          <option value="all">All cameras</option>
          <option value="online">Camera online</option>
          <option value="degraded">Camera processing</option>
          <option value="offline">Camera offline</option>
        </select>
      </div>

      <div className="panel tablewrap">
        <table>
          <thead>
            <tr><th>BUS ID</th><th>ROUTE</th><th>STATUS</th><th>SPEED</th><th>CURRENT LOCATION</th><th>GPS</th><th>CAMERAS</th><th>TODAY'S DETECTIONS</th><th>LAST ACTIVE</th><th>ACTION</th></tr>
          </thead>
          <tbody>
            {rows.map(b=>(
              <tr onClick={()=>nav('/fleet/'+b.id)} key={b.id}>
                <td><b>{b.id}</b></td>
                <td>{b.route}</td>
                <td><Badge value={b.status}/></td>
                <td>{b.speed} km/h <small>{b.direction}</small></td>
                <td><MapPin size={13}/>{b.area}</td>
                <td><span className="gps">● Locked</span></td>
                <td><span className="camdots">{Object.values(b.cameras).map((x,i)=><i key={i} style={{background:colors[x==='online'?'active':x==='offline'?'offline':'medium']}}/>)}</span></td>
                <td>{b.detections}</td>
                <td>{ago(b.updated)}</td>
                <td><button className="rowaction">Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BusProfile(){
  const{id=''}=useParams();
  const{buses,incidents,sim}=useStore();
  const[tab,setTab]=useState('Overview');
  const[historyQ,setHistoryQ]=useState('');
  const[historyType,setHistoryType]=useState('all');
  const[historySeverity,setHistorySeverity]=useState('all');
  const[historyCamera,setHistoryCamera]=useState('all');
  const[historyStatus,setHistoryStatus]=useState('all');

  const b=buses.find(x=>x.id===id);
  if(!b)return <div>Bus not found</div>;

  const detections=incidents.filter(i=>i.busId===id);
  const historyRows=detections.filter(i=>(historyType==='all'||i.type===historyType)&&(historySeverity==='all'||i.severity===historySeverity)&&(historyCamera==='all'||i.camera===historyCamera)&&(historyStatus==='all'||i.status===historyStatus)&&(i.id+i.type+i.area).toLowerCase().includes(historyQ.toLowerCase()));
  const last24=detections.filter(i=>Date.now()-new Date(i.timestamp).getTime()<86400000);
  const data=Object.entries(detections.reduce((a:any,x)=>{a[x.type]=(a[x.type]||0)+1;return a},{})).map(([name,value])=>({name,value}));
  const nav=useNavigate();

  const list=(rows:Incident[],history=false)=>(
    <div className="panel tablewrap">
      <table>
        <thead>
          <tr><th>TIME</th>{history&&<th>DATE</th>}<th>CAMERA</th><th>DETECTION</th><th>CONFIDENCE</th><th>LOCATION</th><th>SEVERITY</th><th>INCIDENT ID</th>{history&&<th>STATUS</th>}</tr>
        </thead>
        <tbody>
          {rows.length?rows.map(x=>(
            <tr onClick={()=>nav('/incidents/'+x.id)} key={x.id}>
              <td>{new Date(x.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
              {history&&<td>{new Date(x.timestamp).toLocaleDateString()}</td>}
              <td>{x.camera}</td>
              <td>{x.type}</td>
              <td>{x.confidence}%</td>
              <td>{x.area}</td>
              <td><Badge value={x.severity}/></td>
              <td><b>{x.id}</b></td>
              {history&&<td><Badge value={x.status}/></td>}
            </tr>
          )):<tr><td colSpan={history?9:7} className="emptycell">No detections match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Title title={b.id} desc={`${b.route} · ${b.status.toUpperCase()} · dedicated bus profile`}/>
      <section className="profiletop">
        <div className="panel identity">
          <div className="vehicleicon"><BusIcon/></div>
          <div><small>BUS INFORMATION</small><h2>{b.id}</h2><Badge value={b.status}/></div>
          <div><small>GROUND SPEED</small><strong>{b.speed}<em> km/h</em></strong><small><Navigation size={11}/>{b.direction}</small></div>
          <div><small>GPS STATUS</small><p><MapPin size={15}/> LOCKED · {b.area}</p></div>
        </div>
        <div className="panel">
          <div className="panelhead"><h3>Camera status</h3><span>Diagnostics</span></div>
          <div className="cameras">
            {Object.entries(b.cameras).map(([k,v])=>(
              <div key={k}>
                <Camera/><small>{k}</small>
                <Badge value={v==='online'?'active':v==='offline'?'offline':'medium'}/>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="tabs">
        {['Overview','Camera Views','Last 24 Hours','Complete History','Statistics'].map(x=>(
          <button className={tab===x?'active':''} onClick={()=>setTab(x)} key={x}>{x}</button>
        ))}
      </div>

      {tab==='Overview'&&<section className="split"><div className="panel chartpanel"><h3>AI Detection Statistics</h3><ResponsiveContainer width="100%" height={260}><BarChart data={data}><XAxis dataKey="name" hide/><YAxis/><Tooltip/><Bar dataKey="value" fill="#2563eb" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div><div className="panel feed"><div className="panelhead"><h3>Recent detections</h3></div>{detections.slice(0,6).map(i=><Detection item={i} key={i.id}/>)}</div></section>}
      {tab==='Camera Views'&&<section className="livefeeds panel"><div className="panelhead"><div><small>CAMERA FEED SIMULATOR</small><h3>Camera Views</h3></div><Badge value={sim.running?'active':'idle'}/></div><div className="feedcards cameraGrid">{cameraNames.map((c,i)=><div className="simfeed" key={c}><div className="feedroad"><span>SIMULATED CAMERA FEED</span><b>{b.id} / {c.toUpperCase()}</b>{sim.running&&i===0&&<div className="scan">POTHOLE · 94% CONFIDENCE</div>}</div><p><Signal size={14}/> {sim.running&&i===0?'AI STATUS: PROCESSING':'AI STATUS: READY'} · Edge Vision Node</p></div>)}</div></section>}
      {tab==='Last 24 Hours'&&<><section className="stats compactstats"><Stat label="TOTAL DETECTIONS" value={last24.length} icon={BrainCircuit} tone="blue"/><Stat label="POTHOLES" value={last24.filter(x=>x.type==='Pothole').length} icon={MapPin} tone="amber"/><Stat label="TRAFFIC" value={last24.filter(x=>x.type.includes('Traffic')).length} icon={AlertTriangle} tone="red"/><Stat label="WATERLOGGING" value={last24.filter(x=>x.type==='Waterlogging').length} icon={CloudRain} tone="blue"/></section>{list(last24)}</>}
      {tab==='Complete History'&&<><div className="filters"><Search/><input placeholder="Search ID, type or location" value={historyQ} onChange={e=>setHistoryQ(e.target.value)}/><select value={historyType} onChange={e=>setHistoryType(e.target.value)}><option value="all">All detection types</option>{Array.from(new Set(detections.map(x=>x.type))).map(x=><option key={x}>{x}</option>)}</select><select value={historySeverity} onChange={e=>setHistorySeverity(e.target.value)}><option value="all">All severities</option>{['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}</select><select value={historyCamera} onChange={e=>setHistoryCamera(e.target.value)}><option value="all">All cameras</option>{Array.from(new Set(detections.map(x=>x.camera))).map(x=><option key={x}>{x}</option>)}</select><select value={historyStatus} onChange={e=>setHistoryStatus(e.target.value)}><option value="all">All statuses</option>{['Detected','Verified','Reported','Assigned','Resolved'].map(x=><option key={x}>{x}</option>)}</select></div><div className="resultbar"><span>{historyRows.length} of {detections.length} records</span><button onClick={()=>{setHistoryQ('');setHistoryType('all');setHistorySeverity('all');setHistoryCamera('all');setHistoryStatus('all')}}>Clear filters</button></div>{list(historyRows,true)}</>}
      {tab==='Statistics'&&<section className="split"><div className="panel chartpanel"><h3>Detection categories</h3><ResponsiveContainer width="100%" height={300}><BarChart data={data}><XAxis dataKey="name" angle={-25} textAnchor="end" height={70}/><YAxis/><Tooltip/><Bar dataKey="value" fill="#2563eb"/></BarChart></ResponsiveContainer></div><div className="panel busstats"><small>TOTAL DETECTIONS</small><strong>{detections.length}</strong><small>AVERAGE AI CONFIDENCE</small><strong>{Math.round(detections.reduce((a,x)=>a+x.confidence,0)/Math.max(1,detections.length))}%</strong><small>CRITICAL EVENTS</small><strong>{detections.filter(x=>x.severity==='critical').length}</strong><small>TOTAL DISTANCE · ESTIMATED</small><strong>{(b.detections*3.4).toFixed(1)} km</strong></div></section>}
    </>
  );
}

function Incidents(){
  const{incidents,clusters,buses}=useStore();
  const nav=useNavigate();
  const[viewMode,setViewMode]=useState<'raw'|'clusters'>('raw');
  const[q,setQ]=useState('');
  const[sev,setSev]=useState('all');
  const[st,setSt]=useState('all');
  const[bus,setBus]=useState('all');

  const rows=incidents.filter(x=>(sev==='all'||x.severity===sev)&&(st==='all'||x.status===st)&&(bus==='all'||x.busId===bus)&&(x.type+x.area+x.id).toLowerCase().includes(q.toLowerCase()));
  const clusterRows=clusters.filter(c=>(sev==='all'||c.severity===sev)&&(st==='all'||c.status===st)&&(c.type+c.area+c.id).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <Title title="Incident Management" desc="All city-wide issues detected across the public transport fleet"/>
      <section className="stats compactstats">
        <Stat label="RAW DETECTIONS" value={incidents.length} icon={AlertTriangle} tone="blue"/>
        <Stat label="DEDUPLICATED ASSETS" value={clusters.length} icon={Layers} tone="purple"/>
        <Stat label="CRITICAL" value={incidents.filter(x=>x.severity==='critical').length} icon={AlertTriangle} tone="red"/>
        <Stat label="UNRESOLVED" value={incidents.filter(x=>x.status!=='Resolved').length} icon={Activity} tone="blue"/>
      </section>

      <div style={{display:'flex',gap:10,marginBottom:14}}>
        <button 
          onClick={()=>setViewMode('raw')}
          style={{padding:'7px 14px',border:'1px solid',borderColor:viewMode==='raw'?'#2563eb':'#d1d5db',background:viewMode==='raw'?'#eff6ff':'#fff',color:viewMode==='raw'?'#2563eb':'#4b5563',borderRadius:5,fontWeight:600,fontSize:12,cursor:'pointer'}}
        >
          Raw Camera Detections ({rows.length})
        </button>
        <button 
          onClick={()=>setViewMode('clusters')}
          style={{padding:'7px 14px',border:'1px solid',borderColor:viewMode==='clusters'?'#7c3aed':'#d1d5db',background:viewMode==='clusters'?'#f5f3ff':'#fff',color:viewMode==='clusters'?'#7c3aed':'#4b5563',borderRadius:5,fontWeight:600,fontSize:12,cursor:'pointer'}}
        >
          ⬢ Spatial Deduplicated Assets ({clusters.length})
        </button>
      </div>

      <div className="filters">
        <Search/>
        <input placeholder="Search ID, type or location" value={q} onChange={e=>setQ(e.target.value)}/>
        <select value={sev} onChange={e=>setSev(e.target.value)}>
          <option value="all">All severities</option>
          {['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}
        </select>
        <select value={st} onChange={e=>setSt(e.target.value)}>
          <option value="all">All statuses</option>
          {['Detected','Verified','Reported','Assigned','Resolved'].map(x=><option key={x}>{x}</option>)}
        </select>
        {viewMode==='raw'&&<select value={bus} onChange={e=>setBus(e.target.value)}>
          <option value="all">All buses</option>
          {buses.map(x=><option key={x.id}>{x.id}</option>)}
        </select>}
      </div>

      <div className="resultbar">
        <span>{viewMode==='raw'?rows.length:clusterRows.length} items shown</span>
        <button onClick={()=>{setQ('');setSev('all');setSt('all');setBus('all')}}>Clear filters</button>
      </div>

      {viewMode==='raw'?(
        <div className="panel tablewrap">
          <table>
            <thead>
              <tr><th>INCIDENT ID</th><th>TIME</th><th>TYPE</th><th>SEVERITY</th><th>LOCATION</th><th>DETECTED BY</th><th>CAMERA</th><th>AI CONFIDENCE</th><th>STATUS</th><th>ACTION</th></tr>
            </thead>
            <tbody>
              {rows.length?rows.map(x=>(
                <tr key={x.id} onClick={()=>nav('/incidents/'+x.id)}>
                  <td><b>{x.id}</b></td>
                  <td>{ago(x.timestamp)}</td>
                  <td>{x.type}</td>
                  <td><Badge value={x.severity}/></td>
                  <td><MapPin size={13}/>{x.area}</td>
                  <td>{x.busId}</td>
                  <td>{x.camera}</td>
                  <td><div className="confidence"><i style={{width:x.confidence+'%'}}/>{x.confidence}%</div></td>
                  <td><Badge value={x.status}/></td>
                  <td><button className="rowaction">Open</button></td>
                </tr>
              )):<tr><td colSpan={10} className="emptycell">No incidents match these filters. Try clearing them.</td></tr>}
            </tbody>
          </table>
        </div>
      ):(
        <div className="panel tablewrap">
          <table>
            <thead>
              <tr><th>ASSET ID</th><th>HAZARD TYPE</th><th>SEVERITY</th><th>LOCATION (GPS CENTROID)</th><th>TOTAL REPORTS</th><th>VERIFIED BY BUSES</th><th>SLA DEADLINE</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {clusterRows.length?clusterRows.map(c=>(
                <tr key={c.id}>
                  <td><b>{c.id}</b></td>
                  <td>{c.type}</td>
                  <td><Badge value={c.severity}/></td>
                  <td><MapPin size={13}/>{c.area} ({c.lat.toFixed(4)}, {c.lng.toFixed(4)})</td>
                  <td><b>{c.incident_count} detections</b></td>
                  <td><small>{Array.isArray(c.verified_by_buses)?c.verified_by_buses.join(', '):c.verified_by_buses}</small></td>
                  <td>{new Date(c.sla_deadline).toLocaleDateString()}</td>
                  <td><Badge value={c.status}/></td>
                </tr>
              )):<tr><td colSpan={8} className="emptycell">No clusters match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function IncidentDetail(){
  const{id=''}=useParams();
  const{incidents,buses,advance}=useStore();
  const b=incidents.find(x=>x.id===id);
  const nav=useNavigate();
  const[auditResult,setAuditResult]=useState<any>(null);
  const[auditing,setAuditing]=useState(false);

  if(!b)return <div>Incident not found</div>;

  const steps=['Detected','Verified','Reported','Assigned','Resolved'];
  const cur=steps.indexOf(b.status);

  const runAudit=async(passed:boolean)=>{
    setAuditing(true);
    try {
      const res=await fetch(`${API_BASE}/api/contractor/verify-repair`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          incidentId:b.id,
          repairPassed:passed,
          notes:passed?'Contractor cold-mix asphalt application complete':'Incomplete repair, depression remains'
        })
      });
      const data=await res.json();
      setAuditResult(data.audit);
      b.status=data.updatedStatus;
    }catch(err){}
    finally{setAuditing(false);}
  };

  return (
    <>
      <Title title={b.id} desc={`${b.type} · SQLite persisted event`}/>
      <section className="detailgrid">
        <div>
          <div className="panel evidence">
            <div className="vision">
              <div className="vision-hud-top">
                <span className="hud-rec"><i/> REC [CAM-01 FRONT-MOUNT]</span>
                <span>1080p 60FPS · ISO 400 · GPS {b.lat.toFixed(4)}°N, {b.lng.toFixed(4)}°E</span>
              </div>
              <div className="bbox">
                <span className="bbox-tag">AI VISION: {b.type.toUpperCase()}</span>
                <AlertTriangle/>
                <b>{b.type}</b>
                <small>{b.confidence}% CONFIDENCE</small>
              </div>
              <div className="vision-hud-bot">
                <span>INFERENCE: YOLO-v8n-RDD2022 · 14ms LATENCY</span>
                <span>SPEED: 36 KM/H · HEADING: NORTHBOUND</span>
              </div>
            </div>
            <div className="evidencemeta">
              <Badge value={b.severity}/>
              <span>Detected by: {b.busId} ({b.camera})</span>
              <span>{new Date(b.timestamp).toLocaleString()}</span>
            </div>
          </div>

          {/* Feature 1: Before & After Repair Audit */}
          <div className="audit-panel">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <small style={{color:'#6b7280',fontWeight:700}}>CLOSED-LOOP CONTRACTOR AUDIT</small>
                <h3 style={{margin:'3px 0 0',fontSize:15}}>Before & After AI Re-Scan Verification</h3>
              </div>
              <Badge value={b.status==='Resolved'?'Resolved':'Assigned'}/>
            </div>

            <div className="audit-grid">
              <div className="audit-frame">
                <div className="audit-frame-label">BEFORE: {b.type.toUpperCase()}</div>
                <div className="audit-surface-before">
                  <div className="crater">
                    <AlertTriangle style={{color:'#ef4444'}} size={20}/>
                  </div>
                  <span style={{position:'absolute',bottom:8,fontSize:10,color:'#f87171',fontWeight:700}}>
                    Depression: 68mm (94% Defect)
                  </span>
                </div>
              </div>
              <div className="audit-frame">
                <div className="audit-frame-label">AFTER: BUS RE-SCAN</div>
                <div className={`audit-surface-after ${auditResult?.status==='VERIFIED_RESOLVED'?'restored':''}`}>
                  {auditResult?.status==='VERIFIED_RESOLVED'?(
                    <>
                      <ShieldCheck style={{color:'#22c55e',marginBottom:4}} size={32}/>
                      <b style={{color:'#22c55e',fontSize:12}}>✓ IRC:SP:20 Compliant Patch</b>
                      <small style={{color:'#86efac',fontSize:10,marginTop:2}}>Surface Quality: 96% · 0mm Depression</small>
                    </>
                  ):(
                    <>
                      <Camera style={{color:'#94a3b8',marginBottom:4}} size={28}/>
                      <span style={{color:'#94a3b8',fontSize:11}}>Awaiting Bus Re-Scan Pass</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {auditResult&&(
              <div style={{padding:12,borderRadius:6,background:auditResult.status==='VERIFIED_RESOLVED'?'#f0fdf4':'#fef2f2',border:'1px solid',borderColor:auditResult.status==='VERIFIED_RESOLVED'?'#bbf7d0':'#fecaca',marginBottom:12}}>
                <b style={{color:auditResult.status==='VERIFIED_RESOLVED'?'#15803d':'#dc2626'}}>
                  {auditResult.status==='VERIFIED_RESOLVED'?'✓ Payment Cleared & Work Order Closed':'⚠️ Repair Rejected - Penalty Applied'}
                </b>
                <p style={{margin:'4px 0 0',fontSize:11,color:'#4b5563'}}>{auditResult.message}</p>
              </div>
            )}

            <div className="audit-actions">
              <button className="pass-btn" disabled={auditing} onClick={()=>runAudit(true)}>
                <ShieldCheck size={14}/> Simulate Bus Re-Scan: Compliant Patch
              </button>
              <button className="fail-btn" disabled={auditing} onClick={()=>runAudit(false)}>
                <AlertOctagon size={14}/> Simulate Bus Re-Scan: Reject Repair
              </button>
            </div>
          </div>

          <div className="panel lifecycle">
            <small>AUTHORITY ACTION WORKFLOW</small>
            <h3>Incident lifecycle</h3>
            <div className="steps">
              {steps.map((x,i)=>(
                <button className={i<=cur?'done':''} disabled={i>cur+1} onClick={()=>i===cur+1&&advance(b.id)} key={x}>
                  <i>{i<cur?'✓':i+1}</i>
                  <span>{x}</span>
                </button>
              ))}
            </div>
            <p className="workflowhint">
              {cur<4?`Next step: ${steps[cur+1]}. Status is stored in backend database.`:'This incident is marked resolved.'}
            </p>
            <button className="workflowaction" disabled={cur===4} onClick={()=>advance(b.id)}>
              {cur<4?`Move to ${steps[cur+1]}`:'Resolved'}
            </button>
          </div>
        </div>

        <div className="sideinfo">
          <div className="panel">
            <small>LOCATION + GPS</small>
            <h3><MapPin/> {b.area}</h3>
            <p>{b.lat.toFixed(5)}, {b.lng.toFixed(5)}</p>
            <CityMap focus={b}/>
          </div>
          <div className="panel">
            <small>DETECTING VEHICLE</small>
            <button className="linkbus" onClick={()=>nav('/fleet/'+b.busId)}>
              <BusIcon/>
              <span><b>{b.busId}</b><small>{buses.find(x=>x.id===b.busId)?.route} · {b.camera}</small></span>
              <ChevronRight/>
            </button>
          </div>
          <div className="panel">
            <small>CURRENT STATE</small>
            <h3><Badge value={b.status}/></h3>
            <p>Persisted in SQLite. Ready for automated contractor dispatch and SLA tracking.</p>
          </div>
        </div>
      </section>
    </>
  );
}

function Analytics(){
  const{incidents,buses,clusters}=useStore();
  const trend=Array.from({length:7},(_,i)=>({d:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],v:incidents.filter(x=>new Date(x.timestamp).getDay()===(i+1)%7).length}));
  const cats=Object.entries(incidents.reduce((a:any,x)=>{a[x.type]=(a[x.type]||0)+1;return a},{})).map(([name,value])=>({name:name.slice(0,12),value}));
  const sev=['low','medium','high','critical'].map(name=>({name,value:incidents.filter(x=>x.severity===name).length}));
  const busData=buses.slice(0,8).map(b=>({name:b.id.slice(-3),value:incidents.filter(x=>x.busId===b.id).length}));
  const areas=Object.entries(incidents.reduce((a:any,x)=>{a[x.area]=(a[x.area]||0)+1;return a},{})).sort((a:any,b:any)=>b[1]-a[1]).slice(0,5);

  return (
    <>
      <Title title="Network Analytics" desc="Dynamic intelligence generated from backend telemetry & spatial deduplication"/>
      <section className="analytics">
        <div className="panel chartpanel wide">
          <div className="panelhead">
            <h3>Detection trend · 7 days</h3>
            <Badge value="realtime"/>
          </div>
          <ResponsiveContainer width="100%" height={255}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="a" x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="#38bdf8" stopOpacity=".4"/>
                  <stop offset="1" stopColor="#38bdf8" stopOpacity="0"/>
                </linearGradient>
              </defs>
              <XAxis dataKey="d"/><YAxis/><Tooltip/>
              <Area dataKey="v" stroke="#38bdf8" fill="url(#a)" strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chartpanel">
          <div className="panelhead">
            <h3>Severity distribution</h3>
            <small>{clusters.length} deduplicated assets</small>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={sev} dataKey="value" nameKey="name" innerRadius={55} outerRadius={83}>
                {sev.map(x=><Cell key={x.name} fill={colors[x.name]}/>)}
              </Pie>
              <Tooltip/>
            </PieChart>
          </ResponsiveContainer>
          <div className="pielegend">
            {sev.map(x=><span key={x.name}><i style={{background:colors[x.name]}}/>{x.name} {x.value}</span>)}
          </div>
        </div>

        <div className="panel chartpanel">
          <h3>Incidents by category</h3>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={cats}>
              <XAxis dataKey="name" angle={-35} textAnchor="end" height={75} tick={{fontSize:10}}/>
              <YAxis/><Tooltip/>
              <Bar dataKey="value" fill="#a78bfa" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel chartpanel">
          <h3>Incidents by bus</h3>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={busData}>
              <XAxis dataKey="name"/><YAxis/><Tooltip/>
              <Bar dataKey="value" fill="#47c6e7" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel hotspot">
          <div className="panelhead">
            <h3>Top incident locations</h3>
            <span>ACTIVE ASSETS</span>
          </div>
          {areas.map(([x,n]:any,i)=>(
            <div key={x}>
              <span className="rank">0{i+1}</span>
              <b>{x}</b>
              <span>{n} incidents</span>
              <Badge value={i<2?'critical':'high'}/>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ==================== FEATURE 5: DRIVER COCKPIT HUD ====================
function DriverHUD(){
  const{buses}=useStore();
  const[selectedBus,setSelectedBus]=useState('BUS-104');
  const[proximity,setProximity]=useState<any>(null);

  useEffect(()=>{
    fetch(`${API_BASE}/api/driver/proximity?busId=${selectedBus}`)
      .then(r=>r.ok?r.json():null)
      .then(d=>setProximity(d))
      .catch(()=>{});
  },[selectedBus]);

  const bus=buses.find(b=>b.id===selectedBus)||buses[0];
  const hazard=proximity?.nearestHazard;

  return (
    <>
      <Title title="Onboard Driver Cockpit" desc="Real-time automotive road safety HUD & proximity hazard radar"/>
      
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <label style={{fontSize:12,fontWeight:600,color:'#4b5563'}}>Active Vehicle:</label>
          <select 
            value={selectedBus} 
            onChange={e=>setSelectedBus(e.target.value)}
            style={{padding:'6px 12px',borderRadius:6,border:'1px solid #d1d5db',font:'600 12px Inter'}}
          >
            {buses.slice(0,6).map(b=><option key={b.id} value={b.id}>{b.id} ({b.route})</option>)}
          </select>
        </div>
        <Badge value={bus?.status||'active'}/>
      </div>

      <div className="cockpit-shell">
        <div className="cockpit-top">
          <div>
            <small style={{color:'#38bdf8',letterSpacing:1,fontWeight:700}}>EDGE SAFETY RADAR</small>
            <h2 style={{margin:'2px 0 0',fontSize:20,color:'#fff'}}>{bus?.id} · {bus?.route}</h2>
          </div>
          <div style={{display:'flex',gap:16,alignItems:'center'}}>
            <div style={{textAlign:'right'}}>
              <small style={{color:'#94a3b8'}}>HEADING</small>
              <div style={{color:'#fff',fontWeight:700,display:'flex',alignItems:'center',gap:4}}>
                <Compass size={14} style={{color:'#38bdf8'}}/> {bus?.direction}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <small style={{color:'#94a3b8'}}>WARD LOCATION</small>
              <div style={{color:'#fff',fontWeight:700}}>{bus?.area}</div>
            </div>
          </div>
        </div>

        <div className="cockpit-grid">
          {/* Speedometer */}
          <div className="cockpit-metric" style={{textAlign:'center',display:'flex',flexDirection:'column',justifyContent:'center'}}>
            <small>CURRENT SPEED</small>
            <div className="cockpit-speed">{bus?.speed||36}</div>
            <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>KM / H</span>
            <div style={{marginTop:12,color:'#4ade80',fontSize:11,fontWeight:700}}>✓ SPEED LIMIT SAFE</div>
          </div>

          {/* Central Hazard Radar Warning */}
          <div className={`cockpit-radar ${hazard?'alert':''}`}>
            {hazard?(
              <>
                <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'#dc2626',color:'#fff',padding:'4px 10px',borderRadius:20,fontSize:11,fontWeight:700,marginBottom:12}}>
                  <AlertTriangle size={14}/> IMMEDIATE HAZARD WARNING
                </div>
                <h3 style={{fontSize:24,margin:'0 0 6px',color:'#fff'}}>
                  {hazard.type.toUpperCase()} IN {hazard.distanceMeters} METERS
                </h3>
                <p style={{margin:'0 0 16px',color:'#fca5a5',fontSize:13}}>
                  Detected in <b>{hazard.lane}</b> · Recommended Safe Speed: <b>{hazard.recommendedSpeed} km/h</b>
                </p>
                <div style={{display:'inline-flex',gap:10,background:'rgba(0,0,0,0.5)',padding:'8px 16px',borderRadius:6,border:'1px solid #7f1d1d'}}>
                  <span style={{color:'#fff',fontSize:12}}>GPS: {hazard.location}</span>
                  <span style={{color:'#f87171',fontSize:12,fontWeight:700}}>Slow down immediately</span>
                </div>
              </>
            ):(
              <div style={{padding:'40px 0'}}>
                <ShieldCheck size={48} style={{color:'#4ade80',margin:'auto'}}/>
                <h3 style={{fontSize:20,margin:'10px 0 4px',color:'#fff'}}>Road Clear Ahead</h3>
                <p style={{color:'#94a3b8',fontSize:12,margin:0}}>No critical hazards detected within 600m on this route segment.</p>
              </div>
            )}
          </div>

          {/* Onboard Edge Camera Diagnostics */}
          <div className="cockpit-metric">
            <small>EDGE CAMERA ARRAYS</small>
            <div style={{display:'grid',gap:8,marginTop:12}}>
              {['Front Camera · 60 FPS','Rear Camera · 30 FPS','Left Camera · 30 FPS','Right Camera · 30 FPS'].map((c,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,background:'#1e293b',padding:'6px 10px',borderRadius:4}}>
                  <span>{c}</span>
                  <span style={{color:'#4ade80',fontWeight:700}}>● ONLINE</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ==================== FEATURE 3: CITIZEN PORTAL ====================
function CitizenPortal(){
  const[ward,setWard]=useState('MG Road');
  const[data,setData]=useState<any>(null);
  const[reportType,setReportType]=useState('Pothole');
  const[reportDesc,setReportDesc]=useState('');
  const[submissionMsg,setSubmissionMsg]=useState<any>(null);

  useEffect(()=>{
    fetch(`${API_BASE}/api/citizen/status?ward=${encodeURIComponent(ward)}`)
      .then(r=>r.ok?r.json():null)
      .then(d=>setData(d))
      .catch(()=>{});
  },[ward]);

  const handleSubmitReport=(e:any)=>{
    e.preventDefault();
    fetch(`${API_BASE}/api/citizen/report`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({hazardType:reportType,area:ward,description:reportDesc})
    })
    .then(r=>r.json())
    .then(res=>{
      setSubmissionMsg(res);
      setReportDesc('');
    })
    .catch(()=>{});
  };

  return (
    <>
      <div className="citizen-hero">
        <h2>Bengaluru Public Road Transparency Portal</h2>
        <p>Live road safety telemetry and repair tracking powered by BMTC bus edge intelligence.</p>
        <div className="citizen-search">
          <input 
            placeholder="Search your ward (e.g. MG Road, Koramangala, Indiranagar)"
            value={ward}
            onChange={e=>setWard(e.target.value)}
          />
          <button onClick={()=>{}}>Search Ward</button>
        </div>
      </div>

      <div className="citizen-grid">
        <div>
          <div className="rqi-card">
            <div className="rqi-score">{data?.roadQualityIndex||82}</div>
            <div>
              <h3>{ward} · Road Quality Index (RQI)</h3>
              <p>Continuous edge inspection score computed from {data?.activeHazards||4} active hazards and {data?.resolvedThisMonth||12} resolved repairs.</p>
              <div style={{marginTop:8,fontSize:11,color:'#15803d',fontWeight:600}}>
                ✓ {data?.busesPatrolling||4} public transit buses actively patrolling this ward
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelhead">
              <h3>Active Road Defects in {ward}</h3>
              <small>Verified by Public Bus Cameras</small>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>DEFECT TYPE</th><th>SEVERITY</th><th>LAST SCANNED</th><th>REPAIR SLA STATUS</th></tr>
                </thead>
                <tbody>
                  {data?.activeIncidents?.length?data.activeIncidents.map((inc:any)=>(
                    <tr key={inc.id}>
                      <td><b>{inc.type}</b></td>
                      <td><Badge value={inc.severity}/></td>
                      <td>{ago(inc.timestamp)} by {inc.busId}</td>
                      <td><Badge value={inc.status}/></td>
                    </tr>
                  )):<tr><td colSpan={4} className="emptycell">No active hazards currently reported in this ward.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Citizen Report Form */}
        <div className="panel">
          <div className="panelhead">
            <h3>Report a Road Hazard</h3>
            <small>Match Against Bus Telemetry</small>
          </div>
          <form onSubmit={handleSubmitReport} style={{display:'grid',gap:12}}>
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:600,color:'#4b5563',marginBottom:4}}>Hazard Category:</label>
              <select 
                value={reportType} 
                onChange={e=>setReportType(e.target.value)}
                style={{width:'100%',padding:'8px',borderRadius:5,border:'1px solid #d1d5db',font:'12px Inter'}}
              >
                {['Pothole','Damaged road','Waterlogging','Missing traffic sign','Traffic congestion'].map(t=>(
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{display:'block',fontSize:11,fontWeight:600,color:'#4b5563',marginBottom:4}}>Location / Ward:</label>
              <input 
                value={ward} 
                onChange={e=>setWard(e.target.value)}
                style={{width:'100%',padding:'8px',borderRadius:5,border:'1px solid #d1d5db',font:'12px Inter'}}
                required
              />
            </div>

            <div>
              <label style={{display:'block',fontSize:11,fontWeight:600,color:'#4b5563',marginBottom:4}}>Landmark / Description:</label>
              <textarea 
                rows={3} 
                value={reportDesc}
                onChange={e=>setReportDesc(e.target.value)}
                placeholder="e.g. Deep crater near Metro Pillar 140 left lane"
                style={{width:'100%',padding:'8px',borderRadius:5,border:'1px solid #d1d5db',font:'12px Inter'}}
              />
            </div>

            <button 
              type="submit"
              style={{background:'#2563eb',color:'#fff',border:0,padding:'10px',borderRadius:6,fontWeight:600,fontSize:12,cursor:'pointer',marginTop:4}}
            >
              Submit Civic Grievance
            </button>
          </form>

          {submissionMsg&&(
            <div style={{marginTop:16,padding:12,borderRadius:6,background:submissionMsg.status==='ALREADY_VERIFIED_BY_BUS'?'#eff6ff':'#f0fdf4',border:'1px solid',borderColor:submissionMsg.status==='ALREADY_VERIFIED_BY_BUS'?'#bfdbfe':'#bbf7d0'}}>
              <b style={{color:submissionMsg.status==='ALREADY_VERIFIED_BY_BUS'?'#1d4ed8':'#15803d',fontSize:12}}>
                {submissionMsg.status==='ALREADY_VERIFIED_BY_BUS'?'✓ Bus Fleet Match Found!':'✓ Grievance Queued'}
              </b>
              <p style={{margin:'4px 0 0',fontSize:11,color:'#4b5563'}}>{submissionMsg.message}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Toast(){
  const{sim}=useStore();
  if(!sim.toast)return null;
  return (
    <div className="toast">
      <AlertTriangle/>
      <div>
        <small>NEW AI INCIDENT · BACKEND SYNC</small>
        <b>{sim.toast.type} detected by {sim.toast.busId}</b>
        <span>Confidence: {sim.toast.confidence}% · Severity: {sim.toast.severity.toUpperCase()}</span>
      </div>
    </div>
  );
}

export default function App(){
  return (
    <Provider>
      <Shell>
        <Routes>
          <Route path="/" element={<Dashboard/>}/>
          <Route path="/fleet" element={<Fleet/>}/>
          <Route path="/fleet/:id" element={<BusProfile/>}/>
          <Route path="/incidents" element={<Incidents/>}/>
          <Route path="/incidents/:id" element={<IncidentDetail/>}/>
          <Route path="/analytics" element={<Analytics/>}/>
          <Route path="/driver-hud" element={<DriverHUD/>}/>
          <Route path="/citizen-portal" element={<CitizenPortal/>}/>
        </Routes>
        <Toast/>
      </Shell>
    </Provider>
  );
}
