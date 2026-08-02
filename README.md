# Najelo Cloud (Express & Node.js)

Gestor de archivos e interfaz de nube privada con panel de administración, control granular de permisos por usuario y soporte para almacenamiento en Render, Bunny.net y Supabase.

---

## 🚀 Despliegue en Render (conectado a GitHub)

Render compila y despliega tu aplicación Node.js automáticamente desde GitHub.

### Pasos en Render:
1. Conecta tu repositorio de GitHub en **Render.com** (Crea un **Web Service**).
2. Configura los comandos:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Agrega las **Variables de Entorno** (Environment Variables) en Render:
   - `SESSION_SECRET`: Una clave aleatoria segura para las sesiones.
   - `PORT`: Se asigna automáticamente por Render.

---

## ☁️ Almacenamiento Persistente con Bunny Storage y Supabase

En plataformas serverless/ephemerales como Render, los discos locales se reinician entre despliegues. Para mantener tus archivos permanentemente, puedes conectar **Bunny.net Storage** o **Supabase Storage**.

### Opción 1: Bunny.net Storage
Agrega estas variables de entorno en Render:
- `BUNNY_STORAGE_ZONE`: Nombre de tu Storage Zone en Bunny.net.
- `BUNNY_API_KEY`: Tu Password / API Key de Storage en Bunny.
- `BUNNY_REGION`: (Opcional) Ej: `storage.bunnycdn.com` o `ny.storage.bunnycdn.com`.
- `BUNNY_PULL_ZONE_URL`: (Opcional) URL pública CDN ej: `https://tu-zona.b-cdn.net`.

### Opción 2: Supabase Storage
Agrega estas variables de entorno en Render:
- `SUPABASE_URL`: `https://tu-proyecto.supabase.co`
- `SUPABASE_KEY`: Tu API Key (anon o service_role).
- `SUPABASE_BUCKET`: `najelo-files` (Crea este bucket en Supabase Storage).

---

## 💻 Ejecutar Localmente

1. Clona el repositorio e instala dependencias:
   ```bash
   npm install
   ```
2. Inicia la aplicación:
   ```bash
   npm start
   ```
3. Abre `http://localhost:3000`. El usuario por defecto es `admin` con contraseña `najelocloud2026`.

---

## ⚙️ Características Incluidas
- 🛡️ **Panel de Administración:** Control total de usuarios, aprobación de cuentas y registro de actividad (Logs).
- 🔑 **Permisos Granulares:** Configura si cada usuario puede ver, subir, crear carpetas, renombrar, mover/copiar o eliminar archivos.
- 🔐 **Carpetas Protegidas:** Protección con contraseña individual por carpeta.
- 🗑️ **Papelera de Reciclaje:** Restauración de archivos eliminados.
- 👁️ **Visualización Segura:** Ocultamiento/Muestreo de contraseñas con un clic.

