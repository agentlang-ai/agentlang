(ns fractl.inference.embeddings.core
  (:require [fractl.util :as u]
            [fractl.util.logger :as log]
            [fractl.inference.embeddings.internal.generator :as g]
            [fractl.inference.embeddings.internal.queue :as queue]
            [fractl.inference.embeddings.internal.registry :as r]
            [fractl.inference.embeddings.pgvector]
            [fractl.inference.embeddings.protocol :as p]))

(declare embed-schema)

(defn init [config]
  (if-let [db (r/get-db config)]
    (queue/process (partial embed-schema db))
    (u/throw-ex (str "Unsupported embbeddings database type: " (:vectordb config))))
  config)

(defn- rearrange-data [data-edn]
  (mapv (fn [[tool-name tool-spec]]
          {:tool-name tool-name
           :tool-spec tool-spec})
        data-edn))

(defn- send-data-for-embedding [tool-seq db schema-obj]
  (mapv #(p/embed-tool db (merge schema-obj %)) tool-seq))

(defn embed-schema [db {app-uuid :app-uuid operation :operation
                        tag :tag type :type schema :schema :as obj}]
  (when-not db (u/throw-ex "Embedding-db not initialized"))
  (let [app-uuid (or app-uuid (u/get-app-uuid))
        meta-content-data obj
        schema-obj (assoc obj :meta-content meta-content-data)]
    (log/info (str "embedding schema: " [operation tag type]))
    (if (= tag 'component)
      (p/embed-tool db schema-obj)
      (-> (g/generate-tool-for-data tag type schema)
          (rearrange-data)
          (send-data-for-embedding db schema-obj)))))

(defn embed-tool
  ([db spec]
   (p/embed-tool db spec))
  ([spec]
   (p/embed-tool (r/get-db) spec)))

(defn update-tool
  ([db spec]
   (p/update-tool db spec))
  ([spec]
   (p/update-tool (r/get-db) spec)))

(defn delete-tool
  ([db spec]
   (p/delete-tool db spec))
  ([spec]
   (p/delete-tool (r/get-db) spec)))

(defn embed-document-chunk
  ([db app-uuid text-chunk]
   (p/embed-document-chunk db app-uuid text-chunk))
  ([app-uuid text-chunk]
   (p/embed-document-chunk (r/get-db) app-uuid text-chunk)))

(defn get-document-classname
  ([db app-uuid]
   (p/get-document-classname db app-uuid))
  ([app-uuid]
   (p/get-document-classname (r/get-db) app-uuid)))

(defn get-planner-classname
  ([db app-uuid]
   (p/get-planner-classname db app-uuid))
  ([app-uuid]
   (p/get-planner-classname (r/get-db) app-uuid)))

(defn find-similar-objects
  ([db query-spec limit]
   (p/find-similar-objects db query-spec limit))
  ([query-spec limit]
   (p/find-similar-objects (r/get-db) query-spec limit)))
