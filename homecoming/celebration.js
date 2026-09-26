
// Homecoming 2026: runs on every page load, with no remembered dismissal.
(async function () {
  const cutoff = Date.parse('2026-09-28T15:00:00-06:00');
  function confirmedHomecomingWin(team, now) {
    if (now < Date.parse('2026-09-25T19:00:00-06:00') || now >= cutoff) return null;
    return [...(team?.results || []), ...(team?.result ? [team.result] : [])].find(r =>
      r.date === '2026-09-25' && /^parowan$/i.test((r.opponent || '').trim()) &&
      (r.level || 'Varsity') === 'Varsity' &&
      Number.isFinite(r.ours) && Number.isFinite(r.theirs) &&
      r.ours > r.theirs && r.theirs >= 0 &&
      (!r.status || /^(final|completed)$/i.test(r.status))
    );
  }
  const result = confirmedHomecomingWin(typeof teams === 'undefined' ? null : teams.find(t => t.id === 'football'), Date.now());
  if (!result) return;
  try {
    const response = await fetch('/homecoming/', {cache: 'no-store'});
    if (!response.ok || Date.now() >= cutoff) return;
    const template = new DOMParser().parseFromString(await response.text(), 'text/html');
    const dialogTemplate = template.querySelector('dialog#win');
    const styleTemplate = template.querySelector('style');
    if (!dialogTemplate || !styleTemplate) return;
    const host = document.createElement('div');
    const shadow = host.attachShadow({mode: 'open'});
    shadow.append(styleTemplate.cloneNode(true), dialogTemplate.cloneNode(true));
    const style = document.createElement('style');
    style.textContent = ':host{font-family:Arial,Helvetica,sans-serif}';
    shadow.append(style);
    document.body.append(host);
    const modal = shadow.querySelector('dialog');
    shadow.querySelector('.final').textContent = 'FINAL · SEPTEMBER 25, 2026';
    const scoreboard = shadow.querySelector('.scoreboard');
    scoreboard.setAttribute('aria-label', 'Kanab ' + result.ours + ', Parowan ' + result.theirs);
    scoreboard.querySelectorAll('.score')[0].textContent = result.ours;
    scoreboard.querySelectorAll('.score')[1].textContent = result.theirs;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = () => modal.close();
    shadow.querySelector('#close').addEventListener('click', close);
    shadow.querySelector('#back').addEventListener('click', close);
    const timeout = setTimeout(close, Math.max(0, cutoff - Date.now()));
    const checkExpiry = () => { if (Date.now() >= cutoff && modal.open) close(); };
    document.addEventListener('visibilitychange', checkExpiry);
    modal.addEventListener('close', () => {
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', checkExpiry);
      document.body.style.overflow = previousOverflow;
      host.remove();
      previousFocus?.focus({preventScroll:true});
    }, {once:true});
    modal.showModal();
    modal.querySelector('.celebration').classList.add('entrance');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const confetti = shadow.querySelector('#confetti');
      for (let i = 0; i < 64; i++) {
        const piece = document.createElement('i');
        piece.style.setProperty('--left', Math.random()*100+'%');
        piece.style.setProperty('--delay', Math.random()*1.4+'s');
        piece.style.setProperty('--drift', (Math.random()-.5)*180+'px');
        piece.style.setProperty('--color', ['#f12c3d','#fff5df','#eab753'][i%3]);
        confetti.append(piece);
      }
    }
    shadow.querySelector('#close').focus({preventScroll:true});
  } catch (error) {
    console.warn('Homecoming celebration unavailable', error);
  }
})();
