const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];
 page.on('pageerror',e=>errors.push('JS '+String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push('CONSOLE '+e.text())});
 page.on('requestfailed',r=>errors.push('NETWORK '+r.url()+' '+r.failure()?.errorText));
 try{
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#loading')?.hidden===true,null,{timeout:60000});
  const err=await page.locator('#readerError').evaluate(el=>!el.hidden);
  if(err)throw Error("Reader displayed error: "+await page.locator('#errorText').innerText());
  const count=await page.locator('#totalPages').innerText();
  if(!count.includes("pages")||count.startsWith("—"))throw Error("Page count not loaded: "+count);
  console.log("PDF LOADED:",count);
  await page.locator('#zoomIn').click();
  const zoom=await page.locator('#zoomReset').innerText();
  if(zoom!=='125%')throw Error("Zoom failed: "+zoom);
  console.log("INLINE ZOOM:",zoom);
  await page.locator('#zoomReset').click();
  const reset=await page.locator('#zoomReset').innerText();
  if(reset!=='100%')throw Error("Reset failed: "+reset);
  await page.locator('#nextPage').click();
  await page.waitForTimeout(1000);
  console.log("AFTER PAGE TURN:",await page.locator('#pageStatus').innerText());
  // Exercise multiple editions rather than only the latest cover.
  async function waitForReady(edition){
    await page.waitForFunction(()=>document.querySelector('#editionTitle')?.textContent===document.body.dataset.expectEdition
        &&document.querySelector('#loading')?.hidden===true
        &&document.querySelector('#totalPages')?.textContent!=="— pages",
        null,{timeout:60000});
    if(await page.locator('#readerError').isVisible()){
      throw Error('Reader error after switching to '+edition+': '+await page.locator('#errorText').innerText());
    }
    console.log("SWITCH OK:",edition,await page.locator('#totalPages').innerText());
  }
  for(const edition of ['September 2026','July 2026','August 2022','October 2026']){
    await page.evaluate(s=>document.body.dataset.expectEdition=s,edition);
    await page.locator('#issueList .issue-button').filter({hasText:edition}).click({timeout:12000});
    await waitForReady(edition);
  }
  // A second click during loading must cancel the stale edition without stalling.
  await page.evaluate(()=>document.body.dataset.expectEdition="October 2026");
  await page.locator('#issueList .issue-button').filter({hasText:'September 2026'}).click();
  await page.locator('#issueList .issue-button').filter({hasText:'October 2026'}).click();
  await waitForReady('October 2026');
  if(errors.some(x=>x.startsWith('JS ')))throw Error("Browser errors: "+JSON.stringify(errors.slice(0,6)));
  if(errors.length)console.warn("BROWSER DIAGNOSTICS:",JSON.stringify(errors.slice(0,10)));
  console.log("SMOKE TEST PASSED");
 }catch(e){
  console.error("SMOKE TEST FAILED:",String(e));
  console.error("PAGE STATUS:",await page.locator('#pageStatus').innerText().catch(()=>'<none>'));
  console.error("PAGE ERRORS:",JSON.stringify(errors.slice(0,16)));
  throw e;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
