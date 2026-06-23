"use client";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import PagePreviewModal from "./PagePreviewModal";
import pdfjsLib from "@/lib/pdfjs";

// A single "split" the user has configured: a name + a 1-indexed *printed*
// page range (before the front-matter offset is applied).
interface SplitItem {
  id: number;
  name: string;
  startPage: string;
  endPage: string;
}

// Which input last requested a preview, so the modal knows what to render
// and where prev/next navigation should resume from.
interface PreviewRequest {
  physicalPage: number;
}

const THUMBNAIL_COUNT = 5;
const THUMBNAIL_WIDTH = 100;
const LARGE_FILE_BYTES = 100 * 1024 * 1024;

function sanitizeFileName(name: string, extension: "pdf" | "zip" = "pdf"): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, "-");
  const suffix = `.${extension}`;
  return cleaned.toLowerCase().endsWith(suffix) ? cleaned : `${cleaned}${suffix}`;
}

function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderThumbnails(doc: PDFDocumentProxy): Promise<string[]> {
  const count = Math.min(THUMBNAIL_COUNT, doc.numPages);
  const thumbnails: string[] = [];

  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / baseViewport.width });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    thumbnails.push(canvas.toDataURL());
  }

  return thumbnails;
}

export default function PdfSplitter() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [isLargeFile, setIsLargeFile] = useState(false);

  // pdfjs-dist instance used for thumbnails and page previews. Kept separate
  // from `fileBytes` (which pdf-lib needs untouched) because pdfjs may
  // transfer/detach whatever ArrayBuffer it's handed.
  const [pdfjsDoc, setPdfjsDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfjsLoadingTask, setPdfjsLoadingTask] = useState<PDFDocumentLoadingTask | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);

  const [frontMatterOffset, setFrontMatterOffset] = useState("0");
  const [showOffsetTooltip, setShowOffsetTooltip] = useState(false);

  const [splits, setSplits] = useState<SplitItem[]>([]);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextSplitId = useRef(0);

  // Free the pdfjs worker/document whenever it's replaced or on unmount.
  // The loading task (not the resolved proxy) owns `destroy()`, and reading
  // it from state — rather than a ref — ensures each effect's cleanup closes
  // over the task it was actually paired with, not whatever a ref currently
  // points to.
  useEffect(() => {
    return () => {
      pdfjsLoadingTask?.destroy();
    };
  }, [pdfjsLoadingTask]);

  function makeSplit(defaultStart: string, defaultEnd: string): SplitItem {
    nextSplitId.current += 1;
    return {
      id: nextSplitId.current,
      // Placeholder — renumberDefaultNames() assigns the real position-based name.
      name: "split-0",
      startPage: defaultStart,
      endPage: defaultEnd,
    };
  }

  // A split's name still counts as "default" (safe to renumber) as long as
  // the user hasn't typed a custom one over it.
  function isDefaultName(name: string): boolean {
    return /^split-\d+$/.test(name);
  }

  // Keeps default-named splits numbered by their position — 1st is split-1,
  // 2nd is split-2, etc. — even after splits are added or removed. Splits the
  // user has renamed are left untouched.
  function renumberDefaultNames(items: SplitItem[]): SplitItem[] {
    return items.map((item, index) =>
      isDefaultName(item.name) ? { ...item, name: `split-${index + 1}` } : item
    );
  }

  // Resolves the offset for live UI hints; invalid/empty input reads as 0
  // rather than blocking the rest of the form while the user is mid-typing.
  function offsetForDisplay(): number {
    const n = Number(frontMatterOffset);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  // Strict version used right before splitting: returns null if invalid.
  function offsetForSubmit(): number | null {
    if (frontMatterOffset.trim() === "") return 0;
    const n = Number(frontMatterOffset);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }

  function physicalPageFor(printedValue: string): number | null {
    const n = Number(printedValue);
    if (!Number.isInteger(n) || n < 1) return null;
    return n + offsetForDisplay();
  }

  async function loadFile(file: File) {
    setError(null);
    setSuccessMessage(null);

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }

    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFDocument.load(buffer);
      const totalPages = doc.getPageCount();

      setFileBytes(buffer);
      setFileName(file.name);
      setPageCount(totalPages);
      setIsLargeFile(file.size > LARGE_FILE_BYTES);
      setFrontMatterOffset("0");
      setSplits(renumberDefaultNames([makeSplit("1", String(totalPages))]));
      setThumbnails([]);
      setPdfjsDoc(null);
      setPdfjsLoadingTask(null);

      try {
        // Hand pdfjs its own copy — it may transfer the buffer to its worker,
        // which would otherwise leave `buffer` detached for pdf-lib later.
        const loadingTask = pdfjsLib.getDocument({ data: buffer.slice() });
        const pdfjsDocument = await loadingTask.promise;
        setPdfjsLoadingTask(loadingTask);
        setPdfjsDoc(pdfjsDocument);
        setThumbnails(await renderThumbnails(pdfjsDocument));
      } catch {
        // Previews are a nice-to-have; splitting still works without them.
        setPdfjsDoc(null);
        setPdfjsLoadingTask(null);
        setThumbnails([]);
      }
    } catch {
      setError("Couldn't read that file. It may be corrupted or password protected.");
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function resetFile() {
    setFileBytes(null);
    setFileName(null);
    setPageCount(0);
    setIsLargeFile(false);
    setPdfjsDoc(null);
    setPdfjsLoadingTask(null);
    setThumbnails([]);
    setFrontMatterOffset("0");
    setSplits([]);
    setPreviewRequest(null);
    setError(null);
    setSuccessMessage(null);
  }

  function addSplit() {
    setSplits((prev) => renumberDefaultNames([...prev, makeSplit("1", String(pageCount))]));
  }

  function removeSplit(id: number) {
    setSplits((prev) => renumberDefaultNames(prev.filter((s) => s.id !== id)));
  }

  function updateSplit(id: number, field: keyof Omit<SplitItem, "id">, value: string) {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  function openPreview(printedValue: string) {
    const physical = physicalPageFor(printedValue);
    if (physical === null) return;
    setPreviewRequest({ physicalPage: Math.min(Math.max(physical, 1), pageCount) });
  }

  // Returns a human-readable error for a split, or null if it's valid.
  function getSplitError(split: SplitItem, offset: number): string | null {
    if (!split.name.trim()) return "Name is required.";

    const start = Number(split.startPage);
    const end = Number(split.endPage);

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return "Start and end pages must be whole numbers.";
    }
    if (start < 1 || end < 1) return "Pages must be 1 or greater.";
    if (start > end) return "Start page must be before end page.";

    const physicalEnd = end + offset;
    if (physicalEnd > pageCount) {
      return offset > 0
        ? `With the offset, page ${end} maps to physical page ${physicalEnd}, which exceeds the document's ${pageCount} pages.`
        : `End page can't exceed ${pageCount}.`;
    }

    return null;
  }

  async function handleSplitAndDownload() {
    if (!fileBytes) return;

    setError(null);
    setSuccessMessage(null);

    const offset = offsetForSubmit();
    if (offset === null) {
      setError("Front matter pages must be 0 or a positive whole number.");
      return;
    }

    if (splits.length === 0) {
      setError("Add at least one split before downloading.");
      return;
    }

    const firstInvalid = splits
      .map((s) => ({ split: s, message: getSplitError(s, offset) }))
      .find((entry) => entry.message);

    if (firstInvalid) {
      setError(`"${firstInvalid.split.name || "Unnamed split"}": ${firstInvalid.message}`);
      return;
    }

    setIsProcessing(true);
    try {
      const sourceDoc = await PDFDocument.load(fileBytes);
      const generated: { fileName: string; bytes: Uint8Array }[] = [];

      for (const split of splits) {
        const start = Number(split.startPage) + offset;
        const end = Number(split.endPage) + offset;

        // Convert the user-facing 1-indexed physical range to pdf-lib's 0-indexed pages.
        const pageIndices = Array.from(
          { length: end - start + 1 },
          (_, idx) => start - 1 + idx
        );

        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(sourceDoc, pageIndices);
        copiedPages.forEach((page) => newDoc.addPage(page));

        const bytes = await newDoc.save();
        generated.push({ fileName: sanitizeFileName(split.name), bytes });
      }

      if (generated.length === 1) {
        downloadBytes(generated[0].bytes, generated[0].fileName, "application/pdf");
        setSuccessMessage("Done! Downloaded 1 file.");
      } else {
        const zip = new JSZip();
        generated.forEach(({ fileName, bytes }) => zip.file(fileName, bytes));
        const zipBytes = await zip.generateAsync({ type: "uint8array" });

        const zipName = sanitizeFileName(
          `${(fileName ?? "splits").replace(/\.pdf$/i, "")}-splits`,
          "zip"
        );
        downloadBytes(zipBytes, zipName, "application/zip");
        setSuccessMessage(`Done! Downloaded ${generated.length} files as a ZIP.`);
      }
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch {
      setError("Something went wrong while splitting the PDF. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
      {/* Upload zone */}
      {!fileName ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
          }`}
        >
          <p className="text-sm font-medium text-gray-700">
            Drag and drop a PDF here, or click to browse
          </p>
          <p className="text-xs text-gray-400">PDF files only</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
            <div>
              <p className="truncate text-sm font-medium text-gray-800">{fileName}</p>
              <p className="text-xs text-gray-500">{pageCount} pages</p>
            </div>
            <button
              type="button"
              onClick={resetFile}
              className="shrink-0 text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline"
            >
              Choose a different file
            </button>
          </div>

          {isLargeFile && (
            <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
              Large file detected. Processing may be slow on some devices.
            </p>
          )}

          {thumbnails.length > 0 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {thumbnails.map((src, i) => (
                <div key={i} className="flex shrink-0 flex-col items-center gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URLs from a client-rendered canvas, not a static asset */}
                  <img
                    src={src}
                    alt={`Page ${i + 1} thumbnail`}
                    className="h-24 rounded border border-gray-200 shadow-sm"
                  />
                  <span className="text-[11px] text-gray-400">p. {i + 1}</span>
                </div>
              ))}
            </div>
          )}

          {/* Front matter offset */}
          <div className="mt-5 flex items-center gap-2">
            <label htmlFor="frontMatterOffset" className="text-sm font-medium text-gray-700">
              Front matter pages
            </label>
            <input
              id="frontMatterOffset"
              type="number"
              min={0}
              value={frontMatterOffset}
              onChange={(e) => setFrontMatterOffset(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOffsetTooltip((v) => !v)}
                aria-label="What is front matter pages?"
                className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500 hover:bg-gray-200"
              >
                ?
              </button>
              {showOffsetTooltip && (
                <div className="absolute left-0 top-7 z-10 w-64 rounded-lg bg-gray-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
                  Set this if your PDF has cover pages, author notes, or
                  Roman-numeral pages before the real page 1. Example: if
                  Chapter 1 starts on the 7th physical page, set this to 6.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Splits list */}
      {fileName && (
        <div className="mt-5 flex flex-col gap-3">
          {splits.map((split) => {
            const splitError = getSplitError(split, offsetForDisplay());
            const startPhysical = physicalPageFor(split.startPage);
            const endPhysical = physicalPageFor(split.endPage);

            return (
              <div key={split.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={split.name}
                    onChange={(e) => updateSplit(split.id, "name", e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="File name"
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeSplit(split.id)}
                    aria-label="Remove split"
                    className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <TrashIcon />
                  </button>
                </div>

                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={split.startPage}
                        onChange={(e) => updateSplit(split.id, "startPage", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="Start"
                        className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => openPreview(split.startPage)}
                        disabled={!pdfjsDoc}
                        aria-label="Preview start page"
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    {startPhysical !== null && (
                      <span className="text-[11px] text-gray-400">→ physical page {startPhysical}</span>
                    )}
                  </div>

                  <span className="self-center pt-2 text-sm text-gray-400">to</span>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={split.endPage}
                        onChange={(e) => updateSplit(split.id, "endPage", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        placeholder="End"
                        className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => openPreview(split.endPage)}
                        disabled={!pdfjsDoc}
                        aria-label="Preview end page"
                        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    {endPhysical !== null && (
                      <span className="text-[11px] text-gray-400">→ physical page {endPhysical}</span>
                    )}
                  </div>
                </div>

                {splitError && <p className="text-xs text-red-500">{splitError}</p>}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addSplit}
            className="self-start rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            + Add Split
          </button>
        </div>
      )}

      {/* Error / success messages */}
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {successMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-600">{successMessage}</p>
      )}

      {/* Main action */}
      {fileName && (
        <button
          type="button"
          onClick={handleSplitAndDownload}
          disabled={isProcessing || splits.length === 0}
          className="mt-6 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isProcessing ? "Splitting…" : "Split & Download All"}
        </button>
      )}

      {previewRequest && pdfjsDoc && (
        <PagePreviewModal
          pdfDoc={pdfjsDoc}
          physicalPage={previewRequest.physicalPage}
          totalPages={pageCount}
          onNavigate={(physicalPage) => setPreviewRequest({ physicalPage })}
          onClose={() => setPreviewRequest(null)}
        />
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
