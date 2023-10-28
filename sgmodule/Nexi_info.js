/*
模板来自@mieqq大佬（转大佬感谢：感谢@asukanana,感谢@congcong.）。

Surge配置参考注释，

示例↓↓↓ 
----------------------------------------
[Script]
Sub_info = type=generic,timeout=10,script-path=https://raw.githubusercontent.com/chaizia/Profiles/master/MySurge/sub_info_panel.js,script-update-interval=0,argument=url=[URL encode 后的机场节点链接]&title=AmyInfo&icon=bonjour&color=#007aff&starting_date=2023-10-20
[Panel]
Sub_info = script-name=Sub_info,update-interval=86400
----------------------------------------

先将带有流量信息的节点订阅链接encode，用encode后的链接替换"url="后面的[机场节点链接]

可选参数 &starting_date，后面的数字替换成订阅开始日期，不加该参数不显示流量重置信息。如"&2023-01-07"，注意一定要按照yyyy-MM-dd的格式。

可选参数"title=xxx" 可以自定义标题。

可选参数"icon=xxx" 可以自定义图标，内容为任意有效的 SF Symbol Name，如 bolt.horizontal.circle.fill，详细可以下载app https://apps.apple.com/cn/app/sf-symbols-browser/id1491161336

可选参数"color=xxx" 当使用 icon 字段时，可传入 color 字段控制图标颜色，字段内容为颜色的 HEX 编码。如：color=#007aff
----------------------------------------
*/

(async () => {
  let args = getArgs();
  let info = await getDataInfo(args.url);
  if (!info) $done();
  let startingDate = args.starting_date;
  let resetDayLeft = getRmainingDays(startingDate, 31);
  let title = resetDayLeft ? `${args.title} ` + `| 𝗥𝗲𝘀𝗲𝘁 : ` + `${resetDayLeft} Days` : args.title;

  let used = info.download + info.upload;
  let total = info.total;
  let expire = args.expire || info.expire;
  let proportion = used / total;
  let content = [`𝗨𝘀𝗮𝗴𝗲 : ${toPercent(proportion)} | 𝗕𝗮𝗹 : ${bytesToSize(total-used)}`];

  let now = new Date();
  let hour = now.getHours();
  let minutes = now.getMinutes();
  hour = hour > 9 ? hour : "0" + hour;
  minutes = minutes > 9 ? minutes : "0" + minutes;
  
  $done({
    title: title,
    content: content.join("\n"),
    icon: args.icon || "airplane.circle",
    "icon-color": args.color || "#007aff",
  });
})();

function getArgs() {
  return Object.fromEntries(
    $argument
      .split("&")
      .map((item) => item.split("="))
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function getUserInfo(url) {
  let request = { headers: { "User-Agent": "Quantumult%20X" }, url };
  return new Promise((resolve, reject) =>
    $httpClient.get(request, (err, resp) => {
      if (err != null) {
        reject(err);
        return;
      }
      if (resp.status !== 200) {
        reject(resp.status);
        return;
      }
      let header = Object.keys(resp.headers).find(
        (key) => key.toLowerCase() === "subscription-userinfo"
      );
      if (header) {
        resolve(resp.headers[header]);
        return;
      }
      reject("链接响应头不带有流量信息");
    })
  );
}

async function getDataInfo(url) {
  const [err, data] = await getUserInfo(url)
    .then((data) => [null, data])
    .catch((err) => [err, null]);
  if (err) {
    console.log(err);
    return;
  }

  return Object.fromEntries(
    data
      .match(/\w+=[\d.eE+]+/g)
      .map((item) => item.split("="))
      .map(([k, v]) => [k, Number(v)])
  );
}

function getRmainingDays(startingDate, interval) {
    if (!startingDate || !interval) return;

    let now = new Date();
    let startDate = new Date(startingDate);
    let resetDate = new Date(startDate);
    resetDate.setDate(startDate.getDate() + interval); // Initially set the reset date based on the interval

    // Adjust the startingDate forward by intervals of 31 days until it's ahead of the current date
    while (now >= resetDate) {
        startDate.setDate(startDate.getDate() + interval);
        resetDate.setDate(startDate.getDate() + interval);
    }

    let remainingDays = Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24)); // Calculate the remaining days

    return remainingDays;
}

function bytesToSize(bytes) {
  if (bytes === 0) return "0B";
  let k = 1024;
  sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 4 ) return (((bytes / Math.pow(k, i)))*1024).toFixed(2)+ " " + sizes[i-1];
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function formatTime(time) {
  let dateObj = new Date(time);
  let year = dateObj.getFullYear();
  let month = dateObj.getMonth() + 1;
  let day = dateObj.getDate();
  return year + "年" + month + "月" + day + "日";
}

function toPercent(proportion) {
  const percent = Number(proportion*100).toFixed(2);
  return percent + "%";
}
