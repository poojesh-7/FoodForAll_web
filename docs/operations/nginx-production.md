# Production Nginx Reverse Proxy

This deployment runs Nginx as the only public edge container. Frontend, API,
workers, PostgreSQL, and Redis stay on the private `app_internal` Docker
network; only Nginx joins both `edge` and `app_internal`.

## Route Map

- `/` proxies to the Next.js frontend (`frontend:3000`).
- `/_next/static/` proxies to the frontend with immutable browser caching.
- `/leaflet/` proxies to the frontend with static marker asset caching.
- `/api/` proxies to the Express API (`api:5000`) and is never cached.
- `/api/v1/auth/` has an extra edge rate limit before the backend limiter.
- `/api/v1/payments/webhook` has webhook-specific rate/body handling.
- `/socket.io/` proxies Socket.IO with websocket upgrade headers and buffering disabled.
- `/admin/queues/` proxies Bull Board through the backend auth/admin middleware.
- `/health` and `/health/*` proxy backend liveness/readiness checks.
- `/nginx-health` returns `204` from Nginx for container health checks.
- `/.well-known/acme-challenge/` serves ACME HTTP-01 challenges before HTTPS redirect.

## Required Production Environment

Use the same public HTTPS origin for the browser app and proxied API unless you
intentionally deploy split domains:

```env
NEXT_PUBLIC_API_URL=https://app.example.com/api/v1
FRONTEND_URL=https://app.example.com
FRONTEND_ORIGINS=https://app.example.com
TRUST_PROXY_HOPS=1
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
NEXT_PUBLIC_CASHFREE_MODE=production
```

`TRUST_PROXY_HOPS=1` matches the compose topology: public client -> Nginx ->
Express. Nginx overwrites `X-Forwarded-For` with the trusted client address so
Express rate limiting and logs are not based on spoofed inbound headers.

## Certificates

Nginx expects:

```text
infra/nginx/certs/fullchain.pem
infra/nginx/certs/privkey.pem
```

For Let's Encrypt HTTP-01, mount the ACME webroot already configured in compose:

```text
infra/nginx/acme/.well-known/acme-challenge/
```

One common flow:

1. Temporarily start Nginx with a bootstrap certificate, or run a standalone
   certbot issuance before the first HTTPS startup.
2. Issue/renew with webroot path `infra/nginx/acme`.
3. Place or symlink the live cert files to `infra/nginx/certs/fullchain.pem`
   and `infra/nginx/certs/privkey.pem`.
4. Reload Nginx with `docker compose -f docker-compose.production.yml exec nginx nginx -s reload`.

With Cloudflare, use SSL/TLS mode `Full (strict)`, keep WebSockets enabled, and
keep the Cloudflare `set_real_ip_from` ranges in `infra/nginx/default.conf`
current. If Nginx sits behind a different load balancer, replace those trusted
ranges with that load balancer's private source ranges and the correct
`real_ip_header`.

## Security Headers And CSP

Nginx hides upstream security headers and emits one edge-owned set to avoid
conflicting duplicates with Helmet:

- HSTS preload-ready header
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`
- CSP for the frontend, Socket.IO, OpenStreetMap tiles, Cloudinary HTTPS images,
  and Cashfree checkout/script/frame flows

The CSP keeps scripts self-hosted except for Cashfree and the inline scripts
required by the current Next.js runtime. Do not add broad third-party script
sources without a matching product need.

## Websocket Safety

`/socket.io/` uses HTTP/1.1, forwards `Upgrade` and `Connection`, disables
proxy buffering, and uses one-hour read/send timeouts. This preserves realtime
notifications and Socket.IO reconnect behavior through Nginx and Cloudflare.

## Webhook Safety

`/api/v1/payments/webhook` forwards the raw request body to Express unchanged.
Nginx does not rewrite payload bytes or strip Cashfree signature headers. The
edge body limit is `1m`, matching the backend raw parser limit.

## Validation

After deployment:

```bash
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.production.yml up -d postgres redis migrate api worker frontend nginx
curl -I http://app.example.com/nginx-health
curl -I https://app.example.com/nginx-health
curl -I https://app.example.com/health
curl -I https://app.example.com/api/v1/food
```

For static caching, load the app once and check one concrete
`/_next/static/...` asset URL from the rendered HTML or browser network panel.

Websocket smoke test:

```bash
curl -i \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  "https://app.example.com/socket.io/?EIO=4&transport=websocket"
```

Expected result is a websocket handshake response from Socket.IO, not a 301,
400 from Nginx, or connection close during upgrade.

Cashfree webhook smoke test should use a gateway replay or a signed test event;
do not use unsigned production payloads to judge webhook health because the
backend correctly rejects invalid signatures.
