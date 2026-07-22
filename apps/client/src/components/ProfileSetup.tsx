"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DEFAULT_AVATAR, type LocalProfile } from "@/lib/profile";
import { ImagePlus } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";

const AVATARS = ["🎧", "🎵", "🎮", "🌙", "🔥", "✨", "🐼", "🦊"];

export const ProfileSetup = ({ onSave }: { onSave: (profile: LocalProfile) => void }) => {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return toast.error("Vui lòng chọn một ảnh hợp lệ.");
    if (file.size > 3 * 1024 * 1024) return toast.error("Ảnh đại diện phải nhỏ hơn 3 MB.");
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };

  const submit = () => {
    const cleanName = name.trim();
    if (!cleanName) return toast.error("Hãy nhập tên của bạn.");
    onSave({ name: cleanName.slice(0, 32), avatar });
  };

  return (
    <main className="min-h-dvh bg-neutral-950 text-white grid place-items-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <h1 className="text-xl font-semibold">Chào mừng đến Beatsync</h1>
        <p className="mt-1 text-sm text-neutral-400">Tên và ảnh đại diện chỉ được lưu trên trình duyệt này.</p>
        <div className="mt-6 flex items-center gap-4">
          <button className="relative rounded-full" type="button" onClick={() => inputRef.current?.click()}>
            <Avatar className="size-16 border border-neutral-700">
              {avatar.startsWith("data:") && <AvatarImage src={avatar} alt="Ảnh đại diện" />}
              <AvatarFallback className="bg-indigo-600 text-2xl">
                {avatar.startsWith("data:") ? "" : avatar}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
              <ImagePlus className="size-3.5" />
            </span>
          </button>
          <div className="flex flex-wrap gap-1.5">
            {AVATARS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setAvatar(item)}
                className="rounded-md bg-neutral-800 px-2 py-1 hover:bg-neutral-700"
              >
                {item}
              </button>
            ))}
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
        </div>
        <label className="mt-5 block text-sm font-medium" htmlFor="profile-name">
          Tên hiển thị
        </label>
        <input
          id="profile-name"
          autoFocus
          maxLength={32}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          placeholder="Tên của bạn"
          className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <Button className="mt-5 w-full" onClick={submit}>
          Vào phòng
        </Button>
      </section>
    </main>
  );
};
