module SupportAgent

{agentlang.ai/doc {
    title "price list",
    url "./example/support_agent/docs/prices.txt"}}

{agentlang.ai/doc {
    title "g7x user manual",
    url "./example/support_agent/docs/g7x_manual.txt"}}

{agentlang.ai/doc {
    title "eosr user manual",
    url "./example/support_agent/docs/eosr_manual.txt"}}

agent supportAgent {
    instruction "Analyse the user query and give an appropriate response.",
    documents ["price list", "g7x user manual", "eosr user manual"]
}

@public workflow help {
    {supportAgent {message help.q}}
}

// example:
// POST http://localhost:8080/SupportAgent/help
// {"q": "how can I set the whitebalance in g7x?"}
