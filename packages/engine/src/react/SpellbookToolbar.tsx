import { uiIconPath, uiToolIconPath } from "../assetPaths.js";
import {
	SPELLBOOK_TOOLS,
	type SpellbookTool,
	type SpellbookToolId,
	toolTooltip,
} from "../systems/spellbookTools.js";

export interface SpellbookToolbarProps {
	isMac: boolean;
	onTool(id: SpellbookToolId): void;
}

function iconSrc(tool: SpellbookTool): string {
	return tool.icon === "wand" ? uiIconPath("wand") : uiToolIconPath(tool.icon);
}

// Visual groups (run/save | find/replace/rename | format/comment |
// navigate | fold) — a divider after each group's last tool.
const GROUP_ENDS = new Set<SpellbookToolId>([
	"save",
	"rename",
	"comment",
	"symbol",
]);

export function SpellbookToolbar({
	isMac,
	onTool,
}: SpellbookToolbarProps): React.ReactElement {
	return (
		<div
			className="cabn-spellbook-toolbar"
			role="toolbar"
			aria-label="Spellbook tools"
		>
			{SPELLBOOK_TOOLS.map((tool) => (
				<span key={tool.id} className="cabn-spellbook-tool-wrap">
					<button
						type="button"
						className="cabn-spellbook-tool"
						title={toolTooltip(tool, isMac)}
						data-tool={tool.id}
						// mousedown, not click, keeps CodeMirror's focus/selection: the
						// button never takes focus, so commands that act on the
						// current selection (comment, rename) still see it.
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => onTool(tool.id)}
					>
						<img src={iconSrc(tool)} alt="" />
						<span>{tool.label}</span>
					</button>
					{GROUP_ENDS.has(tool.id) && (
						<span className="cabn-spellbook-tool-divider" aria-hidden="true" />
					)}
				</span>
			))}
		</div>
	);
}
