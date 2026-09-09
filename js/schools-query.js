(() => {
  const PAGE_SIZE = 50;
  const DATA_BASE = "data/schools";

  const els = {
    keyword: document.getElementById("schoolKeyword"),
    province: document.getElementById("schoolProvince"),
    city: document.getElementById("schoolCity"),
    district: document.getElementById("schoolDistrict"),
    status: document.getElementById("schoolStatus"),
    resultMeta: document.getElementById("schoolResultMeta"),
    body: document.getElementById("schoolBody"),
    pager: document.getElementById("schoolPager"),
    pageInfo: document.getElementById("schoolPageInfo"),
    prevBtn: document.getElementById("schoolPrevBtn"),
    nextBtn: document.getElementById("schoolNextBtn"),
    resetBtn: document.getElementById("schoolResetBtn"),
  };

  if (!els.keyword || !els.province) return;

  /** @type {{ provinces: string[], tree: Record<string, Record<string, string[]>> } | null} */
  let regions = null;
  /** @type {Record<string, Array>} */
  const provinceCache = Object.create(null);
  /** @type {Array | null} */
  let filtered = null;
  let page = 1;
  let debounceTimer = null;
  let querySeq = 0;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`加载失败 ${res.status}: ${url}`);
    return res.json();
  }

  async function loadRegions() {
    if (regions) return regions;
    setStatus("正在加载地区数据…");
    regions = await fetchJson(`${DATA_BASE}/regions.json`);
    els.province.innerHTML =
      `<option value="">全部省份</option>` +
      regions.provinces.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
    setStatus("请选择地区或输入校名开始查询");
    return regions;
  }

  async function loadProvince(province) {
    if (provinceCache[province]) return provinceCache[province];
    const data = await fetchJson(`${DATA_BASE}/by-province/${encodeURIComponent(province)}.json`);
    provinceCache[province] = data;
    return data;
  }

  async function loadAllProvinces(onProgress) {
    await loadRegions();
    const list = regions.provinces;
    let done = 0;
    await Promise.all(
      list.map(async (p) => {
        await loadProvince(p);
        done += 1;
        if (onProgress) onProgress(done, list.length);
      })
    );
  }

  function fillCities(province) {
    els.city.innerHTML = `<option value="">全部城市</option>`;
    els.district.innerHTML = `<option value="">全部区县</option>`;
    els.district.disabled = true;
    if (!province || !regions?.tree[province]) {
      els.city.disabled = true;
      return;
    }
    const cities = Object.keys(regions.tree[province]);
    els.city.innerHTML += cities
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join("");
    els.city.disabled = false;
  }

  function fillDistricts(province, city) {
    els.district.innerHTML = `<option value="">全部区县</option>`;
    if (!province || !city || !regions?.tree[province]?.[city]) {
      els.district.disabled = true;
      return;
    }
    const districts = regions.tree[province][city];
    els.district.innerHTML += districts
      .map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`)
      .join("");
    els.district.disabled = false;
  }

  function recordMatches(rec, province, city, district, keyword) {
    // rec: [name, stage, city, district, id]
    if (city && rec[2] !== city) return false;
    if (district && rec[3] !== district) return false;
    if (keyword && !String(rec[0]).includes(keyword)) return false;
    return true;
  }

  async function runQuery() {
    const seq = ++querySeq;
    const keyword = String(els.keyword.value || "").trim();
    const province = els.province.value;
    const city = els.city.value;
    const district = els.district.value;

    if (!keyword && !province) {
      filtered = null;
      page = 1;
      renderTable();
      setStatus("请选择地区或输入校名开始查询");
      els.resultMeta.textContent = "尚未查询";
      return;
    }

    try {
      let rows = [];
      if (province) {
        setStatus(`正在加载 ${province} 数据…`);
        const list = await loadProvince(province);
        if (seq !== querySeq) return;
        rows = list
          .filter((rec) => recordMatches(rec, province, city, district, keyword))
          .map((rec) => ({
            name: rec[0],
            stage: rec[1],
            province,
            city: rec[2],
            district: rec[3],
            id: rec[4],
          }));
        setStatus(
          keyword
            ? `在「${province}」内按关键词筛选`
            : `已按地区筛选${city ? " · " + city : ""}${district ? " · " + district : ""}`
        );
      } else {
        // Nationwide keyword search
        setStatus("正在加载全国学校数据（首次较慢）…");
        await loadAllProvinces((done, total) => {
          if (seq !== querySeq) return;
          setStatus(`正在加载全国学校数据… ${done}/${total} 省`);
        });
        if (seq !== querySeq) return;
        for (const p of regions.provinces) {
          const list = provinceCache[p] || [];
          for (const rec of list) {
            if (recordMatches(rec, p, "", "", keyword)) {
              rows.push({
                name: rec[0],
                stage: rec[1],
                province: p,
                city: rec[2],
                district: rec[3],
                id: rec[4],
              });
            }
          }
        }
        setStatus(`全国关键词「${keyword}」检索完成`);
      }

      filtered = rows;
      page = 1;
      renderTable();
    } catch (err) {
      if (seq !== querySeq) return;
      filtered = null;
      renderTable();
      setStatus("加载失败：" + err.message + "（可重试）");
      els.resultMeta.textContent = "查询失败";
    }
  }

  function renderTable() {
    if (!filtered) {
      els.body.innerHTML = `<tr><td colspan="6" class="empty-hint">选择省市区或输入关键词后显示结果</td></tr>`;
      els.pager.style.display = "none";
      return;
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);

    els.resultMeta.textContent =
      total === 0 ? "无匹配学校" : `共 ${total.toLocaleString("zh-CN")} 所 · 第 ${page}/${totalPages} 页`;

    if (total === 0) {
      els.body.innerHTML = `<tr><td colspan="6" class="empty-hint">未找到符合条件的学校，请调整关键词或地区</td></tr>`;
      els.pager.style.display = "none";
      return;
    }

    els.body.innerHTML = slice
      .map(
        (r) => `
      <tr>
        <td><strong>${escapeHtml(r.name)}</strong></td>
        <td>${escapeHtml(r.stage || "—")}</td>
        <td>${escapeHtml(r.province)}</td>
        <td>${escapeHtml(r.city)}</td>
        <td>${escapeHtml(r.district)}</td>
        <td class="num">${escapeHtml(r.id || "—")}</td>
      </tr>`
      )
      .join("");

    els.pager.style.display = "flex";
    els.pageInfo.textContent = `${page} / ${totalPages}`;
    els.prevBtn.disabled = page <= 1;
    els.nextBtn.disabled = page >= totalPages;
  }

  function scheduleQuery() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runQuery, 300);
  }

  els.province.addEventListener("change", () => {
    fillCities(els.province.value);
    scheduleQuery();
  });
  els.city.addEventListener("change", () => {
    fillDistricts(els.province.value, els.city.value);
    scheduleQuery();
  });
  els.district.addEventListener("change", scheduleQuery);
  els.keyword.addEventListener("input", scheduleQuery);

  els.prevBtn.addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      renderTable();
    }
  });
  els.nextBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil((filtered?.length || 0) / PAGE_SIZE));
    if (page < totalPages) {
      page += 1;
      renderTable();
    }
  });

  els.resetBtn.addEventListener("click", () => {
    els.keyword.value = "";
    els.province.value = "";
    fillCities("");
    filtered = null;
    page = 1;
    renderTable();
    setStatus("请选择地区或输入校名开始查询");
    els.resultMeta.textContent = "尚未查询";
  });

  loadRegions().catch((err) => {
    setStatus("地区数据加载失败：" + err.message);
  });
})();
