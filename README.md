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

All planned feeds are already listed in `config/units.json` and in the workflow's `env:` block, so for those only step 2 is needed.
A brand-new listing: add the unit to `units`, one line to `feeds` in `config/units.json`, and one `NAME: ${{ secrets.NAME }}` line in `.github/workflows/deploy.yml`.

## Pay tracker, cross-offs, refunds (owner mode)
- Season's bill = $70 × completed cleanings (checkout day ≤ today ET) since tracking started / not yet paid, minus crossed-off ones, plus extras.
- Shared state: `state/<page>.json` on the **state** branch of this repo (the build never touches it; pushes there don't trigger deploys). Season can read it.
- Guest refunds: `refunds/<page>.json` in the PRIVATE repo `B-Lariscy/cleaning-calendars-private`, only read with the owner token.
- Owner mode: tap "Owner" at the bottom of the page and paste a fine-grained GitHub token with Contents: Read and write on both repos. It is stored only in that browser.
- The build keeps an append-only log of completed cleanings (`completed` in data.json) so the bill survives feeds dropping old stays.
