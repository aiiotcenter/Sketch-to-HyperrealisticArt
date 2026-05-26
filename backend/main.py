
import io
import base64
import time
import httpx
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageFilter

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG — reads from .env file in the backend folder
# ─────────────────────────────────────────────────────────────────────────────
import os
from dotenv import load_dotenv

load_dotenv()

REPLICATE_API_KEY = os.getenv("REPLICATE_API_KEY", "")
REPLICATE_MODEL   = "black-forest-labs/flux-canny-pro"

# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="GauGAN Studio — Flux Canny Pro Backend", version="6.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# TERRAIN DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────
TERRAINS = [
    { "name": "Grass",    "rgb": (58,  140,  63),  "prompt": "lush open green grassland meadow fields",        "tol": 25 },
    { "name": "Water",    "rgb": (46,  134, 193),  "prompt": "deep blue lake river water body",                "tol": 30 },
    { "name": "Mountain", "rgb": (108, 108, 108),  "prompt": "rocky mountain range high elevation peaks",      "tol": 28 },
    { "name": "Snow",     "rgb": (200, 216, 232),  "prompt": "white snow covered ice glaciers",                "tol": 28 },
    { "name": "Rock",     "rgb": (158, 158, 158),  "prompt": "bare grey rock cliff stone terrain",             "tol": 28 },
    { "name": "Tree",     "rgb": (27,   94,  32),  "prompt": "dense dark green forest canopy woodland trees",  "tol": 25 },
    { "name": "Road",     "rgb": (176, 190, 197),  "prompt": "grey road network paths infrastructure",         "tol": 28 },
    { "name": "Building", "rgb": (194, 130,  74),  "prompt": "urban buildings rooftops orange settlement",     "tol": 28 },
    { "name": "Sand",     "rgb": (212, 169, 106),  "prompt": "sandy beige desert beach dunes",                "tol": 30 },
]

CANVAS_SIZE = 1024

# ─────────────────────────────────────────────────────────────────────────────
# TERRAIN ANALYSIS (same smart pixel analysis as before)
# ─────────────────────────────────────────────────────────────────────────────

def match_terrain(r, g, b):
    best_terrain = None
    best_dist    = float("inf")
    for t in TERRAINS:
        tr, tg, tb = t["rgb"]
        dist = ((r-tr)**2 + (g-tg)**2 + (b-tb)**2) ** 0.5
        if dist < best_dist:
            best_dist = dist
            best_terrain = t
    return best_terrain if (best_terrain and best_dist <= best_terrain["tol"]) else None


def analyze_drawing(img_array: np.ndarray) -> dict:
    h, w = img_array.shape[:2]
    terrain_pixels = { t["name"]: 0 for t in TERRAINS }
    total_inside   = 0
    zone_pixels    = { t["name"]: {
        "top_left":0,"top_center":0,"top_right":0,
        "mid_left":0,"center":0,"mid_right":0,
        "bottom_left":0,"bottom_center":0,"bottom_right":0,
    } for t in TERRAINS }
    zone_totals = { k:0 for k in ["top_left","top_center","top_right","mid_left","center","mid_right","bottom_left","bottom_center","bottom_right"] }

    for y in range(h):
        for x in range(w):
            r,g,b = int(img_array[y,x,0]), int(img_array[y,x,1]), int(img_array[y,x,2])
            if r>230 and g>230 and b>230: continue  # skip white (outside border)
            terrain = match_terrain(r,g,b)
            if terrain is None: continue
            total_inside += 1
            terrain_pixels[terrain["name"]] += 1
            col = "left" if x<w/3 else ("center" if x<2*w/3 else "right")
            row = "top"  if y<h/3 else ("mid"    if y<2*h/3 else "bottom")
            zone = "center" if (row=="mid" and col=="center") else (f"mid_{col}" if row=="mid" else f"{row}_{col}")
            zone_pixels[terrain["name"]][zone] += 1
            zone_totals[zone] += 1

    if total_inside == 0:
        return {"terrain_coverage":{}, "spatial_layout":{}, "total_inside_pixels":0}

    coverage = { name: count/total_inside for name,count in terrain_pixels.items() if count>0 }
    spatial  = {}
    for t in TERRAINS:
        name = t["name"]
        if name not in coverage: continue
        dominated = [zone for zone,ztotal in zone_totals.items() if ztotal>0 and zone_pixels[name][zone]/ztotal>0.20]
        if dominated: spatial[name] = dominated

    return {"terrain_coverage":coverage, "spatial_layout":spatial, "total_inside_pixels":total_inside}


def build_prompt(analysis: dict, style_strength: float = 1.0) -> str:
    coverage = analysis["terrain_coverage"]
    spatial  = analysis["spatial_layout"]
    if not coverage:
        return "Google Maps satellite view, nadir orthographic top-down view, photorealistic terrain, 4K"

    zone_desc = {
        "center":"in the center","top_center":"in the upper area","bottom_center":"in the lower area",
        "mid_left":"on the left side","mid_right":"on the right side",
        "top_left":"in the upper-left","top_right":"in the upper-right",
        "bottom_left":"in the lower-left","bottom_right":"in the lower-right",
    }
    sorted_terrains = sorted(coverage.items(), key=lambda x:x[1], reverse=True)
    terrain_parts   = []

    for name, fraction in sorted_terrains:
        terrain_obj  = next(t for t in TERRAINS if t["name"]==name)
        prompt_word  = terrain_obj["prompt"]
        amount       = "dominating most of the area" if fraction>0.5 else "covering a large portion" if fraction>0.3 else "clearly visible covering a significant area" if fraction>0.15 else "clearly visible in distinct patches"
        zones        = spatial.get(name,[])
        if zones:
            priority  = ["center","mid_left","mid_right","top_center","bottom_center","top_left","top_right","bottom_left","bottom_right"]
            best_zone = next((z for z in priority if z in zones), zones[0])
            position  = "spread across the area" if len(zones)>=4 else (f"{zone_desc[zones[0]]} and {zone_desc[zones[1]]}" if len(zones)>=2 else zone_desc[best_zone])
            terrain_parts.append(f"{prompt_word} clearly located {position}")
        else:
            terrain_parts.append(f"{prompt_word} {amount}")

    style_mod = "muted natural earth tones," if style_strength<1.0 else "vivid high contrast colors," if style_strength>2.0 else "natural realistic earth colors,"

    return (
        f"Google Maps satellite view, Sentinel-2 satellite imagery, "
        f"nadir orthographic top-down view, 90 degree straight down camera, "
        f"high altitude satellite photograph, ultra high resolution 4K, "
        f"photorealistic, {style_mod} "
        f"top-down bird's eye view: {', '.join(terrain_parts)}. "
        f"shot from 500km altitude, perfectly flat overhead perspective, "
        f"no shadows visible, uniform top-down lighting, "
        f"satellite image texture, crisp terrain detail from above, "
        f"looks exactly like Google Earth or Google Maps satellite layer, "
        f"no text, no labels, no UI overlays, "
        f"no drone perspective, no angled view, no cinematic, no horizon, no sky"
    )

# ─────────────────────────────────────────────────────────────────────────────
# CANNY EDGE EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def extract_canny_edges(pil_img: Image.Image) -> Image.Image:
    # Resize to 512x512
    img = pil_img.convert("RGB").resize((CANVAS_SIZE, CANVAS_SIZE), Image.LANCZOS)

    # Convert to grayscale
    gray = img.convert("L")

    # Apply edge detection
    edges = gray.filter(ImageFilter.FIND_EDGES)

    # Enhance edges — make them thicker and cleaner
    edges = edges.filter(ImageFilter.MaxFilter(3))

    # Convert to numpy for thresholding
    edges_arr = np.array(edges)

    # Threshold: anything above 20 becomes white edge (255), rest black
    edges_arr = np.where(edges_arr > 20, 255, 0).astype(np.uint8)

    # Convert back to PIL RGB (Replicate expects RGB)
    edges_pil = Image.fromarray(edges_arr, mode="L").convert("RGB")

    return edges_pil


def pil_to_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT MASKING (same as before)
# ─────────────────────────────────────────────────────────────────────────────

def apply_output_mask(generated_img: Image.Image, original_drawing: np.ndarray, output_mode: str) -> Image.Image:
  
    if output_mode == "full":
        return generated_img
    outside_mask = (original_drawing[:,:,0]>230) & (original_drawing[:,:,1]>230) & (original_drawing[:,:,2]>230)
    if not outside_mask.any():
        return generated_img
    gen_arr = np.array(generated_img.convert("RGB"))
    if output_mode == "white":
        gen_arr[outside_mask] = [255,255,255]
        return Image.fromarray(gen_arr, "RGB")
    else:  # transparent
        rgba = np.zeros((CANVAS_SIZE,CANVAS_SIZE,4), dtype=np.uint8)
        rgba[:,:,:3] = gen_arr
        rgba[:,:,3]  = 255
        rgba[outside_mask,3] = 0
        return Image.fromarray(rgba, "RGBA")

# ─────────────────────────────────────────────────────────────────────────────
# REPLICATE API CALL
# ─────────────────────────────────────────────────────────────────────────────

async def call_replicate(prompt: str, canny_image_b64: str, guidance: float = 30.0) -> bytes:
 
    headers = {
        "Authorization": f"Bearer {REPLICATE_API_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "wait",  # wait up to 60s for result instead of polling
    }

    payload = {
        "input": {
            "prompt":           prompt,
            "control_image":    canny_image_b64,
            "guidance":         guidance,
            "steps":            28,
            "megapixels":       "1",   # 1 megapixel = ~1024x1024 output
            "output_format":    "png",
            "output_quality":   100,
            "safety_tolerance": 5,
        }
    }

    async with httpx.AsyncClient(timeout=120.0) as client:

        # Step 1: Create prediction
        resp = await client.post(
            f"https://api.replicate.com/v1/models/{REPLICATE_MODEL}/predictions",
            headers=headers,
            json={"input": payload["input"]},
        )

        if resp.status_code not in (200, 201):
            raise HTTPException(500, f"Replicate API error {resp.status_code}: {resp.text}")

        prediction = resp.json()
        prediction_id  = prediction["id"]
        status         = prediction.get("status", "starting")
        output         = prediction.get("output")

        print(f"🚀 Prediction created: {prediction_id} — status: {status}")

        # Step 2: Poll until done (if "Prefer: wait" didn't return result immediately)
        poll_url = f"https://api.replicate.com/v1/predictions/{prediction_id}"
        attempts = 0

        while status not in ("succeeded", "failed", "canceled") and attempts < 60:
            await asyncio.sleep(2)
            poll_resp = await client.get(poll_url, headers=headers)
            prediction = poll_resp.json()
            status     = prediction.get("status","")
            output     = prediction.get("output")
            attempts  += 1
            print(f"   Polling... status={status} attempt={attempts}")

        if status != "succeeded" or not output:
            error = prediction.get("error","Unknown error")
            raise HTTPException(500, f"Replicate generation failed: {error}")

        # Step 3: Download the output image
        # output is a list of URLs — take the first one
        img_url  = output if isinstance(output, str) else output[0]
        img_resp = await client.get(img_url)

        if img_resp.status_code != 200:
            raise HTTPException(500, "Failed to download generated image from Replicate")

        return img_resp.content  # raw PNG bytes

# Fix: import asyncio at top
import asyncio

# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status":   "ok",
        "backend":  "flux-canny-pro-replicate",
        "model":    REPLICATE_MODEL,
        "version":  "6.0",
        "api_key_set": REPLICATE_API_KEY != "PASTE_YOUR_NEW_KEY_HERE",
    }


@app.post("/analyze")
async def analyze_endpoint(file: UploadFile = File(...)):
   
    raw = await file.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB").resize((CANVAS_SIZE,CANVAS_SIZE))
    arr = np.array(img)
    analysis = analyze_drawing(arr)
    prompt   = build_prompt(analysis)
    return {"analysis": analysis, "prompt": prompt}


@app.post("/generate")
async def generate(
    file: UploadFile = File(...),
    style_strength: float = 1.0,
    output_mode: str = "white",
):
 
    if REPLICATE_API_KEY == "":
        raise HTTPException(500, "Replicate API key not set. Create backend/.env file with REPLICATE_API_KEY=r8_your_key_here")

    if file.content_type not in ("image/png","image/jpeg","image/webp"):
        raise HTTPException(400, "Only PNG/JPEG/WEBP accepted")

    # Read drawing
    raw         = await file.read()
    drawing_pil = Image.open(io.BytesIO(raw)).convert("RGB").resize((CANVAS_SIZE,CANVAS_SIZE))
    drawing_arr = np.array(drawing_pil)

    # Step 1: Analyze
    print("🔍 Analyzing drawing...")
    analysis = analyze_drawing(drawing_arr)
    print(f"   Terrains: {list(analysis['terrain_coverage'].keys())}")

    # Step 2: Build prompt
    prompt = build_prompt(analysis, style_strength)
    print(f"📝 Prompt: {prompt[:120]}...")

    # Step 3: Extract Canny edges
    print("✏️  Extracting Canny edges...")
    edges_pil    = extract_canny_edges(drawing_pil)
    edges_b64    = pil_to_base64(edges_pil)

    # Step 4: Call Replicate
    # guidance: higher = follows edges more strictly
    # 30 is a good balance — change 10-50 to tune
    guidance = 20.0 + (style_strength / 3.0) * 20.0
    print(f"🌐 Calling Replicate Flux.1 Canny Pro (guidance={guidance:.1f})...")

    img_bytes = await call_replicate(prompt, edges_b64, guidance)

    # Step 5: Load + mask
    generated_pil = Image.open(io.BytesIO(img_bytes)).convert("RGB").resize((CANVAS_SIZE,CANVAS_SIZE))
    final_img     = apply_output_mask(generated_pil, drawing_arr, output_mode)

    # Step 6: Encode + return
    buf = io.BytesIO()
    final_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    return JSONResponse({
        "image":    f"data:image/png;base64,{b64}",
        "prompt":   prompt,
        "analysis": {
            "terrains_found": list(analysis["terrain_coverage"].keys()),
            "coverage": {k:round(v*100,1) for k,v in analysis["terrain_coverage"].items()},
        },
        "label_counts": {},
    })
