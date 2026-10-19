const DEFAULT_CATEGORIES = [
  { id: "pokok", label: "Kebutuhan Pokok", ratio: 0.2, icon: "🍚", color: "#2563eb" },
  { id: "tagihan", label: "Tagihan", ratio: 0.4, icon: "⚡", color: "#7c3aed" },
  { id: "investasi", label: "Investasi", ratio: 0.2, icon: "📈", color: "#059669" },
  { id: "darurat", label: "Dana Darurat", ratio: 0.1, icon: "🛡️", color: "#d97706" },
  { id: "shodaqoh", label: "Shodaqoh", ratio: 0.1, icon: "🤲", color: "#0d9488" }
];

const STORAGE_KEY = "dompet_pintar_v4_storage";

let appData = {
  darkMode: false,
  hideGuides: false,
  categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
  goals: [],
  months: {}
};

// State untuk CamScanner Struk
let rawReceiptImage = null;
let currentScanFilter = "magic";
let currentScanRotation = 0;
let currentScannedDataUrl = null;

function getNowMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPrevMonthStr(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatRp(num) {
  const n = Math.round(Number(num) || 0);
  return (n < 0 ? "-Rp " : "Rp ") + Math.abs(n).toLocaleString("id-ID");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function getCatById(id) {
  return appData.categories.find(c => c.id === id) || { id, label: id, ratio: 0, icon: "📁", color: "#64748b" };
}

function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("dompet_pintar_v3_storage");
  if (raw) {
    try {
      const p = JSON.parse(raw);
      appData.darkMode = !!p.darkMode;
      appData.hideGuides = !!p.hideGuides;
      if (Array.isArray(p.categories) && p.categories.length > 0) {
        appData.categories = p.categories;
      }
      appData.goals = p.goals || [];
      appData.months = p.months || {};
    } catch (e) {
      console.error(e);
    }
  }
  document.body.classList.toggle("dark-mode", appData.darkMode);
  document.body.classList.toggle("hide-guides", appData.hideGuides);
}

function saveStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  } catch (e) {
    alert("Penyimpanan lokal penuh! Anda bisa menghapus struk lama atau melakukan Backup JSON.");
  }
}

function ensureMonth(monthKey) {
  if (!appData.months[monthKey]) {
    appData.months[monthKey] = {
      allocated: {},
      spent: {},
      subPosts: [],
      transactions: []
    };
  }
  const m = appData.months[monthKey];
  if (!m.subPosts) m.subPosts = [];
  if (!m.transactions) m.transactions = [];
  appData.categories.forEach(c => {
    if (m.allocated[c.id] === undefined) m.allocated[c.id] = 0;
    if (m.spent[c.id] === undefined) m.spent[c.id] = 0;
  });
  return m;
}

function recalculateMonth(monthKey) {
  const m = ensureMonth(monthKey);
  m.allocated = {};
  m.spent = {};
  appData.categories.forEach(c => {
    m.allocated[c.id] = 0;
    m.spent[c.id] = 0;
  });

  m.subPosts.forEach(sp => { sp.spent = 0; });

  m.transactions.forEach(tx => {
    if (tx.type === "salary" || tx.type === "income_split") {
      appData.categories.forEach(c => {
        const share = (tx.breakdown && tx.breakdown[c.id] !== undefined)
          ? tx.breakdown[c.id]
          : Math.round(tx.amount * (c.ratio || 0));
        m.allocated[c.id] = (m.allocated[c.id] || 0) + share;
      });
    } else if (tx.type === "income_single") {
      m.allocated[tx.category] = (m.allocated[tx.category] || 0) + tx.amount;
    } else if (tx.type === "expense") {
      m.spent[tx.category] = (m.spent[tx.category] || 0) + tx.amount;
      if (tx.subPostId) {
        const sp = m.subPosts.find(s => s.id === tx.subPostId);
        if (sp) sp.spent = (sp.spent || 0) + tx.amount;
      }
    } else if (tx.type === "transfer") {
      m.allocated[tx.fromCat] = (m.allocated[tx.fromCat] || 0) - tx.amount;
      m.allocated[tx.toCat] = (m.allocated[tx.toCat] || 0) + tx.amount;
    }
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === tabId);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ================== MESIN CAMSCANNER STRUK ================== */
function renderCamScannerCanvas() {
  if (!rawReceiptImage) return;
  const canvas = document.getElementById("scannerCanvas");
  const ctx = canvas.getContext("2d");

  // Batasi ukuran maksimum 850px agar tajam tapi hemat memori LocalStorage
  const MAX_DIM = 850;
  let w = rawReceiptImage.width;
  let h = rawReceiptImage.height;
  if (w > h && w > MAX_DIM) {
    h = Math.round((h * MAX_DIM) / w);
    w = MAX_DIM;
  } else if (h >= w && h > MAX_DIM) {
    w = Math.round((w * MAX_DIM) / h);
    h = MAX_DIM;
  }

  const rot = ((currentScanRotation % 360) + 360) % 360;
  if (rot === 90 || rot === 270) {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(rawReceiptImage, -w / 2, -h / 2, w, h);
  ctx.restore();

  if (currentScanFilter === "original") return;

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;
  const strength = Number(document.getElementById("contrastSlider").value) || 60;

  // Hitung rata-rata pencahayaan gambar untuk pemutih kertas adaptif
  let totalLum = 0;
  const pixelCount = d.length / 4;
  for (let i = 0; i < d.length; i += 16) {
    totalLum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  const avgLum = totalLum / (pixelCount / 4);

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if (currentScanFilter === "gray") {
      // Grayscale dengan penguatan kontras
      const factor = 1 + (strength / 100) * 1.2;
      let val = (lum - 128) * factor + 138;
      val = Math.max(0, Math.min(255, val));
      d[i] = d[i + 1] = d[i + 2] = val;
    } else if (currentScanFilter === "bw") {
      // Dokumen Hitam-Putih Tajam (Threshold seperti mesin fotokopi/scanner)
      const thresh = avgLum * (0.72 + (strength / 100) * 0.32);
      const val = lum > thresh ? 255 : (lum < thresh * 0.75 ? 0 : 40);
      d[i] = d[i + 1] = d[i + 2] = val;
    } else if (currentScanFilter === "magic") {
      // CamScanner Magic Color: Kertas kusam diputihkan, teks & cap warna dipertahankan tajam
      const whitePoint = avgLum * (1.08 - (strength / 100) * 0.22);
      const blackPoint = avgLum * (0.42 + (strength / 100) * 0.18);

      if (lum >= whitePoint) {
        // Putih bersih untuk area kertas struk
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
      } else if (lum <= blackPoint) {
        // Gelapkan tinta teks agar tajam terbaca
        const darken = 0.35;
        d[i] = Math.max(0, r * darken);
        d[i + 1] = Math.max(0, g * darken);
        d[i + 2] = Math.max(0, b * darken);
      } else {
        // Area transisi diperkuat saturasi & kontrasnya
        const norm = (lum - blackPoint) / Math.max(1, whitePoint - blackPoint);
        const boost = norm * 255;
        d[i] = Math.min(255, (r / Math.max(1, lum)) * boost);
        d[i + 1] = Math.min(255, (g / Math.max(1, lum)) * boost);
        d[i + 2] = Math.min(255, (b / Math.max(1, lum)) * boost);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

function initScannerStudio() {
  const fileInp = document.getElementById("receiptFileInput");
  const modal = document.getElementById("scannerModal");
  const slider = document.getElementById("contrastSlider");
  const sliderLbl = document.getElementById("contrastValLabel");

  fileInp.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        rawReceiptImage = img;
        currentScanRotation = 0;
        currentScanFilter = "magic";
        document.querySelectorAll(".filter-chip").forEach(c => {
          c.classList.toggle("active", c.getAttribute("data-filter") === "magic");
        });
        modal.style.display = "flex";
        renderCamScannerCanvas();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll(".filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentScanFilter = btn.getAttribute("data-filter");
      renderCamScannerCanvas();
    });
  });

  slider.addEventListener("input", () => {
    sliderLbl.textContent = `${slider.value}%`;
    renderCamScannerCanvas();
  });

  document.getElementById("rotateScanBtn").addEventListener("click", () => {
    currentScanRotation = (currentScanRotation + 90) % 360;
    renderCamScannerCanvas();
  });

  const closeScanner = () => {
    modal.style.display = "none";
    fileInp.value = "";
  };

  document.getElementById("closeScannerModalBtn").addEventListener("click", closeScanner);
  document.getElementById("cancelScanBtn").addEventListener("click", closeScanner);

  document.getElementById("applyScanBtn").addEventListener("click", () => {
    const canvas = document.getElementById("scannerCanvas");
    currentScannedDataUrl = canvas.toDataURL("image/jpeg", 0.72);
    document.getElementById("receiptThumbImg").src = currentScannedDataUrl;
    document.getElementById("receiptAttachedPreview").style.display = "flex";
    modal.style.display = "none";
    showToast("✨ Struk berhasil diproses dengan CamScanner!");
  });

  document.getElementById("reEditReceiptBtn").addEventListener("click", () => {
    if (rawReceiptImage) {
      modal.style.display = "flex";
      renderCamScannerCanvas();
    }
  });

  document.getElementById("removeReceiptBtn").addEventListener("click", () => {
    currentScannedDataUrl = null;
    rawReceiptImage = null;
    document.getElementById("receiptAttachedPreview").style.display = "none";
    fileInp.value = "";
    showToast("Lampiran struk dihapus");
  });

  // Modal Lihat Struk Penuh
  document.getElementById("closeViewReceiptBtn").addEventListener("click", () => {
    document.getElementById("viewReceiptModal").style.display = "none";
  });
}

function openReceiptViewer(tx) {
  if (!tx.receiptImage) return;
  document.getElementById("viewReceiptTitle").textContent = `🧾 ${tx.description}`;
  document.getElementById("viewReceiptMeta").textContent = `Tanggal: ${tx.date} • Nominal: ${formatRp(tx.amount)}`;
  document.getElementById("fullReceiptViewImg").src = tx.receiptImage;
  const dl = document.getElementById("downloadReceiptLink");
  dl.href = tx.receiptImage;
  dl.download = `Struk-${tx.date}-${tx.description.replace(/[^a-zA-Z0-9]/g, "_")}.jpg`;
  document.getElementById("viewReceiptModal").style.display = "flex";
}

/* ================== RENDER & LOGIKA UTAMA ================== */
function populateCategoryDropdowns() {
  const ids = ["subPostCategory", "txCategory", "transferFrom", "transferTo"];
  ids.forEach(selId => {
    const el = document.getElementById(selId);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = "";
    appData.categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.icon} ${c.label} (${Math.round(c.ratio * 100)}%)`;
      el.appendChild(opt);
    });
    if (prev && appData.categories.some(c => c.id === prev)) {
      el.value = prev;
    }
  });

  const filterSub = document.getElementById("filterSubPostCat");
  filterSub.innerHTML = `<option value="all">Semua Pos</option>`;
  const filterHist = document.getElementById("filterCategory");
  filterHist.innerHTML = `<option value="all">Semua Pos</option><option value="gaji">💰 Alokasi Gaji</option>`;

  appData.categories.forEach(c => {
    filterSub.innerHTML += `<option value="${c.id}">${c.icon} ${c.label}</option>`;
    filterHist.innerHTML += `<option value="${c.id}">${c.icon} ${c.label}</option>`;
  });
}

function updateSalaryLivePreview() {
  const val = Number(document.getElementById("salaryInput").value) || 0;
  const box = document.getElementById("salaryPreviewBox");
  const list = document.getElementById("salaryPreviewList");
  if (val <= 0) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  list.innerHTML = "";
  appData.categories.forEach(c => {
    const share = Math.round(val * (c.ratio || 0));
    list.innerHTML += `
      <div class="preview-item">
        <span>${c.icon} ${c.label} (${c.ratio})</span>
        <strong>${formatRp(share)}</strong>
      </div>
    `;
  });
}

function renderAll() {
  const monthKey = document.getElementById("currentMonth").value;
  populateCategoryDropdowns();
  recalculateMonth(monthKey);
  const m = ensureMonth(monthKey);

  let totalAlloc = 0;
  let totalSpent = 0;
  appData.categories.forEach(c => {
    totalAlloc += (m.allocated[c.id] || 0);
    totalSpent += (m.spent[c.id] || 0);
  });
  const totalRem = totalAlloc - totalSpent;

  document.getElementById("totalRemainingBalance").textContent = formatRp(totalRem);
  document.getElementById("totalIncomeDisplay").textContent = formatRp(totalAlloc);
  document.getElementById("totalExpenseDisplay").textContent = formatRp(totalSpent);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remDays = Math.max(1, daysInMonth - now.getDate() + 1);
  const dailySafe = totalRem > 0 ? Math.floor(totalRem / remDays) : 0;
  document.getElementById("dailySafeLimit").textContent = `${formatRp(dailySafe)} / hari (${remDays} hr lagi)`;

  const badge = document.getElementById("healthBadge");
  const usedRatio = totalAlloc > 0 ? (totalSpent / totalAlloc) * 100 : 0;
  if (totalAlloc === 0) {
    badge.textContent = "Belum Isi Gaji";
    badge.style.background = "#64748b";
  } else if (usedRatio < 75) {
    badge.textContent = "Keuangan Sehat";
    badge.style.background = "#10b981";
  } else if (usedRatio <= 95) {
    badge.textContent = "Mulai Menipis";
    badge.style.background = "#d97706";
  } else {
    badge.textContent = "Overbudget!";
    badge.style.background = "#dc2626";
  }

  const container = document.getElementById("budgetCardsContainer");
  container.innerHTML = "";
  const totalRatioSum = appData.categories.reduce((acc, c) => acc + Number(c.ratio || 0), 0);
  document.getElementById("ratioSumBadge").textContent =
    `Total Rasio: ${totalRatioSum.toFixed(2)} (${Math.round(totalRatioSum * 100)}%)`;

  appData.categories.forEach(c => {
    const alloc = m.allocated[c.id] || 0;
    const spent = m.spent[c.id] || 0;
    const rem = alloc - spent;
    const pct = alloc > 0 ? Math.min(100, Math.round((spent / alloc) * 100)) : (spent > 0 ? 100 : 0);
    let barColor = c.color;
    if (pct >= 90) barColor = "#dc2626";
    else if (pct >= 75) barColor = "#d97706";

    const card = document.createElement("div");
    card.className = "budget-card";
    card.style.borderLeftColor = c.color;
    card.innerHTML = `
      <div class="b-top">
        <span class="b-name">${c.icon} ${c.label}</span>
        <span class="tag-pill">Rasio ${c.ratio} (${Math.round(c.ratio * 100)}%)</span>
      </div>
      <div class="b-nums">
        <span>Sisa Saldo: <strong>${formatRp(rem)}</strong></span>
        <span>Terpakai: ${formatRp(spent)} dari ${formatRp(alloc)}</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill" style="width:${pct}%; background:${barColor}"></div>
      </div>
      <div class="b-actions">
        <button data-qcat="${c.id}" data-qmode="expense">📤 Pakai Uang / Scan Struk</button>
        <button data-qcat="${c.id}" data-qmode="income_single">📥 + Tambah Uang</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("button[data-qcat]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.getAttribute("data-qcat");
      const mode = btn.getAttribute("data-qmode");
      switchTab("tab-tx");
      const r = document.querySelector(`input[name="txMode"][value="${mode}"]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event("change")); }
      document.getElementById("txCategory").value = cat;
      updateTxCategoryHint();
      document.getElementById("txAmount").focus();
    });
  });

  renderSubPosts(monthKey);
  renderRatioEditor();
  renderGoals();
  renderTransactions(monthKey);
  updateTxCategoryHint();
}

function updateTxCategoryHint() {
  const monthKey = document.getElementById("currentMonth").value;
  const m = ensureMonth(monthKey);
  const catId = document.getElementById("txCategory").value;
  if (!catId) return;
  const c = getCatById(catId);
  const rem = (m.allocated[catId] || 0) - (m.spent[catId] || 0);
  document.getElementById("selectedCatRemaining").textContent =
    `Sisa uang di pos ${c.label}: ${formatRp(rem)}`;

  const subSel = document.getElementById("txSubPostId");
  subSel.innerHTML = `<option value="">-- Tidak dikaitkan (Pengeluaran langsung) --</option>`;
  m.subPosts.filter(sp => sp.category === catId).forEach(sp => {
    const sRem = sp.budget - (sp.spent || 0);
    subSel.innerHTML += `<option value="${sp.id}">${sp.title} (Sisa target: ${formatRp(sRem)})</option>`;
  });
}

function renderSubPosts(monthKey) {
  const m = ensureMonth(monthKey);
  const filterCat = document.getElementById("filterSubPostCat").value;
  const box = document.getElementById("subPostListContainer");
  box.innerHTML = "";

  const list = m.subPosts.filter(sp => filterCat === "all" || sp.category === filterCat);
  if (list.length === 0) {
    box.innerHTML = `<div class="card"><p class="helper" style="text-align:center;margin:0;">Belum ada rencana pos pengeluaran di bulan ini.</p></div>`;
    return;
  }

  list.forEach(sp => {
    const c = getCatById(sp.category);
    const spent = sp.spent || 0;
    const rem = sp.budget - spent;
    const pct = sp.budget > 0 ? Math.min(100, Math.round((spent / sp.budget) * 100)) : 0;

    const div = document.createElement("div");
    div.className = "budget-card";
    div.style.borderLeftColor = c.color;
    div.innerHTML = `
      <div class="b-top">
        <span class="b-name">📌 ${sp.title}</span>
        <span class="tag-pill">${c.icon} ${c.label}</span>
      </div>
      <div class="b-nums">
        <span>Sisa Jatah: <strong>${formatRp(rem)}</strong></span>
        <span>Terpakai: ${formatRp(spent)} / ${formatRp(sp.budget)}</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill" style="width:${pct}%; background:${c.color}"></div>
      </div>
      <div class="b-actions">
        <button class="sp-pay" data-id="${sp.id}" style="background:var(--danger);color:#fff;border:none;">📤 Bayar Pos Ini</button>
        <button class="sp-topup" data-id="${sp.id}" style="background:var(--success);color:#fff;border:none;">📥 + Tambah Dana</button>
        <button class="sp-del" data-id="${sp.id}" style="flex:0 0 42px;">🗑️</button>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".sp-pay").forEach(btn => {
    btn.addEventListener("click", () => {
      const sp = m.subPosts.find(s => s.id === btn.getAttribute("data-id"));
      if (!sp) return;
      const defVal = Math.max(0, sp.budget - (sp.spent || 0)) || sp.budget;
      const inp = prompt(`Nominal pembayaran untuk "${sp.title}" (Rp):`, defVal);
      if (!inp) return;
      const amount = Number(inp);
      if (isNaN(amount) || amount <= 0) return alert("Nominal tidak valid!");

      m.transactions.push({
        id: "tx_" + Date.now(),
        type: "expense",
        category: sp.category,
        subPostId: sp.id,
        amount,
        date: getTodayStr(),
        description: `[Pos: ${sp.title}] Pembayaran`
      });
      saveStorage();
      renderAll();
      showToast(`Pengeluaran "${sp.title}" berhasil dicatat!`);
    });
  });

  box.querySelectorAll(".sp-topup").forEach(btn => {
    btn.addEventListener("click", () => {
      const sp = m.subPosts.find(s => s.id === btn.getAttribute("data-id"));
      if (!sp) return;
      const inp = prompt(`Tambahan dana untuk "${sp.title}" (Rp):`, "50000");
      if (!inp) return;
      const amount = Number(inp);
      if (isNaN(amount) || amount <= 0) return alert("Nominal tidak valid!");

      sp.budget += amount;
      m.transactions.push({
        id: "tx_" + Date.now(),
        type: "income_single",
        category: sp.category,
        subPostId: sp.id,
        amount,
        date: getTodayStr(),
        description: `[Tambah Dana Pos: ${sp.title}]`
      });
      saveStorage();
      renderAll();
      showToast(`Dana ditambahkan ke pos "${sp.title}"!`);
    });
  });

  box.querySelectorAll(".sp-del").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Hapus pos pengeluaran ini?")) {
        m.subPosts = m.subPosts.filter(s => s.id !== btn.getAttribute("data-id"));
        saveStorage();
        renderAll();
      }
    });
  });
}

function renderRatioEditor() {
  const list = document.getElementById("customRatioList");
  list.innerHTML = "";

  appData.categories.forEach(c => {
    const row = document.createElement("div");
    row.className = "ratio-item";
    row.innerHTML = `
      <div class="ratio-item-title">
        <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c.color}"></span>
        <span>${c.icon} ${c.label}</span>
      </div>
      <div class="ratio-input-wrap">
        <input type="number" step="0.01" min="0" max="1" class="ratio-edit-input" data-id="${c.id}" value="${c.ratio}" />
        <span class="pct-label">(${Math.round(c.ratio * 100)}%)</span>
      </div>
      <button type="button" class="del-cat-btn" data-id="${c.id}">🗑️</button>
    `;
    list.appendChild(row);
  });

  const updateLiveTotal = () => {
    let sum = 0;
    list.querySelectorAll(".ratio-edit-input").forEach(inp => {
      const v = parseFloat(inp.value) || 0;
      sum += v;
      inp.nextElementSibling.textContent = `(${Math.round(v * 100)}%)`;
    });
    const badge = document.getElementById("liveRatioTotalText");
    badge.textContent = `Total: ${sum.toFixed(2)} (${Math.round(sum * 100)}%)`;
    badge.style.color = Math.abs(sum - 1.0) <= 0.005 ? "#10b981" : "#dc2626";
  };

  list.querySelectorAll(".ratio-edit-input").forEach(inp => inp.addEventListener("input", updateLiveTotal));

  list.querySelectorAll(".del-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (appData.categories.length <= 1) return alert("Minimal harus ada 1 pos anggaran!");
      const id = btn.getAttribute("data-id");
      const cat = getCatById(id);
      if (confirm(`Hapus pos "${cat.label}"?`)) {
        appData.categories = appData.categories.filter(c => c.id !== id);
        saveStorage();
        renderAll();
      }
    });
  });

  updateLiveTotal();
}

function renderGoals() {
  const box = document.getElementById("goalsList");
  box.innerHTML = "";
  if (appData.goals.length === 0) {
    box.innerHTML = `<p class="helper" style="text-align:center;">Belum ada target tabungan impian.</p>`;
    return;
  }

  appData.goals.forEach(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
    const div = document.createElement("div");
    div.className = "budget-card";
    div.style.borderLeftColor = "#10b981";
    div.innerHTML = `
      <div class="b-top">
        <span class="b-name">🏆 ${g.title}</span>
        <span class="tag-pill">${pct}% Tercapai</span>
      </div>
      <div class="b-nums">
        <span>Terkumpul: <strong>${formatRp(g.saved)}</strong></span>
        <span>Target: ${formatRp(g.target)}</span>
      </div>
      <div class="bar-bg">
        <div class="bar-fill" style="width:${pct}%; background:#10b981;"></div>
      </div>
      <div class="b-actions">
        <button class="goal-add" data-id="${g.id}">➕ Tabung</button>
        <button class="goal-del" data-id="${g.id}" style="flex:0 0 42px;">🗑️</button>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".goal-add").forEach(btn => {
    btn.addEventListener("click", () => {
      const g = appData.goals.find(x => x.id === btn.getAttribute("data-id"));
      if (!g) return;
      const inp = prompt(`Tambah tabungan untuk "${g.title}" (Rp):`, "100000");
      if (!inp) return;
      const v = Number(inp);
      if (isNaN(v) || v <= 0) return;
      g.saved += v;
      saveStorage();
      renderGoals();
    });
  });

  box.querySelectorAll(".goal-del").forEach(btn => {
    btn.addEventListener("click", () => {
      appData.goals = appData.goals.filter(x => x.id !== btn.getAttribute("data-id"));
      saveStorage();
      renderGoals();
    });
  });
}

function renderTransactions(monthKey) {
  const m = ensureMonth(monthKey);
  const fCat = document.getElementById("filterCategory").value;
  const q = (document.getElementById("searchTxInput").value || "").toLowerCase().trim();
  const list = document.getElementById("transactionList");
  list.innerHTML = "";

  const filtered = m.transactions.filter(t => {
    const matchCat = fCat === "all" ||
      (fCat === "gaji" && (t.type === "salary" || t.type === "income_split")) ||
      t.category === fCat;
    const matchQ = !q || (t.description || "").toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<p class="helper" style="text-align:center;padding:12px 0;">Belum ada catatan transaksi.</p>`;
    return;
  }

  filtered.slice().reverse().forEach(tx => {
    const isPlus = tx.type === "salary" || tx.type === "income_split" || tx.type === "income_single";
    let catLabel = "💰 Alokasi Semua Pos";
    if (tx.type === "transfer") {
      catLabel = `🔄 Pindah: ${getCatById(tx.fromCat).label} ➔ ${getCatById(tx.toCat).label}`;
    } else if (tx.category && tx.category !== "gaji") {
      const c = getCatById(tx.category);
      catLabel = `${c.icon} ${c.label}`;
    }

    const receiptBtnHtml = tx.receiptImage
      ? `<button class="view-receipt-btn" data-viewid="${tx.id}">🧾 Lihat Struk</button>`
      : "";

    const item = document.createElement("div");
    item.className = "tx-item";
    item.innerHTML = `
      <div class="tx-info">
        <h4>${tx.description}</h4>
        <div class="tx-meta">${tx.date} • ${catLabel}</div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${tx.type === 'transfer' ? '' : (isPlus ? 'plus' : 'minus')}">
          ${tx.type === 'transfer' ? '🔄 ' : (isPlus ? '+' : '-')}${formatRp(tx.amount)}
        </span>
        ${receiptBtnHtml}
        <button class="del-cat-btn" data-txid="${tx.id}">Hapus</button>
      </div>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll("button[data-viewid]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tx = m.transactions.find(t => t.id === btn.getAttribute("data-viewid"));
      if (tx) openReceiptViewer(tx);
    });
  });

  list.querySelectorAll("button[data-txid]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-txid");
      m.transactions = m.transactions.filter(t => t.id !== id);
      saveStorage();
      renderAll();
      showToast("Transaksi dihapus & saldo disesuaikan");
    });
  });
}

function initEvents() {
  const monthPicker = document.getElementById("currentMonth");
  monthPicker.value = getNowMonthStr();
  monthPicker.addEventListener("change", () => renderAll());

  document.getElementById("txDate").value = getTodayStr();

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    appData.darkMode = !appData.darkMode;
    document.body.classList.toggle("dark-mode", appData.darkMode);
    saveStorage();
  });

  document.getElementById("toggleGuideBtn").addEventListener("click", () => {
    appData.hideGuides = !appData.hideGuides;
    document.body.classList.toggle("hide-guides", appData.hideGuides);
    saveStorage();
    showToast(appData.hideGuides ? "Panduan disembunyikan" : "Panduan ditampilkan");
  });

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
  });

  document.getElementById("btnQuickSalary").addEventListener("click", () => {
    switchTab("tab-home");
    document.getElementById("salaryInput").focus();
  });

  document.getElementById("btnGoRatio").addEventListener("click", () => switchTab("tab-ratio"));
  document.getElementById("fabQuickAdd").addEventListener("click", () => {
    switchTab("tab-tx");
    document.getElementById("txAmount").focus();
  });

  document.querySelectorAll(".chip-add").forEach(chip => {
    chip.addEventListener("click", () => {
      const target = document.getElementById(chip.getAttribute("data-target"));
      target.value = (Number(target.value) || 0) + (Number(chip.getAttribute("data-val")) || 0);
      target.dispatchEvent(new Event("input"));
    });
  });

  document.querySelectorAll(".chip-clear").forEach(chip => {
    chip.addEventListener("click", () => {
      const target = document.getElementById(chip.getAttribute("data-target"));
      target.value = "";
      target.dispatchEvent(new Event("input"));
    });
  });

  document.getElementById("salaryInput").addEventListener("input", updateSalaryLivePreview);

  document.getElementById("btnCarryOver").addEventListener("click", () => {
    const currKey = monthPicker.value;
    const prevKey = getPrevMonthStr(currKey);
    recalculateMonth(prevKey);
    const prevM = ensureMonth(prevKey);

    let totalRem = 0;
    const breakdown = {};
    appData.categories.forEach(c => {
      const r = Math.max(0, (prevM.allocated[c.id] || 0) - (prevM.spent[c.id] || 0));
      breakdown[c.id] = r;
      totalRem += r;
    });

    if (totalRem <= 0) return alert(`Tidak ada sisa saldo positif di bulan lalu (${prevKey}).`);

    if (confirm(`Tarik sisa saldo bulan lalu (${prevKey}) sebesar ${formatRp(totalRem)} ke bulan ini?`)) {
      const currM = ensureMonth(currKey);
      currM.transactions.push({
        id: "tx_" + Date.now(),
        type: "income_split",
        category: "gaji",
        amount: totalRem,
        breakdown,
        date: getTodayStr(),
        description: `Sisa Saldo Bulan Lalu (${prevKey})`
      });
      saveStorage();
      renderAll();
      showToast("Sisa saldo bulan lalu ditarik!");
    }
  });

  document.getElementById("salaryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = ensureMonth(monthPicker.value);
    const amount = Number(document.getElementById("salaryInput").value);
    const note = document.getElementById("salaryNote").value.trim() || "Gaji Bulanan";
    const keepOld = document.getElementById("carryOverCheck").checked;

    if (!keepOld) m.transactions = m.transactions.filter(t => t.type !== "salary");

    const breakdown = {};
    appData.categories.forEach(c => {
      breakdown[c.id] = Math.round(amount * (c.ratio || 0));
    });

    m.transactions.push({
      id: "tx_" + Date.now(),
      type: "salary",
      category: "gaji",
      amount,
      breakdown,
      date: getTodayStr(),
      description: note
    });

    saveStorage();
    renderAll();
    document.getElementById("salaryForm").reset();
    document.getElementById("carryOverCheck").checked = true;
    updateSalaryLivePreview();
    showToast("Gaji berhasil dibagi otomatis ke semua pos!");
  });

  document.getElementById("subPostForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = ensureMonth(monthPicker.value);
    const title = document.getElementById("subPostTitle").value.trim();
    const category = document.getElementById("subPostCategory").value;
    const budget = Number(document.getElementById("subPostBudget").value);

    m.subPosts.push({ id: "sp_" + Date.now(), title, category, budget, spent: 0 });
    saveStorage();
    renderAll();
    document.getElementById("subPostForm").reset();
    showToast(`Pos pengeluaran "${title}" dibuat!`);
  });

  document.getElementById("filterSubPostCat").addEventListener("change", () => renderSubPosts(monthPicker.value));

  document.querySelectorAll('input[name="txMode"]').forEach(r => {
    r.addEventListener("change", () => {
      document.querySelectorAll(".mode-card").forEach(mc => mc.classList.remove("active"));
      r.parentElement.classList.add("active");
      const isSplit = r.value === "income_split";
      document.getElementById("categoryGroup").style.display = isSplit ? "none" : "block";
      document.getElementById("subPostLinkGroup").style.display = isSplit ? "none" : "block";
    });
  });

  document.getElementById("txCategory").addEventListener("change", updateTxCategoryHint);

  // Simpan Transaksi (Beserta Hasil Scan Struk jika ada)
  document.getElementById("transactionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = ensureMonth(monthPicker.value);
    const mode = document.querySelector('input[name="txMode"]:checked').value;
    const category = document.getElementById("txCategory").value;
    const subPostId = document.getElementById("txSubPostId").value || null;
    const amount = Number(document.getElementById("txAmount").value);
    const desc = document.getElementById("txDesc").value.trim();
    const date = document.getElementById("txDate").value || getTodayStr();

    const newTx = {
      id: "tx_" + Date.now(),
      type: mode,
      category: mode === "income_split" ? "gaji" : category,
      subPostId,
      amount,
      date,
      description: desc,
      receiptImage: currentScannedDataUrl || null
    };

    if (mode === "income_split") {
      newTx.breakdown = {};
      appData.categories.forEach(c => {
        newTx.breakdown[c.id] = Math.round(amount * (c.ratio || 0));
      });
    }

    m.transactions.push(newTx);
    saveStorage();

    // Reset form & state struk
    currentScannedDataUrl = null;
    rawReceiptImage = null;
    document.getElementById("receiptAttachedPreview").style.display = "none";
    document.getElementById("receiptFileInput").value = "";
    document.getElementById("txAmount").value = "";
    document.getElementById("txDesc").value = "";

    renderAll();
    showToast(newTx.receiptImage ? "✅ Transaksi & Struk CamScanner tersimpan!" : "✅ Transaksi berhasil disimpan!");
  });

  document.getElementById("transferForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const m = ensureMonth(monthPicker.value);
    const fromCat = document.getElementById("transferFrom").value;
    const toCat = document.getElementById("transferTo").value;
    const amount = Number(document.getElementById("transferAmount").value);
    if (fromCat === toCat) return alert("Pilih pos tujuan yang berbeda!");

    m.transactions.push({
      id: "tx_" + Date.now(),
      type: "transfer",
      fromCat,
      toCat,
      amount,
      date: getTodayStr(),
      description: `Pindah Saldo ke ${getCatById(toCat).label}`
    });
    saveStorage();
    renderAll();
    document.getElementById("transferAmount").value = "";
    showToast("Saldo berhasil dipindahkan!");
  });

  document.getElementById("saveRatiosBtn").addEventListener("click", () => {
    const inputs = document.querySelectorAll(".ratio-edit-input");
    let sum = 0;
    const updated = {};
    inputs.forEach(inp => {
      const val = parseFloat(inp.value) || 0;
      updated[inp.getAttribute("data-id")] = val;
      sum += val;
    });

    if (Math.abs(sum - 1.0) > 0.01) {
      if (!confirm(`Total rasio saat ini ${sum.toFixed(2)}. Seimbangkan otomatis agar pas 1.00 (100%)?`)) return;
      appData.categories.forEach(c => {
        c.ratio = sum > 0 ? Number((updated[c.id] / sum).toFixed(2)) : 0;
      });
    } else {
      appData.categories.forEach(c => { c.ratio = updated[c.id]; });
    }
    saveStorage();
    renderAll();
    showToast("Pengaturan rasio disimpan!");
  });

  document.getElementById("autoNormalizeBtn").addEventListener("click", () => {
    const inputs = document.querySelectorAll(".ratio-edit-input");
    let sum = 0;
    const raw = {};
    inputs.forEach(inp => {
      const v = parseFloat(inp.value) || 0;
      raw[inp.getAttribute("data-id")] = v;
      sum += v;
    });
    if (sum <= 0) return;

    let running = 0;
    appData.categories.forEach((c, idx) => {
      if (idx === appData.categories.length - 1) {
        c.ratio = Number(Math.max(0, 1.0 - running).toFixed(2));
      } else {
        const norm = Number((raw[c.id] / sum).toFixed(2));
        c.ratio = norm;
        running += norm;
      }
    });
    saveStorage();
    renderAll();
    showToast("Rasio diseimbangkan menjadi tepat 1.0 (100%)!");
  });

  document.getElementById("resetDefaultRatioBtn").addEventListener("click", () => {
    if (confirm("Kembalikan ke 5 pos rasio awal?")) {
      appData.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
      saveStorage();
      renderAll();
      showToast("Rasio dikembalikan ke awal!");
    }
  });

  document.getElementById("addCategoryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const label = document.getElementById("newCatName").value.trim();
    const ratio = parseFloat(document.getElementById("newCatRatio").value) || 0.05;
    const icon = document.getElementById("newCatIcon").value;
    const color = document.getElementById("newCatColor").value;
    appData.categories.push({ id: "pos_" + Date.now(), label, ratio, icon, color });
    saveStorage();
    renderAll();
    document.getElementById("addCategoryForm").reset();
    showToast(`Pos "${label}" ditambahkan!`);
  });

  document.getElementById("goalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = document.getElementById("goalTitle").value.trim();
    const target = Number(document.getElementById("goalTarget").value);
    appData.goals.push({ id: "g_" + Date.now(), title, target, saved: 0 });
    saveStorage();
    renderGoals();
    document.getElementById("goalForm").reset();
    showToast("Target tabungan dibuat!");
  });

  document.getElementById("searchTxInput").addEventListener("input", () => renderTransactions(monthPicker.value));
  document.getElementById("filterCategory").addEventListener("change", () => renderTransactions(monthPicker.value));

  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const key = monthPicker.value;
    const m = ensureMonth(key);
    let csv = "Tanggal,Jenis,Pos,Keterangan,Nominal,Ada Struk\n";
    m.transactions.forEach(t => {
      const desc = `"${(t.description || "").replace(/"/g, '""')}"`;
      csv += `${t.date},${t.type},${t.category || ""},${desc},${t.amount},${t.receiptImage ? "Ya" : "Tidak"}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Laporan-Keuangan-${key}.csv`;
    a.click();
  });

  document.getElementById("backupJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Backup-DompetPintar-v4-${getTodayStr()}.json`;
    a.click();
  });

  document.getElementById("restoreJsonInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed && parsed.months) {
          appData = parsed;
          saveStorage();
          renderAll();
          showToast("Data & Struk berhasil dipulihkan!");
        }
      } catch (err) {
        alert("File Backup tidak valid!");
      }
    };
    r.readAsText(f);
  });

  document.getElementById("resetMonthBtn").addEventListener("click", () => {
    const key = monthPicker.value;
    if (confirm(`Hapus seluruh transaksi & struk pada bulan ${key}?`)) {
      delete appData.months[key];
      saveStorage();
      renderAll();
      showToast("Data bulan ini direset!");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadStorage();
  initScannerStudio();
  initEvents();
  renderAll();
});
