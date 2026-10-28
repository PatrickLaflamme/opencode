export * as McpResourceTools from "./mcp-resource.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { SessionEvent } from "@opencode/schema/session-event"
import { Effect, Schema, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { ReadToolFileSystem } from "../read-filesystem.js"

export const Plugin = {
  id: "opencode.tools.mcp-resources",
  effect: Effect.fn("McpResourceTools.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service
    const bus = yield* Bus.Service

    // A session watch is local routing on top of the connection's listen stream. Drop it when the session goes away.
    yield* bus.subscribe(SessionEvent.Deleted).pipe(
      Stream.runForEach((event) => mcp.unsubscribeSubscriber(event.data.sessionID)),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "list_mcp_resources",
          options: { namespace: "opencode", codemode: true },
          description:
            "List documents, records, and other data exposed by MCP servers. Use this when the user refers to something that is not a local file, such as a URI with a custom scheme, then load a match with read_mcp_resource. Each entry names the server to read it from. Templates are resources addressed by a parameter such as a record ID; fill in the uriTemplate placeholders before reading.",
          input: Schema.Struct({
            server: Schema.optionalKey(
              Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }),
            ),
          }),
          output: Schema.Struct({
            resources: Schema.Array(Mcp.Resource),
            templates: Schema.Array(Mcp.ResourceTemplate),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              // Listing every server checks each server name so per-server rules still apply.
              const servers =
                input.server === undefined ? (yield* mcp.servers()).map((server) => server.name) : [input.server]
              yield* permission.assert({
                action: "opencode_list_mcp_resources",
                resources: servers,
                save: servers,
                metadata: {},
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              if (input.server === undefined) return { output: yield* mcp.resourceCatalog() }
              return { output: yield* mcp.resources({ server: input.server }) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "read_mcp_resource",
          options: { namespace: "opencode", codemode: true },
          description:
            "Read one MCP resource by server and URI. Not for local files. Always return the full contents rather than slicing or filtering them; oversized output is truncated automatically and the full content is saved to a file you can read. Images and PDFs are shown to you directly.",
          input: Schema.Struct({
            server: Schema.String.annotate({
              description: "The server field of the discovered resource.",
            }),
            uri: Schema.String.annotate({
              description: "Exact resource URI from discovery, an expanded uriTemplate, or the user.",
            }),
          }),
          output: Mcp.ResourceContent,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_read_mcp_resource",
                resources: [`${input.server}:${input.uri}`],
                save: [`${input.server}:*`],
                metadata: { server: input.server, uri: input.uri },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const resource = yield* mcp.readResource(input)
              if (!resource)
                return yield* new ToolFailure({
                  message: `MCP server "${input.server}" is not connected or does not expose resources`,
                })
              return {
                output: resource,
                content: resource.contents.flatMap((part) =>
                  part.type === "blob" &&
                  part.mimeType !== undefined &&
                  ReadToolFileSystem.MEDIA_MIMES.has(part.mimeType)
                    ? [{ type: "file" as const, uri: `data:${part.mimeType};base64,${part.blob}`, mime: part.mimeType }]
                    : [],
                ),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({
                      message: `Unable to read MCP resource ${input.server}:${input.uri}: ${error.message}`,
                      error,
                    }),
              ),
            ),
        })
        editor.add({
          name: "subscribe_mcp_resource",
          options: { namespace: "opencode", codemode: true },
          description:
            "Watch one MCP resource for this session. OpenCode opens a subscription on its connection to that server and, when the resource changes, reads it again and steers this session with the new contents. Use an exact URI from list_mcp_resources, an expanded uriTemplate, or the user. honored is false when the server did not accept the subscription.",
          input: Schema.Struct({
            server: Schema.String.annotate({ description: "The server field of the resource." }),
            uri: Schema.String.annotate({ description: "Exact resource URI to watch." }),
          }),
          output: Schema.Struct({
            server: Schema.String,
            uri: Schema.String,
            honored: Schema.Boolean,
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_read_mcp_resource",
                resources: [`${input.server}:${input.uri}`],
                save: [`${input.server}:*`],
                metadata: { server: input.server, uri: input.uri },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const server = (yield* mcp.servers()).find((item) => item.name === input.server)
              if (server?.status.status !== "connected")
                return yield* new ToolFailure({ message: `MCP server "${input.server}" is not connected` })
              const result = yield* mcp.subscribeResource({
                server: input.server,
                uri: input.uri,
                subscriber: context.sessionID,
              })
              return {
                output: { server: input.server, uri: input.uri, honored: result.honored },
                metadata: { server: input.server, uri: input.uri, honored: result.honored },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({
                      message: `Unable to subscribe to MCP resource ${input.server}:${input.uri}: ${error.message}`,
                      error,
                    }),
              ),
            ),
        })
        editor.add({
          name: "unsubscribe_mcp_resource",
          options: { namespace: "opencode", codemode: true },
          description: "Stop watching an MCP resource for this session.",
          input: Schema.Struct({
            server: Schema.String.annotate({ description: "The server field of the resource." }),
            uri: Schema.String.annotate({ description: "Exact resource URI passed to subscribe_mcp_resource." }),
          }),
          output: Schema.Struct({
            server: Schema.String,
            uri: Schema.String,
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_read_mcp_resource",
                resources: [`${input.server}:${input.uri}`],
                save: [`${input.server}:*`],
                metadata: { server: input.server, uri: input.uri },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* mcp.unsubscribeResource({
                server: input.server,
                uri: input.uri,
                subscriber: context.sessionID,
              })
              return { output: { server: input.server, uri: input.uri } }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({
                      message: `Unable to unsubscribe from MCP resource ${input.server}:${input.uri}: ${error.message}`,
                      error,
                    }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
