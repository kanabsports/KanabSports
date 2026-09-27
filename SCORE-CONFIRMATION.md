# Score confirmation providers

Kanab Sports owns the primary score record. External sources are confirmation providers, not the source of truth.

## UHSAA provider

`/api/score-confirmation` can compare a locally reported final score with UHSAA's public scoreboard.

The provider is **disabled by default**. It returns `disabled_pending_permission` unless the Cloudflare environment variable `UHSAA_CONFIRMATION_ENABLED` is set to `true`.

Do not enable that flag until UHSAA/MaxPreps confirms an approved data feed or explicitly permits the cached public-scoreboard check.

Supported mappings currently verified against UHSAA's scoreboard URLs:

- Football
- Girls Soccer
- Girls Volleyball
- Boys Basketball
- Girls Basketball

Example request:

`/api/score-confirmation?date=2026-09-25&sport=Football&team=Kanab&opponent=Parowan&teamScore=49&opponentScore=0`

Possible statuses:

- `disabled_pending_permission` — default; no external request is made
- `confirmed` — teams and final score match UHSAA
- `mismatch` — teams match but the final score differs
- `not_found` — no matching game row was found
- `provider_error` — UHSAA could not be checked

When enabled, upstream requests are configured for a one-hour Cloudflare cache to match UHSAA's stated hourly update cadence and minimize requests.
