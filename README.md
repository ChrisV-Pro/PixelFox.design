# PixelFox.design

An Astro landing page for PixelFox.design, prepared for Cloudflare Pages deployment.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Contact form

The production contact form is handled by the Cloudflare Pages advanced-mode worker in `public/_worker.js`. It sends inquiries through Resend without opening the visitor's email application.

Configure these values for both Production and Preview in Cloudflare Pages:

- Secret: `RESEND_API_KEY`
- Secret: `TURNSTILE_SECRET_KEY`
- Variable: `PUBLIC_TURNSTILE_SITE_KEY`
- Variable: `CONTACT_FROM_EMAIL` = `PixelFox Website <inquiries@send.pixelfox.design>`
- Variable: `CONTACT_TO_EMAIL` = `support@pixelfox.design`

Verify `send.pixelfox.design` in Resend before enabling the form. Keeping mail delivery on this subdomain avoids changing the Namecheap Private Email records used by the root domain.

Run the endpoint tests with:

```bash
npm run test:contact
```
