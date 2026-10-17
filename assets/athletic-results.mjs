// Curated official meet results. Rankings, entries and projections are never wins.
export function officialResults(feed,now=Date.now()){
 const seen=new Set();return (Array.isArray(feed?.results)?feed.results:[]).filter(r=>{
  let url;try{url=new URL(r.sourceUrl)}catch{return false}
  const day=Date.parse(r.date+'T12:00:00Z'),published=Date.parse(r.publishedAt);
  if(!r.id||seen.has(r.id)||r.schoolId!==2577||r.status!=='official'||!['team','individual'].includes(r.kind)||!['Cross Country','Track & Field'].includes(r.sport)||!Number.isInteger(r.place)||r.place<1||!r.team||!r.meet||!r.division||(r.kind==='individual'&&!r.athlete)||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==r.date||r.date>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver'}).format(new Date(now))||now-day>14*86400000||!Number.isFinite(published)||published>now||url.protocol!=='https:'||!['athletic.net','www.athletic.net'].includes(url.hostname)||url.username||url.password||!/^\/(CrossCountry|TrackAndField)\/meet\/\d+\/results\//i.test(url.pathname))return false;
  seen.add(r.id);return true;
 }).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export function isFreshWin(r,now=Date.now()){
 const published=Date.parse(r.publishedAt),day=Date.parse(r.date+'T12:00:00Z');
 return r.place===1&&now>=published&&now-published<86400000&&now-day>=-86400000&&now-day<2*86400000;
}
export async function mountAthleticResults(){
 const host=document.getElementById('athleticResults');if(!host)return;
 const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
 try{const response=await fetch('/assets/athletic-results.json',{cache:'no-store'});if(!response.ok)throw Error('feed');const rows=officialResults(await response.json());host.replaceChildren();if(!rows.length){host.hidden=true;return}host.hidden=false;host.append(el('h2','KHS meet results'));
 for(const r of rows){const card=el('article','');card.className='card';card.style.padding='20px';card.append(el('p',r.sport+' · '+r.date+' · Official'),el('h3',r.team+(r.kind==='individual'&&r.athlete?' · '+r.athlete:'')),el('strong',(r.place===1?'🏆 First place!':'Place '+r.place)+(r.mark?' · '+r.mark:'')),el('p',r.meet+' · '+r.division));const link=el('a','View official results ↗');link.href=r.sourceUrl;link.target='_blank';link.rel='noopener';card.append(link);host.append(card);}
 const winner=rows.find(r=>isFreshWin(r));if(!winner)return;
 let shown=false;try{shown=sessionStorage.getItem('athletic-win:'+winner.id)==='seen'}catch{}if(shown||document.querySelector('dialog[open]'))return;
 const dialog=el('dialog','');dialog.style.cssText='border:0;border-radius:20px;padding:32px;max-width:520px;width:calc(100% - 40px);text-align:center;background:#fff;color:#111';dialog.setAttribute('aria-label','Kanab first-place celebration');dialog.append(el('p','🏆 KANAB WINS · '+winner.sport),el('h2',winner.kind==='individual'?winner.athlete+' takes first!':winner.team+' take first!'),el('p',winner.meet+' · '+winner.division),el('p',winner.date+(winner.mark?' · '+winner.mark:'')));const link=el('a','Official Athletic.net result ↗');link.href=winner.sourceUrl;link.target='_blank';link.rel='noopener';dialog.append(link,el('br',''));const close=el('button','Go Kanab!');close.className='linkbtn';close.onclick=()=>dialog.close();dialog.append(close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();close.focus();try{sessionStorage.setItem('athletic-win:'+winner.id,'seen')}catch{}
 }catch{host.hidden=false;host.replaceChildren(el('p','Meet results are temporarily unavailable.'));}
}
if(typeof document!=='undefined')mountAthleticResults();
