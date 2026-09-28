#!/usr/bin/env node
// One-off generator for apps/demo/sample-project/media/ — every sample there
// is synthesized here (no third-party assets, nothing to license). Its
// outputs are committed; rerun only to change them:
//   node apps/demo/scripts/gen-media-samples.mjs
// The JPEG is converted from the generated PNG with macOS `sips` (skipped
// elsewhere). No MP3/OGG sample: encoding either needs an encoder this repo
// doesn't depend on.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "sample-project", "media");

function meadowPng() {
	const W = 96;
	const H = 64;
	const png = new PNG({ width: W, height: H });
	const set = (x, y, [r, g, b]) => {
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4;
		png.data[i] = r;
		png.data[i + 1] = g;
		png.data[i + 2] = b;
		png.data[i + 3] = 255;
	};
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			// Banded (not smooth) sky so it reads as pixel art.
			const band = Math.floor(y / 6);
			set(x, y, [120 + band * 12, 170 + band * 8, 235 - band * 4]);
		}
	}
	for (let y = -7; y <= 7; y++)
		for (let x = -7; x <= 7; x++)
			if (x * x + y * y <= 49) set(74 + x, 14 + y, [255, 214, 90]);
	const hill = (cx, top, width, color) => {
		for (let x = 0; x < W; x++) {
			const d = (x - cx) / width;
			const h = Math.round(top + d * d * 24);
			for (let y = h; y < H; y++) set(x, y, color);
		}
	};
	hill(20, 34, 40, [92, 170, 90]);
	hill(70, 40, 36, [70, 150, 78]);
	for (let y = 50; y < H; y++)
		for (let x = 0; x < W; x++)
			set(x, y, (x + y) % 7 === 0 ? [96, 178, 92] : [82, 160, 80]);
	// Cabin: walls, roof, door, window.
	for (let y = 38; y < 52; y++)
		for (let x = 40; x < 58; x++) set(x, y, [150, 92, 50]);
	for (let r = 0; r < 9; r++)
		for (let x = 38 + r; x < 60 - r; x++) set(x, 38 - r, [190, 60, 60]);
	for (let y = 44; y < 52; y++)
		for (let x = 47; x < 51; x++) set(x, y, [80, 48, 26]);
	for (let y = 41; y < 45; y++)
		for (let x = 53; x < 56; x++) set(x, y, [255, 230, 140]);
	// Flowers.
	for (const [x, y, c] of [
		[8, 56, [239, 95, 160]],
		[15, 59, [255, 210, 63]],
		[27, 55, [138, 111, 214]],
		[66, 57, [239, 95, 160]],
		[84, 60, [255, 210, 63]],
	])
		set(x, y, c);
	return PNG.sync.write(png);
}

function chimeWav() {
	const rate = 22050;
	const notes = [523.25, 659.25, 783.99, 1046.5];
	const noteLen = 0.32;
	const total = Math.round(rate * (noteLen * notes.length + 0.5));
	const pcm = new Int16Array(total);
	notes.forEach((freq, n) => {
		const start = Math.round(n * noteLen * rate);
		for (let i = 0; start + i < total; i++) {
			const t = i / rate;
			const env = Math.exp(-t * 4.5) * Math.min(1, t * 200);
			const v =
				Math.sin(2 * Math.PI * freq * t) +
				0.3 * Math.sin(4 * Math.PI * freq * t);
			pcm[start + i] = Math.max(
				-32767,
				Math.min(32767, pcm[start + i] + v * env * 9000),
			);
		}
	});
	const data = Buffer.from(pcm.buffer);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

/** A hand-assembled 2-page PDF (base-14 Helvetica, vector shapes) with a correct xref table. */
function fieldGuidePdf() {
	const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
	const text = (x, y, size, s) =>
		`BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
	const page1 = [
		"0.95 0.97 1 rg 0 0 420 297 re f",
		"0.23 0.18 0.42 RG 6 w 12 12 396 273 re S",
		"1 0.82 0.25 rg 330 220 m 350 240 l 370 220 l 350 200 l f",
		"0.13 0.1 0.24 rg",
		text(36, 236, 26, "The Meadow Field Guide"),
		text(36, 206, 13, "A tiny sample PDF generated for the cabn demo."),
		"0.37 0.76 0.42 rg 36 60 110 90 re f",
		"0.94 0.37 0.63 rg 160 60 110 60 re f",
		"0.54 0.44 0.84 rg 284 60 100 120 re f",
		"0.13 0.1 0.24 rg",
		text(36, 40, 11, "page 1 of 2  -  turn the page with the arrows"),
	].join("\n");
	const page2 = [
		"1 0.99 0.94 rg 0 0 420 297 re f",
		"0.13 0.1 0.24 rg",
		text(36, 250, 20, "Common residents"),
		text(48, 215, 13, "- Tomato gnomes: shy, red, fond of trellises"),
		text(48, 192, 13, "- Basil sprites: aromatic, mostly harmless"),
		text(48, 169, 13, "- Squash golems: slow, heavy, very loyal"),
		"0.31 0.82 0.85 rg 36 60 348 70 re f",
		"0.13 0.1 0.24 rg",
		text(
			52,
			90,
			12,
			"Tip: sealed chests are files too large or too strange to open.",
		),
	].join("\n");

	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 297] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(page1)} >>\nstream\n${page1}\nendstream`,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 297] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
		`<< /Length ${Buffer.byteLength(page2)} >>\nstream\n${page2}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	];
	let out = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(Buffer.byteLength(out));
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xrefAt = Buffer.byteLength(out);
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const off of offsets)
		out += `${String(off).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

function harvestCsv() {
	const crops = [
		"tomato",
		"basil",
		"squash",
		"pea",
		"carrot",
		"kale",
		"radish",
		"bean",
	];
	const gardeners = ["Ada", "Bram", "Cleo", "Dov", "Esme", "Finn"];
	const rows = [["week", "gardener", "crop", "kg", "note"]];
	for (let week = 1; week <= 24; week++) {
		const crop = crops[(week * 5) % crops.length];
		const who = gardeners[(week * 7) % gardeners.length];
		const kg = ((week * 37) % 90) / 10 + 0.5;
		let note = "";
		if (week === 3) note = '"first harvest, finally"';
		if (week === 9) note = '"aphids ""visited"" again"';
		if (week === 14) note = '"split into two beds:\nnorth, south"';
		rows.push([String(week), who, crop, kg.toFixed(1), note]);
	}
	return `${rows.map((r) => r.join(",")).join("\n")}\n`;
}

async function main() {
	await mkdir(outDir, { recursive: true });
	const png = meadowPng();
	await writeFile(join(outDir, "meadow.png"), png);
	await writeFile(join(outDir, "chime.wav"), chimeWav());
	await writeFile(join(outDir, "field-guide.pdf"), fieldGuidePdf());
	await writeFile(join(outDir, "harvest.csv"), harvestCsv());
	// Extension says PNG, bytes say text: the converter's magic-byte check
	// keeps it a sealed chest ("type mismatch") instead of trusting the name.
	await writeFile(
		join(outDir, "not-a-picture.png"),
		"This file only claims to be a PNG.\n",
	);
	try {
		execFileSync(
			"sips",
			[
				"-s",
				"format",
				"jpeg",
				"-s",
				"formatOptions",
				"70",
				"-z",
				"128",
				"192",
				join(outDir, "meadow.png"),
				"--out",
				join(outDir, "meadow-photo.jpg"),
			],
			{ stdio: "ignore" },
		);
	} catch {
		console.warn(
			"gen-media-samples: sips unavailable, skipped meadow-photo.jpg",
		);
	}
	console.log(`gen-media-samples: wrote samples to ${outDir}`);
}

await main();
