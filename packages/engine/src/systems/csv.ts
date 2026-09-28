export interface CsvParseOptions {
	delimiter?: string;
	/** Stop after this many records; `truncated` reports whether more followed. */
	maxRows?: number;
	/** Extra columns past this are dropped (and set `truncated`). */
	maxCols?: number;
	/** Longer cells are cut (and set `truncated`) — keeps a pathological one-cell file from blowing up a table layout. */
	maxCellChars?: number;
}

export interface CsvParseResult {
	rows: string[][];
	truncated: boolean;
}

export const CSV_DEFAULT_MAX_ROWS = 2000;
export const CSV_DEFAULT_MAX_COLS = 64;
export const CSV_DEFAULT_MAX_CELL_CHARS = 500;

/** Tab for .tsv/.tab, comma for everything else — by extension only, no delimiter guessing. */
export function csvDelimiterForPath(path: string): string {
	return /\.(tsv|tab)$/i.test(path) ? "\t" : ",";
}

export function isDelimitedTextPath(path: string): boolean {
	return /\.(csv|tsv|tab)$/i.test(path);
}

/**
 * RFC 4180 parser: quoted fields may contain the delimiter, CR/LF, and `""`
 * as an escaped quote; records end at CRLF, LF, or a bare CR. Lenient where
 * the RFC is silent, since real files break it: an unterminated quote runs to
 * end of input (also what a preview cut mid-field looks like), a quote inside
 * an unquoted field is literal, and characters after a closing quote are
 * appended rather than rejected. A trailing newline doesn't add an empty row.
 */
export function parseCsv(
	text: string,
	options: CsvParseOptions = {},
): CsvParseResult {
	const delimiter = options.delimiter ?? ",";
	const maxRows = options.maxRows ?? CSV_DEFAULT_MAX_ROWS;
	const maxCols = options.maxCols ?? CSV_DEFAULT_MAX_COLS;
	const maxCellChars = options.maxCellChars ?? CSV_DEFAULT_MAX_CELL_CHARS;
	const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

	const rows: string[][] = [];
	let truncated = false;
	let row: string[] = [];
	let field = "";
	let inQuotes = false;
	let fieldStarted = false;

	const pushField = () => {
		if (row.length < maxCols) {
			if (field.length > maxCellChars) {
				field = field.slice(0, maxCellChars);
				truncated = true;
			}
			row.push(field);
		} else truncated = true;
		field = "";
		fieldStarted = false;
	};
	const pushRow = (): boolean => {
		pushField();
		if (rows.length >= maxRows) {
			truncated = true;
			return false;
		}
		rows.push(row);
		row = [];
		return true;
	};

	let i = 0;
	while (i < src.length) {
		const ch = src[i] as string;
		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"' && !fieldStarted) {
			inQuotes = true;
			fieldStarted = true;
			i++;
			continue;
		}
		if (ch === delimiter) {
			pushField();
			i++;
			continue;
		}
		if (ch === "\r" || ch === "\n") {
			if (!pushRow()) return { rows, truncated };
			i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
			continue;
		}
		field += ch;
		fieldStarted = true;
		i++;
	}
	if (fieldStarted || field.length > 0 || row.length > 0) {
		if (rows.length >= maxRows) truncated = true;
		else {
			pushField();
			rows.push(row);
		}
	}
	return { rows, truncated };
}
