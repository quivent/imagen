# Local artwork ingress

The artwork domain serves the live Vite studio on this Mac through the staging
HTTPS gateway. It does not publish the frontend to Vercel. The gateway's Caddy
route targets loopback port 48630; SSH forwards that port to this Mac's loopback
Vite port 48624. Caddy carries the Vite hot-reload WebSocket as well as HTTP.
The established API backend remains separate from frontend hosting.

```sh
python3 -B tools/artwork/ingress/manage.py start
python3 -B tools/artwork/ingress/manage.py status
python3 -B tools/artwork/ingress/manage.py stop
```

`start` loads the user launchd service `giving.kinship.artwork-ingress`, which
restarts SSH after connection loss and survives the originating terminal.
Run it after a new login. Its plist and logs live in ignored `.runtime/`.
SSH uses the existing login identity and known-host entry, checks the gateway's
host key, and refuses a conflicting remote port. There are no credentials in
this directory. Stop any temporary tunnel using gateway port 48630 before
starting the managed service. The public route depends on this Mac staying awake
and connected, its Vite service, the tunnel and the gateway remaining available.
`status` reports a process, not verified public reachability; check HTTPS too.

The gateway is `oscillihue@88.216.68.234`. Its front TLS routing sends this domain
to Caddy, whose route is managed through Gemstone domains. DNS and TLS evidence
is recorded in `.tracker/notes/artwork-domain-remap.md`.
