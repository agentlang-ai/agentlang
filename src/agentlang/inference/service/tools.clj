(ns agentlang.inference.service.tools
  (:require [clojure.string :as s]
            [agentlang.util :as u]
            [agentlang.util.seq :as us]
            [agentlang.util.logger :as log]
            [agentlang.component :as cn]
            [agentlang.datafmt.json :as json]
            [agentlang.lang.raw :as raw]
            [agentlang.lang.internal :as li]
            [agentlang.lang.kernel :as k]))

(defn- event-name-as-function-name [event-name]
  (let [event-name (li/make-path event-name)]
    (s/replace (s/replace (subs (str event-name) 1) "." "__p__") "/" "__")))

(defn- function-name-as-event-name [fname]
  (keyword (s/replace (s/replace fname "__p__" ".") "__" "/")))

(defn- find-root-type [attr-type]
  (let [s
        (case attr-type
          (:Now :Identity) "string"
          (cond
            (k/plain-kernel-type? attr-type)
            (s/lower-case (name attr-type))

            (k/kernel-type? attr-type)
            (s/lower-case (name (second (li/split-path attr-type))))

            (cn/find-schema attr-type) "object"

            :else nil))]
    ;; TODO: check the root-type keyword and return the appropriate type.
    ;; Do not compare strings.
    (cond
      (or (= s "uuid") (= s "datetime")) "string"
      (or (= s "double") (= s "float") (= s "int")) "number"
      :else s)))

(defn- as-tool-type [attr-type]
  (let [is-map (map? attr-type)
        spec
        (if is-map
          (if-let [xs (:oneof attr-type)]
            (cond
              (or (string? (first xs)) (keyword? xs))
              {:type "string" :enum (mapv name xs)}

              (number? (first xs))
              {:type "number" :enum xs}

              :else (u/throw-ex (str "cannot handle enum type for: " attr-type)))
            (if (:listof attr-type)
              {:type "object"}
              {:type (find-root-type (:type attr-type))}))
          {:type (find-root-type attr-type)})
        required (if is-map
                   (not (:optional attr-type))
                   true)]
    [spec required]))

(defn- attribute-to-property [event-name [attr-name attr-type]]
  (let [[tool-type required] (as-tool-type attr-type)]
    (when-not (:type tool-type)
      (u/throw-ex (str "cannot translate "
                       [attr-name attr-type] " of " event-name
                       " to an appropriate tool-type")))
    [(name attr-name) tool-type required]))

(defn event-to-tool [event-name]
  (if-let [scm (raw/find-event event-name)]
    (let [tool-name (event-name-as-function-name event-name)
          props (mapv (partial attribute-to-property event-name) (dissoc scm :meta))]
      {:type "function"
       :function
       {:name tool-name
        :description (or (cn/docstring event-name) tool-name)
        :parameters
        {:type "object"
         :properties (into {} (mapv (comp vec (partial take 2)) props))
         :required (vec (mapv first (filter last props)))}}})
    (log/warn (str "no schema found for event: " event-name))))

(defn all-tools-for-component [component]
  (us/nonils (mapv event-to-tool (cn/event-names component))))

(defn tool-call-to-pattern [tool-call]
  (if-let [{fname "name" args "arguments"} (get tool-call "function")]
    {(function-name-as-event-name fname) (json/decode args)}
    (u/throw-ex (str "Invalid tool-call: " tool-call))))