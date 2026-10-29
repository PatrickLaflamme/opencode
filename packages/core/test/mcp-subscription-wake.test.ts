import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect, Schedule } from "effect"
import { McpEvent } from "@opencode/schema/mcp-event"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { InstructionEntry } from "@opencode/core/session/instruction-entry"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { McpSubscriptionWakePlugin, selectWakeTargets } from "@opencode/core/plugin/mcp-subscription-wake"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"
import { globalProjectNode } from "./lib/project"
import { promptLocationNode } from "./fixture/prompt-location"

const id = (value: string) => Session.ID.make(value)
const candidate = (
  value: string,
  input: { parentID?: Session.ID; archived?: boolean } = {},
): Parameters<typeof selectWakeTargets>[0][number] => ({
  id: id(value),
  parentID: input.parentID,
  time: { archived: input.archived ? 1 : undefined },
})

describe("selectWakeTargets", () => {
  test("wakes only the newest idle session", () => {
    const latest = candidate("ses_latest")
    const older = candidate("ses_older")
    expect(selectWakeTargets([latest, older], new Set())).toEqual([latest])
  })

  test("steers every running session and leaves idle ones alone", () => {
    const idle = candidate("ses_idle")
    const running = candidate("ses_running")
    const other = candidate("ses_other")
    expect(selectWakeTargets([idle, running, other], new Set([running.id, other.id]))).toEqual([running, other])
  })

  test("skips archived sessions and subagents", () => {
    const child = candidate("ses_child", { parentID: id("ses_parent") })
    const archived = candidate("ses_archived", { archived: true })
    const open = candidate("ses_open")
    expect(selectWakeTargets([child, archived, open], new Set([child.id, archived.id]))).toEqual([open])
  })
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      Session.node,
      SessionTransfer.node,
      InstructionEntry.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(promptLocationNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

const directory = AbsolutePath.make("/project")
const ref = Location.Ref.make({ directory })

it.live("steers the newest session when an MCP subscription update asks to wake", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const bus = yield* Bus.Service
    const { db } = yield* Database.Service
    const older = yield* sessions.create({ location: ref, title: "older" })
    const newer = yield* sessions.create({ location: ref, title: "newer" })
    yield* db.update(SessionTable).set({ time_updated: 1 }).where(eq(SessionTable.id, older.id)).run()
    yield* db.update(SessionTable).set({ time_updated: 2 }).where(eq(SessionTable.id, newer.id)).run()

    yield* McpSubscriptionWakePlugin.Plugin.effect(undefined as never).pipe(
      Effect.provideService(Location.Service, Location.Service.of(location(ref))),
      Effect.forkScoped({ startImmediately: true }),
    )

    yield* bus.publish(McpEvent.ResourceUpdated, {
      server: "docs",
      uri: "docs://other",
      wake: false,
      subscribers: [],
    })
    yield* Effect.sleep("30 millis")
    expect(yield* sessions.inbox(newer.id)).toEqual([])
    expect(yield* sessions.inbox(older.id)).toEqual([])

    yield* bus.publish(McpEvent.ResourceUpdated, {
      server: "docs",
      uri: "docs://readme",
      wake: true,
      subscribers: [],
      text: "hello",
    })
    const pending = yield* sessions.inbox(newer.id).pipe(
      Effect.filterOrFail(
        (items) => items.length === 1,
        () => new Error("session was not woken"),
      ),
      Effect.retry({ times: 20, schedule: Schedule.spaced("10 millis") }),
    )
    expect(pending[0]).toMatchObject({
      type: "synthetic",
      delivery: "steer",
      payload: {
        description: "Event for subscription to docs://readme received",
        text: 'Event for subscription to docs://readme received\nMCP server "docs" reported that resource docs://readme changed.\nhello',
        metadata: { source: "subscription", server: "docs", uri: "docs://readme", state: "completed" },
      },
    })
    expect(yield* sessions.inbox(older.id)).toEqual([])
  }),
)
