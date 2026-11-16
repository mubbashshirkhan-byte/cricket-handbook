// Live scores: create a match and score it ball by ball.
// Matches are always saved in this browser (localStorage). If js/firebase-config.js
// holds a Firebase config, each match is also published to Firebase Realtime Database
// so other devices can follow it live (read-only).

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

(function () {
  const KEY = 'crickethub.matches.v1';
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const app = document.getElementById('app');
  const cfg = window.FIREBASE_CONFIG;
  const cloudEnabled = !!(cfg && cfg.apiKey && cfg.databaseURL);

  let extra = null;      // pending modifier for the next ball: 'wd' | 'nb' | 'b' | 'lb' | null
  let syncState = cloudEnabled ? 'connecting' : 'off'; // off | connecting | on | error
  let remote = [];       // matches from other devices (list view)
  let remoteLoaded = false;
  let watchToken = 0;    // invalidates cloud listeners when the route changes
  let unsub = null;

  // ---------- local storage ----------
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  };
  const save = matches => {
    try { localStorage.setItem(KEY, JSON.stringify(matches)); return true; } catch (e) { return false; }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- cloud (Firebase) ----------
  const cloud = !cloudEnabled ? Promise.resolve(null) :
    Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-database.js')])
      .then(mods => {
        const A = mods[0], U = mods[1], D = mods[2];
        const fb = A.initializeApp(cfg);
        const db = D.getDatabase(fb);
        return U.signInAnonymously(U.getAuth(fb)).then(cred => ({ D: D, db: db, uid: cred.user.uid }));
      })
      .then(c => { setSync('on'); return c; })
      .catch(e => { console.error('Cloud sync unavailable:', e); setSync('error'); return null; });

  function syncText() {
    if (syncState === 'off') return 'Saved on this device only';
    if (syncState === 'error') return '⚠ Not syncing. Check your connection.';
    if (syncState === 'connecting') return 'Connecting…';
    return '● Shared live';
  }
  function setSync(state) {
    syncState = state;
    const el = document.getElementById('sync');
    if (el) { el.textContent = syncText(); el.className = 'sync ' + state; }
  }

  function pushCloud(m) {
    cloud.then(c => {
      if (!c) return;
      return c.D.set(c.D.ref(c.db, 'matches/' + m.id), {
        id: m.id, teams: m.teams, overs: m.overs, first: m.first, created: m.created,
        owner: c.uid, updated: Date.now(),
        balls0: m.balls[0], balls1: m.balls[1]
      }).then(() => setSync('on'));
    }).catch(e => { console.error('Sync failed:', e); setSync('error'); });
  }
  function removeCloud(id) {
    cloud.then(c => c && c.D.remove(c.D.ref(c.db, 'matches/' + id))).catch(() => {});
  }

  const normBalls = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [])
    .filter(Boolean)
    .map(b => ({ r: Number(b.r) || 0, legal: !!b.legal, w: !!b.w, label: String(b.label == null ? '' : b.label) }));

  function fromCloud(d) {
    if (!d || !Array.isArray(d.teams) || d.teams.length !== 2 || !(Number(d.overs) >= 1)) return null;
    return {
      id: String(d.id), teams: [String(d.teams[0]), String(d.teams[1])],
      overs: Number(d.overs), first: d.first ? 1 : 0, created: Number(d.created) || 0,
      balls: [normBalls(d.balls0), normBalls(d.balls1)]
    };
  }

  // Listen to one match (id) or to the latest matches (id = null) until the route changes.
  function watch(id, cb) {
    const token = watchToken;
    cloud.then(c => {
      if (token !== watchToken) return;
      if (!c) { cb(null); return; }
      const D = c.D;
      const target = id ? D.ref(c.db, 'matches/' + id)
        : D.query(D.ref(c.db, 'matches'), D.orderByChild('created'), D.limitToLast(30));
      unsub = D.onValue(target,
        snap => { if (token === watchToken) cb(snap.val()); },
        () => { if (token === watchToken) cb(null); });
    });
  }

  // Publish matches that were scored before sharing was switched on.
  if (cloudEnabled) cloud.then(c => { if (c) load().forEach(pushCloud); });

  // ---------- match maths (everything is derived from the list of balls) ----------
  const sum = balls => balls.reduce((t, b) => {
    t.runs += b.r; t.wkts += b.w ? 1 : 0; t.legal += b.legal ? 1 : 0; return t;
  }, { runs: 0, wkts: 0, legal: 0 });

  const oversText = legal => Math.floor(legal / 6) + '.' + (legal % 6);
  const rate = (runs, legal) => legal ? (runs / (legal / 6)).toFixed(2) : '0.00';

  function getState(m) {
    const bat = [m.teams[m.first], m.teams[1 - m.first]]; // batting order
    const max = m.overs * 6;
    const s = [sum(m.balls[0]), sum(m.balls[1])];
    const target = s[0].runs + 1;
    const done1 = s[0].legal >= max || s[0].wkts >= 10;
    const done2 = done1 && (s[1].legal >= max || s[1].wkts >= 10 || s[1].runs >= target);
    let result = '';
    if (done2) {
      if (s[1].runs >= target) {
        const w = 10 - s[1].wkts;
        result = bat[1] + ' won by ' + w + ' wicket' + (w === 1 ? '' : 's');
      } else if (s[1].runs === s[0].runs) {
        result = 'Match tied';
      } else {
        const d = s[0].runs - s[1].runs;
        result = bat[0] + ' won by ' + d + ' run' + (d === 1 ? '' : 's');
      }
    }
    return { bat, max, s, target, done1, done2, inn: done1 ? 1 : 0, result };
  }

  // Balls of the over currently in progress (or the one just completed)
  function currentOver(balls) {
    const groups = [];
    let legal = 0, needNew = true;
    balls.forEach(b => {
      if (needNew) { groups.push([]); needNew = false; }
      groups[groups.length - 1].push(b);
      if (b.legal) { legal++; if (legal % 6 === 0) needNew = true; }
    });
    return groups.length ? groups[groups.length - 1] : [];
  }

  // ---------- views ----------
  function scoreLine(st, i) {
    const started = i === 0 || st.done1;
    const batting = !st.done2 && st.inn === i;
    return '<div class="sc-line' + (batting ? ' batting' : '') + '">' +
      '<span class="sc-team">' + esc(st.bat[i]) + (batting ? ' <em>batting</em>' : '') + '</span>' +
      '<span class="sc-score">' + (started
        ? st.s[i].runs + '/' + st.s[i].wkts + ' <small>(' + oversText(st.s[i].legal) + ' ov)</small>'
        : '<small>Yet to bat</small>') + '</span></div>';
  }

  function card(m) {
    const st = getState(m);
    return '<a class="match-card" href="#/m/' + encodeURIComponent(m.id) + '">' +
      '<div class="match-meta"><span class="badge ' + (st.done2 ? 'done' : 'live') + '">' +
      (st.done2 ? 'Completed' : 'Live') + '</span><span>' + m.overs + ' overs</span></div>' +
      scoreLine(st, 0) + scoreLine(st, 1) +
      (st.result ? '<p class="match-result">' + esc(st.result) + '</p>' : '') + '</a>';
  }

  function renderList() {
    const mine = load().slice().reverse();
    const mineIds = mine.map(m => m.id);
    const others = remote.filter(m => mineIds.indexOf(m.id) === -1);

    let html =
      '<div class="scorer-head"><div><h1>Live scores</h1><p>Create a match and score it ball by ball.</p></div>' +
      '<a class="btn btn-primary" href="#/new">+ New match</a></div>';

    if (mine.length) {
      html += (cloudEnabled ? '<h2 class="list-title">Scored on this device</h2>' : '') +
        '<div class="match-list">' + mine.map(card).join('') + '</div>';
    } else if (!others.length) {
      html += '<div class="empty"><div class="empty-icon">🏏</div><h2>No matches yet</h2>' +
        '<p>Start your first match to see the live score here.</p>' +
        '<a class="btn btn-primary" href="#/new">Start a match</a></div>';
    }

    if (cloudEnabled) {
      html += '<h2 class="list-title">Matches from other devices</h2>' +
        (others.length ? '<div class="match-list">' + others.map(card).join('') + '</div>'
          : '<p class="note left">' + (remoteLoaded ? 'No other matches right now.' : 'Loading…') + '</p>');
    }

    html += '<p class="note">' + (cloudEnabled
      ? 'Matches you score are shared live. Anyone with the link can follow them.'
      : 'Matches are saved on this device only.') + '</p>';
    app.innerHTML = html;
  }

  function startList() {
    remote = []; remoteLoaded = false;
    renderList();
    if (!cloudEnabled) return;
    watch(null, val => {
      remoteLoaded = true;
      remote = Object.keys(val || {}).map(k => fromCloud(val[k])).filter(Boolean)
        .sort((a, b) => b.created - a.created);
      renderList();
    });
  }

  function viewNew() {
    app.innerHTML =
      '<a class="back-link" href="#/">← All matches</a>' +
      '<h1>New match</h1>' +
      '<form class="match-form" id="newForm" novalidate>' +
      '<label>Team A<input name="a" maxlength="30" required placeholder="e.g. Strikers"></label>' +
      '<label>Team B<input name="b" maxlength="30" required placeholder="e.g. Titans"></label>' +
      '<label>Overs per side<input name="overs" type="number" min="1" max="50" value="10" required inputmode="numeric"></label>' +
      '<fieldset><legend>Batting first</legend>' +
      '<label class="radio"><input type="radio" name="first" value="0" checked> Team A</label>' +
      '<label class="radio"><input type="radio" name="first" value="1"> Team B</label></fieldset>' +
      '<p class="form-error" id="formError" hidden></p>' +
      '<button class="btn btn-primary btn-block" type="submit">Start match</button></form>';

    document.getElementById('newForm').addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const a = f.a.value.trim(), b = f.b.value.trim();
      const overs = parseInt(f.overs.value, 10);
      const err = document.getElementById('formError');
      let msg = '';
      if (!a || !b) msg = 'Enter both team names.';
      else if (a.toLowerCase() === b.toLowerCase()) msg = 'Team names must be different.';
      else if (!(overs >= 1 && overs <= 50)) msg = 'Overs must be between 1 and 50.';
      if (msg) { err.textContent = msg; err.hidden = false; return; }

      const m = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        teams: [a, b],
        overs: overs,
        first: parseInt(f.first.value, 10),
        balls: [[], []],
        created: Date.now()
      };
      const matches = load();
      matches.push(m);
      if (!save(matches)) { err.textContent = 'Could not save the match on this device.'; err.hidden = false; return; }
      pushCloud(m);
      location.hash = '#/m/' + m.id;
    });
  }

  function notFound(text) {
    app.innerHTML = '<a class="back-link" href="#/">← All matches</a>' +
      '<div class="empty"><h2>Match not found</h2><p>' + text + '</p></div>';
  }

  function startMatch(id) {
    const local = load().find(x => x.id === id);
    if (local) { renderMatch(local, false); return; }
    if (!cloudEnabled) { notFound('It may have been deleted or scored on another device.'); return; }
    app.innerHTML = '<a class="back-link" href="#/">← All matches</a><p class="note">Loading match…</p>';
    watch(id, val => {
      const m = fromCloud(val);
      if (m) renderMatch(m, true);
      else notFound('It may have been deleted, or the link is wrong.');
    });
  }

  function renderMatch(m, readonly) {
    const st = getState(m);
    const i = st.inn, s = st.s[i];
    const over = currentOver(m.balls[i]);
    const anyBalls = m.balls[0].length > 0;

    let info = '';
    if (st.done2) {
      info = '<div class="result-banner">🏆 ' + esc(st.result) + '</div>';
    } else if (i === 1) {
      const need = st.target - s.runs, left = st.max - s.legal;
      info = '<p class="chase">' + esc(st.bat[1]) + ' need <strong>' + need + '</strong> run' + (need === 1 ? '' : 's') +
        ' from <strong>' + left + '</strong> ball' + (left === 1 ? '' : 's') +
        ' · Required rate ' + rate(need, left) + '</p>';
    } else if (!anyBalls) {
      info = '<p class="chase">' + (readonly ? 'The match has not started yet.' : 'Tap a button below to record the first ball.') + '</p>';
    }

    const mods = [['wd', 'Wide'], ['nb', 'No ball'], ['b', 'Bye'], ['lb', 'Leg bye']];
    const pad = (st.done2 || readonly) ? '' :
      '<div class="pad">' +
      '<div class="pad-mods">' + mods.map(x =>
        '<button type="button" data-mod="' + x[0] + '" class="mod' + (extra === x[0] ? ' on' : '') +
        '" aria-pressed="' + (extra === x[0]) + '">' + x[1] + '</button>').join('') + '</div>' +
      (extra ? '<p class="pad-hint">' + (extra === 'wd' || extra === 'nb'
        ? 'Now tap the extra runs taken (0 if none). 1 penalty run is added automatically.'
        : 'Now tap the runs taken.') + '</p>' : '') +
      '<div class="pad-runs">' + [0, 1, 2, 3, 4, 6].map(n =>
        '<button type="button" data-run="' + n + '" class="run r' + n + '">' + n + '</button>').join('') + '</div>' +
      '<button type="button" data-act="wicket" class="wicket">Wicket</button>' +
      '</div>';

    const share = cloudEnabled ? '<button type="button" data-act="share" class="btn btn-primary">Share live score</button>' : '';
    const actions = readonly
      ? '<p class="note">Live view. The score updates automatically.</p><div class="match-actions center">' + share + '</div>'
      : '<p class="sync ' + syncState + '" id="sync">' + syncText() + '</p>' +
        '<div class="match-actions">' + share +
        '<button type="button" data-act="undo" class="btn btn-outline"' + (anyBalls ? '' : ' disabled') + '>↶ Undo last ball</button>' +
        '<button type="button" data-act="delete" class="btn btn-danger">Delete match</button></div>';

    app.innerHTML =
      '<a class="back-link" href="#/">← All matches</a>' +
      '<section class="scoreboard">' +
      '<div class="match-meta"><span class="badge ' + (st.done2 ? 'done' : 'live') + '">' +
      (st.done2 ? 'Completed' : 'Live') + '</span><span>' + m.overs + ' overs · Innings ' + (i + 1) + '</span></div>' +
      '<div class="big-score"><span class="big-team">' + esc(st.bat[i]) + '</span>' +
      '<span class="big-runs">' + s.runs + '/' + s.wkts + '</span>' +
      '<span class="big-overs">' + oversText(s.legal) + ' / ' + m.overs + ' overs · Run rate ' + rate(s.runs, s.legal) + '</span></div>' +
      (i === 1 ? '<p class="first-inn">' + esc(st.bat[0]) + ' ' + st.s[0].runs + '/' + st.s[0].wkts +
        ' (' + oversText(st.s[0].legal) + ' ov) · Target ' + st.target + '</p>' : '') +
      info +
      '<div class="this-over"><span>This over</span><div class="balls">' +
      (over.length ? over.map(b => '<i class="ball' + (b.w ? ' w' : b.label === '4' || b.label === '6' ? ' boundary' : !b.legal ? ' ex' : '') +
        '">' + esc(b.label) + '</i>').join('') : '<small>No balls yet</small>') + '</div></div>' +
      '</section>' +
      pad + actions;
  }

  // ---------- actions ----------
  function update(id, fn) {
    const matches = load();
    const m = matches.find(x => x.id === id);
    if (!m) return null;
    fn(m, matches);
    save(matches);
    return m;
  }

  function addBall(id, runs, wicket) {
    const m = update(id, m => {
      const st = getState(m);
      if (st.done2) return;
      const penalty = extra === 'wd' || extra === 'nb';
      const prefix = { wd: 'Wd', nb: 'Nb', b: 'B', lb: 'Lb' }[extra] || '';
      let label;
      if (wicket) label = prefix ? prefix + '+W' : 'W';
      else if (penalty) label = prefix + (runs ? '+' + runs : '');
      else if (prefix) label = prefix + runs;
      else label = String(runs);
      m.balls[st.inn].push({ r: runs + (penalty ? 1 : 0), legal: !penalty, w: !!wicket, label: label });
    });
    extra = null;
    if (m) pushCloud(m);
  }

  function shareMatch(btn) {
    const url = location.href;
    const done = text => { btn.textContent = text; setTimeout(() => { btn.textContent = 'Share live score'; }, 2000); };
    if (navigator.share) {
      navigator.share({ title: 'Live cricket score', url: url }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => done('Link copied'), () => window.prompt('Copy this link:', url));
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  function currentId() {
    const h = location.hash.match(/^#\/m\/(.+)$/);
    return h ? decodeURIComponent(h[1]) : null;
  }

  app.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const id = currentId();
    if (!id) return;

    if (btn.dataset.act === 'share') { shareMatch(btn); return; }

    if (btn.dataset.mod) {
      extra = extra === btn.dataset.mod ? null : btn.dataset.mod;
    } else if (btn.dataset.run !== undefined) {
      addBall(id, parseInt(btn.dataset.run, 10), false);
    } else if (btn.dataset.act === 'wicket') {
      addBall(id, 0, true);
    } else if (btn.dataset.act === 'undo') {
      const m = update(id, m => { (m.balls[1].length ? m.balls[1] : m.balls[0]).pop(); });
      extra = null;
      if (m) pushCloud(m);
    } else if (btn.dataset.act === 'delete') {
      if (!window.confirm('Delete this match? This cannot be undone.')) return;
      update(id, (m, matches) => { matches.splice(matches.indexOf(m), 1); });
      removeCloud(id);
      location.hash = '#/';
      return;
    } else {
      return;
    }
    const local = load().find(x => x.id === id);
    if (local) renderMatch(local, false);
  });

  // ---------- router ----------
  function route() {
    extra = null;
    watchToken++;
    if (unsub) { unsub(); unsub = null; }
    const h = location.hash;
    if (h === '#/new') viewNew();
    else if (currentId()) startMatch(currentId());
    else startList();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
