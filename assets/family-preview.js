const teams = [
  { id: 'd', name: 'Team D · Soccer', color: '#416bb6' },
  { id: 'b', name: 'Team B · Soccer', color: '#a25b23' },
  { id: 'v', name: 'Youth Volleyball', color: '#8656ac' }
];
const children = [
  { id: 'rowan', name: 'Rowan', teams: ['d', 'v'] },
  { id: 'avery', name: 'Avery', teams: ['b'] }
];
const events = [
  { team: 'd', date: 'Sep 28', time: '4:00 PM', title: 'Soccer Practice', place: 'Community Field 1', practice: true },
  { team: 'v', date: 'Sep 28', time: '4:30 PM', title: 'Volleyball Practice', place: 'Community Gym', practice: true },
  { team: 'b', date: 'Sep 29', time: '5:00 PM', title: 'Team B vs Team C', place: 'Community Field 2' },
  { team: 'd', date: 'Sep 30', time: '5:00 PM', title: 'Team D vs Team A', place: 'Community Field 1' },
  { team: 'v', date: 'Oct 1', time: '5:30 PM', title: 'Volleyball Match', place: 'Community Gym' }
];
const messages = [
  { team: 'd', coach: 'Coach Morgan', text: 'Please bring a water bottle and shin guards to practice.' },
  { team: 'b', coach: 'Coach Casey', text: 'Please arrive 15 minutes before the game for warmups.' },
  { team: 'v', coach: 'Coach Taylor', text: 'Our next practice is in the community gym. Bring indoor shoes.' }
];

// Fictional, read-only family preview. Actual memberships must come from verified accounts.
export function renderFamilyPreview(container) {
  let childId = 'all';
  let teamId = 'all';
  const teamFor = id => teams.find(team => team.id === id);
  const kidsFor = id => children.filter(child => child.teams.includes(id) && (childId === 'all' || child.id === childId)).map(child => child.name).join(' and ');
  const visible = id => (teamId === 'all' || teamId === id) && children.some(child => (childId === 'all' || child.id === childId) && child.teams.includes(id));
  function draw() {
    const schedule = events.filter(event => visible(event.team));
    const notes = messages.filter(message => visible(message.team));
    container.innerHTML = `
      <section class="panel">
        <div class="eyebrow">Parent</div>
        <h2 style="margin-top:8px">My Family</h2>
        <p class="small">One view for every child and team. Fictional family and sample events.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">
          <label class="small" for="family-child">Child
            <select id="family-child"><option value="all">All My Kids</option>${children.map(child => `<option value="${child.id}" ${child.id === childId ? 'selected' : ''}>${child.name}</option>`).join('')}</select>
          </label>
          <label class="small" for="family-team">Team View
            <select id="family-team"><option value="all">All Teams</option>${teams.map(team => `<option value="${team.id}" ${team.id === teamId ? 'selected' : ''}>${team.name}${team.id === 'd' ? ' · My Team' : ''}</option>`).join('')}</select>
          </label>
        </div>
      </section>
      <div class="layout">
        <section class="panel" aria-label="Family Schedule">
          <h2>Upcoming for My Family</h2>
          <p class="small">Sample season · 2026 · Kanab time</p>
          ${schedule.length ? schedule.map(event => {
            const team = teamFor(event.team);
            return `<div class="row" style="align-items:flex-start;gap:14px">
              <div style="border-left:4px solid ${team.color};padding-left:12px;min-width:0">
                <div class="small">${event.date} · ${event.time}</div>
                <h3><span ${event.practice ? 'style="color:#28754a"' : ''} aria-hidden="true">${event.practice ? '✓' : event.team === 'v' ? '🏐' : '⚽'}</span> ${event.title}</h3>
                <div class="small">${kidsFor(event.team)} · ${team.name}</div>
                <div class="small">${event.place}</div>
              </div>
            </div>`;
          }).join('') : '<p class="empty">No upcoming events for this child and team. Choose All Teams or another child.</p>'}
        </section>
        <section class="panel" aria-label="Family Team Messages">
          <h2>Team Messages</h2>
          ${notes.length ? notes.map(message => `<article class="message">
            <div class="avatar" aria-hidden="true">${message.coach.split(' ')[1][0]}</div>
            <div><h3>${message.coach}</h3><small>${teamFor(message.team).name} · For ${kidsFor(message.team)}</small><p>${message.text}</p></div>
          </article>`).join('') : '<p class="empty">No messages for this child and team.</p>'}
          <p class="small" style="margin-top:20px">Parent view · Team management stays in your coach tabs.</p>
        </section>
      </div>`;
    container.querySelector('#family-child').addEventListener('change', event => { childId = event.target.value; draw(); container.querySelector('#family-child').focus(); });
    container.querySelector('#family-team').addEventListener('change', event => { teamId = event.target.value; draw(); container.querySelector('#family-team').focus(); });
  }
  draw();
}
