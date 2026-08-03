const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

function safeEnsureDir(targetDir, fallbackSubdir) {
  // En Vercel, forzamos el uso de /tmp directamente para evitar errores de permisos en rutas raíz
  const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  
  if (isVercel) {
    const fallbackPath = path.join(os.tmpdir(), fallbackSubdir);
    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
      return fallbackPath;
    } catch (err2) {
      console.error(`[FileSystem Vercel] Error al crear directorio en /tmp ('${fallbackPath}'):`, err2.message);
      return fallbackPath;
    }
  }

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const testFile = path.join(targetDir, `.write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return targetDir;
  } catch (err) {
    console.warn(`[FileSystem] El directorio '${targetDir}' no es escribible o no se pudo crear (${err.message}). Usando /tmp...`);
    const fallbackPath = path.join(os.tmpdir(), fallbackSubdir);
    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
      return fallbackPath;
    } catch (err2) {
      console.error(`[FileSystem] Error al crear el directorio alternativo '${fallbackPath}':`, err2.message);
      return fallbackPath;
    }
  }
}

const app = express();const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

function safeEnsureDir(targetDir, fallbackSubdir) {
  // En Vercel o entornos serverless, forzamos el uso de /tmp directamente
  const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  
  if (isVercel) {
    const fallbackPath = path.join(os.tmpdir(), fallbackSubdir);
    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
      return fallbackPath;
    } catch (err2) {
      console.error(`[FileSystem Vercel] Error al crear directorio en /tmp ('${fallbackPath}'):`, err2.message);
      return fallbackPath;
    }
  }

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const testFile = path.join(targetDir, `.write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return targetDir;
  } catch (err) {
    console.warn(`[FileSystem] El directorio '${targetDir}' no es escribible o no se pudo crear (${err.message}). Usando /tmp...`);
    const fallbackPath = path.join(os.tmpdir(), fallbackSubdir);
    try {
      if (!fs.existsSync(fallbackPath)) {
        fs.mkdirSync(fallbackPath, { recursive: true });
      }
      return fallbackPath;
    } catch (err2) {
      console.error(`[FileSystem] Error al crear el directorio alternativo '${fallbackPath}':`, err2.message);
      return fallbackPath;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Directorios protegidos contra restricciones de solo lectura en Vercel
const DATA_DIR = safeEnsureDir(path.join(__dirname, 'data'), 'najelo_data');
const UPLOAD_DIR = safeEnsureDir(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'), 'najelo_uploads');
const tmpUploadDir = safeEnsureDir(path.join(__dirname, 'tmp_uploads'), 'najelo_tmp_uploads');

const uploadMulter = multer({ dest: tmpUploadDir });

const parseRequestBody = (req, res, next) => {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    uploadMulter.none()(req, res, (err) => {
      if (err) console.error("Error al parsear multipart/form-data:", err);
      next();
    });
  } else {
    next();
  }
};

// ============================================================
// UTILIDADES DE CONTRASEÑA Y RESTO DEL SERVIDOR
// ============================================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 150000, 32, 'sha256').toString('hex');
  return `${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hexDigest] = stored.split('$');
    if (!salt || !hexDigest) return false;
    const digest = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 150000, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hexDigest, 'hex'));
  } catch {
    return false;
  }
}

// ============================================================
// ALMACENAMIENTO Y PERSISTENCIA DE DATOS
// ============================================================
const DATA_DIR = safeEnsureDir(path.join(__dirname, 'data'), 'najelo_data');

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROTECTED_FILE = path.join(DATA_DIR, 'protected.json');
const TRASH_FILE = path.join(DATA_DIR, 'trash.json');

const TRASH_DIR = safeEnsureDir(path.join(UPLOAD_DIR, '.papelera'), 'najelo_papelera');

function copyFolderRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  try {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
      if (!fs.existsSync(dest)) {
        try { fs.mkdirSync(dest, { recursive: true }); } catch {}
      }
      fs.readdirSync(src).forEach(childItemName => {
        copyFolderRecursive(path.join(src, childItemName), path.join(dest, childItemName));
      });
    } else {
      const parentDir = path.dirname(dest);
      if (!fs.existsSync(parentDir)) {
        try { fs.mkdirSync(parentDir, { recursive: true }); } catch {}
      }
      fs.copyFileSync(src, dest);
    }
  } catch (e) {
    console.warn("copyFolderRecursive error:", e.message);
  }
}

const usersMap = new Map();
const adminLogs = [];
const protectedItemsMap = new Map();
const sharesMap = new Map();
const trashItemsMap = new Map();

const DEFAULT_PERMISSIONS = {
  can_view: true,
  can_upload: true,
  can_create_folder: true,
  can_rename: true,
  can_move_copy: true,
  can_delete: true
};

// Crear administrador por defecto
const defaultAdmin = {
  id: "admin-id-1",
  username: "admin",
  password_hash: hashPassword("najelocloud2026"),
  plain_password: "najelocloud2026",
  is_admin: 1,
  is_approved: 1,
  permissions: { ...DEFAULT_PERMISSIONS }
};
usersMap.set(defaultAdmin.id, defaultAdmin);

// Configuración de Supabase
const { createClient } = require('@supabase/supabase-js');
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  try {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    console.log("[Supabase] Conectado exitosamente.");
  } catch (e) {
    console.error("[Supabase] Error al conectar:", e.message);
  }
}

// Configuración de Bunny.net Storage y Pull Zone CDN
const BUNNY_STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_REGION = process.env.BUNNY_REGION || 'storage.bunnycdn.com';
const BUNNY_PULL_ZONE_URL = (process.env.BUNNY_PULL_ZONE_URL || process.env.BUNNY_CDN_URL || '').trim().replace(/\/+$/, '');

function isBunnyEnabled() {
  return Boolean(BUNNY_STORAGE_ZONE && BUNNY_API_KEY);
}

function getBunnyCdnUrl(relPath = '') {
  if (!BUNNY_PULL_ZONE_URL) return null;
  let baseUrl = BUNNY_PULL_ZONE_URL;
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  let cleanPath = (relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleanPath) return baseUrl;
  const parts = cleanPath.split('/').map(encodeURIComponent);
  return `${baseUrl}/${parts.join('/')}`;
}

function getBunnyUrl(relPath = '') {
  let cleanPath = (relPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const zone = BUNNY_STORAGE_ZONE;
  if (!cleanPath) {
    return `https://${BUNNY_REGION}/${zone}/`;
  }
  const parts = cleanPath.split('/').map(encodeURIComponent);
  return `https://${BUNNY_REGION}/${zone}/${parts.join('/')}`;
}

async function bunnyListFiles(relPath = '') {
  if (!isBunnyEnabled()) {
    console.log("[BunnyStorage] Bunny no está habilitado (faltan BUNNY_STORAGE_ZONE o BUNNY_API_KEY en las variables de entorno).");
    return null;
  }
  try {
    let url = getBunnyUrl(relPath);
    if (!url.endsWith('/')) url += '/';
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'AccessKey': BUNNY_API_KEY, 'Accept': 'application/json' }
    });
    if (!res.ok) {
      console.error(`[BunnyStorage] Error HTTP ${res.status} (${res.statusText}) al listar '${relPath}' en URL: ${url}`);
      return null;
    }
    const items = await res.json();
    if (!Array.isArray(items)) return null;

    return items.filter(item => {
      const itemName = item.ObjectName || item.Name || '';
      if (!itemName || itemName.startsWith('.')) return false;
      if (!relPath && (itemName === 'data' || itemName === 'tmp_uploads')) return false;
      return true;
    }).map(item => {
      const itemName = item.ObjectName || item.Name || '';
      const itemRel = relPath ? `${relPath}/${itemName}` : itemName;
      return {
        name: itemName,
        is_dir: Boolean(item.IsDirectory),
        is_protected: protectedItemsMap.has(itemRel),
        size: item.IsDirectory ? 0 : (item.Length || 0),
        modified: item.LastChanged ? Math.floor(new Date(item.LastChanged).getTime() / 1000) : Math.floor(Date.now() / 1000)
      };
    });
  } catch (e) {
    console.error("[BunnyStorage] Excepción al listar archivos:", e.message);
    return null;
  }
}

async function bunnyUploadFile(relPath, fileName, filePathOrBuffer) {
  if (!isBunnyEnabled()) return false;
  try {
    const fullRel = relPath ? `${relPath}/${fileName}` : fileName;
    const url = getBunnyUrl(fullRel);

    const headers = {
      'AccessKey': BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream'
    };

    let fetchOptions = {
      method: 'PUT',
      headers
    };

    if (typeof filePathOrBuffer === 'string') {
      const stats = fs.statSync(filePathOrBuffer);
      headers['Content-Length'] = stats.size;
      fetchOptions.body = fs.createReadStream(filePathOrBuffer);
      fetchOptions.duplex = 'half';
    } else {
      fetchOptions.body = filePathOrBuffer;
    }

    const res = await fetch(url, fetchOptions);
    return res.ok;
  } catch (e) {
    console.error("[BunnyStorage] Error subiendo archivo:", e.message);
    return false;
  }
}

async function bunnyCreateFolder(relPath, folderName) {
  if (!isBunnyEnabled()) return false;
  try {
    const fullRel = relPath ? `${relPath}/${folderName}` : folderName;
    let url = getBunnyUrl(fullRel);
    if (!url.endsWith('/')) url += '/';
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'AccessKey': BUNNY_API_KEY }
    });
    return res.ok;
  } catch (e) {
    console.error("[BunnyStorage] Error creando carpeta:", e.message);
    return false;
  }
}

async function bunnyDelete(relPath) {
  if (!isBunnyEnabled()) return false;
  try {
    let url = getBunnyUrl(relPath);
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'AccessKey': BUNNY_API_KEY }
    });
    if (!res.ok && !url.endsWith('/')) {
      const resDir = await fetch(url + '/', {
        method: 'DELETE',
        headers: { 'AccessKey': BUNNY_API_KEY }
      });
      return resDir.ok;
    }
    return res.ok;
  } catch (e) {
    console.error("[BunnyStorage] Error eliminando elemento:", e.message);
    return false;
  }
}

async function bunnyMoveItem(srcRelPath, destRelPath, localFilePath = null) {
  if (!isBunnyEnabled()) return false;
  try {
    if (localFilePath && fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
      const destDir = path.dirname(destRelPath) === '.' ? '' : path.dirname(destRelPath);
      const fileName = path.basename(destRelPath);
      const ok = await bunnyUploadFile(destDir, fileName, localFilePath);
      if (ok) {
        await bunnyDelete(srcRelPath);
        return true;
      }
    }

    const srcUrl = getBunnyUrl(srcRelPath);
    const destUrl = getBunnyUrl(destRelPath);
    const res = await fetch(srcUrl, { headers: { 'AccessKey': BUNNY_API_KEY } });
    if (!res.ok) return false;

    const headers = {
      'AccessKey': BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream'
    };
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    let fetchOptions = {
      method: 'PUT',
      headers,
      duplex: 'half'
    };

    if (res.body) {
      fetchOptions.body = res.body;
    }

    const putRes = await fetch(destUrl, fetchOptions);

    if (putRes.ok) {
      await bunnyDelete(srcRelPath);
      return true;
    }
    return false;
  } catch (e) {
    console.error("[BunnyStorage] Error moviendo elemento en Bunny:", e.message);
    return false;
  }
}

async function pipeBunnyToResponse(relPath, req, res, attachmentFileName = null) {
  if (!isBunnyEnabled()) return false;
  try {
    const url = getBunnyUrl(relPath);
    const headers = { 'AccessKey': BUNNY_API_KEY };
    if (req && req.headers && req.headers.range) {
      headers['Range'] = req.headers.range;
    }
    const bunnyRes = await fetch(url, { method: 'GET', headers });
    if (!bunnyRes.ok) return false;

    res.status(bunnyRes.status);
    const contentType = bunnyRes.headers.get('content-type');
    const contentLength = bunnyRes.headers.get('content-length');
    const acceptRanges = bunnyRes.headers.get('accept-ranges');
    const contentRange = bunnyRes.headers.get('content-range');

    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    if (contentRange) res.setHeader('Content-Range', contentRange);

    if (attachmentFileName) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachmentFileName)}"`);
    } else {
      const cd = bunnyRes.headers.get('content-disposition');
      if (cd) res.setHeader('Content-Disposition', cd);
    }

    if (bunnyRes.body) {
      const { Readable } = require('stream');
      const nodeStream = Readable.fromWeb(bunnyRes.body);
      nodeStream.pipe(res);
      return true;
    }
    return false;
  } catch (e) {
    console.error("[BunnyStorage] Stream error:", e.message);
    return false;
  }
}

async function bunnyCopyItem(oldRelPath, newRelPath, localSourcePath = null) {
  if (!isBunnyEnabled()) return false;
  try {
    const cleanOld = (oldRelPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cleanNew = (newRelPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return false;

    if (localSourcePath && fs.existsSync(localSourcePath) && fs.statSync(localSourcePath).isFile()) {
      const newParts = cleanNew.split('/');
      const fileName = newParts.pop();
      const parentDir = newParts.join('/');
      return await bunnyUploadFile(parentDir, fileName, localSourcePath);
    }

    const srcUrl = getBunnyUrl(cleanOld);
    const destUrl = getBunnyUrl(cleanNew);

    const res = await fetch(srcUrl, { headers: { 'AccessKey': BUNNY_API_KEY } });
    if (!res.ok) {
      const items = await bunnyListFiles(cleanOld);
      if (items !== null) {
        const newParts = cleanNew.split('/');
        const folderName = newParts.pop();
        const parentDir = newParts.join('/');
        await bunnyCreateFolder(parentDir, folderName);

        for (const item of items) {
          const itemOld = `${cleanOld}/${item.name}`;
          const itemNew = `${cleanNew}/${item.name}`;
          await bunnyCopyItem(itemOld, itemNew);
        }
        return true;
      }
      return false;
    }

    const headers = {
      'AccessKey': BUNNY_API_KEY,
      'Content-Type': 'application/octet-stream'
    };
    const contentLength = res.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;

    const putRes = await fetch(destUrl, {
      method: 'PUT',
      headers,
      body: res.body,
      duplex: 'half'
    });

    return putRes.ok;
  } catch (e) {
    console.error("[BunnyStorage] Error copiando en Bunny:", e.message);
    return false;
  }
}

// Carga y guardado local JSON
function loadLocalData() {
  const readJson = (fileName, primaryPath) => {
    const pathsToTry = [primaryPath, path.join(__dirname, 'data', fileName)];
    for (const p of pathsToTry) {
      try {
        if (fs.existsSync(p)) {
          const content = fs.readFileSync(p, 'utf8');
          if (content && content.trim()) return JSON.parse(content);
        }
      } catch (e) {}
    }
    return null;
  };

  try {
    const usersArr = readJson('users.json', USERS_FILE);
    if (Array.isArray(usersArr)) {
      usersArr.forEach(u => {
        for (const [existingId, existingUser] of usersMap.entries()) {
          if (existingUser.username === u.username && existingId !== u.id) {
            usersMap.delete(existingId);
          }
        }
        usersMap.set(u.id, u);
      });
    }
  } catch (e) {
    console.error("Error cargando usuarios locales:", e.message);
  }

  try {
    const protectedArr = readJson('protected.json', PROTECTED_FILE);
    if (Array.isArray(protectedArr)) {
      protectedArr.forEach(p => {
        const key = p.item_path || p.path;
        const hash = p.password_hash || p.hash;
        if (key && hash) {
          protectedItemsMap.set(key, hash);
        }
      });
    }
  } catch (e) {
    console.error("Error cargando protecciones locales:", e.message);
  }

  try {
    const trashArr = readJson('trash.json', TRASH_FILE);
    if (Array.isArray(trashArr)) {
      trashArr.forEach(item => {
        if (item && item.id) {
          trashItemsMap.set(item.id, item);
        }
      });
    }
  } catch (e) {
    console.error("Error cargando papelera local:", e.message);
  }
}

async function ensureBunnyDataFolder() {
  if (!isBunnyEnabled()) {
    console.log("[BunnyStorage] Bunny.net no está habilitado. Omite creación de la carpeta 'data'.");
    return false;
  }
  try {
    console.log("[BunnyStorage] Asegurando la carpeta 'data' en Bunny Storage...");
    const ok = await bunnyCreateFolder('', 'data');
    if (ok) {
      console.log("[BunnyStorage] Carpeta 'data' creada / verificada con éxito en Bunny Storage.");
    }
    const uploadIfPresent = async (fileName, primaryPath) => {
      const paths = [primaryPath, path.join(__dirname, 'data', fileName)];
      for (const p of paths) {
        if (fs.existsSync(p)) {
          await bunnyUploadFile('data', fileName, p);
          break;
        }
      }
    };
    await uploadIfPresent('users.json', USERS_FILE);
    await uploadIfPresent('protected.json', PROTECTED_FILE);
    await uploadIfPresent('trash.json', TRASH_FILE);
    return true;
  } catch (e) {
    console.error("[BunnyStorage] Error asegurando carpeta 'data':", e.message);
    return false;
  }
}

async function syncDataFromBunny() {
  if (!isBunnyEnabled()) return;
  try {
    const filesToSync = [
      { name: 'users.json', localPath: USERS_FILE },
      { name: 'protected.json', localPath: PROTECTED_FILE },
      { name: 'trash.json', localPath: TRASH_FILE }
    ];
    for (const f of filesToSync) {
      const url = getBunnyUrl(`data/${f.name}`);
      const res = await fetch(url, { headers: { 'AccessKey': BUNNY_API_KEY } });
      if (res.ok) {
        const content = await res.text();
        if (content && content.trim().length > 0) {
          try {
            fs.writeFileSync(f.localPath, content, 'utf8');
            console.log(`[BunnyStorage] Sincronizado 'data/${f.name}' desde Bunny Storage.`);
          } catch (err) {
            console.warn(`[BunnyStorage] No se pudo guardar localmente ${f.localPath}:`, err.message);
          }
        }
      }
    }
  } catch (e) {
    console.error("[BunnyStorage] Error al descargar 'data' desde Bunny Storage:", e.message);
  }
}

function saveData() {
  try {
    const usersArr = Array.from(usersMap.values());
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(usersArr, null, 2), 'utf8'); } catch (e) {}

    const protectedArr = Array.from(protectedItemsMap.entries()).map(([k, v]) => ({
      item_path: k,
      password_hash: typeof v === 'object' ? v.hash : v
    }));
    try { fs.writeFileSync(PROTECTED_FILE, JSON.stringify(protectedArr, null, 2), 'utf8'); } catch (e) {}

    const trashArr = Array.from(trashItemsMap.values());
    try { fs.writeFileSync(TRASH_FILE, JSON.stringify(trashArr, null, 2), 'utf8'); } catch (e) {}

    if (isBunnyEnabled()) {
      bunnyUploadFile('data', 'users.json', USERS_FILE).catch(() => {});
      bunnyUploadFile('data', 'protected.json', PROTECTED_FILE).catch(() => {});
      bunnyUploadFile('data', 'trash.json', TRASH_FILE).catch(() => {});
    }
  } catch (e) {
    console.error("Error guardando datos locales:", e.message);
  }
}

// Sincronización con Supabase
async function syncWithSupabase() {
  if (!supabase) return;

  // 1. Usuarios
  try {
    const { data: dbUsers, error } = await supabase.from('users').select('*');
    if (error) {
      console.error("[Supabase] Error consultando usuarios:", error.message, error.details || '');
    } else if (dbUsers && dbUsers.length > 0) {
      dbUsers.forEach(u => {
        let perms = u.permissions;
        if (typeof perms === 'string') {
          try { perms = JSON.parse(perms); } catch(e) { perms = DEFAULT_PERMISSIONS; }
        }
        const strId = String(u.id);
        // Limpiar cualquier ID anterior con el mismo username (ej. "admin-id-1")
        for (const [existingId, existingUser] of usersMap.entries()) {
          if (existingUser.username === u.username && existingId !== strId) {
            usersMap.delete(existingId);
          }
        }
        usersMap.set(strId, {
          id: strId,
          username: u.username,
          password_hash: u.password_hash,
          plain_password: u.plain_password || '',
          is_admin: Number(u.is_admin) || 0,
          is_approved: Number(u.is_approved) || 0,
          permissions: perms || { ...DEFAULT_PERMISSIONS }
        });
      });
      console.log(`[Supabase] ${dbUsers.length} usuarios sincronizados.`);
    } else {
      console.log("[Supabase] La tabla 'users' está vacía o sin datos.");
      await saveUserToSupabase(defaultAdmin);
    }
  } catch (e) {
    console.error("[Supabase] Error sincronizando usuarios:", e.message);
  }

  // 2. Protecciones
  try {
    const { data: dbProts } = await supabase.from('protected_items').select('*');
    if (dbProts) {
      dbProts.forEach(p => protectedItemsMap.set(p.item_path, p.password_hash));
    }
  } catch (e) {}

  // 3. Enlaces compartidos
  try {
    const { data: dbShares } = await supabase.from('shares').select('*');
    if (dbShares) {
      dbShares.forEach(s => sharesMap.set(s.token, s));
    }
  } catch (e) {}

  // 4. Logs
  try {
    const { data: dbLogs } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (dbLogs) {
      adminLogs.length = 0;
      dbLogs.forEach(l => adminLogs.push(l));
    }
  } catch (e) {}

  try {
    const { data: dbTrash } = await supabase.from('trash_items').select('*');
    if (dbTrash && Array.isArray(dbTrash)) {
      dbTrash.forEach(t => {
        if (t && t.id) trashItemsMap.set(t.id, t);
      });
    }
  } catch (e) {}
}

async function saveUserToSupabase(user) {
  if (!supabase) return;
  try {
    // Solo enviar campos reales de la tabla public.users: id (int8), username (text), password_hash (text), is_admin (int2), is_approved (int2)
    const payload = {
      username: user.username,
      password_hash: user.password_hash,
      is_admin: user.is_admin ? 1 : 0,
      is_approved: user.is_approved ? 1 : 0
    };

    if (user.id && !isNaN(Number(user.id))) {
      payload.id = Number(user.id);
      const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
      if (error) console.error("[Supabase] Error en upsert usuario:", error.message);
    } else {
      const { data: existing } = await supabase.from('users').select('id').eq('username', user.username).maybeSingle();
      if (existing && existing.id) {
        payload.id = existing.id;
        const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
        if (error) console.error("[Supabase] Error en update usuario:", error.message);
      } else {
        const { data: inserted, error } = await supabase.from('users').insert([payload]).select().single();
        if (error) {
          console.error("[Supabase] Error insertando usuario:", error.message);
        } else if (inserted && inserted.id) {
          user.id = String(inserted.id);
          usersMap.set(user.id, user);
        }
      }
    }
  } catch (e) {
    console.error("[Supabase] Error guardando usuario:", e.message);
  }
}

async function deleteUserFromSupabase(userId) {
  if (!supabase) return;
  try {
    if (!isNaN(Number(userId))) {
      await supabase.from('users').delete().eq('id', Number(userId));
    } else {
      await supabase.from('users').delete().eq('id', userId);
    }
  } catch (e) {
    console.error("[Supabase] Error eliminando usuario:", e.message);
  }
}

async function saveProtectedItemToSupabase(itemPath, passwordHash) {
  if (!supabase) return;
  try {
    if (passwordHash) {
      const realHash = typeof passwordHash === 'object' ? passwordHash.hash : passwordHash;
      await supabase.from('protected_items').upsert({ item_path: itemPath, password_hash: realHash }, { onConflict: 'item_path' });
    } else {
      await supabase.from('protected_items').delete().eq('item_path', itemPath);
    }
  } catch (e) {}
}

async function saveShareToSupabase(shareObj) {
  if (!supabase) return;
  try {
    await supabase.from('shares').upsert(shareObj, { onConflict: 'token' });
  } catch (e) {}
}

async function saveTrashItemToSupabase(item, isDelete = false) {
  if (!supabase) return;
  try {
    if (isDelete) {
      const id = typeof item === 'string' ? item : item.id;
      await supabase.from('trash_items').delete().eq('id', id);
    } else {
      await supabase.from('trash_items').upsert(item, { onConflict: 'id' });
    }
  } catch (e) {}
}

// Cargar estado inicial y sincronización de Bunny
(async () => {
  try {
    await syncDataFromBunny();
  } catch (e) {}
  loadLocalData();
  try {
    await syncWithSupabase();
  } catch (e) {}
  saveData();
  try {
    await ensureBunnyDataFolder();
  } catch (e) {}
})();

// ============================================================
// MIDDLEWARE CONFIGURACIÓN
// ============================================================
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'najelo_cloud_secret_key_2026',
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'none',
    secure: true
  }
}));

app.use('/static', express.static(path.join(__dirname, 'static')));

app.get(['/favicon.ico', '/favicon.svg', '/favicon.png', '/apple-touch-icon.png'], (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'static', 'favicon.svg'));
});

// ============================================================
// MIDDLEWARES DE AUTENTICACIÓN Y ROLES
// ============================================================
function getCurrentUser(req) {
  let userId = req.session ? req.session.userId : null;

  if (!userId && req.headers['x-user-id']) {
    userId = req.headers['x-user-id'];
  }
  if (!userId && req.cookies && req.cookies.najelo_uid) {
    userId = req.cookies.najelo_uid;
  }
  if (!userId && req.query && req.query.auth_uid) {
    userId = req.query.auth_uid;
  }

  if (!userId) return null;

  const user = usersMap.get(userId);
  if (!user || !user.is_approved) {
    if (req.session) req.session.userId = null;
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    is_admin: Boolean(user.is_admin),
    permissions: user.permissions || { ...DEFAULT_PERMISSIONS }
  };
}

function hasPermission(userObj, permKey) {
  if (!userObj) return false;
  if (userObj.is_admin) return true; // Admin siempre tiene acceso total
  const perms = userObj.permissions || DEFAULT_PERMISSIONS;
  return Boolean(perms[permKey]);
}

function requireUser(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ detail: "Debes iniciar sesión" });
  }
  req.user = user;
  next();
}

function requirePermission(permKey) {
  return (req, res, next) => {
    const user = getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ detail: "Debes iniciar sesión" });
    }
    req.user = user;
    if (!hasPermission(user, permKey)) {
      return res.status(403).json({ detail: "No tienes permiso para realizar esta acción." });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ detail: "Debes iniciar sesión" });
  }
  if (!user.is_admin) {
    return res.status(403).json({ detail: "Acción solo permitida para administradores" });
  }
  req.user = user;
  next();
}

function logActivity(username, action, details, ip_address = '') {
  const now = new Date();
  const user = username || 'Sistema';
  const det = details || '';
  const logObj = {
    username: user,
    admin_username: user,
    action: action || 'ACCION',
    details: det,
    target_user: det,
    ip_address: ip_address || '',
    created_at: now.toISOString(),
    timestamp: Math.floor(now.getTime() / 1000)
  };
  adminLogs.unshift(logObj);
  if (adminLogs.length > 300) adminLogs.pop();

  if (supabase) {
    // Solo enviar columnas existentes en la tabla admin_logs de Supabase: username, action, details, ip_address, created_at
    supabase.from('admin_logs').insert([{
      username: user,
      action: action || 'ACCION',
      details: det,
      ip_address: ip_address || '',
      created_at: now.toISOString()
    }]).then(({ error }) => {
      if (error) {
        if (!error.message || !error.message.includes('row-level security')) {
          console.error("[Supabase] Error insertando en admin_logs:", error.message);
        }
      }
    }).catch(() => {});
  }
}

// ============================================================
// RUTAS DE VISTAS
// ============================================================
app.get('/', (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/login', (req, res) => {
  const user = getCurrentUser(req);
  if (user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

// ============================================================
// API DE AUTENTICACIÓN
// ============================================================
app.get('/api/me', requireUser, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    is_admin: req.user.is_admin,
    permissions: req.user.permissions
  });
});

app.post('/api/register', parseRequestBody, (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  if (username.length < 3 || password.length < 4) {
    return res.status(400).json({ detail: "El usuario debe tener al menos 3 caracteres y la contraseña 4." });
  }

  for (const u of usersMap.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) {
      if (username.toLowerCase() === 'admin') {
        u.password_hash = hashPassword(password);
        u.plain_password = password;
        u.is_approved = 1;
        u.is_admin = 1;
        saveData();
        saveUserToSupabase(u);
        return res.json({ message: "Contraseña de administrador actualizada con éxito. Ya puedes iniciar sesión." });
      }
      return res.status(400).json({ detail: "Ese usuario ya existe." });
    }
  }

  const isFirst = usersMap.size === 0;
  const newUser = {
    id: crypto.randomUUID(),
    username,
    password_hash: hashPassword(password),
    plain_password: password,
    is_admin: isFirst ? 1 : 0,
    is_approved: isFirst ? 1 : 0,
    permissions: { ...DEFAULT_PERMISSIONS }
  };
  usersMap.set(newUser.id, newUser);
  saveData();
  saveUserToSupabase(newUser);
  logActivity(username, "USER_REGISTERED", `Registro de nuevo usuario: ${username}`);

  return res.json({ message: "Cuenta creada con éxito." });
});

app.post('/api/login', parseRequestBody, (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const clientIp = req.ip || req.connection.remoteAddress || '';

  if (!username) {
    return res.status(400).json({ detail: "Ingresa tu usuario." });
  }

  let foundUser = null;
  for (const u of usersMap.values()) {
    if (u.username.toLowerCase() === username.toLowerCase()) {
      foundUser = u;
      break;
    }
  }

  if (!foundUser || !(verifyPassword(password, foundUser.password_hash) || (foundUser.plain_password && foundUser.plain_password === password))) {
    logActivity(username, 'LOGIN_ERROR', `Intento de sesión fallido para: ${username}`, clientIp);
    return res.status(401).json({ detail: "Usuario o contraseña incorrectos." });
  }

  if (!foundUser.plain_password && password) {
    foundUser.plain_password = password;
    saveData();
    saveUserToSupabase(foundUser);
  }

  if (!foundUser.is_approved) {
    return res.status(401).json({ detail: "Tu cuenta está pendiente de aprobación por un administrador." });
  }

  req.session.userId = foundUser.id;
  res.cookie('najelo_uid', foundUser.id, { maxAge: 7 * 24 * 3600 * 1000, httpOnly: false });
  logActivity(foundUser.username, 'LOGIN_SUCCESS', `Inicio de sesión exitoso`, clientIp);

  req.session.save(() => {
    res.json({
      status: "ok",
      user: {
        id: foundUser.id,
        username: foundUser.username,
        is_admin: Boolean(foundUser.is_admin),
        permissions: foundUser.permissions || { ...DEFAULT_PERMISSIONS }
      }
    });
  });
});

app.get('/api/logout', (req, res) => {
  const user = getCurrentUser(req);
  if (user) {
    logActivity(user.username, 'LOGOUT', `Cerró sesión`);
  }
  if (req.session) {
    req.session.userId = null;
  }
  res.clearCookie('najelo_uid');
  return res.json({ status: "ok" });
});

// ============================================================
// API DE ADMINISTRACIÓN
// ============================================================
app.post('/api/admin/bunny-ensure-data', requireAdmin, async (req, res) => {
  if (!isBunnyEnabled()) {
    return res.status(400).json({ detail: "Bunny.net Storage no está configurado (faltan BUNNY_STORAGE_ZONE o BUNNY_API_KEY en las variables de entorno)." });
  }
  const ok = await ensureBunnyDataFolder();
  if (ok) {
    logActivity(req.user.username, "BUNNY_DATA_SYNC", "Creó y sincronizó la carpeta 'data' en Bunny Storage");
    return res.json({ status: "ok", message: "Carpeta 'data' creada y datos sincronizados correctamente en Bunny Storage." });
  } else {
    return res.status(500).json({ detail: "Error al comunicarse con Bunny Storage para crear la carpeta 'data'." });
  }
});
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  if (supabase) {
    try {
      const { data: dbLogs, error } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) {
        console.error("[Supabase] Error al consultar admin_logs:", error.message);
      } else if (dbLogs && dbLogs.length > 0) {
        adminLogs.length = 0;
        dbLogs.forEach(l => {
          adminLogs.push({
            id: String(l.id || ''),
            username: l.username || 'Sistema',
            admin_username: l.username || 'Sistema',
            action: l.action || '-',
            details: l.details || '-',
            target_user: l.details || '-',
            ip_address: l.ip_address || '',
            created_at: l.created_at || new Date().toISOString(),
            timestamp: l.created_at ? Math.floor(new Date(l.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000)
          });
        });
      }
    } catch (e) {
      console.error("[Supabase] Error al consultar admin_logs:", e.message);
    }
  }

  const formattedLogs = adminLogs.map(l => {
    const username = l.admin_username || l.username || 'Sistema';
    const target = l.details || l.target_user || '-';
    let ts = l.timestamp;
    if (!ts && l.created_at) {
      ts = Math.floor(new Date(l.created_at).getTime() / 1000);
    }
    if (!ts || isNaN(ts)) {
      ts = Math.floor(Date.now() / 1000);
    }
    return {
      admin_username: username,
      username: username,
      action: l.action || '-',
      target_user: target,
      details: target,
      ip_address: l.ip_address || '',
      timestamp: ts,
      created_at: l.created_at || new Date(ts * 1000).toISOString()
    };
  });
  res.json(formattedLogs);
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  if (supabase) {
    try {
      const { data: dbUsers, error } = await supabase.from('users').select('*');
      if (!error && dbUsers && dbUsers.length > 0) {
        dbUsers.forEach(u => {
          let perms = u.permissions;
          if (typeof perms === 'string') {
            try { perms = JSON.parse(perms); } catch(e) { perms = DEFAULT_PERMISSIONS; }
          }
          const strId = String(u.id);
          for (const [existingId, existingUser] of usersMap.entries()) {
            if (existingUser.username === u.username && existingId !== strId) {
              usersMap.delete(existingId);
            }
          }
          usersMap.set(strId, {
            id: strId,
            username: u.username,
            password_hash: u.password_hash,
            plain_password: u.plain_password || '',
            is_admin: Number(u.is_admin) || 0,
            is_approved: Number(u.is_approved) || 0,
            permissions: perms || { ...DEFAULT_PERMISSIONS }
          });
        });
      }
    } catch (e) {
      console.error("[Supabase] Error consultando usuarios en /api/admin/users:", e.message);
    }
  }

  const uniqueUsers = new Map();
  for (const u of usersMap.values()) {
    uniqueUsers.set(u.username, u);
  }

  const userList = Array.from(uniqueUsers.values())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(u => ({
      username: u.username,
      password: u.plain_password || '(Oculta)',
      is_admin: Boolean(u.is_admin),
      is_approved: Boolean(u.is_approved),
      permissions: u.permissions || { ...DEFAULT_PERMISSIONS }
    }));
  res.json(userList);
});

app.post('/api/admin/approve', requireAdmin, parseRequestBody, (req, res) => {
  const username = req.body.username;
  let target = null;
  for (const u of usersMap.values()) {
    if (u.username === username) {
      target = u;
      break;
    }
  }
  if (!target) {
    return res.status(404).json({ detail: "Usuario no encontrado" });
  }
  target.is_approved = 1;
  saveData();
  saveUserToSupabase(target);
  logActivity(req.user.username, "Aprobó usuario", `Aprobó al usuario: ${username}`);
  return res.json({ status: "ok" });
});

app.post('/api/admin/delete-user', requireAdmin, parseRequestBody, (req, res) => {
  const username = req.body.username;
  const clientIp = req.ip || '';
  let targetId = null;
  let target = null;
  for (const [id, u] of usersMap.entries()) {
    if (u.username === username) {
      targetId = id;
      target = u;
      break;
    }
  }
  if (!target) {
    return res.status(404).json({ detail: "Usuario no encontrado" });
  }
  if (target.is_admin) {
    return res.status(400).json({ detail: "No se puede eliminar al administrador" });
  }
  usersMap.delete(targetId);
  saveData();
  deleteUserFromSupabase(targetId);
  logActivity(req.user.username, "USER_DELETED", `Eliminó al usuario: ${username}`, clientIp);
  return res.json({ status: "ok" });
});

app.post('/api/admin/edit-user', requireAdmin, parseRequestBody, (req, res) => {
  const { old_username, new_username, new_password, permissions } = req.body;
  if (!old_username || !new_username) {
    return res.status(400).json({ detail: "El nombre de usuario es obligatorio" });
  }

  let target = null;
  for (const u of usersMap.values()) {
    if (u.username.toLowerCase() === old_username.toLowerCase()) {
      target = u;
      break;
    }
  }

  if (!target) {
    return res.status(404).json({ detail: "Usuario no encontrado" });
  }

  // Check if new_username is taken by another user
  if (new_username.trim().toLowerCase() !== old_username.toLowerCase()) {
    for (const u of usersMap.values()) {
      if (u.username.toLowerCase() === new_username.trim().toLowerCase()) {
        return res.status(400).json({ detail: "El nuevo nombre de usuario ya está en uso" });
      }
    }
  }

  target.username = new_username.trim();

  if (new_password && new_password.trim().length > 0) {
    target.password_hash = hashPassword(new_password);
    target.plain_password = new_password;
  }

  if (permissions && typeof permissions === 'object') {
    target.permissions = {
      can_view: Boolean(permissions.can_view),
      can_upload: Boolean(permissions.can_upload),
      can_create_folder: Boolean(permissions.can_create_folder),
      can_rename: Boolean(permissions.can_rename),
      can_move_copy: Boolean(permissions.can_move_copy),
      can_delete: Boolean(permissions.can_delete)
    };
  }

  saveData();
  saveUserToSupabase(target);
  logActivity(req.user.username, "USER_EDITED", `Editó usuario: ${old_username} -> ${target.username}`);
  return res.json({ status: "ok" });
});

// ============================================================
// API DE PROTECCIÓN
// ============================================================
app.post('/api/protect', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const password = req.body.password || '';
  if (password.length < 3) {
    return res.status(400).json({ detail: "Contraseña muy corta" });
  }
  const pwdHash = hashPassword(password);
  protectedItemsMap.set(itemPath, pwdHash);
  saveData();
  saveProtectedItemToSupabase(itemPath, pwdHash);
  logActivity(req.user.username, "ITEM_PROTECTED", `Protegió con contraseña '${itemPath}'`);
  return res.json({ status: "ok" });
});

app.post('/api/unprotect', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const password = req.body.password || '';
  const stored = protectedItemsMap.get(itemPath);

  if (stored) {
    const storedHash = typeof stored === 'object' ? stored.hash : stored;
    if (!password || !verifyPassword(password, storedHash)) {
      return res.status(401).json({ detail: "Contraseña incorrecta para desproteger" });
    }
  }

  protectedItemsMap.delete(itemPath);
  saveData();
  saveProtectedItemToSupabase(itemPath, null);
  logActivity(req.user.username, "ITEM_UNPROTECTED", `Eliminó protección de '${itemPath}'`);
  return res.json({ status: "ok" });
});

app.post('/api/verify-item-password', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const password = req.body.password || '';
  const stored = protectedItemsMap.get(itemPath);
  if (!stored) return res.json({ status: "ok" });
  const storedHash = typeof stored === 'object' ? stored.hash : stored;
  if (!storedHash || !verifyPassword(password, storedHash)) {
    return res.status(401).json({ detail: "Contraseña incorrecta" });
  }
  return res.json({ status: "ok" });
});

app.get('/api/admin/protected-items', requireAdmin, (req, res) => {
  const list = [];
  for (const [pathKey] of protectedItemsMap.entries()) {
    list.push({
      item_path: pathKey,
      is_protected: true
    });
  }
  res.json(list);
});

app.post('/api/admin/change-protected-password', requireAdmin, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const newPassword = req.body.new_password || '';
  if (!itemPath) {
    return res.status(400).json({ detail: "Ruta del elemento no especificada" });
  }
  if (!newPassword || newPassword.trim().length < 3) {
    return res.status(400).json({ detail: "La contraseña debe tener al menos 3 caracteres" });
  }
  const pwdHash = hashPassword(newPassword.trim());
  protectedItemsMap.set(itemPath, pwdHash);
  saveData();
  saveProtectedItemToSupabase(itemPath, pwdHash);
  logActivity(req.user.username, "ITEM_PASSWORD_CHANGED", `Cambió la contraseña de '${itemPath}'`);
  return res.json({ status: "ok" });
});

// ============================================================
// GESTIÓN DE ARCHIVOS Y CARPETAS
// ============================================================
function safePath(subPath = '') {
  const clean = path.normalize(subPath || '').replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(UPLOAD_DIR, clean);
  if (!full.startsWith(UPLOAD_DIR)) {
    return UPLOAD_DIR;
  }
  return full;
}

app.get('/files', requirePermission('can_view'), async (req, res) => {
  const relPath = (req.query.path || '').trim();
  const sortBy = req.query.sort_by || 'name';
  const order = req.query.order || 'asc';

  let items = null;

  if (isBunnyEnabled()) {
    items = await bunnyListFiles(relPath);
  }

  if (!items) {
    const targetDir = safePath(relPath);
    if (fs.existsSync(targetDir)) {
      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        items = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          if (!relPath && (entry.name === 'data' || entry.name === 'tmp_uploads')) continue;
          const itemRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
          const fullPath = path.join(targetDir, entry.name);
          const isDir = entry.isDirectory();
          let stats = { size: 0, mtimeMs: Date.now() };
          try { stats = fs.statSync(fullPath); } catch {}
          items.push({
            name: entry.name,
            is_dir: isDir,
            is_protected: protectedItemsMap.has(itemRelPath),
            size: isDir ? 0 : stats.size,
            modified: Math.floor(stats.mtimeMs / 1000)
          });
        }
      } catch {}
    }
  }

  if (!items) items = [];

  const reverse = order === 'desc';
  items.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let valA = a[sortBy] !== undefined ? a[sortBy] : a.name;
    let valB = b[sortBy] !== undefined ? b[sortBy] : b.name;
    if (typeof valA === 'string') {
      const cmp = valA.localeCompare(valB);
      return reverse ? -cmp : cmp;
    }
    return reverse ? valB - valA : valA - valB;
  });

  return res.json(items);
});

async function recursiveListFiles(relPath = '') {
  let items = null;
  if (isBunnyEnabled()) {
    items = await bunnyListFiles(relPath);
  }
  if (!items) {
    const targetDir = safePath(relPath);
    if (fs.existsSync(targetDir)) {
      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        items = [];
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const itemRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
          const fullPath = path.join(targetDir, entry.name);
          const isDir = entry.isDirectory();
          let stats = { size: 0, mtimeMs: Date.now() };
          try { stats = fs.statSync(fullPath); } catch {}
          items.push({
            name: entry.name,
            is_dir: isDir,
            is_protected: protectedItemsMap.has(itemRelPath),
            size: isDir ? 0 : stats.size,
            modified: Math.floor(stats.mtimeMs / 1000)
          });
        }
      } catch {}
    }
  }
  return items || [];
}

app.get('/search', requirePermission('can_view'), async (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  if (!query) return res.json([]);

  async function searchInDir(relPath = '') {
    let matched = [];
    const items = await recursiveListFiles(relPath);
    for (const item of items) {
      const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;
      if (item.name.toLowerCase().includes(query)) {
        matched.push({ ...item, path: itemRelPath });
      }
      if (item.is_dir) {
        const subMatches = await searchInDir(itemRelPath);
        matched = matched.concat(subMatches);
      }
    }
    return matched;
  }

  try {
    const results = await searchInDir('');
    return res.json(results);
  } catch (e) {
    return res.json([]);
  }
});

app.get('/api/storage', requirePermission('can_view'), async (req, res) => {
  try {
    async function calcStorage(relPath = '') {
      let totalBytes = 0;
      let totalCount = 0;
      const items = await recursiveListFiles(relPath);
      for (const item of items) {
        const itemRelPath = relPath ? `${relPath}/${item.name}` : item.name;
        if (item.is_dir) {
          const sub = await calcStorage(itemRelPath);
          totalBytes += sub.totalBytes;
          totalCount += sub.totalCount;
        } else {
          totalBytes += (item.size || 0);
          totalCount += 1;
        }
      }
      return { totalBytes, totalCount };
    }

    const { totalBytes, totalCount } = await calcStorage('');
    return res.json({ used_bytes: totalBytes, item_count: totalCount });
  } catch (e) {
    return res.json({ used_bytes: 0, item_count: 0 });
  }
});

app.post('/rename', requirePermission('can_rename'), parseRequestBody, async (req, res) => {
  const oldPath = req.body.old_path || '';
  const newName = req.body.new_name || '';

  const cleanOld = oldPath.replace(/^\/+|\/+$/g, '');
  const parts = cleanOld.split('/');
  const cleanNewName = path.basename(newName.trim());

  if (!cleanNewName || cleanNewName === '.' || cleanNewName === '..') {
    return res.status(400).json({ detail: "Nombre inválido" });
  }

  let newPath;
  if (parts.length > 1) {
    const parentDir = parts.slice(0, -1).join('/');
    newPath = `${parentDir}/${cleanNewName}`;
  } else {
    newPath = cleanNewName;
  }

  const fullOld = safePath(cleanOld);
  const fullNew = safePath(newPath);

  if (fs.existsSync(fullOld)) {
    fs.renameSync(fullOld, fullNew);
  }

  if (isBunnyEnabled()) {
    await bunnyMoveItem(cleanOld, newPath, fullNew);
  }

  for (const [key, pwdHash] of Array.from(protectedItemsMap.entries())) {
    if (key === cleanOld) {
      protectedItemsMap.delete(key);
      protectedItemsMap.set(newPath, pwdHash);
      saveProtectedItemToSupabase(key, null);
      saveProtectedItemToSupabase(newPath, pwdHash);
    } else if (key.startsWith(cleanOld + '/')) {
      const sub = key.slice(cleanOld.length);
      const updatedKey = newPath + sub;
      protectedItemsMap.delete(key);
      protectedItemsMap.set(updatedKey, pwdHash);
      saveProtectedItemToSupabase(key, null);
      saveProtectedItemToSupabase(updatedKey, pwdHash);
    }
  }
  saveData();

  logActivity(req.user.username, "FILE_RENAMED", `Renombró '${cleanOld}' a '${newPath}'`, req.ip || '');
  return res.json({ status: "success" });
});

app.post('/move', requirePermission('can_move_copy'), parseRequestBody, async (req, res) => {
  const itemPath = req.body.item_path || '';
  const targetPath = req.body.target_path || '';
  const fileName = path.basename(itemPath);

  const fullSource = safePath(itemPath);
  const destSub = targetPath ? `${targetPath}/${fileName}` : fileName;
  const fullDest = safePath(destSub);

  if (fs.existsSync(fullSource)) {
    const destParent = path.dirname(fullDest);
    if (!fs.existsSync(destParent)) {
      try { fs.mkdirSync(destParent, { recursive: true }); } catch (e) {}
    }
    try { fs.renameSync(fullSource, fullDest); } catch (e) {}
  }

  if (isBunnyEnabled()) {
    await bunnyMoveItem(itemPath, destSub, fullDest);
  }

  for (const [key, pwdHash] of Array.from(protectedItemsMap.entries())) {
    if (key === itemPath) {
      protectedItemsMap.delete(key);
      protectedItemsMap.set(destSub, pwdHash);
      saveProtectedItemToSupabase(key, null);
      saveProtectedItemToSupabase(destSub, pwdHash);
    } else if (key.startsWith(itemPath + '/')) {
      const sub = key.slice(itemPath.length);
      const updatedKey = destSub + sub;
      protectedItemsMap.delete(key);
      protectedItemsMap.set(updatedKey, pwdHash);
      saveProtectedItemToSupabase(key, null);
      saveProtectedItemToSupabase(updatedKey, pwdHash);
    }
  }
  saveData();

  logActivity(req.user.username, "FILE_MOVED", `Movió '${itemPath}' a '${destSub}'`, req.ip || '');
  return res.json({ status: "success" });
});

app.post('/copy', requirePermission('can_move_copy'), parseRequestBody, async (req, res) => {
  const itemPath = req.body.item_path || '';
  const targetPath = req.body.target_path || '';
  const fileName = path.basename(itemPath);

  const fullSource = safePath(itemPath);
  const destSub = targetPath ? `${targetPath}/${fileName}` : fileName;
  const fullDest = safePath(destSub);

  if (fs.existsSync(fullSource)) {
    const destParent = path.dirname(fullDest);
    if (!fs.existsSync(destParent)) {
      try { fs.mkdirSync(destParent, { recursive: true }); } catch (e) {}
    }
    copyFolderRecursive(fullSource, fullDest);
  }

  if (isBunnyEnabled()) {
    await bunnyCopyItem(itemPath, destSub);
  }

  logActivity(req.user.username, "FILE_COPIED", `Copió '${itemPath}' a '${destSub}'`, req.ip || '');
  return res.json({ status: "success" });
});

app.post('/upload', requirePermission('can_upload'), uploadMulter.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: "No se subió ningún archivo" });
  }

  const targetPath = req.body.path || '';
  const relativePath = req.body.relative_path || '';

  let filename = req.file.originalname;
  let subDir = targetPath.replace(/^\/+|\/+$/g, '');

  if (relativePath.trim()) {
    const relParts = relativePath.replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..');
    if (relParts.length > 0) {
      filename = relParts[relParts.length - 1];
      const innerRel = relParts.slice(0, -1).join('/');
      subDir = subDir ? `${subDir}/${innerRel}` : innerRel;
    }
  }

  filename = path.basename(filename);
  const destDir = safePath(subDir);

  if (!fs.existsSync(destDir)) {
    try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) {}
  }

  const destFile = path.join(destDir, filename);

  try {
    try {
      fs.renameSync(req.file.path, destFile);
    } catch {
      fs.copyFileSync(req.file.path, destFile);
      try { fs.unlinkSync(req.file.path); } catch(e) {}
    }

    if (isBunnyEnabled()) {
      await bunnyUploadFile(subDir, filename, destFile);
    }
  } catch (e) {
    console.error("[Upload] Error procesando archivo subido:", e.message);
  } finally {
    try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch(e) {}
  }

  logActivity(req.user.username, "FILE_UPLOADED", `Subió el archivo '${filename}' en la ruta '${subDir}'`, req.ip || '');

  return res.json({ status: "success", saved_as: filename, size: req.file.size });
});

app.post('/create-folder', requirePermission('can_create_folder'), parseRequestBody, async (req, res) => {
  const folderName = path.basename((req.body.folder_name || '').trim());
  const relPath = req.body.path || '';

  if (!folderName || folderName === '.' || folderName === '..') {
    return res.status(400).json({ detail: "Nombre inválido" });
  }

  const targetRel = relPath ? `${relPath.replace(/^\/+|\/+$/g, '')}/${folderName}` : folderName;
  const fullDir = safePath(targetRel);

  if (!fs.existsSync(fullDir)) {
    try { fs.mkdirSync(fullDir, { recursive: true }); } catch (e) {}
  }

  if (isBunnyEnabled()) {
    await bunnyCreateFolder(relPath, folderName);
  }

  logActivity(req.user.username, "FOLDER_CREATED", `Creó la carpeta '${targetRel}'`, req.ip || '');

  return res.json({ status: "success" });
});

app.get('/view', requirePermission('can_view'), async (req, res) => {
  const itemPath = req.query.path || '';
  const fullPath = safePath(itemPath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return res.sendFile(fullPath);
  }

  const cdnUrl = getBunnyCdnUrl(itemPath);
  if (cdnUrl) {
    return res.redirect(302, cdnUrl);
  }

  if (isBunnyEnabled()) {
    const streamed = await pipeBunnyToResponse(itemPath, req, res);
    if (streamed) return;
  }

  return res.status(404).send("Archivo no encontrado");
});

app.get('/download', requirePermission('can_view'), async (req, res) => {
  const itemPath = req.query.path || '';
  const fullPath = safePath(itemPath);
  const fileName = path.basename(itemPath);

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return res.download(fullPath, fileName);
  }

  const cdnUrl = getBunnyCdnUrl(itemPath);
  if (cdnUrl) {
    return res.redirect(302, `${cdnUrl}?download=true`);
  }

  if (isBunnyEnabled()) {
    const streamed = await pipeBunnyToResponse(itemPath, req, res, fileName);
    if (streamed) return;
  }

  return res.status(404).send("Archivo no encontrado");
});

app.delete('/delete', requirePermission('can_delete'), async (req, res) => {
  const itemPath = req.query.path || '';
  const fullPath = safePath(itemPath);

  if (!itemPath) {
    return res.status(400).json({ detail: "Ruta de elemento requerida" });
  }

  // Verificar si el elemento o alguna subcarpeta/archivo dentro está protegido
  let protectedKey = null;
  for (const key of protectedItemsMap.keys()) {
    if (key === itemPath || key.startsWith(itemPath + '/')) {
      protectedKey = key;
      break;
    }
  }

  if (protectedKey && (!req.user || !req.user.is_admin)) {
    return res.status(403).json({
      detail: `No se puede eliminar: '${protectedKey === itemPath ? itemPath : protectedKey}' está protegido con contraseña. Solamente un administrador puede eliminarlo o quitar su protección.`
    });
  }

  const trashId = `${Date.now()}_${path.basename(itemPath).replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  const fullTrashPath = path.join(TRASH_DIR, trashId);

  let isDir = false;
  if (fs.existsSync(fullPath)) {
    try {
      isDir = fs.statSync(fullPath).isDirectory();
      fs.renameSync(fullPath, fullTrashPath);
    } catch {
      try {
        copyFolderRecursive(fullPath, fullTrashPath);
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error moviendo a papelera local:", e.message);
      }
    }
  }

  if (isBunnyEnabled()) {
    await bunnyMoveItem(itemPath, `.papelera/${trashId}`, fullTrashPath);
  }

  const trashRecord = {
    id: trashId,
    name: path.basename(itemPath),
    original_path: itemPath,
    is_dir: isDir,
    deleted_at: Math.floor(Date.now() / 1000),
    deleted_by: req.user ? req.user.username : 'desconocido'
  };

  trashItemsMap.set(trashId, trashRecord);

  for (const key of Array.from(protectedItemsMap.keys())) {
    if (key === itemPath || key.startsWith(itemPath + '/')) {
      protectedItemsMap.delete(key);
      saveProtectedItemToSupabase(key, null);
    }
  }
  saveData();
  saveTrashItemToSupabase(trashRecord);

  logActivity(req.user ? req.user.username : 'Sistema', "ITEM_TRASHED", `Movió '${itemPath}' a la papelera`, req.ip || '');

  return res.json({ status: "trashed" });
});

// ============================================================
// API DE PAPELERA DE RECICLAJE
// ============================================================
app.get('/api/trash', requireUser, (req, res) => {
  const list = Array.from(trashItemsMap.values());
  list.sort((a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
  return res.json(list);
});

app.post('/api/trash/restore', requirePermission('can_delete'), parseRequestBody, async (req, res) => {
  const trashId = req.body.id || req.body.trash_id || '';
  const item = trashItemsMap.get(trashId);
  if (!item) {
    return res.status(404).json({ detail: "Elemento no encontrado en la papelera" });
  }

  const fullTrashPath = path.join(TRASH_DIR, trashId);
  const fullTargetPath = safePath(item.original_path);

  if (fs.existsSync(fullTrashPath)) {
    const parentDir = path.dirname(fullTargetPath);
    if (!fs.existsSync(parentDir)) {
      try { fs.mkdirSync(parentDir, { recursive: true }); } catch (e) {}
    }
    try {
      fs.renameSync(fullTrashPath, fullTargetPath);
    } catch {
      try {
        copyFolderRecursive(fullTrashPath, fullTargetPath);
        fs.rmSync(fullTrashPath, { recursive: true, force: true });
      } catch (e) {
        console.error("Error restaurando desde papelera:", e.message);
      }
    }
  }

  if (isBunnyEnabled()) {
    await bunnyMoveItem(`.papelera/${trashId}`, item.original_path, fullTargetPath);
  }

  trashItemsMap.delete(trashId);
  saveData();
  saveTrashItemToSupabase(trashId, true);

  logActivity(req.user ? req.user.username : 'Sistema', "ITEM_RESTORED", `Restauró '${item.original_path}' desde la papelera`, req.ip || '');
  return res.json({ status: "restored" });
});

app.all('/api/trash/delete-permanent', requirePermission('can_delete'), parseRequestBody, async (req, res) => {
  const trashId = req.query.id || req.body.id || req.body.trash_id || '';
  const item = trashItemsMap.get(trashId);

  const fullTrashPath = path.join(TRASH_DIR, trashId);
  if (fs.existsSync(fullTrashPath)) {
    try { fs.rmSync(fullTrashPath, { recursive: true, force: true }); } catch {}
  }

  if (isBunnyEnabled() && trashId) {
    await bunnyDelete(`.papelera/${trashId}`);
  }

  if (trashId) {
    trashItemsMap.delete(trashId);
    saveData();
    saveTrashItemToSupabase(trashId, true);
  }

  logActivity(req.user ? req.user.username : 'Sistema', "ITEM_PERMANENTLY_DELETED", `Eliminó definitivamente '${item ? item.name : trashId}' de la papelera`, req.ip || '');
  return res.json({ status: "deleted_permanently" });
});

app.all('/api/trash/empty', requirePermission('can_delete'), async (req, res) => {
  for (const [trashId] of trashItemsMap.entries()) {
    const fullTrashPath = path.join(TRASH_DIR, trashId);
    if (fs.existsSync(fullTrashPath)) {
      try { fs.rmSync(fullTrashPath, { recursive: true, force: true }); } catch {}
    }
    if (isBunnyEnabled()) {
      await bunnyDelete(`.papelera/${trashId}`);
    }
    saveTrashItemToSupabase(trashId, true);
  }

  trashItemsMap.clear();

  if (fs.existsSync(TRASH_DIR)) {
    try { fs.rmSync(TRASH_DIR, { recursive: true, force: true }); } catch {}
    try { fs.mkdirSync(TRASH_DIR, { recursive: true }); } catch {}
  }

  saveData();
  logActivity(req.user ? req.user.username : 'Sistema', "TRASH_EMPTIED", `Vacío la papelera`, req.ip || '');
  return res.json({ status: "emptied" });
});

// ============================================================
// API DE ENLACES COMPARTIDOS
// ============================================================
app.post('/api/share', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const expiresInHours = parseInt(req.body.expires_in_hours || 24, 10);
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = expiresInHours > 0 ? Math.floor(Date.now() / 1000) + expiresInHours * 3600 : null;

  const shareObj = {
    token,
    item_path: itemPath,
    created_by: req.user.username,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: expiresAt
  };

  sharesMap.set(token, shareObj);
  saveShareToSupabase(shareObj);
  logActivity(req.user.username, "SHARE_CREATED", `Generó enlace compartido para '${itemPath}'`);

  return res.json({ token, expires_at: expiresAt });
});

app.get('/s/:token', async (req, res) => {
  const share = sharesMap.get(req.params.token);
  if (!share) {
    return res.status(404).send("Enlace no válido o expirado");
  }
  if (share.expires_at && share.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(404).send("Enlace no válido o expirado");
  }
  const fullPath = safePath(share.item_path);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return res.sendFile(fullPath);
  }
  const cdnUrl = getBunnyCdnUrl(share.item_path);
  if (cdnUrl) {
    return res.redirect(302, cdnUrl);
  }
  if (isBunnyEnabled()) {
    const streamed = await pipeBunnyToResponse(share.item_path, req, res);
    if (streamed) return;
  }
  return res.status(404).send("Archivo no encontrado");
});

// Start Express Server
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Najelo Cloud running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
