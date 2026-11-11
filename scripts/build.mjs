// Builds the cleaner sites. No dependencies (Node 20+).
// Secrets: env FEED_SECRETS_JSON = JSON object {SECRET_NAME: "https://...ics"} (in CI: toJSON(secrets)).
// Previous deploy: env PREV_BASE_URL (e.g. https://user.github.io/repo/) used to keep last-good data when a feed fails.
// Local testing: env LOCAL_FEEDS_DIR=/tmp/feeds with files <feed-id>.ics instead of fetching.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/units.json'), 'utf8'));
const OUT = path.join(ROOT, 'dist');
const SITE = path.join(ROOT, 'site');
const LONG_BLOCK_NIGHTS = 14;   // blocked ranges longer than this = "closed", not a guest stay
const KEEP_PAST_DAYS = 45, KEEP_FUTURE_DAYS = 400;

let secrets = {};
try { secrets = JSON.parse(process.env.FEED_SECRETS_JSON || '{}') || {}; } catch { secrets = {}; }
const nowIso = new Date().toISOString();
const todayNY = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone }).format(new Date());

const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const nights = (s, e) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5);
const unitById = Object.fromEntries(cfg.units.map(u => [u.id, u]));

function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const evs = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':'); if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase(); const val = line.slice(i + 1);
      if (key === 'DTSTART' || key === 'DTEND') { const m = val.match(/^(\d{4})(\d{2})(\d{2})/); if (m) cur[key] = `${m[1]}-${m[2]}-${m[3]}`; }
      else if (key === 'SUMMARY') cur.SUMMARY = val.trim();
      else if (key === 'STATUS') cur.STATUS = val.trim();
    }
  }
  return evs;
}

// Sanitize: ONLY dates + kind survive. Descriptions, UIDs, names, URLs, phone digits are dropped here.
function sanitize(evs, feed) {
  const out = [];
  for (const e of evs) {
    if (!e.DTSTART) continue;
    if ((e.STATUS || '').toUpperCase() === 'CANCELLED') continue;
    const start = e.DTSTART, end = e.DTEND && e.DTEND > start ? e.DTEND : addDays(start, 1);
    if (end < addDays(todayNY, -KEEP_PAST_DAYS) || start > addDays(todayNY, KEEP_FUTURE_DAYS)) continue;
    const s = (e.SUMMARY || '').toLowerCase();
    const blocked = s.includes('not available') || s.startsWith('blocked') || s.includes('unavailable');
    out.push({ start, end, kind: blocked ? 'blocked' : 'reserved', source: feed.source });
  }
  return out;
}

async function fetchFeed(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept': 'text/calendar,*/*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if (!txt.includes('BEGIN:VCALENDAR')) throw new Error('not an iCal file');
    return txt;
  } finally { clearTimeout(t); }
}

async function loadPrev(cleanerId) {
  const base = process.env.PREV_BASE_URL;
  if (!base) return null;
  try {
    const r = await fetch(new URL(`${cleanerId}/cache.json`, base.endsWith('/') ? base : base + '/'), { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return null; return await r.json();
  } catch { return null; }
}

const related = (a, b) => a.id === b.id || (a.property === b.property && !a.separate && !b.separate && (a.whole || b.whole));

function merge(events) {
  // events: {unit, start, end, kind, source}
  const res = events.filter(e => e.kind === 'reserved');
  // drop exact duplicate reservations (same unit+dates from two feeds), prefer Vrbo/Airbnb order as given
  const seen = new Set(); const reserved = [];
  for (const e of res) { const k = `${e.unit}|${e.start}|${e.end}`; if (!seen.has(k)) { seen.add(k); reserved.push(e); } }
  const out = reserved.map(e => ({ ...e, type: 'stay' }));
  const blockedSeen = new Set();
  for (const b of events.filter(e => e.kind === 'blocked')) {
    const bu = unitById[b.unit];
    const n = nights(b.start, b.end);
    if (n > LONG_BLOCK_NIGHTS) { out.push({ unit: b.unit, start: b.start, end: b.end, source: 'Blocked', type: 'closed' }); continue; }
    // Hide if this block just mirrors real reservations on this unit or a linked unit (whole house <-> floors, imported Vrbo).
    const rel = reserved.filter(r => related(bu, unitById[r.unit]) && r.start < b.end && r.end > b.start);
    let covered = false;
    if (rel.length) {
      // nights of the block not covered by related reservations
      let unc = [];
      for (let d = b.start; d < b.end; d = addDays(d, 1)) if (!rel.some(r => r.start <= d && d < r.end)) unc.push(d);
      // tolerate a single prep/buffer night at either edge
      covered = unc.length === 0 || (unc.length === 1 && (unc[0] === b.start || unc[0] === addDays(b.end, -1)) && n > 1);
    }
    if (covered) continue;
    const k = `${b.unit}|${b.start}|${b.end}`; if (blockedSeen.has(k)) continue; blockedSeen.add(k);
    out.push({ unit: b.unit, start: b.start, end: b.end, source: 'Blocked', type: 'stay' });
  }
  // A floor "Blocked" range identical to a block on the whole house (or vice versa) for an unknown booking: keep only the whole-house one
  const final = out.filter(e => {
    if (e.source !== 'Blocked' || e.type !== 'stay') return true;
    const u = unitById[e.unit]; if (u.whole) return true;
    return !out.some(o => o !== e && o.source === 'Blocked' && o.type === 'stay' && o.start === e.start && o.end === e.end && unitById[o.unit].whole && related(u, unitById[o.unit]));
  });
  return final.sort((a, b) => a.start.localeCompare(b.start) || a.unit.localeCompare(b.unit));
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    if (f.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(SITE, 'root.html'), path.join(OUT, 'index.html'));
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  let problems = 0;
  for (const cl of cfg.cleaners) {
    const prev = await loadPrev(cl.id);
    const props = cfg.properties.filter(p => cl.properties.includes(p.id));
    const feeds = cfg.feeds.filter(f => cl.properties.includes(unitById[f.unit].property));
    const cache = { generatedAt: nowIso, feeds: {} };
    const status = [];
    for (const f of feeds) {
      const url = (secrets[f.secret] || '').trim();
      const local = process.env.LOCAL_FEEDS_DIR && path.join(process.env.LOCAL_FEEDS_DIR, f.id + '.ics');
      if (!url && !(local && fs.existsSync(local))) continue; // not configured yet -> skip silently
      try {
        const txt = local && fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : await fetchFeed(url);
        cache.feeds[f.id] = { unit: f.unit, lastOk: nowIso, events: sanitize(parseIcs(txt), f) };
        status.push({ id: f.id, ok: true, lastOk: nowIso });
        console.log(`[ok]   ${cl.id}/${f.id}: ${cache.feeds[f.id].events.length} events`);
      } catch (err) {
        problems++;
        const p = prev && prev.feeds && prev.feeds[f.id];
        if (p) cache.feeds[f.id] = p;
        status.push({ id: f.id, ok: false, lastOk: p ? p.lastOk : null });
        console.log(`[FAIL] ${cl.id}/${f.id}: ${String(err.message).replace(/https?:\S+/g, '<url>')} — ${p ? 'kept previous data' : 'no previous data'}`);
      }
    }
    const events = Object.values(cache.feeds).flatMap(c => c.events.map(e => ({ ...e, unit: c.unit })));
    const activeUnits = new Set(Object.values(cache.feeds).map(c => c.unit));
    const data = {
      generatedAt: nowIso,
      title: cl.title, cleaner: cl.short, timezone: cfg.timezone,
      properties: props.map(p => ({ id: p.id, name: p.name, units: cfg.units.filter(u => u.property === p.id && activeUnits.has(u.id)).map(u => ({ id: u.id, name: u.name, short: u.short, color: u.color, whole: !!u.whole, separate: !!u.separate })) })).filter(p => p.units.length),
      feeds: status.map(s => ({ ok: s.ok, lastOk: s.lastOk })),
      stays: merge(events).map(e => ({ unit: e.unit, start: e.start, end: e.end, source: e.source, type: e.type }))
    };
    const dir = path.join(OUT, cl.id);
    copyDir(path.join(SITE, 'app'), dir);
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replaceAll('__TITLE__', cl.title).replaceAll('__SHORT__', cl.short)
      .replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
    mf.name = cl.title; mf.short_name = `${cl.short}'s Cleanings`;
    fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify(mf, null, 1));
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data));
    fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify(cache));
    fs.writeFileSync(path.join(dir, 'sw.js'), fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').replace('__VERSION__', nowIso));
  }
  console.log(problems ? `Done with ${problems} feed problem(s).` : 'Done, all feeds OK.');
}
main().catch(e => { console.error(String(e && e.message || e).replace(/https?:\S+/g, '<url>')); process.exit(1); });
