// Show the finished homecoming celebration on every homepage load through Monday at 3 PM.
(() => {
  const cutoff = Date.parse('2026-09-28T15:00:00-06:00');
  const now = Date.now();
  if (now < Date.parse('2026-09-25T19:00:00-06:00') || now >= cutoff) return;
  const football = typeof teams === 'undefined' ? null : teams.find(team => team.id === 'football');
  const final = [...(football?.results || []), ...(football?.result ? [football.result] : [])].find(result =>
    result.date === '2026-09-25' && /^parowan$/i.test((result.opponent || '').trim()) &&
    (result.level || 'Varsity') === 'Varsity' &&
    (result.status || '').toUpperCase() === 'FINAL' &&
    Number(result.ours) === 49 && Number(result.theirs) === 0
  );
  if (!final) return;

  // A regular same-origin frame avoids a second fetch and a dialog inside Shadow DOM.
  const frame = document.createElement('iframe');
  frame.title = 'Kanab Cowboys Homecoming Champions celebration';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;height:100dvh;border:0;background:transparent;z-index:2147483647';
  frame.src = '/homecoming/?embed=1';
  let ready = false;
  let expiry, failedLoad;
  const remove = () => {
    clearTimeout(expiry);
    clearTimeout(failedLoad);
    window.removeEventListener('message', onMessage);
    document.removeEventListener('visibilitychange', checkExpiry);
    frame.remove();
  };
  const checkExpiry = () => { if (Date.now() >= cutoff) remove(); };
  const onMessage = event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data === 'kanab-homecoming-ready') ready = true;
    if (event.data === 'kanab-homecoming-close') remove();
  };
  window.addEventListener('message', onMessage);
  document.addEventListener('visibilitychange', checkExpiry);
  expiry = setTimeout(remove, cutoff - now);
  failedLoad = setTimeout(() => { if (!ready) remove(); }, 7000);
  document.body.append(frame);
})();
