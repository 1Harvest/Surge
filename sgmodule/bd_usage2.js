/**
 * Bright Data Monitor for Surge (Updated with Balance)
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
  
  // Promisified HTTP Request for Zone Data
  const fetchAPI = (endpoint) => {
    return new Promise((resolve) => {
      const url = `https://api.brightdata.com/zone/${endpoint}?zone=${encodeURIComponent(CONFIG.zone)}`;
      const headers = { "Authorization": `Bearer ${CONFIG.token}` };
      
      $httpClient.get({ url, headers }, (err, resp, data) => {
        if (err || !resp || resp.status >= 300) {
          console.log(`[BrightData] Error fetching ${endpoint}: ${err || resp?.status}`);
          resolve(null); 
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

  // NEW: Fetch Account Balance
  const fetchBalance = () => {
    return new Promise((resolve) => {
      const url = `https://api.brightdata.com/customer/balance`; 
      const headers = { "Authorization": `Bearer ${CONFIG.token}` };
      
      $httpClient.get({ url, headers }, (err, resp, data) => {
        if (err || !resp || resp.status >= 300) {
          console.log(`[BrightData] Error fetching balance: ${err || resp?.status}`);
          resolve(null); 
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

  // Fetch IPs, Costs, and Balance in PARALLEL
  const [ipData, costData, balanceData] = await Promise.all([
    fetchAPI("ips"),
    fetchAPI("cost"),
    fetchBalance() 
  ]);

  // Process IP Count
  const ipCount = (ipData && Array.isArray(ipData.ips)) ? ipData.ips.length : null;

  // Process Costs
  if (!costData) {
    return $done({ title: `Bright Data (${CONFIG.zone})`, style: "error", content: "API Request Failed" });
  }

  const rootKey = Object.keys(costData)[0];
  const usage = (rootKey && costData[rootKey]) ? costData[rootKey] : {};
  
  const metrics = {
    dayBW: Number(usage.back_d0?.bw) || 0,
    monthBW: Number(usage.back_m0?.bw) || 0,
    monthCost: usage.back_m0?.cost 
  };

  // Calculations
  const mGB = metrics.monthBW / CONFIG.gbDivisor;
  // const dGB = metrics.dayBW / CONFIG.gbDivisor; // Unused in current display
  
  const estMonthUSD = CONFIG.pricePerGB ? mGB * CONFIG.pricePerGB : metrics.monthCost;

  // Process Balance
  // API returns { balance: 123.45, pending_balance: 0 }
  const accountBalance = balanceData ? balanceData.balance : null;

  // --- 4. BUDGET & NOTIFICATIONS ---
  
  let panelStyle = "info";
  if (CONFIG.budgetUSD > 0 && estMonthUSD !== null) {
    const pct = (estMonthUSD / CONFIG.budgetUSD) * 100;
    const level = pct >= 100 ? "OVER" : pct >= CONFIG.warnPct ? "WARN" : "OK";

    if (level === "WARN") panelStyle = "alert";
    if (level === "OVER") panelStyle = "error";

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
  const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const daysLeft = Math.ceil((nextReset - now) / 86400000);

  const lines = [
    // Line 1: IPs + Days Left
    `Static IPs: ${ipCount || 0} | Days Left: ${daysLeft}`,
    
    // Line 2: Account Balance (New)
    accountBalance !== null ? `Balance: ${fmtUSD(accountBalance)}` : null,

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
