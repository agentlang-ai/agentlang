(component :Customer.Support.Core)

;; Note: the following settings should be in config.edn
;; { ; ...
;;  :inference-service-enabled true
;;  :publish-schema {:vectordb :pgvector
;;                   :config {:llm-provider "llm01"
;;                            :host #$ [PGVECTOR_DB_HOST "localhost"]
;;                            :port #$ [PGVECTOR_DB_PORT 5432]
;;                            :dbname #$ [PGVECTOR_DB_NAME "postgres"]
;;                            :user #$ [PGVECTOR_DB_USERNAME "postgres"]
;;                            :password #$ [PGVECTOR_DB_PASSWORD "postgres"]}}}

{:Agentlang.Core/LLM {:Name :llm01}}

{:Agentlang.Core/Agent
 {:Name :technical-support
  :LLM :llm01
  :UserInstruction
  (str "You are a support agent for a Camera store. "
       "You are supposed to handle technical queries that customers ask on camera gear. "
       "Please use the documentation from the appropriate "
       "camera manufacturer to answer these queries. "
       "If you get a query on the pricing of camera gear, respond with the text: NA")}}

{:Agentlang.Core/Agent
 {:Name :price-enquiry
  :LLM :llm01
  :UserInstruction
  (str "You are a support agent for a Camera store. "
       "Customers will raise price enquiries for camera gear. "
       "Please use the price-list from the appropriate camera "
       "manufacturer to answer the query. If you get a technical question, "
       "please respond with the simple text: NA")}}

;;;; If not provided in config, documents maybe attached to an agent as the `:Documents` attribute:
;; {
;;  :Documents
;;   [{:Title "ABC Price List"
;;     :Uri "file://./docs/abc_prices.txt"
;;     :Agent price-enquiry-agent}
;;    {:Title  "XYZ Price List"
;;     :Uri "file://./docs/xyz_prices.txt"
;;     :Agent price-enquiry-agent}]}

{:Agentlang.Core/Agent
 {:Name :camera-support-agent
  :Type :classifier
  :LLM :llm01
  :Delegates
  [{:To :technical-support}
   {:To :price-enquiry}]
  :Input :Customer.Support.Core/CameraStore}}

;; Usage:
;; POST api/Customer.Support.Core/CameraStore
;; {"Customer.Support.Core/CameraStore": {"UserInstruction": "What's the price of Panasonic G9?"}}
