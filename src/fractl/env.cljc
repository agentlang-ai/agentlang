(ns fractl.env
  "The environment of instance and variable bindings,
  used for pattern resolution."
  (:require [fractl.util :as u]
            [fractl.util.seq :as su]
            [fractl.lang.internal :as li]
            [fractl.component :as cn]))

(def EMPTY {})

(defn make
  [store resolver]
  (assoc EMPTY
         :store store
         :resolver resolver))

(defn get-store
  [self]
  (:store self))

(defn get-resolver
  [self]
  (:resolver self))

;; !!NOTE!! This assertion may be removed once the
;; pattern-match algorithm is fully implemented.
;; This check ensures that the compiler never pushes
;; unparsed names of the form :Module/Entity to the runtime
;; environment.
(defn- assert-parsed-rec-name [rec-name]
  (if-not (vector? rec-name)
    (u/throw-ex (str "not a parsed record name - " rec-name))
    rec-name))

(defn get-instances
  "Fetch the instances of the specified record type.
   Ensures that only parsed record-names are passed to the
   runtime environment."
  [env rec-name]
  (get env (assert-parsed-rec-name rec-name)))

(defn bind-instance
  ([env rec-name instance]
   (let [insts (or (get-instances env rec-name) (list))]
     (assoc env rec-name (conj insts instance))))
  ([env instance]
   (bind-instance
    env (li/split-path (cn/instance-name instance))
    instance)))

(defn bind-instances [env rec-name instances]
  (let [env (assoc env rec-name (list))]
    (su/move-all instances env #(bind-instance %1 rec-name %2))))

(def bind-instance-to-alias assoc)
(def bind-to-alias assoc)
(def lookup-by-alias (comp cn/maybe-deref get))

(def rbac-check :*rbac-check*)

(defn bind-rbac-check [env f]
  (bind-to-alias env rbac-check f))

(defn lookup-instance [env rec-name]
  (cn/maybe-deref (peek (get-instances env rec-name))))

(defn purge-instance [env rec-name id]
  (let [insts (filter #(not= (:Id %) id) (get-instances env rec-name))]
    (assoc env rec-name insts)))

(defn- find-instance-by-path-parts [env path-parts]
  (if-let [p (:path path-parts)] ; maybe an alias
    (get env p)
    (let [recname [(:component path-parts) (:record path-parts)]]
      (lookup-instance env recname))))

(defn follow-reference [env path-parts]
  (loop [env env, refs (:refs path-parts)
         obj (find-instance-by-path-parts env path-parts)]
    (if-let [r (first refs)]
      (let [x (get obj r)]
        (recur (if (cn/an-instance? x)
                 (bind-instance env (cn/parsed-instance-name x) x)
                 env)
               (rest refs) x))
      [obj env])))

(defn instance-ref-path
  "Returns a path to the record in the format of [record-name inst-id]
   along with values of any refs"
  [env record-name alias refs]
  (let [inst (if alias
               (lookup-by-alias env alias)
               (lookup-instance env record-name))
        inst-id (:Id inst)
        path [record-name inst-id]]
    (if (seq refs)
      [path (get-in (cn/instance-attributes inst) refs)]
      [path inst])))

(defn lookup-instances-by-attributes [env rec-name query-attrs]
  (when-let [insts (seq (get-instances env rec-name))]
    (filter #(every? (fn [[k v]] (= v (get % k))) query-attrs) insts)))

(def bind-variable assoc)
(def lookup-variable find)

(defn- objstack [env]
  (get env :objstack (list)))

(defn push-obj
  "Push a single object or a sequence of objects to the stack"
  ([env rec-name x]
   (let [stack (objstack env)]
     (assoc env :objstack (conj stack [rec-name x]))))
  ([env rec-name] (push-obj env rec-name {})))

(defn peek-obj [env]
  (peek (objstack env)))

(defn pop-obj
  "Pop the object stack,
  return [updated-env single-object-flag? [name object]]"
  [env]
  (when-let [s (seq (objstack env))]
    (let [[_ obj :as x] (peek s)]
      [(assoc env :objstack (pop s))
       (map? obj) x])))

(defn- identity-attribute [inst]
  (or (cn/identity-attribute-name (cn/instance-name inst))
      :Id))

(defn- dirty-flag-switch
  "Turn on or off the `dirty` flag for the given instances.
  Instances marked dirty will be later flushed to store."
  [flag env insts]
  (loop [insts insts, ds (get env :dirty {})]
    (if-let [inst (first insts)]
      (let [id-attr (identity-attribute inst)]
        (if-let [id (id-attr inst)]
          (recur (rest insts) (assoc ds id flag))
          (recur (rest insts) ds)))
      (assoc env :dirty ds))))

(def mark-all-mint (partial dirty-flag-switch false))
(def mark-all-dirty (partial dirty-flag-switch true))

(defn any-dirty?
  "Return true if any of the instances are marked dirty, otherwise
  return false."
  [env insts]
  (if (cn/entity-instance? (first insts))
    (if-let [ds (:dirty env)]
      (loop [insts insts]
        (if-let [inst (first insts)]
          (let [id-attr (identity-attribute inst)
                f (get ds (id-attr inst))]
            (if (or f (nil? f))
              true
              (recur (rest insts))))
          false)))
    true))

(def as-map identity)
