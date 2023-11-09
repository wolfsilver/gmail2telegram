import { parse } from 'node-html-parser';

// https://core.telegram.org/bots/api#html-style
const allowedTags = ['B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'A', 'CODE', 'PRE', 'TG-SPOILER', 'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'a', 'code', 'pre', 'tg-spoiler'];
const HTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TH', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th'];
const inline_tags = ['A', 'SPAN']
const INLINE_TAGS = ['A', 'SPAN', 'UL', 'OL', 'TR', 'DL', 'DT', 'TABLE', 'THEAD', 'TBODY', 'TFOOT'];
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
async function convertHtmlToTelegram(html) {
  length = 0;
  contentLength = 0;
  // 删除doctype
  html = html.replace(/^\s*<!DOCTYPE.*?>/i, '');
  const root = parse(html, {
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

  let body = root.querySelector('body');
  if (!body) {
    body = root.childNodes;
  } else {
    body = [body];
  }
  let txt = body.map(item => filterHtml(item)).join(' ').trim();
  txt = txt.replace(/(\n\s*){2,}/g, '\n\n').trim();
  return txt;
}


function filterHtml(el) {
  const tagName = el.tagName;
  if ((length > MAIL_MAX_LINES && (el.nodeType !== 3 || !inline_tags.includes(tagName))) || contentLength > MAIL_LENGTH) {
    return '';
  }
  textRegex.lastIndex = 0;
  styleRegex.lastIndex = 0;
  // 文本节点
  if (el.nodeType === 3) {
    // 将包含连续6位数字的文本使用code标签包裹
    let content = el.trimmedText;
    if (!content.trim()) {
      return '';
    }
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
      return tagName === 'SPAN' ? '' : '\n';
    }
  }

  if (tagName === 'BR' || tagName === 'br') {
    return '\n';
  }

  // 处理不支持的标签
  if (!allowedTags.includes(tagName)) {
    // 将 h1-h6 转换为 b
    if (HTags.includes(el.name)) {
      return `<b>${el.childNodes.map(item => filterHtml(item)).join(' ')}</b>`;
    }
    // style, script 标签去除
    if (['style', 'script', 'iframe', 'STYLE', 'SCRIPT', 'IFRAME'].includes(el.name)) {
      return '';
    }
    let prefix = INLINE_TAGS.includes(tagName) ? '' : PREFIX.includes('\n') ? '' : `\n`;
    if (tagName === 'LI' || tagName === 'li') {
      prefix += `  •  `;
    }

    const children = el.childNodes;
    if (children.length) {
      return prefix + children.map(item => filterHtml(item)).join('');
    }
    return '\n';
  }

  // 处理a标签
  if (tagName === 'A' || tagName === 'a') {
    const text = el.text.trim();
    if (text) {
      return `<a href="${el.getAttribute('href')}">${text}</a>`;
    }
    return ''
  }
  // span 标签 不包含class = tg-spoiler时，转换为普通文本
  if (tagName === 'SPAN' || tagName === 'span') {
    if (!el.classNames?.includes('tg-spoiler')) {
      return el.childNodes.map(item => filterHtml(item)).join('');
    }
  }

  // 处理支持的标签子节点
  return `<${tagName}>${el.childNodes.map(item => filterHtml(item)).join(' ')}</${tagName}>`;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const body = await readRequestBody(request);
      if (body) {
        const res = await convertHtmlToTelegram(body)
        return new Response(res);
      }
    }
    return new Response("OK");
  }
};
