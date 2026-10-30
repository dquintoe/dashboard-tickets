// Administración: mantenimiento de registros (Google Sheets API) y roles/accesos (hoja Accesos + permisos de Drive).
// Requiere auth.js.
"use strict";

const SID = driveFileId();
const SHEETS = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SID)}`;
const DRIVE = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(SID)}`;
const CALC_NAMES = ["días abiertos", "dias abiertos", "semáforo", "semaforo"];   // calculados aunque no tengan fórmula
const ACC_HEADER = ["Email", "Rol", "Nombre", "Actualizado por", "Actualizado el"];
const DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);

let USER = null, ROLE = null, META = null, REC = null, ACC = null, PERMS = [], busy = false;

// ------------------------------------------------------------------ utilidades
const colLetter = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const q = name => `'${String(name).replace(/'/g, "''")}'`;
const enc = encodeURIComponent;
const pad = n => String(n).padStart(2, "0");
const serialToISO = n => { const d = new Date(EPOCH + Math.round(Number(n) * DAY)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const isoToSerial = s => { const [y, m, d] = s.split("-").map(Number); return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY); };
const fmtSerial = n => (n === "" || n == null || isNaN(Number(n))) ? String(n ?? "") : serialToISO(n).split("-").reverse().join("-");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowText = () => { const d = new Date(); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const blank = v => v === "" || v === null || v === undefined;
const same = (a, b) => String(blank(a) ? "" : a) === String(blank(b) ? "" : b);

function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}
function showError(msg) { const b = $("banner"); b.textContent = msg; b.style.display = msg ? "block" : "none"; }

async function guard(btn, label, fn) {
  if (busy) return;
  busy = true;
  const old = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); }
  catch (err) {
    if (err instanceof AuthError) { showLogin(err.message); return; }
    throw err;
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

// ------------------------------------------------------------------ Sheets / Drive
const getJSON = (url, what) => Auth.json(url, {}, what);
const postJSON = (url, body, what, method = "POST") => Auth.json(url, { method, body: JSON.stringify(body) }, what);

async function batchGet(ranges, render = "UNFORMATTED_VALUE") {
  const qs = ranges.map(r => `ranges=${enc(r)}`).join("&");
  const j = await getJSON(`${SHEETS}/values:batchGet?${qs}&valueRenderOption=${render}&dateTimeRenderOption=SERIAL_NUMBER`, "leer la hoja");
  return (j.valueRanges || []).map(v => v.values || []);
}
const getRange = async (range, render) => (await batchGet([range], render))[0];
const sheetsUpdate = (requests, what = "actualizar la hoja") => postJSON(`${SHEETS}:batchUpdate`, { requests }, what);
const valuesUpdate = (data, what = "guardar") => postJSON(`${SHEETS}/values:batchUpdate`, { valueInputOption: "RAW", data }, what);

async function loadMeta() {
  const j = await getJSON(`${SHEETS}?fields=properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`, "abrir la hoja de cálculo");
  META = { title: j.properties?.title || "", sheets: {} };
  (j.sheets || []).forEach(s => {
    const p = s.properties;
    META.sheets[p.title] = { id: p.sheetId, rows: p.gridProperties?.rowCount || 1000, cols: p.gridProperties?.columnCount || 26 };
  });
}

async function listPerms() {
  const out = [];
  let token = "";
  do {
    const j = await getJSON(`${DRIVE}/permissions?supportsAllDrives=true&pageSize=100&fields=nextPageToken,permissions(id,type,role,emailAddress,displayName,domain)${token ? "&pageToken=" + enc(token) : ""}`, "leer quién tiene acceso al archivo");
    out.push(...(j.permissions || []));
    token = j.nextPageToken || "";
  } while (token);
  return out;
}
const RANK = { reader: 1, commenter: 1, writer: 2, fileOrganizer: 3, organizer: 3, owner: 4 };
const PERM_LABEL = { reader: "Lector", commenter: "Comentador", writer: "Editor", fileOrganizer: "Organizador", organizer: "Administrador de unidad", owner: "Propietario" };
const wantPerm = rol => rol === ROLES.ADMIN ? "writer" : "reader";
const permOf = email => PERMS.find(p => p.type === "user" && normEmail(p.emailAddress) === normEmail(email));

// Ajusta el permiso del archivo al rol: Administrador = Editor, Visualizador = Lector. Nunca toca al propietario.
async function grantDrive(email, rol, notify) {
  const want = wantPerm(rol), p = permOf(email);
  if (p) {
    if (RANK[p.role] >= 3) return `${email}: ${PERM_LABEL[p.role]} (sin cambios)`;
    if (p.role === want) return `${email}: ya es ${PERM_LABEL[want]}`;
    await postJSON(`${DRIVE}/permissions/${enc(p.id)}?supportsAllDrives=true`, { role: want }, `cambiar el permiso de ${email}`, "PATCH");
    return `${email}: ahora es ${PERM_LABEL[want]}`;
  }
  await postJSON(`${DRIVE}/permissions?supportsAllDrives=true&sendNotificationEmail=${notify ? "true" : "false"}`,
    { type: "user", role: want, emailAddress: email }, `compartir el archivo con ${email}`);
  return `${email}: compartido como ${PERM_LABEL[want]}`;
}
async function revokeDrive(email) {
  const p = permOf(email);
  if (!p) return `${email}: no tenía acceso directo al archivo`;
  if (RANK[p.role] >= 3) return `${email}: es ${PERM_LABEL[p.role]}, no se quitó`;
  await Auth.json(`${DRIVE}/permissions/${enc(p.id)}?supportsAllDrives=true`, { method: "DELETE" }, `quitar el acceso de ${email}`);
  return `${email}: se quitó el acceso al archivo`;
}

// ------------------------------------------------------------------ registros: lectura y estructura
function fieldType(name, rule, options, calc) {
  const n = name.toLowerCase();
  if (calc) return "calc";
  if (options) return "list";
  if (/^fecha/.test(n) || /^DATE_/.test(rule?.condition?.type || "")) return "date";
  if (n.includes("%")) return "percent";
  if (n === "item" || n === "us") return "id";
  if (/^horas/.test(n) || /^NUMBER_/.test(rule?.condition?.type || "")) return "number";
  if (/^(description|descripci|obs|pr[oó]xima)/.test(n)) return "long";
  if (n === "link" || n === "url") return "url";
  return "text";
}

async function loadRecords() {
  const name = CFG.sheetName, sh = META.sheets[name];
  if (!sh) throw new Error(`No existe la hoja "${name}" en el archivo.`);
  const lastL = colLetter(Math.max(sh.cols, 1) - 1);
  const full = `${q(name)}!A1:${lastL}${sh.rows}`;
  const [vals, forms] = await Promise.all([getRange(full, "UNFORMATTED_VALUE"), getRange(full, "FORMULA")]);

  const hdrIdx = vals.slice(0, 20).findIndex(r => (r || []).some(c => String(c).trim() === "Status"));
  if (hdrIdx < 0) throw new Error(`No se encontró la fila de encabezados (columna "Status") en la hoja "${name}".`);
  const header = (vals[hdrIdx] || []).map(h => String(h ?? "").trim());
  while (header.length && !header[header.length - 1]) header.pop();
  const n = header.length, L = colLetter(n - 1);

  // Columnas calculadas: tienen fórmula en las filas de datos (o son Días Abiertos / Semáforo)
  const calc = header.map((h, j) => CALC_NAMES.includes(h.toLowerCase()) ||
    forms.slice(hdrIdx + 1).some(r => typeof r?.[j] === "string" && r[j].startsWith("=")));

  // Listas: validaciones de datos del Drive (primeras filas de datos)
  const first = hdrIdx + 2;
  const vj = await getJSON(`${SHEETS}?ranges=${enc(`${q(name)}!A${first}:${L}${first + 4}`)}&fields=sheets(data(rowData(values(dataValidation))))`, "leer las listas de la hoja");
  const rules = new Array(n).fill(null);
  (vj.sheets?.[0]?.data?.[0]?.rowData || []).forEach(rd => (rd.values || []).forEach((c, j) => { if (j < n && !rules[j] && c?.dataValidation) rules[j] = c.dataValidation; }));

  const options = new Array(n).fill(null), rangeRefs = [];
  rules.forEach((r, j) => {
    const c = r?.condition;
    if (c?.type === "ONE_OF_LIST") options[j] = (c.values || []).map(v => String(v.userEnteredValue ?? "")).filter(Boolean);
    if (c?.type === "ONE_OF_RANGE") rangeRefs.push({ j, ref: String(c.values?.[0]?.userEnteredValue || "").replace(/^=/, "").replace(/\$/g, "") });
  });
  if (rangeRefs.length) {
    const lists = await batchGet(rangeRefs.map(x => x.ref), "FORMATTED_VALUE");
    rangeRefs.forEach((x, i) => { options[x.j] = [...new Set(lists[i].flat().map(v => String(v ?? "").trim()).filter(Boolean))]; });
  }
  // Respaldo: hoja Listas con encabezado igual al de la columna (solo si la columna no tiene validación)
  if (META.sheets[CFG.listsSheet] && options.some((o, j) => !o && !calc[j])) {
    const lv = await getRange(`${q(CFG.listsSheet)}!A1:Z`, "FORMATTED_VALUE");
    const lh = (lv[0] || []).map(h => String(h ?? "").trim().toLowerCase());
    header.forEach((h, j) => {
      const k = lh.indexOf(h.toLowerCase());
      if (!options[j] && !calc[j] && k >= 0 && h)
        options[j] = [...new Set(lv.slice(1).map(r => String(r?.[k] ?? "").trim()).filter(Boolean))];
    });
  }

  const cols = header.map((h, j) => ({
    name: h || `Columna ${colLetter(j)}`, j, letter: colLetter(j), calc: calc[j],
    options: options[j], type: fieldType(h, rules[j], options[j], calc[j]),
    required: /^(description|descripci)/i.test(h),
  }));

  const rows = [];
  let lastDataRow = hdrIdx + 1; // número de fila (1-based) del encabezado
  for (let r = hdrIdx + 1; r < vals.length; r++) {
    const v = Array.from({ length: n }, (_, j) => vals[r]?.[j] ?? "");
    if (cols.some(c => !c.calc && !blank(v[c.j]))) { rows.push({ sheetRow: r + 1, values: v }); lastDataRow = r + 1; }
  }
  REC = { sheet: name, sheetId: sh.id, gridRows: sh.rows, hdrRow: hdrIdx + 1, cols, rows, lastDataRow, L, forms };
}

// ------------------------------------------------------------------ registros: tabla
const findCol = (...names) => REC.cols.find(c => names.some(nm => c.name.toLowerCase() === nm.toLowerCase()));
function shownCols() {
  return [findCol("Item"), findCol("US"), findCol("Description", "Descripción"), findCol("Tipo"), findCol("Status"),
    findCol("Prioridad"), findCol("Módulo SAP", "Modulo SAP"), findCol("Responsable"), findCol("Fecha Compromiso")].filter(Boolean);
}
function cellText(c, v) {
  if (blank(v)) return "";
  if (c.type === "date") return fmtSerial(v);
  if (c.type === "percent") return isNaN(Number(v)) ? String(v) : Math.round(Number(v) * 100) + "%";
  return String(v);
}
function renderRecords() {
  const cols = shownCols(), st = findCol("Status");
  const sel = $("rStatus"), cur = sel.value;
  const statuses = st ? [...new Set([...(st.options || []), ...REC.rows.map(r => String(r.values[st.j] ?? "")).filter(Boolean)])] : [];
  sel.length = 1; statuses.forEach(s => sel.add(new Option(s, s))); sel.value = statuses.includes(cur) ? cur : "";

  const text = $("rText").value.trim().toLowerCase();
  const list = REC.rows.filter(r =>
    (!sel.value || String(r.values[st.j]) === sel.value) &&
    (!text || r.values.map(String).join(" ").toLowerCase().includes(text)));

  $("recHead").innerHTML = `<tr>${cols.map(c => `<th>${esc(c.name)}</th>`).join("")}<th class="act"></th></tr>`;
  $("recBody").innerHTML = list.length ? list.slice().reverse().map(r => `<tr data-row="${r.sheetRow}" class="click">
      ${cols.map(c => `<td class="${/description|descripci/i.test(c.name) ? "desc" : "nowrap"}">${esc(cellText(c, r.values[c.j]))}</td>`).join("")}
      <td class="act"><button class="sm" data-edit="${r.sheetRow}">Editar</button><button class="sm danger" data-del="${r.sheetRow}">Eliminar</button></td>
    </tr>`).join("")
    : `<tr><td colspan="${cols.length + 1}" class="empty">Sin registros con estos filtros.</td></tr>`;
  const lists = REC.cols.filter(c => c.type === "list").map(c => c.name);
  $("recInfo").textContent = `${list.length} de ${REC.rows.length} registros · hoja “${REC.sheet}” · más recientes primero · listas desplegables: ${lists.join(", ") || "ninguna"}`;
}
const recByRow = row => REC.rows.find(r => r.sheetRow === Number(row));

// ------------------------------------------------------------------ registros: formulario
let editing = null; // null = nuevo; si no, el registro

function inputFor(c, v) {
  const id = `f_${c.j}`, req = c.required ? " required" : "";
  const lbl = `<span class="flabel">${esc(c.name)}${c.required ? ' <span class="req">*</span>' : ""}</span>`;
  switch (c.type) {
    case "calc":
      return `<label>${lbl}<input id="${id}" value="${esc(cellText(c, v))}" placeholder="${editing ? "" : "Se calcula al guardar"}" disabled><span class="fhint">Calculado por fórmula en el Drive</span></label>`;
    case "list": {
      const opts = c.options.slice();
      const extra = !blank(v) && !opts.includes(String(v)) ? `<option value="${esc(v)}" selected>${esc(v)} (fuera de la lista)</option>` : "";
      return `<label>${lbl}<select id="${id}"${req}><option value=""></option>${extra}${opts.map(o => `<option${String(v) === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    }
    case "date":
      return `<label>${lbl}<input type="date" id="${id}" value="${blank(v) || isNaN(Number(v)) ? "" : serialToISO(v)}"${req}></label>`;
    case "percent":
      return `<label>${lbl}<input type="number" id="${id}" min="0" max="100" step="1" inputmode="numeric" value="${blank(v) || isNaN(Number(v)) ? "" : Math.round(Number(v) * 100)}"${req}><span class="fhint">0 a 100</span></label>`;
    case "number":
      return `<label>${lbl}<input type="number" id="${id}" step="any" value="${esc(v)}"${req}></label>`;
    case "id":
      return `<label>${lbl}<input type="text" id="${id}" inputmode="numeric" value="${esc(v)}"${req}></label>`;
    case "long":
      return `<label class="full">${lbl}<textarea id="${id}" rows="3"${req}>${esc(v)}</textarea></label>`;
    case "url":
      return `<label class="full">${lbl}<input type="text" id="${id}" value="${esc(v)}" placeholder="https://…"${req}></label>`;
    default:
      return `<label>${lbl}<input type="text" id="${id}" value="${esc(v)}"${req}></label>`;
  }
}

function openRecord(rec) {
  editing = rec || null;
  let values;
  if (rec) values = rec.values;
  else {
    values = new Array(REC.cols.length).fill("");
    const item = findCol("Item"), freg = findCol("Fecha Registro");
    if (item) values[item.j] = Math.max(0, ...REC.rows.map(r => Number(r.values[item.j])).filter(Number.isFinite)) + 1;
    if (freg) values[freg.j] = isoToSerial(todayISO());
  }
  $("recTitle").textContent = rec ? `Editar registro${values[findCol("US")?.j] ? " — US " + values[findCol("US").j] : ""}` : "Nuevo registro";
  $("recSub").textContent = rec ? `Fila ${rec.sheetRow} de la hoja “${REC.sheet}”` : `Se agregará en la fila ${REC.lastDataRow + 1} de la hoja “${REC.sheet}”`;
  $("recFields").innerHTML = REC.cols.map(c => inputFor(c, values[c.j])).join("");
  $("btnRecDelete").hidden = !rec;
  $("recErr").hidden = true;
  $("recDialog").showModal();
  const firstInput = $("recFields").querySelector("input:not([disabled]),select,textarea");
  if (firstInput) firstInput.focus();
}

// Lee el formulario y convierte cada campo al tipo que se guarda en la hoja
function readForm() {
  const out = new Array(REC.cols.length).fill(undefined), errs = [];
  for (const c of REC.cols) {
    if (c.calc) continue;
    const raw = String($(`f_${c.j}`).value ?? "").trim();
    let v = raw;
    if (c.required && !raw) errs.push(`${c.name} es obligatorio.`);
    if (raw) {
      if (c.type === "date") v = isoToSerial(raw);
      else if (c.type === "percent") { v = Number(raw); if (!Number.isFinite(v) || v < 0 || v > 100) errs.push(`${c.name} debe estar entre 0 y 100.`); else v = v / 100; }
      else if (c.type === "number") { v = Number(raw); if (!Number.isFinite(v)) errs.push(`${c.name} debe ser un número.`); }
      else if (c.type === "id" && /^\d+(\.\d+)?$/.test(raw)) v = Number(raw);
      else if (c.type === "list" && !c.options.includes(raw) && !(editing && same(editing.values[c.j], raw))) errs.push(`${c.name}: elige un valor de la lista.`);
    }
    out[c.j] = v;
  }
  return { values: out, errs };
}

// Comprueba que la fila no cambió en el Drive desde que se cargó (evita pisar o borrar la fila equivocada)
async function assertRow(sheetRow, expected) {
  const cur = (await getRange(`${q(REC.sheet)}!A${sheetRow}:${REC.L}${sheetRow}`, "UNFORMATTED_VALUE"))[0] || [];
  const changed = REC.cols.some(c => !c.calc && !same(cur[c.j], expected ? expected[c.j] : ""));
  if (changed) {
    await reloadRecords();
    throw new Error(expected
      ? "El registro cambió en el Drive desde que se cargó (otra persona o pestaña lo editó). Se recargó la lista; vuelve a intentarlo."
      : "La fila destino ya no está vacía (alguien agregó un registro). Se recargó la lista; vuelve a intentarlo.");
  }
}

async function writeRow(sheetRow, values) {
  // Escribe solo las columnas editables (en tramos contiguos) para no tocar las fórmulas
  const data = [];
  let seg = null;
  REC.cols.forEach(c => {
    if (c.calc) { seg = null; return; }
    if (!seg) { seg = { start: c.j, vals: [] }; data.push(seg); }
    seg.vals.push(blank(values[c.j]) ? "" : values[c.j]);
  });
  await valuesUpdate(data.map(s => ({
    range: `${q(REC.sheet)}!${colLetter(s.start)}${sheetRow}:${colLetter(s.start + s.vals.length - 1)}${sheetRow}`,
    majorDimension: "ROWS", values: [s.vals],
  })), "guardar el registro");

  // Formato de fechas y porcentaje (dd-mm-aaaa y 0%), como en el Excel
  const fmt = REC.cols.filter(c => c.type === "date" || c.type === "percent").map(c => ({
    repeatCell: {
      range: { sheetId: REC.sheetId, startRowIndex: sheetRow - 1, endRowIndex: sheetRow, startColumnIndex: c.j, endColumnIndex: c.j + 1 },
      cell: { userEnteredFormat: { numberFormat: c.type === "date" ? { type: "DATE", pattern: "dd-mm-yyyy" } : { type: "PERCENT", pattern: "0%" } } },
      fields: "userEnteredFormat.numberFormat",
    },
  }));
  if (fmt.length) await sheetsUpdate(fmt, "dar formato al registro");
}

async function saveRecord() {
  const { values, errs } = readForm();
  if (errs.length) { $("recErr").textContent = errs.join(" "); $("recErr").hidden = false; return; }
  await guard($("btnRecSave"), "Guardando…", async () => {
    try {
      if (editing) {
        await assertRow(editing.sheetRow, editing.values);
        await writeRow(editing.sheetRow, values);
        toast(`Registro de la fila ${editing.sheetRow} actualizado.`);
      } else {
        const target = REC.lastDataRow + 1;
        if (target > REC.gridRows) await sheetsUpdate([{ appendDimension: { sheetId: REC.sheetId, dimension: "ROWS", length: 50 } }], "ampliar la hoja");
        else await assertRow(target, null);
        await writeRow(target, values);
        await fillFormulas(target);
        toast(`Registro agregado en la fila ${target}.`);
      }
      $("recDialog").close();
      await reloadRecords();
    } catch (err) {
      if (err instanceof AuthError) throw err;
      $("recErr").textContent = err.message; $("recErr").hidden = false;
    }
  });
}

// En filas nuevas, copia las fórmulas de las columnas calculadas desde la fila anterior si no existen
async function fillFormulas(target) {
  const calcCols = REC.cols.filter(c => c.calc);
  if (!calcCols.length || target - 1 <= REC.hdrRow) return;
  const row = (await getRange(`${q(REC.sheet)}!A${target}:${REC.L}${target}`, "FORMULA"))[0] || [];
  const tpl = REC.forms[target - 2] || [];
  const reqs = calcCols.filter(c => !String(row[c.j] ?? "").startsWith("=") && String(tpl[c.j] ?? "").startsWith("=")).map(c => ({
    copyPaste: {
      source: { sheetId: REC.sheetId, startRowIndex: target - 2, endRowIndex: target - 1, startColumnIndex: c.j, endColumnIndex: c.j + 1 },
      destination: { sheetId: REC.sheetId, startRowIndex: target - 1, endRowIndex: target, startColumnIndex: c.j, endColumnIndex: c.j + 1 },
      pasteType: "PASTE_FORMULA",
    },
  }));
  if (reqs.length) await sheetsUpdate(reqs, "copiar las fórmulas");
}

function recLabel(rec) {
  const us = findCol("US"), d = findCol("Description", "Descripción");
  return [us && rec.values[us.j] ? `US ${rec.values[us.j]}` : `Fila ${rec.sheetRow}`, d ? rec.values[d.j] : ""].filter(Boolean).join(" — ");
}

async function deleteRecord(rec) {
  const ok = await confirmBox("Eliminar registro", `Se eliminará la fila ${rec.sheetRow} de la hoja “${REC.sheet}”: ${recLabel(rec)}. Esta acción no se puede deshacer desde el dashboard (sí desde el historial de versiones del Drive).`);
  if (!ok) return;
  await guard(null, "", async () => {
    try {
      await assertRow(rec.sheetRow, rec.values);
      await sheetsUpdate([{ deleteDimension: { range: { sheetId: REC.sheetId, dimension: "ROWS", startIndex: rec.sheetRow - 1, endIndex: rec.sheetRow } } }], "eliminar el registro");
      if ($("recDialog").open) $("recDialog").close();
      toast(`Registro eliminado (${recLabel(rec).slice(0, 60)}).`);
      await reloadRecords();
    } catch (err) {
      if (err instanceof AuthError) throw err;
      if ($("recDialog").open) { $("recErr").textContent = err.message; $("recErr").hidden = false; }
      else showError(err.message);
    }
  });
}

async function reloadRecords() {
  await loadMeta();
  await loadRecords();
  renderRecords();
  $("meta").textContent = `${META.title} · leído ${new Date().toLocaleTimeString("es-PE")}`;
}

// ------------------------------------------------------------------ accesos
async function loadAccess() {
  const name = CFG.accessSheet;
  PERMS = await listPerms().catch(err => { if (err instanceof AuthError) throw err; showError(err.message); return []; });
  if (!META.sheets[name]) { ACC = { exists: false, rows: [] }; return; }
  const vals = await getRange(`${q(name)}!A1:E`, "FORMATTED_VALUE");
  const h = (vals[0] || []).map(x => String(x ?? "").trim().toLowerCase());
  const ci = p => h.findIndex(x => x.startsWith(p));
  const e = ci("email") >= 0 ? ci("email") : ci("correo"), r = ci("rol"), n = ci("nombre"), by = ci("actualizado por"), at = ci("actualizado el");
  ACC = {
    exists: true,
    rows: vals.slice(1).map(row => ({
      email: normEmail(row?.[e]), rol: normRole(row?.[r]) || String(row?.[r] ?? ""), nombre: String(row?.[n] ?? ""),
      por: by >= 0 ? String(row?.[by] ?? "") : "", fecha: at >= 0 ? String(row?.[at] ?? "") : "",
    })).filter(a => a.email),
  };
}

function permCell(a) {
  const p = permOf(a.email), want = wantPerm(normRole(a.rol));
  if (!p) return `<span class="perm warn">⚠ Sin acceso al archivo</span> <button class="sm" data-fix="${esc(a.email)}">Compartir</button>`;
  const lbl = PERM_LABEL[p.role] || p.role;
  if (RANK[p.role] >= 3) return `<span class="perm ok">✔ ${esc(lbl)}</span>`;
  if (RANK[p.role] < RANK[want]) return `<span class="perm warn">⚠ ${esc(lbl)} (necesita ${PERM_LABEL[want]})</span> <button class="sm" data-fix="${esc(a.email)}">Corregir</button>`;
  if (RANK[p.role] > RANK[want]) return `<span class="perm warn">⚠ ${esc(lbl)} (más de lo necesario)</span> <button class="sm" data-fix="${esc(a.email)}">Ajustar a ${PERM_LABEL[want]}</button>`;
  return `<span class="perm ok">✔ ${esc(lbl)}</span>`;
}

function renderAccess() {
  $("accSheetName").textContent = CFG.accessSheet;
  $("testUsersLink").href = `https://console.cloud.google.com/auth/audience${CFG.gcpProject ? "?project=" + enc(CFG.gcpProject) : ""}`;
  $("initBox").hidden = ACC.exists;
  $("btnAddUser").disabled = !ACC.exists;
  $("initList").innerHTML = CFG.initialAccess.map(a => `<li>${esc(a.email)} — ${esc(normRole(a.rol) || a.rol)}</li>`).join("");

  const rows = ACC.rows.slice();
  CFG.superAdmins.forEach(sa => { if (!rows.some(a => a.email === normEmail(sa))) rows.unshift({ email: normEmail(sa), rol: ROLES.ADMIN, nombre: "", por: "", fecha: "", virtual: true }); });
  $("accTitle").textContent = `Usuarios (${rows.length})`;
  $("accBody").innerHTML = rows.map(a => {
    const sa = isSuperAdmin(a.email), me = a.email === USER.email, role = normRole(a.rol);
    const locked = sa || me;
    const why = sa ? "Superadministrador definido en config.js" : me ? "No puedes cambiar tu propio acceso" : "";
    return `<tr>
      <td class="nowrap">${esc(a.email)}${me ? ' <span class="tag">tú</span>' : ""}</td>
      <td>${esc(a.nombre)}</td>
      <td class="nowrap"><span class="role ${role === ROLES.ADMIN ? "admin" : "view"}">${esc(role || a.rol || "—")}</span>${sa ? ' <span class="tag" title="Siempre Administrador (config.js)">config.js</span>' : ""}${role ? "" : ' <span class="perm warn">rol no válido</span>'}</td>
      <td class="nowrap">${permCell({ ...a, rol: role || ROLES.VIEW })}</td>
      <td class="nowrap note">${esc([a.fecha, a.por].filter(Boolean).join(" · "))}</td>
      <td class="act">${a.virtual ? "" : `<button class="sm" data-uedit="${esc(a.email)}"${locked ? ` disabled title="${esc(why)}"` : ""}>Editar</button><button class="sm danger" data-udel="${esc(a.email)}"${locked ? ` disabled title="${esc(why)}"` : ""}>Quitar</button>`}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">Sin usuarios.</td></tr>`;

  const listed = new Set(rows.map(a => a.email));
  const others = PERMS.filter(p => !(p.type === "user" && listed.has(normEmail(p.emailAddress))))
    .map(p => p.type === "user" ? `${p.emailAddress} (${PERM_LABEL[p.role] || p.role})` : p.type === "domain" ? `todo el dominio ${p.domain} (${PERM_LABEL[p.role] || p.role})` : p.type === "anyone" ? `cualquiera con el enlace (${PERM_LABEL[p.role] || p.role})` : `${p.emailAddress || p.type} (${PERM_LABEL[p.role] || p.role})`);
  $("otherPerms").textContent = others.length ? `Con acceso al archivo en Drive pero sin rol en el dashboard: ${others.join(", ")}.` : "";
}

async function reloadAccess() {
  await loadMeta();
  await loadAccess();
  renderAccess();
}

// Escribe la lista completa en la hoja Accesos (encabezado en la fila 1)
async function writeAccessRows(rows) {
  const name = CFG.accessSheet;
  await postJSON(`${SHEETS}/values/${enc(`${q(name)}!A2:E`)}:clear`, {}, "actualizar la hoja de accesos");
  if (rows.length) await valuesUpdate([{ range: `${q(name)}!A1:E${rows.length + 1}`, values: [ACC_HEADER, ...rows.map(a => [a.email, a.rol, a.nombre, a.por, a.fecha])] }], "actualizar la hoja de accesos");
}

let editingUser = null;
function openUser(a) {
  editingUser = a || null;
  $("userTitle").textContent = a ? "Editar usuario" : "Agregar usuario";
  $("uEmail").value = a ? a.email : ""; $("uEmail").disabled = !!a;
  $("uName").value = a ? a.nombre : "";
  $("uRole").value = a && normRole(a.rol) === ROLES.ADMIN ? ROLES.ADMIN : ROLES.VIEW;
  $("uShare").checked = true; $("uNotify").checked = false;
  $("userErr").hidden = true;
  $("userDialog").showModal();
  (a ? $("uRole") : $("uEmail")).focus();
}

async function saveUser() {
  const email = normEmail($("uEmail").value), rol = $("uRole").value, nombre = $("uName").value.trim();
  const fail = m => { $("userErr").textContent = m; $("userErr").hidden = false; };
  if (!isEmail(email)) return fail("Ingresa un correo válido.");
  if (email === USER.email) return fail("No puedes cambiar tu propio acceso.");
  if (isSuperAdmin(email)) return fail("Esta cuenta es superadministradora en config.js; su rol no se cambia aquí.");
  await guard($("btnUserSave"), "Guardando…", async () => {
    try {
      await loadMeta(); await loadAccess();                     // trabaja sobre la lista más reciente
      const rows = ACC.rows.slice(), i = rows.findIndex(a => a.email === email);
      if (!editingUser && i >= 0) return fail(`${email} ya tiene el rol ${rows[i].rol}. Usa Editar.`);
      const rec = { email, rol, nombre, por: USER.email, fecha: nowText() };
      if (i >= 0) rows[i] = rec; else rows.push(rec);
      await writeAccessRows(rows);
      let msg = `${email}: rol ${rol} guardado.`;
      if ($("uShare").checked) {
        try { msg += " " + await grantDrive(email, rol, $("uNotify").checked) + "."; }
        catch (err) { if (err instanceof AuthError) throw err; msg += ` No se pudo compartir el archivo: ${err.message}`; }
      }
      $("userDialog").close();
      await reloadAccess();
      toast(msg);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      fail(err.message);
    }
  });
}

async function removeUser(email) {
  const ok = await confirmBox("Quitar usuario", `${email} ya no podrá ver el dashboard.`, "Quitar también su acceso al archivo en Google Drive", "Quitar");
  if (!ok) return;
  await guard(null, "", async () => {
    try {
      await loadMeta(); await loadAccess();
      await writeAccessRows(ACC.rows.filter(a => a.email !== email));
      let msg = `${email} quitado de la lista.`;
      if (ok.opt) {
        try { msg += " " + await revokeDrive(email) + "."; }
        catch (err) { if (err instanceof AuthError) throw err; msg += ` No se pudo quitar el acceso en Drive: ${err.message}`; }
      }
      await reloadAccess();
      toast(msg);
    } catch (err) { if (err instanceof AuthError) throw err; showError(err.message); }
  });
}

async function fixPerm(email, btn) {
  const a = ACC.rows.find(x => x.email === email) || { email, rol: ROLES.ADMIN };
  await guard(btn, "…", async () => {
    try { const msg = await grantDrive(email, normRole(a.rol) || ROLES.VIEW, false); await reloadAccess(); toast(msg); }
    catch (err) { if (err instanceof AuthError) throw err; showError(err.message); }
  });
}

async function initAccessSheet() {
  await guard($("btnInit"), "Creando…", async () => {
    try {
      await loadMeta();
      const name = CFG.accessSheet;
      let sheetId = META.sheets[name]?.id;
      if (sheetId === undefined) {
        const rep = await sheetsUpdate([{ addSheet: { properties: { title: name, gridProperties: { rowCount: 200, columnCount: 5, frozenRowCount: 1 } } } }], "crear la hoja de accesos");
        sheetId = rep.replies?.[0]?.addSheet?.properties?.sheetId;
      }
      const seed = CFG.initialAccess.map(a => ({ email: normEmail(a.email), rol: normRole(a.rol) || ROLES.VIEW, nombre: a.nombre || "", por: USER.email, fecha: nowText() }))
        .filter((a, i, arr) => isEmail(a.email) && arr.findIndex(b => b.email === a.email) === i);
      if (!seed.some(a => a.email === USER.email)) seed.unshift({ email: USER.email, rol: ROLES.ADMIN, nombre: USER.name, por: USER.email, fecha: nowText() });
      await valuesUpdate([{ range: `${q(name)}!A1:E${seed.length + 1}`, values: [ACC_HEADER, ...seed.map(a => [a.email, a.rol, a.nombre, a.por, a.fecha])] }], "escribir la hoja de accesos");
      await sheetsUpdate([
        { setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 1, endColumnIndex: 2 },
          rule: { condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: ROLES.ADMIN }, { userEnteredValue: ROLES.VIEW }] }, strict: true, showCustomUi: true } } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 5 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.87, green: 0.92, blue: 0.97 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } },
      ], "dar formato a la hoja de accesos");

      PERMS = await listPerms();
      const msgs = [];
      for (const a of seed.filter(a => a.email !== USER.email)) {
        try { msgs.push(await grantDrive(a.email, a.rol, false)); }
        catch (err) { if (err instanceof AuthError) throw err; msgs.push(`${a.email}: no se pudo compartir (${err.message})`); }
      }
      await reloadAccess();
      toast(`Hoja “${name}” creada con ${seed.length} usuarios. ${msgs.join(". ")}`);
    } catch (err) { if (err instanceof AuthError) throw err; showError(err.message); }
  });
}

// ------------------------------------------------------------------ confirmación
function confirmBox(title, text, optText, okText = "Eliminar") {
  return new Promise(resolve => {
    $("cfTitle").textContent = title; $("cfText").textContent = text; $("btnCfOk").textContent = okText;
    $("cfOptWrap").hidden = !optText; $("cfOptText").textContent = optText || ""; $("cfOpt").checked = true;
    const d = $("confirmDialog");
    const done = v => { d.close(); $("confirmForm").onsubmit = null; $("btnCfCancel").onclick = null; d.oncancel = null; resolve(v); };
    $("confirmForm").onsubmit = e => { e.preventDefault(); done({ opt: !!optText && $("cfOpt").checked }); };
    $("btnCfCancel").onclick = () => done(false);
    d.oncancel = () => done(false);
    d.showModal();
  });
}

// ------------------------------------------------------------------ sesión
function showLogin(msg) {
  $("appView").hidden = true; $("loginView").hidden = false;
  $("loginErr").hidden = !msg; $("loginErr").textContent = msg || "";
  deniedState = false;
  if (Auth.active && Auth.has(SCOPES.READ) && !Auth.has(SCOPES.WRITE)) {
    $("loginText").textContent = "Para administrar, Google debe autorizar la edición y el uso compartido del archivo de seguimiento en Drive.";
    $("btnLoginText").textContent = "Autorizar edición con Google";
  } else $("btnLoginText").textContent = "Continuar con Google";
}
let deniedState = false;
function denied(msg) {
  showLogin(msg);
  deniedState = true;
  $("loginText").textContent = "Solo para usuarios con rol Administrador.";
  $("btnLoginText").textContent = "Usar otra cuenta de Google";
}

async function login() {
  const p = configProblem();
  if (p) return showLogin(p);
  const other = deniedState;
  if (other) Auth.revoke();
  try { await Auth.request([SCOPES.READ, SCOPES.WRITE], other ? "select_account" : ""); await start(); }
  catch (err) { showLogin(err.message); }
}

async function start() {
  try {
    showError("");
    USER = await Auth.whoami();
    await loadMeta();
    await loadAccess();
    ROLE = resolveRole(USER.email, ACC.rows);
    if (ROLE !== ROLES.ADMIN) {
      return denied(ROLE ? `La cuenta ${USER.email} tiene rol ${ROLE}. La administración es solo para el rol Administrador.`
                         : `La cuenta ${USER.email} no tiene acceso a este dashboard.`);
    }
    paintUser(USER, ROLE);
    $("loginView").hidden = true; $("appView").hidden = false;
    renderAccess();
    await loadRecords();
    renderRecords();
    $("meta").textContent = `${META.title} · leído ${new Date().toLocaleTimeString("es-PE")}`;
  } catch (err) {
    if (err instanceof AuthError || $("appView").hidden) return showLogin(err.message);
    showError(err.message);
  }
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $("tab-records").hidden = name !== "records";
  $("tab-access").hidden = name !== "access";
  try { sessionStorage.setItem("tickets.adminTab", name); } catch { /* nada */ }
}

// ------------------------------------------------------------------ eventos
$("btnLogin").onclick = login;
$("btnLogout").onclick = e => { e.preventDefault(); Auth.revoke(); showLogin(); };
document.querySelectorAll(".tab").forEach(b => b.onclick = () => selectTab(b.dataset.tab));
$("rText").addEventListener("input", renderRecords);
$("rStatus").addEventListener("input", renderRecords);
$("btnReload").onclick = () => guard($("btnReload"), "Recargando…", () => reloadRecords().catch(e => { if (e instanceof AuthError) throw e; showError(e.message); }));
$("btnNew").onclick = () => openRecord(null);
$("recBody").addEventListener("click", e => {
  const del = e.target.closest("[data-del]"), ed = e.target.closest("[data-edit]"), tr = e.target.closest("tr[data-row]");
  if (del) return deleteRecord(recByRow(del.dataset.del));
  if (ed) return openRecord(recByRow(ed.dataset.edit));
  if (tr) openRecord(recByRow(tr.dataset.row));
});
$("recFields").addEventListener("input", () => { $("recErr").hidden = true; });
$("recForm").onsubmit = e => { e.preventDefault(); saveRecord(); };
$("btnRecCancel").onclick = () => $("recDialog").close();
$("btnRecDelete").onclick = () => editing && deleteRecord(editing);

$("btnAddUser").onclick = () => openUser(null);
$("btnAccReload").onclick = () => guard($("btnAccReload"), "Recargando…", () => reloadAccess().catch(e => { if (e instanceof AuthError) throw e; showError(e.message); }));
$("btnInit").onclick = initAccessSheet;
$("accBody").addEventListener("click", e => {
  const ed = e.target.closest("[data-uedit]"), del = e.target.closest("[data-udel]"), fix = e.target.closest("[data-fix]");
  if (ed) openUser(ACC.rows.find(a => a.email === ed.dataset.uedit));
  if (del) removeUser(del.dataset.udel);
  if (fix) fixPerm(fix.dataset.fix, fix);
});
$("userForm").onsubmit = e => { e.preventDefault(); saveUser(); };
$("btnUserCancel").onclick = () => $("userDialog").close();

(function boot() {
  let tab = "records";
  try { tab = sessionStorage.getItem("tickets.adminTab") || tab; } catch { /* nada */ }
  selectTab(tab === "access" ? "access" : "records");
  const p = configProblem();
  if (p) return showLogin(p);
  if (Auth.active && Auth.has(SCOPES.WRITE)) start();
  else showLogin();
})();
