(function(){
  const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};

  function dateFromLabel(label){
    const text=String(label||'').toLowerCase().replace(/\./g,'');
    const match=text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})\b/);
    if(!match)return Number.MAX_SAFE_INTEGER;
    const now=new Date();
    return new Date(now.getFullYear(),MONTHS[match[1]],Number(match[2]),12,0,0).getTime();
  }

  function sortHappeningNow(){
    const heading=[...document.querySelectorAll('h2')].find(h=>/happening now/i.test(h.textContent));
    const section=heading?.closest('section');
    const list=section?.querySelector('.live-list');
    if(!list)return;

    const cards=[...list.children].filter(el=>el.classList.contains('live-item'));
    cards.sort((a,b)=>{
      const aw=a.querySelector('.when')?.textContent||'';
      const bw=b.querySelector('.when')?.textContent||'';
      const aFeatured=/\bfeatured\b/i.test(aw);
      const bFeatured=/\bfeatured\b/i.test(bw);
      if(aFeatured!==bFeatured)return aFeatured?-1:1;
      const ad=dateFromLabel(aw),bd=dateFromLabel(bw);
      if(ad!==bd)return ad-bd;
      return 0;
    });
    cards.forEach(card=>list.appendChild(card));
  }

  function start(){
    sortHappeningNow();
    const heading=[...document.querySelectorAll('h2')].find(h=>/happening now/i.test(h.textContent));
    const list=heading?.closest('section')?.querySelector('.live-list');
    if(!list)return;
    let timer;
    const observer=new MutationObserver(()=>{
      clearTimeout(timer);
      timer=setTimeout(sortHappeningNow,40);
    });
    observer.observe(list,{childList:true,subtree:false});
    setTimeout(sortHappeningNow,500);
    setTimeout(sortHappeningNow,1500);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();
