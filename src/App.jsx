import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell } from "recharts";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyBAnOJxZ7BLV1DtcXXBrbV9BWdSUEtgZIs",
  authDomain:        "eigen-vermogen-tracker-13035.firebaseapp.com",
  projectId:         "eigen-vermogen-tracker-13035",
  storageBucket:     "eigen-vermogen-tracker-13035.firebasestorage.app",
  messagingSenderId: "280842611201",
  appId:             "1:280842611201:web:c2d7afcd7a64f8430c6e00",
  measurementId:     "G-DXLB1MQM5R",
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

const BG="#0b1629", CARD="#131f35", CARD2="#1a2a45";
const TEAL="#00e5cc", ORG="#ff6b35", PURP="#7c5cfc", PINK="#e84393", RED="#ff4466", GREEN="#22cc88", BLUE="#4488ff";

const fmt  = v => (v<0?"-":"")+"€"+Math.abs(v).toLocaleString("nl-NL",{minimumFractionDigits:0});
const fmtC = (v,pos="#aabbcc") => ({color:v<0?RED:v===0?"#556677":pos, text:fmt(v)});
const fmtDate = str => {
  if(!str) return str;
  if(str.length===10){ const [y,m,d]=str.split('-'); return `${d}-${m}-${y}`; }
  if(str.length===7) { const [y,m]=str.split('-'); return `${m}-${y}`; }
  return str;
};

const GROUPS = [
  {id:"mat_vaste",   label:"Materiële Vaste Activa",  sub:"Vaste activa",     color:ORG,  sign:1,  side:"activa"},
  {id:"fin_vaste",   label:"Financiële Vaste Activa", sub:"Vaste activa",     color:PURP, sign:1,  side:"activa"},
  {id:"vorderingen", label:"Vorderingen",             sub:"Vlottende activa", color:PINK, sign:1,  side:"activa"},
  {id:"liquide",     label:"Liquide Middelen",         sub:"Vlottende activa", color:TEAL, sign:1,  side:"activa"},
  {id:"schuld",      label:"Schulden",                 sub:"Passiva",          color:RED,  sign:-1, side:"passiva"},
];

const DEFAULT_BUCKETS = [
  {id:1,  name:"Auto",                           group:"mat_vaste",   note:"Geschatte marktwaarde"},
  {id:2,  name:"Beleggingen / Aandelen",         group:"fin_vaste",   note:"Vanguard All-World ACC ETF"},
  {id:3,  name:"Geld uitgeleend aan ouders",     group:"vorderingen", note:"Tijdelijke lening – terugvordering"},
  {id:4,  name:"Geld uitgeleend aan zus",        group:"vorderingen", note:"Tijdelijke lening – terugvordering"},
  {id:5,  name:"Teruggave Belastingdienst",      group:"vorderingen", note:""},
  {id:6,  name:"Wie-betaalt-wat saldo",          group:"vorderingen", note:"Lopende verrekening"},
  {id:7,  name:"Verschuldigd salaris + km-verg", group:"vorderingen", note:""},
  {id:8,  name:"Betaalrekening",                 group:"liquide",     note:"Dagelijks saldo"},
  {id:9,  name:"Bunq Spaarrekening (algemeen)",  group:"liquide",     note:"Bunq vrij spaarpotje"},
  {id:10, name:"ING Spaarrekening – Kleding",    group:"liquide",     note:"Spaarpot kleding"},
  {id:11, name:"ING Spaarrekening – Vakantie",   group:"liquide",     note:"Spaarpot vakantie & leuke dingen"},
];

const S1V = {1:12500,2:7750,3:15000,4:1500,5:0,6:300,7:0,8:1250,9:750,10:75,11:200};
const S2V = {1:12500,2:7750,3:15000,4:1500,5:0,6:-450,7:0,8:1250,9:750,10:75,11:200};

const DEFAULT_SNAPSHOTS = [
  {date:"2026-04-20",values:S1V,regularInleg:0,  extraStortingen:[]},
  {date:"2026-05-14",values:S2V,regularInleg:500,extraStortingen:[]},
];

const monthsBetween = (a,b) => (new Date(b)-new Date(a))/(1000*60*60*24*30.4375);

const expectedFV = (start, months, monthly=500, ar=0.07) => {
  if(months<=0) return start;
  const mr=ar/12;
  return Math.round(start*Math.pow(1+mr,months)+monthly*((Math.pow(1+mr,months)-1)/mr));
};

const discreteExpectedFV = (start, fromDate, toDate, monthly, ar, depositDay=20) => {
  const mr=ar/12, months=monthsBetween(fromDate,toDate);
  let result=start*Math.pow(1+mr,months);
  const from=new Date(fromDate);
  let d=new Date(from.getFullYear(),from.getMonth(),depositDay);
  if(d<=new Date(fromDate)) d.setMonth(d.getMonth()+1);
  const to=new Date(toDate);
  while(d<=to){ const mRem=monthsBetween(d.toISOString().slice(0,10),toDate); result+=monthly*Math.pow(1+mr,mRem); d.setMonth(d.getMonth()+1); }
  return Math.round(result);
};

const expectedNWCorrect = (firstSnap, months, monthly, ar, bkts) => {
  if(!firstSnap) return 0;
  const finStart=bkts.filter(b=>b.group==="fin_vaste").reduce((s,b)=>s+Number(firstSnap.values[b.id]||0),0);
  const rest=bkts.reduce((s,b)=>{ const sign=GROUPS.find(g=>g.id===b.group)?.sign??1; return b.group==="fin_vaste"?s:s+sign*Number(firstSnap.values[b.id]||0); },0);
  return rest+expectedFV(finStart,months,monthly,ar);
};

// Custom tooltip die exact het dichtstbijzijnde datapunt toont
const TT = ({ active, payload }) => {
  if(!active||!payload?.length) return null;
  const d=payload[0]?.payload;
  if(!d) return null;
  const label = d.fullDate ? fmtDate(d.fullDate) : fmtDate(d.label);
  return (
    <div style={{background:CARD2,border:"1px solid #2a3a55",borderRadius:8,padding:"10px 14px",fontSize:12}}>
      <div style={{color:"#8899bb",marginBottom:6,fontWeight:600}}>{label}</div>
      {payload.filter(p=>p.value!=null).map((p,i)=>(
        <div key={i} style={{color:p.color,marginBottom:2}}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  );
};

const SpaarTT = ({active,payload}) => {
  if(!active||!payload?.length) return null;
  const d=payload[0]?.payload; if(!d) return null;
  const label = d.fullDate ? fmtDate(d.fullDate) : fmtDate(d.label);
  const w=d.werkelijk, doel=d.doel, diff=w!=null&&doel!=null?w-doel:null;
  return (
    <div style={{background:CARD2,border:"1px solid #2a3a55",borderRadius:8,padding:"10px 14px",fontSize:12}}>
      <div style={{color:"#8899bb",marginBottom:6,fontWeight:600}}>{label}</div>
      {w!=null&&<div style={{color:GREEN,marginBottom:2}}>Werkelijk ingelegd: {fmt(w)}</div>}
      {doel!=null&&<div style={{color:ORG,marginBottom:2}}>Doel: {fmt(Math.round(doel))}</div>}
      {diff!=null&&<div style={{color:diff>=0?TEAL:RED,fontWeight:700,marginTop:4}}>{diff>=0?"Voor: +":"Achter: "}{fmt(Math.abs(Math.round(diff)))}</div>}
    </div>
  );
};

// No-spinner input
const inp = (ex={}) => ({background:CARD2,border:"1px solid #2a3a55",borderRadius:8,padding:"9px 12px",color:"white",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box",MozAppearance:"textfield",...ex});
const noSpinner = {WebkitAppearance:"none",MozAppearance:"textfield"};

const EMPTY_INLINE = {name:"",note:""};

const saveToFirebase = async (uid,key,value) => { try { await setDoc(doc(db,"users",uid,"data",key),{value:JSON.stringify(value)},{merge:true}); } catch(e){ console.error(e); } };
const loadFromFirebase = async (uid,key) => { try { const s=await getDoc(doc(db,"users",uid,"data",key)); if(s.exists()) return JSON.parse(s.data().value); } catch(e){ console.error(e); } return null; };

export default function App() {
  const [user,         setUser]        = useState(null);
  const [authLoading,  setAuthLoading] = useState(true);
  const [buckets,      setBuckets]     = useState(DEFAULT_BUCKETS);
  const [snapshots,    setSnapshots]   = useState(DEFAULT_SNAPSHOTS);
  const [view,         setView]        = useState("overzicht");
  const [monthly,      setMonthly]     = useState(500);
  const [annualReturn, setAnnualReturn]= useState(7);
  const [startKb,      setStartKb]     = useState(7500);
  const [newSnap,      setNewSnap]     = useState({date:new Date().toISOString().slice(0,10),values:{...S2V},regularInleg:500,extraStortingen:[]});
  const [editIdx,      setEditIdx]     = useState(null);
  const [inlineAdd,    setInlineAdd]   = useState(null);
  const [inlineForm,   setInlineForm]  = useState(EMPTY_INLINE);
  const [newBucket,    setNewBucket]   = useState({name:"",group:"liquide",note:""});
  const [editingBucket,setEditingBucket]=useState(null); // id of bucket being renamed
  const [editingName,  setEditingName] = useState("");
  const [dragOver,     setDragOver]    = useState(null);
  const [loaded,       setLoaded]      = useState(false);
  const dragItem = useRef(null);

  useEffect(()=>{
    return onAuthStateChanged(auth, async u=>{
      setUser(u);
      if(u){
        const b=await loadFromFirebase(u.uid,"buckets");   if(b) setBuckets(b);
        const s=await loadFromFirebase(u.uid,"snapshots"); if(s) setSnapshots(s);
        const m=await loadFromFirebase(u.uid,"monthly");   if(m!=null) setMonthly(m);
        const r=await loadFromFirebase(u.uid,"return");    if(r!=null) setAnnualReturn(r);
        const k=await loadFromFirebase(u.uid,"startkb");   if(k!=null) setStartKb(k);
      }
      setLoaded(true); setAuthLoading(false);
    });
  },[]);

  useEffect(()=>{ if(!loaded||!user) return; saveToFirebase(user.uid,"buckets",buckets); },[buckets,loaded,user]);
  useEffect(()=>{ if(!loaded||!user) return; saveToFirebase(user.uid,"snapshots",snapshots); },[snapshots,loaded,user]);
  useEffect(()=>{ if(!loaded||!user) return; saveToFirebase(user.uid,"monthly",monthly); },[monthly,loaded,user]);
  useEffect(()=>{ if(!loaded||!user) return; saveToFirebase(user.uid,"return",annualReturn); },[annualReturn,loaded,user]);
  useEffect(()=>{ if(!loaded||!user) return; saveToFirebase(user.uid,"startkb",startKb); },[startKb,loaded,user]);

  const login  = () => signInWithPopup(auth,provider);
  const logout = () => { signOut(auth); setLoaded(false); };

  const groupSign = gid => GROUPS.find(g=>g.id===gid)?.sign??1;
  const calcNW    = vals => buckets.reduce((s,b)=>s+groupSign(b.group)*Number(vals[b.id]||0),0);
  const calcGroup = (vals,gid) => buckets.filter(b=>b.group===gid).reduce((s,b)=>s+Number(vals[b.id]||0),0);
  const finVaste  = s => buckets.filter(b=>b.group==="fin_vaste").reduce((sum,b)=>sum+Number(s.values[b.id]||0),0);
  const totalExtraStorting = s => (s.extraStortingen||[]).reduce((sum,e)=>sum+Number(e.bedrag||0),0);
  const mr = annualReturn/100/12;

  const sorted   = [...snapshots].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const latest   = sorted[sorted.length-1];
  const first    = sorted[0];
  const latestNW = latest?calcNW(latest.values):0;

  const chartData = (()=>{
    if(!first) return [];
    const byMonth={};
    sorted.forEach(s=>{ byMonth[s.date.slice(0,7)]=s; });
    const data=Object.keys(byMonth).sort().map(m=>{
      const s=byMonth[m], nw=calcNW(s.values), months=monthsBetween(first.date,s.date);
      return {label:m,fullDate:s.date,werkelijk:nw,verwacht:expectedNWCorrect(first,months,monthly,annualReturn/100,buckets)};
    });
    const tot=monthsBetween(first.date,latest.date);
    for(let i=1;i<=12;i++){
      const d=new Date(first.date); d.setMonth(d.getMonth()+tot+i);
      data.push({label:d.toISOString().slice(0,7),fullDate:null,werkelijk:null,verwacht:expectedNWCorrect(first,tot+i,monthly,annualReturn/100,buckets)});
    }
    return data;
  })();

  const latestExp=latest&&chartData.find(c=>c.label===latest.date.slice(0,7))?.verwacht;
  const diff=latestExp!=null?latestNW-latestExp:0;

  const totaleKb=startKb+sorted.slice(1).reduce((s,x)=>s+Number(x.regularInleg||0)+totalExtraStorting(x),0);
  const totaalMarktResult=latest?finVaste(latest)-totaleKb:0;

  const periodeData=(()=>{
    if(sorted.length<2) return [];
    return sorted.slice(1).map((s,i)=>{
      const prev=sorted[i], prevFv=finVaste(prev), werkelijk=finVaste(s);
      const months=monthsBetween(prev.date,s.date);
      const regularInleg=Number(s.regularInleg||0);
      const extraStortingen=s.extraStortingen||[];
      const totExtraStorting=totalExtraStorting(s);
      const totaleInleg=regularInleg+totExtraStorting;
      // Verwacht: discrete €500 inleg + elke extra storting rendeert vanaf zijn eigen datum
      let verwachtEinde=discreteExpectedFV(prevFv,prev.date,s.date,monthly,annualReturn/100);
      extraStortingen.forEach(e=>{
        const eDate=e.datum||s.date;
        const mRem=Math.max(0,monthsBetween(eDate,s.date));
        verwachtEinde+=Number(e.bedrag||0)*Math.pow(1+mr,mRem);
      });
      const verwachtZonderRendement=prevFv+totaleInleg;
      const marktResult=werkelijk-Math.round(verwachtEinde);
      const marktPct=prevFv>0?(marktResult/prevFv*100).toFixed(1):"0.0";
      const verwachtInleg=monthly*months, inlegVerschil=regularInleg-verwachtInleg;
      return {van:prev.date,tot:s.date,months,prevFv,werkelijk,verwacht:Math.round(verwachtEinde),
              verwachtZonderRendement,totaleInleg,regularInleg,extraStortingen,totExtraStorting,
              marktResult,marktPct,verwachtInleg,inlegVerschil};
    });
  })();

  const beleggingData=(()=>{
    if(!first) return [];
    const data=[];
    sorted.forEach((s,i)=>{
      const fv=finVaste(s), label=s.date; // volledige datum als label
      if(i===0){ data.push({label,fullDate:s.date,werkelijk:fv,verwacht:fv}); return; }
      const prev=sorted[i-1], prevFv=finVaste(prev), months=monthsBetween(prev.date,s.date);
      const extraStortingen=s.extraStortingen||[];
      for(let m=1;m<Math.floor(months);m++){
        const d=new Date(prev.date); d.setMonth(d.getMonth()+m);
        const dStr=d.toISOString().slice(0,10);
        let v=discreteExpectedFV(prevFv,prev.date,dStr,monthly,annualReturn/100);
        extraStortingen.forEach(e=>{ const eDate=e.datum||s.date; if(new Date(dStr)>=new Date(eDate)){ v+=Number(e.bedrag||0)*Math.pow(1+mr,Math.max(0,monthsBetween(eDate,dStr))); } });
        data.push({label:dStr,fullDate:null,werkelijk:null,verwacht:Math.round(v)});
      }
      let endVerwacht=discreteExpectedFV(prevFv,prev.date,s.date,monthly,annualReturn/100);
      extraStortingen.forEach(e=>{ const eDate=e.datum||s.date; endVerwacht+=Number(e.bedrag||0)*Math.pow(1+mr,Math.max(0,monthsBetween(eDate,s.date))); });
      data.push({label,fullDate:s.date,werkelijk:fv,verwacht:Math.round(endVerwacht)});
    });
    const latestFv=finVaste(latest), tot=monthsBetween(first.date,latest.date);
    for(let i=1;i<=12;i++){
      const d=new Date(first.date); d.setMonth(d.getMonth()+tot+i);
      const dStr=d.toISOString().slice(0,7);
      data.push({label:dStr,fullDate:null,werkelijk:null,verwacht:expectedFV(latestFv,i,monthly,annualReturn/100)});
    }
    return data;
  })();

  const spaarData=(()=>{
    if(!first) return [];
    let cumInleg=0;
    const snapshotDates=new Set(sorted.map(s=>s.date));
    const data=sorted.map(s=>{
      cumInleg+=Number(s.regularInleg||0);
      return {label:s.date,fullDate:s.date,werkelijk:cumInleg,doel:monthly*monthsBetween(first.date,s.date),isSnapshot:true};
    });
    const tot=monthsBetween(first.date,latest.date);
    for(let i=1;i<=12;i++){
      const d=new Date(first.date); d.setMonth(d.getMonth()+tot+i);
      const lbl=d.toISOString().slice(0,7);
      data.push({label:lbl,fullDate:null,werkelijk:null,doel:monthly*(tot+i),isSnapshot:false});
    }
    return data;
  })();

  const totalRegularInleg=sorted.reduce((s,x)=>s+Number(x.regularInleg||0),0);
  const inlegDoel=first?monthly*monthsBetween(first.date,latest?.date||first.date):0;
  const inlegVerschilTotaal=totalRegularInleg-inlegDoel;

  const saveSnap=()=>{
    if(!newSnap.date) return;
    const snap={...newSnap,regularInleg:Number(newSnap.regularInleg||0),extraStortingen:(newSnap.extraStortingen||[]).map(e=>({...e,bedrag:Number(e.bedrag||0)}))};
    if(editIdx!==null){ setSnapshots(p=>p.map((s,i)=>i===editIdx?snap:s)); setEditIdx(null); }
    else setSnapshots(p=>[...p.filter(s=>s.date!==snap.date),snap]);
    setNewSnap({date:new Date().toISOString().slice(0,10),values:{},regularInleg:monthly,extraStortingen:[]});
    setView("overzicht");
  };

  const startEdit=i=>{
    const s=sorted[i], oi=snapshots.findIndex(x=>x.date===s.date);
    setEditIdx(oi);
    setNewSnap({regularInleg:monthly,extraStortingen:[],...s,values:{...s.values},extraStortingen:s.extraStortingen||[]});
    setView("snapshot");
  };

  const deleteBucket=id=>setBuckets(p=>p.filter(b=>b.id!==id));
  const renameBucket=(id,name)=>setBuckets(p=>p.map(b=>b.id===id?{...b,name}:b));

  const saveInline=()=>{
    if(!inlineForm.name) return;
    const nb={...inlineForm,group:inlineAdd,id:Date.now()};
    setBuckets(p=>[...p,nb]); setNewSnap(p=>({...p,values:{...p.values,[nb.id]:"0"}}));
    setInlineAdd(null); setInlineForm(EMPTY_INLINE);
  };
  const addBucket=()=>{ if(!newBucket.name) return; setBuckets(p=>[...p,{...newBucket,id:Date.now()}]); setNewBucket({name:"",group:"liquide",note:""}); };

  // Drag & drop voor posten binnen dezelfde groep
  const handleDragStart=(e,id)=>{ dragItem.current=id; e.dataTransfer.effectAllowed="move"; };
  const handleDragOver=(e,id)=>{ e.preventDefault(); setDragOver(id); };
  const handleDrop=(e,targetId)=>{
    e.preventDefault();
    const fromId=dragItem.current;
    if(fromId===targetId) return;
    setBuckets(prev=>{
      const arr=[...prev];
      const fromIdx=arr.findIndex(b=>b.id===fromId);
      const toIdx=arr.findIndex(b=>b.id===targetId);
      const [item]=arr.splice(fromIdx,1);
      arr.splice(toIdx,0,item);
      return arr;
    });
    setDragOver(null); dragItem.current=null;
  };

  // Extra stortingen helpers
  const addExtraStorting=()=>setNewSnap(p=>({...p,extraStortingen:[...(p.extraStortingen||[]),{id:Date.now(),bedrag:"",datum:p.date}]}));
  const updateExtraStorting=(id,field,val)=>setNewSnap(p=>({...p,extraStortingen:p.extraStortingen.map(e=>e.id===id?{...e,[field]:val}:e)}));
  const removeExtraStorting=id=>setNewSnap(p=>({...p,extraStortingen:p.extraStortingen.filter(e=>e.id!==id)}));

  const card=(ex={})=>({background:CARD,borderRadius:16,padding:20,border:"1px solid #1e3050",...ex});
  const DeleteBtn=({onClick})=>(
    <button onClick={onClick} style={{background:"transparent",border:"1px solid #2a3a55",color:"#556677",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:16,fontWeight:700,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=RED;e.currentTarget.style.color=RED;e.currentTarget.style.background="rgba(255,68,102,.08)";}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a3a55";e.currentTarget.style.color="#556677";e.currentTarget.style.background="transparent";}}>×</button>
  );
  const NavBtn=({v,label,onClick})=>(
    <button onClick={onClick||(()=>setView(v))} style={{padding:"7px 18px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,letterSpacing:.3,border:v===view?`1px solid ${TEAL}`:"1px solid #2a3a50",background:v===view?"rgba(0,229,204,.1)":"transparent",color:v===view?TEAL:"#8899aa"}}>{label}</button>
  );
  const BalansRow=({label,amount,color,bold})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1a2a40"}}>
      <div style={{fontSize:11,color:bold?"#ccdde8":"#8899aa",fontWeight:bold?700:400}}>{label}</div>
      <div style={{fontSize:11,fontWeight:bold?800:600,color:color||"#aabbcc",flexShrink:0}}>{fmt(amount)}</div>
    </div>
  );

  const vasteGroups=["mat_vaste","fin_vaste"], vlotGroups=["vorderingen","liquide"], activaGroups=["mat_vaste","fin_vaste","vorderingen","liquide"];

  if(authLoading) return <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontFamily:"'Inter',system-ui,sans-serif"}}><div style={{fontSize:14,color:"#8899aa"}}>Laden...</div></div>;

  if(!user) return (
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{background:CARD,borderRadius:20,padding:48,textAlign:"center",border:"1px solid #1e3050",maxWidth:380}}>
        <div style={{fontSize:32,marginBottom:8}}>💰</div>
        <div style={{fontSize:22,fontWeight:800,color:"white",marginBottom:8}}>Vermogen Tracker</div>
        <div style={{fontSize:13,color:"#8899aa",marginBottom:32,lineHeight:1.6}}>Log in met je Google account om je vermogenspositie bij te houden.</div>
        <button onClick={login} style={{background:TEAL,color:"#080f1e",border:"none",borderRadius:10,padding:"13px 32px",fontWeight:700,cursor:"pointer",fontSize:14,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6-6C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8 20-20 0-1.3-.1-2.7-.4-4z"/><path fill="#FF3D00" d="M6.3 14.7l6.9 5.1C15 16.1 19.2 13 24 13c3 0 5.7 1.1 7.8 2.9l6-6C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5l-6.3-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-3.4-11.2-8l-6.9 5.3C9.4 39.4 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.6-2.6 4.8-4.8 6.3l6.3 5.2C40.8 36.2 44 30.5 44 24c0-1.3-.1-2.7-.4-4z"/></svg>
          Inloggen met Google
        </button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:BG,color:"white",fontFamily:"'Inter',system-ui,sans-serif",fontSize:14}}>
      <style>{`input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}`}</style>

      {/* HEADER */}
      <div style={{background:"#080f1e",padding:"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #1a2a40",position:"sticky",top:0,zIndex:10}}>
        <div>
          <div style={{fontSize:10,color:"#667799",letterSpacing:1,marginBottom:2}}>EIGEN VERMOGEN TRACKER</div>
          <div style={{fontSize:24,fontWeight:800,color:TEAL,lineHeight:1}}>{fmt(latestNW)}</div>
          {latest&&<div style={{fontSize:10,color:"#445566",marginTop:3}}>Laatste snapshot: {fmtDate(latest.date)}</div>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <NavBtn v="overzicht" label="Overzicht"/>
          <NavBtn v="snapshot" label="Snapshot" onClick={()=>{ setView("snapshot"); if(editIdx===null) setNewSnap({date:new Date().toISOString().slice(0,10),values:latest?{...latest.values}:{...S2V},regularInleg:monthly,extraStortingen:[]}); }}/>
          <NavBtn v="instellingen" label="Instellingen"/>
          <div style={{marginLeft:8,display:"flex",alignItems:"center",gap:8}}>
            <img src={user.photoURL} alt="" style={{width:28,height:28,borderRadius:"50%",border:"1px solid #2a3a55"}}/>
            <button onClick={logout} style={{background:"transparent",border:"1px solid #2a3a55",color:"#8899aa",borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11}}>Uitloggen</button>
          </div>
        </div>
      </div>

      <div style={{padding:20,maxWidth:1200,margin:"0 auto"}}>

        {/* OVERZICHT */}
        {view==="overzicht"&&(
          sorted.length===0
          ?(<div style={{...card(),textAlign:"center",padding:60,color:"#8899aa"}}><div style={{fontSize:15,fontWeight:700,color:"white",marginBottom:8}}>Nog geen snapshots</div><button onClick={()=>setView("snapshot")} style={{background:TEAL,color:"#080f1e",border:"none",borderRadius:8,padding:"10px 28px",fontWeight:700,cursor:"pointer",fontSize:13,marginTop:12}}>Snapshot toevoegen</button></div>)
          :(<div style={{display:"flex",flexDirection:"column",gap:14}}>

            {/* KPI */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
              <div style={{...card(),background:"linear-gradient(135deg,#7c5cfc,#00e5cc)",border:"none"}}><div style={{fontSize:11,opacity:.8,marginBottom:4}}>Eigen Vermogen</div><div style={{fontSize:26,fontWeight:800}}>{fmt(latestNW)}</div><div style={{fontSize:11,opacity:.6,marginTop:4}}>{fmtDate(latest?.date)}</div></div>
              <div style={card()}><div style={{fontSize:11,color:"#8899aa",marginBottom:4}}>Vs. Verwachting</div><div style={{fontSize:24,fontWeight:800,color:diff>=0?TEAL:RED}}>{diff>=0?"+":""}{fmt(diff)}</div><div style={{fontSize:11,color:"#8899aa",marginTop:4}}>{diff>=0?"Voor op schema":"Achter op schema"}</div></div>
              <div style={card()}>
                <div style={{fontSize:11,color:"#8899aa",marginBottom:6}}>Inleg per maand</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{color:"#8899aa",fontSize:16}}>€</span><input type="number" value={monthly} onChange={e=>setMonthly(Number(e.target.value))} style={{...noSpinner,background:"transparent",border:"none",borderBottom:`1px solid ${PURP}`,color:PURP,fontSize:22,fontWeight:800,width:"100%",outline:"none",padding:"2px 0"}}/></div>
                <div style={{fontSize:11,color:"#8899aa",marginTop:6}}>{annualReturn}% rendement / jaar</div>
              </div>
              <div style={card()}><div style={{fontSize:11,color:"#8899aa",marginBottom:4}}>Verwacht over 12 mnd</div><div style={{fontSize:24,fontWeight:800,color:ORG}}>{fmt(expectedNWCorrect(latest?{date:latest.date,values:latest.values}:null,12,monthly,annualReturn/100,buckets))}</div><div style={{fontSize:11,color:"#8899aa",marginTop:4}}>prognose</div></div>
            </div>

            {/* Totaal vermogen */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:14,fontWeight:700}}>Totaal Eigen Vermogen</div>
                <div style={{display:"flex",gap:20,fontSize:11,color:"#8899aa"}}><span><span style={{color:TEAL}}>—</span> Werkelijk</span><span><span style={{color:PURP}}>- -</span> Verwacht</span></div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <XAxis dataKey="label" tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>"€"+(v/1000).toFixed(0)+"k"}/>
                  <Tooltip content={<TT/>} isAnimationActive={false}/>
                  <ReferenceLine y={0} stroke="#2a3a55"/>
                  <Line type="monotone" dataKey="werkelijk" name="Werkelijk" stroke={TEAL} strokeWidth={3} dot={{fill:TEAL,r:5}} connectNulls={false} isAnimationActive={false}/>
                  <Line type="monotone" dataKey="verwacht"  name="Verwacht"  stroke={PURP} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Beleggingen */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div><div style={{fontSize:14,fontWeight:700}}>Beleggingen — Werkelijk vs. Verwacht</div><div style={{fontSize:11,color:"#556677",marginTop:2}}>Inleg op de 20ste · extra stortingen op exacte datum · {annualReturn}%</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#8899aa",letterSpacing:.4}}>TOTAAL MARKTRESULTAAT</div><div style={{fontSize:18,fontWeight:800,color:totaalMarktResult>=0?TEAL:RED}}>{totaalMarktResult>=0?"+":""}{fmt(totaalMarktResult)}</div><div style={{fontSize:10,color:"#556677"}}>op kostenbasis {fmt(totaleKb)}</div></div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={beleggingData}>
                  <XAxis dataKey="label" tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>"€"+(v/1000).toFixed(1)+"k"}/>
                  <Tooltip content={<TT/>} isAnimationActive={false}/>
                  <Line type="monotone" dataKey="werkelijk" name="Werkelijk" stroke={PURP} strokeWidth={3} dot={{fill:PURP,r:5}} connectNulls={false} isAnimationActive={false}/>
                  <Line type="monotone" dataKey="verwacht"  name="Verwacht"  stroke={ORG}  strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>
                </LineChart>
              </ResponsiveContainer>
              {periodeData.length>0&&(
                <div style={{marginTop:20}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#8899aa",letterSpacing:.5,marginBottom:10}}>MARKTRENDEMENT PER PERIODE</div>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr style={{borderBottom:"1px solid #1e3050"}}>{["Periode","Waarde begin","Reg. inleg","Extra stortingen","Verwacht einde","Werkelijk","Marktresultaat","Rendement"].map(h=>(<th key={h} style={{textAlign:h==="Periode"?"left":"right",padding:"7px 10px",fontSize:10,color:"#667799",fontWeight:600}}>{h}</th>))}</tr></thead>
                    <tbody>{periodeData.map((p,i)=>{ const pos=p.marktResult>=0; return (<tr key={i} style={{borderBottom:"1px solid #131f35"}}>
                      <td style={{padding:"9px 10px",fontSize:11,color:"#aabbcc"}}>{fmtDate(p.van)} → {fmtDate(p.tot)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,color:"#8899aa"}}>{fmt(p.prevFv)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,color:GREEN}}>{fmt(p.regularInleg)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,color:p.totExtraStorting>0?BLUE:"#445566"}}>
                        {p.extraStortingen.length>0?p.extraStortingen.map((e,j)=>(<div key={j}>{fmt(Number(e.bedrag||0))} <span style={{fontSize:9,color:"#667799"}}>{fmtDate(e.datum)}</span></div>)):"—"}
                      </td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,color:"#8899aa"}}>{fmt(p.verwacht)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,color:PURP,fontWeight:600}}>{fmt(p.werkelijk)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right",fontSize:11,fontWeight:700,color:pos?TEAL:RED}}>{pos?"+":""}{fmt(p.marktResult)}</td>
                      <td style={{padding:"9px 10px",textAlign:"right"}}><span style={{background:pos?"rgba(0,229,204,.12)":"rgba(255,68,102,.12)",color:pos?TEAL:RED,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:700}}>{pos?"+":""}{p.marktPct}%</span></td>
                    </tr>); })}</tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Spaardiscipline */}
            <div style={card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                <div><div style={{fontSize:14,fontWeight:700}}>Spaardiscipline — Reguliere Inleg</div><div style={{fontSize:11,color:"#556677",marginTop:2}}>Cumulatief ingelegd vs. doel van €{monthly}/mnd</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#8899aa",letterSpacing:.4}}>HUIDIGE POSITIE</div><div style={{fontSize:18,fontWeight:800,color:inlegVerschilTotaal>=0?TEAL:RED}}>{inlegVerschilTotaal>=0?"+":""}{fmt(Math.round(inlegVerschilTotaal))}</div><div style={{fontSize:10,color:"#556677"}}>t.o.v. doel {fmt(Math.round(inlegDoel))}</div></div>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={spaarData}>
                  <XAxis dataKey="label" tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:"#8899aa",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>"€"+(v/1000).toFixed(1)+"k"}/>
                  <Tooltip content={<SpaarTT/>} isAnimationActive={false}/>
                  <ReferenceLine y={0} stroke="#2a3a55"/>
                  <Line type="monotone" dataKey="werkelijk" name="Werkelijk" stroke={GREEN} strokeWidth={3} dot={d=>d.payload?.isSnapshot?<circle key={d.key} cx={d.cx} cy={d.cy} r={5} fill={GREEN}/>:null} connectNulls={false} isAnimationActive={false}/>
                  <Line type="monotone" dataKey="doel"      name="Doel"      stroke={ORG}   strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Balans + Donut */}
            {(()=>{
              const totalVaste=vasteGroups.reduce((s,g)=>s+calcGroup(latest.values,g),0), totalVlot=vlotGroups.reduce((s,g)=>s+calcGroup(latest.values,g),0);
              const totalActiva=totalVaste+totalVlot, totalSchuld=calcGroup(latest.values,"schuld"), eigenVerm=totalActiva-totalSchuld;
              const pieData=activaGroups.map(gid=>{const g=GROUPS.find(x=>x.id===gid);return{name:g.label,value:calcGroup(latest.values,gid),color:g.color};}).filter(d=>d.value>0);
              return (<div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr",gap:14}}>
                <div style={card()}>
                  <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Balans</div>
                  <div style={{fontSize:10,color:"#556677",marginBottom:14}}>Peildatum: {fmtDate(latest.date)}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:.6,color:"#8899aa",marginBottom:8,paddingBottom:5,borderBottom:"1px solid #2a3a55"}}>DEBET — ACTIVA</div>
                      {[vasteGroups,vlotGroups].map((grp,gi)=>(<div key={gi}>
                        <div style={{fontSize:10,fontWeight:700,color:"#667799",marginTop:8,marginBottom:4}}>{gi===0?"Vaste activa":"Vlottende activa"}</div>
                        {grp.map(gid=>{ const g=GROUPS.find(x=>x.id===gid), items=buckets.filter(b=>b.group===gid), groupTotal=calcGroup(latest.values,gid); if(!groupTotal) return null;
                          return (<div key={gid} style={{marginBottom:6}}>
                            <div style={{fontSize:10,color:g.color,fontWeight:600,padding:"4px 0",borderBottom:`1px solid ${g.color}33`}}>{g.label}</div>
                            {items.map(b=>{ const v=Number(latest.values[b.id]||0); if(!v) return null; const fc=fmtC(v,g.color); return(<div key={b.id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0 3px 10px"}}><div style={{fontSize:10,color:"#8899aa"}}>{b.name}</div><div style={{fontSize:10,color:fc.color}}>{fc.text}</div></div>); })}
                            <div style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderTop:"1px solid #1a2a40"}}><div style={{fontSize:10,color:"#667799",fontStyle:"italic"}}>Subtotaal</div><div style={{fontSize:10,fontWeight:700,color:g.color}}>{fmt(groupTotal)}</div></div>
                          </div>);
                        })}
                        <BalansRow label={gi===0?"Totaal vaste activa":"Totaal vlottende activa"} amount={gi===0?totalVaste:totalVlot} color={BLUE} bold/>
                      </div>))}
                      <div style={{marginTop:10,padding:"8px 0",borderTop:"2px solid #2a3a55",display:"flex",justifyContent:"space-between"}}><div style={{fontSize:12,fontWeight:800,color:"white"}}>Totaal activa</div><div style={{fontSize:12,fontWeight:800,color:TEAL}}>{fmt(totalActiva)}</div></div>
                    </div>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,letterSpacing:.6,color:"#8899aa",marginBottom:8,paddingBottom:5,borderBottom:"1px solid #2a3a55"}}>CREDIT — PASSIVA</div>
                      <div style={{fontSize:10,fontWeight:700,color:"#667799",marginTop:8,marginBottom:4}}>Vreemd vermogen</div>
                      {totalSchuld>0?buckets.filter(b=>b.group==="schuld").map(b=>{ const v=Number(latest.values[b.id]||0); return v>0?(<div key={b.id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0 3px 10px"}}><div style={{fontSize:10,color:"#8899aa"}}>{b.name}</div><div style={{fontSize:10,color:RED}}>{fmt(v)}</div></div>):null; }):<div style={{fontSize:11,color:"#445566",fontStyle:"italic",padding:"6px 0"}}>Geen schulden</div>}
                      <BalansRow label="Totaal vreemd vermogen" amount={totalSchuld} color={RED} bold/>
                      <div style={{fontSize:10,fontWeight:700,color:"#667799",marginTop:12,marginBottom:4}}>Eigen vermogen</div>
                      <BalansRow label="Eigen vermogen" amount={eigenVerm} color={PURP} bold/>
                      <div style={{marginTop:10,padding:"8px 0",borderTop:"2px solid #2a3a55",display:"flex",justifyContent:"space-between"}}><div style={{fontSize:12,fontWeight:800,color:"white"}}>Totaal passiva</div><div style={{fontSize:12,fontWeight:800,color:PURP}}>{fmt(totalSchuld+eigenVerm)}</div></div>
                    </div>
                  </div>
                </div>
                <div style={card()}>
                  <div style={{fontSize:14,fontWeight:700,marginBottom:2}}>Vermogensverdeling</div>
                  <div style={{fontSize:10,color:"#556677",marginBottom:14}}>Samenstelling totale activa</div>
                  <ResponsiveContainer width="100%" height={180}><PieChart><Pie data={pieData} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={3} startAngle={90} endAngle={-270}>{pieData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie><Tooltip formatter={v=>fmt(v)} contentStyle={{background:CARD2,border:"1px solid #2a3a55",borderRadius:8,fontSize:12}}/></PieChart></ResponsiveContainer>
                  <div style={{marginTop:8}}>{pieData.map((d,i)=>{ const pct=Math.round((d.value/totalActiva)*100); return(<div key={i} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:11,color:"#aabbcc"}}>{d.name}</span><span style={{fontSize:11,fontWeight:700,color:d.color}}>{fmt(d.value)} <span style={{color:"#667799"}}>({pct}%)</span></span></div><div style={{background:"#1a2a40",borderRadius:3,height:4}}><div style={{background:d.color,width:`${pct}%`,height:"100%",borderRadius:3}}/></div></div>); })}</div>
                </div>
              </div>);
            })()}

            {/* Geschiedenis */}
            <div style={card()}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>Snapshot geschiedenis</div>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr style={{borderBottom:"1px solid #1e3050"}}>{["Datum","Eigen Vermogen","Groei periode","Vs. Verwacht",""].map(h=>(<th key={h} style={{textAlign:h==="Datum"?"left":"right",padding:"8px 10px",fontSize:10,color:"#667799",fontWeight:600,letterSpacing:.4}}>{h}</th>))}</tr></thead>
                <tbody>{sorted.map((s,i)=>{ const nw=calcNW(s.values), prevNW=i>0?calcNW(sorted[i-1].values):null, groei=prevNW!==null?nw-prevNW:null; const months=first?monthsBetween(first.date,s.date):0, exp=i===0?nw:expectedNWCorrect(first,months,monthly,annualReturn/100,buckets), d=nw-exp;
                  return (<tr key={s.date+i} style={{borderBottom:"1px solid #131f35"}}>
                    <td style={{padding:"10px",fontWeight:600,fontSize:12}}>{fmtDate(s.date)}</td>
                    <td style={{padding:"10px",textAlign:"right",fontWeight:700,color:TEAL}}>{fmt(nw)}</td>
                    <td style={{padding:"10px",textAlign:"right",fontSize:12,fontWeight:600,color:groei===null?"#8899aa":groei>=0?TEAL:RED}}>{groei===null?"—":(groei>=0?"+":"")+fmt(groei)}</td>
                    <td style={{padding:"10px",textAlign:"right",fontSize:12,color:i===0?"#8899aa":d>=0?TEAL:RED}}>{i===0?"—":(d>=0?"+":"")+fmt(d)}</td>
                    <td style={{padding:"10px",textAlign:"right",display:"flex",gap:6,justifyContent:"flex-end"}}>
                      <button onClick={()=>startEdit(i)} style={{background:"transparent",border:"1px solid #2a3a55",color:"#8899aa",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11}}>Bewerk</button>
                      <button onClick={()=>setSnapshots(p=>p.filter(x=>x.date!==s.date))} style={{background:"transparent",border:"1px solid #2a3a55",color:"#556677",borderRadius:6,width:28,height:28,cursor:"pointer",fontSize:16,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=RED;e.currentTarget.style.color=RED;}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a3a55";e.currentTarget.style.color="#556677";}}>×</button>
                    </td>
                  </tr>);
                })}</tbody>
              </table>
            </div>

          </div>)
        )}

        {/* SNAPSHOT */}
        {view==="snapshot"&&(
          <div style={{maxWidth:620,margin:"0 auto",display:"flex",flexDirection:"column",gap:14}}>
            <div style={card()}>
              <div style={{fontSize:15,fontWeight:700,marginBottom:2}}>{editIdx!==null?"Snapshot bewerken":"Nieuwe snapshot"}</div>
              <div style={{fontSize:12,color:"#8899aa",marginBottom:18}}>Vul de huidige waarden in.</div>
              <div style={{marginBottom:20}}>
                <label style={{fontSize:11,color:"#8899aa",display:"block",marginBottom:5,letterSpacing:.4}}>DATUM</label>
                <input type="date" value={newSnap.date} onChange={e=>setNewSnap(p=>({...p,date:e.target.value}))} style={inp()}/>
              </div>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#667799",marginBottom:12,paddingBottom:6,borderBottom:"2px solid #2a3a55"}}>ACTIVA</div>
              {GROUPS.filter(g=>g.side==="activa").map(g=>{
                const items=buckets.filter(b=>b.group===g.id), subtotal=items.reduce((s,b)=>s+Number(newSnap.values[b.id]||0),0), isAdding=inlineAdd===g.id;
                return (<div key={g.id} style={{marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,paddingBottom:6,borderBottom:`1px solid ${g.color}55`}}>
                    <div><div style={{fontSize:12,fontWeight:700,color:g.color}}>{g.label}</div><div style={{fontSize:10,color:"#556677"}}>{g.sub}</div></div>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontSize:13,fontWeight:700,color:g.color}}>{fmt(subtotal)}</div>
                      <button onClick={()=>{setInlineAdd(isAdding?null:g.id);setInlineForm(EMPTY_INLINE);}} style={{padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,border:`1px solid ${isAdding?RED:g.color}44`,background:"transparent",color:isAdding?RED:g.color}}>{isAdding?"Annuleer":"+ Post"}</button>
                    </div>
                  </div>
                  {items.map(b=>(<div key={b.id} style={{display:"grid",gridTemplateColumns:"1fr 150px 28px",gap:8,alignItems:"center",marginBottom:10}}>
                    <div><div style={{fontSize:12,fontWeight:500}}>{b.name}</div>{b.note&&<div style={{fontSize:10,color:"#667799"}}>{b.note}</div>}</div>
                    <div style={{position:"relative"}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8899aa",fontSize:13}}>€</span><input type="number" placeholder="0" value={newSnap.values[b.id]??""} onChange={e=>setNewSnap(p=>({...p,values:{...p.values,[b.id]:e.target.value}}))} style={{...inp({paddingLeft:24,textAlign:"right"}),...noSpinner}}/></div>
                    <DeleteBtn onClick={()=>deleteBucket(b.id)}/>
                  </div>))}
                  {items.length===0&&!isAdding&&<div style={{fontSize:11,color:"#445566",fontStyle:"italic",padding:"4px 0"}}>Geen posten — klik op "+ Post".</div>}
                  {isAdding&&(<div style={{background:CARD2,borderRadius:10,padding:14,marginTop:4,border:`1px solid ${g.color}33`}}>
                    <div style={{fontSize:11,fontWeight:600,color:g.color,marginBottom:10}}>NIEUWE POST</div>
                    <input placeholder="Naam" value={inlineForm.name} onChange={e=>setInlineForm(p=>({...p,name:e.target.value}))} style={{...inp(),marginBottom:8}}/>
                    <input placeholder="Toelichting (optioneel)" value={inlineForm.note} onChange={e=>setInlineForm(p=>({...p,note:e.target.value}))} style={{...inp(),marginBottom:10}}/>
                    <button onClick={saveInline} style={{background:g.color,color:"#080f1e",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,cursor:"pointer",fontSize:12,width:"100%"}}>Post toevoegen</button>
                  </div>)}
                </div>);
              })}

              {/* Inleg sectie */}
              <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#667799",marginBottom:12,paddingBottom:6,borderBottom:"2px solid #2a3a55"}}>INLEG BELEGGINGEN DEZE PERIODE</div>
              <div style={{background:CARD2,borderRadius:10,padding:14,marginBottom:20}}>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:11,color:GREEN,display:"block",marginBottom:5,fontWeight:600}}>REGULIERE INLEG (vanuit inkomen)</label>
                  <div style={{position:"relative"}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8899aa",fontSize:13}}>€</span><input type="number" min="0" placeholder="0" value={newSnap.regularInleg??""} onChange={e=>setNewSnap(p=>({...p,regularInleg:e.target.value}))} style={{...inp({paddingLeft:24,textAlign:"right"}),...noSpinner}}/></div>
                  <div style={{fontSize:10,color:"#445566",marginTop:4}}>Telt mee voor spaardiscipline</div>
                </div>

                {/* Meerdere extra stortingen */}
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <label style={{fontSize:11,color:BLUE,fontWeight:600}}>EXTRA STORTINGEN</label>
                    <button onClick={addExtraStorting} style={{padding:"3px 10px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,border:`1px solid ${BLUE}44`,background:"transparent",color:BLUE}}>+ Toevoegen</button>
                  </div>
                  {(newSnap.extraStortingen||[]).length===0&&<div style={{fontSize:11,color:"#445566",fontStyle:"italic"}}>Nog geen extra stortingen — bijv. schenkingen of terugbetalingen.</div>}
                  {(newSnap.extraStortingen||[]).map(e=>(
                    <div key={e.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 28px",gap:8,alignItems:"center",marginBottom:8}}>
                      <div style={{position:"relative"}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8899aa",fontSize:13}}>€</span><input type="number" min="0" placeholder="Bedrag" value={e.bedrag} onChange={ev=>updateExtraStorting(e.id,"bedrag",ev.target.value)} style={{...inp({paddingLeft:24,textAlign:"right"}),...noSpinner}}/></div>
                      <input type="date" value={e.datum} onChange={ev=>updateExtraStorting(e.id,"datum",ev.target.value)} style={inp()}/>
                      <DeleteBtn onClick={()=>removeExtraStorting(e.id)}/>
                    </div>
                  ))}
                  <div style={{fontSize:10,color:"#445566",marginTop:6}}>Elke storting rendeert vanaf de opgegeven datum · telt niet mee voor spaardiscipline</div>
                </div>
              </div>

              <div style={{fontSize:10,fontWeight:700,letterSpacing:.8,color:"#667799",marginBottom:12,paddingBottom:6,borderBottom:"2px solid #2a3a55"}}>PASSIVA — SCHULDEN</div>
              {GROUPS.filter(g=>g.side==="passiva").map(g=>{
                const items=buckets.filter(b=>b.group===g.id), isAdding=inlineAdd===g.id;
                return (<div key={g.id} style={{marginBottom:20}}>
                  {items.map(b=>(<div key={b.id} style={{display:"grid",gridTemplateColumns:"1fr 150px 28px",gap:8,alignItems:"center",marginBottom:10}}>
                    <div><div style={{fontSize:12,fontWeight:500}}>{b.name}</div>{b.note&&<div style={{fontSize:10,color:"#667799"}}>{b.note}</div>}</div>
                    <div style={{position:"relative"}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"#8899aa",fontSize:13}}>€</span><input type="number" min="0" placeholder="0" value={newSnap.values[b.id]??""} onChange={e=>setNewSnap(p=>({...p,values:{...p.values,[b.id]:e.target.value}}))} style={{...inp({paddingLeft:24,textAlign:"right"}),...noSpinner}}/></div>
                    <DeleteBtn onClick={()=>deleteBucket(b.id)}/>
                  </div>))}
                  {items.length===0&&!isAdding&&<div style={{fontSize:11,color:"#445566",fontStyle:"italic",padding:"4px 0"}}>Geen schulden.</div>}
                  <button onClick={()=>{setInlineAdd(isAdding?null:g.id);setInlineForm(EMPTY_INLINE);}} style={{marginTop:6,padding:"4px 12px",borderRadius:5,cursor:"pointer",fontSize:11,fontWeight:600,border:`1px solid ${RED}44`,background:"transparent",color:RED}}>{isAdding?"Annuleer":"+ Schuld toevoegen"}</button>
                  {isAdding&&(<div style={{background:CARD2,borderRadius:10,padding:14,marginTop:10,border:`1px solid ${RED}33`}}>
                    <div style={{fontSize:11,fontWeight:600,color:RED,marginBottom:10}}>NIEUWE SCHULD</div>
                    <input placeholder="Naam" value={inlineForm.name} onChange={e=>setInlineForm(p=>({...p,name:e.target.value}))} style={{...inp(),marginBottom:8}}/>
                    <input placeholder="Toelichting" value={inlineForm.note} onChange={e=>setInlineForm(p=>({...p,note:e.target.value}))} style={{...inp(),marginBottom:10}}/>
                    <button onClick={saveInline} style={{background:RED,color:"white",border:"none",borderRadius:7,padding:"8px 20px",fontWeight:700,cursor:"pointer",fontSize:12,width:"100%"}}>Schuld toevoegen</button>
                  </div>)}
                </div>);
              })}

              <div style={{background:CARD2,borderRadius:10,padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <span style={{fontSize:12,color:"#8899aa",fontWeight:600,letterSpacing:.3}}>EIGEN VERMOGEN</span>
                <span style={{fontSize:22,fontWeight:800,color:TEAL}}>{fmt(calcNW(newSnap.values))}</span>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={saveSnap} style={{flex:1,background:TEAL,color:"#080f1e",border:"none",borderRadius:8,padding:"12px",fontWeight:700,cursor:"pointer",fontSize:13}}>{editIdx!==null?"Opslaan":"Snapshot opslaan"}</button>
                <button onClick={()=>{setView("overzicht");setEditIdx(null);setInlineAdd(null);}} style={{padding:"12px 20px",background:"transparent",border:"1px solid #2a3a55",color:"#8899aa",borderRadius:8,cursor:"pointer",fontSize:13}}>Annuleren</button>
              </div>
            </div>
          </div>
        )}

        {/* INSTELLINGEN */}
        {view==="instellingen"&&(
          <div style={{maxWidth:620,margin:"0 auto",display:"flex",flexDirection:"column",gap:14}}>
            <div style={card()}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:16}}>Groeiverwachting</div>
              <div style={{marginBottom:14}}><label style={{fontSize:11,color:"#8899aa",display:"block",marginBottom:5,letterSpacing:.4}}>MAANDELIJKS INLEGGEN (€)</label><input type="number" value={monthly} onChange={e=>setMonthly(Number(e.target.value))} style={{...inp(),...noSpinner}}/></div>
              <div><label style={{fontSize:11,color:"#8899aa",display:"block",marginBottom:5,letterSpacing:.4}}>VERWACHT JAARRENDEMENT (%)</label><input type="number" value={annualReturn} step="0.5" onChange={e=>setAnnualReturn(Number(e.target.value))} style={{...inp(),...noSpinner}}/><div style={{fontSize:11,color:"#445566",marginTop:6}}>Vanguard All-World historisch gemiddelde ≈ 7–9% per jaar</div></div>
            </div>
            <div style={card()}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Kostenbasis beleggingen</div>
              <div style={{fontSize:12,color:"#8899aa",marginBottom:14}}>Bedrag ingelegd vóór je eerste snapshot.</div>
              <label style={{fontSize:11,color:"#8899aa",display:"block",marginBottom:5,letterSpacing:.4}}>BEGINKOSTENBASIS (€)</label>
              <input type="number" value={startKb} onChange={e=>setStartKb(Number(e.target.value))} style={{...inp(),...noSpinner}}/>
              <div style={{fontSize:11,color:"#445566",marginTop:6}}>Begin: {fmt(startKb)} · Totaal nu: {fmt(totaleKb)}</div>
            </div>
            <div style={card()}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Posten beheren</div>
              <div style={{fontSize:12,color:"#8899aa",marginBottom:16}}>Sleep posten om de volgorde aan te passen. Klik op de naam om te hernoemen.</div>
              {GROUPS.map(g=>(
                <div key={g.id} style={{marginBottom:20}}>
                  <div style={{fontSize:11,fontWeight:700,color:g.color,marginBottom:8,letterSpacing:.4}}>{g.label.toUpperCase()}</div>
                  {buckets.filter(b=>b.group===g.id).map(b=>(
                    <div key={b.id} draggable onDragStart={e=>handleDragStart(e,b.id)} onDragOver={e=>handleDragOver(e,b.id)} onDrop={e=>handleDrop(e,b.id)} onDragLeave={()=>setDragOver(null)}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderBottom:"1px solid #1a2a40",borderRadius:8,background:dragOver===b.id?"rgba(0,229,204,.06)":"transparent",cursor:"grab",transition:"background .15s"}}>
                      <span style={{color:"#445566",fontSize:16,cursor:"grab"}}>⠿</span>
                      <div style={{flex:1}}>
                        {editingBucket===b.id
                          ?(<input autoFocus value={editingName} onChange={e=>setEditingName(e.target.value)} onBlur={()=>{renameBucket(b.id,editingName);setEditingBucket(null);}} onKeyDown={e=>{if(e.key==="Enter"){renameBucket(b.id,editingName);setEditingBucket(null);}if(e.key==="Escape")setEditingBucket(null);}} style={{...inp(),padding:"4px 8px",fontSize:12,width:"100%"}}/>)
                          :(<div style={{fontSize:12,fontWeight:500,cursor:"pointer"}} onClick={()=>{setEditingBucket(b.id);setEditingName(b.name);}}>{b.name} <span style={{fontSize:10,color:"#445566"}}>✏️</span></div>)
                        }
                        {b.note&&<div style={{fontSize:10,color:"#667799"}}>{b.note}</div>}
                      </div>
                      <DeleteBtn onClick={()=>deleteBucket(b.id)}/>
                    </div>
                  ))}
                  {!buckets.filter(b=>b.group===g.id).length&&<div style={{fontSize:11,color:"#445566",fontStyle:"italic"}}>Geen posten</div>}
                </div>
              ))}
              <div style={{marginTop:10,background:CARD2,borderRadius:10,padding:14}}>
                <div style={{fontSize:11,fontWeight:700,color:TEAL,marginBottom:12,letterSpacing:.4}}>POST TOEVOEGEN</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <input placeholder="Naam" value={newBucket.name} onChange={e=>setNewBucket(p=>({...p,name:e.target.value}))} style={inp()}/>
                  <select value={newBucket.group} onChange={e=>setNewBucket(p=>({...p,group:e.target.value}))} style={inp()}>{GROUPS.map(g=><option key={g.id} value={g.id}>{g.label}</option>)}</select>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 100px",gap:8}}>
                  <input placeholder="Toelichting (optioneel)" value={newBucket.note} onChange={e=>setNewBucket(p=>({...p,note:e.target.value}))} style={inp()}/>
                  <button onClick={addBucket} style={{background:TEAL,color:"#080f1e",border:"none",borderRadius:8,fontWeight:700,cursor:"pointer",fontSize:13}}>Toevoegen</button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}