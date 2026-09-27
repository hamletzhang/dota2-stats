/* 个人 Dota2 战绩查询 - 前端逻辑 */
'use strict';

const $ = (id) => document.getElementById(id);
const OD = '/api/od/';
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com';

// ---------- 全局状态 ----------
let heroMap = {};            // hero_id -> {localized_name, img}
let currentId = null;
let currentMatches = [];     // 最近 100 场比赛
let currentPeers = [];
let filterDays = 30;         // 时间筛选：7/30/90/0（0 = 近100场）
let activeTab = 'matches';

// ---------- 工具 ----------
async function api(path) {
  const r = await fetch(OD + path);
  if (!r.ok) throw new Error(`请求失败 (${r.status})`);
  return r.json();
}
function setStatus(msg, isError) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'status' + (isError ? ' error' : '');
}
function timeAgo(ts) {
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}
function fmtDuration(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function isWin(m) {
  const radiant = m.player_slot < 128;
  return radiant === !!m.radiant_win;
}
function heroName(id) { return heroMap[id] ? heroMap[id].localized_name : '英雄#' + id; }
function heroImg(id, cls) {
  const h = heroMap[id];
  return h ? `<img src="${STEAM_CDN}${h.img}" alt="${h.localized_name}" loading="lazy">` : '';
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const RANK_NAMES = { 1: '先锋', 2: '卫士', 3: '十字军', 4: '执政官', 5: '传奇', 6: '万古流芳', 7: '超凡入圣', 8: '冠绝一世' };
function rankText(rt) {
  if (!rt) return '未定级';
  const tier = Math.floor(rt / 10), star = rt % 10;
  if (tier === 8) return '冠绝一世';
  return `${RANK_NAMES[tier] || '?'} ${star}星`;
}

// ---------- 常用玩家（localStorage） ----------
function getSaved() {
  try { return JSON.parse(localStorage.getItem('savedPlayers') || '[]'); } catch { return []; }
}
function setSaved(list) { localStorage.setItem('savedPlayers', JSON.stringify(list)); }
function renderSaved() {
  const list = getSaved();
  $('savedPlayers').innerHTML = list.map(p => `
    <span class="chip" data-id="${p.account_id}">
      <img src="${p.avatar || ''}" onerror="this.style.display='none'">
      <span>${esc(p.name)}</span>
      <span class="del" data-del="${p.account_id}" title="移除">×</span>
    </span>`).join('');
  const sel = $('compareSelect');
  sel.innerHTML = '<option value="">选择已保存的玩家…</option>' +
    list.filter(p => String(p.account_id) !== String(currentId))
        .map(p => `<option value="${p.account_id}">${esc(p.name)}</option>`).join('');
  updateSaveBtn();
}
function updateSaveBtn() {
  const btn = $('saveBtn');
  const saved = getSaved().some(p => String(p.account_id) === String(currentId));
  btn.textContent = saved ? '★ 已保存' : '☆ 保存';
  btn.className = 'mini-btn' + (saved ? ' saved' : '');
}

// ---------- 英雄常量 ----------
async function loadHeroes() {
  const cached = localStorage.getItem('heroMap');
  if (cached) {
    try { heroMap = JSON.parse(cached); return; } catch { /* ignore */ }
  }
  const heroes = await api('heroes');
  heroMap = {};
  for (const h of heroes) heroMap[h.id] = { localized_name: h.localized_name, img: h.img };
  localStorage.setItem('heroMap', JSON.stringify(heroMap));
}

// ---------- 主查询 ----------
async function loadPlayer(id) {
  id = String(id).trim();
  if (!/^\d+$/.test(id)) { setStatus('请输入正确的数字 Account ID', true); return; }
  currentId = id;
  setStatus('加载中…');
  try {
    await loadHeroes();
    const [profile, wl, matches, peers] = await Promise.all([
      api(`players/${id}`),
      api(`players/${id}/wl`),
      api(`players/${id}/matches?limit=100`),
      api(`players/${id}/peers`),
    ]);
    if (profile.error || !profile.profile) throw new Error('找不到该玩家，请检查 ID（若玩家未公开比赛数据则无法查询）');
    currentMatches = Array.isArray(matches) ? matches : [];
    currentPeers = Array.isArray(peers) ? peers : [];
    renderProfile(profile, wl);
    $('refreshBtn').classList.remove('hidden');
    $('contentArea').classList.remove('hidden');
    renderAll();
    renderSaved();
    location.hash = id;
    setStatus('');
  } catch (e) {
    setStatus(e.message, true);
  }
}

function renderProfile(data, wl) {
  const p = data.profile;
  $('profileCard').classList.remove('hidden');
  $('pAvatar').src = p.avatarfull || p.avatar || '';
  $('pName').textContent = p.personaname || '未知玩家';
  const sid64 = p.steamid || '';
  $('pSteamLink').href = `https://steamcommunity.com/profiles/${sid64}`;
  $('pOdLink').href = `https://www.opendota.com/players/${currentId}`;
  $('pStratzLink').href = `https://stratz.com/players/${currentId}`;
  $('pRank').textContent = rankText(data.rank_tier) + (data.leaderboard_rank ? ` (#${data.leaderboard_rank})` : '');
  $('pMmr').textContent = data.mmr_estimate && data.mmr_estimate.estimate ? `约 ${data.mmr_estimate.estimate}` : '未知';
  const win = wl.win || 0, lose = wl.lose || 0, total = win + lose;
  $('pWl').textContent = `${win} 胜 / ${lose} 负`;
  $('pWinrate').textContent = total ? ((win / total * 100).toFixed(1) + '%') : '—';
  $('pLastMatch').textContent = currentMatches.length ? timeAgo(currentMatches[0].start_time) : '—';
}

// ---------- 时间筛选 ----------
function filteredMatches() {
  if (!filterDays) return currentMatches;
  const cutoff = Date.now() / 1000 - filterDays * 86400;
  return currentMatches.filter(m => m.start_time >= cutoff);
}

// ---------- 渲染：最近比赛 ----------
function renderMatches() {
  const list = filteredMatches();
  if (!list.length) { $('tab-matches').innerHTML = '<p class="status">该时间范围内没有比赛记录。</p>'; return; }
  const rows = list.map(m => {
    const win = isWin(m);
    const kda = (m.kills + m.assists) / Math.max(1, m.deaths);
    return `<tr>
      <td class="${win ? 'result-win' : 'result-lose'}">${win ? '胜利' : '失败'}</td>
      <td><div class="hero-cell">${heroImg(m.hero_id)}<span>${esc(heroName(m.hero_id))}</span></div></td>
      <td>${m.kills}/${m.deaths}/${m.assists} <span class="${kda >= 3 ? 'kda-good' : kda < 1.5 ? 'kda-bad' : ''}">(${kda.toFixed(1)})</span></td>
      <td>${m.gold_per_min ?? '—'}</td>
      <td>${m.xp_per_min ?? '—'}</td>
      <td>${fmtDuration(m.duration)}</td>
      <td title="${new Date(m.start_time * 1000).toLocaleString('zh-CN')}">${timeAgo(m.start_time)}</td>
      <td><a href="https://www.opendota.com/matches/${m.match_id}" target="_blank">详情</a></td>
    </tr>`;
  }).join('');
  $('tab-matches').innerHTML = `
    <p class="status">共 ${list.length} 场（${list.filter(isWin).length} 胜）</p>
    <div style="overflow-x:auto"><table>
      <thead><tr><th>结果</th><th>英雄</th><th>K/D/A (KDA)</th><th>GPM</th><th>XPM</th><th>时长</th><th>时间</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ---------- 渲染：英雄统计 ----------
function computeHeroStats(list) {
  const map = {};
  for (const m of list) {
    const h = map[m.hero_id] || (map[m.hero_id] = { id: m.hero_id, games: 0, wins: 0, k: 0, d: 0, a: 0 });
    h.games++;
    if (isWin(m)) h.wins++;
    h.k += m.kills; h.d += m.deaths; h.a += m.assists;
  }
  return Object.values(map).map(h => ({
    ...h,
    winrate: h.wins / h.games * 100,
    kda: (h.k + h.a) / Math.max(1, h.d),
  }));
}
function heroItemHtml(h) {
  return `<div class="hero-item">
    ${heroImg(h.id)}
    <span class="hname">${esc(heroName(h.id))}</span>
    <span class="hstat"><b class="${h.winrate >= 50 ? 'kda-good' : 'kda-bad'}">${h.winrate.toFixed(0)}%</b> 胜率<br>${h.games} 场 · KDA ${h.kda.toFixed(1)}</span>
  </div>`;
}
function renderHeroes() {
  const list = filteredMatches();
  const stats = computeHeroStats(list);
  const eligible = stats.filter(h => h.games >= 3);
  const up = eligible.filter(h => h.winrate >= 55).sort((a, b) => b.winrate - a.winrate || b.games - a.games).slice(0, 6);
  const down = eligible.filter(h => h.winrate <= 45).sort((a, b) => a.winrate - b.winrate || b.games - a.games).slice(0, 6);
  const all = [...stats].sort((a, b) => b.games - a.games);

  $('heroSummary').textContent = `统计范围：${list.length} 场比赛 · 上分/下分判定：至少 3 场，胜率 ≥55% / ≤45%`;
  $('upHeroes').innerHTML = up.length ? up.map(heroItemHtml).join('') : '<p class="status">暂无符合条件的上分英雄</p>';
  $('downHeroes').innerHTML = down.length ? down.map(heroItemHtml).join('') : '<p class="status">暂无符合条件的下分英雄</p>';

  const rows = all.map(h => `<tr>
    <td><div class="hero-cell">${heroImg(h.id)}<span>${esc(heroName(h.id))}</span></div></td>
    <td>${h.games}</td>
    <td>${h.wins}胜 ${h.games - h.wins}负</td>
    <td><span class="wr-bar" style="width:${Math.round(h.winrate)}px"></span><span class="${h.winrate >= 50 ? 'kda-good' : 'kda-bad'}">${h.winrate.toFixed(1)}%</span></td>
    <td class="${h.kda >= 3 ? 'kda-good' : ''}">${h.kda.toFixed(2)}</td>
    <td>${(h.k / h.games).toFixed(1)} / ${(h.d / h.games).toFixed(1)} / ${(h.a / h.games).toFixed(1)}</td>
  </tr>`).join('');
  $('allHeroes').innerHTML = `<div style="overflow-x:auto"><table>
    <thead><tr><th>英雄</th><th>场次</th><th>胜负</th><th>胜率</th><th>平均KDA</th><th>场均 K/D/A</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- 渲染：队友 ----------
function renderPeers() {
  const list = currentPeers.filter(p => p.with_games >= 3).slice(0, 30);
  if (!list.length) { $('tab-peers').innerHTML = '<p class="status">暂无队友数据（可能未公开比赛数据）。</p>'; return; }
  const rows = list.map(p => {
    const wr = p.with_games ? p.with_win / p.with_games * 100 : 0;
    return `<tr>
      <td><div class="hero-cell">
        <img src="${p.avatar || ''}" style="width:32px;border-radius:50%" onerror="this.style.display='none'">
        <a href="#${p.account_id}" class="peer-link" data-id="${p.account_id}">${esc(p.personaname || '未知')}</a>
      </div></td>
      <td>${p.with_games}</td>
      <td class="${wr >= 50 ? 'kda-good' : 'kda-bad'}">${wr.toFixed(1)}%</td>
      <td>${p.last_played ? timeAgo(p.last_played) : '—'}</td>
    </tr>`;
  }).join('');
  $('tab-peers').innerHTML = `<div style="overflow-x:auto"><table>
    <thead><tr><th>玩家</th><th>一起场次</th><th>一起胜率</th><th>最近一起打</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- 渲染：对比 ----------
async function renderCompare() {
  const otherId = $('compareSelect').value;
  if (!otherId || !currentId) { $('compareResult').innerHTML = ''; return; }
  $('compareResult').innerHTML = '<p class="status">加载对比数据…</p>';
  try {
    const [meWl, meM, otWl, otM, otProfile] = await Promise.all([
      api(`players/${currentId}/wl`), api(`players/${currentId}/matches?limit=50`),
      api(`players/${otherId}/wl`), api(`players/${otherId}/matches?limit=50`),
      api(`players/${otherId}`),
    ]);
    const meName = $('pName').textContent;
    const otName = otProfile.profile ? otProfile.profile.personaname : otherId;

    function card(name, wl, matches) {
      const total = (wl.win || 0) + (wl.lose || 0);
      const wins = matches.filter(isWin).length;
      const stats = computeHeroStats(matches).sort((a, b) => b.games - a.games).slice(0, 5);
      const heroesHtml = stats.map(h => `<div class="stat">
        <span class="label">${esc(heroName(h.id))}</span>
        <span class="value">${h.games}场 · ${h.winrate.toFixed(0)}%</span></div>`).join('') || '<p class="status">无数据</p>';
      return `<div class="card compare-card"><h4>${esc(name)}</h4>
        <div class="stat"><span class="label">总胜率</span><span class="value">${total ? (wl.win / total * 100).toFixed(1) + '%' : '—'} (${wl.win}胜${wl.lose}负)</span></div>
        <div class="stat"><span class="label">近 ${matches.length} 场胜率</span><span class="value">${matches.length ? (wins / matches.length * 100).toFixed(1) + '%' : '—'}</span></div>
        <h4 style="margin-top:12px">常用英雄 TOP5</h4>${heroesHtml}</div>`;
    }
    $('compareResult').innerHTML = `<div class="compare-grid">${card(meName, meWl, meM)}${card(otName, otWl, otM)}</div>`;
  } catch (e) {
    $('compareResult').innerHTML = `<p class="status error">对比失败：${esc(e.message)}</p>`;
  }
}

// ---------- 渲染调度 ----------
function renderAll() {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.add('hidden'));
  $('tab-' + activeTab).classList.remove('hidden');
  if (activeTab === 'matches') renderMatches();
  else if (activeTab === 'heroes') renderHeroes();
  else if (activeTab === 'peers') renderPeers();
  else if (activeTab === 'compare') renderCompare();
}

// ---------- 事件绑定 ----------
$('searchBtn').addEventListener('click', () => loadPlayer($('searchInput').value));
$('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadPlayer($('searchInput').value); });

$('refreshBtn').addEventListener('click', async () => {
  if (!currentId) return;
  setStatus('已请求 OpenDota 重新解析，稍后自动重新加载…');
  try { await fetch(OD + `players/${currentId}/refresh`, { method: 'POST' }); } catch { /* 忽略 */ }
  setTimeout(() => loadPlayer(currentId), 4000);
});

$('saveBtn').addEventListener('click', () => {
  if (!currentId) return;
  let list = getSaved();
  const idx = list.findIndex(p => String(p.account_id) === String(currentId));
  if (idx >= 0) list.splice(idx, 1);
  else {
    list.unshift({ account_id: currentId, name: $('pName').textContent, avatar: $('pAvatar').src });
    list = list.slice(0, 12);
  }
  setSaved(list);
  renderSaved();
});

$('savedPlayers').addEventListener('click', e => {
  const del = e.target.dataset.del;
  if (del) {
    e.stopPropagation();
    setSaved(getSaved().filter(p => String(p.account_id) !== String(del)));
    renderSaved();
    return;
  }
  const chip = e.target.closest('.chip');
  if (chip) { $('searchInput').value = chip.dataset.id; loadPlayer(chip.dataset.id); }
});

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeTab = btn.dataset.tab;
  renderAll();
}));

$('timeFilter').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  document.querySelectorAll('#timeFilter button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterDays = Number(btn.dataset.days);
  renderAll();
});

$('compareSelect').addEventListener('change', renderCompare);

document.addEventListener('click', e => {
  const link = e.target.closest('.peer-link');
  if (link) { e.preventDefault(); $('searchInput').value = link.dataset.id; loadPlayer(link.dataset.id); }
});

// ---------- 启动 ----------
renderSaved();
loadHeroes().catch(() => {});
if (location.hash && /^\d+$/.test(location.hash.slice(1))) {
  const id = location.hash.slice(1);
  $('searchInput').value = id;
  loadPlayer(id);
} else {
  const saved = getSaved();
  if (saved.length) loadPlayer(saved[0].account_id);
}
