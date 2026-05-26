#  GauGAN Studio — Satellite Map Generator

> Draw a terrain map. Get a realistic satellite image.

GauGAN Studio is a web application that turns hand-drawn color-coded terrain maps into photorealistic satellite-style imagery using AI. Paint your landscape with terrain labels (grass, water, forest, mountains, etc.), hit **Generate**, and the AI produces a 1024×1024 top-down satellite image of your scene.

**Student:** Taha Mohamed | ID: 20222588 | NEU 2025–2026

---

## Features

-  **9 terrain types** — Grass, Water, Mountain, Snow, Rock, Tree, Road, Building, Sand
-  **7 drawing tools** — Brush, Eraser, Fill, Rectangle, Circle, Triangle, Line
-  **Undo / Redo** — Ctrl+Z / Ctrl+Y
-  **Adjustable brush size & opacity**
-  **AI image generation** powered by Flux.1 Canny Pro (via Replicate)
-  **Terrain coverage badges** — see the % breakdown of your map
-  **Prompt viewer** — inspect the exact prompt sent to the AI
-  **Generation history** — last 8 outputs stored as thumbnails
-  **Save PNG** — download the generated satellite image
-  **Output modes** — Full image / White outside canvas / Transparent outside canvas
-  **Fullscreen lightbox** on image click

---

##  Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Python + FastAPI |
| AI Model | Flux.1 Canny Pro (Replicate API) |
| Image Processing | Pillow (PIL) + NumPy |
| API Key Management | python-dotenv |

---

##  Project Structure

```
gaugan-app/
├── frontend/
│   ├── src/
│   │   ├── App.jsx          ← Main UI (React)
│   │   └── main.jsx         ← Entry point
│   ├── index.html           ← Vite root
│   ├── vite.config.js       ← Proxy /generate → localhost:8000
│   └── package.json
├── backend/
│   ├── main.py              ← FastAPI server + AI pipeline
│   ├── requirements.txt
│   ├── .env                 ← Your API key goes here (not committed)
│   ├── .env.example
│   ├── .gitignore
│   └── README.md
├── QUICK_START.bat
└── README.md                ← You are here
```

---

##  Setup & Installation

### Prerequisites
- Node.js 18+ (Node 20 recommended)
- Python 3.10+
- A [Replicate](https://replicate.com) account and API key

---

### 1. Clone the repository

```bash
git clone https://github.com/your-username/gaugan-studio.git
cd gaugan-studio
```

### 2. Configure the API key

```bash
cd backend
cp .env.example .env
```

Open `.env` and add your Replicate API key:

```
REPLICATE_API_KEY=r8_your_key_here
```

### 3. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 4. Start the frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Then open **http://localhost:3000** in your browser.

---

##  Terrain Color Reference

| Terrain | Color | Hex | RGB |
|---|---|---|---|
| Grass | 🟩 | `#3a8c3f` | (58, 140, 63) |
| Water | 🟦 | `#2e86c1` | (46, 134, 193) |
| Mountain | ⬜ | `#6c6c6c` | (108, 108, 108) |
| Snow | 🔲 | `#c8d8e8` | (200, 216, 232) |
| Rock | 🪨 | `#9e9e9e` | (158, 158, 158) |
| Tree | 🌲 | `#1b5e20` | (27, 94, 32) |
| Road | 🛣️ | `#b0bec5` | (176, 190, 197) |
| Building | 🟫 | `#c2824a` | (194, 130, 74) |
| Sand | 🏜️ | `#d4a96a` | (212, 169, 106) |

---

##  How the AI Pipeline Works

```
User draws on canvas
        ↓
Frontend sends PNG to FastAPI backend (/generate)
        ↓
Backend scans every pixel → nearest-neighbor RGB matching
        ↓
Builds spatial terrain description (3×3 zone grid)
        ↓
Constructs satellite-style prompt
(Google Maps, Sentinel-2, nadir, 500km altitude, etc.)
        ↓
Extracts Canny edges from the drawing (PIL FIND_EDGES)
        ↓
Sends prompt + edge image to Flux.1 Canny Pro on Replicate
        ↓
Polls for result every 2 seconds (max 120s)
        ↓
Returns 1024×1024 satellite image + prompt + terrain coverage %
```

---

##  Drawing Tools

| Tool | Shortcut |
|---|---|
| Brush | `B` |
| Eraser | `E` |
| Fill (Flood) | `F` |
| Rectangle | `R` |
| Circle | `C` |
| Triangle | `T` |
| Line | `L` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` |

---

##  Security Notes

- Your `REPLICATE_API_KEY` is stored in `backend/.env` which is listed in `.gitignore`
- **Never commit your `.env` file** — use `.env.example` as a template instead
- The frontend never sees or handles the API key directly

---

##  License

This project was developed as an academic capstone project at NEU (2025–2026).  
For educational and portfolio use only.
