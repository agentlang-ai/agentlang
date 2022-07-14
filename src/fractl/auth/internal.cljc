(ns fractl.auth.internal)

(def service-tag :service)

(defmulti make-client service-tag)
(defmulti upsert-user service-tag)
(defmulti delete-user service-tag)

(def client-key :client)
(def instance-key :instance)

(defn call-upsert-user [client arg user-inst]
  (upsert-user (assoc arg client-key client instance-key user-inst)))

(defn call-delete-user [client arg user-inst]
  (delete-user (assoc arg client-key client instance-key user-inst)))
