const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const tmpUploadDir = path.join(__dirname, 'tmp_uploads');
if (!fs.existsSync(tmpUploadDir)) {
  fs.mkdirSync(tmpUploadDir, { recursive: true });
}
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
// UTILIDADES DE CONTRASEÑA
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
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROTECTED_FILE = path.join(DATA_DIR, 'protected.json');

const usersMap = new Map();
const adminLogs = [];
const protectedItemsMap = new Map();
const sharesMap = new Map();

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

    return items.map(item => {
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

async function bunnyUploadFile(relPath, fileName, buffer) {
  if (!isBunnyEnabled()) return false;
  try {
    const fullRel = relPath ? `${relPath}/${fileName}` : fileName;
    const url = getBunnyUrl(fullRel);
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'AccessKey': BUNNY_API_KEY,
        'Content-Type': 'application/octet-stream'
      },
      body: buffer
    });
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

async function bunnyDownloadBuffer(relPath) {
  if (!isBunnyEnabled()) return null;
  try {
    const url = getBunnyUrl(relPath);
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'AccessKey': BUNNY_API_KEY }
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (e) {
    console.error("[BunnyStorage] Error descargando archivo:", e.message);
    return null;
  }
}

async function bunnyCopyItem(oldRelPath, newRelPath) {
  if (!isBunnyEnabled()) return false;
  try {
    const cleanOld = (oldRelPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const cleanNew = (newRelPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!cleanOld || !cleanNew || cleanOld === cleanNew) return false;

    // Intentar como archivo descargando buffer
    const buf = await bunnyDownloadBuffer(cleanOld);
    if (buf !== null) {
      const newParts = cleanNew.split('/');
      const fileName = newParts.pop();
      const parentDir = newParts.join('/');
      return await bunnyUploadFile(parentDir, fileName, buf);
    }

    // Si no es un archivo, intentar como directorio listando elementos
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
  } catch (e) {
    console.error("[BunnyStorage] Error copiando en Bunny:", e.message);
    return false;
  }
}

async function bunnyMoveItem(oldRelPath, newRelPath) {
  if (!isBunnyEnabled()) return false;
  try {
    const success = await bunnyCopyItem(oldRelPath, newRelPath);
    if (success) {
      await bunnyDelete(oldRelPath);
      return true;
    }
    return false;
  } catch (e) {
    console.error("[BunnyStorage] Error moviendo/renombrando en Bunny:", e.message);
    return false;
  }
}

// Carga y guardado local JSON
function loadLocalData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const usersArr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(usersArr)) {
        usersArr.forEach(u => usersMap.set(u.id, u));
      }
    }
  } catch (e) {
    console.error("Error cargando usuarios locales:", e.message);
  }
  try {
    if (fs.existsSync(PROTECTED_FILE)) {
      const protectedArr = JSON.parse(fs.readFileSync(PROTECTED_FILE, 'utf8'));
      if (Array.isArray(protectedArr)) {
        protectedArr.forEach(p => protectedItemsMap.set(p.item_path || p.path, p.password_hash || p.hash));
      }
    }
  } catch (e) {
    console.error("Error cargando protecciones locales:", e.message);
  }
}

function saveData() {
  try {
    const usersArr = Array.from(usersMap.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersArr, null, 2), 'utf8');
    const protectedArr = Array.from(protectedItemsMap.entries()).map(([k, v]) => ({ item_path: k, password_hash: v }));
    fs.writeFileSync(PROTECTED_FILE, JSON.stringify(protectedArr, null, 2), 'utf8');
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
      await supabase.from('protected_items').upsert({ item_path: itemPath, password_hash: passwordHash }, { onConflict: 'item_path' });
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

// Cargar estado inicial
loadLocalData();
syncWithSupabase();
saveData();

// ============================================================
// MIDDLEWARE CONFIGURACIÓN
// ============================================================
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  if (adminLogs.length > 100) adminLogs.pop();

  if (supabase) {
    supabase.from('admin_logs').insert([logObj]).then().catch(() => {});
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
  if (req.session) {
    req.session.userId = null;
  }
  res.clearCookie('najelo_uid');
  return res.json({ status: "ok" });
});

// Helper para copiar directorios de forma recursiva
function copyFolderRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyFolderRecursive(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ============================================================
// API DE ADMINISTRACIÓN
// ============================================================
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const formattedLogs = adminLogs.map(l => {
    const username = l.admin_username || l.username || 'Sistema';
    const target = l.target_user || l.details || '-';
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
      timestamp: ts,
      created_at: l.created_at || new Date().toISOString()
    };
  });
  res.json(formattedLogs);
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const userList = Array.from(usersMap.values())
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
  return res.json({ status: "ok" });
});

app.post('/api/unprotect', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  protectedItemsMap.delete(itemPath);
  saveData();
  saveProtectedItemToSupabase(itemPath, null);
  return res.json({ status: "ok" });
});

app.post('/api/verify-item-password', requireUser, parseRequestBody, (req, res) => {
  const itemPath = req.body.item_path;
  const password = req.body.password || '';
  const storedHash = protectedItemsMap.get(itemPath);
  if (!storedHash || !verifyPassword(password, storedHash)) {
    return res.status(401).json({ detail: "Contraseña incorrecta" });
  }
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
    await bunnyMoveItem(cleanOld, newPath);
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
    if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
    fs.renameSync(fullSource, fullDest);
  }

  if (isBunnyEnabled()) {
    await bunnyMoveItem(itemPath, destSub);
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
    if (!fs.existsSync(destParent)) fs.mkdirSync(destParent, { recursive: true });
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
    fs.mkdirSync(destDir, { recursive: true });
  }

  const destFile = path.join(destDir, filename);
  fs.copyFileSync(req.file.path, destFile);

  if (isBunnyEnabled()) {
    try {
      const fileBuf = fs.readFileSync(req.file.path);
      await bunnyUploadFile(subDir, filename, fileBuf);
    } catch (e) {
      console.error("[BunnyStorage] Upload error:", e.message);
    }
  }

  try { fs.unlinkSync(req.file.path); } catch(e) {}

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
    fs.mkdirSync(fullDir, { recursive: true });
  }

  if (isBunnyEnabled()) {
    await bunnyCreateFolder(relPath, folderName);
  }

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
    const buf = await bunnyDownloadBuffer(itemPath);
    if (buf) {
      return res.send(buf);
    }
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
    const buf = await bunnyDownloadBuffer(itemPath);
    if (buf) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      return res.send(buf);
    }
  }

  return res.status(404).send("Archivo no encontrado");
});

app.delete('/delete', requirePermission('can_delete'), async (req, res) => {
  const itemPath = req.query.path || '';
  const fullPath = safePath(itemPath);

  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }

  if (isBunnyEnabled()) {
    await bunnyDelete(itemPath);
  }

  for (const key of protectedItemsMap.keys()) {
    if (key === itemPath || key.startsWith(itemPath + '/')) {
      protectedItemsMap.delete(key);
      saveProtectedItemToSupabase(key, null);
    }
  }
  saveData();

  return res.json({ status: "deleted" });
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
    const buf = await bunnyDownloadBuffer(share.item_path);
    if (buf) {
      return res.send(buf);
    }
  }
  return res.status(404).send("Archivo no encontrado");
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Najelo Cloud running on http://0.0.0.0:${PORT}`);
});
