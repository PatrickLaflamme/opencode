export * as McpSubscriptionWakePlugin from "./mcp-subscription-wake.js"

import { define, type Plugin as EffectPlugin } from "@opencode/plugin/effect/plugin"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Effect, Scope, Stream } from "effect"
import { Bus } from "../bus.js"
import { Location } from "../location.js"
import { Session } from "../session.js"

export interface WakeCandidate {
  readonly id: Session.ID
  readonly parentID?: Session.ID
  readonly time: { readonly archived?: unknown }
}

// Running sessions are steered in place. With none running, only the newest idle session wakes,
// so a resource update does not fan out across every session ever opened in the workspace.
export function selectWakeTargets<S extends WakeCandidate>(sessions: readonly S[], active: ReadonlySet<Session.ID>) {
  const open = sessions.filter((session) => session.parentID === undefined && session.time.archived === undefined)
  const running = open.filter((session) => active.has(session.id))
  if (running.length > 0) return running
  const latest = open[0]
  if (!latest) return []
  return [latest]
}

// Annotated so this plugin's effect can call Session without inference cycling through the instance graph.
export const Plugin: EffectPlugin<Session.Service | Bus.Service | Location.Service | Scope.Scope> = define({
  id: "opencode.mcp.subscription.wake",
  effect: Effect.fn("McpSubscriptionWake")(function* () {
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service

    const targets = Effect.fn("McpSubscriptionWake.targets")(function* () {
      const active = yield* sessions.active
      const listed = yield* sessions.list({
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
        parentID: null,
        limit: 50,
        order: "desc",
      })
      const known = new Set(listed.data.map((session) => session.id))
      const extras = yield* Effect.forEach(
        [...active].filter((id) => !known.has(id)),
        (id) => sessions.get(id).pipe(Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined))),
      )
      const here = [...listed.data, ...extras.flatMap((session) => (session ? [session] : []))].filter(
        (session) =>
          session.location.directory === location.directory && session.location.workspaceID === location.workspaceID,
      )
      return selectWakeTargets(here, active)
    })

    yield* bus.subscribe(McpEvent.ResourceUpdated).pipe(
      Stream.filter((event) => event.data.wake),
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const selected = yield* targets()
          yield* Effect.forEach(
            selected,
            (session) =>
              sessions
                .synthetic({
                  sessionID: session.id,
                  description: `${event.data.server} updated ${event.data.uri}`,
                  text: [
                    `MCP server "${event.data.server}" reported that resource ${event.data.uri} changed.`,
                    "Read it again if this session depends on it, then respond to the change.",
                  ].join("\n"),
                  metadata: { source: "mcp.subscription", server: event.data.server, uri: event.data.uri },
                })
                .pipe(
                  Effect.catch((error: unknown) =>
                    Effect.logWarning("failed to wake session for MCP resource update", {
                      sessionID: session.id,
                      server: event.data.server,
                      uri: event.data.uri,
                      error: error instanceof Error ? error.message : String(error),
                    }),
                  ),
                ),
            { discard: true },
          )
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
