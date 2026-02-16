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
  var out = {};
  if (!argStr || typeof argStr !== "string") return out;
  argStr.split("&").forEach(function (kv) {
    var parts = kv.split("=");
    var k = parts[0];
    var v = parts.length > 1 ? parts.slice(1).join("=") : "";
    if (!k) return;
    out[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return out;
}

function fmtUSD(n) {
  var num = Number(n);
  if (!isFinite(num)) return "n/a";
  return "$" + num.toFixed(2);
}

// No padStart to avoid any runtime quirks
function z2(x) {
  x = String(x);
  return x.length === 1 ? "0" + x : x;
}

function ymdUTC(d) {
  return d.getUTCFullYear() + "-" + z2(d.getUTCMonth() + 1) + "-" + z2(d.getUTCDate());
}

function nextBillingResetUTC(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

function daysLeftToResetUTC(now) {
  var next = nextBillingResetUTC(now).getTime();
  var msLeft = next - now.getTime();
  return Math.max(0, Math.ceil(msLeft / 86400000));
}

function fmtMBorGB(bytes, GB_BYTES, MB_BYTES) {
  var n = Number(bytes);
  if (!isFinite(n) || n < 0) return "—";
  if (n < GB_BYTES) {
    var mb = n / MB_BYTES;
    return (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)) + " MB";
  } else {
    var gb = n / GB_BYTES;
    return (gb >= 10 ? gb.toFixed(1) : gb.toFixed(3)) + " GB";
  }
}

function safeDone(title, style, content) {
  try {
    $done({ title: title, style: style, content: content });
  } catch (e) {
    // last resort
    $done({ title: "Bright Data", style: "error", content: "safeDone failed: " + String(e) });
  }
}

var args = parseArgs(typeof $argument !== "undefined" ? $argument : "");
var zone = args.zone;

// allow token= or api_key=
var storeKey = args.storeKey || "bd_api_key";
if (args.api_key) $persistentStore.write(args.api_key, storeKey);
if (args.token) $persistentStore.write(args.token, storeKey);
var token = $persistentStore.read(storeKey) || args.token || args.api_key;

var debug = String(args.debug || "0") === "1";
var policy = args.policy || "DIRECT";

var pricePerGB = args.pricePerGB != null ? Number(args.pricePerGB) : null;
var budgetUSD = args.budgetUSD != null ? Number(args.budgetUSD) : null;
var warnPct = args.warnPct != null ? Number(args.warnPct) : 80;

var gbBase = (args.gbBase || "binary").toLowerCase(); // binary=1024^3, decimal=1e9
var GB_BYTES = gbBase === "decimal" ? 1e9 : 1024 * 1024 * 1024;
var MB_BYTES = gbBase === "decimal" ? 1e6 : 1024 * 1024;

if (!token || !zone) {
  safeDone(
    "Bright Data",
    "error",
    "Missing args.\nSet zone=... and (token=... or api_key=...).\nTip: run once with api_key=...&storeKey=bd_api_key, then remove api_key."
  );
  return;
}

var headers = { Authorization: "Bearer " + token };

function httpGet(url, cb) {
  $httpClient.get({ url: url, headers: headers, policy: policy }, function (err, resp, data) {
    if (err) return cb(err);
    if (!resp || resp.status < 200 || resp.status >= 300) {
      return cb(new Error("HTTP " + (resp ? resp.status : "?") + ": " + (data || "")));
    }
    cb(null, data);
  });
}

var ipsUrl = "https://api.brightdata.com/zone/ips?zone=" + encodeURIComponent(zone);
var costUrl = "https://api.brightdata.com/zone/cost?zone=" + encodeURIComponent(zone); // zone usage/cost endpoint :contentReference[oaicite:1]{index=1}

httpGet(ipsUrl, function (e1, ipsBody) {
  var ipCount = null;
  if (!e1) {
    try {
      var j1 = JSON.parse(ipsBody);
      if (j1 && Array.isArray(j1.ips)) ipCount = j1.ips.length;
    } catch (_) {}
  }

  httpGet(costUrl, function (e2, costBody) {
    if (e2) {
      safeDone("Bright Data (" + zone + ")", "error", "Failed /zone/cost\n" + String(e2));
      return;
    }

    try {
      if (debug) {
        safeDone("Bright Data (" + zone + ")", "info", "DEBUG /zone/cost (first 900 chars):\n" + String(costBody).slice(0, 900));
        return;
      }

      var obj = JSON.parse(costBody);
      var rootKey = Object.keys(obj)[0];
      var buckets = rootKey ? obj[rootKey] : obj;

      var back_m0 = buckets && buckets.back_m0 ? buckets.back_m0 : {};
      var back_d0 = buckets && buckets.back_d0 ? buckets.back_d0 : {};

      var m_bw = Number(back_m0.bw) || 0;
      var d_bw = Number(back_d0.bw) || 0;

      var mGB = m_bw / GB_BYTES;
      var dGB = d_bw / GB_BYTES;

      var estMonthUSD = pricePerGB != null ? mGB * pricePerGB : null;
      var estDayUSD = pricePerGB != null ? dGB * pricePerGB : null;

      var apiMonthCost = (back_m0.cost != null && isFinite(Number(back_m0.cost))) ? Number(back_m0.cost) : null;
      var monthCostUsed = apiMonthCost != null ? apiMonthCost : estMonthUSD;

      var style = "info";
      if (budgetUSD != null && monthCostUsed != null && isFinite(monthCostUsed) && budgetUSD > 0) {
        var pct = (monthCostUsed / budgetUSD) * 100;
        if (pct >= 100) style = "error";
        else if (pct >= warnPct) style = "warning";
      }

      var now = new Date();
      var reset = nextBillingResetUTC(now);
      var daysLeft = daysLeftToResetUTC(now);

      var lines = [
        ipCount == null ? null : "Static IPs: " + ipCount,
        "Cycle resets: " + ymdUTC(reset) + " 00:00 UTC (" + daysLeft + "d left)",
        "Today: " + fmtMBorGB(d_bw, GB_BYTES, MB_BYTES) + (estDayUSD != null ? " ≈ " + fmtUSD(estDayUSD) : ""),
        "MTD:  " + fmtMBorGB(m_bw, GB_BYTES, MB_BYTES) + (monthCostUsed != null ? " ≈ " + fmtUSD(monthCostUsed) : ""),
        apiMonthCost != null ? "API cost (MTD): " + fmtUSD(apiMonthCost) : null
      ].filter(function (x) { return !!x; });

      safeDone("Bright Data (" + zone + ")", style, lines.join("\n"));
    } catch (e) {
      safeDone("Bright Data (" + zone + ")", "error", "Render error:\n" + String(e));
    }
  });
});

