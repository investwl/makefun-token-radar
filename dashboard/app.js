// Token Radar v3 dashboard. Reads window.RADAR (written beside this folder by main.ts) and renders the
// peer-calibrated board, the live-token set, the kept-out products, a sortable + filterable table, and
// a per-protocol detail drawer with the peer anchor, the conformal band and the costed farm plan.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model, B = DATA.backtest;
  var app = document.getElementById('board');
  var TVL_FLOORS = [0, 5e7, 1e8, 2.5e8, 1e9];
  var SORT_DEFAULT_DIR = { implied: -1, rank: -1, tvl: -1, growth: -1, age: -1, name: 1, mcap: -1, peer: -1 };
  var TAB_SORT = { 'pre-token': 'implied', live: 'mcap', excluded: 'tvl' };
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    return days >= 365 ? (days / 365).toFixed(1) + 'y' : Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '×' + (n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3));
  }
  function fmtRate(n) { return Math.round(n * 100) + '%'; }

  // The page recomputes each row from the same raw figures the board used, so the code and the board
  // are visibly the same arithmetic. It uses the stored peer multiple (the anchor), not a re-fit.
  function impliedOf(r) {
    return Math.max(1, Math.round(r.tvl_usd * r.peer_multiple * r.growth_mult * r.age_mult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // URL hash <-> state, so a filtered or detail view can be linked and screenshotted. Every value is
  // validated: an unknown floor, sort or tab falls back to a default.
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('min')) { var min = Number(p.get('min')); state.minTvl = TVL_FLOORS.indexOf(min) >= 0 ? min : 0; }
    if (p.get('tab') === 'live' || p.get('tab') === 'excluded') { state.tab = p.get('tab'); state.sort = TAB_SORT[state.tab]; }
    if (p.get('sort') && SORT_DEFAULT_DIR[p.get('sort')]) state.sort = p.get('sort');
    state.dir = Number(p.get('dir')) === 1 ? 1 : -1;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.minTvl) p.set('min', String(state.minTvl));
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function passesFilters(r, q) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, r.sector, r.reason, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows(list) {
    var q = state.q.trim().toLowerCase();
    return list.filter(function (r) { return passesFilters(r, q); });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else if (key === 'mcap') { av = a.mcap_usd === null ? -Infinity : a.mcap_usd; bv = b.mcap_usd === null ? -Infinity : b.mcap_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function masthead() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'dot' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'Token Radar' }),
          el('div', { class: 'brand-sub', text: 'peer-calibrated pre-token scanner' })
        )
      ),
      el('div', { class: 'pills' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'pill', text: 'Model ' + DATA.model_version }),
        el('span', { class: 'pill', text: DATA.universe_size + ' protocols, all covered' }),
        el('span', { class: 'pill live', text: DATA.live_size + ' live tokens set aside' })
      )
    );
  }

  function hero() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'What a protocol is worth ', el('em', { text: 'before' }), ' it has a token'),
        el('p', { class: 'tag', text: 'Every row here records no token. Its implied value is its TVL times the multiple its own sector\u2019s tokened peers command at that size \u2014 a peer anchor calibrated on the snapshot\u2019s own ' + B.peers + ' priced protocols, validated leave-one-out and walk-forward below. Growth and no-token age are small secondary tilts. It is a model, not a price, and it does not predict whether or when a token comes.' })
      ),
      el('div', { class: 'stats' },
        stat(fmtUsd(DATA.board_tvl_usd) + ' TVL', 'tracked across the board', 'good'),
        stat(String(DATA.board_size), 'pre-token rows scored'),
        stat(String(DATA.early_size), 'early finds below the floor'),
        stat(fmtRate(B.within3), 'within 3\u00d7 on held-out peers', 'market')
      )
    );
    function stat(b, s, cls) { return el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, el('b', { text: b }), el('span', { text: s })); }
  }

  function controls() {
    var every = DATA.rows.concat(DATA.live, DATA.excluded);
    var categories = Array.from(new Set(every.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(every.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var floors = TVL_FLOORS.map(function (f) {
      return [f, f === 0 ? 'Any TVL' : '$' + (f >= 1e9 ? (f / 1e9) + 'B' : f >= 1e6 ? (f / 1e6) + 'M' : f) + ' +'];
    });
    var search = el('input', { type: 'search', id: 'q', 'data-fkey': 'q', placeholder: 'Search name, sector or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render('q'); });
    function select(id, label, options, value, onChange) {
      var s = el('select', { id: id, 'data-fkey': id, 'aria-label': label }, options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(value) ? 'selected' : null }); }));
      s.addEventListener('change', function () { onChange(s.value); });
      return s;
    }
    var catSel = select('category', 'Filter by category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; writeHash(); render(); });
    var chainSel = select('chain', 'Filter by chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; writeHash(); render(); });
    var tvlSel = select('min', 'Filter by minimum TVL', floors.map(function (f) { return [String(f[0]), f[1]]; }), String(state.minTvl), function (v) { state.minTvl = Number(v) || 0; writeHash(); render(); });
    function tab(name, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () {
        if (state.tab !== name) { state.tab = name; state.sort = TAB_SORT[name]; state.dir = SORT_DEFAULT_DIR[state.sort]; }
        writeHash(); render();
      } });
    }
    var filtering = state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
    var list = state.tab === 'pre-token' ? DATA.rows : state.tab === 'live' ? DATA.live : DATA.excluded;
    var total = state.tab === 'pre-token' ? DATA.board_size : state.tab === 'live' ? DATA.live_size : DATA.excluded_size;
    var shown = rows(list).length;
    var unit = state.tab === 'pre-token' ? 'rows' : state.tab === 'live' ? 'live-token protocols' : 'kept-out products';
    var countText = filtering ? shown + ' of ' + total + ' ' + unit : total + ' ' + unit;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'min', text: 'TVL floor' }), tvlSel),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, tab('pre-token', 'Pre-token'), tab('live', 'Live token'), tab('excluded', 'Kept out'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : null },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = SORT_DEFAULT_DIR[key] ?? -1; }
        writeHash(); render();
      } }, label, active ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null)
    );
  }

  function chainChips(chains) {
    var list = chains && chains.length ? chains : [];
    var out = list.slice(0, 2).map(function (c) { return el('span', { class: 'chain', text: c }); });
    if (list.length > 2) out.push(el('span', { class: 'chain', text: '+' + (list.length - 2) }));
    if (out.length === 0) out.push(el('span', { class: 'chain', text: 'unnamed chain' }));
    return el('div', { class: 'meta' }, out);
  }

  function boardTable() {
    var list = sortedRows(rows(DATA.rows));
    if (list.length === 0) return emptyState();
    var max = list.reduce(function (m, r) { return r.implied_value_usd > m ? r.implied_value_usd : m; }, 0) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d === null ? null : r.change_7d;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('div', { class: 'meta' }, el('span', { class: 'sector', text: r.sector }), el('span', { class: 'chain', text: r.category || 'Uncategorised' })),
          chainChips(r.chains)
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (g === null ? 'na' : g >= 0 ? 'pos' : 'neg'), text: g === null ? 'n/a' : fmtPct(g) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'mult', text: fmtMult(r.peer_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ), el('div', { class: 'band', text: fmtUsd(r.band_low_usd) + ' \u2013 ' + fmtUsd(r.band_high_usd) + ' (80%)' })),
        el('td', { class: 'num odds', text: fmtRate(r.token_rate) })
      );
      tbody.appendChild(tr);
    });
    var filtering = state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
    var scope = filtering
      ? 'Showing ' + list.length + ' of ' + DATA.board_size + ' rows, ' + fmtUsd(list.reduce(function (s, r) { return s + r.tvl_usd; }, 0)) + ' of TVL, that match the filters.'
      : 'The watchlist floor is $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL; ' + DATA.early_size + ' rows sit below it as early finds.';
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. ' + scope + ' The band is the 80% conformal range; token odds are the share of that sector\u2019s protocols that already carry a token. Select a row for its peer anchor and farm plan.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          sortHeader('rank', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'No-token age'), sortHeader('peer', 'Peer \u00d7'),
          sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token odds' })
        )), tbody))
    );
  }

  function liveTable() {
    var list = sortedRows(rows(DATA.live));
    if (list.length === 0) return emptyState();
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d === null ? null : r.change_7d;
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status live', text: 'already trades' })),
        el('td', null, el('div', { class: 'proto' }, el('b', { text: r.name }),
          el('div', { class: 'meta' }, el('span', { class: 'chain', text: r.category || 'Uncategorised' })), chainChips(r.chains))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (g === null ? 'na' : g >= 0 ? 'pos' : 'neg'), text: g === null ? 'n/a' : fmtPct(g) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'mult', text: fmtMult(r.multiple) })
      ));
    });
    var filtering = state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
    var scope = filtering
      ? 'Showing ' + list.length + ' of ' + DATA.live_size + ' live-token protocols that match the filters.'
      : 'All ' + DATA.live_size + ' protocols whose token already trades, largest by market cap. These are the peer set the model is calibrated on.';
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Their market cap is a fact, not a model, so they are kept out of the pre-token ranking. ' + scope }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Status' }), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('mcap', 'Market cap'), el('th', { scope: 'col', text: 'Mcap / TVL' }))), tbody))
    );
  }

  function excludedTable() {
    var list = rows(DATA.excluded).slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1); });
    if (list.length === 0) return emptyState();
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'proto' }, el('b', { text: r.name }),
          el('div', { class: 'meta' }, el('span', { class: 'sector', text: r.category || 'Uncategorised' })), chainChips(r.chains))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'reason', text: r.reason })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'These record no token but are wrapped, staked or bridged products of a token that already trades, exchange-branded, or versioned pools \u2014 the house watchlist rule keeps them out of the ranking, so they are shown here rather than mixed in. ' + list.length + ' of ' + DATA.excluded_size + ' shown.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is kept out' }))), tbody))
    );
  }

  function emptyState() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search, the chain or the TVL floor to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
    ));
  }

  function validationTable() {
    function row(name, n, md, w2, w3) {
      return el('tr', null,
        el('td', { text: name }), el('td', { class: 'num', text: String(n) }),
        el('td', { class: 'num', text: Math.round(md * 100) + '%' }),
        el('td', { class: 'num', text: fmtRate(w2) }), el('td', { class: 'num', text: fmtRate(w3) }));
    }
    return el('table', { class: 'validation' },
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Held-out test' }), el('th', { scope: 'col', text: 'n' }),
        el('th', { scope: 'col', text: 'Median miss' }), el('th', { scope: 'col', text: 'Within 2\u00d7' }), el('th', { scope: 'col', text: 'Within 3\u00d7' }))),
      el('tbody', null,
        row('Leave-one-out (peers, excluding self)', B.n, B.mdape, B.within2, B.within3),
        row('Walk-forward (train earlier half, ' + B.wf_split + ')', B.wf_n, B.wf_mdape, B.wf_within2, B.wf_within3),
        row('Naive baseline: one global multiple', B.n, B.baseline_mdape, B.baseline_within2, B.baseline_within3)
      )
    );
  }

  function sectorTable() {
    var list = DATA.sectors.slice(0, 12);
    return el('table', { class: 'validation sectors' },
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Board rows' }),
        el('th', { scope: 'col', text: 'Tokened peers' }), el('th', { scope: 'col', text: 'Peer \u00d7 at $100M' }),
        el('th', { scope: 'col', text: 'Sector token rate' }))),
      el('tbody', null, list.map(function (s) {
        return el('tr', null,
          el('td', { text: s.category }), el('td', { class: 'num', text: String(s.rows) }),
          el('td', { class: 'num', text: String(s.peers) }), el('td', { class: 'num', text: fmtMult(s.multiple_100m) }),
          el('td', { class: 'num', text: s.token_count + ' / ' + s.token_total + ' (' + fmtRate(s.token_rate) + ')' }));
      }))
    );
  }

  function modelPanel() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the implied value is computed \u2014 and how it is validated' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every protocol. No name is special-cased, no row is hand-picked, and the page recomputes each row from the same numbers the board carries.' }),
      el('div', { class: 'formula' },
        'peer set    ', el('em', { text: String(B.peers) }), ' tokened protocols with a market cap and TVL > 0 (CEX and versioned pools excluded)', el('br'),
        'size law    log mcap = a + ', el('em', { text: B.beta.toFixed(2) }), ' \u00d7 log TVL   fitted on the peer set', el('br'),
        'peer anchor median[ log mcap \u2212 \u03b2\u00b7log TVL ] over the category\u2019s peers, shrunk toward the sector group by n/(n+' + M.shrink_k + '), then the whole pool', el('br'),
        'implied     TVL \u00d7 ', el('em', { text: 'peer multiple at this size' }), ' \u00d7 growth \u00d7 age', el('br'),
        'growth      1 + ' + M.growth_weight + ' \u00d7 clamp(change_7d, ' + M.growth_floor + ', +' + M.growth_cap + ')/100', el('br'),
        'age         ' + M.age_floor + ' + ' + M.age_range + ' \u00d7 min(age_days, ' + M.age_days + ')/' + M.age_days + '   (age unknown: ' + M.unknown_age_days + 'd)', el('br'),
        'band        80% conformal: the 10th\u201390th percentile of held-out log errors, per sector when it has 10+ peers'
      ),
      el('p', { class: 'sub', text: 'The estimator is tested on the tokened protocols themselves, never asserted. Leave-one-out predicts each peer from the others; the walk-forward split trains on the earlier half by first-listed date and tests on the later half. The peer anchor beats a single global multiple on the share of predictions within 3\u00d7.' }),
      validationTable(),
      el('p', { class: 'note', text: 'The 80% conformal band covers ' + fmtRate(B.coverage) + ' of held-out errors (global band ' + fmtMult(B.band_low) + ' \u2013 ' + fmtMult(B.band_high) + '). Rank correlation ' + B.spearman.toFixed(2) + '; ' + B.top10 + ' of the true top 10 land in the model\u2019s top 10. Market caps in this snapshot span four orders of magnitude, so a 3\u00d7 band is the honest resolution, not a price target.' }),
      el('h3', { text: 'Sector calibration' }),
      sectorTable()
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function bridgeRow(k, v, cls) {
    return el('div', { class: 'bridge-row' + (cls ? ' ' + cls : '') }, el('span', { class: 'k', text: k }), el('span'), el('b', { class: 'v' + (cls ? '' : ' num'), text: v }));
  }
  function chip(k, v) {
    return el('span', { class: 'chip' }, el('em', { text: k }), ' ', el('b', { text: v }));
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var chains = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: row.sector + ' \u00b7 ' + (row.category || 'Uncategorised') + ' \u00b7 ' + chains }),
        el('p', { class: 'detail-meta', text: 'First listed ' + (row.listed_at || 'unknown') + ' \u00b7 ' + (row.chains || []).length + ' chain' + ((row.chains || []).length === 1 ? '' : 's') + ' \u00b7 ' + row.peer_n + ' tokened peers (' + row.anchor_level + ' anchor)' }),
        el('div', { class: 'chips' },
          chip('peer \u00d7', fmtMult(row.peer_multiple)),
          chip('token odds', row.token_count + ' of ' + row.token_total + ' \u00b7 ' + fmtRate(row.token_rate)),
          chip('80% band', fmtMult(row.band_low_usd / row.implied_value_usd) + ' \u2013 ' + fmtMult(row.band_high_usd / row.implied_value_usd))
        )
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '\u2715', onclick: function () { dialog.close(); } })
    ));

    var recheck = impliedOf(row);
    var agrees = recheck === row.implied_value_usd;
    var bandPos = function (v) {
      var lo = Math.log(row.band_low_usd), hi = Math.log(row.band_high_usd);
      return hi <= lo ? 50 : Math.max(0, Math.min(100, ((Math.log(v) - lo) / (hi - lo)) * 100));
    };
    var bridge = el('div', { class: 'bridge' },
      bridgeRow('TVL', fmtUsd(row.tvl_usd)),
      bridgeRow('\u00d7 peer multiple at this size', fmtMult(row.peer_multiple)),
      el('div', { class: 'why', text: row.peer_n + ' ' + (row.category || 'uncategorised') + ' peers \u00b7 ' + row.anchor_level + ' anchor \u00b7 calibrated on the snapshot\u2019s priced protocols' }),
      bridgeRow('\u00d7 growth (' + fmtPct(row.change_7d) + ')', '\u00d7' + row.growth_mult.toFixed(3)),
      bridgeRow('\u00d7 no-token age (' + fmtAge(row.age_days) + ')', '\u00d7' + row.age_mult.toFixed(3)),
      bridgeRow('= implied value', fmtUsd(row.implied_value_usd), 'total'),
      el('div', { class: 'bandbar', title: '80% conformal band' },
        el('i', { style: 'left:' + bandPos(row.implied_value_usd).toFixed(1) + '%' }),
        el('span', { class: 'lo', text: 'low ' + fmtUsd(row.band_low_usd) }),
        el('span', { class: 'hi', text: 'high ' + fmtUsd(row.band_high_usd) })
      ),
      el('p', { class: 'note', text: '80% conformal band. Model ' + DATA.model_version + '. ' + (agrees ? 'Recomputed in the page and matches board.json exactly.' : 'Recomputed as ' + fmtUsd(recheck) + ', which differs from the board.') + ' An estimate, not a price and not a prediction that a token comes.' })
    );
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'Implied value' }), bridge));

    var planRows = row.farm_steps || [];
    var headline = { capital: 'n/a', weekly: 'n/a', hold: 'n/a' };
    planRows.forEach(function (s) {
      if (/^Fund that wallet/.test(s)) { var m = s.match(/\$(\d[\d,]*)\s*of capital/); if (m) headline.capital = '$' + m[1]; }
      if (/^Make one qualifying action each week/.test(s)) { var g = s.match(/\$[\d.]+ a week/); if (g) headline.weekly = g[0].replace(' a week', ''); var h = s.match(/at least (\d+) days/); if (h) headline.hold = h[1] + ' days'; }
    });
    var planSummary = el('div', { class: 'plan-summary' },
      el('span', { class: 'tag cost', text: 'Capital ' + headline.capital }),
      el('span', { class: 'tag time', text: 'About ' + headline.weekly + ' a week in gas' }),
      el('span', { class: 'tag time', text: 'Hold ' + headline.hold })
    );
    var steps = el('ol', { class: 'steps' }, planRows.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var act = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 7) : '';
      var cost = tail, time = '';
      var t = tail.indexOf(' Time: ');
      if (t >= 0) { cost = tail.slice(0, t); time = tail.slice(t + 7).replace(/\.$/, ''); }
      return el('li', null, el('div', null,
        el('div', { class: 'act', text: act.replace(/\.$/, '') }),
        el('div', { class: 'tags' },
          el('span', { class: 'tag cost', text: cost.replace(/\.$/, '') }),
          time ? el('span', { class: 'tag time', text: time }) : null)
      ));
    }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Costed from this protocol\u2019s category, chains, TVL and age: capital scales with TVL and the chain\u2019s gas, the hold window with how young it is.' }),
      planSummary, steps
    ));

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source }),
      el('span', { text: 'Implied value is this board\u2019s own claim, derived from the snapshot figures \u2014 never a price.' })
    );
  }

  function render(focusKey) {
    var active = document.activeElement;
    var fkey = focusKey || (active && active.getAttribute && active.getAttribute('data-fkey'));
    var caret = null;
    if (active && typeof active.selectionStart === 'number') caret = active.selectionStart;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'live' ? liveTable() : excludedTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (dialog.open) dialog.close();
    if (fkey) {
      var next = app.querySelector('[data-fkey="' + fkey + '"]');
      if (next) {
        next.focus();
        if (caret !== null && typeof next.setSelectionRange === 'function') {
          try { next.setSelectionRange(caret, caret); } catch (e) { /* not a text control */ }
        }
      }
    }
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
