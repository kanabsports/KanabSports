# Shared coach inbox

Entry point: `/coach-inbox.html`. Uses the existing `/api/coach-account` login and `ks_coach` server-backed session. Head and assistant coaches have identical read/send permissions for their assigned team's staff conversation. Head coaches alone can add approved coach accounts or remove assistants. Messages retain the authenticated sender and survive removal. Membership is checked on each read/write; being approved for another team gives no access.

An approved coach creates a named workspace, then adds approved assistants by their account email. No email invitation is sent. Each assistant signs in with their own account. Do not share passwords or infer membership from sport, organization, names, or roster entries. Existing Britt/Jodi pilot sessions are not accepted by this new endpoint.

The portal now separates two audiences: private Coaching Staff messages and Parents & Guardians team texts. Head and assistant coaches have the same ability to prepare, preview and confirm operational parent messages. Each parent broadcast records the authenticated coach, timestamp, recipient count, successes and failures. Coaches never see family phone numbers in this interface.

Parent delivery uses the existing `sms_enrollment` consent records and sends only to distinct numbers whose status is `consented` and whose enrollment step is `complete`. Each team workspace must be connected administratively by setting `shared_teams.sms_team_key` to the matching enrollment team key. The server adds the Kanab Sports/team identity and STOP language to every message, and requires an exact final confirmation before delivery. Promotional or gear marketing is outside this flow and still requires separate, explicit marketing consent.

Keep `TEAM_PARENT_SENDING_ENABLED` unset in previews and production until the Twilio A2P campaign is approved and the team-to-enrollment mapping has been verified. Enabling delivery requires `TEAM_PARENT_SENDING_ENABLED=true`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_PHONE_NUMBER`. Existing team portals, documents and public pages are unchanged.

Tables `shared_teams`, `team_coaches`, `team_messages`, `team_broadcasts`, `team_broadcast_deliveries`, and the existing-compatible `sms_enrollment` schema are created additively in `SPORTS_DB` on authenticated use. There is no automatic migration of existing memberships or private records. Use an isolated preview database and test accounts for deployment verification; don't send test messages to real families. Rate limiting and centralized admin reassignment are follow-up work before a broad rollout.

Run `node --test tests/team-messages.test.mjs` (Node 24). Tests use an in-memory SQLite database to exercise authentication, team isolation, head/assistant permissions, immutable sender identity, idempotent sends, pagination, CSRF rejection, and immediate access revocation.
