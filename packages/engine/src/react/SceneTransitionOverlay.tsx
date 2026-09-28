import { useEffect, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnBus } from "../bridge/events.js";
import type { CabnStore } from "../bridge/store.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import {
	ENCOUNTER_FLASH_MS,
	ENCOUNTER_REVEAL_MS,
	ENCOUNTER_WIPE_MS,
	PORTAL_WIPE_MS,
	type SceneTransitionKind,
	sceneTransitionTotalMs,
} from "../systems/sceneTransition.js";

export interface SceneTransitionOverlayProps {
	store: StoreApi<CabnStore>;
	bus: CabnBus;
}

interface ActiveTransition {
	kind: SceneTransitionKind;
	token: number;
}

/**
 * A fullscreen, click-through (pointerEvents: "none" throughout) visual
 * layer for the three M10a scene transitions — chosen as a React/CSS overlay
 * rather than a Phaser camera effect or fullscreen graphics object because
 * every trigger for it is already a store/bus signal React already listens
 * to (mode transitions, shelf:enter-world/world:return-to-shelf), and two of
 * the three transitions (cabin enter/exit) span a hard `scene.start("boot")`
 * Phaser scene *replacement* — a Phaser-owned camera fade can't survive that
 * cut (the camera itself gets destroyed), where a DOM overlay sitting above
 * the canvas trivially does. Keeping all three in one place (instead of
 * splitting cabin into React and portal/encounter into Phaser) also means
 * one shared reduced-motion fallback and one shared timing source
 * (systems/sceneTransition.ts) instead of two.
 *
 * Never blocks input: this only ever renders decorative, pointerEvents:none
 * layers, and none of the three triggers below delay anything gameplay-
 * critical except the cabin fade's own deliberate pre-cut hold (see
 * ShelfScene.handleCabinEnter/WorldScene.handleReturnToShelf), which the
 * Playwright smoke test's 10s poll timeout comfortably absorbs.
 */
export function SceneTransitionOverlay({
	store,
	bus,
}: SceneTransitionOverlayProps): React.ReactElement | null {
	const [active, setActive] = useState<ActiveTransition | null>(null);
	const [reducedMotion] = useState(prefersReducedMotion);

	useEffect(() => {
		let token = 0;
		const play = (kind: SceneTransitionKind) => {
			token += 1;
			setActive({ kind, token });
		};

		let prevMode = store.getState().mode;
		const unsubscribe = store.subscribe((state) => {
			const nextMode = state.mode;
			if (prevMode === "world" && nextMode === "file") play("portal");
			else if (prevMode === "file" && nextMode === "world") play("portal");
			else if (nextMode === "encounter" && prevMode !== "encounter")
				play("encounter");
			prevMode = nextMode;
		});

		const onEnterWorld = () => play("cabin");
		const onReturnToShelf = () => play("cabin");
		bus.on("shelf:enter-world", onEnterWorld);
		bus.on("world:return-to-shelf", onReturnToShelf);

		return () => {
			unsubscribe();
			bus.off("shelf:enter-world", onEnterWorld);
			bus.off("world:return-to-shelf", onReturnToShelf);
		};
	}, [store, bus]);

	useEffect(() => {
		if (!active) return;
		const timeout = setTimeout(
			() =>
				setActive((current) =>
					current?.token === active.token ? null : current,
				),
			sceneTransitionTotalMs(active.kind, reducedMotion),
		);
		return () => clearTimeout(timeout);
	}, [active, reducedMotion]);

	if (!active) return null;

	const wrapperStyle: React.CSSProperties = {
		position: "absolute",
		inset: 0,
		zIndex: 20,
		pointerEvents: "none",
		overflow: "hidden",
	};

	// Every kind degrades to the same short flat fade under reduced motion —
	// bars/wipes are the motion prefers-reduced-motion exists to suppress; a
	// brief opacity change is the one thing every transition still needs to
	// register as *a* transition (mode/scene changes shouldn't look instant
	// and unannounced) without moving anything across the screen.
	if (reducedMotion) {
		return (
			<div style={wrapperStyle}>
				<div
					key={active.token}
					className="cabn-transition-fade play"
					style={{
						animationDuration: `${sceneTransitionTotalMs(active.kind, true)}ms`,
					}}
				/>
			</div>
		);
	}

	if (active.kind === "cabin") {
		return (
			<div style={wrapperStyle}>
				<div
					key={active.token}
					className="cabn-transition-fade play"
					style={{
						animationDuration: `${sceneTransitionTotalMs("cabin", false)}ms`,
					}}
				/>
			</div>
		);
	}

	if (active.kind === "encounter") {
		return (
			<div style={wrapperStyle}>
				<div key={active.token} className="cabn-transition-flash play" />
				<div
					key={`${active.token}-bars`}
					className="cabn-transition-bars play"
					style={
						{
							"--cabn-wipe-ms": `${ENCOUNTER_WIPE_MS}ms`,
							"--cabn-reveal-ms": `${ENCOUNTER_REVEAL_MS}ms`,
						} as React.CSSProperties
					}
				>
					{/* animationDelay overrides the class's own baked-in (flash-unaware) delays with ones offset by the flash's own duration, so close-then-open still sequences correctly after the bars start late. */}
					<div
						className="bar top"
						style={{
							animationDelay: `${ENCOUNTER_FLASH_MS}ms, ${ENCOUNTER_FLASH_MS + ENCOUNTER_WIPE_MS}ms`,
						}}
					/>
					<div
						className="bar bottom"
						style={{
							animationDelay: `${ENCOUNTER_FLASH_MS}ms, ${ENCOUNTER_FLASH_MS + ENCOUNTER_WIPE_MS}ms`,
						}}
					/>
				</div>
			</div>
		);
	}

	// active.kind === "portal": the scroll-unroll/page-turn wipe from the
	// mockup, implemented as a diagonal panel-colored bar sweeping across
	// (tf-pageturn in mockup.html) rather than a literal unrolling-scroll
	// shape — both were equally approved concepts (STYLE.md section 11); the
	// sweep is the simpler one to drive as a single CSS animation.
	return (
		<div style={wrapperStyle}>
			<div
				key={active.token}
				className="cabn-transition-wipe play"
				style={
					{
						"--cabn-wipe-total-ms": `${PORTAL_WIPE_MS}ms`,
					} as React.CSSProperties
				}
			/>
		</div>
	);
}
