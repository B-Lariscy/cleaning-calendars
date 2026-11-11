# Cleaning calendars

Self-updating cleaning schedules for cleaners, built from Airbnb/Vrbo iCal feeds by GitHub Actions (every ~30 min) and published on GitHub Pages.

- Pages: `/season/` and `/madison/`
- Unit/property setup: `config/units.json` (no secrets in it)
- Feed links are stored ONLY as GitHub Actions secrets (names in `config/units.json` → `feeds[].secret`). A feed with no secret is skipped.
- Only unit, check-in date, checkout date and source (Airbnb / Vrbo / Blocked) are published. `scripts/check-output.sh` fails the build if anything else leaks.
- If a feed fails, the previous good data for that feed is kept.

## Add a missing calendar
1. Copy the listing's iCal export link (Airbnb: Calendar → Availability → Connect calendars → Export).
2. `gh secret set FEED_CAMP_UP_AIRBNB -R B-Lariscy/cleaning-calendars` and paste the link (or Settings → Secrets and variables → Actions → New secret).
3. Actions → "Update cleaning calendars" → Run workflow (or wait ~30 min).

New unit? Add it to `units` and add one line to `feeds` in `config/units.json`.
