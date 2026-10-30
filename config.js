// Configuración del dashboard. Nada de esto es secreto: el Client ID de Google es público
// por diseño y el archivo de Drive solo lo puede leer quien tenga permiso sobre él.
window.DASHBOARD_CONFIG = {
  // Google Cloud (proyecto dashboard-tickets, cuenta dquinto@csticorp.biz)
  clientId: "894531418481-cv6k33o3n8ettuujqaefbluo9pthq9s8.apps.googleusercontent.com",
  gcpProject: "dashboard-tickets-513201",

  // Hoja de cálculo de Google con los tickets
  driveFile: "https://docs.google.com/spreadsheets/d/1afBtVvrTZdrFxO48GXByGql590Ak2N2ZUJUuU1m10Ms/edit?gid=705412776#gid=705412776",
  sheetName: "US",          // hoja con los tickets
  listsSheet: "Listas",     // hoja con los valores de las listas desplegables
  accessSheet: "Accesos",   // hoja con los roles (la crea la página de Administración)

  // Siempre Administrador, aunque la hoja Accesos no exista o se modifique (evita quedarse sin acceso)
  superAdmins: ["dquinto@csticorp.biz"],

  // Contenido inicial de la hoja Accesos (se usa solo al crearla desde Administración)
  initialAccess: [
    { email: "dquinto@csticorp.biz", rol: "Administrador", nombre: "Dante Quinto" },
    { email: "dquinto@gmail.com",    rol: "Visualizador",  nombre: "Dante Quinto (personal)" },
  ],

  dueSoonDays: 3,           // umbral del semáforo "Por vencer" (igual que el Excel)
  autoRefreshMinutes: 5,    // relectura automática del dashboard
};
