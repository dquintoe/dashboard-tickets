// Lectura del Excel y cálculo de semáforo / días abiertos / calidad de datos.
// Todo ocurre en el navegador; nada se envía a otro servidor.
(function () {
  const CLOSED = new Set(["done", "cancelled"]);
  const DAY = 86400000;

  const pad = n => String(n).padStart(2, "0");
  const isoUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY); // b - a, ISO strings

  function toISO(v) {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return isoUTC(v);
    if (typeof v === "number") return isoUTC(new Date(Date.UTC(1899, 11, 30) + Math.round(v * DAY)));
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);           // DD-MM-AAAA
    if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                          // AAAA-MM-DD
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  const toNum = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
  const clean = v => (v === null || v === undefined) ? "" :
    (typeof v === "number" && Number.isInteger(v)) ? String(v) : String(v).trim();

  function semaforo(status, comp, today, dueSoon) {
    if (CLOSED.has(status.toLowerCase())) return "Cerrado";
    if (!comp) return "Sin fecha";
    const d = daysBetween(today, comp);
    if (d < 0) return "Vencido";
    if (d <= dueSoon) return "Por vencer";
    return "En plazo";
  }

  function parseWorkbook(arrayBuffer, cfg) {
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const ws = wb.Sheets[cfg.sheetName] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const hdrIdx = rows.slice(0, 20).findIndex(r => r && r.map(clean).includes("Status"));
    if (hdrIdx < 0) throw new Error(`No se encontró la fila de encabezados (columna "Status") en la hoja "${cfg.sheetName}".`);
    const col = {};
    rows[hdrIdx].forEach((h, i) => { const k = clean(h); if (k && !(k in col)) col[k] = i; });
    const g = (r, name) => (name in col) ? r[col[name]] : null;

    const today = todayISO();
    const tickets = [];
    for (const r of rows.slice(hdrIdx + 1)) {
      if (!r || !["US", "Description", "Tipo", "Status", "Obs."].some(k => clean(g(r, k)))) continue;
      const status = clean(g(r, "Status")) || "Sin status";
      const closed = CLOSED.has(status.toLowerCase());
      const fReg = toISO(g(r, "Fecha Registro")), fIni = toISO(g(r, "Fecha Inicio"));
      const fComp = toISO(g(r, "Fecha Compromiso")), fCie = toISO(g(r, "Fecha Cierre"));
      let avance = toNum(g(r, "% Avance"));
      if (avance !== null && avance > 1) avance /= 100;
      tickets.push({
        item: clean(g(r, "Item")), us: clean(g(r, "US")), desc: clean(g(r, "Description")),
        tipo: clean(g(r, "Tipo")) || "Sin tipo", status, abierto: !closed,
        prioridad: clean(g(r, "Prioridad")) || "Sin prioridad", modulo: clean(g(r, "Módulo SAP")) || "Sin módulo",
        solicitante: clean(g(r, "Solicitante")), responsable: clean(g(r, "Responsable")),
        f_registro: fReg, f_inicio: fIni, f_compromiso: fComp, f_cierre: fCie,
        dias_abiertos: fReg ? daysBetween(fReg, fCie || today) : null,
        dias_para_vencer: (fComp && !closed) ? daysBetween(today, fComp) : null,
        semaforo: semaforo(status, fComp, today, cfg.dueSoonDays),
        avance, horas_est: toNum(g(r, "Horas Est.")), horas_real: toNum(g(r, "Horas Reales")),
        ot: clean(g(r, "Orden Transporte")), ambiente: clean(g(r, "Ambiente")),
        proxima: clean(g(r, "Próxima Acción")), obs: clean(g(r, "Obs.")), link: clean(g(r, "Link")),
      });
    }

    // Calidad de datos
    const issues = [], byItem = {}, byUs = {};
    tickets.forEach(t => {
      if (t.item) (byItem[t.item] ||= []).push(t.us || "(sin US)");
      if (t.us) byUs[t.us] = (byUs[t.us] || 0) + 1;
    });
    Object.entries(byItem).forEach(([it, uss]) => { if (uss.length > 1) issues.push({ tipo: "Item duplicado", detalle: `Item ${it} se repite en US ${uss.join(", ")}` }); });
    Object.entries(byUs).forEach(([us, n]) => { if (n > 1) issues.push({ tipo: "US duplicada", detalle: `US ${us} aparece ${n} veces` }); });
    tickets.forEach(t => {
      const ref = t.us || `Item ${t.item}`;
      if (!t.us) issues.push({ tipo: "Sin número de US", detalle: `Item ${t.item}: ${t.desc || t.obs.slice(0, 60)}` });
      if (!t.responsable) issues.push({ tipo: "Sin responsable", detalle: `US ${ref}` });
      if (t.abierto && !t.f_compromiso) issues.push({ tipo: "Abierto sin fecha compromiso", detalle: `US ${ref}: ${t.desc.slice(0, 70)}` });
    });
    return { tickets, issues, today, access: parseAccess(wb, cfg) };
  }

  // Hoja de roles (Accesos): Email | Rol | Nombre | ... ; null si la hoja no existe.
  function parseAccess(wb, cfg) {
    const ws = wb.Sheets[cfg.accessSheet];
    if (!ws) return null;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
    if (!rows.length) return [];
    const hdr = rows[0].map(h => clean(h).toLowerCase());
    const ci = name => hdr.findIndex(h => h.startsWith(name));
    const e = ci("email") >= 0 ? ci("email") : ci("correo"), r = ci("rol"), n = ci("nombre");
    if (e < 0 || r < 0) return [];
    return rows.slice(1).map(row => ({ email: clean(row[e]), rol: clean(row[r]), nombre: n >= 0 ? clean(row[n]) : "" }))
      .filter(a => a.email);
  }

  window.TicketData = { parseWorkbook };
})();
