import { useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import { petPortraitPath } from "../assetPaths.js";
import type { CabnStore } from "../bridge/store.js";
import { testPetConnection } from "../pets/connection.js";
import type { PetErrorMessage } from "../pets/errors.js";
import {
	forgetKey,
	type KeyPersistence,
	keyPersistence,
	loadKey,
	normalizeKey,
	saveKey,
} from "../pets/keyStore.js";
import {
	activePetFor,
	endpointAllowed,
	endpointFor,
	loadPetSettings,
	modelFor,
	persistPetSettings,
} from "../pets/petConfig.js";
import {
	PET_PROVIDER_IDS,
	PET_PROVIDERS,
	type PetProviderId,
} from "../pets/providers.js";
import { useCabnStore } from "./useCabnStore.js";

interface Status {
	text: string;
	error?: boolean;
	link?: PetErrorMessage["link"];
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/**
 * Choose a provider (and so a pet), paste a key, pick a model, test, forget.
 * The key field is a password input that's emptied as soon as the key is
 * saved; a saved key is never read back into the page, only reported as
 * saved and where.
 */
export function PetSetupPanel({
	store,
}: {
	store: StoreApi<CabnStore>;
}): React.ReactElement {
	const activeProvider = useCabnStore(store, (s) => s.petProvider);
	const [settings, setSettings] = useState(loadPetSettings);
	const [selected, setSelected] = useState<PetProviderId>(
		activeProvider ?? settings.provider ?? "anthropic",
	);
	const provider = PET_PROVIDERS[selected];
	const [keyDraft, setKeyDraft] = useState("");
	const [stored, setStored] = useState<KeyPersistence | null>(() =>
		keyPersistence(selected),
	);
	const [remember, setRemember] = useState(stored === "device");
	const [model, setModel] = useState(() => modelFor(settings, selected));
	const [endpoint, setEndpoint] = useState(() =>
		endpointFor(settings, selected),
	);
	const [localModels, setLocalModels] = useState<string[] | null>(null);
	const [status, setStatus] = useState<Status | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		const current = loadPetSettings();
		const persisted = keyPersistence(selected);
		setStored(persisted);
		setRemember(persisted === "device");
		setModel(modelFor(current, selected));
		setEndpoint(endpointFor(current, selected));
		setKeyDraft("");
		setLocalModels(null);
		setStatus(null);
	}, [selected]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			store.getState().setPetPanelOpen(false);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);

	const modelOptions = useMemo(() => {
		const ids = localModels ?? provider.models.map((m) => m.id);
		return ids.includes(model) ? ids : [model, ...ids];
	}, [localModels, provider, model]);

	const endpointValid = endpointAllowed(selected, endpoint);

	const persistChoice = (nextProvider: PetProviderId | null) => {
		const next = {
			provider: nextProvider,
			models: {
				...settings.models,
				[selected]: model.trim() || provider.models[0]?.id,
			},
			endpoints: endpointValid
				? { ...settings.endpoints, [selected]: endpoint }
				: settings.endpoints,
		};
		setSettings(next);
		persistPetSettings(next);
	};

	const summon = () => {
		if (!endpointValid) {
			setStatus({
				text: "That address isn't a plain http(s) URL.",
				error: true,
			});
			return;
		}
		if (provider.needsKey) {
			const draft = normalizeKey(keyDraft);
			if (draft) {
				saveKey(selected, draft, remember ? "device" : "session");
				setKeyDraft("");
			} else if (!loadKey(selected)) {
				setStatus({
					text: `Paste your ${provider.label} key first.`,
					error: true,
				});
				return;
			}
			setStored(keyPersistence(selected));
		}
		persistChoice(selected);
		store.getState().setPetProvider(activePetFor(selected));
		setStatus({
			text: `${provider.sound}! ${provider.petName} is following you now.`,
		});
	};

	const changeRemember = (next: boolean) => {
		setRemember(next);
		const existing = loadKey(selected);
		if (existing && stored) {
			saveKey(selected, existing, next ? "device" : "session");
			setStored(keyPersistence(selected));
		}
	};

	const test = async () => {
		if (!endpointValid) {
			setStatus({
				text: "That address isn't a plain http(s) URL.",
				error: true,
			});
			return;
		}
		const draft = normalizeKey(keyDraft);
		const apiKey = provider.needsKey ? draft || loadKey(selected) : null;
		if (provider.needsKey && !apiKey) {
			setStatus({
				text: `Paste your ${provider.label} key first.`,
				error: true,
			});
			return;
		}
		setBusy(true);
		setStatus({ text: "Casting a tiny test spell…" });
		try {
			const result = await testPetConnection(selected, {
				apiKey,
				model: model.trim(),
				endpoint,
				fetch: (input, init) => globalThis.fetch(input, init),
				pageOrigin:
					typeof location === "undefined" ? undefined : location.origin,
			});
			if (result.ok) {
				if (result.models) {
					setLocalModels(result.models);
					if (result.models.length > 0 && !result.models.includes(model))
						setModel(result.models[0] ?? model);
				}
				setStatus({ text: result.reply });
			} else {
				setStatus({
					text: result.message.text,
					error: true,
					link: result.message.link,
				});
			}
		} finally {
			setBusy(false);
		}
	};

	const forget = () => {
		forgetKey(selected);
		setKeyDraft("");
		setStored(null);
		setRemember(false);
		if (store.getState().petProvider === selected)
			store.getState().setPetProvider(null);
		setStatus({ text: `Forgot the ${provider.label} key on this browser.` });
	};

	const sendHome = () => {
		persistChoice(null);
		store.getState().setPetProvider(null);
		setStatus({
			text: `${provider.petName} went home. Your key (if any) is still saved until you forget it.`,
		});
	};

	return (
		<div className="cabn-pet-backdrop">
			<div
				className="cabn-panel cabn-pet-panel"
				role="dialog"
				aria-modal="true"
				aria-label="AI pet"
				data-testid="cabn-pet-panel"
			>
				<p className="cabn-panel-title">Bring an AI pet</p>
				<div className="cabn-pet-providers">
					{PET_PROVIDER_IDS.map((id) => {
						const p = PET_PROVIDERS[id];
						return (
							<button
								key={id}
								type="button"
								className="cabn-pet-provider"
								aria-pressed={selected === id}
								data-testid={`cabn-pet-provider-${id}`}
								onClick={() => setSelected(id)}
							>
								<img src={petPortraitPath(p.species)} alt="" />
								<span>
									{p.label}
									<small>{p.petName}</small>
								</span>
							</button>
						);
					})}
				</div>

				{provider.needsKey ? (
					<label className="cabn-pet-field">
						<span>
							{provider.label} API key{" "}
							{stored && (
								<em data-testid="cabn-pet-key-state">
									(saved{" "}
									{stored === "device" ? "on this device" : "for this tab"})
								</em>
							)}
						</span>
						<input
							type="password"
							data-testid="cabn-pet-key"
							autoComplete="off"
							spellCheck={false}
							placeholder={
								stored ? "saved; paste to replace" : "paste your key"
							}
							value={keyDraft}
							onChange={(e) => setKeyDraft(e.target.value)}
						/>
						<span className="cabn-pet-note">
							Get one at{" "}
							<a
								href={provider.keyConsoleUrl}
								target="_blank"
								rel="noreferrer noopener"
							>
								{hostOf(provider.keyConsoleUrl)}
							</a>
							. It stays in this browser and goes only to {hostOf(endpoint)}.
							cabn's own servers never see it.
						</span>
					</label>
				) : (
					<p className="cabn-pet-note">
						Ollama runs on your own computer and needs no key. It answers pages
						served from localhost (a cabn world running on your own machine) out
						of the box; a hosted https page also needs OLLAMA_ORIGINS set to
						this page's origin, and a browser that allows local network access
						(Safari blocks it).
					</p>
				)}

				{provider.needsKey && (
					<label className="cabn-pet-row" style={{ fontSize: 12 }}>
						<input
							type="checkbox"
							data-testid="cabn-pet-remember"
							checked={remember}
							onChange={(e) => changeRemember(e.target.checked)}
						/>
						Remember on this device
					</label>
				)}
				{provider.needsKey && remember && (
					<p
						className="cabn-pet-warning"
						data-testid="cabn-pet-remember-warning"
					>
						Remembered keys sit in this browser's local storage until you forget
						them. The key is only as safe as this browser: anyone using this
						profile, or any script that gets onto this page, could read it. Use
						a key with a spending limit.
					</p>
				)}

				{(provider.endpoints.length > 1 || provider.endpointEditable) && (
					<div className="cabn-pet-field">
						<span>
							{provider.endpointEditable ? "Ollama address" : "Region"}
						</span>
						{provider.endpointEditable ? (
							<input
								type="text"
								aria-label="Ollama address"
								data-testid="cabn-pet-endpoint"
								value={endpoint}
								spellCheck={false}
								onChange={(e) =>
									setEndpoint(e.target.value.trim().replace(/\/+$/, ""))
								}
							/>
						) : (
							<select
								aria-label="Region"
								value={endpoint}
								onChange={(e) => setEndpoint(e.target.value)}
							>
								{provider.endpoints.map((e) => (
									<option key={e.id} value={e.url}>
										{e.label}
									</option>
								))}
							</select>
						)}
					</div>
				)}

				<div className="cabn-pet-field">
					<span>Model</span>
					{provider.modelEditable && !localModels ? (
						<input
							type="text"
							aria-label="Model"
							data-testid="cabn-pet-model"
							value={model}
							spellCheck={false}
							onChange={(e) => setModel(e.target.value)}
						/>
					) : (
						<select
							aria-label="Model"
							data-testid="cabn-pet-model"
							value={model}
							onChange={(e) => setModel(e.target.value)}
						>
							{modelOptions.map((id) => (
								<option key={id} value={id}>
									{provider.models.find((m) => m.id === id)?.label ?? id}
								</option>
							))}
						</select>
					)}
				</div>

				<p
					className={`cabn-pet-status${status?.error ? " error" : ""}`}
					data-testid="cabn-pet-status"
					role="status"
				>
					{status?.text}
					{status?.link && (
						<>
							{" "}
							<a
								href={status.link.href}
								target="_blank"
								rel="noreferrer noopener"
							>
								{status.link.label}
							</a>
						</>
					)}
				</p>

				<div className="cabn-pet-row">
					<button
						type="button"
						className="cabn-btn confirm"
						data-testid="cabn-pet-save"
						onClick={summon}
					>
						{activeProvider === selected ? "Save" : "Summon pet"}
					</button>
					<button
						type="button"
						className="cabn-btn neutral"
						data-testid="cabn-pet-test"
						disabled={busy}
						onClick={test}
					>
						Test connection
					</button>
					{provider.needsKey && (
						<button
							type="button"
							className="cabn-btn cancel"
							data-testid="cabn-pet-forget"
							onClick={forget}
						>
							Forget key
						</button>
					)}
					{activeProvider === selected && (
						<button
							type="button"
							className="cabn-btn cancel"
							onClick={sendHome}
						>
							Send pet home
						</button>
					)}
					<span style={{ flex: 1 }} />
					<button
						type="button"
						className="cabn-btn neutral"
						data-testid="cabn-pet-close"
						onClick={() => store.getState().setPetPanelOpen(false)}
					>
						Close (Esc)
					</button>
				</div>
			</div>
		</div>
	);
}
