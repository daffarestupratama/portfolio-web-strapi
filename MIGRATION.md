# Panduan Migrasi VM

Runbook untuk migrasi backend Strapi ke VM baru.

## Arsitektur saat ini

| Komponen | Lokasi | Ikut migrasi? |
|---|---|---|
| Source code, schema, config | Repo GitHub ini | Otomatis lewat `git clone` |
| Media (gambar, file) | Cloudflare R2, bucket `portfolio-web-media` | **Tidak.** Sudah terlepas dari VM |
| Database | PostgreSQL 16 dalam container Docker di VM | **Ya.** Perlu dump dan restore |
| Secret (`.env`) | Password manager | **Ya.** Salin manual |
| Reverse proxy + TLS | nginx + Certbot di VM | Dipasang atau ditambahkan |
| DNS | Cloudflare (zona `daffa.me`) | Ubah A record `cms` dan `s` |

Yang benar-benar dipindahkan hanya **dump database** dan **isi `.env`**.

**VM saat ini dipakai bersama Odoo** (Azure, Central India, 4GB RAM).

## Sebelum mulai

- IP publik VM baru. Di Azure, pastikan Public IP bertipe **Static**, bukan Dynamic, karena Dynamic berubah setiap VM dimatikan dan akan merusak DNS.
- Isi `.env` secara lengkap dan persis seperti sebelumnya. Kalau `APP_KEYS`, `JWT_SECRET`, `ENCRYPTION_KEY`, atau `DATABASE_PASSWORD` berubah, sesi admin invalid dan database tak terbuka.
- Akses dashboard Cloudflare.
- VM lama pastikan masih hidup. Jangan matikan sampai VM baru terverifikasi.

### Mencegah SSH putus saat build

Build memakan waktu lama dan sebagian langkahnya diam tanpa output, sehingga load balancer cloud bisa memutus ssh connection yang terlihat menganggur. Di laptop, buat `~/.ssh/config` (atau `C:\Users\<user>\.ssh\config`):

```
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 10
```

Untuk proses panjang, jalankan di dalam `tmux` supaya tetap berjalan meski koneksi putus:

```bash
sudo apt install -y tmux
tmux new -s build
# ... jalankan perintahnya ...
# putus? masuk lagi lalu: tmux attach -t build
```

---

## Fase 1: Siapkan VM

**VM baru (khusus Strapi):**

Buka port **22, 80, 443** di firewall penyedia. Di Azure lewat **Network Security Group**. Jangan buka 1337 dan 5432.

```bash
ssh ubuntu@<IP_BARU>
sudo usermod -aG docker $USER
sudo apt update && sudo apt upgrade -y
sudo reboot
```

Masuk lagi, buat swap:

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

**VM yang sudah dipakai aplikasi lain:** lewati langkah di atas, periksa kondisinya:

```bash
free -h
swapon --show
df -h /
docker ps
sudo ss -tlnp | grep -E ':(1337|5432|80|443)'
docker volume ls
```

Yang dicari:

- Swap kosong, buat seperti di atas.
- Port 5432 sudah **terikat ke host** (ada tanda `->` di `docker ps`), ubah pemetaan Strapi jadi `127.0.0.1:5433:5432` di `docker-compose.yml`. Hanya sisi host yang berubah; Strapi tetap menghubungi `strapi-db:5432` lewat jaringan internal, jadi `.env` tidak disentuh. Port yang hanya tertulis `5432/tcp` tanpa panah tidak bentrok.
- Container atau volume bernama `strapi`, `strapi-db`, `strapi-db-data`, berarti bentrok dan perlu ditangani.

---

## Fase 2: Dump database dari VM lama

Di **VM lama**:

```bash
docker exec strapi-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/db-$(date +%F).sql
ls -lh ~/db-*.sql
```

Pastikan ukurannya tidak nol. Unduh ke laptop, lalu **kirim ke VM baru**. Dua langkah, jangan lewatkan yang kedua:

```
scp ubuntu@<IP_LAMA>:/home/ubuntu/db-YYYY-MM-DD.sql .
scp db-YYYY-MM-DD.sql ubuntu@<IP_BARU>:/home/ubuntu/
```

Kalau VM memakai SSH key, tambahkan `-i <path-ke-key>`. Simpan salinannya di laptop sebagai cadangan.

---

## Fase 3: Pasang Strapi

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/daffarestupratama/portfolio-web-strapi.git
sudo chown -R $USER:$USER portfolio-web-strapi
cd portfolio-web-strapi
```

Buat `.env` dengan heredoc, **bukan nano**, karena paste teks panjang ke editor sering merusak format:

```bash
cat > /opt/portfolio-web-strapi/.env << 'ENVEOF'
```

Tempel isi `.env` lama, Enter, ketik `ENVEOF`, Enter. Verifikasi:

```bash
chmod 600 .env
wc -c .env
grep -n '^ ' .env
```

Perintah terakhir tidak boleh mengeluarkan apa pun.

### Batas memori (wajib di VM bersama)

Tanpa ini, satu aplikasi yang bocor memori bisa mencekik yang lain. Di `docker-compose.yml`, tambahkan pada service `strapi`:

```yaml
    mem_limit: 1g
```

dan pada `strapi-db`:

```yaml
    mem_limit: 384m
```

### Restore database sebelum Strapi jalan

Urutannya penting, supaya Strapi tidak membuat skema kosong duluan:

```bash
docker compose up -d strapi-db
sleep 20
cat ~/db-YYYY-MM-DD.sql | docker exec -i strapi-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker exec strapi-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"' | head -20
```

Daftar tabel harus muncul.

### Build, dan di VM bersama matikan tetangga dulu

Build Strapi menyerap 1 sampai 1,5GB dalam lonjakan singkat. Kalau memori habis, kernel memilih korbannya sendiri, dan yang mati bisa aplikasi lain. Matikan sementara, sekitar sepuluh menit:

```bash
cd ~/odoo && docker compose stop
free -h
```

Perhatikan kolom **available**, bukan `free`. Linux menahan buff/cache dan melepasnya saat dibutuhkan, jadi `free` yang kecil itu normal.

```bash
cd /opt/portfolio-web-strapi
docker compose up -d --build strapi
docker logs -f strapi
```

Tunggu `Strapi started successfully`, Ctrl+C, lalu:

```bash
docker builder prune -af
cd ~/odoo && docker compose start
free -h
docker ps
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:1337/api/experiences
```

Semua container harus jalan dan curl harus `200`.

> Folder `uploads` **tidak** perlu dipindahkan. Media ada di R2 dan URL-nya tersimpan absolut di database.

---

## Fase 4: nginx

**VM baru:** pasang dulu.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

**VM yang sudah punya nginx:** jangan pasang ulang dan jangan sentuh vhost aplikasi lain. Cukup tambahkan dua file baru, dan **jangan hapus `sites-enabled/default`** karena mungkin sudah ditangani saat setup sebelumnya.

```bash
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

**Jangan ubah** `proxy_set_header Host cms.daffa.me;` pada vhost `s.` karena itu yang membuat shortener bekerja.

```bash
sudo ln -sf /etc/nginx/sites-available/cms.daffa.me /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/s.daffa.me /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Kalau `nginx -t` gagal, **jangan reload**, karena itu bisa menjatuhkan aplikasi lain di VM yang sama.

---

## Fase 5: Uji lewat IP sebelum menyentuh DNS

Membuktikan semuanya sehat sementara situs lama masih melayani trafik:

```bash
curl -sS -H "Host: cms.daffa.me" -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/experiences
curl -sS -H "Host: s.daffa.me" -i http://127.0.0.1/<SLUG> | head -5
curl -sS -H "Host: odoo.daffa.me" -o /dev/null -w "%{http_code}\n" http://127.0.0.1/
```

Harus `200`, `302`, dan respons normal aplikasi lain (Odoo mengembalikan `303`, redirect ke login). Yang ketiga memastikan kamu tidak merusak yang sudah jalan. **Jangan pindahkan DNS kalau ada yang gagal.**

---

## Fase 6: DNS dan sertifikat

Di Cloudflare, zona `daffa.me`: ubah A record `cms` dan `s` ke IP baru, **matikan proxy dulu** (awan abu-abu) agar Certbot bisa validasi. Jangan sentuh record aplikasi lain.

Tunggu propagasi (`nslookup cms.daffa.me`), lalu:

```bash
sudo certbot --nginx -d cms.daffa.me -d s.daffa.me
sudo nginx -t && sudo systemctl reload nginx
```

Certbot menambahkan sertifikat baru tanpa mengganggu yang sudah ada. Nyalakan kembali proxy untuk `cms` dan `s`, pastikan SSL/TLS mode **Full (strict)**.

---

## Fase 7: Verifikasi

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://cms.daffa.me/api/experiences
curl -sS -g -o /dev/null -w "%{http_code}\n" "https://cms.daffa.me/api/skills?populate[logo]=true"
curl -sS -I https://s.daffa.me/<SLUG> | head -3
curl -sS -o /dev/null -w "%{http_code}\n" https://odoo.daffa.me
free -h
```

Lalu manual:

- Login ke `https://cms.daffa.me/admin` dengan akun lama, bukti secret benar
- Media Library: thumbnail tampil, dilayani R2
- Unggah satu gambar uji, cek URL-nya `media.daffarestupratama.com` dan objeknya bertambah di R2
- Buka `https://daffarestupratama.com`, data dan gambar normal
- Kirim satu pesan guestbook, menguji API token yang tersimpan di database
- Publish satu perubahan di CMS, pastikan webhook revalidasi jalan
- Aplikasi lain di VM masih normal

Perhatikan `free -h`: kalau available tersisa sangat tipis dengan semua berjalan, turunkan `mem_limit` atau pertimbangkan memindahkan Postgres ke layanan terkelola.

Frontend tidak perlu diubah: `NEXT_PUBLIC_STRAPI_URL` tetap `https://cms.daffa.me`.

---

## Fase 8: Tutup VM lama

Baru setelah Fase 7 seluruhnya hijau.

- Matikan auto-renew
- Hapus **snapshot** (sering terlewat dan tetap menagih), custom image, cloud disk menganggur
- Cek tidak ada instance lain di region berbeda
- Lepas metode pembayaran kalau akun tidak dipakai lagi

Simpan dump database dan `.env` di laptop meski migrasi sukses.

---

## Alur kerja rutin

Mengubah schema atau konfigurasi Strapi:

1. Edit di lokal (`app/src/api/.../schema.json`)
2. Commit dan push
3. Di VM: `cd /opt/portfolio-web-strapi && git pull && docker compose up -d --build strapi && docker builder prune -af`
4. Verifikasi: `curl -sS -g -o /dev/null -w "%{http_code}\n" "https://cms.daffa.me/api/<plural>?populate=*"`

Di VM bersama, **matikan tetangga dulu** sebelum rebuild, sama seperti Fase 3. Selalu jalankan `docker builder prune -af` setelahnya; cache build pernah membuat disk penuh dan menggagalkan build.

## Jebakan yang pernah terjadi

- **SSH putus saat build.** Langkah `chown -R node:node /opt/app` berjalan beberapa menit tanpa output, dan koneksi yang terlihat menganggur diputus load balancer. Pakai `ServerAliveInterval` dan `tmux`.
- **`free` terlihat kecil padahal memori cukup.** Baca kolom **available**, bukan `free`.
- **Lupa mengirim dump ke VM baru.** Mengunduh ke laptop saja tidak cukup, ada dua langkah `scp`.
- **Content type baru lewat file** memicu error TypeScript `not assignable to parameter of type 'ContentType'`. Solusinya cast `as any` pada `factories.create*` di controller, route, dan service. Tidak berlaku untuk sekadar menambah field.
- **`curl` dengan tanda kurung siku** butuh flag `-g`, kalau tidak curl menganggapnya rentang dan menolak.
- **`awscli` tidak ada di repositori Ubuntu 24.04.** Sudah tidak diperlukan karena media ada di R2.
- **Firewall cloud** sering hanya membuka 22 dan 80 secara bawaan. Port 443 harus ditambahkan manual, kalau tidak muncul error 522 di Cloudflare.
- **Public IP Dynamic di Azure** berubah setiap VM dimatikan. Set ke Static.
- **Port 5432 di `docker ps`**: `127.0.0.1:5432->5432/tcp` berarti terikat ke host dan bisa bentrok; `5432/tcp` saja hanya terekspos internal dan aman.
