"use strict";
// Dota2 战绩查询 - 前端（原生 JS，零依赖）
// 数据来源：GET /api/player/{id}/summary（服务端聚合 profile/wl/matches/peers）
// 英雄表：本地静态 heroes-zh.json（id/key/en/zh），图标走 NAS 本地代理 /img/hero/{key}.png

var HERO = {};
var ICON = "/img/hero/";
var RANKS = ["", "先锋", "卫士", "中军", "统帅", "传奇", "万古流芳", "超凡入圣", "冠绝一世"];
var MODES = { 1: "全阶英雄", 2: "队长模式", 3: "随机征召", 4: "单一征召", 5: "全部随机", 16: "队长征召", 18: "技能征召", 22: "全英雄选择", 23: "加速模式" };
var PAGE = 20;

var state = { id: null, data: null, tab: "matches", filter: "all", shown: PAGE, heroSort: "games", heroQ: "", cmpId: "" };

function $(s) { return document.querySelector(s); }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
function pct(w, n) { return n ? (w / n * 100) : 0; }
function isWin(m) { return (m.player_slot < 128) === m.radiant_win; }
function rankName(t) { if (!t) return "未定级"; var n = Math.floor(t / 10), s = t % 10; return RANKS[n] + (n < 8 && s ? " " + s : ""); }
function dur(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function ago(ts) {
  var d = Date.now() / 1000 - ts;
  if (d < 3600) return Math.max(1, Math.floor(d / 60)) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  if (d < 86400 * 30) return Math.floor(d / 86400) + " 天前";
  var t = new Date(ts * 1000); return t.getFullYear() + "-" + (t.getMonth() + 1) + "-" + t.getDate();
}
function heroCell(id, sub) {
  var h = HERO[id] || { key: "", en: "Unknown", zh: "未知英雄" };
  // 固定宽高防止布局抖动；loading=lazy 只加载进入视口的图标；decoding=async 不阻塞主线程
  return '<div class="hero"><img src="' + ICON + h.key + '.png" width="32" height="32" loading="lazy" decoding="async" alt="" data-zh="' + esc(h.zh.charAt(0)) + '">' +
    '<div class="n">' + esc(h.zh) + '<small>' + (sub || esc(h.en)) + '</small></div></div>';
}
function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, 2200); }

// 图片失败 → 中文首字占位（捕获阶段监听，一个监听器覆盖全部图片）
document.addEventListener("error", function (e) {
  var img = e.target;
  if (img.tagName !== "IMG" || !img.dataset.zh) return;
  var ph = document.createElement("span"); ph.className = "ph"; ph.textContent = img.dataset.zh;
  img.replaceWith(ph);
}, true);

// 英雄表：本地静态文件；个别新英雄未收录时回退显示英文名
function loadHeroes() {
  return fetch("heroes-zh.json").then(function (r) { return r.json(); }).then(function (list) {
    list.forEach(function (h) { HERO[h.id] = { key: h.key, en: h.en, zh: h.zh }; });
  });
}

function fetchPlayer(id) {
  return fetch("/api/player/" + id + "/summary").then(function (r) {
    return r.json().then(function (d) {
      if (!r.ok) throw new Error(d.error || ("请求失败（HTTP " + r.status + "）"));
      if (d.profile && (d.profile.error || !d.profile.profile)) throw new Error("找不到该玩家，请检查 ID（若玩家未公开比赛数据则无法查询）");
      return d;
    });
  });
}

function load(id) {
  id = String(id).trim();
  if (!/^\d{1,12}$/.test(id)) { toast("请输入纯数字的 Account ID"); return; }
  state.id = id; state.data = null; state.shown = PAGE;
  $("#q").value = id;
  $("#player").innerHTML = '<div class="skel" style="height:96px"></div>';
  $("#panel").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  syncHash();
  fetchPlayer(id).then(function (d) {
    if (state.id !== id) return; // 用户已切换到别的 ID，丢弃过期结果
    state.data = d; renderPlayer(); renderPanel();
  }, function (err) {
    $("#player").innerHTML = ""; $("#panel").innerHTML = '<div class="error">' + esc(err.message) + '</div>';
  });
}

function renderPlayer() {
  var d = state.data, p = d.profile.profile, n = (d.wl.win || 0) + (d.wl.lose || 0);
  var recent = (d.matches || []).slice(0, 20), rw = recent.filter(isWin).length;
  var avatar = p.avatarfull
    ? '<img class="avatar" src="' + esc(p.avatarfull) + '" width="64" height="64" loading="lazy" decoding="async" alt="" data-zh="' + esc((p.personaname || "?").charAt(0)) + '">'
    : '<div class="avatar">' + esc((p.personaname || "?").charAt(0)) + '</div>';
  $("#player").innerHTML =
    '<div class="player">' + avatar +
    '<div><h1>' + esc(p.personaname || "未知玩家") + '</h1><div class="sub">ID ' + esc(state.id) + '</div><span class="rank">' + rankName(d.profile.rank_tier) + '</span></div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="v">' + n.toLocaleString() + '</div><div class="k">总场次</div></div>' +
      '<div class="stat"><div class="v"><span class="win">' + (d.wl.win || 0) + '</span> / <span class="lose">' + (d.wl.lose || 0) + '</span></div><div class="k">胜 / 负</div></div>' +
      '<div class="stat"><div class="v">' + pct(d.wl.win || 0, n).toFixed(1) + '%</div><div class="k">总胜率</div></div>' +
      '<div class="stat"><div class="v ' + (rw >= 10 ? "win" : "lose") + '">' + rw + '-' + (20 - rw) + '</div><div class="k">近 20 场</div></div>' +
    '</div></div>';
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("#tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === tab); });
  syncHash();
  if (state.data) renderPanel();
}

function renderPanel() {
  var f = { matches: renderMatches, heroes: renderHeroes, peers: renderPeers, compare: renderCompare }[state.tab];
  f();
}

function renderMatches() {
  var all = state.data.matches || [];
  var list = all.filter(function (m) { return state.filter === "all" || (state.filter === "w") === isWin(m); });
  var rows = list.slice(0, state.shown).map(function (m) {
    var w = isWin(m), mode = MODES[m.game_mode] || "其他模式";
    return '<div class="row m-row ' + (w ? "w" : "l") + '"><div class="bar"></div>' +
      heroCell(m.hero_id, '<span class="mob">' + ago(m.start_time) + ' · ' + dur(m.duration) + ' · </span>' + mode) +
      '<div class="res ' + (w ? "win" : "lose") + '">' + (w ? "胜利" : "失败") + '</div>' +
      '<div class="kda"><b>' + m.kills + '</b> / <b class="lose">' + m.deaths + '</b> / <b>' + m.assists + '</b></div>' +
      '<div class="dur muted">' + dur(m.duration) + '</div>' +
      '<div class="when muted">' + ago(m.start_time) + '</div></div>';
  }).join("");
  $("#panel").innerHTML =
    '<div class="toolbar">' + chip("all", "全部") + chip("w", "胜利") + chip("l", "失败") +
    '<span class="spacer"></span><span class="note">最近 ' + all.length + ' 场</span></div>' +
    '<div class="list"><div class="row head m-row"><div></div><div>英雄 / 模式</div><div>结果</div><div>击杀 / 死亡 / 助攻</div><div>时长</div><div>时间</div></div>' +
    (rows || '<div class="empty">没有符合条件的比赛</div>') + '</div>' +
    (list.length > state.shown ? '<button class="btn more" id="more">加载更多（还有 ' + (list.length - state.shown) + ' 场）</button>' : "");
  function chip(v, t) { return '<button class="chip" data-filter="' + v + '" aria-pressed="' + (state.filter === v) + '">' + t + '</button>'; }
}

function heroStats(matches) {
  var by = {};
  matches.forEach(function (m) {
    var s = by[m.hero_id] || (by[m.hero_id] = { id: m.hero_id, games: 0, win: 0, k: 0, d: 0, a: 0 });
    s.games++; if (isWin(m)) s.win++; s.k += m.kills; s.d += m.deaths; s.a += m.assists;
  });
  return Object.keys(by).map(function (k) {
    var s = by[k]; s.wr = pct(s.win, s.games); s.kda = (s.k + s.a) / Math.max(1, s.d); return s;
  });
}

function renderHeroes() {
  var q = state.heroQ.trim().toLowerCase();
  var list = heroStats(state.data.matches || []).filter(function (s) {
    var h = HERO[s.id]; return !q || (h && (h.zh.indexOf(q) >= 0 || h.en.toLowerCase().indexOf(q) >= 0));
  });
  var key = state.heroSort;
  list.sort(function (a, b) { return b[key] - a[key] || b.games - a.games; });
  var rows = list.map(function (s) {
    return '<div class="row h-row">' + heroCell(s.id) +
      '<div class="c-g">' + s.games + ' 场</div>' +
      '<div class="wr"><div class="track"><div class="fill' + (s.wr < 50 ? " low" : "") + '" style="width:' + s.wr + '%"></div></div><span>' + s.wr.toFixed(0) + '%</span></div>' +
      '<div class="c-kda">' + s.kda.toFixed(2) + '</div>' +
      '<div class="c-n muted">' + (s.k / s.games).toFixed(1) + '/' + (s.d / s.games).toFixed(1) + '/' + (s.a / s.games).toFixed(1) + '</div></div>';
  }).join("");
  $("#panel").innerHTML =
    '<div class="toolbar"><input class="input" id="hq" placeholder="搜索英雄（中文或英文）" value="' + esc(state.heroQ) + '" style="max-width:240px">' +
    '<select class="input" id="hs" style="flex:none;width:auto">' +
      opt("games", "按场次") + opt("wr", "按胜率") + opt("kda", "按 KDA") + '</select>' +
    '<span class="spacer"></span><span class="note">基于最近 ' + (state.data.matches || []).length + ' 场</span></div>' +
    '<div class="list"><div class="row head h-row"><div>英雄</div><div>场次</div><div>胜率</div><div>KDA</div><div>场均 K/D/A</div></div>' +
    (rows || '<div class="empty">没有匹配的英雄</div>') + '</div>';
  function opt(v, t) { return '<option value="' + v + '"' + (key === v ? " selected" : "") + '>' + t + '</option>'; }
}

function renderPeers() {
  var peers = (state.data.peers || []).slice().sort(function (a, b) { return b.with_games - a.with_games; });
  var rows = peers.map(function (p) {
    var wr = pct(p.with_win, p.with_games);
    return '<div class="row p-row"><div class="p-name">' + esc(p.personaname || "未知玩家") + '<div class="muted">ID ' + p.account_id + '</div></div>' +
      '<div class="c-g">同队 ' + p.with_games + ' 场</div>' +
      '<div class="wr"><div class="track"><div class="fill' + (wr < 50 ? " low" : "") + '" style="width:' + wr + '%"></div></div><span>' + wr.toFixed(0) + '%</span></div>' +
      '<div class="c-ag muted">对抗 ' + (p.against_games || 0) + ' 场</div>' +
      '<div class="c-act"><button class="btn" data-cmp="' + p.account_id + '">对比</button></div></div>';
  }).join("");
  $("#panel").innerHTML =
    '<div class="toolbar"><span class="note">按同队场次排序；胜率为同队胜率</span></div>' +
    '<div class="list"><div class="row head p-row"><div>队友</div><div>同队场次</div><div>同队胜率</div><div>对抗</div><div></div></div>' +
    (rows || '<div class="empty">暂无队友数据</div>') + '</div>';
}

function summary(d) {
  var ms = (d.matches || []).slice(0, 50), n = (d.wl.win || 0) + (d.wl.lose || 0), w = ms.filter(isWin).length, k = 0, de = 0, a = 0, t = 0;
  ms.forEach(function (m) { k += m.kills; de += m.deaths; a += m.assists; t += m.duration; });
  var top = heroStats(ms).sort(function (x, y) { return y.games - x.games; }).slice(0, 3);
  return { name: d.profile.profile.personaname, rank: rankName(d.profile.rank_tier), rt: d.profile.rank_tier || 0, n: n, wr: pct(d.wl.win || 0, n), rwr: pct(w, ms.length), kda: (k + a) / Math.max(1, de), dur: t / Math.max(1, ms.length), top: top };
}

function renderCompare() {
  var html = '<form class="toolbar" id="cmpf"><input class="input" id="cq" inputmode="numeric" placeholder="对比对象的 Account ID" value="' + esc(state.cmpId) + '" style="max-width:260px"><button class="btn primary">对比</button><span class="note">也可在「队友」页点「对比」</span></form><div id="cmpout"></div>';
  $("#panel").innerHTML = html;
  if (state.cmpId) runCompare();
  else $("#cmpout").innerHTML = '<div class="empty">输入另一位玩家的 ID 开始对比</div>';
}

function runCompare() {
  var id = state.cmpId, out = $("#cmpout");
  out.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  // A 方复用已加载的 summary，只为 B 发 1 个请求（同一聚合 key，服务端缓存可命中）
  fetchPlayer(id).then(function (bd) {
    if (state.tab !== "compare" || state.cmpId !== id) return;
    var A = summary(state.data), B = summary(bd);
    function line(lbl, a, b, fmt, higher) {
      var ca = "", cb = "";
      if (higher !== null && a !== b) { if ((a > b) === higher) ca = " better"; else cb = " better"; }
      return '<div class="a' + ca + '">' + fmt(a) + '</div><div class="lbl">' + lbl + '</div><div class="b' + cb + '">' + fmt(b) + '</div>';
    }
    function tops(s) { return '<div class="heroes">' + s.top.map(function (h) { return heroCell(h.id, h.games + " 场"); }).join("") + '</div>'; }
    out.innerHTML = '<div class="cmp">' +
      '<div class="a top">' + esc(A.name) + '</div><div class="lbl top">VS</div><div class="b top">' + esc(B.name) + '</div>' +
      line("段位", A.rt, B.rt, function (v) { return rankName(v); }, true) +
      line("总场次", A.n, B.n, function (v) { return v.toLocaleString(); }, null) +
      line("总胜率", A.wr, B.wr, function (v) { return v.toFixed(1) + "%"; }, true) +
      line("近 50 场胜率", A.rwr, B.rwr, function (v) { return v.toFixed(0) + "%"; }, true) +
      line("近 50 场 KDA", A.kda, B.kda, function (v) { return v.toFixed(2); }, true) +
      line("平均时长", A.dur, B.dur, function (v) { return dur(Math.round(v)); }, null) +
      '<div class="a">' + tops(A) + '</div><div class="lbl">常用英雄</div><div class="b">' + tops(B) + '</div>' +
      '</div>';
  }, function (err) { out.innerHTML = '<div class="error">' + esc(err.message) + '</div>'; });
}

// 事件委托：面板重绘时无需重复绑定
$("#panel").addEventListener("click", function (e) {
  var t = e.target.closest("button"); if (!t) return;
  if (t.dataset.filter) { state.filter = t.dataset.filter; state.shown = PAGE; renderMatches(); }
  else if (t.id === "more") { state.shown += PAGE; renderMatches(); }
});
$("#panel").addEventListener("input", function (e) {
  if (e.target.id === "hq") {
    state.heroQ = e.target.value; var pos = e.target.selectionStart;
    renderHeroes(); var el = $("#hq"); el.focus(); el.setSelectionRange(pos, pos);
  }
});
$("#panel").addEventListener("change", function (e) { if (e.target.id === "hs") { state.heroSort = e.target.value; renderHeroes(); } });
$("#panel").addEventListener("submit", function (e) {
  if (e.target.id !== "cmpf") return;
  e.preventDefault(); state.cmpId = $("#cq").value.trim(); if (state.cmpId) runCompare();
});
document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-cmp]"); if (!t) return;
  state.cmpId = t.dataset.cmp; setTab("compare");
});
$("#tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });
$("#search").addEventListener("submit", function (e) { e.preventDefault(); load($("#q").value); });
$("#refresh").addEventListener("click", function () {
  if (!state.id) return;
  fetch("/api/od/players/" + state.id + "/refresh", { method: "POST" }).catch(function () {});
  toast("已请求 OpenDota 重新解析，约 1–2 分钟后再刷新可见新比赛");
});

// 地址栏同步：#/139369436/heroes，可收藏、可分享、刷新不丢状态
function syncHash() { if (state.id) history.replaceState(null, "", "#/" + state.id + "/" + state.tab); }
(function init() {
  loadHeroes().catch(function () { toast("英雄表加载失败，英雄名将显示英文"); });
  var m = location.hash.match(/^#\/(\d+)(?:\/(\w+))?/);
  var tab = m && m[2] && /^(matches|heroes|peers|compare)$/.test(m[2]) ? m[2] : "matches";
  setTab(tab);
  if (m) load(m[1]);
  else $("#panel").innerHTML = '<div class="empty">输入 Account ID 开始查询（例如 Steam32 数字 ID）</div>';
})();
