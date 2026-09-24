# Homecoming celebration staging

Public preview: /homecoming. No fabricated final score or sponsor promotion.

Friday September 25, 2026: Varsity football, Parowan @ Kanab, home, Homecoming, 7 PM.

Homepage launch is intentionally NOT enabled. Await owner approval of the preview. Then connect the approved celebration to the homepage and a verified final for this exact varsity game. The existing /api/scores response does not consistently identify varsity vs JV, so do not use an unqualified team-name match to announce a win.

Prepared configuration and pure eligibility gate are in assets/homecoming-2026.json and assets/homecoming-gate.mjs. Record a verified final with gameId, date, level, opponent, status FINAL, teamScore and opponentScore. Do not reuse Beaver's earlier result.

After approval and a confirmed win, show on EVERY homepage load/refresh, regardless of previous dismissal. Allow closing for the current visit. Expire exclusively at 2026-09-28T10:00:00-06:00 (Monday 10 AM America/Denver, 16:00 UTC). Recheck expiry on visibility changes and close an open celebration at the cutoff. Never use local/session storage to suppress repeat visits. /homecoming remains a clearly labeled replayable design preview.
