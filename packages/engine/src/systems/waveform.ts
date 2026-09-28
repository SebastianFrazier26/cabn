/**
 * Reduces decoded PCM (one Float32Array per channel, as AudioBuffer.
 * getChannelData returns) to `buckets` peak amplitudes in 0..1: each bucket
 * is the loudest absolute sample across all channels in its slice, then the
 * whole set is scaled so the loudest bucket is 1 (a quiet recording still
 * draws a readable waveform). Silence stays all-zero rather than dividing by
 * zero. Pure, so the arch painter and the dock/file-view player share it.
 */
export function reducePeaks(
	channels: readonly ArrayLike<number>[],
	buckets: number,
): number[] {
	const count = Math.max(0, Math.floor(buckets));
	const length = channels.reduce((n, c) => Math.max(n, c.length), 0);
	if (count === 0) return [];
	const peaks = new Array<number>(count).fill(0);
	if (length === 0) return peaks;

	for (let b = 0; b < count; b++) {
		const start = Math.floor((b * length) / count);
		// At least one sample per bucket, so asking for more buckets than
		// samples repeats samples instead of leaving gaps.
		const end = Math.max(start + 1, Math.floor(((b + 1) * length) / count));
		let peak = 0;
		for (const channel of channels) {
			const stop = Math.min(end, channel.length);
			for (let i = start; i < stop; i++) {
				const v = Math.abs(channel[i] as number);
				if (v > peak) peak = v;
			}
		}
		peaks[b] = peak;
	}

	const max = peaks.reduce((m, v) => Math.max(m, v), 0);
	if (max === 0) return peaks;
	return peaks.map((v) => Math.min(1, v / max));
}

export interface WaveformBar {
	x: number;
	y: number;
	w: number;
	h: number;
	/** True for bars left of the playhead — painters tint the played part. */
	played: boolean;
}

/**
 * Lays peaks out as vertically-centred bars across `box`, resampling to
 * however many bars fit at `barWidth + gap` spacing. `progress` (0..1) marks
 * which bars count as already played. Every bar is at least 1px tall, so a
 * silent stretch still reads as a line rather than a hole.
 */
export function waveformBars(
	peaks: readonly number[],
	box: { x: number; y: number; w: number; h: number },
	barWidth: number,
	gap: number,
	progress = 0,
): WaveformBar[] {
	const pitch = barWidth + gap;
	if (peaks.length === 0 || box.w <= 0 || box.h <= 0 || pitch <= 0) return [];
	const count = Math.max(1, Math.floor((box.w + gap) / pitch));
	const used = count * pitch - gap;
	const x0 = box.x + (box.w - used) / 2;
	const mid = box.y + box.h / 2;
	const bars: WaveformBar[] = [];
	for (let i = 0; i < count; i++) {
		const from = Math.floor((i * peaks.length) / count);
		const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
		let peak = 0;
		for (let j = from; j < to && j < peaks.length; j++)
			peak = Math.max(peak, peaks[j] as number);
		const h = Math.max(1, peak * box.h);
		bars.push({
			x: x0 + i * pitch,
			y: mid - h / 2,
			w: barWidth,
			h,
			played: (i + 0.5) / count <= progress,
		});
	}
	return bars;
}
