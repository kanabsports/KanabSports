const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('**/api/**',r=>r.fulfill({json:{signedIn:false,available:false,schedules:[]}}));
    for(const width of [320,390,768,1100]){
      await page.setViewportSize({width,height:844});
      await page.goto('http://localhost:8080/family/');
      const tabs=page.locator('.rail [data-pane]');
      assert.deepEqual((await tabs.allTextContents()).map(s=>s.trim().replace(/\s+0$/,'')),['Home','Schedule','Updates','Teams']);
      if(width<=860){
        const row=await tabs.evaluateAll(items=>items.map(el=>el.getBoundingClientRect().top));
        assert(row.every(y=>y===row[0]),'The mobile tabs must share one row.');
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Unexpected horizontal overflow');
      }
      await tabs.nth(2).click();await page.locator('#pane-messages .family-links').waitFor();
      await tabs.nth(3).click();await page.locator('#connectApproved').waitFor();
      await page.locator('#manageFamily').click();await page.locator('#addKidTop').click();await page.locator('#addPanel').waitFor();
      await page.locator('#cancelAdd').click();await tabs.first().click();
    }
    console.log('Family layout and navigation passed at 320, 390, 768 and 1100 pixels.');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});