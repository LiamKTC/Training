// Hybrid Training Portal — Pro UX + Adaptive Training Engine
// GitHub Pages static. localStorage persistence.

const STORAGE_KEY = "hybridPortal.pro.v1";
const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// -------------------- Helpers --------------------
function iso(d) { return new Date(d).toISOString().slice(0, 10); }
function todayISO() { return iso(new Date()); }
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function dayKeyFromISO(dateStr) {
  const d = new Date(dateStr).getDay(); // 0 Sun..6 Sat
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d];
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function num(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }

const TRAINING_DAYS = new Set(["mon", "tue", "thu", "sat", "sun"]); // your preference
function isTrainingDay(dateISO) { return TRAINING_DAYS.has(dayKeyFromISO(dateISO)); }

// -------------------- Plan (12 weeks) --------------------
const weekPlans = {
  1: { mon: "4 km", thu: "5 km", sun: "7 km", phase: "Foundation" },
  2: { mon: "4 km", thu: "5 km", sun: "8 km", phase: "Foundation" },
  3: { mon: "4 km", thu: "6 km", sun: "9 km", phase: "Foundation" },
  4: { mon: "4 km", thu: "5 km", sun: "7 km (deload)", phase: "Foundation (deload)" },
  5: { mon: "5 km", thu: "6 km", sun: "10 km", phase: "Durability" },
  6: { mon: "5 km", thu: "6 km", sun: "11 km", phase: "Durability" },
  7: { mon: "5 km", thu: "7 km", sun: "12 km", phase: "Durability" },
  8: { mon: "5 km", thu: "6 km", sun: "10 km (deload)", phase: "Durability (deload)" },
  9: { mon: "6 km", thu: "7 km", sun: "14 km", phase: "Pre-base" },
  10:{ mon: "6 km", thu: "7 km", sun: "16 km", phase: "Pre-base" },
  11:{ mon: "6 km", thu: "8 km", sun: "17 km", phase: "Pre-base" },
  12:{ mon: "6 km", thu: "8 km", sun: "18 km", phase: "Pre-base" },
};

function buildSessionQueueForWeek(w) {
  const p = weekPlans[w];
  return [
    { type: "run_easy", label: "Easy run", target: p.mon },
    { type: "strength", label: "Strength", target: "Full session (~45m)" },
    { type: "run_easy", label: "Easy run", target: p.thu },
    { type: "climb", label: "Climb", target: "Technique/volume (limit sparingly)" },
    { type: "run_long", label: "Long run", target: p.sun },
  ];
}

function buildPlan(startISO) {
  const sessions = [];
  let idx = 0;
  for (let w = 1; w <= 12; w++) {
    for (const s of buildSessionQueueForWeek(w)) {
      sessions.push({
        id: `S${String(++idx).padStart(3, "0")}`,
        week: w,
        phase: weekPlans[w].phase,
        ...s
      });
    }
  }

  state.startDate = startISO;
  state.sessions = sessions;
  state.progress = { nextIdx: 0 };
  state.logs = {};                  // dateISO -> { assignedId, completed, pain, notes }
  state.selectedWeek = 1;
  state.climbIntensity = "technique";
  save();
}

// -------------------- Pain + Coach logic --------------------
function getPain() {
  const knee = Number(document.getElementById("kneePain")?.value || 0);
  const plantar = Number(document.getElementById("plantarPain")?.value || 0);
  const firstStep = Boolean(document.getElementById("firstStep")?.checked);
  return { knee, plantar, firstStep };
}

function traffic(p) {
  if (p.knee >= 7 || p.plantar >= 7) return "red";
  if (p.knee >= 4 || p.plantar >= 4 || p.firstStep) return "amber";
  return "green";
}

function adjustSession(session, pain) {
  const light = traffic(pain);
  if (!session) return null;

  // climbing intensity affects Sunday long run behaviour
  const climbInt = state.climbIntensity || "technique";

  if (light === "green") {
    if (session.type === "run_long" && climbInt === "limit") {
      return {
        ...session,
        adjustedNote: "Green, but you chose LIMIT climbing: cap long run at the lower end, stay flat."
      };
    }
    return { ...session, adjustedNote: "As planned. Keep it easy and finish fresh." };
  }

  if (light === "amber") {
    if (session.type === "run_long") {
      return { ...session, adjustedNote: "Amber: reduce 10–20%, keep flat, walk breaks OK." };
    }
    if (session.type === "run_easy") {
      return { ...session, adjustedNote: "Amber: easy + flat, skip strides, shorten stride." };
    }
    if (session.type === "strength") {
      return { ...session, adjustedNote: "Amber: keep moderate, drop 1 calf set; reduce split squat depth if knee." };
    }
    if (session.type === "climb") {
      return { ...session, adjustedNote: "Amber: technique only; avoid limit bouldering; reduce toeing." };
    }
  }

  // red
  if (session.type.startsWith("run")) {
    return {
      ...session,
      type: "rehab",
      label: "Rehab / cross-train",
      target: "20–40 min easy walk/bike + foot/calf rehab",
      adjustedNote: "Red: replace run today. Protect tissues."
    };
  }
  if (session.type === "strength") {
    return { ...session, adjustedNote: "Red: upper body + gentle calves only; no heavy legs." };
  }
  if (session.type === "climb") {
    return { ...session, adjustedNote: "Red: skip climbing or do very easy movement only." };
  }
  return { ...session, adjustedNote: "Red: keep it easy." };
}

function coachDecisionText(pain) {
  const t = traffic(pain);
  if (t === "green") return "Green: proceed";
  if (t === "amber") return "Amber: modify";
  return "Red: protect";
}

function coachNoteText(pain) {
  const t = traffic(pain);
  if (t === "green") return "Keep it easy. One quality session beats three forced sessions.";
  if (t === "amber") return "Reduce long-run distance and intensity. Drop one calf set if plantar is hot.";
  return "Swap runs for rehab/cross-train. No hero days.";
}

// -------------------- Adaptive scheduling (session queue) --------------------
function nextSession() {
  if (!state.sessions || !state.progress) return null;
  return state.sessions[state.progress.nextIdx] || null;
}

function getPlanForDate(dateISO) {
  state.logs = state.logs || {};

  // no plan before start
  if (!state.startDate || dateISO < state.startDate) {
    return { type: "info", label: "Not started", target: "Waiting for start date", phase: "" };
  }

  // already assigned on that date
  const log = state.logs[dateISO];
  if (log?.assignedId) return state.sessions.find(s => s.id === log.assignedId) || null;

  // rest day = no assignment
  if (!isTrainingDay(dateISO)) {
    return { type: "rest", label: "Rest", target: "Recovery + rehab", phase: "" };
  }

  const s = nextSession();
  if (!s) return { type: "done", label: "Plan complete", target: "Nice work.", phase: "" };

  // assign, but don't progress until completed
  state.logs[dateISO] = state.logs[dateISO] || {};
  state.logs[dateISO].assignedId = s.id;
  save();
  return s;
}

function completeDate(dateISO, completed) {
  const planned = getPlanForDate(dateISO);
  const pain = getPain();

  state.logs = state.logs || {};
  state.logs[dateISO] = state.logs[dateISO] || {};
  state.logs[dateISO].completed = completed;
  state.logs[dateISO].pain = pain;
  state.logs[dateISO].timestamp = new Date().toISOString();
  state.logs[dateISO].notes = document.getElementById("todayNotes")?.value || "";

  if (completed && planned?.id) {
    state.progress.nextIdx = (state.progress.nextIdx || 0) + 1;
  }

  save();
}

// -------------------- Risk banner (hypercritical guardrail) --------------------
function computeRiskBanner() {
  // Guardrail: if week-over-week you increased long run + calf load + chose limit climbing => warn hard.
  const week = Number(document.getElementById("weekSelect")?.value || state.selectedWeek || 1);
  const prev = getWeekLoads(Math.max(1, week - 1));
  const cur = getWeekLoads(week);

  const calfPrev = num(prev.calf.load);
  const calfCur  = num(cur.calf.load);

  const calfUp = (calfPrev !== null && calfCur !== null && calfCur > calfPrev);

  const longPrev = parseLongRunKm(weekPlans[Math.max(1, week - 1)].sun);
  const longCur  = parseLongRunKm(weekPlans[week].sun);
  const longUp = (longPrev !== null && longCur !== null && longCur > longPrev);

  const limitClimb = (state.climbIntensity === "limit");

  if (calfUp && longUp && limitClimb) {
    return "⚠ High risk week: long run ↑ + calf load ↑ + limit bouldering. Pick ONE. Your plantar will punish you.";
  }
  if ((calfUp && longUp) || (longUp && limitClimb) || (calfUp && limitClimb)) {
    return "⚠ Caution: two levers are increasing together. Hold one steady this week.";
  }
  return "";
}

function parseLongRunKm(text) {
  // extracts first number in something like "10 km" or "7 km (deload)".
  const m = String(text).match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

// -------------------- UI: Week selector + grids --------------------
function populateWeeks() {
  const sel = document.getElementById("weekSelect");
  sel.innerHTML = "";
  for (let w = 1; w <= 12; w++) {
    const opt = document.createElement("option");
    opt.value = String(w);
    opt.textContent = `Week ${w} — ${weekPlans[w].phase}`;
    sel.appendChild(opt);
  }
  sel.value = String(state.selectedWeek || 1);
}

function setWeek(w) {
  state.selectedWeek = w;
  save();
}

// week cards
const days = [
  { key: "mon", label: "Mon", badge: "Easy run", type: "run" },
  { key: "tue", label: "Tue", badge: "Strength", type: "strength" },
  { key: "wed", label: "Wed", badge: "Rest", type: "rest" },
  { key: "thu", label: "Thu", badge: "Easy run", type: "run" },
  { key: "fri", label: "Fri", badge: "Rest", type: "rest" },
  { key: "sat", label: "Sat", badge: "Climb", type: "climb" },
  { key: "sun", label: "Sun", badge: "Long run", type: "run" },
];

function badgeClasses(type) {
  if (type === "run") return "bg-blue-50 text-blue-700 border-blue-100";
  if (type === "strength") return "bg-purple-50 text-purple-700 border-purple-100";
  if (type === "climb") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

let selectedDayKey = null;

function dayTextForWeek(dayKey, plan) {
  if (dayKey === "mon") return plan.mon;
  if (dayKey === "thu") return plan.thu;
  if (dayKey === "sun") return plan.sun;
  if (dayKey === "tue") return "Full session";
  if (dayKey === "sat") return `Bouldering (${state.climbIntensity || "technique"})`;
  return "Recovery";
}

function renderWeekGrid() {
  const week = Number(document.getElementById("weekSelect").value);
  const plan = weekPlans[week];
  setWeek(week);

  const grid = document.getElementById("weekGrid");
  grid.innerHTML = "";

  const todayKey = dayKeyFromISO(todayISO());

  days.forEach(d => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "text-left rounded-2xl border border-slate-200 bg-white p-4 hover:bg-slate-50 transition shadow-[0_1px_0_rgba(15,23,42,0.04)] focus:outline-none focus:ring-2 focus:ring-slate-900";
    card.setAttribute("data-day-card", d.key);

    const isToday = d.key === todayKey;
    if (isToday) card.classList.add("ring-2", "ring-blue-500");

    const title = document.createElement("div");
    title.className = "text-xs font-bold text-slate-500";
    title.textContent = d.label;

    const badge = document.createElement("div");
    badge.className = `mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${badgeClasses(d.type)}`;
    badge.textContent = d.badge;

    const main = document.createElement("div");
    main.className = "mt-2 text-sm font-extrabold text-slate-900";
    main.textContent = dayTextForWeek(d.key, plan);

    const sub = document.createElement("div");
    sub.className = "mt-1 text-xs text-slate-500";
    sub.textContent = plan.phase;

    card.appendChild(title);
    card.appendChild(badge);
    card.appendChild(main);
    card.appendChild(sub);

    card.addEventListener("click", () => {
      showDayDetails(d.key);
      highlightSelectedDayCard(d.key);
    });

    grid.appendChild(card);
  });

  if (selectedDayKey) highlightSelectedDayCard(selectedDayKey);

  // risk banner
  const banner = document.getElementById("riskBanner");
  const msg = computeRiskBanner();
  banner.textContent = msg;
}

// details templates
const dayTemplates = {
  mon: (plan) => ({
    title: "Monday — Easy run",
    subtitle: plan.phase,
    session: `Easy run — ${plan.mon}`,
    effort: "RPE 3–4/10. Flat route. Finish fresh.",
    checklist: ["5 min walk warm-up", "Easy pace only", "2 min rehab after"],
    adjustments: ["Plantar: softer/flat, shorten stride", "Knee: avoid hills, higher cadence"]
  }),
  tue: (plan) => ({
    title: "Tuesday — Strength",
    subtitle: plan.phase,
    session: "Strength — ~45 min",
    effort: "RPE ~7. Technique is the KPI.",
    checklist: [
      "Split squat 3×6–8/leg (3s down)",
      "Trap bar 3×5",
      "Calves: straight 3×12–20 + bent 3×12–15",
      "Foot intrinsics + tibialis 2–4 min"
    ],
    adjustments: ["Plantar: drop 1 calf set", "Knee: reduce split squat depth"]
  }),
  wed: (plan) => ({
    title: "Wednesday — Recovery",
    subtitle: plan.phase,
    session: "Recovery + rehab",
    effort: "You should feel better afterwards.",
    checklist: ["2–3 min rehab", "Optional easy walk", "Sleep"],
    adjustments: ["Plantar: gentle rolling + stretch", "Knee: light mobility only"]
  }),
  thu: (plan) => ({
    title: "Thursday — Easy run",
    subtitle: plan.phase,
    session: `Easy run — ${plan.thu}`,
    effort: "RPE 3–4/10. Optional strides only if perfect.",
    checklist: ["Warm-up 5 min", "Easy pace", "Rehab after"],
    adjustments: ["Plantar: skip strides, stay flat", "Knee: skip strides/hills"]
  }),
  fri: (plan) => ({
    title: "Friday — Recovery",
    subtitle: plan.phase,
    session: "Rest / mobility",
    effort: "Keep the engine ready.",
    checklist: ["Rehab 2–3 min", "Mobility hips/ankles", "Hydrate"],
    adjustments: ["Plantar: stretch/roll", "Knee: avoid deep knee work"]
  }),
  sat: (plan) => ({
    title: "Saturday — Climb",
    subtitle: plan.phase,
    session: `Climb — ${state.climbIntensity || "technique"}`,
    effort: "Technique/volume most weeks. Limit sparingly.",
    checklist: ["Warm shoulders/hands", "Limit toeing if plantar", "Stop before fried"],
    adjustments: ["Plantar: reduce toe hooks + volume", "Limit day → cap Sunday long run low end"]
  }),
  sun: (plan) => ({
    title: "Sunday — Long run",
    subtitle: plan.phase,
    session: `Long run — ${plan.sun}`,
    effort: "Steady easy. Walk breaks are smart.",
    checklist: ["Start slower than you think", "Flat route", "Rehab after"],
    adjustments: ["Plantar: reduce 10–20%", "Knee: reduce distance, avoid hills"]
  }),
};

function showDayDetails(dayKey) {
  const week = Number(document.getElementById("weekSelect").value);
  const plan = weekPlans[week];
  const tpl = dayTemplates[dayKey]?.(plan);
  if (!tpl) return;

  selectedDayKey = dayKey;
  const panel = document.getElementById("dayDetails");
  panel.classList.remove("hidden");

  document.getElementById("dayTitle").textContent = tpl.title;
  document.getElementById("daySubtitle").textContent = `Week ${week} — ${tpl.subtitle}`;
  document.getElementById("daySession").textContent = tpl.session;
  document.getElementById("dayEffortText").textContent = tpl.effort;
  document.getElementById("dayChecklist").innerHTML = tpl.checklist.map(x => `<li>• ${x}</li>`).join("");
  document.getElementById("dayAdjustments").innerHTML = tpl.adjustments.map(x => `<li>• ${x}</li>`).join("");

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function highlightSelectedDayCard(dayKey) {
  document.querySelectorAll("[data-day-card]").forEach(el => {
    el.classList.remove("ring-2", "ring-indigo-500");
  });
  const target = document.querySelector(`[data-day-card="${dayKey}"]`);
  if (target) target.classList.add("ring-2", "ring-indigo-500");
}

// -------------------- Today + schedule list --------------------
function updatePainUI() {
  const knee = Number(document.getElementById("kneePain").value);
  const plantar = Number(document.getElementById("plantarPain").value);
  document.getElementById("kneeVal").textContent = knee;
  document.getElementById("plantarVal").textContent = plantar;
}

function effectiveTodayISO() {
  const t = todayISO();
  if (!state.startDate) return t;
  return t < state.startDate ? state.startDate : t;
}

function renderToday() {
  updatePainUI();

  const sub = document.getElementById("todaySubtitle");
  const sessEl = document.getElementById("todaySession");
  const effEl = document.getElementById("todayEffort");
  const decEl = document.getElementById("coachDecision");
  const noteEl = document.getElementById("coachNote");
  const mini = document.getElementById("miniNext");

  if (!state.startDate || !state.sessions || !state.progress) {
    sub.textContent = "Set a start date, then Build / Reset.";
    sessEl.textContent = "—";
    effEl.textContent = "—";
    decEl.textContent = "—";
    noteEl.textContent = "—";
    mini.textContent = "Set a start date to begin.";
    return;
  }

  const dateISO = effectiveTodayISO();
  const planned = getPlanForDate(dateISO);
  const pain = getPain();
  const adjusted = adjustSession(planned, pain);

  sub.textContent = `Start: ${state.startDate} • Today: ${dateISO} (${dayKeyFromISO(dateISO).toUpperCase()})`;
  sessEl.textContent = `${adjusted.label} — ${adjusted.target}`;
  effEl.textContent = adjusted.adjustedNote || "";
  decEl.textContent = coachDecisionText(pain);
  noteEl.textContent = coachNoteText(pain);
  mini.textContent = `${adjusted.label}: ${adjusted.target}`;

  // bind notes to date
  const notesBox = document.getElementById("todayNotes");
  const k = `note.${dateISO}`;
  if (notesBox.dataset.key !== k) {
    notesBox.dataset.key = k;
    notesBox.value = state[k] || "";
  }

  renderScheduleList(dateISO);
  renderWeekGrid();
  updateLoadLogUI();
}

function renderScheduleList(startDateISO) {
  const list = document.getElementById("scheduleList");
  list.innerHTML = "";

  // show next 14 days, with what is assigned (or would be assigned)
  let date = startDateISO;
  for (let i = 0; i < 14; i++) {
    const planned = getPlanForDate(date);
    const log = state.logs?.[date];
    const completed = log?.completed === true;
    const skipped = log?.completed === false;

    const row = document.createElement("button");
    row.type = "button";
    row.className = "w-full text-left py-3 flex items-start justify-between gap-3 hover:bg-slate-50 px-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900";

    const left = document.createElement("div");
    left.className = "min-w-0";
    const dateLine = document.createElement("div");
    dateLine.className = "text-xs font-bold text-slate-500";
    dateLine.textContent = `${date} • ${dayKeyFromISO(date).toUpperCase()}` + (isTrainingDay(date) ? "" : " • REST");

    const title = document.createElement("div");
    title.className = "truncate text-sm font-semibold text-slate-900";
    title.textContent = `${planned.label} — ${planned.target}`;

    left.appendChild(dateLine);
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "flex items-center gap-2";
    const pill = document.createElement("div");
    pill.className = "text-[11px] font-bold px-3 py-1 rounded-full border";

    if (completed) {
      pill.className += " bg-emerald-50 text-emerald-700 border-emerald-200";
      pill.textContent = "DONE";
    } else if (skipped) {
      pill.className += " bg-slate-100 text-slate-700 border-slate-200";
      pill.textContent = "SKIPPED";
    } else if (date === startDateISO) {
      pill.className += " bg-blue-50 text-blue-700 border-blue-200";
      pill.textContent = "TODAY";
    } else {
      pill.className += " bg-white text-slate-600 border-slate-200";
      pill.textContent = "UPCOMING";
    }
    right.appendChild(pill);

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", () => {
      // jump the UI context to that weekday
      const wk = planned.week ? planned.week : state.selectedWeek || 1;
      document.getElementById("weekSelect").value = String(wk);
      setWeek(wk);
      showDayDetails(dayKeyFromISO(date));
      highlightSelectedDayCard(dayKeyFromISO(date));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    list.appendChild(row);
    date = addDays(date, 1);
  }
}

// -------------------- Strength load logging + progression hints --------------------
function logKey(week) { return `loads.week${week}`; }
function getWeekLoads(week) {
  return state[logKey(week)] || {
    split: { load: "", sets: "", reps: "" },
    trap: { load: "", sets: "", reps: "" },
    calf: { load: "", sets: "", reps: "" }
  };
}
function setWeekLoads(week, loads) { state[logKey(week)] = loads; save(); }

function fmtPrev(ex) {
  if (!ex || (!ex.load && !ex.sets && !ex.reps)) return "Prev: —";
  const parts = [];
  if (ex.load !== "") parts.push(`${ex.load}kg`);
  if (ex.sets !== "" && ex.reps !== "") parts.push(`${ex.sets}×${ex.reps}`);
  return "Prev: " + parts.join(" • ");
}

function suggestProgress(prevLoad, curLoad, liftName) {
  const p = num(prevLoad);
  const c = num(curLoad);
  if (c === null) return "Log a working load to get suggestions.";
  if (p === null) return "Baseline set. Repeat next week before increasing.";
  if (c > p) return `Up from last week. Hold steady next week unless everything feels perfect.`;
  if (c === p) return `If last week felt like RPE ≤ 7 with clean form, add +2.5kg next week.`;
  return `Down from last week—good call if you were sore or fatigued.`;
}

function updateLoadLogUI() {
  const week = Number(document.getElementById("weekSelect").value);
  const cur = getWeekLoads(week);
  const prev = getWeekLoads(Math.max(1, week - 1));

  document.getElementById("logWeekLabel").textContent = `Week ${week}`;
  document.getElementById("prevSplit").textContent = fmtPrev(prev.split);
  document.getElementById("prevTrap").textContent = fmtPrev(prev.trap);
  document.getElementById("prevCalf").textContent = fmtPrev(prev.calf);

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ""; };
  setVal("splitLoad", cur.split.load); setVal("splitSets", cur.split.sets); setVal("splitReps", cur.split.reps);
  setVal("trapLoad", cur.trap.load); setVal("trapSets", cur.trap.sets); setVal("trapReps", cur.trap.reps);
  setVal("calfLoad", cur.calf.load); setVal("calfSets", cur.calf.sets); setVal("calfReps", cur.calf.reps);

  document.getElementById("splitHint").textContent = suggestProgress(prev.split.load, cur.split.load, "split");
  document.getElementById("trapHint").textContent  = suggestProgress(prev.trap.load, cur.trap.load, "trap");
  document.getElementById("calfHint").textContent  = suggestProgress(prev.calf.load, cur.calf.load, "calf");

  const msg = document.getElementById("saveLoadsMsg");
  msg.textContent = "";
}

// -------------------- Export (for backup / portability) --------------------
function exportJSON() {
  const data = {
    version: STORAGE_KEY,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hybrid-training-export.json";
  a.click();
  URL.revokeObjectURL(url);
}

// -------------------- Wiring --------------------
function wire() {
  document.getElementById("buildPlanBtn").addEventListener("click", () => {
    const d = document.getElementById("startDate").value;
    if (!d) return alert("Pick a start date first.");
    if (!confirm("This will reset progress and logs. Continue?")) return;
    buildPlan(d);
    populateWeeks();
    renderToday();
  });

  document.getElementById("weekSelect").addEventListener("change", () => {
    setWeek(Number(document.getElementById("weekSelect").value));
    renderWeekGrid();
    updateLoadLogUI();
  });

  document.getElementById("exportBtn").addEventListener("click", exportJSON);

  const painInputs = ["kneePain", "plantarPain", "firstStep"];
  painInputs.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", renderToday);
    el.addEventListener("change", renderToday);
  });

  document.getElementById("todayNotes").addEventListener("input", (e) => {
    if (!state.startDate) return;
    const k = e.target.dataset.key;
    state[k] = e.target.value;
    save();
  });

  const complete = () => {
    if (!state.startDate) return alert("Set a start date and Build first.");
    completeDate(effectiveTodayISO(), true);
    renderToday();
  };
  const skip = () => {
    if (!state.startDate) return alert("Set a start date and Build first.");
    completeDate(effectiveTodayISO(), false);
    renderToday();
  };

  document.getElementById("completeBtn").addEventListener("click", complete);
  document.getElementById("skipBtn").addEventListener("click", skip);
  document.getElementById("miniComplete").addEventListener("click", complete);
  document.getElementById("miniSkip").addEventListener("click", skip);

  document.getElementById("closeDayDetails").addEventListener("click", () => {
    document.getElementById("dayDetails").classList.add("hidden");
    selectedDayKey = null;
    document.querySelectorAll("[data-day-card]").forEach(el => el.classList.remove("ring-2", "ring-indigo-500"));
  });

  // climb intensity is set by clicking Sat card text; provide quick cycle via keyboard later if desired
  // for now, allow cycling with key "c"
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "c") {
      const order = ["technique", "volume", "limit"];
      const cur = state.climbIntensity || "technique";
      const next = order[(order.indexOf(cur) + 1) % order.length];
      state.climbIntensity = next;
      save();
      renderToday();
    }
  });

  // load log buttons
  document.getElementById("saveLoadsBtn").addEventListener("click", () => {
    const week = Number(document.getElementById("weekSelect").value);
    const loads = {
      split: { load: document.getElementById("splitLoad").value.trim(), sets: document.getElementById("splitSets").value.trim(), reps: document.getElementById("splitReps").value.trim() },
      trap:  { load: document.getElementById("trapLoad").value.trim(),  sets: document.getElementById("trapSets").value.trim(),  reps: document.getElementById("trapReps").value.trim() },
      calf:  { load: document.getElementById("calfLoad").value.trim(),  sets: document.getElementById("calfSets").value.trim(),  reps: document.getElementById("calfReps").value.trim() },
    };
    setWeekLoads(week, loads);
    document.getElementById("saveLoadsMsg").textContent = "Saved ✅";
    renderToday();
  });

  document.getElementById("clearLoadsBtn").addEventListener("click", () => {
    const week = Number(document.getElementById("weekSelect").value);
    delete state[logKey(week)];
    save();
    document.getElementById("saveLoadsMsg").textContent = "Cleared for this week.";
    renderToday();
  });
}

// -------------------- Init --------------------
function init() {
  populateWeeks();

  if (state.startDate) document.getElementById("startDate").value = state.startDate;

  // default selected week
  document.getElementById("weekSelect").value = String(state.selectedWeek || 1);

  renderToday();
  wire();
}

init();
