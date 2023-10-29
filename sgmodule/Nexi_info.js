/*
* 由@mieqq编写

* 原脚本地址：https://raw.githubusercontent.com/mieqq/mieqq/master/sub_info_panel.js

Surge配置参考注释，

示例↓↓↓ 
----------------------------------------
[Script]
Sub_info = type=generic,timeout=10,script-path=https://raw.githubusercontent.com/Rabbit-Spec/Surge/Master/Module/Panel/Sub-info/Moore/Sub-info.js,script-update-interval=0,argument=url=[URL encode 后的机场节点链接]&title=AmyInfo&icon=bonjour&color=#007aff&starting_date=2023-01-07

[Panel]
Sub_info = script-name=Sub_info,update-interval=86400
----------------------------------------

先将带有流量信息的节点订阅链接encode，用encode后的链接替换"url="后面的[机场节点链接]

可选参数 "starting_date=2023-01-07"，后面的数字替换成订阅开始日期，注意一定要按照yyyy-MM-dd的格式，不加该参数不显示流量重置信息。

可选参数 "title=xxx" 可以自定义标题。

可选参数 "icon=xxx" 可以自定义图标，内容为任意有效的 SF Symbol Name，如 bolt.horizontal.circle.fill，详细可以下载app https://apps.apple.com/cn/app/sf-symbols-browser/id1491161336

可选参数 "color=xxx" 当使用 icon 字段时，可传入 color 字段控制图标颜色，字段内容为颜色的 HEX 编码。如：color=#007aff

----------------------------------------
*/

let args = getArgs();

(async () => {
  let info = await getDataInfo(args.url);
  if (!info) $done();

  let startingDate = args.starting_date;
  let resetDayLeft = getRmainingDays(startingDate, 31);
  let title = resetDayLeft ? `${args.title} ` + `| 𝗥𝗲𝘀𝗲𝘁 : ` + `${resetDayLeft} Days` : args.title;

  let used = info.download + info.upload;
  let total = info.total;
  let content = [`𝗨𝘀𝗴 : ${(used/total*100).toFixed(2)}% | 𝗕𝗮𝗹 : ${bytesToSize(total-used)}`];

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
  let method = args.method || "head";
  let request = { headers: { "User-Agent": "Quantumult%20X" }, url };
  return new Promise((resolve, reject) =>
    $httpClient[method](request, (err, resp) => {
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
      .match(/\w+=[\d.eE+-]+/g)
      .map((item) => item.split("="))
      .map(([k, v]) => [k, Number(v)])
  );
}

function getRmainingDays(startingDate, interval) {
    if (!startingDate || !interval) return;

    let now = new Date();
    let startDate = new Date(startingDate);
    let resetDate = new Date(startDate);
    resetDate.setDate(startDate.getDate() + interval); 

    while (now >= resetDate) {
        startDate.setDate(startDate.getDate() + interval);
        resetDate.setDate(startDate.getDate() + interval);
    }

    let remainingDays = Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24)); 
    return remainingDays;
}

function bytesToSize(bytes) {
  if (bytes === 0) return "0B";
  let k = 1024;
  sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}
