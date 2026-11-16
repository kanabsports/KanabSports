import {teamInvite} from './team-invite-copy.mjs';

const card = document.getElementById('teamInviteCard');
let loading = false;
async function load() {
  if (!card || loading) return;
  loading = true;
  try {
    const response = await fetch('/api/coach-profile', {cache:'no-store'});
    const data = await response.json();
    if (!response.ok || !data.signedIn) throw Error(data.error || 'Sign in to see your team invite.');
    const invite = teamInvite(data.coach, location.origin);
    document.getElementById('teamInviteDialog')?.remove();
    card.innerHTML = `<h2 style="margin:0 0 12px;font-size:22px">Invite families to your team</h2>
      <label for="parentInviteCode">Parent team code</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"><input id="parentInviteCode" readonly style="font:inherit;font-weight:800;padding:12px;min-width:0;max-width:100%;width:180px"><button type="button" class="button" id="copyParentCode">Copy code</button><button type="button" class="button" id="teamInviteMore" aria-label="Open team invitation message" aria-haspopup="dialog">•••</button></div>
      <label for="parentInviteLink">Kanab Sports join link</label><input id="parentInviteLink" readonly style="display:block;width:100%;font:inherit;padding:12px;margin:8px 0">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="button" id="copyParentLink">Copy link</button><button type="button" class="button" id="openParentMessage">Share invitation</button></div><p id="parentInviteStatus" role="status" aria-live="polite"></p>`;
    const code = card.querySelector('#parentInviteCode'), link = card.querySelector('#parentInviteLink'), status = card.querySelector('#parentInviteStatus');
    code.value = invite.code; link.value = invite.url;
    const dialog = document.createElement('dialog');
    dialog.id = 'teamInviteDialog';
    dialog.setAttribute('aria-labelledby','teamInviteTitle');
    dialog.style.cssText = 'width:min(560px,calc(100% - 24px));max-height:85dvh;overflow:auto;border:1px solid #deded9;border-radius:16px;padding:22px;color:#111318;background:white';
    dialog.innerHTML = `<h2 id="teamInviteTitle">Share your team invitation</h2><p>Ready to paste into a text, email, or team chat. You can edit the message before sharing.</p><label for="teamInviteMessage">Invitation message</label><textarea id="teamInviteMessage" rows="12" style="display:block;width:100%;font:inherit;padding:12px;margin:8px 0 16px"></textarea><div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" class="button" id="copyInviteMessage">Copy message</button><button type="button" class="button" id="nativeInviteShare">Share…</button><button type="button" class="button" id="closeInvite">Close</button></div><p id="inviteMessageStatus" role="status" aria-live="polite"></p>`;
    document.body.append(dialog);
    const message = dialog.querySelector('textarea'), feedback = dialog.querySelector('#inviteMessageStatus');
    message.value = invite.message;
    async function copy(field, output, label) {
      try { await navigator.clipboard.writeText(field.value); output.textContent = label + ' copied.'; }
      catch { field.focus(); field.select(); output.textContent = 'Select and copy the highlighted text.'; }
    }
    for (const input of [code, link]) input.onclick = () => input.select();
    card.querySelector('#copyParentCode').onclick = () => copy(code, status, 'Team code');
    card.querySelector('#copyParentLink').onclick = () => copy(link, status, 'Join link');
    const open = () => dialog.showModal();
    card.querySelector('#teamInviteMore').onclick = open;
    card.querySelector('#openParentMessage').onclick = open;
    dialog.querySelector('#closeInvite').onclick = () => dialog.close();
    dialog.querySelector('#copyInviteMessage').onclick = () => copy(message, feedback, 'Invitation');
    const share = dialog.querySelector('#nativeInviteShare');
    share.hidden = !navigator.share;
    share.onclick = async () => {
      try { await navigator.share({title:'Join our team on Kanab Sports',text:message.value}); }
      catch (error) { if (error.name !== 'AbortError') feedback.textContent = 'Sharing is unavailable. Use Copy message instead.'; }
    };
  } catch (error) {
    card.replaceChildren();
    const status = document.createElement('p'); status.setAttribute('role','status'); status.textContent = error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button'; retry.textContent = 'Reload team invite'; retry.onclick = load;
    card.append(status,retry);
  } finally { loading = false; }
}
document.addEventListener('coachsessionready',load);
if (document.documentElement.dataset.coachVerified) load();
