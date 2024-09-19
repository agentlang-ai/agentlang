(ns agentlang.inference.service.model
  (:require [clojure.string :as s]
            [clojure.set :as set]
            [agentlang.lang :refer [component
                                    dataflow
                                    entity
                                    event
                                    record
                                    attribute
                                    relationship]]
            [agentlang.component :as cn]
            [agentlang.util :as u]
            [agentlang.util.seq :as us]
            [agentlang.evaluator :as e]
            [agentlang.lang.internal :as li]))

(component :Agentlang.Core)

(entity
 :Agentlang.Core/LLM
 {:Type {:type :String :default "openai"} ; e.g "openai"
  :Name {:type :String :guid true :default #(us/generate-code 5)}
  :Config {:type :Map :optional true}
  ;; example config for openai:
  ;; {:ApiKey (agentlang.util/getenv "OPENAI_API_KEY")
  ;;  :EmbeddingApiEndpoint "https://api.openai.com/v1/embeddings"
  ;;  :EmbeddingModel "text-embedding-3-small"
  ;;  :CompletionApiEndpoint "https://api.openai.com/v1/chat/completions"
  ;;  :CompletionModel "gpt-3.5-turbo"}
  })

(dataflow
 :Agentlang.Core/FindLLM
 {:Agentlang.Core/LLM
  {:Name? :Agentlang.Core/FindLLM.Name}})

(def ^:private doc-scheme-handlers {"file" slurp})
(def ^:private doc-schemes (keys doc-scheme-handlers))
(def ^:private scheme-suffix "://")

(defn- document-resource-scheme [s]
  (when-let [idx (s/index-of s scheme-suffix)]
    (subs s 0 idx)))

(defn- document-uri? [s]
  (and (string? s)
       (when-let [scm (document-resource-scheme s)]
         (some #{scm} doc-schemes))))

(defn- document-resource-name [s]
  (when-let [idx (s/index-of s scheme-suffix)]
    (subs s (+ idx 3))))

(defn read-document-resource [uri]
  (when-let [h (get doc-scheme-handlers (document-resource-scheme uri))]
    (h (document-resource-name uri))))

(entity
 :Agentlang.Core/Document
 {:Id {:type :UUID :default u/uuid-string :guid true}
  :AppUuid {:type :UUID :default u/get-app-uuid}
  :Agent {:type :String :optional true}
  :Uri {:check document-uri?}
  :Title :String
  :Content '(agentlang.inference.service.model/read-document-resource :Uri)})

(defn- agent-messages? [xs]
  (if (seq xs)
    (every? #(and (map? %)
                  (= 2 (count (keys %)))
                  (some #{(:role %)} #{:system :user :assistant})
                  (string? (:content %)))
            xs)
    true))

(defn- tool-components-list? [xs]
  (and (vector? xs) (every? #(or (string? %) (li/name? %)) xs)))

(def ^:private ft-chain-of-thought (str "In your response please include the step-by-step thought-process "
                                        "that led you to your answer or conclusion."))
(def ^:private ft-self-critique (str "In your response please include a self-criticism of your answer or conclusion."
                                     "You may use questions like \"what's a different way to solve this problem?\","
                                     "\"Is there an unconventional solution?\" etc for formulating your self-critique."))

(def ^:private feature-set {"chain-of-thought" ft-chain-of-thought
                            "self-critique" ft-self-critique})

(def ^:private feature-set-keys (set (keys feature-set)))

(defn- feature-list? [xs]
  (when (seq xs)
    (and (vector? xs)
         (= feature-set-keys (set/union feature-set-keys (set xs))))))

(defn get-feature-prompt [ft] (get feature-set ft ""))

(entity
 :Agentlang.Core/Agent
 {:Name {:type :String :guid true}
  :Type {:type :String :default "chat"}
  :Features {:check feature-list? :optional true}
  :AppUuid {:type :UUID :default u/get-app-uuid}
  :ChatUuid {:type :UUID :default u/uuid-string}
  :UserInstruction {:type :String :optional true}
  :ToolComponents {:check tool-components-list? :optional true}
  :Extension {:type :Map :optional true}
  :Context {:type :Map :optional true}
  :Response {:type :Any :read-only true}
  :CacheChatSession {:type :Boolean :default true}})

(def ^:private agent-callbacks (atom nil))

(defn- set-agent-callback! [tag agent-name f]
  (let [cbs (assoc (get @agent-callbacks tag) agent-name f)]
    (swap! agent-callbacks assoc tag cbs)))

(defn- get-agent-callback [tag agent-instance]
  (get-in @agent-callbacks [tag (:Name agent-instance)]))

(def agent-response-handler (partial get-agent-callback :rh))
(def agent-prompt-fn (partial get-agent-callback :pfn))
(def set-agent-response-handler! (partial set-agent-callback! :rh))
(def set-agent-prompt-fn! (partial set-agent-callback! :pfn))

(relationship
 :Agentlang.Core/AgentDelegate
 {:meta {:between [:Agentlang.Core/Agent
                   :Agentlang.Core/Agent
                   :as [:From :To]]}
  :Preprocessor {:type :Boolean :default false}})

(attribute
 :Agentlang.Core/Delegates
 {:extend :Agentlang.Core/Agent
  :type :Agentlang.Core/AgentDelegate
  :relationship :Agentlang.Core/AgentDelegate})

(defn concat-results [rs] (vec (apply concat rs)))

(dataflow
 :Agentlang.Core/FindAgentDelegates
 {:Agentlang.Core/AgentDelegate
  {:From? :Agentlang.Core/FindAgentDelegates.Agent
   :Preprocessor? :Agentlang.Core/FindAgentDelegates.Preprocessor}
  :as :Delegates}
 [:for-each :Delegates
  {:Agentlang.Core/Agent
   {:Name? :%.To}}
  :as :Rs]
 [:eval '(agentlang.inference.service.model/concat-results :Rs)])

(entity
 :Agentlang.Core/ChatSession
 {:Id {:type :UUID :guid true :default u/uuid-string}
  :Messages {:check agent-messages?}})

(relationship
 :Agentlang.Core/AgentChatSession
 {:meta {:contains [:Agentlang.Core/Agent :Agentlang.Core/ChatSession]}})

(attribute
 :Agentlang.Core/Chat
 {:extend :Agentlang.Core/Agent
  :type :Agentlang.Core/ChatSession
  :relationship :Agentlang.Core/AgentChatSession})

(dataflow
 :Agentlang.Core/LookupAgentChatSessions
 {:Agentlang.Core/ChatSession? {}
  :-> [[:Agentlang.Core/AgentChatSession?
        :Agentlang.Core/LookupAgentChatSessions.Agent]]})

(dataflow
 :Agentlang.Core/ResetAgentChatSessions
 [:eval '(agentlang.inference.service.model/reset-agent-chat-session
          :Agentlang.Core/ResetAgentChatSessions.Agent)])

(defn- tool-param? [x]
  (and (map? x)
       (string? (:type x))
       (map? (:properties x))
       (if-let [r (:required x)]
         (every? string? r)
         true)))

(entity
 :Agentlang.Core/Tool
 {:name {:type :String :guid true}
  :type {:type :String :default "function"}
  :description {:type :String :optional true}
  :parameters {:check tool-param? :optional true}})

(relationship
 :Agentlang.Core/AgentLLM
 {:meta {:between [:Agentlang.Core/Agent :Agentlang.Core/LLM]}})

(attribute
 :Agentlang.Core/LLM
 {:extend :Agentlang.Core/Agent
  :type :Agentlang.Core/LLM
  :relationship :Agentlang.Core/AgentLLM
  :order 0})

(relationship
 :Agentlang.Core/AgentTool
 {:meta {:between [:Agentlang.Core/Agent :Agentlang.Core/Tool]}})

(attribute
 :Agentlang.Core/Tools
 {:extend :Agentlang.Core/Agent
  :type :Agentlang.Core/Tool
  :relationship :Agentlang.Core/AgentTool})

(relationship
 :Agentlang.Core/AgentDocument
 {:meta {:between [:Agentlang.Core/Agent :Agentlang.Core/Document]}})

(dataflow
 :Agentlang.Core/AddAgentDocument
 {:Agentlang.Core/Document
  {:Agent :Agentlang.Core/AddAgentDocument.Agent
   :Uri :Agentlang.Core/AddAgentDocument.Uri
   :Title :Agentlang.Core/AddAgentDocument.Title}
  :as :Doc}
 {:Agentlang.Core/AgentDocument {:Agent :Doc.Agent :Document :Doc.Id}}
 :Doc)

(attribute
 :Agentlang.Core/Documents
 {:extend :Agentlang.Core/Agent
  :type :Agentlang.Core/Document
  :relationship :Agentlang.Core/AgentDocument})

(dataflow
 :Agentlang.Core/LLMsForAgent
 {:Agentlang.Core/AgentLLM
  {:Agent? :Agentlang.Core/LLMsForAgent.Agent}})

(dataflow
 :Agentlang.Core/AgentTools
 {:Agentlang.Core/AgentTool
  {:Agent? :Agentlang.Core/AgentTools.Agent} :as :R}
 [:for-each :R
  {:Agentlang.Core/Tool
   {:name? :%.Tool}}])

(dataflow
 :Agentlang.Core/HasAgentDocuments
 {:Agentlang.Core/AgentDocument
  {:Agent? :Agentlang.Core/HasAgentDocuments.Agent}})

(dataflow
 :Agentlang.Core/AgentDocuments
 {:Agentlang.Core/AgentDocument
  {:Agent? :Agentlang.Core/AgentDocuments.Agent} :as :R}
 [:for-each :R
  {:Agentlang.Core/Document
   {:Id? :%.Document}}])

(defn- eval-event
  ([event callback atomic?]
   (when-let [result (first ((if atomic?
                               e/eval-all-dataflows-atomic
                               e/eval-all-dataflows)
                             event))]
     (when (= :ok (:status result))
       (callback (:result result)))))
  ([event callback] (eval-event event callback false))
  ([event] (eval-event event identity)))

(defn- find-agent-delegates [preproc agent-instance]
  (eval-event
   {:Agentlang.Core/FindAgentDelegates
    {:Agent (:Name agent-instance)
     :Preprocessor preproc}}))

(def find-agent-pre-delegates (partial find-agent-delegates true))
(def find-agent-post-delegates (partial find-agent-delegates false))

(defn- lookup-for-agent [event-name proc agent-instance]
  (eval-event
   {event-name
    {:Agent (:Name agent-instance)}}
   #(mapv proc %)))

(def lookup-llms-for-agent (partial lookup-for-agent :Agentlang.Core/LLMsForAgent :LLM))

(defn ensure-llm-for-agent [agent-instance]
  (if-let [llm (first (lookup-llms-for-agent agent-instance))]
    llm
    (u/throw-ex (str "No LLM attached to agent " (:Name agent-instance)))))

(defn- normalize-tool [tool]
  (let [tool (if (map? tool) tool (first tool))
        attrs (cn/instance-attributes tool)
        tp (:type tool)]
    {:type tp (keyword tp) (dissoc attrs :type)}))

(def lookup-agent-tools (partial lookup-for-agent :Agentlang.Core/AgentTools normalize-tool))

(defn- normalize-docchunk [docchunk]
  (let [docchunk (if (map? docchunk) docchunk (first docchunk))]
    (str (:Title docchunk) " " (:Content docchunk))))

(def lookup-agent-docs (partial lookup-for-agent :Agentlang.Core/AgentDocuments normalize-docchunk))
(def has-agent-docs? (partial lookup-for-agent :Agentlang.Core/HasAgentDocuments seq))

(defn add-agent-document [agent-name doc-title doc-uri]
  (eval-event
   {:Agentlang.Core/AddAgentDocument
    {:Agent agent-name
     :Uri doc-uri
     :Title doc-title}}))

(defn lookup-agent-chat-session [agent-instance]
  (eval-event
   {:Agentlang.Core/LookupAgentChatSessions
    {:Agent agent-instance}}
   first))

(defn update-agent-chat-session [chat-session messages]
  (eval-event
   {:Agentlang.Core/Update_ChatSession
    {li/path-attr (li/path-attr chat-session)
     :Data {:Messages messages}}}
   identity true))

(defn reset-agent-chat-session [agent]
  (if (string? agent)
    (when-let [agent-instance (eval-event
                      {:Agentlang.Core/Lookup_Agent
                       {:Name agent}}
                      first)]
      (reset-agent-chat-session agent-instance))
    (when-let [sess (lookup-agent-chat-session agent)]
      (let [msgs (vec (filter #(= :system (:role %)) (:Messages sess)))]
        (update-agent-chat-session sess msgs)))))
