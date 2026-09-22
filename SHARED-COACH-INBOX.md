# Shared coach inbox

Entry point: `/coach-inbox.html`. Uses the existing `/api/coach-account` login and `ks_coach` server-backed session. Head and assistant coaches have identical read/send permissions for their assigned team's staff conversation. Head coaches alone can add approved coach accounts or remove assistants. Messages retain the authenticated sender and survive removal. Membership is checked on each read/write; being approved for another team gives no access.

An approved coach creates a named workspace, then adds approved assistants by their account email. No email invitation is sent. Each assistant signs in with their own account. Do not share passwords or infer membership from sport, organization, names, or roster entries. Existing Britt/Jodi pilot sessions are not accepted by this new endpoint.

This is the staff-inbox foundation for the future app. It does not yet deliver to parent accounts, SMS, email, or push. Existing team portals, Twilio enrollment, documents and public pages are unchanged. The interface explicitly labels this staff-only audience. Parent/team messaging still needs verified family membership and notification delivery before enabling a family audience.

Tables `shared_teams`, `team_coaches`, and `team_messages` are created additively in `SPORTS_DB` on authenticated use. There is no automatic migration of existing memberships or private records. Use an isolated preview database and test accounts for deployment verification; don't send test messages to real families. Rate limiting and centralized admin reassignment are follow-up work before a broad rollout.

Run `node --test tests/team-messages.test.mjs` (Node 24). Tests use an in-memory SQLite database to exercise authentication, team isolation, head/assistant permissions, immutable sender identity, idempotent sends, pagination, CSRF rejection, and immediate access revocation.
