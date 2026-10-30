// Dashboard de Seguimiento de Tickets — versión estática para GitHub Pages.
// Login con Google Identity Services y lectura del Excel vía Drive API, todo en el navegador.
"use strict";
const CFG = Object.assign({ sheetName: "US", dueSoonDays: 3, autoRefreshMinutes: 5, allowedEmails: [] }, window.DASHBOARD_CONFIG || {});
const ALLOWED = CFG.allowedEmails.map(e => e.trim().toLowerCase()).filter(Boolean);
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TOKEN_KEY = "tickets.token";

const SEM_ORDER = ["Vencido", "Por vencer", "Sin fecha", "En plazo", "Cerrado"];
const SEM_VAR = { "Vencido":"--crit", "Por vencer":"--warn", "En plazo":"--good", "Sin fecha":"--none", "Cerrado":"--closed" };
const SEM_ICON = { "Vencido":"⛔", "Por vencer":"⚠️", "En plazo":"✅", "Sin fecha":"◌", "Cerrado":"✔" };
const PRI_ORDER = ["Crítica", "Alta", "Media", "Baja", "Sin prioridad"];
let DATA = null, charts = {}, sortKey = null, sortDir = 1;

const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtDate = iso => iso ? iso.split("-").reverse().join("-") : "";
const countBy = (arr, f) => arr.reduce((m, t) => (m[f(t)] = (m[f(t)] || 0) + 1, m), {});

function fillSelects() {
  const opts = (id, key, order) => {
    const sel = $(id), cur = sel.value;
    let vals = [...new Set(DATA.tickets.map(t => t[key]))];
    vals.sort((a, b) => order ? (order.indexOf(a) - order.indexOf(b)) : a.localeCompare(b));
    sel.length = 1;
    vals.forEach(v => sel.add(new Option(v, v)));
    sel.value = vals.includes(cur) ? cur : "";
  };
  opts("fTipo", "tipo"); opts("fStatus", "status"); opts("fPrioridad", "prioridad", PRI_ORDER);
  opts("fModulo", "modulo"); opts("fSemaforo", "semaforo", SEM_ORDER);
}

function filtered() {
  const q = $("fText").value.trim().toLowerCase();
  const f = { tipo:$("fTipo").value, status:$("fStatus").value, prioridad:$("fPrioridad").value, modulo:$("fModulo").value, semaforo:$("fSemaforo").value };
  return DATA.tickets.filter(t =>
    Object.entries(f).every(([k, v]) => !v || t[k] === v) &&
    (!q || [t.us, t.desc, t.proxima, t.obs, t.tipo, t.modulo, t.item].join(" ").toLowerCase().includes(q)));
}

function render() {
  if (!DATA) return;
  const rows = filtered(), open = rows.filter(t => t.abierto);
  const sem = countBy(open, t => t.semaforo);
  const kpis = [
    { lbl:"Total", val:rows.length, sub:"tickets en la vista", act:() => setF({ fOpen:false }) },
    { lbl:"Abiertos", val:open.length, sub:"no Done / Cancelled", act:() => setF({ fOpen:true }) },
    { lbl:"Vencidos", val:sem["Vencido"] || 0, sub:"compromiso ya pasó", c:"--crit", act:() => setF({ fSemaforo:"Vencido" }) },
    { lbl:"Por vencer", val:sem["Por vencer"] || 0, sub:`≤ ${CFG.dueSoonDays} días`, c:"--warn", act:() => setF({ fSemaforo:"Por vencer" }) },
    { lbl:"En plazo", val:sem["En plazo"] || 0, sub:"con fecha y a tiempo", c:"--good", act:() => setF({ fSemaforo:"En plazo" }) },
    { lbl:"Sin fecha", val:sem["Sin fecha"] || 0, sub:"abiertos sin compromiso", c:"--none", act:() => setF({ fSemaforo:"Sin fecha" }) },
  ];
  $("kpis").innerHTML = kpis.map((k, i) => `<div class="kpi" data-i="${i}"><div class="lbl">${k.c ? `<span class="dot" style="background:var(${k.c})"></span>` : ""}${k.lbl}</div><div class="val">${k.val}</div><div class="sub">${k.sub}</div></div>`).join("");
  $("kpis").querySelectorAll(".kpi").forEach(el => el.onclick = () => kpis[+el.dataset.i].act());

  drawCharts(rows, open);
  drawTable(rows);
  drawIssues();
}

function setF(o) {
  if ("fOpen" in o) $("fOpen").checked = o.fOpen;
  ["fTipo","fStatus","fPrioridad","fModulo","fSemaforo"].forEach(id => { if (id in o) $(id).value = o[id]; });
  if (o.fSemaforo) $("fOpen").checked = o.fSemaforo !== "Cerrado";
  render();
}

function baseOpts(onPick) {
  const ink2 = css("--ink2"), grid = css("--grid");
  return {
    indexAxis: "y", responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: css("--ink2"), borderColor: css("--axis"), borderWidth: 1, padding: 10 },
    },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0, color: css("--muted") }, grid: { color: grid }, border: { color: css("--axis") } },
      y: { ticks: { color: ink2, autoSkip: false }, grid: { display: false }, border: { color: css("--axis") } },
    },
    onClick: (e, els, chart) => { if (els.length && onPick) onPick(chart.data.labels[els[0].index], chart.data.datasets[els[0].datasetIndex]); },
    onHover: (e, els) => { e.native.target.style.cursor = els.length && onPick ? "pointer" : "default"; },
  };
}
const barDs = (label, data, color) => ({ label, data, backgroundColor: color, borderRadius: 4, borderSkipped: "start", borderWidth: 0, maxBarThickness: 22, categoryPercentage: .8, barPercentage: .9 });

function upsert(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), cfg);
}

function drawCharts(rows, open) {
  // Semáforo
  const sem = countBy(open, t => t.semaforo);
  const semLabels = SEM_ORDER.filter(s => s !== "Cerrado");
  upsert("cSem", { type: "bar",
    data: { labels: semLabels, datasets: [barDs("Abiertos", semLabels.map(s => sem[s] || 0), semLabels.map(s => css(SEM_VAR[s])))] },
    options: baseOpts(l => setF({ fSemaforo: l })) });

  // Tipo: abiertos vs cerrados (apilado)
  const tipos = Object.entries(countBy(rows, t => t.tipo)).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const o = countBy(open, t => t.tipo), c = countBy(rows.filter(t => !t.abierto), t => t.tipo);
  const optTipo = baseOpts((l, ds) => setF({ fTipo: l, fOpen: ds.label === "Abiertos" }));
  optTipo.scales.x.stacked = optTipo.scales.y.stacked = true;
  optTipo.plugins.legend = { display: true, position: "top", align: "end", labels: { color: css("--ink2"), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } };
  const dsO = barDs("Abiertos", tipos.map(t => o[t] || 0), css("--s1")), dsC = barDs("Cerrados", tipos.map(t => c[t] || 0), css("--closed"));
  dsO.borderSkipped = dsC.borderSkipped = false;
  dsO.borderWidth = dsC.borderWidth = { right: 2 }; dsO.borderColor = dsC.borderColor = css("--surface");
  dsO.borderRadius = 0; dsC.borderRadius = { topRight: 4, bottomRight: 4 };
  upsert("cTipo", { type: "bar", data: { labels: tipos, datasets: [dsO, dsC] }, options: optTipo });

  // Módulo
  const mod = Object.entries(countBy(open, t => t.modulo)).sort((a, b) => b[1] - a[1]);
  upsert("cMod", { type: "bar",
    data: { labels: mod.map(x => x[0]), datasets: [barDs("Abiertos", mod.map(x => x[1]), css("--s1"))] },
    options: baseOpts(l => setF({ fModulo: l, fOpen: true })) });

  // Prioridad
  const pri = countBy(open, t => t.prioridad);
  const priL = PRI_ORDER.filter(p => pri[p]).concat(Object.keys(pri).filter(p => !PRI_ORDER.includes(p)));
  upsert("cPri", { type: "bar",
    data: { labels: priL, datasets: [barDs("Abiertos", priL.map(p => pri[p]), css("--s1"))] },
    options: baseOpts(l => setF({ fPrioridad: l, fOpen: true })) });
}

function defaultSort(a, b) {
  const s = SEM_ORDER.indexOf(a.semaforo) - SEM_ORDER.indexOf(b.semaforo);
  if (s) return s;
  const da = a.f_compromiso || "9999", db = b.f_compromiso || "9999";
  if (da !== db) return da < db ? -1 : 1;
  return PRI_ORDER.indexOf(a.prioridad) - PRI_ORDER.indexOf(b.prioridad);
}

function drawTable(rows) {
  let list = $("fOpen").checked ? rows.filter(t => t.abierto) : rows.slice();
  if (sortKey) {
    list.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (sortKey === "semaforo") { x = SEM_ORDER.indexOf(x); y = SEM_ORDER.indexOf(y); }
      if (sortKey === "prioridad") { x = PRI_ORDER.indexOf(x); y = PRI_ORDER.indexOf(y); }
      if (x == null || x === "") return 1; if (y == null || y === "") return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true })) * sortDir;
    });
  } else list.sort(defaultSort);
  $("tblTitle").textContent = `Tickets (${list.length})`;
  document.querySelectorAll("th").forEach(th => { th.classList.toggle("sorted", th.dataset.k === sortKey); th.dataset.dir = sortDir > 0 ? "▲" : "▼"; });
  if (!list.length) { $("tbody").innerHTML = `<tr><td colspan="12" class="empty">Sin tickets con estos filtros.</td></tr>`; return; }
  $("tbody").innerHTML = list.map(t => {
    const due = t.dias_para_vencer;
    const dueTxt = due == null ? "" : due < 0 ? ` <span style="color:var(--crit-ink)">(${-due} d tarde)</span>` : due <= 7 ? ` <span style="color:var(--muted)">(en ${due} d)</span>` : "";
    const note = [t.proxima, t.obs].filter(Boolean).map(esc).join("<br><span style='color:var(--muted)'>") + (t.proxima && t.obs ? "</span>" : "");
    return `<tr>
      <td class="nowrap">${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">${esc(t.us || "—")}</a>` : esc(t.us || "—")}</td>
      <td class="desc">${esc(t.desc)}</td>
      <td><span class="tag">${esc(t.tipo)}</span></td>
      <td class="nowrap">${esc(t.status)}</td>
      <td class="nowrap">${esc(t.prioridad)}</td>
      <td class="nowrap">${esc(t.modulo)}</td>
      <td><span class="pill ${t.semaforo.split(" ")[0]}">${SEM_ICON[t.semaforo]} ${t.semaforo}</span></td>
      <td class="nowrap">${fmtDate(t.f_compromiso)}${dueTxt}</td>
      <td class="num">${t.dias_abiertos ?? ""}</td>
      <td class="num">${t.avance == null ? "" : Math.round(t.avance * 100) + "%"}</td>
      <td class="nowrap">${esc(t.ambiente)}</td>
      <td class="note">${note}</td>
    </tr>`;
  }).join("");
}

function drawIssues() {
  const iss = DATA.issues;
  $("dqTitle").textContent = `Calidad de datos (${iss.length} observaciones)`;
  const byType = {};
  iss.forEach(i => (byType[i.tipo] ||= []).push(i.detalle));
  $("issues").innerHTML = iss.length ? Object.entries(byType).map(([k, v]) =>
    `<li><b>${esc(k)} (${v.length})</b><br>${v.slice(0, 12).map(esc).join("<br>")}${v.length > 12 ? `<br>… y ${v.length - 12} más` : ""}</li>`).join("")
    : `<li>Sin observaciones.</li>`;
}

$("btnClear").onclick = () => { $("fText").value = ""; setF({ fTipo:"", fStatus:"", fPrioridad:"", fModulo:"", fSemaforo:"", fOpen:true }); sortKey = null; render(); };


// ------------------------------------------------------------------ sesión
let tokenClient = null, accessToken = null, tokenExp = 0, USER = null, refreshTimer = null;

const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null"); } catch { return null; } },
  set(v) { try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento: solo dura la pestaña */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* nada */ } },
};

function showLogin(msg) {
  $("appView").hidden = true; $("loginView").hidden = false;
  $("loginErr").hidden = !msg; $("loginErr").textContent = msg || "";
  clearInterval(refreshTimer);
}
function showApp() { $("loginView").hidden = true; $("appView").hidden = false; }

function configProblem() {
  if (!CFG.clientId || CFG.clientId.startsWith("PEGAR")) return "Falta configurar clientId en config.js.";
  if (!CFG.driveFile || CFG.driveFile.startsWith("PEGAR")) return "Falta configurar driveFile en config.js.";
  return null;
}

function initGoogle() {
  if (tokenClient) return true;
  if (!window.google?.accounts?.oauth2) return false;
  const hint = ALLOWED.length === 1 ? ALLOWED[0] : undefined;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CFG.clientId,
    scope: SCOPE,
    hint,
    hosted_domain: hint ? hint.split("@")[1] : undefined,
    callback: onToken,
    error_callback: e => showLogin(e?.type === "popup_closed" ? "Se cerró la ventana de Google antes de terminar." :
                                   e?.type === "popup_failed_to_open" ? "El navegador bloqueó la ventana de Google; permite ventanas emergentes para este sitio." :
                                   "No se pudo iniciar sesión con Google."),
  });
  return true;
}

function login() {
  const p = configProblem();
  if (p) return showLogin(p);
  if (!initGoogle()) return showLogin("No cargó el servicio de Google. Revisa tu conexión y recarga la página.");
  tokenClient.requestAccessToken({ prompt: "" });
}

async function onToken(resp) {
  if (resp.error) return showLogin(`Google rechazó el acceso (${resp.error}).`);
  if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) return showLogin("Debes aceptar el permiso de lectura de Google Drive para ver el dashboard.");
  accessToken = resp.access_token;
  tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
  await startSession();
}

async function startSession() {
  // Verifica quién inició sesión (Drive devuelve el correo con el mismo permiso de solo lectura)
  const r = await gfetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)");
  if (!r) return;
  if (!r.ok) { const msg = await driveError(r, "identificar la cuenta"); revoke(); return showLogin(msg); }
  const u = (await r.json()).user || {};
  const email = (u.emailAddress || "").toLowerCase();
  if (ALLOWED.length && !ALLOWED.includes(email)) {
    revoke();
    return showLogin(`La cuenta ${email || "(desconocida)"} no tiene acceso a este dashboard.`);
  }
  USER = { email, name: u.displayName, picture: u.photoLink };
  store.set({ token: accessToken, exp: tokenExp });
  $("userEmail").textContent = email;
  if (USER.picture) { $("userPic").src = USER.picture; $("userPic").hidden = false; }
  showApp();
  await load(true);
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => load(false), CFG.autoRefreshMinutes * 60000);
}

function revoke() {
  if (accessToken && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null; tokenExp = 0; USER = null; store.clear();
}

// fetch con el token; si expiró, vuelve a la pantalla de acceso
async function gfetch(url) {
  if (!accessToken || Date.now() > tokenExp - 30000) {
    store.clear();
    showLogin("La sesión de Google expiró (dura 1 hora). Vuelve a iniciar sesión.");
    return null;
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (r.status === 401) { store.clear(); showLogin("La sesión de Google expiró. Vuelve a iniciar sesión."); return null; }
  return r;
}

// ------------------------------------------------------------------ datos
function driveFileId() {
  const s = CFG.driveFile.trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : s;
}

async function driveError(r, what) {
  let msg = "";
  try { msg = (await r.json()).error?.message || ""; } catch { /* sin cuerpo */ }
  if (r.status === 404) return `No se encontró el archivo en Drive o tu cuenta no tiene acceso a él (revisa driveFile en config.js).`;
  if (r.status === 403) return `Drive denegó el acceso al ${what}: ${msg || "permiso insuficiente"}. ¿Está habilitada la Google Drive API en el proyecto?`;
  return `Drive respondió ${r.status} al ${what}. ${msg}`;
}

async function load(force) {
  if (!force && document.hidden) return;
  $("meta").textContent = "Cargando…";
  $("banner").style.display = "none";
  try {
    const id = driveFileId(), base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`;
    const mr = await gfetch(`${base}?fields=name,mimeType,modifiedTime&supportsAllDrives=true`);
    if (!mr) return;
    if (!mr.ok) throw new Error(await driveError(mr, "leer el archivo"));
    const meta = await mr.json();
    const url = meta.mimeType === "application/vnd.google-apps.spreadsheet"
      ? `${base}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
      : `${base}?alt=media&supportsAllDrives=true`;
    const fr = await gfetch(url);
    if (!fr) return;
    if (!fr.ok) throw new Error(await driveError(fr, "descargar el archivo"));
    const parsed = TicketData.parseWorkbook(await fr.arrayBuffer(), CFG);
    DATA = { ...parsed, meta };
    const mod = meta.modifiedTime ? new Date(meta.modifiedTime).toLocaleString("es-PE") : "—";
    $("meta").textContent = `${meta.name} · modificado ${mod} · leído ${new Date().toLocaleTimeString("es-PE")}`;
    fillSelects(); render();
  } catch (err) {
    $("banner").style.display = "block";
    $("banner").textContent = err.message || String(err);
    $("meta").textContent = "";
  }
}

// ------------------------------------------------------------------ arranque
$("btnLogin").onclick = login;
$("btnLogout").onclick = e => { e.preventDefault(); revoke(); showLogin(); };
$("btnRefresh").onclick = () => load(true);
$("btnClear").onclick = () => { $("fText").value = ""; sortKey = null; setF({ fTipo:"", fStatus:"", fPrioridad:"", fModulo:"", fSemaforo:"", fOpen:true }); };
document.querySelectorAll("th").forEach(th => th.onclick = () => {
  if (sortKey === th.dataset.k) sortDir = -sortDir; else { sortKey = th.dataset.k; sortDir = 1; }
  render();
});
["fText","fTipo","fStatus","fPrioridad","fModulo","fSemaforo","fOpen"].forEach(id => $(id).addEventListener("input", render));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden && USER) load(false); });

(function boot() {
  const p = configProblem();
  if (p) return showLogin(p);
  const saved = store.get();   // reanuda la sesión al recargar la pestaña (mientras el token siga vigente)
  if (saved && saved.exp > Date.now() + 60000) {
    accessToken = saved.token; tokenExp = saved.exp;
    startSession();
  } else showLogin();
  // la librería de Google carga en asíncrono; se inicializa en cuanto esté lista
  const t = setInterval(() => { if (initGoogle()) clearInterval(t); }, 200);
  setTimeout(() => clearInterval(t), 15000);
})();
