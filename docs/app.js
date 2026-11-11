
// Remove tracking parameters added to inbound links, without touching
// functional parameters such as ?embed=1 or #edition=november-2026.
function stripReferralTracking(){
 const url=new URL(location.href);
 let changed=false;
 const isTracking=(key,val)=>/^utm_/i.test(key)||(["ref","source"].includes(key.toLowerCase())&&/chatgpt/i.test(val));
 for(const [key,value] of [...url.searchParams.entries()]){
  if(isTracking(key,value)){url.searchParams.delete(key);changed=true}
 }
 if(url.hash.startsWith("#edition=")){
  const fragment=new URLSearchParams(url.hash.slice(1));
  for(const [key,value] of [...fragment.entries()]){
   if(isTracking(key,value)){fragment.delete(key);changed=true}
  }
  if(changed)url.hash="#"+fragment.toString();
 }
 if(changed)history.replaceState(history.state,"",url.pathname+url.search+url.hash);
}
stripReferralTracking();
const $=id=>document.getElementById(id);
const state={issues:[],selected:null,pdf:null,flip:null,token:0,leaves:[],drawn:new Set(),drawing:new Map(),pdfjs:null,loadingTask:null,zoomRender:null,zoomPage:0,zoomScale:1};
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
 // Show the magazine being read as well as the older editions.
 // Keep the selected edition at the top for a clear visual reference.
 const issues=[...state.issues].sort((a,b)=>Number(b.id===state.selected?.id)-Number(a.id===state.selected?.id));
 const matches=issues.filter(i=>i.title.toLowerCase().includes(term));
 $("archiveCount").textContent=issues.length;
 $("archiveEmpty").hidden=matches.length>0;
 const list=$("issueList");list.replaceChildren();
 for(const issue of matches){
  const button=document.createElement("button");button.type="button";button.className="issue-button";
  const current=issue.id===state.selected?.id;
  if(current)button.classList.add("is-current");
  button.setAttribute("aria-pressed",String(current));
  button.setAttribute("aria-label",(current?"Currently open: ":"Open edition: ")+issue.title);
  const cover=document.createElement("div");cover.className="issue-cover";
  if(issue.cover){const img=document.createElement("img");img.src=issue.cover;img.alt="Cover of "+issue.title;img.loading="lazy";cover.append(img)}
  else cover.textContent="LEEDS & BROOMFIELD";
  const details=document.createElement("div");details.className="issue-info";
  details.innerHTML='<span class="issue-tag">'+(current?"CURRENTLY READING":"EDITION")+'</span><span class="issue-name">'+safe(issue.title)+'</span><span class="issue-sub">'+(current?"Open in reader":"Church & village news")+'</span>';
  button.append(cover,details);button.addEventListener("click",()=>selectIssue(issue));list.append(button);
 }
}
async function selectIssue(issue){
 const token=++state.token;state.selected=issue;
 resetInlineZoom();
 $("editionTitle").textContent=title(issue);$("editionKicker").textContent=issue.id===state.issues[0].id?"LATEST EDITION":"ARCHIVE EDITION";
 $("originalPDF").href=issue.sourceUrl||issue.url;$("loading").hidden=false;$("readerError").hidden=true;
 $("pageStatus").textContent="Front cover";$("totalPages").textContent="— pages";
 $("prevPage").disabled=true;$("nextPage").disabled=true;
 history.replaceState(null,"",location.pathname+location.search+"#edition="+encodeURIComponent(issue.id));archive();
 // Cancel previous downloads and dispose previous pages without blocking this edition.
 // In particular, waiting for old PDF.js renders to finish can stall switching.
 const previousTask=state.loadingTask;
 state.loadingTask=null;
 if(previousTask){try{void previousTask.destroy().catch(()=>{})}catch(e){}}
 const previousPdf=state.pdf;
 const previousRenders=[...state.drawing.values()];
 state.pdf=null;
 if(state.flip){try{state.flip.destroy()}catch(e){console.warn(e)}state.flip=null}
 // Do not cancel in-progress canvas renders abruptly: PDF.js reports that
 // cancellation as an unhandled RenderingCancelledException in some browsers.
 // Cleanup completes independently, so changing editions never waits for it.
 if(previousPdf){
  void Promise.allSettled(previousRenders)
   .then(()=>previousPdf.destroy())
   .catch(e=>console.warn("Old PDF cleanup:",e));
 }
 if(token!==state.token)return;
 // PageFlip.destroy() deletes its own HTML container. Rebuild it for every edition.
 const stage=$("bookStage");
 if(!stage)throw Error("Magazine stage is missing");
 const newBook=document.createElement("div");
 newBook.id="flipbook";
 newBook.className="flipbook";
 stage.replaceChildren(newBook);
 state.leaves=[];state.drawn.clear();state.drawing.clear();
 try{
  const lib=await pdfLib();if(!window.St?.PageFlip)throw Error("Page-turn library unavailable");
  const task=lib.getDocument({url:issue.url});
  state.loadingTask=task;
  let pdf;
  try{pdf=await task.promise}
  finally{if(state.loadingTask===task)state.loadingTask=null}
  if(token!==state.token){void pdf.destroy().catch(()=>{});return}
  state.pdf=pdf;
  if(!pdf.numPages)throw Error("Empty PDF");
  const first=await pdf.getPage(1),view=first.getViewport({scale:1});
  const width=400,height=Math.round(width*view.height/view.width);
  for(let n=0;n<pdf.numPages;n++){
   const leaf=document.createElement("div");leaf.className="magazine-page";
   if(n===0||n===pdf.numPages-1)leaf.dataset.density="hard";
   const placeholder=document.createElement("div");placeholder.className="magazine-placeholder";placeholder.textContent=n+1;
   leaf.append(placeholder);$("flipbook").append(leaf);state.leaves.push(leaf);
  }
  await draw(0,token);
  if(token!==state.token)return;
  state.flip=new window.St.PageFlip($("flipbook"),{
   width,height,size:"stretch",minWidth:120,minHeight:160,maxWidth:900,maxHeight:1200,
   showCover:true,usePortrait:true,autoSize:true,mobileScrollSupport:false,
   flippingTime:650,drawShadow:true,maxShadowOpacity:0.26,startPage:0
  });
  state.flip.on("flip",({data})=>{position(data);nearby(data,token)});
  state.flip.on("changeOrientation",()=>position(state.flip.getCurrentPageIndex()));
  state.flip.loadFromHTML(state.leaves);
  $("pageSlider").max=pdf.numPages-1;$("pageSlider").value=0;
  $("totalPages").textContent=pdf.numPages+" pages";$("loading").hidden=true;
  position(0);nearby(0,token);
 }catch(e){
  if(token!==state.token)return;
  console.error("Magazine preview:",e);
  error("Unable to open this edition. Please try again or open the original PDF.");
 }
}
async function draw(index,token){
 if(!state.pdf||token!==state.token||index<0||index>=state.pdf.numPages||state.drawn.has(index))return;
 if(state.drawing.has(index))return state.drawing.get(index);
 const job=(async()=>{
  const page=await state.pdf.getPage(index+1);
  if(token!==state.token)return;
  const base=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(3,Math.max(.3,900/base.width))});
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport}).promise;
  if(token!==state.token)return;
  state.leaves[index]?.replaceChildren(canvas);state.drawn.add(index);page.cleanup();
 })();
 state.drawing.set(index,job);
 try{await job}catch(e){if(token===state.token)console.warn("Page render",index,e)}finally{if(state.drawing.get(index)===job)state.drawing.delete(index)}
}
function nearby(index,token){
 if(!state.pdf)return;
 const min=Math.max(0,index-2),max=Math.min(state.pdf.numPages-1,index+3);
 for(let n=min;n<=max;n++)draw(n,token);
 for(const n of state.drawn){
  if(n<min-5||n>max+5){
   const placeholder=document.createElement("div");placeholder.className="magazine-placeholder";placeholder.textContent=n+1;
   state.leaves[n]?.replaceChildren(placeholder);state.drawn.delete(n);
  }
 }
}
function position(index){
 if(!state.pdf||!state.flip)return;
 index=Math.max(0,Math.min(index,state.pdf.numPages-1));
 const landscape=state.flip.getOrientation()==="landscape";
 const last=state.pdf.numPages-1;
 $("pageStatus").textContent=index===0?"Front cover":(index===last?"Back cover":(landscape?"Pages "+(index+1)+"–"+Math.min(index+2,state.pdf.numPages):"Page "+(index+1)));
 $("pageSlider").value=index;$("prevPage").disabled=index===0;$("nextPage").disabled=index>=last;
}
function goPage(n){resetInlineZoom();state.flip?.turnToPage(n);position(state.flip?.getCurrentPageIndex()||0);nearby(n,state.token)}

const inlineZoom={level:1,x:0,y:0,pointer:null};
function renderInlineZoom(){
 const viewport=$("bookViewport");
 const stage=$("bookStage");
 if(!viewport||!stage)return;
 const horizontalLimit=Math.max(0,(inlineZoom.level-1)*viewport.clientWidth/2);
 const verticalLimit=Math.max(0,(inlineZoom.level-1)*viewport.clientHeight/2);
 inlineZoom.x=Math.max(-horizontalLimit,Math.min(horizontalLimit,inlineZoom.x));
 inlineZoom.y=Math.max(-verticalLimit,Math.min(verticalLimit,inlineZoom.y));
 stage.style.transform="translate("+inlineZoom.x+"px,"+inlineZoom.y+"px) scale("+inlineZoom.level+")";
 viewport.classList.toggle("is-zoomed",inlineZoom.level>1);
 $("zoomReset").textContent=Math.round(inlineZoom.level*100)+"%";
 $("zoomOut").disabled=inlineZoom.level<=1;
 $("zoomIn").disabled=inlineZoom.level>=2.5;
}
function resetInlineZoom(){
 inlineZoom.level=1;inlineZoom.x=0;inlineZoom.y=0;
 inlineZoom.pointer=null;
 renderInlineZoom();
}
function changeZoom(step){
 if(!state.flip)return;
 inlineZoom.level=Math.max(1,Math.min(2.5,Math.round((inlineZoom.level+step)*4)/4));
 if(inlineZoom.level===1){inlineZoom.x=0;inlineZoom.y=0;}
 renderInlineZoom();
}
function pageTurn(direction){
 resetInlineZoom();
 if(direction==="next")state.flip?.flipNext("bottom");
 else state.flip?.flipPrev("bottom");
}
$("prevPage").addEventListener("click",()=>pageTurn("prev"));
$("nextPage").addEventListener("click",()=>pageTurn("next"));
$("pageSlider").addEventListener("change",e=>goPage(Number(e.target.value)));
$("editionSearch").addEventListener("input",archive);
$("zoomIn").addEventListener("click",()=>changeZoom(.25));
$("zoomOut").addEventListener("click",()=>changeZoom(-.25));
$("zoomReset").addEventListener("click",resetInlineZoom);
const zoomViewport=$("bookViewport");
zoomViewport.addEventListener("pointerdown",e=>{
 if(inlineZoom.level<=1||e.button!==0)return;
 inlineZoom.pointer={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:inlineZoom.x,y:inlineZoom.y};
 zoomViewport.classList.add("is-dragging");
 zoomViewport.setPointerCapture(e.pointerId);
 e.preventDefault();
});
zoomViewport.addEventListener("pointermove",e=>{
 const drag=inlineZoom.pointer;
 if(!drag||drag.id!==e.pointerId)return;
 inlineZoom.x=drag.x+e.clientX-drag.startX;
 inlineZoom.y=drag.y+e.clientY-drag.startY;
 renderInlineZoom();
});
const endDrag=e=>{
 if(inlineZoom.pointer?.id!==e.pointerId)return;
 inlineZoom.pointer=null;zoomViewport.classList.remove("is-dragging");
 if(zoomViewport.hasPointerCapture(e.pointerId))zoomViewport.releasePointerCapture(e.pointerId);
};
zoomViewport.addEventListener("pointerup",endDrag);
zoomViewport.addEventListener("pointercancel",endDrag);
zoomViewport.addEventListener("wheel",e=>{
 if(inlineZoom.level<=1)return;
 e.preventDefault();
 inlineZoom.x-=e.deltaX;
 inlineZoom.y-=e.deltaY;
 renderInlineZoom();
},{passive:false});
$("fullScreen").addEventListener("click",async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else await $("readerShell").requestFullscreen()}
 catch(e){console.warn(e)}
});
window.addEventListener("resize",renderInlineZoom);
document.addEventListener("keydown",e=>{
 if(["INPUT","TEXTAREA"].includes(document.activeElement?.tagName))return;
 if(e.key==="ArrowRight"){e.preventDefault();pageTurn("next")}
 if(e.key==="ArrowLeft"){e.preventDefault();pageTurn("prev")}
 if(e.key==="Escape"&&inlineZoom.level>1){resetInlineZoom()}
});

init();
