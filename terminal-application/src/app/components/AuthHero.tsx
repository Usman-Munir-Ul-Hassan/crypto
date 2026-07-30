import Image from "next/image";

export default function AuthHero() {
  return (
    <div className="relative hidden lg:flex flex-col justify-end overflow-hidden border-l border-line">
      {/* Market photo layer — desaturated + dimmed so it obeys the dark theme */}
      <Image
        src="https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1400&q=70"
        alt=""
        fill
        priority
        sizes="50vw"
        className="object-cover opacity-40 grayscale"
      />
      {/* CSS-only market backdrop: subtle grid + green glow, kept darker than 30% */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary opacity-[0.04] blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

      {/* Protocol card */}
      <div className="relative m-10 rounded-lg border border-line bg-surface/80 p-6 backdrop-blur">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-primary">
          Protocol Active
        </p>
        <h2 className="mt-3 font-display text-2xl font-black italic uppercase tracking-tight text-foreground">
          Secure Asset Monitoring //
        </h2>
        <p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-muted">
          Join the network of thousands of operatives monitoring the global
          liquidity deltas in real-time.
        </p>
      </div>
    </div>
  );
}
