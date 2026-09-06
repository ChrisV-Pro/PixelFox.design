const PRIMARY_HOST = "pixelfox.design";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === `www.${PRIMARY_HOST}`) {
      url.hostname = PRIMARY_HOST;
      return Response.redirect(url.toString(), 301);
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
