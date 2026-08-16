# Panduan Migrasi VM

Runbook untuk memindahkan backend Strapi ke VM baru. Simpan file ini di root repo `portfolio-web-strapi`.

## Arsitektur saat ini

| Komponen | Lokasi | Ikut migrasi? |
|---|---|---|
| Source code, schema, config | Repo GitHub ini | Otomatis lewat `git clone` |
| Media (gambar, file) | Cloudflare R2, bucket `portfolio-web-media` | **Tidak.** Sudah lepas dari VM |
| Database | PostgreSQL 16 dalam container Docker di VM | **Ya.** Perlu dump dan restore |
| Secret (`.env`) | Password manager | **Ya.** Salin manual |
| Reverse proxy + TLS | nginx + Certbot di VM | Dipasang ulang |
| DNS | Cloudflare (zona `daffa.me`) | Ubah A record |

Yang benar-benar perlu dipindahkan hanya **dump database** dan **file `.env`**. Selebihnya dibangun ulang dari repo.

## Yang harus disiapkan sebelum mulai

- IP publik VM baru
- Isi `.env` lama, lengkap (`APP_KEYS`, `JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_PASSWORD`, kredensial R2). **Nilainya harus sama persis**, kalau berubah sesi admin invalid dan database tak bisa dibuka
- Akses ke dashboard Cloudflare untuk mengubah DNS
- VM lama masih hidup. Jangan matikan sampai VM baru terverifikasi

---

## Fase 1: Siapkan VM baru

Di konsol penyedia: reset password user `ubuntu`, lalu buka port **22, 80, 443** di firewall. Jangan buka 1337 dan 5432.

```bash
ssh ubuntu@<IP_BARU>
```

Izin Docker dan update sistem:

```bash
sudo usermod -aG docker $USER
sudo apt update && sudo apt upgrade -y
sudo reboot
```

Masuk lagi setelah ~30 detik, lalu buat swap (RAM 2GB terlalu ketat untuk build Strapi):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
docker ps
```

`docker ps` harus jalan tanpa `sudo`.

---

## Fase 2: Dump database dari VM lama

Di **VM lama**:

```bash
docker exec strapi-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/db-$(date +%F).sql
ls -lh ~/db-*.sql
```

Pastikan ukurannya tidak nol. Unduh ke laptop, lalu kirim ke VM baru (dari terminal laptop, satu per satu, pakai path absolut):

```
scp ubuntu@<IP_LAMA>:/home/ubuntu/db-YYYY-MM-DD.sql .
scp db-YYYY-MM-DD.sql ubuntu@<IP_BARU>:/home/ubuntu/
```

Simpan salinannya di laptop sebagai cadangan independen.

---

## Fase 3: Pasang Strapi di VM baru

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/daffarestupratama/portfolio-web-strapi.git
sudo chown -R $USER:$USER portfolio-web-strapi
cd portfolio-web-strapi
```

Buat `.env` dengan heredoc (bukan nano, karena paste teks panjang ke editor sering merusak format):

```bash
cat > /opt/portfolio-web-strapi/.env << 'ENVEOF'
```

Tempel isi `.env` lama, tekan Enter, ketik `ENVEOF`, Enter. Lalu verifikasi:

```bash
chmod 600 .env
wc -c .env
grep -n '^ ' .env
```

Perintah terakhir tidak boleh mengeluarkan apa pun (spasi di awal baris = gejala paste rusak).

Restore database **sebelum** Strapi dijalankan, supaya Strapi tidak membuat skema kosong duluan:

```bash
docker compose up -d strapi-db
sleep 20
cat ~/db-YYYY-MM-DD.sql | docker exec -i strapi-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker exec strapi-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"' | head -20
```

Daftar tabel harus muncul. Baru bangun Strapi:

```bash
docker compose up -d --build strapi
docker logs -f strapi
```

Tunggu `Strapi started successfully`, Ctrl+C, lalu:

```bash
docker builder prune -af
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:1337/api/experiences
```

Harus `200`.

> Catatan: folder `uploads` **tidak perlu** dipindahkan. Media sudah di R2 dan URL-nya tersimpan absolut di database.

---

## Fase 4: nginx + vhost

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/cms.daffa.me
```

```nginx
server {
    listen 80;
    server_name cms.daffa.me;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:1337;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo nano /etc/nginx/sites-available/s.daffa.me
```

```nginx
server {
    listen 80;
    server_name s.daffa.me;

    location = / {
        return 404 "Short link required\n";
    }

    location / {
        rewrite ^/(.*)$ /api/s/$1 break;
        proxy_pass http://127.0.0.1:1337;
        proxy_http_version 1.1;
        proxy_set_header Host cms.daffa.me;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**Jangan ubah** baris `proxy_set_header Host cms.daffa.me;` pada vhost `s.` — itu yang membuat shortener bekerja.

```bash
sudo ln -sf /etc/nginx/sites-available/cms.daffa.me /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/s.daffa.me /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## Fase 5: Uji lewat IP sebelum menyentuh DNS

Ini membuktikan semuanya sehat sementara situs lama masih melayani trafik:

```bash
curl -sS -H "Host: cms.daffa.me" -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/experiences
curl -sS -H "Host: s.daffa.me" -i http://127.0.0.1/<SLUG> | head -5
```

Harus `200` dan `302`. **Jangan pindahkan DNS kalau salah satu gagal.**

---

## Fase 6: DNS dan sertifikat

Di Cloudflare, zona `daffa.me`: ubah A record `cms` dan `s` ke IP baru, **matikan proxy dulu** (awan abu-abu) agar Certbot bisa validasi.

Tunggu propagasi (`nslookup cms.daffa.me`), lalu:

```bash
sudo certbot --nginx -d cms.daffa.me -d s.daffa.me
sudo nginx -t && sudo systemctl reload nginx
```

Nyalakan kembali proxy (awan oranye) untuk kedua record. Pastikan SSL/TLS mode **Full (strict)**.

---

## Fase 7: Verifikasi

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://cms.daffa.me/api/experiences
curl -sS -g -o /dev/null -w "%{http_code}\n" "https://cms.daffa.me/api/skills?populate[logo]=true"
curl -sS -I https://s.daffa.me/<SLUG> | head -5
```

Lalu manual:

- Login ke `https://cms.daffa.me/admin` dengan akun lama (bukti `APP_KEYS`/`JWT_SECRET` benar)
- Media Library: thumbnail tampil (file dilayani R2, bukan VM)
- Unggah satu gambar uji, pastikan URL-nya `media.daffarestupratama.com` dan objeknya bertambah di dashboard R2
- Buka `https://daffarestupratama.com`, pastikan data dan gambar normal
- Kirim satu pesan guestbook (menguji API token, tersimpan di database)
- Publish satu perubahan di CMS, pastikan webhook revalidasi tetap jalan

Frontend tidak perlu diubah: `NEXT_PUBLIC_STRAPI_URL` tetap `https://cms.daffa.me`.

---

## Fase 8: Tutup VM lama

Baru setelah Fase 7 seluruhnya hijau.

- Matikan auto-renew instance
- Hapus **snapshot** (sering terlewat dan tetap menagih), custom image, dan cloud disk yang tidak terpakai
- Cek tidak ada instance lain di region berbeda
- Lepas metode pembayaran kalau akun tidak dipakai lagi

Simpan dump database dan `.env` di laptop meski migrasi sudah sukses.

---

## Alur kerja rutin (bukan migrasi)

Mengubah schema atau konfigurasi Strapi:

1. Edit di lokal (`app/src/api/.../schema.json`)
2. Commit dan push
3. Di VM: `cd /opt/portfolio-web-strapi && git pull && docker compose up -d --build strapi && docker builder prune -af`
4. Verifikasi: `curl -sS -g -o /dev/null -w "%{http_code}\n" "https://cms.daffa.me/api/<plural>?populate=*"`

Selalu jalankan `docker builder prune -af` setelah rebuild, karena cache build pernah membuat disk penuh dan menggagalkan build.

## Jebakan yang pernah terjadi

- **Content type baru lewat file** memicu error TypeScript `not assignable to parameter of type 'ContentType'`. Solusinya cast `as any` pada `factories.create*` di controller, route, dan service. Tidak berlaku untuk sekadar menambah field.
- **Perintah `curl` dengan tanda kurung siku** butuh flag `-g`, kalau tidak curl menganggapnya sebagai rentang dan menolak.
- **`awscli` tidak ada di repositori Ubuntu 24.04.** Hanya dibutuhkan untuk penyalinan massal sekali jalan, dan sudah tidak diperlukan lagi karena media ada di R2.
- **Firewall cloud** sering hanya membuka 22 dan 80 secara default. Port 443 harus ditambahkan manual, kalau tidak akan muncul error 522 di Cloudflare.
