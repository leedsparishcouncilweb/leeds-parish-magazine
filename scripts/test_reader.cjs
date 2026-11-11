const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];
 page.on('pageerror',e=>errors.push('JS '+String(e)));
 page.on('console',e=>{if(e.type()==='error')errors.push('CONSOLE '+e.text())});
 page.on('requestfailed',r=>errors.push('NETWORK '+r.url()+' '+r.failure()?.errorText));
 try{
  await page.goto('http://127.0.0.1:8765/?utm_source=chatgpt.com#edition=november-2026',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>!location.search.includes('utm_source') && !location.hash.includes('utm_source'),null,{timeout:10000});
  if(page.url().includes('chatgpt.com'))throw Error('ChatGPT referral parameter was not removed');
  console.log('CLEAN URL:',page.url());
  await page.waitForFunction(()=>document.querySelector('#loading')?.hidden===true,null,{timeout:60000});
  const err=await page.locator('#readerError').evaluate(el=>!el.hidden);
  if(err)throw Error("Reader displayed error: "+await page.locator('#errorText').innerText());
  const count=await page.locator('#totalPages').innerText();
  if(!count.includes("pages")||count.startsWith("—"))throw Error("Page count not loaded: "+count);
  console.log("PDF LOADED:",count);
  async function checkSelectedCover(edition){
    const all=page.locator('#issueList .issue-button');
    const count=await all.count();
    if(count<4)throw Error("Expected at least four edition covers, found "+count);
    const first=all.first();
    if(!(await first.getAttribute('class')||'').split(/\s+/).includes('is-current'))throw Error("Selected edition not highlighted");
    if((await first.getAttribute('aria-pressed'))!=='true')throw Error("Selected edition missing pressed state");
    if(!(await first.innerText()).includes(edition))throw Error("Highlighted cover wrong: "+await first.innerText());
    console.log("SIDEBAR HIGHLIGHT:",edition);
  }
  await checkSelectedCover(await page.locator('#editionTitle').innerText());
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
    await checkSelectedCover(edition);
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
  // Phone viewport: show one large page, with controls and selected edition intact.
  const mobile=await browser.newPage({
    viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true
  });
  mobile.on("pageerror",e=>errors.push("MOBILE JS "+String(e)));
  await mobile.goto('http://127.0.0.1:8765/#edition=november-2026',{waitUntil:'domcontentloaded',timeout:30000});
  await mobile.waitForFunction(()=>{
    const loading=document.querySelector('#loading');
    return loading?.hidden===true && document.querySelector('#totalPages')?.textContent?.includes('pages');
  },null,{timeout:60000});
  const metrics=await mobile.evaluate(()=>{
    const rect=selector=>{
      const el=document.querySelector(selector);
      if(!el)return null;
      const r=el.getBoundingClientRect();
      return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};
    };
    return {
      orientation:document.querySelector('#readerShell')?.dataset.orientation,
      viewport:window.innerWidth,
      surface:rect('.reading-surface'),
      stage:rect('#bookStage'),
      book:rect('#flipbook'),
      firstCanvas:rect('.magazine-page canvas'),
      title:rect('#editionTitle'),
      numberOfCanvases:document.querySelectorAll('.magazine-page canvas').length
    };
  });
  console.log("MOBILE METRICS:",JSON.stringify(metrics));
  if(metrics.orientation!=='portrait')throw Error("Phone not in single-page portrait mode: "+JSON.stringify(metrics));
  if(metrics.surface.width<340)throw Error("Mobile reader not full-width");
  if(metrics.surface.y>395)throw Error("Excessive blank header space on phone");
  if(metrics.surface.height>metrics.surface.width*1.65)throw Error("Excessive blank page surround");
  await mobile.locator('#nextPage').click();
  await mobile.waitForFunction(()=>document.querySelector('#pageStatus')?.textContent?.startsWith('Page 2'),null,{timeout:12000});
  console.log("MOBILE PAGE TURN:",await mobile.locator('#pageStatus').innerText());
  const safariTapProtection=await mobile.evaluate(()=>{
    const arrow=document.querySelector('#nextPage');
    const surface=document.querySelector('.reading-surface');
    return {
      arrowTouchAction:getComputedStyle(arrow).touchAction,
      surfaceTouchAction:getComputedStyle(surface).touchAction,
      arrowWidth:arrow.getBoundingClientRect().width,
      scale:window.visualViewport?.scale||1
    };
  });
  console.log("MOBILE TAP PROTECTION:",JSON.stringify(safariTapProtection));
  if(safariTapProtection.arrowTouchAction!=='manipulation'||
     safariTapProtection.surfaceTouchAction!=='manipulation'||
     safariTapProtection.arrowWidth<44)throw Error('Phone page-turn target lacks double-tap prevention');
  // Exercise actual touch taps rather than mouse-based Playwright clicks.
  await mobile.locator('#nextPage').tap();
  await mobile.waitForFunction(()=>document.querySelector('#pageStatus')?.textContent?.startsWith('Page 3'),null,{timeout:12000});
  await mobile.waitForTimeout(530);
  await mobile.locator('#nextPage').tap();
  await mobile.waitForTimeout(80);
  await mobile.locator('#nextPage').tap();
  await mobile.waitForTimeout(700);
  const tapScale=await mobile.evaluate(()=>window.visualViewport?.scale||1);
  if(tapScale>1.01)throw Error('Rapid page-turn taps magnified browser viewport: '+tapScale);
  if(await mobile.locator('#zoomReset').innerText()!=='100%')throw Error('Rapid page-turn taps activated reader zoom');
  console.log("MOBILE RAPID TAPS PASSED:",await mobile.locator('#pageStatus').innerText());
  await mobile.locator('#zoomIn').click();
  if(await mobile.locator('#zoomReset').innerText()!=='125%')throw Error('Mobile zoom not working');
  await mobile.locator('#zoomReset').click();
  await mobile.locator('#issueList .issue-button').filter({hasText:'October 2026'}).click();
  await mobile.waitForFunction(()=>{
    return document.querySelector('#editionTitle')?.textContent==='October 2026'
      &&document.querySelector('#loading')?.hidden===true;
  },null,{timeout:60000});
  if(await mobile.locator('#readerShell').getAttribute('data-orientation')!=='portrait')
    throw Error('Changing editions dropped mobile portrait mode');
  console.log("MOBILE SWITCH PASSED");
  await mobile.close();
  if(errors.some(x=>x.startsWith('JS ')||x.startsWith('MOBILE JS ')))throw Error("Browser errors: "+JSON.stringify(errors.slice(0,6)));
  if(errors.length)console.warn("BROWSER DIAGNOSTICS:",JSON.stringify(errors.slice(0,10)));
  console.log("SMOKE TEST PASSED");
 }catch(e){
  console.error("SMOKE TEST FAILED:",String(e));
  console.error("PAGE STATUS:",await page.locator('#pageStatus').innerText().catch(()=>'<none>'));
  console.error("PAGE ERRORS:",JSON.stringify(errors.slice(0,16)));
  throw e;
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
