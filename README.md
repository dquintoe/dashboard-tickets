# Dashboard de Seguimiento de Tickets — v2 (roles Administrador / Visualizador)

Página estática publicada en GitHub Pages: **https://dquintoe.github.io/dashboard-tickets/**
Datos: Hoja de cálculo de Google `Lista_de_US_DQ_seguimiento` (hoja **US**) · Proyecto Google Cloud `dashboard-tickets-513201` (cuenta dquinto@csticorp.biz).

## Roles

| Rol | Dashboard (`index.html`) | Administración (`admin.html`) | Permiso en el archivo de Drive |
|---|---|---|---|
| **Administrador** | Sí | Sí: registros + roles y accesos | Editor |
| **Visualizador** | Sí | No | Lector |

Cuentas iniciales: `dquinto@csticorp.biz` → Administrador (incluye ver el dashboard) · `dquinto@gmail.com` → Visualizador.

- Los roles se guardan en una hoja nueva **Accesos** dentro del mismo archivo (la crea la página de Administración).
- `superAdmins` en `config.js` (dquinto@csticorp.biz) es siempre Administrador, aunque la hoja Accesos se borre o modifique: nadie puede dejar el sistema sin administrador.
- **La seguridad real la da Google Drive**: al asignar un rol, la página comparte el archivo como Lector o Editor. Un Visualizador no puede modificar datos aunque manipule la página, porque Drive se lo impide.

## Página de Administración

**Registros** (hoja US)
- Alta, edición y eliminación de registros directamente en la Hoja de Google.
- Campos con lista desplegable: los que en el Drive tienen validación de datos (Tipo, Status, Prioridad, Módulo SAP, Ambiente); los valores se leen de la hoja **Listas**, así que agregar un valor allí lo agrega en el formulario.
- Fechas con selector de fecha (se guardan como fecha dd-mm-aaaa), % Avance de 0 a 100, horas numéricas, el resto campo libre.
- Días Abiertos y Semáforo no se editan: son fórmulas del Drive (en filas nuevas se copian si faltan).
- Antes de guardar o eliminar se verifica que la fila no haya cambiado en el Drive (evita pisar cambios de otra persona o borrar la fila equivocada).

**Roles y accesos** (hoja Accesos)
- Agregar usuario, cambiar rol o quitarlo. Al guardar, comparte el archivo (o ajusta / quita el permiso) automáticamente.
- Columna “Permiso en Drive” con alertas si el permiso no corresponde al rol, y botón para corregirlo.
- Lista de personas que tienen acceso al archivo pero no tienen rol en el dashboard.

## Archivos

| Archivo | Cambio en v2 |
|---|---|
| `index.html`, `app.js` | Dashboard: valida el rol, muestra el rol y el botón **⚙ Administración** solo al Administrador |
| `admin.html`, `admin.js` | **Nuevos**: página de administración |
| `auth.js` | **Nuevo**: sesión de Google, roles y permisos compartidos por ambas páginas |
| `data.js` | Lee también la hoja Accesos |
| `config.js` | Ya configurado (Client ID, archivo de Drive, superAdmins, accesos iniciales) |
| `styles.css` | Estilos de administración |

---

## Paso 1 — Ajustes en Google Cloud (dquinto@csticorp.biz, proyecto dashboard-tickets)

1. **Habilitar Google Sheets API**: ☰ → APIs & Services → Library → *Google Sheets API* → **Enable**.
2. **Agregar el permiso de edición**: Google Auth Platform → **Data Access** → **Add or remove scopes** → filtrar `auth/drive` → marcar
   `https://www.googleapis.com/auth/drive` (*See, edit, create, and delete all of your Google Drive files*) → **Update** → **Save**.
   Mantener también `.../auth/drive.readonly`.
3. **Permitir la cuenta @gmail.com**: Google Auth Platform → **Audience**.
   - Si *User type* es **Internal**: pulsar **Make external** → confirmar. (Internal solo deja entrar cuentas @csticorp.biz.)
   - *Publishing status* debe quedar en **Testing** (no pulsar *Publish app*).
   - **Test users → + Add users** → agregar `dquinto@csticorp.biz` y `dquinto@gmail.com` → **Save**.
4. Los orígenes de JavaScript del cliente OAuth (`https://dquintoe.github.io`, `http://localhost:8000`) no cambian.

> En modo Testing, Google muestra “Google no verificó esta app” al iniciar sesión: pulsar **Continuar**.
> Cada persona nueva debe agregarse como *Test user* (máx. 100); la página de Administración recuerda este paso con un enlace directo.

## Paso 2 — Subir los archivos a GitHub (repositorio dquintoe/dashboard-tickets)

1. En `https://github.com/dquintoe/dashboard-tickets` → **Add file → Upload files**.
2. Descomprimir el zip, **entrar** a la carpeta y arrastrar **todos los archivos** (Ctrl+A), incluidos `.gitignore` y `.nojekyll`.
   Los que ya existen se reemplazan; `admin.html`, `admin.js` y `auth.js` se agregan.
3. **Commit changes** → esperar en **Actions** que *pages build and deployment* quede en verde (1–2 min).
4. Verificar que todos los archivos están en la **raíz** del repositorio.

Con Git: `git add . && git commit -m "v2: roles y administración" && git push`.

## Paso 3 — Primer uso (una sola vez)

1. Abrir https://dquintoe.github.io/dashboard-tickets/ con **Ctrl+F5** e iniciar sesión con `dquinto@csticorp.biz`.
2. Pulsar **⚙ Administración** → **Autorizar edición con Google** → aceptar el permiso de Drive.
3. Pestaña **Roles y accesos** → **Crear hoja de accesos**. Crea la hoja *Accesos* con las dos cuentas y comparte el archivo con `dquinto@gmail.com` como **Lector**.
4. Probar con `dquinto@gmail.com` en una ventana de incógnito: debe ver el dashboard con el rol Visualizador y sin el botón de Administración.

> Si al compartir aparece un error de política, la administración de Google Workspace de csticorp.biz no permite compartir con cuentas externas: compartir el archivo manualmente o pedir la excepción al administrador.

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `Error 403: org_internal` con la cuenta gmail | El público sigue en Internal: Paso 1.3. |
| `Error 403: access_denied` | Falta agregar la cuenta en Test users (Paso 1.3). |
| “La API de Google necesaria no está habilitada” | Habilitar Google Sheets API (Paso 1.1). |
| “Falta el permiso de edición de Google Drive” | Agregar el scope `auth/drive` (Paso 1.2), Salir y volver a entrar aceptando todos los permisos. |
| “No se encontró el archivo… o tu cuenta no tiene acceso” | El archivo no está compartido con esa cuenta: asignarle un rol desde Administración. |
| “La cuenta … no tiene acceso a este dashboard” | La cuenta no está en la hoja Accesos. |
| “El registro cambió en el Drive desde que se cargó” | Otra persona editó la fila; la lista se recargó, repetir el cambio. |
| La página no muestra los cambios tras subirlos | Esperar el deploy en Actions y recargar con Ctrl+F5. |
