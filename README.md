# DompetPintar - Aplikasi Pencatat Keuangan & Auto Budgeting Gaji

Aplikasi pengelola keuangan pribadi berbasis **HTML5, CSS3, JavaScript (LocalStorage)** dan **Capacitor Android**, sudah dilengkapi workflow **GitHub Actions** untuk langsung menghasilkan file `.apk` siap instal di HP Android secara otomatis.

## Fitur Utama
1. **Otomatis Bagi Budget Bulanan dari Gaji:**
   Saat Anda memasukkan nominal gaji, aplikasi langsung mengalikan dan membagi saldo yang bisa digunakan ke 5 pos anggaran:
   - **0.2 (20%)** Kebutuhan Pokok
   - **0.4 (40%)** Tagihan
   - **0.2 (20%)** Investasi
   - **0.1 (10%)** Dana Darurat
   - **0.1 (10%)** Shodaqoh
2. **Pelacakan Real-Time Per Pos:**
   Setiap pengeluaran langsung memotong jatah pos yang dipilih lengkap dengan indikator *progress bar* warna (Biru/Hijau = Aman, Kuning = Hampir Habis, Merah = Mendekati/Melebihi Limit).
3. **Multi-Bulan & Kustomisasi Rasio:**
   Bisa memilih bulan pencatatan, mengubah rasio pembagian kapan saja, serta ekspor laporan ke CSV (Excel) dan Backup/Restore JSON.

## Cara Membuat APK Otomatis via GitHub Actions
1. Ekstrak file `proyek.zip` ini.
2. Buat repository baru di akun **GitHub** Anda.
3. Upload seluruh isi folder proyek ini (termasuk folder `.github/workflows/build-apk.yml`) ke repository tersebut:
   ```bash
   git init
   git add .
   git commit -m "Initial commit aplikasi keuangan"
   git branch -M main
   git remote add origin https://github.com/USERNAME_ANDA/NAMA_REPO.git
   git push -u origin main
   ```
4. Buka tab **Actions** di repository GitHub Anda.
5. Workflow **Build Android APK** akan otomatis berjalan. Tunggu sekitar 2–3 menit hingga centang hijau.
6. Klik hasil workflow tersebut, gulir ke bagian bawah (**Artifacts**), lalu unduh **DompetPintar-Debug-APK**. Didalamnya terdapat file `app-debug.apk` yang siap di-instal di HP Android Anda!
