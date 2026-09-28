import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	convert,
	DEFAULT_MAX_FILE_BYTES,
	DEFAULT_MAX_FILES,
	DEFAULT_ZIP_MAX_TOTAL_BYTES,
	ZipSource,
} from "@cabn/converter";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, {
	type FastifyInstance,
	type FastifyServerOptions,
} from "fastify";
import { zipSync } from "fflate";
import { extractBearerToken, verifyApiKey } from "./auth.js";
import type { AppConfig } from "./config.js";
import { sha256Hex } from "./config.js";

const pkg = JSON.parse(
	readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
		"utf8",
	),
) as { version: string };
export const BACKEND_VERSION = pkg.version;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function hasZipMagic(bytes: Uint8Array): boolean {
	if (bytes.length < ZIP_MAGIC.length) return false;
	return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

function isFastifyErrorCode(err: unknown, code: string): boolean {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		(err as { code?: unknown }).code === code
	);
}

export interface BuildAppOptions {
	/**
	 * Escape hatch for tests only. `logger` is intentionally excluded here
	 * (rather than allowing a full override) so the redact/serializers config
	 * below can never be silently dropped by a caller-supplied logger object —
	 * `loggerStream` is the only way tests observe log output.
	 */
	fastify?: Omit<FastifyServerOptions, "logger">;
	loggerStream?: NodeJS.WritableStream;
}

/**
 * Throws synchronously in production with no configured keys, refusing to
 * start at all rather than booting an upload route nobody can authenticate
 * against but that would still 401 every request "safely" — a cheap trap
 * for whoever forgets to set CABN_API_KEY_SHA256 in a new environment.
 */
export function buildApp(
	config: AppConfig,
	opts: BuildAppOptions = {},
): FastifyInstance {
	if (config.nodeEnv === "production" && config.apiKeyHashes.length === 0) {
		throw new Error(
			"CABN_API_KEY_SHA256 is not set. Refusing to start in production with " +
				"an unauthenticatable upload route — run `pnpm -F @cabn/backend keygen` " +
				"and set the printed hash as CABN_API_KEY_SHA256.",
		);
	}

	const app = Fastify({
		trustProxy: config.trustProxy,
		// Multipart framing (boundaries, headers) adds a little on top of the
		// file itself; @fastify/multipart's own fileSize limit below is what
		// actually enforces the intended cap on file content.
		bodyLimit: config.maxUploadBytes + 64 * 1024,
		logger: {
			level: "info",
			...(opts.loggerStream ? { stream: opts.loggerStream } : {}),
			redact: {
				paths: ["req.headers.authorization"],
				censor: "[REDACTED]",
			},
			// Fastify's default req serializer omits headers entirely; they're
			// added back here (for audit/debugging) specifically so the redact
			// rule above has something to redact — never log this without it.
			serializers: {
				req(request) {
					return {
						method: request.method,
						url: request.url,
						headers: request.headers,
					};
				},
			},
		},
		...opts.fastify,
	});

	// Node's http.Server default (5 minutes) is far too generous for a
	// synchronous convert-and-respond endpoint with no long-lived connections.
	app.server.requestTimeout = config.requestTimeoutMs;

	app.register(fastifyCors, {
		origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
	});

	app.register(fastifyMultipart, {
		limits: {
			// The route handler enforces "exactly one file" itself (see below) so
			// it can return a clean 400 instead of a plugin-level throw; this cap
			// is only a defense-in-depth backstop against a multipart body with
			// hundreds of file parts.
			files: 5,
			fileSize: config.maxUploadBytes,
		},
	});

	app.get("/healthz", async () => ({ ok: true, version: BACKEND_VERSION }));

	// Two independent rate-limit buckets nested via encapsulation (each
	// fastify.register call gets its own onRequest hook and in-memory store):
	// an outer per-IP bucket and an inner per-key bucket. Neither alone is
	// enough — IP-only lets one attacker rotate keys from a single address,
	// key-only lets a leaked key get hammered from a botnet.
	app.register(async (perIp) => {
		await perIp.register(fastifyRateLimit, {
			max: config.rateLimitMax,
			timeWindow: config.rateLimitWindowMs,
			keyGenerator: (req) => `ip:${req.ip}`,
		});

		await perIp.register(async (perKey) => {
			await perKey.register(fastifyRateLimit, {
				max: config.rateLimitMax,
				timeWindow: config.rateLimitWindowMs,
				// Hashed, not the raw key, so a rate-limit store dump never holds a
				// usable credential. Falls back to the IP bucket's own key for an
				// unauthenticated request so a no-token flood still gets bucketed
				// somewhere instead of sharing one unbounded "no key" slot.
				keyGenerator: (req) => {
					const token = extractBearerToken(req.headers.authorization);
					return token ? `key:${sha256Hex(token)}` : `ip:${req.ip}`;
				},
			});

			perKey.post("/v1/worlds", async (request, reply) => {
				if (config.apiKeyHashes.length === 0) {
					return reply.code(503).send({ error: "no API keys configured" });
				}

				const token = extractBearerToken(request.headers.authorization);
				if (!token || !verifyApiKey(token, config.apiKeyHashes)) {
					// Deliberately identical for every failure mode (missing header,
					// wrong scheme, empty token, wrong key) — no hint which part
					// failed.
					return reply.code(401).send({ error: "unauthorized" });
				}

				let fileBuffer: Buffer | undefined;
				let fileCount = 0;
				try {
					for await (const part of request.parts()) {
						if (part.type !== "file") continue;
						fileCount++;
						if (fileCount > 1) {
							// Drain so busboy can finish parsing the rest of the body
							// instead of hanging on an unconsumed stream.
							part.file.resume();
							continue;
						}
						fileBuffer = await part.toBuffer();
					}
				} catch (err) {
					if (isFastifyErrorCode(err, "FST_REQ_FILE_TOO_LARGE")) {
						return reply.code(413).send({ error: "file too large" });
					}
					request.log.warn({ err }, "malformed multipart upload");
					return reply.code(400).send({ error: "malformed upload" });
				}

				if (fileCount === 0) {
					return reply.code(400).send({ error: "no file provided" });
				}
				if (fileCount > 1) {
					return reply
						.code(400)
						.send({ error: "exactly one file is required" });
				}
				if (!fileBuffer || !hasZipMagic(fileBuffer)) {
					return reply.code(415).send({ error: "file is not a zip archive" });
				}

				try {
					const zipSource = new ZipSource(fileBuffer, {
						maxFiles: DEFAULT_MAX_FILES,
						maxFileBytes: DEFAULT_MAX_FILE_BYTES,
						maxTotalBytes: DEFAULT_ZIP_MAX_TOTAL_BYTES,
					});
					// includeSecrets is never passed — secret-pattern files (.env,
					// *.pem, id_rsa*, ...) stay metadata-only, same default as
					// everywhere else in cabn.
					const bundle = await convert(zipSource, {
						name: "uploaded world",
						source: "upload.zip",
						maxFiles: DEFAULT_MAX_FILES,
						maxFileBytes: DEFAULT_MAX_FILE_BYTES,
						// Host ceilings an uploaded cabn.json can lower but never raise:
						// no media file bigger than the zip extraction cap above (it
						// couldn't be read in full anyway), and no more media in the
						// response than the upload itself was allowed to carry.
						mediaMaxFileBytes: DEFAULT_MAX_FILE_BYTES,
						mediaMaxTotalBytes: config.maxUploadBytes,
					});

					const files: Record<string, Uint8Array> = {};
					for (const [path, value] of bundle) {
						files[path] =
							typeof value === "string"
								? new TextEncoder().encode(value)
								: value;
					}
					const zipped = zipSync(files);

					return reply
						.code(200)
						.header("content-type", "application/zip")
						.header("content-disposition", 'attachment; filename="world.zip"')
						.send(Buffer.from(zipped));
				} catch (err) {
					// Never surface convert()'s internal error (stack traces, zod
					// issue paths that could echo file contents) to the client.
					request.log.warn({ err }, "conversion failed");
					return reply
						.code(422)
						.send({ error: "could not convert the uploaded archive" });
				}
			});
		});
	});

	return app;
}
