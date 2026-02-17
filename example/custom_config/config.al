{
  "agentlang": {
    "service": {
      "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
      "type": "sqlite",
      "dbname": "cc.db"
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
          "provider": "s3",
          "config": {
            "region": "#js process.env.AWS_REGION",
            "accessKeyId": "#js process.env.AWS_ACCESS_KEY_ID",
            "secretAccessKey": "#js process.env.AWS_SECRET_ACCESS_KEY"
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
        "url": "document-service://f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/550e8400-e29b-41d4-a716-446655440000.pdf",
        "retrievalConfig": {
          "provider": "document-service",
          "config": {
            "baseUrl": "#js process.env.DOCUMENT_SERVICE_URL",
            "authToken": "#js process.env.DOCUMENT_SERVICE_AUTH_TOKEN"
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
        "title": "company policies",
        "retrievalConfig": {
          "provider": "document-service",
          "config": {
            "baseUrl": "#js process.env.DOCUMENT_SERVICE_URL",
            "appName": "my-app",
            "authToken": "#js process.env.DOCUMENT_SERVICE_AUTH_TOKEN"
          }
        },
        "embeddingConfig": {
          "provider": "openai",
          "model": "text-embedding-3-small",
          "chunkSize": 1000,
          "chunkOverlap": 200
        }
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
