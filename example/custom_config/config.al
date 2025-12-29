{
    "agentlang": {
	"service": {
	    "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
	},
	"store": {
	    "type": "sqlite",
	    "dbname": "cc.db"
	}
    },
    "agentlang.ai": [
	{
	    "agentlang.ai/LLM": {
		"name": "llm01",
		"service": "openai",
		"config": {
		    "model": "gpt-4.1",
		    "maxTokens": 200,
		    "temperature": 0.7
		}
	    }
	},
	{
	    "agentlang.ai/LLM": {
		"name": "llm02",
		"service": "openai",
		"config": {
		    "model": "gpt-4.0"
		}
	    }
	}
    ],
    "custom_config.core": {
	"custom_config.core/Config": {
	    "server": "https://my.chat",
	    "key": "#js process.env.CHAT_SECRET"
	}
    }
}
