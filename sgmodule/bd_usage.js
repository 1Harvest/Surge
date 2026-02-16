/***********************
 * Bright Data Usage Panel (Surge)
 * - Shows Today + Month-to-date bandwidth (MB < 1GB, else GB)
 * - Shows cost (API cost if present, else estimate via pricePerGB)
 * - Optional: budget alert + one-time notifications
 * - Optional: static IP count (for ISP static zones)
 *
 * Args (via [Script] argument=...):
 *   zone=ZONE_NAME                         (required)
 *   api_key=XXXX or token=XXXX             (recommended; can be stored)
 *   storeKey=bd_api_key                    (optional; default bd_api_key)
 *   pricePerGB=15                          (optional; for estimation fallback)
 *   budgetUSD=300                          (optional)
 *   warnPct=80                             (optional; default 80)
 *   gbBase=binary|decimal                  (optional; default binary)
 *   showIP=1|0                             (optional; default 1)
 *   showCycle=1|0                          (optional; default 1)
 *   notify=1|0                             (optional; default 1 if budgetUSD is set)
 *   policy=DIRECT                          (optional; default DIRECT)
 ***********************/

function parseArgs(argStr) {
  const out = {};
  if (!argStr || typeof argStr !== "string") return out;
  argStr.split("&").forEach((kv) => {
    const [k, v = ""] = kv.split("=");
    if (!k) return;
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return out;
}

function fmtUSD(n) {
  const num = Number(n);
  if (!isFinite(num)) return "n/a";
  return `$${num.toFixed(2)}`;
}

function ymdUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextBillingResetUTC(now = new Date()) {
  // Bright Data billing cycle starts on the 1st of each month. :contentReference[oaicite:7]{index=7}
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

function daysLeftToResetUTC(now = new Date()) {
  const next = nextBillingResetUTC(now).getTime();
  const msLeft = next - now.getTime();
  return Math.max(0, Math.ceil(msLeft / 86400000));
}

function extractBuckets(obj) {
  // Find the first value that looks like { back_m0: {...}, back_d0: {...} }
  if (!obj || typeof obj !== "object") return null;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object" && (v.back_m0 || v.back_d0)) return v;
  }
  return null;
}

function pickBucket(buckets, name) {
  const b = buckets && buckets[name] ? buckets[name] : null;
  const bw = b ? Number(b.bw) : 0;
  const costNum = b ? Number(b.cost) : NaN;
  return {
    bw: isFinite(bw) && bw > 0 ? bw : 0,
    cost: isFinite(costNum) ? costNum : null,
  };
}

function fmtMBorGB(bytes, MB_BYTES, GB_BYTES) {
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return "—";
  if (n < GB_BYTES) {
    const mb = n / MB_BYTES;
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  } else {
    const gb = n / GB_BYTES;
    return `${gb.toFixed(gb >= 10 ? 1 : 3)} GB`;
  }
}

function httpGet(url, headers, policy, cb) {
  $httpClient.get({ url, headers, policy, timeout: 8 }, (err, resp, data) => {
    if (err) return cb(err);
    if (!resp || resp.status < 200 || resp.status >= 300) {
      return cb(new Error(`HTTP ${resp ? resp.status : "?"}: ${data || ""}`));
    }
    cb(null, data);
  });
}

// ---- main ----
const args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const zone = args.zone;

const gbBase = (args.gbBase || "binary").toLowerCase(); // keep your current default behavior
const GB_BYTES = gbBase === "decimal" ? 1e9 : 1024 * 1024 * 1024;
const MB_BYTES = gbBase === "decimal" ? 1e6 : 1024 * 1024;

const policy = args.policy || "DIRECT";
const storeKey = args.storeKey || "bd_api_key";

const showIP = args.showIP == null ? true : String(args.showIP) === "1";
const showCycle = args.showCycle == null ? true : String(args.showCycle) === "1";

const pricePerGB = args.pricePerGB != null ? Number(args.pricePerGB) : null;
const budgetUSD = args.budgetUSD != null ? Number(args.budgetUSD) : null;
const warnPct = args.warnPct != null ? Number(args.warnPct) : 80;

const notify = args.notify != null ? String(args.notify) === "1" : (budgetUSD != null);

if (!zone) {
  $done({ title: "Bright Data", style: "error", content: "Missing zone=... in script arguments." });
  return;
}

// Accept api_key or token; optionally store it so you don’t keep it in the profile
if (args.api_key) $persistentStore.write(args.api_key, storeKey);
if (args.token) $persistentStore.write(args.token, storeKey);

const apiKey = $persistentStore.read(storeKey) || args.api_key || args.token;
if (!apiKey) {
  $done({
    title: `Bright Data (${zone})`,
    style: "alert",
    content: `No API key.\nAdd once: api_key=YOUR_API_KEY&zone=${zone}\nThen remove api_key from profile.`,
  });
  return;
}

const headers = { Authorization: `Bearer ${apiKey}` }; // Bright Data uses API key as Bearer token. :contentReference[oaicite:8]{index=8}

const costUrl = `https://api.brightdata.com/zone/cost?zone=${encodeURIComponent(zone)}`;
const ipsUrl = `https://api.brightdata.com/zone/ips?zone=${encodeURIComponent(zone)}`;

let ipCount = null;

function finish(buckets) {
  const back_m0 = pickBucket(buckets, "back_m0");
  const back_d0 = pickBucket(buckets, "back_d0");

  const mGB = back_m0.bw / GB_BYTES;
  const dGB = back_d0.bw / GB_BYTES;

  const estMonthUSD = pricePerGB != null ? mGB * pricePerGB : null;
  const estDayUSD = pricePerGB != null ? dGB * pricePerGB : null;

  // Prefer API cost when present, else estimate
  const monthCostUsed = back_m0.cost != null ? back_m0.cost : estMonthUSD;

  let style = "info";
  if (budgetUSD != null && monthCostUsed != null && isFinite(monthCostUsed) && budgetUSD > 0) {
    const pct = (monthCostUsed / budgetUSD) * 100;
    if (pct >= 100) style = "error";
    else if (pct >= warnPct) style = "alert";
  }

  if (notify && budgetUSD != null && monthCostUsed != null && isFinite(monthCostUsed) && budgetUSD > 0) {
    const pct = (monthCostUsed / budgetUSD) * 100;
    const level = pct >= 100 ? "OVER" : pct >= warnPct ? "WARN" : "OK";
    const key = `bd_budget_${zone}`;
    const last = $persistentStore.read(key) || "OK";
    if (level !== last && (level === "WARN" || level === "OVER")) {
      $notification.post(
        "Bright Data budget",
        `${zone}: ${level}`,
        `MTD ${fmtUSD(monthCostUsed)} / ${fmtUSD(budgetUSD)} (${pct.toFixed(1)}%)`,
        { action: "open-url", url: "https://brightdata.com/cp/zones" }
      ); // supported in Surge scripts :contentReference[oaicite:9]{index=9}
    }
    $persistentStore.write(level, key);
  }

  const now = new Date();
  const reset = nextBillingResetUTC(now);
  const daysLeft = daysLeftToResetUTC(now);

  const lines = [
    showIP && ipCount != null ? `Static IPs: ${ipCount}` : null,
    showCycle ? `Cycle resets: ${ymdUTC(reset)} 00:00 UTC (${daysLeft}d left)` : null,
    `Today: ${fmtMBorGB(back_d0.bw, MB_BYTES, GB_BYTES)}` + (estDayUSD != null ? ` ≈ ${fmtUSD(estDayUSD)}` : ""),
    `MTD:  ${fmtMBorGB(back_m0.bw, MB_BYTES, GB_BYTES)}` +
      (monthCostUsed != null ? ` ≈ ${fmtUSD(monthCostUsed)}` : ""),
    back_m0.cost != null ? `API cost (MTD): ${fmtUSD(back_m0.cost)}` : null,
  ].filter(Boolean);

  $done({ title: `Bright Data (${zone})`, style, content: lines.join("\n") });
}

// 1) Get cost/bw (required)
httpGet(costUrl, headers, policy, (e, body) => {
  if (e) {
    $done({ title: `Bright Data (${zone})`, style: "error", content: `Failed /zone/cost\n${String(e)}` });
    return;
  }

  let obj;
  try { obj = JSON.parse(body); } catch (err) {
    $done({ title: `Bright Data (${zone})`, style: "error", content: `Bad JSON\n${String(err)}` });
    return;
  }

  const buckets = extractBuckets(obj) || obj;

  // 2) Get IPs (optional)
  if (!showIP) {
    finish(buckets);
    return;
  }

  httpGet(ipsUrl, headers, policy, (e2, ipsBody) => {
    if (!e2) {
      try {
        const j = JSON.parse(ipsBody);
        if (Array.isArray(j.ips)) ipCount = j.ips.length;
      } catch (_) {}
    }
    finish(buckets);
  });
});
