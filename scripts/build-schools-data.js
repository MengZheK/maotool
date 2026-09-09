/**
 * Convert 全国中小学.xlsx → data/schools/regions.json + by-province/*.json
 *
 * Usage:
 *   node scripts/build-schools-data.js [path-to-xlsx]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_XLSX = "E:\\school\\outputs\\k12_schools_20260826\\全国中小学.xlsx";
const OUT_DIR = path.join(ROOT, "data", "schools");
const BY_PROV_DIR = path.join(OUT_DIR, "by-province");

function loadXlsx() {
  const candidates = [
    path.join(process.env.TEMP || "/tmp", "xlsx-pkg", "package", "xlsx.js"),
    path.join(ROOT, "node_modules", "xlsx", "xlsx.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("xlsx package not found. Run: npm pack xlsx && extract to %TEMP%/xlsx-pkg");
}

function cityName(row) {
  const display = String(row["城市显示名"] || "").trim();
  const city = String(row["城市"] || "").trim();
  return display || city || "未分区";
}

function districtName(row) {
  return String(row["区县"] || "").trim() || "未分区";
}

function main() {
  const xlsxPath = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) {
    console.error("Source xlsx not found:", xlsxPath);
    process.exit(1);
  }

  const XLSX = loadXlsx();
  console.log("Reading", xlsxPath);
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  console.log("Rows:", rows.length);

  fs.mkdirSync(BY_PROV_DIR, { recursive: true });

  /** @type {Record<string, Record<string, Set<string>>>} */
  const tree = {};
  /** @type {Record<string, Array>} */
  const byProvince = {};
  /** @type {string[]} */
  const provinceOrder = [];

  for (const row of rows) {
    const province = String(row["省份"] || "").trim();
    if (!province) continue;
    const city = cityName(row);
    const district = districtName(row);
    const name = String(row["学校名称"] || "").trim();
    if (!name) continue;
    const stage = String(row["学段"] || "").trim();
    const id = String(row["学校标识码"] || "").trim();

    if (!tree[province]) {
      tree[province] = {};
      provinceOrder.push(province);
      byProvince[province] = [];
    }
    if (!tree[province][city]) tree[province][city] = new Set();
    tree[province][city].add(district);

    // [name, stage, city, district, id]
    byProvince[province].push([name, stage, city, district, id]);
  }

  const regions = {
    provinces: provinceOrder,
    tree: {},
  };
  for (const p of provinceOrder) {
    const cities = Object.keys(tree[p]).sort((a, b) => a.localeCompare(b, "zh-CN"));
    regions.tree[p] = {};
    for (const c of cities) {
      regions.tree[p][c] = [...tree[p][c]].sort((a, b) => a.localeCompare(b, "zh-CN"));
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "regions.json"), JSON.stringify(regions), "utf8");
  console.log("Wrote regions.json, provinces:", provinceOrder.length);

  let total = 0;
  const manifest = [];
  for (const p of provinceOrder) {
    const list = byProvince[p];
    total += list.length;
    const fileName = `${p}.json`;
    fs.writeFileSync(path.join(BY_PROV_DIR, fileName), JSON.stringify(list), "utf8");
    const size = fs.statSync(path.join(BY_PROV_DIR, fileName)).size;
    manifest.push({ province: p, file: fileName, count: list.length, bytes: size });
    console.log(`  ${p}: ${list.length} schools (${(size / 1024).toFixed(1)} KB)`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), total, provinces: manifest }, null, 2),
    "utf8"
  );
  console.log("Done. Total schools:", total);
}

main();
