# tracelayer.com infrastructure notes

- **Site**: this repo is served by GitHub Pages (branch `master`, `CNAME` → tracelayer.com). Push to `master` to deploy.
- **Waitlist API**: `waitlist.mjs` (zero-dependency Node) runs on the Hetzner VPS as pm2 process `tracelayer-waitlist`, listening on `127.0.0.1:4890`, data in `/var/lib/tracelayer-waitlist/waitlist.json`. Deployed copy: `/opt/tracelayer-waitlist/waitlist.mjs`.
- **Caddy**: `http://api.tracelayer.com { reverse_proxy 127.0.0.1:4890 }` in `/etc/caddy/Caddyfile` — the VPS firewall only admits Cloudflare IPs on port 80, so the API is reachable exclusively through a **Cloudflare-proxied** DNS record.
- **DNS required**: tracelayer.com zone on Cloudflare with:
  - apex + `www` → GitHub Pages (A 185.199.108–111.153 / CNAME finesseay.github.io), DNS-only is fine
  - `api` → A `89.167.76.77`, **proxied (orange cloud)**
- The site degrades gracefully while `api.tracelayer.com` is unreachable: joins are stored locally in the visitor's browser as provisional numbers and re-sync automatically on their next visit after the API is live.
