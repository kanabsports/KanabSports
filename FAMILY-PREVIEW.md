# Family preview contract

Entry: `/dev-head-coach`, Parent Portal tab. This is a device-local prototype with fictional children and contacts; it does not authenticate parents or grant team memberships.

Transport: parent opts in per event. Drop-off and pickup are separate assignments for each participating child. Reusable driver names record a plan, not delivery of an invitation or driver acceptance. No notification is sent.

Event visibility: deleting from Parent Portal hides only that family's event copy, across its filters. It does not cancel the team event, affect other families, or change coaches' schedules. Recoverable entries remain in Parent trash for 48 hours. After expiry, their saved snapshot is removed but a minimal suppression ID must remain so shared source events do not reappear. Source IDs survive event edits. This browser prototype cleans up on render/open; it is not a backend deletion scheduler.

Enrollment: withdrawing a child from one team must not withdraw siblings or other memberships. Withdraw-all requires two explicit confirmations listing scope. No real coach notices, roster changes or reminders are sent by this preview.

Production requirements before launch: every mutation/restore must authorize the verified parent and tenant server-side, use durable event IDs and audit records, preserve the distinction between family hides and team cancellation, broadcast updates to that account's devices, and enforce trash expiry on the server. Coach removal does not itself revoke separately approved parent memberships. Device-local storage is not authorization.
