// Remember completed setup per portal and device subscription, never per account.
export function notificationPanel(host,{portal,title,bottom,movable=host}){
 const key='ks-notification-tested:'+portal;
 const marker=document.createComment('notification setup position');movable.before(marker);
 let details=host.querySelector(':scope > details');
 if(!details){details=document.createElement('details');details.open=true;while(host.firstChild)details.append(host.firstChild);host.append(details)}
 let summary=details.querySelector(':scope > summary');
 if(!summary){summary=document.createElement('summary');details.prepend(summary)}
 summary.textContent=title;summary.style.cssText='font-weight:900;font-size:18px;cursor:pointer;min-height:44px;line-height:44px';
 let compact=false;
 const read=()=>{try{return localStorage.getItem(key)}catch{return null}};
 function layout(done){
  if(done===compact)return;
  compact=done;details.open=!done;
  if(done){bottom.append(movable);movable.style.marginTop='16px'}
  else{marker.after(movable);movable.style.marginTop=''}
 }
 return {
  sync(sub){layout(Boolean(sub&&read()===sub.endpoint))},
  tested(sub){if(!sub)return;try{localStorage.setItem(key,sub.endpoint)}catch{}layout(true)},
  reset(){try{localStorage.removeItem(key)}catch{}layout(false)},
  error(){details.open=true}
 };
}
