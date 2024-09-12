(ns agentlang.lang.kernel
  (:require [agentlang.util :as u]
            [agentlang.lang.internal :as li]
            [agentlang.lang.datetime :as dt]
            [agentlang.component :as cn]))

(def kernel-lang-component :Agentlang.Kernel.Lang)

(defn kernel-string?
  ([s rgex-s]
   (re-matches (re-pattern rgex-s) s))
  ([s] (string? s)))

(defn kernel-float? [x]
  #?(:clj
     (instance? Float x)
     :cljs
     (float? x)))

(defn kernel-double? [x]
  #?(:clj
     (instance? Double x)
     :cljs
     (float? x)))

(def date-time? dt/parse-date-time)
(def date? dt/parse-date)
(def time? dt/parse-time)

(defn UUID? [s]
  (or (u/uuid-from-string s) (uuid? s)))

(def any-obj? (constantly true))

(defn edn? [x]
  (or (vector? x) (map? x)
      (symbol? x) (keyword? x)
      (string? x) (number? x)
      (boolean? x) (nil? x)
      (list? x) (set? x)))

(defn path?
  "Encode a path in a agentlang record. Examples:
     :C, :C/E, :C/E.R. Paths may also be represented
   as strings - \"C/E.R\""
  [x]
  (let [k (cond
            (string? x)
            (keyword x)

            (vector? x)
            (map #(if (string? %)
                    (keyword %)
                    %)
                 x)
            :else x)]
    (every?
     li/name?
     (li/split-path k))))

(def ^:private email-pattern
  #"[a-zA-Z0-9!#$%&'*+/=?^_`{|}~\-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~\-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9\-]*[a-zA-Z0-9])?")

(defn email? [x]
  (and (string? x)
       (re-matches email-pattern x)))

(def numeric-types
  [:Agentlang.Kernel.Lang/Int
   :Agentlang.Kernel.Lang/Int64
   :Agentlang.Kernel.Lang/BigInteger
   :Agentlang.Kernel.Lang/Float
   :Agentlang.Kernel.Lang/Double
   :Agentlang.Kernel.Lang/Decimal])

;; TODO: load types from the kernel model by calling
;; appropriate component namespace (cn) functions
(def type-names
  (concat
   numeric-types
   [:Agentlang.Kernel.Lang/String
    :Agentlang.Kernel.Lang/Keyword
    :Agentlang.Kernel.Lang/Path
    :Agentlang.Kernel.Lang/DateTime
    :Agentlang.Kernel.Lang/Date
    :Agentlang.Kernel.Lang/Time
    :Agentlang.Kernel.Lang/UUID
    :Agentlang.Kernel.Lang/Boolean
    :Agentlang.Kernel.Lang/Record
    :Agentlang.Kernel.Lang/Entity
    :Agentlang.Kernel.Lang/Event
    :Agentlang.Kernel.Lang/Any
    :Agentlang.Kernel.Lang/Email
    :Agentlang.Kernel.Lang/Password
    :Agentlang.Kernel.Lang/Map
    :Agentlang.Kernel.Lang/Edn
    :Agentlang.Kernel.Lang/EventContext
    :Agentlang.Kernel.Lang/Identity
    :Agentlang.Kernel.Lang/Now]))

(def ^:private plain-types
  (into {} (mapv (fn [t] [(second (li/split-path t)) t]) type-names)))

(defn kernel-type? [n]
  (some #{n} type-names))

(defn plain-kernel-type? [n]
  (n plain-types))

(defn normalize-kernel-type [t]
  (or (t plain-types) t))

(defn numeric-type? [t]
  (if t
    (if (some #{t} numeric-types)
      true
      false)
    false))

(defn find-root-attribute-type [n]
  (if (kernel-type? n)
    n
    (when-let [ascm (cn/find-attribute-schema n)]
      (cond
        (:listof ascm)
        :Agentlang.Kernel.Lang/List

        (:oneof ascm)
        :Agentlang.Kernel.Lang/String

        :else
        (when-let [t (if (map? ascm) (:type ascm) ascm)]
          (if (kernel-type? t)
            t
            (find-root-attribute-type t)))))))

(def type-predicate first)
(def type-default-value second)

(def ^:private event-context-type [:Agentlang.Kernel.Lang/EventContext
                                   {:type :Agentlang.Kernel.Lang/Map
                                    :optional true}])

(defn event-context-attribute-name []
  (first event-context-type))

(defn event-context-attribute-schema []
  (second event-context-type))
