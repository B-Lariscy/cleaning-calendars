// Pay tracker, cross-offs and (owner-only) guest refunds.
// Shared state lives in the public repo on the "state" branch (state/<page>.json) so the cleaner can see her bill.
// Guest refunds live in a PRIVATE repo and are only loaded with the owner's token. Nothing here is built into the site.
(function () {
  'use strict';
  var A, state = null, refunds = null, refundsErr = '', owner = false, token = null, ui = { x: null, form: null }, busy = false;
  var REASONS = ['Guests canceled', 'Dates changed', 'Owner stay, no clean needed', 'Cleaned by someone else', 'Other'];
  var TK = 'ownerToken';

  function D() { return A.data; }
  function esc(s) { return A.esc(s == null ? '' : s); }
  function money(n) { n = Math.round(Number(n || 0) * 100) / 100; return '$' + (n % 1 ? n.toFixed(2) : String(n)); }
  function longDate(d) { return A.fmt(d, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function b64e(str) { var b = new TextEncoder().encode(str), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64d(b64) { var s = atob(b64.replace(/\n/g, '')), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new TextDecoder().decode(a); }
  function toast(msg, err) { var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 6000 : 2500); }
  function unitName(id) { var u = (D().allUnits || []).find(function (x) { return x.id === id; }); return u ? u.name : id; }

  // ---------- GitHub storage ----------
  function stateLoc() { var g = D().gh; return { repo: g.owner + '/' + g.repo, path: 'state/' + D().page + '.json', branch: g.stateBranch }; }
  function refundLoc() { var g = D().gh; return { repo: g.owner + '/' + g.privateRepo, path: 'refunds/' + D().page + '.json', branch: null }; }
  function api(method, loc, body, auth) {
    var url = 'https://api.github.com/repos/' + loc.repo + '/contents/' + loc.path + (method === 'GET' ? '?' + (loc.branch ? 'ref=' + loc.branch + '&' : '') + 't=' + Date.now() : '');
    var h = { 'Accept': 'application/vnd.github+json' };
    if (auth && token) h.Authorization = 'Bearer ' + token;
    if (body) h['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  }
  function readFile(loc, auth) {
    return api('GET', loc, null, auth).then(function (r) {
      if (r.status === 404) return { obj: null, sha: null };
      if (!r.ok) throw new Error('GitHub ' + r.status);
      return r.json().then(function (j) { return { obj: JSON.parse(b64d(j.content)), sha: j.sha }; });
    });
  }
  function readPublicState() {
    var loc = stateLoc();
    return readFile(loc, owner).then(function (x) { return x.obj; }).catch(function () {
      var g = D().gh; // fallback when the anonymous API limit is hit
      return fetch('https://raw.githubusercontent.com/' + g.owner + '/' + g.repo + '/' + g.stateBranch + '/' + loc.path + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('raw ' + r.status); return r.json(); });
    });
  }
  // Read-modify-write with retry on conflict
  function update(loc, def, mutate, what) {
    if (!token) return Promise.reject(new Error('Not in owner mode'));
    busy = true;
    var attempt = function (n) {
      return readFile(loc, true).then(function (x) {
        var obj = x.obj || JSON.parse(JSON.stringify(def));
        mutate(obj);
        obj.updatedAt = new Date().toISOString();
        var body = { message: what || 'Update', content: b64e(JSON.stringify(obj, null, 1) + '\n') };
        if (x.sha) body.sha = x.sha;
        if (loc.branch) body.branch = loc.branch;
        return api('PUT', loc, body, true).then(function (r) {
          if (r.ok) return obj;
          if ((r.status === 409 || r.status === 422) && n < 4) return new Promise(function (res) { setTimeout(res, 400 * (n + 1)); }).then(function () { return attempt(n + 1); });
          throw new Error(r.status === 401 || r.status === 403 || r.status === 404 ? 'Token not allowed to save (' + r.status + ')' : 'Save failed (' + r.status + ')');
        });
      });
    };
    return attempt(0).finally(function () { busy = false; });
  }
  function defState() { return { version: 1, rate: (D().billing || {}).rate || 70, baseline: { through: A.todayNY(), label: 'Tracking started' }, payments: [], crossoffs: {}, extras: [] }; }
  function defRefunds() { return { version: 1, periodStart: A.todayNY(), entries: [], periods: [] }; }
  function saveState(mutate, what) {
    toast('Saving…');
    return update(stateLoc(), defState(), mutate, what).then(function (obj) { state = obj; cacheState(); ui.form = null; ui.x = null; A.render(); toast('Saved ✓'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function saveRefunds(mutate, what) {
    toast('Saving…');
    return update(refundLoc(), defRefunds(), mutate, what).then(function (obj) { refunds = obj; ui.form = null; A.render(); toast('Saved ✓'); })
      .catch(function (e) { toast(e.message, true); });
  }
  function cacheState() { try { localStorage.setItem('state:' + D().page, JSON.stringify(state)); } catch (e) {} }

  // ---------- bill ----------
  function bill() {
    if (!state || !D().billing) return null;
    var today = A.todayNY(), through = (state.baseline || {}).through || '0000', rate = Number(state.rate || D().billing.rate || 70);
    var paidC = {}, paidX = {};
    (state.payments || []).forEach(function (p) { (p.cleanings || []).forEach(function (i) { paidC[i] = p; }); (p.extras || []).forEach(function (i) { paidX[i] = p; }); });
    var map = {};
    (D().completed || []).concat(D().stays.filter(function (s) { return s.type === 'stay' && s.end <= today; })).forEach(function (s) {
      if (s.end <= through) return; map[s.unit + '|' + s.end] = s;
    });
    var items = Object.keys(map).map(function (id) { return { id: id, s: map[id] }; }).sort(function (a, b) { return a.s.end.localeCompare(b.s.end); });
    var unpaid = items.filter(function (i) { return !paidC[i.id] && !(state.crossoffs || {})[i.id]; });
    var crossedOpen = items.filter(function (i) { return !paidC[i.id] && (state.crossoffs || {})[i.id]; });
    var extras = (state.extras || []).filter(function (x) { return !paidX[x.id]; });
    var owed = unpaid.length * rate + extras.reduce(function (t, x) { return t + Number(x.amount || 0); }, 0);
    var pays = (state.payments || []).slice().sort(function (a, b) { return (a.date + a.recordedAt).localeCompare(b.date + b.recordedAt); });
    var last = pays[pays.length - 1] || null;
    return { rate: rate, unpaid: unpaid, crossedOpen: crossedOpen, extras: extras, owed: owed, last: last, pays: pays, through: through };
  }

  // ---------- public API used by app.js ----------
  var Pay = {
    crossed: function (s) { return state && state.crossoffs ? state.crossoffs[s.unit + '|' + s.end] || null : null; },
    cardHtml: function (s) {
      var id = s.unit + '|' + s.end, X = Pay.crossed(s), h = '';
      if (X) {
        h += '<div class="xinfo">❌ Crossed off: ' + esc(X.reason) + (X.note ? ' – ' + esc(X.note) : '') + '</div>';
        if (owner) h += '<button class="btn small" data-act="uncross" data-id="' + esc(id) + '">Undo</button>';
        return h;
      }
      if (!owner) return '';
      if (ui.x === id) {
        h += '<div class="form"><b>Why cross this off?</b><div class="reasons">' + REASONS.map(function (r) { return '<button class="btn small" data-act="cross" data-reason="' + esc(r) + '" data-id="' + esc(id) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
          '<label>Note (needed for "Other"; Season can see it)</label><input id="xnote" maxlength="120" placeholder="optional">' +
          '<button class="btn small" data-act="xcancel">Cancel</button></div>';
      } else h += '<button class="btn small danger" data-act="xopen" data-id="' + esc(id) + '">✕ Cross off</button>';
      return h;
    },
    init: function () {
      A = window.App;
      try { token = localStorage.getItem(TK); } catch (e) {}
      owner = !!token;
      try { var c = localStorage.getItem('state:' + (window.__DATA__ || {}).page); if (c) state = JSON.parse(c); } catch (e) {}
      document.addEventListener('click', onClick);
      var ol = document.getElementById('ownerLink'); if (ol) ol.onclick = function (e) { e.preventDefault(); ownerPanel(true); };
    },
    load: function () {
      if (!D() || !D().gh || busy || ui.form || ui.x) return;
      readPublicState().then(function (s) { if (s) { state = s; cacheState(); } if (!ui.form && !ui.x) A.render(); }).catch(function () {});
      if (owner) readFile(refundLoc(), true).then(function (x) { refunds = x.obj || defRefunds(); refundsErr = ''; if (!ui.form) Pay.render(); })
        .catch(function (e) { refundsErr = 'Could not load refunds: ' + e.message; Pay.render(); });
    },
    render: function () { renderBar(); renderPay(); renderRefunds(); }
  };
  window.Pay = Pay;

  function renderBar() {
    var b = document.getElementById('ownerBar');
    if (!owner) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'ownerBar'; b.className = 'ownerbar'; document.body.insertBefore(b, document.body.firstChild); }
    b.innerHTML = '<span>🔑 Owner mode (only on this device)</span><button data-act="signout">Sign out</button>';
  }

  function renderPay() {
    var box = document.getElementById('pay'); if (!box) return;
    var B = bill();
    if (!B) { box.hidden = true; return; }
    box.hidden = false;
    var name = D().cleaner, n = B.unpaid.length, since = B.last ? B.last.date : B.through;
    var h = '<div class="owed">Owed to ' + esc(name) + ': ' + money(B.owed) + '</div>' +
      '<div class="owedsub">' + n + ' cleaning' + (n === 1 ? '' : 's') + ' × ' + money(B.rate) + (B.extras.length ? ' + ' + B.extras.length + ' extra' + (B.extras.length === 1 ? '' : 's') : '') + ' since ' + longDate(since) + '</div>' +
      '<div class="lastpaid">' + (B.last ? 'Last paid: ' + longDate(B.last.date) + ' — ' + money(B.last.amount) : 'Last paid: none yet (tracking started ' + longDate(B.through) + ')') + '</div>';
    if (owner) h += '<div><button class="btn primary" data-act="form" data-f="paid">💵 Mark paid</button><button class="btn" data-act="form" data-f="extra">＋ Add extra cleaning</button></div>';
    if (ui.form === 'paid') {
      h += '<div class="form"><b>Record payment to ' + esc(name) + '</b><label>Payment date</label><input type="date" id="pdate" value="' + A.todayNY() + '">' +
        '<label>Amount ($)</label><input type="number" id="pamt" inputmode="decimal" step="0.01" min="0" value="' + B.owed + '">' +
        '<div class="note">Covers ' + n + ' cleaning(s)' + (B.extras.length ? ' and ' + B.extras.length + ' extra(s)' : '') + '. The running bill resets to $0.</div>' +
        '<button class="btn primary" data-act="paysave">Save payment</button><button class="btn" data-act="fclose">Cancel</button></div>';
    }
    if (ui.form === 'extra') {
      var opts = (D().allUnits || []).map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>'; }).join('');
      h += '<div class="form"><b>Add extra cleaning</b><label>Date</label><input type="date" id="xdate" value="' + A.todayNY() + '">' +
        '<label>Unit</label><select id="xunit">' + opts + '</select>' +
        '<label>Amount ($)</label><input type="number" id="xamt" inputmode="decimal" step="0.01" min="0" value="' + B.rate + '">' +
        '<label>Note (Season can see it)</label><input id="xnote2" maxlength="120" placeholder="e.g. deep clean, missed cleaning from Nov 3">' +
        '<button class="btn primary" data-act="extrasave">Add</button><button class="btn" data-act="fclose">Cancel</button></div>';
    }
    // breakdown
    var rows = B.unpaid.map(function (i) {
      return '<div class="li"><span>' + A.nice(i.s.end) + ' · ' + esc(unitName(i.s.unit)) + (owner ? ' <button class="btn small danger" data-act="xopen" data-id="' + esc(i.id) + '">✕</button>' : '') + '</span><span class="amt">' + money(B.rate) + '</span></div>' +
        (owner && ui.x === i.id ? Pay.cardHtml(i.s) : '');
    }).concat(B.extras.map(function (x) {
      return '<div class="li"><span>' + A.nice(x.date) + ' · ' + esc(unitName(x.unit)) + ' · <i>extra' + (x.note ? ': ' + esc(x.note) : '') + '</i>' + (owner ? ' <button class="btn small danger" data-act="extradel" data-id="' + esc(x.id) + '">Delete</button>' : '') + '</span><span class="amt">' + money(x.amount) + '</span></div>';
    })).concat(B.crossedOpen.map(function (i) {
      var X = state.crossoffs[i.id];
      return '<div class="li"><span class="strike">' + A.nice(i.s.end) + ' · ' + esc(unitName(i.s.unit)) + '</span><span class="note">' + esc(X.reason) + (owner ? ' <button class="btn small" data-act="uncross" data-id="' + esc(i.id) + '">Undo</button>' : '') + '</span></div>';
    }));
    h += '<details' + (ui.openBreak ? ' open' : '') + ' data-d="openBreak"><summary>What\'s included (' + (n + B.extras.length) + ')</summary>' + (rows.length ? rows.join('') : '<div class="note">Nothing yet. Cleanings are added after their checkout day.</div>') + '</details>';
    // history
    var hist = B.pays.slice().reverse().map(function (p, i) {
      var c = (p.cleanings || []).length, x = (p.extras || []).length;
      return '<div class="li"><span><b>' + longDate(p.date) + '</b> — ' + money(p.amount) + '<br><span class="note">' + c + ' cleaning' + (c === 1 ? '' : 's') + (x ? ', ' + x + ' extra' + (x === 1 ? '' : 's') : '') + '</span></span>' +
        (owner && i === 0 ? '<button class="btn small danger" data-act="paydel" data-id="' + esc(p.id) + '">Delete</button>' : '') + '</div>';
    });
    hist.push('<div class="li"><span>' + longDate(B.through) + ' — <i>Tracking started</i> (not a payment)</span></div>');
    h += '<details' + (ui.openHist ? ' open' : '') + ' data-d="openHist"><summary>Payment history (' + B.pays.length + ')</summary>' + hist.join('') + '</details>';
    box.innerHTML = h;
    box.querySelectorAll('details').forEach(function (d) { d.addEventListener('toggle', function () { ui[d.getAttribute('data-d')] = d.open; }); });
  }

  function renderRefunds() {
    var box = document.getElementById('refunds'); if (!box) return;
    if (!owner) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (!refunds) { box.innerHTML = '<div class="box refundbox">' + (refundsErr ? esc(refundsErr) : 'Loading guest refunds…') + '</div>'; return; }
    var total = refunds.entries.reduce(function (t, e) { return t + Number(e.amount || 0); }, 0);
    var h = '<div class="box refundbox"><h2 class="sec" style="margin-top:0">🔒 Guest refunds for cleaning issues</h2><div class="note">Private — only visible in owner mode. Not part of ' + esc(D().cleaner) + '\'s pay.</div>' +
      '<div class="owed" style="color:#7c3aed">Refunded: ' + money(total) + '</div><div class="owedsub">' + refunds.entries.length + ' refund' + (refunds.entries.length === 1 ? '' : 's') + ' since ' + longDate(refunds.periodStart) + '</div>' +
      '<div><button class="btn primary" style="background:#7c3aed;border-color:#7c3aed" data-act="form" data-f="refund">＋ Add refund</button><button class="btn" data-act="newperiod">Start new period</button></div>';
    if (ui.form === 'refund') {
      var opts = (D().allUnits || []).map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>'; }).join('');
      h += '<div class="form"><label>Date</label><input type="date" id="rdate" value="' + A.todayNY() + '"><label>Amount refunded ($)</label><input type="number" id="ramt" inputmode="decimal" step="0.01" min="0">' +
        '<label>Unit</label><select id="runit">' + opts + '</select><label>Note</label><input id="rnote" maxlength="200" placeholder="what was wrong">' +
        '<button class="btn primary" data-act="refundsave">Save refund</button><button class="btn" data-act="fclose">Cancel</button></div>';
    }
    h += refunds.entries.slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).map(function (e) {
      return '<div class="li"><span>' + A.nice(e.date) + ' · ' + esc(unitName(e.unit)) + (e.note ? '<br><span class="note">' + esc(e.note) + '</span>' : '') + '</span><span class="amt">' + money(e.amount) + ' <button class="btn small danger" data-act="refunddel" data-id="' + esc(e.id) + '">Delete</button></span></div>';
    }).join('');
    if (refunds.periods.length) h += '<details><summary>Past periods (' + refunds.periods.length + ')</summary>' + refunds.periods.slice().reverse().map(function (p) { return '<div class="li"><span>' + longDate(p.start) + ' – ' + longDate(p.end) + ' (' + p.entries.length + ')</span><span class="amt">' + money(p.total) + '</span></div>'; }).join('') + '</details>';
    box.innerHTML = h + '</div>';
  }

  function ownerPanel(show) {
    var p = document.getElementById('ownerPanel'); if (!p) return;
    if (!show) { p.hidden = true; return; }
    p.hidden = false;
    p.innerHTML = owner ? '<b>Owner mode is on for this device.</b> <button class="btn" data-act="signout">Sign out</button>' :
      '<b>Owner sign-in</b><div class="note">Paste your GitHub access token (Contents read/write on the two cleaning-calendars repos). It stays only in this browser.</div>' +
      '<div class="form"><input type="password" id="tok" autocomplete="off" placeholder="github_pat_…"><button class="btn primary" data-act="tokensave">Turn on owner mode</button><button class="btn" data-act="tokcancel">Cancel</button></div>';
    p.scrollIntoView({ behavior: 'smooth' });
  }

  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

  function onClick(e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (busy) { toast('Still saving… one moment'); return; }
    if (act === 'xopen') { ui.x = id; ui.form = null; A.render(); return; }
    if (act === 'xcancel') { ui.x = null; A.render(); return; }
    if (act === 'fclose') { ui.form = null; A.render(); return; }
    if (act === 'form') { ui.form = b.getAttribute('data-f'); ui.x = null; A.render(); return; }
    if (act === 'cross') {
      var reason = b.getAttribute('data-reason'), note = val('xnote');
      if (reason === 'Other' && !note) { toast('Type a short note for "Other"', true); return; }
      saveState(function (s) { s.crossoffs = s.crossoffs || {}; s.crossoffs[id] = { reason: reason, note: note, at: A.todayNY() }; }, 'Cross off ' + id);
      return;
    }
    if (act === 'uncross') { saveState(function (s) { if (s.crossoffs) delete s.crossoffs[id]; }, 'Undo cross-off ' + id); return; }
    if (act === 'extrasave') {
      var amt = Number(val('xamt')), d = val('xdate');
      if (!d || !(amt >= 0)) { toast('Check the date and amount', true); return; }
      saveState(function (s) { s.extras = s.extras || []; s.extras.push({ id: uid(), date: d, unit: val('xunit'), amount: amt, note: val('xnote2') }); }, 'Add extra cleaning');
      return;
    }
    if (act === 'extradel') { if (!confirm('Delete this extra cleaning?')) return; saveState(function (s) { s.extras = (s.extras || []).filter(function (x) { return x.id !== id; }); }, 'Delete extra'); return; }
    if (act === 'paysave') {
      var B = bill(), pd = val('pdate'), pa = Number(val('pamt'));
      if (!pd || !(pa >= 0)) { toast('Check the date and amount', true); return; }
      var cl = B.unpaid.map(function (i) { return i.id; }), ex = B.extras.map(function (x) { return x.id; });
      saveState(function (s) { s.payments = s.payments || []; s.payments.push({ id: uid(), date: pd, amount: pa, cleanings: cl, extras: ex, recordedAt: new Date().toISOString() }); }, 'Record payment ' + pd);
      return;
    }
    if (act === 'paydel') { if (!confirm('Delete this payment? Its cleanings go back on the bill.')) return; saveState(function (s) { s.payments = (s.payments || []).filter(function (p) { return p.id !== id; }); }, 'Delete payment'); return; }
    if (act === 'refundsave') {
      var ra = Number(val('ramt')), rd = val('rdate');
      if (!rd || !(ra > 0)) { toast('Enter the refund amount', true); return; }
      saveRefunds(function (r) { r.entries.push({ id: uid(), date: rd, amount: ra, unit: val('runit'), note: val('rnote') }); }, 'Add refund');
      return;
    }
    if (act === 'refunddel') { if (!confirm('Delete this refund?')) return; saveRefunds(function (r) { r.entries = r.entries.filter(function (x) { return x.id !== id; }); }, 'Delete refund'); return; }
    if (act === 'newperiod') {
      if (!confirm('Start a new refund period? The current list is archived and the total resets to $0.')) return;
      saveRefunds(function (r) {
        var tot = r.entries.reduce(function (t, x) { return t + Number(x.amount || 0); }, 0);
        r.periods.push({ start: r.periodStart, end: A.todayNY(), total: tot, entries: r.entries });
        r.entries = []; r.periodStart = A.todayNY();
      }, 'New refund period');
      return;
    }
    if (act === 'tokcancel') { ownerPanel(false); return; }
    if (act === 'signout') { try { localStorage.removeItem(TK); } catch (x) {} token = null; owner = false; refunds = null; ownerPanel(false); A.render(); toast('Signed out'); return; }
    if (act === 'tokensave') {
      var t = val('tok'); if (!t) return;
      token = t;
      Promise.all([readFile(stateLoc(), true), readFile(refundLoc(), true)]).then(function () {
        try { localStorage.setItem(TK, t); } catch (x) {}
        owner = true; ownerPanel(false); toast('Owner mode on ✓'); Pay.load(); A.render();
      }).catch(function (er) { token = null; toast('That token can\'t read both repos (' + er.message + ')', true); });
    }
  }
})();
