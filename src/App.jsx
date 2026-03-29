import { useState, useRef, useEffect, useCallback } from "react";

const CATEGORIES = {
  work:     { color: "#f0a84a", label: "Work" },
  family:   { color: "#4af0a8", label: "Family" },
  personal: { color: "#4a9af0", label: "Personal" },
  urgent:   { color: "#f05a4a", label: "Urgent" },
  health:   { color: "#c44af0", label: "Health" },
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getWeekDays(date) {
  const d = new Date(date), start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return Array.from({length:7}, (_,i) => { const dd=new Date(start); dd.setDate(start.getDate()+i); return dd; });
}
function sameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
function fmtTime(d) { return new Date(d).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(d) { const dd=new Date(d); return `${DAYS[dd.getDay()]} ${dd.getDate()} ${MONTHS[dd.getMonth()]}`; }
function distanceM(lat1,lon1,lat2,lon2) {
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

const SAMPLE_EVENTS = [
  { id:1, title:"Termite inspection — 42 Smith St", date:(() => { const d=new Date(); d.setHours(9,0,0,0); return d.toISOString(); })(), category:"work", triggerType:"time", reminder:30 },
  { id:2, title:"Pick up son from nursery", date:(() => { const d=new Date(); d.setHours(15,0,0,0); return d.toISOString(); })(), category:"family", triggerType:"time", reminder:45 },
  { id:3, title:"Mow the lawns", date:null, category:"personal", triggerType:"location", location:"home", triggerLabel:"When you get home" },
  { id:4, title:"Pest control job — Crown St", date:(() => { const d=new Date(); d.setDate(new Date().getDate()+1); d.setHours(8,0,0,0); return d.toISOString(); })(), category:"work", triggerType:"time", reminder:30 },
];

export default function App() {
  const [events, setEvents] = useState(SAMPLE_EVENTS);
  const [homeLocation, setHomeLocation] = useState(null);
  const [homeSet, setHomeSet] = useState(false);
  const [messages, setMessages] = useState([{ role:"assistant", text:'Hey! Tell me what to remember. Just type naturally:\n\n"Dentist Friday 2pm"\n"Mow lawns when I get home"\n"Pest job tomorrow 8am at Crown St"\n\nI\'ll sort it.' }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("week");
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const [notifPerm, setNotifPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "denied");
  const [locationStatus, setLocationStatus] = useState("idle");
  const [lastNotified, setLastNotified] = useState({});
  const [toast, setToast] = useState(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const watchIdRef = useRef(null);
  const today = new Date();

  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const showToast = useCallback((msg, duration=4000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  const fireNotif = useCallback((title, body) => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
    showToast(`🔔 ${title}\n${body}`, 6000);
  }, [showToast]);

  // Time-based reminders — check every minute
  useEffect(() => {
    const check = () => {
      const now = new Date();
      events.forEach(ev => {
        if (ev.triggerType !== "time" || !ev.date || lastNotified[ev.id]) return;
        const evTime = new Date(ev.date);
        const remTime = new Date(evTime.getTime() - (ev.reminder||30)*60000);
        if (now >= remTime && now < evTime) {
          setLastNotified(p => ({...p,[ev.id]:true}));
          fireNotif(`⏰ ${ev.title}`, `In ${ev.reminder||30} mins · ${fmtTime(ev.date)}`);
        }
      });
    };
    check();
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, [events, lastNotified, fireNotif]);

  // GPS home detection
  const startWatch = useCallback((homeLoc) => {
    if (!navigator.geolocation || !homeLoc) return;
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    setLocationStatus("watching");
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const dist = distanceM(pos.coords.latitude, pos.coords.longitude, homeLoc.lat, homeLoc.lng);
        if (dist < 150) {
          setEvents(evs => {
            evs.forEach(ev => {
              if (ev.triggerType==="location" && ev.location==="home" && !lastNotified[ev.id]) {
                setLastNotified(p => ({...p,[ev.id]:true}));
                fireNotif(`🏠 ${ev.title}`, "You just got home!");
              }
            });
            return evs;
          });
        }
      },
      () => setLocationStatus("error"),
      { enableHighAccuracy:true, maximumAge:30000, timeout:15000 }
    );
  }, [lastNotified, fireNotif]);

  const setHome = () => {
    if (!navigator.geolocation) { showToast("GPS not available"); return; }
    showToast("📍 Getting your location...");
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHomeLocation(loc);
        setHomeSet(true);
        startWatch(loc);
        showToast("🏠 Home location saved! GPS is now active.");
      },
      () => showToast("Couldn't get location. Make sure location is allowed.")
    );
  };

  const requestNotifs = async () => {
    if (typeof Notification === "undefined") { showToast("Notifications not supported"); return; }
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    showToast(p==="granted" ? "🔔 Notifications enabled!" : "Notifications blocked. Enable in browser settings.");
  };

  const eventsForDay = d => events.filter(e => e.date && sameDay(new Date(e.date), d)).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const locationEvents = events.filter(e => e.triggerType==="location");
  const nextEvent = events.filter(e => e.date && new Date(e.date)>new Date()).sort((a,b)=>new Date(a.date)-new Date(b.date))[0];
  const weekDays = getWeekDays(currentWeek);
  const selectedDayEvents = eventsForDay(selectedDay);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput(""); setLoading(true);
    setMessages(p => [...p, {role:"user", text}]);

    const sys = `You are a blunt personal assistant. No fluff. Short replies. Speak like a mate.
Today: ${new Date().toDateString()}. Time: ${new Date().toLocaleTimeString()}.
Tomorrow: ${new Date(Date.now()+86400000).toDateString()}.

Return ONLY raw JSON, nothing else.

Adding time event: {"action":"add","event":{"title":"title","date":"ISO string","category":"work|family|personal|urgent|health","triggerType":"time","reminder":30},"reply":"short confirmation"}
Adding location event (get home / arrive home / when home): {"action":"add","event":{"title":"title","date":null,"category":"work|family|personal|urgent|health","triggerType":"location","location":"home","triggerLabel":"When you get home"},"reply":"short confirmation"}
Asking about schedule: {"action":"query","reply":"direct answer"}
Other: {"action":"chat","reply":"short reply"}

Categories: pest/termite/job=work, kids/son/daughter/wife=family, doctor/dentist=health, urgent/asap=urgent, else=personal.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:400, system:sys, messages:[{role:"user",content:text}] })
      });
      const data = await res.json();
      const raw = data.content.map(b=>b.text||"").join("").trim();
      let parsed;
      for (const fn of [r=>JSON.parse(r), r=>JSON.parse(r.replace(/```json|```/gi,"").trim()), r=>{const m=r.match(/\{[\s\S]*\}/);return JSON.parse(m[0]);}]) {
        try{parsed=fn(raw);if(parsed)break;}catch{continue;}
      }
      if (!parsed) throw new Error();
      if (parsed.action==="add"&&parsed.event) {
        const ev = {...parsed.event, id:Date.now()};
        setEvents(p=>[...p,ev]);
        if (ev.triggerType==="location") showToast("📍 Location reminder saved — will fire when you get home");
        else if (ev.triggerType==="time") showToast(`✅ Added: ${ev.title}`);
      }
      setMessages(p=>[...p,{role:"assistant",text:parsed.reply||"Done."}]);
    } catch {
      setMessages(p=>[...p,{role:"assistant",text:"Something went wrong. Try again."}]);
    }
    setLoading(false);
  };

  const c = "#f0a84a";
  const s = {
    root:{background:"#0d0d0d",minHeight:"100svh",fontFamily:"'DM Sans',sans-serif",color:"#f0f0e8",display:"flex",flexDirection:"column",maxWidth:480,margin:"0 auto",position:"relative"},
    header:{padding:"20px 20px 0",flexShrink:0},
    hRow:{display:"flex",justifyContent:"space-between",alignItems:"center"},
    logo:{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,letterSpacing:"-0.02em"},
    logoAccent:{color:c},
    dateStr:{fontSize:10,color:"#444",letterSpacing:"0.08em",textTransform:"uppercase"},
    pills:{display:"flex",gap:7,marginTop:12,flexWrap:"wrap"},
    pill:(on,col)=>({display:"flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:20,background:on?`${col}15`:"#181818",border:`1px solid ${on?col:"#252525"}`,fontSize:10,color:on?col:"#555",cursor:on?"default":"pointer",fontWeight:600,letterSpacing:"0.03em",transition:"all 0.2s"}),
    nextUp:{margin:"12px 20px 0",background:"#161616",border:"1px solid #222",borderRadius:12,padding:"12px 14px",display:"flex",gap:11,alignItems:"flex-start",flexShrink:0},
    nDot:(cat)=>({width:8,height:8,borderRadius:"50%",background:CATEGORIES[cat]?.color||"#666",marginTop:3,flexShrink:0}),
    nLabel:{fontSize:9,color:"#444",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3},
    nTitle:{fontSize:13,fontWeight:600,lineHeight:1.3},
    nTime:{fontSize:11,color:"#555",marginTop:2},
    tabs:{display:"flex",margin:"12px 20px 0",background:"#161616",borderRadius:10,padding:3,gap:3,flexShrink:0},
    tab:(a)=>({flex:1,padding:"8px 0",textAlign:"center",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",background:a?"#252525":"transparent",color:a?"#f0f0e8":"#444",border:"none",transition:"all 0.15s",fontFamily:"'DM Sans',sans-serif"}),
    scrollArea:{flex:1,overflowY:"auto",padding:"14px 20px"},
    weekNav:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14},
    wLabel:{fontFamily:"'Syne',sans-serif",fontSize:14,fontWeight:700},
    navBtn:{background:"#161616",border:"1px solid #222",color:"#666",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"},
    grid:{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:5,marginBottom:14},
    dPill:(isT,isSel)=>({display:"flex",flexDirection:"column",alignItems:"center",padding:"7px 3px",borderRadius:10,background:isT?c:isSel?"#1e1e1e":"transparent",cursor:"pointer",border:isSel&&!isT?"1px solid #2a2a2a":"1px solid transparent",transition:"all 0.15s"}),
    dName:(isT)=>({fontSize:8,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:isT?"#0d0d0d":"#444",marginBottom:3}),
    dNum:(isT)=>({fontSize:14,fontWeight:700,color:isT?"#0d0d0d":"#f0f0e8"}),
    dot:{width:4,height:4,borderRadius:"50%",background:c,marginTop:2},
    legend:{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12},
    lItem:{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"#444"},
    lDot:(col)=>({width:5,height:5,borderRadius:"50%",background:col}),
    dayHead:{fontSize:10,color:"#444",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10},
    eList:{display:"flex",flexDirection:"column",gap:8},
    eCard:(cat)=>({background:"#161616",borderRadius:10,padding:"11px 13px",borderLeft:`3px solid ${CATEGORIES[cat]?.color||"#555"}`,display:"flex",alignItems:"center",gap:10}),
    eInfo:{flex:1},
    eTitle:{fontSize:13,fontWeight:600,lineHeight:1.3},
    eMeta:{fontSize:10,color:"#555",marginTop:3,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"},
    eBadge:(cat)=>({fontSize:8,padding:"2px 6px",borderRadius:20,background:`${CATEGORIES[cat]?.color||"#666"}18`,color:CATEGORIES[cat]?.color||"#666",letterSpacing:"0.06em",textTransform:"uppercase",fontWeight:700}),
    xBtn:{background:"transparent",border:"none",color:"#2e2e2e",cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px",flexShrink:0},
    empty:{textAlign:"center",padding:"32px 0",color:"#2e2e2e",fontSize:13},
    locSection:{marginTop:16,background:"#161616",borderRadius:12,overflow:"hidden"},
    locHead:{padding:"10px 14px",borderBottom:"1px solid #1e1e1e",display:"flex",alignItems:"center",gap:7},
    locTitle:{fontFamily:"'Syne',sans-serif",fontSize:11,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase",color:"#4a9af0"},
    locBody:{padding:"10px 14px",display:"flex",flexDirection:"column",gap:8},
    locCard:{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:"#1a1a1a",borderRadius:8,borderLeft:"3px solid #4a9af0"},
    chatWrap:{flex:1,overflowY:"auto",padding:"14px 20px",display:"flex",flexDirection:"column",gap:10},
    bubble:(r)=>({maxWidth:"85%",padding:"10px 14px",borderRadius:r==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:r==="user"?c:"#161616",color:r==="user"?"#0d0d0d":"#f0f0e8",alignSelf:r==="user"?"flex-end":"flex-start",fontSize:13,lineHeight:1.65,fontWeight:r==="user"?600:400,whiteSpace:"pre-wrap"}),
    typing:{background:"#161616",padding:"12px 16px",borderRadius:"16px 16px 16px 4px",alignSelf:"flex-start",display:"flex",gap:5,alignItems:"center"},
    tDot:{width:6,height:6,background:"#2e2e2e",borderRadius:"50%"},
    inputWrap:{padding:"10px 20px 28px",background:"#0d0d0d",borderTop:"1px solid #161616",flexShrink:0},
    inputRow:{display:"flex",gap:8,alignItems:"center",background:"#161616",borderRadius:14,padding:"8px 8px 8px 14px",border:"1px solid #222"},
    inp:{flex:1,background:"transparent",border:"none",outline:"none",color:"#f0f0e8",fontSize:14,fontFamily:"'DM Sans',sans-serif"},
    send:{width:36,height:36,borderRadius:10,background:c,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:15,fontWeight:700,color:"#0d0d0d"},
    hint:{fontSize:9,color:"#2e2e2e",textAlign:"center",marginTop:7,letterSpacing:"0.04em"},
    toast:{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:"#1e1e1e",border:"1px solid #2a2a2a",borderRadius:12,padding:"11px 18px",fontSize:13,color:"#f0f0e8",zIndex:9999,boxShadow:"0 4px 30px rgba(0,0,0,0.5)",maxWidth:320,textAlign:"center",whiteSpace:"pre-wrap",lineHeight:1.5},
  };

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>
      {toast && <div style={s.toast}>{toast}</div>}
      <div style={s.root}>

        <div style={s.header}>
          <div style={s.hRow}>
            <div style={s.logo}>BRAIN<span style={s.logoAccent}>OS</span></div>
            <div style={s.dateStr}>{today.getDate()} {MONTHS[today.getMonth()]} {today.getFullYear()}</div>
          </div>
          <div style={s.pills}>
            <div style={s.pill(notifPerm==="granted","#f0a84a")} onClick={notifPerm!=="granted"?requestNotifs:undefined}>
              🔔 {notifPerm==="granted"?"Notifs on":"Turn on notifs"}
            </div>
            <div style={s.pill(homeSet,"#4a9af0")} onClick={!homeSet?setHome:undefined}>
              📍 {homeSet?"Home set ✓":"Set home location"}
            </div>
            {homeSet && locationStatus==="watching" && (
              <div style={s.pill(true,"#4af0a8")}>● GPS watching</div>
            )}
          </div>
        </div>

        {nextEvent && (
          <div style={s.nextUp}>
            <div style={s.nDot(nextEvent.category)}/>
            <div>
              <div style={s.nLabel}>next up</div>
              <div style={s.nTitle}>{nextEvent.title}</div>
              <div style={s.nTime}>{fmtDate(nextEvent.date)} · {fmtTime(nextEvent.date)}</div>
            </div>
          </div>
        )}

        <div style={s.tabs}>
          <button style={s.tab(view==="week")} onClick={()=>setView("week")}>📅 Calendar</button>
          <button style={s.tab(view==="chat")} onClick={()=>{setView("chat");setTimeout(()=>inputRef.current?.focus(),100);}}>💬 Tell it</button>
        </div>

        {view==="week" && (
          <div style={s.scrollArea}>
            <div style={s.weekNav}>
              <button style={s.navBtn} onClick={()=>{const d=new Date(currentWeek);d.setDate(d.getDate()-7);setCurrentWeek(d);}}>‹</button>
              <span style={s.wLabel}>{MONTHS_FULL[weekDays[0].getMonth()]} {weekDays[0].getFullYear()}</span>
              <button style={s.navBtn} onClick={()=>{const d=new Date(currentWeek);d.setDate(d.getDate()+7);setCurrentWeek(d);}}>›</button>
            </div>
            <div style={s.grid}>
              {weekDays.map((day,i)=>{
                const has=eventsForDay(day).length>0, isT=sameDay(day,today), isSel=sameDay(day,selectedDay);
                return (
                  <div key={i} style={s.dPill(isT,isSel)} onClick={()=>setSelectedDay(day)}>
                    <span style={s.dName(isT)}>{DAYS[day.getDay()]}</span>
                    <span style={s.dNum(isT)}>{day.getDate()}</span>
                    {has&&!isT&&<div style={s.dot}/>}
                  </div>
                );
              })}
            </div>
            <div style={s.legend}>
              {Object.entries(CATEGORIES).map(([k,v])=>(
                <div key={k} style={s.lItem}><div style={s.lDot(v.color)}/>{v.label}</div>
              ))}
            </div>
            <div style={s.dayHead}>{sameDay(selectedDay,today)?"Today":fmtDate(selectedDay.toISOString())}</div>
            <div style={s.eList}>
              {selectedDayEvents.length===0
                ? <div style={s.empty}>Nothing on. Enjoy it.</div>
                : selectedDayEvents.map(ev=>(
                  <div key={ev.id} style={s.eCard(ev.category)}>
                    <div style={s.eInfo}>
                      <div style={s.eTitle}>{ev.title}</div>
                      <div style={s.eMeta}>
                        <span>{fmtTime(ev.date)}</span>
                        <span style={s.eBadge(ev.category)}>{CATEGORIES[ev.category]?.label}</span>
                        <span>🔔 {ev.reminder}m</span>
                      </div>
                    </div>
                    <button style={s.xBtn} onClick={()=>setEvents(p=>p.filter(e=>e.id!==ev.id))}>×</button>
                  </div>
                ))
              }
            </div>
            {locationEvents.length>0 && (
              <div style={s.locSection}>
                <div style={s.locHead}><span>📍</span><span style={s.locTitle}>Location reminders</span></div>
                <div style={s.locBody}>
                  {locationEvents.map(ev=>(
                    <div key={ev.id} style={s.locCard}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:600}}>{ev.title}</div>
                        <div style={{fontSize:10,color:"#4a9af0",marginTop:2}}>{ev.triggerLabel||"When you get home"}</div>
                      </div>
                      <button style={s.xBtn} onClick={()=>setEvents(p=>p.filter(e=>e.id!==ev.id))}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {view==="chat" && (
          <div style={s.chatWrap}>
            {messages.map((m,i)=><div key={i} style={s.bubble(m.role)}>{m.text}</div>)}
            {loading && (
              <div style={s.typing}>
                {[0,1,2].map(i=><div key={i} style={{...s.tDot,animation:`blink 1.2s ${i*0.2}s ease-in-out infinite`}}/>)}
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>
        )}

        <div style={s.inputWrap}>
          <div style={s.inputRow}>
            <input ref={inputRef} style={s.inp} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
              placeholder={view==="chat"?`"Mow lawns when I get home"...`:"Add something..."}/>
            <button style={s.send} onClick={sendMessage} disabled={loading}>{loading?"…":"→"}</button>
          </div>
          <div style={s.hint}>type naturally · "dentist friday 2pm" · "take bins out when I get home"</div>
        </div>
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:.15;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}*{box-sizing:border-box}body{margin:0;background:#0d0d0d}::-webkit-scrollbar{display:none}`}</style>
    </>
  );
}
