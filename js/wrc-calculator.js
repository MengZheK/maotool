(() => {
  const DEFAULT_GROUPS = [
    { id: "xlk", name: "小低K", category: "小低", count: 28 },
    { id: "xgk", name: "小高K", category: "小高", count: 39 },
    { id: "xgp", name: "小高P", category: "小高", count: 13 },
    { id: "ck", name: "初K", category: "初", count: 2 },
    { id: "cp", name: "初P", category: "初", count: 4 },
    { id: "cc", name: "初C", category: "初", count: 1 },
  ];

  const CATEGORY_ORDER = ["小低", "小高", "初"];

  const PRESETS = {
    official: { first: 15, second: 30, third: 50, none: 5 },
    actual: { first: 15, second: 35, third: 50, none: 0 },
  };

  let groups = structuredClone(DEFAULT_GROUPS);
  let ratios = { ...PRESETS.official };
  let activePreset = "official";

  const SAFETY_ADVANCE = 0.3; // 往前提 30% → 保留 70%

  const els = {
    groupBody: document.getElementById("wrcGroupBody"),
    groupFoot: document.getElementById("wrcGroupFoot"),
    summaryBody: document.getElementById("wrcSummaryBody"),
    summaryFoot: document.getElementById("wrcSummaryFoot"),
    safetyBody: document.getElementById("wrcSafetyBody"),
    safetyFoot: document.getElementById("wrcSafetyFoot"),
    splitGrid: document.getElementById("wrcSplitGrid"),
    stats: document.getElementById("wrcStats"),
    ratioFirst: document.getElementById("ratioFirst"),
    ratioSecond: document.getElementById("ratioSecond"),
    ratioThird: document.getElementById("ratioThird"),
    ratioNone: document.getElementById("ratioNone"),
    ratioSumHint: document.getElementById("ratioSumHint"),
    addGroupBtn: document.getElementById("addGroupBtn"),
    resetWrcBtn: document.getElementById("resetWrcBtn"),
    exportWrcBtn: document.getElementById("exportWrcBtn"),
    presetOfficial: document.getElementById("presetOfficial"),
    presetActual: document.getElementById("presetActual"),
  };

  function roundInt(n) {
    return Math.round(n);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function calcAwards(count, r = ratios) {
    const firstRaw = count * (r.first / 100);
    const secondRaw = count * (r.second / 100);
    const thirdRaw = count * (r.third / 100);
    const noneRaw = count * (r.none / 100);
    return {
      firstRaw,
      secondRaw,
      thirdRaw,
      noneRaw,
      first: roundInt(firstRaw),
      second: roundInt(secondRaw),
      third: roundInt(thirdRaw),
      none: roundInt(noneRaw),
    };
  }

  function readRatios() {
    ratios = {
      first: Number(els.ratioFirst.value) || 0,
      second: Number(els.ratioSecond.value) || 0,
      third: Number(els.ratioThird.value) || 0,
      none: Number(els.ratioNone.value) || 0,
    };
    const sum = ratios.first + ratios.second + ratios.third + ratios.none;
    els.ratioSumHint.textContent = `比例合计：${sum}%${sum === 100 ? " ✓" : "（建议合计为 100%）"}`;
    els.ratioSumHint.style.color = sum === 100 ? "var(--ok)" : "var(--warn)";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function awardCell(n, raw, cls) {
    return `<td class="num ${cls}" data-award>${n}<span class="sub">精确 ${raw.toFixed(2)}</span></td>`;
  }

  function syncGroupsFromDom() {
    const rows = els.groupBody.querySelectorAll("tr[data-i]");
    rows.forEach((tr) => {
      const i = Number(tr.dataset.i);
      if (!groups[i]) return;
      const name = tr.querySelector('[data-field="name"]');
      const category = tr.querySelector('[data-field="category"]');
      const count = tr.querySelector('[data-field="count"]');
      if (name) groups[i].name = name.value;
      if (category) groups[i].category = category.value;
      if (count) groups[i].count = Math.max(0, Number(count.value) || 0);
    });
  }

  function renderGroups() {
    els.groupBody.innerHTML = groups
      .map((g, i) => {
        const a = calcAwards(g.count);
        return `
          <tr data-i="${i}">
            <td><input class="cell-input" data-field="name" value="${escapeHtml(g.name)}" /></td>
            <td>
              <select class="cell-input" data-field="category">
                ${CATEGORY_ORDER.map(
                  (c) => `<option value="${c}" ${g.category === c ? "selected" : ""}>${c}</option>`
                ).join("")}
                ${
                  !CATEGORY_ORDER.includes(g.category)
                    ? `<option value="${escapeHtml(g.category)}" selected>${escapeHtml(g.category)}</option>`
                    : ""
                }
              </select>
            </td>
            <td><input class="cell-input" data-field="count" type="number" min="0" step="1" value="${g.count}" /></td>
            ${awardCell(a.first, a.firstRaw, "award-1")}
            ${awardCell(a.second, a.secondRaw, "award-2")}
            ${awardCell(a.third, a.thirdRaw, "award-3")}
            ${awardCell(a.none, a.noneRaw, "award-0")}
            <td><button type="button" class="btn btn-danger-soft" data-remove="${i}">删除</button></td>
          </tr>`;
      })
      .join("");

    updateComputed();
  }

  function updateGroupAwardCells() {
    els.groupBody.querySelectorAll("tr[data-i]").forEach((tr) => {
      const i = Number(tr.dataset.i);
      const g = groups[i];
      if (!g) return;
      const a = calcAwards(g.count);
      const cells = tr.querySelectorAll("[data-award]");
      const values = [
        [a.first, a.firstRaw],
        [a.second, a.secondRaw],
        [a.third, a.thirdRaw],
        [a.none, a.noneRaw],
      ];
      cells.forEach((cell, idx) => {
        const [n, raw] = values[idx];
        cell.innerHTML = `${n}<span class="sub">精确 ${raw.toFixed(2)}</span>`;
      });
    });

    const totalCount = groups.reduce((s, g) => s + (Number(g.count) || 0), 0);
    const totalA = calcAwards(totalCount);
    els.groupFoot.innerHTML = `
      <tr>
        <td colspan="2">总计（按各行人数合计）</td>
        <td class="num">${totalCount}</td>
        <td class="num award-1">${totalA.first}</td>
        <td class="num award-2">${totalA.second}</td>
        <td class="num award-3">${totalA.third}</td>
        <td class="num award-0">${totalA.none}</td>
        <td></td>
      </tr>`;
  }

  function buildSummary() {
    const map = new Map();
    for (const g of groups) {
      const key = g.category || "未分类";
      if (!map.has(key)) map.set(key, { category: key, count: 0, parts: [] });
      const item = map.get(key);
      item.count += Number(g.count) || 0;
      item.parts.push({ name: g.name, count: Number(g.count) || 0 });
    }

    return [
      ...CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => map.get(c)),
      ...[...map.values()].filter((x) => !CATEGORY_ORDER.includes(x.category)),
    ];
  }

  function summaryAwardCell(rounded, raw, cls) {
    return `<td class="num ${cls}">${rounded}<span class="sub">精确 ${round1(raw).toFixed(1)}</span></td>`;
  }

  /** 安全线：官方/实际取较小值，再往前提 30%（×70% 取整），且不超过较小值 */
  function calcSafetyLine(count) {
    const official = calcAwards(count, PRESETS.official);
    const actual = calcAwards(count, PRESETS.actual);
    const keys = ["first", "second", "third", "none"];
    const out = {};
    for (const key of keys) {
      const smaller = Math.min(official[key], actual[key]);
      const advanced = roundInt(smaller * (1 - SAFETY_ADVANCE));
      out[key] = {
        official: official[key],
        actual: actual[key],
        smaller,
        safety: Math.min(advanced, smaller),
      };
    }
    return out;
  }

  function safetyCell(item, cls) {
    return `<td class="num ${cls}">${item.safety}<span class="sub">较小值 ${item.smaller}（官方 ${item.official} / 实际 ${item.actual}）</span></td>`;
  }

  /** Largest remainder: split integer `total` across parts by count weight. */
  function splitByProportion(parts, total, allCount) {
    if (total <= 0 || allCount <= 0 || !parts.length) {
      return parts.map((p) => ({ name: p.name, count: p.count, n: 0, exact: 0 }));
    }
    const raw = parts.map((p) => ({
      name: p.name,
      count: p.count,
      exact: (p.count / allCount) * total,
    }));
    const floored = raw.map((x) => ({
      ...x,
      n: Math.floor(x.exact),
      frac: x.exact - Math.floor(x.exact),
    }));
    let remain = total - floored.reduce((s, x) => s + x.n, 0);
    floored
      .slice()
      .sort((x, y) => y.frac - x.frac || y.count - x.count)
      .forEach((x) => {
        if (remain > 0) {
          const target = floored.find((f) => f.name === x.name);
          target.n += 1;
          remain -= 1;
        }
      });
    return floored;
  }

  function renderSummary() {
    const rows = buildSummary();
    els.summaryBody.innerHTML = rows
      .map((row) => {
        const a = calcAwards(row.count);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(row.category)}</strong>
              <span class="sub">${row.parts.map((p) => `${escapeHtml(p.name)} ${p.count}`).join(" + ")}</span>
            </td>
            <td class="num">${row.count}</td>
            ${summaryAwardCell(a.first, a.firstRaw, "award-1")}
            ${summaryAwardCell(a.second, a.secondRaw, "award-2")}
            ${summaryAwardCell(a.third, a.thirdRaw, "award-3")}
            ${summaryAwardCell(a.none, a.noneRaw, "award-0")}
          </tr>`;
      })
      .join("");

    const total = rows.reduce((s, r) => s + r.count, 0);
    const t = calcAwards(total);
    els.summaryFoot.innerHTML = `
      <tr>
        <td>总计</td>
        <td class="num">${total}</td>
        ${summaryAwardCell(t.first, t.firstRaw, "award-1")}
        ${summaryAwardCell(t.second, t.secondRaw, "award-2")}
        ${summaryAwardCell(t.third, t.thirdRaw, "award-3")}
        ${summaryAwardCell(t.none, t.noneRaw, "award-0")}
      </tr>`;

    els.stats.innerHTML = `
      <div class="stat"><div class="value">${total}</div><div class="label">实际参赛总人数</div></div>
      <div class="stat"><div class="value award-1">${t.first}</div><div class="label">一等奖名额（取整）</div></div>
      <div class="stat"><div class="value award-2">${t.second}</div><div class="label">二等奖名额（取整）</div></div>
      <div class="stat"><div class="value award-3">${t.third}</div><div class="label">三等奖名额（取整）</div></div>
    `;

    renderSafety(rows);
    renderLanguageSplit(rows);
  }

  function renderSafety(rows) {
    if (!els.safetyBody || !els.safetyFoot) return;

    els.safetyBody.innerHTML = rows
      .map((row) => {
        const s = calcSafetyLine(row.count);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(row.category)}</strong>
              <span class="sub">${row.parts.map((p) => `${escapeHtml(p.name)} ${p.count}`).join(" + ")}</span>
            </td>
            <td class="num">${row.count}</td>
            ${safetyCell(s.first, "award-1")}
            ${safetyCell(s.second, "award-2")}
            ${safetyCell(s.third, "award-3")}
            ${safetyCell(s.none, "award-0")}
          </tr>`;
      })
      .join("");

    const total = rows.reduce((sum, r) => sum + r.count, 0);
    const st = calcSafetyLine(total);
    els.safetyFoot.innerHTML = `
      <tr>
        <td>总计</td>
        <td class="num">${total}</td>
        ${safetyCell(st.first, "award-1")}
        ${safetyCell(st.second, "award-2")}
        ${safetyCell(st.third, "award-3")}
        ${safetyCell(st.none, "award-0")}
      </tr>`;
  }

  function renderLanguageSplit(summaryRows) {
    const targets = summaryRows.filter((r) => r.parts.length > 1);
    if (!targets.length) {
      els.splitGrid.innerHTML = `<div class="split-card"><h3>无需拆分</h3><p style="color:var(--muted);font-size:0.88rem">当前各学段均只有单一语言组别。如果人数不够分冠亚季，现场不颁奖，以组委会公布的冠亚季为准。</p></div>`;
      return;
    }

    els.splitGrid.innerHTML = targets
      .map((row) => {
        const a = calcAwards(row.count);
        const firstSlots = a.first;
        const firstSplit = splitByProportion(row.parts, firstSlots, row.count);

        // 冠亚季从一等奖中产生：默认冠/亚/季各 1，总数不超过一等奖名额
        const podiumCount = Math.min(3, firstSlots);
        const podiumSplit = splitByProportion(row.parts, podiumCount, row.count);
        const podiumLabel =
          podiumCount === 3 ? "冠军 / 亚军 / 季军" : podiumCount === 2 ? "冠军 / 亚军" : podiumCount === 1 ? "冠军" : "无";
        const notEnough = podiumCount < 3;

        return `
          <div class="split-card">
            <h3>${escapeHtml(row.category)} · 冠亚季按语言比例平分</h3>
            <p style="color:var(--muted);font-size:0.82rem;margin-bottom:10px">
              冠、亚、季从<strong style="color:var(--ink)">一等奖</strong>中产生（本学段一等奖 ${firstSlots} 名，精确 ${round1(a.firstRaw).toFixed(1)}）
            </p>
            <ul>
              <li style="flex-direction:column;align-items:stretch;gap:4px">
                <div style="display:flex;justify-content:space-between">
                  <strong>一等奖按语言平分</strong>
                  <span>${firstSlots} 名</span>
                </div>
                <div style="color:var(--muted);font-size:0.8rem">
                  ${
                    firstSlots > 0
                      ? firstSplit
                          .map((f) => `${escapeHtml(f.name)} ${f.n}（精确 ${round1(f.exact).toFixed(1)}）`)
                          .join(" · ")
                      : "暂无一等奖名额"
                  }
                </div>
              </li>
              <li class="split-podium" style="flex-direction:column;align-items:stretch;gap:6px">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                  <strong class="podium-title">冠亚季席位（出自一等奖）</strong>
                  <span class="podium-meta">${podiumCount} 名 · ${podiumLabel}</span>
                </div>
                <div class="podium-detail">
                  ${
                    podiumCount > 0
                      ? "按人数占比平分席位：" +
                        podiumSplit.map((f) => `${escapeHtml(f.name)} ${f.n}`).join(" · ")
                      : "无一等奖则不产生冠亚季"
                  }
                </div>
                ${
                  notEnough
                    ? `<div class="podium-detail">人数不够分满冠亚季时，现场不颁奖，以组委会公布的冠亚季为准。</div>`
                    : ""
                }
              </li>
            </ul>
          </div>`;
      })
      .join("");
  }

  function updateComputed() {
    readRatios();
    updateGroupAwardCells();
    renderSummary();
  }

  function fullRefresh() {
    readRatios();
    renderGroups();
  }

  els.groupBody.addEventListener("input", (e) => {
    if (!e.target.dataset.field) return;
    syncGroupsFromDom();
    updateComputed();
  });

  els.groupBody.addEventListener("change", (e) => {
    if (!e.target.dataset.field) return;
    syncGroupsFromDom();
    updateComputed();
  });

  els.groupBody.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    syncGroupsFromDom();
    const i = Number(btn.dataset.remove);
    groups.splice(i, 1);
    fullRefresh();
  });

  function applyPreset(key, { refreshGroups = false } = {}) {
    const preset = PRESETS[key];
    if (!preset) return;
    activePreset = key;
    ratios = { ...preset };
    els.ratioFirst.value = preset.first;
    els.ratioSecond.value = preset.second;
    els.ratioThird.value = preset.third;
    els.ratioNone.value = preset.none;
    updatePresetUI();
    if (refreshGroups) fullRefresh();
    else {
      syncGroupsFromDom();
      updateComputed();
    }
  }

  function updatePresetUI() {
    const matchOfficial =
      ratios.first === PRESETS.official.first &&
      ratios.second === PRESETS.official.second &&
      ratios.third === PRESETS.official.third &&
      ratios.none === PRESETS.official.none;
    const matchActual =
      ratios.first === PRESETS.actual.first &&
      ratios.second === PRESETS.actual.second &&
      ratios.third === PRESETS.actual.third &&
      ratios.none === PRESETS.actual.none;

    activePreset = matchOfficial ? "official" : matchActual ? "actual" : "";
    els.presetOfficial.classList.toggle("active", activePreset === "official");
    els.presetActual.classList.toggle("active", activePreset === "actual");
  }

  [els.ratioFirst, els.ratioSecond, els.ratioThird, els.ratioNone].forEach((input) => {
    input.addEventListener("input", () => {
      syncGroupsFromDom();
      updateComputed();
      updatePresetUI();
    });
  });

  els.presetOfficial.addEventListener("click", () => applyPreset("official"));
  els.presetActual.addEventListener("click", () => applyPreset("actual"));

  els.addGroupBtn.addEventListener("click", () => {
    syncGroupsFromDom();
    groups.push({
      id: `g_${Date.now()}`,
      name: "新组别",
      category: "小高",
      count: 0,
    });
    fullRefresh();
  });

  els.resetWrcBtn.addEventListener("click", () => {
    groups = structuredClone(DEFAULT_GROUPS);
    applyPreset("official", { refreshGroups: true });
  });

  els.exportWrcBtn.addEventListener("click", async () => {
    if (typeof html2canvas !== "function") {
      alert("图片导出组件未加载，请检查网络后重试");
      return;
    }

    syncGroupsFromDom();
    const target = document.querySelector(".app");
    const btn = els.exportWrcBtn;
    const prevText = btn.textContent;
    const hideNodes = document.querySelectorAll("[data-export-hide]");

    btn.disabled = true;
    btn.textContent = "生成图片中…";
    hideNodes.forEach((el) => {
      el.dataset.prevVisibility = el.style.visibility;
      el.style.visibility = "hidden";
    });

    try {
      const canvas = await html2canvas(target, {
        backgroundColor: "#eef3f5",
        scale: 2,
        useCORS: true,
        logging: false,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
      });

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("图片生成失败"));
            return;
          }
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `WRC奖项计算结果_${ts}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
          resolve();
        }, "image/png");
      });
    } catch (err) {
      alert("导出图片失败：" + err.message);
    } finally {
      hideNodes.forEach((el) => {
        el.style.visibility = el.dataset.prevVisibility || "";
        delete el.dataset.prevVisibility;
      });
      btn.disabled = false;
      btn.textContent = prevText;
    }
  });

  fullRefresh();
  updatePresetUI();
})();
