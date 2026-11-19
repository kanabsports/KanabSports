const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:920,height:720},reducedMotion:'reduce'});
  const base='http://localhost:8080',pictures=[];
  let signedIn=false,revision=0,details='',newMessage=false;
  const coach={id:'demo',team_code:'DEMO',name:'Coach Avery',role:'Head Coach',team_name:'Demo Cowboys',organization:'Demo Cowboys',sport:'Basketball'};
  const game={date:'2026-11-19',opponent:'Demo Eagles',result:'48–42',scoreId:'demo-game',status:'live'};
  await page.route('**/api/**',route=>{
   const url=new URL(route.request().url()),post=route.request().method()==='POST';
   let data={success:true};
   switch(url.pathname){
    case '/api/coach-account':data={authenticated:signedIn,coach:signedIn?coach:null,success:true};break;
    case '/api/coach-pep-talk':data={available:true,active:true,message:'Pep Talk is on for your approved coaching staff.'};break;
    case '/api/pep-audiences':data=url.searchParams.has('team')?{messages:[{sequence:1,author_name:'Coach Avery',created:Date.UTC(2026,10,19,16),body:'Meet at court two before warm-ups.'},...(newMessage?[{sequence:2,author_name:'Coach Lee',created:Date.UTC(2026,10,19,16,1),body:'I have the basketballs.'}]:[])]}:{channels:[{team_code:'DEMO',organization_id:'org',enrollment:''}]};break;
    case '/api/coach-schedule':data={success:true,coach:{team:'Demo Cowboys'},games:[game]};break;
    case '/api/score-assistant-submit':data={success:true,assistant:{name:'Demo score assistant',status:'accepted',trusted:true},coach,games:[{...game,status:'open'}]};break;
    case '/api/score-details':if(post){details=route.request().postDataJSON().details;revision++}data={details,revision,team:coach.team_name,opponent:game.opponent,result:game.result,event_date:game.date};break;
    case '/api/season-sheet':data={sheets:[],team:coach.team_name,canEdit:true};break;
   }
   return route.fulfill({json:data});
  });
  const shot=async(title,copy,selector)=>{
   const target=page.locator(selector).first();await target.waitFor();
   const image=await target.screenshot({type:'jpeg',quality:75,animations:'disabled'});pictures.push({title,copy,image:image.toString('base64')});
  };
  await page.goto(base+'/index.html',{waitUntil:'domcontentloaded'});
  const nav=page.locator('a[href*="coach-account.html?portal=1"]').first();
  assert.equal(await nav.getAttribute('target'),'_blank');
  await shot('Open Coach Portal','On the Kanab Sports homepage, choose Coach Portal in the top navigation. Sign-in opens in a separate window or tab.', 'a[href*="coach-account.html?portal=1"]');
  await page.goto(base+'/coach-account.html?portal=1');
  await shot('Sign in','Returning coaches enter their email and password. A saved session opens Pep Talk directly. New coaches use Request an account, choose their actual team and role, and wait for approval. The approval email leads to password setup.','#coachLogin');
  await shot('Set a password once','After approval, enter the same email, request the six-digit code, then enter that code and choose a password. If two roles share an email, use the invitation for the intended account.','#setup >> ..');
  signedIn=true;await page.goto(base+'/coaches.html');
  await page.getByText('Meet at court two before warm-ups.').waitFor();newMessage=true;
  await page.getByText('I have the basketballs.',{exact:true}).waitFor({timeout:18000});
  await shot('Read and reply in Pep Talk','The first tab shows the latest staff messages automatically. The approved travel head coach turns it on once. Approved assistants on that team open the same conversation. Use Open conversation & reply to send a staff message.','#view-pep-talk');
  await page.goto(base+'/season-sheet.html');await page.locator('#connect details[open]').waitFor();
  await shot('Connect the season workbook','In Events & uploads, open Team season spreadsheet. The lead coach imports the workbook into Google Sheets, grants editors access, and saves its link for this season. Staff use that same link for later edits.','main');
  await page.goto(base+'/score-assistant/?token=fixture');
  await page.locator('[data-us]').fill('48');await page.locator('[data-them]').fill('42');
  await shot('Report the final','The coach invites a score assistant and marks them trusted. The assistant accepts the score-only invitation, opens the game, enters both totals and submits. A trusted final publishes immediately. Other assistants send scores for coach approval.','#games');
  await page.goto(base+'/coaches.html#quick-scores');await page.locator('#scheduleScoreCard a[href*="score-details"]').waitFor();
  await shot('Find the published score','The coach opens Scores and chooses Upload stats screenshot beside the final. For a manually reported game, choose Add stats to a published score.','#view-scores');
  const sample=await browser.newPage();await sample.setContent('<style>body{font:36px Arial;padding:25px;background:white;color:black}td,th{text-align:left;padding:9px 26px}</style><table><tr><th>Player</th><th>PTS</th><th>REB</th><th>AST</th></tr><tr><td>Avery</td><td>18</td><td>7</td><td>4</td></tr><tr><td>Jordan</td><td>12</td><td>6</td><td>3</td></tr></table>');
  const png=await sample.locator('table').screenshot();await sample.close();
  await page.goto(base+'/score-details.html?id=demo-game');
  await page.locator('#picture').setInputFiles({name:'fictional-box-score.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>document.querySelector('#details').value.includes('18'),null,{timeout:120000});
  const extracted=await page.locator('#details').inputValue();assert.match(extracted,/Avery/i);assert.match(extracted,/Jordan/i);
  await shot('Check the screenshot and publish','Crop the MaxPreps stats table so the headings and rows are readable. Pep fills the draft with recognized text. Check each name and number, correct errors, then choose Publish reviewed stats. The existing final score stays attached.','main');
  await page.locator('#save').click();await page.locator('#publicLink').click();
  await page.getByText('Demo Cowboys vs. Demo Eagles').waitFor();
  assert.match(await page.locator('#details').textContent(),/18/);
  await shot('See what families see','Open View published game stats. Only the coach-reviewed details appear alongside the final. The original screenshot stays on the coach’s device.','main');
  const path=process.env.GUIDE_OUTPUT||'coach-walkthrough.html';
  const steps=pictures.map((p,i)=>'<section id="s'+(i+1)+'"><div class="num">'+(i+1)+'</div><div><h2>'+p.title+'</h2><p>'+p.copy+'</p><img alt="'+p.title+' screen with fictional data" src="data:image/jpeg;base64,'+p.image+'"></div></section>').join('');
  fs.writeFileSync(path,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coach walkthrough · Kanab Sports</title><style>*{box-sizing:border-box}body{font:17px/1.5 system-ui;background:#f6f5f1;color:#17231e;max-width:860px;margin:auto;padding:28px}h1{font-size:clamp(36px,7vw,64px);line-height:1.02}h2{font-size:25px;margin:0}.map{background:#183f33;color:white;padding:18px;border-radius:12px}.map a{color:white}section{border-left:3px solid #a6b9af;display:grid;grid-template-columns:42px 1fr;gap:8px;padding:24px 0;margin-left:18px}.num{background:#174734;color:white;border-radius:100%;width:34px;height:34px;text-align:center;padding-top:4px;margin-left:-18px}img{max-width:100%;height:auto;border:1px solid #bbc7c0;border-radius:10px}section>div{min-width:0}p{margin:6px 0 14px}@media print{section{break-inside:avoid}.map{color:black}}</style><main><h1>A coach’s first game on Pep</h1><p>Illustrated with the actual portal screens and a fictional travel basketball team.</p><nav class="map"><b>Coach onboarding</b><br><a href="#s1">Open portal</a> → <a href="#s2">Sign in</a> or <a href="#s3">Set password after approval</a> → <a href="#s4">Pep Talk</a><hr><b>Team setup</b> → <a href="#s5">Connect season sheet</a><br><b>Game day</b> → <a href="#s6">Assistant reports final</a> → <a href="#s7">Coach opens score</a> → <a href="#s8">Review stats</a> → <a href="#s9">Public game details</a></nav>'+steps+'</main></html>');
  console.log('Verified automatic staff refresh, actual in-browser screenshot OCR, coach review and public game details.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
