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

/**
 * Bright Data Monitor for Surge
 * * Arguments:
 * token: Your API Token
 * zone: The Zone name
 * pricePerGB: (Optional) Cost per GB in USD (e.g., 8.5)
 * budgetUSD: (Optional) Monthly budget limit for alerts (e.g., 50)
 * warnPct: (Optional) Warning percentage threshold (default 80)
 * gbBase: (Optional) "binary" (1024) or "decimal" (1000)
 */

(async () => {
  // --- 1. CONFIGURATION & PARSING ---
  const args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
  const CONFIG = {
    token: args.token,
    zone: args.zone,
    pricePerGB: args.pricePerGB ? Number(args.pricePerGB) : null,
    budgetUSD: args.budgetUSD ? Number(args.budgetUSD) : null,
    warnPct: args.warnPct ? Number(args.warnPct) : 80,
    gbDivisor: (args.gbBase || "binary").toLowerCase() === "decimal" ? 1e9 : 1073741824, // 1024^3
  };

  if (!CONFIG.token || !CONFIG.zone) {
    return $done({
      title: "Bright Data Error",
      style: "error",
      content: "Missing required arguments: token=&zone="
    });
  }

  // --- 2. HELPER FUNCTIONS ---
  
  // Promisified HTTP Request
  const fetchAPI = (endpoint) => {
    return new Promise((resolve) => {
      const url = `https://api.brightdata.com/zone/${endpoint}?zone=${encodeURIComponent(CONFIG.zone)}`;
      const headers = { "Authorization": `Bearer ${CONFIG.token}` };
      
      $httpClient.get({ url, headers }, (err, resp, data) => {
        if (err || !resp || resp.status >= 300) {
          console.log(`[BrightData] Error fetching ${endpoint}: ${err || resp?.status}`);
          resolve(null); // Resolve null to prevent Promise.all from failing entirely
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        }
      });
    });
  };

  // Formatters
  const fmtUSD = (n) => (isFinite(n) && n != null) ? `$${n.toFixed(2)}` : "—";
  
  const fmtData = (bytes) => {
    const n = Number(bytes);
    if (!isFinite(n) || n < 0) return "0 MB";
    if (n < CONFIG.gbDivisor) {
      const mb = n / (CONFIG.gbDivisor / 1024);
      return `${mb.toFixed(1)} MB`;
    }
    const gb = n / CONFIG.gbDivisor;
    return `${gb.toFixed(2)} GB`;
  };

  // --- 3. MAIN LOGIC ---

  // Fetch IPs and Costs in PARALLEL to speed up the script
  const [ipData, costData] = await Promise.all([
    fetchAPI("ips"),
    fetchAPI("cost")
  ]);

  // Process IP Count (Optional data)
  const ipCount = (ipData && Array.isArray(ipData.ips)) ? ipData.ips.length : null;

  // Process Costs (Critical data)
  if (!costData) {
    return $done({ title: `Bright Data (${CONFIG.zone})`, style: "error", content: "API Request Failed" });
  }

  // Extract Usage safely
  // API structure usually: { "zone_name": { "back_m0": {...}, "back_d0": {...} } }
  const rootKey = Object.keys(costData)[0];
  const usage = (rootKey && costData[rootKey]) ? costData[rootKey] : {};
  
  const metrics = {
    dayBW: Number(usage.back_d0?.bw) || 0,
    monthBW: Number(usage.back_m0?.bw) || 0,
    monthCost: usage.back_m0?.cost // might be undefined if not available
  };

  // Calculations
  const mGB = metrics.monthBW / CONFIG.gbDivisor;
  const dGB = metrics.dayBW / CONFIG.gbDivisor;
  
  const estMonthUSD = CONFIG.pricePerGB ? mGB * CONFIG.pricePerGB : metrics.monthCost;
  const estDayUSD = CONFIG.pricePerGB ? dGB * CONFIG.pricePerGB : null;

  // --- 4. BUDGET & NOTIFICATIONS ---
  
  let panelStyle = "info";
  
  if (CONFIG.budgetUSD > 0 && estMonthUSD !== null) {
    const pct = (estMonthUSD / CONFIG.budgetUSD) * 100;
    const level = pct >= 100 ? "OVER" : pct >= CONFIG.warnPct ? "WARN" : "OK";
    
    // Set Panel Style
    if (level === "WARN") panelStyle = "alert"; // Yellow/Orange in Surge
    if (level === "OVER") panelStyle = "error"; // Red in Surge

    // Handle Persistent Notification
    const storeKey = `bd_budget_${CONFIG.zone}`;
    const lastLevel = $persistentStore.read(storeKey) || "OK";

    if (level !== lastLevel && (level === "WARN" || level === "OVER")) {
      $notification.post(
        `Bright Data: ${CONFIG.zone}`,
        `Budget Alert: ${level}`,
        `Usage: ${fmtUSD(estMonthUSD)} / ${fmtUSD(CONFIG.budgetUSD)} (${pct.toFixed(0)}%)`
      );
    }
    $persistentStore.write(level, storeKey);
  }

  // --- 5. UI CONSTRUCTION ---

  const now = new Date();
  // Calculate days remaining in UTC (BrightData uses UTC billing)
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const daysLeft = Math.ceil((nextReset - now) / 86400000);

  const lines = [
    // Line 1: Combined IPs and Days
    `Static IPs: ${ipCount || 0} | Days Left: ${daysLeft}`,
    
    // Line 2: Usage = Estimated Cost (based on pricePerGB)
    // `Month: ${fmtData(metrics.monthBW)}` + (estMonthUSD ? ` ≈ ${fmtUSD(estMonthUSD)}` : ""),
    
    // Line 3: The hard cost returned by the API
    metrics.monthCost != null ? `Accrued Cost: ${fmtUSD(metrics.monthCost)}` : null
  ].filter(Boolean);

  $done({
    title: `Bright Data (${CONFIG.zone})`,
    style: panelStyle,
    content: lines.join("\n")
  });

})();

// --- UTILS ---
function parseArgs(str) {
  const out = {};
  if (!str || typeof str !== "string") return out;
  str.split("&").forEach(pair => {
    const [k, v] = pair.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return out;
}

