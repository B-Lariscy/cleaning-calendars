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
- Madison's bill uses per-unit rates (Jackson $90, Limestones/Beacons $100, Keepers $175) for the same checkout-day cleanings, shown with the unit and amount on each line.
- Shared state: `state/<page>.json` on the **state** branch of this repo (the build never touches it; pushes there don't trigger deploys). The cleaner can read it.
- Guest refunds: `refunds/<page>.json` in the PRIVATE repo `B-Lariscy/cleaning-calendars-private`, only read with the owner token.
- Owner mode: tap "Owner" at the bottom of the page and paste a fine-grained GitHub token with Contents: Read and write on both repos. It is stored only in that browser.
- The build keeps an append-only log of completed cleanings (`completed` in data.json) so the bill survives feeds dropping old stays.

## Payment history (ledger)

The Payment history dropdown on each cleaner site lists every recorded payment (2026 onward), a running dollar total, a payment count, and a per-unit breakdown. **This ledger does not change the current amount owed.** Only `payments` (written by **Mark paid**) clears cleanings on the current bill. Historical 2026 payouts live in `history` and are all dated before tracking started (Season Nov 11, Madison Nov 12).

### Public vs private data
- Public (`state/<page>.json` → `history[]` on the **state** branch): `id`, `date`, `amount`, `method`, `items`, and optional `mismatch`. No raw notes, transaction IDs, or email IDs.
- `id` is a SHA-256 hex digest of the payment's transaction ID (dedupe key). For a Mark paid entry, `id` is a random id shared with the `payments[]` row.
- Private (`payments/<page>.json` in `B-Lariscy/cleaning-calendars-private`): the same fields plus `transactionId`, `messageId`, and the original `note`.

### `items[]` on each payment
Each item is one unit bucket (or Other / Unspecified):

```json
{
  "id": "<sha256 of transactionId, or mark-paid id>",
  "date": "2026-10-22",
  "amount": 375,
  "method": "Venmo",
  "items": [
    { "unit": "jackson-unspecified", "count": 2, "amount": 180 },
    { "unit": "marble-keepers", "count": 1, "amount": 175 },
    { "unit": "other", "count": 0, "amount": 20, "detail": "laundry soap + batteries" }
  ]
}
```

Unit ids: Season `camp-up`, `camp-down`, `camp-whole`, `hayes`. Madison `jackson428-1`, `jackson428-2`, `jackson432`, `marble-keepers`, `marble-beacons`, `marble-limestones`. Plus `jackson-unspecified` (Jackson with no floor), `unspecified` (unit not clear — do not guess), and `other` (supplies, snow removal, adjustments, other properties). `items[].amount` values must sum to `amount`. Optional `mismatch: true` marks a payment whose note could not be fully allocated (the leftover is in `other`).

### Gmail-sync / Mark paid
- **Mark paid** already appends to both `payments` (clears the current bill) and `history` (same `id`, `method: "Marked paid"`). Units come from the cleanings it clears; if there are none, the amount goes to `unspecified`. A leftover vs the listed cleanings goes to `other`.
- A **Gmail-sync** routine that records a payment already sent should:
  1. Hash the transaction ID (`SHA-256` hex) and skip if that `id` already exists in `history`.
  2. Append the public object (fields above) to `history` in `state/<page>.json` on the **state** branch. Do **not** append to `payments` unless you also intend to clear the current bill (then use the same shape as Mark paid: `cleanings`, `extras`, `recordedAt`, shared `id`).
  3. Append the full record (including `transactionId`, `messageId`, `note`) to `payments/<page>.json` in the private repo.
