
const $=id=>document.getElementById(id);
const state={issues:[],selected:null,pdf:null,flip:null,token:0,leaves:[],drawn:new Set(),drawing:new Map(),pdfjs:null,zoom:1,panX:0,panY:0,drag:null,hiRes:new Set()};
const pdfLib=async()=>{if(!state.pdfjs){const lib=await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");lib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";state.pdfjs=lib}return state.pdfjs};
const safe=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sortIssues=(a,b)=>(b.editionDate||"").localeCompare(a.editionDate||"")||a.title.localeCompare(b.title);
const title=i=>i.title;
const error=(msg)=>{$("loading").hidden=true;$("readerError").hidden=false;$("errorText").textContent=msg;$("errorLink").href=state.selected?.sourceUrl||state.selected?.url||"#";$("prevPage").disabled=true;$("nextPage").disabled=true};
async function init(){
 try{
  const [r,c]=await Promise.all([fetch("./library.json",{cache:"no-store"}),fetch("./config.json",{cache:"no-store"})]);
  if(!r.ok||!c.ok)throw Error("Catalogue unavailable");
  const data=await r.json(),config=await c.json();
  document.title=config.siteTitle||document.title;
  state.issues=(data.issues||[]).filter(i=>i.url&&i.title).sort(sortIssues);
  $("syncStatus").textContent=state.issues.length+" magazine editions";
  if(!state.issues.length)throw Error("No magazine PDFs were found");
  const requested=new URLSearchParams(location.hash.slice(1)).get("edition");
  const first=state.issues.find(i=>i.id===requested)||state.issues[0];
  await selectIssue(first);
 }catch(e){console.error(e);error("The magazine archive is being prepared. Please try again shortly.")}
}
function archive(){
 const term=$("editionSearch").value.toLowerCase().trim();
 const issues=state.issues.filter(i=>i.id!==state.selected?.id);
 const matches=issues.filter(i=>i.title.toLowerCase().includes(term));
 $("archiveCount").textContent=issues.length;
 $("archiveEmpty").hidden=matches.length>0;
 const list=$("issueList");list.replaceChildren();
 for(const issue of matches){
  const button=document.createElement("button");button.type="button";button.className="issue-button";
  const cover=document.createElement("div");cover.className="issue-cover";
  if(issue.cover){const img=document.createElement("img");img.src=issue.cover;img.alt="Cover of "+issue.title;img.loading="lazy";cover.append(img)}
  else cover.textContent="LEEDS & BROOMFIELD";
  const details=document.createElement("div");details.className="issue-info";
  details.innerHTML='<span class="issue-tag">FROM THE ARCHIVE</span><span class="issue-name">'+safe(issue.title)+'</span><span class="issue-sub">Church & village news</span>';
  button.append(cover,details);button.addEventListener("click",()=>selectIssue(issue));list.append(button);
 }
}
async function selectIssue(issue){
 const token=++state.token;state.selected=issue;setZoom(1);
 $("editionTitle").textContent=title(issue);$("editionKicker").textContent=issue.id===state.issues[0].id?"LATEST EDITION":"ARCHIVE EDITION";
 $("originalPDF").href=issue.sourceUrl||issue.url;$("loading").hidden=false;$("readerError").hidden=true;
 $("pageStatus").textContent="Front cover";$("totalPages").textContent="— pages";
 $("prevPage").disabled=true;$("nextPage").disabled=true;
 history.replaceState(null,"",location.pathname+location.search+"#edition="+encodeURIComponent(issue.id));archive();
 if(state.flip){try{state.flip.destroy()}catch(e){console.warn(e)}state.flip=null}
 if(state.pdf){const old=state.pdf;state.pdf=null;try{await old.destroy()}catch(e){}}
 if(token!==state.token)return;
 $("flipbook").replaceChildren();state.leaves=[];state.drawn.clear();state.hiRes.clear();state.drawing.clear();
 try{
  const lib=await pdfLib();if(!window.St?.PageFlip)throw Error("Page-turn library unavailable");
  const pdf=await lib.getDocument({url:issue.url}).promise;
  if(token!==state.token){await pdf.destroy();return}state.pdf=pdf;
  if(!pdf.numPages)throw Error("Empty PDF");
  const first=await pdf.getPage(1),view=first.getViewport({scale:1});
  const width=400,height=Math.round(width*view.height/view.width);
  for(let n=0;n<pdf.numPages;n++){
   const leaf=document.createElement("div");leaf.className="magazine-page";
   if(n===0||n===pdf.numPages-1)leaf.dataset.density="hard";
   const placeholder=document.createElement("div");placeholder.className="magazine-placeholder";placeholder.textContent=n+1;
   leaf.append(placeholder);$("flipbook").append(leaf);state.leaves.push(leaf);
  }
  await draw(0,token); // Only the visible cover is required for first paint.
  if(token!==state.token)return;
  state.flip=new window.St.PageFlip($("flipbook"),{
   width,height,size:"stretch",minWidth:120,minHeight:160,maxWidth:900,maxHeight:1250,
   showCover:true,usePortrait:true,autoSize:true,mobileScrollSupport:false,
   flippingTime:650,drawShadow:true,maxShadowOpacity:0.26,startPage:0
  });
  state.flip.on("flip",({data})=>{setZoom(1);position(data);nearby(data,token)});
  state.flip.on("changeOrientation",()=>position(state.flip.getCurrentPageIndex()));
  state.flip.loadFromHTML(state.leaves);
  $("pageSlider").max=pdf.numPages-1;$("pageSlider").value=0;
  $("totalPages").textContent=pdf.numPages+" pages";$("loading").hidden=true;
  position(0);nearby(0,token);
 }catch(e){
  if(token!==state.token)return;console.error("Magazine preview:",e);
  error("The edition may be waiting for the first PDF sync, or the external PDF server is blocking previews.");
 }
}
async function draw(index,token,detailed=false){
 if(!state.pdf||token!==state.token||index<0||index>=state.pdf.numPages)return;
 if(state.drawn.has(index)&&(!detailed||state.hiRes.has(index)))return;
 const ongoing=state.drawing.get(index);
 if(ongoing){
  await ongoing;
  if(detailed&&!state.hiRes.has(index))return draw(index,token,true);
  return;
 }
 const job=(async()=>{
  const page=await state.pdf.getPage(index+1);
  if(token!==state.token)return;
  const base=page.getViewport({scale:1});
  // Fast first paint: ~850 px page width. On-demand sharp 1800 px when zooming.
  const target=detailed?1800:850;
  const viewport=page.getViewport({scale:Math.min(4,Math.max(.3,target/base.width))});
  const canvas=document.createElement("canvas");
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport}).promise;
  if(token!==state.token)return;
  state.leaves[index]?.replaceChildren(canvas);
  state.drawn.add(index);
  if(detailed)state.hiRes.add(index);
  page.cleanup();
 })();
 state.drawing.set(index,job);
 try{await job}
 catch(e){if(token===state.token)console.warn("Page render",index,e)}
 finally{state.drawing.delete(index)}
}
function nearby(index,token){
 if(!state.pdf)return;
 // Render only the current spread and one nearby spread.
 const first=Math.max(0,index-2),last=Math.min(state.pdf.numPages-1,index+3);
 for(let n=first;n<=last;n++)draw(n,token);
 for(const n of [...state.drawn]){
  if(n<first-5||n>last+5){
   const placeholder=document.createElement("div");
   placeholder.className="magazine-placeholder";placeholder.textContent=n+1;
   state.leaves[n]?.replaceChildren(placeholder);
   state.drawn.delete(n);state.hiRes.delete(n);
  }
 }
}
function detailedVisible(){
 if(!state.flip||!state.pdf)return;
 const current=state.flip.getCurrentPageIndex();
 const portrait=state.flip.getOrientation()==="portrait";
 draw(current,state.token,true);
 if(!portrait&&current+1<state.pdf.numPages)draw(current+1,state.token,true);
}
function position(index){
 if(!state.pdf||!state.flip)return;
 index=Math.max(0,Math.min(index,state.pdf.numPages-1));
 const landscape=state.flip.getOrientation()==="landscape";
 const last=state.pdf.numPages-1;
 $("pageStatus").textContent=index===0?"Front cover":(index===last?"Back cover":(landscape?"Pages "+(index+1)+"–"+Math.min(index+2,state.pdf.numPages):"Page "+(index+1)));
 $("pageSlider").value=index;$("prevPage").disabled=index===0;$("nextPage").disabled=index>=last;
}
function goPage(n){
 if(!state.flip)return;
 setZoom(1);
 state.flip.turnToPage(n);
 const index=state.flip.getCurrentPageIndex();
 position(index);nearby(index,state.token);
}
function turnPage(direction){
 if(!state.flip)return;
 setZoom(1);
 if(direction==="next")state.flip.flipNext("bottom");
 else state.flip.flipPrev("bottom");
}
$("prevPage").addEventListener("click",()=>turnPage("prev"));
$("nextPage").addEventListener("click",()=>turnPage("next"));
$("pageSlider").addEventListener("change",e=>goPage(Number(e.target.value)));
$("editionSearch").addEventListener("input",archive);
$("fullScreen").addEventListener("click",async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else await $("readerShell").requestFullscreen();
 }catch(e){console.warn("Fullscreen unavailable:",e)}
});
function clampPan(){
 const viewport=$("bookViewport");
 const maxX=Math.max(0,(state.zoom-1)*viewport.clientWidth/2);
 const maxY=Math.max(0,(state.zoom-1)*viewport.clientHeight/2);
 state.panX=Math.max(-maxX,Math.min(maxX,state.panX));
 state.panY=Math.max(-maxY,Math.min(maxY,state.panY));
}
function applyZoom(){
 const viewport=$("bookViewport");
 clampPan();
 $("bookStage").style.transform="translate3d("+state.panX+"px,"+state.panY+"px,0) scale("+state.zoom+")";
 viewport.classList.toggle("is-zoomed",state.zoom>1);
 $("zoomReset").textContent=Math.round(state.zoom*100)+"%";
 $("zoomOut").disabled=state.zoom<=1;
 $("zoomIn").disabled=state.zoom>=2.5;
}
function setZoom(value){
 const previous=state.zoom;
 state.zoom=Math.max(1,Math.min(2.5,Math.round(value*4)/4));
 if(state.zoom===1){state.panX=0;state.panY=0;state.drag=null}
 applyZoom();
 if(state.zoom>1&&previous!==state.zoom)detailedVisible();
}
$("zoomOut").addEventListener("click",()=>setZoom(state.zoom-.25));
$("zoomIn").addEventListener("click",()=>setZoom(state.zoom+.25));
$("zoomReset").addEventListener("click",()=>setZoom(1));
const viewport=$("bookViewport");
viewport.addEventListener("pointerdown",e=>{
 if(state.zoom===1||(e.pointerType==="mouse"&&e.button!==0))return;
 state.drag={id:e.pointerId,x:e.clientX,y:e.clientY,panX:state.panX,panY:state.panY};
 viewport.classList.add("is-dragging");
 viewport.setPointerCapture(e.pointerId);
 e.preventDefault();
});
viewport.addEventListener("pointermove",e=>{
 if(!state.drag||e.pointerId!==state.drag.id)return;
 state.panX=state.drag.panX+(e.clientX-state.drag.x);
 state.panY=state.drag.panY+(e.clientY-state.drag.y);
 applyZoom();e.preventDefault();
});
function finishDrag(e){
 if(!state.drag||e.pointerId!==state.drag.id)return;
 state.drag=null;viewport.classList.remove("is-dragging");
 if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);
}
viewport.addEventListener("pointerup",finishDrag);
viewport.addEventListener("pointercancel",finishDrag);
viewport.addEventListener("lostpointercapture",()=>{
 state.drag=null;viewport.classList.remove("is-dragging");
});
viewport.addEventListener("wheel",e=>{
 if(state.zoom===1)return;
 e.preventDefault();
 if(e.ctrlKey){setZoom(state.zoom+(e.deltaY<0?.25:-.25));return}
 state.panX-=e.deltaX;state.panY-=e.deltaY;applyZoom();
},{passive:false});
window.addEventListener("resize",()=>{if(state.zoom>1)applyZoom()});
document.addEventListener("fullscreenchange",()=>setZoom(1));
document.addEventListener("keydown",e=>{
 if(["INPUT","TEXTAREA"].includes(document.activeElement?.tagName))return;
 if(e.key==="ArrowRight"){e.preventDefault();turnPage("next")}
 if(e.key==="ArrowLeft"){e.preventDefault();turnPage("prev")}
 if(e.key==="Escape"&&state.zoom>1){e.preventDefault();setZoom(1)}
});

init();
