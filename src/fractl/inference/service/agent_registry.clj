(ns fractl.inference.service.agent-registry
  (:require [fractl.util :as u]
            [fractl.inference.service.logic :as logic]))

(def ^:private agent-registry (atom {}))

(defn register-agent-handler [agent-type handler]
  (swap! agent-registry assoc agent-type handler)
  agent-type)

(defn fetch-agent-handler [agent-type]
  (get @agent-registry agent-type))

(register-agent-handler "planner" logic/handle-planner-agent)
(register-agent-handler "analyzer" logic/handle-analysis-agent)
(register-agent-handler "chat" logic/handle-chat-agent)
(register-agent-handler "eval" logic/handle-chat-agent)

(defn- cleanup-agent [inst]
  (dissoc inst :Context))

(defn handle-generic-agent [instance]
  (if-let [handler (fetch-agent-handler (:Type instance))]
    (cleanup-agent (assoc instance :Response (handler instance)))
    (u/throw-ex (str "No handler for agent type " (:Type instance)))))

(logic/set-generic-agent-handler! handle-generic-agent)
