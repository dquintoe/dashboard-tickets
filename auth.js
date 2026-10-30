// Sesión de Google, roles y utilidades compartidas por el dashboard y la administración.
"use strict";

const CFG = Object.assign({
  sheetName: "US", listsSheet: "Listas", accessSheet: "Accesos",
  superAdmins: [], initialAccess: [], gcpProject: "",
  dueSoonDays: 3, autoRefreshMinutes: 5,
}, window.DASHBOARD_CONFIG || {});

const ROLES = { ADMIN: "Administrador", VIEW: "Visualizador" };
const SCOPES = {
  READ: "https://www.googleapis.com/auth/drive.readonly", // ver el dashboard
  WRITE: "https://www.googleapis.com/auth/drive",         // editar registros y compartir el archivo
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const normEmail = e => String(e || "").trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

function normRole(r) {
  const s = String(r || "").trim().toLowerCase();
  if (s.startsWith("admin")) return ROLES.ADMIN;
  if (s.startsWith("visual") || s.startsWith("view") || s.startsWith("lector")) return ROLES.VIEW;
  return null;
}
const isSuperAdmin = email => CFG.superAdmins.map(normEmail).includes(normEmail(email));

// Rol de un correo: superAdmins (config.js) > hoja Accesos. null = sin acceso.
function resolveRole(email, accessList) {
  if (isSuperAdmin(email)) return ROLES.ADMIN;
  const row = (accessList || []).find(a => normEmail(a.email) === normEmail(email));
  return row ? normRole(row.rol) : null;
}

function driveFileId() {
  const s = String(CFG.driveFile || "").trim();
  const m = s.match(/\/d\/([\w-]{20,})/) || s.match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : s;
}

function configProblem() {
  if (!CFG.clientId || CFG.clientId.startsWith("PEGAR")) return "Falta configurar clientId en config.js.";
  if (!CFG.driveFile || CFG.driveFile.startsWith("PEGAR")) return "Falta configurar driveFile en config.js.";
  return null;
}

class AuthError extends Error {}

// Traduce un error de las APIs de Google a un mensaje claro.
async function apiErrorMessage(r, what) {
  let msg = "", reason = "";
  try { const j = await r.json(); msg = j.error?.message || ""; reason = j.error?.errors?.[0]?.reason || j.error?.status || ""; } catch { /* sin cuerpo */ }
  if (r.status === 404) return `No se encontró el archivo en Drive o tu cuenta no tiene acceso (${what}).`;
  if (r.status === 403) {
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg + reason))
      return `La API de Google necesaria no está habilitada en el proyecto (${what}). ${msg}`;
    if (/insufficient/i.test(msg + reason)) return `Falta el permiso de edición de Google Drive (${what}). Cierra sesión y vuelve a entrar aceptando todos los permisos.`;
    return `Google denegó la operación (${what}): ${msg || "permiso insuficiente en el archivo"}.`;
  }
  if (r.status === 400 && /not supported for this document/i.test(msg))
    return "El archivo debe ser una Hoja de cálculo de Google (no un .xlsx subido) para poder editarlo.";
  return `Google respondió ${r.status} (${what}). ${msg}`;
}

const Auth = (() => {
  const KEY = "tickets.session";
  let client = null, pending = null, s = null;

  try { s = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { s = null; }
  if (s && !(s.exp > Date.now() + 60000)) s = null;

  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ } };
  const clear = () => { s = null; try { sessionStorage.removeItem(KEY); } catch { /* nada */ } };

  function init() {
    if (client) return true;
    if (!window.google?.accounts?.oauth2) return false;
    client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPES.READ,
      include_granted_scopes: true,
      callback: resp => {
        const p = pending; pending = null;
        if (!p) return;
        if (resp.error) p.reject(new AuthError(`Google rechazó el acceso (${resp.error}).`));
        else p.resolve(resp);
      },
      error_callback: e => {
        const p = pending; pending = null;
        if (!p) return;
        p.reject(new AuthError(
          e?.type === "popup_closed" ? "Se cerró la ventana de Google antes de terminar." :
          e?.type === "popup_failed_to_open" ? "El navegador bloqueó la ventana de Google; permite ventanas emergentes para este sitio." :
          "No se pudo iniciar sesión con Google."));
      },
    });
    return true;
  }
  // La librería de Google carga en asíncrono: se inicializa en cuanto esté lista.
  const poll = setInterval(() => { if (init()) clearInterval(poll); }, 150);
  setTimeout(() => clearInterval(poll), 20000);

  // Debe llamarse directamente desde un clic (si no, el navegador bloquea la ventana de Google).
  function request(scopes, prompt = "") {
    if (!init()) return Promise.reject(new AuthError("No cargó el servicio de Google. Revisa tu conexión y recarga la página."));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      client.requestAccessToken({ scope: scopes.join(" "), include_granted_scopes: true, prompt });
    }).then(resp => {
      if (!scopes.every(sc => google.accounts.oauth2.hasGrantedAllScopes(resp, sc)))
        throw new AuthError(scopes.includes(SCOPES.WRITE)
          ? "Para administrar debes aceptar el permiso para ver, editar y compartir archivos de Google Drive."
          : "Debes aceptar el permiso de lectura de Google Drive para ver el dashboard.");
      s = { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000, scope: resp.scope || scopes.join(" ") };
      save();
      return s;
    });
  }

  const has = scope => !!s && String(s.scope).split(/\s+/).includes(scope);

  async function api(url, opts = {}) {
    if (!s || Date.now() > s.exp - 30000) { clear(); throw new AuthError("La sesión de Google expiró (dura 1 hora). Vuelve a iniciar sesión."); }
    const headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${s.token}` });
    if (opts.body && typeof opts.body === "string") headers["Content-Type"] = "application/json";
    const r = await fetch(url, Object.assign({}, opts, { headers }));
    if (r.status === 401) { clear(); throw new AuthError("La sesión de Google expiró. Vuelve a iniciar sesión."); }
    return r;
  }
  async function json(url, opts, what = "operación") {
    const r = await api(url, opts);
    if (!r.ok) throw new Error(await apiErrorMessage(r, what));
    return r.status === 204 ? null : r.json();
  }

  async function whoami() {
    const j = await json("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)", {}, "identificar la cuenta");
    const u = j.user || {};
    return { email: normEmail(u.emailAddress), name: u.displayName || "", picture: u.photoLink || "" };
  }

  function revoke() {
    if (s && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(s.token, () => {});
    clear();
  }

  return { request, has, api, json, whoami, revoke, clear, get active() { return !!s; } };
})();

// Cabecera común: usuario, rol y enlaces.
function paintUser(user, role) {
  $("userEmail").textContent = user.email;
  const pic = $("userPic");
  if (pic && user.picture) { pic.src = user.picture; pic.hidden = false; }
  const badge = $("roleBadge");
  if (badge) { badge.textContent = role; badge.className = "role " + (role === ROLES.ADMIN ? "admin" : "view"); }
}
