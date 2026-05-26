# GauGAN Studio — Backend 🛰️

FastAPI server that receives drawing canvas images, analyzes terrain colors,
builds a spatial prompt, and calls Pollinations.ai to generate satellite imagery.

---

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --port 8000
```

Server runs at → http://localhost:8000  
Interactive API docs → http://localhost:8000/docs

---

## Dependencies

```
fastapi          — web framework
uvicorn          — ASGI server
python-multipart — file upload support
Pillow           — image processing
numpy            — pixel color analysis
httpx            — async HTTP client (calls Pollinations API)
```

> No PyTorch. No GPU. No model downloads.
> Generation is handled by Pollinations.ai — free, no API key required.

---

## How the Backend Works

### 1 — Terrain Detection (`analyze_drawing`)

Scans every pixel of the uploaded drawing.  
Matches each pixel to the nearest terrain color using **Euclidean RGB distance**.

Key fix: uses nearest-neighbor matching — each pixel goes to the **closest** color,
not just the first one within tolerance. This prevents Grass and Tree (similar greens)
from bleeding into each other.

```python
# For each pixel (r, g, b):
# → find the terrain with minimum Euclidean distance
# → only accept if distance < that terrain's tolerance (25-30 units)
# → skip white/near-white pixels (outside the border)
```

Outputs:
- `terrain_coverage` — what % of inside pixels each terrain covers
- `spatial_layout` — which of 9 zones (3×3 grid) each terrain dominates

### 2 — Prompt Building (`build_prompt`)

Converts terrain analysis into a detailed text prompt.

Example output for a drawing with forest around a central lake:
```
Google Maps satellite view, Sentinel-2 satellite imagery,
nadir orthographic top-down view, 90 degree straight down camera,
high altitude satellite photograph, ultra high resolution 4K,
natural realistic earth colors,
top-down bird's eye view:
deep blue lake river water body clearly located in the center,
dense dark green forest canopy woodland trees clearly located
in the center and on the left side,
lush open green grassland meadow fields dominating most of the area.
shot from 500km altitude, perfectly flat overhead perspective...
```

Spatial zones used:
```
top_left    | top_center    | top_right
mid_left    | center        | mid_right
bottom_left | bottom_center | bottom_right
```

### 3 — Image Generation (Pollinations.ai)

Calls `https://image.pollinations.ai/prompt/{prompt}` with:
- Model: `flux` or `flux-realism` (with automatic fallback)
- Size: 1024×1024 (resized to 512×512 after)
- Negative prompt: bans drone/cinematic/tilted views
- Retries: tries multiple models if first fails

```
Negative prompt:
"drone, angled, tilted, cinematic, painting, low altitude,
 horizon, sky, blurry, watermark, text, 3D render"
```

### 4 — Output Masking (`apply_output_mask`)

Detects outside-border pixels from the original drawing
(white pixels = outside) and applies the chosen mode:

| Mode          | Result                              |
|---------------|-------------------------------------|
| `full`        | Return generated image as-is        |
| `white`       | Replace outside pixels with white   |
| `transparent` | Replace outside pixels with alpha=0 |

---

## API Reference

### GET /health
```json
{
  "status": "ok",
  "backend": "pollinations-smart-prompt",
  "version": "5.0"
}
```

### POST /generate

**Form data:**

| Field           | Type  | Default | Description                        |
|-----------------|-------|---------|------------------------------------|
| `file`          | PNG   | —       | Drawing canvas image               |
| `style_strength`| float | 1.0     | 0.1=subtle, 3.0=wild variation     |
| `output_mode`   | str   | "white" | "full" / "white" / "transparent"   |

**Response:**
```json
{
  "image": "data:image/png;base64,...",
  "prompt": "Google Maps satellite view, Sentinel-2...",
  "analysis": {
    "terrains_found": ["Grass", "Water", "Tree"],
    "coverage": {
      "Grass": 55.2,
      "Water": 16.7,
      "Tree": 28.1
    }
  },
  "label_counts": {}
}
```

### POST /analyze (debug)

Same as `/generate` but returns only the analysis and prompt without generating an image.
Useful for debugging what the backend detects from a drawing.

**Response:**
```json
{
  "analysis": {
    "terrain_coverage": { "Grass": 0.55, "Water": 0.17 },
    "spatial_layout": { "Water": ["center"], "Grass": ["top_left", "mid_right"] },
    "total_inside_pixels": 98234
  },
  "prompt": "Google Maps satellite view..."
}
```

---

## Terrain Color Reference

These are the exact colors the frontend uses and the backend detects:

| Terrain   | RGB             | Hex       | Tolerance |
|-----------|-----------------|-----------|-----------|
| Grass     | (58, 140, 63)   | `#3a8c3f` | 25        |
| Water     | (46, 134, 193)  | `#2e86c1` | 30        |
| Mountain  | (108, 108, 108) | `#6c6c6c` | 28        |
| Snow      | (200, 216, 232) | `#c8d8e8` | 28        |
| Rock      | (158, 158, 158) | `#9e9e9e` | 28        |
| Tree      | (27, 94, 32)    | `#1b5e20` | 25        |
| Road      | (176, 190, 197) | `#b0bec5` | 28        |
| Building  | (194, 130, 74)  | `#c2824a` | 28        |
| Sand      | (212, 169, 106) | `#d4a96a` | 30        |

> Tolerance = maximum Euclidean RGB distance to match a pixel to that terrain.
> Grass and Tree use 25 (tighter) because their colors are similar.

---

## Troubleshooting

**"Connection error" when calling Pollinations**
- Check your internet connection
- Disable VPN if active — VPNs often block Pollinations.ai
- Try again — Pollinations is a free service and can be temporarily slow

**Tree/Forest not appearing in generated image**
- The nearest-neighbor color matcher should catch it
- Run POST /analyze with your drawing to see what terrains are detected
- Make sure the frontend is using exactly `#1b5e20` for Tree

**Generation takes very long**
- Normal — Pollinations flux-pro can take 30-90 seconds
- The backend tries `flux` first, then `flux-realism` as fallback
- Both have a 90-second timeout before giving up

**CORS error in browser console**
- Make sure you start the backend with `uvicorn main:app --reload --port 8000`
- The CORS middleware allows `localhost:3000` by default
- If using a different port, add it to `allow_origins` in `main.py`
