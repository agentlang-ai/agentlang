(ns fractl.util.remote
  (:require [fractl.util :as u]
            [fractl.util.http :as uh]
            [fractl.util.auth :as au]
            [fractl.lang.internal :as li]
            [fractl.component :as cn]))

(defn- event-name [event-type inst]
  (let [[component inst-name] (li/split-path (cn/instance-type inst))]
    (str (name component) "/" (name event-type) "_" (name inst-name))))

(defn- remote-request [event-type mkobj host options inst]
  (let [en (event-name event-type inst)
        url (str host uh/entity-event-prefix en)
        request-obj {en (if mkobj
                          (mkobj inst)
                          {:Instance inst})}]
    (uh/POST url options request-obj)))

(defn- mk-lookup-obj [inst]
  {cn/id-attr (cn/id-attr inst)})

(def remote-upsert (partial remote-request :Upsert nil))
(def remote-get (partial remote-request :Lookup mk-lookup-obj))

(defn remote-delete [host options arg]
  (remote-request
   :Delete nil host options
   (if (map? arg)
     [(cn/instance-type arg) (cn/id-attr arg)]
     arg)))

(defn remote-query [host options query]
  (let [response (uh/POST
                  (str host uh/query-prefix)
                  options {:Query query})]
    (if (map? response)
      (first (:body response))
      response)))

(defn remote-eval
  ([host res arg event-inst]
   (uh/POST (str host res)
            (uh/normalize-post-options arg) event-inst))
  ([host arg event-inst]
   (remote-eval host uh/dynamic-eval-prefix arg event-inst)))

(defn remote-login [host callback event-inst]
  (remote-eval host uh/login-prefix callback event-inst))

(defn- reach-result [raw-result]
  (cond
    (map? raw-result) raw-result
    (seqable? raw-result) (reach-result (first raw-result))
    :else {}))

(defn- ok-result [r]
  (when (= :ok (:status r))
    (:result r)))

(defn remote-eval-with-result
  ([host event-inst predic]
   (let [rawr (remote-eval host nil event-inst)
         r (ok-result (reach-result rawr))]
     (if (predic event-inst r)
       r
       (u/throw-ex (str "unexpected result " rawr " for event " event-inst)))))
  ([event-inst predic]
   (remote-eval-with-result "http://localhost:8080" event-inst predic)))

(def => remote-eval-with-result)
