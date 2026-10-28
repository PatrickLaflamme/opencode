export * as McpEvent from "./mcp-event.js"

import { Schema } from "effect"
import { Event } from "./event.js"

export const ToolsChanged = Event.ephemeral({
  type: "mcp.tools.changed",
  schema: {
    server: Schema.String,
  },
})

export const ResourcesChanged = Event.ephemeral({
  type: "mcp.resources.changed",
  schema: {
    server: Schema.String,
  },
})

// A subscribed resource changed. `wake` is the server's opt-in to steer the update into sessions.
export const ResourceUpdated = Event.ephemeral({
  type: "mcp.resource.updated",
  schema: {
    server: Schema.String,
    uri: Schema.String,
    wake: Schema.Boolean,
  },
})

// Emitted whenever a server's connection status settles (connected, failed, needs_auth, closed) so
// observers can refresh status without polling.
export const StatusChanged = Event.ephemeral({
  type: "mcp.status.changed",
  schema: {
    server: Schema.String,
  },
})

export const Definitions = Event.inventory(ToolsChanged, ResourcesChanged, ResourceUpdated, StatusChanged)
