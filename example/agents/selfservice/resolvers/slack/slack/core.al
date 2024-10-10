(component
 :Slack.Core
 {:clj-import '[(:require [clojure.string :as s]
                          [agentlang.component :as cn]
                          [agentlang.util :as u]
                          [agentlang.util.http :as http]
                          [agentlang.util.logger :as log]
                          [agentlang.datafmt.json :as json]
                          [agentlang.evaluator :as ev]
                          [agentlang.lang.internal :as li])]})

(entity
 :Chat
 {:channel {:type :String :guid true}
  ;;:default (System/getenv "SLACK_CHANNEL_ID")}
  :text :String
  :mrkdwn {:type :Boolean :default true}
  :thread {:type :String :optional true}})

(def test-mode (System/getenv "SELFSERVICE_TEST_MODE"))

(def slack-api-key (System/getenv "SLACK_API_KEY"))

(def slack-base-url "https://slack.com/api")

(defn get-url [endpoint] (str slack-base-url endpoint))

(defn- handle-response [response result]
  (let [status (:status response)
        body (:body response)]
    (if (<= 200 status 299)
      (let [output-decoded (json/decode body)]
        (if (:ok output-decoded)
          (assoc result :thread (:ts output-decoded))
          (throw (ex-info "Request failed. " output-decoded))))
      (throw (ex-info "Request failed. " {:status status :body body})))))

(def ^:private http-opts {:headers {"Authorization" (str "Bearer " slack-api-key)
                                  "Content-Type" "application/json"}})

(defn- extract-approval [response]
  (let [status (:status response)
        body (:body response)]
    (when (= 200 status)
      (let [output-decoded (json/decode body)]
        (when (:ok output-decoded)
          (let [messages (:messages output-decoded)]
            (when (>= (count messages) 2)
              (s/lower-case (s/trim (:text (second messages)))))))))))

(defn wait-for-reply [{channel :channel ts :thread}]
  (let [url (get-url (str "/conversations.replies?ts=" ts "&channel=" channel))
        f (fn [] (Thread/sleep (* 10 1000)) (http/do-get url http-opts))
        r
        (loop [response (f), retries 50]
          (if (zero? retries)
            "reject"
            (if-let [r (extract-approval response)]
              r
              (recur (f) (dec retries)))))]
    (log/debug (str "slack-resolver/wait-for-reply: " r))
    r))

(defn- create-chat [api-name instance]
  (let [data (dissoc instance :-*-type-*- :type-*-tag-*- :thread)
        url (get-url (str "/" api-name))
        response (http/do-post url http-opts data)
        new-instance (handle-response response instance)]
    (assoc new-instance :text (wait-for-reply new-instance))))

(defn- print-instance [inst]
  (println "** " (cn/instance-type-kw inst) " **")
  (u/pprint (cn/instance-attributes inst))
  inst)

(defn create-entity [instance]
  (if test-mode
    (print-instance (assoc instance :text (u/trace ">>> " (rand-nth ["this request is approved" "this is rejected"]))))
    (let [[c n] (li/split-path (cn/instance-type instance))]
      (if (= n :Chat)
        (create-chat "chat.postMessage" instance)
        instance))))

(resolver
 :Slack.Core/Resolver
 {:with-methods {:create create-entity}
  :paths [:Slack.Core/Chat]})
