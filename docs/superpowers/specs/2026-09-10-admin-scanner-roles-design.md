# Admin/Scanner Roles

## Context

Follows [2026-09-10-admin-action-buttons-design.md](2026-09-10-admin-action-buttons-design.md). That spec's "Assessment" section flagged three open questions about splitting admins into tiers and deferred building it until the user answered them. The user has now answered all three, confirmed through two rounds of back-and-forth in conversation (not written Q&A, since the user was directing this live):

1. Scanning tickets at the door — scanner tier, yes.
2. Confirming/rejecting payment receipts (`confirm_`/`reject_` actions) — **no**, full-admin only (this was the one point that needed correcting from the assessment's original guess — the user's phrasing "сканують і підтверджують квитки" turned out to mean "scan, which is itself how a ticket gets confirmed at the door," not "approve payment receipts").
3. `/stats`, `/performer_open`/`close`, `/addadmin`/`removeadmin` — full-admin only, confirmed.

One more decision came up mid-design: whether the scanner tier should be enforced server-side (the `SCAN:` webapp-data handler currently has no permission check at all — the scanner URL is just hidden from non-staff in the keyboard) or stay a purely visual restriction. **The user explicitly chose to keep it visual-only** — flagged as a pre-existing gap, decision was to leave it as-is, not fix it as part of this feature.

## Goal

Two roles instead of one:

- **Головний адмін** ("full admin") — exactly what `admins.json`-gated users can do today: `/stats`, `/addadmin`, `/removeadmin`, `/performer_open`, `/performer_close`, all 5 admin buttons, confirming/rejecting payment receipts, **plus** scanning. A strict superset of the scanner role — nothing is taken away from existing admins.
- **Сканер** ("scanner") — sees only the "📷 Сканер квитків" button in `/start`'s keyboard, on top of the regular buyer's "Купити квиток". No stats, no admin management, no payment confirmation.

## Non-goals

- No server-side enforcement on the `SCAN:` handler — explicit user call, stays as a visual-only gate (button hidden from non-staff, but nothing stops a crafted request). Out of scope, not a silent oversight.
- No changes to how full admins work today — `admins.json`, `isAdmin(...)`, and every existing full-admin-gated command/button stay exactly as they are.
- No "promote scanner to full admin" command — an existing full admin can just also run `/addadmin <id>` on a scanner's ID to grant them full tier; no new plumbing needed for that.

## Design

### Storage: a second, independent list

A new `scanners.json`, following the exact same `loadDB`/`saveDB` shape every other store in `bot.js` already uses (prefer `/data/<file>`, fall back to a local file). Unlike `admins.json`, there's no default-seed seed seed list and no "can't remove the last one" protection — an empty scanner list is a perfectly normal state (nobody's locked out of anything essential if there are zero scanners; only door-scanning is unavailable until someone's added).

`loadScannersDB()` gets the same corrupt-file resilience `loadAdminsDB()` was given in the prior plan's final-review fix round (parse error or non-array → fall back to `[]` in memory, don't touch the file) — applying that lesson up front here instead of reintroducing the same class of bug in a new file.

### New commands (full-admin only)

- `/addscanner <telegram_id>` — adds to `scanners.json`. Reuses `logic.js`'s existing `addAdminId` (its behavior — dedupe-or-add — is generic, nothing admin-specific about it despite the name).
- `/removescanner <telegram_id>` — removes from `scanners.json`. **Cannot** reuse `removeAdminId` as-is: that function's last-entry protection is exactly the thing scanners must NOT have. A new pure function `removeScannerId(scannerIds, idStr)` in `logic.js` handles removal without that guard — structurally the same shape (`{ scannerIds, removed, reason }`) minus the `'last_admin'` case.

### Keyboard change

`bot.start` currently gates the scanner button and all 5 admin buttons on one check, `userIsAdmin`. It becomes two independent checks:

```
userIsAdmin || userIsScanner  → show the scanner button
userIsAdmin (alone)           → show the 5 admin-action buttons
```

A full admin who is not separately listed in `scanners.json` still sees the scanner button (via `userIsAdmin`), matching "full admin is a superset."

### Everything else unchanged

`confirm_`/`reject_` actions, `/stats`, `/addadmin`, `/removeadmin`, `/performer_open`/`close`, the 5 existing admin buttons, and the buyer-facing purchase flow all keep checking `isAdmin(...)` exactly as before — none of them change to accept scanners.

## Testing

`removeScannerId` is new pure logic, needs unit tests in `test/logic.test.js` (following the existing `removeAdminId` tests as a template, but asserting the last-entry case succeeds instead of being refused). Everything else is `bot.js` wiring reusing already-tested functions, verified the same way the prior two plans verified their `bot.js` changes: `node --check`, then a live Telegram smoke test.
