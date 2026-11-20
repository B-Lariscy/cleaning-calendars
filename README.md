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
- Season's bill = $70 × completed cleanings (checkout day ≤ today ET) since tracking started / not yet paid, minus crossed-off and skipped ones, plus unskipped extras.
- Madison's bill uses per-unit rates (Jackson $90, Limestones/Beacons $100, Keepers $175) for the same checkout-day cleanings, shown with the unit and amount on each line.
- Shared state: `state/<page>.json` on the **state** branch of this repo (the build never touches it; pushes there don't trigger deploys). The cleaner can read it.
- Guest refunds: `refunds/<page>.json` in the PRIVATE repo `B-Lariscy/cleaning-calendars-private`, only read with the owner token.
- Owner mode: tap "Owner" at the bottom of the page and paste a fine-grained GitHub token with Contents: Read and write on both repos. It is stored only in that browser.
- The build keeps an append-only log of completed cleanings (`completed` in data.json) so the bill survives feeds dropping old stays.

## Skipped / no clean

Each unpaid cleaning on the bill (including extras) has a **Skipped / no clean** toggle in owner mode. Use it when a guest no-shows without a cancellation, or any other time a checkout is on the calendar but no clean was done.

- Tapping it removes that cleaning from the amount owed. It stays visible, greyed out, and labeled **Skipped**, with an **Undo** button. The cleaner can see the skipped row; only owner mode can toggle it (same token and save path as **Mark paid** and cross-offs).
- Skipped cleanings are never counted as paid or owed. They are not included when **Mark paid** clears the current bill (the bill still resets to $0 for everything that was actually owed). They must not be written into `payments[]` or `history[]`, so they never appear in By payment or By unit totals.
- Stored in public state on the **state** branch, in the same `state/<page>.json` file as `payments`, `crossoffs`, and `extras`:

```json
"skipped": {
  "camp-up|2026-11-12": { "at": "2026-11-20" },
  "extra-camp-up-2026-11-10": { "at": "2026-11-20" }
}
```

Keys are the bill's cleaning ids: `unit|checkout-date` for a calendar cleaning, or the extra's `id`. `at` is the date the skip was recorded (America/New_York). No notes, guest names, transaction IDs, or other private fields. Omitting `skipped` or leaving it `{}` means nothing is skipped. Undo deletes that key.

## Payment history (ledger)

The Payment history dropdown on each cleaner site lists every recorded payment (2026 onward), a running dollar total, a payment count, a per-unit breakdown, and a **By payment** breakdown. **This ledger does not change the current amount owed.** Only `payments` (written by **Mark paid**) clears cleanings on the current bill. Historical 2026 payouts live in `history` and are all dated before tracking started (Season Nov 11, Madison Nov 12).

By payment (newest first) shows the date paid, amount, and method on each row. Expanding a payment lists every mapped cleaning: listing, cleaning date, and rate. The subtotal of those listed cleanings is shown next to the payment amount and is flagged when the two do not match — never invent or adjust figures to force a match. Payments with no mapped cleanings say so plainly, except a payment under $70 with no mapped cleanings is classified as **Supplies / other** and is not flagged as unmapped or a mismatch. When a unit is known but individual dates were not recorded, the row says the dates are missing.

### Public vs private data
- Public (`state/<page>.json` → `history[]` on the **state** branch): `id`, `date`, `amount`, `method`, `items`, and optional `mismatch`. `items[]` may also include `dates` and per-cleaning `cleanings`. No raw notes, transaction IDs, or email IDs.
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
    { "unit": "jackson428-1", "count": 2, "amount": 180, "dates": ["2026-10-15", "2026-10-18"],
      "cleanings": [{ "date": "2026-10-15", "amount": 90 }, { "date": "2026-10-18", "amount": 90 }] },
    { "unit": "marble-keepers", "count": 1, "amount": 175, "dates": ["2026-10-18"],
      "cleanings": [{ "date": "2026-10-18", "amount": 175 }] },
    { "unit": "other", "count": 0, "amount": 20, "detail": "laundry soap + batteries" }
  ]
}
```

Unit ids: Season `camp-up`, `camp-down`, `camp-whole`, `hayes`. Madison `jackson428-1`, `jackson428-2`, `jackson432`, `marble-keepers`, `marble-beacons`, `marble-limestones`. Plus `jackson-unspecified` (Jackson with no floor), `unspecified` (unit not clear — do not guess), and `other` (shown as **Supplies / other**: supplies, snow removal, adjustments, other properties). `items[].amount` values must sum to `amount`. Optional `mismatch: true` marks a payment whose note could not be fully allocated (the leftover is in `other`). A payment with no mapped cleanings and an amount under $70 is always `other` (Supplies / other), never `unspecified` and never `mismatch`. Use a short public `detail` when it is known (for example supplies); if there is no note, omit `detail`. Do not apply this to payments of $70 or more, or to payments that already have cleanings mapped to them.

Optional `items[].dates` (YYYY-MM-DD, checkout/cleaning day) and `items[].cleanings` (`date`, `amount`, optional `detail`) list the individual cleanings behind that unit bucket. Include them whenever the dates are known. If they are not known, omit them — do not guess dates or change `unit` / `count` / `amount` to force a match. Use `cleanings` when amounts differ across dates (for example $75 and $90) or a row needs a short public `detail` such as `First St`. Never copy raw payment notes or transaction IDs into these fields.

### Gmail-sync / Mark paid
- **Mark paid** already appends to both `payments` (clears the current bill) and `history` (same `id`, `method: "Marked paid"`). Units and cleaning dates come from the cleanings it clears (`items[].dates` / `items[].cleanings` use the checkout day); if there are none, the amount goes to `unspecified`. A leftover vs the listed cleanings goes to `other`. It covers only unpaid, unskipped cleanings and unskipped extras. Skipped entries stay in `skipped` and are not marked paid.
- A **Gmail-sync** routine that records a payment already sent should:
  1. Hash the transaction ID (`SHA-256` hex) and skip if that `id` already exists in `history`.
  2. Append the public object (fields above, including `dates` / `cleanings` on each item when the note lists them) to `history` in `state/<page>.json` on the **state** branch. Do **not** append to `payments` unless you also intend to clear the current bill (then use the same shape as Mark paid: `cleanings` as unit|date ids, `extras`, `recordedAt`, shared `id`). If individual cleaning dates cannot be read from the note, omit `dates` / `items[].cleanings` rather than guessing. If the payment has no mapped cleanings and is under $70, record it as `{ "unit": "other", "count": 0, "amount": <payment> }` (Supplies / other), with a short public `detail` only when known; do not leave it unmapped and do not set `mismatch`. Leave payments of $70 or more, and payments that have any mapped cleanings, under the usual rules. New `history` rows show up automatically in both the By unit and By payment views.
  3. When a payment also clears the current bill (the auto-reset case), include only unpaid, unskipped cleanings and unskipped extras in `payments[].cleanings`, `payments[].extras`, and `history[].items`. Leave `skipped` in place — do not delete those keys and do not treat skipped cleanings as paid or owed. If a payment note lists a date that is currently skipped, do not map that cleaning into the payment; leave it skipped. Skipped cleanings must never appear in By payment or By unit totals.
  4. Append the full record (including `transactionId`, `messageId`, `note`, and the same public `items`) to `payments/<page>.json` in the private repo.
