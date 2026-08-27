// ==================================================================
// Public site logic
// ==================================================================

const STATUS_LABEL = {
  pending_teams: { text: 'TBD', cls: 'badge-eliminated' },
  awaiting_schedule: { text: 'Needs schedule', cls: 'badge-pending' },
  scheduled: { text: 'Scheduled', cls: 'badge-live' },
  pending_approval: { text: 'Pending approval', cls: 'badge-pending' },
  approved: { text: 'Final', cls: 'badge-approved' },
  disputed: { text: 'Disputed', cls: 'badge-disputed' }
};

let allTeams = [];
let allMatches = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initModals();
  initRegisterForm();
  initResultForm();
  initTheme();
  refreshAll();
  subscribeRealtime();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

function initTheme(){
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.body.classList.add('dark');
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
}

function initTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      // keep the top pill nav and the mobile bottom tab bar in sync,
      // since both sets of buttons share the same data-target values
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.target === target));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById(target).classList.add('active');
    });
  });
}

function initModals(){
  document.querySelectorAll('[data-close-modal]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.hasAttribute('data-close-modal')) {
        el.closest('.modal-backdrop').classList.remove('show');
      }
    });
  });
}

function openModal(id){ document.getElementById(id).classList.add('show'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); }

async function refreshAll(){
  await Promise.all([loadSettings(), loadTeams(), loadMatches()]);
}

// ---------------- settings / hero stats ----------------

async function loadSettings(){
  const { data, error } = await sb.from('tournament_settings').select('*').eq('id', 1).single();
  if (error || !data) return;
  document.getElementById('tournamentName').textContent = data.tournament_name;
  const statusMap = { registration: 'Registration open', ongoing: 'Knockout in progress', completed: 'Champion crowned' };
  document.getElementById('tournamentStatus').textContent = statusMap[data.status] || data.status;

  if (data.status === 'completed' && data.champion_id) {
    const champ = allTeams.find(t => t.id === data.champion_id);
    const el = document.getElementById('championBanner');
    if (champ) {
      el.style.display = 'flex';
      el.querySelector('.champ-name').textContent = champ.team_name;
    }
  }
}

// ---------------- teams ----------------

async function loadTeams(){
  const { data, error } = await sb.from('teams_public').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error); return; }
  allTeams = data || [];
  renderTeams();
  updateHeroStats();
}

function renderTeams(){
  const grid = document.getElementById('teamsGrid');
  if (!allTeams.length) {
    grid.innerHTML = `<div class="empty-state"><div class="big">🎮</div>No teams registered yet — be the first.</div>`;
    return;
  }
  grid.innerHTML = allTeams.map(t => `
    <div class="glass team-card" data-team-id="${t.id}" role="button" tabindex="0">
      <div class="name">${escapeHtml(t.team_name)}</div>
      <span class="badge ${statusBadgeClass(t.status)}">${statusBadgeText(t.status)}</span>
      <div class="meta">Joined ${formatDate(t.created_at)}</div>
    </div>
  `).join('');

  grid.querySelectorAll('.team-card').forEach(card => {
    card.addEventListener('click', () => showTeamHistory(card.dataset.teamId));
  });
}

function statusBadgeClass(s){
  if (s === 'champion') return 'badge-champion';
  if (s === 'eliminated') return 'badge-eliminated';
  if (s === 'withdrawn') return 'badge-disputed';
  return 'badge-live';
}
function statusBadgeText(s){
  return { active: 'Active', eliminated: 'Eliminated', champion: 'Champion', withdrawn: 'Withdrawn' }[s] || s;
}

function showTeamHistory(teamId){
  const team = allTeams.find(t => t.id === teamId);
  if (!team) return;
  const played = allMatches.filter(m => (m.team1_id === teamId || m.team2_id === teamId) && m.status === 'approved');

  document.getElementById('teamModalName').textContent = team.team_name;
  document.getElementById('teamModalStatus').className = `badge ${statusBadgeClass(team.status)}`;
  document.getElementById('teamModalStatus').textContent = statusBadgeText(team.status);

  const wins = played.filter(m => m.winner_id === teamId).length;
  const losses = played.length - wins;
  document.getElementById('teamModalRecord').textContent = `${wins}W – ${losses}L across ${played.length} played`;

  const list = document.getElementById('teamModalHistory');
  if (!played.length) {
    list.innerHTML = `<div class="empty-state">No matches played yet.</div>`;
  } else {
    list.innerHTML = played.slice().reverse().map(m => {
      const isTeam1 = m.team1_id === teamId;
      const opponent = isTeam1 ? m.team2?.team_name : m.team1?.team_name;
      const myScore = isTeam1 ? m.team1_score : m.team2_score;
      const oppScore = isTeam1 ? m.team2_score : m.team1_score;
      const won = m.winner_id === teamId;
      return `<div class="list-item">
        <div>
          <div style="font-weight:600">${won ? '✅ Won' : '❌ Lost'} vs ${escapeHtml(opponent || 'Bye')}</div>
          <div class="hint mono">${m.round_name || ('Round ' + m.round)}</div>
        </div>
        <div class="mono" style="font-size:1.1rem;font-weight:700;color:${won ? 'var(--accent-pitch)' : 'var(--text-muted)'}">${myScore ?? '-'} : ${oppScore ?? '-'}</div>
      </div>`;
    }).join('');
  }
  openModal('teamHistoryModal');
}

function updateHeroStats(){
  // Hero stat chips (Teams / Still In / Matches Played) were removed from the UI.
}

// ---------------- matches / bracket ----------------

async function loadMatches(){
  const { data, error } = await sb
    .from('matches')
    .select('*, team1:team1_id(id,team_name), team2:team2_id(id,team_name), winner:winner_id(id,team_name)')
    .order('round', { ascending: true })
    .order('match_index', { ascending: true });
  if (error) { console.error(error); return; }
  allMatches = data || [];
  renderBracket();
  populateResultMatchSelect();
  updateHeroStats();
}

function renderBracket(){
  const wrap = document.getElementById('bracketWrap');
  if (!allMatches.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">🏆</div>The bracket will appear here once the admin schedules Round 1.</div>`;
    return;
  }
  const rounds = {};
  allMatches.forEach(m => { (rounds[m.round] = rounds[m.round] || []).push(m); });
  const roundNums = Object.keys(rounds).map(Number).sort((a,b) => a-b);

  wrap.innerHTML = `<div class="bracket">${roundNums.map(r => `
    <div class="bracket-round">
      <div class="bracket-round-title">${rounds[r][0].round_name || ('Round ' + r)}</div>
      ${rounds[r].sort((a,b)=>a.match_index-b.match_index).map(m => matchCardHtml(m)).join('')}
    </div>
  `).join('')}</div>`;
}

function matchCardHtml(m){
  const t1 = m.team1?.team_name || (m.is_bye ? null : 'TBD');
  const t2 = m.is_bye ? 'BYE' : (m.team2?.team_name || 'TBD');
  const t1win = m.winner_id && m.winner_id === m.team1_id;
  const t2win = m.winner_id && m.winner_id === m.team2_id;
  const s = STATUS_LABEL[m.status] || { text: m.status, cls: '' };
  return `<div class="glass match-card ${m.status === 'scheduled' ? 'is-live' : ''}">
    <div class="match-slot ${t1win ? 'winner' : ''}">
      <span class="team">${escapeHtml(t1 || 'TBD')}</span>
      <span class="score">${m.team1_score ?? ''}</span>
    </div>
    <div class="vs-divider"></div>
    <div class="match-slot ${t2win ? 'winner' : ''}">
      <span class="team">${escapeHtml(t2 || 'TBD')}</span>
      <span class="score">${m.team2_score ?? ''}</span>
    </div>
    <div class="meta-row">
      <span class="badge ${s.cls}">${s.text}</span>
      <span class="time">${m.scheduled_time ? formatDateTime(m.scheduled_time) : ''}</span>
    </div>
  </div>`;
}

// ---------------- registration ----------------

function initRegisterForm(){
  const form = document.getElementById('registerForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('registerMsg');
    msg.className = 'msg'; msg.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Registering…';

    const teamName = document.getElementById('regTeamName').value.trim();
    const ownerName = document.getElementById('regOwnerName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const preferredTime = document.getElementById('regPreferredTime').value.trim();

    const { data, error } = await sb.rpc('register_team', {
      p_team_name: teamName, p_owner_name: ownerName, p_phone: phone, p_preferred_time: preferredTime
    });

    btn.disabled = false; btn.innerHTML = 'Register team';

    if (error) {
      msg.classList.add('show', 'msg-err');
      msg.textContent = error.message || 'Registration failed. Try a different team name.';
      return;
    }

    document.getElementById('revealedCode').textContent = data;
    document.getElementById('revealedTeamName').textContent = teamName;
    form.reset();
    openModal('codeModal');
    loadTeams();
  });
}

// ---------------- submit result ----------------

function populateResultMatchSelect(){
  const sel = document.getElementById('resultMatchSelect');
  const eligible = allMatches.filter(m =>
    !m.is_bye && m.team1_id && m.team2_id &&
    ['scheduled','awaiting_schedule','disputed'].includes(m.status)
  );
  if (!eligible.length) {
    sel.innerHTML = `<option value="">No fixtures open for results right now</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = `<option value="">Select your fixture…</option>` + eligible.map(m =>
    `<option value="${m.id}">${escapeHtml(m.team1.team_name)} vs ${escapeHtml(m.team2.team_name)} — ${m.round_name || ('Round ' + m.round)}</option>`
  ).join('');
}

function initResultForm(){
  const form = document.getElementById('resultForm');
  const selectEl = document.getElementById('resultMatchSelect');
  const penaltyWrap = document.getElementById('penaltyWrap');
  const s1 = document.getElementById('resultScore1');
  const s2 = document.getElementById('resultScore2');

  function togglePenalties(){
    penaltyWrap.style.display = (s1.value !== '' && s2.value !== '' && s1.value === s2.value) ? 'grid' : 'none';
  }
  s1.addEventListener('input', togglePenalties);
  s2.addEventListener('input', togglePenalties);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('resultMsg');
    msg.className = 'msg'; msg.textContent = '';

    const matchId = selectEl.value;
    if (!matchId) { msg.classList.add('show','msg-err'); msg.textContent = 'Choose your fixture first.'; return; }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Submitting…';

    const payload = {
      p_match_id: matchId,
      p_code: document.getElementById('resultCode').value.trim(),
      p_score1: parseInt(s1.value, 10),
      p_score2: parseInt(s2.value, 10),
      p_pen1: document.getElementById('resultPen1').value ? parseInt(document.getElementById('resultPen1').value, 10) : null,
      p_pen2: document.getElementById('resultPen2').value ? parseInt(document.getElementById('resultPen2').value, 10) : null
    };

    const { error } = await sb.rpc('submit_match_result', payload);
    btn.disabled = false; btn.innerHTML = 'Submit result for approval';

    if (error) {
      msg.classList.add('show','msg-err');
      msg.textContent = error.message || 'Could not submit result.';
      return;
    }
    msg.classList.add('show','msg-ok');
    msg.textContent = 'Result submitted — waiting on admin approval.';
    form.reset();
    penaltyWrap.style.display = 'none';
    loadMatches();
  });
}

// ---------------- realtime ----------------

function subscribeRealtime(){
  sb.channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadMatches())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadTeams())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_settings' }, () => loadSettings())
    .subscribe();
}

// ---------------- helpers ----------------

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function formatDate(iso){
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
function formatDateTime(iso){
  return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
