(function () {
  'use strict';
  var TZ = 'America/New_York', HORIZON = 60, STALE_MS = 3 * 3600 * 1000;
  var data = window.__DATA__, units = {}, filter = 'all', months = {}, selected = {}, showAll = false, MAXCARDS = 6, calMode = {};
  try { calMode = JSON.parse(localStorage.getItem('calMode') || '{}') || {}; } catch (e) {}
  try { filter = localStorage.getItem('filter') || 'all'; } catch (e) {}

  function todayNY() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
  function addDays(d, n) { var t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function fmt(d, opts) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts)); }
  function nice(d) { return fmt(d, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function nightsTxt(s) { var n = Math.round((Date.parse(s.end) - Date.parse(s.start)) / 864e5); return n + ' night' + (n === 1 ? '' : 's'); }
  function stayTxt(s, long) { var f = long ? nice : function (d) { return fmt(d, { month: 'short', day: 'numeric' }); }; return 'Check in ' + f(s.start) + ' · Checkout ' + f(s.end) + ' · ' + nightsTxt(s); }
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
        var nl = n ? '<div class="next">Next guests: <b>' + stayTxt(n, true) + '</b>' + (n.unit !== s.unit ? ' (' + esc(units[n.unit].short) + ')' : '') + '</div>' : '';
        if (n && n.start === s.end) nx = '<span class="sameday">SAME-DAY TURNOVER – guests arrive today</span>' + nl;
        else if (n) nx = nl;
        else nx = '<div class="next">Next guests: <b>none booked yet</b></div>';
        var X = window.Pay ? Pay.crossed(s) : null;
        html += '<div class="card' + (X ? ' crossed' : '') + '" data-id="' + esc(s.unit + '|' + s.end) + '" style="border-left-color:' + u.color + '">' +
          '<div class="date">' + nice(s.end) + '</div>' +
          '<div class="where">' + esc(u.propName) + ' · ' + esc(u.short) + '</div>' +
          '<div class="meta"><span class="pill">🧹 Clean after checkout</span><span class="pill ' + s.source + '">' + s.source + '</span></div><div class="staytxt">' + stayTxt(s) + '</div>' +
          nx +
          (s.source === 'Blocked' && !X ? '<div class="note">Dates blocked on Airbnb (usually a booking from another listing/site). Confirm with Branson if unsure.</div>' : '') +
          (window.Pay ? Pay.cardHtml(s) : '') +
          '</div>';
      });
    });
    if (items.length > shown) html += '<button class="more" id="more">Show all ' + items.length + ' cleanings (next ' + HORIZON + ' days)</button>';
    else if (showAll && items.length > MAXCARDS) html += '<button class="more" id="more">Show fewer</button>';
    el('list').innerHTML = html || '<div class="empty">No cleanings in the next ' + HORIZON + ' days.</div>';
    var mb = el('more'); if (mb) mb.onclick = function () { showAll = !showAll; renderList(); };
  }

  // ---- Calendars ----
  // rows: [{ color, stays:[{unit,start,end,type,source}] }]; turnKey(s, o) decides if an arrival makes a same-day turnover
  function dayInfo(d, rows, sameSpace) {
    var out = { rows: [], brooms: 0, turn: false, lines: [] };
    rows.forEach(function (row) {
      var L = null, R = null;
      row.stays.forEach(function (s) {
        if (s.start < d && d <= s.end) L = s;
        if (s.start <= d && d < s.end) R = s;
      });
      out.rows.push({ color: row.color, L: L, R: R, split: L && R && L !== R });
      row.stays.forEach(function (s) {
        var nm = esc(row.name || units[s.unit].short);
        if (s.type === 'stay' && s.end === d) {
          var cx = window.Pay ? Pay.crossed(s) : null;
          if (cx) { out.lines.push('❌ <s>Clean: ' + nm + '</s> — crossed off (' + esc(cx.reason) + ')'); return; }
          out.brooms++; out.lines.push('🧹 Checkout / clean: <b>' + nm + '</b> (' + s.source + ') — ' + stayTxt(s));
          if (sameSpace(s, d)) out.turn = true;
        }
        if (s.type === 'stay' && s.start === d) out.lines.push('🔑 Guests arrive: <b>' + nm + '</b> (' + s.source + ') — ' + stayTxt(s));
        if (s.start < d && d < s.end) out.lines.push((s.type === 'closed' ? '⛔ Closed/blocked: ' : (s.source === 'Blocked' ? '🚫 Blocked: ' : '🛏️ Occupied: ')) + '<b>' + nm + '</b> — ' + stayTxt(s));
      });
    });
    return out;
  }

  function segColor(s, c) { return !s ? 'transparent' : s.type === 'closed' ? '#cbd5e1' : s.source === 'Blocked' ? c + '77' : c; }
  // One continuous bar per stay per week-row (no gaps at cell borders). Check-in starts mid-cell, checkout ends mid-cell.
  // Flat caps at week wraps; rounded caps only at the true start/end so back-to-back stays stay distinct.
  function weekBars(weekStart, rows) {
    var weekEnd = addDays(weekStart, 6), html = '';
    rows.forEach(function (row, lane) {
      row.stays.forEach(function (s) {
        if (s.end < weekStart || s.start > weekEnd) return;
        var startDay = 0, startFrac = 0, capL = false;
        var endDay = 6, endFrac = 1, capR = false;
        if (s.start >= weekStart) {
          startDay = Math.round((Date.parse(s.start) - Date.parse(weekStart)) / 864e5);
          startFrac = 0.53; capL = true;
        }
        if (s.end <= weekEnd) {
          endDay = Math.round((Date.parse(s.end) - Date.parse(weekStart)) / 864e5);
          endFrac = 0.47; capR = true;
        }
        if (endDay + endFrac <= startDay + startFrac) return;
        var left = 'calc(' + (startDay + startFrac) + ' * (100% - 6 * var(--gg)) / 7 + ' + startDay + ' * var(--gg))';
        var width = 'calc(' + ((endDay + endFrac) - (startDay + startFrac)) + ' * (100% - 6 * var(--gg)) / 7 + ' + (endDay - startDay) + ' * var(--gg))';
        var cls = 'bar' + (capL ? ' s' : '') + (capR ? ' e' : '') + (s.type === 'closed' ? ' closed' : '');
        var st = '--lane:' + lane + ';left:' + left + ';width:' + width;
        if (s.type !== 'closed') st += ';background:' + segColor(s, row.color);
        html += '<div class="' + cls + '" style="' + st + '"></div>';
      });
    });
    return html;
  }

  function monthHtml(key, pid, title, sub, color, legend, rows, sameSpace) {
    var today = todayNY(), m = months[pid] || today.slice(0, 7);
    var first = m + '-01', dow = new Date(first + 'T12:00:00Z').getUTCDay(), start = addDays(first, -dow);
    var h = '<div class="cal" data-p="' + pid + '" data-k="' + esc(key) + '"' + (color ? ' style="border-top:6px solid ' + color + '"' : '') + '>' +
      '<div class="calhead"><button class="nav" data-nav="-1" aria-label="Previous month">‹</button><h3>' + title + '<small>' + esc(sub) + ' · ' + fmt(first, { month: 'long', year: 'numeric' }) + '</small></h3><button class="nav" data-nav="1" aria-label="Next month">›</button></div>';
    if (m !== today.slice(0, 7)) h += '<div style="text-align:center"><button class="todaybtn" data-nav="0">Back to this month</button></div>';
    h += '<div class="legend">' + legend + '<span>🧹 cleaning</span><span><i class="sw" style="box-shadow:inset 0 0 0 2px #dc2626"></i>same-day</span><span><i class="sw closed"></i>closed</span></div>';
    h += '<div class="grid"><div class="dows">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x) { return '<div class="dow">' + x + '</div>'; }).join('') + '</div>';
    for (var w = 0; w < 6; w++) {
      var ws = addDays(start, w * 7);
      if (w === 5 && ws.slice(0, 7) !== m) break;
      h += '<div class="week" style="--lanes:' + rows.length + '"><div class="weekdays">';
      for (var i = 0; i < 7; i++) {
        var d = addDays(ws, i);
        var info = dayInfo(d, rows, sameSpace);
        var cls = 'day' + (d.slice(0, 7) !== m ? ' out' : '') + (d === today ? ' today' : '') + (info.turn ? ' turn' : '') + (selected[key] === d ? ' sel' : '');
        h += '<div class="' + cls + '" data-d="' + d + '"><div class="dn"><span>' + Number(d.slice(8)) + '</span>' + (info.brooms ? '<span class="broom">🧹</span>' : '') + '</div><div class="rowspace"></div></div>';
      }
      h += '</div><div class="lanes" aria-hidden="true">' + weekBars(ws, rows) + '</div></div>';
    }
    h += '</div>';
    var sd = selected[key];
    if (sd) {
      var inf = dayInfo(sd, rows, sameSpace);
      h += '<div class="detail"><b>' + nice(sd) + '</b>' + (inf.turn ? ' <span class="pill" style="background:#dc2626;color:#fff">SAME-DAY TURNOVER</span>' : '') + (inf.lines.length ? '<ul><li>' + inf.lines.join('</li><li>') + '</li></ul>' : '<div>Nothing scheduled.</div>') + '</div>';
    }
    return h + '</div>';
  }

  function feedStays(f) {
    return f.events.map(function (e) {
      var n = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 864e5);
      return { unit: f.unit, start: e.start, end: e.end, type: e.kind === 'blocked' && n > 14 ? 'closed' : 'stay', source: e.kind === 'blocked' ? 'Blocked' : f.source };
    });
  }

  function renderCals() {
    var all = stays(), html = '';
    data.properties.forEach(function (p) {
      if (filter !== 'all' && filter !== p.id) return;
      var feeds = (data.feedCals || []).filter(function (f) { return f.property === p.id; });
      var act = feeds.filter(function (f) { return f.active; });
      html += '<div class="prophead"><h3>' + esc(p.name) + '</h3></div>';
      // Combined: every listing of this property on one calendar, one color-coded row per listing
      if (!act.length) html += '<div class="cal placeholder"><b>Combined</b><div class="note">No calendar links added yet for ' + esc(p.name) + '.</div></div>';
      else {
        var crow = act.map(function (f) { return { color: f.color, name: f.label, unit: f.unit, stays: feedStays(f) }; });
        var legend = act.map(function (f) { return '<span><i class="sw" style="background:' + f.color + '"></i>' + esc(f.label) + '</span>'; }).join('') + '<span><i class="sw" style="background:#94a3b8"></i>lighter = blocked</span>';
        html += monthHtml('c:' + p.id, p.id, 'Combined', p.name + ' – all listings', '#0f766e', legend, crow, function (s, d) {
          return crow.some(function (r) { return r.stays.some(function (o) { return o.type === 'stay' && o.start === d && units[o.unit] && units[s.unit] && related(units[s.unit], units[o.unit]); }); });
        });
      }
      feeds.forEach(function (f) {
        if (!f.active) { html += '<div class="cal placeholder" style="border-top:6px solid ' + f.color + '"><b>' + esc(f.label) + '</b> <span class="note">· ' + esc(p.name) + '</span><div class="note">📎 Calendar link not added yet</div></div>'; return; }
        var st = feedStays(f), row = [{ color: f.color, name: f.label, stays: st }];
        var legend = '<span><i class="sw" style="background:' + f.color + '"></i>booked</span><span><i class="sw" style="background:' + f.color + '77"></i>blocked</span>';
        html += monthHtml('f:' + f.id, p.id, esc(f.label), p.name, f.color, legend, row, function (s, d) {
          return st.some(function (o) { return o.type === 'stay' && o.start === d; });
        });
      });
    });
    var c = el('cals');
    c.innerHTML = html;
    c.querySelectorAll('.cal[data-k]').forEach(function (cal) {
      var pid = cal.getAttribute('data-p'), key = cal.getAttribute('data-k'), x0 = null, y0 = null;
      cal.onclick = function (e) {
        var n = e.target.closest('[data-nav]');
        if (n) { shift(pid, Number(n.getAttribute('data-nav'))); return; }
        var d = e.target.closest('.day');
        if (d) { var v = d.getAttribute('data-d'); selected[key] = selected[key] === v ? null : v; renderCals(); }
      };
      cal.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      cal.addEventListener('touchend', function (e) {
        if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(pid, dx < 0 ? 1 : -1);
      }, { passive: true });
    });
  }
  function feedProp(f) { return f.property; }
  function feedColor(f) { return f.color || '#64748b'; }
  function shift(pid, k) {
    if (k === 0) { months[pid] = todayNY().slice(0, 7); }
    else { var d = new Date((months[pid] || todayNY().slice(0, 7)) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); months[pid] = d.toISOString().slice(0, 7); }
    Object.keys(selected).forEach(function (k2) { selected[k2] = null; }); renderCals();
  }
  function render() { if (!data) return; index(); renderHeader(); renderFilters(); renderList(); renderCals(); if (window.Pay) Pay.render(); }
  window.App = { get data() { return data; }, get units() { return units; }, todayNY: todayNY, addDays: addDays, fmt: fmt, nice: nice, esc: esc, render: render, renderList: renderList, renderCals: renderCals };

  function refresh() {
    fetch('data.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && (!data || d.generatedAt >= data.generatedAt)) { data = d; render(); }
    }).catch(function () {}).then(renderHeader);
    if (window.Pay) Pay.load();
  }

  if (window.Pay) Pay.init();
  render();
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
  setInterval(function () { if (data) { renderHeader(); } }, 60 * 1000);
  var lastDay = todayNY();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (todayNY() !== lastDay) { lastDay = todayNY(); render(); } refresh(); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
