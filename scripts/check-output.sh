#!/usr/bin/env bash
# Fails the build if anything private slipped into the published site.
set -u
dir="${1:-dist}"
bad=0
if grep -rIl -i -E 'phone|airbnb\.com/(hosting|calendar)|vrbo\.com/icalendar|reservation url|DESCRIPTION:|@airbnb\.com|HM[A-Z0-9]{8}|\.ics\?' "$dir"; then
  echo "Private-looking text found in output (files listed above)"; bad=1
fi
# no ICS-style UIDs or raw names from Vrbo summaries
if grep -rIl -E 'Reserved - |UID:' "$dir"; then echo "Raw iCal fields found"; bad=1; fi
# data files may only contain these keys
for f in $(find "$dir" -name 'data.json' -o -name 'cache.json'); do
  if grep -o -E '"[A-Za-z_]+":' "$f" | sort -u | grep -v -E '^"(generatedAt|title|cleaner|timezone|properties|id|name|units|short|color|whole|separate|feeds|ok|lastOk|stays|unit|start|end|source|type|events|kind)":$'; then
    echo "Unexpected key in $f"; bad=1
  fi
done
[ $bad -eq 0 ] && echo "Output safety check passed."
exit $bad
