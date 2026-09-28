import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus, CabnEvents } from "../bridge/events.js";
import type { CabnStore, NearWebPortal } from "../bridge/store.js";
import { openPortalLink, shouldMountEmbed } from "../systems/embedGuard.js";
import {
	MINI_PAGE_VIRTUAL_WIDTH,
	miniPageScale,
	type Rect,
	sameRect,
} from "../systems/portalFx.js";
import { PortalEmbed } from "./PortalEmbed.js";
import { SPARK_COLORS, usePortalFxStyles } from "./portalFxStyles.js";
import { useCabnStore } from "./useCabnStore.js";

export interface PortalLivePageProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

/**
 * The live mini-page laid over the nearest url arch's opening
 * (store.nearWebPortal, set by WorldScene within PORTAL_APPROACH_RADIUS).
 * It *is* PortalEmbed — composed, not copied — so the iframe carries exactly
 * PortalEmbed's sandbox/referrerPolicy/allow/loading attributes and goes
 * through embedGuard; this component only positions, scales and dims it.
 *
 * At most one exists: the store holds a single portal, and the component is
 * keyed by its id, so walking from one url arch to the next unmounts the
 * first iframe before the second mounts. Leaving range nulls the store
 * field and the iframe is unmounted, never merely hidden.
 *
 * The page is laid out at MINI_PAGE_VIRTUAL_WIDTH and CSS-scaled into the
 * opening, so it reads as a thumbnail of a real page rather than a site
 * squeezed into a 90px viewport. A transparent button covers it: clicking
 * opens the url in the player's browser (embedGuard#openPortalLink), which
 * also means the framed page never receives pointer input from here.
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

	if (!web || mode !== "world" || worldBase === null) return null;
	if (!shouldMountEmbed(web.url, web.allowedEmbedOrigins, true)) return null;

	return (
		<LivePage
			key={web.portalId}
			web={web}
			bus={bus}
			worldBase={worldBase}
			night={night}
		/>
	);
}

const LOADING_MOTES = 10;
const LOADER_GIVE_UP_MS = 6500;

function LivePage({
	web,
	bus,
	worldBase,
	night,
}: {
	web: NearWebPortal;
	bus: CabnBus;
	worldBase: string;
	night: boolean;
}): React.ReactElement {
	const rootRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLDivElement>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let last: Rect | null = null;
		let lastOccluded: boolean | null = null;
		// Imperative style writes, not state: this fires every frame the camera
		// moves, and a React re-render per frame would churn the iframe's
		// parent for nothing.
		const onRect = (e: CabnEvents["portal:web-rect"]) => {
			if (e.portalId !== web.portalId) return;
			const root = rootRef.current;
			const frame = frameRef.current;
			if (!root || !frame) return;
			if (e.occluded !== lastOccluded) {
				lastOccluded = e.occluded;
				root.dataset.occluded = String(e.occluded);
			}
			if (sameRect(last, e.rect)) return;
			last = e.rect;
			const { x, y, w, h } = e.rect;
			root.style.transform = `translate(${x}px, ${y}px)`;
			root.style.width = `${w}px`;
			root.style.height = `${h}px`;
			const scale = miniPageScale(w);
			frame.style.width = `${MINI_PAGE_VIRTUAL_WIDTH}px`;
			frame.style.height = `${scale > 0 ? h / scale : 0}px`;
			frame.style.transform = `scale(${scale})`;
			root.style.visibility = "visible";
		};
		bus.on("portal:web-rect", onRect);
		return () => bus.off("portal:web-rect", onRect);
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

	const label = web.title ?? web.url;

	return (
		<div
			ref={rootRef}
			className="cabn-live-page"
			data-testid="portal-live-page"
			data-portal-id={web.portalId}
		>
			<div ref={frameRef} className="cabn-live-page-frame">
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
			{night && <div className="cabn-live-page-night" />}
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
		</div>
	);
}
