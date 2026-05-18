# Kito Mini Photo Sheet

React/Vite website for creating passport/stamp photo sheets.

## Features

- Upload/take photo
- Passport crop: 280 x 360 px
- Stamp crop: 140 x 185 px
- Auto mild enhancement during export
- Generate 1200 x 800 px sheet
- Passport sheet: 4 x 2 = 8 photos
- Stamp sheet: 8 x 4 = 32 photos
- Border around every photo
- Download single image and final sheet

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:5173
```

## Build

```bash
npm run build
```

## GitHub Pages

This project includes `.github/workflows/deploy.yml`.

After pushing to GitHub, go to:

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```
