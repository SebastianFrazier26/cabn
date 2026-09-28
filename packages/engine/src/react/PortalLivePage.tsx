import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus, CabnEvents } from "../bridge/events.js";
import type { CabnStore, NearWebPortal } from "../bridge/store.js";
import { openPortalLink, shouldMountEmbed } from "../systems/embedGuard.js";
import {
	DOCK_PAGE_LAYOUT_WIDTH,
	type DockCandidateState,
	liveSlotRect,
	MINI_PAGE_VIRTUAL_WIDTH,
	pageScale,
	type Rect,
	sameRect,
	shouldDockLivePage,
} from "../systems/portalFx.js";
import { PortalEmbed } from "./PortalEmbed.js";
import { SPARK_COLORS, usePortalFxStyles } from "./portalFxStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PortalLivePageProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/** The dock's placeholder for the docked page (PortalPreviewDock renders it; this component finds it by portal id). */
export const LIVE_SLOT_ATTR = "data-cabn-live-slot";

/**
 * The one live web page for the nearest url arch (store.nearWebPortal, set
 * by WorldScene within PORTAL_APPROACH_RADIUS). It *is* PortalEmbed —
 * composed, not copied — so the iframe carries exactly PortalEmbed's
 * sandbox/referrerPolicy/allow/loading attributes and goes through
 * embedGuard; this component only positions, scales and dims it.
 *
 * It has two placements and moves between them without ever remounting:
 * - arch: laid over the arch's opening, laid out MINI_PAGE_VIRTUAL_WIDTH
 *   wide and CSS-scaled down as a thumbnail, `inert`, with a transparent
 *   button over it that opens the url in the player's browser.
 * - dock: once the player is close enough for the dock to show this portal
 *   (shouldDockLivePage), the same element is re-positioned over the dock's
 *   slot, laid out DOCK_PAGE_LAYOUT_WIDTH wide, and made interactive
 *   (scroll, click links inside the page).
 * Moving is only ever a style change. Re-parenting the iframe (a React
 * portal into the dock) would reload the page — every browser reloads an
 * iframe that's moved in the DOM — so the placement is done with
 * transform/size and the node stays put.
 *
 * At most one exists: the store holds a single portal and the component is
 * keyed by its id; leaving range unmounts the iframe, never merely hides it.
 *
 * Keyboard: a focused cross-origin frame receives every key and this page
 * can't see them, so Esc can't be caught from inside it. The way back is
 * a click anywhere outside the page (the parent document gets focus again;
 * the pointerdown handler below also blurs the frame explicitly), and the
 * dock leaving blurs it too. While it has focus uiFocus classifies it as a
 * text owner, so the keyboard focus gate resets held keys, and a chip says
 * how to get back.
 */
export function PortalLivePage({
	store,
	bus,
}: PortalLivePageProps): React.ReactElement | null {
	usePortalFxStyles();
	const web = useCabnStore(store, (s) => s.nearWebPortal);
	const mode = useCabnStore(store, (s) => s.mode);
	const worldBase = useCabnStore(store, (s) => s.activeWorldBase);
	const night = useCabnStore(store, (s) => s.timeOfDay === "night");
	const dockWanted = useCabnStore(store, (s) =>
		shouldDockLivePage(s as DockCandidateState),
	);

	if (!web || mode !== "world" || worldBase === null) return null;
	if (!shouldMountEmbed(web.url, web.allowedEmbedOrigins, true)) return null;

	return (
		<LivePage
			key={web.portalId}
			web={web}
			bus={bus}
			worldBase={worldBase}
			night={night}
			dockWanted={dockWanted}
		/>
	);
}

const LOADING_MOTES = 10;
const LOADER_GIVE_UP_MS = 6500;

function findSlot(root: HTMLElement, portalId: string): HTMLElement | null {
	const scope = root.closest(".cabn-pixel-root") ?? document;
	for (const el of scope.querySelectorAll<HTMLElement>(`[${LIVE_SLOT_ATTR}]`)) {
		if (el.getAttribute(LIVE_SLOT_ATTR) === portalId) return el;
	}
	return null;
}

function ownFrame(root: HTMLElement | null): HTMLIFrameElement | null {
	const active = document.activeElement;
	return root && active instanceof HTMLIFrameElement && root.contains(active)
		? active
		: null;
}

function LivePage({
	web,
	bus,
	worldBase,
	night,
	dockWanted,
}: {
	web: NearWebPortal;
	bus: CabnBus;
	worldBase: string;
	night: boolean;
	dockWanted: boolean;
}): React.ReactElement {
	const rootRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLDivElement>(null);
	const [loaded, setLoaded] = useState(false);
	const [docked, setDocked] = useState(false);
	const [pageFocused, setPageFocused] = useState(false);
	const dockWantedRef = useRef(dockWanted);
	dockWantedRef.current = dockWanted;

	useEffect(() => {
		let lastArch: Rect | null = null;
		let lastOccluded = false;
		let applied: Rect | null = null;
		let appliedLayout = 0;
		let appliedOccluded: boolean | null = null;
		let isDocked = false;

		// Imperative style writes, not state: this runs every frame the camera
		// moves, and a React re-render per frame would churn the iframe's
		// parent for nothing.
		const place = (rect: Rect, layoutWidth: number, occluded: boolean) => {
			const root = rootRef.current;
			const frame = frameRef.current;
			if (!root || !frame) return;
			if (occluded !== appliedOccluded) {
				appliedOccluded = occluded;
				root.dataset.occluded = String(occluded);
			}
			if (sameRect(applied, rect) && appliedLayout === layoutWidth) return;
			applied = rect;
			appliedLayout = layoutWidth;
			const { x, y, w, h } = rect;
			root.style.transform = `translate(${x}px, ${y}px)`;
			root.style.width = `${w}px`;
			root.style.height = `${h}px`;
			const scale = pageScale(w, layoutWidth);
			frame.style.width = `${layoutWidth}px`;
			frame.style.height = `${scale > 0 ? h / scale : 0}px`;
			frame.style.transform = `scale(${scale})`;
			root.style.visibility = "visible";
		};
		const setDockedOnce = (next: boolean) => {
			if (next === isDocked) return;
			isDocked = next;
			setDocked(next);
			if (!next && lastArch)
				place(lastArch, MINI_PAGE_VIRTUAL_WIDTH, lastOccluded);
		};

		// Arch placement is applied straight from the event, which WorldScene
		// emits on the camera's FOLLOW_UPDATE — a separate rAF would run in an
		// unspecified order against Phaser's and could trail the canvas a frame.
		const onRect = (e: CabnEvents["portal:web-rect"]) => {
			if (e.portalId !== web.portalId) return;
			lastArch = e.rect;
			lastOccluded = e.occluded;
			if (!isDocked) place(e.rect, MINI_PAGE_VIRTUAL_WIDTH, e.occluded);
		};
		bus.on("portal:web-rect", onRect);

		// The dock slot moves with the dock's open animation and the viewport,
		// and nothing emits an event for either, so it's polled while wanted.
		let raf = 0;
		const tick = () => {
			raf = requestAnimationFrame(tick);
			const root = rootRef.current;
			const parent = root?.offsetParent;
			const slot =
				root && dockWantedRef.current ? findSlot(root, web.portalId) : null;
			if (!root || !slot || !parent) {
				setDockedOnce(false);
				return;
			}
			setDockedOnce(true);
			place(
				liveSlotRect(
					slot.getBoundingClientRect(),
					parent.getBoundingClientRect(),
				),
				DOCK_PAGE_LAYOUT_WIDTH,
				false,
			);
		};
		raf = requestAnimationFrame(tick);
		return () => {
			bus.off("portal:web-rect", onRect);
			cancelAnimationFrame(raf);
		};
	}, [bus, web.portalId]);

	// `load` doesn't bubble, but a capture listener on an ancestor still sees
	// it — how this wrapper learns the frame loaded without PortalEmbed
	// exposing its internal state.
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const onLoad = (e: Event) => {
			if (e.target instanceof HTMLIFrameElement) setLoaded(true);
		};
		frame.addEventListener("load", onLoad, true);
		// Past PortalEmbed's own load timeout it swaps in its fallback card,
		// which should show rather than sit under a swirl forever.
		const giveUp = setTimeout(() => setLoaded(true), LOADER_GIVE_UP_MS);
		return () => {
			frame.removeEventListener("load", onLoad, true);
			clearTimeout(giveUp);
		};
	}, []);

	useEffect(() => {
		const root = rootRef.current;
		// Focus moving into the frame shows up here only as the window losing
		// focus; activeElement settles on the iframe after the blur event.
		const onBlur = () =>
			setTimeout(() => setPageFocused(ownFrame(root) !== null), 0);
		const onFocus = () => setPageFocused(false);
		const onPointerDown = (e: PointerEvent) => {
			if (root && e.target instanceof Node && root.contains(e.target)) return;
			const frame = ownFrame(root);
			if (!frame) return;
			frame.blur();
			window.focus();
			setPageFocused(false);
		};
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", onFocus);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", onFocus);
			document.removeEventListener("pointerdown", onPointerDown, true);
			const frame = ownFrame(root);
			if (frame) {
				frame.blur();
				window.focus();
			}
		};
	}, []);

	useEffect(() => {
		if (docked) return;
		const frame = ownFrame(rootRef.current);
		if (!frame) return;
		frame.blur();
		window.focus();
		setPageFocused(false);
	}, [docked]);

	const label = web.title ?? web.url;

	return (
		<div
			ref={rootRef}
			className="cabn-live-page"
			data-testid="portal-live-page"
			data-portal-id={web.portalId}
			data-docked={String(docked)}
			data-page-focused={String(docked && pageFocused)}
		>
			{/* inert in the arch: the framed page must never take focus there
			    (Tab, or a stray click) — a focused iframe swallows every key, so
			    Enter/WASD would stop reaching the world. It still loads and
			    renders. In the dock it's interactive by design. */}
			<div ref={frameRef} className="cabn-live-page-frame" inert={!docked}>
				<PortalEmbed
					url={web.url}
					{...(web.title !== undefined ? { title: web.title } : {})}
					{...(web.fallbackImage !== undefined
						? { fallbackImage: web.fallbackImage }
						: {})}
					allowedEmbedOrigins={web.allowedEmbedOrigins}
					worldBaseUrl={worldBase}
					active
				/>
			</div>
			{night && !docked && <div className="cabn-live-page-night" />}
			{!loaded && (
				<div className="cabn-live-page-loading" aria-hidden="true">
					{Array.from({ length: LOADING_MOTES }, (_, i) => (
						<i
							// biome-ignore lint/suspicious/noArrayIndexKey: a fixed decorative set, never reordered
							key={i}
							style={
								{
									background: SPARK_COLORS[i % SPARK_COLORS.length],
									"--cabn-a": `${(i * 360) / LOADING_MOTES}deg`,
									"--cabn-r": `${8 + (i % 4) * 7}px`,
									"--cabn-d": `${1.6 + (i % 3) * 0.7}s`,
								} as React.CSSProperties
							}
						/>
					))}
				</div>
			)}
			{docked && pageFocused && (
				<div
					className="cabn-live-page-focus-chip"
					data-testid="portal-live-page-focus-chip"
				>
					The page has your keyboard — click outside it to walk again
				</div>
			)}
			{!docked && (
				<button
					type="button"
					className="cabn-live-page-open"
					data-testid="portal-live-page-open"
					// The dock's "Open in browser" button is the keyboard path; keeping
					// this out of the tab order stops Tab from landing on a moving
					// in-world surface.
					tabIndex={-1}
					aria-label={`Open ${label} in your browser`}
					title={`Open ${label} in your browser`}
					onClick={(e) => {
						// Drop focus so the next Enter goes to the world, not back to
						// this button (the same reason hotbar slots blur on click).
						e.currentTarget.blur();
						openPortalLink(web.url, web.allowedEmbedOrigins);
					}}
				>
					<span className="cabn-live-page-badge">↗ open</span>
				</button>
			)}
		</div>
	);
}
