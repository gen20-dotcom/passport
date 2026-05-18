import React, { useCallback, useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import {
  Camera,
  Download,
  Image as ImageIcon,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

const PRESETS = {
  passport: {
    label: "Passport",
    photoWidth: 280,
    photoHeight: 360,
    gap: 20,
    cols: 4,
    rows: 2,
    sheetWidth: 1200,
    sheetHeight: 800,
    borderWidth: 2,
  },
  stamp: {
    label: "Stamp",
    photoWidth: 140,
    photoHeight: 185,
    gap: 10,
    cols: 8,
    rows: 4,
    sheetWidth: 1200,
    sheetHeight: 800,
    borderWidth: 1,
  },
};

const AUTO_EDITS = {
  brightness: 104,
  contrast: 108,
  saturation: 104,
  sharpness: 28,
};

function assertPhotoPreset(preset, expected) {
  const gridWidth = preset.cols * preset.photoWidth + (preset.cols - 1) * preset.gap;
  const gridHeight = preset.rows * preset.photoHeight + (preset.rows - 1) * preset.gap;

  console.assert(gridWidth <= preset.sheetWidth, `${preset.label} grid must fit sheet width`);
  console.assert(gridHeight <= preset.sheetHeight, `${preset.label} grid must fit sheet height`);
  console.assert(preset.cols * preset.rows === expected.total, `${preset.label} total photo count must match`);
}

function assertCropAspect(preset) {
  console.assert(preset.photoWidth > 0 && preset.photoHeight > 0, `${preset.label} dimensions must be positive`);
  console.assert(Number.isFinite(preset.photoWidth / preset.photoHeight), `${preset.label} aspect ratio must be valid`);
}

function assertAutoEdits(edits) {
  console.assert(edits.brightness >= 80 && edits.brightness <= 130, "Auto brightness must stay realistic");
  console.assert(edits.contrast >= 80 && edits.contrast <= 140, "Auto contrast must stay realistic");
  console.assert(edits.saturation >= 80 && edits.saturation <= 130, "Auto saturation must stay realistic");
  console.assert(edits.sharpness >= 0 && edits.sharpness <= 60, "Auto sharpness must not over-sharpen faces");
}

// Smoke tests for fixed layout and safe auto-enhancement.
assertPhotoPreset(PRESETS.passport, { total: 8 });
assertPhotoPreset(PRESETS.stamp, { total: 32 });
assertCropAspect(PRESETS.passport);
assertCropAspect(PRESETS.stamp);
assertAutoEdits(AUTO_EDITS);

function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.crossOrigin = "anonymous";
    image.src = url;
  });
}

function clamp(value, min = 0, max = 255) {
  return Math.max(min, Math.min(max, value));
}

function applySharpen(ctx, width, height, strength) {
  if (strength <= 0) return;

  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const output = new Uint8ClampedArray(src);

  const amount = strength / 100;
  const center = 1 + 4 * amount;
  const side = -amount;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;

      for (let channel = 0; channel < 3; channel++) {
        const value =
          src[i + channel] * center +
          src[i - 4 + channel] * side +
          src[i + 4 + channel] * side +
          src[i - width * 4 + channel] * side +
          src[i + width * 4 + channel] * side;

        output[i + channel] = clamp(value);
      }
    }
  }

  ctx.putImageData(new ImageData(output, width, height), 0, 0);
}

async function cropImage(imageSrc, cropPixels, outputWidth, outputHeight) {
  const image = await createImage(imageSrc);

  // Render at 2x, apply mild enhancement, then downsample. This improves soft mobile photos
  // without exposing confusing manual controls to the user.
  const scale = 2;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) throw new Error("Canvas is not supported in this browser");

  canvas.width = outputWidth * scale;
  canvas.height = outputHeight * scale;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `brightness(${AUTO_EDITS.brightness}%) contrast(${AUTO_EDITS.contrast}%) saturate(${AUTO_EDITS.saturation}%)`;

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.filter = "none";
  applySharpen(ctx, canvas.width, canvas.height, AUTO_EDITS.sharpness);

  const finalCanvas = document.createElement("canvas");
  const finalCtx = finalCanvas.getContext("2d", { willReadFrequently: true });

  if (!finalCtx) throw new Error("Canvas is not supported in this browser");

  finalCanvas.width = outputWidth;
  finalCanvas.height = outputHeight;
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = "high";
  finalCtx.drawImage(canvas, 0, 0, outputWidth, outputHeight);
  applySharpen(finalCtx, outputWidth, outputHeight, Math.round(AUTO_EDITS.sharpness * 0.45));

  return finalCanvas.toDataURL("image/png");
}

async function makeSheet(singleImageSrc, preset) {
  const image = await createImage(singleImageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Canvas is not supported in this browser");

  canvas.width = preset.sheetWidth;
  canvas.height = preset.sheetHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, preset.sheetWidth, preset.sheetHeight);

  const gridWidth = preset.cols * preset.photoWidth + (preset.cols - 1) * preset.gap;
  const gridHeight = preset.rows * preset.photoHeight + (preset.rows - 1) * preset.gap;
  const startX = Math.floor((preset.sheetWidth - gridWidth) / 2);
  const startY = Math.floor((preset.sheetHeight - gridHeight) / 2);

  for (let row = 0; row < preset.rows; row++) {
    for (let col = 0; col < preset.cols; col++) {
      const x = startX + col * (preset.photoWidth + preset.gap);
      const y = startY + row * (preset.photoHeight + preset.gap);

      ctx.drawImage(image, x, y, preset.photoWidth, preset.photoHeight);
      ctx.lineWidth = preset.borderWidth;
      ctx.strokeStyle = "#111111";
      ctx.strokeRect(x, y, preset.photoWidth, preset.photoHeight);
    }
  }

  return canvas.toDataURL("image/png");
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function downloadDataUrl(dataUrl, filename) {
  if (!dataUrl) return false;

  try {
    const blob = dataUrlToBlob(dataUrl);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } catch (error) {
    console.error(error);
    const opened = window.open(dataUrl, "_blank", "noopener,noreferrer");
    return Boolean(opened);
  }
}

export default function PhotoSheetWebsite() {
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState("passport");
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1.15);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [singleImage, setSingleImage] = useState(null);
  const [sheetImage, setSheetImage] = useState(null);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState("");

  const preset = useMemo(() => PRESETS[selectedType], [selectedType]);
  const aspect = preset.photoWidth / preset.photoHeight;

  const onCropComplete = useCallback((_, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const resetOutputs = () => {
    setSingleImage(null);
    setSheetImage(null);
    setStep(1);
    setMessage("");
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result);
      setCrop({ x: 0, y: 0 });
      setZoom(1.15);
      setSingleImage(null);
      setSheetImage(null);
      setStep(1);
      setMessage("");
    };
    reader.onerror = () => {
      setMessage("Could not read the selected image. Try another file.");
    };
    reader.readAsDataURL(file);
  };

  const generateSingle = async () => {
    if (!imageSrc || !croppedAreaPixels) return null;

    setIsWorking(true);
    setMessage("");

    try {
      const result = await cropImage(imageSrc, croppedAreaPixels, preset.photoWidth, preset.photoHeight);
      setSingleImage(result);
      setSheetImage(null);
      return result;
    } catch (error) {
      console.error(error);
      setMessage("Could not generate the cropped image. Try another photo.");
      return null;
    } finally {
      setIsWorking(false);
    }
  };

  const downloadSingle = async () => {
    const result = singleImage || (await generateSingle());
    if (!result) return;

    const ok = downloadDataUrl(result, `${preset.label.toLowerCase()}-${preset.photoWidth}x${preset.photoHeight}.png`);
    if (!ok) {
      setMessage("Download was blocked by the browser. Right-click or long-press the preview image and save it.");
    }
  };

  const goNext = async () => {
    const result = singleImage || (await generateSingle());
    if (!result) return;

    setIsWorking(true);
    setMessage("");

    try {
      const sheet = await makeSheet(result, preset);
      setSheetImage(sheet);
      setStep(2);
    } catch (error) {
      console.error(error);
      setMessage("Could not generate the final sheet. Try another photo.");
    } finally {
      setIsWorking(false);
    }
  };

  const downloadSheet = () => {
    if (!sheetImage) return;

    const ok = downloadDataUrl(sheetImage, `${preset.label.toLowerCase()}-sheet-1200x800.png`);
    if (!ok) {
      setMessage("Download was blocked by the browser. Right-click or long-press the sheet preview and save it.");
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-neutral-200 ring-1 ring-white/10">
              1200 × 800 px sheet • bordered photo grid
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Kito Mini Photo Sheet</h1>
            <p className="mt-3 max-w-2xl text-sm text-neutral-300 sm:text-base">
              Take or upload a photo, crop it to Passport or Stamp size, download the single image, then generate a printable sheet.
            </p>
          </div>

          <button
            onClick={resetOutputs}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 shadow-lg shadow-white/10 transition hover:scale-[1.02]"
          >
            <RefreshCw size={16} /> Reset
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <aside className="rounded-3xl bg-white/5 p-5 shadow-2xl ring-1 ring-white/10">
            <h2 className="mb-4 text-xl font-semibold">Setup</h2>

            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-black/30 px-4 py-6 text-center transition hover:border-white/40">
                <Camera className="mb-3" size={30} />
                <span className="text-base font-semibold">Take Photo</span>
                <span className="mt-1 text-xs text-neutral-400">Opens camera on mobile.</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
              </label>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-black/30 px-4 py-6 text-center transition hover:border-white/40">
                <ImageIcon className="mb-3" size={30} />
                <span className="text-base font-semibold">Choose File</span>
                <span className="mt-1 text-xs text-neutral-400">Opens gallery/files.</span>
                <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
              </label>
            </div>

            <div className="mb-5">
              <p className="mb-3 text-sm font-semibold text-neutral-200">Choose size</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(PRESETS).map(([key, item]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSelectedType(key);
                      setSingleImage(null);
                      setSheetImage(null);
                      setStep(1);
                      setMessage("");
                    }}
                    className={`rounded-2xl p-4 text-left ring-1 transition ${
                      selectedType === key
                        ? "bg-white text-neutral-950 ring-white"
                        : "bg-white/5 text-white ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    <span className="block text-sm font-bold">{item.label}</span>
                    <span className="mt-1 block text-xs opacity-75">
                      {item.photoWidth} × {item.photoHeight}px
                    </span>
                    <span className="mt-2 block text-xs opacity-75">
                      {item.cols} × {item.rows} = {item.cols * item.rows}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-black/30 p-4 text-sm text-neutral-300 ring-1 ring-white/10">
              <div className="mb-2 flex items-center justify-between">
                <span>Selected</span>
                <strong className="text-white">{preset.label}</strong>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <span>Single crop</span>
                <strong className="text-white">{preset.photoWidth} × {preset.photoHeight}</strong>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <span>Gap</span>
                <strong className="text-white">{preset.gap}px</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Final sheet</span>
                <strong className="text-white">1200 × 800</strong>
              </div>
            </div>
          </aside>

          <section className="rounded-3xl bg-white/5 p-5 shadow-2xl ring-1 ring-white/10">
            <div className="mb-5 flex items-center gap-2 text-sm text-neutral-300">
              <span className={`rounded-full px-3 py-1 ${step === 1 ? "bg-white text-neutral-950" : "bg-white/10"}`}>1 Crop</span>
              <ArrowRight size={16} />
              <span className={`rounded-full px-3 py-1 ${step === 2 ? "bg-white text-neutral-950" : "bg-white/10"}`}>2 Sheet</span>
            </div>

            {message && (
              <div className="mb-5 flex gap-3 rounded-2xl bg-amber-400/10 p-4 text-sm text-amber-100 ring-1 ring-amber-300/20">
                <AlertTriangle className="mt-0.5 shrink-0" size={18} />
                <p>{message}</p>
              </div>
            )}

            {!imageSrc ? (
              <div className="flex min-h-[430px] flex-col items-center justify-center rounded-3xl bg-black/30 text-center ring-1 ring-white/10">
                <ImageIcon className="mb-4 text-neutral-400" size={54} />
                <h3 className="text-xl font-semibold">Upload a photo to start</h3>
                <p className="mt-2 max-w-md text-sm text-neutral-400">
                  After upload, crop will lock to the selected size ratio automatically.
                </p>
              </div>
            ) : step === 1 ? (
              <>
                <div className="relative h-[430px] overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={aspect}
                    onCropChange={(value) => {
                      setCrop(value);
                      setSingleImage(null);
                      setSheetImage(null);
                    }}
                    onZoomChange={(value) => {
                      setZoom(value);
                      setSingleImage(null);
                      setSheetImage(null);
                    }}
                    onCropComplete={onCropComplete}
                    objectFit="contain"
                  />
                </div>

                <div className="mt-5 rounded-2xl bg-black/30 p-4 text-sm text-neutral-300 ring-1 ring-white/10">
                  <p>
                    Move and zoom the photo directly inside the crop box. Enhancement is applied automatically during export.
                  </p>
                  <label className="mt-4 flex items-center gap-4">
                    <span className="w-16 font-semibold text-white">Zoom</span>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.05"
                      value={zoom}
                      onChange={(e) => {
                        setZoom(Number(e.target.value));
                        setSingleImage(null);
                        setSheetImage(null);
                      }}
                      className="w-full"
                    />
                    <span className="w-12 text-right">{zoom.toFixed(2)}</span>
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={generateSingle}
                    disabled={isWorking}
                    className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {isWorking ? "Generating..." : "Generate Single"}
                  </button>
                  <button
                    onClick={downloadSingle}
                    disabled={isWorking}
                    className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:scale-[1.02] disabled:opacity-50"
                  >
                    <Download size={16} /> Download Single
                  </button>
                  <button
                    onClick={goNext}
                    disabled={isWorking}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-bold text-neutral-950 transition hover:scale-[1.02] disabled:opacity-50"
                  >
                    Next <ArrowRight size={16} />
                  </button>
                </div>

                {singleImage && (
                  <div className="mt-6">
                    <h3 className="mb-3 text-lg font-semibold">Single Preview</h3>
                    <img src={singleImage} alt="Single cropped preview" className="max-h-72 rounded-xl border border-white/20 bg-white" />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="rounded-3xl bg-neutral-200 p-3 ring-1 ring-white/10">
                  {sheetImage && <img src={sheetImage} alt="Final sheet preview" className="w-full rounded-2xl bg-white" />}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold ring-1 ring-white/10 transition hover:bg-white/15"
                  >
                    Back to Crop
                  </button>
                  <button
                    onClick={downloadSheet}
                    className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-neutral-950 transition hover:scale-[1.02]"
                  >
                    <Download size={16} /> Download Sheet
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
