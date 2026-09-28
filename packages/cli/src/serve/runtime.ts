import { extname } from "node:path";
import { PYTHON_TRACER_SOURCE } from "./pyTracer.js";

export interface RuntimeConfig {
	/** True for python: the exec runner injects PYTHON_TRACER_SOURCE and swaps `command`/`buildArgs` for the tracer wrapper instead of running the file directly. */
	traced: boolean;
	command: string;
	buildArgs: (absoluteFilePath: string) => string[];
}

// Extension -> interpreter, nothing else — never derived from client input
// beyond "which of these four extensions does the path end in", so there's
// no way for a request to smuggle an arbitrary command. See CHANGELOG for why
// each interpreter is what it is (Node 22's own `--experimental-strip-types`
// covers .ts without a bundler).
const RUNTIME_BY_EXT: Readonly<Record<string, RuntimeConfig>> = {
	".py": {
		traced: true,
		command: "python3",
		buildArgs: (file) => ["-c", PYTHON_TRACER_SOURCE, file],
	},
	".js": {
		traced: false,
		command: "node",
		buildArgs: (file) => [file],
	},
	".mjs": {
		traced: false,
		command: "node",
		buildArgs: (file) => [file],
	},
	".ts": {
		traced: false,
		command: "node",
		buildArgs: (file) => ["--experimental-strip-types", file],
	},
};

export function runtimeForPath(
	absoluteFilePath: string,
): RuntimeConfig | undefined {
	return RUNTIME_BY_EXT[extname(absoluteFilePath).toLowerCase()];
}

export function isRunnableExtension(absoluteFilePath: string): boolean {
	return runtimeForPath(absoluteFilePath) !== undefined;
}
