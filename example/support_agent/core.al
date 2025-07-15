module SupportAgent

agent supportAgent {
    instruction "Analyse the user query and give an appropriate response.",
    documents "price_list,user_manual"
}

{agentlang_ai/Document {
    title "price_list",
    content "G7X: $550, G9: $1250"},
@upsert}

{agentlang_ai/Document {
    title "user_manual",
    content "G7X: to set whitebalance, use the back-button, G9: to set whitebalance, use the menu selection"},
@upsert}

workflow help {
    {supportAgent {message help.q}}
}

// example:
// POST http://localhost:8080/SupportAgent/help
// {"q": "how can I set the whitebalance in g7x?"}