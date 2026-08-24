(() => {
  const QUESTION_TYPES = ["单选", "多选", "填空", "判断"];
  const META_HEADERS = ["账号", "用户", "姓名", "耗时", "总分", "缺考", "学校"];

  let files = [];
  let lastReport = null;

  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("fileInput");
  const fileList = document.getElementById("fileList");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const thresholdInput = document.getElementById("threshold");
  const resultsPanel = document.getElementById("resultsPanel");
  const summaryGrid = document.getElementById("summaryGrid");
  const rateBody = document.getElementById("rateBody");
  const resultsBody = document.getElementById("resultsBody");
  const logPanel = document.getElementById("logPanel");
  const logBox = document.getElementById("logBox");
  const downloadTxtBtn = document.getElementById("downloadTxtBtn");
  const downloadJsonBtn = document.getElementById("downloadJsonBtn");
  const downloadImgBtn = document.getElementById("downloadImgBtn");

  uploadZone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => addFiles(e.target.files));
  clearBtn.addEventListener("click", clearAll);
  analyzeBtn.addEventListener("click", runAnalysis);
  downloadTxtBtn.addEventListener("click", () => downloadReport("txt"));
  downloadJsonBtn.addEventListener("click", () => downloadReport("json"));
  downloadImgBtn.addEventListener("click", downloadLogImage);

  ["dragenter", "dragover"].forEach((evt) => {
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.remove("dragover");
    });
  });
  uploadZone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  function addFiles(newFiles) {
    for (const f of newFiles) {
      if (!/\.xlsx?$/i.test(f.name)) continue;
      if (!files.some((x) => x.name === f.name && x.size === f.size)) {
        files.push(f);
      }
    }
    renderFileList();
  }

  function renderFileList() {
    fileList.innerHTML = files
      .map(
        (f, i) =>
          `<span class="file-tag">${escapeHtml(f.name)}<button type="button" data-i="${i}" title="移除">×</button></span>`
      )
      .join("");
    fileList.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        files.splice(Number(btn.dataset.i), 1);
        renderFileList();
      });
    });
    analyzeBtn.disabled = files.length === 0;
  }

  function clearAll() {
    files = [];
    lastReport = null;
    fileInput.value = "";
    renderFileList();
    resultsPanel.style.display = "none";
    logPanel.style.display = "none";
    downloadTxtBtn.disabled = true;
    downloadJsonBtn.disabled = true;
    downloadImgBtn.disabled = true;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array", cellDates: true });
          resolve(wb);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function cellStr(val) {
    if (val == null) return "";
    return String(val).trim();
  }

  function isMetaColumn(header) {
    const h = cellStr(header);
    if (!h) return true;
    return META_HEADERS.some((k) => h.includes(k));
  }

  function detectQuestionType(category, subHeader) {
    const combined = (cellStr(category) + cellStr(subHeader)).replace(/\s/g, "");
    for (const t of QUESTION_TYPES) {
      if (combined.includes(t)) return t;
    }
    const sub = cellStr(subHeader);
    const m = sub.match(/(\d+)\s*(单选|多选|填空|判断)/);
    if (m) return m[2];
    return "未知";
  }

  function extractQuestionNo(subHeader, type) {
    const sub = cellStr(subHeader);
    const patterns = [
      new RegExp("(\\d+)\\s*" + type),
      /第?\s*(\d+)\s*题/,
      /^(\d+)$/,
    ];
    for (const p of patterns) {
      const m = sub.match(p);
      if (m) return m[1];
    }
    return sub || "—";
  }

  function forwardFillCategories(row) {
    const out = [];
    let last = "";
    for (let i = 0; i < row.length; i++) {
      const v = cellStr(row[i]);
      if (v) last = v;
      out.push(last);
    }
    return out;
  }

  function parseScore(val) {
    if (val == null || val === "") return null;
    if (typeof val === "number" && !Number.isNaN(val)) return val;
    const s = String(val).trim();
    if (s === "" || s === "/" || s === "—" || s === "-") return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  function findMetaEndCol(subHeaderRow) {
    let lastMeta = -1;
    for (let c = 0; c < subHeaderRow.length; c++) {
      if (isMetaColumn(subHeaderRow[c])) lastMeta = c;
      else if (cellStr(subHeaderRow[c])) break;
    }
    return lastMeta;
  }

  function analyzeSheet(sheet, fileName, sheetName, threshold) {
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (rows.length < 3) return { questions: [], students: 0 };

    const categoryRow = forwardFillCategories(rows[0] || []);
    const subHeaderRow = rows[1] || [];
    const metaEndCol = findMetaEndCol(subHeaderRow);
    const dataRows = rows.slice(2);

    const presentRows = dataRows.filter((row) => {
      if (!row || row.every((c) => cellStr(c) === "")) return false;
      const absentCol = subHeaderRow.findIndex((h) => cellStr(h).includes("缺考"));
      if (absentCol >= 0) {
        const marker = cellStr(row[absentCol]);
        if (marker && marker !== "/" && marker !== "／" && marker !== "0" && marker !== "") {
          return false;
        }
      }
      return true;
    });

    const questions = [];

    for (let c = metaEndCol + 1; c < subHeaderRow.length; c++) {
      const subHeader = subHeaderRow[c];
      if (!cellStr(subHeader) && !cellStr(categoryRow[c])) continue;

      const type = detectQuestionType(categoryRow[c], subHeader);
      if (type === "未知" && isMetaColumn(subHeader)) continue;

      const scores = [];
      for (const row of presentRows) {
        const s = parseScore(row[c]);
        if (s !== null) scores.push(s);
      }

      if (scores.length === 0) continue;

      const maxScore = Math.max(...scores);
      const correctCount = scores.filter((s) => s >= maxScore).length;
      const wrongCount = scores.length - correctCount;
      const wrongRate = wrongCount / scores.length;
      const questionNo = extractQuestionNo(subHeader, type === "未知" ? "" : type);

      questions.push({
        fileName,
        sheetName,
        type,
        questionNo,
        columnLabel: cellStr(subHeader) || `列${c + 1}`,
        category: cellStr(categoryRow[c]),
        maxScore,
        totalStudents: scores.length,
        correctCount,
        wrongCount,
        wrongRate,
        wrongPercent: (wrongRate * 100).toFixed(1),
        flagged: wrongRate >= threshold,
      });
    }

    return { questions, students: presentRows.length };
  }

  async function runAnalysis() {
    const threshold = Number(thresholdInput.value) / 100;
    if (Number.isNaN(threshold) || threshold <= 0 || threshold > 1) {
      alert("请输入有效的阈值（50-100）");
      return;
    }

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "分析中…";

    const allQuestions = [];
    let totalStudents = 0;
    const errors = [];

    for (const file of files) {
      try {
        const wb = await readWorkbook(file);
        for (const sheetName of wb.SheetNames) {
          const result = analyzeSheet(wb.Sheets[sheetName], file.name, sheetName, threshold);
          allQuestions.push(...result.questions);
          totalStudents = Math.max(totalStudents, result.students);
        }
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
    }

    const flagged = allQuestions.filter((q) => q.flagged);
    const rateStats = buildRateStats(allQuestions);

    lastReport = {
      generatedAt: new Date().toISOString(),
      thresholdPercent: threshold * 100,
      fileCount: files.length,
      totalQuestions: allQuestions.length,
      flaggedCount: flagged.length,
      totalStudents,
      flagged,
      allQuestions,
      rateStats,
      errors,
    };

    renderResults(lastReport);
    analyzeBtn.disabled = files.length === 0;
    analyzeBtn.textContent = "开始分析";
  }

  function buildRateBucket(questions, label) {
    const questionCount = questions.length;
    const attemptCount = questions.reduce((s, q) => s + q.totalStudents, 0);
    const correctCount = questions.reduce((s, q) => s + q.correctCount, 0);
    const wrongCount = questions.reduce((s, q) => s + q.wrongCount, 0);
    const wrongRate = attemptCount > 0 ? wrongCount / attemptCount : 0;
    const avgQuestionWrongRate =
      questionCount > 0 ? questions.reduce((s, q) => s + q.wrongRate, 0) / questionCount : 0;
    return {
      label,
      questionCount,
      attemptCount,
      correctCount,
      wrongCount,
      wrongRate,
      wrongPercent: (wrongRate * 100).toFixed(1),
      avgQuestionWrongRate,
      avgQuestionWrongPercent: (avgQuestionWrongRate * 100).toFixed(1),
    };
  }

  function buildRateStats(allQuestions) {
    const byType = QUESTION_TYPES.map((t) =>
      buildRateBucket(
        allQuestions.filter((q) => q.type === t),
        t
      )
    ).filter((x) => x.questionCount > 0);

    const unknown = allQuestions.filter((q) => !QUESTION_TYPES.includes(q.type));
    if (unknown.length) byType.push(buildRateBucket(unknown, "未知"));

    const overall = buildRateBucket(allQuestions, "全卷合计");
    return { byType, overall };
  }

  function renderResults(report) {
    resultsPanel.style.display = "block";
    logPanel.style.display = "block";

    const overallRate = report.rateStats?.overall?.wrongPercent ?? "—";

    summaryGrid.innerHTML = `
      <div class="stat"><div class="value">${report.fileCount}</div><div class="label">分析文件数</div></div>
      <div class="stat"><div class="value">${report.totalQuestions}</div><div class="label">题目总数</div></div>
      <div class="stat"><div class="value" style="color:var(--danger)">${report.flaggedCount}</div><div class="label">疑似有问题</div></div>
      <div class="stat"><div class="value" style="color:var(--coral)">${overallRate}%</div><div class="label">全卷错题率</div></div>
    `;

    if (rateBody && report.rateStats) {
      const rows = [...report.rateStats.byType, report.rateStats.overall];
      rateBody.innerHTML = rows
        .map((r) => {
          const isOverall = r.label === "全卷合计";
          const labelHtml = isOverall
            ? `<strong>${escapeHtml(r.label)}</strong>`
            : `<span class="badge badge-${r.label}">${escapeHtml(r.label)}</span>`;
          return `
            <tr class="${isOverall ? "rate-total" : ""}">
              <td>${labelHtml}</td>
              <td>${r.questionCount}</td>
              <td>${r.attemptCount}</td>
              <td>${r.correctCount}</td>
              <td>${r.wrongCount}</td>
              <td class="num" style="color:var(--danger);font-weight:700">${r.wrongPercent}%</td>
              <td>${r.avgQuestionWrongPercent}%</td>
            </tr>`;
        })
        .join("");
    }

    const displayRows =
      report.flagged.length > 0
        ? report.flagged
        : report.allQuestions.filter((q) => q.wrongRate >= 0.5);

    if (displayRows.length === 0) {
      resultsBody.innerHTML = `<tr><td colspan="10" class="empty-hint">未发现异常题目，所有题目错题率均低于阈值</td></tr>`;
    } else {
      resultsBody.innerHTML = displayRows
        .sort((a, b) => b.wrongRate - a.wrongRate)
        .map(
          (q) => `
        <tr class="${q.flagged ? "flagged" : ""}">
          <td>${escapeHtml(q.fileName)}${q.sheetName !== "Sheet1" ? `<br><small>${escapeHtml(q.sheetName)}</small>` : ""}</td>
          <td><span class="badge badge-${q.type}">${escapeHtml(q.type)}</span></td>
          <td>${escapeHtml(q.questionNo)}</td>
          <td>${escapeHtml(q.columnLabel)}</td>
          <td>${q.maxScore}</td>
          <td>${q.totalStudents}</td>
          <td>${q.correctCount}</td>
          <td>${q.wrongCount}</td>
          <td>${q.wrongPercent}%</td>
          <td>${q.flagged ? '<strong style="color:var(--danger)">需复核</strong>' : "—"}</td>
        </tr>`
        )
        .join("");
    }

    logBox.innerHTML = buildLogHtml(report);
    downloadTxtBtn.disabled = false;
    downloadJsonBtn.disabled = false;
    downloadImgBtn.disabled = false;
  }

  function buildLogHtml(report) {
    const now = new Date(report.generatedAt);
    const hasIssues = report.flaggedCount > 0;

    let html = `<div class="log-inner">`;

    html += `
      <div class="log-header">
        <h3>试卷题目质量分析报告</h3>
        <div class="log-time">生成时间：${escapeHtml(now.toLocaleString("zh-CN"))}</div>
      </div>
    `;

    html += `
      <div class="log-summary">
        <div class="log-summary-item"><div class="num">${report.fileCount}</div><div class="lbl">分析文件</div></div>
        <div class="log-summary-item"><div class="num">${report.totalStudents}</div><div class="lbl">参考人数（最大）</div></div>
        <div class="log-summary-item"><div class="num">${report.totalQuestions}</div><div class="lbl">题目总数</div></div>
        <div class="log-summary-item"><div class="num">${report.rateStats?.overall?.wrongPercent ?? "—"}%</div><div class="lbl">全卷错题率</div></div>
        <div class="log-summary-item${hasIssues ? " alert" : ""}"><div class="num">${report.flaggedCount}</div><div class="lbl">疑似有问题</div></div>
      </div>
    `;

    if (report.rateStats) {
      html += `<div class="log-section-title">各题型与总错题率</div>`;
      html += `<div class="log-type-stats" style="display:block">`;
      html += `<div class="table-wrap" style="margin-bottom:8px"><table class="data" style="min-width:0"><thead><tr>
        <th>范围</th><th>题目数</th><th>作答人次</th><th>答错人次</th><th>错题率</th><th>平均单题错题率</th>
      </tr></thead><tbody>`;
      for (const r of [...report.rateStats.byType, report.rateStats.overall]) {
        html += `<tr>
          <td>${escapeHtml(r.label)}</td>
          <td>${r.questionCount}</td>
          <td>${r.attemptCount}</td>
          <td>${r.wrongCount}</td>
          <td style="color:var(--danger);font-weight:700">${r.wrongPercent}%</td>
          <td>${r.avgQuestionWrongPercent}%</td>
        </tr>`;
      }
      html += `</tbody></table></div></div>`;
    }

    if (report.errors.length) {
      html += `<div class="log-errors"><strong>解析错误</strong><ul>`;
      report.errors.forEach((e) => {
        html += `<li>${escapeHtml(e)}</li>`;
      });
      html += `</ul></div>`;
    }

    if (!hasIssues) {
      html += `
        <div class="log-conclusion ok">
          <strong>结论：试卷正常</strong> — 未发现错题率达到 ${report.thresholdPercent}% 阈值的题目。
        </div>
      `;
    } else {
      html += `
        <div class="log-conclusion warn">
          <strong>结论：发现 ${report.flaggedCount} 道题目需复核</strong> — 以下题目错题率 ≥ ${report.thresholdPercent}%，可能存在答案键错误、题干歧义或分值设置问题。
        </div>
      `;

      html += `<div class="log-section-title">需复核题目（共 ${report.flaggedCount} 道）</div>`;

      const grouped = {};
      for (const q of report.flagged) {
        const key = `${q.fileName}::${q.sheetName}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(q);
      }

      for (const [key, qs] of Object.entries(grouped)) {
        const [fileName, sheetName] = key.split("::");
        const sheetLabel = sheetName !== "Sheet1" ? ` · ${escapeHtml(sheetName)}` : "";
        html += `
          <div class="log-file-group">
            <div class="log-file-name">${escapeHtml(fileName)}${sheetLabel} <span style="color:var(--muted);font-weight:400">（${qs.length} 道）</span></div>
            <ul class="log-question-list">
        `;
        for (const q of qs.sort(
          (a, b) => Number(a.questionNo) - Number(b.questionNo) || a.columnLabel.localeCompare(b.columnLabel)
        )) {
          html += `
            <li class="log-question-item">
              <span class="badge badge-${q.type}">${escapeHtml(q.type)}</span>
              <span class="log-q-no">第 ${escapeHtml(q.questionNo)} 题</span>
              <span class="log-q-rate">${q.wrongPercent}% 错题率</span>
              <span class="log-q-stats">
                答对 <b>${q.correctCount}</b> / 答错 <b style="color:var(--danger)">${q.wrongCount}</b> / 共 ${q.totalStudents} 人
                · 题目分数 <b>${q.maxScore}</b>
                · ${escapeHtml(q.columnLabel)}
              </span>
            </li>
          `;
        }
        html += `</ul></div>`;
      }

      const typeStats = QUESTION_TYPES.map((t) => ({
        t,
        n: report.flagged.filter((q) => q.type === t).length,
      })).filter((x) => x.n > 0);

      if (typeStats.length) {
        html += `<div class="log-section-title">按题型分布</div><div class="log-type-stats">`;
        typeStats.forEach(({ t, n }) => {
          html += `<span class="log-type-chip"><span class="badge badge-${t}">${t}</span> <span class="cnt">${n}</span> 道</span>`;
        });
        html += `</div>`;
      }

      html += `
        <div class="log-suggest">
          <strong>处理建议：</strong>请优先核查以上题目的标准答案、选项设置与分值；确认是否存在漏题、泄题或系统录分错误。
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  function buildLogText(report) {
    const lines = [];
    const now = new Date(report.generatedAt);
    const hasIssues = report.flaggedCount > 0;

    lines.push("=".repeat(56));
    lines.push("  试卷题目质量分析报告");
    lines.push("=".repeat(56));
    lines.push(`生成时间: ${now.toLocaleString("zh-CN")}`);
    lines.push("");
    lines.push("【概览】");
    lines.push(`  分析文件:     ${report.fileCount} 个`);
    lines.push(`  参考人数:     ${report.totalStudents} 人（最大）`);
    lines.push(`  题目总数:     ${report.totalQuestions} 道`);
    lines.push(`  错题率阈值:   >= ${report.thresholdPercent}%`);
    lines.push(`  全卷错题率:   ${report.rateStats?.overall?.wrongPercent ?? "—"}%`);
    lines.push(`  疑似有问题:   ${report.flaggedCount} 道  ${hasIssues ? "!!" : ""}`);
    lines.push("");

    if (report.rateStats) {
      lines.push("【各题型与总错题率】");
      lines.push("  范围\t题目数\t作答人次\t答错人次\t错题率\t平均单题错题率");
      for (const r of [...report.rateStats.byType, report.rateStats.overall]) {
        lines.push(
          `  ${r.label}\t${r.questionCount}\t${r.attemptCount}\t${r.wrongCount}\t${r.wrongPercent}%\t${r.avgQuestionWrongPercent}%`
        );
      }
      lines.push("");
    }

    if (report.errors.length) {
      lines.push("【解析错误】");
      report.errors.forEach((e) => lines.push(`  ! ${e}`));
      lines.push("");
    }

    if (!hasIssues) {
      lines.push("【结论】试卷正常");
      lines.push(`  未发现错题率达到 ${report.thresholdPercent}% 阈值的题目。`);
    } else {
      lines.push(`【结论】发现 ${report.flaggedCount} 道题目需复核 !!`);
      lines.push(`  以下题目错题率 >= ${report.thresholdPercent}%`);
      lines.push("");
      lines.push(`【需复核题目清单】共 ${report.flaggedCount} 道`);
      lines.push("-".repeat(56));

      const grouped = {};
      for (const q of report.flagged) {
        const key = `${q.fileName}::${q.sheetName}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(q);
      }

      for (const [key, qs] of Object.entries(grouped)) {
        const [fileName, sheetName] = key.split("::");
        lines.push("");
        lines.push(`>> 文件: ${fileName}${sheetName !== "Sheet1" ? ` / ${sheetName}` : ""} (${qs.length} 道)`);
        for (const q of qs.sort(
          (a, b) => Number(a.questionNo) - Number(b.questionNo) || a.columnLabel.localeCompare(b.columnLabel)
        )) {
          lines.push(
            `   [${q.type}] 第${q.questionNo}题  |  错题率 ${q.wrongPercent}%  |  答对 ${q.correctCount} / 答错 ${q.wrongCount} / 共 ${q.totalStudents}  |  题目分数 ${q.maxScore}  |  ${q.columnLabel}`
          );
        }
      }

      lines.push("");
      lines.push("【按题型分布】");
      for (const t of QUESTION_TYPES) {
        const n = report.flagged.filter((q) => q.type === t).length;
        if (n) lines.push(`  ${t}: ${n} 道`);
      }

      lines.push("");
      lines.push("【处理建议】");
      lines.push("  请优先核查以上题目的标准答案、选项设置与分值；");
      lines.push("  确认是否存在漏题、泄题或系统录分错误。");
    }

    lines.push("");
    lines.push("=".repeat(56));
    return lines.join("\n");
  }

  function downloadReport(format) {
    if (!lastReport) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "txt") {
      const blob = new Blob([buildLogText(lastReport)], { type: "text/plain;charset=utf-8" });
      saveBlob(blob, `题目质量分析报告_${ts}.txt`);
    } else {
      const blob = new Blob([JSON.stringify(lastReport, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      saveBlob(blob, `题目质量分析报告_${ts}.json`);
    }
  }

  async function downloadLogImage() {
    if (!lastReport) return;

    const target = document.getElementById("logExportArea");
    const logEl = logBox;
    const btn = downloadImgBtn;
    const prevBtnText = btn.textContent;
    const prevMaxHeight = logEl.style.maxHeight;
    const prevOverflow = logEl.style.overflow;

    btn.disabled = true;
    btn.textContent = "生成中…";

    logEl.style.maxHeight = "none";
    logEl.style.overflow = "visible";

    try {
      const canvas = await html2canvas(target, {
        backgroundColor: "#fafcfc",
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("图片生成失败"));
            return;
          }
          saveBlob(blob, `题目质量分析报告_${ts}.png`);
          resolve();
        }, "image/png");
      });
    } catch (err) {
      alert("导出图片失败：" + err.message);
    } finally {
      logEl.style.maxHeight = prevMaxHeight;
      logEl.style.overflow = prevOverflow;
      btn.disabled = false;
      btn.textContent = prevBtnText;
    }
  }

  function saveBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
})();
