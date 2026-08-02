// Interceptor de Fetch para enviar X-User-Id
const originalFetch = window.fetch;
window.fetch = function(input, init) {
    init = init || {};
    const uid = localStorage.getItem('najelo_user_id');
    if (uid) {
        if (typeof input === 'string' || input instanceof URL) {
            if (!init.headers) {
                init.headers = { 'X-User-Id': uid };
            } else if (init.headers instanceof Headers) {
                init.headers.set('X-User-Id', uid);
            } else if (Array.isArray(init.headers)) {
                init.headers.push(['X-User-Id', uid]);
            } else {
                init.headers['X-User-Id'] = uid;
            }
        } else if (input instanceof Request) {
            try {
                input.headers.set('X-User-Id', uid);
            } catch (e) {}
        }
    }
    return originalFetch.call(this, input, init);
};

// ============================================================
// VARIABLES GLOBALES Y CONFIGURACIÓN INICIAL
// ============================================================
let currentSubPath = "";
let selectedItem = null;
let selectedItemMeta = null; // { is_dir, is_protected } del elemento del menú contextual
let allFilesData = [];
let currentDisplayedItems = []; // items actualmente pintados (incluye "path" ya resuelto)
let currentUserIsAdmin = false;
let currentViewMode = "grid";
let isSearchMode = false;

let sortBy = "name";
let sortOrder = "asc";

// Selección múltiple
let selectedPaths = new Set();
let lastSelectedIndex = null;
let selectionModeActive = false;

// Portapapeles interno (Copiar / Mover) — siempre arrays de rutas
let clipboardItems = null;
let clipboardAction = null; // "copy" o "move"

// Subida de archivos
let uploadQueue = [];
let activeUploads = 0;
const MAX_CONCURRENT_UPLOADS = 3;
let uploadIdCounter = 0;
let filesRefreshTimer = null;

// Modal de confirmación genérico
let confirmResolver = null;
let searchDebounceTimer = null;
let deferredThumbObserver = null;

document.addEventListener("DOMContentLoaded", () => {
    sortBy = localStorage.getItem('najelo-sort-by') || 'name';
    sortOrder = localStorage.getItem('najelo-sort-order') || 'asc';
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = sortBy;
    updateSortDirIcon();

    currentViewMode = localStorage.getItem('najelo-view-mode') || 'grid';
    const startPath = localStorage.getItem('najelo-last-path') || "";

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = "";
    setTimeout(() => { if (searchInput) searchInput.value = ""; }, 100);

    loadFiles(startPath);
    checkAdminStatus();
    applyViewMode();
    initTheme();
    initDragAndDrop();
    refreshStorage();

    document.addEventListener("click", (e) => {
        if (!e.target.closest('.new-dropdown-container') && !e.target.closest('#context-menu') && !e.target.closest('.card-menu-btn')) {
            hideAllMenus();
        }
        if (!e.target.closest('aside') && !e.target.closest('#sidebar-toggle-btn')) {
            document.querySelector('aside')?.classList.remove('open');
        }
    });

    document.addEventListener('keydown', handleKeydown);
});

// ============================================================
// FUNCIONES DE ESTADO Y UTILIDADES
// ============================================================
async function checkAdminStatus() {
    try {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
            currentUserIsAdmin = true;
            const adminBtn = document.getElementById('admin-panel-btn');
            if (adminBtn) adminBtn.style.display = 'flex';
        }
    } catch (e) {}
}

function scheduleFilesRefresh() {
    clearTimeout(filesRefreshTimer);
    filesRefreshTimer = setTimeout(() => loadFiles(currentSubPath), 350);
}

function isMobileView() {
    return window.matchMedia('(max-width: 860px)').matches;
}

function attachLongPress(el, callback) {
    let timer = null;
    let fired = false;
    el.addEventListener('touchstart', () => {
        fired = false;
        timer = setTimeout(() => {
            fired = true;
            if (navigator.vibrate) navigator.vibrate(15);
            callback();
        }, 450);
    }, { passive: true });
    const cancel = (e) => {
        if (timer) clearTimeout(timer);
        if (fired && e) e.preventDefault();
    };
    el.addEventListener('touchend', cancel, { passive: false });
    el.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
    el.addEventListener('touchcancel', () => clearTimeout(timer), { passive: true });
}

// ============================================================
// CARGA Y RENDER DE ARCHIVOS
// ============================================================
async function loadFiles(path = "") {
    currentSubPath = path;
    isSearchMode = false;
    hideAllMenus();
    clearSelection();
    document.getElementById('nav-drive')?.classList.add('active');
    document.getElementById('nav-trash')?.classList.remove('active');
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = "";

    localStorage.setItem('najelo-last-path', path);
    renderSkeleton();

    try {
        const res = await fetch(`/files?path=${encodeURIComponent(path)}&sort_by=${sortBy}&order=${sortOrder}`);
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        allFilesData = await res.json();
        renderFiles(allFilesData);
        renderBreadcrumbs(path);
    } catch (err) {
        console.error("Error cargando archivos:", err);
        showToast("No se pudieron cargar los archivos", "error");
    }
}

function goToDrive() {
    loadFiles("");
}

function renderSkeleton() {
    const gridContainer = document.getElementById('file-container');
    const listTbody = document.getElementById('list-tbody');
    if (gridContainer) {
        gridContainer.innerHTML = Array.from({ length: 8 }).map(() => `<div class="skeleton-card"></div>`).join('');
    }
    if (listTbody) {
        listTbody.innerHTML = Array.from({ length: 6 }).map(() => `
            <tr class="skeleton-row">
                <td colspan="6"><div class="skeleton-line" style="width: 100%;"></div></td>
            </tr>`).join('');
    }
}

function resolvedPath(file) {
    if (!file) return "";
    if (file.path !== undefined && file.path !== null) return String(file.path);
    const name = file.name || "";
    return currentSubPath ? `${currentSubPath}/${name}` : name;
}

function getIconAndType(file) {
    let iconClass = "ri-file-text-line";
    let typeName = "Archivo";
    if (!file) return { iconClass, typeName };
    const name = file.name || "";
    if (file.is_dir) {
        iconClass = "ri-folder-fill";
        typeName = "Carpeta";
    } else if (name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        iconClass = "ri-image-line"; typeName = "Imagen";
    } else if (name.match(/\.(mp4|webm|ogg)$/i)) {
        iconClass = "ri-video-line"; typeName = "Video";
    } else if (name.match(/\.(pdf)$/i)) {
        iconClass = "ri-file-pdf-line"; typeName = "Documento PDF";
    } else if (name.match(/\.(csv)$/i)) {
        iconClass = "ri-file-chart-line"; typeName = "Hoja CSV";
    } else if (name.match(/\.(zip|rar|7z|tar|gz)$/i)) {
        iconClass = "ri-file-zip-line"; typeName = "Comprimido";
    } else if (name.match(/\.(py|js|html|css|json|md|sql|java|c|cpp|ts|jsx)$/i)) {
        iconClass = "ri-code-s-slash-line"; typeName = "Código";
    }
    return { iconClass, typeName };
}

// ============================================================
// MINIATURAS DIFERIDAS
// ============================================================
function getThumbObserver() {
    if (!deferredThumbObserver) {
        deferredThumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    deferredThumbObserver.unobserve(entry.target);
                    loadDeferredThumbnail(entry.target);
                }
            });
        }, { rootMargin: '250px' });
    }
    return deferredThumbObserver;
}

function observeDeferredThumbnails() {
    const observer = getThumbObserver();
    document.querySelectorAll('.card-thumbnail[data-thumb-type]').forEach(el => observer.observe(el));
}

async function loadDeferredThumbnail(el) {
    const type = el.dataset.thumbType;
    const url = el.dataset.thumbUrl;
    if (!type || !url) return;

    try {
        if (type === 'pdf') {
            if (!window.pdfjsLib) return;
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument(url).promise;
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(el.clientWidth / viewport.width, (el.clientHeight || 95) / viewport.height) * 2;
            const scaledViewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport }).promise;
            el.innerHTML = '';
            el.appendChild(canvas);
        } else if (type === 'text') {
            const res = await fetch(url, { headers: { Range: 'bytes=0-600' } });
            if (!res.ok && res.status !== 206) return;
            let text = await res.text();
            text = text.slice(0, 500);
            const pre = document.createElement('pre');
            pre.className = 'thumb-text-preview';
            pre.textContent = text;
            el.innerHTML = '';
            el.appendChild(pre);
        }
    } catch (e) {}
}

function renderFiles(files) {
    const gridContainer = document.getElementById('file-container');
    const listTbody = document.getElementById('list-tbody');
    if (!gridContainer || !listTbody) return;

    if (!Array.isArray(files)) {
        files = [];
    }
    files = files.filter(f => f && typeof f === 'object');

    currentDisplayedItems = files.map(f => ({ ...f, path: resolvedPath(f) }));

    gridContainer.innerHTML = "";
    listTbody.innerHTML = "";

    if (currentDisplayedItems.length === 0) {
        const msg = isSearchMode ? "No se encontraron resultados" : "Esta carpeta está vacía";
        gridContainer.innerHTML = `<div class="empty-state"><i class="${isSearchMode ? 'ri-search-line' : 'ri-folder-open-line'}"></i><p>${msg}</p></div>`;
        listTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-secondary); padding: 30px;">${msg}</td></tr>`;
        return;
    }

    currentDisplayedItems.forEach((file, index) => {
        const { iconClass, typeName } = getIconAndType(file);
        const fullPath = file.path || file.name || "";
        const safeEscapedPath = fullPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const fileName = file.name || fullPath.split('/').pop() || 'Sin nombre';
        const lockBadge = file.is_protected ? `<i class="ri-lock-fill" style="color: var(--primary);" title="Protegido con clave"></i>` : '';
        const subtitle = isSearchMode ? `<div style="font-size:11px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:115px;">${fullPath}</div>` : '';

        // Tarjeta Grid
        const card = document.createElement('div');
        card.className = 'card' + (selectedPaths.has(fullPath) ? ' selected' : '');
        card.draggable = true;
        const fileUrl = `/view?path=${encodeURIComponent(fullPath)}`;

        let thumbContent = `<i class="${iconClass}"></i>`;
        let deferredThumb = null;
        if (!file.is_dir && !file.is_protected && fileName) {
            if (fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
                thumbContent = `<img src="${fileUrl}" loading="lazy">`;
            } else if (fileName.match(/\.(mp4|webm|ogg)$/i)) {
                thumbContent = `<video muted preload="metadata" src="${fileUrl}#t=0.5"></video>`;
            } else if (fileName.match(/\.(pdf)$/i)) {
                deferredThumb = { type: 'pdf', url: fileUrl };
            } else if (fileName.match(/\.(txt|md|py|js|html|css|json|sql|java|c|cpp|ts|jsx|csv|log|yml|yaml)$/i)) {
                deferredThumb = { type: 'text', url: fileUrl };
            }
        }

        card.innerHTML = `
            <input type="checkbox" class="card-select" ${selectedPaths.has(fullPath) ? 'checked' : ''}>
            <div class="card-thumbnail"${deferredThumb ? ` data-thumb-type="${deferredThumb.type}" data-thumb-url="${deferredThumb.url}"` : ''}>${thumbContent}</div>
            <div class="card-footer">
                <div style="overflow:hidden;">
                    <span class="card-name" title="${fileName}">${fileName}</span>
                    ${subtitle}
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    ${lockBadge}
                    <button class="card-menu-btn" onclick="openCardMenu(event, '${safeEscapedPath}')"><i class="ri-more-2-fill"></i></button>
                </div>
            </div>
        `;

        card.querySelector('.card-select').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleItemSelection(fullPath, index, false);
        });
        card.addEventListener('click', (e) => {
            if (e.target.closest('.card-menu-btn') || e.target.closest('.card-select')) return;
            if (selectionModeActive || selectedPaths.size > 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
                handleItemClick(e, fullPath, index);
            } else {
                handleOpenItem(fullPath, file.is_dir);
            }
        });
        card.addEventListener('dblclick', (e) => {
            if (e.target.closest('.card-menu-btn') || e.target.closest('.card-select')) return;
            handleOpenItem(fullPath, file.is_dir);
        });
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectItemForMenu(file, fullPath);
            showContextMenu(e.clientX, e.clientY);
        });
        attachLongPress(card, () => toggleItemSelection(fullPath, index, false));
        attachDragHandlers(card, fullPath, file.is_dir);
        gridContainer.appendChild(card);

        // Fila Lista
        const tr = document.createElement('tr');
        tr.className = selectedPaths.has(fullPath) ? 'selected' : '';
        tr.draggable = true;
        tr.innerHTML = `
            <td class="checkbox-col"><input type="checkbox" ${selectedPaths.has(fullPath) ? 'checked' : ''}></td>
            <td style="display: flex; align-items: center; gap: 10px;">
                <i class="${iconClass}" style="font-size: 18px; color: ${file.is_dir ? '#fbbc05' : 'var(--text-secondary)'};"></i>
                <span style="font-weight: 500;">${fileName}</span>
                ${isSearchMode ? `<span style="font-size:11px; color:var(--text-secondary);">${fullPath}</span>` : ''}
                ${lockBadge}
            </td>
            <td>${typeName}</td>
            <td class="col-meta">${file.is_dir ? '—' : formatBytes(file.size || 0)}</td>
            <td class="col-meta">${formatDate(file.modified || 0)}</td>
            <td><button onclick="openCardMenu(event, '${safeEscapedPath}')" style="background:none; border:none; cursor:pointer; color:var(--text-secondary); font-size:16px;"><i class="ri-more-fill"></i></button></td>
        `;
        tr.querySelector('input[type=checkbox]').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleItemSelection(fullPath, index, false);
        });
        tr.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            if (selectionModeActive || selectedPaths.size > 0 || e.ctrlKey || e.metaKey || e.shiftKey) {
                handleItemClick(e, fullPath, index);
            } else {
                handleOpenItem(fullPath, file.is_dir);
            }
        });
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectItemForMenu(file, fullPath);
            showContextMenu(e.clientX, e.clientY);
        });
        attachLongPress(tr, () => toggleItemSelection(fullPath, index, false));
        attachDragHandlers(tr, fullPath, file.is_dir);
        listTbody.appendChild(tr);
    });

    updateSelectionUI();
    observeDeferredThumbnails();
}

function selectItemForMenu(file, fullPath) {
    selectedItem = fullPath;
    selectedItemMeta = { is_dir: file.is_dir, is_protected: !!file.is_protected };
}

async function handleOpenItem(itemPath, isDir) {
    const targetFile = currentDisplayedItems.find(f => f.path === itemPath);

    if (targetFile && targetFile.is_protected) {
        const pwd = prompt("Este elemento está protegido con contraseña:");
        if (!pwd) return;
        const form = new FormData();
        form.append("item_path", itemPath);
        form.append("password", pwd);
        const checkRes = await fetch('/api/verify-item-password', { method: 'POST', body: form });
        if (!checkRes.ok) {
            showToast("Contraseña incorrecta", "error");
            return;
        }
    }

    if (isDir) {
        loadFiles(itemPath);
    } else {
        selectedItem = itemPath;
        openViewer(targetFile ? targetFile.name : itemPath.split('/').pop());
    }
}

function renderBreadcrumbs(path) {
    const bar = document.getElementById('path-bar');
    if (!bar) return;
    let html = `<i class="ri-home-4-line"></i> <span style="cursor:pointer;" onclick="loadFiles('')">Mi Unidad</span>`;

    if (path) {
        const parts = path.split('/');
        let builtPath = "";
        parts.forEach(part => {
            builtPath = builtPath ? `${builtPath}/${part}` : part;
            html += ` <i class="ri-arrow-right-s-line" style="font-size: 14px; color: var(--text-secondary);"></i> <span style="cursor:pointer;" onclick="loadFiles('${builtPath}')">${part}</span>`;
        });
    }
    bar.innerHTML = html;
}

// ============================================================
// BÚSQUEDA Y ORDENAMIENTO
// ============================================================
function filterFiles() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;
    const query = searchInput.value.trim();

    clearTimeout(searchDebounceTimer);
    if (!query) {
        isSearchMode = false;
        renderFiles(allFilesData);
        renderBreadcrumbs(currentSubPath);
        return;
    }

    searchDebounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) return;
            const results = await res.json();
            isSearchMode = true;
            const bar = document.getElementById('path-bar');
            if (bar) bar.innerHTML = `<i class="ri-search-line"></i> <span>Resultados para "${query}"</span>`;
            renderFiles(results);
        } catch (e) {
            showToast("Error al buscar", "error");
        }
    }, 300);
}

function setSort(field) {
    if (sortBy === field) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        sortBy = field;
        sortOrder = 'asc';
    }
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = sortBy;
    persistSort();
    updateSortDirIcon();
    loadFiles(currentSubPath);
}

function onSortChange() {
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortBy = sortSelect.value;
    persistSort();
    loadFiles(currentSubPath);
}

function toggleSortDir() {
    sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    persistSort();
    updateSortDirIcon();
    loadFiles(currentSubPath);
}

function updateSortDirIcon() {
    const icon = document.getElementById('sort-dir-icon');
    if (icon) icon.className = sortOrder === 'asc' ? 'ri-sort-asc' : 'ri-sort-desc';
}

function persistSort() {
    localStorage.setItem('najelo-sort-by', sortBy);
    localStorage.setItem('najelo-sort-order', sortOrder);
}

// ============================================================
// SELECCIÓN MÚLTIPLE
// ============================================================
function toggleSelectionMode() {
    if (selectionModeActive || selectedPaths.size > 0) {
        clearSelection();
    } else {
        selectionModeActive = true;
        updateSelectionUI();
    }
}

function toggleItemSelection(path) {
    if (selectedPaths.has(path)) selectedPaths.delete(path);
    else selectedPaths.add(path);
    updateSelectionUI();
}

function handleItemClick(e, path, index) {
    if (e.shiftKey && lastSelectedIndex !== null) {
        const [start, end] = [lastSelectedIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) {
            if (currentDisplayedItems[i]) selectedPaths.add(currentDisplayedItems[i].path);
        }
    } else if (e.ctrlKey || e.metaKey) {
        toggleItemSelection(path);
        lastSelectedIndex = index;
        return;
    } else {
        selectedPaths = new Set([path]);
        lastSelectedIndex = index;
    }
    updateSelectionUI();
}

function toggleSelectAll(checkbox) {
    if (checkbox.checked) {
        selectedPaths = new Set(currentDisplayedItems.map(f => f.path));
    } else {
        selectedPaths.clear();
    }
    updateSelectionUI();
}

function clearSelection() {
    selectedPaths.clear();
    lastSelectedIndex = null;
    selectionModeActive = false;
    updateSelectionUI();
}

function updateSelectionUI() {
    document.querySelectorAll('.card').forEach((card, i) => {
        const path = currentDisplayedItems[i]?.path;
        const isSel = path && selectedPaths.has(path);
        card.classList.toggle('selected', !!isSel);
        const cb = card.querySelector('.card-select');
        if (cb) cb.checked = !!isSel;
    });
    document.querySelectorAll('#list-tbody tr').forEach((tr, i) => {
        const path = currentDisplayedItems[i]?.path;
        const isSel = path && selectedPaths.has(path);
        tr.classList.toggle('selected', !!isSel);
        const cb = tr.querySelector('input[type=checkbox]');
        if (cb) cb.checked = !!isSel;
    });

    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-bar-count');
    if (bar && count) {
        if (selectedPaths.size > 0) {
            bar.classList.add('show');
            count.textContent = `${selectedPaths.size} seleccionado${selectedPaths.size > 1 ? 's' : ''}`;
        } else {
            bar.classList.remove('show');
        }
    }
    document.querySelector('.content-body')?.classList.toggle('has-bulk-bar', selectedPaths.size > 0);

    const showCheckboxes = selectionModeActive || selectedPaths.size > 0;
    document.getElementById('file-container')?.classList.toggle('selecting', showCheckboxes);
    document.getElementById('list-file-container')?.classList.toggle('selecting', showCheckboxes);
    const selBtn = document.getElementById('selection-mode-btn');
    if (selBtn) {
        selBtn.classList.toggle('active', showCheckboxes);
        selBtn.innerHTML = showCheckboxes
            ? '<i class="ri-close-line"></i><span class="btn-label"> Cancelar</span>'
            : '<i class="ri-checkbox-multiple-line"></i><span class="btn-label"> Seleccionar</span>';
    }

    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) {
        const total = currentDisplayedItems.length;
        selectAll.checked = total > 0 && selectedPaths.size === total;
        selectAll.indeterminate = selectedPaths.size > 0 && selectedPaths.size < total;
    }
}

async function bulkDownload() {
    const paths = Array.from(selectedPaths);
    paths.forEach((p, i) => {
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = `/download?path=${encodeURIComponent(p)}`;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
        }, i * 400);
    });
}

function bulkMove() {
    openMoveModal(Array.from(selectedPaths), 'move');
}

function bulkCopy() {
    openMoveModal(Array.from(selectedPaths), 'copy');
}

async function bulkDelete() {
    const paths = Array.from(selectedPaths);
    if (paths.length === 0) return;
    const ok = await showConfirm(`¿Eliminar ${paths.length} elemento(s)? Se moverán a la papelera.`, { title: "Eliminar elementos" });
    if (!ok) return;

    let okCount = 0;
    for (const p of paths) {
        try {
            const res = await fetch(`/delete?path=${encodeURIComponent(p)}`, { method: 'DELETE' });
            if (res.ok) okCount++;
        } catch (e) {}
    }
    showToast(`${okCount} elemento(s) movidos a la papelera`, "success");
    clearSelection();
    loadFiles(currentSubPath);
    refreshStorage();
}

// ============================================================
// VISTAS Y TEMA
// ============================================================
function toggleViewMode() {
    currentViewMode = currentViewMode === 'grid' ? 'list' : 'grid';
    localStorage.setItem('najelo-view-mode', currentViewMode);
    applyViewMode();
}

function applyViewMode() {
    const grid = document.getElementById('file-container');
    const list = document.getElementById('list-file-container');
    const icon = document.getElementById('view-toggle-icon');
    if (!grid || !list) return;

    if (currentViewMode === 'grid') {
        grid.style.display = 'grid';
        list.style.display = 'none';
        if (icon) icon.className = 'ri-list-check';
    } else {
        grid.style.display = 'none';
        list.style.display = 'table';
        if (icon) icon.className = 'ri-grid-line';
    }
}

function initTheme() {
    const saved = localStorage.getItem('najelo-theme') || 'light';
    setTheme(saved);
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
}

function setTheme(theme) {
    const root = document.documentElement;
    const icon = document.getElementById('theme-toggle-icon');
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        if (icon) icon.className = 'ri-sun-line';
    } else {
        root.removeAttribute('data-theme');
        if (icon) icon.className = 'ri-moon-line';
    }
    localStorage.setItem('najelo-theme', theme);
}

function toggleSidebar() {
    document.querySelector('aside')?.classList.toggle('open');
}

// ============================================================
// MENÚS FLOTANTES Y MENÚ CONTEXTUAL
// ============================================================
function openNewMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('new-dropdown');
    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
}

function showContextMenu(x, y) {
    hideAllMenus();
    updateContextMenuOptions();
    const menu = document.getElementById('context-menu');
    const backdrop = document.getElementById('context-menu-backdrop');
    if (!menu) return;

    if (isMobileView()) {
        menu.classList.add('as-sheet');
        menu.style.top = '';
        menu.style.left = '';
        menu.style.display = 'flex';
        if (backdrop) backdrop.classList.add('show');
    } else {
        menu.classList.remove('as-sheet');
        menu.style.display = 'flex';
        const maxX = window.innerWidth - 200;
        const maxY = window.innerHeight - 360;
        menu.style.top = `${Math.min(y, maxY > 0 ? maxY : y)}px`;
        menu.style.left = `${Math.min(x, maxX > 0 ? maxX : x)}px`;
    }
}

function updateContextMenuOptions() {
    if (!selectedItemMeta) return;
    const { is_dir, is_protected } = selectedItemMeta;
    const set = (id, visible) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? 'flex' : 'none';
    };
    set('ctx-view', !is_dir);
    set('ctx-download', true);
    set('ctx-share', true);
    set('ctx-protect', !is_protected);
    set('ctx-unprotect', is_protected);
    set('ctx-rename', true);
    set('ctx-move', true);
    set('ctx-copy', true);
    set('ctx-delete', true);
}

function openCardMenu(e, fullPath) {
    e.stopPropagation();
    const file = currentDisplayedItems.find(f => f.path === fullPath);
    if (!file) return;
    selectItemForMenu(file, fullPath);
    const rect = e.currentTarget.getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4);
}

function hideAllMenus() {
    const dropdown = document.getElementById('new-dropdown');
    const ctx = document.getElementById('context-menu');
    const backdrop = document.getElementById('context-menu-backdrop');
    if (dropdown) dropdown.style.display = 'none';
    if (ctx) ctx.style.display = 'none';
    if (backdrop) backdrop.classList.remove('show');
}

// ============================================================
// ACCIONES DE ARCHIVO Y CARPETAS
// ============================================================
function triggerUpload() {
    hideAllMenus();
    document.getElementById('hidden-file-input').click();
}

function triggerFolderUpload() {
    hideAllMenus();
    document.getElementById('hidden-folder-input').click();
}

function handleFileInput(input) {
    if (!input.files || input.files.length === 0) return;
    queueUploads(Array.from(input.files));
    input.value = "";
}

function openFolderModal() {
    hideAllMenus();
    document.getElementById('folder-name-input').value = "";
    openModal('folder-modal');
    setTimeout(() => document.getElementById('folder-name-input').focus(), 50);
}

async function submitNewFolder() {
    const name = document.getElementById('folder-name-input').value.trim();
    if (!name) return;
    const form = new FormData();
    form.append("folder_name", name);
    form.append("path", currentSubPath);
    try {
        const res = await fetch('/create-folder', { method: 'POST', body: form });
        if (res.ok) {
            closeModal('folder-modal');
            showToast("Carpeta creada", "success");
            loadFiles(currentSubPath);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Error al crear la carpeta", "error");
        }
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

async function menuAction(action) {
    hideAllMenus();
    if (!selectedItem) return;
    const currentSelected = selectedItem;
    const fileName = currentSelected.split('/').pop();

    if (action === 'view') {
        openViewer(fileName);
    } else if (action === 'download') {
        window.location.href = `/download?path=${encodeURIComponent(currentSelected)}`;
    } else if (action === 'share') {
        await openShareModal(currentSelected);
    } else if (action === 'protect') {
        document.getElementById('protect-password-input').value = "";
        openModal('protect-modal');
        setTimeout(() => document.getElementById('protect-password-input').focus(), 50);
    } else if (action === 'unprotect') {
        const form = new FormData();
        form.append("item_path", currentSelected);
        try {
            const res = await fetch('/api/unprotect', { method: 'POST', body: form });
            if (res.ok) {
                showToast("Se ha quitado la protección", "success");
                loadFiles(currentSubPath);
            } else {
                showToast("Error al quitar protección", "error");
            }
        } catch (e) {
            showToast("Error de conexión", "error");
        }
    } else if (action === 'rename') {
        document.getElementById('rename-name-input').value = fileName;
        openModal('rename-modal');
        setTimeout(() => {
            const input = document.getElementById('rename-name-input');
            input.focus();
            const dot = fileName.lastIndexOf('.');
            input.setSelectionRange(0, dot > 0 ? dot : fileName.length);
        }, 50);
    } else if (action === 'move') {
        openMoveModal([currentSelected], 'move');
    } else if (action === 'copy') {
        openMoveModal([currentSelected], 'copy');
    } else if (action === 'delete') {
        const ok = await showConfirm(`¿Eliminar "${fileName}"? Se moverá a la papelera.`, { title: "Eliminar elemento" });
        if (!ok) return;
        const res = await fetch(`/delete?path=${encodeURIComponent(currentSelected)}`, { method: 'DELETE' });
        if (res.ok) {
            showToast("Elemento movido a la papelera", "success");
            loadFiles(currentSubPath);
            refreshStorage();
        } else {
            showToast("Error al eliminar", "error");
        }
    }
}

async function submitProtect() {
    const password = document.getElementById('protect-password-input').value;
    if (password.length < 3) {
        showToast("La contraseña debe tener al menos 3 caracteres", "error");
        return;
    }
    const form = new FormData();
    form.append("item_path", selectedItem);
    form.append("password", password);
    try {
        const res = await fetch('/api/protect', { method: 'POST', body: form });
        if (res.ok) {
            closeModal('protect-modal');
            showToast("Protegido con éxito", "success");
            loadFiles(currentSubPath);
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.detail || "Error al proteger el elemento", "error");
        }
    } catch (e) {
        showToast("Error de conexión", "error");
    }
}

async function submitRename() {
    const newName = document.getElementById('rename-name-input').value.trim();
    const fileName = selectedItem.split('/').pop();
    if (!newName || newName === fileName) { closeModal('rename-modal'); return; }
    const form = new FormData();
    form.append("old_path", selectedItem);
    form.append("new_name", newName);
    const res = await fetch('/rename', { method: 'POST', body: form });
    if (res.ok) {
        closeModal('rename-modal');
        showToast("Elemento renombrado", "success");
        loadFiles(currentSubPath);
    } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Error al renombrar", "error");
    }
}

// ============================================================
// COMPARTIR
// ============================================================
async function openShareModal(itemPath) {
    const form = new FormData();
    form.append("item_path", itemPath);
    form.append("expires_in_hours", "24");
    try {
        const res = await fetch('/api/share', { method: 'POST', body: form });
        if (!res.ok) {
            showToast("Error al generar el enlace", "error");
            return;
        }
        const data = await res.json();
        const link = `${window.location.origin}/s/${data.token}`;
        document.getElementById('share-link-input').value = link;
        openModal('share-modal');
    } catch (e) {
        showToast("Error de conexión al compartir", "error");
    }
}

function copyShareLink() {
    const input = document.getElementById('share-link-input');
    input.select();
    navigator.clipboard?.writeText(input.value).then(() => {
        showToast("Enlace copiado", "success");
    }).catch(() => {
        document.execCommand('copy');
        showToast("Enlace copiado", "success");
    });
}

// ============================================================
// PORTAPAPELES Y MODAL MOVER / COPIAR
// ============================================================
let moveTargetItems = [];
let moveTargetAction = 'move';
let moveModalCurrentPath = '';

async function openMoveModal(items, action = 'move') {
    moveTargetItems = Array.isArray(items) ? items : [items];
    moveTargetAction = action;
    moveModalCurrentPath = currentSubPath || '';
    
    const title = document.getElementById('move-modal-title');
    const subtitle = document.getElementById('move-modal-subtitle');
    const confirmBtn = document.getElementById('move-modal-confirm-btn');
    
    if (title) {
        title.innerHTML = action === 'move' 
            ? '<i class="ri-folder-transfer-line"></i> Mover elemento(s)' 
            : '<i class="ri-file-copy-line"></i> Copiar elemento(s)';
    }
    if (subtitle) {
        const count = moveTargetItems.length;
        const firstName = moveTargetItems[0]?.split('/').pop() || '';
        subtitle.textContent = count === 1 ? `Selecciona la carpeta destino para "${firstName}":` : `Selecciona la carpeta destino para ${count} elementos:`;
    }
    if (confirmBtn) {
        confirmBtn.innerHTML = action === 'move' ? '<i class="ri-check-line"></i> Mover aquí' : '<i class="ri-check-line"></i> Copiar aquí';
    }

    openModal('move-modal');
    await renderMoveModalFolders();
}

async function renderMoveModalFolders() {
    const pathBar = document.getElementById('move-modal-path');
    const listEl = document.getElementById('move-modal-folder-list');
    if (!pathBar || !listEl) return;

    let pathHtml = `<span style="cursor:pointer; color:var(--primary);" onclick="navigateMoveModal('')"><i class="ri-home-4-line"></i> Mi Unidad</span>`;
    if (moveModalCurrentPath) {
        const parts = moveModalCurrentPath.split('/');
        let accum = '';
        parts.forEach(p => {
            accum = accum ? `${accum}/${p}` : p;
            const targetAcc = accum;
            pathHtml += ` <i class="ri-arrow-right-s-line" style="color:var(--text-secondary); font-size:12px;"></i> <span style="cursor:pointer; color:var(--primary);" onclick="navigateMoveModal('${targetAcc}')">${p}</span>`;
        });
    }
    pathBar.innerHTML = pathHtml;

    listEl.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:13px;"><i class="ri-loader-4-line ri-spin"></i> Cargando carpetas...</div>`;

    try {
        const res = await fetch(`/files?path=${encodeURIComponent(moveModalCurrentPath)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const folders = (data.items || []).filter(item => item.is_dir && !moveTargetItems.includes(item.path));

        listEl.innerHTML = '';
        
        if (moveModalCurrentPath) {
            const upPath = moveModalCurrentPath.includes('/') ? moveModalCurrentPath.substring(0, moveModalCurrentPath.lastIndexOf('/')) : '';
            const upRow = document.createElement('div');
            upRow.style.cssText = 'padding: 8px 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; border-radius: 6px; font-size: 13px; color: var(--text-secondary);';
            upRow.innerHTML = `<i class="ri-arrow-up-line" style="font-size: 16px;"></i> <span>.. (Volver a carpeta anterior)</span>`;
            upRow.onclick = () => navigateMoveModal(upPath);
            upRow.onmouseenter = () => upRow.style.background = 'var(--bg-hover)';
            upRow.onmouseleave = () => upRow.style.background = 'transparent';
            listEl.appendChild(upRow);
        }

        if (folders.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding: 16px; text-align: center; color: var(--text-secondary); font-size: 12px;';
            empty.textContent = 'No hay subcarpetas en este nivel';
            listEl.appendChild(empty);
        } else {
            folders.forEach(f => {
                const row = document.createElement('div');
                row.style.cssText = 'padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; border-radius: 6px; font-size: 13px; color: var(--text-main); margin-bottom: 2px;';
                row.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <i class="ri-folder-3-fill" style="color: #fbbc05; font-size: 18px;"></i>
                        <span style="font-weight: 500;">${f.name}</span>
                    </div>
                    <i class="ri-arrow-right-s-line" style="color:var(--text-secondary);"></i>
                `;
                row.onclick = () => navigateMoveModal(f.path);
                row.onmouseenter = () => row.style.background = 'var(--bg-hover)';
                row.onmouseleave = () => row.style.background = 'transparent';
                listEl.appendChild(row);
            });
        }
    } catch (e) {
        listEl.innerHTML = `<div style="padding:16px; text-align:center; color:var(--danger); font-size:12px;">Error al cargar carpetas</div>`;
    }
}

function navigateMoveModal(targetPath) {
    moveModalCurrentPath = targetPath;
    renderMoveModalFolders();
}

async function submitMoveModal() {
    if (!moveTargetItems || moveTargetItems.length === 0) return;
    const endpoint = moveTargetAction === 'move' ? '/move' : '/copy';
    let okCount = 0;

    for (const itemPath of moveTargetItems) {
        const form = new FormData();
        form.append("item_path", itemPath);
        form.append("target_path", moveModalCurrentPath);
        try {
            const res = await fetch(endpoint, { method: 'POST', body: form });
            if (res.ok) okCount++;
        } catch (e) {}
    }

    closeModal('move-modal');
    showToast(`${okCount} elemento(s) ${moveTargetAction === 'move' ? 'movidos' : 'copiados'} con éxito`, okCount > 0 ? "success" : "error");
    clearSelection();
    loadFiles(currentSubPath);
}

function showFloatingPasteBanner(message) {
    let banner = document.getElementById('floating-paste-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'floating-paste-banner';
        document.body.appendChild(banner);
    }
    banner.innerHTML = `
        <span>${message}</span>
        <button onclick="executePaste()" style="background: var(--primary); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; flex-shrink:0;">Pegar</button>
        <button onclick="cancelPaste()" style="background: transparent; color: #aaa; border: none; cursor: pointer;"><i class="ri-close-line" style="font-size: 18px;"></i></button>
    `;
    banner.style.display = 'flex';
}

function cancelPaste() {
    clipboardItems = null;
    clipboardAction = null;
    const banner = document.getElementById('floating-paste-banner');
    if (banner) banner.style.display = 'none';
}

async function executePaste(e) {
    if (e) e.preventDefault();
    if (!clipboardItems || !clipboardAction) return;
    const endpoint = clipboardAction === 'move' ? '/move' : '/copy';

    let okCount = 0;
    for (const itemPath of clipboardItems) {
        const form = new FormData();
        form.append("item_path", itemPath);
        form.append("target_path", currentSubPath);
        try {
            const res = await fetch(endpoint, { method: 'POST', body: form });
            if (res.ok) okCount++;
        } catch (e) {}
    }

    showToast(`${okCount}/${clipboardItems.length} elemento(s) ${clipboardAction === 'move' ? 'movidos' : 'copiados'}`, okCount > 0 ? "success" : "error");
    cancelPaste();
    clearSelection();
    loadFiles(currentSubPath);
}

// ============================================================
// DRAG AND DROP (INTERNO Y ESCRITORIO)
// ============================================================
function attachDragHandlers(el, path, isDir) {
    el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/najelo-item', JSON.stringify([...(selectedPaths.has(path) ? selectedPaths : [path])]));
        e.dataTransfer.effectAllowed = 'move';
    });
    if (isDir) {
        el.addEventListener('dragover', (e) => {
            if (Array.from(e.dataTransfer.types).includes('application/najelo-item')) {
                e.preventDefault();
                el.classList.add('drag-over');
            }
        });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', async (e) => {
            if (!Array.from(e.dataTransfer.types).includes('application/najelo-item')) return;
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('drag-over');
            const raw = e.dataTransfer.getData('application/najelo-item');
            if (!raw) return;
            const paths = JSON.parse(raw);
            let okCount = 0;
            for (const p of paths) {
                if (p === path) continue;
                const form = new FormData();
                form.append("item_path", p);
                form.append("target_path", path);
                try {
                    const res = await fetch('/move', { method: 'POST', body: form });
                    if (res.ok) okCount++;
                } catch (err) {}
            }
            if (okCount > 0) {
                showToast(`${okCount} elemento(s) movidos`, "success");
                clearSelection();
                loadFiles(currentSubPath);
            }
        });
    }
}

function initDragAndDrop() {
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
            e.preventDefault();
            dragCounter++;
            document.body.classList.add('dragging-file');
        }
    });
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) document.body.classList.remove('dragging-file');
    });
    window.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (!files || !files.length) return;
        e.preventDefault();
        dragCounter = 0;
        document.body.classList.remove('dragging-file');
        queueUploads(Array.from(files));
    });
}

// ============================================================
// SUBIDA DE ARCHIVOS CON PROGRESO
// ============================================================
function queueUploads(files) {
    if (!files.length) return;
    const tray = document.getElementById('upload-tray');
    const body = document.getElementById('upload-tray-body');
    tray.classList.remove('collapsed');
    tray.classList.add('show');

    files.forEach(file => {
        const id = `up-${++uploadIdCounter}`;
        const task = { id, file, relativePath: file.webkitRelativePath || "", status: 'pending', progress: 0 };
        uploadQueue.push(task);

        const item = document.createElement('div');
        item.className = 'upload-item';
        item.id = id;
        item.innerHTML = `
            <div class="upload-item-top">
                <span class="upload-item-name" title="${task.relativePath || file.name}">${task.relativePath || file.name}</span>
                <button class="upload-item-retry" id="${id}-retry" style="display:none;" onclick="retryUpload('${id}')" title="Reintentar"><i class="ri-refresh-line"></i></button>
                <span class="upload-item-status" id="${id}-status">Esperando…</span>
            </div>
            <div class="upload-progress-track"><div class="upload-progress-fill" id="${id}-fill"></div></div>
        `;
        body.prepend(item);
    });

    updateTrayHeader();
    processUploadQueue();
}

function processUploadQueue() {
    while (activeUploads < MAX_CONCURRENT_UPLOADS) {
        const next = uploadQueue.find(t => t.status === 'pending');
        if (!next) break;
        next.status = 'uploading';
        activeUploads++;
        uploadSingleFile(next);
    }
}

function uploadSingleFile(task) {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("file", task.file);
    form.append("path", currentSubPath);
    form.append("relative_path", task.relativePath || "");

    const statusEl = document.getElementById(`${task.id}-status`);
    const fillEl = document.getElementById(`${task.id}-fill`);

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (statusEl) statusEl.textContent = `${pct}%`;
        }
    });

    xhr.addEventListener('load', () => {
        activeUploads--;
        if (xhr.status >= 200 && xhr.status < 300) {
            task.status = 'done';
            if (fillEl) { fillEl.style.width = '100%'; fillEl.classList.add('ok'); }
            if (statusEl) { statusEl.textContent = 'Listo'; statusEl.classList.add('ok'); }
            scheduleFilesRefresh();
        } else {
            task.status = 'error';
            let detail = 'Error';
            try { detail = JSON.parse(xhr.responseText).detail || 'Error'; } catch (e) {}
            if (fillEl) fillEl.classList.add('err');
            if (statusEl) { statusEl.textContent = detail; statusEl.classList.add('err'); }
            const retryBtn = document.getElementById(`${task.id}-retry`);
            if (retryBtn) retryBtn.style.display = 'inline-flex';
        }
        updateTrayHeader();
        processUploadQueue();
        maybeFinishBatch();
    });

    xhr.addEventListener('error', () => {
        activeUploads--;
        task.status = 'error';
        if (fillEl) fillEl.classList.add('err');
        if (statusEl) { statusEl.textContent = 'Error de red'; statusEl.classList.add('err'); }
        const retryBtn = document.getElementById(`${task.id}-retry`);
        if (retryBtn) retryBtn.style.display = 'inline-flex';
        updateTrayHeader();
        processUploadQueue();
        maybeFinishBatch();
    });

    xhr.open('POST', '/upload');
    xhr.send(form);
}

function maybeFinishBatch() {
    const pending = uploadQueue.some(t => t.status === 'pending' || t.status === 'uploading');
    if (!pending) {
        const okCount = uploadQueue.filter(t => t.status === 'done').length;
        const errCount = uploadQueue.filter(t => t.status === 'error').length;
        if (okCount > 0) {
            showToast(`${okCount} archivo(s) subido(s)${errCount ? `, ${errCount} con error` : ''}`, errCount ? "info" : "success");
            refreshStorage();
        } else if (errCount > 0) {
            showToast(`No se pudo subir ningún archivo`, "error");
        }
        if (errCount === 0) {
            setTimeout(() => {
                if (!uploadQueue.some(t => t.status === 'pending' || t.status === 'uploading')) {
                    uploadQueue = [];
                    document.getElementById('upload-tray').classList.remove('show');
                    document.getElementById('upload-tray-body').innerHTML = '';
                }
            }, 4000);
        }
    }
}

function resetTaskForRetry(id) {
    const task = uploadQueue.find(t => t.id === id);
    if (!task) return;
    task.status = 'pending';
    task.progress = 0;
    const fillEl = document.getElementById(`${id}-fill`);
    const statusEl = document.getElementById(`${id}-status`);
    const retryBtn = document.getElementById(`${id}-retry`);
    if (fillEl) { fillEl.style.width = '0%'; fillEl.classList.remove('err', 'ok'); }
    if (statusEl) { statusEl.textContent = 'Esperando…'; statusEl.classList.remove('err', 'ok'); }
    if (retryBtn) retryBtn.style.display = 'none';
}

function retryUpload(id) {
    resetTaskForRetry(id);
    document.getElementById('upload-tray')?.classList.add('show');
    updateTrayHeader();
    processUploadQueue();
}

function retryAllFailed() {
    uploadQueue.filter(t => t.status === 'error').forEach(t => resetTaskForRetry(t.id));
    updateTrayHeader();
    processUploadQueue();
}

function updateTrayHeader() {
    const total = uploadQueue.length;
    const done = uploadQueue.filter(t => t.status === 'done' || t.status === 'error').length;
    const errCount = uploadQueue.filter(t => t.status === 'error').length;
    const countEl = document.getElementById('upload-tray-count');
    const titleEl = document.getElementById('upload-tray-title');
    const retryAllBtn = document.getElementById('upload-tray-retry-all');
    if (countEl) countEl.textContent = `${done}/${total}`;
    if (titleEl) titleEl.innerHTML = done < total
        ? `<i class="ri-upload-cloud-2-line"></i> Subiendo archivos`
        : (errCount > 0 ? `<i class="ri-error-warning-line"></i> Subida con errores` : `<i class="ri-checkbox-circle-line"></i> Subida completada`);
    if (retryAllBtn) retryAllBtn.style.display = (done >= total && errCount > 0) ? 'inline-flex' : 'none';
}

function toggleUploadTray() {
    document.getElementById('upload-tray').classList.toggle('collapsed');
}

// ============================================================
// PAPELERA DE RECICLAJE
// ============================================================
async function openTrashModal() {
    hideAllMenus();
    document.getElementById('nav-trash')?.classList.add('active');
    document.getElementById('nav-drive')?.classList.remove('active');
    const tbody = document.getElementById('trash-tbody');
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-secondary);">Cargando…</td></tr>`;
    openModal('trash-modal');

    try {
        const res = await fetch('/trash');
        if (!res.ok) throw new Error();
        const items = await res.json();
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-secondary);">La papelera está vacía</td></tr>`;
            return;
        }
        tbody.innerHTML = items.map(it => `
            <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:10px;">
                    <i class="${it.is_dir ? 'ri-folder-fill' : 'ri-file-text-line'}" style="color:${it.is_dir ? '#fbbc05' : 'var(--text-secondary)'}; margin-right:6px;"></i>
                    ${it.name} <span style="color:var(--text-secondary); font-size:11px;">(${formatBytes(it.size)})</span>
                </td>
                <td style="padding:10px; font-size:12px; color:var(--text-secondary);">${formatDate(it.deleted_at)}</td>
                <td style="padding:10px; white-space:nowrap;">
                    <button onclick="restoreTrashItem('${it.id}')" style="background:var(--success); color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px;">Restaurar</button>
                    <button onclick="deleteTrashItemPermanent('${it.id}')" style="background:var(--danger); color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; margin-left:5px; font-size:12px;">Eliminar</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--danger);">Error al cargar la papelera</td></tr>`;
    }
}

async function restoreTrashItem(id) {
    const form = new FormData();
    form.append("item_id", id);
    const res = await fetch('/trash/restore', { method: 'POST', body: form });
    if (res.ok) {
        showToast("Elemento restaurado", "success");
        openTrashModal();
        loadFiles(currentSubPath);
        refreshStorage();
    } else {
        showToast("Error al restaurar", "error");
    }
}

async function deleteTrashItemPermanent(id) {
    const ok = await showConfirm("Este elemento se eliminará de forma permanente. ¿Continuar?", { title: "Eliminar definitivamente" });
    if (!ok) return;
    const form = new FormData();
    form.append("item_id", id);
    const res = await fetch('/trash/delete', { method: 'POST', body: form });
    if (res.ok) {
        showToast("Eliminado permanentemente", "success");
        openTrashModal();
    } else {
        showToast("Error al eliminar", "error");
    }
}

async function emptyTrash() {
    const ok = await showConfirm("Se eliminarán permanentemente todos los elementos de la papelera. ¿Continuar?", { title: "Vaciar papelera" });
    if (!ok) return;
    const res = await fetch('/trash/empty', { method: 'POST' });
    if (res.ok) {
        showToast("Papelera vaciada", "success");
        openTrashModal();
    } else {
        showToast("Error al vaciar la papelera", "error");
    }
}

// ============================================================
// ALMACENAMIENTO Y VISUALIZADOR (CON REPRODUCTOR ACTUALIZADO)
// ============================================================
async function refreshStorage() {
    try {
        const res = await fetch('/api/storage');
        if (!res.ok) return;
        const data = await res.json();
        const textEl = document.getElementById('storage-text');
        const fillEl = document.getElementById('storage-bar-fill');
        if (textEl) textEl.textContent = `${formatBytes(data.used_bytes)} · ${data.item_count} archivos`;
        if (fillEl) {
            const softCapBytes = 5 * 1024 * 1024 * 1024;
            const pct = Math.min(100, (data.used_bytes / softCapBytes) * 100);
            fillEl.style.width = `${pct}%`;
        }
    } catch (e) {}
}

function openViewer(fileName) {
    const modal = document.getElementById('viewer-modal');
    const title = document.getElementById('viewer-title');
    const body = document.getElementById('viewer-body');
    if (!modal || !title || !body) return;

    title.innerText = fileName;
    body.innerHTML = "";
    body.style.display = 'flex';

    const fileUrl = `/view?path=${encodeURIComponent(selectedItem)}`;

    if (fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        body.innerHTML = `<img src="${fileUrl}" style="max-width:100%; max-height:100%;">`;
    } else if (fileName.match(/\.(mp4|webm|ogg)$/i)) {
        // Uso de la etiqueta <source> interna para asegurar compatibilidad con la redirección 303 del CDN
        body.innerHTML = `
            <video id="active-video-player" controls autoplay preload="metadata" style="max-width:100%; max-height:100%;">
                <source src="${fileUrl}" type="video/mp4">
                Tu navegador no soporta la reproducción de video.
            </video>
        `;
    } else if (fileName.match(/\.(pdf)$/i)) {
        body.innerHTML = `<iframe src="${fileUrl}" style="width:100%; height:100%; border:none;"></iframe>`;
    } else if (fileName.match(/\.(csv)$/i)) {
        body.style.display = 'block';
        fetch(fileUrl).then(r => r.text()).then(text => {
            body.innerHTML = renderCsvTable(text);
        });
    } else if (fileName.match(/\.(txt|md|py|html|css|js|json|sql|java|c|cpp|ts|jsx|yml|yaml|xml|sh)$/i)) {
        body.style.display = 'block';
        fetch(fileUrl).then(r => r.text()).then(text => {
            const lang = (fileName.split('.').pop() || '').toLowerCase();
            body.innerHTML = `<pre style="background: var(--card-bg); padding: 20px; border-radius: 8px; width: 100%; height: 100%; margin:0; overflow: auto; text-align: left; font-size: 13px; box-sizing:border-box;"><code class="language-${lang}">${escapeHtml(text)}</code></pre>`;
            const codeEl = body.querySelector('code');
            if (window.hljs && codeEl) {
                try { hljs.highlightElement(codeEl); } catch (e) {}
            }
        });
    } else {
        body.innerHTML = `<div style="text-align: center; padding: 40px;">
            <p>No hay vista previa disponible para este archivo.</p>
            <a href="/download?path=${encodeURIComponent(selectedItem)}" style="display: inline-block; margin-top: 15px; padding: 10px 20px; background: var(--primary); color: #fff; border-radius: 8px; text-decoration: none;">Descargar archivo</a>
        </div>`;
    }

    modal.style.display = 'flex';
}

/**
 * Función para cerrar de forma segura el visor y pausar/limpiar 
 * cualquier elemento de video activo que se esté reproduciendo en segundo plano.
 */
function closeViewer() {
    const modal = document.getElementById('viewer-modal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Buscar si hay un reproductor de video activo y detenerlo
    const activeVideo = document.getElementById('active-video-player');
    if (activeVideo) {
        activeVideo.pause();
        activeVideo.currentTime = 0;
        activeVideo.src = ''; // Limpia el enlace para cortar el streaming con el CDN
        activeVideo.load();
    }

    // Limpiar también el contenido del body del visor por seguridad
    const body = document.getElementById('viewer-body');
    if (body) {
        body.innerHTML = '';
    }
}

function renderCsvTable(text) {
    const lines = text.split(/\r?\n/).filter(l => l.length > 0).slice(0, 500);
    if (lines.length === 0) return `<p style="text-align:center; color:var(--text-secondary);">El archivo CSV está vacío</p>`;
    const rows = lines.map(l => l.split(','));
    const [header, ...rest] = rows;
    let html = `<div style="overflow:auto; width:100%; height:100%;"><table style="border-collapse:collapse; width:100%; font-size:12px;">`;
    html += `<thead><tr>${header.map(h => `<th style="position:sticky; top:0; background:var(--bg-hover); padding:8px 10px; text-align:left; border-bottom:1px solid var(--border);">${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
    html += `<tbody>${rest.map(r => `<tr>${r.map(c => `<td style="padding:6px 10px; border-bottom:1px solid var(--border);">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return html;
}

// ============================================================
// MODALES Y TOASTS
// ============================================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
}

function closeModal(modalId) {
    // Si estamos cerrando el visor de archivos, usamos nuestra función de limpieza de video
    if (modalId === 'viewer-modal') {
        closeViewer();
        return;
    }
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

function showConfirm(message, { title = "Confirmar", acceptLabel = "Confirmar" } = {}) {
    document.getElementById('confirm-modal-title').innerHTML = `<i class="ri-error-warning-line"></i> ${title}`;
    document.getElementById('confirm-modal-message').textContent = message;
    document.getElementById('confirm-modal-accept').textContent = acceptLabel;
    openModal('confirm-modal');
    return new Promise(resolve => { confirmResolver = resolve; });
}

function resolveConfirm(result) {
    closeModal('confirm-modal');
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}

function showToast(message, type = "info") {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: 'ri-checkbox-circle-fill', error: 'ri-close-circle-fill', info: 'ri-information-fill' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${icons[type] || icons.info}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

// ============================================================
// ATAJOS DE TECLADO
// ============================================================
function handleKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea';

    if (e.key === 'Escape') {
        const viewerModal = document.getElementById('viewer-modal');
        if (viewerModal && viewerModal.style.display === 'flex') {
            closeViewer();
            return;
        }
        const openModalEl = Array.from(document.querySelectorAll('.modal-overlay')).find(m => m.style.display === 'flex');
        if (openModalEl) { openModalEl.style.display = 'none'; return; }
        hideAllMenus();
        clearSelection();
        return;
    }
    if (typing) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPaths.size > 0) {
        e.preventDefault();
        bulkDelete();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedPaths.size > 0) {
        clipboardItems = Array.from(selectedPaths);
        clipboardAction = 'copy';
        showFloatingPasteBanner(`${clipboardItems.length} elemento(s) copiado(s). Ve a la carpeta destino y pega.`);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboardItems) {
        executePaste();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectedPaths = new Set(currentDisplayedItems.map(f => f.path));
        updateSelectionUI();
    }
}

// ============================================================
// PANEL DE ADMINISTRACIÓN Y SESIÓN
// ============================================================
function togglePasswordVisibility(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById(`${id}-icon`);
    if (!el || !icon) return;
    const real = el.getAttribute('data-real');
    if (el.textContent === '••••••••') {
        el.textContent = real;
        icon.className = 'ri-eye-off-line';
    } else {
        el.textContent = '••••••••';
        icon.className = 'ri-eye-line';
    }
}

let currentAdminUsersList = [];

async function openAdminModal() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody) return;
    tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px;'>Cargando usuarios...</td></tr>";
    openModal('admin-modal');

    try {
        const res = await fetch('/api/admin/users');
        if (res.ok) {
            currentAdminUsersList = await res.json();
            tbody.innerHTML = "";
            currentAdminUsersList.forEach((u, idx) => {
                let tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid var(--border)";
                const pwdVal = escapeHtml(u.password || '');
                const pwdId = `pwd-val-${idx}`;

                let permSummaryHtml = '';
                if (u.is_admin) {
                    permSummaryHtml = `<span style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; background:rgba(66,133,244,0.15); color:var(--primary);">Acceso total</span>`;
                } else if (u.permissions) {
                    const p = u.permissions;
                    const count = Object.values(p).filter(Boolean).length;
                    permSummaryHtml = `<span style="font-size:11px; font-weight:500; padding:2px 8px; border-radius:12px; background:var(--bg-hover); color:var(--text-secondary); border:1px solid var(--border);">${count}/6 permisos</span>`;
                } else {
                    permSummaryHtml = `<span style="font-size:11px; padding:2px 8px; border-radius:12px; background:var(--bg-hover); color:var(--text-secondary);">6/6 permisos</span>`;
                }

                tr.innerHTML = `
                    <td style="padding: 10px; font-weight: 500;">${escapeHtml(u.username)} ${u.is_admin ? '<span style="color:var(--primary); font-size:12px;">(Admin)</span>' : ''}</td>
                    <td style="padding: 10px;">
                        <div style="display:inline-flex; align-items:center; gap:6px; background:var(--bg-hover); padding:4px 8px; border-radius:6px; font-family:monospace; font-size:12px;">
                            <span id="${pwdId}" data-real="${pwdVal}">••••••••</span>
                            <button onclick="togglePasswordVisibility('${pwdId}')" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; padding:0; display:flex; align-items:center;" title="Mostrar/ocultar contraseña"><i class="ri-eye-line" id="${pwdId}-icon"></i></button>
                        </div>
                    </td>
                    <td style="padding: 10px;">${permSummaryHtml}</td>
                    <td style="padding: 10px;">${u.is_approved ? '<span style="color: var(--success); font-weight: bold;">Aprobado</span>' : '<span style="color: var(--warning); font-weight: bold;">Pendiente</span>'}</td>
                    <td style="padding: 10px;">
                        <button onclick="openEditUserModal('${escapeHtml(u.username)}')" style="background: var(--primary); color:white; border:none; padding: 6px 10px; border-radius: 6px; cursor:pointer; font-size: 12px; margin-right: 4px;" title="Editar usuario y permisos"><i class="ri-edit-line"></i> Editar</button>
                        ${!u.is_approved ? `<button onclick="approveUser('${escapeHtml(u.username)}')" style="background: var(--success); color:white; border:none; padding: 6px 10px; border-radius: 6px; cursor:pointer; font-size: 12px;">Aprobar</button>` : ''}
                        ${!u.is_admin ? `<button onclick="deleteUser('${escapeHtml(u.username)}')" style="background: var(--danger); color:white; border:none; padding: 6px 10px; border-radius: 6px; cursor:pointer; font-size: 12px; margin-left: 4px;">Eliminar</button>` : ''}
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; padding: 20px; color: var(--danger);'>Error al cargar el panel</td></tr>";
    }
}

async function approveUser(username) {
    const form = new FormData();
    form.append("username", username);
    const res = await fetch('/api/admin/approve', { method: 'POST', body: form });
    if (res.ok) { showToast(`${username} aprobado`, "success"); openAdminModal(); }
}

async function deleteUser(username) {
    const ok = await showConfirm(`¿Estás seguro de eliminar al usuario ${username}?`, { title: "Eliminar usuario" });
    if (!ok) return;
    const form = new FormData();
    form.append("username", username);
    const res = await fetch('/api/admin/delete-user', { method: 'POST', body: form });
    if (res.ok) { showToast("Usuario eliminado", "success"); openAdminModal(); }
}

function toggleInputPassword(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input || !icon) return;
    if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'ri-eye-off-line';
    } else {
        input.type = 'password';
        icon.className = 'ri-eye-line';
    }
}

function openEditUserModal(username) {
    document.getElementById('edit-user-old-username').value = username;
    document.getElementById('edit-user-username').value = username;
    document.getElementById('edit-user-password').value = '';
    const pwdInput = document.getElementById('edit-user-password');
    if (pwdInput) pwdInput.type = 'password';
    const pwdIcon = document.getElementById('edit-user-pwd-icon');
    if (pwdIcon) pwdIcon.className = 'ri-eye-line';

    const targetUser = currentAdminUsersList.find(u => u.username.toLowerCase() === username.toLowerCase());
    const isTargetAdmin = targetUser ? targetUser.is_admin : false;
    const perms = targetUser && targetUser.permissions ? targetUser.permissions : {
        can_view: true,
        can_upload: true,
        can_create_folder: true,
        can_rename: true,
        can_move_copy: true,
        can_delete: true
    };

    const adminBadge = document.getElementById('perm-admin-badge');
    if (adminBadge) adminBadge.style.display = isTargetAdmin ? 'inline-block' : 'none';

    const permKeys = ['can_view', 'can_upload', 'can_create_folder', 'can_rename', 'can_move_copy', 'can_delete'];
    permKeys.forEach(k => {
        const keyId = k.replace(/_/g, '-');
        const chk = document.getElementById(`perm-${keyId}`);
        if (chk) {
            chk.checked = isTargetAdmin || Boolean(perms[k]);
            chk.disabled = isTargetAdmin;
        }
    });

    openModal('edit-user-modal');
}

async function submitEditUser() {
    const oldUsername = document.getElementById('edit-user-old-username').value;
    const newUsername = document.getElementById('edit-user-username').value.trim();
    const newPassword = document.getElementById('edit-user-password').value.trim();

    if (!newUsername) {
        showToast('El nombre de usuario no puede estar vacío', 'warning');
        return;
    }

    const permissions = {
        can_view: document.getElementById('perm-can-view') ? document.getElementById('perm-can-view').checked : true,
        can_upload: document.getElementById('perm-can-upload') ? document.getElementById('perm-can-upload').checked : true,
        can_create_folder: document.getElementById('perm-can-create-folder') ? document.getElementById('perm-can-create-folder').checked : true,
        can_rename: document.getElementById('perm-can-rename') ? document.getElementById('perm-can-rename').checked : true,
        can_move_copy: document.getElementById('perm-can-move-copy') ? document.getElementById('perm-can-move-copy').checked : true,
        can_delete: document.getElementById('perm-can-delete') ? document.getElementById('perm-can-delete').checked : true
    };

    try {
        const res = await fetch('/api/admin/edit-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_username: oldUsername,
                new_username: newUsername,
                new_password: newPassword,
                permissions: permissions
            })
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Usuario y permisos actualizados correctamente', 'success');
            closeModal('edit-user-modal');
            openAdminModal();
        } else {
            showToast(data.detail || 'Error al actualizar usuario', 'error');
        }
    } catch (e) {
        showToast('Error de conexión', 'error');
    }
}

async function logout() {
    localStorage.removeItem('najelo_user_id');
    localStorage.removeItem('najelo_user');
    document.cookie = "najelo_uid=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    try {
        await fetch('/api/logout');
    } catch (e) {}
    window.location.href = "/login";
}

// ============================================================
// FUNCIONES AUXILIARES DE FORMATO
// ============================================================
function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(unixSeconds) {
    if (!unixSeconds) return "—";
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
