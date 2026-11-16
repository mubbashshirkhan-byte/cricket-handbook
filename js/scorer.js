// Live scores: create a match and score it ball by ball.
// Matches are saved in this browser's localStorage (per device).

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

(function () {
  const KEY = 'crickethub.matches.v1';
  const app = document.getElementById('app');
  let extra = null; // pending modifier for the next ball: 'wd' | 'nb' | 'b' | 'lb' | null

  // ---------- storage ----------
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  };
  const save = matches => {
    try { localStorage.setItem(KEY, JSON.stringify(matches)); return true; } catch (e) { return false; }
  };
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  function scoreLine(m, st, i) {
    const started = i === 0 || st.done1;
    const batting = !st.done2 && st.inn === i;
    return '<div class="sc-line' + (batting ? ' batting' : '') + '">' +
      '<span class="sc-team">' + esc(st.bat[i]) + (batting ? ' <em>batting</em>' : '') + '</span>' +
      '<span class="sc-score">' + (started
        ? st.s[i].runs + '/' + st.s[i].wkts + ' <small>(' + oversText(st.s[i].legal) + ' ov)</small>'
        : '<small>Yet to bat</small>') + '</span></div>';
  }

  function viewList() {
    const matches = load().slice().reverse();
    const card = m => {
      const st = getState(m);
      return '<a class="match-card" href="#/m/' + m.id + '">' +
        '<div class="match-meta"><span class="badge ' + (st.done2 ? 'done' : 'live') + '">' +
        (st.done2 ? 'Completed' : 'Live') + '</span><span>' + m.overs + ' overs</span></div>' +
        scoreLine(m, st, 0) + scoreLine(m, st, 1) +
        (st.result ? '<p class="match-result">' + esc(st.result) + '</p>' : '') + '</a>';
    };
    app.innerHTML =
      '<div class="scorer-head"><div><h1>Live scores</h1><p>Create a match and score it ball by ball.</p></div>' +
      '<a class="btn btn-primary" href="#/new">+ New match</a></div>' +
      (matches.length
        ? '<div class="match-list">' + matches.map(card).join('') + '</div>'
        : '<div class="empty"><div class="empty-icon">🏏</div><h2>No matches yet</h2>' +
          '<p>Start your first match to see the live score here.</p>' +
          '<a class="btn btn-primary" href="#/new">Start a match</a></div>') +
      '<p class="note">Matches are saved on this device only.</p>';
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
        id: Date.now().toString(36),
        teams: [a, b],
        overs: overs,
        first: parseInt(f.first.value, 10),
        balls: [[], []],
        created: Date.now()
      };
      const matches = load();
      matches.push(m);
      if (!save(matches)) { err.textContent = 'Could not save the match on this device.'; err.hidden = false; return; }
      location.hash = '#/m/' + m.id;
    });
  }

  function viewMatch(id) {
    const m = load().find(x => x.id === id);
    if (!m) {
      app.innerHTML = '<a class="back-link" href="#/">← All matches</a>' +
        '<div class="empty"><h2>Match not found</h2><p>It may have been deleted or scored on another device.</p></div>';
      return;
    }
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
    } else if (s.legal === 0 && !anyBalls) {
      info = '<p class="chase">Tap a button below to record the first ball.</p>';
    }

    const mods = [['wd', 'Wide'], ['nb', 'No ball'], ['b', 'Bye'], ['lb', 'Leg bye']];
    const pad = st.done2 ? '' :
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
      pad +
      '<div class="match-actions">' +
      '<button type="button" data-act="undo" class="btn btn-outline"' + (anyBalls ? '' : ' disabled') + '>↶ Undo last ball</button>' +
      '<button type="button" data-act="delete" class="btn btn-danger">Delete match</button>' +
      '</div>';
  }

  // ---------- actions ----------
  function update(id, fn) {
    const matches = load();
    const m = matches.find(x => x.id === id);
    if (!m) return;
    fn(m, matches);
    save(matches);
  }

  function addBall(id, runs, wicket) {
    update(id, m => {
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
  }

  function currentId() {
    const h = location.hash.match(/^#\/m\/(.+)$/);
    return h ? h[1] : null;
  }

  app.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const id = currentId();
    if (!id) return;

    if (btn.dataset.mod) {
      extra = extra === btn.dataset.mod ? null : btn.dataset.mod;
    } else if (btn.dataset.run !== undefined) {
      addBall(id, parseInt(btn.dataset.run, 10), false);
    } else if (btn.dataset.act === 'wicket') {
      addBall(id, 0, true);
    } else if (btn.dataset.act === 'undo') {
      update(id, m => { (m.balls[1].length ? m.balls[1] : m.balls[0]).pop(); });
      extra = null;
    } else if (btn.dataset.act === 'delete') {
      if (!window.confirm('Delete this match? This cannot be undone.')) return;
      update(id, (m, matches) => { matches.splice(matches.indexOf(m), 1); });
      location.hash = '#/';
      return;
    } else {
      return;
    }
    viewMatch(id);
  });

  // ---------- router ----------
  function route() {
    extra = null;
    const h = location.hash;
    if (h === '#/new') viewNew();
    else if (currentId()) viewMatch(currentId());
    else viewList();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
