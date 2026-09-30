import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { CabnStore } from "../bridge/store.js";
import { GUIDE_NPC_NAME } from "../systems/guideContent.js";
import {
	LOADING_TIP_ROTATE_MS,
	loadingTips,
} from "../systems/loadingScreen.js";
import { prefersReducedMotion } from "../systems/reducedMotion.js";
import { LoadingSwirl } from "./LoadingSwirl.js";
import { useCabnStore } from "./useCabnStore.js";
import { useLoadingWhile } from "./useLoadingWhile.js";

/** Pixel steps for the bar, so it fills in visible blocks rather than a smooth slide. */
const BAR_STEPS = 20;

/**
 * The loading panel every scene switch and slow lazy load shares
 * (systems/loadingScreen.ts decides when it shows). It sits above
 * SceneTransitionOverlay, which holds its cover while a load is open, so the
 * panel appears on the transition's black and the transition reveals the new
 * scene once the panel has gone. Colours come from the pixel theme root, so
 * day, night and a layer's own tokens apply without anything here.
 */
export function LoadingOverlay({
	store,
}: {
	store: StoreApi<CabnStore>;
}): React.ReactElement {
	const loading = useCabnStore(store, (s) => s.loading);
	const [reducedMotion] = useState(prefersReducedMotion);
	const tips = useMemo(() => loadingTips(), []);
	const [tipIndex, setTipIndex] = useState(0);
	const firstButton = useRef<HTMLButtonElement>(null);
	const showing = loading.visible && !loading.error;

	useEffect(() => {
		if (!showing || tips.length === 0) return;
		setTipIndex(Math.floor(Math.random() * tips.length));
		const interval = setInterval(
			() => setTipIndex((i) => (i + 1) % tips.length),
			LOADING_TIP_ROTATE_MS,
		);
		return () => clearInterval(interval);
	}, [showing, tips]);

	useEffect(() => {
		if (loading.error) firstButton.current?.focus();
	}, [loading.error]);

	const status = loading.error
		? loading.error.message
		: loading.visible
			? loading.label
			: "";

	return (
		<>
			{/* Always mounted, so a screen reader hears the label when it changes rather than missing a region that appeared with it. */}
			<div role="status" aria-live="polite" className="cabn-sr-only">
				{status}
			</div>
			{loading.active && !loading.visible && (
				// Invisible until the delay passes, but clicks still shouldn't reach a scene that is on its way out.
				<div className="cabn-loading-shield" data-testid="loading-shield" />
			)}
			{loading.visible && (
				<div
					className="cabn-loading-overlay"
					data-testid="loading-overlay"
					data-reduced-motion={reducedMotion ? "" : undefined}
				>
					{loading.error ? (
						<div
							className="cabn-panel cabn-loading-panel"
							data-testid="loading-error"
							role="alertdialog"
							aria-labelledby="cabn-loading-error-title"
						>
							<p id="cabn-loading-error-title" className="cabn-loading-label">
								{loading.error.message}
							</p>
							{loading.error.detail && (
								<p className="cabn-loading-detail">{loading.error.detail}</p>
							)}
							<div className="cabn-loading-actions">
								{loading.error.back && (
									<button
										ref={firstButton}
										type="button"
										className="cabn-btn neutral"
										onClick={loading.error.back}
									>
										{loading.error.backLabel ?? "Back to shelf"}
									</button>
								)}
								{loading.error.retry && (
									<button
										ref={loading.error.back ? undefined : firstButton}
										type="button"
										className="cabn-btn confirm"
										onClick={loading.error.retry}
									>
										Try again
									</button>
								)}
							</div>
						</div>
					) : (
						<div
							className="cabn-panel cabn-loading-panel"
							data-testid="loading-panel"
						>
							<div className="cabn-loading-swirl">
								<LoadingSwirl
									seedKey={loading.label}
									size={96}
									testId="loading-swirl"
								/>
							</div>
							<p className="cabn-loading-label" data-testid="loading-label">
								{loading.label}
							</p>
							{loading.detail && (
								<p className="cabn-loading-detail">{loading.detail}</p>
							)}
							{loading.progress !== null && (
								<LoadingBar progress={loading.progress} />
							)}
							{tips.length > 0 && (
								<p className="cabn-loading-tip" data-testid="loading-tip">
									<span className="cabn-loading-tip-name">
										{GUIDE_NPC_NAME}'s tip
									</span>
									{tips[tipIndex % tips.length]}
								</p>
							)}
						</div>
					)}
				</div>
			)}
		</>
	);
}

function LoadingBar({ progress }: { progress: number }): React.ReactElement {
	const steps = Math.round(progress * BAR_STEPS);
	return (
		<div
			className="cabn-loading-bar"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
			data-testid="loading-bar"
		>
			<div
				className="cabn-loading-bar-fill"
				style={{ width: `${(steps / BAR_STEPS) * 100}%` }}
			/>
		</div>
	);
}

/** A Suspense fallback that draws nothing itself and shows the loading panel only if the lazy chunk is slow. */
export function LoadingFallback({
	store,
	label,
}: {
	store: StoreApi<CabnStore>;
	label: string;
}): null {
	useLoadingWhile(store, true, label);
	return null;
}
