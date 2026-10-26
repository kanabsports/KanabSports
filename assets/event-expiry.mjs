import {eventExpired} from './event-dates.mjs';

export function refreshEvents(root = document, now = new Date()) {
  root.querySelectorAll('[data-event-end]').forEach(card => {
    card.hidden = eventExpired(card.dataset.eventEnd, now);
  });
}

refreshEvents();
setInterval(() => refreshEvents(), 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshEvents();
});
