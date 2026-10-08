import {findBlockedWords, LANGUAGE_NOTE} from './pep-language.mjs';
const configurations=[['coachMessageBody','postCoachMessage'],['talk-message','talk-form']];
const editors=new WeakMap();
function attach(textarea,button){
  if(editors.has(textarea))return;
  const wrapper=document.createElement('div');wrapper.style.cssText='position:relative;width:100%;isolation:isolate';
  textarea.before(wrapper);wrapper.append(textarea);
  const mirror=document.createElement('div');mirror.setAttribute('aria-hidden','true');wrapper.prepend(mirror);
  const note=document.createElement('p');note.id=textarea.id+'-language-note';note.textContent=LANGUAGE_NOTE;
  note.style.cssText='color:#b42318;font-size:14px;line-height:1.5;margin:8px 0';note.setAttribute('role','status');note.hidden=true;wrapper.after(note);
  textarea.setAttribute('aria-describedby',[textarea.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));
  const oldColor=getComputedStyle(textarea).color;
  textarea.style.position='relative';textarea.style.zIndex='1';
  function layout(){
    const s=getComputedStyle(textarea);
    for(const p of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textTransform','textIndent','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderRadius','boxSizing'])mirror.style[p]=s[p];
    Object.assign(mirror.style,{position:'absolute',top:textarea.offsetTop+'px',left:textarea.offsetLeft+'px',width:textarea.offsetWidth+'px',height:textarea.offsetHeight+'px',borderStyle:'solid',borderColor:'transparent',whiteSpace:'pre-wrap',overflowWrap:'break-word',wordBreak:'normal',overflow:'hidden',pointerEvents:'none',background:s.backgroundColor==='rgba(0, 0, 0, 0)'?'white':s.backgroundColor,color:oldColor});
    mirror.scrollTop=textarea.scrollTop;mirror.scrollLeft=textarea.scrollLeft;
  }
  function update(){
    const ranges=findBlockedWords(textarea.value);note.hidden=!ranges.length;
    textarea.setAttribute('aria-invalid',String(!!ranges.length));textarea.setCustomValidity(ranges.length?LANGUAGE_NOTE:'');
    // Render only text nodes; pasted markup is never interpreted as HTML.
    mirror.replaceChildren();let position=0;
    for(const range of ranges){mirror.append(document.createTextNode(textarea.value.slice(position,range.start)));const mark=document.createElement('span');mark.style.cssText='color:#b42318;text-decoration:underline;text-decoration-thickness:2px';mark.textContent=textarea.value.slice(range.start,range.end);mirror.append(mark);position=range.end;}
    mirror.append(document.createTextNode(textarea.value.slice(position)+'\n'));
    mirror.hidden=!ranges.length;
    textarea.style.color=ranges.length?'transparent':oldColor;textarea.style.caretColor=oldColor;
    textarea.style.backgroundColor=ranges.length?'transparent':'';
    if(ranges.length){button.dataset.languageBlocked='true';button.disabled=true;}
    else if(button.dataset.languageBlocked){delete button.dataset.languageBlocked;button.disabled=false;}
    layout();return !ranges.length;
  }
  editors.set(textarea,{update});textarea.addEventListener('input',update);textarea.addEventListener('scroll',layout);
  const observer=new ResizeObserver(()=>{if(!textarea.isConnected){observer.disconnect();return}layout()});observer.observe(textarea);update();
}
function scan(){for(const [id,target]of configurations){const textarea=document.getElementById(id),container=document.getElementById(target);if(textarea&&container)attach(textarea,container.tagName==='FORM'?container.querySelector('button[type=submit]'):container);}}
scan();new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
// Validate again at action time, including programmatically changed values.
for(const event of ['click','submit'])document.addEventListener(event,e=>{
  if(event==='click' && !e.target.closest('button'))return;
  for(const [id,target]of configurations){const container=document.getElementById(target);if(!container || !(e.target===container || container.contains(e.target)))continue;const textarea=document.getElementById(id);if(textarea && !editors.get(textarea)?.update()){e.preventDefault();e.stopImmediatePropagation();textarea.focus();}}
},true);
