import { checkSignature } from "./utils";

// https://core.telegram.org/bots/api#html-style
const allowedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'tg-spoiler', 'br'];
const textRegex = /\d{4,}/;
const styleRegex = /display\s*:\s*none\s*|visibility\s*:\s*hidden/g;
const MAIL_LENGTH = 2000;
/**
 * Converts a ReadableStream to an ArrayBuffer.
 *
 * @param {ReadableStream} stream - The ReadableStream to convert.
 * @param {number} streamSize - The size of the ReadableStream in bytes.
 * @returns {Promise<ArrayBuffer>} - A Promise that resolves with the converted ArrayBuffer.
 */
async function streamToArrayBuffer(stream, streamSize) {
  let result = new Uint8Array(streamSize);
  let bytesRead = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    result.set(value, bytesRead);
    bytesRead += value.length;
  }
  return result;
}

async function readEmail(raw) {
  const PostalMime = require("postal-mime");
  const parser = new PostalMime.default();
  const parsedEmail = await parser.parse(raw);
  console.log('parsedEmail', parsedEmail);
  const html = parsedEmail.html;
  const from = `${parsedEmail.from.name} <${parsedEmail.from.address}>`;
  const to = parsedEmail.deliveredTo ?? parsedEmail.to[0].address;
  const message = parsedEmail.text.trim();
  const subject = parsedEmail.subject;
  const messageId = parsedEmail.messageId.replace(/@.*$/, "").replace(/^</, "");
  return { from, to, subject, message, messageId, html };
}

async function sendMessageToTelegram(id, token, message, messageId, domain) {
  console.log('sendMessageToTelegram', id, token, message, messageId, domain)
  return await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: id,
      text: message,
      disable_web_page_preview: true,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{
          text: 'Preview',
          web_app: {
            url: `https://${domain}/index.html?id=${encodeURIComponent(messageId)}`,
          }
        }]]
      }
    }),
  })
}

class ElementHandler {
  constructor() {
    this.mailLength = 0;
    this.drop = false;
  }

  text(text) {
    // 将包含连续4位以上数字的文本使用code标签包裹
    if (textRegex.test(text.text)) {
      text.replace(text.text.replace(/(\d{4,})/g, '<code>$1</code>'), { html: true });
    }
    this.mailLength += text.text.length;
    if (this.mailLength > MAIL_LENGTH) {
      this.drop = true;
    }
  }
  comments(comment) {
    // 注释去除
    comment.remove();
  }
  element(element) {
    if (this.drop) {
      element.remove();
      return;
    }

    // display: none; visibility: hidden; 的标签去除
    if (element.getAttribute('style') && styleRegex.test(element.getAttribute('style'))) {
      element.replace('<br>', { html: true });
      return;
    }

    // 处理不支持的标签
    if (!allowedTags.includes(element.tagName)) {
      // TODO 将 h1-h6 转换为 b
      // if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'].includes(element.tagName)) {
      //     element.after(`<b>${element.innerHTML}</b>`);
      //     element.remove();
      //     return;
      // }
      // style, script 标签去除
      if (['style', 'script', 'iframe'].includes(element.tagName)) {
        element.remove();
        return;
      }
      // p, div, table 标签前插入<br>
      if (['p', 'div', 'table', 'tr'].includes(element.tagName)) {
        element.before('<br>', { html: true });
      }
      element.removeAndKeepContent();
      return;
    }

    // 处理a标签，将内容替换为innerText
    if (element.tagName === 'a') {
      // 删除a标签的属性，只保留href
      const attributes = element.attributes;
      debugger
      for (const attribute of attributes) {
        if (attribute[0] !== 'href') {
          element.removeAttribute(attribute[0]);
        }
      }
      return;
    }
  }
}


/**
 * 使用HTMLRewriter将html转换为telegram bot支持的html格式
 * bot支持的标签： <b> <i> <u> <s> <a> <code> <pre> <tg-spoiler>
 * 1. 去除不支持的标签
 * 2. 将不支持的标签转换为支持的标签
 * 3. 将style包含 display: node，visibility: hidden 的标签去除
 * 4. 将验证码的文本使用code标签包裹
 */
async function convertHtmlToTelegram(html) {
  const rewriter = new HTMLRewriter();
  rewriter.on('*', new ElementHandler());
  // 删除换行
  html = html.replace(/[\r\n]/g, '');

  const result = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }), { removeWhitespace: true });

  let res = await result.text();
  // 删除连续的<br>，只保留2个
  res = res/* .replace(/(<br>\s*){2,}/g, '\n') */.replace(/(<br>\s*)/g, '\n').replace(/&nbsp;/g, '').replace(/(\n\s*){2,}/g, '\n').trim();
  // 删除空标签
  res = res.replace(/<([^>]*)\s*?[^>]*>\s*?(<\/\1>)/g, '');
  return res;
}

async function getMailContent(request, env) {
  const {
    TELEGRAM_TOKEN: token,
  } = env;
  // get params
  const params = await request.json()
  const { id } = params
  // get headers
  const headers = request.headers
  const singature = headers.get('singature')
  if (!checkSignature(singature, token)) {
    return new Response('401 Unauthorized', {
      status: 401
    });
  }
  try {
    const html = await env.NAMESPACE.get(id, { cacheTTL: 3600 })

    return new Response(html ?? 'NOT FOUND', {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response('', {
      headers: {
        "content-type": "text/html;charset=UTF-8",
      },
    });
  }
}

async function fetchHandler(request, env, ctx) {
  const { protocol, pathname } = new URL(request.url);

  if (protocol !== "https:") {
    return new Response(null, { status: 403 });
  }
  switch (pathname) {
    case "/api/getMail":
      return await getMailContent(request, env);
    case "/favicon.ico":
    case "/robots.txt":
      return new Response(null, { status: 204 });
    case "/telegram-web-app.js":
      const res = await fetch("https://telegram.org/js/telegram-web-app.js");
      // get etag
      const etag = res.headers.get('etag')
      const etagHeader = request.headers.get('if-none-match')
      if (etagHeader && etagHeader === etag) {
        return new Response(null, { status: 304 });
      }
      return res;
  }

  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=yes" />
  <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black" />
  <meta name="viewport" content="width=device-width, viewport-fit=cover, initial-scale=1.0,, maximum-scale=1" />
  <title>Gmail</title>
  <style>
    body,
    #app {
      max-width: 100vw;
    }

    #app div {
      max-width: 100vw;
      box-sizing: border-box;
    }

    .loader {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      display: block;
      margin: 60px auto;
      position: relative;
      color: #7fc70c;
      box-sizing: border-box;
      animation: animloader 1s linear infinite alternate;
    }

    @keyframes animloader {
      0% {
        box-shadow: -38px -12px, -14px 0, 14px 0, 38px 0;
      }

      33% {
        box-shadow: -38px 0px, -14px -12px, 14px 0, 38px 0;
      }

      66% {
        box-shadow: -38px 0px, -14px 0, 14px -12px, 38px 0;
      }

      100% {
        box-shadow: -38px 0, -14px 0, 14px 0, 38px -12px;
      }
    }
  </style>
</head>
<body>
  <div id="app">
    <span class="loader"></span>
  </div>
  <!-- <script src="https://telegram.org/js/telegram-web-app.js"></script> -->
  <script src="/telegram-web-app.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.1.2/dist/axios.min.js"></script>
  <script>
    Telegram.WebApp.ready();
    let query = new URLSearchParams(location.search)

    axios.post('/api/getMail', {
      id: query.get('id'),
    }, {
      headers: {
        singature: Telegram.WebApp.initData
      }
    }).then(res => {
      document.querySelector('#app').innerHTML = res.data
    }).catch(err => {
      document.querySelector('#app').innerHTML = err.message
    })
  </script>
</body>
</html>`, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  });
}

function convertHtml(html, code = false) {
  if (!html) {
    return ''
  }
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (code) {
    html = html.replace(/\d{4,}/g, (a, b) => {
      return `<code>${a}</code>`
    })
  }
  return html
}


async function emailHandler(message, env, ctx) {
  const {
    TELEGRAM_ID: id,
    TELEGRAM_TOKEN: token,
    PREVIEW_DOMAIN: domain,
  } = env;

  const raw = await streamToArrayBuffer(message.raw, message.rawSize);
  const res = await readEmail(raw);
  let body = res.message;
  if (res.html) {
    console.log('html', res.html)
    body = await convertHtmlToTelegram(res.html).catch((err) => {
      console.error('convertHtmlToTelegram', err);
      return null;
    });
    console.log('body', body)
  }
  const text = `${body ?? res.message}
_______________
✉️: ${convertHtml(res.from)}
To: ${convertHtml(res.to)}
${convertHtml(res.subject)}`;

  await sendMessageToTelegram(id, token, text, res.messageId, domain).then(async (response) => {
    const result = await response.json();
    if (!result.ok) {
      await sendMessageToTelegram(id, token, `${convertHtml(result.description)}
_______________
✉️: ${convertHtml(res.from)}
To: ${convertHtml(res.to)}
${convertHtml(res.subject)}`, res.messageId, domain)
    }
  });

  await env.NAMESPACE.put(res.messageId, res.html ?? res.message, { expirationTtl: 15552000 })
}

export default {
  fetch: fetchHandler,
  email: emailHandler,
};
