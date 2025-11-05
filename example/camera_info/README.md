# SupportAgent Example

This example demonstrates how **Agentlang** can integrate structured knowledge sources — such as documentation and manuals — into intelligent conversational agents.

## Overview

The `SupportAgent` module defines an agent that acts as a **virtual camera support assistant**, capable of answering user questions by referencing relevant documents. It uses a declarative configuration to associate external text files (like price lists and user manuals) with the agent’s reasoning context.

### Documents

The following documents are linked to the agent using the `{agentlang.ai/doc}` directive:

* **price list** – contains product pricing information
* **g7x user manual** – user guide for the Canon G7X camera
* **eosr user manual** – user guide for the Canon EOS R camera

These documents provide factual grounding for the agent’s responses.

### Agent Definition

```agentlang
agent supportAgent {
    instruction "Analyse the user query and give an appropriate response.",
    documents ["price list", "g7x user manual", "eosr user manual"]
}
```

The `supportAgent` is designed to interpret natural-language queries, retrieve relevant information from the attached documents, and provide concise, contextually accurate answers.

### Public Workflow

A public workflow, `help`, exposes the agent over HTTP:

```agentlang
@public workflow help {
    {supportAgent {message help.q}}
}
```

This allows users to send questions to the agent via a simple REST call.

### Example Request

```shell copy
curl -X POST http://localhost:8080/SupportAgent/help \
  -H 'Content-Type: application/json' \
  -d '{"q": "How can I set the whitebalance in g7x?"}'
```

### Example Response

```json
"To set the white balance on a Canon G7X camera, you will need to access the white balance settings through the camera's menu. Once there, you can select from various presets such as Auto, Daylight, Cloudy, and Tungsten, or opt for a custom setting. If you want to use a custom white balance, you'll need a gray or white card for calibration. Position the card in the same lighting conditions as your subject, and follow the cameraâs instructions to set the custom white balance for accurate color representation in your photos."
```

---

### Key Takeaways

* **Knowledge-grounded responses:** The agent draws information directly from structured documents.
* **Declarative configuration:** No manual parsing or embedding setup is required.
* **Seamless integration:** The `@public` workflow automatically exposes the agent via REST.

This example shows how Agentlang turns static documentation into interactive, intelligent support systems with minimal code.
