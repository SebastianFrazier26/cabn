// fastify.inject has no multipart helper of its own — this hand-builds a
// multipart/form-data body byte-for-byte so tests can post arbitrary
// (including hostile) zip bytes without going over a real socket.
const BOUNDARY = "----cabnTestBoundary123456";

export interface MultipartFilePart {
	fieldName: string;
	filename: string;
	content: Uint8Array;
	contentType?: string;
}

export function buildMultipartBody(parts: MultipartFilePart[]): {
	body: Buffer;
	contentType: string;
} {
	const chunks: Buffer[] = [];
	for (const part of parts) {
		chunks.push(
			Buffer.from(
				`--${BOUNDARY}\r\n` +
					`Content-Disposition: form-data; name="${part.fieldName}"; filename="${part.filename}"\r\n` +
					`Content-Type: ${part.contentType ?? "application/zip"}\r\n\r\n`,
			),
		);
		chunks.push(Buffer.from(part.content));
		chunks.push(Buffer.from("\r\n"));
	}
	chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
	return {
		body: Buffer.concat(chunks),
		contentType: `multipart/form-data; boundary=${BOUNDARY}`,
	};
}
