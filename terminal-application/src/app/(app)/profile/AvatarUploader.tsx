"use client";

// AvatarUploader — the hero avatar square on /profile, upgraded from a static
// initials block to a working upload control. CLIENT component because it needs
// a file picker, canvas work and fetch; the page around it stays a Server
// Component and just passes the initial state down.
//
// Flow: pick file -> downscale to a 192px square JPEG on a <canvas> (so a 4MB
// phone photo becomes a ~15KB data-URL BEFORE it travels) -> POST /api/avatar
// -> swap the image in locally. Confirm-then-notify: state only changes after
// the server says yes, and both outcomes fire a toast (same pattern as the
// watchlist star and clear-alerts).

import { useRef, useState } from "react";
import { useToast } from "@/app/components/Toaster";
import { Icon } from "@/app/components/icons";

// Output edge in CSS pixels. The box renders at 80px; 192 keeps it crisp on
// retina screens without bloating the row we store it in.
const TARGET_EDGE = 192;
const JPEG_QUALITY = 0.85;

// Downscale + center-crop the picked file to a square JPEG data-URL, entirely
// in the browser. createImageBitmap decodes the file off the main thread.
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    // Center-crop the largest square, then scale it down to TARGET_EDGE.
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = TARGET_EDGE;
    canvas.height = TARGET_EDGE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, TARGET_EDGE, TARGET_EDGE);

    // JPEG (not PNG): photos compress ~10x smaller, and we don't need alpha.
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

export default function AvatarUploader({
  initials,
  initialAvatar,
}: {
  initials: string;
  initialAvatar: string | null;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    if (!file.type.startsWith("image/")) {
      toast("error", "That file is not an image");
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await toAvatarDataUrl(file);
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAvatar(json.avatarUrl); // confirm-then-swap: use the short URL from the server
      toast("success", "Avatar updated");
    } catch {
      toast("error", "Avatar upload failed");
    } finally {
      setBusy(false);
      // Reset so re-picking the SAME file still fires onChange next time.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (busy || !avatar) return;
    setBusy(true);
    try {
      const res = await fetch("/api/avatar", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAvatar(null);
      toast("success", "Avatar removed");
    } catch {
      toast("error", "Could not remove avatar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="group relative -mt-10 h-20 w-20 shrink-0">
      {/* Hidden native picker — the whole avatar square is its trigger */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change avatar"
        className="flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-background bg-primary/15 font-display text-2xl font-black text-primary ring-1 ring-primary/30 transition hover:ring-primary/60 disabled:cursor-wait"
      >
        {avatar ? (
          // Data-URL from our own DB — <img> is correct here; next/image can't
          // optimize an inline base64 source anyway.
          // eslint-disable-next-line @next/next/no-img-element
          <img 
            src={avatar} 
            alt="Avatar" 
            className="h-full w-full object-cover" 
            onError={() => {
              setAvatar(null); // Fallback to initials instantly for the user
              // Automatically clean up the broken reference in the database
              fetch("/api/avatar", { method: "DELETE" }).catch(() => {});
              // Let the developer know via the server logs
              fetch("/api/log", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  level: "error", 
                  message: "Avatar image failed to load, cleared from DB", 
                  context: { url: avatar } 
                })
              }).catch(() => {});
            }}
          />
        ) : (
          initials
        )}

        {/* Hover veil: camera hint over whatever is shown */}
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70 text-primary opacity-0 transition group-hover:opacity-100">
          <Icon name="camera" size={20} />
        </span>
      </button>

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </span>
      )}

      {/* Remove chip — only exists when there IS an avatar to remove */}
      {avatar && !busy && (
        <button
          type="button"
          onClick={() => void handleRemove()}
          aria-label="Remove avatar"
          className="absolute -right-1.5 -top-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-line bg-surface text-muted opacity-0 transition hover:border-danger/50 hover:text-danger group-hover:opacity-100"
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </div>
  );
}
