{
  "agentlang": {
    "service": {
      "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
      "type": "sqlite",
      "dbname": "cc.db"
    },
    "vectorStore": {
      "type": "lancedb",
      "dbname": "./data/vector-store/cc-vectors.lance"
    },
    "knowledgeGraph": {
      "serviceUrl": "#js process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3000'"
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
        "name": "llm01",
        "service": "openai",
        "config": {
          "model": "gpt-5.2",
          "maxTokens": 100000,
          "temperature": 0.7
        }
      }
    },
    {
      "agentlang.ai/LLM": {
        "name": "llm02",
        "service": "openai",
        "config": {
          "model": "gpt-4o"
        }
      }
    },
    {
      "agentlang.ai/doc": {
        "title": "price list",
        "url": "./example/camera_info/docs/prices.txt"
      }
    },
    {
      "agentlang.ai/doc": {
        "title": "company handbook",
        "url": "s3://my-bucket/docs/handbook.pdf",
        "retrievalConfig": {
          "provider": "knowledge-service",
          "config": {
            "baseUrl": "#js process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3000'"
          }
        },
        "embeddingConfig": {
          "provider": "openai",
          "model": "text-embedding-3-small",
          "chunkSize": 1000,
          "chunkOverlap": 200
        }
      }
    },
    {
      "agentlang.ai/doc": {
        "title": "api documentation",
        "url": "https://docs.example.com/api.md"
      }
    },
    {
      "agentlang.ai/doc": {
        "title": "product manual",
        "url": "./docs/product-manual.pdf",
        "retrievalConfig": {
          "provider": "knowledge-service",
          "config": {
            "baseUrl": "#js process.env.KNOWLEDGE_SERVICE_URL || 'http://localhost:3000'"
          }
        },
        "embeddingConfig": {
          "provider": "openai",
          "model": "text-embedding-3-small",
          "chunkSize": 1000,
          "chunkOverlap": 200
        }
      }
    },
    {
      "agentlang.ai/doc": {
        "title": "FAQ",
        "url": "./docs/faq.md"
      }
    },
    {
      "agentlang.ai/topic": {
        "name": "product-knowledge",
        "documents": ["price list", "product manual", "company handbook"]
      }
    },
    {
      "agentlang.ai/topic": {
        "name": "support-knowledge",
        "documents": ["FAQ", "api documentation"]
      }
    }
  ],
  "custom_config": {
    "custom_config.core/Config": {
      "server": "https://my.chat",
      "key": "#js process.env.CHAT_SECRET"
    }
  }
}
