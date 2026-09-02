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
let teamsById = {};
let allGroups = [];
let groupStandings = [];
let currentSettings = null;

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initModals();
  initRegisterForm();
  initResultForm();
  initRecoverForm();
  refreshAll();
  subscribeRealtime();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (allMatches.length) renderBracket(); }, 200);
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
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
  await loadTeams(); // settings' champion banner needs team names, so load teams first
  await Promise.all([loadSettings(), loadMatches(), loadGroups()]);
}

// ---------------- settings / hero stats ----------------

async function loadSettings(){
  const { data, error } = await sb.from('tournament_settings').select('*').eq('id', 1).single();
  if (error || !data) return;
  currentSettings = data;
  document.getElementById('tournamentName').textContent = data.tournament_name;
  const statusMap = {
    registration: 'Registration open',
    group_stage: 'Group stage under way',
    knockout: 'Knockout stage live',
    ongoing: 'Knockout stage live', // legacy value, kept for older data
    completed: 'Champion crowned'
  };
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
  teamsById = {};
  allTeams.forEach(t => { teamsById[t.id] = t; });
  renderTeams();
  updateHeroStats();
  if (allMatches.length) { renderBracket(); populateResultMatchSelect(); } // names may arrive after matches did
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
      const opponent = isTeam1 ? teamsById[m.team2_id]?.team_name : teamsById[m.team1_id]?.team_name;
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

// ---------------- groups ----------------

async function loadGroups(){
  const [{ data: groups, error: gErr }, { data: standings, error: sErr }] = await Promise.all([
    sb.from('groups').select('*').order('name', { ascending: true }),
    sb.from('group_standings').select('*')
  ]);
  if (gErr) { console.error(gErr); return; }
  allGroups = groups || [];
  groupStandings = sErr ? [] : (standings || []);
  renderGroups();
}

function renderGroups(){
  const wrap = document.getElementById('groupsWrap');
  const sub = document.getElementById('groupsSub');

  if (!allGroups.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">🗂️</div>No groups yet — the admin sets these up before the group stage begins.</div>`;
    if (sub) sub.textContent = 'Top teams from each group advance to the knockouts';
    return;
  }

  const qualifiers = (currentSettings && currentSettings.qualifiers_per_group) || 2;
  if (sub) sub.textContent = `Top ${qualifiers} from each group advance to the knockouts`;

  wrap.innerHTML = `<div class="groups-grid">${allGroups.map(g => groupCardHtml(g, qualifiers)).join('')}</div>`;
}

function groupCardHtml(group, qualifiers){
  const rows = groupStandings.filter(r => r.group_id === group.id).sort((a,b) => a.position - b.position);
  if (!rows.length) {
    return `<div class="glass group-card">
      <h3>${escapeHtml(group.name)}</h3>
      <div class="group-hint">No teams assigned yet.</div>
    </div>`;
  }
  return `<div class="glass group-card">
    <h3>${escapeHtml(group.name)}</h3>
    <div class="group-hint">${rows.length} team${rows.length === 1 ? '' : 's'}</div>
    <div class="table-wrap" style="box-shadow:none; padding:0;">
      <table class="standings-table">
        <thead><tr>
          <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr class="${r.position <= qualifiers ? 'qualified' : ''}">
              <td><span class="pos-cell">${r.position}</span></td>
              <td>${escapeHtml(r.team_name)}</td>
              <td>${r.played}</td>
              <td>${r.won}</td>
              <td>${r.drawn}</td>
              <td>${r.lost}</td>
              <td>${r.goals_for}</td>
              <td>${r.goals_against}</td>
              <td>${r.goal_diff > 0 ? '+' : ''}${r.goal_diff}</td>
              <td class="pts">${r.points}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="standings-legend"><span class="dot"></span> Qualifies for the knockouts</div>
  </div>`;
}

// ---------------- matches / bracket ----------------

async function loadMatches(){
  const { data, error } = await sb
    .from('matches')
    .select('*')
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
  const pill = document.getElementById('bracketRoundPill');
  const knockoutMatches = allMatches.filter(m => (m.phase || 'knockout') === 'knockout');

  if (!knockoutMatches.length) {
    const phase = currentSettings && currentSettings.status;
    const msg = phase === 'group_stage'
      ? `Group stage is under way — check the Groups tab. The bracket opens once it's finalized.`
      : `The bracket will appear here once the admin schedules Round 1.`;
    wrap.innerHTML = `<div class="empty-state"><div class="big">🏆</div>${msg}</div>`;
    if (pill) pill.innerHTML = '';
    return;
  }

  const rounds = {};
  knockoutMatches.forEach(m => { (rounds[m.round] = rounds[m.round] || []).push(m); });
  const roundNums = Object.keys(rounds).map(Number).sort((a,b) => a-b);
  const lastRound = roundNums[roundNums.length - 1];

  if (pill) pill.innerHTML = currentRoundPillHtml(rounds, roundNums);

  const finalMatch = rounds[lastRound] && rounds[lastRound][0];
  const champion = currentSettings && currentSettings.status === 'completed' && currentSettings.champion_id
    ? teamsById[currentSettings.champion_id]
    : null;

  wrap.innerHTML = `<div class="bracket" id="bracketTrack">
    ${roundNums.map(r => `
      <div class="bracket-round" data-round="${r}">
        <div class="bracket-round-title">${rounds[r][0].round_name || ('Round ' + r)}</div>
        ${rounds[r].sort((a,b)=>a.match_index-b.match_index).map(m => matchCardHtml(m)).join('')}
      </div>
    `).join('')}
    <div class="bracket-trophy">
      <div class="cup ${champion ? '' : 'is-pending'}">🏆</div>
      <div class="champ-label">${champion ? 'Champion' : (finalMatch ? finalMatch.round_name || 'Final' : 'Final')}</div>
      ${champion ? `<div class="champ-name">${escapeHtml(champion.team_name)}</div>` : ''}
    </div>
    <svg class="bracket-svg" id="bracketSvg"></svg>
  </div>`;

  drawBracketConnectors(rounds, roundNums);
}

function currentRoundPillHtml(rounds, roundNums){
  // "current" round = the earliest round that isn't fully approved yet;
  // if everything is approved, show the last (Final) round's name.
  for (const r of roundNums) {
    const stillOpen = rounds[r].some(m => m.status !== 'approved');
    if (stillOpen) {
      return `<span class="round-pill">Now playing · ${escapeHtml(rounds[r][0].round_name || ('Round ' + r))}</span>`;
    }
  }
  const last = roundNums[roundNums.length - 1];
  const name = rounds[last] && (rounds[last][0].round_name || 'Final');
  return `<span class="round-pill">🏆 ${escapeHtml(name || 'Final')} decided</span>`;
}

// Draws the "road to the final" connector lines between a match and
// the next-round match its winner feeds into, using the same
// match_index/2 pairing the database uses to advance winners. Runs
// after the DOM is painted so card heights (which vary because they
// space out with justify-content:space-around) are accurate.
function drawBracketConnectors(rounds, roundNums){
  requestAnimationFrame(() => {
    const track = document.getElementById('bracketTrack');
    const svg = document.getElementById('bracketSvg');
    if (!track || !svg) return;
    const trackRect = track.getBoundingClientRect();
    const width = track.scrollWidth;
    const height = track.scrollHeight;
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    let html = `<defs>
      <marker id="arrowHead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <polygon points="0 0, 7 3, 0 6"></polygon>
      </marker>
      <marker id="arrowHeadDecided" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <polygon class="is-decided" points="0 0, 7 3, 0 6"></polygon>
      </marker>
    </defs>`;

    roundNums.forEach((r, ri) => {
      if (ri === roundNums.length - 1) return; // no round after the final
      const nextRoundNum = roundNums[ri + 1];
      const cards = rounds[r].slice().sort((a,b)=>a.match_index-b.match_index);
      const nextCards = (rounds[nextRoundNum] || []).slice().sort((a,b)=>a.match_index-b.match_index);

      cards.forEach(m => {
        const el = track.querySelector(`[data-match-id="${m.id}"]`);
        const nextIndex = Math.floor(m.match_index / 2);
        const nextMatch = nextCards[nextIndex];
        if (!el || !nextMatch) return;
        const nextEl = track.querySelector(`[data-match-id="${nextMatch.id}"]`);
        if (!nextEl) return;

        const a = el.getBoundingClientRect();
        const b = nextEl.getBoundingClientRect();
        const x1 = a.right - trackRect.left + track.scrollLeft;
        const y1 = a.top + a.height / 2 - trackRect.top + track.scrollTop;
        const x2 = b.left - trackRect.left + track.scrollLeft;
        const y2 = b.top + b.height / 2 - trackRect.top + track.scrollTop;
        const midX = x1 + (x2 - x1) / 2;

        const decided = !!m.winner_id;
        const cls = decided ? 'is-decided' : '';
        const marker = decided ? 'arrowHeadDecided' : 'arrowHead';

        html += `<path class="${cls}" marker-end="url(#${marker})"
          d="M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 6} ${y2}"></path>`;
      });
    });

    svg.innerHTML = html;
  });
}

function matchCardHtml(m){
  const t1name = teamsById[m.team1_id]?.team_name;
  const t2name = teamsById[m.team2_id]?.team_name;
  const t1 = t1name || (m.is_bye ? null : 'TBD');
  const t2 = m.is_bye ? 'BYE' : (t2name || 'TBD');
  const t1win = m.winner_id && m.winner_id === m.team1_id;
  const t2win = m.winner_id && m.winner_id === m.team2_id;
  const s = STATUS_LABEL[m.status] || { text: m.status, cls: '' };
  return `<div class="glass match-card ${m.status === 'scheduled' ? 'is-live' : ''}" data-match-id="${m.id}">
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
  sel.innerHTML = `<option value="">Select your fixture…</option>` + eligible.map(m => {
    const n1 = teamsById[m.team1_id]?.team_name || 'TBD';
    const n2 = teamsById[m.team2_id]?.team_name || 'TBD';
    return `<option value="${m.id}" data-phase="${m.phase || 'knockout'}">${escapeHtml(n1)} vs ${escapeHtml(n2)} — ${m.round_name || ('Round ' + m.round)}</option>`;
  }).join('');
}

function initResultForm(){
  const form = document.getElementById('resultForm');
  const selectEl = document.getElementById('resultMatchSelect');
  const penaltyWrap = document.getElementById('penaltyWrap');
  const penaltyHint = document.getElementById('penaltyHint');
  const s1 = document.getElementById('resultScore1');
  const s2 = document.getElementById('resultScore2');

  function selectedPhase(){
    const opt = selectEl.options[selectEl.selectedIndex];
    return opt ? (opt.dataset.phase || 'knockout') : 'knockout';
  }

  function togglePenalties(){
    const isKnockout = selectedPhase() === 'knockout';
    const level = s1.value !== '' && s2.value !== '' && s1.value === s2.value;
    penaltyWrap.style.display = (isKnockout && level) ? 'grid' : 'none';
    if (penaltyHint) {
      penaltyHint.textContent = isKnockout
        ? 'Home / away order matches the fixture as shown in the bracket. Level scores need a penalty result.'
        : 'Home / away order matches the fixture as shown in the group table. Draws are allowed in the group stage.';
    }
  }
  s1.addEventListener('input', togglePenalties);
  s2.addEventListener('input', togglePenalties);
  selectEl.addEventListener('change', togglePenalties);

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

// ---------------- code recovery ----------------

function initRecoverForm(){
  const openBtn = document.getElementById('openRecoverBtn');
  const form = document.getElementById('recoverForm');
  const resultBox = document.getElementById('recoverResult');
  const msg = document.getElementById('recoverMsg');

  openBtn.addEventListener('click', () => {
    // reset to a clean state every time it's opened
    form.reset();
    form.style.display = '';
    resultBox.style.display = 'none';
    msg.className = 'msg'; msg.textContent = '';
    openModal('recoverModal');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg'; msg.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Checking…';

    const teamName = document.getElementById('recoverTeamName').value.trim();
    const phone = document.getElementById('recoverPhone').value.trim();

    const { data, error } = await sb.rpc('recover_team_code', {
      p_team_name: teamName, p_phone: phone
    });

    btn.disabled = false; btn.innerHTML = 'Recover code';

    if (error) {
      msg.classList.add('show', 'msg-err');
      msg.textContent = error.message || 'Could not recover your code. Try again.';
      return;
    }

    document.getElementById('recoveredCode').textContent = data;
    form.style.display = 'none';
    resultBox.style.display = 'block';
  });
}

// ---------------- realtime ----------------

function subscribeRealtime(){
  sb.channel('public-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => { loadMatches(); loadGroups(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadTeams())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_settings' }, () => loadSettings())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, () => loadGroups())
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
      
