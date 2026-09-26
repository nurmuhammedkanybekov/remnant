import * as THREE from "three";

/**
 * Textures are painted at runtime onto a <canvas>. The big surfaces (walls,
 * floors, ceilings, crates, barrels, doors) start from public-domain (CC0)
 * photo-scanned materials in `public/textures/` — credited in
 * `public/textures/CREDITS.md` — with the facility's own details painted on
 * top: panel seams, rivets, kick-plates, hazard stripes, water damage. If the
 * photos can't be loaded, every surface falls back to a fully painted version.
 */

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number) => void;

/** Small deterministic PRNG so textures look identical every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, seed: number, paint: Paint, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, w, h, mulberry32(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A painted material: colour plus optional normal and roughness maps. */
export interface Surface {
  map: THREE.Texture;
  /** Tangent-space normal map (OpenGL convention). Null for the painted fallbacks. */
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
  /** Built from a photo (true) or fully painted (false); the two are laid out at different scales. */
  photo: boolean;
}

// ---------------------------------------------------------------- photos

type PhotoMap = "color" | "normal" | "rough";
/** Files in `public/textures/`, named `<id>_<map>.jpg`. */
export const PHOTOS: Record<string, PhotoMap[]> = {
  wall: ["color", "normal", "rough"],
  floor: ["color", "normal", "rough"],
  plate: ["color", "normal", "rough"],
  hazard: ["color", "normal", "rough"],
  ceiling: ["color", "normal"],
  planks: ["color", "normal"],
  rust: ["color", "normal", "rough"],
  skin: ["normal"],
};

const photos = new Map<string, HTMLImageElement>();

function photo(id: string, map: PhotoMap): HTMLImageElement | undefined {
  return photos.get(`${id}_${map}`);
}

/**
 * Loads the photo materials. Call once before the first `textures()`; files
 * that fail (or arrive after `timeoutMs`) are skipped and their surfaces are
 * painted instead. Resolves with the number of images loaded.
 */
export async function loadPhotos(base = "textures/", timeoutMs = 10000): Promise<number> {
  let sealed = false;
  const jobs = Object.entries(PHOTOS).flatMap(([id, maps]) =>
    maps.map(async (map) => {
      const img = new Image();
      img.src = `${base}${id}_${map}.jpg`;
      try {
        await img.decode();
        if (!sealed) photos.set(`${id}_${map}`, img);
      } catch {
        console.warn(`Texture ${img.src} unavailable; painting it instead.`);
      }
    })
  );
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, timeoutMs))]);
  sealed = true;
  return photos.size;
}

function blank(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext("2d")!];
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Tiles `img` over a rectangle, scaled so one tile is `tile` pixels wide. */
function tileImage(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, tile: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let ty = y; ty < y + h; ty += tile) for (let tx = x; tx < x + w; tx += tile) ctx.drawImage(img, tx, ty, tile, tile);
  ctx.restore();
}

/**
 * Builds a surface from a photo material: `paint` draws on the colour map,
 * `carve` on the normal map and `rough` on the roughness map (each after the
 * photo is laid down). Returns null if the colour photo isn't loaded.
 */
function photoSurface(
  id: string,
  size: number,
  seed: number,
  paint: (ctx: CanvasRenderingContext2D, s: number, rand: () => number) => void,
  carve?: (ctx: CanvasRenderingContext2D, s: number) => void,
  rough?: (ctx: CanvasRenderingContext2D, s: number) => void
): Surface | null {
  const color = photo(id, "color");
  if (!color) return null;
  const layer = (
    img: HTMLImageElement | undefined,
    draw: ((ctx: CanvasRenderingContext2D, s: number) => void) | undefined,
    srgb: boolean
  ) => {
    if (!img) return null;
    const [canvas, ctx] = blank(size, size);
    ctx.drawImage(img, 0, 0, size, size);
    draw?.(ctx, size);
    return toTexture(canvas, srgb);
  };
  const rand = mulberry32(seed);
  return {
    map: layer(color, (ctx, s) => paint(ctx, s, rand), true)!,
    normalMap: layer(photo(id, "normal"), carve, false),
    roughnessMap: layer(photo(id, "rough"), rough, false),
    photo: true,
  };
}

/** Flat colours for the sloped sides of a groove in a tangent-space normal map. */
const SLOPE = { right: "rgb(200,128,220)", left: "rgb(56,128,220)", up: "rgb(128,200,220)", down: "rgb(128,56,220)" };

/** A recessed seam in a normal map: two sloped walls either side of `pos`. */
function groove(ctx: CanvasRenderingContext2D, vertical: boolean, pos: number, from: number, to: number, width: number): void {
  const half = width / 2;
  if (vertical) {
    ctx.fillStyle = SLOPE.right; // the left wall of the groove faces right
    ctx.fillRect(pos - half, from, half, to - from);
    ctx.fillStyle = SLOPE.left;
    ctx.fillRect(pos, from, half, to - from);
  } else {
    ctx.fillStyle = SLOPE.down; // the upper wall faces down
    ctx.fillRect(from, pos - half, to - from, half);
    ctx.fillStyle = SLOPE.up;
    ctx.fillRect(from, pos, to - from, half);
  }
}

/** Domed bumps (rivets, bolts) in a normal map. */
function domes(ctx: CanvasRenderingContext2D, points: [number, number][], r: number): void {
  const size = Math.ceil(r * 2);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5 - r) / r;
      const ny = -(y + 0.5 - r) / r;
      const d = nx * nx + ny * ny;
      const i = (y * size + x) * 4;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      img.data[i] = 128 + nx * 127;
      img.data[i + 1] = 128 + ny * 127;
      img.data[i + 2] = 128 + nz * 127;
      img.data[i + 3] = 255;
    }
  }
  const [stamp, sctx] = blank(size, size);
  sctx.putImageData(img, 0, 0);
  for (const [x, y] of points) ctx.drawImage(stamp, x - r, y - r);
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, amount: number, alpha: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] = 255 * alpha + d[i + 3] * (1 - alpha);
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  count: number,
  color: string,
  maxR: number
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = maxR * (0.3 + rand() * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Streaks running down from the top, like water damage. */
function drips(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, count: number, scale = 1): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const len = h * (0.15 + rand() * 0.55);
    const width = (2 + rand() * 7) * scale;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, "rgba(20,16,10,0.55)");
    g.addColorStop(1, "rgba(20,16,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, width, len);
  }
}

/**
 * Wall panel layout, as fractions of the texture: a seam down the middle and
 * one across at `SEAM_Y`, a steel kick-plate below `KICK_Y` and a hazard
 * stripe above it.
 */
const SEAM_Y = 0.42;
const KICK_Y = 1 - 70 / 512;
const STRIPE_H = 12 / 512;

function wallRivets(s: number): [number, number][] {
  const k = s / 512;
  const pts: [number, number][] = [];
  for (const px of [14 * k, s / 2 - 14 * k, s / 2 + 14 * k, s - 14 * k])
    for (const py of [14 * k, s * SEAM_Y - 12 * k, s * SEAM_Y + 14 * k, s * KICK_Y - 20 * k]) pts.push([px, py]);
  return pts;
}

/** Scarred concrete panels over a rusted steel kick-plate with a worn hazard stripe. */
export function wallSurface(): Surface {
  const photoWall = photoSurface(
    "wall",
    1024,
    11,
    (ctx, s, rand) => {
      const kick = s * KICK_Y;
      const band = s * STRIPE_H;
      const plate = photo("plate", "color");
      const hazard = photo("hazard", "color");
      // Slightly cooler and darker than the raw photo: a painted, sunless concrete.
      ctx.fillStyle = "rgba(22,24,24,0.3)";
      ctx.fillRect(0, 0, s, s);
      blotches(ctx, s, s, rand, 40, "rgba(20,18,14,0.35)", s / 4);
      // Kick-plate and stripe
      if (plate) tileImage(ctx, plate, 0, kick, s, s - kick, s / 2);
      ctx.fillStyle = "rgba(10,10,8,0.35)";
      ctx.fillRect(0, kick, s, s - kick);
      if (hazard) tileImage(ctx, hazard, 0, kick - band, s, band, band * 5);
      else hazardStripe(ctx, 0, kick - band, s, band);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, kick - 2, s, 4);
      // Seams: dark gap plus a thin lit lip below the horizontal one.
      ctx.fillStyle = "rgba(12,12,10,0.85)";
      for (const x of [0, s / 2, s]) ctx.fillRect(x - 3, 0, 6, kick - band);
      ctx.fillRect(0, s * SEAM_Y - 3, s, 6);
      ctx.fillStyle = "rgba(170,165,150,0.18)";
      ctx.fillRect(0, s * SEAM_Y + 3, s, 2);
      // Rivets: dark ring, lighter head
      for (const [x, y] of wallRivets(s)) {
        ctx.fillStyle = "rgba(20,18,16,0.9)";
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(120,110,95,0.6)";
        ctx.beginPath();
        ctx.arc(x - 1, y - 1, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      drips(ctx, s, s, rand, 34, 2);
      blotches(ctx, s, s, rand, 5, "rgba(70,18,12,0.3)", s / 9);
      // Grime collects along the floor.
      const g = ctx.createLinearGradient(0, s * 0.8, 0, s);
      g.addColorStop(0, "rgba(8,6,4,0)");
      g.addColorStop(1, "rgba(8,6,4,0.5)");
      ctx.fillStyle = g;
      ctx.fillRect(0, s * 0.8, s, s * 0.2);
    },
    (ctx, s) => {
      const kick = s * KICK_Y;
      const band = s * STRIPE_H;
      const plate = photo("plate", "normal");
      const hazard = photo("hazard", "normal");
      if (plate) tileImage(ctx, plate, 0, kick, s, s - kick, s / 2);
      if (hazard) tileImage(ctx, hazard, 0, kick - band, s, band, band * 5);
      for (const x of [0, s / 2, s]) groove(ctx, true, x, 0, kick - band, 10);
      groove(ctx, false, s * SEAM_Y, 0, s, 10);
      groove(ctx, false, kick - band, 0, s, 6);
      groove(ctx, false, kick, 0, s, 6);
      domes(ctx, wallRivets(s), 7);
    },
    (ctx, s) => {
      const kick = s * KICK_Y;
      const band = s * STRIPE_H;
      const plate = photo("plate", "rough");
      const hazard = photo("hazard", "rough");
      if (plate) tileImage(ctx, plate, 0, kick, s, s - kick, s / 2);
      if (hazard) tileImage(ctx, hazard, 0, kick - band, s, band, band * 5);
    }
  );
  if (photoWall) return photoWall;
  const map = wallTexture();
  return { map, normalMap: null, roughnessMap: null, photo: false };
}

function hazardStripe(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.fillStyle = "#8a7424";
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = "#1c1a16";
  const step = h * 2.33;
  for (let x = x0 - step; x < x0 + w + step; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, y0 + h);
    ctx.lineTo(x + step / 2, y0 + h);
    ctx.lineTo(x + step / 2 + h, y0);
    ctx.lineTo(x + h, y0);
    ctx.fill();
  }
  ctx.restore();
}

/** Fully painted fallback for `wallSurface`. */
export function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, 11, (ctx, w, h, rand) => {
    ctx.fillStyle = "#5d5a52";
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, rand, 40, "rgba(40,38,32,0.35)", 120);
    blotches(ctx, w, h, rand, 25, "rgba(120,118,105,0.18)", 90);

    // Panel seams
    ctx.strokeStyle = "rgba(20,20,18,0.8)";
    ctx.lineWidth = 3;
    for (let x = 0; x <= w; x += w / 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, h * 0.42);
    ctx.lineTo(w, h * 0.42);
    ctx.stroke();
    // Seam highlight
    ctx.strokeStyle = "rgba(160,155,140,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.42 + 2);
    ctx.lineTo(w, h * 0.42 + 2);
    ctx.stroke();

    // Rivets
    ctx.fillStyle = "rgba(30,30,28,0.9)";
    for (const px of [14, w / 2 - 14, w / 2 + 14, w - 14]) {
      for (const py of [14, h * 0.42 - 12, h * 0.42 + 14, h - 90]) {
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Kick-plate
    ctx.fillStyle = "#2e2c28";
    ctx.fillRect(0, h - 70, w, 70);
    // Hazard stripe band
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, h - 82, w, 12);
    ctx.clip();
    ctx.fillStyle = "#8a7424";
    ctx.fillRect(0, h - 82, w, 12);
    ctx.fillStyle = "#1c1a16";
    for (let x = -20; x < w + 20; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, h - 70);
      ctx.lineTo(x + 14, h - 70);
      ctx.lineTo(x + 26, h - 82);
      ctx.lineTo(x + 12, h - 82);
      ctx.fill();
    }
    ctx.restore();

    drips(ctx, w, h, rand, 22);
    blotches(ctx, w, h, rand, 6, "rgba(60,20,14,0.28)", 60);
    noise(ctx, w, h, rand, 38, 0);
  });
}

/** Painted fallback for `floorSurface`. */
export function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, 23, (ctx, w, h, rand) => {
    ctx.fillStyle = "#34332f";
    ctx.fillRect(0, 0, w, h);
    const tiles = 4;
    const s = w / tiles;
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const shade = 40 + Math.floor(rand() * 14);
        ctx.fillStyle = `rgb(${shade},${shade - 1},${shade - 4})`;
        ctx.fillRect(tx * s + 2, ty * s + 2, s - 4, s - 4);
      }
    }
    ctx.strokeStyle = "rgba(12,12,10,0.95)";
    ctx.lineWidth = 4;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, h);
      ctx.moveTo(0, i * s);
      ctx.lineTo(w, i * s);
      ctx.stroke();
    }
    blotches(ctx, w, h, rand, 30, "rgba(15,13,10,0.45)", 110);
    blotches(ctx, w, h, rand, 5, "rgba(55,18,12,0.35)", 50);
    // Scratches
    ctx.strokeStyle = "rgba(140,135,120,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const a = rand() * Math.PI;
      const l = 10 + rand() * 50;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
    noise(ctx, w, h, rand, 30, 0);
  });
}

/** Dropped-ceiling panels (painted fallback). */
export function ceilingTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, 37, (ctx, w, h, rand) => {
    ctx.fillStyle = "#3b3a36";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#1a1917";
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, w, h);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    blotches(ctx, w, h, rand, 14, "rgba(70,55,30,0.35)", 50);
    noise(ctx, w, h, rand, 26, 0);
  });
}

/** Supply crate (painted fallback). */
export function crateTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, 51, (ctx, w, h, rand) => {
    ctx.fillStyle = "#4a3f2c";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      ctx.fillStyle = `rgba(0,0,0,${0.1 + rand() * 0.2})`;
      ctx.fillRect(0, y, w, 2);
    }
    ctx.strokeStyle = "#2a2318";
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(w - 8, h - 8);
    ctx.stroke();
    ctx.fillStyle = "rgba(200,190,160,0.35)";
    ctx.font = "bold 26px monospace";
    ctx.fillText("SUPPLY", 70, 60);
    noise(ctx, w, h, rand, 30, 0);
  });
}

/** Rusty barrel side (painted fallback). */
export function barrelTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, 63, (ctx, w, h, rand) => {
    ctx.fillStyle = "#5a2a1c";
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, rand, 30, "rgba(120,70,30,0.4)", 50);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (const y of [30, 128, 226]) ctx.fillRect(0, y, w, 8);
    ctx.fillStyle = "#b8a030";
    ctx.fillRect(0, 150, w, 20);
    noise(ctx, w, h, rand, 30, 0);
  });
}

/** Worn concrete floor cut into large tiles, stained and scuffed. */
export function floorSurface(): Surface {
  const TILES = 4;
  return (
    photoSurface(
      "floor",
      1024,
      23,
      (ctx, s, rand) => {
        const t = s / TILES;
        ctx.fillStyle = "rgba(10,10,9,0.38)";
        ctx.fillRect(0, 0, s, s);
        // Each tile weathered a little differently.
        for (let ty = 0; ty < TILES; ty++)
          for (let tx = 0; tx < TILES; tx++) {
            ctx.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${rand() * 0.16})` : `rgba(150,145,130,${rand() * 0.06})`;
            ctx.fillRect(tx * t, ty * t, t, t);
          }
        ctx.fillStyle = "rgba(6,6,5,0.9)";
        for (let i = 0; i <= TILES; i++) {
          ctx.fillRect(i * t - 3, 0, 6, s);
          ctx.fillRect(0, i * t - 3, s, 6);
        }
        blotches(ctx, s, s, rand, 26, "rgba(12,10,8,0.4)", s / 5);
        blotches(ctx, s, s, rand, 4, "rgba(60,16,10,0.35)", s / 10);
        ctx.strokeStyle = "rgba(150,145,130,0.1)";
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 80; i++) {
          const x = rand() * s;
          const y = rand() * s;
          const a = rand() * Math.PI;
          const l = 20 + rand() * 90;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          ctx.stroke();
        }
      },
      (ctx, s) => {
        const t = s / TILES;
        for (let i = 0; i <= TILES; i++) {
          groove(ctx, true, i * t, 0, s, 10);
          groove(ctx, false, i * t, 0, s, 10);
        }
      }
    ) ?? { map: floorTexture(), normalMap: null, roughnessMap: null, photo: false }
  );
}

/** Water-stained drop-ceiling tiles, six by six per texture (one per level cell). */
export function ceilingSurface(): Surface {
  return (
    photoSurface("ceiling", 512, 37, (ctx, s, rand) => {
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "#4a4843";
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = "source-over";
      // Stains stay inside a tile: each tile is either clean-ish, stained or grimy.
      const t = s / 6;
      for (let ty = 0; ty < 6; ty++)
        for (let tx = 0; tx < 6; tx++) {
          const r = rand();
          ctx.save();
          ctx.beginPath();
          ctx.rect(tx * t, ty * t, t, t);
          ctx.clip();
          ctx.translate(tx * t, ty * t);
          if (r < 0.3) blotches(ctx, t, t, rand, 3, "rgba(70,48,18,0.55)", t * 0.7);
          else if (r < 0.5) blotches(ctx, t, t, rand, 3, "rgba(0,0,0,0.4)", t * 0.8);
          ctx.fillStyle = `rgba(0,0,0,${rand() * 0.25})`;
          ctx.fillRect(0, 0, t, t);
          ctx.restore();
        }
      // T-bar grid
      ctx.fillStyle = "rgba(18,18,16,0.85)";
      for (let i = 0; i <= 6; i++) {
        ctx.fillRect(i * t - 3, 0, 6, s);
        ctx.fillRect(0, i * t - 3, s, 6);
      }
    }) ?? { map: ceilingTexture(), normalMap: null, roughnessMap: null, photo: false }
  );
}

/** Plank supply crate with a dark braced frame. */
export function crateSurface(): Surface {
  return (
    photoSurface(
      "planks",
      512,
      51,
      (ctx, s, rand) => {
        ctx.fillStyle = "rgba(40,30,15,0.3)";
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = "rgba(18,12,6,0.6)";
        ctx.lineWidth = s / 16;
        ctx.strokeRect(s / 32, s / 32, s - s / 16, s - s / 16);
        ctx.lineWidth = s / 21;
        ctx.beginPath();
        ctx.moveTo(s / 32, s / 32);
        ctx.lineTo(s - s / 32, s - s / 32);
        ctx.stroke();
        ctx.fillStyle = "rgba(210,200,170,0.4)";
        ctx.font = `bold ${s / 10}px monospace`;
        ctx.fillText("SUPPLY", s * 0.28, s * 0.24);
        blotches(ctx, s, s, rand, 8, "rgba(0,0,0,0.3)", s / 6);
      },
      (ctx, s) => {
        const e = s / 16;
        for (const x of [e * 1.5, s - e * 1.5]) groove(ctx, true, x, 0, s, 6);
        for (const y of [e * 1.5, s - e * 1.5]) groove(ctx, false, y, 0, s, 6);
      }
    ) ?? { map: crateTexture(), normalMap: null, roughnessMap: null, photo: false }
  );
}

/** Rusted steel drum with rolling hoops and a hazard band. */
export function barrelSurface(): Surface {
  const HOOPS = [30 / 256, 128 / 256, 226 / 256];
  return (
    photoSurface(
      "rust",
      512,
      63,
      (ctx, s) => {
        ctx.fillStyle = "rgba(60,20,10,0.25)";
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        for (const y of HOOPS) ctx.fillRect(0, s * y, s, s / 32);
        ctx.fillStyle = "rgba(184,160,48,0.75)";
        ctx.fillRect(0, s * 0.59, s, s * 0.08);
      },
      (ctx, s) => {
        for (const y of HOOPS) {
          groove(ctx, false, s * y, 0, s, 4);
          groove(ctx, false, s * y + s / 32, 0, s, 4);
        }
      }
    ) ?? { map: barrelTexture(), normalMap: null, roughnessMap: null, photo: false }
  );
}

/** Bare steel plate, for doors. Null when the photo isn't available (doors then stay plain metal). */
export function plateSurface(): Surface | null {
  return photoSurface("plate", 512, 81, (ctx, s) => {
    ctx.fillStyle = "rgba(90,90,90,0.25)";
    ctx.fillRect(0, 0, s, s);
  });
}

/** Worn yellow-and-black hazard paint, for door edges. Null without the photo. */
export function hazardSurface(): Surface | null {
  return photoSurface("hazard", 512, 83, () => {});
}

/** Wrinkled-hide detail for the creatures' skin (normal map only). */
export function skinNormal(): THREE.Texture | null {
  const img = photo("skin", "normal");
  if (!img) return null;
  const [canvas, ctx] = blank(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  return toTexture(canvas, false);
}

/** Green "EXIT" sign face. */
export function exitSignTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 96, 71, (ctx, w, h) => {
    ctx.fillStyle = "#06150a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#4dff7a";
    ctx.font = "bold 64px 'Arial Black', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("EXIT", w / 2, h / 2 + 4);
  });
}

/** Round soft glow, used for sprites (muzzle flash, lamp halo, eye glow). */
export function glowTexture(inner = "rgba(255,255,255,1)"): THREE.CanvasTexture {
  return canvasTexture(128, 128, 1, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Star-burst for muzzle flash. */
export function flashTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, 2, (ctx, w, h, rand) => {
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 9; i++) {
      ctx.rotate((Math.PI * 2) / 9 + rand() * 0.3);
      const g = ctx.createLinearGradient(0, 0, w / 2, 0);
      g.addColorStop(0, "rgba(255,240,200,1)");
      g.addColorStop(1, "rgba(255,160,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo((w / 2) * (0.6 + rand() * 0.4), 0);
      ctx.lineTo(0, 4);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 4);
    g.addColorStop(0, "rgba(255,255,230,1)");
    g.addColorStop(1, "rgba(255,180,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  });
}

/** Bullet hole decal. */
export function bulletHoleTexture(): THREE.CanvasTexture {
  return canvasTexture(64, 64, 3, (ctx, w, h, rand) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.2, "rgba(10,8,6,0.95)");
    g.addColorStop(0.45, "rgba(30,28,24,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    for (let i = 0; i < 6; i++) {
      const a = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * 20, h / 2 + Math.sin(a) * 20);
      ctx.stroke();
    }
  });
}

/** Paper for notes and medkit cross etc. */
export function medkitTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, 5, (ctx, w, h, rand) => {
    ctx.fillStyle = "#d8d4c8";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#c42a2a";
    ctx.fillRect(w * 0.4, h * 0.18, w * 0.2, h * 0.64);
    ctx.fillRect(w * 0.18, h * 0.4, w * 0.64, h * 0.2);
    noise(ctx, w, h, rand, 24, 0);
  });
}

export function paperTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 160, 7, (ctx, w, h, rand) => {
    ctx.fillStyle = "#e0d6b8";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(40,40,70,0.55)";
    ctx.lineWidth = 2;
    for (let y = 24; y < h - 10; y += 12) {
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(12 + (w - 24) * (0.5 + rand() * 0.5), y);
      ctx.stroke();
    }
    blotches(ctx, w, h, rand, 4, "rgba(110,80,40,0.3)", 30);
  });
}

/**
 * Emissive map for creatures: branching veins of the Remnant under the skin.
 * The background is a very dark grey rather than black so a hit flash still
 * tints the whole body, while the veins carry the glow.
 */
export function veinTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, 11, (ctx, w, h, rand) => {
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = "round";
    const branch = (x: number, y: number, angle: number, width: number, depth: number) => {
      let px = x;
      let py = y;
      const steps = 6 + Math.floor(rand() * 8);
      for (let i = 0; i < steps; i++) {
        angle += (rand() - 0.5) * 0.9;
        const nx = px + Math.cos(angle) * 9;
        const ny = py + Math.sin(angle) * 9;
        ctx.strokeStyle = `rgba(255,255,255,${0.3 + width / 5})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        // Draw wrapped copies so the texture tiles without seams.
        for (const [ox, oy] of [
          [w, 0],
          [-w, 0],
          [0, h],
          [0, -h],
        ]) {
          ctx.beginPath();
          ctx.moveTo(px + ox, py + oy);
          ctx.lineTo(nx + ox, ny + oy);
          ctx.stroke();
        }
        px = nx;
        py = ny;
        if (depth > 0 && rand() < 0.25) branch(px, py, angle + (rand() < 0.5 ? 0.8 : -0.8), width * 0.6, depth - 1);
      }
    };
    for (let i = 0; i < 6; i++) branch(rand() * w, rand() * h, rand() * Math.PI * 2, 1.4 + rand() * 1.4, 3);
    // Soft glow nodes where veins gather.
    for (let i = 0; i < 4; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 6 + rand() * 8);
      g.addColorStop(0, "rgba(255,255,255,0.6)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 20, y - 20, 40, 40);
    }
  });
}

/** Mottled, slick skin for the creatures (multiplied with each creature's tint). */
export function fleshTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, 12, (ctx, w, h, rand) => {
    ctx.fillStyle = "#b8aaa0";
    ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, rand, 40, "rgba(90,60,55,0.35)", 30);
    blotches(ctx, w, h, rand, 30, "rgba(230,220,210,0.25)", 18);
    noise(ctx, w, h, rand, 40, 1);
  });
}

let cache: ReturnType<typeof buildAll> | null = null;
function buildAll() {
  return {
    wall: wallSurface(),
    floor: floorSurface(),
    ceiling: ceilingSurface(),
    crate: crateSurface(),
    barrel: barrelSurface(),
    plate: plateSurface(),
    hazard: hazardSurface(),
    skin: skinNormal(),
    exitSign: exitSignTexture(),
    glow: glowTexture(),
    flash: flashTexture(),
    bulletHole: bulletHoleTexture(),
    medkit: medkitTexture(),
    paper: paperTexture(),
    veins: veinTexture(),
    flesh: fleshTexture(),
  };
}

/** Textures are built once and shared across level restarts. */
export function textures(): ReturnType<typeof buildAll> {
  if (!cache) cache = buildAll();
  return cache;
}
