import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	forgetKey,
	hasKey,
	keyPersistence,
	loadKey,
	normalizeKey,
	redactKey,
	saveKey,
} from "../../src/pets/keyStore.js";
import {
	endpointAllowed,
	endpointFor,
	parsePetSettings,
} from "../../src/pets/petConfig.js";

class FakeStorage {
	map = new Map<string, string>();
	getItem(k: string) {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.map.set(k, v);
	}
	removeItem(k: string) {
		this.map.delete(k);
	}
}

let session: FakeStorage;
let local: FakeStorage;

beforeEach(() => {
	session = new FakeStorage();
	local = new FakeStorage();
	Object.assign(globalThis, { sessionStorage: session, localStorage: local });
	forgetKey("openai");
	forgetKey("anthropic");
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "sessionStorage");
	Reflect.deleteProperty(globalThis, "localStorage");
});

describe("keyStore", () => {
	it("defaults to session storage; 'device' moves the key to localStorage and out of the session", () => {
		saveKey("openai", "  fake-key-1234\n", "session");
		expect(loadKey("openai")).toBe("fake-key-1234");
		expect(session.map.get("cabn:pet-key:openai")).toBe("fake-key-1234");
		expect(local.map.size).toBe(0);
		expect(keyPersistence("openai")).toBe("session");

		saveKey("openai", "fake-key-1234", "device");
		expect(local.map.get("cabn:pet-key:openai")).toBe("fake-key-1234");
		expect(session.map.size).toBe(0);
		expect(keyPersistence("openai")).toBe("device");
	});

	it("forget clears memory, sessionStorage and localStorage", () => {
		saveKey("openai", "fake-key-1234", "device");
		saveKey("anthropic", "other-fake", "session");
		forgetKey("openai");
		expect(hasKey("openai")).toBe(false);
		expect(local.map.size).toBe(0);
		expect(hasKey("anthropic")).toBe(true);
	});

	it("keeps working in memory when storage throws", () => {
		Object.defineProperty(globalThis, "sessionStorage", {
			configurable: true,
			get() {
				throw new Error("blocked");
			},
		});
		saveKey("openai", "fake-key-mem", "session");
		expect(loadKey("openai")).toBe("fake-key-mem");
	});

	it("normalizes pasted whitespace and redacts keys (and long slices of them) from text", () => {
		expect(normalizeKey(" ab\ncd \t")).toBe("abcd");
		const key = "fake-0123456789abcdefghij";
		expect(redactKey(`bad key ${key} here`, key)).not.toContain(key);
		expect(redactKey(`echo ${key.slice(3, 20)}`, key)).not.toContain(
			key.slice(6, 18),
		);
		expect(redactKey("nothing", null)).toBe("nothing");
	});
});

describe("pet settings", () => {
	it("drops unknown providers and endpoints that aren't the provider's own", () => {
		const settings = parsePetSettings({
			provider: "evilcorp",
			models: { openai: "gpt-6-luna", nope: "x" },
			endpoints: {
				openai: "https://attacker.example/v1",
				qwen: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
				ollama: "http://127.0.0.1:11434",
			},
		});
		expect(settings.provider).toBeNull();
		expect(settings.models).toEqual({ openai: "gpt-6-luna" });
		expect(endpointFor(settings, "openai")).toBe("https://api.openai.com/v1");
		expect(endpointFor(settings, "qwen")).toBe(
			"https://dashscope-us.aliyuncs.com/compatible-mode/v1",
		);
		expect(endpointFor(settings, "ollama")).toBe("http://127.0.0.1:11434");
	});

	it("Ollama's editable endpoint must be plain http(s) without credentials", () => {
		expect(endpointAllowed("ollama", "http://localhost:11434")).toBe(true);
		expect(endpointAllowed("ollama", "javascript:alert(1)")).toBe(false);
		expect(endpointAllowed("ollama", "http://user:pw@localhost:11434")).toBe(
			false,
		);
		expect(endpointAllowed("anthropic", "https://api.anthropic.com")).toBe(
			true,
		);
		expect(endpointAllowed("anthropic", "https://evil.example")).toBe(false);
	});

	it("garbage parses to empty settings", () => {
		expect(parsePetSettings("nope")).toEqual({
			provider: null,
			models: {},
			endpoints: {},
		});
	});
});
