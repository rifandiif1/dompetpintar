const DEFAULT_RATIOS = {
  pokok: 0.2,
  tagihan: 0.4,
  investasi: 0.2,
  darurat: 0.1,
  shodaqoh: 0.1
};

const CATEGORY_META = {
  pokok: { label: "Kebutuhan Pokok", color: "#2563eb", icon: "🍚" },
  tagihan: { label: "Tagihan", color: "#7c3aed", icon: "⚡" },
  investasi: { label: "Investasi", color: "#059669", icon: "📈" },
  darurat: { label: "Dana Darurat", color: "#d97706", icon: "🛡️" },
  shodaqoh: { label: "Shodaqoh", color: "#0d9488", icon: "🤲" }
};

const STORAGE_KEY = "dompet_pintar_data_v1";

let appData = {
  darkMode: false,
  ratios: { ...DEFAULT_RATIOS },
  months: {}
};

function getNowMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthStr(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayDateStr() {
  return new Date().toISOString().split("T")[0];
}

function formatRupiah(num) {
  const n = Math.round(Number(num) || 0);
  const sign = n < 0 ? "-" : "";
  return sign + "Rp " + Math.abs(n).toLocaleString("id-ID");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      appData.darkMode = !!parsed.darkMode;
      appData.ratios = parsed.ratios || { ...DEFAULT_RATIOS };
      appData.months = parsed.months || {};
    } catch (e) {
      console.error("Gagal membaca storage", e);
    }
  }
  if (appData.darkMode) {
    document.body.classList.add("dark-mode");
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function ensureMonthData(monthKey) {
  if (!appData.months[monthKey]) {
    appData.months[monthKey] = {
      allocated: { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 },
      spent: { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 },
      subPosts: [],
      transactions: []
    };
  }
  if (!appData.months[monthKey].subPosts) {
    appData.months[monthKey].subPosts = [];
  }
  return appData.months[monthKey];
}

function recalculateMonthTotals(monthKey) {
  const mData = ensureMonthData(monthKey);
  mData.allocated = { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 };
  mData.spent = { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 };

  // Reset subPost spent
  mData.subPosts.forEach(sp => {
    sp.spent = 0;
  });

  mData.transactions.forEach(tx => {
    if (tx.type === "salary" || tx.type === "income_split") {
      Object.keys(CATEGORY_META).forEach(cat => {
        const share = tx.breakdown && tx.breakdown[cat] !== undefined
          ? tx.breakdown[cat]
          : Math.round(tx.amount * (appData.ratios[cat] || 0));
        mData.allocated[cat] += share;
      });
    } else if (tx.type === "income_single") {
      if (mData.allocated[tx.category] !== undefined) {
        mData.allocated[tx.category] += tx.amount;
      }
      if (tx.subPostId) {
        const sp = mData.subPosts.find(s => s.id === tx.subPostId);
        if (sp) sp.budget += tx.amount;
      }
    } else if (tx.type === "expense") {
      if (mData.spent[tx.category] !== undefined) {
        mData.spent[tx.category] += tx.amount;
      }
      if (tx.subPostId) {
        const sp = mData.subPosts.find(s => s.id === tx.subPostId);
        if (sp) sp.spent += tx.amount;
      }
    } else if (tx.type === "transfer") {
      if (mData.allocated[tx.fromCat] !== undefined) mData.allocated[tx.fromCat] -= tx.amount;
      if (mData.allocated[tx.toCat] !== undefined) mData.allocated[tx.toCat] += tx.amount;
    }
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-content").forEach(c => {
    c.classList.toggle("active", c.id === tabId);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openQuickTxForCategory(cat, mode, subPostId = "") {
  switchTab("tab-transaksi");
  const radio = document.querySelector(`input[name="txMode"][value="${mode}"]`);
  if (radio) {
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  }
  const catSelect = document.getElementById("txCategory");
  catSelect.value = cat;
  updateSubPostDropdown(cat, subPostId);
  updateSelectedCatRemainingHint();
  document.getElementById("txAmount").focus();
}

function updateSelectedCatRemainingHint() {
  const monthKey = document.getElementById("currentMonth").value;
  const mData = ensureMonthData(monthKey);
  const cat = document.getElementById("txCategory").value;
  const rem = (mData.allocated[cat] || 0) - (mData.spent[cat] || 0);
  document.getElementById("selectedCatRemaining").textContent =
    `Sisa saldo pos ${CATEGORY_META[cat].label}: ${formatRupiah(rem)}`;
}

function updateSubPostDropdown(cat, selectedSubId = "") {
  const monthKey = document.getElementById("currentMonth").value;
  const mData = ensureMonthData(monthKey);
  const select = document.getElementById("txSubPostId");
  select.innerHTML = `<option value="">-- Tidak dikaitkan (Pengeluaran langsung) --</option>`;

  mData.subPosts
    .filter(sp => sp.category === cat)
    .forEach(sp => {
      const rem = sp.budget - (sp.spent || 0);
      const opt = document.createElement("option");
      opt.value = sp.id;
      opt.textContent = `${sp.title} (Sisa Pos: ${formatRupiah(rem)})`;
      if (sp.id === selectedSubId) opt.selected = true;
      select.appendChild(opt);
    });
}

function renderAll() {
  const monthKey = document.getElementById("currentMonth").value;
  recalculateMonthTotals(monthKey);
  const mData = ensureMonthData(monthKey);

  let totalAllocated = 0;
  let totalSpent = 0;

  Object.keys(CATEGORY_META).forEach(cat => {
    totalAllocated += mData.allocated[cat];
    totalSpent += mData.spent[cat];
  });

  const totalRemaining = totalAllocated - totalSpent;

  document.getElementById("totalRemainingBalance").textContent = formatRupiah(totalRemaining);
  document.getElementById("totalIncomeDisplay").textContent = formatRupiah(totalAllocated);
  document.getElementById("totalExpenseDisplay").textContent = formatRupiah(totalSpent);

  // Indikator Kesehatan Keuangan & Batas Aman Harian
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(1, daysInMonth - now.getDate() + 1);
  const safeDaily = totalRemaining > 0 ? Math.floor(totalRemaining / remainingDays) : 0;
  document.getElementById("dailySafeLimit").textContent = `${formatRupiah(safeDaily)} / hari (${remainingDays} hr tersisa)`;

  const healthBadge = document.getElementById("healthStatusBadge");
  const overallRatio = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
  if (totalAllocated === 0) {
    healthBadge.textContent = "Belum Ada Gaji";
    healthBadge.style.background = "#64748b";
  } else if (overallRatio < 75) {
    healthBadge.textContent = "Sehat & Aman";
    healthBadge.style.background = "#10b981";
  } else if (overallRatio <= 95) {
    healthBadge.textContent = "Waspada";
    healthBadge.style.background = "#d97706";
  } else {
    healthBadge.textContent = "Overbudget!";
    healthBadge.style.background = "#dc2626";
  }

  // Render 5 Kartu Pos Utama
  const container = document.getElementById("budgetCardsContainer");
  container.innerHTML = "";

  Object.keys(CATEGORY_META).forEach(cat => {
    const meta = CATEGORY_META[cat];
    const ratioPct = Math.round((appData.ratios[cat] || 0) * 100);
    const alloc = mData.allocated[cat];
    const spent = mData.spent[cat];
    const rem = alloc - spent;
    const usedPct = alloc > 0 ? Math.min(100, Math.round((spent / alloc) * 100)) : (spent > 0 ? 100 : 0);

    let barColor = meta.color;
    if (usedPct >= 90) barColor = "#dc2626";
    else if (usedPct >= 75) barColor = "#d97706";

    const card = document.createElement("div");
    card.className = "budget-card";
    card.style.borderLeftColor = meta.color;
    card.innerHTML = `
      <div class="budget-header">
        <span class="budget-title">${meta.icon} ${meta.label}</span>
        <span class="budget-badge">Rasio ${appData.ratios[cat]} (${ratioPct}%)</span>
      </div>
      <div class="budget-numbers">
        <span>Sisa Dapat Dipakai: <strong>${formatRupiah(rem)}</strong></span>
        <span>Terpakai: ${formatRupiah(spent)} / ${formatRupiah(alloc)}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${usedPct}%; background: ${barColor}"></div>
      </div>
      <div class="card-quick-btns">
        <button class="mini-btn" data-qcat="${cat}" data-qmode="expense">📤 Pakai Saldo</button>
        <button class="mini-btn" data-qcat="${cat}" data-qmode="income_single">📥 + Pendapatan</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll(".mini-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      openQuickTxForCategory(btn.getAttribute("data-qcat"), btn.getAttribute("data-qmode"));
    });
  });

  renderChart(mData);
  renderSubPosts(monthKey);
  renderTransactions(monthKey);
  updateSelectedCatRemainingHint();
  updateSubPostDropdown(document.getElementById("txCategory").value);
}

function renderChart(mData) {
  const chartBox = document.getElementById("chartContainer");
  chartBox.innerHTML = "";
  Object.keys(CATEGORY_META).forEach(cat => {
    const meta = CATEGORY_META[cat];
    const alloc = mData.allocated[cat];
    const spent = mData.spent[cat];
    const pct = alloc > 0 ? Math.min(100, Math.round((spent / alloc) * 100)) : 0;

    const row = document.createElement("div");
    row.className = "chart-row";
    row.innerHTML = `
      <div class="chart-label-line">
        <span>${meta.icon} ${meta.label}</span>
        <span>${pct}% (${formatRupiah(spent)} / ${formatRupiah(alloc)})</span>
      </div>
      <div class="progress-bar-bg" style="height: 6px; margin-bottom:0;">
        <div class="progress-bar-fill" style="width: ${pct}%; background: ${meta.color};"></div>
      </div>
    `;
    chartBox.appendChild(row);
  });
}

function renderSubPosts(monthKey) {
  const mData = ensureMonthData(monthKey);
  const filterCat = document.getElementById("filterSubPostCat").value;
  const listEl = document.getElementById("subPostListContainer");
  listEl.innerHTML = "";

  const items = mData.subPosts.filter(sp => filterCat === "all" || sp.category === filterCat);

  if (items.length === 0) {
    listEl.innerHTML = `<div class="card"><p class="helper-text" style="text-align:center; margin:0;">Belum ada pos pengeluaran spesifik. Tambahkan di atas untuk merencanakan pengeluaran bulanan Anda.</p></div>`;
    return;
  }

  items.forEach(sp => {
    const meta = CATEGORY_META[sp.category];
    const spent = sp.spent || 0;
    const rem = sp.budget - spent;
    const pct = sp.budget > 0 ? Math.min(100, Math.round((spent / sp.budget) * 100)) : 0;

    const item = document.createElement("div");
    item.className = "subpost-card";
    item.innerHTML = `
      <div class="subpost-top">
        <div>
          <div class="subpost-title">${sp.title}</div>
          <span class="subpost-cat-tag">${meta.icon} Pos Induk: ${meta.label}</span>
        </div>
        <strong style="font-size:0.9rem; color:${rem >= 0 ? 'var(--primary-light)' : 'var(--danger)'}">
          Sisa: ${formatRupiah(rem)}
        </strong>
      </div>
      <div class="budget-numbers">
        <span>Terpakai: ${formatRupiah(spent)}</span>
        <span>Anggaran Pos: ${formatRupiah(sp.budget)} (${pct}%)</span>
      </div>
      <div class="progress-bar-bg" style="margin-bottom:6px;">
        <div class="progress-bar-fill" style="width:${pct}%; background:${meta.color}"></div>
      </div>
      <div class="subpost-actions">
        <button class="btn-pay-sub" data-id="${sp.id}">📤 Bayar / Pakai Pos Ini</button>
        <button class="btn-topup-sub" data-id="${sp.id}">📥 + Tambah Dana</button>
        <button class="btn-del-sub" data-del="${sp.id}">🗑️</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  // Action Bayar Pos Pengeluaran
  listEl.querySelectorAll(".btn-pay-sub").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const sp = mData.subPosts.find(s => s.id === id);
      if (!sp) return;
      const defaultRemaining = Math.max(0, sp.budget - (sp.spent || 0));
      const inputNominal = prompt(`Masukkan nominal pengeluaran untuk "${sp.title}" (Rp):`, defaultRemaining || sp.budget);
      if (!inputNominal) return;
      const amount = Number(inputNominal);
      if (isNaN(amount) || amount <= 0) return alert("Nominal tidak valid!");

      mData.transactions.push({
        id: "tx_" + Date.now(),
        type: "expense",
        category: sp.category,
        subPostId: sp.id,
        amount: amount,
        date: getTodayDateStr(),
        description: `[Pos: ${sp.title}] Pengeluaran`
      });
      saveStorage();
      renderAll();
      showToast(`Pengeluaran "${sp.title}" berhasil memotong saldo!`);
    });
  });

  // Action Top-Up Pos Pengeluaran
  listEl.querySelectorAll(".btn-topup-sub").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      const sp = mData.subPosts.find(s => s.id === id);
      if (!sp) return;
      const inputNominal = prompt(`Masukkan tambahan dana / pendapatan masuk untuk "${sp.title}" (Rp):`, "50000");
      if (!inputNominal) return;
      const amount = Number(inputNominal);
      if (isNaN(amount) || amount <= 0) return alert("Nominal tidak valid!");

      mData.transactions.push({
        id: "tx_" + Date.now(),
        type: "income_single",
        category: sp.category,
        subPostId: sp.id,
        amount: amount,
        date: getTodayDateStr(),
        description: `[Top-Up Pos: ${sp.title}] Pendapatan Masuk`
      });
      saveStorage();
      renderAll();
      showToast(`Dana berhasil ditambahkan ke "${sp.title}"!`);
    });
  });

  // Action Hapus Sub-Pos
  listEl.querySelectorAll(".btn-del-sub").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      if (confirm("Hapus pos pengeluaran spesifik ini?")) {
        mData.subPosts = mData.subPosts.filter(s => s.id !== id);
        saveStorage();
        renderAll();
        showToast("Pos pengeluaran dihapus");
      }
    });
  });
}

function renderTransactions(monthKey) {
  const mData = ensureMonthData(monthKey);
  const filterVal = document.getElementById("filterCategory").value;
  const query = (document.getElementById("searchTxInput").value || "").toLowerCase().trim();
  const listEl = document.getElementById("transactionList");
  listEl.innerHTML = "";

  const filtered = mData.transactions.filter(tx => {
    const matchCat =
      filterVal === "all" ||
      (filterVal === "gaji" && (tx.type === "salary" || tx.type === "income_split")) ||
      tx.category === filterVal;
    const matchQuery = !query || (tx.description || "").toLowerCase().includes(query);
    return matchCat && matchQuery;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="helper-text" style="text-align:center; padding: 14px 0;">Tidak ada transaksi yang cocok.</p>`;
    return;
  }

  filtered.slice().reverse().forEach(tx => {
    const item = document.createElement("div");
    item.className = "tx-item";

    const isIncome = tx.type === "salary" || tx.type === "income_split" || tx.type === "income_single";
    let badgeLabel = "Alokasi Gaji (5 Pos)";
    if (tx.type === "transfer") {
      badgeLabel = `Transfer: ${CATEGORY_META[tx.fromCat].label} ➔ ${CATEGORY_META[tx.toCat].label}`;
    } else if (tx.category && CATEGORY_META[tx.category]) {
      badgeLabel = `${CATEGORY_META[tx.category].icon} ${CATEGORY_META[tx.category].label}`;
    }

    item.innerHTML = `
      <div class="tx-info">
        <h4>${tx.description}</h4>
        <div class="tx-meta">${tx.date} • ${badgeLabel}</div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${tx.type === 'transfer' ? '' : (isIncome ? 'plus' : 'minus')}">
          ${tx.type === 'transfer' ? '🔄 ' : (isIncome ? '+' : '-')}${formatRupiah(tx.amount)}
        </span>
        <button class="delete-btn" data-id="${tx.id}">Hapus</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      mData.transactions = mData.transactions.filter(t => t.id !== id);
      saveStorage();
      renderAll();
      showToast("Transaksi dihapus & saldo disesuaikan");
    });
  });
}

function initEvents() {
  const monthInput = document.getElementById("currentMonth");
  monthInput.value = getNowMonthStr();
  monthInput.addEventListener("change", () => renderAll());

  document.getElementById("txDate").value = getTodayDateStr();

  // Dark mode toggle
  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    appData.darkMode = !appData.darkMode;
    document.body.classList.toggle("dark-mode", appData.darkMode);
    saveStorage();
  });

  // Bottom Navigation
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
  });

  // Quick Action Buttons
  document.getElementById("openSalaryModalBtn").addEventListener("click", () => {
    switchTab("tab-dashboard");
    document.getElementById("salaryInput").focus();
  });

  document.getElementById("openTransferModalBtn").addEventListener("click", () => {
    switchTab("tab-pengaturan");
    document.getElementById("transferAmount").focus();
  });

  document.getElementById("carryOverPrevBtn").addEventListener("click", () => {
    const currMonth = monthInput.value;
    const prevMonth = getPreviousMonthStr(currMonth);
    recalculateMonthTotals(prevMonth);
    const prevData = ensureMonthData(prevMonth);

    let totalPrevRem = 0;
    const breakdown = {};
    Object.keys(CATEGORY_META).forEach(cat => {
      const rem = Math.max(0, (prevData.allocated[cat] || 0) - (prevData.spent[cat] || 0));
      breakdown[cat] = rem;
      totalPrevRem += rem;
    });

    if (totalPrevRem <= 0) {
      return alert(`Tidak ada sisa saldo positif pada bulan lalu (${prevMonth}).`);
    }

    if (confirm(`Tarik sisa saldo bulan ${prevMonth} sebesar ${formatRupiah(totalPrevRem)} ke bulan ${currMonth}?`)) {
      const currData = ensureMonthData(currMonth);
      currData.transactions.push({
        id: "tx_" + Date.now(),
        type: "income_split",
        category: "gaji",
        amount: totalPrevRem,
        breakdown: breakdown,
        date: getTodayDateStr(),
        description: `Sisa Saldo Bulan Lalu (${prevMonth})`
      });
      saveStorage();
      renderAll();
      showToast("Sisa saldo bulan lalu berhasil ditarik!");
    }
  });

  document.getElementById("fabQuickTx").addEventListener("click", () => {
    switchTab("tab-transaksi");
    document.getElementById("txAmount").focus();
  });

  // Form Input Gaji
  document.getElementById("salaryForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    const amount = Number(document.getElementById("salaryInput").value);
    const note = document.getElementById("salaryNote").value.trim() || "Gaji Bulanan";
    const carryOver = document.getElementById("carryOverCheck").checked;

    if (!carryOver) {
      mData.transactions = mData.transactions.filter(t => t.type !== "salary");
    }

    const breakdown = {};
    Object.keys(CATEGORY_META).forEach(cat => {
      breakdown[cat] = Math.round(amount * (appData.ratios[cat] || 0));
    });

    mData.transactions.push({
      id: "tx_" + Date.now(),
      type: "salary",
      category: "gaji",
      amount: amount,
      breakdown: breakdown,
      date: getTodayDateStr(),
      description: note
    });

    saveStorage();
    renderAll();
    document.getElementById("salaryForm").reset();
    document.getElementById("carryOverCheck").checked = true;
    showToast("Gaji otomatis dikalikan rasio & masuk ke 5 pos!");
  });

  // Form Buat Sub-Pos Pengeluaran
  document.getElementById("subPostForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    const title = document.getElementById("subPostTitle").value.trim();
    const category = document.getElementById("subPostCategory").value;
    const budget = Number(document.getElementById("subPostBudget").value);

    mData.subPosts.push({
      id: "sp_" + Date.now(),
      title: title,
      category: category,
      budget: budget,
      spent: 0
    });

    saveStorage();
    renderAll();
    document.getElementById("subPostForm").reset();
    showToast(`Pos pengeluaran "${title}" ditambahkan!`);
  });

  document.getElementById("filterSubPostCat").addEventListener("change", () => {
    renderSubPosts(monthInput.value);
  });

  // Radio jenis transaksi
  const txRadios = document.querySelectorAll('input[name="txMode"]');
  txRadios.forEach(r => {
    r.addEventListener("change", () => {
      document.querySelectorAll(".type-radio").forEach(lbl => lbl.classList.remove("active"));
      r.parentElement.classList.add("active");

      const mode = r.value;
      const catGroup = document.getElementById("categoryGroup");
      const subGroup = document.getElementById("subPostLinkGroup");

      if (mode === "income_split") {
        catGroup.style.display = "none";
        subGroup.style.display = "none";
      } else if (mode === "income_single") {
        catGroup.style.display = "block";
        subGroup.style.display = "block";
      } else {
        catGroup.style.display = "block";
        subGroup.style.display = "block";
      }
    });
  });

  document.getElementById("txCategory").addEventListener("change", (e) => {
    updateSelectedCatRemainingHint();
    updateSubPostDropdown(e.target.value);
  });

  // Simpan Transaksi Baru
  document.getElementById("transactionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    const mode = document.querySelector('input[name="txMode"]:checked').value;
    const category = document.getElementById("txCategory").value;
    const subPostId = document.getElementById("txSubPostId").value;
    const amount = Number(document.getElementById("txAmount").value);
    const date = document.getElementById("txDate").value || getTodayDateStr();
    const desc = document.getElementById("txDesc").value.trim();

    const newTx = {
      id: "tx_" + Date.now(),
      type: mode,
      category: mode === "income_split" ? "gaji" : category,
      subPostId: subPostId || null,
      amount: amount,
      date: date,
      description: desc
    };

    if (mode === "income_split") {
      newTx.breakdown = {};
      Object.keys(CATEGORY_META).forEach(cat => {
        newTx.breakdown[cat] = Math.round(amount * (appData.ratios[cat] || 0));
      });
    }

    mData.transactions.push(newTx);
    saveStorage();
    renderAll();
    document.getElementById("txAmount").value = "";
    document.getElementById("txDesc").value = "";
    showToast(mode === "expense" ? "Pengeluaran dicatat & saldo dikurangi!" : "Pendapatan masuk & saldo bertambah!");
  });

  // Cari & Filter Riwayat
  document.getElementById("searchTxInput").addEventListener("input", () => renderTransactions(monthInput.value));
  document.getElementById("filterCategory").addEventListener("change", () => renderTransactions(monthInput.value));

  // Form Rasio
  const loadRatioInputs = () => {
    Object.keys(DEFAULT_RATIOS).forEach(k => {
      document.getElementById("ratio_" + k).value = appData.ratios[k];
    });
  };
  loadRatioInputs();

  document.getElementById("ratioForm").addEventListener("submit", (e) => {
    e.preventDefault();
    let sum = 0;
    const nextRatios = {};
    Object.keys(DEFAULT_RATIOS).forEach(k => {
      const val = parseFloat(document.getElementById("ratio_" + k).value) || 0;
      nextRatios[k] = val;
      sum += val;
    });

    if (Math.abs(sum - 1.0) > 0.001) {
      return alert(`Total rasio saat ini ${sum.toFixed(2)}. Harap pastikan jumlah kelima rasio tepat 1.00 (100%)!`);
    }

    appData.ratios = nextRatios;
    saveStorage();
    renderAll();
    showToast("Rasio pembagian gaji diperbarui!");
  });

  document.getElementById("resetRatioBtn").addEventListener("click", () => {
    appData.ratios = { ...DEFAULT_RATIOS };
    loadRatioInputs();
    saveStorage();
    renderAll();
    showToast("Rasio dikembalikan ke default!");
  });

  // Form Transfer Antar Pos
  document.getElementById("transferForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    const fromCat = document.getElementById("transferFrom").value;
    const toCat = document.getElementById("transferTo").value;
    const amount = Number(document.getElementById("transferAmount").value);

    if (fromCat === toCat) return alert("Pilih pos tujuan yang berbeda!");

    mData.transactions.push({
      id: "tx_" + Date.now(),
      type: "transfer",
      fromCat: fromCat,
      toCat: toCat,
      amount: amount,
      date: getTodayDateStr(),
      description: `Pindah Saldo ke ${CATEGORY_META[toCat].label}`
    });

    saveStorage();
    renderAll();
    document.getElementById("transferAmount").value = "";
    showToast("Saldo berhasil dipindahkan antar pos!");
  });

  // Ekspor CSV
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    let csv = "Tanggal,Jenis,Pos Kategori,Keterangan,Nominal\n";
    mData.transactions.forEach(t => {
      const safeDesc = `"${(t.description || "").replace(/"/g, '""')}"`;
      csv += `${t.date},${t.type},${t.category || ""},${safeDesc},${t.amount}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Laporan-DompetPintarPro-${monthKey}.csv`;
    a.click();
  });

  // Backup & Restore JSON
  document.getElementById("backupJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Backup-DompetPintarPro-${getTodayDateStr()}.json`;
    a.click();
  });

  document.getElementById("restoreJsonInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (imported && imported.months) {
          appData = imported;
          saveStorage();
          loadRatioInputs();
          renderAll();
          showToast("Data berhasil dipulihkan!");
        }
      } catch (err) {
        alert("File JSON tidak valid!");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("resetMonthBtn").addEventListener("click", () => {
    const monthKey = monthInput.value;
    if (confirm(`Hapus semua data transaksi & pos pengeluaran di bulan ${monthKey}?`)) {
      delete appData.months[monthKey];
      saveStorage();
      renderAll();
      showToast("Data bulan ini berhasil direset!");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadStorage();
  initEvents();
  renderAll();
});
