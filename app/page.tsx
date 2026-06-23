"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import heroImage from "@/public/herodonno.png";

// pdfjs-dist (used by PdfSplitter for thumbnails/previews) touches browser-only
// globals like DOMMatrix at module load time, which breaks Next's Node.js
// prerender pass. Loading it client-only side-steps that entirely.
const PdfSplitter = dynamic(() => import("@/components/PdfSplitter"), {
  ssr: false,
  loading: () => (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-8 text-center text-sm text-gray-400 shadow-sm ring-1 ring-black/5">
      Loading…
    </div>
  ),
});

export default function Home() {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center bg-gray-100 px-4 py-12 sm:py-20">
      <div className="mb-8 flex max-w-2xl flex-col items-center text-center">
        <Image
          src={heroImage}
          alt="A PDF document splitting into separate pages"
          priority
          className="mb-6 h-auto w-full max-w-md"
        />
        <h1 className="text-3xl font-bold text-gray-900">PDF Splitter</h1>
        <p className="mt-2 text-sm text-gray-500">
          Split your PDF into multiple files. Everything runs locally, your
          file never leaves your device.
        </p>
      </div>
      <PdfSplitter />
    </div>
  );
}
