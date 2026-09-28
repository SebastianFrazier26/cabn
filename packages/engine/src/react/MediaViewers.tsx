import type { AudioPreview, PdfPreview } from "@cabn/world-schema";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	loadPdf,
	loadPeaks,
	pdfViewerAvailable,
	renderPdfPage,
} from "../render/mediaSources.js";
import { resolveRelativeUrl } from "../render/resolveUrl.js";
import {
	formatBytes,
	type SealedDisplayPreview,
	sealedReasonText,
} from "../systems/archPreview.js";
import { waveformBars } from "../systems/waveform.js";

// Own stylesheet rather than more rules in pixelTheme.tsx's shared template:
// same `--cabn-*` tokens (so day/night comes for free from the enclosing
// .cabn-pixel-root), without every media change touching that file.
const STYLE_ID = "cabn-media-viewer-style";
const MEDIA_CSS = `
.cabn-media { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; color: var(--cabn-text); }
.cabn-media-stage {
	position: relative; flex: 1; min-height: 0; border-radius: 10px; overflow: hidden;
	background: var(--cabn-panel-body-alt); border: 3px solid var(--cabn-border-outer);
	box-shadow: inset 0 0 0 2px var(--cabn-border-highlight);
}
.cabn-media-stage canvas.cabn-wave { position: absolute; inset: 8px; width: calc(100% - 16px); height: calc(100% - 16px); cursor: pointer; image-rendering: pixelated; }
.cabn-media-bar { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.cabn-media-bar .cabn-media-time { font-family: var(--cabn-font-mono); color: var(--cabn-text-secondary); min-width: 84px; text-align: right; }
.cabn-media-bar input[type="range"] { flex: 1; accent-color: var(--cabn-accent-pink); }
.cabn-media-btn {
	font-family: var(--cabn-font-display); font-size: 12px; min-width: 34px; height: 30px; padding: 0 10px;
	border: 3px solid var(--cabn-border-outer); border-radius: 9px; cursor: pointer; color: #201a3d;
	background: var(--cabn-accent-yellow); box-shadow: 2px 2px 0 rgba(0,0,0,0.2);
}
.cabn-media-btn:disabled { opacity: 0.45; cursor: default; }
.cabn-media-btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: none; }
.cabn-media-note { position: absolute; font-size: 16px; color: var(--cabn-accent-pink); opacity: 0; pointer-events: none; }
@keyframes cabn-note-rise { 0% { opacity: 0; transform: translateY(0); } 20% { opacity: 0.9; } 100% { opacity: 0; transform: translateY(-40px) rotate(12deg); } }
@media (prefers-reduced-motion: no-preference) {
	.cabn-media.playing .cabn-media-note { animation: cabn-note-rise 2.4s ease-out infinite; }
}
.cabn-pdf-scroll { position: absolute; inset: 0; overflow: auto; display: flex; justify-content: center; padding: 10px; }
.cabn-pdf-scroll canvas { background: #fff; box-shadow: 4px 4px 0 rgba(0,0,0,0.25); border: 2px solid var(--cabn-border-outer); height: auto; }
.cabn-media-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; font-size: 12px; color: var(--cabn-text-secondary); }
.cabn-table-scroll { position: absolute; inset: 0; overflow: auto; }
.cabn-table { border-collapse: separate; border-spacing: 0; font-family: var(--cabn-font-mono); font-size: 11px; min-width: 100%; }
.cabn-table th, .cabn-table td { padding: 4px 8px; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; text-align: left; border-bottom: 1px solid var(--cabn-inset-tint); }
.cabn-table th { position: sticky; top: 0; z-index: 1; background: var(--cabn-border-outer); color: #fff; font-family: var(--cabn-font-display); font-weight: normal; }
.cabn-table tr:nth-child(even) td { background: var(--cabn-inset-tint); }
.cabn-table td.cabn-row-num { color: var(--cabn-text-secondary); text-align: right; user-select: none; }
.cabn-sealed-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: 100%; text-align: center; }
.cabn-sealed-card .cabn-sealed-name { font-size: 13px; word-break: break-all; }
.cabn-sealed-card .cabn-sealed-facts { font-size: 11px; color: var(--cabn-text-secondary); }
`;

function ensureMediaStyle(): void {
	if (typeof document === "undefined" || document.getElementById(STYLE_ID))
		return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = MEDIA_CSS;
	document.head.appendChild(style);
}

function useMediaStyle(): void {
	useEffect(ensureMediaStyle, []);
}

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function cssVar(el: Element, name: string, fallback: string): string {
	return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

export interface AudioPlayerProps {
	preview: AudioPreview;
	worldBaseUrl: string;
}

/**
 * Waveform (peaks decoded in the browser, see mediaSources.loadPeaks) plus a
 * plain <audio> element driven by our own play/pause/seek controls — the
 * element does the actual playback, so codecs, buffering and the autoplay
 * rules are the browser's. Nothing plays until the player clicks play, and
 * unmounting (walking away, Esc) removes the element, which stops it.
 */
export function AudioPlayer({
	preview,
	worldBaseUrl,
}: AudioPlayerProps): React.ReactElement {
	useMediaStyle();
	const url = resolveRelativeUrl(worldBaseUrl, preview.asset);
	const audioRef = useRef<HTMLAudioElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [peaks, setPeaks] = useState<number[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [playing, setPlaying] = useState(false);
	const [time, setTime] = useState(0);
	const [duration, setDuration] = useState(0);

	useEffect(() => {
		let cancelled = false;
		loadPeaks(url).then(
			(p) => !cancelled && setPeaks(p),
			() => !cancelled && setFailed(true),
		);
		return () => {
			cancelled = true;
		};
	}, [url]);

	const progress = duration > 0 ? time / duration : 0;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !peaks) return;
		const rect = canvas.getBoundingClientRect();
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(rect.width * ratio));
		canvas.height = Math.max(1, Math.round(rect.height * ratio));
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, rect.width, rect.height);
		const played = cssVar(canvas, "--cabn-accent-pink", "#ef5fa0");
		const idle = cssVar(canvas, "--cabn-accent-violet", "#8a6fd6");
		for (const bar of waveformBars(
			peaks,
			{ x: 0, y: 0, w: rect.width, h: rect.height },
			3,
			2,
			progress,
		)) {
			ctx.fillStyle = bar.played ? played : idle;
			ctx.fillRect(
				Math.round(bar.x),
				Math.round(bar.y),
				bar.w,
				Math.round(bar.h),
			);
		}
		const x = Math.round(progress * rect.width);
		ctx.fillStyle = cssVar(canvas, "--cabn-accent-yellow", "#ffd23f");
		ctx.fillRect(Math.min(x, rect.width - 2), 0, 2, rect.height);
	}, [peaks, progress]);

	const toggle = useCallback(() => {
		const audio = audioRef.current;
		if (!audio) return;
		if (audio.paused) audio.play().catch(() => setFailed(true));
		else audio.pause();
	}, []);

	const seekTo = useCallback(
		(fraction: number) => {
			const audio = audioRef.current;
			if (!audio || !duration) return;
			audio.currentTime = Math.min(1, Math.max(0, fraction)) * duration;
		},
		[duration],
	);

	return (
		<div
			className={`cabn-media${playing ? " playing" : ""}`}
			data-testid="cabn-audio-player"
		>
			<div className="cabn-media-stage">
				{failed && !peaks ? (
					<div className="cabn-media-center">Couldn't decode this audio.</div>
				) : peaks ? (
					<canvas
						ref={canvasRef}
						className="cabn-wave"
						onClick={(e) => {
							const r = e.currentTarget.getBoundingClientRect();
							seekTo((e.clientX - r.left) / r.width);
						}}
					/>
				) : (
					<div className="cabn-media-center">Listening to the waveform…</div>
				)}
				{[18, 46, 74].map((left, i) => (
					<span
						key={left}
						className="cabn-media-note"
						style={{
							left: `${left}%`,
							bottom: 10,
							animationDelay: `${i * 0.8}s`,
						}}
					>
						♪
					</span>
				))}
			</div>
			<div className="cabn-media-bar">
				<button
					type="button"
					className="cabn-media-btn"
					onClick={toggle}
					aria-label={playing ? "Pause" : "Play"}
				>
					{playing ? "❚❚" : "▶"}
				</button>
				<input
					type="range"
					min={0}
					max={1000}
					value={Math.round(progress * 1000)}
					aria-label="Seek"
					onChange={(e) => seekTo(Number(e.currentTarget.value) / 1000)}
				/>
				<span className="cabn-media-time">
					{formatTime(time)} / {formatTime(duration)}
				</span>
			</div>
			{/* biome-ignore lint/a11y/useMediaCaption: a file preview of arbitrary audio has no caption track to offer */}
			<audio
				ref={audioRef}
				src={url}
				preload="metadata"
				onPlay={() => setPlaying(true)}
				onPause={() => setPlaying(false)}
				onEnded={() => setPlaying(false)}
				onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
				onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
				onDurationChange={(e) => setDuration(e.currentTarget.duration)}
			/>
		</div>
	);
}

export interface PdfViewerProps {
	preview: PdfPreview;
	worldBaseUrl: string;
}

/** Paged PDF viewer: pdf.js is imported on first mount (never at engine load), and each page is rendered to a canvas sized to the panel. */
export function PdfViewer({
	preview,
	worldBaseUrl,
}: PdfViewerProps): React.ReactElement {
	useMediaStyle();
	const url = resolveRelativeUrl(worldBaseUrl, preview.asset);
	const hostRef = useRef<HTMLDivElement>(null);
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [page, setPage] = useState(1);
	const [error, setError] = useState<string | null>(
		pdfViewerAvailable() ? null : "PDF viewer isn't available in this build.",
	);

	useEffect(() => {
		if (!pdfViewerAvailable()) return;
		let cancelled = false;
		loadPdf(url).then(
			(d) => !cancelled && setDoc(d),
			() => !cancelled && setError("Couldn't open this PDF."),
		);
		return () => {
			cancelled = true;
		};
	}, [url]);

	useEffect(() => {
		const host = hostRef.current;
		if (!doc || !host) return;
		let cancelled = false;
		const width = Math.max(120, host.clientWidth - 28);
		renderPdfPage(doc, page, width, window.devicePixelRatio || 1).then(
			(canvas) => {
				if (cancelled) return;
				canvas.style.width = `${width}px`;
				host.replaceChildren(canvas);
			},
			() => !cancelled && setError("Couldn't render this page."),
		);
		return () => {
			cancelled = true;
		};
	}, [doc, page]);

	const pages = doc?.numPages ?? 0;
	return (
		<div className="cabn-media" data-testid="cabn-pdf-viewer">
			<div className="cabn-media-stage">
				{error ? (
					<div className="cabn-media-center">{error}</div>
				) : (
					<div ref={hostRef} className="cabn-pdf-scroll">
						<div className="cabn-media-center">Unrolling the scroll…</div>
					</div>
				)}
			</div>
			<div className="cabn-media-bar" style={{ justifyContent: "center" }}>
				<button
					type="button"
					className="cabn-media-btn"
					disabled={page <= 1}
					onClick={() => setPage((p) => Math.max(1, p - 1))}
					aria-label="Previous page"
				>
					◀
				</button>
				<span className="cabn-media-time" style={{ textAlign: "center" }}>
					page {pages ? page : "–"} / {pages || "–"}
				</span>
				<button
					type="button"
					className="cabn-media-btn"
					disabled={page >= pages}
					onClick={() => setPage((p) => Math.min(pages, p + 1))}
					aria-label="Next page"
				>
					▶
				</button>
				<span className="cabn-media-time">{formatBytes(preview.bytes)}</span>
			</div>
		</div>
	);
}

export interface CsvTableProps {
	rows: readonly (readonly string[])[];
	truncated: boolean;
}

/** First row is the header (the common case; a headerless file just gets its first record emphasized). Cells render as text nodes, never markup. */
export function CsvTable({
	rows,
	truncated,
}: CsvTableProps): React.ReactElement {
	useMediaStyle();
	const [header, ...body] = rows;
	const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
	const colIndexes = Array.from({ length: cols }, (_, i) => i);
	return (
		<div className="cabn-media" data-testid="cabn-csv-table">
			<div className="cabn-media-stage">
				<div className="cabn-table-scroll">
					<table className="cabn-table">
						<thead>
							<tr>
								<th>#</th>
								{colIndexes.map((c) => (
									<th key={c}>{header?.[c] ?? ""}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{body.map((row, r) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are a fixed parse result, never reordered
								<tr key={r}>
									<td className="cabn-row-num">{r + 1}</td>
									{colIndexes.map((c) => (
										<td key={c} title={row[c] ?? ""}>
											{row[c] ?? ""}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
			<div
				className="cabn-media-bar"
				style={{ justifyContent: "space-between" }}
			>
				<span>
					{body.length} row{body.length === 1 ? "" : "s"} · {cols} column
					{cols === 1 ? "" : "s"}
				</span>
				{truncated && (
					<span className="cabn-media-time">more rows not shown</span>
				)}
			</div>
		</div>
	);
}

export function SealedCard({
	preview,
}: {
	preview: SealedDisplayPreview;
}): React.ReactElement {
	useMediaStyle();
	const facts = [
		preview.bytes !== undefined ? formatBytes(preview.bytes) : undefined,
		preview.reason ? sealedReasonText(preview.reason) : undefined,
	].filter(Boolean);
	return (
		<div className="cabn-sealed-card" data-testid="cabn-sealed-card">
			<span
				style={{ fontSize: 30, color: "var(--cabn-accent-orange)" }}
				aria-hidden
			>
				▤
			</span>
			<span>Sealed — no preview for this file.</span>
			{preview.name && <span className="cabn-sealed-name">{preview.name}</span>}
			{facts.length > 0 && (
				<span className="cabn-sealed-facts">{facts.join(" · ")}</span>
			)}
		</div>
	);
}
