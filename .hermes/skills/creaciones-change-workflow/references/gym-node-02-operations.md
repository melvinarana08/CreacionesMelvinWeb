# gym-node-02 operations (Creaciones Melvin)

## Production
- URL: `http://192.168.1.134:3002/`
- Health: `/api/health`
- Server files: `/home/operator1/stacks/creaciones-melvin`
- Container: `creaciones-melvin-sales-1`

## Access
- Use Tailscale SSH: `ssh root@100.97.20.79`
- Direct `admin@192.168.1.134` SSH is NOT authorized.
- First-time host key needs `ssh-keyscan` / accept prompt.
- Tailscale check approval: `https://login.tailscale.com/a/<code>` from preview.

## Rollback
- Stack has `.env`, `data/`, and `rollback.sh`.
- If a deployment is bad, revert via `rollback.sh` from `/home/operator1/stacks/creaciones-melvin`.

## PWA cache discipline
- `public/sw.js` defines `CACHE` name.
- On frontend change, bump `CACHE` or clients stay on old `app.js` due to cache-first assets.
