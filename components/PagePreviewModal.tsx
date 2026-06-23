"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";

interface PagePreviewModalProps {
  pdfDoc: PDFDocumentProxy;
  physicalPage: number; // 1-indexed page actually rendered
  totalPages: number;
  onNavigate: (physicalPage: number) => void;
  onClose: () => void;
}

const MAX_WIDTH = 520;
const MAX_HEIGHT = 680;
const TRANSITION_MS = 150;

export default function PagePreviewModal({
  pdfDoc,
  physicalPage,
  totalPages,
  onNavigate,
  onClose,
}: PagePreviewModalProps) {
  const [visible, setVisible] = useState(false);
  const [isRendering, setIsRendering] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  // Trigger the enter transition on mount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, TRANSITION_MS);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowLeft" && physicalPage > 1) onNavigate(physicalPage - 1);
      if (e.key === "ArrowRight" && physicalPage < totalPages) onNavigate(physicalPage + 1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicalPage, totalPages]);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      setIsRendering(true);
      renderTaskRef.current?.cancel();

      const page = await pdfDoc.getPage(physicalPage);
      if (cancelled) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_WIDTH / baseViewport.width, MAX_HEIGHT / baseViewport.height);
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const task = page.render({ canvas, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (!cancelled) setIsRendering(false);
      } catch {
        // Render was cancelled by a newer page request — nothing to do.
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, physicalPage]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      onClick={handleClose}
    >
      <div
        className={`flex max-h-full flex-col items-center gap-3 rounded-2xl bg-white p-4 shadow-xl transition-all duration-150 ${
          visible ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between">
          <p className="text-sm font-medium text-gray-700">
            Physical page {physicalPage} of {totalPages}
          </p>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close preview"
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="relative flex items-center justify-center">
          <button
            type="button"
            onClick={() => onNavigate(physicalPage - 1)}
            disabled={physicalPage <= 1}
            aria-label="Previous page"
            className="absolute left-0 -translate-x-12 rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeftIcon />
          </button>

          <div className="flex min-h-[200px] min-w-[200px] items-center justify-center overflow-hidden rounded-lg border border-gray-100">
            {isRendering && (
              <div className="absolute h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
            )}
            <canvas ref={canvasRef} className={isRendering ? "opacity-0" : "opacity-100"} />
          </div>

          <button
            type="button"
            onClick={() => onNavigate(physicalPage + 1)}
            disabled={physicalPage >= totalPages}
            aria-label="Next page"
            className="absolute right-0 translate-x-12 rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
