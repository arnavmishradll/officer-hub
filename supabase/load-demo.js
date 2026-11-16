// Loads mid-semester demo data into Supabase, using the officers already in the database.
// Every row it creates has an id starting with "demo-" so it can be removed with remove-demo.sql.
// Officers are never created, changed, or deleted.
// Run from the browser console on the app page:  await (await import('./supabase/load-demo.js')).default()
export default async function loadDemo() {
  const c = window.OFFICER_HUB_CONFIG;
  const sb = window.supabase.createClient(c.supabaseUrl, c.supabaseKey);

  const { data: officers, error } = await sb.from('officers').select('*').order('created_at');
  if (error) throw error;
  const byRole = role => officers.filter(o => o.role.toLowerCase() === role.toLowerCase());
  const one = role => byRole(role)[0];
  const two = role => byRole(role)[1] || byRole(role)[0];

  const VP = one('Vice President'), PRES = one('President'), TREAS = one('Treasurer'), COMP = one('Computer'),
    MARSHAL = one('Marshal'), RUSH1 = one('Rush'), RUSH2 = two('Rush'), SOC1 = one('Social'), SOC2 = two('Social'),
    ALUM1 = one('Alumni'), ALUM2 = two('Alumni'), REC = one('Recorder'), HOUSE1 = one('House'), HOUSE2 = two('House');
  const required = { VP, PRES, TREAS, COMP, MARSHAL, RUSH1, SOC1, ALUM1, REC, HOUSE1 };
  // Shared position owner (e.g. both Rush chairs own the task together).
  const P = role => 'pos:' + one(role).role.trim();
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error('Missing officers for roles: ' + missing.join(', '));

  const pad = n => String(n).padStart(2, '0');
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ts = (n, h = 12) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };

  // ---------- tasks ----------
  // [owner, title, due (days from today), status, collaborators, notes, created (days ago)]
  const T = [
    [VP, 'Compile mid-semester officer reports', 5, 'In Progress', [PRES], 'Pull completion %s from the master list. Due to the president before the last meeting of the semester.', 12],
    [VP, 'Update chapter bylaws draft', 12, 'Not Started', [PRES, MARSHAL], 'Focus on the attendance and dues sections.', 9],
    [VP, 'Plan officer retreat for spring', 25, 'Not Started', [PRES, TREAS], '', 6],
    [VP, 'Collect committee chair updates', -20, 'Done', [], '', 35],

    [PRES, 'Submit chapter roster to Greek Life office', -30, 'Done', [REC], '', 45],
    [PRES, 'Meet with chapter advisor', 2, 'Not Started', [VP], 'Topics: spring budget, risk management training, new member numbers.', 7],
    [PRES, 'Prepare end-of-semester chapter address', 28, 'Not Started', [], '', 4],
    [PRES, 'Respond to IFC compliance survey', -2, 'In Progress', [MARSHAL], 'Need standards board numbers from Marshal.', 14],

    [TREAS, 'Send fall dues reminders', -14, 'Done', [], '', 30],
    [TREAS, 'Reconcile October bank statement', -1, 'In Progress', [], 'Two Venmo transfers still unmatched.', 10],
    [TREAS, 'Draft spring budget proposal', 9, 'In Progress', [VP, PRES], 'Waiting on social + rush numbers.', 8],
    [TREAS, 'Collect late dues from members', 0, 'In Progress', [], '6 members still outstanding.', 5],

    [COMP, 'Roll out Officer Hub to the exec board', 1, 'In Progress', [VP], 'Demo at Sunday meeting, then send everyone the link.', 3],
    [COMP, 'Update chapter website with fall photos', 6, 'Not Started', [SOC1], '', 6],
    [COMP, 'Set up shared Google Drive for officers', -25, 'Done', [], '', 40],

    [MARSHAL, 'Organize study hours schedule', -40, 'Done', [], '', 60],
    [MARSHAL, 'Run new member education session #6', 3, 'Not Started', [], '', 5],
    [MARSHAL, 'Review standards board cases', 8, 'In Progress', [VP], 'Two cases pending.', 9],

    [RUSH1, 'Book venue for spring rush kickoff', 4, 'In Progress', [RUSH2, TREAS], 'Two quotes so far: $650 and $480. Need a third.', 11],
    [RUSH2, 'Design spring rush t-shirts', 10, 'Blocked', [TREAS], 'Waiting on budget approval before ordering.', 9],
    [RUSH1, 'Update rush contact spreadsheet', -10, 'Done', [], '', 25],
    [P('Rush'), 'Plan spring recruitment calendar', 16, 'Not Started', [], '', 4],

    [SOC1, 'Finalize date party venue + DJ', 2, 'In Progress', [SOC2, TREAS], 'Deposit due by Tuesday.', 13],
    [SOC2, 'Submit event registration for formal', -3, 'Not Started', [SOC1], 'Has to go through Greek Life 3 weeks ahead.', 15],
    [SOC2, 'Halloween mixer recap + cleanup', -16, 'Done', [], '', 22],
    [P('Social'), 'Philanthropy 5K logistics', 18, 'Not Started', [MARSHAL], '', 5],

    [ALUM1, 'Send fall alumni newsletter', -1, 'In Progress', [REC], 'Draft is done, need photos from the website.', 14],
    [ALUM2, 'Plan homecoming alumni tailgate', -28, 'Done', [SOC1], '', 50],
    [P('Alumni'), 'Update alumni contact database', 14, 'Not Started', [], '', 6],
    [ALUM1, 'Reach out to alumni for spring mentorship program', 7, 'In Progress', [ALUM2], '12 of 30 alumni have replied.', 10],

    [REC, 'Post Nov meeting minutes', -5, 'Done', [], '', 8],
    [REC, 'Archive fall attendance records', 20, 'Not Started', [], '', 3],
    [REC, 'Send weekly chapter announcements', 1, 'In Progress', [], '', 2],

    [P('House'), 'Schedule house deep clean before break', 6, 'Not Started', [], '', 7],
    [HOUSE2, 'Fix broken window in common room', -6, 'Blocked', [TREAS], "Landlord hasn't responded. Might need to pay out of house fund.", 16],
    [HOUSE2, 'Create chore rotation for December', 11, 'Not Started', [], '', 4],
    [HOUSE1, 'Replace smoke detector batteries', -18, 'Done', [], '', 26],
  ];
  const tasks = T.map(([owner, title, due, status, collabs, notes, createdAgo], i) => ({
    id: `demo-task-${pad(i + 1)}`,
    title, notes, status,
    owner_id: typeof owner === 'string' ? owner : owner.id,
    collaborator_ids: collabs.filter(Boolean).filter(x => x.id !== owner.id).map(x => x.id),
    due_date: day(due),
    created_by: i % 3 === 0 && typeof owner !== 'string' ? owner.id : VP.id,
    created_at: ts(-createdAgo, 10),
    updated_at: ts(Math.min(-1, due), 16),
  }));

  // When done tasks were finished (needs schema v2). Mostly early or on time, a couple late.
  const hasCompletedAt = !(await sb.from('tasks').select('completed_at').limit(1)).error;
  const hasComments = !(await sb.from('task_comments').select('id').limit(1)).error;
  if (hasCompletedAt) {
    tasks.forEach((t, i) => {
      if (t.status !== 'Done') { t.completed_at = null; return; }
      const due = T[i][2];
      const late = i % 5 === 1; // a couple of late finishes so on-time % isn't all 100s
      t.completed_at = ts(Math.min(late ? due + 2 : due - (i % 3), -1), 15);
      t.updated_at = t.completed_at;
    });
  }

  // Task updates + activity (needs schema v2). [task #, author, kind, body, days ago, hour]
  const C = [
    [1, VP, 'created', VP.id, 12, 10], [1, VP, 'status', 'In Progress', 6, 21], [1, PRES, 'comment', 'Can we include attendance numbers too?', 5, 13], [1, VP, 'comment', 'Yep, pulling them from the People tab.', 5, 14],
    [8, PRES, 'status', 'In Progress', 9, 16], [8, PRES, 'comment', 'Waiting on standards board numbers before I can submit.', 4, 11], [8, MARSHAL, 'comment', 'Sending them tonight.', 3, 19],
    [10, TREAS, 'comment', 'Two Venmo transfers still unmatched. Checking with the bank Monday.', 2, 17],
    [11, VP, 'assign', TREAS.id, 8, 10], [11, TREAS, 'status', 'In Progress', 6, 12], [11, TREAS, 'comment', 'Still need social and rush numbers. @Mason @Emmett', 3, 20],
    [12, TREAS, 'comment', '6 members still outstanding. Sending individual texts today.', 1, 9],
    [13, COMP, 'status', 'In Progress', 3, 18], [13, COMP, 'comment', 'Demoing it at Sunday meeting 🚀', 1, 22], [13, VP, 'comment', 'Looks great. Loving the leaderboard.', 0, 10],
    [19, RUSH1, 'comment', 'Two quotes so far: $650 and $480. Third one coming Monday.', 4, 15], [19, TREAS, 'comment', 'Anything under $500 is approved.', 3, 12],
    [20, RUSH2, 'status', 'Blocked', 5, 14], [20, RUSH2, 'comment', 'Blocked until the spring budget is approved.', 5, 14],
    [23, SOC1, 'status', 'In Progress', 10, 13], [23, SOC1, 'comment', 'Venue held until Tuesday. Need the $300 deposit.', 2, 18], [23, TREAS, 'comment', 'Approved, sending it tomorrow.', 1, 11],
    [24, VP, 'comment', 'This was due Thursday. Can you get it in today?', 1, 10],
    [27, ALUM1, 'comment', 'Draft is done, just need photos from the website.', 2, 16], [27, REC, 'comment', 'Reviewed it, looks good.', 1, 20],
    [35, HOUSE2, 'status', 'Blocked', 8, 12], [35, HOUSE2, 'comment', "Landlord still hasn't responded. Getting a repair quote as backup.", 3, 17],
  ];
  const comments = C.map(([n, author, kind, body, ago, hour], i) => ({
    id: `demo-cmt-${pad(i + 1)}`, task_id: `demo-task-${pad(n)}`, author_id: (author || VP).id, kind, body, created_at: ts(-ago, hour),
  }));

  // ---------- meetings ----------
  // Weekly on Sundays. Five past meetings plus the next one.
  const sun = () => { const d = new Date(); return (7 - d.getDay()) % 7 || 7; }; // days until next Sunday (never today)
  const next = sun();
  const offsets = [next - 42, next - 35, next - 28, next - 21, next - 14, next];
  const minutes = [
    'Attendance: quorum met.\n\nTreasurer: fall dues 82% collected, reminders going out this week.\nSocial: Halloween mixer approved, budget $900.\nRush: spring rush planning starts after midterms.\nAlumni: homecoming tailgate went well, ~40 alumni came.\n\nAction items:\n- Treasurer to send dues reminders\n- Social to submit mixer registration',
    'Attendance: quorum met.\n\nPresident: IFC compliance survey due end of month.\nMarshal: study hours averages up 15% from last semester.\nHouse: common room window broken, landlord contacted.\n\nAction items:\n- Marshal to send standards numbers to President\n- House to follow up with landlord',
    'Attendance: quorum met.\n\nSocial: Halloween mixer recap, no incidents, cleanup done.\nRush: venue search for spring kickoff, need 3 quotes.\nComputer: shared officer Drive is live.\n\nAction items:\n- Rush to collect venue quotes\n- Everyone move docs into the shared Drive',
    'Attendance: quorum met.\n\nVP: mid-semester officer reports coming. Every officer should update their task statuses.\nTreasurer: spring budget proposal in progress, needs numbers from social and rush.\nAlumni: mentorship program outreach started.\n\nAction items:\n- Social + Rush to send budget numbers to Treasurer\n- Alumni to send newsletter draft to Recorder',
    'Attendance: quorum met.\n\nComputer: demoed Officer Hub, a new task tracker for the exec board.\nSocial: date party venue shortlisted, deposit due soon.\nHouse: deep clean scheduled before break.\nPresident: advisor meeting next week.\n\nAction items:\n- All officers to log into Officer Hub and check their tasks\n- Social to send venue contract to Treasurer',
    '',
  ];
  const agendas = [
    'Dues update\nHalloween mixer\nHomecoming recap',
    'IFC compliance\nStudy hours\nHouse issues',
    'Mixer recap\nSpring rush venues\nShared Drive',
    'Mid-semester reports\nSpring budget\nAlumni mentorship',
    'Officer Hub demo\nDate party\nBreak prep',
    'Mid-semester officer reports\nSpring budget proposal\nDate party final details\nOpen floor',
  ];
  const meetings = offsets.map((o, i) => ({
    id: `demo-mtg-${i + 1}`,
    title: i === offsets.length - 1 ? 'Weekly Exec Meeting' : 'Weekly Exec Meeting',
    date: day(o), time: '19:00', location: 'Chapter room',
    agenda: agendas[i],
    minutes_text: minutes[i], minutes_link: '', minutes_files: [],
  }));

  // ---------- RSVPs, absence updates, attendance ----------
  const absences = [
    [ { o: SOC2, up: 'Halloween mixer registration submitted. Working on the cleanup crew list.', req: 'Treasurer: need the $900 mixer budget released by Thursday.' } ],
    [ { o: ALUM2, up: 'Homecoming tailgate recap photos are in the Drive.', req: 'Computer: can you add the tailgate photos to the website?' },
      { o: HOUSE1, up: 'Smoke detectors all replaced. House inspection is next month.', req: 'None this week.' } ],
    [ { o: RUSH2, up: 'Started sketching rush shirt designs, will share next week.', req: 'Treasurer: what is the shirt budget ceiling?' } ],
    [ { o: MARSHAL, up: 'New member education session #5 done. Study hours up again.', req: 'President: can we put the standards cases on next week\'s agenda?' } ],
    [ { o: SOC1, up: 'Date party venue down to two options, DJ booked tentatively.', req: 'Treasurer: need deposit approval ($300) by Tuesday.' },
      { o: ALUM1, up: 'Newsletter draft is done. 12 alumni signed up for mentorship.', req: 'Recorder: please review the newsletter draft in the Drive.' } ],
    [ { o: HOUSE2, up: 'Window still not fixed. Getting a quote from a repair company as a backup.', req: 'Treasurer: can the house fund cover ~$250 if the landlord won\'t?' },
      { o: RUSH1, up: 'Third venue quote coming Monday. Kickoff date tentatively Jan 18.', req: 'Social: can we share the sound system rental with the date party?' } ],
  ];
  const responses = [];
  meetings.forEach((m, i) => {
    const upcoming = i === meetings.length - 1;
    const away = new Set(absences[i].map(a => a.o.id));
    absences[i].forEach(a => responses.push({
      id: `${m.id}|${a.o.id}`, meeting_id: m.id, officer_id: a.o.id, status: 'no',
      upcoming: a.up, requests: a.req, responded_at: ts(Math.min(offsets[i] - 1, -1), 20), present: false,
    }));
    officers.forEach((o, k) => {
      if (away.has(o.id)) return;
      // upcoming meeting: about two-thirds have RSVP'd so far
      if (upcoming && (k * 7 + i) % 3 === 0) return;
      // past meetings: nearly everyone RSVP'd yes; one person per meeting forgot to RSVP but still came
      const forgot = !upcoming && (k + i) % 9 === 0;
      responses.push({
        id: `${m.id}|${o.id}`, meeting_id: m.id, officer_id: o.id,
        status: forgot ? null : 'yes', upcoming: '', requests: '',
        responded_at: forgot ? null : ts(Math.min(offsets[i] - 2, -1 - (k % 3)), 18),
        present: !upcoming && !((k * 5 + i) % 13 === 0 && !forgot), // the odd no-show
      });
    });
  });

  // ---------- write ----------
  const writes = [['tasks', tasks], ['meetings', meetings], ['meeting_responses', responses]];
  if (hasComments) writes.push(['task_comments', comments]);
  for (const [table, rows] of writes) {
    const { error: e } = await sb.from(table).upsert(rows);
    if (e) throw new Error(`${table}: ${e.message}`);
  }
  return { tasks: tasks.length, meetings: meetings.length, responses: responses.length, comments: hasComments ? comments.length : 'skipped (run schema.sql v2)', completedAt: hasCompletedAt };
}
