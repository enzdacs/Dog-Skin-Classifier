/* =====================================================
   DermSort — app.js
   Backend: Supabase (Storage + Postgres)
   Session-based: users share data via session name.
   ===================================================== */

// ============================================================
// CONFIGURATION — paste your Supabase project values here
// ============================================================
const SUPABASE_URL    = "https://tomazrivkvikkgugrowl.supabase.co";
const SUPABASE_ANON   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvbWF6cml2a3Zpa2tndWdyb3dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1ODc4NDUsImV4cCI6MjA5NzE2Mzg0NX0.bY-kwIzUa4Udpff6jiFzJO1a-ydqOqdhWtcsWccx1ew";
const STORAGE_BUCKET  = "dermsort-images"; // bucket name you create in Supabasea
// ============================================================

const CATEGORIES = [
  "Atopic Dermatitis",
  "Sarcoptic Mange",
  "Pyotraumatic Dermatitis",
  "Healthy",
  "Unknown"
];
const SEQ_NAMES = ["seq_ir.jpg", "seq_ir.jpeg", "seq_ir.png"];

// ---- Supabase helpers ----
function sbHeaders(extra = {}) {
  return { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json", ...extra };
}

async function sbQuery(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: sbHeaders(opts.headers || {}),
    method:  opts.method || "GET",
    body:    opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error: ${res.status} ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sbUploadFile(storagePath, file, mimeType) {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${encodedPath}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_ANON, "Authorization": `Bearer ${SUPABASE_ANON}`, "Content-Type": mimeType || "image/jpeg", "x-upsert": "true" },
    body: file
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload error: ${res.status} ${err}`);
  }
}

function sbPublicUrl(storagePath) {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${encodedPath}`;
}

async function sbDeleteFile(storagePath) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}`, {
    method: "DELETE",
    headers: sbHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [storagePath] })
  });
}

// ---- In-memory state ----
let SESSION = "";
// folders: [{ id, session, name, total_images, classified_count }]
// images per folder loaded on demand:
//   { id, folder_id, storage_path, file_name, relative_path, category, public_url }
let folders        = [];
let currentImages  = [];   // images in the open folder
let currentFolderIdx = null;
let currentImgIdx    = 0;
let activeSavedCat   = CATEGORIES[0];
let lightboxIdx      = 0;
let savedImages      = [];  // images in active saved category

// ---- DOM Refs ----
const sessionGate       = document.getElementById("session-gate");
const sessionInput      = document.getElementById("session-input");
const sessionEnter      = document.getElementById("session-enter");
const sessionError      = document.getElementById("session-error");
const appShell          = document.getElementById("app-shell");
const sessionLabel      = document.getElementById("session-label");
const switchSessionBtn  = document.getElementById("switch-session-btn");

const tabBtns           = document.querySelectorAll(".tab-btn");
const tabPanels         = document.querySelectorAll(".tab-panel");

const uploadSection     = document.getElementById("upload-section");
const classifyWorkspace = document.getElementById("classify-workspace");
const folderListWrap    = document.getElementById("folder-list-wrap");
const folderListEl      = document.getElementById("folder-list");
const folderInput       = document.getElementById("folder-input");
const folderInputMore   = document.getElementById("folder-input-more");

const workspaceFolderName = document.getElementById("workspace-folder-name");
const imageCounter        = document.getElementById("image-counter");
const classifyImgEl       = document.getElementById("classify-img");
const imgLoading          = document.getElementById("img-loading");
const noImageMsg          = document.getElementById("no-image-msg");
const currentImgName      = document.getElementById("current-img-name");
const classifyControls    = document.getElementById("classify-controls");
const classifyBtnRow      = document.getElementById("classify-btn-row");
const prevImgBtn          = document.getElementById("prev-img");
const nextImgBtn          = document.getElementById("next-img");
const folderDoneMsg       = document.getElementById("folder-done-msg");
const doneText            = document.getElementById("done-text");
const backBtn             = document.getElementById("back-to-folders");
const backBtnDone         = document.getElementById("back-to-folders-done");

const catBtns             = document.querySelectorAll(".cat-btn");
const savedCategoryTitle  = document.getElementById("saved-category-title");
const savedGrid           = document.getElementById("saved-grid");
const savedEmpty          = document.getElementById("saved-empty");
const savedLoading        = document.getElementById("saved-loading");
const exportBtn           = document.getElementById("export-btn");

const lightbox            = document.getElementById("lightbox");
const lightboxImg         = document.getElementById("lightbox-img");
const lightboxLabel       = document.getElementById("lightbox-label");
const lightboxClose       = document.getElementById("lightbox-close");
const lightboxCatBadge    = document.getElementById("lightbox-cat-badge");
const lbPrev              = document.getElementById("lb-prev");
const lbNext              = document.getElementById("lb-next");
const lbMoveBtn           = document.getElementById("lb-move-btn");
const lbRevertBtn         = document.getElementById("lb-revert-btn");
const lbDeleteBtn         = document.getElementById("lb-delete-btn");
const moveSubmenu         = document.getElementById("move-submenu");
const moveSubmenuBtns     = document.querySelectorAll(".move-submenu-btns .classify-btn");

const uploadOverlay       = document.getElementById("upload-overlay");
const uploadProgressText  = document.getElementById("upload-progress-text");
const progressBar         = document.getElementById("progress-bar");
const uploadProgressSub   = document.getElementById("upload-progress-sub");

const confirmModal        = document.getElementById("confirm-modal");
const confirmText         = document.getElementById("confirm-text");
const confirmYes          = document.getElementById("confirm-yes");
const confirmNo           = document.getElementById("confirm-no");
const toastEl             = document.getElementById("toast");

// ---- Session ----
function enterSession() {
  const name = sessionInput.value.trim();
  if (!name) { sessionError.classList.remove("hidden"); return; }
  sessionError.classList.add("hidden");
  SESSION = name;
  sessionLabel.textContent = name;
  sessionGate.classList.add("hidden");
  appShell.classList.remove("hidden");
  // Persist session in localStorage (just the name, not data)
  localStorage.setItem("dermsort_session", name);
  loadFolders();
}

sessionEnter.addEventListener("click", enterSession);
sessionInput.addEventListener("keydown", e => { if (e.key === "Enter") enterSession(); });

switchSessionBtn.addEventListener("click", () => {
  SESSION = "";
  localStorage.removeItem("dermsort_session");
  appShell.classList.add("hidden");
  sessionGate.classList.remove("hidden");
  sessionInput.value = "";
  folders = []; currentImages = []; currentFolderIdx = null;
  folderListEl.innerHTML = "";
  folderListWrap.classList.add("hidden");
  goBack();
});

// Auto-restore session
const savedSession = localStorage.getItem("dermsort_session");
if (savedSession) {
  SESSION = savedSession;
  sessionLabel.textContent = savedSession;
  sessionInput.value = savedSession;
  sessionGate.classList.add("hidden");
  appShell.classList.remove("hidden");
  loadFolders();
}

// ---- Load Folders from Supabase ----
async function loadFolders() {
  try {
    const rows = await sbQuery(`/dermsort_folders?session=eq.${encodeURIComponent(SESSION)}&order=created_at.asc`);
    folders = rows || [];
    renderFolderList();
    renderCatCounts();
  } catch (e) {
    showToast("Failed to load folders: " + e.message);
  }
}

// ---- Render Folder List ----
function renderFolderList() {
  if (folders.length === 0) {
    folderListWrap.classList.add("hidden");
    return;
  }
  folderListWrap.classList.remove("hidden");
  folderListEl.innerHTML = "";

  folders.forEach((folder, idx) => {
    const remaining = folder.total_images - (folder.classified_count || 0);
    const li = document.createElement("li");
    li.className = "folder-item";
    li.innerHTML = `
      <div class="folder-item-left">
        <span class="folder-item-icon">📁</span>
        <span class="folder-item-name">${esc(folder.name)}</span>
      </div>
      <div class="folder-item-meta">
        <span class="folder-item-count">${remaining} left / ${folder.total_images}</span>
        <span class="folder-item-arrow">›</span>
        <button class="folder-delete-btn" title="Remove folder" data-idx="${idx}">🗑</button>
      </div>
    `;
    li.querySelector(".folder-item-left").addEventListener("click", () => openFolder(idx));
    li.querySelector(".folder-delete-btn").addEventListener("click", e => {
      e.stopPropagation();
      confirmAction(`Remove folder "${folder.name}" and all its images from Supabase?`, () => deleteFolder(idx));
    });
    folderListEl.appendChild(li);
  });
}

// ---- Upload Folder ----
async function handleFolderUpload(fileList) {
  if (!fileList || fileList.length === 0) return;

  const files     = Array.from(fileList);
  const imageExts = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;
  const allImgs   = files.filter(f => imageExts.test(f.name));

  if (allImgs.length === 0) { showToast("No image files found."); return; }

  const rootName = files[0].webkitRelativePath.split("/")[0];

  // Determine if any images are in sub-folders (depth >= 3: root/subfolder/file)
  const hasNested = allImgs.some(f => f.webkitRelativePath.split("/").length >= 3);

  let selected;
  if (!hasNested) {
    // All images are directly in root folder — show all regardless of filename
    selected = allImgs;
  } else {
    // Has sub-folders — only pick seq_IR files from anywhere in the tree
    selected = allImgs.filter(f => SEQ_NAMES.includes(f.name.toLowerCase()));
    if (selected.length === 0) {
      showToast("No seq_IR images found. In nested folders, only files named seq_IR.jpg/jpeg/png are imported.");
      return;
    }
  }

  // Show progress
  uploadOverlay.classList.remove("hidden");
  progressBar.style.width = "0%";
  uploadProgressText.textContent = `Uploading "${rootName}"…`;
  uploadProgressSub.textContent  = `0 / ${selected.length} images`;

  try {
    // Check if folder already exists for this session + name
    const existing = await sbQuery(
      `/dermsort_folders?session=eq.${encodeURIComponent(SESSION)}&name=eq.${encodeURIComponent(rootName)}&limit=1`
    );

    let folderId;
    if (existing && existing.length > 0) {
      // Folder exists — update total_images and reset classified_count
      folderId = existing[0].id;
      await sbQuery(`/dermsort_folders?id=eq.${folderId}`, {
        method: "PATCH",
        headers: { "Prefer": "return=minimal" },
        body: { total_images: selected.length, classified_count: 0 }
      });
      // Delete old images so we re-upload clean
      await sbQuery(`/dermsort_images?folder_id=eq.${folderId}`, { method: "DELETE" });
    } else {
      // New folder — insert
      const folderRes = await sbQuery("/dermsort_folders", {
        method: "POST",
        headers: { "Prefer": "return=representation" },
        body: { session: SESSION, name: rootName, total_images: selected.length, classified_count: 0 }
      });
      const folder = Array.isArray(folderRes) ? folderRes[0] : folderRes;
      folderId = folder.id;
    }

    // Upload each image
    const imageRows = [];
    for (let i = 0; i < selected.length; i++) {
      const file        = selected[i];
      const relPath     = file.webkitRelativePath;
      // Use real subfolder structure: session/folderId/subfolder/filename
      const subPath     = relPath.split("/").slice(1).join("/"); // strip root folder name
      const storagePath = `${SESSION}/${folderId}/${subPath}`;

      await sbUploadFile(storagePath, file, file.type || "image/jpeg");
      imageRows.push({ folder_id: folderId, storage_path: storagePath, file_name: file.name, relative_path: relPath, category: null });

      const pct = Math.round(((i + 1) / selected.length) * 100);
      progressBar.style.width = pct + "%";
      uploadProgressSub.textContent = `${i + 1} / ${selected.length} images`;
    }

    // Insert image records
    await sbQuery("/dermsort_images", { method: "POST", headers: { "Prefer": "return=minimal" }, body: imageRows });

    uploadOverlay.classList.add("hidden");
    showToast(`"${rootName}" uploaded — ${selected.length} images`);
    await loadFolders();
  } catch (e) {
    uploadOverlay.classList.add("hidden");
    showToast("Upload failed: " + e.message);
    console.error(e);
  }
}

folderInput.addEventListener("change", e => { handleFolderUpload(e.target.files); e.target.value = ""; });
folderInputMore.addEventListener("change", e => { handleFolderUpload(e.target.files); e.target.value = ""; });

// ---- Delete Folder ----
async function deleteFolder(idx) {
  const folder = folders[idx];
  try {
    // Delete storage files
    const imgs = await sbQuery(`/dermsort_images?folder_id=eq.${folder.id}`);
    for (const img of (imgs || [])) {
      await sbDeleteFile(img.storage_path);
    }
    await sbQuery(`/dermsort_images?folder_id=eq.${folder.id}`, { method: "DELETE" });
    await sbQuery(`/dermsort_folders?id=eq.${folder.id}`, { method: "DELETE" });
    folders.splice(idx, 1);
    renderFolderList();
    renderCatCounts();
    showToast("Folder removed.");
  } catch (e) {
    showToast("Delete failed: " + e.message);
  }
}

// ---- Open Folder / Workspace ----
async function openFolder(idx) {
  currentFolderIdx = idx;
  const folder = folders[idx];
  workspaceFolderName.textContent = folder.name;

  uploadSection.classList.add("hidden");
  classifyWorkspace.classList.remove("hidden");
  folderDoneMsg.classList.add("hidden");
  classifyControls.classList.remove("hidden");
  classifyBtnRow.classList.remove("hidden");
  setImgState("loading");

  try {
    const imgs = await sbQuery(`/dermsort_images?folder_id=eq.${folder.id}&order=relative_path.asc`);
    currentImages = (imgs || []).map(img => ({
      ...img,
      public_url: sbPublicUrl(img.storage_path)
    }));

    if (currentImages.length === 0) {
      showFolderDone(true);
      return;
    }

    // Start at first unclassified
    currentImgIdx = currentImages.findIndex(i => !i.category);
    if (currentImgIdx < 0) currentImgIdx = 0;
    showCurrentImage();
  } catch (e) {
    showToast("Failed to load images: " + e.message);
    setImgState("none");
  }
}

function showCurrentImage() {
  if (currentImages.length === 0) { showFolderDone(true); return; }
  const img       = currentImages[currentImgIdx];
  const total     = currentImages.length;
  const unclassed = currentImages.filter(i => !i.category).length;

  imageCounter.textContent = `${currentImgIdx + 1} / ${total}  (${unclassed} unclassified)`;
  currentImgName.textContent = img.relative_path || img.file_name;

  prevImgBtn.disabled = currentImgIdx === 0;
  nextImgBtn.disabled = currentImgIdx === total - 1;

  setImgState("loading");
  const tempImg = new Image();
  tempImg.onload  = () => { classifyImgEl.src = img.public_url; setImgState("image"); };
  tempImg.onerror = () => { setImgState("error"); };
  tempImg.src = img.public_url;

  // Highlight if already classified
  document.querySelectorAll(".classify-btn[data-category]").forEach(b => b.style.outline = "");
  if (img.category) {
    const active = document.querySelector(`.classify-btn[data-category="${img.category}"]`);
    if (active) active.style.outline = "3px solid white";
  }
}

function setImgState(state) {
  classifyImgEl.classList.add("hidden");
  imgLoading.classList.add("hidden");
  noImageMsg.classList.add("hidden");
  if (state === "loading") imgLoading.classList.remove("hidden");
  else if (state === "image") classifyImgEl.classList.remove("hidden");
  else if (state === "none" || state === "error") noImageMsg.classList.remove("hidden");
}

function showFolderDone(noImages) {
  setImgState("none");
  currentImgName.textContent = "";
  imageCounter.textContent   = "";
  // Keep nav arrows visible so user can still browse back, but hide classify buttons
  classifyBtnRow.classList.add("hidden");
  doneText.textContent = noImages ? "No matching images found in this folder." : "All images classified.";
  folderDoneMsg.classList.remove("hidden");
}

// ---- Classify ----
document.querySelectorAll(".classify-btn[data-category]").forEach(btn => {
  if (btn.closest(".move-submenu-btns")) return;
  btn.addEventListener("click", () => classifyImage(currentImgIdx, btn.dataset.category));
});

function flashAndAdvance(callback) {
  const viewer = document.getElementById("image-viewer");
  viewer.classList.remove("classify-flash");
  // Force reflow to restart animation
  void viewer.offsetWidth;
  viewer.classList.add("classify-flash");
  setTimeout(() => {
    viewer.classList.remove("classify-flash");
    callback();
  }, 320);
}

async function classifyImage(imgIdx, category) {
  const img = currentImages[imgIdx];
  if (!img) return;

  const prevCat  = img.category;
  img.category   = category;

  try {
    await sbQuery(`/dermsort_images?id=eq.${img.id}`, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: { category }
    });

    // Update folder classified_count
    const folder = folders[currentFolderIdx];
    if (!prevCat && category) folder.classified_count = (folder.classified_count || 0) + 1;
    if (prevCat && !category) folder.classified_count = Math.max(0, (folder.classified_count || 0) - 1);
    await sbQuery(`/dermsort_folders?id=eq.${folder.id}`, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: { classified_count: folder.classified_count }
    });

    renderFolderList();
    renderCatCounts();

    // Flash then advance to next unclassified
    flashAndAdvance(() => {
      const nextIdx = currentImages.findIndex((im, i) => i > imgIdx && !im.category);
      if (nextIdx >= 0) {
        currentImgIdx = nextIdx;
        showCurrentImage();
      } else {
        const allDone = currentImages.every(i => i.category);
        if (allDone) { showFolderDone(false); }
        else { showCurrentImage(); }
      }
    });
  } catch (e) {
    img.category = prevCat; // rollback
    showToast("Save failed: " + e.message);
  }
}

// ---- Nav Arrows ----
prevImgBtn.addEventListener("click", () => { if (currentImgIdx > 0) { currentImgIdx--; showCurrentImage(); } });
nextImgBtn.addEventListener("click", () => { if (currentImgIdx < currentImages.length - 1) { currentImgIdx++; showCurrentImage(); } });

// ---- Back ----
backBtn.addEventListener("click", goBack);
backBtnDone.addEventListener("click", goBack);
function goBack() {
  currentFolderIdx = null;
  currentImages    = [];
  classifyWorkspace.classList.add("hidden");
  uploadSection.classList.remove("hidden");
  classifyControls.classList.remove("hidden");
  classifyBtnRow.classList.remove("hidden");
  folderDoneMsg.classList.add("hidden");
  classifyImgEl.src = "";
  classifyImgEl.classList.add("hidden");
  imgLoading.classList.add("hidden");
  noImageMsg.classList.add("hidden");
}

// ---- Tabs ----
tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    tabBtns.forEach(b => b.classList.remove("active"));
    tabPanels.forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "saved") loadSavedCategory(activeSavedCat);
  });
});

// ---- Saved Tab ----
catBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    catBtns.forEach(b => b.classList.remove("active-cat"));
    btn.classList.add("active-cat");
    activeSavedCat = btn.dataset.cat;
    savedCategoryTitle.textContent = activeSavedCat;
    loadSavedCategory(activeSavedCat);
  });
});

async function loadSavedCategory(cat) {
  savedEmpty.classList.add("hidden");
  savedGrid.classList.add("hidden");
  savedLoading.classList.remove("hidden");
  savedGrid.innerHTML = "";

  try {
    // Always ensure folders are loaded first
    if (folders.length === 0) {
      const rows = await sbQuery(`/dermsort_folders?session=eq.${encodeURIComponent(SESSION)}&order=created_at.asc`);
      folders = rows || [];
      renderFolderList();
    }

    const folderIds = folders.map(f => f.id);
    if (folderIds.length === 0) {
      savedImages = [];
    } else {
      const idList = folderIds.map(id => `"${id}"`).join(",");
      const rows   = await sbQuery(`/dermsort_images?folder_id=in.(${idList})&category=eq.${encodeURIComponent(cat)}&order=relative_path.asc`);
      savedImages  = (rows || []).map(img => ({ ...img, public_url: sbPublicUrl(img.storage_path) }));
    }
    renderSavedGrid();
  } catch (e) {
    showToast("Failed to load saved images: " + e.message);
  } finally {
    savedLoading.classList.add("hidden");
  }
}

function renderSavedGrid() {
  savedGrid.innerHTML = "";
  savedLoading.classList.add("hidden");

  if (savedImages.length === 0) {
    savedEmpty.classList.remove("hidden");
    savedGrid.classList.add("hidden");
    return;
  }
  savedEmpty.classList.add("hidden");
  savedGrid.classList.remove("hidden");

  savedImages.forEach((img, idx) => {
    const card = document.createElement("div");
    card.className = "saved-thumb";
    const label = img.relative_path ? img.relative_path.split("/").slice(1).join(" / ") : img.file_name;
    card.innerHTML = `
      <img src="${img.public_url}" alt="${esc(img.file_name)}" loading="lazy" />
      <div class="saved-thumb-label">${esc(label)}</div>
    `;
    card.addEventListener("click", () => openLightbox(idx));
    savedGrid.appendChild(card);
  });
}

async function renderCatCounts() {
  // Zero out all counts first so sidebar always shows something
  catBtns.forEach(btn => {
    let badge = btn.querySelector(".cat-count");
    if (!badge) { badge = document.createElement("span"); badge.className = "cat-count"; btn.appendChild(badge); }
    badge.textContent = "…";
  });

  try {
    const folderIds = folders.map(f => f.id);
    if (folderIds.length === 0) {
      catBtns.forEach(btn => { const b = btn.querySelector(".cat-count"); if (b) b.textContent = 0; });
      return;
    }
    const idList = folderIds.map(id => `"${id}"`).join(",");
    for (const cat of CATEGORIES) {
      const rows  = await sbQuery(`/dermsort_images?folder_id=in.(${idList})&category=eq.${encodeURIComponent(cat)}&select=id`);
      const count = (rows || []).length;
      const btn   = document.querySelector(`.cat-btn[data-cat="${cat}"]`);
      if (!btn) continue;
      const badge = btn.querySelector(".cat-count");
      if (badge) badge.textContent = count;
    }
  } catch (_) {
    catBtns.forEach(btn => { const b = btn.querySelector(".cat-count"); if (b) b.textContent = 0; });
  }
}

// ---- Lightbox ----
function openLightbox(idx) {
  lightboxIdx = idx;
  updateLightbox();
  lightbox.classList.remove("hidden");
  moveSubmenu.classList.add("hidden");
}

function updateLightbox() {
  const img = savedImages[lightboxIdx];
  if (!img) return;
  lightboxImg.src            = img.public_url;
  lightboxLabel.textContent  = img.relative_path ? img.relative_path.split("/").slice(1).join(" / ") : img.file_name;
  lightboxCatBadge.textContent = img.category;
  lightboxCatBadge.className   = "lightbox-cat-badge";
  lightboxCatBadge.style.background = getCatColor(img.category);
  lbPrev.disabled = lightboxIdx === 0;
  lbNext.disabled = lightboxIdx === savedImages.length - 1;
  moveSubmenu.classList.add("hidden");
}

function getCatColor(cat) {
  const map = {
    "Atopic Dermatitis": "#e07b54",
    "Sarcoptic Mange": "#c45c8a",
    "Pyotraumatic Dermatitis": "#d4a532",
    "Healthy": "#4caf7d",
    "Unknown": "#7b82a0"
  };
  return map[cat] || "#7b82a0";
}

lightboxClose.addEventListener("click", () => { lightbox.classList.add("hidden"); });
lightbox.addEventListener("click", e => { if (e.target === lightbox) lightbox.classList.add("hidden"); });
lbPrev.addEventListener("click", () => { if (lightboxIdx > 0) { lightboxIdx--; updateLightbox(); } });
lbNext.addEventListener("click", () => { if (lightboxIdx < savedImages.length - 1) { lightboxIdx++; updateLightbox(); } });
lbMoveBtn.addEventListener("click", () => moveSubmenu.classList.toggle("hidden"));

// Move to other category
moveSubmenuBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    const newCat = btn.dataset.category;
    const img    = savedImages[lightboxIdx];
    if (!img || newCat === activeSavedCat) { moveSubmenu.classList.add("hidden"); return; }

    try {
      await sbQuery(`/dermsort_images?id=eq.${img.id}`, {
        method: "PATCH",
        headers: { "Prefer": "return=minimal" },
        body: { category: newCat }
      });
      // Update currentImages if open folder matches
      if (currentImages.length > 0) {
        const ci = currentImages.find(i => i.id === img.id);
        if (ci) ci.category = newCat;
      }
      savedImages.splice(lightboxIdx, 1);
      lightbox.classList.add("hidden");
      renderSavedGrid();
      renderCatCounts();
      renderFolderList();
      showToast(`Moved to ${newCat}`);
    } catch (e) {
      showToast("Move failed: " + e.message);
    }
  });
});

// Revert
lbRevertBtn.addEventListener("click", async () => {
  const img = savedImages[lightboxIdx];
  if (!img) return;
  confirmAction(`Revert "${img.file_name}" to unclassified? It will reappear in its folder.`, async () => {
    try {
      await sbQuery(`/dermsort_images?id=eq.${img.id}`, {
        method: "PATCH",
        headers: { "Prefer": "return=minimal" },
        body: { category: null }
      });
      // Update classified_count
      const folder = folders.find(f => f.id === img.folder_id);
      if (folder) {
        folder.classified_count = Math.max(0, (folder.classified_count || 0) - 1);
        await sbQuery(`/dermsort_folders?id=eq.${folder.id}`, {
          method: "PATCH",
          headers: { "Prefer": "return=minimal" },
          body: { classified_count: folder.classified_count }
        });
      }
      if (currentImages.length > 0) {
        const ci = currentImages.find(i => i.id === img.id);
        if (ci) ci.category = null;
      }
      savedImages.splice(lightboxIdx, 1);
      lightbox.classList.add("hidden");
      renderSavedGrid();
      renderCatCounts();
      renderFolderList();
      showToast("Reverted to unclassified.");
    } catch (e) {
      showToast("Revert failed: " + e.message);
    }
  });
});

// Delete
lbDeleteBtn.addEventListener("click", async () => {
  const img = savedImages[lightboxIdx];
  if (!img) return;
  confirmAction(`Permanently delete "${img.file_name}" from Supabase? Cannot be undone.`, async () => {
    try {
      await sbDeleteFile(img.storage_path);
      await sbQuery(`/dermsort_images?id=eq.${img.id}`, { method: "DELETE" });
      const folder = folders.find(f => f.id === img.folder_id);
      if (folder) {
        folder.total_images      = Math.max(0, folder.total_images - 1);
        folder.classified_count  = Math.max(0, (folder.classified_count || 0) - 1);
        await sbQuery(`/dermsort_folders?id=eq.${folder.id}`, {
          method: "PATCH",
          headers: { "Prefer": "return=minimal" },
          body: { total_images: folder.total_images, classified_count: folder.classified_count }
        });
      }
      if (currentImages.length > 0) {
        const ci = currentImages.findIndex(i => i.id === img.id);
        if (ci >= 0) currentImages.splice(ci, 1);
      }
      savedImages.splice(lightboxIdx, 1);
      lightbox.classList.add("hidden");
      renderSavedGrid();
      renderCatCounts();
      renderFolderList();
      showToast("Image deleted.");
    } catch (e) {
      showToast("Delete failed: " + e.message);
    }
  });
});

// ---- Export ZIP ----
exportBtn.addEventListener("click", async () => {
  if (savedImages.length === 0) { showToast("No images to export."); return; }

  exportBtn.textContent = "Preparing…";
  exportBtn.disabled    = true;

  try {
    if (typeof JSZip === "undefined") await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
    if (typeof saveAs === "undefined") await loadScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js");

    const zip       = new JSZip();
    const catFolder = zip.folder(activeSavedCat);
    for (const img of savedImages) {
      const blob    = await fetch(img.public_url).then(r => r.blob());
      const subPath = img.relative_path ? img.relative_path.split("/").slice(1).join("/") : img.file_name;
      catFolder.file(subPath, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `${activeSavedCat.replace(/ /g, "_")}.zip`);
  } catch (e) {
    showToast("Export failed: " + e.message);
  } finally {
    exportBtn.textContent = "Export ZIP";
    exportBtn.disabled    = false;
  }
});

// ---- Confirm Modal ----
let pendingAction = null;
function confirmAction(msg, action) {
  confirmText.textContent = msg;
  pendingAction = action;
  confirmModal.classList.remove("hidden");
}
confirmYes.addEventListener("click", async () => {
  confirmModal.classList.add("hidden");
  if (pendingAction) { await pendingAction(); pendingAction = null; }
});
confirmNo.addEventListener("click", () => { confirmModal.classList.add("hidden"); pendingAction = null; });

// ---- Toast ----
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 3500);
}

// ---- Keyboard ----
document.addEventListener("keydown", e => {
  if (!lightbox.classList.contains("hidden")) {
    if (e.key === "ArrowLeft")  lbPrev.click();
    if (e.key === "ArrowRight") lbNext.click();
    if (e.key === "Escape")     { lightbox.classList.add("hidden"); moveSubmenu.classList.add("hidden"); }
    return;
  }
  if (!classifyWorkspace.classList.contains("hidden") && currentFolderIdx !== null) {
    if (e.key === "ArrowLeft")  prevImgBtn.click();
    if (e.key === "ArrowRight") nextImgBtn.click();
    const map = { "1": CATEGORIES[0], "2": CATEGORIES[1], "3": CATEGORIES[2], "4": CATEGORIES[3], "5": CATEGORIES[4] };
    if (map[e.key]) classifyImage(currentImgIdx, map[e.key]);
  }
});

// ---- Helpers ----
function esc(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function loadScript(src) { return new Promise((res,rej)=>{ const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); }
