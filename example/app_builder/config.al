{
    "agentlang.ai": [
	{
	    "agentlang.ai/LLM": {
		"name": "sonnet_llm",
		"service": "anthropic",
		"config": {
		    "model": "claude-sonnet-4-5",
                    "maxTokens": 21333,
                    "enableThinking": false,
                    "temperature": 0.7,
                    "budgetTokens": 8192,
                    "enablePromptCaching": true,
                    "stream": false,
                    "enableExtendedOutput": true
		}
            }
	},
	{
            "agentlang.ai/LLM": {
		"name": "haiku_llm",
		"service": "anthropic",
		"config": {
                    "model": "claude-haiku-4-5",
                    "maxTokens": 21333,
                    "enableThinking": false,
                    "temperature": 0.7,
                    "budgetTokens": 8192,
                    "enablePromptCaching": true,
                    "stream": false,
                    "enableExtendedOutput": true
		}
            }
	}
    ]
}
