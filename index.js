
async function readEmail(raw) {
  const PostalMime = require("postal-mime");
  const parser = new PostalMime.default();
  const parsedEmail = await parser.parse(raw).catch((err) => ({
    message: err.message || "Error parsing email",
  }));

  const html = parsedEmail?.html;
  const from = `${parsedEmail?.from?.name} <${parsedEmail?.from?.address}>`;
  const to = `${parsedEmail?.to?.[0]?.name} <${parsedEmail?.to?.[0]?.address}>`;
  const message = parsedEmail?.text?.trim();
  const subject = parsedEmail?.subject;
  const messageId = parsedEmail?.messageId?.replace(/@.*$/, "").replace(/^</, "");
  return { from, to, subject, message, messageId, html, parsedEmail };
}

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

export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const body = await readRequestBody(request);
      if (body) {
        const res = await readEmail(body)
        const data = JSON.stringify(res)

        return new Response(data, {
          headers: { "content-type": "application/json" },
        });
      }

    }
    return new Response("OK");
  }
};
