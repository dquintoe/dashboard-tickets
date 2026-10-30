// Configuración del dashboard. Es el único archivo que necesitas editar.
// Nada de esto es secreto: el Client ID de Google es público por diseño y el
// archivo de Drive solo lo puede leer quien inicie sesión y tenga permiso sobre él.
window.DASHBOARD_CONFIG = {
  // Google Cloud > APIs y servicios > Credenciales > ID de cliente OAuth (Aplicación web)
  clientId: "894531418481-cv6k33o3n8ettuujqaefbluo9pthq9s8.apps.googleusercontent.com",

  // URL del Excel en Drive (o solo su ID). Sirve .xlsx o Hoja de cálculo de Google.
  driveFile: "https://docs.google.com/spreadsheets/d/1afBtVvrTZdrFxO48GXByGql590Ak2N2ZUJUuU1m10Ms/edit?gid=705412776#gid=705412776",

  // Cuentas que pueden ver el dashboard
  allowedEmails: ["dquinto@csticorp.biz"],

  sheetName: "US",       // hoja con los tickets
  dueSoonDays: 3,        // umbral del semáforo "Por vencer" (igual que el Excel)
  autoRefreshMinutes: 5, // relectura automática desde Drive
};
