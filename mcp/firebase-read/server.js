/** An MCP server exposing read-only access to the A Thousand Worlds Firebase Realtime Database.
 *
 * The tool list below is the server's entire surface, and none of its entries write. A call to
 * any other name — set, update, push, remove — is rejected as an unknown tool, and the client
 * underneath it can only issue HTTP GET, so there is no path to a mutation even if one were
 * requested. See read.js for that guarantee.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js')
const fs = require('node:fs')
const pkg = require('../../package.json')
const read = require('./read')

/** A path segment, a value used in a range query, or a limit. */
const PATH_SCHEMA = {
  type: 'string',
  description:
    'Slash-separated database path, e.g. "books" or "books/<id>/title". Omit or pass "" for the database root, which is gated.',
}

const RANGE_VALUE_SCHEMA = { type: ['string', 'number', 'boolean'] }

const TOOLS = [
  {
    name: 'list_paths',
    description:
      'List the top-level database paths and whether each is world-readable or needs the service account key. Answers "what is in this database" without a network call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_keys',
    description:
      'List the child keys at a path without downloading their values (a shallow read). Use this to size a collection or pick an id to read, e.g. path "books".',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_SCHEMA },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_value',
    description:
      'Read the value at a path. Scope the read with a deeper path, with shallow for keys only, or with orderBy plus limitToFirst/limitToLast to sample a collection. A read over 200000 characters is refused rather than truncated.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_SCHEMA,
        shallow: {
          type: 'boolean',
          description:
            'Return each child key mapped to true instead of its value. Cannot be combined with orderBy or a limit.',
        },
        orderBy: {
          type: 'string',
          description:
            'Child key to order by, or "$key" / "$value" / "$priority". Required by Firebase before a limit or range applies; defaults to "$key" when one is given.',
        },
        limitToFirst: { type: 'integer', description: 'Return the first N ordered children.' },
        limitToLast: { type: 'integer', description: 'Return the last N ordered children.' },
        startAt: RANGE_VALUE_SCHEMA,
        endAt: RANGE_VALUE_SCHEMA,
        equalTo: RANGE_VALUE_SCHEMA,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

const handlers = {
  list_paths: async () => ({
    databaseUrl: read.databaseUrl(),
    public: read.PUBLIC_PATHS,
    gated: read.GATED_PATHS,
    serviceAccountKey: fs.existsSync(read.serviceAccountKeyPath())
      ? read.serviceAccountKeyPath()
      : `missing (${read.serviceAccountKeyPath()}); gated paths cannot be read`,
  }),

  list_keys: async args => {
    const keys = await read.keys(args.path)
    return { path: args.path, count: keys.length, keys }
  },

  get_value: async args => read.get(args.path, args),
}

/** Dispatches a tool call, rejecting every name the server does not expose. */
const callTool = async (name, args = {}) => {
  if (!Object.prototype.hasOwnProperty.call(handlers, name)) {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool "${name}". This server is read-only and exposes only: ${TOOLS.map(tool => tool.name).join(', ')}.`,
    )
  }
  return handlers[name](args)
}

/** Builds the server without connecting it, so tests can drive it over an in-memory transport. */
const createServer = () => {
  const server = new Server(
    { name: 'a-thousand-worlds-firebase-read', version: pkg.version },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    // An unknown tool is a protocol error; a read that fails is a result the model can act on.
    try {
      const result = await callTool(name, args)
      return { content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }] }
    } catch (error) {
      if (error instanceof McpError) throw error
      return { content: [{ type: 'text', text: error.message }], isError: true }
    }
  })

  return server
}

/** Serves over stdio, which is how .mcp.json launches this file. */
const main = async () => {
  await createServer().connect(new StdioServerTransport())
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { TOOLS, callTool, createServer }
