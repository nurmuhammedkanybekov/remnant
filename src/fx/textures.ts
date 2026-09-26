import * as THREE from "three";

/**
 * Every texture in the game is painted at runtime onto a <canvas>.
 * No image files ship with the project — this keeps the "zero assets" rule
 * from the original design while giving surfaces real material detail.
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
function drips(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const len = h * (0.15 + rand() * 0.55);
    const width = 2 + rand() * 7;
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, "rgba(20,16,10,0.55)");
    g.addColorStop(1, "rgba(20,16,10,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, width, len);
  }
}

/** Painted concrete panels with a grimy kick-plate and a faded hazard stripe. */
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

/** Scuffed industrial floor tiles. */
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

/** Dropped-ceiling panels. */
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

/** Wooden/steel supply crate. */
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

/** Rusty barrel side. */
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
      ctx.lineTo(w / 2 * (0.6 + rand() * 0.4), 0);
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

let cache: ReturnType<typeof buildAll> | null = null;
function buildAll() {
  return {
    wall: wallTexture(),
    floor: floorTexture(),
    ceiling: ceilingTexture(),
    crate: crateTexture(),
    barrel: barrelTexture(),
    exitSign: exitSignTexture(),
    glow: glowTexture(),
    flash: flashTexture(),
    bulletHole: bulletHoleTexture(),
    medkit: medkitTexture(),
    paper: paperTexture(),
  };
}

/** Textures are built once and shared across level restarts. */
export function textures(): ReturnType<typeof buildAll> {
  if (!cache) cache = buildAll();
  return cache;
}
