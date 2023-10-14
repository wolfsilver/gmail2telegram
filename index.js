import { sha256 } from 'js-sha256';

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

  const html = parsedEmail.html;
  const from = `${parsedEmail.from.name} <${parsedEmail.from.address}>`;
  const to = parsedEmail.deliveredTo;
  const message = parsedEmail.text.trim();
  const subject = parsedEmail.subject;
  const messageId = parsedEmail.messageId.replace(/@.*$/, "").replace(/^</, "");
  return { from, to, subject, message, messageId, html };
}

async function sendMessageToTelegram(id, token, message, messageId, domain) {
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
  });
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
  const text = `
${convertHtml(res.message, true)}
_______________
✉️: ${convertHtml(res.from)}
To: ${convertHtml(res.to)}
${convertHtml(res.subject)}
`;
  await sendMessageToTelegram(id, token, text, res.messageId, domain);

  await env.NAMESPACE.put(res.messageId, res.html ?? res.message, { expirationTtl: 15552000 })
}

function hmacSha256(key, data, hex) {
  const hash = sha256.hmac.create(key);
  hash.update(data);
  if (hex) {
    return hash.hex();
  }
  return hash.arrayBuffer();
}

function checkSignature(origin, token) {
  origin = decodeURIComponent(origin)

  let checkString = [];
  let signature = '';
  let timeStamp = 0;
  origin.split('&').forEach(el => {
    if (el.startsWith('hash=')) {
      signature = el.substring(5)
      return;
    }
    if (el.startsWith('auth_date=')) {
      timeStamp = el.substring(10)
    }
    checkString.push(el)
  })
  if (Math.abs(Date.now() - timeStamp * 1000) > 300000) {
    return false;
  }

  checkString = checkString.sort().join('\n')

  const secret_key = hmacSha256("WebAppData", token)
  const hash = hmacSha256(secret_key, checkString, 'hex')
  return signature === hash
}

export default {
  fetch: fetchHandler,
  email: emailHandler,
};
