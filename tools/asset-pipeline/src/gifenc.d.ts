// gifenc ships no type declarations — this covers only the small surface
// portal-animation.ts actually calls (see https://github.com/mattdesl/gifenc#api).
declare module "gifenc" {
	export interface GIFEncoderWriteFrameOptions {
		palette?: number[][];
		first?: boolean;
		transparent?: boolean;
		transparentIndex?: number;
		delay?: number;
		repeat?: number;
		dispose?: number;
	}

	export interface GIFEncoderInstance {
		writeFrame(
			index: Uint8Array,
			width: number,
			height: number,
			opts?: GIFEncoderWriteFrameOptions,
		): void;
		finish(): void;
		bytes(): Uint8Array;
	}

	export function GIFEncoder(opts?: {
		auto?: boolean;
		initialCapacity?: number;
	}): GIFEncoderInstance;

	// The package ships no "exports" map and Node's CJS/ESM interop can't
	// statically detect its named exports, so `import gifenc from "gifenc"`
	// resolves to the whole exports object at runtime (verified against the
	// installed 1.0.3 build) rather than a single default value.
	const gifenc: {
		GIFEncoder: typeof GIFEncoder;
	};
	export default gifenc;
}
