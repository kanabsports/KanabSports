# Kanab Sports design migration status

Updated September 14, 2026. This is a dev-only navigation preview, not a replacement production application.

## What this preview contains

- Existing “Your Home for Kanab Sports” hero; presenting and supporting sponsor spaces.
- High-school sport menu, recorded football result, dated TeamHive links and provider-controlled playback.
- Six recreation programs using the current shared Rec1 catalog URL.
- Community places and groups, Dark Sky RV sponsorship link, visitor event link.
- Messages hub linking to existing general-contact, event and correction forms.
- Coaches hub linking to existing registration, account/password, score/team submissions and PDF uploads.
- Store and admin links; search and section navigation.

## Existing systems retained

All account, administration, PDF, registration, approval, message and payment actions open their existing HTTPS production destination in a separate tab. This preview has no replacement database, credentials, forms or write APIs. Public navigation does not expose the private contributor portal. Existing contributor, email, session and review systems remain on the current site.

## Do not merge this branch wholesale into production

The preview branch predates the current production backend. Its root homepage is also older. Start a production integration from the latest production source and apply the approved design additively, retaining every existing route, function, binding and secret. Keep the custom domain and current data resources. Do not replace production with the preview branch.

The live homepage includes runtime changes beyond origin/main:index.html (rec program cards, score celebrations and other scripts). Capture and reconcile the production middleware and published content before changing the root homepage.

## Remaining work before a full design cutover

- Reconnect live approved team data, score feeds, schedules, event feeds and newest-game selection to the redesigned cards. Current cards are a dated prototype, not auto-updating.
- Preserve current win celebrations and ticker behavior, plus all existing community/travel/private-team entries.
- Preserve dynamic recreation calendar URLs (calendar.html requires its existing slug), uploaded documents and contributor publishing.
- Retain source links, social metadata, branding assets, robots/privacy headers, anti-spam checks and admin/coach session behavior.
- Confirm store availability; existing https://betterouteast.com/kanab returned HTTP 502 in the first check.
- Confirm program-specific recreation links with Sterling; existing Rec1 catalog link remains in place.
- Final browser/mobile QA and signed-in checks of existing workflows are not completed by static dev validation.
- Do not trigger test emails, approval actions, uploads or purchases as part of navigation checks.
- Switch production only after these integration checks; keep an exact rollback version.

## Validation performed

Syntax and route-rendering checks; all six redesigned sections switch independently; coach search returns existing destinations; existing form URLs and external links preserved. No production mutations were made.
