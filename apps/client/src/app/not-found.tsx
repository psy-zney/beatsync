"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import "./not-found.css";

export default function NotFound() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$#@%&*<>/\\|{}[]";
    const fontSize = 14;
    let columns = Math.floor(canvas.width / fontSize);
    let drops = Array(columns).fill(1);

    const drawMatrix = () => {
      ctx.fillStyle = "rgba(3, 7, 10, 0.08)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ffaa";
      ctx.font = `${fontSize}px 'Share Tech Mono', monospace`;

      if (columns !== Math.floor(canvas.width / fontSize)) {
        columns = Math.floor(canvas.width / fontSize);
        drops = Array(columns).fill(1);
      }

      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const intervalId = setInterval(drawMatrix, 40);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  return (
    <div className="not-found-body">
      <canvas ref={canvasRef} id="matrix-canvas"></canvas>

      <div className="nf-container">
        <div className="error-label">ERROR</div>
        <div className="glitch-wrapper">
          <div className="glitch">404</div>
        </div>
        <div className="not-found-text">PAGE NOT FOUND</div>

        <div className="terminal-box">
          <div>
            <span className="prompt">root@zney-sys:~$</span> locate target_url
          </div>
          <div>
            [<span className="err-code">ERR_404_VOID</span>] Requested matrix node does not exist or has been
            declassified.
          </div>
          <div>
            <span className="prompt">{">"}</span> Status:{" "}
            <span style={{ color: "#ff0055" }}>CONNECTION TERMINATED</span>
          </div>
          <div>
            <span className="prompt">{">"}</span> Solution: Re-routing to secure base sector...
          </div>
        </div>

        <Link href="/" className="btn-return">
          <span>[ ➔ RETURN TO MAINFRAME ]</span>
        </Link>
      </div>
    </div>
  );
}
