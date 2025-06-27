module SupportAgent

{agentlang_ai/llm {name "supportLLM"}}

{agentlang_ai/agent {
  name "supportAgent",
  instruction "Analyse the user query and give an appropriate response.",
  documents ["price_list", "user_manual"],
  llm "supportLLM"}}

workflow createDocs {
    {agentlang_ai/document {
        title "price_list",
        content "G7X: $550, G9: $1250"}};
    {agentlang_ai/document {
        title "user_manual",
        content "G7X: to set whitebalance, use the back-button, G9: to set whitebalance, use the menu selection"}}
}

workflow help {
    {supportAgent {message help.q}}
}