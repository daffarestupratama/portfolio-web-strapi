# portfolio-web-strapi

Backend CMS (Strapi v5 + PostgreSQL) untuk daffa.me, dijalankan via Docker Compose.
Frontend: portfolio-web-fe (Next.js, Cloudflare Workers).

## Struktur

- `app/` : Source Strapi (schema content-type di `app/src/api/*/content-types/*/schema.json`,
  komponen di `app/src/components/`, config di `app/config/`)
- `docker-compose.yml` : Untuk dua service, `strapi` (build dari ./app) + `strapi-db` (postgres:16-alpine)
- `.env.example` : Template environment. Salin ke `.env` dan isi (JANGAN commit `.env`)

## Alur kerja mengubah schema

1. Edit `app/src/api/.../schema.json` di lokal
2. Commit & push
3. Di VM: `git pull && docker compose up -d --build strapi && docker builder prune -af`
4. Verifikasi: `curl -sS -g -o /dev/null -w "%{http_code}\n" "http://localhost:1337/api/<plural>?populate=*"`

## Deploy ke VM baru

Lihat bagian "Deploy" di bawah, butuh: `.env` (dari backup aman),
dump DB (`*.sql`), dan arsip `uploads`.
