(ns fractl.evaluator.root
  "The default evaluator implementation"
  (:require [fractl.env :as env]
            [fractl.component :as cn]
            [fractl.util :as u]
            [fractl.util.seq :as su]
            [fractl.store :as store]
            [fractl.resolver :as r]
            [fractl.evaluator.parser :as parser]
            [fractl.evaluator.internal :as i]
            [fractl.lang.opcode :as opc]
            [fractl.lang.internal :as li]))

(defn- assoc-fn-attributes [env raw-obj fns]
  (loop [fns fns, raw-obj raw-obj]
    (if-let [[a f] (first fns)]
      (recur (rest fns) (assoc raw-obj a (f env raw-obj)))
      raw-obj)))

(defn- assoc-computed-attributes [env record-name raw-obj]
  (let [[efns qfns] (cn/all-computed-attribute-fns record-name)
        f (partial assoc-fn-attributes env)]
    (f (f raw-obj efns) qfns)))

(defn- set-obj-attr [env attr-name attr-value]
  (let [[env single? [n x]] (env/pop-obj env)
        objs (if single? [x] x)
        new-objs (map #(assoc % attr-name (if (fn? attr-value)
                                            (attr-value env %)
                                            attr-value))
                      objs)
        env (env/push-obj env n (if single? (first new-objs) new-objs))]
    (i/ok (if single? (first new-objs) new-objs) env)))

(defn- on-inst [f xs]
  (f (if (map? xs) xs (first xs))))

(defn- need-storage? [xs]
  (on-inst cn/entity-instance? xs))

(defn- resolver-for-path [xs]
  (let [path (on-inst cn/instance-name xs)]
    (r/resolver-for-path path)))

(defn- call-resolver-upsert [resolver composed? insts]
  (let [rs (if composed? resolver [resolver])
        ins (if (map? insts) [insts] insts)]
    (doall (map (fn [r]
                  (doall
                   (map #(r/call-resolver-upsert r %) ins)))
                rs))))

(defn- call-resolver-eval [resolver composed? inst]
  (let [rs (if composed? resolver [resolver])]
    (doall (map #(r/call-resolver-eval % inst) rs))))

(defn- chained-upsert [store record-name insts]
  (let [insts (if (map? insts) [insts] insts)
        resolver (resolver-for-path insts)
        composed? (r/composed? resolver)
        upsert? (or (not resolver) composed?)
        local-result (if (and upsert? store (need-storage? insts))
                       (store/upsert-instances store record-name insts)
                       insts)
        resolver-result (when resolver
                          (call-resolver-upsert resolver composed? local-result))]
    [local-result resolver-result]))

(defn- bind-and-persist [env store x]
  (if (cn/an-instance? x)
    (let [n (li/split-path (cn/instance-name x))
          r (chained-upsert store n x)]
      [(env/bind-instance env n x) r])
    [env nil]))

(defn- id-attribute [query-attrs]
  (first (filter #(= :Id (first %)) query-attrs)))

(defn- evaluate-id-result [env r]
  (if (fn? r)
    (r env nil)
    [r env]))

(defn- evaluate-id-query [env store query param running-result]
  (let [[p env] (evaluate-id-result env param)
        rs (store/do-query store query [p])]
    [(concat running-result (map su/first-val rs)) env]))

(defn- evaluate-id-queries
  "Evaluate unique IDs from queries into index tables. Each entry in the sequence id-queries will
   be a map with two possible keys - :result and :query. If there is a :result, that will be
   bound to an ID statically evaluated by the compiler. Otherwise, execute the query and find the ID.
   Return the final sequence of IDs."
  [env store id-queries]
  (loop [idqs id-queries, env env, result []]
    (if-let [idq (first idqs)]
      (if-let [r (:result idq)]
        (let [[obj new-env] (evaluate-id-result env r)]
          (recur (rest idqs) new-env (conj result obj)))
        (let [[q p] (:query idq)
              [rs new-env] (evaluate-id-query env store q p result)]
          (recur (rest idqs) new-env rs)))
      result)))

(defn- find-instances [env store entity-name queries]
  (when-let [id-results (seq (evaluate-id-queries env store (:id-queries queries)))]
    (let [result (store/query-by-id store entity-name (:query queries) id-results)]
      [result (env/bind-instances env entity-name result)])))

(defn- pop-and-intern-instance
  "An instance is built in stages, the partial object is stored in a stack.
   Once an instance is realized, pop it from the stack and bind it to the environment."
  [env record-name]
  (let [[env single? [_ x]] (env/pop-obj env)
        objs (if single? [x] x)
        final-objs (map #(assoc-computed-attributes env record-name %) objs)
        insts (map #(if (cn/an-instance? %)
                      %
                      (cn/make-instance (li/make-path record-name) %))
                   final-objs)
        env (env/bind-instances env record-name insts)]
    [(if single? (first insts) insts) env]))

(defn- pack-results [local-result resolver-results]
  [local-result resolver-results])

(defn make-root-vm [store eval-event-dataflows]
  (reify opc/VM
    (do-match-instance [_ env [pattern instance]]
      (if-let [updated-env (parser/match-pattern env pattern instance)]
        (i/ok true updated-env)
        (i/ok false env)))

    (do-load-instance [_ env record-name]
      (if-let [inst (env/lookup-instance env record-name)]
        (i/ok inst env)
        i/not-found))

    (do-load-references [_ env [record-name refs]]
      (let [inst (env/lookup-instance env record-name)]
        (if-let [v (get (cn/instance-attributes inst) (first refs))]
          (let [[env [local-result resolver-results :as r]] (bind-and-persist env store v)]
            (i/ok (if r (pack-results local-result resolver-results) v) env))
          i/not-found)))

    (do-new-instance [_ env record-name]
      (let [env (env/push-obj env record-name)]
        (i/ok record-name env)))

    (do-query-instances [_ env [entity-name queries]]
      (if-let [[insts env] (find-instances env store entity-name queries)]
        (i/ok insts (env/push-obj env entity-name insts))
        i/not-found))

    (do-set-literal-attribute [_ env [attr-name attr-value]]
      (set-obj-attr env attr-name attr-value))

    (do-set-ref-attribute [_ env [attr-name attr-ref]]
      (let [[obj env] (env/follow-reference env attr-ref)]
        (set-obj-attr env attr-name obj)))

    (do-set-compound-attribute [_ env [attr-name f]]
      (set-obj-attr env attr-name f))

    (do-intern-instance [_ env record-name]
      (let [[insts env] (pop-and-intern-instance env record-name)
            [local-result resolver-results] (chained-upsert store record-name insts)]
        (i/ok (pack-results local-result resolver-results) env)))

    (do-intern-event-instance [self env record-name]
      (let [[inst env] (pop-and-intern-instance env record-name)
            resolver (resolver-for-path inst)
            composed? (r/composed? resolver)
            local-result (when (or (not resolver) composed?)
                           (eval-event-dataflows self inst))
            resolver-results (when resolver
                               (call-resolver-eval resolver composed? inst))]
        (i/ok (pack-results local-result resolver-results) env)))))

(def ^:private default-evaluator (u/make-cell))

(defn get-default-evaluator [store eval-event-dataflows]
  (u/safe-set-once
   default-evaluator
   #(make-root-vm store eval-event-dataflows)))
