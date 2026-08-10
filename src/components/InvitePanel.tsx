'use client';

/**
 * The invite affordance — the primary way a second player gets in.
 *
 * All three of code, QR and link are offered on purpose: the phone in the room
 * scans, the phone across the table types six characters, and the person in a
 * chat window pastes a URL. Picking one would have made the other two people
 * ask someone for help, which is the opposite of the Instant Contract.
 *
 * The QR is drawn as inline SVG rather than a canvas or an image, so it scales
 * cleanly, needs no layout pass to become visible, and inherits the page's
 * colours in both themes.
 */

import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';

function QrCode({ value, className = '' }: { value: string; className?: string }) {
  const path = useMemo(() => {
    // Type 0 lets the encoder pick the smallest version that fits, and error
    // correction L maximises capacity — a room code is re-scannable, so there
    // is nothing to gain from spending capacity on damage tolerance.
    const qr = qrcode(0, 'L');
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) parts.push(`M${column} ${row}h1v1h-1z`);
      }
    }
    return { d: parts.join(''), count };
  }, [value]);

  return (
    <svg
      // The quiet zone is part of the symbol; without it scanners hunt.
      viewBox={`-2 -2 ${path.count + 4} ${path.count + 4}`}
      className={className}
      role="img"
      aria-label="Scan to join"
      shapeRendering="crispEdges"
    >
      <rect x={-2} y={-2} width={path.count + 4} height={path.count + 4} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

export interface InvitePanelProps {
  code: string | null;
  joinUrl: string | null;
  guests: number;
  connecting: boolean;
  available: boolean;
  onOpen(): void;
  onClose(): void;
}

export function InvitePanel({
  code,
  joinUrl,
  guests,
  connecting,
  available,
  onOpen,
  onClose,
}: InvitePanelProps) {
  const [copied, setCopied] = useState(false);

  if (!available) return null;

  if (!code) {
    return (
      <button
        type="button"
        onClick={onOpen}
        disabled={connecting}
        data-testid="invite-open"
        className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-hairline-strong hover:text-foreground disabled:opacity-50"
      >
        {connecting ? 'Opening…' : 'Invite a player'}
      </button>
    );
  }

  const copy = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the code is on screen either way.
    }
  };

  return (
    <div
      data-testid="invite-panel"
      className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-surface p-4"
    >
      <p className="text-xs text-muted">Scan, or enter this code at the join page</p>

      {joinUrl ? <QrCode value={joinUrl} className="size-36 rounded-sm" /> : null}

      <p
        data-testid="invite-code"
        // Wide tracking because this gets read aloud across a room.
        className="font-mono text-2xl tracking-[0.3em] text-foreground"
      >
        {code}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-hairline-strong hover:text-foreground"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button
          type="button"
          onClick={onClose}
          data-testid="invite-close"
          className="rounded-md border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-hairline-strong hover:text-foreground"
        >
          Close room
        </button>
      </div>

      <p data-testid="invite-guests" className="text-[0.7rem] text-faint">
        {guests === 0
          ? 'Waiting for someone to join'
          : `${guests} ${guests === 1 ? 'player' : 'players'} joined`}
      </p>
    </div>
  );
}
