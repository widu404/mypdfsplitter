import * as pdfjsLib from "pdfjs-dist";

// pdfjs-dist v6 always spins up its worker as an ES module, so the worker
// file must be served as-is (.mjs) rather than renamed to .js.
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export default pdfjsLib;
