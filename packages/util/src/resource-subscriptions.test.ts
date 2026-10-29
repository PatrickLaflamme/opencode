import { describe, expect, test } from "bun:test"
import { activeResourceSubscriptions } from "./resource-subscriptions.js"

const subscribe = (id: string, input: { server: string; uri: string }, honored: boolean | undefined = true) => ({
  type: "tool",
  id,
  name: "opencode_subscribe_mcp_resource",
  state: {
    status: "completed",
    input,
    metadata: honored === undefined ? { server: input.server, uri: input.uri } : { ...input, honored },
    content: [{ type: "text", text: JSON.stringify({ ...input, honored: honored !== false }) }],
  },
})

const unsubscribe = (id: string, input: { server: string; uri: string }) => ({
  type: "tool",
  id,
  name: "opencode_unsubscribe_mcp_resource",
  state: { status: "completed", input },
})

describe("activeResourceSubscriptions", () => {
  test("keeps honored watches and drops a later unsubscribe", () => {
    const messages = [
      {
        type: "assistant",
        content: [
          subscribe("keep", { server: "docs", uri: "docs://readme" }),
          subscribe("refused", { server: "docs", uri: "docs://other" }, false),
          subscribe("gone", { server: "docs", uri: "docs://notes" }),
          unsubscribe("stop", { server: "docs", uri: "docs://notes" }),
        ],
      },
      {
        type: "synthetic",
        content: undefined,
      },
    ]

    expect(activeResourceSubscriptions(messages)).toEqual([{ id: "keep", server: "docs", uri: "docs://readme" }])
  })

  test("reads honored from the tool text when metadata omits it", () => {
    const messages = [
      {
        type: "assistant",
        content: [
          subscribe("plain", { server: "docs", uri: "docs://readme" }, undefined),
          {
            type: "tool",
            id: "json",
            name: "subscribe_mcp_resource",
            state: {
              status: "completed",
              input: { server: "docs", uri: "docs://skip" },
              content: [{ type: "text", text: JSON.stringify({ honored: false }) }],
            },
          },
        ],
      },
    ]

    expect(activeResourceSubscriptions(messages)).toEqual([{ id: "plain", server: "docs", uri: "docs://readme" }])
  })
})
