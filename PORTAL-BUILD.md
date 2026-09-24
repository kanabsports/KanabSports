# Coach and parent portal — development build

Entry: `/dev-portal.html` on the preview branch. This is an interactive, isolated design prototype, not authentication or a production parent portal. It uses only synthetic sample data in sessionStorage. Never enter real family data. Nothing is sent to Twilio or an existing API. Role switching is explicitly a preview control, never an authorization mechanism.

Implemented journeys:
- Head/assistant views use the same per-team sample schedule, roster and attributed message history.
- Team switcher: Varsity Cowboys, Rec Girls Travel Soccer, KHS Volleyball.
- Message audience + preview + confirmation, sample score submission, schedule changes.
- Parent joining -> pending -> coach approve and explicitly link a roster player, or deny; decision audit is visible to both coach views.
- Approved parent view with messages, schedule, directions, sample calendar export and separate reminder preference.
- Mobile layout, keyboard-accessible native dialogs and form validation, resettable sample state.

Before connecting live data:
1. Use server-backed authenticated sessions and server-enforced community/team memberships. Do not trust preview roles, URLs, local storage or legacy unsigned pilot cookies.
2. Migrate head and assistant memberships explicitly, preserving existing records. Keep coach approval and access revocation auditable.
3. Implement expiring/revocable team invite tokens, verified phone identity, request rate limits, duplicate prevention and pending access restrictions. Coach approval can create a newly linked membership, never recover an existing parent's identity or history without verification.
4. Wire roster, events, documents and attributed messages to authorized persistent APIs; define parent visibility separately from staff visibility.
5. Finish Twilio verification and independent SMS opt-in. Use a durable outbox and atomic delivery claims before enabling sends; retries must not double-send.
6. Replace or secure the legacy pilot endpoints before copying any private data into the new portal. Audit found an unsigned pilot cookie and legacy roster/assistant endpoints without session checks.
7. Add isolated staging bindings, integration tests for tenant isolation and revocation, monitoring, backups and restore verification.
8. Configure Britt/Jodi with confirmed real team memberships and run the pilot. The displayed example team names are not inferred pilot assignments.

The current live site's accounts, navigation and data have not been migrated by this prototype.
