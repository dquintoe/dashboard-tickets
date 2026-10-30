# Dashboard de Seguimiento de Tickets — GitHub Pages

Versión 100 % estática (HTML + JavaScript) del dashboard de `Lista_de_US_DQ_seguimiento`.
Se publica gratis en GitHub Pages y funciona desde cualquier equipo (PC, laptop, celular):

- **Login:** Google Identity Services, directamente en la página.
- **Datos:** el navegador descarga el Excel desde **tu** Google Drive (permiso de solo lectura) y lo procesa ahí mismo.
- **GitHub solo guarda el código.** Ni el Excel ni los tickets ni contraseñas llegan nunca al repositorio.

| Archivo | Para qué |
|---|---|
| `index.html` | estructura de la página (login + dashboard) |
| `config.js` | **lo único que editas**: Client ID, URL del Excel, correos permitidos |
| `data.js` | lectura del Excel, semáforo, días abiertos, calidad de datos |
| `app.js` | login de Google, descarga de Drive, gráficos, filtros y tabla |
| `styles.css` | estilos (modo claro y oscuro) |

---

## Paso 1 — Credencial en Google Cloud (con dquinto@csticorp.biz)

1. Entra a <https://console.cloud.google.com> **con la cuenta corporativa** y crea un proyecto (`dashboard-tickets`).
2. **APIs y servicios → Biblioteca →** busca **Google Drive API** → *Habilitar*.
3. **Google Auth Platform / Pantalla de consentimiento de OAuth:**
   - Público: **Interno** (solo cuentas `@csticorp.biz`, sin verificación de Google).
     Si no aparece *Interno*: **Externo**, en modo *Prueba*, y agrega `dquinto@csticorp.biz` como usuario de prueba.
   - Acceso a datos (scopes): agrega `https://www.googleapis.com/auth/drive.readonly`.
4. **Clientes / Credenciales → Crear cliente OAuth → Aplicación web**:
   - **Orígenes de JavaScript autorizados:**
     - `https://<tu-usuario-github>.github.io` ← sin `/` final ni nombre del repo
     - `http://localhost:8000` ← para probar en tu PC (opcional)
   - **URI de redireccionamiento:** déjalo vacío (no se usa).
   - Copia el **ID de cliente** (`xxxx.apps.googleusercontent.com`). No necesitas el *secret*.

## Paso 2 — Editar `config.js`

```js
clientId: "1234567890-abc.apps.googleusercontent.com",
driveFile: "https://docs.google.com/spreadsheets/d/XXXXXXXX/edit",   // o la URL del .xlsx en Drive
allowedEmails: ["dquinto@csticorp.biz"],
```

## Paso 3 — Subir el código a GitHub

Necesitas una cuenta en <https://github.com>. Elige **una** de estas dos formas.

### Opción A — Desde el navegador (sin instalar nada)

1. En GitHub: **+ → New repository**.
   - Nombre: `dashboard-tickets` · Visibilidad: **Public** (GitHub Pages gratis requiere repo público; no hay datos en él).
   - Sin README → **Create repository**.
2. En la página del repo vacío: **uploading an existing file**.
3. Arrastra **el contenido** de esta carpeta (los archivos, no la carpeta) incluido `.nojekyll`.
   En Windows, los archivos que empiezan con punto se ven activando *Vista → Elementos ocultos*.
4. **Commit changes**.

### Opción B — Con Git (recomendado para ir actualizando)

Instala Git (<https://git-scm.com/download/win>) y en una terminal dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Dashboard de seguimiento de tickets"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/dashboard-tickets.git
git push -u origin main
```

La primera vez Git abre una ventana para iniciar sesión en GitHub.
Para publicar cambios después: `git add . && git commit -m "cambio" && git push`.

## Paso 4 — Activar GitHub Pages

1. En el repo: **Settings → Pages**.
2. *Build and deployment* → Source: **Deploy from a branch** → Branch: **main**, carpeta **/ (root)** → **Save**.
3. En 1–2 minutos aparece la URL: `https://<tu-usuario>.github.io/dashboard-tickets/`.
   El avance se ve en la pestaña **Actions** (“pages build and deployment”).
4. Abre la URL → **Continuar con Google** → acepta el permiso de lectura de Drive. Listo.

Cada `git push` (o archivo editado en la web de GitHub) vuelve a publicar automáticamente.

## Probar en tu PC antes de subir (opcional)

```bash
cd dashboard-tickets-pages
python -m http.server 8000
```
Abre <http://localhost:8000> (requiere el origen `http://localhost:8000` del paso 1.4).

---

## Seguridad: qué protege a los datos

- **Google, no la página, decide quién entra.** Con público *Interno*, solo cuentas `@csticorp.biz` pueden iniciar sesión.
- **Drive decide quién lee el archivo.** Aunque alguien vea el código, solo obtiene datos si su cuenta tiene acceso al Excel.
- `allowedEmails` añade un filtro extra en la página (cierra la sesión si la cuenta no está en la lista).
- El token de Google vive solo en la pestaña (sessionStorage) y dura 1 hora; luego pide iniciar sesión de nuevo. **Salir** lo revoca.
- `config.js` es público: contiene el Client ID (público por diseño) y el ID del archivo, que por sí solo no da acceso.
- Confirma con tu empresa si puedes alojar la herramienta en una cuenta personal de GitHub; si existe una organización corporativa de GitHub, mejor crear el repo allí.

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `Error 400: origin_mismatch` / `redirect_uri_mismatch` | El origen en la credencial debe ser exactamente `https://<usuario>.github.io` (sin barra final ni repo). Los cambios tardan unos minutos. |
| `Error 403: org_internal` | Iniciaste sesión con una cuenta fuera de `csticorp.biz`; usa la corporativa. |
| `access_denied` / `admin_policy_enforced` | El administrador de Workspace bloquea apps de terceros: debe permitir el Client ID (Admin → Seguridad → Control de acceso a API). |
| “Drive denegó el acceso… ¿está habilitada la Google Drive API?” | Habilítala en el mismo proyecto de la credencial (paso 1.2). |
| “No se encontró el archivo…” | Revisa `driveFile` y que la cuenta tenga acceso al Excel. |
| La ventana de Google no abre | Permite ventanas emergentes para `github.io`. |
| La página no cambia tras un push | Espera al deploy en **Actions** y recarga con Ctrl+F5. |
