// ==================================================================
// Admin panel logic
// ==================================================================

let adminTeams = [];
let adminMatches = [];
let settings = null;
let teamsSearchQuery = '';
let approvalsSearchQuery = '';
let matchesSearchQuery = '';

const ADMIN_SECTIONS = ['adminTeams', 'adminBracket', 'adminApprovals', 'adminMatches', 'adminSettings'];

document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initLoginForm();
  initTheme();
  document.getElementById('logoutBtn').addEventListener('click', () => sb.auth.signOut());
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);
  document.getElementById('resetTournamentBtn').addEventListener('click', resetTournament);
  document.getElementById('bracketAddForm').addEventListener('submit', addFixture);
  document.getElementById('byeForm').addEventListener('submit', addBye);
  document.getElementById('teamsSearch').addEventListener('input', (e) => {
    teamsSearchQuery = e.target.value.trim().toLowerCase();
    renderTeamsAdmin();
  });
  document.getElementById('approvalsSearch').addEventListener('input', (e) => {
    approvalsSearchQuery = e.target.value.trim().toLowerCase();
    renderApprovals();
  });
  document.getElementById('matchesSearch').addEventListener('input', (e) => {
    matchesSearchQuery = e.target.value.trim().toLowerCase();
    renderMatchesAdmin();
  });

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) showDashboard(); else showLogin();
  });
  checkSession();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---------------- dark mode ----------------

function initTheme(){
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.body.classList.add('dark');
  document.getElementById('themeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });
}

async function checkSession(){
  const { data: { session } } = await sb.auth.getSession();
  if (session) showDashboard(); else showLogin();
}

function showLogin(){
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}

function showDashboard(){
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminShell').style.display = 'block';
  const hashTarget = location.hash.slice(1);
  activateSection(ADMIN_SECTIONS.includes(hashTarget) ? hashTarget : 'adminTeams');
  loadAllAdmin();
  subscribeAdminRealtime();
}

function initLoginForm(){
  const form = document.getElementById('loginForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loginMsg');
    msg.className = 'msg';
    const btn = form.querySelector('button');
    btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Signing in…';
    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value
    });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) {
      msg.classList.add('show', 'msg-err');
      msg.textContent = error.message;
    }
  });
}

function initNav(){
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activateSection(btn.dataset.target);
      history.replaceState(null, '', '#' + btn.dataset.target);
    });
  });
  window.addEventListener('hashchange', () => {
    const target = location.hash.slice(1);
    if (ADMIN_SECTIONS.includes(target)) activateSection(target);
  });
}

function activateSection(target){
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target === target));
  document.querySelectorAll('.admin-view').forEach(v => v.classList.toggle('active', v.id === target));
}

async function loadAllAdmin(){
  await Promise.all([loadTeamsAdmin(), loadMatchesAdmin(), loadSettingsAdmin()]);
  updateApprovalsBadge();
  renderTeamsAdmin();
  renderBracketBuilder();
  renderApprovals();
  renderMatchesAdmin();
}

function subscribeAdminRealtime(){
  sb.channel('admin-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadMatchesAdmin().then(() => { updateApprovalsBadge(); renderBracketBuilder(); renderApprovals(); renderMatchesAdmin(); }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => loadTeamsAdmin().then(() => { updateApprovalsBadge(); renderTeamsAdmin(); renderBracketBuilder(); }))
    .subscribe();
}

async function loadTeamsAdmin(){
  const { data, error } = await sb.from('teams').select('*').order('created_at', { ascending: true });
  if (!error) adminTeams = data || [];
}

async function loadMatchesAdmin(){
  const { data, error } = await sb
    .from('matches')
    .select('*, team1:team1_id(id,team_name), team2:team2_id(id,team_name)')
    .order('round', { ascending: true })
    .order('match_index', { ascending: true });
  if (!error) adminMatches = data || [];
}

async function loadSettingsAdmin(){
  const { data, error } = await sb.from('tournament_settings').select('*').eq('id', 1).single();
  if (!error) {
    settings = data;
    document.getElementById('settingsName').value = data.tournament_name;
    const statusEl = document.getElementById('settingsStatus');
    statusEl.textContent = data.status;
    statusEl.className = 'badge ' + (data.status === 'ongoing' ? 'badge-live' : data.status === 'complete' ? 'badge-champion' : 'badge-pending');
  }
}

// ---------------- approvals nav badge ----------------

function updateApprovalsBadge(){
  const pendingCount = adminMatches.filter(m => m.status === 'pending_approval').length;
  const navBadge = document.getElementById('approvalsNavBadge');
  navBadge.textContent = pendingCount > 0 ? pendingCount : '';
  navBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
}

// ---------------- teams admin ----------------

function renderTeamsAdmin(){
  const wrap = document.getElementById('teamsAdminTable');
  if (!adminTeams.length) {
    wrap.innerHTML = `<div class="empty-state">No teams have registered yet.</div>`;
    return;
  }
  const q = teamsSearchQuery;
  const filtered = !q ? adminTeams : adminTeams.filter(t =>
    (t.team_name || '').toLowerCase().includes(q) ||
    (t.owner_name || '').toLowerCase().includes(q) ||
    (t.phone || '').toLowerCase().includes(q) ||
    (t.code || '').toLowerCase().includes(q)
  );
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state">No teams match "${escapeHtml(teamsSearchQuery)}".</div>`;
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Team</th><th>Owner</th><th>Phone</th><th>Preferred time</th><th>Code</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${filtered.map(t => `
        <tr>
          <td>${escapeHtml(t.team_name)}</td>
          <td>${escapeHtml(t.owner_name || '—')}</td>
          <td class="mono">${escapeHtml(t.phone)}</td>
          <td>${escapeHtml(t.preferred_time || '—')}</td>
          <td>
            <div class="code-cell">
              <span class="code-pill">${escapeHtml(t.code)}</span>
              <button type="button" class="copy-btn" data-copy="${escapeHtml(t.code)}">Copy</button>
            </div>
          </td>
          <td><span class="badge ${t.status === 'active' ? 'badge-live' : t.status === 'champion' ? 'badge-champion' : 'badge-eliminated'}">${t.status}</span></td>
          <td>
            <div class="pill-row">
              ${t.status !== 'withdrawn' ? `<button class="btn btn-sm btn-danger" data-withdraw="${t.id}">Withdraw</button>` : `<button class="btn btn-sm" data-reactivate="${t.id}">Reactivate</button>`}
              <button class="btn btn-sm btn-danger" data-delete-team="${t.id}" data-team-name="${escapeHtml(t.team_name)}">Delete</button>
            </div>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table></div>`;

  wrap.querySelectorAll('[data-withdraw]').forEach(btn => btn.addEventListener('click', () => {
    if (confirm('Withdraw this team? They\'ll be marked eliminated but stay on record.')) setTeamStatus(btn.dataset.withdraw, 'withdrawn');
  }));
  wrap.querySelectorAll('[data-reactivate]').forEach(btn => btn.addEventListener('click', () => setTeamStatus(btn.dataset.reactivate, 'active')));
  wrap.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copyCode(btn)));
  wrap.querySelectorAll('[data-delete-team]').forEach(btn => btn.addEventListener('click', () => deleteTeam(btn.dataset.deleteTeam, btn.dataset.teamName)));
}

function copyCode(btn){
  const code = btn.dataset.copy;
  const done = () => {
    const original = 'Copy';
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(done);
  } else {
    done();
  }
}

async function setTeamStatus(id, status){
  await sb.from('teams').update({ status }).eq('id', id);
  loadTeamsAdmin().then(renderTeamsAdmin);
}

function teamHasFixtures(id){
  return adminMatches.some(m => m.team1_id === id || m.team2_id === id);
}

async function deleteTeam(id, teamName){
  if (teamHasFixtures(id)) {
    alert(`"${teamName}" already has a fixture in the bracket, so it can't be deleted (that would break match history). Withdraw it instead — that removes it from the public "still in" list without deleting the record.`);
    return;
  }
  if (!confirm(`Permanently delete "${teamName}"? This can't be undone.`)) return;
  const { data, error } = await sb.from('teams').delete().eq('id', id).select();
  if (error) { alert(error.message); return; }
  if (!data || !data.length) {
    alert(`Nothing was deleted. Your Supabase project likely has no DELETE policy on "teams" for signed-in admins — see the note in SUPABASE_SETUP.md / reset the policy so admins can delete, not just update.`);
    return;
  }
  loadTeamsAdmin().then(renderTeamsAdmin);
}

// ---------------- bracket builder ----------------

function usedTeamIdsInRound1(){
  const used = new Set();
  adminMatches.filter(m => m.round === 1).forEach(m => {
    if (m.team1_id) used.add(m.team1_id);
    if (m.team2_id) used.add(m.team2_id);
  });
  return used;
}

function renderBracketBuilder(){
  const used = usedTeamIdsInRound1();
  const available = adminTeams.filter(t => t.status === 'active' && !used.has(t.id));

  const sel1 = document.getElementById('fixtureTeam1');
  const sel2 = document.getElementById('fixtureTeam2');
  const byeSel = document.getElementById('byeTeam');
  const opts = available.map(t => `<option value="${t.id}">${escapeHtml(t.team_name)}</option>`).join('');
  sel1.innerHTML = `<option value="">Team A…</option>${opts}`;
  sel2.innerHTML = `<option value="">Team B…</option>${opts}`;
  byeSel.innerHTML = `<option value="">Select team…</option>${opts}`;

  const round1 = adminMatches.filter(m => m.round === 1).sort((a,b) => a.match_index - b.match_index);
  const list = document.getElementById('round1List');
  if (!round1.length) {
    list.innerHTML = `<div class="empty-state">No Round 1 fixtures created yet.</div>`;
  } else {
    list.innerHTML = round1.map(m => `
      <div class="list-item">
        <div>${escapeHtml(m.team1?.team_name || 'TBD')} ${m.is_bye ? '<span class="hint">(bye)</span>' : 'vs ' + escapeHtml(m.team2?.team_name || 'TBD')}</div>
        <div class="pill-row">
          <span class="badge ${(STATUS_LABEL_ADMIN[m.status]||{}).cls || ''}">${(STATUS_LABEL_ADMIN[m.status]||{}).text || m.status}</span>
          ${settings && settings.status === 'registration' ? `<button class="btn btn-sm btn-danger" data-del-match="${m.id}">Remove</button>` : ''}
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-del-match]').forEach(btn => btn.addEventListener('click', () => deleteMatch(btn.dataset.delMatch)));
  }

  document.getElementById('finalizeBtn').disabled = !(settings && settings.status === 'registration' && round1.length > 0);
  document.getElementById('bracketLockedNote').style.display = settings && settings.status !== 'registration' ? 'block' : 'none';

  document.getElementById('finalizeBtn').onclick = finalizeBracket;
}

async function nextMatchIndex(round){
  const existing = adminMatches.filter(m => m.round === round);
  return existing.length;
}

async function addFixture(e){
  e.preventDefault();
  const t1 = document.getElementById('fixtureTeam1').value;
  const t2 = document.getElementById('fixtureTeam2').value;
  const msg = document.getElementById('bracketMsg');
  msg.className = 'msg';
  if (!t1 || !t2 || t1 === t2) {
    msg.classList.add('show','msg-err'); msg.textContent = 'Pick two different teams.';
    return;
  }
  const idx = await nextMatchIndex(1);
  const { error } = await sb.from('matches').insert({
    round: 1, match_index: idx, team1_id: t1, team2_id: t2, status: 'awaiting_schedule'
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Fixture added.';
  document.getElementById('bracketAddForm').reset();
  loadMatchesAdmin().then(renderBracketBuilder);
}

async function addBye(e){
  e.preventDefault();
  const t1 = document.getElementById('byeTeam').value;
  const msg = document.getElementById('byeMsg');
  msg.className = 'msg';
  if (!t1) { msg.classList.add('show','msg-err'); msg.textContent = 'Select a team.'; return; }
  const idx = await nextMatchIndex(1);
  const { error } = await sb.from('matches').insert({
    round: 1, match_index: idx, team1_id: t1, is_bye: true, status: 'awaiting_schedule'
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Bye added — remember to confirm it once the bracket is finalized.';
  document.getElementById('byeForm').reset();
  loadMatchesAdmin().then(renderBracketBuilder);
}

async function deleteMatch(id){
  if (!confirm('Remove this fixture?')) return;
  const { data, error } = await sb.from('matches').delete().eq('id', id).select();
  if (error) { alert(error.message); return; }
  if (!data || !data.length) {
    alert(`Nothing was deleted. Your Supabase project likely has no DELETE policy on "matches" for signed-in admins.`);
    return;
  }
  loadMatchesAdmin().then(() => { renderBracketBuilder(); renderMatchesAdmin(); });
}

function roundNameFor(round, totalRounds){
  const diff = totalRounds - round;
  if (diff === 0) return 'Final';
  if (diff === 1) return 'Semi-Final';
  if (diff === 2) return 'Quarter-Final';
  return 'Round of ' + Math.pow(2, diff + 1);
}

async function finalizeBracket(){
  const round1 = adminMatches.filter(m => m.round === 1);
  if (!round1.length) return;
  const totalRounds = Math.ceil(Math.log2(round1.length)) + 1;
  const msg = document.getElementById('bracketMsg');
  msg.className = 'msg';

  for (const m of round1) {
    await sb.from('matches').update({ round_name: roundNameFor(1, totalRounds) }).eq('id', m.id);
  }
  const { error } = await sb.from('tournament_settings').update({ total_rounds: totalRounds, status: 'ongoing' }).eq('id', 1);
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }

  msg.classList.add('show','msg-ok'); msg.textContent = `Bracket locked — ${totalRounds} round(s) to the final.`;
  loadSettingsAdmin();
  loadMatchesAdmin().then(() => { renderBracketBuilder(); renderMatchesAdmin(); });
}

// ---------------- approvals ----------------

function renderApprovals(){
  const list = document.getElementById('approvalsList');
  let pending = adminMatches.filter(m => ['pending_approval','disputed'].includes(m.status));
  if (approvalsSearchQuery) {
    pending = pending.filter(m =>
      (m.team1?.team_name || '').toLowerCase().includes(approvalsSearchQuery) ||
      (m.team2?.team_name || '').toLowerCase().includes(approvalsSearchQuery)
    );
  }
  if (!pending.length) {
    list.innerHTML = `<div class="empty-state">${approvalsSearchQuery ? `No pending matches for "${escapeHtml(approvalsSearchQuery)}".` : 'Nothing waiting on you right now.'}</div>`;
    return;
  }
  list.innerHTML = pending.map(m => `
    <div class="glass glass-pad" style="margin-bottom:14px;">
      <div class="pill-row" style="margin-bottom:10px;">
        <span class="badge ${m.status === 'disputed' ? 'badge-disputed' : 'badge-pending'}">${m.status === 'disputed' ? 'Disputed' : 'Pending approval'}</span>
        <span class="hint">${m.round_name || 'Round ' + m.round}</span>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${escapeHtml(m.team1?.team_name || 'Team A')}</label>
          <input type="number" min="0" id="score1-${m.id}" value="${m.team1_score ?? ''}">
        </div>
        <div class="field">
          <label>${escapeHtml(m.team2?.team_name || 'Team B')}</label>
          <input type="number" min="0" id="score2-${m.id}" value="${m.team2_score ?? ''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>${escapeHtml(m.team1?.team_name || 'Team A')} penalties</label>
          <input type="number" min="0" id="pen1-${m.id}" value="${m.team1_penalties ?? ''}">
        </div>
        <div class="field">
          <label>${escapeHtml(m.team2?.team_name || 'Team B')} penalties</label>
          <input type="number" min="0" id="pen2-${m.id}" value="${m.team2_penalties ?? ''}">
        </div>
      </div>
      <div class="pill-row">
        <button class="btn btn-primary btn-sm" data-approve="${m.id}">Approve &amp; advance</button>
        <button class="btn btn-danger btn-sm" data-dispute="${m.id}">Mark disputed</button>
      </div>
      <div class="msg" id="approveMsg-${m.id}"></div>
    </div>
  `).join('');

  list.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => approveMatch(btn.dataset.approve)));
  list.querySelectorAll('[data-dispute]').forEach(btn => btn.addEventListener('click', () => disputeMatch(btn.dataset.dispute)));
}

async function approveMatch(id){
  const msg = document.getElementById(`approveMsg-${id}`);
  msg.className = 'msg';
  const s1 = document.getElementById(`score1-${id}`).value;
  const s2 = document.getElementById(`score2-${id}`).value;
  const p1 = document.getElementById(`pen1-${id}`).value;
  const p2 = document.getElementById(`pen2-${id}`).value;

  const { error } = await sb.rpc('approve_match', {
    p_match_id: id,
    p_score1: s1 === '' ? null : parseInt(s1, 10),
    p_score2: s2 === '' ? null : parseInt(s2, 10),
    p_pen1: p1 === '' ? null : parseInt(p1, 10),
    p_pen2: p2 === '' ? null : parseInt(p2, 10)
  });
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }

  // Best-effort audit trail — no-ops quietly if the approved_by/approved_at
  // columns haven't been added yet (see supabase/audit_trail_migration.sql).
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    await sb.from('matches').update({ approved_by: user.id, approved_at: new Date().toISOString() }).eq('id', id)
      .then(({ error: auditError }) => { if (auditError) console.warn('Audit trail not recorded — run supabase/audit_trail_migration.sql:', auditError.message); });
  }

  loadAllAdmin();
}

async function disputeMatch(id){
  await sb.from('matches').update({ status: 'disputed' }).eq('id', id);
  loadMatchesAdmin().then(renderApprovals);
}

// ---------------- confirm byes (shown in matches admin too) ----------------

async function confirmBye(id){
  const { error } = await sb.rpc('approve_match', { p_match_id: id });
  if (error) alert(error.message);
  loadAllAdmin();
}

// ---------------- all matches / scheduling ----------------

const STATUS_LABEL_ADMIN = {
  pending_teams: { text: 'TBD', cls: 'badge-eliminated' },
  awaiting_schedule: { text: 'Needs schedule', cls: 'badge-pending' },
  scheduled: { text: 'Scheduled', cls: 'badge-live' },
  pending_approval: { text: 'Pending approval', cls: 'badge-pending' },
  approved: { text: 'Final', cls: 'badge-approved' },
  disputed: { text: 'Disputed', cls: 'badge-disputed' }
};

function renderMatchesAdmin(){
  const wrap = document.getElementById('matchesAdminList');
  if (!adminMatches.length) {
    wrap.innerHTML = `<div class="empty-state">No fixtures yet — build Round 1 first.</div>`;
    return;
  }
  let matches = adminMatches;
  if (matchesSearchQuery) {
    matches = matches.filter(m =>
      (m.team1?.team_name || '').toLowerCase().includes(matchesSearchQuery) ||
      (m.team2?.team_name || '').toLowerCase().includes(matchesSearchQuery)
    );
  }
  if (!matches.length) {
    wrap.innerHTML = `<div class="empty-state">No fixtures match "${escapeHtml(matchesSearchQuery)}".</div>`;
    return;
  }
  const rounds = {};
  matches.forEach(m => { (rounds[m.round] = rounds[m.round] || []).push(m); });
  const roundNums = Object.keys(rounds).map(Number).sort((a,b) => a-b);

  wrap.innerHTML = roundNums.map(r => `
    <h3 style="margin-top:28px;">${rounds[r][0].round_name || ('Round ' + r)}</h3>
    ${rounds[r].sort((a,b)=>a.match_index-b.match_index).map(m => `
      <div class="glass list-item">
        <div>
          <div style="font-weight:600;">${escapeHtml(m.team1?.team_name || 'TBD')} ${m.is_bye ? '<span class="hint">(bye)</span>' : 'vs ' + escapeHtml(m.team2?.team_name || 'TBD')}</div>
          <div class="pill-row" style="margin-top:6px;">
            <span class="badge ${(STATUS_LABEL_ADMIN[m.status]||{}).cls||''}">${(STATUS_LABEL_ADMIN[m.status]||{}).text||m.status}</span>
            ${m.scheduled_time ? `<span class="hint mono">${new Date(m.scheduled_time).toLocaleString()}</span>` : ''}
            ${m.status === 'approved' ? `<span class="hint mono">${m.team1_score} - ${m.team2_score}</span>` : ''}
            ${m.status === 'approved' && m.approved_at ? `<span class="hint">Approved ${new Date(m.approved_at).toLocaleString()}</span>` : ''}
          </div>
        </div>
        <div class="pill-row">
          ${m.is_bye && m.status !== 'approved' ? `<button class="btn btn-sm btn-primary" data-confirm-bye="${m.id}">Confirm bye</button>` : ''}
          ${!m.is_bye && m.team1_id && m.team2_id && !['approved'].includes(m.status) ? `
            <input type="datetime-local" id="sched-${m.id}" style="width:auto;">
            <button class="btn btn-sm" data-schedule="${m.id}">Set time</button>
          ` : ''}
          ${!['approved'].includes(m.status) ? `<button class="btn btn-sm btn-danger" data-del="${m.id}">Delete</button>` : ''}
        </div>
      </div>
    `).join('')}
  `).join('');

  wrap.querySelectorAll('[data-schedule]').forEach(btn => btn.addEventListener('click', () => setSchedule(btn.dataset.schedule)));
  wrap.querySelectorAll('[data-confirm-bye]').forEach(btn => btn.addEventListener('click', () => confirmBye(btn.dataset.confirmBye)));
  wrap.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => deleteMatch(btn.dataset.del)));
}

async function setSchedule(id){
  const val = document.getElementById(`sched-${id}`).value;
  if (!val) return;
  await sb.from('matches').update({ scheduled_time: new Date(val).toISOString(), status: 'scheduled' }).eq('id', id);
  loadMatchesAdmin().then(renderMatchesAdmin);
}

// ---------------- settings ----------------

async function saveSettings(e){
  e.preventDefault();
  const msg = document.getElementById('settingsMsg');
  msg.className = 'msg';
  const name = document.getElementById('settingsName').value.trim();
  const { error } = await sb.from('tournament_settings').update({ tournament_name: name }).eq('id', 1);
  if (error) { msg.classList.add('show','msg-err'); msg.textContent = error.message; return; }
  msg.classList.add('show','msg-ok'); msg.textContent = 'Saved.';
}

// ---------------- danger zone: full reset ----------------

async function resetTournament(){
  const msg = document.getElementById('resetMsg');
  msg.className = 'msg';

  const typed = prompt(
    `This wipes EVERYTHING: every team, every match, every score — and puts the tournament back to "registration" with zero teams. This cannot be undone.\n\nType RESET to confirm.`
  );
  if (typed !== 'RESET') return;

  const btn = document.getElementById('resetTournamentBtn');
  btn.disabled = true; btn.innerHTML = '<span class="loader"></span> Resetting…';

  try {
    const { error: mErr } = await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (mErr) throw mErr;

    const { error: tErr } = await sb.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (tErr) throw tErr;

    const { error: sErr } = await sb.from('tournament_settings')
      .update({ status: 'registration', total_rounds: null, champion_id: null })
      .eq('id', 1);
    if (sErr) throw sErr;

    msg.classList.add('show', 'msg-ok');
    msg.textContent = 'Tournament reset. Registration is open again with no teams.';
    loadAllAdmin();
  } catch (err) {
    msg.classList.add('show', 'msg-err');
    msg.textContent = err.message || 'Reset failed — check the console.';
  } finally {
    btn.disabled = false; btn.textContent = 'Reset tournament';
  }
}

// ---------------- helpers ----------------

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
