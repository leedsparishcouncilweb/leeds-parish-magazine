
const $=id=>document.getElementById(id);
const state={issues:[],selected:null,pdf:null,flip:null,token:0,leaves:[],drawn:new Set(),drawing:new Map(),pdfjs:null,zoomRender:null,zoomPage:0,zoomScale:1};
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
 const token=++state.token;state.selected=issue;
 $("editionTitle").textContent=title(issue);$("editionKicker").textContent=issue.id===state.issues[0].id?"LATEST EDITION":"ARCHIVE EDITION";
 $("originalPDF").href=issue.sourceUrl||issue.url;$("loading").hidden=false;$("readerError").hidden=true;
 $("pageStatus").textContent="Front cover";$("totalPages").textContent="— pages";
 $("prevPage").disabled=true;$("nextPage").disabled=true;
 history.replaceState(null,"",location.pathname+location.search+"#edition="+encodeURIComponent(issue.id));archive();
 if(state.flip){try{state.flip.destroy()}catch(e){console.warn(e)}state.flip=null}
 if(state.pdf){const old=state.pdf;state.pdf=null;try{await old.destroy()}catch(e){}}
 if(token!==state.token)return;
 $("flipbook").replaceChildren();state.leaves=[];state.drawn.clear();state.drawing.clear();
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
  await Promise.all([draw(0,token),draw(1,token),draw(2,token)]);
  if(token!==state.token)return;
  state.flip=new window.St.PageFlip($("flipbook"),{
   width,height,size:"stretch",minWidth:120,minHeight:160,maxWidth:620,maxHeight:900,
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
  if(token!==state.token)return;console.error("Magazine preview:",e);
  error("The edition may be waiting for the first PDF sync, or the external PDF server is blocking previews.");
 }
}
async function draw(index,token){
 if(!state.pdf||token!==state.token||index<0||index>=state.pdf.numPages||state.drawn.has(index))return;
 if(state.drawing.has(index))return state.drawing.get(index);
 const job=(async()=>{
  const page=await state.pdf.getPage(index+1);
  if(token!==state.token)return;
  const base=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:Math.min(3,Math.max(.3,1100/base.width))});
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport}).promise;
  if(token!==state.token)return;
  state.leaves[index]?.replaceChildren(canvas);state.drawn.add(index);page.cleanup();
 })();
 state.drawing.set(index,job);
 try{await job}catch(e){if(token===state.token)console.warn("Page render",index,e)}finally{state.drawing.delete(index)}
}
function nearby(index,token){
 if(!state.pdf)return;
 const min=Math.max(0,index-4),max=Math.min(state.pdf.numPages-1,index+6);
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
function goPage(n){state.flip?.turnToPage(n);position(state.flip?.getCurrentPageIndex()||0);nearby(n,state.token)}
$("prevPage").addEventListener("click",()=>state.flip?.flipPrev("bottom"));
$("nextPage").addEventListener("click",()=>state.flip?.flipNext("bottom"));
$("pageSlider").addEventListener("change",e=>goPage(Number(e.target.value)));
$("editionSearch").addEventListener("input",archive);
$("fullScreen").addEventListener("click",async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $("readerShell").requestFullscreen()}catch(e){console.warn(e)}});
function closeZoom(){$("zoomDialog").hidden=true;if(state.zoomRender){try{state.zoomRender.cancel()}catch(e){}state.zoomRender=null}}
async function renderZoom(){
 if(!state.pdf||$("zoomDialog").hidden)return;
 $("zoomLevel").textContent=Math.round(state.zoomScale*100)+"%";
 try{
  if(state.zoomRender){state.zoomRender.cancel();try{await state.zoomRender.promise}catch(e){}}
  const page=await state.pdf.getPage(state.zoomPage+1);
  const base=page.getViewport({scale:1});
  const width=Math.min(950,Math.max(260,window.innerWidth-50))*state.zoomScale;
  const view=page.getViewport({scale:Math.min(4,width/base.width)});
  const canvas=$("zoomCanvas");canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
  state.zoomRender=page.render({canvasContext:canvas.getContext("2d",{alpha:false}),viewport:view});
  await state.zoomRender.promise;state.zoomRender=null;
 }catch(e){if(e.name!=="RenderingCancelledException")console.warn(e)}
}
$("zoomOpen").addEventListener("click",()=>{if(!state.pdf||!state.flip)return;state.zoomPage=state.flip.getCurrentPageIndex();state.zoomScale=1;$("zoomPageTitle").textContent="Page "+(state.zoomPage+1);$("zoomDialog").hidden=false;renderZoom()});
$("zoomClose").addEventListener("click",closeZoom);
$("zoomIn").addEventListener("click",()=>{state.zoomScale=Math.min(3,state.zoomScale+.25);renderZoom()});
$("zoomOut").addEventListener("click",()=>{state.zoomScale=Math.max(.5,state.zoomScale-.25);renderZoom()});
document.addEventListener("keydown",e=>{
 if(!$("zoomDialog").hidden){if(e.key==="Escape")closeZoom();return}
 if(["INPUT","TEXTAREA"].includes(document.activeElement?.tagName))return;
 if(e.key==="ArrowRight"){e.preventDefault();state.flip?.flipNext("bottom")}
 if(e.key==="ArrowLeft"){e.preventDefault();state.flip?.flipPrev("bottom")}
});
init();
