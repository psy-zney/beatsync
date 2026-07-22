"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DEFAULT_AVATAR, type LocalProfile } from "@/lib/profile";
import { Camera, Check, ImagePlus, RotateCw, Sliders, X, ZoomIn, ZoomOut } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

const AVATARS = ["🎧", "🎵", "🎮", "🌙", "🔥", "✨", "🐼", "🦊", "🚀", "🐱", "🐶", "👾"];

/**
 * Renders, rotates, scales and compresses an image to a lightweight 256x256 JPEG data URL (~15-25KB)
 */
function processAvatarImage(imageSrc: string, scale: number, rotation: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const targetSize = 256;
      const canvas = document.createElement("canvas");
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Cannot get canvas context"));

      ctx.save();
      // Move origin to center of canvas
      ctx.translate(targetSize / 2, targetSize / 2);
      // Rotate by angle
      ctx.rotate((rotation * Math.PI) / 180);
      // Scale image
      ctx.scale(scale, scale);

      // Cover crop calculation
      const aspect = img.width / img.height;
      let drawW = targetSize;
      let drawH = targetSize;
      if (aspect > 1) {
        drawW = targetSize * aspect;
      } else {
        drawH = targetSize / aspect;
      }

      // Draw centered
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      // Compress to lightweight 85% quality JPEG
      const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(compressedDataUrl);
    };
    img.onerror = () => reject(new Error("Failed to load image for processing"));
    img.src = imageSrc;
  });
}

export const ProfileSetup = ({ onSave }: { onSave: (profile: LocalProfile) => void }) => {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editor modal state
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // File select handler
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return toast.error("Vui lòng chọn một file ảnh hợp lệ.");

    const reader = new FileReader();
    reader.onload = () => {
      setRawImage(String(reader.result));
      setZoom(1.0);
      setRotation(0);
    };
    reader.readAsDataURL(file);
    // Reset file input value
    event.target.value = "";
  };

  // Open camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraOpen(true);
    } catch (err) {
      console.error("Camera access error:", err);
      toast.error("Không thể truy cập camera. Vui lòng cấp quyền camera trên trình duyệt.");
    }
  };

  // Bind video element when camera is opened
  useEffect(() => {
    if (isCameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraOpen]);

  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  // Capture photo from video feed
  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Flip horizontally for mirror effect if selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const capturedDataUrl = canvas.toDataURL("image/jpeg", 0.95);
    stopCamera();

    // Open image editor with captured photo
    setRawImage(capturedDataUrl);
    setZoom(1.0);
    setRotation(0);
  };

  // Apply crop/rotate/compression
  const applyCropAndCompress = async () => {
    if (!rawImage) return;
    setIsProcessing(true);
    try {
      const compressedAvatar = await processAvatarImage(rawImage, zoom, rotation);
      setAvatar(compressedAvatar);
      setRawImage(null);
      toast.success("Đã nén và lưu ảnh đại diện mới!");
    } catch (err) {
      console.error("Error cropping image:", err);
      toast.error("Lỗi khi xử lý ảnh đại diện.");
    } finally {
      setIsProcessing(false);
    }
  };

  const submit = () => {
    const cleanName = name.trim();
    if (!cleanName) return toast.error("Hãy nhập tên của bạn.");
    onSave({ name: cleanName.slice(0, 32), avatar });
  };

  return (
    <main className="min-h-dvh bg-neutral-950 text-white grid place-items-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl relative">
        <h1 className="text-xl font-bold bg-gradient-to-r from-purple-200 via-white to-purple-400 bg-clip-text text-transparent">
          Chào mừng đến Beatsync
        </h1>
        <p className="mt-1 text-xs text-neutral-400">Tên và ảnh đại diện được lưu riêng trên trình duyệt này.</p>

        {/* Current Avatar Preview & Trigger Actions */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="relative group">
            <Avatar className="size-20 border-2 border-purple-500/40 shadow-lg shadow-purple-500/10">
              {avatar.startsWith("data:") ? (
                <AvatarImage src={avatar} alt="Ảnh đại diện" className="object-cover" />
              ) : null}
              <AvatarFallback className="bg-indigo-600 text-3xl font-normal select-none">
                {avatar.startsWith("data:") ? "" : avatar}
              </AvatarFallback>
            </Avatar>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Tải ảnh lên"
              className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-md transition-transform hover:scale-110"
            >
              <ImagePlus className="size-3.5" />
            </button>
          </div>

          {/* Action buttons: Upload File / Take Camera */}
          <div className="flex gap-2 w-full mt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 border border-neutral-700 transition-colors"
            >
              <ImagePlus className="size-3.5 text-purple-400" />
              Tải ảnh lên
            </button>
            <button
              type="button"
              onClick={startCamera}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 border border-neutral-700 transition-colors"
            >
              <Camera className="size-3.5 text-indigo-400" />
              Chụp camera
            </button>
          </div>

          {/* Emoji Preset Selector */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-2">
            {AVATARS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setAvatar(item)}
                className={`rounded-lg px-2.5 py-1 text-base transition-all ${
                  avatar === item
                    ? "bg-purple-600/40 ring-1 ring-purple-500 scale-105"
                    : "bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Username Input */}
        <div className="mt-5">
          <label className="block text-xs font-medium text-neutral-300" htmlFor="profile-name">
            Tên hiển thị
          </label>
          <input
            id="profile-name"
            autoFocus
            maxLength={32}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
            placeholder="Nhập biệt danh của bạn..."
            className="mt-1.5 w-full rounded-xl border border-neutral-700/80 bg-neutral-800/90 px-3.5 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-neutral-500"
          />
        </div>

        <Button
          className="mt-5 w-full rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-semibold py-2.5 shadow-lg shadow-purple-600/20"
          onClick={submit}
        >
          Hoàn tất & Vào phòng
        </Button>
      </section>

      {/* Camera Capture Modal */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="w-full max-w-sm rounded-2xl bg-neutral-900 border border-neutral-800 p-5 shadow-2xl flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Camera className="size-4 text-purple-400" />
                  Chụp ảnh đại diện
                </h3>
                <button
                  onClick={stopCamera}
                  className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Video Preview Frame */}
              <div className="relative size-60 rounded-full overflow-hidden border-2 border-purple-500/50 bg-black flex items-center justify-center my-2 shadow-inner">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
                {/* Circular overlay guide */}
                <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/40 pointer-events-none" />
              </div>

              <div className="flex gap-3 w-full mt-4">
                <Button
                  variant="outline"
                  onClick={stopCamera}
                  className="flex-1 border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                >
                  Hủy
                </Button>
                <Button
                  onClick={capturePhoto}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 font-semibold text-white"
                >
                  Chụp ảnh
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Editor (Crop, Rotate, Zoom & Compress) Modal */}
      <AnimatePresence>
        {rawImage && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="w-full max-w-sm rounded-2xl bg-neutral-900 border border-purple-900/40 p-5 shadow-2xl flex flex-col items-center">
              <div className="flex items-center justify-between w-full mb-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Sliders className="size-4 text-purple-400" />
                  Cắt & Xoay ảnh đại diện
                </h3>
                <button
                  onClick={() => setRawImage(null)}
                  className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-neutral-800"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Crop & Rotation Live Preview Box */}
              <div className="relative size-56 rounded-full overflow-hidden border-2 border-purple-500/60 bg-black flex items-center justify-center my-3 shadow-xl">
                <img
                  src={rawImage}
                  alt="Raw preview"
                  className="max-w-none transition-transform duration-100 object-cover"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: "center center",
                  }}
                />
              </div>

              {/* Controls: Zoom & Rotate */}
              <div className="w-full space-y-3 my-2 px-1">
                {/* Zoom control */}
                <div className="flex items-center gap-3">
                  <ZoomOut className="size-4 text-neutral-400" />
                  <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))}
                    className="w-full accent-purple-500 h-1.5 bg-neutral-800 rounded-lg cursor-pointer"
                  />
                  <ZoomIn className="size-4 text-neutral-400" />
                </div>

                {/* Rotate button */}
                <div className="flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRotation((prev) => (prev + 90) % 360)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-purple-300 border border-neutral-700/80 transition-colors"
                  >
                    <RotateCw className="size-3.5 text-purple-400" />
                    Xoay 90° ({rotation}°)
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 w-full mt-4">
                <Button
                  variant="outline"
                  onClick={() => setRawImage(null)}
                  className="flex-1 border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                >
                  Hủy
                </Button>
                <Button
                  onClick={applyCropAndCompress}
                  disabled={isProcessing}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 font-semibold text-white"
                >
                  {isProcessing ? (
                    "Đang nén..."
                  ) : (
                    <>
                      <Check className="size-4 mr-1" />
                      Áp dụng & Nén
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
};
