// Token Radar v2 dashboard. Reads window.RADAR (written beside this folder by main.ts) and renders
// the ranked board, a sortable + filterable table, and a per-protocol detail drawer with the model's
// own inputs, the value bridge and the farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var app = document.getElementById('board');
  // The TVL floors the page offers, shared by the control and the hash reader so a link can only
  // carry a floor the page itself names.
  var TVL_FLOORS = [0, 5e7, 1e8, 2.5e8, 1e9];
  // Which way each sort starts: numbers and name run strongest-first or A-first per column.
  var SORT_DEFAULT_DIR = { implied: -1, rank: -1, tvl: -1, growth: -1, age: -1, sector: -1, name: 1, mcap: -1 };
  // The sort each view opens on: the board by implied value, the live set by market cap.
  var TAB_SORT = { 'pre-token': 'implied', live: 'mcap' };
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
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model, recomputed in the page from the same raw snapshot figures the board used, so the
  // code and the board are visibly and exactly the same arithmetic. It deliberately does not reuse
  // the row's stored multipliers: those are rounded for display, and multiplying the rounded values
  // drifts from the implied value board.json carries.
  function factorsOf(r) {
    var growth = clampPct(r);
    var momentum = 1 + (growth / 100) * M.momentum_weight;
    var age = r.age_days === null || r.age_days === undefined ? M.unknown_age_days : r.age_days;
    var dry = M.dryspell_floor + (Math.min(Math.max(age, 0), M.dryspell_days) / M.dryspell_days) * M.dryspell_range;
    var chains = r.chains && r.chains.length > 0 ? r.chains.length : 1;
    var reach = M.reach_floor + M.reach_step * Math.min(chains, M.reach_max_chains);
    return { growth: growth, momentum: momentum, dry: dry, reach: reach, chains: chains };
  }
  function impliedOf(r) {
    var f = factorsOf(r);
    return Math.max(1, Math.round(r.tvl_usd * r.base * r.sector_multiple * f.momentum * f.dry * f.reach));
  }
  function clampPct(r) {
    var g = r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d;
    return Math.min(M.momentum_cap, Math.max(M.momentum_floor, g));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // URL hash <-> state, so a filtered or detail view can be linked and screenshotted. The state is
  // reset to its defaults first, so the hash is the whole truth and every link is reproducible.
  // Every value is validated: a hash naming an unknown floor, sort or tab falls back to a default
  // rather than putting the page in a state no control can show.
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0;
    state.tab = 'pre-token'; state.sort = 'implied'; state.dir = -1; state.selected = null;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('min')) {
      var min = Number(p.get('min'));
      state.minTvl = TVL_FLOORS.indexOf(min) >= 0 ? min : 0;
    }
    if (p.get('tab') === 'live') state.tab = 'live';
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
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // Whether one row clears the search, category, chain and TVL-floor filters. Shared by both views
  // so the controls mean the same thing on the pre-token board and the live-token set.
  function passesFilters(r, q) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.minTvl && r.tvl_usd < state.minTvl) return false;
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, r.sector, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) { return passesFilters(r, q); });
  }
  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) { return passesFilters(r, q); });
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
      else if (key === 'sector') { av = a.sector_multiple; bv = b.sector_multiple; }
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
          el('div', { class: 'brand-sub', text: 'pre-token protocol scanner' })
        )
      ),
      el('div', { class: 'pills' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'pill', text: 'Model ' + DATA.model_version }),
        el('span', { class: 'pill', text: DATA.board_size + ' pre-token rows' }),
        el('span', { class: 'pill live', text: DATA.live_size + ' live tokens set aside' })
      )
    );
  }

  function hero() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, 'What a protocol is worth ', el('em', { text: 'before' }), ' it has a token'),
        el('p', { class: 'tag', text: 'Every protocol here records no token yet. The board ranks them by an implied value built from their own figures — the capital they hold, their seven-day growth, how long they have run without a token, the sector they sit in and how many chains they reach. It is a model, not a price, and it does not predict whether or when a token comes.' })
      ),
      el('div', { class: 'stats' },
        stat(fmtUsd(DATA.board_tvl_usd) + ' TVL', 'tracked across the board', 'good'),
        stat(String(DATA.board_size), 'pre-token rows scored'),
        stat(String(DATA.early_size), 'early finds below the floor'),
        stat(String(DATA.live_size), 'live tokens set aside', 'market')
      )
    );
    function stat(b, s, cls) { return el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, el('b', { text: b }), el('span', { text: s })); }
  }

  function controls() {
    // The category and chain options cover both views, so a filter can name a category or a chain
    // that only the live-token set carries.
    var every = DATA.rows.concat(DATA.live);
    var categories = Array.from(new Set(every.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(every.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var floors = TVL_FLOORS.map(function (f) {
      return [f, f === 0 ? 'Any TVL' : '$' + (f >= 1e9 ? (f / 1e9) + 'B' : f >= 1e6 ? (f / 1e6) + 'M' : f) + ' +'];
    });
    var search = el('input', { type: 'search', id: 'q', 'data-fkey': 'q', placeholder: 'Search name, sector, category or chain', value: state.q, 'aria-label': 'Search the board' });
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
        // Each view keeps its own sort: moving between them opens on that view's own column rather
        // than carrying a sort the other table does not have.
        if (state.tab !== name) { state.tab = name; state.sort = TAB_SORT[name]; state.dir = SORT_DEFAULT_DIR[state.sort]; }
        writeHash(); render();
      } });
    }
    var filtering = state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
    var shown = state.tab === 'pre-token' ? rows().length : liveRows().length;
    var countText;
    if (state.tab === 'pre-token') {
      countText = filtering ? shown + ' of ' + DATA.board_size + ' rows' : DATA.board_size + ' rows';
    } else {
      countText = filtering ? shown + ' of ' + DATA.live_size + ' live-token protocols' : DATA.live_size + ' live-token protocols';
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'min', text: 'TVL floor' }), tvlSel),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'Token status' }), el('div', { class: 'tabs' }, tab('pre-token', 'Pre-token'), tab('live', 'Live token'))),
      el('span', { class: 'count', text: countText })
    );
  }

  function sortHeader(key, label) {
    var active = state.sort === key;
    return el('th', { scope: 'col', 'aria-sort': active ? (state.dir < 0 ? 'descending' : 'ascending') : null },
      el('button', { type: 'button', onclick: function () {
        // Clicking a new column starts it at that column's own default direction; clicking the
        // active one reverses it.
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = SORT_DEFAULT_DIR[key] ?? -1; }
        writeHash(); render();
      } },
        label, active ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
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
    var list = sortedRows(rows());
    if (list.length === 0) return emptyState();
    // Bars scale against the strongest implied value in the filtered set, not against whichever row
    // the current sort happens to put first: under a name or age sort the top row is rarely the
    // largest, and every other bar would collapse to the floor.
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
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'mult', text: '×' + r.sector_multiple.toFixed(2) }),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'Pre-token protocols, strongest implied value first. The watchlist floor is $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL; ' + DATA.early_size + ' rows sit below it as early finds. Select a row for its value bridge and farm plan.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          sortHeader('rank', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('age', 'No-token age'), sortHeader('implied', 'Implied value'),
          sortHeader('sector', 'Sector ×'), el('th', { scope: 'col', text: 'Token' })
        )), tbody))
    );
  }

  // The live-token rows, ordered by the page's sort. A row with no market cap sorts as if it had
  // none, so it never outranks one the market actually prices.
  function sortedLive(list) {
    var key = state.sort, dir = state.dir;
    var allowed = { name: 1, tvl: 1, growth: 1, mcap: 1 };
    if (!allowed[key]) { key = 'mcap'; dir = -1; }
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else { av = a.mcap_usd === null ? -Infinity : a.mcap_usd; bv = b.mcap_usd === null ? -Infinity : b.mcap_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function liveTable() {
    var list = sortedLive(liveRows());
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
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    var filtering = state.q.trim() !== '' || state.category !== 'all' || state.chain !== 'all' || state.minTvl !== 0;
    var scope = filtering
      ? 'Showing ' + list.length + ' of ' + DATA.live_size + ' live-token protocols that match the filters.'
      : 'The ' + DATA.live_size + ' shown are the largest by market cap.';
    return el('div', { class: 'panel' },
      el('div', { class: 'caption', text: 'These protocols already have a token that trades, so their market cap is a fact, not a model. They are kept out of the pre-token ranking so the two are never mixed. ' + scope }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Status' }), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'), sortHeader('mcap', 'Market cap'))), tbody))
    );
  }

  function emptyState() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search, the chain or the TVL floor to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
    ));
  }

  function sectorLegend() {
    // One chip per distinct sector bucket the board actually carries, keyed on the label and its
    // multiple together: a label that two categories reach at different multiples would otherwise
    // show only whichever category the first row happened to carry.
    var seen = new Map();
    DATA.rows.forEach(function (r) {
      var key = r.sector + '\u0000' + r.sector_multiple;
      if (!seen.has(key)) seen.set(key, { sector: r.sector, mult: r.sector_multiple });
    });
    var chips = Array.from(seen.values()).sort(function (a, b) { return b.mult - a.mult || (a.sector < b.sector ? -1 : 1); })
      .map(function (e) { return el('span', { class: 'sector', text: e.sector + ' ×' + e.mult.toFixed(2) }); });
    return el('div', { class: 'legend' }, chips);
  }

  function modelPanel() {
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How the implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot figures scores every protocol. No name is special-cased, no row is hand-picked, and the page recomputes each row from the same numbers the board carries.' }),
      el('div', { class: 'formula' },
        'scale        = tvl_usd', el('br'),
        'sector       = ', el('em', { text: 'SECTOR[category]' }), '                     0.78 … 1.42', el('br'),
        'momentum     = 1 + clamp(change_7d, ' + M.momentum_floor + ', ' + M.momentum_cap + ')/100 × ' + M.momentum_weight, el('br'),
        'dry-spell    = ' + M.dryspell_floor + ' + ' + M.dryspell_range + ' × min(age_days, ' + M.dryspell_days + ')/' + M.dryspell_days + '   (age unknown: ' + M.unknown_age_days + 'd)', el('br'),
        'reach        = ' + M.reach_floor + ' + ' + M.reach_step + ' × min(chains, ' + M.reach_max_chains + ')', el('br'),
        'implied      = max(1, round(scale × ', el('em', { text: String(M.base) }), ' × sector × momentum × dry-spell × reach))'
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth and the chain count come straight from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token — and a longer dry spell scores higher. The sector table below is keyed on the category string, never on a protocol name.' }),
      sectorLegend()
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function bridgeRow(k, v, cls) {
    return el('div', { class: 'bridge-row' + (cls ? ' ' + cls : '') }, el('span', { class: 'k', text: k }), el('span'), el('b', { class: 'v' + (cls ? '' : ' num'), text: v }));
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
        el('p', { class: 'sub', text: (row.sector) + ' · ' + (row.category || 'Uncategorised') + ' · ' + chains })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })
    ));

    var recheck = impliedOf(row);
    var agrees = recheck === row.implied_value_usd;
    var f = factorsOf(row);
    var bridge = el('div', { class: 'bridge' },
      bridgeRow('TVL', fmtUsd(row.tvl_usd)),
      bridgeRow('× base', String(row.base)),
      bridgeRow('× sector (' + row.sector + ')', '×' + row.sector_multiple.toFixed(2)),
      bridgeRow('× momentum (' + fmtPct(f.growth) + ')', '×' + f.momentum.toFixed(4)),
      bridgeRow('× dry-spell (' + fmtAge(row.age_days) + ')', '×' + f.dry.toFixed(4)),
      bridgeRow('× reach (' + f.chains + ' chain' + (f.chains === 1 ? '' : 's') + ')', '×' + f.reach.toFixed(4)),
      bridgeRow('Implied value', fmtUsd(row.implied_value_usd), 'total'),
      el('div', { class: 'why', text: agrees
        ? 'The page recomputes this row as ' + fmtUsd(recheck) + ', the same number board.json carries.'
        : 'The page recomputes this row as ' + fmtUsd(recheck) + ', which differs from the board — the data would be stale.' })
    );
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }), bridge,
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + '. This is an estimate of what the protocol could be worth if its record stayed as it is, not a price and not a prediction that a token comes.' })
    ));

    var facts = el('div', { class: 'facts' },
      fact('TVL', fmtUsd(row.tvl_usd)),
      fact('7-day growth', fmtPct(row.change_7d)),
      fact('No-token age', fmtAge(row.age_days)),
      fact('First listed', row.listed_at || 'unknown'),
      fact('Chains', String((row.chains || []).length)),
      fact('Sector multiple', '×' + row.sector_multiple.toFixed(2))
    );
    function fact(k, v) { return el('div', { class: 'fact' }, el('span', { text: k }), el('b', { text: v })); }
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'On the record' }), facts));

    // Pull the plan's own headline numbers out of the steps the model wrote, so a reader sees what
    // it costs and how long it takes before reading the prose: the capital the funding step names,
    // the weekly gas the maintenance step names, and the hold window the hold step names.
    var planRows = row.farm_steps || [];
    var headline = { capital: 'n/a', weekly: 'n/a', hold: 'n/a' };
    planRows.forEach(function (s) {
      if (/^Fund that wallet/.test(s)) {
        var m = s.match(/\$(\d[\d,]*)\s*of capital/);
        if (m) headline.capital = '$' + m[1];
      }
      if (/^Make one qualifying action each week/.test(s)) {
        var g = s.match(/about (.+?) a week/);
        if (g) headline.weekly = g[1].replace(/\.$/, '');
      }
      if (/^Hold the position for at least/.test(s)) {
        var h = s.match(/at least (\d+) days/);
        if (h) headline.hold = h[1] + ' days';
      }
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
      el('p', { class: 'sub', text: 'Derived from this protocol\'s category, chains, TVL and age: capital scales with the TVL, gas with the chain, and the hold window with how young it is. Costs are estimates.' }),
      planSummary,
      steps
    ));

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source }),
      el('span', { text: 'Implied value is this board\'s own claim, derived from the snapshot figures — never a price.' })
    );
  }

  function render(focusKey) {
    // The controls are rebuilt each render, so an active element would lose focus. Carry the
    // focused control and its caret across the rebuild (used by the search box, which re-renders
    // on every keystroke).
    var active = document.activeElement;
    var fkey = focusKey || (active && active.getAttribute && active.getAttribute('data-fkey'));
    var caret = null;
    if (active && typeof active.selectionStart === 'number') caret = active.selectionStart;
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(hero());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
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