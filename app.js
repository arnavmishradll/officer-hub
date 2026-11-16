/* Officer Hub — main app (vanilla JS, no build step, GitHub Pages friendly) */
(async () => {
  let D = null; // same object as Store.data; loaded at the bottom of this file

  const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done'];
  const STATUS_SLUG = { 'Not Started': 'todo', 'In Progress': 'doing', 'Blocked': 'blocked', 'Done': 'done' };
  const STATUS_BADGE = { 'Not Started': 'u-later', 'In Progress': 'u-week', 'Blocked': 'u-overdue', 'Done': 'u-done' };
  const MAX_FILE_BYTES = (Store.remote ? 25 : 1.5) * 1024 * 1024;
  const APP_URL = location.origin + location.pathname;

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = () => D.officers.find(o => o.id === D.currentUserId) || D.officers[0];
  const isAdmin = () => !!me()?.isAdmin;
  const officer = id => D.officers.find(o => o.id === id);
  const oname = id => officer(id)?.name || 'Former officer';
  const first = id => oname(id).split(' ')[0];
  const task = id => D.tasks.find(t => t.id === id);
  const nowISO = () => new Date().toISOString();
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const persist = () => { if (!Store.save()) toast('Could not save — browser storage is full. Remove a large minutes file.'); };

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 2600);
  }
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(msg || 'Copied');
  }

  const ICON = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg>',
  };

  // ---------- dates ----------
  const pad = n => String(n).padStart(2, '0');
  const localISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => localISO(new Date());
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return localISO(d); };
  const nextDow = dow => addDays(((dow - new Date().getDay() + 7) % 7) || 7);
  const parseISO = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  function daysUntil(iso) {
    if (!iso) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((parseISO(iso) - t) / 86400000);
  }
  const fmtDate = iso => iso ? parseISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtShort = iso => iso ? parseISO(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
  const fmtDay = iso => parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  function relDue(iso) {
    const n = daysUntil(iso);
    if (n === null) return '';
    if (n === 0) return 'today'; if (n === 1) return 'tomorrow'; if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const s = (Date.now() - new Date(ts)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtTime(hm) {
    if (!hm) return '';
    const [h, m] = hm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m);
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

  // ---------- urgency (derived from due date + status, never stored) ----------
  const URGENCY_ORDER = { overdue: 0, today: 1, urgent: 2, week: 3, later: 4, none: 5, done: 6 };
  function urgency(t) {
    if (t.status === 'Done') return { key: 'done', label: 'Done' };
    const n = daysUntil(t.dueDate);
    if (n === null) return { key: 'none', label: 'No due date' };
    if (n < 0) return { key: 'overdue', label: `Overdue ${-n}d` };
    if (n === 0) return { key: 'today', label: 'Due today' };
    if (n <= 2) return { key: 'urgent', label: n === 1 ? 'Due tomorrow' : 'Urgent' };
    if (n <= 7) return { key: 'week', label: 'This week' };
    return { key: 'later', label: 'Upcoming' };
  }
  const badge = t => { const u = urgency(t); return `<span class="badge u-${u.key}">${esc(u.label)}</span>`; };

  // ---------- people ----------
  function hueOf(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function initials(name) {
    const p = String(name).replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function avatar(id, size = '') {
    const o = officer(id);
    if (!o) return `<span class="avatar ${size} ghost">?</span>`;
    return `<span class="avatar ${size}" style="--h:${hueOf(o.id)}" title="${esc(o.name)}">${esc(initials(o.name))}</span>`;
  }
  const personLink = id => `<a class="person" href="#person/${id}">${avatar(id, 'sm')}<span>${esc(oname(id))}</span></a>`;
  function avatarStack(ids, max = 4) {
    if (!ids?.length) return '';
    const shown = ids.slice(0, max).map(id => avatar(id, 'sm')).join('');
    const more = ids.length > max ? `<span class="avatar sm more">+${ids.length - max}</span>` : '';
    return `<span class="avatar-stack" title="${esc(ids.map(oname).join(', '))}">${shown}${more}</span>`;
  }

  // ---------- positions (officers who share a role, e.g. two Rush chairs) ----------
  // A task can be owned by a whole position: ownerId = "pos:<Role>". Everyone currently in that
  // role owns it, so a new chair picks it up automatically. Roles match ignoring case/extra spaces.
  const POS = 'pos:';
  const normRole = r => String(r || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const isPos = id => typeof id === 'string' && id.startsWith(POS);
  const posRole = id => id.slice(POS.length);
  const posId = role => POS + String(role).trim();
  const membersOf = role => D.officers.filter(o => normRole(o.role) && normRole(o.role) === normRole(role));
  function positions() { // roles held by 2+ officers
    const g = {};
    D.officers.forEach(o => { const k = normRole(o.role); if (k) (g[k] ||= []).push(o); });
    return Object.values(g).filter(os => os.length > 1).map(os => ({ id: posId(os[0].role), name: os[0].role.trim(), members: os }));
  }
  const posName = id => membersOf(posRole(id))[0]?.role.trim() || posRole(id);
  const assignees = t => isPos(t.ownerId) ? membersOf(posRole(t.ownerId)).map(o => o.id) : [t.ownerId];
  const isAssignee = (t, oid) => assignees(t).includes(oid);
  const ownerName = id => isPos(id) ? posName(id) : oname(id);
  const ownerShort = id => isPos(id) ? posName(id) : first(id);
  const coChairs = oid => { const o = officer(oid); return o && normRole(o.role) ? membersOf(o.role).filter(x => x.id !== oid) : []; };
  const posHref = role => `#position/${encodeURIComponent(String(role).trim())}`;
  const isPosTask = (t, role) => isPos(t.ownerId) && normRole(posRole(t.ownerId)) === normRole(role);
  function ownerLink(id) {
    if (!isPos(id)) return personLink(id);
    return `<a class="person" href="${posHref(posRole(id))}">${avatarStack(membersOf(posRole(id)).map(o => o.id), 3) || avatar(null, 'sm')}<span>${esc(posName(id))}</span></a>`;
  }
  const posTag = t => isPos(t.ownerId) ? `<span class="pos-tag" title="Shared by everyone in this position">👥 ${esc(posName(t.ownerId))}</span>` : '';
  const roleLink = o => coChairs(o.id).length ? `<a class="role-link" href="${posHref(o.role)}">👥 ${esc(o.role.trim())}</a>` : esc(o.role || '');

  // Co-chairs can update each other's tasks, since the work is shared.
  const canEdit = t => isAdmin() || isAssignee(t, me().id) || t.collaboratorIds.includes(me().id) || t.createdBy === me().id
    || coChairs(me().id).some(o => isAssignee(t, o.id));
  const canDelete = t => isAdmin() || isAssignee(t, me().id) || t.createdBy === me().id;

  // ---------- activity / comments ----------
  const commentsFor = id => (D.comments || []).filter(c => c.taskId === id).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const commentCount = id => (D.comments || []).filter(c => c.taskId === id && c.kind === 'comment').length;
  function logActivity(taskId, kind, body) {
    if (!Store.features.comments) return;
    (D.comments ||= []).push({ id: Store.uid(), taskId, authorId: me().id, body, kind, createdAt: nowISO() });
  }
  function setStatus(t, status) {
    if (t.status === status) return false;
    t.status = status; t.updatedAt = nowISO();
    t.completedAt = status === 'Done' ? nowISO() : null;
    logActivity(t.id, 'status', status);
    return true;
  }

  // ---------- stats ----------
  const isPast = m => daysUntil(m.date) < 0;
  const attendanceTaken = m => Object.values(m.attendance || {}).some(Boolean);
  function personStats(oid) {
    const owned = D.tasks.filter(t => isAssignee(t, oid));
    const done = owned.filter(t => t.status === 'Done');
    const timed = done.filter(t => t.dueDate && t.completedAt);
    const onTime = timed.filter(t => localISO(new Date(t.completedAt)) <= t.dueDate).length;
    const tracked = D.meetings.filter(m => isPast(m) && attendanceTaken(m));
    const attended = tracked.filter(m => m.attendance?.[oid]).length;
    return {
      owned, done,
      open: owned.length - done.length,
      overdue: owned.filter(t => urgency(t).key === 'overdue').length,
      blocked: owned.filter(t => t.status === 'Blocked').length,
      involved: D.tasks.filter(t => !isAssignee(t, oid) && t.collaboratorIds.includes(oid)),
      pct: owned.length ? Math.round(done.length / owned.length * 100) : null,
      onTimePct: timed.length ? Math.round(onTime / timed.length * 100) : null,
      attended, tracked: tracked.length,
      attPct: tracked.length ? Math.round(attended / tracked.length * 100) : null,
    };
  }

  // ---------- sorting ----------
  function sortTasks(list, key = 'due', dir = 1) {
    const val = t => ({
      title: t.title.toLowerCase(),
      owner: ownerName(t.ownerId).toLowerCase(),
      due: t.dueDate || '9999-99-99',
      urgency: URGENCY_ORDER[urgency(t).key] * 100000 + (daysUntil(t.dueDate) ?? 99999),
      status: STATUSES.indexOf(t.status),
    }[key]);
    return [...list].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  }
  const defaultSort = list => [...list].sort((a, b) =>
    (a.status === 'Done') - (b.status === 'Done') ||
    URGENCY_ORDER[urgency(a).key] - URGENCY_ORDER[urgency(b).key] ||
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  // ---------- routing ----------
  const views = { my: renderMy, master: renderMaster, people: renderPeople, person: renderPerson, position: renderPosition, meetings: renderMeetings, minutes: renderMinutes };
  const ui = {
    master: { q: '', officer: '', status: 'open', urgency: '', sort: 'urgency', dir: 1, view: 'list' },
    people: { q: '', sort: 'name' },
    meetingId: null, minutesId: null, myShowDone: false, personShowDone: false,
    rsvpDraft: null, liveRefresh: null, lastHash: null,
  };

  function currentView() {
    const [raw, arg] = location.hash.slice(1).split('/');
    let v = raw === 'officers' ? 'people' : (raw || 'my');
    if (v === 'master' && !isAdmin()) v = 'my';
    if (!views[v]) v = 'my';
    return [v, arg];
  }
  function route() {
    if (!D) return;
    const [v, arg] = currentView();
    const tab = v === 'person' || v === 'position' ? 'people' : v;
    $$('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.view === tab));
    $$('.admin-only').forEach(el => (el.hidden = !isAdmin()));
    views[v](arg);
    if (ui.lastHash !== location.hash) { ui.lastHash = location.hash; window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', route);
  const rerender = () => route();

  function renderUserSelect() {
    const sel = $('#userSelect');
    sel.innerHTML = D.officers.map(o => `<option value="${o.id}" ${o.id === D.currentUserId ? 'selected' : ''}>${esc(o.name)}${o.isAdmin ? ' ★' : ''}</option>`).join('');
  }
  $('#userSelect').addEventListener('change', e => { D.currentUserId = e.target.value; persist(); route(); toast(`Viewing as ${oname(e.target.value)}`); });

  // ---------- task table ----------
  function statusSelect(t) {
    return canEdit(t)
      ? `<select class="s-select" data-status="${t.id}">${STATUSES.map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`
      : `<span class="badge ${STATUS_BADGE[t.status]}">${esc(t.status)}</span>`;
  }
  function taskRow(t, showOwner) {
    const done = t.status === 'Done';
    const cc = commentCount(t.id);
    return `
      <tr class="clickable ${done ? 'done' : ''}" data-task="${t.id}">
        <td class="check-cell">${canEdit(t) ? `<button class="check ${done ? 'on' : ''}" data-check="${t.id}" title="${done ? 'Mark not done' : 'Mark done'}" aria-label="Toggle done">${ICON.check}</button>` : ''}</td>
        <td class="title-cell">
          <strong>${esc(t.title)}</strong>${showOwner ? '' : posTag(t)}${cc ?`<span class="ccount" title="${plural(cc, 'update')}">${ICON.chat}${cc}</span>` : ''}
          ${t.notes ? `<div class="muted small clamp">${esc(t.notes)}</div>` : ''}
        </td>
        ${showOwner ? `<td>${ownerLink(t.ownerId)}</td>` : ''}
        <td>${avatarStack(t.collaboratorIds) || '<span class="muted">—</span>'}</td>
        <td class="due-cell"><div>${fmtShort(t.dueDate)}</div>${t.dueDate && !done ? `<div class="muted small">${relDue(t.dueDate)}</div>` : ''}</td>
        <td>${badge(t)}</td>
        <td>${statusSelect(t)}</td>
      </tr>`;
  }
  function taskTable(tasks, { showOwner = true, sortable = false, sort, dir, groupBy = null, empty = 'Nothing here. 🎉' } = {}) {
    const cols = showOwner ? 7 : 6;
    const th = (key, label) => sortable
      ? `<th class="sortable" data-sort="${key}">${label}${sort === key ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`
      : `<th>${label}</th>`;
    let body;
    if (!tasks.length) body = `<tr><td colspan="${cols}" class="empty">${empty}</td></tr>`;
    else if (!groupBy) body = tasks.map(t => taskRow(t, showOwner)).join('');
    else {
      const groups = {};
      tasks.forEach(t => (groups[t.ownerId] ||= []).push(t));
      body = Object.entries(groups)
        .sort((a, b) => ownerName(a[0]).localeCompare(ownerName(b[0])))
        .map(([oid, ts]) => `<tr class="group-row"><td colspan="${cols}">${ownerLink(oid)}${isPos(oid) ? ' <span class="muted small">(shared)</span>' : ''} <span class="muted small">· ${plural(ts.length, 'task')}</span></td></tr>${ts.map(t => taskRow(t, showOwner)).join('')}`)
        .join('');
    }
    return `
      <div class="table-wrap"><table class="tasks">
        <thead><tr>
          <th class="check-cell"></th>
          ${th('title', 'Task')}
          ${showOwner ? th('owner', 'Owner') : ''}
          <th>With</th>
          ${th('due', 'Due')}
          ${th('urgency', 'Urgency')}
          ${th('status', 'Status')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table></div>`;
  }

  // Shared wiring for task rows, board cards, checkoffs and status menus.
  function wireTasks(root, after = rerender) {
    $$('[data-status]', root).forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', e => {
        const t = task(sel.dataset.status);
        setStatus(t, e.target.value); persist(); after(); toast(`“${t.title}” → ${t.status}`);
      });
    });
    $$('[data-check]', root).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const t = task(b.dataset.check);
      const finishing = t.status !== 'Done';
      setStatus(t, finishing ? 'Done' : 'Not Started');
      persist();
      b.classList.toggle('on', finishing);
      b.closest('tr, .card')?.classList.add(finishing ? 'completing' : 'reopening');
      if (finishing) toast(`✓ ${t.title}`);
      setTimeout(after, finishing ? 420 : 150);
    }));
    $$('[data-task]', root).forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('a, button, select, input, label')) return;
      openTaskModal(task(el.dataset.task), after);
    }));
  }
  function wireSort(root, state, after) {
    $$('th[data-sort]', root).forEach(th => th.onclick = () => {
      if (state.sort === th.dataset.sort) state.dir *= -1; else { state.sort = th.dataset.sort; state.dir = 1; }
      after();
    });
  }

  // ---------- board (kanban) ----------
  function boardView(list) {
    const card = t => `
      <div class="card ${t.status === 'Done' ? 'done' : ''}" data-task="${t.id}" draggable="${canEdit(t)}">
        <div class="card-top">
          ${canEdit(t) ? `<button class="check mini ${t.status === 'Done' ? 'on' : ''}" data-check="${t.id}" aria-label="Toggle done">${ICON.check}</button>` : ''}
          <div class="card-title">${esc(t.title)}</div>
        </div>
        <div class="card-meta">${isPos(t.ownerId) ? avatarStack(assignees(t), 2) : avatar(t.ownerId, 'sm')}${avatarStack(t.collaboratorIds, 2)}<span class="spacer"></span>${commentCount(t.id) ? `<span class="ccount">${ICON.chat}${commentCount(t.id)}</span>` : ''}${badge(t)}</div>
      </div>`;
    return `<div class="board">${STATUSES.map(s => {
      let items = defaultSort(list.filter(t => t.status === s));
      if (s === 'Done') items = items.sort((a, b) => (b.completedAt || b.updatedAt || '').localeCompare(a.completedAt || a.updatedAt || ''));
      const shown = s === 'Done' ? items.slice(0, 12) : items;
      return `<div class="col" data-col="${s}">
        <div class="col-head"><span class="sdot s-${STATUS_SLUG[s]}"></span>${s}<span class="muted">${items.length}</span></div>
        <div class="col-body">${shown.map(card).join('') || '<div class="col-empty">Drag tasks here</div>'}
        ${items.length > shown.length ? `<div class="col-empty">+${items.length - shown.length} more done</div>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
  }
  function wireBoard(root, after) {
    let dragId = null;
    $$('.card[draggable="true"]', root).forEach(c => {
      c.addEventListener('dragstart', e => { dragId = c.dataset.task; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    $$('.col', root).forEach(col => {
      col.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        const t = task(dragId); dragId = null;
        if (t && setStatus(t, col.dataset.col)) { persist(); after(); toast(`“${t.title}” → ${t.status}`); }
      });
    });
  }

  // ---------- copy-to-GroupMe text ----------
  function recapText() {
    const open = D.tasks.filter(t => t.status !== 'Done');
    const by = k => defaultSort(open.filter(t => urgency(t).key === k));
    const line = t => `• ${ownerShort(t.ownerId)}:${t.title}${t.dueDate ? ` (${fmtShort(t.dueDate)})` : ''}`;
    const sec = (title, list) => list.length ? `\n${title} (${list.length})\n${list.map(line).join('\n')}\n` : '';
    const doneWeek = D.tasks.filter(t => t.status === 'Done' && t.completedAt && (Date.now() - new Date(t.completedAt)) < 7 * 86400000);
    return `📋 Officer recap, ${fmtDay(todayISO())}\n`
      + (doneWeek.length ? `\n✅ ${plural(doneWeek.length, 'task')} finished this week. Nice work.\n` : '')
      + sec('🔴 Overdue', by('overdue'))
      + sec('🟠 Due today', by('today'))
      + sec('🟡 Due this week', [...by('urgent'), ...by('week')])
      + sec('⛔ Blocked', open.filter(t => t.status === 'Blocked'))
      + `\nUpdate your tasks: ${APP_URL}`;
  }
  // Reminder text for one officer, or for everyone in a position (pass several ids).
  function nudgeText(oids, label) {
    oids = [].concat(oids);
    const pressing = t => t.status === 'Blocked' || ['overdue', 'today', 'urgent', 'week'].includes(urgency(t).key);
    const list = defaultSort(D.tasks.filter(t => t.status !== 'Done' && oids.some(o => isAssignee(t, o)) && pressing(t)));
    if (!list.length) return null;
    const names = oids.map(first);
    const who = names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names.at(-1) : names[0];
    return `Hey ${who} 👋 quick check-in on ${label ? `the ${label} tasks` : 'your officer tasks'}:\n`
      + list.map(t => `• ${t.title}${oids.length > 1 ? ` (${ownerShort(t.ownerId)})` : ''}: ${t.status === 'Blocked' ? 'blocked' : urgency(t).label.toLowerCase()}${t.dueDate ? `, ${fmtShort(t.dueDate)}` : ''}`).join('\n')
      + `\n\nUpdate them here: ${APP_URL}`;
  }

  // ---------- My Tasks ----------
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const nextMeeting = () => [...D.meetings].filter(m => daysUntil(m.date) >= 0).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];

  function meetingCard(m) {
    const r = m.rsvps?.[me().id];
    const n = daysUntil(m.date);
    const when = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(m.date);
    const d = parseISO(m.date);
    return `
      <div class="panel next-mtg"><div class="panel-body mtg-row">
        <div class="cal"><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span><b>${d.getDate()}</b></div>
        <div class="mtg-info">
          <div class="muted small">Next meeting · ${when}${m.time ? ' · ' + fmtTime(m.time) : ''}${m.location ? ' · ' + esc(m.location) : ''}</div>
          <div class="mtg-title">${esc(m.title)}</div>
          <div class="small">${r?.status === 'yes' ? '<span class="badge u-done">You\'re going</span>'
            : r?.status === 'no' ? '<span class="badge u-overdue">You can\'t make it</span> <span class="muted">· update submitted</span>'
            : '<span class="badge u-urgent">You haven\'t RSVP\'d</span>'}</div>
        </div>
        <div class="mtg-actions">
          ${r?.status !== 'yes' ? '<button class="sm" data-q-yes>✓ Going</button>' : ''}
          ${r?.status !== 'no' ? '<button class="sm" data-q-no>Can\'t make it</button>' : ''}
          <a class="btn sm" href="#meetings" data-q-open>Details</a>
        </div>
      </div></div>`;
  }
  function wireMeetingCard(m) {
    if (!m) return;
    $('[data-q-yes]') && ($('[data-q-yes]').onclick = () => { m.rsvps[me().id] = { status: 'yes', at: nowISO() }; persist(); rerender(); toast('RSVP saved — see you there'); });
    $('[data-q-no]') && ($('[data-q-no]').onclick = () => { ui.meetingId = m.id; ui.rsvpDraft = { mid: m.id, status: 'no' }; location.hash = '#meetings'; });
    $('[data-q-open]') && ($('[data-q-open]').onclick = () => { ui.meetingId = m.id; });
  }

  function renderMy() {
    const u = me();
    const mine = D.tasks.filter(t => isAssignee(t, u.id));
    const shared = D.tasks.filter(t => !isAssignee(t, u.id) && t.collaboratorIds.includes(u.id));
    const handedOut = D.tasks.filter(t => t.createdBy === u.id && !isAssignee(t, u.id));
    const partners = coChairs(u.id);
    const partnerTasks = partners.length ? D.tasks.filter(t => partners.some(p => t.ownerId === p.id) && !t.collaboratorIds.includes(u.id)) : [];
    const open = [...mine, ...shared].filter(t => t.status !== 'Done');
    const count = k => open.filter(t => urgency(t).key === k).length;
    const over = count('overdue'), soon = count('today') + count('urgent');
    const summary = !open.length ? "You're all caught up. 🎉"
      : ([over && `<b class="t-bad">${plural(over, 'overdue task')}</b>`, soon && `<b class="t-warn">${soon} due in the next 2 days</b>`].filter(Boolean).join(' and ')
        || `${plural(open.length, 'open task')}, nothing urgent.`);
    const filt = list => defaultSort(ui.myShowDone ? list : list.filter(t => t.status !== 'Done'));
    const handedOpen = handedOut.filter(t => t.status !== 'Done');
    const m = nextMeeting();

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>${greeting()}, ${esc(first(u.id))}</h1><div class="sub muted">${summary}</div></div>
        <div class="toolbar" style="margin:0">
          <label class="toggle"><input type="checkbox" id="showDone" ${ui.myShowDone ? 'checked' : ''}/> Show completed</label>
          <button class="primary" data-new-task>+ New task</button>
        </div>
      </div>
      ${m ? meetingCard(m) : ''}
      <div class="stats">
        <div class="stat"><div class="num">${open.length}</div><div class="lbl">Open tasks</div></div>
        <div class="stat bad"><div class="num">${over}</div><div class="lbl">Overdue</div></div>
        <div class="stat warn"><div class="num">${soon}</div><div class="lbl">Due in ≤ 2 days</div></div>
        <div class="stat good"><div class="num">${[...mine, ...shared].filter(t => t.status === 'Done').length}</div><div class="lbl">Completed</div></div>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h2>Assigned to me</h2><span class="muted small">${plural(mine.filter(t => t.status !== 'Done').length, 'open task')}</span></div>
          ${taskTable(filt(mine), { showOwner: false, empty: 'Nothing on your plate. 🎉' })}
        </div>
        ${partners.length ? `
        <div class="panel">
          <div class="panel-head"><h2><a class="role-link" href="${posHref(u.role)}">👥 ${esc(u.role.trim())}</a> co-chair${partners.length > 1 ? 's' : ''}</h2>
            <span class="muted small">${partners.map(p => esc(first(p.id))).join(' & ')}'s tasks · you can update these too</span></div>
          ${taskTable(filt(partnerTasks), { showOwner: true, empty: `Nothing open for ${esc(partners.map(p => first(p.id)).join(' & '))}.` })}
        </div>` : ''}
        <div class="panel">
          <div class="panel-head"><h2>Shared with me</h2><span class="muted small">Tasks other officers added you to</span></div>
          ${taskTable(filt(shared), { showOwner: true, empty: 'No one has looped you in yet.' })}
        </div>
        ${handedOut.length ? `
        <div class="panel">
          <div class="panel-head"><h2>I assigned</h2><span class="muted small">${plural(handedOpen.length, 'open task')} you handed out · ${handedOpen.filter(t => urgency(t).key === 'overdue').length} overdue</span></div>
          ${taskTable(filt(handedOut), { showOwner: true, empty: 'Everything you assigned is done. 🎉' })}
        </div>` : ''}
      </div>`;
    $('#showDone').onchange = e => { ui.myShowDone = e.target.checked; renderMy(); };
    wireMeetingCard(m);
    wireTasks($('#view'));
  }

  // ---------- Master list ----------
  function renderMaster() {
    const f = ui.master;
    const base = D.tasks.filter(t => {
      if (f.officer) {
        if (isPos(f.officer)) { if (!isPosTask(t, posRole(f.officer)) && !membersOf(posRole(f.officer)).some(m => m.id === t.ownerId)) return false; }
        else if (!isAssignee(t, f.officer) && !t.collaboratorIds.includes(f.officer)) return false;
      }
      if (f.urgency && urgency(t).key !== f.urgency) return false;
      if (f.q) {
        const hay = `${t.title} ${t.notes} ${ownerName(t.ownerId)} ${assignees(t).map(oname).join(' ')} ${t.collaboratorIds.map(oname).join(' ')}`.toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
    const list = sortTasks(base.filter(t => {
      if (f.status === 'open' && t.status === 'Done') return false;
      if (f.status && f.status !== 'open' && t.status !== f.status) return false;
      return true;
    }), f.sort, f.dir);

    const all = D.tasks;
    const openAll = all.filter(t => t.status !== 'Done');
    const by = k => openAll.filter(t => urgency(t).key === k).length;
    // keep co-chairs next to each other
    const roleIndex = {};
    D.officers.forEach((o, i) => { const k = normRole(o.role) || o.id; if (!(k in roleIndex)) roleIndex[k] = i; });
    const team = D.officers.map((o, i) => ({ o, s: personStats(o.id), k: roleIndex[normRole(o.role) || o.id], i }))
      .sort((a, b) => a.k - b.k || a.i - b.i);
    const filtersOn = f.q || f.officer || f.urgency || f.status !== 'open';

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>Master List</h1><div class="sub muted">Every officer's tasks in one place</div></div>
        <div class="toolbar" style="margin:0">
          <button id="recap" title="Copy a summary to paste in GroupMe">${ICON.copy} Copy recap</button>
          <button id="csv">Export CSV</button>
          <button class="primary" data-new-task>+ Assign task</button>
        </div>
      </div>
      <div class="stats">
        <div class="stat clickable" data-quick="open"><div class="num">${openAll.length}</div><div class="lbl">Open tasks</div></div>
        <div class="stat bad clickable" data-quick="overdue"><div class="num">${by('overdue')}</div><div class="lbl">Overdue</div></div>
        <div class="stat warn clickable" data-quick="today"><div class="num">${by('today')}</div><div class="lbl">Due today</div></div>
        <div class="stat clickable" data-quick="week"><div class="num">${by('urgent') + by('week')}</div><div class="lbl">Due this week</div></div>
        <div class="stat clickable" data-quick="Blocked"><div class="num">${all.filter(t => t.status === 'Blocked').length}</div><div class="lbl">Blocked</div></div>
        <div class="stat good"><div class="num">${all.length ? Math.round(all.filter(t => t.status === 'Done').length / all.length * 100) : 0}%</div><div class="lbl">Overall completion</div></div>
      </div>

      <div class="panel" style="margin-bottom:18px">
        <div class="panel-head"><h2>Team</h2><span class="muted small">Tap a person to see everything on their plate</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Officer</th><th>Role</th><th class="num">Open</th><th class="num">Overdue</th><th class="num">Blocked</th><th class="num">Attendance</th><th>Completion</th><th></th></tr></thead>
          <tbody>${team.map(({ o, s }) => `
            <tr class="clickable" data-person="${o.id}">
              <td>${personLink(o.id)}</td>
              <td class="muted">${roleLink(o)}</td>
              <td class="num">${s.open}</td>
              <td class="num">${s.overdue ? `<span class="badge u-overdue">${s.overdue}</span>` : '<span class="muted">0</span>'}</td>
              <td class="num">${s.blocked || '<span class="muted">0</span>'}</td>
              <td class="num">${s.attPct === null ? '<span class="muted">—</span>' : s.attPct + '%'}</td>
              <td><div class="pbar"><div class="progress"><div style="width:${s.pct ?? 0}%"></div></div><span class="small muted">${s.pct ?? 0}%</span></div></td>
              <td style="text-align:right"><button class="sm ghost" data-assign-to="${o.id}">+ Assign</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>All tasks</h2>
          <div class="seg" id="viewSeg">${[['list', 'List'], ['person', 'By person'], ['board', 'Board']].map(([k, l]) => `<button class="${f.view === k ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>
        </div>
        <div class="panel-body" style="padding-bottom:4px">
          <div class="toolbar">
            <input type="search" id="q" placeholder="Search tasks, notes, people…" value="${esc(f.q)}" />
            <select id="fOfficer"><option value="">All officers</option>
              ${positions().length ? `<optgroup label="Positions">${positions().map(p => `<option value="${esc(p.id)}" ${f.officer === p.id ? 'selected' : ''}>👥 ${esc(p.name)}</option>`).join('')}</optgroup>` : ''}
              <optgroup label="People">${D.officers.map(o => `<option value="${o.id}" ${f.officer === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</optgroup>
            </select>
            ${f.view !== 'board' ? `<select id="fStatus">
              <option value="" ${f.status === '' ? 'selected' : ''}>Any status</option>
              <option value="open" ${f.status === 'open' ? 'selected' : ''}>Open (not done)</option>
              ${STATUSES.map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>` : ''}
            <select id="fUrg">
              <option value="">Any urgency</option>
              ${[['overdue', 'Overdue'], ['today', 'Due today'], ['urgent', 'Urgent (1–2 days)'], ['week', 'This week'], ['later', 'Upcoming'], ['none', 'No due date']]
                .map(([k, l]) => `<option value="${k}" ${f.urgency === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            ${filtersOn ? '<button class="ghost sm" id="clear">Clear filters</button>' : ''}
            <span class="muted small" style="margin-left:auto">${f.view === 'board' ? plural(base.length, 'task') : `${list.length} shown`}</span>
          </div>
        </div>
        ${f.view === 'board' ? boardView(base) : taskTable(list, { showOwner: true, sortable: true, sort: f.sort, dir: f.dir, groupBy: f.view === 'person' ? 'owner' : null, empty: 'No tasks match these filters.' })}
      </div>`;

    const v = $('#view');
    $('#csv').onclick = () => exportCSV(list);
    $('#recap').onclick = () => copyText(recapText(), 'Recap copied. Paste it in GroupMe');
    $('#q').oninput = e => { f.q = e.target.value; const pos = e.target.selectionStart; renderMaster(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); };
    $('#fOfficer').onchange = e => { f.officer = e.target.value; renderMaster(); };
    $('#fStatus') && ($('#fStatus').onchange = e => { f.status = e.target.value; renderMaster(); });
    $('#fUrg').onchange = e => { f.urgency = e.target.value; renderMaster(); };
    $('#clear') && ($('#clear').onclick = () => { Object.assign(f, { q: '', officer: '', status: 'open', urgency: '' }); renderMaster(); });
    $$('#viewSeg button').forEach(b => b.onclick = () => { f.view = b.dataset.v; renderMaster(); });
    $$('tr[data-person]', v).forEach(tr => tr.onclick = e => { if (!e.target.closest('a, button')) location.hash = `#person/${tr.dataset.person}`; });
    $$('[data-assign-to]', v).forEach(b => b.onclick = e => { e.stopPropagation(); openTaskModal(null, renderMaster, { ownerId: b.dataset.assignTo }); });
    $$('[data-quick]', v).forEach(s => s.onclick = () => {
      const k = s.dataset.quick;
      Object.assign(f, { status: 'open', urgency: '' });
      if (k === 'Blocked') { f.status = 'Blocked'; if (f.view === 'board') f.view = 'list'; }
      else if (k !== 'open') f.urgency = k;
      renderMaster();
      $('#viewSeg').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    wireSort(v, f, renderMaster);
    wireTasks(v, renderMaster);
    if (f.view === 'board') wireBoard(v, renderMaster);
  }

  function exportCSV(list) {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Task', 'Owner', 'Shared with', 'Due', 'Urgency', 'Status', 'Added by', 'Completed', 'Notes']]
      .concat(list.map(t => [t.title, isPos(t.ownerId) ? `${posName(t.ownerId)} (${assignees(t).map(oname).join(' & ')})` : oname(t.ownerId), t.collaboratorIds.map(oname).join('; '), t.dueDate, urgency(t).label, t.status, oname(t.createdBy), t.completedAt ? localISO(new Date(t.completedAt)) : '', t.notes]));
    download(`officer-tasks-${todayISO()}.csv`, rows.map(r => r.map(cell).join(',')).join('\n'), 'text/csv');
  }
  function download(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- People ----------
  function personCard(o, s) {
    return `
      <a class="pcard" href="#person/${o.id}">
        ${avatar(o.id, 'lg')}
        <div class="pcard-name">${esc(o.name)}${o.isAdmin ? ' <span class="star" title="Admin">★</span>' : ''}${o.id === me().id ? ' <span class="chip">you</span>' : ''}</div>
        <div class="muted small">${esc(o.role || '')}</div>
        <div class="pcard-stats">
          <span><b>${s.open}</b> open</span>
          ${s.overdue ? `<span class="t-bad"><b>${s.overdue}</b> overdue</span>` : ''}
          ${s.attPct !== null ? `<span><b>${s.attPct}%</b> attend.</span>` : ''}
        </div>
        <div class="progress" title="${s.pct ?? 0}% of their tasks done"><div style="width:${s.pct ?? 0}%"></div></div>
      </a>`;
  }

  function renderPeople() {
    const p = ui.people;
    const admin = isAdmin();
    const rows = D.officers.map(o => ({ o, s: personStats(o.id) }));
    let list = rows.filter(({ o }) => !p.q || `${o.name} ${o.role}`.toLowerCase().includes(p.q.toLowerCase()));
    const sorters = {
      name: (a, b) => a.o.name.localeCompare(b.o.name),
      role: (a, b) => (a.o.role || '').localeCompare(b.o.role || '') || a.o.name.localeCompare(b.o.name),
      open: (a, b) => b.s.open - a.s.open,
      overdue: (a, b) => b.s.overdue - a.s.overdue || b.s.open - a.s.open,
      attendance: (a, b) => (b.s.attPct ?? -1) - (a.s.attPct ?? -1),
    };
    list.sort(sorters[p.sort] || sorters.name);
    // Co-chairs are shown together, unless you're searching or sorting by a stat.
    const pos = positions();
    const grouped = pos.length && !p.q && (p.sort === 'name' || p.sort === 'role');
    const inPos = new Set(pos.flatMap(g => g.members.map(m => m.id)));

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>People</h1><div class="sub muted">${plural(D.officers.length, 'officer')} · tap anyone to see what they're working on</div></div>
        ${admin ? '<button class="primary" id="addOfficer">+ Add officer</button>' : ''}
      </div>

      <div class="toolbar">
        <input type="search" id="pq" placeholder="Search people or roles…" value="${esc(p.q)}" />
        <select id="psort">
          ${[['name', 'Sort: Name'], ['role', 'Sort: Role'], ['overdue', 'Sort: Most overdue'], ['open', 'Sort: Most open tasks'], ['attendance', 'Sort: Attendance']]
            .map(([k, l]) => `<option value="${k}" ${p.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${grouped ? `
        <div class="pos-groups">${pos.map(g => {
          const sharedOpen = D.tasks.filter(t => isPosTask(t, g.name) && t.status !== 'Done').length;
          return `<div class="pos-group">
            <a class="pos-group-head" href="${posHref(g.name)}">
              <span class="pos-group-name">👥 ${esc(g.name)}</span>
              <span class="muted small">${plural(sharedOpen, 'shared task')} open ›</span>
            </a>
            <div class="pos-cards">${g.members.map(o => personCard(o, personStats(o.id))).join('')}</div>
          </div>`;
        }).join('')}</div>
        <h3 class="section-h">Everyone else</h3>` : ''}
      <div class="pgrid">
        ${list.filter(({ o }) => !grouped || !inPos.has(o.id)).map(({ o, s }) => personCard(o, s)).join('') || '<div class="muted">No one matches that search.</div>'}
      </div>

      ${admin ? `
      <div class="panel" style="margin-top:24px">
        <div class="panel-head"><h2>Data</h2></div>
        <div class="panel-body">
          ${Store.remote
            ? `<p style="margin-top:0"><span class="badge u-done">Connected</span> Data is shared through Supabase. Every officer sees the same tasks, meetings and minutes, and changes show up live.</p>
               ${!Store.features.comments || !Store.features.completedAt ? `<div class="callout">Your database is on an older version. Re-run <code>supabase/schema.sql</code> in the Supabase SQL Editor to turn on task updates and on-time stats.</div>` : ''}`
            : `<p class="muted" style="margin-top:0"><span class="badge u-later">Local only</span> Data is saved in <strong>this browser only</strong>. Add your Supabase URL and key to <code>config.js</code> to share it.</p>`}
          <div class="toolbar">
            <button id="exp">Export backup (.json)</button>
            <button id="imp">Import backup</button><input type="file" id="impFile" accept=".json" hidden />
            ${Store.remote ? '' : '<button id="resetSample">Reload sample data</button>'}
            <button class="danger" id="wipe">Clear everything & start fresh</button>
          </div>
        </div>
      </div>` : ''}`;

    $('#pq').oninput = e => { p.q = e.target.value; const pos = e.target.selectionStart; renderPeople(); const q = $('#pq'); q.focus(); q.setSelectionRange(pos, pos); };
    $('#psort').onchange = e => { p.sort = e.target.value; renderPeople(); };
    if (!admin) return;
    $('#addOfficer').onclick = () => openOfficerModal(null);
    $('#exp').onclick = () => download(`officer-hub-backup-${todayISO()}.json`, JSON.stringify(D, null, 2), 'application/json');
    $('#imp').onclick = () => $('#impFile').click();
    $('#impFile').onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      file.text().then(txt => {
        try {
          const next = JSON.parse(txt);
          if (!Array.isArray(next.officers) || !Array.isArray(next.tasks)) throw new Error('bad file');
          next.meetings ||= []; next.comments ||= [];
          if (!confirm('Replace all current data with this backup?')) return;
          Store.replaceAll(next); D = Store.data; renderUserSelect(); route(); toast('Backup imported');
        } catch { toast('That file is not a valid Officer Hub backup'); }
      });
    };
    $('#resetSample') && ($('#resetSample').onclick = () => { if (confirm('Replace everything with the sample data?')) { D = Store.reset(); renderUserSelect(); route(); } });
    $('#wipe').onclick = () => { if (confirm(`Delete all tasks, meetings, minutes, and other officers${Store.remote ? ' FOR EVERYONE' : ''}? Export a backup first if you need it.`)) { D = Store.clearAll(); renderUserSelect(); route(); toast('Started fresh'); } };
  }

  // ---------- Position page (e.g. both Rush chairs together) ----------
  function renderPosition(arg) {
    const role = decodeURIComponent(arg || '');
    const members = membersOf(role);
    if (!members.length) { location.hash = '#people'; return; }
    const name = members[0].role.trim(), pid = posId(name);
    const ids = members.map(m => m.id);
    const admin = isAdmin(), mine = ids.includes(me().id);
    const sharedAll = D.tasks.filter(t => isPosTask(t, name));
    const indivAll = D.tasks.filter(t => ids.includes(t.ownerId));
    const shared = defaultSort(sharedAll.filter(t => t.status !== 'Done'));
    const indiv = defaultSort(indivAll.filter(t => t.status !== 'Done'));
    const all = [...sharedAll, ...indivAll];
    const overdue = all.filter(t => urgency(t).key === 'overdue').length;
    const done = all.filter(t => t.status === 'Done').length;
    const names = members.map(m => esc(m.name));

    $('#view').innerHTML = `
      <a class="back" href="#people">‹ People</a>
      <div class="panel profile">
        <div class="profile-head">
          <span class="avatar-stack big">${ids.map(i => avatar(i, 'lg')).join('')}</span>
          <div class="profile-who">
            <h1>👥 ${esc(name)}</h1>
            <div class="muted">Shared position · ${names.slice(0, -1).join(', ')} &amp; ${names.at(-1)}</div>
          </div>
          <div class="profile-actions">
            ${admin || mine ? `<button class="primary" id="assignPos">+ Assign to ${esc(name)}</button>` : ''}
            ${admin ? `<button id="nudgePos">${ICON.copy} Copy reminder</button>` : ''}
          </div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="num">${shared.length}</div><div class="lbl">Shared tasks open</div></div>
        <div class="stat"><div class="num">${indiv.length}</div><div class="lbl">Individual tasks open</div></div>
        <div class="stat bad"><div class="num">${overdue}</div><div class="lbl">Overdue</div></div>
        <div class="stat good"><div class="num">${done}</div><div class="lbl">Completed</div></div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h2>Shared tasks</h2><span class="muted small">Owned by the whole position · any ${esc(name)} chair can update them</span></div>
          ${taskTable(shared, { showOwner: false, empty: `No shared ${esc(name)} tasks yet. Assign one to the position and both chairs will see it.` })}
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Individual tasks</h2><span class="muted small">Assigned to one chair · co-chairs can see and update these too</span></div>
          ${taskTable(indiv, { showOwner: true, empty: 'Nothing open.' })}
        </div>
        <div class="pgrid">${members.map(o => personCard(o, personStats(o.id))).join('')}</div>
      </div>`;

    const v = $('#view');
    $('#assignPos') && ($('#assignPos').onclick = () => openTaskModal(null, rerender, { ownerId: pid }));
    $('#nudgePos') && ($('#nudgePos').onclick = () => {
      const txt = nudgeText(ids, name);
      if (!txt) { toast(`Nothing due soon for ${name} 👍`); return; }
      copyText(txt, `${name} reminder copied`);
    });
    wireTasks(v);
  }

  // ---------- Person profile ----------
  function renderPerson(id) {
    const o = officer(id);
    if (!o) { location.hash = '#people'; return; }
    const s = personStats(id);
    const admin = isAdmin(), self = id === me().id;
    const open = defaultSort(s.owned.filter(t => t.status !== 'Done'));
    const involved = defaultSort(s.involved.filter(t => t.status !== 'Done'));
    const done = [...s.done].sort((a, b) => (b.completedAt || b.updatedAt || '').localeCompare(a.completedAt || a.updatedAt || ''));
    const pastMeetings = D.meetings.filter(isPast).sort((a, b) => a.date.localeCompare(b.date));
    const dots = pastMeetings.map(m => {
      const st = m.attendance?.[id] ? 'present' : m.rsvps?.[id]?.status === 'no' ? 'excused' : attendanceTaken(m) ? 'absent' : 'unknown';
      const label = { present: 'Present', excused: 'Excused (sent an update)', absent: 'Absent', unknown: 'Attendance not taken' }[st];
      return `<span class="adot ${st}" title="${fmtDate(m.date)}: ${label}"></span>`;
    }).join('');
    const updates = D.meetings.filter(m => m.rsvps?.[id]?.status === 'no').sort((a, b) => b.date.localeCompare(a.date));
    const nm = nextMeeting();
    const nmStatus = nm ? (nm.rsvps?.[id]?.status === 'yes' ? 'Going' : nm.rsvps?.[id]?.status === 'no' ? "Can't make it" : 'No RSVP yet') : null;

    $('#view').innerHTML = `
      <a class="back" href="#people">‹ People</a>
      <div class="panel profile">
        <div class="profile-head">
          ${avatar(id, 'xl')}
          <div class="profile-who">
            <h1>${esc(o.name)}</h1>
            <div class="muted">${coChairs(id).length ? roleLink(o) : esc(o.role || 'Officer')}${o.isAdmin ? ' · <span class="star">★</span> Admin' : ''}${self ? ' · <span class="chip">you</span>' : ''}</div>
            ${coChairs(id).length ? `<div class="small" style="margin-top:6px">Shares ${esc(o.role.trim())} with ${coChairs(id).map(c => `<a href="#person/${c.id}">${esc(c.name)}</a>`).join(' & ')}</div>` : ''}
            ${nm ? `<div class="small" style="margin-top:6px">Next meeting (${fmtShort(nm.date)}): <b>${nmStatus}</b></div>` : ''}
          </div>
          <div class="profile-actions">
            ${admin || self ? `<button class="primary" data-assign-to="${id}">+ ${self ? 'Add task' : 'Assign task'}</button>` : ''}
            ${admin && !self ? `<button id="nudge">${ICON.copy} Copy reminder</button>` : ''}
            ${admin ? `<button id="editOfficer">Edit</button>` : ''}
          </div>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="num">${s.open}</div><div class="lbl">Open tasks</div></div>
        <div class="stat bad"><div class="num">${s.overdue}</div><div class="lbl">Overdue</div></div>
        <div class="stat good"><div class="num">${s.done.length}</div><div class="lbl">Completed</div></div>
        <div class="stat"><div class="num">${s.onTimePct === null ? '—' : s.onTimePct + '%'}</div><div class="lbl">Finished on time</div></div>
        <div class="stat"><div class="num">${s.attPct === null ? '—' : s.attPct + '%'}</div><div class="lbl">Attendance${s.tracked ? ` (${s.attended}/${s.tracked})` : ''}</div></div>
      </div>

      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h2>On their plate</h2><span class="muted small">${plural(open.length, 'open task')}</span></div>
          ${taskTable(open, { showOwner: false, empty: `${esc(first(id))} has nothing open right now.` })}
        </div>
        ${involved.length ? `
        <div class="panel">
          <div class="panel-head"><h2>Helping with</h2><span class="muted small">Other officers' tasks they're involved in</span></div>
          ${taskTable(involved, { showOwner: true })}
        </div>` : ''}
        <div class="panel">
          <div class="panel-head"><h2>Completed</h2>
            ${done.length ? `<button class="sm ghost" id="toggleDone">${ui.personShowDone ? 'Hide' : `Show ${done.length}`}</button>` : '<span class="muted small">None yet</span>'}</div>
          ${ui.personShowDone && done.length ? taskTable(done, { showOwner: false }) : ''}
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Meetings</h2><span class="muted small">${s.tracked ? `Attended ${s.attended} of ${s.tracked}` : 'No attendance taken yet'}</span></div>
          <div class="panel-body">
            ${pastMeetings.length ? `
              <div class="adots">${dots}</div>
              <div class="legend small muted"><span><i class="adot present"></i>Present</span><span><i class="adot excused"></i>Excused</span><span><i class="adot absent"></i>Absent</span></div>` : '<div class="muted">No past meetings yet.</div>'}
            ${updates.length ? `<h3 style="margin:18px 0 8px">Absence updates</h3>${updates.map(m => `
              <div class="report">
                <div class="muted small">${esc(m.title)} · ${fmtDate(m.date)}</div>
                <h4>Upcoming items / events</h4><div class="prewrap">${esc(m.rsvps[id].upcoming)}</div>
                <h4>Requests for other officers</h4><div class="prewrap">${esc(m.rsvps[id].requests)}</div>
              </div>`).join('')}` : ''}
          </div>
        </div>
      </div>`;

    const v = $('#view');
    $$('[data-assign-to]', v).forEach(b => b.onclick = () => openTaskModal(null, rerender, { ownerId: id }));
    $('#nudge') && ($('#nudge').onclick = () => {
      const txt = nudgeText(id);
      if (!txt) { toast(`${first(id)} has nothing due soon. No reminder needed 👍`); return; }
      copyText(txt, `Reminder for ${first(id)} copied. Paste it in a text or GroupMe`);
    });
    $('#editOfficer') && ($('#editOfficer').onclick = () => openOfficerModal(o));
    $('#toggleDone') && ($('#toggleDone').onclick = () => { ui.personShowDone = !ui.personShowDone; renderPerson(id); });
    wireTasks(v);
  }

  // ---------- Modal ----------
  function modal(html, { wide = false } = {}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog">${html}</div></div>`;
    const close = () => { root.innerHTML = ''; ui.liveRefresh = null; document.removeEventListener('keydown', onKey); flushRemote(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('.modal-backdrop', root).addEventListener('mousedown', e => { if (e.target.classList.contains('modal-backdrop')) close(); });
    $$('[data-close]', root).forEach(b => (b.onclick = close));
    return { root: $('.modal', root), close };
  }

  function openTaskModal(t0, after = rerender, prefill = {}) {
    const isNew = !t0;
    const admin = isAdmin();
    // Officers adding a task default to themselves. Admins assigning start with nobody picked
    // (unless opened from someone's profile/row), so they don't silently get a copy too.
    const t = t0 || { title: '', notes: '', ownerId: admin ? null : me().id, collaboratorIds: [], dueDate: '', status: 'Not Started', ...prefill };
    const editable = isNew || canEdit(t);
    const dis = editable ? '' : 'disabled';
    const multi = isNew && admin;
    const pos = positions();
    const myPos = pos.find(p => p.members.some(m => m.id === me().id));
    const posLabel = p => `<label class="pos-pick"><input type="checkbox" value="${esc(p.id)}" ${normRole(posRole(String(t.ownerId))) === normRole(p.name) && isPos(t.ownerId) ? 'checked' : ''}/>${avatarStack(p.members.map(m => m.id), 3)}<b>${esc(p.name)}</b><span class="muted small">shared</span></label>`;

    let ownerField;
    if (multi) {
      ownerField = `
      <div class="field">
        <div class="flabel">Assign to <span id="ownerCount"></span></div>
        ${pos.length ? `<div class="checklist" id="posOwners">${pos.map(posLabel).join('')}</div>
          <div class="muted small" style="margin:6px 4px 10px">A position gets <b>one shared task</b> that every chair in it owns.</div>` : ''}
        <div class="quick" style="margin:0 0 8px">
          <button type="button" class="chip-btn" data-group="__all">Everyone</button>
          <button type="button" class="chip-btn" data-group="__none">Clear</button>
        </div>
        <div class="checklist people-pick" id="owners">${D.officers.map(o => `<label><input type="checkbox" value="${o.id}" ${o.id === t.ownerId ? 'checked' : ''}/>${avatar(o.id, 'xs')}${esc(o.name)}</label>`).join('')}</div>
      </div>`;
    } else {
      // Admins can give a task to anyone or any position. Officers can move their own task between
      // themselves and their shared position.
      const canMove = editable && (admin || isNew || isAssignee(t, me().id));
      const peopleOpts = admin ? D.officers : D.officers.filter(o => o.id === t.ownerId || o.id === me().id);
      const posOpts = admin ? pos : [myPos, isPos(t.ownerId) ? pos.find(p => isPosTask(t, p.name)) : null].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
      const opt = (val, label) => `<option value="${esc(val)}" ${val === t.ownerId || (isPos(val) && isPos(t.ownerId) && normRole(posRole(val)) === normRole(posRole(t.ownerId))) ? 'selected' : ''}>${esc(label)}</option>`;
      ownerField = `
      <label class="field"><span>Owner</span>
        <select name="ownerId" ${canMove && peopleOpts.length + posOpts.length > 1 ? '' : 'disabled'}>
          ${posOpts.length ? `<optgroup label="Shared positions">${posOpts.map(p => opt(p.id, `👥 ${p.name} (${p.members.map(m => first(m.id)).join(' & ')})`)).join('')}</optgroup>` : ''}
          <optgroup label="People">${peopleOpts.map(o => opt(o.id, o.name)).join('')}</optgroup>
        </select>
      </label>`;
    }

    const showActivity = !isNew && Store.features.comments;
    const { root, close } = modal(`
      <div class="modal-head"><h2>${isNew ? (admin ? 'Assign a task' : 'New task') : editable ? 'Task' : 'Task (view only)'}</h2><button class="ghost" data-close aria-label="Close">✕</button></div>
      <form class="modal-body" id="taskForm">
        <label class="field"><span>Task</span><input name="title" required value="${esc(t.title)}" placeholder="What needs to get done?" ${dis} /></label>
        ${ownerField}
        <div class="row">
          <div class="field">
            <label><span class="flabel">Due date</span><input type="date" name="dueDate" value="${esc(t.dueDate)}" ${dis} /></label>
            ${editable ? `<div class="quick">${[['Today', 0], ['Tomorrow', 1], ['Friday', 'fri'], ['Next week', 7], ['2 weeks', 14], ['None', '']].map(([l, val]) => `<button type="button" class="chip-btn" data-due="${val}">${l}</button>`).join('')}</div>` : ''}
          </div>
          <label class="field"><span>Status</span><select name="status" ${dis}>${STATUSES.map(s => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="field"><div class="flabel">Loop in other officers</div><div class="checklist people-pick" id="collabs"></div></div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Details, links, context…" ${dis}>${esc(t.notes)}</textarea></label>
        <div class="muted small" id="urgPreview"></div>
        ${!isNew ? `<div class="muted small" style="margin-top:6px">Added by ${esc(oname(t.createdBy))}${t.createdAt ? ` · ${timeAgo(t.createdAt)}` : ''}${t.completedAt ? ` · finished ${timeAgo(t.completedAt)}` : ''}</div>` : ''}
      </form>
      ${showActivity ? `
      <div class="activity">
        <div class="flabel">Updates & activity</div>
        <div id="thread"></div>
        <form id="cform" class="comment-box">${avatar(me().id, 'sm')}<input name="body" placeholder="Post an update…" autocomplete="off" /><button class="primary sm" type="submit">Post</button></form>
      </div>` : ''}
      <div class="modal-foot">
        ${!isNew && canDelete(t) ? `<button class="danger left" id="del">Delete</button>` : ''}
        <button data-close>${editable ? 'Cancel' : 'Close'}</button>
        ${editable ? `<button class="primary" id="save">${isNew ? 'Add task' : 'Save'}</button>` : ''}
      </div>`, { wide: showActivity });

    const form = $('#taskForm', root);
    const owners = () => multi ? $$('#posOwners input:checked, #owners input:checked', root).map(i => i.value) : [form.ownerId.value];
    // the people who'd own a task for a given owner id (a person, or everyone in a position)
    const ownersOf = id => isPos(id) ? membersOf(posRole(id)).map(o => o.id) : [id];

    const drawCollabs = (init) => {
      const exclude = new Set(multi ? [] : owners().flatMap(ownersOf));
      const selected = new Set(init || $$('#collabs input:checked', root).map(i => i.value));
      $('#collabs', root).innerHTML = D.officers.filter(o => !exclude.has(o.id)).map(o =>
        `<label><input type="checkbox" value="${o.id}" ${selected.has(o.id) ? 'checked' : ''} ${dis}/>${avatar(o.id, 'xs')}${esc(o.name)}</label>`).join('')
        || '<span class="muted small">Add more officers on the People tab.</span>';
    };
    drawCollabs(t.collaboratorIds);

    const updateOwnerCount = () => {
      if (!multi) return;
      const picked = owners();
      const posMembers = new Set(picked.filter(isPos).flatMap(ownersOf));
      const os = picked.filter(id => isPos(id) || !posMembers.has(id)); // same dedupe as save()
      const nPos = os.filter(isPos).length, nPeople = os.length - nPos;
      const parts = [nPos && plural(nPos, 'shared position task'), nPeople > 1 && `${nPeople} individual copies`].filter(Boolean);
      $('#ownerCount', root).textContent = os.length > 1 ? `· ${parts.join(' + ') || ''}` : '';
      $('#save', root).textContent = os.length > 1 ? `Create ${plural(os.length, 'task')}`
        : os.length === 1 && isPos(os[0]) ? `Assign to ${posName(os[0])}` : 'Add task';
      // a chair already covered by a picked position is dimmed (they won't get a second copy)
      $$('#owners label', root).forEach(l => l.classList.toggle('dim', posMembers.has(l.querySelector('input').value)));
    };
    if (multi) {
      $('#owners', root).addEventListener('change', updateOwnerCount);
      $('#posOwners', root)?.addEventListener('change', updateOwnerCount);
      $$('[data-group]', root).forEach(b => b.onclick = () => {
        const g = b.dataset.group;
        $$('#owners input', root).forEach(i => (i.checked = g === '__all'));
        if (g === '__none') $$('#posOwners input', root).forEach(i => (i.checked = false));
        updateOwnerCount();
      });
      updateOwnerCount();
    } else form.ownerId.onchange = () => drawCollabs();

    const preview = () => {
      const u = urgency({ status: form.status.value, dueDate: form.dueDate.value });
      $('#urgPreview', root).innerHTML = `Urgency: <span class="badge u-${u.key}">${esc(u.label)}</span>${form.dueDate.value && form.status.value !== 'Done' ? ` <span class="muted">· due ${relDue(form.dueDate.value)}</span>` : ''}`;
    };
    form.dueDate.oninput = preview; form.status.onchange = preview; preview();
    $$('[data-due]', root).forEach(b => b.onclick = () => {
      const v = b.dataset.due;
      form.dueDate.value = v === '' ? '' : v === 'fri' ? nextDow(5) : addDays(+v);
      preview();
    });

    // activity thread
    const evtText = c => c.kind === 'status' ? `marked this <span class="badge ${STATUS_BADGE[c.body] || 'u-later'}">${esc(c.body)}</span>`
      : c.kind === 'assign' ? (c.body === c.authorId ? 'took this on' : `assigned this to <b>${esc(isPos(c.body) ? `👥 ${posName(c.body)}` : oname(c.body))}</b>`)
      : 'created this task';
    const drawThread = () => {
      const el = $('#thread', root);
      if (!el) return;
      const items = commentsFor(t.id);
      el.innerHTML = items.length ? items.map(c => c.kind === 'comment'
        ? `<div class="cmt">${avatar(c.authorId, 'sm')}<div class="bubble"><div class="cmt-head"><b>${esc(oname(c.authorId))}</b><span class="muted small">${timeAgo(c.createdAt)}</span></div><div class="prewrap">${esc(c.body)}</div></div></div>`
        : `<div class="evt">${avatar(c.authorId, 'xs')}<span><b>${esc(first(c.authorId))}</b> ${evtText(c)}</span><span class="muted">· ${timeAgo(c.createdAt)}</span></div>`).join('')
        : '<div class="muted small">No updates yet. Post one so everyone knows where this stands.</div>';
      el.scrollTop = el.scrollHeight;
    };
    if (showActivity) {
      drawThread();
      ui.liveRefresh = drawThread;
      $('#cform', root).onsubmit = e => {
        e.preventDefault();
        const input = e.target.body, body = input.value.trim();
        if (!body) return;
        logActivity(t.id, 'comment', body); t.updatedAt = nowISO();
        persist(); input.value = ''; drawThread(); after(); // refresh comment counts behind the sheet
      };
    }

    const save = () => {
      const title = form.title.value.trim();
      if (!title) { form.title.focus(); toast('Give the task a name'); return; }
      const now = nowISO();
      const collabs = $$('#collabs input:checked', root).map(i => i.value);
      const vals = { title, notes: form.notes.value.trim(), dueDate: form.dueDate.value };
      const status = form.status.value;
      if (isNew) {
        let os = owners();
        if (!os.length) { toast('Pick at least one person or position'); return; }
        // someone already covered by a picked position doesn't also get a personal copy
        const covered = new Set(os.filter(isPos).flatMap(ownersOf));
        os = os.filter(id => isPos(id) || !covered.has(id));
        os.forEach(oid => {
          const nt = { id: Store.uid(), ...vals, status, ownerId: oid, collaboratorIds: collabs.filter(c => !ownersOf(oid).includes(c)),
            createdBy: me().id, createdAt: now, updatedAt: now, completedAt: status === 'Done' ? now : null };
          D.tasks.push(nt);
          logActivity(nt.id, oid === me().id ? 'created' : 'assign', oid);
        });
        toast(os.length > 1 ? `Created ${plural(os.length, 'task')}` : os[0] === me().id ? 'Task added' : `Assigned to ${ownerShort(os[0])}`);
      } else {
        const newOwner = form.ownerId.value, prevOwner = t0.ownerId;
        setStatus(t0, status);
        Object.assign(t0, vals, { ownerId: newOwner, collaboratorIds: collabs.filter(c => !ownersOf(newOwner).includes(c)), updatedAt: now });
        if (newOwner !== prevOwner) logActivity(t0.id, 'assign', newOwner);
        toast('Saved');
      }
      persist(); close(); after();
    };
    form.onsubmit = e => { e.preventDefault(); save(); };
    $('#save', root) && ($('#save', root).onclick = save);
    $('#del', root) && ($('#del', root).onclick = () => {
      if (!confirm(`Delete “${t0.title}”?`)) return;
      D.tasks = D.tasks.filter(x => x.id !== t0.id);
      Store.data.tasks = D.tasks;
      D.comments = (D.comments || []).filter(c => c.taskId !== t0.id);
      persist(); close(); after(); toast('Task deleted');
    });
    if (editable && isNew) setTimeout(() => form.title.focus(), 30);
  }

  // ---------- Meetings & attendance ----------
  const sortedMeetings = () => [...D.meetings].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));

  function meetingList(activeId, attr) {
    const ms = sortedMeetings();
    const up = ms.filter(m => !isPast(m)).reverse();
    const past = ms.filter(isPast);
    const item = m => {
      const rs = Object.values(m.rsvps || {});
      return `<div class="list-item ${m.id === activeId ? 'active' : ''}" ${attr}="${m.id}">
        <div><strong>${esc(m.title)}</strong></div>
        <div class="muted small">${fmtDay(m.date)}${m.time ? ' · ' + fmtTime(m.time) : ''}</div>
        <div class="small" style="margin-top:3px">
          ${attr === 'data-meeting'
            ? `<span class="muted">${rs.filter(r => r.status === 'yes').length} going · ${rs.filter(r => r.status === 'no').length} can't</span>`
            : (hasMinutes(m) ? '<span class="badge u-done">Minutes posted</span>' : '<span class="badge u-later">No minutes</span>')}
        </div>
      </div>`;
    };
    return `
      ${up.length ? `<div class="section-label">Upcoming</div>${up.map(item).join('')}` : ''}
      ${past.length ? `<div class="section-label">Past</div>${past.map(item).join('')}` : ''}
      ${!ms.length ? '<div class="empty">No meetings yet.</div>' : ''}`;
  }

  function renderMeetings() {
    const ms = sortedMeetings();
    if (!ui.meetingId || !D.meetings.find(m => m.id === ui.meetingId)) ui.meetingId = (nextMeeting() || ms[0])?.id || null;
    const m = D.meetings.find(x => x.id === ui.meetingId);

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>Meetings</h1><div class="sub muted">RSVP for officer meetings. Can't make it? Leave your update so nothing gets missed.</div></div>
        ${isAdmin() ? '<button class="primary" id="newMeeting">+ Schedule meeting</button>' : ''}
      </div>
      <div class="grid-2">
        <div class="panel side-list">${meetingList(ui.meetingId, 'data-meeting')}</div>
        <div>${m ? meetingDetail(m) : '<div class="panel"><div class="empty">Schedule a meeting to get started.</div></div>'}</div>
      </div>`;

    $('#newMeeting') && ($('#newMeeting').onclick = () => openMeetingModal(null));
    $$('[data-meeting]').forEach(el => el.onclick = () => { ui.meetingId = el.dataset.meeting; ui.rsvpDraft = null; renderMeetings(); });
    if (m) wireMeetingDetail(m);
  }

  function meetingDetail(m) {
    const u = me();
    const admin = isAdmin();
    const mine = (m.rsvps || {})[u.id] || {};
    const choice = ui.rsvpDraft?.mid === m.id ? ui.rsvpDraft.status : mine.status;
    const past = isPast(m);
    const going = D.officers.filter(o => m.rsvps?.[o.id]?.status === 'yes');
    const absences = D.officers.filter(o => m.rsvps?.[o.id]?.status === 'no');
    const silent = D.officers.filter(o => !m.rsvps?.[o.id]?.status);
    const presentCount = Object.values(m.attendance || {}).filter(Boolean).length;

    const roster = D.officers.map(o => {
      const r = (m.rsvps || {})[o.id];
      const st = r?.status === 'yes' ? '<span class="badge u-done">Going</span>'
        : r?.status === 'no' ? '<span class="badge u-overdue">Can\'t make it</span>'
        : '<span class="badge u-later">No response</span>';
      return `<tr>
        <td>${personLink(o.id)}<div class="muted small" style="margin-left:32px">${esc(o.role || '')}</div></td>
        <td>${st}</td>
        ${admin ? `<td><label class="toggle"><input type="checkbox" data-present="${o.id}" ${m.attendance?.[o.id] ? 'checked' : ''}/> Present</label></td>` : ''}
      </tr>`;
    }).join('');

    return `
      <div class="stack">
        <div class="panel">
          <div class="panel-head">
            <div><h2>${esc(m.title)}</h2><div class="muted small">${fmtDay(m.date)}${m.time ? ' · ' + fmtTime(m.time) : ''}${m.location ? ' · ' + esc(m.location) : ''}</div></div>
            ${admin ? `<div class="toolbar" style="margin:0"><button class="sm" id="editMeeting">Edit</button><button class="sm danger" id="delMeeting">Delete</button></div>` : ''}
          </div>
          <div class="panel-body">
            <div class="mtg-counts">
              <div><b>${going.length}</b><span class="muted small">going</span></div>
              <div><b>${absences.length}</b><span class="muted small">can't make it</span></div>
              <div><b>${silent.length}</b><span class="muted small">no response</span></div>
              ${past || presentCount ? `<div><b>${presentCount}</b><span class="muted small">present</span></div>` : ''}
            </div>
            ${m.agenda ? `<h3 style="margin:16px 0 6px">Agenda</h3><div class="prewrap">${esc(m.agenda)}</div>` : ''}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Your RSVP</h2>${mine.status ? `<span class="muted small">Updated ${timeAgo(mine.at)}</span>` : ''}</div>
          <div class="panel-body">
            ${past && !mine.status ? '<div class="callout">This meeting already happened. You can still leave a late update.</div>' : ''}
            <div class="rsvp-choice">
              <button class="${choice === 'yes' ? 'on yes' : ''}" data-rsvp="yes">✓ I'll be there</button>
              <button class="${choice === 'no' ? 'on no' : ''}" data-rsvp="no">✕ I can't make it</button>
            </div>
            ${choice === 'no' ? `
              <form id="absForm">
                <div class="callout">Since you can't make it, fill out both sections so the board stays in the loop.</div>
                <label class="field"><span>Upcoming items / events *</span>
                  <textarea name="upcoming" required rows="4" placeholder="What's coming up on your end? Events, deadlines, progress…">${esc(mine.upcoming || '')}</textarea></label>
                <label class="field"><span>Requests for other officers *</span>
                  <textarea name="requests" required rows="4" placeholder="Anything you need from someone? Mention them by name.">${esc(mine.requests || '')}</textarea></label>
                <button class="primary" type="submit">Submit absence update</button>
              </form>` : ''}
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Roster</h2>
            ${admin ? `<div class="toolbar" style="margin:0">
              ${silent.length && !past ? `<button class="sm" id="rsvpNudge">${ICON.copy} Copy RSVP reminder</button>` : ''}
              ${going.length ? `<button class="sm" id="markGoing">Mark everyone going as present</button>` : ''}
            </div>` : ''}
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Officer</th><th>RSVP</th>${admin ? '<th>Attendance</th>' : ''}</tr></thead>
            <tbody>${roster}</tbody>
          </table></div>
        </div>

        <div class="panel">
          <div class="panel-head"><h2>Absence updates</h2><span class="muted small">${absences.length} submitted</span></div>
          <div class="panel-body">
            ${absences.length ? absences.map(o => {
              const r = m.rsvps[o.id];
              return `<div class="report">
                <div class="report-head">${personLink(o.id)}<span class="muted small">${esc(o.role || '')}</span></div>
                <h4>Upcoming items / events</h4><div class="prewrap">${esc(r.upcoming)}</div>
                <h4>Requests for other officers</h4><div class="prewrap">${esc(r.requests)}</div>
                ${admin ? `<div style="margin-top:10px"><button class="sm" data-req2task="${o.id}">→ Turn request into a task</button></div>` : ''}
              </div>`;
            }).join('') : '<div class="muted">Nobody has said they can\'t make it.</div>'}
          </div>
        </div>
      </div>`;
  }

  function wireMeetingDetail(m) {
    const u = me();
    m.rsvps ||= {}; m.attendance ||= {};
    $$('[data-rsvp]').forEach(b => b.onclick = () => {
      if (b.dataset.rsvp === 'yes') {
        m.rsvps[u.id] = { status: 'yes', at: nowISO() };
        ui.rsvpDraft = null; persist(); renderMeetings(); toast('RSVP saved — see you there');
      } else {
        ui.rsvpDraft = { mid: m.id, status: 'no' }; renderMeetings();
        $('#absForm textarea')?.focus();
      }
    });
    const f = $('#absForm');
    if (f) f.onsubmit = e => {
      e.preventDefault();
      const upcoming = f.upcoming.value.trim(), requests = f.requests.value.trim();
      if (!upcoming || !requests) { toast('Both sections are required'); return; }
      m.rsvps[u.id] = { status: 'no', upcoming, requests, at: nowISO() };
      ui.rsvpDraft = null; persist(); renderMeetings(); toast('Absence update submitted');
    };
    $$('[data-present]').forEach(cb => cb.onchange = () => { m.attendance[cb.dataset.present] = cb.checked; persist(); renderMeetings(); });
    $('#markGoing') && ($('#markGoing').onclick = () => {
      D.officers.forEach(o => { if (m.rsvps[o.id]?.status === 'yes') m.attendance[o.id] = true; });
      persist(); renderMeetings(); toast('Marked everyone who RSVP\'d as present');
    });
    $('#rsvpNudge') && ($('#rsvpNudge').onclick = () => {
      const names = D.officers.filter(o => !m.rsvps[o.id]?.status).map(o => first(o.id));
      copyText(`Hey ${names.join(', ')} 👋 please RSVP for ${m.title} on ${fmtDay(m.date)}${m.time ? ' at ' + fmtTime(m.time) : ''}. If you can't make it, leave your update so we don't miss anything: ${APP_URL}#meetings`, 'RSVP reminder copied');
    });
    $('#editMeeting') && ($('#editMeeting').onclick = () => openMeetingModal(m));
    $('#delMeeting') && ($('#delMeeting').onclick = () => {
      if (!confirm(`Delete “${m.title}” on ${fmtDate(m.date)}? This removes its RSVPs and minutes too.`)) return;
      D.meetings = D.meetings.filter(x => x.id !== m.id); Store.data.meetings = D.meetings;
      ui.meetingId = null; persist(); renderMeetings();
    });
    $$('[data-req2task]').forEach(b => b.onclick = () => {
      const oid = b.dataset.req2task;
      openTaskModal(null, renderMeetings, {
        title: `Follow up: ${first(oid)}'s request`,
        notes: `From ${oname(oid)}'s absence update for ${m.title} (${fmtDate(m.date)}):\n${m.rsvps[oid].requests}`,
        collaboratorIds: [oid],
      });
    });
  }

  function openMeetingModal(meeting) {
    const isNew = !meeting;
    const m = meeting || { title: 'Weekly Exec Meeting', date: nextDow(0), time: '19:00', location: '', agenda: '' };
    const { root, close } = modal(`
      <div class="modal-head"><h2>${isNew ? 'Schedule meeting' : 'Edit meeting'}</h2><button class="ghost" data-close aria-label="Close">✕</button></div>
      <form class="modal-body" id="mForm">
        <label class="field"><span>Title</span><input name="title" required value="${esc(m.title)}" /></label>
        <div class="row">
          <label class="field"><span>Date</span><input type="date" name="date" required value="${esc(m.date)}" /></label>
          <label class="field"><span>Time</span><input type="time" name="time" value="${esc(m.time)}" /></label>
          <label class="field"><span>Location</span><input name="location" value="${esc(m.location)}" placeholder="Room / Zoom link" /></label>
        </div>
        <label class="field"><span>Agenda</span><textarea name="agenda" rows="5" placeholder="One item per line">${esc(m.agenda)}</textarea></label>
      </form>
      <div class="modal-foot"><button data-close>Cancel</button><button class="primary" id="mSave">${isNew ? 'Schedule' : 'Save'}</button></div>`);
    const f = $('#mForm', root);
    const save = () => {
      if (!f.title.value.trim() || !f.date.value) { toast('Title and date are required'); return; }
      const vals = { title: f.title.value.trim(), date: f.date.value, time: f.time.value, location: f.location.value.trim(), agenda: f.agenda.value };
      if (isNew) {
        const nm = { id: Store.uid(), ...vals, rsvps: {}, attendance: {}, minutes: { text: '', link: '', files: [] } };
        D.meetings.push(nm); ui.meetingId = nm.id;
      } else Object.assign(meeting, vals);
      persist(); close(); route(); toast(isNew ? 'Meeting scheduled' : 'Meeting saved');
    };
    f.onsubmit = e => { e.preventDefault(); save(); };
    $('#mSave', root).onclick = save;
  }

  // ---------- Minutes ----------
  const hasMinutes = m => !!(m.minutes && (m.minutes.text?.trim() || m.minutes.link || m.minutes.files?.length));

  function renderMinutes() {
    const ms = sortedMeetings();
    if (!ui.minutesId || !D.meetings.find(m => m.id === ui.minutesId)) ui.minutesId = (ms.find(isPast) || ms[0])?.id || null;
    const m = D.meetings.find(x => x.id === ui.minutesId);
    if (m) m.minutes ||= { text: '', link: '', files: [] };
    const admin = isAdmin();

    $('#view').innerHTML = `
      <div class="page-head">
        <div><h1>Minutes</h1><div class="sub muted">${admin ? 'Upload or write the minutes for each meeting.' : 'Read the minutes from past meetings.'}</div></div>
        ${admin ? '<button class="primary" id="newMeeting">+ Add meeting</button>' : ''}
      </div>
      <div class="grid-2">
        <div class="panel side-list">${meetingList(ui.minutesId, 'data-minutes')}</div>
        <div>${m ? `
          <div class="panel">
            <div class="panel-head"><div><h2>${esc(m.title)}</h2><div class="muted small">${fmtDay(m.date)}${m.time ? ' · ' + fmtTime(m.time) : ''}</div></div></div>
            <div class="panel-body">
              ${!admin && m.minutes.text?.trim() ? `<div class="minutes-doc prewrap">${esc(m.minutes.text)}</div>` : ''}
              <h3 style="margin-bottom:8px">Files</h3>
              <div id="files">${m.minutes.files.length ? m.minutes.files.map((fl, i) => `
                <div class="file-row">
                  <span>📄</span><span class="name">${esc(fl.name)}</span>
                  <span class="muted small">${fmtBytes(fl.size)} · ${new Date(fl.uploadedAt).toLocaleDateString()}</span>
                  <button class="sm" data-open="${i}">Open</button>
                  <a class="btn sm" href="${esc(fl.url || fl.dataUrl)}" download="${esc(fl.name)}" target="_blank" rel="noopener">Download</a>
                  ${admin ? `<button class="sm danger" data-rm="${i}">Remove</button>` : ''}
                </div>`).join('') : '<div class="muted">No files uploaded.</div>'}
              </div>
              ${admin ? `
                <div class="dropzone" id="drop" style="margin-top:12px">
                  Drop PDF / Word / text files here, or click to choose<br><span class="small">Up to ${fmtBytes(MAX_FILE_BYTES)} per file</span>
                  <input type="file" id="fileIn" multiple hidden accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt,image/*" />
                </div>` : ''}

              <h3 style="margin:20px 0 8px">Link</h3>
              ${admin
                ? `<input id="mLink" placeholder="Paste a Google Docs / Drive link (optional)" value="${esc(m.minutes.link)}" />`
                : (m.minutes.link ? `<a href="${esc(m.minutes.link)}" target="_blank" rel="noopener">${esc(m.minutes.link)}</a>` : '<div class="muted">No link.</div>')}

              ${admin ? `
                <h3 style="margin:20px 0 8px">Notes</h3>
                <textarea id="mText" rows="12" placeholder="Type or paste the minutes here…">${esc(m.minutes.text)}</textarea>
                <div style="margin-top:10px;display:flex;gap:8px"><button class="primary" id="saveMin">Save minutes</button></div>`
                : (!m.minutes.text?.trim() ? '<h3 style="margin:20px 0 8px">Notes</h3><div class="muted">No notes written.</div>' : '')}
            </div>
          </div>` : '<div class="panel"><div class="empty">No meetings yet.</div></div>'}
        </div>
      </div>`;

    $('#newMeeting') && ($('#newMeeting').onclick = () => openMeetingModal(null));
    $$('[data-minutes]').forEach(el => el.onclick = () => { ui.minutesId = el.dataset.minutes; renderMinutes(); });
    if (!m) return;

    $$('[data-open]').forEach(b => b.onclick = () => {
      const fl = m.minutes.files[+b.dataset.open];
      if (fl.url) { window.open(fl.url, '_blank', 'noopener'); return; }
      fetch(fl.dataUrl).then(r => r.blob()).then(bl => window.open(URL.createObjectURL(bl), '_blank'));
    });
    $$('[data-rm]').forEach(b => b.onclick = () => {
      const fl = m.minutes.files[+b.dataset.rm];
      if (!confirm(`Remove ${fl.name}?`)) return;
      m.minutes.files.splice(+b.dataset.rm, 1); persist(); renderMinutes();
      Store.removeFile(fl.path);
    });
    if (!admin) return;

    const drop = $('#drop'), input = $('#fileIn');
    drop.onclick = () => input.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(m, e.dataTransfer.files); };
    input.onchange = () => addFiles(m, input.files);
    $('#saveMin').onclick = () => {
      m.minutes.text = $('#mText').value;
      m.minutes.link = $('#mLink').value.trim();
      persist(); renderMinutes(); toast('Minutes saved');
    };
  }

  function addFiles(m, fileList) {
    const files = [...fileList];
    const tooBig = files.filter(f => f.size > MAX_FILE_BYTES);
    if (tooBig.length) toast(`${tooBig.map(f => f.name).join(', ')} too large — use the link field for big files`);
    const ok = files.filter(f => f.size <= MAX_FILE_BYTES);
    if (!ok.length) return;
    if (Store.remote) {
      toast(`Uploading ${plural(ok.length, 'file')}…`);
      Promise.allSettled(ok.map(f => Store.uploadFile(m.id, f))).then(results => {
        const done = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected');
        if (done.length) { m.minutes.files.push(...done); persist(); }
        failed.forEach(r => console.error(r.reason));
        toast(failed.length ? `${failed.length} upload(s) failed: ${failed[0].reason?.message || 'unknown error'}` : `Uploaded ${plural(done.length, 'file')}`);
        if (ui.minutesId === m.id && location.hash.startsWith('#minutes')) renderMinutes();
      });
      return;
    }
    Promise.all(ok.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = () => res({ name: f.name, type: f.type, size: f.size, dataUrl: r.result, uploadedAt: nowISO() });
      r.readAsDataURL(f);
    }))).then(read => {
      m.minutes.files.push(...read);
      if (!Store.save()) {
        m.minutes.files.splice(-read.length);
        toast('Browser storage is full — remove an old file or use a link instead');
      } else toast(`Uploaded ${plural(read.length, 'file')}`);
      renderMinutes();
    });
  }

  // ---------- Officer editor ----------
  function openOfficerModal(off) {
    const isNew = !off;
    const o = off || { name: '', role: '', isAdmin: false };
    const { root, close } = modal(`
      <div class="modal-head"><h2>${isNew ? 'Add officer' : 'Edit officer'}</h2><button class="ghost" data-close aria-label="Close">✕</button></div>
      <form class="modal-body" id="oForm">
        <label class="field"><span>Name</span><input name="name" required value="${esc(o.name)}" /></label>
        <label class="field"><span>Role / position</span><input name="role" value="${esc(o.role)}" placeholder="e.g. Treasurer" list="roleList" />
          <datalist id="roleList">${[...new Set(D.officers.map(x => x.role).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
        <label class="toggle"><input type="checkbox" name="isAdmin" ${o.isAdmin ? 'checked' : ''}/> Admin (can assign to anyone, see the Master List, manage meetings & minutes)</label>
      </form>
      <div class="modal-foot">
        ${!isNew && off.id !== D.currentUserId ? '<button class="danger left" id="oDel">Remove</button>' : ''}
        <button data-close>Cancel</button><button class="primary" id="oSave">${isNew ? 'Add' : 'Save'}</button>
      </div>`);
    const f = $('#oForm', root);
    const save = () => {
      if (!f.name.value.trim()) { f.name.focus(); return; }
      const vals = { name: f.name.value.trim(), role: f.role.value.trim(), isAdmin: f.isAdmin.checked };
      if (!isNew && off.id === D.currentUserId && !vals.isAdmin && D.officers.filter(x => x.isAdmin).length === 1) {
        toast('You are the only admin — make someone else admin first'); return;
      }
      if (isNew) D.officers.push({ id: Store.uid(), ...vals }); else Object.assign(off, vals);
      persist(); close(); renderUserSelect(); route();
    };
    f.onsubmit = e => { e.preventDefault(); save(); };
    $('#oSave', root).onclick = save;
    $('#oDel', root) && ($('#oDel', root).onclick = () => {
      const owned = D.tasks.filter(t => t.ownerId === off.id).length;
      if (!confirm(`Remove ${off.name}?${owned ? ` Their ${owned} task(s) will be reassigned to you.` : ''}`)) return;
      D.tasks.forEach(t => {
        if (t.ownerId === off.id) t.ownerId = D.currentUserId;
        t.collaboratorIds = t.collaboratorIds.filter(id => id !== off.id);
      });
      D.meetings.forEach(m => { delete m.rsvps?.[off.id]; delete m.attendance?.[off.id]; });
      D.officers.splice(D.officers.indexOf(off), 1);
      persist(); close(); renderUserSelect(); location.hash = '#people'; route();
    });
  }

  // ---------- global: new task button, FAB, shortcuts ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-new-task], #fab');
    if (!b || !D) return;
    const [v, arg] = currentView();
    openTaskModal(null, rerender, v === 'person' && arg ? { ownerId: arg } : v === 'position' && arg ? { ownerId: posId(decodeURIComponent(arg)) } : {});
  });
  document.addEventListener('keydown', e => {
    if (!D || e.metaKey || e.ctrlKey || e.altKey || $('#modalRoot').children.length) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    if (e.key === 'n') { e.preventDefault(); openTaskModal(null, rerender); }
    if (e.key === '/') { const q = $('#q, #pq'); if (q) { e.preventDefault(); q.focus(); } }
  });

  // ---------- appearance: System → Light → Dark ----------
  const THEME_KEY = 'officerhub.theme';
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const THEME_ICONS = {
    system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  };
  const THEME_LABEL = { system: 'Match system', light: 'Light', dark: 'Dark' };
  const getThemePref = () => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } };
  function applyTheme() {
    const pref = getThemePref();
    const dark = pref === 'dark' || (pref === 'system' && darkMQ.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const btn = $('#themeBtn');
    btn.innerHTML = THEME_ICONS[pref];
    btn.title = `Appearance: ${THEME_LABEL[pref]} (click to change)`;
  }
  $('#themeBtn').onclick = () => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(getThemePref()) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    applyTheme();
    toast(`Appearance: ${THEME_LABEL[next]}`);
  };
  darkMQ.addEventListener('change', applyTheme);
  applyTheme();

  // ---------- live updates from other officers ----------
  // Don't yank the page out from under someone who's typing or has a dialog open;
  // apply the refresh as soon as they're done (an open task still gets new updates live).
  let pendingRemote = false;
  function busy() {
    if ($('#modalRoot').children.length) return true;
    const a = document.activeElement;
    return !!(a && a.closest('#view') && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'file', 'button'].includes(a.type))));
  }
  function applyRemote() {
    if (busy()) { pendingRemote = true; ui.liveRefresh?.(); return; }
    pendingRemote = false;
    renderUserSelect(); route();
  }
  function flushRemote() { if (pendingRemote) setTimeout(applyRemote, 0); }
  document.addEventListener('focusout', flushRemote);
  Store.onRemoteChange(applyRemote);
  Store.onError(msg => toast(msg));

  // ---------- boot ----------
  $('#view').innerHTML = '<div class="empty">Loading…</div>';
  try {
    D = await Store.load();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="panel"><div class="panel-body">
      <h2>Couldn't connect to the database</h2>
      <p class="muted">${esc(e.message)}</p>
      <p class="muted">Check the URL and key in <code>config.js</code>, and that <code>supabase/schema.sql</code> has been run in the Supabase SQL Editor.</p>
    </div></div>`;
    return;
  }
  renderUserSelect();
  route();
})();
