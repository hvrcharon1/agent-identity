<p align="center">
  <img src="../../../assets/logo.svg" alt="Agent Identity — by Datacules LLC" width="360"/>
</p>

# `@datacules/agent-identity-langchain`

LangChain and LangGraph integration for the agent-identity framework. Resolves credentials server-side and injects them into `ChatAnthropic`, `ChatOpenAI`, and other LangChain model classes before any LLM call.

## Install

```bash
npm install @datacules/agent-identity-langchain @datacules/agent-identity
```

## LangChain: `createAgentIdentityModel`

```typescript
import { createAgentIdentityModel } from '@datacules/agent-identity-langchain';

const { getModel, resolved } = createAgentIdentityModel(ctx, {
  credentials,
  rules,
  logger,
  fetchSecret: async (ref: string) => vault.getSecret(ref), // server-side only
});

const model = await getModel();  // ChatAnthropic or ChatOpenAI, API key injected
const response = await model.invoke('Summarise this document.');

console.log(resolved.resolvedFor); // for audit trail
```

## LangGraph: `createAgentIdentityNode`

Drop-in `StateGraph` node that resolves credentials and writes them to graph state before any LLM call:

```typescript
import { StateGraph }              from '@langchain/langgraph';
import { createAgentIdentityNode } from '@datacules/agent-identity-langchain';

const identityNode = createAgentIdentityNode({ credentials, rules, fetchSecret, logger });

const graph = new StateGraph({
  channels: {
    agentContext:         null,
    resolvedCredential:   null,
    messages:             null,
  },
})
  .addNode('identity', identityNode)  // reads state.agentContext, writes state.resolvedCredential
  .addNode('llm', llmNode)
  .addEdge('identity', 'llm')
  .addEdge(START, 'identity');

const app = graph.compile();
const result = await app.invoke({ agentContext: ctx, messages: [] });
```

## Custom `fetchSecret`

`fetchSecret` is the only touch-point between agent-identity and your vault. It receives the opaque `ref` string from the resolved credential and must return the raw secret (API key, bearer token, etc.). Never expose this to the model or the client:

```typescript
async function fetchSecret(ref: string): Promise<string> {
  const secret = await vaultClient.read(ref);
  return secret.data.value;
}
```

---

Part of the [agent-identity monorepo](https://github.com/hvrcharon1/agent-identity) by [Datacules LLC](https://datacules.com).
