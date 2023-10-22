// https://core.telegram.org/bots/api#html-style
const allowedTags = ['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'tg-spoiler', 'B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'A', 'CODE', 'PRE', 'TG-SPOILER'];
const HTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th'];
const textRegex = /\d{4,}/;
const styleRegex = /display\s*:\s*none\s*|visibility\s*:\s*hidden/g;
const MAIL_LENGTH = 2000;
const MAIL_MAX_LINES = 10;
let length = 0;
let contentLength = 0;

async function readRequestBody(request) {
  const contentType = request.headers.get("content-type");
  if (contentType.includes("application/json")) {
    return request.json()
  } else if (contentType.includes("application/text")) {
    return request.text();
  } else if (contentType.includes("text/html")) {
    return request.text();
  } else if (contentType.includes("form")) {
    const formData = await request.formData();
    const body = {};
    for (const entry of formData.entries()) {
      body[entry[0]] = entry[1];
    }
    return body;
  } else {
    // Perhaps some other type of data was submitted in the form
    // like an image, or some other binary data.
    return "";
  }
}

// https://github.com/taoqf/node-html-parser
async function convertHtmlToTelegram2(html) {
  const HTMLParser = require('node-html-parser');
  length = 0;
  contentLength = 0;
  let now = Date.now();
  const root = HTMLParser.parse(html, {
    lowerCaseTagName: false,  // convert tag name to lower case (hurts performance heavily)
    comment: false,            // retrieve comments (hurts performance slightly)
    voidTag: {
      tags: ['head', 'script', 'style', 'iframe', 'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'],	// optional and case insensitive, default value is ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']
      closingSlash: false     // optional, default false. void tag serialisation, add a final slash <br/>
    },
    blockTextElements: {
      script: false,	// keep text content when parsing
      noscript: false,	// keep text content when parsing
      style: false,		// keep text content when parsing
      pre: true			// keep text content when parsing
    }
  });

  now = Date.now();
  let txt = filterHtml(root.querySelector('body') ?? root.firstChild);
  txt = txt.replace(/(\n\s*){2,}/g, '\n\n').trim();
  return txt;
}


function filterHtml(el) {
  if (length > MAIL_MAX_LINES || contentLength > MAIL_LENGTH) {
    return '';
  }
  textRegex.lastIndex = 0;
  styleRegex.lastIndex = 0;
  const tagName = el.tagName;
  // 文本节点
  if (el.nodeType === 3) {
    // 将包含连续6位数字的文本使用code标签包裹
    let content = el.trimmedText.trim();
    length += Math.max(Math.round(content.length / 50), 1);
    contentLength += content.length;
    if (content.match(textRegex)) {
      return content.replace(/(?<![0-9a-zA-Z!@#$%^&*()-+_/])([.\d]{4,})(?![0-9a-zA-Z!@#$%^&*()-+_/])/g, '<code>$1</code>');
    }
    return content;
  }

  // display: none; visibility: hidden; 的标签去除
  if (el.attributes?.style) {
    // 正则匹配style中是否包含 display: none; visibility: hidden;
    if (styleRegex.test(el.attributes.style)) {
      return '\n';
    }
  }


  // 处理不支持的标签
  if (!allowedTags.includes(tagName)) {
    // 将 h1-h6 转换为 b
    if (HTags.includes(el.name)) {
      return `<b>${el.childNodes.map(filterHtml).join(' ')}</b>`;
    }
    // style, script 标签去除
    if (['style', 'script', 'iframe', 'STYLE', 'SCRIPT', 'IFRAME'].includes(el.name)) {
      return '';
    }

    const children = el.childNodes;
    if (children.length) {
      return children.map(filterHtml).join(' ')
    }
    return '\n';
  }

  // 处理a标签
  if (tagName === 'A' || tagName === 'a') {
    const text = el.rawText.trim();
    if (text) {
      return `<a href="${el.getAttribute('href')}">${text}</a>`;
    }
    return ''
  }

  // 处理支持的标签子节点
  if (tagName === 'BR' || tagName === 'br') {
    return '\n';
  }
  return `<${tagName}>${el.childNodes.map(filterHtml).join(' ')}</${tagName}>`;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const body = await readRequestBody(request);
      if (body) {
        const res = await convertHtmlToTelegram2(body)
        return new Response(res);
      }
    }
    return new Response("OK");
  }
};
