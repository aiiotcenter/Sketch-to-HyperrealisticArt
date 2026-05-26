import React, { useRef, useState, useEffect, useCallback } from "react";

const LABELS = [
  { name:"Grass",    color:"#3a8c3f", rgb:[58,140,63],   icon:"🌿" },
  { name:"Water",    color:"#2e86c1", rgb:[46,134,193],  icon:"💧" },
  { name:"Mountain", color:"#6c6c6c", rgb:[108,108,108], icon:"⛰️"  },
  { name:"Snow",     color:"#c8d8e8", rgb:[200,216,232], icon:"❄️"  },
  { name:"Rock",     color:"#9e9e9e", rgb:[158,158,158], icon:"🪨"  },
  { name:"Tree",     color:"#1b5e20", rgb:[27,94,32],    icon:"🌲"  },
  { name:"Road",     color:"#b0bec5", rgb:[176,190,197], icon:"🛤️"  },
  { name:"Building", color:"#c2824a", rgb:[194,130,74],  icon:"🏠"  },
  { name:"Sand",     color:"#d4a96a", rgb:[212,169,106], icon:"🏖️"  },
];

const TOOLS = [
  { id:"brush",    icon:"✏️",  label:"Brush",     key:"B" },
  { id:"eraser",   icon:"🧹", label:"Eraser",    key:"E" },
  { id:"fill",     icon:"🪣", label:"Fill",      key:"F" },
  { id:"rect",     icon:"⬜", label:"Rectangle", key:"R" },
  { id:"circle",   icon:"⭕", label:"Circle",    key:"C" },
  { id:"triangle", icon:"🔺", label:"Triangle",  key:"T" },
  { id:"line",     icon:"╱",  label:"Line",      key:"L" },
];

const SZ = 1024;
const HISTORY_MAX = 8;

// ── Palette ──────────────────────────────────────────────────────────────
const BG      = "#0a0520";      // very dark purple-black
const SIDEBAR = "#1a0f3e";      // deep purple panels
const ACCENT  = "#6c47ff";      // vivid purple accent
const ACCENTB = "#38bdf8";      // sky blue for highlights
const BORDER  = "rgba(108,71,255,.35)";
const TEXT    = "#e2e8f0";
const MUTED   = "#7c6fa0";
const BOTTOM  = "#060d2a";      // dark navy for bottom section

function canvasToBlob(c) { return new Promise(r => c.toBlob(r, "image/png")); }

function floodFillCanvas(canvas, sx, sy, rgb) {
  const ctx = canvas.getContext("2d");
  const id  = ctx.getImageData(0,0,SZ,SZ);
  const d   = id.data;
  const idx = (x,y) => (y*SZ+x)*4;
  const si  = idx(sx,sy);
  const [tR,tG,tB] = [d[si],d[si+1],d[si+2]];
  const [fR,fG,fB] = rgb;
  if(tR===fR&&tG===fG&&tB===fB) return;
  const tol=30, ok=(x,y)=>{const i=idx(x,y);return Math.abs(d[i]-tR)<tol&&Math.abs(d[i+1]-tG)<tol&&Math.abs(d[i+2]-tB)<tol;};
  const stack=[[sx,sy]], vis=new Uint8Array(SZ*SZ);
  while(stack.length){
    const[x,y]=stack.pop();
    if(x<0||y<0||x>=SZ||y>=SZ)continue;
    const f=y*SZ+x;
    if(vis[f]||!ok(x,y))continue;
    vis[f]=1;
    const i=idx(x,y);d[i]=fR;d[i+1]=fG;d[i+2]=fB;d[i+3]=255;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
  ctx.putImageData(id,0,0);
}

function drawShape(ctx,tool,color,x1,y1,x2,y2,size,alpha=1) {
  ctx.globalAlpha=alpha;
  ctx.fillStyle=color; ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineCap="round"; ctx.lineJoin="round";
  const w=x2-x1, h=y2-y1;
  ctx.beginPath();
  if(tool==="rect"){ ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(w),Math.abs(h)); }
  else if(tool==="circle"){ ctx.ellipse(x1+w/2,y1+h/2,Math.abs(w)/2,Math.abs(h)/2,0,0,Math.PI*2); ctx.fill(); }
  else if(tool==="triangle"){ const bx=Math.min(x1,x2),by=Math.max(y1,y2),bw=Math.abs(w); ctx.moveTo(bx+bw/2,Math.min(y1,y2));ctx.lineTo(bx,by);ctx.lineTo(bx+bw,by);ctx.closePath();ctx.fill(); }
  else if(tool==="line"){ ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke(); }
  ctx.globalAlpha=1;
}

export default function App() {
  const canvasRef  = useRef(null);
  const overlayRef = useRef(null);
  const lastPos    = useRef(null);
  const shapeStart = useRef(null);

  const [activeTool,    setActiveTool]    = useState("brush");
  const [activeLabel,   setActiveLabel]   = useState(LABELS[0]);
  const [brushSize,     setBrushSize]     = useState(40);
  const [opacity,       setOpacity]       = useState(1.0);
  const [drawing,       setDrawing]       = useState(false);
  const [undoStack,     setUndoStack]     = useState([]);
  const [redoStack,     setRedoStack]     = useState([]);
  const [generated,     setGenerated]     = useState(null);
  const [isLoading,     setIsLoading]     = useState(false);
  const [error,         setError]         = useState(null);
  const [history,       setHistory]       = useState([]);
  const [terrainInfo,   setTerrainInfo]   = useState(null);
  const [promptText,    setPromptText]    = useState("");
  const [styleStrength, setStyleStrength] = useState(1.0);
  const [cursorPos,     setCursorPos]     = useState({x:0,y:0});
  const [showCursor,    setShowCursor]    = useState(false);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#3a8c3f";
    ctx.fillRect(0,0,SZ,SZ);
    overlayRef.current.getContext("2d").clearRect(0,0,SZ,SZ);
  }, []);

  // ── Undo / Redo ─────────────────────────────────────────────────────────
  const saveUndo = useCallback(() => {
    const snap = canvasRef.current.toDataURL("image/png");
    setUndoStack(p => [...p.slice(-29), snap]);
    setRedoStack([]);
  }, []);

  const doUndo = useCallback(() => {
    setUndoStack(p => {
      if (p.length < 2) return p;
      const prev = p[p.length-2];
      setRedoStack(r => [...r, p[p.length-1]]);
      const img = new window.Image();
      img.onload = () => { const c=canvasRef.current.getContext("2d"); c.clearRect(0,0,SZ,SZ); c.drawImage(img,0,0); };
      img.src = prev;
      return p.slice(0,-1);
    });
  }, []);

  const doRedo = useCallback(() => {
    setRedoStack(r => {
      if (!r.length) return r;
      const next = r[r.length-1];
      setUndoStack(u => [...u, next]);
      const img = new window.Image();
      img.onload = () => { const c=canvasRef.current.getContext("2d"); c.clearRect(0,0,SZ,SZ); c.drawImage(img,0,0); };
      img.src = next;
      return r.slice(0,-1);
    });
  }, []);

  const doClear = () => {
    saveUndo();
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#3a8c3f";
    ctx.fillRect(0,0,SZ,SZ);
  };

  // ── Coords ──────────────────────────────────────────────────────────────
  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = SZ/rect.width, sy = SZ/rect.height;
    const cx = e.touches?e.touches[0].clientX:e.clientX;
    const cy = e.touches?e.touches[0].clientY:e.clientY;
    return { x:Math.round((cx-rect.left)*sx), y:Math.round((cy-rect.top)*sy), px:cx-rect.left, py:cy-rect.top };
  };

  // ── Paint ───────────────────────────────────────────────────────────────
  const paintAt = (x,y,px,py) => {
    const ctx = canvasRef.current.getContext("2d");
    const isEraser = activeTool==="eraser";
    ctx.globalAlpha = isEraser?1:opacity;
    ctx.fillStyle   = isEraser?"#3a8c3f":activeLabel.color;
    ctx.strokeStyle = isEraser?"#3a8c3f":activeLabel.color;
    ctx.lineWidth   = brushSize; ctx.lineCap="round"; ctx.lineJoin="round";
    if(px!==null){ ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(x,y,brushSize/2,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  };

  const drawPreview = (x1,y1,x2,y2) => {
    const pctx = overlayRef.current.getContext("2d");
    pctx.clearRect(0,0,SZ,SZ);
    drawShape(pctx,activeTool,activeLabel.color,x1,y1,x2,y2,brushSize,0.55);
  };

  // ── Pointer ─────────────────────────────────────────────────────────────
  const onDown = (e) => {
    e.preventDefault();
    const pos = getPos(e);
    if(activeTool==="fill"){ saveUndo(); floodFillCanvas(canvasRef.current,pos.x,pos.y,activeLabel.rgb); return; }
    if(["rect","circle","triangle","line"].includes(activeTool)){ shapeStart.current={x:pos.x,y:pos.y}; setDrawing(true); return; }
    saveUndo(); setDrawing(true); lastPos.current=pos; paintAt(pos.x,pos.y,null,null);
  };

  const onMove = (e) => {
    e.preventDefault();
    const pos = getPos(e);
    setCursorPos({x:pos.px,y:pos.py}); setShowCursor(true);
    if(!drawing)return;
    if(["rect","circle","triangle","line"].includes(activeTool)&&shapeStart.current){ drawPreview(shapeStart.current.x,shapeStart.current.y,pos.x,pos.y); return; }
    if(activeTool==="brush"||activeTool==="eraser"){ paintAt(pos.x,pos.y,lastPos.current?.x??null,lastPos.current?.y??null); lastPos.current=pos; }
  };

  const onUp = (e) => {
    if(!drawing)return; setDrawing(false);
    if(["rect","circle","triangle","line"].includes(activeTool)&&shapeStart.current){
      const pos=getPos(e);
      overlayRef.current.getContext("2d").clearRect(0,0,SZ,SZ);
      saveUndo();
      const ctx=canvasRef.current.getContext("2d");
      ctx.globalAlpha=opacity;
      drawShape(ctx,activeTool,activeLabel.color,shapeStart.current.x,shapeStart.current.y,pos.x,pos.y,brushSize);
      ctx.globalAlpha=1;
      shapeStart.current=null;
    }
    lastPos.current=null;
  };

  const onLeave = () => { setShowCursor(false); if(drawing) onUp({clientX:0,clientY:0}); };

  // ── Generate ────────────────────────────────────────────────────────────
  const doGenerate = async () => {
    setIsLoading(true); setError(null); setPromptText(""); setTerrainInfo(null);
    try {
      const blob = await canvasToBlob(canvasRef.current);
      const form = new FormData();
      form.append("file",blob,"segmap.png");
      form.append("style_strength",styleStrength);
      form.append("output_mode","full");
      const res = await fetch(`/generate?style_strength=${styleStrength}&output_mode=full`,{method:"POST",body:form});
      if(!res.ok){let e=`Error ${res.status}`;try{const j=await res.json();e=j.detail||e;}catch(_){}throw new Error(e);}
      const data = await res.json();
      setGenerated(data.image);
      if(data.prompt)   setPromptText(data.prompt);
      if(data.analysis) setTerrainInfo(data.analysis);
      setHistory(h=>[{id:Date.now(),src:data.image},...h].slice(0,HISTORY_MAX));
    } catch(err){
      const m=err.message||"";
      if(m.includes("Failed to fetch")||m.includes("ERR_CONNECTION_REFUSED"))
        setError("❌ Backend not running. Run: cd backend → uvicorn main:app --reload --port 8000");
      else if(m.includes("API key"))
        setError("❌ No API key. Create backend/.env with REPLICATE_API_KEY=r8_...");
      else setError("⚠️ "+m);
    } finally { setIsLoading(false); }
  };

  const doSave = () => {
    if(!generated)return;
    const a=document.createElement("a"); a.href=generated; a.download=`satellite_${Date.now()}.png`; a.click();
  };

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(()=>{
    const h=(e)=>{
      if(e.target.tagName==="INPUT")return;
      if((e.ctrlKey||e.metaKey)&&e.key==="z"){e.preventDefault();doUndo();}
      if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="Z"))){e.preventDefault();doRedo();}
      const keys={b:"brush",e:"eraser",f:"fill",r:"rect",c:"circle",t:"triangle",l:"line"};
      if(keys[e.key]&&!e.ctrlKey&&!e.metaKey)setActiveTool(keys[e.key]);
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[doUndo,doRedo]);

  const isBrush = activeTool==="brush"||activeTool==="eraser";

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:BG,fontFamily:"'DM Sans','Segoe UI',sans-serif",color:TEXT,overflow:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-thumb{background:${ACCENT}55;border-radius:3px;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes glow{0%,100%{box-shadow:0 0 12px ${ACCENT}60}50%{box-shadow:0 0 28px ${ACCENT}cc,0 0 50px ${ACCENT}40}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .tool-btn:hover{background:${ACCENT}25!important;border-color:${ACCENT}80!important;}
        .tool-btn.on{background:${ACCENT}35!important;border-color:${ACCENT}!important;color:#fff!important;}
        .swatch:hover{transform:scale(1.18);border-color:rgba(255,255,255,.5)!important;}
        .swatch.on{transform:scale(1.08);border:3px solid #fff!important;box-shadow:0 0 0 2px ${ACCENT},0 0 14px ${ACCENT}80!important;}
        .hist-btn:hover{border-color:${ACCENT}!important;transform:scale(1.04);}
        input[type=range]{-webkit-appearance:none;height:3px;border-radius:2px;outline:none;cursor:pointer;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;cursor:pointer;border:2px solid ${BG};}
      `}</style>

      {/* ── HEADER ── */}
      <header style={{height:50,background:`linear-gradient(135deg,#160840,#0d0628)`,borderBottom:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 18px",flexShrink:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(135deg,${ACCENT},#a855f7)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:`0 0 18px ${ACCENT}70`}}>🛰️</div>
          <div>
            <div style={{fontFamily:"'Space Grotesk'",fontWeight:700,fontSize:15,color:"#f5f0ff",letterSpacing:"-.2px"}}>GauGAN Studio</div>
            <div style={{fontSize:9,color:MUTED,marginTop:1}}>Satellite Map Generator · Flux.1 Canny Pro</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {[["↩","Undo",doUndo,undoStack.length<2],["↪","Redo",doRedo,redoStack.length===0],["🗑","Clear",doClear,false]].map(([icon,label,fn,dis])=>(
            <button key={label} onClick={fn} disabled={dis} title={label}
              style={{width:30,height:30,borderRadius:7,border:`1px solid ${BORDER}`,background:"transparent",color:dis?"#2a1a5e":MUTED,cursor:dis?"not-allowed":"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}
              onMouseEnter={e=>{if(!dis){e.currentTarget.style.borderColor=ACCENT;e.currentTarget.style.color="#fff";}}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=BORDER;e.currentTarget.style.color=dis?"#2a1a5e":MUTED;}}>
              {icon}
            </button>
          ))}
        </div>
      </header>

      {/* ── MAIN ROW: left panel | canvas | right panel ── */}
      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>

        {/* ── LEFT: Color palette ── */}
        <div style={{width:80,flexShrink:0,background:SIDEBAR,borderRight:`1px solid ${BORDER}`,display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",gap:10,overflowY:"auto"}}>
          <div style={{fontSize:9,color:MUTED,letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>Colors</div>
          {LABELS.map(lb=>(
            <div key={lb.name} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <button className={`swatch${activeLabel.name===lb.name?" on":""}`}
                onClick={()=>{setActiveLabel(lb);if(activeTool==="eraser")setActiveTool("brush");}}
                title={lb.name}
                style={{width:32,height:32,borderRadius:50,background:lb.color,border:"2px solid rgba(255,255,255,.15)",cursor:"pointer",transition:"all .15s",display:"block"}}>
              </button>
              <span style={{fontSize:8,color:MUTED,lineHeight:1}}>{lb.icon}</span>
            </div>
          ))}

          {/* Active label name */}
          <div style={{marginTop:6,padding:"5px 8px",borderRadius:8,background:"rgba(108,71,255,.2)",border:`1px solid ${BORDER}`,textAlign:"center"}}>
            <div style={{fontSize:14}}>{activeLabel.icon}</div>
            <div style={{fontSize:8,color:"#c4b8e8",marginTop:2,lineHeight:1.2,maxWidth:60,wordBreak:"break-word"}}>{activeLabel.name}</div>
          </div>
        </div>

        {/* ── CENTER: Canvas ── */}
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:`radial-gradient(ellipse at center, #12062e 0%, ${BG} 70%)`,position:"relative",overflow:"hidden",cursor:["rect","circle","triangle","line"].includes(activeTool)?"crosshair":activeTool==="fill"?"cell":"none"}}>

          {/* Canvas wrapper with glow border */}
          <div style={{position:"relative",borderRadius:12,overflow:"hidden",boxShadow:`0 0 0 1px ${BORDER}, 0 0 40px ${ACCENT}30, 0 20px 60px rgba(0,0,0,.8)`}}>
            <canvas ref={canvasRef} width={SZ} height={SZ}
              style={{display:"block",maxWidth:"calc(100vw - 200px)",maxHeight:"calc(100vh - 220px)"}}
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onLeave}
              onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}/>
            <canvas ref={overlayRef} width={SZ} height={SZ}
              style={{position:"absolute",top:0,left:0,maxWidth:"calc(100vw - 200px)",maxHeight:"calc(100vh - 220px)",pointerEvents:"none"}}/>

            {/* Cursor ring */}
            {showCursor && isBrush && (
              <div style={{position:"absolute",left:cursorPos.x,top:cursorPos.y,pointerEvents:"none",
                width:brushSize*((canvasRef.current?.getBoundingClientRect().width||SZ)/SZ),
                height:brushSize*((canvasRef.current?.getBoundingClientRect().height||SZ)/SZ),
                borderRadius:"50%",transform:"translate(-50%,-50%)",
                border:activeTool==="eraser"?"2px dashed rgba(255,100,100,.9)":`2px solid ${activeLabel.color}`,
                background:activeTool==="eraser"?"rgba(255,80,80,.1)":`${activeLabel.color}18`,
                boxShadow:activeTool==="eraser"?"none":`0 0 12px ${activeLabel.color}70`,
              }}/>
            )}

            {/* Status badge */}
            <div style={{position:"absolute",bottom:10,left:10,background:"rgba(10,5,32,.85)",backdropFilter:"blur(8px)",borderRadius:8,padding:"4px 10px",fontSize:10,border:`1px solid ${BORDER}`,display:"flex",alignItems:"center",gap:6,pointerEvents:"none"}}>
              {activeTool!=="eraser"&&<div style={{width:8,height:8,borderRadius:2,background:activeLabel.color,boxShadow:`0 0 6px ${activeLabel.color}`}}/>}
              <span style={{color:TEXT,fontWeight:500}}>{activeTool==="eraser"?"🧹 Eraser":`${activeLabel.icon} ${activeLabel.name}`}</span>
              <span style={{color:MUTED}}>·</span>
              <span style={{color:MUTED}}>{TOOLS.find(t=>t.id===activeTool)?.label}</span>
            </div>
          </div>
        </div>

        {/* ── RIGHT: Tools ── */}
        <div style={{width:80,flexShrink:0,background:SIDEBAR,borderLeft:`1px solid ${BORDER}`,display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",gap:8,overflowY:"auto"}}>
          <div style={{fontSize:9,color:MUTED,letterSpacing:".08em",textTransform:"uppercase",marginBottom:4}}>Tools</div>

          {TOOLS.map(t=>(
            <div key={t.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <button className={`tool-btn${activeTool===t.id?" on":""}`}
                onClick={()=>setActiveTool(t.id)}
                title={`${t.label} (${t.key})`}
                style={{width:42,height:42,borderRadius:10,border:`1px solid ${BORDER}`,background:"rgba(108,71,255,.1)",color:MUTED,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                {t.icon}
              </button>
              <span style={{fontSize:8,color:MUTED}}>{t.key}</span>
            </div>
          ))}

          {/* Divider */}
          <div style={{width:40,height:1,background:BORDER,margin:"4px 0"}}/>

          {/* Brush size mini */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"0 8px",width:"100%"}}>
            <div style={{fontSize:8,color:MUTED}}>Size</div>
            <input type="range" min={2} max={150} value={brushSize}
              onChange={e=>setBrushSize(Number(e.target.value))}
              style={{width:54,accentColor:ACCENT,background:"#1a0f3e",writingMode:"vertical-lr",direction:"rtl",height:70,cursor:"pointer"}}/>
            <div style={{fontSize:9,color:TEXT,fontWeight:600}}>{brushSize}</div>
          </div>

          {/* Opacity mini */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"0 8px",width:"100%"}}>
            <div style={{fontSize:8,color:MUTED}}>Alpha</div>
            <input type="range" min={0.1} max={1} step={0.05} value={opacity}
              onChange={e=>setOpacity(Number(e.target.value))}
              style={{width:54,accentColor:"#a855f7",background:"#1a0f3e",writingMode:"vertical-lr",direction:"rtl",height:60,cursor:"pointer"}}/>
            <div style={{fontSize:9,color:"#a855f7",fontWeight:600}}>{Math.round(opacity*100)}%</div>
          </div>
        </div>
      </div>

      {/* ── BOTTOM: Generate button + output ── */}
      <div style={{flexShrink:0,background:BOTTOM,borderTop:`1px solid ${BORDER}`}}>

        {/* Generate bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 18px",borderBottom:`1px solid ${BORDER}`}}>

          {/* Style variation */}
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:11,color:MUTED,whiteSpace:"nowrap"}}>AI Variation</span>
            <input type="range" min={0.1} max={3} step={0.1} value={styleStrength}
              onChange={e=>setStyleStrength(Number(e.target.value))}
              style={{width:100,accentColor:"#34d399",background:"#0d1a3a"}}/>
            <span style={{fontSize:12,color:"#34d399",fontWeight:700,minWidth:22}}>{styleStrength.toFixed(1)}</span>
          </div>

          {/* Error */}
          {error && <div style={{fontSize:11,color:"#fca5a5",background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",borderRadius:8,padding:"5px 12px",maxWidth:400}}>{error}</div>}

          {/* Generate button */}
          <button onClick={doGenerate} disabled={isLoading}
            style={{padding:"0 32px",height:40,borderRadius:20,border:"none",cursor:isLoading?"not-allowed":"pointer",
              background:isLoading?`rgba(108,71,255,.4)`:`linear-gradient(135deg,${ACCENT},#a855f7)`,
              color:"#fff",fontSize:13,fontWeight:700,fontFamily:"'DM Sans'",letterSpacing:".3px",
              boxShadow:isLoading?"none":`0 0 24px ${ACCENT}60, 0 0 50px ${ACCENT}30`,
              animation:isLoading?"none":"glow 2.5s infinite",
              transition:"all .2s",display:"flex",alignItems:"center",gap:8,opacity:isLoading?.6:1}}>
            {isLoading
              ?<><div style={{width:14,height:14,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>Generating...</>
              :"✨ Generate Satellite View"
            }
          </button>
        </div>

        {/* Output row */}
        <div style={{display:"flex",height:190,overflow:"hidden"}}>

          {/* Generated image */}
          <div style={{width:190,flexShrink:0,borderRight:`1px solid ${BORDER}`,background:"repeating-linear-gradient(45deg,#070d1f,#070d1f 8px,#050b1a 8px,#050b1a 16px)",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
            {generated
              ?<img src={generated} alt="result" style={{width:"100%",height:"100%",objectFit:"cover",animation:"fadeUp .4s ease"}}/>
              :isLoading
                ?<div style={{textAlign:"center",color:MUTED}}>
                  <div style={{width:24,height:24,border:`2px solid ${BORDER}`,borderTopColor:ACCENTB,borderRadius:"50%",animation:"spin .7s linear infinite",margin:"0 auto 8px"}}/>
                  <div style={{fontSize:10}}>Generating...</div>
                  <div style={{fontSize:9,color:"#2a3a5e",marginTop:3}}>20–40 sec</div>
                 </div>
                :<div style={{textAlign:"center",color:"#1e2a4a",padding:12}}>
                  <div style={{fontSize:28,marginBottom:6}}>🖼️</div>
                  <div style={{fontSize:10}}>Output appears here</div>
                 </div>
            }
            {generated&&(
              <button onClick={doSave} style={{position:"absolute",bottom:6,right:6,padding:"3px 9px",borderRadius:6,background:`rgba(108,71,255,.85)`,border:`1px solid ${ACCENT}`,color:"#fff",fontSize:10,cursor:"pointer",fontWeight:600}}>↓ Save</button>
            )}
          </div>

          {/* Info: terrain + prompt + history */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* Terrain badges */}
            {terrainInfo&&(
              <div style={{padding:"8px 14px",borderBottom:`1px solid ${BORDER}`,flexShrink:0,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:9,color:MUTED,textTransform:"uppercase",letterSpacing:".08em"}}>Detected:</span>
                {Object.entries(terrainInfo.coverage||{}).sort((a,b)=>b[1]-a[1]).map(([name,pct])=>{
                  const lb=LABELS.find(l=>l.name===name);
                  return <span key={name} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:20,background:"rgba(108,71,255,.15)",border:`1px solid ${BORDER}`,fontSize:10,color:"#c4b8e8"}}>
                    <span style={{width:7,height:7,borderRadius:2,background:lb?.color||"#888",display:"inline-block"}}/>
                    {name} {pct}%
                  </span>;
                })}
              </div>
            )}

            {/* Prompt */}
            {promptText&&(
              <div style={{padding:"7px 14px",borderBottom:`1px solid ${BORDER}`,flexShrink:0}}>
                <div style={{fontSize:9,color:MUTED,textTransform:"uppercase",letterSpacing:".08em",marginBottom:3}}>📝 Prompt</div>
                <div style={{fontSize:9,color:"#4a5a7a",fontStyle:"italic",lineHeight:1.5,overflow:"hidden",maxHeight:32}}>{promptText}</div>
              </div>
            )}

            {/* History */}
            <div style={{flex:1,display:"flex",alignItems:"center",gap:10,padding:"10px 14px",overflowX:"auto",overflowY:"hidden"}}>
              {history.length===0&&!isLoading&&(
                <div style={{fontSize:10,color:"#1e2a4a"}}>Generation history will appear here</div>
              )}
              {history.map((item,i)=>(
                <button key={item.id} className="hist-btn"
                  onClick={()=>setGenerated(item.src)}
                  style={{flexShrink:0,width:100,height:100,borderRadius:9,overflow:"hidden",border:`2px solid ${BORDER}`,background:"none",padding:0,cursor:"pointer",transition:"all .15s"}}>
                  <img src={item.src} alt={`h${i}`} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
