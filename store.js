/*
 * Data layer for Officer Hub.
 *
 * Two modes:
 *  - Supabase (shared): used when config.js has a URL + key. Every officer sees the same data,
 *    and changes from other officers appear live.
 *  - Local: everything lives in this browser's localStorage. Also forced with ?local in the URL.
 *
 * The app keeps one in-memory object (Store.data) and calls Store.save() after every change.
 * In Supabase mode, save() works out which rows actually changed since the last sync and
 * only writes those, so two officers editing different things never overwrite each other.
 */
const Store = (() => {
  const LOCAL_KEY = 'officerhub.v1';
  const ME_KEY = 'officerhub.me';
  const cfg = window.OFFICER_HUB_CONFIG || {};
  const forceLocal = new URLSearchParams(location.search).has('local');
  const configured = !!(cfg.supabaseUrl && cfg.supabaseKey) && !forceLocal;
  const client = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  const remote = !!client;

  // Newer features that need schema.sql v2. If the database hasn't been upgraded yet,
  // the app keeps working and just hides these.
  const features = { comments: true, completedAt: true, adminPw: true, photos: true };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

  let data = null;
  const listeners = { change: [], error: [] };
  const emit = (ev, arg) => listeners[ev].forEach(fn => { try { fn(arg); } catch (e) { console.error(e); } });

  // ---------------- sample data (local mode only) ----------------
  function isoDaysFromNow(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const pad = x => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, not UTC
  }

  function seed() {
    const officers = [
      { id: uid(), name: 'You (VP)', role: 'Vice President', isAdmin: true },
      { id: uid(), name: 'President', role: 'President', isAdmin: true },
      { id: uid(), name: 'Secretary', role: 'Secretary', isAdmin: false },
      { id: uid(), name: 'Treasurer', role: 'Treasurer', isAdmin: false },
      { id: uid(), name: 'Events Chair', role: 'Events Chair', isAdmin: false },
    ];
    const [vp, pres, sec, tre, ev] = officers;
    const now = new Date().toISOString();
    const t = (title, owner, due, status, collabs = [], notes = '') => ({
      id: uid(), title, notes, ownerId: owner.id, collaboratorIds: collabs.map(o => o.id),
      dueDate: due, status, createdBy: vp.id, createdAt: now, updatedAt: now, completedAt: status === 'Done' ? now : null,
    });
    return {
      version: 1,
      currentUserId: vp.id,
      officers,
      tasks: [
        t('Book venue for spring social', ev, isoDaysFromNow(2), 'In Progress', [tre], 'Need a quote under $500.'),
        t('Send last meeting minutes to members', sec, isoDaysFromNow(-1), 'Not Started'),
        t('Submit budget request to student gov', tre, isoDaysFromNow(6), 'In Progress', [pres, vp]),
        t('Draft officer transition doc', pres, isoDaysFromNow(20), 'Not Started', [vp]),
        t('Order club t-shirts', ev, isoDaysFromNow(0), 'Blocked', [], 'Waiting on final design.'),
        t('Reach out to guest speaker', vp, isoDaysFromNow(4), 'Done'),
      ],
      comments: [],
      meetings: [
        { id: uid(), title: 'Weekly Officer Meeting', date: isoDaysFromNow(3), time: '18:00',
          location: 'Room 204', agenda: 'Budget update\nSpring social planning\nOpen floor',
          rsvps: {}, attendance: {}, minutes: { text: '', link: '', files: [] } },
        { id: uid(), title: 'Weekly Officer Meeting', date: isoDaysFromNow(-4), time: '18:00',
          location: 'Room 204', agenda: 'Kickoff', rsvps: {}, attendance: {},
          minutes: { text: 'Discussed semester goals. Treasurer to submit budget.', link: '', files: [] } },
      ],
    };
  }

  function starter() {
    return { version: 1, currentUserId: null, officers: [{ id: uid(), name: 'Vice President', role: 'Vice President', isAdmin: true }], tasks: [], comments: [], meetings: [] };
  }

  // ---------------- app shape <-> database rows ----------------
  const ALL_TABLES = ['officers', 'meetings', 'tasks', 'task_comments', 'meeting_responses']; // upsert order (parents first)
  const tables = () => ALL_TABLES.filter(t => t !== 'task_comments' || features.comments);

  function toRows(d) {
    return {
      officers: d.officers.map(o => ({ id: o.id, name: o.name, role: o.role || '', is_admin: !!o.isAdmin, ...(features.photos ? { photo_url: o.photo || null } : {}) })),
      meetings: d.meetings.map(m => ({
        id: m.id, title: m.title, date: m.date, time: m.time || '', location: m.location || '', agenda: m.agenda || '',
        minutes_text: m.minutes?.text || '', minutes_link: m.minutes?.link || '', minutes_files: m.minutes?.files || [],
      })),
      tasks: d.tasks.map(t => ({
        id: t.id, title: t.title, notes: t.notes || '', owner_id: t.ownerId, collaborator_ids: t.collaboratorIds || [],
        due_date: t.dueDate || null, status: t.status, created_by: t.createdBy || null,
        created_at: t.createdAt || null, updated_at: t.updatedAt || null,
        ...(features.completedAt ? { completed_at: t.completedAt || null } : {}),
      })),
      task_comments: (d.comments || []).map(c => ({
        id: c.id, task_id: c.taskId, author_id: c.authorId || null, body: c.body || '', kind: c.kind || 'comment', created_at: c.createdAt || null,
      })),
      meeting_responses: d.meetings.flatMap(m => {
        const ids = new Set([...Object.keys(m.rsvps || {}), ...Object.keys(m.attendance || {})]);
        return [...ids].map(oid => {
          const r = m.rsvps?.[oid] || {};
          return {
            id: `${m.id}|${oid}`, meeting_id: m.id, officer_id: oid, status: r.status || null,
            upcoming: r.upcoming || '', requests: r.requests || '', responded_at: r.at || null, present: !!m.attendance?.[oid],
          };
        });
      }),
    };
  }

  function fromRows(rows) {
    const meetings = rows.meetings.map(r => ({
      id: r.id, title: r.title, date: r.date, time: r.time || '', location: r.location || '', agenda: r.agenda || '',
      rsvps: {}, attendance: {}, minutes: { text: r.minutes_text || '', link: r.minutes_link || '', files: r.minutes_files || [] },
    }));
    const byId = Object.fromEntries(meetings.map(m => [m.id, m]));
    rows.meeting_responses.forEach(r => {
      const m = byId[r.meeting_id];
      if (!m) return;
      if (r.status) m.rsvps[r.officer_id] = { status: r.status, upcoming: r.upcoming || '', requests: r.requests || '', at: r.responded_at };
      if (r.present) m.attendance[r.officer_id] = true;
    });
    return {
      officers: rows.officers.map(r => ({ id: r.id, name: r.name, role: r.role || '', isAdmin: !!r.is_admin, photo: r.photo_url || null })),
      tasks: rows.tasks.map(r => ({
        id: r.id, title: r.title, notes: r.notes || '', ownerId: r.owner_id, collaboratorIds: r.collaborator_ids || [],
        dueDate: r.due_date || '', status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
        completedAt: r.completed_at || null,
      })),
      comments: (rows.task_comments || []).map(r => ({
        id: r.id, taskId: r.task_id, authorId: r.author_id, body: r.body || '', kind: r.kind || 'comment', createdAt: r.created_at,
      })),
      meetings,
    };
  }

  // ---------------- Supabase sync ----------------
  let synced = null;          // table -> Map(id -> JSON of row as last seen on the server)
  let chain = Promise.resolve();
  let inflight = 0, needReload = false, reloadTimer = null;

  const snapshot = d => {
    const rows = toRows(d);
    return Object.fromEntries(tables().map(t => [t, new Map(rows[t].map(r => [r.id, JSON.stringify(r)]))]));
  };

  async function detectFeatures() {
    const [c, t, p, ph] = await Promise.all([
      client.from('task_comments').select('id').limit(1),
      client.from('tasks').select('completed_at').limit(1),
      client.rpc('admin_has_password', { oid: '__probe__' }),
      client.from('officers').select('photo_url').limit(1),
    ]);
    features.comments = !c.error;
    features.completedAt = !t.error;
    features.adminPw = !p.error;
    features.photos = !ph.error;
    if (c.error || t.error) console.warn('Database is on the older schema — re-run supabase/schema.sql to enable task updates and on-time stats.');
  }

  async function fetchAll() {
    const ts = tables();
    const res = await Promise.all(ts.map(t => {
      let q = client.from(t).select('*');
      if (t === 'officers') q = q.order('created_at');
      return q;
    }));
    const out = {};
    res.forEach((r, i) => {
      if (r.error) throw new Error(`${ts[i]}: ${r.error.message}`);
      out[ts[i]] = r.data;
    });
    return fromRows(out);
  }

  // Update arrays in place so objects the UI is holding (e.g. an open edit dialog) stay valid.
  function reconcile(target, incoming) {
    const old = new Map(target.map(x => [x.id, x]));
    const next = incoming.map(n => {
      const o = old.get(n.id);
      if (!o) return n;
      Object.keys(o).forEach(k => delete o[k]);
      return Object.assign(o, n);
    });
    target.splice(0, target.length, ...next);
  }
  function reconcileAll(next) {
    data.comments ||= [];
    reconcile(data.officers, next.officers || []);
    reconcile(data.tasks, next.tasks || []);
    reconcile(data.comments, next.comments || []);
    reconcile(data.meetings, next.meetings || []);
  }

  async function reload() {
    if (inflight) { needReload = true; return; }
    try {
      const fresh = await fetchAll();
      if (inflight) { needReload = true; return; } // a local write started meanwhile; try again after it
      reconcileAll(fresh);
      fixMe();
      synced = snapshot(data);
      emit('change');
    } catch (e) { emit('error', 'Could not refresh: ' + e.message); }
  }
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 350); }

  function pushChanges() {
    const ts = tables();
    const now = snapshot(data);
    const upserts = {}, deletes = {};
    let any = false;
    ts.forEach(t => {
      upserts[t] = []; deletes[t] = [];
      now[t].forEach((json, id) => { if (synced[t].get(id) !== json) { upserts[t].push(JSON.parse(json)); any = true; } });
      synced[t].forEach((_, id) => { if (!now[t].has(id)) { deletes[t].push(id); any = true; } });
    });
    if (!any) return;
    synced = now; // optimistic; a failed write triggers a full reload to resync

    inflight++;
    chain = chain.then(async () => {
      for (const t of ts) {
        if (!upserts[t].length) continue;
        const { error } = await client.from(t).upsert(upserts[t]);
        if (error) throw new Error(`${t}: ${error.message}`);
      }
      for (const t of [...ts].reverse()) {
        if (!deletes[t].length) continue;
        const { error } = await client.from(t).delete().in('id', deletes[t]);
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    }).catch(e => {
      console.error(e);
      emit('error', 'Could not save to the database: ' + e.message);
      needReload = true;
    }).finally(() => {
      inflight--;
      if (!inflight && needReload) { needReload = false; scheduleReload(); }
    });
  }

  // Who is using this device. Never guessed: if nobody has picked their name yet (or that
  // officer was removed), it's null and the app asks "Who's this?".
  function fixMe() {
    let saved = null;
    try { saved = localStorage.getItem(ME_KEY); } catch {}
    data.currentUserId = data.officers.some(o => o.id === saved) ? saved : null;
  }
  function setMe(id) {
    data.currentUserId = id;
    try { id ? localStorage.setItem(ME_KEY, id) : localStorage.removeItem(ME_KEY); } catch {}
  }

  // ---------------- admin passwords ----------------
  // Supabase: checked by database functions; the hashes are never readable from the site.
  // Local mode: SHA-256 hashes in this browser (for trying things out only).
  const LOCAL_PW = 'officerhub.adminpw';
  async function sha(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const localPw = () => { try { return JSON.parse(localStorage.getItem(LOCAL_PW)) || {}; } catch { return {}; } };
  const saveLocalPw = m => localStorage.setItem(LOCAL_PW, JSON.stringify(m));
  async function rpc(fn, args) {
    const { data: out, error } = await client.rpc(fn, args);
    if (error) throw new Error(error.message);
    return out;
  }
  const adminPw = {
    async has(oid) { return remote ? rpc('admin_has_password', { oid }) : !!localPw()[oid]; },
    async verify(oid, pw) { return remote ? rpc('verify_admin_password', { oid, pw }) : localPw()[oid] === await sha(oid + pw); },
    async set(oid, newPw, currentPw = null) {
      if (remote) return rpc('set_admin_password', { oid, new_pw: newPw, current_pw: currentPw });
      if (newPw.length < 6) throw new Error('Password must be at least 6 characters');
      const m = localPw();
      if (m[oid] && m[oid] !== await sha(oid + (currentPw || ''))) return false;
      m[oid] = await sha(oid + newPw); saveLocalPw(m); return true;
    },
    async reset(target, newPw, byId, byPw) {
      if (remote) return rpc('reset_admin_password', { target, new_pw: newPw, by_id: byId, by_pw: byPw });
      if (newPw.length < 6) throw new Error('Password must be at least 6 characters');
      if (!(await adminPw.verify(byId, byPw))) return false;
      const m = localPw(); m[target] = await sha(target + newPw); saveLocalPw(m); return true;
    },
  };

  // ---------------- public API ----------------
  async function load() {
    if (configured && !client) emit('error', 'Supabase library failed to load — running in local-only mode. Changes will NOT be shared.');
    if (!remote) {
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        data = raw ? JSON.parse(raw) : seed();
      } catch (e) { console.error(e); data = seed(); }
      data.comments ||= [];
      fixMe();
      save();
      return data;
    }
    await detectFeatures();
    data = { version: 1, currentUserId: null, ...(await fetchAll()) };
    synced = snapshot(data);
    if (!data.officers.length) { // brand-new database
      data.officers = starter().officers;
      save();
    }
    fixMe();
    client.channel('officer-hub')
      .on('postgres_changes', { event: '*', schema: 'public' }, scheduleReload)
      .subscribe();
    // Safety net in case realtime isn't enabled: refresh whenever the tab comes back into view.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleReload(); });
    return data;
  }

  function save() {
    if (remote) { pushChanges(); return true; }
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error(e); // almost always the ~5MB localStorage quota (big minutes files)
      return false;
    }
  }

  function replaceAll(next) {
    if (remote) {
      reconcileAll(next); // keep the same object so references stay valid, then diff against the server
      fixMe();
      return save();
    }
    data = { comments: [], ...next }; fixMe(); return save();
  }
  function reset() { if (remote) return data; data = seed(); fixMe(); save(); return data; }
  function clearAll() {
    const me = data.officers.find(o => o.id === data.currentUserId) || starter().officers[0];
    if (remote) { replaceAll({ officers: [me], tasks: [], comments: [], meetings: [] }); return data; }
    data = { version: 1, currentUserId: me.id, officers: [me], tasks: [], comments: [], meetings: [] };
    save();
    return data;
  }

  async function uploadFile(meetingId, file) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${meetingId}/${uid().slice(0, 8)}-${safe}`;
    const bucket = client.storage.from('minutes');
    const { error } = await bucket.upload(path, file, { contentType: file.type || undefined });
    if (error) throw error;
    const { data: pub } = bucket.getPublicUrl(path);
    return { name: file.name, type: file.type, size: file.size, path, url: pub.publicUrl, uploadedAt: new Date().toISOString() };
  }
  // Profile photos: a small square JPEG (already cropped by the app). Supabase → "avatars" bucket;
  // local mode → stored inline as a data URL.
  async function uploadPhoto(officerId, blob) {
    if (!remote) return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    const path = `${officerId}/${uid().slice(0, 8)}.jpg`;
    const bucket = client.storage.from('avatars');
    const { error } = await bucket.upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) throw error;
    return bucket.getPublicUrl(path).data.publicUrl;
  }
  async function removePhoto(url) {
    const marker = '/object/public/avatars/';
    if (!remote || !url || !url.includes(marker)) return;
    await client.storage.from('avatars').remove([decodeURIComponent(url.split(marker)[1])]);
  }

  async function removeFile(path) {
    if (!remote || !path) return;
    const { error } = await client.storage.from('minutes').remove([path]);
    if (error) emit('error', 'Could not delete file from storage: ' + error.message);
  }

  return {
    load, save, replaceAll, reset, clearAll, uid, uploadFile, removeFile, uploadPhoto, removePhoto, setMe, adminPw,
    remote, configured, features,
    onRemoteChange: fn => listeners.change.push(fn),
    onError: fn => listeners.error.push(fn),
    get data() { return data; },
  };
})();
