# Example: LangChain Agent with agent-identity

Demonstrates three integration patterns for LangChain and LangGraph:

| Pattern | When to use |
|---------|-------------|
| `AgentIdentityTool` | Let the agent resolve credentials on demand as part of its reasoning loop |
| `createAgentIdentityModel` | Resolve credential + get a fully-configured `ChatModel` in one call |
| `createAgentIdentityNode` | LangGraph node wrapper — credential injected into graph state before node runs |

## Run

```bash
cd examples/langchain-agent
npm install
node index.js
```

## Pattern 1 — `AgentIdentityTool`

Expose credential resolution as a `StructuredTool`. Add it to `createReactAgent({ tools: [tool] })` — agents can resolve credentials on demand as part of their reasoning loop.

```javascript
import { AgentIdentityTool } from '@datacules/agent-identity-langchain';

const tool = new AgentIdentityTool({ router });

// In a ReAct agent loop, the LLM calls this tool when it needs a credential
const agent = createReactAgent({
  llm,
  tools: [tool],
});
```

## Pattern 2 — `createAgentIdentityModel`

Resolve credential and get back a ready-to-use `ChatOpenAI` / `ChatAnthropic` / `ChatGoogleGenerativeAI` in one call. The API key is injected server-side — never in agent state.

```javascript
import { createAgentIdentityModel } from '@datacules/agent-identity-langchain';

const { model, resolved } = await createAgentIdentityModel(router, ctx);
const response = await model.invoke([{ role: 'user', content: 'Analyse this data...' }]);
```

## Pattern 3 — `createAgentIdentityNode` (LangGraph)

Wrap any LangGraph node to resolve the credential and inject it into graph state before the node runs. No changes to the node function itself.

```javascript
import { createAgentIdentityNode } from '@datacules/agent-identity-langchain';

const llmNode = async (state) => {
  // state.resolvedCredential is already set
  const model = buildModel(state.resolvedCredential);
  const result = await model.invoke(state.messages);
  return { messages: [result] };
};

const graph = new StateGraph(GraphAnnotation)
  .addNode('llm', createAgentIdentityNode(router, llmNode, { extractCtx: (s) => s.ctx }))
  .addEdge(START, 'llm')
  .compile();
```
