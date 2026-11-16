export function teamInvite(coach, origin) {
  const code = String(coach.teamCode || '').trim();
  if (!/^[A-Z0-9_-]{1,32}$/.test(code)) throw new Error('Your team code is unavailable. Please reload.');
  const name = String(coach.name || '').replace(/^coach\s+/i, '').trim();
  const team = String(coach.team || coach.organization || '').trim();
  const sport = String(coach.sport || '').trim();
  const label = [team, sport && !team.toLowerCase().includes(sport.toLowerCase()) ? sport : ''].filter(Boolean).join(' · ');
  const url = new URL('/join/' + encodeURIComponent(code), origin).href;
  const role = /assistant/i.test(coach.role || '') ? 'Assistant Coach' : 'Coach';
  return {code, url, message: `Hi families! This is ${role} ${name} with ${label}. Join our team’s free Kanab Sports parent portal for team messages, schedules, and updates. No app download needed.\n\nJoin our team: ${url}\nTeam code: ${code}\n\nUse your parent/guardian email to sign in or create an account. Team access may require approval.`};
}
