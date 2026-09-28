import { sniffMediaFormat } from "@cabn/converter/browser";
import { MEDIA_MAX_FILE_BYTES_LIMIT } from "@cabn/world-schema";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { reducePeaks } from "../systems/waveform.js";

/**
 * Browser-side loaders for media previews, shared by the in-arch painter
 * (render/archPreviews.ts) and the dock/file-view viewers (react/
 * MediaViewers.tsx). Every fetch re-checks what the converter already
 * checked — size under the hard ceiling, magic bytes match the expected
 * format — because a bundle is just files on a host, and a tampered one
 * shouldn't get arbitrary bytes into pdf.js or the audio decoder.
 */

export interface MediaConfig {
	/**
	 * URL of pdf.js's worker script (pdfjs-dist/build/pdf.worker.min.mjs),
	 * served by the host app itself — cabn never loads it from a CDN. Unset
	 * means PDF previews show a "viewer unavailable" notice instead.
	 */
	pdfWorkerUrl?: string;
}

let config: MediaConfig = {};

export function configureMedia(next: MediaConfig): void {
	config = { ...config, ...next };
}

export function pdfViewerAvailable(): boolean {
	return config.pdfWorkerUrl !== undefined;
}

const byteCache = new Map<string, Promise<Uint8Array>>();

export async function fetchMediaBytes(
	url: string,
	expect: "pdf" | "audio",
): Promise<Uint8Array> {
	const key = `${expect}:${url}`;
	let pending = byteCache.get(key);
	if (!pending) {
		pending = (async () => {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`media fetch failed (${res.status})`);
			const declared = Number(res.headers.get("content-length") ?? "0");
			if (declared > MEDIA_MAX_FILE_BYTES_LIMIT)
				throw new Error("media file over the size ceiling");
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.length > MEDIA_MAX_FILE_BYTES_LIMIT)
				throw new Error("media file over the size ceiling");
			const format = sniffMediaFormat(bytes);
			const ok =
				expect === "pdf"
					? format === "pdf"
					: format === "mp3" || format === "wav" || format === "ogg";
			if (!ok) throw new Error("media file content doesn't match its type");
			return bytes;
		})();
		byteCache.set(key, pending);
		// A transient failure shouldn't poison the cache for the session.
		pending.catch(() => byteCache.delete(key));
	}
	return pending;
}

// Decoding at a low sample rate keeps a 5 MB mp3's PCM small (peaks don't
// need audio fidelity). OfflineAudioContext, not AudioContext: decoding
// through it needs no user gesture and never trips Chrome's autoplay warning.
const PEAK_DECODE_SAMPLE_RATE = 8000;
export const PEAK_BUCKETS = 240;
const peakCache = new Map<string, Promise<number[]>>();

export function loadPeaks(url: string): Promise<number[]> {
	let pending = peakCache.get(url);
	if (!pending) {
		pending = (async () => {
			const bytes = await fetchMediaBytes(url, "audio");
			const ctx = new OfflineAudioContext(1, 1, PEAK_DECODE_SAMPLE_RATE);
			// decodeAudioData detaches the buffer it's given — hand it a copy so
			// the cached bytes stay usable.
			const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
			const channels: Float32Array[] = [];
			for (let c = 0; c < buffer.numberOfChannels; c++)
				channels.push(buffer.getChannelData(c));
			return reducePeaks(channels, PEAK_BUCKETS);
		})();
		peakCache.set(url, pending);
		pending.catch(() => peakCache.delete(url));
	}
	return pending;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** pdf.js (~450 KB) only ever loads when a PDF preview is actually on screen. */
function loadPdfJs(): Promise<PdfJs> {
	if (!pdfjsPromise) {
		pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
			if (config.pdfWorkerUrl)
				pdfjs.GlobalWorkerOptions.workerSrc = config.pdfWorkerUrl;
			return pdfjs;
		});
		pdfjsPromise.catch(() => {
			pdfjsPromise = null;
		});
	}
	return pdfjsPromise;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
	if (!pdfViewerAvailable())
		return Promise.reject(new Error("no pdf.js worker configured"));
	let pending = docCache.get(url);
	if (!pending) {
		pending = (async () => {
			const [pdfjs, bytes] = await Promise.all([
				loadPdfJs(),
				fetchMediaBytes(url, "pdf"),
			]);
			// isEvalSupported is gone from 6.x (it no longer has an eval path at
			// all — no `new Function` anywhere in the pinned build); still passed
			// so a downgrade to a version that has one can't silently re-enable
			// it. No cMap/standard-font/wasm URLs: nothing is fetched beyond the
			// bytes we already verified, and missing ones degrade to fallbacks.
			const params = {
				data: bytes.slice(),
				isEvalSupported: false,
				enableXfa: false,
				verbosity: 0,
			};
			return pdfjs.getDocument(params).promise;
		})();
		docCache.set(url, pending);
		pending.catch(() => docCache.delete(url));
	}
	return pending;
}

/** Renders one page to a fresh canvas `cssWidth` CSS px wide at `pixelRatio` device px per CSS px. */
export async function renderPdfPage(
	doc: PDFDocumentProxy,
	pageNumber: number,
	cssWidth: number,
	pixelRatio = 1,
): Promise<HTMLCanvasElement> {
	const page = await doc.getPage(pageNumber);
	const base = page.getViewport({ scale: 1 });
	const scale = (cssWidth / base.width) * pixelRatio;
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.floor(viewport.width));
	canvas.height = Math.max(1, Math.floor(viewport.height));
	await page.render({ canvas, viewport }).promise;
	page.cleanup();
	return canvas;
}

const firstPageCache = new Map<string, Promise<HTMLCanvasElement>>();

/** Page 1 at a fixed size for in-arch use — cached per URL so repainting an arch never re-renders the PDF. */
export function loadPdfFirstPage(
	url: string,
	cssWidth: number,
): Promise<HTMLCanvasElement> {
	const key = `${cssWidth}:${url}`;
	let pending = firstPageCache.get(key);
	if (!pending) {
		pending = loadPdf(url).then((doc) => renderPdfPage(doc, 1, cssWidth, 2));
		firstPageCache.set(key, pending);
		pending.catch(() => firstPageCache.delete(key));
	}
	return pending;
}
