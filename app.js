// Supplier Dashboard: loads the CSVs, scores suppliers, and draws the charts.
// Everything runs in the browser. There's no server and no build step.

const FACTORS = [
  // key, label, default weight, true if a lower value is better
  { key: "price",  label: "Price",           weight: 35, lowerBetter: true  },
  { key: "onTime", label: "On-time delivery", weight: 25, lowerBetter: false },
  { key: "defect", label: "Quality",          weight: 25, lowerBetter: true  },
  { key: "lead",   label: "Lead time",        weight: 15, lowerBetter: true  },
];

const state = {
  suppliers: [], orders: [], months: [], materials: [],
  market: {},          // market[material][month] = average unit price
  period: 12, material: "",
  weights: Object.fromEntries(FACTORS.map(f => [f.key, f.weight])),
  sort: { key: "score", asc: false },
  selected: null,
  charts: {},
};

// ---------- helpers ----------
const $ = sel => document.querySelector(sel);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const signed = (x, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%";
const money = x => "$" + x.toLocaleString(undefined, { maximumFractionDigits: 0 });
const monthLabel = m => new Date(m + "-01T00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });
const seriesColor = i => css(`--s${(i % 8) + 1}`);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function loadCsv(url) {
  return new Promise((resolve, reject) =>
    Papa.parse(url, { download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
      complete: r => resolve(r.data), error: reject }));
}

// ---------- data prep ----------
async function init() {
  const [suppliers, orders] = await Promise.all([loadCsv("data/suppliers.csv"), loadCsv("data/orders.csv")]);
  state.suppliers = suppliers.map((s, i) => ({ ...s, colorIndex: i }));
  state.orders = orders.map(o => ({
    ...o,
    month: String(o.order_date).slice(0, 7),
    onTime: o.delivered_date <= o.promised_date,
    leadDays: days(o.order_date, o.delivered_date),
  }));
  state.months = [...new Set(state.orders.map(o => o.month))].sort();
  state.materials = [...new Set(state.orders.map(o => o.material))].sort();

  // Market average = mean price across all suppliers for that material in that month.
  const buckets = {};
  for (const o of state.orders) ((buckets[o.material] ??= {})[o.month] ??= []).push(o.unit_price);
  for (const mat in buckets) {
    state.market[mat] = {};
    for (const m in buckets[mat]) state.market[mat][m] = mean(buckets[mat][m]);
  }
  for (const o of state.orders) o.priceIdx = o.unit_price / state.market[o.material][o.month] - 1;

  buildControls();
  render();
}

function periodMonths() { return state.months.slice(-state.period); }

function filteredOrders() {
  const months = new Set(periodMonths());
  return state.orders.filter(o => months.has(o.month) && (!state.material || o.material === state.material));
}

function supplierById(id) { return state.suppliers.find(s => s.supplier_id === id); }

// ---------- scoring ----------
function computeRanking() {
  const orders = filteredOrders();
  const bySup = {};
  for (const o of orders) (bySup[o.supplier_id] ??= []).push(o);

  const rows = Object.entries(bySup).map(([id, os]) => {
    const qty = os.reduce((s, o) => s + o.quantity, 0);
    return {
      id, name: supplierById(id).name, region: supplierById(id).region,
      colorIndex: supplierById(id).colorIndex,
      orders: os.length,
      price: mean(os.map(o => o.priceIdx)),
      onTime: os.filter(o => o.onTime).length / os.length,
      defect: os.reduce((s, o) => s + o.units_defective, 0) / qty,
      lead: mean(os.map(o => o.leadDays)),
    };
  });

  // Rescale each factor from 0 (worst) to 1 (best) across suppliers, then apply the weights.
  const totalW = FACTORS.reduce((s, f) => s + state.weights[f.key], 0) || 1;
  for (const f of FACTORS) {
    const vals = rows.map(r => r[f.key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    for (const r of rows) {
      let n = hi === lo ? 1 : (r[f.key] - lo) / (hi - lo);
      if (f.lowerBetter) n = 1 - n;
      r["n_" + f.key] = n;
    }
  }
  for (const r of rows) {
    r.score = 100 * FACTORS.reduce((s, f) => s + state.weights[f.key] * r["n_" + f.key], 0) / totalW;
  }
  rows.sort((a, b) => b.score - a.score).forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---------- controls ----------
function buildControls() {
  const matSel = $("#f-material");
  for (const m of state.materials) matSel.add(new Option(m, m));
  $("#f-period").addEventListener("change", e => { state.period = +e.target.value; render(); });
  matSel.addEventListener("change", e => { state.material = e.target.value; render(); });

  $("#sliders").innerHTML = FACTORS.map(f => `
    <label><span class="lv">${f.label}<output id="o-${f.key}">${f.weight}%</output></span>
      <input type="range" min="0" max="100" step="5" value="${f.weight}" data-k="${f.key}"></label>`).join("");
  $("#sliders").addEventListener("input", e => {
    const k = e.target.dataset.k; if (!k) return;
    state.weights[k] = +e.target.value;
    $("#o-" + k).textContent = e.target.value + "%";
    renderRanking();
  });

  document.querySelectorAll("#rank th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : ["name", "rank"].includes(k) };
    renderRanking();
  }));
  $("#rank tbody").addEventListener("click", e => {
    const tr = e.target.closest("tr"); if (!tr) return;
    state.selected = state.selected === tr.dataset.id ? null : tr.dataset.id;
    renderRanking(); renderDetail();
  });
  $("#detail-close").addEventListener("click", () => { state.selected = null; renderRanking(); renderDetail(); });

  // Redraw the charts in the new colors when the system light/dark setting changes.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
}

// ---------- render ----------
function render() {
  renderKpis();
  renderRanking();
  renderTrend();
  renderDetail();
}

function renderKpis() {
  const orders = filteredOrders();
  const qty = orders.reduce((s, o) => s + o.quantity, 0);
  const sups = new Set(orders.map(o => o.supplier_id)).size;
  const onTime = orders.filter(o => o.onTime).length / orders.length;
  const defect = orders.reduce((s, o) => s + o.units_defective, 0) / qty;

  // Price change: market average of the last 3 months vs the 3 months before, averaged over materials.
  const mats = state.material ? [state.material] : state.materials;
  const last = state.months.slice(-3), prev = state.months.slice(-6, -3);
  const change = mean(mats.map(m =>
    mean(last.map(x => state.market[m][x])) / mean(prev.map(x => state.market[m][x])) - 1));
  const dir = change > 0 ? "up-bad" : "down-good";
  const arrow = change > 0 ? "▲" : "▼";

  $("#kpis").innerHTML = `
    <div class="kpi"><div class="label">Active suppliers</div><div class="value">${sups}</div>
      <div class="delta">${orders.length} orders</div></div>
    <div class="kpi"><div class="label">On-time delivery</div><div class="value">${pct(onTime, 0)}</div>
      <div class="delta">of orders</div></div>
    <div class="kpi"><div class="label">Defect rate</div><div class="value">${pct(defect)}</div>
      <div class="delta">of units received</div></div>
    <div class="kpi"><div class="label">Price change, 90 days</div>
      <div class="value"><span class="${dir}" aria-hidden="true">${arrow}</span> ${signed(change)}</div>
      <div class="delta">vs prior 3 months${state.material ? "" : ", all materials"}</div></div>`;
}

function renderRanking() {
  const rows = computeRanking();
  const { key, asc } = state.sort;
  rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return asc ? c : -c;
  });
  document.querySelectorAll("#rank th").forEach(th => {
    th.classList.toggle("sorted", th.dataset.k === key);
    th.classList.toggle("asc", th.dataset.k === key && asc);
  });
  $("#rank tbody").innerHTML = rows.map(r => `
    <tr data-id="${r.id}" class="${r.id === state.selected ? "sel" : ""}" tabindex="0">
      <td class="num">${r.rank}</td>
      <td><span class="sname"><span class="swatch" style="background:${seriesColor(r.colorIndex)}"></span>
        ${escapeHtml(r.name)} <small>${escapeHtml(r.region)}</small></span></td>
      <td class="num"><span class="bar"><i style="width:${Math.round(r.score * 0.6)}px"></i><span>${r.score.toFixed(0)}</span></span></td>
      <td class="num">${signed(r.price)}</td>
      <td class="num">${pct(r.onTime, 0)}</td>
      <td class="num">${pct(r.defect)}</td>
      <td class="num">${r.lead.toFixed(0)} d</td>
    </tr>`).join("");
}

function baseOptions(yFormat) {
  const ink2 = css("--ink-2"), muted = css("--muted"), grid = css("--grid"), axis = css("--axis");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    elements: { line: { borderWidth: 2, cubicInterpolationMode: "monotone" }, point: { radius: 0, hoverRadius: 5, hitRadius: 12 } },
    scales: {
      x: { grid: { display: false }, border: { color: axis }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 16 } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, callback: yFormat } },
    },
    plugins: {
      legend: { labels: { color: ink2, usePointStyle: true, pointStyle: "line", boxWidth: 24 } },
      tooltip: {
        backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: ink2,
        borderColor: css("--border"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y == null ? "–" : yFormat(c.parsed.y)}` },
      },
    },
  };
}

function drawChart(id, config) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function renderTrend() {
  const months = periodMonths();
  let datasets, yFormat;

  if (state.material) {
    // One material: each supplier's monthly average price, plus the market average.
    const mat = state.material;
    const unit = state.orders.find(o => o.material === mat).unit;
    const supIds = [...new Set(state.orders.filter(o => o.material === mat).map(o => o.supplier_id))];
    datasets = supIds.map(id => {
      const s = supplierById(id);
      return {
        label: s.name, borderColor: seriesColor(s.colorIndex), backgroundColor: seriesColor(s.colorIndex),
        data: months.map(m => {
          const ps = state.orders.filter(o => o.supplier_id === id && o.material === mat && o.month === m).map(o => o.unit_price);
          return ps.length ? +mean(ps).toFixed(2) : null;
        }),
        spanGaps: true,
      };
    });
    datasets.push({
      label: "Market average", borderColor: css("--muted"), backgroundColor: css("--muted"),
      borderDash: [5, 4], data: months.map(m => +state.market[mat][m].toFixed(2)),
    });
    yFormat = money;
    $("#trend-title").textContent = `${mat} price by supplier`;
    $("#trend-hint").textContent = `Average price per ${unit}, by month`;
  } else {
    // All materials: put every material on the same base (100 = the first month shown).
    datasets = state.materials.map((mat, i) => {
      const base = state.market[mat][months[0]];
      return {
        label: mat, borderColor: seriesColor(i), backgroundColor: seriesColor(i),
        data: months.map(m => +(100 * state.market[mat][m] / base).toFixed(1)),
      };
    });
    yFormat = v => Number(v).toFixed(0);
    $("#trend-title").textContent = "Market price trend";
    $("#trend-hint").textContent = `Index: 100 = ${monthLabel(months[0])} price. Pick a material to see prices by supplier.`;
  }

  drawChart("trend", { type: "line", data: { labels: months.map(monthLabel), datasets }, options: baseOptions(yFormat) });

  // Table version of the same chart, for screen readers or for copying the numbers.
  $("#trend-table").innerHTML = `<table><thead><tr><th>Month</th>${datasets.map(d => `<th class="num">${escapeHtml(d.label)}</th>`).join("")}</tr></thead>
    <tbody>${months.map((m, i) => `<tr><td>${monthLabel(m)}</td>${datasets.map(d => `<td class="num">${d.data[i] == null ? "–" : yFormat(d.data[i])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderDetail() {
  const card = $("#detail");
  if (!state.selected) { card.hidden = true; return; }
  const s = supplierById(state.selected);
  const os = filteredOrders().filter(o => o.supplier_id === s.supplier_id);
  if (!os.length) { state.selected = null; card.hidden = true; return; }
  card.hidden = false;
  $("#detail-title").textContent = s.name;
  $("#detail-meta").textContent = `${s.region} · supplies ${String(s.materials).split("|").join(", ")} · ${os.length} orders in this period`;

  const months = periodMonths();
  const monthly = (fn) => months.map(m => { const x = os.filter(o => o.month === m); return x.length ? fn(x) : null; });
  const color = seriesColor(s.colorIndex);
  const one = (label, data, fmt) => {
    const o = baseOptions(fmt); o.plugins.legend.display = false;
    return { type: "line", data: { labels: months.map(monthLabel),
      datasets: [{ label, data, borderColor: color, backgroundColor: color, spanGaps: true }] }, options: o };
  };
  drawChart("d-price", one("Price vs market", monthly(x => +(100 * mean(x.map(o => o.priceIdx))).toFixed(1)),
    v => (v > 0 ? "+" : "") + Number(v).toFixed(1) + "%"));
  drawChart("d-ontime", one("On-time", monthly(x => Math.round(100 * x.filter(o => o.onTime).length / x.length)),
    v => Number(v).toFixed(0) + "%"));
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

init().catch(err => {
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<p class="card">The data couldn't be loaded: ${escapeHtml(err.message || err)}. If you opened index.html directly as a file, run a local web server instead (see the README).</p>`);
  console.error(err);
});
