const DEFAULT_RATIOS = {
  pokok: 0.2,
  tagihan: 0.4,
  investasi: 0.2,
  darurat: 0.1,
  shodaqoh: 0.1
};

const CATEGORY_META = {
  pokok: { label: "Kebutuhan Pokok", color: "#2563eb" },
  tagihan: { label: "Tagihan", color: "#7c3aed" },
  investasi: { label: "Investasi", color: "#059669" },
  darurat: { label: "Dana Darurat", color: "#d97706" },
  shodaqoh: { label: "Shodaqoh", color: "#0d9488" }
};

const STORAGE_KEY = "dompet_pintar_data_v1";

let appData = {
  ratios: { ...DEFAULT_RATIOS },
  months: {}
};

function getNowMonthStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getTodayDateStr() {
  return new Date().toISOString().split("T")[0];
}

function formatRupiah(num) {
  const n = Number(num) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

function loadStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      appData.ratios = parsed.ratios || { ...DEFAULT_RATIOS };
      appData.months = parsed.months || {};
    } catch (e) {
      console.error("Gagal membaca storage", e);
    }
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function ensureMonthData(monthKey) {
  if (!appData.months[monthKey]) {
    appData.months[monthKey] = {
      allocated: {
        pokok: 0,
        tagihan: 0,
        investasi: 0,
        darurat: 0,
        shodaqoh: 0
      },
      spent: {
        pokok: 0,
        tagihan: 0,
        investasi: 0,
        darurat: 0,
        shodaqoh: 0
      },
      transactions: []
    };
  }
  return appData.months[monthKey];
}

function recalculateMonthTotals(monthKey) {
  const mData = ensureMonthData(monthKey);
  mData.allocated = { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 };
  mData.spent = { pokok: 0, tagihan: 0, investasi: 0, darurat: 0, shodaqoh: 0 };

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
    } else if (tx.type === "expense") {
      if (mData.spent[tx.category] !== undefined) {
        mData.spent[tx.category] += tx.amount;
      }
    }
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

  // Render Pos Budget Cards
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
        <span class="budget-title">${meta.label}</span>
        <span class="budget-badge">Rasio ${ratioPct}% (${appData.ratios[cat]})</span>
      </div>
      <div class="budget-numbers">
        <span>Sisa: <strong>${formatRupiah(rem)}</strong></span>
        <span>Terpakai: ${formatRupiah(spent)} / ${formatRupiah(alloc)}</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${usedPct}%; background: ${barColor}"></div>
      </div>
    `;
    container.appendChild(card);
  });

  renderTransactions(monthKey);
  renderRatioSelectLabels();
}

function renderRatioSelectLabels() {
  const select = document.getElementById("txCategory");
  Array.from(select.options).forEach(opt => {
    const cat = opt.value;
    if (CATEGORY_META[cat]) {
      const pct = Math.round((appData.ratios[cat] || 0) * 100);
      opt.textContent = `${CATEGORY_META[cat].label} (${pct}%)`;
    }
  });
}

function renderTransactions(monthKey) {
  const mData = ensureMonthData(monthKey);
  const filterVal = document.getElementById("filterCategory").value;
  const listEl = document.getElementById("transactionList");
  listEl.innerHTML = "";

  const filtered = mData.transactions.filter(tx => {
    if (filterVal === "all") return true;
    if (filterVal === "gaji") return tx.type === "salary" || tx.type === "income_split";
    return tx.category === filterVal;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="helper-text" style="text-align:center; padding: 14px 0;">Belum ada transaksi di bulan ini.</p>`;
    return;
  }

  filtered.slice().reverse().forEach(tx => {
    const item = document.createElement("div");
    item.className = "tx-item";

    const isIncome = tx.type !== "expense";
    let badgeLabel = "Alokasi Gaji (Semua Pos)";
    if (tx.type === "expense" || tx.type === "income_single") {
      badgeLabel = CATEGORY_META[tx.category] ? CATEGORY_META[tx.category].label : tx.category;
    }

    item.innerHTML = `
      <div class="tx-info">
        <h4>${tx.description}</h4>
        <div class="tx-meta">${tx.date} • ${badgeLabel}</div>
      </div>
      <div class="tx-right">
        <span class="tx-amount ${isIncome ? "plus" : "minus"}">
          ${isIncome ? "+" : "-"}${formatRupiah(tx.amount)}
        </span>
        <button class="delete-btn" data-id="${tx.id}">Hapus</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      deleteTransaction(monthKey, id);
    });
  });
}

function deleteTransaction(monthKey, txId) {
  const mData = ensureMonthData(monthKey);
  mData.transactions = mData.transactions.filter(t => t.id !== txId);
  saveStorage();
  renderAll();
  showToast("Transaksi dihapus");
}

function initForms() {
  const monthInput = document.getElementById("currentMonth");
  monthInput.value = getNowMonthStr();
  monthInput.addEventListener("change", () => renderAll());

  document.getElementById("txDate").value = getTodayDateStr();

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.getAttribute("data-tab")).classList.add("active");
    });
  });

  // Toggle category visibility on txType change
  const txTypeSelect = document.getElementById("txType");
  const categoryGroup = document.getElementById("categoryGroup");
  txTypeSelect.addEventListener("change", () => {
    if (txTypeSelect.value === "income_split") {
      categoryGroup.style.display = "none";
    } else {
      categoryGroup.style.display = "block";
    }
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
      // Hapus alokasi gaji sebelumnya jika tidak digabung
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
    showToast("Gaji berhasil dialokasikan ke 5 pos budget!");
  });

  // Form Catat Transaksi
  document.getElementById("transactionForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    const type = document.getElementById("txType").value;
    const category = document.getElementById("txCategory").value;
    const amount = Number(document.getElementById("txAmount").value);
    const date = document.getElementById("txDate").value || getTodayDateStr();
    const desc = document.getElementById("txDesc").value.trim();

    const newTx = {
      id: "tx_" + Date.now(),
      type: type,
      category: type === "income_split" ? "gaji" : category,
      amount: amount,
      date: date,
      description: desc
    };

    if (type === "income_split") {
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
    showToast("Transaksi berhasil disimpan!");
  });

  // Filter Riwayat
  document.getElementById("filterCategory").addEventListener("change", () => {
    renderTransactions(monthInput.value);
  });

  // Ratio Settings Form
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
      alert(`Total rasio saat ini adalah ${sum.toFixed(2)}. Total kelima rasio harus tepat 1.00 (100%)!`);
      return;
    }

    appData.ratios = nextRatios;
    saveStorage();
    renderAll();
    showToast("Rasio budget diperbarui!");
  });

  document.getElementById("resetRatioBtn").addEventListener("click", () => {
    appData.ratios = { ...DEFAULT_RATIOS };
    loadRatioInputs();
    saveStorage();
    renderAll();
    showToast("Rasio dikembalikan ke default!");
  });

  // Ekspor CSV
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const monthKey = monthInput.value;
    const mData = ensureMonthData(monthKey);
    let csv = "Tanggal,Jenis,Pos Kategori,Keterangan,Nominal
";
    mData.transactions.forEach(t => {
      const safeDesc = `"${(t.description || "").replace(/"/g, '""')}"`;
      csv += `${t.date},${t.type},${t.category},${safeDesc},${t.amount}
`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Laporan-Keuangan-${monthKey}.csv`;
    a.click();
  });

  // Backup JSON
  document.getElementById("backupJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Backup-DompetPintar-${getTodayDateStr()}.json`;
    a.click();
  });

  // Restore JSON
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
        alert("File JSON tidak valid.");
      }
    };
    reader.readAsText(file);
  });

  // Reset Month
  document.getElementById("resetMonthBtn").addEventListener("click", () => {
    const monthKey = monthInput.value;
    if (confirm(`Yakin ingin menghapus seluruh transaksi pada bulan ${monthKey}?`)) {
      delete appData.months[monthKey];
      saveStorage();
      renderAll();
      showToast("Data bulan ini direset");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadStorage();
  initForms();
  renderAll();
});
