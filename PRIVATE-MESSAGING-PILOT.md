# Parent ↔ coach messaging pilot

## Status and scope

Implemented on a feature branch based on `0a64ba46f2ad4bf4471c5873b1af804cac05c482`.
Not deployed or activated in production. Existing live messages, accounts and team data were not modified. Tests use in-memory SQLite, fictional `example.test` accounts, and mocked email/push providers.

The `/messages/` inbox supports verified parents choosing an approved coach, private history, replies with authenticated sender names, older-message pagination, manual/30-second refresh, generic push alerts, notification tests and email links to a specific conversation. My Family and Coach Portal link to the pilot. School conversations are denied regardless of the feature flag or enrollment.

## Audit and reuse

- Audited current main and PR #26 (`153eba7f7d026b45f7b9abbd4f8c8a7fd46b7bd3`). PR #26 remains open/draft and was not merged or modified.
- Its staff workspace is shared by head/assistant coaches; that is unsuitable for private parent conversations. Its current branch also contains parent SMS broadcast scaffolding, which is unrelated to private replies.
- Reused its server-session, strict same-origin mutation, server-attributed messages, idempotent message ID, pagination and write-time access-check patterns.
- Reused main's `getCoach`, `parentSession`, approved `guardian_memberships`, `school_teams` classification, profanity filter, Resend email helper and VAPID `sendPush` transport.
- Did not create another login system, SMS broadcast flow or implicit membership from a public team code. Existing family/coach broadcasts are unchanged.
- Existing organization labels are free text. The new pilot registry assigns stable organization IDs and explicit coach/team memberships, independent of self-entered labels.

## Access boundary

Every list/read/send and notification dispatch checks the following:

1. The team is explicitly enabled in `private_message_teams` with a stable organization ID matching the conversation.
2. Its authoritative `school_teams.kind` is exactly `rec` or `travel`, and `school_id` is null. Unknown/missing/school policies fail closed.
3. The selected coach is currently approved and has an active explicit entry in `private_message_coaches` for that team.
4. The parent has an approved, unexpired guardian membership for that team.
5. The authenticated reader/sender is that exact parent or selected coach. Admin/support/Score Assistant cookies do not grant inbox access. Another coach on the same team cannot read the conversation.

Mutations require same-origin JSON. Message IDs deduplicate retries; reused IDs with different content/senders/conversations fail. Sender identity/name comes from the session. Message writes recheck eligibility in SQL, atomically with storage and notice creation. Messages are rendered as text, not HTML, with a self-only content security policy. No message cache or local message storage is used. Parents and coaches have a per-account write limit.

This is ordinary recreation/travel access isolation, **not** owner-inaccessible storage. Operators with database access can read these recreation/travel records. There is no claim that current school records, legacy broadcasts, backups or other existing features meet the requested school privacy architecture.

## Deployment dependencies and activation

1. Deploy this branch to an isolated Cloudflare Pages preview with its own `SPORTS_DB` D1 database. Do not bind the preview to production data.
2. Initialize the existing coach account, parent account, school-policy and guardian-access schemas using existing setup flows. Apply `migrations/private-messages-pilot.sql` to that database; the same additive schema is also created lazily on authenticated pilot access.
3. Set `PRIVATE_MESSAGING_ENABLED=true` only in that preview. With the variable absent or false both new APIs return 503. No team is auto-enrolled.
4. Create fictional parent/coach accounts and approve the coaches and guardian memberships using existing supported flows where the preview origin is accepted. Some existing account/approval endpoints are restricted to the canonical production origin; do not weaken those restrictions or point a preview at production. For isolated preview testing, a deployment operator can seed only fictional accounts, hashed test sessions and memberships into the preview database (the integration test shows the exact schema), then set the corresponding Secure/HttpOnly test cookies in that preview browser profile. Real sign-in must additionally be checked on the canonical deployment before pilot activation. Use only controlled test mailboxes for real notification testing.
5. Classify pilot teams as recreation/travel through the existing team-policy administration. Choose stable organization IDs and explicitly enroll teams/coaches. Review account IDs against approved identities before executing parameterized equivalents of:

```sql
-- Illustrative placeholders: replace only with verified preview records.
INSERT INTO private_message_teams(team_code,organization_id,name,enabled)
VALUES('VERIFIED-TEAM-CODE','stable-org-id','Pilot team name',1);
INSERT INTO private_message_coaches(team_code,coach_id,active)
VALUES('VERIFIED-TEAM-CODE','verified-approved-coach-id',1);
```

There is deliberately no client-facing self-enrollment or migration of PR #26's staff groups. Every approved assistant who may receive private messages needs an explicit assignment. School teams cannot be enrolled successfully even if these rows are inserted.

6. Configure `RESEND_API_KEY` and a verified sender (`RESEND_FROM_EMAIL` or existing `SCORE_EMAIL_FROM`; the reused helper defaults to `Kanab Sports <website@kanabsports.com>`). Existing parent email verification also needs Resend. Check sender-domain verification, limits and provider logs before claiming delivery. Notification links default to canonical `https://kanabsports.com/messages/`. For isolated preview links, set `PRIVATE_MESSAGING_BASE_URL=https://your-preview.pages.dev`; only an HTTPS origin on `kanabsports.com` or `*.pages.dev` is accepted. Remove the preview override for production.
7. Open `/messages/?role=parent` and `/messages/?role=coach` in separate browser profiles. Enable push and press **Send me a test notification**. Push uses the existing database VAPID keys and a separate `/messages/` service worker/subscription. HTTPS, supported browser and notification permission are required; iOS requires a Home Screen web app. The Home Screen app opens the inbox with parent/coach role links; it does not embed credentials.
8. Confirm visual/mobile behavior, parent/coach replies, logout/relogin with deep links, device receipt and real inbox receipt using only fictional test identities and controlled destinations. These browser/provider checks have not been performed in this workspace.
9. After those checks, merge/deploy through the repository's existing hosting workflow. Apply/enroll only the intended recreation/travel pilot teams and enable the flag in production. No hosting, secrets, live membership or production migration was changed by this implementation.

Rollback: set `PRIVATE_MESSAGING_ENABLED=false` to disable both APIs immediately; or set a pilot team's `enabled=0` / coach assignment's `active=0`. Preserve stored history for review. No destructive rollback or migration is required.

## Notifications and operational limits

- Each stored message gets a durable notice row atomically. Delivery is claimed once and dispatched with the Pages request's `waitUntil`; message storage succeeds even when notifications fail.
- Statuses distinguish `accepted`, `rejected`, `unconfirmed`, `not_configured`, `no_devices`, `failed`, `partial` and suppressed access. The UI says **Saved in Pep**, never “delivered” based on provider acceptance.
- Email goes only to the other participant, has no names/team/student/message excerpts, and links to the exact conversation after sign-in. No automatic email/SMS replies.
- Private push goes only to devices bound to the other participant's authenticated identity. It sends no content payload; click opens the inbox, not a particular conversation. A test notification is explicitly user-triggered. Expired subscriptions are removed from the correct table.
- Revocation before dispatch suppresses the notice. Already accepted provider notifications cannot be recalled, but opening a link rechecks current access.
- No scheduler/automatic retry worker is implemented. A runtime interruption after claiming leaves `processing`/unconfirmed status; provider timeouts are not retried blindly. Message history remains available. Operators must inspect stuck/failed notices before a wider rollout.
- The inbox lists up to 200 conversations; each history page holds 50 messages. No attachments, read receipts, automatic conversation retention/deletion, offline messaging, or real-time sockets. Original team-update quoting remains planned.
- Use personal browser profiles. Turn private push off before switching users on a shared device; notices are generic and the API still requires the recipient's session.

## School launch remains blocked

The new API has no school override. A future school launch requires a separate design and independent verification of school-controlled storage/keys, logging, retention/deletion, access, recovery and backups; no Pep owner/support master key, readable identifying logs or support exports. School policy approval alone is insufficient. This PR does not claim or retrofit that architecture.

## Validation

Run with Node 24:

```sh
node tests/private-messages.test.mjs
```

Covers recreation and travel parent/coach replies, selected assistant conversations, approved coach selector, family/team/organization isolation, admin/score-assistant exclusion, school/unknown/misclassified school denial, session expiry, guardian/coach/team revocation, organization remapping, write-time revocation race, same-origin requests, length/profanity validation, server sender attribution, idempotent retries, pagination, rate limits, identity-bound push subscription/test/expiry cleanup, recipient-specific emails, exact conversation links, provider rejection/timeout/missing configuration, and suppression after revocation. All external delivery is mocked; no real messages were sent.

The new test script and 14 of 15 existing scripts pass. `tests/family-calendar.mjs` fails its first `TEAM-D` fixture assertion (400 versus expected 200); reproduced on unchanged main at `0a64ba4`. That obsolete fixture failure is not caused by this branch. Changed JavaScript passes syntax checks and `git diff --check` is clean. Browser layout/interaction, deployed D1 behavior and actual provider delivery still require preview checks above.
