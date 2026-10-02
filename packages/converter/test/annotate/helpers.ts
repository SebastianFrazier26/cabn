import type { PortalFile } from "@cabn/world-schema";
import type {
	AnnotateOptions,
	Annotator,
	ErrorAnnotation,
} from "../../src/annotate/types.js";
import { classify } from "../../src/classify.js";

export function fileFor(path: string): PortalFile {
	const info = classify(path);
	return {
		path,
		name: path.split("/").pop() ?? path,
		kind: info.kind,
		language: info.language,
		bytes: 0,
		binary: false,
	};
}

export function runOn(
	annotator: Annotator,
	path: string,
	content: string,
	options?: AnnotateOptions,
): ErrorAnnotation[] {
	return annotator({
		file: fileFor(path),
		content,
		worldFiles: new Set([path]),
		options,
	});
}
