// Update checks and installs. Runs in the Electron main process.
// The app checks a small JSON file in the GitHub repository. If it names a newer
// version, the user can download that installer, which is checked against the
// SHA-256 in the JSON before it runs.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const REPO = "cameronawharton/household-budget";
const LATEST_URL = process.env.HB_UPDATE_URL || `https://raw.githubusercontent.com/${REPO}/main/latest.json`;
// Installers may only come from this repository (or the local test server when testing).
const ALLOWED = [
  `https://github.com/${REPO}/`,
  `https://raw.githubusercontent.com/${REPO}/`,
  ...(process.env.HB_UPDATE_URL ? [new URL(process.env.HB_UPDATE_URL).origin + "/"] : []),
];

function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function validInfo(info) {
  return info && typeof info.version === "string" && /^\d+\.\d+\.\d+$/.test(info.version) &&
    typeof info.url === "string" && ALLOWED.some((p) => info.url.startsWith(p)) &&
    typeof info.sha256 === "string" && /^[a-f0-9]{64}$/.test(info.sha256);
}

// Returns { available, current, latest?, notes? } and never throws.
async function check(fetchFn, currentVersion) {
  try {
    const res = await fetchFn(`${LATEST_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return { available: false, current: currentVersion, error: `HTTP ${res.status}` };
    const info = await res.json();
    if (!validInfo(info)) return { available: false, current: currentVersion, error: "Update info is not valid" };
    const newer = compareVersions(info.version, currentVersion) > 0;
    return { available: newer, current: currentVersion, latest: info.version, notes: info.notes || "", info: newer ? info : undefined };
  } catch (e) {
    return { available: false, current: currentVersion, error: e.message };
  }
}

// Downloads the installer, verifies it, and returns the file path. Calls onProgress(0..100).
async function download(fetchFn, info, onProgress) {
  if (!validInfo(info)) throw new Error("Update info is not valid");
  const res = await fetchFn(info.url);
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const file = path.join(os.tmpdir(), `Household-Budget-Setup-${info.version}.exe`);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash("sha256");
  const reader = res.body.getReader();
  let got = 0, lastPct = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
      got += value.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct) { lastPct = pct; onProgress && onProgress(pct); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  const digest = hash.digest("hex");
  if (digest !== info.sha256) {
    try { fs.unlinkSync(file); } catch (_) {}
    throw new Error("The downloaded file didn't match. Nothing was installed. Try again later.");
  }
  return file;
}

function launchInstaller(file) {
  const child = spawn(file, [], { detached: true, stdio: "ignore" });
  child.unref();
}

module.exports = { compareVersions, validInfo, check, download, launchInstaller, LATEST_URL };
