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

function fmtBytes(n) {
  const num = Number(n);
  if (!isFinite(num) || num <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, x = num;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
function fmtUSD(n) {
  const num = Number(n);
  if (!isFinite(num)) return "n/a";
  return `$${num.toFixed(2)}`;
}

const args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
const token = args.token;
const zone = args.zone;
const pricePerGB = args.pricePerGB ? Number(args.pricePerGB) : null;
const budgetUSD = args.budgetUSD ? Number(args.budgetUSD) : null;
const warnPct = args.warnPct ? Number(args.warnPct) : 80;
const gbBase = (args.gbBase || "binary").toLowerCase(); // binary=1024^3, decimal=1e9
const policy = args.policy || "DIRECT";

if (!token || !zone) {
  $done({ title: "Bright Data", style: "error", content: "Set token=...&zone=... in [Script] argument=..." });
}

const GB_BYTES = gbBase === "decimal" ? 1e9 : 1024 * 1024 * 1024;
const headers = { Authorization: `Bearer ${token}` };

function httpGet(url, cb) {
  $httpClient.get({ url, headers, policy }, (err, resp, data) => {
    if (err) return cb(err);
    if (!resp || resp.status < 200 || resp.status >= 300) return cb(new Error(`HTTP ${resp ? resp.status : "?"}: ${data || ""}`));
    cb(null, data);
  });
}

const ipsUrl = `https://api.brightdata.com/zone/ips?zone=${encodeURIComponent(zone)}`;
const costUrl = `https://api.brightdata.com/zone/cost?zone=${encodeURIComponent(zone)}`;

httpGet(ipsUrl, (e1, ipsBody) => {
  // IP count is “nice to have”; don’t fail the whole panel if it errors
  let ipCount = null;
  if (!e1) {
    try {
      const j = JSON.parse(ipsBody);
      if (Array.isArray(j.ips)) ipCount = j.ips.length;
    } catch (_) {}
  }

  httpGet(costUrl, (e2, costBody) => {
    if (e2) {
      return $done({ title: `Bright Data (${zone})`, style: "error", content: `Failed /zone/cost\n${String(e2)}` });
    }

    let back_m0 = { bw: 0, cost: null };
    let back_d0 = { bw: 0, cost: null };

    try {
      const j = JSON.parse(costBody);
      const rootKey = Object.keys(j)[0];
      const buckets = rootKey ? j[rootKey] : null;
      if (buckets && buckets.back_m0) back_m0 = { bw: Number(buckets.back_m0.bw) || 0, cost: buckets.back_m0.cost };
      if (buckets && buckets.back_d0) back_d0 = { bw: Number(buckets.back_d0.bw) || 0, cost: buckets.back_d0.cost };
    } catch (_) {}

    const mGB = back_m0.bw / GB_BYTES;
    const dGB = back_d0.bw / GB_BYTES;

    const estMonthUSD = pricePerGB != null ? mGB * pricePerGB : null;
    const estDayUSD = pricePerGB != null ? dGB * pricePerGB : null;

    // Style based on budget (optional)
    let style = "info";
    if (budgetUSD != null && estMonthUSD != null && isFinite(estMonthUSD) && budgetUSD > 0) {
      const pct = (estMonthUSD / budgetUSD) * 100;
      if (pct >= warnPct) style = "alert";
      if (pct >= 100) style = "error";
    }

    // Optional: one-time notifications when crossing levels (uses Surge persistent store + notification APIs)
    // $persistentStore.read/write documented here :contentReference[oaicite:3]{index=3}
    // $notification.post documented here :contentReference[oaicite:4]{index=4}
    if (budgetUSD != null && estMonthUSD != null && isFinite(estMonthUSD) && budgetUSD > 0) {
      const pct = (estMonthUSD / budgetUSD) * 100;
      const level = pct >= 100 ? "OVER" : pct >= warnPct ? "WARN" : "OK";
      const key = `bd_budget_${zone}`;
      const last = $persistentStore.read(key) || "OK";
      if (level !== last && (level === "WARN" || level === "OVER")) {
        $notification.post(
          "Bright Data budget",
          `${zone}: ${level}`,
          `MTD est ${fmtUSD(estMonthUSD)} / ${fmtUSD(budgetUSD)} (${pct.toFixed(1)}%)`,
          { action: "open-url", url: "https://brightdata.com/cp/zones" }
        );
      }
      $persistentStore.write(level, key);
    }

    function fmtMBorGB(bytes, GB_BYTES) {
        const n = Number(bytes);
        if (!isFinite(n) || n < 0) return "—";
      
        const MB_BYTES = GB_BYTES / 1024;
        if (n < GB_BYTES) {
          const mb = n / MB_BYTES;
          return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
        } else {
          const gb = n / GB_BYTES;
          return `${gb.toFixed(gb >= 10 ? 1 : 3)} GB`;
        }
      }

          function ymdUTC(d) {
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
      
      function nextBillingResetUTC(now = new Date()) {
        // 1st of next month at 00:00 UTC
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
      }
      
      function daysLeftToResetUTC(now = new Date()) {
        const next = nextBillingResetUTC(now).getTime();
        const msLeft = next - now.getTime();
        // ceil so “partial day” counts as a day remaining (usually what you want in a dashboard)
        return Math.max(0, Math.ceil(msLeft / 86400000));
      }


    const now = new Date();
    const reset = nextBillingResetUTC(now);
    const daysLeft = daysLeftToResetUTC(now);
    const lines = [
      ipCount == null ? null : `Static IPs: ${ipCount}`,
      `Days left: ${daysLeft}`,
      `Today: ${fmtMBorGB(back_d0.bw, GB_BYTES)}` + (estDayUSD != null ? ` ≈ ${fmtUSD(estDayUSD)}` : ""),
      `MTD:  ${fmtMBorGB(back_m0.bw, GB_BYTES)}` + (estMonthUSD != null ? ` ≈ ${fmtUSD(estMonthUSD)}` : ""),
      back_m0.cost != null ? `API cost (MTD): ${fmtUSD(back_m0.cost)}` : null
    ].filter(Boolean);


    $done({ title: `Bright Data (${zone})`, style, content: lines.join("\n") });
  });
});
