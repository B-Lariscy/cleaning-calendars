(function () {
  'use strict';
  var TZ = 'America/New_York', HORIZON = 60, STALE_MS = 3 * 3600 * 1000;
  var data = window.__DATA__, units = {}, filter = 'all', months = {}, selected = {}, showAll = false, MAXCARDS = 6;
  try { filter = localStorage.getItem('filter') || 'all'; } catch (e) {}

  function todayNY() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
  function addDays(d, n) { var t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function fmt(d, opts) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts)); }
  function nice(d) { return fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function related(a, b) { return a.id === b.id || (a.prop === b.prop && !a.separate && !b.separate && (a.whole || b.whole)); }
  function el(id) { return document.getElementById(id); }

  function index() {
    units = {};
    data.properties.forEach(function (p) { p.units.forEach(function (u) { u.prop = p.id; u.propName = p.name; units[u.id] = u; }); });
    if (filter !== 'all' && !data.properties.some(function (p) { return p.id === filter; })) filter = 'all';
  }
  function visible(unitId) { var u = units[unitId]; return u && (filter === 'all' || u.prop === filter); }
  function stays() { return data.stays.filter(function (s) { return units[s.unit]; }); }

  function renderHeader() {
    var g = new Date(data.generatedAt);
    el('updated').textContent = 'Last updated ' + g.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
    var now = Date.now(), msgs = [];
    if (now - g.getTime() > STALE_MS) msgs.push('⚠️ This schedule hasn\'t updated in over 3 hours. Bookings may have changed — check with Branson if unsure.');
    else if ((data.feeds || []).some(function (f) { return !f.ok && (!f.lastOk || now - Date.parse(f.lastOk) > STALE_MS); }))
      msgs.push('⚠️ One calendar couldn\'t refresh for over 3 hours. Showing the last known bookings.');
    el('warn').hidden = !msgs.length; el('warn').textContent = msgs.join(' ');
  }

  function renderFilters() {
    var f = el('filters');
    if (data.properties.length < 2) { f.hidden = true; return; }
    var opts = [{ id: 'all', name: 'All' }].concat(data.properties);
    f.innerHTML = opts.map(function (o) { return '<button data-f="' + esc(o.id) + '" class="' + (o.id === filter ? 'on' : '') + '">' + esc(o.name) + '</button>'; }).join('');
    f.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; filter = b.getAttribute('data-f'); try { localStorage.setItem('filter', filter); } catch (x) {} render(); };
  }

  function nextArrival(s, all) {
    var u = units[s.unit], best = null;
    all.forEach(function (o) {
      if (o === s || o.type !== 'stay' || o.start < s.end) return;
      if (!related(u, units[o.unit])) return;
      if (!best || o.start < best.start) best = o;
    });
    return best;
  }

  function renderList() {
    var today = todayNY(), end = addDays(today, HORIZON), all = stays();
    var items = all.filter(function (s) { return s.type === 'stay' && s.end >= today && s.end <= end && visible(s.unit); })
      .sort(function (a, b) { return a.end.localeCompare(b.end) || units[a.unit].propName.localeCompare(units[b.unit].propName); });
    var groups = [['Today', []], ['Tomorrow', []], ['This week', []], ['Later', []]];
    items.forEach(function (s) {
      var g = s.end === today ? 0 : s.end === addDays(today, 1) ? 1 : s.end <= addDays(today, 6) ? 2 : 3;
      groups[g][1].push(s);
    });
    var html = '', shown = 0;
    groups.forEach(function (g) {
      var list = g[1].filter(function (s, i) { return showAll || g[0] === 'Today' || g[0] === 'Tomorrow' || shown + i < MAXCARDS; });
      if (!list.length) return;
      html += '<div class="grp">' + g[0] + '</div>';
      shown += list.length;
      list.forEach(function (s) {
        var u = units[s.unit], n = nextArrival(s, all), nx;
        if (n && n.start === s.end) nx = '<span class="sameday">SAME-DAY TURNOVER – guests arrive today</span>';
        else if (n) nx = '<div class="next">Next guests arrive: <b>' + nice(n.start) + '</b>' + (n.unit !== s.unit ? ' (' + esc(units[n.unit].short) + ')' : '') + '</div>';
        else nx = '<div class="next">Next guests arrive: <b>none booked yet</b></div>';
        html += '<div class="card" style="border-left-color:' + u.color + '">' +
          '<div class="date">' + nice(s.end) + '</div>' +
          '<div class="where">' + esc(u.propName) + ' · ' + esc(u.short) + '</div>' +
          '<div class="meta"><span class="pill">🧹 Clean after checkout</span><span class="pill ' + s.source + '">' + s.source + '</span><span class="pill">' + fmt(s.start, { month: 'short', day: 'numeric' }) + ' – ' + fmt(s.end, { month: 'short', day: 'numeric' }) + '</span></div>' +
          nx +
          (s.source === 'Blocked' ? '<div class="note">Dates blocked on Airbnb (usually a booking from another listing/site). Confirm with Branson if unsure.</div>' : '') +
          '</div>';
      });
    });
    if (items.length > shown) html += '<button class="more" id="more">Show all ' + items.length + ' cleanings (next ' + HORIZON + ' days)</button>';
    else if (showAll && items.length > MAXCARDS) html += '<button class="more" id="more">Show fewer</button>';
    el('list').innerHTML = html || '<div class="empty">No cleanings in the next ' + HORIZON + ' days.</div>';
    var mb = el('more'); if (mb) mb.onclick = function () { showAll = !showAll; renderList(); };
  }

  function dayInfo(d, pu, all) {
    var out = { rows: [], brooms: [], turn: false, lines: [] };
    pu.forEach(function (u) {
      var L = null, R = null, Lc = false, Rc = false;
      all.forEach(function (s) {
        if (s.unit !== u.id) return;
        if (s.start < d && d <= s.end) { L = s; }
        if (s.start <= d && d < s.end) { R = s; }
      });
      Lc = L && L.type === 'closed'; Rc = R && R.type === 'closed';
      out.rows.push({ u: u, L: L, R: R, Lc: Lc, Rc: Rc, split: L && R && L !== R });
      all.forEach(function (s) {
        if (s.unit !== u.id) return;
        if (s.type === 'stay' && s.end === d) {
          out.brooms.push(u); out.lines.push('🧹 Checkout / clean: <b>' + esc(u.short) + '</b> (' + s.source + ')');
          if (all.some(function (o) { return o.type === 'stay' && o.start === d && related(u, units[o.unit]); })) out.turn = true;
        }
        if (s.type === 'stay' && s.start === d) out.lines.push('🔑 Guests arrive: <b>' + esc(u.short) + '</b> (' + s.source + ')');
        if (s.start < d && d < s.end) out.lines.push((s.type === 'closed' ? '⛔ Closed/blocked: ' : '🛏️ Occupied: ') + '<b>' + esc(u.short) + '</b>');
      });
    });
    return out;
  }

  function rowStyle(r) {
    var c = r.u.color, hatch = 'repeating-linear-gradient(45deg,#d1d5db 0 4px,#f3f4f6 4px 8px)';
    function seg(s, closed) { return s ? (closed ? null : c) : 'transparent'; }
    var l = seg(r.L, r.Lc), rr = seg(r.R, r.Rc);
    if ((r.Lc || !r.L) && (r.Rc || !r.R) && (r.Lc || r.Rc)) return 'background:' + hatch + (r.Lc && r.Rc ? '' : ';background-size:50% 100%;background-repeat:no-repeat;background-position:' + (r.Lc ? 'left' : 'right'));
    if (r.Lc) l = '#cbd5e1'; if (r.Rc) rr = '#cbd5e1';
    var gap = r.split ? 'transparent 46%,transparent 54%,' : '';
    var lr = r.L && !r.R ? ';border-radius:0 5px 5px 0' : (!r.L && r.R ? ';border-radius:5px 0 0 5px' : '');
    return 'background:linear-gradient(90deg,' + l + ' 0,' + l + ' ' + (r.split ? '46%' : '50%') + ',' + gap + rr + ' ' + (r.split ? '54%' : '50%') + ',' + rr + ' 100%)' + lr;
  }

  function renderCals() {
    var today = todayNY(), all = stays(), html = '';
    data.properties.forEach(function (p) {
      if (filter !== 'all' && filter !== p.id) return;
      var m = months[p.id] || today.slice(0, 7);
      months[p.id] = m;
      var first = m + '-01', dow = new Date(first + 'T12:00:00Z').getUTCDay(), start = addDays(first, -dow);
      var title = fmt(first, { month: 'long', year: 'numeric' });
      html += '<div class="cal" data-p="' + p.id + '"><div class="calhead"><button class="nav" data-nav="-1" aria-label="Previous month">‹</button><h3>' + esc(p.name) + '<small>' + title + '</small></h3><button class="nav" data-nav="1" aria-label="Next month">›</button></div>';
      if (m !== today.slice(0, 7)) html += '<div style="text-align:center"><button class="todaybtn" data-nav="0">Back to this month</button></div>';
      html += '<div class="legend">' + p.units.map(function (u) { return '<span><i class="sw" style="background:' + u.color + '"></i>' + esc(u.short) + '</span>'; }).join('') + '<span>🧹 cleaning</span><span><i class="sw closed"></i>closed</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px #dc2626"></i>same-day</span></div>';
      html += '<div class="grid">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x) { return '<div class="dow">' + x + '</div>'; }).join('');
      for (var i = 0; i < 42; i++) {
        var d = addDays(start, i);
        if (i === 35 && d.slice(0, 7) !== m) break;
        var info = dayInfo(d, p.units, all);
        var cls = 'day' + (d.slice(0, 7) !== m ? ' out' : '') + (d === today ? ' today' : '') + (info.turn ? ' turn' : '') + (selected[p.id] === d ? ' sel' : '');
        html += '<div class="' + cls + '" data-d="' + d + '"><div class="dn"><span>' + Number(d.slice(8)) + '</span>' + (info.brooms.length ? '<span class="broom">🧹</span>' : '') + '</div>' +
          info.rows.map(function (r) { return '<div class="row" style="' + rowStyle(r) + '"></div>'; }).join('') + '</div>';
      }
      html += '</div>';
      var sd = selected[p.id];
      if (sd) {
        var inf = dayInfo(sd, p.units, all);
        html += '<div class="detail"><b>' + nice(sd) + '</b>' + (inf.turn ? ' <span class="pill" style="background:#dc2626;color:#fff">SAME-DAY TURNOVER</span>' : '') + (inf.lines.length ? '<ul><li>' + inf.lines.join('</li><li>') + '</li></ul>' : '<div>Nothing scheduled.</div>') + '</div>';
      }
      html += '</div>';
    });
    var c = el('cals');
    c.innerHTML = html;
    c.querySelectorAll('.cal').forEach(function (cal) {
      var pid = cal.getAttribute('data-p'), x0 = null, y0 = null;
      cal.onclick = function (e) {
        var n = e.target.closest('[data-nav]');
        if (n) { var k = Number(n.getAttribute('data-nav')); shift(pid, k); return; }
        var d = e.target.closest('.day');
        if (d) { var v = d.getAttribute('data-d'); selected[pid] = selected[pid] === v ? null : v; renderCals(); }
      };
      cal.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      cal.addEventListener('touchend', function (e) {
        if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(pid, dx < 0 ? 1 : -1);
      }, { passive: true });
    });
  }
  function shift(pid, k) {
    if (k === 0) { months[pid] = todayNY().slice(0, 7); }
    else { var d = new Date(months[pid] + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); months[pid] = d.toISOString().slice(0, 7); }
    selected[pid] = null; renderCals();
  }

  function render() { if (!data) return; index(); renderHeader(); renderFilters(); renderList(); renderCals(); }

  function refresh() {
    fetch('data.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && (!data || d.generatedAt >= data.generatedAt)) { data = d; render(); }
    }).catch(function () {}).then(renderHeader);
  }

  render();
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  setInterval(function () { if (data) { renderHeader(); } }, 60 * 1000);
  var lastDay = todayNY();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (todayNY() !== lastDay) { lastDay = todayNY(); render(); } refresh(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
