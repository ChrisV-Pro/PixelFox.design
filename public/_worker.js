const PRIMARY_HOST = "pixelfox.design";
const CONTACT_PATH = "/api/contact";
const MAX_BODY_BYTES = 32_000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TURNSTILE_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SERVICES = new Set([
  "Website design",
  "Website redesign",
  "Strategy",
  "Design",
  "Development",
  "Evolution",
  "Something else",
]);

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, ...extraHeaders },
  });
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function singleLine(value) {
  return text(value).replace(/[\r\n]+/g, " ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requestIdentifier(value) {
  const candidate = text(value);
  if (/^[a-zA-Z0-9-]{16,80}$/.test(candidate)) return candidate;
  return crypto.randomUUID();
}

async function parsePayload(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return { error: json({ ok: false, message: "Please submit the form from the PixelFox website." }, 415) };
  }

  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: json({ ok: false, message: "That message is too long to send." }, 413) };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { error: json({ ok: false, message: "That message is too long to send." }, 413) };
  }

  try {
    return { data: JSON.parse(raw) };
  } catch {
    return { error: json({ ok: false, message: "The form could not be read. Please refresh and try again." }, 400) };
  }
}

function validate(payload) {
  const data = {
    name: singleLine(payload.name),
    email: singleLine(payload.email).toLowerCase(),
    company: singleLine(payload.company),
    service: singleLine(payload.service),
    message: text(payload.message),
    consent: text(payload.consent),
    fax: text(payload.fax),
    turnstileToken: text(payload["cf-turnstile-response"]),
    requestId: requestIdentifier(payload.requestId),
  };

  if (data.name.length < 2 || data.name.length > 100) return { message: "Please enter your name." };
  if (!validEmail(data.email)) return { message: "Please enter a valid email address." };
  if (data.company.length > 120) return { message: "Please shorten the company name." };
  if (!SERVICES.has(data.service)) return { message: "Please choose a project type." };
  if (data.message.length < 10 || data.message.length > 5000) return { message: "Please add a little more detail about your project." };
  if (data.consent !== "yes") return { message: "Please confirm that PixelFox may use these details to respond." };

  return { data };
}

async function verifyTurnstile(request, env, data) {
  if (!env.TURNSTILE_SECRET_KEY) return { configured: false };
  if (!data.turnstileToken) return { configured: true, success: false };

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: data.turnstileToken,
    remoteip: request.headers.get("CF-Connecting-IP") || "",
    idempotency_key: data.requestId,
  });

  try {
    const response = await fetch(TURNSTILE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return { configured: true, success: false };

    const result = await response.json();
    const requestHost = new URL(request.url).hostname;
    return {
      configured: true,
      success: result.success === true && result.action === "contact" && result.hostname === requestHost,
    };
  } catch {
    return { configured: true, success: false };
  }
}

function emailContent(data) {
  const company = data.company || "Not specified";
  const subjectCompany = data.company ? ` at ${data.company}` : "";
  const subject = `PixelFox project inquiry from ${data.name}${subjectCompany}`;
  const plainText = [
    "PIXELFOX.DESIGN - PROJECT INQUIRY",
    "",
    `Name: ${data.name}`,
    `Reply email: ${data.email}`,
    `Company: ${company}`,
    `Interested in: ${data.service}`,
    "",
    "ABOUT THE PROJECT",
    data.message,
  ].join("\n");
  const htmlMessage = escapeHtml(data.message).replace(/\r?\n/g, "<br>");
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#191b1a;max-width:680px;margin:0 auto;padding:32px;">
      <p style="font-size:12px;letter-spacing:2px;color:#aa4214;margin:0 0 24px;">PIXELFOX.DESIGN / PROJECT INQUIRY</p>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:400;margin:0 0 28px;">A new website inquiry</h1>
      <p><strong>Name:</strong> ${escapeHtml(data.name)}</p>
      <p><strong>Reply email:</strong> ${escapeHtml(data.email)}</p>
      <p><strong>Company:</strong> ${escapeHtml(company)}</p>
      <p><strong>Interested in:</strong> ${escapeHtml(data.service)}</p>
      <hr style="border:0;border-top:1px solid #deddd7;margin:28px 0;">
      <p style="font-size:12px;letter-spacing:1.5px;color:#65665f;">ABOUT THE PROJECT</p>
      <p>${htmlMessage}</p>
    </div>`;

  return { subject, plainText, html };
}

async function handleContact(request, env) {
  if (!isSameOrigin(request)) {
    return json({ ok: false, message: "Please submit the form from the PixelFox website." }, 403);
  }

  const parsed = await parsePayload(request);
  if (parsed.error) return parsed.error;

  // Bots commonly fill this field; return success without delivering anything.
  if (text(parsed.data?.fax)) return json({ ok: true, message: "Your inquiry has been sent." });

  const validation = validate(parsed.data || {});
  if (!validation.data) return json({ ok: false, message: validation.message }, 400);

  if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY) {
    return json({ ok: false, message: "The contact form is temporarily unavailable. Please email support@pixelfox.design." }, 503);
  }

  const turnstile = await verifyTurnstile(request, env, validation.data);
  if (!turnstile.configured || !turnstile.success) {
    return json({ ok: false, message: "The security check could not be verified. Please try again." }, 400);
  }

  const content = emailContent(validation.data);
  const from = env.CONTACT_FROM_EMAIL || "PixelFox Website <inquiries@send.pixelfox.design>";
  const to = env.CONTACT_TO_EMAIL || "support@pixelfox.design";

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": validation.data.requestId,
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: validation.data.email,
        subject: content.subject,
        text: content.plainText,
        html: content.html,
      }),
    });

    if (!response.ok) {
      return json({ ok: false, message: "Your inquiry could not be sent. Your details are still here, so please try again." }, 502);
    }
  } catch {
    return json({ ok: false, message: "Your inquiry could not be sent. Check your connection and try again." }, 502);
  }

  return json({ ok: true, message: "Your inquiry has been sent. We will be in touch soon." });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === `www.${PRIMARY_HOST}`) {
      url.hostname = PRIMARY_HOST;
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === CONTACT_PATH) {
      if (request.method !== "POST") {
        return json({ ok: false, message: "Method not allowed." }, 405, { Allow: "POST" });
      }
      return handleContact(request, env);
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);

    if (response.ok && (request.method === "GET" || request.method === "HEAD")) {
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
        headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
      } else if (url.pathname === "/social-preview.svg") {
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
      } else {
        headers.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
