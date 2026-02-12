{
  "agentlang": {
   "service": {
    "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
   },
   "store": {
     "type": "sqlite",
     "dbname": "pa.db"
   },
   "agentlang.ai": [
     {
        "agentlang.ai/LLM": {
         "name": "llm01",
         "service": "anthropic",
         "config": {
           "model": "claude-sonnet-4-5",
           "temperature": 0.7
         }
       }
     },
     {
        "agentlang.ai/doc": {
            "title": "company handbook",
            "url": "./example/personal_assistant/docs/company_handbook.txt"
        }
     },
     {
        "agentlang.ai/doc": {
            "title": "project guidelines",
            "url": "./example/personal_assistant/docs/project_guidelines.txt"
        }
     }
   ]
 }
}
