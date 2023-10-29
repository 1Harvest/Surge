/*
 * 由@mieqq编写
 * 原脚本地址：https://raw.githubusercontent.com/mieqq/mieqq/master/sub_info_panel.js
 * 由@Rabbit-Spec修改
 * 更新日期：2022.08.24
 * 版本：1.5
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
  let expire = args.expire || info.expire;
  let content = [`用量：${bytesToSize(used)} | ${bytesToSize(total)}`];

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

/*
function getRemainingDays(startingDate, interval) {
    if (!startingDate || !interval) return;

    let now = new Date();
    let startDate = new Date(startingDate);
    let daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)); 
    let intervalsPassed = Math.floor(daysPassed / interval); 
    let resetDate = new Date(startDate);
    resetDate.setDate(startDate.getDate() + interval * (intervalsPassed + 1));

    let remainingDays = Math.ceil((resetDate - now) / (1000 * 60 * 60 * 24));

    return remainingDays; 
}
*/

function getRemainingDays(startingDate, interval) {
    if (!startingDate || !interval) return;

    let now = new Date().getTime(); 
    let startDate = new Date(startingDate).getTime(); 
    let daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24)); 
    let remainingDays = interval - (daysPassed % interval); 

    return remainingDays; 
}

function bytesToSize(bytes) {
  if (bytes === 0) return "0B";
  let k = 1024;
  sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  let i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
}

function formatTime(time) {
  let dateObj = new Date(time);
  let year = dateObj.getFullYear();
  let month = dateObj.getMonth() + 1;
  let day = dateObj.getDate();
  return year + "年" + month + "月" + day + "日";
}
