{
    "agentlang": {
	"service": {
	    "port": 8080,
	    "httpFileHandling": false
	},
	"store": {
	    "type": "sqlite",
	    "dbname": "sdr.db"
	},
	"monitoring": {
	    "enabled": true
	},
	"retry": [
	    {
		"name": "classifyRetry",
		"attempts": 3,
		"backoff": {
		    "strategy": "linear",
		    "delay": 2,
		    "magnitude": "seconds",
		    "factor": 2
		}
	    }
	]
    },
    "agentlang.ai": [
	{
	    "agentlang.ai/LLM": {
                "name": "sonnet_llm",
                "service": "anthropic",
                "config": {
                    "model": "claude-sonnet-4-5"
                }
            }
	},
	{
	    "agentlang.ai/LLM": {
                "name": "gpt_llm",
                "service": "openai",
                "config": {
                    "model": "gpt-5.2"
                }
            }
	}
    ]
}
