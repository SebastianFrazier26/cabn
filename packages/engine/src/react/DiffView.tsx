import type { HistoryHunk } from "@cabn/world-schema";

const ROW: Record<string, React.CSSProperties> = {
	"+": {
		background: "var(--cabn-diff-add-bg)",
		color: "var(--cabn-diff-add-text)",
	},
	"-": {
		background: "var(--cabn-diff-del-bg)",
		color: "var(--cabn-diff-del-text)",
	},
	" ": { color: "var(--cabn-text)" },
};

/** One file's hunks in the pixel theme: old/new line numbers, a +/- gutter and tinted rows (day and night tokens). */
export function DiffView({
	hunks,
}: {
	hunks: readonly HistoryHunk[];
}): React.ReactElement {
	return (
		<div
			data-testid="pensieve-diff"
			style={{
				fontFamily: "var(--cabn-font-mono)",
				fontSize: 12,
				lineHeight: 1.5,
				overflow: "auto",
				border: "2px solid var(--cabn-border-outer)",
				borderRadius: 8,
				background: "var(--cabn-panel-body)",
			}}
		>
			{hunks.map((hunk) => {
				let oldLine = hunk.oldStart;
				let newLine = hunk.newStart;
				return (
					<div key={`${hunk.oldStart}:${hunk.newStart}`}>
						<div
							style={{
								padding: "2px 8px",
								color: "var(--cabn-text-secondary)",
								background: "var(--cabn-inset-tint)",
							}}
						>
							{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
						</div>
						{hunk.lines.map((raw, i) => {
							const kind = raw[0] ?? " ";
							const oldNo = kind === "+" ? "" : String(oldLine++);
							const newNo = kind === "-" ? "" : String(newLine++);
							return (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: a hunk's lines are static.
									key={i}
									data-diff-kind={
										kind === "+" ? "add" : kind === "-" ? "del" : "ctx"
									}
									style={{ display: "flex", whiteSpace: "pre", ...ROW[kind] }}
								>
									<span
										style={{
											width: 36,
											textAlign: "right",
											opacity: 0.7,
											flexShrink: 0,
										}}
									>
										{oldNo}
									</span>
									<span
										style={{
											width: 36,
											textAlign: "right",
											opacity: 0.7,
											flexShrink: 0,
										}}
									>
										{newNo}
									</span>
									<span
										style={{ width: 18, textAlign: "center", flexShrink: 0 }}
										aria-hidden
									>
										{kind === " " ? "" : kind}
									</span>
									<span>{raw.slice(1) || " "}</span>
								</div>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}
