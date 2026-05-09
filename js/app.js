const KEYS = {
  jobs: "llcs_jobs_v4",
  expenses: "llcs_expenses_v4",
  customers: "llcs_customers_v4",
  permissions: "llcs_permissions_v4",
  audit: "llcs_audit_v4"
};

/** Original single-page LLCS dashboard (localStorage) */
const LEGACY_LS = {
  users: "bd_users",
  jobs: "bd_jobs",
  expenses: "bd_expenses",
  meta: "bd_meta"
};

const BACKUP_SCHEMA_VERSION = 1;

function migrateLegacyJob(j) {
  j = j || {};
  const rawId = j.id !== undefined && j.id !== null ? j.id : Date.now();
  const id =
    typeof rawId === "string" && String(rawId).startsWith("j_")
      ? String(rawId)
      : `j_legacy_${rawId}`;
  const jobDate = j.date || "";
  const status = j.status || "planned";
  const scheduled =
    j.scheduledDate
      ? j.scheduledDate
      : jobDate || today();
  const completed =
    j.completedDate
      ? j.completedDate
      : status === "done" || status === "paid"
        ? jobDate
        : "";
  let tagsArr = [];
  if (Array.isArray(j.tags)) tagsArr = j.tags;
  else if (typeof j.tags === "string" && j.tags.trim()) tagsArr = j.tags.split(",").map(t => t.trim()).filter(Boolean);
  const notesExtras = [];
  if (j.status || j.priority) notesExtras.push(`legacy status: ${status}, priority: ${j.priority || "n/a"}`);
  if (tagsArr.length) notesExtras.push(`tags: ${tagsArr.join(", ")}`);
  if (j.whoName || j.who) notesExtras.push(`worker: ${j.whoName || j.who}`);
  if (j.attachmentUrl) notesExtras.push(`attachment: ${j.attachmentUrl}`);
  const tip = typeof j.tipAmount === "number" && !Number.isNaN(j.tipAmount) ? j.tipAmount : 0;
  const mergedNotes = [j.notes || "", notesExtras.length ? `\n[Migrated]\n${notesExtras.join("\n")}` : ""].filter(Boolean).join("");

  return {
    id,
    name: (j.name || "").trim() || "(untitled job)",
    customerId: j.customerId || null,
    neighborhood: j.neighborhood || "",
    zipCode: j.zipCode || "",
    size: ["small", "medium", "large"].includes(j.size) ? j.size : "medium",
    payment:
      typeof j.payment === "number" && !Number.isNaN(j.payment) ? Math.round(j.payment * 100) / 100 : 0,
    tipAmount: Math.round(Math.max(0, tip) * 100) / 100,
    scheduledDate: scheduled,
    scheduledWindow: j.scheduledWindow || "",
    completedDate: completed,
    notes: mergedNotes.trim(),
    checklist:
      j.checklist && typeof j.checklist === "object"
        ? {
          mow: !!j.checklist.mow,
          trim: !!j.checklist.trim,
          edge: !!j.checklist.edge,
          blow: !!j.checklist.blow
        }
        : { mow: true, trim: true, edge: true, blow: true }
  };
}

function migrateLegacyExpense(e) {
  e = e || {};
  const rawId = e.id !== undefined && e.id !== null ? e.id : Date.now();
  const id =
    typeof rawId === "string" && String(rawId).startsWith("e_")
      ? String(rawId)
      : `e_legacy_${rawId}`;
  let status = "pending";
  if (e.status === "approved") status = "approved";
  else if (e.status === "rejected") status = "rejected";
  else if (e.status === "pending") status = "pending";

  return {
    id,
    description: (e.description || "").trim() || "(expense)",
    amount:
      typeof e.amount === "number" && !Number.isNaN(e.amount) ? Math.round(e.amount * 100) / 100 : 0,
    date: e.date || today(),
    category: e.category || "other",
    paymentMethod: e.paymentMethod || "other",
    vendor: e.vendor || "",
    status,
    approvalComment: e.approvalComment || "",
    approvedByRole: e.approvedByRole || "",
    approvedAt: e.approvedAt || ""
  };
}

/** Merge arrays by id; incoming fields overwrite existing. */
function mergeById(existing, incoming) {
  const m = new Map(existing.map(it => [String(it.id), { ...it }]));
  incoming.forEach(it => {
    const sid = String(it.id);
    m.set(sid, { ...(m.get(sid) || {}), ...it });
  });
  return [...m.values()];
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportFullBackup() {
  logAudit("backup_export", "Full modular backup downloaded", {
    counts: countsSummary(),
    note: "Next lines in file include this event."
  });
  const payload = {
    llcsDashboard: true,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    jobs: state.jobs,
    expenses: state.expenses,
    customers: state.customers,
    permissions: state.permissions,
    audit: state.audit
  };
  downloadJson(payload, `llcs-modular-backup-${today()}.json`);
}

function countsSummary() {
  return {
    jobs: state.jobs.length,
    expenses: state.expenses.length,
    customers: state.customers.length,
    auditEntries: state.audit.length
  };
}

/**
 * Applies modular or legacy-export-shaped data.
 * @param {"merge"|"replace"} mode
 */
function applyImportedData(data, mode) {
  if (!data || typeof data !== "object") throw new Error("Invalid data.");

  let jobsIn = [];
  let expensesIn = [];
  let customersIn = [];
  let permissionsIn = null;
  let auditIn = null;
  let legacyMeta = null;
  let usersArray = [];

  if (data.llcsDashboard === true) {
    if (!Array.isArray(data.jobs) || !Array.isArray(data.expenses)) throw new Error("Backup missing jobs or expenses arrays.");
    jobsIn = data.jobs;
    expensesIn = data.expenses;
    customersIn = Array.isArray(data.customers) ? data.customers : [];
    if (data.permissions && typeof data.permissions === "object") permissionsIn = data.permissions;
    auditIn = Array.isArray(data.audit) ? data.audit : [];
  } else if (Array.isArray(data.jobs) && Array.isArray(data.expenses)) {
    jobsIn = data.jobs.map(migrateLegacyJob);
    expensesIn = data.expenses.map(migrateLegacyExpense);
    legacyMeta = data.meta || {};
    usersArray = Array.isArray(data.users) ? data.users : [];
    legacyMeta.usersCount = usersArray.length;
  } else {
    throw new Error("Unrecognized JSON shape. Expected modular backup or legacy export { jobs, expenses, … }.");
  }

  if (mode === "replace") {
    state.jobs = jobsIn.slice();
    state.expenses = expensesIn.slice();
    state.customers = data.llcsDashboard === true ? customersIn.slice() : [];
    state.permissions = permissionsIn
      ? JSON.parse(JSON.stringify(permissionsIn))
      : JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
    state.audit = data.llcsDashboard === true ? auditIn.slice() : [];
  } else {
    state.jobs = mergeById(state.jobs, jobsIn);
    state.expenses = mergeById(state.expenses, expensesIn);
    if (data.llcsDashboard === true) state.customers = mergeById(state.customers, customersIn);
    if (permissionsIn) {
      Object.keys(DEFAULT_PERMISSIONS).forEach(role => {
        state.permissions[role] = {
          ...(state.permissions[role] || {}),
          ...(permissionsIn[role] || {})
        };
      });
    }
    if (data.llcsDashboard === true && auditIn.length) state.audit = [...auditIn, ...state.audit].slice(0, 500);
  }

  saveAll();
  logAudit("backup_import", `Import (${mode})`, {
    source: data.llcsDashboard === true ? "modular_backup" : "legacy_export",
    ...countsSummary(),
    legacyMeta:
      legacyMeta && Object.keys(legacyMeta).length ? legacyMeta : undefined
  });
  refreshEverything();
}

/** Read bd_jobs / bd_expenses from localStorage (original dashboard). */
function pullLegacyLocalStorage() {
  function tryParse(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const rawJobs = tryParse(LEGACY_LS.jobs);
  const rawExp = tryParse(LEGACY_LS.expenses);
  const rawUsers = tryParse(LEGACY_LS.users);
  const rawMeta = tryParse(LEGACY_LS.meta);

  if (!Array.isArray(rawJobs) && !Array.isArray(rawExp)) {
    alert(
      "No legacy data found. Open your original LLCS dashboard on this site once (same origin), or import a JSON file exported from it."
    );
    return;
  }

  const mode = document.getElementById("importModeSelect").value;
  const wrapped = {
    jobs: Array.isArray(rawJobs) ? rawJobs : [],
    expenses: Array.isArray(rawExp) ? rawExp : [],
    users: Array.isArray(rawUsers) ? rawUsers : [],
    meta: rawMeta || {}
  };

  try {
    applyImportedData(wrapped, mode === "replace" ? "replace" : "merge");
    alert(`Legacy import (${mode}). Jobs: ${state.jobs.length}, expenses: ${state.expenses.length}.`);
  } catch (err) {
    alert(err.message || String(err));
  }
}

const DEFAULT_PERMISSIONS = {
  founder: { viewAdmin: true, editPermissions: true, approveExpenses: true, deleteAny: true },
  admin: { viewAdmin: true, editPermissions: false, approveExpenses: true, deleteAny: true },
  employee: { viewAdmin: false, editPermissions: false, approveExpenses: false, deleteAny: false }
};

const state = {
  role: "founder",
  jobs: read(KEYS.jobs, []),
  expenses: read(KEYS.expenses, []),
  customers: read(KEYS.customers, []),
  permissions: read(KEYS.permissions, DEFAULT_PERMISSIONS),
  audit: read(KEYS.audit, [])
};

function read(k, d) {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
}
function write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function money(v) { return "$" + (Number(v || 0).toFixed(2)); }
function today() { return new Date().toISOString().slice(0, 10); }
function monthKey(dateStr) { return (dateStr || "").slice(0, 7); }
function saveAll() {
  write(KEYS.jobs, state.jobs);
  write(KEYS.expenses, state.expenses);
  write(KEYS.customers, state.customers);
  write(KEYS.permissions, state.permissions);
  write(KEYS.audit, state.audit);
}
function logAudit(type, summary, details = {}) {
  state.audit.unshift({
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    at: new Date().toISOString(),
    actorRole: state.role,
    type,
    summary,
    details
  });
  if (state.audit.length > 500) state.audit.length = 500;
  write(KEYS.audit, state.audit);
  renderAudit();
}
function hasPerm(name) {
  return !!(state.permissions[state.role] && state.permissions[state.role][name]);
}

function switchTab(id) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === id));
}

document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  if (btn.dataset.tab === "admin" && !hasPerm("viewAdmin")) return alert("No permission.");
  switchTab(btn.dataset.tab);
}));
document.getElementById("currentRole").addEventListener("change", (e) => {
  state.role = e.target.value;
  renderPermissions();
});

function fillCustomerSelect() {
  const sel = document.getElementById("jobCustomer");
  sel.innerHTML = `<option value="">No customer</option>` + state.customers.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

document.getElementById("customerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = {
    id: "c_" + Date.now(),
    name: val("customerName"),
    address: val("customerAddress"),
    phone: val("customerPhone"),
    neighborhood: val("customerNeighborhood"),
    zip: val("customerZip"),
    notes: val("customerNotes")
  };
  if (!c.name) return;
  state.customers.push(c);
  saveAll();
  logAudit("customer_created", `Customer added: ${c.name}`, c);
  e.target.reset();
  fillCustomerSelect();
  renderCustomers();
});

document.getElementById("jobCustomer").addEventListener("change", (e) => {
  const c = state.customers.find(x => x.id === e.target.value);
  if (!c) return;
  document.getElementById("jobNeighborhood").value = c.neighborhood || "";
  document.getElementById("jobZip").value = c.zip || "";
});

document.getElementById("jobForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const j = {
    id: "j_" + Date.now(),
    name: val("jobName"),
    customerId: val("jobCustomer") || null,
    neighborhood: val("jobNeighborhood"),
    zipCode: val("jobZip"),
    size: val("jobSize"),
    payment: Number(val("jobBasePayment") || 0),
    tipAmount: Number(val("jobTipAmount") || 0),
    scheduledDate: val("jobScheduledDate"),
    scheduledWindow: val("jobWindow"),
    completedDate: val("jobCompletedDate"),
    notes: val("jobNotes"),
    checklist: {
      mow: chk("taskMow"),
      trim: chk("taskTrim"),
      edge: chk("taskEdge"),
      blow: chk("taskBlow")
    }
  };
  if (!j.name || !j.scheduledDate) return alert("Job name and scheduled date required.");
  state.jobs.push(j);
  saveAll();
  logAudit("job_created", `Job created: ${j.name}`, j);
  e.target.reset();
  document.getElementById("jobScheduledDate").value = today();
  renderJobs();
  renderHome();
  renderCharts();
});

document.getElementById("expenseForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const ex = {
    id: "e_" + Date.now(),
    description: val("expenseDescription"),
    amount: Number(val("expenseAmount") || 0),
    date: val("expenseDate") || today(),
    category: val("expenseCategory"),
    paymentMethod: val("expensePaymentMethod"),
    vendor: val("expenseVendor"),
    status: "pending",
    approvalComment: "",
    approvedByRole: "",
    approvedAt: ""
  };
  if (!ex.description || ex.amount <= 0) return;
  state.expenses.push(ex);
  saveAll();
  logAudit("expense_created", `Expense added: ${ex.description}`, ex);
  e.target.reset();
  document.getElementById("expenseDate").value = today();
  renderExpenses();
  renderCharts();
});

function approveExpense(id) {
  if (!hasPerm("approveExpenses")) return alert("No permission.");
  const ex = state.expenses.find(x => x.id === id);
  if (!ex) return;
  const comment = prompt("Approval/rejection comment:") || "";
  const mode = prompt("Type approve or reject", "approve");
  ex.status = mode === "reject" ? "rejected" : "approved";
  ex.approvalComment = comment;
  ex.approvedByRole = state.role;
  ex.approvedAt = new Date().toISOString();
  saveAll();
  logAudit("expense_reviewed", `Expense ${ex.status}: ${ex.description}`, { id, comment });
  renderExpenses();
  renderCharts();
}

function toggleChecklist(id, key, value) {
  const j = state.jobs.find(x => x.id === id);
  if (!j) return;
  j.checklist[key] = value;
  saveAll();
  logAudit("job_checklist", `Checklist changed for ${j.name}`, { key, value });
}

function deleteJob(id) {
  if (!hasPerm("deleteAny")) return alert("No permission.");
  const j = state.jobs.find(x => x.id === id);
  state.jobs = state.jobs.filter(x => x.id !== id);
  saveAll();
  logAudit("job_deleted", `Job deleted: ${j ? j.name : id}`);
  renderJobs(); renderHome(); renderCharts();
}

function val(id) { return (document.getElementById(id).value || "").trim(); }
function chk(id) { return !!document.getElementById(id).checked; }

function renderCustomers() {
  const root = document.getElementById("customersList");
  root.innerHTML = state.customers.map(c => `<div class="list"><strong>${c.name}</strong><div>${c.address}</div><div>${c.phone}</div><div class="muted">${c.neighborhood} ${c.zip}</div><div class="muted">${c.notes || ""}</div></div>`).join("") || `<div class="muted">No customers yet.</div>`;
}

function renderJobs() {
  const root = document.getElementById("jobsList");
  root.innerHTML = state.jobs.map(j => {
    const total = (j.payment || 0) + (j.tipAmount || 0);
    return `<div class="list">
      <strong>${j.name}</strong> - ${money(total)} <span class="muted">(base ${money(j.payment)} + tip ${money(j.tipAmount)})</span>
      <div class="muted">Scheduled: ${j.scheduledDate || "-"} ${j.scheduledWindow || ""} | Completed: ${j.completedDate || "-"}</div>
      <div class="muted">Area: ${j.neighborhood || "-"} / ${j.zipCode || "-"}</div>
      <div>
        <label><input type="checkbox" data-job="${j.id}" data-key="mow" ${j.checklist?.mow ? "checked" : ""}/> mow</label>
        <label><input type="checkbox" data-job="${j.id}" data-key="trim" ${j.checklist?.trim ? "checked" : ""}/> trim</label>
        <label><input type="checkbox" data-job="${j.id}" data-key="edge" ${j.checklist?.edge ? "checked" : ""}/> edge</label>
        <label><input type="checkbox" data-job="${j.id}" data-key="blow" ${j.checklist?.blow ? "checked" : ""}/> blow</label>
        <button class="quick-link" data-jump="${j.id}">Open</button>
        <button data-del-job="${j.id}">Delete</button>
      </div>
    </div>`;
  }).join("") || `<div class="muted">No jobs yet.</div>`;

  root.querySelectorAll("input[data-job]").forEach(el => el.addEventListener("change", (e) => {
    toggleChecklist(e.target.dataset.job, e.target.dataset.key, e.target.checked);
  }));
  root.querySelectorAll("button[data-del-job]").forEach(el => el.addEventListener("click", () => deleteJob(el.dataset.delJob)));
}

function renderExpenses() {
  const root = document.getElementById("expensesList");
  root.innerHTML = state.expenses.map(e => `<div class="list">
    <strong>${e.description}</strong> - ${money(e.amount)} <span class="muted">${e.date}</span>
    <div class="muted">Category: ${e.category} | Method: ${e.paymentMethod} | Vendor: ${e.vendor || "-"}</div>
    <div class="muted">Status: ${e.status} ${e.approvalComment ? "- " + e.approvalComment : ""}</div>
    <button data-approve="${e.id}">Review</button>
  </div>`).join("") || `<div class="muted">No expenses yet.</div>`;
  root.querySelectorAll("button[data-approve]").forEach(el => el.addEventListener("click", () => approveExpense(el.dataset.approve)));
}

function renderHome() {
  const t = today();
  const todayJobs = state.jobs.filter(j => j.scheduledDate === t);
  const sum = document.getElementById("todaySummary");
  sum.innerHTML = todayJobs.length
    ? todayJobs.map(j => `<div class="list"><strong>${j.name}</strong> <span class="muted">${j.scheduledWindow || ""}</span><button class="quick-link" data-jump="${j.id}">Go to job</button></div>`).join("")
    : `<div class="muted">No jobs scheduled today.</div>`;
  sum.querySelectorAll("button[data-jump]").forEach(el => el.addEventListener("click", () => {
    switchTab("jobs");
    document.querySelector(`[data-jump="${el.dataset.jump}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }));

  const income = state.jobs.reduce((s, j) => s + (j.payment || 0) + (j.tipAmount || 0), 0);
  const expenses = state.expenses.filter(x => x.status === "approved").reduce((s, e) => s + (e.amount || 0), 0);
  document.getElementById("quickStats").innerHTML = `
    <div class="card"><h3>Total income</h3><div>${money(income)}</div></div>
    <div class="card"><h3>Approved expenses</h3><div>${money(expenses)}</div></div>
    <div class="card"><h3>Net profit</h3><div>${money(income - expenses)}</div></div>
  `;
}

function renderPermissions() {
  const root = document.getElementById("permissionsEditor");
  const canEdit = hasPerm("editPermissions");
  const roles = Object.keys(state.permissions);
  const keys = Object.keys(state.permissions.founder || {});
  root.innerHTML = roles.map(role => `
    <div class="list">
      <strong>${role}</strong>
      ${keys.map(k => `<label style="margin-left:8px;"><input ${canEdit ? "" : "disabled"} data-role="${role}" data-perm="${k}" type="checkbox" ${state.permissions[role][k] ? "checked" : ""}/> ${k}</label>`).join("")}
    </div>
  `).join("");
  root.querySelectorAll("input[data-role]").forEach(el => el.addEventListener("change", (e) => {
    state.permissions[e.target.dataset.role][e.target.dataset.perm] = e.target.checked;
    saveAll();
    logAudit("permissions_changed", `Permission toggled: ${e.target.dataset.role}.${e.target.dataset.perm}`, { value: e.target.checked });
    renderPermissions();
  }));
}

function renderAudit() {
  const root = document.getElementById("auditList");
  root.innerHTML = state.audit.map(a => `<div class="list"><strong>${a.type}</strong> - ${a.summary}<div class="muted">${a.at} by ${a.actorRole}</div></div>`).join("") || `<div class="muted">No audit entries yet.</div>`;
}

function refreshEverything() {
  fillCustomerSelect();
  renderCustomers();
  renderJobs();
  renderExpenses();
  renderHome();
  renderPermissions();
  renderCharts();
  renderAudit();
}

function drawBars(canvas, labels, values, color = "#22c55e") {
  const c = document.getElementById(canvas);
  if (!c) return;
  const ctx = c.getContext("2d");
  const w = c.width, h = c.height, m = 35;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#334155"; ctx.beginPath(); ctx.moveTo(m, h - m); ctx.lineTo(w - 10, h - m); ctx.stroke();
  const max = Math.max(1, ...values.map(v => Math.abs(v)));
  const bw = Math.max(14, (w - m - 20) / (values.length * 1.6 || 1));
  const gap = bw * 0.6;
  values.forEach((v, i) => {
    const x = m + i * (bw + gap);
    const bh = (Math.abs(v) / max) * (h - m - 20);
    const y = h - m - bh;
    ctx.fillStyle = Array.isArray(color) ? color[i % color.length] : (v >= 0 ? color : "#ef4444");
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = "#cbd5e1"; ctx.font = "11px sans-serif";
    ctx.fillText((labels[i] || "").slice(0, 10), x, h - 14);
  });
}

function renderCharts() {
  const approvedExpenses = state.expenses.filter(e => e.status === "approved");
  const incomeByMonth = {};
  const expByMonth = {};
  state.jobs.forEach(j => {
    const key = monthKey(j.completedDate || j.scheduledDate);
    if (!key) return;
    incomeByMonth[key] = (incomeByMonth[key] || 0) + (j.payment || 0) + (j.tipAmount || 0);
  });
  approvedExpenses.forEach(e => {
    const key = monthKey(e.date);
    if (!key) return;
    expByMonth[key] = (expByMonth[key] || 0) + (e.amount || 0);
  });
  const months = [...new Set([...Object.keys(incomeByMonth), ...Object.keys(expByMonth)])].sort();
  const profit = months.map(m => (incomeByMonth[m] || 0) - (expByMonth[m] || 0));
  drawBars("profitChart", months, profit, "#22c55e");

  const mode = document.getElementById("areaMode").value;
  const bucket = {};
  state.jobs.forEach(j => {
    const k = mode === "zip" ? (j.zipCode || "unknown") : (j.neighborhood || "unknown");
    if (!bucket[k]) bucket[k] = { rev: 0, count: 0 };
    bucket[k].rev += (j.payment || 0) + (j.tipAmount || 0);
    bucket[k].count += 1;
  });
  const areas = Object.keys(bucket);
  const avgs = areas.map(a => bucket[a].count ? bucket[a].rev / bucket[a].count : 0);
  drawBars("avgAreaChart", areas, avgs, "#38bdf8");

  const sizeByMonth = {};
  state.jobs.forEach(j => {
    const mk = monthKey(j.scheduledDate);
    if (!mk) return;
    if (!sizeByMonth[mk]) sizeByMonth[mk] = { small: 0, medium: 0, large: 0 };
    sizeByMonth[mk][j.size] = (sizeByMonth[mk][j.size] || 0) + 1;
  });
  const ms = Object.keys(sizeByMonth).sort();
  const dominantLabels = ms;
  const dominantValues = ms.map(m => {
    const obj = sizeByMonth[m];
    return Math.max(obj.small || 0, obj.medium || 0, obj.large || 0);
  });
  drawBars("sizeTrendChart", dominantLabels, dominantValues, ["#22c55e", "#3b82f6", "#f59e0b"]);
}

document.getElementById("areaMode").addEventListener("change", renderCharts);

document.getElementById("exportBackupBtn").addEventListener("click", () => {
  exportFullBackup();
});

document.getElementById("importBackupBtn").addEventListener("click", () => {
  document.getElementById("importFileInput").click();
});

document.getElementById("importFileInput").addEventListener("change", e => {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const mode = document.getElementById("importModeSelect").value;
      applyImportedData(data, mode === "replace" ? "replace" : "merge");
      alert(`Import (${mode}) complete. Jobs: ${state.jobs.length}, expenses: ${state.expenses.length}.`);
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      input.value = "";
    }
  };
  reader.onerror = () => {
    alert("Could not read file.");
    input.value = "";
  };
  reader.readAsText(file);
});

document.getElementById("pullLegacyLsBtn").addEventListener("click", () => {
  pullLegacyLocalStorage();
});

function init() {
  document.getElementById("expenseDate").value = today();
  document.getElementById("jobScheduledDate").value = today();
  document.getElementById("currentRole").value = state.role;
  refreshEverything();
}

init();
